import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { agencies, agencyAdmins, aiUsageEvents, aiUsageLimits, businessAccounts, sessions, users, type Agency } from "@shared/schema";
import {
  AGENCY_FEATURE_KEYS,
  cleanFeatureList,
  DEFAULT_AGENCY_FEATURES,
  isAgencyFeatureKey,
  resolveAgencyBilling,
  resolveAgencyBranding,
  resolveAgencyPermissions,
  normalizeDomain,
  AGENCY_PERMISSIONS,
  type AgencyPermissionKey,
} from "@shared/agency";
import { requireAgencyAdmin, requireAuth, requireRole, hashPassword } from "../auth";
import { storage } from "../storage";
import { recordAuditEventSafely } from "../services/auditService";
import {
  aiBudgetService,
  deleteLimit,
  isValidMonthKey,
  istMonthKey,
  istMonthRange,
  pgUtc,
  upsertLimit,
  usdInrRate,
} from "../services/aiBudgetService";
import {
  agencyForHost,
  brandForHost,
  checkDomainDns,
  clearAgencyHostCache,
  domainTarget,
  isPlatformDomain,
  requestHost,
} from "../services/agencyBrandService";
import {
  accountFeatures,
  buildAgencyStatement,
  countAgencyAccounts,
  EMAIL_RE,
  generateTempPassword,
  getAgency,
  listAgencyAccounts,
} from "../services/agencyService";

/**
 * Agencies (resellers) API.
 *  Super admin  /api/super-admin/agencies…  create agencies, configure what each may resell and do,
 *               its AI cap, price and brand; agency logins; which accounts belong to it; statement.
 *  Agency login /api/agency/…               its clients (create, features, limits, pause, logins,
 *               open portal), usage, statement, team and widget footer — each action only when the
 *               agency's permissions allow it, and only for accounts of its own agency.
 */
const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function parseMonth(req: Request, res: Response): string | null {
  const raw = req.query.month;
  if (raw === undefined || raw === "") return istMonthKey();
  if (!isValidMonthKey(raw)) {
    res.status(400).json({ error: "month must be YYYY-MM" });
    return null;
  }
  return raw;
}

/** Month-to-date AI cost (USD) and number of AI actions per account. */
async function monthUsage(accountIds: string[], month: string): Promise<Map<string, { costUsd: number; actions: number }>> {
  const out = new Map<string, { costUsd: number; actions: number }>();
  if (accountIds.length === 0) return out;
  const { start, end } = istMonthRange(month);
  const rows = await db
    .select({
      id: aiUsageEvents.businessAccountId,
      cost: sql<string>`coalesce(sum(${aiUsageEvents.costUsd}), 0)`,
      n: sql<number>`count(*)::int`,
    })
    .from(aiUsageEvents)
    .where(and(
      inArray(aiUsageEvents.businessAccountId, accountIds),
      gte(aiUsageEvents.occurredAt, sql`${pgUtc(start)}::timestamp`),
      lt(aiUsageEvents.occurredAt, sql`${pgUtc(end)}::timestamp`),
    ))
    .groupBy(aiUsageEvents.businessAccountId);
  for (const r of rows) out.set(r.id, { costUsd: Number(r.cost) || 0, actions: Number(r.n) || 0 });
  return out;
}

async function limitsFor(accountIds: string[]) {
  if (accountIds.length === 0) return new Map<string, { monthlyLimitUsd: number; warnAtPercent: number; action: string }>();
  const rows = await db.select().from(aiUsageLimits).where(inArray(aiUsageLimits.businessAccountId, accountIds));
  return new Map(rows.map(r => [r.businessAccountId, { monthlyLimitUsd: Number(r.monthlyLimitUsd), warnAtPercent: r.warnAtPercent, action: r.action }]));
}

/** An agency's settings with every default filled in, as the portal reads them. */
function agencySettings(agency: Agency) {
  return {
    id: agency.id,
    name: agency.name,
    status: agency.status,
    maxAccounts: agency.maxAccounts,
    allowedFeatures: cleanFeatureList(agency.allowedFeatures),
    permissions: resolveAgencyPermissions(agency.permissions),
    monthlyAiCapUsd: agency.monthlyAiCapUsd === null ? null : Number(agency.monthlyAiCapUsd),
    aiCapAction: agency.aiCapAction === "warn" ? "warn" : "block",
    aiCapWarnAtPercent: agency.aiCapWarnAtPercent,
    defaultClientLimitUsd: agency.defaultClientLimitUsd === null ? null : Number(agency.defaultClientLimitUsd),
    billing: resolveAgencyBilling(agency.billing),
    branding: resolveAgencyBranding(agency.branding, agency.name),
    notes: agency.notes ?? "",
    domain: {
      name: agency.customDomain,
      status: agency.domainStatus,
      checkedAt: agency.domainCheckedAt,
      verifiedAt: agency.domainVerifiedAt,
      message: agency.domainCheckMessage,
      target: domainTarget(),
    },
    logoUrl: agency.logoData ? `/api/brand/logo/${agency.id}?v=${agency.logoUpdatedAt ? new Date(agency.logoUpdatedAt).getTime() : 0}` : null,
    createdAt: agency.createdAt,
  };
}

// ── own web address and logo (shared by super admin and agency routes) ───────

async function setDomain(agency: Agency, input: unknown): Promise<{ error?: string; agency?: Agency }> {
  if (input === null || input === "") {
    const [after] = await db.update(agencies).set({
      customDomain: null, domainStatus: "none", domainCheckedAt: null, domainVerifiedAt: null, domainCheckMessage: null, updatedAt: new Date(),
    }).where(eq(agencies.id, agency.id)).returning();
    clearAgencyHostCache();
    return { agency: after };
  }
  const domain = normalizeDomain(input);
  if (!domain) return { error: "Enter a web address like app.youragency.com" };
  if (isPlatformDomain(domain)) return { error: "That address can't be used" };
  const [taken] = await db.select({ id: agencies.id }).from(agencies).where(eq(agencies.customDomain, domain)).limit(1);
  if (taken && taken.id !== agency.id) return { error: "That address is already used by another agency" };
  if (domain === agency.customDomain) return { agency };
  const [after] = await db.update(agencies).set({
    customDomain: domain, domainStatus: "pending", domainCheckedAt: null, domainVerifiedAt: null,
    domainCheckMessage: `Add a CNAME record for ${domain} pointing to ${domainTarget()}, then check.`, updatedAt: new Date(),
  }).where(eq(agencies.id, agency.id)).returning();
  clearAgencyHostCache();
  return { agency: after };
}

