/**
 * AI Tutor — turns a chapter's lesson pack into a lesson a teacher would give.
 *
 *  A. Outline (one call): title, a spoken hello, 2–6 sections in teaching order (each citing
 *     the chapter sources it teaches from, the questions that check it and the figures that
 *     fit), and a short spoken recap.
 *  B. Section script (one call per section, made just before it is needed): spoken lines, each
 *     with the board ops drawn while it is said, plus a simpler re-explanation for "I didn't get
 *     it". Formulas are written as TeX on the board but said in words.
 *
 * Only the chapter's content is used, ids that don't exist are dropped, and the answer key of
 * every check comes from the question bank — never from the model. Plans are cached per
 * (account, packages, chapter, language, content version) and shared by every student.
 */
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { tutorLessonPlans } from "@shared/schema";
import { emptyBoard, type BoardOp, type BoardState } from "@shared/tutorBoard";
import { createOpenAI } from "../../lib/openaiClient";
import { sanitizeOps } from "./boardOps";
import { isUsableCheck, type LessonPack, type PackQuestion } from "./lessonPack";

export type TutorLanguage = "en" | "hi" | "hinglish";
export const TUTOR_MODEL = () => process.env.TUTOR_MODEL || "gpt-4.1-mini";

/** One JSON completion: (system, user) → raw JSON text. Injected in tests. */
export type Complete = (system: string, user: string) => Promise<string>;

