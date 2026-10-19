import crypto from 'crypto';

/**
 * API key for the TopScholar LMS embedding API (server-to-server). The plaintext key
 * is shown to the admin exactly once; only its SHA-256 hash and last 4 characters are
 * stored, so a database leak cannot be replayed against the API.
 */

const KEY_PREFIX = 'tsk_';

export function generateEmbedApiKey(): { key: string; hash: string; last4: string } {
  const key = `${KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  return { key, hash: hashEmbedApiKey(key), last4: key.slice(-4) };
}

export function hashEmbedApiKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Constant-time check of a presented key against the stored hash. */
export function embedApiKeyMatches(presented: string, storedHash: string | null | undefined): boolean {
  if (!presented || !storedHash) return false;
  const a = Buffer.from(hashEmbedApiKey(presented), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Reads the key from `Authorization: Bearer <key>` or `X-Api-Key: <key>`. */
export function extractEmbedApiKey(headers: Record<string, string | string[] | undefined>): string | null {
  const auth = headers['authorization'];
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    const value = auth.replace(/^Bearer\s+/i, '').trim();
    if (value) return value;
  }
  const header = headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

/**
 * Fixed-window request limiter, per account. In-memory and per process: it protects
 * the worker and the client's CMS from runaway loops, not a security boundary.
 */
export function createWindowLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return (key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } => {
    const current = windows.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      windows.set(key, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000)) };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}