async function checkDomain(agency: Agency): Promise<Agency> {
  if (!agency.customDomain) return agency;
  const result = await checkDomainDns(agency.customDomain);
  const now = new Date();
  const [after] = await db.update(agencies).set({
    domainStatus: result.ok ? "verified" : "pending",
    domainCheckedAt: now,
    domainVerifiedAt: result.ok ? (agency.domainVerifiedAt ?? now) : null,
    domainCheckMessage: result.message,
  }).where(eq(agencies.id, agency.id)).returning();
  clearAgencyHostCache();
  return after;
}

const LOGO_MAX_BYTES = 300 * 1024;

async function setLogo(agency: Agency, input: unknown): Promise<{ error?: string; agency?: Agency }> {
  if (input === null || input === "") {
    const [after] = await db.update(agencies).set({ logoData: null, logoUpdatedAt: new Date(), updatedAt: new Date() }).where(eq(agencies.id, agency.id)).returning();
    clearAgencyHostCache();
    return { agency: after };
  }
  const m = typeof input === "string" ? /^data:image\/(png|jpeg|webp|svg\+xml);base64,([a-z0-9+/=]+)$/i.exec(input) : null;
  if (!m) return { error: "Upload a PNG, JPG, WebP or SVG image" };
  if (Buffer.from(m[2], "base64").length > LOGO_MAX_BYTES) return { error: "The logo must be 300 KB or smaller" };
  const [after] = await db.update(agencies).set({ logoData: input as string, logoUpdatedAt: new Date(), updatedAt: new Date() }).where(eq(agencies.id, agency.id)).returning();
  clearAgencyHostCache();
  return { agency: after };
}

// ── public: brand for the address, logos, certificate check ──────────────────

/** The brand of the web address the page is on (login page, before anyone logs in). */
router.get("/api/brand", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await brandForHost(requestHost(req)));
  } catch (error) {
    console.error("[Brand] error:", error);
    res.status(500).json({ error: "Failed to load brand" });
  }
});

router.get("/api/brand/logo/:agencyId", async (req, res) => {
  try {
    const [row] = await db.select({ logo: agencies.logoData }).from(agencies).where(eq(agencies.id, req.params.agencyId)).limit(1);
    const m = row?.logo ? /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(row.logo) : null;
    if (!m) return res.status(404).end();
    res.setHeader("Content-Type", m[1]);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // SVGs never run scripts from here.
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.end(Buffer.from(m[2], "base64"));
  } catch (error) {
    console.error("[Brand] logo error:", error);
    res.status(500).end();
  }
});

/** For the certificate service in front of the app: may a certificate be issued for this address? */
router.get("/api/domains/tls-check", async (req, res) => {
  try {
    const domain = normalizeDomain(req.query.domain);
    if (domain && await agencyForHost(domain)) return res.status(200).send("ok");
    res.status(404).send("unknown");
  } catch (error) {
    console.error("[Brand] tls-check error:", error);
    res.status(500).send("error");
  }
});

/** Client rows for agency and super admin pages. Costs are left out when `withCost` is false. */
async function clientRows(agencyId: string, month: string, withCost: boolean) {
  const rows = await listAgencyAccounts(agencyId);
  const ids = rows.map(r => r.account.id);
  const [usage, limits] = await Promise.all([monthUsage(ids, month), limitsFor(ids)]);
  return rows.map(({ account, login }) => {
    const u = usage.get(account.id) ?? { costUsd: 0, actions: 0 };
    const limit = limits.get(account.id) ?? null;
    return {
      id: account.id,
      name: account.name,
      website: account.website,
      status: account.status,
      createdAt: account.createdAt,
      login: login ? { username: login.username, lastLoginAt: login.lastLoginAt } : null,
      features: accountFeatures(account as unknown as Record<string, unknown>),
      actions: u.actions,
      spentUsd: withCost ? Math.round(u.costUsd * 10000) / 10000 : null,
      limit: limit ? { ...limit, monthlyLimitUsd: withCost ? limit.monthlyLimitUsd : null } : null,
      percentOfLimit: limit && limit.monthlyLimitUsd > 0 ? Math.round((u.costUsd / limit.monthlyLimitUsd) * 1000) / 10 : null,
    };
  });
}

async function createLogin(agencyId: string, username: string, role: "owner" | "staff") {
  const tempPassword = generateTempPassword();
  const tempPasswordExpiry = new Date();
  tempPasswordExpiry.setDate(tempPasswordExpiry.getDate() + 30);
  const passwordHash = await hashPassword(tempPassword);
  const user = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({
      username,
      passwordHash,
      tempPassword,
      tempPasswordExpiry,
      mustChangePassword: "true",
      role: "agency_admin",
    }).returning();
    await tx.insert(agencyAdmins).values({ agencyId, userId: u.id, role });
    return u;
  });
  return { userId: user.id, username: user.username, tempPassword };
}

async function listLogins(agencyId: string) {
  return db
    .select({ userId: users.id, username: users.username, role: agencyAdmins.role, lastLoginAt: users.lastLoginAt, createdAt: agencyAdmins.createdAt })
    .from(agencyAdmins)
    .innerJoin(users, eq(users.id, agencyAdmins.userId))
    .where(eq(agencyAdmins.agencyId, agencyId))
    .orderBy(agencyAdmins.createdAt);
}

