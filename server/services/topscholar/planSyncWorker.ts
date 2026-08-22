import crypto from 'crypto';
import { db } from '../../db';
import {
  businessAccounts,
  topscholarContentSync,
  topscholarPlanIds,
  topscholarPlanRunItems,
  topscholarPlanRuns,
  topscholarPlanSyncLeases,
} from '@shared/schema';
import { and, asc, desc, eq, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { getTopscholarConfig, type TopscholarConfig } from './config';
import { ingestSingleCp, resolvePlans } from './ingestionService';
import { testMongoConnection } from './mongoContentDb';

type PlanRun = typeof topscholarPlanRuns.$inferSelect;
type PlanRunItem = typeof topscholarPlanRunItems.$inferSelect;

const ACTIVE_RUN_STATUSES = ['queued', 'resolving', 'running'] as const;
const TERMINAL_ITEM_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const MAX_SUBMITTED_BATCH_ITEMS_PER_RUN = 2;
const LEASE_MS = 60_000;
const WORKER_ID = `${process.pid}:${crypto.randomUUID()}`;

let processing = false;
let interval: NodeJS.Timeout | null = null;

function nowPatch() {
  return { updatedAt: new Date() };
}

async function setPlanStatus(
  businessAccountId: string,
  planId: string,
  status: 'syncing' | 'completed' | 'failed' | 'cancelled',
  error: string | null,
): Promise<void> {
  await db
    .update(topscholarPlanIds)
    .set({
      lastStatus: status,
      lastError: error,
      lastSyncedAt: status === 'completed' ? new Date() : undefined,
      ...nowPatch(),
    })
    .where(and(eq(topscholarPlanIds.businessAccountId, businessAccountId), eq(topscholarPlanIds.planId, planId)));
}

async function loadRunAccount(run: PlanRun) {
  const [account] = await db.select().from(businessAccounts).where(eq(businessAccounts.id, run.businessAccountId));
  if (!account) throw new Error('Business account no longer exists.');
  const cfg = getTopscholarConfig(account);
  if (!cfg.ragEnabled) throw new Error('TopScholar RAG mode is not enabled for this account.');
  if (!account.openaiApiKey) throw new Error('An OpenAI API key must be configured before syncing.');
  return { account, cfg };
}

async function verifyContentStore(cfg: TopscholarConfig): Promise<void> {
  if (cfg.storeType !== 'mongodb' || !cfg.contentDbUrl) return;
  const result = await testMongoConnection({
    connectionString: cfg.contentDbUrl,
    dbName: cfg.contentDbName,
    collection: cfg.contentDbCollection,
    indexName: cfg.contentDbIndex,
  });
  if (!result.success) throw new Error(`Client MongoDB is unavailable: ${result.message}`);
  if (result.warning) throw new Error(`Client MongoDB cannot safely accept a sync: ${result.warning}`);
}

async function acquireAccountLease(businessAccountId: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .insert(topscholarPlanSyncLeases)
    .values({ businessAccountId, owner: WORKER_ID, expiresAt: new Date(now.getTime() + LEASE_MS) })
    .onConflictDoUpdate({
      target: topscholarPlanSyncLeases.businessAccountId,
      set: { owner: WORKER_ID, expiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now },
      where: or(lt(topscholarPlanSyncLeases.expiresAt, now), eq(topscholarPlanSyncLeases.owner, WORKER_ID)),
    })
    .returning({ businessAccountId: topscholarPlanSyncLeases.businessAccountId });
  return rows.length > 0;
}

async function renewLease(run: PlanRun): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_MS);
  await Promise.all([
    db
      .update(topscholarPlanSyncLeases)
      .set({ expiresAt, updatedAt: now })
      .where(and(eq(topscholarPlanSyncLeases.businessAccountId, run.businessAccountId), eq(topscholarPlanSyncLeases.owner, WORKER_ID))),
    db
      .update(topscholarPlanRuns)
      .set({ leaseExpiresAt: expiresAt, ...nowPatch() })
      .where(and(eq(topscholarPlanRuns.id, run.id), eq(topscholarPlanRuns.leaseOwner, WORKER_ID))),
  ]);
}

