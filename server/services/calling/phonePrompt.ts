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
import { CALL_PURPOSE_MAX, DEFAULT_CALL_PURPOSE } from "@shared/aiCalling";

export const DEFAULT_ASSISTANT_LABEL = "the AI assistant";

export const DEFAULT_OUTBOUND_OPENING =
  "Hi {name}, this is {assistant}, an AI assistant from {business}. You'd enquired with us — is this a good time to talk for a minute?";
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
  /** The name the AI uses on calls (AI Calling settings), if the business set one. */
  assistantName?: string | null;
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
    ? `- YOU called this person on behalf of ${clean(input.businessName, 120) || "the business"} because they enquired with us. You already said the opening line (it is in the history). Never thank them for calling or "reaching out" — you called them.`
    : `- This person called ${clean(input.businessName, 120) || "the business"}. You already greeted them (it is in the history).`);
  lines.push("- You are an AI assistant. If you have not clearly said so yet, say it briefly within your next reply (\"I'm an AI assistant for the team\"). If asked whether you are a human or a robot, say honestly that you are an AI assistant.");
  lines.push("- Speak like a polite person on the phone: 1 or 2 short sentences per reply, then let them talk. Ask one question at a time.");
  lines.push("- Sound like a warm, real person on a call, not a script: everyday spoken words and contractions (\"we've\", \"you'll\", \"that's\"). When it fits, start with a short natural reaction in the reply's language — English: \"Right,\" \"Okay so,\" \"Oh, I see,\"; Hindi / Hinglish: \"Haan,\" \"Achha,\" \"Ji,\" — at most one per reply, and not the same one twice in a row. No \"hmm\" / \"umm\" before an answer (it sounds unsure), and no empty openers like \"आपकी बातें सुनकर अच्छा लगा\" / \"Great question\": answer what they asked.");
  lines.push("- Let feeling show in the words: glad when they're interested, sorry when something went wrong for them, calm and patient when they're confused or upset. Never sound like you are reading a list.");
  lines.push("- In Hindi, speak everyday spoken Hindi the way people talk on the phone in India, keeping common English words in English (plan, policy, premium, insurance, claim, course, fees, EMI). Avoid heavy formal words like \"आवश्यकताओं\", \"विकल्पों\", \"संबंधी\"; say \"aapko kya chahiye\" rather than \"aapki aavashyaktaayein\". In Hinglish, reply in natural Hinglish.");
  lines.push("- Plain spoken words only: no markdown, no lists, no links or URLs, no emojis, no symbols. Never read out a web address unless they ask for it.");
  lines.push("- Read numbers naturally (\"twenty-five thousand rupees\", phone numbers in small groups of digits).");
  lines.push("- When they give a phone number or email, repeat it back once to confirm it.");
  lines.push("- NEVER ask for their phone, mobile or WhatsApp number in any language: you are already talking to them on it. If the team needs to follow up, say the team will call them back on this same number (ask only for a good time if needed).");
  lines.push("- Never end the call in a reply that asks them something — wait for their answer first.");
  lines.push("- When they say yes or agree (\"okay\", \"haan\", \"le lo\", \"kar do\", \"sure\"), that is NOT a goodbye: confirm what they want in a few words and move it forward — ask the one detail the team needs next, or when the team should call them. End the call only when they say they're done or want to go.");
  lines.push("- Don't repeat something you already said in this call unless they ask you to repeat it. If they're unsure (\"I don't know\", \"aap batao\"), suggest the most common choice and ask one easy question (\"Family ke liye chahiye ya gaadi ke liye?\") instead of the same list again.");
  lines.push("- Introduce yourself only once in the call; don't say your name or company again in later replies.");
  lines.push("- Language: keep speaking the language of the call so far. A one- or two-word reply (\"Motor.\", \"Yes.\", \"मोटर\") is not a switch — only change language when they speak a full sentence in another language or ask you to.");
  lines.push("- Never invent prices, offers, dates or promises. If you don't know, say the team will confirm.");
  lines.push("- If they are busy, offer to call back and ask when suits them; then end the call with outcome callback_requested and the time.");
  if (input.direction === "outbound") {
    lines.push("- If they answer your opening question (\"is this a good time?\") with no / not now / busy (\"nahi\", \"abhi nahi\", \"नहीं\"), do NOT start pitching: say one warm line and ask once when to call back, in the call's language (English call: \"No problem — when should I call you back, this evening or tomorrow?\"; Hindi call: \"कोई बात नहीं जी — कब call करूँ, शाम को या कल?\"). If they give a time, end the call with outcome callback_requested and that time; if they just want to go, end it politely.");
  }
  lines.push("- If they ask your name or who you are, answer that in one short warm line" + (clean(input.assistantName, 60) ? ` (your name is ${clean(input.assistantName, 60)})` : "") + ", then continue the conversation naturally — do not repeat a question you already asked.");
  lines.push("- If they say they are not interested (\"nahi chahiye\", \"interest nahi hai\", \"not interested\"): say ONE warm line in the call's language (English call: \"No problem at all — have a good day!\"; Hindi call: \"Koi baat nahi ji, aapka din achha ho!\") and end the call with outcome not_interested. Do not pitch again or ask another question.");
  lines.push("- When they agree to go ahead (\"le lo\", \"kar do\", \"theek hai, aage badhao\", \"okay, go ahead\"): confirm in a few words and take the next step, in the call's language (English call: \"Great! I'll have the team send quotes — which car is it for?\"; Hindi call: \"Bahut badhiya ji! Toh team aapko quotes bhejegi — aapki gaadi kaunsi hai?\"). Never just repeat what you already told them.");
  lines.push("- Never reply with only a promise (\"मैं आपको बताती हूँ\", \"main batati hoon\", \"let me explain\"): say the actual thing in the same reply.");
  lines.push("- If the line is unclear or you didn't catch something, say so briefly and ask them to repeat.");
  lines.push(`- Keep the whole call under ${Math.max(1, input.maxCallMinutes)} minute${input.maxCallMinutes === 1 ? "" : "s"}.`);
  lines.push(`- Current date and time for the business: ${localTime(now, input.timezone)} (${input.timezone}). Use it to turn "tomorrow evening" into a real time.`);

  if (input.direction === "outbound") {
    lines.push("");
    lines.push("CALL PURPOSE (the business's words):");
    lines.push(clean(input.callPurpose, CALL_PURPOSE_MAX) || DEFAULT_CALL_PURPOSE);
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
  lines.push("");
  lines.push("HOW YOU SPEAK ON THIS CALL (most important — this is heard, not read):");
  lines.push("- At most 2 short sentences, about 30 words. Several options? Name 2 or 3 in one sentence and ask which they want — never read out a list or every detail.");
  lines.push("- When you speak Hindi (only when the caller does): talk the way people talk on the phone, mixing in the English words they use — keep business words in English (insurance, plan, cover, premium, claim) and use अलग-अलग (not विभिन्न), ज़रूरत (not आवश्यकता), बड़ी companies (not प्रमुख कंपनियाँ). When the call is in English, reply in English.");
  lines.push("- Never say \"I don't know\" / \"I don't have that information\": say the team will confirm that exact detail and call them back on this number.");
  lines.push("- Begin with at most a 1-3 word reaction that fits what they just did, in the language you are speaking, or none. Hindi/Hinglish: a question → \"Ji,\" or nothing · they told you something → their key word (\"Achha, parents ke liye —\") · a problem → \"Arre, sorry ji,\" · they agree → \"Bahut badhiya ji,\" · they refuse → \"Koi baat nahi ji,\" · they give a time to call back → \"Theek hai ji,\" (never \"koi baat nahi\" — nothing went wrong). English: a question → \"Right,\" or nothing · info → their key word (\"Okay, for your parents —\") · a problem → \"Oh, I'm sorry,\" · agree → \"Perfect,\" · refuse → \"No problem,\" · a time to call back → \"Sure,\". Never repeat their question back to them. Never start two replies in a row with the same word. Sound warm and end with one easy question.");
  lines.push("- Never write a list on a call. Asked what is covered / included? Name the 2-3 main things in ONE sentence (\"Third-party, own damage aur personal accident cover — teeno milte hain.\") and offer details on any one.");
  lines.push("- Use simple spoken words, not written Hindi: ये (not निम्नलिखित), usually (not आमतौर पर), के हिसाब से (not के अनुसार), देते हैं (not पेश/प्रदान करते हैं), खास (not विशेष).");
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


/**
 * Which phone tools to offer for THIS turn. gpt-4o-mini calls a tool on most turns when one is
 * offered — with only end_call / do_not_call left it called do_not_call after "Sure." and "मोटर"
 * (simulated calls, 2026-10-17), and every call is a second model round trip (+1-2 s). So each
 * tool is offered only when the caller's words point to it:
 *   do_not_call       they asked not to be called (the same check that guards the tool);
 *   end_call          goodbye / thanks / not interested / busy / call me later / wrong number;
 *   transfer_to_human they ask for a person;
 *   save_call_details the message may carry a detail (a name, email, number, time, budget, need).
 */
const ENDING = new RegExp(String.raw`\b(bye|goodbye|good bye|thanks?|thank you|thx|that'?s (all|it)|nothing else|no(,| )?(thanks|thank you)|not interested|no interest|not now|busy|later|tomorrow|call (me )?(back|later|tomorrow|after)|wrong (number|person)|stop|disconnect|hang up|cut the call|nahi chahiye|nahin chahiye|interest nahi|abhi nahi|baad (mein|me)|kal|shaam|busy hoon|galat number|dhanyavaad|dhanyawad|shukriya|bas|rakhta|rakhti|rakhiye|alvida)\b|नहीं चाहिए|अभी नहीं|(इंटरेस्ट|इंटरस्ट|रुचि|interest) नहीं|बाद में|कल|शाम|गलत नंबर|धन्यवाद|शुक्रिया|बस|बाय|थैंक|रखता|रखती|बिज़ी|बिजी`, "i");
const WANTS_PERSON = new RegExp(String.raw`\b(human|person|real person|agent|executive|representative|manager|someone|somebody|team member|advisor|customer care|insaan|aadmi|kisi se baat|baat karwa|connect me|transfer)\b|इंसान|किसी से बात|बात करवा|मैनेजर|एजेंट|एक्जीक्यूटिव`, "i");
const DETAIL = new RegExp(String.raw`\d|@|\b(my name|naam|i am|i'?m|main|mera|meri|budget|lakh|thousand|hazaar|hazar|rupees?|time|baje|morning|evening|subah|shaam|tomorrow|kal|need|want|chahiye|looking for|for my|ke liye)\b|नाम|मेरा|मेरी|बजे|लाख|हज़ार|हजार|चाहिए|के लिए`, "i");

export function phoneToolsForTurn(tools: any[], callerText: string, lastAssistantText?: string | null): any[] {
  const text = String(callerText || "").replace(/[’']/g, "'");
  const askedAnythingElse = /anything else|kuch aur|aur kuch|कुछ और|और कुछ/i.test(String(lastAssistantText || ""));
  const keep = (name: string): boolean => {
    switch (name) {
      case "do_not_call": return askedNotToBeCalled(text);
      case "end_call": return ENDING.test(text) || askedNotToBeCalled(text) || declinedToTalk(text, lastAssistantText) || (askedAnythingElse && /^\s*(no|nope|nahi|nahin|नहीं|that'?s it|bas)\b/i.test(text));
      case "transfer_to_human": return WANTS_PERSON.test(text);
      case "save_call_details": return DETAIL.test(text);
      default: return true;
    }
  };
  return tools.filter((t) => keep(String(t?.function?.name || "")));
}

/**
 * A turn that closes or redirects the call — goodbye / thanks / not interested / busy / call me
 * later / wrong number / don't call again / "give me a person". It gets one plain line, never a
 * live opener (seen: "अरे sorry जी, call नहीं करने की बात" before a do-not-call goodbye).
 */
export function isClosingTurn(callerText: string, lastAssistantText?: string | null): boolean {
  const text = String(callerText || "").replace(/[’']/g, "'");
  return ENDING.test(text) || askedNotToBeCalled(text) || WANTS_PERSON.test(text) || declinedToTalk(text, lastAssistantText);
}

/**
 * "Is this a good time to talk?" → "नहीं।" (live call 2026-10-17: the AI said "कोई बात नहीं जी"
 * and pitched anyway). A no to that question closes the turn: one warm line + when to call back.
 */
const ASKED_GOOD_TIME = /good time|right time|free to talk|talk for a minute|got a minute|baat kar sakte|time hai|sahi samay|बात कर सकते|समय है|सही समय|टाइम है/i;
// Only no-words ("नहीं।", "Nahi, abhi nahi.", "No, I'm busy right now") — not "नहीं, बताइए क्या है".
const NO_WORD = String.raw`(?:no+|nope|nah|not|now|really|right|nahi+n?|nahin|na|abhi|busy|i'?m|am|bit|a|little|thoda|sa|hoon|hu|ji|yaar|bhai|sir|madam|नहीं|ना|अभी|बिज़ी|बिजी|थोड़ा|हूँ|हूं|जी)`;
const ONLY_NO_WORDS = new RegExp(String.raw`^\s*(?:${NO_WORD}[\s,.!।]*)+$`, "i");
const HAS_NO = /\b(no+|nope|nah|not now|nahi+n?|nahin|busy)\b|नहीं|बिज़ी|बिजी/i;
export function declinedToTalk(callerText: string, lastAssistantText?: string | null): boolean {
  const t = String(callerText || "").replace(/[’']/g, "'");
  return !!lastAssistantText && ASKED_GOOD_TIME.test(lastAssistantText) && HAS_NO.test(t) && ONLY_NO_WORDS.test(t);
}

/**
 * The caller doesn't know what to pick ("पता नहीं, आईडिया नहीं है", "I'm not sure", "aap batao").
 * Seen live: the AI then read the same list of options a third time.
 */
const UNSURE = /\b(i don'?t know|dunno|not sure|no idea|you (tell|suggest)|what do you suggest|pata nahi+n?|idea nahi+n?|malum nahi+n?|maloom nahi+n?|samajh nahi+n? aa|aap (batao|bataiye|suggest)|aap hi batao)\b|पता नहीं|आइडिया नहीं|आईडिया नहीं|मालूम नहीं|मालुम नहीं|समझ नहीं|आप बताइए|आप बताओ|आप ही बता/i;
export function isUnsureCaller(callerText: string): boolean {
  return UNSURE.test(String(callerText || "").replace(/[’']/g, "'"));
}

/** The questions in a reply ("…हैं। आपको किस प्रकार का insurance चाहिए?" → that last sentence). */
export function questionsIn(text: string): string[] {
  return String(text || "").split(/(?<=[.!?।])\s+/).map((s) => s.trim()).filter((s) => s.endsWith("?") && s.length > 6);
}

/**
 * Extra per-turn guidance for the main model (appended to the phone rules for this reply only):
 * what the caller already said no to, the questions already asked on this call (never asked
 * again — live call 2026-10-17 asked "आपको किस प्रकार का insurance चाहिए?" four times), and what
 * to do when the caller is unsure.
 */
export function phoneTurnHints(input: { callerText: string; lastAssistantText?: string | null; askedQuestions?: string[] }): string | null {
  const hints: string[] = [];
  if (declinedToTalk(input.callerText, input.lastAssistantText)) {
    hints.push("They just said it is NOT a good time. Do not pitch or ask about their needs: one warm line, then ask only when to call them back.");
  }
  const asked = (input.askedQuestions || []).filter(Boolean).slice(-4);
  if (asked.length) {
    hints.push(`Questions you ALREADY asked on this call (do not ask them again, in any wording): ${asked.map((q) => `"${q}"`).join(" · ")}. If they still haven't answered, help them decide instead.`);
  }
  if (isUnsureCaller(input.callerText)) {
    hints.push("They are unsure what they need. Don't list the options again. In THIS reply (not later), suggest the most common choice in one short line and ask ONE easy question about their situation that they can answer in a word and that fits what they already told you (e.g. for health insurance: who it is for, or their age — not which kind of insurance again).");
  }
  return hints.length ? `THIS REPLY:\n- ${hints.join("\n- ")}` : null;
}

// ── Spoken-answer guards (live call 2026-10-17) ─────────────────────────────────────

/** Same meaning, different words: "kaunsa / kis / which / what" and "type / plan / tarah / kind". */
const Q_SYNONYMS: Array<[RegExp, string]> = [
  [/^(kaunsa|kaunse|kaunsi|kaun|kis|kin|which|what|कौन|कौनसा|कौन-सा|कौनसी|कौनसे|किस|किन)$/, "WHICH"],
  [/^(type|types|kind|kinds|sort|tarah|prakar|category|plan|plans|option|options|तरह|प्रकार|टाइप|प्लान|ऑप्शन)$/, "KIND"],
  [/^(chahiye|chahte|chahti|want|need|looking|considering|interested|चाहिए|चाहते|चाहती)$/, "WANT"],
];
const Q_STOP = new Set([
  "aap", "aapko", "aapka", "aapki", "aapke", "kya", "ka", "ki", "ke", "ko", "hai", "hain", "ho", "se", "mein", "ya", "aur", "toh", "to", "ji",
  "आप", "आपको", "आपका", "आपकी", "आपके", "क्या", "का", "की", "के", "को", "है", "हैं", "हो", "से", "में", "या", "और", "तो", "जी", "सा", "से",
  "you", "your", "the", "a", "an", "is", "are", "do", "does", "would", "like", "to", "for", "in", "of", "or", "and", "be", "it", "that", "this", "with", "about", "most", "specific",
]);
const Q_PUNCT = new RegExp(String.raw`[^\p{L}\p{M}\p{N}\s-]`, "gu");
function questionWords(q: string): Set<string> {
  const words = String(q || "").toLowerCase().replace(Q_PUNCT, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (const w of words) {
    if (Q_STOP.has(w)) continue;
    const syn = Q_SYNONYMS.find(([re]) => re.test(w));
    out.add(syn ? syn[1] : w);
  }
  return out;
}

/**
 * The question was already asked on this call (same content words, possibly reworded or in the
 * other language's words): "Aapko kaunsa insurance plan chahiye?" → "Aapko kis type ka insurance
 * chahiye?" → "What type of insurance are you considering?" were all one question, asked three
 * times. A question that adds new content ("…health plan — basic ya premium?") is a new one.
 */
export function repeatsAskedQuestion(question: string, asked: string[] | null | undefined): boolean {
  if (!/\?\s*$/.test(String(question || ""))) return false;
  const now = questionWords(question);
  if (now.size < 2) return false;
  return (asked || []).some((a) => {
    const before = questionWords(a);
    let shared = 0;
    now.forEach((w) => { if (before.has(w)) shared++; });
    return shared / now.size >= 0.75;
  });
}

/** "मैं आपको बताती हूँ।" / "Let me explain." — a promise to answer, with nothing in it. */
const PROMISE = /^(?:(?:अच्छा|तो|चलिए|देखिए|ठीक है|जी|achha|toh|to|chaliye|dekhiye|okay|ok|sure|right|so)[\s,।.!]*)*(?:मैं\s+(?:आपको\s+)?(?:बताती|बताता|समझाती|समझाता)\s+(?:हूँ|हूं)|main\s+(?:aapko\s+)?(?:batati|batata|samjhati|samjhata)\s+(?:hoon|hu|hun)|let me (?:tell|explain|walk you through|share)(?: (?:you|that|it))?|i(?:'ll| will) (?:tell|explain)(?: (?:you|that|it))?)[\s.!।…]*$/i;
export function isPromiseOnly(sentence: string): boolean {
  return PROMISE.test(String(sentence || "").trim());
}

/** "...toh aapko kis type…" / "…what type…" → a fresh sentence (the reply carried on from a filler). */
export function stripContinuationStart(speech: string): string {
  const m = /^\s*(?:\.{2,}|…)\s*(?:(?:toh|to|so|तो)\b[\s,]*)?/i.exec(String(speech || ""));
  if (!m || !m[0]) return speech;
  const rest = speech.slice(m[0].length);
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : rest;
}

// ── End of turn (2026-10-17) ─────────────────────────────────────────────────────────

/** Words a sentence doesn't end on ("मुझे वो…", "and…", "matlab…"). */
const TRAILING = new Set([
  "and", "or", "but", "so", "because", "the", "a", "an", "to", "of", "with", "for", "my", "your", "i", "i'm", "um", "uh", "umm", "like", "if", "that", "which",
  "और", "या", "लेकिन", "पर", "तो", "कि", "क्योंकि", "मतलब", "वो", "वह", "जो", "अगर", "के", "का", "की", "में", "से", "को", "मेरे", "मेरा", "मेरी", "मुझे", "मैं", "हम", "आप", "अं", "उम्म", "जैसे",
  "aur", "ya", "lekin", "par", "toh", "ki", "kyunki", "matlab", "wo", "woh", "jo", "agar", "ke", "ka", "mein", "se", "ko", "mera", "mere", "meri", "mujhe", "main", "hum", "aap", "jaise",
]);

/**
 * Does the caller's turn sound unfinished? Then the reply is prepared at once but held until a
 * little more silence confirms they are done (a 0.6 s silence used to cut off "क्या तुम…").
 */
export function soundsUnfinished(transcript: string): boolean {
  const t = String(transcript || "").trim();
  if (!t) return false;
  if (/(?:,|…|\.\.\.|-|—)\s*$/.test(t)) return true;
  const words = t.replace(/[.!?।]+$/, "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const last = words[words.length - 1].replace(/[,;:]+$/, "");
  if (!TRAILING.has(last)) return false;
  // A finished sentence may end on a pronoun in Hindi ("Health insurance का बता दो आप।" — held for
  // nothing on a live call): with a full stop / "?" only joining words count, unless it is the
  // only word ("मुझे।").
  if (/[.!?।]\s*$/.test(t) && words.length > 1 && PRONOUNS.has(last)) return false;
  return true;
}
const PRONOUNS = new Set(["i", "my", "your", "मुझे", "मैं", "हम", "आप", "मेरे", "मेरा", "मेरी", "वो", "वह", "mujhe", "main", "hum", "aap", "mera", "mere", "meri", "wo", "woh"]);
