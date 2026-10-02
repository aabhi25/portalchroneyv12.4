/**
 * The assistant's gender, for languages whose verbs and adjectives agree with the speaker
 * (Hindi "main karti hoon" vs "main karta hoon"). Models default to masculine forms, so a
 * female voice or avatar sounds like a man unless the reply is written in feminine forms.
 *
 * Source of truth, in order: the video avatar's gender (super-admin setting) → the selected
 * voice (built-in table below, or the ElevenLabs "gender" label for custom voices) → none.
 */
import { getElevenLabsVoiceId } from "../elevenlabsService";

export type AssistantGender = "female" | "male";

/** OpenAI TTS voices (legacy voice mode + fallback voice). */
const OPENAI_VOICE_GENDER: Record<string, AssistantGender> = {
  coral: "female", nova: "female", sage: "female", shimmer: "female", marin: "female",
  ash: "male", ballad: "male", echo: "male", fable: "male", onyx: "male", verse: "male", cedar: "male",
};

/**
 * Built-in ElevenLabs voices (widget "elevenlabs-*" choices). Checked against the ElevenLabs
 * voice API on 2026-10-03 where it carries a gender label (Lily, Sarah female; Drew, Paul male);
 * the rest are ElevenLabs' well-known premade voices.
 */
const ELEVENLABS_VOICE_GENDER: Record<string, AssistantGender> = {
  "elevenlabs-rachel": "female", "elevenlabs-domi": "female", "elevenlabs-sarah": "female",
  "elevenlabs-charlotte": "female", "elevenlabs-lily": "female",
  "elevenlabs-drew": "male", "elevenlabs-clyde": "male", "elevenlabs-paul": "male",
  "elevenlabs-dave": "male", "elevenlabs-fin": "male",
};

export function normalizeGender(value: unknown): AssistantGender | null {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "female" || v === "male" ? v : null;
}

/** Gender of a widget voice choice when it is known without a network call. */
export function genderOfVoiceSync(voiceSelection: string | null | undefined): AssistantGender | null {
  const v = String(voiceSelection ?? "").trim().toLowerCase();
  if (!v) return null;
  return ELEVENLABS_VOICE_GENDER[v] ?? OPENAI_VOICE_GENDER[v] ?? null;
}

// Custom ElevenLabs voices ("el:<voiceId>"): the voice's own "gender" label, cached.
const LABEL_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const labelCache = new Map<string, { gender: AssistantGender | null; at: number }>();
const inFlight = new Map<string, Promise<AssistantGender | null>>();

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<any> }>;

/** Test helper. */
export function resetVoiceGenderCacheForTesting(): void {
  labelCache.clear();
  inFlight.clear();
}

/**
 * Gender of a widget voice choice, looking up custom ElevenLabs voices once (cached a day;
 * failures are cached for an hour and never block for more than `timeoutMs`).
 */
export async function genderOfVoice(
  voiceSelection: string | null | undefined,
  elevenlabsApiKey?: string | null,
  opts: { fetch?: FetchLike; timeoutMs?: number; now?: number } = {},
): Promise<AssistantGender | null> {
  const known = genderOfVoiceSync(voiceSelection);
  if (known) return known;
  const v = String(voiceSelection ?? "").trim();
  if (!v.startsWith("el:") || !elevenlabsApiKey) return null;
  const voiceId = getElevenLabsVoiceId(v);
  if (!voiceId || !/^[A-Za-z0-9]{8,64}$/.test(voiceId)) return null;
  const now = opts.now ?? Date.now();
  const hit = labelCache.get(voiceId);
  if (hit && now - hit.at < (hit.gender ? LABEL_TTL_MS : MISS_TTL_MS)) return hit.gender;
  let pending = inFlight.get(voiceId);
  if (!pending) {
    const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init as RequestInit) as any);
    pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 1500);
      try {
        const res = await doFetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, { headers: { "xi-api-key": elevenlabsApiKey }, signal: controller.signal });
        const gender = res.ok ? normalizeGender((await res.json())?.labels?.gender) : null;
        labelCache.set(voiceId, { gender, at: Date.now() });
        return gender;
      } catch {
        labelCache.set(voiceId, { gender: null, at: Date.now() });
        return null;
      } finally {
        clearTimeout(timer);
        inFlight.delete(voiceId);
      }
    })();
    inFlight.set(voiceId, pending);
  }
  return pending;
}

/** The video avatar's gender wins (it is what the visitor sees); otherwise the voice's. */
export function resolveAssistantGender(input: { avatarGender?: unknown; voiceGender?: AssistantGender | null }): AssistantGender | null {
  return normalizeGender(input.avatarGender) ?? input.voiceGender ?? null;
}

/**
 * Non-blocking variant for the text-chat hot path: built-in voices and cached custom-voice
 * labels answer at once; an unknown custom voice is looked up in the background (next turn).
 */
export function voiceGenderNow(voiceSelection: string | null | undefined, elevenlabsApiKey?: string | null): AssistantGender | null {
  const known = genderOfVoiceSync(voiceSelection);
  if (known) return known;
  const voiceId = String(voiceSelection ?? "").startsWith("el:") ? getElevenLabsVoiceId(String(voiceSelection)) : null;
  if (!voiceId) return null;
  const hit = labelCache.get(voiceId);
  if (hit && Date.now() - hit.at < (hit.gender ? LABEL_TTL_MS : MISS_TTL_MS)) return hit.gender;
  void genderOfVoice(voiceSelection, elevenlabsApiKey).catch(() => null);
  return hit?.gender ?? null;
}

/**
 * Text chat speaks with the same gender as the widget's voice — but only where the widget
 * actually has voice (a text-only widget keeps the model's own, ungendered instructions).
 */
export function textChatAssistantGender(
  account: { voiceModeEnabled?: string | null; elevenlabsApiKey?: string | null } | null | undefined,
  widget: { voiceSelection?: string | null; chatMode?: string | null } | null | undefined,
): AssistantGender | null {
  if (!account || account.voiceModeEnabled !== "true") return null;
  if (widget?.chatMode === "chat-only") return null;
  return voiceGenderNow(widget?.voiceSelection || "shimmer", account.elevenlabsApiKey);
}
