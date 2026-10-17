/**
 * Phone calls: the first few words of a reply, written live by a fast model while the real answer
 * is still being looked up — "Achha, parents dono sixty plus hain," / "Okay, a 2019 i20," — so
 * the caller hears a reaction to WHAT THEY SAID, and the answer then carries on from it (the main
 * model is told these words were already spoken; see realtimeVoiceService + chatService).
 *
 * Why (self-call recordings + research, 2026-10-17, research_notes/Natural phone openers/):
 * a canned clip ("Got it.", "Achha, toh…") followed by 1-3 s of silence sounded stitched; the
 * caller took it as the end of the turn and talked over the answer. The pattern used by Inworld,
 * LiveKit (fast pre-response), ElevenLabs Agents and Agora is a short CONTEXTUAL opener from a
 * small model racing the main answer, handed to the main model as "already said".
 *
 * Safety: the opener never states facts, prices, availability, yes/no or time words ("one
 * second") — it could contradict the answer — and is checked here before use (validOpener).
 * Anything doubtful → null, and the call falls back to the canned openers (voice/fillers.ts).
 */
import { createOpenAI } from "../../lib/openaiClient";

export interface PhoneOpenerInput {
  openaiApiKey: string;
  businessAccountId: string;
  transcript: string;
  lastAssistantText?: string | null;
  language: "en" | "hi";
  gender: "female" | "male" | null;
  /** First words of this call's recent openers/fillers — not to be repeated. */
  avoidFirstWords?: string[];
  /** The previous opener of this call — the next one takes a different shape. */
  previousOpener?: string | null;
  timeoutMs?: number;
}

const EXAMPLES: Record<"en" | "hi_roman" | "hi_deva", string[]> = {
  en: [
    `Caller: "I want health insurance for my parents." → Okay, health cover for your parents,`,
    `Caller: "What kind of insurance do you have?" → Right, so on the insurance side,`,
    `Caller: "Roughly how much would the premium be?" → Sure, on the premium,`,
    `Caller: "Hyundai i20, 2019 model." → Okay, a 2019 i20,`,
    `Caller: "My claim got rejected last month." → Oh, I'm sorry, a rejected claim…`,
  ],
  hi_roman: [
    `Caller: "Mere parents ke liye health insurance chahiye, dono 60 ke upar hain." → Achha, parents dono sixty plus hain,`,
    `Caller: "Family floater ka premium kitna hoga?" → Ji, family floater ke premium ki baat karein toh,`,
    `Caller: "Aapke paas koi accha health plan hai kya?" → Ji, health plans ki baat karein toh,`,
    `Caller: "Mera claim reject ho gaya, bahut pareshaan hoon." → Arre, sorry ji, claim reject ho gaya…`,
  ],
  hi_deva: [
    `Caller: "मोटर इंश्योरेंस के बारे में बताइए।" → जी, motor insurance की बात करें तो,`,
    `Caller: "उसमें कवरेज क्या-क्या मिलता है?" → हाँ, coverage की बात करें तो,`,
    `Caller: "आपके पास कौन-कौन से इंश्योरेंस हैं?" → जी, insurance में तो,`,
    `Caller: "मेरा क्लेम रिजेक्ट हो गया, बहुत परेशान हूँ।" → अरे, sorry जी, claim reject हो गया…`,
  ],
};

function systemPrompt(input: PhoneOpenerInput): string {
  const gender = input.gender === "male" ? "male" : input.gender === "female" ? "female" : null;
  const avoid = (input.avoidFirstWords || []).filter(Boolean).slice(-4);
  const deva = /[ऀ-ॿ]/.test(input.transcript);
  const variant = input.language === "en" ? "en" : deva ? "hi_deva" : "hi_roman";
  const languageRule = variant === "en"
    ? "- This call is in ENGLISH: write in English only (no Hindi words)."
    : variant === "hi_deva"
      ? "- This call is in HINDI: write in Devanagari, keeping business words (insurance, plan, coverage, premium, claim) in English letters."
      : "- This call is in HINGLISH: write Roman Hinglish (Hindi in English letters), keeping business words in English.";
  return [
    `You are a warm ${gender ? `${gender} ` : ""}phone agent for an Indian business. The caller just finished speaking.`,
    "Write ONLY the first few words you would say before your real answer: a natural reaction that shows you heard WHAT they said.",
    "- 3 to 9 words.",
    languageRule,
    "- Echo what they told you (their need, product, family, situation, problem). For a question, name its TOPIC (\"on the premium,\" / \"premium ki baat karein toh,\") — never repeat the question and never use a question word (what, how, kya, kitna…).",
    "- Never begin the answer itself (\"we have\", \"our\", \"hamare paas\", \"हमारे पास\") — the answer comes right after your words and would repeat them.",
    "- If they say they don't know / aren't sure / have no idea, reply with exactly: NONE (never echo their uncertainty back).",
    "- NO facts, prices, numbers they did not say, yes/no, 'available', 'possible', promises, and NO time words (second, minute, moment, wait, ek second).",
    "- Never: 'Great question', 'I understand your concern', 'Bilkul', 'Zaroor', 'Hmm', 'Umm', and never start with 'Oh' before a question.",
    "- End with a comma (or '…' after a complaint) — never a full stop, '!' or '?'. The answer continues right after your words.",
    gender ? `- If you use a first-person verb, use ${gender} Hindi forms (${gender === "female" ? "sakti/rahi/gayi hoon" : "sakta/raha/gaya hoon"}); prefer none.` : "- Prefer no first-person verb.",
    avoid.length ? `- Do not start with: ${avoid.map((w) => `"${w}"`).join(", ")}.` : "",
    input.previousOpener ? `- Your previous opener on this call was "${input.previousOpener}": use a different shape this time (not the same pattern like "… ki baat karein toh" twice in a row).` : "",
    "- Address the caller with the polite plural, never feminine or masculine singular: \"aap jaanna chahte hain\" / \"आप जानना चाहते हैं\" (you don't know their gender) — or better, don't describe them at all.",
    "- If the caller only said yes / okay / thanks / bye / hello, or asked you to repeat, reply with exactly: NONE",
    "Examples:",
    ...EXAMPLES[variant],
    "Reply with the words only.",
  ].filter(Boolean).join("\n");
}

