import type { AnswerCheckSettings, MarkingScheme, PracticeLevel, QuestionKind, StepResult, Deduction, ScoreBand, Correctness } from "@shared/answerCheck";

/** Super admin › Answer checking: what the server sends, and small helpers shared by the pages. */

/** Server addresses (the account a super admin is viewing) and the pages' own address in that account. */
export const API = "/api/answer-checking";
export const ASSESS_PATH = "/admin/assessment";
export const OVERVIEW_KEY = [`${API}/overview`];
export const SCOPES_KEY = [`${API}/scopes`];

export interface ScopeOption { board: string; medium: string; grade: string; subjects: string[] }

export interface Overview {
  account: { id: string; name: string; hasKey: boolean } | null;
  /** The account's AI assessment feature switch (Settings › Features). */
  enabled: boolean;
  settings: AnswerCheckSettings;
  counts?: { checks: number; schemes: number };
}

export interface ScopesResponse { scopes: ScopeOption[]; error: string | null }

export interface QuestionInput {
  questionKey: string;
  source: "cms" | "custom" | "generated";
  questionText: string;
  modelAnswer: string;
  questionKind: QuestionKind | null;
  board: string | null;
  medium: string | null;
  grade: string | null;
  subject: string | null;
  chapter: string | null;
  maxMarks: number;
}

export interface SchemeView {
  id: string;
  questionKey: string;
  version: number;
  source: string;
  questionText: string;
  modelAnswer: string;
  modelAnswerByAi: boolean;
  questionKind: QuestionKind | null;
  board: string | null; medium: string | null; grade: string | null; subject: string | null; chapter: string | null;
  maxMarks: number;
  scheme: MarkingScheme;
  status: "ai_draft" | "approved";
  approvedAt: string | null;
  createdAt: string;
}

export interface CheckResult {
  steps: StepResult[];
  total: number;
  maxMarks: number;
  correctness: Correctness;
  band: ScoreBand;
  deductions: Deduction[];
  finalAnswerOnlyApplied: boolean;
  correctPoints: string[];
  mistakes: string[];
  missingConcepts: string[];
  missingKeywords: string[];
  alternativeMethod: boolean;
  confidence: number;
  confidenceNote: string;
  feedback: { summary: string; improvement: string; revision: string };
  teacherComment: string;
  schemeVersion: number;
  practiceWhy?: string;
}

export interface CheckView {
  id: string;
  questionKey: string;
  batchId: string | null;
  paperId: string | null;
  questionNumber: string | null;
  status: "writing" | "checking" | "done" | "needs_teacher" | "failed";
  interrupted: boolean;
  source: "upload" | "practice";
  practiceLevel: PracticeLevel | null;
  practiceText: string | null;
  expectedMarks: number | null;
  studentLabel: string;
  maxMarks: number;
  readText: string | null;
  reading: {
    legibility: number; unclear: Array<{ where: string; guess: string }>; blank: boolean; notes: string;
    // answers found in a whole answer sheet
    pages?: number[]; matchConfidence?: number; matchNote?: string; notAttempted?: boolean; unplacedOnSheet?: boolean;
  } | null;
  result: CheckResult | null;
  aiMarks: number | null;
  aiWritten: { percent: number | null; status: "likely_human" | "possibly_ai" | "inconclusive"; confidence: string; signals: string[]; words: number } | null;
  teacherReasons: string[];
  teacherMarks: number | null;
  teacherComment: string | null;
  teacherAt: string | null;
  history: Array<{ at: string; schemeVersion: number | null; aiMarks: number }>;
  model: string | null;
  costUsd: number;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  scheme: SchemeView | null;
  images: Array<{ id: string; kind: "answer" | "marked"; position: number }>;
}

export interface AccuracySummary { compared: number; withinHalf: number; exact: number; averageGap: number; aiHigher: number; aiLower: number }

export interface ChecksResponse {
  checks: CheckView[];
  accuracy: { teacher: AccuracySummary; expected: AccuracySummary; averageSeconds: number; averageCostUsd: number; needsTeacher: number; total: number };
}

export const imageUrl = (id: string) => `${API}/images/${id}`;

