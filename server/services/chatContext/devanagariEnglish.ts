/**
 * English words spoken in Hindi and written in Devanagari ("प्लेसमेंट सपोर्ट", "फीस", "एडमिशन")
 * → the English words the business's content uses. Speech-to-text writes Hinglish callers'
 * English words this way, and a keyword search for "प्लेसमेंट" never finds an English FAQ about
 * "placement" (live call 2026-10-24: the AI then said there was no placement support, while the
 * FAQ said there was). The English words are added to the knowledge search query.
 */

const WORDS: Record<string, string> = {
  // education
  "एडमिशन": "admission", "एडमिशंस": "admissions", "प्रवेश": "admission", "प्लेसमेंट": "placement", "प्लेसमेंट्स": "placements",
  "सपोर्ट": "support", "असिस्टेंस": "assistance", "फीस": "fees", "फी": "fee", "शुल्क": "fee", "कोर्स": "course", "कोर्सेज": "courses",
  "कोर्सेस": "courses", "डिग्री": "degree", "डिप्लोमा": "diploma", "सर्टिफिकेट": "certificate", "सर्टिफिकेशन": "certification",
  "एमबीए": "mba", "बीबीए": "bba", "बीकॉम": "bcom", "एमकॉम": "mcom", "एमसीए": "mca", "बीसीए": "bca", "पीजीडीएम": "pgdm",
  "ऑनलाइन": "online", "ऑफलाइन": "offline", "डिस्टेंस": "distance", "एग्जाम": "exam", "एग्जाम्स": "exams", "परीक्षा": "exam",
  "सिलेबस": "syllabus", "करिकुलम": "curriculum", "स्पेशलाइजेशन": "specialization", "स्पेशलाइजेशंस": "specializations",
  "मार्केटिंग": "marketing", "फाइनेंस": "finance", "एचआर": "hr", "ऑपरेशंस": "operations", "बिजनेस": "business",
  "मैनेजमेंट": "management", "एनालिटिक्स": "analytics", "स्कॉलरशिप": "scholarship", "छात्रवृत्ति": "scholarship", "लोन": "loan",
  "ईएमआई": "emi", "इंस्टॉलमेंट": "installment", "किस्त": "installment", "डिस्काउंट": "discount", "ऑफर": "offer",
  "ड्यूरेशन": "duration", "सेमेस्टर": "semester", "क्लास": "class", "क्लासेज": "classes", "क्लासेस": "classes", "लेक्चर": "lecture",
  "लेक्चर्स": "lectures", "लाइव": "live", "रिकॉर्डेड": "recorded", "एलिजिबिलिटी": "eligibility", "योग्यता": "eligibility",
  "एलिजिबल": "eligible", "ग्रेजुएशन": "graduation", "ग्रेजुएट": "graduate", "अप्रूव्ड": "approved", "यूजीसी": "ugc",
  "एआईसीटीई": "aicte", "एक्रेडिटेशन": "accreditation", "एक्रेडिटेड": "accredited", "रैंकिंग": "ranking", "जॉब": "job",
  "जॉब्स": "jobs", "नौकरी": "job", "सैलरी": "salary", "पैकेज": "package", "करियर": "career", "कैरियर": "career",
  "इंटर्नशिप": "internship", "कैंपस": "campus", "हॉस्टल": "hostel", "डॉक्यूमेंट": "document", "डॉक्यूमेंट्स": "documents",
  "एप्लीकेशन": "application", "एप्लिकेशन": "application", "फॉर्म": "form", "डेडलाइन": "deadline", "रजिस्ट्रेशन": "registration",
  "काउंसलिंग": "counselling", "काउंसलर": "counsellor", "एलुमनाई": "alumni", "फैकल्टी": "faculty", "स्टडी": "study",
  "मटेरियल": "material", "असाइनमेंट": "assignment", "असाइनमेंट्स": "assignments", "प्रोजेक्ट": "project", "वर्किंग": "working",
  "प्रोफेशनल": "professional", "प्रोफेशनल्स": "professionals", "एलएमएस": "lms", "मेंटरशिप": "mentorship",
  // insurance
  "मोटर": "motor", "कार": "car", "बाइक": "bike", "हेल्थ": "health", "लाइफ": "life", "ट्रैवल": "travel", "ट्रेवल": "travel",
  "इंश्योरेंस": "insurance", "इन्शुरन्स": "insurance", "इंशोरेंस": "insurance", "प्लान": "plan", "प्लान्स": "plans",
  "पॉलिसी": "policy", "प्रीमियम": "premium", "क्लेम": "claim", "टर्म": "term", "कवर": "cover", "कवरेज": "coverage",
  "कैशलेस": "cashless", "हॉस्पिटल": "hospital", "रिन्यूअल": "renewal", "रिन्यू": "renew", "फैमिली": "family",
  // general business
  "प्राइस": "price", "रेट": "rate", "कॉस्ट": "cost", "चार्ज": "charge", "चार्जेस": "charges", "डिलीवरी": "delivery",
  "ऑर्डर": "order", "रिटर्न": "return", "रिफंड": "refund", "पेमेंट": "payment", "बुकिंग": "booking", "अपॉइंटमेंट": "appointment",
  "टाइमिंग": "timing", "टाइमिंग्स": "timings", "लोकेशन": "location", "एड्रेस": "address", "ब्रांच": "branch", "सर्विस": "service",
  "सर्विसेज": "services", "प्रोडक्ट": "product", "प्रोडक्ट्स": "products", "वारंटी": "warranty", "गारंटी": "guarantee",
  "फ्लैट": "flat", "विजिट": "visit", "साइट": "site", "अपार्टमेंट": "apartment", "बीएचके": "bhk",
};

// Nukta / spelling variants are matched without the nukta ("बिज़नेस" = "बिजनेस").
const key = (w: string) => w.normalize("NFC").replace(/़/g, "");
const LOOKUP = new Map(Object.entries(WORDS).map(([hi, en]) => [key(hi), en]));

/** English equivalents of the Devanagari-written English words in the text, in order, without repeats. */
export function englishTermsIn(text: string): string[] {
  const s = String(text || "");
  if (!/[ऀ-ॿ]/.test(s)) return [];
  const out: string[] = [];
  for (const word of s.split(/[^ऀ-ॿ]+/)) {
    const en = word && LOOKUP.get(key(word));
    if (en && !out.includes(en)) out.push(en);
  }
  return out;
}

/** The text with those English words appended (unchanged when there are none). */
export function withEnglishTerms(text: string): string {
  const en = englishTermsIn(text);
  return en.length ? `${text} ${en.join(" ")}` : text;
}
