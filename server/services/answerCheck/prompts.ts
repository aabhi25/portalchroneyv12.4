/**
 * Answer checking pilot — what the AI is asked to do at each step and how its replies are
 * read back. Pure (no AI, no database) so every instruction and every parser is tested.
 *
 *   read     photos → exactly what the student wrote, unclear parts, legibility
 *   scheme   question + model answer + max marks → steps with marks (drafted once, then saved)
 *   mark     scheme + what was read → marks per step, missing points, feedback, confidence
 *   aiWritten  what was read → estimated AI-written share (an indicator only)
 *   practice   question + scheme → student answers at known levels, with the marks they should get
 *   question   a chapter's notes → one written-answer question with its model answer
 */
import {
  PRACTICE_LEVELS,
  QUESTION_KINDS,
  type AnswerCheckSettings,
  type AiStepJudgement,
  type MarkingScheme,
  type PracticeLevel,
  type QuestionKind,
  type SubjectKind,
  type SubjectRules,
} from "@shared/answerCheck";

export interface QuestionContext {
  questionText: string;
  modelAnswer: string;
  maxMarks: number;
  subject: string | null;
  subjectKind: SubjectKind;
  board: string | null;
  grade: string | null;
  medium: string | null;
  chapter: string | null;
  questionKind: QuestionKind | null;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : fallback);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown, max = 12) => (Array.isArray(v) ? v : []).map(str).filter(Boolean).slice(0, max).map(s => s.slice(0, 300));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** "CBSE · Grade 10 · English medium · Science · Chapter: Light" */
export function contextLine(q: Pick<QuestionContext, "board" | "grade" | "medium" | "subject" | "chapter">): string {
  return [
    q.board,
    q.grade ? `Grade ${q.grade.replace(/^grade\s*/i, "")}` : null,
    q.medium ? `${q.medium} medium` : null,
    q.subject,
    q.chapter ? `Chapter: ${q.chapter}` : null,
  ].filter(Boolean).join(" · ") || "School exam";
}

/** Language the student is expected to write in, from the medium. */
export function mediumLanguage(medium: string | null | undefined): "English" | "Hindi" | "Marathi" {
  const m = (medium || "").toLowerCase();
  if (/hindi|हिंदी/.test(m)) return "Hindi";
  if (/marathi|मराठी/.test(m)) return "Marathi";
  return "English";
}

function rulesText(rules: SubjectRules): string {
  const lines = [
    `Strictness: ${rules.strictness}${rules.strictness === "lenient" ? " (give the benefit of the doubt when the idea is clearly there)" : rules.strictness === "strict" ? " (award a step only when it is fully and precisely shown)" : " (normal board-exam marking)"}.`,
    rules.unitsRequired ? "Units are required: a missing or wrong unit loses the marks of the step that needs it." : "Units are not marked separately.",
    rules.diagramsCount ? "Diagrams and their labels count where the scheme asks for them." : "Diagrams are not marked unless the scheme asks for one.",
    rules.languageWeight === "full" ? "Spelling, grammar and sentence formation count." : rules.languageWeight === "some" ? "Spelling and grammar count a little, only where they change the meaning." : "Do not cut marks for spelling or grammar.",
  ];
  if (rules.notes.trim()) lines.push(rules.notes.trim());
  return lines.join("\n");
}

function schemeText(scheme: MarkingScheme): string {
  const lines = scheme.steps.map(s => `- [${s.id}] ${s.label} — ${s.marks} mark${s.marks === 1 ? "" : "s"}`);
  if (scheme.mustKeywords.length) lines.push(`Must-have keywords or concepts: ${scheme.mustKeywords.join("; ")}`);
  if (scheme.niceKeywords.length) lines.push(`Nice-to-have keywords: ${scheme.niceKeywords.join("; ")}`);
  if (scheme.alternatives.length) lines.push(`Also accept: ${scheme.alternatives.join("; ")}`);
  if (scheme.finalAnswerOnlyMarks !== null) lines.push(`A correct final answer with no working earns ${scheme.finalAnswerOnlyMarks} mark(s) in total.`);
  lines.push(scheme.allowHalfMarks ? "Half marks are allowed (e.g. 0.5, 1.5)." : "Only whole marks.");
  return lines.join("\n");
}