export interface PaperTotals { maxMarks: number; aiMarks: number | null; teacherMarks: number | null; expectedMarks: number | null; answered: number; notAttempted: number; needsTeacher: number }

export type PaperStatus = "writing" | "reading" | "checking" | "done" | "needs_teacher" | "failed";

export interface PaperView {
  id: string;
  title: string;
  studentLabel: string;
  source: "upload" | "practice";
  status: PaperStatus;
  questions: Array<{ number: string; questionKey: string }>;
  pages: Array<{ id: string; position: number }>;
  reading: { parts: Array<{ label: string; pages: number[]; text: string }>; blank: boolean; notes: string; pages: number } | null;
  matching: { answers: Array<{ number: string; parts: number[]; confidence: number; note: string; notAttempted: boolean }>; unassigned: Array<{ part: number; reason: string; text: string }> } | null;
  practice: { writtenOrder: string[]; sheet: string; answers: Array<{ number: string; level: string; expectedMarks: number; why: string }> } | null;
  totals: PaperTotals;
  checks: CheckView[];
  costUsd: number;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaperSummary {
  id: string; title: string; studentLabel: string; source: "upload" | "practice"; status: PaperStatus;
  questionCount: number; pageCount: number; totals: PaperTotals; costUsd: number; createdAt: string;
}

export const PAPER_STATUS_LABEL: Record<PaperStatus, string> = {
  writing: "Writing practice sheet…",
  reading: "Reading the sheet…",
  checking: "Marking answers…",
  done: "Checked",
  needs_teacher: "Needs a teacher",
  failed: "Failed",
};

export const PAPER_STATUS_STYLE: Record<PaperStatus, string> = {
  writing: "bg-sky-50 text-sky-700",
  reading: "bg-sky-50 text-sky-700",
  checking: "bg-sky-50 text-sky-700",
  done: "bg-emerald-50 text-emerald-700",
  needs_teacher: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-700",
};

export const paperRunning = (s: PaperStatus) => s === "writing" || s === "reading" || s === "checking";

export const isRunning = (c: Pick<CheckView, "status">) => c.status === "checking" || c.status === "writing";

export function fmtMarks(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** USD with the rough rupee amount: "$0.012 (≈ ₹1.0)". */
export function fmtCost(usd: number): string {
  if (!usd) return "—";
  return `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)} (≈ ₹${(usd * 85).toFixed(usd * 85 < 10 ? 1 : 0)})`;
}

export const LEVEL_LABEL: Record<PracticeLevel, string> = {
  strong: "Strong",
  average: "Average",
  weak: "Weak",
  ai_copied: "Copied from AI",
};

export const KIND_LABEL: Record<QuestionKind, string> = { short: "Short answer", long: "Long answer", numerical: "Numerical" };

export const STATUS_LABEL: Record<CheckView["status"], string> = {
  writing: "Writing practice answer…",
  checking: "Checking…",
  done: "Checked",
  needs_teacher: "Needs a teacher",
  failed: "Failed",
};

export const STATUS_STYLE: Record<CheckView["status"], string> = {
  writing: "bg-sky-50 text-sky-700",
  checking: "bg-sky-50 text-sky-700",
  done: "bg-emerald-50 text-emerald-700",
  needs_teacher: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-700",
};

export const AI_WRITTEN_LABEL: Record<string, string> = {
  likely_human: "Likely written by the student",
  possibly_ai: "Possibly AI-written",
  inconclusive: "Inconclusive",
};

export function scopeLabel(s: { board?: string | null; medium?: string | null; grade?: string | null; subject?: string | null; chapter?: string | null }): string {
  return [s.board, s.grade ? `Grade ${String(s.grade).replace(/^grade\s*/i, "")}` : null, s.medium ? `${s.medium} medium` : null, s.subject, s.chapter].filter(Boolean).join(" · ");
}

/**
 * Shrinks a photo in the browser before upload (at most 2000 px, JPEG): a phone photo of 4–8 MB
 * becomes ~0.5 MB, keeping handwriting sharp. HEIC can't be read by most browsers — JPG / PNG only.
 */
export async function photoToDataUrl(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error(`${file.name}: use a JPG or PNG photo.`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`${file.name} could not be opened.`));
      i.src = url;
    });
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}
