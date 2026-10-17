/**
 * AI Calling — shared vocabulary (server + client).
 *
 * The AI phones leads (and answers the business's number) using the same brain as the
 * website chat / WhatsApp: the business's training, lead fields, reply-language policy,
 * identity and voice. A telephony provider (Exotel or Plivo) carries the call; until a
 * business adds its provider keys it can use the in-browser "simulator" provider, which
 * rings in the portal and runs the exact same call pipeline.
 */

export type CallProviderId = "exotel" | "plivo" | "simulator";
export const CALL_PROVIDERS: CallProviderId[] = ["exotel", "plivo", "simulator"];
/** Real phone companies (everything except the in-portal simulator). */
export const REAL_CALL_PROVIDERS: CallProviderId[] = ["exotel", "plivo"];

/** A stored / requested provider id → a known one (anything unknown = the simulator). */
export function normalizeCallProvider(value: unknown): CallProviderId {
  return value === "exotel" || value === "plivo" ? value : "simulator";
}

export const CALL_PROVIDER_LABELS: Record<CallProviderId, string> = { exotel: "Exotel", plivo: "Plivo", simulator: "Test mode" };

export type CallDirection = "outbound" | "inbound";

/** Lifecycle of one call attempt. Terminal: completed, no_answer, busy, failed, voicemail, cancelled, skipped. */
export type CallStatus =
  | "queued"      // waiting for its time (delay / calling hours / retry gap / concurrency)
  | "dialing"     // handed to the provider
  | "ringing"
  | "in_progress" // answered, AI is talking
  | "completed"   // answered and finished
  | "no_answer"
  | "busy"
  | "failed"
  | "voicemail"   // an answering machine picked up
  | "cancelled"   // staff cancelled before it was placed
  | "skipped";    // never placed: do-not-call, no consent, limit reached… (reason in end_reason)

export const TERMINAL_CALL_STATUSES: CallStatus[] = ["completed", "no_answer", "busy", "failed", "voicemail", "cancelled", "skipped"];
export const LIVE_CALL_STATUSES: CallStatus[] = ["dialing", "ringing", "in_progress"];

export const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  queued: "Waiting to call",
  dialing: "Dialling",
  ringing: "Ringing",
  in_progress: "On the call",
  completed: "Finished",
  no_answer: "No answer",
  busy: "Busy",
  failed: "Could not connect",
  voicemail: "Voicemail",
  cancelled: "Cancelled",
  skipped: "Not called",
};

/** What the conversation achieved (set by the AI's end_call tool and/or post-call analysis). */
export type CallOutcome =
  | "interested"
  | "callback_requested"
  | "not_interested"
  | "wrong_number"
  | "do_not_call"     // asked never to be called again → added to the do-not-call list
  | "transferred"     // handed to a person
  | "voicemail"
  | "no_answer"
  | "info_given"      // questions answered, no clear next step
  | "other";

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  interested: "Interested",
  callback_requested: "Call back later",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
  do_not_call: "Asked not to be called",
  transferred: "Passed to your team",
  voicemail: "Voicemail",
  no_answer: "No answer",
  info_given: "Questions answered",
  other: "Other",
};

/** Why a call was created. */
export type CallTrigger = "auto_lead" | "manual" | "retry" | "callback" | "audience" | "inbound" | "test";

/**
 * Consent rule for AUTOMATIC calls (manual "Call now" by staff is the staff member's decision):
 *  - explicit: only leads whose call_consent = 'yes' (they asked for / agreed to a call);
 *  - business_attested: every lead with a phone number — the business confirmed (with a
 *    timestamp) that its lead forms/chats tell people they may be called.
 */
export type CallConsentMode = "explicit" | "business_attested";

export interface CallingHours {
  /** "HH:MM" 24h, business timezone. */
  start: string;
  end: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  timezone: string;
}

