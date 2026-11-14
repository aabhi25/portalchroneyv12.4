import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { reportError } from "../lib/errorReporter";
import { businessAccounts, categories, productCategories, products, productTags, tags, widgetSettings } from "@shared/schema";
import { storage } from "../storage";
import { fetchStoreProducts, normalizeStoreUrl, WooStoreError, type WooKeys, type WooProduct } from "./wooCommerceStore";
import { decrypt, encrypt } from "./encryptionService";
import { onProductSourceChanged } from "./productSourceSwitch";
import { prepareMessagingImages, removeMessagingImages } from "./messagingImages";

/**
 * Brings a business's WooCommerce website products into its catalog (source 'woocommerce') and keeps them
 * in step: new ones added, changed ones updated, ones gone from the website removed. Manual products are
 * never touched. Runs on Connect, on "Sync now" and on a timer (every `woo_sync_hours`, default 24).
 *
 * Safety rule: if the website suddenly sends no products, or less than half of what we have, nothing is
 * changed and the sync is reported as failed, so a hiccup on the website can't empty the chat.
 */

export interface WooSyncResult {
  ok: boolean;
  at: string; // ISO time the attempt finished
  trigger: "connect" | "manual" | "scheduled";
  total: number; // products on the website
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  currency: string | null;
  error?: string;
  problems?: { name: string; message: string }[];
}

const STUCK_AFTER_MS = 60 * 60 * 1000;
const SAFETY_MIN_EXISTING = 10;

export const WOO_SYNC_HOUR_CHOICES = [1, 3, 6, 12, 24, 48, 72, 168];

function emptyResult(trigger: WooSyncResult["trigger"], error: string): WooSyncResult {
  return { ok: false, at: new Date().toISOString(), trigger, total: 0, added: 0, updated: 0, removed: 0, unchanged: 0, currency: null, error };
}

/** Takes the account's sync lock (or returns false while another sync runs). */
async function claimSync(businessAccountId: string): Promise<boolean> {
  if (!(await storage.getWidgetSettings(businessAccountId))) await storage.upsertWidgetSettings(businessAccountId, {});
  const claimed = await db
    .update(widgetSettings)
    .set({ wooSyncStatus: "syncing", wooSyncStartedAt: new Date() })
    .where(and(
      eq(widgetSettings.businessAccountId, businessAccountId),
      or(ne(widgetSettings.wooSyncStatus, "syncing"), isNull(widgetSettings.wooSyncStartedAt), lt(widgetSettings.wooSyncStartedAt, new Date(Date.now() - STUCK_AFTER_MS))),
    ))
    .returning({ id: widgetSettings.id });
  return claimed.length > 0;
}

async function finish(businessAccountId: string, result: WooSyncResult, extra: Partial<typeof widgetSettings.$inferInsert> = {}) {
  await db
    .update(widgetSettings)
    .set({
      wooSyncStatus: result.ok ? "completed" : "failed",
      wooLastResult: result as any,
      ...(result.ok ? { wooLastSyncedAt: new Date(result.at) } : {}),
      ...extra,
    })
    .where(eq(widgetSettings.businessAccountId, businessAccountId));
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null);
const samePrice = (a: string | null | undefined, b: string | null | undefined) =>
  (a == null || b == null) ? a == null && b == null : Number(a) === Number(b);

/** Find-or-create categories/tags by name (case-insensitive), the same way the Excel import does. */
async function nameIndex(businessAccountId: string, kind: "category" | "tag") {
  const rows = kind === "category" ? await storage.getAllCategories(businessAccountId) : await storage.getAllTags(businessAccountId);
  const byName = new Map(rows.map(r => [r.name.trim().toLowerCase(), r.id]));
  return async (name: string): Promise<string> => {
    const key = name.trim().toLowerCase();
    const found = byName.get(key);
    if (found) return found;
    const created = kind === "category"
      ? await storage.createCategory({ businessAccountId, name: name.trim() })
      : await storage.createTag({ businessAccountId, name: name.trim() });
    byName.set(key, created.id);
    return created.id;
  };
}

