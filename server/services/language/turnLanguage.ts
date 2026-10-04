/**
 * Which language is the customer writing / speaking in — decided the way enterprise support
 * bots do it (Intercom Fin, Zendesk AI agents, Haptik; researched 2026-10-04):
 *
 *   1. EVIDENCE, not keywords. A message counts as Hinglish only with real Hindi sentence words
 *      ("kya", "hai", "chahiye", "mujhe"…). Number / money / kinship words that are normal in
 *      Indian English ("5 lakh", "crore", "rupaye", "bhai") are weak evidence and never switch the
 *      language on their own. ("Do you have watches under 5 lakh?" is English.)
 *   2. CONFIDENCE. A message is either confidently one language, or unclear (short, mixed, numbers).
 *   3. STICKY per conversation. Only a confident message sets / switches the conversation's
 *      language; an unclear one keeps it ("ok", "5 lakh?", "yes please").
 *   4. BROWSER LANGUAGE as the starting point when the first messages are unclear (website chat
 *      and website voice / video calls), then the old behaviour.
 *
 * Pure functions + one in-memory map; no AI calls here.
 */
import { isReplyLanguage } from "@shared/replyLanguages";

// ── English / other Latin-script signals (moved here from chatContext/languageSession) ──────────
export const ENGLISH_WORDS = new Set([
  "the", "is", "are", "was", "were", "what", "how", "when", "where", "why", "which", "who", "do", "does", "did", "can",
  "could", "would", "should", "will", "you", "your", "my", "me", "we", "our", "i", "a", "an", "and", "or", "of", "to",
  "in", "on", "for", "with", "about", "have", "has", "there", "this", "that", "it", "please", "any", "if", "from", "at",
  "be", "get", "much", "many", "tell", "want", "need", "price", "cost", "available", "offer", "per", "am", "not", "no", "yes",
]);
const FOREIGN_WORDS = new Set([
  // es
  "el", "los", "las", "que", "por", "para", "con", "una", "uno", "es", "como", "cuál", "cual", "cuánto", "cuanto", "hola",
  "gracias", "tienen", "quiero", "precio", "dónde", "donde", "está", "esta", "pero", "muy", "también",
  // fr
  "le", "les", "des", "une", "et", "est", "avec", "pour", "vous", "nous", "je", "bonjour", "merci", "combien", "quel",
  "quelle", "où", "pas", "sont", "mais", "très",
  // de
  "der", "das", "und", "ist", "nicht", "ich", "sie", "wir", "mit", "für", "wie", "was", "wo", "haben", "bitte",
  "danke", "kosten", "ein", "eine",
  // pt / it
  "você", "voce", "não", "nao", "obrigado", "olá", "ola", "quanto", "onde", "uma", "il", "che", "sono",
  "grazie", "ciao", "della", "nel",
  // tr / id / ms
  "nasıl", "bir", "için", "merhaba", "apa", "yang", "berapa", "saya", "anda", "terima", "kasih",
]);
// Letters that essentially never appear in English text.
const FOREIGN_LATIN = /[àâãäåæçèêëìîïñòôõöøùûüÿßœğışąćęłńśźżčřšžőű¿¡]/i;

function latinWords(message: string): string[] {
  return message.toLowerCase().normalize("NFKC").split(/[^a-zÀ-ɏ]+/).filter(Boolean);
}

export function hasForeignLatinSignal(message: string): boolean {
  if (FOREIGN_LATIN.test(message)) return true;
  // 'was' and 'die' collide with English — only count a foreign word when it is not also
  // an English function word.
  return latinWords(message).some((w) => FOREIGN_WORDS.has(w) && !ENGLISH_WORDS.has(w));
}

export function looksConfidentlyEnglish(message: string): boolean {
  if (!/^[\x00-\x7F\s]*$/.test(message)) return false; // any non-ASCII → not sure
  if (hasForeignLatinSignal(message)) return false;
  const w = latinWords(message);
  if (!w.length) return false;
  const en = w.filter((x) => ENGLISH_WORDS.has(x)).length;
  return en >= 2 || (en >= 1 && w.length <= 6);
}

