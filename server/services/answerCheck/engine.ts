import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  answerCheckSettings,
  answerChecks,
  businessAccounts,
  answerMarkingSchemes,
  type AnswerCheckRow,
  type AnswerMarkingSchemeRow,
} from "@shared/schema";
import {
  aiWrittenStatus,
  applyJudgement,
  normalizeScheme,
  resolveAnswerCheckSettings,
  schemeProblems,
  subjectKindOf,
  teacherReasons,
  wordCount,
  type AnswerCheckSettings,
  type MarkingScheme,
  type PracticeLevel,
  type QuestionKind,
} from "@shared/answerCheck";
import { ANSWER_CHECK_MINI_MODEL, ANSWER_CHECK_MODEL, AnswerCheckAiError, createAnswerCheckAi, type AnswerCheckAi } from "./ai";
import {
  AI_WRITTEN_SYSTEM,
  aiWrittenUserText,
  markSystem,
  markUserText,
  parseAiWritten,
  parseMark,
  parsePractice,
  parseRead,
  parseSchemeDraft,
  practiceSystem,
  practiceUserText,
  READ_SYSTEM,
  readUserText,
  schemeSystem,
  schemeUserText,
  type QuestionContext,
} from "./prompts";
import { imageBytes, listImages, listPaperImages, replaceMarkedImage, saveImage, toDataUrl } from "./images";
import { renderMarkedSheet, renderPracticeSheet } from "./drawing";
import type { QuestionInput } from "./questions";

/**
 * Answer checking pilot — one check from photos to marks:
 *   read the handwriting (GPT-4.1, photos attached) → mark against the question's saved scheme
 *   (GPT-4.1) → final marks by the shared rules → AI-written estimate (GPT-4.1 mini) → decide if
 *   a teacher must look → draw the marked sheet → save, with time taken and cost.
 * Checks run in the background, a few at a time; the screen polls. A re-check keeps the reading
 * and marks again with the question's current scheme; the earlier result goes into `history`.
 */

/** Tests swap the AI for a stand-in. */
let aiFactory: (businessAccountId: string) => Promise<AnswerCheckAi> = createAnswerCheckAi;
export function setAnswerCheckAiFactoryForTests(f: ((businessAccountId: string) => Promise<AnswerCheckAi>) | null) {
  aiFactory = f || createAnswerCheckAi;
}

/** The AI client for an account (a stand-in in tests). */
export function answerCheckAi(businessAccountId: string): Promise<AnswerCheckAi> {
  return aiFactory(businessAccountId);
}

const n = (v: unknown): number => (v === null || v === undefined || v === "" ? 0 : Number(v));
const nOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

// ---- Settings ---------------------------------------------------------------------------------

export async function getSettings(businessAccountId: string): Promise<AnswerCheckSettings> {
  const [row] = await db.select().from(answerCheckSettings).where(eq(answerCheckSettings.businessAccountId, businessAccountId));
  return resolveAnswerCheckSettings(row?.settings);
}

export async function saveSettings(businessAccountId: string, raw: unknown, userId: string | null): Promise<AnswerCheckSettings> {
  const settings = resolveAnswerCheckSettings(raw);
  await db.insert(answerCheckSettings)
    .values({ businessAccountId, settings: settings as any, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: answerCheckSettings.businessAccountId, set: { settings: settings as any, updatedBy: userId, updatedAt: new Date() } });
  return settings;
}

/**
 * AI assessment is an account feature (Settings › Features, super admins): off by default, so
 * nothing is checked and no AI is paid for until it is switched on.
 */
export async function assessmentEnabled(businessAccountId: string): Promise<boolean> {
  const [row] = await db.select({ on: businessAccounts.answerCheckingEnabled }).from(businessAccounts).where(eq(businessAccounts.id, businessAccountId));
  return row?.on === "true";
}

// ---- Marking schemes --------------------------------------------------------------------------

export async function currentScheme(businessAccountId: string, questionKey: string): Promise<AnswerMarkingSchemeRow | null> {
  const [row] = await db.select().from(answerMarkingSchemes)
    .where(and(eq(answerMarkingSchemes.businessAccountId, businessAccountId), eq(answerMarkingSchemes.questionKey, questionKey)))
    .orderBy(desc(answerMarkingSchemes.version)).limit(1);
  return row ?? null;
}

