/**
 * PCM16 little-endian → Float32 decoding for audio fed to an avatar adapter.
 *
 * WebSocket frames can split a 16-bit sample across two chunks. Decoding each
 * chunk on its own would shift every later sample by one byte (byte-swapped
 * samples = loud static), so a stranded odd byte is carried into the next chunk.
 */
export class Pcm16Decoder {
  private carry: number | null = null;

  reset(): void {
    this.carry = null;
  }

  push(bytes: Uint8Array): Float32Array {
    let data = bytes;
    if (this.carry !== null) {
      const merged = new Uint8Array(bytes.length + 1);
      merged[0] = this.carry;
      merged.set(bytes, 1);
      data = merged;
      this.carry = null;
    }
    if (data.length % 2 === 1) {
      this.carry = data[data.length - 1];
      data = data.subarray(0, data.length - 1);
    }
    const n = data.length / 2;
    const out = new Float32Array(n);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
    return out;
  }
}
