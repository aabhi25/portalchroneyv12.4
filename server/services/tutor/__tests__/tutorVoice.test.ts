/**
 * AI Tutor — the lesson on the voice connection, with a FAKE Realtime socket, FAKE chat stream,
 * FAKE TTS and a FAKE lesson / minute store. No network, no database.
 *
 *  - the TTS pipeline reports each tagged sentence once, in order, just before its audio;
 *  - spoken text says formulas in words;
 *  - a lesson runs plan → sections → recap, each line's caption + board ops arriving right
 *    before that line's audio;
 *  - an interruption pauses at the line the widget heard; Resume says "where were we", restores
 *    the board as it was at that line and goes on from it;
 *  - Stop, the daily minutes (at start and during the lesson), tutor off.
 *
 * Run: npx tsx server/services/tutor/__tests__/tutorVoice.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused";

const out = console.log.bind(console);
const outErr = console.error.bind(console);
if (process.env.VOICE_TEST_VERBOSE !== "1") {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}

let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) out(`✓ ${label}`);
  else { failed++; outErr(`✗ ${label}${detail !== undefined ? `\n    got: ${JSON.stringify(detail)}` : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs = 3000, label = "condition"): Promise<boolean> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) { outErr(`  (timed out waiting for ${label})`); return false; }
    await sleep(5);
  }
  return true;
}

/** Records JSON and audio in one ordered log. */
class FakeSocket {
  readyState = 1;
  log: Array<{ kind: "json"; msg: any } | { kind: "audio"; text: string }> = [];
  send(data: any) {
    if (Buffer.isBuffer(data)) this.log.push({ kind: "audio", text: data.toString() });
    else this.log.push({ kind: "json", msg: JSON.parse(String(data)) });
  }
  on() {}
  close() { this.readyState = 3; }
  get json() { return this.log.filter((e): e is { kind: "json"; msg: any } => e.kind === "json").map((e) => e.msg); }
  ofType(type: string) { return this.json.filter((m) => m.type === type); }
}

