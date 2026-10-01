/**
 * HeyGen LiveAvatar — LITE mode ("bring your own audio") adapter. SERVER route.
 *
 * Verified against docs.liveavatar.com (fetched 2026-10-02) and the official
 * `@heygen/liveavatar-web-sdk@0.0.19` source:
 *   1. POST {api}/v1/sessions/token   header X-API-KEY
 *        body { mode: "LITE", avatar_id, is_sandbox?, video_settings?, max_session_duration? }
 *        → { code, data: { session_id, session_token }, message }
 *   2. POST {api}/v1/sessions/start   header Authorization: Bearer <session_token>
 *        → { code, data: { session_id, livekit_url, livekit_client_token,
 *                          livekit_agent_token?, max_session_duration?, ws_url? } }
 *      ws_url is the per-session command socket ("Custom/LITE mode only").
 *   3. The browser joins the LiveKit room with livekit_url + livekit_client_token
 *      and watches the participant "heygen". Our API key never leaves the server.
 *   4. Over ws_url (JSON text frames ≤ 1 MB, one socket per session):
 *        { type: "agent.speak", event_id, audio: <base64 PCM16 24 kHz mono> }
 *        { type: "agent.speak_end", event_id }
 *        { type: "agent.interrupt", event_id }
 *        { type: "session.keep_alive", event_id }
 *      Server events: session.state_updated (new|connected|disconnected),
 *      agent.speak_started / agent.speak_ended / agent.speak_interrupted, error, warning.
 *      Commands are valid only after session.state_updated = connected.
 *      Idle timeout 5 min; keep_alive refreshes it.
 *   5. POST {api}/v1/sessions/stop   X-API-KEY  body { session_id, reason }
 *      reason ∈ UNKNOWN, USER_DISCONNECTED, SERVER_ERROR, IDLE_TIMEOUT, NO_CREDITS,
 *               USER_CLOSED, AVATAR_DELETED, MAX_DURATION_REACHED, …
 */
import { randomUUID } from "crypto";
import WebSocket from "ws";
import {
  AvatarProviderError,
  fetchWithTimeout,
  parseJson,
  type AvatarEndReason,
  type AvatarProvider,
  type CreateProviderSessionInput,
  type FetchLike,
  type ProviderEvent,
  type ProviderSession,
  type ProviderSessionStats,
} from "../types";
import { bytesForMs, Pcm16Chunker } from "../pcm";

export const HEYGEN_LIVEAVATAR_API = "https://api.liveavatar.com";

/** Minimal WebSocket surface (the `ws` package, or a fake in tests). */
export interface WsLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", fn: () => void): unknown;
  on(event: "message", fn: (data: unknown) => void): unknown;
  on(event: "close", fn: (code: number, reason: unknown) => void): unknown;
  on(event: "error", fn: (err: Error) => void): unknown;
}

export interface HeygenLiveAvatarOptions {
  apiBaseUrl?: string;
  fetch?: FetchLike;
  createSocket?: (url: string) => WsLike;
  /** Raw PCM per agent.speak frame. Docs suggest ~1 s; the SDK uses 20 ms. */
  chunkMs?: number;
  /** A partial chunk is sent after this long without more audio. */
  flushIntervalMs?: number;
  keepAliveMs?: number;
  requestTimeoutMs?: number;
  socketOpenTimeoutMs?: number;
  /** Audio kept while the avatar is not yet "connected" (older audio is dropped). */
  maxQueuedMs?: number;
}

const OPEN = 1;

/** Our end reasons → LiveAvatar stop reasons. */
const STOP_REASON: Partial<Record<AvatarEndReason, string>> = {
  visitor_closed: "USER_CLOSED",
  switched_to_text: "USER_CLOSED",
  idle_timeout: "IDLE_TIMEOUT",
  max_duration: "MAX_DURATION_REACHED",
  cap_reached: "MAX_DURATION_REACHED",
  voice_closed: "USER_DISCONNECTED",
  heartbeat_timeout: "USER_DISCONNECTED",
  connect_timeout: "USER_DISCONNECTED",
  connect_failed: "USER_DISCONNECTED",
  provider_disconnected: "SERVER_ERROR",
  provider_error: "SERVER_ERROR",
  server_shutdown: "UNKNOWN",
  server_restart: "UNKNOWN",
  disabled: "USER_CLOSED",
};

