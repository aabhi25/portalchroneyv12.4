/**
 * Spoken reactions while a real answer is late — "Hmm, good question.", "Achha, theek hai.",
 * "Let me check that." — so a video avatar or a phone call reacts like a person instead of
 * going silent for 2-4 seconds.
 *
 * Which reaction fits depends on what the caller said (fillerKind):
 *   - lookup   a real question for a fact ("What's the premium for a family of 4?")
 *   - thinking advice / comparison ("Which plan is better for me?")
 *   - empathy  a problem or worry ("My claim got rejected")
 *   - ack      they told us something / answered our question ("I want health insurance")
 *   - repeat   "say that again" / "phir se batana" → "Haan ji, zaroor." (else 2-3 s of silence)
 *   - none     greetings, small talk, yes/no, "no thanks", "tell me in English", "can you hear
 *              me?", numbers — the answer is quick, and a filler there sounds absurd.
 * On phone calls a quick AI check may refine the kind (voice/fillerPicker.ts); these rules
 * decide when it is late, and they alone decide "never".
 *
 * Phrases: short, neutral, promise nothing ("I'll ask the team" could contradict the answer), in
 * the caller's language, mostly gender-neutral Hindi ("dekh lete hain") so they can never clash
 * with the voice. No "Hmm, good question." / "Umm…": a hesitation sound before an answer makes
 * the answer sound unsure (research, reports/Voice agent fillers and latency.md).
 * Never one of the call's last few phrases again (pickFiller); the answer after a filler drops
 * its own leading "Sure," / "Okay," so the two don't repeat (stripLeadingInterjection).
 *
 * PHONE CALLS use their own phrases (PHONE_PHRASES, style "phone"): turn-opening words that HOLD
 * the floor — "Achha, toh…", "Ji, dekhiye…", "Okay, so…" — said right after the caller's words are
 * understood, then the answer continues the same sentence (ElevenLabs gets them as previous_text).
 * Self-call recordings 2026-10-17: complete little sentences ("Got it.", "हाँ जी।", "Let me check
 * that.") followed by a 1-3 s wait sounded finished, so the caller started talking and the real
 * answer was cancelled — 3 of 4 calls. A person keeps the turn with "Achha… toh…" instead.
 */
import { isConversationMeta, smallTalkKind } from "../chatContext/smallTalk";

export type FillerLanguage = "en" | "hi";
export type FillerGender = "female" | "male" | null;
export type FillerKind = "lookup" | "thinking" | "empathy" | "ack" | "repeat";
export const FILLER_KINDS: FillerKind[] = ["lookup", "thinking", "empathy", "ack", "repeat"];

/**
 * A filler is spoken if no answer sentence exists this long after the end of speech was
 * DETECTED (server VAD reports it ~0.8 s after the visitor actually went quiet). Live Anam test
 * 2026-10-03: answers start 2.2–3.2 s after detection, so this only fills real waits.
 */
export const FILLER_AFTER_STOP_MS = 700;
/**
 * Video calls (Video call settings › Thinking sounds, off by default): like ElevenLabs' "soft
 * timeout", a sound only when the answer is still silent ~3 s after the visitor stopped — most
 * answers start before that, so most turns get none (live: answers start 1.9–3 s in).
 */
export const VIDEO_FILLER_AFTER_STOP_MS = 3000;
/** Video calls: the sound while the answer is prepared, when no lookup is running (no promise in it). */
const NEUTRAL_SOUNDS: Record<FillerLanguage, string[]> = {
  en: ["Hmm…", "Hmm, okay…"],
  hi: ["Hmm…", "Achha…"],
};
export function neutralSounds(language: FillerLanguage): string[] {
  return NEUTRAL_SOUNDS[language];
}
export function pickNeutralSound(language: FillerLanguage, recent?: string[] | null, rand: () => number = Math.random): string {
  const all = NEUTRAL_SOUNDS[language];
  const last = (recent || []).slice(-1)[0];
  const pool = all.filter((p) => p !== last);
  const choices = pool.length ? pool : all;
  return choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))];
}
/** A tool that looks something up (FAQ, products, courses, availability) — not saving a lead or ending the chat. */
export function isLookupTool(name: string): boolean {
  return /^(get_|search|find|lookup|check_|list_|fetch)/i.test(name.trim());
}
/**
 * Phone calls: the opening words come ~0.7 s after the end of speech was detected (just after the
 * transcript; ~1.5 s after the caller really stopped) unless the answer itself has started.
 * Later (1.2 s, 2026-10-16) only lengthened the silence the caller hears first.
 */
