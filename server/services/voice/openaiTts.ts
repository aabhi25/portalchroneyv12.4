/**
 * OpenAI ("ChatGPT voices") text-to-speech for voice mode, tuned for how OpenAI streams.
 *
 * Measured from India (2026-10-03), same sentences as ElevenLabs flash:
 *   first byte 0.8–1.8 s (ElevenLabs 0.2–0.4 s); delivery ~5–6x real time in bursts — a tiny
 *   first chunk, then a 150–180 ms pause (ElevenLabs ~20x, smooth). The browser plays chunks
 *   as they arrive, so that pause was an audible stutter, and with only two sentences in
 *   flight a short sentence could finish before the next one was ready.
 * So, for this provider only:
 *   - each sentence is held until OPENAI_TTS_PREBUFFER_MS of it exists (smooth start);
 *   - more sentences are synthesised at once (OPENAI_TTS_PARALLEL);
 *   - one quick retry when a request fails before any audio (rate limit / 5xx / network);
 *   - speaking instructions (gpt-4o-mini-tts): warm and clear, Hindi pronounced natively.
 * ElevenLabs voices are unaffected.
 */
import type { TtsProvider } from "./ttsPipeline";

export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const envNumber = (name: string, fallback: number, min: number, max: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" && process.env[name] !== undefined ? Math.min(max, Math.max(min, v)) : fallback;
};
/** Overridable for tuning/measurement (OPENAI_TTS_PREBUFFER_MS=0, OPENAI_TTS_PARALLEL=2 = the old behaviour). */
export const OPENAI_TTS_PREBUFFER_MS = envNumber("OPENAI_TTS_PREBUFFER_MS", 350, 0, 2000);
export const OPENAI_TTS_PARALLEL = envNumber("OPENAI_TTS_PARALLEL", 4, 1, 8);
export const OPENAI_TTS_VOICES = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "fable", "marin", "cedar",
  "nova", "onyx", "sage", "shimmer", "verse",
]);

const BASE_INSTRUCTIONS =
  "Speak in a warm, friendly, natural conversational tone at a clear, moderate pace, like a real person helping on a call. " +
  "When the text is in Hindi, Devanagari or Hinglish (Hindi written in English letters), pronounce it the way a native Hindi speaker from India would, " +
  "and say English words inside it with a natural Indian English accent.";
const TUTOR_INSTRUCTIONS =
  " You are a patient, encouraging tutor explaining to a school student: articulate numbers, formulas and key terms clearly.";

export function openAiTtsInstructions(opts: { tutor?: boolean } = {}): string {
  return BASE_INSTRUCTIONS + (opts.tutor ? TUTOR_INSTRUCTIONS : "");
}

/** Minimal surface of the OpenAI SDK used here (a fake in tests). */
export interface OpenAiSpeechClient {
  audio: {
    speech: {
      create(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<{ body?: unknown; arrayBuffer(): Promise<ArrayBuffer> }>;
    };
  };
}

function isRetryable(error: unknown): boolean {
  const e = error as { status?: number; code?: string; name?: string; cause?: { code?: string } };
  if (e?.name === "AbortError") return false;
  const status = Number(e?.status);
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const code = String(e?.code || e?.cause?.code || "");
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR|ECONNREFUSED/.test(code) || /fetch failed|network|socket/i.test(String((error as Error)?.message || ""));
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
});

export function createOpenAiTtsProvider(opts: {
  client: OpenAiSpeechClient;
  voice?: string | null;
  tutor?: boolean;
  retryDelayMs?: number;
}): TtsProvider {
  const voice = OPENAI_TTS_VOICES.has(String(opts.voice || "")) ? String(opts.voice) : "shimmer";
  const instructions = openAiTtsInstructions({ tutor: opts.tutor });
  return {
    name: "openai",
    prebufferMs: OPENAI_TTS_PREBUFFER_MS,
    preferredParallel: OPENAI_TTS_PARALLEL,
    synthesize: async (text, signal, onChunk) => {
      let attempt = 0;
      for (;;) {
        let gotAudio = false;
        try {
          const response = await opts.client.audio.speech.create({
            model: OPENAI_TTS_MODEL,
            voice,
            input: text.slice(0, 4000),
            instructions,
            response_format: "pcm",
          }, { signal });
          const body = response.body as AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | undefined;
          if (!body) {
            const pcm = Buffer.from(await response.arrayBuffer());
            if (pcm.length > 0) { gotAudio = true; onChunk(pcm); }
            return;
          }
          const iterable: AsyncIterable<Uint8Array> = typeof (body as any)[Symbol.asyncIterator] === "function"
            ? (body as AsyncIterable<Uint8Array>)
            : (await import("stream")).Readable.fromWeb(body as any) as unknown as AsyncIterable<Uint8Array>;
          for await (const chunk of iterable) {
            if (signal.aborted) throw Object.assign(new Error("OpenAI TTS aborted"), { name: "AbortError" });
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (buf.length > 0) { gotAudio = true; onChunk(buf); }
          }
          return;
        } catch (error) {
          // Retry once, only if nothing was played yet (a mid-sentence retry would repeat words).
          if (attempt === 0 && !gotAudio && !signal.aborted && isRetryable(error)) {
            attempt++;
            await sleep(opts.retryDelayMs ?? 300, signal);
            continue;
          }
          throw error;
        }
      }
    },
  };
}
