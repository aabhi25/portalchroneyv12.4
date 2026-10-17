/**
 * AI Calling — a quiet call-centre sound under the call (AI Calling settings: "Background sound").
 *
 * Synthesised here, not a recording: distant murmur of a few agents (voiced buzz through moving
 * vowel formants, syllable and phrase rhythm, far away), someone typing now and then, a desk phone
 * ringing across the room twice per loop, and room tone. No audio file to ship or license, and
 * the same seed always gives the same sound. One loop per sample rate is built on first use and
 * cached (~1 MB at 8 kHz … 3 MB at 24 kHz); each call starts it at a random point.
 *
 * Level: about −42 dBFS RMS — roughly 20 dB under the AI's voice, so it is heard in the pauses but
 * never competes with the words. The desk phone peaks around −50 dBFS: barely there (at −30 dBFS
 * it was the loudest thing on a live call, 2026-10-17, and pulled attention from the conversation).
 */

export const AMBIENCE_LOOP_SECONDS = 40;
const CROSSFADE_SECONDS = 1.5;
const TARGET_RMS = 0.0079; // ≈ −42 dBFS
const RING_PEAK = 0.0032; // ≈ −50 dBFS — "hardly heard"
const KEYS_PEAK = 0.009; // ≈ −41 dBFS

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad (bandpass / lowpass / highpass), coefficients can be changed while running. */
class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private readonly rate: number, kind: "bp" | "lp" | "hp", freq: number, q = 0.707) { this.set(kind, freq, q); }
  set(kind: "bp" | "lp" | "hp", freq: number, q = 0.707): void {
    const f = Math.min(freq, this.rate * 0.45);
    const w = (2 * Math.PI * f) / this.rate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    let b0: number, b1: number, b2: number;
    if (kind === "bp") { b0 = alpha; b1 = 0; b2 = -alpha; }
    else if (kind === "lp") { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
    else { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0; this.a2 = (1 - alpha) / a0;
  }
  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** A small room: a few feedback combs (makes sounds "across the room", not in the headset). */
function roomReverb(input: Float32Array, rate: number, wet = 0.55): Float32Array {
  const out = new Float32Array(input.length);
  const combs = [0.029, 0.037, 0.043, 0.051].map((s) => ({ d: Math.round(s * rate), buf: new Float32Array(Math.round(s * rate)), i: 0 }));
  for (let n = 0; n < input.length; n++) {
    let acc = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.buf[c.i] = input[n] + y * 0.6;
      c.i = (c.i + 1) % c.d;
      acc += y;
    }
    out[n] = input[n] * (1 - wet) + (acc / combs.length) * wet;
  }
  return out;
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

function peak(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

// Vowel formants (F1, F2) a voice moves between — enough to sound like speech, never words.
const VOWELS: Array<[number, number]> = [[730, 1090], [570, 840], [300, 870], [270, 2290], [530, 1840], [660, 1720], [440, 1020], [390, 1990]];

/** One agent talking on a headset somewhere in the room. */
function murmurVoice(rate: number, samples: number, rand: () => number, female: boolean): Float32Array {
  const out = new Float32Array(samples);
  const f1 = new Biquad(rate, "bp", 500, 5);
  const f2 = new Biquad(rate, "bp", 1500, 7);
  const base = female ? 190 + rand() * 50 : 105 + rand() * 30;
  let phase = 0;
  let talking = rand() < 0.5;
  let phraseLeft = Math.round((talking ? 1.5 + rand() * 3 : 0.4 + rand() * 1.6) * rate);
  let syl = 0;
  let sylLen = Math.round((0.14 + rand() * 0.14) * rate);
  let [tF1, tF2] = VOWELS[Math.floor(rand() * VOWELS.length)];
  let cF1 = tF1, cF2 = tF2;
  const block = Math.max(1, Math.round(rate / 100));
  const into = rand() * Math.PI * 2;
  for (let n = 0; n < samples; n++) {
    if (--phraseLeft <= 0) {
      talking = !talking;
      phraseLeft = Math.round((talking ? 1.2 + rand() * 3.5 : 0.3 + rand() * 1.8) * rate);
    }
    if (++syl >= sylLen) {
      syl = 0;
      sylLen = Math.round((0.12 + rand() * 0.16) * rate);
      [tF1, tF2] = VOWELS[Math.floor(rand() * VOWELS.length)];
    }
    if (n % block === 0) {
      cF1 += (tF1 - cF1) * 0.25; cF2 += (tF2 - cF2) * 0.25;
      f1.set("bp", cF1, 5); f2.set("bp", cF2, 7);
    }
    const t = n / rate;
    const f0 = base * (1 + 0.12 * Math.sin(2 * Math.PI * 0.35 * t + into) + 0.03 * (rand() - 0.5));
    phase += f0 / rate;
    if (phase >= 1) phase -= 1;
    const buzz = 2 * phase - 1 + (rand() - 0.5) * 0.25;
    const env = talking ? Math.pow(Math.sin((Math.PI * syl) / sylLen), 1.5) : 0;
    out[n] = (f1.process(buzz) + 0.6 * f2.process(buzz)) * env;
  }
  return out;
}

/** Someone typing now and then: bursts of short clicks. */
function typing(rate: number, samples: number, rand: () => number): Float32Array {
  const out = new Float32Array(samples);
  const hp = new Biquad(rate, "hp", Math.min(1800, rate * 0.3));
  let n = Math.round((1 + rand() * 4) * rate);
  while (n < samples) {
    const burstEnd = n + Math.round((0.8 + rand() * 2.2) * rate);
    while (n < burstEnd && n < samples) {
      const len = Math.round(0.005 * rate);
      const amp = 0.5 + rand() * 0.5;
      for (let i = 0; i < len && n + i < samples; i++) out[n + i] += (rand() * 2 - 1) * amp * Math.exp(-i / (0.0015 * rate));
      n += Math.round((0.09 + rand() * 0.12) * rate);
    }
    n += Math.round((3 + rand() * 7) * rate);
  }
  for (let i = 0; i < samples; i++) out[i] = hp.process(out[i]);
  return out;
}

/** An electronic desk phone ringing across the room: warbling tone, two bursts per ring. */
function deskPhone(rate: number, samples: number, startsAt: number[], rings: number): Float32Array {
  const out = new Float32Array(samples);
  const burst = 0.8, gap = 0.2, between = 2.2;
  for (const start of startsAt) {
    for (let r = 0; r < rings; r++) {
      for (const b of [0, burst + gap]) {
        const s0 = Math.round((start + r * (2 * burst + gap + between) + b) * rate);
        const len = Math.round(burst * rate);
        let ph = 0;
        for (let i = 0; i < len && s0 + i < samples; i++) {
          const t = i / rate;
          const f = Math.sin(2 * Math.PI * 16 * t) > 0 ? 1180 : 950;
          ph += f / rate;
          const env = Math.min(1, i / (0.01 * rate), (len - i) / (0.01 * rate));
          out[s0 + i] += (Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph)) * env;
        }
      }
    }
  }
  return out;
}

/** Room tone: soft low rumble of air conditioning / the floor. */
function roomTone(rate: number, samples: number, rand: () => number): Float32Array {
  const out = new Float32Array(samples);
  const lp = new Biquad(rate, "lp", 350);
  const hp = new Biquad(rate, "hp", 90);
  for (let i = 0; i < samples; i++) out[i] = hp.process(lp.process(rand() * 2 - 1));
  return out;
}

function addScaled(into: Float32Array, src: Float32Array, scale: number): void {
  for (let i = 0; i < into.length; i++) into[i] += src[i] * scale;
}

/** Build the seamless loop at `rate` (PCM16 samples). */
export function buildCallCentreLoop(rate: number, seed = 20261017): Int16Array {
  const rand = rng(seed);
  const loop = Math.round(AMBIENCE_LOOP_SECONDS * rate);
  const fade = Math.round(CROSSFADE_SECONDS * rate);
  const total = loop + fade;

  // Murmur: five agents at different distances, then far-away and roomy.
  const murmur = new Float32Array(total);
  for (let v = 0; v < 5; v++) addScaled(murmur, murmurVoice(rate, total, rand, v % 2 === 0), 0.35 + rand() * 0.65);
  const farLp = new Biquad(rate, "lp", 1700);
  for (let i = 0; i < total; i++) murmur[i] = farLp.process(murmur[i]);
  const murmurRoom = roomReverb(murmur, rate);

  const keys = roomReverb(typing(rate, total, rand), rate, 0.35);
  const phoneLp = new Biquad(rate, "lp", 2400);
  const phonesDry = deskPhone(rate, total, [11.3, 29.6], 2);
  for (let i = 0; i < total; i++) phonesDry[i] = phoneLp.process(phonesDry[i]);
  const phones = roomReverb(phonesDry, rate, 0.6);
  const tone = roomTone(rate, total, rand);

  const mix = new Float32Array(total);
  addScaled(mix, murmurRoom, (TARGET_RMS * 0.85) / Math.max(1e-9, rms(murmurRoom)));
  addScaled(mix, tone, (TARGET_RMS * 0.35) / Math.max(1e-9, rms(tone)));
  addScaled(mix, keys, KEYS_PEAK / Math.max(1e-9, peak(keys)));
  addScaled(mix, phones, RING_PEAK / Math.max(1e-9, peak(phones)));

  // Seamless loop: the extra tail fades into the head.
  const out = new Int16Array(loop);
  for (let i = 0; i < loop; i++) {
    let v = mix[i];
    if (i < fade) {
      const a = i / fade;
      v = mix[i] * a + mix[loop + i] * (1 - a);
    }
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return out;
}

const LOOPS = new Map<number, Int16Array>();
function loopFor(rate: number): Int16Array {
  let loop = LOOPS.get(rate);
  if (!loop) {
    loop = buildCallCentreLoop(rate);
    LOOPS.set(rate, loop);
  }
  return loop;
}

/** Plays the loop for one call: ambience-only chunks for the gaps, and mixed under the AI's audio. */
export class CallAmbience {
  private readonly loop: Int16Array;
  private pos: number;

  constructor(readonly rate: number, random: () => number = Math.random) {
    this.loop = loopFor(rate);
    this.pos = Math.floor(random() * this.loop.length);
  }

  /** The next `bytes` of ambience alone (PCM16LE). */
  next(bytes: number): Buffer {
    const n = Math.floor(bytes / 2);
    const out = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      out.writeInt16LE(this.loop[this.pos], i * 2);
      if (++this.pos >= this.loop.length) this.pos = 0;
    }
    return out;
  }

  /** The AI's audio with the ambience under it (a new buffer; the input is not changed). */
  mix(pcm: Buffer): Buffer {
    const n = Math.floor(pcm.length / 2);
    const out = Buffer.alloc(pcm.length);
    for (let i = 0; i < n; i++) {
      const v = pcm.readInt16LE(i * 2) + this.loop[this.pos];
      out.writeInt16LE(v > 32767 ? 32767 : v < -32768 ? -32768 : v, i * 2);
      if (++this.pos >= this.loop.length) this.pos = 0;
    }
    return out;
  }
}