/** Parses a JSON reply, tolerating ``` fences or text around the object. */
export function parseJsonReply(raw: string | null | undefined): Record<string, any> | null {
  if (!raw) return null;
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const v = JSON.parse(text.slice(start, end + 1));
        return v && typeof v === "object" && !Array.isArray(v) ? v : null;
      } catch { /* fall through */ }
    }
    return null;
  }
}

// ---- Reading the handwriting ------------------------------------------------------------------

export const READ_SYSTEM = `You read a school student's handwritten exam answer from photos, for an examiner.
Copy exactly what the student wrote. Students make mistakes and the examiner needs to see them: never correct spelling, grammar, signs, numbers, maths or facts, and never add anything that is not written. A wrong sign or a wrong sum must stay wrong in your copy.
- Keep the student's line breaks and the order of the pages.
- Write maths in plain text on one line where possible: 2x + 4 = 10, x^2, sqrt(3), 3/4, v = u + at.
- Describe each diagram in square brackets with its labels, e.g. [Diagram: ray of light bending towards the normal; labels: i, r, normal].
- Leave out crossed-out text.
- Where a word or part cannot be read, write [unclear] in its place. Never guess silently.
- Digits and symbols matter most: read every number, sign and variable exactly as drawn (a 7 is not a ?, a 1 is not a 7). When a character could be read two ways, write your best reading in the text and add it to "unclear" with the other reading as "guess".
- Copy a heading the student wrote (name, question number) only once at the top; the answer itself is what matters.
- If the page is blank, or shows something other than an answer, say so.
Reply with JSON only:
{"text": "...", "legibility": 0.0-1.0, "unclear": [{"where": "short location, e.g. line 3", "guess": "best guess or empty"}], "blank": false, "language": "en|hi|mr|other", "notes": "short note for the examiner, or empty"}
legibility: 1 = every word easy to read, 0.5 = readable with effort, 0.2 = mostly unreadable.`;

/**
 * The question itself is deliberately NOT shown to the reader: knowing the right working made
 * GPT-4.1 "fix" students' mistakes while copying (it read "2x = 10 + 4" as "10 − 4").
 */
export function readUserText(q: Pick<QuestionContext, "board" | "grade" | "medium" | "subject" | "chapter">, pages: number): string {
  return `${contextLine(q)}\n\nThe ${pages === 1 ? "photo is" : `${pages} photos are the pages, in order, of`} a student's handwritten exam answer. Copy it exactly, mistakes included.`;
}

export interface ReadResult {
  text: string;
  legibility: number;
  unclear: Array<{ where: string; guess: string }>;
  blank: boolean;
  language: string;
  notes: string;
}

export function parseRead(raw: Record<string, any> | null): ReadResult {
  const r = raw || {};
  const text = str(r.text);
  const unclear = (Array.isArray(r.unclear) ? r.unclear : [])
    .filter((u: any) => u && typeof u === "object")
    .map((u: any) => ({ where: str(u.where).slice(0, 120), guess: str(u.guess).slice(0, 120) }))
    .slice(0, 30);
  // Every "[unclear]" in the text counts even if the list forgot it.
  const marked = (text.match(/\[unclear\]/gi) || []).length;
  while (unclear.length < marked) unclear.push({ where: "", guess: "" });
  return {
    text,
    legibility: clamp01(num(r.legibility, text ? 0.7 : 0)),
    unclear,
    blank: r.blank === true || !text,
    language: str(r.language).slice(0, 10) || "en",
    notes: str(r.notes).slice(0, 300),
  };
}

// ---- Drafting the marking scheme --------------------------------------------------------------

export function schemeSystem(): string {
  return `You are a senior board examiner. You write the marking scheme for one exam question, the way a board's official marking scheme is written.
Rules:
- The steps must add up EXACTLY to the question's maximum marks.
- 2 to 8 steps. Each step is one point an examiner can tick: a definition, a formula, a substitution, a calculation, a key point, an example, a conclusion, a labelled diagram.
- Numerical and maths questions: formula, substitution, calculation / intermediate steps, units, final answer.
- Long answers: definition or introduction, explanation, key points, examples, conclusion.
- Short answers: the essential points only.
- Marks per step in halves or whole marks.
- finalAnswerOnlyMarks: for maths and numerical questions only, the marks a correct final answer earns when no working is shown (usually 20–40 % of the maximum); null for other questions.
- mustKeywords: words or concepts a full-marks answer must contain. niceKeywords: helpful but optional.
- alternatives: other correct methods or wordings that must also get credit.
- If no model answer is given, write a concise model answer suitable for the grade first, then base the scheme on it.
Reply with JSON only:
{"modelAnswer": "...", "questionKind": "short|long|numerical", "steps": [{"id": "s1", "label": "...", "marks": 1}], "mustKeywords": [], "niceKeywords": [], "alternatives": [], "finalAnswerOnlyMarks": null, "allowHalfMarks": true}`;
}