async function releaseLease(run: PlanRun): Promise<void> {
  await Promise.all([
    db
      .delete(topscholarPlanSyncLeases)
      .where(and(eq(topscholarPlanSyncLeases.businessAccountId, run.businessAccountId), eq(topscholarPlanSyncLeases.owner, WORKER_ID))),
    db
      .update(topscholarPlanRuns)
      .set({ leaseOwner: null, leaseExpiresAt: null, ...nowPatch() })
      .where(and(eq(topscholarPlanRuns.id, run.id), eq(topscholarPlanRuns.leaseOwner, WORKER_ID))),
  ]);
}

async function claimRun(candidate: PlanRun): Promise<PlanRun | null> {
  if (!await acquireAccountLease(candidate.businessAccountId)) return null;
  const now = new Date();
  const [claimed] = await db
    .update(topscholarPlanRuns)
    .set({ leaseOwner: WORKER_ID, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), ...nowPatch() })
    .where(and(
      eq(topscholarPlanRuns.id, candidate.id),
      inArray(topscholarPlanRuns.status, [...ACTIVE_RUN_STATUSES]),
      or(
        isNull(topscholarPlanRuns.leaseExpiresAt),
        lt(topscholarPlanRuns.leaseExpiresAt, now),
        eq(topscholarPlanRuns.leaseOwner, WORKER_ID),
      ),
    ))
    .returning();
  if (!claimed) {
    await releaseLease(candidate);
    return null;
  }
  // Only a worker that has reclaimed an expired lease restarts a CP boundary.
  // A healthy worker renews its lease while awaiting the direct client-store run.
  if (candidate.leaseOwner && candidate.leaseOwner !== WORKER_ID) {
    await db
      .update(topscholarPlanRunItems)
      .set({ status: 'queued', ...nowPatch() })
      .where(and(eq(topscholarPlanRunItems.runId, claimed.id), eq(topscholarPlanRunItems.status, 'running')));
  }
  return claimed;
}

async function refreshRun(runId: string): Promise<PlanRun | null> {
  const [run] = await db.select().from(topscholarPlanRuns).where(eq(topscholarPlanRuns.id, runId));
  if (!run) return null;
  const items = await db
    .select()
    .from(topscholarPlanRunItems)
    .where(eq(topscholarPlanRunItems.runId, runId))
    .orderBy(asc(topscholarPlanRunItems.createdAt));

  const completed = items.filter((item) => item.status === 'completed').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const active = items.find((item) => item.status === 'running') || items.find((item) => item.status === 'submitted');
  const allTerminal = items.length > 0 && items.every((item) => TERMINAL_ITEM_STATUSES.has(item.status));

  let status = run.status;
  let completedAt = run.completedAt;
  if (status !== 'cancelled' && allTerminal) {
    status = failed > 0 ? 'failed' : 'completed';
    completedAt = new Date();
  } else if (status !== 'cancelled' && items.length > 0) {
    status = 'running';
    completedAt = null;
  }

  await db
    .update(topscholarPlanRuns)
    .set({
      status,
      totalCpIds: items.length,
      completedCpIds: completed,
      failedCpIds: failed,
      activeCpId: active?.cpId || null,
      completedAt,
      ...nowPatch(),
    })
    // Never resurrect a run that was cancelled while this worker was
    // reconciling a direct CP ID or Batch result.
    .where(and(eq(topscholarPlanRuns.id, runId), ne(topscholarPlanRuns.status, 'cancelled')));

  if (status === 'completed') await setPlanStatus(run.businessAccountId, run.planId, 'completed', null);
  if (status === 'failed') await setPlanStatus(run.businessAccountId, run.planId, 'failed', run.error || `${failed} cp_id sync(s) failed.`);
  if (status === 'cancelled') await setPlanStatus(run.businessAccountId, run.planId, 'cancelled', 'Plan sync was cancelled.');

  const [refreshed] = await db.select().from(topscholarPlanRuns).where(eq(topscholarPlanRuns.id, runId));
  return refreshed || null;
}

