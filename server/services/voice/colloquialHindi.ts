/**
 * Phone calls: everyday spoken Hindi instead of textbook Hindi, for what is SPOKEN (the saved
 * transcript keeps the AI's own words).
 *
 * The model is told to talk like people do on the phone, mixing in the English words they use,
 * but it still reaches for formal words ("विभिन्न बीमा योजनाएँ", "स्वास्थ्य बीमा") — seen on
 * live calls, 2026-10-16. These swaps are common, meaning-preserving and context-free; anything
 * not listed is spoken as written. List markers become commas so a list is read as one sentence.
 */
/** A whole Devanagari word only ("विशेष", never inside "विशेषज्ञ"). */
const word = (w: string) => new RegExp(`(?<![\\u0900-\\u097F])(?:${w})(?![\\u0900-\\u097F])`, "g");

const SWAPS: Array<[RegExp, string]> = [
  [/स्वास्थ्य बीमा/g, "health insurance"],
  [/मोटर बीमा/g, "motor insurance"],
  [/जीवन बीमा/g, "life insurance"],
  [/यात्रा बीमा/g, "travel insurance"],
  [/वाहन बीमा/g, "vehicle insurance"],
  [/बीमा योजनाओं/g, "insurance plans"],
  [/बीमा योजना(एँ|एं|यें)/g, "insurance plans"],
  [/बीमा योजना/g, "insurance plan"],
  [/बीमा कंपनियों/g, "insurance companies"],
  [/बीमा/g, "insurance"],
  [/योजनाओं/g, "plans"],
  [/योजना(एँ|एं|यें)/g, "plans"],
  [/योजना/g, "plan"],
  [/विभिन्न/g, "अलग-अलग"],
  [/विकल्पों/g, "options"],
  [/विकल्प/g, "option"],
  [/किस प्रकार के/g, "किस तरह के"],
  [/किस प्रकार का/g, "किस तरह का"],
  [/किस प्रकार की/g, "किस तरह की"],
  [/कई प्रकार के/g, "कई तरह के"],
  [/प्रकार के/g, "तरह के"],
  [/प्रकार का/g, "तरह का"],
  [/प्रकार की/g, "तरह की"],
  [/आवश्यकताओं/g, "ज़रूरतों"],
  [/आवश्यकता(एँ|एं)/g, "ज़रूरतें"],
  [/आवश्यकता/g, "ज़रूरत"],
  [/प्रमुख/g, "बड़ी"],
  [/जानकारी प्राप्त करने/g, "जानकारी लेने"],
  [/प्राप्त करने/g, "लेने"],
  [/प्राप्त कर सकते/g, "ले सकते"],
  [/संपर्क करें/g, "बात करें"],
  [/संपर्क करना/g, "बात करना"],
  [/सहायता/g, "मदद"],
  [/उपलब्ध/g, "available"],
  [/निःशुल्क|नि:शुल्क/g, "free"],
  [/शुल्क/g, "fees"],
  // Live call 2026-10-16: "आमतौर पर … निम्नलिखित कवरेज", "ज़रूरतों के अनुसार विभिन्न योजनाएँ पेश करते हैं".
  [/निम्नलिखित/g, "ये"],
  [/आमतौर पर|आम तौर पर|सामान्यतः|सामान्य तौर पर/g, "usually"],
  [/के अनुसार/g, "के हिसाब से"],
  [/पेश करते हैं/g, "देते हैं"],
  [/पेश करता है/g, "देता है"],
  [/प्रदान करते हैं/g, "देते हैं"],
  [/प्रदान करता है/g, "देता है"],
  [/प्रदान करती है/g, "देती है"],
  [/प्रदान कर/g, "दे"],
  [/कुछ विशेष/g, "कुछ खास"],
  [/विशेष रूप से/g, "खास तौर पर"],
  [word("विशेष"), "खास"],
  [/सुनिश्चित करें/g, "पक्का कर लें"],
  [word("सुनिश्चित"), "पक्का"],
  [word("लाभों"), "benefits"],
  [word("लाभ"), "फ़ायदा"],
  [/वर्तमान में/g, "अभी"],
  [/अधिक जानकारी/g, "और जानकारी"],
  [/कृपया/g, "please"],
  [/धन्यवाद/g, "thank you"],
  [/चयन करें/g, "चुनें"],
  [word("चयन"), "choose"],
  [word("अत्यधिक|अत्यंत"), "बहुत"],
  [word("केवल"), "बस"],
  [word("तत्काल"), "तुरंत"],
  [word("हेतु"), "के लिए"],
];

/** True when the text is mostly Devanagari (Hindi), so English answers are never touched. */
function isHindi(text: string): boolean {
  const deva = (text.match(/[ऀ-ॿ]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return deva > 0 && deva >= latin;
}

export function colloquialHindi(speech: string): string {
  if (!speech || !isHindi(speech)) return speech;
  let out = speech;
  for (const [re, to] of SWAPS) out = out.replace(re, to);
  // "जैसे: - A - B - C" → "जैसे A, B, C"
  out = out.replace(/:\s*[-•*]\s+/g, " ").replace(/\s+[-•*]\s+/g, ", ").replace(/\s{2,}/g, " ");
  return out;
}

/**
 * Phone calls in English: speech-to-text sometimes writes a short English reply in Devanagari
 * ("Motor." → "मोटर.", heard on every self-call, 2026-10-17), and the chat rules then answer in
 * Hindi. A reply made ONLY of common English words in Devanagari is written back in English;
 * anything else (real Hindi) is unchanged.
 */
const LOANWORDS: Record<string, string> = {
  "मोटर": "motor", "कार": "car", "बाइक": "bike", "हेल्थ": "health", "लाइफ": "life", "ट्रैवल": "travel", "ट्रेवल": "travel",
  "इंश्योरेंस": "insurance", "इन्शुरन्स": "insurance", "इंशोरेंस": "insurance", "प्लान": "plan", "प्लान्स": "plans", "पॉलिसी": "policy",
  "प्रीमियम": "premium", "क्लेम": "claim", "टर्म": "term", "फैमिली": "family", "फ़ैमिली": "family", "होम": "home", "यस": "yes",
  "येस": "yes", "नो": "no", "ओके": "okay", "ओक": "okay", "श्योर": "sure", "थैंक": "thank", "थैंक्स": "thanks", "यू": "you",
  "हेलो": "hello", "हैलो": "hello", "प्लीज़": "please", "प्लीज": "please", "राइट": "right", "फाइन": "fine", "गुड": "good",
};
export function englishFromDevanagari(text: string): string {
  const t = String(text || "").trim();
  if (!/[ऀ-ॿ]/.test(t)) return t;
  const words = t.replace(/[.,!?।]+$/, "").split(/[\s,]+/).filter(Boolean);
  if (!words.length || words.length > 4 || !words.every((w) => LOANWORDS[w])) return t;
  const out = words.map((w) => LOANWORDS[w]).join(" ");
  const end = /[?]$/.test(t) ? "?" : ".";
  return out.charAt(0).toUpperCase() + out.slice(1) + end;
}
