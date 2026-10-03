/**
 * The reply-language policy for the NON-streamed channels: WhatsApp (AI replies, flows, campaign
 * replies), Instagram / Facebook DMs, comment replies and DM flows.
 *
 *   const lang = await restrictedReplyLanguage({ businessAccountId, channel: "whatsapp", conversationKey, message, detected });
 *   if (!lang) → the channel is NOT restricted: keep every existing prompt exactly as it was
 *                (no detection, no translation, no extra AI calls).
 *   else       → lang.language is the reply language, lang.rule goes last in the model's rules,
 *                checkReplyLanguage() rewrites a wrong-language reply before it is sent and
 *                ourText() translates our own fixed messages (never business-written text or
 *                WhatsApp templates).
 *
 * Built on languagePolicy.ts / languageText.ts (the one place that decides the language).
 */
import { describeLanguage, allowedLanguagesPhrase, buildLanguageRule, getLanguagePolicy, resolveReplyLanguage, takeLanguageNote, trackLanguageRequest, type LanguagePolicy, type ReplyLanguageResolution } from "./languagePolicy";
import { correctReplyLanguage, translateFixedText } from "./languageText";
import { replyLanguageName } from "@shared/replyLanguages";

export type SocialReplyChannel = "whatsapp" | "instagram" | "facebook";

export interface ChannelReplyLanguage {
  /** The language to reply in (always one of the channel's allowed languages). */
  language: string;
  /** The model rule (REPLY LANGUAGE block) for the end of the prompt. */
  rule: string;
  resolution: ReplyLanguageResolution;
  policy: LanguagePolicy;
  /** This reply carries the once-per-conversation "I can help in …" line (or the ask to switch). */
  withNote: boolean;
}

/**
 * Stable per-customer key for the conversation memory (explicit "answer in Hindi" requests and the
 * once-only note). WhatsApp AI replies and campaign replies share it (same number = same chat).
 */
export function channelConversationKey(channel: SocialReplyChannel, businessAccountId: string, customerId: string | null | undefined, kind: "dm" | "comment" = "dm"): string | null {
  if (!customerId) return null;
  // WhatsApp: the last 10 digits, so "919876543210" (webhook) and "9876543210" (a campaign list) are the same chat.
  const num = String(customerId).replace(/\D/g, "");
  const id = channel === "whatsapp" ? (num.length >= 10 ? num.slice(-10) : num || String(customerId)) : String(customerId);
  return `${channel}${kind === "comment" ? "-comment" : ""}:${businessAccountId}:${id}`;
}

/**
 * Our own pre-filled website → WhatsApp hand-off text ("Hi! I was asking about … on your website.").
 * The customer didn't choose its language, so it doesn't count as "writing in English".
 */
export function isHandoffPrefill(message: string | null | undefined): boolean {
  return /^Hi! I was (asking about [\s\S]{1,80} on your website|chatting on your website)\.?\s*$/.test(String(message ?? "").trim());
}

/** The customer's language: the quick script/word check, else the AI detector (null when unknown). */
export async function detectCustomerLanguage(message: string, apiKey?: string | null): Promise<string | null> {
  try {
    const { LlamaService, llamaService } = await import("../../llamaService");
    const quick = LlamaService.quickDetectLanguage(message);
    if (quick !== null) return quick;
    return await llamaService.detectLanguage(message, apiKey || undefined).catch(() => null);
  } catch (error) {
    console.warn("[Language] Detection failed (treated as unknown):", (error as Error)?.message);
    return null;
  }
}

export interface RestrictedReplyLanguageInput {
  businessAccountId: string;
  channel: SocialReplyChannel;
  /** channelConversationKey(...) — null = no memory (the note is then never added). */
  conversationKey: string | null;
  /** The customer's message this reply answers. */
  message: string;
  /**
   * The language the channel already detected for this message. Leave undefined to detect here —
   * detection then only runs when the channel IS restricted.
   */
  detected?: string | null;
  /** For the detector's AI fallback. */
  apiKey?: string | null;
  /** false: never add the "I can help in …" note (flows, fixed texts). Default true. */
  allowNote?: boolean;
}