export function schemeUserText(q: QuestionContext, rules: SubjectRules): string {
  return [
    contextLine(q),
    `Question (${q.maxMarks} marks): ${q.questionText}`,
    q.modelAnswer.trim() ? `Model answer:\n${q.modelAnswer.trim()}` : "No model answer is available — write one first.",
    q.questionKind ? `Question type: ${q.questionKind}` : "",
    `Subject marking rules:\n${rulesText(rules)}`,
  ].filter(Boolean).join("\n\n");
}

export interface DraftedScheme {
  modelAnswer: string;
  questionKind: QuestionKind | null;
  raw: Record<string, any>;
}

export function parseSchemeDraft(raw: Record<string, any> | null): DraftedScheme {
  const r = raw || {};
  return {
    modelAnswer: str(r.modelAnswer).slice(0, 6000),
    questionKind: QUESTION_KINDS.includes(r.questionKind) ? r.questionKind : null,
    raw: r,
  };
}

// ---- Marking ----------------------------------------------------------------------------------

export function markSystem(settings: Pick<AnswerCheckSettings, "feedbackTone">): string {
  const t = settings.feedbackTone;
  return `You are an experienced, fair board examiner marking one student's handwritten answer against the marking scheme.
How to mark:
1. Compare the answer with each step of the scheme and award marks for every step that is correctly shown.
2. Give partial marks (halves) when the concept or method is right but the explanation is incomplete.
3. No marks for wrong concepts, irrelevant statements or unsupported conclusions.
4. Judge meaning and understanding, not only keywords: accept synonyms, equivalent terms and the student's own words. Do not give full marks just because keywords appear if the explanation is wrong.
5. Accept any other method that is scientifically or mathematically valid.
6. Never cut marks twice for the same mistake (error carried forward): a mistake costs marks only at the step where it happens. Every later step that is done correctly ON THE STUDENT'S OWN (wrong) VALUES keeps its marks, except the final answer step, which needs the right answer.
   Example: "2x + 4 = 10 → 2x = 10 + 4 → 2x = 14 → x = 14/2 → x = 7". Only the transposing step is wrong. "2x = 14" correctly simplifies the student's own line and "x = 14/2" correctly divides it, so those steps get their marks; the final answer x = 7 is wrong.
7. Cut marks for a contradiction only where it affects correctness.
8. Expect the depth of explanation that suits the grade and the board.
9. Parts written as [unclear] could not be read: give no marks for them unless the rest of the answer makes the meaning certain. Never guess what the student meant.
10. Must-have keywords and conditions: a step whose must-have keyword, condition or unit is missing from the answer (in any wording) cannot get its full marks — give part marks and name what is missing.
11. Each step's marks must be between 0 and that step's marks.
Feedback for the student (in the language the student wrote in, simple words for the grade):
- full marks: ${t.full}
- high marks: ${t.high}
- partial marks: ${t.partial}
- low marks: ${t.low}
- zero: ${t.zero}
Make the feedback specific to this question, never generic. Each step comment is at most 12 words, written like an examiner's margin note.
confidence (0–1): how sure you are that a careful human examiner would give the same marks. Lower it when the reading is uncertain, the scheme does not fit the answer, or the answer uses an unusual method.
Reply with JSON only:
{"steps": [{"stepId": "s1", "awarded": 1, "comment": "..."}], "finalAnswerCorrect": true|false|null, "workingShown": true|false|null, "correctPoints": [], "mistakes": [], "missingConcepts": [], "missingKeywords": [], "alternativeMethod": false, "confidence": 0.0-1.0, "confidenceNote": "...", "feedback": {"summary": "2-3 sentences to the student", "improvement": "one specific thing to do better, or empty", "revision": "what to revise if marks are low, or empty"}, "teacherComment": "one short line, like a teacher's remark on the sheet"}
finalAnswerCorrect / workingShown: only for questions with a final answer (maths, numericals); otherwise null.`;
}

