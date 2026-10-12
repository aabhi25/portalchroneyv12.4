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

  // ── Hedged request: a sentence whose request stalls is sent again, never skipped ──────────
  const { OPENAI_TTS_HEDGE_MS } = await import('../voice/openaiTts');
  expect(tutor.hedgeAfterMs === OPENAI_TTS_HEDGE_MS && OPENAI_TTS_HEDGE_MS >= 1000 && OPENAI_TTS_HEDGE_MS <= 2000, 'OpenAI voices hedge a stalled sentence well before the 6 s give-up', OPENAI_TTS_HEDGE_MS);
  const stall = (signal: AbortSignal) => new Promise<void>((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  // Scripted attempts per sentence: each entry is how attempt #k behaves.
  function scriptedProvider(name: string, attempts: Record<string, Array<(s: AbortSignal, on: (b: Buffer) => void) => Promise<void>>>, extra: Record<string, unknown> = {}) {
    const log: Array<{ text: string; k: number; aborted: boolean }> = [];
    const provider = { name, ...extra, synthesize: async (text: string, signal: AbortSignal, onChunk: (b: Buffer) => void) => {
      const k = log.filter((l) => l.text === text).length;
      const entry = { text, k, aborted: false };
      log.push(entry);
      signal.addEventListener('abort', () => { entry.aborted = true; }, { once: true });
      const behave = attempts[text]?.[k] ?? (async (_s, on) => { await sleep(20); on(Buffer.alloc(480, 9)); });
      await behave(signal, onChunk);
    } };
    return { provider, log };
  }
  async function speak(provider: any, texts: string[], opts: Record<string, unknown> = {}) {
    const sent: number[] = [];
    const failures: string[] = [];
    const p = new SentenceTtsPipeline({ primary: provider, sendAudio: (pcm) => sent.push(pcm[0]), onProviderFailure: (_n, _e, t) => failures.push(t), ...opts });
    for (const t of texts) p.enqueue(t);
    p.close(); await p.finished();
    return { sent, failures, summary: p.sentenceSummary(), pipeline: p };
  }

  // 1) First request stalls → hedge after 100 ms streams → spoken once, stalled request aborted.
  {
    const { provider, log } = scriptedProvider('openai', { B: [(s) => stall(s), async (_s, on) => { await sleep(30); on(Buffer.alloc(480, 2)); }] }, { hedgeAfterMs: 100 });
    const r = await speak(provider, ['A', 'B', 'C'], { firstChunkTimeoutMs: 1000 });
    expect(r.failures.length === 0 && r.sent.filter((b) => b === 2).length === 1, 'stalled sentence is hedged and spoken (not skipped)', r);
    expect(log.filter((l) => l.text === 'B').length === 2 && log.find((l) => l.text === 'B' && l.k === 0)?.aborted, 'the stalled request is aborted once the hedge wins', log);
    expect(/^\d+,h\d+,\d+$/.test(r.summary), 'summary marks the hedged sentence', r.summary);
  }
  // 2) Both requests eventually stream: only the first to start is played (no doubled words).
  {
    const { provider, log } = scriptedProvider('openai', { B: [
      async (s, on) => { await sleep(150); if (!s.aborted) { on(Buffer.alloc(480, 3)); await sleep(30); on(Buffer.alloc(480, 3)); } },
      async (s, on) => { await sleep(300); if (!s.aborted) on(Buffer.alloc(480, 4)); },
    ] }, { hedgeAfterMs: 100 });
    const r = await speak(provider, ['B'], { firstChunkTimeoutMs: 1000 });
    expect(r.sent.filter((b) => b === 3).length === 2 && !r.sent.includes(4), 'original wins → its audio only; the hedge is dropped', r.sent);
    expect(log[1]?.aborted, 'the losing hedge request is aborted', log);
  }
  // 3) Request fails before any audio (e.g. 400) → hedge sent at once, sentence spoken.
  {
    const { provider, log } = scriptedProvider('openai', { B: [async () => { throw Object.assign(new Error('bad'), { status: 400 }); }] }, { hedgeAfterMs: 2000 });
    const t0 = Date.now();
    const r = await speak(provider, ['B'], { firstChunkTimeoutMs: 3000 });
    expect(r.failures.length === 0 && r.sent.length === 1 && Date.now() - t0 < 500 && log.length === 2, 'early failure → immediate second request, no wait for the hedge timer', { r, ms: Date.now() - t0, calls: log.length });
  }
  // 4) Both stall → reported as not spoken after the timeout; the next sentence still plays.
  {
    const { provider } = scriptedProvider('openai', { B: [(s) => stall(s), (s) => stall(s)] }, { hedgeAfterMs: 50 });
    const r = await speak(provider, ['A', 'B', 'C'], { firstChunkTimeoutMs: 300 });
    expect(r.failures.join() === 'B' && r.sent.length === 2 && /^\d+,✗,\d+$/.test(r.summary), 'both stalled → one failure, ✗ in summary, answer carries on', r);
  }
  // 5) No hedgeAfterMs (ElevenLabs) → exactly one request, as before.
  {
    const { provider, log } = scriptedProvider('elevenlabs', { B: [(s) => stall(s)] });
    const r = await speak(provider, ['B'], { firstChunkTimeoutMs: 200 });
    expect(log.length === 1 && r.failures.join() === 'B', 'providers without a hedge still make a single request', log);
  }
  // 6) Interruption while hedging → every request aborted, nothing sent afterwards.
  {
    const { provider, log } = scriptedProvider('openai', { B: [(s) => stall(s), (s) => stall(s)] }, { hedgeAfterMs: 30 });
    const sent: number[] = [];
    const p = new SentenceTtsPipeline({ primary: provider as any, sendAudio: (pcm) => sent.push(pcm[0]), firstChunkTimeoutMs: 5000 });
    p.enqueue('B'); p.close();
    await sleep(80); p.cancel(); await p.finished(); await sleep(20);
    expect(log.length === 2 && log.every((l) => l.aborted) && sent.length === 0, 'cancel aborts the original and the hedge', log);
  }
  // 7) Cached phrases show as "c" in the summary.
  {
    const p = new SentenceTtsPipeline({ primary: scriptedProvider('openai', {}).provider as any, sendAudio: () => undefined });
    p.enqueueAudio(Buffer.alloc(480, 1), 'filler'); p.enqueue('A'); p.close(); await p.finished();
    expect(/^c,\d+$/.test(p.sentenceSummary()), 'summary: cached filler then a spoken sentence', p.sentenceSummary());
  }

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll ChatGPT-voice TTS checks passed.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
