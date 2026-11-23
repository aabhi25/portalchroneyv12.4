/**
 * Sends OpenAI chat calls written for a closing model to its replacement (shared/aiModelMove.ts),
 * job by job, and corrects the settings the newer models take differently:
 *   - max_tokens → max_completion_tokens; reasoning_effort "none" (no thinking, so no extra delay,
 *     and the only setting gpt-6-luna takes with tools in Chat Completions);
 *   - temperature / top_p are kept while a model takes them: one that refuses is remembered.
 * Safety nets, whatever the switch says: a key that can't use the model asked for (or a model
 * that has closed) is answered by the next one in the chain, and that is remembered for an hour.
 * Kept free of DB imports; services/modelMoveSettings.ts loads the saved switches.
 */
import { createHash } from "crypto";
import { AI_JOBS, defaultModelMove, modelClosed, type AiJob, type ModelMoveSettings } from "@shared/aiModelMove";

export type { AiJob } from "@shared/aiModelMove";

export const LUNA = "gpt-6-luna";
/** Takes no tools in Chat Completions: a call with tools goes to Luna instead. */
export const TERRA = "gpt-6.1-terra";

/**
 * Phone answers: on 32 real call prompts (2026-11-24) it spoke and used its tools like gpt-4.1-mini
 * and started as fast; gpt-6-luna kept offering the callback again and hung up without a goodbye.
 */
export const PHONE_MODEL = "gpt-5.6-luna";

const NEW_MODEL: Record<string, string> = {
  "gpt-4o-mini": LUNA,
  "gpt-4.1-mini": LUNA,
  "gpt-4o": TERRA,
  "gpt-4.1": TERRA,
};
/** The closing model that answers when a key can't use the new one (and it hasn't closed yet). */
const OLD_MODEL: Record<string, string> = { [LUNA]: "gpt-4o-mini", [TERRA]: "gpt-4o" };
/** Last resort, not on the closing list. */
const SPARE: Record<string, string> = { [LUNA]: "gpt-5.6-luna", [TERRA]: "gpt-5.6-terra" };
/** Newer models known to take reasoning_effort "none". */
const NO_THINKING = /^gpt-(6-luna|6-sol|6\.1-terra|5\.6-|5\.4|5\.2|5\.1)/;
/** Room for the thinking of a model that can't switch it off. */
const THINKING_ROOM = 2000;
const UNAVAILABLE_MS = 60 * 60 * 1000;

let settings: ModelMoveSettings = defaultModelMove();

export function setModelMoveSettings(next: ModelMoveSettings): void {
  settings = next;
}
export function getModelMoveSettings(): ModelMoveSettings {
  return settings;
}

/** Whether a job uses its new model for this account. */
export function jobMoved(job: AiJob, accountId?: string | null): boolean {
  const s = settings[job];
  return s.mode === "new" || (s.mode === "accounts" && !!accountId && s.accounts.includes(accountId));
}

export const moveStats = { moved: 0, rescued: 0 };

// ── what a key or model can't do, learned from refusals ──────────────────────

const unavailable = new Map<string, number>();
const noTemperature = new Set<string>();

/** Calls go out as written (tests whose pretend OpenAI answers by model name). */
export function __useOldModelsForTests(): void {
  settings = Object.fromEntries(AI_JOBS.map((j) => [j, { mode: "old", accounts: [] }])) as unknown as ModelMoveSettings;
}

export function __resetModelMoveForTests(): void {
  settings = defaultModelMove();
  unavailable.clear();
  noTemperature.clear();
}

const keyId = (apiKey: unknown) => createHash("sha256").update(String(apiKey || "")).digest("base64").slice(0, 16);

function isUnavailable(model: string, apiKey: unknown): boolean {
  const until = unavailable.get(`${keyId(apiKey)}|${model}`);
  return !!until && until > Date.now();
}

function markUnavailable(model: string, apiKey: unknown): void {
  if (unavailable.size > 5000) unavailable.clear();
  unavailable.set(`${keyId(apiKey)}|${model}`, Date.now() + UNAVAILABLE_MS);
}

// ── planning a call ──────────────────────────────────────────────────────────

const newStyle = (model: string) => /^gpt-([5-9]|\d\d)/.test(model) || /^o\d/.test(model);

function hasImage(body: any): boolean {
  return Array.isArray(body?.messages) && body.messages.some((m: any) =>
    Array.isArray(m?.content) && m.content.some((p: any) => p?.type === "image_url"));
}

/** The job a call belongs to: said by the client, else told from the model and what it carries. */
export function jobOf(body: any, declared?: AiJob): AiJob {
  const model = String(body?.model || "");
  if (declared === "chat" && model === "gpt-4.1-mini") return "phone";
  if (model === "gpt-4o" || model === "gpt-4.1") return "precise"; // a chat's photo answer too
  if (declared) return declared;
  if (hasImage(body)) return "precise";
  if (Array.isArray(body?.tools) && body.tools.length) return "chat";
  return "small";
}

