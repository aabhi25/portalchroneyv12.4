/**
 * Reply language for the website chat, the Home test chat, the public chat link and voice —
 * the glue between the policy (languagePolicy.ts) and chatService.
 *
 *   const { reply, preferredLanguage } = decideChatReplyLanguage({ policy, picked, detected, message, conversationKey, medium, legacyPreferred });
 *   chatService.streamMessage(message, { ..., preferredLanguage, replyLanguage: reply });
 *
 * "Any language" (the default) keeps today's behaviour exactly: `rule` is '' and
 * `preferredLanguage` is the value the caller used before (dropdown pick, else detected).
 */
import { isReplyLanguage, replyLanguage } from "@shared/replyLanguages";
import { LlamaService } from "../../llamaService";
import { looksConfidentlyEnglish } from "../chatContext/languageSession";
import { replyLanguageMatches, translateFixedText } from "./languageText";
import {
  buildLanguageRule,
  getLanguagePolicy,
  mediumLanguage,
  resolveReplyLanguage,
  takeLanguageNote,
  trackLanguageRequest,
  type LanguagePolicy,
  type ReplyLanguageResolution,
} from "./languagePolicy";

/** Server-only (never read from an HTTP body): the reply-language decision for one chat turn. */
export interface ChatReplyLanguage {
  /** null = follow the customer (unrestricted, nothing chosen). */
  language: string | null;
  source: ReplyLanguageResolution["source"];
  restricted: boolean;
  outsideAllowed: boolean;
  /** Text for the model's FINAL rules; '' = none (the existing language rules apply unchanged). */
  rule: string;
  /** How the model is told where `preferredLanguage` came from. */
  promptSource: LanguageSourceForPrompt;
}

/** How the model is told where the language came from ("selected from the dropdown" only when picked). */
export type LanguageSourceForPrompt = "picked" | "detected" | "requested" | "medium" | "default";

function known(lang: string | null | undefined): string | null {
  return lang && lang !== "auto" && lang !== "other" && isReplyLanguage(lang) ? lang : null;
}

export interface ChatReplyLanguageInput {
  policy: LanguagePolicy;
  /** The visitor's explicit dropdown choice ('auto' / empty = none). */
  picked?: string | null;
  /** The language detected for this message (null = unknown). */
  detected?: string | null;
  /** This message (for explicit "answer in English" requests). */
  message?: string | null;
  /** Conversation / session key (requests and the once-per-conversation note are remembered per key). */
  conversationKey?: string | null;
  /** TopScholar student medium. */
  medium?: string | null;
  /** What the caller passed as preferredLanguage before this feature (kept when nothing is decided). */
  legacyPreferred?: string | undefined;
}

export function decideChatReplyLanguage(input: ChatReplyLanguageInput): { reply: ChatReplyLanguage; preferredLanguage: string | undefined } {
  const { policy } = input;
  const requested = trackLanguageRequest(input.conversationKey ?? null, input.message ?? null);
  // A LOCKED medium also beats the dropdown when the business doesn't restrict languages
  // (resolveReplyLanguage only enforces the lock in restricted mode).
  const lockedMedium = !policy.restricted && policy.followMedium && !policy.mediumSwitchable && !!mediumLanguage(policy, input.medium);
  const r = resolveReplyLanguage({
    policy,
    picked: lockedMedium ? null : input.picked,
    detected: input.detected,
    requested: lockedMedium ? null : requested,
    medium: input.medium,
  });
  // Unrestricted + dropdown pick: the existing "user selected X" rules already cover it.
  const ruleActive = !!r.language && (r.restricted || r.source === "requested" || r.source === "medium");
  let rule = "";
  if (ruleActive) {
    const noteAllowed = r.outsideAllowed ? takeLanguageNote(input.conversationKey ?? null) : true;
    rule = buildLanguageRule(r, policy, { noteAllowed });
  }
  const reply: ChatReplyLanguage = {
    language: r.language,
    source: r.source,
    restricted: r.restricted,
    outsideAllowed: r.outsideAllowed,
    rule,
    promptSource: r.language
      ? (r.source === "customer" ? "detected" : r.source)
      : (input.picked && input.picked !== "auto" ? "picked" : "detected"),
  };
  return { reply, preferredLanguage: r.language ?? input.legacyPreferred };
}

/**
 * Website text chat (Home test chat, public chat link, non-streamed widget): load the policy and
 * decide. The language the message is written in is only worked out (heuristics, no AI call)
 * when the business restricts languages — "any language" keeps the caller's old value.
 */
export async function websiteReplyLanguage(input: Omit<ChatReplyLanguageInput, "policy"> & { businessAccountId: string; policy?: LanguagePolicy }): Promise<{ reply: ChatReplyLanguage; preferredLanguage: string | undefined; policy: LanguagePolicy }> {
  const policy = input.policy ?? (await getLanguagePolicy(input.businessAccountId, "website"));
  const detected = input.detected ?? (policy.restricted && !pickAllowed(policy, input.picked) ? detectTurnLanguage(input.message ?? "") : null);
  return { ...decideChatReplyLanguage({ ...input, policy, detected }), policy };
}

