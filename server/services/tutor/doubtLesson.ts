/**
 * AI Tutor — "Teach me this on the board" for a doubt the student raised in chat: a short lesson
 * on that one doubt, starting from the written answer they already got (which came from the
 * curriculum), with the chapter's matching passages, figures and a quick check when one fits.
 */
import { z } from "zod";
import { markdownToSpeech } from "../voice/speechText";
import type { LessonPack } from "./lessonPack";
import { isUsableCheck } from "./lessonPack";
import { doubtSourceIds, words } from "./doubtAnswerer";
import {
  BOARD_OPS_DOC, checksFor, languageRule, parseJson, sourceBlock, validateSection,
  type Complete, type SectionScript, type TutorLanguage,
} from "./lessonPlanner";

const DOUBT_LESSON_SYSTEM = (language: TutorLanguage) => `A school student raised a doubt and has already read a written answer to it (ANSWER). Now teach that doubt at the board like a great teacher: start from what they asked, explain it step by step with a small example, writing and drawing while you speak, so they really understand it.
Use ONLY the facts in ANSWER and SOURCES. If something is not there, do not teach it.
Return JSON: {"title": string, "lines": [{"say": string, "ops": [op]}], "simpler": [{"say": string, "ops": [op]}]}.
- title: the doubt in a few words (at most 60 characters).
- lines: 5 to 10. Each "say" is ONE spoken sentence (at most 30 words), said naturally out loud: no markdown, no TeX, formulas in words. The first line starts with {"op":"clear"} and the title. The last line sums up the idea in one sentence (no question, no "shall we continue").
- ops are drawn on the board WHILE that sentence is said (0 to 4 per line). Most lines write or draw something; every formula and maths step is its own math op in TeX — never a write op with "sqrt(", "^" or "x1". Draw when the idea is visual (geometry for shapes, flow for processes, table for comparisons) or show a listed FIGURE, and highlight parts as you talk about them.
- simpler: 3 to 5 lines explaining the hardest part again in a much simpler way, with an everyday analogy (its first line does not clear the board).
- Begin the way a real teacher would; do not start with "Good question" or a stock phrase.
${languageRule(language)}
${BOARD_OPS_DOC}`;

const titleSchema = z.string().trim().min(1).max(80);

/** The chapter pack (when known) plus the answer the student read, as the lesson's first source. */
export function doubtPack(base: LessonPack | null, chatAnswer: string, businessAccountId: string): LessonPack {
  const answer = markdownToSpeech(chatAnswer).slice(0, 3000);
  return {
    businessAccountId,
    cpIds: base?.cpIds ?? [],
    chapter: base?.chapter ?? "",
    chapterNorm: base?.chapterNorm ?? "",
    versionKey: base?.versionKey ?? "doubt",
    cpIdsHash: base?.cpIdsHash ?? "doubt",
    sources: [{ id: "ans", type: "note", title: "The answer the student read", concept: null, text: answer }, ...(base?.sources ?? [])],
    questions: base?.questions ?? [],
    media: base?.media ?? [],
  };
}

/** The question-bank question that best fits the doubt (shares at least two words), if any. */
export function bestCheckFor(pack: LessonPack, text: string): string | null {
  const want = new Set(words(text));
  let best: { id: string; hits: number } | null = null;
  for (const q of pack.questions) {
    if (!isUsableCheck(q)) continue;
    const hits = Array.from(new Set(words(`${q.text} ${q.concept || ""}`))).filter((w) => want.has(w)).length;
    if (hits >= 2 && (!best || hits > best.hits)) best = { id: q.id, hits };
  }
  return best?.id ?? null;
}

export async function planDoubtLesson(input: {
  pack: LessonPack; question: string; language: TutorLanguage; complete: Complete;
}): Promise<{ title: string; script: SectionScript }> {
  const { pack, question, language, complete } = input;
  const ids = ["ans", ...doubtSourceIds(pack, question, [], 3).filter((id) => id !== "ans")];
  const q = new Set(words(question));
  const mediaIds = pack.media
    .filter((m) => words(`${m.caption || ""} ${m.concept || ""}`).some((w) => q.has(w)))
    .slice(0, 3)
    .map((m) => m.id);
  const user = [
    pack.chapter ? `CHAPTER: ${pack.chapter}` : "",
    `STUDENT'S DOUBT: ${question.slice(0, 600)}`,
    `ANSWER and SOURCES:\n${sourceBlock(pack, ids, 7000)}`,
    `FIGURES you may show:\n${mediaIds.map((id) => { const m = pack.media.find((x) => x.id === id); return `[${id}] ${m?.caption || m?.concept || "figure"}`; }).join("\n") || "(none — do not use image ops)"}`,
  ].filter(Boolean).join("\n\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: any;
    try { raw = parseJson(await complete(DOUBT_LESSON_SYSTEM(language), user)); } catch { continue; }
    const v = validateSection(raw, pack, mediaIds);
    if (!v || v.script.lines.length < 2) continue;
    const t = titleSchema.safeParse(raw?.title);
    const checkId = bestCheckFor(pack, `${question} ${raw?.title || ""}`);
    return {
      title: t.success ? t.data : question.slice(0, 60),
      script: { ...v.script, checks: checkId ? checksFor(pack.questions, [checkId]) : [] },
    };
  }
  throw new Error("Couldn't prepare an explanation of this doubt. Try again in a moment.");
}