/** The models to try for a call, in order. */
export function modelChain(body: any, job: AiJob, accountId?: string | null): string[] {
  const asked = String(body?.model || "");
  const tools = Array.isArray(body?.tools) && body.tools.length > 0;
  const named = !!OLD_MODEL[asked]; // the code (or AI providers) names the new model itself
  let next = named ? asked : NEW_MODEL[asked];
  if (!next) return [asked];
  if (job === "phone" && !named) next = PHONE_MODEL;
  if (next === TERRA && tools) next = LUNA;
  const old = named ? OLD_MODEL[next] : asked;
  const chain = named || jobMoved(job, accountId) ? [next, old] : [old, next];
  const spare = SPARE[next] ?? LUNA;
  return Array.from(new Set([...chain, spare])).filter((m) => !modelClosed(m));
}

/** The call's body with the settings `model` takes. */
export function bodyFor(model: string, body: any): any {
  const b = { ...body, model };
  if (!newStyle(model)) {
    if (b.max_completion_tokens !== undefined) {
      b.max_tokens = b.max_completion_tokens;
      delete b.max_completion_tokens;
    }
    delete b.reasoning_effort;
    return b;
  }
  if (b.reasoning_effort === undefined && NO_THINKING.test(model)) b.reasoning_effort = "none";
  const thinking = b.reasoning_effort !== "none";
  if (b.max_tokens !== undefined) {
    b.max_completion_tokens = b.max_tokens + (thinking ? THINKING_ROOM : 0);
    delete b.max_tokens;
  }
  if (thinking || noTemperature.has(model)) {
    delete b.temperature;
    delete b.top_p;
  }
  return b;
}

/** The body to send: the first model of the chain this key is not known to lack. */
export function planChatBody(body: any, opts: { job?: AiJob; accountId?: string | null; apiKey?: unknown }): any {
  if (!body || typeof body.model !== "string") return body;
  const chain = modelChain(body, jobOf(body, opts.job), opts.accountId);
  const model = chain.find((m) => !isUnavailable(m, opts.apiKey)) ?? chain[0] ?? body.model;
  if (model === body.model && !newStyle(model)) return body;
  if (model !== body.model) moveStats.moved++;
  return bodyFor(model, body);
}

// ── refusals ─────────────────────────────────────────────────────────────────

const refusesModel = (status: number, text: string) =>
  (status === 403 || status === 404) && /model/i.test(text) ||
  status === 400 && /model/i.test(text) && /(does not exist|not found|deprecated|shut ?down|no longer|not supported|do not have access)/i.test(text);

const refusesTemperature = (status: number, text: string) => status === 400 && /temperature|top_p/i.test(text) && /unsupported|not supported|does not support/i.test(text);

type FetchLike = (url: any, init?: any) => Promise<Response>;

/** fetch that answers a refused chat call with the next setting or model (a working one is untouched). */
export function rescuingFetch(base: FetchLike | undefined, apiKey: () => unknown): FetchLike {
  const go: FetchLike = (url, init) => (base ?? globalThis.fetch)(url, init);
  return async (url, init) => {
    let res = await go(url, init);
    if (res.ok || typeof init?.body !== "string" || !/\/chat\/completions(\?|$)/.test(String(url))) return res;
    for (let tries = 0; tries < 4 && (res.status === 400 || res.status === 403 || res.status === 404); tries++) {
      const text = await res.clone().text().catch(() => "");
      let body: any;
      try { body = JSON.parse(init.body); } catch { return res; }
      let next: any = null;
      if (refusesTemperature(res.status, text) && (body.temperature !== undefined || body.top_p !== undefined)) {
        noTemperature.add(body.model);
        next = { ...body };
        delete next.temperature;
        delete next.top_p;
      } else if (refusesModel(res.status, text)) {
        markUnavailable(body.model, apiKey());
        // A moved model falls back to the one it replaced; a closing model to its replacement.
        const chain = modelChain(OLD_MODEL[body.model] || NEW_MODEL[body.model] ? body : { ...body, model: spareOf(body.model) }, "small")
          .filter((m) => m !== body.model && !isUnavailable(m, apiKey()));
        if (chain[0]) {
          next = bodyFor(chain[0], body);
          console.warn(`[ModelMove] ${body.model} refused (${res.status}) — answered by ${chain[0]}`);
        }
      }
      if (!next) return res;
      moveStats.rescued++;
      init = { ...init, body: JSON.stringify(next) };
      res = await go(url, init);
      if (res.ok) return res;
    }
    return res;
  };
}

/** The moved model a spare stands in for (so a refused spare can still try the rest). */
function spareOf(model: string): string {
  return Object.keys(SPARE).find((m) => SPARE[m] === model) ?? model;
}

/** The model a call was really answered by: OpenAI's reply names it (dated for older models). */
export function billedModel(asked: string, answeredBy: unknown): string {
  const name = typeof answeredBy === "string" ? answeredBy.replace(/-\d{4}-\d{2}-\d{2}$/, "") : "";
  if (!name || name === asked) return asked;
  const known = new Set<string>([...Object.keys(NEW_MODEL), ...Object.values(NEW_MODEL), ...Object.values(SPARE)]);
  return known.has(name) ? name : asked;
}
