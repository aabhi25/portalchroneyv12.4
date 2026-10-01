/**
 * Turn-handling tests for RealtimeVoiceService with a FAKE OpenAI Realtime
 * socket, a FAKE chat stream, FAKE persistence and FAKE TTS providers.
 * No network, no database (DATABASE_URL points nowhere; nothing queries it).
 *
 * Drives the real event handler (`handleOpenAIMessage`) and client-message
 * handler (`handleClientMessage`) with Realtime events — speech_started /
 * speech_stopped with audio_start_ms/audio_end_ms, transcription completed —
 * and asserts what the browser and the Realtime socket receive.
 *
 * Run: `npx tsx server/services/__tests__/voiceTurnHandling.test.ts`
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused';

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const out = console.log.bind(console);
const outErr = console.error.bind(console);
// The service logs every event; keep the test output to the assertions.
if (process.env.VOICE_TEST_VERBOSE !== '1') {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}

let failed = 0;
let passed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (!cond) {
    failed++;
    outErr(`✗ ${label}${detail !== undefined ? `\n    got: ${JSON.stringify(detail)}` : ''}`);
  } else {
    passed++;
    out(`✓ ${label}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<boolean> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      outErr(`  (timed out waiting for ${label})`);
      return false;
    }
    await sleep(5);
  }
  return true;
}

class FakeSocket {
  readyState = 1; // WebSocket.OPEN
  json: any[] = [];
  binary: Buffer[] = [];
  send(data: any) {
    if (Buffer.isBuffer(data)) this.binary.push(Buffer.from(data));
    else this.json.push(JSON.parse(String(data)));
  }
  on() {}
  close() { this.readyState = 3; }
  types() { return this.json.map((m) => m.type); }
  ofType(type: string) { return this.json.filter((m) => m.type === type); }
}

/** A chat stream the test controls: deltas, optional gates, then `final`. */
type Step = string | { gate: Promise<void> } | { delay: number };
function scriptedStream(steps: Step[], final?: string) {
  return async function* () {
    let all = '';
    for (const step of steps) {
      if (typeof step === 'string') {
        all += step;
        yield { type: 'content', data: step };
      } else if ('gate' in step) {
        await step.gate;
      } else {
        await sleep(step.delay);
      }
    }
    yield { type: 'final', data: final ?? all };
  };
}
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => { open = r; });
  return { promise, open };
}

interface TtsCall { provider: string; text: string; at: number }

