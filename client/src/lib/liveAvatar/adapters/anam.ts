/**
 * Anam — audio passthrough, browser side. CLIENT audio route.
 *
 * Our server only minted the session token (API key stays server-side). Our
 * voice WebSocket already streams the TTS PCM (24 kHz) to this browser; in
 * avatar mode we resample it to 16 kHz and feed Anam instead of playing it,
 * so the visitor hears the avatar's own (lip-synced) stream.
 *
 * @anam-ai/js-sdk 4.x: createClient(token, { disableInputAudio }) →
 * streamToVideoElement(id) → createAgentAudioInputStream({ encoding: 'pcm_s16le',
 * sampleRate: 16000, channels: 1 }) → sendAudioChunk(bytes) … endSequence();
 * interruptPersona() + endSequence() on barge-in.
 */
import { Pcm16Resampler } from "../resample";
import { AdapterEvents, playInline, waitForFirstFrame, type AvatarClientAdapter, type AvatarConnectionInfo } from "../types";
import { avatarDebug, avatarDebugOn } from "../debug";

/**
 * Debug only: is the avatar's own audio actually playing? Logs on/off transitions of the
 * received stream's level (never routed to the speakers).
 */
function watchAvatarAudio(video: HTMLVideoElement): () => void {
  if (!avatarDebugOn()) return () => undefined;
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  try {
    const stream = video.srcObject as MediaStream | null;
    if (!stream || !stream.getAudioTracks().length) { avatarDebug("anam audio track missing"); return () => undefined; }
    ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    void ctx.resume().catch(() => undefined);
    const buf = new Float32Array(1024);
    let on = false;
    let since = performance.now();
    let quietSince = 0;
    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (!on && rms > 0.01) { on = true; quietSince = 0; avatarDebug("anam AUDIO ON", { rms: +rms.toFixed(3), afterSilenceMs: Math.round(now - since) }); since = now; }
      else if (on && rms <= 0.004) {
        if (!quietSince) quietSince = now;
        else if (now - quietSince > 700) { on = false; avatarDebug("anam audio off", { spokeMs: Math.round(quietSince - since) }); since = quietSince; quietSince = 0; }
      } else if (on) quietSince = 0;
    }, 50);
  } catch (error) {
    avatarDebug("anam audio watch failed", String(error));
  }
  return () => { if (timer) clearInterval(timer); try { void ctx?.close(); } catch { /* ignore */ } };
}

export function createAnamAdapter(): AvatarClientAdapter {
  const events = new AdapterEvents();
  let client: any = null;
  let audioStream: any = null;
  let videoEl: HTMLVideoElement | null = null;
  let resampler = new Pcm16Resampler(24000, 16000);
  let closed = false;
  let sequenceOpen = false;
  let seqChunks = 0;
  let seqBytes = 0;
  let stopWatch: () => void = () => undefined;

  return {
    provider: "anam",
    audioRoute: "client",

    async connect(video: HTMLVideoElement, info: AvatarConnectionInfo): Promise<void> {
      if (!info.sessionToken) throw new Error("missing Anam session token");
      videoEl = video;
      if (!video.id) video.id = `anam-avatar-${Math.random().toString(36).slice(2)}`;
      const sdk = await import("@anam-ai/js-sdk");
      const { createClient, AnamEvent } = sdk;
      resampler = new Pcm16Resampler(24000, info.inputSampleRate || 16000);
      // Never capture the visitor's mic in Anam: our own voice socket owns the mic.
      client = createClient(info.sessionToken, { disableInputAudio: true, metrics: { disableClientMetrics: true } });
      if (AnamEvent) {
        client.addListener(AnamEvent.CONNECTION_CLOSED, (...args: unknown[]) => {
          avatarDebug("anam CONNECTION_CLOSED", args);
          if (!closed) events.emit("disconnected", "connection closed");
        });
        client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, (...args: unknown[]) => {
          avatarDebug("anam TALK_STREAM_INTERRUPTED", args);
          events.emit("idle");
        });
        if (avatarDebugOn()) {
          for (const name of ["CONNECTION_ESTABLISHED", "SESSION_READY", "VIDEO_PLAY_STARTED", "AUDIO_STREAM_STARTED", "SERVER_WARNING"]) {
            const ev = (AnamEvent as Record<string, string>)[name];
            if (ev) client.addListener(ev, (...args: unknown[]) => avatarDebug(`anam ${name}`, args.length ? args : undefined));
          }
        }
      }
      await client.streamToVideoElement(video.id);
      audioStream = client.createAgentAudioInputStream({ encoding: "pcm_s16le", sampleRate: info.inputSampleRate || 16000, channels: 1 });
      void playInline(video);
      await waitForFirstFrame(video, 30_000);
      stopWatch = watchAvatarAudio(video);
      events.emit("connected");
    },

    sendAudio(pcm24k: Uint8Array) {
      if (closed || !audioStream) return;
      const pcm16k = resampler.processBytes(pcm24k);
      if (pcm16k.length === 0) return;
      try {
        audioStream.sendAudioChunk(pcm16k);
        if (!sequenceOpen) { sequenceOpen = true; seqChunks = 0; seqBytes = 0; avatarDebug("anam seq start"); events.emit("speaking"); }
        seqChunks++;
        seqBytes += pcm16k.length;
      } catch (error) {
        avatarDebug("anam sendAudioChunk FAILED", String(error));
        events.emit("error", error);
      }
    },

    endOfSpeech() {
      if (closed || !audioStream || !sequenceOpen) return;
      avatarDebug("anam seq end", { chunks: seqChunks, audioMs: Math.round(seqBytes / 32) });
      try { audioStream.endSequence(); } catch { /* ignore */ }
      sequenceOpen = false;
      resampler.reset();
    },

    interrupt(reason?: string) {
      if (closed || !client) return;
      avatarDebug("anam INTERRUPT", { reason: reason || "unknown", seqOpen: sequenceOpen, sentAudioMs: Math.round(seqBytes / 32) });
      try { client.interruptPersona(); } catch { /* ignore */ }
      try { audioStream?.endSequence(); } catch { /* ignore */ }
      sequenceOpen = false;
      resampler.reset();
      events.emit("idle");
    },

    setMuted(muted: boolean) {
      if (videoEl) videoEl.muted = muted;
    },

    setVolume(volume: number) {
      if (videoEl) videoEl.volume = Math.max(0, Math.min(1, volume));
    },

    providerSessionId() {
      try { return client?.getActiveSessionId?.() || null; } catch { return null; }
    },

    on: (event, listener) => events.on(event, listener),

    async close() {
      if (closed) return;
      closed = true;
      stopWatch();
      try { await client?.stopStreaming?.(); } catch { /* ignore */ }
      client = null;
      audioStream = null;
      if (videoEl) {
        try { videoEl.pause(); videoEl.srcObject = null; } catch { /* ignore */ }
      }
      events.clear();
    },
  };
}