/** Current category/tag names of the account's website products, by product id. */
async function currentLabels(productIds: string[]) {
  const cats = new Map<string, Set<string>>();
  const tgs = new Map<string, Set<string>>();
  if (productIds.length === 0) return { cats, tgs };
  const catRows = await db
    .select({ productId: productCategories.productId, name: categories.name })
    .from(productCategories)
    .innerJoin(categories, eq(categories.id, productCategories.categoryId))
    .where(inArray(productCategories.productId, productIds));
  for (const r of catRows) (cats.get(r.productId) ?? cats.set(r.productId, new Set()).get(r.productId)!).add(r.name.trim().toLowerCase());
  const tagRows = await db
    .select({ productId: productTags.productId, name: tags.name })
    .from(productTags)
    .innerJoin(tags, eq(tags.id, productTags.tagId))
    .where(inArray(productTags.productId, productIds));
  for (const r of tagRows) (tgs.get(r.productId) ?? tgs.set(r.productId, new Set()).get(r.productId)!).add(r.name.trim().toLowerCase());
  return { cats, tgs };
}

const sameNames = (have: Set<string> | undefined, want: string[]) => {
  const w = new Set(want.map(n => n.toLowerCase()));
  const h = have ?? new Set<string>();
  return h.size === w.size && Array.from(w).every(n => h.has(n));
};

function productFields(p: WooProduct) {
  return {
    name: p.name,
    description: p.description,
    price: p.price,
    regularPrice: p.regularPrice,
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
    sku: p.sku,
    stockStatus: p.stockStatus,
  };
}

export type WooReadMode = "public" | "keys";

/** The saved keys, decrypted (only for the 'keys' read mode). */
export function savedWooKeys(settings: { wooConsumerKey?: string | null; wooConsumerSecret?: string | null } | null | undefined): WooKeys | undefined {
  if (!settings?.wooConsumerKey || !settings?.wooConsumerSecret) return undefined;
  try {
    return { key: decrypt(settings.wooConsumerKey), secret: decrypt(settings.wooConsumerSecret) };
  } catch {
    return undefined;
  }
}

/**
 * One sync. Never throws: problems come back in the result (and are saved for the WooCommerce page).
 * `connect`: the sync from the Connect button with the address / read mode / keys typed there. Only when
 * it works are they saved (keys encrypted) and the chat switched to the website products; a failed
 * Connect leaves an existing connection as it was.
 */
