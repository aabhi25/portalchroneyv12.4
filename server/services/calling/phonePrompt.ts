/**
 * AI Calling — what the AI is told on a phone call, the lines it says by itself, the
 * phone-only tools, and answering-machine detection. Pure functions (no I/O).
 *
 * The phone call runs through the same chat brain as website voice mode (knowledge, lead
 * capture, identity, reply-language policy, gender). This module adds the PHONE layer:
 * spoken style, the purpose of an outbound lead call, AI disclosure, and the tools that
 * end / hand over / record the call.
 */
import type { CallDirection, CallOutcome } from "@shared/aiCalling";
import { DEFAULT_CALL_PURPOSE } from "@shared/aiCalling";

export const DEFAULT_ASSISTANT_LABEL = "the AI assistant";

export const DEFAULT_OUTBOUND_OPENING =
  "Hi {name}, this is {assistant} from {business}. You'd enquired with us — is this a good time to talk for a minute?";
export const DEFAULT_INBOUND_GREETING =
  "Thanks for calling {business}, this is {assistant}, an AI assistant. How can I help?";
// Used when the business hasn't named its assistant (avoids "this is the AI assistant, an AI assistant").
const UNNAMED_OUTBOUND_OPENING =
  "Hi {name}, I'm an AI assistant calling from {business}. You'd enquired with us — is this a good time to talk for a minute?";
const UNNAMED_INBOUND_GREETING = "Thanks for calling {business}. I'm an AI assistant — how can I help?";

/** Outcomes the AI may set with end_call (do_not_call / transferred / voicemail have their own paths). */
export const AI_END_OUTCOMES: CallOutcome[] = [
  "interested",
  "callback_requested",
  "not_interested",
  "wrong_number",
  "info_given",
  "other",
];

export interface PhonePromptInput {
  direction: CallDirection;
  businessName: string;
  /** Lead's name (outbound) or the caller's saved name (inbound), if known. */
  customerName?: string | null;
  customerPhone?: string | null;
  /** What the lead wrote / asked about when they enquired. */
  leadMessage?: string | null;
  leadTopics?: string[] | null;
  leadEmail?: string | null;
  callPurpose?: string | null;
  /** Staff note for a manual call. */
  staffNote?: string | null;
  transferAvailable: boolean;
  maxCallMinutes: number;
  timezone: string;
  now?: Date;
  /** The business's lead form is used on this call (inbound / no lead): capture_lead is available. */
  leadCaptureOn: boolean;
}

function clean(value: unknown, max = 300): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** First name for a friendly greeting ("Rahul Sharma" → "Rahul"); null when unusable. */
export function greetingName(name: string | null | undefined): string | null {
  const n = clean(name, 80);
  if (!n || /^anonymous$/i.test(n) || /\d/.test(n)) return null;
  return n.split(" ")[0] || null;
}

