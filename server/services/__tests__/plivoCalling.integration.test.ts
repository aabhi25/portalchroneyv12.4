/**
 * AI Calling — Plivo provider (integration, PGlite).
 *
 * Covers: μ-law codec; the Plivo ⇄ AgentStream translator (start / media / playedStream in,
 * playAudio / checkpoint / clearAudio out); status webhook parsing; call XML; X-Plivo-Signature-V3
 * (the string Plivo signs, valid / wrong token / tampered / comma list); plain-language errors;
 * the provider against a FAKE fetch (verify, place call, hang up, transfer, recording, recording
 * host guard); settings (save, mask, validation, verified reset, answer link); the dialer placing
 * a Plivo call (answer / ring / hangup links, caller id, request uuid); the HTTP instructions
 * (answer, inbound, transfer, minutes used up, signature enforcement) and the status webhook;
 * full calls on a CallMediaSession through PlivoStreamSocket (outbound + inbound: call row,
 * μ-law audio both ways, checkpoints, recording, hang-up and transfer through the API); and
 * the media upgrade endpoints over a real server.
 *
 * No network, no real call, no Plivo. DESTRUCTIVE: creates rows — refuses to run unless
 * AI_CALLING_TEST_DB=1 and DATABASE_URL points at localhost.
 */
import http from "http";
import crypto from "crypto";
import type { AddressInfo } from "net";