export const PHONE_FILLER_AFTER_STOP_MS = 700;
/** Phone calls, right after a turn that had opening words: the same (they are turn openers now). */
export const PHONE_FILLER_AGAIN_AFTER_STOP_MS = 700;
/** How many of the call's recent phrases are never repeated (pickFiller). */
export const FILLER_NO_REPEAT = 4;
/** …but never sooner than this after we start answering (lets a fast answer win). */
export const FILLER_MIN_DELAY_MS = 250;

type PhraseSet = { neutral: string[]; female?: string[]; male?: string[] };

// Romanised Hinglish for Hindi: ElevenLabs reads it naturally, for Devanagari or Hinglish transcripts alike.
const PHRASES: Record<FillerLanguage, Record<FillerKind, PhraseSet>> = {
  en: {
    lookup: { neutral: ["Let me check that.", "Sure, one moment.", "Okay, just a second.", "Alright, let me see.", "One sec, let me look."] },
    thinking: { neutral: ["Okay, so…", "Right, so…", "Sure, so…"] },
    empathy: { neutral: ["Oh, I understand.", "Oh, I see.", "Okay, I hear you."] },
    ack: { neutral: ["Okay, got it.", "Right, okay.", "Got it.", "Okay, sure."] },
    repeat: { neutral: ["Sure.", "Of course.", "Yes, sure."] },
  },
  hi: {
    lookup: { neutral: ["Haan, ek second.", "Ji, ek minute.", "Achha, dekh lete hain.", "Haan ji, bas ek second.", "Ek second, check kar lete hain."] },
    thinking: { neutral: ["Achha, dekhiye…", "Haan, dekhiye…", "Ji, dekhiye…"] },
    empathy: { neutral: ["Oh, achha.", "Achha… ji."], female: ["Ji, main samajh sakti hoon."], male: ["Ji, main samajh sakta hoon."] },
    ack: { neutral: ["Achha, theek hai.", "Haan ji.", "Ji, theek hai.", "Okay ji.", "Achha."] },
    repeat: { neutral: ["Haan ji, zaroor.", "Ji, bilkul.", "Ji zaroor."] },
  },
};

/**
 * Phone calls: words that open a turn and keep it ("…" / "—" = the voice carries on, it does not
 * end the sentence). Gender-neutral except Hindi first-person empathy.
 */
const PHONE_PHRASES: Record<FillerLanguage, Record<FillerKind, PhraseSet>> = {
  en: {
    lookup: { neutral: ["Okay, so…", "Right, so…", "Sure, so…", "Alright, so…", "Okay, let me see…"] },
    thinking: { neutral: ["Right, so…", "Okay, so…", "Sure, so…"] },
    empathy: { neutral: ["Oh, I'm sorry to hear that…", "Ah, I'm sorry…", "Oh, I see…"] },
    // (not "Okay, got it…": the voice adds a stray "it-" after it)
    ack: { neutral: ["Okay…", "Right…", "Alright…", "Okay, sure…"] },
    repeat: { neutral: ["Sure —", "Of course —", "Sorry —"] },
  },
  // No "Achha" before answering a question (it treats the question as news); "Arre, sorry ji" for
  // a problem; a repeat names what it is doing (research_notes/Natural phone openers/design_memo.md).
  hi: {
    lookup: { neutral: ["Ji, toh…", "Ji, dekhiye…", "Haan, toh…", "Haan ji, dekhiye…", "Toh dekhiye…"] },
    thinking: { neutral: ["Ji, dekhiye…", "Haan, dekhiye…", "Toh dekhiye…"] },
    empathy: { neutral: ["Arre, sorry ji…", "Oh, sorry ji…"], female: ["Ji, main samajh sakti hoon…"], male: ["Ji, main samajh sakta hoon…"] },
    ack: { neutral: ["Achha…", "Ji, theek hai…", "Haan ji, toh…", "Okay ji…", "Ji, toh…"] },
    repeat: { neutral: ["Ji, zaroor —", "Sorry ji —"], female: ["Ji, main phir se bolti hoon —"], male: ["Ji, main phir se bolta hoon —"] },
  },
};

