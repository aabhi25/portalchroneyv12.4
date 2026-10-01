/**
 * Smart Lead Training for the messaging channels — Instagram / Facebook DMs and WhatsApp.
 *
 * The website chat has its own runtime; DMs and WhatsApp use this module to decide, on every
 * customer message, which ONE contact detail (if any) the AI should ask for, and to word that
 * instruction. Usage (see social/autoReplyEngine.ts and whatsappAutoReplyService.ts):
 *
 *   const fields = normalizeChannelLeadFields(widgetSettings.leadTrainingConfig, { excludeKinds: ["phone"] });
 *   const conversation = currentConversation(ensureCurrentMessage(storedTurns, text));
 *   const state = analyzeLeadConversation(fields, conversation, contactAlreadyOnTheLead);
 *   const decision = resolveNextLeadAsk(fields, state);
 *   const prompt = buildChannelLeadPrompt(decision, state, fields, { channel: "whatsapp", captureTool: "capture_lead" });
 *
 * Rules (per field of widget_settings.leadTrainingConfig; enabled fields only, lower priority first):
 *  - Timing: "start" → from the first customer message; "custom" → from customer message
 *    #customAskAfter (default 2) of this conversation; "keyword" → once a customer message in this
 *    conversation contains one of the field's keywords (whole word / phrase, any case);
 *    "intent" → the AI judges the message against the field's sensitivity (same wording as the
 *    website). Legacy "smart" = custom, "end" = keyword.
 *  - One field at a time, in priority order across all timings.
 *  - Required fields block answering until given; optional ones are asked after answering.
 *  - Already collected = on the saved lead OR said in this conversation (precise patterns only).
 *  - Optional fields are asked at most once per conversation; a required field at most twice (the
 *    first ask + one re-ask after a refusal), then the bot carries on without it.
 *  - Phone (DMs only): checked with the field's phoneValidation via shared/validation/phone.ts. A
 *    number that fails gets one request for a correct number; a second bad number ends phone asks.
 *
 * State: nothing is kept in memory. Everything is derived from the stored conversation (the
 * channel's message rows, so it survives restarts) plus the saved lead: message counts from the
 * customer's stored messages, "already asked" from the bot's own stored replies, "declined" = asked
 * as often as allowed without getting it. A conversation = messages since the last 24 h of silence.
 *
 * Swap seam: resolveNextLeadAsk(fields, state) → LeadAskDecision is self-contained, so it can later be
 * replaced by the shared website "next field to ask" resolver without touching the channel code.
 */
import { validatePhoneNumber, type PhoneValidationMode, type PhoneValidationResult } from "@shared/validation/phone";

export type LeadFieldId = "name" | "mobile" | "whatsapp" | "email";
export type LeadFieldKind = "name" | "email" | "phone";
export type CaptureTiming = "start" | "custom" | "intent" | "keyword";
export type IntentLevel = "low" | "medium" | "high";
export type MessagingChannel = "instagram" | "facebook" | "whatsapp";

export interface ChannelLeadField {
  id: LeadFieldId;
  kind: LeadFieldKind;
  required: boolean;
  priority: number;
  timing: CaptureTiming;
  /** "custom" timing: due from this customer message number (1-based, this conversation). */
  askOnMessage: number;
  intentLevel: IntentLevel;
  keywords: string[];
  /** Digit rule saved by the settings UI (legacy configs: derived from digitCount). */
  phoneValidation: PhoneValidationMode;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  at?: Date | null;
}

