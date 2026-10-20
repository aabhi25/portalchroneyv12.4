/**
 * AI Tutor — sets up a tutoring session for a voice connection: is the tutor on for this
 * account, which chapter (from the student's signed launch scope), which language, and the
 * database-backed lesson source and minute counter the runner uses.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import { businessAccounts, tutorSessions } from "@shared/schema";
import { lessonContext, TutorLessonError, type TutorScope } from "./lessonService";
import { getOutline, getSection, openAiComplete, type Complete, type LessonOutline, type SectionScript, type TutorLanguage } from "./lessonPlanner";
import { answerDoubt } from "./doubtAnswerer";
import { doubtPack, planDoubtLesson } from "./doubtLesson";
import type { LessonPack } from "./lessonPack";
import { getTutorSettings, tutorVoiceFor } from "./settings";
import { addUsage, remainingSeconds, secondsUsedToday, tutorStudentKey } from "./usage";
import type { TutorLessonSource, TutorStore } from "./tutorRunner";

export interface VoiceTutorRequest {
  businessAccountId: string;
  conversationId: string;
  visitorId: string;
  scope: (TutorScope & { studentId?: string | null }) | null;
  cpIds?: string[] | null;
  /** The language the widget asked for; else from the medium / the voice language. */
  language?: string | null;
  voiceLanguage?: string | null;
  mode: "voice" | "video";
  /** Start from the plan even when this student stopped part-way last time. */
  fromStart?: boolean;
  /** "doubt": teach one doubt from a doubt session (the question and the chat answer it got). */
  kind?: "lesson" | "doubt";
  doubt?: { question: string; answer: string } | null;
}

/** A lesson this student left part-way within this many days is continued, not restarted. */
const CONTINUE_WITHIN_DAYS = 14;

export class TutorUnavailableError extends Error {}

const LANGS = new Set<TutorLanguage>(["en", "hi", "hinglish"]);

/** Hindi medium → Hindi; a Hindi voice session → Hinglish (as students speak); else English. */
export function tutorLanguageFor(req: Pick<VoiceTutorRequest, "language" | "voiceLanguage" | "scope">): TutorLanguage {
  if (req.language && LANGS.has(req.language as TutorLanguage)) return req.language as TutorLanguage;
  if (/hindi/i.test(req.scope?.medium || "")) return "hi";
  if (req.voiceLanguage === "hi" || req.voiceLanguage === "hinglish") return "hinglish";
  return "en";
}

/** The teacher's voice for a lesson: an ElevenLabs voice (with the account's key) or an OpenAI one. */
export interface TutorVoice { elevenlabsApiKey?: string; elevenlabsVoiceId?: string; openaiVoice?: string }

