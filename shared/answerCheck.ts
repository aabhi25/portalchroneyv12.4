/**
 * Answer checking pilot (super admin › Answer checking): the AI reads a student's handwritten
 * answer and marks it against a saved marking scheme. Everything here is pure so the server,
 * the screens and the tests share one set of rules:
 *  - settings (what the random question picks from, per-subject rules, when to call a teacher)
 *  - marking schemes (steps with marks that add up to the question's maximum)
 *  - turning the AI's per-step judgement into final marks (cap, half marks, no double cuts)
 *  - the score band that sets the feedback tone, and the "AI-written" status
 */

export const SUBJECT_KINDS = ["maths", "science", "social_science", "english", "other"] as const;
export type SubjectKind = typeof SUBJECT_KINDS[number];

export const QUESTION_KINDS = ["short", "long", "numerical"] as const;
export type QuestionKind = typeof QUESTION_KINDS[number];

export const STRICTNESS = ["lenient", "standard", "strict"] as const;
export type Strictness = typeof STRICTNESS[number];

export const PRACTICE_LEVELS = ["strong", "average", "weak", "ai_copied"] as const;
export type PracticeLevel = typeof PRACTICE_LEVELS[number];

export const SCORE_BANDS = ["full", "high", "partial", "low", "zero"] as const;
export type ScoreBand = typeof SCORE_BANDS[number];

export type Correctness = "correct" | "partial" | "incorrect";
export type AiWrittenStatus = "likely_human" | "possibly_ai" | "inconclusive";
export type Level3 = "low" | "medium" | "high";

export interface SubjectRules {
  strictness: Strictness;
  unitsRequired: boolean;
  diagramsCount: boolean;
  /** How much spelling and grammar count: none, a little, or fully (languages). */
  languageWeight: "none" | "some" | "full";
  /** Extra notes for the marker, in plain words. */
  notes: string;
}

export interface ScopePick {
  board: string;
  medium: string;
  grade: string;
  subject: string;
}

export interface FeedbackTone {
  full: string;
  high: string;
  partial: string;
  low: string;
  zero: string;
}

export interface AnswerCheckSettings {
  /** Scopes the random question picks from; empty = every scope of the account. */
  scopes: ScopePick[];
  questionKinds: QuestionKind[];
  minMarks: number;
  maxMarks: number;
  subjectRules: Record<SubjectKind, SubjectRules>;
  /** Below this handwriting legibility (0–1) the answer goes to a teacher. */
  legibilityThreshold: number;
  /** Below this marking confidence (0–1) the answer goes to a teacher. */
  confidenceThreshold: number;
  /** Below this marking confidence (0–1) the answer is marked again, more carefully. */
  recheckBelow: number;
  /** An answer with a drawing (a diagram, graph, construction) goes to a teacher to confirm the marks. */
  drawingsToTeacher: boolean;
  feedbackTone: FeedbackTone;
}

export const DEFAULT_SUBJECT_RULES: Record<SubjectKind, SubjectRules> = {
  maths: {
    strictness: "standard", unitsRequired: true, diagramsCount: false, languageWeight: "none",
    notes: "Check formula, substitution, calculation, intermediate steps, units and the final answer. A correct final answer without working gets only the marks the scheme allows for it.",
  },
  science: {
    strictness: "standard", unitsRequired: true, diagramsCount: true, languageWeight: "none",
    notes: "Check scientific concepts, definitions, principles, diagrams and labels, formulas and conclusions.",
  },
  social_science: {
    strictness: "standard", unitsRequired: false, diagramsCount: false, languageWeight: "none",
    notes: "Check factual accuracy, key points, explanations, examples and the order of events where it matters.",
  },
  english: {
    strictness: "standard", unitsRequired: false, diagramsCount: false, languageWeight: "full",
    notes: "Check content, understanding of the question, grammar, vocabulary, sentence formation and relevance.",
  },
  other: {
    strictness: "standard", unitsRequired: false, diagramsCount: false, languageWeight: "some",
    notes: "Check that the essential concepts and expected points are covered and correct.",
  },
};

