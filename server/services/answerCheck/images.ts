import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { answerCheckImages, answerChecks, type AnswerCheckImageRow } from "@shared/schema";
import { r2Storage } from "../r2StorageService";

/**
 * Answer checking pilot — the photos. Uploads are turned upright (phone EXIF), shrunk to at
 * most 2000 px on the long side and saved as JPEG, which keeps handwriting sharp for the AI
 * while staying small. They go to the PRIVATE R2 bucket when one is set up, otherwise into the
 * database; never into the public bucket (these are students' answer sheets). A question's own
 * pictures (diagrams in the question or its model answer) are kept the same way, see pictures.ts.
 */

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_PAGES = 5;
/** Pages of a whole answer sheet. */
export const MAX_PAPER_PAGES = 12;
const MAX_SIDE = 2000;

export type ImageKind = "answer" | "marked" | "paper_page" | "question_picture" | "answer_picture";

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

export async function saveImage(opts: { checkId?: string | null; paperId?: string | null; questionKey?: string | null; businessAccountId: string; kind: ImageKind; position: number; data: Buffer; contentType?: string }): Promise<AnswerCheckImageRow> {
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
    checkId: opts.checkId ?? null,
    paperId: opts.paperId ?? null,
    questionKey: opts.questionKey ?? null,
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
    paperId: answerCheckImages.paperId,
    questionKey: answerCheckImages.questionKey,
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

/** A whole answer sheet's pages, in order. */
export async function listPaperImages(paperId: string): Promise<AnswerCheckImageRow[]> {
  return db.select().from(answerCheckImages)
    .where(and(eq(answerCheckImages.paperId, paperId), eq(answerCheckImages.kind, "paper_page")))
    .orderBy(asc(answerCheckImages.position));
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

/** Removes a paper's pages and its answers' photos from R2 (the rows go with the paper). */
export async function deletePaperFiles(paperId: string): Promise<void> {
  const pages = await db.select({ storageRef: answerCheckImages.storageRef }).from(answerCheckImages).where(eq(answerCheckImages.paperId, paperId));
  const answers = await db.select({ storageRef: answerCheckImages.storageRef }).from(answerCheckImages)
    .where(inArray(answerCheckImages.checkId, db.select({ id: answerChecks.id }).from(answerChecks).where(eq(answerChecks.paperId, paperId))));
  for (const r of [...pages, ...answers]) {
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

/** Tallest strip the AI's vision is shown at full sharpness; a taller photo is shrunk first. */
const SHARP_SIDE = 768;
/** Width a page is enlarged to (the vision limit is 2048), and the most it is enlarged. */
const ZOOM_WIDTH = 1960;
const MAX_ZOOM = 2;
/** Overlap between strips, about two lines of writing after enlarging. */
const STRIP_OVERLAP = 110;

export interface ReaderPhotos {
  images: Buffer[];
  /** What each photo is, said to the AI before it: "Page 2" or "Page 2, strip 1 of 4". */
  labels: string[];
  /** True when at least one page was cut into strips. */
  strips: boolean;
}

/**
 * A page as the reader should see it: enlarged (up to twice) and cut into overlapping strips, top to
 * bottom. The AI's vision shrinks a photo until its shorter side is 768 px, which blurs small
 * handwriting. Measured on a real sheet, three readings each: from the whole page "√2/1" was read as
 * "√2/2" every time; from same-size strips that was right but "= 8/1" squeezed at the paper's edge
 * was missed every time; from strips enlarged twice both were right every time.
 */
export async function readingStrips(page: Buffer): Promise<Buffer[]> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(page).metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) return [page];
  const zoom = Math.min(MAX_ZOOM, ZOOM_WIDTH / W);
  const width = Math.round(W * zoom);
  const height = Math.round(H * zoom);
  const enlarged = Math.abs(zoom - 1) < 0.02 ? page : await sharp(page).resize({ width, height, fit: "fill", kernel: "lanczos3" }).jpeg({ quality: 90 }).toBuffer();
  if (height <= SHARP_SIDE) return [enlarged];
  const n = Math.ceil((height - STRIP_OVERLAP) / (SHARP_SIDE - STRIP_OVERLAP));
  const stripHeight = Math.ceil((height + (n - 1) * STRIP_OVERLAP) / n);
  const out: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const top = Math.min(Math.max(0, i * (stripHeight - STRIP_OVERLAP)), Math.max(0, height - stripHeight));
    out.push(await sharp(enlarged).extract({ left: 0, top, width, height: Math.min(stripHeight, height - top) }).jpeg({ quality: 90 }).toBuffer());
  }
  return out;
}

/** A sheet's pages as photos for the reader, each named so page numbers stay page numbers. */
export async function readerPhotos(pages: Buffer[]): Promise<ReaderPhotos> {
  const images: Buffer[] = [];
  const labels: string[] = [];
  let strips = false;
  for (let p = 0; p < pages.length; p++) {
    const cut = await readingStrips(pages[p]);
    if (cut.length > 1) strips = true;
    cut.forEach((img, i) => {
      images.push(img);
      labels.push(cut.length > 1 ? `Page ${p + 1}, strip ${i + 1} of ${cut.length}` : `Page ${p + 1}`);
    });
  }
  return { images, labels, strips };
}

export function toDataUrl(data: Buffer, contentType = "image/jpeg"): string {
  return `data:${contentType};base64,${data.toString("base64")}`;
}
