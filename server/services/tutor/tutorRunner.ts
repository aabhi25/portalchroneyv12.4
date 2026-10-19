/**
 * AI Tutor — one tutoring session on a voice connection. It teaches a chapter like a teacher:
 * a hello (while the lesson is prepared), the plan of the lesson on the board, each section line
 * by line with the board drawn as each line is said, then a recap.
 *
 * The voice service does the talking (TTS, interruptions, avatar audio) through TutorVoiceHost;
 * this class only decides what is said and drawn next. Each part of the lesson is one spoken
 * response. The widget reports which line it is playing (`tutor_heard`, on its audio clock), so
 * an interruption pauses the lesson at the line the student actually heard, and Resume starts
 * from that line with the board as it was.
 *
 * Minutes per student per day: refused at start when under a minute is left; time is counted
 * every 15 s and the lesson ends when the day's minutes run out.
 */
import { applyOps, emptyBoard, type BoardOp, type BoardState } from "@shared/tutorBoard";
import type { LessonOutline, SectionScript, TutorLanguage, TutorLine } from "./lessonPlanner";
import { tutorSpeech } from "./speech";

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
}

export interface TutorStore {
  remainingSeconds(): Promise<number>;
  addUsage(seconds: number): Promise<void>;
  sessionStarted(): Promise<string | null>;
  sessionEnded(id: string | null, info: { reason: string; secondsActive: number; progress: Record<string, unknown> }): Promise<void>;
}

export type TutorState = "idle" | "planning" | "teaching" | "paused" | "ended";
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
  /** Fallback when the widget never reports the end of playback (default audio + 8 s). */
  playbackSlackMs?: number;
  /** Clock (tests). */
  now?: () => number;
}

/** A part of the lesson: -1 = the plan, 0… = sections, sections.length = recap. */
type Part = number;

const GREETING: Record<TutorLanguage, (chapter: string) => string> = {
  en: (c) => `Let's learn ${c} together! Give me a moment to get the board ready.`,
  hinglish: (c) => `Chalo, aaj hum ${c} padhenge! Bas ek second, board ready ho raha hai.`,
  hi: (c) => `चलो, आज हम ${c} पढ़ेंगे! बस एक सेकंड, बोर्ड तैयार हो रहा है।`,
};
const RESUME: Record<TutorLanguage, string> = {
  en: "Okay, let's pick up where we left off.",
  hinglish: "Chalo, wahin se aage badhte hain.",
  hi: "चलो, वहीं से आगे बढ़ते हैं।",
};
const RECAP_TITLE: Record<TutorLanguage, string> = { en: "Quick recap", hinglish: "Quick recap", hi: "दोहराव" };

const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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

/** Every section starts on a clean page, so the board at any line is known from the script alone. */
export function withCleanPage(lines: TutorLine[]): TutorLine[] {
  if (!lines.length || lines[0].ops[0]?.op === "clear") return lines;
  return [{ ...lines[0], ops: [{ op: "clear" }, ...lines[0].ops] }, ...lines.slice(1)];
}

/** The board after the first `count` lines. */
export function boardAfter(lines: TutorLine[], count: number): BoardState {
  let b = emptyBoard();
  for (const l of lines.slice(0, count)) b = applyOps(b, l.ops);
  return b;
}

export class TutorRunner {
  state: TutorState = "idle";
  endReason: TutorEndReason | null = null;
  private outline: LessonOutline | null = null;
  private readonly sections = new Map<number, Promise<SectionScript>>();
  /** Bumped on pause / stop: a running lesson loop from an older generation quits. */
  private gen = 0;
  /** What is being said: part, the line it started from, and the latest line heard. */
  private current: { responseId: string; part: Part; lines: TutorLine[]; from: number; heard: number } | null = null;
  private resumeAt: { part: Part; line: number } | null = null;
  /** Waiting for the widget to finish playing a response: true = played, false = interrupted. */
  private readonly playback = new Map<string, (played: boolean) => void>();
  private ticker: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private startedAt = 0;
  private remaining = 0;
  private sessionId: Promise<string | null> = Promise.resolve(null);
  private readonly tickMs: number;

  constructor(private readonly o: TutorRunnerOptions) {
    this.tickMs = o.tickMs ?? 15_000;
    this.now = o.now ?? Date.now;
  }
  private readonly now: () => number;