export async function syncWooCommerce(
  businessAccountId: string,
  trigger: WooSyncResult["trigger"],
  opts: { storeUrl?: string; readMode?: WooReadMode; keys?: WooKeys } = {},
): Promise<WooSyncResult> {
  if (!(await claimSync(businessAccountId))) {
    return emptyResult(trigger, "A sync is already running. Wait for it to finish.");
  }
  const settings = await storage.getWidgetSettings(businessAccountId);
  const previous = (settings?.wooLastResult as WooSyncResult | null) ?? null;
  try {
    const storeUrl = normalizeStoreUrl(opts.storeUrl ?? settings?.wooStoreUrl);
    const readMode: WooReadMode = opts.readMode ?? (settings?.wooReadMode === "keys" ? "keys" : "public");
    const keys = readMode === "keys" ? opts.keys ?? savedWooKeys(settings) : undefined;
    if (readMode === "keys" && !keys) throw new WooStoreError("Add the website's consumer key and secret first.");
    const fetched = await fetchStoreProducts(storeUrl, { keys });

    const existing = await db
      .select()
      .from(products)
      .where(and(eq(products.businessAccountId, businessAccountId), eq(products.source, "woocommerce")));

    // Safety rule (see top of file).
    if (fetched.products.length === 0) {
      throw new WooStoreError("The website sent back no products, so nothing was changed. Check that the products are published.");
    }
    if (existing.length >= SAFETY_MIN_EXISTING && fetched.products.length < existing.length / 2) {
      throw new WooStoreError(`The website sent back only ${fetched.products.length} products (we have ${existing.length}), so nothing was changed. If products really were removed, press Sync now again after checking the website.`);
    }
    // The website shows prices per visitor country (a currency plugin): never mix currencies silently.
    // Failed attempts carry the last good currency forward, so this is the currency of the last good sync.
    const knownCurrency = previous?.currency ?? null;
    if (knownCurrency && fetched.currency && fetched.currency !== knownCurrency) {
      throw new WooStoreError(`The website sent prices in ${fetched.currency} instead of ${knownCurrency}, so nothing was changed.`);
    }

    const byExternalId = new Map(existing.filter(p => p.externalId).map(p => [p.externalId!, p]));
    const { cats, tgs } = await currentLabels(existing.map(p => p.id));
    const categoryId = await nameIndex(businessAccountId, "category");
    const tagId = await nameIndex(businessAccountId, "tag");
    const now = new Date();
    const problems: { name: string; message: string }[] = [];
    let added = 0, updated = 0, unchanged = 0;
    const seen = new Set<string>();
    const staleCopies: { imageUrl: string | null; messagingImageUrl: string | null }[] = [];

    for (const wp of fetched.products) {
      seen.add(wp.externalId);
      try {
        const current = byExternalId.get(wp.externalId);
        const fields = productFields(wp);
        let productId: string;
        if (!current) {
          const [row] = await db
            .insert(products)
            .values({ businessAccountId, source: "woocommerce", isEditable: "false", externalId: wp.externalId, externalSyncedAt: now, ...fields })
            .returning({ id: products.id });
          productId = row.id;
          added++;
        } else {
          productId = current.id;
          const textChanged = current.name !== fields.name || current.description !== fields.description;
          const changed = textChanged
            || !samePrice(current.price, fields.price) || !samePrice(current.regularPrice, fields.regularPrice)
            || !same(current.imageUrl, fields.imageUrl) || !same(current.productUrl, fields.productUrl)
            || !same(current.sku, fields.sku) || !same(current.stockStatus, fields.stockStatus);
          const labelsChanged = !sameNames(cats.get(current.id), wp.categories) || !sameNames(tgs.get(current.id), wp.tags);
          if (changed) {
            await db
              .update(products)
              .set({
                ...fields,
                externalSyncedAt: now,
                updatedAt: now,
                // A new name/description needs a new search fingerprint (made in one batch below).
                ...(textChanged ? { textEmbedding: null, textEmbeddingGeneratedAt: null } : {}),
                // A new photo needs new photo fingerprints (only used by photo search) and a new check for WhatsApp.
                ...(!same(current.imageUrl, fields.imageUrl) ? { imageEmbedding: null, fullImageEmbedding: null, imageHash: null, visualDescription: null, messagingImageUrl: null, messagingImageFor: null } : {}),
              })
              .where(eq(products.id, current.id));
            if (!same(current.imageUrl, fields.imageUrl)) staleCopies.push(current);
            updated++;
          } else if (labelsChanged) {
            updated++;
          } else {
            unchanged++;
          }
          if (!labelsChanged) continue;
          await db.delete(productCategories).where(eq(productCategories.productId, productId));
          await db.delete(productTags).where(eq(productTags.productId, productId));
        }
        for (const name of wp.categories) await db.insert(productCategories).values({ productId, categoryId: await categoryId(name) });
        for (const name of wp.tags) await db.insert(productTags).values({ productId, tagId: await tagId(name) });
      } catch (e: any) {
        problems.push({ name: wp.name, message: e?.message || "Could not be saved" });
      }
    }

    // Gone from the website (deleted, unpublished or hidden): remove from the catalog (and their WhatsApp photo copies).
    const goneRows = existing.filter(p => !p.externalId || !seen.has(p.externalId));
    await removeMessagingImages([...staleCopies, ...goneRows]);
    const gone = goneRows.map(p => p.id);
    for (let i = 0; i < gone.length; i += 200) {
      await db.delete(products).where(and(eq(products.businessAccountId, businessAccountId), inArray(products.id, gone.slice(i, i + 200))));
    }
    // Everything we saw is current.
    await db
      .update(products)
      .set({ externalSyncedAt: now })
      .where(and(eq(products.businessAccountId, businessAccountId), eq(products.source, "woocommerce")));

    const result: WooSyncResult = {
      ok: true, at: new Date().toISOString(), trigger,
      total: fetched.products.length, added, updated, removed: gone.length, unchanged,
      currency: fetched.currency, ...(problems.length ? { problems: problems.slice(0, 20) } : {}),
    };
    await finish(businessAccountId, result, trigger === "connect" ? {
      wooStoreUrl: storeUrl,
      wooConnected: "true",
      wooReadMode: readMode,
      // Keys are kept only for the keys mode (encrypted); reading the public list forgets them.
      wooConsumerKey: keys ? encrypt(keys.key) : null,
      wooConsumerSecret: keys ? encrypt(keys.secret) : null,
    } : {});
    if (trigger === "connect" || added || updated || gone.length) await onProductSourceChanged(businessAccountId);

    // New or changed photos: check them for WhatsApp / Instagram / Facebook (JPEG copy only when needed).
    void prepareMessagingImages(businessAccountId);

    // Search fingerprints for new/changed products, a few at a time (not one call per product at once).
    if (added || updated) {
      import("./productTextEmbeddingService").then(({ productTextEmbeddingService }) =>
        productTextEmbeddingService.backfillEmbeddingsForBusiness(businessAccountId)
      ).catch(err => console.error(`[WooCommerce Sync] Search fingerprints failed for ${businessAccountId}:`, err?.message));
    }
    console.log(`[WooCommerce Sync] ${businessAccountId} (${trigger}): ${result.total} on website, +${added} ~${updated} -${gone.length}${problems.length ? `, ${problems.length} problems` : ""}`);
    return result;
  } catch (e: any) {
    const known = e instanceof WooStoreError;
    if (!known) {
      console.error(`[WooCommerce Sync] ${businessAccountId} failed:`, e?.message);
      reportError(e, { source: "worker:woocommerce-sync", tags: { businessAccountId } });
    }
    const result = { ...emptyResult(trigger, known ? e.message : "Something went wrong while saving the products. Try again."), currency: previous?.currency ?? null };
    await finish(businessAccountId, result);
    return result;
  }
}