export async function prepareVoiceTutor(req: VoiceTutorRequest): Promise<{
  chapter: string; language: TutorLanguage; lessons: TutorLessonSource; store: TutorStore;
  continueFrom: { part: number; title: string | null } | null;
  /** null = the widget's voice. */
  voice: TutorVoice | null;
  teacherName: string | null;
}> {
  const settings = await getTutorSettings(req.businessAccountId);
  if (!settings.enabled) throw new TutorUnavailableError("The AI tutor is not switched on for this account.");
  const doubtMode = req.kind === "doubt";
  if (doubtMode) {
    if (!settings.doubtTeachingEnabled) throw new TutorUnavailableError("Explaining doubts on the board is not switched on for this account.");
    if (!req.doubt?.question?.trim() || !req.doubt?.answer?.trim()) throw new TutorUnavailableError("There is no doubt to explain yet.");
  }
  const chapter = String(req.scope?.chapter || "").trim();
  if (!doubtMode && (!req.scope || !chapter)) throw new TutorUnavailableError("Open a chapter first — the tutor teaches one chapter at a time.");
  const language = tutorLanguageFor(req);
  const scope = req.scope ?? { chapter: "" };
  const cpIds = req.cpIds?.length ? req.cpIds : undefined;

  // The pack is built lazily (the runner says hello meanwhile); later calls reuse it.
  let ctx: ReturnType<typeof lessonContext> | null = null;
  const context = () => (ctx ||= lessonContext(req.businessAccountId, { ...scope, chapter }, { cpIds }));
  let outline: Promise<LessonOutline> | null = null;
  const lessons: TutorLessonSource = {
    outline: () => (outline ||= context().then(({ pack, complete }) => getOutline(pack, language, complete))),
    section: async (index) => {
      const { pack, complete } = await context();
      const o = await lessons.outline();
      if (index < 0 || index >= o.sections.length) throw new TutorLessonError("No such section.");
      return getSection(pack, o, index, language, complete);
    },
    answerDoubt: async (question, { part, recentLines, replyTo }) => {
      const { pack, complete } = await context();
      const o = await lessons.outline().catch(() => null);
      return answerDoubt({ pack, outline: o, part, question, recentLines, replyTo, language, complete });
    },
  };

  // A doubt: one short lesson planned from the doubt + the chat answer (+ the chapter, if known).
  if (doubtMode) {
    let plan: Promise<{ title: string; script: SectionScript; pack: LessonPack; complete: Complete }> | null = null;
    const doubtPlan = () => (plan ||= (async () => {
      const base = chapter ? await context().then((c) => c.pack).catch(() => null) : null;
      const [acc] = await db.select({ key: businessAccounts.openaiApiKey }).from(businessAccounts).where(eq(businessAccounts.id, req.businessAccountId)).limit(1);
      if (!acc?.key) throw new TutorLessonError("This account has no OpenAI key, which the tutor needs.");
      const complete = openAiComplete(acc.key, req.businessAccountId);
      const pack = doubtPack(base, req.doubt!.answer, req.businessAccountId);
      const planned = await planDoubtLesson({ pack, question: req.doubt!.question, language, complete });
      return { ...planned, pack, complete };
    })());
    const outlineOf = (title: string): LessonOutline => ({ title, intro: [], sections: [{ id: "d1", title, goal: "", sourceIds: ["ans"], questionIds: [], mediaIds: [] }], recap: [] });
    lessons.outline = async () => outlineOf((await doubtPlan()).title);
    lessons.section = async (index) => {
      if (index !== 0) throw new TutorLessonError("No such section.");
      return (await doubtPlan()).script;
    };
    lessons.answerDoubt = async (question, { recentLines, replyTo }) => {
      const p = await doubtPlan();
      return answerDoubt({ pack: p.pack, outline: outlineOf(p.title), part: 0, question, recentLines, replyTo, language, complete: p.complete });
    };
  }

  const studentKey = tutorStudentKey(scope.studentId, req.visitorId);
  let packCpIds: string[] = cpIds ?? [];
  const store: TutorStore = {
    remainingSeconds: async () => remainingSeconds(settings.dailyMinutesPerStudent, await secondsUsedToday(req.businessAccountId, studentKey)),
    addUsage: async (seconds) => { if (seconds > 0) await addUsage(req.businessAccountId, studentKey, seconds); },
    sessionStarted: async () => {
      if (!packCpIds.length) packCpIds = await context().then(({ pack }) => pack.cpIds).catch(() => []);
      const [row] = await db.insert(tutorSessions).values({
        businessAccountId: req.businessAccountId,
        conversationId: req.conversationId,
        studentKey,
        cpIds: packCpIds,
        chapter,
        mode: req.mode,
        kind: doubtMode ? "doubts" : "lesson",
      }).returning({ id: tutorSessions.id });
      return row?.id ?? null;
    },
    sessionEnded: async (id, info) => {
      if (!id) return;
      await db.update(tutorSessions).set({
        endedAt: new Date(),
        secondsActive: info.secondsActive,
        progress: info.progress,
        checksCorrect: info.checksCorrect,
        checksTotal: info.checksTotal,
        endReason: info.reason,
      }).where(eq(tutorSessions.id, id));
    },
  };
  // Where this student got to last time on this chapter (a lesson they did not finish).
  let continueFrom: { part: number; title: string | null } | null = null;
  if (!req.fromStart && !doubtMode) {
    const [last] = await db.select({ progress: tutorSessions.progress, endReason: tutorSessions.endReason })
      .from(tutorSessions)
      .where(and(
        eq(tutorSessions.businessAccountId, req.businessAccountId),
        eq(tutorSessions.studentKey, studentKey),
        sql`lower(trim(${tutorSessions.chapter})) = ${chapter.toLowerCase()}`,
        gte(tutorSessions.startedAt, new Date(Date.now() - CONTINUE_WITHIN_DAYS * 24 * 3600_000)),
      ))
      .orderBy(desc(tutorSessions.startedAt))
      .limit(1)
      .catch(() => []);
    const part = Number((last?.progress as any)?.part);
    if (last && last.endReason !== "completed" && Number.isInteger(part) && part >= 0) {
      const title = (last.progress as any)?.title;
      continueFrom = { part, title: typeof title === "string" ? title : null };
    }
  }
  // The voice set for this lesson's language (accent), if any.
  let voice: TutorVoice | null = null;
  const selection = tutorVoiceFor(settings, language);
  if (selection?.startsWith("el:")) {
    const [acc] = await db.select({ key: businessAccounts.elevenlabsApiKey }).from(businessAccounts).where(eq(businessAccounts.id, req.businessAccountId)).limit(1);
    // Without an ElevenLabs key the widget's voice is used (the dialog says the key is needed).
    if (acc?.key) voice = { elevenlabsApiKey: acc.key, elevenlabsVoiceId: selection.slice(3) };
  } else if (selection) {
    voice = { openaiVoice: selection };
  }
  return { chapter, language, lessons, store, continueFrom, voice, teacherName: settings.teacherName?.trim() || null };
}
