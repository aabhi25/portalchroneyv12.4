/**
 * Graceful shutdown + process-level crash handlers.
 *
 * Order (see createGracefulShutdown):
 *   1. mark shutting down (/health/ready starts returning 503)
 *   2. server.close() — stop accepting new connections
 *   3. clear tracked background timers + run "workers" hooks (stop schedulers)
 *   4. run "connections" hooks (close voice WebSockets / long-lived sockets)
 *   5. wait for in-flight HTTP requests until the drain deadline
 *      (SHUTDOWN_DRAIN_MS, default 25s, measured from the signal); then force-close
 *   6. end the DB pool (bounded)
 *   7. process exit
 * A hard timer (drain + 8s) force-exits if anything above hangs. Calling
 * shutdown again (double SIGTERM, SIGINT after SIGTERM, crash during shutdown)
 * returns the same in-flight promise.
 */
import type { Server } from "http";
import { clearTrackedTimers, markShuttingDown, runShutdownHooks } from "./lifecycle";

type Log = (msg: string, err?: unknown) => void;

export interface GracefulShutdownOptions {
  /** Returns the HTTP server once it exists (null during early boot). */
  getServer: () => Server | null | undefined;
  /** Ends the DB pool(s). */
  closePool: () => Promise<void>;
  drainTimeoutMs?: number;
  hardTimeoutMs?: number;
  /** Per-hook budget for worker/connection hooks. */
  hookTimeoutMs?: number;
  poolTimeoutMs?: number;
  exit?: (code: number) => void;
  log?: Log;
}

export const DEFAULT_DRAIN_TIMEOUT_MS = envInt("SHUTDOWN_DRAIN_MS", 25_000);

export type ShutdownFn = (reason: string, exitCode?: number) => Promise<void>;

export function createGracefulShutdown(opts: GracefulShutdownOptions): ShutdownFn {
  const drainTimeoutMs = opts.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const hardTimeoutMs = opts.hardTimeoutMs ?? drainTimeoutMs + 8_000;
  const hookTimeoutMs = opts.hookTimeoutMs ?? 5_000;
  const poolTimeoutMs = opts.poolTimeoutMs ?? 5_000;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const log: Log = opts.log ?? defaultLog;

  let inFlight: Promise<void> | null = null;
  let exited = false;
  const exitOnce = (code: number) => {
    if (exited) return;
    exited = true;
    exit(code);
  };

  return function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (inFlight) {
      log(`[Shutdown] ${reason} received while already shutting down — ignoring`);
      return inFlight;
    }
    const startedAt = Date.now();
    const deadline = startedAt + drainTimeoutMs;
    log(`[Shutdown] ${reason} — starting graceful shutdown (drain ${drainTimeoutMs}ms, hard limit ${hardTimeoutMs}ms)`);
    markShuttingDown();

    const hard = setTimeout(() => {
      log(`[Shutdown] Hard timeout after ${hardTimeoutMs}ms — forcing exit`);
      exitOnce(exitCode || 1);
    }, hardTimeoutMs);
    hard.unref?.();

    inFlight = (async () => {
      // 1. Stop accepting new connections.
      const server = opts.getServer() ?? null;
      let serverClosed: Promise<void> = Promise.resolve();
      if (server && server.listening) {
        serverClosed = new Promise<void>((resolve) => {
          server.close((err) => {
            if (err) log("[Shutdown] server.close reported", err);
            resolve();
          });
        });
        server.closeIdleConnections?.();
      }

      // 2. Stop background work.
      const cleared = clearTrackedTimers();
      log(`[Shutdown] Cleared ${cleared} background timer(s); stopping workers`);
      await runShutdownHooks("workers", hookTimeoutMs, log);

      // 3. Close long-lived connections (voice WebSockets).
      await runShutdownHooks("connections", hookTimeoutMs, log);

      // 4. Let in-flight HTTP requests finish, bounded by the drain deadline.
      if (server) {
        const idleSweep = setInterval(() => server.closeIdleConnections?.(), 1_000);
        idleSweep.unref?.();
        const remaining = Math.max(0, deadline - Date.now());
        const drainTimer = sleep(remaining);
        const drained = await Promise.race([
          serverClosed.then(() => true),
          drainTimer.then(() => false),
        ]);
        drainTimer.cancel?.();
        clearInterval(idleSweep);
        if (drained) {
          log(`[Shutdown] HTTP server drained in ${Date.now() - startedAt}ms`);
        } else {
          log(`[Shutdown] Drain deadline reached — closing remaining connections`);
          server.closeAllConnections?.();
        }
      }

      // 5. Close the DB pool last so draining requests could still use it.
      const poolTimer = sleep(poolTimeoutMs);
      const poolDone = await Promise.race([
        Promise.resolve()
          .then(() => opts.closePool())
          .then(() => true, (err) => { log("[Shutdown] pool.end failed", err); return true; }),
        poolTimer.then(() => false),
      ]);
      poolTimer.cancel?.();
      log(poolDone ? "[Shutdown] DB pool closed" : `[Shutdown] DB pool did not close within ${poolTimeoutMs}ms`);

      log(`[Shutdown] Complete in ${Date.now() - startedAt}ms — exiting with code ${exitCode}`);
      clearTimeout(hard);
      exitOnce(exitCode);
    })().catch((err) => {
      log("[Shutdown] Unexpected error during shutdown", err);
      clearTimeout(hard);
      exitOnce(exitCode || 1);
    });
    return inFlight;
  };
}

/**
 * SIGTERM/SIGINT → graceful shutdown (exit 0).
 * unhandledRejection → log and keep running (one bad promise must not take the
 *   whole server down; Node's default would crash).
 * uncaughtException → log, then graceful shutdown with exit 1 so the
 *   supervisor (pm2) restarts a process whose state may be corrupt.
 */
export function installProcessHandlers(shutdown: ShutdownFn, log: Log = defaultLog): void {
  process.on("SIGTERM", () => { void shutdown("SIGTERM", 0); });
  process.on("SIGINT", () => { void shutdown("SIGINT", 0); });
  process.on("unhandledRejection", (reason) => {
    log("[Process] Unhandled promise rejection (process kept running):", reason);
  });
  process.on("uncaughtException", (err, origin) => {
    log(`[Process] Uncaught exception (${origin}) — shutting down for restart:`, err);
    void shutdown("uncaughtException", 1);
  });
}

// Deliberately NOT unref'd: keeps the loop alive until shutdown calls exit().
// Cleared once the race settles so a finished shutdown leaves no timers behind.
function sleep(ms: number): Promise<void> & { cancel?: () => void } {
  let t: ReturnType<typeof setTimeout>;
  const p: Promise<void> & { cancel?: () => void } = new Promise<void>((resolve) => {
    t = setTimeout(resolve, ms);
  });
  p.cancel = () => clearTimeout(t);
  return p;
}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function defaultLog(msg: string, err?: unknown) {
  if (err !== undefined) console.error(msg, err);
  else console.log(msg);
}
