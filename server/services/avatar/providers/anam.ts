/**
 * Anam — audio passthrough adapter. CLIENT route.
 *
 * Verified against anam.ai/docs (fetched 2026-10-02) and `@anam-ai/js-sdk@4.27.1` types:
 *   POST https://api.anam.ai/v1/auth/session-token   Authorization: Bearer <API key>
 *     body { clientLabel?, personaConfig: { avatarId, avatarModel?, enableAudioPassthrough: true },
 *            sessionOptions?: { sessionReplay: { enableSessionReplay } } }
 *     → { sessionToken }   (signed JWT, valid 1 h, bound to this config)
 *   Browser: createClient(sessionToken, { disableInputAudio: true })
 *            → streamToVideoElement(id)
 *            → createAgentAudioInputStream({ encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 })
 *            → sendAudioChunk(base64 | bytes) … endSequence(); interruptPersona() on barge-in.
 *   POST https://api.anam.ai/v1/sessions/{id}/stop  Authorization: Bearer <API key>  (force-terminate)
 *   GET  https://api.anam.ai/v1/sessions/concurrency Authorization: Bearer <API key>  (key check)
 *
 * The audio itself never touches this server: our voice WebSocket already
 * streams the TTS PCM to the browser, which feeds the SDK instead of playing it.
 */
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
} from "../types";

export const ANAM_API = "https://api.anam.ai";
export const ANAM_AVATAR_MODELS = ["cara-3", "cara-4", "cara-4-latest"] as const;

export interface AnamOptions {
  apiBaseUrl?: string;
  fetch?: FetchLike;
  requestTimeoutMs?: number;
}