/** The business's AI Calling settings as the API returns them (secrets masked). */
export interface AiCallingSettingsView {
  enabled: boolean;
  provider: CallProviderId;
  exotel: {
    accountSid: string | null;
    subdomain: string;           // e.g. "api.in.exotel.com"
    callerId: string | null;     // ExoPhone (virtual number) shown to the customer
    flowAppId: string | null;    // optional call flow (Voicebot → Connect) used for transfers
    apiKeySet: boolean;
    apiKeyMask: string | null;   // "••••abcd"
    apiTokenSet: boolean;
    apiTokenMask: string | null;
    verifiedAt: string | null;
  };
  plivo: {
    authId: string | null;       // Plivo console → Auth ID
    number: string | null;       // Plivo number shown to the customer (+E.164)
    authTokenSet: boolean;
    authTokenMask: string | null;
    verifiedAt: string | null;
  };
  /**
   * Where to point the provider (shown in settings): Exotel inbound Voicebot URL + status webhook;
   * Plivo: the Answer URL of the Plivo Application the number is attached to.
   */
  setup: { inboundStreamUrl: string | null; statusCallbackUrl: string | null; plivoAnswerUrl: string | null };
  autoCallLeads: boolean;
  autoCallDelayMinutes: number;
  /** Lead sources that get an automatic call; empty = all. Values: 'website' | 'whatsapp' | 'instagram' | 'facebook' | 'voice' | 'form' | 'import' | 'other'. */
  autoCallSources: string[];
  consentMode: CallConsentMode;
  consentAttestedAt: string | null;
  callingHours: CallingHours;
  maxAttempts: number;
  retryGapMinutes: number;
  maxCallMinutes: number;
  monthlyMinuteLimit: number | null;
  concurrentCallLimit: number;
  recordCalls: boolean;
  transferNumber: string | null;
  /** What the AI should achieve on a lead call (business's words). */
  callPurpose: string;
  /** Optional custom first line; placeholders {name}, {business}, {assistant}. */
  openingLine: string | null;
  inboundGreeting: string | null;
  /** The name the AI uses on calls ("this is Anika, an AI assistant from …"); null = unnamed. */
  assistantName: string | null;
  /** Speaking speed on calls, percent of normal (CALL_SPEAKING_SPEEDS). */
  speakingSpeed: number;
  /** A quiet background sound under the call. */
  backgroundSound: CallBackgroundSound;
  whatsappFollowUp: boolean;
  whatsappFollowUpTemplateId: string | null;
  updatedAt: string | null;
}

export type CallBackgroundSound = "none" | "call_centre";
export const CALL_BACKGROUND_SOUNDS: CallBackgroundSound[] = ["none", "call_centre"];
/** Speaking speeds offered in settings (percent of the voice's normal speed). */
export const CALL_SPEAKING_SPEEDS = [80, 85, 90, 95, 100, 105] as const;
export const DEFAULT_SPEAKING_SPEED = 90;
/** An assistant name: letters (any script), spaces, dots, apostrophes, hyphens — "Anika", "अनिका". */
export const ASSISTANT_NAME = new RegExp(String.raw`^[\p{L}\p{M}][\p{L}\p{M} .'-]*$`, "u");

export const DEFAULT_CALLING_HOURS: CallingHours = { start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5, 6], timezone: "Asia/Kolkata" };

export const DEFAULT_CALL_PURPOSE =
  "Thank them for their enquiry, understand what they need, answer their questions from what you know about the business, " +
  "and if they are interested, confirm the best time for the team to follow up.";

/** Limits enforced by the server (UI uses them for inputs). */
export const CALL_LIMITS = {
  autoCallDelayMinutes: { min: 0, max: 1440, default: 2 },
  maxAttempts: { min: 1, max: 5, default: 3 },
  retryGapMinutes: { min: 15, max: 2880, default: 120 },
  maxCallMinutes: { min: 1, max: 30, default: 5 },
  concurrentCallLimit: { min: 1, max: 20, default: 2 },
} as const;

/** One call as the API lists it. */
export interface AiCallView {
  id: string;
  direction: CallDirection;
  status: CallStatus;
  trigger: CallTrigger;
  provider: CallProviderId;
  phone: string;
  leadId: string | null;
  leadName: string | null;
  attempt: number;
  scheduledAt: string | null;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  outcome: CallOutcome | null;
  summary: string | null;
  endReason: string | null;
  hasRecording: boolean;
  conversationId: string | null;
  createdAt: string;
}

/** Normalise an Indian / international number to E.164-ish digits with a leading "+". Returns null if unusable. */
export function normalizeCallPhone(raw: unknown, defaultCountryCode = "91"): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  let s = String(raw).trim();
  const hadPlus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (!s) return null;
  if (!hadPlus) {
    if (s.startsWith("00")) s = s.slice(2);
    else if (s.length === 11 && s.startsWith("0")) s = defaultCountryCode + s.slice(1);
    else if (s.length === 10) s = defaultCountryCode + s;
  }
  if (s.length < 10 || s.length > 15) return null;
  return `+${s}`;
}
