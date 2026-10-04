/**
 * AI Calling — media stream: one phone call's audio WebSocket, Exotel AgentStream protocol.
 *
 * Exotel (and the portal simulator, which speaks the same protocol) sends JSON events:
 *   connected → start (stream_sid, call_sid, from, to, media_format.sample_rate) →
 *   media (base64 PCM16LE at the stream rate) … dtmf / mark (our mark was played) → stop.
 * We send: media (base64 PCM16LE; 3,200–100,000 bytes, multiple of 320), mark (echoed back
 * when the audio before it has played) and clear (flush what is queued = barge-in).
 *
 * The call's voice is RealtimeVoiceService, reached through the phone bridge (phoneBridge.ts):
 * caller audio is resampled to 24 kHz and forwarded; answer audio (24 kHz) is resampled to the
 * stream rate, cut into Exotel-sized chunks and sent close to real time (≤ LEAD_MS ahead) so
 * a 'clear' on barge-in silences the AI almost at once.
 *
 * This module also runs the call itself: the opening line (outbound: after the callee's
 * "hello" or a short wait; inbound: at once), answering-machine detection, the silence and
 * max-length guards, the phone-only tools (end_call, do_not_call, transfer_to_human,
 * save_call_details) and the end of the call (call row update + processFinishedCall once).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { aiCallingSettings, aiCalls, businessAccounts, leads, type AiCall, type AiCallingSettingsRow } from "@shared/schema";
import { normalizeCallPhone, TERMINAL_CALL_STATUSES, type CallOutcome, type CallStatus } from "@shared/aiCalling";
import { OutgoingAudioQueue, StreamResampler, VOICE_SAMPLE_RATE, bytesPerMs, parseSampleRate, pcmDurationMs, MIN_CHUNK_BYTES, CHUNK_ALIGN_BYTES } from "./audio";
import {
  AI_END_OUTCOMES,
  PHONE_LINES,
  buildOpeningLine,
  buildPhoneInstructions,
  looksLikeVoicemail,
  parseCallbackTime,
  phoneTools,
  simulatorTransferLine,
  type FixedLine,
} from "./phonePrompt";
import type { PhoneEngine, PhoneEngineEvents, PhoneEngineFactory } from "./phoneBridge";

const LOG = "[Calling]";

/** How far ahead of real time answer audio is sent (keeps 'clear' effective). */
export const LEAD_MS = 300;
const PUMP_MS = 20;
const GUARD_MS = 250;
/** Outbound: wait this long for the callee's "hello" before speaking anyway. */
export const HELLO_WAIT_MS = 2000;
/** Outbound: uninterrupted speech this long at the start = an answering-machine greeting. */
export const LONG_GREETING_MS = 7000;
/** Outbound: answering-machine phrases are checked on this many caller transcripts. */
const SCREEN_TRANSCRIPTS = 3;
export const SILENCE_NUDGE_MS = 8000;
export const SILENCE_END_MS = 20000;
const WRAP_UP_WARN_MS = 30000;
/** After the AI decided to end: hang up at the latest this long after (goodbye never echoed). */
const END_DEADLINE_MS = 15000;
/** Caller audio kept while the voice session starts (24 kHz PCM16 → 3 s). */
const PRE_READY_MAX_BYTES = VOICE_SAMPLE_RATE * 2 * 3;

export type CallStreamKind = "exotel_outbound" | "exotel_inbound" | "simulator_outbound" | "simulator_inbound";

/** Minimal WebSocket surface (ws.WebSocket in production, a fake in tests). */
export interface StreamSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: any, isBinary: boolean) => void): unknown;
  on(event: "close", listener: (code: number, reason: Buffer) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
  setInterval: (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; },
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
};

/** Ends a provider call that closing the stream would not end (e.g. Exotel call flows). Wired by the calling engine. */
export type CallHangupHandler = (call: AiCall) => Promise<void>;
let hangupHandler: CallHangupHandler | null = null;
export function registerCallHangupHandler(fn: CallHangupHandler | null): void {
  hangupHandler = fn;
}

export interface CallStreamDeps {
  createEngine: PhoneEngineFactory;
  onCallFinished: (callId: string) => Promise<void>;
  clock: Clock;
}

let defaultDeps: CallStreamDeps | null = null;
export async function loadCallStreamDeps(): Promise<CallStreamDeps> {
  if (defaultDeps) return defaultDeps;
  const { createVoiceServiceEngine } = await import("./phoneBridge");
  const { processFinishedCall } = await import("./callLifecycle");
  defaultDeps = {
    createEngine: createVoiceServiceEngine(async () => (await import("../../realtimeVoiceService")).realtimeVoiceService),
    onCallFinished: processFinishedCall,
    clock: realClock,
  };
  return defaultDeps;
}