async function resetPassword(userId: string) {
  const tempPassword = generateTempPassword();
  const tempPasswordExpiry = new Date();
  tempPasswordExpiry.setDate(tempPasswordExpiry.getDate() + 30);
  await storage.resetUserPassword(userId, await hashPassword(tempPassword), tempPassword, tempPasswordExpiry);
  // A reset ends the login's other sessions.
  await db.delete(sessions).where(eq(sessions.userId, userId));
  return tempPassword;
}

const emailSchema = z.string().trim().toLowerCase().regex(EMAIL_RE, "Login must be an email address");
const websiteSchema = z.string().trim().refine(v => { try { new URL(v); return true; } catch { return false; } }, "Website must be a full address, e.g. https://example.com");
const money = z.coerce.number().finite().min(0).max(1_000_000);

const settingsBody = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(["active", "suspended"]),
  maxAccounts: z.union([z.null(), z.coerce.number().int().min(0).max(100_000)]),
  allowedFeatures: z.array(z.string()),
  permissions: z.record(z.boolean()),
  monthlyAiCapUsd: z.union([z.null(), money]),
  aiCapAction: z.enum(["warn", "block"]),
  aiCapWarnAtPercent: z.coerce.number().int().min(1).max(100),
  defaultClientLimitUsd: z.union([z.null(), money]),
  billing: z.record(z.unknown()),
  branding: z.record(z.unknown()),
  notes: z.string().max(5000),
}).partial();

// ── super admin ──────────────────────────────────────────────────────────────

router.get("/api/super-admin/agencies", requireAuth, requireRole("super_admin"), async (_req, res) => {
  try {
    const list = await db.select().from(agencies).orderBy(agencies.name);
    const month = istMonthKey();
    const accounts = await db
      .select({ id: businessAccounts.id, agencyId: businessAccounts.agencyId })
      .from(businessAccounts)
      .where(sql`${businessAccounts.agencyId} is not null`);
    const usage = await monthUsage(accounts.map(a => a.id), month);
    const logins = await db.select({ agencyId: agencyAdmins.agencyId, n: sql<number>`count(*)::int` }).from(agencyAdmins).groupBy(agencyAdmins.agencyId);
    const loginCount = new Map(logins.map(l => [l.agencyId, Number(l.n)]));
    res.json({
      month,
      usdInrRate: usdInrRate(),
      agencies: list.map(a => {
        const mine = accounts.filter(x => x.agencyId === a.id);
        const spentUsd = mine.reduce((s, x) => s + (usage.get(x.id)?.costUsd ?? 0), 0);
        const s = agencySettings(a);
        return {
          id: a.id, name: a.name, status: a.status, brandName: s.branding.brandName,
          accounts: mine.length, maxAccounts: a.maxAccounts, logins: loginCount.get(a.id) ?? 0,
          monthlyAiCapUsd: s.monthlyAiCapUsd, aiCapAction: s.aiCapAction,
          spentUsd: Math.round(spentUsd * 10000) / 10000, createdAt: a.createdAt,
        };
      }),
    });
  } catch (error) {
    console.error("[Agencies] list error:", error);
    res.status(500).json({ error: "Failed to load agencies" });
  }
});

router.post("/api/super-admin/agencies", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const parsed = z.object({ name: z.string().trim().min(1).max(120), ownerEmail: z.union([z.literal(""), emailSchema]).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid agency" });
    const { name, ownerEmail } = parsed.data;
    if (ownerEmail && await storage.getUserByUsername(ownerEmail)) {
      return res.status(409).json({ error: "That email is already used by another login" });
    }
    const [agency] = await db.insert(agencies).values({
      name,
      allowedFeatures: DEFAULT_AGENCY_FEATURES,
      branding: { brandName: name, widgetFooter: "agency" },
      createdBy: req.user!.id,
    }).returning();
    const credentials = ownerEmail ? await createLogin(agency.id, ownerEmail, "owner") : null;
    await recordAuditEventSafely(req, {
      action: "agency.created", outcome: "success", resourceType: "agency", resourceId: agency.id,
      metadata: { name, ownerLogin: ownerEmail || null },
    });
    res.json({ agency: agencySettings(agency), credentials });
  } catch (error) {
    console.error("[Agencies] create error:", error);
    res.status(500).json({ error: "Failed to create agency" });
  }
});

router.get("/api/super-admin/agencies/:id", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const agency = await getAgency(req.params.id);
    if (!agency) return res.status(404).json({ error: "Agency not found" });
    const month = parseMonth(req, res);
    if (!month) return;
    const clients = await clientRows(agency.id, month, true);
    res.json({
      agency: agencySettings(agency),
      clients,
      logins: await listLogins(agency.id),
      month,
      spentUsd: Math.round(clients.reduce((s, c) => s + (c.spentUsd ?? 0), 0) * 10000) / 10000,
      usdInrRate: usdInrRate(),
    });
  } catch (error) {
    console.error("[Agencies] get error:", error);
    res.status(500).json({ error: "Failed to load agency" });
  }
});