export async function schemeVersions(businessAccountId: string, questionKey: string): Promise<AnswerMarkingSchemeRow[]> {
  return db.select().from(answerMarkingSchemes)
    .where(and(eq(answerMarkingSchemes.businessAccountId, businessAccountId), eq(answerMarkingSchemes.questionKey, questionKey)))
    .orderBy(desc(answerMarkingSchemes.version));
}

export function contextOf(row: Pick<AnswerMarkingSchemeRow, "questionText" | "modelAnswer" | "maxMarks" | "subject" | "board" | "grade" | "medium" | "chapter" | "questionKind">): QuestionContext {
  return {
    questionText: row.questionText,
    modelAnswer: row.modelAnswer,
    maxMarks: n(row.maxMarks),
    subject: row.subject,
    subjectKind: subjectKindOf(row.subject),
    board: row.board,
    grade: row.grade,
    medium: row.medium,
    chapter: row.chapter,
    questionKind: (row.questionKind as QuestionKind | null) ?? null,
  };
}

export function schemeOf(row: Pick<AnswerMarkingSchemeRow, "scheme" | "maxMarks">): MarkingScheme {
  return normalizeScheme(row.scheme, n(row.maxMarks));
}

/**
 * The question's current scheme, drafted by the AI when the question is new or its maximum
 * marks changed (a new version — earlier checks keep the version they were marked with).
 */
export async function prepareQuestion(businessAccountId: string, q: QuestionInput, userId: string | null): Promise<AnswerMarkingSchemeRow> {
  const existing = await currentScheme(businessAccountId, q.questionKey);
  if (existing && n(existing.maxMarks) === q.maxMarks) return existing;
  const settings = await getSettings(businessAccountId);
  const ctx: QuestionContext = {
    questionText: q.questionText, modelAnswer: q.modelAnswer, maxMarks: q.maxMarks, subject: q.subject, subjectKind: subjectKindOf(q.subject),
    board: q.board, grade: q.grade, medium: q.medium, chapter: q.chapter, questionKind: q.questionKind,
  };
  const ai = await aiFactory(businessAccountId);
  const reply = await ai.json({ model: ANSWER_CHECK_MODEL, system: schemeSystem(), user: schemeUserText(ctx, settings.subjectRules[ctx.subjectKind]), maxTokens: 2500 });
  if (!reply) throw new AnswerCheckAiError("The AI could not write a marking scheme for this question. Try again.");
  const draft = parseSchemeDraft(reply);
  const scheme = normalizeScheme(draft.raw, q.maxMarks);
  const modelAnswerByAi = !q.modelAnswer.trim() && !!draft.modelAnswer;
  const [row] = await db.insert(answerMarkingSchemes).values({
    businessAccountId,
    questionKey: q.questionKey,
    version: (existing?.version ?? 0) + 1,
    source: q.source,
    questionText: q.questionText,
    modelAnswer: q.modelAnswer.trim() || draft.modelAnswer,
    modelAnswerByAi,
    questionKind: q.questionKind || draft.questionKind,
    board: q.board, medium: q.medium, grade: q.grade, subject: q.subject, chapter: q.chapter,
    maxMarks: String(q.maxMarks),
    scheme: scheme as any,
    status: "ai_draft",
    createdBy: userId,
  }).returning();
  return row;
}

export class SchemeEditError extends Error {
  constructor(public problems: string[]) { super(problems.join(" ")); }
}