async function failRun(run: PlanRun, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const failed = await db
    .update(topscholarPlanRuns)
    .set({ status: 'failed', error: message, activeCpId: null, completedAt: new Date(), ...nowPatch() })
    .where(and(eq(topscholarPlanRuns.id, run.id), eq(topscholarPlanRuns.leaseOwner, WORKER_ID), ne(topscholarPlanRuns.status, 'cancelled')))
    .returning({ id: topscholarPlanRuns.id });
  if (failed.length > 0) await setPlanStatus(run.businessAccountId, run.planId, 'failed', message);
  console.error(`[TopScholar PlanSync] Run ${run.id} (${run.planId}) failed: ${message}`);
}

async function reconcileSubmittedItems(run: PlanRun): Promise<void> {
  const items = await db
    .select()
    .from(topscholarPlanRunItems)
    .where(and(eq(topscholarPlanRunItems.runId, run.id), eq(topscholarPlanRunItems.status, 'submitted')));
  if (items.length === 0) return;

  const syncRows = await db
    .select({ cpId: topscholarContentSync.cpId, status: topscholarContentSync.status, lastError: topscholarContentSync.lastError })
    .from(topscholarContentSync)
    .where(and(
      eq(topscholarContentSync.businessAccountId, run.businessAccountId),
      inArray(topscholarContentSync.cpId, items.map((item) => item.cpId)),
    ));
  const byCp = new Map(syncRows.map((row) => [row.cpId, row]));
  for (const item of items) {
    const sync = byCp.get(item.cpId);
    if (!sync || !['completed', 'failed', 'cancelled'].includes(sync.status)) continue;
    await db
      .update(topscholarPlanRunItems)
      .set({
        status: sync.status === 'completed' ? 'completed' : sync.status === 'cancelled' ? 'cancelled' : 'failed',
        error: sync.status === 'completed' ? null : (sync.lastError || `Embedding ${sync.status}.`),
        completedAt: new Date(),
        ...nowPatch(),
      })
      .where(and(eq(topscholarPlanRunItems.id, item.id), eq(topscholarPlanRunItems.status, 'submitted')));
  }
}

async function resolveRun(run: PlanRun, cfg: TopscholarConfig): Promise<void> {
  const resolving = await db
    .update(topscholarPlanRuns)
    .set({ status: 'resolving', error: null, activeCpId: null, startedAt: run.startedAt || new Date(), ...nowPatch() })
    .where(and(
      eq(topscholarPlanRuns.id, run.id),
      eq(topscholarPlanRuns.leaseOwner, WORKER_ID),
      inArray(topscholarPlanRuns.status, ['queued', 'resolving', 'running']),
    ))
    .returning({ id: topscholarPlanRuns.id });
  if (resolving.length === 0) return;
  await setPlanStatus(run.businessAccountId, run.planId, 'syncing', null);
  await verifyContentStore(cfg);

  const [resolution] = await resolvePlans({
    businessAccountId: run.businessAccountId,
    planIds: [run.planId],
    cfg,
  });
  if (!resolution || resolution.error) {
    throw new Error(resolution?.error || 'The CMS did not return a resolution for this Plan ID.');
  }
  if (resolution.cps.length === 0) {
    throw new Error('No CP IDs were returned for this Plan ID.');
  }

  await db.transaction(async (tx) => {
    // Cancel may have happened while the CMS request was in flight. Advance only
    // while this worker still owns an active run, so cancellation can never be
    // overwritten by the resolver's late response.
    const advanced = await tx
      .update(topscholarPlanRuns)
      .set({ status: 'running', totalCpIds: resolution.cps.length, error: null, ...nowPatch() })
      .where(and(
        eq(topscholarPlanRuns.id, run.id),
        eq(topscholarPlanRuns.leaseOwner, WORKER_ID),
        inArray(topscholarPlanRuns.status, ['queued', 'resolving', 'running']),
      ))
      .returning({ id: topscholarPlanRuns.id });
    if (advanced.length === 0) return;
    for (const cp of resolution.cps) {
      await tx
        .insert(topscholarPlanRunItems)
        .values({
          runId: run.id,
          businessAccountId: run.businessAccountId,
          planId: run.planId,
          cpId: cp.cpId,
        })
        .onConflictDoNothing();
    }
  });
}