router.patch("/api/super-admin/agencies/:id", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const agency = await getAgency(req.params.id);
    if (!agency) return res.status(404).json({ error: "Agency not found" });
    const parsed = settingsBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" });
    const b = parsed.data;
    const updates: Partial<typeof agencies.$inferInsert> = { updatedAt: new Date() };
    if (b.name !== undefined) updates.name = b.name;
    if (b.status !== undefined) updates.status = b.status;
    if (b.maxAccounts !== undefined) updates.maxAccounts = b.maxAccounts;
    if (b.allowedFeatures !== undefined) updates.allowedFeatures = cleanFeatureList(b.allowedFeatures);
    if (b.permissions !== undefined) updates.permissions = resolveAgencyPermissions(b.permissions);
    if (b.monthlyAiCapUsd !== undefined) updates.monthlyAiCapUsd = b.monthlyAiCapUsd === null ? null : b.monthlyAiCapUsd.toFixed(2);
    if (b.aiCapAction !== undefined) updates.aiCapAction = b.aiCapAction;
    if (b.aiCapWarnAtPercent !== undefined) updates.aiCapWarnAtPercent = b.aiCapWarnAtPercent;
    if (b.defaultClientLimitUsd !== undefined) updates.defaultClientLimitUsd = b.defaultClientLimitUsd === null ? null : b.defaultClientLimitUsd.toFixed(2);
    if (b.billing !== undefined) updates.billing = resolveAgencyBilling(b.billing) as unknown as Record<string, unknown>;
    if (b.branding !== undefined) updates.branding = resolveAgencyBranding(b.branding, b.name ?? agency.name) as unknown as Record<string, unknown>;
    if (b.notes !== undefined) updates.notes = b.notes;
    const [after] = await db.update(agencies).set(updates).where(eq(agencies.id, agency.id)).returning();
    clearAgencyHostCache();
    const capChanged = (b.monthlyAiCapUsd !== undefined && Number(agency.monthlyAiCapUsd ?? -1) !== Number(after.monthlyAiCapUsd ?? -1))
      || (b.aiCapWarnAtPercent !== undefined && agency.aiCapWarnAtPercent !== after.aiCapWarnAtPercent);
    if (capChanged) await aiBudgetService.rearmAgency(agency.id);
    if (b.monthlyAiCapUsd !== undefined || b.aiCapAction !== undefined || b.aiCapWarnAtPercent !== undefined) await aiBudgetService.refresh();
    await recordAuditEventSafely(req, {
      action: "agency.updated", outcome: "success", resourceType: "agency", resourceId: agency.id,
      metadata: { changed: Object.keys(b) },
    });
    res.json({ agency: agencySettings(after) });
  } catch (error) {
    console.error("[Agencies] update error:", error);
    res.status(500).json({ error: "Failed to save agency" });
  }
});

router.delete("/api/super-admin/agencies/:id", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const agency = await getAgency(req.params.id);
    if (!agency) return res.status(404).json({ error: "Agency not found" });
    if (String(req.body?.confirmName ?? "").trim() !== agency.name) {
      return res.status(400).json({ error: "Type the agency's name to confirm" });
    }
    const logins = await listLogins(agency.id);
    await db.transaction(async (tx) => {
      // Client accounts stay, as our direct customers; the agency's own logins go.
      await tx.update(businessAccounts).set({ agencyId: null }).where(eq(businessAccounts.agencyId, agency.id));
      if (logins.length) await tx.delete(users).where(inArray(users.id, logins.map(l => l.userId)));
      await tx.delete(agencies).where(eq(agencies.id, agency.id));
    });
    clearAgencyHostCache();
    await aiBudgetService.refresh();
    await recordAuditEventSafely(req, {
      action: "agency.deleted", outcome: "success", resourceType: "agency", resourceId: agency.id,
      metadata: { name: agency.name, logins: logins.length },
    });
    res.json({ deleted: true });
  } catch (error) {
    console.error("[Agencies] delete error:", error);
    res.status(500).json({ error: "Failed to delete agency" });
  }
});

router.post("/api/super-admin/agencies/:id/logins", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const agency = await getAgency(req.params.id);
    if (!agency) return res.status(404).json({ error: "Agency not found" });
    const parsed = z.object({ username: emailSchema, role: z.enum(["owner", "staff"]).default("staff") }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid login" });
    if (await storage.getUserByUsername(parsed.data.username)) return res.status(409).json({ error: "That email is already used by another login" });
    const credentials = await createLogin(agency.id, parsed.data.username, parsed.data.role);
    await recordAuditEventSafely(req, {
      action: "agency.login_created", outcome: "success", resourceType: "agency", resourceId: agency.id,
      metadata: { username: credentials.username, role: parsed.data.role },
    });
    res.json({ credentials });
  } catch (error) {
    console.error("[Agencies] add login error:", error);
    res.status(500).json({ error: "Failed to add login" });
  }
});

router.post("/api/super-admin/agencies/:id/logins/:userId/reset-password", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const [row] = await db.select().from(agencyAdmins).where(and(eq(agencyAdmins.agencyId, req.params.id), eq(agencyAdmins.userId, req.params.userId))).limit(1);
    if (!row) return res.status(404).json({ error: "Login not found" });
    const tempPassword = await resetPassword(row.userId);
    const user = await storage.getUser(row.userId);
    await recordAuditEventSafely(req, { action: "agency.login_password_reset", outcome: "success", resourceType: "agency", resourceId: req.params.id, metadata: { username: user?.username } });
    res.json({ username: user?.username, tempPassword });
  } catch (error) {
    console.error("[Agencies] reset login error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

router.patch("/api/super-admin/agencies/:id/logins/:userId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const parsed = z.object({ role: z.enum(["owner", "staff"]) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "role must be owner or staff" });
    const updated = await db.update(agencyAdmins).set({ role: parsed.data.role })
      .where(and(eq(agencyAdmins.agencyId, req.params.id), eq(agencyAdmins.userId, req.params.userId))).returning();
    if (!updated.length) return res.status(404).json({ error: "Login not found" });
    res.json({ ok: true });
  } catch (error) {
    console.error("[Agencies] login role error:", error);
    res.status(500).json({ error: "Failed to change login" });
  }
});

router.delete("/api/super-admin/agencies/:id/logins/:userId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const [row] = await db.select().from(agencyAdmins).where(and(eq(agencyAdmins.agencyId, req.params.id), eq(agencyAdmins.userId, req.params.userId))).limit(1);
    if (!row) return res.status(404).json({ error: "Login not found" });
    const user = await storage.getUser(row.userId);
    await db.delete(users).where(and(eq(users.id, row.userId), eq(users.role, "agency_admin")));
    await recordAuditEventSafely(req, { action: "agency.login_removed", outcome: "success", resourceType: "agency", resourceId: req.params.id, metadata: { username: user?.username } });
    res.json({ removed: true });
  } catch (error) {
    console.error("[Agencies] remove login error:", error);
    res.status(500).json({ error: "Failed to remove login" });
  }
});

