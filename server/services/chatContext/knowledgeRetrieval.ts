/**
 * Hybrid retrieval for the website chat: one ranked, de-duplicated, token-budgeted
 * list across FAQs, training-document chunks, trained-URL chunks and website-page /
 * document-summary passages.
 *
 * Scoring = 0.7 × vector similarity + 0.3 × keyword coverage (IDF-weighted). A
 * candidate qualifies on vector similarity alone (legacy-like thresholds) or on strong
 * keyword coverage with reasonable similarity, which catches exact names, codes and
 * prices that embeddings miss. Near-duplicates are dropped and the rest is picked
 * MMR-style so a handful of near-identical chunks can't crowd out other sources.
 *
 * Every query is filtered by business_account_id; passages come from the account's
 * own cache entry. There is no code path that mixes accounts.
 */
import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { faqs, documentChunks, trainingDocuments, urlContentChunks, trainedUrls } from '../../../shared/schema';
import type { KnowledgePassage } from './businessProfile';
import type { RetrievalQuery } from './conversationWindow';
import { jaccard, keywordPatterns, lexicalScore, queryTerms, tokenSet } from './lexical';
import { cosine, getPassageVector, truncateNormalize } from './passageVectors';
import { estimateTokens, truncateToTokens } from './tokens';

export type KnowledgeSource = 'faq' | 'document' | 'url' | 'page' | 'doc_summary';

export interface KnowledgeItem {
  key: string;
  source: KnowledgeSource;
  title: string;
  text: string;
  vectorScore: number | null;
  lexicalScore: number;
  score: number;
}

export interface RetrievalOptions {
  perSourceK: number;
  budgetTokens: number;
  maxItems: number;
  maxItemTokens: number;
  mmrLambda: number;
  duplicateJaccard: number;
  thresholds: Record<KnowledgeSource, number>;
}

export const DEFAULT_RETRIEVAL_OPTIONS: RetrievalOptions = {
  perSourceK: 8,
  budgetTokens: 1800,
  maxItems: 8,
  maxItemTokens: 450,
  mmrLambda: 0.75,
  duplicateJaccard: 0.8,
  // Vector-only qualification (legacy used 0.40 for FAQs and 0.50 for chunks).
  thresholds: { faq: 0.4, document: 0.45, url: 0.45, page: 0.45, doc_summary: 0.45 },
};

export interface RetrievalResult {
  items: KnowledgeItem[];
  text: string;
  tokens: number;
  candidates: number;
  usedVectors: boolean;
}

export interface RetrieveInput {
  businessAccountId: string;
  query: RetrievalQuery;
  passages?: KnowledgePassage[];
  /** Returns the query embedding, or null when embeddings are unavailable. */
  embedQuery?: (text: string) => Promise<number[] | null>;
  options?: Partial<RetrievalOptions>;
}

interface Candidate {
  key: string;
  source: KnowledgeSource;
  title: string;
  text: string;
  vectorScore: number | null;
}

// pgvector ≥ 0.8 can keep scanning the HNSW graph until enough rows pass the
// business_account_id filter; without it a filtered ANN scan can return too few rows.
let iterativeScan: boolean | null = null;
async function withVectorScan<T>(fn: (q: typeof db) => Promise<T>): Promise<T> {
  if (iterativeScan === false) return fn(db);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
      return fn(tx as unknown as typeof db);
    });
  } catch (err: any) {
    if (iterativeScan === null && /iterative_scan|configuration parameter/i.test(String(err?.message))) {
      iterativeScan = false;
      return fn(db);
    }
    throw err;
  } finally {
    if (iterativeScan === null) iterativeScan = true;
  }
}

const likeAny = (column: SQL | any, patterns: string[]) =>
  sql`${column} ILIKE ANY(ARRAY[${sql.join(patterns.map(p => sql`${p}`), sql`, `)}])`;
