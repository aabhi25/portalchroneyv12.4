import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  topscholarPlanCpResolutions,
  topscholarPlanIds,
  topscholarPlanRunItems,
  topscholarPlanRuns,
} from '@shared/schema';
import type { TopscholarConfig } from './config';
import { findKnownPlanIdsForCpIds } from './cpPlanLookup';
import { resolvePlans } from './ingestionService';
import { enqueueSingleCpSyncRun } from './planSyncWorker';

/**
 * CP-ID-driven refreshes, shared by the admin "Embed CP IDs" card and the LMS
 * embedding API so both follow exactly the same queueing rules.
 */

export type CpRefreshRejectionCode = 'unknown_cp_id' | 'queue_failed';

export interface CpRefreshOutcome {
  queued: Array<{ cpId: string; planId: string; runId: string }>;
  skipped: Array<{ cpId: string; planId: string; runId: string }>;
  rejected: Array<{ cpId: string; code: CpRefreshRejectionCode; error: string }>;
}

/**
 * Queues one full refresh per CP ID through the durable Plan worker. A CP ID that
 * already has an active refresh (targeted run, or a full Plan run that owns it) is
 * reported as skipped with that run's id; a CP ID with no known owning Plan is
 * rejected.
 */
export async function queueCpRefreshes(params: {
  businessAccountId: string;
  cpIds: string[];
  planByCpId: Map<string, string>;
}): Promise<CpRefreshOutcome> {
  const { businessAccountId, cpIds, planByCpId } = params;
  const knownCpIds = cpIds.filter((cpId) => planByCpId.has(cpId));
  const activeRuns = knownCpIds.length === 0
    ? []
    : await db
      .select({
        cpId: topscholarPlanRuns.requestedCpId,
        planId: topscholarPlanRuns.planId,
        runId: topscholarPlanRuns.id,
      })
      .from(topscholarPlanRuns)
      .where(and(
        eq(topscholarPlanRuns.businessAccountId, businessAccountId),
        inArray(topscholarPlanRuns.requestedCpId, knownCpIds),
        inArray(topscholarPlanRuns.status, ["queued", "resolving", "running"]),
      ))
      .orderBy(desc(topscholarPlanRuns.updatedAt));
  const activePlanItems = knownCpIds.length === 0
    ? []
    : await db
      .select({
        cpId: topscholarPlanRunItems.cpId,
        planId: topscholarPlanRuns.planId,
        runId: topscholarPlanRuns.id,
      })
      .from(topscholarPlanRunItems)
      .innerJoin(topscholarPlanRuns, eq(topscholarPlanRunItems.runId, topscholarPlanRuns.id))
      .where(and(
        eq(topscholarPlanRunItems.businessAccountId, businessAccountId),
        inArray(topscholarPlanRunItems.cpId, knownCpIds),
        inArray(topscholarPlanRunItems.status, ["queued", "running", "submitted"]),
        inArray(topscholarPlanRuns.status, ["queued", "resolving", "running"]),
      ))
      .orderBy(desc(topscholarPlanRuns.updatedAt));
  const activeFullPlanRuns = knownCpIds.length === 0
    ? []
    : await db
      .select({
        planId: topscholarPlanRuns.planId,
        runId: topscholarPlanRuns.id,
      })
      .from(topscholarPlanRuns)
      .where(and(
        eq(topscholarPlanRuns.businessAccountId, businessAccountId),
        inArray(topscholarPlanRuns.planId, Array.from(new Set(knownCpIds.map((cpId) => planByCpId.get(cpId)!)))),
        isNull(topscholarPlanRuns.requestedCpId),
        inArray(topscholarPlanRuns.status, ["queued", "resolving", "running"]),
      ))
      .orderBy(desc(topscholarPlanRuns.updatedAt));
  const activeRunByCpId = new Map<string, { runId: string; planId: string }>();
  const activeFullRunByPlanId = new Map<string, string>();
  for (const run of activeRuns) {
    if (run.cpId && !activeRunByCpId.has(run.cpId)) {
      activeRunByCpId.set(run.cpId, { runId: run.runId, planId: run.planId });
    }
  }
  for (const item of activePlanItems) {
    if (!activeRunByCpId.has(item.cpId)) {
      activeRunByCpId.set(item.cpId, { runId: item.runId, planId: item.planId });
    }
  }
  for (const run of activeFullPlanRuns) {
    if (!activeFullRunByPlanId.has(run.planId)) activeFullRunByPlanId.set(run.planId, run.runId);
  }

  const queued: Array<{ cpId: string; planId: string; runId: string }> = [];
  const skipped: Array<{ cpId: string; planId: string; runId: string }> = [];
  const rejected: CpRefreshOutcome["rejected"] = [];

  for (const cpId of cpIds) {
    const planId = planByCpId.get(cpId);
    if (!planId) {
      rejected.push({
        cpId,
        code: "unknown_cp_id",
        error: "This CP ID is not yet known to a resolved TopScholar Plan. Resolve its owning Plan first, then queue this package.",
      });
      continue;
    }
    const active = activeRunByCpId.get(cpId);
    if (active) {
      skipped.push({ cpId, planId: active.planId, runId: active.runId });
      continue;
    }
    const activeFullRunId = activeFullRunByPlanId.get(planId);
    if (activeFullRunId) {
      skipped.push({ cpId, planId, runId: activeFullRunId });
      continue;
    }
    try {
      const run = await enqueueSingleCpSyncRun({ businessAccountId, planId, cpId });
      if (!run.created) {
        skipped.push({ cpId, planId: run.planId, runId: run.id });
        activeRunByCpId.set(cpId, { runId: run.id, planId: run.planId });
        continue;
      }
      queued.push({ cpId, planId: run.planId, runId: run.id });
      activeRunByCpId.set(cpId, { runId: run.id, planId: run.planId });
    } catch (error: any) {
      rejected.push({ cpId, code: "queue_failed", error: error?.message || "Could not queue this CP ID." });
    }
  }

  return { queued, skipped, rejected };
}

