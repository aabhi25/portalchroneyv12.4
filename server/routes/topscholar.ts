import { Router, Request, Response } from "express";
import { db } from "../db";
import {
  businessAccounts,
  topscholarCpMappings,
  topscholarContentSync,
  topscholarEmbedJobs,
  topscholarEmbedStaging,
  topscholarPlanIds,
  topscholarPlanCpResolutions,
  topscholarPlanRunItems,
  topscholarPlanRuns,
  conversations,
} from "@shared/schema";
import { and, eq, desc, gt, isNotNull, inArray, ilike, sql } from "drizzle-orm";
import { requireAuth, requireBusinessAccount, requireRole } from "../auth";
import {
  getTopscholarConfig,
  isTopscholarAccount,
  assertSafeCmsBaseUrl,
  isMongoConnectionString,
} from "../services/topscholar/config";
import { encrypt } from "../services/encryptionService";
import { ingestPlanIds, ingestSingleCp, resolvePlans, curriculumLabel, DEFAULT_SAMPLE_LIMIT } from "../services/topscholar/ingestionService";
import { testMongoConnection } from "../services/topscholar/mongoContentDb";
import { getContentOverview, getChapters, getChunks, getChapterNamesForCpIds, getCpIdsWithContent } from "../services/topscholar/contentReader";
import { getMongoContentOverview, getMongoChapters, getMongoChunks } from "../services/topscholar/mongoContentReader";
import { getMongoChapterNames, getMongoCpIdsWithContent } from "../services/topscholar/mongoContentDb";
import { fetchCurriculumImage } from "../services/topscholar/mediaProxy";
import { resolveCpIdsForScope } from "../services/topscholar/scopeResolver";
import {
  reconcileSubjectNamesFromContentStore,
  type StoredCurriculumScope,
} from "../services/topscholar/testerContentScopes";
import { testContentBundleConnection } from "../services/topscholar/cmsConnector";
import { cancelBatch } from "../services/topscholar/embeddingBatchService";
import { withCpLock } from "../services/topscholar/cpLock";
import { deleteCpChunks } from "../services/topscholar/chunkStore";
import { isNonRetryableEmbeddingFailure } from "../services/topscholar/syncFailure";
import {
  cancelPlanSyncRun,
  enqueuePlanSyncRuns,
  enqueueSingleCpSyncRun,
  listPlanSyncRuns,
  retryFailedPlanSyncItems,
} from "../services/topscholar/planSyncWorker";

const router = Router();

// Shared guard stack for every TopScholar admin route: authenticated, has a
// business account, has an admin-level role, AND is the single allowed tenant.
const requireTopscholarAccount = (req: Request, res: Response, next: Function) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId || !isTopscholarAccount(businessAccountId)) {
    return res.status(403).json({ error: "TopScholar curriculum mode is not available for this account." });
  }
  next();
};

const topscholarGuards = [
  requireAuth,
  requireBusinessAccount,
  requireRole("business_user", "super_admin"),
  requireTopscholarAccount,
] as const;

// Public widget sessions do not have the admin session required by the other
// TopScholar routes. This endpoint only proxies approved curriculum media and
// normalizes incorrect upstream MIME types (not arbitrary URLs).
router.get("/api/topscholar/media-proxy", async (req: Request, res: Response) => {
  const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
  if (!rawUrl) return res.status(400).json({ error: "Image URL is required." });

  try {
    const image = await fetchCurriculumImage(rawUrl);
    res
      .status(200)
      .set({
        "Content-Type": image.contentType,
        "Content-Length": String(image.body.length),
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      })
      .send(image.body);
  } catch (error: any) {
    const message = error?.message || "Unable to load curriculum image.";
    const status = /approved|invalid|public HTTPS|supported|too large/i.test(message) ? 400 : 502;
    console.warn("[TopScholar Media] image proxy failed:", message);
    res.status(status).json({ error: "Unable to load curriculum image." });
  }
});

function getBusinessAccountId(req: Request): string | null {
  const user = (req as any).user;
  if (!user) return null;
  return user.businessAccountId || null;
}

// Parse server-side pagination params with safe, backward-compatible defaults.
// `limit` is clamped to [1, max]; `offset` is clamped to >= 0.
function parsePageParams(req: Request, defaultLimit: number, maxLimit: number): { limit: number; offset: number } {
  const rawLimit = Number(req.query?.limit);
  const rawOffset = Number(req.query?.offset);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), maxLimit) : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  return { limit, offset };
}

// Sentinel planId used by the status section to request sync rows whose cp_id is
// not resolved/mapped under ANY plan (the "no plan" bucket).
const NO_PLAN_KEY = "__no_plan__";

// Parse a trimmed free-text search term; empty/whitespace -> null (no filter).
function parseSearch(req: Request): string | null {
  const raw = req.query?.q;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type PlanEmbeddingFilter = "all" | "pending" | "completed";

function parsePlanEmbeddingFilter(req: Request): PlanEmbeddingFilter {
  const value = req.query?.embeddingStatus;
  return value === "pending" || value === "completed" ? value : "all";
}

function completedPlanEmbeddingCondition(businessAccountId: string) {
  // A Plan is complete only when its current resolution is non-empty and every
  // resolved CP has successfully finished a full embedding. Resolution alone,
  // sample syncs, failures, cancellations, and partial progress stay pending.
  return sql`
    ${topscholarPlanIds.lastStatus} NOT IN ('syncing', 'failed', 'cancelled')
    AND EXISTS (
      SELECT 1
      FROM topscholar_plan_cp_resolutions resolution
      WHERE resolution.business_account_id = ${businessAccountId}
        AND resolution.plan_id = ${topscholarPlanIds.planId}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM topscholar_plan_cp_resolutions resolution
      LEFT JOIN topscholar_content_sync sync
        ON sync.business_account_id = resolution.business_account_id
        AND sync.cp_id = resolution.cp_id
      WHERE resolution.business_account_id = ${businessAccountId}
        AND resolution.plan_id = ${topscholarPlanIds.planId}
        AND (
          sync.id IS NULL
          OR sync.status <> 'completed'
          OR sync.sync_mode <> 'full'
        )
    )
  `;
}

async function loadAccount(businessAccountId: string) {
  const [account] = await db
    .select()
    .from(businessAccounts)
    .where(eq(businessAccounts.id, businessAccountId));
  return account || null;
}

function buildLabel(board?: string | null, medium?: string | null, grade?: string | null): string {
  return [board, medium, grade].filter(Boolean).join(" · ");
}

function configResponse(cfg: ReturnType<typeof getTopscholarConfig>) {
  return {
    ragEnabled: cfg.ragEnabled,
    uatPlainCpId: cfg.uatPlainCpId,
    // Show the SAVED external URL even when the external DB is switched off, so the
    // admin can see/edit it while running on the local store.
    contentDbUrl: cfg.savedContentDbUrl || "",
    externalContentDbDisabled: cfg.externalContentDbDisabled,
    contentDbName: cfg.contentDbName || "",
    contentDbIndex: cfg.contentDbIndex || "",
    contentDbCollection: cfg.contentDbCollection || "",
    storeType: cfg.storeType,
    apiBaseUrl: cfg.apiBaseUrl || "",
    hasApiToken: !!cfg.apiToken,
    syncMode: cfg.syncMode,
    hasTokenSecret: !!cfg.tokenSecret,
    requireSignedToken: cfg.requireSignedToken,
    // Doubt-sync: base URL of the client platform's conversation-sync / doubt-close
    // API. Empty string when unset (doubt mirroring is then simply skipped).
    doubtSyncBaseUrl: cfg.doubtSyncBaseUrl || "",
    // Idle seconds before the "Did this resolve your doubt?" prompt fires. null =
    // use the platform default (surfaced to the admin so the field can show blank).
    doubtResolutionCooldownSeconds: cfg.doubtResolutionCooldownSeconds ?? null,
  };
}

// ---- Config ---------------------------------------------------------------

router.get("/api/topscholar/config", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const cfg = getTopscholarConfig(account);
  // Never return secrets — only whether they are set.
  res.json(configResponse(cfg));
});