/** An admin's edit becomes a new, approved version; checks already done keep their version. */
export async function saveSchemeEdit(businessAccountId: string, questionKey: string, edit: { scheme: unknown; maxMarks?: number; modelAnswer?: string }, userId: string | null): Promise<AnswerMarkingSchemeRow> {
  const current = await currentScheme(businessAccountId, questionKey);
  if (!current) throw new SchemeEditError(["This question has no marking scheme yet."]);
  const maxMarks = edit.maxMarks !== undefined ? Number(edit.maxMarks) : n(current.maxMarks);
  if (!Number.isFinite(maxMarks) || maxMarks <= 0 || maxMarks > 100) throw new SchemeEditError(["Maximum marks must be between 0.5 and 100."]);
  // Check exactly what the admin typed before any clean-up, so nothing changes silently.
  const raw = (edit.scheme && typeof edit.scheme === "object" ? edit.scheme : {}) as Record<string, any>;
  const typed: MarkingScheme = {
    steps: (Array.isArray(raw.steps) ? raw.steps : []).map((s: any, i: number) => ({ id: String(s?.id || `s${i + 1}`), label: String(s?.label || ""), marks: Number(s?.marks) || 0 })),
    mustKeywords: [], niceKeywords: [], alternatives: [],
    finalAnswerOnlyMarks: raw.finalAnswerOnlyMarks === null || raw.finalAnswerOnlyMarks === undefined || raw.finalAnswerOnlyMarks === "" ? null : Number(raw.finalAnswerOnlyMarks),
    allowHalfMarks: raw.allowHalfMarks !== false,
  };
  const problems = schemeProblems(typed, maxMarks);
  if (typed.steps.some(s => s.marks <= 0)) problems.push("Every step needs more than 0 marks.");
  if (problems.length) throw new SchemeEditError(problems);
  const scheme = normalizeScheme(raw, maxMarks);
  const [row] = await db.insert(answerMarkingSchemes).values({
    businessAccountId,
    questionKey,
    version: current.version + 1,
    source: current.source,
    questionText: current.questionText,
    modelAnswer: edit.modelAnswer !== undefined ? String(edit.modelAnswer) : current.modelAnswer,
    modelAnswerByAi: edit.modelAnswer !== undefined ? false : current.modelAnswerByAi,
    questionKind: current.questionKind,
    board: current.board, medium: current.medium, grade: current.grade, subject: current.subject, chapter: current.chapter,
    maxMarks: String(maxMarks),
    scheme: scheme as any,
    status: "approved",
    createdBy: userId,
    approvedBy: userId,
    approvedAt: new Date(),
  }).returning();
  return row;
}

export async function approveScheme(businessAccountId: string, questionKey: string, userId: string | null): Promise<AnswerMarkingSchemeRow | null> {
  const current = await currentScheme(businessAccountId, questionKey);
  if (!current) return null;
  const [row] = await db.update(answerMarkingSchemes).set({ status: "approved", approvedBy: userId, approvedAt: new Date() })
    .where(eq(answerMarkingSchemes.id, current.id)).returning();
  return row;
}

// ---- Background queue -------------------------------------------------------------------------

const MAX_PARALLEL = Number(process.env.ANSWER_CHECK_PARALLEL || 3);
const queue: Array<() => Promise<void>> = [];
let running = 0;
const idleWaiters: Array<() => void> = [];

export function enqueue(job: () => Promise<void>) {
  queue.push(job);
  pump();
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift()!;
    running++;
    job().catch(err => console.error("[Answer Check] job failed:", err?.message || err)).finally(() => {
      running--;
      pump();
      if (!running && !queue.length) idleWaiters.splice(0).forEach(r => r());
    });
  }
}

/** Resolves when no check is running or waiting (tests). */
export function waitForIdle(): Promise<void> {
  if (!running && !queue.length) return Promise.resolve();
  return new Promise(r => idleWaiters.push(r));
}

/** A check still "checking" after this long was interrupted (for example by a restart). */
export const STALE_AFTER_MS = 10 * 60 * 1000;

export function effectiveStatus(row: Pick<AnswerCheckRow, "status" | "updatedAt">, now = Date.now()): string {
  if ((row.status === "checking" || row.status === "writing") && now - new Date(row.updatedAt).getTime() > STALE_AFTER_MS) return "failed";
  return row.status;
}

// ---- Creating checks --------------------------------------------------------------------------

export async function createUploadCheck(opts: { businessAccountId: string; scheme: AnswerMarkingSchemeRow; photos: Buffer[]; studentLabel: string; userId: string | null }): Promise<AnswerCheckRow> {
  const [check] = await db.insert(answerChecks).values({
    businessAccountId: opts.businessAccountId,
    schemeId: opts.scheme.id,
    questionKey: opts.scheme.questionKey,
    status: "checking",
    source: "upload",
    studentLabel: opts.studentLabel.slice(0, 80),
    maxMarks: opts.scheme.maxMarks,
    createdBy: opts.userId,
  }).returning();
  for (let i = 0; i < opts.photos.length; i++) {
    await saveImage({ checkId: check.id, businessAccountId: opts.businessAccountId, kind: "answer", position: i, data: opts.photos[i] });
  }
  enqueue(() => runCheck(check.id));
  return check;
}

