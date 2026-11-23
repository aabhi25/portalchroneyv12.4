/**
 * Phone calls: short spoken answers, lists said as one sentence (voice/phoneAnswerShaper.ts).
 * Run: npx tsx server/services/__tests__/phoneAnswerShaper.test.ts
 */
import { PhoneAnswerShaper, PHONE_MAX_WORDS, callerAsked, wantsDetail } from "../voice/phoneAnswerShaper";
import { SentenceStreamSplitter } from "../voice/sentenceSplitter";
let failed = 0;
const expect = (cond: unknown, label: string, got?: unknown) => { if (cond) console.log(`✓ ${label}`); else { failed++; console.log(`✗ ${label} — got: ${JSON.stringify(got)}`); } };

/** Stream the answer through the real splitter in small deltas, like the model does. */
function shape(answer: string): { spoken: string[]; saved: string; changed: boolean } {
  const splitter = new SentenceStreamSplitter();
  const shaper = new PhoneAnswerShaper();
  const spoken: string[] = [];
  for (let i = 0; i < answer.length; i += 7) for (const seg of splitter.push(answer.slice(i, i + 7))) spoken.push(...shaper.push(seg));
  for (const seg of splitter.flush()) spoken.push(...shaper.push(seg));
  spoken.push(...shaper.flush());
  return { spoken: spoken.map((s) => s.trim()), saved: shaper.spokenMarkdown, changed: shaper.changed };
}
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

// Live call 2026-10-16, turn 13 (English) and turn 11 (Hindi): a list read out for 17-21 s.
const en = shape("Sure! Here’s the coverage typically included in motor insurance:\n\n- **Third Party Liability**: Covers damages to others.\n- **Automobile Damage**: Covers damage to your vehicle.\n- **Personal Accident Cover**: Protection for driver and passengers.\n\nIf you need more details or want to discuss options, just let me know!");
expect(en.spoken.join(" ").includes("Third Party Liability, Automobile Damage and Personal Accident Cover."), "English list → one sentence of the item names", en.spoken);
expect(!/Covers damages|\*\*|^- /m.test(en.spoken.join("\n")), "no item details, bold markers or bullets spoken", en.spoken);
expect(en.changed && en.saved === en.spoken.join(" "), "what is saved is what was said", en.saved);

const hi = shape("Motor insurance में आमतौर पर आपको निम्नलिखित कवरेज मिलते हैं:\n\n- थर्ड पार्टी लाइबिलिटी: दूसरों के नुकसान का कवरेज।\n- ऑटोमोबाइल डैमेज: आपकी गाड़ी को हुए नुकसान का कवरेज।\n- पर्सनल एक्सीडेंट कवर: ड्राइवर और पैसेंजर के लिए।\n\nआपकी ज़रूरत के हिसाब से और भी विकल्प हो सकते हैं। क्या आपको इस बारे में और जानकारी चाहिए?");
expect(hi.spoken.some((s) => s === "थर्ड पार्टी लाइबिलिटी, ऑटोमोबाइल डैमेज और पर्सनल एक्सीडेंट कवर."), "Hindi list → one sentence joined with और", hi.spoken);
expect(hi.spoken[hi.spoken.length - 1] === "क्या आपको इस बारे में और जानकारी चाहिए?", "the closing question is still asked", hi.spoken);
expect(words(hi.spoken.join(" ")) <= PHONE_MAX_WORDS + 12, "short enough to say in a few seconds", words(hi.spoken.join(" ")));

const long = shape("We offer health insurance for families. It covers hospital stays and day-care treatments. You can add your parents too. There is a waiting period of two years for some illnesses. Premiums depend on age and city. Would you like a quote for your family?");
expect(long.spoken.length <= 4 && long.spoken[long.spoken.length - 1] === "Would you like a quote for your family?", "a long answer: first sentences + its question", long.spoken);
expect(long.spoken[0] === "We offer health insurance for families.", "always starts with the first sentence", long.spoken);

const short = shape("Achha, motor insurance ke liye hamare paas comprehensive aur third-party dono plans hain. Aapki gaadi kaunsi hai?");
expect(!short.changed && short.spoken.length === 2, "a short answer is spoken as written", short);

const one = shape("Third-party cover is mandatory by law, and it pays for damage you cause to other people, their vehicles or their property, but it does not cover your own car at all, which is why most people also take own-damage cover.");
expect(one.spoken.join(" ").endsWith("own-damage cover.") && !one.changed, "a single (long) sentence is never cut", one.spoken);