router.put("/api/topscholar/config", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const {
    uatPlainCpId, requireSignedToken, contentDbUrl, contentDbName, contentDbIndex, contentDbCollection,
    externalContentDbDisabled,
    tokenSecret,
    apiBaseUrl, apiToken, syncMode,
    doubtSyncBaseUrl, doubtResolutionCooldownSeconds,
  } = req.body || {};

  // Curriculum mode is hardcoded ON for the TopScholar account (see
  // getTopscholarConfig); there is no enable flag to read or persist here.
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (typeof uatPlainCpId === "boolean") patch.topscholarUatPlainCpId = uatPlainCpId ? "true" : "false";
  if (typeof requireSignedToken === "boolean") patch.topscholarRequireSignedToken = requireSignedToken ? "true" : "false";
  // Manual kill-switch for the external content DB. Toggling this NEVER touches the
  // saved URL/name/index/collection — it only flips whether they are used.
  if (typeof externalContentDbDisabled === "boolean") patch.topscholarContentDbDisabled = externalContentDbDisabled ? "true" : "false";
  if (typeof contentDbUrl === "string") {
    // The connection string carries the client's DB password, so it is encrypted
    // at rest (AES-256-GCM). A blank value clears it (falls back to local pgvector).
    const trimmed = contentDbUrl.trim();
    patch.topscholarContentDbUrl = trimmed ? encrypt(trimmed) : null;
  }
  if (typeof contentDbName === "string") patch.topscholarContentDbName = contentDbName.trim() || null;
  if (typeof contentDbIndex === "string") patch.topscholarContentDbIndex = contentDbIndex.trim() || null;
  if (typeof contentDbCollection === "string") patch.topscholarContentDbCollection = contentDbCollection.trim() || null;

  // When an external MongoDB content DB is being set, probe the connection so the
  // admin gets immediate feedback. The settings are persisted REGARDLESS of the
  // probe result — an unreachable cluster (e.g. an Atlas IP-allowlist still
  // propagating) must not block saving the details; the failure is surfaced as a
  // non-blocking warning instead. A missing Vector Search index is likewise a
  // warning (it can be created in Atlas after the first sync). A blank URL skips
  // the probe (local pgvector stand-in).
  // Skip the probe when the external DB is (or is being) switched off — its
  // reachability is irrelevant while we run on the local store, and an
  // unreachable cluster would otherwise hang the save for ~10s.
  const willDisableExternal =
    typeof externalContentDbDisabled === "boolean"
      ? externalContentDbDisabled
      : account.topscholarContentDbDisabled === "true";
  let saveWarning: string | undefined;
  if (!willDisableExternal && typeof contentDbUrl === "string" && contentDbUrl.trim() && isMongoConnectionString(contentDbUrl)) {
    const dbName = (typeof contentDbName === "string" ? contentDbName.trim() : "") || account.topscholarContentDbName || null;
    const collection = (typeof contentDbCollection === "string" ? contentDbCollection.trim() : "") || account.topscholarContentDbCollection || null;
    const indexName = (typeof contentDbIndex === "string" ? contentDbIndex.trim() : "") || account.topscholarContentDbIndex || null;
    const probe = await testMongoConnection({ connectionString: contentDbUrl.trim(), dbName, collection, indexName });
    if (!probe.success) {
      saveWarning = `Saved, but could not connect to the MongoDB content DB: ${probe.message}. The chatbot won't be able to read curriculum from it until the connection succeeds (check the Atlas IP allowlist and that the cluster is running), then use "Test Connection" to verify.`;
    } else {
      saveWarning = probe.warning;
    }
  }
  if (typeof apiBaseUrl === "string") {
    const trimmed = apiBaseUrl.trim();
    if (trimmed) {
      try {
        assertSafeCmsBaseUrl(trimmed);
      } catch (e: any) {
        return res.status(400).json({ error: e?.message || "Invalid Content Bundle API base URL." });
      }
    }
    patch.topscholarApiBaseUrl = trimmed || null;
  }
  if (syncMode === "sample" || syncMode === "full") patch.topscholarSyncMode = syncMode;
  // Doubt-sync base URL: same SSRF/format guard as the Content Bundle API URL. A
  // blank value clears it (doubt mirroring then simply no-ops).
  if (typeof doubtSyncBaseUrl === "string") {
    const trimmed = doubtSyncBaseUrl.trim();
    if (trimmed) {
      try {
        assertSafeCmsBaseUrl(trimmed);
      } catch (e: any) {
        return res.status(400).json({ error: e?.message || "Invalid Doubt Sync API base URL." });
      }
    }
    patch.topscholarDoubtSyncBaseUrl = trimmed || null;
  }
  // Doubt-resolution cooldown (seconds). Accept a positive integer within a sane
  // range; null/empty clears it (falls back to the platform default). Reject junk
  // rather than silently coercing it.
  if (doubtResolutionCooldownSeconds !== undefined) {
    if (doubtResolutionCooldownSeconds === null || doubtResolutionCooldownSeconds === "") {
      patch.topscholarDoubtResolutionCooldownSeconds = null;
    } else {
      const n = Number(doubtResolutionCooldownSeconds);
      if (!Number.isInteger(n) || n < 10 || n > 3600) {
        return res.status(400).json({ error: "Doubt-resolution cooldown must be a whole number of seconds between 10 and 3600." });
      }
      patch.topscholarDoubtResolutionCooldownSeconds = n;
    }
  }
  // Secrets: only overwrite when a non-empty value is provided so a blank field
  // in the UI doesn't accidentally wipe an existing secret.
  if (typeof tokenSecret === "string" && tokenSecret.trim()) patch.topscholarTokenSecret = tokenSecret.trim();
  if (typeof apiToken === "string" && apiToken.trim()) patch.topscholarApiToken = apiToken.trim();

  await db.update(businessAccounts).set(patch).where(eq(businessAccounts.id, businessAccountId));

  const updated = await loadAccount(businessAccountId);
  const cfg = getTopscholarConfig(updated!);
  res.json({ ...configResponse(cfg), warning: saveWarning });
});

// ---- Test MongoDB Atlas connection ---------------------------------------

router.post("/api/topscholar/test-mongo", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const cfg = getTopscholarConfig(account);
  // Allow testing a not-yet-saved connection string from the form; fall back to stored.
  const bodyUrl = typeof req.body?.contentDbUrl === "string" ? req.body.contentDbUrl.trim() : "";
  const bodyName = typeof req.body?.contentDbName === "string" ? req.body.contentDbName.trim() : "";
  const bodyCollection = typeof req.body?.contentDbCollection === "string" ? req.body.contentDbCollection.trim() : "";
  const bodyIndex = typeof req.body?.contentDbIndex === "string" ? req.body.contentDbIndex.trim() : "";
  const connectionString = bodyUrl || cfg.contentDbUrl || "";
  const dbName = (bodyName || cfg.contentDbName || "") || null;
  const collection = (bodyCollection || cfg.contentDbCollection || "") || null;
  const indexName = (bodyIndex || cfg.contentDbIndex || "") || null;

  if (!connectionString) {
    return res.status(400).json({ success: false, message: "No content DB connection string provided." });
  }
  if (!isMongoConnectionString(connectionString)) {
    return res.status(400).json({ success: false, message: "Connection string is not a MongoDB URL (expected mongodb:// or mongodb+srv://)." });
  }

  const result = await testMongoConnection({ connectionString, dbName, collection, indexName });
  res.json(result);
});

// Explicit maintenance action. It may scan the active client store once, but it
// only writes clean subject labels into the app-side CP mapping metadata.
router.post("/api/topscholar/reconcile-subjects", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  try {
    const cfg = getTopscholarConfig(account);
    if (cfg.externalContentDbDisabled || !cfg.contentDbUrl) {
      return res.status(400).json({
        error: "Enable and save the external client content database before importing subject names.",
      });
    }
    const result = await reconcileSubjectNamesFromContentStore(
      cfg,
      businessAccountId,
    );
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error("[TopScholar] Subject reconciliation failed:", error);
    res.status(502).json({
      error: error?.message || "Could not read subject names from the configured content store.",
    });
  }
});

// Probe the Content Bundle API (plan-and-promo). Tests a not-yet-saved URL/token
// from the form, falling back to stored config. Uses one saved Plan ID as a
// sample when available so the admin gets a meaningful round-trip result.
router.post("/api/topscholar/test-content-bundle", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const cfg = getTopscholarConfig(account);
  const bodyUrl = typeof req.body?.apiBaseUrl === "string" ? req.body.apiBaseUrl.trim() : "";
  const bodyToken = typeof req.body?.apiToken === "string" ? req.body.apiToken.trim() : "";
  const apiBaseUrl = bodyUrl || cfg.apiBaseUrl || "";
  const apiToken = bodyToken || cfg.apiToken || null;

  if (!apiBaseUrl) {
    return res.status(400).json({ success: false, message: "No API Endpoint URL provided." });
  }

  const [samplePlan] = await db
    .select({ planId: topscholarPlanIds.planId })
    .from(topscholarPlanIds)
    .where(eq(topscholarPlanIds.businessAccountId, businessAccountId))
    .orderBy(desc(topscholarPlanIds.updatedAt))
    .limit(1);

  const result = await testContentBundleConnection(apiBaseUrl, apiToken, samplePlan?.planId ?? null);
  res.json(result);
});

// ---- Sync -----------------------------------------------------------------

