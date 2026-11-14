import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { businessAccounts } from "@shared/schema";
import { subjectKindOf, suggestMaxMarks, type AnswerCheckSettings, type QuestionKind, type ScopePick } from "@shared/answerCheck";
import { getTopscholarConfig, type TopscholarConfig } from "../topscholar/config";
import { getChunks, type ChunkPage, type ChunkQueryOptions, type ContentChunkItem } from "../topscholar/contentReader";
import { getMongoChunks } from "../topscholar/mongoContentReader";
import { chapterNamesForCpIds, listSyncedScopeMetadata, syncedCpIdsForScope, type StoredCurriculumScope } from "../topscholar/testerContentScopes";
import { htmlToText } from "../topscholar/htmlContent";
import { ANSWER_CHECK_MODEL, type AnswerCheckAi } from "./ai";
import { guessQuestionKind, isObjectiveQuestion, parseQuestionFromNotes, QUESTION_FROM_NOTES_SYSTEM, questionFromNotesUserText } from "./prompts";

/**
 * Answer checking pilot — questions from the account's own curriculum (Top Scholar's synced
 * CMS content): the classes it has (the same synced-pack list the Widget Tester uses), each
 * subject's chapters, a search, and the "Random question" button, which picks a written-answer
 * question (never multiple choice) from the chosen class / subject / chapter and question kinds.
 * When a scope has no written-answer questions, the AI sets one from a chapter's notes.
 */