// ── Hindi written in English letters ─────────────────────────────────────────────────────────
// Strong: Hindi grammar / sentence words that don't exist in English. Deliberately excludes words
// that are also English (main, do, sun, the, hi…).
const HINDI_STRONG = new Set([
  "kya", "hai", "hain", "aap", "nahi", "nahin", "bhi", "aur", "toh", "bahut", "theek", "accha", "achha", "aaj",
  "mein", "mujhe", "kar", "karo", "hoga", "chahiye", "batao", "dekho", "lekin", "sirf", "kuch", "yeh", "woh", "wahi",
  "yahi", "bohot", "zyada", "thoda", "baat", "wala", "wali", "wale", "kyun", "kyu", "hum", "tum", "kaise", "kab",
  "kahan", "abhi", "phir", "iska", "uska", "unka", "humara", "tumhara", "aapka", "aapki", "aapke", "mera", "meri",
  "mere", "tera", "teri", "tere", "uski", "uske", "jao", "aao", "lelo", "dedo", "milega", "milegi", "chahta", "chahti",
  "sakta", "sakti", "raha", "rahi", "rahe", "tha", "thi", "hona", "karna", "lena", "dena", "jana", "aana", "rehna",
  "sochna", "samajhna", "dikhao", "lagta", "lagti", "kitna", "kitni", "kitne", "kaisa", "kaisi", "koi", "koyi",
  "poora", "poori", "pura", "puri", "bilkul", "zaroor", "zaruri", "jaise", "tarah", "tarike", "milne", "milta",
  "milti", "liye", "baad", "pehle", "saath", "bina", "tumhe", "unhe", "inhe", "isko", "usko", "inko", "unko", "humko",
  "tumko", "aapko", "tujhe", "bolo", "suno", "samajh", "samjho", "samjha", "batana", "dikhana", "chahte", "hoon",
  "hu", "ka", "ki", "ke", "ko", "se", "ye", "wo", "nai", "haan", "bataiye", "batayein", "dijiye", "kijiye", "karein",
  "karenge", "karunga", "karungi", "sakte", "hogi", "honge",
]);
// Weak: numbers, money, kinship and everyday nouns that Indians use in English sentences too.
const HINDI_WEAK = new Set([
  "lakh", "lakhs", "lac", "lacs", "crore", "crores", "cr", "hazar", "hazaar", "paisa", "paise", "rupay", "rupaye",
  "rupaiya", "ek", "teen", "paanch", "bhai", "yaar", "dost", "ji", "ghar", "makaan", "cheez", "naya", "nayi", "naye",
  "purana", "purani", "sab", "sabhi", "waqt", "kaam", "tak", "bol", "dekh", "paise",
]);

export interface LatinHindiCounts { words: number; strong: number; weak: number; english: number }

export function latinHindiCounts(text: string): LatinHindiCounts {
  const w = latinWords(text);
  let strong = 0, weak = 0, english = 0;
  for (const x of w) {
    if (HINDI_STRONG.has(x)) strong++;
    else if (HINDI_WEAK.has(x)) weak++;
    else if (ENGLISH_WORDS.has(x)) english++;
  }
  return { words: w.length, strong, weak, english };
}

/** Confidently Hinglish: real Hindi sentence words, not just "5 lakh" or "bhai". */
export function isConfidentlyHinglish(c: LatinHindiCounts): boolean {
  if (c.strong >= 2) return true;
  if (c.strong >= 1 && c.strong >= c.english && c.words <= 4) return true; // "kya price", "batao please"
  if (c.strong >= 1 && c.weak >= 1 && c.strong >= c.english) return true; // "5 lakh wala hai"
  return false;
}

// ── One message ──────────────────────────────────────────────────────────────────────────────
const SCRIPTS: Array<[RegExp, string]> = [
  [/[ऀ-ॿ]/, "hi"], [/[஀-௿]/, "ta"], [/[ఀ-౿]/, "te"], [/[ಀ-೿]/, "kn"],
  [/[ঀ-৿]/, "bn"], [/[઀-૿]/, "gu"], [/[ഀ-ൿ]/, "ml"], [/[਀-੿]/, "pa"],
  [/[؀-ۿ]/, "ar"], [/[가-힯]/, "ko"], [/[぀-ゟ゠-ヿ]/, "ja"], [/[一-鿿]/, "zh"],
];