export function markUserText(q: QuestionContext, scheme: MarkingScheme, rules: SubjectRules, readText: string): string {
  return [
    contextLine(q),
    `Question (${q.maxMarks} marks): ${q.questionText}`,
    q.modelAnswer.trim() ? `Model answer:\n${q.modelAnswer.trim()}` : "",
    `Marking scheme:\n${schemeText(scheme)}`,
    `Subject marking rules:\n${rulesText(rules)}`,
    `The student's answer, exactly as written (read from the photos):\n"""\n${readText || "(nothing written)"}\n"""`,
  ].filter(Boolean).join("\n\n");
}

export interface MarkReply {
  judgements: AiStepJudgement[];
  finalAnswerCorrect: boolean | null;
  workingShown: boolean | null;
  correctPoints: string[];
  mistakes: string[];
  missingConcepts: string[];
  missingKeywords: string[];
  alternativeMethod: boolean;
  confidence: number;
  confidenceNote: string;
  feedback: { summary: string; improvement: string; revision: string };
  teacherComment: string;
}

export function parseMark(raw: Record<string, any> | null): MarkReply {
  const r = raw || {};
  const fb = r.feedback && typeof r.feedback === "object" ? r.feedback : {};
  const tri = (v: unknown) => (v === true ? true : v === false ? false : null);
  return {
    judgements: (Array.isArray(r.steps) ? r.steps : [])
      .filter((s: any) => s && typeof s === "object")
      .map((s: any) => ({ stepId: str(s.stepId ?? s.id), awarded: num(s.awarded, 0), comment: str(s.comment).slice(0, 200) })),
    finalAnswerCorrect: tri(r.finalAnswerCorrect),
    workingShown: tri(r.workingShown),
    correctPoints: list(r.correctPoints),
    mistakes: list(r.mistakes),
    missingConcepts: list(r.missingConcepts),
    missingKeywords: list(r.missingKeywords),
    alternativeMethod: r.alternativeMethod === true,
    confidence: clamp01(num(r.confidence, 0.5)),
    confidenceNote: str(r.confidenceNote).slice(0, 300),
    feedback: { summary: str(fb.summary).slice(0, 1200), improvement: str(fb.improvement).slice(0, 600), revision: str(fb.revision).slice(0, 600) },
    teacherComment: str(r.teacherComment).slice(0, 200),
  };
}

// ---- AI-written estimate ----------------------------------------------------------------------

export const AI_WRITTEN_SYSTEM = `You estimate whether a school student's handwritten answer was copied from an AI chatbot (such as a general-purpose AI assistant). This is only an indicator for a teacher — it can never prove anything and must never name a specific tool.
Signs of chatbot text: polished vocabulary well above the grade, chatbot-style structure (headings, bold-style labels, "In conclusion", "It is important to note", "Overall,"), perfectly balanced lists, generic filler, no personal phrasing.
Signs of a student: spelling or grammar slips, uneven structure, grade-level words, textbook phrasing, abbreviations, crossed-out work.
Copying the textbook or a model answer is normal for students and is NOT a sign of AI.
Reply with JSON only: {"percent": 0-100, "confidence": "low|medium|high", "signals": ["short reason", ...]}
percent: the estimated share of the answer that reads like chatbot text.`;

export function aiWrittenUserText(q: Pick<QuestionContext, "questionText" | "board" | "grade" | "medium" | "subject" | "chapter">, readText: string): string {
  return `${contextLine(q)}\nQuestion: ${q.questionText}\n\nStudent's answer:\n"""\n${readText}\n"""`;
}

export interface AiWrittenReply {
  percent: number;
  confidence: "low" | "medium" | "high";
  signals: string[];
}

export function parseAiWritten(raw: Record<string, any> | null): AiWrittenReply {
  const r = raw || {};
  const confidence = ["low", "medium", "high"].includes(r.confidence) ? r.confidence : "low";
  return { percent: Math.round(Math.min(100, Math.max(0, num(r.percent, 0)))), confidence, signals: list(r.signals, 5) };
}

// ---- Practice answers -------------------------------------------------------------------------

const LEVEL_BRIEF: Record<PracticeLevel, string> = {
  strong: "a strong student: full or nearly full marks, in the student's own words (not a copy of the model answer)",
  average: "an average student: about half to two-thirds of the marks — the answer MUST visibly leave out one or two scheme steps or keywords, or get one step wrong (an average answer is never fully correct)",
  weak: "a weak student: about 10–35 % of the marks — a wrong concept or a calculation mistake early on, some relevant words",
  ai_copied: "a student who copied a chatbot: correct and complete, but written in polished chatbot style (headings, 'In conclusion', 'It is important to note')",
};

