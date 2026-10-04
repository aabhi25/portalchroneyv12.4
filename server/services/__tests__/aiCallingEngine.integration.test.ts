/**
 * AI Calling engine — integration tests on a migrated (PGlite) database with a FAKE Exotel
 * (injected fetch), a counting simulator provider, a fake call summariser and a fake WhatsApp
 * follow-up sender. Never contacts Exotel, OpenAI or MSG91.
 *
 * Covers: gate (off → 403), super admin toggle + minute cap, settings validation, secrets never
 * returned + audit, consent attestation, public base URL capture, verify; Exotel request shape,
 * flow variant, error mapping, webhook parsing + signed-token webhook route; dialer: calling hours
 * reschedule (incl. DST), do-not-call, consent (explicit / attested / chat), monthly caps, concurrency,
 * atomic claim, stale simulator ringing, missing public URL; lead trigger (source filter, delay,
 * dedupe, never throws, storage + leadStore hooks); lifecycle (idempotent, retries + maxAttempts,
 * callback, do-not-call, follow-up only when answered, metering); business routes.
 *
 *   AI_CALLING_TEST_DB=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55472/postgres?sslmode=disable \
 *   npx tsx server/services/__tests__/aiCallingEngine.integration.test.ts
 */
import http from "http";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.AI_CALLING_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Skipping: set AI_CALLING_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(0);
}
process.env.OPENAI_API_KEY = "sk-test-not-real";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-at-least-32-characters-long";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-0123456789abcdef";
process.env.AI_CALLING_DIALER_DISABLED = "1";
delete process.env.PUBLIC_BASE_URL;
delete process.env.REPLIT_DEV_DOMAIN;

