import crypto from "crypto";
import path from "path";
import { ImageError, MAX_UPLOAD_BYTES, prepareUpload } from "./images";
import { PdfRenderError, renderPdfPagesToJpegs } from "../pdfRenderer";

/**
 * AI assessment — files people upload: answer sheets (photos or a PDF of the pages) and question
 * papers / answer keys to import (PDF, Word, photos or plain text). Files arrive as data URLs.
 */

export const MAX_SHEET_PAGES = 12;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface IncomingFile {
  name: string;
  mime: string;
  data: Buffer;
}

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+)?(;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/;

/** Data URLs → files (name from the matching `names` entry). Throws ImageError for anything unreadable. */
export function readDataUrls(raw: unknown, names: unknown = []): IncomingFile[] {
  const list = Array.isArray(raw) ? raw : [];
  const nameList = Array.isArray(names) ? names : [];
  return list.map((item, i) => {
    const m = typeof item === "string" ? DATA_URL.exec(item) : null;
    if (!m) throw new ImageError("A file could not be read. Use photos (JPG, PNG) or a PDF.");
    const data = Buffer.from(m[3], "base64");
    if (data.length > MAX_FILE_BYTES) throw new ImageError("Each file must be under 20 MB.");
    const name = typeof nameList[i] === "string" ? String(nameList[i]).slice(0, 120) : `file-${i + 1}`;
    return { name, mime: (m[1] || "").toLowerCase(), data };
  });
}

export const isPdf = (f: IncomingFile) => f.mime === "application/pdf" || f.data.subarray(0, 5).toString() === "%PDF-";
export const isDocx = (f: IncomingFile) => /wordprocessingml/.test(f.mime) || /\.docx$/i.test(f.name);
export const isImage = (f: IncomingFile) => /^image\//.test(f.mime);

/** A PDF's pages as images (at most `maxPages`). */
export async function pdfPages(f: IncomingFile, maxPages: number): Promise<Buffer[]> {
  try {
    const pages = await renderPdfPagesToJpegs(f.data, { maxPages, scale: 2, maxFileBytes: MAX_FILE_BYTES });
    return pages.map(p => p.jpegBuffer);
  } catch (err) {
    if (err instanceof PdfRenderError) {
      throw new ImageError(err.code === "PASSWORD_REQUIRED" || err.code === "PASSWORD_WRONG" ? `${f.name} is password-protected. Upload it without a password.` : `${f.name} could not be opened as a PDF.`);
    }
    throw err;
  }
}

export interface SheetPages {
  pages: Buffer[];
  hashes: string[];
  duplicatesDropped: number;
}

/**
 * An answer sheet's pages, in the order uploaded: photos as they are, each PDF page by page.
 * The same page uploaded twice is kept once (and counted).
 */
export async function sheetPages(files: IncomingFile[]): Promise<SheetPages> {
  if (!files.length) throw new ImageError("Add the answer sheet: photos of the pages or a PDF.");
  const raw: Buffer[] = [];
  for (const f of files) {
    if (isPdf(f)) raw.push(...await pdfPages(f, MAX_SHEET_PAGES));
    else if (isImage(f)) raw.push(f.data);
    else throw new ImageError(`${f.name}: use photos (JPG, PNG) or a PDF.`);
    if (raw.length > MAX_SHEET_PAGES) throw new ImageError(`An answer sheet can have at most ${MAX_SHEET_PAGES} pages.`);
  }
  const pages: Buffer[] = [];
  const hashes: string[] = [];
  let duplicatesDropped = 0;
  for (const r of raw) {
    if (r.length > MAX_UPLOAD_BYTES) throw new ImageError("Each page must be under 12 MB.");
    const hash = crypto.createHash("sha1").update(r).digest("hex");
    if (hashes.includes(hash)) { duplicatesDropped++; continue; }
    hashes.push(hash);
    pages.push(await prepareUpload(r));
  }
  return { pages, hashes, duplicatesDropped };
}

/** Plain text of a Word (.docx) file: paragraphs from word/document.xml. */
export async function docxText(f: IncomingFile): Promise<string> {
  const XLSX: any = await import("xlsx");
  const CFB = (XLSX.default ?? XLSX).CFB;
  let zip: any;
  try { zip = CFB.read(f.data, { type: "buffer" }); } catch { throw new ImageError(`${f.name} could not be opened as a Word file.`); }
  const i = (zip.FullPaths as string[]).findIndex(p => /\/word\/document\.xml$/.test(p));
  if (i < 0) throw new ImageError(`${f.name} could not be opened as a Word file.`);
  const xml = Buffer.from(zip.FileIndex[i].content).toString("utf8");
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Text layer of a typed PDF (empty for scanned pages). */
export async function pdfText(f: IncomingFile): Promise<string> {
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(f.data),
    standardFontDataUrl: path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/"),
    verbosity: 0,
  }).promise;
  let text = "";
  for (let p = 1; p <= Math.min(doc.numPages, 30); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = "";
    let lastY: number | null = null;
    for (const item of content.items as any[]) {
      const y = item.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) { text += line.trimEnd() + "\n"; line = ""; }
      line += item.str + (item.hasEOL ? "\n" : "");
      lastY = y ?? lastY;
    }
    text += line.trimEnd() + "\n\n";
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
