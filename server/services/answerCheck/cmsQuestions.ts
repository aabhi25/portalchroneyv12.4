import { parseDocument } from "htmlparser2";
import { subjectKindOf } from "@shared/answerCheck";
import { isObjectiveQuestion } from "./prompts";

/**
 * AI assessment — the client's own question files. Top Scholar's content system gives each question
 * as a small data file (question, solution, marks, type, tags; maths in MathML, pictures as <img>).
 * These are read exactly as they are, without the AI: maths is written on one line (72/100, √2,
 * x^2), pictures are listed in order with a "[Picture 1]" mark where they stood, multiple choice is
 * left out, and the questions come out as a paper — lowest marks first (Section A, B, C …), then by
 * question number. Pure (no AI, no database, no network) so every rule is tested.
 */

export interface CmsQuestion {
  /** The question's number in the client's system, e.g. "169318". */
  externalId: string;
  questionText: string;
  modelAnswer: string;
  marks: number | null;
  objective: boolean;
  /** Picture sources (a web address or a data: URL) in the order they appear. */
  questionPictures: string[];
  answerPictures: string[];
  chapter: string | null;
  /** Filled in by `arrangeAsPaper`. */
  number: string;
  section: string | null;
}

export interface CmsImport {
  questions: CmsQuestion[];
  /** Multiple choice and other objective questions left out. */
  objectiveLeftOut: number;
  /** Files that held no question we could read. */
  unreadable: string[];
  title: string;
  board: string;
  grade: string;
  medium: string;
  subject: string;
}

// ---- HTML with maths → plain text -----------------------------------------------------------------

type Node = { type: string; name?: string; data?: string; attribs?: Record<string, string>; children?: Node[] };

const BLOCK = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol", "blockquote"]);
const SPACED_OPERATORS = new Set(["=", "<", ">", "+", "-", "−", "×", "÷", "∴", "∵", ",", ":", "≤", "≥", "≠", "≈", "→", "⇒", "±"]);

const kids = (n: Node): Node[] => (n.children || []).filter(c => c.type !== "comment");
const elements = (n: Node): Node[] => kids(n).filter(c => c.type === "tag");
const isSimple = (s: string) => /^[A-Za-z0-9.√π\u0370-\u03ff\u0900-\u097f]+$/.test(s);
/** True for "(a + b)" — one bracket around everything — but not for "(a)(b)". */
function isBracketed(t: string): boolean {
  if (!t.startsWith("(") || !t.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "(") depth++;
    else if (t[i] === ")" && --depth === 0 && i < t.length - 1) return false;
  }
  return depth === 0;
}
const wrap = (s: string) => { const t = s.trim(); return isSimple(t) || isBracketed(t) ? t : `(${t})`; };
const nbsp = (s: string) => s.replace(/ /g, " ");

/** One MathML node on one line: fractions as a/b, roots as √x, powers as x^2. */
function mathText(n: Node): string {
  if (n.type === "text") return nbsp(n.data || "").trim() ? nbsp(n.data || "") : "";
  if (n.type !== "tag") return "";
  const name = (n.name || "").toLowerCase();
  const el = elements(n);
  const all = () => kids(n).map(mathText).join("");
  switch (name) {
    case "mi": case "mn": case "mtext": case "ms":
      return nbsp(kids(n).map(c => c.data || "").join(""));
    case "mo": {
      const raw = nbsp(kids(n).map(c => c.data || "").join(""));
      const s = raw.trim();
      if (!s) return raw ? " " : "";
      return SPACED_OPERATORS.has(s) ? ` ${s} ` : s;
    }
    case "mfrac": return el.length >= 2 ? `${wrap(mathText(el[0]))}/${wrap(mathText(el[1]))}` : all();
    case "msqrt": return `√${wrap(all())}`;
    case "mroot": return el.length >= 2 ? `${mathText(el[1]).trim()}√${wrap(mathText(el[0]))}` : all();
    case "msup": case "mover": return el.length >= 2 ? `${wrap(mathText(el[0]))}^${wrap(mathText(el[1]))}` : all();
    case "msub": case "munder": return el.length >= 2 ? `${wrap(mathText(el[0]))}_${wrap(mathText(el[1]))}` : all();
    case "msubsup": return el.length >= 3 ? `${wrap(mathText(el[0]))}_${wrap(mathText(el[1]))}^${wrap(mathText(el[2]))}` : all();
    case "mfenced": {
      const open = n.attribs?.open ?? "(";
      const close = n.attribs?.close ?? ")";
      return `${open}${el.map(mathText).map(s => s.trim()).join(", ")}${close}`;
    }
    case "mtable": return el.map(mathText).join("\n");
    case "mtr": return el.map(mathText).map(s => s.trim()).join(" ");
    case "mspace": return n.attribs?.linebreak === "newline" ? "\n" : " ";
    case "annotation": case "annotation-xml": return "";
    default: return all();
  }
}