export function openAiComplete(apiKey: string, businessAccountId: string): Complete {
  const openai = createOpenAI({ apiKey, businessAccountId, feature: "tutor_planner", category: "chat" });
  return async (system, user) => {
    const res = await openai.chat.completions.create({
      model: TUTOR_MODEL(),
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    return res.choices[0]?.message?.content || "{}";
  };
}

// ── shapes ──────────────────────────────────────────────────────────────────────────

const sayText = z.string().trim().min(1).max(320);
const outlineSchema = z.object({
  title: z.string().trim().min(1).max(100),
  intro: z.array(sayText).min(1).max(3),
  sections: z.array(z.object({
    id: z.string().optional(),
    title: z.string().trim().min(1).max(80),
    goal: z.string().trim().max(200).optional().default(""),
    sourceIds: z.array(z.string()).default([]),
    questionIds: z.array(z.string()).default([]),
    mediaIds: z.array(z.string()).default([]),
  })).min(1).max(8),
  recap: z.array(sayText).min(1).max(5),
});
export type LessonOutline = {
  title: string;
  intro: string[];
  sections: Array<{ id: string; title: string; goal: string; sourceIds: string[]; questionIds: string[]; mediaIds: string[] }>;
  recap: string[];
};

export const rawLine = z.object({ say: sayText, ops: z.array(z.unknown()).max(8).default([]) });
const sectionSchema = z.object({
  lines: z.array(rawLine).min(2).max(18),
  simpler: z.array(rawLine).min(1).max(8).default([]),
});
export interface TutorLine { say: string; ops: BoardOp[] }
export interface TutorCheck { id: string; questionId: string; prompt: string; options: string[]; correctIndex: number; solution: string | null }
export interface SectionScript { lines: TutorLine[]; simpler: TutorLine[]; checks: TutorCheck[] }

// ── prompts ─────────────────────────────────────────────────────────────────────────

export function languageRule(language: TutorLanguage): string {
  if (language === "hi") return 'Spoken text ("say", intro, recap) is everyday spoken Hindi in Devanagari, keeping school terms in English (theorem, triangle, equation, federalism). Board text stays short and may be English.';
  if (language === "hinglish") return 'Spoken text ("say", intro, recap) is natural Hinglish written in Devanagari for Hindi words and English letters for English words. Board text stays short and may be English.';
  return 'Spoken text ("say", intro, recap) is simple, warm Indian English for a school student. Board text is short English.';
}

const OUTLINE_SYSTEM = (language: TutorLanguage) => `You plan a short lesson that a friendly tutor will teach out loud while writing on a board, for one school student.
Use ONLY the chapter content given. Never add facts that are not in it.
Return JSON: {"title": string, "intro": [string], "sections": [{"title": string, "goal": string, "sourceIds": [string], "questionIds": [string], "mediaIds": [string]}], "recap": [string]}.
- 3 to 6 sections, in the order a good teacher would teach them (basic idea first, then build up). Together they cover the chapter's main ideas.
- sourceIds: the SOURCE ids (c1, c2…) whose facts the section teaches — at least one, only ids listed.
- questionIds: up to 2 QUESTION ids (q1…) that check exactly this section, only ids listed; [] if none fit.
- mediaIds: up to 2 FIGURE ids (m1…) that would help on the board for this section, only ids listed; [] if none fit.
- intro: 1–2 spoken sentences: greet the student and say what they will learn today.
- recap: 3 short spoken sentences, the three things to remember.
${languageRule(language)}`;

/** The board instructions the model may use (shared by lessons and doubt answers). */
export const BOARD_OPS_DOC = `Board ops (give every drawn thing a short unique id, letters/digits/underscore):
{"op":"write","id":"t1","text":"Pythagoras Theorem","style":"title"}   style: title | body | note; optional "color": ink | blue | red | green
{"op":"math","id":"f1","tex":"a^2 + b^2 = c^2"}   one formula or one step of working per op (KaTeX TeX)
{"op":"image","id":"img1","mediaId":"m2","caption":"Map of India"}   ONLY a FIGURE id listed for this section
{"op":"diagram","id":"d1","kind":"flow","nodes":[{"id":"a","label":"Union"},{"id":"b","label":"States"}],"edges":[{"from":"a","to":"b","label":"shares power"}]}
{"op":"diagram","id":"d2","kind":"table","header":["Union List","State List"],"rows":[["Defence","Police"]]}
{"op":"diagram","id":"g1","kind":"geometry","points":{"A":[1,6],"B":[1,1],"C":[7,1]},"segments":[["A","B"],["B","C"],["A","C"]],"sideLabels":[{"from":"A","to":"C","text":"c"}],"angles":[{"at":"B","mark":"right"}]}   points on a 0–10 grid
{"op":"highlight","target":"g1","part":"A-C","mode":"circle"}   point at something already on the board while talking about it (part optional: a node id, a point, or a segment "A-C")
{"op":"erase","target":"f1"}   {"op":"clear"}`;

const SECTION_SYSTEM = (language: TutorLanguage) => `You write what a great tutor says and writes on the board while teaching ONE section of a lesson to a school student. It must feel like a real teacher: warm, step by step, with an everyday example, writing key points as they speak, drawing when it helps, now and then asking "Can you guess…?" before revealing.
Use ONLY the facts in SOURCES. If something is not there, do not teach it.
Return JSON: {"lines": [{"say": string, "ops": [op]}], "simpler": [{"say": string, "ops": [op]}]}.
- lines: 6 to 12. Each "say" is ONE spoken sentence (at most 30 words), said naturally out loud: no markdown, no TeX, formulas in words ("a squared plus b squared equals c squared").
- ops are drawn on the board WHILE that sentence is said (0 to 4 per line). The first line starts with {"op":"clear"} and a title.
- simpler: 3 to 6 lines that explain this section's hardest idea again in a much simpler way, with an everyday analogy. Its first line does not clear the board.
${languageRule(language)}
${BOARD_OPS_DOC}
Use the board like a real teacher:
- Most lines write or draw something; the section has at least 6 board ops in total.
- Whenever the idea is visual (a shape, a process, a comparison, a list of categories), DRAW it: geometry for shapes (label the sides and mark right angles), flow for processes or levels, table for comparisons or lists — or show a listed FIGURE.
- Key terms and definitions as write; every maths step as its own math op.
- When you talk about one part of a drawing, highlight it in that line.
- simpler lines use the board too (at least 2 ops in total): write the idea in simpler words or draw the analogy.`;

export function sourceBlock(pack: LessonPack, ids: string[], maxChars: number): string {
  const want = new Set(ids);
  let left = maxChars;
  const out: string[] = [];
  for (const s of pack.sources) {
    if (want.size && !want.has(s.id)) continue;
    if (left <= 0) break;
    const text = s.text.slice(0, Math.min(s.text.length, left));
    left -= text.length;
    out.push(`[${s.id}] ${s.title ? `${s.title} — ` : ""}${s.concept ? `(${s.concept}) ` : ""}${text}`);
  }
  return out.join("\n");
}

export function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
    return null;
  }
}

