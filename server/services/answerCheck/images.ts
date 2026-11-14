import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { answerCheckImages, type AnswerCheckImageRow } from "@shared/schema";
import { r2Storage } from "../r2StorageService";

/**
 * Answer checking pilot — the photos. Uploads are turned upright (phone EXIF), shrunk to at
 * most 2000 px on the long side and saved as JPEG, which keeps handwriting sharp for the AI
 * while staying small. They go to the PRIVATE R2 bucket when one is set up, otherwise into the
 * database; never into the public bucket (these are students' answer sheets).
 */

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_PAGES = 5;
const MAX_SIDE = 2000;

export type ImageKind = "answer" | "marked";

export class ImageError extends Error {}

/** Upright JPEG, at most 2000 px on the long side. Throws ImageError for files that aren't photos. */
export async function prepareUpload(input: Buffer): Promise<Buffer> {
  if (!input?.length) throw new ImageError("The photo is empty.");
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageError("Each photo must be under 12 MB.");
  const sharp = (await import("sharp")).default;
  try {
    return await sharp(input, { failOn: "error" })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new ImageError("That file isn't a photo we can read. Use JPG or PNG.");
  }
}

export async function saveImage(opts: { checkId: string; businessAccountId: string; kind: ImageKind; position: number; data: Buffer; contentType?: string }): Promise<AnswerCheckImageRow> {
  const contentType = opts.contentType || "image/jpeg";
  let storageRef: string | null = null;
  await r2Storage.ensureInitialized().catch(() => false);
  if (r2Storage.isEnabled() && r2Storage.isPrivateBucketConfigured()) {
    const ext = contentType === "image/png" ? ".png" : ".jpg";
    const up = await r2Storage.uploadSensitiveFile(opts.data, `${opts.kind}-${opts.position}${ext}`, "answer-checks", contentType, opts.businessAccountId);
    if (up.success && up.isPrivate && up.ref) storageRef = up.ref;
    else console.warn(`[Answer Check] private R2 upload failed (${up.error || "not private"}) — keeping the photo in the database`);
  }
  const [row] = await db.insert(answerCheckImages).values({
    checkId: opts.checkId,
    businessAccountId: opts.businessAccountId,
    kind: opts.kind,
    position: opts.position,
    storageRef,
    data: storageRef ? null : opts.data,
    contentType,
    byteSize: opts.data.length,
  }).returning();
  return row;
}

export async function listImages(checkId: string, kind?: ImageKind): Promise<AnswerCheckImageRow[]> {
  const where = kind ? and(eq(answerCheckImages.checkId, checkId), eq(answerCheckImages.kind, kind)) : eq(answerCheckImages.checkId, checkId);
  return db.select({
    id: answerCheckImages.id,
    checkId: answerCheckImages.checkId,
    businessAccountId: answerCheckImages.businessAccountId,
    kind: answerCheckImages.kind,
    position: answerCheckImages.position,
    storageRef: answerCheckImages.storageRef,
    data: answerCheckImages.data,
    contentType: answerCheckImages.contentType,
    byteSize: answerCheckImages.byteSize,
    createdAt: answerCheckImages.createdAt,
  }).from(answerCheckImages).where(where).orderBy(asc(answerCheckImages.kind), asc(answerCheckImages.position));
}

export async function imageBytes(row: Pick<AnswerCheckImageRow, "storageRef" | "data">): Promise<Buffer | null> {
  if (row.data) return Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data as any);
  if (!row.storageRef) return null;
  const got = await r2Storage.getObjectStream(row.storageRef);
  if (!got.success || !got.body) return null;
  const parts: Buffer[] = [];
  for await (const chunk of got.body) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(parts);
}

/** Removes the photos of a check (R2 objects too); the rows go with the check. */
export async function deleteStoredFiles(checkId: string): Promise<void> {
  const rows = await db.select({ storageRef: answerCheckImages.storageRef }).from(answerCheckImages).where(eq(answerCheckImages.checkId, checkId));
  for (const r of rows) {
    if (r.storageRef) await r2Storage.deleteByRef(r.storageRef).catch(() => undefined);
  }
}

export async function replaceMarkedImage(checkId: string, businessAccountId: string, data: Buffer): Promise<void> {
  const old = await db.select({ id: answerCheckImages.id, storageRef: answerCheckImages.storageRef }).from(answerCheckImages)
    .where(and(eq(answerCheckImages.checkId, checkId), eq(answerCheckImages.kind, "marked")));
  for (const o of old) {
    if (o.storageRef) await r2Storage.deleteByRef(o.storageRef).catch(() => undefined);
    await db.delete(answerCheckImages).where(eq(answerCheckImages.id, o.id));
  }
  await saveImage({ checkId, businessAccountId, kind: "marked", position: 0, data });
}

export function toDataUrl(data: Buffer, contentType = "image/jpeg"): string {
  return `data:${contentType};base64,${data.toString("base64")}`;
}
