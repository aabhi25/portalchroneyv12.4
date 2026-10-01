/**
 * Decide whether a final speech-to-text transcript is a real student turn.
 *
 * Transcription models invent text for non-speech audio (fans, TV, pressure
 * cookers, the tutor's own voice echoing back). In the largest study of this,
 * ~40% of non-speech clips produced text, a quarter of it "thank you", with
 * "so", "the" and "you" also common. Separately, short acknowledgements
 * ("hmm", "ok", "haan") said while the tutor is talking mean "I'm listening",
 * not "stop and answer this".
 *
 * Rules, in order:
 *   1. Empty / no letters or digits                         → drop ("empty")
 *   2. Strong hallucination phrase, alone                   → drop ("noise_phrase")
 *      ("thanks for watching", "subscribe", "[music]" …) — dropped even in
 *      hold-to-talk, where nobody intends to say them.
 *   3. Hands-free only: weak hallucination phrase, alone    → drop ("noise_phrase")
 *      ("thank you", "you", "so", "the", "bye", "धन्यवाद" …). Hold-to-talk turns
 *      are intentional, so a held "thank you" is a real turn.
 *   4. Pure filler ("hmm", "um", "uh")                      → drop ("filler")
 *   5. Very low transcription confidence on a short clip    → drop ("low_confidence")
 *      (only when the transcript event carries logprobs).
 *   6. Echo of what the tutor just said                     → drop ("echo")
 *   7. While the tutor is answering (generating or speaking) — i.e. this would
 *      be an INTERRUPTION:
 *        - a stop word ("stop", "ruko", "bas") always counts
 *        - backchannel-only ("ok", "haan", "acha", "yes", "right") → drop ("backchannel")
 *        - speech shorter than 500 ms                              → drop ("too_short")
 *   8. Otherwise, fewer than 2 words AND under 400 ms of speech  → drop ("too_short"),
 *      UNLESS it is a meaningful one-word answer (a number, yes/no/haan/nahi)
 *      to a question the tutor just asked, or the turn was held (hold-to-talk).
 *
 * Unknown durations never cause a drop on their own.
 */

export type TurnDropReason =
  | 'empty'
  | 'foreign_script'
  | 'noise_phrase'
  | 'filler'
  | 'low_confidence'
  | 'echo'
  | 'backchannel'
  | 'too_short';

export interface TurnFilterInput {
  transcript: string;
  /** Measured speech duration (VAD start→stop, or hold duration). */
  speechMs?: number | null;
  /** An answer is in flight (being generated or spoken): accepting = interrupting. */
  aiActive: boolean;
  /** The turn came from hold-to-talk (intentional). */
  heldTurn?: boolean;
  /** The tutor's last message ended with a question. */
  assistantAskedQuestion?: boolean;
  /** Recently spoken assistant text, for echo detection. */
  recentAssistantSpeech?: string;
  /** Per-token logprobs, when the transcription event provides them. */
  logprobs?: Array<{ logprob?: number }> | null;
}

export interface TurnFilterResult {
  accept: boolean;
  reason?: TurnDropReason;
  words: number;
}

/** Minimum speech for a confirmed interruption (LiveKit's default). */
export const MIN_INTERRUPTION_SPEECH_MS = 500;
/** Below this, a single word is treated as noise unless it is a meaningful answer. */
export const MIN_SHORT_TURN_SPEECH_MS = 400;

/** Always noise when they are the whole transcript. */
const STRONG_NOISE = new Set([
  'thanks for watching', 'thank you for watching', 'thanks for watching the video',
  'please subscribe', 'subscribe', 'like and subscribe', 'subscribe to my channel',
  'please like and subscribe', 'see you in the next video', 'music', 'applause',
  'laughter', 'silence', 'noise', 'inaudible', 'blank audio', 'no speech',
  'सब्सक्राइब', 'सब्सक्राइब करें', 'चैनल को सब्सक्राइब करें',
]);

/**
 * Noise when alone in hands-free mode (Barański et al., ICASSP 2025: the most
 * frequent Whisper outputs for non-speech). Kept deliberately small — extend
 * from real TopScholar logs, not guesses.
 */
const WEAK_NOISE = new Set([
  'thank you', 'thank you so much', 'thank you very much', 'thanks', 'thank u',
  'you', 'so', 'the', 'a', 'i', 'and', 'oh', 'bye', 'bye bye', 'okay bye',
  'धन्यवाद', 'शुक्रिया', 'थैंक यू',
]);

const FILLERS = new Set([
  'hmm', 'hm', 'hmmm', 'hmmmm', 'mm', 'mmm', 'mhm', 'mm hmm', 'um', 'umm', 'uh', 'uhh',
  'uh huh', 'er', 'erm', 'ah', 'aah', 'eh', 'huh', 'हम्म', 'हूं', 'हम', 'उम्म',
]);

/** Acknowledgements that mean "I'm listening" while the tutor talks. */
const BACKCHANNEL_WORDS = new Set([
  'ok', 'okay', 'okk', 'k', 'yes', 'yeah', 'yep', 'yup', 'right', 'sure', 'alright', 'all right',
  'got it', 'i see', 'nice', 'cool', 'great', 'good', 'correct', 'oh', 'ah', 'hmm', 'hm', 'mm',
  'mhm', 'uh huh', 'haan', 'han', 'haa', 'ha', 'haanji', 'haan ji', 'hanji', 'ji', 'ji haan',
  'acha', 'achha', 'accha', 'acchha', 'achcha', 'theek', 'thik', 'theek hai', 'thik hai',
  'sahi', 'sahi hai', 'samajh gaya', 'samajh gayi',
  'हाँ', 'हां', 'हा', 'जी', 'हाँ जी', 'जी हाँ', 'अच्छा', 'ठीक', 'ठीक है', 'सही', 'सही है', 'हम्म',
]);

