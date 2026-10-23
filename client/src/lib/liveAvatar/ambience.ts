/**
 * The quiet room sound under a video call (Video call settings › Background sound).
 *
 * Web Audio, not an <audio> element: iOS ignores an element's volume, and the sound has to be
 * well under the avatar's voice. The context is created inside the visitor's tap (prepare), the
 * sound starts when the video shows (start) and fades out when the call ends (stop).
 */
export class AvatarAmbience {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private level = 0;
  private muted = false;

  /** Call from the tap handler (autoplay rules). */
  prepare(): void {
    if (this.ctx) return;
    try {
      const Ctx: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      void this.ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
    }
  }

  async start(url: string, level: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.source) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      if (this.ctx !== ctx) return; // stopped meanwhile
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      // Start somewhere in the loop so calls don't all begin the same way.
      source.start(0, Math.random() * Math.max(0, buffer.duration - 1));
      this.gain = gain;
      this.source = source;
      this.level = level;
      this.ramp(this.muted ? 0 : level, 1.5);
    } catch {
      // No sound is fine: the call carries on.
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.ramp(muted ? 0 : this.level, 0.2);
  }

  stop(): void {
    const ctx = this.ctx;
    const source = this.source;
    this.ramp(0, 0.6);
    this.ctx = null;
    this.source = null;
    this.gain = null;
    setTimeout(() => {
      try { source?.stop(); } catch { /* already stopped */ }
      void ctx?.close().catch(() => undefined);
    }, 700);
  }

  private ramp(to: number, seconds: number): void {
    const ctx = this.ctx;
    const gain = this.gain;
    if (!ctx || !gain) return;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(to, now + seconds);
  }
}