const LEVEL_LABEL: Record<PracticeLevel, string> = { strong: "A", average: "B", weak: "C", ai_copied: "D" };

/**
 * Practice answers for a question: placeholder rows appear at once ("writing"); the AI writes
 * the answers at the chosen levels, each is drawn in handwriting and then checked like an upload.
 */
export async function createPracticeChecks(opts: { businessAccountId: string; scheme: AnswerMarkingSchemeRow; levels: PracticeLevel[]; userId: string | null; batchId: string }): Promise<AnswerCheckRow[]> {
  const rows: AnswerCheckRow[] = [];
  for (const level of opts.levels) {
    const [row] = await db.insert(answerChecks).values({
      businessAccountId: opts.businessAccountId,
      schemeId: opts.scheme.id,
      questionKey: opts.scheme.questionKey,
      batchId: opts.batchId,
      status: "writing",
      source: "practice",
      practiceLevel: level,
      studentLabel: `Practice student ${LEVEL_LABEL[level]}`,
      maxMarks: opts.scheme.maxMarks,
      createdBy: opts.userId,
    }).returning();
    rows.push(row);
  }
  enqueue(() => writePractice(opts.scheme, rows));
  return rows;
}

async function writePractice(scheme: AnswerMarkingSchemeRow, rows: AnswerCheckRow[]): Promise<void> {
  const levels = rows.map(r => r.practiceLevel as PracticeLevel);
  try {
    const ai = await aiFactory(scheme.businessAccountId);
    const ctx = contextOf(scheme);
    const markingScheme = schemeOf(scheme);
    const reply = await ai.json({ model: ANSWER_CHECK_MODEL, system: practiceSystem(), user: practiceUserText(ctx, markingScheme, levels), maxTokens: 4000, temperature: 0.7 });
    const answers = parsePractice(reply, levels);
    const share = rows.length ? ai.costUsd() / rows.length : 0;
    for (const row of rows) {
      const answer = answers.find(a => a.level === row.practiceLevel);
      if (!answer) {
        await db.update(answerChecks).set({ status: "failed", error: "The AI did not write this practice answer. Try again.", costUsd: String(share), updatedAt: new Date() }).where(eq(answerChecks.id, row.id));
        continue;
      }
      const expected = applyJudgement(markingScheme, ctx.maxMarks, answer.expectedSteps);
      const pages = await renderPracticeSheet({
        text: answer.text,
        studentLabel: `Name: ${row.studentLabel}`,
        questionLabel: `Q. ${ctx.questionText.replace(/\s+/g, " ")}`,
        seed: row.id,
      });
      for (let i = 0; i < pages.length; i++) await saveImage({ checkId: row.id, businessAccountId: row.businessAccountId, kind: "answer", position: i, data: pages[i] });
      await db.update(answerChecks).set({
        status: "checking",
        practiceText: answer.text,
        expectedMarks: String(expected.total),
        result: { practiceWhy: answer.why } as any,
        costUsd: String(share),
        updatedAt: new Date(),
      }).where(eq(answerChecks.id, row.id));
      enqueue(() => runCheck(row.id));
    }
  } catch (err: any) {
    const message = err instanceof AnswerCheckAiError ? err.message : `Could not write the practice answers: ${err?.message || err}`;
    await db.update(answerChecks).set({ status: "failed", error: message, updatedAt: new Date() }).where(inArray(answerChecks.id, rows.map(r => r.id)));
  }
}

// ---- Running a check --------------------------------------------------------------------------

/** Below this, a teacher confirms that the matched part of a sheet answers the question. */
export const MATCH_CONFIDENCE_MIN = 0.6;

/** The sheet's pages an answer was found on (1 = first page); all pages when that's unknown. */
async function paperPagesFor(paperId: string, wanted: unknown) {
  const all = await listPaperImages(paperId);
  const want = Array.isArray(wanted) ? new Set(wanted.map(Number)) : null;
  const mine = want ? all.filter(p => want.has(p.position + 1)) : [];
  return mine.length ? mine : all;
}