/**
 * A question's or solution's HTML as plain text, with its pictures listed in order. Each picture
 * leaves "[Picture 1]", "[Picture 2]" … where it stood.
 */
export function cmsHtmlToText(html: string | null | undefined): { text: string; pictures: string[] } {
  if (!html || typeof html !== "string") return { text: "", pictures: [] };
  const pictures: string[] = [];
  const walk = (n: Node): string => {
    if (n.type === "text") return nbsp(n.data || "");
    if (n.type === "script" || n.type === "style") return "";
    if (n.type !== "tag") return kids(n).map(walk).join("");
    const name = (n.name || "").toLowerCase();
    if (name === "math") return ` ${mathText(n)} `;
    if (name === "img") {
      const src = (n.attribs?.src || "").trim();
      if (!src) return "";
      pictures.push(src);
      return ` [Picture ${pictures.length}] `;
    }
    if (name === "br") return "\n";
    if (name === "script" || name === "style") return "";
    const inner = kids(n).map(walk).join("");
    if (name === "sup") return inner.trim() ? `^${wrap(inner)}` : "";
    if (name === "sub") return inner.trim() ? `_${wrap(inner)}` : "";
    return BLOCK.has(name) ? `${inner}\n` : inner;
  };
  const text = walk(parseDocument(html) as unknown as Node)
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/ ([,.;])(?= |\n|$)/g, "$1")
    .trim();
  return { text, pictures };
}

// ---- Reading the files ----------------------------------------------------------------------------

const LANGUAGE_NAME: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi" };

/** A field that is either plain or one text per language ({ en: "…", hi: "…" }). */
function localized(v: unknown, lang: string): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o[lang] === "string") return o[lang] as string;
    const first = Object.values(o).find(x => typeof x === "string" && x.trim());
    return typeof first === "string" ? first : "";
  }
  return "";
}

function looksLikeQuestion(v: unknown): v is Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return o.name !== undefined && (o.questionId !== undefined || o.questionType !== undefined || o.solutionDescription !== undefined || o.marks !== undefined);
}

/** The question objects in one file: the system's own reply ({ result: […] }), a list, or one question. */
function questionObjects(json: unknown): Record<string, any>[] {
  if (Array.isArray(json)) return json.filter(looksLikeQuestion);
  if (!json || typeof json !== "object") return [];
  if (looksLikeQuestion(json)) return [json];
  const o = json as Record<string, unknown>;
  for (const key of ["result", "data", "questions", "items"]) {
    const found = questionObjects(o[key]);
    if (found.length) return found;
  }
  return [];
}

/** True when the text is one of the client's question files (so it is read directly, not by the AI). */
export function isCmsQuestionJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  try { return questionObjects(JSON.parse(t)).length > 0; } catch { return false; }
}

const cleanTag = (t: unknown) => (typeof t === "string" ? t.trim() : "");

