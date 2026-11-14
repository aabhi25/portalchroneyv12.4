/** WooCommerce product sync, shared by Products › WooCommerce and the Catalog page. */

/** GET /api/woocommerce/status (server/routes/wooCommerce.ts). */
export interface WooStatus {
  featureOn: boolean;
  connected: boolean;
  liveSource: "woocommerce" | "catalog";
  storeUrl: string | null;
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
