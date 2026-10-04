/**
 * AI Calling — call audio helpers (pure, no I/O).
 *
 * The phone side (Exotel AgentStream, or the portal simulator speaking the same protocol)
 * carries raw PCM 16-bit signed little-endian mono at the stream's sample rate (8 kHz by
 * default; we ask for 16 kHz). The voice pipeline (RealtimeVoiceService) works at 24 kHz.
 *
 *  - StreamResampler: streaming linear resampler with a light anti-alias filter when
 *    down-sampling (keeps state between chunks, so chunk boundaries don't click).
 *  - OutgoingAudioQueue: buffers answer audio for the phone and hands out chunks that obey
 *    Exotel's rules (multiple of 320 bytes, 3,200 – 100,000 bytes), pads the last chunk of
 *    an utterance with silence, and keeps marks in order with the audio around them.
 */

export const VOICE_SAMPLE_RATE = 24000;
/** Exotel: every outgoing media payload must be a multiple of this many bytes. */
export const CHUNK_ALIGN_BYTES = 320;
export const MIN_CHUNK_BYTES = 3200;
export const MAX_CHUNK_BYTES = 100_000;

/** Bytes of PCM16 mono audio per millisecond at `rate`. */
export function bytesPerMs(rate: number): number {
  return (rate * 2) / 1000;
}

/** Duration (ms) of `bytes` of PCM16 mono at `rate`. */
export function pcmDurationMs(bytes: number, rate: number): number {
  return bytes / bytesPerMs(rate);
}

/** Parse the stream sample rate Exotel reports ("8000" | "16000" | "24000"); anything else → fallback. */
export function parseSampleRate(value: unknown, fallback = 8000): number {
  const n = Number(value);
  return n === 8000 || n === 16000 || n === 24000 ? n : fallback;
}

/** Streaming PCM16 resampler (mono). */
export class StreamResampler {
  private readonly step: number;
  private readonly taps: number;
  private pos = 0;
  private last: number | null = null;
  private history: number[] = [];
  private leftover: Buffer | null = null;

  constructor(readonly inRate: number, readonly outRate: number) {
    this.step = inRate / outRate;
    // Down-sampling: a short moving average removes most of what would alias.
    this.taps = outRate < inRate ? Math.max(1, Math.round(inRate / outRate)) : 1;
  }

  /** Resample a little-endian PCM16 buffer (odd trailing byte is carried to the next call). */
  processBuffer(buf: Buffer): Buffer {
    let data = buf;
    if (this.leftover) {
      data = Buffer.concat([this.leftover, buf]);
      this.leftover = null;
    }
    if (data.length % 2 === 1) {
      this.leftover = data.subarray(data.length - 1);
      data = data.subarray(0, data.length - 1);
    }
    const samples = new Int16Array(data.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
    const outSamples = this.process(samples);
    const out = Buffer.alloc(outSamples.length * 2);
    for (let i = 0; i < outSamples.length; i++) out.writeInt16LE(outSamples[i], i * 2);
    return out;
  }

  process(input: Int16Array): Int16Array {
    if (this.inRate === this.outRate) return Int16Array.from(input);
    let src: ArrayLike<number> = input;
    if (this.taps > 1) {
      const filtered = new Float32Array(input.length);
      for (let i = 0; i < input.length; i++) {
        this.history.push(input[i]);
        if (this.history.length > this.taps) this.history.shift();
        let sum = 0;
        for (const v of this.history) sum += v;
        filtered[i] = sum / this.history.length;
      }
      src = filtered;
    }
    // Virtual input: [last sample of the previous chunk, ...this chunk].
    const hasLast = this.last !== null;
    const len = src.length + (hasLast ? 1 : 0);
    if (len < 2) {
      if (src.length === 1) this.last = src[0];
      return new Int16Array(0);
    }
    const at = (i: number) => (hasLast ? (i === 0 ? (this.last as number) : src[i - 1]) : src[i]);
    const out: number[] = [];
    let p = this.pos;
    while (p <= len - 1 - 1e-9) {
      const i = Math.floor(p);
      const f = p - i;
      const a = at(i);
      const b = i + 1 < len ? at(i + 1) : a;
      if (i + 1 >= len && f > 1e-9) break;
      const v = a + (b - a) * f;
      out.push(v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v));
      p += this.step;
    }
    this.pos = p - (len - 1);
    this.last = at(len - 1);
    return Int16Array.from(out);
  }
}