const out = console.log.bind(console);
const outErr = console.error.bind(console);
if (process.env.AI_CALLING_TEST_VERBOSE !== "1") {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}
let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; outErr(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { out(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean | Promise<boolean>, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(20); }
  return fn();
}
let unhandled = 0;
process.on("unhandledRejection", (e) => { unhandled++; outErr("unhandledRejection:", e); });

const RAW_KEY = "KEYlive_abcdef123456";
const RAW_TOKEN = "TOKsecret_9876543zz";

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { createSession, hashPassword } = await import("../../auth");
  const aiCallingRoutes = (await import("../../routes/aiCalling")).default;
  const webhookRoutes = (await import("../../routes/callingWebhooks")).default;
  const settingsSvc = await import("../calling/settingsService");
  const dialer = await import("../calling/dialer");
  const lifecycle = await import("../calling/callLifecycle");
  const summary = await import("../calling/summary");
  const trigger = await import("../calling/leadTrigger");
  const providers = await import("../calling/providers");
  const exotel = await import("../calling/providers/exotel");
  const { simulatorProvider } = await import("../calling/providers/simulator");
  const tokens = await import("../calling/streamToken");
  const { toBusinessAccountDto } = await import("@shared/dto/businessAccount");
  const { systemSettingsService } = await import("../systemSettingsService");
  const { storage } = await import("../../storage");
  const { upsertConversationLead } = await import("../leadCapture/leadStore");

  // ── fakes ──────────────────────────────────────────────────────────────────
  const exoRequests: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
  let exoHandler: (url: string, init: any) => { status: number; body: any; contentType?: string } | "throw" =
    () => ({ status: 200, body: { Call: { Sid: `CA${Math.random().toString(36).slice(2, 10)}`, Status: "queued" } } });
  const fakeFetch = async (u: string, init: any = {}) => {
    exoRequests.push({ url: u, method: init.method || "GET", headers: init.headers || {}, body: String(init.body || "") });
    const r = exoHandler(u, init);
    if (r === "throw") throw new Error("ECONNRESET");
    const text = Buffer.isBuffer(r.body) ? r.body.toString("latin1") : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? r.contentType || "application/json" : null) },
      text: async () => text,
      arrayBuffer: async () => { const b = Buffer.isBuffer(r.body) ? r.body : Buffer.from(text); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
    };
  };
  const fakeExotel = exotel.createExotelProvider(fakeFetch as any);
  providers.setCallingProviderForTesting("exotel", fakeExotel);
  const placed: string[] = [];
  providers.setCallingProviderForTesting("simulator", {
    ...simulatorProvider,
    placeCall: async (creds, input) => { placed.push(input.callId); await sleep(5); return simulatorProvider.placeCall(creds, input); },
  });
  let summaryResult: any = null;
  const summaryCalls: any[] = [];
  summary.setCallSummarizerForTesting(async (input) => { summaryCalls.push(input); return summaryResult; });
  const followUps: any[] = [];
  let followUpResult: { success: boolean; error?: string } = { success: true };
  lifecycle.setFollowUpSenderForTesting(async (req) => { followUps.push(req); return followUpResult; });

  // ── accounts, users, app ──────────────────────────────────────────────────
  const stamp = Date.now();
  const mkAccount = async (name: string, extra: Record<string, unknown> = {}) =>
    (await db.insert(schema.businessAccounts).values({ name: `${name} ${stamp}`, website: "https://x.example.com", ...extra } as any).returning())[0].id as string;
  const OFF = await mkAccount("Calling Off");
  const R = await mkAccount("Calling Routes", { aiCallingEnabled: "true" });
  const D = await mkAccount("Calling Dialer", { aiCallingEnabled: "true" });
  const L = await mkAccount("Calling Leads", { aiCallingEnabled: "true" });
  const F = await mkAccount("Calling Lifecycle", { aiCallingEnabled: "true" });

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(aiCallingRoutes);
  app.use(webhookRoutes);
  const srv = await new Promise<http.Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const pw = await hashPassword("x-test-password");
  const mkUser = async (role: string, businessAccountId: string | null) =>
    (await db.insert(schema.users).values({ username: `${role}_${stamp}_${Math.random()}`, passwordHash: pw, role, businessAccountId } as any).returning())[0];
  const cSup = `session=${await createSession((await mkUser("super_admin", null)).id)}`;
  const cOff = `session=${await createSession((await mkUser("business_user", OFF)).id)}`;
  const cR = `session=${await createSession((await mkUser("business_user", R)).id)}`;
  const responses: string[] = [];
  const call = async (method: string, path: string, cookie: string | null, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString("utf8");
    responses.push(text);
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, buf, headers: res.headers };
  };

  const callRow = async (id: string) => (await db.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, id)))[0];
  const callsOf = async (biz: string) => db.select().from(schema.aiCalls).where(eq(schema.aiCalls.businessAccountId, biz));
  const clearQueue = async () => {
    await db.execute(sql`UPDATE ai_calls SET status = 'cancelled' WHERE status IN ('queued', 'dialing', 'ringing', 'in_progress')`);
  };
  const ALL_DAY = { start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6], timezone: "Asia/Kolkata" };
  const setSettings = async (biz: string, patch: Record<string, unknown>) => {
    const r = await settingsSvc.updateCallingSettings(biz, patch, null);
    settingsSvc.invalidateSettingsCache(biz);
    return r.row;
  };
  const mkLead = async (biz: string, extra: Record<string, unknown> = {}) =>
    (await db.insert(schema.leads).values({ businessAccountId: biz, name: "Asha", phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, ...extra } as any).returning())[0];
  const mkConversation = async (biz: string, title = "Chat", userMessages: string[] = []) => {
    const [c] = await db.insert(schema.conversations).values({ businessAccountId: biz, title } as any).returning();
    for (const m of userMessages) await db.insert(schema.messages).values({ conversationId: c.id, role: "user", content: m });
    return c;
  };
  const enqueue = (biz: string, phone: string, extra: Partial<Parameters<typeof dialer.enqueueCall>[0]> = {}) =>
    dialer.enqueueCall({ businessAccountId: biz, phone, trigger: "manual", provider: "simulator", scheduledAt: new Date(Date.now() - 1000), metadata: { rootTrigger: extra.trigger || "manual" }, ...extra });
  const uniqPhone = () => `+9199${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

  try {
    // ═══ 1. Gate + super admin ═══════════════════════════════════════════════
    let r = await call("GET", "/api/calling/settings", null);
    expect(r.status === 401, "no session → 401", r.status);
    r = await call("GET", "/api/calling/settings", cOff);
    expect(r.status === 403 && /not switched on/i.test(r.json?.error), "AI Calling off for the business → 403 with a plain message", r.json);
    r = await call("GET", "/api/calling/calls", cOff);
    expect(r.status === 403, "calls list also gated", r.status);
    r = await call("GET", `/api/super-admin/ai-calling/${OFF}`, cR);
    expect(r.status === 403, "business user cannot use the super admin endpoint", r.status);
    r = await call("PUT", `/api/super-admin/ai-calling/${OFF}`, cSup, { enabled: true, monthlyMinuteCap: 100 });
    expect(r.status === 200 && r.json.enabled === true && r.json.monthlyMinuteCap === 100, "super admin switches AI Calling on + sets a 100 min cap", r.json);
    r = await call("GET", "/api/calling/settings", cOff);
    expect(r.status === 200 && r.json.superAdminMinuteCap === 100 && r.json.minutesThisMonth === 0, "business sees the cap and minutes used", r.json);
    r = await call("PUT", `/api/super-admin/ai-calling/${OFF}`, cSup, { enabled: false, monthlyMinuteCap: null });
    expect(r.json.enabled === false && r.json.monthlyMinuteCap === null, "super admin switches it off again + clears cap", r.json);
    r = await call("PUT", `/api/super-admin/ai-calling/${OFF}`, cSup, { monthlyMinuteCap: -3 });
    expect(r.status === 400, "negative cap rejected", r.status);
    const offRow = (await db.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.id, R)))[0];
    expect(toBusinessAccountDto(offRow).aiCallingEnabled === true && toBusinessAccountDto({ ...offRow, aiCallingEnabled: "false" }).aiCallingEnabled === false, "business account DTO exposes aiCallingEnabled as a boolean");
    const audSup = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.action, "ai_calling.super_admin_updated"), eq(schema.auditEvents.businessAccountId, OFF)));
    expect(audSup.length >= 2, "super admin changes are audited", audSup.length);

    // ═══ 2. Settings ═════════════════════════════════════════════════════════
    r = await call("GET", "/api/calling/settings", cR);
    expect(r.status === 200 && r.json.enabled === false && r.json.provider === "simulator" && r.json.exotel.apiKeySet === false && r.json.updatedAt === null,
      "defaults: off, simulator, no keys", r.json);
    expect(r.json.callingHours.timezone === "Asia/Kolkata" && r.json.maxAttempts === 3 && r.json.setup.inboundStreamUrl === null, "default hours/attempts; no setup URL before first save", r.json);
    const bad: Array<[any, RegExp, string]> = [
      [{ maxAttempts: 9 }, /between 1 and 5/, "maxAttempts above limit"],
      [{ retryGapMinutes: 5 }, /between 15/, "retry gap below limit"],
      [{ callingHours: { start: "25:00", end: "19:00", days: [1], timezone: "Asia/Kolkata" } }, /09:30/, "bad HH:MM"],
      [{ callingHours: { start: "18:00", end: "10:00", days: [1], timezone: "Asia/Kolkata" } }, /end after it starts/, "end before start"],
      [{ callingHours: { start: "10:00", end: "18:00", days: [], timezone: "Asia/Kolkata" } }, /at least one day/, "no days"],
      [{ callingHours: { start: "10:00", end: "18:00", days: [1], timezone: "Mars/Olympus" } }, /time zone/, "invalid timezone"],
      [{ autoCallSources: ["tv"] }, /Unknown lead source/, "unknown lead source"],
      [{ transferNumber: "abc" }, /Transfer number/, "bad transfer number"],
      [{ consentMode: "business_attested" }, /confirm/, "attested consent without attestation"],
      [{ enabled: true, provider: "exotel" }, /Exotel account SID/, "enable Exotel without credentials"],
      [{ whatsappFollowUp: true }, /template/, "follow-up without a template"],
      [{ exotelApiKey: "short" }, /8–512/, "too-short API key"],
      [{ exotel: { subdomain: "evil.example.com" } }, /region/, "unknown Exotel region"],
    ];
    for (const [body, re, label] of bad) {
      r = await call("PUT", "/api/calling/settings", cR, body);
      expect(r.status === 400 && re.test(r.json?.error || ""), `validation: ${label}`, r.json);
    }
    r = await call("PUT", "/api/calling/settings", cR, { consentMode: "business_attested", attestConsent: true, transferNumber: "98765 43210", callingHours: { start: "09:30", end: "20:00", days: [1, 2, 3], timezone: "Asia/Kolkata" } });
    expect(r.status === 200 && r.json.consentMode === "business_attested" && r.json.consentAttestedAt && r.json.transferNumber === "+919876543210" && r.json.callingHours.start === "09:30",
      "attested consent recorded with timestamp; transfer number normalised; hours saved", r.json);
    const rowR1 = await settingsSvc.getSettingsRow(R);
    expect(rowR1?.consentAttestedBy && rowR1.inboundKey && rowR1.inboundKey.length >= 20, "attested-by recorded; inbound key generated on first save", rowR1?.inboundKey);
    expect(rowR1?.publicBaseUrl === null, "plain http request → public base URL not captured");
    r = await call("PUT", "/api/calling/settings", cR, {
      provider: "exotel", exotelApiKey: RAW_KEY, exotelApiToken: RAW_TOKEN,
      exotel: { accountSid: "acme1", subdomain: "api.in.exotel.com", callerId: "080-4711 2345", flowAppId: null },
    }, { "x-forwarded-proto": "https" });
    expect(r.status === 200 && r.json.exotel.apiKeySet && r.json.exotel.apiKeyMask === "••••3456" && r.json.exotel.apiTokenMask === "••••43zz" && r.json.exotel.callerId === "08047112345",
      "Exotel keys stored: only set-flag + last-4 mask returned; caller id cleaned", r.json.exotel);
    const rowR2 = await settingsSvc.getSettingsRow(R);
    expect(rowR2?.exotelApiKey?.enc && !rowR2.exotelApiKey.enc.includes(RAW_KEY) && rowR2.exotelApiKey.last4 === "3456", "key encrypted at rest");
    expect(rowR2?.publicBaseUrl === base.replace("http://", "https://"), "https request → public base URL captured", rowR2?.publicBaseUrl);
    expect(r.json.setup.inboundStreamUrl === `${base.replace("http://", "wss://")}/api/calling/inbound/${rowR2!.inboundKey}?sample-rate=16000`
      && r.json.setup.statusCallbackUrl === `${base.replace("http://", "https://")}/api/calling/webhooks/exotel/status`, "setup URLs built from the captured base", r.json.setup);
    process.env.PUBLIC_BASE_URL = "https://portal.example.com";
    r = await call("PUT", "/api/calling/settings", cR, { exotelApiKey: "", exotelApiToken: "", maxCallMinutes: 4 });
    expect(r.json.exotel.apiKeyMask === "••••3456" && r.json.maxCallMinutes === 4 && r.json.setup.inboundStreamUrl.startsWith("wss://portal.example.com/api/calling/inbound/"),
      "empty secret = keep; PUBLIC_BASE_URL wins for setup URLs", r.json);
    const audits = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.action, "ai_calling.settings_updated"), eq(schema.auditEvents.businessAccountId, R)));
    expect(audits.length >= 3 && audits.some((a) => JSON.stringify(a.metadata).includes("exotelApiKey")) && !audits.some((a) => JSON.stringify(a.metadata).includes(RAW_KEY) || JSON.stringify(a.metadata).includes(RAW_TOKEN)),
      "settings changes audited (fields named, no raw secrets)", audits.map((a) => a.metadata));

    // Verify (fake Exotel).
    exoHandler = () => ({ status: 401, body: { RestException: { Status: 401, Message: "Authentication is required" } } });
    r = await call("POST", "/api/calling/settings/verify", cR, {});
    expect(r.status === 400 && /did not accept your API key/.test(r.json.error), "verify: wrong key/token → plain message", r.json);
    const vreq = exoRequests[exoRequests.length - 1];
    expect(vreq.url === "https://api.in.exotel.com/v1/Accounts/acme1/Calls.json?PageSize=1" && vreq.headers.authorization === `Basic ${Buffer.from(`${RAW_KEY}:${RAW_TOKEN}`).toString("base64")}`,
      "verify: GET account calls with basic auth (no credentials in the URL)", vreq.url);
    exoHandler = () => ({ status: 200, body: { Calls: [] } });
    r = await call("POST", "/api/calling/settings/verify", cR, {});
    expect(r.status === 200 && r.json.ok === true && /acme1/.test(r.json.detail), "verify ok", r.json);
    r = await call("GET", "/api/calling/settings", cR);
    expect(!!r.json.exotel.verifiedAt, "verifiedAt recorded");
    r = await call("PUT", "/api/calling/settings", cR, { exotel: { callerId: "08047119999" } });
    expect(r.json.exotel.verifiedAt === null, "changing the ExoPhone clears verified");
    await call("PUT", "/api/calling/settings", cR, { provider: "simulator" });
    r = await call("POST", "/api/calling/settings/verify", cR, {});
    expect(r.status === 200 && r.json.ok, "simulator verify always ok", r.json);
    const keyBefore = (await settingsSvc.getSettingsRow(R))!.inboundKey;
    r = await call("POST", "/api/calling/settings/inbound-key", cR, {});
    expect(r.status === 200 && (await settingsSvc.getSettingsRow(R))!.inboundKey !== keyBefore, "inbound key can be rotated");
    expect((await settingsSvc.getSettingsByInboundKey((await settingsSvc.getSettingsRow(R))!.inboundKey!))?.businessAccountId === R, "settings found by inbound key");

    // ═══ 3. Exotel provider ══════════════════════════════════════════════════
    const creds = {
      provider: "exotel" as const,
      exotel: { apiKey: RAW_KEY, apiToken: RAW_TOKEN, accountSid: "acme1", subdomain: "api.in.exotel.com", callerId: "08047112345", flowAppId: null as string | null },
    };
    exoHandler = () => ({ status: 200, body: { Call: { Sid: "CAabc123", Status: "queued" } } });
    const pr = await fakeExotel.placeCall(creds, {
      callId: "call-1", businessAccountId: R, to: "+919812345678", streamUrl: "wss://portal.example.com/api/calling/stream/tok?sample-rate=16000",
      statusCallbackUrl: "https://portal.example.com/api/calling/webhooks/exotel/status/tok", record: true, timeLimitSec: 300,
    });
    let req0 = exoRequests[exoRequests.length - 1];
    let form = new URLSearchParams(req0.body);
    expect(pr.providerCallSid === "CAabc123" && pr.status === "dialing", "placeCall returns the Exotel call id; queued → dialing", pr);
    expect(req0.method === "POST" && req0.url === "https://api.in.exotel.com/v1/Accounts/acme1/Calls/connect.json" && req0.headers["content-type"] === "application/x-www-form-urlencoded",
      "placeCall: POST form to Calls/connect.json", req0.url);
    expect(form.get("From") === "+919812345678" && form.get("CallerId") === "08047112345" && form.get("StreamUrl")?.startsWith("wss://") && form.get("StreamType") === "bidirectional"
      && form.get("Record") === "true" && form.get("RecordingChannels") === "dual" && form.get("TimeLimit") === "300" && form.get("TimeOut") === "30"
      && form.get("StatusCallback")?.endsWith("/status/tok") && form.get("StatusCallbackEvents[0]") === "terminal" && form.get("StatusCallbackEvents[1]") === "answered"
      && form.get("StatusCallbackContentType") === "application/json" && form.get("CustomField") === "aicall:call-1" && !form.has("Url"),
      "placeCall form: From/CallerId/StreamUrl/StreamType/Record/TimeLimit/StatusCallback/CustomField", Object.fromEntries(form));
    await fakeExotel.placeCall({ ...creds, exotel: { ...creds.exotel, flowAppId: "4321" } }, {
      callId: "call-2", businessAccountId: R, to: "+919812345678", streamUrl: "wss://x/y", statusCallbackUrl: "", record: false, timeLimitSec: 120,
    });
    form = new URLSearchParams(exoRequests[exoRequests.length - 1].body);
    expect(form.get("Url") === "http://my.exotel.com/acme1/exoml/start_voice/4321" && !form.has("StreamUrl") && form.get("CustomField") === "aicall:call-2" && !form.has("Record") && !form.has("StatusCallback"),
      "flow variant: Url to the call flow, call id in CustomField, no StreamUrl", Object.fromEntries(form));
    const errCases: Array<[number, string, RegExp, boolean]> = [
      [401, "Authentication failed", /API key or token/, true],
      [400, "KYC pending for this account", /KYC/, true],
      [403, "Account suspended", /suspended/, true],
      [400, "Call failed: number is DND registered", /Do-Not-Disturb/, true],
      [402, "Insufficient balance", /recharge/, false],
      [400, "Invalid From number", /phone number/, true],
      [503, "Service unavailable", /tried again/, false],
    ];
    for (const [status, msg, re, permanent] of errCases) {
      exoHandler = () => ({ status, body: { RestException: { Status: status, Message: msg } } });
      let err: any = null;
      try { await fakeExotel.placeCall(creds, { callId: "e", businessAccountId: R, to: "+919812345678", streamUrl: "wss://x", statusCallbackUrl: "", record: false, timeLimitSec: 60 }); } catch (e) { err = e; }
      expect(err && re.test(err.message) && err.permanent === permanent, `error mapping: ${status} "${msg}" → plain message (permanent=${permanent})`, err?.message);
    }
    exoHandler = () => "throw";
    let netErr: any = null;
    try { await fakeExotel.placeCall(creds, { callId: "e", businessAccountId: R, to: "+919812345678", streamUrl: "wss://x", statusCallbackUrl: "", record: false, timeLimitSec: 60 }); } catch (e) { netErr = e; }
    expect(netErr && /Could not reach Exotel/.test(netErr.message) && !netErr.permanent, "network failure → retryable plain message", netErr?.message);

    // Webhook parsing.
    const p1 = exotel.parseExotelStatusWebhook({ CallSid: "CA1", Status: "completed", ConversationDuration: "42", RecordingUrl: "https://recordings.exotel.com/a.mp3", DateUpdated: "2026-10-04 12:00:00" });
    expect(p1?.status === "completed" && p1.durationSec === 42 && p1.recordingUrl === "https://recordings.exotel.com/a.mp3" && p1.endedAt?.toISOString() === "2026-10-04T06:30:00.000Z",
      "webhook: completed + duration + recording + IST DateUpdated", p1);
    expect(exotel.parseExotelStatusWebhook({ CallSid: "CA1", Status: "no-answer" })?.status === "no_answer" && exotel.parseExotelStatusWebhook({ CallSid: "CA1", Status: "busy" })?.status === "busy"
      && exotel.parseExotelStatusWebhook({ CallSid: "CA1", Status: "failed" })?.status === "failed" && exotel.parseExotelStatusWebhook({ CallSid: "CA1", Status: "in-progress" })?.status === "in_progress"
      && exotel.parseExotelStatusWebhook({ CallSid: "CA1", Status: "ringing" })?.status === "ringing" && exotel.parseExotelStatusWebhook({ CallSid: "CA1", Status: "weird" }) === null
      && exotel.parseExotelStatusWebhook({ Status: "completed" }) === null, "webhook: status mapping (no-answer/busy/failed/in-progress/ringing; unknown or no sid ignored)");
    expect(exotel.isAllowedRecordingUrl("https://recordings.exotel.com/a.mp3").sendAuth && exotel.isAllowedRecordingUrl("https://s3.ap-south-1.amazonaws.com/x.mp3").ok
      && !exotel.isAllowedRecordingUrl("http://recordings.exotel.com/a.mp3").ok && !exotel.isAllowedRecordingUrl("https://169.254.169.254/latest").ok, "recording URL allow-list (https Exotel/S3 only)");

    // ═══ 4. Calling hours maths ══════════════════════════════════════════════
    const H = { start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5, 6], timezone: "Asia/Kolkata" };
    const t = (s: string) => new Date(s);
    expect(settingsSvc.nextAllowedTime(t("2026-01-05T02:30:00Z"), H).toISOString() === "2026-01-05T04:30:00.000Z", "08:00 IST Monday → 10:00 IST same day");
    expect(settingsSvc.nextAllowedTime(t("2026-01-05T06:00:00Z"), H).toISOString() === "2026-01-05T06:00:00.000Z", "inside the window → now");
    expect(settingsSvc.nextAllowedTime(t("2026-01-05T14:30:00Z"), H).toISOString() === "2026-01-06T04:30:00.000Z", "20:00 IST → next day 10:00");
    expect(settingsSvc.nextAllowedTime(t("2026-01-04T06:30:00Z"), H).toISOString() === "2026-01-05T04:30:00.000Z", "Sunday (not allowed) → Monday 10:00");
    expect(settingsSvc.nextAllowedTime(t("2026-03-08T01:00:00Z"), { start: "10:00", end: "18:00", days: [0, 1, 2, 3, 4, 5, 6], timezone: "America/New_York" }).toISOString() === "2026-03-08T14:00:00.000Z",
      "DST day in New York → 10:00 EDT (14:00Z)");

    // ═══ 5. Dialer ═══════════════════════════════════════════════════════════
    await clearQueue();
    await setSettings(D, { enabled: true, provider: "simulator", callingHours: H, concurrentCallLimit: 20, maxAttempts: 3, retryGapMinutes: 15 });
    // 5a calling hours reschedule (fixed past "now", 08:00 IST)
    const nowEarly = t("2026-01-05T02:30:00Z");
    const cHours = await dialer.enqueueCall({ businessAccountId: D, phone: uniqPhone(), trigger: "manual", provider: "simulator", scheduledAt: new Date(nowEarly.getTime() - 60_000) });
    let rep = await dialer.runDialerTick(nowEarly);
    let row = await callRow(cHours.id);
    expect(row.status === "queued" && row.scheduledAt?.toISOString() === "2026-01-05T04:30:00.000Z" && (row.metadata as any)?.waitReason === "outside_hours" && !placed.includes(cHours.id),
      "dialer: outside calling hours → back to the queue at the next window start", { status: row.status, at: row.scheduledAt, rep });
    await clearQueue();
    await setSettings(D, { callingHours: ALL_DAY });

    // 5b do-not-call
    const dncPhone = uniqPhone();
    await dialer.addDoNotCall(D, dncPhone, { reason: "test" });
    const cDnc = await enqueue(D, dncPhone);
    await dialer.runDialerTick();
    row = await callRow(cDnc.id);
    expect(row.status === "skipped" && row.endReason === "do_not_call" && !placed.includes(cDnc.id), "dialer: do-not-call number → skipped, never dialled", row.status);

    // 5c consent
    await setSettings(D, { consentMode: "explicit" });
    const leadNo = await mkLead(D);
    const leadYes = await mkLead(D, { callConsent: "yes", callConsentSource: "form" });
    const convAsk = await mkConversation(D, "Chat", ["hi, what are your prices?", "please call me back tomorrow"]);
    const leadChat = await mkLead(D, { conversationId: convAsk.id });
    const leadRefused = await mkLead(D, { callConsent: "no" });
    const cNo = await enqueue(D, uniqPhone(), { trigger: "auto_lead", leadId: leadNo.id });
    const cYes = await enqueue(D, uniqPhone(), { trigger: "auto_lead", leadId: leadYes.id });
    const cChat = await enqueue(D, uniqPhone(), { trigger: "auto_lead", leadId: leadChat.id });
    const cManualNoConsent = await enqueue(D, uniqPhone(), { trigger: "manual", leadId: leadNo.id });
    await dialer.runDialerTick();
    expect((await callRow(cNo.id)).status === "skipped" && (await callRow(cNo.id)).endReason === "no_consent", "explicit consent: lead without consent → skipped (no_consent)");
    expect(placed.includes(cYes.id) && (await callRow(cYes.id)).status === "ringing" && (await callRow(cYes.id)).providerCallSid === `SIM-${cYes.id}`, "explicit consent: consenting lead → placed (simulator rings, SIM-<id>)");
    const leadChatAfter = (await db.select().from(schema.leads).where(eq(schema.leads.id, leadChat.id)))[0];
    expect(placed.includes(cChat.id) && leadChatAfter.callConsent === "yes" && leadChatAfter.callConsentSource === "chat", "explicit consent: 'please call me back' in chat → consent recorded (chat) and placed");
    expect(placed.includes(cManualNoConsent.id), "manual call skips the consent rule");
    await clearQueue();
    await setSettings(D, { consentMode: "business_attested", attestConsent: true });
    const cAtt = await enqueue(D, uniqPhone(), { trigger: "auto_lead", leadId: (await mkLead(D)).id });
    const cRef = await enqueue(D, uniqPhone(), { trigger: "auto_lead", leadId: leadRefused.id });
    await dialer.runDialerTick();
    expect(placed.includes(cAtt.id), "attested consent: any lead with a phone → placed");
    expect((await callRow(cRef.id)).status === "skipped" && !placed.includes(cRef.id), "attested consent: lead who said no → still skipped");
    await clearQueue();

    // 5d monthly caps
    await db.insert(schema.aiCalls).values({ businessAccountId: D, direction: "outbound", status: "completed", trigger: "manual", provider: "simulator", phone: uniqPhone(), billedSeconds: 600, postProcessedAt: new Date() });
    await setSettings(D, { monthlyMinuteLimit: 10 });
    const cCap = await enqueue(D, uniqPhone());
    await dialer.runDialerTick();
    row = await callRow(cCap.id);
    expect(row.status === "skipped" && row.endReason === "limit_reached" && /limit is reached/.test(row.errorMessage || ""), "business monthly minute limit reached → skipped with reason", row.errorMessage);
    await setSettings(D, { monthlyMinuteLimit: null });
    await settingsSvc.setSuperAdminMinuteCap(D, 5);
    const cCap2 = await enqueue(D, uniqPhone());
    await dialer.runDialerTick();
    row = await callRow(cCap2.id);
    expect(row.status === "skipped" && row.endReason === "limit_reached" && /plan/.test(row.errorMessage || ""), "super admin minute cap reached → skipped (plan message)", row.errorMessage);
    await settingsSvc.setSuperAdminMinuteCap(D, null);
    systemSettingsService.clearCache?.();

    // 5e concurrency
    await clearQueue();
    await setSettings(D, { concurrentCallLimit: 1 });
    await db.insert(schema.aiCalls).values({ businessAccountId: D, direction: "outbound", status: "in_progress", trigger: "manual", provider: "simulator", phone: uniqPhone(), startedAt: new Date(), answeredAt: new Date() });
    const cWait = await enqueue(D, uniqPhone());
    const before5e = Date.now();
    await dialer.runDialerTick();
    row = await callRow(cWait.id);
    expect(row.status === "queued" && (row.metadata as any)?.waitReason === "waiting_for_free_line" && row.scheduledAt!.getTime() >= before5e + 15_000 && !placed.includes(cWait.id),
      "concurrency limit reached → waits (re-queued ~20 s later)", { status: row.status, meta: row.metadata });
    await clearQueue();

    // 5f atomic claim: two concurrent ticks never dial a call twice
    await setSettings(D, { concurrentCallLimit: 20 });
    const many = await Promise.all([1, 2, 3, 4, 5].map(() => enqueue(D, uniqPhone())));
    const placedBefore = placed.length;
    await Promise.all([dialer.runDialerTick(), dialer.runDialerTick(), dialer.runDialerTick()]);
    const newly = placed.slice(placedBefore);
    expect(newly.length === 5 && new Set(newly).size === 5 && many.every((c) => newly.includes(c.id)), "three concurrent ticks: each of 5 calls dialled exactly once", newly.length);
    // concurrency under concurrent ticks: limit 2 → at most 2 placed
    await clearQueue();
    await setSettings(D, { concurrentCallLimit: 2 });
    await Promise.all([1, 2, 3, 4].map(() => enqueue(D, uniqPhone())));
    const pb = placed.length;
    await Promise.all([dialer.runDialerTick(), dialer.runDialerTick()]);
    expect(placed.length - pb === 2, "concurrent ticks respect the concurrency limit (2 of 4 placed)", placed.length - pb);
    await clearQueue();
    await setSettings(D, { concurrentCallLimit: 20 });

    // 5g stale simulator ringing → no_answer (+ retry chain starts)
    const [ringing] = await db.insert(schema.aiCalls).values({ businessAccountId: D, direction: "outbound", status: "ringing", trigger: "manual", provider: "simulator", phone: uniqPhone(), providerCallSid: "SIM-x", startedAt: new Date(Date.now() - 60_000), attempt: 1, metadata: { rootTrigger: "manual" } }).returning();
    rep = await dialer.runDialerTick();
    row = await callRow(ringing.id);
    const retryOfRinging = (await callsOf(D)).find((c) => c.parentCallId === ringing.id);
    expect(row.status === "no_answer" && row.endReason === "not_answered" && row.postProcessedAt && rep.recovered.includes(ringing.id), "simulator call ringing > 45 s → no_answer + post-processed", row.status);
    expect(retryOfRinging?.status === "queued" && retryOfRinging.attempt === 2 && retryOfRinging.trigger === "retry", "…and a retry is queued (attempt 2)", retryOfRinging);
    await clearQueue();

    // 5h stale claim recovery: claimed but never sent → re-queued; sent but no provider id → failed, not redialled
    const [stuck1] = await db.insert(schema.aiCalls).values({ businessAccountId: D, direction: "outbound", status: "dialing", trigger: "manual", provider: "simulator", phone: uniqPhone(), claimedAt: new Date(Date.now() - 10 * 60_000), scheduledAt: new Date(Date.now() + 3600_000) }).returning();
    const [stuck2] = await db.insert(schema.aiCalls).values({ businessAccountId: D, direction: "outbound", status: "dialing", trigger: "manual", provider: "simulator", phone: uniqPhone(), claimedAt: new Date(Date.now() - 10 * 60_000), startedAt: new Date(Date.now() - 10 * 60_000), attempt: 3 }).returning();
    await dialer.runDialerTick();
    expect((await callRow(stuck1.id)).status === "queued", "stale claim that never reached the provider → back to the queue");
    expect((await callRow(stuck2.id)).status === "failed" && (await callRow(stuck2.id)).endReason === "interrupted" && !placed.includes(stuck2.id), "stale claim that reached the provider → failed, not redialled");
    await clearQueue();

    // 5i Exotel via the dialer: no public URL → clear failure; with URL → placed with signed URLs
    await setSettings(D, { provider: "exotel", exotelApiKey: RAW_KEY, exotelApiToken: RAW_TOKEN, exotel: { accountSid: "acme1", callerId: "08047112345", flowAppId: null } });
    const savedEnv = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    const cNoUrl = await enqueue(D, uniqPhone(), { provider: "exotel" });
    await dialer.runDialerTick();
    row = await callRow(cNoUrl.id);
    expect(row.status === "failed" && /public web address/.test(row.errorMessage || "") && (row.metadata as any)?.permanentFailure === true, "Exotel without a public base URL → failed with a clear error", row.errorMessage);
    expect(!(await callsOf(D)).some((c) => c.parentCallId === cNoUrl.id), "…and no automatic retry for that setup error");
    process.env.PUBLIC_BASE_URL = savedEnv;
    exoHandler = () => ({ status: 200, body: { Call: { Sid: "CAdialer1", Status: "queued" } } });
    const cExo = await enqueue(D, "+919811112222", { provider: "simulator" });
    await dialer.runDialerTick();
    row = await callRow(cExo.id);
    const exoReq = exoRequests[exoRequests.length - 1];
    const exoForm = new URLSearchParams(exoReq.body);
    const streamTok = (exoForm.get("StreamUrl") || "").split("/api/calling/stream/")[1]?.split("?")[0] || "";
    const statusTok = (exoForm.get("StatusCallback") || "").split("/status/")[1] || "";
    expect(row.status === "dialing" && row.provider === "exotel" && row.providerCallSid === "CAdialer1" && row.callerId === "08047112345" && row.startedAt,
      "Exotel call placed by the dialer (provider taken from current settings; SID + caller id saved)", row);
    expect(exoForm.get("StreamUrl")!.startsWith("wss://portal.example.com/api/calling/stream/") && tokens.verifyCallToken(streamTok, "stream") === cExo.id
      && tokens.verifyCallToken(statusTok, "status") === cExo.id && exoForm.get("TimeLimit") === "300", "signed stream + status URLs for this call", Object.fromEntries(exoForm));

    // ═══ 6. Webhook route ════════════════════════════════════════════════════
    r = await call("POST", `/api/calling/webhooks/exotel/status/${cExo.id}.9999999999.bad`, null, { CallSid: "CAdialer1", Status: "completed" });
    expect(r.status === 403, "webhook with a bad token → 403", r.status);
    r = await call("POST", `/api/calling/webhooks/exotel/status/${tokens.signCallToken(cExo.id, "stream")}`, null, { CallSid: "CAdialer1", Status: "completed" });
    expect(r.status === 403, "stream token can't be used as a status token", r.status);
    const goodTok = tokens.signCallToken(cExo.id, "status");
    let res = await fetch(`${base}/api/calling/webhooks/exotel/status/${goodTok}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "CallSid=CAdialer1&Status=in-progress&EventType=answered" });
    row = await callRow(cExo.id);
    expect(res.status === 200 && row.status === "in_progress" && row.answeredAt, "form-encoded 'answered' webhook → on the call", row.status);
    r = await call("POST", `/api/calling/webhooks/exotel/status/${goodTok}`, null, { CallSid: "CAother", Status: "completed" });
    expect(r.json?.ignored === true && (await callRow(cExo.id)).status === "in_progress", "webhook for a different call sid is ignored");
    r = await call("POST", `/api/calling/webhooks/exotel/status/${goodTok}`, null, { CallSid: "CAdialer1", Status: "completed", ConversationDuration: "65", RecordingUrl: "https://recordings.exotel.com/rec1.mp3" });
    row = await callRow(cExo.id);
    expect(r.status === 200 && row.status === "completed" && row.durationSec === 65 && row.recordingUrl === "https://recordings.exotel.com/rec1.mp3" && row.postProcessedAt && row.billedSeconds === 120,
      "terminal JSON webhook → completed, duration, recording, post-processed (billed 2 min)", row);
    r = await call("POST", `/api/calling/webhooks/exotel/status/${goodTok}`, null, { CallSid: "CAdialer1", Status: "completed", ConversationDuration: "65", RecordingUrl: "https://recordings.exotel.com/rec1.mp3" });
    const meterRows = await db.select().from(schema.aiUsageEvents).where(sql`${schema.aiUsageEvents.metadata}->>'callId' = ${cExo.id}`);
    expect(r.status === 200 && meterRows.length === 1 && meterRows[0].category === "calling" && meterRows[0].model === "calling:exotel" && Number(meterRows[0].costUsd) > 0.029 && Number(meterRows[0].costUsd) < 0.031,
      "repeated webhook is idempotent: one 'calling' usage row (2 min × $0.015)", meterRows.map((m) => [m.category, m.costUsd]));
    await setSettings(D, { provider: "simulator" });
    await clearQueue();

    // ═══ 7. Lead trigger ═════════════════════════════════════════════════════
    await setSettings(L, { enabled: true, autoCallLeads: true, autoCallSources: ["website"], autoCallDelayMinutes: 5, callingHours: ALL_DAY, consentMode: "business_attested", attestConsent: true });
    const convW = await mkConversation(L, "Chat");
    const leadW = await mkLead(L, { conversationId: convW.id });
    const t0 = Date.now();
    let tr = await trigger.enqueueAutoLeadCall(leadW);
    expect(tr.queued && tr.call!.trigger === "auto_lead" && tr.call!.leadId === leadW.id && tr.call!.phone === `+91${leadW.phone}` && (tr.call!.metadata as any)?.leadSource === "website",
      "website lead → auto call queued (phone normalised, source recorded)", tr);
    const delayMs = tr.call!.scheduledAt!.getTime() - t0;
    expect(delayMs >= 5 * 60_000 - 2000 && delayMs <= 5 * 60_000 + 5000, "scheduled after the 5-minute delay", delayMs);
    tr = await trigger.enqueueAutoLeadCall(leadW);
    expect(!tr.queued && tr.reason === "already_called", "same lead again → not queued twice", tr.reason);
    const leadSamePhone = await mkLead(L, { phone: leadW.phone, conversationId: (await mkConversation(L)).id });
    tr = await trigger.enqueueAutoLeadCall(leadSamePhone);
    expect(!tr.queued && tr.reason === "duplicate", "another lead with the same number within 24 h → not queued", tr.reason);
    tr = await trigger.enqueueAutoLeadCall(await mkLead(L, { message: "Added by staff" }));
    expect(!tr.queued && tr.reason === "source_not_selected", "source filter: staff-added lead ('other') not called when only 'website' is selected", tr.reason);
    tr = await trigger.enqueueAutoLeadCall(await mkLead(L, { conversationId: (await mkConversation(L, "Voice Chat")).id }));
    expect(!tr.queued && tr.reason === "source_not_selected", "voice-mode lead is source 'voice'", tr.reason);
    expect(await trigger.deriveLeadSource({ conversationId: null, message: "Journey: abc", businessAccountId: L }) === "form"
      && await trigger.deriveLeadSource({ conversationId: null, message: "Via Chat", businessAccountId: L }) === "website", "source mapping: journey → form, 'Via Chat' → website");
    tr = await trigger.enqueueAutoLeadCall(await mkLead(L, { phone: "12" }));
    expect(!tr.queued && tr.reason === "no_phone", "unusable phone → not queued");
    const dncLead = await mkLead(L, { conversationId: (await mkConversation(L)).id });
    await dialer.addDoNotCall(L, `+91${dncLead.phone}`, {});
    tr = await trigger.enqueueAutoLeadCall(dncLead);
    expect(!tr.queued && tr.reason === "do_not_call", "do-not-call number → not queued");
    await setSettings(L, { callingHours: { start: "10:00", end: "11:00", days: [((new Date().getUTCDay()) + 2) % 7], timezone: "Asia/Kolkata" }, autoCallSources: [] });
    tr = await trigger.enqueueAutoLeadCall(await mkLead(L, { message: "Added by staff" }));
    expect(tr.queued && tr.call!.scheduledAt!.getTime() > Date.now() + 24 * 3600_000, "empty source list = all sources; outside hours → scheduled at the next window", tr.call?.scheduledAt);
    await setSettings(L, { callingHours: ALL_DAY });
    // never throws
    let threw = false;
    try {
      trigger.triggerAutoLeadCall(null);
      trigger.triggerAutoLeadCall({ ...(await mkLead(L)), id: "00000000-0000-0000-0000-000000000000", conversationId: null, message: "x" } as any); // FK failure inside
    } catch { threw = true; }
    await sleep(300);
    expect(!threw && unhandled === 0, "trigger never throws into lead saving (even when the insert fails)", { threw, unhandled });
    // hooks: storage.createLead / updateLead / leadStore
    const convH = await mkConversation(L);
    const hooked = await storage.createLead({ businessAccountId: L, name: "Hook", phone: "9811100001", conversationId: convH.id } as any);
    expect(await until(async () => (await callsOf(L)).some((c) => c.leadId === hooked.id)), "storage.createLead hook queues the auto call");
    const noPhone = await storage.createLead({ businessAccountId: L, name: "Later", conversationId: (await mkConversation(L)).id } as any);
    await sleep(150);
    expect(!(await callsOf(L)).some((c) => c.leadId === noPhone.id), "lead without a phone → nothing queued");
    await storage.updateLead(noPhone.id, L, { phone: "9811100002" } as any);
    expect(await until(async () => (await callsOf(L)).some((c) => c.leadId === noPhone.id)), "storage.updateLead: first phone → auto call queued");
    const convU = await mkConversation(L);
    const up = await upsertConversationLead({ businessAccountId: L, conversationId: convU.id, values: { name: "Upsert", phone: "9811100003" } });
    expect(await until(async () => (await callsOf(L)).some((c) => c.leadId === up.lead.id)), "chat lead path (upsertConversationLead) queues the auto call");
    await setSettings(L, { autoCallLeads: false });
    const off = await storage.createLead({ businessAccountId: L, name: "Off", phone: "9811100004" } as any);
    await sleep(200);
    expect(!(await callsOf(L)).some((c) => c.leadId === off.id), "auto calls switched off → nothing queued");
    await clearQueue();

    // ═══ 8. Lifecycle ════════════════════════════════════════════════════════
    await setSettings(F, { enabled: true, callingHours: ALL_DAY, maxAttempts: 3, retryGapMinutes: 15, whatsappFollowUp: false });
    await db.update(schema.aiCallingSettings).set({ whatsappFollowUp: true, whatsappFollowUpTemplateId: "tpl-1" }).where(eq(schema.aiCallingSettings.businessAccountId, F));
    const convF = await mkConversation(F, "Phone call");
    await db.insert(schema.messages).values([
      { conversationId: convF.id, role: "assistant", content: "Hi, this is Chroney from the store. You enquired about sofas?" },
      { conversationId: convF.id, role: "user", content: "Yes, I'm Ravi. Can you send prices?" },
    ]);
    const leadF = await mkLead(F, { name: null, email: null });
    const answeredAt = new Date(Date.now() - 70_000);
    const [done] = await db.insert(schema.aiCalls).values({
      businessAccountId: F, direction: "outbound", status: "completed", trigger: "auto_lead", provider: "simulator", phone: `+91${leadF.phone}`,
      leadId: leadF.id, conversationId: convF.id, answeredAt, endedAt: new Date(answeredAt.getTime() + 65_000), startedAt: answeredAt, metadata: { rootTrigger: "auto_lead" },
    }).returning();
    summaryResult = { summary: "Ravi wants sofa prices.", outcome: "interested", outcomeNote: "Send price list", callbackAt: null, capturedFields: { name: "Ravi Kumar", email: "ravi@example.com" } };
    await Promise.all([lifecycle.processFinishedCall(done.id), lifecycle.processFinishedCall(done.id), lifecycle.processFinishedCall(done.id)]);
    row = await callRow(done.id);
    const meterF = await db.select().from(schema.aiUsageEvents).where(sql`${schema.aiUsageEvents.metadata}->>'callId' = ${done.id}`);
    expect(summaryCalls.length === 1 && summaryCalls[0].transcript.length === 2 && summaryCalls[0].transcript[1].role === "user", "summariser called once with the call transcript", summaryCalls.length);
    expect(row.summary === "Ravi wants sofa prices." && row.outcome === "interested" && row.outcomeNote === "Send price list" && row.durationSec === 65 && row.billedSeconds === 120 && (row.capturedFields as any)?.email === "ravi@example.com",
      "summary, outcome, captured fields, duration + billed seconds saved", row);
    expect(meterF.length === 1 && meterF[0].category === "calling" && meterF[0].model === "calling:simulator" && (meterF[0].metadata as any)?.seconds === 120 && (meterF[0].metadata as any)?.feature === "ai_calling",
      "processing three times concurrently → exactly one metering row (category 'calling')", meterF.length);
    expect(followUps.length === 1 && followUps[0].templateId === "tpl-1" && followUps[0].leadName === "Ravi Kumar" && followUps[0].phone === `+91${leadF.phone}` && row.followUpSentAt,
      "answered call → one WhatsApp follow-up with the lead's name", followUps);
    const leadFAfter = (await db.select().from(schema.leads).where(eq(schema.leads.id, leadF.id)))[0];
    expect(leadFAfter.name === "Ravi Kumar" && leadFAfter.email === "ravi@example.com", "lead's empty name/email filled from the call", leadFAfter);
    expect(!(await callsOf(F)).some((c) => c.parentCallId === done.id), "answered call → no retry");

    // follow-up failure releases the claim
    followUpResult = { success: false, error: "template not approved" };
    const [done2] = await db.insert(schema.aiCalls).values({ businessAccountId: F, direction: "inbound", status: "completed", trigger: "inbound", provider: "simulator", phone: uniqPhone(), answeredAt: new Date(Date.now() - 30_000), endedAt: new Date(), durationSec: 30, outcome: "info_given" }).returning();
    await lifecycle.processFinishedCall(done2.id);
    row = await callRow(done2.id);
    expect(followUps.length === 2 && row.followUpSentAt === null && (row.metadata as any)?.followUpError === "template not approved" && row.outcome === "info_given",
      "failed follow-up recorded (not marked sent); outcome set by the voice AI kept", row.metadata);
    followUpResult = { success: true };

    // retries chain + maxAttempts
    const phoneRetry = uniqPhone();
    const [na1] = await db.insert(schema.aiCalls).values({ businessAccountId: F, direction: "outbound", status: "no_answer", trigger: "auto_lead", provider: "simulator", phone: phoneRetry, attempt: 1, endedAt: new Date(), metadata: { rootTrigger: "auto_lead" } }).returning();
    const tRetry = Date.now();
    await lifecycle.processFinishedCall(na1.id);
    const r2 = (await callsOf(F)).find((c) => c.parentCallId === na1.id)!;
    expect(r2 && r2.attempt === 2 && r2.trigger === "retry" && r2.status === "queued" && (r2.metadata as any)?.rootTrigger === "auto_lead"
      && Math.abs(r2.scheduledAt!.getTime() - (tRetry + 15 * 60_000)) < 5000, "no answer → retry queued after the retry gap (attempt 2, keeps root trigger)", r2);
    expect((await callRow(na1.id)).outcome === "no_answer" && followUps.length === 2, "no-answer outcome; no follow-up for unanswered calls");
    await db.update(schema.aiCalls).set({ status: "busy", endedAt: new Date() }).where(eq(schema.aiCalls.id, r2.id));
    await lifecycle.processFinishedCall(r2.id);
    const r3 = (await callsOf(F)).find((c) => c.parentCallId === r2.id)!;
    expect(r3 && r3.attempt === 3, "busy → attempt 3 queued", r3?.attempt);
    await db.update(schema.aiCalls).set({ status: "voicemail", endedAt: new Date() }).where(eq(schema.aiCalls.id, r3.id));
    await lifecycle.processFinishedCall(r3.id);
    expect(!(await callsOf(F)).some((c) => c.parentCallId === r3.id), "attempt 3 of 3 → no more retries (maxAttempts)");
    const [perm] = await db.insert(schema.aiCalls).values({ businessAccountId: F, direction: "outbound", status: "failed", trigger: "manual", provider: "exotel", phone: uniqPhone(), attempt: 1, endedAt: new Date(), metadata: { permanentFailure: true } }).returning();
    const [temp] = await db.insert(schema.aiCalls).values({ businessAccountId: F, direction: "outbound", status: "failed", trigger: "manual", provider: "exotel", phone: uniqPhone(), attempt: 1, endedAt: new Date(), metadata: { permanentFailure: false } }).returning();
    await lifecycle.processFinishedCall(perm.id);
    await lifecycle.processFinishedCall(temp.id);
    expect(!(await callsOf(F)).some((c) => c.parentCallId === perm.id) && (await callsOf(F)).some((c) => c.parentCallId === temp.id), "permanent failure → no retry; temporary failure → retry");

    // callback scheduling
    const convCb = await mkConversation(F, "Phone call", ["call me tomorrow at 3 pm"]);
    const cbAt = new Date(Date.now() + 26 * 3600_000);
    summaryResult = { summary: "Busy now, call tomorrow.", outcome: "callback_requested", outcomeNote: null, callbackAt: cbAt, capturedFields: {} };
    const leadCb = await mkLead(F);
    const [cbCall] = await db.insert(schema.aiCalls).values({ businessAccountId: F, direction: "outbound", status: "completed", trigger: "auto_lead", provider: "simulator", phone: `+91${leadCb.phone}`, leadId: leadCb.id, conversationId: convCb.id, answeredAt: new Date(Date.now() - 20_000), endedAt: new Date(), metadata: { rootTrigger: "auto_lead" } }).returning();
    await lifecycle.processFinishedCall(cbCall.id);
    const cbNext = (await callsOf(F)).find((c) => c.parentCallId === cbCall.id);
    expect(cbNext?.trigger === "callback" && cbNext.status === "queued" && cbNext.scheduledAt?.getTime() === cbAt.getTime() && (await callRow(cbCall.id)).callbackAt?.getTime() === cbAt.getTime(),
      "callback requested → 'callback' call queued at the requested time", cbNext);
    expect((await db.select().from(schema.leads).where(eq(schema.leads.id, leadCb.id)))[0].callConsent === "yes", "callback request records call consent on the lead");
    await setSettings(F, { callingHours: { start: "10:00", end: "19:00", days: [0, 1, 2, 3, 4, 5, 6], timezone: "Asia/Kolkata" } });
    const lateIst = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 2, 16, 30)); // 22:00 IST
    summaryResult = { ...summaryResult, callbackAt: lateIst };
    const [cbCall2] = await db.insert(schema.aiCalls).values({ businessAccountId: F, direction: "outbound", status: "completed", trigger: "manual", provider: "simulator", phone: uniqPhone(), conversationId: convCb.id, answeredAt: new Date(Date.now() - 20_000), endedAt: new Date() }).returning();
    await lifecycle.processFinishedCall(cbCall2.id);
    const cbNext2 = (await callsOf(F)).find((c) => c.parentCallId === cbCall2.id);
    expect(cbNext2 && cbNext2.scheduledAt!.toISOString() === new Date(lateIst.getTime() + 12 * 3600_000).toISOString(), "callback at 22:00 IST → moved to 10:00 IST next morning", cbNext2?.scheduledAt);
    await setSettings(F, { callingHours: ALL_DAY });

    // do_not_call outcome
    const leadDnc = await mkLead(F, { callConsent: "yes" });
    const dncPhoneF = `+91${leadDnc.phone}`;
    const waiting = await dialer.enqueueCall({ businessAccountId: F, phone: dncPhoneF, trigger: "manual", provider: "simulator", scheduledAt: new Date(Date.now() + 3600_000) });
    const [dncCall] = await db.insert(schema.aiCalls).values({ businessAccountId: F, direction: "outbound", status: "completed", trigger: "auto_lead", provider: "simulator", phone: dncPhoneF, leadId: leadDnc.id, outcome: "do_not_call", answeredAt: new Date(Date.now() - 15_000), endedAt: new Date() }).returning();
    const fuBefore = followUps.length;
    await lifecycle.processFinishedCall(dncCall.id);
    const dncRows = await db.select().from(schema.aiCallDoNotCall).where(and(eq(schema.aiCallDoNotCall.businessAccountId, F), eq(schema.aiCallDoNotCall.phone, dncPhoneF)));
    const leadDncAfter = (await db.select().from(schema.leads).where(eq(schema.leads.id, leadDnc.id)))[0];
    expect(dncRows.length === 1 && dncRows[0].source === "call" && dncRows[0].callId === dncCall.id, "'do not call me' → number added to the do-not-call list (source call)", dncRows);
    expect(leadDncAfter.callConsent === "no" && leadDncAfter.callConsentSource === "call", "lead consent set to 'no'");
    expect((await callRow(waiting.id)).status === "skipped" && followUps.length === fuBefore, "waiting calls to that number skipped; no WhatsApp follow-up", (await callRow(waiting.id)).status);

    // in_progress closed by processFinishedCall
    const [live] = await db.insert(schema.aiCalls).values({ businessAccountId: F, direction: "inbound", status: "in_progress", trigger: "inbound", provider: "simulator", phone: uniqPhone(), answeredAt: new Date(Date.now() - 30_000) }).returning();
    summaryResult = null;
    await lifecycle.processFinishedCall(live.id);
    row = await callRow(live.id);
    expect(row.status === "completed" && row.durationSec! >= 29 && row.durationSec! <= 32 && row.billedSeconds === 60 && row.outcome === "info_given" && row.postProcessedAt,
      "call still 'on the call' → closed as completed (duration, 1 billed minute, fallback outcome)", row);
    const [notDone] = await db.insert(schema.aiCalls).values({ businessAccountId: F, direction: "outbound", status: "ringing", trigger: "manual", provider: "simulator", phone: uniqPhone() }).returning();
    await lifecycle.processFinishedCall(notDone.id);
    expect(!(await callRow(notDone.id)).postProcessedAt, "ringing call is not post-processed");
    expect(lifecycle.billedSecondsFor(1, true) === 60 && lifecycle.billedSecondsFor(61, true) === 120 && lifecycle.billedSecondsFor(100, false) === 0, "billing rounds up to whole minutes, answered only");
    await clearQueue();

    // ═══ 9. Business routes ══════════════════════════════════════════════════
    await call("PUT", "/api/calling/settings", cR, { enabled: false });
    r = await call("POST", "/api/calling/calls", cR, { phone: "9812345678" });
    expect(r.status === 400 && /Turn on AI Calling/.test(r.json.error), "manual call while settings are off → 400", r.json);
    await call("PUT", "/api/calling/settings", cR, { enabled: true, provider: "simulator", callingHours: ALL_DAY, concurrentCallLimit: 5 });
    r = await call("POST", "/api/calling/calls", cR, { phone: "abc" });
    expect(r.status === 400, "manual call: invalid phone → 400");
    const leadR = await mkLead(R, { name: "Meera" });
    r = await call("POST", "/api/calling/calls", cR, { leadId: leadR.id, note: "asked for a demo" });
    expect(r.status === 201 && r.json.call.status === "queued" && r.json.call.trigger === "manual" && r.json.call.leadName === "Meera" && r.json.call.phone === `+91${leadR.phone}` && r.json.message === "Calling now.",
      "manual call for a lead → queued now", r.json);
    const manualId = r.json.call.id;
    expect((await callRow(manualId)).requestedBy && ((await callRow(manualId)).metadata as any)?.note === "asked for a demo", "requested-by + note stored");
    r = await call("POST", "/api/calling/calls", cR, { leadId: leadR.id });
    expect(r.status === 409 && r.json.call?.id === manualId, "second call to the same number while one is waiting → 409", r.status);
    r = await call("POST", `/api/calling/calls/${manualId}/cancel`, cR, {});
    expect(r.status === 200 && r.json.call.status === "cancelled", "cancel a waiting call", r.json);
    r = await call("POST", `/api/calling/calls/${manualId}/cancel`, cR, {});
    expect(r.status === 409, "cancel again → 409", r.status);
    r = await call("POST", "/api/calling/do-not-call", cR, { phone: "+91 98111 22233", reason: "Asked by email" });
    expect(r.status === 201 && r.json.item.phone === "+919811122233", "do-not-call add (normalised)", r.json);
    const dncId = r.json.item.id;
    r = await call("POST", "/api/calling/do-not-call", cR, { phone: "9811122233" });
    expect(r.status === 200 && r.json.alreadyListed === true, "adding twice → already listed");
    r = await call("POST", "/api/calling/calls", cR, { phone: "9811122233" });
    expect(r.status === 400 && /do-not-call/.test(r.json.error), "manual call to a do-not-call number → 400", r.json);
    r = await call("GET", "/api/calling/do-not-call?search=98111", cR);
    expect(r.status === 200 && r.json.total === 1 && r.json.items[0].reason === "Asked by email", "do-not-call list with search", r.json);
    r = await call("DELETE", `/api/calling/do-not-call/${dncId}`, cR);
    expect(r.status === 200 && (await call("GET", "/api/calling/do-not-call", cR)).json.total === 0, "do-not-call delete");
    // outside hours → scheduled later with a message
    await call("PUT", "/api/calling/settings", cR, { callingHours: { start: "10:00", end: "11:00", days: [((new Date().getUTCDay()) + 2) % 7], timezone: "Asia/Kolkata" } });
    r = await call("POST", "/api/calling/calls", cR, { phone: "9822233344", name: "Walk-in" });
    expect(r.status === 201 && /outside your calling hours/.test(r.json.message) && new Date(r.json.scheduledAt).getTime() > Date.now() + 24 * 3600_000 && r.json.call.leadName === "Walk-in",
      "manual call outside calling hours → queued for the next window with a clear message", r.json);
    await call("PUT", "/api/calling/settings", cR, { callingHours: ALL_DAY });
    // a finished call with transcript for list/detail
    const convR = await mkConversation(R, "Phone call");
    await db.insert(schema.messages).values([
      { conversationId: convR.id, role: "assistant", content: "Hello Meera!" },
      { conversationId: convR.id, role: "user", content: "Hi, tell me about the demo." },
      { conversationId: convR.id, role: "system", content: "internal" },
    ]);
    const [fin] = await db.insert(schema.aiCalls).values({ businessAccountId: R, direction: "outbound", status: "completed", trigger: "manual", provider: "exotel", phone: `+91${leadR.phone}`, leadId: leadR.id, conversationId: convR.id, answeredAt: new Date(Date.now() - 50_000), endedAt: new Date(), durationSec: 50, billedSeconds: 60, outcome: "interested", summary: "Wants a demo.", recordingUrl: "https://recordings.exotel.com/r9.mp3", postProcessedAt: new Date() }).returning();
    r = await call("GET", "/api/calling/calls?status=completed&search=Meera", cR);
    expect(r.status === 200 && r.json.total === 1 && r.json.calls[0].id === fin.id && r.json.calls[0].hasRecording === true && r.json.calls[0].leadName === "Meera", "calls list filters by status + lead-name search", r.json);
    r = await call("GET", "/api/calling/calls?outcome=interested&direction=outbound&limit=1", cR);
    expect(r.json.calls.length === 1 && r.json.calls[0].outcome === "interested", "calls list outcome/direction filter + limit", r.json.total);
    r = await call("GET", `/api/calling/calls?leadId=${leadR.id}`, cR);
    expect(r.json.total >= 2, "calls list by lead", r.json.total);
    r = await call("GET", `/api/calling/calls/${fin.id}`, cR);
    expect(r.status === 200 && r.json.transcript.length === 2 && r.json.transcript[1].role === "user" && r.json.lead?.name === "Meera" && r.json.call.summary === "Wants a demo." && "capturedFields" in r.json.call && "followUpSentAt" in r.json.call,
      "call detail: transcript (user/assistant only), lead, extra fields", r.json);
    r = await call("GET", `/api/calling/calls/${fin.id}`, cOff);
    expect(r.status === 403, "other business (gate off) can't read the call");
    await call("PUT", "/api/calling/settings", cR, { exotelApiKey: RAW_KEY, exotelApiToken: RAW_TOKEN, exotel: { accountSid: "acme1", callerId: "08047112345" } });
    exoHandler = (u) => (u.startsWith("https://recordings.exotel.com/") ? { status: 200, body: Buffer.from("ID3fakeaudio"), contentType: "audio/mpeg" } : { status: 404, body: {} });
    r = await call("GET", `/api/calling/calls/${fin.id}/recording`, cR);
    const recReq = exoRequests[exoRequests.length - 1];
    expect(r.status === 200 && r.headers.get("content-type") === "audio/mpeg" && r.buf.toString() === "ID3fakeaudio" && recReq.headers.authorization?.startsWith("Basic "), "recording proxied from Exotel with basic auth", r.status);
    r = await call("GET", `/api/calling/calls/${manualId}/recording`, cR);
    expect(r.status === 404, "no recording → 404");
    await db.update(schema.aiCalls).set({ recordingUrl: "https://evil.example.com/x.mp3" }).where(eq(schema.aiCalls.id, fin.id));
    r = await call("GET", `/api/calling/calls/${fin.id}/recording`, cR);
    expect(r.status === 502 && /not allowed/.test(r.json.error), "recording from a non-Exotel host refused", r.json);
    // stats
    r = await call("GET", "/api/calling/stats", cR);
    expect(r.status === 200 && r.json.total >= 3 && r.json.completed === 1 && r.json.interested === 1 && r.json.minutes === 1 && r.json.avgDurationSec === 50 && Array.isArray(r.json.byDay) && r.json.byDay.length >= 1,
      "stats totals + byDay", r.json);
    // simulator incoming + decline
    await call("PUT", "/api/calling/settings", cR, { provider: "simulator", maxAttempts: 2 });
    await clearQueue();
    r = await call("POST", "/api/calling/calls", cR, { phone: "9833344455", name: "Sim Lead" });
    const simId = r.json.call.id;
    await dialer.runDialerTick();
    r = await call("GET", "/api/calling/simulator/incoming", cR);
    expect(r.status === 200 && r.json.calls.some((c: any) => c.id === simId && c.leadName === "Sim Lead" && c.trigger === "manual"), "simulator: ringing call listed as incoming", r.json);
    r = await call("POST", `/api/calling/simulator/${simId}/decline`, cR, {});
    const simRetry = (await callsOf(R)).find((c) => c.parentCallId === simId);
    expect(r.status === 200 && r.json.call.status === "no_answer" && r.json.call.outcome === "no_answer" && simRetry?.attempt === 2, "decline → no answer → normal retry", r.json);
    r = await call("POST", `/api/calling/simulator/${simId}/decline`, cR, {});
    expect(r.status === 409, "decline twice → 409");
    expect((await call("GET", "/api/calling/simulator/incoming", cR)).json.calls.length === 0, "nothing ringing after decline");

    // Final: no response ever contained a raw secret.
    expect(!responses.some((x) => x.includes(RAW_KEY) || x.includes(RAW_TOKEN)), "NO API response in this whole run contained the raw Exotel key or token");
    expect(unhandled === 0, "no unhandled promise rejections", unhandled);
  } finally {
    await clearQueue().catch(() => {});
    srv.close();
  }

  if (failed) { outErr(`\n${failed} check(s) failed`); process.exit(1); }
  out("\nAll AI Calling engine checks passed.");
  process.exit(0);
}

main().catch((e) => { outErr(e); process.exit(1); });