/** Test seam: the dependencies used by sessions the routes start (null = production defaults). */
export function setCallStreamDepsForTesting(deps: CallStreamDeps | null): void {
  defaultDeps = deps;
}

export interface CallStreamInit {
  kind: CallStreamKind;
  businessAccountId: string;
  /** Outbound / simulator outbound: the call row (validated at upgrade). */
  callId?: string;
  /** ?sample-rate= on the stream URL (used when the start event doesn't say). */
  urlSampleRate?: number;
  /** Simulator inbound: the caller's number. */
  simulatorFrom?: string;
  /** Simulator: the staff user (stored as requestedBy on an inbound test row). */
  userId?: string;
}

type EndReason =
  | "customer_hung_up" | "stream_stopped" | "ai_ended" | "do_not_call" | "transferred" | "max_duration"
  | "silence" | "voicemail" | "ai_unavailable" | "stream_error";

interface PendingEnd {
  reason: EndReason;
  /** Hang up after this response has played (null: after the next answer that completes). */
  afterResponseId: string | null;
  transfer?: boolean;
  /** Simulator transfer: the "you would now be connected" line has been queued. */
  transferAnnounced?: boolean;
  deadline: unknown;
}

/** One live call stream. */
export class CallMediaSession {
  private readonly deps: CallStreamDeps;
  private readonly clock: Clock;
  private chain: Promise<void> = Promise.resolve();
  private finalized = false;
  private finishedNotified = false;

  // stream
  private streamSid: string | null = null;
  private streamRate = 8000;
  private inResampler: StreamResampler | null = null;
  private outResampler: StreamResampler | null = null;
  private outQueue: OutgoingAudioQueue | null = null;
  private playedUntil = 0;
  private ducked = false;
  private pumpTimer: unknown = null;
  private guardTimer: unknown = null;
  private markSeq = 0;
  private readonly markToResponse = new Map<string, string>();

  // call
  private call: AiCall | null = null;
  private settings: AiCallingSettingsRow | null = null;
  private answeredAt = 0;
  private started = false;
  private engine: PhoneEngine | null = null;
  private engineReady = false;
  private conversationId: string | null = null;
  private preReady: Buffer[] = [];
  private preReadyBytes = 0;

  // conversation flow
  private phase: "starting" | "awaiting_hello" | "talking" = "starting";
  private helloTimer: unknown = null;
  private openingSaid = false;
  private screenedTranscripts = 0;
  private userSpeakingSince: number | null = null;
  private lastUserActivity = 0;
  private aiSpeechEndsAt = 0;
  private aiBusy = false;
  private currentResponseId: string | null = null;
  private quietLineIds = new Set<string>();
  private nudged = false;
  private wrapWarned = false;
  private voicemail = false;
  private pendingEnd: PendingEnd | null = null;

  // tool results
  private outcome: CallOutcome | null = null;
  private outcomeNote: string | null = null;
  private callbackAt: Date | null = null;
  private capturedFields: Record<string, string> = {};
  private transferred = false;

  constructor(private readonly ws: StreamSocket, private readonly init: CallStreamInit, deps: CallStreamDeps) {
    this.deps = deps;
    this.clock = deps.clock;
    ws.on("message", (data: any, isBinary: boolean) => {
      if (isBinary) return; // AgentStream is JSON only
      let msg: any;
      try { msg = JSON.parse(String(data)); } catch { return; }
      this.chain = this.chain.then(() => this.handleEvent(msg)).catch((err) => {
        console.error(`${LOG} stream event failed (call ${this.callLabel()}):`, err instanceof Error ? err.message : err);
      });
    });
    ws.on("close", () => {
      this.chain = this.chain.then(() => this.finalize(this.started ? "customer_hung_up" : "stream_stopped"));
    });
    ws.on("error", () => {
      this.chain = this.chain.then(() => this.finalize("stream_error"));
    });
  }

  /** Resolves when every queued event has been handled (tests). */
  idle(): Promise<void> {
    return this.chain;
  }

  get callId(): string | null {
    return this.call?.id ?? this.init.callId ?? null;
  }

  private callLabel(): string {
    return this.callId ?? this.init.kind;
  }

  private get isOutbound(): boolean {
    return this.init.kind === "exotel_outbound" || this.init.kind === "simulator_outbound";
  }

  private get isSimulator(): boolean {
    return this.init.kind === "simulator_outbound" || this.init.kind === "simulator_inbound";
  }

