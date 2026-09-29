import OpenAI, { type ClientOptions } from "openai";

/**
 * Shared OpenAI client factory.
 *
 * The SDK default is a 10-minute timeout with 2 retries, so one hung upstream
 * call can pin a request (and whatever it holds, e.g. a DB connection or a
 * WhatsApp webhook worker) for ~30 minutes. Every client in server/ should be
 * built here (or pass an explicit `timeout`) — see
 * scripts/check-openai-timeouts.mjs.
 *
 * Note on semantics (openai-node v6): `timeout` covers the time until response
 * headers arrive. For non-streaming calls that is the whole generation; for
 * `stream: true` it is the time to first byte, the stream itself is not cut.
 */
export const OPENAI_TIMEOUTS = {
  /** Short classification / translation / small JSON outputs. */
  default: 60_000,
  /** Vision calls on user images (download by OpenAI + analysis). */
  vision: 90_000,
  /** Customer-facing chat replies (streaming and tool-calling) and conversation analysis. */
  chat: 120_000,
  /** Long generations over large inputs (website analysis, URL training). */
  longGeneration: 180_000,
  /** Large document (PDF) extraction and Batch API file uploads/downloads. */
  document: 300_000,
} as const;

export const DEFAULT_OPENAI_TIMEOUT_MS = OPENAI_TIMEOUTS.default;
export const DEFAULT_OPENAI_MAX_RETRIES = 1;

/** Resolves the options actually handed to the SDK (exported for tests). */
export function resolveOpenAIOptions(opts: ClientOptions = {}): ClientOptions {
  return {
    ...opts,
    timeout: opts.timeout ?? DEFAULT_OPENAI_TIMEOUT_MS,
    maxRetries: opts.maxRetries ?? DEFAULT_OPENAI_MAX_RETRIES,
  };
}

/**
 * `new OpenAI(opts)` with a bounded timeout (60s) and 1 retry unless the caller
 * specifies otherwise. Works for OpenAI-compatible endpoints too (e.g. the
 * Gemini `baseURL`).
 */
export function createOpenAI(opts: ClientOptions = {}): OpenAI {
  return new OpenAI(resolveOpenAIOptions(opts));
}
