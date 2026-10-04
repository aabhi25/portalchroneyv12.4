/**
 * AI Calling — the portal's "test mode" phone.
 *
 * In test mode there is no phone network: the browser plays the part Exotel plays on a real
 * call. It opens the same media WebSocket protocol the server speaks with Exotel
 * (`connected` → `start` → `media`… → `stop`), sends the microphone as 16 kHz 16-bit PCM in
 * 100 ms frames, plays the AI's audio back without gaps, flushes on `clear` (the caller talked
 * over the AI) and echoes each `mark` only once the audio queued before it has finished
 * playing — exactly how Exotel tells the server "that sentence has been heard".
 *
 * The top half of this file is pure (no DOM / WebAudio access) so it can be unit-tested with
 * tsx: server/services/__tests__/callSimulatorClient.test.ts. Browser APIs are only touched
 * inside `CallSimulator` methods at runtime.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/** The sample rate we ask the server for (and send). */
export const SIM_SAMPLE_RATE = 16000;
/** 100 ms of 16 kHz mono PCM16 = 1600 samples × 2 bytes. Exotel: 3,200–100,000 bytes, multiple of 320. */
export const SIM_FRAME_BYTES = 3200;
export const SIM_FRAME_MS = 100;

/**
 * Streaming resampler (mono float). Downsampling averages every source sample that falls in
 * the output sample's window (a cheap low-pass, good enough for speech); upsampling uses linear
 * interpolation. Keeps its position across chunks so a stream of small chunks produces the
 * same output as one big one.
 */
export class Resampler {
  readonly ratio: number;
  private carry: Float32Array = new Float32Array(0);
  /** Fractional source position (within carry + next input) of the next output sample. */
  private pos = 0;

  constructor(readonly inRate: number, readonly outRate: number) {
    if (!(inRate > 0) || !(outRate > 0)) throw new Error("Sample rates must be positive");
    this.ratio = inRate / outRate;
  }

  reset(): void {
    this.carry = new Float32Array(0);
    this.pos = 0;
  }

  process(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice(0);
    const buf = new Float32Array(this.carry.length + input.length);
    buf.set(this.carry, 0);
    buf.set(input, this.carry.length);
    const out: number[] = [];
    const r = this.ratio;
    let t = this.pos;

    if (r > 1) {
      while (t + r <= buf.length + 1e-9) {
        const s = Math.floor(t);
        let e = Math.floor(t + r);
        if (e > buf.length) e = buf.length;
        if (e <= s) {
          out.push(buf[s] ?? 0);
        } else {
          let sum = 0;
          for (let i = s; i < e; i++) sum += buf[i];
          out.push(sum / (e - s));
        }
        t += r;
      }
    } else {
      while (t + 1 < buf.length) {
        const i = Math.floor(t);
        const frac = t - i;
        out.push(buf[i] * (1 - frac) + buf[i + 1] * frac);
        t += r;
      }
    }

    const keepFrom = Math.min(Math.floor(t), buf.length);
    this.carry = buf.slice(keepFrom);
    this.pos = t - keepFrom;
    return Float32Array.from(out);
  }
}

/** One-shot downsample of a whole buffer to 16 kHz. */
export function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  return new Resampler(inputRate, SIM_SAMPLE_RATE).process(input);
}

/** Float [-1, 1] → signed 16-bit little-endian bytes. */
export function floatToPcm16Bytes(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    if (!(s === s)) s = 0; // NaN
    s = Math.max(-1, Math.min(1, s));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return bytes;
}

/** Signed 16-bit little-endian bytes → float [-1, 1]. A trailing odd byte is ignored. */
export function pcm16BytesToFloat(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.length / 2);
  const out = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) {
    const v = view.getInt16(i * 2, true);
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

/** Collects PCM bytes and hands out exact 3,200-byte (100 ms) frames. */
export class Pcm16Framer {
  private buf = new Uint8Array(SIM_FRAME_BYTES * 4);
  private len = 0;

  constructor(readonly frameBytes = SIM_FRAME_BYTES) {}

  get pending(): number {
    return this.len;
  }

  push(bytes: Uint8Array): Uint8Array[] {
    if (this.len + bytes.length > this.buf.length) {
      const bigger = new Uint8Array(Math.max(this.buf.length * 2, this.len + bytes.length));
      bigger.set(this.buf.subarray(0, this.len));
      this.buf = bigger;
    }
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
    const frames: Uint8Array[] = [];
    let off = 0;
    while (this.len - off >= this.frameBytes) {
      frames.push(this.buf.slice(off, off + this.frameBytes));
      off += this.frameBytes;
    }
    if (off > 0) {
      this.buf.copyWithin(0, off, this.len);
      this.len -= off;
    }
    return frames;
  }

  /** Remaining bytes padded with silence to one full frame (or null if nothing is pending). */
  flush(): Uint8Array | null {
    if (this.len === 0) return null;
    const frame = new Uint8Array(this.frameBytes);
    frame.set(this.buf.subarray(0, this.len));
    this.len = 0;
    return frame;
  }

  reset(): void {
    this.len = 0;
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < B64.length; i++) m[B64[i]] = i;
  m["-"] = 62; // tolerate base64url
  m["_"] = 63;
  return m;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\s=]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_LOOKUP[clean[i]];
    if (v === undefined) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.slice(0, o);
}

