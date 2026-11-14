import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { answerCheckImages, answerChecks, answerMarkingSchemes, answerPapers, type AnswerMarkingSchemeRow, type AnswerPaperRow } from "@shared/schema";
import { applyJudgement, type PracticeLevel } from "@shared/answerCheck";
import { ANSWER_CHECK_MODEL, AnswerCheckAiError, type AnswerCheckAi } from "./ai";
import {
  assembleAnswers,
  matchUserText,
  unplacedAnswerParts,
  MATCH_SYSTEM,
  parsePaperRead,
  parsePractice,
  practiceSystem,
  practiceUserText,
  READ_PAPER_SYSTEM,
  readPaperUserText,
  type PaperQuestion,
} from "./prompts";
import { checkView, contextOf, currentScheme, enqueue, answerCheckAi, runCheck, schemeOf, STALE_AFTER_MS } from "./engine";
import { deletePaperFiles, imageBytes, listPaperImages, saveImage, toDataUrl } from "./images";
import { renderPracticeSheet } from "./drawing";

/**
 * Answer checking pilot — whole answer sheets. A paper is a list of numbered questions (each with
 * its own saved marking scheme). The student's pages are read in one go into parts with the
 * student's own labels ("Q3", "Ans 2") — still without showing the questions, so mistakes are
 * copied as written — then a text-only step matches the parts to the questions (out of order,
 * continued on the next page, not attempted). Each question's answer becomes a normal check,
 * marked exactly like a single answer. Practice sheets: the AI writes one student's whole sheet
 * at mixed levels, out of order and with a question skipped, to test the matching.
 */

export interface PaperQuestionRef {
  number: string;
  questionKey: string;
}

export const MAX_PAPER_QUESTIONS = 20;

export class PaperError extends Error {}

const n = (v: unknown): number => (v === null || v === undefined || v === "" ? 0 : Number(v));

async function schemesFor(businessAccountId: string, questions: PaperQuestionRef[]): Promise<Map<string, AnswerMarkingSchemeRow>> {
  const map = new Map<string, AnswerMarkingSchemeRow>();
  for (const q of questions) {
    const s = await currentScheme(businessAccountId, q.questionKey);
    if (!s) throw new PaperError(`Question ${q.number} has no answer key yet.`);
    map.set(q.questionKey, s);
  }
  return map;
}

/** Cleans the paper's question list: 1–20 questions, numbers unique, keys present. */
export function cleanQuestionList(raw: unknown): PaperQuestionRef[] {
  const list = (Array.isArray(raw) ? raw : [])
    .map((q: any, i: number) => ({
      number: String(q?.number ?? i + 1).trim().replace(/^(q|question)\.?\s*/i, "").slice(0, 10) || String(i + 1),
      questionKey: String(q?.questionKey || "").trim(),
    }))
    .filter(q => q.questionKey);
  if (!list.length) throw new PaperError("Add at least one question to the paper.");
  if (list.length > MAX_PAPER_QUESTIONS) throw new PaperError(`A paper can have at most ${MAX_PAPER_QUESTIONS} questions.`);
  const seen = new Set<string>();
  for (const q of list) {
    const k = q.number.toLowerCase();
    if (seen.has(k)) throw new PaperError(`Question number ${q.number} is used twice.`);
    seen.add(k);
  }
  return list;
}

export async function createPaper(opts: { businessAccountId: string; title: string; studentLabel: string; questions: PaperQuestionRef[]; photos: Buffer[]; userId: string | null }): Promise<AnswerPaperRow> {
  await schemesFor(opts.businessAccountId, opts.questions);
  const [paper] = await db.insert(answerPapers).values({
    businessAccountId: opts.businessAccountId,
    title: opts.title.slice(0, 120),
    studentLabel: opts.studentLabel.slice(0, 80),
    status: "reading",
    source: "upload",
    questions: opts.questions as any,
    createdBy: opts.userId,
  }).returning();
  for (let i = 0; i < opts.photos.length; i++) {
    await saveImage({ paperId: paper.id, businessAccountId: opts.businessAccountId, kind: "paper_page", position: i, data: opts.photos[i] });
  }
  enqueue(() => runPaper(paper.id));
  return paper;
}