const matchCount = (column: SQL | any, patterns: string[]) =>
  sql.join(patterns.map(p => sql`(CASE WHEN ${column} ILIKE ${p} THEN 1 ELSE 0 END)`), sql` + `);

async function faqCandidates(accountId: string, vec: string | null, patterns: string[], k: number): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const toCand = (r: { id: string; question: string; answer: string; distance: number | null }): Candidate => ({
    key: `faq:${r.id}`, source: 'faq', title: r.question, text: `Q: ${r.question}\nA: ${r.answer}`,
    vectorScore: r.distance == null ? null : 1 - Number(r.distance),
  });
  const distance = vec
    ? sql<number | null>`CASE WHEN ${faqs.embedding} IS NULL THEN NULL ELSE ${faqs.embedding} <=> ${vec}::vector END`
    : sql<number | null>`NULL`;
  const [byVector, byKeyword] = await Promise.all([
    vec
      ? withVectorScan(q => q.select({ id: faqs.id, question: faqs.question, answer: faqs.answer, distance: sql<number>`${faqs.embedding} <=> ${vec}::vector` })
          .from(faqs)
          .where(and(eq(faqs.businessAccountId, accountId), isNotNull(faqs.embedding)))
          .orderBy(sql`${faqs.embedding} <=> ${vec}::vector`)
          .limit(k))
      : Promise.resolve([]),
    patterns.length
      ? db.select({ id: faqs.id, question: faqs.question, answer: faqs.answer, distance })
          .from(faqs)
          .where(and(eq(faqs.businessAccountId, accountId), sql`(${likeAny(faqs.question, patterns)} OR ${likeAny(faqs.answer, patterns)})`))
          .orderBy(sql`(${matchCount(faqs.question, patterns)}) DESC`)
          .limit(k)
      : Promise.resolve([]),
  ]);
  for (const r of [...byVector, ...byKeyword]) out.push(toCand(r as any));
  return out;
}

async function documentCandidates(accountId: string, vec: string | null, patterns: string[], k: number): Promise<Candidate[]> {
  const cols = {
    id: documentChunks.id, text: documentChunks.chunkText, title: trainingDocuments.originalFilename,
  };
  const base = and(eq(documentChunks.businessAccountId, accountId), eq(trainingDocuments.uploadStatus, 'completed'));
  const distance = vec
    ? sql<number | null>`CASE WHEN ${documentChunks.embedding} IS NULL THEN NULL ELSE ${documentChunks.embedding} <=> ${vec}::vector END`
    : sql<number | null>`NULL`;
  const [byVector, byKeyword] = await Promise.all([
    vec
      ? withVectorScan(q => q.select({ ...cols, distance: sql<number>`${documentChunks.embedding} <=> ${vec}::vector` })
          .from(documentChunks)
          .innerJoin(trainingDocuments, eq(documentChunks.trainingDocumentId, trainingDocuments.id))
          .where(and(base, isNotNull(documentChunks.embedding)))
          .orderBy(sql`${documentChunks.embedding} <=> ${vec}::vector`)
          .limit(k))
      : Promise.resolve([]),
    patterns.length
      ? db.select({ ...cols, distance })
          .from(documentChunks)
          .innerJoin(trainingDocuments, eq(documentChunks.trainingDocumentId, trainingDocuments.id))
          .where(and(base, likeAny(documentChunks.chunkText, patterns)))
          .orderBy(sql`(${matchCount(documentChunks.chunkText, patterns)}) DESC`)
          .limit(k)
      : Promise.resolve([]),
  ]);
  return [...byVector, ...byKeyword].map((r: any) => ({
    key: `document:${r.id}`, source: 'document' as const, title: r.title, text: r.text,
    vectorScore: r.distance == null ? null : 1 - Number(r.distance),
  }));
}

