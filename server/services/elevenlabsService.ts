import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { Readable } from 'stream';

const ELEVENLABS_VOICE_MAP: Record<string, string> = {
  'elevenlabs-rachel': '21m00Tcm4TlvDq8ikWAM',
  'elevenlabs-drew': '29vD33N1CtxCmqQRPOHJ',
  'elevenlabs-clyde': '2EiwWnXFnvU5JabPnv8n',
  'elevenlabs-paul': '5Q0t7uMcjvnagumLfvZi',
  'elevenlabs-domi': 'AZnzlk1XvdvUeBnXmlld',
  'elevenlabs-dave': 'CYw3kZ02Hs0563khs1Fj',
  'elevenlabs-fin': 'D38z5RcWu1voky8WS1ja',
  'elevenlabs-sarah': 'EXAVITQu4vr4xnSDxMaL',
  'elevenlabs-charlotte': 'XB0fDUnXU5powFXDhCwa',
  'elevenlabs-lily': 'pFZP5JQG7iQjIQuC4Bku',
};

export function isElevenLabsVoice(voiceSelection: string): boolean {
  return voiceSelection.startsWith('elevenlabs-') || voiceSelection.startsWith('el:');
}

export function getElevenLabsVoiceId(voiceSelection: string): string | null {
  if (voiceSelection.startsWith('el:')) {
    const directId = voiceSelection.slice(3);
    return directId.length > 0 ? directId : null;
  }
  return ELEVENLABS_VOICE_MAP[voiceSelection] || null;
}

export interface ElevenLabsTTSOptions {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId?: string;
  outputFormat?: string;
  // Optional abort signal so an in-flight synth can be cancelled when a
  // newer answer supersedes it. The fetch and the body-reader loop both
  // honour this signal and throw an AbortError that the caller treats as
  // a clean exit.
  signal?: AbortSignal;
  /** Text spoken just before this one (same answer): ElevenLabs keeps the intonation flowing. */
  previousText?: string;
  /** Text likely to follow (e.g. after a pre-recorded "Achha…"): the clip ends on a continuing tone. */
  nextText?: string;
  /** Speaking speed, 1 = the voice as is (ElevenLabs accepts 0.7–1.2). */
  speed?: number;
  /** ISO 639-1 language of the text ("hi"): the voice pronounces it as that language. */
  languageCode?: string;
}

/** Retries on "busy" answers before the caller switches to its backup voice (see below). */
export const ELEVENLABS_BUSY_RETRIES = 2;
export const ELEVENLABS_BUSY_RETRY_DELAY_MS = 350;

function isRetryableElevenLabsError(error: unknown): boolean {
  const msg = String((error as Error)?.message || '');
  const status = Number(/API error \((\d{3})\)/.exec(msg)?.[1]);
  if (status === 429 || (status >= 500 && status < 600)) return true; // too many concurrent requests / overloaded
  const code = String((error as any)?.code || (error as any)?.cause?.code || '');
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR|ECONNREFUSED/.test(code) || /fetch failed/i.test(msg);
}

/**
 * Streamed ElevenLabs speech. A request ElevenLabs refuses as busy (plan's concurrency limit,
 * e.g. while a call's opening line and its prepared fillers are synthesised together) is retried
 * after a short pause instead of failing at once — failing made the voice pipeline switch to the
 * backup (OpenAI) voice, so a call could start in a different voice. Only retried before any
 * audio was produced (a mid-sentence retry would repeat words) and never after an abort.
 */
export async function synthesizeSpeechStreaming(
  options: ElevenLabsTTSOptions,
  onChunk: (pcm16Chunk: Buffer) => void
): Promise<void> {
  let gotAudio = false;
  for (let attempt = 0; ; attempt++) {
    try {
      await synthesizeSpeechStreamingOnce(options, (chunk) => { gotAudio = true; onChunk(chunk); });
      return;
    } catch (error) {
      if (gotAudio || options.signal?.aborted || attempt >= ELEVENLABS_BUSY_RETRIES || !isRetryableElevenLabsError(error)) throw error;
      console.warn(`[ElevenLabs] busy (${String((error as Error)?.message || '').slice(0, 80)}) — retrying in ${ELEVENLABS_BUSY_RETRY_DELAY_MS}ms`);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ELEVENLABS_BUSY_RETRY_DELAY_MS * (attempt + 1));
        options.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
      });
    }
  }
}