export const DEFAULT_FEEDBACK_TONE: FeedbackTone = {
  full: "Praise the student warmly for a complete, correct answer.",
  high: "Praise the answer and suggest one or two small improvements.",
  partial: "Name what was right, then explain the missing concepts clearly.",
  low: "Explain the mistakes kindly and say exactly how to improve.",
  zero: "Explain the expected answer simply and suggest revising the chapter.",
};

export function defaultAnswerCheckSettings(): AnswerCheckSettings {
  return {
    scopes: [],
    questionKinds: ["short", "long", "numerical"],
    minMarks: 2,
    maxMarks: 5,
    subjectRules: JSON.parse(JSON.stringify(DEFAULT_SUBJECT_RULES)),
    legibilityThreshold: 0.6,
    confidenceThreshold: 0.5,
    recheckBelow: 0.9,
    drawingsToTeacher: true,
    feedbackTone: { ...DEFAULT_FEEDBACK_TONE },
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : fallback);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** Fills in anything missing or invalid in stored settings (old rows, hand edits). */
export function resolveAnswerCheckSettings(raw: unknown): AnswerCheckSettings {
  const d = defaultAnswerCheckSettings();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const scopes: ScopePick[] = Array.isArray(r.scopes)
    ? r.scopes
      .filter((s: any) => s && typeof s === "object")
      .map((s: any) => ({ board: str(s.board).trim(), medium: str(s.medium).trim(), grade: str(s.grade).trim(), subject: str(s.subject).trim() }))
      .filter((s: ScopePick) => s.board && s.medium && s.grade)
    : d.scopes;
  const kinds = Array.isArray(r.questionKinds) ? r.questionKinds.filter((k: unknown) => QUESTION_KINDS.includes(k as QuestionKind)) : d.questionKinds;
  const minMarks = clamp(Math.round(num(r.minMarks, d.minMarks)), 1, 20);
  const maxMarks = clamp(Math.round(num(r.maxMarks, d.maxMarks)), minMarks, 20);
  const subjectRules = {} as Record<SubjectKind, SubjectRules>;
  for (const kind of SUBJECT_KINDS) {
    const base = d.subjectRules[kind];
    const s = (r.subjectRules && typeof r.subjectRules === "object" ? r.subjectRules[kind] : null) || {};
    subjectRules[kind] = {
      strictness: oneOf(s.strictness, STRICTNESS, base.strictness),
      unitsRequired: typeof s.unitsRequired === "boolean" ? s.unitsRequired : base.unitsRequired,
      diagramsCount: typeof s.diagramsCount === "boolean" ? s.diagramsCount : base.diagramsCount,
      languageWeight: oneOf(s.languageWeight, ["none", "some", "full"] as const, base.languageWeight),
      notes: str(s.notes, base.notes).slice(0, 1000),
    };
  }
  const tone = (r.feedbackTone && typeof r.feedbackTone === "object" ? r.feedbackTone : {}) as Record<string, unknown>;
  const feedbackTone = {} as FeedbackTone;
  for (const band of SCORE_BANDS) feedbackTone[band] = str(tone[band], d.feedbackTone[band]).slice(0, 300) || d.feedbackTone[band];
  return {
    scopes,
    questionKinds: kinds.length ? kinds : d.questionKinds,
    minMarks,
    maxMarks,
    subjectRules,
    legibilityThreshold: clamp(num(r.legibilityThreshold, d.legibilityThreshold), 0, 1),
    confidenceThreshold: clamp(num(r.confidenceThreshold, d.confidenceThreshold), 0, 1),
    recheckBelow: clamp(num(r.recheckBelow, d.recheckBelow), 0, 1),
    drawingsToTeacher: typeof r.drawingsToTeacher === "boolean" ? r.drawingsToTeacher : d.drawingsToTeacher,
    feedbackTone,
  };
}

/** Maps a subject name from the curriculum ("Mathematics", "ENG 6 ICSE Science", "गणित") to its rules. */
export function subjectKindOf(subject: string | null | undefined): SubjectKind {
  const s = (subject || "").toLowerCase();
  if (/math|गणित|algebra|geometry|arithmetic/.test(s)) return "maths";
  if (/physics|chemistry|biology|science|विज्ञान|evs|environment/.test(s) && !/social|political/.test(s)) return "science";
  if (/social|history|geography|civics|political|economics|sst|इतिहास|भूगोल|सामाजिक/.test(s)) return "social_science";
  if (/english|hindi|marathi|sanskrit|language|grammar|literature|हिंदी|मराठी|संस्कृत/.test(s)) return "english";
  return "other";
}

// ---- Marking schemes ------------------------------------------------------------------------

export interface SchemeStep {
  id: string;
  /** What the student must show, e.g. "Writes the formula v = u + at". */
  label: string;
  marks: number;
}

export interface MarkingScheme {
  steps: SchemeStep[];
  mustKeywords: string[];
  niceKeywords: string[];
  /** Other correct methods or wordings that earn full credit. */
  alternatives: string[];
  /** Marks for a correct final answer whose working is missing (null = mark by steps only). */
  finalAnswerOnlyMarks: number | null;
  allowHalfMarks: boolean;
  /** A full-marks answer must include something drawn (diagram, graph, construction). */
  needsDrawing?: boolean;
}

/** Rounds marks to the scheme's granularity: halves, or whole marks. */
export function roundMarks(value: number, allowHalfMarks: boolean): number {
  const v = Number.isFinite(value) ? value : 0;
  return allowHalfMarks ? Math.round(v * 2) / 2 : Math.round(v);
}

const cleanList = (v: unknown, max = 20) => (Array.isArray(v) ? v : [])
  .map(x => (typeof x === "string" ? x.trim() : ""))
  .filter(Boolean)
  .filter((x, i, a) => a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i)
  .slice(0, max)
  .map(x => x.slice(0, 300));

/**
 * Cleans a scheme (from the AI or the admin's edit) so its steps add up exactly to the
 * maximum: steps are kept in order, empty ones dropped, marks rounded to the scheme's
 * granularity; any difference is taken from (or added to) the last step(s).
 */
export function normalizeScheme(raw: unknown, maxMarks: number): MarkingScheme {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const allowHalfMarks = r.allowHalfMarks !== false;
  const unit = allowHalfMarks ? 0.5 : 1;
  const max = roundMarks(Math.max(unit, num(maxMarks, 1)), allowHalfMarks);
  const seen = new Set<string>();
  let steps: SchemeStep[] = (Array.isArray(r.steps) ? r.steps : [])
    .map((s: any, i: number) => {
      let id = str(s?.id).trim().slice(0, 40) || `s${i + 1}`;
      while (seen.has(id)) id = `${id}_${i + 1}`;
      seen.add(id);
      return { id, label: str(s?.label).trim().slice(0, 400), marks: roundMarks(Math.max(0, num(s?.marks, 0)), allowHalfMarks) };
    })
    .filter((s: SchemeStep) => s.label)
    .slice(0, 15);
  if (!steps.length) steps = [{ id: "s1", label: "Complete and correct answer", marks: max }];
  let total = steps.reduce((a, s) => a + s.marks, 0);
  if (total === 0) {
    // Spread evenly in units, the remainder on the first steps.
    const units = Math.round(max / unit);
    steps = steps.slice(0, Math.max(1, Math.min(steps.length, units)));
    const each = Math.floor(units / steps.length);
    let rest = units - each * steps.length;
    steps = steps.map(s => ({ ...s, marks: (each + (rest-- > 0 ? 1 : 0)) * unit }));
    total = max;
  }
  // Too many marks: take from the last steps first. Too few: add to the last step.
  let diff = roundMarks(total - max, allowHalfMarks);
  for (let i = steps.length - 1; diff > 0 && i >= 0; i--) {
    const take = Math.min(steps[i].marks, diff);
    steps[i] = { ...steps[i], marks: roundMarks(steps[i].marks - take, allowHalfMarks) };
    diff = roundMarks(diff - take, allowHalfMarks);
  }
  if (diff < 0) steps[steps.length - 1] = { ...steps[steps.length - 1], marks: roundMarks(steps[steps.length - 1].marks - diff, allowHalfMarks) };
  steps = steps.filter(s => s.marks > 0);
  const finalRaw = r.finalAnswerOnlyMarks;
  const finalAnswerOnlyMarks = finalRaw === null || finalRaw === undefined || finalRaw === ""
    ? null
    : clamp(roundMarks(num(finalRaw, 0), allowHalfMarks), 0, max);
  return {
    steps,
    mustKeywords: cleanList(r.mustKeywords),
    niceKeywords: cleanList(r.niceKeywords),
    alternatives: cleanList(r.alternatives, 10),
    finalAnswerOnlyMarks,
    allowHalfMarks,
    ...(r.needsDrawing === true ? { needsDrawing: true } : {}),
  };
}

export function schemeTotal(scheme: Pick<MarkingScheme, "steps">): number {
  return scheme.steps.reduce((a, s) => a + s.marks, 0);
}

/** Problems an admin must fix before saving an edited scheme (empty = fine). */
export function schemeProblems(scheme: MarkingScheme, maxMarks: number): string[] {
  const problems: string[] = [];
  if (!scheme.steps.length) problems.push("Add at least one step.");
  const total = schemeTotal(scheme);
  if (Math.abs(total - maxMarks) > 1e-9) problems.push(`The steps add up to ${total}, but the question is worth ${maxMarks}.`);
  if (scheme.steps.some(s => !s.label.trim())) problems.push("Every step needs a description.");
  if (!scheme.allowHalfMarks && scheme.steps.some(s => !Number.isInteger(s.marks))) problems.push("Half marks are switched off, so every step needs whole marks.");
  if (scheme.finalAnswerOnlyMarks !== null && scheme.finalAnswerOnlyMarks > maxMarks) problems.push("Final-answer-only marks can't be more than the question's maximum.");
  return problems;
}

// ---- Turning the AI's judgement into marks --------------------------------------------------

export interface AiStepJudgement {
  stepId: string;
  awarded: number;
  comment: string;
}

export interface StepResult {
  stepId: string;
  label: string;
  marks: number;
  awarded: number;
  comment: string;
}

export interface Deduction {
  stepId: string;
  marks: number;
  reason: string;
}

export interface MarkResult {
  steps: StepResult[];
  total: number;
  maxMarks: number;
  correctness: Correctness;
  band: ScoreBand;
  /** One entry per step that lost marks — a mistake can only cost marks once, at its step. */
  deductions: Deduction[];
  /** True when the final-answer-only rule set the total instead of the steps. */
  finalAnswerOnlyApplied: boolean;
}

/**
 * Final marks from the AI's per-step judgement: each step is capped at its own marks and
 * rounded to the scheme's granularity, unknown steps are ignored, missing steps score 0, and
 * the total never exceeds the maximum. When the final answer is right but the working is
 * missing, the scheme's final-answer-only marks are the floor.
 */
export function applyJudgement(
  scheme: MarkingScheme,
  maxMarks: number,
  judgements: AiStepJudgement[],
  opts: { finalAnswerCorrect?: boolean; workingShown?: boolean } = {},
): MarkResult {
  const byId = new Map<string, AiStepJudgement>();
  for (const j of judgements || []) if (j && typeof j.stepId === "string" && !byId.has(j.stepId)) byId.set(j.stepId, j);
  const steps: StepResult[] = scheme.steps.map(step => {
    const j = byId.get(step.id);
    const awarded = clamp(roundMarks(num(j?.awarded, 0), scheme.allowHalfMarks), 0, step.marks);
    return { stepId: step.id, label: step.label, marks: step.marks, awarded, comment: str(j?.comment).trim().slice(0, 400) };
  });
  let total = roundMarks(steps.reduce((a, s) => a + s.awarded, 0), scheme.allowHalfMarks);
  let finalAnswerOnlyApplied = false;
  if (scheme.finalAnswerOnlyMarks !== null && opts.finalAnswerCorrect && opts.workingShown === false && total < scheme.finalAnswerOnlyMarks) {
    total = scheme.finalAnswerOnlyMarks;
    finalAnswerOnlyApplied = true;
  }
  total = clamp(total, 0, maxMarks);
  const deductions: Deduction[] = finalAnswerOnlyApplied ? [] : steps
    .filter(s => s.awarded < s.marks)
    .map(s => ({ stepId: s.stepId, marks: roundMarks(s.marks - s.awarded, true), reason: s.comment || `Not shown: ${s.label}` }));
  return { steps, total, maxMarks, correctness: correctnessOf(total, maxMarks), band: scoreBand(total, maxMarks), deductions, finalAnswerOnlyApplied };
}

export function correctnessOf(total: number, maxMarks: number): Correctness {
  if (maxMarks > 0 && total >= maxMarks) return "correct";
  if (total <= 0) return "incorrect";
  return "partial";
}

/** Feedback tone: full marks, high (≥ 75 %), partial (≥ 40 %), low (> 0), zero. */
export function scoreBand(total: number, maxMarks: number): ScoreBand {
  if (maxMarks <= 0 || total <= 0) return "zero";
  const ratio = total / maxMarks;
  if (ratio >= 1) return "full";
  if (ratio >= 0.75) return "high";
  if (ratio >= 0.4) return "partial";
  return "low";
}

// ---- AI-written estimate --------------------------------------------------------------------

/** Answers shorter than this give no reliable signal, so the estimate is always "inconclusive". */
export const AI_WRITTEN_MIN_WORDS = 40;

export function wordCount(text: string): number {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

/** Status from the estimated AI-written percentage; short answers are always inconclusive. */
export function aiWrittenStatus(percent: number, words: number): AiWrittenStatus {
  if (words < AI_WRITTEN_MIN_WORDS) return "inconclusive";
  if (percent >= 60) return "possibly_ai";
  if (percent <= 30) return "likely_human";
  return "inconclusive";
}

// ---- How sure the marks are --------------------------------------------------------------------
// The AI's own figure is no guide: on 255 markings with known fair marks it said under 90 % for only
// 3 of the 16 unfair ones (it is about 98 % sure either way). Worked out from what it did, 15 of
// the 16 came out under 90 %, with 1 fair marking in 6.

export interface ConfidenceInput {
  /** The AI's own figure (0–1). */
  aiConfidence: number;
  alternativeMethod: boolean;
  finalAnswerCorrect: boolean | null;
  total: number;
  maxMarks: number;
  /** Its marks contradicted its comments and it marked again; and they still did. */
  remarked: boolean;
  contradicts: boolean;
  legibility: number;
  unclearCount: number;
  /** The answer has a drawing, or must have one. */
  drawing: boolean;
}

/** Marks agreed on by two markings, the third included, are surer than one; markings that all differ are not. */
export const CONFIDENCE_AGREED = 0.95;
export const CONFIDENCE_DECIDED = 0.9;
export const CONFIDENCE_DIFFER = 0.5;

/** How sure one marking is (0–1), and what took it down. Never 1: marks are never certain. */
export function markingConfidence(i: ConfidenceInput): { score: number; why: string[] } {
  let score = 0.97;
  const why: string[] = [];
  const less = (by: number, reason: string) => { score -= by; why.push(reason); };
  if (i.alternativeMethod) less(0.12, "The student used another method.");
  if (i.finalAnswerCorrect === true && i.total < i.maxMarks) less(0.12, "The final answer is right, but it did not get full marks.");
  if (i.finalAnswerCorrect === false && i.total >= i.maxMarks) less(0.3, "The final answer is wrong, but it got full marks.");
  if (i.contradicts) less(0.35, "The marks and the AI's own comments don't agree.");
  else if (i.remarked) less(0.12, "The marks did not fit the AI's comments at first.");
  if (i.aiConfidence < 0.9) less(i.aiConfidence < 0.5 ? 0.5 : i.aiConfidence < 0.75 ? 0.2 : 0.1, "The AI says it is not sure.");
  if (i.legibility < 0.8) less(i.legibility < 0.6 ? 0.2 : 0.1, "The handwriting is hard to read.");
  if (i.unclearCount) less(Math.min(0.2, i.unclearCount * 0.08), i.unclearCount === 1 ? "One part could not be read clearly." : `${i.unclearCount} parts could not be read clearly.`);
  if (i.drawing) less(0.12, "The answer has a drawing.");
  return { score: Math.max(0.05, Math.round(score * 100) / 100), why };
}

/**
 * Which of an answer's markings stands, given their totals in the order they were made (a quick one,
 * a careful one, one by another model). Two that agree decide, the careful one for choice; three
 * different totals are for a teacher, and the middle one is shown meanwhile.
 */
export function settleMarkings(totals: number[]): { use: number; agreed: boolean } {
  const same = (a: number, b: number) => Math.abs(totals[a] - totals[b]) < 1e-9;
  if (totals.length < 2) return { use: 0, agreed: true };
  if (same(0, 1)) return { use: 1, agreed: true };
  if (totals.length < 3) return { use: 1, agreed: false };
  if (same(1, 2)) return { use: 1, agreed: true };
  if (same(0, 2)) return { use: 2, agreed: true };
  const middle = [0, 1, 2].sort((a, b) => totals[a] - totals[b])[1];
  return { use: middle, agreed: false };
}

/** A reading worth doing again by another model: hard to read, or several parts unclear. */
export function doubtfulReading(parts: Array<{ legibility: number; unclear: unknown[] }>): boolean {
  if (!parts.length) return false;
  const average = parts.reduce((a, p) => a + p.legibility, 0) / parts.length;
  return average < 0.7 || parts.reduce((a, p) => a + p.unclear.length, 0) >= 3;
}

/** How doubtful a reading is, to choose between two of the same sheet (lower is better). */
export function readingDoubt(parts: Array<{ legibility: number; unclear: unknown[] }>): number {
  if (!parts.length) return Number.POSITIVE_INFINITY;
  return parts.reduce((a, p) => a + p.unclear.length, 0) + 10 * (1 - parts.reduce((a, p) => a + p.legibility, 0) / parts.length);
}

// ---- When a teacher must look -----------------------------------------------------------------

export interface TeacherCheckInput {
  legibility: number;
  unclearCount: number;
  blank: boolean;
  confidence: number;
}

/** Reasons the answer goes to a teacher instead of straight to the student (empty = AI result stands). */
export function teacherReasons(input: TeacherCheckInput, settings: Pick<AnswerCheckSettings, "legibilityThreshold" | "confidenceThreshold">): string[] {
  const reasons: string[] = [];
  if (input.legibility < settings.legibilityThreshold) reasons.push("The handwriting is hard to read.");
  else if (input.unclearCount >= 3) reasons.push("Several parts of the answer could not be read.");
  if (input.confidence < settings.confidenceThreshold) reasons.push("The AI is not sure about its marks.");
  if (input.blank) reasons.push("The page looks blank or doesn't contain an answer.");
  return reasons;
}

// ---- Accuracy (AI vs teacher / expected) ------------------------------------------------------

export interface AccuracyRow {
  aiMarks: number | null;
  maxMarks: number;
  compareMarks: number | null;
}

export interface AccuracySummary {
  compared: number;
  withinHalf: number;
  exact: number;
  averageGap: number;
  /** AI gave more than the teacher on this many answers. */
  aiHigher: number;
  aiLower: number;
}

export function accuracySummary(rows: AccuracyRow[]): AccuracySummary {
  const pairs = rows.filter(r => r.aiMarks !== null && r.compareMarks !== null) as Array<{ aiMarks: number; compareMarks: number; maxMarks: number }>;
  const gaps = pairs.map(p => p.aiMarks - p.compareMarks);
  return {
    compared: pairs.length,
    withinHalf: gaps.filter(g => Math.abs(g) <= 0.5 + 1e-9).length,
    exact: gaps.filter(g => Math.abs(g) < 1e-9).length,
    averageGap: pairs.length ? Math.round((gaps.reduce((a, g) => a + Math.abs(g), 0) / pairs.length) * 100) / 100 : 0,
    aiHigher: gaps.filter(g => g > 1e-9).length,
    aiLower: gaps.filter(g => g < -1e-9).length,
  };
}

/** Maximum marks suggested for a question from its kind and the length of its model answer. */
export function suggestMaxMarks(kind: QuestionKind | null, modelAnswer: string, range: { minMarks: number; maxMarks: number }): number {
  const words = wordCount(modelAnswer);
  let marks = kind === "long" ? 5 : kind === "numerical" ? 3 : words > 120 ? 5 : words > 60 ? 3 : 2;
  if (kind === "numerical" && words > 80) marks = 4;
  return clamp(marks, range.minMarks, range.maxMarks);
}

// ---- The order of an answer sheet's pages -----------------------------------------------------

/**
 * A sheet's pages arranged by question — the page with question 1 first — from where each answer
 * was found. Page numbers are 1-based; the result lists the current page numbers in their new order.
 * An answer's own pages always follow each other as the answer reads (its parts are matched in
 * reading order), so a continuation never comes before its start. A page without answers stays
 * after the page it follows now.
 */
export function pageOrderByQuestion(pageCount: number, parts: Array<{ pages: number[] }>, answers: Array<{ parts: number[] }>): number[] {
  const all = Array.from({ length: pageCount }, (_, i) => i + 1);
  const firstQuestion = new Map<number, number>();
  const before = new Map<number, Set<number>>(all.map(p => [p, new Set<number>()]));
  answers.forEach((a, q) => {
    const pages: number[] = [];
    for (const i of a.parts ?? []) {
      for (const p of parts[i]?.pages ?? []) if (p >= 1 && p <= pageCount && !pages.includes(p)) pages.push(p);
    }
    pages.forEach((p, i) => {
      if (!firstQuestion.has(p)) firstQuestion.set(p, q);
      if (i > 0) before.get(p)!.add(pages[i - 1]);
    });
  });
  let last = -1;
  for (const p of all) {
    if (firstQuestion.has(p)) last = firstQuestion.get(p)!;
    else firstQuestion.set(p, last + 0.5);
  }
  const order: number[] = [];
  const left = new Set(all);
  while (left.size) {
    const free = Array.from(left).filter(p => Array.from(before.get(p)!).every(b => !left.has(b)));
    // Answers that contradict each other can leave no free page: take the earliest question's.
    const next = (free.length ? free : Array.from(left)).sort((a, b) => firstQuestion.get(a)! - firstQuestion.get(b)! || a - b)[0];
    order.push(next);
    left.delete(next);
  }
  return order;
}

/** Page numbers after the pages are put in `order` (the old page numbers, in their new order), listed as they were. */
export function renumberPages(pages: unknown, order: number[]): number[] {
  return (Array.isArray(pages) ? pages : [])
    .map(p => order.indexOf(Number(p)) + 1)
    .filter(p => p >= 1);
}

/** "Q1–Q3, Q5": a page's questions, given the paper's question numbers in order. */
export function questionSpan(numbers: string[], paperOrder: string[]): string {
  const idx = Array.from(new Set(numbers.map(x => paperOrder.indexOf(x)).filter(i => i >= 0))).sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const i of idx) {
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === i - 1) run.push(i);
    else runs.push([i]);
  }
  return runs.flatMap(r => r.length > 2 ? [`Q${paperOrder[r[0]]}–Q${paperOrder[r[r.length - 1]]}`] : r.map(i => `Q${paperOrder[i]}`)).join(", ");
}

