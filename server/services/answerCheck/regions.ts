import { ANSWER_CHECK_MODEL, type AnswerCheckAi } from "./ai";
import { LOCATE_SYSTEM, locateUserText, parseLocate, type SheetPart } from "./prompts";
import { renderRowNumbers } from "./drawing";
import { toDataUrl } from "./images";
import type { AnswerRegion } from "@shared/answerCheck";

/**
 * Answer checking pilot — where each answer is on the page, for the boundary drawn around it. The
 * rows of writing are found in code (so a boundary never cuts through a line), numbered in the
 * page's margins, and the AI says in which row each part of the sheet begins; a part reaches down
 * to where the next one begins. Measured on a real sheet, three runs each: asking for a position on
 * a ruler was up to a line off; asking for the row gave every one of 10 answers' exact start.
 */

/** Pixel width a page is measured at. */
const MEASURE_W = 500;
/** Darker than its surroundings by this much (of 255) is ink. */
const INK = 22;
/** Horizontal runs of ink longer than this are ruled lines or the paper's edge, not writing. */
const MAX_RUN = 36;
/** Ink thinner than this, top to bottom, is a ruled line (letters have strokes that go down the page). */
const MIN_HEIGHT = 4;
/** Fewer ink pixels than this in a pixel row is an empty row. */
const EMPTY = 1.2;
/** Writing reaches at least this much somewhere in its row; what is left of ruled lines doesn't. */
const WRITING = 3.5;

export interface PageRows {
  /** Row limits from 0 (top) to 1 (bottom) of the page. */
  edges: number[];
  /** Ink per pixel row, smoothed. */
  ink: Float64Array;
}

/** The page's rows of writing: cut where there is least ink. */
export async function writingRows(page: Buffer): Promise<PageRows> {
  const sharp = (await import("sharp")).default;
  const small = await sharp(page).greyscale().resize({ width: MEASURE_W }).png().toBuffer();
  const { data, info } = await sharp(small).greyscale().raw().toBuffer({ resolveWithObject: true });
  const around = await sharp(small).blur(14).greyscale().raw().toBuffer();
  const { width: w, height: h, channels } = info;
  // The photo's edges show the table, the paper's edge and the next page.
  const from = Math.round(w * 0.06);
  const to = Math.round(w * 0.94);
  const dark = (x: number, y: number) => { const i = (y * w + x) * channels; return around[i] - data[i] > INK; };
  const tall = new Uint8Array(w * h);
  for (let x = from; x < to; x++) {
    for (let y = 0; y < h;) {
      let end = y;
      while (end < h && dark(x, end)) end++;
      if (end - y >= MIN_HEIGHT) for (let k = y; k < end; k++) tall[k * w + x] = 1;
      y = Math.max(end, y + 1);
    }
  }
  const raw = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = from; x <= to; x++) {
      if (x < to && tall[y * w + x]) { run++; continue; }
      if (run <= MAX_RUN) raw[y] += run;
      run = 0;
    }
  }
  const reach = Math.max(1, Math.round(h * 0.003));
  const ink = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    const a = Math.max(0, y - reach);
    const b = Math.min(h - 1, y + reach);
    for (let k = a; k <= b; k++) ink[y] += raw[k];
    ink[y] /= b - a + 1;
  }
  const peak = (a: number, b: number) => { let m = 0; for (let k = a; k < b; k++) m = Math.max(m, ink[k]); return m; };

  // Dips in the ink, the emptiest first, never closer than about half a line.
  const apart = Math.max(6, Math.round(h * 0.016));
  const dips: Array<{ y: number; ink: number }> = [];
  for (let y = 0; y < h;) {
    let end = y;
    while (end + 1 < h && Math.abs(ink[end + 1] - ink[y]) < 0.34) end++;
    if (y > 2 && end < h - 3 && ink[y - 1] > ink[y] - 0.01 && ink[end + 1] > ink[y] - 0.01) dips.push({ y: Math.round((y + end) / 2), ink: ink[y] });
    y = end + 1;
  }
  const cuts: number[] = [];
  for (const d of dips.sort((a, b) => a.ink - b.ink)) if (cuts.every(c => Math.abs(c - d.y) >= apart)) cuts.push(d.y);
  cuts.sort((a, b) => a - b);
  // Only real dips, and no row without writing (it joins the row above it).
  const bounds = [0, ...cuts, h];
  const real = cuts.filter((c, i) => ink[c] < EMPTY || ink[c] < 0.6 * Math.min(peak(bounds[i], c), peak(c, bounds[i + 2])));
  const edges = [0];
  for (let i = 0; i < real.length; i++) {
    const next = real[i + 1] ?? h;
    if (peak(edges[edges.length - 1], real[i]) >= WRITING && peak(real[i], next) >= WRITING) edges.push(real[i]);
  }
  return { edges: [...edges, h].map(y => y / h), ink };
}