/** Docs example shows code 100, the official SDK checks 1000. Accept either (or none). */
// UNVERIFIED: which success `code` the live API returns (docs: 100, SDK: 1000).
function unwrap(provider: string, payload: any, step: string): any {
  const code = payload?.code;
  if (code !== undefined && code !== 100 && code !== 1000 && code !== 0) {
    throw new AvatarProviderError("protocol", `${provider} ${step} returned code ${code}: ${String(payload?.message || "").slice(0, 200)}`);
  }
  if (!payload?.data || typeof payload.data !== "object") {
    throw new AvatarProviderError("protocol", `${provider} ${step} returned no data`);
  }
  return payload.data;
}

function decodeMessage(data: unknown): any {
  try {
    const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

class HeygenSession implements ProviderSession {
  readonly audioRoute = "server" as const;
  private readonly listeners: Array<(e: ProviderEvent) => void> = [];
  private readonly chunker: Pcm16Chunker;
  private flushTimer: NodeJS.Timeout | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private utteranceId: string | null = null;
  private utteranceHasAudio = false;
  private connected = false;
  private closed = false;
  /** Commands waiting for session.state_updated=connected. */
  private pending: Array<{ frame: string; audioBytes: number }> = [];
  private pendingAudioBytes = 0;
  private readonly statsData: ProviderSessionStats = { audioBytesIn: 0, chunksSent: 0, utterances: 0, interrupts: 0, keepAlives: 0 };

  constructor(
    readonly providerSessionId: string,
    readonly client: ProviderSession["client"],
    private readonly socket: WsLike,
    private readonly apiKey: string,
    private readonly opts: Required<Pick<HeygenLiveAvatarOptions, "chunkMs" | "flushIntervalMs" | "keepAliveMs" | "requestTimeoutMs" | "maxQueuedMs">> & { apiBaseUrl: string; fetch: FetchLike },
  ) {
    this.chunker = new Pcm16Chunker(bytesForMs(opts.chunkMs));
    socket.on("message", (data) => this.handleMessage(data));
    socket.on("close", (code, reason) => {
      if (this.closed) return;
      this.closed = true;
      this.stopTimers();
      this.emit({ type: "disconnected", reason: `socket closed (${code}${reason ? ` ${String(reason)}` : ""})` });
    });
    socket.on("error", (err) => {
      if (this.closed) return;
      this.emit({ type: "error", code: "network", message: err?.message || "socket error", fatal: false });
    });
    this.keepAliveTimer = setInterval(() => this.keepAlive(), opts.keepAliveMs);
    this.keepAliveTimer.unref?.();
  }

  onEvent(listener: (event: ProviderEvent) => void): void {
    this.listeners.push(listener);
  }

  stats(): ProviderSessionStats {
    return { ...this.statsData };
  }

  private emit(event: ProviderEvent): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* listener errors never break the session */ }
    }
  }

  private handleMessage(data: unknown): void {
    const msg = decodeMessage(data);
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "session.state_updated": {
        // UNVERIFIED: exact field carrying the state (docs list the values only).
        const state = String(msg.state ?? msg.data?.state ?? msg.session_state ?? "").toLowerCase();
        if (state === "connected" && !this.connected) {
          this.connected = true;
          this.emit({ type: "connected" });
          this.flushPending();
        } else if (state === "disconnected") {
          this.emit({ type: "disconnected", reason: "provider reported disconnected" });
        }
        break;
      }
      case "agent.speak_started":
        this.emit({ type: "speak_started" });
        break;
      case "agent.speak_ended":
        this.emit({ type: "speak_ended" });
        break;
      case "agent.speak_interrupted":
        this.emit({ type: "interrupted" });
        break;
      case "warning":
        this.emit({ type: "warning", message: String(msg.message ?? msg.data?.message ?? "warning").slice(0, 200) });
        break;
      case "error":
        this.emit({ type: "error", code: "protocol", message: String(msg.message ?? msg.data?.message ?? msg.error ?? "error").slice(0, 200), fatal: false });
        break;
      default:
        break;
    }
  }

  private rawSend(frame: string): boolean {
    if (this.socket.readyState !== OPEN) return false;
    try {
      this.socket.send(frame);
      return true;
    } catch {
      return false;
    }
  }

  /** Send now when connected, else queue (bounded). */
  private sendCommand(command: Record<string, unknown>, audioBytes = 0): void {
    const frame = JSON.stringify(command);
    if (this.connected) {
      this.rawSend(frame);
      return;
    }
    this.pending.push({ frame, audioBytes });
    this.pendingAudioBytes += audioBytes;
    const maxBytes = bytesForMs(this.opts.maxQueuedMs);
    while (this.pendingAudioBytes > maxBytes && this.pending.length > 0) {
      const dropped = this.pending.shift()!;
      this.pendingAudioBytes -= dropped.audioBytes;
    }
  }

  private flushPending(): void {
    const queue = this.pending;
    this.pending = [];
    this.pendingAudioBytes = 0;
    for (const item of queue) this.rawSend(item.frame);
  }

  private ensureUtterance(): string {
    if (!this.utteranceId) {
      this.utteranceId = randomUUID();
      this.utteranceHasAudio = false;
      this.statsData.utterances++;
    }
    return this.utteranceId;
  }

  private sendChunk(chunk: Buffer): void {
    const eventId = this.ensureUtterance();
    this.utteranceHasAudio = true;
    this.statsData.chunksSent++;
    this.sendCommand({ type: "agent.speak", event_id: eventId, audio: chunk.toString("base64") }, chunk.length);
  }

  sendAudio(pcm24k: Buffer): boolean {
    if (this.closed || this.socket.readyState !== OPEN) return false;
    if (!pcm24k || pcm24k.length === 0) return true;
    this.statsData.audioBytesIn += pcm24k.length;
    this.ensureUtterance();
    for (const chunk of this.chunker.push(pcm24k)) this.sendChunk(chunk);
    if (this.chunker.buffered > 0 && !this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const rest = this.chunker.flush();
        if (rest) this.sendChunk(rest);
      }, this.opts.flushIntervalMs);
      this.flushTimer.unref?.();
    }
    return true;
  }

  endOfSpeech(): void {
    if (this.closed) return;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    const rest = this.chunker.flush();
    if (rest) this.sendChunk(rest);
    if (this.utteranceId && this.utteranceHasAudio) {
      this.sendCommand({ type: "agent.speak_end", event_id: this.utteranceId });
    }
    this.utteranceId = null;
    this.utteranceHasAudio = false;
  }

  interrupt(): void {
    if (this.closed) return;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.chunker.clear();
    // Audio still waiting for "connected" belongs to the interrupted answer.
    this.pending = this.pending.filter((p) => p.audioBytes === 0 && !p.frame.includes('"agent.speak_end"'));
    this.pendingAudioBytes = 0;
    this.utteranceId = null;
    this.utteranceHasAudio = false;
    this.statsData.interrupts++;
    this.sendCommand({ type: "agent.interrupt", event_id: randomUUID() });
  }

  keepAlive(): void {
    if (this.closed) return;
    this.statsData.keepAlives++;
    // keep_alive is a no-reply heartbeat; only meaningful once connected.
    if (this.connected) this.rawSend(JSON.stringify({ type: "session.keep_alive", event_id: randomUUID() }));
  }

  private stopTimers(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.keepAliveTimer) { clearInterval(this.keepAliveTimer); this.keepAliveTimer = null; }
  }

  async close(reason: AvatarEndReason): Promise<void> {
    const wasClosed = this.closed;
    this.closed = true;
    this.stopTimers();
    this.chunker.clear();
    this.pending = [];
    try {
      if (this.socket.readyState === OPEN || this.socket.readyState === 0) this.socket.close(1000, "session ended");
    } catch { /* ignore */ }
    if (wasClosed && reason === "provider_disconnected") return;
    await stopHeygenSession(this.opts.fetch, this.opts.apiBaseUrl, this.apiKey, this.providerSessionId, reason, this.opts.requestTimeoutMs);
  }
}