async function urlCandidates(accountId: string, vec: string | null, patterns: string[], k: number): Promise<Candidate[]> {
  const cols = {
    id: urlContentChunks.id, text: urlContentChunks.chunkText, title: trainedUrls.title, url: trainedUrls.url,
  };
  const base = and(
    eq(urlContentChunks.businessAccountId, accountId),
    eq(trainedUrls.status, 'completed'),
    eq(trainedUrls.embeddingStatus, 'completed'),
  );
  const distance = vec
    ? sql<number | null>`CASE WHEN ${urlContentChunks.embedding} IS NULL THEN NULL ELSE ${urlContentChunks.embedding} <=> ${vec}::vector END`
    : sql<number | null>`NULL`;
  const [byVector, byKeyword] = await Promise.all([
    vec
      ? withVectorScan(q => q.select({ ...cols, distance: sql<number>`${urlContentChunks.embedding} <=> ${vec}::vector` })
          .from(urlContentChunks)
          .innerJoin(trainedUrls, eq(urlContentChunks.trainedUrlId, trainedUrls.id))
          .where(and(base, isNotNull(urlContentChunks.embedding)))
          .orderBy(sql`${urlContentChunks.embedding} <=> ${vec}::vector`)
          .limit(k))
      : Promise.resolve([]),
    patterns.length
      ? db.select({ ...cols, distance })
          .from(urlContentChunks)
          .innerJoin(trainedUrls, eq(urlContentChunks.trainedUrlId, trainedUrls.id))
          .where(and(base, likeAny(urlContentChunks.chunkText, patterns)))
          .orderBy(sql`(${matchCount(urlContentChunks.chunkText, patterns)}) DESC`)
          .limit(k)
      : Promise.resolve([]),
  ]);
  return [...byVector, ...byKeyword].map((r: any) => ({
    key: `url:${r.id}`, source: 'url' as const, title: r.title || r.url, text: r.text,
    vectorScore: r.distance == null ? null : 1 - Number(r.distance),
  }));
}

// Token sets for passages are computed once per passage object.
const passageTokenCache = new WeakMap<KnowledgePassage, { body: Set<string>; title: Set<string> }>();
function passageTokens(p: KnowledgePassage) {
  let t = passageTokenCache.get(p);
  if (!t) { t = { body: tokenSet(p.text), title: tokenSet(p.title) }; passageTokenCache.set(p, t); }
  return t;
}

function passageCandidates(
  accountId: string,
  passages: KnowledgePassage[],
  terms: ReturnType<typeof queryTerms>,
  queryVec: Float32Array | null,
  k: number,
): Candidate[] {
  if (!passages.length) return [];
  const termSet = new Set(terms.map(t => t.term));
  const scored = passages.map(p => {
    const toks = passageTokens(p);
    let overlap = 0;
    termSet.forEach(t => { if (toks.body.has(t) || toks.title.has(t)) overlap++; });
    const v = queryVec ? getPassageVector(accountId, p) : undefined;
    return { p, overlap, vec: v && queryVec ? cosine(queryVec, v) : null };
  });
  const byKeyword = scored.filter(s => s.overlap > 0).sort((a, b) => b.overlap - a.overlap).slice(0, k * 2);
  const byVector = scored.filter(s => s.vec != null).sort((a, b) => (b.vec as number) - (a.vec as number)).slice(0, k);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const s of [...byVector, ...byKeyword]) {
    if (seen.has(s.p.id)) continue;
    seen.add(s.p.id);
    out.push({ key: `${s.p.source}:${s.p.id}`, source: s.p.source, title: s.p.title, text: s.p.text, vectorScore: s.vec });
  }
  return out;
}

const SOURCE_LABEL: Record<KnowledgeSource, string> = {
  faq: 'FAQ',
  document: 'Document excerpt',
  url: 'Web page excerpt',
  page: 'Website page',
  doc_summary: 'Document summary',
};

/** Same markers as the legacy RAG block so llamaService lifts it into the final override. */
export const KNOWLEDGE_START_MARKER = '🔒 CRITICAL DOCUMENT KNOWLEDGE - HIGHEST PRIORITY:';
const KNOWLEDGE_END_LINE = `- Do NOT say "I don't have information" when the answer is clearly in the excerpts above`;

