/**
 * Graceful shutdown: spawns fixtures/shutdownHarness.ts (real shutdown module,
 * real process handlers, real http server, tracked interval, fake pool), sends
 * signals and asserts ordering, draining, idempotency and bounded exit.
 * Run manually: `npx tsx server/lib/__tests__/gracefulShutdown.test.ts`
 */
import { spawn, type ChildProcess } from "child_process";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(here, "fixtures", "shutdownHarness.ts");
const REPO = path.resolve(here, "../../..");

interface Run {
  child: ChildProcess;
  events: { name: string; data: any; at: number }[];
  logs: string[];
  waitFor: (name: string, ms?: number) => Promise<any>;
  exited: Promise<{ code: number | null; at: number }>;
}

function start(mode: string, env: Record<string, string> = {}): Run {
  const child = spawn(process.execPath, ["--import", "tsx", HARNESS], {
    cwd: REPO,
    env: { ...process.env, MODE: mode, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const events: Run["events"] = [];
  const logs: string[] = [];
  const waiters: { name: string; resolve: (d: any) => void }[] = [];
  let buf = "";
  child.stdout!.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const m = /^EVT (\S+) (.*)$/.exec(line);
      if (m) {
        const e = { name: m[1], data: JSON.parse(m[2]), at: Date.now() };
        events.push(e);
        for (const w of waiters.filter((w) => w.name === e.name)) w.resolve(e.data);
      } else logs.push(line);
    }
  });
  child.stderr!.on("data", (c) => logs.push(String(c)));
  const exited = new Promise<{ code: number | null; at: number }>((r) => child.on("exit", (code) => r({ code, at: Date.now() })));
  const waitFor = (name: string, ms = 10_000) => {
    const hit = events.find((e) => e.name === name);
    if (hit) return Promise.resolve(hit.data);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${name}; logs:\n${logs.join("\n")}`)), ms);
      waiters.push({ name, resolve: (d) => { clearTimeout(t); resolve(d); } });
    });
  };
  return { child, events, logs, waitFor, exited };
}

function get(port: number, p: string): Promise<{ status?: number; body?: string; error?: string }> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: p, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
      res.on("error", (e) => resolve({ error: e.message }));
    });
    req.on("error", (e: any) => resolve({ error: e.code || e.message }));
  });
}

const idx = (r: Run, name: string) => r.events.findIndex((e) => e.name === name);

async function testNormal() {
  console.log("\n— SIGTERM with an in-flight request");
  const r = start("normal");
  const { port } = await r.waitFor("listening");
  await r.waitFor("tick");
  const inflight = get(port, "/slow");
  await r.waitFor("slow_request_started");
  const sigAt = Date.now();
  r.child.kill("SIGTERM");
  await new Promise((res) => setTimeout(res, 60));
  r.child.kill("SIGTERM"); // double signal must be harmless
  r.child.kill("SIGINT");
  const late = await get(port, "/"); // new connections are refused once closing
  const resp = await inflight;
  const { code, at } = await r.exited;

  expect(resp.status === 200 && resp.body === "done", "in-flight request completed during drain", resp);
  expect(!!late.error, "new connection after SIGTERM is refused", late);
  expect(code === 0, "exit code 0 on SIGTERM", code);
  expect(at - sigAt < 3_000, "exited well within the drain timeout", at - sigAt);
  expect(r.logs.some((l) => l.includes("already shutting down")), "second signal logged and ignored (idempotent)");
  const workerIdx = idx(r, "worker_stopped"), connIdx = idx(r, "connections_closed"),
    closedIdx = idx(r, "server_closed"), poolIdx = idx(r, "pool_ended"), exitIdx = idx(r, "exit");
  expect(workerIdx >= 0 && connIdx > workerIdx, "workers stopped, then connections closed", { workerIdx, connIdx });
  expect(closedIdx > idx(r, "slow_request_finished") && poolIdx > closedIdx, "server closed after the request finished; pool ended after server closed", { closedIdx, poolIdx });
  expect(exitIdx > poolIdx, "exit after pool ended");
  const ticksAfterStop = r.events.slice(workerIdx).filter((e) => e.name === "tick").length;
  expect(ticksAfterStop === 0, "tracked interval cleared (no ticks after shutdown began)", ticksAfterStop);
  expect(r.events[exitIdx]?.data?.poolEnded === true, "pool.end() was called before exit");
}

async function testStuckRequest() {
  console.log("\n— SIGTERM with a request that never finishes (drain deadline)");
  const r = start("stuck", { DRAIN_MS: "800", HARD_MS: "5000" });
  const { port } = await r.waitFor("listening");
  const stuck = get(port, "/stuck");
  await r.waitFor("stuck_request_started");
  const sigAt = Date.now();
  r.child.kill("SIGTERM");
  const { code, at } = await r.exited;
  const res = await stuck;
  expect(code === 0, "exit code 0", code);
  expect(at - sigAt >= 700 && at - sigAt < 2_500, "waited ~drain deadline then force-closed", at - sigAt);
  expect(!!res.error, "stuck connection was force-closed", res);
  expect(r.logs.some((l) => l.includes("Drain deadline reached")), "drain deadline logged");
  expect(idx(r, "pool_ended") >= 0, "pool still ended after forced close");
}

async function testHangingPool() {
  console.log("\n— pool.end() hangs (bounded)");
  const r = start("hangpool", { DRAIN_MS: "500", HARD_MS: "5000" });
  await r.waitFor("listening");
  const sigAt = Date.now();
  r.child.kill("SIGTERM");
  const { code, at } = await r.exited;
  expect(idx(r, "pool_end_called") >= 0, "pool.end() was attempted");
  expect(code === 0 && at - sigAt < 2_500, "exited despite hanging pool.end()", { code, ms: at - sigAt });
}

async function testUncaught() {
  console.log("\n— uncaughtException → graceful shutdown, exit 1");
  const r = start("uncaught");
  await r.waitFor("listening");
  const { code } = await r.exited;
  expect(code === 1, "exit code 1 so the supervisor restarts", code);
  expect(r.logs.some((l) => l.includes("Uncaught exception") && l.includes("boom")), "exception logged");
  expect(idx(r, "pool_ended") >= 0 && idx(r, "worker_stopped") >= 0, "went through graceful shutdown (workers stopped, pool ended)");
}

async function testUnhandledRejection() {
  console.log("\n— unhandledRejection → logged, process keeps running");
  const r = start("rejection");
  await r.waitFor("rejection_fired");
  await new Promise((res) => setTimeout(res, 400));
  const ticksAfter = r.events.filter((e) => e.name === "tick" && e.at > Date.now() - 300).length;
  expect(r.child.exitCode === null, "process still alive after unhandled rejection");
  expect(ticksAfter > 0, "background interval still running", ticksAfter);
  expect(r.logs.some((l) => l.includes("Unhandled promise rejection") && l.includes("unhandled (test)")), "rejection logged");
  r.child.kill("SIGTERM");
  const { code } = await r.exited;
  expect(code === 0, "then shuts down cleanly on SIGTERM", code);
}

async function main() {
  await testNormal();
  await testStuckRequest();
  await testHangingPool();
  await testUncaught();
  await testUnhandledRejection();
  if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
  console.log("\nAll graceful shutdown tests passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
