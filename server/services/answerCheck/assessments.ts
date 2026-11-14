import crypto from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { answerAssessments, answerMarkingSchemes, answerPapers, type AnswerAssessmentRow } from "@shared/schema";
import { accuracySummary, QUESTION_KINDS, type QuestionKind } from "@shared/answerCheck";
import { ANSWER_CHECK_MODEL, AnswerCheckAiError } from "./ai";
import { answerCheckAi, currentScheme, prepareQuestion, schemeView } from "./engine";
import { IMPORT_SYSTEM, parseImport, type ImportedPaper } from "./prompts";
import { createPaper, createPracticePaper, deletePaper, listPapers, paperView, PaperError } from "./papers";
import { docxText, isDocx, isImage, isPdf, pdfPages, pdfText, sheetPages, type IncomingFile } from "./files";
import { prepareUpload, toDataUrl } from "./images";
import type { QuestionInput } from "./questions";

/**
 * AI assessment — assessments (mock test papers). An assessment holds numbered questions, each
 * with marks, a model answer and its own answer key (drafted once by the AI from the model answer,
 * redrafted when the question, marks or model answer change). Students' answer sheets (photos or
 * a PDF) are checked against it as whole papers. Questions can be typed, imported from the
 * client's question paper / answer key (PDF, Word, photos or pasted text) or taken from the
 * synced curriculum.
 */

export const MAX_ASSESSMENT_QUESTIONS = 40;

export interface AssessmentQuestionDraft {
  number: string;
  questionText: string;
  maxMarks: number;
  modelAnswer: string;
  questionKind?: QuestionKind | null;
  /** Kept for a question already saved, or a curriculum question ("cms:…"). */
  questionKey?: string | null;
  chapter?: string | null;
}