  // ── protocol ────────────────────────────────────────────────────────────────

  private async handleEvent(msg: any): Promise<void> {
    if (this.finalized) return;
    switch (msg?.event) {
      case "connected":
        return;
      case "start":
        return this.handleStart(msg);
      case "media":
        return this.handleMedia(msg);
      case "mark":
        return this.handleMarkEcho(String(msg?.mark?.name || ""));
      case "dtmf":
        // Keypad presses are not used by the AI; noted only.
        console.log(`${LOG} dtmf on call ${this.callLabel()}`);
        return;
      case "stop": {
        const reason = String(msg?.stop?.reason || "");
        return this.finalize(reason === "stopped" ? "stream_stopped" : "customer_hung_up");
      }
      default:
        return;
    }
  }

  private async handleStart(msg: any): Promise<void> {
    if (this.started) return;
    const start = msg?.start || {};
    this.streamSid = String(msg?.stream_sid || start.stream_sid || "") || null;
    this.streamRate = parseSampleRate(start?.media_format?.sample_rate, this.init.urlSampleRate ?? 8000);
    this.inResampler = new StreamResampler(this.streamRate, VOICE_SAMPLE_RATE);
    this.outResampler = new StreamResampler(VOICE_SAMPLE_RATE, this.streamRate);
    // ~100 ms per chunk (never below Exotel's 3,200-byte minimum).
    const chunk = Math.max(MIN_CHUNK_BYTES, Math.round((bytesPerMs(this.streamRate) * 100) / CHUNK_ALIGN_BYTES) * CHUNK_ALIGN_BYTES);
    this.outQueue = new OutgoingAudioQueue(chunk);
    this.started = true;
    const now = this.clock.now();
    this.answeredAt = now;
    this.lastUserActivity = now;

    const providerCallSid = typeof start.call_sid === "string" && start.call_sid ? start.call_sid : null;
    try {
      if (this.init.kind === "exotel_inbound" || this.init.kind === "simulator_inbound") {
        const rawFrom = this.init.kind === "simulator_inbound" ? (this.init.simulatorFrom || start.from) : start.from;
        const phone = normalizeCallPhone(rawFrom) ?? (this.init.kind === "simulator_inbound" ? "+910000000000" : (String(rawFrom || "").slice(0, 20) || "unknown"));
        const leadId = await findLeadIdByPhone(this.init.businessAccountId, phone).catch(() => null);
        const [row] = await db.insert(aiCalls).values({
          businessAccountId: this.init.businessAccountId,
          direction: "inbound",
          status: "in_progress",
          trigger: "inbound",
          provider: this.isSimulator ? "simulator" : "exotel",
          phone,
          callerId: typeof start.to === "string" && start.to ? start.to.slice(0, 20) : null,
          leadId,
          providerCallSid,
          providerStreamSid: this.streamSid,
          startedAt: new Date(now),
          answeredAt: new Date(now),
          requestedBy: this.isSimulator ? this.init.userId ?? null : null,
        }).returning();
        this.call = row;
      } else {
        const [row] = await db.select().from(aiCalls).where(eq(aiCalls.id, this.init.callId!)).limit(1);
        if (!row || TERMINAL_CALL_STATUSES.includes(row.status as CallStatus)) {
          console.warn(`${LOG} stream start for a missing / finished call ${this.init.callId} — closing`);
          this.started = false;
          return this.closeSocket(1008, "call_not_live");
        }
        const [updated] = await db.update(aiCalls).set({
          status: "in_progress",
          answeredAt: row.answeredAt ?? new Date(now),
          providerStreamSid: this.streamSid,
          providerCallSid: row.providerCallSid ?? providerCallSid,
          updatedAt: new Date(),
        }).where(eq(aiCalls.id, row.id)).returning();
        this.call = updated ?? row;
        if (row.answeredAt) this.answeredAt = Math.min(now, row.answeredAt.getTime());
      }
    } catch (err) {
      console.error(`${LOG} could not record call start (${this.callLabel()}):`, err instanceof Error ? err.message : err);
      this.started = false;
      return this.closeSocket(1011, "call_error");
    }
    console.log(`${LOG} call ${this.call!.id} answered (${this.init.kind}, ${this.streamRate} Hz)`);
    this.guardTimer = this.clock.setInterval(() => this.guardTick(), GUARD_MS);
    await this.startEngine();
  }

