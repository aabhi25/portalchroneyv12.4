/**
 * Integration test for the Meritto CRM sync (real SQL, real worker pass, a fake Meritto API).
 *
 * DESTRUCTIVE: creates rows. It refuses to run unless DATABASE_URL points at localhost AND
 * RETENTION_TEST_DB=1 is set. Run against a throwaway Postgres with the migrations applied:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   RETENTION_TEST_DB=1 npx tsx server/services/__tests__/merittoSync.integration.test.ts
 */
import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

const url = process.env.DATABASE_URL || "";
if (process.env.RETENTION_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set RETENTION_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");

const out = console.log.bind(console);
if (process.env.TEST_VERBOSE !== "1") { console.log = () => {}; console.warn = () => {}; }
let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) out(`✓ ${label}`);
  else { failed++; out(`✗ ${label}${detail !== undefined ? `\n    got: ${JSON.stringify(detail)}` : ""}`); }
}

type Call = { path: string; headers: http.IncomingHttpHeaders; body: any };

async function main() {
  // ── Fake Meritto ───────────────────────────────────────────────────────────
  const calls: Call[] = [];
  const fake = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ path: req.url || "", headers: req.headers, body });
      const send = (status: number, json: any) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
      if (req.headers["secret-key"] !== "sk-good") return send(401, { status: false, message: "Invalid secret key" });
      if (body.name === "Server Down") return send(500, { status: false, message: "Internal error" });
      if (body.name === "Dupe Person") return send(400, { status: false, message: "Duplicate lead", data: { lead_id: "EXIST9" } });
      if (req.url?.endsWith("/update")) {
        if (body.lead_id === "chroney-connection-check") return send(400, { status: false, message: "Lead not found" });
        return send(200, { status: true, message: "Lead updated" });
      }
      return send(200, { status: true, message: "Lead created", data: { lead_id: `MER-${calls.length}` } });
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { storage } = await import("../../storage");
  const { encrypt } = await import("../encryptionService");
  const { runMerittoSyncPass, syncLeadToMeritto } = await import("../merittoSync");
  const { MerittoService, MERITTO_DEFAULT_MAPPINGS, splitMobile } = await import("../merittoService");
  const { getAccountCrmTargets } = await import("../dataRetentionService");

  const ago = (m: number) => new Date(Date.now() - m * 60_000);
  const [acct] = await db.insert(schema.businessAccounts).values({ name: `Meritto test ${crypto.randomUUID().slice(0, 6)}`, website: "https://mba.example.com" } as any).returning();
  const B = acct.id as string;
  await storage.upsertWidgetSettings(B, {
    merittoEnabled: "true", merittoAccessKey: encrypt("ak-1"), merittoSecretKey: encrypt("sk-good"),
    merittoCreateUrl: `${base}/lead/v1/create`, merittoUpdateUrl: `${base}/lead/v1/update`, merittoEnabledAt: ago(60),
  } as any);
  await db.insert(schema.merittoFieldMappings).values([
    ...MERITTO_DEFAULT_MAPPINGS.map(m => ({ ...m, businessAccountId: B, isEnabled: "true" })),
    { businessAccountId: B, merittoField: "course", sourceType: "custom", sourceField: null, customValue: "Online MBA", displayName: "course", isEnabled: "true", sortOrder: 20 },
  ] as any);
  const mkLead = async (v: Partial<typeof schema.leads.$inferInsert>) =>
    (await db.insert(schema.leads).values({ businessAccountId: B, createdAt: ago(5), updatedAt: ago(5), ...v } as any).returning())[0];
  const getLead = async (id: string) => (await db.select().from(schema.leads).where(eq(schema.leads.id, id)))[0];

  try {
    // ── pure helpers ──
    expect(JSON.stringify(splitMobile("+91 98765 43210")) === JSON.stringify({ dialCode: "+91", mobileNumber: "9876543210" }), "+91 number split into dial code and 10 digits");
    expect(splitMobile("9876543210").mobileNumber === "9876543210" && splitMobile("******3210").mobileNumber === null, "plain 10 digits kept; a hidden number is never sent");

    // ── first send creates the lead ──
    const A = await mkLead({ name: "Priya Sharma", phone: "+91 98765 43210", email: "priya@example.com", sourceUrl: "https://mba.example.com/?utm_source=google&utm_medium=cpc&utm_campaign=mba-oct" });
    const noContact = await mkLead({ name: "Just A Name" });
    const old = await mkLead({ name: "Old Lead", phone: "9123456780", createdAt: ago(120), updatedAt: ago(120) });
    await runMerittoSyncPass();
    const created = calls.filter(c => c.path.endsWith("/create"));
    const c0 = created.find(c => c.body.name === "Priya Sharma");
    expect(c0 && c0.headers["access-key"] === "ak-1" && c0.headers["secret-key"] === "sk-good", "create call carries access-key and secret-key", c0?.headers);
    expect(c0?.body.mobile === "9876543210" && c0?.body.country_dial_code === "+91" && c0?.body.email === "priya@example.com", "mobile without country code + dial code + email", c0?.body);
    expect(c0?.body.source === "google" && c0?.body.medium === "cpc" && c0?.body.campaign === "mba-oct" && c0?.body.course === "Online MBA", "UTM source/medium/campaign and a fixed course", c0?.body);
    expect(c0?.body.mobile_verification_status === "unverified", "verification status sent", c0?.body.mobile_verification_status);
    let a = await getLead(A.id);
    expect(a.merittoSyncStatus === "synced" && a.merittoLeadId?.startsWith("MER-") && a.updatedAt.getTime() === A.updatedAt.getTime(), "lead marked synced with Meritto's id; its updatedAt untouched", { s: a.merittoSyncStatus, id: a.merittoLeadId });
    expect(!created.some(c => c.body.name === "Just A Name") && !(await getLead(noContact.id)).merittoSyncStatus, "a lead without mobile or email is not sent");
    expect(!created.some(c => c.body.name === "Old Lead") && !(await getLead(old.id)).merittoSyncStatus, "leads from before Meritto was switched on are not sent");

    // ── nothing changed → nothing sent ──
    let before = calls.length;
    await runMerittoSyncPass();
    expect(calls.length === before, "a second pass sends nothing", calls.length - before);
    await storage.updateLead(A.id, B, { leadsquaredSyncError: "unrelated" } as any); // updatedAt moves, nothing Meritto sees changes
    await runMerittoSyncPass();
    expect(calls.length === before, "a change Meritto doesn't receive sends nothing");

    // ── a real change → update with lead_id ──
    await storage.updateLead(A.id, B, { email: "priya.new@example.com" } as any);
    await runMerittoSyncPass();
    const up = calls.slice(before).find(c => c.path.endsWith("/update"));
    expect(up && up.body.lead_id === a.merittoLeadId && up.body.email === "priya.new@example.com", "changed email sent as an update with lead_id", up?.body);
    a = await getLead(A.id);
    expect(a.merittoSyncStatus === "synced" && (a.merittoSyncPayload as any)?.email === "priya.new@example.com", "last sent values kept");

    // ── failures ──
    const down = await mkLead({ name: "Server Down", phone: "9000011111" });
    await runMerittoSyncPass();
    let d = await getLead(down.id);
    expect(d.merittoSyncStatus === "failed" && d.merittoRetryCount === 1 && !!d.merittoNextRetryAt && d.merittoNextRetryAt > new Date(), "a 500 is retried later", { s: d.merittoSyncStatus, n: d.merittoRetryCount });
    before = calls.length;
    await runMerittoSyncPass();
    expect(calls.length === before, "not retried before its retry time");

    const dupe = await mkLead({ name: "Dupe Person", phone: "9000022222" });
    await runMerittoSyncPass();
    const dp = await getLead(dupe.id);
    expect(dp.merittoSyncStatus === "synced" && dp.merittoLeadId === "EXIST9", "a duplicate with Meritto's existing id counts as synced", { s: dp.merittoSyncStatus, id: dp.merittoLeadId });

    const hidden = await mkLead({ name: "Hidden", phone: "******3210", email: "hi***@x.com", contactsMaskedAt: new Date() });
    await runMerittoSyncPass();
    expect(!calls.some(c => c.body.name === "Hidden"), "a lead with hidden contact details is never sent");

    // ── manual sync and wrong keys ──
    const manual = await syncLeadToMeritto(B, noContact.id, { manual: true });
    expect(manual.outcome === "not_ready", "manual sync still needs a mobile or email", manual);
    await storage.upsertWidgetSettings(B, { merittoSecretKey: encrypt("sk-bad") } as any);
    const wrong = await mkLead({ name: "Wrong Keys", phone: "9000033333" });
    await runMerittoSyncPass();
    const w = await getLead(wrong.id);
    expect(w.merittoSyncStatus === "needs_attention" && /keys/i.test(w.merittoSyncError || ""), "refused keys → needs attention, not retried", { s: w.merittoSyncStatus, e: w.merittoSyncError });

    // ── key check ──
    const good = await new MerittoService({ accessKey: "ak-1", secretKey: "sk-good", updateUrl: `${base}/lead/v1/update` }).testConnection();
    const bad = await new MerittoService({ accessKey: "ak-1", secretKey: "nope", updateUrl: `${base}/lead/v1/update` }).testConnection();
    expect(good.success && !bad.success, "key check: good keys accepted, bad keys refused", { good, bad });
    expect(!calls.some(c => c.body.lead_id === "chroney-connection-check" && c.path.endsWith("/create")), "the key check never creates a lead");

    // ── auto-delete / hiding see Meritto ──
    await storage.upsertWidgetSettings(B, { merittoSecretKey: encrypt("sk-good") } as any);
    const crm = await getAccountCrmTargets(B);
    expect(crm.meritto === true, "auto-delete and hide-after-sync count Meritto as this account's CRM", crm);

    // ── switched off → nothing sent ──
    await storage.upsertWidgetSettings(B, { merittoEnabled: "false" } as any);
    await mkLead({ name: "After Off", phone: "9000044444" });
    before = calls.length;
    await runMerittoSyncPass();
    expect(calls.length === before, "auto-sync off: nothing sent");
  } finally {
    fake.close();
  }

  if (failed > 0) {
    out(`\n${failed} Meritto check(s) failed.`);
    process.exit(1);
  }
  out("\nAll Meritto checks passed.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
