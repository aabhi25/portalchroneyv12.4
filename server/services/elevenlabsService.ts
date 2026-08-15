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
}

export async function synthesizeSpeechStreaming(
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
  } = options;

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
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
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
}

export interface ElevenLabsVoiceResult {
  voices: ElevenLabsVoice[];
  has_more: boolean;
  last_sort_id: string | null;
}

export async function searchElevenLabsVoices(
  apiKey: string,
  options: {
    search?: string;
    language?: string;
    gender?: string;
    pageSize?: number;
    nextSortId?: string;
    businessAccountId?: string;
  }
): Promise<ElevenLabsVoiceResult> {
  const { search, language, gender, pageSize = 20, nextSortId, businessAccountId } = options;

  const cacheKey = JSON.stringify({ businessAccountId: businessAccountId || apiKey.slice(-8), search, language, gender, pageSize, nextSortId });
  const cached = voiceSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (language) params.set('language', language);
  if (gender) params.set('gender', gender);
  params.set('page_size', String(pageSize));
  if (nextSortId) params.set('sort_id', nextSortId);

  // NOTE: Use /v1/shared-voices (the public Voice Library search endpoint).
  // /v1/voices/search does not exist — /v1/voices/{voice_id} treats the path
  // segment as a voice ID, which is why hitting /v1/voices/search returned
  // a 400 "voice_not_found" for ID 'search'. The shared-voices endpoint
  // accepts search/language/gender/page_size/sort_id and returns
  // { voices, has_more, last_sort_id } — matching what the client expects.
  const url = `https://api.elevenlabs.io/v1/shared-voices?${params.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'xi-api-key': apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs voice search API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { voices: ElevenLabsVoice[]; has_more: boolean; last_sort_id?: string };

  const result: ElevenLabsVoiceResult = {
    voices: data.voices.map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category || 'community',
      description: v.description || null,
      preview_url: v.preview_url || null,
      labels: v.labels || {},
    })),
    has_more: data.has_more || false,
    last_sort_id: data.last_sort_id || null,
  };

  voiceSearchCache.set(cacheKey, { data: result, expiresAt: Date.now() + VOICE_CACHE_TTL });

  if (voiceSearchCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of voiceSearchCache) {
      if (entry.expiresAt < now) voiceSearchCache.delete(key);
    }
  }

  return result;
}