// ---- Practice answer sheets -------------------------------------------------------------------

const LEVEL_CYCLE: PracticeLevel[] = ["strong", "average", "weak"];
const LABEL_STYLES = [(n: string) => `Q${n}.`, (n: string) => `Ans ${n})`, (n: string) => `${n}.`, (n: string) => `Q.${n}`];

export interface PracticePlanItem {
  number: string;
  level: PracticeLevel | "skip";
}

/**
 * What the practice student does: levels cycle strong → average → weak; with 4+ questions the last
 * one is skipped; with 3+ answered, the first two are written in swapped order.
 */
export function practicePlan(numbers: string[]): { plan: PracticePlanItem[]; writtenOrder: string[] } {
  const plan = numbers.map((number, i) => ({ number, level: (numbers.length >= 4 && i === numbers.length - 1 ? "skip" : LEVEL_CYCLE[i % 3]) as PracticePlanItem["level"] }));
  const answered = plan.filter(p => p.level !== "skip").map(p => p.number);
  const writtenOrder = answered.length >= 3 ? [answered[1], answered[0], ...answered.slice(2)] : answered;
  return { plan, writtenOrder };
}

export async function createPracticePaper(opts: { businessAccountId: string; title: string; studentLabel: string; questions: PaperQuestionRef[]; userId: string | null }): Promise<AnswerPaperRow> {
  await schemesFor(opts.businessAccountId, opts.questions);
  const [paper] = await db.insert(answerPapers).values({
    businessAccountId: opts.businessAccountId,
    title: opts.title.slice(0, 120),
    studentLabel: (opts.studentLabel || "Practice student").slice(0, 80),
    status: "writing",
    source: "practice",
    questions: opts.questions as any,
    createdBy: opts.userId,
  }).returning();
  enqueue(() => writePracticePaper(paper.id));
  return paper;
}

async function writePracticePaper(paperId: string): Promise<void> {
  const started = Date.now();
  const [paper] = await db.select().from(answerPapers).where(eq(answerPapers.id, paperId));
  if (!paper) return;
  let ai: AnswerCheckAi | null = null;
  try {
    ai = await answerCheckAi(paper.businessAccountId);
    const questions = paper.questions as unknown as PaperQuestionRef[];
    const schemes = await schemesFor(paper.businessAccountId, questions);
    const { plan, writtenOrder } = practicePlan(questions.map(q => q.number));
    const written = await Promise.all(plan.map(async (p, i) => {
      const q = questions[i];
      const scheme = schemes.get(q.questionKey)!;
      if (p.level === "skip") return { number: p.number, level: "skip" as const, text: "", expectedMarks: 0, why: "Not attempted on purpose", maxMarks: n(scheme.maxMarks) };
      const reply = await ai!.json({ model: ANSWER_CHECK_MODEL, system: practiceSystem(), user: practiceUserText(contextOf(scheme), schemeOf(scheme), [p.level]), maxTokens: 2000, temperature: 0.7 });
      const [answer] = parsePractice(reply, [p.level]);
      if (!answer) throw new AnswerCheckAiError(`The AI did not write a practice answer for question ${p.number}. Try again.`);
      const expected = applyJudgement(schemeOf(scheme), n(scheme.maxMarks), answer.expectedSteps);
      return { number: p.number, level: p.level, text: answer.text, expectedMarks: expected.total, why: answer.why, maxMarks: n(scheme.maxMarks) };
    }));
    const sheet = writtenOrder.map((num, i) => {
      const w = written.find(x => x.number === num)!;
      return `${LABEL_STYLES[i % LABEL_STYLES.length](num)}\n${w.text}`;
    }).join("\n\n");
    const pages = await renderPracticeSheet({ text: sheet, studentLabel: `Name: ${paper.studentLabel}`, questionLabel: paper.title || "Mock test", seed: paper.id, maxPages: 8 });
    for (let i = 0; i < pages.length; i++) await saveImage({ paperId, businessAccountId: paper.businessAccountId, kind: "paper_page", position: i, data: pages[i] });
    await db.update(answerPapers).set({
      status: "reading",
      practice: { answers: written, writtenOrder, sheet } as any,
      costUsd: String(ai.costUsd()),
      durationMs: Date.now() - started,
      updatedAt: new Date(),
    }).where(eq(answerPapers.id, paperId));
    enqueue(() => runPaper(paperId));
  } catch (err: any) {
    const message = err instanceof AnswerCheckAiError || err instanceof PaperError ? err.message : `Could not write the practice answer sheet: ${err?.message || err}`;
    await db.update(answerPapers).set({ status: "failed", error: message, costUsd: String(ai?.costUsd() ?? 0), updatedAt: new Date() }).where(eq(answerPapers.id, paperId));
  }
}