/** Disconnect: the chat goes back to the manual products; website products stay (greyed out) for a quick reconnect. */
export async function disconnectWooCommerce(businessAccountId: string): Promise<void> {
  await storage.upsertWidgetSettings(businessAccountId, { wooConnected: "false" } as any);
  await onProductSourceChanged(businessAccountId);
}

/** Checks every 10 minutes for connected accounts whose next sync is due. */
export class WooCommerceSyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start() {
    if (this.timer) return;
    console.log("[WooCommerce Sync] Scheduler started");
    this.timer = setInterval(() => void this.tick(), 10 * 60 * 1000);
    setTimeout(() => void this.tick(), 60 * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await db
        .select({ id: widgetSettings.businessAccountId })
        .from(widgetSettings)
        .innerJoin(businessAccounts, eq(businessAccounts.id, widgetSettings.businessAccountId))
        .where(and(
          eq(businessAccounts.wooCommerceEnabled, "true"),
          eq(widgetSettings.wooConnected, "true"),
          or(ne(widgetSettings.wooSyncStatus, "syncing"), lt(widgetSettings.wooSyncStartedAt, new Date(Date.now() - STUCK_AFTER_MS))),
          // Measured from the last attempt, so a failing website is retried at the next interval, not every 10 minutes.
          or(isNull(widgetSettings.wooSyncStartedAt), sql`${widgetSettings.wooSyncStartedAt} < now() - make_interval(hours => ${widgetSettings.wooSyncHours})`),
        ));
      for (const { id } of due) await syncWooCommerce(id, "scheduled");
    } catch (e: any) {
      console.error("[WooCommerce Sync] Scheduler check failed:", e?.message);
      reportError(e, { source: "worker:woocommerce-sync" });
    } finally {
      this.running = false;
    }
  }
}

export const wooCommerceSyncScheduler = new WooCommerceSyncScheduler();
