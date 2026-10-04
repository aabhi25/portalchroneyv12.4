/**
 * AI Calling — call audio + the voice AI on the phone (integration, PGlite).
 *
 * Covers: resampler / chunker (multiples of 320, ≥ 3,200, silence padding, round-trip
 * length), answering-machine phrases, opening lines, the Exotel AgentStream protocol on a
 * CallMediaSession with a FAKE voice engine and a MANUAL clock (start → call row, media →
 * 24 kHz audio forwarded, answer audio → paced media chunks + mark, mark echo →
 * playback_complete, barge-in → clear, stop → finalize), the phone tools (end_call,
 * do_not_call, transfer on the simulator, save_call_details), the max-length and silence
 * guards, voicemail detection (phrases + long greeting), processFinishedCall exactly once,
 * the upgrade endpoints (bad / expired / terminal token, inbound key + gates, simulator
 * session auth) over a real HTTP server, and one end-to-end call through the REAL
 * RealtimeVoiceService (fake OpenAI Realtime socket, fake chat stream, fake TTS).
 *
 * No network, no real call, no Exotel. DESTRUCTIVE: creates rows — refuses to run unless
 * AI_CALLING_TEST_DB=1 and DATABASE_URL points at localhost.
 */
import http from "http";
import type { AddressInfo } from "net";

