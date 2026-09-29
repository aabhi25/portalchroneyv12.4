import { Pool, type PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

/**
 * Pool settings (all env-overridable):
 * - DB_POOL_MAX (20): max concurrent connections from this process.
 * - DB_CONNECT_TIMEOUT_MS (10s): fail fast instead of queueing forever when the
 *   DB is unreachable or the pool is exhausted.
 * - DB_IDLE_TIMEOUT_MS (30s): release idle connections.
 * - DB_STATEMENT_TIMEOUT_MS (120s, 0 disables): server-side safety net so a
 *   runaway query cannot hold a connection forever. Generous on purpose: backups
 *   and restores run pg_dump / pg_restore as separate processes (not affected),
 *   and boot-time schema bootstraps (CREATE INDEX IF NOT EXISTS ...) are no-ops
 *   once built; ensureContentSchema lifts it for its HNSW build.
 */
export const DB_POOL_SETTINGS = {
  max: envInt('DB_POOL_MAX', 20),
  connectionTimeoutMillis: envInt('DB_CONNECT_TIMEOUT_MS', 10_000),
  idleTimeoutMillis: envInt('DB_IDLE_TIMEOUT_MS', 30_000),
  statementTimeoutMs: envInt('DB_STATEMENT_TIMEOUT_MS', 120_000),
};

/**
 * statement_timeout safety net, applied with a SET in pg-pool's `onConnect`
 * hook (awaited before the connection is handed out) rather than the
 * `options=-c ...` startup parameter, so it also works behind poolers
 * (PgBouncer / managed poolers) that reject unknown startup parameters. A
 * failing SET is logged and the connection is still used.
 */
export function withStatementTimeout(
  config: PoolConfig,
  label: string,
  statementTimeoutMs = DB_POOL_SETTINGS.statementTimeoutMs,
): PoolConfig {
  if (!(statementTimeoutMs > 0)) return config;
  return {
    ...config,
    onConnect: async (client) => {
      try {
        await client.query(`SET statement_timeout = ${Math.floor(statementTimeoutMs)}`);
      } catch (err: any) {
        console.error(`[Database] Failed to set statement_timeout on ${label} pool:`, err?.message || err);
      }
    },
  };
}

/**
 * Adds the 'error' listener every pg Pool needs: an idle client losing its
 * connection (DB restart, network blip, admin kill) otherwise emits an
 * unhandled 'error' that crashes the whole Node process.
 */
export function hardenPool(p: Pool, label: string): Pool {
  p.on('error', (err) => {
    // pg removes the broken client from the pool itself; just record it.
    console.error(`[Database] Idle client error on ${label} pool (process kept running):`, err?.message || err);
  });
  return p;
}

const poolConfig: PoolConfig = withStatementTimeout({
  connectionString: process.env.DATABASE_URL,
  max: DB_POOL_SETTINGS.max,
  connectionTimeoutMillis: DB_POOL_SETTINGS.connectionTimeoutMillis,
  idleTimeoutMillis: DB_POOL_SETTINGS.idleTimeoutMillis,
}, 'main');

export const pool = hardenPool(new Pool(poolConfig), 'main');
export const db = drizzle({ client: pool, schema });

/** Readiness probe: SELECT 1 bounded by `timeoutMs`. Never throws. */
export async function checkDatabase(timeoutMs = 2_000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - started, error: err?.message || String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let poolEnded: Promise<void> | null = null;
/** Ends the main pool once (idempotent). */
export function endPool(): Promise<void> {
  if (!poolEnded) poolEnded = pool.end();
  return poolEnded;
}

export async function initializePgVector(): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('[Database] pgvector extension initialized successfully');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[Database] Failed to initialize pgvector extension:', error);
    throw error;
  }
}