/** Where an answer is on its sheet: a stretch of a page, from 0 (top) to 1 (bottom). */
export interface AnswerRegion { page: number; top: number; bottom: number }

/**
 * An answer's boundaries from its parts' places, in page order. Stretches that touch are one; a page
 * the answer is on but was not found on has no boundary (it is shown whole).
 */
export function answerRegions(parts: number[], places: Map<number, AnswerRegion[]>): AnswerRegion[] {
  const all = parts.flatMap(i => places.get(i) ?? []).sort((a, b) => a.page - b.page || a.top - b.top);
  const out: AnswerRegion[] = [];
  for (const r of all) {
    const last = out[out.length - 1];
    if (last && last.page === r.page && r.top <= last.bottom + 0.03) last.bottom = Math.max(last.bottom, r.bottom);
    else out.push({ ...r });
  }
  return out;
}

/** An answer's boundaries after its sheet's pages are put in `order` (the old page numbers, in their new order). */
export function movedRegions(regions: unknown, order: number[]): AnswerRegion[] {
  return (Array.isArray(regions) ? regions as AnswerRegion[] : [])
    .map(r => ({ ...r, page: order.indexOf(Number(r.page)) + 1 }))
    .filter(r => r.page >= 1)
    .sort((a, b) => a.page - b.page || a.top - b.top);
}
