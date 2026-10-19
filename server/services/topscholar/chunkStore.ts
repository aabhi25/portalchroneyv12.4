import { getContentPool, ensureContentSchema, toVectorLiteral } from './contentDb';
import {
  deleteMongoCpChunks,
  deleteMongoCpChunksByVersion,
  insertMongoChunks,
  type MongoChunkDoc,
} from './mongoContentDb';
import type { TopscholarConfig } from './config';

/**
 * Destination-agnostic writer for curriculum chunk embeddings. Branches on the
 * resolved store type (pgvector vs MongoDB Atlas) so ingestion (sample sync) and the
 * Batch API poller (full sync) share one code path and never drift apart.
 */

export interface StoreChunk {
  board: string | null;
  medium: string | null;
  grade: string | null;
  contentType: string;
  subject: string | null;
  subjectId: string | null;
  chapter: string | null;
  title: string | null;
  contentHtml: string | null;
  contentText: string;
  sourceRef: string | null;
  mediaUrl: string | null;
  metadata: Record<string, unknown>;
  contentHash: string | null;
  embedding: number[];
  // Full-sync run that writes this chunk (swap-in resync). Omitted => unversioned.
  syncVersion?: string | null;
}

/**
 * Replaces ALL chunks for (businessAccountId, cpId) with the supplied set, atomically
 * where the store supports it. Used for a clean, idempotent per-cp_id sync.
 */
export async function replaceCpChunks(
  cfg: TopscholarConfig,
  businessAccountId: string,
  cpId: string,
  chunks: StoreChunk[],
): Promise<number> {
  if (cfg.storeType === 'mongodb') {
    return replaceMongo(cfg, businessAccountId, cpId, chunks);
  }
  return replacePgvector(cfg, businessAccountId, cpId, chunks);
}

async function replacePgvector(
  cfg: TopscholarConfig,
  businessAccountId: string,
  cpId: string,
  chunks: StoreChunk[],
): Promise<number> {
  const pool = getContentPool(cfg.contentDbUrl);
  await ensureContentSchema(pool);

  const client = await pool.connect();
  let written = 0;
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM topscholar_content_chunks WHERE business_account_id = $1 AND cp_id = $2',
      [businessAccountId, cpId],
    );

    for (const c of chunks) {
      if (!c.embedding || c.embedding.length === 0) continue;
      await client.query(
        `INSERT INTO topscholar_content_chunks
          (business_account_id, cp_id, board, medium, grade, content_type, subject, subject_id, chapter, title,
           content_html, content_text, source_ref, media_url, embedding, metadata, content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::vector,$16::jsonb,$17)`,
        [
          businessAccountId, cpId, c.board, c.medium, c.grade, c.contentType, c.subject, c.subjectId, c.chapter, c.title,
          c.contentHtml, c.contentText, c.sourceRef, c.mediaUrl,
          toVectorLiteral(c.embedding), JSON.stringify(c.metadata || {}), c.contentHash,
        ],
      );
      written++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return written;
}

async function replaceMongo(
  cfg: TopscholarConfig,
  businessAccountId: string,
  cpId: string,
  chunks: StoreChunk[],
): Promise<number> {
  // MongoDB has no multi-document transaction without a session; for a single-cp_id
  // replace we delete-then-insert. The window is tiny and a sync is admin-triggered,
  // not student-facing, so a momentary gap is acceptable.
  await deleteCpChunks(cfg, businessAccountId, cpId);
  return appendCpChunks(cfg, businessAccountId, cpId, chunks);
}

/**
 * Deletes ALL chunks for (businessAccountId, cpId) in the destination store. Used by
 * the full-sync poller, which deletes once and then appends batch-by-batch so it never
 * has to hold every embedding for a huge cp_id in memory at once.
 */
export async function deleteCpChunks(
  cfg: TopscholarConfig,
  businessAccountId: string,
  cpId: string,
): Promise<void> {
  if (cfg.storeType === 'mongodb') {
    if (!cfg.contentDbUrl) throw new Error('MongoDB content DB URL is not configured.');
    await deleteMongoCpChunks({ connectionString: cfg.contentDbUrl, dbName: cfg.contentDbName, collection: cfg.contentDbCollection }, businessAccountId, cpId);
    return;
  }
  const pool = getContentPool(cfg.contentDbUrl);
  await ensureContentSchema(pool);
  await pool.query('DELETE FROM topscholar_content_chunks WHERE business_account_id = $1 AND cp_id = $2', [
    businessAccountId,
    cpId,
  ]);
}

