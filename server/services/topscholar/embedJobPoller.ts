import { db } from '../../db';
import {
  businessAccounts,
  topscholarContentSync,
  topscholarEmbedJobs,
  topscholarEmbedStaging,
} from '@shared/schema';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { getTopscholarConfig } from './config';
import { getBatchStatus, streamBatchResults } from './embeddingBatchService';
import { deleteCpChunks, appendCpChunks, type StoreChunk } from './chunkStore';
import { withCpLock } from './cpLock';

/**
 * Background poller that advances FULL-sync embedding jobs (OpenAI Batch API) to
 * completion. It is restart-safe: all job + staging state lives in Postgres, so on
 * boot it resumes any job left 'submitted'/'in_progress' before the process died.
 *
 * On each tick, for every active job:
 *   1. Refresh each OpenAI batch's status.
 *   2. When ALL batches in the job are terminal:
 *      - if all completed -> download outputs, join custom_id -> embedding with the
 *        staged chunk payloads, replace the cp_id's chunks in the destination store,
 *        clear staging, mark job + sync completed.
 *      - if any failed/expired/cancelled -> mark job + sync failed (staging kept for
 *        diagnostics until the next sync run clears it).
 */

const TERMINAL_OK = new Set(['completed']);
const TERMINAL_BAD = new Set(['failed', 'expired', 'cancelled']);

// A job stuck in 'preparing' (no batches created) longer than this crashed mid-submit.
const STALE_PREPARING_MS = 10 * 60 * 1000; // 10 minutes

let running = false;

async function syncJobStatus(jobId: string, businessAccountId: string, cpId: string, processed: number): Promise<void> {
  // Guard on embedJobId so an older, slow-finishing job can never overwrite the live
  // progress of a newer run that has since superseded it for this cp_id.
  await db
    .update(topscholarContentSync)
    .set({ processedCount: processed, updatedAt: new Date() })
    .where(
      and(
        eq(topscholarContentSync.businessAccountId, businessAccountId),
        eq(topscholarContentSync.cpId, cpId),
        eq(topscholarContentSync.embedJobId, jobId),
      ),
    );
}

async function finalizeFailed(job: typeof topscholarEmbedJobs.$inferSelect, message: string): Promise<void> {
  await db
    .update(topscholarEmbedJobs)
    .set({ status: 'failed', error: message, updatedAt: new Date() })
    .where(eq(topscholarEmbedJobs.id, job.id));
  // Only touch the sync row if it still points at THIS job — never clobber a newer run
  // that may have superseded this one while it was in flight.
  await db
    .update(topscholarContentSync)
    .set({ status: 'failed', lastError: message, embedJobId: null, updatedAt: new Date() })
    .where(
      and(
        eq(topscholarContentSync.businessAccountId, job.businessAccountId),
        eq(topscholarContentSync.cpId, job.cpId),
        eq(topscholarContentSync.embedJobId, job.id),
      ),
    );
  console.error(`[TopScholar EmbedPoller] Job ${job.id} failed: ${message}`);
}

// How many staged custom_ids to resolve + write per page. Bounds peak memory so a cp_id
// with lakhs of chunks never loads all staging rows (or all embeddings) at once.
const LANDING_PAGE_SIZE = 500;

