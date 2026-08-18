import { ObjectId, type Collection, type Document } from 'mongodb';
import { getMongoCollection, type MongoChunkDoc } from './mongoContentDb';
import {
  assemblePackOverview,
  type ContentPackOverview,
  type ChapterBreakdown,
  type ContentChunkItem,
  type ChunkPage,
  type ChunkQueryOptions,
} from './contentReader';
import type { TopscholarConfig } from './config';

/**
 * Read-only reader for MongoDB-backed curriculum content stores. Powers the
 * admin "Ext. Content" viewer for accounts whose content store is MongoDB
 * Atlas. Mirrors the pgvector reader (contentReader.ts) exactly:
 *  - every query is hard-scoped by business_account_id
 *  - the embedding array is NEVER projected (large and useless for display)
 *  - response shapes match the existing API contracts, so the frontend
 *    requires no changes
 *
 * Only find/aggregate privileges are needed — a read-only Atlas user works.
 */

const NULL_CHAPTER_SENTINEL = '__none__';

// Uses the shared, shutdown-managed client cache in mongoContentDb.ts — no
// separate pool is created for the viewer.
async function getCollection(cfg: TopscholarConfig): Promise<Collection<MongoChunkDoc>> {
  const url = cfg.contentDbUrl;
  if (!url) throw new Error('MongoDB content store is not configured.');
  return getMongoCollection(url, cfg.contentDbName, cfg.contentDbCollection);
}

/** Escapes user input for safe use inside a $regex search. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function getMongoContentOverview(
  cfg: TopscholarConfig,
  businessAccountId: string,
): Promise<ContentPackOverview[]> {
  const col = await getCollection(cfg);
  const rows = await col
    .aggregate<{ _id: { cp_id: string; content_type: string }; n: number }>([
      { $match: { business_account_id: businessAccountId } },
      { $group: { _id: { cp_id: '$cp_id', content_type: '$content_type' }, n: { $sum: 1 } } },
    ])
    .toArray();

  return assemblePackOverview(
    rows.map((r) => ({ cp_id: r._id.cp_id, content_type: r._id.content_type, n: r.n })),
    businessAccountId,
  );
}

export async function getMongoChapters(
  cfg: TopscholarConfig,
  businessAccountId: string,
  cpId: string,
): Promise<ChapterBreakdown[]> {
  const col = await getCollection(cfg);
  const rows = await col
    .aggregate<{ _id: { chapter: string | null; content_type: string }; n: number }>([
      { $match: { business_account_id: businessAccountId, cp_id: cpId } },
      { $group: { _id: { chapter: { $ifNull: ['$chapter', null] }, content_type: '$content_type' }, n: { $sum: 1 } } },
      // Sort named chapters alphabetically with null chapters last (pgvector NULLS LAST parity).
      { $addFields: { chapterIsNull: { $cond: [{ $eq: ['$_id.chapter', null] }, 1, 0] } } },
      { $sort: { chapterIsNull: 1, '_id.chapter': 1, '_id.content_type': 1 } },
    ])
    .toArray();

  return rows.map((r) => ({
    chapter: r._id.chapter,
    contentType: r._id.content_type,
    count: r.n,
  }));
}

export async function getMongoChunks(
  cfg: TopscholarConfig,
  businessAccountId: string,
  opts: ChunkQueryOptions,
): Promise<ChunkPage> {
  const col = await getCollection(cfg);

  const page = Math.max(1, Math.floor(Number(opts.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(opts.pageSize) || 50)));

  const match: Document = {
    business_account_id: businessAccountId,
    cp_id: opts.cpId,
  };
  if (opts.contentType) match.content_type = opts.contentType;
  if (opts.chapter) {
    if (opts.chapter === NULL_CHAPTER_SENTINEL) {
      match.chapter = null; // matches both null values and missing fields
    } else {
      match.chapter = opts.chapter;
    }
  }
  if (opts.q) {
    const rx = new RegExp(escapeRegex(opts.q), 'i');
    match.$or = [{ title: rx }, { chunk_text: rx }];
  }

  const [facetResult] = await col
    .aggregate<{ total: Array<{ n: number }>; items: Document[] }>([
      { $match: match },
      {
        $facet: {
          total: [{ $count: 'n' }],
          items: [
            // Normalize missing → null (same as the chapter aggregation) so both are
            // reliably sorted last, matching pgvector's ORDER BY chapter NULLS LAST.
            { $addFields: { chapterIsNull: { $cond: [{ $eq: [{ $ifNull: ['$chapter', null] }, null] }, 1, 0] } } },
            { $sort: { chapterIsNull: 1, chapter: 1, updated_at: 1, _id: 1 } },
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },
            {
              // Never project the embedding vector.
              $project: {
                _id: 1,
                content_type: 1,
                chapter: 1,
                title: 1,
                content_html: 1,
                chunk_text: 1,
                source_ref: 1,
                media_url: 1,
                metadata: 1,
                updated_at: 1,
              },
            },
          ],
        },
      },
    ])
    .toArray();

  const total = facetResult?.total?.[0]?.n ?? 0;
  const items: ContentChunkItem[] = (facetResult?.items ?? []).map((d) => ({
    id: d._id instanceof ObjectId ? d._id.toHexString() : String(d._id),
    contentType: d.content_type,
    chapter: d.chapter ?? null,
    title: d.title ?? null,
    contentHtml: d.content_html ?? null,
    contentText: d.chunk_text ?? '',
    sourceRef: d.source_ref ?? null,
    mediaUrl: d.media_url ?? null,
    metadata: (d.metadata as Record<string, unknown>) || {},
    // Mongo documents carry updated_at only; the viewer uses it as the display timestamp.
    createdAt: d.updated_at ?? null,
  }));

  return { items, total, page, pageSize };
}