export interface AssessmentDraft {
  title: string;
  mockTestId?: string | null;
  board?: string | null;
  medium?: string | null;
  grade?: string | null;
  subject?: string | null;
  questions: AssessmentQuestionDraft[];
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Checks a draft before anything is saved; the problems are shown to the admin as they are. */
export function draftProblems(d: AssessmentDraft): string[] {
  const problems: string[] = [];
  if (!clean(d.title, 120)) problems.push("Give the assessment a name.");
  if (!d.questions?.length) problems.push("Add at least one question.");
  if ((d.questions?.length ?? 0) > MAX_ASSESSMENT_QUESTIONS) problems.push(`An assessment can have at most ${MAX_ASSESSMENT_QUESTIONS} questions.`);
  const seen = new Set<string>();
  (d.questions ?? []).forEach((q, i) => {
    const label = `Question ${q.number || i + 1}`;
    const num = clean(q.number, 10).toLowerCase();
    if (!num) problems.push(`${label} needs a number.`);
    else if (seen.has(num)) problems.push(`Question number ${q.number} is used twice.`);
    seen.add(num);
    if (clean(q.questionText, 4000).length < 3) problems.push(`${label} needs its question.`);
    if (!(Number(q.maxMarks) >= 0.5 && Number(q.maxMarks) <= 100)) problems.push(`${label} needs marks between 0.5 and 100.`);
  });
  return problems;
}

export class AssessmentError extends Error {
  constructor(public problems: string[]) { super(problems.join(" ")); }
}

/** Runs `fn` over items, at most `limit` at a time. */
async function inBatches<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/**
 * Creates or updates an assessment. Each question's answer key is drafted by the AI (a few at a
 * time) when the question is new or its wording, marks or model answer changed; unchanged ones keep
 * their key (and any admin edits to it).
 */
export async function saveAssessment(businessAccountId: string, draft: AssessmentDraft, userId: string | null, id?: string): Promise<AnswerAssessmentRow> {
  const problems = draftProblems(draft);
  if (problems.length) throw new AssessmentError(problems);
  const meta = {
    title: clean(draft.title, 120),
    mockTestId: clean(draft.mockTestId, 60) || null,
    board: clean(draft.board, 60) || null,
    medium: clean(draft.medium, 40) || null,
    grade: clean(draft.grade, 20) || null,
    subject: clean(draft.subject, 80) || null,
  };
  let row: AnswerAssessmentRow;
  if (id) {
    const [found] = await db.select().from(answerAssessments).where(and(eq(answerAssessments.id, id), eq(answerAssessments.businessAccountId, businessAccountId)));
    if (!found) throw new AssessmentError(["Assessment not found."]);
    row = found;
  } else {
    [row] = await db.insert(answerAssessments).values({ businessAccountId, ...meta, questions: [], createdBy: userId }).returning();
  }
  const refs = await inBatches(draft.questions, 4, async q => {
    const given = clean(q.questionKey, 200);
    const key = given.startsWith("cms:") || given.startsWith(`asmt:${row.id}:`) ? given : `asmt:${row.id}:${crypto.randomUUID().slice(0, 8)}`;
    const input: QuestionInput = {
      questionKey: key,
      source: key.startsWith("cms:") ? "cms" : "assessment",
      questionText: clean(q.questionText, 4000),
      modelAnswer: clean(q.modelAnswer, 10000),
      questionKind: QUESTION_KINDS.includes(q.questionKind as QuestionKind) ? (q.questionKind as QuestionKind) : null,
      board: meta.board, medium: meta.medium, grade: meta.grade, subject: meta.subject,
      chapter: clean(q.chapter, 200) || null,
      maxMarks: Math.round(Number(q.maxMarks) * 2) / 2,
    };
    try {
      await prepareQuestion(businessAccountId, input, userId, { redraftIfChanged: true });
    } catch (err: any) {
      throw new AssessmentError([`Question ${q.number}: ${err?.message || "the AI could not write its answer key"}`]);
    }
    return { number: clean(q.number, 10), questionKey: key };
  });
  const [saved] = await db.update(answerAssessments).set({ ...meta, questions: refs as any, updatedAt: new Date() })
    .where(eq(answerAssessments.id, row.id)).returning();
  return saved;
}

export async function getAssessment(businessAccountId: string, id: string): Promise<AnswerAssessmentRow | null> {
  const [row] = await db.select().from(answerAssessments).where(and(eq(answerAssessments.id, id), eq(answerAssessments.businessAccountId, businessAccountId)));
  return row ?? null;
}

type Ref = { number: string; questionKey: string };

/** The assessment with each question's current answer key, its students' sheets and accuracy. */
export async function assessmentView(row: AnswerAssessmentRow) {
  const refs = row.questions as unknown as Ref[];
  const questions = await Promise.all(refs.map(async r => {
    const s = await currentScheme(row.businessAccountId, r.questionKey);
    return { number: r.number, questionKey: r.questionKey, scheme: s ? schemeView(s) : null };
  }));
  const sheets = await listPapers(row.businessAccountId, { assessmentId: row.id });
  const finished = sheets.filter(s => s.totals.aiMarks !== null);
  const avg = finished.length ? Math.round((finished.reduce((a, s) => a + (s.totals.aiMarks as number), 0) / finished.length) * 10) / 10 : null;
  // Accuracy per answer, where a teacher gave marks.
  const paperIds = sheets.map(s => s.id);
  const answers = paperIds.length ? (await Promise.all(sheets.map(async s => {
    const [p] = await db.select().from(answerPapers).where(eq(answerPapers.id, s.id));
    return p ? (await paperView(p)).checks : [];
  }))).flat() : [];
  const teacher = accuracySummary(answers.filter(a => a.aiMarks !== null).map(a => ({ aiMarks: a.aiMarks, maxMarks: a.maxMarks, compareMarks: a.teacherMarks })));
  const expected = accuracySummary(answers.filter(a => a.aiMarks !== null).map(a => ({ aiMarks: a.aiMarks, maxMarks: a.maxMarks, compareMarks: a.expectedMarks })));
  return {
    id: row.id,
    title: row.title,
    mockTestId: row.mockTestId,
    board: row.board, medium: row.medium, grade: row.grade, subject: row.subject,
    questions,
    totalMarks: questions.reduce((a, q) => a + (q.scheme?.maxMarks ?? 0), 0),
    sheets,
    stats: {
      checked: finished.length,
      averageMarks: avg,
      humanIntervention: sheets.filter(s => s.status === "needs_teacher").length,
      teacher,
      expected,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listAssessments(businessAccountId: string) {
  const rows = await db.select().from(answerAssessments).where(eq(answerAssessments.businessAccountId, businessAccountId)).orderBy(desc(answerAssessments.updatedAt));
  const counts = rows.length
    ? await db.select({ assessmentId: answerPapers.assessmentId, createdAt: answerPapers.createdAt }).from(answerPapers).where(inArray(answerPapers.assessmentId, rows.map(r => r.id)))
    : [];
  const keys = rows.flatMap(r => (r.questions as unknown as Ref[]).map(q => q.questionKey));
  const schemes = keys.length
    ? await db.select({ questionKey: answerMarkingSchemes.questionKey, version: answerMarkingSchemes.version, maxMarks: answerMarkingSchemes.maxMarks }).from(answerMarkingSchemes)
      .where(and(eq(answerMarkingSchemes.businessAccountId, businessAccountId), inArray(answerMarkingSchemes.questionKey, keys)))
    : [];
  const marksOf = (key: string) => {
    const versions = schemes.filter(s => s.questionKey === key).sort((a, b) => b.version - a.version);
    return versions.length ? Number(versions[0].maxMarks) : 0;
  };
  return rows.map(r => {
    const refs = r.questions as unknown as Ref[];
    const mine = counts.filter(c => c.assessmentId === r.id);
    return {
      id: r.id,
      title: r.title,
      mockTestId: r.mockTestId,
      board: r.board, medium: r.medium, grade: r.grade, subject: r.subject,
      questionCount: refs.length,
      totalMarks: refs.reduce((a, q) => a + marksOf(q.questionKey), 0),
      sheetCount: mine.length,
      lastSheetAt: mine.reduce<Date | null>((a, c) => (!a || c.createdAt > a ? c.createdAt : a), null),
      updatedAt: r.updatedAt,
    };
  });
}

export async function deleteAssessment(businessAccountId: string, id: string): Promise<boolean> {
  const row = await getAssessment(businessAccountId, id);
  if (!row) return false;
  const sheets = await db.select({ id: answerPapers.id }).from(answerPapers).where(eq(answerPapers.assessmentId, id));
  for (const s of sheets) await deletePaper(businessAccountId, s.id);
  await db.delete(answerAssessments).where(eq(answerAssessments.id, id));
  return true;
}

// ---- Students' answer sheets ------------------------------------------------------------------

export async function checkSheet(opts: { businessAccountId: string; assessment: AnswerAssessmentRow; files: IncomingFile[]; studentName: string; rollNo: string; userId: string | null }) {
  const refs = opts.assessment.questions as unknown as Ref[];
  if (!refs.length) throw new PaperError("This assessment has no questions yet.");
  const { pages, hashes, duplicatesDropped } = await sheetPages(opts.files);
  // The same page already uploaded for another student of this assessment.
  const earlier = await db.select({ studentLabel: answerPapers.studentLabel, pageHashes: answerPapers.pageHashes }).from(answerPapers).where(eq(answerPapers.assessmentId, opts.assessment.id));
  const reused = earlier.filter(e => (e.pageHashes || []).some(h => hashes.includes(h))).map(e => e.studentLabel || "another student");
  const paper = await createPaper({
    businessAccountId: opts.businessAccountId,
    title: opts.assessment.title,
    studentLabel: opts.studentName.trim().slice(0, 80) || "Student",
    rollNo: opts.rollNo,
    assessmentId: opts.assessment.id,
    questions: refs,
    photos: pages,
    pageHashes: hashes,
    userId: opts.userId,
  });
  const warnings: string[] = [];
  if (duplicatesDropped) warnings.push(`${duplicatesDropped} page${duplicatesDropped === 1 ? " was" : "s were"} uploaded twice; each page is checked once.`);
  if (reused.length) warnings.push(`Some pages are the same as the sheet already uploaded for ${Array.from(new Set(reused)).join(", ")}.`);
  return { paper, pages: pages.length, warnings };
}

export async function sampleSheet(businessAccountId: string, assessment: AnswerAssessmentRow, userId: string | null) {
  const refs = assessment.questions as unknown as Ref[];
  if (!refs.length) throw new PaperError("This assessment has no questions yet.");
  return createPracticePaper({ businessAccountId, title: assessment.title, studentLabel: "Sample student", questions: refs, userId, assessmentId: assessment.id });
}

// ---- Importing the client's question paper / answer key ---------------------------------------

/**
 * Reads a question paper (with answers when given) into questions for the admin to review — nothing
 * is saved. Typed PDFs and Word files are read as text; scanned PDFs and photos are read by GPT-4.1.
 */
export async function importQuestions(businessAccountId: string, input: { text?: string; files: IncomingFile[] }): Promise<ImportedPaper & { costUsd: number }> {
  const ai = await answerCheckAi(businessAccountId);
  let text = (input.text || "").trim();
  const images: Buffer[] = [];
  for (const f of input.files) {
    if (isDocx(f)) text += `\n\n${await docxText(f)}`;
    else if (isPdf(f)) {
      const t = await pdfText(f);
      if (t.replace(/\s/g, "").length > 200) text += `\n\n${t}`;
      else images.push(...await pdfPages(f, 10));
    } else if (isImage(f)) images.push(await prepareUpload(f.data));
    else if (/^text\//.test(f.mime)) text += `\n\n${f.data.toString("utf8")}`;
    else throw new AnswerCheckAiError(`${f.name}: use a PDF, a Word file (.docx), photos or paste the text.`);
  }
  if (!text && !images.length) throw new AnswerCheckAiError("Paste the questions or add the question paper.");
  if (images.length > 10) images.splice(10);
  const reply = await ai.json({
    model: ANSWER_CHECK_MODEL,
    system: IMPORT_SYSTEM,
    user: text ? `The question paper${images.length ? " (text, then photos)" : ""}:\n"""\n${text.slice(0, 60000)}\n"""` : "The question paper is in the photos.",
    images: images.map(b => toDataUrl(b)),
    maxTokens: 12000,
    timeoutMs: 180_000,
  });
  const paper = parseImport(reply);
  if (!paper.questions.length) throw new AnswerCheckAiError("No questions were found in it. Check the file, or paste the questions.");
  return { ...paper, costUsd: ai.costUsd() };
}