  /** (A method, so the check is re-read after awaits.) */
  private isEnded(): boolean { return this.state === "ended"; }

  get active(): boolean { return this.state !== "idle" && this.state !== "ended"; }

  /** The position the student has reached (part -1 = the plan, sections…, recap). */
  get progress(): { part: number; line: number } {
    if (this.current) return { part: this.current.part, line: this.current.heard };
    return this.resumeAt ? { part: this.resumeAt.part, line: this.resumeAt.line } : { part: -1, line: 0 };
  }

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
    const outline = this.o.lessons.outline();
    outline.catch(() => undefined);
    // Cached plans are instant; a first-ever lesson takes a few seconds — say hello meanwhile.
    const quick = await Promise.race([outline.then(() => true, () => true), sleep(this.o.greetAfterMs ?? 400).then(() => false)]);
    let greeting: Promise<boolean> | null = null;
    if (!quick && gen === this.gen) greeting = this.say(-2, [{ say: GREETING[this.o.language](this.o.chapter), ops: [] }], 0);
    try {
      this.outline = await outline;
    } catch (error) {
      if (gen !== this.gen) return;
      this.o.host.send({ type: "tutor_error", message: error instanceof Error ? error.message : "The lesson could not be prepared." });
      await this.end("error");
      return;
    }
    if (gen !== this.gen) return;
    this.prefetch(0);
    this.o.host.send({ type: "tutor_outline", title: this.outline.title, sections: this.outline.sections.map((s) => ({ id: s.id, title: s.title })) });
    if (greeting && !(await greeting)) return;
    await this.teachFrom(-1, 0, gen);
  }

  /** The widget is playing line `index` of a response (its audio clock). */
  onHeard(responseId: string, index: number): void {
    const c = this.current;
    if (!c || c.responseId !== responseId || !Number.isInteger(index)) return;
    c.heard = Math.max(c.heard, Math.min(c.lines.length - 1, c.from + index));
  }

  onPlaybackComplete(responseId: string): void {
    this.playback.get(responseId)?.(true);
  }

  /**
   * The voice service abandoned a response (the student spoke over it, or another answer took
   * over). Its audio is usually all sent long before it is heard, so this is how an interruption
   * during playback reaches the lesson.
   */
  onResponseCancelled(responseId: string): void {
    this.playback.get(responseId)?.(false);
  }

  /** Continue a paused lesson from the line that was interrupted. */
  async resume(): Promise<void> {
    if (this.state !== "paused" || !this.resumeAt) return;
    const at = this.resumeAt;
    this.resumeAt = null;
    await this.teachFrom(at.part, at.line, this.gen, true);
  }

  /** Jump to the next section (the student asked to move on). */
  async skip(): Promise<void> {
    if (!this.active || !this.outline) return;
    const part = this.current?.part ?? this.resumeAt?.part ?? -1;
    this.interruptCurrent();
    this.resumeAt = null;
    await this.teachFrom(Math.min(part + 1, this.outline.sections.length), 0, this.gen);
  }

  async stop(reason: TutorEndReason = "stopped"): Promise<void> {
    if (this.state === "ended") return;
    this.interruptCurrent();
    await this.end(reason);
  }

  // ── lesson loop ──

  private async teachFrom(part: Part, line: number, gen: number, resumed = false): Promise<void> {
    const outline = this.outline;
    if (!outline) return;
    for (let p = part; p <= outline.sections.length; p++) {
      if (gen !== this.gen || this.isEnded()) return;
      let lines: TutorLine[];
      if (p === -1) lines = planLines(outline);
      else if (p === outline.sections.length) lines = recapLines(outline, this.o.language);
      else {
        this.prefetch(p + 1);
        if (!(await isSettled(this.section(p)))) this.o.host.send({ type: "tutor_state", state: "preparing", part: p });
        try {
          lines = withCleanPage((await this.section(p)).lines);
        } catch {
          this.sections.delete(p);
          continue; // a section that cannot be prepared is skipped, not the lesson
        }
        if (gen !== this.gen || this.isEnded()) return;
      }
      const from = p === part ? Math.min(line, lines.length - 1) : 0;
      const resumeHere = resumed && p === part;
      if (from > 0 || resumeHere) this.o.host.send({ type: "board_snapshot", board: boardAfter(lines, from) });
      // Resuming: "Okay, where were we…" first — it counts as line from-1 of this part.
      const body = lines.slice(from);
      const toSay = resumeHere ? [{ say: RESUME[this.o.language], ops: [] as BoardOp[] }, ...body] : body;
      if (!(await this.say(p, toSay, resumeHere ? from - 1 : from, lines))) return;
    }
    await this.end("completed");
  }

  /**
   * Says `lines` as one response and waits until the widget has played them. Returns false when
   * the lesson stopped or paused meanwhile (an interruption pauses at the line that was heard).
   */
  private async say(part: Part, lines: TutorLine[], from: number, fullLines?: TutorLine[]): Promise<boolean> {
    const gen = this.gen;
    if (this.state === "ended") return false;
    const spoken = lines.map((l) => ({ say: l.say, speech: tutorSpeech(l.say, this.o.language) || l.say, ops: l.ops }));
    const started = this.o.host.speak(spoken);
    if (!started) { await this.end("disconnected"); return false; }
    this.current = { responseId: started.responseId, part, lines: fullLines ?? lines, from, heard: Math.max(0, from) };
    this.state = part === -2 ? "planning" : "teaching";
    this.sendState();
    const played = new Promise<boolean>((resolve) => this.playback.set(started.responseId, resolve));
    const sent = await started.sent;
    const audioMs = sent.audioMs;
    let cancelled = sent.cancelled;
    if (!cancelled) {
      cancelled = !(await Promise.race([played, sleep(audioMs + (this.o.playbackSlackMs ?? 8000)).then(() => true)]));
    }
    this.playback.delete(started.responseId);
    const wasCurrent = this.current?.responseId === started.responseId;
    if (gen !== this.gen || this.isEnded()) return false;
    if (cancelled && wasCurrent) {
      // Interrupted (the student spoke, or another answer took over): pause at the heard line.
      this.gen++;
      const c = this.current!;
      this.current = null;
      this.resumeAt = part >= -1 ? { part, line: Math.max(0, c.heard) } : { part: -1, line: 0 };
      this.state = "paused";
      this.sendState();
      return false;
    }
    if (wasCurrent) this.current = null;
    return true;
  }

  private interruptCurrent(): void {
    this.gen++;
    const c = this.current;
    this.current = null;
    if (c) {
      // Remember where the student was (Stop records it; Next part moves on from it).
      this.resumeAt = { part: Math.max(-1, c.part), line: Math.max(0, c.heard) };
      this.playback.get(c.responseId)?.(false);
      this.o.host.cancelSpeech(c.responseId);
    }
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
      remainingSeconds: Math.max(0, Math.round(this.remaining)),
    });
  }

  private async tick(): Promise<void> {
    if (!this.active) return;
    const now = this.now();
    const seconds = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    this.remaining -= seconds;
    await this.o.store.addUsage(Math.round(seconds)).catch(() => undefined);
    if (this.remaining <= 0) await this.stop("daily_limit");
  }

  private async end(reason: TutorEndReason): Promise<void> {
    if (this.state === "ended") return;
    const progress = this.progress;
    this.gen++;
    this.state = "ended";
    this.endReason = reason;
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
    for (const resolve of Array.from(this.playback.values())) resolve(false);
    this.playback.clear();
    if (this.startedAt) {
      const left = Math.round((this.now() - this.lastTickAt) / 1000);
      if (left > 0) await this.o.store.addUsage(left).catch(() => undefined);
    }
    this.o.host.send({ type: "tutor_ended", reason, part: progress.part, line: progress.line });
    await this.o.store.sessionEnded(await this.sessionId, {
      reason,
      secondsActive: this.startedAt ? Math.round((this.now() - this.startedAt) / 1000) : 0,
      progress: { part: progress.part, line: progress.line, sections: this.outline?.sections.length ?? 0 },
    }).catch(() => undefined);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); });
async function isSettled(p: Promise<unknown>): Promise<boolean> {
  return Promise.race([p.then(() => true, () => true), new Promise<boolean>((r) => setImmediate(() => r(false)))]);
}
