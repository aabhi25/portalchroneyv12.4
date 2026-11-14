/**
 * Answer checking pilot — the AI instructions and how its replies are read back (pure): JSON
 * with fences or chatter around it, missing or wrong fields, unclear parts, objective questions
 * left out, question kinds, the student's language from the medium, and what each step's
 * instructions contain.
 *
 *   npx tsx server/services/__tests__/answerCheckPrompts.test.ts
 */
import { defaultAnswerCheckSettings, normalizeScheme } from "../../../shared/answerCheck";
import {
  contextLine,
  guessQuestionKind,
  isObjectiveQuestion,
  markSystem,
  markUserText,
  mediumLanguage,
  parseAiWritten,
  parseJsonReply,
  parseMark,
  parsePractice,
  parseChapterQuestions,
  parseQuestionFromNotes,
  questionsFromChapterUserText,
  parseRead,
  parseSchemeDraft,
  practiceUserText,
  readUserText,
  schemeUserText,
  type QuestionContext,
} from "../answerCheck/prompts";

let failed = 0;
let passed = 0;
function expect(cond: boolean, label: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

const q: QuestionContext = {
  questionText: "Explain refraction with an example.", modelAnswer: "Bending of light…", maxMarks: 3, subject: "Science", subjectKind: "science",
  board: "CBSE", grade: "10", medium: "English", chapter: "Light", questionKind: "short",
};

console.log("Reading JSON replies");
{
  expect(parseJsonReply('{"a":1}')?.a === 1, "plain JSON");
  expect(parseJsonReply('```json\n{"a":2}\n```')?.a === 2, "JSON in ``` fences");
  expect(parseJsonReply('Here you go: {"a":3} hope it helps')?.a === 3, "JSON with words around it");
  expect(parseJsonReply("not json") === null && parseJsonReply("") === null && parseJsonReply(null) === null, "nothing usable → null");
  expect(parseJsonReply("[1,2]") === null, "a list is not a reply object");
}

console.log("Reading the handwriting reply");
{
  const r = parseRead({ text: " x = 3 ", legibility: 1.4, unclear: [{ where: "line 2", guess: "7" }, "junk"], language: "en" });
  expect(r.text === "x = 3" && r.legibility === 1 && r.unclear.length === 1 && !r.blank, "trimmed, legibility capped at 1, junk dropped", r);
  expect(parseRead({ text: "" }).blank && parseRead(null).blank, "no text → blank");
  expect(parseRead({ text: "a [unclear] b [UNCLEAR]", unclear: [] }).unclear.length === 2, "every [unclear] counts");
  expect(parseRead({ text: "abc", legibility: "0.4" }).legibility === 0.4, "legibility as text is read");
  expect(parseRead({ text: "abc" }).legibility === 0.7, "missing legibility → a middling 0.7");
}

console.log("Reading the marking reply");
{
  const m = parseMark({ steps: [{ stepId: "s1", awarded: "1.5", comment: "ok" }, { id: "s2", awarded: 1 }, null], confidence: 3, finalAnswerCorrect: "yes", feedback: { summary: "Good" } });
  expect(m.judgements.length === 2 && m.judgements[0].awarded === 1.5 && m.judgements[1].stepId === "s2", "step marks read (also 'id' and text numbers)", m.judgements);
  expect(m.confidence === 1 && m.finalAnswerCorrect === null, "confidence capped, unclear yes/no → unknown");
  expect(m.feedback.summary === "Good" && m.feedback.improvement === "", "missing feedback parts are empty");
  const empty = parseMark(null);
  expect(empty.judgements.length === 0 && empty.confidence === 0.5, "no reply → no marks, middling confidence");
}

console.log("Other replies");
{
  const a = parseAiWritten({ percent: 140, confidence: "certain", signals: ["x", 3, "y"] });
  expect(a.percent === 100 && a.confidence === "low" && a.signals.join() === "x,y", "AI-written: percent capped, unknown confidence → low", a);
  const s = parseSchemeDraft({ modelAnswer: " m ", questionKind: "essay" });
  expect(s.modelAnswer === "m" && s.questionKind === null, "scheme draft: unknown kind dropped");
  const p = parsePractice({ answers: [
    { level: "strong", text: "A", expectedSteps: [{ stepId: "s1", awarded: 1 }] },
    { level: "strong", text: "dup" },
    { level: "weak", text: "" },
    { level: "genius", text: "x" },
    { level: "average", text: "B" },
  ] }, ["strong", "average", "weak"]);
  expect(p.map(x => x.level).join() === "strong,average" && p[0].text === "A", "practice: one per level, in the order asked, empty/unknown dropped", p);
  expect(parsePractice({ answers: [{ level: "ai_copied", text: "x" }] }, ["strong"]).length === 0, "practice: levels not asked for are ignored");
  expect(parseQuestionFromNotes({ question: "Q?", modelAnswer: "A", questionKind: "long" })?.questionKind === "long" && parseQuestionFromNotes({}) === null, "question from notes");
}

console.log("Objective questions and question kinds");
{
  expect(isObjectiveQuestion("subjective", [{ text: "a" }, { text: "b" }]), "a question with options is objective");
  expect(isObjectiveQuestion("MCQ", null) && isObjectiveQuestion("True/False", null) && isObjectiveQuestion("Fill in the blanks", null) && isObjectiveQuestion("Match the following", null), "MCQ, true/false, blanks, match are objective");
  expect(!isObjectiveQuestion("subjective", []) && !isObjectiveQuestion(null, null) && !isObjectiveQuestion("Long Answer", undefined), "written questions are not");
  expect(guessQuestionKind("Long Answer", "x", "", "science") === "long" && guessQuestionKind("Short Answer", "x", "", "science") === "short" && guessQuestionKind("Numerical", "x", "", "science") === "numerical", "kind from the curriculum's label");
  expect(guessQuestionKind(null, "Calculate the resistance of a 12 V, 3 A circuit.", "", "science") === "numerical", "'Calculate…' in science → numerical");
  expect(guessQuestionKind(null, "Describe the causes of the French Revolution.", "", "social_science") === "long", "'Describe…' → long");
  expect(guessQuestionKind(null, "What is a noun?", "A naming word.", "english") === "short", "a short question → short");
  expect(guessQuestionKind(null, "What is photosynthesis?", "word ".repeat(130), "science") === "long", "a long model answer → long");
}

console.log("Instructions");
{
  expect(contextLine(q) === "CBSE · Grade 10 · English medium · Science · Chapter: Light", "context line", contextLine(q));
  expect(contextLine({ board: null, grade: "Grade 7", medium: null, subject: null, chapter: null }) === "Grade 7", "'Grade' not doubled");
  expect(mediumLanguage("Hindi") === "Hindi" && mediumLanguage("Semi-English Marathi") === "Marathi" && mediumLanguage(null) === "English", "student's language from the medium");
  expect(readUserText(q, 2).includes("2 photos are the pages") && readUserText(q, 1).includes("photo is"), "reading instruction mentions the pages");
  expect(!readUserText(q, 1).includes(q.questionText), "the reader is not shown the question (it made it correct students' mistakes)");
  const rules = defaultAnswerCheckSettings().subjectRules.science;
  expect(schemeUserText({ ...q, modelAnswer: "" }, rules).includes("No model answer is available"), "scheme: asks for a model answer when there is none");
  expect(schemeUserText(q, rules).includes("Units are required"), "scheme: subject rules included");
  const scheme = normalizeScheme({ steps: [{ id: "d", label: "Definition", marks: 1 }, { id: "e", label: "Example", marks: 2 }], alternatives: ["Lens example"], finalAnswerOnlyMarks: null }, 3);
  const mu = markUserText(q, scheme, { ...rules, strictness: "strict" }, "Light bends.");
  expect(mu.includes("[d] Definition — 1 mark") && mu.includes("[e] Example — 2 marks") && mu.includes("Also accept: Lens example"), "marking: scheme with step ids, marks and alternatives", mu);
  expect(mu.includes("fully and precisely shown") && mu.includes('"""\nLight bends.\n"""'), "marking: strictness and the answer as read");
  const ms = markSystem({ feedbackTone: { ...defaultAnswerCheckSettings().feedbackTone, zero: "ZERO-TONE" } });
  expect(ms.includes("Never cut marks twice") && ms.includes("[unclear]") && ms.includes("ZERO-TONE"), "marking rules include no double cuts, unclear parts and the admin's feedback tone");
  const pu = practiceUserText({ ...q, medium: "Hindi" }, scheme, ["strong", "weak"]);
  expect(pu.includes("- strong:") && pu.includes("- weak:") && !pu.includes("- average:") && pu.includes("in Hindi"), "practice: only the chosen levels, in the medium's language");
}

console.log("Questions written from a chapter's content");
{
  const asks = [{ kind: "short" as const, count: 2, marks: 2 }, { kind: "long" as const, count: 1, marks: 5 }, { kind: "numerical" as const, count: 0, marks: 3 }];
  const scope = { board: "CBSE", grade: "10", medium: "English", subject: "Science" };
  const u = questionsFromChapterUserText(scope, asks, [{ chapter: "Light", text: "Refraction is the bending of light." }], { instructions: "one case-based question", avoid: ["What is refraction?"] });
  expect(u.includes("2 short-answer questions of 2 marks each; 1 long-answer question of 5 marks each") && !u.includes("numerical"), "asks for each kind with its marks, leaves out kinds set to 0", u);
  expect(u.includes("### Chapter: Light") && u.includes("Refraction is the bending of light."), "the chapter's material is given under its name");
  expect(u.includes("The examiner also asks: one case-based question") && u.includes("- What is refraction?"), "extra instructions and questions already in the paper are passed on");
  expect(questionsFromChapterUserText({ ...scope, medium: "Hindi" }, asks, [{ chapter: "x", text: "y" }]).includes("in Hindi"), "written in the medium's language");
  const parsed = parseChapterQuestions({ questions: [
    { question: "Explain refraction with an example.", questionKind: "short", marks: 2, modelAnswer: "Bending of light…", chapter: "light" },
    { question: "Explain refraction with an example!", questionKind: "short", marks: 2, modelAnswer: "dup", chapter: "Light" },
    { question: "What is refraction?", questionKind: "short", marks: 2, modelAnswer: "already in paper", chapter: "Light" },
    { question: "Why?", questionKind: "short", marks: 2 },
    { question: "State the laws of reflection of light.", marks: "abc", modelAnswer: "Angle i = angle r…", chapter: "Chapter 10 Light" },
    { question: "Describe how a rainbow is formed, with a diagram.", questionKind: "long", marks: 5, modelAnswer: "Dispersion…", chapter: "Unknown chapter" },
    { question: "One too many — should be dropped.", questionKind: "long", marks: 5 },
  ] }, asks, ["Light", "Electricity"], ["What is refraction?"]);
  expect(parsed.length === 3, "repeats, questions already in the paper, too-short ones and extras beyond the 3 asked are dropped", parsed.map(p => p.question));
  expect(parsed[0].chapter === "Light" && parsed[1].chapter === "Light" && parsed[2].chapter === null, "chapter matched to the given chapters (case, partial), unknown → none", parsed.map(p => p.chapter));
  expect(parsed[1].marks === 2 && parsed[1].questionKind === "short", "marks or kind left out → the ones asked for that slot", parsed[1]);
  expect(parsed[2].marks === 5 && parsed[2].questionKind === "long", "kind and marks kept when given", parsed[2]);
  expect(parseChapterQuestions(null, asks, ["Light"]).length === 0 && parseChapterQuestions({ questions: "x" }, asks, ["Light"]).length === 0, "a broken reply gives no questions");
  const one = parseChapterQuestions({ questions: [{ question: "Explain dispersion of light.", marks: 300 }] }, [{ kind: "long", count: 1, marks: 4 }], ["Light"]);
  expect(one[0].marks === 4 && one[0].chapter === "Light", "marks out of range → the asked marks; one chapter → that chapter", one[0]);
}

if (failed > 0) { console.error(`\n${failed} check(s) failed, ${passed} passed.`); process.exit(1); }
console.log(`\nAll ${passed} answer-checking prompt checks passed.`);