/** Fill {name}, {business}, {assistant} in a business's line. */
export function fillPlaceholders(template: string, values: { name?: string | null; business: string; assistant?: string | null }): string {
  const name = greetingName(values.name);
  let text = template;
  // "Hi {name}," with no name → "Hi there,"; a {name} elsewhere just disappears.
  text = text.replace(/\b(hi|hello|hey|namaste)\s+\{name\}/gi, (_m, hi) => `${hi} ${name ?? "there"}`);
  text = text.replace(/\{name\}/gi, name ?? "");
  text = text.replace(/\{business\}/gi, clean(values.business, 120) || "our team");
  text = text.replace(/\{assistant\}/gi, clean(values.assistant, 60) || DEFAULT_ASSISTANT_LABEL);
  return text.replace(/\s+([,.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

export function buildOpeningLine(input: { direction: CallDirection; openingLine?: string | null; inboundGreeting?: string | null; customerName?: string | null; businessName: string; assistantName?: string | null }): { text: string; custom: boolean } {
  const custom = input.direction === "outbound" ? clean(input.openingLine, 400) : clean(input.inboundGreeting, 400);
  const named = !!clean(input.assistantName, 60);
  const template = custom || (input.direction === "outbound"
    ? (named ? DEFAULT_OUTBOUND_OPENING : UNNAMED_OUTBOUND_OPENING)
    : (named ? DEFAULT_INBOUND_GREETING : UNNAMED_INBOUND_GREETING));
  return {
    text: fillPlaceholders(template, { name: input.customerName, business: input.businessName, assistant: input.assistantName }),
    custom: !!custom,
  };
}

/** True when the line already tells the person they're talking to an AI. */
export function mentionsAi(text: string): boolean {
  return /\b(ai|a\.i\.|artificial intelligence|virtual assistant|automated assistant|bot)\b/i.test(text) || /एआई|ए\.आई\./.test(text);
}

function localTime(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: timezone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
    }).format(now);
  } catch {
    return now.toISOString();
  }
}

/** The phone layer of the instructions (goes last in the model's rules, after the voice/identity/language blocks). */
export function buildPhoneInstructions(input: PhonePromptInput): string {
  const now = input.now ?? new Date();
  const name = clean(input.customerName, 80);
  const lines: string[] = [];
  lines.push("📞 PHONE CALL MODE (this conversation is a live PHONE CALL; these rules override the response-length and formatting rules above):");
  lines.push(input.direction === "outbound"
    ? `- YOU called this person on behalf of ${clean(input.businessName, 120) || "the business"} because they enquired with us. You already said the opening line (it is in the history).`
    : `- This person called ${clean(input.businessName, 120) || "the business"}. You already greeted them (it is in the history).`);
  lines.push("- You are an AI assistant. If you have not clearly said so yet, say it briefly within your next reply (\"I'm an AI assistant for the team\"). If asked whether you are a human or a robot, say honestly that you are an AI assistant.");
  lines.push("- Speak like a polite person on the phone: 1 or 2 short sentences per reply, then let them talk. Ask one question at a time.");
  lines.push("- Plain spoken words only: no markdown, no lists, no links or URLs, no emojis, no symbols. Never read out a web address unless they ask for it.");
  lines.push("- Read numbers naturally (\"twenty-five thousand rupees\", phone numbers in small groups of digits).");
  lines.push("- When they give a phone number or email, repeat it back once to confirm it.");
  lines.push("- NEVER ask for their phone, mobile or WhatsApp number in any language: you are already talking to them on it. If the team needs to follow up, say the team will call them back on this same number (ask only for a good time if needed).");
  lines.push("- Never end the call in a reply that asks them something — wait for their answer first.");
  lines.push("- Never invent prices, offers, dates or promises. If you don't know, say the team will confirm.");
  lines.push("- If they are busy, offer to call back and ask when suits them; then end the call with outcome callback_requested and the time.");
  lines.push("- If the line is unclear or you didn't catch something, say so briefly and ask them to repeat.");
  lines.push(`- Keep the whole call under ${Math.max(1, input.maxCallMinutes)} minute${input.maxCallMinutes === 1 ? "" : "s"}.`);
  lines.push(`- Current date and time for the business: ${localTime(now, input.timezone)} (${input.timezone}). Use it to turn "tomorrow evening" into a real time.`);

  if (input.direction === "outbound") {
    lines.push("");
    lines.push("CALL PURPOSE (the business's words):");
    lines.push(clean(input.callPurpose, 1000) || DEFAULT_CALL_PURPOSE);
    const facts: string[] = [];
    if (name) facts.push(`name: ${name}`);
    if (input.customerPhone) facts.push(`phone: ${clean(input.customerPhone, 20)} (you already have it — never ask for it)`);
    if (input.leadEmail) facts.push(`email: ${clean(input.leadEmail, 120)}`);
    if (input.leadMessage) facts.push(`what they wrote when they enquired: "${clean(input.leadMessage, 500)}"`);
    if (input.leadTopics?.length) facts.push(`topics they were interested in: ${input.leadTopics.map((t) => clean(t, 60)).filter(Boolean).slice(0, 6).join(", ")}`);
    if (input.staffNote) facts.push(`note from the team for this call: "${clean(input.staffNote, 300)}"`);
    if (facts.length) {
      lines.push("");
      lines.push("ABOUT THE PERSON YOU CALLED:");
      for (const f of facts) lines.push(`- ${f}`);
    }
  } else if (input.customerPhone) {
    lines.push(`- The caller's number is ${clean(input.customerPhone, 20)} (you already have it — never ask for it).${input.leadCaptureOn ? " If you save their details with capture_lead, include this phone number." : ""}`);
    if (name) lines.push(`- We may already know them as ${name}; confirm politely before assuming.`);
  }

  lines.push("");
  lines.push("PHONE TOOLS:");
  if (!input.leadCaptureOn) {
    lines.push("- save_call_details: whenever they tell you something worth noting for the team (name correction, email, what they need, budget, preferred time…), save it.");
  }
  lines.push("- end_call: when the conversation is complete or they want to go, call end_call with the outcome (and callback_time if they asked to be called back), then say ONE short warm goodbye sentence. Never end the call in the middle of their question.");
  lines.push("- do_not_call: if they ask not to be called again (or to remove their number), call do_not_call, apologise briefly and say goodbye. Do not argue or try to sell.");
  if (input.transferAvailable) {
    lines.push("- transfer_to_human: if they ask for a person / human / team member, or you cannot help and they want to speak to someone, call transfer_to_human and say one short sentence that you are connecting them now.");
  } else {
    lines.push("- If they ask for a person, say the team will call them back, and end the call with outcome callback_requested.");
  }
  lines.push("- If it is the wrong person or wrong number, apologise, end the call with outcome wrong_number.");
  return lines.join("\n");
}

const CALLBACK_DESC = "When they asked to be called back, as an ISO 8601 date-time with timezone offset (e.g. 2026-10-05T18:00:00+05:30). Omit if not asked.";

/** OpenAI function tools offered on phone calls only. */
export function phoneTools(opts: { transferAvailable: boolean; leadCaptureOn: boolean }): any[] {
  const tools: any[] = [
    {
      type: "function",
      function: {
        name: "end_call",
        description: "End this phone call politely. Call it when the conversation is finished or the person wants to go. After calling it, say ONE short goodbye sentence — the call hangs up automatically after you finish speaking.",
        parameters: {
          type: "object",
          properties: {
            outcome: { type: "string", enum: AI_END_OUTCOMES, description: "What the call achieved." },
            note: { type: "string", description: "One short sentence for the team (what they want / next step)." },
            callback_time: { type: "string", description: CALLBACK_DESC },
          },
          required: ["outcome"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "do_not_call",
        description: "The person asked not to be called again / to remove their number. Records it so they are never called again, then ends the call after your short apology and goodbye.",
        parameters: { type: "object", properties: { note: { type: "string", description: "Optional: what they said." } } },
      },
    },
  ];
  if (opts.transferAvailable) {
    tools.push({
      type: "function",
      function: {
        name: "transfer_to_human",
        description: "Connect the caller to a person from the team. Use when they ask for a human / person, or you cannot help and they want to talk to someone. Say one short sentence that you're connecting them.",
        parameters: { type: "object", properties: { reason: { type: "string", description: "Why they want a person (short)." } } },
      },
    });
  }
  if (!opts.leadCaptureOn) {
    tools.push({
      type: "function",
      function: {
        name: "save_call_details",
        description: "Save details the person told you on this call for the team (only what they actually said).",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Their name, if they corrected or gave it." },
            email: { type: "string" },
            requirement: { type: "string", description: "What they need / are interested in." },
            budget: { type: "string" },
            preferred_time: { type: "string", description: "When they prefer to be contacted / visit." },
            notes: { type: "string", description: "Anything else important." },
          },
        },
      },
    });
  }
  return tools;
}

export const PHONE_TOOL_NAMES = new Set(["end_call", "do_not_call", "transfer_to_human", "save_call_details"]);

/** Lines the AI says by itself (no model call). `hi`/`hinglish` used when the call is in that language. */
export interface FixedLine { en: string; hi?: string; hinglish?: string }

export const PHONE_LINES = {
  stillThere: {
    en: "Are you still there?",
    hi: "क्या आप अभी भी लाइन पर हैं?",
    hinglish: "Kya aap abhi bhi line par hain?",
  },
  silenceGoodbye: {
    en: "I can't hear you, so I'll let you go for now. Our team will get back to you. Goodbye!",
    hi: "मुझे आपकी आवाज़ नहीं आ रही है, इसलिए अभी के लिए कॉल समाप्त करते हैं। हमारी टीम आपसे संपर्क करेगी। धन्यवाद!",
    hinglish: "Mujhe aapki awaaz nahi aa rahi, isliye abhi ke liye call rakhte hain. Hamari team aapse contact karegi. Thank you!",
  },
  wrapUpSoon: {
    en: "I'll need to wrap up in a moment — is there anything else quick I can help with?",
    hi: "मुझे थोड़ी देर में कॉल खत्म करनी होगी — क्या कोई और छोटी बात है जिसमें मैं मदद कर सकूँ?",
    hinglish: "Mujhe thodi der mein call khatam karni hogi — kya koi aur chhoti baat hai jismein main help kar sakoon?",
  },
  timeUpGoodbye: {
    en: "Thank you so much for your time. Our team will follow up with you. Goodbye!",
    hi: "आपके समय के लिए बहुत धन्यवाद। हमारी टीम आपसे आगे बात करेगी। नमस्ते!",
    hinglish: "Aapke time ke liye bahut thank you. Hamari team aapse aage baat karegi. Bye!",
  },
} satisfies Record<string, FixedLine>;

/** Simulator transfer: there is no real phone line to hand over. */
export function simulatorTransferLine(number: string): FixedLine {
  return { en: `In a real call you would now be connected to ${number}. This test call will end now.` };
}

// ── Answering machine / network message detection ──────────────────────────────────

const STRONG_VOICEMAIL = [
  "leave a message", "leave your message", "leave me a message", "leave your name", "record your message",
  "after the tone", "after the beep", "at the tone", "at the beep",
  "the number you have dialled", "the number you have dialed", "number you have called", "number you are trying",
  "you are trying to reach", "the subscriber", "is switched off", "has been switched off",
  "voicemail", "voice mail", "mailbox", "out of coverage", "not reachable at the moment", "is busy on another call",
  "please try again later", "please try later", "the person you are calling",
  // Hindi (Devanagari)
  "कृपया संदेश", "संदेश छोड़", "आप जिस नंबर", "जिस नंबर पर आप", "जिस नंबर से आप", "पहुंच से बाहर", "पहुँच से बाहर", "कृपया बाद में", "स्विच ऑफ",
  // Hinglish (Latin)
  "aap jis number", "jis number par", "jis number pe", "kripya sandesh", "kripaya sandesh", "pahunch se bahar", "kripya baad mein", "kripya thodi der baad",
];
const WEAK_VOICEMAIL = ["is not available", "not available right now", "currently unavailable", "not reachable", "unavailable", "उपलब्ध नहीं", "uplabdh nahi", "upalabdh nahin", "uplabdh nahin", "vyast hai", "व्यस्त है"];
const WEAK_CONTEXT = ["number", "subscriber", "try again", "later", "message", "tone", "beep", "नंबर", "बाद में", "kripya", "कृपया", "dial"];

/** True when a transcript sounds like an answering machine / operator message rather than a person. */
export function looksLikeVoicemail(transcript: string): boolean {
  const t = String(transcript || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (STRONG_VOICEMAIL.some((p) => t.includes(p))) return true;
  if (WEAK_VOICEMAIL.some((p) => t.includes(p)) && WEAK_CONTEXT.some((p) => t.includes(p))) return true;
  return false;
}

/** Parse the AI's callback_time; null when missing / unparseable / in the past (> 5 min) / absurdly far. */
export function parseCallbackTime(value: unknown, now = new Date()): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() < now.getTime() - 5 * 60_000) return null;
  if (d.getTime() > now.getTime() + 90 * 24 * 3600_000) return null;
  return d;
}

