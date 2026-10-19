import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { db } from "../db";
import {
  businessAccounts,
  topscholarContentSync,
  topscholarPlanRunItems,
  topscholarPlanRuns,
  type BusinessAccount,
} from "@shared/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getTopscholarConfig, TOPSCHOLAR_ACCOUNT_ID } from "../services/topscholar/config";
import {
  createWindowLimiter,
  embedApiKeyMatches,
  extractEmbedApiKey,
} from "../services/topscholar/embedApiKey";
import { confirmPlanLinks, discoverPlansForCpIds, queueCpRefreshes } from "../services/topscholar/cpRefreshQueue";

/**
 * TopScholar LMS embedding API (v1), called server-to-server by the client's LMS.
 *
 *   POST /api/topscholar/v1/embed              queue a full refresh for CP IDs
 *   GET  /api/topscholar/v1/embed/status       state of CP IDs (live content + latest job)
 *   GET  /api/topscholar/v1/embed/jobs/:jobId  state of one job
 *
 * Auth: the dedicated LMS API key (Settings > Curriculum API), as
 * `Authorization: Bearer <key>` or `X-Api-Key: <key>`. Each key resolves to the
 * single TopScholar account. The LMS sends CP IDs, ideally with their Plan ID: a
 * supplied pair is confirmed against the Content Bundle API; without a Plan ID the
 * owning Plan is looked up (and discovered by re-resolving the saved Plans).
 * Refreshes run through the same durable worker as the admin Content Sync page.
 */

const router = Router();

const MAX_CP_IDS_PER_REQUEST = 50;
// CP IDs and Plan IDs share this shape (TopScholar uses 24-char hex ids).
const CP_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
// How long an embed request may wait for discovery of CP IDs we have never seen.
const DISCOVERY_BUDGET_MS = 20_000;
const requestLimiter = createWindowLimiter(60, 60_000);
// Write last-used at most once a minute per process.
const LAST_USED_WRITE_INTERVAL_MS = 60_000;
let lastUsedWrittenAt = 0;

type LmsRequest = Request & { lmsAccount?: BusinessAccount };

function apiError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

async function requireLmsApiKey(req: LmsRequest, res: Response, next: NextFunction) {
  const presented = extractEmbedApiKey(req.headers);
  if (!presented) return apiError(res, 401, "unauthorized", "Missing API key.");

  const [account] = await db.select().from(businessAccounts).where(eq(businessAccounts.id, TOPSCHOLAR_ACCOUNT_ID));
  if (!account || !account.topscholarEmbedApiKeyHash) {
    return apiError(res, 401, "unauthorized", "The embedding API is not enabled.");
  }
  if (!embedApiKeyMatches(presented, account.topscholarEmbedApiKeyHash)) {
    return apiError(res, 401, "unauthorized", "Invalid API key.");
  }

  const limit = requestLimiter(account.id);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    return apiError(res, 429, "rate_limited", `Too many requests. Retry in ${limit.retryAfterSeconds} seconds.`);
  }

  if (Date.now() - lastUsedWrittenAt > LAST_USED_WRITE_INTERVAL_MS) {
    lastUsedWrittenAt = Date.now();
    db.update(businessAccounts)
      .set({ topscholarEmbedApiKeyLastUsedAt: new Date() })
      .where(eq(businessAccounts.id, account.id))
      .catch((error) => console.warn("[TopScholar LMS API] could not record key use:", error?.message || error));
  }

  req.lmsAccount = account;
  next();
}

interface EmbedItem {
  cpId: string;
  planId: string | null;
}

/**
 * Reads the packages to embed. Accepted shapes (planId always optional):
 *   { "cpId": "...", "planId": "..." }
 *   { "cpIds": ["...", ...], "planId": "..." }      one Plan for every CP ID
 *   { "items": [{ "cpId": "...", "planId": "..." }, ...] }
 * Null => malformed body.
 */
function readEmbedItems(body: any): EmbedItem[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const sharedPlan = body.planId;
  if (sharedPlan !== undefined && sharedPlan !== null && typeof sharedPlan !== "string") return null;
  const planOf = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

  if (Array.isArray(body.items)) {
    const items: EmbedItem[] = [];
    for (const item of body.items) {
      if (!item || typeof item !== "object" || typeof item.cpId !== "string") return null;
      if (item.planId !== undefined && item.planId !== null && typeof item.planId !== "string") return null;
      items.push({ cpId: item.cpId.trim(), planId: planOf(item.planId) });
    }
    return items;
  }
  if (Array.isArray(body.cpIds)) {
    if (!body.cpIds.every((value: unknown) => typeof value === "string")) return null;
    return body.cpIds.map((cpId: string) => ({ cpId: cpId.trim(), planId: planOf(sharedPlan) }));
  }
  if (typeof body.cpId === "string") return [{ cpId: body.cpId.trim(), planId: planOf(sharedPlan) }];
  return null;
}

/** Splits a comma-separated `cpIds` query value (also accepts repeated params). */
function readCpIdsQuery(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(","));
}