export function formatKnowledgeItem(item: KnowledgeItem, maxTokens: number): string {
  const body = truncateToTokens(item.text, maxTokens);
  if (item.source === 'faq') return `[FAQ]\n${body}`;
  return `[${SOURCE_LABEL[item.source]} — ${item.title}]\n${body}`;
}

export function formatKnowledgeBlock(items: KnowledgeItem[], maxItemTokens = DEFAULT_RETRIEVAL_OPTIONS.maxItemTokens): string {
  if (!items.length) return '';
  let s = `\n${KNOWLEDGE_START_MARKER}\n`;
  s += `The following business knowledge (FAQs, website pages and uploaded documents) was retrieved for the visitor's question, most relevant first.\n`;
  s += `This is BUSINESS-SPECIFIC information that you MUST use to answer questions.\n\n`;
  s += items.map(i => formatKnowledgeItem(i, maxItemTokens)).join('\n\n');
  s += `\n\n🚨 MANDATORY INSTRUCTION:\n`;
  s += `- The above excerpts are BUSINESS-SPECIFIC knowledge provided by the business owner\n`;
  s += `- Use this information to answer the current question accurately and naturally\n`;
  s += `- This is NOT general knowledge - this is specific business documentation\n`;
  s += `${KNOWLEDGE_END_LINE}\n\n`;
  return s;
}

const BLOCK_OVERHEAD_TOKENS = estimateTokens(formatKnowledgeBlock([{ key: 'x', source: 'faq', title: '', text: '', vectorScore: 0, lexicalScore: 0, score: 0 }]));

/** Score, filter, de-duplicate and budget a candidate pool (pure; exported for tests). */
export function rankCandidates(candidates: Candidate[], query: RetrievalQuery, options: RetrievalOptions): KnowledgeItem[] {
  // Merge duplicates of the same row (found by both vector and keyword lookups).
  const merged = new Map<string, Candidate>();
  for (const c of candidates) {
    const prev = merged.get(c.key);
    if (!prev) merged.set(c.key, { ...c });
    else if (c.vectorScore != null && (prev.vectorScore == null || c.vectorScore > prev.vectorScore)) prev.vectorScore = c.vectorScore;
  }
  const pool = Array.from(merged.values());
  if (!pool.length) return [];

  const terms = queryTerms(query.primary, query.context);
  const tokenSets = pool.map(c => tokenSet(c.text));
  const titleSets = pool.map(c => tokenSet(c.title));
  const df = new Map<string, number>();
  for (const s of tokenSets) s.forEach(t => df.set(t, (df.get(t) || 0) + 1));

  const scored: Array<KnowledgeItem & { tokens: Set<string> }> = pool.map((c, i) => {
    const lex = lexicalScore(terms, tokenSets[i], df, pool.length, titleSets[i]);
    const vec = c.vectorScore;
    const score = vec != null ? 0.7 * vec + 0.3 * lex : 0.55 * lex;
    return { key: c.key, source: c.source, title: c.title, text: c.text, vectorScore: vec, lexicalScore: lex, score, tokens: tokenSets[i] };
  });

  const qualified = scored.filter(c => {
    const t = options.thresholds[c.source];
    if (c.vectorScore != null && c.vectorScore >= t) return true;
    if (c.lexicalScore >= 0.5 && (c.vectorScore == null || c.vectorScore >= t - 0.12)) return true;
    return false;
  }).sort((a, b) => b.score - a.score);

  // MMR-style selection with a hard near-duplicate cut and a token budget.
  const selected: typeof qualified = [];
  let used = BLOCK_OVERHEAD_TOKENS;
  const remaining = qualified.slice();
  while (remaining.length && selected.length < options.maxItems) {
    let bestIdx = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const maxSim = selected.reduce((m, s) => Math.max(m, jaccard(c.tokens, s.tokens)), 0);
      if (maxSim >= options.duplicateJaccard) continue;
      const val = options.mmrLambda * c.score - (1 - options.mmrLambda) * maxSim;
      if (val > bestVal) { bestVal = val; bestIdx = i; }
    }
    if (bestIdx < 0) break;
    const [pick] = remaining.splice(bestIdx, 1);
    const cost = estimateTokens(formatKnowledgeItem(pick, options.maxItemTokens)) + 1;
    if (used + cost > options.budgetTokens) {
      if (selected.length === 0) {
        // Always allow one (truncated) item so a long best match is never lost entirely.
        selected.push(pick);
        used += cost;
      }
      continue;
    }
    selected.push(pick);
    used += cost;
  }
  return selected.map(({ tokens: _t, ...item }) => item);
}