/**
 * Did the caller actually ask not to be called again? Guards the do_not_call tool — a wrong
 * do-not-call silently blocks a real customer, so the model's word alone is not enough.
 */
export function askedNotToBeCalled(recentCallerText: string): boolean {
  const t = String(recentCallerText || "").toLowerCase().replace(/[’']/g, "'");
  if (!t.trim()) return false;
  return /\b(don'?t|do not|never|stop|no more)\s+(call|calling|ring|phone|contact)/.test(t)
    || /\b(remove|delete|take off)\b.*\b(my )?(number|me)\b/.test(t)
    || /\b(unsubscribe|dnd|do not disturb|block (my|this) number)\b/.test(t)
    || /\b(call|phone|fon)\s+(mat|na|nahi|nahin)\s+(karo|karna|kijiye|karein|kare)\b/.test(t)
    || /\b(mat|na)\s+(call|phone)\s+(karo|karna|kijiye|karein)\b/.test(t)
    || /\b(dobara|phir se|fir se|aage se)\b.*\b(call|phone)\b.*\b(mat|nahi|nahin|na)\b/.test(t)
    || /\bnumber\s+(hata|hatao|hata do|delete kar)/.test(t)
    || /(कॉल|फोन|फ़ोन)\s*(मत|ना|न)\s*(करो|करें|कीजिए|करना)/.test(t)
    || /(मत|ना)\s*(कॉल|फोन|फ़ोन)\s*(करो|करें|कीजिए|करना)/.test(t)
    || /(दोबारा|फिर से|आगे से).*(कॉल|फोन|फ़ोन).*(मत|नहीं|न)/.test(t)
    || /नंबर\s*(हटा|डिलीट)/.test(t);
}

