import OpenAI, { type ClientOptions } from "openai";
import { getRequestContext, currentBusinessAccountId, currentRoute, sanitizeId } from "./requestContext";
import { billedModel, planChatBody, rescuingFetch, type AiJob } from "./modelMove";

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
 *
 * ── Automatic AI usage (cost) tracking ────────────────────────────────────
 * Clients built here record token usage for chat.completions.create,
 * responses.create and embeddings.create into ai_usage_events (via
 * aiUsageLogger), so every OpenAI call is costed, not only the ones that log
 * explicitly. Attribution:
 *   - business account: `businessAccountId` option, else the request/job
 *     context (server/lib/requestContext.ts: req.user's active account, webhook
 *     route params, the widget's businessAccountId, or runWithContext in
 *     workers). ai_usage_events.business_account_id is NOT NULL, so calls with
 *     no known account are skipped and counted in getUsageTrackingStats().
 *   - feature label (metadata.feature): `feature` option, else the context's
 *     feature, else "unlabeled:<file that created the client>".
 * Streams: when the caller did not ask for usage, `stream_options.include_usage`
 * is added and the extra usage-only final chunk is swallowed (and the `usage:
 * null` field removed from the other chunks), so callers see exactly the chunks
 * they would have seen. A stream abandoned before its end records nothing.
 *
 * Opt out (the call site records usage itself — prevents double counting):
 *   - whole client: createOpenAI({ ..., trackUsage: false })
 *   - single call:  withoutUsageTracking(() => client.chat.completions.create(...))
 * See scripts/check-openai-usage.mjs.
 *
 * ── Models that are closing ───────────────────────────────────────────────
 * Chat calls may be answered by a newer model than the one named at the call site, per job
 * (modelMove.ts); usage is recorded under the model that answered. `job` names the client's job
 * when it can't be told from the call; `modelMove: false` leaves a client's calls exactly as written.
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

/** Matches aiUsageLogger's UsageCategory (kept as a string union to avoid importing the DB here). */
export type TrackedUsageCategory =
  | "chat" | "website_analysis" | "document_analysis" | "image_search" | "voice_mode" | "rag_embeddings";

export interface UsageTrackingOptions {
  /** false: this client's calls are not recorded (the caller logs usage itself). Default true. */
  trackUsage?: boolean;
  /** Feature label stored in ai_usage_events.metadata.feature. */
  feature?: string;
  /** Account to bill when known at construction time (else taken from the request/job context). */
  businessAccountId?: string | null;
  /** Category override (default: "chat" for completions/responses, "rag_embeddings" for embeddings). */
  category?: TrackedUsageCategory;
  /** The job its calls belong to (modelMove.ts); told from each call when left out. */
  job?: AiJob;
  /** false: calls are sent exactly as written (the caller picks its own models). Default true. */
  modelMove?: boolean;
}

export type CreateOpenAIOptions = ClientOptions & UsageTrackingOptions;

/** Resolves the options actually handed to the SDK (exported for tests). */
export function resolveOpenAIOptions(opts: CreateOpenAIOptions = {}): ClientOptions {
  const { trackUsage: _t, feature: _f, businessAccountId: _b, category: _c, job: _j, modelMove: _m, ...sdkOpts } = opts;
  return {
    ...sdkOpts,
    timeout: sdkOpts.timeout ?? DEFAULT_OPENAI_TIMEOUT_MS,
    maxRetries: sdkOpts.maxRetries ?? DEFAULT_OPENAI_MAX_RETRIES,
  };
}

/**
 * `new OpenAI(opts)` with a bounded timeout (60s) and 1 retry unless the caller
 * specifies otherwise, plus automatic usage tracking (see above). Works for
 * OpenAI-compatible endpoints too (e.g. the Gemini `baseURL`).
 */
export function createOpenAI(opts: CreateOpenAIOptions = {}): OpenAI {
  // Only OpenAI itself is known to accept stream_options (a 400 from others, e.g. Gemini), and only
  // its models are moved.
  const isOpenAI = !opts.baseURL || /(^|\/\/)(api\.openai\.com|127\.0\.0\.1|localhost)([:/]|$)/.test(opts.baseURL);
  // Assessment picks its own models (services/answerCheck/ai.ts).
  const movesModels = isOpenAI && opts.modelMove !== false && opts.feature !== "answer_checking";
  const sdkOpts = resolveOpenAIOptions(opts);
  const client: OpenAI = new OpenAI(movesModels
    ? { ...sdkOpts, fetch: rescuingFetch(sdkOpts.fetch as any, () => client.apiKey) as any }
    : sdkOpts);
  // Always instrumented: an opted-out client (trackUsage: false) still goes
  // through the monthly budget check; it just doesn't record usage.
  instrumentClient(client, {
    feature: opts.feature,
    businessAccountId: opts.businessAccountId ?? null,
    category: opts.category,
    origin: callerFile(),
    injectStreamUsage: isOpenAI,
    trackUsage: opts.trackUsage !== false,
    movesModels,
    job: opts.job,
  });
  return client;
}