router.get("/api/topscholar/sync", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { limit, offset } = parsePageParams(req, 50, 500);
  const q = parseSearch(req);
  const status = typeof req.query?.status === "string" ? req.query.status.trim() : "";
  const planFilter = typeof req.query?.planId === "string" ? req.query.planId.trim() : "";

  // Build the WHERE for the sync rows. The sync table has no plan column — a cp_id's
  // owning plan lives in the resolution snapshot (or the cp->mapping), so plan
  // filtering is expressed as a correlated subquery against those tables per cp_id.
  const conds = [eq(topscholarContentSync.businessAccountId, businessAccountId)];
  if (status) conds.push(eq(topscholarContentSync.status, status));
  if (q) conds.push(ilike(topscholarContentSync.cpId, `%${q}%`));
  // Plan filtering must use the SAME single-owner attribution as the summary
  // counts and the per-row enrichment below — a cp_id's effective plan is its
  // most-recently-resolved resolution, else its mapping, else "no plan". Using
  // broad EXISTS membership here would let a cp_id that lived under several plans
  // historically appear in the wrong bucket (or in multiple buckets), so the
  // expanded rows would diverge from the summary counts. This correlated subquery
  // mirrors the resolution/mapping ordering used everywhere else.
  if (planFilter) {
    const effectivePlan = sql`COALESCE(
      (SELECT r.plan_id FROM ${topscholarPlanCpResolutions} r
        WHERE r.business_account_id = ${businessAccountId} AND r.cp_id = ${topscholarContentSync.cpId}
        ORDER BY r.last_resolved_at DESC NULLS LAST, r.updated_at DESC LIMIT 1),
      (SELECT m.plan_id FROM ${topscholarCpMappings} m
        WHERE m.business_account_id = ${businessAccountId} AND m.cp_id = ${topscholarContentSync.cpId}
        ORDER BY m.cp_id LIMIT 1)
    )`;
    if (planFilter === NO_PLAN_KEY) {
      conds.push(sql`${effectivePlan} IS NULL`);
    } else {
      conds.push(sql`${effectivePlan} = ${planFilter}`);
    }
  }
  const where = and(...conds);

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(topscholarContentSync)
      .where(where)
      .orderBy(desc(topscholarContentSync.updatedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(topscholarContentSync)
      .where(where),
  ]);
  const total = totalRow[0]?.count ?? 0;

  // Enrich ONLY the page's rows with the owning Plan ID + curriculum name so the
  // status table reads like the Plan IDs panel. Source of truth is the resolution
  // snapshot (most-recent plan per cp_id); fall back to the cp->mapping. Neither
  // is required — rows degrade gracefully to just the cp_id. Scoped to page cp_ids.
  const pageCpIds = rows.map((r) => r.cpId);
  let enriched = rows.map((row) => ({ ...row, planId: null as string | null, curriculumName: null as string | null, planCount: 0 }));
  if (pageCpIds.length > 0) {
    const resolutions = await db
      .select({
        planId: topscholarPlanCpResolutions.planId,
        cpId: topscholarPlanCpResolutions.cpId,
        label: topscholarPlanCpResolutions.label,
        cpName: topscholarPlanCpResolutions.cpName,
        board: topscholarPlanCpResolutions.board,
        grade: topscholarPlanCpResolutions.grade,
        medium: topscholarPlanCpResolutions.medium,
        subject: topscholarPlanCpResolutions.subject,
        lastResolvedAt: topscholarPlanCpResolutions.lastResolvedAt,
      })
      .from(topscholarPlanCpResolutions)
      .where(and(eq(topscholarPlanCpResolutions.businessAccountId, businessAccountId), inArray(topscholarPlanCpResolutions.cpId, pageCpIds)))
      .orderBy(sql`${topscholarPlanCpResolutions.lastResolvedAt} DESC NULLS LAST`, desc(topscholarPlanCpResolutions.updatedAt));
    const mappings = await db
      .select({
        planId: topscholarCpMappings.planId,
        cpId: topscholarCpMappings.cpId,
        label: topscholarCpMappings.label,
        cpName: topscholarCpMappings.cpName,
        board: topscholarCpMappings.board,
        grade: topscholarCpMappings.grade,
        medium: topscholarCpMappings.medium,
        subject: topscholarCpMappings.subject,
      })
      .from(topscholarCpMappings)
      .where(and(eq(topscholarCpMappings.businessAccountId, businessAccountId), inArray(topscholarCpMappings.cpId, pageCpIds)));

    // Recompute the uniform label from columns (subject · board · grade) so even
    // rows whose stored `label` predates the subject column render consistently;
    // fall back to the stored label / cpName / grade·board·medium.
    const composeLabel = (r: { subject?: string | null; label?: string | null; cpName?: string | null; board?: string | null; grade?: string | null; medium?: string | null }) =>
      curriculumLabel(r) || r.label || null;

    const resByCp = new Map<string, typeof resolutions[number]>();
    const planCountByCp = new Map<string, Set<string>>();
    for (const r of resolutions) {
      if (!resByCp.has(r.cpId)) resByCp.set(r.cpId, r);
      if (!planCountByCp.has(r.cpId)) planCountByCp.set(r.cpId, new Set());
      planCountByCp.get(r.cpId)!.add(r.planId);
    }
    const mapByCp = new Map<string, typeof mappings[number]>();
    for (const m of mappings) if (!mapByCp.has(m.cpId)) mapByCp.set(m.cpId, m);

    enriched = rows.map((row) => {
      const res = resByCp.get(row.cpId);
      const map = mapByCp.get(row.cpId);
      const planId = res?.planId || map?.planId || null;
      const curriculumName = (res && composeLabel(res)) || (map && composeLabel(map)) || null;
      const planCount = planCountByCp.get(row.cpId)?.size || (planId ? 1 : 0);
      return { ...row, planId, curriculumName, planCount };
    });
  }
  res.json({ rows: enriched, total });
});

// Lightweight status summary for cheap polling. Returns only counts (no row
// payloads): overall status tallies, a per-plan breakdown, and a "no plan" bucket
// for cp_ids not resolved/mapped under any plan. The page polls this (not the full
// status table) and only while there is in-progress work. cp -> plan association
// mirrors the sync GET enrichment (most-recent resolution, else cp->mapping).
router.get("/api/topscholar/sync/summary", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  // Aggregate counts entirely in SQL so this hot polling path transfers O(plans ×
  // statuses) rows instead of every cp_id. Each cp is attributed to a single plan:
  // its most-recently-resolved resolution wins, else its mapping, else "no plan" —
  // matching the per-row enrichment used by GET /sync.
  const grouped = await db.execute(sql`
    WITH res AS (
      SELECT DISTINCT ON (cp_id) cp_id, plan_id
      FROM topscholar_plan_cp_resolutions
      WHERE business_account_id = ${businessAccountId}
      ORDER BY cp_id, last_resolved_at DESC NULLS LAST, updated_at DESC
    ),
    map AS (
      SELECT DISTINCT ON (cp_id) cp_id, plan_id
      FROM topscholar_cp_mappings
      WHERE business_account_id = ${businessAccountId}
      ORDER BY cp_id
    ),
    attributed AS (
      SELECT s.status AS status, COALESCE(res.plan_id, map.plan_id) AS plan_id
      FROM topscholar_content_sync s
      LEFT JOIN res ON res.cp_id = s.cp_id
      LEFT JOIN map ON map.cp_id = s.cp_id
      WHERE s.business_account_id = ${businessAccountId}
    )
    SELECT plan_id, status, count(*)::int AS c
    FROM attributed
    GROUP BY plan_id, status
  `);

  type Counts = { total: number; idle: number; syncing: number; completed: number; failed: number; cancelled: number };
  const newCounts = (): Counts => ({ total: 0, idle: 0, syncing: 0, completed: 0, failed: 0, cancelled: 0 });
  const bumpBy = (c: Counts, status: string, n: number) => {
    c.total += n;
    if (status === "syncing") c.syncing += n;
    else if (status === "completed") c.completed += n;
    else if (status === "failed") c.failed += n;
    else if (status === "cancelled") c.cancelled += n;
    else c.idle += n;
  };

  const overall = newCounts();
  const noPlan = newCounts();
  const byPlan = new Map<string, Counts>();
  for (const row of (grouped.rows as Array<{ plan_id: string | null; status: string; c: number }>)) {
    const n = Number(row.c) || 0;
    bumpBy(overall, row.status, n);
    if (!row.plan_id) {
      bumpBy(noPlan, row.status, n);
    } else {
      let c = byPlan.get(row.plan_id);
      if (!c) { c = newCounts(); byPlan.set(row.plan_id, c); }
      bumpBy(c, row.status, n);
    }
  }

  // Sort plans so the ones with active work surface first, then by total desc.
  const plans = Array.from(byPlan.entries())
    .map(([planId, c]) => ({ planId, ...c }))
    .sort((a, b) => (b.syncing - a.syncing) || (b.total - a.total) || a.planId.localeCompare(b.planId));

  res.json({ overall, plans, noPlan: noPlan.total > 0 ? noPlan : null });
});

router.post("/api/topscholar/sync", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const cfg = getTopscholarConfig(account);
  if (!cfg.ragEnabled) {
    return res.status(400).json({ error: "TopScholar RAG mode is not enabled for this account." });
  }

  // Sync mode: 'sample' (regular API, instant, first N chunks) or 'full' (Batch API, async).
  const mode: "sample" | "full" = req.body?.mode === "sample" ? "sample" : "full";
  // Set only by the failed-row action. The ingestion path is always
  // chunk-aware, but echoing this intent lets the UI explain that a formerly
  // oversized source is being rebuilt rather than blindly retried.
  const rebuild = req.body?.rebuild === true;
  let sampleLimit = DEFAULT_SAMPLE_LIMIT;
  if (mode === "sample") {
    const raw = Number(req.body?.sampleLimit);
    if (Number.isFinite(raw) && raw > 0) sampleLimit = Math.min(Math.floor(raw), 500);
  }

  // Full (Batch API) requires an OpenAI key and a configured store; sample also needs the key.
  if (!account.openaiApiKey) {
    return res.status(400).json({ error: "An OpenAI API key must be configured for this account before syncing." });
  }

  // Single-cp sync: a cpId is required. Resolve its owning Plan ID so we can fetch
  // ONLY that cp_id's bundle and embed just it (not the whole plan). Prefer an
  // explicit planId, else the persisted plan->cp resolution, the cp->label mapping,
  // and finally the deprecated singular lastCpId on the plan list as a fallback.
  const cpId = (req.body?.cpId || "").trim();
  if (!cpId) {
    return res.status(400).json({ error: "A cpId is required." });
  }
  let planId = (req.body?.planId || "").trim();
  if (!planId) {
    const [resolution] = await db
      .select({ planId: topscholarPlanCpResolutions.planId })
      .from(topscholarPlanCpResolutions)
      .where(and(eq(topscholarPlanCpResolutions.businessAccountId, businessAccountId), eq(topscholarPlanCpResolutions.cpId, cpId)))
      .orderBy(sql`${topscholarPlanCpResolutions.lastResolvedAt} DESC NULLS LAST`, desc(topscholarPlanCpResolutions.updatedAt))
      .limit(1);
    if (resolution?.planId) {
      planId = resolution.planId;
    } else {
      const [mapping] = await db
        .select({ planId: topscholarCpMappings.planId })
        .from(topscholarCpMappings)
        .where(and(eq(topscholarCpMappings.businessAccountId, businessAccountId), eq(topscholarCpMappings.cpId, cpId)));
      if (mapping?.planId) {
        planId = mapping.planId;
      } else {
        const [plan] = await db
          .select({ planId: topscholarPlanIds.planId })
          .from(topscholarPlanIds)
          .where(and(eq(topscholarPlanIds.businessAccountId, businessAccountId), eq(topscholarPlanIds.lastCpId, cpId)));
        if (plan?.planId) planId = plan.planId;
      }
    }
  }
  if (!planId) {
    return res.status(400).json({ error: "Couldn't resolve the Plan ID for that cp_id. Re-resolve the plan and try again." });
  }

  try {
    // External client-store writes use the same durable, account-wide-limited
    // worker as Plan syncs. This prevents a rapid series of manual Full clicks
    // (or "Resync selected") from creating fire-and-forget MongoDB workers.
    if (mode === "full" && cfg.contentDbUrl) {
      const run = await enqueueSingleCpSyncRun({ businessAccountId, planId, cpId });
      return res.status(202).json({ success: true, queued: true, rebuild, run });
    }
    const result = await ingestSingleCp({ businessAccountId, cpId, planId, cfg, mode, sampleLimit });
    res.json({ success: true, rebuild, result });
  } catch (error: any) {
    console.error("[TopScholar Sync] Failed:", error);
    res.status(500).json({ error: error?.message || "Sync failed." });
  }
});

