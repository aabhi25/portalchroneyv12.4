/**
 * AI Tutor — checks every board instruction the model writes before it reaches a student.
 *
 *  - invalid shapes are dropped (zod, shared/tutorBoard.ts);
 *  - images: only the chapter's own figures, named m1, m2… by the lesson pack; the model never
 *    supplies a URL — the server adds `src` (the TopScholar media proxy);
 *  - formulas must render in KaTeX (strict, no \href etc.), else they are written as text;
 *  - geometry is clamped to the 0–10 grid and may only join / label / mark points it defines;
 *  - flow edges must join existing nodes; highlights must point at something on the board;
 *  - a crowded board starts a new page.
 */
import katex from "katex";
import {
  applyOps,
  boardOpSchema,
  BOARD_MAX_ELEMENTS,
  elementParts,
  type BoardOp,
  type BoardState,
} from "@shared/tutorBoard";

export type MediaResolver = (mediaId: string) => { src: string; caption?: string | null } | null;

/** Link / HTML / file commands have no place on a maths board. */
const UNSAFE_TEX = /\\(href|url|includegraphics|html[A-Za-z]*|class|id|style|data)\b/i;

function katexOk(tex: string): boolean {
  if (UNSAFE_TEX.test(tex)) return false;
  try {
    katex.renderToString(tex, { throwOnError: true, trust: false, strict: "ignore", maxExpand: 200, maxSize: 20 });
    return true;
  } catch {
    return false;
  }
}

const clamp = (n: number) => Math.min(10, Math.max(0, Math.round(n * 100) / 100));

// ── formulas written as text ─────────────────────────────────────────────────────────
// Models sometimes write "d = sqrt((x2 - x1)^2 + …)" as handwriting instead of a math op: the
// board then shows "sqrt" and "^2" (and the handwriting font has no √). Such lines are turned
// into TeX and drawn by KaTeX.

