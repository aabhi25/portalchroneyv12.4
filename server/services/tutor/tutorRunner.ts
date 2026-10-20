/**
 * AI Tutor — one tutoring session on a voice connection. It teaches a chapter like a teacher:
 * a hello (while the lesson is prepared), the plan of the lesson on the board, each part line by
 * line with the board drawn as each line is said, a quick check from the chapter's question bank
 * after a part, then a recap.
 *
 * The student can cut in at any time (speaking, typing, or the classroom buttons):
 *  - a question → answered on a fresh page of the board from the chapter's content, then
 *    "Okay, where were we…", the board as it was, and the lesson goes on from the line they heard;
 *  - "I didn't get it" → the part's simpler explanation, then the lesson goes on;
 *  - "repeat" / "continue" / "next part" / "stop", and answers to a quick check ("B", "the second
 *    one", or a tap). A wrong answer gets a second try; then the right answer is explained.
 *
 * The voice service does the talking (TTS, interruptions, avatar audio) through TutorVoiceHost;
 * this class decides what is said and drawn next. The widget reports which line it is playing
 * (`tutor_heard`, on its audio clock), so the lesson always resumes from what was actually heard.
 *
 * Minutes per student per day: refused at start when under a minute is left; time is counted
 * every 15 s; with a minute left the tutor says goodbye (what was covered today) and ends.
 */
import { applyOps, emptyBoard, type BoardOp, type BoardState } from "@shared/tutorBoard";
import type { LessonOutline, SectionScript, TutorCheck, TutorLanguage, TutorLine } from "./lessonPlanner";
import { classifyTutorIntent, type TutorIntent } from "./intent";
import { tutorSpeech } from "./speech";
import { upgradeFormulaOps } from "./boardOps";

export interface TutorSpokenLine { say: string; speech: string; ops: BoardOp[] }

export interface TutorVoiceHost {
  /**
   * Speak lines as one response, sending `sentence_start` (with the line's board ops) as each
   * line starts. `sent` resolves once every line's audio has been sent, or the response was
   * interrupted / replaced (cancelled: true).
   */
  speak(lines: TutorSpokenLine[]): { responseId: string; sent: Promise<{ cancelled: boolean; audioMs: number }> } | null;
  /** Stop the tutor's response that is playing (if it is still the current one). */
  cancelSpeech(responseId: string): void;
  send(message: Record<string, unknown>): void;
}

export interface TutorLessonSource {
  outline(): Promise<LessonOutline>;
  section(index: number): Promise<SectionScript>;
  /**
   * Lines answering what the student said (never throws). `replyTo`: the question the tutor asked,
   * when the student is answering it. expectsReply: the lines end with a question for the student.
   */
  answerDoubt(question: string, ctx: { part: number; recentLines: string[]; replyTo?: string | null }): Promise<{ lines: TutorLine[]; onTopic: boolean; expectsReply?: boolean }>;
}

export interface TutorStore {
  remainingSeconds(): Promise<number>;
  addUsage(seconds: number): Promise<void>;
  sessionStarted(): Promise<string | null>;
  sessionEnded(id: string | null, info: { reason: string; secondsActive: number; progress: Record<string, unknown>; checksCorrect: number; checksTotal: number }): Promise<void>;
}

export type TutorState = "idle" | "planning" | "teaching" | "checking" | "answering" | "paused" | "ended";
export type TutorEndReason = "completed" | "stopped" | "daily_limit" | "disconnected" | "error" | "disabled";

export interface TutorRunnerOptions {
  host: TutorVoiceHost;
  lessons: TutorLessonSource;
  store: TutorStore;
  chapter: string;
  language: TutorLanguage;
  /** Usage is counted every tickMs (default 15 s). */
  tickMs?: number;
  /** A hello is spoken only when the lesson is not ready within this long (default 400 ms). */
  greetAfterMs?: number;
  /** A short "let me think" is said only when an answer is not ready within this long (default 1.5 s). */
  ackAfterMs?: number;
  /** Silence after an answer before the lesson goes on (default 700 ms; the student may say more). */
  settleMs?: number;
  /** Fallback when the widget never reports the end of playback (default audio + 8 s). */
  playbackSlackMs?: number;
  /** Clock (tests). */
  now?: () => number;
  /** The part this student reached last time (matched by title when the plan changed since). */
  continueFrom?: { part: number; title: string | null } | null;
  /** The teacher introduces itself by this name at the start of a lesson. */
  teacherName?: string | null;
}

/** Where the lesson goes on from: a part (-1 = the plan … sections.length = recap) and a line, or that part's quick check. */
interface Position { part: number; line: number; phase: "lesson" | "check" }
/** lesson = the lesson's own lines; check = a quick check's question (cutting in keeps it open); aside = everything else. */
type SpeechKind = "lesson" | "check" | "aside";
type SayResult = "played" | "cut" | "gone";
type CheckReply = { kind: "answer"; index: number } | { kind: "dontknow" };

