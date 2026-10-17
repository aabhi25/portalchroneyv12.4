/**
 * Phone calls: Hindi written in Roman letters ("Koi baat nahi ji! Aapko jab bhi insurance ki
 * zaroorat ho…") is read by the voice with an English accent. Before such a sentence is spoken its
 * Hindi words are written in Devanagari, English words kept as they are ("कोई बात नहीं जी! आपको जब
 * भी insurance की ज़रूरत हो…"), so the voice pronounces the Hindi as Hindi (live call 2026-10-17).
 *
 * A fixed word list, not a model: instant and never changes a word (a gpt-4o-mini rewrite took
 * 1.1-1.5 s per sentence and wrote "करungi"). Words it doesn't know stay in Roman letters.
 */

// Roman Hinglish → Devanagari. Only words that are not also everyday English words ("to", "me",
// "the", "is", "so" are left out on purpose).
const WORDS: Record<string, string> = {
  hai: "है", hain: "हैं", ho: "हो", hoon: "हूँ", hu: "हूँ", hun: "हूँ", tha: "था", thi: "थी", thin: "थीं",
  nahi: "नहीं", nahin: "नहीं", nahii: "नहीं", nai: "नहीं", mat: "मत",
  kya: "क्या", kyun: "क्यों", kyon: "क्यों", kaise: "कैसे", kaisa: "कैसा", kaisi: "कैसी", kab: "कब", kahan: "कहाँ", kaun: "कौन", kaunsa: "कौन-सा", kaunsi: "कौन-सी", kaunse: "कौन-से",
  kitna: "कितना", kitne: "कितने", kitni: "कितनी", kis: "किस", kisi: "किसी", kuch: "कुछ", koi: "कोई",
  aap: "आप", aapka: "आपका", aapki: "आपकी", aapke: "आपके", aapko: "आपको", aapse: "आपसे", aapne: "आपने",
  hum: "हम", hamare: "हमारे", humare: "हमारे", hamara: "हमारा", hamari: "हमारी", hamein: "हमें", humein: "हमें", humko: "हमको",
  main: "मैं", mera: "मेरा", meri: "मेरी", mere: "मेरे", mujhe: "मुझे", mujhko: "मुझको", maine: "मैंने",
  ye: "ये", yeh: "यह", woh: "वह", wo: "वो", vo: "वो", ve: "वे", unka: "उनका", unki: "उनकी", unke: "उनके", unko: "उनको", inke: "इनके", iske: "इसके", iska: "इसका", iski: "इसकी", isme: "इसमें", ismein: "इसमें", usme: "उसमें", usmein: "उसमें",
  apna: "अपना", apni: "अपनी", apne: "अपने",
  ji: "जी", jee: "जी", haan: "हाँ", han: "हाँ", achha: "अच्छा", accha: "अच्छा", acha: "अच्छा", achhi: "अच्छी", achhe: "अच्छे",
  theek: "ठीक", thik: "ठीक", bilkul: "बिल्कुल", zaroor: "ज़रूर", jaroor: "ज़रूर", zaroorat: "ज़रूरत", jarurat: "ज़रूरत", zarurat: "ज़रूरत",
  chahiye: "चाहिए", chahte: "चाहते", chahti: "चाहती", chahta: "चाहता", chahenge: "चाहेंगे", chahengi: "चाहेंगी",
  liye: "लिए", lie: "लिए", ke: "के", ka: "का", ki: "की", ko: "को", se: "से", mein: "में", par: "पर", pe: "पे",
  aur: "और", ya: "या", bhi: "भी", toh: "तो", bas: "बस", sirf: "सिर्फ़", abhi: "अभी", kal: "कल", parson: "परसों", parso: "परसों", aaj: "आज",
  baad: "बाद", pehle: "पहले", phir: "फिर", fir: "फिर", jab: "जब", tab: "तब", agar: "अगर", lekin: "लेकिन", magar: "मगर", kyunki: "क्योंकि", isliye: "इसलिए", waise: "वैसे", jaise: "जैसे",
  sakte: "सकते", sakti: "सकती", sakta: "सकता", sakenge: "सकेंगे",
  karna: "करना", karein: "करें", karen: "करें", karenge: "करेंगे", karungi: "करूँगी", karunga: "करूँगा", karoon: "करूँ", karun: "करूँ", karo: "करो", kijiye: "कीजिए", kar: "कर", karte: "करते", karti: "करती", karta: "करता", kiya: "किया", kiye: "किए",
  batao: "बताओ", bataiye: "बताइए", batayein: "बताएँ", bataungi: "बताऊँगी", bataunga: "बताऊँगा", batati: "बताती", batata: "बताता", bata: "बता", batana: "बताना",
  dekh: "देख", dekhte: "देखते", dekhti: "देखती", dekhna: "देखना", dekhiye: "देखिए", dekhein: "देखें", dekhenge: "देखेंगे",
  lena: "लेना", lene: "लेने", lenge: "लेंगे", le: "ले", lo: "लो", dena: "देना", dete: "देते", deti: "देती", denge: "देंगे", de: "दे", do: "दो",
  milta: "मिलता", milti: "मिलती", milte: "मिलते", milega: "मिलेगा", milegi: "मिलेगी", milenge: "मिलेंगे",
  hoga: "होगा", hogi: "होगी", honge: "होंगे", hota: "होता", hoti: "होती", hote: "होते", raha: "रहा", rahi: "रही", rahe: "रहे",
  wala: "वाला", wali: "वाली", wale: "वाले", madad: "मदद", baat: "बात", baatein: "बातें", sab: "सब", sabhi: "सभी", bahut: "बहुत", thoda: "थोड़ा", thodi: "थोड़ी", zyada: "ज़्यादा", jyada: "ज़्यादा", kam: "कम",
  shukriya: "शुक्रिया", dhanyavaad: "धन्यवाद", dhanyawad: "धन्यवाद", namaste: "नमस्ते", yahan: "यहाँ", wahan: "वहाँ",
  din: "दिन", shaam: "शाम", subah: "सुबह", raat: "रात", baje: "बजे", ghar: "घर", gaadi: "गाड़ी", gadi: "गाड़ी", parivaar: "परिवार", log: "लोग", logon: "लोगों",
  jaankari: "जानकारी", jankari: "जानकारी", sawal: "सवाल", jawab: "जवाब", samay: "समय", waqt: "वक़्त", paisa: "पैसा", paise: "पैसे", rupaye: "रुपये", lakh: "लाख", hazaar: "हज़ार", hazar: "हज़ार",
  sahi: "सही", galat: "ग़लत", naya: "नया", nayi: "नई", purana: "पुराना", tarah: "तरह", prakar: "प्रकार", khas: "ख़ास", alag: "अलग",
  samajh: "समझ", samjha: "समझा", samjhi: "समझी", gaya: "गया", gayi: "गई", gaye: "गए", aaye: "आए", aayi: "आई", aaya: "आया", jaye: "जाए", jayega: "जाएगा", jayegi: "जाएगी",
  shubh: "शुभ", dhyan: "ध्यान", rakhiye: "रखिए", rakhna: "रखना",
};

/** Roman-letter Hindi that would be read with an English accent (at least 2 Hindi words, no Devanagari). */
export function isRomanHinglish(text: string): boolean {
  const t = String(text || "");
  if (/[ऀ-ॿ]/.test(t) || !/[A-Za-z]/.test(t)) return false;
  const words = t.toLowerCase().match(/[a-z]+/g) || [];
  const hits = words.filter((w) => Object.prototype.hasOwnProperty.call(WORDS, w)).length;
  return hits >= 2 && hits / Math.max(1, words.length) >= 0.25;
}

/** The sentence with its known Hindi words in Devanagari (unchanged when it isn't Roman Hinglish). */
export function hinglishToDevanagari(text: string): string {
  const original = String(text || "");
  if (!isRomanHinglish(original)) return original;
  return original.replace(/[A-Za-z]+/g, (w) => {
    const d = WORDS[w.toLowerCase()];
    return d && Object.prototype.hasOwnProperty.call(WORDS, w.toLowerCase()) ? d : w;
  }).replace(/(?<=[ऀ-ॿ])\.(?=\s|$)/g, "।");
}
