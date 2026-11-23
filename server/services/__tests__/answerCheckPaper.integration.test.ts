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

type Kind = "paperRead" | "match" | "locate" | "pieces" | "scheme" | "mark" | "aiWritten" | "practice";

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const engine = await import("../answerCheck/engine");
  const papers = await import("../answerCheck/papers");
  const prompts = await import("../answerCheck/prompts");
  const sharp = (await import("sharp")).default;

  const queues: Record<Kind, Array<Record<string, any> | null>> = { paperRead: [], match: [], locate: [], pieces: [], scheme: [], mark: [], aiWritten: [], practice: [] };
  const calls: Array<{ kind: Kind; model: string; images: number; user: string }> = [];
  const kindOf = (system: string): Kind =>
    system === prompts.READ_PAPER_SYSTEM ? "paperRead"
    : system === prompts.MATCH_SYSTEM ? "match"
    : system === prompts.LOCATE_SYSTEM ? "locate"
    : system === prompts.PIECES_SYSTEM ? "pieces"
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
        if (kind === "locate") return { places: Object.entries(rowOfPart).filter(([part]) => call.user.includes(`Part ${part}`)).map(([part, row]) => ({ part: Number(part), row })) };
        if (kind === "pieces") return queues.pieces.shift() ?? null;
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
  // Where the stand-in AI finds each part of a sheet: part number → row (pages are asked about at the same time).
  let rowOfPart: Record<number, number> = {};
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
    // Preparing the questions already marked each model answer against its own answer key.
    const marksBefore = callsOf("mark");
    const p = await papers.createPaper({ businessAccountId: B, title: "Mock test 1", studentLabel: "Riya", questions: qs, photos: [await photo("#ffffff"), await photo("#f4f4f4")], userId: null });
    paperId = p.id;
    expect(p.status === "reading", "a new paper starts as 'reading'");
    await engine.waitForIdle();
    const v = await viewOf(paperId);
    const q = (n: string) => v.checks.find(c => c.questionNumber === n)!;
    expect(v.checks.length === 3 && v.checks.map(c => c.questionNumber).join() === "1,2,3", "one answer per question, in the paper's order", v.checks.map(c => c.questionNumber));
    expect(v.status === "done", "all answers checked → paper done", v.status);
    const readCall = calls.find(c => c.kind === "paperRead")!;
    expect(readCall.images >= 2 && readCall.user.includes("show the 2 pages") && !readCall.user.includes("Ohm") && readCall.model === "gpt-4.1", "the whole sheet is read once, both pages (as enlarged strips), without the questions", { images: readCall.images, user: readCall.user.slice(0, 200) });
    expect(calls.find(c => c.kind === "match")!.user.includes("Question 2 (4 marks): Find the resistance"), "the matcher sees the questions");
    expect(q("1").readText === "Current is proportional to voltage\nat constant temperature" && (q("1").reading as any).pages.join() === "1,2", "question 1 = its part plus the continuation on page 2");
    expect(q("2").readText === "R = V/I = 440 ohm" && q("2").aiMarks === 4, "'Ans 2)' written first is still question 2, marked 4/4");
    expect(q("3").aiMarks === 0 && q("3").status === "done" && (q("3").reading as any).notAttempted && q("3").teacherReasons.length === 0, "question 3 not attempted → 0, no teacher needed");
    expect(q("3").images.length === 0 && q("1").images.some(i => i.kind === "marked"), "marked sheets for answered questions only");
    expect(v.totals.aiMarks === 6 && v.totals.maxMarks === 8 && v.totals.notAttempted === 1, "paper total 6/8, one not attempted", v.totals);
    expect(q("2").studentLabel === "Riya · Q2", "answers are labelled with the student and question number");
    expect(callsOf("paperRead") === 1 && callsOf("mark") === marksBefore + 2, "one reading for the sheet, marking only for answered questions");
    expect(v.pages.length === 2 && v.costUsd > 0, "pages and cost on the paper");
    const marked = (await db.select().from(schema.answerCheckImages).where(eq(schema.answerCheckImages.checkId, q("1").id))).find(i => i.kind === "marked")!;
    const meta = await sharp(marked.data as Buffer).metadata();
    expect((meta.height ?? 0) > 2000, "question 1's marked sheet shows both of its pages", meta.height);
    const readsBefore = callsOf("paperRead");
    await engine.recheck(B, q("1").id, { reread: true });
    await engine.waitForIdle();
    expect(callsOf("paperRead") === readsBefore && calls.filter(c => c.kind === "paperRead" || (c.images > 0 && c.kind !== "locate")).length === readsBefore, "re-checking one answer of a paper never reads it on its own");
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

  console.log("Pages arranged by question");
  {
    // Uploaded last page first: page 3 holds Q1, page 1 the end of Q2, page 2 its start and Q3.
    const shades = ["#101010", "#808080", "#f0f0f0"];
    const reply = () => ({ parts: [
      { label: "", pages: [1], text: "so R = 440 ohm", legibility: 0.9 },
      { label: "Q2", pages: [2], text: "R = V/I", legibility: 0.9 },
      { label: "Q1", pages: [3], text: "Current is proportional", legibility: 0.9 },
    ] });
    const match = () => ({ answers: [{ number: "1", parts: [2], confidence: 0.9 }, { number: "2", parts: [1, 0], confidence: 0.9 }], notAttempted: ["3"] });
    // The jumble (Q2 carries on to a page before its start) is put in order and read once more; the
    // matcher gives Q2's pieces as uploaded, and the question about their order corrects it.
    queues.paperRead.push(reply(), { parts: [
      { label: "Q1", pages: [1], text: "Current is proportional", legibility: 0.9 },
      { label: "Q2", pages: [2], text: "R = V/I", legibility: 0.9 },
      { label: "", pages: [3], text: "so R = 440 ohm", legibility: 0.9 },
    ] });
    queues.match.push({ answers: [{ number: "1", parts: [2], confidence: 0.9 }, { number: "2", parts: [0, 1], confidence: 0.9 }], notAttempted: ["3"] }, { answers: [{ number: "1", parts: [0], confidence: 0.9 }, { number: "2", parts: [1, 2], confidence: 0.9 }], notAttempted: ["3"] });
    queues.pieces.push({ order: ["B", "A"] }, { order: ["A", "B"] });
    const readsBefore = callsOf("paperRead");
    const p = await papers.createPaper({ businessAccountId: B, title: "Mock test 3", studentLabel: "Meera", questions: qs, photos: await Promise.all(shades.map(photo)), userId: null });
    const shadesOf = async (pages: Array<{ id: string }>) => Promise.all(pages.map(async pg => {
      const [row] = await db.select().from(schema.answerCheckImages).where(eq(schema.answerCheckImages.id, pg.id));
      const [c] = (await sharp(row.data as Buffer).stats()).channels;
      return c.mean < 60 ? "last" : c.mean < 180 ? "middle" : "first";
    }));
    await engine.waitForIdle();
    let v = await viewOf(p.id);
    const pagesOf = (n: string) => (v.checks.find(c => c.questionNumber === n)!.reading as any).pages.join();
    expect((await shadesOf(v.pages)).join() === "first,middle,last", "pages uploaded last first are put in question order", await shadesOf(v.pages));
    expect(pagesOf("1") === "1" && pagesOf("2") === "2,3" && v.checks.find(c => c.questionNumber === "2")!.readText === "R = V/I\nso R = 440 ohm", "each answer's page numbers follow its pages; its text is unchanged", v.checks.map(c => (c.reading as any).pages));
    expect((v.reading as any).parts.map((x: any) => x.pages.join()).join("|") === "1|2|3" && (v.reading as any).arranged === "auto" && callsOf("paperRead") === readsBefore + 2 && queues.pieces.length === 0, "a jumbled sheet is read once more, in order", { parts: (v.reading as any).parts, reads: callsOf("paperRead") - readsBefore });
    const markedOf = async (checkId: string) => (await db.select().from(schema.answerCheckImages).where(eq(schema.answerCheckImages.checkId, checkId))).filter(i => i.kind === "marked");
    const topShade = async (checkId: string) => {
      const [m] = await markedOf(checkId);
      const [c] = (await sharp(await sharp(m.data as Buffer).extract({ left: 300, top: 300, width: 100, height: 100 }).toBuffer()).stats()).channels;
      return c.mean < 60 ? "last" : c.mean < 180 ? "middle" : "first";
    };
    const q2 = v.checks.find(c => c.questionNumber === "2")!;
    expect((await topShade(q2.id)) === "middle", "question 2's marked sheet starts with its first page", await topShade(q2.id));

    // Someone puts them in another order by hand.
    const marksBefore = JSON.stringify(v.checks.map(c => [c.id, c.aiMarks]));
    const callsBefore = calls.length;
    const byHand = [v.pages[2].id, v.pages[0].id, v.pages[1].id];
    let err = "";
    try { await papers.arrangePages(B, p.id, byHand.slice(1)); } catch (e: any) { err = e.message; }
    expect(/pages have changed/.test(err), "a page missing from the order is refused", err);
    err = "";
    try { await papers.arrangePages(B, p.id, [byHand[0], byHand[0], byHand[1]]); } catch (e: any) { err = e.message; }
    expect(/pages have changed/.test(err), "a page given twice is refused", err);
    expect((await papers.arrangePages("someone-else", p.id, byHand)) === null, "another account can't arrange them");
    await papers.arrangePages(B, p.id, byHand);
    await engine.waitForIdle();
    v = await viewOf(p.id);
    expect(v.pages.map(x => x.id).join() === byHand.join() && pagesOf("1") === "2" && pagesOf("2") === "1,3", "the order chosen by hand is saved, page numbers follow", v.checks.map(c => (c.reading as any).pages));
    expect(JSON.stringify(v.checks.map(c => [c.id, c.aiMarks])) === marksBefore && calls.length === callsBefore, "the marks stay and the AI isn't called");
    expect((await topShade(q2.id)) === "last" && (await markedOf(q2.id)).length === 1, "marked sheets are drawn again in the new order", await topShade(q2.id));
    expect((await papers.arrangeOnce((await db.select().from(schema.answerPapers).where(eq(schema.answerPapers.id, p.id)))[0])).id === p.id && (await viewOf(p.id)).pages.map(x => x.id).join() === byHand.join(), "opening the sheet doesn't undo an order chosen by hand");

    // "Save and check again" reads the sheet in the chosen order, and keeps that order.
    queues.paperRead.push(reply());
    queues.match.push(match());
    const again = [byHand[1], byHand[0], byHand[2]];
    const started = await papers.arrangePages(B, p.id, again, { checkAgain: true });
    expect(started!.status === "reading", "'Save and check again' starts a new reading", started!.status);
    err = "";
    try { await papers.arrangePages(B, p.id, byHand); } catch (e: any) { err = e.message; }
    expect(/is being checked/.test(err), "pages can't be moved while the sheet is being checked", err);
    await engine.waitForIdle();
    v = await viewOf(p.id);
    expect(v.pages.map(x => x.id).join() === again.join() && pagesOf("2") === "1,2" && (v.reading as any).arranged === "manual", "an order chosen by hand is kept when the sheet is read again", (v.reading as any).arranged);

    // A sheet checked before this feature: put in question order the first time it is opened.
    const { arranged: _a, ...oldReading } = v.reading as any;
    await db.update(schema.answerPapers).set({ reading: oldReading }).where(eq(schema.answerPapers.id, p.id));
    const old = (await db.select().from(schema.answerPapers).where(eq(schema.answerPapers.id, p.id)))[0];
    const opened = await Promise.all([papers.arrangeOnce(old), papers.arrangeOnce(old)]);
    await engine.waitForIdle();
    v = await viewOf(p.id);
    expect(v.pages.map(x => x.id).join() === [again[2], again[1], again[0]].join() && pagesOf("1") === "1" && pagesOf("2") === "2,3", "an earlier sheet is arranged once, even when opened twice at the same time", v.checks.map(c => (c.reading as any).pages));
    expect(opened.every(o => (o.reading as any).arranged === "auto"), "and is marked as arranged");
  }

  console.log("Boundaries around each answer");
  {
    const { renderPracticeSheet } = await import("../answerCheck/drawing");
    const { writingRows } = await import("../answerCheck/regions");
    const [page] = await renderPracticeSheet({ text: "Q2.\nResistance is the opposition to current.\nR = V / I = 440 ohm\n\nAns 1)\nCurrent is proportional to voltage at a constant temperature.", studentLabel: "Name: Dev", questionLabel: "Mock test", seed: "b" });
    const rows = await writingRows(page);
    const [second] = await renderPracticeSheet({ text: "It bends when it enters water.", studentLabel: "Name: Dev", questionLabel: "Mock test", seed: "c" });
    const n = rows.edges.length - 1;
    const read = () => ({ parts: [
      { label: "Q2", pages: [1], text: "Resistance is the opposition to current.", legibility: 0.9 },
      { label: "1", pages: [1], text: "Current is proportional to voltage", legibility: 0.9 },
      { label: "Q3", pages: [2], text: "It bends when it enters water.", legibility: 0.9 },
      { label: "", pages: [1], text: "(heading) Name: Dev", legibility: 0.9 },
    ] });
    const match = () => ({ answers: [{ number: "2", parts: [0], confidence: 0.9 }, { number: "1", parts: [1], confidence: 0.9 }, { number: "3", parts: [2], confidence: 0.9 }] });
    const firstOfAns1 = rows.edges.findIndex((e, i) => i > 0 && e > 0.28 && e < 0.4) + 1;
    queues.paperRead.push(read()); queues.match.push(match());
    rowOfPart = { 3: 1, 0: 2, 1: firstOfAns1 };
    const p = await papers.createPaper({ businessAccountId: B, title: "Mock test 4", studentLabel: "Dev", questions: qs, photos: [page, second], userId: null });
    await engine.waitForIdle();
    let v = await viewOf(p.id);
    const regionsOf = (num: string) => (v.checks.find(c => c.questionNumber === num)!.reading as any).regions as Array<{ page: number; top: number; bottom: number }>;
    const [r2] = regionsOf("2");
    const [r1] = regionsOf("1");
    expect(regionsOf("2").length === 1 && r2.page === 1 && r2.top >= rows.edges[1] - 0.001 && r2.bottom <= rows.edges[firstOfAns1 - 1] + 0.001, "an answer's boundary runs from its first row to where the next answer begins", { r2, edges: rows.edges });
    expect(r1.page === 1 && r1.top >= r2.bottom - 0.001 && r1.bottom < 0.7 && n > 3, "the last answer's boundary ends with its writing, not at the page's end", r1);
    expect(regionsOf("3").length === 0 && (v.reading as any).located === true && v.locating === false, "an answer that wasn't found on its page has no boundary (the page is shown whole)", regionsOf("3"));
    const markedSize = async (num: string) => {
      const c = v.checks.find(x => x.questionNumber === num)!;
      const [m] = (await db.select().from(schema.answerCheckImages).where(eq(schema.answerCheckImages.checkId, c.id))).filter(i => i.kind === "marked");
      return (await sharp(m.data as Buffer).metadata()).height!;
    };
    expect((await markedSize("1")) < (await markedSize("3")), "the marked sheet shows only the answer's part of the page", [await markedSize("1"), await markedSize("3")]);

    // Rearranged: boundaries follow their pages.
    await papers.arrangePages(B, p.id, [v.pages[1].id, v.pages[0].id]);
    await engine.waitForIdle();
    v = await viewOf(p.id);
    expect(regionsOf("1")[0].page === 2 && regionsOf("1")[0].top === r1.top, "boundaries follow their pages when they are put in another order", regionsOf("1"));

    // A sheet checked before boundaries: found once, in the background, the marks stay.
    for (const c of v.checks) { const { regions: _r, ...rest } = c.reading as any; await db.update(schema.answerChecks).set({ reading: rest }).where(eq(schema.answerChecks.id, c.id)); }
    const { located: _l, ...before } = v.reading as any;
    await db.update(schema.answerPapers).set({ reading: before }).where(eq(schema.answerPapers.id, p.id));
    const rowOf = async () => (await db.select().from(schema.answerPapers).where(eq(schema.answerPapers.id, p.id)))[0];
    const marks = JSON.stringify(v.checks.map(c => [c.id, c.aiMarks]));
    const costBefore = v.costUsd;
    const callsBefore = callsOf("locate");
    rowOfPart = { 2: 1, 3: 1, 0: 2, 1: firstOfAns1 };
    papers.locateOnce(await rowOf());
    papers.locateOnce(await rowOf());
    expect((await viewOf(p.id)).locating, "the paper says its boundaries are being found");
    await engine.waitForIdle();
    v = await viewOf(p.id);
    expect(regionsOf("1")[0]?.page === 2 && regionsOf("3")[0]?.page === 1 && !v.locating && JSON.stringify(v.checks.map(c => [c.id, c.aiMarks])) === marks, "an earlier sheet gets its boundaries; the marks stay", v.checks.map(c => (c.reading as any).regions));
    expect(callsOf("locate") === callsBefore + 2 && v.costUsd > costBefore, "asked once per page, and counted in the cost", callsOf("locate") - callsBefore);
    papers.locateOnce(await rowOf());
    await engine.waitForIdle();
    expect(callsOf("locate") === callsBefore + 2, "not asked again on the next visit");
    await db.update(schema.answerPapers).set({ reading: before }).where(eq(schema.answerPapers.id, p.id));
    rowOfPart = {};
    papers.locateOnce(await rowOf());
    await engine.waitForIdle();
    expect(((await rowOf()).reading as any).located === false, "nothing found: noted, so it isn't tried on every visit");
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
