import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { answerCheckImages, answerChecks, answerMarkingSchemes, businessAccounts } from "@shared/schema";
import { PRACTICE_LEVELS, QUESTION_KINDS, accuracySummary, type PracticeLevel } from "@shared/answerCheck";
import { requireAuth, requireRole } from "../auth";
import { AnswerCheckAiError, createAnswerCheckAi } from "../services/answerCheck/ai";
import {
  approveScheme,
  checkView,
  countChecksByQuestion,
  createPracticeChecks,
  createUploadCheck,
  currentScheme,
  deleteCheck,
  getSettings,
  prepareQuestion,
  recheck,
  recheckQuestion,
  saveSchemeEdit,
  saveSettings,
  saveTeacherMarks,
  assessmentEnabled,
  SchemeEditError,
  schemeVersions,
  schemeView,
} from "../services/answerCheck/engine";
import { ImageError, imageBytes, MAX_PAGES, MAX_PAPER_PAGES, prepareUpload } from "../services/answerCheck/images";
import { chaptersFor, customQuestionKey, pickRandomQuestion, pickRandomQuestions, scopeOptions, searchQuestions, type QuestionInput } from "../services/answerCheck/questions";
import { cleanQuestionList, createPaper, createPracticePaper, deletePaper, listPapers, PaperError, paperView, rerunPaper } from "../services/answerCheck/papers";
import { answerPapers } from "@shared/schema";

/**
 * AI assessment (answer checking pilot): a business account's Education › Assessment, for super
 * admins viewing that account only. Works on the account being viewed, with its OpenAI key. The
 * account's feature switch (Settings › Features, "AI assessment") must be on for anything that
 * calls the AI; history, settings and photos stay viewable while it is off.
 *
 *   GET  /api/answer-checking/overview            account, on/off, settings
 *   GET  /api/answer-checking/scopes              the account's classes and subjects (synced packs, as the Widget Tester)
 *   GET  /api/answer-checking/chapters            one class and subject's chapters
 *   PUT  /api/answer-checking/settings
 *   POST /api/answer-checking/questions/random     a written-answer question from the curriculum
 *   GET  /api/answer-checking/questions/search
 *   POST /api/answer-checking/questions/prepare    question → its marking scheme (drafted once)
 *   GET  /api/answer-checking/schemes/:key         current scheme + versions + checks so far
 *   PUT  /api/answer-checking/schemes/:key         admin edit → new approved version
 *   POST /api/answer-checking/schemes/:key/approve
 *   POST /api/answer-checking/schemes/:key/recheck re-mark every answer with the current scheme
 *   POST /api/answer-checking/checks               photos → a check (runs in the background)
 *   POST /api/answer-checking/practice             practice answers at chosen levels → checks
 *   GET  /api/answer-checking/checks               history (filters) + accuracy summary
 *   GET  /api/answer-checking/checks/:id
 *   POST /api/answer-checking/checks/:id/recheck
 *   PUT  /api/answer-checking/checks/:id/teacher   teacher's marks and comment
 *   DELETE /api/answer-checking/checks/:id
 *   GET  /api/answer-checking/images/:id           a photo or marked sheet
 *   GET  /api/answer-checking/export.csv
 *   POST /api/answer-checking/papers/random-questions   several random questions for a paper
 *   POST /api/answer-checking/papers                     whole answer sheet → read, matched, each answer checked
 *   POST /api/answer-checking/papers/practice            the AI writes one student's whole sheet
 *   GET  /api/answer-checking/papers                     list
 *   GET  /api/answer-checking/papers/:id
 *   POST /api/answer-checking/papers/:id/rerun           read the sheet again (replaces its results)
 *   DELETE /api/answer-checking/papers/:id
 */
const router = Router();
const BASE = "/api/answer-checking";

/** A super admin viewing a business account (the account the pilot works on). */
function requireViewedAccount(req: Request, res: Response, next: () => void) {
  if (!(req as any).user?.activeBusinessAccountId) return res.status(400).json({ error: "Open a business account first." });
  next();
}

const superAdmin = [requireAuth, requireRole("super_admin"), requireViewedAccount];

