/**
 * Child-process harness for gracefulShutdown.test.ts. Uses the real shutdown
 * module + process handlers with a tracked fake interval, a real http server
 * and a fake pool. Emits machine-readable "EVT <name> <json>" lines on stdout.
 *
 * MODE (env):
 *   normal     — a slow (800ms) in-flight request must complete before exit
 *   stuck      — an in-flight request never finishes → drain deadline force-closes
 *   hangpool   — pool.end() never resolves → bounded by poolTimeoutMs
 *   uncaught   — throws an uncaught exception → graceful shutdown, exit 1
 *   rejection  — unhandled rejection → keeps running (then SIGTERM from parent)
 */
import http from "http";
import type { AddressInfo } from "net";
import { createGracefulShutdown, installProcessHandlers } from "../../gracefulShutdown";
import { trackTimer, onShutdown } from "../../lifecycle";

const MODE = process.env.MODE || "normal";
const evt = (name: string, data: unknown = {}) => process.stdout.write(`EVT ${name} ${JSON.stringify(data)}\n`);

let ticks = 0;
trackTimer(setInterval(() => { ticks++; evt("tick", { ticks }); }, 50));

let workerStopped = false;
onShutdown("fake-worker", () => { workerStopped = true; evt("worker_stopped"); });
onShutdown("fake-ws", async () => { await new Promise((r) => setTimeout(r, 50)); evt("connections_closed"); }, "connections");

const server = http.createServer((req, res) => {
  if (req.url === "/slow") {
    evt("slow_request_started");
    setTimeout(() => { res.end("done"); evt("slow_request_finished"); }, 800);
    return;
  }
  if (req.url === "/stuck") { evt("stuck_request_started"); return; }
  res.end("ok");
});
server.on("close", () => evt("server_closed"));

let poolEnded = false;
const shutdown = createGracefulShutdown({
  getServer: () => server,
  closePool: () => {
    if (MODE === "hangpool") { evt("pool_end_called"); return new Promise<void>(() => {}); }
    return new Promise<void>((r) => setTimeout(() => { poolEnded = true; evt("pool_ended", { workerStopped, ticksAtEnd: ticks }); r(); }, 20));
  },
  drainTimeoutMs: Number(process.env.DRAIN_MS || 3_000),
  hardTimeoutMs: Number(process.env.HARD_MS || 6_000),
  poolTimeoutMs: 500,
  hookTimeoutMs: 1_000,
  exit: (code) => { evt("exit", { code, poolEnded, ticks }); process.exit(code); },
  log: (msg, err) => process.stdout.write(`LOG ${msg}${err ? " " + String((err as any)?.message ?? err) : ""}\n`),
});
installProcessHandlers(shutdown, (msg, err) => process.stdout.write(`LOG ${msg} ${String((err as any)?.message ?? err)}\n`));

server.listen(0, "127.0.0.1", () => {
  evt("listening", { port: (server.address() as AddressInfo).port });
  if (MODE === "uncaught") setTimeout(() => { throw new Error("boom (test)"); }, 200);
  if (MODE === "rejection") setTimeout(() => { Promise.reject(new Error("unhandled (test)")); evt("rejection_fired"); }, 100);
});
