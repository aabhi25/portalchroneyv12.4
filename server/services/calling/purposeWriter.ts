/**
 * AI Calling — "Write it with AI" for the call purpose: the business writes a line or two, the AI
 * turns it into clear, detailed instructions for the calling agent. The business reviews the text
 * and saves it themselves; nothing is saved here.
 *
 * Uses the business's OpenAI key (storage.getBusinessAccountOpenAIKey → master key when enabled)
 * with gpt-4o-mini; usage is tracked by createOpenAI (feature "ai_calling_purpose").
 * Tests replace the writer with setPurposeWriterForTesting.
 */
import { CALL_PURPOSE_MAX, type CallDirection } from "@shared/aiCalling";

export interface PurposeWriterInput {
  businessAccountId: string;
  businessName: string | null;
  direction: CallDirection;
  /** The business's own words (a line or two, or a purpose to improve). */
  brief: string;
}

export class PurposeWriterError extends Error {}

type Writer = (input: PurposeWriterInput) => Promise<string>;

let override: Writer | null = null;

export function setPurposeWriterForTesting(fn: Writer | null): void {
  override = fn;
}

/** Shortest brief worth expanding (a few words). */
export const PURPOSE_BRIEF_MIN = 10;
// The suggestion leaves room for the business to add to it before hitting the save limit.
const SUGGESTION_MAX = CALL_PURPOSE_MAX - 200;

export function purposeWriterPrompt(input: Pick<PurposeWriterInput, "businessName" | "direction">): string {
  const who = input.businessName ? `"${input.businessName}"` : "a business";
  const call = input.direction === "outbound"
    ? `calls people who enquired with ${who} (the AI rings them a few minutes after they leave their details)`
    : `answers phone calls from people who call ${who}`;
  return [
    `You write the "purpose of the call" for an AI phone agent that ${call}.`,
    "The business gives a line or two (or a rough draft). Turn it into clear instructions the agent follows on every call.",
    "",
    "Write to the agent as \"you\", in plain sentences (no headings, bullets, markdown or emojis), 6 to 10 sentences, under 1,100 characters, in the same language as the business's words.",
    "Cover, in this order: the main goal of the call; what to find out from the person; how to answer and keep the conversation going; what to do if they are interested; what to do if they are not ready or unsure; the next step to secure before the call ends; and what never to do.",
    "Keep every specific thing the business said (programmes, products, offers, steps). Never add facts they did not give: no prices, fees, discounts, dates, deadlines, guarantees, rankings or numbers.",
    "Keep it polite and respectful: one gentle attempt is fine, but the agent must stop if the person is not interested or asks not to be called, and must never pressure or mislead.",
    "Do not write an opening line or a greeting (those are set separately), and do not tell the agent to ask for the person's phone number (it is already on the call).",
    "Reply with the purpose text only.",
  ].join("\n");
}

/** Tidy the model's text: no quotes / markdown, single spaces, within the limit (cut at a sentence end). */
export function cleanPurpose(text: string): string {
  let t = String(text || "")
    .replace(/^["'“”\s]+|["'“”\s]+$/g, "")
    .replace(/^[-*•]\s+/gm, "")
    .replace(/[*_#`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > SUGGESTION_MAX) {
    const cut = t.slice(0, SUGGESTION_MAX);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("। "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    t = end > SUGGESTION_MAX / 2 ? cut.slice(0, end + 1) : cut;
  }
  return t;
}

async function defaultWriter(input: PurposeWriterInput): Promise<string> {
  const { storage } = await import("../../storage");
  const apiKey = await storage.getBusinessAccountOpenAIKey(input.businessAccountId);
  if (!apiKey) throw new PurposeWriterError("Add an OpenAI key for this account to use AI suggestions.");
  const { createOpenAI } = await import("../../lib/openaiClient");
  const openai = createOpenAI({ apiKey, feature: "ai_calling_purpose", businessAccountId: input.businessAccountId, timeout: 30_000 });
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 500,
    messages: [
      { role: "system", content: purposeWriterPrompt(input) },
      { role: "user", content: input.brief },
    ],
  });
  return response.choices[0]?.message?.content || "";
}

export async function writeCallPurpose(input: PurposeWriterInput): Promise<string> {
  const brief = input.brief.replace(/\s+/g, " ").trim().slice(0, CALL_PURPOSE_MAX);
  if (brief.length < PURPOSE_BRIEF_MIN) throw new PurposeWriterError("Write a line or two about what the call is for first.");
  const text = cleanPurpose(await (override ?? defaultWriter)({ ...input, brief }));
  if (!text) throw new PurposeWriterError("The AI couldn't write a suggestion. Please try again.");
  return text;
}
