/**
 * AI Tutor — one entry point to get a chapter's lesson: resolves the student's scope to content
 * packages, builds (and briefly memoises) the lesson pack, and returns cached plans.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { businessAccounts } from "@shared/schema";
import { getTopscholarConfig } from "../topscholar/config";
import { resolveCpIdsForScope } from "../topscholar/scopeResolver";
import { buildLessonPack, isUsableCheck, normChapter, type LessonPack } from "./lessonPack";
import { getOutline, getSection, openAiComplete, type Complete, type LessonOutline, type SectionScript, type TutorLanguage } from "./lessonPlanner";

export interface TutorScope { board?: string | null; medium?: string | null; grade?: string | null; subject?: string | null; chapter: string }

export class TutorLessonError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const PACK_TTL_MS = 5 * 60_000;
const packs = new Map<string, { at: number; pack: Promise<LessonPack> }>();

export async function lessonContext(businessAccountId: string, scope: TutorScope, opts: { cpIds?: string[] } = {}): Promise<{ pack: LessonPack; complete: Complete }> {
  const chapter = String(scope.chapter || "").trim();
  if (!chapter) throw new TutorLessonError("Pick a chapter first.");
  const [account] = await db.select().from(businessAccounts).where(eq(businessAccounts.id, businessAccountId)).limit(1);
  if (!account) throw new TutorLessonError("Business account not found", 404);
  if (!account.openaiApiKey) throw new TutorLessonError("This account has no OpenAI key, which the tutor needs.");
  const cfg = getTopscholarConfig(account);
  const cpIds = opts.cpIds?.length ? opts.cpIds : await resolveCpIdsForScope(businessAccountId, scope);
  if (!cpIds.length) throw new TutorLessonError("No synced content matches this board, medium, grade and subject.");

  const key = `${businessAccountId}|${[...cpIds].sort().join(",")}|${normChapter(chapter)}`;
  const hit = packs.get(key);
  let pack: Promise<LessonPack>;
  if (hit && Date.now() - hit.at < PACK_TTL_MS) pack = hit.pack;
  else {
    pack = buildLessonPack({ cfg, businessAccountId, cpIds, chapter });
    packs.set(key, { at: Date.now(), pack });
    pack.catch(() => packs.delete(key));
    if (packs.size > 200) packs.delete(packs.keys().next().value as string);
  }
  const p = await pack;
  if (!p.sources.length) throw new TutorLessonError(`"${chapter}" has no synced notes or transcripts yet, so there is nothing to teach from.`);
  return { pack: p, complete: openAiComplete(account.openaiApiKey, businessAccountId) };
}

export function packSummary(pack: LessonPack) {
  return {
    chapter: pack.chapter,
    sources: pack.sources.length,
    questions: pack.questions.length,
    usableChecks: pack.questions.filter(isUsableCheck).length,
    figures: pack.media.length,
  };
}

export async function lessonOutline(businessAccountId: string, scope: TutorScope, language: TutorLanguage) {
  const { pack, complete } = await lessonContext(businessAccountId, scope);
  const outline = await getOutline(pack, language, complete);
  return { pack, outline };
}

export async function lessonSection(businessAccountId: string, scope: TutorScope, language: TutorLanguage, sectionIndex: number): Promise<{ outline: LessonOutline; section: SectionScript }> {
  const { pack, complete } = await lessonContext(businessAccountId, scope);
  const outline = await getOutline(pack, language, complete);
  if (sectionIndex < 0 || sectionIndex >= outline.sections.length) throw new TutorLessonError("No such section.");
  return { outline, section: await getSection(pack, outline, sectionIndex, language, complete) };
}
