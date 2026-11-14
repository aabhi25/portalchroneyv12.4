import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { businessAccounts } from "@shared/schema";
import { subjectKindOf, suggestMaxMarks, type AnswerCheckSettings, type QuestionKind, type ScopePick } from "@shared/answerCheck";
import { getTopscholarConfig, type TopscholarConfig } from "../topscholar/config";
import { getChunks, type ChunkPage, type ChunkQueryOptions, type ContentChunkItem } from "../topscholar/contentReader";
import { getMongoChunks } from "../topscholar/mongoContentReader";
import { listStoredCurriculumScopes, type StoredCurriculumScope } from "../topscholar/testerContentScopes";
import { htmlToText } from "../topscholar/htmlContent";
import { ANSWER_CHECK_MODEL, type AnswerCheckAi } from "./ai";
import { guessQuestionKind, isObjectiveQuestion, parseQuestionFromNotes, QUESTION_FROM_NOTES_SYSTEM, questionFromNotesUserText } from "./prompts";

/**
 * Answer checking pilot — questions from the account's own curriculum (Top Scholar's synced
 * CMS content): the scopes it has, a search, and the "Random question" button, which picks a
 * written-answer question (never multiple choice) from the chosen scopes and question kinds.
 * When a scope has no written-answer questions, the AI sets one from a chapter's notes.
 */

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
  const cfg = await accountContentConfig(businessAccountId);
  if (!cfg) return [];
  const rows = await listStoredCurriculumScopes(cfg, businessAccountId);
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

export interface PickResult {
  question: QuestionInput | null;
  /** Plain-words note for the screen, e.g. "No written questions in CBSE Grade 9 Science — the AI set one from the chapter notes." */
  note: string;
  /** Written-answer questions seen while looking (for the "does the CMS have enough?" check). */
  looked: { packs: number; questions: number; writtenQuestions: number };
}

/**
 * Random written-answer question from the chosen scopes and kinds. Tries up to 8 content packs,
 * 40 questions from a random spot in each; when none fits, the AI sets one from a chapter's notes.
 */
export async function pickRandomQuestion(businessAccountId: string, settings: AnswerCheckSettings, ai: AnswerCheckAi | null, rand: () => number = Math.random, exclude: Set<string> = new Set()): Promise<PickResult> {
  const looked = { packs: 0, questions: 0, writtenQuestions: 0 };
  const cfg = await accountContentConfig(businessAccountId);
  if (!cfg) return { question: null, note: "Account not found.", looked };
  const all = await listStoredCurriculumScopes(cfg, businessAccountId);
  const rows = shuffle(matchingScopeRows(all, settings.scopes), rand);
  if (!rows.length) {
    return { question: null, note: all.length ? "None of the chosen classes and subjects has content. Change them in Settings." : "This account has no curriculum content yet.", looked };
  }
  // Prefer packs with more written questions left: try every chosen pack before giving up.
  for (const scope of rows.slice(0, exclude.size ? 30 : 8)) {
    looked.packs++;
    const first = await readChunks(cfg, businessAccountId, { cpId: scope.cpId, contentType: "question", page: 1, pageSize: 1 });
    if (!first.total) continue;
    const pageSize = 40;
    const pages = Math.max(1, Math.ceil(first.total / pageSize));
    const page = 1 + Math.floor(rand() * pages);
    const batch = await readChunks(cfg, businessAccountId, { cpId: scope.cpId, contentType: "question", page, pageSize });
    looked.questions += batch.items.length;
    const candidates = batch.items.map(c => questionFromChunk(c, scope, settings)).filter((q): q is QuestionInput => !!q);
    looked.writtenQuestions += candidates.length;
    const fits = candidates.filter(q => (!q.questionKind || settings.questionKinds.includes(q.questionKind)) && !exclude.has(q.questionKey));
    if (fits.length) return { question: fits[Math.floor(rand() * fits.length)], note: "", looked };
  }
  if (!ai) return { question: null, note: "No written-answer questions found in the chosen classes and subjects.", looked };

  // Fall back: the AI sets a question from one chapter's notes.
  for (const scope of rows.slice(0, 4)) {
    const first = await readChunks(cfg, businessAccountId, { cpId: scope.cpId, contentType: "note", page: 1, pageSize: 1 });
    if (!first.total) continue;
    const page = 1 + Math.floor(rand() * Math.max(1, Math.ceil(first.total / 3)));
    const notes = await readChunks(cfg, businessAccountId, { cpId: scope.cpId, contentType: "note", page, pageSize: 3 });
    if (!notes.items.length) continue;
    const chapter = notes.items[0].chapter;
    const text = notes.items.filter(n => n.chapter === chapter).map(n => n.contentText).join("\n\n");
    const kind = settings.questionKinds[Math.floor(rand() * settings.questionKinds.length)];
    const maxMarks = suggestMaxMarks(kind, "", settings);
    const reply = await ai.json({
      model: ANSWER_CHECK_MODEL,
      system: QUESTION_FROM_NOTES_SYSTEM,
      user: questionFromNotesUserText({ ...scope, chapter }, kind, maxMarks, text),
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
        board: scope.board, medium: scope.medium, grade: scope.grade, subject: scope.subject, chapter,
        maxMarks,
      },
      note: `No written-answer question was found in ${scope.board} ${scope.grade} ${scope.subject}, so the AI set one from the chapter notes.`,
      looked,
    };
  }
  return { question: null, note: "No written-answer questions or chapter notes found in the chosen classes and subjects.", looked };
}

/** Written-answer questions matching a search, from one class and subject (first 30). */
export async function searchQuestions(businessAccountId: string, scope: ScopePick, q: string, settings: AnswerCheckSettings): Promise<QuestionInput[]> {
  const cfg = await accountContentConfig(businessAccountId);
  if (!cfg) return [];
  const rows = matchingScopeRows(await listStoredCurriculumScopes(cfg, businessAccountId), [scope]);
  const out: QuestionInput[] = [];
  for (const row of rows.slice(0, 6)) {
    const page = await readChunks(cfg, businessAccountId, { cpId: row.cpId, contentType: "question", q: q.trim() || undefined, page: 1, pageSize: 60 });
    for (const c of page.items) {
      const question = questionFromChunk(c, row, settings);
      if (question && !out.some(o => o.questionKey === question.questionKey)) out.push(question);
      if (out.length >= 30) return out;
    }
  }
  return out;
}


/** Several different random questions for a paper (fewer when the content runs out). */
export async function pickRandomQuestions(businessAccountId: string, settings: AnswerCheckSettings, ai: AnswerCheckAi | null, count: number, rand: () => number = Math.random): Promise<{ questions: QuestionInput[]; notes: string[] }> {
  const questions: QuestionInput[] = [];
  const notes: string[] = [];
  for (let tries = 0; questions.length < count && tries < count * 3; tries++) {
    const pick = await pickRandomQuestion(businessAccountId, settings, ai, rand, new Set(questions.map(q => q.questionKey)));
    if (!pick.question) { if (pick.note && !notes.includes(pick.note)) notes.push(pick.note); if (!ai) break; continue; }
    if (questions.some(q => q.questionKey === pick.question!.questionKey || q.questionText === pick.question!.questionText)) continue;
    questions.push(pick.question);
    if (pick.note && !notes.includes(pick.note)) notes.push(pick.note);
  }
  return { questions, notes };
}
