/**
 * AI Tutor — a question the student asks in the middle of a lesson, answered the way a teacher
 * would: a few spoken lines while writing / drawing on a fresh page, from the chapter's own
 * content only. The lesson then carries on from where it stopped (the runner does that).
 *
 * Content: the current part's sources plus the passages that share the most words with the
 * question. A question outside the chapter gets a kind one-liner, not an answer from elsewhere.
 */
import { z } from "zod";
import { emptyBoard } from "@shared/tutorBoard";
import { sanitizeOps } from "./boardOps";
import type { LessonPack } from "./lessonPack";
import { BOARD_OPS_DOC, languageRule, parseJson, rawLine, sourceBlock, type Complete, type LessonOutline, type TutorLanguage, type TutorLine } from "./lessonPlanner";

const doubtSchema = z.object({
  onTopic: z.boolean().optional().default(true),
  lines: z.array(rawLine).min(1).max(7),
});

const DOUBT_SYSTEM = (language: TutorLanguage) => `You are a warm school tutor in the middle of teaching a lesson at a board. The student just said something.
Reply the way a real teacher would, out loud, writing on a fresh page of the board as you explain.
Use ONLY the facts in SOURCES. Never use outside knowledge.
Return JSON: {"onTopic": boolean, "lines": [{"say": string, "ops": [op]}]}.
- A question about this chapter: 2 to 6 lines. Answer it directly and simply, with a small example if it helps. When you draw, the first line starts with {"op":"clear"} and a short title (the question in a few words).
- A question the SOURCES cannot answer, or not about this chapter: onTopic false, ONE kind line saying that is not part of this chapter (no ops).
- A remark or feeling ("wow", "this is hard", "I'm tired"): ONE short encouraging line (no ops).
- Never say you will continue or ask whether to continue — the lesson resumes by itself right after.
- Each "say" is ONE spoken sentence (at most 30 words): no markdown, no TeX, formulas in words.
${languageRule(language)}
${BOARD_OPS_DOC}`;

const STOP = new Set("the a an is are was were of to in on for and or but what why how which who when where does do did can could would should will i me my you your it this that these those with from by as at be about please explain tell sir maam ma'am".split(" "));
const WORD = new RegExp("[\\p{L}\\p{M}\\p{N}]{3,}", "gu");
const words = (s: string) => (s.toLowerCase().match(WORD) || []).filter((w) => !STOP.has(w));

/** The sources most likely to answer the question: the part's own, then the best word matches. */
export function doubtSourceIds(pack: LessonPack, question: string, partSourceIds: string[], extra = 3): string[] {
  const q = new Set(words(question));
  const scored = pack.sources
    .filter((s) => !partSourceIds.includes(s.id))
    .map((s) => {
      const w = words(`${s.title || ""} ${s.concept || ""} ${s.text}`);
      let hits = 0;
      for (const x of Array.from(new Set(w))) if (q.has(x)) hits++;
      return { id: s.id, hits };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, extra)
    .map((s) => s.id);
  return [...partSourceIds, ...scored];
}

export interface DoubtInput {
  pack: LessonPack;
  outline: LessonOutline | null;
  /** The part the student was on (-1 = plan / not started). */
  part: number;
  question: string;
  /** What the tutor said just before (last few lines). */
  recentLines: string[];
  language: TutorLanguage;
  complete: Complete;
}

const FALLBACK: Record<TutorLanguage, string> = {
  en: "Sorry, I couldn't work that one out just now — ask me again in a moment.",
  hinglish: "Sorry, abhi main yeh theek se samjha nahi paaya — thodi der mein phir se poochna.",
  hi: "माफ़ कीजिए, अभी मैं इसे ठीक से समझा नहीं पाया — थोड़ी देर में फिर से पूछिए।",
};

/** Lines to say (and draw) for the student's question. Never throws: falls back to one line. */
export async function answerDoubt(input: DoubtInput): Promise<{ lines: TutorLine[]; onTopic: boolean }> {
  const { pack, outline, part, question, language, complete } = input;
  const section = outline && part >= 0 ? outline.sections[part] : undefined;
  const ids = doubtSourceIds(pack, question, section?.sourceIds ?? []);
  const mediaIds = section?.mediaIds ?? [];
  const user = [
    `CHAPTER: ${pack.chapter}`,
    outline ? `LESSON: ${outline.title}${section ? ` — now teaching: ${section.title}` : ""}` : "",
    input.recentLines.length ? `YOU JUST SAID: ${input.recentLines.slice(-3).join(" ")}` : "",
    `STUDENT SAID: ${question.slice(0, 400)}`,
    `SOURCES:\n${sourceBlock(pack, ids.length ? ids : [], 6000)}`,
    `FIGURES you may show:\n${mediaIds.map((id) => { const m = pack.media.find((x) => x.id === id); return `[${id}] ${m?.caption || m?.concept || "figure"}`; }).join("\n") || "(none — do not use image ops)"}`,
  ].filter(Boolean).join("\n\n");
  const media = (id: string) => {
    if (!mediaIds.includes(id)) return null;
    const m = pack.media.find((x) => x.id === id);
    return m ? { src: m.src, caption: m.caption } : null;
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try { raw = parseJson(await complete(DOUBT_SYSTEM(language), user)); } catch { continue; }
    const parsed = doubtSchema.safeParse(raw);
    if (!parsed.success) continue;
    let board = emptyBoard();
    const lines: TutorLine[] = parsed.data.lines.slice(0, 6).map((l) => {
      const r = sanitizeOps(l.ops, board, media, 4);
      board = r.board;
      return { say: l.say.replace(/\s+/g, " ").trim(), ops: r.ops };
    });
    // Drawing goes on a fresh page (the lesson's page comes back when it resumes).
    if (lines.some((l) => l.ops.length) && lines[0].ops[0]?.op !== "clear") lines[0] = { ...lines[0], ops: [{ op: "clear" }, ...lines[0].ops] };
    return { lines, onTopic: parsed.data.onTopic };
  }
  return { lines: [{ say: FALLBACK[language], ops: [] }], onTopic: false };
}