function accountId(req: Request): string {
  return (req as any).user.activeBusinessAccountId;
}

/** Questions that already have an answer key keep its marks (a suggestion must never replace a saved key). */
async function withSavedMarks<T extends { questionKey: string; maxMarks: number }>(req: Request, questions: T[]): Promise<T[]> {
  return Promise.all(questions.map(async q => {
    const saved = await currentScheme(accountId(req), q.questionKey);
    return saved ? { ...q, maxMarks: Number(saved.maxMarks) } : q;
  }));
}

function userId(req: Request): string | null {
  return (req as any).user?.id ?? null;
}

function fail(res: Response, where: string, error: unknown) {
  if (error instanceof SchemeEditError) return res.status(400).json({ error: error.message, problems: error.problems });
  if (error instanceof ImageError || error instanceof AnswerCheckAiError || error instanceof PaperError) return res.status(400).json({ error: (error as Error).message });
  console.error(`[Answer Check] ${where}:`, error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

const OFF_MESSAGE = "AI assessment is switched off for this account. Switch it on in Settings › Features.";

/** Refuses anything that would call the AI while AI assessment is off. */
async function requireOn(req: Request, res: Response): Promise<boolean> {
  if (await assessmentEnabled(accountId(req))) return true;
  res.status(409).json({ error: OFF_MESSAGE, code: "assessment_off" });
  return false;
}

const questionSchema = z.object({
  questionKey: z.string().max(200).optional(),
  source: z.enum(["cms", "custom", "generated"]).default("custom"),
  questionText: z.string().trim().min(5, "Type the question.").max(4000),
  modelAnswer: z.string().max(10000).default(""),
  questionKind: z.enum(QUESTION_KINDS).nullable().default(null),
  board: z.string().max(100).nullable().default(null),
  medium: z.string().max(100).nullable().default(null),
  grade: z.string().max(50).nullable().default(null),
  subject: z.string().max(200).nullable().default(null),
  chapter: z.string().max(300).nullable().default(null),
  maxMarks: z.coerce.number().min(0.5, "Max marks must be at least 0.5.").max(100, "Max marks can be at most 100."),
});

/** A question key is only trusted for curriculum questions; typed ones are keyed by their text. */
function toQuestionInput(body: z.infer<typeof questionSchema>): QuestionInput {
  const key = body.source === "cms" && body.questionKey?.startsWith("cms:") ? body.questionKey
    : body.source === "generated" && body.questionKey?.startsWith("gen:") ? body.questionKey
    : customQuestionKey(body.questionText);
  return { ...body, questionKey: key, source: key.startsWith("cms:") ? "cms" : key.startsWith("gen:") ? "generated" : "custom", maxMarks: Math.round(body.maxMarks * 2) / 2 };
}

router.get(`${BASE}/overview`, ...superAdmin, async (req, res) => {
  try {
    const id = accountId(req);
    const [account] = await db.select({ id: businessAccounts.id, name: businessAccounts.name, hasKey: sql<boolean>`(${businessAccounts.openaiApiKey} is not null and ${businessAccounts.openaiApiKey} <> '')` })
      .from(businessAccounts).where(eq(businessAccounts.id, id));
    const [counts] = await db.select({ checks: sql<number>`count(*)::int`, schemes: sql<number>`count(distinct ${answerChecks.questionKey})::int` })
      .from(answerChecks).where(eq(answerChecks.businessAccountId, id));
    res.json({ account: account ?? null, enabled: account ? await assessmentEnabled(id) : false, settings: await getSettings(id), counts });
  } catch (e) { fail(res, "overview", e); }
});

/** A class / subject / chapter chosen on the page (query or body); null when incomplete. */
function scopeFrom(src: any): { board: string; medium: string; grade: string; subject: string; chapter: string } | null {
  const s = (k: string) => (typeof src?.[k] === "string" ? src[k].trim() : "");
  if (!s("board") || !s("medium") || !s("grade")) return null;
  return { board: s("board"), medium: s("medium"), grade: s("grade"), subject: s("subject"), chapter: s("subject") ? s("chapter") : "" };
}

router.get(`${BASE}/chapters`, ...superAdmin, async (req, res) => {
  try {
    const scope = scopeFrom(req.query);
    if (!scope?.subject) return res.status(400).json({ error: "Choose a board, medium, grade and subject." });
    res.json({ chapters: await chaptersFor(accountId(req), scope) });
  } catch (e: any) {
    console.warn("[Answer Check] chapters:", e?.message || e);
    res.json({ chapters: [], error: "Could not load the chapters from the content store." });
  }
});

// The account's classes and subjects; separate from the overview because a large content store can be slow.
router.get(`${BASE}/scopes`, ...superAdmin, async (req, res) => {
  try { res.json({ scopes: await scopeOptions(accountId(req)), error: null }); }
  catch (e: any) {
    console.warn("[Answer Check] scopes:", e?.message || e);
    res.json({ scopes: [], error: "Could not load the curriculum list from the content store." });
  }
});

router.put(`${BASE}/settings`, ...superAdmin, async (req, res) => {
  try { res.json({ settings: await saveSettings(accountId(req), req.body?.settings ?? req.body, userId(req)) }); }
  catch (e) { fail(res, "settings", e); }
});

router.post(`${BASE}/questions/random`, ...superAdmin, async (req, res) => {
  try {
    if (!(await requireOn(req, res))) return;
    const id = accountId(req);
    const settings = await getSettings(id);
    const ai = await createAnswerCheckAi(id).catch(() => null);
    const picked = await pickRandomQuestion(id, settings, ai, Math.random, new Set(), scopeFrom(req.body?.scope) ?? undefined);
    res.json({ ...picked, question: picked.question ? (await withSavedMarks(req, [picked.question]))[0] : null });
  } catch (e) { fail(res, "random question", e); }
});

router.get(`${BASE}/questions/search`, ...superAdmin, async (req, res) => {
  try {
    const scope = scopeFrom(req.query);
    if (!scope) return res.status(400).json({ error: "Choose a board, medium and grade." });
    const results = await searchQuestions(accountId(req), scope, String(req.query.q ?? ""), await getSettings(accountId(req)));
    res.json({ results: await withSavedMarks(req, results) });
  } catch (e) { fail(res, "search", e); }
});

router.post(`${BASE}/questions/prepare`, ...superAdmin, async (req, res) => {
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Check the question." });
  try {
    if (!(await requireOn(req, res))) return;
    const row = await prepareQuestion(accountId(req), toQuestionInput(parsed.data), userId(req));
    res.json({ scheme: schemeView(row) });
  } catch (e) { fail(res, "prepare", e); }
});

router.get(`${BASE}/schemes/:key`, ...superAdmin, async (req, res) => {
  try {
    const versions = await schemeVersions(accountId(req), req.params.key);
    if (!versions.length) return res.status(404).json({ error: "Question not found." });
    const counts = await countChecksByQuestion(accountId(req), [req.params.key]);
    res.json({ scheme: schemeView(versions[0]), versions: versions.map(schemeView), checks: counts.get(req.params.key) || 0 });
  } catch (e) { fail(res, "scheme", e); }
});

router.put(`${BASE}/schemes/:key`, ...superAdmin, async (req, res) => {
  try {
    const maxMarks = req.body?.maxMarks === undefined ? undefined : Number(req.body.maxMarks);
    const row = await saveSchemeEdit(accountId(req), req.params.key, { scheme: req.body?.scheme, maxMarks, modelAnswer: typeof req.body?.modelAnswer === "string" ? req.body.modelAnswer : undefined }, userId(req));
    res.json({ scheme: schemeView(row) });
  } catch (e) { fail(res, "scheme edit", e); }
});

router.post(`${BASE}/schemes/:key/approve`, ...superAdmin, async (req, res) => {
  try {
    const row = await approveScheme(accountId(req), req.params.key, userId(req));
    if (!row) return res.status(404).json({ error: "Question not found." });
    res.json({ scheme: schemeView(row) });
  } catch (e) { fail(res, "approve", e); }
});

router.post(`${BASE}/schemes/:key/recheck`, ...superAdmin, async (req, res) => {
  try {
    if (!(await requireOn(req, res))) return;
    res.json({ started: await recheckQuestion(accountId(req), req.params.key) });
  } catch (e) { fail(res, "recheck question", e); }
});

const DATA_URL = /^data:(image\/(?:jpeg|jpg|png|webp|heic|heif));base64,([A-Za-z0-9+/=\s]+)$/i;

/** Photos sent as data URLs → upright JPEGs (null + a reply already sent when one is unusable). */
async function readPhotos(res: Response, raw: unknown, max: number, what: string): Promise<Buffer[] | null> {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  if (!list.length) { res.status(400).json({ error: `Add at least one photo of the ${what}.` }); return null; }
  if (list.length > max) { res.status(400).json({ error: `At most ${max} photos.` }); return null; }
  const photos: Buffer[] = [];
  for (const p of list) {
    const m = typeof p === "string" ? DATA_URL.exec(p) : null;
    if (!m) { res.status(400).json({ error: "Photos must be JPG or PNG images." }); return null; }
    photos.push(await prepareUpload(Buffer.from(m[2], "base64")));
  }
  return photos;
}

router.post(`${BASE}/checks`, ...superAdmin, async (req, res) => {
  try {
    if (!(await requireOn(req, res))) return;
    const key = String(req.body?.questionKey || "");
    const scheme = key ? await currentScheme(accountId(req), key) : null;
    if (!scheme) return res.status(400).json({ error: "Choose the question first." });
    const photos = await readPhotos(res, req.body?.photos, MAX_PAGES, "answer");
    if (!photos) return;
    const check = await createUploadCheck({ businessAccountId: accountId(req), scheme, photos, studentLabel: String(req.body?.studentLabel || "").trim(), userId: userId(req) });
    res.json({ id: check.id });
  } catch (e) { fail(res, "create check", e); }
});

router.post(`${BASE}/practice`, ...superAdmin, async (req, res) => {
  try {
    if (!(await requireOn(req, res))) return;
    const key = String(req.body?.questionKey || "");
    const scheme = key ? await currentScheme(accountId(req), key) : null;
    if (!scheme) return res.status(400).json({ error: "Choose the question first." });
    const levels = (Array.isArray(req.body?.levels) ? req.body.levels : ["strong", "average", "weak"])
      .filter((l: unknown, i: number, a: unknown[]) => PRACTICE_LEVELS.includes(l as PracticeLevel) && a.indexOf(l) === i) as PracticeLevel[];
    if (!levels.length) return res.status(400).json({ error: "Choose at least one kind of practice answer." });
    const batchId = crypto.randomUUID();
    const rows = await createPracticeChecks({ businessAccountId: accountId(req), scheme, levels, userId: userId(req), batchId });
    res.json({ batchId, ids: rows.map(r => r.id) });
  } catch (e) { fail(res, "practice", e); }
});

async function viewsFor(rows: Array<typeof answerChecks.$inferSelect>) {
  if (!rows.length) return [];
  const schemeIds = Array.from(new Set(rows.map(r => r.schemeId).filter((x): x is string => !!x)));
  const schemes = schemeIds.length ? await db.select().from(answerMarkingSchemes).where(inArray(answerMarkingSchemes.id, schemeIds)) : [];
  const images = await db.select({ id: answerCheckImages.id, checkId: answerCheckImages.checkId, kind: answerCheckImages.kind, position: answerCheckImages.position })
    .from(answerCheckImages).where(inArray(answerCheckImages.checkId, rows.map(r => r.id)));
  return rows.map(r => checkView(r, schemes.find(s => s.id === r.schemeId) ?? null, images.filter(i => i.checkId === r.id).sort((a, b) => a.position - b.position)));
}

router.get(`${BASE}/checks`, ...superAdmin, async (req, res) => {
  try {
    const conds = [eq(answerChecks.businessAccountId, accountId(req))];
    if (req.query.batchId) conds.push(eq(answerChecks.batchId, String(req.query.batchId)));
    if (req.query.questionKey) conds.push(eq(answerChecks.questionKey, String(req.query.questionKey)));
    if (req.query.ids) conds.push(inArray(answerChecks.id, String(req.query.ids).split(",").filter(Boolean).slice(0, 50)));
    if (req.query.source === "upload" || req.query.source === "practice") conds.push(eq(answerChecks.source, String(req.query.source)));
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const rows = await db.select().from(answerChecks).where(and(...conds)).orderBy(desc(answerChecks.createdAt)).limit(limit);
    const views = await viewsFor(rows);
    const finished = views.filter(v => v.aiMarks !== null);
    res.json({
      checks: views,
      accuracy: {
        teacher: accuracySummary(finished.map(v => ({ aiMarks: v.aiMarks, maxMarks: v.maxMarks, compareMarks: v.teacherMarks }))),
        expected: accuracySummary(finished.map(v => ({ aiMarks: v.aiMarks, maxMarks: v.maxMarks, compareMarks: v.expectedMarks }))),
        averageSeconds: finished.length ? Math.round(finished.reduce((a, v) => a + (v.durationMs || 0), 0) / finished.length / 100) / 10 : 0,
        averageCostUsd: finished.length ? finished.reduce((a, v) => a + v.costUsd, 0) / finished.length : 0,
        needsTeacher: views.filter(v => v.status === "needs_teacher").length,
        total: views.length,
      },
    });
  } catch (e) { fail(res, "list checks", e); }
});

router.get(`${BASE}/checks/:id`, ...superAdmin, async (req, res) => {
  try {
    const [row] = await db.select().from(answerChecks).where(and(eq(answerChecks.id, req.params.id), eq(answerChecks.businessAccountId, accountId(req))));
    if (!row) return res.status(404).json({ error: "Check not found." });
    const [view] = await viewsFor([row]);
    res.json({ check: view });
  } catch (e) { fail(res, "get check", e); }
});

router.post(`${BASE}/checks/:id/recheck`, ...superAdmin, async (req, res) => {
  try {
    if (!(await requireOn(req, res))) return;
    const row = await recheck(accountId(req), req.params.id, { reread: req.body?.reread === true });
    if (!row) return res.status(404).json({ error: "Check not found." });
    res.json({ ok: true });
  } catch (e) { fail(res, "recheck", e); }
});

router.put(`${BASE}/checks/:id/teacher`, ...superAdmin, async (req, res) => {
  try {
    const raw = req.body?.marks;
    const marks = raw === null || raw === undefined || raw === "" ? null : Number(raw);
    const row = await saveTeacherMarks(accountId(req), req.params.id, { marks, comment: String(req.body?.comment || "") }, userId(req));
    if (!row) return res.status(404).json({ error: "Check not found." });
    res.json({ ok: true });
  } catch (e) { fail(res, "teacher marks", e); }
});

router.delete(`${BASE}/checks/:id`, ...superAdmin, async (req, res) => {
  try {
    if (!(await deleteCheck(accountId(req), req.params.id))) return res.status(404).json({ error: "Check not found." });
    res.json({ ok: true });
  } catch (e) { fail(res, "delete check", e); }
});

router.get(`${BASE}/images/:id`, ...superAdmin, async (req, res) => {
  try {
    const [row] = await db.select().from(answerCheckImages).where(and(eq(answerCheckImages.id, req.params.id), eq(answerCheckImages.businessAccountId, accountId(req))));
    if (!row) return res.status(404).end();
    const bytes = await imageBytes(row);
    if (!bytes) return res.status(404).end();
    res.setHeader("Content-Type", row.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(bytes);
  } catch (e) { fail(res, "image", e); }
});

// ---- Whole papers ------------------------------------------------------------------------------

router.post(`${BASE}/papers/random-questions`, ...superAdmin, async (req, res) => {
  try {
    if (!(await requireOn(req, res))) return;
    const count = Math.min(10, Math.max(1, Math.round(Number(req.body?.count) || 5)));
    const ai = await createAnswerCheckAi(accountId(req)).catch(() => null);
    const picked = await pickRandomQuestions(accountId(req), await getSettings(accountId(req)), ai, count, Math.random, scopeFrom(req.body?.scope) ?? undefined);
    res.json({ ...picked, questions: await withSavedMarks(req, picked.questions) });
  } catch (e) { fail(res, "paper random questions", e); }
});

router.post(`${BASE}/papers`, ...superAdmin, async (req, res) => {
  try {
    if (!(await requireOn(req, res))) return;
    const questions = cleanQuestionList(req.body?.questions);
    const photos = await readPhotos(res, req.body?.photos, MAX_PAPER_PAGES, "answer sheet");
    if (!photos) return;
    const paper = await createPaper({ businessAccountId: accountId(req), title: String(req.body?.title || "").trim(), studentLabel: String(req.body?.studentLabel || "").trim(), questions, photos, userId: userId(req) });
    res.json({ id: paper.id });
  } catch (e) { fail(res, "create paper", e); }
});

router.post(`${BASE}/papers/practice`, ...superAdmin, async (req, res) => {
  try {
    if (!(await requireOn(req, res))) return;
    const questions = cleanQuestionList(req.body?.questions);
    const paper = await createPracticePaper({ businessAccountId: accountId(req), title: String(req.body?.title || "").trim(), studentLabel: String(req.body?.studentLabel || "").trim(), questions, userId: userId(req) });
    res.json({ id: paper.id });
  } catch (e) { fail(res, "practice paper", e); }
});

router.get(`${BASE}/papers`, ...superAdmin, async (req, res) => {
  try { res.json({ papers: await listPapers(accountId(req)) }); }
  catch (e) { fail(res, "list papers", e); }
});

router.get(`${BASE}/papers/:id`, ...superAdmin, async (req, res) => {
  try {
    const [paper] = await db.select().from(answerPapers).where(and(eq(answerPapers.id, req.params.id), eq(answerPapers.businessAccountId, accountId(req))));
    if (!paper) return res.status(404).json({ error: "Paper not found." });
    res.json({ paper: await paperView(paper) });
  } catch (e) { fail(res, "get paper", e); }
});

router.post(`${BASE}/papers/:id/rerun`, ...superAdmin, async (req, res) => {
  try {
    if (!(await requireOn(req, res))) return;
    if (!(await rerunPaper(accountId(req), req.params.id))) return res.status(404).json({ error: "Paper not found." });
    res.json({ ok: true });
  } catch (e) { fail(res, "rerun paper", e); }
});

router.delete(`${BASE}/papers/:id`, ...superAdmin, async (req, res) => {
  try {
    if (!(await deletePaper(accountId(req), req.params.id))) return res.status(404).json({ error: "Paper not found." });
    res.json({ ok: true });
  } catch (e) { fail(res, "delete paper", e); }
});

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

router.get(`${BASE}/export.csv`, ...superAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(answerChecks).where(eq(answerChecks.businessAccountId, accountId(req))).orderBy(desc(answerChecks.createdAt)).limit(5000);
    const views = await viewsFor(rows);
    const header = ["Date", "Question", "Subject", "Grade", "Student", "Source", "Practice level", "Status", "Max marks", "AI marks", "Teacher marks", "Expected marks", "AI-written %", "AI-written status", "Confidence", "Seconds", "Cost (USD)", "Teacher comment"];
    const lines = [header.join(",")];
    for (const v of views) {
      lines.push([
        new Date(v.createdAt).toISOString(), v.scheme?.questionText, v.scheme?.subject, v.scheme?.grade, v.studentLabel, v.source, v.practiceLevel, v.status,
        v.maxMarks, v.aiMarks, v.teacherMarks, v.expectedMarks, (v.aiWritten as any)?.percent, (v.aiWritten as any)?.status, (v.result as any)?.confidence,
        v.durationMs ? Math.round(v.durationMs / 1000) : "", v.costUsd.toFixed(4), v.teacherComment,
      ].map(csvCell).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="answer-checks.csv"`);
    res.send("﻿" + lines.join("\n"));
  } catch (e) { fail(res, "export", e); }
});

export default router;