export function practiceSystem(): string {
  return `You write realistic handwritten-exam answers by school students, used to test an AI examiner. Each answer is written exactly as a student of that grade would write it by hand in an exam.
- Plain text only, line breaks allowed. No markdown, no LaTeX: maths on single lines (2x + 4 = 10, x^2, 3/4).
- No diagrams; if the answer would have one, write one line like (Diagram: ...).
- Realistic length for the marks; students do not write essays for 2 marks.
- Add a few natural student slips (a spelling mistake, an abbreviation) except in the chatbot-style answer.
- For each answer, say how many marks each scheme step SHOULD get, honestly, as a careful examiner would — judged on the text you actually wrote, not on the level you aimed for. Steps done correctly from an earlier mistake keep their marks (error carried forward); only the step with the mistake and a wrong final answer lose marks.
- Before replying, re-read each answer: if it does not really match its level (for example an "average" answer that is fully correct), rewrite it.
Reply with JSON only:
{"answers": [{"level": "strong|average|weak|ai_copied", "text": "...", "expectedSteps": [{"stepId": "s1", "awarded": 1}], "why": "one line: what the answer gets right and wrong"}]}`;
}

export function practiceUserText(q: QuestionContext, scheme: MarkingScheme, levels: PracticeLevel[]): string {
  const lang = mediumLanguage(q.medium);
  return [
    contextLine(q),
    `Question (${q.maxMarks} marks): ${q.questionText}`,
    q.modelAnswer.trim() ? `Model answer:\n${q.modelAnswer.trim()}` : "",
    `Marking scheme:\n${schemeText(scheme)}`,
    `Write ${levels.length} answer${levels.length === 1 ? "" : "s"}, one for each of:\n${levels.map(l => `- ${l}: ${LEVEL_BRIEF[l]}`).join("\n")}`,
    lang === "English" ? "Write the answers in English." : `Write the answers in ${lang} (Devanagari script), as a ${lang}-medium student would; numbers and formulas may use digits and Latin letters.`,
  ].filter(Boolean).join("\n\n");
}

export interface PracticeAnswer {
  level: PracticeLevel;
  text: string;
  expectedSteps: AiStepJudgement[];
  why: string;
}

export function parsePractice(raw: Record<string, any> | null, levels: PracticeLevel[]): PracticeAnswer[] {
  const r = raw || {};
  const out: PracticeAnswer[] = [];
  for (const a of Array.isArray(r.answers) ? r.answers : []) {
    if (!a || typeof a !== "object") continue;
    const level = PRACTICE_LEVELS.includes(a.level) ? (a.level as PracticeLevel) : null;
    const text = str(a.text);
    if (!level || !text || !levels.includes(level) || out.some(o => o.level === level)) continue;
    out.push({
      level,
      text: text.slice(0, 4000),
      expectedSteps: (Array.isArray(a.expectedSteps) ? a.expectedSteps : [])
        .filter((s: any) => s && typeof s === "object")
        .map((s: any) => ({ stepId: str(s.stepId ?? s.id), awarded: num(s.awarded, 0), comment: "" })),
      why: str(a.why).slice(0, 300),
    });
  }
  return levels.map(l => out.find(o => o.level === l)).filter((a): a is PracticeAnswer => !!a);
}

// ---- A question written from a chapter's notes ------------------------------------------------

export const QUESTION_FROM_NOTES_SYSTEM = `You set one written-answer exam question (not multiple choice) from a chapter's study material, the way a board paper would ask it, with its model answer.
Reply with JSON only: {"question": "...", "modelAnswer": "...", "questionKind": "short|long|numerical"}`;

export function questionFromNotesUserText(scope: { board: string | null; grade: string | null; medium: string | null; subject: string | null; chapter: string | null }, kind: QuestionKind, maxMarks: number, notes: string): string {
  const lang = mediumLanguage(scope.medium);
  return [
    contextLine(scope),
    `Write a ${kind === "numerical" ? "numerical problem" : `${kind}-answer question`} worth ${maxMarks} marks.`,
    lang === "English" ? "" : `Write the question and the model answer in ${lang}.`,
    `Study material:\n"""\n${notes.slice(0, 6000)}\n"""`,
  ].filter(Boolean).join("\n\n");
}