// Cancels any in-flight sync for a cp_id. MUST be called while already holding the
// per-cp advisory lock (withCpLock) so it cannot race the poller's landing (completeJob).
// Best-effort: cancels in-flight OpenAI batch(es), marks the embed job + sync row
// 'cancelled', and clears staging so the poller cannot resurrect it. Returns whether a
// sync row existed and whether it was already terminal (idempotent for the caller).
async function cancelCpSyncLocked(
  businessAccountId: string,
  cpId: string,
): Promise<{ existed: boolean; alreadyTerminal: boolean; status: string | null }> {
  const [row] = await db
    .select()
    .from(topscholarContentSync)
    .where(and(eq(topscholarContentSync.businessAccountId, businessAccountId), eq(topscholarContentSync.cpId, cpId)));

  if (!row) return { existed: false, alreadyTerminal: false, status: null };
  if (row.status !== "syncing") return { existed: true, alreadyTerminal: true, status: row.status };

  // Best-effort cancel of the underlying OpenAI batch job (full syncs only). We look the
  // job up by (business, cp_id) rather than via row.embedJobId: a full sync stages + submits
  // its batches and creates the job row BEFORE writing embedJobId back onto the sync row, so
  // during that brief submission window embedJobId is still null even though a job exists.
  // ingestFullBatch keeps at most one non-terminal job per cp_id, so this is unambiguous.
  const [job] = await db
    .select()
    .from(topscholarEmbedJobs)
    .where(
      and(
        eq(topscholarEmbedJobs.businessAccountId, businessAccountId),
        eq(topscholarEmbedJobs.cpId, cpId),
        inArray(topscholarEmbedJobs.status, ["preparing", "submitted", "in_progress"]),
      ),
    )
    .orderBy(desc(topscholarEmbedJobs.createdAt));
  if (job) {
    for (const b of job.batches) {
      if (b.batchId) await cancelBatch(businessAccountId, b.batchId);
    }
    // Set the job 'cancelled' FIRST: this is the signal both the poller (advanceJob) and the
    // in-flight ingestFullBatch submit-update guard on, so neither resurrects it afterwards.
    await db
      .update(topscholarEmbedJobs)
      .set({ status: "cancelled", error: "Cancelled by admin.", updatedAt: new Date() })
      .where(eq(topscholarEmbedJobs.id, job.id));
    // Drop staged chunks for this job so nothing can be landed later.
    await db.delete(topscholarEmbedStaging).where(eq(topscholarEmbedStaging.jobId, job.id));
  }

  // Detach + mark cancelled. Guard on status='syncing' so a concurrent newer run isn't clobbered.
  await db
    .update(topscholarContentSync)
    .set({ status: "cancelled", lastError: "Cancelled by admin.", embedJobId: null, updatedAt: new Date() })
    .where(
      and(
        eq(topscholarContentSync.businessAccountId, businessAccountId),
        eq(topscholarContentSync.cpId, cpId),
        eq(topscholarContentSync.status, "syncing"),
      ),
    );

  return { existed: true, alreadyTerminal: false, status: "cancelled" };
}

// Deletes a single cp_id's embedded content from the configured store (pgvector or
// MongoDB) and removes its sync-status row, after first cancelling any in-flight sync.
// Wrapped in the per-cp advisory lock so a concurrent sync (or its background poller
// landing) cannot re-create chunks after we delete them. Idempotent — deleting
// already-absent content still succeeds.
async function deleteCpContent(
  cfg: ReturnType<typeof getTopscholarConfig>,
  businessAccountId: string,
  cpId: string,
): Promise<void> {
  await withCpLock(businessAccountId, cpId, async () => {
    await cancelCpSyncLocked(businessAccountId, cpId);
    await deleteCpChunks(cfg, businessAccountId, cpId);
    await db
      .delete(topscholarContentSync)
      .where(and(eq(topscholarContentSync.businessAccountId, businessAccountId), eq(topscholarContentSync.cpId, cpId)));
  });
}

// Every cp_id known to belong to a Plan ID — from the resolution snapshots and the
// cp->plan mappings (deduped). Used to purge a whole plan's content. Note: content is
// keyed by (business, cp_id) only, so a cp_id shared across plans has a single chunk set.
async function resolveCpIdsForPlan(businessAccountId: string, planId: string): Promise<string[]> {
  const [resolved, mapped] = await Promise.all([
    db
      .select({ cpId: topscholarPlanCpResolutions.cpId })
      .from(topscholarPlanCpResolutions)
      .where(and(eq(topscholarPlanCpResolutions.businessAccountId, businessAccountId), eq(topscholarPlanCpResolutions.planId, planId))),
    db
      .select({ cpId: topscholarCpMappings.cpId })
      .from(topscholarCpMappings)
      .where(and(eq(topscholarCpMappings.businessAccountId, businessAccountId), eq(topscholarCpMappings.planId, planId))),
  ]);
  return Array.from(new Set([...resolved.map((r) => r.cpId), ...mapped.map((m) => m.cpId)]));
}

// Cancel an in-progress sync for a single cp_id. Best-effort: cancels any in-flight
// OpenAI batch(es), marks the embed job + sync row 'cancelled', and clears staging so
// the background poller cannot resurrect it. Idempotent — a no-op (still 200) if the
// row is already terminal (completed/failed/cancelled) or not currently syncing.
router.post("/api/topscholar/sync/cancel", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const cpId = (req.body?.cpId || "").trim();
  if (!cpId) return res.status(400).json({ error: "A cpId is required." });

  // Direct-to-client-DB sync (external Content DB configured): the full sync runs in-process
  // in the BACKGROUND and holds the per-cp advisory lock for its WHOLE run. There is no
  // OpenAI batch or staging to clean up — cancellation is purely a signal the running worker
  // polls. So we flip the sync row to 'cancelled' WITHOUT taking the lock (taking it would
  // block until the run finishes, defeating cancellation). The worker observes the flag at
  // its next page boundary and stops, leaving any partial content for the next re-sync.
  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });
  const cancelCfg = getTopscholarConfig(account);
  if (cancelCfg.contentDbUrl) {
    const [existing] = await db
      .select({ status: topscholarContentSync.status })
      .from(topscholarContentSync)
      .where(and(eq(topscholarContentSync.businessAccountId, businessAccountId), eq(topscholarContentSync.cpId, cpId)));
    if (!existing) return res.status(404).json({ error: "No sync found for that cp_id." });
    if (existing.status !== "syncing") {
      return res.json({ success: true, status: existing.status, alreadyTerminal: true });
    }
    await db
      .update(topscholarContentSync)
      .set({ status: "cancelled", lastError: "Cancelled by admin.", embedJobId: null, updatedAt: new Date() })
      .where(and(
        eq(topscholarContentSync.businessAccountId, businessAccountId),
        eq(topscholarContentSync.cpId, cpId),
        eq(topscholarContentSync.status, "syncing"),
      ));
    return res.json({ success: true, status: "cancelled" });
  }

  // Batch path (local pgvector stand-in): serialize the ENTIRE cancel against the poller's
  // landing (completeJob), which holds the same per-cp advisory lock. This guarantees we
  // never delete staging or flip the job while a landing is mid-flight (which could otherwise
  // cause a partial, destructive chunk replacement). Inside the lock either no landing is
  // running, or it has fully finished — so we re-read the sync row here for the authoritative
  // decision.
  const outcome = await withCpLock<{ http: number; body: any }>(businessAccountId, cpId, async () => {
    const r = await cancelCpSyncLocked(businessAccountId, cpId);
    if (!r.existed) return { http: 404, body: { error: "No sync found for that cp_id." } };
    if (r.alreadyTerminal) {
      // Already terminal (possibly a landing finished while we waited for the lock) — nothing
      // to cancel. Report current state idempotently.
      return { http: 200, body: { success: true, status: r.status, alreadyTerminal: true } };
    }
    return { http: 200, body: { success: true, status: "cancelled" } };
  });

  res.status(outcome.http).json(outcome.body);
});

// ---- Delete extracted content ---------------------------------------------

