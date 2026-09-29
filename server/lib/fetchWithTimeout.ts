/**
 * `fetch` with a hard deadline. Native fetch has no default timeout, so a
 * stalled upstream (Graph API, Salesforce, a customer webhook...) can hang a
 * request forever. The returned promise rejects with a `TimeoutError`
 * DOMException (name === 'TimeoutError') when the deadline passes, which flows
 * into callers' existing try/catch like any other network error.
 *
 * If the caller already passes `init.signal`, both signals are honoured.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
/** For file downloads / uploads (media, documents). */
export const LONG_FETCH_TIMEOUT_MS = 120_000;

export function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  ms: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(ms);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetch(input, { ...init, signal });
}

export function isTimeoutError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "TimeoutError";
}
