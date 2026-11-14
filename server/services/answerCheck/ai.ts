import type OpenAI from "openai";
import { createOpenAI, OPENAI_TIMEOUTS } from "../../lib/openaiClient";
import { estimateTextCostUsd } from "../aiUsageLogger";
import { storage } from "../../storage";
import { parseJsonReply } from "./prompts";

/**
 * Answer checking pilot — the AI calls. GPT-4.1 reads, drafts schemes and marks; GPT-4.1 mini
 * estimates the AI-written share and writes practice answers. Every call asks for JSON at a
 * low temperature (the same answer should get the same marks) and adds its cost to a running
 * total so each check shows what it cost. Usage is also recorded in ai_usage_events by the
 * shared client, billed to the account whose key is used.
 */

export const ANSWER_CHECK_MODEL = process.env.ANSWER_CHECK_MODEL?.trim() || "gpt-4.1";
export const ANSWER_CHECK_MINI_MODEL = process.env.ANSWER_CHECK_MINI_MODEL?.trim() || "gpt-4.1-mini";

export interface JsonCall {
  model: string;
  system: string;
  /** Text, optionally followed by images (data URLs) — the photos of the answer. */
  user: string;
  images?: string[];
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

export function openAiAnswerCheck(client: OpenAI): AnswerCheckAi {
  let spent = 0;
  return {
    costUsd: () => spent,
    async json(call: JsonCall) {
      const content: any = call.images?.length
        ? [{ type: "text", text: call.user }, ...call.images.map(url => ({ type: "image_url", image_url: { url, detail: "high" } }))]
        : call.user;
      const response = await client.chat.completions.create({
        model: call.model,
        messages: [{ role: "system", content: call.system }, { role: "user", content }],
        temperature: call.temperature ?? 0,
        max_tokens: call.maxTokens,
        response_format: { type: "json_object" },
      } as any, { timeout: call.timeoutMs ?? OPENAI_TIMEOUTS.vision });
      const usage: any = (response as any).usage;
      if (usage) {
        spent += estimateTextCostUsd(call.model, usage.prompt_tokens || 0, usage.completion_tokens || 0, usage.prompt_tokens_details?.cached_tokens || 0);
      }
      const choice = (response as any).choices?.[0];
      if (choice?.finish_reason === "length") console.warn(`[Answer Check] ${call.model} reply was cut at ${call.maxTokens} tokens`);
      return parseJsonReply(choice?.message?.content);
    },
  };
}
