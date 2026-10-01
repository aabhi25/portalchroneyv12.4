/**
 * Shared client-side turn-taking helpers for the two voice UIs
 * (InlineVoiceMode — the panel inside the chat widget — and VoiceMode — the
 * full-screen orb).
 *
 * The server decides whether speech is a real interruption (≥500 ms of speech
 * AND a substantive transcript). The client's own detector is only fast
 * feedback: when the student clearly talks over the tutor, the tutor's volume
 * is lowered ("ducked") locally until the server confirms (response_cancelled)
 * or rejects (unduck) the interruption. It never cancels an answer by itself.
 */

export type VoiceInputModeSetting = 'hands_free' | 'hold_to_talk' | 'student_choice';
export type EffectiveVoiceInputMode = 'hands_free' | 'hold_to_talk';

/** "Thinking…" may never last longer than this without any answer activity. */
export const THINKING_WATCHDOG_MS = 25_000;
/** Playback volume while a possible interruption is being confirmed. */
export const DUCK_GAIN = 0.25;
/** Local duck is released this long after the student stops talking, unless the server ducked. */
export const LOCAL_DUCK_RELEASE_MS = 2_000;
export const DIDNT_CATCH_THAT = "Sorry, I didn't catch that — please try again.";

const STORAGE_KEY = 'chroney_voice_input_mode';

export function readStoredInputMode(): EffectiveVoiceInputMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'hold_to_talk' || value === 'hands_free' ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredInputMode(mode: EffectiveVoiceInputMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private mode / blocked storage: the choice just isn't remembered.
  }
}

/** The mode a session starts in for a widget setting (+ the student's saved choice). */
export function resolveInputMode(
  setting: string | null | undefined,
  stored: EffectiveVoiceInputMode | null = null,
): EffectiveVoiceInputMode {
  if (setting === 'hold_to_talk') return 'hold_to_talk';
  if (setting === 'student_choice') return stored ?? 'hands_free';
  return 'hands_free';
}

export interface SpeechDetectorOptions {
  /** RMS below this is never speech, however quiet the room. */
  absoluteMin?: number;
  /** Speech must be this many times louder than the rolling noise floor. */
  floorMultiplier?: number;
  /** Sustained speech needed before it counts. */
  confirmMs?: number;
  /** Short dips allowed inside one utterance. */
  hangoverMs?: number;
  initialFloor?: number;
  /** How much the tutor's own playback level raises the bar (echo). */
  echoFactor?: number;
  /** Per-frame adaptation rate of the noise floor during non-speech. */
  floorAdaptRate?: number;
}

export interface SpeechDetectorResult {
  speaking: boolean;
  confirmed: boolean;
  justConfirmed: boolean;
  /** An utterance (that had reached any speech) just ended. */
  ended: boolean;
  threshold: number;
}

/**
 * Energy detector with an adaptive noise floor: tracks the room's background
 * level while nobody speaks and requires RMS > max(absoluteMin, floor × k)
 * (+ an echo allowance while the tutor plays) for `confirmMs` of sustained
 * speech. A fan or TV that stays "loud" for many seconds is absorbed into the
 * floor instead of being treated as endless speech.
 */
export class AdaptiveSpeechDetector {
  private readonly o: Required<SpeechDetectorOptions>;
  noiseFloor: number;
  speechMs = 0;
  private silenceMs = 0;
  private confirmed = false;

  constructor(options: SpeechDetectorOptions = {}) {
    this.o = {
      absoluteMin: options.absoluteMin ?? 0.015,
      floorMultiplier: options.floorMultiplier ?? 3,
      confirmMs: options.confirmMs ?? 500,
      hangoverMs: options.hangoverMs ?? 200,
      initialFloor: options.initialFloor ?? 0.006,
      echoFactor: options.echoFactor ?? 0.08,
      floorAdaptRate: options.floorAdaptRate ?? 0.05,
    };
    this.noiseFloor = this.o.initialFloor;
  }

  reset(): void {
    this.speechMs = 0;
    this.silenceMs = 0;
    this.confirmed = false;
  }

  push(rms: number, frameMs: number, playbackLevel = 0): SpeechDetectorResult {
    const threshold = Math.max(this.o.absoluteMin, this.noiseFloor * this.o.floorMultiplier) +
      Math.max(0, playbackLevel) * this.o.echoFactor;
    let ended = false;
    if (rms > threshold) {
      this.speechMs += frameMs;
      this.silenceMs = 0;
      // Stationary noise that never stops (fan, TV): slowly absorb it.
      if (this.speechMs > 6000) this.noiseFloor += (rms - this.noiseFloor) * 0.02;
    } else {
      this.silenceMs += frameMs;
      if (this.silenceMs > this.o.hangoverMs && this.speechMs > 0) {
        ended = true;
        this.speechMs = 0;
        this.confirmed = false;
      }
      this.noiseFloor += (rms - this.noiseFloor) * this.o.floorAdaptRate;
    }
    this.noiseFloor = Math.min(0.08, Math.max(0.002, this.noiseFloor));
    const justConfirmed = !this.confirmed && this.speechMs >= this.o.confirmMs;
    if (justConfirmed) this.confirmed = true;
    return { speaking: this.speechMs > 0, confirmed: this.confirmed, justConfirmed, ended, threshold };
  }
}

/** RMS of a time-domain frame (Float32 samples in [-1, 1]). */
export function frameRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}