// ── monthly AI budget (block mode) ───────────────────────────────────────────
//
// When a super admin sets a monthly limit with action "block" and the account's
// month-to-date spend has reached it, every new call made through a client
// built here is refused BEFORE any request is sent to OpenAI, by rejecting with
// AiBudgetExceededError. The decision comes from an in-memory cache owned by
// server/services/aiBudgetService.ts (registered via setAiBudgetGuard), so the
// hot path makes no DB query. Calls with no known business account are never
// blocked, and nothing is blocked while no guard is registered.

export class AiBudgetExceededError extends Error {
  readonly code = "AI_BUDGET_EXCEEDED";
  constructor(
    readonly businessAccountId: string,
    readonly limitUsd: number,
    readonly spentUsd: number,
  ) {
    super(`Monthly AI budget reached for this account ($${spentUsd.toFixed(2)} of $${limitUsd.toFixed(2)})`);
    this.name = "AiBudgetExceededError";
  }
}

/** True for AiBudgetExceededError (also when wrapped as another error's `cause`). */
export function isAiBudgetExceededError(err: unknown): err is AiBudgetExceededError {
  let e: any = err;
  for (let i = 0; e && i < 5; i++, e = e.cause) {
    if (e instanceof AiBudgetExceededError || e?.code === "AI_BUDGET_EXCEEDED") return true;
  }
  return false;
}

export interface AiBudgetDecision {
  blocked: boolean;
  limitUsd?: number;
  spentUsd?: number;
}

export interface AiBudgetGuard {
  /** Synchronous from cache when warm; a promise only while the cache has never loaded. */
  check(businessAccountId: string): AiBudgetDecision | Promise<AiBudgetDecision>;
}

let budgetGuard: AiBudgetGuard | null = null;

export const budgetStats = { blocked: 0, guardErrors: 0 };

/** Registered by aiBudgetService (null unregisters: nothing is blocked). */
export function setAiBudgetGuard(guard: AiBudgetGuard | null): void {
  budgetGuard = guard;
}

// ── usage tracking internals ─────────────────────────────────────────────────

export interface UsageRecord {
  businessAccountId: string;
  category: TrackedUsageCategory;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  tokensInputCached: number;
  tokensInputAudio: number;
  tokensOutputAudio: number;
  /** Input tokens OpenAI charged for remembering (GPT-5.6 and later); left out when none. */
  tokensInputCacheWrite?: number;
  metadata: Record<string, unknown>;
}

export type UsageRecorder = (rec: UsageRecord) => Promise<void>;

const defaultRecorder: UsageRecorder = async (rec) => {
  // Lazy import: aiUsageLogger pulls in the DB; the factory must stay importable without it.
  const { aiUsageLogger } = await import("../services/aiUsageLogger");
  await aiUsageLogger.logUsage(rec);
};

let recorder: UsageRecorder = defaultRecorder;
const pending = new Set<Promise<void>>();

export const usageTrackingStats = {
  recorded: 0,
  skippedNoAccount: 0,
  skippedNoUsage: 0,
  optedOut: 0,
  errors: 0,
};

export function getUsageTrackingStats() {
  return { ...usageTrackingStats };
}

/** Test hook: swap the recorder (null restores the aiUsageLogger one). */
export function __setUsageRecorderForTests(r: UsageRecorder | null): void {
  recorder = r ?? defaultRecorder;
}

/** Waits for in-flight usage writes (tests / shutdown). */
export async function flushUsageRecords(): Promise<void> {
  while (pending.size) await Promise.allSettled(Array.from(pending));
}

interface InstrumentConfig {
  feature?: string;
  businessAccountId: string | null;
  category?: TrackedUsageCategory;
  origin: string;
  injectStreamUsage: boolean;
  /** false: budget check only, no usage recording (default true). */
  trackUsage?: boolean;
  movesModels?: boolean;
  job?: AiJob;
}

type Api = "chat.completions" | "responses" | "embeddings";

interface CallInfo {
  api: Api;
  businessAccountId: string | null;
  feature: string;
  category: TrackedUsageCategory;
  route?: string;
  requestId?: string;
  model: string;
  stream: boolean;
}

interface ExtractedUsage {
  tokensInput: number;
  tokensOutput: number;
  tokensInputCached: number;
  tokensInputAudio: number;
  tokensOutputAudio: number;
  tokensInputCacheWrite?: number;
}

const INSTRUMENTED = Symbol.for("chroney.openaiUsageTracked");