// ---- Reading and matching a sheet -------------------------------------------------------------

export async function runPaper(paperId: string): Promise<void> {
  const started = Date.now();
  const [paper] = await db.select().from(answerPapers).where(eq(answerPapers.id, paperId));
  if (!paper) return;
  const priorCost = n(paper.costUsd);
  let ai: AnswerCheckAi | null = null;
  const fail = async (message: string) => {
    await db.update(answerPapers).set({ status: "failed", error: message, costUsd: String(priorCost + (ai?.costUsd() ?? 0)), durationMs: Date.now() - started, updatedAt: new Date() }).where(eq(answerPapers.id, paperId));
  };
  try {
    ai = await answerCheckAi(paper.businessAccountId);
    const questions = paper.questions as unknown as PaperQuestionRef[];
    const schemes = await schemesFor(paper.businessAccountId, questions);
    const pageRows = await listPaperImages(paperId);
    const pageBytes = (await Promise.all(pageRows.map(p => imageBytes(p)))).filter((b): b is Buffer => !!b);
    if (!pageBytes.length) return fail("The answer sheet's pages are missing.");
    const first = schemes.get(questions[0].questionKey)!;

    // 1. Read the whole sheet into parts (the questions are not shown).
    const readReply = await ai.json({ model: ANSWER_CHECK_MODEL, system: READ_PAPER_SYSTEM, user: readPaperUserText(contextOf(first), pageBytes.length), images: pageBytes.map(b => toDataUrl(b)), maxTokens: 8000, timeoutMs: 180_000 });
    if (!readReply) return fail("The AI could not read the answer sheet. Try again.");
    const read = parsePaperRead(readReply, pageBytes.length);

    // 2. Match the parts to the questions.
    const paperQuestions: PaperQuestion[] = questions.map(q => ({ number: q.number, maxMarks: n(schemes.get(q.questionKey)!.maxMarks), questionText: schemes.get(q.questionKey)!.questionText }));
    let matchReply: Record<string, any> | null = { answers: [] };
    if (read.parts.length) {
      matchReply = await ai.json({ model: ANSWER_CHECK_MODEL, system: MATCH_SYSTEM, user: matchUserText(paperQuestions, read.parts), maxTokens: 2000 });
      if (!matchReply) return fail("The AI could not match the sheet to the questions. Try again.");
    }
    const matching = assembleAnswers(paperQuestions, read.parts, matchReply);
    // Answer-like parts no question claimed: a "not attempted" may really be one of them.
    const unplaced = unplacedAnswerParts(matching).length > 0;

    // 3. One check per question (a re-read replaces the earlier ones).
    await db.delete(answerChecks).where(eq(answerChecks.paperId, paperId));
    const practice = (paper.practice as any)?.answers as Array<{ number: string; level: string; text: string; expectedMarks: number; why: string }> | undefined;
    const created: string[] = [];
    for (const a of matching.answers) {
      const q = questions.find(x => x.number === a.number)!;
      const scheme = schemes.get(q.questionKey)!;
      const p = practice?.find(x => x.number === a.number);
      const [row] = await db.insert(answerChecks).values({
        businessAccountId: paper.businessAccountId,
        schemeId: scheme.id,
        questionKey: scheme.questionKey,
        paperId,
        questionNumber: a.number,
        status: "checking",
        source: paper.source === "practice" ? "practice" : "upload",
        practiceLevel: p && p.level !== "skip" ? p.level : null,
        practiceText: p ? (p.text || "(not attempted)") : null,
        expectedMarks: p ? String(p.expectedMarks) : null,
        result: p?.why ? ({ practiceWhy: p.why } as any) : null,
        studentLabel: `${paper.studentLabel || paper.title || "Paper"} · Q${a.number}`.slice(0, 80),
        maxMarks: scheme.maxMarks,
        readText: a.text,
        reading: {
          legibility: a.notAttempted ? 1 : a.legibility,
          unclear: a.unclear,
          blank: !a.text,
          notes: a.note,
          pages: a.pages,
          parts: a.parts,
          matchConfidence: a.confidence,
          matchNote: a.note,
          notAttempted: a.notAttempted,
          unplacedOnSheet: a.notAttempted && unplaced,
        } as any,
        createdBy: paper.createdBy,
      }).returning();
      created.push(row.id);
    }
    await db.update(answerPapers).set({
      status: "checked",
      reading: { parts: read.parts, blank: read.blank, notes: read.notes, pages: pageBytes.length } as any,
      matching: matching as any,
      costUsd: String(priorCost + ai.costUsd()),
      durationMs: Date.now() - started,
      error: null,
      updatedAt: new Date(),
    }).where(eq(answerPapers.id, paperId));
    for (const id of created) enqueue(() => runCheck(id));
  } catch (err: any) {
    const message = err instanceof AnswerCheckAiError || err instanceof PaperError ? err.message
      : err?.status === 401 ? "The account's OpenAI key was refused."
      : err?.status === 429 ? "OpenAI is busy or the account's limit was reached. Try again in a minute."
      : `Reading the answer sheet failed: ${err?.message || err}`;
    await fail(message);
  }
}

