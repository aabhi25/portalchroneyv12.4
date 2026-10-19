/**
 * AI Tutor — sets up a tutoring session for a voice connection: is the tutor on for this
 * account, which chapter (from the student's signed launch scope), which language, and the
 * database-backed lesson source and minute counter the runner uses.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { tutorSessions } from "@shared/schema";
import { lessonContext, TutorLessonError, type TutorScope } from "./lessonService";
import { getOutline, getSection, type LessonOutline, type TutorLanguage } from "./lessonPlanner";
import { getTutorSettings } from "./settings";
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
}

export class TutorUnavailableError extends Error {}

const LANGS = new Set<TutorLanguage>(["en", "hi", "hinglish"]);

/** Hindi medium → Hindi; a Hindi voice session → Hinglish (as students speak); else English. */
export function tutorLanguageFor(req: Pick<VoiceTutorRequest, "language" | "voiceLanguage" | "scope">): TutorLanguage {
  if (req.language && LANGS.has(req.language as TutorLanguage)) return req.language as TutorLanguage;
  if (/hindi/i.test(req.scope?.medium || "")) return "hi";
  if (req.voiceLanguage === "hi" || req.voiceLanguage === "hinglish") return "hinglish";
  return "en";
}

export async function prepareVoiceTutor(req: VoiceTutorRequest): Promise<{ chapter: string; language: TutorLanguage; lessons: TutorLessonSource; store: TutorStore }> {
  const settings = await getTutorSettings(req.businessAccountId);
  if (!settings.enabled) throw new TutorUnavailableError("The AI tutor is not switched on for this account.");
  const chapter = String(req.scope?.chapter || "").trim();
  if (!req.scope || !chapter) throw new TutorUnavailableError("Open a chapter first — the tutor teaches one chapter at a time.");
  const language = tutorLanguageFor(req);
  const scope = req.scope;
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
  };

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
        kind: "lesson",
      }).returning({ id: tutorSessions.id });
      return row?.id ?? null;
    },
    sessionEnded: async (id, info) => {
      if (!id) return;
      await db.update(tutorSessions).set({
        endedAt: new Date(),
        secondsActive: info.secondsActive,
        progress: info.progress,
        endReason: info.reason,
      }).where(eq(tutorSessions.id, id));
    },
  };
  return { chapter, language, lessons, store };
}