/** Put an existing account under this agency (moving it from another agency only with move: true). */
router.post("/api/super-admin/agencies/:id/accounts", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const agency = await getAgency(req.params.id);
    if (!agency) return res.status(404).json({ error: "Agency not found" });
    const businessAccountId = String(req.body?.businessAccountId ?? "");
    const account = businessAccountId ? await storage.getBusinessAccount(businessAccountId) : undefined;
    if (!account) return res.status(404).json({ error: "Business account not found" });
    if (account.agencyId && account.agencyId !== agency.id && req.body?.move !== true) {
      const other = await getAgency(account.agencyId);
      return res.status(409).json({ error: `This account belongs to ${other?.name ?? "another agency"}. Move it here?`, otherAgency: other?.name ?? null });
    }
    await db.update(businessAccounts).set({ agencyId: agency.id, updatedAt: new Date() }).where(eq(businessAccounts.id, account.id));
    await aiBudgetService.refresh();
    await recordAuditEventSafely(req, {
      action: "agency.account_added", outcome: "success", businessAccountId: account.id, resourceType: "agency", resourceId: agency.id,
      metadata: { agencyName: agency.name, accountName: account.name, fromAgencyId: account.agencyId ?? null },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("[Agencies] add account error:", error);
    res.status(500).json({ error: "Failed to add account" });
  }
});

router.delete("/api/super-admin/agencies/:id/accounts/:accountId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const updated = await db.update(businessAccounts).set({ agencyId: null, updatedAt: new Date() })
      .where(and(eq(businessAccounts.id, req.params.accountId), eq(businessAccounts.agencyId, req.params.id))).returning({ id: businessAccounts.id, name: businessAccounts.name });
    if (!updated.length) return res.status(404).json({ error: "This account is not in the agency" });
    // Agency logins that had this client open lose it.
    await db.update(sessions).set({ activeBusinessAccountId: null })
      .where(and(eq(sessions.activeBusinessAccountId, req.params.accountId), sql`${sessions.userId} in (select ${agencyAdmins.userId} from ${agencyAdmins} where ${agencyAdmins.agencyId} = ${req.params.id})`));
    await aiBudgetService.refresh();
    await recordAuditEventSafely(req, {
      action: "agency.account_removed", outcome: "success", businessAccountId: req.params.accountId, resourceType: "agency", resourceId: req.params.id,
      metadata: { accountName: updated[0].name },
    });
    res.json({ removed: true });
  } catch (error) {
    console.error("[Agencies] remove account error:", error);
    res.status(500).json({ error: "Failed to remove account" });
  }
});

router.put("/api/super-admin/agencies/:id/domain", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const agency = await getAgency(req.params.id);
    if (!agency) return res.status(404).json({ error: "Agency not found" });
    const r = await setDomain(agency, req.body?.domain ?? null);
    if (r.error) return res.status(400).json({ error: r.error });
    await recordAuditEventSafely(req, { action: "agency.domain_changed", outcome: "success", resourceType: "agency", resourceId: agency.id, metadata: { domain: r.agency!.customDomain } });
    res.json({ agency: agencySettings(r.agency!) });
  } catch (error) {
    console.error("[Agencies] domain error:", error);
    res.status(500).json({ error: "Failed to save the web address" });
  }
});

router.post("/api/super-admin/agencies/:id/domain/check", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const agency = await getAgency(req.params.id);
    if (!agency) return res.status(404).json({ error: "Agency not found" });
    res.json({ agency: agencySettings(await checkDomain(agency)) });
  } catch (error) {
    console.error("[Agencies] domain check error:", error);
    res.status(500).json({ error: "Failed to check the web address" });
  }
});

router.put("/api/super-admin/agencies/:id/logo", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const agency = await getAgency(req.params.id);
    if (!agency) return res.status(404).json({ error: "Agency not found" });
    const r = await setLogo(agency, req.body?.logo ?? null);
    if (r.error) return res.status(400).json({ error: r.error });
    await recordAuditEventSafely(req, { action: "agency.logo_changed", outcome: "success", resourceType: "agency", resourceId: agency.id });
    res.json({ agency: agencySettings(r.agency!) });
  } catch (error) {
    console.error("[Agencies] logo error:", error);
    res.status(500).json({ error: "Failed to save the logo" });
  }
});

router.get("/api/super-admin/agencies/:id/statement", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const agency = await getAgency(req.params.id);
    if (!agency) return res.status(404).json({ error: "Agency not found" });
    const month = parseMonth(req, res);
    if (!month) return;
    res.json(await buildAgencyStatement(agency, month));
  } catch (error) {
    console.error("[Agencies] statement error:", error);
    res.status(500).json({ error: "Failed to build statement" });
  }
});

// ── agency logins ────────────────────────────────────────────────────────────

/** Sends 403 unless the agency may do `perm`; returns the live agency row otherwise. */
async function agencyAllowed(req: Request, res: Response, perm?: AgencyPermissionKey): Promise<Agency | null> {
  const session = req.user!.agency!;
  if (perm && !session.permissions[perm]) {
    const label = AGENCY_PERMISSIONS.find(p => p.key === perm)?.label.toLowerCase() ?? "do this";
    res.status(403).json({ error: `Your plan doesn't include this (${label}). Please contact your account manager.` });
    return null;
  }
  const agency = await getAgency(session.agencyId);
  if (!agency) {
    res.status(404).json({ error: "Agency not found" });
    return null;
  }
  return agency;
}

/** The client account, only when it belongs to the login's agency. */
async function ownClient(req: Request, res: Response) {
  const [account] = await db
    .select()
    .from(businessAccounts)
    .where(and(eq(businessAccounts.id, req.params.id), eq(businessAccounts.agencyId, req.user!.agency!.agencyId)))
    .limit(1);
  if (!account) {
    res.status(404).json({ error: "Client not found" });
    return null;
  }
  return account;
}

