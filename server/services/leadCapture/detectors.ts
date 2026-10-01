/**
 * Small deterministic matchers for website-chat lead capture (English + Hindi/Hinglish).
 * No AI calls here: everything is regex/word lists so it is cheap and testable.
 */
import type { LeadFieldId } from './fields';

type Msg = { role: string; content: string };

// ─── Names ────────────────────────────────────────────────────────────────────

/** Words that are never (part of) a visitor's name. */
const JUNK_NAME_WORDS = new Set([
  'no', 'nop', 'nope', 'nah', 'na', 'none', 'nothing', 'never', 'nahi', 'nahin', 'nai', 'nhi',
  'why', 'what', 'when', 'where', 'who', 'how', 'kya', 'kyu', 'kyun', 'kaun', 'kaise', 'kab', 'kaha', 'kahan',
  'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'okk', 'k', 'sure', 'fine', 'haan', 'han', 'ha', 'haa', 'theek', 'thik', 'acha', 'accha', 'achha',
  'thanks', 'thank', 'ty', 'thx', 'shukriya', 'dhanyavad', 'dhanyawad',
  'hi', 'hii', 'hello', 'hey', 'hola', 'greetings', 'good', 'namaste', 'namaskar',
  'bye', 'goodbye', 'later', 'baad', 'abhi',
  'maybe', 'perhaps', 'dunno', 'idk', 'skip', 'pass', 'test', 'testing', 'asdf',
  'stop', 'wait', 'hold',
  'there', 'here', 'help', 'please', 'plz', 'pls', 'can', 'you', 'me', 'i', 'my', 'mine',
  'morning', 'afternoon', 'evening', 'night', 'day',
  'team', 'everyone', 'all', 'guys', 'folks', 'people',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'today', 'tomorrow', 'yesterday', 'tonight', 'now', 'soon', 'then',
  'absolutely', 'definitely', 'certainly', 'indeed', 'however', 'meanwhile',
  'anonymous', 'user', 'customer', 'visitor', 'guest', 'unknown', 'sir', 'madam', 'maam', "ma'am", 'mam', 'bhai', 'bro', 'dude',
  'name', 'naam', 'number', 'email', 'phone', 'mobile', 'whatsapp',
  'price', 'fees', 'fee', 'cost', 'details', 'info', 'information', 'course', 'courses', 'mba',
]);

/** Words that follow "I'm" / "main … hoon" in ordinary sentences but are not names. */
const NOT_A_NAME_START = new Set([
  'interested', 'looking', 'searching', 'trying', 'planning', 'thinking', 'wondering', 'asking', 'calling',
  'from', 'in', 'at', 'on', 'not', 'just', 'also', 'still', 'very', 'really', 'so', 'a', 'an', 'the',
  'student', 'working', 'employed', 'unemployed', 'fine', 'good', 'great', 'okay', 'ok', 'busy', 'new',
  'here', 'there', 'back', 'done', 'ready', 'confused', 'sorry', 'happy', 'sure', 'unable', 'able',
  'going', 'coming', 'getting', 'doing', 'feeling', 'currently', 'actually', 'basically', 'already',
  'theek', 'thik', 'badhiya', 'mast', 'khush', 'pareshan', 'yahan', 'wahan', 'bhi', 'to', 'toh', 'abhi', 'free', 'available',
]);

/** Words that end a name ("my name is Priya and I want…", "mera naam Rahul hai"). */
const NAME_STOP_WORDS = new Set([
  'and', 'i', 'im', 'from', 'here', 'want', 'wanted', 'need', 'looking', 'interested', 'my', 'is', 'am', 'the', 'a', 'to', 'for', 'with',
  'hai', 'he', 'h', 'hain', 'hoon', 'hu', 'hun', 'aur', 'or', 'ji', 'se', 'mein', 'me', 'ka', 'ki', 'ke', 'ko', 'please', 'pls', 'but',
  'है', 'और',
]);