/** Shrinks a stretch of the page to its writing, with a little space around it. */
export function trimToWriting(rows: PageRows, top: number, bottom: number): { top: number; bottom: number } {
  const h = rows.ink.length;
  let a = Math.max(0, Math.floor(top * h));
  let b = Math.min(h - 1, Math.ceil(bottom * h) - 1);
  const start = a;
  const end = b;
  while (a < b && rows.ink[a] < WRITING) a++;
  while (b > a && rows.ink[b] < WRITING) b--;
  if (a >= b) return { top, bottom };
  // Back out to the whole letters.
  while (a > start && rows.ink[a - 1] >= EMPTY) a--;
  while (b < end && rows.ink[b + 1] >= EMPTY) b++;
  const space = 0.006;
  return { top: Math.max(top, a / h - space), bottom: Math.min(bottom, (b + 1) / h + space) };
}

/** Rows above the topmost part that are taken as its own. */
const MAX_ABOVE = 2;
const VIEW_W = 1180;
const MARGIN = 90;
const STRIP_H = 740;
const OVERLAP = 150;

/** The page with its rows numbered in both margins, as overlapping strips. */
async function numberedStrips(page: Buffer, edges: number[]): Promise<Buffer[]> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(page).metadata();
  const H = Math.max(1, Math.round((meta.height || 1) * (VIEW_W / (meta.width || 1))));
  const W = VIEW_W + 2 * MARGIN;
  const full = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
    .composite([
      { input: await sharp(page).resize({ width: VIEW_W, height: H, fit: "fill" }).toBuffer(), left: MARGIN, top: 0 },
      { input: await renderRowNumbers({ width: W, height: H, margin: MARGIN, edges }), left: 0, top: 0 },
    ]).png().toBuffer();
  if (H <= STRIP_H) return [await sharp(full).jpeg({ quality: 90 }).toBuffer()];
  const count = Math.ceil((H - OVERLAP) / (STRIP_H - OVERLAP));
  const height = Math.ceil((H + (count - 1) * OVERLAP) / count);
  const out: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const top = Math.min(i * (height - OVERLAP), Math.max(0, H - height));
    out.push(await sharp(full).extract({ left: 0, top, width: W, height: Math.min(height, H - top) }).jpeg({ quality: 90 }).toBuffer());
  }
  return out;
}

/**
 * Where the parts on one page are, from the row each begins in (part number → stretch of the page).
 * The topmost part begins at the top when it continues from another page (`continues`), or when no
 * more than a line or two is above it: everything written is some part (a heading too), so a line
 * above the first part is its own first line, placed a row too low.
 */
export function partsOnPage(rows: PageRows, located: Array<{ part: number; row: number }>, continues: number[] = []): Map<number, { top: number; bottom: number }> {
  const out = new Map<number, { top: number; bottom: number }>();
  const last = rows.edges.length - 1;
  const valid = located.filter(s => s.row >= 1 && s.row <= last);
  const topRow = Math.min(...valid.map(s => s.row));
  const starts = valid.map(s => (s.row === topRow && (s.row <= MAX_ABOVE + 1 || continues.includes(s.part)) ? { ...s, row: 1 } : s));
  for (const s of starts) {
    const next = Math.min(...starts.filter(o => o.row > s.row).map(o => o.row), last + 1);
    out.set(s.part, trimToWriting(rows, rows.edges[s.row - 1], rows.edges[next - 1]));
  }
  return out;
}

export interface LocatedParts {
  /** Part number → its stretch of each page it is on. */
  places: Map<number, AnswerRegion[]>;
  /** The pages each part is really on, as it reads (as the reader gave them where nothing better is known). */
  pages: number[][];
}

const NOT_LETTERS = new RegExp("[^\\p{L}\\p{N}]+", "gu");
const letters = (s: string) => s.toLowerCase().replace(NOT_LETTERS, "");

/** A part that only repeats another part's writing on the same page (the reader copied it twice). */
export function isRepeat(parts: SheetPart[], i: number, page: number): boolean {
  const mine = letters(parts[i].text);
  return mine.length >= 8 && parts.some((o, j) => {
    if (j === i || !o.pages.includes(page)) return false;
    const theirs = letters(o.text);
    return theirs.includes(mine) && (theirs.length > mine.length || j < i);
  });
}

/** One text holds the whole of the other. */
export function sameWriting(a: string, b: string): boolean {
  const [x, y] = [letters(a), letters(b)].sort((p, q) => p.length - q.length);
  return x.length >= 12 && y.includes(x);
}

