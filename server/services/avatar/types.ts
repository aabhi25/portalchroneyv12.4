/**
 * Live AI avatar — provider-agnostic contracts.
 *
 * Architecture ("avatar as renderer"): our voice pipeline stays the brain
 * (OpenAI Realtime STT → our chat pipeline → ElevenLabs TTS). The avatar
 * provider only turns OUR audio into a lip-synced video stream.
 *
 * Two audio routes exist:
 *  - 'server': our server holds the provider's audio socket and forwards the
 *    TTS PCM itself (HeyGen LiveAvatar LITE). The browser only watches.
 *  - 'client': the provider's browser SDK accepts the audio (Anam audio
 *    passthrough). Our voice WebSocket already sends the PCM to the browser,
 *    which feeds it to the SDK instead of playing it.
 *
 * Adding a provider = one server adapter implementing `AvatarProvider` plus one
 * browser adapter (client/src/lib/liveAvatar/adapters).
 */

export const AVATAR_PROVIDER_IDS = ["heygen_liveavatar", "anam", "fake"] as const;
export type AvatarProviderId = typeof AVATAR_PROVIDER_IDS[number];
/** Providers a super admin can pick in production. 'fake' is development-only. */
export const PRODUCTION_AVATAR_PROVIDERS = ["heygen_liveavatar", "anam"] as const;
export type ProductionAvatarProviderId = typeof PRODUCTION_AVATAR_PROVIDERS[number];

export const AVATAR_PROVIDER_LABELS: Record<AvatarProviderId, string> = {
  heygen_liveavatar: "HeyGen LiveAvatar (LITE)",
  anam: "Anam (audio passthrough)",
  fake: "Fake provider (development only)",
};

export type AudioRoute = "server" | "client";

/** Why a session ended. Stored in avatar_sessions.end_reason. */
export type AvatarEndReason =
  | "visitor_closed"
  | "switched_to_text"
  | "idle_timeout"
  | "max_duration"
  | "cap_reached"
  | "voice_closed"
  | "heartbeat_timeout"
  | "connect_timeout"
  | "connect_failed"
  | "provider_disconnected"
  | "provider_error"
  | "server_shutdown"
  | "server_restart"
  | "disabled";

export const CLIENT_END_REASONS: AvatarEndReason[] = [
  "visitor_closed",
  "switched_to_text",
  "connect_timeout",
  "connect_failed",
  "provider_disconnected",
  "provider_error",
];

/**
 * What the browser receives to connect the video. NEVER contains our API key —
 * only short-lived, session-scoped credentials minted server-side.
 */
export interface ClientConnectionInfo {
  provider: AvatarProviderId;
  audioRoute: AudioRoute;
  /** HeyGen LiveAvatar: LiveKit room the avatar publishes into. */
  livekitUrl?: string;
  livekitToken?: string;
  /** Anam: session token for `createClient(sessionToken)`. */
  sessionToken?: string;
  /** Client route: PCM sample rate the provider expects (Anam: 16000). */
  inputSampleRate?: number;
  /** Fake provider knobs (development only). */
  fake?: { audioRoute: AudioRoute; dropAfterSeconds?: number; failConnect?: boolean };
}

export interface CreateProviderSessionInput {
  apiKey: string;
  avatarId: string;
  providerOptions: Record<string, unknown>;
  /** Our hard cap for this session; passed to the provider where supported. */
  maxSessionSeconds: number;
  /** Our avatar_sessions.id (for logs / provider labels). */
  sessionLabel: string;
}

export type ProviderEvent =
  | { type: "connected" }
  | { type: "speak_started" }
  | { type: "speak_ended" }
  | { type: "interrupted" }
  | { type: "warning"; message: string }
  | { type: "error"; code: AvatarErrorCode; message: string; fatal: boolean }
  | { type: "disconnected"; reason: string };

export interface ProviderSessionStats {
  audioBytesIn: number;
  chunksSent: number;
  utterances: number;
  interrupts: number;
  keepAlives: number;
}