// ── stage A: outline ────────────────────────────────────────────────────────────────

export function validateOutline(raw: unknown, pack: LessonPack): LessonOutline | null {
  const parsed = outlineSchema.safeParse(raw);
  if (!parsed.success) return null;
  const sourceIds = new Set(pack.sources.map((s) => s.id));
  const questionIds = new Set(pack.questions.map((q) => q.id));
  const mediaIds = new Set(pack.media.map((m) => m.id));
  const sections = parsed.data.sections
    .map((s, i) => ({
      id: `s${i + 1}`,
      title: s.title,
      goal: s.goal ?? "",
      sourceIds: Array.from(new Set(s.sourceIds.filter((id) => sourceIds.has(id)))),
      questionIds: Array.from(new Set(s.questionIds.filter((id) => questionIds.has(id)))).slice(0, 2),
      mediaIds: Array.from(new Set(s.mediaIds.filter((id) => mediaIds.has(id)))).slice(0, 2),
    }))
    // A section must teach from at least one real source.
    .filter((s) => s.sourceIds.length > 0)
    .map((s, i) => ({ ...s, id: `s${i + 1}` }));
  if (sections.length < 1) return null;
  return { title: parsed.data.title, intro: parsed.data.intro, sections, recap: parsed.data.recap };
}

export async function planOutline(pack: LessonPack, language: TutorLanguage, complete: Complete): Promise<LessonOutline> {
  if (pack.sources.length === 0) throw new Error("This chapter has no synced notes or transcripts to teach from yet.");
  const user = [
    `CHAPTER: ${pack.chapter}`,
    `SOURCES:\n${sourceBlock(pack, [], 14000)}`,
    `QUESTIONS:\n${pack.questions.slice(0, 40).map((q) => `[${q.id}] ${q.concept ? `(${q.concept}) ` : ""}${q.text.slice(0, 160)}`).join("\n") || "(none)"}`,
    `FIGURES:\n${pack.media.map((m) => `[${m.id}] ${m.caption || m.concept || "figure"}`).join("\n") || "(none)"}`,
  ].join("\n\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const outline = validateOutline(parseJson(await complete(OUTLINE_SYSTEM(language), user)), pack);
    if (outline) return outline;
  }
  throw new Error("Couldn't plan a lesson for this chapter. Try again in a moment.");
}

// ── stage B: section script ─────────────────────────────────────────────────────────

/** Checks for a section, from the question bank only (the answer key is never the model's). */
export function checksFor(questions: PackQuestion[], ids: string[]): TutorCheck[] {
  return ids
    .map((id) => questions.find((q) => q.id === id))
    .filter((q): q is PackQuestion => !!q && isUsableCheck(q))
    .slice(0, 2)
    .map((q, i) => ({
      id: `${q.id}_${i}`,
      questionId: q.id,
      prompt: q.text,
      options: q.options.map((o) => o.text),
      correctIndex: q.options.findIndex((o) => o.isCorrect),
      solution: q.solution,
    }));
}

