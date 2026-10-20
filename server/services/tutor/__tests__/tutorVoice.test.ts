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
      { id: "s1", title: "The hypotenuse", goal: "", sourceIds: ["c1"], questionIds: ["q1"], mediaIds: [] },
      { id: "s2", title: "Pythagoras", goal: "", sourceIds: ["c1"], questionIds: [], mediaIds: [] },
    ],
    recap: ["The hypotenuse is the longest side.", "And a² + b² = c²."],
  };
  const CHECK = { id: "q1_0", questionId: "q1", prompt: "The longest side of a right triangle is called?", options: ["base", "hypotenuse", "height"], correctIndex: 1, solution: "The side opposite the right angle is the hypotenuse. It is always the longest. More text here." };
  const sec = (n: number) => ({
    lines: Array.from({ length: 4 }, (_, i) => ({
      say: `Section ${n} line ${i}.`,
      ops: i === 0 ? [{ op: "write", id: `t${n}`, text: `Section ${n}`, style: "title", color: "blue" }] : [{ op: "write", id: `w${n}_${i}`, text: `point ${i}`, style: "body", color: "ink" }],
    })),
    simpler: n === 1 ? [{ say: "Think of a slide in a park.", ops: [{ op: "write", id: "slide", text: "slide = hypotenuse", style: "note", color: "green" }] }] : [],
    checks: n === 1 ? [CHECK] : [],
  });
  const DOUBT_LINES = [
    { say: "The hypotenuse faces the right angle.", ops: [{ op: "clear" }, { op: "write", id: "dq", text: "Why the longest?", style: "title", color: "blue" }] },
    { say: "So it is the longest side.", ops: [] },
  ];

  const checkSaid = ["Quick check! The longest side of a right triangle is called?", "Is it A, base; B, hypotenuse; or C, height?"];
  function harness(opts: { remaining?: number; tickMs?: number; outlineDelayMs?: number; failPrepare?: Error; autoPlay?: boolean; autoAnswer?: boolean; ttsDelayMs?: number; continueFrom?: { part: number; title: string | null }; teacherName?: string; voice?: any } = {}) {
    const prepareCalls: any[] = [];
    const svc: any = new RealtimeVoiceService();
    const client = new FakeSocket();
    const openai = new FakeSocket();
    const streams: Array<() => AsyncGenerator<any>> = [];
    const usage: number[] = [];
    const ended: any[] = [];
    const doubts: Array<{ question: string; part: number; recentLines: string[] }> = [];
    let clock = Date.now();
    const provider = {
      name: "elevenlabs",
      synthesize: async (text: string, signal: AbortSignal, onChunk: (b: Buffer) => void) => {
        for (let i = 0; i < 2; i++) {
          await sleep(opts.ttsDelayMs ?? 8);
          if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
          const tag = Buffer.from(`[${text.slice(0, 18)}:${i}]`);
          onChunk(tag.length % 2 ? Buffer.concat([tag, Buffer.from(" ")]) : tag);
        }
      },
    };
    svc.setDepsForTesting({
      streamChat: () => {
        const next = streams.shift();
        return (next ?? (async function* () { yield { type: "content", data: "Chat answer. " }; yield { type: "final", data: "Chat answer." }; }))();
      },
      commitAssistantMessage: async (_c: any, _content: string, still: () => boolean) => (still() ? "msg-1" : null),
      rollbackAssistantMessage: async () => {},
      createTtsProviders: () => ({ primary: provider, fallback: null }),
      prepareTutor: async (req: any) => {
        prepareCalls.push(req);
        if (opts.failPrepare) throw opts.failPrepare;
        return {
          chapter: "Triangles",
          language: "en",
          continueFrom: req.fromStart ? null : opts.continueFrom ?? null,
          teacherName: opts.teacherName ?? null,
          voice: opts.voice ?? null,
          lessons: {
            outline: async () => { if (opts.outlineDelayMs) await sleep(opts.outlineDelayMs); return outline; },
            section: async (i: number) => sec(i + 1),
            answerDoubt: async (question: string, ctx: any) => { doubts.push({ question, ...ctx }); return { lines: DOUBT_LINES, onTopic: true }; },
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
    const utter = (text: string, speechMs = 1500) => {
      const id = `item_${++item}`;
      const at = 1000 * item;
      event({ type: "input_audio_buffer.speech_started", item_id: id, audio_start_ms: at });
      event({ type: "input_audio_buffer.speech_stopped", item_id: id, audio_end_ms: at + speechMs });
      return event({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: text });
    };
    // The widget: reports each line as heard and the end of playback (when playing), and taps the
    // right option of a quick check (when autoAnswer).
    let playing = opts.autoPlay !== false;
    const seen = new Set<string>();
    const player = setInterval(() => {
      if (!playing) return;
      for (const m of client.json) {
        const key = `${m.type}:${m.responseId ?? m.id}:${m.index ?? ""}`;
        if (seen.has(key)) continue;
        if (m.type === "sentence_start") { seen.add(key); clientMessage({ type: "tutor_heard", responseId: m.responseId, index: m.index }); }
        if (m.type === "ai_done") { seen.add(key); clientMessage({ type: "playback_complete", responseId: m.responseId }); }
        // Tap the right option once the question has been read out.
        if (m.type === "sentence_start" && m.say === checkSaid[1] && opts.autoAnswer !== false) {
          const chk = client.ofType("tutor_check").pop();
          if (chk) clientMessage({ type: "tutor_answer", checkId: chk.id, index: CHECK.correctIndex });
        }
      }
    }, 5);
    const done = () => { clearInterval(player); svc.shutdown?.(); };
    return {
      svc, client, conversation, streams, usage, ended, doubts, prepareCalls, clientMessage, utter, done,
      setPlaying: (v: boolean) => { playing = v; },
      advance: (ms: number) => { clock += ms; },
      clock: () => clock,
    };
  }
  const spokenLines = (h: ReturnType<typeof harness>) => h.client.ofType("sentence_start").map((m) => m.say);
  const praise = "That's right, well done! The side opposite the right angle is the hypotenuse. It is always the longest.";

  // ── 3. a whole lesson ──
  {
    const h = harness();
    await h.clientMessage({ type: "tutor_start" });
    const finished = await waitFor(() => h.client.ofType("tutor_ended").length > 0, 5000, "lesson end");
    expect(finished && h.client.ofType("tutor_ended")[0].reason === "completed", "the lesson runs to the end", h.client.ofType("tutor_ended"));
    const said = spokenLines(h);
    const expected = [...outline.intro, ...sec(1).lines.map((l) => l.say), ...checkSaid, praise, ...sec(2).lines.map((l) => l.say), ...outline.recap];
    expect(said.join("|") === expected.join("|"), "plan → section 1 → its quick check → section 2 → recap, every line once", said);
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
    const chk = h.client.ofType("tutor_check")[0];
    expect(chk && chk.options.join() === "base,hypotenuse,height" && !("correctIndex" in chk) && !JSON.stringify(chk).includes("solution"), "the quick check reaches the widget without its answer key", chk);
    const chkBoard = h.client.ofType("sentence_start").find((m) => m.say === checkSaid[0])?.ops.map((o: any) => o.text).filter(Boolean);
    expect(chkBoard?.join("|") === "Quick check|The longest side of a right triangle is called?|A) base|B) hypotenuse|C) height", "the question and its options are written on the board", chkBoard);
    const res = h.client.ofType("tutor_check_result")[0];
    expect(res?.correct === true && res.correctIndex === 1, "a right answer is confirmed", res);
    expect(h.ended.length === 1 && h.ended[0].id === "session-1" && h.ended[0].reason === "completed" && h.ended[0].checksCorrect === 1 && h.ended[0].checksTotal === 1, "the session row is closed with its reason and check score", h.ended);
    h.done();
  }

  // ── 4. a spoken question → paused at the heard line → answered on the board → resumes there ──
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
    const before = h.client.log.length;
    h.setPlaying(true);
    await h.utter("Wait, why is it the longest side?", 1600);
    await waitFor(() => h.client.ofType("tutor_state").some((m) => m.state === "paused"), 3000, "paused");
    const paused = h.client.ofType("tutor_state").filter((m) => m.state === "paused").pop();
    expect(paused?.part === 0 && paused.line === 2, "a spoken question pauses at the line the student heard", paused);
    expect(h.client.ofType("response_cancelled").some((m) => m.responseId === responseId), "the tutor's speech stops");
    await waitFor(() => spokenLines(h).includes("Section 2 line 0."), 5000, "back in the lesson");
    expect(h.doubts[0]?.question === "Wait, why is it the longest side?" && h.doubts[0].part === 0 && h.doubts[0].recentLines.includes("Section 1 line 2."), "the tutor answers it (with where the student was and what was just said)", h.doubts[0]);
    const after = h.client.log.slice(before).filter((e) => e.kind === "json").map((e: any) => e.msg);
    const said = after.filter((m) => m.type === "sentence_start").map((m) => m.say);
    expect(said.slice(0, 4).join("|") === ["The hypotenuse faces the right angle.", "So it is the longest side.", "Okay, let's pick up where we left off.", "Section 1 line 2."].join("|"), "answer on the board, 'where were we', then the interrupted line again", said.slice(0, 4));
    expect(after.some((m) => m.type === "transcript" && m.text === "Wait, why is it the longest side?"), "the student's words show in the chat");
    expect(!after.some((m) => m.type === "answer_ready" && /Chat answer/.test(m.displayMarkdown || "")), "the normal chat answer is not used during a lesson");
    const snap = after.find((m) => m.type === "board_snapshot");
    const expectedBoard = boardAfter(withCleanPage(sec(1).lines as any), 2);
    expect(snap && JSON.stringify(snap.board) === JSON.stringify(expectedBoard), "the lesson's board comes back as it was at that line", snap?.board?.elements?.map((e: any) => e.id));
    await waitFor(() => h.client.ofType("tutor_ended").length > 0, 5000, "end");
    expect(h.client.ofType("tutor_ended")[0]?.reason === "completed", "and finishes the lesson");
    h.done();
  }

  // ── 4b. "samajh nahi aaya" → the simpler explanation → back to the line ──
  {
    const h = harness({ ttsDelayMs: 200 });
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => spokenLines(h).includes("Section 1 line 1."), 3000, "section 1 line 1");
    await sleep(700);
    const before = h.client.log.length;
    await h.utter("Mujhe samajh nahi aaya", 1500);
    await waitFor(() => spokenLines(h).includes("Okay, let's pick up where we left off."), 4000, "resumed");
    const said = h.client.log.slice(before).filter((e: any) => e.kind === "json" && e.msg.type === "sentence_start").map((e: any) => e.msg.say);
    expect(said[0] === "No problem, let me explain it another way." && said[1] === "Think of a slide in a park.", "'I didn't get it' (Hinglish) → the simpler explanation", said.slice(0, 3));
    expect(h.doubts.length === 0, "…without asking the model");
    await h.clientMessage({ type: "tutor_stop" });
    h.done();
  }

  // ── 4c. quick check by voice: wrong, then right ──
  {
    const h = harness({ autoAnswer: false });
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => spokenLines(h).includes(checkSaid[1]), 4000, "check asked");
    await sleep(700);
    await h.utter("option A", 900);
    await waitFor(() => h.client.ofType("tutor_check_result").length > 0, 2000, "result 1");
    const r1 = h.client.ofType("tutor_check_result")[0];
    expect(r1?.correct === false && r1.retry === true && r1.chosen === 0 && !("correctIndex" in r1), "a wrong first answer gets a second try (answer still hidden)", r1);
    await waitFor(() => spokenLines(h).includes("Not quite. Have another look and try again."), 2000, "try again");
    await sleep(700);
    await h.utter("the second one", 900);
    await waitFor(() => h.client.ofType("tutor_check_result").length > 1, 2000, "result 2");
    const r2 = h.client.ofType("tutor_check_result")[1];
    expect(r2?.correct === true && r2.chosen === 1, "'the second one' is understood as B and it is right", r2);
    await waitFor(() => spokenLines(h).includes("Section 2 line 0."), 4000, "on to section 2");
    expect(spokenLines(h).includes(praise), "praise + the solution's first sentences");
    await h.clientMessage({ type: "tutor_stop" });
    await waitFor(() => h.ended.length > 0, 2000, "ended");
    expect(h.ended[0]?.checksCorrect === 1 && h.ended[0]?.checksTotal === 1, "the score counts the check once", h.ended[0]);
    h.done();
  }

  // ── 4d. quick check: two wrong taps → the answer is explained ──
  {
    const h = harness({ autoAnswer: false });
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => h.client.ofType("tutor_check").length > 0, 4000, "check");
    const id = h.client.ofType("tutor_check")[0].id;
    h.clientMessage({ type: "tutor_answer", checkId: id, index: 2 }); // tapped while the question is still being read
    await waitFor(() => h.client.ofType("tutor_check_result").length > 0, 2000, "r1");
    await waitFor(() => spokenLines(h).includes("Not quite. Have another look and try again."), 2000, "try again");
    h.clientMessage({ type: "tutor_answer", checkId: id, index: 0 });
    await waitFor(() => h.client.ofType("tutor_check_result").length > 1, 2000, "r2");
    const r2 = h.client.ofType("tutor_check_result")[1];
    expect(r2?.correct === false && r2.correctIndex === 1, "two wrong answers: the right one is shown", r2);
    await waitFor(() => spokenLines(h).includes("The right answer is B, hypotenuse."), 2000, "reveal");
    const reveal = h.client.ofType("sentence_start").find((m) => m.say === "The right answer is B, hypotenuse.");
    expect(reveal?.ops?.some((o: any) => o.op === "highlight" && o.target === "opt1"), "…circled on the board, then explained", reveal?.ops);
    await waitFor(() => spokenLines(h).includes("Section 2 line 0."), 4000, "on");
    await h.clientMessage({ type: "tutor_stop" });
    await waitFor(() => h.ended.length > 0, 2000, "ended");
    expect(h.ended[0]?.checksCorrect === 0 && h.ended[0]?.checksTotal === 1, "the score records a miss", h.ended[0]);
    h.done();
  }

  // ── 4e. a question during a quick check → answered → the check is asked again ──
  {
    const h = harness({ autoAnswer: false });
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => spokenLines(h).includes(checkSaid[1]), 4000, "check asked");
    await sleep(700);
    await h.utter("What does opposite mean here?", 1500);
    await waitFor(() => h.client.ofType("tutor_check").length > 1 && spokenLines(h).filter((x) => x === checkSaid[0]).length > 1, 4000, "asked again");
    expect(h.doubts[0]?.question === "What does opposite mean here?", "the question is answered first");
    const said = spokenLines(h);
    const i = said.lastIndexOf("So it is the longest side.");
    expect(i > 0 && said.slice(i + 1, i + 3).join("|") === ["Okay, let's pick up where we left off.", checkSaid[0]].join("|"), "…then the quick check is asked again", said.slice(i + 1, i + 3));
    await h.clientMessage({ type: "tutor_stop" });
    h.done();
  }

  // ── 4f. a typed question, and "next part" ──
  {
    const h = harness({ autoAnswer: false, ttsDelayMs: 200 });
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => spokenLines(h).includes("Section 1 line 0."), 3000, "section 1");
    await h.clientMessage({ type: "tutor_text", text: "Is a square a triangle?" });
    await waitFor(() => h.doubts.length > 0 && spokenLines(h).includes("Okay, let's pick up where we left off."), 4000, "typed answered");
    expect(h.doubts[0]?.question === "Is a square a triangle?" && h.client.ofType("transcript").some((m) => m.text === "Is a square a triangle?"), "a typed question is answered (and shown in the chat)", h.doubts[0]);
    await sleep(700);
    await h.utter("next part please", 1200);
    await waitFor(() => spokenLines(h).includes("Section 2 line 0."), 4000, "skipped");
    expect(spokenLines(h).includes("Section 2 line 0.") && h.client.ofType("tutor_check").length === 0, "'next part' moves on (skipping the rest and its check)");
    await h.clientMessage({ type: "tutor_stop" });
    h.done();
  }

  // ── 4g. a minute left → goodbye with what was covered ──
  {
    const h = harness({ remaining: 100 });
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => !!h.conversation.tutor, 1000, "runner");
    const runner: any = h.conversation.tutor;
    await waitFor(() => spokenLines(h).includes("Section 2 line 0."), 5000, "section 2");
    runner.now = () => h.clock();
    runner.lastTickAt = h.clock();
    h.advance(45_000);
    await runner.tick();
    await waitFor(() => h.client.ofType("tutor_ended").length > 0, 4000, "goodbye");
    const said = spokenLines(h);
    const i = said.indexOf("We're almost out of tutor time for today, so let's stop here.");
    expect(i > 0 && said[i + 1] === "Today we covered The hypotenuse, Pythagoras." && said[i + 2] === "Great work — see you tomorrow!", "a minute left: goodbye with what was covered", said.slice(i));
    expect(h.client.ofType("tutor_ended")[0]?.reason === "daily_limit", "…then the lesson ends (daily limit)");
    h.done();
  }

  // ── 4h. carrying on from last time; Start over; Slower ──
  {
    const h = harness({ continueFrom: { part: 0, title: "Pythagoras" } }); // re-planned since: matched by title
    await h.clientMessage({ type: "tutor_start", slow: true });
    await waitFor(() => spokenLines(h).includes("Section 2 line 0."), 4000, "continued");
    const said = spokenLines(h);
    expect(said[0] === 'Welcome back! Last time we got to "Pythagoras", so let\'s carry on from there.' && said[1] === "Section 2 line 0.", "a student who stopped part-way carries on from that part (the plan is skipped)", said.slice(0, 2));
    expect(h.client.ofType("tutor_continued")[0]?.title === "Pythagoras", "the widget is told (it offers Start over)");
    expect(h.conversation.tutorSlow === true && h.svc.phoneSpeed(h.conversation) === 85, "Slower: the tutor speaks at 85 %");
    await h.clientMessage({ type: "tutor_speed", slow: false });
    expect(h.svc.phoneSpeed(h.conversation) === 100, "…and back to normal");
    await h.clientMessage({ type: "tutor_start", fromStart: true });
    await waitFor(() => h.prepareCalls.length === 2 && spokenLines(h).filter((x) => x === outline.intro[0]).length > 0, 4000, "start over");
    expect(h.prepareCalls[1]?.fromStart === true && spokenLines(h).includes(outline.intro[0]), "Start over begins with the plan again");
    await h.clientMessage({ type: "tutor_stop" });
    h.done();
  }

  // ── 4i. the teacher: introduces itself; the lesson speaks with the teacher's voice ──
  {
    const h = harness({ teacherName: "Priya Ma'am", voice: { elevenlabsApiKey: "el-teacher", elevenlabsVoiceId: "TeacherVoice123" } });
    await h.clientMessage({ type: "tutor_start" });
    await waitFor(() => spokenLines(h).includes(outline.intro[0]), 3000, "intro");
    const said = spokenLines(h);
    expect(said[0] === "Hi! I'm Priya Ma'am, your tutor." && said[1] === outline.intro[0], "the teacher says who they are, then the plan", said.slice(0, 2));
    expect(h.conversation.tutorVoice?.elevenlabsVoiceId === "TeacherVoice123", "the lesson's voice is set on the session");
    await h.clientMessage({ type: "tutor_stop" });
    h.done();
    // The real TTS set-up (no network: providers are only built).
    const svc: any = new RealtimeVoiceService();
    const conv: any = { openaiApiKey: "sk-x", selectedVoice: "shimmer", elevenlabsApiKey: "el-widget", elevenlabsVoiceId: "WidgetVoice", tutor: { active: true }, tutorVoice: { openaiVoice: "nova" } };
    let pv = svc.createTtsProviders(conv);
    expect(pv.primary?.name !== "elevenlabs" && pv.fallback === null, "teacher voice = an OpenAI voice → OpenAI speaks (not the widget's ElevenLabs voice)", pv.primary?.name);
    conv.tutorVoice = { elevenlabsApiKey: "el-teacher", elevenlabsVoiceId: "TeacherVoice123" };
    conv.elevenlabsApiKey = undefined; conv.elevenlabsVoiceId = undefined;
    pv = svc.createTtsProviders(conv);
    expect(pv.primary?.name === "elevenlabs", "teacher voice = ElevenLabs → ElevenLabs speaks even when the widget uses OpenAI", pv.primary?.name);
    conv.tutor = { active: false };
    pv = svc.createTtsProviders(conv);
    expect(pv.primary?.name !== "elevenlabs", "outside a lesson, the widget's own voice again");
    svc.shutdown?.();
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

  // ── 8b. what the student meant ──
  {
    const { classifyTutorIntent, answerIndex } = await import("../intent");
    const k = (t: string, o?: string[]) => classifyTutorIntent(t, { checkOptions: o ?? null }).kind;
    const cases: Array<[string, string, string[]?]> = [
      ["I didn't get it", "simpler"], ["samajh nahi aaya", "simpler"], ["समझ नहीं आया", "simpler"], ["can you explain it more simply", "simpler"], ["I'm confused", "simpler"],
      ["okay", "continue"], ["haan theek hai", "continue"], ["ठीक है", "continue"], ["got it, continue", "continue"],
      ["repeat", "repeat"], ["phir se batao", "repeat"], ["say that again", "repeat"],
      ["next part", "next"], ["skip", "next"], ["agla topic", "next"],
      ["stop the lesson", "stop"], ["bas karo", "stop"],
      ["wait", "pause"], ["ruko", "pause"], ["एक मिनट", "pause"],
      ["why is the hypotenuse the longest side", "doubt"], ["what is a right angle", "doubt"], ["okay but why is it called hypotenuse", "doubt"],
      ["B", "answer", ["x", "y", "z"]], ["option c", "answer", ["x", "y", "z"]], ["the second one", "answer", ["x", "y", "z"]], ["doosra", "answer", ["x", "y", "z"]], ["hypotenuse", "answer", ["base", "hypotenuse", "height"]],
      ["I don't know", "dontknow", ["x", "y"]], ["पता नहीं", "dontknow", ["x", "y"]],
    ];
    const wrong = cases.filter(([t, want, o]) => k(t, o) !== want).map(([t, want, o]) => `${t} → ${k(t, o)} (want ${want})`);
    expect(wrong.length === 0, `intent rules (${cases.length} EN / Hindi / Hinglish phrases)`, wrong);
    expect(answerIndex("the second one", ["x", "y", "z"]) === 1 && answerIndex("its b", ["x", "y"]) === 1 && answerIndex("option 3", ["x", "y", "z"]) === 2 && answerIndex("e", ["x", "y"]) === null, "option letters, ordinals and numbers map to the right option");
    expect(answerIndex("I think base", ["base", "hypotenuse"]) === 0 && answerIndex("base or height", ["base", "hypotenuse", "height"]) === null, "an option's own words count only when unambiguous");
  }

  // ── 8c. doubt answers: content-only sources, fresh page ──
  {
    const { answerDoubt, doubtSourceIds } = await import("../doubtAnswerer");
    const pack: any = {
      chapter: "Triangles", media: [],
      sources: [
        { id: "c1", title: "Right triangles", concept: null, text: "A right triangle has one right angle. The side opposite the right angle is the hypotenuse." },
        { id: "c2", title: "Similarity", concept: null, text: "Two triangles are similar if their corresponding angles are equal." },
        { id: "c3", title: "Area", concept: null, text: "Area of a triangle is half base times height." },
      ],
    };
    expect(doubtSourceIds(pack, "When are two triangles similar?", ["c1"]).join() === "c1,c2", "a question brings in the passages that match it, after the part's own", doubtSourceIds(pack, "When are two triangles similar?", ["c1"]));
    let seenUser = "";
    const res = await answerDoubt({
      pack, outline: null, part: -1, question: "When are triangles similar?", recentLines: [], language: "en",
      complete: async (_s, user) => { seenUser = user; return JSON.stringify({ onTopic: true, lines: [{ say: "When their angles match.", ops: [{ op: "write", id: "s", text: "Similar = same angles" }, { op: "image", id: "i", mediaId: "m9" }] }] }); },
    });
    expect(res.lines[0].ops[0]?.op === "clear" && !res.lines[0].ops.some((o: any) => o.op === "image"), "drawing starts a fresh page; figures not in the chapter are dropped", res.lines[0].ops);
    expect(/STUDENT SAID: When are triangles similar\?/.test(seenUser) && /\[c2\]/.test(seenUser), "the model sees the question and the matching passage");
    const bad = await answerDoubt({ pack, outline: null, part: -1, question: "x", recentLines: [], language: "en", complete: async () => "not json" });
    expect(bad.lines.length === 1 && bad.onTopic === false, "a broken model reply falls back to one polite line");
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
    let c = { ...initialClassroom(), status: "teaching" as const };
    c = reduceClassroom(c, { type: "tutor_check", id: "q1_0", prompt: "Longest side?", options: ["base", "hypotenuse"] });
    c = reduceClassroom(c, { type: "tutor_state", state: "checking", checkOpen: true });
    expect(c.check?.shown === false, "the options wait until the question is read");
    c = reduceClassroom(c, { type: "sentence_play", say: "Quick check!", ops: [{ op: "clear" }, { op: "write", id: "chk_t", text: "Quick check", style: "title", color: "blue" }] });
    expect(c.status === "checking" && c.check?.shown && c.check.options.length === 2 && c.check.correctIndex === null, "…then show (no answer yet)");
    c = reduceClassroom(c, { type: "tutor_check_result", id: "q1_0", correct: false, chosen: 0, retry: true });
    expect(c.check?.result === "retry" && c.checksTotal === 0, "a first wrong pick asks again (not scored yet)");
    c = reduceClassroom(c, { type: "tutor_check_result", id: "q1_0", correct: true, chosen: 1, correctIndex: 1 });
    c = reduceClassroom(c, { type: "tutor_state", state: "teaching", checkOpen: false });
    expect(c.check?.result === "right" && c.check.correctIndex === 1 && c.checksCorrect === 1 && c.checksTotal === 1, "the right answer is marked and scored, and stays while its feedback is said");
    c = reduceClassroom(c, { type: "sentence_play", say: "Next part.", ops: [{ op: "clear" }] });
    expect(c.check === null, "the next page clears the answered check");
  }

  if (failed) { outErr(`\n${failed} check(s) failed`); process.exit(1); }
  out("\nAll tutor voice checks passed.");
  process.exit(0);
}
main().catch((e) => { outErr(e); process.exit(1); });
