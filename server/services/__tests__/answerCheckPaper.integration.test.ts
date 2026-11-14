/**
 * Answer checking pilot — whole answer sheets end to end on a real database with a stand-in AI:
 * the sheet is read once (questions not shown), parts are matched to questions (out of order,
 * continued on the next page, not attempted), each answer is marked on the pages it was found on,
 * unsure matches and possibly-missed answers go to a teacher, reading again replaces the results,
 * practice sheets (mixed levels, swapped order, a skipped question), failures and deleting.
 *
 *   DATABASE_URL=<throwaway Postgres with migrations applied> ANSWER_CHECK_TEST_DB=1 DB_POOL_MAX=3 \
 *     npx tsx server/services/__tests__/answerCheckPaper.integration.test.ts
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

type Kind = "paperRead" | "match" | "scheme" | "mark" | "aiWritten" | "practice";

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const engine = await import("../answerCheck/engine");
  const papers = await import("../answerCheck/papers");
  const prompts = await import("../answerCheck/prompts");
  const sharp = (await import("sharp")).default;

  const queues: Record<Kind, Array<Record<string, any> | null>> = { paperRead: [], match: [], scheme: [], mark: [], aiWritten: [], practice: [] };
  const calls: Array<{ kind: Kind; model: string; images: number; user: string }> = [];
  const kindOf = (system: string): Kind =>
    system === prompts.READ_PAPER_SYSTEM ? "paperRead"
    : system === prompts.MATCH_SYSTEM ? "match"
    : system === prompts.AI_WRITTEN_SYSTEM ? "aiWritten"
    : system.startsWith("You are a senior board examiner") ? "scheme"
    : system.startsWith("You are an experienced, fair board examiner") ? "mark"
    : "practice";
  engine.setAnswerCheckAiFactoryForTests(async () => {
    let spent = 0;
    return {
      costUsd: () => spent,
      async json(call) {
        const kind = kindOf(call.system);
        calls.push({ kind, model: call.model, images: call.images?.length || 0, user: call.user });
        spent += 0.001;
        if (kind === "aiWritten") return { percent: 10, confidence: "low", signals: [] };
        if (kind === "mark") {
          // Full marks for every step, unless the student's answer says WRONG.
          const ids = Array.from(call.user.matchAll(/\[(\w+)\] .*? — ([\d.]+) mark/g)).map(m => ({ id: m[1], marks: Number(m[2]) }));
          const wrong = /"""[\s\S]*WRONG[\s\S]*"""/.test(call.user);
          return { steps: ids.map(s => ({ stepId: s.id, awarded: wrong ? 0 : s.marks, comment: "" })), confidence: 0.9, feedback: { summary: "ok" } };
        }
        if (kind === "practice") {
          // Strong: every step; average: the first step only; weak: nothing.
          const level = /- (strong|average|weak):/.exec(call.user)?.[1] || "strong";
          const ids = Array.from(call.user.matchAll(/\[(\w+)\] .*? — ([\d.]+) mark/g)).map(m => ({ id: m[1], marks: Number(m[2]) }));
          const steps = ids.map((s, i) => ({ stepId: s.id, awarded: level === "strong" || (level === "average" && i === 0) ? s.marks : 0 }));
          return { answers: [{ level, text: `${level} answer text`, expectedSteps: steps, why: level }] };
        }
        const q = queues[kind];
        if (!q.length) throw new Error(`stand-in AI: no ${kind} reply queued`);
        return q.shift()!;
      },
    };
  });
  const callsOf = (k: Kind) => calls.filter(c => c.kind === k).length;

  const stamp = Date.now();
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `Paper ${stamp}`, website: "https://school.example.com", openaiApiKey: "sk-test-not-real" } as any).returning();
  const B = biz.id as string;
  await db.update(schema.businessAccounts).set({ answerCheckingEnabled: "true" }).where(eq(schema.businessAccounts.id, B));
  const photo = async (shade: string) => sharp({ create: { width: 800, height: 1100, channels: 3, background: shade } }).jpeg().toBuffer();

  const prepare = async (key: string, text: string, max: number) => {
    queues.scheme.push({ steps: [{ id: "s1", label: "Main point", marks: max / 2 }, { id: "s2", label: "Second point", marks: max / 2 }] });
    return engine.prepareQuestion(B, { questionKey: key, source: "custom", questionText: text, modelAnswer: "model", questionKind: "short", board: "CBSE", medium: "English", grade: "10", subject: "Science", chapter: null, maxMarks: max }, null);
  };
  await prepare("custom:p1", "State Ohm's law.", 2);
  await prepare("custom:p2", "Find the resistance for 220 V and 0.5 A.", 4);
  await prepare("custom:p3", "Define refraction.", 2);
  const qs = [{ number: "1", questionKey: "custom:p1" }, { number: "2", questionKey: "custom:p2" }, { number: "3", questionKey: "custom:p3" }];
  const viewOf = async (id: string) => papers.paperView((await db.select().from(schema.answerPapers).where(eq(schema.answerPapers.id, id)))[0]);

  console.log("A whole answer sheet");
  let paperId = "";
  {
    queues.paperRead.push({ parts: [
      { label: "", pages: [1], text: "(heading) Name: Riya", legibility: 1 },
      { label: "Ans 2)", pages: [1], text: "R = V/I = 440 ohm", legibility: 0.9 },
      { label: "Q1.", pages: [1], text: "Current is proportional to voltage", legibility: 0.9 },
      { label: "", pages: [2], text: "at constant temperature", legibility: 0.8 },
    ] });
    queues.match.push({ answers: [{ number: "2", parts: [1], confidence: 0.95 }, { number: "1", parts: [2, 3], confidence: 0.85 }], notAttempted: ["3"], unassigned: [{ part: 0, reason: "heading" }] });
    const p = await papers.createPaper({ businessAccountId: B, title: "Mock test 1", studentLabel: "Riya", questions: qs, photos: [await photo("#ffffff"), await photo("#f4f4f4")], userId: null });
    paperId = p.id;
    expect(p.status === "reading", "a new paper starts as 'reading'");
    await engine.waitForIdle();
    const v = await viewOf(paperId);
    const q = (n: string) => v.checks.find(c => c.questionNumber === n)!;
    expect(v.checks.length === 3 && v.checks.map(c => c.questionNumber).join() === "1,2,3", "one answer per question, in the paper's order", v.checks.map(c => c.questionNumber));
    expect(v.status === "done", "all answers checked → paper done", v.status);
    const readCall = calls.find(c => c.kind === "paperRead")!;
    expect(readCall.images === 2 && !readCall.user.includes("Ohm") && readCall.model === "gpt-4.1", "the whole sheet is read once, both pages, without the questions", readCall);
    expect(calls.find(c => c.kind === "match")!.user.includes("Question 2 (4 marks): Find the resistance"), "the matcher sees the questions");
    expect(q("1").readText === "Current is proportional to voltage\nat constant temperature" && (q("1").reading as any).pages.join() === "1,2", "question 1 = its part plus the continuation on page 2");
    expect(q("2").readText === "R = V/I = 440 ohm" && q("2").aiMarks === 4, "'Ans 2)' written first is still question 2, marked 4/4");
    expect(q("3").aiMarks === 0 && q("3").status === "done" && (q("3").reading as any).notAttempted && q("3").teacherReasons.length === 0, "question 3 not attempted → 0, no teacher needed");
    expect(q("3").images.length === 0 && q("1").images.some(i => i.kind === "marked"), "marked sheets for answered questions only");
    expect(v.totals.aiMarks === 6 && v.totals.maxMarks === 8 && v.totals.notAttempted === 1, "paper total 6/8, one not attempted", v.totals);
    expect(q("2").studentLabel === "Riya · Q2", "answers are labelled with the student and question number");
    expect(callsOf("paperRead") === 1 && callsOf("mark") === 2, "one reading for the sheet, marking only for answered questions");
    expect(v.pages.length === 2 && v.costUsd > 0, "pages and cost on the paper");
    const marked = (await db.select().from(schema.answerCheckImages).where(eq(schema.answerCheckImages.checkId, q("1").id))).find(i => i.kind === "marked")!;
    const meta = await sharp(marked.data as Buffer).metadata();
    expect((meta.height ?? 0) > 2000, "question 1's marked sheet shows both of its pages", meta.height);
    const readsBefore = callsOf("paperRead");
    await engine.recheck(B, q("1").id, { reread: true });
    await engine.waitForIdle();
    expect(callsOf("paperRead") === readsBefore && calls.filter(c => c.kind === "paperRead" || c.images > 0).length === readsBefore, "re-checking one answer of a paper never reads it on its own");
    let err = "";
    try { await engine.deleteCheck(B, q("2").id); } catch (e: any) { err = e.message; }
    expect(/delete the paper/.test(err), "one answer of a paper can't be deleted on its own", err);
  }

  console.log("Unsure matches");
  {
    queues.paperRead.push({ parts: [
      { label: "", pages: [1], text: "Current and voltage are proportional", legibility: 0.9 },
      { label: "", pages: [1], text: "Light bends when it enters water", legibility: 0.9 },
    ] });
    queues.match.push({ answers: [{ number: "1", parts: [0], confidence: 0.4, note: "no label" }], notAttempted: ["2", "3"] });
    const p = await papers.createPaper({ businessAccountId: B, title: "Mock test 2", studentLabel: "Arjun", questions: qs, photos: [await photo("#ffffff")], userId: null });
    await engine.waitForIdle();
    const v = await viewOf(p.id);
    const q = (n: string) => v.checks.find(c => c.questionNumber === n)!;
    expect(q("1").status === "needs_teacher" && q("1").teacherReasons.some(r => r.includes("isn't sure this part")), "an unsure match → a teacher confirms it", q("1").teacherReasons);
    expect(q("3").status === "needs_teacher" && q("3").teacherReasons[0].includes("really wasn't answered"), "an answer-like part left over → 'not attempted' questions go to a teacher");
    expect(v.status === "needs_teacher" && v.totals.needsTeacher === 3, "the paper shows it needs a teacher", v.totals);
    expect((v.matching as any).unassigned.length === 1, "the left-over part is listed on the paper");
  }

  console.log("Reading again, failures, deleting");
  {
    const before = await viewOf(paperId);
    await engine.saveTeacherMarks(B, before.checks[0].id, { marks: 1, comment: "" }, null);
    queues.paperRead.push(null);
    await papers.rerunPaper(B, paperId);
    await engine.waitForIdle();
    let v = await viewOf(paperId);
    expect(v.status === "failed" && /could not read the answer sheet/.test(v.error || ""), "the AI failing to read → paper failed with a plain reason", v.error);
    queues.paperRead.push({ parts: [{ label: "Q1", pages: [1], text: "Current is proportional", legibility: 0.9 }, { label: "Q2", pages: [1], text: "WRONG 100 ohm", legibility: 0.9 }, { label: "Q3", pages: [2], text: "Bending of light", legibility: 0.9 }] });
    queues.match.push({ answers: [{ number: "1", parts: [0], confidence: 0.9 }, { number: "2", parts: [1], confidence: 0.9 }, { number: "3", parts: [2], confidence: 0.9 }] });
    await papers.rerunPaper(B, paperId);
    await engine.waitForIdle();
    v = await viewOf(paperId);
    expect(v.status === "done" && v.totals.aiMarks === 4 && v.totals.notAttempted === 0, "'Read again' replaces the results (Q2 now wrong: 2 + 0 + 2)", v.totals);
    expect(!v.checks.some(c => before.checks.some(b => b.id === c.id)) && v.checks.every(c => c.teacherMarks === null), "earlier answers (and their teacher marks) are replaced");
    expect(v.costUsd > before.costUsd, "the paper's cost keeps adding up");
    expect(await papers.deletePaper(B, paperId), "deleting the paper");
    const left = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.paperId, paperId));
    const leftPages = await db.select().from(schema.answerCheckImages).where(eq(schema.answerCheckImages.paperId, paperId));
    expect(left.length === 0 && leftPages.length === 0, "its answers and pages go with it");
    expect(!(await papers.deletePaper("someone-else", paperId)), "another account can't delete it");
  }

  console.log("Practice answer sheet");
  {
    await prepare("custom:p4", "Name the unit of resistance.", 2);
    const four = [...qs, { number: "4", questionKey: "custom:p4" }];
    const p = await papers.createPracticePaper({ businessAccountId: B, title: "Practice paper", studentLabel: "", questions: four, userId: null });
    expect(p.status === "writing" && p.studentLabel === "Practice student", "a practice paper starts as 'writing'");
    // The stand-in reader returns what the practice student wrote, out of order, with Q4 skipped.
    queues.paperRead.push({ parts: [
      { label: "Ans 2)", pages: [1], text: "average answer text", legibility: 1 },
      { label: "Q1.", pages: [1], text: "strong answer text", legibility: 1 },
      { label: "3.", pages: [1], text: "weak answer text", legibility: 1 },
    ] });
    queues.match.push({ answers: [{ number: "2", parts: [0], confidence: 0.95 }, { number: "1", parts: [1], confidence: 0.95 }, { number: "3", parts: [2], confidence: 0.95 }], notAttempted: ["4"] });
    await engine.waitForIdle();
    const v = await viewOf(p.id);
    const q = (n: string) => v.checks.find(c => c.questionNumber === n)!;
    const pr = v.practice as any;
    expect(pr.writtenOrder.join() === "2,1,3" && pr.sheet.startsWith("Q2.\n"), "the practice student wrote Q2 first", pr.writtenOrder);
    expect(pr.sheet.includes("Ans 1)") && pr.sheet.includes("3.") && !pr.sheet.includes("Q4"), "varied labels, question 4 skipped", pr.sheet);
    expect(q("1").practiceLevel === "strong" && q("2").practiceLevel === "average" && q("3").practiceLevel === "weak" && q("4").practiceLevel === null, "levels per question");
    expect(q("1").expectedMarks === 2 && q("2").expectedMarks === 2 && q("3").expectedMarks === 0 && q("4").expectedMarks === 0 && q("4").practiceText === "(not attempted)", "expected marks per question (skipped = 0)", v.checks.map(c => [c.questionNumber, c.expectedMarks]));
    expect(v.totals.expectedMarks === 4 && v.totals.notAttempted === 1, "expected total for the paper", v.totals);
    expect(v.pages.length >= 1 && callsOf("practice") >= 3, "the sheet is drawn and the answers written per question");
  }

  if (failed > 0) { console.error(`\n${failed} check(s) failed, ${passed} passed.`); process.exit(1); }
  console.log(`\nAll ${passed} whole-paper integration checks passed.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
