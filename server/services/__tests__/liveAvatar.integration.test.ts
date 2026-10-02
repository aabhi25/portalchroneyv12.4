/**
 * Live AI avatar — integration tests on a migrated (PGlite) database, driving
 * the real routes, session manager, metering and voice pipeline with FAKE
 * avatar providers (no network, no real keys, no real OpenAI/ElevenLabs).
 *
 * Covers: super-admin settings CRUD + validation + audit, business users get
 * 403 (and only "key: set / not set"), per-business provider keys (encrypted,
 * masked, test-key, remove), key resolution order (own key → platform key only
 * when allowed → blocked), switching provider with keys for both, no raw key in
 * any API response, children's-account parental consent, session gates
 * (disabled, no key, cap reached, concurrency, AI budget blocked, rate limit,
 * provider failure → fallback), metering rows + monthly totals + ai_usage
 * 'avatar' events (Usage & Limits), idle / max-length / cap-mid-session /
 * heartbeat ends, provider drop → fallback signal, and the voice pipeline in
 * avatar mode (TTS → provider not local playback, speak_end, interruption →
 * provider interrupt, products under the avatar, detach → local playback).
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at
 * localhost AND LIVE_AVATAR_TEST_DB=1.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55951/postgres?sslmode=disable \
 *   LIVE_AVATAR_TEST_DB=1 npx tsx server/services/__tests__/liveAvatar.integration.test.ts
 */
import http from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";

