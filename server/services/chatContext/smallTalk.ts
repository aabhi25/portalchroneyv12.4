/**
 * Small talk detection for the website chat: short greetings, thanks, goodbyes,
 * "how are you" and acknowledgements (English + Hinglish / Hindi) that carry no
 * question about the business. Such turns skip the knowledge search (query
 * embedding + FAQ / document / URL lookups) — nothing in the knowledge base can
 * help answer "hey wassup", and the search cost 0.7–2.3 s per message.
 *
 * Rules (deliberately strict — anything not on the lists searches as before):
 *   - at most 5 words, letters only (punctuation / emoji ignored, digits disqualify);
 *   - EVERY word must belong to a small-talk phrase below ("hi, what's the price?"
 *     has "what", "the", "price" → not small talk → searched);
 *   - acknowledgements alone ("ok", "great", "cool", "theek hai") are small talk only
 *     when the assistant's previous message did not ask something: "ok" after
 *     "Want me to share the fee details?" is a request for the details and keeps
 *     the history-aware search.
 */

// Multi-word phrases first so "thank you so much" wins over "thank you".
const GREETING = [
  'good morning', 'good afternoon', 'good evening', 'good day',
  'whats up', 'what s up', 'wats up', 'watsup', 'whatsup', 'wassup', 'wazzup', 'sup',
  'hi+', 'hii+', 'hey+', 'heya', 'hello+', 'helo+', 'hlo+', 'hallo', 'hola', 'hy', 'yo',
  'howdy', 'greetings', 'gm', 'namaste', 'namaskar', 'namaskaram', 'pranam', 'salaam', 'salam',
  'ram ram', 'jai shree krishna', 'sat sri akal', 'vanakkam',
  'नमस्ते', 'नमस्कार', 'प्रणाम', 'हेलो', 'हैलो', 'हाय', 'सुप्रभात', 'शुभ संध्या',
];
const HOW_ARE_YOU = [
  'how are you doing', 'how are you', 'how r u', 'how are u', 'how r you', 'how ru',
  'hows it going', 'how s it going', 'how is it going', 'how do you do', 'how you doing',
  'how is your day', 'hows your day', 'whats going on', 'what s going on',
  'aap kaise ho', 'aap kaise hain', 'aap kaise hai', 'tum kaise ho', 'kaise ho', 'kaise hain', 'kaise hai',
  'kese ho', 'kaisa hai', 'kaisi ho', 'kya haal hai', 'kya hal hai', 'kya haal', 'kya hal',
  'kya chal raha hai', 'sab theek', 'sab thik', 'sab badhiya', 'sab badiya', 'i am good', 'im good',
  'i am fine', 'im fine',
  'आप कैसे हैं', 'आप कैसे हो', 'कैसे हो', 'कैसे हैं', 'क्या हाल है', 'सब ठीक',
];
const THANKS = [
  'thank you so much', 'thank you very much', 'thanks a lot', 'thanks so much', 'thanks a ton',
  'thank you', 'thank u', 'thanku', 'thankyou', 'thanks', 'thank', 'thanx', 'thnx', 'thnks', 'thx', 'ty', 'tysm',
  'many thanks', 'much appreciated', 'appreciate it', 'dhanyavad', 'dhanyawad', 'dhanyavaad', 'shukriya', 'shukria',
  'धन्यवाद', 'शुक्रिया',
];
const BYE = [
  'good night', 'goodnight', 'good bye', 'goodbye', 'bye+', 'byee+', 'see you later', 'see you', 'see ya', 'cya',
  'take care', 'tata', 'alvida', 'gn', 'बाय', 'अलविदा',
];
// Words that may accompany any of the above ("hi there", "hello ji", "thanks bro").
const FILLER = [
  'there', 'ji', 'bro', 'bhai', 'buddy', 'dear', 'sir', 'maam', 'mam', 'madam', 'team', 'all', 'guys',
  'friend', 'dude', 'everyone', 'again', 'once again', 'very', 'so', 'much', 'a lot', 'and', 'oh', 'ah', 'ha', 'haha',
];
// Acknowledgements and one-word answers: small talk only when the assistant did not
// just ask something ("evening" may answer "When should we call you?").
const ACK = [
  'fine', 'good', 'morning', 'evening', 'later',
  'ठीक है', 'अच्छा', 'ओके',
  'okay', 'okk+', 'ok+', 'okie', 'k', 'kk', 'cool', 'great', 'nice', 'awesome', 'perfect', 'alright', 'all right',
  'got it', 'noted', 'theek hai', 'thik hai', 'theek', 'thik', 'achha', 'accha', 'acha', 'hmm+', 'hm+',
];

const toAlt = (list: string[]) => list.map(p => p.replace(/ /g, '\\s+')).join('|');
const ALL_PHRASE = `(?:${toAlt([...GREETING, ...HOW_ARE_YOU, ...THANKS, ...BYE, ...ACK, ...FILLER].sort((a, b) => b.length - a.length))})`;
const SMALL_TALK_RE = new RegExp(`^(?:${ALL_PHRASE}(?:\\s+|$))+$`, 'i');
const ACK_ONLY_RE = new RegExp(`^(?:(?:${toAlt([...ACK, ...FILLER].sort((a, b) => b.length - a.length))})(?:\\s+|$))+$`, 'i');
const GREETING_ONLY_RE = new RegExp(`^(?:(?:${toAlt([...GREETING, ...FILLER].sort((a, b) => b.length - a.length))})(?:\\s+|$))+$`, 'i');
const FILLER_ONLY_RE = new RegExp(`^(?:(?:${toAlt([...FILLER].sort((a, b) => b.length - a.length))})(?:\\s+|$))+$`, 'i');

export const SMALL_TALK_MAX_WORDS = 5;
// Unicode-aware (keeps Devanagari vowel signs); built with the constructor for the ES5 lib target.
const NON_WORD_RE = new RegExp('[^\\p{L}\\p{M}\\p{N}\\s]', 'gu');

/** Lower-case, apostrophes dropped ("what's" → "whats"), other punctuation / emoji → spaces. */
export function normalizeSmallTalk(message: string): string {
  return String(message || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(NON_WORD_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 'greeting' | 'ack' when the message is small talk that needs no knowledge search,
 * otherwise null. `lastAssistantMessage` = the assistant's previous reply (if any).
 */
export function smallTalkKind(message: string, lastAssistantMessage?: string | null): 'greeting' | 'ack' | null {
  const norm = normalizeSmallTalk(message);
  if (!norm || norm.length > 80 || /\d/.test(norm)) return null;
  if (norm.split(' ').length > SMALL_TALK_MAX_WORDS) return null;
  if (!SMALL_TALK_RE.test(norm) || FILLER_ONLY_RE.test(norm)) return null;
  if (ACK_ONLY_RE.test(norm) && !GREETING_ONLY_RE.test(norm)) {
    // "ok" / "great" answering a question the assistant asked → the visitor wants that
    // thing; keep the (history-aware) search for it.
    if (lastAssistantMessage && lastAssistantMessage.includes('?')) return null;
    return 'ack';
  }
  return 'greeting';
}

export function isSmallTalk(message: string, lastAssistantMessage?: string | null): boolean {
  return smallTalkKind(message, lastAssistantMessage) !== null;
}