/** A live provider session held by our server. */
export interface ProviderSession {
  readonly providerSessionId: string | null;
  readonly audioRoute: AudioRoute;
  readonly client: ClientConnectionInfo;
  /** The longest call the provider granted for this session (its plan may allow less than we asked). */
  readonly providerMaxSessionSeconds?: number;
  /** Server route only: PCM16 24 kHz mono, any chunk size. Returns false when the session can no longer take audio. */
  sendAudio?(pcm24k: Buffer): boolean;
  /** Server route only: the current answer is complete (no more audio for it). */
  endOfSpeech?(): void;
  /** Server route only: drop buffered audio / stop speaking now. */
  interrupt?(): void;
  keepAlive?(): void;
  /** Client route: the browser reports the provider's own session id once known. */
  setProviderSessionId?(id: string): void;
  onEvent(listener: (event: ProviderEvent) => void): void;
  stats(): ProviderSessionStats;
  close(reason: AvatarEndReason): Promise<void>;
}

export interface AvatarProvider {
  readonly id: AvatarProviderId;
  readonly audioRoute: AudioRoute;
  /** How long the browser waits for the first video frame before falling back. */
  readonly connectTimeoutMs: number;
  createSession(input: CreateProviderSessionInput): Promise<ProviderSession>;
  /** Best-effort stop of a session we lost track of (e.g. after a restart). */
  stopSession?(apiKey: string, providerSessionId: string, reason: AvatarEndReason): Promise<void>;
  /**
   * Cheap authenticated call that proves the key works WITHOUT starting a
   * (billed) avatar session. Throws AvatarProviderError (code 'auth' = bad key).
   */
  validateKey(apiKey: string): Promise<{ detail?: string }>;
  /**
   * Does this avatar id exist at this provider (for this key)? Read-only, not billed.
   * Throws AvatarProviderError for anything other than "found" / "not found" (bad key, outage).
   */
  lookupAvatar?(apiKey: string, avatarId: string): Promise<{ found: true; name?: string; resolvedAvatarId?: string; resolvedFrom?: "persona"; avatarModel?: string | null } | { found: false }>;
}

export type AvatarErrorCode =
  | "auth"
  | "quota"
  | "rate_limited"
  | "bad_request"
  | "not_found"
  | "provider_unavailable"
  | "timeout"
  | "network"
  | "protocol";

export class AvatarProviderError extends Error {
  constructor(
    public readonly code: AvatarErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AvatarProviderError";
  }

  get retryable(): boolean {
    return this.code === "rate_limited" || this.code === "provider_unavailable" || this.code === "timeout" || this.code === "network";
  }
}

/** Map an HTTP failure from any provider to our error codes. */
export function mapHttpError(provider: string, status: number, bodyText: string): AvatarProviderError {
  const snippet = (bodyText || "").replace(/\s+/g, " ").slice(0, 200);
  const lower = snippet.toLowerCase();
  let code: AvatarErrorCode;
  if (status === 401 || status === 403) code = "auth";
  else if (status === 402 || /credit|quota|insufficient|payment/.test(lower)) code = "quota";
  else if (status === 429) code = "rate_limited";
  else if (status === 404) code = "not_found";
  else if (status === 400 || status === 422) code = "bad_request";
  else if (status >= 500) code = "provider_unavailable";
  else code = "protocol";
  return new AvatarProviderError(code, `${provider} HTTP ${status}${snippet ? `: ${snippet}` : ""}`, status);
}

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** fetch with a hard timeout, mapping network/timeouts to AvatarProviderError. */
export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  provider: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw mapHttpError(provider, res.status, text);
    return { status: res.status, text };
  } catch (error) {
    if (error instanceof AvatarProviderError) throw error;
    if (controller.signal.aborted) throw new AvatarProviderError("timeout", `${provider} request timed out after ${timeoutMs}ms`);
    throw new AvatarProviderError("network", `${provider} request failed: ${(error as Error)?.message || String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export function parseJson(provider: string, text: string): any {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new AvatarProviderError("protocol", `${provider} returned invalid JSON`);
  }
}
