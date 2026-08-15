/**
 * One-time database setup script.
 * Run this once after provisioning a new database:
 *   node scripts/setup-db.mjs
 *
 * What it does:
 *   1. Enables the pgvector extension (required for embedding/vector columns)
 *   2. Runs drizzle-kit push to sync the schema
 */

import { execSync } from "child_process";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Aborting.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  console.log("[setup] Enabling pgvector extension...");
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  console.log("[setup] ✓ pgvector ready");
} finally {
  await pool.end();
}

console.log("[setup] Pushing schema with drizzle-kit...");
execSync("npm run db:push", { stdio: "inherit" });
console.log("[setup] ✓ Schema up to date");
console.log("[setup] Done. Run `npm run dev` to start the server.");