const dbUrl = process.env.DATABASE_URL || "";
if (process.env.AI_CALLING_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl)) {
  console.error("Skipping: set AI_CALLING_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(0);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-0123456789abcdef";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-at-least-32-characters-long";
delete process.env.CALLING_SIGNING_SECRET;

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

// ── manual clock ────────────────────────────────────────────────────────────
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

// ── fake socket (the phone side) ──────────────────────────────────────────────
class FakeStreamSocket {
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
  media() { return this.sent.filter((m) => m.event === "media"); }
  marks() { return this.sent.filter((m) => m.event === "mark").map((m) => m.mark.name as string); }
  clears() { return this.sent.filter((m) => m.event === "clear"); }
}

// ── fake voice engine ─────────────────────────────────────────────────────────
class FakeEngine {
  conversationId: string | null = null;
  callerAudio: Buffer[] = [];
  completes: string[] = [];
  said: Array<{ text: string; persist?: boolean; id: string }> = [];
  closed = false;
  private n = 0;
  constructor(public input: any, public events: any) {}
  sendCallerAudio(pcm: Buffer) { this.callerAudio.push(pcm); }
  playbackComplete(id: string) { this.completes.push(id); }
  async say(line: any, opts?: { persist?: boolean }) {
    const id = `line_${++this.n}`;
    this.said.push({ text: typeof line === "string" ? line : line.en, persist: opts?.persist, id });
    this.events.onAnswerStart(id);
    return id;
  }
  close() { this.closed = true; }
  ready(cid = `conv-${Math.random().toString(36).slice(2)}`) { this.conversationId = cid; this.events.onReady(cid); }
  /** An answer: start, `ms` of 24 kHz audio, done. */
  speak(id: string, ms: number) {
    this.events.onAnswerStart(id);
    this.events.onAudio(Buffer.alloc(ms * 48, 1));
    this.events.onAiDone(id);
  }
  finishLine(id: string, ms = 500) {
    this.events.onAudio(Buffer.alloc(ms * 48, 1));
    this.events.onAiDone(id);
  }
}

function pcmTone(samples: number, rate: number): Buffer {
  const b = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  return b;
}

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const audio = await import("../calling/audio");
  const prompt = await import("../calling/phonePrompt");
  const ms = await import("../calling/mediaStream");
  const { signCallToken, newInboundKey } = await import("../calling/streamToken");
  const { createSession, hashPassword } = await import("../../auth");

  // ═══ 1. audio ═══════════════════════════════════════════════════════════════
  {
    const oneSec16 = pcmTone(16000, 16000);
    const up = audio.resamplePcm16(oneSec16, 16000, 24000);
    expect(Math.abs(up.length / 2 - 24000) <= 2, "16 kHz → 24 kHz: 1 s stays 1 s (24,000 samples)", up.length / 2);
    const back = audio.resamplePcm16(up, 24000, 16000);
    expect(Math.abs(back.length / 2 - 16000) <= 2, "24 kHz → 16 kHz round trip keeps the length", back.length / 2);
    const down8 = audio.resamplePcm16(up, 24000, 8000);
    expect(Math.abs(down8.length / 2 - 8000) <= 2, "24 kHz → 8 kHz: 8,000 samples", down8.length / 2);
    // Streaming in odd-sized pieces gives the same length as one shot.
    const r = new audio.StreamResampler(16000, 24000);
    let total = 0;
    for (let i = 0; i < oneSec16.length; i += 777) total += r.processBuffer(oneSec16.subarray(i, i + 777)).length;
    expect(Math.abs(total / 2 - 24000) <= 3, "streaming resampler (odd chunk sizes, split samples) ≈ one-shot length", total / 2);
    const peak = (b: Buffer) => { let m = 0; for (let i = 0; i < b.length; i += 2) m = Math.max(m, Math.abs(b.readInt16LE(i))); return m; };
    expect(peak(up) > 7000 && peak(up) <= 8001, "resampled tone keeps its level", peak(up));

    const q = new audio.OutgoingAudioQueue(3200);
    q.pushAudio(Buffer.alloc(7000, 1));
    q.pushMark("m1");
    const items: any[] = [];
    for (let it = q.take(); it; it = q.take()) items.push(it);
    const audioItems = items.filter((i) => i.kind === "audio");
    expect(audioItems.length === 3 && items[3]?.kind === "mark" && items[3].name === "m1", "chunker: 7,000 bytes → 2 full chunks + padded tail, then the mark", items.map((i) => i.kind === "audio" ? i.data.length : i.name));
    expect(audioItems.every((i) => audio.isValidOutgoingChunk(i.data.length)), "every chunk is a multiple of 320 and 3,200–100,000 bytes", audioItems.map((i) => i.data.length));
    const tail = audioItems[2].data as Buffer;
    expect(tail.length === 3200 && tail.subarray(600).every((b: number) => b === 0) && tail[0] === 1, "tail padded with silence to 3,200 bytes (audio first)", tail.length);
    expect(audio.padChunk(Buffer.alloc(3201)).length === 3520, "padding rounds up to a multiple of 320 (3,201 → 3,520)");
    q.pushAudio(Buffer.alloc(5000));
    q.pushMark("m2");
    expect(q.clear().includes("m2") && q.isEmpty, "clear() drops queued audio and returns dropped marks");
    expect(new audio.OutgoingAudioQueue(1000).chunkBytes === 3200 && new audio.OutgoingAudioQueue(250_000).chunkBytes === 100_000, "chunk size clamped to 3,200–100,000");
  }

  // ═══ 2. phone prompt helpers ════════════════════════════════════════════════
  {
    const vm = [
      "The number you have dialled is switched off",
      "Please leave a message after the tone",
      "The subscriber you are trying to reach is not reachable",
      "आप जिस नंबर पर कॉल कर रहे हैं वह अभी उपलब्ध नहीं है",
      "aap jis number par call kar rahe hain woh abhi uplabdh nahi hai",
      "कृपया संदेश छोड़ें",
      "Hi, you've reached Rahul. I'm not available right now, please leave your message",
    ];
    for (const t of vm) expect(prompt.looksLikeVoicemail(t), `voicemail phrase detected: "${t.slice(0, 40)}"`);
    const human = ["Hello?", "Haan ji, boliye", "Yes, who is this?", "Rahul is not here, I am his wife", "I am available after 5"];
    for (const t of human) expect(!prompt.looksLikeVoicemail(t), `a person is not voicemail: "${t}"`);
    const o = prompt.buildOpeningLine({ direction: "outbound", customerName: "Rahul Sharma", businessName: "Acme Homes" });
    expect(o.text === "Hi Rahul, I'm an AI assistant calling from Acme Homes. You'd enquired with us — is this a good time to talk for a minute?", "default outbound opening (unnamed assistant): first name, business, AI assistant", o.text);
    const named = prompt.buildOpeningLine({ direction: "inbound", businessName: "Acme", assistantName: "Riya" });
    expect(named.text === "Thanks for calling Acme, this is Riya, an AI assistant. How can I help?", "named assistant greeting", named.text);
    const ms0 = await import("../calling/mediaStream");
    for (const q of ["Could you share your email?", "कृपया अपना मोबाइल नंबर साझा करें।", "Thanks. Would you like a demo", "Aap apna time bataiye"]) expect(ms0.endsWithQuestion(q), `question detected: "${q}"`);
    for (const g of ["Thanks for calling, have a great day!", "धन्यवाद, आपका दिन शुभ हो।", "Okay, the team will call you tomorrow. Goodbye!"]) expect(!ms0.endsWithQuestion(g), `goodbye is not a question: "${g}"`);
    const noName = prompt.buildOpeningLine({ direction: "outbound", openingLine: "Hello {name}, {assistant} here from {business}!", customerName: null, businessName: "Acme" });
    expect(noName.text === "Hello there, the AI assistant here from Acme!" && noName.custom, "custom opening with no name → 'Hello there'", noName.text);
    const ib = prompt.buildOpeningLine({ direction: "inbound", businessName: "Acme" });
    expect(ib.text.startsWith("Thanks for calling Acme") && prompt.mentionsAi(ib.text), "default inbound greeting discloses AI", ib.text);
    const now = new Date("2026-10-04T10:00:00Z");
    expect(prompt.parseCallbackTime("2026-10-05T18:00:00+05:30", now)?.toISOString() === "2026-10-05T12:30:00.000Z", "callback_time parsed (ISO with offset)");
    expect(prompt.parseCallbackTime("yesterday", now) === null && prompt.parseCallbackTime("2020-01-01T00:00:00Z", now) === null, "bad / past callback_time ignored");
    const ins = prompt.buildPhoneInstructions({ direction: "outbound", businessName: "Acme", customerName: "Rahul", customerPhone: "+919876543210", leadMessage: "Need a 2BHK", callPurpose: "Book a site visit", transferAvailable: false, maxCallMinutes: 5, timezone: "Asia/Kolkata", leadCaptureOn: false, now });
    expect(/PHONE CALL MODE/.test(ins) && /Book a site visit/.test(ins) && /Need a 2BHK/.test(ins) && /AI assistant/.test(ins) && /never ask for it/.test(ins) && !/transfer_to_human/.test(ins), "instructions: purpose, lead message, AI disclosure, phone known, no transfer when unavailable");
    const tools = prompt.phoneTools({ transferAvailable: true, leadCaptureOn: false }).map((t: any) => t.function.name);
    expect(["end_call", "do_not_call", "transfer_to_human", "save_call_details"].every((n) => tools.includes(n)), "phone tools offered", tools);
    expect(!prompt.phoneTools({ transferAvailable: false, leadCaptureOn: true }).some((t: any) => ["transfer_to_human", "save_call_details"].includes(t.function.name)), "no transfer without a transfer line; no save_call_details when the lead form runs");
  }

  // ═══ seed ═══════════════════════════════════════════════════════════════════
  const stamp = Date.now();
  const mkBiz = async (name: string, on = true) => (await db.insert(schema.businessAccounts).values({ name: `${name} ${stamp}`, website: "https://x.example.com", aiCallingEnabled: on ? "true" : "false", openaiApiKey: "sk-test-not-real" } as any).returning())[0].id as string;
  const BIZ = await mkBiz("Acme Homes");
  const OFF = await mkBiz("Calling Off", false);
  const OTHER = await mkBiz("Other Biz");
  const inboundKey = newInboundKey();
  await db.insert(schema.aiCallingSettings).values({ businessAccountId: BIZ, enabled: true, provider: "simulator", maxCallMinutes: 2, transferNumber: "+919999900000", inboundKey, callPurpose: "Book a site visit" } as any);
  const offKey = newInboundKey();
  await db.insert(schema.aiCallingSettings).values({ businessAccountId: OFF, enabled: true, provider: "exotel", inboundKey: offKey } as any);
  const disabledKey = newInboundKey();
  await db.insert(schema.aiCallingSettings).values({ businessAccountId: OTHER, enabled: false, provider: "exotel", inboundKey: disabledKey } as any);
  const [lead] = await db.insert(schema.leads).values({ businessAccountId: BIZ, name: "Rahul Sharma", phone: "+919876543210", message: "Need a 2BHK near the metro" } as any).returning();
  const mkCall = async (extra: Record<string, unknown> = {}) => (await db.insert(schema.aiCalls).values({ businessAccountId: BIZ, direction: "outbound", status: "ringing", trigger: "manual", provider: "simulator", phone: "+919876543210", leadId: lead.id, ...extra } as any).returning())[0];
  const getCall = async (id: string) => (await db.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, id)))[0];
  const START = (rate = "16000", from = "+919876543210") => ({ event: "start", sequence_number: "1", stream_sid: "MZtest", start: { stream_sid: "MZtest", call_sid: "CAtest", account_sid: "SIMULATOR", from, to: "TEST", custom_parameters: {}, media_format: { encoding: "audio/x-raw", sample_rate: rate, bit_rate: "16" } } });

  function harness(kind: any, callId?: string, extraInit: Record<string, unknown> = {}) {
    const clock = new ManualClock();
    const ws = new FakeStreamSocket();
    const engines: FakeEngine[] = [];
    const finished: string[] = [];
    const session = new ms.CallMediaSession(ws as any, { kind, businessAccountId: BIZ, callId, urlSampleRate: 16000, ...extraInit } as any, {
      createEngine: (input: any, events: any) => { const e = new FakeEngine(input, events); engines.push(e); return e as any; },
      onCallFinished: async (id: string) => { finished.push(id); },
      clock,
    });
    const settle = () => session.idle();
    const send = async (m: any) => { ws.emit(m); await session.idle(); await flush(); await session.idle(); };
    const echoMarks = async () => { for (const name of ws.marks()) await send({ event: "mark", stream_sid: "MZtest", mark: { name } }); };
    return { clock, ws, engines, finished, session, settle, send, echoMarks, engine: () => engines[0] };
  }

  // ═══ 3. protocol + opening + paced audio + marks + barge-in ═════════════════
  {
    const call = await mkCall();
    const h = harness("simulator_outbound", call.id);
    await h.send({ event: "connected" });
    await h.send(START());
    let row = await getCall(call.id);
    expect(row.status === "in_progress" && !!row.answeredAt && row.providerStreamSid === "MZtest" && row.providerCallSid === "CAtest", "start → call in_progress, answeredAt, stream + call sid stored", { s: row.status });
    const e = h.engine();
    expect(!!e && e.input.callId === call.id && e.input.skipLeadTraining === true, "voice session started for the call (lead call: website lead form skipped)");
    const toolNames = e.input.chat.tools.map((t: any) => t.function.name);
    expect(toolNames.includes("end_call") && toolNames.includes("do_not_call") && toolNames.includes("transfer_to_human") && toolNames.includes("save_call_details"), "phone tools passed to the brain (transfer: simulator + transfer number)", toolNames);
    expect(/Book a site visit/.test(e.input.chat.instructions) && /Need a 2BHK/.test(e.input.chat.instructions), "instructions carry call purpose + lead message");
    expect(e.input.conversationTitle === "Phone call (outbound)", "conversation is recognisable as a phone call");

    // caller audio before the session is ready is kept, then forwarded at 24 kHz
    await h.send({ event: "media", sequence_number: "2", stream_sid: "MZtest", media: { chunk: "1", timestamp: "100", payload: pcmTone(1600, 16000).toString("base64") } });
    e.ready("conv-outbound-1");
    await flush();
    const fwd = e.callerAudio.reduce((n, b) => n + b.length, 0);
    expect(Math.abs(fwd - 4800) <= 8, "100 ms of 16 kHz caller audio → ~4,800 bytes at 24 kHz forwarded after ready", fwd);
    await until(async () => (await getCall(call.id)).conversationId === "conv-outbound-1", 2000);
    expect((await getCall(call.id)).conversationId === "conv-outbound-1", "conversationId stored on the call row");

    expect(e.said.length === 0, "outbound: AI waits for the callee's hello first");
    await h.clock.advance(ms.HELLO_WAIT_MS + 10, h.settle);
    expect(e.said.length === 1 && e.said[0].persist === true && /^Hi Rahul, I'm an AI assistant calling from Acme Homes/.test(e.said[0].text), "no hello within 2 s → opening line spoken (saved to the transcript)", e.said[0]);

    // opening audio: 1 s at 24 kHz → 16 kHz chunks, paced
    e.finishLine("line_1", 1000);
    await flush();
    const firstBurst = h.ws.media().length;
    expect(firstBurst >= 1 && firstBurst <= 4, "pacing: only ~300 ms is sent ahead of real time", firstBurst);
    await h.clock.advance(2000, h.settle);
    const media = h.ws.media();
    const sizes = media.map((m) => Buffer.from(m.media.payload, "base64").length);
    expect(sizes.every((n) => audio.isValidOutgoingChunk(n)), "every media payload obeys Exotel chunk rules", sizes);
    const totalOut = sizes.reduce((a, b) => a + b, 0);
    expect(totalOut >= 32000 && totalOut <= 32000 + 3200, "1 s of answer audio → ~32,000 bytes at 16 kHz (tail padded)", totalOut);
    expect(media.every((m) => m.stream_sid === "MZtest"), "media carries the stream sid");
    const sentOrder = h.ws.sent.map((m) => m.event);
    expect(h.ws.marks().length === 1 && sentOrder.lastIndexOf("mark") > sentOrder.lastIndexOf("media"), "a mark follows the answer's audio", sentOrder.slice(-3));
    await h.echoMarks();
    expect(e.completes.includes("line_1"), "Exotel mark echo → playback_complete for that response");

    // barge-in: an answer is cut off → clear, queued audio dropped
    e.events.onAnswerStart("resp_2");
    e.events.onAudio(Buffer.alloc(48 * 2000, 1));
    await flush();
    const before = h.ws.media().length;
    e.events.onCancelled("resp_2");
    await h.clock.advance(1000, h.settle);
    expect(h.ws.clears().length === 1 && h.ws.clears()[0].stream_sid === "MZtest", "confirmed interruption → clear sent");
    expect(h.ws.media().length === before, "no more audio of the interrupted answer after clear", { before, after: h.ws.media().length });

    // dtmf ignored, stop → finalize once
    await h.send({ event: "dtmf", stream_sid: "MZtest", dtmf: { digit: "5", duration: "100" } });
    await h.clock.advance(3000, h.settle);
    await h.send({ event: "stop", stream_sid: "MZtest", stop: { call_sid: "CAtest", account_sid: "X", reason: "callended" } });
    h.ws.remoteClose();
    await h.session.idle();
    row = await getCall(call.id);
    expect(row.status === "completed" && row.endReason === "customer_hung_up" && !!row.endedAt && row.durationSec != null && row.durationSec >= 5 && row.durationSec <= 8, "stop → completed, endReason customer_hung_up, duration from answer", { s: row.status, r: row.endReason, d: row.durationSec });
    expect(h.finished.length === 1 && h.finished[0] === call.id, "processFinishedCall called exactly once (stop + socket close)", h.finished);
    expect(e.closed, "voice session closed at the end of the call");
  }

  // ═══ 4. callee says hello → opening; end_call tool → goodbye → hang up ══════
  {
    const call = await mkCall();
    const h = harness("simulator_outbound", call.id);
    await h.send(START());
    const e = h.engine();
    e.ready();
    e.input.onSpeech("started");
    e.input.onSpeech("stopped");
    const verdict = e.input.screenTranscript("Hello?");
    await flush();
    expect(verdict === "drop" && e.said.length === 1 && /Hi Rahul/.test(e.said[0].text), "callee's 'hello' is answered with the opening line (not a chat reply)");
    e.finishLine("line_1", 300);
    await h.clock.advance(500, h.settle);
    await h.echoMarks();
    expect(e.input.screenTranscript("Yes, tell me") === "continue", "later turns go to the brain");
    // the brain answers and calls end_call mid-turn
    e.events.onAnswerStart("resp_bye");
    const r1 = await e.input.chat.executeTool("save_call_details", { email: "rahul@example.com", requirement: "2BHK" });
    const r2 = await e.input.chat.executeTool("end_call", { outcome: "callback_requested", note: "Call after 6", callback_time: new Date(h.clock.now() + 86_400_000).toISOString() });
    expect(r1.success === true && r2.success === true && /goodbye/i.test(String(r2.message)), "save_call_details + end_call accepted; tool asks for a goodbye");
    e.events.onAudio(Buffer.alloc(48 * 800, 1));
    e.events.onAiDone("resp_bye");
    await h.clock.advance(1500, h.settle);
    expect(h.ws.readyState === 1, "call stays up until the goodbye has played");
    await h.echoMarks();
    await h.session.idle();
    await until(() => h.finished.length === 1, 2000);
    const row = await getCall(call.id);
    expect(h.ws.readyState === 3, "goodbye played (mark echoed) → stream closed (hang up)");
    expect(row.status === "completed" && row.outcome === "callback_requested" && row.outcomeNote === "Call after 6" && !!row.callbackAt && row.endReason === "ai_ended", "end_call → outcome, note, callback time, endReason ai_ended", { o: row.outcome, r: row.endReason });
    expect((row.capturedFields as any)?.email === "rahul@example.com" && (row.capturedFields as any)?.requirement === "2BHK", "captured details saved on the call", row.capturedFields);
    expect(h.finished.length === 1, "processFinishedCall once");
  }

  // ═══ 5. do_not_call ════════════════════════════════════════════════════════
  {
    const call = await mkCall();
    const h = harness("simulator_outbound", call.id);
    await h.send(START());
    const e = h.engine();
    e.ready();
    e.input.screenTranscript("Hello");
    e.finishLine("line_1", 200);
    await h.clock.advance(400, h.settle);
    await h.echoMarks();
    e.events.onAnswerStart("resp_dnc");
    const r = await e.input.chat.executeTool("do_not_call", {});
    e.speak("resp_dnc", 400);
    await h.clock.advance(600, h.settle);
    await h.echoMarks();
    await until(() => h.finished.length === 1, 2000);
    const row = await getCall(call.id);
    expect(r.success === true && row.outcome === "do_not_call" && row.endReason === "do_not_call" && row.status === "completed", "do_not_call → outcome do_not_call, call ended after the apology", { o: row.outcome, r: row.endReason });
  }

  // ═══ 6. transfer on the simulator ═════════════════════════════════════════
  {
    const call = await mkCall();
    const h = harness("simulator_outbound", call.id);
    await h.send(START());
    const e = h.engine();
    e.ready();
    e.input.screenTranscript("Hello");
    e.finishLine("line_1", 200);
    await h.clock.advance(400, h.settle);
    await h.echoMarks();
    e.events.onAnswerStart("resp_tx");
    const r = await e.input.chat.executeTool("transfer_to_human", { reason: "wants a person" });
    e.speak("resp_tx", 400);
    await h.clock.advance(600, h.settle);
    await h.echoMarks();
    await flush();
    const announce = e.said.find((s) => /In a real call you would now be connected to \+919999900000/.test(s.text));
    expect(r.success === true && !!announce, "simulator transfer: after the AI's line it explains the real call would connect to the transfer number");
    expect(h.ws.readyState === 1, "call still up while the explanation plays");
    e.finishLine(announce!.id, 600);
    await h.clock.advance(800, h.settle);
    await h.echoMarks();
    await until(() => h.finished.length === 1, 2000);
    const row = await getCall(call.id);
    expect(row.transferred === true && row.outcome === "transferred" && row.endReason === "transferred" && h.ws.readyState === 3, "transfer → transferred, outcome transferred, call ended", { t: row.transferred, o: row.outcome, r: row.endReason });
  }

  // ═══ 7. voicemail: phrase, then long greeting ═════════════════════════════
  {
    const call = await mkCall();
    const h = harness("simulator_outbound", call.id);
    await h.send(START());
    const e = h.engine();
    e.ready();
    e.input.onSpeech("started");
    const v = e.input.screenTranscript("The number you have dialled is currently switched off, please try again later");
    await h.session.idle();
    await until(() => h.finished.length === 1, 2000);
    const row = await getCall(call.id);
    expect(v === "drop" && e.said.length === 0, "answering-machine message is never answered (AI doesn't talk)");
    expect(row.status === "voicemail" && row.outcome === "voicemail" && row.endReason === "voicemail" && h.ws.readyState === 3 && h.finished.length === 1, "voicemail → status voicemail, outcome voicemail, hung up, processed once", { s: row.status, o: row.outcome });
  }
  {
    const call = await mkCall();
    const h = harness("simulator_outbound", call.id);
    await h.send(START());
    const e = h.engine();
    e.ready();
    e.input.onSpeech("started");
    await h.clock.advance(ms.LONG_GREETING_MS + 500, h.settle);
    await until(() => h.finished.length === 1, 2000);
    const row = await getCall(call.id);
    expect(row.status === "voicemail" && e.said.length === 0, "a long uninterrupted greeting at the start → voicemail, AI never spoke", row.status);
  }

  // ═══ 8. silence guard ════════════════════════════════════════════════════
  {
    const call = await mkCall();
    const h = harness("simulator_outbound", call.id);
    await h.send(START());
    const e = h.engine();
    e.ready();
    e.input.screenTranscript("Hello");
    e.finishLine("line_1", 500);
    await h.clock.advance(700, h.settle);
    await h.echoMarks();
    await h.clock.advance(ms.SILENCE_NUDGE_MS - 1500, h.settle);
    expect(e.said.length === 1, "no nudge before ~8 s of silence");
    await h.clock.advance(1500, h.settle);
    const nudge = e.said[1];
    expect(nudge && nudge.text === prompt.PHONE_LINES.stillThere.en && !nudge.persist, "~8 s of silence → 'Are you still there?'", e.said.map((s) => s.text));
    e.finishLine(nudge.id, 1000);
    await h.clock.advance(1200, h.settle);
    await h.echoMarks();
    expect(e.said.length === 2, "only one nudge per silence");
    await h.clock.advance(ms.SILENCE_END_MS - ms.SILENCE_NUDGE_MS - 1000, h.settle);
    const bye = e.said[2];
    expect(bye && bye.text === prompt.PHONE_LINES.silenceGoodbye.en, "~20 s of silence → polite goodbye", e.said.map((s) => s.text));
    e.finishLine(bye.id, 800);
    await h.clock.advance(1000, h.settle);
    await h.echoMarks();
    await until(() => h.finished.length === 1, 2000);
    const row = await getCall(call.id);
    expect(row.endReason === "silence" && row.status === "completed" && h.ws.readyState === 3, "silence → call ended (endReason silence)", row.endReason);
  }

  // ═══ 9. max call length (2 min: warn 30 s before, then wrap up) ═══════════
  {
    const call = await mkCall();
    const h = harness("simulator_outbound", call.id);
    await h.send(START());
    const e = h.engine();
    e.ready();
    e.input.screenTranscript("Hello");
    e.finishLine("line_1", 300);
    await h.clock.advance(500, h.settle);
    await h.echoMarks();
    // keep the caller talking so the silence guard stays quiet
    for (let t = 0; t < 89; t += 5) { e.input.onSpeech("started"); e.input.onSpeech("stopped"); await h.clock.advance(5000, h.settle); }
    const warn = e.said.find((s) => s.text === prompt.PHONE_LINES.wrapUpSoon.en);
    expect(!!warn, "30 s before the limit → 'I'll need to wrap up…'", e.said.map((s) => s.text));
    if (warn) { e.finishLine(warn.id, 500); await h.clock.advance(600, h.settle); await h.echoMarks(); }
    for (let t = 0; t < 32; t += 5) { e.input.onSpeech("started"); e.input.onSpeech("stopped"); await h.clock.advance(5000, h.settle); }
    const bye = e.said.find((s) => s.text === prompt.PHONE_LINES.timeUpGoodbye.en);
    expect(!!bye, "at the limit → goodbye line", e.said.map((s) => s.text));
    if (bye) { e.finishLine(bye.id, 800); await h.clock.advance(1000, h.settle); await h.echoMarks(); }
    await until(() => h.finished.length === 1, 2000);
    const row = await getCall(call.id);
    expect(row.endReason === "max_duration" && h.ws.readyState === 3 && h.finished.length === 1, "max length → call ended (endReason max_duration), processed once", row.endReason);
  }

  // ═══ 10. a call that already finished is refused at start ═════════════════
  {
    const call = await mkCall({ status: "completed" });
    const h = harness("simulator_outbound", call.id);
    await h.send(START());
    await flush();
    expect(h.engines.length === 0 && h.ws.readyState === 3 && h.finished.length === 0, "start for a finished call → socket closed, no voice session, nothing processed");
  }

  // ═══ 11. inbound session creates its row ═════════════════════════════════
  {
    const h = harness("exotel_inbound");
    await h.send(START("8000", "09876543210"));
    const e = h.engine();
    const callId = h.session.callId!;
    const row = await getCall(callId);
    expect(row && row.direction === "inbound" && row.trigger === "inbound" && row.provider === "exotel" && row.status === "in_progress" && row.phone === "+919876543210" && row.leadId === lead.id, "inbound start → inbound row (exotel, in_progress, normalized number, matched lead)", row && { p: row.phone, l: row.leadId });
    expect(e.input.skipLeadTraining === false && !e.input.chat.tools.some((t: any) => t.function.name === "save_call_details") && e.input.chat.knownContact.phone === "+919876543210", "inbound: the lead form runs (number already known)");
    e.ready();
    await flush();
    expect(e.said.length === 1 && /^Thanks for calling Acme Homes/.test(e.said[0].text), "inbound: greeting spoken at once", e.said[0]);
    // 8 kHz stream: 1 s answer → 16,000 bytes
    e.finishLine("line_1", 1000);
    await h.clock.advance(2000, h.settle);
    const total = h.ws.media().reduce((n, m) => n + Buffer.from(m.media.payload, "base64").length, 0);
    expect(total >= 16000 && total <= 16000 + 3200, "8 kHz stream: answer resampled down (1 s ≈ 16,000 bytes)", total);
    h.ws.remoteClose();
    await h.session.idle();
    expect(h.finished.length === 1, "inbound hang-up → processed once");
  }

  // ═══ 11b. outbound flow call arriving on the inbound URL ══════════════════
  {
    const bySid = await mkCall({ provider: "exotel", status: "ringing", providerCallSid: "CAflow1" });
    const h = harness("exotel_inbound");
    const st: any = START("16000", "+919876543210");
    st.start.call_sid = "CAflow1";
    const inboundBefore = (await db.select().from(schema.aiCalls).where(and(eq(schema.aiCalls.businessAccountId, BIZ), eq(schema.aiCalls.direction, "inbound")))).length;
    await h.send(st);
    const row = await getCall(bySid.id);
    const inboundAfter = (await db.select().from(schema.aiCalls).where(and(eq(schema.aiCalls.businessAccountId, BIZ), eq(schema.aiCalls.direction, "inbound")))).length;
    expect(h.session.callId === bySid.id && row.status === "in_progress" && inboundAfter === inboundBefore, "flow call on the inbound URL matched by call sid → treated as the outbound call (no inbound row)");
    h.engine().ready();
    await flush();
    expect(h.engine().said.length === 0, "matched flow call behaves as outbound (waits for hello)");
    h.ws.remoteClose();
    await h.session.idle();

    const byField = await mkCall({ provider: "exotel", status: "dialing" });
    const h2 = harness("exotel_inbound");
    const st2: any = START("16000", "+919876543210");
    st2.start.call_sid = "CAother";
    st2.start.custom_parameters = { CustomField: `aicall:${byField.id}` };
    await h2.send(st2);
    expect(h2.session.callId === byField.id && (await getCall(byField.id)).status === "in_progress", "flow call matched by CustomField aicall:<id>");
    h2.ws.remoteClose();
    await h2.session.idle();

    const foreign = (await db.insert(schema.aiCalls).values({ businessAccountId: OTHER, direction: "outbound", status: "dialing", trigger: "manual", provider: "exotel", phone: "+919800000002" } as any).returning())[0];
    const h3 = harness("exotel_inbound");
    const st3: any = START("16000", "+919800000003");
    st3.start.call_sid = "CAother2";
    st3.start.custom_parameters = { CustomField: `aicall:${foreign.id}` };
    await h3.send(st3);
    expect(h3.session.callId !== foreign.id && (await getCall(foreign.id)).status === "dialing", "another business's call id in CustomField is ignored (new inbound row instead)");
    h3.ws.remoteClose();
    await h3.session.idle();
  }

  // ═══ 12. upgrade endpoints over a real server ═════════════════════════════
  const { WebSocketServer, WebSocket } = await import("ws");
  const { handleCallingUpgrade } = await import("../../routes/callingMedia");
  const routeEngines: FakeEngine[] = [];
  const routeFinished: string[] = [];
  ms.setCallStreamDepsForTesting({
    createEngine: (input: any, events: any) => { const e = new FakeEngine(input, events); routeEngines.push(e); return e as any; },
    onCallFinished: async (id: string) => { routeFinished.push(id); },
    clock: ms.realClock,
  });
  const wss = new WebSocketServer({ noServer: true });
  const srv = http.createServer((_req, res) => { res.statusCode = 404; res.end(); });
  srv.on("upgrade", (req, socket, head) => { void handleCallingUpgrade(req, socket, head, wss); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as AddressInfo).port;
  const connect = (path: string, cookie?: string) => new Promise<{ ok: boolean; status?: number; ws?: InstanceType<typeof WebSocket> }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: cookie ? { cookie } : {} });
    ws.on("open", () => resolve({ ok: true, ws }));
    ws.on("unexpected-response", (_req, res) => resolve({ ok: false, status: res.statusCode }));
    ws.on("error", () => resolve({ ok: false }));
  });
  try {
    let r = await connect("/api/calling/stream/not-a-token?sample-rate=16000");
    expect(!r.ok && r.status === 401, "stream: bad token → 401", r.status);
    const liveCall = await mkCall({ provider: "exotel", status: "dialing" });
    const expired = signCallToken(liveCall.id, "stream", Math.floor(Date.now() / 1000) - 3 * 24 * 3600);
    r = await connect(`/api/calling/stream/${expired}`);
    expect(!r.ok && r.status === 401, "stream: expired token → 401", r.status);
    r = await connect(`/api/calling/stream/${signCallToken(liveCall.id, "status")}`);
    expect(!r.ok && r.status === 401, "stream: a status-webhook token is not a stream token → 401", r.status);
    const doneCall = await mkCall({ provider: "exotel", status: "no_answer" });
    r = await connect(`/api/calling/stream/${signCallToken(doneCall.id, "stream")}`);
    expect(!r.ok && r.status === 410, "stream: finished call → 410", r.status);
    r = await connect(`/api/calling/stream/${signCallToken(liveCall.id, "stream")}?sample-rate=16000`);
    expect(r.ok, "stream: valid token for a live call → accepted");
    r.ws!.send(JSON.stringify({ event: "connected" }));
    r.ws!.send(JSON.stringify(START()));
    await until(async () => (await getCall(liveCall.id)).status === "in_progress");
    expect((await getCall(liveCall.id)).status === "in_progress" && routeEngines.length === 1, "stream start (frames sent right after open) → call in_progress, voice session started");
    r.ws!.send(JSON.stringify({ event: "stop", stream_sid: "MZtest", stop: { reason: "callended" } }));
    await until(() => routeFinished.includes(liveCall.id));
    expect(routeFinished.filter((id) => id === liveCall.id).length === 1, "stream stop → processFinishedCall once");
    r.ws!.close();

    r = await connect(`/api/calling/inbound/${newInboundKey()}`);
    expect(!r.ok && r.status === 404, "inbound: unknown key → 404", r.status);
    r = await connect(`/api/calling/inbound/${disabledKey}`);
    expect(!r.ok && r.status === 403, "inbound: business setting off → 403", r.status);
    r = await connect(`/api/calling/inbound/${offKey}`);
    expect(!r.ok && r.status === 403, "inbound: super-admin gate off → 403", r.status);
    r = await connect(`/api/calling/inbound/${inboundKey}?sample-rate=16000`);
    expect(r.ok, "inbound: valid key, both gates on → accepted");
    r.ws!.send(JSON.stringify(START("16000", "+919811122233")));
    const inboundRow = await until(async () => (await db.select().from(schema.aiCalls).where(and(eq(schema.aiCalls.businessAccountId, BIZ), eq(schema.aiCalls.phone, "+919811122233")))).length === 1);
    expect(inboundRow, "inbound start → inbound row for the caller's number");
    r.ws!.close();

    const pw = await hashPassword("x-test-password");
    const mkUser = async (biz: string) => (await db.insert(schema.users).values({ username: `u_${stamp}_${Math.random()}`, passwordHash: pw, role: "business_user", businessAccountId: biz } as any).returning())[0];
    const me = await mkUser(BIZ);
    const stranger = await mkUser(OTHER);
    const cookie = `session=${await createSession(me.id)}`;
    const strangerCookie = `session=${await createSession(stranger.id)}`;
    const simCall = await mkCall();
    r = await connect(`/api/calling/simulate/${simCall.id}?sample-rate=16000`);
    expect(!r.ok && r.status === 401, "simulate: no session → 401", r.status);
    r = await connect(`/api/calling/simulate/${simCall.id}?sample-rate=16000`, strangerCookie);
    expect(!r.ok && r.status === 404, "simulate: another business's call → 404", r.status);
    const exoCall = await mkCall({ provider: "exotel" });
    r = await connect(`/api/calling/simulate/${exoCall.id}`, cookie);
    expect(!r.ok && r.status === 409, "simulate: not a simulator call → 409", r.status);
    r = await connect(`/api/calling/simulate/${simCall.id}?sample-rate=16000`, cookie);
    expect(r.ok, "simulate: own ringing simulator call → accepted");
    r.ws!.close();
    r = await connect(`/api/calling/simulate-inbound?sample-rate=16000&from=9812300000`, cookie);
    expect(r.ok, "simulate-inbound: signed in → accepted");
    r.ws!.send(JSON.stringify(START("16000", "+910000000000")));
    const simIn = await until(async () => (await db.select().from(schema.aiCalls).where(and(eq(schema.aiCalls.businessAccountId, BIZ), eq(schema.aiCalls.phone, "+919812300000"), eq(schema.aiCalls.provider, "simulator")))).length === 1);
    expect(simIn, "simulate-inbound → inbound simulator row with the ?from= number");
    r.ws!.close();
    const offUser = await mkUser(OFF);
    r = await connect(`/api/calling/simulate-inbound`, `session=${await createSession(offUser.id)}`);
    expect(!r.ok && r.status === 403, "simulate-inbound: super-admin gate off → 403", r.status);
    r = await connect(`/api/calling/nope`);
    expect(!r.ok && r.status === 404, "unknown /api/calling/ path → 404", r.status);
  } finally {
    ms.setCallStreamDepsForTesting(null);
    srv.close();
  }

  // ═══ 13. end to end through the REAL RealtimeVoiceService ═════════════════
  {
    const realtimeMessages: any[] = [];
    let realtimeSocket: any = null;
    const fakeRealtime = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((r) => fakeRealtime.once("listening", () => r()));
    fakeRealtime.on("connection", (sock) => {
      realtimeSocket = sock;
      sock.on("message", (d) => { try { realtimeMessages.push(JSON.parse(String(d))); } catch { /* binary */ } });
      sock.send(JSON.stringify({ type: "session.created", session: { id: "sess_test" } }));
    });
    process.env.OPENAI_REALTIME_URL = `ws://127.0.0.1:${(fakeRealtime.address() as AddressInfo).port}/v1/realtime`;
    const { RealtimeVoiceService } = await import("../../realtimeVoiceService");
    const { createVoiceServiceEngine } = await import("../calling/phoneBridge");
    const svc: any = new RealtimeVoiceService();
    const chatCalls: any[] = [];
    svc.setDepsForTesting({
      streamChat: (message: string, context: any) => (async function* () {
        chatCalls.push({ message, context });
        await context.phoneCall.executeTool("end_call", { outcome: "not_interested", note: "Not looking now" });
        yield { type: "content", data: "No problem at all, thanks for your time. Goodbye!" };
        yield { type: "final", data: "No problem at all, thanks for your time. Goodbye!" };
      })(),
      commitAssistantMessage: async () => "msg-1",
      rollbackAssistantMessage: async () => {},
      createTtsProviders: () => ({
        primary: { name: "fake", synthesize: async (_t: string, _s: AbortSignal, onChunk: (b: Buffer) => void) => { onChunk(Buffer.alloc(24000, 2)); onChunk(Buffer.alloc(24000, 2)); } },
        fallback: null,
      }),
    });
    const finished: string[] = [];
    const ws = new FakeStreamSocket();
    const session = new ms.CallMediaSession(ws as any, { kind: "simulator_inbound", businessAccountId: BIZ, urlSampleRate: 16000, simulatorFrom: "+919800000001" }, {
      createEngine: createVoiceServiceEngine(() => svc),
      onCallFinished: async (id: string) => { finished.push(id); },
      clock: ms.realClock,
    });
    ws.emit({ event: "connected" });
    ws.emit(START("16000", "+910000000000"));
    await until(() => ws.marks().length >= 1, 8000);
    const callId = session.callId!;
    let row = await getCall(callId);
    expect(!!row?.conversationId, "real service: conversation created and stored on the call", row?.conversationId);
    const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, row.conversationId!));
    expect(conv?.title === "Phone call (inbound)" && conv?.visitorToken === `phone_${callId}`, "conversation marked as a phone call", conv && { t: conv.title });
    const greetingRows = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, row.conversationId!));
    expect(greetingRows.some((m: any) => m.role === "assistant" && /^Thanks for calling Acme Homes/.test(m.content)), "greeting spoken and saved to the transcript");
    const sessUpdate = realtimeMessages.find((m) => m.type === "session.update" && m.session?.audio?.input);
    expect(sessUpdate?.session?.audio?.input?.noise_reduction?.type === "near_field" && /phone call/i.test(String(sessUpdate?.session?.audio?.input?.transcription?.prompt)), "phone session: near-field noise reduction + phone transcription prompt");
    expect(ws.media().length > 0 && ws.media().every((m) => audio.isValidOutgoingChunk(Buffer.from(m.media.payload, "base64").length)), "greeting audio reached the phone in valid chunks");
    // caller audio reaches OpenAI as 24 kHz appends
    ws.emit({ event: "media", stream_sid: "MZtest", media: { chunk: "1", timestamp: "100", payload: pcmTone(1600, 16000).toString("base64") } });
    await until(() => realtimeMessages.some((m) => m.type === "input_audio_buffer.append"));
    const append = realtimeMessages.find((m) => m.type === "input_audio_buffer.append");
    expect(append && Math.abs(Buffer.from(append.audio, "base64").length - 4800) <= 8, "caller audio forwarded to the Realtime socket at 24 kHz", append && Buffer.from(append.audio, "base64").length);
    for (const name of ws.marks()) ws.emit({ event: "mark", stream_sid: "MZtest", mark: { name } });
    await sleep(800); // past the barge-in grace window
    realtimeSocket.send(JSON.stringify({ type: "input_audio_buffer.speech_started", item_id: "it1", audio_start_ms: 1000 }));
    realtimeSocket.send(JSON.stringify({ type: "input_audio_buffer.speech_stopped", item_id: "it1", audio_end_ms: 2600 }));
    realtimeSocket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "it1", transcript: "Actually I am not interested right now, thank you." }));
    await until(() => chatCalls.length === 1, 5000);
    const ctx = chatCalls[0]?.context;
    expect(ctx?.channel === "other" && Array.isArray(ctx?.phoneCall?.tools) && ctx.phoneCall.tools.some((t: any) => t.function.name === "end_call") && /PHONE CALL MODE/.test(ctx.phoneCall.instructions), "the brain gets the phone layer (channel other, phone tools, phone rules)");
    await until(() => ws.marks().length >= 2, 5000);
    expect(ws.readyState === 1, "call stays up while the goodbye plays");
    for (const name of ws.marks().slice(1)) ws.emit({ event: "mark", stream_sid: "MZtest", mark: { name } });
    await until(() => finished.length === 1, 5000);
    await session.idle();
    row = await getCall(callId);
    expect(ws.readyState === 3 && row.status === "completed" && row.outcome === "not_interested" && row.endReason === "ai_ended", "real service: end_call → goodbye played → hung up, outcome recorded", { s: row.status, o: row.outcome, r: row.endReason });
    expect(finished.length === 1, "processFinishedCall once (real service)");
    await until(() => !svc.hasConversation(row.conversationId!), 3000);
    expect(!svc.hasConversation(row.conversationId!), "voice session cleaned up after the call");
    svc.shutdown();
    fakeRealtime.close();
  }

  out(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  outErr("FATAL", err);
  process.exit(1);
});
