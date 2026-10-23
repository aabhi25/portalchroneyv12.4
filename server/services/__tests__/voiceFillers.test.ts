/**
 * Video-call fillers: when, which language/gender, rotation, timing; and the TTS pipeline's
 * ready-made audio slot. Run: npx tsx server/services/__tests__/voiceFillers.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused'; // never queried here

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const f = await import('../voice/fillers');

  // When
  const yes = ['What are the fees for the maths course?', 'Do you have weekend classes for class ten?', 'Kya weekend classes hain aapke yahan?', 'मुझे एडमिशन के बारे में जानना है'];
  expect(yes.every((t) => f.wantsFiller({ transcript: t })), 'real questions get a filler when late', yes.filter((t) => !f.wantsFiller({ transcript: t })));
  const no = ['How are you?', 'how are you doing', 'Hi there', 'thank you so much', 'ok', 'yes please', 'Rahul', '98765 43210', 'kaise ho aap', 'who are you exactly', 'what is your name please'];
  expect(no.every((t) => !f.wantsFiller({ transcript: t })), 'never for small talk, short replies, names, numbers, "who are you"', no.filter((t) => f.wantsFiller({ transcript: t })));
  expect(!f.wantsFiller({ transcript: 'What are the fees for the maths course?', lastTurnHadFiller: true }), 'never two turns in a row');
  const devanagariThanks = ['ठीक है, थैंक यू।', 'ओके, थैंक्स।', 'थैंक यू सो मच।', 'ओके बाय बाय।', 'अच्छा, थैंक यू जी।'];
  expect(devanagariThanks.every((t) => !f.wantsFiller({ transcript: t })), 'never for English thanks / bye written in Hindi script (live call: "ठीक है, थैंक यू।" → "Ek second, check kar lete hain.")', devanagariThanks.filter((t) => f.wantsFiller({ transcript: t })));
  expect(f.wantsFiller({ transcript: 'थैंक यू, फीस कितनी है?' }), 'thanks plus a real question still gets a filler');
  const meta = ['Can you hear me?', 'Hey, can you hear me?', 'Am I audible to you?', "What's your name?", 'What’s your name?', 'Do you know my name?', 'Are you still there?', 'Are you a real person?', 'Meri awaaz aa rahi hai kya?', 'Aap mujhe sun rahe ho?', 'Aapka naam kya hai?', 'क्या मेरी आवाज़ आ रही है?'];
  expect(meta.every((t) => !f.wantsFiller({ transcript: t })), 'never for questions about the assistant or the connection (seen live: "Can you hear me?" → "Okay, let me see.")', meta.filter((t) => f.wantsFiller({ transcript: t })));
  expect(f.wantsFiller({ transcript: 'Can you suggest some maths courses?' }) && f.wantsFiller({ transcript: 'What is the name of your maths course?' }), 'real questions that mention "you"/"name" still qualify');

  // Language
  expect(f.fillerLanguage('What are the fees for the maths course?') === 'en', 'English question → English filler');
  expect(f.fillerLanguage('मुझे क्लास टेन मैथ्स के लिए ट्यूटर चाहिए') === 'hi', 'Devanagari → Hindi filler');
  expect(f.fillerLanguage('Mujhe class ten maths ke liye tutor chahiye, aap kaise help karoge?') === 'hi', 'Hinglish (Roman) → Hindi filler');
  expect(f.fillerLanguage('Do you have a class on Monday?') === 'en', 'an English sentence with "a"/"on" is still English');
  expect(f.fillerLanguage('உங்கள் கட்டணம் என்ன?') === null, 'other scripts (Tamil) → no filler (no phrase set)');
  expect(f.fillerLanguage('What are the fees?', 'hi') === 'hi' && f.fillerLanguage('kya hai', 'en') === 'en' && f.fillerLanguage('hello', 'ta') === null, 'explicit widget language wins');

  // Gender + promise-free phrases
  const fem = f.fillerPhrases('hi', 'female'), male = f.fillerPhrases('hi', 'male'), neutral = f.fillerPhrases('hi', null);
  expect(fem.some((p) => /sakti hoon/.test(p)) && !fem.some((p) => /sakta|dekhta/.test(p)), 'female assistant: "main samajh sakti hoon"', fem);
  expect(male.some((p) => /sakta hoon/.test(p)) && !male.some((p) => /sakti|dekhti/.test(p)), 'male assistant: "main samajh sakta hoon"', male);
  expect(!neutral.some((p) => /(sakt|dekht|kart)[ai] hoon/.test(p)), 'unknown gender: only gender-neutral Hindi phrases', neutral);
  expect(![...f.fillerPhrases('en', null), ...fem, ...male].some((p) => /good question|achha sawal|^(hmm|umm)/i.test(p)), 'no "Hmm, good question." / "Umm…" before an answer (sounds unsure)', [...f.fillerPhrases('en', null), ...fem, ...male].filter((p) => /good question|achha sawal|^(hmm|umm)/i.test(p)));
  expect(f.FILLER_KINDS.every((k) => f.fillerPhrasesFor(k, 'en', null).length >= 3 && f.fillerPhrasesFor(k, 'hi', null).length >= 2), 'every reaction has several phrases in both languages');
  const all = [...f.fillerPhrases('en', null), ...fem, ...male];
  expect(!all.some((p) => /team|call you|get back|email|whatsapp/i.test(p)) && all.every((p) => p.split(' ').length <= 6), 'phrases are short and promise nothing', all);

  // Rotation
  const recent: string[] = [];
  const picks: string[] = [];
  for (let i = 0; i < 40; i++) { const p = f.pickFiller('hi', 'female', recent, Math.random, 'ack'); picks.push(p); recent.push(p); }
  const ackCount = f.fillerPhrasesFor('ack', 'hi', 'female').length;
  const window = Math.min(f.FILLER_NO_REPEAT, ackCount - 1);
  expect(picks.every((p, i) => !picks.slice(Math.max(0, i - window), i).includes(p)), `none of the call's last ${window} phrases again`, picks.slice(0, 10));
  const seq: string[] = [];
  let last: string | undefined;
  for (let i = 0; i < 30; i++) { last = f.pickFiller('en', null, last); seq.push(last); }
  expect(seq.every((p, i) => i === 0 || p !== seq[i - 1]), 'never the same phrase twice running');
  expect(new Set(seq).size === f.fillerPhrasesFor('lookup', 'en', null).length, 'all phrases of the kind get used over a call');

  // Reaction kinds (phone calls): what fits what the caller said
  const kind = (t: string, last?: string) => f.fillerKind({ transcript: t, lastAssistantText: last, phone: true });
  expect(kind("What's the premium for a family of four?") === 'lookup' && kind('Kitna premium hai family ke liye?') === 'lookup', 'real questions → "let me check" kind', [kind("What's the premium for a family of four?"), kind('Kitna premium hai family ke liye?')]);
  expect(kind('Which plan is better for me?') === 'thinking' && kind('Konsa plan sahi rahega?') === 'thinking', 'advice / comparison → "hmm, good question" kind');
  expect(kind('My claim got rejected last week') === 'empathy' && kind('Mujhe claim mein bahut dikkat ho rahi hai') === 'empathy', 'a problem → "I understand" kind');
  expect(kind('I want health insurance for my parents') === 'ack' && kind('Health insurance.') === 'ack', 'telling us something / a short answer → "okay, got it" kind');
  const silent = ['No, not interested', 'nahi chahiye', 'Can you tell me in English?', 'Who is speaking?', 'कौन बोल रहा है?', 'Hello?', 'ok thanks', '98105 60800', 'Can you hear me?'];
  expect(silent.every((t) => kind(t) === null), 'no filler for refusals, language switch, who-is-calling, hello, small talk, numbers', silent.filter((t) => kind(t) !== null));
  expect(kind('आप मुझे बाद में कॉल करना, ठीक है?') === 'ack' && kind('Call me back tomorrow evening please') === 'ack', 'call-back request → "Achha, theek hai." (seen live: it got "main dekhti hoon")', [kind('आप मुझे बाद में कॉल करना, ठीक है?')]);
  expect(kind('फिर से बताओ, फिर से बताओ।') === 'repeat' && kind('phir se batao') === 'repeat' && kind('फिर से बताना।') === 'repeat' && kind('Can you tell me again in English?') === 'repeat', '"say it again" → "Haan ji, zaroor." (seen live: 3.5 s of silence)', [kind('फिर से बताना।'), kind('Can you tell me again in English?')]);
  expect(f.fillerKind({ transcript: 'phir se batao' }) === null, 'video avatar: no "repeat" reaction (its rule is unchanged)');
  expect(kind('आप health insurance देते हो?') === 'ack' || kind('आप health insurance देते हो?') === 'lookup', 'Hindi "?" alone does not force a lookup filler');
  expect(kind('क्या तुम') === null && kind('What is') === null, 'a cut-off question ("क्या तुम") → no filler (seen live: "Achha, theek hai." before "I didn\'t catch that")', kind('क्या तुम'));
  expect(f.fillerKind({ transcript: 'Health insurance.' }) === null, 'video avatar keeps its rule (no filler for a 2-word reply)');
  for (const k of f.FILLER_KINDS) {
    const fe = f.fillerPhrasesFor(k, 'hi', 'female').join(' '), ma = f.fillerPhrasesFor(k, 'hi', 'male').join(' ');
    expect(!/dekhta|sakta/.test(fe) && !/dekhti|sakti/.test(ma), `Hindi "${k}" phrases match the voice's gender`, { fe, ma });
  }
  expect(f.fillerPhrases('en', null).some((p) => /^(Hmm|Umm|Right|Mm)/.test(p)) && f.fillerPhrases('hi', null).some((p) => /^(Haan|Achha|Hmm|Umm)/.test(p)), 'natural sounds: Hmm / Umm / Right / Haan / Achha');
  expect(f.pickFiller('en', null, null, () => 0, 'empathy') === 'Oh, I understand.', 'pick by kind');

  // After a filler the answer drops its own opening reaction
  expect(f.stripLeadingInterjection('Sure! We have four types of plans.') === 'We have four types of plans.', '"Sure! We have…" → "We have…"');
  expect(f.stripLeadingInterjection('Haan ji, aapke liye health plan hai.') === 'Aapke liye health plan hai.', '"Haan ji, …" dropped (Hinglish)');
  expect(f.stripLeadingInterjection('Okay.') === 'Okay.' && f.stripLeadingInterjection('We offer health plans.') === 'We offer health plans.', 'never empties a sentence; plain answers unchanged');

  // Timing
  const now = 100_000;
  expect(f.fillerDelayMs(now - 300, now) === 400, 'fires 0.7 s after the end of speech was detected', f.fillerDelayMs(now - 300, now));
  expect(f.fillerDelayMs(now - 5000, now) === f.FILLER_MIN_DELAY_MS, 'never immediately — a fast answer still wins');
  expect(f.fillerDelayMs(undefined, now) === 700, 'no stop time (held turn) → 0.7 s from now');
  expect(f.fillerDelayMs(now - 300, now, f.PHONE_FILLER_AFTER_STOP_MS) === 400, 'phone calls: opening words 0.7 s after the end of speech (just after the transcript)');

  // Phone calls: turn-opening words that keep the turn (self-call recordings 2026-10-17)
  const phoneAll = [...f.fillerPhrases('en', null, 'phone'), ...f.fillerPhrases('hi', 'female', 'phone'), ...f.fillerPhrases('hi', 'male', 'phone')];
  expect(phoneAll.every((p) => /[…—]$/.test(p) || /I understand\.$|achha\.$|ji\.$/i.test(p)), 'phone phrases trail on ("…" / "—") instead of sounding finished', phoneAll.filter((p) => !/[…—]$/.test(p)));
  expect(!phoneAll.some((p) => /^(got it|let me check that|haan ji)\.?$/i.test(p) || /second\.|minute\./i.test(p)), 'no finished little sentences ("Got it.", "Let me check that.", "Haan ji.")', phoneAll);
  expect(f.FILLER_KINDS.every((k) => f.fillerPhrasesFor(k, 'hi', null, 'phone').length >= 2 && f.fillerPhrasesFor(k, 'en', null, 'phone').length >= 3), 'phone: several openers per reaction, both languages');
  expect(!f.fillerPhrases('hi', 'female', 'phone').some((p) => /sakta|dekhta|gaya\b/.test(p)) && !f.fillerPhrases('hi', 'male', 'phone').some((p) => /sakti|dekhti|gayi\b/.test(p)), 'phone Hindi openers match the voice gender');
  expect(f.fillerPhrasesFor('lookup', 'en', null).includes('Let me check that.'), 'video avatar keeps its own phrases');
  const phonePicks: string[] = [];
  for (let i = 0; i < 20; i++) phonePicks.push(f.pickFiller('hi', 'female', phonePicks, Math.random, 'lookup', 'phone'));
  expect(phonePicks.every((p, i) => !phonePicks.slice(Math.max(0, i - 4), i).includes(p)) && phonePicks.every((p) => f.fillerPhrasesFor('lookup', 'hi', 'female', 'phone').includes(p)), 'phone picks: from the phone set, none of the last 4 again', phonePicks.slice(0, 8));
  expect(f.isOnlyInterjection('Okay, great.') && f.isOnlyInterjection('जी, बिल्कुल।') && !f.isOnlyInterjection('Okay so, we have two plans.'), 'a sentence that is only a reaction is recognised (not spoken after an opener)');
  expect(f.stripLeadingInterjection('Toh motor insurance mein do plans hain.') === 'Motor insurance mein do plans hain.' && f.stripLeadingInterjection('To apply, you need a PAN card.') === 'To apply, you need a PAN card.', '"Toh …" dropped after an opener; English "To apply" kept');

  // Pipeline: ready-made audio plays in order, without synthesis.
  const { SentenceTtsPipeline } = await import('../voice/ttsPipeline');
  const sent: number[] = [];
  const synthCalls: string[] = [];
  const pipeline = new SentenceTtsPipeline({
    primary: { name: 'fake', synthesize: async (text, _signal, onChunk) => { synthCalls.push(text); await sleep(30); onChunk(Buffer.alloc(4800, 2)); } },
    sendAudio: (pcm) => sent.push(pcm[0]),
  });
  pipeline.enqueueAudio(Buffer.alloc(9600, 1), 'Let me check that.');
  pipeline.enqueue('Weekend batches run on Saturday.');
  pipeline.close();
  await pipeline.finished();
  expect(JSON.stringify(sent) === '[1,2]' && JSON.stringify(synthCalls) === '["Weekend batches run on Saturday."]', 'cached filler audio first, then the synthesised answer; filler not re-synthesised', { sent, synthCalls });
  const p2 = new SentenceTtsPipeline({ primary: { name: 'fake', synthesize: async (_t, _s, onChunk) => { await sleep(40); onChunk(Buffer.alloc(4800, 3)); } }, sendAudio: (pcm) => sent.push(pcm[0]) });
  sent.length = 0;
  p2.enqueue('First sentence.');
  p2.enqueueAudio(Buffer.alloc(4800, 4));
  p2.close();
  await p2.finished();
  expect(JSON.stringify(sent) === '[3,4]', 'ready-made audio queued behind a sentence still plays in order', sent);

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll voice filler checks passed.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
