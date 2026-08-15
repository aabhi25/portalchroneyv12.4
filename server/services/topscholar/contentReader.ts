import { db } from '../../db';
import { topscholarCpMappings, topscholarContentSync } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { getContentPool } from './contentDb';
import type { TopscholarConfig } from './config';

/**
 * Read-only reader for the extracted curriculum content store (pgvector). Powers the
 * admin "Ext. Content" viewer. Every query is scoped by businessAccountId and NEVER
 * selects the embedding vector column (it is large and useless for display).
 *
 * Reads go through the SAME content pool the sync writes to (local stand-in pool when
 * the account has no external contentDbUrl). MongoDB stores are not supported here —
 * the route guards on cfg.storeType before calling in.
 */

const CONTENT_TYPE_KEYS = ['question', 'transcript', 'note', 'ebook_page'] as const;
type ContentTypeKey = typeof CONTENT_TYPE_KEYS[number];

export interface ContentPackOverview {
  cpId: string;
  label: string;
  cpName: string | null;
  board: string | null;
  medium: string | null;
  grade: string | null;
  status: string | null;
  lastSyncedAt: Date | null;
  counts: Record<ContentTypeKey, number>;
  total: number;
}

export interface ChapterBreakdown {
  chapter: string | null;
  contentType: string;
  count: number;
}

