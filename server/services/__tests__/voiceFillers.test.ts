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
  expect(fem.some((p) => /dekhti hoon/.test(p)) && !fem.some((p) => /dekhta/.test(p)), 'female assistant: "main dekhti hoon"', fem);
  expect(male.some((p) => /dekhta hoon/.test(p)) && !male.some((p) => /dekhti/.test(p)), 'male assistant: "main dekhta hoon"', male);
  expect(!neutral.some((p) => /dekht[ai] hoon/.test(p)), 'unknown gender: only gender-neutral Hindi phrases', neutral);
  const all = [...f.fillerPhrases('en', null), ...fem, ...male];
  expect(!all.some((p) => /team|call you|get back|email|whatsapp/i.test(p)) && all.every((p) => p.split(' ').length <= 6), 'phrases are short and promise nothing', all);

  // Rotation
  const seq: string[] = [];
  let last: string | undefined;
  for (let i = 0; i < 30; i++) { last = f.pickFiller('en', null, last); seq.push(last); }
  expect(seq.every((p, i) => i === 0 || p !== seq[i - 1]), 'never the same phrase twice running');
  expect(new Set(seq).size === f.fillerPhrases('en', null).length, 'all phrases get used over a call');

  // Timing
  const now = 100_000;
  expect(f.fillerDelayMs(now - 300, now) === 400, 'fires 0.7 s after the end of speech was detected', f.fillerDelayMs(now - 300, now));
  expect(f.fillerDelayMs(now - 5000, now) === f.FILLER_MIN_DELAY_MS, 'never immediately — a fast answer still wins');
  expect(f.fillerDelayMs(undefined, now) === 700, 'no stop time (held turn) → 0.7 s from now');

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
