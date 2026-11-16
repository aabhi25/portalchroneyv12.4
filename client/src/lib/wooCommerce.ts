/** Website product sync (Shopify, WooCommerce or other shops), shared by Products › Website products and the Catalog page. */

/** How the website's products are read (server/services/websiteStores.ts). */
export type WebsiteReadMode = "public" | "keys" | "shopify" | "pagedata";

export const readModeLabel = (m: WebsiteReadMode) =>
  m === "keys" ? "WooCommerce, with the website's keys (saved encrypted)"
    : m === "shopify" ? "Shopify, the public product list (no keys)"
      : m === "pagedata" ? "the website's product pages (from its sitemap)"
        : "WooCommerce, the public product list (no keys)";

/** POST /api/woocommerce/detect: what kind of shop the address is. */
export interface WebsiteDetection {
  platform: "shopify" | "woocommerce" | "other";
  platformName: string | null;
  readMode: "public" | "shopify" | "pagedata" | null;
  storeUrl: string;
  total: number | null;
  sample: string[];
  currency: string | null;
  needsKeys: boolean;
  message: string;
}

/** GET /api/woocommerce/status (server/routes/wooCommerce.ts). */
export interface WooStatus {
  featureOn: boolean;
  connected: boolean;
  liveSource: "woocommerce" | "catalog";
  storeUrl: string | null;
  readMode: WebsiteReadMode;
  hasKeys: boolean;
  syncHours: number;
  syncHourChoices: number[];
  syncing: boolean;
  lastSyncedAt: string | null;
  lastResult: {
    ok: boolean;
    at: string;
    trigger: "connect" | "manual" | "scheduled";
    total: number;
    added: number;
    updated: number;
    removed: number;
    unchanged: number;
    currency: string | null;
    error?: string;
    problems?: { name: string; message: string }[];
  } | null;
  nextSyncAt: string | null;
  chatCurrency: string | null;
  counts: { website: number; manual: number };
}

export const WOO_STATUS_KEY = ["/api/woocommerce/status"];