// Delete one cp_id's embedded content so the chatbot immediately stops using it.
// Cancels any in-flight sync first, then removes chunks from the configured store
// (pgvector or MongoDB) and clears the sync-status row. Idempotent. Primarily driven
// from the Ext. Content page's per-pack delete.
router.post("/api/topscholar/content/delete-cp", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const cpId = (req.body?.cpId || "").trim();
  if (!cpId) return res.status(400).json({ error: "A cpId is required." });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });
  const cfg = getTopscholarConfig(account);

  try {
    await deleteCpContent(cfg, businessAccountId, cpId);
    res.json({ success: true });
  } catch (error: any) {
    console.error("[TopScholar DeleteCp] Failed:", error);
    res.status(500).json({ error: error?.message || "Failed to delete content." });
  }
});

// Delete ALL embedded content for every cp_id resolved/mapped under a Plan ID, leaving
// the plan entry itself in the master list. Driven from the Content Sync page's per-plan
// "Delete content" action.
router.post("/api/topscholar/content/delete-plan", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const planId = (req.body?.planId || "").trim();
  if (!planId) return res.status(400).json({ error: "A planId is required." });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });
  const cfg = getTopscholarConfig(account);

  try {
    const cpIds = await resolveCpIdsForPlan(businessAccountId, planId);
    for (const cpId of cpIds) {
      await deleteCpContent(cfg, businessAccountId, cpId);
    }
    res.json({ success: true, purgedCpCount: cpIds.length });
  } catch (error: any) {
    console.error("[TopScholar DeletePlan] Failed:", error);
    res.status(500).json({ error: error?.message || "Failed to delete content." });
  }
});

// ---- Plan IDs (master list) + Sync now ------------------------------------

router.get("/api/topscholar/plan-ids", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { limit, offset } = parsePageParams(req, 25, 200);
  const q = parseSearch(req);
  const embeddingStatus = parsePlanEmbeddingFilter(req);

  const baseWhere = q
    ? and(eq(topscholarPlanIds.businessAccountId, businessAccountId), ilike(topscholarPlanIds.planId, `%${q}%`))
    : eq(topscholarPlanIds.businessAccountId, businessAccountId);
  const completedWhere = completedPlanEmbeddingCondition(businessAccountId);
  const statusWhere = embeddingStatus === "completed"
    ? completedWhere
    : embeddingStatus === "pending"
      ? sql`NOT (${completedWhere})`
      : undefined;
  const where = statusWhere ? and(baseWhere, statusWhere) : baseWhere;

  const [rows, totalRow, allTotalRow, completedTotalRow] = await Promise.all([
    db
      .select()
      .from(topscholarPlanIds)
      .where(where)
      .orderBy(desc(topscholarPlanIds.updatedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(topscholarPlanIds)
      .where(where),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(topscholarPlanIds)
      .where(baseWhere),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(topscholarPlanIds)
      .where(and(baseWhere, completedWhere)),
  ]);
  const total = totalRow[0]?.count ?? 0;
  const all = allTotalRow[0]?.count ?? 0;
  const completed = completedTotalRow[0]?.count ?? 0;

  // Annotate each plan in the page with how many cp_ids it has resolved, so the UI
  // can show a compact summary without loading the cp rows. One grouped query over
  // just the plans on this page (not the whole account).
  const pagePlanIds = rows.map((r) => r.planId);
  const countByPlan = new Map<string, number>();
  if (pagePlanIds.length > 0) {
    const counts = await db
      .select({ planId: topscholarPlanCpResolutions.planId, count: sql<number>`count(*)::int` })
      .from(topscholarPlanCpResolutions)
      .where(and(eq(topscholarPlanCpResolutions.businessAccountId, businessAccountId), inArray(topscholarPlanCpResolutions.planId, pagePlanIds)))
      .groupBy(topscholarPlanCpResolutions.planId);
    for (const c of counts) countByPlan.set(c.planId, c.count);
  }
  const enriched = rows.map((r) => ({ ...r, resolvedCpCount: countByPlan.get(r.planId) ?? 0 }));

  res.json({
    rows: enriched,
    total,
    counts: { all, completed, pending: Math.max(0, all - completed) },
  });
});

// Replace the saved master list with the supplied set. Accepts { planIds: string[] }
// or { text: "one-per-line" }. Plans dropped from the list are removed.
router.put("/api/topscholar/plan-ids", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  let raw: string[] = [];
  if (Array.isArray(req.body?.planIds)) {
    raw = req.body.planIds.map((p: any) => String(p));
  } else if (typeof req.body?.text === "string") {
    raw = req.body.text.split(/[\r\n,]+/);
  } else {
    return res.status(400).json({ error: "Provide 'planIds' (array) or 'text' (newline/comma separated)." });
  }
  const planIds = Array.from(new Set(raw.map((p) => p.trim()).filter(Boolean)));

  await db.transaction(async (tx) => {
    if (planIds.length === 0) {
      await tx.delete(topscholarPlanIds).where(eq(topscholarPlanIds.businessAccountId, businessAccountId));
      // Drop every cached resolution snapshot — there are no plans left to sync.
      await tx.delete(topscholarPlanCpResolutions).where(eq(topscholarPlanCpResolutions.businessAccountId, businessAccountId));
      return;
    }
    // Remove plans no longer in the list.
    const existing = await tx
      .select({ planId: topscholarPlanIds.planId })
      .from(topscholarPlanIds)
      .where(eq(topscholarPlanIds.businessAccountId, businessAccountId));
    const toDelete = existing.map((e) => e.planId).filter((p) => !planIds.includes(p));
    if (toDelete.length > 0) {
      await tx
        .delete(topscholarPlanIds)
        .where(and(eq(topscholarPlanIds.businessAccountId, businessAccountId), inArray(topscholarPlanIds.planId, toDelete)));
      // Prune stale resolution snapshots for the dropped plans so the admin UI's
      // cp list never offers cp_ids that no longer belong to the saved plan list.
      await tx
        .delete(topscholarPlanCpResolutions)
        .where(and(eq(topscholarPlanCpResolutions.businessAccountId, businessAccountId), inArray(topscholarPlanCpResolutions.planId, toDelete)));
    }
    // Insert any new plans (keep status of existing ones).
    for (const planId of planIds) {
      await tx
        .insert(topscholarPlanIds)
        .values({ businessAccountId, planId })
        .onConflictDoNothing({ target: [topscholarPlanIds.businessAccountId, topscholarPlanIds.planId] });
    }
  });

  const rows = await db
    .select()
    .from(topscholarPlanIds)
    .where(eq(topscholarPlanIds.businessAccountId, businessAccountId))
    .orderBy(desc(topscholarPlanIds.updatedAt));
  res.json({ success: true, count: rows.length, rows });
});

// Add one or more plans to the saved master list WITHOUT removing any existing
// plans. Accepts { planIds: string[] } or { text: "newline/comma separated" }.
// Idempotent per plan (onConflictDoNothing) — re-adding an existing plan is a no-op
// and preserves its status/resolutions. Designed for the paginated UI where the
// whole list isn't available client-side to send back via PUT.
router.post("/api/topscholar/plan-ids/add", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  let raw: string[] = [];
  if (Array.isArray(req.body?.planIds)) {
    raw = req.body.planIds.map((p: any) => String(p));
  } else if (typeof req.body?.text === "string") {
    raw = req.body.text.split(/[\r\n,]+/);
  } else {
    return res.status(400).json({ error: "Provide 'planIds' (array) or 'text' (newline/comma separated)." });
  }
  const planIds = Array.from(new Set(raw.map((p) => p.trim()).filter(Boolean)));
  if (planIds.length === 0) {
    return res.status(400).json({ error: "No Plan IDs provided." });
  }

  // Single bulk insert (not a per-row loop) so pasting hundreds of Plan IDs is one
  // round-trip. onConflictDoNothing keeps it idempotent — re-adding existing plans
  // is a no-op and preserves their status/resolutions.
  await db
    .insert(topscholarPlanIds)
    .values(planIds.map((planId) => ({ businessAccountId, planId })))
    .onConflictDoNothing({ target: [topscholarPlanIds.businessAccountId, topscholarPlanIds.planId] });

  res.json({ success: true, requested: planIds.length });
});

// Remove a single plan from the saved master list and prune its resolution
// snapshots, leaving every other plan untouched. Also wipes the plan's embedded
// content (every cp_id under it) so the chatbot stops using it.
router.post("/api/topscholar/plan-ids/remove", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const planId = (req.body?.planId || "").trim();
  if (!planId) return res.status(400).json({ error: "A planId is required." });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });
  const cfg = getTopscholarConfig(account);

  // Purge the plan's embedded content FIRST (while the resolution snapshots still exist
  // so we can enumerate its cp_ids), then drop the plan entry + its snapshots.
  const cpIds = await resolveCpIdsForPlan(businessAccountId, planId);
  for (const cpId of cpIds) {
    await deleteCpContent(cfg, businessAccountId, cpId);
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(topscholarPlanIds)
      .where(and(eq(topscholarPlanIds.businessAccountId, businessAccountId), eq(topscholarPlanIds.planId, planId)));
    await tx
      .delete(topscholarPlanCpResolutions)
      .where(and(eq(topscholarPlanCpResolutions.businessAccountId, businessAccountId), eq(topscholarPlanCpResolutions.planId, planId)));
  });

  res.json({ success: true, purgedCpCount: cpIds.length });
});

// Recent durable Plan runs. The UI uses this instead of keeping a full Plan
// request open while the CMS resolves and CP IDs embed in the client database.
router.get("/api/topscholar/plan-runs", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });
  const planId = typeof req.query?.planId === "string" ? req.query.planId.trim() : undefined;
  try {
    const runs = await listPlanSyncRuns(businessAccountId, planId);
    res.json({ runs });
  } catch (error: any) {
    console.error("[TopScholar PlanRuns] Failed:", error);
    res.status(500).json({ error: error?.message || "Couldn't load Plan sync runs." });
  }
});

