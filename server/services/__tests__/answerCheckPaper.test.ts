/**
 * Answer checking pilot — whole answer sheets, the parts with no AI and no database: reading the
 * sheet's parts, matching parts to questions (labels like "Ans 2)", out of order, continued on the
 * next page, not attempted, a part claimed twice, unknown numbers), the practice student's plan,
 * paper totals and the question list.
 *
 *   npx tsx server/services/__tests__/answerCheckPaper.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused";

let failed = 0;
let passed = 0;
function expect(cond: boolean, label: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

async function main() {
  const { assembleAnswers, matchUserText, parseMissing, parsePaperRead, readPaperUserText, tidyParts, unplacedAnswerParts } = await import("../answerCheck/prompts");
  const { cleanQuestionList, paperTotals, practicePlan, PaperError } = await import("../answerCheck/papers");

  const questions = [
    { number: "1", maxMarks: 2, questionText: "State Ohm's law." },
    { number: "2", maxMarks: 3, questionText: "Calculate the resistance: 220 V, 0.5 A." },
    { number: "3", maxMarks: 5, questionText: "Explain photosynthesis." },
    { number: "4", maxMarks: 2, questionText: "Define refraction." },
  ];

  console.log("Reading a sheet");
  const read = parsePaperRead({ parts: [
    { label: "", pages: [1], text: "(heading) Name: Riya  Roll 12", legibility: 1 },
    { label: "Ans 2)", pages: [1], text: "R = V/I = 220/0.5\nR = 440 ohm", legibility: 0.9 },
    { label: "Q1.", pages: [1, 2], text: "Current is proportional to potential difference", legibility: 0.8, unclear: [{ where: "line 2", guess: "temp" }] },
    { label: "Q3.", pages: [2], text: "Plants make food using sunlight", legibility: 0.95 },
    { label: "", pages: [3], text: "Oxygen is released. 6CO2 + 6H2O → C6H12O6 + 6O2", legibility: 0.7 },
    { label: "x", pages: [9, 0, "2"], text: "  ", legibility: 1 },
  ] }, 3);
  {
    expect(read.parts.length === 5, "empty parts are dropped", read.parts.length);
    expect(read.parts[2].pages.join() === "1,2" && read.parts[2].unclear.length === 1, "pages and unclear parts kept");
    expect(!read.blank && parsePaperRead(null, 2).blank && parsePaperRead({ parts: [] }, 2).blank, "no parts → blank sheet");
    expect(parsePaperRead({ parts: [{ label: "Q1", pages: [7], text: "x" }] }, 2).parts[0].pages.join() === "1", "page numbers outside the sheet fall back to page 1");
    expect(!readPaperUserText({ board: "CBSE", grade: "10", medium: "English", subject: "Science", chapter: "Light" }, 3).includes("Light"), "the reader gets no chapter or question");
  }

  console.log("Parts cut at pages and at labels");
  {
    const ids = [{ number: "8", externalId: "169774" }, { number: "9", externalId: "169775" }, { number: "2", externalId: null }];
    const P = (label: string, pages: number[], text: string, unclear: any[] = []) => parsePaperRead({ parts: [{ label, pages, text, legibility: 0.9, unclear }] }, 5).parts;
    const marked = tidyParts(P("8] 169774", [2], "i) a/b = 5/2\n[page 3]\nii) 4a/7b = 20/14\n169775 - Solution :- a, b, c are\n[Page 4]\nRHS = [unclear]\n[page 4]\n"), ids);
    expect(JSON.stringify(marked.map(p => [p.label, p.pages, p.text])) === JSON.stringify([["8] 169774", [2], "i) a/b = 5/2"], ["", [3], "ii) 4a/7b = 20/14"], ["169775", [3], "Solution :- a, b, c are"], ["", [4], "RHS = [unclear]"]]), "a part is cut where it goes on to another page, and where another question's ID begins a line", marked.map(p => [p.label, p.pages, p.text]));
    expect(marked.map(p => p.unclear.length).join() === "0,0,0,1", "an unclear spot stays with its piece", marked.map(p => p.unclear));
    const joined = tidyParts(P("169774 - Solution", [2, 3], "i) a/b\n9] 169775 - a, b, c are\nLHS"), ids);
    expect(joined.length === 2 && joined[1].label === "9] 169775" && joined[1].text === "a, b, c are\nLHS" && joined.every(p => p.pagesUnsure && p.pages.join() === "2,3"), "two answers run together without page marks are cut, their pages unsure", joined);
    const spelt = tidyParts(P("Q8", [1], "x = 2\nQ9) y = 3\nQ9 again\n9) is not a label\n2 x 169775 = z"), ids);
    expect(spelt.map(p => p.label).join("|") === "Q8|Q9)" && spelt[1].text === "y = 3\nQ9 again\n9) is not a label\n2 x 169775 = z", "a spelt-out number is a label; a bare one or an ID in the working is not", spelt.map(p => [p.label, p.text]));
    const same = P("169774", [2, 3], "169774 - Solution\nGiven a/b");
    expect(tidyParts(same, ids)[0] === same[0] || JSON.stringify(tidyParts(same, ids).map(p => p.text)) === JSON.stringify([same[0].text]), "its own label starts nothing new");
    expect(tidyParts(P("Q8", [1], "a\n[page 7]\nb"), ids).map(p => `${p.pages}:${p.text}`).join("|") === "1:a\nb", "a mark for a page that isn't there is dropped");
    expect(tidyParts(P("Q8", [1], "[page 1]\n"), ids).length === 0, "nothing but a mark is no part");
    const found = parseMissing({ found: [{ number: 9, page: "3" }, { number: "9", page: 1 }, { number: "4", page: 2 }, { number: "8", page: 12 }, null] }, ["8", "9"], 5);
    expect(found.size === 1 && found.get("9") === 3 && parseMissing(null, ["8"], 2).size === 0, "only questions asked about, on pages that exist", Array.from(found));
  }

  console.log("Matching parts to questions");
  {
    const m = assembleAnswers(questions, read.parts, {
      answers: [
        { number: "2", parts: [1], confidence: 0.95 },
        { number: "Q1", parts: [2], confidence: 0.9 },
        { number: "3", parts: [3, 4], confidence: 0.8, note: "Part 4 has no label but continues the answer" },
        { number: "4", parts: [2], confidence: 0.4 },
        { number: "9", parts: [0], confidence: 1 },
      ],
      notAttempted: ["4"],
      unassigned: [{ part: 0, reason: "heading" }],
    });
    const q = (n: string) => m.answers.find(a => a.number === n)!;
    expect(m.answers.map(a => a.number).join() === "1,2,3,4", "one entry per question, in the paper's order");
    expect(q("1").text.startsWith("Current is proportional") && q("1").pages.join() === "1,2", "'Q1' matched to question 1 with its pages");
    expect(q("2").text.includes("440 ohm") && q("2").confidence === 0.95, "'Ans 2)' answered before Q1 is still question 2");
    expect(q("3").text.includes("sunlight") && q("3").text.includes("Oxygen") && q("3").pages.join() === "2,3", "an unlabelled part on the next page continues question 3");
    expect(q("3").legibility === 0.7, "a question's readability is its worst part");
    expect(q("4").notAttempted && q("4").text === "", "a part already used can't be claimed again → question 4 not attempted");
    expect(m.unassigned.length === 1 && m.unassigned[0].part === 0 && m.unassigned[0].reason === "heading", "the name heading is left over, with its reason");
    expect(unplacedAnswerParts(m).length === 0, "headings and rough work are not reported as lost answers");
    const lost = assembleAnswers(questions, read.parts, { answers: [{ number: "1", parts: [2] }] });
    expect(lost.answers.filter(a => a.notAttempted).length === 3, "questions the AI didn't mention count as not attempted");
    expect(unplacedAnswerParts(lost).length === 3, "parts nobody claimed that look like answers are reported", unplacedAnswerParts(lost));
    expect(assembleAnswers(questions, read.parts, null).answers.every(a => a.notAttempted), "no matching reply → nothing attempted (and nothing invented)");
    expect(assembleAnswers(questions, [], { answers: [{ number: "1", parts: [0] }] }).answers[0].notAttempted, "parts that don't exist are ignored");
    const text = matchUserText(questions, read.parts);
    expect(text.includes("Question 3 (5 marks): Explain photosynthesis.") && text.includes('Part 1 — label "Ans 2)", page 1'), "the matcher sees the questions and the parts with labels and pages");
  }

  console.log("Practice student's plan");
  {
    const p4 = practicePlan(["1", "2", "3", "4"]);
    expect(p4.plan.map(p => p.level).join() === "strong,average,weak,skip", "4 questions: strong, average, weak, last skipped", p4.plan);
    expect(p4.writtenOrder.join() === "2,1,3", "the first two answers are written in swapped order", p4.writtenOrder);
    const p2 = practicePlan(["1", "2"]);
    expect(p2.plan.every(p => p.level !== "skip") && p2.writtenOrder.join() === "1,2", "2 questions: nothing skipped, normal order");
    expect(practicePlan(["1", "2", "3", "4", "5"]).plan.map(p => p.level).join() === "strong,average,weak,strong,skip", "levels repeat");
  }

  console.log("Paper totals");
  {
    const t = paperTotals([
      { maxMarks: 2, aiMarks: 2, teacherMarks: null, expectedMarks: 2, status: "done" },
      { maxMarks: 3, aiMarks: 1.5, teacherMarks: 2, expectedMarks: 2, status: "needs_teacher" },
      { maxMarks: 5, aiMarks: 0, teacherMarks: null, expectedMarks: 0, status: "done", reading: { notAttempted: true } },
    ]);
    expect(t.maxMarks === 10 && t.aiMarks === 3.5 && t.expectedMarks === 4, "AI and expected totals", t);
    expect(t.teacherMarks === 4, "teacher total uses the AI's marks where the teacher gave none", t.teacherMarks);
    expect(t.answered === 2 && t.notAttempted === 1 && t.needsTeacher === 1, "answered, not attempted, needs a teacher");
    expect(paperTotals([{ maxMarks: 2, aiMarks: null, teacherMarks: null, expectedMarks: null, status: "checking" }]).aiMarks === null, "no AI total until every answer is marked");
  }

  console.log("Question list");
  {
    const l = cleanQuestionList([{ number: "Q1", questionKey: "a" }, { questionKey: "b" }, { number: " 3 ", questionKey: "c" }, { number: "4" }]);
    expect(l.map(q => q.number).join() === "1,2,3", "'Q1' → 1, missing number → position, blank keys dropped", l);
    let err = "";
    try { cleanQuestionList([{ number: "1", questionKey: "a" }, { number: "Q1", questionKey: "b" }]); } catch (e: any) { err = e instanceof PaperError ? e.message : "wrong error"; }
    expect(/used twice/.test(err), "the same number twice is refused", err);
    try { cleanQuestionList([]); err = ""; } catch (e: any) { err = e.message; }
    expect(/at least one/.test(err), "an empty paper is refused");
    try { cleanQuestionList(Array.from({ length: 21 }, (_, i) => ({ questionKey: `k${i}` }))); err = ""; } catch (e: any) { err = e.message; }
    expect(/at most 20/.test(err), "more than 20 questions is refused");
  }

  if (failed > 0) { console.error(`\n${failed} check(s) failed, ${passed} passed.`); process.exit(1); }
  console.log(`\nAll ${passed} whole-paper checks passed.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
