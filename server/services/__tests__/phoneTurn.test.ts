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

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll phone turn checks passed.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