router.post("/api/topscholar/plan-runs/:runId/cancel", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const run = await cancelPlanSyncRun(businessAccountId, req.params.runId);
    if (!run) return res.status(404).json({ error: "Plan sync run not found." });
    res.json({ success: true, run });
  } catch (error: any) {
    console.error("[TopScholar PlanRuns] Cancel failed:", error);
    res.status(500).json({ error: error?.message || "Couldn't cancel Plan sync." });
  }
});

router.post("/api/topscholar/plan-runs/:runId/retry-failed", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const result = await retryFailedPlanSyncItems(businessAccountId, req.params.runId);
    if (!result) return res.status(404).json({ error: "Plan sync run not found." });
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error("[TopScholar PlanRuns] Retry failed:", error);
    res.status(500).json({ error: error?.message || "Couldn't retry failed CP IDs." });
  }
});

// Sync now: a full Plan sync is a durable run. It resolves the Plan's current
// CP IDs first, then processes them under the worker's bounded concurrency. A
// sample sync stays request-driven because it is intentionally small and fast.
router.post("/api/topscholar/sync-now", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const cfg = getTopscholarConfig(account);
  if (!cfg.ragEnabled) {
    return res.status(400).json({ error: "TopScholar RAG mode is not enabled for this account." });
  }
  if (!account.openaiApiKey) {
    return res.status(400).json({ error: "An OpenAI API key must be configured for this account before syncing." });
  }

  const mode: "sample" | "full" = req.body?.mode === "sample" ? "sample" : req.body?.mode === "full" ? "full" : cfg.syncMode;
  let sampleLimit = DEFAULT_SAMPLE_LIMIT;
  if (mode === "sample") {
    const rawLimit = Number(req.body?.sampleLimit);
    if (Number.isFinite(rawLimit) && rawLimit > 0) sampleLimit = Math.min(Math.floor(rawLimit), 500);
  }

  let planIds: string[];
  if (Array.isArray(req.body?.planIds) && req.body.planIds.length > 0) {
    planIds = req.body.planIds.map((p: any) => String(p).trim()).filter(Boolean);
  } else {
    const saved = await db
      .select({ planId: topscholarPlanIds.planId })
      .from(topscholarPlanIds)
      .where(and(eq(topscholarPlanIds.businessAccountId, businessAccountId), eq(topscholarPlanIds.enabled, "true")));
    planIds = saved.map((s) => s.planId);
  }
  if (planIds.length === 0) {
    return res.status(400).json({ error: "No Plan IDs to sync. Save a Plan ID list first." });
  }

  try {
    if (mode === "full") {
      const runs = await enqueuePlanSyncRuns({ businessAccountId, planIds });
      return res.status(202).json({
        success: true,
        queued: true,
        mode,
        planCount: planIds.length,
        runs,
      });
    }
    const results = await ingestPlanIds({ businessAccountId, planIds, cfg, mode, sampleLimit });
    res.json({ success: true, mode, planCount: planIds.length, results });
  } catch (error: any) {
    console.error("[TopScholar SyncNow] Failed:", error);
    res.status(500).json({ error: error?.message || "Sync failed." });
  }
});

// Bulk Plan sync: choose the scope on the server, then enqueue one durable full
// run per selected Plan. This intentionally returns after queuing only; resolving
// and embedding run under the worker's account lease instead of in the HTTP request.
router.post("/api/topscholar/plan-bulk-sync", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const cfg = getTopscholarConfig(account);
  if (!cfg.ragEnabled) {
    return res.status(400).json({ error: "TopScholar RAG mode is not enabled for this account." });
  }
  if (!account.openaiApiKey) {
    return res.status(400).json({ error: "An OpenAI API key must be configured for this account before syncing." });
  }

  const scope = req.body?.scope;
  if (scope !== "pending" && scope !== "all") {
    return res.status(400).json({ error: "Bulk sync scope must be 'pending' or 'all'." });
  }
  const baseWhere = and(
    eq(topscholarPlanIds.businessAccountId, businessAccountId),
    eq(topscholarPlanIds.enabled, "true"),
  );
  const where = scope === "pending"
    ? and(baseWhere, sql`NOT (${completedPlanEmbeddingCondition(businessAccountId)})`)
    : baseWhere;
  const selectedPlans = await db
    .select({ planId: topscholarPlanIds.planId })
    .from(topscholarPlanIds)
    .where(where);
  const planIds = selectedPlans.map((plan) => plan.planId);

  if (planIds.length === 0) {
    return res.status(400).json({
      error: scope === "pending"
        ? "There are no pending Plan IDs to sync."
        : "No enabled Plan IDs are available to sync.",
    });
  }

  try {
    const runs = await enqueuePlanSyncRuns({ businessAccountId, planIds });
    res.status(202).json({
      success: true,
      queued: true,
      mode: "full",
      scope,
      planCount: planIds.length,
      runs,
    });
  } catch (error: any) {
    console.error("[TopScholar BulkPlanSync] Failed:", error);
    res.status(500).json({ error: error?.message || "Couldn't queue the Plan sync." });
  }
});

// ---- Plan -> cp_id resolution ---------------------------------------------

// Saved plan->cp resolution snapshot (one row per plan/cp_id pair) so the admin
// can list every cp_id under each plan, with content counts, without re-fetching.
router.get("/api/topscholar/resolutions", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { limit, offset } = parsePageParams(req, 50, 500);
  const q = parseSearch(req);
  const planId = typeof req.query?.planId === "string" ? req.query.planId.trim() : "";

  const conds = [eq(topscholarPlanCpResolutions.businessAccountId, businessAccountId)];
  if (planId) conds.push(eq(topscholarPlanCpResolutions.planId, planId));
  if (q) {
    conds.push(
      sql`(${topscholarPlanCpResolutions.cpId} ILIKE ${`%${q}%`} OR ${topscholarPlanCpResolutions.cpName} ILIKE ${`%${q}%`} OR ${topscholarPlanCpResolutions.label} ILIKE ${`%${q}%`})`,
    );
  }
  const where = and(...conds);

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(topscholarPlanCpResolutions)
      .where(where)
      .orderBy(sql`${topscholarPlanCpResolutions.lastResolvedAt} DESC NULLS LAST`, desc(topscholarPlanCpResolutions.updatedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(topscholarPlanCpResolutions)
      .where(where),
  ]);

  const cpIds = rows.map((row) => row.cpId);
  if (cpIds.length === 0) return res.json({ rows: [], total: totalRow[0]?.count ?? 0 });

  const [syncRows, latestRunRows] = await Promise.all([
    db
      .select({
        cpId: topscholarContentSync.cpId,
        status: topscholarContentSync.status,
        lastError: topscholarContentSync.lastError,
      })
      .from(topscholarContentSync)
      .where(and(
        eq(topscholarContentSync.businessAccountId, businessAccountId),
        inArray(topscholarContentSync.cpId, cpIds),
      )),
    planId
      ? db
        .select({ id: topscholarPlanRuns.id })
        .from(topscholarPlanRuns)
        .where(and(
          eq(topscholarPlanRuns.businessAccountId, businessAccountId),
          eq(topscholarPlanRuns.planId, planId),
        ))
        .orderBy(desc(topscholarPlanRuns.updatedAt))
        .limit(1)
      : Promise.resolve([]),
  ]);
  const syncByCpId = new Map(syncRows.map((row) => [row.cpId, row]));
  const latestRunId = latestRunRows[0]?.id;
  const itemRows = latestRunId
    ? await db
      .select({
        cpId: topscholarPlanRunItems.cpId,
        status: topscholarPlanRunItems.status,
        error: topscholarPlanRunItems.error,
      })
      .from(topscholarPlanRunItems)
      .where(and(
        eq(topscholarPlanRunItems.runId, latestRunId),
        inArray(topscholarPlanRunItems.cpId, cpIds),
      ))
    : [];
  const itemByCpId = new Map(itemRows.map((row) => [row.cpId, row]));

  const rowsWithSyncStatus = rows.map((row) => {
    const sync = syncByCpId.get(row.cpId);
    const item = itemByCpId.get(row.cpId);
    const activeItemStatus = item?.status === "queued" || item?.status === "running" || item?.status === "submitted";
    const syncStatus = activeItemStatus
      ? (item?.status === "queued" ? "queued" : "syncing")
      : (sync?.status || item?.status || "idle");
    const syncError = sync?.lastError || item?.error || null;
    return {
      ...row,
      syncStatus,
      syncError,
      syncRetryable: syncStatus !== "failed" || !isNonRetryableEmbeddingFailure(syncError),
    };
  });

  res.json({ rows: rowsWithSyncStatus, total: totalRow[0]?.count ?? 0 });
});

