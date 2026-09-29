import { Pool } from 'pg';
import { pool as localPool, hardenPool, withStatementTimeout, DB_POOL_SETTINGS } from '../../db';

/**
 * Config-driven access to the curriculum content store (pgvector).
 *
 * - When the account has NO topscholarContentDbUrl, we use the app's local
 *   Postgres+pgvector as a STAND-IN (the curriculum tables live alongside the
 *   app schema; created by `db:push` + ensureContentSchema()).
 * - When the client provides a connection string later, we open a dedicated
 *   pool to THEIR database and bootstrap the same schema there. No code change —
 *   only config (the connection string) differs.
 */

const externalPools = new Map<string, Pool>();

export function getContentPool(contentDbUrl: string | null): Pool {
  if (!contentDbUrl) return localPool;
  let p = externalPools.get(contentDbUrl);
  if (!p) {
    p = hardenPool(new Pool(withStatementTimeout({
      connectionString: contentDbUrl,
      connectionTimeoutMillis: DB_POOL_SETTINGS.connectionTimeoutMillis,
      idleTimeoutMillis: DB_POOL_SETTINGS.idleTimeoutMillis,
    }, 'topscholar-content')), 'topscholar-content');
    externalPools.set(contentDbUrl, p);
  }
  return p;
}

/** Ends any client content-DB pools (graceful shutdown, after HTTP drain). */
export async function endExternalContentPools(): Promise<void> {
  const pools = Array.from(externalPools.values());
  externalPools.clear();
  await Promise.allSettled(pools.map((p) => p.end()));
}

export function isExternalContentDb(contentDbUrl: string | null): boolean {
  return !!contentDbUrl;
}

/**
 * Idempotent schema bootstrap for the content store. Safe to run repeatedly.
 * Mirrors the Drizzle definitions in shared/schema.ts and adds the HNSW index
 * (which db:push does not create). For an external client DB this is the
 * "we create the schema, they host it" bootstrap step.
 */
export async function ensureContentSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // A first-time HNSW build over a large table can exceed the pool-wide
    // statement_timeout safety net (server/db.ts); lift it for this bootstrap.
    await client.query('SET statement_timeout = 0');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query(`
      CREATE TABLE IF NOT EXISTS topscholar_content_chunks (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        business_account_id varchar NOT NULL,
        cp_id text NOT NULL,
        board text,
        medium text,
        grade text,
        content_type text NOT NULL,
        subject text,
        subject_id text,
        chapter text,
        title text,
        content_html text,
        content_text text NOT NULL,
        source_ref text,
        media_url text,
        embedding vector(1536),
        metadata jsonb DEFAULT '{}'::jsonb,
        content_hash text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    // Expand-only: add subject_id to pre-existing tables that were created before
    // this column existed. Nullable, no default — safe to run repeatedly.
    await client.query(`
      ALTER TABLE topscholar_content_chunks ADD COLUMN IF NOT EXISTS subject_id text
    `);
    await client.query(`
      ALTER TABLE topscholar_content_chunks
        ADD COLUMN IF NOT EXISTS board text,
        ADD COLUMN IF NOT EXISTS medium text,
        ADD COLUMN IF NOT EXISTS grade text
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS topscholar_chunks_account_cp_idx
        ON topscholar_content_chunks (business_account_id, cp_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS topscholar_chunks_account_cp_type_idx
        ON topscholar_content_chunks (business_account_id, cp_id, content_type)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS topscholar_chunks_scope_idx
        ON topscholar_content_chunks (business_account_id, board, medium, grade, subject, cp_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS topscholar_chunks_embedding_hnsw
        ON topscholar_content_chunks USING hnsw (embedding vector_cosine_ops)
    `);
  } finally {
    // Restore the pool-wide statement_timeout before handing the client back;
    // if that fails, destroy the client rather than return an unbounded one.
    let restoreErr: Error | undefined;
    try {
      await client.query(`SET statement_timeout = ${DB_POOL_SETTINGS.statementTimeoutMs}`);
    } catch (err: any) {
      restoreErr = err instanceof Error ? err : new Error(String(err));
    }
    client.release(restoreErr);
  }
}

export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