/**
 * Playback timing, kept separate from WebAudio so it can be tested.
 *
 * Audio chunks are scheduled back to back (gapless). A mark is due once everything queued
 * before it has played: its time is the end of the queue when it arrived (or "now" if the
 * queue was already empty). `clear` drops the queue and returns the marks still waiting, which
 * the caller echoes straight away — the audio they were waiting for will never play.
 */
export class PlaybackQueue {
  private endTime = 0;
  private marks: { name: string; at: number }[] = [];

  /** @param leadSec small head start for the first chunk after silence, so it is not clipped. */
  constructor(readonly leadSec = 0.04) {}

  /** Returns the start time for a chunk of `durationSec`. */
  scheduleAudio(durationSec: number, now: number): number {
    const start = this.endTime > now ? this.endTime : now + this.leadSec;
    this.endTime = start + Math.max(0, durationSec);
    return start;
  }

  addMark(name: string, now: number): void {
    this.marks.push({ name, at: Math.max(this.endTime, now) });
  }

  /** Marks whose audio has finished by `now`, in arrival order (removed from the queue). */
  takeDueMarks(now: number): string[] {
    const due: string[] = [];
    while (this.marks.length && this.marks[0].at <= now + 1e-6) due.push(this.marks.shift()!.name);
    return due;
  }

  /** Seconds until the next mark is due (null when none waiting). */
  nextMarkIn(now: number): number | null {
    return this.marks.length ? Math.max(0, this.marks[0].at - now) : null;
  }

  clear(now: number): string[] {
    this.endTime = Math.min(this.endTime, now);
    const pending = this.marks.map(m => m.name);
    this.marks = [];
    return pending;
  }

  isPlaying(now: number): boolean {
    return this.endTime > now;
  }

  get queuedUntil(): number {
    return this.endTime;
  }
}

/** Root-mean-square level of a block (0…1). */
export function rmsLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

