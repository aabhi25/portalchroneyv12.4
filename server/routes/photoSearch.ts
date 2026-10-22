import { Router } from "express";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../auth";
import { db } from "../db";
import { businessAccounts, products } from "@shared/schema";
import { storage } from "../storage";
import { recordAuditEventSafely } from "../services/auditService";
import { encrypt } from "../services/encryptionService";
import { last4, maskKey, normalizeApiKey } from "../services/avatar/credentials";
import {
  deletePlatformGeminiKey,
  describePlatformGeminiKey,
  getPlatformGeminiKey,
  openAccountGeminiKey,
  resolveGeminiKey,
  setPlatformGeminiKey,
} from "../services/geminiKeys";
import { GEMINI_EMBEDDING_MARKER, testGeminiKey } from "../services/geminiImageEmbeddingService";
import { usesPhotoSearch } from "../services/visualSearchEngine";
import { indexAccountNow } from "../services/photoSearchIndexSweep";

/**
 * Super admin: Gemini keys for photo search.
 *  - platform key (Super admin › AI providers › Photo search): used by every account without its own key
 *  - account key (Super Admin › API Keys): the account's own Google AI Studio key
 *  - status (Features list): which key an account uses, and how much of its catalog is indexed
 * Keys are stored encrypted and never returned; responses carry a ••••last4 mask.
 */
const router = Router();
const superAdmin = [requireAuth, requireRole("super_admin")];
const KEY_RULE = "API key must be 8–512 characters with no spaces";

router.get("/api/super-admin/photo-search/platform-key", ...superAdmin, async (_req, res) => {
  res.json(await describePlatformGeminiKey());
});

router.put("/api/super-admin/photo-search/platform-key", ...superAdmin, async (req, res) => {
  const key = normalizeApiKey(req.body?.apiKey);
  if (!key) return res.status(400).json({ error: KEY_RULE });
  const replaced = (await describePlatformGeminiKey()).source === "settings";
  if (!(await setPlatformGeminiKey(key))) return res.status(500).json({ error: "Failed to save key" });
  await recordAuditEventSafely(req, {
    action: "photo_search.platform_key_set",
    outcome: "success",
    resourceType: "gemini_platform_key",
    metadata: { replaced },
  });
  res.json(await describePlatformGeminiKey());
});

router.delete("/api/super-admin/photo-search/platform-key", ...superAdmin, async (req, res) => {
  await deletePlatformGeminiKey();
  await recordAuditEventSafely(req, {
    action: "photo_search.platform_key_removed",
    outcome: "success",
    resourceType: "gemini_platform_key",
  });
  res.json(await describePlatformGeminiKey());
});

/** Test a typed key, or the saved one: the account's key when businessAccountId is given, else the platform key. */
router.post("/api/super-admin/photo-search/test-key", ...superAdmin, async (req, res) => {
  const typed = req.body?.apiKey !== undefined ? normalizeApiKey(req.body.apiKey) : null;
  if (req.body?.apiKey !== undefined && !typed) return res.status(400).json({ error: KEY_RULE });
  let key = typed;
  const businessAccountId = typeof req.body?.businessAccountId === "string" ? req.body.businessAccountId : null;
  if (!key && businessAccountId) {
    const account = await storage.getBusinessAccount(businessAccountId);
    if (!account) return res.status(404).json({ error: "Business account not found" });
    key = openAccountGeminiKey(account);
  }
  if (!key && !businessAccountId) key = (await getPlatformGeminiKey())?.key ?? null;
  if (!key) return res.status(400).json({ success: false, message: "No key to test" });
  const result = await testGeminiKey(key);
  await recordAuditEventSafely(req, {
    action: "photo_search.key_tested",
    outcome: result.success ? "success" : "failure",
    resourceType: businessAccountId ? "business_account" : "gemini_platform_key",
    resourceId: businessAccountId ?? undefined,
    metadata: { typed: !!typed },
  });
  res.json(result);
});

router.get("/api/business-accounts/:id/photo-search", ...superAdmin, async (req, res) => {
  const account = await storage.getBusinessAccount(req.params.id);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const ownKey = openAccountGeminiKey(account);
  const resolved = await resolveGeminiKey(account);
  const platform = await describePlatformGeminiKey();
  const [counts] = await db
    .select({
      withPhoto: sql<number>`count(*)::int`,
      indexed: sql<number>`count(*) filter (where ${products.imageEmbedding} is not null and ${products.visualDescription} like ${`${GEMINI_EMBEDDING_MARKER} (%`})::int`,
      failed: sql<number>`count(*) filter (where ${products.visualDescription} like ${`${GEMINI_EMBEDDING_MARKER} failed%`})::int`,
    })
    .from(products)
    .where(and(eq(products.businessAccountId, account.id), isNotNull(products.imageUrl)));

  res.json({
    engine: resolved ? "gemini" : "none",
    keySource: resolved?.source ?? null,
    accountKey: ownKey ? { configured: true, masked: maskKey(last4(ownKey)) } : { configured: false, masked: null },
    platformKeyConfigured: platform.configured,
    usesPhotoSearch: usesPhotoSearch(account),
    products: {
      withPhoto: counts?.withPhoto ?? 0,
      indexed: counts?.indexed ?? 0,
      failed: counts?.failed ?? 0,
    },
  });
});

/** Save (apiKey: string) or remove (apiKey: null) an account's own Gemini key. */
router.put("/api/business-accounts/:id/photo-search-key", ...superAdmin, async (req, res) => {
  const account = await storage.getBusinessAccount(req.params.id);
  if (!account) return res.status(404).json({ error: "Business account not found" });

  const removing = req.body?.apiKey === null || req.body?.apiKey === "";
  const key = removing ? null : normalizeApiKey(req.body?.apiKey);
  if (!removing && !key) return res.status(400).json({ error: KEY_RULE });

  await db
    .update(businessAccounts)
    .set({ geminiApiKey: key ? encrypt(key) : null })
    .where(eq(businessAccounts.id, account.id));
  await recordAuditEventSafely(req, {
    action: removing ? "photo_search.account_key_removed" : "photo_search.account_key_set",
    outcome: "success",
    resourceType: "business_account",
    resourceId: account.id,
    metadata: { replaced: !removing && !!account.geminiApiKey },
  });

  // Start indexing this account's catalog straight away instead of waiting for the next sweep.
  const updated = await storage.getBusinessAccount(account.id);
  if (updated && usesPhotoSearch(updated) && (await resolveGeminiKey(updated))) {
    void indexAccountNow(account.id).catch(error => console.error("[PhotoSearchIndex] Immediate indexing failed:", error));
  }
  res.json({ configured: !!key, masked: key ? maskKey(last4(key)) : null });
});

export default router;
