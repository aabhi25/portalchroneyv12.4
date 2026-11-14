import { and, eq, isNotNull, or, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { products } from "@shared/schema";
import { fetchWebsiteImage } from "./wooCommerceStore";

/**
 * Photos for WhatsApp, Instagram and Facebook. Those apps fetch a product photo from its address and only
 * take JPEG or PNG (WhatsApp up to 5 MB). Website (WooCommerce) photos are checked once during the sync:
 *  - JPEG / PNG under 5 MB → the website's own link is used (no copy);
 *  - anything else (WebP, AVIF, GIF, too large) → a JPEG copy is made and kept in our storage (R2).
 * A photo is checked again only when its address changes. Website chat and the Catalog keep the website link.
 */

const WHATSAPP_MAX_BYTES = 5 * 1024 * 1024;
const CONCURRENCY = 4;

export interface MessagingImageStore {
  /** Saves a JPEG and returns its public https address, or null when there is no storage. */
  save(jpeg: Buffer, businessAccountId: string): Promise<string | null>;
  /** Removes a copy made earlier (only our own copies are passed in). */
  remove(url: string): Promise<void>;
}

const r2Store: MessagingImageStore = {
  async save(jpeg, businessAccountId) {
    const { r2Storage } = await import("./r2StorageService");
    await r2Storage.ensureInitialized();
    if (!r2Storage.isEnabled()) return null;
    const result = await r2Storage.uploadFile(jpeg, "photo.jpg", "messaging-images", "image/jpeg", businessAccountId);
    return result.success && result.url ? result.url : null;
  },
  async remove(url) {
    const { r2Storage } = await import("./r2StorageService");
    const key = r2Storage.extractKeyFromUrl(url);
    if (key) await r2Storage.deleteFile(key);
  },
};

let store: MessagingImageStore = r2Store;
/** Tests use a stand-in storage. */
export function setMessagingImageStore(s: MessagingImageStore | null) {
  store = s ?? r2Store;
}

/** The photo address to send on WhatsApp / Instagram / Facebook. */
export function messagingImageOf(p: { imageUrl?: string | null; messagingImageUrl?: string | null }): string | undefined {
  return p.messagingImageUrl || p.imageUrl || undefined;
}

const isOurCopy = (p: { imageUrl: string | null; messagingImageUrl: string | null }) =>
  !!p.messagingImageUrl && p.messagingImageUrl !== p.imageUrl;

/** Removes the copies of products that are about to be deleted. */
export async function removeMessagingImages(rows: { imageUrl: string | null; messagingImageUrl: string | null }[]) {
  for (const r of rows) {
    if (isOurCopy(r)) await store.remove(r.messagingImageUrl!).catch(() => {});
  }
}

type Outcome = "kept" | "copied" | "failed" | "no_storage";

async function prepareOne(businessAccountId: string, p: { id: string; imageUrl: string; messagingImageUrl: string | null }): Promise<Outcome> {
  let original: Buffer;
  try {
    original = await fetchWebsiteImage(p.imageUrl);
  } catch {
    return "failed"; // tried again at the next sync
  }
  const sharp = (await import("sharp")).default;
  let format: string | undefined;
  try {
    format = (await sharp(original).metadata()).format;
  } catch {
    return "failed"; // not a picture
  }
  let next: string;
  if ((format === "jpeg" || format === "png") && original.length <= WHATSAPP_MAX_BYTES) {
    next = p.imageUrl;
  } else {
    const jpeg = await sharp(original, { animated: false })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    const saved = await store.save(jpeg, businessAccountId);
    if (!saved) return "no_storage";
    next = saved;
  }
  if (isOurCopy({ imageUrl: p.imageUrl, messagingImageUrl: p.messagingImageUrl }) && p.messagingImageUrl !== next) {
    await store.remove(p.messagingImageUrl!).catch(() => {});
  }
  // Only if the photo hasn't changed meanwhile (a newer sync re-checks it).
  await db
    .update(products)
    .set({ messagingImageUrl: next, messagingImageFor: p.imageUrl })
    .where(and(eq(products.id, p.id), eq(products.imageUrl, p.imageUrl)));
  return next === p.imageUrl ? "kept" : "copied";
}

const running = new Map<string, Promise<Record<Outcome, number>>>();

/**
 * Checks the website photos that are new or changed since the last check. One run per account at a time
 * (a second call waits for the running one). Never throws.
 */
export function prepareMessagingImages(businessAccountId: string): Promise<Record<Outcome, number>> {
  const current = running.get(businessAccountId);
  if (current) return current;
  const run = (async () => {
    const counts: Record<Outcome, number> = { kept: 0, copied: 0, failed: 0, no_storage: 0 };
    try {
      // Photos removed on the website: drop our copy.
      const noPhoto = await db
        .select({ id: products.id, imageUrl: products.imageUrl, messagingImageUrl: products.messagingImageUrl })
        .from(products)
        .where(and(eq(products.businessAccountId, businessAccountId), eq(products.source, "woocommerce"), isNull(products.imageUrl), isNotNull(products.messagingImageUrl)));
      await removeMessagingImages(noPhoto);
      if (noPhoto.length) {
        await db.update(products).set({ messagingImageUrl: null, messagingImageFor: null })
          .where(and(eq(products.businessAccountId, businessAccountId), eq(products.source, "woocommerce"), isNull(products.imageUrl)));
      }

      const todo = await db
        .select({ id: products.id, imageUrl: products.imageUrl, messagingImageUrl: products.messagingImageUrl })
        .from(products)
        .where(and(
          eq(products.businessAccountId, businessAccountId),
          eq(products.source, "woocommerce"),
          isNotNull(products.imageUrl),
          or(isNull(products.messagingImageFor), ne(products.messagingImageFor, sql`${products.imageUrl}`)),
        ));
      for (let i = 0; i < todo.length; i += CONCURRENCY) {
        const outcomes = await Promise.all(todo.slice(i, i + CONCURRENCY).map(p => prepareOne(businessAccountId, p as any).catch(() => "failed" as Outcome)));
        for (const o of outcomes) counts[o]++;
        // Without storage nothing can be copied; the website links keep being sent as before.
        if (outcomes.includes("no_storage")) break;
      }
      if (todo.length) console.log(`[Messaging Images] ${businessAccountId}: ${counts.kept} usable as they are, ${counts.copied} copied as JPEG, ${counts.failed} failed${counts.no_storage ? ", no storage for copies" : ""}`);
    } catch (e: any) {
      console.error(`[Messaging Images] ${businessAccountId} failed:`, e?.message);
    } finally {
      running.delete(businessAccountId);
    }
    return counts;
  })();
  running.set(businessAccountId, run);
  return run;
}
