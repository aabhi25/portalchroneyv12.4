import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { businessAccounts, topscholarContentSync } from '@shared/schema';
import { getTopscholarConfig, type TopscholarConfig } from './config';
import { getContentPool } from './contentDb';
import { getMongoCollection } from './mongoContentDb';

/**
 * Per-pack content counts for the admin "Ext. Content" page.
 *
 * Counting a MongoDB content store means visiting every embedded chunk (each carries a
 * 1536-number embedding), so the page used to wait seconds on every open. Now:
 *  - the counts are saved on topscholar_content_sync whenever a sync completes (and on
 *    "Refresh counts"), and the page reads those — no content-store query on open;
 *  - a compound index lets MongoDB count from the index alone (created automatically,
 *    in the background, the first time it is needed);
 *  - only the LIVE copy is counted: a swap-in resync writes a new sync_version beside the
 *    old one, and only topscholar_content_sync.activeSyncVersion is live (no active version
 *    recorded => every row of the pack is live) — the same rule as the RAG reader.
 */

export const COUNTED_TYPES = ['question', 'transcript', 'note', 'ebook_page'] as const;
export type CountRow = { cp_id: string; content_type: string; n: number };

const COUNT_INDEX_NAME = 'chroney_pack_counts';
const indexEnsured = new Set<string>();

/** Creates the counting index once per collection (background; failures are only logged). */
async function ensureCountIndex(cfg: TopscholarConfig): Promise<void> {
  const key = `${cfg.contentDbUrl}|${cfg.contentDbName ?? ''}|${cfg.contentDbCollection ?? ''}`;
  if (indexEnsured.has(key) || !cfg.contentDbUrl) return;
  indexEnsured.add(key);
  try {
    const col = await getMongoCollection(cfg.contentDbUrl, cfg.contentDbName, cfg.contentDbCollection);
    await col.createIndex(
      { business_account_id: 1, cp_id: 1, content_type: 1, sync_version: 1 },
      { name: COUNT_INDEX_NAME, background: true },
    );
  } catch (error: any) {
    indexEnsured.delete(key); // try again next time
    console.warn('[TopScholar Counts] could not create the counting index:', error?.message || error);
  }
}

/** cp_id → live sync_version (null = every row of the pack is live). */
export async function liveVersions(businessAccountId: string, cpIds?: string[]): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ cpId: topscholarContentSync.cpId, version: topscholarContentSync.activeSyncVersion })
    .from(topscholarContentSync)
    .where(cpIds && cpIds.length
      ? and(eq(topscholarContentSync.businessAccountId, businessAccountId), inArray(topscholarContentSync.cpId, cpIds))
      : eq(topscholarContentSync.businessAccountId, businessAccountId));
  return new Map(rows.map((r) => [r.cpId, r.version ?? null]));
}

/** The live version of one pack (null = all rows live). */
export async function liveVersionFor(businessAccountId: string, cpId: string): Promise<string | null> {
  return (await liveVersions(businessAccountId, [cpId])).get(cpId) ?? null;
}

function keepLive(rows: Array<CountRow & { sync_version: string | null }>, live: Map<string, string | null>): CountRow[] {
  const out = new Map<string, CountRow>();
  for (const r of rows) {
    const v = live.get(r.cp_id) ?? null;
    if (v && r.sync_version !== v) continue;
    const k = `${r.cp_id}|${r.content_type}`;
    const prev = out.get(k);
    if (prev) prev.n += Number(r.n);
    else out.set(k, { cp_id: r.cp_id, content_type: r.content_type, n: Number(r.n) });
  }
  return Array.from(out.values());
}