async function synthesizeSpeechStreamingOnce(
  options: ElevenLabsTTSOptions,
  onChunk: (pcm16Chunk: Buffer) => void
): Promise<void> {
  const {
    apiKey,
    voiceId,
    text,
    // eleven_flash_v2_5 — ElevenLabs' lowest-latency model (~75ms time-to-first-byte
    // vs ~250-300ms for turbo_v2_5). Quality is comparable for conversational
    // K12 use; the latency win matters for voice mode UX where the student
    // is waiting for the answer to start speaking.
    modelId = 'eleven_flash_v2_5',
    outputFormat = 'pcm_24000',
    signal,
    previousText,
    nextText,
    speed,
    languageCode,
  } = options;
  const speedSetting = typeof speed === 'number' && Number.isFinite(speed) && speed !== 1 ? Math.min(1.2, Math.max(0.7, speed)) : null;

  // optimize_streaming_latency=3 trades a small amount of pronunciation
  // accuracy for faster time-to-first-byte. Combined with flash_v2_5 this
  // gives us the lowest practical latency on the HTTP streaming endpoint.
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${outputFormat}&optimize_streaming_latency=3`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      ...(previousText ? { previous_text: previousText } : {}),
      ...(nextText ? { next_text: nextText } : {}),
      ...(languageCode ? { language_code: languageCode } : {}),
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
        ...(speedSetting !== null ? { speed: speedSetting } : {}),
      },
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs TTS API error (${response.status}): ${errorText}`);
  }

  const webStream = response.body;
  if (!webStream) {
    throw new Error('ElevenLabs TTS: No response body for streaming');
  }

  const nodeReadable = Readable.fromWeb(webStream as import('stream/web').ReadableStream);
  for await (const chunk of nodeReadable) {
    if (signal?.aborted) {
      // Stop reading immediately; the caller treats AbortError as a clean exit.
      try { nodeReadable.destroy(); } catch {}
      throw Object.assign(new Error('ElevenLabs synth aborted'), { name: 'AbortError' });
    }
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buf.length > 0) {
      onChunk(buf);
    }
  }
}

interface VoiceCacheEntry {
  data: ElevenLabsVoiceResult;
  expiresAt: number;
}

const voiceSearchCache = new Map<string, VoiceCacheEntry>();
const VOICE_CACHE_TTL = 5 * 60 * 1000;

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description: string | null;
  preview_url: string | null;
  labels: Record<string, string>;
  /** Voice Library popularity: characters spoken with it in the last year, and how many accounts added it. */
  usage_1y?: number | null;
  cloned_by_count?: number | null;
  language?: string | null;
}

export interface ElevenLabsVoiceResult {
  voices: ElevenLabsVoice[];
  has_more: boolean;
  /** Pass back as `page` for the next page (null = no more). */
  next_page: number | null;
}

/** Voice Library sort orders offered in the voice picker. */
export const VOICE_SORTS = ['usage_character_count_1y', 'cloned_by_count', 'trending', 'created_date'] as const;
export type VoiceSort = typeof VOICE_SORTS[number];

const toVoice = (v: any): ElevenLabsVoice => ({
  voice_id: v.voice_id,
  name: v.name,
  category: v.category || 'community',
  description: v.description || null,
  preview_url: v.preview_url || null,
  labels: v.labels || {
    ...(v.gender ? { gender: v.gender } : {}),
    ...(v.accent ? { accent: v.accent } : {}),
    ...(v.use_case ? { use_case: v.use_case } : {}),
    ...(v.age ? { age: v.age } : {}),
  },
  usage_1y: typeof v.usage_character_count_1y === 'number' ? v.usage_character_count_1y : null,
  cloned_by_count: typeof v.cloned_by_count === 'number' ? v.cloned_by_count : null,
  language: v.language || null,
});

/**
 * Search the public ElevenLabs Voice Library (/v1/shared-voices). Several languages are searched
 * at once (the API filters one language per request) and merged: by popularity for the
 * popularity sorts, otherwise interleaved in each language's own order.
 */
