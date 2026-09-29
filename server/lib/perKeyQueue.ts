/**
 * Runs tasks one at a time per key (e.g. per customer), different keys in parallel.
 *
 * A task waits for the previous task with the same key, but never longer than
 * `maxWaitMs`: one stuck call (a hung AI request) must not silence every later
 * message from the same customer. After the wait it runs anyway.
 *
 * Same idea as whatsappFlowService.runForSender / whatsappAutoReplyService.withSenderLock.
 */
export class PerKeyQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(private readonly opts: { maxWaitMs: number; name?: string }) {}

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) || Promise.resolve();
    let waitTimer: NodeJS.Timeout | undefined;
    const bounded = Promise.race([
      previous.catch(() => undefined),
      new Promise<void>((resolve) => {
        waitTimer = setTimeout(() => {
          console.warn(`[${this.opts.name || "PerKeyQueue"}] Previous task still running after ${this.opts.maxWaitMs / 1000}s — continuing`);
          resolve();
        }, this.opts.maxWaitMs);
        waitTimer.unref?.();
      }),
    ]).finally(() => clearTimeout(waitTimer));
    const next = bounded.then(() => fn());
    this.tails.set(key, next);
    const cleanup = () => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  /** Number of keys with a task queued or running. */
  get size(): number {
    return this.tails.size;
  }
}
