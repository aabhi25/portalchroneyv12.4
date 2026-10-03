/**
 * Reply language on the website chat / voice / widget (no database, no network):
 * the per-turn decision and what reaches chatService, the "selected from the dropdown"
 * wording fix, greeting languages, the widget payload, transcriber pinning and the
 * fixed-text translation gate.
 * Run: npx tsx server/services/__tests__/languageChannels.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused'; // never queried here

let failed = 0;
let passed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (cond) { passed++; console.log(`✓ ${label}`); }
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); }
}

async function main() {
  const L = await import('../language/languagePolicy');
  const C = await import('../language/chatLanguage');
  const T = await import('../language/languageText');
  const { preferredLanguageSentence } = await import('../../llamaService');
  const { DEFAULT_AI_LANGUAGE_SETTINGS } = await import('@shared/replyLanguages');
  const policy = (over: any, ch: any = 'website') => L.policyFromSettings(L.normalizeLanguageSettings({ ...DEFAULT_AI_LANGUAGE_SETTINGS, ...over }), ch);
  L.resetLanguageStateForTesting();

  // ── "any language" (default): exactly the old preferredLanguage, no rule ──
  const anyP = policy({});
  {
    const d1 = C.decideChatReplyLanguage({ policy: anyP, picked: 'auto', detected: 'hi', message: 'फीस कितनी है?', conversationKey: 'u1', legacyPreferred: 'hi' });
    expect(d1.preferredLanguage === 'hi' && d1.reply.rule === '' && d1.reply.language === null, 'any language + detected Hindi → preferredLanguage unchanged ("hi"), no rule', d1);
    expect(d1.reply.promptSource === 'detected', 'a DETECTED language is described as detected (not "selected from the dropdown")', d1.reply.promptSource);
    const d2 = C.decideChatReplyLanguage({ policy: anyP, picked: 'ta', detected: undefined, message: 'hello', conversationKey: 'u2', legacyPreferred: 'ta' });
    expect(d2.preferredLanguage === 'ta' && d2.reply.rule === '' && d2.reply.promptSource === 'picked', 'any language + dropdown pick → same pick, no extra rule, "selected" wording kept', d2);
    const d3 = C.decideChatReplyLanguage({ policy: anyP, picked: 'auto', detected: undefined, message: 'hi there', conversationKey: 'u3', legacyPreferred: 'auto' });
    expect(d3.preferredLanguage === 'auto' && d3.reply.rule === '', 'any language + nothing detected → the old value passes through untouched ("auto")', d3);
    const d4 = C.decideChatReplyLanguage({ policy: anyP, picked: 'sa', message: 'x', conversationKey: 'u4', legacyPreferred: 'sa' });
    expect(d4.preferredLanguage === 'sa' && d4.reply.promptSource === 'picked', 'unknown dropdown code (not in the catalogue) still passes through as before', d4);
    const d5 = C.decideChatReplyLanguage({ policy: anyP, picked: 'auto', detected: 'en', message: 'Hindi mein batao please', conversationKey: 'u5', legacyPreferred: 'en' });
    expect(d5.preferredLanguage === 'hi' && /REPLY LANGUAGE/.test(d5.reply.rule) && d5.reply.promptSource === 'requested', 'any language + explicit "Hindi mein batao" → Hindi with a rule (the request is honoured)', d5);
    const d6 = C.decideChatReplyLanguage({ policy: anyP, picked: 'auto', detected: 'en', message: 'what is a cell?', conversationKey: 'u5', legacyPreferred: 'en' });
    expect(d6.preferredLanguage === 'hi', 'the request is remembered for the rest of the conversation', d6.preferredLanguage);
  }

  // ── restricted: precedence dropdown / request / medium / detected / default ──
  const enHi = policy({ mode: 'restricted', allowed: ['en', 'hi'], defaultLanguage: 'en' });
  {
    const ta = C.decideChatReplyLanguage({ policy: enHi, picked: 'auto', detected: 'ta', message: 'கட்டணம் என்ன?', conversationKey: 'r1', legacyPreferred: 'ta' });
    expect(ta.preferredLanguage === 'en' && ta.reply.outsideAllowed && /ONE short friendly sentence/.test(ta.reply.rule) && /English or Hindi/.test(ta.reply.rule), 'restricted: Tamil → English + one-line "I can help in English or Hindi" note', ta);
    const ta2 = C.decideChatReplyLanguage({ policy: enHi, picked: 'auto', detected: 'ta', message: 'சரி', conversationKey: 'r1', legacyPreferred: 'ta' });
    expect(ta2.preferredLanguage === 'en' && !/short friendly sentence/.test(ta2.reply.rule) && /ENTIRE reply in English/.test(ta2.reply.rule), 'the note is given only once per conversation (rule stays)', ta2.reply.rule);
    const hi = C.decideChatReplyLanguage({ policy: enHi, picked: 'auto', detected: 'hi', message: 'फीस?', conversationKey: 'r2' });
    expect(hi.preferredLanguage === 'hi' && hi.reply.promptSource === 'detected' && !hi.reply.outsideAllowed, 'restricted: allowed language written → reply in it', hi);
    const pick = C.decideChatReplyLanguage({ policy: enHi, picked: 'hi', detected: 'en', message: 'fees?', conversationKey: 'r3' });
    expect(pick.preferredLanguage === 'hi' && pick.reply.promptSource === 'picked', 'restricted: allowed dropdown pick wins over what they typed', pick.reply);
    const badPick = C.decideChatReplyLanguage({ policy: enHi, picked: 'ta', detected: 'hi', message: 'फीस?', conversationKey: 'r4', legacyPreferred: 'ta' });
    expect(badPick.preferredLanguage === 'hi', 'restricted: a disallowed dropdown value (old widget) is ignored', badPick.preferredLanguage);
    const req = C.decideChatReplyLanguage({ policy: enHi, picked: 'en', detected: 'en', message: 'Hindi mein batao', conversationKey: 'r5' });
    expect(req.preferredLanguage === 'en', 'restricted: the dropdown pick beats a typed request', req.preferredLanguage);
    const nothing = C.decideChatReplyLanguage({ policy: enHi, picked: 'auto', detected: null, message: '👍', conversationKey: 'r6' });
    expect(nothing.preferredLanguage === 'en' && !nothing.reply.outsideAllowed && nothing.reply.promptSource === 'default', 'restricted: unknown language ("👍") → default, no note', nothing.reply);
  }

  // ── TopScholar medium ──
  {
    const med = policy({ mode: 'restricted', allowed: ['en', 'hi'], defaultLanguage: 'en', followMedium: true, mediumSwitchable: true });
    const m1 = C.decideChatReplyLanguage({ policy: med, picked: 'auto', detected: 'en', message: 'what is photosynthesis?', conversationKey: 'm1', medium: 'Hindi Medium' });
    expect(m1.preferredLanguage === 'hi' && m1.reply.promptSource === 'medium' && /प्रकाश संश्लेषण \(photosynthesis\)/.test(m1.reply.rule), 'Hindi-medium student starts in Hindi with English terms in brackets', m1.reply);
    const m2 = C.decideChatReplyLanguage({ policy: med, picked: 'auto', detected: 'en', message: 'explain in English', conversationKey: 'm1', medium: 'Hindi Medium' });
    expect(m2.preferredLanguage === 'en', 'switchable: "explain in English" switches', m2.preferredLanguage);
    const m3 = C.decideChatReplyLanguage({ policy: med, picked: 'en', detected: 'hi', message: 'x', conversationKey: 'm2', medium: 'Hindi' });
    expect(m3.preferredLanguage === 'en', 'switchable: widget dropdown switches', m3.preferredLanguage);
    const locked = policy({ followMedium: true, mediumSwitchable: false });
    const m4 = C.decideChatReplyLanguage({ policy: locked, picked: 'en', detected: 'en', message: 'explain in English', conversationKey: 'm3', medium: 'Hindi' });
    expect(m4.preferredLanguage === 'hi' && /REPLY LANGUAGE/.test(m4.reply.rule), 'locked: medium wins over dropdown and requests (even without a restriction)', m4);
    const m5 = C.decideChatReplyLanguage({ policy: locked, picked: 'auto', detected: 'en', message: 'hi', conversationKey: 'm4', medium: 'Klingon', legacyPreferred: 'en' });
    expect(m5.preferredLanguage === 'en' && m5.reply.rule === '', 'unknown medium → unchanged behaviour', m5);
  }

  // ── wording: "selected from the dropdown" only when picked ──
  expect(preferredLanguageSentence('Hindi') === 'The user has selected Hindi from the language dropdown.', 'no source → original wording (byte-for-byte)');
  expect(preferredLanguageSentence('Hindi', 'picked') === 'The user has selected Hindi from the language dropdown.', 'picked → original wording');
  expect(preferredLanguageSentence('Hindi', 'detected') === 'The user is writing in Hindi.', 'detected → "writing in"');
  expect(!/dropdown/.test(preferredLanguageSentence('Hindi', 'default') + preferredLanguageSentence('Hindi', 'medium') + preferredLanguageSentence('Hindi', 'requested')), 'default / medium / request never mention the dropdown');

  // ── greeting languages ──
  {
    const g1 = C.greetingLanguages(anyP, undefined);
    expect(g1.introLanguage === undefined && g1.welcomeLanguage === undefined, 'any language + no pick → greeting unchanged (no translation)', g1);
    const g2 = C.greetingLanguages(anyP, 'hi');
    expect(g2.introLanguage === 'hi' && g2.welcomeLanguage === 'hi', 'any language + pick → greeting and custom welcome in the pick (as before)', g2);
    const hiOnly = policy({ mode: 'restricted', allowed: ['hi'], defaultLanguage: 'hi' });
    const g3 = C.greetingLanguages(hiOnly, 'auto');
    expect(g3.introLanguage === 'hi' && g3.welcomeLanguage === undefined, 'Hindi-only + no pick → our greeting in Hindi, custom welcome untouched (translate toggle off)', g3);
    const g4 = C.greetingLanguages(policy({ mode: 'restricted', allowed: ['hi'], defaultLanguage: 'hi', translateCustomWelcome: true }), undefined);
    expect(g4.welcomeLanguage === 'hi', 'translate toggle on → custom welcome in Hindi too', g4);
    const g5 = C.greetingLanguages(policy({ followMedium: true }), undefined, 'Hindi Medium');
    expect(g5.introLanguage === 'hi', 'TopScholar medium → greeting in the medium language', g5);
  }

  // ── widget payload ──
  expect(C.publicReplyLanguages(anyP) === null, 'widget: any language → replyLanguages null (widget unchanged)');
  expect(JSON.stringify(C.publicReplyLanguages(enHi)) === JSON.stringify({ restricted: true, allowed: ['en', 'hi'], defaultLanguage: 'en' }), 'widget: restricted → allowed + default only (no other settings)', C.publicReplyLanguages(enHi));

  // ── voice transcriber pinning (policy part) ──
  expect(C.policyTranscriptionLanguage(anyP) === null, 'transcriber: any language → auto');
  expect(C.policyTranscriptionLanguage(policy({ mode: 'restricted', allowed: ['hi'], defaultLanguage: 'hi' })) === 'hi', 'transcriber: Hindi-only → pinned to Hindi');
  expect(C.policyTranscriptionLanguage(policy({ mode: 'restricted', allowed: ['hi', 'hinglish'], defaultLanguage: 'hi' })) === 'hi', 'transcriber: Hindi + Hinglish count as one language → Hindi');
  expect(C.policyTranscriptionLanguage(enHi) === null, 'transcriber: English + Hindi → auto');
  expect(C.policyTranscriptionLanguage(policy({ followMedium: true, mediumSwitchable: false }), 'Hindi') === 'hi', 'transcriber: locked medium → pinned');
  expect(C.policyTranscriptionLanguage(policy({ followMedium: true, mediumSwitchable: true }), 'Hindi') === null, 'transcriber: switchable medium → auto');
  expect(C.policyTranscriptionLanguage(policy({ mode: 'any', channelOverrides: { voice: { allowed: ['ta'], defaultLanguage: 'ta' } } }, 'voice')) === 'ta', 'transcriber: voice-only override (Tamil) → pinned');

  // ── fixed-text translation gate ──
  expect(!C.needsFixedTranslation('Thank you!', 'en', T.replyLanguageMatches), 'fixed text: English → no translation');
  expect(C.needsFixedTranslation('Thank you for sharing your details!', 'hi', T.replyLanguageMatches), 'fixed text: English text for Hindi → translate');
  expect(!C.needsFixedTranslation('आपका आवेदन सफलतापूर्वक जमा हो गया है।', 'hi', T.replyLanguageMatches), 'fixed text: already Hindi (business journey in Hindi) → no translation call');
  expect(C.needsFixedTranslation('Please select from the options below', 'es', T.replyLanguageMatches), 'fixed text: Latin target (Spanish) → translate');
  expect(!C.replyLanguageActive({ language: 'hi', rule: '', source: 'picked', restricted: false, outsideAllowed: false, promptSource: 'picked' }), 'no rule (any language + pick) → fixed texts untouched');

  // ── turn language (voice, no AI call) ──
  expect(C.detectTurnLanguage('मुझे फीस बताइए') === 'hi' && C.detectTurnLanguage('fees kitni hai batao') === 'hinglish', 'turn language: Devanagari → hi, Hinglish → hinglish');
  expect(C.detectTurnLanguage('What are the fees for the yoga classes at your club?') === 'en', 'turn language: plain English → en');
  expect(C.detectTurnLanguage('مجھے فیس بتائیں', { arabicIsHindi: true }) === 'hi', 'turn language: Urdu-script voice transcript → Hindi');
  expect(C.detectTurnLanguage('Bonjour, quels sont vos tarifs pour les cours?') === null, 'turn language: unsure → null (model follows the customer)');

  if (failed) { console.log(`\n${failed} check(s) failed, ${passed} passed`); process.exit(1); }
  console.log(`\nAll ${passed} language channel checks passed.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