router.get("/api/agency/overview", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res);
    if (!agency) return;
    const s = agencySettings(agency);
    const perms = s.permissions;
    const month = istMonthKey();
    const rows = await listAgencyAccounts(agency.id);
    const usage = await monthUsage(rows.map(r => r.account.id), month);
    const spentUsd = Array.from(usage.values()).reduce((sum, u) => sum + u.costUsd, 0);
    const actions = Array.from(usage.values()).reduce((sum, u) => sum + u.actions, 0);
    res.json({
      agency: {
        id: s.id, name: s.name, brandName: s.branding.brandName, maxAccounts: s.maxAccounts,
        allowedFeatures: s.allowedFeatures, permissions: perms, branding: s.branding,
        aiCap: s.monthlyAiCapUsd === null ? null : {
          // Without cost access the cap shows only as a percentage.
          monthlyAiCapUsd: perms.seeCosts ? s.monthlyAiCapUsd : null,
          action: s.aiCapAction, warnAtPercent: s.aiCapWarnAtPercent,
          percentUsed: s.monthlyAiCapUsd > 0 ? Math.round((spentUsd / s.monthlyAiCapUsd) * 1000) / 10 : 100,
        },
        defaultClientLimitUsd: perms.seeCosts ? s.defaultClientLimitUsd : null,
        currency: s.billing.currency,
        domain: s.domain,
        logoUrl: s.logoUrl,
      },
      me: { username: req.user!.username, role: req.user!.agency!.adminRole },
      month,
      clients: rows.length,
      activeClients: rows.filter(r => r.account.status === "active").length,
      actions,
      spentUsd: perms.seeCosts ? Math.round(spentUsd * 10000) / 10000 : null,
      usdInrRate: usdInrRate(),
    });
  } catch (error) {
    console.error("[Agency] overview error:", error);
    res.status(500).json({ error: "Failed to load" });
  }
});

router.get("/api/agency/clients", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res);
    if (!agency) return;
    const month = parseMonth(req, res);
    if (!month) return;
    res.json({ month, clients: await clientRows(agency.id, month, req.user!.agency!.permissions.seeCosts) });
  } catch (error) {
    console.error("[Agency] clients error:", error);
    res.status(500).json({ error: "Failed to load clients" });
  }
});

router.post("/api/agency/clients", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res, "createAccounts");
    if (!agency) return;
    const parsed = z.object({
      name: z.string().trim().min(1, "Business name is required").max(200),
      website: websiteSchema,
      username: emailSchema,
      features: z.array(z.string()).default([]),
      monthlyLimitUsd: z.union([z.null(), money]).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid client" });
    const b = parsed.data;
    const s = agencySettings(agency);
    if (s.maxAccounts !== null && await countAgencyAccounts(agency.id) >= s.maxAccounts) {
      return res.status(403).json({ error: `Your plan allows ${s.maxAccounts} client account${s.maxAccounts === 1 ? "" : "s"}. Please contact your account manager for more.` });
    }
    if (await storage.getUserByUsername(b.username)) return res.status(409).json({ error: "That email is already used by another login" });
    const notAllowed = b.features.filter(f => !s.allowedFeatures.includes(f as never));
    if (notAllowed.length) return res.status(400).json({ error: "Some of those features aren't in your plan" });
    const chosen = new Set(cleanFeatureList(b.features));
    const flags: Record<string, string> = {};
    for (const k of AGENCY_FEATURE_KEYS) flags[k] = chosen.has(k) ? "true" : "false";
    const limitUsd = b.monthlyLimitUsd !== undefined ? b.monthlyLimitUsd : s.defaultClientLimitUsd;
    if (limitUsd !== null && s.monthlyAiCapUsd !== null && limitUsd > s.monthlyAiCapUsd) {
      return res.status(400).json({ error: "The client's AI limit can't be above your agency's AI cap" });
    }

    const tempPassword = generateTempPassword();
    const tempPasswordExpiry = new Date();
    tempPasswordExpiry.setDate(tempPasswordExpiry.getDate() + 30);
    const passwordHash = await hashPassword(tempPassword);
    const account = await db.transaction(async (tx) => {
      const [acct] = await tx.insert(businessAccounts).values({
        name: b.name, website: b.website, status: "active", productTier: "chroney", agencyId: agency.id, ...flags,
      }).returning();
      await tx.insert(users).values({
        username: b.username, passwordHash, tempPassword, tempPasswordExpiry, mustChangePassword: "true",
        role: "business_user", businessAccountId: acct.id,
      });
      return acct;
    });
    if (limitUsd !== null && limitUsd > 0) {
      await upsertLimit({ businessAccountId: account.id, monthlyLimitUsd: limitUsd, warnAtPercent: 80, action: "block", updatedBy: req.user!.id });
    }
    await aiBudgetService.refresh();
    await recordAuditEventSafely(req, {
      action: "agency.client_created", outcome: "success", businessAccountId: account.id, resourceType: "business_account", resourceId: account.id,
      metadata: { agencyId: agency.id, name: account.name, username: b.username, features: Array.from(chosen), limitUsd },
    });
    res.json({ client: { id: account.id, name: account.name }, credentials: { username: b.username, tempPassword } });
  } catch (error) {
    console.error("[Agency] create client error:", error);
    res.status(500).json({ error: "Failed to create client" });
  }
});

router.get("/api/agency/clients/:id", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res);
    if (!agency) return;
    const account = await ownClient(req, res);
    if (!account) return;
    const month = parseMonth(req, res);
    if (!month) return;
    const rows = await clientRows(agency.id, month, req.user!.agency!.permissions.seeCosts);
    res.json({ month, client: rows.find(r => r.id === account.id) });
  } catch (error) {
    console.error("[Agency] client error:", error);
    res.status(500).json({ error: "Failed to load client" });
  }
});