async function completeJob(job: typeof topscholarEmbedJobs.$inferSelect): Promise<void> {
  // Resolve the destination config from the (current) account settings.
  const [account] = await db.select().from(businessAccounts).where(eq(businessAccounts.id, job.businessAccountId));
  if (!account) {
    await finalizeFailed(job, 'Business account no longer exists.');
    return;
  }
  const cfg = getTopscholarConfig(account);

  // SERIALIZE the whole landing against any concurrent full-sync REPLACE for this cp_id
  // (see cpLock.ts). Holding this lock guarantees no other run can delete this job's
  // staging (or replace the cp's chunks) between our staging check below and our writes —
  // which fully closes the supersede/wipe race. The lock is per-cp, so different cp_ids
  // still land in parallel.
  await withCpLock(job.businessAccountId, job.cpId, async () => {
  // CRASH/RACE SAFETY: re-read staging UNDER THE LOCK. If there is no staging for this job,
  // the embeddings were already landed (and staging cleared) on a prior attempt, OR a newer
  // sync run superseded and deleted this job's staging before we got the lock. In EITHER
  // case we must NOT run a destructive replace with an empty set — that would wipe the
  // cp_id's content. Just finalize idempotently.
  const [{ staged: stagedCount } = { staged: 0 }] = await db
    .select({ staged: sql<number>`count(*)::int` })
    .from(topscholarEmbedStaging)
    .where(eq(topscholarEmbedStaging.jobId, job.id));

  if (!stagedCount) {
    // Guard on != 'cancelled': if a cancel deleted this job's staging (and set it cancelled)
    // just before we took the lock, we must NOT flip it back to 'completed' — leave it
    // cancelled. No chunks are written here either way, so there is no destructive replace.
    await db
      .update(topscholarEmbedJobs)
      .set({ status: 'completed', error: null, updatedAt: new Date() })
      .where(and(eq(topscholarEmbedJobs.id, job.id), ne(topscholarEmbedJobs.status, 'cancelled')));
    console.log(`[TopScholar EmbedPoller] Job ${job.id} already landed (no staging); marked completed.`);
    return;
  }

  // LAZY DELETE (defence-in-depth atop the lock): we still delete the cp_id's existing
  // chunks only immediately before the FIRST confirmed non-empty write, and stream + page
  // the embeddings so peak memory stays bounded. A crash between delete and first append
  // leaves the job 'in_progress' with staging intact, so the next tick replays idempotently.
  let written = 0;
  let deleted = false;
  let buffer: Array<{ customId: string; embedding: number[] }> = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    const pageIds = buffer.map((b) => b.customId);
    const rows = await db
      .select()
      .from(topscholarEmbedStaging)
      .where(and(eq(topscholarEmbedStaging.jobId, job.id), inArray(topscholarEmbedStaging.customId, pageIds)));
    const stagedById = new Map(rows.map((r) => [r.customId, r]));

    const chunks: StoreChunk[] = [];
    for (const { customId, embedding } of buffer) {
      const s = stagedById.get(customId);
      if (!s) continue;
      chunks.push({
        contentType: s.contentType,
        subject: s.subject,
        subjectId: s.subjectId,
        chapter: s.chapter,
        title: s.title,
        contentHtml: s.contentHtml,
        contentText: s.contentText,
        sourceRef: s.sourceRef,
        mediaUrl: s.mediaUrl,
        metadata: (s.metadata || {}) as Record<string, unknown>,
        contentHash: s.contentHash,
        embedding,
      });
    }
    buffer = [];
    if (chunks.length === 0) return;

    if (!deleted) {
      await deleteCpChunks(cfg, job.businessAccountId, job.cpId);
      deleted = true;
    }
    written += await appendCpChunks(cfg, job.businessAccountId, job.cpId, chunks);
  };

  for (const b of job.batches) {
    if (!b.outputFileId) continue;
    // Stream the batch output; never materialize the whole file or a full embedding map.
    await streamBatchResults(job.businessAccountId, b.outputFileId, async (customId, embedding) => {
      buffer.push({ customId, embedding });
      if (buffer.length >= LANDING_PAGE_SIZE) await flush();
    });
    await flush();
    // Surface live progress as each batch lands.
    await syncJobStatus(job.id, job.businessAccountId, job.cpId, Math.min(written, job.totalCount));
  }

  // SAFETY: staged rows existed but nothing was written — the batch output was missing or
  // unreadable, OR a concurrent run superseded this job's staging. Because of lazy-delete
  // we have NOT touched the cp_id's content in this case, so just surface the failure; a
  // re-run (or the superseding run) repopulates.
  if (written === 0) {
    await finalizeFailed(job, 'Batch completed but no embeddings could be read from the output file(s).');
    return;
  }

  // Partial result: fewer chunks landed than were staged (some individual batch requests
  // failed at OpenAI). The content is still usable, so we complete — but surface a visible,
  // non-silent warning so the admin knows the curriculum is incomplete and can re-run.
  const partialWarning =
    written < stagedCount
      ? `Partial sync: embedded ${written} of ${stagedCount} chunks (some embedding requests failed). Re-run to fill the gap.`
      : null;

  // Mark completed BEFORE clearing staging, so a crash between the two leaves a completed
  // (non-resumable) job rather than an active job pointing at deleted staging. Guard on
  // != 'cancelled' so a cancel that landed while we held the lock isn't overwritten.
  await db
    .update(topscholarEmbedJobs)
    .set({ status: 'completed', completedCount: written, error: partialWarning, updatedAt: new Date() })
    .where(and(eq(topscholarEmbedJobs.id, job.id), ne(topscholarEmbedJobs.status, 'cancelled')));
  await db
    .update(topscholarContentSync)
    .set({
      status: 'completed',
      chunkCount: written,
      processedCount: written,
      lastError: partialWarning,
      lastSyncedAt: new Date(),
      embedJobId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(topscholarContentSync.businessAccountId, job.businessAccountId),
        eq(topscholarContentSync.cpId, job.cpId),
        eq(topscholarContentSync.embedJobId, job.id),
      ),
    );

  // Best-effort cleanup (safe to leave behind if this crashes — job is already completed).
  await db.delete(topscholarEmbedStaging).where(eq(topscholarEmbedStaging.jobId, job.id));

  console.log(`[TopScholar EmbedPoller] Job ${job.id} completed: wrote ${written} chunk(s) to ${cfg.storeType} for cp_id ${job.cpId}`);
  });
}

