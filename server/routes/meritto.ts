import { Router, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { merittoFieldMappings } from "@shared/schema";
import { requireAuth, requireBusinessAccount } from "../auth";
import { storage } from "../storage";
import { decrypt, encrypt } from "../services/encryptionService";
import { MERITTO_DEFAULT_CREATE_URL, MERITTO_DEFAULT_MAPPINGS, MERITTO_DEFAULT_UPDATE_URL, MerittoService } from "../services/merittoService";
import { getMerittoMappings, syncLeadToMeritto } from "../services/merittoSync";

/**
 * Meritto (NoPaperForms) CRM settings for the business account in view: keys, auto-sync switch,
 * field mappings, a key check and a manual "send this lead".
 */
const router = Router();

const accountOf = (req: Request) => (req.user as any)?.activeBusinessAccountId || req.user?.businessAccountId || null;

const cleanUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

router.get("/api/meritto/settings", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const s = await storage.getWidgetSettings(businessAccountId);
    res.json({
      enabled: s?.merittoEnabled === "true",
      hasAccessKey: !!s?.merittoAccessKey,
      hasSecretKey: !!s?.merittoSecretKey,
      createUrl: s?.merittoCreateUrl || MERITTO_DEFAULT_CREATE_URL,
      updateUrl: s?.merittoUpdateUrl || MERITTO_DEFAULT_UPDATE_URL,
      enabledAt: s?.merittoEnabledAt || null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/meritto/settings", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const { accessKey, secretKey, enabled, createUrl, updateUrl } = req.body || {};
    const existing = await storage.getWidgetSettings(businessAccountId);
    const update: Record<string, unknown> = {};
    if (typeof accessKey === "string" && accessKey.trim()) update.merittoAccessKey = encrypt(accessKey.trim());
    if (typeof secretKey === "string" && secretKey.trim()) update.merittoSecretKey = encrypt(secretKey.trim());
    if (createUrl !== undefined) update.merittoCreateUrl = cleanUrl(createUrl) === MERITTO_DEFAULT_CREATE_URL ? null : cleanUrl(createUrl);
    if (updateUrl !== undefined) update.merittoUpdateUrl = cleanUrl(updateUrl) === MERITTO_DEFAULT_UPDATE_URL ? null : cleanUrl(updateUrl);
    if (typeof enabled === "boolean") {
      const hasKeys = !!(update.merittoAccessKey || existing?.merittoAccessKey) && !!(update.merittoSecretKey || existing?.merittoSecretKey);
      if (enabled && !hasKeys) return res.status(400).json({ error: "Add the access key and secret key first" });
      update.merittoEnabled = enabled ? "true" : "false";
      // Leads captured from now on are sent (switching on never floods Meritto with old leads).
      if (enabled && existing?.merittoEnabled !== "true") update.merittoEnabledAt = new Date();
    }
    await storage.upsertWidgetSettings(businessAccountId, update as any);
    // First setup: start from the standard mapping, which the business can change.
    const mappings = await getMerittoMappings(businessAccountId);
    if (mappings.length === 0 && (update.merittoAccessKey || existing?.merittoAccessKey)) {
      await db.insert(merittoFieldMappings).values(MERITTO_DEFAULT_MAPPINGS.map(m => ({ ...m, businessAccountId, isEnabled: "true" })));
    }
    const s = await storage.getWidgetSettings(businessAccountId);
    res.json({ success: true, enabled: s?.merittoEnabled === "true", hasAccessKey: !!s?.merittoAccessKey, hasSecretKey: !!s?.merittoSecretKey });
  } catch (error: any) {
    console.error("[Meritto] Save settings error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/meritto/test-connection", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const s = await storage.getWidgetSettings(businessAccountId);
    const accessKey = typeof req.body?.accessKey === "string" && req.body.accessKey.trim() ? req.body.accessKey.trim() : (s?.merittoAccessKey ? decrypt(s.merittoAccessKey) : "");
    const secretKey = typeof req.body?.secretKey === "string" && req.body.secretKey.trim() ? req.body.secretKey.trim() : (s?.merittoSecretKey ? decrypt(s.merittoSecretKey) : "");
    if (!accessKey || !secretKey) return res.status(400).json({ success: false, message: "Add the access key and secret key first" });
    const service = new MerittoService({ accessKey, secretKey, createUrl: s?.merittoCreateUrl, updateUrl: s?.merittoUpdateUrl });
    res.json(await service.testConnection());
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/api/meritto/field-mappings", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const rows = await getMerittoMappings(businessAccountId);
    res.json(rows.sort((a, b) => a.sortOrder - b.sortOrder));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function readMapping(body: any) {
  const sourceType = body?.sourceType === "custom" ? "custom" : "dynamic";
  return {
    merittoField: String(body?.merittoField || "").trim(),
    sourceType,
    sourceField: sourceType === "dynamic" ? String(body?.sourceField || "").trim() || null : null,
    customValue: sourceType === "custom" ? String(body?.customValue ?? "").trim() || null : null,
    fallbackValue: sourceType === "dynamic" ? String(body?.fallbackValue ?? "").trim() || null : null,
    displayName: String(body?.displayName || body?.merittoField || "").trim(),
  };
}

router.post("/api/meritto/field-mappings", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const m = readMapping(req.body);
    if (!m.merittoField) return res.status(400).json({ error: "Meritto field name is required" });
    if (m.sourceType === "dynamic" && !m.sourceField) return res.status(400).json({ error: "Choose what to send" });
    const existing = await getMerittoMappings(businessAccountId);
    const [row] = await db.insert(merittoFieldMappings).values({ ...m, businessAccountId, isEnabled: "true", sortOrder: existing.length + 1 }).returning();
    res.json(row);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/api/meritto/field-mappings/:id", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof req.body?.isEnabled === "boolean") patch.isEnabled = req.body.isEnabled ? "true" : "false";
    if (req.body?.merittoField !== undefined) Object.assign(patch, readMapping(req.body));
    const [row] = await db.update(merittoFieldMappings).set(patch)
      .where(and(eq(merittoFieldMappings.id, req.params.id), eq(merittoFieldMappings.businessAccountId, businessAccountId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Mapping not found" });
    res.json(row);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/api/meritto/field-mappings/:id", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    await db.delete(merittoFieldMappings).where(and(eq(merittoFieldMappings.id, req.params.id), eq(merittoFieldMappings.businessAccountId, businessAccountId)));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/meritto/field-mappings/seed-defaults", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    await db.delete(merittoFieldMappings).where(eq(merittoFieldMappings.businessAccountId, businessAccountId));
    await db.insert(merittoFieldMappings).values(MERITTO_DEFAULT_MAPPINGS.map(m => ({ ...m, businessAccountId, isEnabled: "true" })));
    res.json(await getMerittoMappings(businessAccountId));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Send one lead now (the Sync button): no readiness rules, sent even when nothing changed.
router.post("/api/meritto/sync-lead/:leadId", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const r = await syncLeadToMeritto(businessAccountId, req.params.leadId, { manual: true });
    const ok = r.outcome === "created" || r.outcome === "updated" || r.outcome === "unchanged";
    res.status(ok ? 200 : 400).json({ success: ok, ...r });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