/**
 * Widget greeting: `introLanguage` for our own texts (AI greeting, default greeting, journey
 * first step, welcome back) and `welcomeLanguage` for the business's custom welcome message.
 * "Any language": the visitor's pick, as before (undefined when nothing is picked). A business
 * that restricts languages / follows the student's medium greets in its language even before
 * a pick; its own welcome text is translated for that only when it asked for it.
 */
export function greetingLanguages(policy: LanguagePolicy, picked: string | null | undefined, medium?: string | null): { introLanguage: string | undefined; welcomeLanguage: string | undefined } {
  const pick = picked && picked !== "auto" ? picked : undefined;
  const r = decideChatReplyLanguage({ policy, picked: pick, medium }).reply;
  const introLanguage = r.language ?? pick;
  const userPicked = r.source === "picked" || (!r.language && !!pick);
  return { introLanguage, welcomeLanguage: userPicked || policy.translateCustomWelcome ? introLanguage : undefined };
}

/** A language rule is in force for this turn (restricted, or a request / medium applies). */
export function replyLanguageActive(reply: ChatReplyLanguage | undefined | null): reply is ChatReplyLanguage & { language: string } {
  return !!reply && !!reply.language && !!reply.rule;
}

/** What the widget may know about the website policy (no secrets). null = any language (unchanged). */
export function publicReplyLanguages(policy: LanguagePolicy): { restricted: true; allowed: string[]; defaultLanguage: string } | null {
  if (!policy.restricted) return null;
  return { restricted: true, allowed: [...policy.allowed], defaultLanguage: policy.defaultLanguage };
}

/**
 * Voice: the language to pin the speech-to-text to, from the policy alone (null = auto).
 * Pinned when the business allows exactly one language (Hindi and Hinglish count as one —
 * both are transcribed as Hindi), or when the student is locked to their medium's language.
 */
export function policyTranscriptionLanguage(policy: LanguagePolicy, medium?: string | null): string | null {
  const family = (c: string) => (c === "hinglish" ? "hi" : c);
  if (policy.followMedium && !policy.mediumSwitchable) {
    const m = mediumLanguage(policy, medium);
    if (m && (!policy.restricted || policy.allowed.some((a) => family(a) === family(m)))) return family(m);
  }
  if (!policy.restricted) return null;
  const families = Array.from(new Set(policy.allowed.map(family)));
  return families.length === 1 ? families[0] : null;
}

/** Is a widget/voice dropdown value usable under the policy? (unrestricted: anything known) */
export function pickAllowed(policy: LanguagePolicy, picked: string | null | undefined): boolean {
  const k = known(picked);
  if (!k) return false;
  if (!policy.restricted) return true;
  return policy.allowed.includes(k) || (k === "hi" && policy.allowed.includes("hinglish")) || (k === "hinglish" && policy.allowed.includes("hi"));
}

/**
 * Should one of OUR fixed English texts be translated for `lang`? Not for English, and not
 * when the text is already in that (non-Latin) language — e.g. a Hindi business's own journey.
 */
export function needsFixedTranslation(text: string, lang: string | null | undefined, matches: (t: string, l: string) => boolean): boolean {
  if (!text || !text.trim() || !lang || lang === "en" || !replyLanguage(lang)) return false;
  const nonLatin = replyLanguage(lang)!.script !== "latin" || lang === "hinglish";
  return !(nonLatin && matches(text, lang));
}

/**
 * One of OUR fixed English texts (or a journey step) in the turn's reply language — only when
 * a rule is in force; cached translation, never blocks (original text on any failure).
 */
export async function localizeFixedText(businessAccountId: string, reply: ChatReplyLanguage | undefined | null, text: string): Promise<string> {
  if (!replyLanguageActive(reply) || !needsFixedTranslation(text, reply.language, replyLanguageMatches)) return text;
  return translateFixedText(businessAccountId, text, reply.language);
}

/**
 * The language a single spoken/typed turn is in, without an AI call (null = not sure).
 * Script heuristics + Hinglish words; long plain-English sentences count as English.
 * Urdu/Arabic script in a voice transcript is the transcriber's rendering of Hindi.
 */
export function detectTurnLanguage(text: string, opts: { arabicIsHindi?: boolean } = {}): string | null {
  const t = String(text || "").trim();
  if (!t) return null;
  const quick = LlamaService.quickDetectLanguage(t);
  if (quick === "ar" && opts.arabicIsHindi) return "hi";
  if (quick) return quick;
  return looksConfidentlyEnglish(t) ? "en" : null;
}
