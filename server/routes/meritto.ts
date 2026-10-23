import { Router, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { merittoFieldMappings } from "@shared/schema";
import { requireAuth, requireBusinessAccount, requireIntegrationAdmin } from "../auth";
import { storage } from "../storage";
import { decrypt, encrypt } from "../services/encryptionService";
import { MERITTO_DEFAULT_CREATE_URL, MERITTO_DEFAULT_MAPPINGS, MERITTO_DEFAULT_UPDATE_URL, MerittoService } from "../services/merittoService";
import { getMerittoMappings, syncLeadToMeritto } from "../services/merittoSync";
import { suggestMerittoRows } from "../services/merittoImport";

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

router.post("/api/meritto/settings", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
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

router.post("/api/meritto/test-connection", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
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

router.get("/api/meritto/field-mappings", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
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

router.post("/api/meritto/field-mappings", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
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

router.put("/api/meritto/field-mappings/:id", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
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

router.delete("/api/meritto/field-mappings/:id", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    await db.delete(merittoFieldMappings).where(and(eq(merittoFieldMappings.id, req.params.id), eq(merittoFieldMappings.businessAccountId, businessAccountId)));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// "Standard fields": adds the standard rows that are missing. Custom rows and edited standard rows stay.
router.post("/api/meritto/field-mappings/seed-defaults", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const existing = await getMerittoMappings(businessAccountId);
    const have = new Set(existing.map(m => m.merittoField.trim().toLowerCase()));
    const missing = MERITTO_DEFAULT_MAPPINGS.filter(m => !have.has(m.merittoField.toLowerCase()));
    if (missing.length > 0) {
      const after = existing.reduce((max, m) => Math.max(max, m.sortOrder), 0);
      await db.insert(merittoFieldMappings).values(missing.map((m, i) => ({ ...m, businessAccountId, isEnabled: "true", sortOrder: after + i + 1 })));
    }
    res.json({ added: missing.map(m => m.merittoField), mappings: await getMerittoMappings(businessAccountId) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// "Copy from LeadSquared": this account's LeadSquared rows as suggested Meritto rows (nothing saved).
router.get("/api/meritto/field-mappings/from-leadsquared", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const [leadsquared, meritto] = await Promise.all([
      storage.getLeadsquaredFieldMappings(businessAccountId),
      getMerittoMappings(businessAccountId),
    ]);
    res.json({ rows: suggestMerittoRows(leadsquared, meritto) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Saves the reviewed rows: new names are added; a name that's already a Meritto row is replaced
// only when the row says so. LeadSquared is not touched.
router.post("/api/meritto/field-mappings/import", requireAuth, requireBusinessAccount, requireIntegrationAdmin, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const input: any[] = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 200) : [];
    const rows = input.map(r => ({ ...readMapping(r), isEnabled: r?.isEnabled === false ? "false" : "true", replace: r?.replace === true }))
      .filter(r => r.merittoField && (r.sourceType === "custom" || r.sourceField));
    const result = await db.transaction(async (tx) => {
      const existing = await tx.select().from(merittoFieldMappings).where(eq(merittoFieldMappings.businessAccountId, businessAccountId));
      const byName = new Map(existing.map(m => [m.merittoField.trim().toLowerCase(), m]));
      let order = existing.reduce((max, m) => Math.max(max, m.sortOrder), 0);
      let added = 0, replaced = 0, kept = 0;
      const seen = new Set<string>();
      for (const { replace, ...r } of rows) {
        const key = r.merittoField.toLowerCase();
        if (seen.has(key)) continue; // the same name twice in one copy: the first one wins
        seen.add(key);
        const current = byName.get(key);
        if (current) {
          if (!replace) { kept++; continue; }
          await tx.update(merittoFieldMappings).set({ ...r, updatedAt: new Date() })
            .where(and(eq(merittoFieldMappings.id, current.id), eq(merittoFieldMappings.businessAccountId, businessAccountId)));
          replaced++;
        } else {
          await tx.insert(merittoFieldMappings).values({ ...r, businessAccountId, sortOrder: ++order });
          added++;
        }
      }
      return { added, replaced, kept };
    });
    res.json({ ...result, mappings: await getMerittoMappings(businessAccountId) });
  } catch (error: any) {
    console.error("[Meritto] Copy from LeadSquared error:", error);
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