/**
 * Phone calls: the very short reaction said ~0.7 s after the caller stops while a contextual
 * opener (voice/phoneOpener.ts) is still being written — "Ji… parents ke liye health insurance
 * chahiye, toh…" (the opener's own reaction word is then dropped).
 */
const PHONE_PARTICLES: Record<FillerLanguage, { question: string[]; info: string[] }> = {
  en: { question: ["Right…", "Sure…", "Okay…"], info: ["Okay…", "Right…", "Alright…"] },
  // No "Achha" before answering a question (it treats the question as news).
  hi: { question: ["Ji…", "Haan…", "Haan ji…"], info: ["Achha…", "Ji…", "Okay…"] },
};

export function phoneParticle(language: FillerLanguage, recent?: string[] | null, rand: () => number = Math.random, kind: FillerKind = "ack"): string {
  const set = PHONE_PARTICLES[language];
  const all = kind === "lookup" || kind === "thinking" ? set.question : set.info;
  const avoid = (recent || []).slice(-2);
  const choices = all.filter((p) => !avoid.includes(p));
  const pool = choices.length ? choices : all;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

export type FillerStyle = "avatar" | "phone";

/** Phrases for one reaction (gendered Hindi first-person forms only when the gender is known). */
export function fillerPhrasesFor(kind: FillerKind, language: FillerLanguage, gender: FillerGender, style: FillerStyle = "avatar"): string[] {
  const set = (style === "phone" ? PHONE_PHRASES : PHRASES)[language][kind];
  return [...set.neutral, ...(gender === "female" ? set.female ?? [] : gender === "male" ? set.male ?? [] : [])];
}

/** Every phrase for a language + gender (what a call prepares in advance). */
export function fillerPhrases(language: FillerLanguage, gender: FillerGender, style: FillerStyle = "avatar"): string[] {
  const phrases = FILLER_KINDS.flatMap((k) => fillerPhrasesFor(k, language, gender, style));
  return Array.from(new Set(style === "phone" ? [...PHONE_PARTICLES[language].question, ...PHONE_PARTICLES[language].info, ...phrases] : phrases));
}

const HINGLISH_MARKERS = /\b(kya|hai|hain|ho|mujhe|mera|meri|aap|aapka|aapki|kaise|kaisa|kitna|kitne|kitni|kab|kahan|kyun|nahi|nahin|chahiye|batao|bataiye|batana|bolo|boliye|bolna|phir|fir|dobara|karna|karo|karoge|sakte|milega|wala|wali|hoga|tha|thi|ka|ki|ke|ko|se|mein|bhi|aur|theek|thik|achha|accha|haan|ji|abhi|mat|lo|dena)\b/gi;

/**
 * Which language to react in: Devanagari or a clearly Hinglish sentence → Hindi phrases; plain
 * English → English; anything else (Tamil, Arabic…) → none (no phrase set). An explicit widget
 * language wins.
 */
export function fillerLanguage(transcript: string, selectedLanguage?: string | null): FillerLanguage | null {
  const sel = String(selectedLanguage || "").toLowerCase();
  if (sel === "hi") return "hi";
  if (sel === "en") return "en";
  if (sel && sel !== "auto") return null;
  const text = String(transcript || "");
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  if (/[^\u0000-ɏ\s\d.,!?'"()₹%&:;\-–—/@#+*]/.test(text)) return null;
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  const markers = (text.match(HINGLISH_MARKERS) || []).length;
  return words.length > 0 && markers >= 2 && markers / words.length >= 0.2 ? "hi" : "en";
}

const ABOUT_THE_CALL = new RegExp([
  String.raw`\b(can|could|do) you (hear|listen to|understand) me\b`,
  String.raw`\b(am i|i'?m) (audible|clear|loud enough)\b`,
  String.raw`\bare you (there|listening|still there|real|human|a (bot|robot|human|real person))\b`,
  String.raw`\b(what'?s|what is|tell me) your name\b`,
  String.raw`\b(who|what) are you\b`,
  String.raw`\b(do you know|what'?s|what is) my name\b`,
  String.raw`\b(awaaz|aawaz|avaaz) (aa rahi|aa raha|sunai)\b`,
  String.raw`\b(sun|sunai de) (rahe|rahi|raha|sakte|sakti)\b`,
  String.raw`\b(aapka|tumhara|aap ka) naam\b`,
  String.raw`(आवाज़|आवाज) (आ रही|सुनाई)|सुन (रहे|रही|पा रहे)|आपका नाम|आप कौन`,
].join("|"), "i");

/** "no", "not interested", "nahi chahiye", "busy hoon", "नहीं" — a quick reply follows, no filler. */
const DECLINE = new RegExp(String.raw`^(no+|nope|nah|na|nahi+|nahin|nai|mat|not (now|interested|really)|no,? thanks?|no thank you|i'?m (busy|not interested)|busy|later|baad mein|abhi nahi|nahi chahiye|interest nahi|नहीं|नही|मत|अभी नहीं)\b`, "i");
const NON_LETTER = new RegExp(String.raw`[^\p{L}\p{M}\s',]`, "gu");
/** "say that again", "pardon?", "phir se batana", "फिर से बताओ", "एक बार और" — they want it repeated. */
const REPEAT = new RegExp(String.raw`\b(repeat( that| it)?|say (that|it) again|tell me again|once again|one more time|come again|pardon|(phir|fir|ek baar) se (batao|bataiye|bata do|bolo|boliye|bolna|batana)|dobara (batao|bataiye|bolo|boliye|bolna|batana)|samajh nahi aaya)\b|(फिर से|दोबारा|एक बार और|एक बार फिर)\s*(बोलो|बोलिए|बताइए|बताओ|बोलना|बताना|बता दो|बोल दो)|समझ नहीं आया`, "i");
/** "call me later / tomorrow", "baad mein call karna", "बाद में कॉल करना" — a request, not a question. */
const CALLBACK = new RegExp(String.raw`\b(call (me )?(back|later|tomorrow|in the evening|after)|ring me later|baad (mein|me) (call|phone|baat)|kal (call|phone)|shaam ko (call|phone))\b|(बाद में|कल|शाम को) (कॉल|फोन|फ़ोन|बात)`, "i");
const EMPATHY = new RegExp(String.raw`\b(problem|issue|complain\w*|rejected|denied|not working|doesn'?t work|didn'?t (get|receive|work)|still waiting|delay(ed)?|refund|cheated|fraud|worried|worry|scared|upset|angry|frustrat\w*|disappointed|bad experience|lost|stolen|accident|hospital\w*|emergency|sick|ill|died|death|dikkat|pareshan\w*|samasya|galat|dhokha|nahi mila|nahi aaya|reject ho|parsani)\b|दिक्कत|परेशान|समस्या|गलत|धोखा|नहीं मिला|रिजेक्ट|अस्पताल|एक्सीडेंट`, "i");
const THINKING = new RegExp(String.raw`\b(which (one|plan|policy|course|option|is better)|better|best|recommend\w*|suggest\w*|should i|would you|compare|comparison|difference between|worth it|good option|right for me|konsa|kaunsa|kaun sa|kon sa|behtar|accha rahega|sahi rahega|kya karun|kya karna chahiye|salah)\b|कौन सा|बेहतर|सलाह|क्या करूँ|क्या करना चाहिए`, "i");
/** "…how are you?" anywhere in a short turn ("It's going good, how are you?") — small talk, no filler. */
const HOW_ARE_YOU_ANYWHERE = /\b(how are (you|u)|how r (you|u)|how'?s it going|how is it going|how have you been|how do you do|kaise (ho|hain|hai)|kya haal|aap kaise)\b|आप कैसे|कैसे हो|कैसे हैं|क्या हाल/i;
/** Asking for something without a question word ("Explain the MBA fees", "I want to know about the course"). */
const REQUEST = /\b(tell|explain|share|send|details?|information|info|want to know|know (more )?about|looking for|interested in|samjhao|samjha do|bhejo|bhej do|jaankari|jaanna|janna|jaanni|ke baare (mein|me))\b|जानकारी|जानना|जाननी|के बारे में|बताइए|बताओ|समझाओ|भेजो/i;
const QUESTION_WORD = new RegExp(String.raw`(\?|^(what|how|when|where|why|which|who|whom|whose|is|are|do|does|did|can|could|will|would|should|may)\b|\b(how (much|many|long)|what (is|are)|tell me|kya|kitna|kitne|kitni|kab|kahan|kaise|kyun|kyon|kaun|batao|bataiye|bata do|bata dijiye)\b|क्या|कितना|कितने|कितनी|कब|कहाँ|कैसे|क्यों|बताइए|बताओ)`, "i");

/**
 * The reaction that fits the caller's message, or null for "no filler". Phone calls also
 * react to short answers ("Health insurance." → "Achha, theek hai."); a video avatar keeps
 * the original rule (only real messages of 3+ words, always "let me check").
 */
/**
 * Turns that never get a reaction: numbers / codes, small talk ("how are you", "thank you"),
 * questions about the assistant or the connection, a decline. (Phone "repeat" requests are
 * handled before this in fillerKind.)
 */
export function isNoReactionTurn(transcript: string, lastAssistantText?: string | null): boolean {
  const text = String(transcript || "").trim();
  if (!text) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (/^[\d\s+()-]+$/.test(text) || /\d{6,}/.test(text.replace(/\s+/g, ""))) return true; // phone numbers, codes
  if (smallTalkKind(text, lastAssistantText ?? null)) return true; // "how are you", "thank you so much"
  if (/^(how are you|how r u|how are u|kaise ho|kaise hain|kya haal|aap kaise|what'?s up|who are you|what is your name|aap kaun)/i.test(text)) return true;
  if (words.length <= 10 && HOW_ARE_YOU_ANYWHERE.test(text)) return true;
  const plain = text.replace(/[’']/g, "'");
  if (!REPEAT.test(plain) && (ABOUT_THE_CALL.test(plain) || isConversationMeta(text))) return true;
  if (DECLINE.test(text.replace(NON_LETTER, " ").trim())) return true;
  return false;
}

export function fillerKind(input: { transcript: string; lastAssistantText?: string | null; phone?: boolean }): FillerKind | null {
  const text = String(input.transcript || "").trim();
  if (!text) return null;
  const words = text.split(/\s+/).filter(Boolean);
  if (/^[\d\s+()-]+$/.test(text) || /\d{6,}/.test(text.replace(/\s+/g, ""))) return null; // phone numbers, codes
  if (smallTalkKind(text, input.lastAssistantText ?? null)) return null; // "how are you", "thank you so much"
  if (/^(how are you|how r u|how are u|kaise ho|kaise hain|kya haal|aap kaise|what'?s up|who are you|what is your name|aap kaun)/i.test(text)) return null;
  if (words.length <= 10 && HOW_ARE_YOU_ANYWHERE.test(text)) return null;
  // About the assistant itself or the connection — "Let me check that." before "Yes, I can
  // hear you!" sounds absurd (seen in a live call, 2026-10-03).
  // Phone: "say that again" gets a quick "Haan ji, zaroor." (live call: 3.5 s of silence there).
  if (input.phone && REPEAT.test(text.replace(/[’']/g, "'"))) return "repeat";
  if (ABOUT_THE_CALL.test(text.replace(/[’']/g, "'")) || isConversationMeta(text)) return null;
  if (DECLINE.test(text.replace(NON_LETTER, " ").trim())) return null;
  // Video calls: the AI check decides (fillerPicker.ts); these rules stand in only when it is late,
  // so they say "let me check" only for an actual question or request ("It's going good." → none).
  if (!input.phone) return words.length >= 3 && (QUESTION_WORD.test(text) || REQUEST.test(text)) ? "lookup" : null;
  // "क्या तुम" / "what is" — a cut-off or too-short question: the reply asks them to say more, and
  // "Achha, theek hai." before "I didn't catch that" sounds wrong (live call 2026-10-16).
  if (words.length <= 2 && QUESTION_WORD.test(text)) return null;
  if (CALLBACK.test(text)) return "ack"; // "call me later, okay?" → "Achha, theek hai." (not "let me check")
  if (EMPATHY.test(text)) return "empathy";
  if (THINKING.test(text)) return "thinking";
  const devanagari = /[ऀ-ॿ]/.test(text);
  if (words.length >= 3 && (devanagari ? QUESTION_WORD.test(text.replace(/\?/g, "")) : QUESTION_WORD.test(text))) return "lookup";
  return "ack";
}

/** Should this turn get a filler if its answer is late? (video avatar rule; phone uses fillerKind) */
export function wantsFiller(input: { transcript: string; lastAssistantText?: string | null; lastTurnHadFiller?: boolean }): boolean {
  if (input.lastTurnHadFiller) return false;
  return fillerKind({ transcript: input.transcript, lastAssistantText: input.lastAssistantText }) !== null;
}

/**
 * A phrase of this kind that is none of the call's recent ones (`recent`: the last phrase, or the
 * call's phrases newest last — the last FILLER_NO_REPEAT are avoided), random among the rest.
 */
export function pickFiller(language: FillerLanguage, gender: FillerGender, recent?: string | string[] | null, rand: () => number = Math.random, kind: FillerKind = "lookup", style: FillerStyle = "avatar"): string {
  const all = fillerPhrasesFor(kind, language, gender, style);
  const avoid = (Array.isArray(recent) ? recent : recent ? [recent] : []).slice(-FILLER_NO_REPEAT);
  let choices = all.filter((p) => !avoid.includes(p));
  if (!choices.length) choices = all.filter((p) => p !== avoid[avoid.length - 1]);
  if (!choices.length) choices = all;
  return choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))];
}

/** How long to wait (from now) before speaking the filler. */
export function fillerDelayMs(stoppedAt: number | undefined, now: number = Date.now(), afterStopMs: number = FILLER_AFTER_STOP_MS): number {
  const due = (stoppedAt ?? now) + afterStopMs - now;
  return Math.max(FILLER_MIN_DELAY_MS, due);
}

const INTERJECTION = String.raw`(?:sure( thing)?|okay|ok|alright|all right|right|got it|great|perfect|absolutely|of course|well|so|oh|ah|i see|hmm+|umm+|achha|accha|acha|haan( ji)?|ha+n|ji( haan)?|okay ji|theek hai|thik hai|toh|dekhiye|bilkul|zaroor|बिल्कुल|ज़रूर|जरूर|हाँ( जी)?|हां( जी)?|जी( हाँ)?|अच्छा( जी)?|ठीक है|तो|देखिए|ओके)`;
const LEADING_INTERJECTION = new RegExp(String.raw`^(?:${INTERJECTION}(?:[,!.?।…\s—–-]+|$))+`, "iu");
const ONLY_INTERJECTIONS = new RegExp(String.raw`^\s*(?:${INTERJECTION}[\s,!.?।…—–-]*)+$`, "iu");

/**
 * After a filler ("Okay, so…"), drop the answer's own opening reaction ("Sure! We have…" →
 * "We have…") so the caller doesn't hear two in a row. Never empties a sentence (see
 * isOnlyInterjection for a sentence that is nothing but a reaction).
 */
export function stripLeadingInterjection(speech: string): string {
  const out = speech.replace(LEADING_INTERJECTION, "");
  if (!out.trim() || out.trim().length < 3) return speech;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** "Okay, great." / "Sure!" / "जी, बिल्कुल।" — a whole sentence that is only a reaction. */
export function isOnlyInterjection(speech: string): boolean {
  return ONLY_INTERJECTIONS.test(String(speech || ""));
}
