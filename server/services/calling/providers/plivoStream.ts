/**
 * Plivo audio stream ⇄ Exotel AgentStream translation.
 *
 * The call engine (mediaStream.ts) speaks Exotel's AgentStream protocol with PCM16LE audio.
 * PlivoStreamSocket wraps Plivo's media WebSocket and translates both ways, so a Plivo call
 * runs through the exact same, tested call engine:
 *
 *   Plivo → us                                     handed to the engine as
 *   start { start: { callId, streamId, mediaFormat } }  start { stream_sid, start: { call_sid, from, to, media_format } }
 *   media { media: { payload (μ-law) } }               media { media: { payload (PCM16LE) } }
 *   playedStream { name }                              mark { mark: { name } }
 *   dtmf { dtmf: { digit } }                           dtmf
 *
 *   engine → Plivo
 *   media { payload (PCM16LE) }                        playAudio { media: { contentType, sampleRate, payload (μ-law) } }
 *   mark { name }                                      checkpoint { streamId, name }
 *   clear                                              clearAudio { streamId }
 *
 * Plivo's start event has no caller / called number, so the inbound answer URL passes them
 * (signed) in the stream URL and they are added to the translated start event here.
 */
import type { StreamSocket } from "../mediaStream";

// ── G.711 μ-law ──────────────────────────────────────────────────────────────

const ULAW_BIAS = 0x84;
const ULAW_CLIP = 32635;

const ULAW_DECODE = (() => {
  const t = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    let sample = ((u & 0x0f) << 3) + ULAW_BIAS;
    sample <<= (u & 0x70) >> 4;
    t[i] = u & 0x80 ? ULAW_BIAS - sample : sample - ULAW_BIAS;
  }
  return t;
})();

function linearToUlaw(sample: number): number {
  let s = sample;
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > ULAW_CLIP) s = ULAW_CLIP;
  s += ULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1) { /* find the segment */ }
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** μ-law bytes → PCM16LE (2 bytes per sample). */
export function mulawToPcm16(ulaw: Buffer): Buffer {
  const out = Buffer.alloc(ulaw.length * 2);
  for (let i = 0; i < ulaw.length; i++) out.writeInt16LE(ULAW_DECODE[ulaw[i]], i * 2);
  return out;
}

/** PCM16LE → μ-law bytes (a trailing odd byte is ignored). */
export function pcm16ToMulaw(pcm: Buffer): Buffer {
  const n = Math.floor(pcm.length / 2);
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) out[i] = linearToUlaw(pcm.readInt16LE(i * 2));
  return out;
}

// ── translation ──────────────────────────────────────────────────────────────

export interface PlivoStreamMeta {
  /** CallUUID from the answer request (Plivo's start event also carries it as callId). */
  callUuid?: string | null;
  from?: string | null;
  to?: string | null;
}

type Listener = (...args: any[]) => void;

/** "a=1;b=2" (Stream extraHeaders) → { a: "1", b: "2" }. */
function parseExtraHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== "string") return out;
  for (const part of raw.split(/[;,]/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export class PlivoStreamSocket implements StreamSocket {
  private streamId: string | null = null;
  private encoding: "mulaw" | "l16" = "mulaw";
  private sampleRate = 8000;
  private readonly listeners: Record<"message" | "close" | "error", Listener[]> = { message: [], close: [], error: [] };

  constructor(private readonly ws: StreamSocket, private readonly meta: PlivoStreamMeta = {}) {
    ws.on("message", (data: any, isBinary: boolean) => {
      if (isBinary) return;
      const translated = this.fromPlivo(String(data));
      if (!translated) return;
      const text = JSON.stringify(translated);
      for (const l of this.listeners.message) l(text, false);
    });
    ws.on("close", (code: number, reason: Buffer) => { for (const l of this.listeners.close) l(code, reason); });
    ws.on("error", (err: Error) => { for (const l of this.listeners.error) l(err); });
  }

  get readyState(): number {
    return this.ws.readyState;
  }

  on(event: "message" | "close" | "error", listener: Listener): this {
    this.listeners[event]?.push(listener);
    return this;
  }

  send(data: string): void {
    const translated = this.toPlivo(data);
    if (translated) this.ws.send(JSON.stringify(translated));
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  /** One Plivo event → the AgentStream event the engine expects (null = nothing to pass on). */
  fromPlivo(raw: string): Record<string, unknown> | null {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return null; }
    switch (msg?.event) {
      case "start": {
        const start = msg.start || {};
        this.streamId = String(start.streamId || msg.streamId || "") || null;
        const encoding = String(start.mediaFormat?.encoding || "").toLowerCase();
        this.encoding = encoding.includes("l16") ? "l16" : "mulaw";
        const rate = Number(start.mediaFormat?.sampleRate);
        this.sampleRate = rate === 16000 ? 16000 : 8000;
        if (this.encoding === "mulaw") this.sampleRate = 8000;
        return {
          event: "start",
          stream_sid: this.streamId,
          start: {
            stream_sid: this.streamId,
            call_sid: String(start.callId || this.meta.callUuid || "") || null,
            account_sid: start.accountId ?? null,
            from: this.meta.from ?? null,
            to: this.meta.to ?? null,
            custom_parameters: parseExtraHeaders(msg.extra_headers),
            media_format: { encoding: "audio/x-raw", sample_rate: String(this.sampleRate), bit_rate: "16" },
          },
        };
      }
      case "media": {
        const track = msg.media?.track;
        if (track && track !== "inbound") return null;
        const payload = msg.media?.payload;
        if (typeof payload !== "string" || !payload) return null;
        const bytes = Buffer.from(payload, "base64");
        const pcm = this.encoding === "mulaw" ? mulawToPcm16(bytes) : bytes;
        return { event: "media", stream_sid: this.streamId, media: { payload: pcm.toString("base64") } };
      }
      case "playedStream":
      case "played": {
        const name = String(msg.name ?? msg.checkpoint?.name ?? "");
        return name ? { event: "mark", stream_sid: this.streamId, mark: { name } } : null;
      }
      case "dtmf":
        return { event: "dtmf", stream_sid: this.streamId, dtmf: { digit: String(msg.dtmf?.digit ?? "") } };
      case "stop":
        return { event: "stop", stream_sid: this.streamId, stop: { reason: "callended" } };
      default:
        return null; // clearedAudio, …
    }
  }

  /** One AgentStream event from the engine → the Plivo message (null = nothing to send). */
  toPlivo(raw: string): Record<string, unknown> | null {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return null; }
    if (!this.streamId) return null;
    switch (msg?.event) {
      case "media": {
        const payload = msg.media?.payload;
        if (typeof payload !== "string" || !payload) return null;
        const pcm = Buffer.from(payload, "base64");
        const audio = this.encoding === "mulaw" ? pcm16ToMulaw(pcm) : pcm;
        return {
          event: "playAudio",
          media: {
            contentType: this.encoding === "mulaw" ? "audio/x-mulaw" : "audio/x-l16",
            sampleRate: this.sampleRate,
            payload: audio.toString("base64"),
          },
        };
      }
      case "mark": {
        const name = String(msg.mark?.name || "");
        return name ? { event: "checkpoint", streamId: this.streamId, name } : null;
      }
      case "clear":
        return { event: "clearAudio", streamId: this.streamId };
      default:
        return null;
    }
  }
}