export interface ContentChunkItem {
  id: string;
  contentType: string;
  chapter: string | null;
  title: string | null;
  contentHtml: string | null;
  contentText: string;
  sourceRef: string | null;
  mediaUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface ChunkPage {
  items: ContentChunkItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ChunkQueryOptions {
  cpId: string;
  contentType?: string;
  chapter?: string; // '' / undefined => all; '__none__' => rows with NULL chapter; else exact match
  q?: string;
  page?: number;
  pageSize?: number;
}

const NULL_CHAPTER_SENTINEL = '__none__';

function buildLabel(board?: string | null, medium?: string | null, grade?: string | null): string | null {
  const parts = [board, medium, grade].filter(Boolean) as string[];
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Runs a query against the content pool, treating a missing table (a fresh content DB
 * that has never been synced) as "no rows" rather than a hard error.
 */
async function safeQuery(
  pool: ReturnType<typeof getContentPool>,
  text: string,
  params: unknown[],
): Promise<{ rows: any[] }> {
  try {
    return await pool.query(text, params);
  } catch (e: any) {
    if (e?.code === '42P01') return { rows: [] }; // undefined_table
    throw e;
  }
}

export async function getContentOverview(
  cfg: TopscholarConfig,
  businessAccountId: string,
): Promise<ContentPackOverview[]> {
  const pool = getContentPool(cfg.contentDbUrl);

  const { rows } = await safeQuery(
    pool,
    `SELECT cp_id, content_type, count(*)::int AS n
       FROM topscholar_content_chunks
      WHERE business_account_id = $1
      GROUP BY cp_id, content_type`,
    [businessAccountId],
  );

  const mappings = await db
    .select()
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));
  const syncRows = await db
    .select()
    .from(topscholarContentSync)
    .where(eq(topscholarContentSync.businessAccountId, businessAccountId));

  const byMapping = new Map(mappings.map((m) => [m.cpId, m]));
  const bySync = new Map(syncRows.map((s) => [s.cpId, s]));

  const countsByCp = new Map<string, Record<string, number>>();
  const cpIds = new Set<string>();
  for (const r of rows) {
    cpIds.add(r.cp_id);
    const c = countsByCp.get(r.cp_id) || {};
    c[r.content_type] = (c[r.content_type] || 0) + Number(r.n);
    countsByCp.set(r.cp_id, c);
  }
  // Include packs that have a sync record even if they hold zero chunks (e.g. syncing).
  for (const s of syncRows) cpIds.add(s.cpId);

  const packs: ContentPackOverview[] = [];
  for (const cpId of Array.from(cpIds)) {
    const m = byMapping.get(cpId);
    const s = bySync.get(cpId);
    const raw = countsByCp.get(cpId) || {};
    const counts: Record<ContentTypeKey, number> = {
      question: raw['question'] || 0,
      transcript: raw['transcript'] || 0,
      note: raw['note'] || 0,
      ebook_page: raw['ebook_page'] || 0,
    };
    const total = counts.question + counts.transcript + counts.note + counts.ebook_page;
    const label =
      m?.label || m?.cpName || buildLabel(m?.board, m?.medium, m?.grade) || cpId;
    packs.push({
      cpId,
      label,
      cpName: m?.cpName ?? null,
      board: m?.board ?? null,
      medium: m?.medium ?? null,
      grade: m?.grade ?? null,
      status: s?.status ?? null,
      lastSyncedAt: s?.lastSyncedAt ?? null,
      counts,
      total,
    });
  }

  packs.sort((a, b) => a.label.localeCompare(b.label));
  return packs;
}

export async function getChapters(
  cfg: TopscholarConfig,
  businessAccountId: string,
  cpId: string,
): Promise<ChapterBreakdown[]> {
  const pool = getContentPool(cfg.contentDbUrl);
  const { rows } = await safeQuery(
    pool,
    `SELECT chapter, content_type, count(*)::int AS n
       FROM topscholar_content_chunks
      WHERE business_account_id = $1 AND cp_id = $2
      GROUP BY chapter, content_type
      ORDER BY chapter NULLS LAST`,
    [businessAccountId, cpId],
  );
  return rows.map((r) => ({
    chapter: r.chapter,
    contentType: r.content_type,
    count: Number(r.n),
  }));
}

/**
 * Returns the distinct, non-blank chapter names stored across the given cp_id(s)
 * for a business account (pgvector store). Used to populate the Widget Tester's
 * chapter dropdown. Sorted alphabetically.
 */
export async function getChapterNamesForCpIds(
  cfg: TopscholarConfig,
  businessAccountId: string,
  cpIds: string[],
): Promise<string[]> {
  if (cpIds.length === 0) return [];
  const pool = getContentPool(cfg.contentDbUrl);
  const { rows } = await safeQuery(
    pool,
    `SELECT DISTINCT chapter
       FROM topscholar_content_chunks
      WHERE business_account_id = $1 AND cp_id = ANY($2)
        AND chapter IS NOT NULL AND btrim(chapter) <> ''
      ORDER BY chapter`,
    [businessAccountId, cpIds],
  );
  return rows.map((r) => r.chapter as string).filter(Boolean);
}

/**
 * Returns the distinct cp_ids that have at least one content chunk stored for a
 * business account (pgvector store). Used to filter the Widget Tester's scope
 * dropdowns down to packs that are actually testable (have synced content).
 */
export async function getCpIdsWithContent(
  cfg: TopscholarConfig,
  businessAccountId: string,
): Promise<Set<string>> {
  const pool = getContentPool(cfg.contentDbUrl);
  const { rows } = await safeQuery(
    pool,
    `SELECT DISTINCT cp_id
       FROM topscholar_content_chunks
      WHERE business_account_id = $1
        AND cp_id IS NOT NULL AND btrim(cp_id) <> ''`,
    [businessAccountId],
  );
  return new Set(rows.map((r) => r.cp_id as string).filter(Boolean));
}

export async function getChunks(
  cfg: TopscholarConfig,
  businessAccountId: string,
  opts: ChunkQueryOptions,
): Promise<ChunkPage> {
  const pool = getContentPool(cfg.contentDbUrl);

  const page = Math.max(1, Math.floor(Number(opts.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(opts.pageSize) || 50)));

  const conds: string[] = ['business_account_id = $1', 'cp_id = $2'];
  const params: unknown[] = [businessAccountId, opts.cpId];
  let i = 3;

  if (opts.contentType) {
    conds.push(`content_type = $${i++}`);
    params.push(opts.contentType);
  }
  if (opts.chapter) {
    if (opts.chapter === NULL_CHAPTER_SENTINEL) {
      conds.push('chapter IS NULL');
    } else {
      conds.push(`chapter = $${i++}`);
      params.push(opts.chapter);
    }
  }
  if (opts.q) {
    conds.push(`(title ILIKE $${i} OR content_text ILIKE $${i})`);
    params.push(`%${opts.q}%`);
    i++;
  }

  const where = conds.join(' AND ');

  const countRes = await safeQuery(
    pool,
    `SELECT count(*)::int AS n FROM topscholar_content_chunks WHERE ${where}`,
    params,
  );
  const total = Number(countRes.rows[0]?.n || 0);

  const listParams = params.slice();
  const limitIdx = i++;
  const offsetIdx = i++;
  listParams.push(pageSize, (page - 1) * pageSize);

  const listRes = await safeQuery(
    pool,
    `SELECT id, content_type, chapter, title, content_html, content_text,
            source_ref, media_url, metadata, created_at
       FROM topscholar_content_chunks
      WHERE ${where}
      ORDER BY chapter NULLS LAST, created_at, id
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    listParams,
  );

  const items: ContentChunkItem[] = listRes.rows.map((r) => ({
    id: r.id,
    contentType: r.content_type,
    chapter: r.chapter,
    title: r.title,
    contentHtml: r.content_html,
    contentText: r.content_text,
    sourceRef: r.source_ref,
    mediaUrl: r.media_url,
    metadata: (r.metadata as Record<string, unknown>) || {},
    createdAt: r.created_at,
  }));

  return { items, total, page, pageSize };
}
