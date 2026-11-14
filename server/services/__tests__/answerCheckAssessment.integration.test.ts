/**
 * AI assessment — assessments end to end on a real database with a stand-in AI: saving an
 * assessment (answer keys drafted per question; redrafted only when a question, its marks or
 * model answer change), checks before saving, importing the client's question paper (pasted text,
 * Word, typed PDF), uploading a student's sheet (photos or a PDF, a page uploaded twice, a page
 * already used for another student), results and accuracy, the sample sheet and deleting.
 *
 *   DATABASE_URL=<throwaway Postgres with migrations applied> ANSWER_CHECK_TEST_DB=1 DB_POOL_MAX=3 \
 *     npx tsx server/services/__tests__/answerCheckAssessment.integration.test.ts
 */
if (process.env.ANSWER_CHECK_TEST_DB !== "1") {
  console.log("Skipped: set ANSWER_CHECK_TEST_DB=1 and DATABASE_URL to a throwaway database.");
  process.exit(0);
}

import { eq } from "drizzle-orm";

let failed = 0;
let passed = 0;
function expect(cond: boolean, label: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail)?.slice(0, 600)); }
}

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const engine = await import("../answerCheck/engine");
  const asmt = await import("../answerCheck/assessments");
  const prompts = await import("../answerCheck/prompts");
  const files = await import("../answerCheck/files");
  const sharp = (await import("sharp")).default;
  const { jsPDF } = await import("jspdf");

  const calls: Array<{ kind: string; user: string; images: number }> = [];
  let importReply: any = null;
  engine.setAnswerCheckAiFactoryForTests(async () => {
    let spent = 0;
    return {
      costUsd: () => spent,
      async json(call) {
        spent += 0.001;
        const kind = call.system === prompts.IMPORT_SYSTEM ? "import"
          : call.system === prompts.READ_PAPER_SYSTEM ? "paperRead"
          : call.system === prompts.MATCH_SYSTEM ? "match"
          : call.system === prompts.AI_WRITTEN_SYSTEM ? "aiWritten"
          : call.system.startsWith("You are a senior board examiner") ? "scheme"
          : call.system.startsWith("You are an experienced, fair board examiner") ? "mark"
          : "practice";
        calls.push({ kind, user: call.user, images: call.images?.length || 0 });
        if (kind === "import") return importReply;
        if (kind === "scheme") return { modelAnswer: "AI model answer", steps: [{ id: "s1", label: "Main point", marks: 1 }, { id: "s2", label: "Second point", marks: 1 }] };
        if (kind === "aiWritten") return { percent: 5, confidence: "low", signals: [] };
        if (kind === "paperRead") return { parts: [{ label: "Q1", pages: [1], text: "V = IR" }, { label: "Q2", pages: [1], text: "Bending of light" }] };
        if (kind === "match") return { answers: [{ number: "1", parts: [0], confidence: 0.9 }, { number: "2", parts: [1], confidence: 0.9 }] };
        if (kind === "mark") {
          const ids = Array.from(call.user.matchAll(/\[(\w+)\] .*? — ([\d.]+) mark/g)).map(m => ({ id: m[1], marks: Number(m[2]) }));
          return { steps: ids.map(s => ({ stepId: s.id, awarded: s.marks })), confidence: 0.9, feedback: { summary: "ok" } };
        }
        const level = /- (strong|average|weak):/.exec(call.user)?.[1] || "strong";
        return { answers: [{ level, text: `${level} answer`, expectedSteps: [], why: level }] };
      },
    };
  });
  const count = (k: string) => calls.filter(c => c.kind === k).length;

  const stamp = Date.now();
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `Assessment ${stamp}`, website: "https://school.example.com", openaiApiKey: "sk-test-not-real", answerCheckingEnabled: "true" } as any).returning();
  const B = biz.id as string;

  console.log("Checks before saving");
  {
    expect(asmt.draftProblems({ title: "", questions: [] }).length === 2, "a name and at least one question are needed");
    const p = asmt.draftProblems({ title: "T", questions: [
      { number: "1", questionText: "State Ohm's law.", maxMarks: 2, modelAnswer: "" },
      { number: "1", questionText: "x", maxMarks: 0, modelAnswer: "" },
      { number: "", questionText: "Define refraction.", maxMarks: 2, modelAnswer: "" },
    ] });
    expect(p.some(x => /used twice/.test(x)) && p.some(x => /needs its question/.test(x)) && p.some(x => /between 0.5 and 100/.test(x)) && p.some(x => /needs a number/.test(x)), "duplicate numbers, missing question, bad marks, missing number are all named", p);
    let err: string[] = [];
    try { await asmt.saveAssessment(B, { title: "", questions: [] }, null); } catch (e: any) { err = e.problems; }
    expect(err.length === 2, "saving an incomplete assessment is refused with the reasons");
  }

  console.log("Saving an assessment");
  let id = "";
  {
    const before = count("scheme");
    const row = await asmt.saveAssessment(B, {
      title: "Science Mock Test 1", mockTestId: "MT-77", board: "CBSE", medium: "English", grade: "10", subject: "Science",
      questions: [
        { number: "1", questionText: "State Ohm's law.", maxMarks: 2, modelAnswer: "V = IR at constant temperature." },
        { number: "2", questionText: "Define refraction.", maxMarks: 2, modelAnswer: "" },
      ],
    }, null);
    id = row.id;
    expect(count("scheme") - before === 2, "one answer key drafted per question");
    const v = await asmt.assessmentView(row);
    expect(v.questions.length === 2 && v.totalMarks === 4 && v.mockTestId === "MT-77", "questions, total marks and mock test ID kept", { n: v.questions.length, t: v.totalMarks });
    const q1 = v.questions[0].scheme!, q2 = v.questions[1].scheme!;
    expect(q1.modelAnswer === "V = IR at constant temperature." && !q1.modelAnswerByAi, "the given model answer is used as it is");
    expect(q2.modelAnswer === "AI model answer" && q2.modelAnswerByAi, "a blank model answer is written by the AI and labelled");
    expect(v.questions[0].questionKey.startsWith(`asmt:${id}:`) && q1.subject === "Science" && q1.grade === "10", "each question has its own key and the test's class");
    expect(calls.filter(c => c.kind === "scheme").pop()!.user.includes("Science"), "the AI drafts with the class and subject");

    // Saving again without changes: no new drafts. Changing one question: only that one.
    const keys = v.questions.map(q => ({ number: q.number, questionText: q.scheme!.questionText, maxMarks: q.scheme!.maxMarks, modelAnswer: q.scheme!.modelAnswer, questionKey: q.questionKey }));
    const b2 = count("scheme");
    await asmt.saveAssessment(B, { title: "Science Mock Test 1", questions: keys }, null, id);
    expect(count("scheme") === b2, "saving unchanged questions drafts nothing");
    await asmt.saveAssessment(B, { title: "Science Mock Test 1", questions: [{ ...keys[0], modelAnswer: "V = IR, at constant temperature, for a metallic conductor." }, { ...keys[1], modelAnswer: "" }] }, null, id);
    expect(count("scheme") === b2 + 1, "changing one model answer redrafts only that question (a blank AI answer stays)");
    const after = await asmt.assessmentView((await asmt.getAssessment(B, id))!);
    expect(after.questions[0].scheme!.version === 2 && after.questions[1].scheme!.version === 1, "the changed question has a new answer-key version", after.questions.map(q => q.scheme!.version));
    expect(after.questions.every(q => q.questionKey === keys.find(k => k.number === q.number)!.questionKey), "questions keep their keys when edited");
    await asmt.saveAssessment(B, { title: "Science Mock Test 1", questions: [...keys.slice(0, 1).map(k => ({ ...k, modelAnswer: "V = IR, at constant temperature, for a metallic conductor." })), { number: "3", questionText: "What is a lens?", maxMarks: 1, modelAnswer: "A transparent curved piece of glass." }] }, null, id);
    const third = await asmt.assessmentView((await asmt.getAssessment(B, id))!);
    expect(third.questions.map(q => q.number).join() === "1,3" && third.totalMarks === 3, "questions can be removed and added", third.questions.map(q => q.number));
    expect(await asmt.getAssessment("someone-else", id) === null, "another account can't open it");
    // Back to two questions for the sheets below.
    await asmt.saveAssessment(B, { title: "Science Mock Test 1", questions: keys.map(k => ({ ...k, modelAnswer: k.number === "2" ? "" : "V = IR, at constant temperature, for a metallic conductor." })) }, null, id);
  }

  console.log("Importing the client's question paper");
  {
    importReply = { title: "Mock 2", board: "CBSE", grade: "10", medium: "English", subject: "Physics", questions: [
      { number: "Q1", question: "State Ohm's law.", marks: "2", modelAnswer: "V = IR", modelAnswerFrom: "document" },
      { number: "2", question: "Which is a conductor? (a) wood (b) copper", marks: 1, modelAnswer: "(b)", objective: true },
      { number: "3", question: "Define resistance.", marks: null, modelAnswer: "Opposition to current.", modelAnswerFrom: "ai" },
      { number: "3", question: "x", marks: 2 },
    ] };
    const pasted = await asmt.importQuestions(B, { text: "Q1. State Ohm's law. [2]\nAns: V = IR", files: [] });
    expect(pasted.title === "Mock 2" && pasted.questions.length === 3 && pasted.questions[0].number === "1" && pasted.questions[0].marks === 2, "pasted text → questions; 'Q1' → 1, marks read", pasted.questions.map(q => [q.number, q.marks]));
    expect(pasted.questions[1].objective && pasted.questions[2].modelAnswerByAi && pasted.questions[2].marks === null, "objective questions flagged, AI-written answers flagged, missing marks left blank");
    expect(calls.filter(c => c.kind === "import").pop()!.user.includes("State Ohm's law"), "the pasted text reaches the AI");

    const XLSX: any = await import("xlsx");
    const CFB = (XLSX.default ?? XLSX).CFB;
    const z = CFB.utils.cfb_new();
    CFB.utils.cfb_add(z, "/word/document.xml", Buffer.from('<w:document><w:body><w:p><w:r><w:t>Q1. Define power. (2 marks)</w:t></w:r></w:p><w:p><w:r><w:t>Answer: rate of doing work &amp; P = W/t</w:t></w:r></w:p></w:body></w:document>'));
    const docx = { name: "paper.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: Buffer.from(CFB.write(z, { type: "buffer", fileType: "zip" })) };
    expect((await files.docxText(docx)) === "Q1. Define power. (2 marks)\nAnswer: rate of doing work & P = W/t", "a Word file's text, one line per paragraph");
    await asmt.importQuestions(B, { files: [docx] });
    expect(calls.filter(c => c.kind === "import").pop()!.user.includes("Define power"), "a Word file is read as text");

    const pdf = new jsPDF();
    pdf.text("Q1. State Ohm's law. (2 marks) Answer: V = IR at constant temperature for a conductor.", 10, 10, { maxWidth: 180 });
    pdf.text("Q2. Define refraction. (2 marks) Answer: bending of light when it passes from one medium to another.", 10, 40, { maxWidth: 180 });
    pdf.text("Q3. What is the SI unit of resistance? (1 mark) Answer: ohm. Q4. Define current. (1 mark) Answer: rate of flow of charge.", 10, 70, { maxWidth: 180 });
    const typedPdf = { name: "paper.pdf", mime: "application/pdf", data: Buffer.from(pdf.output("arraybuffer")) };
    await asmt.importQuestions(B, { files: [typedPdf] });
    const last = calls.filter(c => c.kind === "import").pop()!;
    expect(last.user.includes("Define refraction") && last.images === 0, "a typed PDF is read as text (no photos needed)", { images: last.images });
    const scanned = new jsPDF();
    scanned.rect(10, 10, 50, 50);
    await asmt.importQuestions(B, { files: [{ name: "scan.pdf", mime: "application/pdf", data: Buffer.from(scanned.output("arraybuffer")) }] });
    expect(calls.filter(c => c.kind === "import").pop()!.images === 1, "a scanned PDF (no text) is read from its page images");
    importReply = { questions: [] };
    let err = "";
    try { await asmt.importQuestions(B, { text: "hello", files: [] }); } catch (e: any) { err = e.message; }
    expect(/No questions were found/.test(err), "nothing found → a plain message", err);
  }

  console.log("Uploading a student's answer sheet");
  let sheetId = "";
  {
    const row = (await asmt.getAssessment(B, id))!;
    const page = (shade: string) => sharp({ create: { width: 900, height: 1200, channels: 3, background: shade } }).jpeg().toBuffer();
    const p1 = await page("#ffffff"), p2 = await page("#f2f2f2");
    const out = await asmt.checkSheet({ businessAccountId: B, assessment: row, files: [
      { name: "p1.jpg", mime: "image/jpeg", data: p1 }, { name: "p2.jpg", mime: "image/jpeg", data: p2 }, { name: "p1-again.jpg", mime: "image/jpeg", data: p1 },
    ], studentName: "Riya", rollNo: "12", userId: null });
    sheetId = out.paper.id;
    expect(out.pages === 2 && out.warnings.some(w => /uploaded twice/.test(w)), "a page uploaded twice is checked once, with a note", out);
    await engine.waitForIdle();
    let v = await asmt.assessmentView(row);
    const sheet = v.sheets.find(s => s.id === sheetId)!;
    expect(sheet.studentLabel === "Riya" && sheet.rollNo === "12" && sheet.totals.aiMarks === 4 && sheet.status === "done", "student, roll no. and total on the results", sheet);
    expect(v.stats.checked === 1 && v.stats.averageMarks === 4, "results counted and averaged", v.stats);

    const pdf = new jsPDF();
    pdf.text("Q1 V = IR", 10, 10);
    pdf.addPage();
    pdf.text("Q2 bending of light", 10, 10);
    const second = await asmt.checkSheet({ businessAccountId: B, assessment: row, files: [{ name: "sheet.pdf", mime: "application/pdf", data: Buffer.from(pdf.output("arraybuffer")) }, { name: "p2.jpg", mime: "image/jpeg", data: p2 }], studentName: "Arjun", rollNo: "", userId: null });
    expect(second.pages === 3, "a PDF's pages are added in order (2 PDF pages + 1 photo)", second.pages);
    expect(second.warnings.some(w => /already uploaded for Riya/.test(w)), "a page already used for another student is pointed out", second.warnings);
    await engine.waitForIdle();
    expect(calls.filter(c => c.kind === "paperRead").pop()!.images === 3, "all 3 pages go to the reader");
    let bad = "";
    try { await asmt.checkSheet({ businessAccountId: B, assessment: row, files: [{ name: "notes.txt", mime: "text/plain", data: Buffer.from("hi") }], studentName: "", rollNo: "", userId: null }); } catch (e: any) { bad = e.message; }
    expect(/use photos/.test(bad), "other file types are refused with a plain message", bad);

    const [answer] = (await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.paperId, sheetId))).filter(c => c.questionNumber === "1");
    await engine.saveTeacherMarks(B, answer.id, { marks: 1, comment: "" }, null);
    v = await asmt.assessmentView(row);
    expect(v.stats.teacher.compared === 1 && v.stats.teacher.withinHalf === 0, "accuracy against the teacher's marks", v.stats.teacher);
    const sample = await asmt.sampleSheet(B, row, null);
    expect(sample.assessmentId === id && sample.source === "practice", "a sample sheet belongs to the assessment");
    await engine.waitForIdle();
    const list = await asmt.listAssessments(B);
    expect(list.length === 1 && list[0].sheetCount === 3 && list[0].totalMarks === 4 && list[0].questionCount === 2, "the list shows questions, marks and sheets", list[0]);
  }

  console.log("Deleting");
  {
    expect(await asmt.deleteAssessment(B, id), "deleting the assessment");
    const sheets = await db.select().from(schema.answerPapers).where(eq(schema.answerPapers.assessmentId, id));
    const answers = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.paperId, sheetId));
    expect(sheets.length === 0 && answers.length === 0, "its sheets and their marks go with it");
    expect(!(await asmt.deleteAssessment(B, id)), "deleting again → not found");
  }

  if (failed > 0) { console.error(`\n${failed} check(s) failed, ${passed} passed.`); process.exit(1); }
  console.log(`\nAll ${passed} assessment checks passed.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
