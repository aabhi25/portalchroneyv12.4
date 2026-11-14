import path from "path";
import fs from "fs";
import type { StepResult } from "@shared/answerCheck";

/**
 * Answer checking pilot — pictures drawn in code (node-canvas):
 *  - practice answer sheets: the AI's practice answer written in a handwriting font on a lined
 *    exam page (Caveat for English, Kalam for Hindi / Marathi), slightly uneven like real writing
 *  - the marked sheet: the student's pages with a margin strip of ticks, crosses, marks per
 *    step, the total and the teacher-style remark, in red pen
 * Ticks and crosses are drawn as lines, not characters, so no font can be missing them.
 */

const FONT_DIR = process.env.ANSWER_CHECK_FONT_DIR || path.resolve(process.cwd(), "server/assets/fonts");
let canvasModule: typeof import("canvas") | null = null;

async function loadCanvas(): Promise<typeof import("canvas")> {
  if (canvasModule) return canvasModule;
  const mod: any = await import("canvas");
  const c = (mod.default && mod.default.createCanvas ? mod.default : mod) as typeof import("canvas");
  for (const [file, family] of [["Caveat.ttf", "Caveat"], ["Kalam-Regular.ttf", "Kalam"]] as const) {
    const full = path.join(FONT_DIR, file);
    if (fs.existsSync(full)) c.registerFont(full, { family });
    else console.warn(`[Answer Check] handwriting font missing: ${full} — practice sheets fall back to a plain font`);
  }
  canvasModule = c;
  return c;
}

const DEVANAGARI = /[\u0900-\u097F]/;

/** Caveat has no Hindi letters: text with Devanagari uses Kalam, a little smaller. */
function penFont(text: string, size: number): string {
  return DEVANAGARI.test(text) ? `${Math.round(size * 0.78)}px "Kalam"` : `${size}px "Caveat"`;
}

