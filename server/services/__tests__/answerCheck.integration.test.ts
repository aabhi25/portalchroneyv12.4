/**
 * Answer checking pilot — end to end on a real database with a stand-in for the AI:
 * settings, the random question (written-answer only, AI fallback from notes), marking schemes
 * (drafted once, versions on edit), checking an upload (read → mark → AI-written → teacher rules →
 * marked sheet), unclear / unsure / blank answers, failures and re-checks, teacher marks,
 * practice answers at known levels, interrupted checks and deleting.
 *
 *   DATABASE_URL=<throwaway Postgres with migrations applied> ANSWER_CHECK_TEST_DB=1 DB_POOL_MAX=3 \
 *     npx tsx server/services/__tests__/answerCheck.integration.test.ts
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

type Kind = "read" | "scheme" | "mark" | "aiWritten" | "practice" | "question";

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const engine = await import("../answerCheck/engine");
  const questions = await import("../answerCheck/questions");
  const prompts = await import("../answerCheck/prompts");
  const sharp = (await import("sharp")).default;

  // ---- Stand-in AI: replies are queued per kind; every call is recorded. ----
  const queues: Record<Kind, Array<Record<string, any> | null>> = { read: [], scheme: [], mark: [], aiWritten: [], practice: [], question: [] };
  const calls: Array<{ kind: Kind; model: string; images: number; temperature?: number; user: string }> = [];
  const kindOf = (system: string): Kind =>
    system === prompts.READ_SYSTEM ? "read"
    : system === prompts.AI_WRITTEN_SYSTEM ? "aiWritten"
    : system === prompts.QUESTION_FROM_NOTES_SYSTEM ? "question"
    : system.startsWith("You are a senior board examiner") ? "scheme"
    : system.startsWith("You are an experienced, fair board examiner") ? "mark"
    : "practice";
  engine.setAnswerCheckAiFactoryForTests(async () => {
    let spent = 0;
    return {
      costUsd: () => spent,
      async json(call) {
        const kind = kindOf(call.system);
        calls.push({ kind, model: call.model, images: call.images?.length || 0, temperature: call.temperature, user: call.user });
        spent += 0.001;
        const q = queues[kind];
        // The AI-written estimate is asked for on every answer of 15+ words; default: human.
        if (!q.length && kind === "aiWritten") return { percent: 10, confidence: "low", signals: [] };
        if (!q.length) throw new Error(`stand-in AI: no ${kind} reply queued`);
        return q.shift()!;
      },
    };
  });
  const callsOf = (k: Kind) => calls.filter(c => c.kind === k).length;

  const stamp = Date.now();
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `Answer Check ${stamp}`, website: "https://school.example.com", openaiApiKey: "sk-test-not-real" } as any).returning();
  const B = biz.id as string;

  const photo = async (shade: string) => sharp({ create: { width: 800, height: 1100, channels: 3, background: shade } }).png().toBuffer();

  const linearScheme = { modelAnswer: "", questionKind: "numerical", steps: [
    { id: "s1", label: "Writes the equation", marks: 1 },
    { id: "s2", label: "Moves 4 across", marks: 1 },
    { id: "s3", label: "Simplifies to 2x = 6", marks: 1 },
    { id: "s4", label: "Divides by 2", marks: 1 },
    { id: "s5", label: "States x = 3", marks: 2 }, // 6 in total: must be trimmed to 5
  ], mustKeywords: ["x = 3"], finalAnswerOnlyMarks: 2, allowHalfMarks: true };
  const goodRead = { text: "2x + 4 = 10\n2x = 10 - 4\n2x = 6\nx = 6/2", legibility: 0.92, unclear: [], blank: false, language: "en", notes: "" };
  const markFourOfFive = { steps: [
    { stepId: "s1", awarded: 1, comment: "Correct" }, { stepId: "s2", awarded: 1, comment: "" },
    { stepId: "s3", awarded: 1, comment: "" }, { stepId: "s4", awarded: 1, comment: "" },
    { stepId: "s5", awarded: 0, comment: "Final value x = 3 not written" },
  ], finalAnswerCorrect: false, workingShown: true, correctPoints: ["Correct method"], mistakes: [], missingConcepts: [], missingKeywords: ["x = 3"],
    alternativeMethod: false, confidence: 0.85, confidenceNote: "", feedback: { summary: "Good attempt! Your working is correct.", improvement: "Write the final value of x clearly.", revision: "" }, teacherComment: "Good working — finish with x = 3." };

  console.log("Settings");
  {
    const d = await engine.getSettings(B);
    expect(d.minMarks === 2 && d.maxMarks === 5, "a new account gets the default settings");
    const saved = await engine.saveSettings(B, { minMarks: 3, maxMarks: 2, questionKinds: ["long", "bogus"], scopes: [{ board: "CBSE", medium: "English", grade: "10", subject: "Science" }] }, null);
    expect(saved.maxMarks === 3 && saved.questionKinds.join() === "long", "saved settings are cleaned up", saved);
    const again = await engine.getSettings(B);
    expect(again.scopes.length === 1 && again.scopes[0].subject === "Science", "settings are kept");
    await engine.saveSettings(B, { ...again, questionKinds: ["short", "long", "numerical"], minMarks: 2, maxMarks: 5 }, null);
    expect(!(await engine.assessmentEnabled(B)), "AI assessment starts switched off (account feature)");
    await db.update(schema.businessAccounts).set({ answerCheckingEnabled: "true" }).where(eq(schema.businessAccounts.id, B));
    expect(await engine.assessmentEnabled(B), "the account's feature switch turns it on");
    expect(!(await engine.assessmentEnabled("no-such-account")), "an unknown account is off");
  }

  console.log("Random question");
  {
    const base = { business_account_id: B, board: "CBSE", medium: "English" };
    const insert = async (row: Record<string, any>) => db.execute(
      (await import("drizzle-orm")).sql`INSERT INTO topscholar_content_chunks (business_account_id, cp_id, content_type, subject, chapter, title, board, medium, grade, content_text, source_ref, metadata)
        VALUES (${row.business_account_id}, ${row.cp_id}, ${row.content_type}, ${row.subject}, ${row.chapter}, ${row.title ?? null}, ${row.board}, ${row.medium}, ${row.grade}, ${row.content_text}, ${row.source_ref ?? null}, ${JSON.stringify(row.metadata ?? {})}::jsonb)`);
    await insert({ ...base, cp_id: "cp-sci", content_type: "question", subject: "Science", chapter: "Light", grade: "10", content_text: "Which of these is a convex lens?", source_ref: "q-mcq-1", metadata: { questionType: "single", options: [{ text: "A" }, { text: "B" }] } });
    await insert({ ...base, cp_id: "cp-sci", content_type: "question", subject: "Science", chapter: "Light", grade: "10", content_text: "True or false: light travels in straight lines.", source_ref: "q-tf", metadata: { questionType: "True/False" } });
    await insert({ ...base, cp_id: "cp-sci", content_type: "question", subject: "Science", chapter: "Light", grade: "10", content_text: "<p>Explain <b>refraction</b> of light with one example.</p>", source_ref: "q-written", metadata: { questionType: "subjective", solution: "<p>Refraction is the bending of light when it passes from one medium to another, e.g. a pencil in water looks bent.</p>" } });
    await insert({ ...base, cp_id: "cp-math", content_type: "note", subject: "Mathematics", chapter: "Linear equations", grade: "9", content_text: "A linear equation in one variable has the form ax + b = c. To solve it, move constants to one side and divide by the coefficient.", source_ref: "n1" });

    const settings = await engine.getSettings(B);
    const pick = await questions.pickRandomQuestion(B, settings, null);
    expect(pick.question?.questionKey === "cms:cp-sci:q-written", "only the written-answer question is picked (never MCQ or true/false)", pick);
    expect(pick.question?.questionText === "Explain refraction of light with one example." && pick.question?.modelAnswer.startsWith("Refraction is the bending"), "question and model answer come without HTML", pick.question);
    expect(pick.question?.subject === "Science" && pick.question?.grade === "10" && pick.question?.chapter === "Light", "class, subject and chapter come with it");
    expect((pick.question?.maxMarks ?? 0) >= 2 && (pick.question?.maxMarks ?? 9) <= 5, "max marks suggested inside the 2–5 range", pick.question?.maxMarks);
    expect(pick.looked.questions === 3 && pick.looked.writtenQuestions === 1, "it reports how many written questions it saw", pick.looked);

    const without = await questions.pickRandomQuestion(B, settings, null, Math.random, new Set(["cms:cp-sci:q-written"]));
    expect(!without.question, "a question already on the paper is not picked again", without.question?.questionKey);
    const several = await questions.pickRandomQuestions(B, settings, null, 3);
    expect(several.questions.length === 1 && several.questions[0].questionKey === "cms:cp-sci:q-written", "asking for 3 when only 1 exists gives that 1, no repeats", several.questions.map(q => q.questionKey));
    const mathOnly = { ...settings, scopes: [{ board: "CBSE", medium: "English", grade: "9", subject: "Mathematics" }] };
    const none = await questions.pickRandomQuestion(B, mathOnly, null);
    expect(!none.question && /No written-answer/.test(none.note), "no written questions and no AI → a plain explanation", none.note);
    queues.question.push({ question: "Solve 3x + 2 = 11.", modelAnswer: "3x = 9, x = 3", questionKind: "numerical" });
    const ai = { costUsd: () => 0, json: async (c: any) => { calls.push({ kind: "question", model: c.model, images: 0, user: c.user }); return queues.question.shift()!; } };
    const gen = await questions.pickRandomQuestion(B, mathOnly, ai as any);
    expect(gen.question?.source === "generated" && gen.question.questionKey.startsWith("gen:") && gen.question.chapter === "Linear equations", "no written questions → the AI sets one from the chapter notes", gen);
    expect(/chapter notes/.test(gen.note), "the screen is told the AI set the question");
    expect(calls.some(c => c.kind === "question" && c.user.includes("ax + b = c")), "the AI got the chapter's notes");
    const missing = await questions.pickRandomQuestion(B, { ...settings, scopes: [{ board: "ICSE", medium: "Hindi", grade: "7", subject: "" }] }, null);
    expect(!missing.question && /None of the chosen/.test(missing.note), "chosen classes with no content → told to change Settings", missing.note);
    const found = await questions.searchQuestions(B, { board: "CBSE", medium: "English", grade: "10", subject: "Science" }, "refraction", settings);
    expect(found.length === 1 && found[0].questionKey === "cms:cp-sci:q-written", "search finds written questions only", found.map(f => f.questionKey));
    const scopes = await questions.scopeOptions(B);
    expect(scopes.length === 2 && scopes.some(s => s.grade === "10" && s.subjects.join() === "Science"), "class list for Settings", scopes);
  }

  console.log("Marking schemes");
  let scheme: Awaited<ReturnType<typeof engine.prepareQuestion>>;
  const question = {
    questionKey: questions.customQuestionKey("Solve 2x + 4 = 10."), source: "custom" as const, questionText: "Solve 2x + 4 = 10.", modelAnswer: "",
    questionKind: "numerical" as const, board: "CBSE", medium: "English", grade: "8", subject: "Mathematics", chapter: "Linear equations", maxMarks: 5,
  };
  {
    queues.scheme.push({ ...linearScheme, modelAnswer: "2x = 6, so x = 3." });
    scheme = await engine.prepareQuestion(B, question, null);
    const s = engine.schemeOf(scheme);
    expect(s.steps.reduce((a, x) => a + x.marks, 0) === 5 && s.steps[4].marks === 1, "the AI's 6-mark scheme is trimmed to the question's 5 marks", s.steps);
    expect(scheme.status === "ai_draft" && scheme.version === 1, "first scheme = version 1, drafted by AI");
    expect(scheme.modelAnswer === "2x = 6, so x = 3." && scheme.modelAnswerByAi, "no model answer given → the AI's one is kept and labelled");
    const before = callsOf("scheme");
    const same = await engine.prepareQuestion(B, question, null);
    expect(same.id === scheme.id && callsOf("scheme") === before, "the same question again → the saved scheme, no AI call");
    expect(calls.find(c => c.kind === "scheme")?.model === "gpt-4.1", "schemes are drafted by GPT-4.1");
    queues.scheme.push({ ...linearScheme, steps: [{ id: "s1", label: "Method", marks: 2 }, { id: "s2", label: "Answer", marks: 2 }] });
    const four = await engine.prepareQuestion(B, { ...question, maxMarks: 4 }, null);
    expect(four.version === 2 && Number(four.maxMarks) === 4, "changing max marks drafts a new version", { v: four.version, m: four.maxMarks });
    queues.scheme.push(linearScheme);
    scheme = await engine.prepareQuestion(B, question, null);
    expect(scheme.version === 3 && Number(scheme.maxMarks) === 5, "back to 5 marks → version 3");
    queues.scheme.push(null);
    let threw = "";
    try { await engine.prepareQuestion(B, { ...question, questionKey: "custom:other", questionText: "Another question?" }, null); } catch (e: any) { threw = e.message; }
    expect(/could not write a marking scheme/.test(threw), "an empty AI reply gives a plain error", threw);
  }

  console.log("Checking an upload");
  let checkId = "";
  {
    queues.read.push(goodRead);
    queues.mark.push(markFourOfFive);
    queues.aiWritten.push({ percent: 80, confidence: "medium", signals: ["polished"] });
    const check = await engine.createUploadCheck({ businessAccountId: B, scheme, photos: [await photo("#ffffff"), await photo("#fafafa")], studentLabel: "Roll 12", userId: null });
    checkId = check.id;
    expect(check.status === "checking", "a new check starts as 'checking'");
    await engine.waitForIdle();
    const [row] = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.id, checkId));
    const result = row.result as any;
    expect(row.status === "done", "a clear, confident answer is done", { status: row.status, error: row.error, reasons: row.teacherReasons });
    expect(Number(row.aiMarks) === 4 && result.correctness === "partial" && result.band === "high", "client's example: 4/5, partly correct", { marks: row.aiMarks, result });
    expect(result.deductions.length === 1 && /x = 3/.test(result.deductions[0].reason), "one deduction with its reason");
    expect(result.feedback.improvement.includes("final value") && result.teacherComment.length > 0, "feedback and teacher-style remark kept");
    expect(result.schemeVersion === 3, "the check records the scheme version used");
    expect(row.readText === goodRead.text && (row.reading as any).legibility === 0.92, "what the AI read is kept");
    const aiw = row.aiWritten as any;
    expect(aiw.status === "inconclusive" && aiw.percent === 80, "a short answer is never called AI-written, even at 80 %", aiw);
    const readCall = calls.filter(c => c.kind === "read").pop()!;
    expect(readCall.images === 2 && readCall.model === "gpt-4.1" && !readCall.user.includes("Solve 2x + 4 = 10") && readCall.user.includes("Mathematics"), "both photos go to GPT-4.1 with the subject, not the question", readCall);
    expect(calls.filter(c => c.kind === "mark").pop()?.user.includes("[s5] States x = 3 — 1 mark"), "the marker sees the scheme with step ids");
    expect(calls.filter(c => c.kind === "aiWritten").pop()?.model === "gpt-4.1-mini", "the AI-written estimate uses GPT-4.1 mini");
    expect(Number(row.costUsd) > 0.0029 && (row.durationMs ?? -1) >= 0 && row.model === "gpt-4.1", "cost, time and model are recorded", { cost: row.costUsd, ms: row.durationMs });
    const imgs = await db.select().from(schema.answerCheckImages).where(eq(schema.answerCheckImages.checkId, checkId));
    expect(imgs.filter(i => i.kind === "answer").length === 2 && imgs.filter(i => i.kind === "marked").length === 1, "2 photos + 1 marked sheet stored");
    expect(imgs.every(i => !i.storageRef && i.data && i.data.length > 1000), "without a private R2 bucket the photos stay in the database");
    const marked = imgs.find(i => i.kind === "marked")!;
    const meta = await sharp(marked.data as Buffer).metadata();
    expect(meta.format === "jpeg" && (meta.width ?? 0) === 1320, "the marked sheet is a JPEG with the red strip", meta.width);
  }

  console.log("AI-written estimate on a longer answer");
  {
    const long = "Refraction is the bending of light when it goes from one medium to another medium because its speed changes. For example a pencil kept in a glass of water looks bent at the surface of water. This happens because light travels slower in water than in air.";
    queues.read.push({ ...goodRead, text: long });
    queues.mark.push({ ...markFourOfFive, steps: [{ stepId: "s1", awarded: 1 }, { stepId: "s2", awarded: 1 }, { stepId: "s3", awarded: 1 }, { stepId: "s4", awarded: 1 }, { stepId: "s5", awarded: 1 }] });
    queues.aiWritten.push({ percent: 72, confidence: "medium", signals: ["very polished"] });
    const c = await engine.createUploadCheck({ businessAccountId: B, scheme, photos: [await photo("#ffffff")], studentLabel: "", userId: null });
    await engine.waitForIdle();
    const [row] = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.id, c.id));
    expect((row.aiWritten as any).status === "possibly_ai" && Number(row.aiMarks) === 5, "a long answer can be flagged 'possibly AI' — and keeps its full marks", { aiw: row.aiWritten, marks: row.aiMarks });
  }

  console.log("When a teacher must look");
  {
    const run = async (read: any, mark: any | null) => {
      queues.read.push(read);
      if (mark) queues.mark.push(mark);
      const before = callsOf("mark");
      const c = await engine.createUploadCheck({ businessAccountId: B, scheme, photos: [await photo("#ffffff")], studentLabel: "", userId: null });
      await engine.waitForIdle();
      const [row] = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.id, c.id));
      return { row, marked: callsOf("mark") > before };
    };
    const unclear = await run({ ...goodRead, legibility: 0.3, text: "2x + [unclear] = 10", unclear: [{ where: "line 1", guess: "4" }] }, markFourOfFive);
    expect(unclear.row.status === "needs_teacher" && (unclear.row.teacherReasons as string[])[0].includes("hard to read"), "hard-to-read writing → needs a teacher", unclear.row.teacherReasons);
    expect(unclear.row.aiMarks !== null, "the AI's marks are still shown to the teacher");
    const unsure = await run(goodRead, { ...markFourOfFive, confidence: 0.2 });
    expect(unsure.row.status === "needs_teacher" && (unsure.row.teacherReasons as string[]).some(r => r.includes("not sure")), "AI unsure of its marks → needs a teacher");
    const blank = await run({ text: "", legibility: 0, unclear: [], blank: true }, null);
    expect(blank.row.status === "needs_teacher" && Number(blank.row.aiMarks) === 0 && !blank.marked, "blank page → 0, no marking call, teacher to look", { s: blank.row.status, m: blank.row.aiMarks });
    const many = await run({ ...goodRead, text: "[unclear] [unclear] [unclear] = 10", unclear: [] }, markFourOfFive);
    expect((many.row.reading as any).unclear.length === 3 && many.row.status === "needs_teacher", "every [unclear] counts even if the list forgot it");
  }

  console.log("Failures and re-checks");
  {
    queues.read.push(null);
    const c = await engine.createUploadCheck({ businessAccountId: B, scheme, photos: [await photo("#ffffff")], studentLabel: "", userId: null });
    await engine.waitForIdle();
    let [row] = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.id, c.id));
    expect(row.status === "failed" && /could not read the photos/.test(row.error || ""), "the AI failing to read → failed, with a plain reason", row.error);
    queues.read.push(goodRead); queues.mark.push(markFourOfFive);
    await engine.recheck(B, c.id);
    await engine.waitForIdle();
    [row] = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.id, c.id));
    expect(row.status === "done" && row.error === null && Number(row.aiMarks) === 4, "'Try again' after a failure works", { s: row.status, e: row.error });
    expect(Number(row.costUsd) > 0.001, "the failed attempt's cost is kept in the total");
  }

  console.log("Editing the scheme and re-checking");
  {
    let problems: string[] = [];
    try { await engine.saveSchemeEdit(B, scheme.questionKey, { scheme: { steps: [{ label: "Method", marks: 2 }, { label: "Answer", marks: 2 }] } }, null); }
    catch (e: any) { problems = e.problems || []; }
    expect(problems.some(p => p.includes("add up to 4")), "an edit that doesn't add up is refused with the reason", problems);
    try { await engine.saveSchemeEdit(B, scheme.questionKey, { scheme: { steps: [{ label: "Method", marks: 5 }, { label: "Answer", marks: 0 }] } }, null); problems = []; }
    catch (e: any) { problems = e.problems || []; }
    expect(problems.some(p => p.includes("more than 0")), "a step with 0 marks is refused", problems);
    const edited = await engine.saveSchemeEdit(B, scheme.questionKey, { scheme: {
      steps: [{ id: "m", label: "Correct method (transposing and simplifying)", marks: 3 }, { id: "a", label: "Final answer x = 3", marks: 2 }],
      mustKeywords: ["x = 3"], alternatives: ["Trial and error with x = 3 shown"], finalAnswerOnlyMarks: 1, allowHalfMarks: true,
    } }, null);
    expect(edited.version === 4 && edited.status === "approved", "an admin edit = new approved version");
    const readsBefore = callsOf("read");
    const doneCount = (await db.select().from(schema.answerChecks).where(and(eq(schema.answerChecks.businessAccountId, B), eq(schema.answerChecks.questionKey, scheme.questionKey)))).length;
    for (let i = 0; i < doneCount; i++) queues.mark.push({ ...markFourOfFive, steps: [{ stepId: "m", awarded: 3, comment: "" }, { stepId: "a", awarded: 0, comment: "Not stated" }] });
    const started = await engine.recheckQuestion(B, scheme.questionKey);
    await engine.waitForIdle();
    expect(started === doneCount, "every answer to the question is re-checked", { started, doneCount });
    expect(callsOf("read") === readsBefore, "re-checking keeps the reading (no new reading calls)");
    const [row] = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.id, checkId));
    expect(Number(row.aiMarks) === 3 && (row.result as any).schemeVersion === 4, "the first answer now has 3/5 under version 4", { m: row.aiMarks, v: (row.result as any).schemeVersion });
    const history = row.history as any[];
    expect(history.length === 1 && history[0].aiMarks === 4 && history[0].schemeVersion === 3, "the earlier 4/5 under version 3 is kept in its history", history);
    queues.read.push(goodRead); queues.mark.push({ ...markFourOfFive, steps: [{ stepId: "m", awarded: 3 }, { stepId: "a", awarded: 2 }] });
    await engine.recheck(B, checkId, { reread: true });
    await engine.waitForIdle();
    expect(callsOf("read") === readsBefore + 1, "'Read again' reads the photos again");
    const approved = await engine.approveScheme(B, scheme.questionKey, null);
    expect(approved?.status === "approved" && approved.version === 4, "approving keeps the version");
  }

  console.log("Teacher marks");
  {
    let err = "";
    try { await engine.saveTeacherMarks(B, checkId, { marks: 7, comment: "" }, null); } catch (e: any) { err = e.message; }
    expect(/between 0 and 5/.test(err), "teacher marks above the maximum are refused", err);
    await engine.saveTeacherMarks(B, checkId, { marks: 3.3, comment: "  Missed the final step  " }, null);
    let [row] = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.id, checkId));
    expect(Number(row.teacherMarks) === 3.5 && row.teacherComment === "Missed the final step" && row.teacherAt, "teacher marks rounded to halves, comment trimmed", { m: row.teacherMarks, c: row.teacherComment });
    await engine.saveTeacherMarks(B, checkId, { marks: null, comment: "" }, null);
    [row] = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.id, checkId));
    expect(row.teacherMarks === null && row.teacherComment === null, "teacher marks can be cleared");
    expect(await engine.saveTeacherMarks("someone-else", checkId, { marks: 1, comment: "" }, null) === null, "another account can't touch this check");
  }

  console.log("Practice answers");
  {
    const current = (await engine.currentScheme(B, scheme.questionKey))!;
    queues.practice.push({ answers: [
      { level: "strong", text: "2x + 4 = 10\n2x = 6\nx = 3", expectedSteps: [{ stepId: "m", awarded: 3 }, { stepId: "a", awarded: 2 }], why: "All correct" },
      { level: "weak", text: "2x = 14\nx = 7", expectedSteps: [{ stepId: "m", awarded: 0.5 }, { stepId: "a", awarded: 0 }], why: "Added 4 instead of subtracting" },
      { level: "average", text: "2x = 6", expectedSteps: [{ stepId: "m", awarded: 2 }, { stepId: "a", awarded: 0 }], why: "Stopped early" },
    ] });
    for (const t of ["2x + 4 = 10\n2x = 6\nx = 3", "2x = 6", "2x = 14\nx = 7"]) queues.read.push({ ...goodRead, text: t });
    for (const m of [5, 2, 0.5]) queues.mark.push({ ...markFourOfFive, steps: [{ stepId: "m", awarded: Math.min(3, m) }, { stepId: "a", awarded: Math.max(0, m - 3) }] });
    const rows = await engine.createPracticeChecks({ businessAccountId: B, scheme: current, levels: ["strong", "average", "weak", "ai_copied"], userId: null, batchId: "batch-1" });
    expect(rows.length === 4 && rows.every(r => r.status === "writing"), "4 placeholder rows appear at once, 'writing'");
    await engine.waitForIdle();
    const done = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.batchId, "batch-1"));
    const by = (l: string) => done.find(r => r.practiceLevel === l)!;
    expect(Number(by("strong").expectedMarks) === 5 && Number(by("average").expectedMarks) === 2 && Number(by("weak").expectedMarks) === 0.5, "expected marks come from the scheme steps", done.map(d => [d.practiceLevel, d.expectedMarks]));
    expect(by("strong").practiceText?.includes("x = 3") && by("strong").studentLabel === "Practice student A", "the practice text and a student label are kept");
    expect(["done", "needs_teacher"].includes(by("strong").status) && Number(by("strong").aiMarks) === 5, "practice answers are then checked like uploads", { s: by("strong").status, m: by("strong").aiMarks });
    expect(by("ai_copied").status === "failed" && /did not write/.test(by("ai_copied").error || ""), "a level the AI skipped is marked failed, the rest go on");
    const pages = await db.select().from(schema.answerCheckImages).where(and(eq(schema.answerCheckImages.checkId, by("weak").id), eq(schema.answerCheckImages.kind, "answer")));
    expect(pages.length === 1 && (await sharp(pages[0].data as Buffer).metadata()).format === "jpeg", "the practice answer is drawn as a handwritten page");
    expect(calls.filter(c => c.kind === "practice").pop()?.model === "gpt-4.1", "practice answers are written by GPT-4.1 (mini did not keep to the levels)");
    expect(calls.filter(c => c.kind === "read").slice(-3).every(c => c.images === 1), "the drawn pages are read like real photos");
    expect((by("weak").result as any)?.practiceWhy === "Added 4 instead of subtracting", "why the practice answer should get its marks is kept");
  }

  console.log("Interrupted checks and deleting");
  {
    const [stale] = await db.insert(schema.answerChecks).values({ businessAccountId: B, questionKey: scheme.questionKey, status: "checking", maxMarks: "5", updatedAt: new Date(Date.now() - 11 * 60 * 1000) } as any).returning();
    const view = engine.checkView(stale, null, []);
    expect(view.status === "failed" && view.interrupted && /interrupted/.test(view.error || ""), "a check stuck for over 10 minutes shows as interrupted", view);
    const fresh = engine.checkView({ ...stale, updatedAt: new Date() }, null, []);
    expect(fresh.status === "checking", "a check still running is not called failed");
    expect(await engine.deleteCheck(B, checkId), "deleting a check");
    const left = await db.select().from(schema.answerCheckImages).where(eq(schema.answerCheckImages.checkId, checkId));
    expect(left.length === 0, "its photos and marked sheet go with it");
    expect(!(await engine.deleteCheck(B, checkId)), "deleting again → not found");
  }

  console.log("No OpenAI key");
  {
    engine.setAnswerCheckAiFactoryForTests(null);
    const [noKey] = await db.insert(schema.businessAccounts).values({ name: `No key ${stamp}`, website: "https://x.example.com" } as any).returning();
    let msg = "";
    try { await engine.prepareQuestion(noKey.id, { ...question, questionKey: "custom:nokey" }, null); } catch (e: any) { msg = e.message; }
    expect(/no OpenAI key/.test(msg), "an account without a key gets a plain message", msg);
  }

  if (failed > 0) { console.error(`\n${failed} check(s) failed, ${passed} passed.`); process.exit(1); }
  console.log(`\nAll ${passed} answer-checking integration checks passed.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