export function parseQuestionFromNotes(raw: Record<string, any> | null): { question: string; modelAnswer: string; questionKind: QuestionKind | null } | null {
  const r = raw || {};
  const question = str(r.question);
  if (!question) return null;
  return { question: question.slice(0, 2000), modelAnswer: str(r.modelAnswer).slice(0, 6000), questionKind: QUESTION_KINDS.includes(r.questionKind) ? r.questionKind : null };
}

// ---- Question kind from the curriculum's own label ------------------------------------------------

/** True for objective items (multiple choice, true/false, fill in the blanks, match) — not for this pilot. */
export function isObjectiveQuestion(questionType: unknown, options: unknown): boolean {
  if (Array.isArray(options) && options.length >= 2) return true;
  return /mcq|multiple|objective|true\s*\/?\s*false|fill|blank|match|choice|assertion/i.test(typeof questionType === "string" ? questionType : "");
}

/** Short / long / numerical from the curriculum label, else from the question and its answer. */
export function guessQuestionKind(questionType: unknown, questionText: string, solution: string, subjectKind: SubjectKind): QuestionKind {
  const t = typeof questionType === "string" ? questionType.toLowerCase() : "";
  if (/numer|problem|calculat/.test(t)) return "numerical";
  if (/long|essay|descriptive|detail/.test(t)) return "long";
  if (/short|very short|vsa|sa\b/.test(t)) return "short";
  const q = questionText.toLowerCase();
  const digits = (questionText.match(/\d/g) || []).length;
  if ((subjectKind === "maths" || subjectKind === "science") && (/calculate|find the|solve|how much|how many|compute|evaluate|गणना|ज्ञात/.test(q) || digits >= 3)) return "numerical";
  const words = solution.trim().split(/\s+/).filter(Boolean).length;
  if (/explain in detail|describe|discuss|elaborate|differentiate|compare|विस्तार/.test(q) || words > 120) return "long";
  return "short";
}

// ---- Whole answer sheets ----------------------------------------------------------------------
// Two steps, so the reader still never sees the questions (it would "fix" mistakes): first the
// whole sheet is copied into parts with the student's own labels ("Q3", "Ans 2"), then a text-only
// step matches the parts to the paper's questions.

export const READ_PAPER_SYSTEM = `You read a school student's handwritten exam answer sheet from photos (several pages, in order), for an examiner.
Copy exactly what the student wrote. Students make mistakes and the examiner needs to see them: never correct spelling, grammar, signs, numbers, maths or facts, and never add anything that is not written.
Split the sheet into parts: start a new part wherever the student starts a new answer (a question number or label such as "Q3", "Ans 2", "3)", "(b)", or a clearly separate answer).
- "label": the question number or label exactly as the student wrote it at the start of the part, or "" if there is none (for example an answer continuing from the previous page).
- "pages": the page numbers (1 = first photo) the part is on.
- "text": the part's text without its label. Keep line breaks. Maths in plain text (2x + 4 = 10, x^2, 3/4). Describe diagrams in square brackets. Leave out crossed-out text. Write [unclear] for anything you cannot read and never guess silently; a character that could be read two ways goes in "unclear" with the other reading as "guess".
- Name, roll number, date or rough work at the top or margins are their own parts with label "" and start their text with "(heading)" or "(rough work)".
Reply with JSON only:
{"parts": [{"label": "Q1", "pages": [1], "text": "...", "legibility": 0.0-1.0, "unclear": [{"where": "...", "guess": "..."}]}], "blank": false, "notes": "short note for the examiner, or empty"}`;

export function readPaperUserText(q: Pick<QuestionContext, "board" | "grade" | "medium" | "subject" | "chapter">, pages: number): string {
  return `${contextLine({ ...q, chapter: null })}\n\nThe ${pages} photo${pages === 1 ? " is" : "s are"} the page${pages === 1 ? "" : "s"}, in order, of one student's handwritten answer sheet. Copy it exactly, mistakes included, split into parts.`;
}

export interface SheetPart {
  label: string;
  pages: number[];
  text: string;
  legibility: number;
  unclear: Array<{ where: string; guess: string }>;
}