async function main() {
  const { RealtimeVoiceService } = await import('../../realtimeVoiceService');
  const { TOPSCHOLAR_ACCOUNT_ID } = await import('../topscholar/config');
  const { markdownToSpeech } = await import('../voice/speechText');

  // ---- harness -------------------------------------------------------------
  type Harness = ReturnType<typeof makeHarness>;
  function makeHarness(opts: {
    businessAccountId?: string;
    elevenlabs?: boolean;
    failElevenLabsOn?: (text: string) => boolean;
    ttsDelayMs?: number;
  } = {}) {
    const svc: any = new RealtimeVoiceService();
    const client = new FakeSocket();
    const openai = new FakeSocket();
    const streamCalls: Array<{ message: string; context: any }> = [];
    const ttsCalls: TtsCall[] = [];
    const commits: string[] = [];
    const rollbacks: string[] = [];
    const streams: Array<() => AsyncGenerator<any>> = [];
    const t0 = Date.now();
    const provider = (name: string, failOn?: (t: string) => boolean) => ({
      name,
      synthesize: async (text: string, signal: AbortSignal, onChunk: (b: Buffer) => void) => {
        ttsCalls.push({ provider: name, text, at: Date.now() - t0 });
        if (failOn?.(text)) throw new Error(`${name} HTTP 500`);
        for (let i = 0; i < 2; i++) {
          await sleep(opts.ttsDelayMs ?? 10);
          if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          const tag = Buffer.from(`[${name}:${text.slice(0, 12)}:${i}]`);
          onChunk(tag.length % 2 ? Buffer.concat([tag, Buffer.from(' ')]) : tag);
        }
      },
    });
    svc.setDepsForTesting({
      streamChat: (message: string, context: any) => {
        streamCalls.push({ message, context });
        const next = streams.shift();
        if (!next) return scriptedStream(['Okay.'])();
        return next();
      },
      commitAssistantMessage: async (_ctx: any, content: string, stillCurrent: () => boolean) => {
        if (!stillCurrent()) return null;
        commits.push(content);
        return `msg-${commits.length}`;
      },
      rollbackAssistantMessage: async (_ctx: any, id: string) => { rollbacks.push(id); },
      createTtsProviders: () => opts.elevenlabs === false
        ? { primary: provider('openai'), fallback: null }
        : { primary: provider('elevenlabs', opts.failElevenLabsOn), fallback: provider('openai') },
    });
    const conversationId = `conv-${Math.random().toString(36).slice(2)}`;
    const conversation: any = {
      clientWs: client,
      openaiWs: openai,
      businessAccountId: opts.businessAccountId ?? 'biz-test',
      userId: 'visitor-1',
      openaiApiKey: 'sk-test-not-used',
      sessionId: null,
      conversationId,
      isProcessing: false,
      currentUserTranscript: '',
      currentAITranscript: '',
      lastHeartbeat: Date.now(),
      journeyResponseTracking: new Map(),
      cancelledResponseIds: new Set<string>(),
      reconnectAttempts: 0,
      isReconnecting: false,
      selectedLanguage: 'en',
      k12ContentOnly: opts.businessAccountId === TOPSCHOLAR_ACCOUNT_ID,
      k12EducationEnabled: opts.businessAccountId === TOPSCHOLAR_ACCOUNT_ID,
      topscholarCpIds: opts.businessAccountId === TOPSCHOLAR_ACCOUNT_ID ? ['cp-1'] : null,
      topscholarScope: null,
      elevenlabsApiKey: opts.elevenlabs === false ? undefined : 'el-test',
      elevenlabsVoiceId: opts.elevenlabs === false ? undefined : 'voice-test',
    };
    svc.conversations.set(conversationId, conversation);
    let item = 0;
    const event = (e: any) => svc.handleOpenAIMessage(conversationId, conversation, Buffer.from(JSON.stringify(e)));
    const clientMessage = (m: any) => svc.handleClientMessage(conversationId, conversation, m);
    /** One spoken utterance: speech_started/stopped with timings, then its transcript. */
    const utter = (text: string, speechMs: number, startAt = 1000 * (item + 1)) => {
      const id = `item_${++item}`;
      event({ type: 'input_audio_buffer.speech_started', item_id: id, audio_start_ms: startAt });
      event({ type: 'input_audio_buffer.speech_stopped', item_id: id, audio_end_ms: startAt + speechMs });
      return event({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text });
    };
    const done = () => { svc.shutdown?.(); };
    return { svc, client, openai, conversation, conversationId, streamCalls, ttsCalls, commits, rollbacks, streams, event, clientMessage, utter, done, t0 };
  }
  const terminalTypes = new Set(['ai_done', 'turn_ignored', 'response_cancelled', 'error', 'voice_control_consumed']);
  const binaryText = (h: Harness) => h.client.binary.map((b) => b.toString()).join('');

  // ---- 1. Speak while writing: first audio after the FIRST sentence ---------
  {
    const h = makeHarness();
    const g = gate();
    h.streams.push(scriptedStream([
      'Photosynthesis is how plants make their food. ',
      { gate: g.promise },
      'They use sunlight, water and carbon dioxide. ',
      'Can you name one input?',
    ]));
    const turn = h.utter('What is photosynthesis?', 1500);
    const firstTts = await waitFor(() => h.ttsCalls.length > 0, 2000, 'first TTS call');
    expect(firstTts, 'TTS request starts while the model is still writing (stream gated after sentence 1)');
    expect(h.ttsCalls[0]?.text === 'Photosynthesis is how plants make their food.', 'first TTS request is exactly the first sentence', h.ttsCalls[0]);
    expect(h.client.ofType('answer_delta').length === 1, 'display text for sentence 1 sent before the answer finishes', h.client.ofType('answer_delta'));
    expect(!h.client.types().includes('answer_ready'), 'answer_ready (final Markdown) not sent yet');
    await waitFor(() => h.client.binary.length > 0, 2000, 'first audio bytes');
    expect(h.client.binary.length > 0, 'audio for sentence 1 reaches the client before the stream ends');
    g.open();
    await turn;
    const order = binaryText(h).match(/\[elevenlabs:[^:]+:\d\]/g) || [];
    expect(order.join(',') === [
      '[elevenlabs:Photosynthes:0]', '[elevenlabs:Photosynthes:1]',
      '[elevenlabs:They use sun:0]', '[elevenlabs:They use sun:1]',
      '[elevenlabs:Can you name:0]', '[elevenlabs:Can you name:1]',
    ].join(','), 'TTS audio arrives in sentence order', order);
    const ready = h.client.ofType('answer_ready')[0];
    expect(ready?.displayMarkdown === 'Photosynthesis is how plants make their food. They use sunlight, water and carbon dioxide. Can you name one input?', 'answer_ready carries the canonical Markdown', ready);
    expect(ready?.speechText === markdownToSpeech(ready?.displayMarkdown), 'spoken text = deterministic conversion of the displayed answer (no second AI rewrite)', ready?.speechText);
    const deltas = h.client.ofType('answer_delta');
    expect(deltas.map((d) => d.display).join('') === ready?.displayMarkdown, 'answer_delta display segments re-join to the final Markdown', deltas.map((d) => d.display));
    expect(h.commits.length === 1, 'assistant message persisted once, when complete');
    const types = h.client.types();
    expect(types.indexOf('answer_ready') < types.lastIndexOf('ai_done'), 'ai_done follows answer_ready');
    expect(h.streamCalls[0]?.context?.voiceResponseStyle === true, 'voice turns ask the model for spoken-style answers');
    expect(h.streamCalls[0]?.context?.responseLength === 'concise', 'voice turns use the concise response length');
    const sessionUpdates = h.openai.ofType('session.update');
    expect(sessionUpdates.every((u) => !('instructions' in (u.session || {}))), 'language detection updates transcription only (no instruction rebuild)', sessionUpdates);
    h.done();
  }

  // ---- 2. Noise transcript while speaking: no turn, no cancel -----------------
  {
    const h = makeHarness({ ttsDelayMs: 40 });
    h.streams.push(scriptedStream(['Plants make food from sunlight in their leaves. ', 'This is called photosynthesis. ', 'Do you see?']));
    const turn = h.utter('How do plants eat?', 1400);
    await waitFor(() => h.client.binary.length > 0, 2000, 'speaking');
    await sleep(750); // past the playback grace window
    const before = h.client.json.length;
    await h.utter('Thank you.', 900);
    const after = h.client.json.slice(before);
    expect(after.some((m) => m.type === 'duck'), 'speech_started during the answer only ducks playback', after.map((m) => m.type));
    const ignored = after.find((m) => m.type === 'turn_ignored');
    expect(ignored?.reason === 'noise_phrase', 'noise transcript → turn_ignored (noise_phrase)', ignored);
    expect(after.some((m) => m.type === 'unduck'), 'playback un-ducks after the noise is rejected', after.map((m) => m.type));
    expect(!after.some((m) => m.type === 'response_cancelled' || m.type === 'thinking'), 'the in-flight answer is NOT cancelled and no thinking state is shown', after.map((m) => m.type));
    await turn;
    expect(h.streamCalls.length === 1, 'noise never reaches the chat pipeline', h.streamCalls.map((c) => c.message));
    expect(h.client.types().includes('ai_done') && h.commits.length === 1, 'the original answer completes and is saved');
    h.done();
  }

  // ---- 3. Noise during GENERATION (before any audio) does not orphan the turn --
  {
    const h = makeHarness();
    const g = gate();
    h.streams.push(scriptedStream([{ gate: g.promise }, 'Cells are the basic unit of life. ', 'Shall we look at one?']));
    const turn = h.utter('What is a cell?', 1200);
    await waitFor(() => h.streamCalls.length === 1, 1000, 'stream started');
    const seq = h.conversation.k12TurnSeq;
    await h.utter('', 300);
    await h.utter('So.', 250);
    expect(h.conversation.k12TurnSeq === seq, 'noise transcripts do not bump the turn counter', { before: seq, after: h.conversation.k12TurnSeq });
    g.open();
    await turn;
    expect(h.client.ofType('ai_done').length === 1 && h.commits.length === 1, 'the in-flight answer still completes after noise (no stuck "Thinking…")');
    expect(h.client.ofType('turn_ignored').length === 2, 'each noise turn gets a terminal turn_ignored', h.client.ofType('turn_ignored'));
    h.done();
  }

  // ---- 4. Cough: duck, then resume on the false-interruption timer ----------
  {
    const h = makeHarness({ ttsDelayMs: 60 });
    h.streams.push(scriptedStream([
      'Gravity pulls every object towards the Earth. ',
      'That is why a ball falls down when you drop it. ',
      'What do you think happens on the Moon?',
    ]));
    const turn = h.utter('Why do things fall?', 1500);
    await waitFor(() => h.client.binary.length > 0, 2000, 'speaking');
    await sleep(750);
    h.event({ type: 'input_audio_buffer.speech_started', item_id: 'cough', audio_start_ms: 9000 });
    h.event({ type: 'input_audio_buffer.speech_stopped', item_id: 'cough', audio_end_ms: 9180 });
    expect(h.client.types().includes('duck'), 'cough → duck');
    const unducked = await waitFor(() => h.client.types().includes('unduck'), 3000, 'unduck after false interruption timeout');
    expect(unducked, 'no transcript within ~2 s → unduck and continue');
    expect(!h.client.types().includes('response_cancelled'), 'cough never cancels the answer');
    await turn;
    expect(h.client.types().includes('ai_done'), 'answer completes after the cough');
    h.done();
  }

  // ---- 5. Backchannel and too-short speech while speaking -------------------
  {
    const h = makeHarness({ ttsDelayMs: 50 });
    h.streams.push(scriptedStream(['An atom has a nucleus in the centre. ', 'Electrons move around it. ', 'Got it?']));
    const turn = h.utter('Explain the atom', 1300);
    await waitFor(() => h.client.binary.length > 0, 2000, 'speaking');
    await sleep(750);
    await h.utter('Haan', 700);
    await h.utter('What about', 350);
    const reasons = h.client.ofType('turn_ignored').map((m) => m.reason);
    expect(reasons.join(',') === 'backchannel,too_short', '"haan" is a backchannel; <500 ms cannot interrupt', reasons);
    expect(!h.client.types().includes('response_cancelled'), 'neither cancels the answer');
    await turn;
    h.done();
  }

  // ---- 6. Confirmed interruption (≥500 ms + real transcript) -----------------
  {
    const h = makeHarness({ ttsDelayMs: 30 });
    const g = gate();
    h.streams.push(scriptedStream(['Fractions show parts of a whole. ', { gate: g.promise }, 'For example one half.']));
    h.streams.push(scriptedStream(['Sure, decimals are another way to write parts. ', 'Want an example?']));
    const turn1 = h.utter('What are fractions?', 1200);
    await waitFor(() => h.client.binary.length > 0, 2000, 'speaking');
    await sleep(750);
    const turn2 = h.utter('Actually can you explain decimals instead?', 1600);
    await waitFor(() => h.client.types().includes('response_cancelled'), 2000, 'cancel');
    const cancelled = h.client.ofType('response_cancelled')[0];
    expect(!!cancelled, 'real interruption → response_cancelled');
    expect(cancelled?.preserveDisplay === false, 'a partially streamed answer is withdrawn (preserveDisplay=false), as before');
    await turn2;
    g.open();
    await turn1;
    expect(h.streamCalls.length === 2 && h.streamCalls[1].message === 'Actually can you explain decimals instead?', 'the new turn is answered', h.streamCalls.map((c) => c.message));
    expect(h.commits.length === 1 && h.commits[0].startsWith('Sure, decimals'), 'only the new answer is persisted', h.commits);
    const finals = h.client.ofType('transcript').filter((m) => m.isFinal).map((m) => m.text);
    expect(finals.includes('Actually can you explain decimals instead?'), 'the interrupting transcript is shown as the new user turn', finals);
    const lateAudio = binaryText(h).split('[elevenlabs:Sure, decimal')[1] || '';
    expect(!lateAudio.includes('Fractions') && !lateAudio.includes('For example'), 'no audio from the cancelled answer after the new one starts');
    h.done();
  }

  // ---- 7. Interruption AFTER the answer is complete keeps it on screen ------
  {
    const h = makeHarness({ ttsDelayMs: 120 });
    h.streams.push(scriptedStream(['The Sun is a star. ', 'It is very hot. ', 'It gives us light.']));
    h.streams.push(scriptedStream(['The Moon reflects sunlight. ', 'Anything else?']));
    const turn1 = h.utter('Tell me about the Sun', 1200);
    await waitFor(() => h.client.types().includes('answer_ready'), 3000, 'answer_ready');
    await sleep(750);
    await h.utter('And what about the Moon?', 1300);
    const cancelled = h.client.ofType('response_cancelled')[0];
    expect(cancelled?.preserveDisplay === true, 'stopping a completed answer only stops its audio (preserveDisplay=true)', cancelled);
    expect(h.rollbacks.length === 0, 'the completed answer is not rolled back');
    await turn1;
    h.done();
  }

  // ---- 8. ElevenLabs error mid-answer → OpenAI fallback continues ------------
  {
    const h = makeHarness({ failElevenLabsOn: (t) => t.startsWith('Second') });
    h.streams.push(scriptedStream(['First, add the two numbers together. ', 'Second, divide the total by two. ', 'Third, check your answer.']));
    await h.utter('How do I find the average?', 1300);
    const providers = h.ttsCalls.map((c) => `${c.provider}:${c.text.split(',')[0]}`);
    expect(providers[0] === 'elevenlabs:First', 'sentence 1 spoken by ElevenLabs', providers);
    expect(providers.includes('openai:Second'), 'failed sentence re-spoken by the OpenAI fallback', providers);
    expect(providers.includes('openai:Third') && !providers.includes('elevenlabs:Third'), 'later sentences use the fallback (not silence)', providers);
    const audio = binaryText(h);
    expect(audio.includes('[openai:Second, divi') && audio.includes('[openai:Third, chec'), 'fallback audio reaches the client', audio);
    expect(h.client.types().includes('ai_done'), 'answer still completes');
    h.done();
  }

  // ---- 9. Hold-to-talk: manual turns with turn_detection none ---------------
  {
    const h = makeHarness();
    h.streams.push(scriptedStream(['Yes, five is correct! ', 'Well done.']));
    await h.clientMessage({ type: 'set_input_mode', mode: 'hold_to_talk' });
    const update = h.openai.ofType('session.update').pop();
    expect(update && update.session?.audio?.input?.turn_detection === null, 'hold-to-talk switches Realtime turn_detection to none', update);
    expect(h.client.ofType('input_mode').pop()?.mode === 'hold_to_talk', 'client told the input mode');
    await h.clientMessage({ type: 'ptt_start' });
    expect(h.openai.types().includes('input_audio_buffer.clear'), 'press clears any stale audio');
    await sleep(320);
    await h.clientMessage({ type: 'ptt_commit' });
    expect(h.openai.types().includes('input_audio_buffer.commit'), 'release commits the held audio');
    // No VAD timings exist for a manual turn; a short held word is intentional.
    await h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'held_1', transcript: 'Five' });
    expect(h.streamCalls.length === 1 && h.streamCalls[0].message === 'Five', 'held single-word turn is processed', h.streamCalls.map((c) => c.message));
    expect(h.client.types().includes('ai_done'), 'held turn answered');
    // Too-short press → ignored without a commit.
    const commitsBefore = h.openai.ofType('input_audio_buffer.commit').length;
    await h.clientMessage({ type: 'ptt_start' });
    await h.clientMessage({ type: 'ptt_commit' });
    expect(h.openai.ofType('input_audio_buffer.commit').length === commitsBefore, 'accidental tap is not committed');
    expect(h.client.ofType('turn_ignored').pop()?.reason === 'too_short', 'accidental tap → turn_ignored');
    // Empty commit error from Realtime is a non-turn, not an error toast.
    await h.clientMessage({ type: 'ptt_start' });
    await sleep(300);
    await h.clientMessage({ type: 'ptt_commit' });
    await h.event({ type: 'error', error: { code: 'input_audio_buffer_commit_empty', message: 'buffer too small' } });
    expect(!h.client.types().includes('error'), 'empty manual commit is not surfaced as an error');
    // Speech events are ignored in hold mode (no ducking).
    h.event({ type: 'input_audio_buffer.speech_started', item_id: 'x', audio_start_ms: 1 });
    expect(!h.client.types().includes('duck'), 'no VAD ducking in hold-to-talk');
    h.done();
  }

  // ---- 10. Hold-to-talk press while the tutor speaks interrupts at once ------
  {
    const h = makeHarness({ ttsDelayMs: 80 });
    h.streams.push(scriptedStream(['Rivers flow from mountains to the sea. ', 'They carry water and soil. ', 'Can you name a river?']));
    await h.clientMessage({ type: 'set_input_mode', mode: 'hold_to_talk' });
    await h.clientMessage({ type: 'ptt_start' });
    await sleep(300);
    await h.clientMessage({ type: 'ptt_commit' });
    const turn = h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'h1', transcript: 'Tell me about rivers' });
    await waitFor(() => h.client.binary.length > 0, 2000, 'speaking');
    await h.clientMessage({ type: 'ptt_start' });
    expect(h.client.types().includes('response_cancelled'), 'pressing the button while the tutor talks stops it immediately');
    await turn;
    h.done();
  }

  // ---- 11. TopScholar: router runs in parallel with the curriculum lookup ----
  {
    const h = makeHarness({ businessAccountId: TOPSCHOLAR_ACCOUNT_ID });
    const timeline: string[] = [];
    let prefetchHandle: any = null;
    h.svc.setDepsForTesting({
      prefetchK12Topic: (query: string) => {
        timeline.push('prefetch:start');
        prefetchHandle = { query, result: sleep(50).then(() => { timeline.push('prefetch:done'); return { success: true, data: [] }; }) };
        return prefetchHandle;
      },
      classifyIntent: async () => {
        timeline.push('router:start');
        await sleep(120);
        timeline.push('router:done');
        return { route: 'academic_question', confidence: 0.9, source: 'classifier' };
      },
    });
    h.streams.push(scriptedStream(['Photosynthesis happens in the leaves. ', 'Want to see how?']));
    await h.utter('Explain photosynthesis in plants', 1600);
    expect(timeline[0] === 'prefetch:start' && timeline.indexOf('prefetch:done') < timeline.indexOf('router:done'), 'curriculum lookup starts before / finishes during the router call', timeline);
    expect(h.streamCalls[0]?.context?.prefetchedK12Topic === prefetchHandle, 'the speculative lookup is handed to the chat pipeline for reuse', h.streamCalls[0]?.context?.prefetchedK12Topic);
    expect(h.streamCalls[0]?.context?.voiceIntentRoute === 'academic_question', 'router decision still applied');

    // Confident small talk skips the router and the lookup.
    timeline.length = 0;
    h.streams.push(scriptedStream(['Hello! What shall we study today?']));
    await h.utter('Hello', 600);
    expect(timeline.length === 0, 'greeting: router and lookup skipped', timeline);
    expect(h.streamCalls[1]?.context?.voiceIntentRoute === 'normal_conversation', 'greeting routed as normal conversation');

    // Short, unclassifiable turn: no pipeline run.
    h.svc.setDepsForTesting({ classifyIntent: async () => ({ route: 'uncertain', confidence: 0.3, source: 'fallback' }) });
    h.conversation.lastAssistantText = 'Here is a fact.';
    const callsBefore = h.streamCalls.length;
    await h.utter('blue the', 600);
    expect(h.streamCalls.length === callsBefore, 'short uncertain turn gets no full pipeline run');
    expect(h.client.ofType('turn_ignored').pop()?.reason === 'unclear', 'short uncertain → turn_ignored(unclear)');

    // Router timeout on a substantive question: answer it as academic.
    h.svc.setDepsForTesting({ classifyIntent: async () => ({ route: 'uncertain', confidence: 0, source: 'fallback', failure: 'timeout' }) });
    h.streams.push(scriptedStream(['Mitochondria make energy for the cell. ', 'Clear?']));
    await h.utter('What do mitochondria do in a cell', 1800);
    expect(h.streamCalls[h.streamCalls.length - 1]?.context?.voiceIntentRoute === 'academic_question', 'router timeout + substantive question → academic_question');

    // Stop command while speaking (deterministic, bypasses length rules).
    h.streams.push(scriptedStream(['Light travels very fast. ', 'It is faster than sound. ', 'Any questions?']));
    h.svc.setDepsForTesting({ classifyIntent: async () => ({ route: 'academic_question', confidence: 0.9, source: 'classifier' }) });
    const turn = h.utter('How fast does light travel', 1500);
    await waitFor(() => h.client.binary.length > 0 && h.client.ofType('answer_delta').some((d) => d.display.startsWith('Light')), 2000, 'speaking');
    await sleep(750);
    await h.utter('Stop', 300);
    expect(h.client.types().includes('voice_control_consumed'), 'stop command consumed');
    await turn;
    h.done();
  }

  // ---- 12. Every turn ends in a terminal event --------------------------------
  {
    const h = makeHarness();
    h.streams.push(scriptedStream([], ''));  // empty answer → error path
    await h.utter('Tell me something', 1200);
    const t = h.client.types();
    expect(t.includes('error') && t.includes('ai_done'), 'empty answer → error + ai_done (client never left thinking)', t);
    const h2 = makeHarness({ elevenlabs: false });
    h2.streams.push(scriptedStream(['OpenAI voice only accounts still stream sentence by sentence. ', 'Good.']));
    await h2.utter('Does it work without ElevenLabs?', 1300);
    expect(h2.ttsCalls.length === 2 && h2.ttsCalls.every((c) => c.provider === 'openai'), 'OpenAI-only voice is per-sentence too', h2.ttsCalls);
    expect(h2.client.types().includes('ai_done'), 'OpenAI-only turn completes');
    for (const harness of [h, h2]) {
      const accepted = harness.client.ofType('transcript').filter((m) => m.isFinal).length;
      const ignored = harness.client.ofType('turn_ignored').length;
      const terminals = harness.client.json.filter((m) => terminalTypes.has(m.type) && m.type !== 'turn_ignored').length;
      expect(terminals >= accepted && ignored >= 0, 'every accepted turn has a terminal event', harness.client.types());
    }
    h.done(); h2.done();
  }

  // ---- 13. The live path never calls the second AI rewrite --------------------
  {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, '../../realtimeVoiceService.ts'), 'utf8');
    expect(!/createVoiceSpeechText\s*\(/.test(src) && !/import[^;]*createVoiceSpeechText/.test(src), 'realtimeVoiceService does not import or call createVoiceSpeechText');
  }

  // ---- 14. Silence: nudge once at 60 s, switch off at 120 s ------------------
  {
    const h = makeHarness();
    const c = h.conversation;
    const base = Date.now();
    c.lastUserSpeechAt = base;
    // Mic frames keep arriving (touchActivity) but nobody speaks: that must not count.
    h.clientMessage({ type: 'pong' });
    h.svc.checkIdle(h.conversationId, c, base + 59_000);
    expect(!h.client.ofType('answer_delta').length, 'no nudge before 60 s of silence');
    h.svc.checkIdle(h.conversationId, c, base + 61_000);
    const nudge = h.client.ofType('answer_delta')[0];
    expect(!!nudge && /still there/i.test(nudge.display), 'nudge "Are you still there?" after 60 s', nudge);
    await waitFor(() => h.client.ofType('ai_done').length > 0, 2000, 'nudge ai_done');
    expect(h.ttsCalls.some((t) => /still there/i.test(t.text)), 'nudge is spoken (TTS)');
    expect(h.commits.length === 0 && h.streamCalls.length === 0, 'nudge uses no LLM and saves nothing to history');
    h.svc.checkIdle(h.conversationId, c, base + 90_000);
    expect(h.client.ofType('answer_delta').length === 1, 'nudge is only spoken once per silence');
    expect(!h.client.ofType('session_closed').length, 'still open before 120 s');
    h.svc.checkIdle(h.conversationId, c, base + 121_000);
    const closed = h.client.ofType('session_closed')[0];
    expect(closed?.reason === 'idle_timeout', 'voice switches off after 120 s of silence (session_closed idle_timeout)', closed);
    expect(!h.svc.conversations.has(h.conversationId), 'conversation cleaned up');
    h.done();
  }
  {
    // Talking resets the clock; time spent answering doesn't count as silence.
    const h = makeHarness();
    const c = h.conversation;
    const base = Date.now();
    c.lastUserSpeechAt = base - 100_000;
    await h.utter('What is gravity?', 1500);
    expect(Date.now() - (c.lastUserSpeechAt || 0) < 5_000, 'an accepted turn restarts the silence clock');
    const ignoredBefore = c.lastUserSpeechAt;
    await h.utter('thank you', 300);
    expect(c.lastUserSpeechAt === ignoredBefore, 'noise turns do not count as the student speaking');
    c.isProcessing = true;
    h.svc.checkIdle(h.conversationId, c, Date.now() + 200_000);
    expect(!h.client.ofType('session_closed').length, 'never closed while an answer is being written');
    c.isProcessing = false;
    c.currentResponseId = undefined;
    h.svc.checkIdle(h.conversationId, c, Date.now() + 30_000);
    expect(!h.client.ofType('session_closed').length && !h.client.json.some((m) => m.type === 'answer_delta' && /still there/i.test(m.display)),
      'silence counts from the end of the answer, not from the question');
    h.clientMessage({ type: 'ptt_start' });
    expect(Date.now() - (c.lastUserSpeechAt || 0) < 5_000, 'hold-to-talk press counts as activity');
    h.done();
  }

  out(`\n${passed} passed, ${failed} failed`);
  out(failed === 0 ? 'All voice turn-handling tests passed' : `${failed} test(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  outErr(error);
  process.exit(1);
});
