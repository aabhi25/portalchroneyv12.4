/**
 * Streaming PCM16 resampler (mono), used to feed our 24 kHz TTS audio to
 * providers that want 16 kHz (Anam audio passthrough).
 *
 * A light 3-tap low-pass ([1, 2, 1] / 4, causal) runs before linear
 * interpolation to cut the worst aliasing above the new Nyquist (8 kHz). State
 * (filter history, fractional read position, a stranded odd byte) carries
 * across chunks, so feeding audio in pieces gives exactly the same samples as
 * feeding it in one go — no clicks at chunk boundaries.
 */
export class Pcm16Resampler {
  private readonly step: number;
  /** Fractional position of the next output sample, relative to the start of the next input chunk. */
  private pos = 0;
  /** Last filtered sample of the previous chunk (for interpolation across the boundary). */
  private prevFiltered = 0;
  private hasPrev = false;
  /** Raw history for the causal low-pass. */
  private x1 = 0;
  private x2 = 0;
  private leftoverByte: number | null = null;

  constructor(readonly fromRate = 24000, readonly toRate = 16000) {
    if (!(fromRate > 0 && toRate > 0)) throw new Error("sample rates must be positive");
    this.step = fromRate / toRate;
  }

  reset(): void {
    this.pos = 0;
    this.prevFiltered = 0;
    this.hasPrev = false;
    this.x1 = 0;
    this.x2 = 0;
    this.leftoverByte = null;
  }

  process(input: Int16Array): Int16Array {
    if (input.length === 0) return new Int16Array(0);
    if (this.fromRate === this.toRate) return Int16Array.from(input);
    const n = input.length;
    // Low-pass only when downsampling.
    const filtered = new Float64Array(n);
    const lowPass = this.toRate < this.fromRate;
    for (let i = 0; i < n; i++) {
      const x = input[i];
      filtered[i] = lowPass ? (x + 2 * this.x1 + this.x2) / 4 : x;
      this.x2 = this.x1;
      this.x1 = x;
    }
    // Virtual sequence: [prevFiltered (index -1)] + filtered[0..n-1].
    const out: number[] = [];
    let pos = this.pos;
    // Positions are relative to filtered[0]; -1 refers to the carried sample.
    if (!this.hasPrev && pos < 0) pos = 0;
    while (pos <= n - 1) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = i < 0 ? this.prevFiltered : filtered[i];
      const b = i + 1 < 0 ? this.prevFiltered : i + 1 <= n - 1 ? filtered[i + 1] : filtered[n - 1];
      let v = a + (b - a) * frac;
      v = Math.round(v);
      out.push(v > 32767 ? 32767 : v < -32768 ? -32768 : v);
      pos += this.step;
    }
    // Next chunk starts at index n of this one → shift by n. pos ∈ (n-1, n-1+step].
    this.pos = pos - n;
    this.prevFiltered = filtered[n - 1];
    this.hasPrev = true;
    return Int16Array.from(out);
  }

  /** Little-endian PCM16 bytes in → bytes out (an odd trailing byte is carried over). */
  processBytes(bytes: Uint8Array): Uint8Array {
    let data = bytes;
    if (this.leftoverByte !== null) {
      const merged = new Uint8Array(bytes.length + 1);
      merged[0] = this.leftoverByte;
      merged.set(bytes, 1);
      data = merged;
      this.leftoverByte = null;
    }
    if (data.length % 2 === 1) {
      this.leftoverByte = data[data.length - 1];
      data = data.subarray(0, data.length - 1);
    }
    if (data.length === 0) return new Uint8Array(0);
    const samples = new Int16Array(data.length / 2);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true);
    const outSamples = this.process(samples);
    const out = new Uint8Array(outSamples.length * 2);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < outSamples.length; i++) outView.setInt16(i * 2, outSamples[i], true);
    return out;
  }
}

/** Base64 of raw bytes without needing Node's Buffer (browser-safe). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return typeof btoa === "function" ? btoa(binary) : (globalThis as any).Buffer.from(binary, "binary").toString("base64");
}