  private handleMedia(msg: any): void {
    if (!this.started || !this.inResampler) return;
    const payload = msg?.media?.payload;
    if (typeof payload !== "string" || !payload) return;
    const pcm = this.inResampler.processBuffer(Buffer.from(payload, "base64"));
    if (!pcm.length) return;
    if (this.engine && this.engineReady) {
      this.engine.sendCallerAudio(pcm);
      return;
    }
    this.preReady.push(pcm);
    this.preReadyBytes += pcm.length;
    while (this.preReadyBytes > PRE_READY_MAX_BYTES && this.preReady.length > 1) {
      this.preReadyBytes -= this.preReady.shift()!.length;
    }
  }

  private handleMarkEcho(name: string): void {
    const responseId = this.markToResponse.get(name);
    if (!responseId) return;
    this.markToResponse.delete(name);
    this.engine?.playbackComplete(responseId);
    if (this.pendingEnd && this.pendingEnd.afterResponseId === responseId) {
      void this.completePendingEnd();
    }
  }

  // ── voice session ──────────────────────────────────────────────────────────

  private async startEngine(): Promise<void> {
    const call = this.call!;
    const [settingsRow] = await db.select().from(aiCallingSettings).where(eq(aiCallingSettings.businessAccountId, call.businessAccountId)).limit(1);
    this.settings = settingsRow ?? null;
    const [biz] = await db.select({ name: businessAccounts.name }).from(businessAccounts).where(eq(businessAccounts.id, call.businessAccountId)).limit(1);
    const lead = call.leadId
      ? (await db.select().from(leads).where(and(eq(leads.id, call.leadId), eq(leads.businessAccountId, call.businessAccountId))).limit(1))[0] ?? null
      : null;
    const meta = (call.metadata ?? {}) as Record<string, unknown>;
    const businessName = biz?.name || "our team";
    const customerName = lead?.name || (typeof meta.name === "string" ? meta.name : null);
    const transferAvailable = this.transferAvailable();
    // Lead calls already have the lead: the website lead questionnaire is skipped and
    // details go to the call (save_call_details). Inbound / no lead: the lead form runs.
    const leadCaptureOn = !(this.isOutbound && call.leadId);
    const maxCallMinutes = this.maxCallMinutes();
    const instructions = buildPhoneInstructions({
      direction: call.direction === "inbound" ? "inbound" : "outbound",
      businessName,
      customerName,
      customerPhone: call.phone,
      leadMessage: lead?.message ?? null,
      leadTopics: Array.isArray(lead?.topicsOfInterest) ? lead!.topicsOfInterest : null,
      leadEmail: lead?.email ?? null,
      callPurpose: this.settings?.callPurpose ?? null,
      staffNote: typeof meta.note === "string" ? meta.note : null,
      transferAvailable,
      maxCallMinutes,
      timezone: this.settings?.callingHours?.timezone || "Asia/Kolkata",
      leadCaptureOn,
    });
    const opening = buildOpeningLine({
      direction: call.direction === "inbound" ? "inbound" : "outbound",
      openingLine: this.settings?.openingLine,
      inboundGreeting: this.settings?.inboundGreeting,
      customerName,
      businessName,
    });
    this.openingText = opening.text;

    const events: PhoneEngineEvents = {
      onReady: (conversationId) => this.onEngineReady(conversationId),
      onAnswerStart: (responseId) => {
        this.currentResponseId = responseId;
        this.aiBusy = true;
      },
      onAudio: (pcm24k) => this.onAnswerAudio(pcm24k),
      onAiDone: (responseId) => this.onAiDone(responseId),
      onCancelled: (responseId) => this.onCancelled(responseId),
      onDuck: () => { this.ducked = true; },
      onUnduck: () => { this.ducked = false; this.ensurePump(); },
      onThinking: () => { this.aiBusy = true; this.markUserActive(); },
      onUserTranscript: () => this.markUserActive(),
      onError: (message) => console.warn(`${LOG} voice error on call ${call.id}: ${message.slice(0, 120)}`),
      onClosed: (reason) => {
        this.chain = this.chain.then(() => this.finalize(this.pendingEnd?.reason ?? (reason === "call_ended" ? "ai_ended" : "ai_unavailable")));
      },
    };
    try {
      this.engine = await this.deps.createEngine({
        callId: call.id,
        businessAccountId: call.businessAccountId,
        conversationTitle: call.direction === "inbound" ? "Phone call (inbound)" : "Phone call (outbound)",
        chat: {
          instructions,
          tools: phoneTools({ transferAvailable, leadCaptureOn }),
          executeTool: (name, args) => this.executeTool(name, args),
          knownContact: { name: customerName, phone: call.phone, email: lead?.email ?? null },
        },
        skipLeadTraining: !leadCaptureOn,
        screenTranscript: (text) => this.screenTranscript(text),
        onSpeech: (event) => this.onSpeech(event),
      }, events);
    } catch (err) {
      console.error(`${LOG} voice session failed to start for call ${call.id}:`, err instanceof Error ? err.message : err);
      return this.finalize("ai_unavailable");
    }
  }

