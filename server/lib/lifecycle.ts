/**
 * Process lifecycle registry used by graceful shutdown.
 *
 * - `trackTimer(setInterval(...))` registers a background timer so shutdown can
 *   clear it (no new DB work is started while the pool is being drained).
 * - `onShutdown(name, fn)` registers a cleanup hook (stop a worker, close
 *   WebSockets...). Hooks run once, in registration order within a phase, each
 *   isolated (a throwing/hanging hook never blocks the rest).
 * - `isShuttingDown()` lets request handlers / health checks report draining.
 *
 * Kept dependency-free so tests can import it without touching the DB.
 */

type Timer = ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>;

/**
 * - `workers`: stop background schedulers/pollers (runs first).
 * - `connections`: close long-lived connections (WebSockets, SSE) so the HTTP
 *   server can finish draining.
 */
export type ShutdownPhase = "workers" | "connections";

interface Hook {
  name: string;
  phase: ShutdownPhase;
  fn: () => void | Promise<void>;
}

const timers = new Set<Timer>();
const hooks: Hook[] = [];
let shuttingDown = false;

/** Registers a timer for clearing at shutdown. Returns it unchanged. */
export function trackTimer<T extends Timer>(timer: T): T {
  timers.add(timer);
  return timer;
}

export function untrackTimer(timer: Timer | null | undefined): void {
  if (timer) timers.delete(timer);
}

/** Clears every tracked timer (interval or timeout). Returns how many. */
export function clearTrackedTimers(): number {
  const n = timers.size;
  for (const t of Array.from(timers)) {
    clearInterval(t as any);
    clearTimeout(t as any);
  }
  timers.clear();
  return n;
}

export function trackedTimerCount(): number {
  return timers.size;
}

export function onShutdown(name: string, fn: () => void | Promise<void>, phase: ShutdownPhase = "workers"): void {
  hooks.push({ name, phase, fn });
}

export function markShuttingDown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Runs the hooks of one phase concurrently, each bounded by `timeoutMs`.
 * Never rejects; failures are logged.
 */
export async function runShutdownHooks(
  phase: ShutdownPhase,
  timeoutMs: number,
  log: (msg: string, err?: unknown) => void = defaultLog,
): Promise<void> {
  const list = hooks.filter((h) => h.phase === phase);
  await Promise.all(
    list.map(async (h) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(h.fn),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              log(`[Shutdown] hook "${h.name}" did not finish within ${timeoutMs}ms, continuing`);
              resolve();
            }, timeoutMs);
            timer.unref?.();
          }),
        ]);
      } catch (err) {
        log(`[Shutdown] hook "${h.name}" failed`, err);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );
}

/** Test helper: forget all registered hooks/timers and the shutting-down flag. */
export function __resetLifecycleForTests(): void {
  clearTrackedTimers();
  hooks.length = 0;
  shuttingDown = false;
}

function defaultLog(msg: string, err?: unknown) {
  if (err) console.error(msg, err);
  else console.log(msg);
}
