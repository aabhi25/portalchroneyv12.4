/**
 * Answer checking pilot — the pure marking rules (shared/answerCheck.ts): settings clean-up,
 * marking schemes that always add up to the question's maximum, turning the AI's per-step
 * judgement into marks (cap, half marks, a mistake costs marks once), score bands, the
 * AI-written status, when a teacher must look, and the accuracy summary.
 *
 *   npx tsx server/services/__tests__/answerCheckRules.test.ts
 */
import {
  accuracySummary,
  aiWrittenStatus,
  applyJudgement,
  correctnessOf,
  defaultAnswerCheckSettings,
  normalizeScheme,
  resolveAnswerCheckSettings,
  roundMarks,
  schemeProblems,
  schemeTotal,
  scoreBand,
  subjectKindOf,
  suggestMaxMarks,
  teacherReasons,
  wordCount,
} from "../../../shared/answerCheck";

let failed = 0;
let passed = 0;
function expect(cond: boolean, label: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

// The client's own example: "Solve 2x + 4 = 10", 5 marks, one mark per step.
const linear = normalizeScheme({
  steps: [
    { id: "eq", label: "Writes the original equation", marks: 1 },
    { id: "move", label: "Moves 4 to the other side", marks: 1 },
    { id: "simp", label: "Simplifies to 2x = 6", marks: 1 },
    { id: "div", label: "Divides by 2", marks: 1 },
    { id: "final", label: "States x = 3", marks: 1 },
  ],
  mustKeywords: ["x = 3"],
  finalAnswerOnlyMarks: 2,
}, 5);

console.log("Settings");
{
  const d = defaultAnswerCheckSettings();
  expect(d.minMarks === 2 && d.maxMarks === 5 && d.questionKinds.length === 3, "defaults: 2–5 marks, all question kinds");
  expect(d.enabled === false && resolveAnswerCheckSettings(null).enabled === false, "AI assessment is off until switched on");
  expect(resolveAnswerCheckSettings({ enabled: true }).enabled === true && resolveAnswerCheckSettings({ enabled: "yes" }).enabled === false, "only a real true switches it on");
  const r = resolveAnswerCheckSettings({ minMarks: 8, maxMarks: 3, questionKinds: ["long", "essay"], legibilityThreshold: 4, subjectRules: { maths: { strictness: "harsh", unitsRequired: false } } });
  expect(r.minMarks === 8 && r.maxMarks === 8, "max marks never below min marks", r);
  expect(r.questionKinds.length === 1 && r.questionKinds[0] === "long", "unknown question kinds dropped");
  expect(r.legibilityThreshold === 1, "thresholds kept between 0 and 1");
  expect(r.subjectRules.maths.strictness === "standard" && r.subjectRules.maths.unitsRequired === false, "bad strictness falls back, valid switches kept", r.subjectRules.maths);
  expect(r.subjectRules.english.languageWeight === "full", "untouched subjects keep defaults");
  const s = resolveAnswerCheckSettings({ scopes: [{ board: " CBSE ", medium: "English", grade: "10", subject: "" }, { board: "", medium: "x", grade: "1" }, "junk"] });
  expect(s.scopes.length === 1 && s.scopes[0].board === "CBSE", "scopes trimmed, incomplete ones dropped", s.scopes);
  expect(resolveAnswerCheckSettings(null).feedbackTone.full.length > 0, "empty settings get the default feedback tone");
  expect(resolveAnswerCheckSettings({ questionKinds: [] }).questionKinds.length === 3, "no question kinds chosen means all kinds");
}

console.log("Subjects");
{
  expect(subjectKindOf("Mathematics") === "maths", "Mathematics → maths");
  expect(subjectKindOf("ENG 6 ICSE Mathematics 2026 - 27") === "maths", "pack name with Mathematics → maths");
  expect(subjectKindOf("Physics") === "science" && subjectKindOf("Biology") === "science", "Physics, Biology → science");
  expect(subjectKindOf("Social Science") === "social_science", "Social Science is not Science");
  expect(subjectKindOf("Political Science") === "social_science", "Political Science → social science");
  expect(subjectKindOf("History") === "social_science", "History → social science");
  expect(subjectKindOf("English") === "english" && subjectKindOf("Hindi") === "english", "languages use the language rules");
  expect(subjectKindOf("गणित") === "maths", "Hindi subject name for maths");
  expect(subjectKindOf("Computer Applications") === "other" && subjectKindOf(null) === "other", "anything else → other");
}

console.log("Marking schemes");
{
  expect(schemeTotal(linear) === 5 && linear.steps.length === 5, "client example scheme adds up to 5");
  expect(schemeProblems(linear, 5).length === 0, "client example scheme has no problems");
  const over = normalizeScheme({ steps: [{ label: "A", marks: 3 }, { label: "B", marks: 3 }, { label: "C", marks: 2 }] }, 5);
  expect(schemeTotal(over) === 5, "too many marks are taken from the last steps", over.steps);
  expect(over.steps.map(s => s.marks).join(",") === "3,2", "a step left with 0 marks is dropped", over.steps);
  const under = normalizeScheme({ steps: [{ label: "A", marks: 1 }, { label: "B", marks: 1 }] }, 5);
  expect(schemeTotal(under) === 5 && under.steps[1].marks === 4, "too few marks are added to the last step", under.steps);
  const zero = normalizeScheme({ steps: [{ label: "A" }, { label: "B" }, { label: "C" }] }, 4);
  expect(schemeTotal(zero) === 4 && zero.steps.every(s => s.marks > 0), "steps without marks share the maximum", zero.steps);
  const halves = normalizeScheme({ steps: [{ label: "A", marks: 1.3 }, { label: "B", marks: 1.2 }] }, 2.5);
  expect(halves.steps.map(s => s.marks).join(",") === "1.5,1", "marks rounded to halves", halves.steps);
  const whole = normalizeScheme({ allowHalfMarks: false, steps: [{ label: "A", marks: 1.5 }, { label: "B", marks: 1.5 }] }, 3);
  expect(whole.steps.every(s => Number.isInteger(s.marks)) && schemeTotal(whole) === 3, "half marks off → whole marks only", whole.steps);
  const empty = normalizeScheme({ steps: [{ label: "  " }] }, 3);
  expect(empty.steps.length === 1 && empty.steps[0].marks === 3, "no usable steps → one step for the whole answer");
  const dupes = normalizeScheme({ steps: [{ id: "a", label: "A", marks: 1 }, { id: "a", label: "B", marks: 1 }] }, 2);
  expect(dupes.steps[0].id !== dupes.steps[1].id, "step ids are unique", dupes.steps);
  const kw = normalizeScheme({ steps: [{ label: "A", marks: 2 }], mustKeywords: ["Chlorophyll", "chlorophyll", " ", 5, "sunlight"] }, 2);
  expect(kw.mustKeywords.join("|") === "Chlorophyll|sunlight", "keywords trimmed and de-duplicated", kw.mustKeywords);
  expect(normalizeScheme({ steps: [{ label: "A", marks: 2 }], finalAnswerOnlyMarks: 9 }, 2).finalAnswerOnlyMarks === 2, "final-answer-only marks capped at the maximum");
  expect(normalizeScheme({ steps: [{ label: "A", marks: 2 }], finalAnswerOnlyMarks: "" }, 2).finalAnswerOnlyMarks === null, "blank final-answer-only marks → not used");
  const edited = { ...linear, steps: linear.steps.map((s, i) => (i === 0 ? { ...s, marks: 2 } : s)) };
  expect(schemeProblems(edited, 5).some(p => p.includes("add up to 6")), "admin edit that doesn't add up is explained", schemeProblems(edited, 5));
  expect(schemeProblems({ ...linear, allowHalfMarks: false, steps: [{ id: "a", label: "A", marks: 2.5 }, { id: "b", label: "B", marks: 2.5 }] }, 5).some(p => p.includes("whole marks")), "half marks in a whole-marks scheme are refused");
}

console.log("Marks from the AI's judgement");
{
  // The client's example: everything right except the final answer → 4/5.
  const r = applyJudgement(linear, 5, [
    { stepId: "eq", awarded: 1, comment: "Correct" },
    { stepId: "move", awarded: 1, comment: "Correct" },
    { stepId: "simp", awarded: 1, comment: "Correct" },
    { stepId: "div", awarded: 1, comment: "Correct" },
    { stepId: "final", awarded: 0, comment: "Final answer was not stated as x = 3" },
  ]);
  expect(r.total === 4 && r.correctness === "partial" && r.band === "high", "client example → 4/5, partly correct, high band", r);
  expect(r.deductions.length === 1 && r.deductions[0].marks === 1 && r.deductions[0].reason.includes("x = 3"), "one deduction with its reason", r.deductions);

  const capped = applyJudgement(linear, 5, linear.steps.map(s => ({ stepId: s.id, awarded: 3, comment: "" })));
  expect(capped.total === 5 && capped.steps.every(s => s.awarded === 1), "a step never gets more than its own marks; total never above max", capped.steps);
  const negative = applyJudgement(linear, 5, [{ stepId: "eq", awarded: -2, comment: "" }]);
  expect(negative.total === 0 && negative.correctness === "incorrect" && negative.band === "zero", "negative marks become 0");
  const unknown = applyJudgement(linear, 5, [{ stepId: "bonus", awarded: 5, comment: "" }, { stepId: "eq", awarded: 1, comment: "" }]);
  expect(unknown.total === 1, "marks for steps not in the scheme are ignored", unknown);
  const twice = applyJudgement(linear, 5, [{ stepId: "eq", awarded: 1, comment: "" }, { stepId: "eq", awarded: 0, comment: "" }]);
  expect(twice.total === 1, "a step judged twice counts once (the first)", twice);
  const halves = applyJudgement(normalizeScheme({ steps: [{ id: "a", label: "Definition", marks: 2 }, { id: "b", label: "Example", marks: 3 }] }, 5), 5, [
    { stepId: "a", awarded: 1.4, comment: "Partly right" }, { stepId: "b", awarded: 2.74, comment: "" },
  ]);
  expect(halves.total === 4 && halves.steps[0].awarded === 1.5 && halves.steps[1].awarded === 2.5, "partial marks rounded to halves", halves.steps);
  const wholeScheme = normalizeScheme({ allowHalfMarks: false, steps: [{ id: "a", label: "A", marks: 2 }] }, 2);
  expect(applyJudgement(wholeScheme, 2, [{ stepId: "a", awarded: 1.5, comment: "" }]).total === 2, "whole-marks scheme rounds 1.5 to 2");
  const noWorking = applyJudgement(linear, 5, [{ stepId: "final", awarded: 1, comment: "" }], { finalAnswerCorrect: true, workingShown: false });
  expect(noWorking.total === 2 && noWorking.finalAnswerOnlyApplied && noWorking.deductions.length === 0, "right answer, no working → final-answer-only marks", noWorking);
  const withWorking = applyJudgement(linear, 5, [{ stepId: "final", awarded: 1, comment: "" }], { finalAnswerCorrect: true, workingShown: true });
  expect(withWorking.total === 1 && !withWorking.finalAnswerOnlyApplied, "working shown → marked by steps only");
  const full = applyJudgement(linear, 5, linear.steps.map(s => ({ stepId: s.id, awarded: 1, comment: "" })));
  expect(full.correctness === "correct" && full.band === "full" && full.deductions.length === 0, "all steps right → correct, full band");
  const sum = r.deductions.reduce((a, d) => a + d.marks, 0);
  expect(sum + r.total === 5, "marks cut + marks given = maximum (no double cuts)");
}

console.log("Bands, correctness, rounding");
{
  expect(scoreBand(5, 5) === "full" && scoreBand(4, 5) === "high" && scoreBand(2, 5) === "partial" && scoreBand(1, 5) === "low" && scoreBand(0, 5) === "zero", "bands at 100 / 80 / 40 / 20 / 0 %");
  expect(scoreBand(3.75, 5) === "high" && scoreBand(1.5, 5) === "low", "band edges (75 %, 30 %)");
  expect(correctnessOf(5, 5) === "correct" && correctnessOf(0.5, 5) === "partial" && correctnessOf(0, 5) === "incorrect", "correctness from marks");
  expect(roundMarks(2.25, true) === 2.5 && roundMarks(2.24, true) === 2 && roundMarks(NaN, true) === 0, "half-mark rounding");
}

console.log("AI-written estimate");
{
  const long = "word ".repeat(60);
  expect(aiWrittenStatus(90, wordCount("x = 3")) === "inconclusive", "short answers are always inconclusive");
  expect(aiWrittenStatus(75, wordCount(long)) === "possibly_ai", "high estimate on a long answer → possibly AI");
  expect(aiWrittenStatus(10, wordCount(long)) === "likely_human", "low estimate → likely human");
  expect(aiWrittenStatus(45, wordCount(long)) === "inconclusive", "middle estimate → inconclusive");
  expect(wordCount("  two   words ") === 2 && wordCount("") === 0, "word count");
}

console.log("When a teacher must look");
{
  const s = { legibilityThreshold: 0.6, confidenceThreshold: 0.5 };
  expect(teacherReasons({ legibility: 0.9, unclearCount: 0, blank: false, confidence: 0.8 }, s).length === 0, "clear writing, confident marks → no teacher");
  expect(teacherReasons({ legibility: 0.4, unclearCount: 1, blank: false, confidence: 0.8 }, s)[0].includes("hard to read"), "hard-to-read writing → teacher");
  expect(teacherReasons({ legibility: 0.8, unclearCount: 3, blank: false, confidence: 0.8 }, s)[0].includes("could not be read"), "several unreadable parts → teacher");
  expect(teacherReasons({ legibility: 0.9, unclearCount: 0, blank: false, confidence: 0.3 }, s)[0].includes("not sure"), "unsure marks → teacher");
  expect(teacherReasons({ legibility: 0.9, unclearCount: 0, blank: true, confidence: 0.9 }, s).some(r => r.includes("blank")), "blank page → teacher");
}

console.log("Accuracy and suggested marks");
{
  const a = accuracySummary([
    { aiMarks: 4, maxMarks: 5, compareMarks: 4 },
    { aiMarks: 3.5, maxMarks: 5, compareMarks: 3 },
    { aiMarks: 2, maxMarks: 5, compareMarks: 4 },
    { aiMarks: 5, maxMarks: 5, compareMarks: null },
  ]);
  expect(a.compared === 3 && a.exact === 1 && a.withinHalf === 2 && a.aiHigher === 1 && a.aiLower === 1, "within half a mark, exact, higher, lower", a);
  expect(a.averageGap === 0.83, "average gap", a.averageGap);
  expect(accuracySummary([]).compared === 0 && accuracySummary([]).averageGap === 0, "nothing to compare");
  const range = { minMarks: 2, maxMarks: 5 };
  expect(suggestMaxMarks("long", "", range) === 5 && suggestMaxMarks("short", "a b c", range) === 2 && suggestMaxMarks("numerical", "", range) === 3, "marks by question kind");
  expect(suggestMaxMarks(null, "word ".repeat(130), range) === 5, "long model answer → more marks");
  expect(suggestMaxMarks("long", "", { minMarks: 1, maxMarks: 3 }) === 3, "suggestion stays inside the chosen range");
}

if (failed > 0) { console.error(`\n${failed} check(s) failed, ${passed} passed.`); process.exit(1); }
console.log(`\nAll ${passed} answer-checking rule checks passed.`);