const FORMULA_HINT = /sqrt\s*\(|√|\^|[²³≤≥≠×÷πθ]|(^|[^A-Za-z])[A-Za-z]\d+(?![A-Za-z0-9])/;
const FUNCTION_WORDS = new Set(["sqrt", "sin", "cos", "tan", "cot", "sec", "cosec", "log", "ln"]);

/** Text that is a formula / calculation rather than words (a few words like "Distance" are fine). */
export function looksLikeFormula(text: string): boolean {
  if (!FORMULA_HINT.test(text)) return false;
  const words = (text.match(/[A-Za-z]{3,}/g) || []).filter((w) => !FUNCTION_WORDS.has(w.toLowerCase()));
  return words.length <= 3;
}

/** The index of the ")" closing the "(" at `open`, or -1. */
function closingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** "sqrt((x2 - x1)^2 + 3²)" → "\\sqrt{(x_{2} - x_{1})^{2} + 3^{2}}"; null when it can't be read. */
export function formulaToTex(text: string): string | null {
  const conv = (input: string): string | null => {
    let s = input;
    // sqrt( … ) / √( … ) with nested brackets.
    for (let guard = 0; guard < 20; guard++) {
      const m = /(sqrt|√)\s*\(/i.exec(s);
      if (!m) break;
      const open = m.index + m[0].length - 1;
      const close = closingParen(s, open);
      if (close < 0) return null;
      const inner = conv(s.slice(open + 1, close));
      if (inner == null) return null;
      s = `${s.slice(0, m.index)}\\sqrt{${inner}}${s.slice(close + 1)}`;
    }
    s = s.replace(/√\s*([A-Za-z0-9.]+)/g, "\\sqrt{$1}");
    s = s.replace(/²/g, "^{2}").replace(/³/g, "^{3}");
    // ^( … ) and ^2 / ^-1 / ^n
    for (let guard = 0; guard < 20; guard++) {
      const i = s.search(/\^\s*\(/);
      if (i < 0) break;
      const open = s.indexOf("(", i);
      const close = closingParen(s, open);
      if (close < 0) return null;
      s = `${s.slice(0, i)}^{${s.slice(open + 1, close)}}${s.slice(close + 1)}`;
    }
    s = s.replace(/\^\s*(-?[A-Za-z0-9.]+)/g, "^{$1}");
    // x1, y2 → x_{1}, y_{2} (a single letter followed by digits)
    s = s.replace(/(^|[^A-Za-z\\])([A-Za-z])(\d+)(?![A-Za-z0-9])/g, "$1$2_{$3}");
    s = s.replace(/[×*]/g, " \\times ").replace(/÷/g, " \\div ").replace(/≤/g, " \\le ").replace(/≥/g, " \\ge ")
      .replace(/≠/g, " \\ne ").replace(/π/g, "\\pi ").replace(/θ/g, "\\theta ").replace(/°/g, "^{\\circ}");
    return s;
  };
  let tex = conv(text.trim());
  if (tex == null) return null;
  // Function names as commands, other words as upright text ("Distance d = …").
  tex = tex.replace(/(^|[^\\A-Za-z])(sin|cos|tan|cot|sec|log|ln)(?![A-Za-z])/g, "$1\\$2");
  tex = tex.replace(/(^|[^\\A-Za-z])([A-Za-z]{3,}(?:\s+[A-Za-z]{3,})*)(?![A-Za-z])/g, (_, pre, words) => `${pre}\\text{${words} }`);
  tex = tex.replace(/\s+/g, " ").trim();
  return tex.length <= 300 ? tex : null;
}

/** Formula-like handwriting → math ops (titles stay as they are); everything else unchanged. */
export function upgradeFormulaOps(ops: BoardOp[]): BoardOp[] {
  return ops.map((op) => {
    if (op.op !== "write" || op.style === "title" || !looksLikeFormula(op.text)) return op;
    const tex = formulaToTex(op.text);
    return tex && katexOk(tex) ? { op: "math", id: op.id, tex } : op;
  });
}

function cleanOne(raw: unknown, media: MediaResolver): BoardOp | null {
  // A board line that is too long is shortened, not lost (models overshoot the limit).
  if (raw && typeof raw === "object" && (raw as any).op === "write" && typeof (raw as any).text === "string" && (raw as any).text.length > 120) {
    raw = { ...(raw as any), text: `${(raw as any).text.slice(0, 119).trimEnd()}…` };
  }
  const parsed = boardOpSchema.safeParse(raw);
  if (!parsed.success) return null;
  const op = parsed.data;
  switch (op.op) {
    case "image": {
      const found = media(op.mediaId);
      if (!found) return null;
      return { ...op, src: found.src, caption: op.caption ?? found.caption ?? undefined };
    }
    case "math":
      return katexOk(op.tex) ? op : { op: "write", id: op.id, text: op.tex.slice(0, 120), style: "body", color: "ink" };
    case "diagram": {
      if (op.kind === "flow") {
        const ids = new Set(op.nodes.map((n) => n.id));
        return { ...op, edges: op.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to) };
      }
      if (op.kind === "geometry") {
        const entries = Object.entries(op.points).slice(0, 8).map(([k, [x, y]]) => [k, [clamp(x), clamp(y)]] as const);
        if (entries.length < 2) return null;
        const points = Object.fromEntries(entries) as Record<string, [number, number]>;
        const has = (p: string) => Object.prototype.hasOwnProperty.call(points, p);
        return {
          ...op,
          points,
          segments: op.segments.filter(([a, b]) => has(a) && has(b) && a !== b),
          sideLabels: op.sideLabels.filter((l) => has(l.from) && has(l.to)),
          angles: op.angles.filter((a) => has(a.at)),
        };
      }
      return op;
    }
    default:
      return op;
  }
}

/**
 * Cleans one sentence's ops against what is on the board right now. Returns the ops to send
 * and the board after them (callers keep it for the next sentence).
 */
export function sanitizeOps(rawOps: unknown, board: BoardState, media: MediaResolver, maxOps = 6): { ops: BoardOp[]; board: BoardState } {
  const list = Array.isArray(rawOps) ? rawOps.slice(0, maxOps) : [];
  const out: BoardOp[] = [];
  let state = board;
  for (const raw of list) {
    const cleaned = cleanOne(raw, media);
    const op = cleaned ? upgradeFormulaOps([cleaned])[0] : null;
    if (!op) continue;
    if (op.op === "highlight" || op.op === "erase") {
      const el = state.elements.find((e) => e.id === op.target);
      if (!el) continue;
      if (op.op === "highlight" && op.part && !elementParts(el).includes(op.part)) continue;
    }
    // A crowded board: start a new page before adding more.
    const adds = op.op === "write" || op.op === "math" || op.op === "image" || op.op === "diagram";
    if (adds && state.elements.length >= BOARD_MAX_ELEMENTS && !state.elements.some((e) => e.id === (op as any).id)) {
      out.push({ op: "clear" });
      state = applyOps(state, [{ op: "clear" }]);
    }
    out.push(op);
    state = applyOps(state, [op]);
  }
  return { ops: out, board: state };
}