export type ChunkVersionSelector = { except: string } | { only: string } | { versionedOnly: true };

/**
 * Deletes chunks for (businessAccountId, cpId) chosen by sync_version. Used by the
 * swap-in resync: { except: v } retires everything older once run v is complete,
 * { only: v } rolls back a failed/cancelled run v, and { versionedOnly: true } clears
 * leftovers of an interrupted run while unversioned rows are the live set.
 */
export async function deleteCpChunksByVersion(
  cfg: TopscholarConfig,
  businessAccountId: string,
  cpId: string,
  selector: ChunkVersionSelector,
): Promise<number> {
  if (cfg.storeType === 'mongodb') {
    if (!cfg.contentDbUrl) throw new Error('MongoDB content DB URL is not configured.');
    return deleteMongoCpChunksByVersion(
      { connectionString: cfg.contentDbUrl, dbName: cfg.contentDbName, collection: cfg.contentDbCollection },
      businessAccountId,
      cpId,
      selector,
    );
  }
  const pool = getContentPool(cfg.contentDbUrl);
  await ensureContentSchema(pool);
  const base = 'DELETE FROM topscholar_content_chunks WHERE business_account_id = $1 AND cp_id = $2';
  const res =
    'except' in selector
      ? await pool.query(`${base} AND sync_version IS DISTINCT FROM $3`, [businessAccountId, cpId, selector.except])
      : 'only' in selector
        ? await pool.query(`${base} AND sync_version = $3`, [businessAccountId, cpId, selector.only])
        : await pool.query(`${base} AND sync_version IS NOT NULL`, [businessAccountId, cpId]);
  return res.rowCount ?? 0;
}

/**
 * Appends chunks for (businessAccountId, cpId) WITHOUT deleting existing ones. Callers
 * that need replace semantics must call deleteCpChunks first. Returns rows written.
 */
export async function appendCpChunks(
  cfg: TopscholarConfig,
  businessAccountId: string,
  cpId: string,
  chunks: StoreChunk[],
): Promise<number> {
  const usable = chunks.filter((c) => c.embedding && c.embedding.length > 0);
  if (usable.length === 0) return 0;

  if (cfg.storeType === 'mongodb') {
    if (!cfg.contentDbUrl) throw new Error('MongoDB content DB URL is not configured.');
    const now = new Date();
    const docs: MongoChunkDoc[] = usable.map((c) => ({
      business_account_id: businessAccountId,
      cp_id: cpId,
      board: c.board,
      medium: c.medium,
      grade: c.grade,
      content_type: c.contentType,
      subject: c.subject,
      subject_id: c.subjectId,
      chapter: c.chapter,
      title: c.title,
      content_html: c.contentHtml,
      chunk_text: c.contentText,
      source_ref: c.sourceRef,
      media_url: c.mediaUrl,
      embedding: c.embedding,
      metadata: c.metadata || {},
      content_hash: c.contentHash,
      ...(c.syncVersion ? { sync_version: c.syncVersion } : {}),
      updated_at: now,
    }));
    return insertMongoChunks({ connectionString: cfg.contentDbUrl, dbName: cfg.contentDbName, collection: cfg.contentDbCollection }, docs);
  }

  const pool = getContentPool(cfg.contentDbUrl);
  await ensureContentSchema(pool);
  const client = await pool.connect();
  let written = 0;
  try {
    await client.query('BEGIN');
    for (const c of usable) {
      await client.query(
        `INSERT INTO topscholar_content_chunks
          (business_account_id, cp_id, board, medium, grade, content_type, subject, subject_id, chapter, title,
           content_html, content_text, source_ref, media_url, embedding, metadata, content_hash, sync_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::vector,$16::jsonb,$17,$18)`,
        [
          businessAccountId, cpId, c.board, c.medium, c.grade, c.contentType, c.subject, c.subjectId, c.chapter, c.title,
          c.contentHtml, c.contentText, c.sourceRef, c.mediaUrl,
          toVectorLiteral(c.embedding), JSON.stringify(c.metadata || {}), c.contentHash, c.syncVersion ?? null,
        ],
      );
      written++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return written;
}