const T = <V>(v: Record<TutorLanguage, V>) => v;
const GREETING = T({
  en: (c: string) => `Let's learn ${c} together! Give me a moment to get the board ready.`,
  hinglish: (c: string) => `Chalo, aaj hum ${c} padhenge! Bas ek second, board ready ho raha hai.`,
  hi: (c: string) => `चलो, आज हम ${c} पढ़ेंगे! बस एक सेकंड, बोर्ड तैयार हो रहा है।`,
});
const WELCOME_BACK = T({
  en: (t: string) => `Welcome back! Last time we got to "${t}", so let's carry on from there.`,
  hinglish: (t: string) => `Welcome back! Pichhli baar hum "${t}" tak pahunche the, toh wahin se shuru karte hain.`,
  hi: (t: string) => `फिर से स्वागत है! पिछली बार हम "${t}" तक पहुँचे थे, तो वहीं से शुरू करते हैं।`,
});
const HELLO = T({
  en: (n: string) => `Hi! I'm ${n}, your tutor.`,
  hinglish: (n: string) => `Namaste! Main ${n} hoon, aapka tutor.`,
  hi: (n: string) => `नमस्ते! मेरा नाम ${n} है।`,
});
// Phrases said often come in a few versions, used in turn (a teacher doesn't repeat one line).
const RESUME = T({
  en: ["Okay, let's pick up where we left off.", "Right, back to where we were.", "Alright, let's carry on.", "Now, let's continue from there."],
  hinglish: ["Chalo, wahin se aage badhte hain.", "Theek hai, ab wapas lesson par.", "Achha, ab aage chalte hain.", "Chalo, jahan ruke the wahin se."],
  hi: ["चलो, वहीं से आगे बढ़ते हैं।", "ठीक है, अब वापस पाठ पर।", "अच्छा, अब आगे चलते हैं।", "चलो, जहाँ रुके थे वहीं से।"],
});
/** Said only when an answer takes a while (no "Good question!" every time). */
const THINKING = T({
  en: ["Hmm, let me think.", "Okay, one moment.", "Let me see.", "Right, give me a second."],
  hinglish: ["Hmm, ek second.", "Achha, dekhte hain.", "Ruko, sochne do.", "Theek hai, ek minute."],
  hi: ["हम्म, एक सेकंड।", "अच्छा, देखते हैं।", "रुको, सोचने दो।", "ठीक है, एक मिनट।"],
});
const SIMPLER_INTRO = T({ en: "No problem, let me explain it another way.", hinglish: "Koi baat nahi, ise doosre tareeke se samajhte hain.", hi: "कोई बात नहीं, इसे दूसरे तरीके से समझते हैं।" });
const QUICK = T({ en: "Quick check!", hinglish: "Ek quick check!", hi: "एक छोटा सा सवाल!" });
const ASK_OPTIONS = T({
  en: (opts: string) => `Is it ${opts}?`,
  hinglish: (opts: string) => `Sahi jawab kaunsa hai: ${opts}?`,
  hi: (opts: string) => `सही जवाब कौन सा है: ${opts}?`,
});
const OR = T({ en: "or", hinglish: "ya", hi: "या" });
const CORRECT = T({ en: "That's right, well done!", hinglish: "Bilkul sahi, shabash!", hi: "बिल्कुल सही, शाबाश!" });
const TRY_AGAIN = T({ en: "Not quite. Have another look and try again.", hinglish: "Nahi, ek baar phir dekho aur try karo.", hi: "नहीं, एक बार फिर देखो और कोशिश करो।" });
const REVEAL = T({
  en: (o: string) => `The right answer is ${o}.`,
  hinglish: (o: string) => `Sahi jawab hai ${o}.`,
  hi: (o: string) => `सही जवाब है ${o}।`,
});
const RECAP_TITLE = T({ en: "Quick recap", hinglish: "Quick recap", hi: "दोहराव" });
const CHECK_TITLE = T({ en: "Quick check", hinglish: "Quick check", hi: "छोटा सा सवाल" });
const BYE_TITLE = T({ en: "See you tomorrow!", hinglish: "Kal milte hain!", hi: "कल मिलते हैं!" });
const BYE_TIME = T({
  en: "We're almost out of tutor time for today, so let's stop here.",
  hinglish: "Aaj ka tutor time lagbhag khatam ho gaya hai, toh yahin rukte hain.",
  hi: "आज का ट्यूटर समय लगभग खत्म हो गया है, तो यहीं रुकते हैं।",
});
const BYE_COVERED = T({
  en: (t: string) => `Today we covered ${t}.`,
  hinglish: (t: string) => `Aaj humne padha: ${t}.`,
  hi: (t: string) => `आज हमने पढ़ा: ${t}।`,
});
const BYE_END = T({ en: "Great work — see you tomorrow!", hinglish: "Bahut badhiya — kal milte hain!", hi: "बहुत बढ़िया — कल मिलते हैं!" });

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Board text: no TeX dollars / Markdown marks. */
const plain = (s: string) => String(s || "").replace(/\$+/g, "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
/** The first sentence or two of a solution, for saying out loud. */
const shortSolution = (s: string | null) => {
  const t = plain(s || "");
  if (!t) return "";
  const parts = t.match(/[^.!?।]+[.!?।]?/g) || [t];
  return clip(parts.slice(0, 2).map((p) => p.trim()).join(" "), 260);
};

/** The plan of the lesson as board lines: the title, then the sections as a numbered list. */
export function planLines(outline: LessonOutline): TutorLine[] {
  const intro = outline.intro.length ? outline.intro : [outline.title];
  const listOps: BoardOp[] = outline.sections.slice(0, 8).map((s, i) => ({ op: "write", id: `plan${i + 1}`, text: clip(`${i + 1}. ${s.title}`), style: "body", color: "ink" }));
  return intro.map((say, i) => {
    const ops: BoardOp[] = [];
    if (i === 0) ops.push({ op: "clear" }, { op: "write", id: "plantitle", text: clip(outline.title), style: "title", color: "blue" });
    if (i === Math.min(1, intro.length - 1)) ops.push(...listOps);
    return { say, ops };
  });
}

/** The recap: a fresh page that ticks off each section as a recap line is said. */
export function recapLines(outline: LessonOutline, language: TutorLanguage): TutorLine[] {
  return outline.recap.map((say, i) => {
    const ops: BoardOp[] = i === 0 ? [{ op: "clear" }, { op: "write", id: "recaptitle", text: RECAP_TITLE[language], style: "title", color: "blue" }] : [];
    const perLine = Math.ceil(outline.sections.length / outline.recap.length);
    outline.sections.forEach((s, k) => {
      if (Math.floor(k / perLine) === i) ops.push({ op: "write", id: `recap${k + 1}`, text: clip(`✓ ${s.title}`), style: "body", color: "green" });
    });
    return { say, ops };
  });
}

/** A quick check on the board: the question and its options; said as the question, then the options. */
export function checkLines(check: TutorCheck, language: TutorLanguage): TutorLine[] {
  const opts = check.options.map((o, i) => `${LETTERS[i]}, ${plain(o)}`);
  const said = opts.length > 1 ? `${opts.slice(0, -1).join("; ")}; ${OR[language]} ${opts[opts.length - 1]}` : opts.join("");
  return [
    {
      say: `${QUICK[language]} ${clip(plain(check.prompt), 300)}`,
      ops: [
        { op: "clear" },
        { op: "write", id: "chk_t", text: CHECK_TITLE[language], style: "title", color: "blue" },
        { op: "write", id: "chk_q", text: clip(plain(check.prompt)), style: "body", color: "ink" },
        ...check.options.map((o, i): BoardOp => ({ op: "write", id: `opt${i}`, text: clip(`${LETTERS[i]}) ${plain(o)}`), style: "body", color: "ink" })),
      ],
    },
    { say: ASK_OPTIONS[language](said), ops: [] },
  ];
}

/** Every section starts on a clean page, so the board at any line is known from the script alone. */
export function withCleanPage(lines: TutorLine[]): TutorLine[] {
  if (!lines.length || lines[0].ops[0]?.op === "clear") return lines;
  return [{ ...lines[0], ops: [{ op: "clear" }, ...lines[0].ops] }, ...lines.slice(1)];
}

/** The board after the first `count` lines. */
export function boardAfter(lines: TutorLine[], count: number): BoardState {
  let b = emptyBoard();
  for (const l of lines.slice(0, count)) b = applyOps(b, upgradeFormulaOps(l.ops));
  return b;
}

export class TutorRunner {
  state: TutorState = "idle";
  endReason: TutorEndReason | null = null;
  private outline: LessonOutline | null = null;
  private outlineP: Promise<LessonOutline> | null = null;
  private readonly sections = new Map<number, Promise<SectionScript>>();
  /** Bumped whenever the lesson is paused, redirected or stopped: older loops quit. */
  private gen = 0;
  /** What is being said now. */
  private current: { responseId: string; kind: SpeechKind; lines: TutorLine[]; from: number } | null = null;
  /** Where the lesson goes on from (updated as lines are heard). */
  private here: Position = { part: -1, line: 0, phase: "lesson" };
  /** Set while paused: where Continue goes back to. */
  private resumeAt: Position | null = null;
  private check: { part: number; check: TutorCheck; tries: number; waiter: ((r: CheckReply | null) => void) | null; pending: CheckReply | null } | null = null;
  private checksCorrect = 0;
  private checksTotal = 0;
  private readonly recent: string[] = [];
  private readonly playback = new Map<string, (played: boolean) => void>();
  private ticker: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private startedAt = 0;
  private remaining = 0;
  private wrapping = false;
  private introduced = false;
  /** The tutor asked the student something and is waiting for the answer. */
  private awaiting: { question: string; lines: TutorLine[] } | null = null;
  private readonly askedChecks = new Set<string>();
  private lastCheckId: string | null = null;
  private readonly phraseTurn = new Map<string, number>();
  private wrapped = false;
  private wrapTimer: NodeJS.Timeout | null = null;
  private sessionId: Promise<string | null> = Promise.resolve(null);
  private readonly tickMs: number;
  private now: () => number;

  constructor(private readonly o: TutorRunnerOptions) {
    this.tickMs = o.tickMs ?? 15_000;
    this.now = o.now ?? Date.now;
  }

  /** (A method, so the check is re-read after awaits.) */
  private isEnded(): boolean { return this.state === "ended"; }
  get active(): boolean { return this.state !== "idle" && this.state !== "ended"; }
  get progress(): { part: number; line: number } { const p = this.resumeAt ?? this.here; return { part: p.part, line: p.line }; }
  private get L(): TutorLanguage { return this.o.language; }

  // ── start ──

  async start(): Promise<void> {
    if (this.state !== "idle") return;
    this.state = "planning";
    this.remaining = await this.o.store.remainingSeconds().catch(() => 0);
    if (this.remaining < 60) { await this.end("daily_limit"); return; }
    this.startedAt = this.lastTickAt = this.now();
    this.sessionId = this.o.store.sessionStarted().catch(() => null);
    this.ticker = setInterval(() => void this.tick(), this.tickMs);
    this.ticker.unref?.();
    this.sendState();

    const gen = this.gen;
    const outline = this.loadOutline();
    // Cached plans are instant; a first-ever lesson takes a few seconds — say hello meanwhile.
    const quick = await Promise.race([outline.then(() => true, () => true), sleep(this.o.greetAfterMs ?? 400).then(() => false)]);
    let greeting: Promise<SayResult> | null = null;
    if (!quick && gen === this.gen) greeting = this.say("aside", [{ say: GREETING[this.L](this.o.chapter), ops: [] }]);
    try {
      await outline;
    } catch (error) {
      if (this.isEnded()) return;
      this.o.host.send({ type: "tutor_error", message: error instanceof Error ? error.message : "The lesson could not be prepared." });
      await this.end("error");
      return;
    }
    if (gen !== this.gen || this.isEnded()) return;
    if (greeting && (await greeting) !== "played") return;
    if (gen !== this.gen) return;
    // Left part-way last time: carry on from that part (the plan is skipped).
    const cont = this.continuePart();
    if (cont != null && this.outline) {
      const title = this.outline.sections[cont].title;
      this.o.host.send({ type: "tutor_continued", part: cont, title });
      if ((await this.say("aside", [{ say: WELCOME_BACK[this.L](title), ops: [] }])) !== "played") return;
      if (gen !== this.gen) return;
      await this.runFrom({ part: cont, line: 0, phase: "lesson" }, false);
      return;
    }
    await this.runFrom({ part: -1, line: 0, phase: "lesson" }, false);
  }

  /** The part to continue from, if the student left this chapter's lesson part-way. */
  private continuePart(): number | null {
    const c = this.o.continueFrom;
    const sections = this.outline?.sections ?? [];
    if (!c || !sections.length) return null;
    const byTitle = c.title ? sections.findIndex((s) => s.title.trim().toLowerCase() === c.title!.trim().toLowerCase()) : -1;
    const part = byTitle >= 0 ? byTitle : c.part;
    return part > 0 && part < sections.length ? part : null;
  }

  private loadOutline(): Promise<LessonOutline> {
    if (!this.outlineP) {
      this.outlineP = this.o.lessons.outline().then((o) => {
        this.outline = o;
        this.prefetch(0);
        this.o.host.send({ type: "tutor_outline", title: o.title, sections: o.sections.map((s) => ({ id: s.id, title: s.title })) });
        return o;
      });
      this.outlineP.catch(() => undefined);
    }
    return this.outlineP;
  }

  // ── what the widget reports ──

  /** The widget is playing line `index` of a response (its audio clock). */
  onHeard(responseId: string, index: number): void {
    const c = this.current;
    if (!c || c.responseId !== responseId || !Number.isInteger(index)) return;
    const line = c.lines[c.from + index];
    if (line) { this.recent.push(line.say); if (this.recent.length > 6) this.recent.shift(); }
    if (c.kind === "lesson") this.here = { ...this.here, line: Math.max(this.here.line, Math.min(c.lines.length - 1, c.from + index)) };
    // Out of minutes: the goodbye starts at a line boundary.
    if (this.wrapping && index > 0) void this.wrapUp();
  }

  onPlaybackComplete(responseId: string): void {
    this.playback.get(responseId)?.(true);
  }

  /**
   * The voice service abandoned a response (the student spoke over it, tapped stop, or another
   * answer took over). Its audio is usually all sent long before it is heard, so this is how an
   * interruption during playback reaches the lesson. A quick check's question stays open;
   * anything else pauses the lesson where the student was.
   */
  onResponseCancelled(responseId: string): void {
    const c = this.current;
    this.playback.get(responseId)?.(false);
    if (!c || c.responseId !== responseId) return;
    this.current = null;
    if (c.kind === "check" || this.wrapped) return;
    this.pause();
  }

  // ── what the student does ──

  /**
   * Something the student said (voice) or typed during the lesson. Voice turns arrive after the
   * voice service already stopped the tutor's speech; typed ones stop it here.
   */
  async handleStudentTurn(text: string, opts: { typed?: boolean } = {}): Promise<void> {
    if (!this.active || this.wrapping) return;
    const intent: TutorIntent = classifyTutorIntent(text, { checkOptions: this.check?.check.options ?? null });
    if (this.check && (intent.kind === "answer" || intent.kind === "dontknow")) {
      this.replyToCheck(intent.kind === "answer" ? { kind: "answer", index: intent.index } : { kind: "dontknow" });
      return;
    }
    // Typing over the tutor stops it like speaking over it does (a quick check's question stays open).
    if (opts.typed && this.current && this.current.kind !== "check") this.pause();
    // The tutor asked them something: what they say now is their answer (unless it's a command).
    const awaiting = this.awaiting;
    if (awaiting && (intent.kind === "doubt" || intent.kind === "answer" || intent.kind === "dontknow")) {
      this.awaiting = null;
      await this.answerQuestion(text, { replyTo: awaiting.question });
      return;
    }
    if (awaiting && intent.kind === "repeat") { await this.say("aside", awaiting.lines); return; }
    this.awaiting = null;
    switch (intent.kind) {
      case "quiz":
        // A quick check is already open: that is their question.
        if (this.check && this.state === "checking") { await this.askCheckAgain(); return; }
        await this.quizMe(text);
        return;
      case "continue":
        if (this.state === "paused") await this.resumeLesson();
        return;
      case "repeat":
        if (this.check && this.state === "checking") { await this.askCheckAgain(); return; }
        if (this.state === "paused") await this.resumeLesson(false);
        return;
      case "simpler":
        await this.explainSimpler();
        return;
      case "next":
        await this.skip();
        return;
      case "stop":
        await this.stop("stopped");
        return;
      case "pause":
        this.pause();
        return;
      default:
        await this.answerQuestion(text);
    }
  }

  /** A tap on an option of the open quick check. */
  answerCheck(checkId: string, index: number): void {
    if (!this.check || this.check.check.id !== checkId || !Number.isInteger(index)) return;
    this.replyToCheck({ kind: "answer", index });
  }

  /** "I don't know" on the open quick check. */
  giveUpCheck(checkId: string): void {
    if (!this.check || this.check.check.id !== checkId) return;
    this.replyToCheck({ kind: "dontknow" });
  }

  /** Continue a paused lesson from the line that was interrupted. */
  async resume(): Promise<void> {
    if (this.state === "paused") await this.resumeLesson();
  }

  /** "I didn't get it": the part's simpler explanation, then on with the lesson. */
  async explainSimpler(): Promise<void> {
    if (!this.active || this.wrapping) return;
    this.pause();
    const gen = this.gen;
    const at = this.resumeAt ?? this.here;
    let lines: TutorLine[] = [];
    if (this.outline && at.part >= 0 && at.part < this.outline.sections.length) {
      lines = (await this.section(at.part).catch(() => null))?.simpler ?? [];
    }
    if (gen !== this.gen || this.isEnded()) return;
    if (!lines.length) {
      const title = this.outline && at.part >= 0 ? this.outline.sections[at.part]?.title : this.o.chapter;
      await this.answerQuestion(`I didn't understand "${title}". Please explain it again more simply, with an everyday example.`);
      return;
    }
    this.state = "teaching";
    if ((await this.say("aside", [{ say: SIMPLER_INTRO[this.L], ops: [] }, ...lines])) !== "played") return;
    await this.resumeLesson();
  }

  /** Jump to the next part (the student asked to move on). */
  async skip(): Promise<void> {
    if (!this.active || this.wrapping) return;
    await this.loadOutline().catch(() => undefined);
    if (!this.outline) return;
    this.pause();
    const at = this.resumeAt ?? this.here;
    this.resumeAt = null;
    await this.runFrom({ part: Math.min(at.part + 1, this.outline.sections.length), line: 0, phase: "lesson" }, false);
  }

  async stop(reason: TutorEndReason = "stopped"): Promise<void> {
    if (this.isEnded()) return;
    this.cutSpeech();
    await this.end(reason);
  }

  // ── lesson flow ──

  private async resumeLesson(sayResume = true): Promise<void> {
    const at = this.resumeAt ?? this.here;
    this.resumeAt = null;
    await this.loadOutline().catch(() => undefined);
    if (!this.outline || this.isEnded()) return;
    await this.runFrom(at, sayResume);
  }

  /** Teaches from a position to the end: each part's lines, its quick check, then the recap. */
  private async runFrom(from: Position, resumed: boolean): Promise<void> {
    const gen = ++this.gen;
    this.awaiting = null; // moving on: a question the tutor asked is no longer waiting
    const outline = this.outline;
    if (!outline) return;
    for (let p = from.part; p <= outline.sections.length; p++) {
      if (gen !== this.gen || this.isEnded()) return;
      const first = p === from.part;
      const isSection = p >= 0 && p < outline.sections.length;
      let script: SectionScript | null = null;
      if (isSection) {
        this.prefetch(p + 1);
        if (!(await isSettled(this.section(p)))) this.o.host.send({ type: "tutor_state", state: "preparing", part: p });
        script = await this.section(p).catch(() => null);
        if (gen !== this.gen || this.isEnded()) return;
        if (!script) { this.sections.delete(p); continue; } // a part that cannot be prepared is skipped, not the lesson
      }
      if (!(first && from.phase === "check")) {
        const lines = p === -1 ? planLines(outline) : isSection ? withCleanPage(script!.lines) : recapLines(outline, this.L);
        const start = first ? Math.min(from.line, lines.length - 1) : 0;
        const resumeHere = resumed && first;
        if (start > 0 || resumeHere) this.o.host.send({ type: "board_snapshot", board: boardAfter(lines, start) });
        this.here = { part: p, line: start, phase: "lesson" };
        this.state = "teaching";
        // Resuming: "Okay, where were we…" first; a new lesson: the teacher says who they are.
        // A spoken prefix counts as the line(s) before `start` of this part.
        const prefix: TutorLine[] = [];
        if (resumeHere) prefix.push({ say: this.phrase("resume", RESUME[this.L]), ops: [] });
        else if (p === -1 && start === 0 && this.o.teacherName && !this.introduced) {
          this.introduced = true;
          prefix.push({ say: HELLO[this.L](this.o.teacherName), ops: [] });
        }
        const toSay = [...prefix, ...lines.slice(start)];
        if ((await this.say("lesson", toSay, start - prefix.length, lines)) !== "played") return;
      }
      const resumingCheck = resumed && first && from.phase === "check";
      const check = isSection ? (resumingCheck ? script!.checks.find((c) => c.id === this.lastCheckId) : undefined) ?? script!.checks.find((c) => !this.askedChecks.has(c.id)) : undefined;
      if (check) {
        if (!(await this.runCheck(p, check, gen, resumingCheck))) return;
      }
    }
    await this.end("completed");
  }

  /**
   * A quick check. `returnTo`: asked on request in the middle of the lesson ("quiz me") — the
   * lesson then goes on from there instead of from the next part.
   */
  private async runCheck(part: number, check: TutorCheck, gen: number, resumed = false, returnTo?: Position): Promise<boolean> {
    if (!returnTo) this.here = { part, line: 0, phase: "check" };
    this.askedChecks.add(check.id);
    this.lastCheckId = check.id;
    this.state = "checking";
    this.check = { part, check, tries: 0, waiter: null, pending: null };
    // Never the answer key: the widget learns the right option only once it is answered.
    this.o.host.send({ type: "tutor_check", id: check.id, prompt: plain(check.prompt), options: check.options.map(plain) });
    this.sendState();
    const ask = checkLines(check, this.L);
    if ((await this.say("check", resumed ? [{ say: this.phrase("resume", RESUME[this.L]), ops: [] }, ...ask] : ask)) === "gone") return false;
    let feedback: TutorLine[] = [];
    for (;;) {
      if (gen !== this.gen || this.isEnded() || !this.check) return false;
      const reply = await this.nextCheckReply();
      if (!reply || gen !== this.gen || this.isEnded() || !this.check) return false;
      const c = this.check;
      c.tries++;
      const chosen = reply.kind === "answer" ? reply.index : null;
      if (chosen === check.correctIndex) {
        this.checksCorrect++; this.checksTotal++;
        this.o.host.send({ type: "tutor_check_result", id: check.id, correct: true, chosen, correctIndex: check.correctIndex });
        feedback = [{ say: [CORRECT[this.L], shortSolution(check.solution)].filter(Boolean).join(" "), ops: [{ op: "highlight", target: `opt${check.correctIndex}`, mode: "circle" }] }];
        break;
      }
      if (chosen != null && c.tries < 2) {
        this.o.host.send({ type: "tutor_check_result", id: check.id, correct: false, chosen, retry: true });
        if ((await this.say("check", [{ say: TRY_AGAIN[this.L], ops: [{ op: "highlight", target: `opt${chosen}`, mode: "underline" }] }])) === "gone") return false;
        continue;
      }
      this.checksTotal++;
      this.o.host.send({ type: "tutor_check_result", id: check.id, correct: false, chosen, correctIndex: check.correctIndex });
      const right = `${LETTERS[check.correctIndex]}, ${plain(check.options[check.correctIndex])}`;
      const sol = shortSolution(check.solution);
      feedback = [
        { say: REVEAL[this.L](right), ops: [{ op: "highlight", target: `opt${check.correctIndex}`, mode: "circle" }, ...(sol ? [{ op: "write", id: "chk_sol", text: clip(sol), style: "note", color: "green" } as BoardOp] : [])] },
        ...(sol ? [{ say: sol, ops: [] as BoardOp[] }] : []),
      ];
      break;
    }
    this.check = null;
    this.here = returnTo ?? { part: part + 1, line: 0, phase: "lesson" };
    this.state = "teaching";
    this.sendState();
    return (await this.say("aside", feedback)) === "played";
  }

  private nextCheckReply(): Promise<CheckReply | null> {
    const c = this.check;
    if (!c) return Promise.resolve(null);
    if (c.pending) { const r = c.pending; c.pending = null; return Promise.resolve(r); }
    return new Promise((resolve) => { c.waiter = resolve; });
  }

  private replyToCheck(reply: CheckReply): void {
    const c = this.check;
    if (!c) return;
    // Answering over the question / "try again": stop that speech, keep the check.
    if (this.current?.kind === "check") this.cutSpeech();
    if (c.waiter) { const w = c.waiter; c.waiter = null; w(reply); } else c.pending = reply;
  }

  private async askCheckAgain(): Promise<void> {
    const c = this.check;
    if (!c) return;
    await this.say("check", checkLines(c.check, this.L));
  }

  /**
   * A question or remark: answered on a fresh page, then — after a moment, in case they say more —
   * on with the lesson. When the answer asks the student something ("quiz me"), the tutor waits.
   */
  private async answerQuestion(question: string, opts: { replyTo?: string | null } = {}): Promise<void> {
    this.pause();
    const gen = this.gen;
    this.state = "answering";
    this.awaiting = null;
    this.sendState();
    const at = this.resumeAt ?? this.here;
    const answer = this.o.lessons.answerDoubt(question, { part: at.part, recentLines: [...this.recent], replyTo: opts.replyTo ?? null });
    const quick = await Promise.race([answer.then(() => true, () => true), sleep(this.o.ackAfterMs ?? 1500).then(() => false)]);
    const ack = !quick && gen === this.gen ? this.say("aside", [{ say: this.phrase("thinking", THINKING[this.L]), ops: [] }]) : null;
    const { lines, expectsReply } = await answer.catch(() => ({ lines: [] as TutorLine[], onTopic: false, expectsReply: false }));
    if (ack && (await ack) !== "played") return;
    if (gen !== this.gen || this.isEnded()) return;
    if (lines.length && (await this.say("aside", lines)) !== "played") return;
    if (gen !== this.gen || this.isEnded()) return;
    if (expectsReply && lines.length) {
      // The tutor asked the student something: wait for their answer (spoken or typed).
      this.awaiting = { question: lines[lines.length - 1].say, lines };
      this.state = "paused";
      this.sendState();
      return;
    }
    await sleep(this.o.settleMs ?? 700);
    if (gen !== this.gen || this.isEnded()) return;
    await this.resumeLesson();
  }

  /** "Ask me a question": a quick check from the question bank on what was taught, else an open question. */
  private async quizMe(text: string): Promise<void> {
    this.pause();
    const gen = this.gen;
    const at = { ...(this.resumeAt ?? this.here) };
    await this.loadOutline().catch(() => undefined);
    let found: { part: number; check: TutorCheck } | null = null;
    // The part being taught first, then the ones before it.
    for (let p = Math.min(at.part, (this.outline?.sections.length ?? 0) - 1); p >= 0 && !found; p--) {
      const script = await this.section(p).catch(() => null);
      const c = script?.checks.find((x) => !this.askedChecks.has(x.id));
      if (c) found = { part: p, check: c };
    }
    if (gen !== this.gen || this.isEnded()) return;
    if (!found) { await this.answerQuestion(text); return; }
    if (!(await this.runCheck(found.part, found.check, gen, false, at))) return;
    await sleep(this.o.settleMs ?? 700);
    if (gen !== this.gen || this.isEnded()) return;
    await this.resumeLesson();
  }

  /** The next of a few versions of a phrase. */
  private phrase(key: string, pool: string[]): string {
    const i = this.phraseTurn.get(key) ?? 0;
    this.phraseTurn.set(key, i + 1);
    return pool[i % pool.length];
  }

  // ── speaking ──

  /** Says `lines` as one response and waits until the widget has played them. */
  private async say(kind: SpeechKind, lines: TutorLine[], from = 0, fullLines?: TutorLine[]): Promise<SayResult> {
    const gen = this.gen;
    if (this.isEnded()) return "gone";
    if (!lines.length) return "played";
    // (Formulas written as text in plans cached before that check are drawn as maths too.)
    const spoken = lines.map((l) => ({ say: l.say, speech: tutorSpeech(l.say, this.L) || l.say, ops: upgradeFormulaOps(l.ops) }));
    const started = this.o.host.speak(spoken);
    if (!started) { await this.end("disconnected"); return "gone"; }
    const rid = started.responseId;
    this.current = { responseId: rid, kind, lines: fullLines ?? lines, from };
    this.sendState();
    const played = new Promise<boolean>((resolve) => this.playback.set(rid, resolve));
    const sent = await started.sent;
    let ok = !sent.cancelled;
    if (ok) ok = await Promise.race([played, sleep(sent.audioMs + (this.o.playbackSlackMs ?? 8000)).then(() => true)]);
    this.playback.delete(rid);
    // Cancelled without the voice service telling us (e.g. the socket closed): same as a cut-in.
    if (!ok && this.current?.responseId === rid) this.onResponseCancelled(rid);
    if (this.current?.responseId === rid) this.current = null;
    if (gen !== this.gen || this.isEnded()) return "gone";
    return ok ? "played" : "cut";
  }

  /** Stop the tutor's speech now (the runner decides what happens next). */
  private cutSpeech(): void {
    const c = this.current;
    this.current = null;
    if (!c) return;
    this.playback.get(c.responseId)?.(false);
    this.o.host.cancelSpeech(c.responseId);
  }

  /** Pause where the student is (Continue goes back there). Any running flow quits. */
  private pause(): void {
    this.gen++;
    this.cutSpeech();
    if (this.check?.waiter) { const w = this.check.waiter; this.check.waiter = null; w(null); }
    if (this.isEnded()) return;
    if (this.state !== "paused" && this.state !== "answering") this.resumeAt = { ...this.here };
    this.check = null; // asked again on Continue
    this.state = "paused";
    this.sendState();
  }

  private section(i: number): Promise<SectionScript> {
    let p = this.sections.get(i);
    if (!p) {
      p = this.o.lessons.section(i);
      p.catch(() => undefined);
      this.sections.set(i, p);
    }
    return p;
  }

  private prefetch(i: number): void {
    if (this.outline && i >= 0 && i < this.outline.sections.length) void this.section(i);
  }

  private sendState(): void {
    const p = this.progress;
    this.o.host.send({
      type: "tutor_state",
      state: this.state,
      part: p.part,
      line: p.line,
      sections: this.outline?.sections.length ?? 0,
      canResume: this.state === "paused" && !!this.resumeAt,
      checkOpen: !!this.check,
      awaitingReply: !!this.awaiting,
      remainingSeconds: Math.max(0, Math.round(this.remaining)),
    });
  }

  // ── minutes ──

  private async tick(): Promise<void> {
    if (!this.active) return;
    const now = this.now();
    const seconds = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    this.remaining -= seconds;
    await this.o.store.addUsage(Math.round(seconds)).catch(() => undefined);
    if (this.remaining <= 0) { await this.stop("daily_limit"); return; }
    if (this.remaining <= 60 && !this.wrapping) {
      // A minute left: say goodbye at the next line boundary (or soon, if nothing is playing).
      this.wrapping = true;
      this.wrapTimer = setTimeout(() => void this.wrapUp(), this.current ? 8000 : 0);
      this.wrapTimer.unref?.();
    }
  }

  private async wrapUp(): Promise<void> {
    if (this.wrapped || this.isEnded()) return;
    this.wrapped = true;
    if (this.wrapTimer) { clearTimeout(this.wrapTimer); this.wrapTimer = null; }
    this.gen++;
    this.cutSpeech();
    if (this.check?.waiter) { const w = this.check.waiter; this.check.waiter = null; w(null); }
    this.check = null;
    const at = this.resumeAt ?? this.here;
    const covered = (this.outline?.sections ?? []).filter((_, i) => i < at.part || (i === at.part && at.line > 0)).map((s) => s.title);
    const lines: TutorLine[] = [
      { say: BYE_TIME[this.L], ops: [{ op: "clear" }, { op: "write", id: "byetitle", text: BYE_TITLE[this.L], style: "title", color: "blue" }, ...covered.slice(0, 6).map((t, i): BoardOp => ({ op: "write", id: `bye${i}`, text: clip(`✓ ${t}`), style: "body", color: "green" }))] },
      ...(covered.length ? [{ say: BYE_COVERED[this.L](covered.slice(0, 3).join(", ")), ops: [] as BoardOp[] }] : []),
      { say: BYE_END[this.L], ops: [] },
    ];
    this.state = "teaching";
    await this.say("aside", lines);
    await this.end("daily_limit");
  }

  private async end(reason: TutorEndReason): Promise<void> {
    if (this.isEnded()) return;
    const progress = this.progress;
    this.gen++;
    this.state = "ended";
    this.endReason = reason;
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
    if (this.wrapTimer) { clearTimeout(this.wrapTimer); this.wrapTimer = null; }
    for (const resolve of Array.from(this.playback.values())) resolve(false);
    this.playback.clear();
    if (this.check?.waiter) this.check.waiter(null);
    this.check = null;
    if (this.startedAt) {
      const left = Math.round((this.now() - this.lastTickAt) / 1000);
      if (left > 0) await this.o.store.addUsage(left).catch(() => undefined);
    }
    this.o.host.send({ type: "tutor_ended", reason, part: progress.part, line: progress.line, checksCorrect: this.checksCorrect, checksTotal: this.checksTotal });
    await this.o.store.sessionEnded(await this.sessionId, {
      reason,
      secondsActive: this.startedAt ? Math.round((this.now() - this.startedAt) / 1000) : 0,
      progress: { part: progress.part, line: progress.line, sections: this.outline?.sections.length ?? 0, title: this.outline?.sections[progress.part]?.title ?? null },
      checksCorrect: this.checksCorrect,
      checksTotal: this.checksTotal,
    }).catch(() => undefined);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); });
async function isSettled(p: Promise<unknown>): Promise<boolean> {
  return Promise.race([p.then(() => true, () => true), new Promise<boolean>((r) => setImmediate(() => r(false)))]);
}