/** Exported for tests: instruments an existing client instance in place. */
export function instrumentClient(client: OpenAI, cfg: InstrumentConfig): OpenAI {
  if ((client as any)[INSTRUMENTED]) return client;
  Object.defineProperty(client, INSTRUMENTED, { value: true });
  patchCreate((client as any).chat?.completions, "chat.completions", cfg, () => (client as any).apiKey);
  patchCreate((client as any).responses, "responses", cfg);
  patchCreate((client as any).embeddings, "embeddings", cfg);
  return client;
}

function patchCreate(resource: any, api: Api, cfg: InstrumentConfig, apiKey?: () => unknown) {
  if (!resource || typeof resource.create !== "function") return;
  const original = resource.create;
  const send = trackedCreateFn(resource, original, api, cfg);
  const tracked = cfg.movesModels && api === "chat.completions"
    ? (body: any, options?: any) => send(planChatBody(body, {
        job: cfg.job,
        accountId: sanitizeId(cfg.businessAccountId) ?? currentBusinessAccountId(),
        apiKey: apiKey?.(),
      }), options)
    : send;
  resource.create = function budgetedCreate(this: unknown, body: any, options?: any) {
    const guard = budgetGuard;
    const accountId = guard ? sanitizeId(cfg.businessAccountId) ?? currentBusinessAccountId() : null;
    if (!guard || !accountId) return tracked(body, options);
    let decision: AiBudgetDecision | Promise<AiBudgetDecision> | null;
    try {
      decision = guard.check(accountId);
    } catch {
      budgetStats.guardErrors++;
      decision = null; // fail open: a broken guard must not take AI down
    }
    if (decision && typeof (decision as Promise<AiBudgetDecision>).then === "function") {
      // Cold cache (first call after start): wait for it once, then decide.
      return (decision as Promise<AiBudgetDecision>)
        .catch((): AiBudgetDecision => { budgetStats.guardErrors++; return { blocked: false }; })
        .then((d) => {
          if (d.blocked) throw budgetError(accountId, d);
          return tracked(body, options);
        });
    }
    const d = decision as AiBudgetDecision | null;
    if (d?.blocked) return Promise.reject(budgetError(accountId, d));
    return tracked(body, options);
  };
}

function budgetError(accountId: string, d: AiBudgetDecision): AiBudgetExceededError {
  budgetStats.blocked++;
  return new AiBudgetExceededError(accountId, d.limitUsd ?? 0, d.spentUsd ?? 0);
}

function trackedCreateFn(resource: any, original: any, api: Api, cfg: InstrumentConfig) {
  return function trackedCreate(body: any, options?: any) {
    const ctx = getRequestContext();
    if (cfg.trackUsage === false) return original.call(resource, body, options);
    if (ctx?.trackUsage === false) {
      usageTrackingStats.optedOut++;
      return original.call(resource, body, options);
    }
    const stream = body?.stream === true;
    const route = currentRoute();
    const info: CallInfo = {
      api,
      businessAccountId: sanitizeId(cfg.businessAccountId) ?? currentBusinessAccountId(),
      feature: cfg.feature || ctx?.feature || `unlabeled:${route && cfg.origin === "unknown" ? route : cfg.origin}`,
      category: cfg.category ?? (api === "embeddings" ? "rag_embeddings" : "chat"),
      route,
      requestId: ctx?.requestId,
      model: typeof body?.model === "string" ? body.model : "unknown",
      stream,
    };

    let callBody = body;
    let injected = false;
    if (stream && api === "chat.completions" && cfg.injectStreamUsage && !body?.stream_options?.include_usage) {
      callBody = { ...body, stream_options: { ...(body.stream_options || {}), include_usage: true } };
      injected = true;
    }

    const p = original.call(resource, callBody, options);
    const onResult = (result: any) => {
      try {
        if (stream) return instrumentStream(result, info, injected);
        info.model = billedModel(info.model, result?.model);
        record(info, extractUsage(api, result?.usage));
      } catch {
        usageTrackingStats.errors++;
      }
      return result;
    };
    // Keep the SDK's APIPromise (withResponse()/asResponse() keep working).
    if (p && typeof p._thenUnwrap === "function") return p._thenUnwrap(onResult);
    return Promise.resolve(p).then(onResult);
  };
}

function instrumentStream(stream: any, info: CallInfo, injected: boolean) {
  if (!stream || typeof stream.iterator !== "function") return stream;
  const makeIterator = stream.iterator;
  stream.iterator = function () {
    return trackedIterator(makeIterator.call(stream), info, injected);
  };
  return stream;
}