/** Reads the sheet again from scratch: earlier results for this paper (teacher marks too) are replaced. */
export async function rerunPaper(businessAccountId: string, paperId: string): Promise<AnswerPaperRow | null> {
  const [paper] = await db.select().from(answerPapers).where(and(eq(answerPapers.id, paperId), eq(answerPapers.businessAccountId, businessAccountId)));
  if (!paper) return null;
  const status = paperStatus(paper, []);
  if (status === "reading" || status === "writing") return paper;
  if (paper.source === "practice" && !paper.practice) {
    const [row] = await db.update(answerPapers).set({ status: "writing", error: null, updatedAt: new Date() }).where(eq(answerPapers.id, paperId)).returning();
    enqueue(() => writePracticePaper(paperId));
    return row;
  }
  const [row] = await db.update(answerPapers).set({ status: "reading", error: null, updatedAt: new Date() }).where(eq(answerPapers.id, paperId)).returning();
  enqueue(() => runPaper(paperId));
  return row;
}

export async function deletePaper(businessAccountId: string, paperId: string): Promise<boolean> {
  const [paper] = await db.select({ id: answerPapers.id }).from(answerPapers).where(and(eq(answerPapers.id, paperId), eq(answerPapers.businessAccountId, businessAccountId)));
  if (!paper) return false;
  await deletePaperFiles(paperId);
  await db.delete(answerPapers).where(eq(answerPapers.id, paperId));
  return true;
}

// ---- Reading papers for the screens -----------------------------------------------------------

export function paperStatus(paper: Pick<AnswerPaperRow, "status" | "updatedAt">, checks: Array<{ status: string }>, now = Date.now()): string {
  if ((paper.status === "reading" || paper.status === "writing") && now - new Date(paper.updatedAt).getTime() > STALE_AFTER_MS) return "failed";
  if (paper.status !== "checked") return paper.status;
  if (checks.some(c => c.status === "checking" || c.status === "writing")) return "checking";
  return checks.some(c => c.status === "needs_teacher" || c.status === "failed") ? "needs_teacher" : "done";
}

export interface PaperTotals {
  maxMarks: number;
  aiMarks: number | null;
  teacherMarks: number | null;
  expectedMarks: number | null;
  answered: number;
  notAttempted: number;
  needsTeacher: number;
}