router.patch("/api/agency/clients/:id", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    if (!await agencyAllowed(req, res, "createAccounts")) return;
    const account = await ownClient(req, res);
    if (!account) return;
    const parsed = z.object({ name: z.string().trim().min(1).max(200), website: websiteSchema }).partial().safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid details" });
    await db.update(businessAccounts).set({ ...parsed.data, updatedAt: new Date() }).where(eq(businessAccounts.id, account.id));
    await recordAuditEventSafely(req, { action: "agency.client_updated", outcome: "success", businessAccountId: account.id, resourceType: "business_account", resourceId: account.id, metadata: { changed: Object.keys(parsed.data) } });
    res.json({ ok: true });
  } catch (error) {
    console.error("[Agency] update client error:", error);
    res.status(500).json({ error: "Failed to save" });
  }
});

router.patch("/api/agency/clients/:id/features", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res, "editFeatures");
    if (!agency) return;
    const account = await ownClient(req, res);
    if (!account) return;
    const allowed = new Set(cleanFeatureList(agency.allowedFeatures));
    const input = req.body?.features;
    if (!input || typeof input !== "object") return res.status(400).json({ error: "features required" });
    const updates: Record<string, string> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (!isAgencyFeatureKey(k) || typeof v !== "boolean") return res.status(400).json({ error: `Unknown feature: ${k}` });
      if (!allowed.has(k)) return res.status(403).json({ error: "That feature isn't in your plan" });
      updates[k] = v ? "true" : "false";
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: "No features to change" });
    const after = await storage.updateBusinessAccountFeatures(account.id, updates);
    await recordAuditEventSafely(req, { action: "agency.client_features_changed", outcome: "success", businessAccountId: account.id, resourceType: "business_account", resourceId: account.id, metadata: { features: updates } });
    res.json({ features: accountFeatures(after as unknown as Record<string, unknown>) });
  } catch (error) {
    console.error("[Agency] features error:", error);
    res.status(500).json({ error: "Failed to save features" });
  }
});

router.patch("/api/agency/clients/:id/status", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    if (!await agencyAllowed(req, res, "suspendAccounts")) return;
    const account = await ownClient(req, res);
    if (!account) return;
    const status = req.body?.status;
    if (status !== "active" && status !== "suspended") return res.status(400).json({ error: "Status must be active or suspended" });
    await storage.updateBusinessAccountStatus(account.id, status);
    await recordAuditEventSafely(req, { action: "agency.client_status_changed", outcome: "success", businessAccountId: account.id, resourceType: "business_account", resourceId: account.id, metadata: { from: account.status, to: status } });
    res.json({ status });
  } catch (error) {
    console.error("[Agency] status error:", error);
    res.status(500).json({ error: "Failed to change status" });
  }
});

router.put("/api/agency/clients/:id/limit", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res, "setLimits");
    if (!agency) return;
    const account = await ownClient(req, res);
    if (!account) return;
    const parsed = z.object({
      monthlyLimitUsd: z.coerce.number().finite().positive().max(1_000_000),
      warnAtPercent: z.coerce.number().int().min(1).max(100).default(80),
      action: z.enum(["warn", "block"]).default("block"),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Enter a monthly limit above 0" });
    const cap = agency.monthlyAiCapUsd === null ? null : Number(agency.monthlyAiCapUsd);
    if (cap !== null && parsed.data.monthlyLimitUsd > cap) return res.status(400).json({ error: "The client's AI limit can't be above your agency's AI cap" });
    const { before, after } = await upsertLimit({ businessAccountId: account.id, ...parsed.data, updatedBy: req.user!.id });
    await recordAuditEventSafely(req, {
      action: "ai_usage.limit_set", outcome: "success", businessAccountId: account.id, resourceType: "ai_usage_limit", resourceId: account.id,
      metadata: { previousLimitUsd: before ? Number(before.monthlyLimitUsd) : null, newLimitUsd: Number(after.monthlyLimitUsd), newAction: after.action, byAgency: agency.id },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("[Agency] limit error:", error);
    res.status(500).json({ error: "Failed to save limit" });
  }
});

router.delete("/api/agency/clients/:id/limit", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res, "setLimits");
    if (!agency) return;
    const account = await ownClient(req, res);
    if (!account) return;
    const deleted = await deleteLimit(account.id);
    if (deleted) {
      await recordAuditEventSafely(req, { action: "ai_usage.limit_removed", outcome: "success", businessAccountId: account.id, resourceType: "ai_usage_limit", resourceId: account.id, metadata: { previousLimitUsd: Number(deleted.monthlyLimitUsd), byAgency: agency.id } });
    }
    res.json({ removed: !!deleted });
  } catch (error) {
    console.error("[Agency] remove limit error:", error);
    res.status(500).json({ error: "Failed to remove limit" });
  }
});

router.post("/api/agency/clients/:id/reset-password", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    if (!await agencyAllowed(req, res, "resetClientLogins")) return;
    const account = await ownClient(req, res);
    if (!account) return;
    const user = await storage.getUserByBusinessAccountId(account.id);
    if (!user) return res.status(404).json({ error: "This client has no login" });
    const tempPassword = await resetPassword(user.id);
    await recordAuditEventSafely(req, { action: "agency.client_password_reset", outcome: "success", businessAccountId: account.id, resourceType: "user", resourceId: user.id });
    res.json({ username: user.username, tempPassword });
  } catch (error) {
    console.error("[Agency] reset password error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

router.post("/api/agency/clients/:id/open", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    if (!await agencyAllowed(req, res, "openClientPortal")) return;
    const account = await ownClient(req, res);
    if (!account) return;
    await db.update(sessions).set({ activeBusinessAccountId: account.id }).where(eq(sessions.sessionToken, req.sessionToken!));
    await recordAuditEventSafely(req, { action: "agency.client_portal_opened", outcome: "success", businessAccountId: account.id, resourceType: "business_account", resourceId: account.id });
    res.json({ ok: true, name: account.name });
  } catch (error) {
    console.error("[Agency] open client error:", error);
    res.status(500).json({ error: "Failed to open client" });
  }
});

