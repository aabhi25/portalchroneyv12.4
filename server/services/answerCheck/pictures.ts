import { and, asc, eq, inArray, like } from "drizzle-orm";
import { db } from "../../db";
import { answerCheckImages } from "@shared/schema";
import { r2Storage } from "../r2StorageService";
import { allowLocal, assertPublicHost } from "../wooCommerceStore";
import { ImageError, imageBytes, prepareUpload, saveImage } from "./images";

/**
 * AI assessment — a question's own pictures: the figure a question shows ("In the figure, find x")
 * and the diagram its model answer draws. They are kept with the question (by its question key), so
 * the answer key is written with them in view and a student's drawing is marked against them.
 * Pictures arrive from the client's question files (an <img> web address or an embedded picture) or
 * are attached by hand in the editor.
 */

export const MAX_QUESTION_PICTURES = 4;
const MAX_PICTURE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export type PictureKind = "question_picture" | "answer_picture";

/** A picture kept as it is (`id`) or a new one (`data`, a data: URL). */
export interface PictureRef {
  id?: string;
  data?: string;
}

const DATA_URL = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i;

/** A data: URL as an upright JPEG. Throws ImageError when it isn't a picture. */
export async function pictureFromDataUrl(src: string): Promise<Buffer> {
  const m = DATA_URL.exec(src.trim());
  if (!m) throw new ImageError("A picture could not be read. Use a JPG or PNG.");
  return prepareUpload(Buffer.from(m[1], "base64"));
}

/**
 * A picture named in a question file — an embedded data: URL or a public https address — as an
 * upright JPEG. Each redirect is checked, private and local addresses are refused, and the
 * download is capped in size and time.
 */
export async function loadPictureSource(src: string): Promise<Buffer> {
  const raw = src.trim();
  if (/^data:/i.test(raw)) return pictureFromDataUrl(raw);
  let url: URL;
  try { url = new URL(raw.startsWith("//") ? `https:${raw}` : raw); } catch { throw new ImageError("The picture's address could not be read."); }
  for (let hop = 0; hop < 4; hop++) {
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && allowLocal())) throw new ImageError("The picture's address must start with https://");
    try { await assertPublicHost(url); } catch { throw new ImageError("The picture's address isn't allowed."); }
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", headers: { Accept: "image/*" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
      throw new ImageError("The picture could not be downloaded.");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new ImageError("The picture could not be downloaded.");
    if (Number(res.headers.get("content-length") || 0) > MAX_PICTURE_BYTES) throw new ImageError("The picture is too large.");
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_PICTURE_BYTES) throw new ImageError("The picture is too large.");
    return prepareUpload(bytes);
  }
  throw new ImageError("The picture could not be downloaded.");
}

export interface QuestionPictureIds {
  question: string[];
  answer: string[];
}

/** Picture ids of each question (question pictures and model-answer pictures, in order). */
export async function listQuestionPictures(businessAccountId: string, keys: string[]): Promise<Map<string, QuestionPictureIds>> {
  const map = new Map<string, QuestionPictureIds>();
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (!unique.length) return map;
  const rows = await db.select({ id: answerCheckImages.id, questionKey: answerCheckImages.questionKey, kind: answerCheckImages.kind })
    .from(answerCheckImages)
    .where(and(eq(answerCheckImages.businessAccountId, businessAccountId), inArray(answerCheckImages.questionKey, unique)))
    .orderBy(asc(answerCheckImages.position), asc(answerCheckImages.createdAt));
  for (const r of rows) {
    if (!r.questionKey) continue;
    const entry = map.get(r.questionKey) || { question: [], answer: [] };
    if (r.kind === "question_picture") entry.question.push(r.id);
    else if (r.kind === "answer_picture") entry.answer.push(r.id);
    map.set(r.questionKey, entry);
  }
  return map;
}

/** One question's pictures as image bytes, for the AI. */
export async function questionPictureBytes(businessAccountId: string, questionKey: string): Promise<{ question: Buffer[]; answer: Buffer[] }> {
  const rows = await db.select().from(answerCheckImages)
    .where(and(eq(answerCheckImages.businessAccountId, businessAccountId), eq(answerCheckImages.questionKey, questionKey)))
    .orderBy(asc(answerCheckImages.position), asc(answerCheckImages.createdAt));
  const out = { question: [] as Buffer[], answer: [] as Buffer[] };
  for (const r of rows) {
    const bytes = await imageBytes(r);
    if (!bytes) continue;
    if (r.kind === "question_picture") out.question.push(bytes);
    else if (r.kind === "answer_picture") out.answer.push(bytes);
  }
  return out;
}

async function removeRows(rows: Array<{ id: string; storageRef: string | null }>): Promise<void> {
  for (const r of rows) {
    if (r.storageRef) await r2Storage.deleteByRef(r.storageRef).catch(() => undefined);
  }
  if (rows.length) await db.delete(answerCheckImages).where(inArray(answerCheckImages.id, rows.map(r => r.id)));
}

/**
 * Makes a question's pictures of one kind match `wanted` (kept ones by id, new ones as data: URLs,
 * in this order). `undefined` leaves them as they are. Returns true when anything changed.
 */
export async function syncQuestionPictures(businessAccountId: string, questionKey: string, kind: PictureKind, wanted: PictureRef[] | undefined): Promise<boolean> {
  if (wanted === undefined) return false;
  const list = (Array.isArray(wanted) ? wanted : []).filter(w => w && (typeof w.id === "string" || typeof w.data === "string")).slice(0, MAX_QUESTION_PICTURES);
  const existing = await db.select({ id: answerCheckImages.id, storageRef: answerCheckImages.storageRef, position: answerCheckImages.position })
    .from(answerCheckImages)
    .where(and(eq(answerCheckImages.businessAccountId, businessAccountId), eq(answerCheckImages.questionKey, questionKey), eq(answerCheckImages.kind, kind)))
    .orderBy(asc(answerCheckImages.position), asc(answerCheckImages.createdAt));
  const keep = new Set(list.map(w => w.id).filter((id): id is string => !!id && existing.some(e => e.id === id)));
  const gone = existing.filter(e => !keep.has(e.id));
  let changed = gone.length > 0;
  await removeRows(gone);
  let position = 0;
  for (const w of list) {
    if (w.id && keep.has(w.id)) {
      const row = existing.find(e => e.id === w.id)!;
      if (row.position !== position) {
        await db.update(answerCheckImages).set({ position }).where(eq(answerCheckImages.id, row.id));
        changed = true;
      }
      position++;
    } else if (w.data) {
      await saveImage({ questionKey, businessAccountId, kind, position, data: await pictureFromDataUrl(w.data) });
      changed = true;
      position++;
    }
  }
  return changed;
}

/** Removes the pictures of questions whose key starts with `prefix`, except the keys in `keep`. */
export async function deleteQuestionPictures(businessAccountId: string, prefix: string, keep: string[] = []): Promise<void> {
  const rows = await db.select({ id: answerCheckImages.id, storageRef: answerCheckImages.storageRef, questionKey: answerCheckImages.questionKey })
    .from(answerCheckImages)
    .where(and(eq(answerCheckImages.businessAccountId, businessAccountId), like(answerCheckImages.questionKey, `${prefix.replace(/[\\%_]/g, "\\$&")}%`)));
  await removeRows(rows.filter(r => !keep.includes(r.questionKey || "")));
}
