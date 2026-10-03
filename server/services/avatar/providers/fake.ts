/**
 * Fake avatar provider — DEVELOPMENT / TESTS ONLY.
 *
 * Enabled only when NODE_ENV=development and AVATAR_FAKE_PROVIDER=1 (see
 * isFakeProviderAllowed). Never selectable in production. The browser side
 * renders an animated placeholder instead of a real video stream.
 *
 * Knobs (provider options): audioRoute 'client' | 'server' (default from
 * AVATAR_FAKE_AUDIO_ROUTE or 'client'), failConnect (browser simulates a
 * connect failure), dropAfterSeconds (browser simulates a mid-session drop).
 * avatarId 'fail' makes session creation fail; avatarId 'plan-<seconds>' simulates a
 * provider plan that only grants calls of that length; an API key containing
 * 'invalid' fails validation.
 */
import {
  AvatarProviderError,
  type AudioRoute,
  type AvatarEndReason,
  type AvatarProvider,
  type CreateProviderSessionInput,
  type ProviderEvent,
  type ProviderSession,
  type ProviderSessionStats,
} from "../types";
import { pcmDurationMs } from "../pcm";

export function isFakeProviderAllowed(): boolean {
  return process.env.NODE_ENV === "development" && process.env.AVATAR_FAKE_PROVIDER === "1";
}

export interface FakeSessionRecord {
  input: CreateProviderSessionInput;
  audio: Buffer[];
  speakEnds: number;
  interrupts: number;
  keepAlives: number;
  closedWith: AvatarEndReason | null;
  emit(event: ProviderEvent): void;
}

export function createFakeAvatarProvider(options: { audioRoute?: AudioRoute; onSession?: (rec: FakeSessionRecord) => void } = {}): AvatarProvider & { sessions: FakeSessionRecord[] } {
  const sessions: FakeSessionRecord[] = [];
  let seq = 0;
  const defaultRoute = (): AudioRoute => {
    if (options.audioRoute) return options.audioRoute;
    return process.env.AVATAR_FAKE_AUDIO_ROUTE === "server" ? "server" : "client";
  };

  return {
    id: "fake",
    audioRoute: defaultRoute(),
    connectTimeoutMs: 8_000,
    sessions,

    async createSession(input: CreateProviderSessionInput): Promise<ProviderSession> {
      if (input.avatarId === "fail") throw new AvatarProviderError("provider_unavailable", "fake provider: simulated failure");
      const opts = input.providerOptions || {};
      const route: AudioRoute = opts.audioRoute === "server" || opts.audioRoute === "client" ? opts.audioRoute : defaultRoute();
      const listeners: Array<(e: ProviderEvent) => void> = [];
      const stats: ProviderSessionStats = { audioBytesIn: 0, chunksSent: 0, utterances: 0, interrupts: 0, keepAlives: 0 };
      let speaking = false;
      let speakTimer: NodeJS.Timeout | null = null;
      let utteranceMs = 0;
      let closed = false;
      const record: FakeSessionRecord = {
        input,
        audio: [],
        speakEnds: 0,
        interrupts: 0,
        keepAlives: 0,
        closedWith: null,
        emit: (e) => listeners.forEach((l) => l(e)),
      };
      sessions.push(record);
      options.onSession?.(record);
      const providerSessionId = `fake_${Date.now().toString(36)}_${++seq}`;
      setTimeout(() => { if (!closed) record.emit({ type: "connected" }); }, 5).unref?.();

      const planMatch = /^plan-(\d+)$/.exec(input.avatarId || "");
      const session: ProviderSession = {
        providerSessionId,
        providerMaxSessionSeconds: planMatch ? Number(planMatch[1]) : undefined,
        audioRoute: route,
        client: {
          provider: "fake",
          audioRoute: route,
          inputSampleRate: route === "client" ? 16000 : undefined,
          fake: {
            audioRoute: route,
            dropAfterSeconds: typeof opts.dropAfterSeconds === "number" ? opts.dropAfterSeconds : undefined,
            failConnect: opts.failConnect === true,
          },
        },
        onEvent(listener) { listeners.push(listener); },
        stats: () => ({ ...stats }),
        async close(reason: AvatarEndReason) {
          if (closed) return;
          closed = true;
          record.closedWith = reason;
          if (speakTimer) clearTimeout(speakTimer);
        },
      };
      if (route === "server") {
        session.sendAudio = (pcm: Buffer) => {
          if (closed) return false;
          record.audio.push(Buffer.from(pcm));
          stats.audioBytesIn += pcm.length;
          stats.chunksSent++;
          utteranceMs += pcmDurationMs(pcm.length);
          if (!speaking) {
            speaking = true;
            stats.utterances++;
            record.emit({ type: "speak_started" });
          }
          return true;
        };
        session.endOfSpeech = () => {
          if (closed) return;
          record.speakEnds++;
          const ms = Math.min(utteranceMs, 60_000);
          utteranceMs = 0;
          if (speakTimer) clearTimeout(speakTimer);
          speakTimer = setTimeout(() => {
            if (speaking && !closed) { speaking = false; record.emit({ type: "speak_ended" }); }
          }, ms);
          speakTimer.unref?.();
        };
        session.interrupt = () => {
          if (closed) return;
          record.interrupts++;
          stats.interrupts++;
          utteranceMs = 0;
          if (speakTimer) clearTimeout(speakTimer);
          if (speaking) { speaking = false; record.emit({ type: "interrupted" }); }
        };
        session.keepAlive = () => { record.keepAlives++; stats.keepAlives++; };
      }
      return session;
    },

    async stopSession() { /* nothing to stop */ },

    async lookupAvatar(_apiKey: string, avatarId: string) {
      if (/^missing/i.test(avatarId)) return { found: false as const };
      if (/^persona-/i.test(avatarId)) return { found: true as const, name: `Fake avatar from persona ${avatarId}`, resolvedAvatarId: `avatar-of-${avatarId}`, resolvedFrom: "persona" as const, avatarModel: null };
      return { found: true as const, name: `Fake avatar ${avatarId}` };
    },

    async validateKey(apiKey: string) {
      if (!apiKey || /invalid/i.test(apiKey)) throw new AvatarProviderError("auth", "fake provider: key rejected", 401);
      return { detail: "fake key accepted" };
    },
  };
}
