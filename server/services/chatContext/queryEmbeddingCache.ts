/**
 * In-process LRU cache for website-chat QUERY embeddings: per account, up to 200
 * entries, 10 minutes each. Repeated questions ("what are the fees?" from many
 * visitors) skip the embedding round trip (0.3–2 s from India), and two lookups of
 * the same text in flight at once (the speculative early retrieval and the real one)
 * share one request.
 *
 * Keyed by the exact query text: the embedding is a pure function of the text, so a
 * hit returns exactly what a fresh call would. Nothing here depends on training data,
 * so training changes need no invalidation. Failures are never cached.
 */

const MAX_PER_ACCOUNT = 200;
const MAX_ACCOUNTS = 1000;
const TTL_MS = 10 * 60 * 1000;

interface Entry { value: Promise<number[]>; at: number }

// Map iteration order = recency (entries are re-inserted on every hit).
const accounts = new Map<string, Map<string, Entry>>();
const stats = { hits: 0, misses: 0 };

export async function embedQueryCached(
  businessAccountId: string,
  text: string,
  embed: (text: string) => Promise<number[]>,
): Promise<number[]> {
  const now = Date.now();
  let cache = accounts.get(businessAccountId);
  if (cache) {
    accounts.delete(businessAccountId);
    accounts.set(businessAccountId, cache);
  } else {
    cache = new Map();
    accounts.set(businessAccountId, cache);
    if (accounts.size > MAX_ACCOUNTS) {
      const oldest = accounts.keys().next().value;
      if (oldest !== undefined) accounts.delete(oldest);
    }
  }
  const hit = cache.get(text);
  if (hit && now - hit.at < TTL_MS) {
    cache.delete(text);
    cache.set(text, hit);
    stats.hits++;
    return hit.value;
  }
  if (hit) cache.delete(text);
  stats.misses++;
  const value = embed(text);
  const entry: Entry = { value, at: now };
  cache.set(text, entry);
  if (cache.size > MAX_PER_ACCOUNT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  value.catch(() => {
    if (cache!.get(text) === entry) cache!.delete(text);
  });
  return value;
}

export function queryEmbeddingCacheStats(): { hits: number; misses: number } {
  return { ...stats };
}

/** Tests: drop everything (or one account). */
export function clearQueryEmbeddingCache(businessAccountId?: string): void {
  if (businessAccountId) accounts.delete(businessAccountId);
  else accounts.clear();
  stats.hits = 0;
  stats.misses = 0;
}