// Real call 2026-11-23 (Symbiosis Online): a reaction, two brochure sentences and a question — 19 s of talking.
const brochure = shape("Great! The online MBA program at Symbiosis is designed for working professionals like you. It offers specializations in areas such as Marketing, Finance, HR, and more. What specific aspects of the MBA are you most interested in?");
expect(brochure.spoken.join(" ") === "Great! The online MBA program at Symbiosis is designed for working professionals like you. What specific aspects of the MBA are you most interested in?", "reaction + first sentence + the question; the middle sentence is left out", brochure.spoken);
expect(brochure.changed && brochure.saved === brochure.spoken.join(" ") && words(brochure.saved) <= PHONE_MAX_WORDS + 6, "…and that is what is saved", brochure.saved);
const facts = shape("The course is two years long. Fees are forty thousand a semester. Want me to explain the EMI option?");
expect(!facts.changed && facts.spoken.length === 3, "two short facts and a question are all said", facts.spoken);
const two = shape("Okay, nice. The course is fully online, with live classes on weekends. Recordings stay available if you miss one.");
expect(!two.changed && two.spoken.join(" ") === "Okay, nice. The course is fully online, with live classes on weekends. Recordings stay available if you miss one.", "a reaction and two short sentences with no question are all said", two.spoken);
const HI_LONG = "अच्छा, आप मार्केटिंग में MBA करना चाहते हैं। हमारे MBA प्रोग्राम में आपको मार्केटिंग के कई ज़रूरी पहलुओं पर ध्यान दिया जाएगा, जैसे कि डिजिटल मार्केटिंग, ब्रांड मैनेजमेंट और मार्केट रिसर्च की पूरी पढ़ाई। क्या आप अभी job कर रहे हैं?";
const hiLong = shape(HI_LONG);
expect(hiLong.spoken.length === 2 && hiLong.spoken[1] === "क्या आप अभी job कर रहे हैं?" && hiLong.changed, "Hindi: first sentence + the question", hiLong.spoken);
// They asked something: the answer is what stays.
const answered = (() => {
  const splitter = new SentenceStreamSplitter();
  const shaper = new PhoneAnswerShaper({ callerAsked: true });
  const spoken: string[] = [];
  const answer = "Fees की बात करें तो ये course दो साल का है। पूरी fees दो लाख रुपये है, जो आप चार semester में बराबर हिस्सों में दे सकते हैं और EMI भी मिल जाती है। क्या आप admission process के बारे में भी जानना चाहेंगे?";
  for (const seg of [...splitter.push(answer), ...splitter.flush()]) spoken.push(...shaper.push(seg));
  spoken.push(...shaper.flush());
  return spoken.map((x) => x.trim());
})();
expect(answered.length === 2 && /दो लाख रुपये/.test(answered[1]) && !answered.some((x) => x.endsWith("?")), "they asked a question: both answer sentences are said, the extra question is not", answered);
expect(callerAsked("फीस कितनी है?") && callerAsked("Kitne saal ka course hai") && callerAsked("Achha, what about placements") && !callerAsked("Yes, I am ready.") && !callerAsked("मार्केटिंग में।"), "callerAsked: questions, with or without a question mark");
const detail = (() => {
  const splitter = new SentenceStreamSplitter();
  const shaper = new PhoneAnswerShaper({ relaxed: true });
  const spoken: string[] = [];
  const answer = "The course runs for two years in four semesters. Classes are live on weekends, and every session is recorded. Exams are online as well. You can pick marketing, finance or HR in the second year. Shall I tell you about the fees?";
  for (const seg of [...splitter.push(answer), ...splitter.flush()]) spoken.push(...shaper.push(seg));
  spoken.push(...shaper.flush());
  return spoken.map((x) => x.trim());
})();
expect(detail.length === 5 && detail[4] === "Shall I tell you about the fees?", "asked for details: a fuller answer is allowed", detail);
expect(wantsDetail("Can you explain in detail?") && wantsDetail("थोड़ा विस्तार से बताइए") && wantsDetail("detail mein batao") && !wantsDetail("Fees kitni hai?") && !wantsDetail("Yes, I am."), "wantsDetail: explain / विस्तार से / detail mein, not an ordinary question");

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll phone answer checks passed.");
