/**
 * Phone calls speak everyday Hindi (voice/colloquialHindi.ts).
 * Run: npx tsx server/services/__tests__/colloquialHindi.test.ts
 */
import { colloquialHindi } from "../voice/colloquialHindi";
let failed = 0;
const expect = (cond: unknown, label: string, got?: unknown) => { if (cond) console.log(`✓ ${label}`); else { failed++; console.log(`✗ ${label} — got: ${JSON.stringify(got)}`); } };

const a = colloquialHindi("हमारे पास विभिन्न बीमा योजनाएँ हैं, जिनमें स्वास्थ्य बीमा, मोटर बीमा, जीवन बीमा और यात्रा बीमा शामिल हैं।");
expect(a === "हमारे पास अलग-अलग insurance plans हैं, जिनमें health insurance, motor insurance, life insurance और travel insurance शामिल हैं।", "live call sentence → everyday Hindi", a);
const b = colloquialHindi("हमारे पास कई प्रकार के इंश्योरेंस विकल्प हैं, जैसे: - स्वास्थ्य बीमा - मोटर बीमा - जीवन बीमा");
expect(b === "हमारे पास कई तरह के इंश्योरेंस option हैं, जैसे health insurance, motor insurance, life insurance", "list read as one sentence; प्रकार/विकल्प swapped", b);
const c = colloquialHindi("आपकी आवश्यकताओं के अनुसार जानकारी प्राप्त करने के लिए हमारी टीम से संपर्क करें।");
expect(c === "आपकी ज़रूरतों के हिसाब से जानकारी लेने के लिए हमारी टीम से बात करें।", "आवश्यकताओं / प्राप्त करने / संपर्क करें", c);
const d = colloquialHindi("Motor insurance में आमतौर पर आपको निम्नलिखित कवरेज मिलते हैं। हम आपकी ज़रूरतों के अनुसार विभिन्न योजनाएँ पेश करते हैं। क्या आप कुछ विशेष जानकारी चाहते हैं?");
expect(d === "Motor insurance में usually आपको ये कवरेज मिलते हैं। हम आपकी ज़रूरतों के हिसाब से अलग-अलग plans देते हैं। क्या आप कुछ खास जानकारी चाहते हैं?", "live call 2026-10-16: निम्नलिखित / आमतौर पर / के अनुसार / पेश करते / विशेष", d);
const e = colloquialHindi("हमारे विशेषज्ञ लाभार्थी के बारे में बताएंगे।");
expect(e === "हमारे विशेषज्ञ लाभार्थी के बारे में बताएंगे।", "whole words only (विशेषज्ञ, लाभार्थी untouched)", e);
// Real calls 2026-11-12 / 2026-11-23 (an education account): textbook Hindi on the phone.
const f = colloquialHindi("अच्छा, तो आप MBA प्रोग्राम में रुचि रखते हैं। आप किस क्षेत्र में विशेष रुचि रखते हैं?");
expect(f === "अच्छा, तो आप MBA प्रोग्राम देख रहे हैं। आप किस field में खास interest रखते हैं?", "रुचि / क्षेत्र → everyday words", f);
const g = colloquialHindi("मुझे खेद है, लेकिन अभी फीस की सही जानकारी नहीं है। यह कामकाजी पेशेवरों के लिए लचीला है और दाखिले की प्रक्रिया आसान है।");
expect(g === "Sorry, अभी फीस की सही जानकारी नहीं है। यह working professionals के लिए flexible है और admission process आसान है।", "खेद / कामकाजी पेशेवरों / लचीला / दाखिले की प्रक्रिया", g);
const h = colloquialHindi("करियर के लक्ष्यों और करियर संभावनाओं के बारे में, हमारे प्रोग्राम में करियर सपोर्ट सेवाएँ उपलब्ध हैं।");
expect(h === "career goals और करियर मौकों के बारे में, हमारे प्रोग्राम में करियर सपोर्ट services available हैं।", "लक्ष्यों / संभावनाओं / सेवाएँ उपलब्ध", h);
const en = "We have health and motor insurance plans - which one interests you?";
expect(colloquialHindi(en) === en, "English answers untouched");
expect(colloquialHindi("") === "", "empty stays empty");
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll colloquial Hindi checks passed.");