async function stopHeygenSession(fetchImpl: FetchLike, base: string, apiKey: string, sessionId: string, reason: AvatarEndReason, timeoutMs: number): Promise<void> {
  await fetchWithTimeout(fetchImpl, "LiveAvatar", `${base}/v1/sessions/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ session_id: sessionId, reason: STOP_REASON[reason] || "UNKNOWN" }),
  }, timeoutMs);
}

export function createHeygenLiveAvatarProvider(options: HeygenLiveAvatarOptions = {}): AvatarProvider {
  const base = (options.apiBaseUrl || process.env.HEYGEN_LIVEAVATAR_API_URL || HEYGEN_LIVEAVATAR_API).replace(/\/+$/, "");
  const fetchImpl: FetchLike = options.fetch || ((url, init) => fetch(url, init as RequestInit) as any);
  const createSocket = options.createSocket || ((url: string) => new WebSocket(url) as unknown as WsLike);
  const cfg = {
    chunkMs: options.chunkMs ?? 250,
    flushIntervalMs: options.flushIntervalMs ?? 120,
    keepAliveMs: options.keepAliveMs ?? 60_000,
    requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
    maxQueuedMs: options.maxQueuedMs ?? 30_000,
    apiBaseUrl: base,
    fetch: fetchImpl,
  };
  const socketOpenTimeoutMs = options.socketOpenTimeoutMs ?? 8_000;

  return {
    id: "heygen_liveavatar",
    audioRoute: "server",
    connectTimeoutMs: 8_000,

    async createSession(input: CreateProviderSessionInput): Promise<ProviderSession> {
      const opts = input.providerOptions || {};
      const tokenBody: Record<string, unknown> = {
        mode: "LITE",
        avatar_id: input.avatarId,
      };
      if (opts.sandbox === true) tokenBody.is_sandbox = true;
      if (typeof opts.videoQuality === "string") tokenBody.video_settings = { quality: opts.videoQuality, encoding: "H264" };
      // UNVERIFIED: max_session_duration is documented as an integer; we assume seconds.
      if (input.maxSessionSeconds > 0) tokenBody.max_session_duration = Math.ceil(input.maxSessionSeconds);

      const tokenRes = await fetchWithTimeout(fetchImpl, "LiveAvatar", `${base}/v1/sessions/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": input.apiKey },
        body: JSON.stringify(tokenBody),
      }, cfg.requestTimeoutMs);
      const token = unwrap("LiveAvatar", parseJson("LiveAvatar", tokenRes.text), "token");
      const sessionToken = typeof token.session_token === "string" ? token.session_token : "";
      if (!sessionToken) throw new AvatarProviderError("protocol", "LiveAvatar token response had no session_token");

      let started: any;
      try {
        const startRes = await fetchWithTimeout(fetchImpl, "LiveAvatar", `${base}/v1/sessions/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        }, cfg.requestTimeoutMs);
        started = unwrap("LiveAvatar", parseJson("LiveAvatar", startRes.text), "start");
      } catch (error) {
        // The token is single-use and expires; nothing to clean up yet.
        throw error;
      }
      const sessionId = String(started.session_id || token.session_id || "");
      const livekitUrl = typeof started.livekit_url === "string" ? started.livekit_url : "";
      const livekitToken = typeof started.livekit_client_token === "string" ? started.livekit_client_token : "";
      const wsUrl = typeof started.ws_url === "string" ? started.ws_url : "";
      const stopQuietly = () => stopHeygenSession(fetchImpl, base, input.apiKey, sessionId, "provider_error", cfg.requestTimeoutMs).catch(() => undefined);
      if (!sessionId || !livekitUrl || !livekitToken || !wsUrl) {
        if (sessionId) await stopQuietly();
        throw new AvatarProviderError("protocol", "LiveAvatar start response missing session_id/livekit_url/livekit_client_token/ws_url (is the token in LITE mode?)");
      }

      const socket = createSocket(wsUrl);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new AvatarProviderError("timeout", `LiveAvatar command socket did not open within ${socketOpenTimeoutMs}ms`)), socketOpenTimeoutMs);
          socket.on("open", () => { clearTimeout(timer); resolve(); });
          socket.on("error", (err) => { clearTimeout(timer); reject(new AvatarProviderError("network", `LiveAvatar command socket error: ${err?.message || err}`)); });
          socket.on("close", (code) => { clearTimeout(timer); reject(new AvatarProviderError("network", `LiveAvatar command socket closed before open (${code})`)); });
        });
      } catch (error) {
        try { socket.close(); } catch { /* ignore */ }
        await stopQuietly();
        throw error;
      }

      return new HeygenSession(sessionId, {
        provider: "heygen_liveavatar",
        audioRoute: "server",
        livekitUrl,
        livekitToken,
      }, socket, input.apiKey, cfg);
    },

    async stopSession(apiKey: string, providerSessionId: string, reason: AvatarEndReason): Promise<void> {
      await stopHeygenSession(fetchImpl, base, apiKey, providerSessionId, reason, cfg.requestTimeoutMs);
    },

    // GET /v1/users/credits (X-API-KEY) — listed in the LiveAvatar OpenAPI spec as an
    // API-key endpoint; no session is created, nothing is billed.
    // UNVERIFIED: response body shape (we only rely on the HTTP status).
    async validateKey(apiKey: string): Promise<{ detail?: string }> {
      const res = await fetchWithTimeout(fetchImpl, "LiveAvatar", `${base}/v1/users/credits`, {
        method: "GET",
        headers: { "X-API-KEY": apiKey },
      }, cfg.requestTimeoutMs);
      let detail: string | undefined;
      try {
        const body = JSON.parse(res.text || "{}");
        const data = body?.data ?? body;
        const credits = data?.credits ?? data?.remaining_credits ?? data?.balance;
        if (credits !== undefined && credits !== null) detail = `credits: ${String(credits).slice(0, 20)}`;
      } catch { /* status is what matters */ }
      return { detail };
    },
  };
}