export function parsePaperRead(raw: Record<string, any> | null, pageCount: number): { parts: SheetPart[]; blank: boolean; notes: string } {
  const r = raw || {};
  const parts: SheetPart[] = (Array.isArray(r.parts) ? r.parts : [])
    .filter((p: any) => p && typeof p === "object")
    .map((p: any) => {
      const read = parseRead({ text: p.text, legibility: p.legibility, unclear: p.unclear });
      const pages = (Array.isArray(p.pages) ? p.pages : [p.pages])
        .map((x: unknown) => Math.round(num(x, 0)))
        .filter((x: number, i: number, a: number[]) => x >= 1 && x <= pageCount && a.indexOf(x) === i);
      return { label: str(p.label).slice(0, 30), pages: pages.length ? pages : [1], text: read.text, legibility: read.legibility, unclear: read.unclear };
    })
    .filter((p: SheetPart) => p.text)
    .slice(0, 60);
  return { parts, blank: r.blank === true || !parts.length, notes: str(r.notes).slice(0, 300) };
}

export interface PaperQuestion {
  number: string;
  maxMarks: number;
  questionText: string;
}

export const MATCH_SYSTEM = `You match the parts of a student's handwritten answer sheet to the questions of the exam paper.
- Use the student's own labels first ("Q3", "Ans 3", "3)", "iii" all mean question 3). Students often answer out of order.
- When a label is missing, unclear or wrong, use what the part says: which question does it answer?
- A part with no label straight after another part usually continues that answer (for example on the next page).
- Every part belongs to at most one question; one question may have several parts (give them in reading order).
- Headings (name, roll number, date) and rough work belong to no question: list them under "unassigned" with the reason.
- A question with no part is "notAttempted".
- confidence (0–1): how sure you are that these parts are this question's answer. Lower it when you relied on content instead of a clear label, or when two questions look alike.
Reply with JSON only:
{"answers": [{"number": "1", "parts": [0, 2], "confidence": 0.0-1.0, "note": "short reason when not a clear label, else empty"}], "notAttempted": ["4"], "unassigned": [{"part": 3, "reason": "rough work"}]}`;