const dbUrl = process.env.DATABASE_URL || "";
if (process.env.AI_CALLING_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl)) {
  console.error("Skipping: set AI_CALLING_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(0);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-0123456789abcdef";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-at-least-32-characters-long";
delete process.env.CALLING_SIGNING_SECRET;
delete process.env.PLIVO_SIGNATURE_ENFORCE;
delete process.env.PLIVO_API_BASE;
process.env.PUBLIC_BASE_URL = "https://portal.example.com";

const out = console.log.bind(console);
const outErr = console.error.bind(console);
if (process.env.CALLING_TEST_VERBOSE !== "1") {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}
let failed = 0;
let passed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (!cond) { failed++; outErr(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); }
  else { passed++; out(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean | Promise<boolean>, ms = 4000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(10); }
  return fn();
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

class ManualClock {
  t = 1_800_000_000_000;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => { const id = ++this.seq; this.timers.set(id, { at: this.t + ms, fn }); return id; };
  setInterval = (fn: () => void, ms: number) => { const id = ++this.seq; this.timers.set(id, { at: this.t + ms, fn, every: ms }); return id; };
  clearTimeout = (h: unknown) => { this.timers.delete(h as number); };
  clearInterval = (h: unknown) => { this.timers.delete(h as number); };
  async advance(ms: number, settle?: () => Promise<void>) {
    const end = this.t + ms;
    for (;;) {
      let nextId = -1; let next: { at: number; fn: () => void; every?: number } | null = null;
      for (const [id, tm] of Array.from(this.timers.entries())) if (tm.at <= end && (!next || tm.at < next.at)) { next = tm; nextId = id; }
      if (!next) break;
      this.t = next.at;
      if (next.every) next.at += next.every; else this.timers.delete(nextId);
      next.fn();
      await flush();
      if (settle) await settle();
    }
    this.t = end;
    await flush();
    if (settle) await settle();
  }
}

/** Plivo's side of the media WebSocket. */
class FakePlivoSocket {
  readyState = 1;
  sent: any[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  private handlers: Record<string, Array<(...a: any[]) => void>> = {};
  on(event: string, fn: (...a: any[]) => void) { (this.handlers[event] ||= []).push(fn); return this; }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code?: number, reason?: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = { code, reason };
    setImmediate(() => (this.handlers.close || []).forEach((f) => f(code ?? 1000, Buffer.from(reason || ""))));
  }
  emit(msg: any) { (this.handlers.message || []).forEach((f) => f(Buffer.from(JSON.stringify(msg)), false)); }
  remoteClose() { this.readyState = 3; (this.handlers.close || []).forEach((f) => f(1000, Buffer.from(""))); }
  plays() { return this.sent.filter((m) => m.event === "playAudio"); }
  checkpoints() { return this.sent.filter((m) => m.event === "checkpoint").map((m) => m.name as string); }
}

class FakeEngine {
  conversationId: string | null = null;
  callerAudio: Buffer[] = [];
  completes: string[] = [];
  said: Array<{ text: string; id: string }> = [];
  closed = false;
  private n = 0;
  constructor(public input: any, public events: any) {}
  sendCallerAudio(pcm: Buffer) { this.callerAudio.push(pcm); }
  playbackComplete(id: string) { this.completes.push(id); }
  async say(line: any) {
    const id = `line_${++this.n}`;
    this.said.push({ text: typeof line === "string" ? line : line.en, id });
    this.events.onAnswerStart(id);
    return id;
  }
  close() { this.closed = true; }
  ready(cid = `conv-${Math.random().toString(36).slice(2)}`) { this.conversationId = cid; this.events.onReady(cid); }
  speak(id: string, ms: number) {
    this.events.onAnswerStart(id);
    this.events.onAudio(Buffer.alloc(ms * 48, 1));
    this.events.onAiDone(id);
  }
}

function tone(samples: number, rate: number, amp = 8000): Buffer {
  const b = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  return b;
}

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const express = (await import("express")).default;
  const plivo = await import("../calling/providers/plivo");
  const pstream = await import("../calling/providers/plivoStream");
  const providers = await import("../calling/providers");
  const ms = await import("../calling/mediaStream");
  const tokens = await import("../calling/streamToken");
  const settingsSvc = await import("../calling/settingsService");
  const creds = await import("../calling/credentials");
  const dialer = await import("../calling/dialer");

  // ═══ 1. μ-law ═══════════════════════════════════════════════════════════════
  {
    expect(pstream.pcm16ToMulaw(Buffer.from([0, 0]))[0] === 0xff, "μ-law: silence encodes to 0xFF");
    const d = pstream.mulawToPcm16(Buffer.from([0xff, 0x7f, 0x00, 0x80]));
    expect(d.readInt16LE(0) === 0 && d.readInt16LE(2) === 0 && d.readInt16LE(4) === -32124 && d.readInt16LE(6) === 32124, "μ-law: standard decode values (0xFF → 0, 0x00 → −32124, 0x80 → 32124)", [d.readInt16LE(0), d.readInt16LE(4), d.readInt16LE(6)]);
    const pcm = tone(8000, 8000);
    const back = pstream.mulawToPcm16(pstream.pcm16ToMulaw(pcm));
    let maxErr = 0;
    for (let i = 0; i < pcm.length; i += 2) maxErr = Math.max(maxErr, Math.abs(pcm.readInt16LE(i) - back.readInt16LE(i)));
    expect(back.length === pcm.length && maxErr < 260, "μ-law round trip keeps a tone (1 byte per sample, small error)", { maxErr, len: back.length });
    expect(pstream.pcm16ToMulaw(Buffer.alloc(7)).length === 3, "odd trailing byte ignored");
  }

  // ═══ 2. stream translator ═══════════════════════════════════════════════════
  {
    const ws = new FakePlivoSocket();
    const sock = new pstream.PlivoStreamSocket(ws as any, { callUuid: "uuid-from-answer", from: "+919812345678", to: "918041234567" });
    const got: any[] = [];
    sock.on("message", (data: any) => got.push(JSON.parse(String(data))));
    sock.send(JSON.stringify({ event: "media", stream_sid: "x", media: { payload: tone(800, 8000).toString("base64") } }));
    expect(ws.sent.length === 0, "nothing is sent to Plivo before its start event");
    ws.emit({ event: "start", sequenceNumber: 1, start: { callId: "CALL-UUID-1", streamId: "STREAM-1", accountId: "MA123", tracks: ["inbound"], mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000 } }, extra_headers: "a=1;b=2" });
    const st = got[0];
    expect(st?.event === "start" && st.stream_sid === "STREAM-1" && st.start.call_sid === "CALL-UUID-1" && st.start.from === "+919812345678" && st.start.to === "918041234567" && st.start.media_format.sample_rate === "8000" && st.start.custom_parameters.b === "2",
      "start → AgentStream start (stream id, call uuid, caller + called number from the signed link, 8 kHz)", st);
    const ulaw = pstream.pcm16ToMulaw(tone(160, 8000));
    ws.emit({ event: "media", streamId: "STREAM-1", media: { track: "inbound", timestamp: "1", chunk: 1, payload: ulaw.toString("base64") } });
    const media = got[1];
    expect(media?.event === "media" && Buffer.from(media.media.payload, "base64").length === 320, "media (160 μ-law bytes) → PCM16 media (320 bytes)", media && Buffer.from(media.media.payload, "base64").length);
    ws.emit({ event: "media", streamId: "STREAM-1", media: { track: "outbound", payload: ulaw.toString("base64") } });
    expect(got.length === 2, "outbound-track media is ignored");
    ws.emit({ event: "playedStream", sequenceNumber: 5, streamId: "STREAM-1", name: "r1" });
    ws.emit({ event: "played", streamId: "STREAM-1", name: "r2" });
    expect(got[2]?.event === "mark" && got[2].mark.name === "r1" && got[3]?.mark?.name === "r2", "playedStream / played → mark echo", got.slice(2));
    ws.emit({ event: "clearedAudio", streamId: "STREAM-1" });
    expect(got.length === 4, "clearedAudio is not passed on");
    sock.send(JSON.stringify({ event: "media", stream_sid: "STREAM-1", media: { payload: tone(1600, 8000).toString("base64") } }));
    const play = ws.sent[0];
    expect(play?.event === "playAudio" && play.media.contentType === "audio/x-mulaw" && play.media.sampleRate === 8000 && Buffer.from(play.media.payload, "base64").length === 1600,
      "engine media (3,200 PCM bytes) → playAudio μ-law 8 kHz (1,600 bytes)", play && { ...play, media: { ...play.media, payload: undefined } });
    sock.send(JSON.stringify({ event: "mark", stream_sid: "STREAM-1", mark: { name: "r9" } }));
    sock.send(JSON.stringify({ event: "clear", stream_sid: "STREAM-1" }));
    expect(ws.sent[1]?.event === "checkpoint" && ws.sent[1].streamId === "STREAM-1" && ws.sent[1].name === "r9" && ws.sent[2]?.event === "clearAudio" && ws.sent[2].streamId === "STREAM-1",
      "mark → checkpoint, clear → clearAudio (with the stream id)", ws.sent.slice(1));
    let closed = false;
    sock.on("close", () => { closed = true; });
    ws.remoteClose();
    expect(closed && sock.readyState === 3, "close is passed through");
  }

  // ═══ 3. status webhook, XML, errors ═════════════════════════════════════════
  {
    const ring = plivo.parsePlivoStatusWebhook({ Event: "Ring", CallStatus: "ringing", RequestUUID: "req-1", CallUUID: "c-1" });
    expect(ring?.status === "ringing" && ring.providerCallSid === "req-1", "ring callback → ringing, matched by RequestUUID", ring);
    const done = plivo.parsePlivoStatusWebhook({ Event: "Hangup", CallStatus: "completed", RequestUUID: "req-1", CallUUID: "c-1", Duration: "64", BillDuration: "120", HangupCause: "NORMAL_CLEARING" });
    expect(done?.status === "completed" && done.durationSec === 64 && !!done.endedAt, "hangup completed → completed with duration", done);
    const cases: Array<[Record<string, string>, string]> = [
      [{ CallStatus: "busy" }, "busy"],
      [{ CallStatus: "no-answer" }, "no_answer"],
      [{ CallStatus: "timeout" }, "no_answer"],
      [{ CallStatus: "failed", HangupCause: "USER_BUSY" }, "busy"],
      [{ CallStatus: "failed", HangupCause: "UNALLOCATED_NUMBER" }, "failed"],
      [{ CallStatus: "cancel", HangupCause: "NO_ANSWER" }, "no_answer"],
    ];
    for (const [b, want] of cases) {
      const u = plivo.parsePlivoStatusWebhook({ ...b, RequestUUID: "r" });
      expect(u?.status === want, `CallStatus ${b.CallStatus}${b.HangupCause ? ` (${b.HangupCause})` : ""} → ${want}`, u?.status);
    }
    expect(plivo.parsePlivoStatusWebhook({ CallStatus: "completed" }) === null && plivo.parsePlivoStatusWebhook({ RequestUUID: "r", CallStatus: "weird" }) === null, "no id / unknown status → ignored");
    const raw = plivo.parsePlivoStatusWebhook({ CallStatus: "completed", RequestUUID: "r", AuthToken: "secret" })!.raw!;
    expect(!("AuthToken" in raw), "secrets never kept in the raw webhook copy");

    const xml = plivo.plivoStreamXml({ streamUrl: "wss://portal.example.com/api/calling/plivo/stream/a.b.c?x=1&y=2", timeLimitSec: 300 });
    expect(xml.startsWith("<?xml") && /<Stream bidirectional="true" keepCallAlive="true" contentType="audio\/x-mulaw;rate=8000" streamTimeout="420">wss:\/\/portal\.example\.com\/api\/calling\/plivo\/stream\/a\.b\.c\?x=1&amp;y=2<\/Stream>/.test(xml),
      "stream XML: bidirectional, kept alive, μ-law 8 kHz, timeout past the call limit, URL escaped", xml);
    const dial = plivo.plivoDialXml({ number: "+91 98765 43210", callerId: "+918041234567" });
    expect(/<Dial callerId="918041234567" timeout="30"><Number>919876543210<\/Number><\/Dial>/.test(dial), "dial XML: digits only, caller id = our Plivo number", dial);
    expect(/<Speak>Tom &amp; Jerry &lt;3<\/Speak><Hangup\/>/.test(plivo.plivoRefuseXml("Tom & Jerry <3")), "refuse XML escapes the text");

    expect(/Auth ID or Auth Token/.test(plivo.explainPlivoError(401, "authentication failed").message) && plivo.explainPlivoError(401, "").permanent, "401 → check Auth ID / Token (permanent)");
    expect(/balance is too low/.test(plivo.explainPlivoError(402, "insufficient balance").message) && !plivo.explainPlivoError(402, "").permanent, "low balance → recharge (retried)");
    expect(/trial accounts/.test(plivo.explainPlivoError(400, "Trial account can only call verified numbers").message), "trial account → verify the number");
    expect(/KYC/.test(plivo.explainPlivoError(403, "KYC verification pending").message), "KYC pending → finish KYC");
    expect(!plivo.explainPlivoError(503, "").permanent && !plivo.explainPlivoError(429, "").permanent, "429 / 5xx → retried");
  }

  // ═══ 4. X-Plivo-Signature-V3 ═══════════════════════════════════════════════
  {
    const url = "https://portal.example.com/api/calling/plivo/answer/tok";
    const params = { From: "919812345678", CallUUID: "abc", To: "918041234567" };
    expect(plivo.plivoSignatureBase("POST", url, params) === `${url}?CallUUIDabcFrom919812345678To918041234567`, "POST: signed string = URL + '?' + sorted key+value pairs", plivo.plivoSignatureBase("POST", url, params));
    expect(plivo.plivoSignatureBase("POST", url, {}) === url, "POST without params: just the URL");
    expect(plivo.plivoSignatureBase("GET", `${url}?b=2&a=1`, {}) === `${url}?a=1&b=2`, "GET: query sorted");
    expect(plivo.plivoSignatureBase("POST", `${url}?z=9`, { A: "1" }) === `${url}?z=9.A1`, "POST with a query: '?query.' then params");
    const token = "plivo-auth-token-123";
    const nonce = "12345678901234567890";
    const sig = crypto.createHmac("sha256", token).update(`${url}?CallUUIDabcFrom919812345678To918041234567.${nonce}`).digest("base64");
    expect(plivo.plivoSignatureV3(token, "POST", url, nonce, params) === sig, "signature = base64 HMAC-SHA256(token, signed string + '.' + nonce)");
    expect(plivo.verifyPlivoSignatureV3({ authToken: token, method: "POST", urls: ["https://wrong.example.com/x", url], nonce, signature: sig, params }), "valid signature (second candidate URL) accepted");
    expect(plivo.verifyPlivoSignatureV3({ authToken: token, method: "POST", urls: [url], nonce, signature: `other,${sig}`, params }), "comma-separated signatures (several tokens) accepted");
    expect(!plivo.verifyPlivoSignatureV3({ authToken: "wrong-token", method: "POST", urls: [url], nonce, signature: sig, params }), "wrong Auth Token → rejected");
    expect(!plivo.verifyPlivoSignatureV3({ authToken: token, method: "POST", urls: [url], nonce, signature: sig, params: { ...params, From: "919000000000" } }), "tampered parameter → rejected");
    expect(!plivo.verifyPlivoSignatureV3({ authToken: token, method: "POST", urls: [url], nonce: undefined, signature: sig, params }), "missing nonce → rejected");
  }

  // ═══ 5. provider against a fake fetch ═══════════════════════════════════════
  const reqs: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = [];
  let handler: (url: string, init: any) => { status: number; body: any; contentType?: string } | "throw" = () => ({ status: 200, body: {} });
  const fakeFetch = async (u: string, init: any = {}) => {
    reqs.push({ url: u, method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(String(init.body)) : null });
    const r = handler(u, init);
    if (r === "throw") throw new Error("ECONNRESET");
    const text = Buffer.isBuffer(r.body) ? r.body.toString("latin1") : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? r.contentType || "application/json" : null) },
      text: async () => text,
      arrayBuffer: async () => { const b = Buffer.isBuffer(r.body) ? r.body : Buffer.from(text); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
    };
  };
  const fakePlivo = plivo.createPlivoProvider(fakeFetch as any);
  const C = { provider: "plivo" as const, plivo: { authId: "MAABCDEFGHIJ12345678", authToken: "tok-secret-1234", number: "+918041234567" } };
  {
    handler = (u) => u.endsWith("/Account/MAABCDEFGHIJ12345678/") ? { status: 200, body: { name: "Acme Pvt Ltd" } } : { status: 200, body: { number: "918041234567" } };
    const v = await fakePlivo.verify(C);
    expect(v.ok && /MAABCDEFGHIJ12345678 \(Acme Pvt Ltd\)/.test(v.detail || "") && /\+918041234567/.test(v.detail || ""), "verify: account + number found → connected", v);
    expect(reqs[0].url === "https://api.plivo.com/v1/Account/MAABCDEFGHIJ12345678/" && reqs[1].url.endsWith("/Number/918041234567/") && reqs[0].headers.authorization === `Basic ${Buffer.from("MAABCDEFGHIJ12345678:tok-secret-1234").toString("base64")}`,
      "verify: GET account, GET number (digits), Basic auth", reqs.map((r) => r.url));
    handler = (u) => u.includes("/Number/") ? { status: 404, body: { error: "not found" } } : { status: 200, body: {} };
    let msg = "";
    try { await fakePlivo.verify(C); } catch (e: any) { msg = e.message; }
    expect(/not a number in this Plivo account/.test(msg), "verify: number not in the account → plain-language error", msg);
    handler = () => ({ status: 401, body: { error: "authentication failed" } });
    msg = "";
    try { await fakePlivo.verify(C); } catch (e: any) { msg = e.message; }
    expect(/Auth ID or Auth Token/.test(msg), "verify: bad credentials → check Auth ID / Token", msg);

    reqs.length = 0;
    handler = () => ({ status: 201, body: { message: "call fired", request_uuid: "req-uuid-1", api_id: "x" } });
    const placedRes = await fakePlivo.placeCall(C, { callId: "c1", businessAccountId: "b", to: "+919812345678", streamUrl: "", statusCallbackUrl: "https://portal.example.com/s", answerUrl: "https://portal.example.com/a", record: true, timeLimitSec: 300 });
    const b = reqs[0].body;
    expect(placedRes.providerCallSid === "req-uuid-1" && placedRes.status === "dialing", "place call → request uuid, dialing", placedRes);
    expect(reqs[0].method === "POST" && reqs[0].url.endsWith("/Account/MAABCDEFGHIJ12345678/Call/") && b.from === "918041234567" && b.to === "919812345678"
      && b.answer_url === "https://portal.example.com/a" && b.answer_method === "POST" && b.ring_url === "https://portal.example.com/s" && b.hangup_url === "https://portal.example.com/s"
      && b.time_limit === 330 && b.ring_timeout === 30, "place call body: digits, answer / ring / hangup links, time limit + 30 s grace", b);
    let perm: any = null;
    try { await fakePlivo.placeCall(C, { callId: "c1", businessAccountId: "b", to: "+919812345678", streamUrl: "", statusCallbackUrl: "", record: false, timeLimitSec: 60 }); } catch (e) { perm = e; }
    expect(perm?.permanent === true, "no answer link → permanent error");
    handler = () => "throw";
    perm = null;
    try { await fakePlivo.placeCall(C, { callId: "c1", businessAccountId: "b", to: "+919812345678", streamUrl: "", statusCallbackUrl: "", answerUrl: "https://x/a", record: false, timeLimitSec: 60 }); } catch (e) { perm = e; }
    expect(perm && !perm.permanent && /Could not reach Plivo/.test(perm.message), "network error → retried later", perm?.message);

    reqs.length = 0;
    handler = (_u, init) => init.method === "DELETE" ? { status: 204, body: "" } : { status: 202, body: { message: "ok", url: "https://media.plivo.com/v1/Account/MA/Recording/rec-1.mp3", recording_id: "rec-1" } };
    await fakePlivo.hangup!(C, "call-uuid-9");
    await fakePlivo.transfer!(C, "call-uuid-9", "https://portal.example.com/t");
    const rec = await fakePlivo.startRecording!(C, "call-uuid-9", { timeLimitSec: 300 });
    expect(reqs[0].method === "DELETE" && reqs[0].url.endsWith("/Call/call-uuid-9/"), "hang up: DELETE …/Call/<uuid>/");
    expect(reqs[1].method === "POST" && reqs[1].url.endsWith("/Call/call-uuid-9/") && reqs[1].body.legs === "aleg" && reqs[1].body.aleg_url === "https://portal.example.com/t" && reqs[1].body.aleg_method === "POST", "transfer: POST …/Call/<uuid>/ legs=aleg + aleg_url", reqs[1].body);
    expect(reqs[2].url.endsWith("/Call/call-uuid-9/Record/") && reqs[2].body.file_format === "mp3" && rec.recordingUrl === "https://media.plivo.com/v1/Account/MA/Recording/rec-1.mp3", "record: POST …/Record/ → recording URL", rec);
    handler = () => ({ status: 404, body: { error: "call not found" } });
    let threw = false;
    try { await fakePlivo.hangup!(C, "gone"); } catch { threw = true; }
    expect(!threw, "hang up of an already-ended call (404) is fine");
    handler = () => ({ status: 202, body: { url: "https://evil.example.com/x.mp3" } });
    expect((await fakePlivo.startRecording!(C, "u", { timeLimitSec: 60 })).recordingUrl === null, "recording URL on a foreign host is not stored");

    expect(plivo.isAllowedPlivoRecordingUrl("https://media.plivo.com/x.mp3").ok && plivo.isAllowedPlivoRecordingUrl("https://media.plivo.com/x.mp3").sendAuth, "plivo.com recordings allowed (with auth)");
    expect(!plivo.isAllowedPlivoRecordingUrl("http://media.plivo.com/x.mp3").ok && !plivo.isAllowedPlivoRecordingUrl("https://plivo.com.evil.io/x").ok && !plivo.isAllowedPlivoRecordingUrl("https://169.254.169.254/").ok, "http / look-alike / internal hosts refused");
    reqs.length = 0;
    handler = () => ({ status: 200, body: Buffer.from("ID3audio"), contentType: "audio/mpeg" });
    const audio = await fakePlivo.fetchRecording!(C, "https://media.plivo.com/v1/Account/MA/Recording/rec-1.mp3");
    expect(audio.contentType === "audio/mpeg" && audio.body.toString() === "ID3audio" && !!reqs[0].headers.authorization, "recording download with Plivo auth");
  }
  providers.setCallingProviderForTesting("plivo", fakePlivo);

  // ═══ seed ═══════════════════════════════════════════════════════════════════
  const stamp = Date.now();
  const mkBiz = async (name: string, on = true) => (await db.insert(schema.businessAccounts).values({ name: `${name} ${stamp}`, website: "https://x.example.com", aiCallingEnabled: on ? "true" : "false", openaiApiKey: "sk-test-not-real" } as any).returning())[0].id as string;
  const BIZ = await mkBiz("Plivo Homes");
  const OFF = await mkBiz("Plivo Off", false);
  const ALL_DAY = { start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6], timezone: "Asia/Kolkata" };
  const getCall = async (id: string) => (await db.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, id)))[0];

  // ═══ 6. settings ════════════════════════════════════════════════════════════
  {
    let msg = "";
    try { await settingsSvc.updateCallingSettings(BIZ, { enabled: true, provider: "plivo", plivo: { authId: "MAABCDEFGHIJ12345678", number: "080 4123 4567" } }, null); } catch (e: any) { msg = e.message; }
    expect(/first add your Plivo Auth Token/.test(msg), "turning on Plivo without the Auth Token → asks for it", msg);
    msg = "";
    try { await settingsSvc.updateCallingSettings(BIZ, { plivo: { authId: "MA-not valid!" } }, null); } catch (e: any) { msg = e.message; }
    expect(/Auth ID may only contain letters and digits/.test(msg), "bad Auth ID refused", msg);
    msg = "";
    try { await settingsSvc.updateCallingSettings(BIZ, { plivo: { number: "12" } }, null); } catch (e: any) { msg = e.message; }
    expect(/Plivo number must be a phone number/.test(msg), "bad Plivo number refused", msg);
    msg = "";
    try { await settingsSvc.updateCallingSettings(BIZ, { provider: "twilio" }, null); } catch (e: any) { msg = e.message; }
    expect(/Exotel, Plivo or the in-portal simulator/.test(msg), "unknown provider refused", msg);

    const r = await settingsSvc.updateCallingSettings(BIZ, {
      enabled: true, provider: "plivo", plivo: { authId: "MAABCDEFGHIJ12345678", number: "080 4123 4567" }, plivoAuthToken: "tok-secret-1234",
      callingHours: ALL_DAY, transferNumber: "+919999900000", maxCallMinutes: 2, concurrentCallLimit: 5,
    }, null);
    expect(r.secretsChanged.includes("plivoAuthToken") && r.changed.includes("plivoAuthId") && r.row.plivoNumber === "+918041234567", "saved: token sealed, Auth ID + number (normalised to +91…)", { s: r.secretsChanged, n: r.row.plivoNumber });
    expect(JSON.stringify(r.after).indexOf("8041234567") === -1 && JSON.stringify(r.after).indexOf("tok-secret") === -1, "audit copy has no phone number or token");
    const view = settingsSvc.toSettingsView({ ...r.row, exists: true });
    expect(view.provider === "plivo" && view.plivo.authId === "MAABCDEFGHIJ12345678" && view.plivo.authTokenSet && view.plivo.authTokenMask === "••••1234" && !JSON.stringify(view).includes("tok-secret"),
      "view: provider plivo, token masked, never returned", view.plivo);
    expect(view.setup.plivoAnswerUrl === `https://portal.example.com/api/calling/plivo/inbound/${r.row.inboundKey}`, "view: Plivo answer link for the application", view.setup.plivoAnswerUrl);
    const resolved = creds.resolveProviderCredentials(r.row);
    expect(resolved.provider === "plivo" && resolved.plivo?.authToken === "tok-secret-1234" && resolved.plivo.number === "+918041234567", "credentials decrypted for the provider");
    await settingsSvc.markProviderVerified(BIZ, "plivo");
    let row = await settingsSvc.getCallingSettings(BIZ);
    expect(!!row.plivoVerifiedAt && !row.exotelVerifiedAt, "verified mark on the Plivo side");
    await settingsSvc.updateCallingSettings(BIZ, { plivoAuthToken: "" }, null);
    row = await settingsSvc.getCallingSettings(BIZ);
    expect(!!row.plivoVerifiedAt && creds.resolveProviderCredentials(row).plivo?.authToken === "tok-secret-1234", "empty token = keep (still verified)");
    await settingsSvc.updateCallingSettings(BIZ, { plivo: { number: "+91 80 4123 4568" } }, null);
    row = await settingsSvc.getCallingSettings(BIZ);
    expect(!row.plivoVerifiedAt, "number changed → needs a new connection check");
    await settingsSvc.updateCallingSettings(BIZ, { plivo: { number: "+91 80 4123 4567" } }, null);
    expect(creds.providerMissing({ ...row, plivoAuthToken: null }).join() === "Plivo Auth Token", "missing list per provider");
  }
  const settings = await settingsSvc.getCallingSettings(BIZ);
  const inboundKey = settings.inboundKey!;
  await db.insert(schema.aiCallingSettings).values({ businessAccountId: OFF, enabled: true, provider: "plivo", inboundKey: tokens.newInboundKey() } as any);

  // ═══ 7. dialer places a Plivo call ═════════════════════════════════════════
  {
    const placedInputs: any[] = [];
    providers.setCallingProviderForTesting("plivo", { ...fakePlivo, placeCall: async (_c, input) => { placedInputs.push(input); return { providerCallSid: "req-dial-1", status: "dialing" }; } });
    const call = await dialer.enqueueCall({ businessAccountId: BIZ, phone: "+919811100001", trigger: "manual", provider: "plivo", scheduledAt: new Date(Date.now() - 1000) });
    expect(call.provider === "plivo", "queued call keeps provider plivo");
    await dialer.runDialerTick();
    const row = await getCall(call.id);
    const input = placedInputs[0];
    expect(row.providerCallSid === "req-dial-1" && row.callerId === "+918041234567" && row.provider === "plivo", "dialer: request uuid + Plivo number stored", { sid: row.providerCallSid, cid: row.callerId, st: row.status });
    expect(input && tokens.verifyCallToken(input.answerUrl.split("/api/calling/plivo/answer/")[1], "answer") === call.id && input.answerUrl.startsWith("https://portal.example.com/")
      && input.statusCallbackUrl.startsWith("https://portal.example.com/api/calling/webhooks/plivo/status/") && input.timeLimitSec === 120,
      "dialer: signed answer link + Plivo status link, call limit", input && { a: input.answerUrl, s: input.statusCallbackUrl });
    providers.setCallingProviderForTesting("plivo", fakePlivo);
  }

  // ═══ 8. HTTP instructions + status webhook ══════════════════════════════════
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((await import("../../routes/callingPlivo")).default);
  app.use((await import("../../routes/callingWebhooks")).default);
  const srvHttp = await new Promise<http.Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const httpBase = `http://127.0.0.1:${(srvHttp.address() as AddressInfo).port}`;
  const post = async (path: string, form: Record<string, string>, headers: Record<string, string> = {}) => {
    const res = await fetch(httpBase + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString() });
    return { status: res.status, text: await res.text(), type: res.headers.get("content-type") || "" };
  };
  const mkCall = async (extra: Record<string, unknown> = {}) => (await db.insert(schema.aiCalls).values({ businessAccountId: BIZ, direction: "outbound", status: "ringing", trigger: "manual", provider: "plivo", phone: "+919876543210", providerCallSid: `req-${Math.random().toString(36).slice(2)}`, ...extra } as any).returning())[0];
  try {
    const call = await mkCall();
    let r = await post(`/api/calling/plivo/answer/${tokens.signCallToken(call.id, "answer")}`, { CallUUID: "live-uuid-1", From: "918041234567", To: "919876543210", CallStatus: "in-progress" });
    const m = /<Stream [^>]*>(wss:\/\/[^<]+)<\/Stream>/.exec(r.text);
    expect(r.status === 200 && /xml/.test(r.type) && !!m && m[1].startsWith("wss://portal.example.com/api/calling/plivo/stream/") && tokens.verifyCallToken(m[1].split("/plivo/stream/")[1], "stream") === call.id,
      "answer → Stream XML to the call's signed stream link", r.text);
    expect(((await getCall(call.id)).metadata as any)?.plivoCallUuid === "live-uuid-1", "answer: Plivo's CallUUID saved on the call");
    r = await post(`/api/calling/plivo/answer/${tokens.signCallToken(call.id, "status")}`, {});
    expect(r.status === 403 && /<Hangup\/>/.test(r.text), "answer: a status token is not an answer token → 403 + Hangup", r.status);
    const ended = await mkCall({ status: "no_answer" });
    r = await post(`/api/calling/plivo/answer/${tokens.signCallToken(ended.id, "answer")}`, {});
    expect(r.status === 200 && /<Hangup\/>/.test(r.text) && !/<Stream/.test(r.text), "answer for a finished call → Hangup");

    // Signature enforcement.
    process.env.PLIVO_SIGNATURE_ENFORCE = "1";
    const path = `/api/calling/plivo/answer/${tokens.signCallToken(call.id, "answer")}`;
    const form = { CallUUID: "live-uuid-1", From: "918041234567" };
    r = await post(path, form, { "x-plivo-signature-v3": "bad", "x-plivo-signature-v3-nonce": "n1" });
    expect(r.status === 403, "enforced: wrong signature → 403", r.status);
    const goodSig = plivo.plivoSignatureV3("tok-secret-1234", "POST", `https://portal.example.com${path}`, "n2", form);
    r = await post(path, form, { "x-plivo-signature-v3": goodSig, "x-plivo-signature-v3-nonce": "n2" });
    expect(r.status === 200 && /<Stream/.test(r.text), "enforced: Plivo's signature (public address) → accepted", r.status);
    delete process.env.PLIVO_SIGNATURE_ENFORCE;
    r = await post(path, form, { "x-plivo-signature-v3": "bad", "x-plivo-signature-v3-nonce": "n3" });
    expect(r.status === 200, "not enforced: mismatch only logged");

    // Inbound.
    r = await post(`/api/calling/plivo/inbound/${inboundKey}`, { CallUUID: "in-uuid-1", From: "919811122233", To: "918041234567", Direction: "inbound" });
    const im = /<Stream [^>]*>(wss:\/\/[^<]+)<\/Stream>/.exec(r.text);
    const data = im ? tokens.verifyPlivoInboundStreamToken(im[1].split("/plivo/inbound-stream/")[1]) : null;
    expect(r.status === 200 && !!data && data.businessAccountId === BIZ && data.callUuid === "in-uuid-1" && data.from === "919811122233" && data.to === "918041234567",
      "inbound → Stream XML; the signed link carries business, call uuid, caller, called number", data);
    expect(tokens.verifyPlivoInboundStreamToken(im![1].split("/plivo/inbound-stream/")[1].replace(/.$/, "x")) === null, "inbound stream token can't be altered");
    r = await post(`/api/calling/plivo/inbound/${tokens.newInboundKey()}`, {});
    expect(r.status === 404, "inbound: unknown key → 404");
    const offKey = (await settingsSvc.getCallingSettings(OFF)).inboundKey!;
    r = await post(`/api/calling/plivo/inbound/${offKey}`, {});
    expect(r.status === 200 && /<Speak>Sorry, this line is not taking calls right now/.test(r.text) && /<Hangup\/>/.test(r.text), "inbound: AI Calling not allowed for the business → polite message + hang up", r.text);
    await settingsSvc.updateCallingSettings(BIZ, { monthlyMinuteLimit: 1 }, null);
    await db.insert(schema.aiCalls).values({ businessAccountId: BIZ, direction: "outbound", status: "completed", trigger: "manual", provider: "plivo", phone: "+919800000009", billedSeconds: 120 } as any);
    r = await post(`/api/calling/plivo/inbound/${inboundKey}`, { From: "919811122233" });
    expect(/<Dial callerId="918041234567" timeout="30"><Number>919999900000<\/Number><\/Dial>/.test(r.text), "inbound: monthly minutes used up → connected to the team's number instead", r.text);
    await settingsSvc.updateCallingSettings(BIZ, { monthlyMinuteLimit: null }, null);

    // Transfer.
    r = await post(`/api/calling/plivo/transfer/${tokens.signCallToken(call.id, "transfer")}`, {});
    expect(/<Dial callerId="918041234567" timeout="30"><Number>919999900000<\/Number><\/Dial>/.test(r.text), "transfer → Dial the team's number from the Plivo number", r.text);
    r = await post(`/api/calling/plivo/transfer/${tokens.signCallToken(call.id, "answer")}`, {});
    expect(r.status === 403, "transfer: wrong token purpose → 403");

    // Status webhook.
    const ringCall = await mkCall({ status: "dialing" });
    const statusPath = (id: string) => `/api/calling/webhooks/plivo/status/${tokens.signCallToken(id, "status")}`;
    r = await post(statusPath(ringCall.id), { Event: "Ring", CallStatus: "ringing", RequestUUID: ringCall.providerCallSid!, CallUUID: "u-r" });
    expect(r.status === 200 && (await getCall(ringCall.id)).status === "ringing", "status webhook: ring → ringing", r.text);
    r = await post(statusPath(ringCall.id), { Event: "Hangup", CallStatus: "no-answer", RequestUUID: ringCall.providerCallSid!, CallUUID: "u-r", Duration: "0" });
    const na = await getCall(ringCall.id);
    expect(na.status === "no_answer" && !!na.endedAt, "status webhook: hangup no-answer → no_answer", na.status);
    const other = await mkCall({ status: "dialing" });
    r = await post(statusPath(other.id), { Event: "Hangup", CallStatus: "busy", RequestUUID: "someone-else" });
    expect((await getCall(other.id)).status === "dialing", "status webhook for a different request uuid is ignored");
    process.env.PLIVO_SIGNATURE_ENFORCE = "1";
    r = await post(statusPath(other.id), { Event: "Hangup", CallStatus: "busy", RequestUUID: other.providerCallSid! });
    expect(r.status === 403 && (await getCall(other.id)).status === "dialing", "enforced: unsigned status webhook → 403");
    delete process.env.PLIVO_SIGNATURE_ENFORCE;
  } finally {
    srvHttp.close();
  }

  // ═══ 9. full calls through PlivoStreamSocket ════════════════════════════════
  const apiCalls: Array<{ kind: string; uuid: string; url?: string }> = [];
  providers.setCallingProviderForTesting("plivo", {
    ...fakePlivo,
    hangup: async (_c, uuid) => { apiCalls.push({ kind: "hangup", uuid }); },
    transfer: async (_c, uuid, url) => { apiCalls.push({ kind: "transfer", uuid, url }); },
    startRecording: async (_c, uuid) => { apiCalls.push({ kind: "record", uuid }); return { recordingUrl: `https://media.plivo.com/v1/Account/MA/Recording/${uuid}.mp3` }; },
  });
  function harness(kind: any, callId: string | undefined, meta: any) {
    const clock = new ManualClock();
    const ws = new FakePlivoSocket();
    const engines: FakeEngine[] = [];
    const finished: string[] = [];
    const session = new ms.CallMediaSession(new pstream.PlivoStreamSocket(ws as any, meta), { kind, businessAccountId: BIZ, callId, urlSampleRate: 8000 } as any, {
      createEngine: (input: any, events: any) => { const e = new FakeEngine(input, events); engines.push(e); return e as any; },
      onCallFinished: async (id: string) => { finished.push(id); },
      clock,
    });
    const send = async (m: any) => { ws.emit(m); await session.idle(); await flush(); await session.idle(); };
    return { clock, ws, engines, finished, session, send, engine: () => engines[0] };
  }
  const PSTART = (callId: string) => ({ event: "start", sequenceNumber: 1, start: { callId, streamId: "ST-1", accountId: "MA", tracks: ["inbound"], mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000 } } });
  {
    // Outbound: answered → engine; μ-law both ways; checkpoint; recording; AI ends → hang up through the API.
    const call = await mkCall({ phone: "+919876500001" });
    const h = harness("plivo_outbound", call.id, { callUuid: "live-out-1" });
    await h.send(PSTART("live-out-1"));
    const row = await getCall(call.id);
    expect(row.status === "in_progress" && row.providerStreamSid === "ST-1" && row.providerCallSid === call.providerCallSid, "outbound start → in_progress, stream id stored, request uuid kept", { st: row.status, sid: row.providerCallSid });
    await until(async () => !!(await getCall(call.id)).recordingUrl);
    expect(apiCalls.some((a) => a.kind === "record" && a.uuid === "live-out-1") && (await getCall(call.id)).recordingUrl === "https://media.plivo.com/v1/Account/MA/Recording/live-out-1.mp3", "recording started through the API with the live CallUUID", apiCalls);
    const e = h.engine();
    expect(!!e, "voice session started");
    e.ready();
    await h.send({ event: "media", streamId: "ST-1", media: { track: "inbound", payload: pstream.pcm16ToMulaw(tone(800, 8000)).toString("base64") } });
    expect(e.callerAudio.length > 0 && e.callerAudio.reduce((n, b) => n + b.length, 0) >= 4700, "caller μ-law audio → 24 kHz PCM to the engine (100 ms ≈ 4,800 bytes)", e.callerAudio.reduce((n, b) => n + b.length, 0));
    await h.clock.advance(2100, () => h.session.idle());
    const opening = e.said[0];
    expect(!!opening, "opening line after the hello wait", e.said);
    e.events.onAudio(Buffer.alloc(24000 * 2 * 1, 1));
    e.events.onAiDone(opening.id);
    await h.clock.advance(1500, () => h.session.idle());
    const plays = h.ws.plays();
    expect(plays.length > 0 && plays.every((p) => p.media.contentType === "audio/x-mulaw" && p.media.sampleRate === 8000), "answer audio → playAudio μ-law 8 kHz", plays.length);
    const cps = h.ws.checkpoints();
    expect(cps.length === 1, "one checkpoint after the line", cps);
    await h.send({ event: "playedStream", streamId: "ST-1", name: cps[0] });
    expect(e.completes.includes(opening.id), "playedStream → playback complete for that line");
    const res = await h.session.executeTool("end_call", { outcome: "interested" });
    expect(res.success === true, "end_call accepted");
    const bye = await e.say("Thanks, goodbye!");
    e.events.onAudio(Buffer.alloc(4800, 1));
    e.events.onAiDone(bye);
    await h.clock.advance(1000, () => h.session.idle());
    for (const name of h.ws.checkpoints().slice(1)) await h.send({ event: "playedStream", streamId: "ST-1", name });
    await until(() => h.finished.includes(call.id));
    const endRow = await getCall(call.id);
    expect(apiCalls.some((a) => a.kind === "hangup" && a.uuid === "live-out-1") && endRow.status === "completed" && endRow.outcome === "interested" && h.finished.length === 1,
      "AI ends → Plivo hang-up with the live CallUUID, call completed once", { calls: apiCalls, st: endRow.status, out: endRow.outcome });
  }
  {
    // Inbound: row created (provider plivo, caller from the signed link); transfer through the API.
    apiCalls.length = 0;
    const h = harness("plivo_inbound", undefined, { callUuid: "live-in-1", from: "919811122299", to: "918041234567" });
    await h.send(PSTART("live-in-1"));
    const rows = await db.select().from(schema.aiCalls).where(and(eq(schema.aiCalls.businessAccountId, BIZ), eq(schema.aiCalls.providerCallSid, "live-in-1")));
    expect(rows.length === 1 && rows[0].direction === "inbound" && rows[0].provider === "plivo" && rows[0].phone === "+919811122299" && rows[0].callerId === "918041234567",
      "inbound start → inbound row: provider plivo, caller's number, our number", rows[0] && { p: rows[0].provider, ph: rows[0].phone, c: rows[0].callerId });
    const e = h.engine();
    e.ready();
    await h.clock.advance(50, () => h.session.idle());
    expect(e.said.length === 1, "inbound: greeting at once", e.said);
    e.events.onAudio(Buffer.alloc(4800, 1));
    e.events.onAiDone(e.said[0].id);
    await h.clock.advance(500, () => h.session.idle());
    expect(e.input.chat.tools.some((t: any) => t.function.name === "transfer_to_human"), "transfer offered (Plivo + a team number)");
    const t = await h.session.executeTool("transfer_to_human", { reason: "wants a person" });
    expect(t.success === true, "transfer accepted");
    const line = await e.say("Connecting you now.");
    e.events.onAudio(Buffer.alloc(4800, 1));
    e.events.onAiDone(line);
    await h.clock.advance(1000, () => h.session.idle());
    for (const name of h.ws.checkpoints()) await h.send({ event: "playedStream", streamId: "ST-1", name });
    await until(() => h.finished.length === 1);
    const tr = apiCalls.find((a) => a.kind === "transfer");
    const done = await getCall(rows[0].id);
    expect(!!tr && tr.uuid === "live-in-1" && tokens.verifyCallToken(tr.url!.split("/api/calling/plivo/transfer/")[1], "transfer") === rows[0].id && !apiCalls.some((a) => a.kind === "hangup"),
      "transfer → Plivo transfer API with the signed transfer link (no hang-up)", apiCalls);
    expect(done.transferred === true && done.outcome === "transferred" && done.endReason === "transferred", "call recorded as transferred", { t: done.transferred, o: done.outcome, r: done.endReason });
  }
  {
    // Transfer refused by Plivo → the call ends normally, team calls back.
    apiCalls.length = 0;
    providers.setCallingProviderForTesting("plivo", {
      ...fakePlivo,
      hangup: async (_c, uuid) => { apiCalls.push({ kind: "hangup", uuid }); },
      transfer: async () => { throw new Error("transfer failed"); },
      startRecording: async () => ({ recordingUrl: null }),
    });
    const h = harness("plivo_inbound", undefined, { callUuid: "live-in-2", from: "919811122288", to: "918041234567" });
    await h.send(PSTART("live-in-2"));
    const e = h.engine();
    e.ready();
    await h.clock.advance(50, () => h.session.idle());
    e.events.onAudio(Buffer.alloc(4800, 1));
    e.events.onAiDone(e.said[0].id);
    await h.clock.advance(500, () => h.session.idle());
    await h.session.executeTool("transfer_to_human", {});
    const line = await e.say("Connecting you now.");
    e.events.onAudio(Buffer.alloc(4800, 1));
    e.events.onAiDone(line);
    await h.clock.advance(1000, () => h.session.idle());
    for (const name of h.ws.checkpoints()) await h.send({ event: "playedStream", streamId: "ST-1", name });
    await until(() => h.finished.length === 1);
    const [row] = await db.select().from(schema.aiCalls).where(eq(schema.aiCalls.providerCallSid, "live-in-2"));
    expect(row.transferred === false && row.outcome === "callback_requested" && row.endReason === "ai_ended" && apiCalls.some((a) => a.kind === "hangup"),
      "failed transfer → hung up, outcome 'call back later'", { t: row.transferred, o: row.outcome, r: row.endReason, apiCalls });
  }
  {
    // Caller hangs up → no API call needed.
    apiCalls.length = 0;
    const call = await mkCall({ phone: "+919876500002" });
    const h = harness("plivo_outbound", call.id, { callUuid: "live-out-2" });
    await h.send(PSTART("live-out-2"));
    h.engine().ready();
    h.ws.remoteClose();
    await h.session.idle();
    await until(() => h.finished.length === 1);
    expect((await getCall(call.id)).status === "completed" && !apiCalls.some((a) => a.kind === "hangup"), "caller hangs up → call completed, no hang-up request");
  }
  providers.setCallingProviderForTesting("plivo", fakePlivo);

  // ═══ 10. media upgrade endpoints over a real server ════════════════════════
  const { WebSocketServer, WebSocket } = await import("ws");
  const { handleCallingUpgrade } = await import("../../routes/callingMedia");
  const routeEngines: FakeEngine[] = [];
  ms.setCallStreamDepsForTesting({
    createEngine: (input: any, events: any) => { const e = new FakeEngine(input, events); routeEngines.push(e); return e as any; },
    onCallFinished: async () => {},
    clock: ms.realClock,
  });
  const wss = new WebSocketServer({ noServer: true });
  const srv = http.createServer((_req, res) => { res.statusCode = 404; res.end(); });
  srv.on("upgrade", (req, socket, head) => { void handleCallingUpgrade(req, socket, head, wss); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as AddressInfo).port;
  const connect = (path: string) => new Promise<{ ok: boolean; status?: number; ws?: InstanceType<typeof WebSocket> }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.on("open", () => resolve({ ok: true, ws }));
    ws.on("unexpected-response", (_req, res) => resolve({ ok: false, status: res.statusCode }));
    ws.on("error", () => resolve({ ok: false }));
  });
  try {
    let r = await connect("/api/calling/plivo/stream/not-a-token");
    expect(!r.ok && r.status === 401, "plivo stream: bad token → 401", r.status);
    const exoCall = await mkCall({ provider: "exotel" });
    r = await connect(`/api/calling/plivo/stream/${tokens.signCallToken(exoCall.id, "stream")}`);
    expect(!r.ok && r.status === 410, "plivo stream: not a Plivo call → refused", r.status);
    const live = await mkCall({ status: "ringing", phone: "+919876500003" });
    r = await connect(`/api/calling/plivo/stream/${tokens.signCallToken(live.id, "stream")}`);
    expect(r.ok, "plivo stream: valid token → accepted");
    const received: any[] = [];
    r.ws!.on("message", (d) => received.push(JSON.parse(String(d))));
    r.ws!.send(JSON.stringify(PSTART("live-out-ws")));
    await until(async () => (await getCall(live.id)).status === "in_progress");
    expect((await getCall(live.id)).status === "in_progress" && routeEngines.length === 1, "Plivo start over the socket → call in_progress, voice session started");
    routeEngines[0].ready();
    const id = await routeEngines[0].say("Hello from the AI");
    routeEngines[0].events.onAudio(Buffer.alloc(9600, 1));
    routeEngines[0].events.onAiDone(id);
    await until(() => received.some((m) => m.event === "checkpoint"));
    expect(received.some((m) => m.event === "playAudio" && m.media.contentType === "audio/x-mulaw") && received.some((m) => m.event === "checkpoint" && m.streamId === "ST-1"), "the AI's voice reaches Plivo as playAudio + checkpoint", received.map((m) => m.event));
    r.ws!.close();

    r = await connect(`/api/calling/plivo/inbound-stream/garbage.1.2`);
    expect(!r.ok && r.status === 401, "plivo inbound stream: bad token → 401", r.status);
    r = await connect(`/api/calling/plivo/inbound-stream/${tokens.signDataToken("plivo-inbound", { b: BIZ, c: "x", f: "1", t: "2" }, -10)}`);
    expect(!r.ok && r.status === 401, "plivo inbound stream: expired token → 401", r.status);
    r = await connect(`/api/calling/plivo/inbound-stream/${tokens.signDataToken("plivo-inbound", { b: OFF, c: "x", f: "1", t: "2" }, 600)}`);
    expect(!r.ok && r.status === 403, "plivo inbound stream: calling not allowed for the business → 403", r.status);
    const inUrl = tokens.buildPlivoInboundStreamUrl("http://127.0.0.1", { businessAccountId: BIZ, callUuid: "in-ws-1", from: "919800011122", to: "918041234567" });
    r = await connect(inUrl.replace(/^ws:\/\/127\.0\.0\.1/, ""));
    expect(r.ok, "plivo inbound stream: valid token → accepted");
    r.ws!.send(JSON.stringify(PSTART("in-ws-1")));
    const ok = await until(async () => (await db.select().from(schema.aiCalls).where(and(eq(schema.aiCalls.businessAccountId, BIZ), eq(schema.aiCalls.phone, "+919800011122")))).length === 1);
    expect(ok, "inbound stream start → inbound row for the caller from the signed link");
    r.ws!.close();
  } finally {
    ms.setCallStreamDepsForTesting(null);
    srv.close();
  }

  out(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { outErr(e); process.exit(1); });