async function main() {
  const { SentenceTtsPipeline } = await import("../../voice/ttsPipeline");
  const { tutorSpeech } = await import("../speech");
  const { RealtimeVoiceService } = await import("../../../realtimeVoiceService");
  const { boardAfter, withCleanPage } = await import("../tutorRunner");
  const { TutorUnavailableError } = await import("../voiceTutor");

  // ── 1. pipeline: onItemStart ──
  {
    const events: string[] = [];
    const provider = (name: string, failOn?: (t: string) => boolean) => ({
      name,
      synthesize: async (text: string, signal: AbortSignal, onChunk: (b: Buffer) => void) => {
        if (failOn?.(text)) throw new Error("HTTP 500");
        for (let i = 0; i < 2; i++) {
          await sleep(text.startsWith("slow") ? 30 : 5);
          if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
          onChunk(Buffer.from(`${text}:${i}`.padEnd(8, "_").slice(0, 8)));
        }
      },
    });
    const p = new SentenceTtsPipeline({
      primary: provider("p", (t) => t === "broken"),
      fallback: null,
      sendAudio: (pcm) => events.push(`audio:${pcm.toString().slice(0, 4)}`),
      onItemStart: (tag) => events.push(`start:${tag}`),
    });
    p.enqueue("slow one", { tag: 0 });
    p.enqueue("two", { tag: 1 });
    p.enqueue("broken", { tag: 2 });
    p.enqueue("untagged");
    p.enqueue("five", { tag: 4 });
    p.close();
    await p.finished();
    const starts = events.filter((e) => e.startsWith("start"));
    expect(starts.join() === "start:0,start:1,start:2,start:4", "each tagged sentence is reported once, in order (a failed one too)", starts);
    const firstAudio = (prefix: string) => events.findIndex((e) => e === `audio:${prefix}`);
    expect(events.indexOf("start:0") < firstAudio("slow") && events.indexOf("start:1") < firstAudio("two:") && events.indexOf("start:1") > firstAudio("slow"), "a sentence is reported right before its own first audio (after the previous one's)", events);

    const ev2: string[] = [];
    const p2 = new SentenceTtsPipeline({ primary: provider("p"), sendAudio: () => ev2.push("audio"), onItemStart: (t) => ev2.push(`start:${t}`) });
    p2.enqueue("slow a", { tag: 0 });
    p2.enqueue("slow b", { tag: 1 });
    await waitFor(() => ev2.includes("start:0"), 1000, "first start");
    p2.cancel();
    await sleep(120);
    expect(!ev2.includes("start:1"), "nothing is reported after cancel", ev2);
  }

  // ── 2. spoken text ──
  {
    expect(tutorSpeech("So a² + b² = c².", "en") === "So a squared plus b squared equals c squared.", "a² + b² = c² is said in words", tutorSpeech("So a² + b² = c².", "en"));
    expect(!/√/.test(tutorSpeech("√(a+b) is not √a + √b", "en")) && /square root of a plus b/.test(tutorSpeech("√(a+b) is not √a + √b", "en")), "√ is said as 'square root of'", tutorSpeech("√(a+b) is not √a + √b", "en"));
    expect(tutorSpeech("Angle is 90°, **right**!", "en") === "Angle is 90 degrees, right!", "° and Markdown", tutorSpeech("Angle is 90°, **right**!", "en"));
    expect(/[ऀ-ॿ]/.test(tutorSpeech("Yeh triangle ka sabse lamba side hai, samajh gaye?", "hinglish")), "Hinglish lines are spoken in Devanagari");
  }

  // ── harness ──
  const outline = {
    title: "Right triangles",
    intro: ["Today we learn about right triangles.", "Here is our plan."],
    sections: [
      { id: "s1", title: "The hypotenuse", goal: "", sourceIds: ["c1"], questionIds: [], mediaIds: [] },
      { id: "s2", title: "Pythagoras", goal: "", sourceIds: ["c1"], questionIds: [], mediaIds: [] },
    ],
    recap: ["The hypotenuse is the longest side.", "And a² + b² = c²."],
  };
  const sec = (n: number) => ({
    lines: Array.from({ length: 4 }, (_, i) => ({
      say: `Section ${n} line ${i}.`,
      ops: i === 0 ? [{ op: "write", id: `t${n}`, text: `Section ${n}`, style: "title", color: "blue" }] : [{ op: "write", id: `w${n}_${i}`, text: `point ${i}`, style: "body", color: "ink" }],
    })),
    simpler: [], checks: [],
  });

  function harness(opts: { remaining?: number; tickMs?: number; outlineDelayMs?: number; failPrepare?: Error; autoPlay?: boolean } = {}) {
    const svc: any = new RealtimeVoiceService();
    const client = new FakeSocket();
    const openai = new FakeSocket();
    const streams: Array<() => AsyncGenerator<any>> = [];
    const usage: number[] = [];
    const ended: any[] = [];
    let clock = Date.now();
    const provider = {
      name: "elevenlabs",
      synthesize: async (text: string, signal: AbortSignal, onChunk: (b: Buffer) => void) => {
        for (let i = 0; i < 2; i++) {
          await sleep(8);
          if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
          const tag = Buffer.from(`[${text.slice(0, 18)}:${i}]`);
          onChunk(tag.length % 2 ? Buffer.concat([tag, Buffer.from(" ")]) : tag);
        }
      },
    };
    svc.setDepsForTesting({
      streamChat: () => {
        const next = streams.shift();
        return (next ?? (async function* () { yield { type: "content", data: "Good question. " }; yield { type: "final", data: "Good question." }; }))();
      },
      commitAssistantMessage: async (_c: any, _content: string, still: () => boolean) => (still() ? "msg-1" : null),
      rollbackAssistantMessage: async () => {},
      createTtsProviders: () => ({ primary: provider, fallback: null }),
      prepareTutor: async () => {
        if (opts.failPrepare) throw opts.failPrepare;
        return {
          chapter: "Triangles",
          language: "en",
          lessons: {
            outline: async () => { if (opts.outlineDelayMs) await sleep(opts.outlineDelayMs); return outline; },
            section: async (i: number) => sec(i + 1),
          },
          store: {
            remainingSeconds: async () => opts.remaining ?? 1200,
            addUsage: async (s: number) => { usage.push(s); },
            sessionStarted: async () => "session-1",
            sessionEnded: async (id: string | null, info: any) => { ended.push({ id, ...info }); },
          },
        };
      },
    });
    const conversationId = `conv-${Math.random().toString(36).slice(2)}`;
    const conversation: any = {
      clientWs: client, openaiWs: openai, businessAccountId: "biz-tutor", userId: "visitor-1",
      openaiApiKey: "sk-test", sessionId: null, conversationId, isProcessing: false,
      currentUserTranscript: "", currentAITranscript: "", lastHeartbeat: Date.now(),
      journeyResponseTracking: new Map(), cancelledResponseIds: new Set<string>(),
      reconnectAttempts: 0, isReconnecting: false, selectedLanguage: "en",
      topscholarScope: { board: "CBSE", medium: "English", grade: "10", subject: "Mathematics", chapter: "Triangles" },
      topscholarCpIds: ["cp-1"], elevenlabsApiKey: "el", elevenlabsVoiceId: "v",
    };
    svc.conversations.set(conversationId, conversation);
    const clientMessage = (m: any) => svc.handleClientMessage(conversationId, conversation, m);
    let item = 0;
    const event = (e: any) => svc.handleOpenAIMessage(conversationId, conversation, Buffer.from(JSON.stringify(e)));
    const utter = (text: string, speechMs: number) => {
      const id = `item_${++item}`;
      const at = 1000 * item;
      event({ type: "input_audio_buffer.speech_started", item_id: id, audio_start_ms: at });
      event({ type: "input_audio_buffer.speech_stopped", item_id: id, audio_end_ms: at + speechMs });
      return event({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: text });
    };
    // The widget: reports each line as heard and the end of playback (when autoPlay).
    let playing = opts.autoPlay !== false;
    const seen = new Set<string>();
    const player = setInterval(() => {
      if (!playing) return;
      for (const m of client.json) {
        const key = `${m.type}:${m.responseId}:${m.index ?? ""}`;
        if (seen.has(key)) continue;
        if (m.type === "sentence_start") { seen.add(key); clientMessage({ type: "tutor_heard", responseId: m.responseId, index: m.index }); }
        if (m.type === "ai_done") { seen.add(key); clientMessage({ type: "playback_complete", responseId: m.responseId }); }
      }
    }, 5);
    const done = () => { clearInterval(player); svc.shutdown?.(); };
    return {
      svc, client, conversation, streams, usage, ended, clientMessage, utter, done,
      setPlaying: (v: boolean) => { playing = v; },
      advance: (ms: number) => { clock += ms; },
      clock: () => clock,
    };
  }
  const spokenLines = (h: ReturnType<typeof harness>) => h.client.ofType("sentence_start").map((m) => m.say);

  // ── 3. a whole lesson ──
  {
    const h = harness();
    await h.clientMessage({ type: "tutor_start" });
    const finished = await waitFor(() => h.client.ofType("tutor_ended").length > 0, 5000, "lesson end");
    expect(finished && h.client.ofType("tutor_ended")[0].reason === "completed", "the lesson runs to the end", h.client.ofType("tutor_ended"));
    const said = spokenLines(h);
    const expected = [...outline.intro, ...sec(1).lines.map((l) => l.say), ...sec(2).lines.map((l) => l.say), ...outline.recap];
    expect(said.join("|") === expected.join("|"), "plan → section 1 → section 2 → recap, every line once", said);
    expect(h.client.ofType("tutor_outline")[0]?.sections?.length === 2, "the widget gets the lesson outline");
    expect(!said.some((s: string) => /board ready/.test(s)), "no hello when the lesson is ready at once");
    // Order: each line's caption and board ops come right before that line's own audio.
    let orderOk = true;
    const log = h.client.log;
    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      if (e.kind !== "json" || e.msg.type !== "sentence_start") continue;
      const next = log.slice(i + 1).find((x) => x.kind === "audio") as { text: string } | undefined;
      const speech = tutorSpeech(e.msg.say, "en").slice(0, 18);
      if (!next || !next.text.startsWith(`[${speech}`)) { orderOk = false; break; }
      const delta = log.slice(0, i).reverse().find((x) => x.kind === "json") as any;
      if (delta?.msg?.type !== "answer_delta" || delta.msg.index !== e.msg.index) { orderOk = false; break; }
    }
    expect(orderOk, "caption + board ops arrive just before each line's audio");
    const firstOfSection = h.client.ofType("sentence_start").find((m) => m.say === "Section 2 line 0.");
    expect(firstOfSection?.ops?.[0]?.op === "clear", "every section starts on a clean page", firstOfSection?.ops);
    const plan = h.client.ofType("sentence_start").slice(0, 2).flatMap((m) => m.ops.map((o: any) => o.text).filter(Boolean));
    expect(plan.join("|") === "Right triangles|1. The hypotenuse|2. Pythagoras", "the plan is written on the board", plan);
    const recapOps = h.client.ofType("sentence_start").slice(-2).flatMap((m) => m.ops.map((o: any) => o.text).filter(Boolean));
    expect(recapOps.join("|") === "Quick recap|✓ The hypotenuse|✓ Pythagoras", "the recap ticks off the sections", recapOps);
    const recapAudio = h.client.log.filter((e) => e.kind === "audio").map((e: any) => e.text).find((t: string) => t.startsWith("[And a squared"));
    expect(!!recapAudio, "formulas are spoken in words");
    expect(h.ended.length === 1 && h.ended[0].id === "session-1" && h.ended[0].reason === "completed", "the session row is closed with its reason", h.ended);
    h.done();
  }

  // ── 4. interruption → pause at the heard line → resume ──
  {
    const h = harness();
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => spokenLines(h).includes("Section 1 line 0."), 3000, "section 1");
    // The widget is slow from here: it has heard up to line 2 of section 1.
    h.setPlaying(false);
    const s1 = h.client.ofType("sentence_start").filter((m) => /^Section 1/.test(m.say));
    const responseId = s1[0].responseId;
    await waitFor(() => h.client.ofType("sentence_start").filter((m) => m.responseId === responseId).length >= 3, 3000, "line 2 sent");
    h.clientMessage({ type: "tutor_heard", responseId, index: 2 });
    await sleep(700); // past the barge-in grace window
    await h.utter("Wait, why is it the longest side?", 1600);
    await waitFor(() => h.client.ofType("tutor_state").some((m) => m.state === "paused"), 3000, "paused");
    const paused = h.client.ofType("tutor_state").filter((m) => m.state === "paused").pop();
    expect(paused?.canResume === true && paused.part === 0 && paused.line === 2, "an interruption pauses at the line the student heard", paused);
    expect(h.client.ofType("response_cancelled").some((m) => m.responseId === responseId), "the tutor's speech stops");
    await waitFor(() => h.client.ofType("answer_ready").some((m) => /Good question/.test(m.displayMarkdown || "")), 3000, "doubt answered");
    expect(true, "the student's question is answered meanwhile");
    h.setPlaying(true);
    const before = h.client.log.length;
    await h.clientMessage({ type: "tutor_resume" });
    await waitFor(() => h.client.json.slice(0).filter((m) => m.type === "sentence_start").length > 0 && spokenLines(h).includes("Section 2 line 0."), 4000, "resumed into section 2");
    const after = h.client.log.slice(before).filter((e) => e.kind === "json").map((e: any) => e.msg);
    const snap = after.find((m) => m.type === "board_snapshot");
    const expectedBoard = boardAfter(withCleanPage(sec(1).lines as any), 2);
    expect(snap && JSON.stringify(snap.board) === JSON.stringify(expectedBoard), "Resume restores the board as it was at that line", snap?.board?.elements?.map((e: any) => e.id));
    const resumedSaid = after.filter((m) => m.type === "sentence_start").map((m) => m.say);
    expect(resumedSaid[0] === "Okay, let's pick up where we left off." && resumedSaid[1] === "Section 1 line 2.", "…says where were we, then repeats the interrupted line", resumedSaid.slice(0, 3));
    await waitFor(() => h.client.ofType("tutor_ended").length > 0, 5000, "end");
    expect(h.client.ofType("tutor_ended")[0]?.reason === "completed", "and finishes the lesson");
    h.done();
  }

  // ── 5. stop ──
  {
    const h = harness({ autoPlay: false });
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => spokenLines(h).length > 0, 3000, "speaking");
    await h.clientMessage({ type: "tutor_stop" });
    await waitFor(() => h.client.ofType("tutor_ended").length > 0, 2000, "ended");
    const audioBefore = h.client.log.filter((e) => e.kind === "audio").length;
    await sleep(100);
    expect(h.client.ofType("tutor_ended")[0]?.reason === "stopped" && h.ended[0]?.reason === "stopped", "Stop ends the lesson and the session row");
    expect(h.ended[0]?.progress?.part === -1 && h.client.ofType("tutor_ended")[0]?.part === -1, "…recording where the student was", h.ended[0]?.progress);
    expect(h.client.log.filter((e) => e.kind === "audio").length === audioBefore, "no more audio after Stop");
    h.done();
  }

  // ── 5b. stop in the middle of a section records that section and line ──
  {
    const h = harness();
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => spokenLines(h).includes("Section 1 line 0."), 3000, "section 1");
    h.setPlaying(false);
    const rid = h.client.ofType("sentence_start").find((m) => m.say === "Section 1 line 0.").responseId;
    h.clientMessage({ type: "tutor_heard", responseId: rid, index: 1 });
    await h.clientMessage({ type: "tutor_stop" });
    await waitFor(() => h.ended.length > 0, 2000, "ended");
    expect(h.ended[0]?.progress?.part === 0 && h.ended[0]?.progress?.line === 1, "Stop mid-section records the section and line", h.ended[0]?.progress);
    h.done();
  }

  // ── 6. a first-ever lesson: hello while it is prepared ──
  {
    const h = harness({ outlineDelayMs: 600 });
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => spokenLines(h).includes(outline.intro[0]), 4000, "plan after hello");
    const said = spokenLines(h);
    expect(said[0] === "Let's learn Triangles together! Give me a moment to get the board ready." && said[1] === outline.intro[0], "a hello is said while the lesson is prepared, then the plan", said.slice(0, 2));
    await h.clientMessage({ type: "tutor_stop" });
    h.done();
  }

  // ── 7. minutes per day ──
  {
    const h = harness({ remaining: 30 });
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => h.client.ofType("tutor_ended").length > 0, 2000, "refused");
    expect(h.client.ofType("tutor_ended")[0]?.reason === "daily_limit" && spokenLines(h).length === 0, "under a minute left today: refused, nothing said");
    h.done();
  }
  {
    const h = harness({ remaining: 90, autoPlay: false });
    // A fake clock: 100 s pass before the next tick.
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => !!h.conversation.tutor, 1000, "runner");
    const runner: any = h.conversation.tutor;
    await waitFor(() => runner.state === "teaching", 2000, "teaching");
    runner.now = () => h.clock();
    runner.lastTickAt = h.clock();
    h.advance(100_000);
    await runner.tick();
    await waitFor(() => h.client.ofType("tutor_ended").length > 0, 2000, "limit");
    expect(h.client.ofType("tutor_ended")[0]?.reason === "daily_limit", "the lesson ends when the day's minutes run out");
    expect(h.usage.reduce((a, b) => a + b, 0) >= 100, "the minutes are counted", h.usage);
    h.done();
  }

  // ── 8. tutor off / no chapter ──
  {
    const h = harness({ failPrepare: new TutorUnavailableError("The AI tutor is not switched on for this account.") });
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => h.client.ofType("tutor_ended").length > 0, 2000, "refused");
    const e = h.client.ofType("tutor_ended")[0];
    expect(e?.reason === "unavailable" && /not switched on/.test(e.message), "tutor off: the widget is told why", e);
    h.done();
  }

  // ── 9. the widget's classroom state ──
  {
    const { reduceClassroom, initialClassroom } = await import("../../../../client/src/components/tutor/useTutorClassroom");
    let s = reduceClassroom(initialClassroom(), { type: "tutor_state", state: "teaching" });
    expect(s.status === "off", "a closed classroom ignores tutor messages");
    s = { ...initialClassroom(), status: "starting" };
    s = reduceClassroom(s, { type: "tutor_outline", title: "Right triangles", sections: [{ id: "s1", title: "A" }, { id: "s2", title: "B" }] });
    s = reduceClassroom(s, { type: "tutor_state", state: "teaching", part: 0 });
    s = reduceClassroom(s, { type: "sentence_play", say: "Look here.", ops: [{ op: "clear" }, { op: "write", id: "t", text: "Hypotenuse", style: "title", color: "blue" }] });
    expect(s.status === "teaching" && s.caption === "Look here." && s.board.elements.length === 1 && s.title === "Right triangles", "a line draws its ops and becomes the caption", s);
    s = reduceClassroom(s, { type: "tutor_state", state: "paused", part: 0, canResume: true });
    expect(s.status === "paused" && s.canResume, "paused with Continue offered");
    s = reduceClassroom(s, { type: "board_snapshot", board: { page: 3, elements: [], highlights: [] } });
    expect(s.board.page === 3 && s.board.elements.length === 0, "a snapshot replaces the board");
    s = reduceClassroom(s, { type: "tutor_ended", reason: "daily_limit" });
    expect(s.status === "ended" && s.endReason === "daily_limit" && !s.canResume, "ended with its reason");
    expect(reduceClassroom(s, { type: "tutor_state", state: "teaching" }).status === "ended", "a late state message does not revive an ended lesson");
  }

  if (failed) { outErr(`\n${failed} check(s) failed`); process.exit(1); }
  out("\nAll tutor voice checks passed.");
  process.exit(0);
}
main().catch((e) => { outErr(e); process.exit(1); });