/** Paper totals; AI total only once every answer is marked; teacher total counts the AI's marks where no teacher marks were given. */
export function paperTotals(checks: Array<{ maxMarks: number; aiMarks: number | null; teacherMarks: number | null; expectedMarks: number | null; status: string; reading?: any }>): PaperTotals {
  const sum = (xs: number[]) => Math.round(xs.reduce((a, x) => a + x, 0) * 10) / 10;
  const allMarked = checks.length > 0 && checks.every(c => c.aiMarks !== null);
  const anyTeacher = checks.some(c => c.teacherMarks !== null);
  const allExpected = checks.length > 0 && checks.every(c => c.expectedMarks !== null);
  return {
    maxMarks: sum(checks.map(c => c.maxMarks)),
    aiMarks: allMarked ? sum(checks.map(c => c.aiMarks as number)) : null,
    teacherMarks: anyTeacher && allMarked ? sum(checks.map(c => (c.teacherMarks ?? c.aiMarks) as number)) : null,
    expectedMarks: allExpected ? sum(checks.map(c => c.expectedMarks as number)) : null,
    answered: checks.filter(c => !c.reading?.notAttempted).length,
    notAttempted: checks.filter(c => c.reading?.notAttempted).length,
    needsTeacher: checks.filter(c => c.status === "needs_teacher").length,
  };
}

export async function paperView(paper: AnswerPaperRow) {
  const rows = await db.select().from(answerChecks).where(eq(answerChecks.paperId, paper.id));
  const schemeIds = Array.from(new Set(rows.map(r => r.schemeId).filter((x): x is string => !!x)));
  const schemes = schemeIds.length ? await db.select().from(answerMarkingSchemes).where(inArray(answerMarkingSchemes.id, schemeIds)) : [];
  const images = rows.length
    ? await db.select({ id: answerCheckImages.id, checkId: answerCheckImages.checkId, kind: answerCheckImages.kind, position: answerCheckImages.position }).from(answerCheckImages).where(inArray(answerCheckImages.checkId, rows.map(r => r.id)))
    : [];
  const pages = await db.select({ id: answerCheckImages.id, position: answerCheckImages.position }).from(answerCheckImages)
    .where(and(eq(answerCheckImages.paperId, paper.id), eq(answerCheckImages.kind, "paper_page")));
  const questions = paper.questions as unknown as PaperQuestionRef[];
  const order = (num: string | null) => questions.findIndex(q => q.number === num);
  const checks = rows
    .map(r => checkView(r, schemes.find(s => s.id === r.schemeId) ?? null, images.filter(i => i.checkId === r.id).map(i => ({ id: i.id, kind: i.kind, position: i.position }))))
    .sort((a, b) => order(a.questionNumber) - order(b.questionNumber));
  return {
    id: paper.id,
    title: paper.title,
    studentLabel: paper.studentLabel,
    source: paper.source,
    status: paperStatus(paper, checks),
    questions,
    pages: pages.sort((a, b) => a.position - b.position).map(p => ({ id: p.id, position: p.position })),
    reading: paper.reading,
    matching: paper.matching,
    practice: paper.practice,
    totals: paperTotals(checks),
    checks,
    costUsd: n(paper.costUsd) + checks.reduce((a, c) => a + c.costUsd, 0),
    durationMs: paper.durationMs,
    error: paper.error || (paperStatus(paper, checks) === "failed" && paper.status !== "failed" ? "Reading this sheet was interrupted (for example by a server restart). Try again." : null),
    createdAt: paper.createdAt,
    updatedAt: paper.updatedAt,
  };
}

export async function listPapers(businessAccountId: string, limit = 100) {
  const papers = await db.select().from(answerPapers).where(eq(answerPapers.businessAccountId, businessAccountId)).orderBy(desc(answerPapers.createdAt)).limit(limit);
  return Promise.all(papers.map(async p => {
    const v = await paperView(p);
    return { id: v.id, title: v.title, studentLabel: v.studentLabel, source: v.source, status: v.status, questionCount: v.questions.length, pageCount: v.pages.length, totals: v.totals, costUsd: v.costUsd, createdAt: v.createdAt };
  }));
}