export interface TurnEvidence {
  /** Best guess (null = no idea). */
  language: string | null;
  /** True only when the message clearly is in `language`. */
  confident: boolean;
  /** Latin words in the message (for "short message" decisions). */
  words: number;
}

export function turnLanguageEvidence(text: string, opts: { arabicIsHindi?: boolean } = {}): TurnEvidence {
  const t = String(text || "").trim();
  if (!t) return { language: null, confident: false, words: 0 };
  // A non-Latin script is unambiguous (a voice transcript of Hindi may come out in Urdu script).
  for (const [re, lang] of SCRIPTS) {
    if (re.test(t)) return { language: lang === "ar" && opts.arabicIsHindi ? "hi" : lang, confident: true, words: latinWords(t).length };
  }
  const c = latinHindiCounts(t);
  if (hasForeignLatinSignal(t)) return { language: null, confident: false, words: c.words }; // Spanish, French… → the AI decides
  if (isConfidentlyHinglish(c)) return { language: "hinglish", confident: true, words: c.words };
  const letters = t.replace(/[^A-Za-z]/g, "").length;
  if (c.strong === 0 && letters >= 10 && looksConfidentlyEnglish(t)) return { language: "en", confident: true, words: c.words };
  return { language: c.strong > 0 ? "hinglish" : c.english > 0 || c.weak > 0 ? "en" : null, confident: false, words: c.words };
}

// ── The conversation's language (sticky) ─────────────────────────────────────────────────────
const TTL_MS = 3 * 60 * 60 * 1000;
const MAX_ENTRIES = 20_000;
const memory = new Map<string, { lang: string; at: number }>();

export function rememberConversationLanguage(key: string | null | undefined, lang: string | null | undefined): void {
  if (!key || !lang || lang === "auto" || lang === "other") return;
  if (memory.size >= MAX_ENTRIES && !memory.has(key)) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  memory.delete(key);
  memory.set(key, { lang, at: Date.now() });
}

export function rememberedConversationLanguage(key: string | null | undefined): string | null {
  if (!key) return null;
  const hit = memory.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { memory.delete(key); return null; }
  return hit.lang;
}

/** "hi-IN" → "hi", "en-GB" → "en", "fr" → "fr"; unknown / unsupported → null. */
export function languageFromBrowser(tag: string | null | undefined): string | null {
  const primary = String(tag || "").trim().toLowerCase().split(/[-_]/)[0];
  if (!/^[a-z]{2,3}$/.test(primary)) return null;
  return isReplyLanguage(primary) ? primary : null;
}

export type StickySource = "confident" | "remembered" | "browser" | "guess";

/**
 * The language to treat this message as: a confident message sets (or switches) the
 * conversation's language; an unclear one keeps the remembered language, else the browser
 * language, else the best guess (null when there is none — the AI then follows the customer).
 */
export function stickyTurnLanguage(
  key: string | null | undefined,
  text: string,
  opts: { browserLanguage?: string | null; arabicIsHindi?: boolean } = {},
): { language: string | null; source: StickySource; evidence: TurnEvidence } {
  const evidence = turnLanguageEvidence(text, { arabicIsHindi: opts.arabicIsHindi });
  if (evidence.confident && evidence.language) {
    rememberConversationLanguage(key, evidence.language);
    return { language: evidence.language, source: "confident", evidence };
  }
  const remembered = rememberedConversationLanguage(key);
  if (remembered) return { language: remembered, source: "remembered", evidence };
  const browser = languageFromBrowser(opts.browserLanguage);
  if (browser && evidence.words <= 4) return { language: browser, source: "browser", evidence };
  return { language: evidence.language, source: "guess", evidence };
}

/** Tests only. */
export function clearConversationLanguages(): void {
  memory.clear();
}
