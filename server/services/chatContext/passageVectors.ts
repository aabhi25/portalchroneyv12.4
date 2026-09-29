/**
 * In-memory embeddings for website-page / document-summary passages. Those passages
 * have no table of their own, so they are embedded once per process (in the
 * background, one batched call per account) and kept here, keyed by content hash, so a
 * cache rebuild with unchanged content costs nothing.
 *
 * Vectors are stored as the first PASSAGE_DIMS dimensions, re-normalised
 * (text-embedding-3 models are trained so that truncated vectors stay meaningful —
 * this is how their `dimensions` parameter works). 512 × 4 bytes = 2 KB per passage.
 */
import crypto from 'crypto';

export const PASSAGE_DIMS = 512;
const MAX_VECTORS = 12_000; // ≈ 24 MB
const store = new Map<string, Float32Array>();
const inFlight = new Set<string>();
const lastFailure = new Map<string, number>();
const RETRY_AFTER_MS = 10 * 60 * 1000;

export function truncateNormalize(vec: ArrayLike<number>, dims = PASSAGE_DIMS): Float32Array {
  const n = Math.min(dims, vec.length);
  const out = new Float32Array(n);
  let norm = 0;
  for (let i = 0; i < n; i++) { out[i] = vec[i]; norm += vec[i] * vec[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < n; i++) out[i] /= norm;
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // both normalised
}

export function passageEmbeddingText(p: { title: string; text: string }): string {
  return `${p.title}\n${p.text}`;
}

function key(businessAccountId: string, text: string): string {
  return crypto.createHash('sha256').update(`${businessAccountId}\n${text}`).digest('hex');
}

export function getPassageVector(businessAccountId: string, p: { title: string; text: string }): Float32Array | undefined {
  return store.get(key(businessAccountId, passageEmbeddingText(p)));
}

/**
 * Embed any passages that have no vector yet. Returns immediately if a run for this
 * account is already in flight. Failures are logged and retried on a later call.
 */
export async function ensurePassageVectors(
  businessAccountId: string,
  passages: Array<{ title: string; text: string }>,
  embedBatch: (texts: string[]) => Promise<number[][]>,
): Promise<number> {
  if (inFlight.has(businessAccountId)) return 0;
  const failedAt = lastFailure.get(businessAccountId);
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return 0;
  const missing = passages.map(passageEmbeddingText).filter(t => !store.has(key(businessAccountId, t)));
  const unique = Array.from(new Set(missing));
  if (!unique.length) return 0;
  inFlight.add(businessAccountId);
  try {
    const vectors = await embedBatch(unique);
    unique.forEach((t, i) => {
      if (!vectors[i]) return;
      if (store.size >= MAX_VECTORS) {
        const oldest = store.keys().next().value;
        if (oldest) store.delete(oldest);
      }
      store.set(key(businessAccountId, t), truncateNormalize(vectors[i]));
    });
    console.log(`[ChatContext] Embedded ${unique.length} page/document passage(s) for ${businessAccountId}`);
    return unique.length;
  } catch (err) {
    lastFailure.set(businessAccountId, Date.now());
    console.warn(`[ChatContext] Passage embedding failed for ${businessAccountId} (keyword matching only; retry in 10 min):`, (err as Error)?.message);
    return 0;
  } finally {
    inFlight.delete(businessAccountId);
  }
}

export function passageVectorStats(): { vectors: number; inFlight: number } {
  return { vectors: store.size, inFlight: inFlight.size };
}

/** Tests only. */
export function clearPassageVectors(): void {
  store.clear();
  inFlight.clear();
  lastFailure.clear();
}