export async function searchElevenLabsVoices(
  apiKey: string,
  options: {
    search?: string;
    languages?: string[];
    gender?: string;
    pageSize?: number;
    page?: number;
    sort?: VoiceSort;
    businessAccountId?: string;
  }
): Promise<ElevenLabsVoiceResult> {
  const { search, gender, pageSize = 20, page = 0, businessAccountId } = options;
  const sort: VoiceSort = options.sort && (VOICE_SORTS as readonly string[]).includes(options.sort) ? options.sort : 'usage_character_count_1y';
  const languages = Array.from(new Set((options.languages || []).map((l) => l.trim().toLowerCase()).filter((l) => /^[a-z]{2,3}$/.test(l)))).slice(0, 6);

  const cacheKey = JSON.stringify({ businessAccountId: businessAccountId || apiKey.slice(-8), search, languages, gender, pageSize, page, sort });
  const cached = voiceSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // With several languages each request returns a share of the page.
  const perLanguage = languages.length > 1 ? Math.max(5, Math.ceil(pageSize / languages.length)) : pageSize;
  const fetchOne = async (language?: string): Promise<{ voices: ElevenLabsVoice[]; has_more: boolean }> => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (language) params.set('language', language);
    if (gender) params.set('gender', gender);
    params.set('page_size', String(perLanguage));
    params.set('sort', sort);
    params.set('page', String(page));
    const response = await fetchWithTimeout(`https://api.elevenlabs.io/v1/shared-voices?${params.toString()}`, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs voice search API error (${response.status}): ${errorText}`);
    }
    const data = await response.json() as { voices: any[]; has_more: boolean };
    return { voices: (data.voices || []).map(toVoice), has_more: !!data.has_more };
  };

  const pages = await Promise.all(languages.length ? languages.map((l) => fetchOne(l)) : [fetchOne(undefined)]);
  const seen = new Set<string>();
  let merged: ElevenLabsVoice[];
  if (sort === 'usage_character_count_1y' || sort === 'cloned_by_count') {
    const metric = (v: ElevenLabsVoice) => (sort === 'cloned_by_count' ? v.cloned_by_count : v.usage_1y) ?? 0;
    merged = pages.flatMap((p) => p.voices).sort((a, b) => metric(b) - metric(a));
  } else {
    merged = [];
    const longest = Math.max(0, ...pages.map((p) => p.voices.length));
    for (let i = 0; i < longest; i++) for (const p of pages) if (p.voices[i]) merged.push(p.voices[i]);
  }
  merged = merged.filter((v) => (seen.has(v.voice_id) ? false : (seen.add(v.voice_id), true)));
  const hasMore = pages.some((p) => p.has_more);

  const result: ElevenLabsVoiceResult = { voices: merged, has_more: hasMore, next_page: hasMore ? page + 1 : null };

  voiceSearchCache.set(cacheKey, { data: result, expiresAt: Date.now() + VOICE_CACHE_TTL });

  if (voiceSearchCache.size > 100) {
    const now = Date.now();
    voiceSearchCache.forEach((entry, key) => {
      if (entry.expiresAt < now) voiceSearchCache.delete(key);
    });
  }

  return result;
}

const voiceDetailsCache = new Map<string, { data: ElevenLabsVoice | null; expiresAt: number }>();

/**
 * One voice by id (its name and sample for the "selected voice" card); null when not found.
 * /v1/voices/{id} only knows the account's own voices; a voice picked from the public Voice
 * Library is found by searching the library for its id (the search matches ids exactly).
 */
export async function getElevenLabsVoice(apiKey: string, voiceId: string): Promise<ElevenLabsVoice | null> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(voiceId)) return null;
  const key = `${apiKey.slice(-8)}|${voiceId}`;
  const cached = voiceDetailsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const response = await fetchWithTimeout(`https://api.elevenlabs.io/v1/voices/${voiceId}`, { method: 'GET', headers: { 'xi-api-key': apiKey } });
  let data = response.ok ? toVoice(await response.json()) : null;
  if (!data) {
    const shared = await fetchWithTimeout(`https://api.elevenlabs.io/v1/shared-voices?search=${encodeURIComponent(voiceId)}&page_size=5`, { method: 'GET', headers: { 'xi-api-key': apiKey } });
    if (shared.ok) {
      const body = await shared.json() as { voices?: any[] };
      const match = (body.voices || []).find((v) => v?.voice_id === voiceId);
      data = match ? toVoice(match) : null;
    }
  }
  if (voiceDetailsCache.size > 500) voiceDetailsCache.clear();
  voiceDetailsCache.set(key, { data, expiresAt: Date.now() + 60 * 60 * 1000 });
  return data;
}
