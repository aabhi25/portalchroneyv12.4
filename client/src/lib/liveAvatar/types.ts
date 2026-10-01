/**
 * Browser-side avatar adapter contract. One implementation per provider
 * (adapters/heygen.ts, adapters/anam.ts, adapters/fake.ts); the voice UI only
 * ever talks to this interface. Provider SDKs are loaded lazily, on tap.
 */
export type AvatarAudioRoute = "server" | "client";

/** Returned by POST /api/chat/widget/avatar/session — never contains our API keys. */
export interface AvatarConnectionInfo {
  provider: string;
  audioRoute: AvatarAudioRoute;
  livekitUrl?: string;
  livekitToken?: string;
  sessionToken?: string;
  inputSampleRate?: number;
  fake?: { audioRoute: AvatarAudioRoute; dropAfterSeconds?: number; failConnect?: boolean };
}

export interface AvatarSessionInfo {
  sessionId: string;
  provider: string;
  audioRoute: AvatarAudioRoute;
  connection: AvatarConnectionInfo;
  displayName: string;
  styleHint: string;
  disclosure: string | null;
  limits: { maxSessionSeconds: number; idleTimeoutSeconds: number; heartbeatIntervalSeconds: number };
  connectTimeoutMs: number;
}

export type AvatarAdapterEvent = "connected" | "speaking" | "idle" | "error" | "disconnected";

export interface AvatarClientAdapter {
  readonly provider: string;
  readonly audioRoute: AvatarAudioRoute;
  /** Start streaming into `video` (called inside the visitor's tap). Resolves on the first video frame. */
  connect(video: HTMLVideoElement, info: AvatarConnectionInfo): Promise<void>;
  /** Client route only: our TTS PCM16 24 kHz mono bytes, in order. */
  sendAudio?(pcm24k: Uint8Array): void;
  /** Client route only: the current answer's audio is complete. */
  endOfSpeech?(): void;
  /** Stop speaking now (barge-in). No-op for server-route providers (the server interrupts). */
  interrupt(): void;
  setMuted(muted: boolean): void;
  /** 0..1 — used to duck the avatar while the visitor might be interrupting. */
  setVolume(volume: number): void;
  providerSessionId(): string | null;
  /** Server-route providers: speak events relayed by our voice socket (avatar_event). */
  onServerEvent?(event: string): void;
  on(event: AvatarAdapterEvent, listener: (detail?: unknown) => void): () => void;
  close(): Promise<void>;
}

/** Tiny event emitter shared by the adapters. */
export class AdapterEvents {
  private readonly map = new Map<AvatarAdapterEvent, Set<(detail?: unknown) => void>>();

  on(event: AvatarAdapterEvent, listener: (detail?: unknown) => void): () => void {
    let set = this.map.get(event);
    if (!set) { set = new Set(); this.map.set(event, set); }
    set.add(listener);
    return () => { set!.delete(listener); };
  }

  emit(event: AvatarAdapterEvent, detail?: unknown): void {
    this.map.get(event)?.forEach((l) => { try { l(detail); } catch { /* listener errors never break playback */ } });
  }

  clear(): void {
    this.map.clear();
  }
}

/** Resolve when the element shows its first decoded frame (or reject on timeout). */
export function waitForFirstFrame(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth > 0) { resolve(); return; }
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener("loadeddata", onFrame);
      video.removeEventListener("playing", onFrame);
      ok ? resolve() : reject(new Error("first frame timeout"));
    };
    const onFrame = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    video.addEventListener("loadeddata", onFrame);
    video.addEventListener("playing", onFrame);
  });
}

/** Start playback; if the browser blocks sound, start muted and unmute on the next gesture. */
export async function playInline(video: HTMLVideoElement): Promise<void> {
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  try {
    await video.play();
  } catch {
    const wasMuted = video.muted;
    video.muted = true;
    try { await video.play(); } catch { /* still blocked — the panel shows a tap-to-play control */ }
    if (!wasMuted) {
      const unmute = () => {
        video.muted = false;
        void video.play().catch(() => undefined);
        window.removeEventListener("pointerdown", unmute, true);
        window.removeEventListener("keydown", unmute, true);
      };
      window.addEventListener("pointerdown", unmute, true);
      window.addEventListener("keydown", unmute, true);
    }
  }
}