const url = process.env.DATABASE_URL || "";
if (process.env.LIVE_AVATAR_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set LIVE_AVATAR_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.OPENAI_API_KEY = "sk-test-not-real";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-at-least-32-characters-long";
process.env.NODE_ENV = "development";
process.env.AVATAR_FAKE_PROVIDER = "1";
delete process.env.HEYGEN_LIVEAVATAR_API_KEY;
delete process.env.ANAM_API_KEY;
delete process.env.AVATAR_FAKE_API_KEY;

const out = console.log.bind(console);
const outErr = console.error.bind(console);
if (process.env.AVATAR_TEST_VERBOSE !== "1") {
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
  while (Date.now() < end) { if (await fn()) return true; await sleep(10); }
  return fn();
}

class FakeSocket {
  readyState = 1;
  json: any[] = [];
  binary: Buffer[] = [];
  send(data: any) {
    if (Buffer.isBuffer(data)) this.binary.push(Buffer.from(data));
    else this.json.push(JSON.parse(String(data)));
  }
  on() {}
  close() { this.readyState = 3; }
  types() { return this.json.map((m) => m.type); }
  ofType(type: string) { return this.json.filter((m) => m.type === type); }
}

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { createSession, hashPassword } = await import("../../auth");
  const avatarRoutes = (await import("../../routes/avatar")).default;
  const { resetAvatarRateLimitsForTesting } = await import("../../routes/avatar");
  const aiUsageRoutes = (await import("../../routes/aiUsage")).default;
  const { avatarSessionManager } = await import("../avatar/sessionManager");
  const { setAvatarProviderForTesting } = await import("../avatar/registry");
  const { createFakeAvatarProvider } = await import("../avatar/providers/fake");
  const { resolveApiKey, setPlatformKey, deletePlatformKey } = await import("../avatar/credentials");
  const { getEffectiveSettings, invalidatePublicConfig, getPublicAvatarConfig } = await import("../avatar/settingsService");
  const { systemSettingsService } = await import("../systemSettingsService");
  const budget = await import("../aiBudgetService");
  const report = await import("../aiUsageReportService");
  const { RealtimeVoiceService } = await import("../../realtimeVoiceService");

  // Fake providers in place of the real HeyGen / Anam adapters (server route vs client route).
  const heygenFake = createFakeAvatarProvider({ audioRoute: "server" });
  const anamFake = createFakeAvatarProvider({ audioRoute: "client" });
  const validated: Array<{ provider: string; key: string }> = [];
  const wrap = (fake: ReturnType<typeof createFakeAvatarProvider>, id: "heygen_liveavatar" | "anam") => ({
    ...fake,
    id,
    createSession: fake.createSession,
    validateKey: async (key: string) => { validated.push({ provider: id, key }); return fake.validateKey(key); },
  });
  setAvatarProviderForTesting("heygen_liveavatar", wrap(heygenFake, "heygen_liveavatar") as any);
  setAvatarProviderForTesting("anam", wrap(anamFake, "anam") as any);

  // Migration is idempotent (re-running 0011 is a no-op).
  {
    const migrationSql = readFileSync(new URL("../../../migrations/0011_live_avatar.sql", import.meta.url), "utf8");
    let ok = true;
    for (const stmt of migrationSql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      try { await db.execute(sql.raw(stmt)); } catch (e) { ok = false; outErr(String(e)); }
    }
    expect(ok, "migration 0011_live_avatar can be re-applied (IF NOT EXISTS / guarded constraints)");
  }

  const stamp = Date.now();
  const mkAccount = async (name: string, extra: Record<string, unknown> = {}) =>
    (await db.insert(schema.businessAccounts).values({ name: `${name} ${stamp}`, website: "https://x.example.com", ...extra } as any).returning())[0].id as string;
  const A = await mkAccount("Avatar Retail");
  const K = await mkAccount("Avatar Tutoring", { k12EducationEnabled: "true" });
  const NOVOICE = await mkAccount("Avatar No Voice", { voiceModeEnabled: "false" });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(avatarRoutes);
  app.use(aiUsageRoutes);
  const srv = await new Promise<http.Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const pw = await hashPassword("x-test-password");
  const mkUser = async (role: string, businessAccountId: string | null) =>
    (await db.insert(schema.users).values({ username: `${role}_${stamp}_${Math.random()}`, passwordHash: pw, role, businessAccountId } as any).returning())[0];
  const sup = await mkUser("super_admin", null);
  const biz = await mkUser("business_user", A);
  const cSup = `session=${await createSession(sup.id)}`;
  const cBiz = `session=${await createSession(biz.id)}`;
  const responses: string[] = [];
  const call = async (method: string, path: string, cookie: string | null, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    responses.push(text);
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  };
  const auditRows = (action: string, businessAccountId?: string) => db.select().from(schema.auditEvents)
    .where(businessAccountId ? and(eq(schema.auditEvents.action, action), eq(schema.auditEvents.businessAccountId, businessAccountId)) : eq(schema.auditEvents.action, action));
  const widgetStart = (businessAccountId: string, userId = `widget_${Math.random().toString(36).slice(2)}`) => call("POST", "/api/chat/widget/avatar/session", null, { businessAccountId, userId });

  const HG_BIZ = "hg_business_key_AAAA1111";
  const ANAM_BIZ = "anam_business_key_BBBB2222";
  const HG_PLATFORM = "hg_platform_key_CCCC3333";
  const RAW_KEYS = [HG_BIZ, ANAM_BIZ, HG_PLATFORM];

  try {
    // ── 1. defaults: off, nothing exposed ───────────────────────────────────
    let r = await call("GET", `/api/super-admin/avatar/accounts/${A}`, cSup);
    expect(r.status === 200 && r.json.settings.enabled === false && r.json.keys.heygen_liveavatar.set === false && r.json.settings.allowPlatformKey === false, "avatar is OFF by default; no keys; platform key not allowed by default", r.json?.settings);
    expect(r.json.warnings.some((w: string) => /No API key for HeyGen/.test(w)), "card warns 'No API key for <provider>'", r.json.warnings);
    r = await call("GET", `/api/chat/widget/avatar/config?businessAccountId=${A}`, null);
    expect(r.status === 200 && r.json.avatar === null, "widget config: no avatar button by default");
    r = await widgetStart(A);
    expect(r.status === 403 && r.json.code === "avatar_disabled" && r.json.fallback === "voice", "session start refused when disabled (fallback: voice)", r.json);

    // ── 2. access control ────────────────────────────────────────────────────
    const forbidden: Array<[string, string, unknown?]> = [
      ["GET", `/api/super-admin/avatar/accounts/${A}`],
      ["PUT", `/api/super-admin/avatar/accounts/${A}`, { enabled: true }],
      ["PUT", `/api/super-admin/avatar/accounts/${A}/keys/heygen_liveavatar`, { apiKey: HG_BIZ }],
      ["DELETE", `/api/super-admin/avatar/accounts/${A}/keys/heygen_liveavatar`],
      ["POST", `/api/super-admin/avatar/accounts/${A}/keys/heygen_liveavatar/test`, {}],
      ["GET", `/api/super-admin/avatar/platform`],
      ["PUT", `/api/super-admin/avatar/platform/keys/heygen_liveavatar`, { apiKey: HG_PLATFORM }],
      ["PUT", `/api/super-admin/avatar/platform/rates`, { heygen_liveavatar: 1 }],
    ];
    for (const [method, path, body] of forbidden) {
      const res = await call(method, path, cBiz, body);
      expect(res.status === 403, `business user → 403 on ${method} ${path.replace(A, ":id")}`, res.status);
    }
    r = await call("GET", `/api/super-admin/avatar/accounts/${A}`, null);
    expect(r.status === 401, "anonymous → 401 on the super-admin card");
    expect((await getEffectiveSettings(A)).exists === false, "…and nothing was written by the refused calls");

    // ── 3. validation ────────────────────────────────────────────────────────
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { monthlyMinuteCap: 0 });
    expect(r.status === 400, "monthly cap must be ≥ 1", r.json);
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { provider: "bogus" });
    expect(r.status === 400, "unknown provider rejected", r.json);
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { enabled: true });
    expect(r.status === 400 && /avatar id/i.test(r.json.error), "cannot enable without an avatar id", r.json);
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { apiKeyOverride: "x" });
    expect(r.status === 400, "unknown fields rejected (keys only via the key endpoints)", r.json);
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { idleTimeoutSeconds: 5 });
    expect(r.status === 400, "idle timeout below 15 s rejected");
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { providerOptions: { videoQuality: "8k" } });
    expect(r.status === 400, "invalid provider option rejected", r.json);
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { avatarGender: "robot" });
    expect(r.status === 400, "avatar gender must be female, male or null", r.json);
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { avatarGender: "male" });
    expect(r.status === 200 && r.json.settings?.avatarGender === "male", "avatar gender saved", r.json?.settings?.avatarGender);
    expect(r.json.voice?.gender === "female" && /avatar is male but the voice \(Shimmer\) is female/.test(r.json.genderMismatch || ""), "male avatar + female voice → mismatch warning for the super admin", { voice: r.json.voice, mismatch: r.json.genderMismatch });
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { avatarGender: null });
    expect(r.status === 200 && r.json.settings?.avatarGender === null && !r.json.genderMismatch, "avatar gender back to 'same as the voice' → no warning", r.json?.genderMismatch);

    // ── 4. enable ────────────────────────────────────────────────────────────
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, {
      enabled: true, provider: "heygen_liveavatar", avatarId: "hg-avatar-1", displayName: "Maya", monthlyMinuteCap: 30,
      maxConcurrentSessions: 1, maxSessionMinutes: 10, idleTimeoutSeconds: 60, commercialNotes: "1,500 min pack",
    });
    expect(r.status === 200 && r.json.settings.enabled && r.json.settings.displayName === "Maya", "super admin enables the avatar", r.json?.settings);
    expect(r.json.canStart === false && r.json.effectiveKeySource === null, "…but it cannot start yet: no key", { canStart: r.json.canStart });
    let audit = (await auditRows("avatar.settings_updated", A)).find((row: any) => (row.metadata as any)?.changedFields?.includes("enabled"));
    expect(!!audit && audit.actorUserId === sup.id && (audit.metadata as any).changedFields.includes("enabled") && (audit.metadata as any).new_enabled === true, "settings change audit-logged with actor + changed fields", audit?.metadata);
    expect(!JSON.stringify(audit?.metadata || {}).includes("1,500"), "commercial notes text is not copied into the audit log");
    invalidatePublicConfig();
    r = await call("GET", `/api/chat/widget/avatar/config?businessAccountId=${A}`, null);
    expect(r.json.avatar === null, "no key → the widget shows no avatar button");
    r = await widgetStart(A);
    expect(r.status === 503 && r.json.code === "no_api_key", "no key → session refused (no_api_key)", r.json);

    // ── 5. per-business keys ─────────────────────────────────────────────────
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}/keys/heygen_liveavatar`, cSup, { apiKey: "short" });
    expect(r.status === 400, "too-short key rejected");
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}/keys/heygen_liveavatar`, cSup, { apiKey: HG_BIZ });
    expect(r.status === 200 && r.json.masked === "••••1111" && !r.text.includes(HG_BIZ), "business HeyGen key saved; response shows only ••••1111", r.json);
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}/keys/anam`, cSup, { apiKey: ANAM_BIZ });
    expect(r.status === 200 && r.json.masked === "••••2222", "business Anam key saved too", r.json);
    const [row] = await db.select().from(schema.avatarBusinessSettings).where(eq(schema.avatarBusinessSettings.businessAccountId, A));
    expect(!JSON.stringify(row.apiKeys).includes(HG_BIZ) && !JSON.stringify(row.apiKeys).includes(ANAM_BIZ) && (row.apiKeys as any).heygen_liveavatar.enc.split(":").length === 3, "keys are encrypted at rest (AES-GCM ciphertext, no plaintext)");
    const keyAudits = await auditRows("avatar.business_key_set", A);
    expect(keyAudits.length === 2 && keyAudits.every((a) => !JSON.stringify(a.metadata).includes("business_key")) && (keyAudits[0].metadata as any).provider, "key changes audit-logged without the key value", keyAudits.map((a) => a.metadata));
    r = await call("GET", `/api/super-admin/avatar/accounts/${A}`, cSup);
    expect(r.json.keys.heygen_liveavatar.set && r.json.keys.heygen_liveavatar.masked === "••••1111" && r.json.keys.anam.masked === "••••2222", "card shows both keys masked", r.json.keys);
    expect(r.json.effectiveKeySource === "business" && r.json.canStart === true, "own key → can start", { src: r.json.effectiveKeySource, warnings: r.json.warnings });
    r = await call("GET", "/api/avatar/status", cBiz);
    expect(r.status === 200 && r.json.enabled === true && r.json.key === "set" && !("keys" in r.json) && !r.text.includes("••••"), "business user sees only 'key: set' (read-only status)", r.json);

    // Test key (cheap validation call; fake provider, no real network).
    validated.length = 0;
    r = await call("POST", `/api/super-admin/avatar/accounts/${A}/keys/heygen_liveavatar/test`, cSup, {});
    expect(r.status === 200 && r.json.ok === true && validated[0]?.key === HG_BIZ && validated[0]?.provider === "heygen_liveavatar", "Test key validates the STORED key server-side", { body: r.json, v: validated });
    r = await call("POST", `/api/super-admin/avatar/accounts/${A}/keys/anam/test`, cSup, { apiKey: "typed-invalid-key-1" });
    expect(r.status === 200 && r.json.ok === false && r.json.code === "auth" && /rejected/.test(r.json.error), "Test key with a typed bad key → rejected (not saved)", r.json);
    expect((await auditRows("avatar.business_key_tested", A)).length === 2, "key tests audit-logged");

    // ── 6. resolution order + switching provider ─────────────────────────────
    let eff = await getEffectiveSettings(A);
    let res = await resolveApiKey("heygen_liveavatar", eff);
    expect(res.source === "business" && res.apiKey === HG_BIZ, "1) the business's own key wins");
    r = await call("PUT", `/api/super-admin/avatar/platform/keys/heygen_liveavatar`, cSup, { apiKey: HG_PLATFORM });
    expect(r.status === 200 && r.json.masked === "••••3333" && !r.text.includes(HG_PLATFORM), "platform key saved (masked)", r.json);
    res = await resolveApiKey("heygen_liveavatar", eff);
    expect(res.source === "business", "own key still wins over the platform key");
    r = await call("DELETE", `/api/super-admin/avatar/accounts/${A}/keys/heygen_liveavatar`, cSup);
    expect(r.status === 200 && r.json.removed === true, "business key removed");
    expect((await auditRows("avatar.business_key_removed", A)).length === 1, "removal audit-logged");
    eff = await getEffectiveSettings(A);
    res = await resolveApiKey("heygen_liveavatar", eff);
    expect(res.apiKey === null, "2) no own key + platform key NOT allowed → blocked");
    r = await call("GET", `/api/super-admin/avatar/accounts/${A}`, cSup);
    expect(r.json.warnings.some((w: string) => /No API key for HeyGen/.test(w)) && r.json.canStart === false, "card warns again when the key is gone", r.json.warnings);
    r = await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { allowPlatformKey: true });
    eff = await getEffectiveSettings(A);
    res = await resolveApiKey("heygen_liveavatar", eff);
    expect(r.json.effectiveKeySource === "platform" && res.source === "platform" && res.apiKey === HG_PLATFORM, "3) 'Allow platform key (we pay)' on → platform key used", r.json.effectiveKeySource);
    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { allowPlatformKey: false });
    await call("PUT", `/api/super-admin/avatar/accounts/${A}/keys/heygen_liveavatar`, cSup, { apiKey: HG_BIZ });

    // ── 7. sessions: gates, metering, keys used ──────────────────────────────
    resetAvatarRateLimitsForTesting();
    invalidatePublicConfig();
    r = await call("GET", `/api/chat/widget/avatar/config?businessAccountId=${A}`, null);
    expect(r.json.avatar?.enabled === true && r.json.avatar.displayName === "Maya" && !r.text.includes("hg-avatar") && !r.text.includes("heygen"), "widget config: button shown with display name only (no provider/key/avatar id)", r.json);
    const visitor = "widget_visitor_1";
    r = await call("POST", "/api/chat/widget/avatar/session", null, { businessAccountId: A, userId: visitor });
    expect(r.status === 200 && r.json.sessionId && r.json.audioRoute === "server" && r.json.displayName === "Maya", "visitor tap → session created", r.json);
    expect(/Hi, I'm Maya/.test(r.json.disclosure || "") && /AI/.test(r.json.disclosure), "default AI disclosure line returned", r.json.disclosure);
    expect(r.json.limits.maxSessionSeconds === 600 && r.json.limits.idleTimeoutSeconds === 60 && r.json.connectTimeoutMs > 0, "limits returned to the widget", r.json.limits);
    const s1 = r.json.sessionId as string;
    expect(heygenFake.sessions.slice(-1)[0].input.apiKey === HG_BIZ && heygenFake.sessions.slice(-1)[0].input.avatarId === "hg-avatar-1", "provider session created with the business's HeyGen key + avatar id");
    let [srow] = await db.select().from(schema.avatarSessions).where(eq(schema.avatarSessions.id, s1));
    expect(srow.status === "starting" && srow.visitorId === visitor && srow.provider === "heygen_liveavatar" && !!srow.providerSessionId, "avatar_sessions row recorded (business, visitor, provider, provider session id)", srow);
    r = await widgetStart(A);
    expect(r.status === 429 && r.json.code === "concurrency_limit", "concurrency limit (1) → 429", r.json);
    r = await call("POST", `/api/chat/widget/avatar/session/${s1}/connected`, null, { businessAccountId: A, userId: "widget_someone_else" });
    expect(r.status === 403, "another visitor cannot touch this session", r.status);
    r = await call("POST", `/api/chat/widget/avatar/session/${s1}/connected`, null, { businessAccountId: A, userId: visitor, firstFrameMs: 2100 });
    [srow] = await db.select().from(schema.avatarSessions).where(eq(schema.avatarSessions.id, s1));
    expect(r.json.active === true && srow.status === "active" && !!srow.connectedAt, "connected → row active", srow.status);
    r = await call("POST", `/api/chat/widget/avatar/session/${s1}/heartbeat`, null, { businessAccountId: A, userId: visitor });
    expect(r.json.active === true && r.json.remainingSeconds > 590, "heartbeat → active + remaining seconds", r.json);
    await sleep(1100);
    r = await call("POST", `/api/chat/widget/avatar/session/${s1}/end`, null, { businessAccountId: A, userId: visitor, reason: "visitor_closed" });
    expect(r.json.ended === true, "visitor ends the call");
    [srow] = await db.select().from(schema.avatarSessions).where(eq(schema.avatarSessions.id, s1));
    expect(srow.status === "ended" && srow.endReason === "visitor_closed" && srow.billedSeconds >= 1 && srow.billedSeconds <= 5, "row ended with billed seconds + end reason", srow);
    expect(heygenFake.sessions.slice(-1)[0].closedWith === "visitor_closed", "provider session closed");
    const usageEvents = await db.select().from(schema.aiUsageEvents).where(and(eq(schema.aiUsageEvents.businessAccountId, A), eq(schema.aiUsageEvents.category, "avatar")));
    const ue = usageEvents[0];
    expect(usageEvents.length === 1 && ue.model === "avatar:heygen_liveavatar" && Math.abs(Number(ue.costUsd) - (srow.billedSeconds / 60) * 0.1) < 1e-6 && (ue.metadata as any).seconds === srow.billedSeconds, "ai_usage_events gets an 'avatar' row priced at the provider rate (default $0.10/min)", ue);
    r = await call("POST", `/api/chat/widget/avatar/session/${s1}/heartbeat`, null, { businessAccountId: A, userId: visitor });
    expect(r.json.active === false && r.json.endReason === "visitor_closed", "heartbeat after end → inactive with the reason", r.json);
    // Keys never leaked anywhere so far.
    expect(!responses.some((t) => RAW_KEYS.some((k) => t.includes(k))), "no API response so far contains a raw key");

    // Switch provider while both keys exist → the Anam key is used; then back.
    resetAvatarRateLimitsForTesting();
    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { provider: "anam", avatarId: "anam-avatar-9", providerOptions: { avatarModel: "cara-4" } });
    r = await widgetStart(A, "widget_visitor_2");
    expect(r.status === 200 && r.json.provider === "anam" && r.json.audioRoute === "client" && anamFake.sessions.slice(-1)[0].input.apiKey === ANAM_BIZ, "switch to Anam → its own key + client audio route", { status: r.status, provider: r.json?.provider });
    const sAnam = r.json.sessionId;
    r = await call("POST", `/api/chat/widget/avatar/session/${sAnam}/connected`, null, { businessAccountId: A, userId: "widget_visitor_2", providerSessionId: "anam-sess-77" });
    [srow] = await db.select().from(schema.avatarSessions).where(eq(schema.avatarSessions.id, sAnam));
    expect(srow.providerSessionId?.startsWith("fake_") || srow.providerSessionId === "anam-sess-77", "provider session id recorded for client-route providers", srow.providerSessionId);
    await call("POST", `/api/chat/widget/avatar/session/${sAnam}/end`, null, { businessAccountId: A, userId: "widget_visitor_2", reason: "connect_failed", detail: "NotAllowedError: video\u0000 blocked " + "x".repeat(400) });
    {
      const view = await call("GET", `/api/super-admin/avatar/accounts/${A}`, cSup);
      const shown = view.json.recentSessions?.find((x: any) => x.id === sAnam);
      expect(shown?.endReason === "connect_failed" && /^Browser: NotAllowedError: video blocked x+$/.test(shown?.error || "") && shown.error.length <= 200, "browser's connect error is recorded (cleaned, capped) for super admins", shown);
    }
    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { provider: "heygen_liveavatar", avatarId: "hg-avatar-1" });
    r = await widgetStart(A, "widget_visitor_3");
    expect(r.status === 200 && heygenFake.sessions.slice(-1)[0].input.apiKey === HG_BIZ, "switch back to HeyGen → HeyGen key again", r.status);
    await avatarSessionManager.endSession(r.json.sessionId, "visitor_closed");

    // Cap reached.
    resetAvatarRateLimitsForTesting();
    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { monthlyMinuteCap: 1 });
    r = await widgetStart(A);
    expect(r.status === 200, "under the cap → allowed", r.json);
    await avatarSessionManager.endSession(r.json.sessionId, "visitor_closed");
    const [capRow] = await db.insert(schema.avatarSessions).values({ businessAccountId: A, provider: "heygen_liveavatar", status: "ended", startedAt: new Date(), endedAt: new Date(), billedSeconds: 60 }).returning();
    (avatarSessionManager as any).endedThisMonth.clear();
    r = await widgetStart(A);
    expect(r.status === 429 && r.json.code === "monthly_cap_reached" && /voice/.test(r.json.message), "monthly cap reached → 429 + 'continue by voice' message", r.json);
    r = await call("GET", `/api/super-admin/avatar/accounts/${A}`, cSup);
    expect(r.json.warnings.some((w: string) => /used up/.test(w)), "card warns the minutes are used up", r.json.warnings);
    await db.delete(schema.avatarSessions).where(eq(schema.avatarSessions.id, capRow.id));
    (avatarSessionManager as any).endedThisMonth.clear();
    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { monthlyMinuteCap: 30, maxConcurrentSessions: 5 });

    // Voice mode off / budget blocked / provider failure / rate limit.
    await db.insert(schema.avatarBusinessSettings).values({ businessAccountId: NOVOICE, enabled: true, provider: "fake", apiKeys: {}, allowPlatformKey: true });
    await setPlatformKey("fake", "fake_platform_key_1");
    r = await widgetStart(NOVOICE);
    expect(r.status === 403 && r.json.code === "avatar_disabled", "voice mode off → no avatar", r.json);
    await budget.upsertLimit({ businessAccountId: A, monthlyLimitUsd: 0.01, warnAtPercent: 80, action: "block", updatedBy: null });
    await db.insert(schema.aiUsageEvents).values({ businessAccountId: A, category: "chat", model: "gpt-4o-mini", costUsd: "1.000000" } as any);
    await budget.aiBudgetService.refresh();
    resetAvatarRateLimitsForTesting();
    r = await widgetStart(A);
    expect(r.status === 403 && r.json.code === "ai_blocked", "monthly AI limit (block) reached → no avatar", r.json);
    await budget.deleteLimit(A);
    await budget.aiBudgetService.refresh();
    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { avatarId: "fail" });
    r = await widgetStart(A);
    expect(r.status === 502 && r.json.code === "provider_error" && r.json.fallback === "voice", "provider failure → 502 + fallback to voice", r.json);
    const [failedRow] = await db.select().from(schema.avatarSessions).where(and(eq(schema.avatarSessions.businessAccountId, A), eq(schema.avatarSessions.endReason, "provider_error")));
    expect(!!failedRow && failedRow.billedSeconds === 0 && (failedRow.metadata as any).errorCode === "provider_unavailable", "failed start recorded with 0 billed seconds", failedRow?.metadata);
    {
      const view = await call("GET", `/api/super-admin/avatar/accounts/${A}`, cSup);
      const shown = view.json.recentSessions?.find((x: any) => x.id === failedRow?.id);
      expect(!!shown && typeof shown.error === "string" && shown.error.length > 0, "super admin sees the provider's reason for the failed start", shown);
    }
    // Provider plan grants shorter calls than our 10-minute setting → our call ends 15 s before theirs.
    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { avatarId: "plan-120" });
    resetAvatarRateLimitsForTesting();
    r = await widgetStart(A);
    expect(r.status === 200 && r.json.limits?.maxSessionSeconds === 105, "provider plan limit (120 s) → our call ends at 105 s", r.json.limits ?? r.json);
    if (r.json.sessionId) await avatarSessionManager.endSession(r.json.sessionId, "visitor_closed");
    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { avatarId: "hg-avatar-1" });
    resetAvatarRateLimitsForTesting();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const rr = await widgetStart(K);
      statuses.push(rr.status);
    }
    expect(statuses.slice(0, 6).every((s) => s !== 429) && statuses[6] === 429, "session starts are rate-limited per IP", statuses);
    resetAvatarRateLimitsForTesting();

    // ── 8. children's education account ─────────────────────────────────────
    r = await call("GET", `/api/super-admin/avatar/accounts/${K}`, cSup);
    expect(r.json.childrensAccount === true && r.json.settings.styleHint === "stylised", "K12 account: stylised avatar by default", r.json.settings.styleHint);
    r = await call("PUT", `/api/super-admin/avatar/accounts/${K}`, cSup, { enabled: true, provider: "fake" });
    expect(r.status === 400 && /parental consent/i.test(r.json.error), "K12 account cannot be enabled without parental consent", r.json);
    r = await call("PUT", `/api/super-admin/avatar/accounts/${K}`, cSup, { enabled: true, provider: "fake", parentalConsentConfirmed: true });
    const kRow = (await db.select().from(schema.avatarBusinessSettings).where(eq(schema.avatarBusinessSettings.businessAccountId, K)))[0];
    expect(r.status === 200 && kRow.parentalConsentConfirmed && kRow.parentalConsentConfirmedBy === sup.id && !!kRow.parentalConsentConfirmedAt, "consent ticked by a super admin → stored with who/when", kRow);
    r = await call("PUT", `/api/super-admin/avatar/accounts/${K}`, cSup, { parentalConsentConfirmed: false });
    expect(r.status === 400, "unticking consent while enabled is refused", r.json);

    // ── 9. watchdog: idle, max length, cap mid-session, heartbeat, provider drop ─
    let clock = Date.now();
    avatarSessionManager.setClockForTesting(() => clock);
    const notified: any[] = [];
    let answering = false;
    const ended: string[] = [];
    const bind = (sessionId: string, visitorId: string) => avatarSessionManager.bindVoice(sessionId, { businessAccountId: A, visitorId }, {
      conversationId: `conv-${sessionId}`,
      notify: (m) => notified.push(m),
      isAnswerActive: () => answering,
      onEnded: (reason) => ended.push(reason),
    });
    const startFor = async (visitorId: string, connect = true) => {
      const sid = (await avatarSessionManager.startSession({ businessAccountId: A, visitorId })).sessionId;
      if (connect) await avatarSessionManager.markConnected(sid, { businessAccountId: A, visitorId }, { firstFrameMs: 1500 });
      return sid;
    };
    /** The browser's 20 s heartbeat (not "activity" for the idle timer). */
    const beat = (sid: string, visitorId: string) => avatarSessionManager.heartbeat(sid, { businessAccountId: A, visitorId });
    const rowOf = async (id: string) => (await db.select().from(schema.avatarSessions).where(eq(schema.avatarSessions.id, id)))[0];

    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { idleTimeoutSeconds: 20, maxSessionMinutes: 10 });
    let id = await startFor("widget_idle");
    bind(id, "widget_idle");
    clock += 15_000;
    await avatarSessionManager.tick();
    expect(avatarSessionManager.isLive(id), "15 s of silence < 20 s idle timeout → still live");
    avatarSessionManager.touch(id);
    clock += 15_000;
    await beat(id, "widget_idle");
    await avatarSessionManager.tick();
    expect(avatarSessionManager.isLive(id), "visitor speech resets the idle clock");
    clock += 21_000;
    await beat(id, "widget_idle");
    await avatarSessionManager.tick();
    await until(async () => (await rowOf(id)).endReason === "idle_timeout");
    let rowNow = await rowOf(id);
    expect(rowNow.endReason === "idle_timeout" && rowNow.billedSeconds === 51 && ended.includes("idle_timeout"), "idle → ended (idle_timeout), billed on our clock, voice told to fall back", { reason: rowNow.endReason, secs: rowNow.billedSeconds, ended });

    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { idleTimeoutSeconds: 600, maxSessionMinutes: 1 });
    id = await startFor("widget_max");
    bind(id, "widget_max");
    answering = true;
    clock += 61_000;
    await avatarSessionManager.tick();
    expect(avatarSessionManager.isLive(id) && notified.some((m) => m.type === "avatar_ending" && m.reason === "max_duration"), "max length during an answer → finish the answer first (avatar_ending sent)", notified.slice(-2));
    answering = false;
    avatarSessionManager.answerFinished(id);
    await until(async () => (await rowOf(id)).endReason === "max_duration");
    rowNow = await rowOf(id);
    expect(rowNow.endReason === "max_duration" && rowNow.billedSeconds === 61, "…then ends (max_duration)", rowNow);

    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { maxSessionMinutes: 10, monthlyMinuteCap: 3 });
    (avatarSessionManager as any).endedThisMonth.clear();
    const usedBefore = await avatarSessionManager.monthUsedSeconds(A);
    id = await startFor("widget_cap");
    bind(id, "widget_cap");
    answering = true;
    clock += Math.ceil((180 - usedBefore) * 1000) + 1000;
    await beat(id, "widget_cap");
    await avatarSessionManager.tick();
    expect(avatarSessionManager.isLive(id) && notified.some((m) => m.type === "avatar_ending" && m.reason === "cap_reached"), "cap reached mid-answer → finish the current answer", { usedBefore });
    clock += 61_000;
    await beat(id, "widget_cap");
    await avatarSessionManager.tick();
    await until(async () => (await rowOf(id)).endReason === "cap_reached");
    expect((await rowOf(id)).endReason === "cap_reached", "…hard stop at the cap even if the answer never finishes (60 s grace)");
    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { monthlyMinuteCap: 300 });
    (avatarSessionManager as any).endedThisMonth.clear();

    id = await startFor("widget_hb", false);
    clock += 80_000;
    await avatarSessionManager.tick();
    await until(async () => !!(await rowOf(id)).endReason);
    expect((await rowOf(id)).endReason === "heartbeat_timeout" || (await rowOf(id)).endReason === "connect_timeout", "no heartbeat / never connected → server ends the paid session", (await rowOf(id)).endReason);

    id = await startFor("widget_drop");
    bind(id, "widget_drop");
    ended.length = 0;
    heygenFake.sessions.slice(-1)[0].emit({ type: "disconnected", reason: "test drop" });
    await until(async () => (await rowOf(id)).endReason === "provider_disconnected");
    expect((await rowOf(id)).endReason === "provider_disconnected" && ended.includes("provider_disconnected"), "provider drop mid-session → ended + fallback signal to the voice session", ended);
    avatarSessionManager.setClockForTesting(null);

    // ── 10. voice pipeline in avatar mode ───────────────────────────────────
    const scripted = (parts: string[], products?: string) => async function* () {
      let all = "";
      for (const p of parts) { all += p; yield { type: "content", data: p }; await sleep(5); }
      if (products) yield { type: "products", data: products };
      yield { type: "final", data: all };
    };
    const makeVoice = (visitorId: string) => {
      const svc: any = new RealtimeVoiceService();
      const client = new FakeSocket();
      const openai = new FakeSocket();
      const streams: Array<() => AsyncGenerator<any>> = [];
      const ttsCalls: string[] = [];
      const chatContexts: any[] = [];
      svc.setDepsForTesting({
        streamChat: (_message: string, ctx: any) => { chatContexts.push(ctx); return (streams.shift() || scripted(["Okay."]))(); },
        commitAssistantMessage: async (_c: any, _content: string, still: () => boolean) => (still() ? "m1" : null),
        rollbackAssistantMessage: async () => undefined,
        createTtsProviders: () => ({
          primary: {
            name: "elevenlabs",
            synthesize: async (text: string, signal: AbortSignal, onChunk: (b: Buffer) => void) => {
              ttsCalls.push(text);
              for (let i = 0; i < 3; i++) {
                await sleep(15);
                if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
                onChunk(Buffer.alloc(4800, i + 1));
              }
            },
          },
          fallback: null,
        }),
      });
      const conversationId = `voice-${Math.random().toString(36).slice(2)}`;
      const conversation: any = {
        clientWs: client, openaiWs: openai, businessAccountId: A, userId: visitorId, openaiApiKey: "sk-test", sessionId: null,
        conversationId, isProcessing: false, currentUserTranscript: "", currentAITranscript: "", lastHeartbeat: Date.now(),
        journeyResponseTracking: new Map(), cancelledResponseIds: new Set<string>(), reconnectAttempts: 0, isReconnecting: false,
        selectedLanguage: "en", topscholarCpIds: null, topscholarScope: null, elevenlabsApiKey: "el", elevenlabsVoiceId: "v",
      };
      svc.conversations.set(conversationId, conversation);
      let item = 0;
      const event = (e: any) => svc.handleOpenAIMessage(conversationId, conversation, Buffer.from(JSON.stringify(e)));
      const utter = (text: string, ms: number) => {
        const iid = `item_${++item}`;
        const at = 1000 * item;
        event({ type: "input_audio_buffer.speech_started", item_id: iid, audio_start_ms: at });
        event({ type: "input_audio_buffer.speech_stopped", item_id: iid, audio_end_ms: at + ms });
        return event({ type: "conversation.item.input_audio_transcription.completed", item_id: iid, transcript: text });
      };
      return { svc, client, conversation, conversationId, streams, ttsCalls, chatContexts, utter, msg: (m: any) => svc.handleClientMessage(conversationId, conversation, m) };
    };

    // Server route (HeyGen): audio goes to the provider, never to local playback.
    {
      await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { provider: "heygen_liveavatar", avatarId: "hg-avatar-1", idleTimeoutSeconds: 600, maxConcurrentSessions: 5, avatarGender: "female" });
      const visitorId = "widget_voice_server";
      const sid = (await avatarSessionManager.startSession({ businessAccountId: A, visitorId })).sessionId;
      const rec = heygenFake.sessions.slice(-1)[0];
      const v = makeVoice(visitorId);
      await v.msg({ type: "avatar_attach", avatarSessionId: "not-a-session" });
      expect(v.client.ofType("avatar_attach_failed").length === 1, "attaching an unknown avatar session is refused");
      await v.msg({ type: "avatar_attach", avatarSessionId: sid, speakIntro: true });
      expect(v.client.ofType("avatar_attached")[0]?.audioRoute === "server", "voice session attached to the avatar (server route)");
      await until(() => v.client.ofType("ai_done").length >= 1, 3000);
      expect(/Hi, I'm Maya/.test(v.ttsCalls[0] || "") && rec.audio.length > 0 && v.client.binary.length === 0, "AI disclosure spoken BY THE AVATAR (TTS → provider, not local playback)", { tts: v.ttsCalls[0], provider: rec.audio.length, local: v.client.binary.length });
      expect(v.client.ofType("avatar_audio").length === rec.audio.length && v.client.ofType("avatar_audio").every((m) => m.bytes === 4800), "browser gets only silent-clock markers {avatar_audio, bytes}");
      const introBytes = Buffer.concat(rec.audio);
      const expectedIntro = Buffer.concat(Array.from({ length: rec.audio.length }, (_, i) => Buffer.alloc(4800, (i % 3) + 1)));
      expect(introBytes.equals(expectedIntro), "the provider receives exactly the TTS PCM bytes, in order (no re-encoding, no byte shift)", { got: introBytes.length });
      expect(rec.speakEnds >= 1, "ai_done → agent.speak_end to the provider", rec.speakEnds);

      const productsJson = JSON.stringify({ items: [{ id: "p1", name: "Gold ring", price: "100" }], searchQuery: "ring" });
      v.streams.push(scripted(["I've put three rings on your screen. ", "The first one is lovely."], productsJson));
      const audioBefore = rec.audio.length;
      await v.utter("Show me gold rings", 1200);
      await until(() => v.client.ofType("ai_done").length >= 2, 4000);
      expect(rec.audio.length > audioBefore && v.client.binary.length === 0, "answer audio → avatar provider only (local playback muted)", { provider: rec.audio.length - audioBefore, local: v.client.binary.length });
      const prod = v.client.ofType("products")[0];
      expect(prod && JSON.parse(prod.data).items[0].name === "Gold ring" && prod.responseId, "product cards from the same tool results are sent for display under the avatar", prod);
      expect(v.chatContexts.slice(-1)[0]?.assistantName === "Maya", "answers on a video call introduce the assistant by the avatar's name (not 'Chroney')", v.chatContexts.slice(-1)[0]?.assistantName);
      expect(v.chatContexts.slice(-1)[0]?.assistantGender === "female", "answers on a video call use the avatar's gender (feminine Hindi forms for a female avatar)", v.chatContexts.slice(-1)[0]?.assistantGender);

      // Confirmed interruption → provider interrupt.
      v.streams.push(scripted(["Diamonds are the hardest natural material. ", "They are made of carbon. ", "They form deep underground. ", "Would you like to see some?"]));
      v.streams.push(scripted(["Sure, here is the price."]));
      const interruptsBefore = rec.interrupts;
      const t1 = v.utter("Tell me about diamonds", 1300);
      await until(() => v.client.ofType("avatar_audio").length > rec.audio.length - 1 && v.ttsCalls.some((t) => t.startsWith("Diamonds")), 3000);
      await sleep(800);
      await v.utter("Actually just tell me the price please", 1600);
      await until(() => v.client.ofType("response_cancelled").length > 0, 3000);
      await t1;
      expect(v.client.ofType("response_cancelled").length > 0 && rec.interrupts > interruptsBefore, "confirmed interruption → agent.interrupt to the provider", { interrupts: rec.interrupts - interruptsBefore });
      await until(() => v.client.ofType("ai_done").length >= 4, 4000);

      // Fallback: detach → local playback resumes for the next answer.
      await v.msg({ type: "avatar_detach" });
      v.streams.push(scripted(["Back to normal voice."]));
      await v.utter("Okay what next", 1100);
      await until(() => v.client.binary.length > 0, 3000);
      expect(v.client.binary.length > 0, "after detach (avatar failed/closed) audio plays locally again — no lost conversation");

      // Re-attach, then the voice socket closes → avatar session ends.
      await v.msg({ type: "avatar_attach", avatarSessionId: sid, speakIntro: false });
      v.svc.cleanupConversation(v.conversationId, "client_disconnected");
      await until(async () => (await rowOf(sid)).endReason === "voice_closed");
      expect((await rowOf(sid)).endReason === "voice_closed", "voice socket closed → avatar session ended (voice_closed)");
      v.svc.shutdown();
    }

    // Client route (Anam): PCM still goes to the browser (it feeds the SDK); server sends no markers.
    {
      await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { provider: "anam", avatarId: "anam-avatar-9" });
      const visitorId = "widget_voice_client";
      const sid = (await avatarSessionManager.startSession({ businessAccountId: A, visitorId })).sessionId;
      const v = makeVoice(visitorId);
      await v.msg({ type: "avatar_attach", avatarSessionId: sid, speakIntro: true });
      await until(() => v.client.ofType("ai_done").length >= 1, 3000);
      expect(v.client.ofType("avatar_attached")[0]?.audioRoute === "client" && v.client.binary.length > 0 && v.client.ofType("avatar_audio").length === 0, "client route: the browser receives the PCM to feed the provider SDK", { bin: v.client.binary.length });
      await avatarSessionManager.endSession(sid, "visitor_closed");
      expect(v.client.ofType("avatar_ended")[0]?.reason === "visitor_closed" && !v.conversation.avatar, "ending the session detaches the voice session and tells the browser");
      v.svc.shutdown();
    }

    // ── 11. Usage & Limits integration ───────────────────────────────────────
    const month = budget.istMonthKey();
    const acctUsage = await report.getAccountMonthUsage(A, month);
    expect(acctUsage.avatar.sessions > 3 && acctUsage.avatar.seconds > 0, "per-account usage includes avatar seconds + sessions", acctUsage.avatar);
    expect(acctUsage.byChannel.some((c) => c.channel === "avatar"), "avatar spend appears as its own channel ('Live avatar')", acctUsage.byChannel.map((c) => c.channel));
    expect(report.classifyChannel("avatar", "live_avatar", null) === "avatar", "classifier: avatar category → avatar channel");
    r = await call("GET", `/api/super-admin/usage?month=${month}`, cSup);
    const row9 = r.json.accounts.find((x: any) => x.businessAccountId === A);
    expect(r.status === 200 && row9.avatarMinutes > 0 && row9.avatarSessions > 3, "super-admin Usage & Limits shows avatar minutes per account", { min: row9?.avatarMinutes, n: row9?.avatarSessions });
    const monthUsage = await avatarSessionManager.monthUsage(A);
    expect(Math.abs(monthUsage.seconds - acctUsage.avatar.seconds) <= 1, "monthly totals agree (manager vs usage report)", { m: monthUsage.seconds, r: acctUsage.avatar.seconds });

    // Disabling ends live sessions.
    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { provider: "heygen_liveavatar", avatarId: "hg-avatar-1" });
    const liveId = (await avatarSessionManager.startSession({ businessAccountId: A, visitorId: "widget_disable" })).sessionId;
    await call("PUT", `/api/super-admin/avatar/accounts/${A}`, cSup, { enabled: false });
    expect((await rowOf(liveId)).endReason === "disabled", "switching the add-on off ends live sessions");

    // Orphans left by a crash are closed at boot, billed to the last heartbeat.
    const [orphan] = await db.insert(schema.avatarSessions).values({ businessAccountId: A, provider: "heygen_liveavatar", status: "active", startedAt: new Date(Date.now() - 120_000), lastHeartbeatAt: new Date(Date.now() - 60_000) }).returning();
    await avatarSessionManager.recoverOrphans(new Date());
    const orphanRow = await rowOf(orphan.id);
    expect(orphanRow.endReason === "server_restart" && orphanRow.billedSeconds === 60, "orphaned session closed at boot (billed to its last heartbeat)", orphanRow);

    // Final: no response ever contained a raw key; platform GET is masked.
    r = await call("GET", "/api/super-admin/avatar/platform", cSup);
    const hg = r.json.providers.find((p: any) => p.id === "heygen_liveavatar");
    expect(hg.configured && hg.masked === "••••3333" && hg.source === "settings", "platform card shows the platform key masked", hg);
    r = await call("POST", "/api/super-admin/avatar/platform/keys/heygen_liveavatar/test", cSup, {});
    expect(r.json.ok === true, "platform key test works (fake provider)");
    expect(!responses.some((t) => RAW_KEYS.some((k) => t.includes(k))), "NO API response in this whole run contained a raw provider key", responses.filter((t) => RAW_KEYS.some((k) => t.includes(k))).slice(0, 2));
    const allAudits = await db.select().from(schema.auditEvents).where(sql`${schema.auditEvents.action} like 'avatar.%'`);
    expect(allAudits.length > 5 && !allAudits.some((a) => RAW_KEYS.some((k) => JSON.stringify(a.metadata).includes(k))), "no audit row contains a raw key", allAudits.length);
    await deletePlatformKey("heygen_liveavatar");
    await deletePlatformKey("fake");
    systemSettingsService.clearCache();
    expect((await getPublicAvatarConfig(A)) === null, "disabled → no avatar button");
  } finally {
    avatarSessionManager.setClockForTesting(null);
    await avatarSessionManager.shutdown();
    srv.close();
  }

  if (failed) { outErr(`\n${failed} check(s) failed`); process.exit(1); }
  out("\nAll live avatar integration checks passed.");
  process.exit(0);
}

main().catch((e) => { outErr(e); process.exit(1); });