async function advanceJob(job: typeof topscholarEmbedJobs.$inferSelect): Promise<void> {
  const updatedBatches = [...job.batches];
  let allTerminal = true;
  let anyBad = false;
  let completedRequests = 0;

  for (let i = 0; i < updatedBatches.length; i++) {
    const b = updatedBatches[i];
    if (TERMINAL_OK.has(b.status) || TERMINAL_BAD.has(b.status)) {
      if (TERMINAL_BAD.has(b.status)) anyBad = true;
      completedRequests += b.count;
      continue;
    }
    // Still in flight — refresh.
    const status = await getBatchStatus(job.businessAccountId, b.batchId);
    updatedBatches[i] = { ...b, status: status.status, outputFileId: status.outputFileId };
    completedRequests += status.completed;
    if (TERMINAL_OK.has(status.status)) {
      // keep going
    } else if (TERMINAL_BAD.has(status.status)) {
      anyBad = true;
    } else {
      allTerminal = false;
    }
  }

  // Persist batch progress + live processed count. Guard on status != 'cancelled' so that if
  // the cancel endpoint fired while this tick was mid-flight (refreshing batch statuses over
  // the network), we neither flip the job back to 'in_progress' nor proceed to land/finalize
  // it. The next tick won't re-select it (cancelled is terminal for the poller's query).
  const advanced = await db
    .update(topscholarEmbedJobs)
    .set({
      batches: updatedBatches,
      status: allTerminal ? job.status : 'in_progress',
      updatedAt: new Date(),
    })
    .where(and(eq(topscholarEmbedJobs.id, job.id), ne(topscholarEmbedJobs.status, 'cancelled')))
    .returning({ id: topscholarEmbedJobs.id });
  if (advanced.length === 0) {
    // Job was cancelled while this tick was in flight — stop here, don't land or fail it.
    return;
  }
  await syncJobStatus(job.id, job.businessAccountId, job.cpId, Math.min(completedRequests, job.totalCount));

  if (!allTerminal) return;

  const refreshed = { ...job, batches: updatedBatches };
  if (anyBad) {
    await finalizeFailed(refreshed, 'One or more OpenAI batches failed, expired, or were cancelled.');
    return;
  }
  await completeJob(refreshed);
}

/** Processes all active embedding jobs once. Safe to call repeatedly. */
export async function processPendingEmbedJobs(): Promise<void> {
  if (running) return; // prevent overlapping ticks
  running = true;
  try {
    const jobs = await db
      .select()
      .from(topscholarEmbedJobs)
      .where(inArray(topscholarEmbedJobs.status, ['preparing', 'submitted', 'in_progress']));

    for (const job of jobs) {
      // 'preparing' means submission hadn't finished when the row was last written. A
      // job that stays 'preparing' past this threshold crashed mid-submit (its batches
      // were never created), so we surface it as failed instead of stranding it forever.
      // The admin can simply re-run the sync, which deletes this job + its staging and
      // starts cleanly.
      if (job.status === 'preparing' || job.batches.length === 0) {
        const ageMs = Date.now() - new Date(job.updatedAt).getTime();
        if (ageMs > STALE_PREPARING_MS) {
          await finalizeFailed(job, 'Sync submission did not complete (interrupted before batches were created). Please re-run the sync.');
        }
        continue;
      }
      try {
        await advanceJob(job);
      } catch (err: any) {
        console.error(`[TopScholar EmbedPoller] Error advancing job ${job.id}:`, err?.message || err);
      }
    }
  } finally {
    running = false;
  }
}

let interval: NodeJS.Timeout | null = null;

/** Starts the periodic poller (idempotent). Runs once immediately, then on an interval. */
export function startEmbedJobPoller(intervalMs = 60000): void {
  if (interval) return;
  // Kick once shortly after boot to resume any in-flight jobs.
  setTimeout(() => {
    processPendingEmbedJobs().catch((e) => console.error('[TopScholar EmbedPoller] initial run failed:', e));
  }, 5000);
  interval = setInterval(() => {
    processPendingEmbedJobs().catch((e) => console.error('[TopScholar EmbedPoller] tick failed:', e));
  }, intervalMs);
  console.log(`[TopScholar EmbedPoller] started (every ${Math.round(intervalMs / 1000)}s)`);
}