/** Contact details already on the saved lead record (any may be missing). */
export interface KnownContact {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export const CONVERSATION_GAP_MS = 24 * 60 * 60 * 1000;
/** How many stored messages the channels load to rebuild the conversation. */
export const CONVERSATION_FETCH_LIMIT = 200;
export const MAX_ASKS_REQUIRED = 2;
export const MAX_ASKS_OPTIONAL = 1;
/** Bad phone numbers after which phone asks stop for the conversation (the first one gets a re-ask). */
export const MAX_INVALID_PHONES = 2;

const FIELD_KIND: Record<LeadFieldId, LeadFieldKind> = { name: "name", email: "email", mobile: "phone", whatsapp: "phone" };
export const FIELD_LABEL: Record<LeadFieldId, string> = {
  name: "full name",
  email: "email address",
  mobile: "mobile number",
  whatsapp: "WhatsApp number",
};

// ── Config ───────────────────────────────────────────────────────────────────

/** The UI saves `phoneValidation`; very old configs carried `digitCount` instead. Default: 10 digits. */
export function phoneValidationOf(field: any): PhoneValidationMode {
  const v = field?.phoneValidation;
  if (v === "10" || v === "12" || v === "8-12" || v === "any") return v;
  const d = Number(field?.digitCount);
  if (d === 10) return "10";
  if (d === 12) return "12";
  if (d >= 8 && d <= 12) return "8-12";
  if (d > 0) return "any";
  return "10";
}

/** Enabled fields of a leadTrainingConfig, normalised and sorted by priority. */
export function normalizeChannelLeadFields(config: unknown, opts: { excludeKinds?: LeadFieldKind[] } = {}): ChannelLeadField[] {
  const raw = (config as any)?.fields;
  if (!Array.isArray(raw)) return [];
  const out: ChannelLeadField[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object" || f.enabled !== true) continue;
    const id = String(f.id || "").toLowerCase() as LeadFieldId;
    const kind = FIELD_KIND[id];
    if (!kind || opts.excludeKinds?.includes(kind)) continue;
    const strategy = String(f.captureStrategy || "custom");
    const timing: CaptureTiming = strategy === "start" ? "start"
      : strategy === "intent" ? "intent"
      : strategy === "keyword" || strategy === "end" ? "keyword"
      : "custom";
    const n = Number(f.customAskAfter);
    const priority = Number(f.priority);
    out.push({
      id,
      kind,
      required: f.required === true,
      priority: Number.isFinite(priority) ? priority : 999,
      timing,
      askOnMessage: Number.isInteger(n) && n >= 1 ? Math.min(n, 50) : 2,
      intentLevel: f.intentIntensity === "low" || f.intentIntensity === "high" ? f.intentIntensity : "medium",
      keywords: Array.isArray(f.captureKeywords) ? f.captureKeywords.map((k: unknown) => String(k).trim()).filter(Boolean) : [],
      phoneValidation: phoneValidationOf(f),
    });
  }
  return out.sort((a, b) => a.priority - b.priority);
}

// ── Conversation ─────────────────────────────────────────────────────────────

/** Adds the message being answered when it is not stored yet (stored rows are the source of truth). */
export function ensureCurrentMessage(turns: ChatTurn[], current: string, now: Date = new Date()): ChatTurn[] {
  const text = (current || "").trim();
  if (!text) return turns;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "assistant") break;
    if (turns[i].content.trim() === text) return turns;
  }
  return [...turns, { role: "user", content: current, at: now }];
}

/** The trailing part of the chat that follows the last silence longer than `gapMs`. */
export function currentConversation(turns: ChatTurn[], gapMs: number = CONVERSATION_GAP_MS): ChatTurn[] {
  let start = 0;
  for (let i = 1; i < turns.length; i++) {
    const prev = turns[i - 1].at;
    const cur = turns[i].at;
    if (prev && cur && cur.getTime() - prev.getTime() > gapMs) start = i;
  }
  return turns.slice(start);
}

// ── Detection (customer messages) ────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{5,}\d/g;

/** Words that end a name ("Rahul from Delhi", "Priya and I…", "Amit ji"). */
const NAME_STOP = new Set([
  "and", "from", "i", "im", "i'm", "here", "hai", "hu", "hoon", "hun", "hoo", "h", "he", "ji", "please", "pls", "plz",
  "my", "number", "email", "phone", "mobile", "is", "aur", "se", "want", "wants", "need", "looking", "interested",
  "calling", "speaking", "this", "the", "a", "an", "with", "at", "in", "for", "to", "of", "but", "so", "ok", "okay",
  "thanks", "thank", "sir", "madam", "mam", "maam", "bhai", "by", "on", "via", "or", "&", "-",
]);