export interface QuestionInput {
  questionKey: string;
  source: "cms" | "custom" | "generated" | "assessment";
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

export function customQuestionKey(questionText: string, prefix: "custom" | "gen" = "custom"): string {
  const norm = questionText.toLowerCase().replace(/\s+/g, " ").trim();
  return `${prefix}:${crypto.createHash("sha1").update(norm).digest("hex").slice(0, 20)}`;
}

export async function accountContentConfig(businessAccountId: string): Promise<TopscholarConfig | null> {
  const [account] = await db.select().from(businessAccounts).where(eq(businessAccounts.id, businessAccountId));
  return account ? getTopscholarConfig(account) : null;
}

function readChunks(cfg: TopscholarConfig, businessAccountId: string, opts: ChunkQueryOptions): Promise<ChunkPage> {
  return cfg.storeType === "mongodb" ? getMongoChunks(cfg, businessAccountId, opts) : getChunks(cfg, businessAccountId, opts);
}

export interface ScopeOption {
  board: string;
  medium: string;
  grade: string;
  subjects: string[];
}

/** Board · medium · grade combinations with their subjects, for the settings and the search. */
export async function scopeOptions(businessAccountId: string): Promise<ScopeOption[]> {
  const rows = await listSyncedScopeMetadata(businessAccountId);
  const map = new Map<string, ScopeOption>();
  for (const r of rows) {
    const key = `${r.board}|${r.medium}|${r.grade}`.toLowerCase();
    const o = map.get(key) || { board: r.board, medium: r.medium, grade: r.grade, subjects: [] };
    if (r.subject && !o.subjects.some(s => s.toLowerCase() === r.subject.toLowerCase())) o.subjects.push(r.subject);
    map.set(key, o);
  }
  return Array.from(map.values())
    .map(o => ({ ...o, subjects: o.subjects.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.board.localeCompare(b.board) || a.medium.localeCompare(b.medium) || a.grade.localeCompare(b.grade, undefined, { numeric: true }));
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Chapter names of one class and subject, as the Widget Tester lists them. */
export async function chaptersFor(businessAccountId: string, scope: ScopePick): Promise<string[]> {
  const cfg = await accountContentConfig(businessAccountId);
  if (!cfg || !scope.subject) return [];
  const cpIds = syncedCpIdsForScope(await listSyncedScopeMetadata(businessAccountId), scope);
  const names = await chapterNamesForCpIds(cfg, businessAccountId, cpIds);
  return names.filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Stored scope rows that match the chosen scopes (a scope with no subject matches every subject). */
export function matchingScopeRows(rows: StoredCurriculumScope[], picks: ScopePick[]): StoredCurriculumScope[] {
  if (!picks.length) return rows;
  return rows.filter(r => picks.some(p => same(p.board, r.board) && same(p.medium, r.medium) && same(p.grade, r.grade) && (!p.subject || same(p.subject, r.subject))));
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A question chunk as a question for checking, or null when it is objective or empty. */
export function questionFromChunk(chunk: ContentChunkItem, scope: StoredCurriculumScope, settings: Pick<AnswerCheckSettings, "minMarks" | "maxMarks">): QuestionInput | null {
  const meta = chunk.metadata || {};
  if (isObjectiveQuestion(meta.questionType, meta.options)) return null;
  const questionText = (htmlToText(chunk.contentText).text || chunk.contentText || "").trim();
  if (questionText.length < 8) return null;
  const solution = typeof meta.solution === "string" ? htmlToText(meta.solution).text.trim() : "";
  const kind = guessQuestionKind(meta.questionType, questionText, solution, subjectKindOf(scope.subject));
  return {
    questionKey: `cms:${scope.cpId}:${chunk.sourceRef || chunk.id}`,
    source: "cms",
    questionText,
    modelAnswer: solution,
    questionKind: kind,
    board: scope.board,
    medium: scope.medium,
    grade: scope.grade,
    subject: scope.subject,
    chapter: chunk.chapter,
    maxMarks: suggestMaxMarks(kind, solution, settings),
  };
}

/** What a look through the curriculum's questions found (shown when nothing fits). */
export interface ScanSummary {
  packs: number;
  /** Question items looked at. */
  questions: number;
  written: number;
  /** Multiple choice, true/false, fill in the blanks, match (left out). */
  objective: number;
  /** Of those, how many were left out because the item has answer options. */
  withOptions: number;
  /** Items too short to be a question. */
  empty: number;
  /** The CMS's own question types, most common first. */
  types: Array<{ type: string; count: number; written: number }>;
  /** Stopped before the end of a very large pack. */
  truncated: boolean;
}

export function emptyScanSummary(): ScanSummary {
  return { packs: 0, questions: 0, written: 0, objective: 0, withOptions: 0, empty: 0, types: [], truncated: false };
}

/** Most questions read from one pack in one look (pages of 100). */
export const MAX_SCAN_PER_PACK = 5000;

/**
 * Every question item of one pack (optionally one chapter / matching words), page by page, counted
 * into `summary`; returns the written-answer questions. Objective items are left out.
 */
export async function scanPackQuestions(
  cfg: TopscholarConfig, businessAccountId: string, scope: StoredCurriculumScope,
  opts: { chapter?: string; q?: string }, settings: Pick<AnswerCheckSettings, "minMarks" | "maxMarks">, summary: ScanSummary,
): Promise<QuestionInput[]> {
  const out: QuestionInput[] = [];
  summary.packs++;
  for (let page = 1, seen = 0; ; page++) {
    const batch = await readChunks(cfg, businessAccountId, { cpId: scope.cpId, contentType: "question", chapter: opts.chapter || undefined, q: opts.q?.trim() || undefined, page, pageSize: 100 });
    for (const c of batch.items) {
      const meta = c.metadata || {};
      const type = typeof meta.questionType === "string" && meta.questionType.trim() ? meta.questionType.trim() : "(no type)";
      let t = summary.types.find(x => x.type.toLowerCase() === type.toLowerCase());
      if (!t) { t = { type, count: 0, written: 0 }; summary.types.push(t); }
      t.count++;
      summary.questions++;
      if (isObjectiveQuestion(meta.questionType, meta.options)) {
        summary.objective++;
        if (Array.isArray(meta.options) && meta.options.length >= 2) summary.withOptions++;
        continue;
      }
      const question = questionFromChunk(c, scope, settings);
      if (!question) { summary.empty++; continue; }
      summary.written++;
      t.written++;
      if (!out.some(o => o.questionKey === question.questionKey)) out.push(question);
    }
    seen += batch.items.length;
    if (!batch.items.length || seen >= batch.total) break;
    if (seen >= MAX_SCAN_PER_PACK) { summary.truncated = true; break; }
  }
  summary.types.sort((a, b) => b.count - a.count);
  return out;
}

/** "Looked at 240 questions: 0 written, 240 multiple choice or other objective (types: MCQ 230, True/False 10)." */
export function describeScan(s: ScanSummary, where: string): string {
  if (!s.questions) return `There are no questions at all in ${where} (only notes, videos or e-books).`;
  const types = s.types.slice(0, 5).map(t => `${t.type} ${t.count}`).join(", ");
  return `Looked at ${s.questions} question${s.questions === 1 ? "" : "s"} in ${where}: ${s.written} written-answer, ${s.objective} multiple choice or other objective${s.withOptions ? ` (${s.withOptions} with answer options)` : ""}${s.empty ? `, ${s.empty} empty` : ""}. Question types: ${types}${s.truncated ? " (stopped after the first 5,000 per pack)" : ""}.`;
}

export interface PickResult {
  question: QuestionInput | null;
  /** Plain-words note for the screen, e.g. "No written questions in CBSE Grade 9 Science — the AI set one from the chapter notes." */
  note: string;
  /** What was looked at (for the "does the CMS have enough?" check). */
  looked: ScanSummary;
}

/**
 * Random written-answer question from the chosen scopes and kinds. Looks through every question of
 * up to 8 content packs (in random order); when none fits, the AI sets one from a chapter's notes.
 */
export async function pickRandomQuestion(businessAccountId: string, settings: AnswerCheckSettings, ai: AnswerCheckAi | null, rand: () => number = Math.random, exclude: Set<string> = new Set(), only?: ScopePick & { chapter?: string }): Promise<PickResult> {
  const looked = emptyScanSummary();
  const cfg = await accountContentConfig(businessAccountId);
  if (!cfg) return { question: null, note: "Account not found.", looked };
  const all = await listSyncedScopeMetadata(businessAccountId);
  // A class / subject / chapter chosen on the page wins over the Settings list.
  const rows = shuffle(matchingScopeRows(all, only ? [only] : settings.scopes), rand);
  const chapter = only?.chapter || undefined;
  if (!rows.length) {
    return { question: null, note: all.length ? "None of the chosen classes and subjects has content. Change them in Settings." : "This account has no curriculum content yet.", looked };
  }
  // Prefer packs with more written questions left: try every chosen pack before giving up.
  for (const scope of rows.slice(0, exclude.size ? 30 : 8)) {
    const candidates = await scanPackQuestions(cfg, businessAccountId, scope, { chapter }, settings, looked);
    const fits = candidates.filter(q => (!q.questionKind || settings.questionKinds.includes(q.questionKind)) && !exclude.has(q.questionKey));
    if (fits.length) return { question: fits[Math.floor(rand() * fits.length)], note: "", looked };
  }
  const where = chapter ? `the chapter "${chapter}"` : "the chosen classes and subjects";
  if (!ai) return { question: null, note: `No written-answer questions found in ${where}. ${describeScan(looked, where)}`, looked };

  // Fall back: the AI sets a question from one chapter's notes.
  for (const scope of rows.slice(0, 4)) {
    const first = await readChunks(cfg, businessAccountId, { cpId: scope.cpId, contentType: "note", chapter, page: 1, pageSize: 1 });
    if (!first.total) continue;
    const page = 1 + Math.floor(rand() * Math.max(1, Math.ceil(first.total / 3)));
    const notes = await readChunks(cfg, businessAccountId, { cpId: scope.cpId, contentType: "note", chapter, page, pageSize: 3 });
    if (!notes.items.length) continue;
    const notesChapter = notes.items[0].chapter;
    const text = notes.items.filter(n => n.chapter === notesChapter).map(n => n.contentText).join("\n\n");
    const kind = settings.questionKinds[Math.floor(rand() * settings.questionKinds.length)];
    const maxMarks = suggestMaxMarks(kind, "", settings);
    const reply = await ai.json({
      model: ANSWER_CHECK_MODEL,
      system: QUESTION_FROM_NOTES_SYSTEM,
      user: questionFromNotesUserText({ ...scope, chapter: notesChapter }, kind, maxMarks, text),
      maxTokens: 1500,
      temperature: 0.7,
    });
    const q = parseQuestionFromNotes(reply);
    if (!q) continue;
    return {
      question: {
        questionKey: customQuestionKey(q.question, "gen"),
        source: "generated",
        questionText: q.question,
        modelAnswer: q.modelAnswer,
        questionKind: q.questionKind || kind,
        board: scope.board, medium: scope.medium, grade: scope.grade, subject: scope.subject, chapter: notesChapter,
        maxMarks,
      },
      note: `No written-answer question was found, so the AI set one from the chapter notes. ${describeScan(looked, `${scope.board} ${scope.grade} ${scope.subject}`)}`,
      looked,
    };
  }
  return { question: null, note: `No written-answer questions or notes found in ${where}. ${describeScan(looked, where)}`, looked };
}

/** Most written-answer questions listed from one search. */
export const MAX_SEARCH_RESULTS = 200;

/**
 * Written-answer questions of one class and subject (optionally one chapter, optionally matching
 * words): every question of its packs is looked at, and what was seen is summed up.
 */
export async function searchQuestions(businessAccountId: string, scope: ScopePick & { chapter?: string }, q: string, settings: AnswerCheckSettings): Promise<{ results: QuestionInput[]; looked: ScanSummary; summary: string }> {
  const looked = emptyScanSummary();
  const cfg = await accountContentConfig(businessAccountId);
  if (!cfg) return { results: [], looked, summary: "Account not found." };
  const rows = matchingScopeRows(await listSyncedScopeMetadata(businessAccountId), [scope]);
  const results: QuestionInput[] = [];
  for (const row of rows.slice(0, 10)) {
    for (const question of await scanPackQuestions(cfg, businessAccountId, row, { chapter: scope.chapter, q }, settings, looked)) {
      if (!results.some(o => o.questionKey === question.questionKey)) results.push(question);
    }
  }
  const where = [scope.subject || `${scope.board} ${scope.grade}`, scope.chapter ? `"${scope.chapter}"` : null].filter(Boolean).join(" › ") + (q.trim() ? ` matching "${q.trim()}"` : "");
  return { results: results.slice(0, MAX_SEARCH_RESULTS), looked, summary: rows.length ? describeScan(looked, where) : "No synced content pack matches this class and subject." };
}


/** Several different random questions for a paper (fewer when the content runs out). */
export async function pickRandomQuestions(businessAccountId: string, settings: AnswerCheckSettings, ai: AnswerCheckAi | null, count: number, rand: () => number = Math.random, only?: ScopePick & { chapter?: string }): Promise<{ questions: QuestionInput[]; notes: string[] }> {
  const questions: QuestionInput[] = [];
  const notes: string[] = [];
  for (let tries = 0; questions.length < count && tries < count * 3; tries++) {
    const pick = await pickRandomQuestion(businessAccountId, settings, ai, rand, new Set(questions.map(q => q.questionKey)), only);
    if (!pick.question) { if (pick.note && !notes.includes(pick.note)) notes.push(pick.note); if (!ai) break; continue; }
    if (questions.some(q => q.questionKey === pick.question!.questionKey || q.questionText === pick.question!.questionText)) continue;
    questions.push(pick.question);
    if (pick.note && !notes.includes(pick.note)) notes.push(pick.note);
  }
  return { questions, notes };
}