router.post("/api/agency/exit-client", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    await db.update(sessions).set({ activeBusinessAccountId: null }).where(eq(sessions.sessionToken, req.sessionToken!));
    res.json({ ok: true });
  } catch (error) {
    console.error("[Agency] exit client error:", error);
    res.status(500).json({ error: "Failed to go back" });
  }
});

router.get("/api/agency/statement", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res, "seeStatement");
    if (!agency) return;
    const month = parseMonth(req, res);
    if (!month) return;
    const statement = await buildAgencyStatement(agency, month);
    // Our own AI cost (USD) is shown only when the agency may see costs.
    if (!req.user!.agency!.permissions.seeCosts) {
      statement.aiCostUsd = 0;
      statement.lines = statement.lines.map(l => ({ ...l, aiCostUsd: 0, aiCost: 0 }));
    }
    res.json({ ...statement, notes: resolveAgencyBilling(agency.billing).notes });
  } catch (error) {
    console.error("[Agency] statement error:", error);
    res.status(500).json({ error: "Failed to build statement" });
  }
});

/** Team: the owner adds and removes staff logins, when the agency may. */
async function teamAllowed(req: Request, res: Response): Promise<Agency | null> {
  const agency = await agencyAllowed(req, res, "manageTeam");
  if (!agency) return null;
  if (req.user!.agency!.adminRole !== "owner") {
    res.status(403).json({ error: "Only the agency's main login can manage the team" });
    return null;
  }
  return agency;
}

router.get("/api/agency/team", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res);
    if (!agency) return;
    res.json({ logins: await listLogins(agency.id), canManage: req.user!.agency!.permissions.manageTeam && req.user!.agency!.adminRole === "owner" });
  } catch (error) {
    console.error("[Agency] team error:", error);
    res.status(500).json({ error: "Failed to load team" });
  }
});

router.post("/api/agency/team", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await teamAllowed(req, res);
    if (!agency) return;
    const parsed = z.object({ username: emailSchema }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid email" });
    if (await storage.getUserByUsername(parsed.data.username)) return res.status(409).json({ error: "That email is already used by another login" });
    const credentials = await createLogin(agency.id, parsed.data.username, "staff");
    await recordAuditEventSafely(req, { action: "agency.login_created", outcome: "success", resourceType: "agency", resourceId: agency.id, metadata: { username: credentials.username, role: "staff" } });
    res.json({ credentials });
  } catch (error) {
    console.error("[Agency] add staff error:", error);
    res.status(500).json({ error: "Failed to add login" });
  }
});

router.delete("/api/agency/team/:userId", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await teamAllowed(req, res);
    if (!agency) return;
    if (req.params.userId === req.user!.id) return res.status(400).json({ error: "You can't remove your own login" });
    const [row] = await db.select().from(agencyAdmins).where(and(eq(agencyAdmins.agencyId, agency.id), eq(agencyAdmins.userId, req.params.userId))).limit(1);
    if (!row) return res.status(404).json({ error: "Login not found" });
    if (row.role === "owner") return res.status(403).json({ error: "The main login can only be removed by your account manager" });
    const user = await storage.getUser(row.userId);
    await db.delete(users).where(and(eq(users.id, row.userId), eq(users.role, "agency_admin")));
    await recordAuditEventSafely(req, { action: "agency.login_removed", outcome: "success", resourceType: "agency", resourceId: agency.id, metadata: { username: user?.username } });
    res.json({ removed: true });
  } catch (error) {
    console.error("[Agency] remove staff error:", error);
    res.status(500).json({ error: "Failed to remove login" });
  }
});

router.put("/api/agency/branding", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res, "editBranding");
    if (!agency) return;
    const current = resolveAgencyBranding(agency.branding, agency.name);
    const next = resolveAgencyBranding({ ...current, ...(req.body ?? {}) }, agency.name);
    await db.update(agencies).set({ branding: next as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(agencies.id, agency.id));
    clearAgencyHostCache();
    await recordAuditEventSafely(req, { action: "agency.branding_changed", outcome: "success", resourceType: "agency", resourceId: agency.id, metadata: { widgetFooter: next.widgetFooter } });
    res.json({ branding: next });
  } catch (error) {
    console.error("[Agency] branding error:", error);
    res.status(500).json({ error: "Failed to save" });
  }
});

router.put("/api/agency/domain", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res, "setCustomDomain");
    if (!agency) return;
    const r = await setDomain(agency, req.body?.domain ?? null);
    if (r.error) return res.status(400).json({ error: r.error });
    await recordAuditEventSafely(req, { action: "agency.domain_changed", outcome: "success", resourceType: "agency", resourceId: agency.id, metadata: { domain: r.agency!.customDomain } });
    res.json({ domain: agencySettings(r.agency!).domain });
  } catch (error) {
    console.error("[Agency] domain error:", error);
    res.status(500).json({ error: "Failed to save the web address" });
  }
});

router.post("/api/agency/domain/check", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    // Checking is read-only, so any agency login may do it (setting the address needs the permission).
    const agency = await agencyAllowed(req, res);
    if (!agency) return;
    res.json({ domain: agencySettings(await checkDomain(agency)).domain });
  } catch (error) {
    console.error("[Agency] domain check error:", error);
    res.status(500).json({ error: "Failed to check the web address" });
  }
});

router.put("/api/agency/logo", requireAuth, requireAgencyAdmin, async (req, res) => {
  try {
    const agency = await agencyAllowed(req, res, "editBranding");
    if (!agency) return;
    const r = await setLogo(agency, req.body?.logo ?? null);
    if (r.error) return res.status(400).json({ error: r.error });
    await recordAuditEventSafely(req, { action: "agency.logo_changed", outcome: "success", resourceType: "agency", resourceId: agency.id });
    res.json({ logoUrl: agencySettings(r.agency!).logoUrl });
  } catch (error) {
    console.error("[Agency] logo error:", error);
    res.status(500).json({ error: "Failed to save the logo" });
  }
});

export default router;
