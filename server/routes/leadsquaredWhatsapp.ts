// LeadSquared → "WhatsApp leads": whether WhatsApp leads use the website connection / field
// mappings or their own. Set up by super admins (and agencies allowed to), like the website one.
import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { leadsquaredFieldMappings, whatsappSettings } from "@shared/schema";
import { requireAuth, requireBusinessAccount, requireIntegrationAdmin } from "../auth";
import { storage } from "../storage";
import { recordAuditEventSafely } from "../services/auditService";

const router = Router();

const accountOf = (req: Request, res: Response): string | null => {
  const id = req.user?.activeBusinessAccountId || req.user?.businessAccountId;
  if (!id) res.status(400).json({ error: "Business account not found" });
  return id || null;
};

/** Replaces WhatsApp's own mappings with a copy of the website ones. Returns how many. */
async function copyWebsiteMappings(businessAccountId: string): Promise<number> {
  const website = await storage.getLeadsquaredFieldMappings(businessAccountId, "website");
  await db.transaction(async (tx) => {
    await tx.delete(leadsquaredFieldMappings).where(and(eq(leadsquaredFieldMappings.businessAccountId, businessAccountId), eq(leadsquaredFieldMappings.channel, "whatsapp")));
    for (const { id: _id, createdAt: _c, updatedAt: _u, ...row } of website) {
      await tx.insert(leadsquaredFieldMappings).values({ ...row, channel: "whatsapp" });
    }
  });
  return website.length;
}

router.get("/api/leadsquared/whatsapp", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
  try {
    const accountId = accountOf(req, res);
    if (!accountId) return;
    const settings = await storage.getWidgetSettings(accountId);
    const { whatsappLsqConfigured } = await import("../services/whatsappLeadLsqSync");
    const own = await storage.getLeadsquaredFieldMappings(accountId, "whatsapp");
    const [wa] = await db.select({ on: whatsappSettings.autoSyncToLeadsquared }).from(whatsappSettings).where(eq(whatsappSettings.businessAccountId, accountId)).limit(1);
    res.json({
      connection: settings?.leadsquaredWaConnection === "own" ? "own" : "same",
      mappings: settings?.leadsquaredWaMappings === "own" ? "own" : "same",
      connectionType: settings?.leadsquaredWaConnectionType === "api" ? "api" : "uds",
      udsWebhookUrl: settings?.leadsquaredWaUdsWebhookUrl || "",
      hasUdsKey: !!settings?.leadsquaredWaUdsKey,
      accessKey: settings?.leadsquaredWaAccessKey || "",
      hasSecretKey: !!settings?.leadsquaredWaSecretKey,
      region: settings?.leadsquaredWaRegion || "",
      customHost: settings?.leadsquaredWaCustomHost || "",
      configured: await whatsappLsqConfigured(accountId),
      ownMappingsCount: own.filter((m) => m.isEnabled === "true").length,
      autoSyncOn: wa?.on === "true",
    });
  } catch (error: any) {
    console.error("[LeadSquared WhatsApp] load failed:", error?.message);
    res.status(500).json({ error: "Failed to load WhatsApp LeadSquared settings" });
  }
});

router.post("/api/leadsquared/whatsapp", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
  try {
    const accountId = accountOf(req, res);
    if (!accountId) return;
    const body = req.body || {};
    const existing = await storage.getWidgetSettings(accountId);
    const update: Record<string, any> = {};

    if (body.connection === "own" || body.connection === "same") update.leadsquaredWaConnection = body.connection;
    if (body.mappings === "own" || body.mappings === "same") update.leadsquaredWaMappings = body.mappings;
    if (body.connectionType === "api" || body.connectionType === "uds") update.leadsquaredWaConnectionType = body.connectionType;
    if (body.udsWebhookUrl !== undefined) {
      const url = String(body.udsWebhookUrl || "").trim();
      if (url) {
        const { validateUdsWebhookUrl } = await import("../services/leadsquaredService");
        const urlError = validateUdsWebhookUrl(url);
        if (urlError) return res.status(400).json({ error: urlError });
      }
      update.leadsquaredWaUdsWebhookUrl = url || null;
    }
    const { encrypt } = await import("../services/encryptionService");
    // Keys are only replaced when a new one is typed (they are never sent back to the page).
    if (typeof body.udsKey === "string" && body.udsKey.trim()) update.leadsquaredWaUdsKey = encrypt(body.udsKey.trim());
    if (body.accessKey !== undefined) update.leadsquaredWaAccessKey = String(body.accessKey || "").trim() || null;
    if (typeof body.secretKey === "string" && body.secretKey.trim()) update.leadsquaredWaSecretKey = encrypt(body.secretKey.trim());
    if (body.region !== undefined) update.leadsquaredWaRegion = body.region || null;
    if (body.customHost !== undefined) update.leadsquaredWaCustomHost = String(body.customHost || "").trim() || null;

    // An own connection needs what its method needs.
    const next = { ...existing, ...update } as any;
    if (next.leadsquaredWaConnection === "own") {
      const uds = next.leadsquaredWaConnectionType !== "api";
      if (uds && !next.leadsquaredWaUdsWebhookUrl) return res.status(400).json({ error: "Enter the UDS webhook link for WhatsApp leads" });
      if (!uds && (!next.leadsquaredWaAccessKey || !next.leadsquaredWaSecretKey || !next.leadsquaredWaRegion)) {
        return res.status(400).json({ error: "Access key, secret key and region are needed for WhatsApp leads" });
      }
    }

    await storage.upsertWidgetSettings(accountId, update as any);
    // Choosing own mappings for the first time starts from a copy of the website ones.
    let copied: number | null = null;
    if (update.leadsquaredWaMappings === "own" && (await storage.getLeadsquaredFieldMappings(accountId, "whatsapp")).length === 0) {
      copied = await copyWebsiteMappings(accountId);
    }
    await recordAuditEventSafely(req, {
      action: "leadsquared.whatsapp_settings_changed",
      outcome: "success",
      resourceType: "business_account",
      resourceId: accountId,
      businessAccountId: accountId,
      metadata: { connection: next.leadsquaredWaConnection, mappings: next.leadsquaredWaMappings, connectionType: next.leadsquaredWaConnectionType, keyChanged: !!(update.leadsquaredWaUdsKey || update.leadsquaredWaSecretKey), copiedMappings: copied },
    });
    res.json({ success: true, copiedMappings: copied });
  } catch (error: any) {
    console.error("[LeadSquared WhatsApp] save failed:", error?.message);
    res.status(500).json({ error: "Failed to save WhatsApp LeadSquared settings" });
  }
});

/** Start WhatsApp's own mappings again from the website ones. */
router.post("/api/leadsquared/whatsapp/copy-website-mappings", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
  try {
    const accountId = accountOf(req, res);
    if (!accountId) return;
    res.json({ success: true, copied: await copyWebsiteMappings(accountId) });
  } catch (error: any) {
    console.error("[LeadSquared WhatsApp] copy failed:", error?.message);
    res.status(500).json({ error: "Failed to copy the website mappings" });
  }
});

export default router;
