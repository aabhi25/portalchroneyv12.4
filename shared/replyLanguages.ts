/**
 * Reply languages: the one catalogue the AI-language setting, the widget dropdown and every
 * channel use (replaces the per-file language lists). Shared by server and client.
 */

export interface ReplyLanguage {
  code: string;
  name: string;
  nativeName: string;
  /** Whether replies in this language are written in a non-Latin script. */
  script: "latin" | "devanagari" | "tamil" | "telugu" | "kannada" | "bengali" | "gujarati" | "malayalam" | "gurmukhi" | "odia" | "arabic" | "cjk" | "hangul" | "thai" | "cyrillic";
}

export const REPLY_LANGUAGES: ReplyLanguage[] = [
  { code: "en", name: "English", nativeName: "English", script: "latin" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", script: "devanagari" },
  { code: "hinglish", name: "Hinglish (Hindi in English letters)", nativeName: "Hinglish", script: "latin" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", script: "tamil" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", script: "telugu" },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", script: "kannada" },
  { code: "mr", name: "Marathi", nativeName: "मराठी", script: "devanagari" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", script: "bengali" },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", script: "gujarati" },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം", script: "malayalam" },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", script: "gurmukhi" },
  { code: "ur", name: "Urdu", nativeName: "اردو", script: "arabic" },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", script: "odia" },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া", script: "bengali" },
  { code: "ne", name: "Nepali", nativeName: "नेपाली", script: "devanagari" },
  { code: "es", name: "Spanish", nativeName: "Español", script: "latin" },
  { code: "fr", name: "French", nativeName: "Français", script: "latin" },
  { code: "de", name: "German", nativeName: "Deutsch", script: "latin" },
  { code: "pt", name: "Portuguese", nativeName: "Português", script: "latin" },
  { code: "it", name: "Italian", nativeName: "Italiano", script: "latin" },
  { code: "ar", name: "Arabic", nativeName: "العربية", script: "arabic" },
  { code: "zh", name: "Chinese", nativeName: "中文", script: "cjk" },
  { code: "ja", name: "Japanese", nativeName: "日本語", script: "cjk" },
  { code: "ko", name: "Korean", nativeName: "한국어", script: "hangul" },
  { code: "ru", name: "Russian", nativeName: "Русский", script: "cyrillic" },
  { code: "th", name: "Thai", nativeName: "ไทย", script: "thai" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", script: "latin" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", script: "latin" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu", script: "latin" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", script: "latin" },
];

const BY_CODE = new Map(REPLY_LANGUAGES.map((l) => [l.code, l]));

export function isReplyLanguage(code: unknown): code is string {
  return typeof code === "string" && BY_CODE.has(code);
}

/** Plain English name ("Hindi"); "Hinglish" without the explanation. */
export function replyLanguageName(code: string | null | undefined): string {
  if (!code) return "English";
  if (code === "hinglish") return "Hinglish";
  return BY_CODE.get(code)?.name ?? code;
}

export function replyLanguage(code: string | null | undefined): ReplyLanguage | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

export type ReplyChannel = "website" | "voice" | "whatsapp" | "instagram" | "facebook";
export const REPLY_CHANNELS: ReplyChannel[] = ["website", "voice", "whatsapp", "instagram", "facebook"];

export type HindiScript = "devanagari" | "roman" | "match";
export type UnsupportedLanguageBehaviour = "default_with_note" | "ask_to_switch";
/** What a TopScholar medium means for replies. */
export type MediumStyle = "pure" | "with_english_terms" | "hinglish";

export interface ChannelLanguageOverride {
  /** null = inherit the business-wide setting. */
  allowed: string[] | null;
  defaultLanguage: string | null;
}

/** The business's AI reply-language setting (server and settings UI). */
export interface AiLanguageSettings {
  /** "any" = the AI follows the customer (as before); "restricted" = only `allowed`. */
  mode: "any" | "restricted";
  allowed: string[];
  defaultLanguage: string;
  hindiScript: HindiScript;
  unsupportedBehaviour: UnsupportedLanguageBehaviour;
  /** Also translate the business's own custom welcome message into the reply language. */
  translateCustomWelcome: boolean;
  /** Per-channel overrides (e.g. WhatsApp Hindi-only while the website allows English + Hindi). */
  channelOverrides: Partial<Record<ReplyChannel, ChannelLanguageOverride>>;
  /** TopScholar / K-12: start each student in their medium's language. */
  followMedium: boolean;
  /** The student may switch away from the medium's language (by asking or via the dropdown). */
  mediumSwitchable: boolean;
  /** Medium value (lower-case, as the content system sends it) → reply language code. */
  mediumMap: Record<string, string>;
  mediumStyle: MediumStyle;
}

export const DEFAULT_MEDIUM_MAP: Record<string, string> = {
  english: "en",
  "english medium": "en",
  hindi: "hi",
  "hindi medium": "hi",
  marathi: "mr",
  "marathi medium": "mr",
  gujarati: "gu",
  "gujarati medium": "gu",
  tamil: "ta",
  telugu: "te",
  kannada: "kn",
  bengali: "bn",
  urdu: "ur",
  "semi english": "en",
  "semi-english": "en",
};

export const DEFAULT_AI_LANGUAGE_SETTINGS: AiLanguageSettings = {
  mode: "any",
  allowed: ["en"],
  defaultLanguage: "en",
  hindiScript: "match",
  unsupportedBehaviour: "default_with_note",
  translateCustomWelcome: false,
  channelOverrides: {},
  followMedium: false,
  mediumSwitchable: true,
  mediumMap: DEFAULT_MEDIUM_MAP,
  mediumStyle: "with_english_terms",
};
