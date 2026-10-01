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

export function createAnamAdapter(): AvatarClientAdapter {
  const events = new AdapterEvents();
  let client: any = null;
  let audioStream: any = null;
  let videoEl: HTMLVideoElement | null = null;
  let resampler = new Pcm16Resampler(24000, 16000);
  let closed = false;
  let sequenceOpen = false;

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
        client.addListener(AnamEvent.CONNECTION_CLOSED, () => { if (!closed) events.emit("disconnected", "connection closed"); });
        client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, () => events.emit("idle"));
      }
      await client.streamToVideoElement(video.id);
      audioStream = client.createAgentAudioInputStream({ encoding: "pcm_s16le", sampleRate: info.inputSampleRate || 16000, channels: 1 });
      void playInline(video);
      await waitForFirstFrame(video, 30_000);
      events.emit("connected");
    },

    sendAudio(pcm24k: Uint8Array) {
      if (closed || !audioStream) return;
      const pcm16k = resampler.processBytes(pcm24k);
      if (pcm16k.length === 0) return;
      try {
        audioStream.sendAudioChunk(pcm16k);
        if (!sequenceOpen) { sequenceOpen = true; events.emit("speaking"); }
      } catch (error) {
        events.emit("error", error);
      }
    },

    endOfSpeech() {
      if (closed || !audioStream || !sequenceOpen) return;
      try { audioStream.endSequence(); } catch { /* ignore */ }
      sequenceOpen = false;
      resampler.reset();
    },

    interrupt() {
      if (closed || !client) return;
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