async function processOneItem(run: PlanRun, cfg: TopscholarConfig): Promise<void> {
  await reconcileSubmittedItems(run);
  const refreshed = await refreshRun(run.id);
  if (!refreshed || refreshed.status === 'cancelled' || refreshed.status === 'completed' || refreshed.status === 'failed') return;

  const items = await db
    .select()
    .from(topscholarPlanRunItems)
    .where(eq(topscholarPlanRunItems.runId, run.id))
    .orderBy(asc(topscholarPlanRunItems.createdAt));
  const submitted = items.filter((item) => item.status === 'submitted').length;
  // OpenAI Batch submission is already restart-safe, but avoid creating an
  // unbounded number of large input payloads from one Plan run.
  if (!cfg.contentDbUrl && submitted >= MAX_SUBMITTED_BATCH_ITEMS_PER_RUN) return;

  const item = items.find((candidate) => candidate.status === 'queued');
  if (!item) return;

  const claimedItem = await db
    .update(topscholarPlanRunItems)
    .set({
      status: 'running',
      attempts: item.attempts + 1,
      error: null,
      startedAt: item.startedAt || new Date(),
      ...nowPatch(),
    })
    .where(and(eq(topscholarPlanRunItems.id, item.id), eq(topscholarPlanRunItems.status, 'queued')))
    .returning({ id: topscholarPlanRunItems.id });
  if (claimedItem.length === 0) return;
  const activeRun = await db
    .update(topscholarPlanRuns)
    .set({ activeCpId: item.cpId, status: 'running', ...nowPatch() })
    .where(and(eq(topscholarPlanRuns.id, run.id), eq(topscholarPlanRuns.leaseOwner, WORKER_ID), ne(topscholarPlanRuns.status, 'cancelled')))
    .returning({ id: topscholarPlanRuns.id });
  if (activeRun.length === 0) {
    await db.update(topscholarPlanRunItems).set({ status: 'cancelled', completedAt: new Date(), ...nowPatch() }).where(eq(topscholarPlanRunItems.id, item.id));
    return;
  }

  try {
    // Direct client-store work must be awaited here. The single-CP button can
    // still return immediately, but a Plan run owns only one MongoDB embedding
    // worker at a time so it cannot exhaust the server.
    const result = await ingestSingleCp({
      businessAccountId: run.businessAccountId,
      cpId: item.cpId,
      planId: run.planId,
      cfg,
      mode: 'full',
      awaitDirect: !!cfg.contentDbUrl,
      isCancelled: async () => {
        const [state] = await db
          .select({ runStatus: topscholarPlanRuns.status, itemStatus: topscholarPlanRunItems.status })
          .from(topscholarPlanRuns)
          .innerJoin(topscholarPlanRunItems, eq(topscholarPlanRunItems.runId, topscholarPlanRuns.id))
          .where(and(eq(topscholarPlanRuns.id, run.id), eq(topscholarPlanRunItems.id, item.id)));
        return !state || state.runStatus === 'cancelled' || state.itemStatus === 'cancelled';
      },
    });
    const status = result.cancelled ? 'cancelled' : result.jobId || result.async ? 'submitted' : 'completed';
    await db
      .update(topscholarPlanRunItems)
      .set({
        status,
        error: result.cancelled ? 'Cancelled during direct sync.' : null,
        completedAt: status === 'submitted' ? null : new Date(),
        ...nowPatch(),
      })
      .where(and(eq(topscholarPlanRunItems.id, item.id), eq(topscholarPlanRunItems.status, 'running')));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(topscholarPlanRunItems)
      .set({ status: 'failed', error: message, completedAt: new Date(), ...nowPatch() })
      .where(and(eq(topscholarPlanRunItems.id, item.id), eq(topscholarPlanRunItems.status, 'running')));
    console.error(`[TopScholar PlanSync] CP ${item.cpId} failed in run ${run.id}: ${message}`);
  }
  await refreshRun(run.id);
}