export async function runCheck(checkId: string, opts: { reread?: boolean } = {}): Promise<void> {
  const started = Date.now();
  const [check] = await db.select().from(answerChecks).where(eq(answerChecks.id, checkId));
  if (!check) return;
  const [schemeRow] = check.schemeId ? await db.select().from(answerMarkingSchemes).where(eq(answerMarkingSchemes.id, check.schemeId)) : [];
  const fail = async (message: string, cost = 0) => {
    await db.update(answerChecks).set({ status: "failed", error: message, costUsd: String(n(check.costUsd) + cost), durationMs: Date.now() - started, updatedAt: new Date() }).where(eq(answerChecks.id, checkId));
  };
  if (!schemeRow) return fail("This answer's marking scheme is missing.");
  let ai: AnswerCheckAi | null = null;
  try {
    ai = await aiFactory(check.businessAccountId);
    const settings = await getSettings(check.businessAccountId);
    const ctx = contextOf(schemeRow);
    const scheme = schemeOf(schemeRow);
    const rules = settings.subjectRules[ctx.subjectKind];
    // An answer from a whole answer sheet uses the sheet's pages it was found on; it was read
    // with the whole sheet, so it is never read again on its own.
    const fromPaper = !!check.paperId;
    const pages = fromPaper
      ? await paperPagesFor(check.paperId!, (check.reading as any)?.pages)
      : (await listImages(checkId, "answer")).sort((a, b) => a.position - b.position);
    const pageBytes = (await Promise.all(pages.map(p => imageBytes(p)))).filter((b): b is Buffer => !!b);
    if (!pageBytes.length) return fail("The answer photos are missing.");

    // 1. Read the handwriting (kept on a re-check unless asked to read again).
    let readText = check.readText;
    let reading = check.reading as any;
    if (readText === null || readText === undefined || (opts.reread && !fromPaper)) {
      const replied = await ai.json({ model: ANSWER_CHECK_MODEL, system: READ_SYSTEM, user: readUserText(ctx, pageBytes.length), images: pageBytes.map(b => toDataUrl(b)), maxTokens: 3000 });
      if (!replied) return fail("The AI could not read the photos. Try again.", ai.costUsd());
      const read = parseRead(replied);
      readText = read.text;
      reading = read;
      await db.update(answerChecks).set({ readText, reading: read as any, updatedAt: new Date() }).where(eq(answerChecks.id, checkId));
    }
    const legibility = Number(reading?.legibility ?? 0);
    const unclearCount = Array.isArray(reading?.unclear) ? reading.unclear.length : 0;
    const notAttempted = reading?.notAttempted === true;
    const blank = reading?.blank === true || notAttempted;

    // 2. Mark against the scheme (nothing to mark on a blank page or an unanswered question).
    let markReply = parseMark(null);
    if (notAttempted) {
      markReply = { ...markReply, confidence: 1, feedback: { summary: "This question was not attempted.", improvement: "", revision: "Revise this topic and try the question." }, teacherComment: "Not attempted" };
    } else if (!blank) {
      const replied = await ai.json({ model: ANSWER_CHECK_MODEL, system: markSystem(settings), user: markUserText(ctx, scheme, rules, readText || ""), maxTokens: 2500 });
      if (!replied) return fail("The AI could not mark this answer. Try again.", ai.costUsd());
      markReply = parseMark(replied);
    } else {
      markReply = { ...markReply, confidence: 1, feedback: { summary: "No answer was found on the page.", improvement: "", revision: "" } };
    }
    const marks = applyJudgement(scheme, ctx.maxMarks, markReply.judgements, { finalAnswerCorrect: markReply.finalAnswerCorrect ?? undefined, workingShown: markReply.workingShown ?? undefined });

    // 3. AI-written estimate (separate from the marks; short answers are not judged).
    const words = wordCount(readText || "");
    let aiWritten: Record<string, unknown> = { percent: null, status: "inconclusive", confidence: "low", signals: ["The answer is too short to judge."], words };
    if (!blank && words >= 15) {
      const replied = await ai.json({ model: ANSWER_CHECK_MINI_MODEL, system: AI_WRITTEN_SYSTEM, user: aiWrittenUserText(ctx, readText || ""), maxTokens: 400 });
      const est = parseAiWritten(replied);
      aiWritten = { ...est, status: aiWrittenStatus(est.percent, words), words };
    }

    // 4. Does a teacher need to look?
    const reasons = notAttempted
      ? (reading?.unplacedOnSheet ? ["Parts of the sheet weren't matched to any question — check this question really wasn't answered."] : [])
      : teacherReasons({ legibility, unclearCount, blank, confidence: markReply.confidence }, settings);
    if (fromPaper && !notAttempted && typeof reading?.matchConfidence === "number" && reading.matchConfidence < MATCH_CONFIDENCE_MIN) {
      reasons.push("The AI isn't sure this part of the sheet is the answer to this question.");
    }

    // 5. The marked sheet (none for a question that wasn't attempted).
    const remark = markReply.teacherComment || markReply.feedback.summary.split(/(?<=[.!?])\s/)[0] || "";
    if (!notAttempted) {
      try {
        const marked = await renderMarkedSheet({ pages: pageBytes, steps: marks.steps, total: marks.total, maxMarks: ctx.maxMarks, remark, needsTeacher: reasons.length > 0 });
        await replaceMarkedImage(checkId, check.businessAccountId, marked);
      } catch (err: any) {
        console.warn("[Answer Check] marked sheet not drawn:", err?.message || err);
      }
    }

    // Keep the earlier marking when this is a re-check.
    const history = Array.isArray(check.history) ? [...check.history] : [];
    if (check.result && check.aiMarks !== null) {
      history.push({ at: check.updatedAt, schemeVersion: (check.result as any)?.schemeVersion ?? null, aiMarks: n(check.aiMarks), result: check.result, aiWritten: check.aiWritten, teacherReasons: check.teacherReasons });
    }
    const practiceWhy = (check.result as any)?.practiceWhy;
    await db.update(answerChecks).set({
      status: reasons.length ? "needs_teacher" : "done",
      aiMarks: String(marks.total),
      result: {
        ...marks,
        correctPoints: markReply.correctPoints,
        mistakes: markReply.mistakes,
        missingConcepts: markReply.missingConcepts,
        missingKeywords: markReply.missingKeywords,
        alternativeMethod: markReply.alternativeMethod,
        confidence: markReply.confidence,
        confidenceNote: markReply.confidenceNote,
        feedback: markReply.feedback,
        teacherComment: markReply.teacherComment,
        schemeVersion: schemeRow.version,
        ...(practiceWhy ? { practiceWhy } : {}),
      } as any,
      aiWritten: aiWritten as any,
      teacherReasons: reasons,
      history: history as any,
      model: ANSWER_CHECK_MODEL,
      costUsd: String(n(check.costUsd) + ai.costUsd()),
      durationMs: Date.now() - started,
      error: null,
      updatedAt: new Date(),
    }).where(eq(answerChecks.id, checkId));
  } catch (err: any) {
    const message = err instanceof AnswerCheckAiError ? err.message
      : err?.status === 401 ? "The account's OpenAI key was refused."
      : err?.status === 429 ? "OpenAI is busy or the account's limit was reached. Try again in a minute."
      : `Checking failed: ${err?.message || err}`;
    await fail(message, ai?.costUsd() ?? 0);
  }
}