  private openingText = "";

  private onEngineReady(conversationId: string): void {
    if (this.finalized) return;
    this.engineReady = true;
    this.conversationId = conversationId;
    if (this.call) {
      void db.update(aiCalls).set({ conversationId, updatedAt: new Date() }).where(eq(aiCalls.id, this.call.id)).catch(() => undefined);
    }
    for (const pcm of this.preReady) this.engine?.sendCallerAudio(pcm);
    this.preReady = [];
    this.preReadyBytes = 0;
    if (this.isOutbound) {
      // Let the callee say "hello" first (and give an answering machine a chance to show itself).
      this.phase = "awaiting_hello";
      this.helloTimer = this.clock.setTimeout(() => {
        this.helloTimer = null;
        if (this.phase === "awaiting_hello" && this.userSpeakingSince === null) void this.sayOpening();
      }, HELLO_WAIT_MS);
    } else {
      void this.sayOpening();
    }
  }

  private async sayOpening(): Promise<void> {
    if (this.openingSaid || this.finalized || !this.engine) return;
    this.openingSaid = true;
    this.phase = "talking";
    if (this.helloTimer) { this.clock.clearTimeout(this.helloTimer); this.helloTimer = null; }
    const custom = this.call?.direction === "inbound" ? !!this.settings?.inboundGreeting?.trim() : !!this.settings?.openingLine?.trim();
    // The business's own line is spoken as written; the default is localized like other fixed lines.
    const line: string | FixedLine = custom ? this.openingText : { en: this.openingText };
    const id = await this.engine.say(line, { persist: true });
    if (!id) console.warn(`${LOG} opening line could not be spoken on call ${this.callLabel()}`);
  }

  private onAnswerAudio(pcm24k: Buffer): void {
    if (this.finalized || !this.outResampler || !this.outQueue) return;
    const pcm = this.outResampler.processBuffer(pcm24k);
    this.outQueue.pushAudio(pcm);
    this.ensurePump();
  }

  private onAiDone(responseId: string): void {
    if (this.finalized || !this.outQueue) return;
    if (responseId === this.currentResponseId) this.aiBusy = false;
    const name = `r${++this.markSeq}`;
    this.markToResponse.set(name, responseId);
    this.outQueue.pushMark(name);
    const now = this.clock.now();
    const queuedMs = pcmDurationMs(this.outQueue.bufferedBytes, this.streamRate);
    if (!this.quietLineIds.has(responseId)) {
      this.aiSpeechEndsAt = Math.max(now, this.playedUntil) + queuedMs;
    }
    if (this.pendingEnd && this.pendingEnd.afterResponseId === null) this.pendingEnd.afterResponseId = responseId;
    this.ensurePump();
  }

  private onCancelled(responseId: string): void {
    if (this.finalized || !this.outQueue) return;
    if (responseId === this.currentResponseId) this.aiBusy = false;
    for (const mark of this.outQueue.clear()) this.markToResponse.delete(mark);
    // Marks already sent for this answer will still echo; their audio is gone.
    if (this.streamSid && this.ws.readyState === 1) this.ws.send(JSON.stringify({ event: "clear", stream_sid: this.streamSid }));
    this.playedUntil = this.clock.now();
    this.aiSpeechEndsAt = Math.min(this.aiSpeechEndsAt, this.playedUntil);
    this.ducked = false;
    if (this.pendingEnd && this.pendingEnd.afterResponseId === responseId) this.pendingEnd.afterResponseId = null;
  }

  private markUserActive(): void {
    this.lastUserActivity = this.clock.now();
    this.nudged = false;
  }

  private onSpeech(event: "started" | "stopped"): void {
    if (event === "started") {
      this.userSpeakingSince = this.clock.now();
      this.markUserActive();
    } else {
      this.userSpeakingSince = null;
      this.markUserActive();
      if (this.phase === "awaiting_hello" && !this.helloTimer) {
        // The hello wait is over and their transcript is late: don't keep them waiting.
        this.helloTimer = this.clock.setTimeout(() => {
          this.helloTimer = null;
          if (this.phase === "awaiting_hello") void this.sayOpening();
        }, 1500);
      }
    }
  }

