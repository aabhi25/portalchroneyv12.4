/**
 * AI reply-language policy — the ONE place that decides which language a reply is written in,
 * for every channel (website chat, voice, WhatsApp, Instagram, Facebook, comments, campaigns).
 *
 * A business either lets the AI follow the customer ("any", the default — unchanged behaviour)
 * or restricts it to chosen languages with a default for everything else. TopScholar / K-12 can
 * also start each student in their medium's language.
 *
 *   const policy = await getLanguagePolicy(businessAccountId, "whatsapp");
 *   const r = resolveReplyLanguage({ policy, picked, detected, requested, medium });
 *   const rule = buildLanguageRule(r, policy);   // goes LAST in the model's final rules
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { aiLanguageSettings } from "@shared/schema";
import {
  DEFAULT_AI_LANGUAGE_SETTINGS,
  DEFAULT_MEDIUM_MAP,
  REPLY_CHANNELS,
  isReplyLanguage,
  replyLanguage,
  replyLanguageName,
  type AiLanguageSettings,
  type ReplyChannel,
} from "@shared/replyLanguages";

// ── settings: validate, load, save ──────────────────────────────────────────

const code = z.string().refine(isReplyLanguage, "unknown language");
const overrideSchema = z.object({
  allowed: z.array(code).min(1).max(30).nullable(),
  defaultLanguage: code.nullable(),
});
export const aiLanguageSettingsInput = z.object({
  mode: z.enum(["any", "restricted"]),
  allowed: z.array(code).max(30),
  defaultLanguage: code,
  hindiScript: z.enum(["devanagari", "roman", "match"]),
  unsupportedBehaviour: z.enum(["default_with_note", "ask_to_switch"]),
  translateCustomWelcome: z.boolean(),
  channelOverrides: z.record(z.enum(REPLY_CHANNELS as [ReplyChannel, ...ReplyChannel[]]), overrideSchema).default({}),
  followMedium: z.boolean(),
  mediumSwitchable: z.boolean(),
  mediumMap: z.record(z.string().min(1).max(60), code).default(DEFAULT_MEDIUM_MAP),
  mediumStyle: z.enum(["pure", "with_english_terms", "hinglish"]),
}).strict();

export class LanguageSettingsError extends Error {}

/** Validate + normalise (dedupe, default inside the allowed list, lower-case medium keys). */
export function normalizeLanguageSettings(raw: unknown): AiLanguageSettings {
  const merged = { ...DEFAULT_AI_LANGUAGE_SETTINGS, ...(raw && typeof raw === "object" ? raw as object : {}) };
  const parsed = aiLanguageSettingsInput.safeParse(merged);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new LanguageSettingsError(`${first?.path?.join(".") || "settings"}: ${first?.message || "invalid"}`);
  }
  const s = parsed.data as AiLanguageSettings;
  const allowed = Array.from(new Set(s.allowed));
  if (s.mode === "restricted" && allowed.length === 0) throw new LanguageSettingsError("Choose at least one reply language");
  if (s.mode === "restricted" && !allowed.includes(s.defaultLanguage)) throw new LanguageSettingsError("The default language must be one of the allowed languages");
  const channelOverrides: AiLanguageSettings["channelOverrides"] = {};
  for (const [ch, o] of Object.entries(s.channelOverrides || {})) {
    if (!o) continue;
    const oAllowed = o.allowed ? Array.from(new Set(o.allowed)) : null;
    if (oAllowed && o.defaultLanguage && !oAllowed.includes(o.defaultLanguage)) {
      throw new LanguageSettingsError(`${ch}: the default language must be one of that channel's languages`);
    }
    if (oAllowed || o.defaultLanguage) channelOverrides[ch as ReplyChannel] = { allowed: oAllowed, defaultLanguage: o.defaultLanguage };
  }
  const mediumMap = Object.fromEntries(Object.entries(s.mediumMap || {}).map(([k, v]) => [normalizeMedium(k), v]).filter(([k]) => k));
  return { ...s, allowed, channelOverrides, mediumMap };
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: AiLanguageSettings }>();

