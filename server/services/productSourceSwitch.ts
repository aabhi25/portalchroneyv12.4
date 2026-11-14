import { and, eq, ne, type SQL } from "drizzle-orm";
import { db } from "../db";
import { businessAccounts, products, widgetSettings } from "@shared/schema";

/**
 * Which products the chat may use for an account.
 *
 * An account's products come either from its WooCommerce website or from the catalog it keeps by hand,
 * never both. While WooCommerce is connected (feature switched on + connected after a first good sync),
 * every chat surface (website chat, WhatsApp, Instagram/Facebook, voice, photo search, campaign and
 * ticket AI) sees only the products read from the website. The manual products stay untouched and come
 * back the moment WooCommerce is disconnected or switched off. Admin screens keep showing everything.
 *
 * A failing sync does NOT switch back to the manual products: the last good website products keep
 * serving and the WooCommerce page shows the problem.
 */

export type LiveProductSource = "woocommerce" | "catalog";

const CACHE_MS = 15_000;
const cache = new Map<string, { value: LiveProductSource; at: number }>();

export async function getLiveProductSource(businessAccountId: string): Promise<LiveProductSource> {
  const hit = cache.get(businessAccountId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const [row] = await db
    .select({ enabled: businessAccounts.wooCommerceEnabled, connected: widgetSettings.wooConnected })
    .from(businessAccounts)
    .leftJoin(widgetSettings, eq(widgetSettings.businessAccountId, businessAccounts.id))
    .where(eq(businessAccounts.id, businessAccountId))
    .limit(1);
  const value: LiveProductSource = row?.enabled === "true" && row?.connected === "true" ? "woocommerce" : "catalog";
  cache.set(businessAccountId, { value, at: Date.now() });
  return value;
}

/** Call after anything that changes the switch (connect, disconnect, feature switch). */
export async function onProductSourceChanged(businessAccountId: string): Promise<void> {
  cache.delete(businessAccountId);
  // Cached chat context (product list in the prompt) and intro must be rebuilt for the new set.
  const { businessContextCache } = await import("./businessContextCache");
  businessContextCache.invalidateBusinessCache(businessAccountId);
}

export function isLiveProduct(product: { source: string }, live: LiveProductSource): boolean {
  return live === "woocommerce" ? product.source === "woocommerce" : product.source !== "woocommerce";
}

/** WHERE condition for `products` rows the chat may use (add to queries next to the account check). */
export function liveProductCondition(live: LiveProductSource): SQL {
  return live === "woocommerce" ? eq(products.source, "woocommerce") : ne(products.source, "woocommerce");
}

/** Account check + live-set check in one, for `db.select().from(products).where(...)`. */
export async function chatProductsWhere(businessAccountId: string): Promise<SQL> {
  const live = await getLiveProductSource(businessAccountId);
  return and(eq(products.businessAccountId, businessAccountId), liveProductCondition(live))!;
}

/** Extra facts the AI and product cards get for website products (nothing for manual ones). */
export function liveProductExtras(p: { productUrl?: string | null; stockStatus?: string | null; regularPrice?: string | null }) {
  const extras: { productUrl?: string; stockStatus?: string; availability?: string; regularPrice?: string } = {};
  if (p.productUrl) extras.productUrl = p.productUrl;
  if (p.stockStatus) {
    extras.stockStatus = p.stockStatus;
    extras.availability = p.stockStatus === "out_of_stock" ? "Out of stock" : p.stockStatus === "on_backorder" ? "Available on backorder" : "In stock";
  }
  if (p.regularPrice) extras.regularPrice = p.regularPrice;
  return extras;
}