async function* trackedIterator(src: AsyncIterator<any>, info: CallInfo, injected: boolean): AsyncGenerator<any> {
  let usage: any = null;
  try {
    // for-await forwards an early break/return to the SDK iterator (aborts the HTTP stream).
    for await (const chunk of { [Symbol.asyncIterator]: () => src }) {
      if (chunk && typeof chunk === "object") {
        if (chunk.model) info.model = billedModel(info.model, chunk.model);
        if (info.api === "responses") {
          if (chunk.response?.usage && /^response\.(completed|incomplete|failed)$/.test(chunk.type || "")) usage = chunk.response.usage;
        } else if (chunk.usage) {
          usage = chunk.usage;
        }
        if (injected) {
          // The usage-only final chunk exists only because we asked for it.
          if (chunk.usage && (!Array.isArray(chunk.choices) || chunk.choices.length === 0)) continue;
          if ("usage" in chunk) delete chunk.usage;
        }
      }
      yield chunk;
    }
  } finally {
    if (usage) {
      try { record(info, extractUsage(info.api, usage)); } catch { usageTrackingStats.errors++; }
    }
  }
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function extractUsage(api: Api, usage: any): ExtractedUsage | null {
  if (!usage || typeof usage !== "object") return null;
  if (api === "responses") {
    return {
      tokensInput: num(usage.input_tokens),
      tokensOutput: num(usage.output_tokens),
      tokensInputCached: num(usage.input_tokens_details?.cached_tokens),
      tokensInputAudio: 0,
      tokensOutputAudio: 0,
    };
  }
  if (api === "embeddings") {
    return {
      tokensInput: num(usage.prompt_tokens ?? usage.total_tokens),
      tokensOutput: 0,
      tokensInputCached: 0,
      tokensInputAudio: 0,
      tokensOutputAudio: 0,
    };
  }
  const written = num(usage.prompt_tokens_details?.cache_write_tokens);
  return {
    ...(written ? { tokensInputCacheWrite: written } : {}),
    tokensInput: num(usage.prompt_tokens),
    tokensOutput: num(usage.completion_tokens),
    tokensInputCached: num(usage.prompt_tokens_details?.cached_tokens),
    tokensInputAudio: num(usage.prompt_tokens_details?.audio_tokens),
    tokensOutputAudio: num(usage.completion_tokens_details?.audio_tokens),
  };
}

function record(info: CallInfo, usage: ExtractedUsage | null) {
  if (!usage || (usage.tokensInput === 0 && usage.tokensOutput === 0)) {
    usageTrackingStats.skippedNoUsage++;
    return;
  }
  if (!info.businessAccountId) {
    usageTrackingStats.skippedNoAccount++;
    if (process.env.OPENAI_USAGE_DEBUG === "1") {
      console.log(`[AIUsage] skipped (no business account): ${info.feature} ${info.model} in:${usage.tokensInput} out:${usage.tokensOutput}`);
    }
    return;
  }
  usageTrackingStats.recorded++;
  const metadata: Record<string, unknown> = {
    feature: info.feature,
    autoTracked: true,
    api: info.api,
    stream: info.stream,
  };
  if (info.route) metadata.route = info.route;
  if (info.requestId) metadata.requestId = info.requestId;
  const p = recorder({
    businessAccountId: info.businessAccountId,
    category: info.category,
    model: info.model,
    ...usage,
    metadata,
  })
    .catch(() => { usageTrackingStats.errors++; })
    .finally(() => { pending.delete(p); });
  pending.add(p);
}

/**
 * Label for the code that called createOpenAI (best effort, from the stack):
 * "server/services/foo.ts:Foo.bar" under tsx; in the esbuild bundle the file is
 * always dist/index.js, so only the (preserved) function name is kept.
 */
function callerFile(): string {
  const stack = new Error().stack || "";
  for (const line of stack.split("\n").slice(1)) {
    // "at fn (/path with spaces/file.ts:1:2)" or "at /path/file.ts:1:2"
    const m = line.match(/^\s*at (?:async )?(?:(.+?) \((.+):\d+:\d+\)|(.+):\d+:\d+)\s*$/);
    if (!m) continue;
    const fn = (m[1] || "").replace(/^new /, "").replace(/^Object\./, "");
    const file = (m[2] || m[3] || "").replace(/^file:\/\//, "");
    // In the bundle everything is dist/index.js, this file's own functions included.
    if (/^(callerFile|createOpenAI)$/.test(fn)) continue;
    if (/openaiClient\.[cm]?[jt]s$/.test(file) || file.includes("node_modules") || file.startsWith("node:")) continue;
    const idx = file.lastIndexOf("/server/");
    const rel = idx >= 0 ? file.slice(idx + 1) : "";
    if (rel) return fn && fn !== "<anonymous>" ? `${rel}:${fn}` : rel;
    return fn && fn !== "<anonymous>" ? fn : "unknown";
  }
  return "unknown";
}
