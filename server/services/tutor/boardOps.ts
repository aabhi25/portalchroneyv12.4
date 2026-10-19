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

function cleanOne(raw: unknown, media: MediaResolver): BoardOp | null {
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
    const op = cleanOne(raw, media);
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
