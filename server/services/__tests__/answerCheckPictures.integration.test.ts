/**
 * AI assessment — the client's question files and question pictures end to end on a real database
 * with a stand-in AI: importing question files without the AI (sections, pictures fetched, a
 * picture that can't be fetched), saving an assessment with pictures (kept with the question, the
 * answer key written with them in view, rewritten only when they change), marking a sheet with the
 * question's pictures and the student's page in view, drawings sent to a teacher (and the switch
 * that stops that), the client's question IDs offered to the matcher, and deleting.
 *
 *   DATABASE_URL=<throwaway Postgres with migrations applied> ANSWER_CHECK_TEST_DB=1 DB_POOL_MAX=3 \
 *     npx tsx server/services/__tests__/answerCheckPictures.integration.test.ts
 */
if (process.env.ANSWER_CHECK_TEST_DB !== "1") {
  console.log("Skipped: set ANSWER_CHECK_TEST_DB=1 and DATABASE_URL to a throwaway database.");
  process.exit(0);
}

import { and, eq } from "drizzle-orm";

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
  const pictures = await import("../answerCheck/pictures");
  const sharp = (await import("sharp")).default;

  const calls: Array<{ kind: string; user: string; images: number }> = [];
  let readText = "x = 4";
  let drawing: any = undefined;
  let needsDrawing = false;
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
          : "other";
        calls.push({ kind, user: call.user, images: call.images?.length || 0 });
        if (kind === "import") return { questions: [{ number: "1", question: "Typed question from a paper?", marks: 2, modelAnswer: "Typed answer" }] };
        if (kind === "scheme") return { modelAnswer: "AI model answer", steps: [{ id: "s1", label: "Main point", marks: 1 }, { id: "s2", label: "Diagram", marks: 1 }], needsDrawing: needsDrawing && !!call.images?.length };
        if (kind === "aiWritten") return { percent: 5, confidence: "low", signals: [] };
        if (kind === "paperRead") return { parts: [{ label: "169001", pages: [1], text: readText }, { label: "2", pages: [2], text: "Second answer" }] };
        if (kind === "match") return { answers: [{ number: "1", parts: [0], confidence: 0.9 }, { number: "2", parts: [1], confidence: 0.9 }] };
        if (kind === "mark") {
          const ids = Array.from(call.user.matchAll(/\[(\w+)\] .*? — ([\d.]+) mark/g)).map(m => ({ id: m[1], marks: Number(m[2]) }));
          return { steps: ids.map(s => ({ stepId: s.id, awarded: s.marks })), confidence: 0.9, feedback: { summary: "ok" }, ...(drawing ? { drawing } : {}) };
        }
        return {};
      },
    };
  });
  const count = (k: string) => calls.filter(c => c.kind === k).length;
  const last = (k: string) => calls.filter(c => c.kind === k).slice(-1)[0];

  const png = async (color: string) => sharp({ create: { width: 320, height: 200, channels: 3, background: color } }).png().toBuffer();
  const dataUrl = async (color: string) => `data:image/png;base64,${(await png(color)).toString("base64")}`;
  const page = async (color: string) => ({ name: `${color}.jpg`, mime: "image/jpeg", data: await sharp({ create: { width: 600, height: 800, channels: 3, background: color } }).jpeg().toBuffer() });

  const stamp = Date.now();
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `Pictures ${stamp}`, website: "https://school.example.com", answerCheckingEnabled: "true" } as any).returning();
  const B = biz.id as string;
  const cmsFile = (o: Record<string, unknown>) => ({ name: `${o.questionId}.json`, mime: "application/json", data: Buffer.from(JSON.stringify({ statusCode: 200, result: [{ options: [], questionType: "subjective", tags: ["10", "Science", "CBSE", "En", "Light"], ...o }] })) });

  console.log("Importing the client's question files");
  let imported: Awaited<ReturnType<typeof asmt.importQuestions>>;
  {
    const before = calls.length;
    imported = await asmt.importQuestions(B, { files: [
      cmsFile({ questionId: 169002, marks: 3, name: { en: `<p>In the figure, name the angle.</p><p><img src="${await dataUrl("#3366cc")}"></p>` }, solutionDescription: { en: `<p>Angle of incidence.</p><p><img src="${await dataUrl("#cc3333")}"><img src="https://localhost/never.png"></p>` } }),
      cmsFile({ questionId: 169001, marks: 1, name: { en: "<p>Solve x + 1 = 5.</p>" }, solutionDescription: { en: "<p>x = 4</p>" } }),
      cmsFile({ questionId: 169003, marks: 1, questionType: "objective", options: [{ en: "a" }, { en: "b" }], name: { en: "<p>Pick one</p>" } }),
      { name: "MT Paper-1.txt", mime: "text/plain", data: Buffer.from("Section A\n1. 169001") },
    ] });
    expect(calls.length === before && imported.costUsd === 0, "the question files are read without the AI (an account with no AI key can import them)");
    expect(imported.questions.map(q => `${q.section}${q.number}:${q.externalId}`).join(",") === "A1:169001,B2:169002", "arranged by marks into sections, numbered on", imported.questions.map(q => `${q.section}${q.number}:${q.externalId}`));
    const q2 = imported.questions[1];
    expect(q2.questionImages?.length === 1 && q2.answerImages?.length === 1 && q2.questionImages[0].startsWith("data:image/jpeg;base64,"), "pictures come back shrunk, ready to show", [q2.questionImages?.length, q2.answerImages?.length]);
    expect(q2.question.includes("[Picture 1]") && q2.modelAnswer.includes("[Picture 2]"), "each picture's place is marked in the text", [q2.question, q2.modelAnswer]);
    const notes = (imported.notes || []).join(" ");
    expect(/2 questions read/.test(notes) && /1 question has pictures/.test(notes) && /1 multiple-choice/.test(notes) && /1 picture could not be downloaded/.test(notes) && /MT Paper-1\.txt was not needed/.test(notes), "plain notes: what was read, left out, not downloaded, not needed", notes);
    expect(imported.board === "CBSE" && imported.grade === "10" && imported.subject === "Science" && imported.medium === "English", "the test's details are filled in from the files");
    let refused = "";
    try { await asmt.importQuestions(B, { files: [{ name: "other.json", mime: "application/json", data: Buffer.from(JSON.stringify({ hello: 1 })) }] }); } catch (e: any) { refused = e.message; }
    expect(/no question was found/.test(refused), "a data file that isn't a question file says so", refused);
    const both = await asmt.importQuestions(B, { text: "1. Typed question from a paper? (2 marks)", files: [cmsFile({ questionId: 169009, marks: 1, name: { en: "<p>From a file.</p>" }, solutionDescription: { en: "<p>Yes</p>" } })] });
    expect(both.questions.length === 2 && both.questions[0].externalId === "169009" && both.questions[1].number === "2" && count("import") === 1, "question files and a pasted paper together: files first, the rest numbered on", both.questions.map(q => q.number));
  }

  console.log("Saving an assessment with pictures");
  let id = "";
  let keys: string[] = [];
  {
    needsDrawing = true;
    const before = count("scheme");
    const row = await asmt.saveAssessment(B, {
      title: "Light test", board: imported.board, grade: imported.grade, medium: imported.medium, subject: imported.subject,
      questions: imported.questions.map(q => ({
        number: q.number, questionText: q.question, maxMarks: q.marks!, modelAnswer: q.modelAnswer, section: q.section, externalId: q.externalId,
        questionImages: (q.questionImages || []).map(data => ({ data })), answerImages: (q.answerImages || []).map(data => ({ data })),
      })),
    }, null);
    id = row.id;
    const v = await asmt.assessmentView(row);
    keys = v.questions.map(q => q.questionKey);
    expect(count("scheme") === before + 2, "an answer key is written for each question");
    const withPictures = calls.filter(c => c.kind === "scheme").slice(-2).find(c => c.images === 2);
    expect(!!withPictures && withPictures.user.includes("1 picture of the question; then 1 picture of the model answer"), "the answer key of the picture question is written with both pictures in view", calls.filter(c => c.kind === "scheme").slice(-2).map(c => c.images));
    expect(v.questions[1].scheme?.questionImages.length === 1 && v.questions[1].scheme?.answerImages.length === 1 && v.questions[0].scheme?.questionImages.length === 0, "the pictures are kept with their question", v.questions.map(q => [q.scheme?.questionImages.length, q.scheme?.answerImages.length]));
    expect(v.questions[1].section === "B" && v.questions[1].externalId === "169002" && v.questions[0].section === "A", "section and the client's question ID are kept");
    expect(v.questions[1].scheme?.scheme.needsDrawing === true, "the answer key says the answer needs a drawing");
    const rows = await db.select().from(schema.answerCheckImages).where(and(eq(schema.answerCheckImages.businessAccountId, B), eq(schema.answerCheckImages.questionKey, keys[1])));
    expect(rows.length === 2 && rows.every(r => r.contentType === "image/jpeg" && r.byteSize > 0), "stored as private pictures of that question");

    // Saving again with the same pictures: nothing is rewritten.
    const again = (pics: { q: any[]; a: any[] }) => asmt.saveAssessment(B, {
      title: "Light test", board: "CBSE", grade: "10", medium: "English", subject: "Science",
      questions: v.questions.map((q, i) => ({
        number: q.number, questionText: q.scheme!.questionText, maxMarks: q.scheme!.maxMarks, modelAnswer: q.scheme!.modelAnswer, questionKey: q.questionKey, section: q.section, externalId: q.externalId,
        ...(i === 1 ? { questionImages: pics.q, answerImages: pics.a } : {}),
      })),
    }, null, id);
    const kept = { q: v.questions[1].scheme!.questionImages.map(pid => ({ id: pid })), a: v.questions[1].scheme!.answerImages.map(pid => ({ id: pid })) };
    const b2 = count("scheme");
    await again(kept);
    expect(count("scheme") === b2, "saving with the same pictures rewrites no answer key");
    await again({ q: kept.q, a: [...kept.a, { data: await dataUrl("#22aa55") }] });
    expect(count("scheme") === b2 + 1 && last("scheme").images === 3, "adding a diagram rewrites that question's answer key, with the new picture in view", [count("scheme") - b2, last("scheme").images]);
    const v2 = await asmt.assessmentView((await asmt.getAssessment(B, id))!);
    expect(v2.questions[1].scheme?.answerImages.length === 2 && v2.questions[1].scheme?.answerImages[0] === kept.a[0].id, "the kept picture stays first, the new one follows");
    await again({ q: [], a: [{ id: v2.questions[1].scheme!.answerImages[1] }, { id: "not-a-real-id" }] });
    const v3 = await asmt.assessmentView((await asmt.getAssessment(B, id))!);
    expect(v3.questions[1].scheme?.questionImages.length === 0 && v3.questions[1].scheme?.answerImages.length === 1, "removing pictures removes them (an unknown id is ignored)", [v3.questions[1].scheme?.questionImages.length, v3.questions[1].scheme?.answerImages.length]);
    let bad = "";
    try { await again({ q: [{ data: "data:image/png;base64,AAAA" }], a: [] }); } catch (e: any) { bad = e.message; }
    expect(/Question 2/.test(bad), "a file that isn't a picture is refused, naming the question", bad);
  }

  console.log("Marking with pictures in view");
  let paperId = "";
  {
    const row = (await asmt.getAssessment(B, id))!;
    await pictures.syncQuestionPictures(B, keys[1], "question_picture", [{ data: await dataUrl("#3366cc") }]);
    drawing = { status: "partly", note: "The normal is not labelled." };
    const out = await asmt.checkSheet({ businessAccountId: B, assessment: row, files: [await page("#ffffff"), await page("#f4f4f4")], studentName: "Asha", rollNo: "7", userId: null });
    paperId = out.paper.id;
    await engine.waitForIdle();
    const match = last("match");
    expect(match.user.includes("[also labelled: A1, Section A Q1, 169001]") && match.user.includes("[also labelled: B1, Section B Q1, 169002]"), "the matcher is offered the section numbers and the client's question IDs", match.user.slice(0, 300));
    const marks = calls.filter(c => c.kind === "mark").slice(-2);
    const plain = marks.find(c => c.user.includes("Solve x + 1 = 5"))!;
    const pictured = marks.find(c => c.user.includes("name the angle"))!;
    expect(plain.images === 0 && !plain.user.includes("Pictures attached"), "a question without pictures or drawings is marked from text alone", plain.images);
    expect(pictured.images === 3 && pictured.user.includes("1 picture of the question; then 1 picture of the model answer (its diagram); then 1 photo of the student's answer page"), "the picture question is marked with its figure, the correct diagram and the student's page", [pictured.images, pictured.user.slice(-260)]);
    const checks = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.paperId, paperId));
    const c2 = checks.find(c => c.questionNumber === "2")!;
    const c1 = checks.find(c => c.questionNumber === "1")!;
    expect(c2.status === "needs_teacher" && (c2.teacherReasons || []).some(r => /drawing/.test(r)) && (c2.result as any).drawing.status === "partly" && (c2.result as any).drawingExpected === true, "an answer with a drawing goes to a teacher, with what the AI saw", [c2.status, c2.teacherReasons]);
    expect((c1.result as any).drawingExpected === false && (c2.result as any).drawing.note === "The normal is not labelled.", "only the picture question expects a drawing; the AI's note on it is kept", [(c1.result as any).drawingExpected, (c2.result as any).drawing]);
    const { paperView } = await import("../answerCheck/papers");
    const [paper] = await db.select().from(schema.answerPapers).where(eq(schema.answerPapers.id, paperId));
    const view = await paperView(paper);
    expect(view.checks.find(c => c.questionNumber === "2")?.scheme?.questionImages.length === 1, "the result page gets the question's pictures");

    // The student drew something on a question that asks for no drawing: the page is shown too.
    drawing = undefined;
    readText = "x = 4\n[Diagram: number line with 4 marked]";
    needsDrawing = false;
    await engine.saveSchemeEdit(B, keys[0], { scheme: { steps: [{ id: "s1", label: "x = 4", marks: 1 }] } }, null);
    const { rerunPaper } = await import("../answerCheck/papers");
    await rerunPaper(B, paperId);
    await engine.waitForIdle();
    const sketch = calls.filter(c => c.kind === "mark").slice(-2).find(c => c.user.includes("Solve x + 1 = 5"))!;
    expect(sketch.images === 1 && sketch.user.includes("1 photo of the student's answer page"), "a drawing the student added brings the page photo to the marker", sketch.images);

    // Switched off: drawings no longer go to a teacher (unless the AI couldn't see the drawing).
    await engine.saveSettings(B, { drawingsToTeacher: false }, null);
    drawing = { status: "correct", note: "" };
    await rerunPaper(B, paperId);
    await engine.waitForIdle();
    let now = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.paperId, paperId));
    expect(now.every(c => c.status === "done"), "with the switch off a correct drawing is not sent to a teacher", now.map(c => [c.status, c.teacherReasons]));
    drawing = { status: "unclear", note: "Too faint." };
    await rerunPaper(B, paperId);
    await engine.waitForIdle();
    now = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.paperId, paperId));
    expect(now.find(c => c.questionNumber === "2")?.status === "needs_teacher" && (now.find(c => c.questionNumber === "2")?.teacherReasons || []).some(r => /could not see the drawing/.test(r)), "a drawing the AI can't see always goes to a teacher");
  }

  console.log("Deleting");
  {
    // A question taken out of the assessment loses its pictures; deleting the assessment removes the rest.
    const row = (await asmt.getAssessment(B, id))!;
    const v = await asmt.assessmentView(row);
    await pictures.syncQuestionPictures(B, keys[0], "question_picture", [{ data: await dataUrl("#999999") }]);
    await asmt.saveAssessment(B, { title: "Light test", questions: [{ number: "2", questionText: v.questions[1].scheme!.questionText, maxMarks: 3, modelAnswer: v.questions[1].scheme!.modelAnswer, questionKey: keys[1] }] }, null, id);
    const left = await db.select({ key: schema.answerCheckImages.questionKey }).from(schema.answerCheckImages).where(and(eq(schema.answerCheckImages.businessAccountId, B), eq(schema.answerCheckImages.kind, "question_picture")));
    expect(left.length > 0 && left.every(r => r.key === keys[1]), "a question taken out of the assessment loses its pictures", left);
    expect(await asmt.deleteAssessment(B, id), "deleting the assessment");
    const rest = await db.select({ id: schema.answerCheckImages.id }).from(schema.answerCheckImages).where(eq(schema.answerCheckImages.businessAccountId, B));
    expect(rest.length === 0, "its questions' pictures and its sheets' photos go with it", rest.length);
  }

  await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, B));
  if (failed > 0) { console.error(`\n${failed} check(s) failed, ${passed} passed.`); process.exit(1); }
  console.log(`\nAll ${passed} question-picture checks passed.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