  /** Called with every caller transcript before the AI answers it. */
  private screenTranscript(text: string): "continue" | "drop" {
    if (this.finalized) return "drop";
    this.markUserActive();
    if (this.isOutbound && this.screenedTranscripts < SCREEN_TRANSCRIPTS && text.trim()) {
      this.screenedTranscripts++;
      if (looksLikeVoicemail(text)) {
        this.hangUpOnVoicemail("phrase");
        return "drop";
      }
    }
    if (this.phase === "awaiting_hello") {
      // Their "hello?" — answer it with the opening line, not with a chat reply.
      void this.sayOpening();
      return "drop";
    }
    return "continue";
  }

  private hangUpOnVoicemail(how: "phrase" | "long_greeting"): void {
    if (this.voicemail || this.finalized) return;
    this.voicemail = true;
    console.log(`${LOG} answering machine on call ${this.callLabel()} (${how}) — hanging up`);
    this.outcome = "voicemail";
    this.chain = this.chain.then(() => this.hangUpAndFinalize("voicemail"));
  }

  // ── sending audio ──────────────────────────────────────────────────────────

  private ensurePump(): void {
    if (this.pumpTimer || this.finalized) return;
    this.pump();
    if (this.outQueue && !this.outQueue.isEmpty) {
      this.pumpTimer = this.clock.setInterval(() => {
        this.pump();
        if (!this.outQueue || this.outQueue.isEmpty || this.finalized) {
          if (this.pumpTimer) this.clock.clearInterval(this.pumpTimer);
          this.pumpTimer = null;
        }
      }, PUMP_MS);
    }
  }

  private pump(): void {
    const q = this.outQueue;
    if (!q || this.finalized || this.ducked || !this.streamSid || this.ws.readyState !== 1) return;
    const now = this.clock.now();
    if (this.playedUntil < now) this.playedUntil = now;
    while (this.playedUntil - now < LEAD_MS) {
      const item = q.take();
      if (!item) break;
      if (item.kind === "mark") {
        this.ws.send(JSON.stringify({ event: "mark", stream_sid: this.streamSid, mark: { name: item.name } }));
        continue;
      }
      this.ws.send(JSON.stringify({ event: "media", stream_sid: this.streamSid, media: { payload: item.data.toString("base64") } }));
      this.playedUntil += pcmDurationMs(item.data.length, this.streamRate);
    }
  }

  // ── guards ─────────────────────────────────────────────────────────────────

  private maxCallMinutes(): number {
    const n = Number(this.settings?.maxCallMinutes ?? 5);
    return Number.isFinite(n) && n > 0 ? Math.min(60, n) : 5;
  }

  private guardTick(): void {
    if (this.finalized || !this.started) return;
    const now = this.clock.now();
    const maxMs = this.maxCallMinutes() * 60_000;
    const elapsed = now - this.answeredAt;

    // Answering machine: a long, uninterrupted greeting before we said anything.
    if (this.isOutbound && this.phase === "awaiting_hello" && this.userSpeakingSince !== null && now - this.userSpeakingSince >= LONG_GREETING_MS) {
      this.hangUpOnVoicemail("long_greeting");
      return;
    }

    // Max length: hard stop well after the goodbye should have played.
    if (elapsed >= maxMs + END_DEADLINE_MS + 5000) {
      this.chain = this.chain.then(() => this.hangUpAndFinalize("max_duration"));
      return;
    }
    if (this.pendingEnd || this.voicemail) return;
    const quietNow = !this.aiBusy && !!this.outQueue && this.outQueue.isEmpty && this.playedUntil <= now && this.userSpeakingSince === null;
    if (elapsed >= maxMs) {
      void this.endWithLine(PHONE_LINES.timeUpGoodbye, "max_duration");
      return;
    }
    if (!this.wrapWarned && maxMs > 60_000 && elapsed >= maxMs - WRAP_UP_WARN_MS && quietNow) {
      this.wrapWarned = true;
      void this.engine?.say(PHONE_LINES.wrapUpSoon);
      return;
    }

    // Silence (only once the conversation is under way).
    if (this.phase !== "talking" || !quietNow) return;
    const quietSince = Math.max(this.lastUserActivity, this.aiSpeechEndsAt);
    const quietFor = now - quietSince;
    if (quietFor >= SILENCE_END_MS) {
      void this.endWithLine(PHONE_LINES.silenceGoodbye, "silence");
    } else if (quietFor >= SILENCE_NUDGE_MS && !this.nudged) {
      this.nudged = true;
      void this.engine?.say(PHONE_LINES.stillThere).then((id) => { if (id) this.quietLineIds.add(id); });
    }
  }