/** A question word in the opener means it is repeating their question back — never helpful. */
const QUESTION_WORDS = /\b(what|which|how|why|when|where|who|kya|kaun|kaunsa|kitna|kitne|kitni|kaise|kab|kahan|kyun|kyon)\b|क्या|कौन|कितना|कितने|कितनी|कैसे|कब|कहाँ|क्यों/i;
const HINGLISH = /\b(hai|hain|ka|ki|ke|ko|se|mein|aap|aapko|aapka|chahiye|liye|toh|ji|achha|haan|nahi|bhi|aur|tha|thi)\b/gi;
const TIME_WORDS = /\b(second|seconds|sec|minute|minutes|moment|wait|hold on|ek second|ek minute|ruko|rukiye)\b|सेकंड|मिनट|रुकिए/i;
/** Starts the answer itself ("हमारे पास insurance options की बात करें तो," → "हमारे पास कई तरह के…", live call 2026-10-17). */
const ANSWER_START = /^(?:[^,\s]+,\s*)?(?:we have|we offer|we've got|our\b|hamare paas|humare paas|hamare pas|हमारे पास|हमारे)/i;
/** Repeats the caller's "don't know" back ("अरे, options का आईडिया नहीं है…"). */
const NEGATION = /\b(not|don'?t|no idea|nahi|nahin|pata nahi|idea nahi)\b|नहीं|आइडिया नहीं|आईडिया नहीं|पता नहीं/i;
const BANNED = /\b(great question|good question|i understand your concern|bilkul|zaroor|hmm+|umm+|available|possible|yes|no|haan ji bilkul|free|guarantee|definitely)\b|बिल्कुल|ज़रूर|जरूर/i;

/** The model's opener, cleaned — or null when it breaks a rule. */
export function validOpener(raw: string, input: Pick<PhoneOpenerInput, "transcript" | "gender" | "avoidFirstWords"> & { language?: "en" | "hi" }): string | null {
  let t = String(raw || "").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/\s+/g, " ").trim();
  if (!t || /^none\b/i.test(t)) return null;
  if (t.includes("?") || t.includes("\n")) return null;
  if (TIME_WORDS.test(t) || BANNED.test(t) || QUESTION_WORDS.test(t) || ANSWER_START.test(t) || NEGATION.test(t)) return null;
  // An English call gets an English opener (seen: "अच्छा, parents के लिए…" to an English caller).
  if (input.language === "en" && (/[ऀ-ॿ]/.test(t) || (t.match(HINGLISH) || []).length >= 2)) return null;
  // Numbers only if the caller said them ("a 2019 i20" after "2019 model").
  const digits = t.match(/\d+/g) || [];
  if (digits.some((d) => !String(input.transcript || "").includes(d))) return null;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12) return null;
  if (input.gender === "female" && /\b(sakta|raha|gaya|karta|dekhta) hoon\b|सकता हूँ|रहा हूँ|गया हूँ/i.test(t)) return null;
  // The caller's gender is unknown: "aap … chahti hain" / "आप … चाहती हैं" is a guess (seen on a self-call).
  if (/\b(chahti|sakti|rahi|karti|dekhti|gayi) (hain|hai|ho)\b|(चाहती|सकती|रही|करती|देखती|गई) (हैं|है|हो)/i.test(t)) return null;
  if (input.gender === "male" && /\b(sakti|rahi|gayi|karti|dekhti) hoon\b|सकती हूँ|रही हूँ|गई हूँ/i.test(t)) return null;
  const first = words[0].replace(/[,.…—–-]+$/, "").toLowerCase();
  if ((input.avoidFirstWords || []).slice(-1).some((w) => w && w.toLowerCase() === first)) return null; // never the same first word twice running
  // It must lead into the answer: a final full stop / danda / "!" becomes a comma.
  t = t.replace(/[.।!]+$/, "");
  if (!/[,…—–-]$/.test(t)) t += ",";
  return t;
}