/** Name-shaped and not junk: 1-4 words of letters (any script), no digits, not a sentence. */
export function isValidLeadName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = String(name).trim().replace(/\s+/g, ' ');
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (/[\d@#$%^&*_=+<>{}\[\]\\/|~`"?!:;]/.test(trimmed)) return false;
  if (!new RegExp(String.raw`^[\p{L}\p{M}][\p{L}\p{M}.' -]*$`, 'u').test(trimmed)) return false;
  const words = trimmed.toLowerCase().split(' ').filter(Boolean);
  if (words.length > 4) return false;
  if (words.some(w => JUNK_NAME_WORDS.has(w.replace(/[.']/g, '')))) return false;
  if (NOT_A_NAME_START.has(words[0])) return false;
  return true;
}

const titleCase = (s: string) => s.split(' ').map(w => /^[a-z]/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');

function takeNameWords(raw: string, max = 3): string | null {
  const words: string[] = [];
  for (const w of raw.trim().split(/\s+/)) {
    const clean = w.replace(/[,.!?;:]+$/g, '');
    if (!clean) break;
    if (NAME_STOP_WORDS.has(clean.toLowerCase())) break;
    words.push(clean);
    if (words.length >= max || clean !== w) break; // punctuation ends the name
  }
  return words.length ? words.join(' ') : null;
}

const LETTER = '[\\p{L}\\p{M}]';
const NAME_WORD = `${LETTER}[\\p{L}\\p{M}.'-]*`;
const NAME_PATTERNS: Array<{ re: RegExp; take?: 'words' }> = [
  // English: "my name is Rahul (Sharma)", "my name's …", "name is …", "name: …"
  { re: new RegExp(`(?:\\bmy name is|\\bmy name's|\\bname is|\\bname\\s*:)\\s*(${NAME_WORD}(?:\\s+${NAME_WORD}){0,3})`, 'iu'), take: 'words' },
  // Hinglish: "mera naam Rahul hai", "mera naam hai Rahul", "naam Rahul hai", "naam: Rahul"
  { re: new RegExp(`(?:\\b(?:mera|meraa|mere|my)\\s+naam(?:\\s+hai)?|^\\s*naam\\s*(?::|-|hai)?)\\s+(${NAME_WORD}(?:\\s+${NAME_WORD}){0,3})`, 'iu'), take: 'words' },
  // Devanagari: "मेरा नाम राहुल है"
  { re: new RegExp(String.raw`मेरा\s+नाम\s+(?:है\s+)?([\p{L}\p{M}]+(?:\s+[\p{L}\p{M}]+)?)`, 'u'), take: 'words' },
  // Whole message "I'm Rahul" / "hi, I am Rahul Sharma"
  { re: new RegExp(`^(?:(?:hi|hello|hey|namaste)[,!\\s]+)?(?:i am|i'm|im)\\s+(${NAME_WORD}(?:\\s+${NAME_WORD})?)\\s*[.!]?$`, 'iu') },
  // Hinglish "main Rahul hoon" / "mai Rahul Sharma hu" (anything may follow)
  { re: new RegExp(`^(?:(?:hi|hello|hey|namaste)[,!\\s]+)?(?:main|mai|mein)\\s+(${NAME_WORD}(?:\\s+${NAME_WORD})?)\\s+(?:hoon|hu|hun|hoo|hon)\\b`, 'iu') },
  // Devanagari "मैं राहुल हूँ"
  { re: new RegExp(String.raw`^(?:नमस्ते[,!\s]+)?मैं\s+([\p{L}\p{M}]+(?:\s+[\p{L}\p{M}]+)?)\s+(?:हूँ|हूं|हु|हूॅं)`, 'u') },
];

/** Name the visitor stated in this one message, or null. High precision. */
export function nameInMessage(text: string): string | null {
  const msg = String(text || '').trim();
  if (!msg) return null;
  for (const { re, take } of NAME_PATTERNS) {
    const m = msg.match(re);
    if (!m || !m[1]) continue;
    const candidate = take === 'words' ? takeNameWords(m[1]) : m[1].trim();
    if (!candidate) continue;
    const words = candidate.toLowerCase().split(/\s+/);
    if (words.some(w => NAME_STOP_WORDS.has(w))) continue;
    if (!isValidLeadName(candidate)) continue;
    return titleCase(candidate);
  }
  return null;
}

/**
 * High-precision "the visitor told us their name" check over the chat (latest first):
 * "my name is Rahul (Sharma)", "name: Rahul", "I'm Rahul", "mera naam Rahul hai", "main Rahul hoon".
 * Deliberately ignores "I am interested…", "I'm looking for…", "I am a student", "main theek hoon".
 */
export function nameStatedInHistory(history: Msg[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') continue;
    const n = nameInMessage(history[i].content);
    if (n) return n;
  }
  return null;
}

/** The assistant's latest message asked for the visitor's name ("May I have your name?", "aapka naam?"). */
export function assistantAskedForNameIn(text: string): boolean {
  return assistantAskedFields(text).has('name');
}

// ─── What did the assistant just ask for? ──────────────────────────────────────

const ASK_CUE = /\?|\b(share|provide|give|tell|send|drop|enter|type|mention|may i|could you|can you|would you|can i|please|let me know|what'?s|what is|batayein|bataiye|batao|bata dijiye|dijiye|de dijiye|dein|kya hai|kya h|chahiye|bhejiye|likhiye)\b|बताइए|बताएं|दीजिए|क्या है/i;
const ACK_CUE = /\b(thanks|thank you|thankyou|got (it|your)|noted|saved|received|for sharing|shukriya|dhanyavad|dhanyawad)\b|धन्यवाद|शुक्रिया/i;
const FIELD_ASK_PATTERNS: Record<LeadFieldId, RegExp[]> = {
  name: [
    /\b(your|ur)\s+(full\s+|good\s+|first\s+)?name\b/i,
    /\bwhat\s+should\s+i\s+call\s+you\b/i,
    /\bwho\s+am\s+i\s+(speaking|chatting|talking)\s+(with|to)\b/i,
    /\b(aapka|apka|aap\s+ka|apna|aapna|tumhara|tera)\s+(shubh\s+|poora\s+|pura\s+)?(naam|name)\b/i,
    /\bnaam\s+(kya|bata|bataye|batayein|bataiye|jaan)/i,
    new RegExp(String.raw`(आपका|अपना)\s+(शुभ\s+)?नाम`, 'u'),
  ],
  mobile: [
    /\b(your|ur|aapka|apka|aap\s+ka|apna)\s+(best\s+|10[-\s]?digit\s+|valid\s+|correct\s+)?(mobile|phone|contact|cell|cellphone)(\s+(number|no\.?|num))?\b/i,
    /\b(your|ur|aapka|apka|apna)\s+(10[-\s]?digit\s+|valid\s+|correct\s+)?(number|no\.)\b/i,
    /\b(mobile|phone|contact)\s+(number|no\.?)\b[^.!?]*\?/i,
    /\bnumber\s+(to|where|on which)\s+(i|we|our team)\s+can\s+(reach|call|contact)/i,
    /\b(reach|call|contact)\s+you\s+on\b/i,
    new RegExp(String.raw`(मोबाइल|फ़ोन|फोन)\s+(नंबर|नम्बर)`, 'u'),
  ],
  whatsapp: [
    /\b(your|ur|aapka|apka|apna)\s+whats\s?app(\s+(number|no\.?))?\b/i,
    /\bwhats\s?app\s+(number|no\.?)\b[^.!?]*\?/i,
    /\b(on|also)\s+whats\s?app\b[^.!?]*\?/i,
    /\bwhats\s?app\b[^.!?]*\b(same|this|that)\s+number\b/i,
    new RegExp(String.raw`व्हाट्सएप`, 'u'),
  ],
  email: [
    /\b(your|ur|aapka|apka|apna)\s+(best\s+|valid\s+|correct\s+)?(e-?mail|mail)(\s+(address|id))?\b/i,
    /\be-?mail\s+(address|id)\b[^.!?]*\?/i,
    new RegExp(String.raw`ईमेल`, 'u'),
  ],
};

/**
 * Fields the assistant asked the visitor for in this reply. Sentence-level: the sentence must
 * name the field AND read as a request (question mark / "share", "could you", "batayein"…), and
 * must not be a thank-you for something already given ("Thanks for sharing your name!").
 */
export function assistantAskedFields(text: string): Set<LeadFieldId> {
  const asked = new Set<LeadFieldId>();
  const sentences = String(text || '').split(new RegExp(String.raw`(?<=[.!?।\n])\s*`, 'u')).map(s => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    if (!ASK_CUE.test(sentence) || (ACK_CUE.test(sentence) && !/\?/.test(sentence))) continue;
    // "Thanks Rahul! Could you share your number?" — split already isolates the question.
    for (const id of Object.keys(FIELD_ASK_PATTERNS) as LeadFieldId[]) {
      if (FIELD_ASK_PATTERNS[id].some(re => re.test(sentence))) asked.add(id);
    }
  }
  // "your WhatsApp number" is a WhatsApp ask, not a separate mobile ask.
  if (asked.has('whatsapp') && asked.has('mobile') && !/\b(mobile|phone|cell)\b|मोबाइल|फोन|फ़ोन/i.test(text)) asked.delete('mobile');
  return asked;
}

// ─── Visitor declines ─────────────────────────────────────────────────────────

const DECLINE_START = new RegExp(String.raw`^(?:no|nope|nah|nahi|nahin|nai|nhi|na|naa|not now|not really|no thanks|no thank you|no thx|skip|pass|later|maybe later|baad\s*(?:me|mein|main)|abhi\s+(?:nahi|nhi|mat)|rehne\s+do|rahne\s+do|chhodo|chodo|chhod\s+do|nope|never|not interested|i'?m good|im good|no need|nahi\s+chahiye|नहीं|ना|बाद\s+में|रहने\s+दो)(?![\p{L}\p{M}])`, 'iu');
const DECLINE_ANYWHERE = [
  /\b(don'?t|do not|dont)\s+(want|wish|like)\s+to\s+(share|give|tell|provide|disclose)/i,
  /\b(i'?d|i would)\s+rather\s+not\b/i,
  /\b(prefer|preferring)\s+not\s+to\b/i,
  /\bnot\s+comfortable\s+(sharing|giving|telling|providing)/i,
  /\b(can'?t|cannot|won'?t|will not|wont)\s+(share|give|provide|tell|disclose)\b/i,
  /\bwhy\s+do\s+you\s+(need|want)\b/i,
  /\bnot\s+(going|gonna)\s+to\s+(share|give|tell)/i,
  /\bnone\s+of\s+your\s+business\b/i,
  /\b(mat|matt)\s+(poocho|pucho|puchho|puchiye|poochiye)\b/i,
  /\bnahi\s+(dena|dunga|dungi|denge|batana|batani|bataunga|bataungi|batayenge|bata\s+sakta|bata\s+sakti|share\s+karna|share\s+karunga|share\s+karungi|chahta|chahti)\b/i,
  /\b(number|naam|name|email|mail|mobile|phone)\s+(nahi|nhi|mat)\b/i,
  /\bkyu+n?\s+(chahiye|chaiye|chahie)\b/i,
  new RegExp(String.raw`मत\s+पूछ`, 'u'),
  new RegExp(String.raw`नहीं\s+(दूंगा|दूँगा|दूंगी|बताना|बताऊंगा|बताऊँगा)`, 'u'),
];

/** The visitor is refusing / deferring the contact request ("no", "not now", "skip", "nahi", "mat poocho", "why do you need it"). */
export function isDecline(message: string): boolean {
  const m = String(message || '').trim().toLowerCase().replace(/[“”"']/g, "'");
  if (!m) return false;
  if (DECLINE_START.test(m)) return true;
  return DECLINE_ANYWHERE.some(re => re.test(m));
}

const AFFIRM_START = new RegExp(String.raw`^(?:yes|yeah|yep|yup|ya|yah|yess|haan|han|haa|ha|ji|ji\s+haan|jee|sure|correct|right|same|same\s+number|it\s+is|yes\s+it\s+is|bilkul|absolutely|of\s+course|ok|okay|हाँ|हां|जी)(?![\p{L}\p{M}])`, 'iu');
/** "yes" / "haan" / "same number" — used to answer "is this number also on WhatsApp?". */
export function isAffirmative(message: string): boolean {
  const m = String(message || '').trim().toLowerCase();
  return AFFIRM_START.test(m) && !isDecline(m);
}

// ─── Keywords ─────────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Configured keywords that appear in the message as whole words (Unicode-aware, case-insensitive).
 * Multi-word keywords match across any whitespace; a plain s/es plural also matches ("fee" → "fees"),
 * but "price" never matches "priceless" and "fee" never matches "coffee".
 */
export function matchKeywords(message: string, keywords: string[] | null | undefined): string[] {
  const text = String(message || '').normalize('NFC');
  const hits: string[] = [];
  for (const kw of keywords || []) {
    const k = String(kw || '').trim().normalize('NFC');
    if (!k) continue;
    const body = k.split(/\s+/).map(escapeRe).join('\\s+');
    const plural = /[a-z]$/i.test(k) ? '(?:s|es)?' : '';
    const re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${body}${plural}(?![\\p{L}\\p{M}\\p{N}_])`, 'iu');
    if (re.test(text)) hits.push(kw);
  }
  return hits;
}

// ─── Callback requests ────────────────────────────────────────────────────────

const CALLBACK_PATTERNS = [
  /\bcall\s*me\b(?=\s*(?:$|[.!?,]|back\b|on\b|at\b|now\b|today|tomorrow|later|asap|please|pls|plz|sometime|when\b|after\b|before\b|in\b|between|around|\d|\+))/i, /\bcallback\b/i, /\bcall\s*back\b/i, /\bring\s*me\b/i, /\bcontact\s*me\b/i,
  /\breach\s*(out\s*(to\s*)?)?me\b/i, /\bhave\s+(someone|somebody|your\s+team|your\s+people)\s+call\b/i,
  /\bget\s+(in\s+)?touch\b/i, /\bgive\s*(me\s+)?a\s+call\b/i, /\bspeak\s+to\s+(someone|somebody|a\s+person)\b/i,
  /\btalk\s+to\s+(someone|somebody|a\s+person)\b/i, /\b(want|need)\s+a\s+call\b/i, /\bask\s+(your\s+)?(team|people)\s+to\s+call\b/i,
  /\b(mujhe\s+)?(call|phone)\s+(karo|kariye|karein|kar\s+do|kar\s+dena|kijiye|kar\s+lena)\b/i, /\bbaat\s+karni\s+hai\b/i,
];
export function hasCallbackIntent(message: string): boolean {
  return CALLBACK_PATTERNS.some(re => re.test(String(message || '')));
}

// ─── Email ────────────────────────────────────────────────────────────────────

export function isValidEmail(email: string | null | undefined): boolean {
  const e = String(email || '').trim();
  if (e.length < 6 || e.length > 254 || /\.\./.test(e)) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e);
}

export function emailInMessage(text: string): string | null {
  const m = String(text || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/);
  return m && isValidEmail(m[0]) ? m[0] : null;
}

// ─── Phone numbers inside free text ───────────────────────────────────────────

export interface PhoneCandidate { raw: string; digits: string; index: number }

const AMOUNT_OR_ID_BEFORE = /(?<![A-Za-z])(₹|rs\.?|inr|\$|usd|eur|€|£|budget|price|cost|fees?|salary|ctc|package|amount|pay|paid|order|ref|reference|invoice|booking|ticket|awb|tracking|(?:pin|zip|postal|promo|coupon|otp|referral)\s*code|pincode|otp|roll|registration|reg\.?|application|account|a\/c|acc|txn|transaction|\bid|marks|score|rank|year|batch|aadhaar|aadhar|pan|gst|serial|model|qty|quantity|lakh|lac|crore)\W*(?:(?:no\.?|number|num|#|id|is|was|of|=|around|about|approx\.?|upto|up to|under|below|above)\W*){0,3}$/i;
const AMOUNT_AFTER = /^\s*(\/-|rs\b|rupees|rupay|rupaye|inr|lakh|lakhs|lac|lacs|k\b|cr\b|crore|crores|million|thousand|hazaar|hazar|dollars|usd|%|percent|marks|km|kg|sq\.?\s*ft|sqft|per\s+(month|year|annum|sem|semester))/i;
const PHONE_CUE_BEFORE = /(\bmy\b|\bmera\b|\bmeri\b|\bmobile\b|\bphone\b|\bcontact\b|\bcell\b|whats\s?app|\bnumber\b|\bno\.|\bnum\b|\bph\b|\bcall\s+me\b|\breach\s+me\b|\bon\b)\W*(?:(?:no\.?|number|num|is|hai|h|:|-|=)\W*){0,3}$/i;
const DATE_LIKE = /^(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{4}\s*-\s*\d{2,4})$/;

/**
 * Digit runs that could be a phone number, skipping dates ("15-10-2026"), amounts
 * ("₹1500000", "budget 1500000", "15 lakh"), ids ("order 123456789", "#12345678", "ORD123456789")
 * and decimals. Runs inside alphanumeric tokens never match.
 */
export function extractPhoneCandidates(text: string): PhoneCandidate[] {
  const s = String(text || '');
  const out: PhoneCandidate[] = [];
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}#_])\+?\d[\d\s().-]{4,22}\d(?![\p{L}\p{N}_])`, 'gu');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 16) continue;
    if (DATE_LIKE.test(raw)) continue;
    if (/^\d+\.\d{1,2}$/.test(raw)) continue;
    const before = s.slice(Math.max(0, m.index - 28), m.index);
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 16);
    if (AMOUNT_OR_ID_BEFORE.test(before)) continue;
    if (AMOUNT_AFTER.test(after)) continue;
    out.push({ raw, digits, index: m.index });
  }
  return out;
}

const NUMERIC_QUESTION = /\b(budget|price|amount|fees?|salary|ctc|pin\s*code|pincode|zip|order|otp|code|year|age|marks|percentage|percent|score|quantity|how many|how much|kitna|kitni|kitne|date)\b/i;

/**
 * Is this message the visitor trying to give a phone number? True when the assistant just asked
 * for one, or the digits sit next to a phone cue ("my number is…", "mobile: …", "call me on …"),
 * or the whole message is basically one 8-15 digit number that isn't a round amount and wasn't an
 * answer to a numeric question (budget, pin code, order id…).
 */
export function looksLikePhoneAttempt(
  message: string,
  opts: { assistantAskedForPhone?: boolean; lastAssistantMessage?: string } = {},
): { attempt: boolean; candidates: PhoneCandidate[] } {
  const candidates = extractPhoneCandidates(message);
  if (candidates.length === 0) return { attempt: false, candidates };
  if (opts.assistantAskedForPhone) return { attempt: true, candidates };
  const s = String(message || '');
  for (const c of candidates) {
    const before = s.slice(Math.max(0, c.index - 28), c.index);
    if (PHONE_CUE_BEFORE.test(before) && !/\bon\W*$/i.test(before)) return { attempt: true, candidates };
    if (/\b(call|reach|contact|whats\s?app)\s+(me\s+)?on\W*$/i.test(before)) return { attempt: true, candidates };
  }
  const compact = s.replace(/[\s().+-]/g, '');
  if (/^\d{8,15}$/.test(compact) && !/000$/.test(compact) && !NUMERIC_QUESTION.test(opts.lastAssistantMessage || '')) {
    return { attempt: true, candidates };
  }
  return { attempt: false, candidates };
}