// ---- Discovery of CP IDs we have not seen yet --------------------------------

// Plans per Content Bundle call during discovery (same batch size as Plan syncs).
const DISCOVERY_BATCH = 10;
// A discovery scan that checked every saved Plan is trusted this long, so repeated
// requests for a genuinely unknown CP ID don't re-download every plan.
const DISCOVERY_FRESH_MS = 10 * 60 * 1000;
const NO_CONTENT_ERROR = 'No content returned for this Plan ID.';

interface DiscoveryState {
  running: Promise<void> | null;
  // CP IDs some caller is still waiting for; the scan stops early once it is empty.
  pending: Set<string>;
  lastCompleteAt: number;
}
const discoveryByAccount = new Map<string, DiscoveryState>();

function discoveryState(businessAccountId: string): DiscoveryState {
  let state = discoveryByAccount.get(businessAccountId);
  if (!state) {
    state = { running: null, pending: new Set(), lastCompleteAt: 0 };
    discoveryByAccount.set(businessAccountId, state);
  }
  return state;
}

/** Saved, enabled Plan IDs — never-resolved first, then least recently resolved. */
async function plansInDiscoveryOrder(businessAccountId: string): Promise<string[]> {
  const rows = await db
    .select({ planId: topscholarPlanIds.planId })
    .from(topscholarPlanIds)
    .leftJoin(
      topscholarPlanCpResolutions,
      and(
        eq(topscholarPlanCpResolutions.businessAccountId, topscholarPlanIds.businessAccountId),
        eq(topscholarPlanCpResolutions.planId, topscholarPlanIds.planId),
      ),
    )
    .where(and(eq(topscholarPlanIds.businessAccountId, businessAccountId), eq(topscholarPlanIds.enabled, 'true')))
    .groupBy(topscholarPlanIds.planId)
    .orderBy(sql`max(${topscholarPlanCpResolutions.lastResolvedAt}) ASC NULLS FIRST`, asc(topscholarPlanIds.planId));
  return rows.map((row) => row.planId);
}

async function runDiscoveryScan(
  businessAccountId: string,
  cfg: TopscholarConfig,
  state: DiscoveryState,
): Promise<void> {
  const planIds = await plansInDiscoveryOrder(businessAccountId);
  let fetchFailed = false;
  let stoppedEarly = false;
  for (let i = 0; i < planIds.length; i += DISCOVERY_BATCH) {
    if (state.pending.size === 0) {
      stoppedEarly = true;
      break;
    }
    const resolutions = await resolvePlans({ businessAccountId, planIds: planIds.slice(i, i + DISCOVERY_BATCH), cfg });
    for (const resolution of resolutions) {
      if (resolution.error && resolution.error !== NO_CONTENT_ERROR) fetchFailed = true;
      for (const cp of resolution.cps) state.pending.delete(cp.cpId);
    }
  }
  // Only a scan that really looked at every plan may vouch that the rest are unknown.
  if (!stoppedEarly && !fetchFailed) {
    state.lastCompleteAt = Date.now();
    state.pending.clear();
  }
  if (fetchFailed) {
    console.warn(`[TopScholar Discovery] Content Bundle API failed for some plans; unknown CP IDs will be retried on the next request.`);
  }
}

export interface DiscoveryResult {
  /** Owning Plan per requested CP ID, for every CP ID now known. */
  planByCpId: Map<string, string>;
  /** True when a recent scan checked every saved Plan, so a missing CP ID is truly unknown. */
  scanComplete: boolean;
}

