/**
 * AI Tutor — the live board.
 *
 * The tutor never sends pictures of the board: it sends small, typed instructions ("ops") that
 * the widget draws, each tied to the spoken sentence it belongs to. The same model (`applyOps`)
 * runs on the server (to know what is on the board, e.g. for highlights and resume snapshots)
 * and in the widget (to render it).
 *
 * Ops (an `id` names the thing drawn so later ops can highlight or erase it):
 *   write     handwritten text (title / body / note)
 *   math      a formula in TeX (rendered with KaTeX)
 *   image     a figure from the chapter (the model names it m1, m2…; the server adds `src`)
 *   diagram   flow (boxes + arrows) · table · geometry (points on a 0–10 grid, segments, angles)
 *   highlight circle / underline / arrow on an element, or on one part of it (a node / a point)
 *   erase     remove one element
 *   clear     wipe the board (a new page)
 */
import { z } from "zod";

export const BOARD_MAX_ELEMENTS = 40;
const idSchema = z.string().regex(/^[a-z0-9_]{1,24}$/i);
const short = (n: number) => z.string().trim().min(1).max(n);

export const writeOp = z.object({
  op: z.literal("write"),
  id: idSchema,
  text: short(120),
  style: z.enum(["title", "body", "note"]).default("body"),
  color: z.enum(["ink", "blue", "red", "green"]).default("ink"),
});
export const mathOp = z.object({
  op: z.literal("math"),
  id: idSchema,
  tex: short(300),
});
export const imageOp = z.object({
  op: z.literal("image"),
  id: idSchema,
  mediaId: z.string().regex(/^m\d{1,3}$/),
  caption: z.string().trim().max(120).optional(),
  /** Set by the server only (proxied chapter image URL); never accepted from the model. */
  src: z.string().max(2000).optional(),
});
const flowDiagram = z.object({
  op: z.literal("diagram"),
  id: idSchema,
  kind: z.literal("flow"),
  title: z.string().trim().max(60).optional(),
  nodes: z.array(z.object({ id: idSchema, label: short(40) })).min(1).max(8),
  edges: z.array(z.object({ from: idSchema, to: idSchema, label: z.string().trim().max(24).optional() })).max(10).default([]),
});
const tableDiagram = z.object({
  op: z.literal("diagram"),
  id: idSchema,
  kind: z.literal("table"),
  title: z.string().trim().max(60).optional(),
  header: z.array(short(30)).min(1).max(5),
  rows: z.array(z.array(z.string().trim().max(40)).min(1).max(5)).min(1).max(6),
});
const coord = z.number().finite();
const geometryDiagram = z.object({
  op: z.literal("diagram"),
  id: idSchema,
  kind: z.literal("geometry"),
  title: z.string().trim().max(60).optional(),
  /** Point label → [x, y] on a 0–10 grid (y grows upwards). */
  points: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9']{0,3}$/), z.tuple([coord, coord])),
  segments: z.array(z.tuple([z.string(), z.string()])).max(12).default([]),
  /** Text written next to a segment ("5 cm", "c"). */
  sideLabels: z.array(z.object({ from: z.string(), to: z.string(), text: short(16) })).max(12).default([]),
  /** A right-angle box or an arc at a point, between its two neighbours on the given segments. */
  angles: z.array(z.object({ at: z.string(), mark: z.enum(["right", "arc"]), label: z.string().trim().max(10).optional() })).max(6).default([]),
});
export const diagramOp = z.union([flowDiagram, tableDiagram, geometryDiagram]);
export const highlightOp = z.object({
  op: z.literal("highlight"),
  target: idSchema,
  /** A flow node id, a geometry point label or segment "A-B"; omitted = the whole element. */
  part: z.string().trim().max(24).optional(),
  mode: z.enum(["circle", "underline", "arrow"]).default("circle"),
});
export const eraseOp = z.object({ op: z.literal("erase"), target: idSchema });
export const clearOp = z.object({ op: z.literal("clear") });

export const boardOpSchema = z.union([writeOp, mathOp, imageOp, diagramOp, highlightOp, eraseOp, clearOp]);
export type BoardOp = z.infer<typeof boardOpSchema>;
export type DiagramOp = z.infer<typeof diagramOp>;

export type BoardElement =
  | (z.infer<typeof writeOp> & { kind?: undefined })
  | z.infer<typeof mathOp>
  | z.infer<typeof imageOp>
  | DiagramOp;
export type BoardHighlight = { target: string; part?: string; mode: "circle" | "underline" | "arrow" };
export interface BoardState {
  /** Increases on every clear, so the widget can animate a fresh page. */
  page: number;
  elements: BoardElement[];
  highlights: BoardHighlight[];
}

export const emptyBoard = (): BoardState => ({ page: 0, elements: [], highlights: [] });

/** Applies ops in order. Pure: returns a new state. Unknown targets are ignored. */
export function applyOps(state: BoardState, ops: BoardOp[]): BoardState {
  let next: BoardState = { page: state.page, elements: state.elements.slice(), highlights: state.highlights.slice() };
  for (const op of ops) {
    switch (op.op) {
      case "clear":
        next = { page: next.page + 1, elements: [], highlights: [] };
        break;
      case "erase":
        next.elements = next.elements.filter((e) => e.id !== op.target);
        next.highlights = next.highlights.filter((h) => h.target !== op.target);
        break;
      case "highlight":
        if (next.elements.some((e) => e.id === op.target)) {
          // One highlight at a time reads like a teacher's pointer.
          next.highlights = [{ target: op.target, part: op.part, mode: op.mode }];
        }
        break;
      default: {
        const el = op as BoardElement;
        const at = next.elements.findIndex((e) => e.id === el.id);
        if (at >= 0) next.elements[at] = el;
        else next.elements.push(el);
      }
    }
  }
  return next;
}

/** The parts of an element a highlight may point at (flow node ids, geometry labels and segments). */
export function elementParts(el: BoardElement): string[] {
  if (el.op !== "diagram") return [];
  if (el.kind === "flow") return el.nodes.map((n) => n.id);
  if (el.kind === "geometry") {
    const pts = Object.keys(el.points);
    return [...pts, ...el.segments.map(([a, b]) => `${a}-${b}`), ...el.segments.map(([a, b]) => `${b}-${a}`)];
  }
  return [];
}

/** Wire messages the tutor sends besides the voice's own (see server/services/tutor). */
export interface TutorBoardOpsMessage { type: "board_ops"; responseId: string; index: number; ops: BoardOp[] }
export interface TutorBoardSnapshotMessage { type: "board_snapshot"; board: BoardState }
export interface TutorSentenceStartMessage { type: "sentence_start"; responseId: string; index: number }
