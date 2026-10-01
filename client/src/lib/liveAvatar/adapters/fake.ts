/**
 * Fake avatar — DEVELOPMENT ONLY (the server only offers it when NODE_ENV=development
 * and AVATAR_FAKE_PROVIDER=1). Renders an animated placeholder face into the
 * <video> via canvas.captureStream(). Client route: plays the PCM it is fed
 * through Web Audio into the same stream (so the "avatar" is what you hear) and
 * moves the mouth with the audio level. Server route: silent, mouth follows the
 * server's speak events.
 */
import { Pcm16Decoder } from "../pcm";
import { AdapterEvents, playInline, waitForFirstFrame, type AvatarClientAdapter, type AvatarConnectionInfo } from "../types";

export function createFakeAdapter(): AvatarClientAdapter & { onServerEvent(event: string): void } {
  const events = new AdapterEvents();
  let videoEl: HTMLVideoElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let raf: number | null = null;
  let ctx: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let gain: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let nextTime = 0;
  let sources: AudioBufferSourceNode[] = [];
  let level = 0;
  let serverSpeaking = false;
  let closed = false;
  let dropTimer: ReturnType<typeof setTimeout> | null = null;
  let route: "server" | "client" = "client";
  const decoder = new Pcm16Decoder();

  const draw = () => {
    if (!canvas || closed) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    const t = performance.now() / 1000;
    if (analyser) {
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      level = level * 0.6 + Math.min(1, Math.sqrt(sum / data.length) * 6) * 0.4;
    } else {
      level = level * 0.7 + (serverSpeaking ? 0.4 + 0.4 * Math.abs(Math.sin(t * 11)) : 0) * 0.3;
    }
    const w = canvas.width, h = canvas.height;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#312e81");
    grad.addColorStop(1, "#7c3aed");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.46 + Math.sin(t * 1.3) * 4;
    g.fillStyle = "#fde68a";
    g.beginPath(); g.arc(cx, cy, w * 0.28, 0, Math.PI * 2); g.fill();
    const blink = (t % 4) < 0.12 ? 0.15 : 1;
    g.fillStyle = "#1f2937";
    for (const dx of [-0.1, 0.1]) {
      g.beginPath(); g.ellipse(cx + dx * w, cy - w * 0.06, w * 0.025, w * 0.035 * blink, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = "#9f1239";
    g.beginPath(); g.ellipse(cx, cy + w * 0.12, w * 0.09, Math.max(2, w * 0.07 * level), 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.font = `${Math.round(w * 0.045)}px sans-serif`;
    g.textAlign = "center";
    g.fillText("Fake avatar (dev)", cx, h - w * 0.06);
    raf = requestAnimationFrame(draw);
  };

  return {
    provider: "fake",
    audioRoute: "client",

    async connect(video: HTMLVideoElement, info: AvatarConnectionInfo): Promise<void> {
      videoEl = video;
      route = info.fake?.audioRoute || info.audioRoute || "client";
      (this as { audioRoute: string }).audioRoute = route;
      if (info.fake?.failConnect) {
        await new Promise((r) => setTimeout(r, 600));
        throw new Error("fake provider: simulated connect failure");
      }
      canvas = document.createElement("canvas");
      canvas.width = 360;
      canvas.height = 480;
      const stream: MediaStream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : new MediaStream();
      if (route === "client") {
        try {
          ctx = new AudioContext({ sampleRate: 24000 });
          dest = ctx.createMediaStreamDestination();
          gain = ctx.createGain();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          gain.connect(analyser);
          analyser.connect(dest);
          dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
          void ctx.resume();
        } catch (error) {
          console.warn("[FakeAvatar] audio setup failed", error);
        }
      }
      draw();
      video.srcObject = stream;
      void playInline(video);
      await waitForFirstFrame(video, 8_000);
      if (info.fake?.dropAfterSeconds) {
        dropTimer = setTimeout(() => { if (!closed) events.emit("disconnected", "fake drop"); }, info.fake.dropAfterSeconds * 1000);
      }
      events.emit("connected");
    },

    sendAudio(pcm24k: Uint8Array) {
      if (closed || !ctx || !gain) return;
      // Little-endian PCM16 @ 24 kHz; an odd byte split across chunks is carried over.
      const samples = decoder.push(pcm24k);
      if (samples.length === 0) return;
      const buffer = ctx.createBuffer(1, samples.length, 24000);
      buffer.getChannelData(0).set(samples);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      const at = Math.max(ctx.currentTime + 0.05, nextTime);
      src.start(at);
      nextTime = at + buffer.duration;
      sources.push(src);
      src.onended = () => { sources = sources.filter((s) => s !== src); if (!sources.length) events.emit("idle"); };
      events.emit("speaking");
    },

    endOfSpeech() { /* nothing buffered beyond what is scheduled */ },

    interrupt() {
      decoder.reset();
      for (const s of sources) { try { s.stop(); } catch { /* ignore */ } }
      sources = [];
      nextTime = 0;
      serverSpeaking = false;
      events.emit("idle");
    },

    onServerEvent(event: string) {
      if (event === "speak_started") { serverSpeaking = true; events.emit("speaking"); }
      if (event === "speak_ended" || event === "interrupted") { serverSpeaking = false; events.emit("idle"); }
    },

    setMuted(muted: boolean) {
      if (videoEl) videoEl.muted = muted;
    },

    setVolume(volume: number) {
      if (videoEl) videoEl.volume = Math.max(0, Math.min(1, volume));
    },

    providerSessionId: () => null,

    on: (event, listener) => events.on(event, listener),

    async close() {
      if (closed) return;
      closed = true;
      if (raf !== null) cancelAnimationFrame(raf);
      if (dropTimer) clearTimeout(dropTimer);
      for (const s of sources) { try { s.stop(); } catch { /* ignore */ } }
      sources = [];
      try { await ctx?.close(); } catch { /* ignore */ }
      if (videoEl) {
        try { videoEl.pause(); videoEl.srcObject = null; } catch { /* ignore */ }
      }
      events.clear();
    },
  };
}