export async function aiPhoneOpener(input: PhoneOpenerInput): Promise<string | null> {
  const text = String(input.transcript || "").trim().slice(0, 400);
  if (!text || !input.openaiApiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 1500);
  try {
    const openai = createOpenAI({ apiKey: input.openaiApiKey, businessAccountId: input.businessAccountId, feature: "voice_phone_opener", category: "voice_mode", maxRetries: 0 });
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 30,
      messages: [
        { role: "system", content: systemPrompt(input) },
        { role: "user", content: `${input.lastAssistantText ? `You just said: "${String(input.lastAssistantText).slice(-240)}"\n` : ""}Caller: "${text}"` },
      ],
    }, { signal: controller.signal });
    const raw = res.choices[0]?.message?.content || "";
    const ok = validOpener(raw, input);
    if (!ok && raw.trim() && !/^none\b/i.test(raw.trim())) console.log(`[PhoneOpener] rejected: "${raw.trim().slice(0, 80)}"`);
    return ok;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "Achha, parents dono…" → "achha" (to keep the call's openers from starting alike). */
export function firstWord(text: string): string {
  return String(text || "").trim().split(/\s+/)[0]?.replace(/[,.…—–!?-]+$/, "").toLowerCase() || "";
}

/**
 * The main model was told the opener was already said, but may still start by echoing it
 * ("Motor insurance की बात करें तो motor insurance में…", heard on self-calls). Drop the answer's
 * first clause, or its first words, when they only repeat the opener. Returns the speech unchanged
 * otherwise.
 */
const NON_WORD = new RegExp(String.raw`[^\p{L}\p{M}\p{N}\s]`, "gu");
const norm = (s: string) => s.toLowerCase().replace(NON_WORD, " ").split(/\s+/).filter(Boolean);

export function dropEchoedClause(speech: string, opener: string): string {
  const text = String(speech || "");
  const openerWords = norm(stripReaction(opener));
  if (openerWords.length < 2) return text;
  // 1) The answer starts with the opener's words themselves (comma or not).
  const words = text.split(/\s+/).filter(Boolean);
  const head = norm(words.slice(0, openerWords.length).join(" "));
  const same = head.filter((w, i) => w === openerWords[i]).length;
  // Only a complete phrase: it ends at a comma / dash or with "तो" / "toh" ("…की बात करें तो"),
  // never the subject of the answer's sentence ("Health cover for your parents is…").
  const lastEchoed = words[openerWords.length - 1] || "";
  const closesPhrase = /[,،—–-]$/.test(lastEchoed) || /^(तो|toh)$/i.test(lastEchoed.replace(NON_WORD, ""));
  if (closesPhrase && head.length === openerWords.length && same / openerWords.length >= 0.8) {
    const rest = words.slice(openerWords.length).join(" ").replace(/^[,،،—–\-\s]+/, "");
    if (rest.length >= 3) return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  // 2) Its first clause mostly repeats the opener's words.
  // (a short first SENTENCE too: "A 2019 Swift. We can help…" — but not the "." inside "2.5")
  const m = /^([^,:।.!?—]+)([,:—]\s*|[.।!]\s+)(.+)$/.exec(text);
  if (!m) return text;
  const clause = norm(m[1]).filter((w) => w.length > 1);
  if (!clause.length || clause.length > 8) return text;
  const said = new Set(openerWords);
  const overlap = clause.filter((w) => said.has(w)).length / clause.length;
  // …or it names everything the opener named, in a short clause ("Right, a 2019 Swift," →
  // "For your 2019 Swift, we offer…", self-call 2026-10-17).
  const content = openerWords.filter((w) => w.length > 1 && !OPENER_FILLER_WORDS.has(w));
  const namesAll = content.length >= 2 && clause.length <= content.length + 3 && content.every((w) => clause.includes(w));
  if (overlap < 0.6 && !namesAll) return text;
  const rest = m[3].trim();
  return rest.length >= 3 ? rest.charAt(0).toUpperCase() + rest.slice(1) : text;
}

/** Words of an opener that carry no topic of their own. */
const OPENER_FILLER_WORDS = new Set(["the", "an", "for", "your", "on", "so", "of", "ki", "ka", "ke", "की", "का", "के", "बात", "करें", "तो", "toh", "baat", "karein", "में", "mein", "side"]);

/** "Achha, motor insurance की बात करें तो," → "motor insurance की बात करें तो," */
function stripReaction(opener: string): string {
  return String(opener || "").replace(/^\s*(?:achha|accha|acha|ji|jee|haan|han|okay|ok|right|sure|alright|oh|arre|अच्छा|जी|हाँ|हां|ओके|अरे)(?=[\s,…]|$)[,…\s]*/i, "");
}