async function processRun(run: PlanRun): Promise<void> {
  try {
    const { cfg } = await loadRunAccount(run);
    const items = await db
      .select({ id: topscholarPlanRunItems.id })
      .from(topscholarPlanRunItems)
      .where(eq(topscholarPlanRunItems.runId, run.id))
      .limit(1);
    if (items.length === 0) {
      await resolveRun(run, cfg);
      await refreshRun(run.id);
      return;
    }
    await processOneItem(run, cfg);
  } catch (error) {
    await failRun(run, error);
  }
}

/** Queue one durable run per Plan ID. Repeated clicks reuse the active run. */
export async function enqueuePlanSyncRuns(params: {
  businessAccountId: string;
  planIds: string[];
}): Promise<PlanRun[]> {
  const planIds = Array.from(new Set(params.planIds.map((value) => value.trim()).filter(Boolean)));
  const runs: PlanRun[] = [];
  for (const planId of planIds) {
    const active = await db
      .select()
      .from(topscholarPlanRuns)
      .where(and(
        eq(topscholarPlanRuns.businessAccountId, params.businessAccountId),
        eq(topscholarPlanRuns.planId, planId),
        isNull(topscholarPlanRuns.requestedCpId),
        inArray(topscholarPlanRuns.status, [...ACTIVE_RUN_STATUSES]),
      ))
      .orderBy(desc(topscholarPlanRuns.updatedAt))
      .limit(1);
    if (active[0]) {
      runs.push(active[0]);
      continue;
    }
    try {
      const [run] = await db
        .insert(topscholarPlanRuns)
        .values({ businessAccountId: params.businessAccountId, planId, mode: 'full' })
        .returning();
      runs.push(run);
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
      const [winner] = await db
        .select()
        .from(topscholarPlanRuns)
        .where(and(
          eq(topscholarPlanRuns.businessAccountId, params.businessAccountId),
          eq(topscholarPlanRuns.planId, planId),
          isNull(topscholarPlanRuns.requestedCpId),
          inArray(topscholarPlanRuns.status, [...ACTIVE_RUN_STATUSES]),
        ))
        .orderBy(desc(topscholarPlanRuns.updatedAt))
        .limit(1);
      if (!winner) throw error;
      runs.push(winner);
    }
  }
  processPendingPlanRuns().catch((error) => console.error('[TopScholar PlanSync] queue kick failed:', error));
  return runs;
}

