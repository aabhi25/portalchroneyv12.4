/**
 * AI Tutor — a question the student asks in the middle of a lesson, answered the way a teacher
 * would: a few spoken lines while writing / drawing on a fresh page, from the chapter's own
 * content only. The lesson then carries on from where it stopped (the runner does that).
 *
 * Content: the current part's sources plus the passages that share the most words with the
 * question. A question outside the chapter gets a kind one-liner, not an answer from elsewhere.
 */
import { z } from "zod";
import { emptyBoard, type BoardOp } from "@shared/tutorBoard";
import { sanitizeOps } from "./boardOps";
import type { LessonPack } from "./lessonPack";
import { BOARD_OPS_DOC, languageRule, parseJson, rawLine, sourceBlock, type Complete, type LessonOutline, type TutorLanguage, type TutorLine } from "./lessonPlanner";

const doubtSchema = z.object({
  onTopic: z.boolean().optional().default(true),
  /** The last line asks the student something: the tutor waits for their answer. */
  expectsReply: z.boolean().optional().default(false),
  lines: z.array(rawLine).min(1).max(7),
});

const DOUBT_SYSTEM = (language: TutorLanguage) => `You are a warm school tutor in the middle of teaching a lesson at a board. The student just said something.
Reply the way a real teacher would, out loud, writing on a fresh page of the board as you explain.
Use ONLY the facts in SOURCES. Never use outside knowledge.
Return JSON: {"onTopic": boolean, "expectsReply": boolean, "lines": [{"say": string, "ops": [op]}]}.
- A question about this chapter: 2 to 6 lines. Answer it directly and simply, with a small example if it helps.
- The student asks you to quiz / test them / ask them a question: ask ONE short question about what was just taught (from SOURCES), in 1–2 lines, and set expectsReply true. The LAST line SAYS the question itself (ending with "?") — the student only hears what you say — and writes it on the board (at most 100 characters). Do NOT answer it yourself.
- STUDENT IS ANSWERING is given: they are answering the question you asked. Say kindly whether they are right, then give the correct idea in 1–3 lines. expectsReply false.
- A question the SOURCES cannot answer, or not about this chapter: onTopic false, ONE kind line saying that is not part of this chapter.
- A remark or feeling ("wow", "this is hard", "I'm tired"): ONE short encouraging line.
- Always use the board: the first line starts with {"op":"clear"} and a short title (what you are answering, or "Your turn" for a question you ask), then write the key point — or your question — as you say it.
- Begin the way a real teacher would and vary it; do not start with "Good question" or any stock phrase, and never praise a question twice in a row.
- Never say you will continue or ask whether to continue — the lesson resumes by itself right after (except when you asked the student a question).
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
  /** The question the tutor asked, when the student is answering it. */
  replyTo?: string | null;
  language: TutorLanguage;
  complete: Complete;
}

const FALLBACK: Record<TutorLanguage, string> = {
  en: "Sorry, I couldn't work that one out just now — ask me again in a moment.",
  hinglish: "Sorry, abhi main yeh theek se samjha nahi paaya — thodi der mein phir se poochna.",
  hi: "माफ़ कीजिए, अभी मैं इसे ठीक से समझा नहीं पाया — थोड़ी देर में फिर से पूछिए।",
};

const BOARD_TITLE: Record<TutorLanguage, { answer: string; ask: string }> = {
  en: { answer: "Your question", ask: "Your turn" },
  hinglish: { answer: "Aapka sawaal", ask: "Aapki baari" },
  hi: { answer: "आपका सवाल", ask: "आपकी बारी" },
};
const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Lines to say (and draw) for the student's question. Never throws: falls back to one line. */
export async function answerDoubt(input: DoubtInput): Promise<{ lines: TutorLine[]; onTopic: boolean; expectsReply: boolean }> {
  const { pack, outline, part, question, language, complete } = input;
  const section = outline && part >= 0 ? outline.sections[part] : undefined;
  const ids = doubtSourceIds(pack, question, section?.sourceIds ?? []);
  const mediaIds = section?.mediaIds ?? [];
  const user = [
    `CHAPTER: ${pack.chapter}`,
    outline ? `LESSON: ${outline.title}${section ? ` — now teaching: ${section.title}` : ""}` : "",
    input.recentLines.length ? `YOU JUST SAID: ${input.recentLines.slice(-3).join(" ")}` : "",
    input.replyTo ? `YOU ASKED THE STUDENT: ${input.replyTo.slice(0, 300)}\nSTUDENT IS ANSWERING: ${question.slice(0, 400)}` : `STUDENT SAID: ${question.slice(0, 400)}`,
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
    let expectsReply = parsed.data.expectsReply && !input.replyTo;
    if (expectsReply) {
      // The question must be heard and seen: spoken as the last line, written on the board.
      const isQ = (t: string) => /[?？]\s*$/.test(t.trim());
      // (From the model's own text: a long board line has been shortened by now.)
      const boardQ = parsed.data.lines.flatMap((l) => l.ops as any[]).find((o) => o?.op === "write" && typeof o.text === "string" && /\?/.test(o.text)) as { text: string } | undefined;
      // A spoken question followed by filler ("Write your answer on the board."): the question ends it.
      let lastQ = -1;
      lines.forEach((l, i) => { if (isQ(l.say)) lastQ = i; });
      if (lastQ >= 0 && lastQ < lines.length - 1) lines.splice(lastQ + 1);
      if (!isQ(lines[lines.length - 1].say)) {
        const spoken = boardQ ? boardQ.text.replace(/^\s*(question|q|sawaal|सवाल)\s*[:.-]\s*/i, "").replace(/…$/, "").trim() : "";
        if (spoken && isQ(spoken)) lines.push({ say: spoken, ops: [] });
        else expectsReply = false; // no actual question: answer as usual and go on
      }
      if (expectsReply) {
        const q = lines[lines.length - 1];
        if (!boardQ && !lines.some((l) => l.ops.some((o) => o.op === "write" && /\?/.test(o.text)))) {
          q.ops = [...q.ops, { op: "write", id: "dq", text: clipText(q.say, 120), style: "body", color: "blue" }];
        }
        if (!lines.some((l) => l.ops.some((o) => o.op === "write" && o.style === "title"))) {
          lines[0] = { ...lines[0], ops: [{ op: "write", id: "dtitle", text: BOARD_TITLE[language].ask, style: "title", color: "blue" }, ...lines[0].ops.filter((o) => o.op !== "clear")] };
        }
      }
    }
    // Always something on the board, on a fresh page (the lesson's page comes back when it resumes):
    // the model forgot → a title and the key line (or the question it asked).
    if (!lines.some((l) => l.ops.length)) {
      const key = expectsReply ? lines[lines.length - 1] : lines[0];
      key.ops = [{ op: "write", id: "dkey", text: clipText(key.say, 120), style: "body", color: expectsReply ? "blue" : "ink" }];
      lines[0] = { ...lines[0], ops: [{ op: "write", id: "dtitle", text: expectsReply ? BOARD_TITLE[language].ask : BOARD_TITLE[language].answer, style: "title", color: "blue" }, ...(lines[0] === key ? key.ops : lines[0].ops)] };
    }
    if (lines[0].ops[0]?.op !== "clear") lines[0] = { ...lines[0], ops: [{ op: "clear" }, ...lines[0].ops] };
    return { lines, onTopic: parsed.data.onTopic, expectsReply };
  }
  return { lines: [{ say: FALLBACK[language], ops: [] }], onTopic: false, expectsReply: false };
}