/** One-shot resample of a whole PCM16 buffer (tests / small clips). */
export function resamplePcm16(buf: Buffer, inRate: number, outRate: number): Buffer {
  return new StreamResampler(inRate, outRate).processBuffer(buf);
}

export type OutgoingItem = { kind: 'audio'; data: Buffer } | { kind: 'mark'; name: string };

/**
 * Answer audio waiting to be sent to the phone, in Exotel-sized chunks.
 *
 * Audio accumulates; `take()` returns the next item that may be sent:
 *  - a full chunk of `chunkBytes` (multiple of 320, ≥ 3,200) when enough audio is buffered,
 *  - before a mark (end of an utterance): the remaining audio padded with silence to a
 *    multiple of 320 bytes and at least 3,200 bytes, then the mark itself,
 *  - otherwise null (wait for more audio).
 */
export class OutgoingAudioQueue {
  private items: OutgoingItem[] = [];
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  readonly chunkBytes: number;

  constructor(chunkBytes = MIN_CHUNK_BYTES) {
    const aligned = Math.round(chunkBytes / CHUNK_ALIGN_BYTES) * CHUNK_ALIGN_BYTES;
    this.chunkBytes = Math.min(MAX_CHUNK_BYTES, Math.max(MIN_CHUNK_BYTES, aligned));
  }

  /** Append answer audio (PCM16 at the stream rate). */
  pushAudio(pcm: Buffer): void {
    if (!pcm.length) return;
    this.pending.push(pcm);
    this.pendingBytes += pcm.length;
    while (this.pendingBytes >= this.chunkBytes) {
      this.items.push({ kind: 'audio', data: this.takePending(this.chunkBytes) });
    }
  }

  /** End of an utterance: flush (padded) audio, then the mark. */
  pushMark(name: string): void {
    this.flushPadded();
    this.items.push({ kind: 'mark', name });
  }

  /** Pad and flush whatever audio is pending (no mark). */
  flushPadded(): void {
    if (this.pendingBytes === 0) return;
    const rest = this.takePending(this.pendingBytes);
    this.items.push({ kind: 'audio', data: padChunk(rest) });
  }

  take(): OutgoingItem | null {
    return this.items.shift() ?? null;
  }

  peek(): OutgoingItem | null {
    return this.items[0] ?? null;
  }

  /** Barge-in: drop everything not sent yet. Returns the marks that were dropped. */
  clear(): string[] {
    const marks = this.items.filter((i): i is { kind: 'mark'; name: string } => i.kind === 'mark').map((i) => i.name);
    this.items = [];
    this.pending = [];
    this.pendingBytes = 0;
    return marks;
  }

  get isEmpty(): boolean {
    return this.items.length === 0 && this.pendingBytes === 0;
  }

  /** Bytes of audio waiting (ready chunks + not-yet-full remainder). */
  get bufferedBytes(): number {
    let n = this.pendingBytes;
    for (const i of this.items) if (i.kind === 'audio') n += i.data.length;
    return n;
  }

  private takePending(n: number): Buffer {
    const all = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending);
    const head = all.subarray(0, n);
    const tail = all.subarray(n);
    this.pending = tail.length ? [tail] : [];
    this.pendingBytes = tail.length;
    return Buffer.from(head);
  }
}

/** Pad PCM with silence to a multiple of 320 bytes and at least 3,200 bytes. */
export function padChunk(pcm: Buffer): Buffer {
  let size = Math.ceil(pcm.length / CHUNK_ALIGN_BYTES) * CHUNK_ALIGN_BYTES;
  if (size < MIN_CHUNK_BYTES) size = MIN_CHUNK_BYTES;
  if (size === pcm.length) return pcm;
  const out = Buffer.alloc(size); // zero = silence
  pcm.copy(out);
  return out;
}

/** True when a payload obeys Exotel's outgoing chunk rules. */
export function isValidOutgoingChunk(bytes: number): boolean {
  return bytes % CHUNK_ALIGN_BYTES === 0 && bytes >= MIN_CHUNK_BYTES && bytes <= MAX_CHUNK_BYTES;
}