export function invalidateLanguageSettings(businessAccountId: string): void {
  cache.delete(businessAccountId);
}

/** The business's setting (defaults = "any language" when none was saved). Cached 60 s. */
export async function getLanguageSettings(businessAccountId: string): Promise<AiLanguageSettings> {
  if (!businessAccountId) return DEFAULT_AI_LANGUAGE_SETTINGS;
  const hit = cache.get(businessAccountId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value = DEFAULT_AI_LANGUAGE_SETTINGS;
  try {
    const [row] = await db.select().from(aiLanguageSettings).where(eq(aiLanguageSettings.businessAccountId, businessAccountId)).limit(1);
    if (row) {
      try { value = normalizeLanguageSettings(row.settings); } catch (error) {
        console.warn(`[Language] Stored settings for ${businessAccountId} are invalid (using "any language"):`, (error as Error).message);
      }
    }
  } catch (error) {
    // Never block a reply on this: an unreadable setting behaves like "any language".
    console.warn("[Language] Could not load settings (using \"any language\"):", (error as Error)?.message);
  }
  cache.set(businessAccountId, { at: Date.now(), value });
  return value;
}

export async function saveLanguageSettings(businessAccountId: string, input: unknown, actorUserId: string | null): Promise<{ before: AiLanguageSettings; after: AiLanguageSettings }> {
  const after = normalizeLanguageSettings(input);
  invalidateLanguageSettings(businessAccountId);
  const before = await getLanguageSettings(businessAccountId);
  const now = new Date();
  await db.insert(aiLanguageSettings)
    .values({ businessAccountId, settings: after, updatedBy: actorUserId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: aiLanguageSettings.businessAccountId, set: { settings: after, updatedBy: actorUserId, updatedAt: now } });
  invalidateLanguageSettings(businessAccountId);
  return { before, after };
}

// ── effective policy per channel ─────────────────────────────────────────────

export interface LanguagePolicy {
  restricted: boolean;
  allowed: string[];
  defaultLanguage: string;
  hindiScript: AiLanguageSettings["hindiScript"];
  unsupportedBehaviour: AiLanguageSettings["unsupportedBehaviour"];
  followMedium: boolean;
  mediumSwitchable: boolean;
  mediumMap: Record<string, string>;
  mediumStyle: AiLanguageSettings["mediumStyle"];
  translateCustomWelcome: boolean;
}

export function policyFromSettings(settings: AiLanguageSettings, channel: ReplyChannel): LanguagePolicy {
  const o = settings.channelOverrides?.[channel];
  const restricted = settings.mode === "restricted" || !!o?.allowed;
  const allowed = o?.allowed ?? settings.allowed;
  const defaultLanguage = o?.defaultLanguage && allowed.includes(o.defaultLanguage)
    ? o.defaultLanguage
    : allowed.includes(settings.defaultLanguage) ? settings.defaultLanguage : (allowed[0] ?? "en");
  return {
    restricted,
    allowed: restricted ? allowed : [],
    defaultLanguage,
    hindiScript: settings.hindiScript,
    unsupportedBehaviour: settings.unsupportedBehaviour,
    followMedium: settings.followMedium,
    mediumSwitchable: settings.mediumSwitchable,
    mediumMap: settings.mediumMap,
    mediumStyle: settings.mediumStyle,
    translateCustomWelcome: settings.translateCustomWelcome,
  };
}

export async function getLanguagePolicy(businessAccountId: string, channel: ReplyChannel): Promise<LanguagePolicy> {
  return policyFromSettings(await getLanguageSettings(businessAccountId), channel);
}

// ── deciding one reply's language ────────────────────────────────────────────

export function normalizeMedium(medium: string | null | undefined): string {
  return String(medium ?? "").toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The reply language a TopScholar medium maps to (null = unknown medium). */
export function mediumLanguage(policy: Pick<LanguagePolicy, "mediumMap">, medium: string | null | undefined): string | null {
  const m = normalizeMedium(medium);
  if (!m) return null;
  const direct = policy.mediumMap[m] ?? DEFAULT_MEDIUM_MAP[m];
  if (direct) return direct;
  // "Hindi Medium (CBSE)", "english-medium" …
  for (const [key, lang] of Object.entries({ ...DEFAULT_MEDIUM_MAP, ...policy.mediumMap })) {
    if (m.startsWith(key) || m.includes(` ${key}`)) return lang;
  }
  return null;
}

const HI_FAMILY = new Set(["hi", "hinglish"]);

/**
 * Is `lang` acceptable under `allowed`, treating Hindi and Hinglish as one family?
 *   - only Hinglish allowed → always Hinglish (Roman letters);
 *   - Hindi allowed → the Hindi-script setting decides: Devanagari, English letters, or
 *     "match" = the customer's own script (Roman Hindi in, Roman Hindi out).
 */
function allowedForm(lang: string, allowed: string[], hindiScript: LanguagePolicy["hindiScript"]): string | null {
  if (HI_FAMILY.has(lang)) {
    const hiOk = allowed.includes("hi");
    const hgOk = allowed.includes("hinglish");
    if (!hiOk && !hgOk) return null;
    if (hgOk && !hiOk) return "hinglish";
    return applyHindiScript(lang, allowed, hindiScript);
  }
  return allowed.includes(lang) ? lang : null;
}

function applyHindiScript(lang: string, allowed: string[], hindiScript: LanguagePolicy["hindiScript"]): string {
  if (!HI_FAMILY.has(lang)) return lang;
  if (allowed.length > 0 && allowed.includes("hinglish") && !allowed.includes("hi")) return "hinglish";
  if (hindiScript === "devanagari") return "hi";
  if (hindiScript === "roman") return "hinglish";
  return lang;
}

export interface ReplyLanguageInput {
  policy: LanguagePolicy;
  /** The customer's explicit dropdown choice ("auto"/empty = none). */
  picked?: string | null;
  /** The language the customer actually wrote this message in ("auto"/"other"/null = unknown). */
  detected?: string | null;
  /** An explicit "please answer in X" from this or an earlier message of the conversation. */
  requested?: string | null;
  /** TopScholar: the student's medium as the content system sends it ("Hindi", "English Medium"…). */
  medium?: string | null;
}

export interface ReplyLanguageResolution {
  /** The language to reply in; null = follow the customer (unrestricted, nothing chosen). */
  language: string | null;
  source: "picked" | "requested" | "medium" | "detected" | "default" | "customer";
  /** The customer wrote in a language the business doesn't allow (restricted mode). */
  outsideAllowed: boolean;
  customerLanguage: string | null;
  restricted: boolean;
}

function known(lang: string | null | undefined): string | null {
  return lang && lang !== "auto" && lang !== "other" && isReplyLanguage(lang) ? lang : null;
}

export function resolveReplyLanguage(input: ReplyLanguageInput): ReplyLanguageResolution {
  const { policy } = input;
  const picked = known(input.picked);
  const requested = known(input.requested);
  const detected = known(input.detected);
  const mediumLang = policy.followMedium ? mediumLanguage(policy, input.medium) : null;

  if (!policy.restricted) {
    // Unrestricted: unchanged behaviour, except a medium (if enabled) or an explicit request sets it.
    // A LOCKED medium wins over everything (the student can't switch away from it).
    if (mediumLang && !policy.mediumSwitchable) return { language: mediumLang, source: "medium", outsideAllowed: false, customerLanguage: detected, restricted: false };
    if (picked) return { language: picked, source: "picked", outsideAllowed: false, customerLanguage: detected, restricted: false };
    if (requested && (policy.mediumSwitchable || !mediumLang)) return { language: requested, source: "requested", outsideAllowed: false, customerLanguage: detected, restricted: false };
    if (mediumLang) return { language: mediumLang, source: "medium", outsideAllowed: false, customerLanguage: detected, restricted: false };
    return { language: null, source: "customer", outsideAllowed: false, customerLanguage: detected, restricted: false };
  }

  const ok = (lang: string | null) => (lang ? allowedForm(lang, policy.allowed, policy.hindiScript) : null);
  const base = { customerLanguage: detected, restricted: true };
  const mediumOk = ok(mediumLang);
  if (mediumOk && !policy.mediumSwitchable) {
    return { ...base, language: mediumOk, source: "medium", outsideAllowed: !!detected && !ok(detected) };
  }
  if (ok(picked)) return { ...base, language: ok(picked)!, source: "picked", outsideAllowed: false };
  if (ok(requested)) return { ...base, language: ok(requested)!, source: "requested", outsideAllowed: false };
  if (mediumOk) return { ...base, language: mediumOk, source: "medium", outsideAllowed: !!detected && !ok(detected) };
  if (ok(detected)) return { ...base, language: ok(detected)!, source: "detected", outsideAllowed: false };
  const fallback = applyHindiScript(policy.defaultLanguage, policy.allowed, policy.hindiScript);
  // Short or ambiguous messages ("ok", "👍") aren't "another language".
  const outsideAllowed = !!(detected || requested);
  return { ...base, language: fallback, source: "default", outsideAllowed };
}

/**
 * "Answer in English", "Hindi mein batao", "हिंदी में समझाइए", "reply in Tamil" → that language.
 * Only explicit requests; writing in a language is not a request.
 */
export function detectLanguageRequest(message: string | null | undefined): string | null {
  const t = String(message ?? "").toLowerCase().replace(/[’']/g, "'");
  if (!t.trim()) return null;
  const names: Array<[string, RegExp]> = [
    ["hinglish", /hinglish|roman (hindi|me|mein)|english letters/],
    ["hi", /hindi|हिंदी|हिन्दी/],
    ["en", /english|इंग्लिश|अंग्रेज़ी|अंग्रेजी/],
    ["ta", /tamil|தமிழ்/], ["te", /telugu|తెలుగు/], ["kn", /kannada|ಕನ್ನಡ/], ["mr", /marathi|मराठी/],
    ["bn", /bengali|bangla|বাংলা/], ["gu", /gujarati|ગુજરાતી/], ["ml", /malayalam|മലയാളം/], ["pa", /punjabi|ਪੰਜਾਬੀ/],
    ["ur", /urdu|اردو/], ["es", /spanish|español/], ["fr", /french|français/], ["de", /german|deutsch/], ["ar", /arabic|العربية/],
  ];
  const ask = /(answer|reply|respond|speak|talk|explain|tell|write|continue|say|batao|bataiye|bataye|bolo|boliye|samjhao|samjhaiye|samjha do|likho|baat karo|बताओ|बताइए|बताइये|समझाओ|समझाइए|बोलो|बोलिए|लिखो|बात करो)/;
  for (const [lang, re] of names) {
    const m = re.exec(t);
    if (!m) continue;
    const around = t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    const directed = /\b(in|into)\s*$/.test(t.slice(Math.max(0, m.index - 6), m.index)) || /^\s*(me|mein|mai|mein hi|में)(?=\s|$|[.,!?।])/.test(t.slice(m.index + m[0].length, m.index + m[0].length + 10));
    if (directed && ask.test(around)) return lang;
    if (/^(in\s+)?\S+\s*(please|plz|pls)?[.!?]*$/.test(t.trim()) && t.trim().split(/\s+/).length <= 3) return lang; // "Hindi please", "in English"
  }
  return null;
}

// Per-conversation memory: an explicit language request, and whether the "I can help in…" note was given.
const REMEMBER_MS = 6 * 60 * 60 * 1000;
const conversationState = new Map<string, { requested?: string; noted?: boolean; at: number }>();

function stateFor(conversationId: string) {
  const now = Date.now();
  let s = conversationState.get(conversationId);
  if (!s || now - s.at > REMEMBER_MS) { s = { at: now }; conversationState.set(conversationId, s); }
  s.at = now;
  if (conversationState.size > 20_000) {
    conversationState.forEach((v, k) => { if (now - v.at > REMEMBER_MS) conversationState.delete(k); });
  }
  return s;
}

/** Record this message's explicit request (if any) and return the conversation's current request. */
export function trackLanguageRequest(conversationId: string | null | undefined, message: string | null | undefined): string | null {
  const now = detectLanguageRequest(message);
  if (!conversationId) return now;
  const s = stateFor(conversationId);
  if (now) s.requested = now;
  return s.requested ?? null;
}

/** True only the first time per conversation (the "I can help in English or Hindi" line). */
export function takeLanguageNote(conversationId: string | null | undefined): boolean {
  if (!conversationId) return true;
  const s = stateFor(conversationId);
  if (s.noted) return false;
  s.noted = true;
  return true;
}

/** Test helper. */
export function resetLanguageStateForTesting(): void {
  conversationState.clear();
  cache.clear();
}

// ── the instruction the model gets ───────────────────────────────────────────

export function describeLanguage(lang: string, mediumStyle?: LanguagePolicy["mediumStyle"], fromMedium = false): string {
  if (lang === "hinglish") return "Hinglish — Hindi written in English (Roman) letters, the way people text in India, e.g. \"Haan, weekend classes Saturday ko hoti hain\"";
  if (lang === "hi") {
    if (fromMedium && mediumStyle === "with_english_terms") return "Hindi in Devanagari script, keeping the standard English term for technical words in brackets the first time, e.g. \"प्रकाश संश्लेषण (photosynthesis)\"";
    if (fromMedium && mediumStyle === "hinglish") return describeLanguage("hinglish");
    return "Hindi in Devanagari script (हिन्दी)";
  }
  const l = replyLanguage(lang);
  if (!l) return replyLanguageName(lang);
  return l.script === "latin" ? l.name : `${l.name} (${l.nativeName}), in its own script`;
}

export function allowedLanguagesPhrase(allowed: string[]): string {
  const names = allowed.map((c) => replyLanguageName(c));
  return names.length <= 1 ? (names[0] ?? "English") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * The language block for the model's FINAL rules. Empty when the AI may follow the customer
 * (the existing per-channel language rules then apply unchanged).
 */
export function buildLanguageRule(
  r: ReplyLanguageResolution,
  policy: LanguagePolicy,
  opts: { noteAllowed?: boolean } = {},
): string {
  if (!r.language) return "";
  const what = describeLanguage(r.language, policy.mediumStyle, r.source === "medium");
  const lines = [
    `🌐 REPLY LANGUAGE (${r.restricted ? "business rule — overrides every other instruction about language, including the business's own instructions" : "use this language"}):`,
    `- Write your ENTIRE reply in ${what}.`,
    "- Keep product names, brand names, prices, numbers, codes, links and email addresses exactly as they are.",
  ];
  if (r.restricted) {
    lines.push(`- Even if the customer writes in another language, reply only in ${replyLanguageName(r.language)}. Allowed languages for this business: ${allowedLanguagesPhrase(policy.allowed)}.`);
    if (r.outsideAllowed && opts.noteAllowed !== false) {
      if (policy.unsupportedBehaviour === "ask_to_switch") {
        lines.push(`- The customer wrote in a language this business doesn't support. In ${replyLanguageName(r.language)}, politely say you can only help in ${allowedLanguagesPhrase(policy.allowed)} and ask them to continue in one of those. Do not answer the question in another language.`);
      } else {
        lines.push(`- The customer wrote in a language this business doesn't support: begin with ONE short friendly sentence saying you can help in ${allowedLanguagesPhrase(policy.allowed)}, then answer their question in ${replyLanguageName(r.language)}.`);
      }
    }
  }
  return lines.join("\n");
}