/** Small seeded random numbers, so the same answer always draws the same page. */
function seeded(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

/** Splits text into lines that fit `maxWidth`, keeping the writer's own line breaks. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= maxWidth || !line) {
        // A single word wider than the line is cut into pieces.
        if (!line && measure(word) > maxWidth) {
          let piece = "";
          for (const ch of word) {
            if (measure(piece + ch) > maxWidth && piece) { out.push(piece); piece = ch; } else piece += ch;
          }
          line = piece;
        } else line = next;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

const PAGE_W = 1240;
const PAGE_H = 1754;
const RULE_GAP = 66;
const FIRST_RULE = 250;
const MARGIN_X = 150;

/** Practice answer written by hand on lined pages; returns one JPEG per page (at most `maxPages`, default 3). */
export async function renderPracticeSheet(opts: { text: string; studentLabel: string; questionLabel: string; seed: string; maxPages?: number }): Promise<Buffer[]> {
  const c = await loadCanvas();
  const rand = seeded(opts.seed);
  const hindi = DEVANAGARI.test(opts.text);
  const fontFamily = hindi ? "Kalam" : "Caveat";
  const fontSize = hindi ? 38 : 52;
  const measureCanvas = c.createCanvas(10, 10).getContext("2d");
  measureCanvas.font = `${fontSize}px "${fontFamily}"`;
  const lines = wrapLines(opts.text, PAGE_W - MARGIN_X - 110, s => measureCanvas.measureText(s).width);
  const perPage = Math.floor((PAGE_H - FIRST_RULE - 80) / RULE_GAP);
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (!pages.length) pages.push([]);
  const ink = ["#1c2c7a", "#22348a", "#1a2970"][Math.floor(rand() * 3)];
  const sharp = (await import("sharp")).default;
  const out: Buffer[] = [];
  for (let p = 0; p < Math.min(pages.length, opts.maxPages ?? 3); p++) {
    const canvas = c.createCanvas(PAGE_W, PAGE_H);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fbfaf4";
    g.fillRect(0, 0, PAGE_W, PAGE_H);
    g.strokeStyle = "#b9cbe6";
    g.lineWidth = 2;
    for (let y = FIRST_RULE; y < PAGE_H - 40; y += RULE_GAP) { g.beginPath(); g.moveTo(40, y); g.lineTo(PAGE_W - 40, y); g.stroke(); }
    g.strokeStyle = "#e5a3a3";
    g.beginPath(); g.moveTo(MARGIN_X - 30, 0); g.lineTo(MARGIN_X - 30, PAGE_H); g.stroke();
    // Header, as a student writes it.
    g.fillStyle = ink;
    const qLabel = p === 0 ? opts.questionLabel : `${opts.questionLabel} (contd.)`;
    g.font = penFont(opts.studentLabel, 40);
    g.fillText(opts.studentLabel, MARGIN_X, 110);
    g.font = penFont(qLabel, 40);
    g.fillText(qLabel.length > 70 ? `${qLabel.slice(0, 68)}…` : qLabel, MARGIN_X, 170);
    g.font = `${fontSize}px "${fontFamily}"`;
    pages[p].forEach((line, i) => {
      const baseline = FIRST_RULE + i * RULE_GAP - 6 + (rand() - 0.5) * 5;
      const x = MARGIN_X + (rand() - 0.5) * 10;
      g.save();
      g.translate(x, baseline);
      g.rotate((rand() - 0.5) * 0.012);
      g.fillText(line, 0, 0);
      g.restore();
    });
    // A phone photo is never perfectly straight.
    const jpeg = canvas.toBuffer("image/jpeg", { quality: 0.9 });
    const angle = (rand() - 0.5) * 1.6;
    out.push(await sharp(jpeg).rotate(angle, { background: "#e8e6df" }).resize({ width: 1400, height: 1400, fit: "inside" }).jpeg({ quality: 85 }).toBuffer());
  }
  return out;
}

const PEN = "#d42020";

function drawTick(g: any, x: number, y: number, size: number) {
  g.beginPath();
  g.moveTo(x, y + size * 0.55);
  g.lineTo(x + size * 0.35, y + size * 0.9);
  g.lineTo(x + size, y);
  g.stroke();
}

function drawCross(g: any, x: number, y: number, size: number) {
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + size, y + size); g.stroke();
  g.beginPath(); g.moveTo(x + size, y); g.lineTo(x, y + size); g.stroke();
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/**
 * The marked answer sheet: pages stacked (900 px wide) with a red-pen strip on the right —
 * total in a circle, then each step with a tick (full), a half-tick (part) or a cross (none),
 * its marks and the examiner's short note, and the remark at the end.
 */
export async function renderMarkedSheet(opts: { pages: Buffer[]; steps: StepResult[]; total: number; maxMarks: number; remark: string; needsTeacher: boolean }): Promise<Buffer> {
  const c = await loadCanvas();
  const PAGE_WIDTH = 900;
  const STRIP = 420;
  const GAP = 14;
  const imgs = await Promise.all(opts.pages.map(p => c.loadImage(p)));
  const scaled = imgs.map(img => ({ img, h: Math.round(img.height * (PAGE_WIDTH / img.width)) }));
  const pagesHeight = scaled.reduce((a, s) => a + s.h, 0) + GAP * Math.max(0, scaled.length - 1);

  // Lay out the strip first to know how tall it must be.
  const measure = c.createCanvas(10, 10).getContext("2d");
  // Step text sits between the tick (50 px) and the marks on the right (about 80 px).
  const labelW = STRIP - 30 - 50 - 90;
  const noteW = STRIP - 30 - 50 - 24;
  const stepBlocks = opts.steps.map(s => {
    measure.font = penFont(s.label, 30);
    const label = wrapLines(s.label, labelW, t => measure.measureText(t).width).slice(0, 3);
    measure.font = penFont(s.comment, 26);
    const note = s.comment ? wrapLines(s.comment, noteW, t => measure.measureText(t).width).slice(0, 3) : [];
    return { s, label, note, h: 16 + label.length * 32 + note.length * 28 + 18 };
  });
  measure.font = penFont(opts.remark, 30);
  const remark = opts.remark ? wrapLines(opts.remark, STRIP - 60, t => measure.measureText(t).width).slice(0, 6) : [];
  const stripHeight = 230 + stepBlocks.reduce((a, b) => a + b.h, 0) + (remark.length ? 40 + remark.length * 34 : 0) + (opts.needsTeacher ? 60 : 0) + 40;
  const H = Math.max(pagesHeight, stripHeight);
  const canvas = c.createCanvas(PAGE_WIDTH + STRIP, H);
  const g = canvas.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, PAGE_WIDTH + STRIP, H);
  let y = 0;
  for (const s of scaled) { g.drawImage(s.img, 0, y, PAGE_WIDTH, s.h); y += s.h + GAP; }
  g.fillStyle = "#fff7f5";
  g.fillRect(PAGE_WIDTH, 0, STRIP, H);
  g.strokeStyle = "#f0c9c4"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(PAGE_WIDTH + 1, 0); g.lineTo(PAGE_WIDTH + 1, H); g.stroke();

  const x0 = PAGE_WIDTH + 30;
  g.strokeStyle = PEN; g.fillStyle = PEN; g.lineWidth = 4; g.lineCap = "round"; g.lineJoin = "round";
  // Total in a circle.
  g.beginPath(); g.ellipse(x0 + 150, 110, 120, 78, -0.08, 0, Math.PI * 2); g.stroke();
  g.font = `76px "Caveat"`;
  const totalText = `${fmt(opts.total)}/${fmt(opts.maxMarks)}`;
  g.fillText(totalText, x0 + 150 - g.measureText(totalText).width / 2, 135);
  let cy = 230;
  for (const b of stepBlocks) {
    const { s } = b;
    g.lineWidth = 4;
    if (s.awarded >= s.marks) drawTick(g, x0, cy, 34);
    else if (s.awarded <= 0) drawCross(g, x0 + 4, cy + 2, 28);
    else { drawTick(g, x0, cy, 34); g.beginPath(); g.moveTo(x0 + 2, cy + 34); g.lineTo(x0 + 30, cy + 6); g.stroke(); }
    g.font = `30px "Caveat"`;
    const marksText = `${fmt(s.awarded)}/${fmt(s.marks)}`;
    g.fillText(marksText, PAGE_WIDTH + STRIP - 24 - g.measureText(marksText).width, cy + 28);
    let ly = cy + 28;
    g.font = penFont(s.label, 30);
    for (const line of b.label) { g.fillText(line, x0 + 50, ly); ly += 32; }
    g.font = penFont(s.comment, 26);
    g.fillStyle = "#9b1c1c";
    for (const line of b.note) { g.fillText(line, x0 + 50, ly); ly += 28; }
    g.fillStyle = PEN;
    cy += b.h;
  }
  if (remark.length) {
    cy += 10;
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x0, cy); g.lineTo(PAGE_WIDTH + STRIP - 30, cy); g.stroke();
    cy += 40;
    g.font = penFont(opts.remark, 30);
    for (const line of remark) { g.fillText(line, x0, cy); cy += 34; }
  }
  if (opts.needsTeacher) {
    cy += 20;
    g.font = `30px "Caveat"`;
    g.fillText("Teacher to review", x0, cy + 20);
  }
  return canvas.toBuffer("image/jpeg", { quality: 0.85 });
}