/** Queue one explicitly selected CP ID through the same bounded worker used by Plan runs. */
export async function enqueueSingleCpSyncRun(params: {
  businessAccountId: string;
  planId: string;
  cpId: string;
}): Promise<PlanRun> {
  const [existing] = await db
    .select()
    .from(topscholarPlanRuns)
    .where(and(
      eq(topscholarPlanRuns.businessAccountId, params.businessAccountId),
      eq(topscholarPlanRuns.planId, params.planId),
      eq(topscholarPlanRuns.requestedCpId, params.cpId),
      inArray(topscholarPlanRuns.status, [...ACTIVE_RUN_STATUSES]),
    ))
    .orderBy(desc(topscholarPlanRuns.updatedAt))
    .limit(1);
  if (existing) return existing;

  let run!: PlanRun;
  try {
    await db.transaction(async (tx) => {
      [run] = await tx
        .insert(topscholarPlanRuns)
        .values({
          businessAccountId: params.businessAccountId,
          planId: params.planId,
          requestedCpId: params.cpId,
          mode: 'full',
          status: 'running',
          totalCpIds: 1,
        })
        .returning();
      await tx.insert(topscholarPlanRunItems).values({
        runId: run.id,
        businessAccountId: params.businessAccountId,
        planId: params.planId,
        cpId: params.cpId,
      });
    });
  } catch (error: any) {
    if (error?.code !== '23505') throw error;
    const [winner] = await db
      .select()
      .from(topscholarPlanRuns)
      .where(and(
        eq(topscholarPlanRuns.businessAccountId, params.businessAccountId),
        eq(topscholarPlanRuns.planId, params.planId),
        eq(topscholarPlanRuns.requestedCpId, params.cpId),
        inArray(topscholarPlanRuns.status, [...ACTIVE_RUN_STATUSES]),
      ))
      .orderBy(desc(topscholarPlanRuns.updatedAt))
      .limit(1);
    if (!winner) throw error;
    return winner;
  }
  await setPlanStatus(params.businessAccountId, params.planId, 'syncing', null);
  processPendingPlanRuns().catch((error) => console.error('[TopScholar PlanSync] single-CP queue kick failed:', error));
  return run;
}

export async function listPlanSyncRuns(businessAccountId: string, planId?: string): Promise<PlanRun[]> {
  const conditions = [eq(topscholarPlanRuns.businessAccountId, businessAccountId)];
  if (planId) conditions.push(eq(topscholarPlanRuns.planId, planId));
  return db
    .select()
    .from(topscholarPlanRuns)
    .where(and(...conditions))
    .orderBy(desc(topscholarPlanRuns.updatedAt))
    .limit(100);
}

export async function cancelPlanSyncRun(businessAccountId: string, runId: string): Promise<PlanRun | null> {
  const [run] = await db
    .select()
    .from(topscholarPlanRuns)
    .where(and(eq(topscholarPlanRuns.id, runId), eq(topscholarPlanRuns.businessAccountId, businessAccountId)));
  if (!run) return null;
  if (['completed', 'failed', 'cancelled'].includes(run.status)) return run;

  await db
    .update(topscholarPlanRunItems)
    .set({ status: 'cancelled', error: 'Cancelled before processing.', completedAt: new Date(), ...nowPatch() })
    .where(and(eq(topscholarPlanRunItems.runId, run.id), eq(topscholarPlanRunItems.status, 'queued')));
  // The direct worker checks this durable CP-level cancellation between pages.
  // Leave the running item itself intact until the worker reports its terminal
  // state, so it cannot be mistaken for a fully completed write.
  const activeItems = await db
    .select({ cpId: topscholarPlanRunItems.cpId })
    .from(topscholarPlanRunItems)
    .where(and(eq(topscholarPlanRunItems.runId, run.id), eq(topscholarPlanRunItems.status, 'running')));
  await db
    .update(topscholarPlanRunItems)
    .set({ status: 'cancelled', error: 'Cancelled from the Plan sync queue.', completedAt: new Date(), ...nowPatch() })
    .where(and(
      eq(topscholarPlanRunItems.runId, run.id),
      inArray(topscholarPlanRunItems.status, ['queued', 'running']),
    ));
  if (activeItems.length > 0) {
    await db
      .update(topscholarContentSync)
      .set({ status: 'cancelled', lastError: 'Cancelled from the Plan sync queue.', updatedAt: new Date() })
      .where(and(
        eq(topscholarContentSync.businessAccountId, run.businessAccountId),
        inArray(topscholarContentSync.cpId, activeItems.map((item) => item.cpId)),
      ));
  }
  await db
    .update(topscholarPlanRuns)
    .set({ status: 'cancelled', activeCpId: null, completedAt: new Date(), ...nowPatch() })
    .where(eq(topscholarPlanRuns.id, run.id));
  await setPlanStatus(run.businessAccountId, run.planId, 'cancelled', 'Plan sync was cancelled. Any active CP ID may finish its current page.');
  return (await db.select().from(topscholarPlanRuns).where(eq(topscholarPlanRuns.id, run.id)))[0] || null;
}

