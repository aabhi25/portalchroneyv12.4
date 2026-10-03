/**
 * Voice reply language (no database, no network): FAKE chat stream, FAKE TTS, FAKE sockets.
 *   - the 'auto' bug: the language actually spoken now reaches the chat pipeline;
 *   - a restricted business gets the same language rule as text chat;
 *   - the transcriber is pinned only for a single allowed language / a locked medium;
 *   - fillers and the idle nudge use the business's language (never English for Hindi-only).
 * Run: npx tsx server/services/__tests__/voiceLanguage.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused';

const out = console.log.bind(console);
const outErr = console.error.bind(console);
if (process.env.VOICE_TEST_VERBOSE !== '1') {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}

let failed = 0;
let passed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (!cond) { failed++; outErr(`✗ ${label}${detail !== undefined ? `\n    got: ${JSON.stringify(detail)}` : ''}`); }
  else { passed++; out(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (!cond()) { if (Date.now() - start > timeoutMs) return false; await sleep(5); }
  return true;
}

class FakeSocket {
  readyState = 1;
  json: any[] = [];
  send(data: any) { if (!Buffer.isBuffer(data)) this.json.push(JSON.parse(String(data))); }
  on() {}
  close() { this.readyState = 3; }
  ofType(type: string) { return this.json.filter((m) => m.type === type); }
}

async function main() {
  const { RealtimeVoiceService } = await import('../../realtimeVoiceService');
  const L = await import('../language/languagePolicy');
  const { fillerLanguage } = await import('../voice/fillers');
  const { DEFAULT_AI_LANGUAGE_SETTINGS } = await import('@shared/replyLanguages');
  const policy = (over: any) => L.policyFromSettings(L.normalizeLanguageSettings({ ...DEFAULT_AI_LANGUAGE_SETTINGS, ...over }), 'voice');

  function harness(opts: { selectedLanguage?: string; languagePolicy?: any; medium?: string } = {}) {
    const svc: any = new RealtimeVoiceService();
    const client = new FakeSocket();
    const openai = new FakeSocket();
    const contexts: any[] = [];
    const tts: string[] = [];
    svc.setDepsForTesting({
      streamChat: (_message: string, context: any) => {
        contexts.push(context);
        return (async function* () { yield { type: 'content', data: 'Okay.' }; yield { type: 'final', data: 'Okay.' }; })();
      },
      commitAssistantMessage: async () => 'msg-1',
      rollbackAssistantMessage: async () => {},
      createTtsProviders: () => ({
        primary: { name: 'fake', synthesize: async (text: string, _s: AbortSignal, onChunk: (b: Buffer) => void) => { tts.push(text); onChunk(Buffer.alloc(4)); } },
        fallback: null,
      }),
    });
    const conversationId = `conv-${Math.random().toString(36).slice(2)}`;
    const conversation: any = {
      clientWs: client, openaiWs: openai, businessAccountId: 'biz-lang', userId: 'visitor-1', openaiApiKey: 'sk-test-not-used',
      sessionId: null, conversationId, isProcessing: false, currentUserTranscript: '', currentAITranscript: '', lastHeartbeat: Date.now(),
      journeyResponseTracking: new Map(), cancelledResponseIds: new Set<string>(), reconnectAttempts: 0, isReconnecting: false,
      selectedLanguage: opts.selectedLanguage, languagePolicy: opts.languagePolicy,
      topscholarScope: opts.medium ? { medium: opts.medium } : null, topscholarCpIds: null,
    };
    svc.conversations.set(conversationId, conversation);
    let item = 0;
    const event = (e: any) => svc.handleOpenAIMessage(conversationId, conversation, Buffer.from(JSON.stringify(e)));
    const utter = async (text: string) => {
      const id = `item_${++item}`;
      const startAt = 1000 * item;
      event({ type: 'input_audio_buffer.speech_started', item_id: id, audio_start_ms: startAt });
      event({ type: 'input_audio_buffer.speech_stopped', item_id: id, audio_end_ms: startAt + 2000 });
      await event({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text });
      await waitFor(() => contexts.length >= item, 2000);
      await waitFor(() => client.ofType('ai_done').length >= item, 2000);
    };
    return { svc, client, openai, conversation, conversationId, contexts, tts, utter, done: () => svc.shutdown?.() };
  }

  // ── 1. the 'auto' bug ──
  {
    const h = harness({ selectedLanguage: 'auto' });
    await h.utter('मुझे योग कक्षाओं की फीस बताइए');
    const c1 = h.contexts[0];
    expect(c1?.preferredLanguage === 'hi', "'auto' + Hindi speech → preferredLanguage 'hi' (was 'auto')", c1?.preferredLanguage);
    expect(c1?.replyLanguage && c1.replyLanguage.rule === '', 'any language: no extra rule on voice', c1?.replyLanguage);
    await h.utter('What time does the swimming pool open on weekends?');
    expect(h.contexts[1]?.preferredLanguage === 'en', 'next turn in English → English (per turn, not sticky)', h.contexts[1]?.preferredLanguage);
    h.done();
  }
  {
    const h = harness({ selectedLanguage: 'hi' });
    await h.utter('What time does the swimming pool open on weekends?');
    expect(h.contexts[0]?.preferredLanguage === 'hi' && h.contexts[0]?.replyLanguage.rule === '', 'any language + widget pick Hindi → Hindi as before, no extra rule', h.contexts[0]?.preferredLanguage);
    h.done();
  }

  // ── 2. restricted voice gets the language rule ──
  {
    // (Tamil/other-script speech is dropped by the voice noise filter before it gets here.)
    const h = harness({ selectedLanguage: 'auto', languagePolicy: policy({ mode: 'restricted', allowed: ['hi'], defaultLanguage: 'hi' }) });
    await h.utter('What are the fees for the yoga classes at your club?');
    const c = h.contexts[0];
    expect(c?.preferredLanguage === 'hi' && /REPLY LANGUAGE/.test(c?.replyLanguage?.rule || '') && /help in Hindi/.test(c.replyLanguage.rule), 'restricted voice (Hindi only): English speech → Hindi + rule + one-time note', c?.replyLanguage);
    await h.utter('And what about the swimming pool timings on Sunday?');
    expect(h.contexts[1]?.preferredLanguage === 'hi' && !/short friendly sentence/.test(h.contexts[1]?.replyLanguage?.rule || 'x'), 'second turn: still Hindi, note not repeated', h.contexts[1]?.replyLanguage);
    h.done();
  }

  // ── 3. transcriber pinning ──
  {
    const cfg = (h: any) => h.svc.transcriptionConfig(h.svc.voiceTranscriptionLanguage(h.conversation));
    const anyAuto = harness({ selectedLanguage: 'auto' });
    expect(cfg(anyAuto).language === undefined && !!cfg(anyAuto).prompt, 'any language + auto → transcriber on auto (unchanged)', cfg(anyAuto));
    const anyEn = harness({ selectedLanguage: 'en' });
    expect(cfg(anyEn).language === 'en', 'any language + widget pick → pinned to the pick (unchanged)', cfg(anyEn));
    const hiOnly = harness({ selectedLanguage: 'auto', languagePolicy: policy({ mode: 'restricted', allowed: ['hi'], defaultLanguage: 'hi' }) });
    expect(cfg(hiOnly).language === 'hi', 'Hindi-only business → transcriber pinned to Hindi', cfg(hiOnly));
    const enHi = harness({ selectedLanguage: 'auto', languagePolicy: policy({ mode: 'restricted', allowed: ['en', 'hi'], defaultLanguage: 'en' }) });
    expect(cfg(enHi).language === undefined, 'English + Hindi → transcriber stays on auto', cfg(enHi));
    const badPick = harness({ selectedLanguage: 'ta', languagePolicy: policy({ mode: 'restricted', allowed: ['hi'], defaultLanguage: 'hi' }) });
    expect(cfg(badPick).language === 'hi', 'disallowed widget pick ignored → pinned to the only allowed language', cfg(badPick));
    const locked = harness({ selectedLanguage: 'en', medium: 'Hindi Medium', languagePolicy: policy({ followMedium: true, mediumSwitchable: false }) });
    expect(cfg(locked).language === 'hi', 'locked Hindi medium → pinned to Hindi even with an English pick', cfg(locked));
    for (const h of [anyAuto, anyEn, hiOnly, enHi, badPick, locked]) h.done();
  }

  // ── 4. fillers and the idle nudge ──
  {
    const hiOnly = harness({ selectedLanguage: 'auto', languagePolicy: policy({ mode: 'restricted', allowed: ['hi'], defaultLanguage: 'hi' }) });
    expect(fillerLanguage('What are the fees for yoga classes?', hiOnly.svc.voiceFillerHint(hiOnly.conversation)) === 'hi', 'Hindi-only: an English sentence still gets a Hindi filler (never English)');
    const taOnly = harness({ selectedLanguage: 'auto', languagePolicy: policy({ mode: 'restricted', allowed: ['ta'], defaultLanguage: 'ta' }) });
    expect(fillerLanguage('What are the fees for yoga classes?', taOnly.svc.voiceFillerHint(taOnly.conversation)) === null, 'Tamil-only: no filler (no Tamil phrase set)');
    const anyAuto = harness({ selectedLanguage: 'auto' });
    expect(fillerLanguage('What are the fees for yoga classes?', anyAuto.svc.voiceFillerHint(anyAuto.conversation)) === 'en', 'any language: filler follows the speech as before');

    hiOnly.svc.speakIdleNudge(hiOnly.conversation);
    const n1 = hiOnly.client.ofType('answer_delta')[0];
    expect(n1 && /क्या आप अभी भी यहाँ हैं/.test(n1.display), 'Hindi-only: idle nudge in Hindi before any turn', n1);
    anyAuto.svc.speakIdleNudge(anyAuto.conversation);
    const n2 = anyAuto.client.ofType('answer_delta')[0];
    expect(n2 && /still there/i.test(n2.display), 'any language: idle nudge unchanged (English)', n2);
    taOnly.svc.speakIdleNudge(taOnly.conversation);
    await sleep(300);
    expect(!taOnly.client.json.some((m) => m.type === 'answer_delta' && /still there/i.test(m.display)), 'Tamil-only: never an English nudge (translation unavailable → silent)', taOnly.client.json);
    const hinglish = harness({ selectedLanguage: 'auto', languagePolicy: policy({ mode: 'restricted', allowed: ['hinglish'], defaultLanguage: 'hinglish' }) });
    hinglish.svc.speakIdleNudge(hinglish.conversation);
    const n3 = hinglish.client.ofType('answer_delta')[0];
    expect(n3 && /Kya aap abhi bhi yahan hain/.test(n3.display), 'Hinglish-only: Hinglish nudge', n3);
    for (const h of [hiOnly, taOnly, anyAuto, hinglish]) h.done();
  }

  if (failed) { out(`\n${failed} check(s) failed, ${passed} passed`); process.exit(1); }
  out(`\nAll ${passed} voice language checks passed.`);
  process.exit(0);
}
main().catch((e) => { outErr(e); process.exit(1); });
