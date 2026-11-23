/**
 * AI assessment — the client's own question files and pictures, the parts with no AI, no database
 * and no network: maths written on one line, pictures listed with their "[Picture n]" marks, the
 * files read into a paper (objective left out, sections by marks, shared board / class / subject),
 * what the AI is told about attached pictures, the drawing part of a marking reply, and the other
 * labels a student may use for a question.
 *
 *   npx tsx server/services/__tests__/answerCheckCmsQuestions.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused";

let failed = 0;
let passed = 0;
function expect(cond: boolean, label: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

const M = (inner: string) => `<math xmlns="http://www.w3.org/1998/Math/MathML">${inner}</math>`;

function questionFile(o: Record<string, unknown>) {
  return JSON.stringify({ statusCode: 200, message: "Success", isSuccess: true, result: [{ options: [], questionType: "subjective", tags: ["9", "Mh", "Mathematics", "En", "en", "Mathematics I", "Ratio and Proportion", "Maharashtra Board", "9th"], isDeleted: 0, ...o }] });
}

async function main() {
  const { cmsHtmlToText, parseCmsQuestionFiles, arrangeAsPaper, isCmsQuestionJson } = await import("../answerCheck/cmsQuestions");
  const { picturesNote, schemeUserText, markUserText, markSystem, schemeSystem, parseMark, mentionsDrawing, matchUserText, MATCH_SYSTEM } = await import("../answerCheck/prompts");
  const { questionAliases } = await import("../answerCheck/papers");
  const { normalizeScheme, resolveAnswerCheckSettings, defaultAnswerCheckSettings, DEFAULT_SUBJECT_RULES } = await import("@shared/answerCheck");

  console.log("Maths on one line");
  {
    const t = (h: string) => cmsHtmlToText(h).text;
    expect(t(`<p>Express as a ratio.</p>\n<p>${M("<mfrac><mn>72</mn><mn>100</mn></mfrac>")}</p>`) === "Express as a ratio.\n72/100", "a fraction is written a/b on its own line", t(`<p>Express as a ratio.</p>\n<p>${M("<mfrac><mn>72</mn><mn>100</mn></mfrac>")}</p>`));
    expect(t(M("<mfrac><mrow><mn>2</mn><mo>&#215;</mo><mn>20</mn></mrow><mrow><mn>5</mn><mo>&#215;</mo><mn>20</mn></mrow></mfrac><mo>=</mo><mfrac><mn>40</mn><mn>100</mn></mfrac>")) === "(2 × 20)/(5 × 20) = 40/100", "a fraction of sums keeps its brackets", t(M("<mfrac><mrow><mn>2</mn><mo>&#215;</mo><mn>20</mn></mrow><mrow><mn>5</mn><mo>&#215;</mo><mn>20</mn></mrow></mfrac><mo>=</mo><mfrac><mn>40</mn><mn>100</mn></mfrac>")));
    expect(t(M("<mfrac><mn>3</mn><msqrt><mn>2</mn></msqrt></mfrac><mo>&#62;</mo><mfrac><msqrt><mn>2</mn></msqrt><mn>1</mn></mfrac>")) === "3/√2 > √2/1", "roots and a greater-than sign survive", t(M("<mfrac><mn>3</mn><msqrt><mn>2</mn></msqrt></mfrac><mo>&#62;</mo><mfrac><msqrt><mn>2</mn></msqrt><mn>1</mn></mfrac>")));
    expect(t(M("<mfrac><mn>12</mn><mn>30</mn></mfrac><mo>&#60;</mo><mfrac><mn>15</mn><mn>30</mn></mfrac>")) === "12/30 < 15/30", "a less-than sign is not taken for a tag");
    expect(t(M("<msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msup><mfenced><mrow><mn>10</mn><mo>-</mo><mi>x</mi></mrow></mfenced><mn>2</mn></msup>")) === "x^2 + (10 - x)^2", "powers, and a bracket is not doubled", t(M("<msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msup><mfenced><mrow><mn>10</mn><mo>-</mo><mi>x</mi></mrow></mfenced><mn>2</mn></msup>")));
    expect(t(M("<mn>5</mn><mo>.</mo><mn>6</mn><mo>&#160;</mo><mi>km</mi>")) === "5.6 km", "a decimal and its unit", t(M("<mn>5</mn><mo>.</mo><mn>6</mn><mo>&#160;</mo><mi>km</mi>")));
    expect(t(M("<msub><mi>H</mi><mn>2</mn></msub><mi>O</mi>")) === "H_2O" && t("x<sup>2</sup> and H<sub>2</sub>O") === "x^2 and H_2O", "subscripts, in MathML and in plain HTML");
    expect(t(M("<mroot><mn>27</mn><mn>3</mn></mroot>")) === "3√27", "a cube root");
    expect(t("<p>One&nbsp;line</p><p>Two <b>bold</b><br/>three</p><script>x()</script>") === "One line\nTwo bold\nthree", "paragraphs and line breaks become lines; scripts are dropped");
    expect(t("") === "" && cmsHtmlToText(null).pictures.length === 0, "nothing in, nothing out");
  }

  console.log("Pictures in a question");
  {
    const r = cmsHtmlToText(`<p>In the figure, find x.</p><p><img src="https://cdn.example.com/q/fig1.png" alt="triangle"></p><p>Also see <img src='data:image/png;base64,AAAA'/></p><img>`);
    expect(r.pictures.length === 2 && r.pictures[0] === "https://cdn.example.com/q/fig1.png" && r.pictures[1].startsWith("data:image/png"), "pictures are listed in order (one without an address is skipped)", r.pictures);
    expect(r.text === "In the figure, find x.\n[Picture 1]\nAlso see [Picture 2]", "each leaves its mark where it stood", r.text);
  }

  console.log("Reading the question files");
  {
    const files = [
      { name: "169775.json", text: questionFile({ questionId: 169775, marks: 4, name: { en: "<p>Prove that …</p>" }, solutionDescription: { en: "<p>LHS = RHS</p>" } }) },
      { name: "169330.json", text: questionFile({ questionId: 169330, marks: 2, name: { en: "<p>Find the ratio of length to breadth.</p>" }, solutionDescription: { en: `<p>${M("<mfrac><mn>5600</mn><mn>700</mn></mfrac><mo>=</mo><mfrac><mn>8</mn><mn>1</mn></mfrac>")}</p>` } }) },
      { name: "169322.json", text: questionFile({ questionId: 169322, marks: 1, name: { en: "<p>Find the predecessor.</p>" }, solutionDescription: { en: "<p>3</p>" } }) },
      { name: "169318.json", text: questionFile({ questionId: 169318, marks: 1, name: { en: `<p>Reduce ${M("<mfrac><mn>72</mn><mn>100</mn></mfrac>")}</p>`, hi: "<p>हिंदी</p>" }, solutionDescription: { en: `<p>See <img src="https://cdn.example.com/a.png"></p>` } }) },
      { name: "170000.json", text: questionFile({ questionId: 170000, marks: 1, questionType: "objective", options: [{ en: "a" }, { en: "b" }], name: { en: "<p>Pick one.</p>" } }) },
      { name: "169318-again.json", text: questionFile({ questionId: 169318, marks: 1, name: { en: "<p>Duplicate</p>" } }) },
      { name: "gone.json", text: questionFile({ questionId: 169999, marks: 1, isDeleted: 1, name: { en: "<p>Deleted question</p>" } }) },
      { name: "MT Paper-1.json", text: JSON.stringify({ note: "not a question" }) },
      { name: "broken.json", text: "{ not json" },
    ];
    const r = parseCmsQuestionFiles(files);
    expect(r.questions.map(q => q.externalId).join(",") === "169318,169322,169330,169775", "lowest marks first, then by question number; a repeat and a deleted question are dropped", r.questions.map(q => q.externalId));
    expect(r.questions.map(q => `${q.section}${q.number}`).join(",") === "A1,A2,B3,C4", "numbered 1, 2, 3 … with a section per marks group", r.questions.map(q => `${q.section}${q.number}`));
    expect(r.objectiveLeftOut === 1, "multiple choice is left out and counted");
    expect(r.unreadable.join(",") === "MT Paper-1.json,broken.json", "files without a question are named", r.unreadable);
    expect(r.board === "Maharashtra Board" && r.grade === "9" && r.subject === "Mathematics" && r.medium === "English" && r.title === "Ratio and Proportion", "board, class, subject, medium and chapter from the shared tags", r);
    expect(r.questions[0].questionText === "Reduce 72/100" && r.questions[2].modelAnswer === "5600/700 = 8/1", "question and solution are read with their maths", [r.questions[0].questionText, r.questions[2].modelAnswer]);
    expect(r.questions[0].answerPictures.length === 1 && r.questions[0].modelAnswer === "See [Picture 1]" && r.questions[0].questionPictures.length === 0, "a picture in the solution belongs to the model answer");
    expect(r.questions.every(q => q.chapter === "Ratio and Proportion"), "each question carries the chapter");
    const same = arrangeAsPaper(r.questions.map(q => ({ ...q, marks: 2 })));
    expect(same.every(q => q.section === null) && same.map(q => q.number).join("") === "1234", "no sections when every question has the same marks");
    const noMarks = arrangeAsPaper([{ ...r.questions[0], marks: null, externalId: "5" }, { ...r.questions[0], marks: 3, externalId: "9" }]);
    expect(noMarks[0].externalId === "9" && noMarks[1].marks === null, "a question without marks goes last");
    const hindi = parseCmsQuestionFiles([{ name: "h.json", text: JSON.stringify([{ questionId: 1, marks: 2, questionType: "subjective", name: { hi: "<p>प्रश्न लिखिए</p>" }, solutionDescription: { hi: "<p>उत्तर</p>" }, tags: ["Hi"] }]) }]);
    expect(hindi.questions.length === 1 && hindi.medium === "Hindi" && hindi.questions[0].questionText === "प्रश्न लिखिए", "a plain list, and a file written only in Hindi", hindi);
    expect(isCmsQuestionJson(files[0].text) && !isCmsQuestionJson(files[7].text) && !isCmsQuestionJson("Q1. What is a ratio?") && !isCmsQuestionJson("{ not json"), "only the client's question files are read this way");
  }

  console.log("What the AI is told about pictures");
  {
    expect(picturesNote(undefined) === "" && picturesNote({ question: 0, answer: 0, pages: 0 }) === "", "nothing is said when no picture is attached");
    const note = picturesNote({ question: 1, answer: 2, pages: 1 });
    expect(/in this order: 1 picture of the question; then 2 pictures of the model answer \(its diagram\); then 1 photo of the student's answer page\./.test(note), "the order of the attached pictures is spelt out", note);
    expect(!/\[Picture 1\]/.test(picturesNote({ question: 0, answer: 0, pages: 2 })), "page photos alone need no word about picture marks");
    const q = { questionText: "Draw the ray diagram.", modelAnswer: "See [Picture 1]", maxMarks: 3, subject: "Science", subjectKind: "science" as const, board: "CBSE", grade: "10", medium: "English", chapter: "Light", questionKind: "long" as const };
    expect(schemeUserText(q, DEFAULT_SUBJECT_RULES.science, { question: 0, answer: 1 }).includes("Pictures attached") && !schemeUserText(q, DEFAULT_SUBJECT_RULES.science).includes("Pictures attached"), "the answer-key writer is told only when there are pictures");
    const scheme = normalizeScheme({ steps: [{ id: "s1", label: "Ray diagram with labels", marks: 3 }], needsDrawing: true }, 3);
    expect(scheme.needsDrawing === true && normalizeScheme({ steps: [{ id: "s1", label: "x", marks: 3 }] }, 3).needsDrawing === undefined, "an answer key remembers that a drawing is needed");
    const mark = markUserText(q, scheme, DEFAULT_SUBJECT_RULES.science, "[Diagram: two rays]", { question: 0, answer: 1, pages: 2 });
    expect(mark.includes("must include the drawing") && mark.includes("2 photos of the student's answer pages"), "the marker is told a drawing is needed and which photos are the student's", mark.slice(-400));
    expect(/never re-read the handwriting/.test(markSystem(defaultAnswerCheckSettings())) && /needsDrawing/.test(schemeSystem()), "the photos are for judging drawings, not for re-reading the handwriting");
    expect(mentionsDrawing("x = 4\n[Diagram: triangle ABC]") && mentionsDrawing("[ Graph of y = x ]") && !mentionsDrawing("the diagram shows") && !mentionsDrawing(null), "a drawing in what was read is spotted");
  }

  console.log("The drawing part of a marking reply");
  {
    expect(parseMark({ steps: [], drawing: { status: "partly", note: "Label C is missing." } }).drawing.status === "partly", "a drawing judgement is kept");
    expect(parseMark({ steps: [] }).drawing.status === "none" && parseMark({ steps: [], drawing: { status: "amazing" } }).drawing.status === "none" && parseMark(null).drawing.note === "", "no or odd judgement → none");
    expect(resolveAnswerCheckSettings({}).drawingsToTeacher === true && resolveAnswerCheckSettings({ drawingsToTeacher: false }).drawingsToTeacher === false, "drawings go to a teacher unless switched off");
  }

  console.log("Other labels a student may use");
  {
    const aliases = questionAliases([
      { number: "1", questionKey: "a", section: "A", externalId: "169318" },
      { number: "2", questionKey: "b", section: "A", externalId: "169321" },
      { number: "3", questionKey: "c", section: "B", externalId: "169330" },
      { number: "4", questionKey: "d" },
    ]);
    expect(aliases.get("2")?.join("|") === "A2|Section A Q2|169321" && aliases.get("3")?.[0] === "B1" && !aliases.has("4"), "the number inside the section and the client's question ID", Array.from(aliases.entries()));
    const text = matchUserText([{ number: "3", maxMarks: 2, questionText: "Find the ratio.", aliases: aliases.get("3") }, { number: "4", maxMarks: 2, questionText: "Plain." }], [{ label: "169330", pages: [1], text: "8/1", legibility: 1, unclear: [] }]);
    expect(text.includes("Question 3 (2 marks) [also labelled: B1, Section B Q1, 169330]: Find the ratio.") && text.includes("Question 4 (2 marks): Plain."), "the matcher sees them next to the question", text);
    expect(/169335/.test(MATCH_SYSTEM), "and is told what they are");
  }

  if (failed > 0) { console.error(`\n${failed} check(s) failed, ${passed} passed.`); process.exit(1); }
  console.log(`\nAll ${passed} question-file checks passed.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