/** Live per-(pack, type) counts straight from the content store (optionally for some packs). */
export async function countLiveContent(cfg: TopscholarConfig, businessAccountId: string, cpIds?: string[]): Promise<CountRow[]> {
  const live = await liveVersions(businessAccountId, cpIds);
  if (cfg.storeType === 'mongodb') {
    if (!cfg.contentDbUrl) throw new Error('MongoDB content store is not configured.');
    await ensureCountIndex(cfg);
    const col = await getMongoCollection(cfg.contentDbUrl, cfg.contentDbName, cfg.contentDbCollection);
    const rows = await col
      .aggregate<{ _id: { cp_id: string; content_type: string; sync_version: string | null }; n: number }>([
        { $match: { business_account_id: businessAccountId, ...(cpIds && cpIds.length ? { cp_id: { $in: cpIds } } : {}) } },
        // Only indexed fields: MongoDB can answer from the index without loading documents.
        { $project: { _id: 0, cp_id: 1, content_type: 1, sync_version: 1 } },
        { $group: { _id: { cp_id: '$cp_id', content_type: '$content_type', sync_version: { $ifNull: ['$sync_version', null] } }, n: { $sum: 1 } } },
      ], { hint: COUNT_INDEX_NAME } as any)
      .toArray()
      .catch(async (error: any) => {
        // The index may still be building: count without the hint.
        if (!/hint|index/i.test(String(error?.message))) throw error;
        return col.aggregate<{ _id: { cp_id: string; content_type: string; sync_version: string | null }; n: number }>([
          { $match: { business_account_id: businessAccountId, ...(cpIds && cpIds.length ? { cp_id: { $in: cpIds } } : {}) } },
          { $project: { _id: 0, cp_id: 1, content_type: 1, sync_version: 1 } },
          { $group: { _id: { cp_id: '$cp_id', content_type: '$content_type', sync_version: { $ifNull: ['$sync_version', null] } }, n: { $sum: 1 } } },
        ]).toArray();
      });
    return keepLive(rows.map((r) => ({ cp_id: r._id.cp_id, content_type: r._id.content_type, sync_version: r._id.sync_version, n: r.n })), live);
  }
  const pool = getContentPool(cfg.contentDbUrl);
  try {
    const params: unknown[] = [businessAccountId];
    let where = 'business_account_id = $1';
    if (cpIds && cpIds.length) { params.push(cpIds); where += ' AND cp_id = ANY($2)'; }
    const { rows } = await pool.query(
      `SELECT cp_id, content_type, sync_version, count(*)::int AS n
         FROM topscholar_content_chunks WHERE ${where}
        GROUP BY cp_id, content_type, sync_version`,
      params,
    );
    return keepLive(rows, live);
  } catch (e: any) {
    if (e?.code === '42P01') return []; // never synced: no table yet
    throw e;
  }
}

/** Writes the per-pack totals onto topscholar_content_sync (packs with no rows get zeros). */
export async function saveCounts(businessAccountId: string, rows: CountRow[], cpIds?: string[]): Promise<void> {
  const byCp = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const c = byCp.get(r.cp_id) || {};
    c[r.content_type] = (c[r.content_type] || 0) + Number(r.n);
    byCp.set(r.cp_id, c);
  }
  const targets = cpIds && cpIds.length ? cpIds : Array.from((await liveVersions(businessAccountId)).keys());
  for (const cpId of targets) {
    const c = byCp.get(cpId) || {};
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    await db
      .update(topscholarContentSync)
      .set({
        noteCount: c['note'] || 0,
        transcriptCount: c['transcript'] || 0,
        ebookPageCount: c['ebook_page'] || 0,
        questionCount: c['question'] || 0,
        chunkCount: total,
        updatedAt: new Date(),
      })
      .where(and(eq(topscholarContentSync.businessAccountId, businessAccountId), eq(topscholarContentSync.cpId, cpId)));
  }
}

/** The saved totals as count rows (what the page shows without touching the content store). */
export async function savedCounts(businessAccountId: string): Promise<CountRow[]> {
  const rows = await db.select().from(topscholarContentSync).where(eq(topscholarContentSync.businessAccountId, businessAccountId));
  return rows.flatMap((s) => [
    { cp_id: s.cpId, content_type: 'question', n: s.questionCount },
    { cp_id: s.cpId, content_type: 'transcript', n: s.transcriptCount },
    { cp_id: s.cpId, content_type: 'note', n: s.noteCount },
    { cp_id: s.cpId, content_type: 'ebook_page', n: s.ebookPageCount },
  ]).filter((r) => r.n > 0);
}

/**
 * After a sync completes: recount that pack's live copy and save it (best effort — a
 * failure leaves the run's own totals in place and is only logged).
 */
export async function refreshSavedContentCounts(businessAccountId: string, cpId?: string): Promise<void> {
  try {
    const [account] = await db.select().from(businessAccounts).where(eq(businessAccounts.id, businessAccountId));
    if (!account) return;
    const cfg = getTopscholarConfig(account);
    const cpIds = cpId ? [cpId] : undefined;
    const rows = await countLiveContent(cfg, businessAccountId, cpIds);
    await saveCounts(businessAccountId, rows, cpIds);
  } catch (error: any) {
    console.warn(`[TopScholar Counts] recount after sync failed (${cpId ?? 'all packs'}):`, error?.message || error);
  }
}