async function stopAnamSession(fetchImpl: FetchLike, base: string, apiKey: string, sessionId: string, timeoutMs: number): Promise<void> {
  await fetchWithTimeout(fetchImpl, "Anam", `${base}/v1/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  }, timeoutMs);
}

export function createAnamProvider(options: AnamOptions = {}): AvatarProvider {
  const base = (options.apiBaseUrl || process.env.ANAM_API_URL || ANAM_API).replace(/\/+$/, "");
  const fetchImpl: FetchLike = options.fetch || ((url, init) => fetch(url, init as RequestInit) as any);
  const timeoutMs = options.requestTimeoutMs ?? 10_000;

  return {
    id: "anam",
    audioRoute: "client",
    // Anam: "connection setup usually 4-5 seconds, but can be up to 10".
    connectTimeoutMs: 10_000,

    async createSession(input: CreateProviderSessionInput): Promise<ProviderSession> {
      const opts = input.providerOptions || {};
      const personaConfig: Record<string, unknown> = {
        avatarId: input.avatarId,
        enableAudioPassthrough: true,
      };
      if (typeof opts.avatarModel === "string" && (ANAM_AVATAR_MODELS as readonly string[]).includes(opts.avatarModel)) {
        personaConfig.avatarModel = opts.avatarModel;
      }
      const body: Record<string, unknown> = {
        clientLabel: `chroney-${input.sessionLabel}`.slice(0, 64),
        personaConfig,
        // Privacy: no session replay recordings — the provider only needs the audio.
        // UNVERIFIED: nested shape sessionOptions.sessionReplay.enableSessionReplay (docs summary).
        sessionOptions: { sessionReplay: { enableSessionReplay: false } },
      };
      // NOTE: maxSessionLengthSeconds is documented only for ephemeral personas,
      // not for the audio-passthrough config, so our own watchdog enforces the cap.
      const res = await fetchWithTimeout(fetchImpl, "Anam", `${base}/v1/auth/session-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
        body: JSON.stringify(body),
      }, timeoutMs);
      const payload = parseJson("Anam", res.text);
      const sessionToken = typeof payload?.sessionToken === "string" ? payload.sessionToken : "";
      if (!sessionToken) throw new AvatarProviderError("protocol", "Anam session-token response had no sessionToken");

      const listeners: Array<(e: ProviderEvent) => void> = [];
      let providerSessionId: string | null = null;
      let closed = false;
      return {
        get providerSessionId() { return providerSessionId; },
        audioRoute: "client",
        client: { provider: "anam", audioRoute: "client", sessionToken, inputSampleRate: 16000 },
        setProviderSessionId(id: string) {
          if (!providerSessionId && typeof id === "string" && /^[A-Za-z0-9_-]{4,128}$/.test(id)) providerSessionId = id;
        },
        onEvent(listener) { listeners.push(listener); },
        stats() { return { audioBytesIn: 0, chunksSent: 0, utterances: 0, interrupts: 0, keepAlives: 0 }; },
        async close(_reason: AvatarEndReason) {
          if (closed) return;
          closed = true;
          // The browser normally stops streaming itself; force-stop server-side too
          // so a crashed tab can't keep a billed session alive.
          if (providerSessionId) await stopAnamSession(fetchImpl, base, input.apiKey, providerSessionId, timeoutMs);
        },
      } as ProviderSession;
    },

    async stopSession(apiKey: string, providerSessionId: string): Promise<void> {
      await stopAnamSession(fetchImpl, base, apiKey, providerSessionId, timeoutMs);
    },

    // GET /v1/avatars/{id} (Bearer) → { id, displayName, variantName, … } (Anam API reference).
    // That lookup may not resolve every avatar a session accepts (e.g. stock gallery avatars), so a
    // 404/400 falls back to the avatar list (stock + the organisation's own, per Anam's reference)
    // before we call an id "not found".
    async lookupAvatar(apiKey: string, avatarId: string) {
      const nameOf = (a: any): string | undefined => {
        const parts = [a?.displayName, a?.variantName].filter((v: unknown) => typeof v === "string" && v);
        return parts.length ? parts.join(" · ").slice(0, 120) : undefined;
      };
      try {
        const res = await fetchWithTimeout(fetchImpl, "Anam", `${base}/v1/avatars/${encodeURIComponent(avatarId)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        }, timeoutMs);
        let name: string | undefined;
        try { name = nameOf(JSON.parse(res.text || "{}")); } catch { /* found is what matters */ }
        return { found: true as const, name };
      } catch (error) {
        if (!(error instanceof AvatarProviderError && (error.code === "not_found" || error.code === "bad_request"))) throw error;
      }
      // A persona id (Anam Lab shows those prominently): use the persona's avatar.
      try {
        const res = await fetchWithTimeout(fetchImpl, "Anam", `${base}/v1/personas/${encodeURIComponent(avatarId)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        }, timeoutMs);
        const persona = JSON.parse(res.text || "{}");
        const resolved = typeof persona?.avatar?.id === "string" ? persona.avatar.id : "";
        if (resolved && /^[A-Za-z0-9_.:-]{1,200}$/.test(resolved)) {
          const avatarName = nameOf(persona.avatar);
          const personaName = typeof persona?.name === "string" ? persona.name.slice(0, 80) : "";
          return {
            found: true as const,
            name: [avatarName, personaName ? `from persona "${personaName}"` : "from a persona"].filter(Boolean).join(" "),
            resolvedAvatarId: resolved,
            resolvedFrom: "persona" as const,
            avatarModel: typeof persona?.avatarModel === "string" ? persona.avatarModel : null,
          };
        }
      } catch (error) {
        if (!(error instanceof AvatarProviderError && (error.code === "not_found" || error.code === "bad_request" || error.code === "protocol"))) throw error;
      }
      const wanted = avatarId.toLowerCase();
      for (let page = 1; page <= 10; page++) {
        const res = await fetchWithTimeout(fetchImpl, "Anam", `${base}/v1/avatars?page=${page}&perPage=100`, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        }, timeoutMs);
        let body: any;
        try { body = JSON.parse(res.text || "{}"); } catch { break; }
        const items: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
        const hit = items.find((a) => String(a?.id || "").toLowerCase() === wanted);
        if (hit) return { found: true as const, name: nameOf(hit) };
        const lastPage = Number(body?.meta?.lastPage);
        if (!items.length || (Number.isFinite(lastPage) && page >= lastPage)) break;
      }
      return { found: false as const };
    },

    async validateKey(apiKey: string): Promise<{ detail?: string }> {
      const res = await fetchWithTimeout(fetchImpl, "Anam", `${base}/v1/sessions/concurrency`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      }, timeoutMs);
      try {
        const body = JSON.parse(res.text || "{}");
        if (typeof body?.limit === "number") return { detail: `concurrency ${body.active ?? "?"}/${body.limit}` };
      } catch { /* status is what matters */ }
      return {};
    },
  };
}
