import type OpenAI from "openai";
import { createOpenAI, OPENAI_TIMEOUTS } from "../../lib/openaiClient";
import { estimateTextCostUsd } from "../aiUsageLogger";
import { storage } from "../../storage";
import { parseJsonReply } from "./prompts";

/**
 * Answer checking pilot — the AI calls. One low-cost model reads, matches, locates and marks; an
 * answer whose marks are in doubt is marked again by the same model thinking harder, and by a second
 * model when the two markings differ (measured on 61 answers: about as fair as GPT-4.1 for a
 * tenth of the cost, and it copied planted mistakes that GPT-4.1 silently put right). The second
 * model also writes answer keys and reads a hard-to-read sheet again. Every call asks for JSON and
 * adds its cost to a running total so each check shows what it cost. Usage is also recorded in
 * ai_usage_events by the shared client, billed to the account whose key is used.
 */

export const ANSWER_CHECK_MODEL = process.env.ANSWER_CHECK_MODEL?.trim() || "gpt-6-luna";
export const ANSWER_CHECK_SECOND_MODEL = process.env.ANSWER_CHECK_SECOND_MODEL?.trim() || "gpt-6.1-terra";
/** Used instead when an account's key can't use the models above. */
const FALLBACK_MODEL = "gpt-4.1";

/** How hard a model thinks before it answers (models before GPT-5 don't have it). */
export type Effort = "none" | "low" | "medium" | "high";
/** Room for the thinking, on top of the reply. */
const THINKING_TOKENS: Record<Effort, number> = { none: 0, low: 2000, medium: 5000, high: 8000 };

export interface JsonCall {
  model: string;
  effort?: Effort;
  system: string;
  /** Text, optionally followed by images (data URLs) — the photos of the answer. */
  user: string;
  images?: string[];
  /** One line said before each image ("Page 2, strip 1 of 3"), in the images' order. */
  imageLabels?: string[];
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface AnswerCheckAi {
  json(call: JsonCall): Promise<Record<string, any> | null>;
  /** USD spent by this client so far. */
  costUsd(): number;
}

export class AnswerCheckAiError extends Error {}

/** The account's OpenAI key, as every other Top Scholar AI feature uses it. */
export async function createAnswerCheckAi(businessAccountId: string): Promise<AnswerCheckAi> {
  const apiKey = await storage.getBusinessAccountOpenAIKey(businessAccountId);
  if (!apiKey) throw new AnswerCheckAiError("This account has no OpenAI key, so answers can't be checked.");
  const client = createOpenAI({ apiKey, businessAccountId, feature: "answer_checking", timeout: OPENAI_TIMEOUTS.vision });
  return openAiAnswerCheck(client);
}

/** A model this key has no access to (or that no longer exists). */
export function isModelUnavailable(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  return (status === 403 || status === 404) && /model/i.test(String(err?.message || err?.error?.message || ""));
}

/** The settings a model takes: GPT-5 and later think, and take no temperature. */
export function modelParams(model: string, call: Pick<JsonCall, "maxTokens" | "effort" | "temperature">): Record<string, unknown> {
  if (/^gpt-(3|4)/.test(model)) return { temperature: call.temperature ?? 0, max_tokens: call.maxTokens };
  const effort = call.effort ?? "none";
  return { reasoning_effort: effort, max_completion_tokens: call.maxTokens + THINKING_TOKENS[effort] };
}

export function openAiAnswerCheck(client: OpenAI): AnswerCheckAi {
  let spent = 0;
  const unavailable = new Set<string>();
  const create = async (model: string, call: JsonCall, messages: unknown[]) => client.chat.completions.create({
    model,
    messages,
    ...modelParams(model, call),
    response_format: { type: "json_object" },
  } as any, { timeout: call.timeoutMs ?? OPENAI_TIMEOUTS.vision });
  return {
    costUsd: () => spent,
    async json(call: JsonCall) {
      const content: any = call.images?.length
        ? [{ type: "text", text: call.user }, ...call.images.flatMap((url, i) => [
          ...(call.imageLabels?.[i] ? [{ type: "text", text: call.imageLabels[i] }] : []),
          { type: "image_url", image_url: { url, detail: "high" } },
        ])]
        : call.user;
      const messages = [{ role: "system", content: call.system }, { role: "user", content }];
      let model = unavailable.has(call.model) ? FALLBACK_MODEL : call.model;
      let response: any;
      try {
        response = await create(model, call, messages);
      } catch (err: any) {
        if (model === FALLBACK_MODEL || !isModelUnavailable(err)) throw err;
        console.warn(`[Answer Check] ${model} can't be used with this account's key, using ${FALLBACK_MODEL}:`, err?.message || err);
        unavailable.add(model);
        model = FALLBACK_MODEL;
        response = await create(model, call, messages);
      }
      const usage: any = response.usage;
      if (usage) {
        spent += estimateTextCostUsd(model, usage.prompt_tokens || 0, usage.completion_tokens || 0, usage.prompt_tokens_details?.cached_tokens || 0);
      }
      const choice = response.choices?.[0];
      if (choice?.finish_reason === "length") console.warn(`[Answer Check] ${model} reply was cut at ${call.maxTokens} tokens`);
      return parseJsonReply(choice?.message?.content);
    },
  };
}
