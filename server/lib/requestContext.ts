/**
 * Per-request / per-job context carried through async code with
 * AsyncLocalStorage. Used for:
 *   - the request id (access log, error reports);
 *   - attributing automatically tracked OpenAI usage to a business account and
 *     a feature label (see server/lib/openaiClient.ts).
 *
 * HTTP requests get a context from the access-log middleware (accessLog.ts).
 * The business account is resolved lazily from the request (req.user after
 * requireAuth, webhook route params, the widget's businessAccountId), so the
 * middleware can run before authentication. Background workers wrap their unit
 * of work in `runWithContext({ businessAccountId, feature }, fn)`.
 *
 * Kept dependency-free (no DB imports) so tests and the logger can import it.
 */
import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
  requestId?: string;
  /** Explicit account (workers, or set by a handler once it knows it). */
  businessAccountId?: string | null;
  /** Feature label for usage attribution, e.g. "conversation_summary_sweep". */
  feature?: string;
  /** "METHOD /path" for HTTP requests (no query string). */
  route?: string;
  /** Lazy "METHOD /matched/:pattern" once Express has routed the request. */
  resolveRoute?: () => string | undefined;
  /** Lazy resolver for HTTP requests (reads req.user / params once they exist). */
  resolveBusinessAccountId?: () => string | null | undefined;
  /** false inside withoutUsageTracking(): the caller records usage itself. */
  trackUsage?: boolean;
}

const als = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return als.getStore();
}

/** Runs fn in a child context (inherits the current one, overrides with `ctx`). */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  const parent = als.getStore();
  return als.run({ ...(parent || {}), ...ctx }, fn);
}

/**
 * Runs fn with automatic OpenAI usage tracking disabled — for call sites that
 * record usage themselves via aiUsageLogger, so nothing is counted twice. The
 * decision is taken when the OpenAI call is made, so for streams it is enough
 * to wrap the `create(...)` call itself.
 */
export function withoutUsageTracking<T>(fn: () => T): T {
  return runWithContext({ trackUsage: false }, fn);
}

/** Records the business account on the current context (no-op outside one). */
export function setContextBusinessAccount(businessAccountId: string | null | undefined): void {
  const store = als.getStore();
  if (store && businessAccountId) store.businessAccountId = businessAccountId;
}

/** The business account for the current context, if any is known. */
export function currentBusinessAccountId(): string | null {
  const store = als.getStore();
  if (!store) return null;
  if (store.businessAccountId) return store.businessAccountId;
  try {
    return sanitizeId(store.resolveBusinessAccountId?.()) ?? null;
  } catch {
    return null;
  }
}

/** Route label for the current context (matched pattern when known). */
export function currentRoute(): string | undefined {
  const store = als.getStore();
  if (!store) return undefined;
  try {
    return store.resolveRoute?.() || store.route;
  } catch {
    return store.route;
  }
}

/** Only ids that look like ours (uuid / short slug); anything else is ignored. */
export function sanitizeId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}