/**
 * Client-facing failure text. Messages that help the LMS act are passed through;
 * anything else (provider errors, stack details, key fragments) is replaced by a
 * generic message. The admin Content Sync page keeps the full detail.
 */
function publicError(raw: string | null | undefined): string {
  const message = (raw || "").trim();
  if (/^Only \d+ of \d+ passages/.test(message)) return message;
  if (/was not found under Plan ID/i.test(message)) {
    return "TopScholar's content service no longer lists this CP ID under its Plan. Check the CP ID, or ask AI Chroney to re-resolve its Plan.";
  }
  if (/^Cancelled/i.test(message)) return "The refresh was cancelled. The previous content is still live.";
  return "The refresh failed on our side. The previous content (if any) is still live. Please retry later; if it keeps failing, contact AI Chroney support.";
}

type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

function itemState(status: string): JobState {
  if (status === "queued") return "queued";
  if (status === "running" || status === "submitted") return "running";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

function runState(status: string): JobState {
  if (status === "queued" || status === "resolving") return "queued";
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

// ---- POST /embed --------------------------------------------------------------

router.post("/api/topscholar/v1/embed", requireLmsApiKey, async (req: LmsRequest, res: Response) => {
  const account = req.lmsAccount!;
  const requested = readEmbedItems(req.body);
  if (!requested) {
    return apiError(
      res,
      400,
      "invalid_request",
      'Send a JSON body like { "cpIds": ["<cp id>", ...], "planId": "<plan id>" } or { "items": [{ "cpId": "...", "planId": "..." }] }.',
    );
  }
  // One entry per CP ID (the first occurrence wins).
  const seen = new Set<string>();
  const items = requested.filter((item) => item.cpId && !seen.has(item.cpId) && seen.add(item.cpId));
  const cpIds = items.map((item) => item.cpId);
  if (items.length === 0) return apiError(res, 400, "invalid_request", "Provide at least one CP ID.");
  if (items.length > MAX_CP_IDS_PER_REQUEST) {
    return apiError(res, 400, "too_many_cp_ids", `Send at most ${MAX_CP_IDS_PER_REQUEST} CP IDs per request.`);
  }

  const cfg = getTopscholarConfig(account);
  if (!cfg.ragEnabled || !account.openaiApiKey || !cfg.contentDbUrl) {
    return apiError(
      res,
      503,
      "content_store_unavailable",
      "Embedding is temporarily unavailable because the content database is not connected. Please contact AI Chroney support.",
    );
  }

  const requestId = crypto.randomUUID();
  const rejected: Array<{ cpId: string; code: string; message: string }> = [];
  const valid: EmbedItem[] = [];
  for (const item of items) {
    if (!CP_ID_PATTERN.test(item.cpId)) {
      rejected.push({ cpId: item.cpId, code: "invalid_cp_id", message: "CP IDs may only contain letters, digits, '-' and '_' (max 100 characters)." });
    } else if (item.planId && !CP_ID_PATTERN.test(item.planId)) {
      rejected.push({ cpId: item.cpId, code: "invalid_plan_id", message: "Plan IDs may only contain letters, digits, '-' and '_' (max 100 characters)." });
    } else {
      valid.push(item);
    }
  }

  const accepted: Array<{ cpId: string; jobId: string; status: "queued" | "already_queued" }> = [];
  if (valid.length > 0) {
    try {
      const planByCpId = new Map<string, string>();

      // With a Plan ID: confirm the pairing against the Content Bundle API.
      const pairs = valid.filter((item) => item.planId).map((item) => ({ cpId: item.cpId, planId: item.planId! }));
      if (pairs.length > 0) {
        const links = await confirmPlanLinks({ businessAccountId: account.id, cfg, pairs, budgetMs: DISCOVERY_BUDGET_MS });
        links.planByCpId.forEach((planId, cpId) => planByCpId.set(cpId, planId));
        for (const item of links.rejected) rejected.push({ cpId: item.cpId, code: item.code, message: item.error });
      }

      // CP ID only: use the stored link, discovering it for a new CP ID.
      const bare = valid.filter((item) => !item.planId).map((item) => item.cpId);
      if (bare.length > 0) {
        const discovery = await discoverPlansForCpIds({
          businessAccountId: account.id,
          cfg,
          cpIds: bare,
          budgetMs: DISCOVERY_BUDGET_MS,
        });
        for (const cpId of bare) {
          const planId = discovery.planByCpId.get(cpId);
          if (planId) {
            planByCpId.set(cpId, planId);
            continue;
          }
          rejected.push(discovery.scanComplete
            ? {
                cpId,
                code: "unknown_cp_id",
                message: "This CP ID was not found under any of TopScholar's configured Plans. Send its planId as well, or ask AI Chroney to add its Plan.",
              }
            : {
                cpId,
                code: "lookup_in_progress",
                message: "This CP ID is new to us and its Plan is still being looked up. Retry in a minute, or send its planId as well.",
              });
        }
      }

      const known = valid.map((item) => item.cpId).filter((cpId) => planByCpId.has(cpId));
      if (known.length > 0) {
        const outcome = await queueCpRefreshes({ businessAccountId: account.id, cpIds: known, planByCpId });
        for (const item of outcome.queued) accepted.push({ cpId: item.cpId, jobId: item.runId, status: "queued" });
        for (const item of outcome.skipped) accepted.push({ cpId: item.cpId, jobId: item.runId, status: "already_queued" });
        for (const item of outcome.rejected) rejected.push({ cpId: item.cpId, code: item.code, message: item.error });
      }
    } catch (error: any) {
      console.error(`[TopScholar LMS API] embed request ${requestId} failed:`, error);
      return apiError(res, 500, "internal_error", "Could not queue the request. Please retry.");
    }
  }

  console.log(
    `[TopScholar LMS API] embed request ${requestId}: ${cpIds.length} CP ID(s), ${accepted.length} accepted, ${rejected.length} rejected`
      + (rejected.length > 0 ? ` (${rejected.map((r) => `${r.cpId}:${r.code}`).join(", ")})` : ""),
  );
  res.status(accepted.length > 0 ? 202 : 422).json({ requestId, accepted, rejected });
});

// ---- GET /embed/status --------------------------------------------------------

router.get("/api/topscholar/v1/embed/status", requireLmsApiKey, async (req: LmsRequest, res: Response) => {
  const account = req.lmsAccount!;
  const cpIds = Array.from(new Set(readCpIdsQuery(req.query.cpIds).map((cpId) => cpId.trim()).filter(Boolean)));
  if (cpIds.length === 0) {
    return apiError(res, 400, "invalid_request", "Pass CP IDs as ?cpIds=<id1>,<id2>.");
  }
  if (cpIds.length > MAX_CP_IDS_PER_REQUEST) {
    return apiError(res, 400, "too_many_cp_ids", `Ask for at most ${MAX_CP_IDS_PER_REQUEST} CP IDs per request.`);
  }

  const [syncRows, itemRows] = await Promise.all([
    db
      .select()
      .from(topscholarContentSync)
      .where(and(eq(topscholarContentSync.businessAccountId, account.id), inArray(topscholarContentSync.cpId, cpIds))),
    db
      .select({
        cpId: topscholarPlanRunItems.cpId,
        runId: topscholarPlanRunItems.runId,
        status: topscholarPlanRunItems.status,
        error: topscholarPlanRunItems.error,
        createdAt: topscholarPlanRunItems.createdAt,
      })
      .from(topscholarPlanRunItems)
      .where(and(eq(topscholarPlanRunItems.businessAccountId, account.id), inArray(topscholarPlanRunItems.cpId, cpIds)))
      .orderBy(desc(topscholarPlanRunItems.createdAt)),
  ]);
  const syncByCp = new Map(syncRows.map((row) => [row.cpId, row]));
  const latestItemByCp = new Map<string, (typeof itemRows)[number]>();
  for (const item of itemRows) if (!latestItemByCp.has(item.cpId)) latestItemByCp.set(item.cpId, item);

  const results = cpIds.map((cpId) => {
    const sync = syncByCp.get(cpId);
    const item = latestItemByCp.get(cpId);
    let state: JobState | "not_found";
    if (item) state = itemState(item.status);
    else if (sync?.status === "syncing") state = "running";
    else if (sync?.status === "completed" || sync?.status === "failed" || sync?.status === "cancelled") state = sync.status;
    else state = "not_found";

    const running = state === "running" && sync?.status === "syncing";
    const error = state === "failed" ? publicError(item?.error || sync?.lastError) : null;
    return {
      cpId,
      state,
      jobId: item?.runId ?? null,
      error,
      progress: running ? { embedded: sync!.processedCount, total: sync!.totalCount } : null,
      live: {
        passages: sync?.chunkCount ?? 0,
        lastCompletedAt: sync?.lastSyncedAt ? sync.lastSyncedAt.toISOString() : null,
      },
    };
  });

  res.json({ results });
});

// ---- GET /embed/jobs/:jobId ---------------------------------------------------

router.get("/api/topscholar/v1/embed/jobs/:jobId", requireLmsApiKey, async (req: LmsRequest, res: Response) => {
  const account = req.lmsAccount!;
  const jobId = String(req.params.jobId || "");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return apiError(res, 404, "not_found", "Job not found.");

  const [run] = await db
    .select()
    .from(topscholarPlanRuns)
    .where(and(eq(topscholarPlanRuns.id, jobId), eq(topscholarPlanRuns.businessAccountId, account.id)));
  if (!run) return apiError(res, 404, "not_found", "Job not found.");

  const items = await db
    .select({ cpId: topscholarPlanRunItems.cpId, status: topscholarPlanRunItems.status, error: topscholarPlanRunItems.error })
    .from(topscholarPlanRunItems)
    .where(eq(topscholarPlanRunItems.runId, run.id))
    .orderBy(topscholarPlanRunItems.createdAt);

  res.json({
    jobId: run.id,
    state: runState(run.status),
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    error: run.status === "failed" ? publicError(run.error) : null,
    cps: items.map((item) => ({
      cpId: item.cpId,
      state: itemState(item.status),
      error: itemState(item.status) === "failed" ? publicError(item.error) : null,
    })),
  });
});

export default router;