  private async endWithLine(line: FixedLine, reason: EndReason): Promise<void> {
    if (this.pendingEnd || this.finalized) return;
    this.setPendingEnd(reason);
    const id = await this.engine?.say(line);
    const pending = this.pendingEnd as PendingEnd | null;
    if (pending && id) pending.afterResponseId = id;
    if (!id) await this.completePendingEnd();
  }

  private setPendingEnd(reason: EndReason, transfer = false): void {
    if (this.pendingEnd) {
      // A stronger reason (do_not_call / transfer) replaces a plain end.
      if (reason === "do_not_call" || transfer) { this.pendingEnd.reason = reason; this.pendingEnd.transfer = transfer || this.pendingEnd.transfer; }
      return;
    }
    const deadline = this.clock.setTimeout(() => { void this.completePendingEnd(true); }, END_DEADLINE_MS);
    this.pendingEnd = { reason, afterResponseId: this.aiBusy ? this.currentResponseId : null, transfer, deadline };
  }

  private async completePendingEnd(deadlineHit = false): Promise<void> {
    const pending = this.pendingEnd;
    if (!pending || this.finalized) return;
    if (pending.transfer && this.isSimulator && !pending.transferAnnounced && !deadlineHit) {
      // Simulator: no real line to hand over — say what would happen, then end.
      pending.transferAnnounced = true;
      const number = this.settings?.transferNumber || "your team";
      const id = await this.engine?.say(simulatorTransferLine(number));
      if (id) {
        pending.afterResponseId = id;
        this.clock.clearTimeout(pending.deadline);
        pending.deadline = this.clock.setTimeout(() => { void this.completePendingEnd(true); }, END_DEADLINE_MS);
        return;
      }
    }
    this.clock.clearTimeout(pending.deadline);
    if (pending.transfer && !this.isSimulator) {
      // Exotel call flow: closing the stream hands the caller to the flow's next (Connect) applet.
      this.chain = this.chain.then(async () => {
        this.closeSocket(1000, "transfer");
        await this.finalize("transferred");
      });
      return;
    }
    this.chain = this.chain.then(() => this.hangUpAndFinalize(pending.reason));
  }

  private transferAvailable(): boolean {
    const number = this.settings?.transferNumber?.trim();
    if (!number) return false;
    if (this.isSimulator) return true;
    return !!this.settings?.exotelFlowAppId?.trim();
  }

  // ── phone tools (called by the chat brain mid-turn) ───────────────────────