/** Single words that are a meaningful answer to a question the tutor asked. */
const ANSWER_WORDS = new Set([
  'yes', 'no', 'yeah', 'nope', 'yep', 'haan', 'han', 'nahi', 'nahin', 'na', 'true', 'false',
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'twenty', 'hundred', 'half', 'ek', 'do', 'teen', 'char', 'paanch', 'panch',
  'chhe', 'saat', 'aath', 'nau', 'das',
  'हाँ', 'हां', 'नहीं', 'ना', 'एक', 'दो', 'तीन', 'चार', 'पांच', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस',
]);

/** Short commands that must interrupt even when spoken quickly. */
const STOP_WORDS = new Set([
  'stop', 'stop it', 'please stop', 'stop please', 'ok stop', 'okay stop', 'enough', 'bas',
  'bas karo', 'ruko', 'wait', 'रुको', 'बस', 'बस करो',
]);

/** Lower-case, drop punctuation and bracketed tags' brackets, collapse spaces. */
export function normalizeTranscript(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[\[\]()]/g, ' ')
    .replace(/[^a-z0-9ऀ-ॿ\u0600-\u06FF\s]/g, ' ')
    .replace(/[।॥]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(normalized: string): number {
  return normalized ? normalized.split(' ').length : 0;
}

function isBackchannelOnly(normalized: string): boolean {
  if (!normalized) return false;
  if (BACKCHANNEL_WORDS.has(normalized)) return true;
  const words = normalized.split(' ');
  if (words.length > 4) return false;
  // "ok ok", "haan haan", "yes yes", "acha theek hai" — every word an acknowledgement.
  return words.every((w) => BACKCHANNEL_WORDS.has(w) || w === 'hai' || w === 'है');
}

function isMeaningfulAnswerWord(normalized: string): boolean {
  if (/^\d+(\s\d+)?$/.test(normalized)) return true;
  return ANSWER_WORDS.has(normalized);
}

function averageLogprob(logprobs?: Array<{ logprob?: number }> | null): number | null {
  if (!Array.isArray(logprobs) || logprobs.length === 0) return null;
  const values = logprobs.map((l) => Number(l?.logprob)).filter((n) => Number.isFinite(n));
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * True when most of the transcript's words were just spoken by the tutor —
 * the microphone heard the speaker.
 */
export function looksLikeEcho(normalized: string, recentAssistantSpeech?: string): boolean {
  if (!recentAssistantSpeech) return false;
  const words = normalized.split(' ').filter((w) => w.length > 1);
  if (words.length < 3) return false;
  const spoken = new Set(normalizeTranscript(recentAssistantSpeech).split(' '));
  const hits = words.filter((w) => spoken.has(w)).length;
  return hits / words.length >= 0.8;
}

export function classifyVoiceTurn(input: TurnFilterInput): TurnFilterResult {
  const normalized = normalizeTranscript(input.transcript);
  const words = countWords(normalized);
  const speechMs = typeof input.speechMs === 'number' && Number.isFinite(input.speechMs) ? input.speechMs : null;
  const drop = (reason: TurnDropReason): TurnFilterResult => ({ accept: false, reason, words });

  if (!normalized || !/[a-z0-9ऀ-ॿ\u0600-\u06FF]/.test(normalized)) {
    // Only letters of an unrelated script (e.g. Japanese, Chinese, Korean, Cyrillic): a
    // transcription hallucination on noise, not a student speaking.
    return drop(new RegExp('\\p{L}', 'u').test(String(input.transcript || '')) ? 'foreign_script' : 'empty');
  }
  if (STRONG_NOISE.has(normalized)) return drop('noise_phrase');
  if (!input.heldTurn && WEAK_NOISE.has(normalized)) return drop('noise_phrase');
  if (FILLERS.has(normalized) || normalized.split(' ').every((w) => FILLERS.has(w))) return drop('filler');

  const avg = averageLogprob(input.logprobs);
  if (avg !== null && avg < -1.2 && words <= 3 && !input.heldTurn) return drop('low_confidence');

  if (input.aiActive && !input.heldTurn && looksLikeEcho(normalized, input.recentAssistantSpeech)) {
    return drop('echo');
  }

  if (input.aiActive && !input.heldTurn) {
    if (STOP_WORDS.has(normalized)) return { accept: true, words };
    if (isBackchannelOnly(normalized)) return drop('backchannel');
    if (speechMs !== null && speechMs < MIN_INTERRUPTION_SPEECH_MS) return drop('too_short');
    return { accept: true, words };
  }

  if (words < 2 && speechMs !== null && speechMs < MIN_SHORT_TURN_SPEECH_MS && !input.heldTurn) {
    if (input.assistantAskedQuestion && isMeaningfulAnswerWord(normalized)) return { accept: true, words };
    return drop('too_short');
  }
  return { accept: true, words };
}

/** True when the assistant's text ends by asking the student something. */
export function endsWithQuestion(text?: string | null): boolean {
  if (!text) return false;
  const trimmed = String(text).replace(/[\s*_)"'”’\]]+$/g, '');
  return /[?？]$/.test(trimmed);
}
