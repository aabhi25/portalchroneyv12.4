/**
 * AI assessment — an answer key must give its own model answer full marks, on a real database with
 * a stand-in AI: the model answer is marked against the first draft; steps it does not earn are
 * rewritten once with the reason, then taken out (their marks move to the steps it does earn); a
 * key is left alone when there is no model answer, when the answer needs a drawing, or when the
 * check itself gives no usable reply. Also: an answer whose marks contradict the marker's own
 * comments is marked once more, and goes to a teacher when it still contradicts itself.
 *
 *   DATABASE_URL=<throwaway Postgres with migrations applied> ANSWER_CHECK_TEST_DB=1 DB_POOL_MAX=3 \
 *     npx tsx server/services/__tests__/answerCheckKeyCheck.integration.test.ts
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

  // Scheme replies come from a queue; the marker gives full marks except to steps labelled UNEARNED.
  const schemes: any[] = [];
  const markReplies: any[] = [];
  const calls: Array<{ kind: "scheme" | "mark" | "read" | "aiWritten"; user: string }> = [];
  let markBroken = false;
  const prompts = await import("../answerCheck/prompts");
  engine.setAnswerCheckAiFactoryForTests(async () => ({
    costUsd: () => 0,
    async json(call) {
      const kind = call.system.startsWith("You are a senior board examiner") ? "scheme" : call.system === prompts.READ_SYSTEM ? "read" : call.system === prompts.AI_WRITTEN_SYSTEM ? "aiWritten" : "mark";
      calls.push({ kind, user: call.user });
      if (kind === "scheme") return schemes.shift() ?? null;
      if (kind === "read") return { text: "Angle of reflection = 30°", legibility: 0.95, unclear: [] };
      if (kind === "aiWritten") return { percent: 5, confidence: "low", signals: [] };
      if (markBroken) return null;
      if (markReplies.length) return markReplies.shift();
      const steps = Array.from(call.user.matchAll(/\[(\w+)\] (.*?) — ([\d.]+) mark/g)).map(m => ({ stepId: m[1], awarded: /UNEARNED/.test(m[2]) ? 0 : Number(m[3]), comment: /UNEARNED/.test(m[2]) ? "Not in the answer." : "" }));
      return { steps, confidence: 0.9, feedback: { summary: "ok" } };
    },
  }));
  const count = (k: string) => calls.filter(c => c.kind === k).length;

  const stamp = Date.now();
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `Key check ${stamp}`, website: "https://school.example.com", openaiApiKey: "sk-test-not-real", answerCheckingEnabled: "true" } as any).returning();
  const B = biz.id as string;
  const prepare = (key: string, modelAnswer: string, maxMarks = 3) => engine.prepareQuestion(B, {
    questionKey: key, source: "custom", questionText: "Find the number to be subtracted.", modelAnswer, questionKind: "numerical",
    board: "Maharashtra Board", medium: "English", grade: "9", subject: "Mathematics", chapter: null, maxMarks,
  }, null);
  const steps = (row: any) => engine.schemeOf(row).steps;
  const reset = () => { calls.length = 0; schemes.length = 0; markReplies.length = 0; markBroken = false; };

  console.log("A key the model answer earns in full");
  {
    reset();
    schemes.push({ steps: [{ id: "s1", label: "Sets up the proportion", marks: 1 }, { id: "s2", label: "Solves for x", marks: 2 }] });
    const row = await prepare("custom:k1", "x = 4");
    expect(count("scheme") === 1 && count("mark") === 1, "written once, and checked once by marking the model answer", [count("scheme"), count("mark")]);
    expect(calls.find(c => c.kind === "mark")!.user.includes('"""\nx = 4\n"""'), "the check marks the model answer exactly as given");
    expect(steps(row).map(s => s.label).join("|") === "Sets up the proportion|Solves for x", "the key is kept as written");
  }

  console.log("A key that asks for more than the model answer shows");
  {
    reset();
    schemes.push({ steps: [{ id: "s1", label: "Solves for x", marks: 2.5 }, { id: "s2", label: "UNEARNED Writes the final answer in words", marks: 0.5 }] });
    schemes.push({ steps: [{ id: "s1", label: "Sets up the proportion", marks: 1 }, { id: "s2", label: "Solves for x = 4", marks: 2 }] });
    const row = await prepare("custom:k2", "x = 4");
    expect(count("scheme") === 2 && count("mark") === 2, "the key is written again and checked again", [count("scheme"), count("mark")]);
    const second = calls.filter(c => c.kind === "scheme")[1].user;
    expect(second.includes('"UNEARNED Writes the final answer in words" (0 of 0.5) — Not in the answer.') && /full-marks standard/.test(second), "the writer is told which step the model answer did not earn");
    expect(steps(row).map(s => s.label).join("|") === "Sets up the proportion|Solves for x = 4" && steps(row).reduce((a, s) => a + s.marks, 0) === 3, "the rewritten key is the one saved", steps(row));
  }

  console.log("A key that still asks for it after the rewrite");
  {
    reset();
    schemes.push({ steps: [{ id: "s1", label: "Sets up", marks: 1 }, { id: "s2", label: "Solves", marks: 1.5 }, { id: "s3", label: "UNEARNED final statement", marks: 0.5 }] });
    schemes.push({ steps: [{ id: "s1", label: "Sets up the equation", marks: 1 }, { id: "s2", label: "Solves it", marks: 1.5 }, { id: "s3", label: "UNEARNED statement in words", marks: 0.5 }] });
    const row = await prepare("custom:k3", "x = 4");
    expect(count("scheme") === 2 && count("mark") === 2, "one rewrite only");
    expect(steps(row).map(s => `${s.label}:${s.marks}`).join("|") === "Sets up:1|Solves:2", "the step is taken out and its marks go to the steps the model answer earns", steps(row));
    reset();
    schemes.push({ steps: [{ id: "s1", label: "UNEARNED a", marks: 1 }, { id: "s2", label: "UNEARNED b", marks: 2 }, { id: "s3", label: "ok", marks: 0 }] });
    schemes.push({ steps: [{ id: "s1", label: "Sets up", marks: 1 }, { id: "s2", label: "UNEARNED b", marks: 2 }] });
    const better = await prepare("custom:k4", "x = 4");
    expect(steps(better).map(s => `${s.label}:${s.marks}`).join("|") === "Sets up:3", "a rewrite that misses fewer steps is taken, then cleaned the same way", steps(better));
    reset();
    schemes.push({ steps: [{ id: "s1", label: "UNEARNED only step", marks: 3 }] });
    schemes.push({ steps: [{ id: "s1", label: "UNEARNED still the only step", marks: 3 }] });
    const stuck = await prepare("custom:k5", "x = 4");
    expect(steps(stuck).length === 1 && steps(stuck)[0].marks === 3, "a key is never left without steps", steps(stuck));
  }

  console.log("Keys that are not checked");
  {
    reset();
    schemes.push({ modelAnswer: "AI's own answer", steps: [{ id: "s1", label: "UNEARNED point", marks: 3 }] });
    const own = await prepare("custom:k6", "");
    expect(count("mark") === 0 && own.modelAnswerByAi, "no model answer given → the AI wrote both, nothing to check against");
    reset();
    schemes.push({ needsDrawing: true, steps: [{ id: "s1", label: "UNEARNED labelled diagram", marks: 3 }] });
    const drawn = await prepare("custom:k7", "See the diagram.");
    expect(count("mark") === 0 && steps(drawn)[0].label === "UNEARNED labelled diagram", "an answer that needs a drawing can't be checked from text, so its key is left as written");
    reset();
    markBroken = true;
    schemes.push({ steps: [{ id: "s1", label: "UNEARNED point", marks: 3 }] });
    const unsure = await prepare("custom:k8", "x = 4");
    expect(count("scheme") === 1 && steps(unsure)[0].label === "UNEARNED point", "when the check gives no usable reply the key is left as written");
    reset();
    schemes.push({ steps: [{ id: "s1", label: "Point", marks: 3 }] });
    const again = await prepare("custom:k1", "x = 4");
    expect(count("scheme") === 0 && count("mark") === 0 && again.version === 1, "a question that already has its key is neither rewritten nor checked again");
  }

  console.log("Marks and comments must agree");
  {
    const sharp = (await import("sharp")).default;
    const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    reset();
    schemes.push({ modelAnswer: "60°", steps: [{ id: "s1", label: "Finds the angle of incidence", marks: 1 }, { id: "s2", label: "Gives the final answer: 60°", marks: 1 }] });
    const key = await prepare("custom:m1", "", 2);
    const run = async (replies: any[]) => {
      calls.length = 0;
      markReplies.push(...replies);
      const c = await engine.createUploadCheck({ businessAccountId: B, scheme: key, photos: [photo], studentLabel: "Bala", userId: null });
      await engine.waitForIdle();
      const [row] = await db.select().from(schema.answerChecks).where(eq(schema.answerChecks.id, c.id));
      return row;
    };
    const wrongKept = { steps: [{ stepId: "s1", awarded: 0, comment: "No calculation shown." }, { stepId: "s2", awarded: 1, comment: "Final answer given with unit, but value is wrong." }], finalAnswerCorrect: false, confidence: 1, feedback: { summary: "Not correct." } };
    const fair = { steps: [{ stepId: "s1", awarded: 0, comment: "No calculation shown." }, { stepId: "s2", awarded: 0, comment: "Final answer is wrong." }], finalAnswerCorrect: false, mistakes: ["30° instead of 60°"], confidence: 1, feedback: { summary: "Not correct." } };

    const fixed = await run([wrongKept, fair]);
    const marks = calls.filter(c => c.kind === "mark");
    expect(marks.length === 2 && marks[1].user.includes("contradicts itself") && marks[1].user.includes('"Gives the final answer: 60°" was given its full 1 mark') && marks[1].user.startsWith(marks[0].user), "a wrong final answer that kept its mark is marked once more, the marker told where it contradicts itself", marks.length);
    expect(Number(fixed.aiMarks) === 0 && fixed.status === "done" && (fixed.teacherReasons || []).length === 0, "the consistent second marking stands: 0 of 2, no teacher needed", [fixed.aiMarks, fixed.status, fixed.teacherReasons]);

    const stuck = await run([wrongKept, wrongKept]);
    expect(calls.filter(c => c.kind === "mark").length === 2 && stuck.status === "needs_teacher" && (stuck.teacherReasons || []).some(r => /don't agree/.test(r)), "still contradicting itself after one more marking → a teacher checks the marks", [stuck.status, stuck.teacherReasons]);

    const clean = await run([fair]);
    expect(calls.filter(c => c.kind === "mark").length === 1 && clean.status === "done" && Number(clean.aiMarks) === 0, "a consistent marking is not repeated");
  }

  await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, B));
  if (failed > 0) { console.error(`\n${failed} check(s) failed, ${passed} passed.`); process.exit(1); }
  console.log(`\nAll ${passed} answer-key checks passed.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