export function matchUserText(questions: PaperQuestion[], parts: SheetPart[]): string {
  const qs = questions.map(q => `Question ${q.number} (${q.maxMarks} marks): ${q.questionText.replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
  const ps = parts.map((p, i) => `Part ${i} — label "${p.label}", page ${p.pages.join(", ")}:\n${p.text.slice(0, 700)}${p.text.length > 700 ? " …" : ""}`).join("\n\n");
  return `The exam paper's questions:\n${qs}\n\nThe parts of the student's answer sheet:\n${ps}`;
}

export interface MatchedAnswer {
  number: string;
  parts: number[];
  text: string;
  pages: number[];
  legibility: number;
  unclear: Array<{ where: string; guess: string }>;
  confidence: number;
  note: string;
  notAttempted: boolean;
}

export interface PaperMatching {
  answers: MatchedAnswer[];
  unassigned: Array<{ part: number; reason: string; text: string }>;
}

/**
 * Each question's answer from the AI's matching, checked in code: unknown question numbers and
 * part numbers are dropped, a part is used once (first claim wins), every question gets an entry
 * (none found = not attempted), and parts nobody claimed are listed as unassigned.
 */
export function assembleAnswers(questions: PaperQuestion[], parts: SheetPart[], raw: Record<string, any> | null): PaperMatching {
  const r = raw || {};
  const norm = (v: unknown) => str(typeof v === "number" ? String(v) : v).replace(/^(q|que|question|ans|answer)\.?\s*/i, "").replace(/[).:\s]+$/, "").toLowerCase();
  const byNumber = new Map(questions.map(q => [norm(q.number), q]));
  const used = new Set<number>();
  const found = new Map<string, { parts: number[]; confidence: number; note: string }>();
  for (const a of Array.isArray(r.answers) ? r.answers : []) {
    if (!a || typeof a !== "object") continue;
    const q = byNumber.get(norm(a.number));
    if (!q || found.has(q.number)) continue;
    const mine = (Array.isArray(a.parts) ? a.parts : [])
      .map((x: unknown) => Math.round(num(x, -1)))
      .filter((i: number) => i >= 0 && i < parts.length && !used.has(i));
    mine.forEach((i: number) => used.add(i));
    if (mine.length) found.set(q.number, { parts: mine, confidence: clamp01(num(a.confidence, 0.5)), note: str(a.note).slice(0, 200) });
  }
  const answers: MatchedAnswer[] = questions.map(q => {
    const f = found.get(q.number);
    if (!f) return { number: q.number, parts: [], text: "", pages: [], legibility: 1, unclear: [], confidence: 1, note: "", notAttempted: true };
    const mine = f.parts.map(i => parts[i]);
    return {
      number: q.number,
      parts: f.parts,
      text: mine.map(p => p.text).join("\n"),
      pages: Array.from(new Set(mine.flatMap(p => p.pages))).sort((a, b) => a - b),
      legibility: Math.min(...mine.map(p => p.legibility)),
      unclear: mine.flatMap(p => p.unclear),
      confidence: f.confidence,
      note: f.note,
      notAttempted: false,
    };
  });
  const reasons = new Map<number, string>();
  for (const u of Array.isArray(r.unassigned) ? r.unassigned : []) {
    const i = Math.round(num(u?.part, -1));
    if (i >= 0 && i < parts.length) reasons.set(i, str(u?.reason).slice(0, 120));
  }
  const unassigned = parts
    .map((p, i) => ({ part: i, reason: reasons.get(i) || "Not matched to any question", text: p.text.slice(0, 300) }))
    .filter(u => !used.has(u.part));
  return { answers, unassigned };
}

/** Parts the AI couldn't place that look like real answers (not a heading or rough work). */
export function unplacedAnswerParts(m: PaperMatching): PaperMatching["unassigned"] {
  return m.unassigned.filter(u => !/^\((heading|rough work)\)/i.test(u.text.trim()) && !/heading|rough|name|roll|date/i.test(u.reason));
}

// ---- Importing a question paper -----------------------------------------------------------------

export const IMPORT_SYSTEM = `You turn a school exam question paper — often with its answer key or model answers — into a list of questions for an examiner.
- Keep each question's wording exactly as written (fix only broken line breaks). Keep its own number (1, 2, 3a, …).
- marks: the marks printed for the question ("[2]", "(3 marks)", "2M"); null if none is shown.
- modelAnswer: the answer from the document's answer key / solutions, copied faithfully. Only when the document gives no answer for a question, write a concise model answer suitable for the grade and set "modelAnswerFrom" to "ai".
- objective: true for multiple choice, true/false, fill in the blanks and match the following.
- Questions with parts that are marked separately (2a, 2b) are separate questions; a question whose parts share one mark total stays one question.
- Leave out instructions, headings and general notes.
Reply with JSON only:
{"title": "paper title or empty", "board": "", "grade": "", "medium": "", "subject": "", "questions": [{"number": "1", "question": "...", "marks": 2, "modelAnswer": "...", "modelAnswerFrom": "document|ai", "objective": false}]}`;

export interface ImportedQuestion {
  number: string;
  question: string;
  marks: number | null;
  modelAnswer: string;
  modelAnswerByAi: boolean;
  objective: boolean;
}

export interface ImportedPaper {
  title: string;
  board: string;
  grade: string;
  medium: string;
  subject: string;
  questions: ImportedQuestion[];
}

/** The AI's reading of a question paper, cleaned: empty questions dropped, numbers unique, marks sane. */
export function parseImport(raw: Record<string, any> | null): ImportedPaper {
  const r = raw || {};
  const seen = new Set<string>();
  const questions: ImportedQuestion[] = [];
  const list: any[] = Array.isArray(r.questions) ? r.questions : [];
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (!q || typeof q !== "object") continue;
    const question = str(q.question);
    if (question.length < 3) continue;
    let number = str(typeof q.number === "number" ? String(q.number) : q.number).replace(/^(q|que|question)\.?\s*/i, "").replace(/[).:\s]+$/, "").slice(0, 10) || String(i + 1);
    while (seen.has(number.toLowerCase())) number = `${number}′`;
    seen.add(number.toLowerCase());
    const marks = num(q.marks, NaN);
    questions.push({
      number,
      question: question.slice(0, 4000),
      marks: Number.isFinite(marks) && marks > 0 && marks <= 100 ? Math.round(marks * 2) / 2 : null,
      modelAnswer: str(q.modelAnswer).slice(0, 10000),
      modelAnswerByAi: q.modelAnswerFrom === "ai",
      objective: q.objective === true,
    });
    if (questions.length >= 60) break;
  }
  return { title: str(r.title).slice(0, 120), board: str(r.board).slice(0, 60), grade: str(r.grade).slice(0, 20), medium: str(r.medium).slice(0, 40), subject: str(r.subject).slice(0, 80), questions };
}