// Fetch-only resolve: takes one or more Plan IDs (explicit array/text, else the
// saved master list), calls the Content Bundle API, returns the cp_ids grouped
// under each plan with counts + labels, and refreshes the persisted resolution
// rows + cp->label mappings. Embeds nothing.
router.post("/api/topscholar/resolve", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const cfg = getTopscholarConfig(account);
  if (!cfg.ragEnabled) {
    return res.status(400).json({ error: "TopScholar RAG mode is not enabled for this account." });
  }

  let planIds: string[];
  if (Array.isArray(req.body?.planIds)) {
    planIds = req.body.planIds.map((p: any) => String(p).trim()).filter(Boolean);
  } else if (typeof req.body?.text === "string") {
    planIds = req.body.text.split(/[\r\n,]+/).map((p: string) => p.trim()).filter(Boolean);
  } else {
    const saved = await db
      .select({ planId: topscholarPlanIds.planId })
      .from(topscholarPlanIds)
      .where(eq(topscholarPlanIds.businessAccountId, businessAccountId));
    planIds = saved.map((s) => s.planId);
  }
  planIds = Array.from(new Set(planIds));
  if (planIds.length === 0) {
    return res.status(400).json({ error: "Provide one or more Plan IDs to resolve." });
  }

  try {
    const resolutions = await resolvePlans({ businessAccountId, planIds, cfg });
    res.json({ success: true, resolutions });
  } catch (error: any) {
    console.error("[TopScholar Resolve] Failed:", error);
    res.status(500).json({ error: error?.message || "Resolve failed." });
  }
});

// ---- Extracted content viewer (read-only) ---------------------------------

// All three endpoints are hard-gated by topscholarGuards (auth + role + single-tenant)
// and scoped by businessAccountId. They read through the same content pool the sync
// writes to and never expose the embedding vector column.

router.get("/api/topscholar/content/overview", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const cfg = getTopscholarConfig(account);

  try {
    const packs = cfg.storeType === "mongodb"
      ? await getMongoContentOverview(cfg, businessAccountId)
      : await getContentOverview(cfg, businessAccountId);
    res.json({ packs });
  } catch (error: any) {
    console.error("[TopScholar Content] overview failed:", error);
    res.status(500).json({ error: error?.message || "Failed to load content overview." });
  }
});

router.get("/api/topscholar/content/chapters", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const cpId = String(req.query.cpId || "").trim();
  if (!cpId) return res.status(400).json({ error: "cpId is required." });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const cfg = getTopscholarConfig(account);

  try {
    const chapters = cfg.storeType === "mongodb"
      ? await getMongoChapters(cfg, businessAccountId, cpId)
      : await getChapters(cfg, businessAccountId, cpId);
    res.json({ chapters });
  } catch (error: any) {
    console.error("[TopScholar Content] chapters failed:", error);
    res.status(500).json({ error: error?.message || "Failed to load chapters." });
  }
});

router.get("/api/topscholar/content/chunks", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const cpId = String(req.query.cpId || "").trim();
  if (!cpId) return res.status(400).json({ error: "cpId is required." });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const cfg = getTopscholarConfig(account);

  const contentType = String(req.query.contentType || "").trim() || undefined;
  const chapterRaw = req.query.chapter;
  const chapter = chapterRaw === undefined ? undefined : String(chapterRaw);
  const q = String(req.query.q || "").trim() || undefined;
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 50;

  try {
    const result = cfg.storeType === "mongodb"
      ? await getMongoChunks(cfg, businessAccountId, { cpId, contentType, chapter, q, page, pageSize })
      : await getChunks(cfg, businessAccountId, { cpId, contentType, chapter, q, page, pageSize });
    res.json(result);
  } catch (error: any) {
    console.error("[TopScholar Content] chunks failed:", error);
    res.status(500).json({ error: error?.message || "Failed to load content." });
  }
});

// ---- Students (bound conversations) ---------------------------------------

router.get("/api/topscholar/students", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const rows = await db
    .select({
      id: conversations.id,
      studentName: conversations.studentName,
      studentId: conversations.studentId,
      cpId: conversations.topscholarCpId,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(and(eq(conversations.businessAccountId, businessAccountId), isNotNull(conversations.topscholarCpId)))
    .orderBy(desc(conversations.updatedAt))
    .limit(200);

  const mappings = await db
    .select()
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));
  const byCp = new Map(mappings.map((m) => [m.cpId, m]));

  const students = rows.map((r) => {
    const m = r.cpId ? byCp.get(r.cpId) : undefined;
    const label = m?.label || buildLabel(m?.board, m?.medium, m?.grade) || (r.cpId ? "Unmapped curriculum" : "");
    return {
      conversationId: r.id,
      studentName: r.studentName,
      studentId: r.studentId,
      cpId: r.cpId,
      curriculumLabel: label,
      board: m?.board ?? null,
      medium: m?.medium ?? null,
      grade: m?.grade ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });

  res.json(students);
});

function sameScopeValue(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;
}

/**
 * Metadata-only read model for Tester navigation. A row becomes eligible only
 * after its CP has completed a content-store sync; deleting content also removes
 * that sync row. This avoids grouping every embedding document just to build
 * dropdowns, while leaving the narrow chapter check against the active content
 * store in place before a preview is authorized.
 */
async function listTesterScopeMetadata(businessAccountId: string): Promise<StoredCurriculumScope[]> {
  const rows = await db
    .select({
      cpId: topscholarCpMappings.cpId,
      board: topscholarCpMappings.board,
      medium: topscholarCpMappings.medium,
      grade: topscholarCpMappings.grade,
      subject: topscholarCpMappings.subject,
      cpName: topscholarCpMappings.cpName,
    })
    .from(topscholarCpMappings)
    .innerJoin(
      topscholarContentSync,
      and(
        eq(topscholarContentSync.businessAccountId, topscholarCpMappings.businessAccountId),
        eq(topscholarContentSync.cpId, topscholarCpMappings.cpId),
      ),
    )
    .where(
      and(
        eq(topscholarCpMappings.businessAccountId, businessAccountId),
        eq(topscholarContentSync.status, "completed"),
        gt(topscholarContentSync.chunkCount, 0),
      ),
    );

  return rows
    .map((row) => ({
      cpId: row.cpId.trim(),
      board: row.board?.trim() || "",
      medium: row.medium?.trim() || "",
      grade: row.grade?.trim() || "",
      subject: row.subject?.trim() || row.cpName?.trim() || "",
    }))
    .filter((row) => !!(row.cpId && row.board && row.medium && row.grade && row.subject));
}

function storedCpIdsForScope(
  scopes: StoredCurriculumScope[],
  selection: { board: string; medium: string; grade: string; subject: string },
): string[] {
  return Array.from(
    new Set(
      scopes
        .filter((scope) =>
          sameScopeValue(scope.board, selection.board) &&
          sameScopeValue(scope.medium, selection.medium) &&
          sameScopeValue(scope.grade, selection.grade) &&
          sameScopeValue(scope.subject, selection.subject),
        )
        .map((scope) => scope.cpId),
    ),
  );
}

