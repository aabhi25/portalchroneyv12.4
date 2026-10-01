/**
 * Smart Lead Training — configuration side, against a real database and the
 * REAL registerRoutes() app over HTTP (session-cookie auth). Covers:
 *   - group publish MERGES (account-only OTP/CAPTCHA/conversion settings and
 *     unknown per-field props survive; group-owned fields applied),
 *   - partial failure: per-member results, lastPublishedAt NOT stamped, retry
 *     of only the failed members,
 *   - business-context cache invalidated once per updated member,
 *   - group PUT validation (same schema as the account screen) + legacy 'end'
 *     migration on save and on read,
 *   - account GET: fields sorted by priority, invalid stored config returned
 *     repaired with a warning, defaults flagged; PUT: duplicate ids rejected,
 *     OTP-without-channel refused,
 *   - OTP "effectively enabled" helper truth table + DB-backed checks.
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at
 * localhost AND LEAD_TRAINING_TEST_DB=1 is set.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55492/postgres?sslmode=disable \
 *   LEAD_TRAINING_TEST_DB=1 npx tsx server/services/__tests__/leadTrainingGroupPublish.integration.test.ts
 */
import crypto from "crypto";
import express from "express";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.LEAD_TRAINING_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set LEAD_TRAINING_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
// "No channel" must really mean no channel: no platform-level MSG91 fallback.
for (const k of ["MSG91_AUTH_KEY", "MSG91_SENDER_ID", "MSG91_TEMPLATE_ID"]) delete process.env[k];

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { storage } = await import("../../storage");
  const { businessContextCache } = await import("../businessContextCache");
  const { createSession, hashPassword } = await import("../../auth");
  const { encrypt } = await import("../encryptionService");
  const otp = await import("../otp");
  const cookieParser = (await import("cookie-parser")).default;
  const { registerRoutes } = await import("../../routes");

  const tag = crypto.randomBytes(4).toString("hex");
  const mkBiz = async (name: string) =>
    (await db.insert(schema.businessAccounts).values({ name: `${name} ${tag}`, website: "https://example.com" } as any).returning())[0];
  const setLeadConfig = (businessAccountId: string, leadTrainingConfig: any) =>
    storage.upsertWidgetSettings(businessAccountId, { leadTrainingConfig } as any);
  const getLeadConfig = async (businessAccountId: string) => (await storage.getWidgetSettings(businessAccountId))?.leadTrainingConfig as any;
  const field = (cfg: any, id: string) => cfg.fields.find((f: any) => f.id === id);

  const bizA = await mkBiz("LT Member A (OTP)");
  const bizB = await mkBiz("LT Member B");
  const bizSolo = await mkBiz("LT Solo");

  const pw = await hashPassword("x-test-password");
  const mkUser = async (role: string, businessAccountId: string | null) =>
    (await db.insert(schema.users).values({ username: `${role}_${tag}_${Math.random()}`, passwordHash: pw, role, businessAccountId } as any).returning())[0];
  const superAdmin = await mkUser("super_admin", null);
  const soloUser = await mkUser("business_user", bizSolo.id);

  const [group] = await db.insert(schema.accountGroups).values({ name: `LT Group ${tag}`, ownerUserId: superAdmin.id } as any).returning();
  await db.insert(schema.accountGroupMembers).values([
    { groupId: group.id, businessAccountId: bizA.id, isPrimary: "true" },
    { groupId: group.id, businessAccountId: bizB.id },
  ] as any);

  // Member A: account-only verification + conversion settings and an extra per-field prop.
  const accountA = {
    fields: [
      { id: "name", enabled: true, required: true, priority: 1, captureStrategy: "custom", customAskAfter: 5 },
      { id: "mobile", enabled: true, required: true, priority: 2, captureStrategy: "start", phoneValidation: "12",
        otpEnabled: false, captchaEnabled: true, captchaProvider: "recaptcha_v2", captchaSiteKey: "site-key-A", sendUnverifiedLeadsToCrm: true, futureProp: "keep" },
      { id: "whatsapp", enabled: false, required: false, priority: 3, captureStrategy: "custom", customAskAfter: 2 },
      { id: "email", enabled: false, required: false, priority: 4, captureStrategy: "intent", intentIntensity: "high" },
    ],
    captureStrategy: "custom",
    conversionUrl: "https://a.example/thank-you",
    conversionBadgeEnabled: true,
  };
  await setLeadConfig(bizA.id, accountA);
  await setLeadConfig(bizB.id, null);

  const groupConfig = {
    fields: [
      { id: "email", enabled: true, required: false, priority: 1, captureStrategy: "keyword", captureKeywords: ["pricing", "quote"] },
      { id: "mobile", enabled: true, required: false, priority: 2, captureStrategy: "custom", customAskAfter: 4, phoneValidation: "10" },
      { id: "name", enabled: true, required: true, priority: 3, captureStrategy: "intent", intentIntensity: "low" },
      { id: "whatsapp", enabled: false, required: false, priority: 4, captureStrategy: "custom", customAskAfter: 2 },
    ],
    captureStrategy: "custom",
  };
  await storage.upsertAccountGroupTraining(group.id, { leadTrainingConfig: groupConfig } as any);

  // Spy on cache invalidation.
  const invalidated: string[] = [];
  const realInvalidate = businessContextCache.invalidateBusinessCache.bind(businessContextCache);
  (businessContextCache as any).invalidateBusinessCache = (id: string) => { invalidated.push(id); return realInvalidate(id); };

  try {
    // ── 1. publish merges ───────────────────────────────────────────────────
    {
      const r = await storage.publishGroupTrainingToMembers(group.id, superAdmin.id, "leadTraining");
      expect(r.success && r.fullyPublished && r.affectedCount === 2 && r.failedMembers.length === 0, "publish: both members updated", r);
      const a = await getLeadConfig(bizA.id);
      const am = field(a, "mobile");
      expect(am.captchaEnabled === true && am.captchaSiteKey === "site-key-A" && am.sendUnverifiedLeadsToCrm === true && am.captchaProvider === "recaptcha_v2",
        "A keeps its CAPTCHA settings", am);
      expect(am.futureProp === "keep", "A keeps a per-field prop the group editor doesn't know");
      expect(a.conversionUrl === "https://a.example/thank-you" && a.conversionBadgeEnabled === true, "A keeps its conversion page + badge");
      expect(am.captureStrategy === "custom" && am.customAskAfter === 4 && am.phoneValidation === "10" && am.required === false, "A gets the group's mobile timing/digits/mandatory", am);
      expect(a.fields.map((f: any) => f.id).join(",") === "email,mobile,name,whatsapp" && a.fields.map((f: any) => f.priority).join(",") === "1,2,3,4",
        "A stored in the group's order with priorities 1..4", a.fields.map((f: any) => `${f.id}:${f.priority}`));
      expect(field(a, "name").captureStrategy === "intent" && field(a, "name").intentIntensity === "low", "A gets the group's name timing");
      expect(JSON.stringify(field(a, "email").captureKeywords) === JSON.stringify(["pricing", "quote"]), "A gets the group's keyword list");
      const b = await getLeadConfig(bizB.id);
      expect(b && b.fields.length === 4 && field(b, "email").enabled === true && field(b, "mobile").otpEnabled === undefined,
        "B (no prior config) gets the group's fields and no invented OTP flags", b);
      expect(invalidated.includes(bizA.id) && invalidated.includes(bizB.id) && invalidated.length === 2, "cache invalidated once per member", invalidated);
      const gt = await storage.getAccountGroupTraining(group.id);
      expect(!!gt?.lastPublishedAt, "lastPublishedAt stamped after a full publish");
    }

    // ── 2. partial failure + retry ───────────────────────────────────────────
    {
      await db.update(schema.accountGroupTraining).set({ lastPublishedAt: null } as any).where(eq(schema.accountGroupTraining.groupId, group.id));
      invalidated.length = 0;
      const realUpsert = storage.upsertWidgetSettings.bind(storage);
      (storage as any).upsertWidgetSettings = async (id: string, data: any) => {
        if (id === bizB.id) throw new Error("simulated DB failure for B");
        return realUpsert(id, data);
      };
      let r;
      try {
        r = await storage.publishGroupTrainingToMembers(group.id, superAdmin.id, "leadTraining");
      } finally {
        (storage as any).upsertWidgetSettings = realUpsert;
      }
      expect(r.affectedCount === 1 && r.attemptedCount === 2 && r.failedMembers.length === 1 && r.failedMembers[0].businessAccountId === bizB.id,
        "partial: 1 of 2 updated, B reported failed", r);
      expect(r.failedMembers[0].name.includes("LT Member B") && /simulated DB failure/.test(r.failedMembers[0].error || ""), "failed member has name + error", r.failedMembers[0]);
      expect(!r.fullyPublished, "partial publish is not 'fully published'");
      expect(!(await storage.getAccountGroupTraining(group.id))?.lastPublishedAt, "lastPublishedAt NOT stamped after a partial failure");
      expect(invalidated.length === 1 && invalidated[0] === bizA.id, "cache invalidated only for the member that was updated", invalidated);

      invalidated.length = 0;
      const retry = await storage.publishGroupTrainingToMembers(group.id, superAdmin.id, "leadTraining", { memberIds: [bizB.id] });
      expect(retry.fullyPublished && retry.attemptedCount === 1 && retry.affectedCount === 1, "retry of failed member succeeds", retry);
      expect(invalidated.length === 1 && invalidated[0] === bizB.id, "retry only touches B");
      expect(!!(await storage.getAccountGroupTraining(group.id))?.lastPublishedAt, "lastPublishedAt stamped once the retry completes");
    }

    // ── 3. group without a lead config doesn't wipe members ───────────────────
    {
      const [g2] = await db.insert(schema.accountGroups).values({ name: `LT Empty ${tag}`, ownerUserId: superAdmin.id } as any).returning();
      const bizC = await mkBiz("LT Member C");
      await db.insert(schema.accountGroupMembers).values({ groupId: g2.id, businessAccountId: bizC.id } as any);
      await setLeadConfig(bizC.id, accountA);
      await storage.upsertAccountGroupTraining(g2.id, { customInstructions: null } as any);
      await storage.publishGroupTrainingToMembers(g2.id, superAdmin.id, "leadTraining");
      const c = await getLeadConfig(bizC.id);
      expect(c && field(c, "mobile").captchaSiteKey === "site-key-A", "publishing a group with no lead config leaves member lead config intact");
    }

    // ── HTTP ───────────────────────────────────────────────────────────────────
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use(cookieParser());
    const server = await registerRoutes(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cSuper = `session=${await createSession(superAdmin.id)}`;
    const cSolo = `session=${await createSession(soloUser.id)}`;
    const call = async (method: string, path: string, cookie: string, body?: unknown) => {
      const res = await fetch(base + path, { method, headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      let json: any = null;
      try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, json };
    };

    try {
      // ── 4. group PUT validation + migration ──────────────────────────────────
      {
        const gPath = `/api/super-admin/account-groups/${group.id}/training`;
        const kwEmpty = { ...groupConfig, fields: groupConfig.fields.map((f) => f.id === "email" ? { ...f, captureKeywords: [] } : f) };
        let r = await call("PUT", gPath, cSuper, { leadTrainingConfig: kwEmpty });
        expect(r.status === 400 && Array.isArray(r.json?.details) && r.json.details.some((d: string) => /Email: Keyword timing needs at least one keyword/.test(d)),
          "group PUT rejects enabled Keyword field with no keywords (400 + readable details)", r);
        const dup = { ...groupConfig, fields: [...groupConfig.fields.slice(0, 3), { ...groupConfig.fields[0], priority: 4 }] };
        r = await call("PUT", gPath, cSuper, { leadTrainingConfig: dup });
        expect(r.status === 400 && /only once/.test(r.json?.error || ""), "group PUT rejects duplicate field ids", r.json);
        r = await call("PUT", gPath, cSuper, { leadTrainingConfig: { fields: [{ id: "name" }], captureStrategy: "custom" } });
        expect(r.status === 400, "group PUT rejects a malformed config (was stored unvalidated before)", r.status);

        const withEnd = {
          fields: [
            { id: "name", enabled: true, required: true, priority: 1, captureStrategy: "end" },
            { id: "mobile", enabled: true, required: false, priority: 2, captureStrategy: "start", phoneValidation: "10", otpEnabled: true, captchaSiteKey: "nope" },
            { id: "whatsapp", enabled: false, required: false, priority: 3, captureStrategy: "smart" },
            { id: "email", enabled: false, required: false, priority: 4, captureStrategy: "start" },
          ],
          captureStrategy: "smart",
        };
        r = await call("PUT", gPath, cSuper, { leadTrainingConfig: withEnd });
        expect(r.status === 200, "group PUT accepts legacy 'end'/'smart'", r);
        const stored: any = (await storage.getAccountGroupTraining(group.id))?.leadTrainingConfig;
        expect(field(stored, "name").captureStrategy === "custom" && field(stored, "name").customAskAfter === 3, "group PUT migrates 'end' (no keywords) → Custom after 3", field(stored, "name"));
        expect(field(stored, "mobile").otpEnabled === undefined && field(stored, "mobile").captchaSiteKey === undefined, "group stores only group-owned keys (no OTP/CAPTCHA)", field(stored, "mobile"));

        // A legacy value stored directly (old editor) is migrated on read, with a note.
        await db.update(schema.accountGroupTraining).set({ leadTrainingConfig: withEnd } as any).where(eq(schema.accountGroupTraining.groupId, group.id));
        r = await call("GET", gPath, cSuper);
        const lc = r.json?.training?.leadTrainingConfig;
        expect(r.status === 200 && field(lc, "name").captureStrategy === "custom" && field(lc, "name").customAskAfter === 3 && field(lc, "whatsapp").captureStrategy === "custom",
          "group GET migrates stored legacy timings", lc);
        expect((r.json?.training?.leadTrainingConfigNotes || []).some((n: string) => /At End/.test(n)), "group GET returns a note about the migration", r.json?.training?.leadTrainingConfigNotes);
        expect(Array.isArray(r.json?.members) && r.json.members.length === 2, "group GET lists members (for the publish dialog)");

        // Publish route: partial failure shape.
        await call("PUT", gPath, cSuper, { leadTrainingConfig: groupConfig });
        const realUpsert = storage.upsertWidgetSettings.bind(storage);
        (storage as any).upsertWidgetSettings = async (id: string, data: any) => {
          if (id === bizA.id) throw new Error("boom A");
          return realUpsert(id, data);
        };
        try {
          r = await call("POST", `${gPath}/publish`, cSuper, { module: "leadTraining" });
        } finally {
          (storage as any).upsertWidgetSettings = realUpsert;
        }
        expect(r.status === 200 && r.json?.success === false && r.json?.partial === true && r.json?.failedMembers?.length === 1,
          "publish route reports partial failure", r.json);
        expect(/1 of 2 accounts updated, 1 failed \(LT Member A/.test(r.json?.message || ""), "message: 'X of Y updated, N failed (names)'", r.json?.message);
        r = await call("POST", `${gPath}/publish`, cSuper, { module: "leadTraining", memberIds: [bizA.id] });
        expect(r.status === 200 && r.json?.success === true && r.json?.attemptedCount === 1, "publish route retry with memberIds", r.json);
      }

      // ── 5. account GET / PUT ─────────────────────────────────────────────────
      {
        await setLeadConfig(bizSolo.id, null);
        let r = await call("GET", "/api/training/lead-config", cSolo);
        expect(r.status === 200 && r.json?._meta?.source === "default" && r.json.fields.every((f: any) => f.captureStrategy === "custom" && f.customAskAfter === 2),
          "GET with nothing saved → shared defaults (Custom after 2), flagged as defaults", r.json);

        await setLeadConfig(bizSolo.id, {
          fields: [
            { id: "name", enabled: true, required: true, priority: 3, captureStrategy: "custom", customAskAfter: 2 },
            { id: "mobile", enabled: true, required: false, priority: 1, captureStrategy: "start" },
            { id: "whatsapp", enabled: false, required: false, priority: 4, captureStrategy: "custom", customAskAfter: 2 },
            { id: "email", enabled: true, required: false, priority: 2, captureStrategy: "intent", intentIntensity: "medium" },
          ],
          captureStrategy: "custom",
        });
        r = await call("GET", "/api/training/lead-config", cSolo);
        expect(r.json?.fields?.map((f: any) => f.id).join(",") === "mobile,email,name,whatsapp" && !r.json?._meta?.warning,
          "GET returns fields sorted by priority", r.json?.fields?.map((f: any) => f.id));

        // Invalid stored config: mandatory while off + OTP and CAPTCHA both on.
        await setLeadConfig(bizSolo.id, {
          fields: [
            { id: "name", enabled: false, required: true, priority: 1, captureStrategy: "custom", customAskAfter: 3 },
            { id: "mobile", enabled: true, required: true, priority: 2, captureStrategy: "intent", intentIntensity: "high", otpEnabled: true, captchaEnabled: true },
            { id: "whatsapp", enabled: false, required: false, priority: 3, captureStrategy: "custom" },
            { id: "email", enabled: false, required: false, priority: 4, captureStrategy: "custom" },
          ],
          captureStrategy: "custom",
        });
        r = await call("GET", "/api/training/lead-config", cSolo);
        const m = r.json?.fields?.find((f: any) => f.id === "mobile");
        expect(r.status === 200 && r.json?._meta?.warning?.issues?.length > 0, "invalid stored config → returned with a warning (not silently swapped for defaults)", r.json?._meta);
        expect(m?.enabled === true && m?.captureStrategy === "intent" && m?.intentIntensity === "high" && m?.otpEnabled === true && m?.captchaEnabled === false,
          "…normalised best-effort: keeps what the chat uses (mobile intent/high, OTP wins)", m);

        // PUT: duplicates rejected with details; OTP with no channel refused; demo OK; stored sorted.
        const good = {
          fields: [
            { id: "email", enabled: true, required: false, priority: 2, captureStrategy: "custom", customAskAfter: 3 },
            { id: "name", enabled: true, required: true, priority: 1, captureStrategy: "start" },
            { id: "mobile", enabled: true, required: false, priority: 3, captureStrategy: "custom", customAskAfter: 2, otpEnabled: true, otpDemoMode: false },
            { id: "whatsapp", enabled: false, required: false, priority: 4, captureStrategy: "custom", customAskAfter: 2 },
          ],
          captureStrategy: "custom",
          _meta: { source: "stored", notes: [] },
        };
        r = await call("PUT", "/api/training/lead-config", cSolo, { ...good, fields: [...good.fields.slice(0, 3), { ...good.fields[0], priority: 4 }] });
        expect(r.status === 400 && r.json?.details?.some((d: string) => /only once/.test(d)), "account PUT rejects duplicate ids with details", r.json);
        r = await call("PUT", "/api/training/lead-config", cSolo, good);
        expect(r.status === 400 && r.json?.code === "otp_no_channel", "account PUT refuses OTP with no channel and Sample OTP off", r.json);
        const demo = { ...good, fields: good.fields.map((f) => f.id === "mobile" ? { ...f, otpDemoMode: true } : f) };
        r = await call("PUT", "/api/training/lead-config", cSolo, demo);
        expect(r.status === 200, "account PUT accepts OTP with Sample OTP on", r.json);
        const saved = await getLeadConfig(bizSolo.id);
        expect(saved.fields.map((f: any) => `${f.id}:${f.priority}`).join(",") === "name:1,email:2,mobile:3,whatsapp:4" && saved._meta === undefined,
          "account PUT stores fields sorted by priority (and never stores _meta)", saved.fields.map((f: any) => `${f.id}:${f.priority}`));
      }
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }

    // ── 6. OTP effectively enabled ────────────────────────────────────────────
    {
      const t = otp.computeOtpEffectivelyEnabled;
      expect(t({ mobileEnabled: true, otpEnabled: true, demoMode: false, channelCount: 1 }).enabled === true, "truth table: channel configured → ON");
      expect(t({ mobileEnabled: true, otpEnabled: true, demoMode: true, channelCount: 0 }).enabled === true, "truth table: Sample OTP, no channel → ON");
      const neither = t({ mobileEnabled: true, otpEnabled: true, demoMode: false, channelCount: 0 });
      expect(neither.enabled === false && neither.reason === "no_channel", "truth table: neither → OFF (no_channel)");
      expect(t({ mobileEnabled: true, otpEnabled: false, demoMode: true, channelCount: 1 }).enabled === false, "truth table: OTP not selected → OFF");
      expect(t({ mobileEnabled: false, otpEnabled: true, demoMode: false, channelCount: 1 }).enabled === false, "truth table: mobile off → OFF");

      const bizO = await mkBiz("LT OTP");
      const otpCfg = (demo: boolean) => ({
        fields: [
          { id: "name", enabled: false, required: false, priority: 1, captureStrategy: "custom", customAskAfter: 2 },
          { id: "mobile", enabled: true, required: false, priority: 2, captureStrategy: "custom", customAskAfter: 2, otpEnabled: true, otpDemoMode: demo },
          { id: "whatsapp", enabled: false, required: false, priority: 3, captureStrategy: "custom", customAskAfter: 2 },
          { id: "email", enabled: false, required: false, priority: 4, captureStrategy: "custom", customAskAfter: 2 },
        ],
        captureStrategy: "custom",
      });
      await setLeadConfig(bizO.id, otpCfg(false));
      const warns: string[] = [];
      const realWarn = console.warn;
      console.warn = (...a: any[]) => { warns.push(a.map(String).join(" ")); };
      let off1: boolean, off2: boolean;
      try {
        off1 = await otp.isOtpEffectivelyEnabled(bizO.id);
        off2 = await otp.isOtpEffectivelyEnabled(bizO.id);
      } finally {
        console.warn = realWarn;
      }
      expect(off1 === false && off2 === false, "DB: OTP on, no channel, demo off → effectively OFF");
      expect(warns.filter((w) => w.includes(bizO.id) && /treating OTP as OFF/.test(w)).length === 1, "…warning logged once per account", warns);

      const conv = `conv-${tag}`;
      const errs: string[] = [];
      const realErr = console.error;
      console.error = (...a: any[]) => { errs.push(a.map(String).join(" ")); };
      let issued: any;
      try {
        issued = await otp.OtpService.issueChallenge(bizO.id, conv, "9876543210", {});
      } finally {
        console.error = realErr;
      }
      const rows = await db.select().from(schema.phoneOtpChallenges).where(eq(schema.phoneOtpChallenges.businessAccountId, bizO.id));
      expect(!issued.ok && issued.reason === "channel_unavailable" && rows.length === 0,
        "issueChallenge with no channel → channel_unavailable and no dead challenge row", { issued, rows: rows.length });
      expect(errs.length === 0, "…decided by the helper itself (no lookup error / fallback, no lock held)", errs);

      await setLeadConfig(bizO.id, otpCfg(true));
      expect(await otp.isOtpEffectivelyEnabled(bizO.id) === true, "DB: Sample OTP on → effectively ON");

      await setLeadConfig(bizO.id, otpCfg(false));
      await db.insert(schema.messagingCredentials).values({
        businessAccountId: bizO.id, provider: "msg91", msg91AuthKeyEncrypted: encrypt("auth-key-123"), msg91SenderId: "CHRONY", msg91TemplateId: "tmpl-1", otpChannelPreference: "sms",
      } as any);
      expect(await otp.isOtpEffectivelyEnabled(bizO.id) === true, "DB: SMS sender configured → effectively ON");
      await db.update(schema.messagingCredentials).set({ otpChannelPreference: "whatsapp" } as any).where(eq(schema.messagingCredentials.businessAccountId, bizO.id));
      expect(await otp.isOtpEffectivelyEnabled(bizO.id) === false, "DB: preference WhatsApp but only SMS configured → OFF (matches runtime channel resolution)");
      expect(await otp.isOtpEffectivelyEnabled(bizO.id, { fields: [{ id: "mobile", enabled: true, otpEnabled: false }] }) === false, "passing the loaded config skips the read; OTP off → OFF");
    }
  } finally {
    (businessContextCache as any).invalidateBusinessCache = realInvalidate;
  }

  if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
  console.log("\nAll lead training integration tests passed");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