function randomHex(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export interface SimCallIds {
  streamSid: string;
  callSid: string;
  accountSid: string;
}

export function makeSimCallIds(): SimCallIds {
  return { streamSid: `MZ${randomHex(30)}`, callSid: `CA${randomHex(30)}`, accountSid: "SIMULATOR" };
}

/** Builds the JSON events the browser sends — the Exotel side of the protocol. */
export class SimEventBuilder {
  private seq = 0;
  private chunk = 0;

  constructor(readonly ids: SimCallIds) {}

  private next(): string {
    this.seq += 1;
    return String(this.seq);
  }

  connected() {
    return { event: "connected" };
  }

  start(opts: { from: string; to: string; customParameters?: Record<string, string> }) {
    const { streamSid, callSid, accountSid } = this.ids;
    return {
      event: "start",
      sequence_number: this.next(),
      stream_sid: streamSid,
      start: {
        stream_sid: streamSid,
        call_sid: callSid,
        account_sid: accountSid,
        from: opts.from,
        to: opts.to,
        custom_parameters: opts.customParameters ?? {},
        media_format: { encoding: "audio/x-raw", sample_rate: String(SIM_SAMPLE_RATE), bit_rate: "16" },
      },
    };
  }

  media(frame: Uint8Array) {
    this.chunk += 1;
    return {
      event: "media",
      sequence_number: this.next(),
      stream_sid: this.ids.streamSid,
      media: { chunk: String(this.chunk), timestamp: String((this.chunk - 1) * SIM_FRAME_MS), payload: bytesToBase64(frame) },
    };
  }

  mark(name: string) {
    return { event: "mark", sequence_number: this.next(), stream_sid: this.ids.streamSid, mark: { name } };
  }

  stop(reason: "callended" | "stopped" = "callended") {
    return {
      event: "stop",
      sequence_number: this.next(),
      stream_sid: this.ids.streamSid,
      stop: { call_sid: this.ids.callSid, account_sid: this.ids.accountSid, reason },
    };
  }
}

export type SimServerEvent =
  | { type: "media"; bytes: Uint8Array }
  | { type: "mark"; name: string }
  | { type: "clear" }
  | { type: "other"; event: string };

/** Parses one message from the server. Returns null for anything that is not a JSON event. */
export function parseServerEvent(raw: unknown): SimServerEvent | null {
  if (typeof raw !== "string") return null;
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg.event !== "string") return null;
  if (msg.event === "media") {
    const payload = msg.media?.payload;
    if (typeof payload !== "string") return null;
    return { type: "media", bytes: base64ToBytes(payload) };
  }
  if (msg.event === "mark") {
    const name = msg.mark?.name;
    return typeof name === "string" ? { type: "mark", name } : null;
  }
  if (msg.event === "clear") return { type: "clear" };
  return { type: "other", event: msg.event };
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser session (WebAudio + WebSocket). Nothing below runs at import time.
// ─────────────────────────────────────────────────────────────────────────────

export type SimPhase = "connecting" | "live" | "ended" | "error";

export interface SimActivity {
  aiSpeaking: boolean;
  userSpeaking: boolean;
  muted: boolean;
}

export interface CallSimulatorOptions {
  /** Path on this site, e.g. `/api/calling/simulate/<callId>` or `/api/calling/simulate-inbound`. */
  path: string;
  from: string;
  to: string;
  onPhase?: (phase: SimPhase, detail?: string) => void;
  onActivity?: (a: SimActivity) => void;
}

const CAPTURE_WORKLET = `
class ChroneyCallCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('chroney-call-capture', ChroneyCallCapture);
`;

const USER_SPEAKING_RMS = 0.02;

export class CallSimulator {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private captureNode: AudioNode | null = null;
  private sinkGain: GainNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private outGain: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private builder = new SimEventBuilder(makeSimCallIds());
  private framer = new Pcm16Framer();
  private micResampler: Resampler | null = null;
  private playResampler: Resampler | null = null;
  private queue = new PlaybackQueue();
  private markTimer: ReturnType<typeof setTimeout> | null = null;
  private activityTimer: ReturnType<typeof setInterval> | null = null;
  private lastUserLevelAt = 0;
  private muted = false;
  private phase: SimPhase = "connecting";
  private started = false;
  private lastActivity = "";

  constructor(private readonly opts: CallSimulatorOptions) {}

  get callIds(): SimCallIds {
    return this.builder.ids;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.setPhase("connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the microphone here (it needs a secure https page).");
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (err: any) {
      const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
      this.fail(denied ? "Microphone access was blocked. Allow the microphone for this site and try again." : (err?.message || "Couldn't open the microphone."));
      return;
    }
    if (this.isClosed()) { this.cleanup(); return; }

    const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctx();
    try { await this.ctx.resume(); } catch { /* resumed on first gesture */ }
    this.micResampler = new Resampler(this.ctx.sampleRate, SIM_SAMPLE_RATE);
    this.playResampler = new Resampler(SIM_SAMPLE_RATE, this.ctx.sampleRate);
    this.outGain = this.ctx.createGain();
    this.outGain.connect(this.ctx.destination);

    await this.startCapture();
    if (this.isClosed()) { this.cleanup(); return; }
    this.openSocket();
    this.activityTimer = setInterval(() => this.emitActivity(), 120);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.emitActivity(true);
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Caller hangs up: tell the server like Exotel would, then close. */
  hangUp(): void {
    if (this.phase === "ended" || this.phase === "error") return;
    this.sendJson(this.builder.stop("callended"));
    this.end();
  }

  private isClosed(): boolean {
    return this.phase === "ended" || this.phase === "error";
  }

  private setPhase(phase: SimPhase, detail?: string) {
    this.phase = phase;
    this.opts.onPhase?.(phase, detail);
  }

  private fail(message: string) {
    if (this.phase === "ended" || this.phase === "error") return;
    this.setPhase("error", message);
    this.cleanup();
  }

  private end() {
    if (this.phase === "ended" || this.phase === "error") return;
    this.setPhase("ended");
    this.cleanup();
  }

  private async startCapture(): Promise<void> {
    const ctx = this.ctx!;
    this.sourceNode = ctx.createMediaStreamSource(this.stream!);
    // Processing nodes are only pulled when they lead to the output; a muted gain keeps the
    // mic out of the speakers.
    this.sinkGain = ctx.createGain();
    this.sinkGain.gain.value = 0;
    this.sinkGain.connect(ctx.destination);

    let node: AudioNode | null = null;
    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      let url: string | null = null;
      try {
        url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(url);
        const w = new AudioWorkletNode(ctx, "chroney-call-capture");
        w.port.onmessage = e => this.onMicBlock(e.data as Float32Array);
        node = w;
      } catch {
        node = null;
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    }
    if (!node) {
      const sp = ctx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = e => this.onMicBlock(new Float32Array(e.inputBuffer.getChannelData(0)));
      node = sp;
    }
    this.sourceNode.connect(node);
    node.connect(this.sinkGain);
    this.captureNode = node;
  }

  private onMicBlock(block: Float32Array) {
    if (!this.micResampler) return;
    if (!this.muted && rmsLevel(block) > USER_SPEAKING_RMS) this.lastUserLevelAt = Date.now();
    const pcm = this.micResampler.process(this.muted ? new Float32Array(block.length) : block);
    const frames = this.framer.push(floatToPcm16Bytes(pcm));
    if (this.phase !== "live") return; // keep timing, but nothing is sent before `start`
    for (const f of frames) this.sendJson(this.builder.media(f));
  }

  private openSocket() {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const sep = this.opts.path.includes("?") ? "&" : "?";
    const url = `${proto}//${window.location.host}${this.opts.path}${sep}sample-rate=${SIM_SAMPLE_RATE}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.fail("Couldn't start the test call.");
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.sendJson(this.builder.connected());
      this.sendJson(this.builder.start({ from: this.opts.from, to: this.opts.to }));
      this.framer.reset();
      this.setPhase("live");
    };
    ws.onmessage = e => this.onServerMessage(e.data);
    ws.onerror = () => {
      if (!opened) this.fail("Couldn't connect the test call. The calling service may not be ready yet — try again in a moment.");
    };
    ws.onclose = ev => {
      if (!opened) this.fail(ev.reason || "Couldn't connect the test call. The calling service may not be ready yet — try again in a moment.");
      else this.end();
    };
  }

  private onServerMessage(data: unknown) {
    const ev = parseServerEvent(data);
    if (!ev || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (ev.type === "media") {
      this.playChunk(ev.bytes);
    } else if (ev.type === "mark") {
      this.queue.addMark(ev.name, now);
      this.flushMarks();
    } else if (ev.type === "clear") {
      this.sources.forEach(s => {
        try { s.stop(); } catch { /* already stopped */ }
      });
      this.sources.clear();
      this.playResampler?.reset();
      for (const name of this.queue.clear(now)) this.sendJson(this.builder.mark(name));
      this.flushMarks();
    }
  }

  private playChunk(bytes: Uint8Array) {
    const ctx = this.ctx!;
    const samples = this.playResampler!.process(pcm16BytesToFloat(bytes));
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.outGain!);
    const at = this.queue.scheduleAudio(buffer.duration, ctx.currentTime);
    src.onended = () => this.sources.delete(src);
    this.sources.add(src);
    src.start(at);
    this.flushMarks();
  }

  /** Echo every mark whose audio has played; re-arm a timer for the next one. */
  private flushMarks() {
    if (!this.ctx) return;
    if (this.markTimer) { clearTimeout(this.markTimer); this.markTimer = null; }
    const now = this.ctx.currentTime;
    for (const name of this.queue.takeDueMarks(now)) this.sendJson(this.builder.mark(name));
    const wait = this.queue.nextMarkIn(now);
    if (wait !== null) this.markTimer = setTimeout(() => this.flushMarks(), Math.max(10, wait * 1000 + 5));
  }

  private emitActivity(force = false) {
    if (!this.ctx) return;
    const a: SimActivity = {
      aiSpeaking: this.queue.isPlaying(this.ctx.currentTime),
      userSpeaking: !this.muted && Date.now() - this.lastUserLevelAt < 350,
      muted: this.muted,
    };
    const key = `${a.aiSpeaking}|${a.userSpeaking}|${a.muted}`;
    if (!force && key === this.lastActivity) return;
    this.lastActivity = key;
    this.opts.onActivity?.(a);
  }

  private sendJson(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(obj)); } catch { /* socket closing */ }
    }
  }

  private cleanup() {
    if (this.markTimer) clearTimeout(this.markTimer);
    if (this.activityTimer) clearInterval(this.activityTimer);
    this.markTimer = null;
    this.activityTimer = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(1000, "callended"); } catch { /* ignore */ }
    }
    this.sources.forEach(s => {
      try { s.stop(); } catch { /* ignore */ }
    });
    this.sources.clear();
    try { this.sourceNode?.disconnect(); } catch { /* ignore */ }
    try { this.captureNode?.disconnect(); } catch { /* ignore */ }
    if (this.captureNode && "port" in this.captureNode) (this.captureNode as AudioWorkletNode).port.onmessage = null;
    if (this.captureNode && "onaudioprocess" in this.captureNode) (this.captureNode as ScriptProcessorNode).onaudioprocess = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      ctx.close().catch(() => {});
    }
  }
}
