/**
 * Versioned database migrations (drizzle-kit generate → migrations/NNNN_*.sql).
 *
 * The one way schema changes reach any database:
 *   1. change shared/schema.ts
 *   2. npm run db:generate -- --name short_description   (writes migrations/NNNN_*.sql)
 *   3. commit; the server applies pending migrations at startup (or: npm run db:migrate)
 *
 * migrations/0000_baseline.sql is the schema production had on 2026-09-28. A database that
 * already has tables but no migration history (production, Replit) is marked as being at the
 * baseline without running it; an empty database runs the baseline to create everything.
 * Every later migration runs normally, in order, once. Runs under an advisory lock so two
 * processes can't migrate at the same time.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./db";

const LOCK_KEY = 72_901_512; // arbitrary, fixed: "chroney migrations"
const BASELINE_TAG = "0000_baseline";

export function migrationsFolder(): string {
  return process.env.MIGRATIONS_DIR || path.resolve(process.cwd(), "migrations");
}

interface JournalEntry { idx: number; when: number; tag: string }

function readJournal(folder: string): JournalEntry[] {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"));
  return journal.entries as JournalEntry[];
}

// Same hash drizzle-orm's migrator records for a migration file.
function fileHash(folder: string, tag: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(folder, `${tag}.sql`)).toString()).digest("hex");
}

export interface MigrationResult {
  baselineAdopted: boolean;
  applied: string[];
}

export async function runMigrations(opts: { log?: (msg: string) => void } = {}): Promise<MigrationResult> {
  const log = opts.log || ((m: string) => console.log(`[Migrations] ${m}`));
  const folder = migrationsFolder();
  const entries = readJournal(folder);
  const baseline = entries.find(e => e.tag === BASELINE_TAG);
  if (!baseline) throw new Error(`${BASELINE_TAG} is missing from ${folder}/meta/_journal.json`);

  const client = await pool.connect();
  try {
    // Migrations can take a while on big tables; don't let the pool-wide statement timeout cut them.
    await client.query("SET statement_timeout = 0");
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector").catch(err =>
        log(`Could not create the vector extension (${err.message}) — continuing; it may already exist or need a superuser.`));
      // History lives in drizzle.__drizzle_migrations; if the database user may not create a
      // schema, keep it in public.__drizzle_migrations instead of refusing to start.
      let historySchema = "drizzle";
      const existingHistory = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS d, to_regclass('public.__drizzle_migrations') AS p");
      if (!existingHistory.rows[0]?.d && existingHistory.rows[0]?.p) {
        historySchema = "public";
      } else if (!existingHistory.rows[0]?.d) {
        try {
          await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
        } catch (err: any) {
          if (err?.code !== "42501") throw err; // insufficient_privilege
          historySchema = "public";
          log("No permission to create the drizzle schema — keeping migration history in public.__drizzle_migrations");
        }
      }
      const history = `"${historySchema}".__drizzle_migrations`;
      await client.query(`CREATE TABLE IF NOT EXISTS ${history} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);

      const done = await client.query<{ created_at: string }>(`SELECT created_at FROM ${history} ORDER BY created_at DESC LIMIT 1`);
      let baselineAdopted = false;
      if (done.rowCount === 0) {
        const existing = await client.query("SELECT to_regclass('public.business_accounts') AS t");
        if (existing.rows[0]?.t) {
          // Existing database (created before migrations were versioned): it already is the baseline.
          await client.query(`INSERT INTO ${history} (hash, created_at) VALUES ($1, $2)`, [fileHash(folder, BASELINE_TAG), baseline.when]);
          baselineAdopted = true;
          log(`Existing database — recorded ${BASELINE_TAG} as already applied`);
        }
      }
      const last = Number((await client.query<{ created_at: string }>(`SELECT created_at FROM ${history} ORDER BY created_at DESC LIMIT 1`)).rows[0]?.created_at ?? 0);
      const pending = entries.filter(e => e.when > last).map(e => e.tag);

      if (pending.length === 0) {
        log("Database is up to date");
        return { baselineAdopted, applied: [] };
      }
      log(`Applying ${pending.length} migration(s): ${pending.join(", ")}`);
      await migrate(db, { migrationsFolder: folder, migrationsSchema: historySchema });
      log("Migrations applied");
      return { baselineAdopted, applied: pending };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    }
  } finally {
    await client.query("RESET statement_timeout").catch(() => {});
    client.release();
  }
}

// `npm run db:migrate`
const isMain = process.argv[1] && /migrate\.(ts|js|mjs)$/.test(process.argv[1]);
if (isMain) {
  runMigrations()
    .then(r => { console.log(JSON.stringify(r)); return pool.end(); })
    .then(() => process.exit(0))
    .catch(err => { console.error("[Migrations] FAILED:", err); process.exit(1); });
}
