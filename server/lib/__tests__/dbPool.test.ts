/**
 * DB pool hardening (server/db.ts): 'error' listener keeps the process alive,
 * pool limits are applied, statement_timeout safety net is set per connection,
 * checkDatabase() readiness probe is bounded.
 *
 * Needs a Postgres: DATABASE_URL=postgresql://... npx tsx server/lib/__tests__/dbPool.test.ts
 * Without DATABASE_URL the DB-backed assertions are skipped (the pool object
 * itself is lazy, so the error-listener checks still run).
 */
let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

const hasDb = !!process.env.DATABASE_URL;
if (!hasDb) process.env.DATABASE_URL = "postgresql://nobody:nothing@127.0.0.1:1/none";
process.env.DB_STATEMENT_TIMEOUT_MS = process.env.DB_STATEMENT_TIMEOUT_MS || "1500";

async function main() {
  const { pool, DB_POOL_SETTINGS, checkDatabase, endPool } = await import("../../db");

  expect(DB_POOL_SETTINGS.max === 20, "DB_POOL_MAX defaults to 20", DB_POOL_SETTINGS.max);
  expect((pool as any).options.max === 20, "pool max applied", (pool as any).options.max);
  expect((pool as any).options.connectionTimeoutMillis === 10_000, "connectionTimeoutMillis = 10s");
  expect((pool as any).options.idleTimeoutMillis === 30_000, "idleTimeoutMillis = 30s");
  expect(DB_POOL_SETTINGS.statementTimeoutMs === 1500, "statement timeout is env-configurable", DB_POOL_SETTINGS.statementTimeoutMs);
  expect(pool.listenerCount("error") >= 1, "pool has an 'error' listener");

  // Without a listener this emit would throw and crash the process.
  let threw = false;
  try { pool.emit("error", new Error("simulated idle client error (terminating connection due to administrator command)"), {} as any); }
  catch { threw = true; }
  expect(!threw, "emitting 'error' on the pool does not throw / crash");
  await new Promise((r) => setTimeout(r, 50));
  expect(true, "process still running after pool 'error'");

  if (hasDb) {
    const r = await pool.query("SELECT 1 AS one");
    expect(r.rows[0].one === 1, "pool still serves queries after an 'error' event");

    const st = await pool.query("SHOW statement_timeout");
    expect(["1500ms", "1500"].includes(String(st.rows[0].statement_timeout)), "statement_timeout set on new connections", st.rows[0]);

    // Real idle-client failure: kill the socket of an idle pooled client.
    const client = await pool.connect();
    client.release();
    let poolErr: any;
    pool.once("error", (e) => (poolErr = e));
    (client as any).connection.stream.destroy(new Error("ECONNRESET (simulated)"));
    await new Promise((r) => setTimeout(r, 200));
    expect(poolErr, "idle client socket failure surfaced as pool 'error' (handled)", poolErr?.message);
    const again = await pool.query("SELECT 2 AS two");
    expect(again.rows[0].two === 2, "pool recovers with a fresh connection");

    const ok = await checkDatabase(2_000);
    expect(ok.ok === true && ok.latencyMs < 2_000, "checkDatabase() ok against live DB", ok);

    await endPool();
    await endPool(); // idempotent
    const down = await checkDatabase(500);
    expect(down.ok === false && !!down.error, "checkDatabase() reports failure (never throws) once pool is gone", down);
  } else {
    console.log("(DATABASE_URL not set — skipped live DB assertions)");
    const t0 = Date.now();
    const down = await checkDatabase(500);
    expect(!down.ok && Date.now() - t0 < 1_500, "checkDatabase() fails fast against an unreachable DB", down);
    await endPool();
  }

  if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
  console.log("\nAll DB pool tests passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
