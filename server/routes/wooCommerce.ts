import { Router, type NextFunction, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { businessAccounts, products, widgetSettings } from "@shared/schema";
import { requireAuth, requireBusinessAccount } from "../auth";
import { storage } from "../storage";
import { getLiveProductSource } from "../services/productSourceSwitch";
import { normalizeStoreUrl, testStore, WooStoreError } from "../services/wooCommerceStore";
import { disconnectWooCommerce, syncWooCommerce, WOO_SYNC_HOUR_CHOICES, type WooSyncResult } from "../services/wooCommerceSync";

/**
 * WooCommerce product sync for the business account in view (Products → WooCommerce).
 * Reading the status is open to the account (the Catalog banner shows which products are live in chat);
 * connecting, syncing and changing the timing are for super admins only.
 */
const router = Router();

const accountOf = (req: Request) => (req.user as any)?.activeBusinessAccountId || req.user?.businessAccountId || null;

function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "super_admin") return res.status(403).json({ error: "WooCommerce is set up by your account manager." });
  next();
}

async function loadState(businessAccountId: string) {
  const [row] = await db
    .select({
      featureOn: businessAccounts.wooCommerceEnabled,
      storeUrl: widgetSettings.wooStoreUrl,
      connected: widgetSettings.wooConnected,
      syncHours: widgetSettings.wooSyncHours,
      status: widgetSettings.wooSyncStatus,
      startedAt: widgetSettings.wooSyncStartedAt,
      lastSyncedAt: widgetSettings.wooLastSyncedAt,
      lastResult: widgetSettings.wooLastResult,
      chatCurrency: widgetSettings.currency,
    })
    .from(businessAccounts)
    .leftJoin(widgetSettings, eq(widgetSettings.businessAccountId, businessAccounts.id))
    .where(eq(businessAccounts.id, businessAccountId))
    .limit(1);
  return row;
}

router.get("/api/woocommerce/status", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const state = await loadState(businessAccountId);
    if (!state) return res.status(404).json({ error: "Business account not found" });
    const [counts] = await db
      .select({
        website: sql<number>`count(*) filter (where ${products.source} = 'woocommerce')::int`,
        manual: sql<number>`count(*) filter (where ${products.source} <> 'woocommerce')::int`,
      })
      .from(products)
      .where(eq(products.businessAccountId, businessAccountId));
    const featureOn = state.featureOn === "true";
    const connected = featureOn && state.connected === "true";
    const syncHours = state.syncHours ?? 24;
    const nextSyncAt = connected
      ? new Date((state.startedAt ? new Date(state.startedAt).getTime() : Date.now()) + syncHours * 3600_000).toISOString()
      : null;
    res.json({
      featureOn,
      connected,
      liveSource: await getLiveProductSource(businessAccountId),
      storeUrl: state.storeUrl ?? null,
      syncHours,
      syncHourChoices: WOO_SYNC_HOUR_CHOICES,
      syncing: state.status === "syncing",
      lastSyncedAt: state.lastSyncedAt ?? null,
      lastResult: (state.lastResult as WooSyncResult | null) ?? null,
      nextSyncAt,
      chatCurrency: state.chatCurrency ?? null,
      counts: { website: counts?.website ?? 0, manual: counts?.manual ?? 0 },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/woocommerce/test", requireAuth, requireBusinessAccount, requireSuperAdmin, async (req, res) => {
  try {
    const result = await testStore(normalizeStoreUrl(req.body?.storeUrl));
    res.json({
      success: true,
      ...result,
      message: result.total > 0 ? `Connected. ${result.total} products found.` : "Connected, but the website shows no products yet.",
    });
  } catch (error: any) {
    if (error instanceof WooStoreError) return res.json({ success: false, message: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/api/woocommerce/connect", requireAuth, requireBusinessAccount, requireSuperAdmin, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const state = await loadState(businessAccountId);
    if (state?.featureOn !== "true") return res.status(400).json({ error: "Switch WooCommerce on in Features first." });
    let storeUrl: string;
    try {
      storeUrl = normalizeStoreUrl(req.body?.storeUrl);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const hours = Number(req.body?.syncHours);
    if (WOO_SYNC_HOUR_CHOICES.includes(hours)) {
      await storage.upsertWidgetSettings(businessAccountId, { wooSyncHours: hours });
    }
    // The chat switches to the website's products only if this first sync works.
    const result = await syncWooCommerce(businessAccountId, "connect", { storeUrl });
    res.json({ success: result.ok, result, message: result.ok ? `Connected. ${result.total} products are now used in chat.` : result.error });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/woocommerce/sync-now", requireAuth, requireBusinessAccount, requireSuperAdmin, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const state = await loadState(businessAccountId);
    if (state?.featureOn !== "true" || state.connected !== "true") return res.status(400).json({ error: "Connect the website first." });
    const result = await syncWooCommerce(businessAccountId, "manual");
    res.json({ success: result.ok, result, message: result.ok ? "Products are up to date." : result.error });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/api/woocommerce/settings", requireAuth, requireBusinessAccount, requireSuperAdmin, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    const hours = Number(req.body?.syncHours);
    if (!WOO_SYNC_HOUR_CHOICES.includes(hours)) return res.status(400).json({ error: "Pick how often to re-read the website." });
    await storage.upsertWidgetSettings(businessAccountId, { wooSyncHours: hours });
    res.json({ success: true, syncHours: hours });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/woocommerce/disconnect", requireAuth, requireBusinessAccount, requireSuperAdmin, async (req, res) => {
  try {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "Business account not found" });
    await disconnectWooCommerce(businessAccountId);
    res.json({ success: true, message: "Disconnected. The chat uses your manual products again." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