/** First words that are not names ("I'm interested…", "I'm good", "call me later"). */
const NOT_A_NAME = new Set([
  "no", "nope", "nah", "na", "nahi", "nhi", "none", "nothing", "never", "not", "why", "what", "when", "where", "who", "how",
  "which", "yes", "yeah", "yep", "yup", "haan", "ha", "han", "ok", "okay", "k", "sure", "fine", "good", "great", "cool", "nice",
  "thanks", "thank", "ty", "thx", "hi", "hii", "hello", "hey", "hola", "bye", "later", "interested", "looking", "here",
  "there", "from", "just", "also", "very", "so", "really", "a", "an", "the", "new", "back", "available", "ready", "done",
  "busy", "sorry", "confused", "happy", "glad", "well", "alright", "student", "customer", "parent", "working", "asking",
  "trying", "waiting", "planning", "thinking", "going", "coming", "calling", "sending", "fee", "fees", "price", "pricing",
  "cost", "details", "detail", "info", "information", "course", "courses", "admission", "please", "pls", "plz", "skip",
  "pass", "tomorrow", "now", "today", "soon", "asap", "anyone", "someone", "keen", "curious", "unable", "able", "dont",
  "don't", "cant", "can't", "wont", "won't", "test", "testing", "call", "me", "you", "it", "this", "that", "myself", "mine",
  "fresher", "graduate", "married", "single", "tired", "bored", "excited", "free", "online", "offline", "in", "at", "on",
  "for", "to", "with", "about", "regarding", "inquiring", "enquiring", "abhi", "baad", "kal", "theek", "thik", "accha",
  "acha", "haa", "hmm", "hm", "number", "email", "mail", "phone", "mobile", "name", "naam", "bot", "human", "agent",
  "kya", "kaun", "kab", "kaise", "kyu", "kyun", "kahan", "bhi", "tell", "show", "give", "send", "share", "need", "want",
  "know", "let", "can", "could", "would", "will", "do", "does", "is", "are", "was", "kindly", "first", "before", "after",
  "maybe", "evening", "morning", "afternoon", "night", "tonight", "anytime", "sometime", "my", "your", "our", "we", "us",
  "i", "im", "am", "he", "she", "they", "and", "or", "but", "if", "then", "than", "more", "less", "much", "many", "some",
  "any", "all", "same", "other", "another", "only", "still", "again", "too", "here's", "there's", "it's", "its",
]);

// Letters: Latin (incl. accented) and the Indian scripts (Devanagari … Malayalam). Written without the
// `u` flag / \p{L}, which this build target rejects.
const LETTERS = "A-Za-z\u00C0-\u024F\u0900-\u0DFF";
const NAME_WORD_RE = new RegExp(`^[${LETTERS}][${LETTERS}'’.-]*$`);
const NON_LETTER_RE = new RegExp(`[^${LETTERS}]`, "g");
const ADJECTIVE_SUFFIX_RE = /(?:ing|ous|ful|able|ible)$/i;

/** Words that may follow a name in a message that is only a name ("Rahul ji", "Priya here", "Amit, thanks"). */
const TRAILING_OK = new Set(["here", "ji", "hai", "hu", "hoon", "hun", "h", "he", "sir", "madam", "mam", "maam", "bhai", "please", "pls", "thanks", "thank", "you", "ty"]);

/**
 * First 1–3 name-like words of `raw`; null if it doesn't look like a name. `wholeMessage`: nothing
 * but a courtesy word may follow the name ("I'm Rahul" yes, "I'm Rahul and I need a loan" no).
 */
function cleanName(raw: string, opts: { wholeMessage?: boolean } = {}): string | null {
  const rawWords = raw.trim().split(/\s+/).filter(Boolean);
  const words = rawWords.map(w => w.replace(/[.,!?;:)]+$/, ""));
  const kept: string[] = [];
  let i = 0;
  for (; i < words.length && kept.length < 3; i++) {
    const w = words[i];
    if (!w || !NAME_WORD_RE.test(w) || NAME_STOP.has(w.toLowerCase())) break;
    kept.push(w);
    // Punctuation ends the name: "Anita Desai, anita@example.com".
    if (w !== rawWords[i]) { i++; break; }
  }
  if (kept.length === 0) return null;
  if (opts.wholeMessage && words.slice(i).filter(Boolean).some(w => !TRAILING_OK.has(w.toLowerCase()))) return null;
  const first = kept[0].toLowerCase();
  if (NOT_A_NAME.has(first)) return null;
  if (first.replace(NON_LETTER_RE, "").length < 2) return null;
  if (first.length >= 6 && ADJECTIVE_SUFFIX_RE.test(first)) return null;
  if (kept.some(k => NOT_A_NAME.has(k.toLowerCase()))) return null;
  return kept.join(" ");
}

