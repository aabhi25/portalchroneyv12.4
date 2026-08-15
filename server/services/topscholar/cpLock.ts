import { pool } from '../../db';
import type { PoolClient } from 'pg';

/**
 * Per-(businessAccountId, cp_id) serialization for the curriculum embedding pipeline.
 *
 * Two destructive operations must never interleave for the same cp_id:
 *   - the poller LANDING a completed job (delete old chunks -> append new ones), and
 *   - a fresh full-sync REPLACING the prior job (delete prior jobs, which cascade-deletes
 *     their staging).
 *
 * If they overlap, a stale landing can wipe content a newer run is about to write, or
 * resolve embeddings against staging that was deleted mid-flight. We make both sides hold
 * the SAME Postgres advisory lock so they run strictly one-at-a-time. The lock is keyed by
 * a stable 64-bit hash of the (business, cp) pair.
 */

// BigInt FNV-1a 64-bit, folded into a signed value that fits PostgreSQL's bigint.
function advisoryLockKey(str: string): bigint {
  let hash = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & BigInt('0xffffffffffffffff');
  }
  const SIGN_BIT = BigInt('0x8000000000000000');
  const TWO_64 = BigInt('0x10000000000000000');
  if (hash >= SIGN_BIT) hash -= TWO_64;
  return hash;
}

const ACQUIRE_TIMEOUT_MS = 10 * 60 * 1000; // give up waiting after 10 min
const BACKOFF_START_MS = 50;
const BACKOFF_MAX_MS = 2000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs `fn` while holding the per-cp advisory lock, serializing it against any other
 * caller of withCpLock for the same (business, cp).
 *
 * CRITICAL #1 — same connection: pg_advisory_lock state is per-session, so the lock and its
 * unlock MUST run on the SAME physical connection. We pin one checked-out client for the
 * whole critical section and unlock on it before releasing.
 *
 * CRITICAL #2 — no waiter pool starvation: we acquire with pg_TRY_advisory_lock + backoff
 * and RELEASE the connection between failed attempts, rather than blocking inside
 * pg_advisory_lock (which would hold a pooled connection for the entire wait). If many
 * callers blocked while each pinning a connection, the pool could be drained by waiters and
 * the holder — whose `fn` needs further pooled connections — could deadlock. With try+back-
 * off, only the single holder ever pins a connection; waiters hold one only momentarily per
 * probe. The work inside `fn` continues to use the regular pooled `db`.
 */
export async function withCpLock<T>(
  businessAccountId: string,
  cpId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = advisoryLockKey(`topscholar_cp:${businessAccountId}:${cpId}`).toString();

  // Phase 1: acquire. Never hold a pooled connection while waiting.
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  let backoff = BACKOFF_START_MS;
  let held: PoolClient | null = null;
  while (!held) {
    const c = await pool.connect();
    let ok = false;
    try {
      const res = await c.query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [key]);
      ok = res.rows?.[0]?.ok === true;
    } catch (err) {
      c.release();
      throw err;
    }
    if (ok) {
      held = c; // keep this connection — it owns the session lock
      break;
    }
    c.release(); // not acquired — free the connection before sleeping
    if (Date.now() >= deadline) {
      throw new Error(`Timed out acquiring TopScholar cp lock for ${businessAccountId}/${cpId}.`);
    }
    await sleep(backoff);
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  }

  // Phase 2: run the critical section while holding the lock on `held`.
  try {
    return await fn();
  } finally {
    try {
      await held.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
    } finally {
      held.release();
    }
  }
}
