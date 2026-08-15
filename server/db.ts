import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });

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
