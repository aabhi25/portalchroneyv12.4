/**
 * PCM16 helpers for the server-driven avatar route.
 *
 * Our TTS pipeline emits PCM16 / 24 kHz / mono in arbitrary chunk sizes (each
 * even-length). HeyGen LiveAvatar LITE wants the same format, base64-encoded,
 * in chunks of "about one second" (docs) — its own web SDK actually sends 20 ms
 * frames — with each WebSocket frame ≤ 1 MB. We re-chunk to a configurable size
 * (default 250 ms) so the first audio is not held back a whole second.
 */

export const PCM24K_BYTES_PER_SECOND = 24_000 * 2;
/** Hard ceiling per frame: 1 MB of JSON → keep raw audio well below (base64 = 4/3x). */
export const MAX_CHUNK_BYTES = 512 * 1024;

export function bytesForMs(ms: number, bytesPerSecond = PCM24K_BYTES_PER_SECOND): number {
  const raw = Math.max(2, Math.round((bytesPerSecond * ms) / 1000));
  return raw - (raw % 2);
}

export function pcmDurationMs(bytes: number, bytesPerSecond = PCM24K_BYTES_PER_SECOND): number {
  return (bytes / bytesPerSecond) * 1000;
}

/**
 * Accumulates PCM and releases fixed-size, sample-aligned chunks.
 * `push` returns every full chunk now available; `flush` returns the rest.
 */
export class Pcm16Chunker {
  private parts: Buffer[] = [];
  private size = 0;
  private readonly chunkBytes: number;

  constructor(chunkBytes: number) {
    const clamped = Math.min(MAX_CHUNK_BYTES, Math.max(2, Math.floor(chunkBytes)));
    this.chunkBytes = clamped - (clamped % 2);
  }

  get buffered(): number {
    return this.size;
  }

  push(pcm: Buffer): Buffer[] {
    if (pcm.length > 0) {
      this.parts.push(pcm);
      this.size += pcm.length;
    }
    const out: Buffer[] = [];
    if (this.size < this.chunkBytes) return out;
    let all = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts, this.size);
    while (all.length >= this.chunkBytes) {
      out.push(Buffer.from(all.subarray(0, this.chunkBytes)));
      all = all.subarray(this.chunkBytes);
    }
    this.parts = all.length ? [Buffer.from(all)] : [];
    this.size = all.length;
    return out;
  }

  /** Everything left, sample-aligned (a trailing odd byte is dropped). */
  flush(): Buffer | null {
    if (this.size === 0) return null;
    const all = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts, this.size);
    this.parts = [];
    this.size = 0;
    const even = all.length - (all.length % 2);
    return even > 0 ? Buffer.from(all.subarray(0, even)) : null;
  }

  clear(): void {
    this.parts = [];
    this.size = 0;
  }
}
