/**
 * Phone-call turn helpers: the contextual opener's safety checks (voice/phoneOpener.ts), the
 * per-turn phone tools (calling/phonePrompt.ts phoneToolsForTurn) and the bare-acknowledgement
 * check that skips the knowledge search (chatContext/smallTalk.ts).
 * Run: npx tsx server/services/__tests__/phoneTurn.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused'; // never queried here

let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); }
}

async function main() {
  const { validOpener, dropEchoedClause, firstWord } = await import('../voice/phoneOpener');
  const { phoneTools, phoneToolsForTurn } = await import('../calling/phonePrompt');
  const { isBareAcknowledgement } = await import('../chatContext/smallTalk');

  // ── opener checks ──
  const ctx = (transcript: string, gender: 'female' | 'male' | null = 'female', avoid: string[] = []) => ({ transcript, gender, avoidFirstWords: avoid });
  expect(validOpener('Achha, parents dono sixty plus hain,', ctx('Mere parents ke liye health insurance chahiye, dono 60 ke upar hain.')) === 'Achha, parents dono sixty plus hain,', 'a good echo opener is kept as is');
  expect(validOpener('Okay, a 2019 i20.', ctx('Hyundai i20, 2019 model.')) === 'Okay, a 2019 i20,', 'a final full stop becomes a comma (the answer continues)');
  expect(validOpener('जी, motor insurance की बात करें तो', ctx('मोटर इंश्योरेंस के बारे में बताइए।')) === 'जी, motor insurance की बात करें तो,', 'Devanagari opener gets a trailing comma');
  expect(validOpener('NONE', ctx('Okay.')) === null && validOpener('', ctx('x')) === null, '"NONE" / empty → no opener');
  expect(validOpener('Ek second, main check karti hoon,', ctx('Premium kitna hai?')) === null, 'time words ("ek second") are refused');
  expect(validOpener('Yes, we have that plan,', ctx('Do you cover diabetes?')) === null && validOpener('Bilkul, aapke liye available hai,', ctx('Plan hai?')) === null, 'yes / bilkul / available (could contradict the answer) are refused');
  expect(validOpener('Okay, the premium is 5000,', ctx('What is the premium?')) === null, 'a number the caller did not say is refused');
  expect(validOpener('Do you mean health insurance?', ctx('insurance')) === null, 'a question is refused');
  expect(validOpener('Ji, main samajh sakta hoon,', ctx('Claim reject ho gaya', 'female')) === null && validOpener('Ji, main samajh sakti hoon,', ctx('Claim reject ho gaya', 'male')) === null, 'first-person verbs must match the voice gender');
  expect(validOpener('Achha, motor insurance,', ctx('Motor insurance batao', 'female', ['achha'])) === null, 'never the same first word as the previous opener');
  expect(validOpener('Okay, so this is a very long opener that goes on and on and on,', ctx('x')) === null, 'more than 12 words is refused');
  expect(firstWord('Achha, parents dono…') === 'achha' && firstWord('जी, motor') === 'जी', 'first word of an opener');

  // ── echo removal ──
  expect(dropEchoedClause('Motor insurance की बात करें तो, इसमें तीन cover मिलते हैं।', 'जी, motor insurance की बात करें तो,') === 'इसमें तीन cover मिलते हैं।', 'answer clause that repeats the opener is dropped');
  expect(dropEchoedClause('For your parents, we have senior citizen plans.', 'Okay, health cover for your parents,') === 'We have senior citizen plans.', 'English echo clause dropped');
  expect(dropEchoedClause('We have three plans, all with cashless claims.', 'Okay, health cover for your parents,') === 'We have three plans, all with cashless claims.', 'an answer that does not echo is unchanged');

  expect(dropEchoedClause('Motor insurance की बात करें तो motor insurance third party cover देता है।', 'हाँ, motor insurance की बात करें तो,') === 'Motor insurance third party cover देता है।', 'answer starting with the opener phrase itself (no comma) loses it (seen on a self-call)');
  expect(dropEchoedClause('Health cover for your parents is something we compare.', 'Okay, health cover for your parents,') === 'Health cover for your parents is something we compare.', 'never cuts the subject off an answer sentence');

  // ── short English replies written in Devanagari (English calls) ──
  const { englishFromDevanagari } = await import('../voice/colloquialHindi');
  expect(englishFromDevanagari('मोटर.') === 'Motor.' && englishFromDevanagari('हेल्थ इंश्योरेंस।') === 'Health insurance.' && englishFromDevanagari('यस') === 'Yes.', 'मोटर / हेल्थ इंश्योरेंस / यस → English');
  expect(englishFromDevanagari('मोटर इंश्योरेंस के बारे में बताइए।') === 'मोटर इंश्योरेंस के बारे में बताइए।' && englishFromDevanagari('Motor.') === 'Motor.', 'real Hindi and English text are unchanged');

  // ── quick reactions ──
  const { phoneParticle } = await import('../voice/fillers');
  const qp = Array.from({ length: 30 }, (_, i) => phoneParticle('hi', [], () => (i % 10) / 10, 'lookup'));
  expect(!qp.some((p) => /achha/i.test(p)), 'no "Achha…" before answering a question', Array.from(new Set(qp)));

  // ── phone tools per turn ──
  const all = phoneTools({ transferAvailable: true, leadCaptureOn: false });
  const names = (t: string, last?: string) => phoneToolsForTurn(all, t, last).map((x: any) => x.function.name).sort().join(',');
  expect(names('Sure.') === '' && names('मोटर') === '' && names('Theek hai, le lo.') === '' && names('Yes, go ahead.') === '', 'no phone tools for ordinary turns (seen: do_not_call after "Sure." / "मोटर")', [names('Sure.'), names('मोटर')]);
  expect(names('Mujhe call mat karna') === 'do_not_call,end_call' && names("please don't call me again") === 'do_not_call,end_call', 'do_not_call only when they asked not to be called');
  expect(names('Okay, thank you.') === 'end_call' && names('Wrong number') === 'end_call' && names('No', 'Is there anything else I can help you with?') === 'end_call', 'end_call on thanks / wrong number / "no" after "anything else?"');
  expect(names('Can I talk to a real person?') === 'transfer_to_human', 'transfer only when they ask for a person');
  expect(names('Kal shaam ko call karna') === 'end_call,save_call_details' && names('My name is Rahul') === 'save_call_details', 'callback time / name → the tools that record them');
  expect(names('Motor insurance ke baare mein bataiye') === '', 'a plain question offers no tools');

  // ── closing turns get no live opener ──
  const { isClosingTurn } = await import('../calling/phonePrompt');
  expect(['Nahi, abhi mujhe interest nahi hai.', 'और प्लीज मुझे दोबारा कॉल मत करना।', 'Alright, thanks, bye.', 'Theek hai, aap mujhe kal shaam ko call karna.', 'Can I talk to a real person?'].every(isClosingTurn), 'refusal / do-not-call / bye / callback / person → closing turn');
  expect(!['Motor insurance ke baare mein bataiye', 'I want health insurance for my parents.', 'Which is better for me, a term plan or a ULIP?'].some(isClosingTurn), 'real questions are not closing turns');

  // ── bare acknowledgements (skip the knowledge search on calls) ──
  const bare = ['Sure.', 'Yes, go ahead.', 'Yeah, please tell me.', 'Okay, thank you.', 'हाँ, बताइए।', 'theek hai', 'ji boliye', 'Okay, that sounds good.', 'ठीक है, ले लो।'];
  expect(bare.every(isBareAcknowledgement), 'yes / okay / go ahead / thanks are bare', bare.filter((t) => !isBareAcknowledgement(t)));
  const real = ['Motor.', 'A car.', 'Motor insurance.', 'What is the premium?', 'haan motor insurance batao', 'Hyundai i20, 2019 model.', 'that plan'];
  expect(real.every((t) => !isBareAcknowledgement(t)), 'anything naming a topic is not bare', real.filter(isBareAcknowledgement));

  // ── live call 2026-10-17: "नहीं" to "is this a good time?", openers, repeated questions ──
  const { declinedToTalk, isUnsureCaller, phoneTurnHints, questionsIn, buildOpeningLine, buildPhoneInstructions } = await import('../calling/phonePrompt');
  const opening = "Hi there, I'm an AI assistant calling from ArhamSecure. You'd enquired with us — is this a good time to talk for a minute?";
  expect(['नहीं।', 'No.', 'Nahi ji', 'abhi nahi', 'Not now.', 'busy'].every((t) => declinedToTalk(t, opening)), 'a no to "is this a good time?" is a decline');
  expect(['नहीं, अभी नहीं।', 'Nahi, abhi nahi.', "No, I'm busy right now.", 'Abhi thoda busy hoon.'].every((t) => declinedToTalk(t, opening)), 'several no-words together are still a decline');
  expect(dropEchoedClause('For your 2019 Swift, we offer comprehensive motor insurance.', 'Right, a 2019 Swift,') === 'We offer comprehensive motor insurance.', 'a short clause naming everything the opener named is dropped');
  expect(dropEchoedClause('A 2019 Swift. We can help you compare plans.', 'Right, a 2019 Swift,') === 'We can help you compare plans.', 'a short first sentence that repeats the opener is dropped');
  expect(dropEchoedClause('Premium 2.5 lakh tak ja sakta hai.', 'Ji, premium ki baat karein toh,') === 'Premium 2.5 lakh tak ja sakta hai.', 'a decimal point is not the end of a clause');
  expect(dropEchoedClause('Health cover for your parents costs around twenty thousand a year, depending on age.', 'Okay, health cover for your parents,') === 'Health cover for your parents costs around twenty thousand a year, depending on age.', 'a long clause that uses the opener words as its subject is kept');
  expect(!declinedToTalk('नहीं।', 'Do you have a car?') && !declinedToTalk('Haan, boliye', opening) && !declinedToTalk('नहीं, बताइए क्या है', opening), 'not a decline: another question, a yes, or "no, tell me"');
  expect(isClosingTurn('नहीं।', opening) && !isClosingTurn('नहीं।', 'Do you have a car?'), 'the decline closes the turn (no opener, no pitch)');
  expect(phoneToolsForTurn(phoneTools({ transferAvailable: true, leadCaptureOn: false }), 'नहीं।', opening).some((t: any) => t.function.name === 'end_call'), 'end_call is offered after the decline');
  expect(/NOT a good time/.test(phoneTurnHints({ callerText: 'नहीं।', lastAssistantText: opening }) || ''), 'the reply is told not to pitch');
  expect(['पता नहीं आईडिया नहीं है मेरे को।', "I don't know", 'aap hi batao', 'Not sure, honestly.'].every(isUnsureCaller) && !isUnsureCaller('Motor insurance chahiye'), 'unsure callers are recognised');
  const hint = phoneTurnHints({ callerText: 'पता नहीं आईडिया नहीं है मेरे को।', askedQuestions: ['आपको किस प्रकार का insurance चाहिए?'] }) || '';
  expect(/ALREADY asked/.test(hint) && /किस प्रकार का insurance/.test(hint) && /unsure/.test(hint), 'hints list the questions already asked and the unsure-caller rule', hint);
  expect(phoneTurnHints({ callerText: 'Motor insurance ke baare mein bataiye' }) === null, 'no hints on an ordinary turn');
  expect(JSON.stringify(questionsIn('हमारे पास Health और Motor हैं। आपको किस प्रकार का insurance चाहिए?')) === JSON.stringify(['आपको किस प्रकार का insurance चाहिए?']), 'questions are picked out of a reply');
  expect(validOpener('जी, हमारे पास insurance options की बात करें तो,', ctx('कौन-कौन से हैं आपके पास?')) === null && validOpener('Right, we have a few plans,', ctx('What plans do you have?')) === null, 'an opener that starts the answer ("हमारे पास", "we have") is refused');
  expect(validOpener('अरे, options का आईडिया नहीं है…', ctx('पता नहीं आईडिया नहीं है मेरे को।')) === null, 'an opener echoing "I don\'t know" is refused');
  expect(dropEchoedClause('Health और Motor: दोनों मिलते हैं।', 'जी, health और motor,') === 'दोनों मिलते हैं।', 'a first clause ending in ":" that repeats the opener is dropped');
  expect(/this is Anika, an AI assistant from ArhamSecure/.test(buildOpeningLine({ direction: 'outbound', businessName: 'ArhamSecure', assistantName: 'Anika' }).text), 'a named assistant still says it is an AI in the opening');
  const named = buildPhoneInstructions({ direction: 'outbound', businessName: 'ArhamSecure', transferAvailable: false, maxCallMinutes: 5, timezone: 'Asia/Kolkata', leadCaptureOn: false, assistantName: 'Anika' });
  expect(/your name is Anika/.test(named) && /is this a good time/.test(named), 'phone rules carry the name and the "not a good time" rule');
  // A long purpose reaches the AI in full (a 1,318-character one lost its closing rules, 2026-10-24).
  const { CALL_PURPOSE_MAX } = await import('@shared/aiCalling');
  const longPurpose = `${'Explain the programme and answer questions. '.repeat(40)}Never end the call without securing the next step.`.slice(-CALL_PURPOSE_MAX);
  const withPurpose = buildPhoneInstructions({ direction: 'outbound', businessName: 'ArhamSecure', transferAvailable: false, maxCallMinutes: 5, timezone: 'Asia/Kolkata', leadCaptureOn: false, callPurpose: longPurpose });
  expect(longPurpose.length === CALL_PURPOSE_MAX && withPurpose.includes(longPurpose.trim()), 'the whole call purpose (up to the save limit) is in the phone rules', longPurpose.length);

  // ── spoken-answer guards (live call 2026-10-17) ──
  const { repeatsAskedQuestion, isPromiseOnly, stripContinuationStart } = await import('../calling/phonePrompt');
  const askedQ = ['Aapko kaunsa insurance plan chahiye?', 'Health, motor ya life insurance?'];
  expect(repeatsAskedQuestion('Aapko kis type ka insurance chahiye?', askedQ) && repeatsAskedQuestion('What type of insurance are you considering?', askedQ) && repeatsAskedQuestion('Health, motor ya life insurance?', askedQ), 'the same question reworded / in English counts as asked');
  expect(!repeatsAskedQuestion('Aapko kaunsa health plan chahiye — basic ya premium?', askedQ) && !repeatsAskedQuestion('Aapki family mein kitne log hain?', askedQ) && !repeatsAskedQuestion('Aapko kaunsa insurance plan chahiye.', askedQ), 'a new question (or no question) is not a repeat');
  expect(['अच्छा, तो चलिए, मैं आपको बताती हूँ।', 'Let me explain.', "Sure, I'll tell you.", 'Main aapko batati hoon.'].every(isPromiseOnly), 'a bare promise is recognised');
  expect(!isPromiseOnly('मैं आपको बताती हूँ, ज़्यादातर लोग family floater लेते हैं।') && !isPromiseOnly('Let me explain the premium: it depends on age.'), 'a promise with content is not');
  expect(stripContinuationStart('...toh aapko kis type ka insurance pasand hai?') === 'Aapko kis type ka insurance pasand hai?' && stripContinuationStart('…what type of insurance?') === 'What type of insurance?' && stripContinuationStart('Theek hai.') === 'Theek hai.', 'replies never start with "…" / "…toh"');

  // ── Hinglish in Roman letters → Devanagari before it is spoken ──
  const { isRomanHinglish, hinglishToDevanagari } = await import('../voice/hinglishToDevanagari');
  expect(['Koi baat nahi ji! Aapko jab bhi insurance ki zaroorat ho, hum yahan hain madad ke liye.', 'Haan, main yahan hoon! Aapko kya chahiye?', 'Achha, aapko insurance ke liye kya chahiye?'].every(isRomanHinglish), 'Roman-letter Hindi is recognised');
  expect(!['Health insurance is essential.', 'Is this for yourself, or for your family?', 'कोई बात नहीं जी।', 'Thank you so much!', 'Okay.', 'Do you have a car?'].some(isRomanHinglish), 'English and Devanagari are left alone');
  const conv = hinglishToDevanagari('Koi baat nahi ji! Aapko jab bhi insurance ki zaroorat ho, hum yahan hain madad ke liye.');
  expect(conv === 'कोई बात नहीं जी! आपको जब भी insurance की ज़रूरत हो, हम यहाँ हैं मदद के लिए.' || conv === 'कोई बात नहीं जी! आपको जब भी insurance की ज़रूरत हो, हम यहाँ हैं मदद के लिए।', 'Hindi words go to Devanagari, English words stay', conv);
  expect(hinglishToDevanagari('Theek hai ji, main kal shaam 6 baje call karungi.') === 'ठीक है जी, मैं कल शाम 6 बजे call करूँगी।', 'numbers and English words survive, the full stop becomes a danda', hinglishToDevanagari('Theek hai ji, main kal shaam 6 baje call karungi.'));
  expect(hinglishToDevanagari('Health insurance is essential.') === 'Health insurance is essential.', 'English is unchanged');

  // ── end of turn: unfinished-sounding turns hold the reply ──
  const { soundsUnfinished } = await import('../calling/phonePrompt');
  expect(['मुझे', 'मुझे वो', 'I want health insurance and', 'Matlab', 'हेल्थ इंश्योरेंस और…', 'So,', 'Mere parents ke'].every(soundsUnfinished), 'unfinished-sounding turns are recognised');
  expect(!['हाँ बोलो।', 'Health insurance.', 'प्रीमियम कितना होगा?', 'Kal shaam ko call karna.', 'No, leave it. Thank you.', 'Just me and my wife.', 'Health insurance का बता दो आप।', 'Kya bataoge aap?'].some(soundsUnfinished), 'complete turns are not held');

  // ── background sound ──
  const { buildCallCentreLoop, CallAmbience, AMBIENCE_LOOP_SECONDS } = await import('../calling/ambience');
  const loop = buildCallCentreLoop(8000);
  let sq = 0; let pk = 0;
  for (const v of loop) { sq += v * v; pk = Math.max(pk, Math.abs(v)); }
  const rmsDb = 20 * Math.log10(Math.sqrt(sq / loop.length) / 32768), peakDb = 20 * Math.log10(pk / 32768);
  expect(loop.length === AMBIENCE_LOOP_SECONDS * 8000 && rmsDb > -46 && rmsDb < -38 && peakDb < -20, 'the call-centre loop is quiet (about −42 dBFS, peaks under −20 dBFS)', { rmsDb, peakDb });
  expect(buildCallCentreLoop(8000).every((v, i) => v === loop[i]), 'the loop is the same every time (seeded)');
  const amb = new CallAmbience(8000, () => 0);
  const voice = Buffer.alloc(640); for (let i = 0; i < 320; i++) voice.writeInt16LE(i % 2 ? 32000 : -32000, i * 2);
  const mixed = amb.mix(voice);
  expect(mixed.length === voice.length && voice.readInt16LE(0) === -32000 && mixed.readInt16LE(2) <= 32767, 'mixing keeps the length, never changes the input and never overflows');
  expect(new CallAmbience(8000, () => 0).next(960).equals(Buffer.from(loop.buffer, loop.byteOffset, 960)), 'ambience-only chunks come straight from the loop');

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll phone turn checks passed.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