/**
 * The pages a part is really on, in reading order: without the pages it isn't on, and ordered by
 * where each page's first words come in the part's text (the reader lists pages a part isn't on, or
 * in the order they were uploaded, when a sheet is out of order).
 */
export function partPages(part: SheetPart, notOn: number[], begins: Map<number, string>): number[] {
  const pages = part.pages.filter(p => !notOn.includes(p));
  if (pages.length < 2) return pages;
  const text = letters(part.text);
  const at = pages.map(p => {
    for (let words = letters(begins.get(p) ?? ""); words.length >= 6; words = words.slice(0, -1)) {
      const k = text.indexOf(words);
      if (k >= 0) return text.indexOf(words, k + 1) >= 0 ? -1 : k;
    }
    return -1;
  });
  // Only when every page's place in the text is known for certain.
  if (at.some(k => k < 0) || new Set(at).size !== at.length) return pages;
  return pages.map((p, i) => ({ p, k: at[i] })).sort((a, b) => a.k - b.k).map(x => x.p);
}

/**
 * Where every part of the sheet is, looked up page by page. Parts and pages the AI can't place are
 * left out; locating never fails a sheet.
 */
export async function locateParts(ai: AnswerCheckAi, pages: Buffer[], parts: SheetPart[]): Promise<LocatedParts> {
  const perPage = await Promise.all(pages.map(async (page, p) => {
    const here = parts.map((part, i) => ({ part, i })).filter(x => x.part.pages.includes(p + 1) && !isRepeat(parts, x.i, p + 1));
    if (!here.length) return null;
    try {
      const rows = await writingRows(page);
      const strips = await numberedStrips(page, rows.edges);
      const reply = await ai.json({
        model: ANSWER_CHECK_MODEL,
        system: LOCATE_SYSTEM,
        user: locateUserText(here.map(x => ({ id: x.i, text: x.part.text, label: x.part.label, continues: x.part.pages[0] !== p + 1, goesOn: x.part.pages.length > 1 })), rows.edges.length - 1),
        images: strips.map(b => toDataUrl(b)),
        imageLabels: strips.map((_, i) => `Strip ${i + 1} of ${strips.length}`),
        maxTokens: 1200,
      });
      const found = parseLocate(reply, here.map(x => x.i));
      return { page: p + 1, rows, ...found };
    } catch (err: any) {
      console.warn(`[Answer Check] answers on page ${p + 1} not located:`, err?.message || err);
      return null;
    }
  }));
  // A part of several pages whose "first line" on one of them is a line of another part there was
  // mistaken for it (the same words come on both pages).
  perPage.forEach(x => {
    if (!x) return;
    const borrowed = x.places.filter(s => {
      const words = letters(s.begins);
      const elsewhere = perPage.some(o => o && o !== x && o.places.some(t => t.part === s.part));
      return parts[s.part].pages.length > 1 && elsewhere && words.length >= 6 && x.places.some(o => o.part !== s.part && o.row <= s.row && parts[o.part].pages.length === 1 && letters(parts[o.part].text).includes(words));
    }).map(s => s.part);
    x.places = x.places.filter(s => !borrowed.includes(s.part));
    x.notHere = [...x.notHere, ...borrowed];
  });
  const refined = parts.map((part, i) => partPages(
    part,
    perPage.flatMap(x => (x?.notHere.includes(i) ? [x.page] : [])),
    new Map(perPage.flatMap(x => x?.places.filter(s => s.part === i).map(s => [x.page, s.begins] as [number, string]) ?? [])),
  ));
  // A part found on none of its pages that holds the same writing as one that was found: that one's pages.
  parts.forEach((part, i) => {
    const looked = perPage.filter(x => x && part.pages.includes(x.page));
    if (looked.length !== part.pages.length || looked.some(x => x!.places.some(s => s.part === i) || isRepeat(parts, i, x!.page))) return;
    const twin = parts.findIndex((o, j) => j !== i && perPage.some(x => x?.places.some(s => s.part === j)) && sameWriting(part.text, o.text));
    if (twin >= 0) refined[i] = refined[twin];
  });
  const places = new Map<number, AnswerRegion[]>();
  for (const x of perPage) {
    if (!x) continue;
    const continues = x.places.filter(s => refined[s.part][0] !== x.page).map(s => s.part);
    partsOnPage(x.rows, x.places, continues).forEach((place, part) => {
      if (!places.has(part)) places.set(part, []);
      places.get(part)!.push({ page: x.page, ...place });
    });
  }
  return { places, pages: refined };
}