/** Validates a section script and cleans its ops in speaking order against the board. */
export function validateSection(raw: unknown, pack: LessonPack, sectionMediaIds: string[], board: BoardState = emptyBoard()): { script: Omit<SectionScript, "checks">; board: BoardState } | null {
  const parsed = sectionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const allowed = new Set(sectionMediaIds);
  const media = (id: string) => {
    if (!allowed.has(id)) return null;
    const m = pack.media.find((x) => x.id === id);
    return m ? { src: m.src, caption: m.caption } : null;
  };
  let state = board;
  const clean = (lines: Array<{ say: string; ops: unknown[] }>) => lines.map((l) => {
    const r = sanitizeOps(l.ops, state, media, 4);
    state = r.board;
    return { say: l.say.replace(/\s+/g, " ").trim(), ops: r.ops };
  });
  const lines = clean(parsed.data.lines);
  const afterLines = state;
  const simpler = clean(parsed.data.simpler);
  return { script: { lines, simpler }, board: afterLines };
}

export async function planSection(pack: LessonPack, outline: LessonOutline, sectionIndex: number, language: TutorLanguage, complete: Complete): Promise<SectionScript> {
  const section = outline.sections[sectionIndex];
  if (!section) throw new Error(`No section ${sectionIndex}`);
  const user = [
    `CHAPTER: ${pack.chapter}`,
    `LESSON: ${outline.title}`,
    `SECTIONS SO FAR: ${outline.sections.slice(0, sectionIndex).map((s) => s.title).join(" · ") || "(this is the first)"}`,
    `THIS SECTION: ${section.title}${section.goal ? ` — ${section.goal}` : ""}`,
    `SOURCES:\n${sourceBlock(pack, section.sourceIds, 7000)}`,
    `FIGURES for this section:\n${section.mediaIds.map((id) => { const m = pack.media.find((x) => x.id === id); return `[${id}] ${m?.caption || m?.concept || "figure"}`; }).join("\n") || "(none — do not use image ops)"}`,
  ].join("\n\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const v = validateSection(parseJson(await complete(SECTION_SYSTEM(language), user)), pack, section.mediaIds);
    if (v && v.script.lines.length >= 2) return { ...v.script, checks: checksFor(pack.questions, section.questionIds) };
  }
  throw new Error(`Couldn't prepare "${section.title}". Try again in a moment.`);
}

// ── cache ───────────────────────────────────────────────────────────────────────────

async function cached<T>(pack: LessonPack, language: TutorLanguage, part: string, make: () => Promise<T>): Promise<T> {
  const where = and(
    eq(tutorLessonPlans.businessAccountId, pack.businessAccountId),
    eq(tutorLessonPlans.cpIdsHash, pack.cpIdsHash),
    eq(tutorLessonPlans.chapterNorm, pack.chapterNorm),
    eq(tutorLessonPlans.language, language),
    eq(tutorLessonPlans.versionKey, pack.versionKey),
    eq(tutorLessonPlans.part, part),
  );
  const [hit] = await db.select({ planJson: tutorLessonPlans.planJson }).from(tutorLessonPlans).where(where).limit(1);
  if (hit) return hit.planJson as unknown as T;
  const value = await make();
  await db.insert(tutorLessonPlans).values({
    businessAccountId: pack.businessAccountId,
    cpIdsHash: pack.cpIdsHash,
    chapterNorm: pack.chapterNorm,
    language,
    versionKey: pack.versionKey,
    part,
    planJson: value as unknown as Record<string, unknown>,
    model: TUTOR_MODEL(),
  }).onConflictDoNothing();
  return value;
}

export function getOutline(pack: LessonPack, language: TutorLanguage, complete: Complete): Promise<LessonOutline> {
  return cached(pack, language, "outline", () => planOutline(pack, language, complete));
}

export function getSection(pack: LessonPack, outline: LessonOutline, sectionIndex: number, language: TutorLanguage, complete: Complete): Promise<SectionScript> {
  const section = outline.sections[sectionIndex];
  // The part key includes the section's title so a re-planned outline never reuses a stale script.
  const part = `section:${section?.id}:${crypto.createHash("sha1").update(section?.title ?? "").digest("hex").slice(0, 8)}`;
  return cached(pack, language, part, () => planSection(pack, outline, sectionIndex, language, complete));
}