/** Marks an answer again with its question's current scheme (the reading is kept unless `reread`). */
export async function recheck(businessAccountId: string, checkId: string, opts: { reread?: boolean } = {}): Promise<AnswerCheckRow | null> {
  const [check] = await db.select().from(answerChecks).where(and(eq(answerChecks.id, checkId), eq(answerChecks.businessAccountId, businessAccountId)));
  if (!check) return null;
  if (effectiveStatus(check) === "checking" || effectiveStatus(check) === "writing") return check;
  if (check.source === "practice" && !check.practiceText) return check;
  const scheme = await currentScheme(businessAccountId, check.questionKey);
  const [row] = await db.update(answerChecks).set({
    status: "checking",
    schemeId: scheme?.id ?? check.schemeId,
    maxMarks: scheme?.maxMarks ?? check.maxMarks,
    error: null,
    updatedAt: new Date(),
  }).where(eq(answerChecks.id, checkId)).returning();
  enqueue(() => runCheck(checkId, opts));
  return row;
}

/** Re-checks every finished answer to a question with its current scheme. */
export async function recheckQuestion(businessAccountId: string, questionKey: string): Promise<number> {
  const rows = await db.select({ id: answerChecks.id, status: answerChecks.status, updatedAt: answerChecks.updatedAt }).from(answerChecks)
    .where(and(eq(answerChecks.businessAccountId, businessAccountId), eq(answerChecks.questionKey, questionKey)));
  let count = 0;
  for (const r of rows) {
    const s = effectiveStatus(r);
    if (s === "done" || s === "needs_teacher" || s === "failed") {
      await recheck(businessAccountId, r.id);
      count++;
    }
  }
  return count;
}

