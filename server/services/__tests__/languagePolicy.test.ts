/**
 * Reply-language policy: settings validation, the per-reply decision, explicit requests,
 * TopScholar medium, the model rule, and the reply safety check.
 * Run: npx tsx server/services/__tests__/languagePolicy.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused'; // never queried here

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); }
}

async function main() {
  const L = await import('../language/languagePolicy');
  const T = await import('../language/languageText');
  const { DEFAULT_AI_LANGUAGE_SETTINGS } = await import('@shared/replyLanguages');
  const settings = (over: any) => L.normalizeLanguageSettings({ ...DEFAULT_AI_LANGUAGE_SETTINGS, ...over });
  const policy = (over: any, ch: any = 'website') => L.policyFromSettings(settings(over), ch);

  // ── settings validation ──
  expect(settings({}).mode === 'any', 'default: any language (unchanged behaviour)');
  const bad = (over: any, re: RegExp, label: string) => { try { settings(over); expect(false, label); } catch (e) { expect(re.test((e as Error).message), label, (e as Error).message); } };
  bad({ mode: 'restricted', allowed: [], defaultLanguage: 'en' }, /at least one/, 'restricted needs at least one language');
  bad({ mode: 'restricted', allowed: ['hi'], defaultLanguage: 'en' }, /default language must be one of/, 'default must be allowed');
  bad({ allowed: ['xx'] }, /unknown language/, 'unknown codes rejected');
  bad({ channelOverrides: { whatsapp: { allowed: ['hi'], defaultLanguage: 'en' } } }, /whatsapp/, 'channel override default must be in its list');
  expect(JSON.stringify(settings({ mode: 'restricted', allowed: ['en', 'hi', 'en'], defaultLanguage: 'en' }).allowed) === '["en","hi"]', 'duplicates removed');
  expect(settings({ mediumMap: { ' Hindi  Medium ': 'hi' } }).mediumMap['hindi medium'] === 'hi', 'medium keys normalised');

  // ── unrestricted: unchanged ──
  const anyP = policy({});
  expect(L.resolveReplyLanguage({ policy: anyP, detected: 'ta' }).language === null, 'any language: follow the customer (null = existing behaviour)');
  expect(L.resolveReplyLanguage({ policy: anyP, picked: 'hi', detected: 'en' }).language === 'hi', 'any language: dropdown pick still wins');
  expect(L.buildLanguageRule(L.resolveReplyLanguage({ policy: anyP, detected: 'ta' }), anyP) === '', 'any language: no extra rule');

  // ── restricted ──
  const enHi = policy({ mode: 'restricted', allowed: ['en', 'hi'], defaultLanguage: 'en' });
  const r1 = L.resolveReplyLanguage({ policy: enHi, detected: 'hi' });
  expect(r1.language === 'hi' && !r1.outsideAllowed && r1.source === 'detected', 'allowed language written → reply in it', r1);
  const r2 = L.resolveReplyLanguage({ policy: enHi, detected: 'ta' });
  expect(r2.language === 'en' && r2.outsideAllowed && r2.source === 'default', 'Tamil (not allowed) → default English + note', r2);
  const rH = L.resolveReplyLanguage({ policy: enHi, detected: 'hinglish' });
  expect(rH.language === 'hinglish' && !rH.outsideAllowed, 'Roman Hindi written, Hindi allowed, script "match" → Roman Hindi back (no note)', rH);
  expect(L.resolveReplyLanguage({ policy: policy({ mode: 'restricted', allowed: ['en', 'hi'], defaultLanguage: 'en', hindiScript: 'devanagari' }), detected: 'hinglish' }).language === 'hi', 'Hindi script "Devanagari" → Devanagari even for Roman Hindi');
  expect(L.resolveReplyLanguage({ policy: policy({ mode: 'restricted', allowed: ['hinglish'], defaultLanguage: 'hinglish' }), detected: 'hi' }).language === 'hinglish', 'Devanagari written, only Hinglish allowed → Hinglish');
  expect(L.resolveReplyLanguage({ policy: enHi, picked: 'ta', detected: 'en' }).language === 'en', 'a disallowed dropdown value is ignored');
  expect(L.resolveReplyLanguage({ policy: enHi, picked: 'hi', detected: 'en' }).language === 'hi', 'allowed dropdown pick wins over what they typed');
  const r3 = L.resolveReplyLanguage({ policy: enHi, requested: 'ta', detected: 'en' });
  expect(r3.language === 'en' && r3.source === 'detected', 'asking for Tamil when not allowed → stays in an allowed language', r3);
  expect(L.resolveReplyLanguage({ policy: enHi, detected: null }).outsideAllowed === false, 'unknown language (emoji, "ok") is not "another language"');
  const hiScriptRoman = policy({ mode: 'restricted', allowed: ['hi', 'hinglish'], defaultLanguage: 'hi', hindiScript: 'roman' });
  expect(L.resolveReplyLanguage({ policy: hiScriptRoman, detected: 'hi' }).language === 'hinglish', 'Hindi script "English letters" → Hinglish even for Devanagari input');
  const hiDev = policy({ mode: 'restricted', allowed: ['hi'], defaultLanguage: 'hi', hindiScript: 'devanagari' });
  expect(L.resolveReplyLanguage({ policy: hiDev, detected: 'hinglish' }).language === 'hi', 'Hindi script "Devanagari" → Devanagari');

  // channel override
  const wa = policy({ mode: 'restricted', allowed: ['en', 'hi'], defaultLanguage: 'en', channelOverrides: { whatsapp: { allowed: ['hi'], defaultLanguage: 'hi' } } }, 'whatsapp');
  expect(wa.allowed.join() === 'hi' && L.resolveReplyLanguage({ policy: wa, detected: 'en' }).language === 'hi', 'per-channel override (WhatsApp Hindi-only)', wa.allowed);
  const waOnly = policy({ mode: 'any', channelOverrides: { whatsapp: { allowed: ['hi'], defaultLanguage: 'hi' } } }, 'whatsapp');
  expect(waOnly.restricted && policy({ mode: 'any', channelOverrides: { whatsapp: { allowed: ['hi'], defaultLanguage: 'hi' } } }, 'website').restricted === false, 'an override restricts only its channel');

  // ── TopScholar medium ──
  const med = policy({ mode: 'restricted', allowed: ['en', 'hi'], defaultLanguage: 'en', followMedium: true, mediumSwitchable: true });
  expect(L.mediumLanguage(med, 'Hindi Medium (CBSE)') === 'hi' && L.mediumLanguage(med, 'english-medium') === null || L.mediumLanguage(med, 'English Medium') === 'en', 'medium values mapped ("Hindi Medium (CBSE)" → hi)');
  const m1 = L.resolveReplyLanguage({ policy: med, medium: 'Hindi', detected: 'en' });
  expect(m1.language === 'hi' && m1.source === 'medium', 'Hindi-medium student typing in English → Hindi (writing ≠ asking)', m1);
  expect(L.resolveReplyLanguage({ policy: med, medium: 'Hindi', requested: 'en' }).language === 'en', 'switchable: "explain in English" → English');
  expect(L.resolveReplyLanguage({ policy: med, medium: 'Hindi', picked: 'en' }).language === 'en', 'switchable: dropdown English → English');
  const locked = policy({ mode: 'restricted', allowed: ['en', 'hi'], defaultLanguage: 'en', followMedium: true, mediumSwitchable: false });
  expect(L.resolveReplyLanguage({ policy: locked, medium: 'Hindi', requested: 'en', picked: 'en' }).language === 'hi', 'locked to medium: requests and dropdown ignored');
  expect(L.resolveReplyLanguage({ policy: med, medium: 'Marathi', detected: 'mr' }).language === 'en', 'Marathi medium not allowed (en/hi only) → default');
  expect(L.resolveReplyLanguage({ policy: policy({ followMedium: true }), medium: 'Hindi', detected: 'en' }).language === 'hi', 'medium also works without a restriction');
  expect(L.resolveReplyLanguage({ policy: policy({ followMedium: true, mediumSwitchable: false }), medium: 'Hindi', picked: 'en', requested: 'en' }).language === 'hi', 'locked medium wins over the dropdown and requests even without a restriction');
  const ruleMed = L.buildLanguageRule(m1, med);
  expect(/प्रकाश संश्लेषण \(photosynthesis\)/.test(ruleMed), 'Hindi medium style: Hindi with English technical terms', ruleMed);

  // ── explicit requests ──
  const req = (t: string) => L.detectLanguageRequest(t);
  expect(req('Can you explain in English?') === 'en' && req('English mein samjhao') === 'en' && req('Hindi mein batao') === 'hi' && req('हिंदी में समझाइए') === 'hi' && req('reply in Tamil please') === 'ta' && req('Hindi please') === 'hi', 'explicit requests recognised (English/Hinglish/Devanagari)', ['Can you explain in English?', 'English mein samjhao', 'Hindi mein batao', 'हिंदी में समझाइए', 'reply in Tamil please', 'Hindi please'].map(req));
  expect(req('I study in an English medium school, what is photosynthesis?') === null && req('Is the Hindi teacher good?') === null && req('What are the fees?') === null, 'mentioning a language is not a request', ['I study in an English medium school, what is photosynthesis?', 'Is the Hindi teacher good?'].map(req));
  L.resetLanguageStateForTesting();
  expect(L.trackLanguageRequest('c1', 'English mein samjhao') === 'en' && L.trackLanguageRequest('c1', 'what is a cell?') === 'en', 'a request is remembered for the conversation');
  expect(L.takeLanguageNote('c1') === true && L.takeLanguageNote('c1') === false, 'the "I can help in…" note is given once per conversation');

  // ── model rule ──
  const rule = L.buildLanguageRule(r2, enHi);
  expect(/ENTIRE reply in English/.test(rule) && /overrides every other instruction/.test(rule) && /English or Hindi/.test(rule) && /ONE short friendly sentence/.test(rule), 'restricted rule: language, priority, allowed list, one-line note', rule);
  expect(!/short friendly sentence/.test(L.buildLanguageRule(r2, enHi, { noteAllowed: false })), 'note omitted once already given');
  const ask = policy({ mode: 'restricted', allowed: ['en'], defaultLanguage: 'en', unsupportedBehaviour: 'ask_to_switch' });
  expect(/ask them to continue/.test(L.buildLanguageRule(L.resolveReplyLanguage({ policy: ask, detected: 'ta' }), ask)), '"ask to switch" behaviour');
  expect(/Tamil \(தமிழ்\), in its own script/.test(L.buildLanguageRule(L.resolveReplyLanguage({ policy: policy({ mode: 'restricted', allowed: ['ta'], defaultLanguage: 'ta' }), detected: 'en' }), policy({ mode: 'restricted', allowed: ['ta'], defaultLanguage: 'ta' }))), 'non-Latin languages: "in its own script"');

  // ── reply safety check ──
  expect(T.replyLanguageMatches('प्रकाश संश्लेषण वह प्रक्रिया है जिसमें पौधे भोजन बनाते हैं।', 'hi'), 'Hindi reply matches hi');
  expect(!T.replyLanguageMatches('Photosynthesis is the process by which plants make food.', 'hi'), 'English reply does not match hi');
  expect(T.replyLanguageMatches('Our Rolex Daytona costs ₹78,33,000 — यह घड़ी बहुत खास है और हमारे स्टोर में उपलब्ध है।', 'hi'), 'Hindi with an English product name still matches');
  expect(!T.replyLanguageMatches('हमारे यहाँ शनिवार और रविवार को कक्षाएँ होती हैं।', 'en'), 'Devanagari reply does not match English');
  expect(!T.replyLanguageMatches('Haan ji, aapke liye weekend classes Saturday aur Sunday ko hoti hain, aap demo book kar sakte hain.', 'en'), 'Hinglish reply does not match English');
  expect(T.replyLanguageMatches('Haan ji, aapke liye weekend classes Saturday aur Sunday ko hoti hain.', 'hinglish'), 'Hinglish matches hinglish');
  expect(T.replyLanguageMatches('OK 👍', 'ta'), 'very short replies always pass');
  T.resetLanguageTextCacheForTesting();
  let calls = 0;
  const fake = async (_s: string, t: string) => { calls++; return `TRANSLATED:${t}`; };
  const fixed = await T.correctReplyLanguage('b1', 'Photosynthesis is the process by which plants make food.', 'hi', { translator: fake });
  expect(fixed.corrected && fixed.text.startsWith('TRANSLATED:') && calls === 1, 'wrong-language reply rewritten before sending');
  const fine = await T.correctReplyLanguage('b1', 'प्रकाश संश्लेषण वह प्रक्रिया है जिसमें पौधे भोजन बनाते हैं।', 'hi', { translator: fake });
  expect(!fine.corrected && calls === 1, 'right-language reply untouched (no extra AI call)');
  const t1 = await T.translateFixedText('b1', 'Please share your phone number.', 'hi', { translator: fake });
  const t2 = await T.translateFixedText('b1', 'Please share your phone number.', 'hi', { translator: fake });
  expect(t1 === t2 && calls === 2, 'fixed messages translated once and cached');
  expect(await T.translateFixedText('b1', 'Hello', 'en', { translator: fake }) === 'Hello' && calls === 2, 'English → no translation call');
  const failing = async () => { throw new Error('down'); };
  expect(await T.translateFixedText('b1', 'Hi again', 'hi', { translator: failing }) === 'Hi again', 'translation failure → original text (never blocks)');

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll language policy checks passed.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