router.get("/api/topscholar/scope-options", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  let rows: StoredCurriculumScope[];
  try {
    rows = await listTesterScopeMetadata(businessAccountId);
  } catch (error) {
    console.error("[TopScholar] Tester scope lookup failed:", error);
    return res.status(503).json({
      error: "Could not load curriculum scope from the configured content store. Check the content-store connection and try again.",
    });
  }

  // Group by the (board, medium, grade) tuple, de-duplicating cp_ids per combo.
  // Every row is a physically stored client-content scope, so a mapping row with
  // no retrievable chunks can never appear in this Tester dropdown.
  const combos = new Map<
    string,
    {
      board: string;
      medium: string;
      grade: string;
      cpIds: Set<string>;
      subjects: Map<string, Set<string>>;
    }
  >();
  for (const r of rows) {
    const board = r.board.trim();
    const medium = r.medium.trim();
    const grade = r.grade.trim();
    const subject = r.subject.trim();
    const key = `${board.toLowerCase()}|${medium.toLowerCase()}|${grade.toLowerCase()}`;
    let combo = combos.get(key);
    if (!combo) {
      combo = { board, medium, grade, cpIds: new Set(), subjects: new Map() };
      combos.set(key, combo);
    }
    combo.cpIds.add(r.cpId);
    if (subject) {
      let subjCps = combo.subjects.get(subject);
      if (!subjCps) {
        subjCps = new Set();
        combo.subjects.set(subject, subjCps);
      }
      subjCps.add(r.cpId);
    }
  }

  const result = Array.from(combos.values())
    .map((c) => ({
      board: c.board,
      medium: c.medium,
      grade: c.grade,
      label: buildLabel(c.board, c.medium, c.grade),
      cpCount: c.cpIds.size,
      subjects: Array.from(c.subjects.entries())
        .map(([name, cpIds]) => ({ name, cpCount: cpIds.size }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) =>
      a.board.localeCompare(b.board) ||
      a.medium.localeCompare(b.medium) ||
      a.grade.localeCompare(b.grade));

  res.json(result);
});

// Widget tester: list the distinct chapter names available for a fully-specified
// scope (board + medium + grade + subject). The tester uses this to build the
// MANDATORY chapter dropdown that cascades from the subject selection. Works for
// both pgvector and MongoDB content stores. Returns an empty list when the scope
// resolves to no cp_id(s) so the UI can show "no chapters — bot will refuse".
router.get("/api/topscholar/scope-chapters", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const board = String(req.query.board || "").trim();
  const medium = String(req.query.medium || "").trim();
  const grade = String(req.query.grade || "").trim();
  const subject = String(req.query.subject || "").trim();
  if (!board || !medium || !grade || !subject) {
    return res.status(400).json({ error: "board, medium, grade and subject are all required." });
  }

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  try {
    const cfg = getTopscholarConfig(account);
    const storedScopes = await listTesterScopeMetadata(businessAccountId);
    const cpIds = storedCpIdsForScope(storedScopes, { board, medium, grade, subject });
    if (cpIds.length === 0) return res.json({ chapters: [] });

    const chapters = isMongoConnectionString(cfg.contentDbUrl)
      ? await getMongoChapterNames(
          { connectionString: cfg.contentDbUrl!, dbName: cfg.contentDbName, collection: cfg.contentDbCollection },
          businessAccountId,
          cpIds,
        )
      : await getChapterNamesForCpIds(cfg, businessAccountId, cpIds);

    res.json({ chapters });
  } catch (error: any) {
    console.error("[TopScholar] scope-chapters failed:", error);
    res.status(500).json({ error: error?.message || "Failed to load chapters." });
  }
});

// ---- Widget Tester: live end-to-end doubt testing --------------------------
//
// Mints a REAL signed launch token from admin-supplied test IDs so the Tester
// can run the full production doubt path (portal message sync, retry-once,
// ticket, escalation email) against the client's system. Admin-only, TopScholar
// tenant only, and requires the launch-token secret to already be configured —
// the token produced here is indistinguishable from one the client portal signs.
router.post("/api/topscholar/tester/mint-launch-token", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const cfg = getTopscholarConfig(account);
  if (!cfg.tokenSecret) {
    return res.status(400).json({
      error: "Launch-token secret is not configured. Set it on the Ext. Content settings page first.",
    });
  }

  // Trim + cap input length so an oversized payload can't bloat the token or logs.
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
  const body = req.body || {};
  const boardV = str(body.board);
  const mediumV = str(body.medium);
  const gradeV = str(body.grade);
  const subjectV = str(body.subject);
  const chapterV = str(body.chapter);
  const studentIdV = str(body.studentId);
  const planIdV = str(body.planId);
  const doubtIdV = str(body.doubtId);
  // Preview mode mints a scope-only token for the Tester's own widget preview.
  // It claims no student and binds to no doubt, so it writes nothing to the
  // client's system — it exists so the preview carries a real signed identity
  // instead of unsigned scope params, which voice refuses.
  const isPreview = str(body.mode) === "preview";
  const nameV = str(body.name) || (isPreview ? "Preview Student" : "Live Test Student");

  if (!boardV || !mediumV || !gradeV || !subjectV) {
    return res.status(400).json({ error: "board, medium, grade and subject are all required." });
  }
  // A live session drives the real doubt path against the client's platform, so
  // it must say which student and doubt it is acting as. A preview has neither.
  if (!isPreview && (!studentIdV || !doubtIdV)) {
    return res.status(400).json({ error: "studentId and doubtId are required for a live doubt session." });
  }

  if (isPreview) {
    try {
      // Use the completed-sync metadata read model for the selected CP set. It
      // contains no curriculum text or embeddings; chapter presence is still
      // checked against the active content store below before signing.
      const storedCpIds = storedCpIdsForScope(await listTesterScopeMetadata(businessAccountId), {
        board: boardV,
        medium: mediumV,
        grade: gradeV,
        subject: subjectV,
      });
      if (storedCpIds.length === 0) {
        return res.status(400).json({
          error: "This scope is not present in the configured client content store.",
        });
      }

      const liveCpIds = await resolveCpIdsForScope(businessAccountId, {
        board: boardV,
        medium: mediumV,
        grade: gradeV,
        subject: subjectV,
      });
      const samePacks =
        storedCpIds.length === liveCpIds.length &&
        storedCpIds.every((cpId) => liveCpIds.includes(cpId));
      if (!samePacks) {
        return res.status(409).json({
          error: "This client-store scope does not match the live widget's current curriculum mapping. Refresh the content mapping before testing this preview.",
        });
      }

      if (chapterV) {
        const chapters = isMongoConnectionString(cfg.contentDbUrl)
          ? await getMongoChapterNames(
              { connectionString: cfg.contentDbUrl!, dbName: cfg.contentDbName, collection: cfg.contentDbCollection },
              businessAccountId,
              storedCpIds,
            )
          : await getChapterNamesForCpIds(cfg, businessAccountId, storedCpIds);
        if (!chapters.some((chapter) => chapter.trim().toLowerCase() === chapterV.toLowerCase())) {
          return res.status(400).json({
            error: "This chapter is not present for the selected scope in the client content store.",
          });
        }
      }
    } catch (error) {
      console.error("[TopScholar] Tester preview compatibility check failed:", error);
      return res.status(503).json({
        error: "Could not verify this preview scope against the configured content store.",
      });
    }
  }

  const { signLaunchToken } = await import("../services/topscholar/tokenService");
  const nowSec = Math.floor(Date.now() / 1000);
  // Long enough for a test session, short enough to limit misuse. A preview
  // token authorizes anonymous scoped voice and rides in an iframe URL, so it
  // gets a shorter life than a live session token; reloading the Tester mints
  // a fresh one.
  const exp = nowSec + (isPreview ? 60 * 60 : 2 * 60 * 60);
  const token = signLaunchToken(cfg.tokenSecret, {
    board: boardV,
    medium: mediumV,
    grade: gradeV,
    subject: subjectV,
    chapter: chapterV || null,
    // A preview must not carry a student or doubt identity: a doubt id would
    // bind the preview to a real doubt's lock state and let it mirror messages
    // onto the client's platform.
    studentId: isPreview ? null : studentIdV,
    name: nameV,
    doubtId: isPreview ? null : doubtIdV,
    planId: isPreview ? null : planIdV || null,
    exp,
  });

  const actor = (req as any).user;
  console.log(
    isPreview
      ? `[TopScholar][Tester] Preview launch token minted by user=${actor?.id || "?"} account=${businessAccountId} scope=${boardV}/${mediumV}/${gradeV}/${subjectV}${chapterV ? `/${chapterV}` : ""} at ${new Date().toISOString()}`
      : `[TopScholar][Tester] Live-test launch token minted by user=${actor?.id || "?"} account=${businessAccountId} for doubt=${doubtIdV} student=${studentIdV} plan=${planIdV || "-"} at ${new Date().toISOString()}`,
  );
  res.json({ token, expiresAt: new Date(exp * 1000).toISOString() });
});

// Recent outbound doubt-sync activity (message mirror / doubt close / escalation
// email) so the Tester can confirm end-to-end delivery to the client's system
// without reading server logs. In-memory, most-recent-first.
router.get("/api/topscholar/tester/doubt-sync-events", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });
  const account = await loadAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Business account not found" });
  const cfg = getTopscholarConfig(account);

  const doubtId = String(req.query.doubtId || "").trim() || null;
  const { getRecentDoubtSyncEvents } = await import("../services/topscholar/doubtSyncService");
  res.json({
    events: getRecentDoubtSyncEvents(doubtId),
    doubtSyncConfigured: !!cfg.doubtSyncBaseUrl,
  });
});

// ---- Debug Dashboard (Task: TopScholar debug mechanism) ---------------------
// Diagnostic endpoints for the /admin/topscholar/debug page. All read-only or
// explicitly-triggered test calls; guarded by the same TopScholar admin stack.

// 1. Live request log — ring buffer of chat-flow decision events.
router.get("/api/topscholar/debug/events", ...topscholarGuards, async (req: Request, res: Response) => {
  const { getDebugEvents } = await import("../services/topscholar/debugLogger");
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
  res.json({ events: getDebugEvents(limit) });
});

// 2. Token Inspector — decode + verify any pasted token with per-check reasons.
router.post("/api/topscholar/debug/verify-token", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  const account = await loadAccount(businessAccountId!);
  if (!account) return res.status(404).json({ error: "Business account not found" });
  const cfg = getTopscholarConfig(account);

  const token = String(req.body?.token || "").trim();
  if (!token) return res.status(400).json({ error: "token is required" });
  if (token.length > 8192) return res.status(400).json({ error: "token too long" });

  const { verifyLaunchTokenDetailed } = await import("../services/topscholar/tokenService");
  const result = verifyLaunchTokenDetailed(cfg.tokenSecret, token);
  res.json({ ...result, secretConfigured: !!cfg.tokenSecret, requireSignedToken: cfg.requireSignedToken });
});

// 3. Scope Resolver — which cp_ids a board/medium/grade/subject resolves to.
router.post("/api/topscholar/debug/resolve-scope", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
  const scope = {
    board: str(req.body?.board) || null,
    medium: str(req.body?.medium) || null,
    grade: str(req.body?.grade) || null,
    subject: str(req.body?.subject) || null,
  };
  const { resolveScopeDetailed } = await import("../services/topscholar/scopeResolver");
  const result = await resolveScopeDetailed(businessAccountId!, scope);
  res.json(result);
});

// 3b. All scopes with content, for reference in the debug UI.
router.get("/api/topscholar/debug/available-scopes", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  const { listAvailableScopes } = await import("../services/topscholar/scopeResolver");
  res.json({ scopes: await listAvailableScopes(businessAccountId!) });
});

// 4. Sync Tester — fire a real save-message POST and return the raw HTTP exchange.
router.post("/api/topscholar/debug/test-sync", ...topscholarGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  const account = await loadAccount(businessAccountId!);
  if (!account) return res.status(404).json({ error: "Business account not found" });
  const cfg = getTopscholarConfig(account);

  const doubtId = String(req.body?.doubtId || "").trim().slice(0, 200);
  const message = String(req.body?.message || "").trim().slice(0, 2000);
  const from = req.body?.from === "student" ? "student" : "sme";
  if (!doubtId || !message) return res.status(400).json({ error: "doubtId and message are required" });

  const { pushTextMessageDetailed } = await import("../services/topscholar/doubtSyncService");
  const result = await pushTextMessageDetailed(cfg.doubtSyncBaseUrl || "", doubtId, from, message);

  const actor = (req as any).user;
  console.log(`[TopScholar][Debug] test-sync by user=${actor?.id || "?"} doubt=${doubtId} → ${result.ok ? "OK" : result.error}`);
  res.json({ ...result, doubtSyncConfigured: !!cfg.doubtSyncBaseUrl });
});

export default router;