export async function saveTeacherMarks(businessAccountId: string, checkId: string, input: { marks: number | null; comment: string }, userId: string | null): Promise<AnswerCheckRow | null> {
  const [check] = await db.select().from(answerChecks).where(and(eq(answerChecks.id, checkId), eq(answerChecks.businessAccountId, businessAccountId)));
  if (!check) return null;
  const max = n(check.maxMarks);
  if (input.marks !== null && (!Number.isFinite(input.marks) || input.marks < 0 || input.marks > max)) throw new SchemeEditError([`Teacher's marks must be between 0 and ${max}.`]);
  const [row] = await db.update(answerChecks).set({
    teacherMarks: input.marks === null ? null : String(Math.round(input.marks * 2) / 2),
    teacherComment: input.comment.trim().slice(0, 1000) || null,
    teacherBy: userId,
    teacherAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(answerChecks.id, checkId)).returning();
  return row;
}

export async function deleteCheck(businessAccountId: string, checkId: string): Promise<boolean> {
  const { deleteStoredFiles } = await import("./images");
  const [check] = await db.select({ id: answerChecks.id, paperId: answerChecks.paperId }).from(answerChecks).where(and(eq(answerChecks.id, checkId), eq(answerChecks.businessAccountId, businessAccountId)));
  if (!check) return false;
  if (check.paperId) throw new SchemeEditError(["This answer is part of a whole paper: delete the paper instead."]);
  await deleteStoredFiles(checkId);
  await db.delete(answerChecks).where(eq(answerChecks.id, checkId));
  return true;
}

// ---- Reading checks for the screens -----------------------------------------------------------

export function checkView(row: AnswerCheckRow, scheme: AnswerMarkingSchemeRow | null, images: Array<{ id: string; kind: string; position: number }>) {
  return {
    id: row.id,
    questionKey: row.questionKey,
    batchId: row.batchId,
    paperId: row.paperId,
    questionNumber: row.questionNumber,
    status: effectiveStatus(row),
    interrupted: effectiveStatus(row) === "failed" && row.status !== "failed",
    source: row.source,
    practiceLevel: row.practiceLevel,
    practiceText: row.practiceText,
    expectedMarks: nOrNull(row.expectedMarks),
    studentLabel: row.studentLabel,
    maxMarks: n(row.maxMarks),
    readText: row.readText,
    reading: row.reading,
    result: row.result,
    aiMarks: nOrNull(row.aiMarks),
    aiWritten: row.aiWritten,
    teacherReasons: row.teacherReasons || [],
    teacherMarks: nOrNull(row.teacherMarks),
    teacherComment: row.teacherComment,
    teacherAt: row.teacherAt,
    history: row.history || [],
    model: row.model,
    costUsd: n(row.costUsd),
    durationMs: row.durationMs,
    error: row.error || (effectiveStatus(row) === "failed" && row.status !== "failed" ? "This check was interrupted (for example by a server restart). Try again." : null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    scheme: scheme ? schemeView(scheme) : null,
    images: images.map(i => ({ id: i.id, kind: i.kind, position: i.position })),
  };
}

export function schemeView(row: AnswerMarkingSchemeRow) {
  return {
    id: row.id,
    questionKey: row.questionKey,
    version: row.version,
    source: row.source,
    questionText: row.questionText,
    modelAnswer: row.modelAnswer,
    modelAnswerByAi: row.modelAnswerByAi,
    questionKind: row.questionKind,
    board: row.board, medium: row.medium, grade: row.grade, subject: row.subject, chapter: row.chapter,
    maxMarks: n(row.maxMarks),
    scheme: schemeOf(row),
    status: row.status,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
  };
}

export async function countChecksByQuestion(businessAccountId: string, keys: string[]): Promise<Map<string, number>> {
  if (!keys.length) return new Map();
  const rows = await db.select({ key: answerChecks.questionKey, count: sql<number>`count(*)::int` }).from(answerChecks)
    .where(and(eq(answerChecks.businessAccountId, businessAccountId), inArray(answerChecks.questionKey, keys)))
    .groupBy(answerChecks.questionKey);
  return new Map(rows.map(r => [r.key, Number(r.count)]));
}
