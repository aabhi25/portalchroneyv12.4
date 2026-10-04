/**
 * AI Calling — post-call analysis: a short summary, the outcome, a callback time if the customer
 * asked for one, and details the customer gave (name, email, …).
 *
 * Uses the business's OpenAI key (storage.getBusinessAccountOpenAIKey → master key when enabled)
 * with gpt-4o-mini in JSON mode; usage is tracked automatically by createOpenAI (feature
 * "ai_calling_summary"). Returns null when there is no key / no transcript / the model fails —
 * the lifecycle then keeps the outcome the voice AI set during the call.
 * Tests replace the analyser with setCallSummarizerForTesting.
 */
import { CALL_OUTCOME_LABEL, type CallOutcome } from "@shared/aiCalling";

export interface CallSummaryInput {
  businessAccountId: string;
  businessName: string | null;
  direction: "outbound" | "inbound";
  callPurpose: string | null;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  now: Date;
  timezone: string;
}

export interface CallSummary {
  summary: string | null;
  outcome: CallOutcome | null;
  outcomeNote: string | null;
  callbackAt: Date | null;
  capturedFields: Record<string, string>;
}

type Summarizer = (input: CallSummaryInput) => Promise<CallSummary | null>;

let override: Summarizer | null = null;

export function setCallSummarizerForTesting(fn: Summarizer | null): void {
  override = fn;
}

const OUTCOMES = Object.keys(CALL_OUTCOME_LABEL) as CallOutcome[];
const MAX_CALLBACK_DAYS = 60;

export function sanitizeSummary(parsed: any, now: Date): CallSummary {
  const outcome = OUTCOMES.includes(parsed?.outcome) ? (parsed.outcome as CallOutcome) : null;
  let callbackAt: Date | null = null;
  if (parsed?.callbackAt) {
    const d = new Date(String(parsed.callbackAt));
    if (!Number.isNaN(d.getTime()) && d.getTime() > now.getTime() && d.getTime() < now.getTime() + MAX_CALLBACK_DAYS * 86_400_000) callbackAt = d;
  }
  const capturedFields: Record<string, string> = {};
  if (parsed?.capturedFields && typeof parsed.capturedFields === "object" && !Array.isArray(parsed.capturedFields)) {
    for (const [k, v] of Object.entries(parsed.capturedFields).slice(0, 20)) {
      if (v === null || v === undefined) continue;
      const key = String(k).trim().slice(0, 60);
      const val = String(v).trim().slice(0, 300);
      if (key && val) capturedFields[key] = val;
    }
  }
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return { summary: text(parsed?.summary, 1200), outcome, outcomeNote: text(parsed?.outcomeNote, 300), callbackAt, capturedFields };
}

function localNow(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, dateStyle: "full", timeStyle: "short" }).format(now);
  } catch {
    return now.toISOString();
  }
}

async function defaultSummarizer(input: CallSummaryInput): Promise<CallSummary | null> {
  if (!input.transcript.length) return null;
  const { storage } = await import("../../storage");
  const apiKey = await storage.getBusinessAccountOpenAIKey(input.businessAccountId);
  if (!apiKey) return null;
  const { createOpenAI } = await import("../../lib/openaiClient");
  const openai = createOpenAI({ apiKey, feature: "ai_calling_summary", businessAccountId: input.businessAccountId, timeout: 30_000 });
  const transcript = input.transcript
    .slice(-80)
    .map((m) => `${m.role === "user" ? "Customer" : "AI"}: ${m.content}`)
    .join("\n")
    .slice(-12_000);
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          `You analyse a phone call between ${input.businessName ? `"${input.businessName}"'s` : "a business's"} AI assistant and a customer ` +
          `(${input.direction === "outbound" ? "the AI called the customer" : "the customer called the business"}).` +
          (input.callPurpose ? ` Purpose of the call: ${input.callPurpose}` : "") +
          `\nIt is now ${localNow(input.now, input.timezone)} (time zone ${input.timezone}).` +
          `\nReturn JSON only: {"summary": "2-4 plain sentences for the business team", ` +
          `"outcome": one of ${JSON.stringify(OUTCOMES)}, "outcomeNote": "one short line or null", ` +
          `"callbackAt": "ISO 8601 date-time WITH the time zone offset if the customer asked to be called back at a specific time, else null", ` +
          `"capturedFields": {"name": "...", "email": "...", ... only details the customer clearly gave}}.` +
          `\nUse "do_not_call" only if the customer asked not to be called again; "callback_requested" if they asked to be called later; ` +
          `"wrong_number" if the person said it is the wrong number.`,
      },
      { role: "user", content: transcript },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) return null;
  let parsed: any;
  try { parsed = JSON.parse(content); } catch { return null; }
  return sanitizeSummary(parsed, input.now);
}

export async function summarizeCall(input: CallSummaryInput): Promise<CallSummary | null> {
  try {
    return await (override ?? defaultSummarizer)(input);
  } catch (err: any) {
    console.error("[Calling] call summary failed:", err?.message || err);
    return null;
  }
}
