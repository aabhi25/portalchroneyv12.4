/**
 * Text helpers for the reply-language policy:
 *   - translateFixedText: our fixed customer-facing messages (lead questions, OTP prompts,
 *     errors, journey steps, welcome) in the reply language — cached, never blocks long;
 *   - replyLanguageMatches / correctReplyLanguage: the safety check for non-streamed replies
 *     (WhatsApp, Instagram, Facebook, comments, campaigns): if the model slipped into another
 *     language, the reply is rewritten in the right one before it is sent.
 */
import { replyLanguage, replyLanguageName } from "@shared/replyLanguages";
import { storage } from "../../storage";
import { createOpenAI } from "../../lib/openaiClient";
import { describeLanguage } from "./languagePolicy";

const SCRIPT_RANGES: Record<string, RegExp> = {
  devanagari: /[ऀ-ॿ]/g,
  tamil: /[஀-௿]/g,
  telugu: /[ఀ-౿]/g,
  kannada: /[ಀ-೿]/g,
  bengali: /[ঀ-৿]/g,
  gujarati: /[઀-૿]/g,
  malayalam: /[ഀ-ൿ]/g,
  gurmukhi: /[਀-੿]/g,
  odia: /[଀-୿]/g,
  arabic: /[؀-ۿ]/g,
  cjk: /[぀-ヿ一-鿿]/g,
  hangul: /[가-힯]/g,
  thai: /[฀-๿]/g,
  cyrillic: /[Ѐ-ӿ]/g,
};
const LATIN = /[A-Za-zÀ-ɏ]/g;
const HINGLISH_WORDS = /\b(hai|hain|aap|aapka|aapki|aapke|kya|nahi|nahin|mein|main|hum|kar|karo|karein|sakte|sakti|sakta|hoga|hogi|liye|aur|bhi|toh|yeh|woh|kaise|kitna|kitne|chahiye|batao|bataiye|milega|milegi|wala|wali|tha|thi|ko|se|ka|ki|ke)\b/gi;

/** Strip what never "counts" as language: links, emails, numbers, markdown, emoji, product codes. */
function languageText(text: string): string {
  return String(text || "")
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/g, " ")
    .replace(/[`*_#>\[\]()|~-]+/g, " ")
    .replace(/[\d₹$€£%.,:;!?/\\+=]+/g, " ")
    .replace(new RegExp("\\p{Extended_Pictographic}", "gu"), " ");
}

/**
 * Does `text` look like it is written in `lang`? Script-based (reliable for Indian languages,
 * Arabic, CJK…). For Latin-script languages we only catch the clear failures: a different
 * script dominating, or English vs Hinglish. Short texts always pass.
 */
export function replyLanguageMatches(text: string, lang: string): boolean {
  const t = languageText(text);
  const letters = t.replace(/\s+/g, "");
  if (letters.length < 12) return true;
  const target = replyLanguage(lang);
  if (!target) return true;
  const count = (re: RegExp) => (t.match(re) || []).length;
  const latin = count(LATIN);
  if (target.script !== "latin") {
    const native = count(SCRIPT_RANGES[target.script]);
    // Brand/product names stay Latin, so a minority of Latin letters is fine.
    return native >= Math.max(6, 0.4 * (native + latin));
  }
  // Latin target: another script must not dominate.
  for (const [script, re] of Object.entries(SCRIPT_RANGES)) {
    const n = count(re);
    if (n > 0.3 * (n + latin) && n > 6) return false;
    void script;
  }
  const words = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  const hinglish = (t.match(HINGLISH_WORDS) || []).length;
  if (lang === "en") return !(words.length >= 6 && hinglish / words.length > 0.2);
  if (lang === "hinglish") return words.length < 6 || hinglish / words.length > 0.08;
  return true;
}

type Translator = (system: string, text: string) => Promise<string>;

async function defaultTranslator(businessAccountId: string): Promise<Translator | null> {
  const apiKey = await storage.getBusinessAccountOpenAIKey(businessAccountId).catch(() => null);
  if (!apiKey) return null;
  const openai = createOpenAI({ businessAccountId, apiKey });
  return async (system, text) => {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: text }],
      temperature: 0.2,
      max_tokens: Math.min(1200, 80 + Math.ceil(text.length * 1.2)),
    }, { timeout: 8000 });
    return completion.choices[0]?.message?.content?.trim() || "";
  };
}

const translationCache = new Map<string, string>();
const CACHE_MAX = 2000;

/**
 * One of OUR fixed messages, in the reply language (English source). Cached per business +
 * language + text; on any failure the original text is returned (never blocks a reply long).
 */
export async function translateFixedText(
  businessAccountId: string,
  text: string,
  lang: string | null | undefined,
  opts: { translator?: Translator; sourceLanguage?: string } = {},
): Promise<string> {
  const source = opts.sourceLanguage || "en";
  if (!text || !lang || lang === source || lang === "auto") return text;
  if (!replyLanguage(lang)) return text;
  const key = `${businessAccountId}|${lang}|${text}`;
  const hit = translationCache.get(key);
  if (hit) return hit;
  try {
    const translate = opts.translator ?? (await defaultTranslator(businessAccountId));
    if (!translate) return text;
    const out = await translate(
      `Translate the customer-facing message below into ${describeLanguage(lang)}. Keep the meaning, tone and length. ` +
      `Keep placeholders like {name}, numbers, links, emails, product and brand names exactly as they are. Return ONLY the translation.`,
      text,
    );
    if (!out) return text;
    if (translationCache.size >= CACHE_MAX) translationCache.delete(translationCache.keys().next().value as string);
    translationCache.set(key, out);
    return out;
  } catch (error) {
    console.warn(`[Language] Fixed-text translation to ${lang} failed (sending original):`, (error as Error)?.message);
    return text;
  }
}

/**
 * Safety check for a finished, NOT-yet-sent reply: if it isn't in `lang`, rewrite it in `lang`
 * (keeping Markdown, links, prices and product names). Returns the text to send.
 */
export async function correctReplyLanguage(
  businessAccountId: string,
  text: string,
  lang: string | null | undefined,
  opts: { translator?: Translator } = {},
): Promise<{ text: string; corrected: boolean }> {
  if (!text || !lang || replyLanguageMatches(text, lang)) return { text, corrected: false };
  try {
    const translate = opts.translator ?? (await defaultTranslator(businessAccountId));
    if (!translate) return { text, corrected: false };
    const out = await translate(
      `Rewrite the assistant reply below entirely in ${describeLanguage(lang)}. Keep its meaning, Markdown formatting, line breaks, emojis, ` +
      `links, prices, numbers, product and brand names exactly. Return ONLY the rewritten reply.`,
      text,
    );
    if (!out) return { text, corrected: false };
    console.log(`[Language] Reply was not in ${replyLanguageName(lang)} — rewritten before sending`);
    return { text: out, corrected: true };
  } catch (error) {
    console.warn("[Language] Reply language correction failed (sending as is):", (error as Error)?.message);
    return { text, corrected: false };
  }
}

/** Test helper. */
export function resetLanguageTextCacheForTesting(): void {
  translationCache.clear();
}