// Explicit introductions anywhere in the message.
const EXPLICIT_NAME_PATTERNS: RegExp[] = [
  /\bmy\s+(?:full\s+|good\s+|first\s+)?name\s+is\s+(.+)$/i,
  /\bmy\s+(?:full\s+)?name['’]s\s+(.+)$/i,
  /\b(?:mera|meraa|mera\s+pura|mera\s+poora)\s+(?:naam|nam|name)\s+(?:hai\s+|he\s+|h\s+)?(.+)$/i,
  /\b(?:naam|nam)\s+(?:hai|he|h)\s+(.+)$/i,
  /^(?:hi|hello|hey|hii)?[\s,!.]*myself\s+(.+)$/i,
  /^\s*(?:name|full\s+name)\s*[:=-]\s*(.+)$/i,
];
// Hindi "naam X hai" with the verb after the name.
const HINDI_NAME_BEFORE_VERB_RE = /\b(?:mera|meraa)?\s*(?:naam|nam)\s+(.+?)\s+(?:hai|he|h|hain)\b/i;
// Whole-message introductions only: "I'm Rahul", "hi, I am Priya Sharma" (not "I'm interested in…").
const WHOLE_MESSAGE_NAME_PATTERNS: RegExp[] = [
  /^(?:hi|hello|hey|hii)?[\s,!.]*(?:i\s*['’]?\s*m|i\s+am)\s+(.+?)(?:\s+here)?[\s.!]*$/i,
];
// Reply to "may I know your name?": "it's Rahul", "this is Rahul", "Rahul here", or just "Rahul".
const REPLY_NAME_PATTERNS: RegExp[] = [
  /^(?:it['’]?s|its|this\s+is|i\s*['’]?\s*m|i\s+am|im|main|mai)\s+(.+?)(?:\s+(?:here|hoon|hu|hun))?[\s.!]*$/i,
  /^(.+?)\s+here[\s.!]*$/i,
  /^(.+?)[\s.!]*$/,
];

function nameFromMessage(text: string, afterNameAsk: boolean): string | null {
  const msg = text.trim();
  if (!msg || msg.length > 200) return null;
  for (const re of EXPLICIT_NAME_PATTERNS) {
    const m = msg.match(re);
    if (m) {
      const n = cleanName(m[1]);
      if (n) return n;
    }
  }
  const hindi = msg.match(HINDI_NAME_BEFORE_VERB_RE);
  if (hindi) {
    const n = cleanName(hindi[1], { wholeMessage: true });
    if (n) return n;
  }
  for (const re of WHOLE_MESSAGE_NAME_PATTERNS) {
    const m = msg.match(re);
    if (m) {
      const n = cleanName(m[1], { wholeMessage: true });
      if (n) return n;
    }
  }
  if (afterNameAsk && !/[?@\d]/.test(msg) && msg.length <= 60) {
    for (const re of REPLY_NAME_PATTERNS) {
      const m = msg.match(re);
      if (m) {
        const n = cleanName(m[1], { wholeMessage: true });
        if (n) return n;
      }
    }
  }
  return null;
}

/** Latest name the customer gave in this conversation (precise patterns; "I'm interested…" is not a name). */
export function detectName(conversation: ChatTurn[]): string | null {
  let found: string | null = null;
  for (let i = 0; i < conversation.length; i++) {
    const t = conversation[i];
    if (t.role !== "user") continue;
    const prev = i > 0 ? conversation[i - 1] : null;
    const afterNameAsk = !!prev && prev.role === "assistant" && askedKinds(prev.content).has("name");
    const n = nameFromMessage(t.content, afterNameAsk);
    if (n) found = n;
  }
  return found;
}

/** Latest email address the customer typed in this conversation. */
export function detectEmail(conversation: ChatTurn[]): string | null {
  let found: string | null = null;
  for (const t of conversation) {
    if (t.role !== "user") continue;
    const all = t.content.match(EMAIL_RE);
    if (all?.length) found = all[all.length - 1];
  }
  return found;
}

interface PhoneMention {
  index: number;
  raw: string;
  result: PhoneValidationResult;
}

/** Phone-looking numbers per customer message. Short ones (7–8 digits) only count right after a phone ask. */
function phoneMentions(conversation: ChatTurn[], mode: PhoneValidationMode): PhoneMention[][] {
  return conversation.map((t, i) => {
    if (t.role !== "user") return [];
    const prev = i > 0 ? conversation[i - 1] : null;
    const afterPhoneAsk = !!prev && prev.role === "assistant" && askedKinds(prev.content).has("phone");
    const withoutEmails = t.content.replace(EMAIL_RE, " ");
    const out: PhoneMention[] = [];
    for (const raw of withoutEmails.match(PHONE_CANDIDATE_RE) || []) {
      const digits = raw.replace(/\D/g, "").length;
      if (digits < 7 || digits > 15) continue;
      if (digits < 9 && !afterPhoneAsk) continue;
      out.push({ index: i, raw: raw.trim(), result: validatePhoneNumber(raw, mode) });
    }
    return out;
  });
}

export interface ExtractedContacts {
  name: string | null;
  email: string | null;
  /** Latest number that passes the field's phoneValidation (spaces/dashes/brackets removed). */
  phone: string | null;
  /** Why the latest number after the last valid one was rejected (reason code only, no digits). */
  rejectedPhoneReason: PhoneValidationResult["reasonCode"] | null;
}

/** What the customer said in this conversation, ready to save on the lead. */
export function extractContacts(conversation: ChatTurn[], phoneMode: PhoneValidationMode): ExtractedContacts {
  let phone: string | null = null;
  let rejectedPhoneReason: ExtractedContacts["rejectedPhoneReason"] = null;
  for (const mentions of phoneMentions(conversation, phoneMode)) {
    for (const m of mentions) {
      if (m.result.isValid) {
        phone = m.raw.replace(/[\s().-]/g, "");
        rejectedPhoneReason = null;
      } else {
        rejectedPhoneReason = m.result.reasonCode;
      }
    }
  }
  return { name: detectName(conversation), email: detectEmail(conversation), phone, rejectedPhoneReason };
}

// ── Detection (bot messages): which details did the bot already ask for? ─────

const ASK_PATTERNS: Record<LeadFieldKind, RegExp> = {
  name: /\b(?:your|ur)\s+(?:full\s+|good\s+|first\s+)?name\b|\b(?:name|naam)\s*(?:please|pls|plz)\b|\bwhat\s+(?:should|can|may)\s+i\s+call\s+you\b|\bwho\s+(?:am\s+i|i'm)\s+(?:speaking|chatting|talking)\s+(?:to|with)\b|\b(?:aapka|apka|aap\s+ka|apna|aapki)\s+(?:shubh\s+|pura\s+|poora\s+)?(?:naam|name)\b/i,
  email: /\b(?:your|ur)\s+(?:e-?mail|mail)(?:\s*(?:address|id))?\b|\b(?:aapka|apka|apna|aapki)\s+(?:e-?mail|mail)\b/i,
  phone: /\b(?:your|ur)\s+(?:(?:mobile|phone|contact|cell|whatsapp)(?:\s*(?:number|no\.?|num))?|number)\b|\b(?:aapka|apka|apna)\s+(?:(?:mobile|phone|contact|whatsapp)\s+)?(?:number|no\.?|nambar)\b|\bvalid\s+(?:\d+[-\s]?digit\s+)?(?:(?:mobile|phone|whatsapp)\s+)?number\b/i,
};
const REQUEST_CUE_RE = /\?|\b(?:share|provide|send|tell|give|drop|type|enter|let\s+me\s+know|may\s+i|could\s+you|can\s+you|would\s+you|please|kindly|bata\w*|bhej\w*|dijiye|de\s+do|chahiye)\b/i;

/** Contact details a bot message asks for (sentence-level: the detail + a question / request). */
export function askedKinds(text: string): Set<LeadFieldKind> {
  const kinds = new Set<LeadFieldKind>();
  for (const sentence of (text || "").split(/(?<=[.!?\n])\s+/)) {
    if (!REQUEST_CUE_RE.test(sentence)) continue;
    (Object.keys(ASK_PATTERNS) as LeadFieldKind[]).forEach(k => { if (ASK_PATTERNS[k].test(sentence)) kinds.add(k); });
  }
  return kinds;
}

// ── Keywords ─────────────────────────────────────────────────────────────────

function keywordRegex(keyword: string): RegExp | null {
  const parts = keyword.trim().split(/\s+/).filter(Boolean).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (parts.length === 0) return null;
  return new RegExp(`(?<![${LETTERS}0-9_])${parts.join("\\s+")}(?![${LETTERS}0-9_])`, "i");
}

/** Configured keywords found in `text` as whole words / phrases ("price" ≠ "priceless"), any case. */
export function matchedKeywords(text: string, keywords: string[]): string[] {
  return keywords.filter(k => keywordRegex(k)?.test(text || ""));
}

// ── State + decision ─────────────────────────────────────────────────────────

export interface ConversationLeadState {
  /** Customer messages in this conversation, including the one being answered. */
  userMessageCount: number;
  currentMessage: string;
  collected: Record<LeadFieldKind, boolean>;
  /** Bot messages in this conversation that asked for each detail. */
  asks: Record<LeadFieldKind, number>;
  /** Keyword-timed fields whose keywords a customer message in this conversation contained. */
  keywordTriggered: LeadFieldId[];
  /** Customer messages that contained only numbers failing the phone rule. */
  invalidPhoneAttempts: number;
  /** The message being answered contains a number that fails the phone rule. */
  currentPhoneProblem: PhoneValidationResult["reasonCode"] | null;
  /** The message being answered is only a phone number / email. */
  justSharedContact: boolean;
}

/** Digit rule of the highest-priority phone field; "any" when no phone field is configured. */
export function phoneModeOf(fields: ChannelLeadField[]): PhoneValidationMode {
  return fields.find(f => f.kind === "phone")?.phoneValidation || "any";
}

export function analyzeLeadConversation(fields: ChannelLeadField[], conversation: ChatTurn[], known: KnownContact = {}): ConversationLeadState {
  const userTurns = conversation.filter(t => t.role === "user");
  const current = userTurns.length ? userTurns[userTurns.length - 1].content : "";
  const mode = phoneModeOf(fields);

  const asks: Record<LeadFieldKind, number> = { name: 0, email: 0, phone: 0 };
  for (const t of conversation) {
    if (t.role !== "assistant") continue;
    askedKinds(t.content).forEach(k => { asks[k]++; });
  }

  const perMessage = phoneMentions(conversation, mode);
  let validPhone = false;
  let invalidPhoneAttempts = 0;
  for (const mentions of perMessage) {
    if (mentions.length === 0) continue;
    if (mentions.some(m => m.result.isValid)) validPhone = true;
    else invalidPhoneAttempts++;
  }
  const lastUserIndex = conversation.map(t => t.role).lastIndexOf("user");
  const currentMentions = lastUserIndex >= 0 ? perMessage[lastUserIndex] : [];
  const currentPhoneProblem = currentMentions.length > 0 && !currentMentions.some(m => m.result.isValid)
    ? currentMentions[currentMentions.length - 1].result.reasonCode
    : null;

  const keywordTriggered: LeadFieldId[] = [];
  for (const f of fields) {
    if (f.timing !== "keyword" || f.keywords.length === 0) continue;
    if (userTurns.some(t => matchedKeywords(t.content, f.keywords).length > 0)) keywordTriggered.push(f.id);
  }

  const trimmed = current.trim();
  return {
    userMessageCount: userTurns.length,
    currentMessage: current,
    collected: {
      name: !!(known.name && String(known.name).trim()) || !!detectName(conversation),
      email: !!(known.email && String(known.email).trim()) || !!detectEmail(conversation),
      phone: !!(known.phone && String(known.phone).trim()) || validPhone,
    },
    asks,
    keywordTriggered,
    invalidPhoneAttempts,
    currentPhoneProblem,
    justSharedContact: /^\+?[\d\s().-]{7,20}$/.test(trimmed) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed),
  };
}

export type LeadAskMode = "block" | "after_answer" | "intent" | "fix_phone" | "none";

export interface LeadAskDecision {
  /**
   * block: required field — ask before answering; after_answer: optional — answer, then ask;
   * intent: ask only if the AI judges the message meets the field's sensitivity; fix_phone: the
   * number just sent fails the phone rule — ask once for a correct one; none: ask for nothing.
   */
  mode: LeadAskMode;
  field: ChannelLeadField | null;
  /** 1-based ask number for `field` in this conversation (2 = the last re-ask of a required field). */
  attempt: number;
  /** Higher-priority intent field to ask for instead of `field` when the message shows that intent. */
  intentFirst: ChannelLeadField | null;
  /** Not collected and their timing hasn't been reached. */
  waiting: ChannelLeadField[];
  /** Not collected but already asked as often as allowed (declined / ignored). */
  askedEnough: ChannelLeadField[];
  collected: LeadFieldKind[];
}

function isExhausted(f: ChannelLeadField, s: ConversationLeadState): boolean {
  if (f.kind === "phone" && s.invalidPhoneAttempts >= MAX_INVALID_PHONES) return true;
  return s.asks[f.kind] >= (f.required ? MAX_ASKS_REQUIRED : MAX_ASKS_OPTIONAL);
}

function isDue(f: ChannelLeadField, s: ConversationLeadState): boolean {
  switch (f.timing) {
    case "start": return true;
    case "custom": return s.userMessageCount >= f.askOnMessage;
    case "keyword": return s.keywordTriggered.includes(f.id);
    default: return false;
  }
}

/** Which ONE detail to ask for now (priority order across all timings), if any. */
export function resolveNextLeadAsk(fields: ChannelLeadField[], state: ConversationLeadState): LeadAskDecision {
  const collected = (Object.keys(state.collected) as LeadFieldKind[]).filter(k => state.collected[k]);
  const waiting: ChannelLeadField[] = [];
  const askedEnough: ChannelLeadField[] = [];
  const decide = (mode: LeadAskMode, field: ChannelLeadField | null, intentFirst: ChannelLeadField | null = null): LeadAskDecision => ({
    mode, field, attempt: field ? state.asks[field.kind] + 1 : 0, intentFirst, waiting, askedEnough, collected,
  });

  const phoneField = fields.find(f => f.kind === "phone");
  if (phoneField && !state.collected.phone && state.currentPhoneProblem && state.invalidPhoneAttempts < MAX_INVALID_PHONES) {
    return decide("fix_phone", phoneField);
  }

  let intentCandidate: ChannelLeadField | null = null;
  const seenKinds = new Set<LeadFieldKind>();
  for (const f of fields) {
    if (state.collected[f.kind] || seenKinds.has(f.kind)) continue;
    if (isExhausted(f, state)) { askedEnough.push(f); seenKinds.add(f.kind); continue; }
    if (isDue(f, state)) {
      const alt = intentCandidate && intentCandidate.kind !== f.kind ? intentCandidate : null;
      return decide(f.required ? "block" : "after_answer", f, alt);
    }
    if (f.timing === "intent" && !intentCandidate) intentCandidate = f;
    else waiting.push(f);
  }
  if (intentCandidate) return decide("intent", intentCandidate);
  return decide("none", null);
}

/** One-line summary for logs (no customer data). */
export function describeLeadDecision(d: LeadAskDecision, s: ConversationLeadState): string {
  const f = d.field ? `${d.field.id}(${d.field.required ? "required" : "optional"},${d.field.timing})` : "-";
  return `msg#${s.userMessageCount} mode=${d.mode} field=${f} attempt=${d.attempt}`
    + `${d.intentFirst ? ` intentFirst=${d.intentFirst.id}` : ""}`
    + ` collected=[${d.collected.join(",")}] waiting=[${d.waiting.map(w => w.id).join(",")}]`
    + ` askedEnough=[${d.askedEnough.map(w => w.id).join(",")}] asks=${JSON.stringify(s.asks)}`;
}

// ── Prompt ───────────────────────────────────────────────────────────────────

/** Same sensitivity wording as the website chat (llamaService getSensitivityDescription). */
export function sensitivityDescription(fieldName: string, level: string): string {
  const descriptions: Record<string, string> = {
    'low': `LOW sensitivity — Ask for ${fieldName} when user shows ANY interest signal. This includes:
   - Browsing or exploring (asking about any product, service, course, program, category)
   - General inquiries about features, availability, eligibility, options
   - Asking about any specific item by name (e.g., "MBA", "iPhone 15", "yoga class")
   - Showing curiosity about what you offer
   Basically, if the user is asking about ANYTHING related to the business beyond small talk, that qualifies as intent.`,
    'medium': `MEDIUM sensitivity — Ask for ${fieldName} when user shows evaluating/comparison intent. This includes:
   - Asking about pricing, costs, fees, rates, charges
   - Comparing options ("which is better", "difference between")
   - Asking about discounts, offers, deals, promotions
   - Inquiring about availability of specific items
   - Requesting detailed information to make a decision
   Do NOT ask on general browsing or casual questions.`,
    'high': `HIGH sensitivity — Ask for ${fieldName} ONLY when user shows strong purchase/action intent. This includes:
   - Explicitly wanting to buy, order, purchase, or book
   - Wanting to apply, enroll, register, or sign up
   - Requesting to schedule an appointment or reserve a slot
   - Saying "I want to...", "I'd like to...", "How do I sign up for..."
   Do NOT ask on general inquiries, browsing, or even pricing questions.`
  };
  return descriptions[level] || descriptions['medium'];
}

function phoneRule(mode: PhoneValidationMode): string {
  switch (mode) {
    case "10": return "a 10-digit mobile number";
    case "12": return "a 12-digit number including the country code";
    case "8-12": return "a number with 8 to 12 digits";
    default: return "a complete phone number";
  }
}

function phoneProblemText(reason: PhoneValidationResult["reasonCode"] | null): string {
  switch (reason) {
    case "too_short": return "it has too few digits";
    case "too_long": return "it has too many digits";
    case "invalid_start": return "mobile numbers start with 6, 7, 8 or 9";
    default: return "it doesn't look like a real number";
  }
}

const label = (f: ChannelLeadField) => FIELD_LABEL[f.id];
const uniqueLabels = (fs: ChannelLeadField[]) => Array.from(new Set(fs.map(label)));
const KIND_LABEL: Record<LeadFieldKind, string> = { name: "name", email: "email address", phone: "phone number" };

function askBlock(d: LeadAskDecision, f: ChannelLeadField): string[] {
  const l = label(f);
  const lines: string[] = [];
  if (d.mode === "block") {
    lines.push(
      `NEXT DETAIL TO ASK FOR: ${l} (required)`,
      `- This detail is REQUIRED before you help further. Do NOT answer their question in this reply: acknowledge it in a few words, then ask for their ${l}.`,
      `- Ask ONLY for their ${l} — one short, warm question. Never ask for two details at once.`,
      `- As soon as they share it, thank them and answer their earlier question fully.`,
    );
    if (d.attempt >= MAX_ASKS_REQUIRED) {
      lines.push(`- You already asked once and they haven't shared it. Briefly explain why it helps (so the team can follow up with the right details), then ask ONE more time. If they still decline, the conversation continues without it — do not argue.`);
    }
  } else if (d.mode === "after_answer") {
    lines.push(
      `NEXT DETAIL TO ASK FOR: ${l} (optional)`,
      `- First answer the customer's message fully.`,
      `- Then, at the end of the same reply, ask once — politely — for their ${l}. Ask ONLY for this one detail.`,
      `- It is optional: if they decline or skip it, accept that and never ask for it again in this conversation.`,
    );
  } else if (d.mode === "intent") {
    lines.push(...intentBlock(f));
  }
  if (f.kind === "phone" && (d.mode === "block" || d.mode === "after_answer")) {
    lines.push(`- A valid number is ${phoneRule(f.phoneValidation)}. If they send a number that doesn't fit, ask them to check it.`);
  }
  return lines;
}

function intentBlock(f: ChannelLeadField): string[] {
  const l = label(f);
  return [
    `INTENT-BASED DETAIL: ${l} (${f.required ? "required" : "optional"} once the customer shows intent)`,
    sensitivityDescription(l, f.intentLevel),
    `- Judge the customer's CURRENT message against this threshold. Callback requests ("call me", "contact me") always count.`,
    f.required
      ? `- If it meets the threshold: do NOT answer yet — ask for their ${l} first (only this detail), then answer once they share it.`
      : `- If it meets the threshold: answer fully, then at the end ask once for their ${l} (only this detail).`,
    `- If it does not meet the threshold: just answer and do not ask for any contact details.`,
  ];
}

export interface LeadPromptOptions {
  channel: MessagingChannel;
  /** Name of a tool the model can call to save the name / email (omit when there is none). */
  captureTool?: string | null;
}

/** The lead-capture instruction for this reply ("" when no lead field is configured). */
export function buildChannelLeadPrompt(
  d: LeadAskDecision,
  s: ConversationLeadState,
  fields: ChannelLeadField[],
  opts: LeadPromptOptions,
): string {
  if (fields.length === 0) return "";
  const lines: string[] = [`📋 LEAD CAPTURE (Smart Lead Training) — follow this for your reply:`];

  const configuredKinds = new Set(fields.map(f => f.kind));
  const collected = d.collected.filter(k => configuredKinds.has(k));
  if (collected.length) {
    lines.push(`- Already have the customer's ${collected.map(k => KIND_LABEL[k]).join(", ")} — never ask for ${collected.length > 1 ? "these" : "this"} again.`);
  }
  if (d.askedEnough.length) {
    lines.push(`- Already asked in this conversation (not shared): ${uniqueLabels(d.askedEnough).join(", ")} — do NOT ask for ${d.askedEnough.length > 1 ? "these" : "this"} again; just help them.`);
  }
  if (opts.channel === "whatsapp") {
    lines.push(`- The customer's phone number is already known from WhatsApp — never ask for a phone, mobile or WhatsApp number.`);
  }
  if (opts.captureTool) {
    lines.push(`- When the customer shares their name or email address, call ${opts.captureTool} with it right away (partial details are fine), then continue the conversation.`);
  }

  if (d.mode === "fix_phone" && d.field) {
    const l = label(d.field);
    lines.push(
      ``,
      `NEXT DETAIL TO ASK FOR: ${l} (correction)`,
      `- The number the customer just sent is not a valid ${l} (${phoneProblemText(s.currentPhoneProblem)}). Do NOT thank them for it and do not repeat it back.`,
      `- Politely say it doesn't look right and ask ONCE for the correct number. A valid number is ${phoneRule(d.field.phoneValidation)}.`,
      `- If they don't send a correct number, carry on helping without it.`,
    );
  } else if (d.field && d.mode !== "none") {
    if (d.intentFirst) {
      const alt = d.intentFirst;
      lines.push(
        ``,
        `PRIORITY CHECK FIRST — ${label(alt)}:`,
        ...intentBlock(alt),
        `- If the customer's current message meets that threshold, follow the instruction above INSTEAD of the one below (one detail per reply). Otherwise ignore it and follow the instruction below.`,
      );
    }
    lines.push(``, ...askBlock(d, d.field));
  } else {
    const pending = d.waiting.filter(f => !d.collected.includes(f.kind));
    if (pending.length) {
      lines.push(`- No contact detail is due yet: do not ask for the customer's ${uniqueLabels(pending).join(", ")} in this reply — just help them.`);
    }
    if (s.justSharedContact && collected.length) {
      lines.push(`- The customer just shared their contact details. Thank them briefly, then answer what they asked earlier or ask how you can help. Do NOT bring up topics (fees, discounts, offers) they didn't ask about.`);
    }
  }
  return lines.join("\n");
}