export async function retryFailedPlanSyncItems(businessAccountId: string, runId: string): Promise<PlanRun | null> {
  const [run] = await db
    .select()
    .from(topscholarPlanRuns)
    .where(and(eq(topscholarPlanRuns.id, runId), eq(topscholarPlanRuns.businessAccountId, businessAccountId)));
  if (!run) return null;
  // Retry is a one-way terminal-state transition: cancelled and completed runs
  // must remain historical facts even if an authenticated caller bypasses the
  // UI button's visibility rule.
  if (run.status !== 'failed') return run;
  const requeued = await db
    .update(topscholarPlanRunItems)
    .set({ status: 'queued', error: null, completedAt: null, ...nowPatch() })
    .where(and(eq(topscholarPlanRunItems.runId, run.id), eq(topscholarPlanRunItems.status, 'failed')))
    .returning({ id: topscholarPlanRunItems.id });
  if (requeued.length === 0) return run;
  const restarted = await db
    .update(topscholarPlanRuns)
    .set({ status: 'running', error: null, completedAt: null, ...nowPatch() })
    .where(and(eq(topscholarPlanRuns.id, run.id), eq(topscholarPlanRuns.status, 'failed')))
    .returning({ id: topscholarPlanRuns.id });
  if (restarted.length === 0) {
    return (await db.select().from(topscholarPlanRuns).where(eq(topscholarPlanRuns.id, run.id)))[0] || null;
  }
  const refreshed = await refreshRun(run.id);
  processPendingPlanRuns().catch((error) => console.error('[TopScholar PlanSync] retry kick failed:', error));
  return refreshed;
}

/** Process at most one leased Plan work item. */
export async function processPendingPlanRuns(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    // Always prioritize plans that can immediately make forward progress. A
    // separate, bounded running query below reconciles submitted Batch work
    // only when no queued/resolving plan is waiting, so hundreds of Batch
    // jobs cannot hide a newer Plan sync behind an in-memory limit.
    let candidates = await db
      .select()
      .from(topscholarPlanRuns)
      .where(inArray(topscholarPlanRuns.status, ['queued', 'resolving']))
      .orderBy(asc(topscholarPlanRuns.createdAt))
      .limit(1);
    if (candidates.length === 0) {
      candidates = await db
        .select()
        .from(topscholarPlanRuns)
        .where(eq(topscholarPlanRuns.status, 'running'))
        .orderBy(asc(topscholarPlanRuns.createdAt))
        .limit(1);
    }
    for (const candidate of candidates) {
      const run = await claimRun(candidate);
      if (!run) continue;
      const heartbeat = setInterval(() => {
        renewLease(run).catch((error) => console.error(`[TopScholar PlanSync] lease renewal failed for ${run.id}:`, error));
      }, Math.floor(LEASE_MS / 3));
      try {
        await processRun(run);
      } finally {
        clearInterval(heartbeat);
        await releaseLease(run);
      }
      break;
    }
  } finally {
    processing = false;
  }
}

/** Starts the durable Plan-sync worker once per process. */
export function startPlanSyncWorker(intervalMs = 5000): void {
  if (interval) return;
  setTimeout(() => {
    processPendingPlanRuns()
      .catch((error) => console.error('[TopScholar PlanSync] startup recovery failed:', error));
  }, 6000);
  interval = setInterval(() => {
    processPendingPlanRuns().catch((error) => console.error('[TopScholar PlanSync] worker tick failed:', error));
  }, intervalMs);
  console.log(`[TopScholar PlanSync] worker started (every ${Math.round(intervalMs / 1000)}s, direct concurrency 1)`);
}