/**
 * Finds the owning Plan of CP IDs we have never seen by re-resolving the saved Plan
 * IDs (exactly like the admin "Resolve" button, so their stored CP lists refresh too)
 * until every requested CP ID is found. One scan runs per account at a time. Callers
 * wait at most `budgetMs`; a scan that outlives the budget keeps going in the
 * background, so asking again shortly afterwards finds the stored link.
 */
export async function discoverPlansForCpIds(params: {
  businessAccountId: string;
  cfg: TopscholarConfig;
  cpIds: string[];
  budgetMs: number;
}): Promise<DiscoveryResult> {
  const { businessAccountId, cfg, cpIds, budgetMs } = params;
  const known = await findKnownPlanIdsForCpIds(businessAccountId, cpIds);
  const unknown = cpIds.filter((cpId) => !known.has(cpId));
  const state = discoveryState(businessAccountId);
  const recentlyComplete = () => Date.now() - state.lastCompleteAt < DISCOVERY_FRESH_MS;
  if (unknown.length === 0) return { planByCpId: known, scanComplete: true };
  if (!state.running && recentlyComplete()) return { planByCpId: known, scanComplete: true };

  for (const cpId of unknown) state.pending.add(cpId);
  if (!state.running) {
    state.running = runDiscoveryScan(businessAccountId, cfg, state)
      .catch((error) => console.error('[TopScholar Discovery] scan failed:', error))
      .finally(() => {
        state.running = null;
      });
  }

  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    state.running,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, budgetMs);
    }),
  ]);
  if (timer) clearTimeout(timer);

  const after = await findKnownPlanIdsForCpIds(businessAccountId, cpIds);
  return { planByCpId: after, scanComplete: !state.running && recentlyComplete() };
}

// ---- CP IDs sent together with their Plan ID ---------------------------------

export type PlanLinkRejectionCode = 'cp_not_in_plan' | 'plan_lookup_failed' | 'lookup_in_progress';

/**
 * Confirms caller-supplied (CP ID, Plan ID) pairs against the Content Bundle API:
 * each Plan is resolved once (refreshing its stored CP list, like the admin
 * "Resolve" button) and a pair is accepted only when that Plan really contains the
 * CP ID, so a wrong pairing can never embed the wrong package. Plans the service
 * returns content for are added to the saved Plan ID list, so they show on Content
 * Sync and help later CP-ID-only lookups (a mistyped Plan ID is never saved). Callers wait at most `budgetMs`; a slow resolve keeps going in
 * the background and its pairs come back as `lookup_in_progress`.
 */
export async function confirmPlanLinks(params: {
  businessAccountId: string;
  cfg: TopscholarConfig;
  pairs: Array<{ cpId: string; planId: string }>;
  budgetMs: number;
}): Promise<{
  planByCpId: Map<string, string>;
  rejected: Array<{ cpId: string; code: PlanLinkRejectionCode; error: string }>;
}> {
  const { businessAccountId, cfg, pairs, budgetMs } = params;
  const planIds = Array.from(new Set(pairs.map((pair) => pair.planId)));

  const resolutionByPlan = new Map<string, Awaited<ReturnType<typeof resolvePlans>>[number]>();
  const work = (async () => {
    for (let i = 0; i < planIds.length; i += DISCOVERY_BATCH) {
      const resolutions = await resolvePlans({ businessAccountId, planIds: planIds.slice(i, i + DISCOVERY_BATCH), cfg });
      for (const resolution of resolutions) {
        if (resolution.cps.length > 0) {
          await db
            .insert(topscholarPlanIds)
            .values({ businessAccountId, planId: resolution.planId })
            .onConflictDoNothing({ target: [topscholarPlanIds.businessAccountId, topscholarPlanIds.planId] });
        }
        resolutionByPlan.set(resolution.planId, resolution);
      }
    }
  })().catch((error) => console.error('[TopScholar PlanLinks] resolve failed:', error));

  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, budgetMs);
    }),
  ]);
  if (timer) clearTimeout(timer);

  const planByCpId = new Map<string, string>();
  const rejected: Array<{ cpId: string; code: PlanLinkRejectionCode; error: string }> = [];
  for (const { cpId, planId } of pairs) {
    const resolution = resolutionByPlan.get(planId);
    if (!resolution) {
      rejected.push({ cpId, code: 'lookup_in_progress', error: 'This Plan is still being checked. Retry in a minute.' });
    } else if (resolution.cps.some((cp) => cp.cpId === cpId)) {
      planByCpId.set(cpId, planId);
    } else if (resolution.error && resolution.error !== NO_CONTENT_ERROR) {
      rejected.push({
        cpId,
        code: 'plan_lookup_failed',
        error: "TopScholar's content service could not be reached to check this Plan. Retry shortly.",
      });
    } else {
      rejected.push({
        cpId,
        code: 'cp_not_in_plan',
        error: "TopScholar's content service does not list this CP ID under this Plan ID. Check the pairing.",
      });
    }
  }
  return { planByCpId, rejected };
}