export async function retrieveKnowledge(input: RetrieveInput): Promise<RetrievalResult> {
  const options: RetrievalOptions = { ...DEFAULT_RETRIEVAL_OPTIONS, ...(input.options || {}),
    thresholds: { ...DEFAULT_RETRIEVAL_OPTIONS.thresholds, ...(input.options?.thresholds || {}) } };
  const { businessAccountId, query } = input;
  if (!query.query.trim()) return { items: [], text: '', tokens: 0, candidates: 0, usedVectors: false };

  // Follow-ups are embedded twice — with the earlier turn folded in, and as typed — so a
  // short standalone question that merely looked like a follow-up is not diluted.
  const embed = async (text: string): Promise<number[] | null> => {
    if (!input.embedQuery) return null;
    try { return await input.embedQuery(text); } catch (err) {
      console.warn('[ChatContext] Query embedding failed — keyword retrieval only:', (err as Error)?.message);
      return null;
    }
  };
  const [embedding, primaryEmbedding] = await Promise.all([
    embed(query.query),
    query.isFollowUp && query.primary.trim() && query.primary !== query.query ? embed(query.primary) : Promise.resolve(null),
  ]);
  const vec = embedding ? JSON.stringify(embedding) : null;
  const vecPrimary = primaryEmbedding ? JSON.stringify(primaryEmbedding) : null;
  const terms = queryTerms(query.primary, query.context);
  const patterns = keywordPatterns(terms);
  const k = options.perSourceK;

  const settle = async (p: Promise<Candidate[]>, label: string): Promise<Candidate[]> => {
    try { return await p; } catch (err) { console.error(`[ChatContext] ${label} retrieval failed:`, (err as Error)?.message); return []; }
  };
  const lookups: Array<Promise<Candidate[]>> = [
    settle(faqCandidates(businessAccountId, vec, patterns, k), 'FAQ'),
    settle(documentCandidates(businessAccountId, vec, patterns, k), 'Document'),
    settle(urlCandidates(businessAccountId, vec, patterns, k), 'URL'),
  ];
  if (vecPrimary) {
    lookups.push(
      settle(faqCandidates(businessAccountId, vecPrimary, [], k), 'FAQ'),
      settle(documentCandidates(businessAccountId, vecPrimary, [], k), 'Document'),
      settle(urlCandidates(businessAccountId, vecPrimary, [], k), 'URL'),
    );
  }
  const dbCandidates = ([] as Candidate[]).concat(...(await Promise.all(lookups)));
  const passC = [
    ...passageCandidates(businessAccountId, input.passages || [], terms, embedding ? truncateNormalize(embedding) : null, k),
    ...(primaryEmbedding ? passageCandidates(businessAccountId, input.passages || [], terms, truncateNormalize(primaryEmbedding), k) : []),
  ];

  const all = [...dbCandidates, ...passC];
  const items = rankCandidates(all, query, options);
  const text = formatKnowledgeBlock(items, options.maxItemTokens);
  return { items, text, tokens: estimateTokens(text), candidates: all.length, usedVectors: !!embedding };
}
