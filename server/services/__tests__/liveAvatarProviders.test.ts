/**
 * Live AI avatar provider adapters against FAKE provider servers (no network,
 * no database):
 *   - HeyGen LiveAvatar LITE: token/start/stop/keep-alive/credits HTTP shapes,
 *     WebSocket command frames (agent.speak base64 PCM16 24 kHz chunks,
 *     speak_end, interrupt, session.keep_alive), queueing until "connected",
 *     events, error mapping (auth/quota/unavailable/timeout/protocol)
 *   - Anam: session-token request shape (audio passthrough, no replay), token
 *     handling, stop by session id, key validation
 *   - fake provider, PCM chunker, key masking helpers
 *
 *   npx tsx server/services/__tests__/liveAvatarProviders.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-at-least-32-characters-long";
import http from "http";
import type { AddressInfo } from "net";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(5); }
  return fn();
}

interface Req { method: string; path: string; headers: http.IncomingHttpHeaders; body: any }
type Handler = (req: Req) => { status: number; body: any; delayMs?: number };

function fakeHttp(handler: Handler): Promise<{ base: string; requests: Req[]; close: () => void; setHandler: (h: Handler) => void }> {
  const requests: Req[] = [];
  let current = handler;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const r: Req = { method: req.method || "", path: req.url || "", headers: req.headers, body: raw ? JSON.parse(raw) : null };
      requests.push(r);
      const out = current(r);
      if (out.delayMs) await sleep(out.delayMs);
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(typeof out.body === "string" ? out.body : JSON.stringify(out.body));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as AddressInfo).port;
    resolve({ base: `http://127.0.0.1:${port}`, requests, close: () => server.close(), setHandler: (h) => { current = h; } });
  }));
}

function fakeWs(): Promise<{ url: string; frames: any[]; sockets: WsSocket[]; send: (msg: any) => void; close: () => void }> {
  const frames: any[] = [];
  const sockets: WsSocket[] = [];
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  wss.on("connection", (ws) => {
    sockets.push(ws);
    ws.on("message", (data) => frames.push(JSON.parse(String(data))));
  });
  return new Promise((resolve) => wss.on("listening", () => {
    const port = (wss.address() as AddressInfo).port;
    resolve({
      url: `ws://127.0.0.1:${port}/session-events?token=t`,
      frames,
      sockets,
      send: (msg) => sockets.forEach((s) => s.send(JSON.stringify(msg))),
      close: () => { sockets.forEach((s) => s.terminate()); wss.close(); },
    });
  }));
}

function pcm(bytes: number, seed = 1): Buffer {
  const b = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) b[i] = (i * 7 + seed) & 0xff;
  return b;
}

async function main() {
  const { createHeygenLiveAvatarProvider } = await import("../avatar/providers/heygenLiveAvatar");
  const { createAnamProvider } = await import("../avatar/providers/anam");
  const { createFakeAvatarProvider } = await import("../avatar/providers/fake");
  const { AvatarProviderError, mapHttpError } = await import("../avatar/types");
  const { Pcm16Chunker, bytesForMs } = await import("../avatar/pcm");
  const { maskKey, last4, normalizeApiKey, sealBusinessKey, openBusinessKey } = await import("../avatar/credentials");

  // ── PCM chunker ────────────────────────────────────────────────────────────
  {
    expect(bytesForMs(1000) === 48000 && bytesForMs(250) === 12000, "24 kHz PCM16: 1 s = 48000 bytes, 250 ms = 12000");
    const c = new Pcm16Chunker(10);
    const out = [...c.push(Buffer.from([1, 2, 3])), ...c.push(Buffer.from([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]))];
    expect(out.length === 2 && out.every((b) => b.length === 10) && out[0][0] === 1 && out[1][0] === 11, "chunker emits fixed-size chunks in order", out.map((b) => [...b]));
    const rest = c.flush();
    expect(rest?.length === 2 && rest[0] === 21, "flush returns the aligned remainder", rest && [...rest]);
    c.push(Buffer.from([1, 2, 3]));
    expect(c.flush()?.length === 2, "a trailing odd byte is dropped on flush");
    // Odd-length pushes keep byte order and sample alignment across calls.
    const src = pcm(10_001, 9);
    const cc = new Pcm16Chunker(1000);
    const got: Buffer[] = [];
    let at = 0;
    for (const n of [1, 3, 999, 2, 4001, 7, 4988]) { got.push(...cc.push(src.subarray(at, at + n))); at += n; }
    const tail = cc.flush();
    if (tail) got.push(tail);
    const joined = Buffer.concat(got);
    expect(joined.equals(src.subarray(0, 10_000)) && got.every((g) => g.length % 2 === 0), "odd-length pushes: output = input bytes in order, every chunk sample-aligned", { len: joined.length });
  }

  // ── key helpers ────────────────────────────────────────────────────────────
  {
    expect(maskKey(last4("sk_live_abcdef123456")) === "••••3456", "mask shows only the last 4 characters", maskKey(last4("sk_live_abcdef123456")));
    expect(last4("short") === "" && maskKey("") === "••••", "short keys reveal nothing");
    expect(normalizeApiKey("  abcdefgh12  ") === "abcdefgh12" && normalizeApiKey("abc") === null && normalizeApiKey("abc def ghi") === null && normalizeApiKey(42) === null, "key validation (length, no spaces, string)");
    const sealed = sealBusinessKey("hg_secret_key_9876", "u1");
    expect(!sealed.enc.includes("hg_secret_key_9876") && sealed.last4 === "9876" && openBusinessKey(sealed) === "hg_secret_key_9876", "business keys are encrypted at rest and decrypt back", { last4: sealed.last4 });
  }

  // ── error mapping ──────────────────────────────────────────────────────────
  {
    expect(mapHttpError("X", 401, "").code === "auth" && mapHttpError("X", 403, "").code === "auth", "401/403 → auth");
    expect(mapHttpError("X", 402, "").code === "quota" && mapHttpError("X", 400, "Insufficient credits").code === "quota", "402 / 'credits' → quota");
    expect(mapHttpError("X", 429, "").code === "rate_limited" && mapHttpError("X", 503, "").code === "provider_unavailable" && mapHttpError("X", 422, "").code === "bad_request", "429/5xx/422 mapping");
    expect(new AvatarProviderError("timeout", "t").retryable && !new AvatarProviderError("auth", "a").retryable, "retryable flag");
  }

  // ── HeyGen LiveAvatar LITE ─────────────────────────────────────────────────
  {
    const ws = await fakeWs();
    const api = await fakeHttp((r) => {
      if (r.path === "/v1/sessions/token") {
        if (r.headers["x-api-key"] !== "hg_platform_key_1") return { status: 401, body: { message: "bad key" } };
        return { status: 200, body: { code: 100, data: { session_id: "sess-1", session_token: "jwt-abc" }, message: "ok" } };
      }
      if (r.path === "/v1/sessions/start") {
        return { status: 201, body: { code: 1000, data: { session_id: "sess-1", livekit_url: "wss://lk.example", livekit_client_token: "lk-client-token", livekit_agent_token: "agent", max_session_duration: 660, ws_url: ws.url } } };
      }
      if (r.path === "/v1/sessions/stop") return { status: 200, body: { code: 100, data: null } };
      if (r.path === "/v1/users/credits") return r.headers["x-api-key"] === "hg_platform_key_1" ? { status: 200, body: { code: 100, data: { credits: 420 } } } : { status: 401, body: {} };
      return { status: 404, body: {} };
    });
    const provider = createHeygenLiveAvatarProvider({ apiBaseUrl: api.base, chunkMs: 250, flushIntervalMs: 40, keepAliveMs: 60 });
    const session = await provider.createSession({ apiKey: "hg_platform_key_1", avatarId: "avatar-123", providerOptions: { sandbox: true, videoQuality: "high" }, maxSessionSeconds: 660, sessionLabel: "ours-1" });
    const tokenReq = api.requests.find((r) => r.path === "/v1/sessions/token")!;
    expect(tokenReq.method === "POST" && tokenReq.headers["x-api-key"] === "hg_platform_key_1", "token request: POST with X-API-KEY");
    expect(tokenReq.body.mode === "LITE" && tokenReq.body.avatar_id === "avatar-123" && tokenReq.body.max_session_duration === 660 && tokenReq.body.is_sandbox === true && tokenReq.body.video_settings?.quality === "high", "token body: LITE mode, avatar_id, max_session_duration, sandbox, video settings", tokenReq.body);
    const startReq = api.requests.find((r) => r.path === "/v1/sessions/start")!;
    expect(startReq.headers.authorization === "Bearer jwt-abc" && !startReq.headers["x-api-key"], "start request uses the session token (Bearer), not the API key");
    expect(session.audioRoute === "server" && session.providerSessionId === "sess-1", "server audio route + provider session id");
    expect(session.client.livekitUrl === "wss://lk.example" && session.client.livekitToken === "lk-client-token", "browser gets only the LiveKit URL + client token");
    expect(!JSON.stringify(session.client).includes("hg_platform_key_1") && !JSON.stringify(session.client).includes("jwt-abc") && !JSON.stringify(session.client).includes(ws.url), "client info never contains the API key, session token or command socket URL");
    const events: string[] = [];
    session.onEvent((e) => events.push(e.type));
    await until(() => ws.sockets.length === 1);
    expect(ws.sockets.length === 1, "server opened the provider command WebSocket (ws_url)");

    // Audio before "connected" is queued, not sent.
    session.sendAudio!(pcm(30_000, 1));
    await sleep(80);
    expect(ws.frames.length === 0, "commands wait for session.state_updated=connected", ws.frames.length);
    ws.send({ type: "session.state_updated", state: "connected" });
    await until(() => events.includes("connected"));
    expect(events.includes("connected"), "connected event surfaced");
    await until(() => ws.frames.filter((f) => f.type === "agent.speak").length >= 3);
    session.sendAudio!(pcm(20_000, 2));
    session.endOfSpeech!();
    await until(() => ws.frames.some((f) => f.type === "agent.speak_end"));
    const speaks = ws.frames.filter((f) => f.type === "agent.speak");
    const decoded = Buffer.concat(speaks.map((f) => Buffer.from(f.audio, "base64")));
    const expected = Buffer.concat([pcm(30_000, 1), pcm(20_000, 2)]);
    expect(decoded.equals(expected), "agent.speak frames carry the exact PCM bytes, base64, in order", { got: decoded.length, want: expected.length });
    const sizes = speaks.map((f) => Buffer.from(f.audio, "base64").length);
    expect(sizes.every((n) => n <= 12000) && sizes.filter((n) => n === 12000).length === 3, "chunks are at most 250 ms (12000 bytes of 24 kHz PCM16); partial tails flushed on a timer", sizes);
    expect(speaks.every((f) => Buffer.from(f.audio, "base64").length % 2 === 0), "every chunk is sample-aligned");
    const end = ws.frames.find((f) => f.type === "agent.speak_end");
    const uttId = speaks[0].event_id;
    expect(!!uttId && speaks.every((f) => f.event_id === uttId) && end.event_id === uttId, "one event_id per utterance, shared by its speak_end", { uttId, end: end?.event_id });
    expect(ws.frames.indexOf(end) === ws.frames.length - 1 || ws.frames.slice(ws.frames.indexOf(end) + 1).every((f) => f.type === "session.keep_alive"), "speak_end comes after the last audio of the utterance");

    // A partial chunk is flushed after the flush interval.
    const before = ws.frames.filter((f) => f.type === "agent.speak").length;
    session.sendAudio!(pcm(1000, 3));
    await until(() => ws.frames.filter((f) => f.type === "agent.speak").length > before, 500);
    const partial = ws.frames.filter((f) => f.type === "agent.speak").slice(-1)[0];
    expect(Buffer.from(partial.audio, "base64").length === 1000 && partial.event_id !== uttId, "a short tail is sent after the flush interval, as a new utterance", { len: Buffer.from(partial.audio, "base64").length });

    // Interrupt: clears the buffer and sends agent.interrupt.
    session.sendAudio!(pcm(500, 4));
    session.interrupt!();
    await until(() => ws.frames.some((f) => f.type === "agent.interrupt"));
    await sleep(80);
    const afterInterrupt = ws.frames.slice(ws.frames.findIndex((f) => f.type === "agent.interrupt") + 1);
    expect(ws.frames.some((f) => f.type === "agent.interrupt" && f.event_id), "agent.interrupt sent with an event_id");
    expect(!afterInterrupt.some((f) => f.type === "agent.speak"), "buffered audio from the interrupted answer is dropped", afterInterrupt.map((f) => f.type));

    // Keep-alive heartbeat.
    await until(() => ws.frames.some((f) => f.type === "session.keep_alive"), 1000);
    expect(ws.frames.some((f) => f.type === "session.keep_alive"), "session.keep_alive sent on a timer");

    // Provider events.
    ws.send({ type: "agent.speak_started", event_id: "x" });
    ws.send({ type: "agent.speak_ended", event_id: "x" });
    await until(() => events.includes("speak_ended"));
    expect(events.includes("speak_started") && events.includes("speak_ended"), "speak_started / speak_ended events surfaced", events);
    expect(session.stats().interrupts === 1 && session.stats().utterances >= 2, "stats track utterances and interrupts", session.stats());

    // Key validation (cheap, no session).
    expect((await provider.validateKey("hg_platform_key_1")).detail === "credits: 420", "validateKey: GET /v1/users/credits");
    let bad: any = null;
    try { await provider.validateKey("wrong-key-123"); } catch (e) { bad = e; }
    expect(bad?.code === "auth", "validateKey with a bad key → auth error", bad?.code);

    // Close → stop request with mapped reason, socket closed.
    await session.close("idle_timeout");
    const stop = api.requests.find((r) => r.path === "/v1/sessions/stop");
    expect(stop?.headers["x-api-key"] === "hg_platform_key_1" && stop?.body.session_id === "sess-1" && stop?.body.reason === "IDLE_TIMEOUT", "close → POST /v1/sessions/stop {session_id, reason}", stop?.body);
    expect(session.sendAudio!(pcm(100)) === false, "a closed session refuses audio (caller falls back to local playback)");
    await until(() => ws.sockets[0].readyState === 3, 1000);
    expect(ws.sockets[0].readyState === 3, "command socket closed");

    // Server-side drop → disconnected event.
    const s2 = await provider.createSession({ apiKey: "hg_platform_key_1", avatarId: "avatar-123", providerOptions: {}, maxSessionSeconds: 60, sessionLabel: "ours-2" });
    const ev2: string[] = [];
    s2.onEvent((e) => ev2.push(e.type));
    await until(() => ws.sockets.length === 2);
    ws.sockets[1].close();
    await until(() => ev2.includes("disconnected"));
    expect(ev2.includes("disconnected"), "provider socket drop → disconnected event (manager falls back)");
    await s2.close("provider_disconnected");

    // Error mapping on creation.
    const tries: Array<[Handler, string, string]> = [
      [() => ({ status: 401, body: { message: "invalid api key" } }), "auth", "bad key → auth"],
      [() => ({ status: 402, body: { message: "Insufficient credits" } }), "quota", "no credits → quota"],
      [() => ({ status: 503, body: {} }), "provider_unavailable", "provider down → provider_unavailable"],
      [() => ({ status: 200, body: { code: 100, data: { session_id: "x", session_token: "t" } }, delayMs: 400 }), "timeout", "slow provider → timeout"],
    ];
    const strict = createHeygenLiveAvatarProvider({ apiBaseUrl: api.base, requestTimeoutMs: 200 });
    for (const [h, code, label] of tries) {
      api.setHandler(h);
      let err: any = null;
      try { await strict.createSession({ apiKey: "k_1234567890", avatarId: "a", providerOptions: {}, maxSessionSeconds: 60, sessionLabel: "x" }); } catch (e) { err = e; }
      expect(err instanceof AvatarProviderError && err.code === code, label, err?.code);
      expect(!String(err?.message || "").includes("k_1234567890"), `${label}: error message never contains the key`);
    }
    // start succeeds but no ws_url (FULL-mode token) → protocol error + session stopped.
    api.requests.length = 0;
    api.setHandler((r) => {
      if (r.path === "/v1/sessions/token") return { status: 200, body: { code: 100, data: { session_id: "full-1", session_token: "t" } } };
      if (r.path === "/v1/sessions/start") return { status: 200, body: { code: 100, data: { session_id: "full-1", livekit_url: "wss://lk", livekit_client_token: "c" } } };
      return { status: 200, body: { code: 100, data: null } };
    });
    let protoErr: any = null;
    try { await strict.createSession({ apiKey: "k_1234567890", avatarId: "a", providerOptions: {}, maxSessionSeconds: 60, sessionLabel: "x" }); } catch (e) { protoErr = e; }
    expect(protoErr?.code === "protocol" && api.requests.some((r) => r.path === "/v1/sessions/stop" && r.body.session_id === "full-1"), "start without ws_url → protocol error and the half-started session is stopped", protoErr?.code);
    api.close();
    ws.close();
  }

  // ── Anam ───────────────────────────────────────────────────────────────────
  {
    const api = await fakeHttp((r) => {
      if (r.path === "/v1/auth/session-token") {
        if (r.headers.authorization !== "Bearer anam_key_12345") return { status: 401, body: { error: "unauthorized" } };
        return { status: 200, body: { sessionToken: "anam-jwt-xyz" } };
      }
      if (r.path.startsWith("/v1/sessions/") && r.path.endsWith("/stop")) return { status: 200, body: {} };
      if (r.path === "/v1/sessions/concurrency") return r.headers.authorization === "Bearer anam_key_12345" ? { status: 200, body: { limit: 5, active: 1, canStartSession: true } } : { status: 401, body: {} };
      return { status: 404, body: {} };
    });
    const provider = createAnamProvider({ apiBaseUrl: api.base });
    const session = await provider.createSession({ apiKey: "anam_key_12345", avatarId: "anam-avatar-1", providerOptions: { avatarModel: "cara-4" }, maxSessionSeconds: 600, sessionLabel: "ours-3" });
    const req = api.requests[0];
    expect(req.path === "/v1/auth/session-token" && req.headers.authorization === "Bearer anam_key_12345", "session-token: POST with Bearer API key (server-side)");
    expect(req.body.personaConfig?.avatarId === "anam-avatar-1" && req.body.personaConfig?.enableAudioPassthrough === true && req.body.personaConfig?.avatarModel === "cara-4", "personaConfig: avatarId + enableAudioPassthrough + model", req.body.personaConfig);
    expect(req.body.sessionOptions?.sessionReplay?.enableSessionReplay === false, "no session replay recording (privacy)");
    expect(!("systemPrompt" in req.body.personaConfig) && !("llmId" in req.body.personaConfig), "no prompt / LLM sent — our pipeline is the brain");
    expect(session.audioRoute === "client" && session.client.sessionToken === "anam-jwt-xyz" && session.client.inputSampleRate === 16000, "client route: browser gets the session token and feeds 16 kHz PCM");
    expect(!JSON.stringify(session.client).includes("anam_key_12345"), "API key never in the client info");
    expect(session.sendAudio === undefined, "audio never passes through our server for Anam");
    session.setProviderSessionId!("bad id with spaces");
    expect(session.providerSessionId === null, "malformed provider session ids are ignored");
    session.setProviderSessionId!("anam-sess-42");
    await session.close("visitor_closed");
    expect(api.requests.some((r) => r.path === "/v1/sessions/anam-sess-42/stop" && r.headers.authorization === "Bearer anam_key_12345"), "close → POST /v1/sessions/{id}/stop (force-terminate a crashed tab's session)");
    const bad = await provider.createSession({ apiKey: "anam_key_12345", avatarId: "x", providerOptions: { avatarModel: "evil" }, maxSessionSeconds: 60, sessionLabel: "y" });
    expect(!("avatarModel" in api.requests[api.requests.length - 1].body.personaConfig), "unknown avatar models are not forwarded");
    await bad.close("visitor_closed");
    expect((await provider.validateKey("anam_key_12345")).detail === "concurrency 1/5", "validateKey: GET /v1/sessions/concurrency");
    let authErr: any = null;
    try { await provider.createSession({ apiKey: "wrong_key_123", avatarId: "x", providerOptions: {}, maxSessionSeconds: 60, sessionLabel: "z" }); } catch (e) { authErr = e; }
    expect(authErr?.code === "auth", "bad Anam key → auth error", authErr?.code);
    api.setHandler(() => ({ status: 200, body: {} }));
    let proto: any = null;
    try { await provider.createSession({ apiKey: "anam_key_12345", avatarId: "x", providerOptions: {}, maxSessionSeconds: 60, sessionLabel: "z" }); } catch (e) { proto = e; }
    expect(proto?.code === "protocol", "missing sessionToken → protocol error");
    api.close();
  }

  // ── fake provider ──────────────────────────────────────────────────────────
  {
    const fake = createFakeAvatarProvider({ audioRoute: "server" });
    const s = await fake.createSession({ apiKey: "fake_key_123", avatarId: "a", providerOptions: {}, maxSessionSeconds: 60, sessionLabel: "f" });
    const ev: string[] = [];
    s.onEvent((e) => ev.push(e.type));
    s.sendAudio!(pcm(4800));
    s.endOfSpeech!();
    s.interrupt!();
    await sleep(20);
    expect(fake.sessions[0].audio.length === 1 && fake.sessions[0].speakEnds === 1 && fake.sessions[0].interrupts === 1, "fake provider records audio / speak_end / interrupt");
    expect(ev.includes("connected") && ev.includes("speak_started"), "fake provider emits connected + speak_started", ev);
    let err: any = null;
    try { await fake.createSession({ apiKey: "k", avatarId: "fail", providerOptions: {}, maxSessionSeconds: 1, sessionLabel: "x" }); } catch (e) { err = e; }
    expect(err?.code === "provider_unavailable", "avatarId 'fail' simulates a provider failure");
    let keyErr: any = null;
    try { await fake.validateKey("an-invalid-key"); } catch (e) { keyErr = e; }
    expect(keyErr?.code === "auth", "fake validateKey rejects keys containing 'invalid'");
  }

  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nAll live avatar provider adapter checks passed.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