  async executeTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.finalized) return { success: false, error: "The call has already ended." };
    const note = typeof args?.note === "string" ? args.note.trim().slice(0, 500) : "";
    switch (name) {
      case "end_call": {
        const raw = String(args?.outcome || "");
        const outcome = (AI_END_OUTCOMES as string[]).includes(raw) ? (raw as CallOutcome) : "other";
        if (this.outcome !== "do_not_call" && this.outcome !== "transferred") this.outcome = outcome;
        if (note) this.outcomeNote = note;
        const cb = parseCallbackTime(args?.callback_time, new Date(this.clock.now()));
        if (cb) this.callbackAt = cb;
        this.setPendingEnd("ai_ended");
        console.log(`${LOG} AI ends call ${this.callLabel()} (outcome ${this.outcome})`);
        return { success: true, message: "The call will hang up right after your reply. Now say ONE short, warm goodbye sentence (no question)." };
      }
      case "do_not_call": {
        this.outcome = "do_not_call";
        if (note) this.outcomeNote = note;
        this.setPendingEnd("do_not_call");
        console.log(`${LOG} do-not-call requested on call ${this.callLabel()}`);
        return { success: true, message: "Recorded: they will not be called again. Apologise briefly for the call and say goodbye in ONE short sentence. The call hangs up after your reply." };
      }
      case "transfer_to_human": {
        if (!this.transferAvailable()) {
          return { success: false, message: "Transfer is not available. Tell them the team will call them back, then end the call with outcome callback_requested." };
        }
        this.transferred = true;
        this.outcome = "transferred";
        const reason = typeof args?.reason === "string" ? args.reason.trim().slice(0, 300) : "";
        if (reason) this.outcomeNote = reason;
        this.setPendingEnd("transferred", true);
        console.log(`${LOG} transfer requested on call ${this.callLabel()}`);
        return { success: true, message: "Say ONE short sentence that you are connecting them to a team member now. Do not ask anything else." };
      }
      case "save_call_details": {
        const allowed = ["name", "email", "requirement", "budget", "preferred_time", "notes"];
        let saved = 0;
        for (const key of allowed) {
          const v = args?.[key];
          if (typeof v === "string" && v.trim()) {
            this.capturedFields[key] = v.trim().slice(0, 300);
            saved++;
          }
        }
        if (saved && this.call) {
          void db.update(aiCalls).set({ capturedFields: { ...this.capturedFields }, updatedAt: new Date() }).where(eq(aiCalls.id, this.call.id)).catch(() => undefined);
        }
        return saved
          ? { success: true, message: "Saved for the team. Continue the conversation naturally." }
          : { success: false, message: "Nothing to save." };
      }
      default:
        return { success: false, error: "Unknown tool" };
    }
  }

  // ── ending ─────────────────────────────────────────────────────────────────

  private async hangUpAndFinalize(reason: EndReason): Promise<void> {
    if (this.finalized) return;
    const call = this.call;
    // Exotel with a call flow: closing the stream would move the flow on (e.g. to a transfer),
    // so the provider is asked to hang up (when the calling engine registered a handler).
    if (call && call.provider === "exotel" && hangupHandler && this.settings?.exotelFlowAppId) {
      await hangupHandler(call).catch((err) => console.warn(`${LOG} hangup failed for call ${call.id}:`, err instanceof Error ? err.message : err));
    }
    this.closeSocket(1000, "call_ended");
    await this.finalize(reason);
  }

  private closeSocket(code: number, reason: string): void {
    try {
      if (this.ws.readyState === 0 || this.ws.readyState === 1) this.ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  /** End of the call for any reason: stop everything, record the result, notify once. */
  async finalize(reason: EndReason): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    for (const t of [this.pumpTimer, this.guardTimer]) if (t) this.clock.clearInterval(t);
    if (this.helloTimer) this.clock.clearTimeout(this.helloTimer);
    if (this.pendingEnd) this.clock.clearTimeout(this.pendingEnd.deadline);
    this.pumpTimer = this.guardTimer = this.helloTimer = null;
    this.outQueue?.clear();
    const engine = this.engine;
    this.engine = null;
    try { engine?.close(); } catch { /* ignore */ }

    const call = this.call;
    if (this.started && call) {
      const endedAt = new Date(this.clock.now());
      const durationSec = Math.max(0, Math.round((endedAt.getTime() - this.answeredAt) / 1000));
      const status: CallStatus = this.voicemail ? "voicemail" : "completed";
      const endReason = this.voicemail ? "voicemail" : this.pendingEnd?.reason ?? reason;
      const patch: Partial<typeof aiCalls.$inferInsert> = {
        status,
        endedAt,
        durationSec,
        endReason,
        transferred: this.transferred,
        updatedAt: new Date(),
      };
      if (this.conversationId) patch.conversationId = this.conversationId;
      if (this.outcome) patch.outcome = this.outcome;
      if (this.outcomeNote) patch.outcomeNote = this.outcomeNote;
      if (this.callbackAt) patch.callbackAt = this.callbackAt;
      if (Object.keys(this.capturedFields).length) patch.capturedFields = { ...this.capturedFields };
      try {
        // Inbound: link the lead the call's lead form created (if any).
        if (!call.leadId && this.conversationId) {
          const [lead] = await db.select({ id: leads.id }).from(leads)
            .where(and(eq(leads.businessAccountId, call.businessAccountId), eq(leads.conversationId, this.conversationId)))
            .limit(1);
          if (lead) patch.leadId = lead.id;
        }
        await db.update(aiCalls).set(patch).where(eq(aiCalls.id, call.id));
      } catch (err) {
        console.error(`${LOG} could not record the end of call ${call.id}:`, err instanceof Error ? err.message : err);
      }
      console.log(`${LOG} call ${call.id} ended: ${endReason} (${durationSec}s)`);
      if (!this.finishedNotified) {
        this.finishedNotified = true;
        try {
          await this.deps.onCallFinished(call.id);
        } catch (err) {
          console.error(`${LOG} post-call processing failed for ${call.id}:`, err instanceof Error ? err.message : err);
        }
      }
    }
    this.closeSocket(1000, "call_ended");
  }
}

/** The most recent lead of this business with the same number (last 10 digits). */
async function findLeadIdByPhone(businessAccountId: string, phone: string): Promise<string | null> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  const [row] = await db.select({ id: leads.id }).from(leads)
    .where(and(eq(leads.businessAccountId, businessAccountId), sql`right(regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]', '', 'g'), 10) = ${last10}`))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Start handling an accepted media WebSocket. */
export async function startCallMediaSession(ws: StreamSocket, init: CallStreamInit, deps?: Partial<CallStreamDeps>): Promise<CallMediaSession> {
  const base = await loadCallStreamDeps();
  return new CallMediaSession(ws, init, { ...base, ...(deps ?? {}) });
}
