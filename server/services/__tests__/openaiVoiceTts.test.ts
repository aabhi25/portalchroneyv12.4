/**
 * ChatGPT voices (OpenAI TTS) in voice mode: the provider (instructions, voice, retry) and the
 * pipeline's per-sentence hold + parallelism. Run: npx tsx server/services/__tests__/openaiVoiceTts.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused'; // never queried here

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { createOpenAiTtsProvider, OPENAI_TTS_PREBUFFER_MS, OPENAI_TTS_PARALLEL } = await import('../voice/openaiTts');
  const { SentenceTtsPipeline } = await import('../voice/ttsPipeline');

  // ── Provider ────────────────────────────────────────────────────────────
  const calls: any[] = [];
  let script: Array<() => Promise<any>> = [];
  const fakeClient = { audio: { speech: { create: async (body: any) => { calls.push(body); const next = script.shift(); return next ? next() : streamOf([Buffer.alloc(4800, 1)]); } } } };
  function streamOf(chunks: Buffer[], delays: number[] = []) {
    return { body: { async *[Symbol.asyncIterator]() { for (let i = 0; i < chunks.length; i++) { if (delays[i]) await sleep(delays[i]); yield chunks[i]; } } }, arrayBuffer: async () => new ArrayBuffer(0) };
  }
  const tutor = createOpenAiTtsProvider({ client: fakeClient as any, voice: 'nova', tutor: true, retryDelayMs: 10 });
  const got: number[] = [];
  await tutor.synthesize('Two plus two is four.', new AbortController().signal, (pcm) => got.push(pcm.length));
  const b = calls[0];
  expect(b.model === 'gpt-4o-mini-tts' && b.voice === 'nova' && b.response_format === 'pcm' && b.input === 'Two plus two is four.', 'request: gpt-4o-mini-tts, chosen voice, raw PCM', b);
  expect(/native Hindi speaker/.test(b.instructions) && /patient, encouraging tutor/.test(b.instructions), 'speaking instructions: natural Hindi pronunciation + tutor style (TopScholar/K12)', b.instructions);
  expect(got.join(',') === '4800', 'audio streamed through');
  const plain = createOpenAiTtsProvider({ client: fakeClient as any, voice: 'not-a-voice' });
  await plain.synthesize('Hi.', new AbortController().signal, () => undefined);
  expect(calls[1].voice === 'shimmer' && !/tutor/.test(calls[1].instructions), 'unknown voice → shimmer; non-tutor accounts get no tutor wording', calls[1]);
  expect(tutor.prebufferMs === OPENAI_TTS_PREBUFFER_MS && OPENAI_TTS_PREBUFFER_MS >= 300 && tutor.preferredParallel === OPENAI_TTS_PARALLEL && OPENAI_TTS_PARALLEL >= 4, 'OpenAI voices: ~0.35 s hold per sentence and 4 sentences in flight', { hold: tutor.prebufferMs, parallel: tutor.preferredParallel });

  // Retry once on a rate limit / 5xx before any audio; never after audio; never on a 400.
  calls.length = 0;
  script = [async () => { throw Object.assign(new Error('Rate limit'), { status: 429 }); }];
  const r1: number[] = [];
  await plain.synthesize('Retry me.', new AbortController().signal, (pcm) => r1.push(pcm.length));
  expect(calls.length === 2 && r1.length === 1, '429 before audio → one retry, sentence still spoken', calls.length);
  calls.length = 0;
  script = [async () => { throw Object.assign(new Error('Bad request'), { status: 400 }); }];
  let e400: any = null;
  try { await plain.synthesize('Bad.', new AbortController().signal, () => undefined); } catch (e) { e400 = e; }
  expect(e400?.status === 400 && calls.length === 1, '400 → no retry (fails over / reported)', calls.length);
  calls.length = 0;
  script = [async () => ({ body: { async *[Symbol.asyncIterator]() { yield Buffer.alloc(4800, 2); throw Object.assign(new Error('reset'), { code: 'ECONNRESET' }); } }, arrayBuffer: async () => new ArrayBuffer(0) })];
  let eMid: any = null;
  try { await plain.synthesize('Mid.', new AbortController().signal, () => undefined); } catch (e) { eMid = e; }
  expect(eMid && calls.length === 1, 'failure after audio started → no retry (would repeat words)', calls.length);
  calls.length = 0;
  script = [async () => { throw Object.assign(new Error('boom'), { status: 503 }); }, async () => { throw Object.assign(new Error('boom'), { status: 503 }); }];
  let e503: any = null;
  try { await plain.synthesize('Twice.', new AbortController().signal, () => undefined); } catch (e) { e503 = e; }
  expect(e503?.status === 503 && calls.length === 2, 'only ONE retry', calls.length);

  // ── Pipeline: per-sentence hold (OpenAI) vs immediate (ElevenLabs) ─────────
  const ms = (n: number) => Buffer.alloc(n * 48, 7); // n ms of PCM16 @ 24 kHz
  function timedProvider(name: string, chunks: Array<[delayMs: number, lenMs: number]>, extra: Record<string, unknown> = {}) {
    return { name, ...extra, synthesize: async (_t: string, _s: AbortSignal, onChunk: (b: Buffer) => void) => { for (const [d, l] of chunks) { await sleep(d); onChunk(ms(l)); } } };
  }
  // OpenAI-like burst: 40 ms of audio, a 180 ms pause, then the rest.
  const burst: Array<[number, number]> = [[20, 40], [180, 200], [10, 400], [10, 400]];
  async function firstSends(provider: any): Promise<Array<[number, number]>> {
    const t0 = Date.now(); const sends: Array<[number, number]> = [];
    const p = new SentenceTtsPipeline({ primary: provider, sendAudio: (pcm) => sends.push([Date.now() - t0, pcm.length / 48]) });
    p.enqueue('Sentence one.'); p.close(); await p.finished();
    return sends;
  }
  const held = await firstSends(timedProvider('openai', burst, { prebufferMs: 350 }));
  const atRelease = held.filter(([t]) => t - held[0][0] < 5).reduce((n, [, l]) => n + l, 0);
  expect(held[0][0] >= 190 && atRelease >= 240, 'OpenAI: nothing released until ≥ the hold, then released together (no 40 ms blip then silence)', { firstAt: held[0][0], releasedAtOnceMs: atRelease });
  const immediate = await firstSends(timedProvider('elevenlabs', burst));
  expect(immediate[0][1] === 40 && immediate[0][0] < 100, 'ElevenLabs (no hold): released immediately, exactly as before', immediate);

  // Simulated browser playback: playback starts at the first released audio; a gap = audio needed but not there yet.
  function worstGap(sends: Array<[number, number]>): number {
    let playhead = sends[0][0], gap = 0;
    for (const [t, len] of sends) { if (t > playhead) { gap = Math.max(gap, t - playhead); playhead = t; } playhead += len; }
    return Math.round(gap);
  }
  expect(worstGap(immediate) >= 120 && worstGap(held) <= 20, 'the burst pause no longer reaches the speaker (stutter 120+ ms → ≤ 20 ms)', { before: worstGap(immediate), after: worstGap(held) });

  // Short sentence entirely below the hold: released when complete (never stuck).
  const shortS = await firstSends(timedProvider('openai', [[10, 100], [10, 100]], { prebufferMs: 350 }));
  expect(shortS.reduce((n, [, l]) => n + l, 0) === 200, 'a sentence shorter than the hold is released when complete', shortS);

  // Parallelism: 4 in flight for OpenAI, 2 for others; order preserved.
  async function inFlightPeak(provider: any, n: number) {
    let live = 0, peak = 0; const order: number[] = [];
    const prov = { ...provider, synthesize: async (t: string, _s: AbortSignal, onChunk: (b: Buffer) => void) => { live++; peak = Math.max(peak, live); await sleep(60); onChunk(Buffer.alloc(480, Number(t))); live--; } };
    const p = new SentenceTtsPipeline({ primary: prov, sendAudio: (pcm) => order.push(pcm[0]) });
    for (let i = 1; i <= n; i++) p.enqueue(String(i));
    p.close(); await p.finished();
    return { peak, order: order.join(',') };
  }
  const openaiPar = await inFlightPeak({ name: 'openai', preferredParallel: 4, prebufferMs: 350 }, 6);
  const elevenPar = await inFlightPeak({ name: 'elevenlabs' }, 6);
  expect(openaiPar.peak === 4 && openaiPar.order === '1,2,3,4,5,6', 'OpenAI: 4 sentences synthesised at once, played in order', openaiPar);
  expect(elevenPar.peak === 2 && elevenPar.order === '1,2,3,4,5,6', 'ElevenLabs: still 2 at once (unchanged)', elevenPar);

  // Hold + following sentences: the next sentence (already synthesised) flows right after.
  const t0 = Date.now(); const seq: Array<[number, number]> = [];
  const two = new SentenceTtsPipeline({ primary: { name: 'openai', prebufferMs: 350, preferredParallel: 4, synthesize: async (t, _s, onChunk) => { await sleep(t === 'a' ? 30 : 60); onChunk(ms(t === 'a' ? 500 : 600)); } } as any, sendAudio: (pcm) => seq.push([Date.now() - t0, pcm.length / 48]) });
  two.enqueue('a'); two.enqueue('b'); two.close(); await two.finished();
  expect(seq.length === 2 && seq[0][1] === 500 && seq[1][1] === 600, 'consecutive sentences released in order without loss', seq);

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll ChatGPT-voice TTS checks passed.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