/**
 * The reply language for one message, or null when the channel follows the customer ("any
 * language", the default) — callers then keep today's behaviour exactly.
 */
export async function restrictedReplyLanguage(input: RestrictedReplyLanguageInput): Promise<ChannelReplyLanguage | null> {
  let policy: LanguagePolicy;
  try {
    policy = await getLanguagePolicy(input.businessAccountId, input.channel);
  } catch {
    return null;
  }
  if (!policy.restricted) return null;
  const detected = input.detected !== undefined ? input.detected : await detectCustomerLanguage(input.message, input.apiKey);
  const requested = trackLanguageRequest(input.conversationKey, input.message);
  const resolution = resolveReplyLanguage({ policy, detected, requested });
  if (!resolution.language) return null;
  const withNote = !!(resolution.outsideAllowed && input.allowNote !== false && input.conversationKey && takeLanguageNote(input.conversationKey));
  const rule = buildLanguageRule(resolution, policy, { noteAllowed: withNote });
  console.log(`[Language] ${input.channel}: reply in ${resolution.language} (${resolution.source}${resolution.outsideAllowed ? ", customer wrote in a language outside the allowed ones" : ""}${withNote ? ", with note" : ""})`);
  return { language: resolution.language, rule, resolution, policy, withNote };
}

/** The same decision for a second message of the same turn (e.g. the private DM after a comment reply): no note. */
export function withoutLanguageNote(lang: ChannelReplyLanguage | null | undefined): ChannelReplyLanguage | null {
  if (!lang) return null;
  if (!lang.withNote) return lang;
  return { ...lang, withNote: false, rule: buildLanguageRule(lang.resolution, lang.policy, { noteAllowed: false }) };
}

/** Script line that goes with the rule (replaces the old Latin-input → Latin-output rule). */
export function scriptRuleFor(language: string): string {
  if (language === "hinglish") return "SCRIPT RULE: write Hindi in English (Roman) letters only — no Devanagari.";
  if (language === "hi") return "SCRIPT RULE: write in Devanagari script; use Latin letters only for brand / product names, prices, codes and links.";
  const description = describeLanguage(language);
  return /in its own script/.test(description)
    ? `SCRIPT RULE: write in the ${replyLanguageName(language)} script; Latin letters only for brand / product names, prices, codes and links.`
    : "SCRIPT RULE: Latin script only.";
}

/** The final system message for a restricted DM / WhatsApp reply (replaces the "ABSOLUTE OVERRIDE"). */
export function restrictedLanguageOverride(lang: ChannelReplyLanguage): string {
  return `${lang.rule}\n- Ignore the language of earlier messages in the conversation history.\n${scriptRuleFor(lang.language)}`;
}

/**
 * For flow prompts that return JSON: replaces their "Respond in the SAME LANGUAGE the customer used"
 * line. Only the customer-facing text field is affected — extracted values stay as typed.
 */
export function flowResponseLanguageLine(lang: ChannelReplyLanguage, field = "response"): string {
  return `IMPORTANT: Write the ${field} text in ${describeLanguage(lang.language)} — this business only replies in ${allowedLanguagesPhrase(lang.policy.allowed)}, whatever language the customer used. Keep extracted values exactly as the customer wrote them.`;
}

/** Safety check before sending: a reply that slipped into another language is rewritten (no AI call when it matches). */
export async function checkReplyLanguage(businessAccountId: string, text: string, lang: ChannelReplyLanguage | null | undefined): Promise<string> {
  if (!lang || !text) return text;
  return (await correctReplyLanguage(businessAccountId, text, lang.language)).text;
}

/** One of OUR fixed English messages in the reply language (unchanged when unrestricted or English). */
export async function ourText(businessAccountId: string, text: string, lang: ChannelReplyLanguage | null | undefined): Promise<string> {
  if (!lang || !text) return text;
  return translateFixedText(businessAccountId, text, lang.language);
}