/** Board, class, subject and chapter from the tags every question shares. */
function sharedDetails(tagLists: string[][]): { board: string; grade: string; subject: string; chapter: string } {
  const lists = tagLists.filter(l => l.length);
  const shared = lists.length ? lists[0].filter(t => lists.every(l => l.some(x => x.toLowerCase() === t.toLowerCase()))) : [];
  const board = shared.find(t => /\bboard\b|^(cbse|icse|igcse|isc|ib)$/i.test(t)) || "";
  const gradeTag = shared.find(t => /^\d{1,2}(st|nd|rd|th)?$/i.test(t)) || "";
  const subject = shared.find(t => t !== board && subjectKindOf(t) !== "other") || "";
  const rest = shared.filter(t => t !== board && t.length > 2 && !/^\d{1,2}(st|nd|rd|th)?$/i.test(t) && subjectKindOf(t) === "other");
  return { board, grade: gradeTag.replace(/\D/g, ""), subject, chapter: rest[0] || "" };
}

/**
 * The questions in the client's files, as a paper. Files that hold no question are named in
 * `unreadable`; a question that appears twice is kept once.
 */
export function parseCmsQuestionFiles(files: Array<{ name: string; text: string }>): CmsImport {
  const raw: Array<{ q: Record<string, any>; order: number }> = [];
  const unreadable: string[] = [];
  for (const f of files) {
    let found: Record<string, any>[] = [];
    try { found = questionObjects(JSON.parse(f.text.trim())); } catch { found = []; }
    if (!found.length) { unreadable.push(f.name); continue; }
    for (const q of found) raw.push({ q, order: raw.length });
  }
  // The language most questions are written in (English when they have it).
  const langCount = new Map<string, number>();
  for (const { q } of raw) {
    if (q.name && typeof q.name === "object") for (const k of Object.keys(q.name)) langCount.set(k, (langCount.get(k) || 0) + 1);
  }
  const lang = langCount.has("en") ? "en" : Array.from(langCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "en";

  const seen = new Set<string>();
  const questions: CmsQuestion[] = [];
  const tagLists: string[][] = [];
  let objectiveLeftOut = 0;
  for (const { q, order } of raw) {
    const externalId = String(q.questionId ?? q.id ?? `file-${order + 1}`).trim().slice(0, 60);
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    if (q.isDeleted === 1 || q.isDeleted === true) continue;
    if (isObjectiveQuestion(q.questionType, q.options)) { objectiveLeftOut++; continue; }
    const question = cmsHtmlToText(localized(q.name, lang));
    if (question.text.length < 3 && !question.pictures.length) continue;
    const solution = cmsHtmlToText(localized(q.solutionDescription ?? q.solution, lang));
    const marks = Number(q.marks);
    tagLists.push((Array.isArray(q.tags) ? q.tags : []).map(cleanTag).filter(Boolean));
    questions.push({
      externalId,
      questionText: question.text.slice(0, 4000),
      modelAnswer: solution.text.slice(0, 10000),
      marks: Number.isFinite(marks) && marks > 0 && marks <= 100 ? Math.round(marks * 2) / 2 : null,
      objective: false,
      questionPictures: question.pictures,
      answerPictures: solution.pictures,
      chapter: null,
      number: "",
      section: null,
    });
  }
  const details = sharedDetails(tagLists);
  for (const q of questions) q.chapter = details.chapter || null;
  return {
    questions: arrangeAsPaper(questions),
    objectiveLeftOut,
    unreadable,
    title: details.chapter,
    board: details.board,
    grade: details.grade,
    medium: LANGUAGE_NAME[lang] || "",
    subject: details.subject,
  };
}

const idOrder = (a: string, b: string) => {
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.localeCompare(b, undefined, { numeric: true });
};

/**
 * Orders the questions the way a paper is set: lowest marks first, then by question number, and
 * numbers them 1, 2, 3 …. When the marks differ, each marks group is a section (A, B, C …).
 */
export function arrangeAsPaper(questions: CmsQuestion[]): CmsQuestion[] {
  const sorted = questions.slice().sort((a, b) => (a.marks ?? Infinity) - (b.marks ?? Infinity) || idOrder(a.externalId, b.externalId));
  const groups = Array.from(new Set(sorted.map(q => q.marks)));
  const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `S${i + 1}`);
  return sorted.map((q, i) => ({ ...q, number: String(i + 1), section: groups.length > 1 ? letter(groups.indexOf(q.marks)) : null }));
}
