/**
 * Phone and video calls: a quick AI check picks how to react while the real answer is being written —
 * a "Let me check that." for a factual question, "Hmm, good question." for advice, "Oh, I
 * understand." for a problem, "Achha, theek hai." when they told us something, or nothing.
 *
 * It runs in parallel with the answer, as soon as the caller's words are transcribed, and only
 * CHOOSES among the ready-recorded phrases (voice/fillers.ts) — it never writes what is spoken,
 * so a reaction can't contradict the answer or promise anything. When it is not back in time
 * (timeoutMs), the word rules (fillerKind) decide. Video calls (the live avatar) always ask it;
 * phone calls only with PHONE_FILLER_AI=1.
 */
import { createOpenAI } from "../../lib/openaiClient";
import { FILLER_KINDS, type FillerKind } from "./fillers";

export type FillerChoice = FillerKind | "none";

const PHONE_SYSTEM = [
  "You choose how a warm, human phone agent reacts in the second before answering the caller.",
  "Reply with JSON {\"kind\": <one of>}:",
  "- \"lookup\": they asked for a fact or detail the agent must look up (price, premium, fees, dates, documents, eligibility, how something works).",
  "- \"thinking\": they asked for advice, a recommendation or a comparison (which is better, what should I do).",
  "- \"empathy\": they describe a problem, complaint, worry, loss or frustration.",
  "- \"ack\": they told something about themselves or answered the agent's question (\"I want health insurance\", \"I am 35\", \"for my parents\").",
  "- \"repeat\": they ask the agent to say it again / repeat / pardon.",
  "- \"none\": greeting, small talk, thanks, yes/no, \"not interested\", goodbye, asking to change language, asking who is calling or whether you can hear them.",
].join("\n");

// The same choices for a video call with a website visitor (who may speak English, Hindi or Hinglish,
// in either script: "ठीक है, थैंक यू" is thanks).
const VIDEO_SYSTEM = PHONE_SYSTEM
  .replace("a warm, human phone agent reacts in the second before answering the caller.", "a warm, human agent on a video call reacts in the second before answering the visitor. They may speak English, Hindi or Hinglish, in Latin or Devanagari script.")
  .replace(/the caller/g, "the visitor");

export async function aiFillerChoice(input: {
  openaiApiKey: string;
  businessAccountId: string;
  transcript: string;
  lastAssistantText?: string | null;
  timeoutMs?: number;
  /** Default "phone". */
  channel?: "phone" | "video";
}): Promise<FillerChoice | null> {
  const text = String(input.transcript || "").trim().slice(0, 400);
  if (!text || !input.openaiApiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 1200);
  try {
    const openai = createOpenAI({ apiKey: input.openaiApiKey, businessAccountId: input.businessAccountId, feature: "voice_filler_choice", category: "voice_mode", maxRetries: 0 });
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 12,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.channel === "video" ? VIDEO_SYSTEM : PHONE_SYSTEM },
        { role: "user", content: `${input.lastAssistantText ? `Agent just said: "${String(input.lastAssistantText).slice(-300)}"\n` : ""}${input.channel === "video" ? "Visitor" : "Caller"}: "${text}"` },
      ],
    }, { signal: controller.signal });
    const kind = String(JSON.parse(res.choices[0]?.message?.content || "{}")?.kind || "").toLowerCase();
    return kind === "none" || (FILLER_KINDS as string[]).includes(kind) ? (kind as FillerChoice) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
