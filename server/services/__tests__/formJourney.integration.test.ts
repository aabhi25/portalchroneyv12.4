/**
 * Form journeys in the website widget, end to end through the real routes against a local DB:
 *
 *  - the start-up form is the greeting, also for a visitor returning after 30+ minutes;
 *  - answering creates the chat and moves to the next question; the form in progress can be
 *    read back after a reload (GET /api/journey/current-step) and continued from the menu
 *    (GET /api/journey/:id/first-step?conversationId=…);
 *  - starting another form (from the menu) answers that form, not the one in progress;
 *  - an answer for a question that isn't the one in progress is not saved: the widget is moved
 *    to the right question (or, for the form's first question, the form starts over);
 *  - after the server forgets its in-memory state (a restart), the form carries on from the DB.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55495/postgres?sslmode=disable \
 *   FORM_JOURNEY_TEST_DB=1 DB_POOL_MAX=5 npx tsx server/services/__tests__/formJourney.integration.test.ts
 */
import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.FORM_JOURNEY_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set FORM_JOURNEY_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString("hex");

const out = console.log.bind(console);
if (process.env.TEST_VERBOSE !== "1") { console.log = () => {}; console.warn = () => {}; }
let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) out(`✓ ${label}`);
  else { failed++; out(`✗ ${label}${detail !== undefined ? `\n    got: ${JSON.stringify(detail)}` : ""}`); }
}

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { registerRoutes } = await import("../../routes");
  const { journeyService } = await import("../journeyService");

  const [account] = await db.insert(schema.businessAccounts).values({ name: `Form test ${crypto.randomUUID().slice(0, 8)}`, website: "https://forms.example.com" } as any).returning();
  const biz = account.id as string;
  const mkJourney = async (name: string, startFromScratch: boolean, questions: Array<{ text: string; type?: string; options?: string[] }>) => {
    const [j] = await db.insert(schema.conversationJourneys).values({ businessAccountId: biz, name, journeyType: "form", status: "active", startFromScratch: startFromScratch ? "true" : "false" } as any).returning();
    const steps = [];
    for (const [i, q] of questions.entries()) {
      const [s] = await db.insert(schema.journeySteps).values({ journeyId: j.id, stepOrder: String(i), questionText: q.text, questionType: q.type || "text", isRequired: "true", multipleChoiceOptions: q.options ? JSON.stringify(q.options) : null } as any).returning();
      steps.push(s);
    }
    return { id: j.id as string, steps: steps.map((s: any) => s.id as string) };
  };
  const A = await mkJourney("Counselling", true, [
    { text: "Which course are you interested in?", type: "radio", options: ["MBA", "BBA"] },
    { text: "Which city are you in?" },
    { text: "When would you like to start?" },
  ]);
  const C = await mkJourney("Eligibility", false, [
    { text: "Your highest qualification?", type: "radio", options: ["Graduate", "12th"] },
  ]);
  // A closing "thank you" step (shown with a button).
  await db.insert(schema.journeySteps).values({ journeyId: C.id, stepOrder: "1", questionText: "You're eligible!", questionType: "text", isRequired: "false", toolTrigger: "journey_complete", completionButtonText: "Back to chat" } as any);
  const B = await mkJourney("Fee plan", false, [
    { text: "Do you need an education loan?", type: "radio", options: ["Yes", "No"] },
    { text: "What is your budget?" },
    { text: "Any questions for us?" },
  ]);

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser(process.env.SESSION_SECRET));
  const server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => { const r = await fetch(base + path); return { status: r.status, json: await r.json().catch(() => ({})) as any }; };
  const submit = async (body: any) => { const r = await fetch(`${base}/api/journey/submit-step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessAccountId: biz, ...body }) }); return { status: r.status, json: await r.json().catch(() => ({})) as any }; };
  const answersOf = async (conversationId: string) =>
    (await db.select().from(schema.journeyResponses).where(eq(schema.journeyResponses.conversationId, conversationId))).map((r: any) => `${r.journeyId === A.id ? "A" : "B"}:${r.response}`).sort();

  try {
    // ── the start-up form is the greeting ──
    let r = await get(`/api/chat/widget/intro?businessAccountId=${biz}`);
    expect(r.json.formStep?.stepId === A.steps[0] && r.json.journeyId === A.id, "the start-up form's first question is the greeting", r.json);
    r = await get(`/api/chat/widget/intro?businessAccountId=${biz}&welcomeBack=true`);
    expect(r.json.formStep?.stepId === A.steps[0], "…also for a visitor coming back after 30+ minutes", r.json);

    // ── answering ──
    let s = await submit({ conversationId: null, journeyId: A.id, stepId: A.steps[0], answer: "MBA", visitorToken: `vt-${crypto.randomUUID()}` });
    const conv = s.json.conversationId as string;
    expect(s.status === 200 && conv && s.json.nextStep?.stepId === A.steps[1], "the first answer creates the chat and moves to question 2", s.json);
    r = await get(`/api/journey/current-step?businessAccountId=${biz}&conversationId=${conv}`);
    expect(r.json.formStep?.stepId === A.steps[1] && r.json.journeyId === A.id, "after a reload, the form in progress is read back", r.json);
    r = await get(`/api/journey/current-step?businessAccountId=not-${biz}&conversationId=${conv}`);
    expect(r.json.formStep === null, "…only for its own account");
    r = await get(`/api/journey/${A.id}/first-step?businessAccountId=${biz}&conversationId=${conv}`);
    expect(r.json.resumed === true && r.json.formStep?.stepId === A.steps[1], "opening the same form again from the menu continues it", r.json);
    r = await get(`/api/journey/${A.id}/first-step?businessAccountId=${biz}`);
    expect(r.json.formStep?.stepId === A.steps[0] && r.json.formStep.isRequired === true && Array.isArray(r.json.formStep.options), "a new visitor gets the first question (options, required as a boolean)", r.json.formStep);

    // ── another form started from the menu ──
    s = await submit({ conversationId: conv, journeyId: B.id, stepId: B.steps[0], answer: "Yes" });
    expect(s.status === 200 && s.json.nextStep?.stepId === B.steps[1], "starting another form answers THAT form (the next question is its own)", s.json);
    expect(JSON.stringify(await answersOf(conv)) === JSON.stringify(["A:MBA", "B:Yes"]), "the answer is saved to the new form, not the old one", await answersOf(conv));

    // ── a stale question ──
    s = await submit({ conversationId: conv, journeyId: B.id, stepId: B.steps[2], answer: "should not be saved" });
    expect(s.json.resync === true && s.json.nextStep?.stepId === B.steps[1], "an answer for a question that isn't the current one moves the widget to the current one", s.json);
    expect(!(await answersOf(conv)).some((a) => a.includes("should not")), "…and is not saved");

    // ── a server restart (in-memory state lost) ──
    await journeyService.resetJourney(conv);
    r = await get(`/api/journey/current-step?businessAccountId=${biz}&conversationId=${conv}`);
    expect(r.json.formStep?.stepId === B.steps[1], "after a restart the form in progress comes back from the database", r.json);
    await journeyService.resetJourney(conv);
    s = await submit({ conversationId: conv, journeyId: B.id, stepId: B.steps[1], answer: "5 lakh" });
    expect(s.status === 200 && s.json.nextStep?.stepId === B.steps[2], "…and answering carries on from there", s.json);

    // ── starting the form again from its first question ──
    s = await submit({ conversationId: conv, journeyId: B.id, stepId: B.steps[0], answer: "No" });
    // (Questions this chat already answered — the budget — are filled in, not asked again.)
    expect(s.status === 200 && s.json.nextStep?.stepId === B.steps[2] && (await answersOf(conv)).includes("B:No"), "the form's first question answered again → the form starts over (known answers skipped)", s.json);

    // ── finishing ──
    s = await submit({ conversationId: conv, journeyId: B.id, stepId: B.steps[2], answer: "No" });
    expect(s.status === 200 && s.json.completed === true, "the last answer completes the form", s.json);
    r = await get(`/api/journey/current-step?businessAccountId=${biz}&conversationId=${conv}`);
    expect(r.json.formStep === null, "a finished form is not restored");
    // ── a form ending with a closing step ──
    s = await submit({ conversationId: conv, journeyId: C.id, stepId: C.steps[0], answer: "Graduate" });
    expect(s.json.completed === true && s.json.nextStep?.stepType === "journey_complete", "a closing step ends the form (shown with its button)", s.json);
    await journeyService.resetJourney(conv); // a restart
    r = await get(`/api/journey/current-step?businessAccountId=${biz}&conversationId=${conv}`);
    expect(r.json.formStep === null, "…and it stays finished after a restart", r.json);
    const [afterForm] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conv));
    expect(afterForm && !afterForm.closedAt, "finishing a form leaves the chat open, so the visitor can carry on in it", afterForm?.closedAt);
    r = await get(`/api/journey/${C.id}/first-step?businessAccountId=${biz}&conversationId=${conv}`);
    expect(r.json.formStep?.stepId === C.steps[0] && !r.json.resumed, "opening it again starts it fresh (not at its closing message)", r.json);

    // ── chatting after the forms ──
    await journeyService.resetJourney(conv);
    const after = await journeyService.getOrStartJourney(conv, "visitor-x", biz, "What is the fee for MBA?");
    expect(after === null, "typing in a chat that has been through a form goes to the AI (the start-up form is not started again)", after?.journeyId);
    const [fresh] = await db.insert(schema.conversations).values({ businessAccountId: biz, title: "New Chat" } as any).returning();
    const started = await journeyService.getOrStartJourney(fresh.id, "visitor-y", biz, "Hi");
    expect(started?.journeyId === A.id, "a brand-new chat still starts with the start-up form", started?.journeyId);

    const [c] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conv));
    expect(c?.title === "Counselling", "the chat is titled after its form", c?.title);

    // ── "Change my last answer" ──
    const back = async (body: any) => { const r = await fetch(`${base}/api/journey/step-back`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessAccountId: biz, ...body }) }); return { status: r.status, json: await r.json().catch(() => ({})) as any }; };
    s = await submit({ conversationId: null, journeyId: A.id, stepId: A.steps[0], answer: "MBA", visitorToken: `vt-${crypto.randomUUID()}` });
    const bc = s.json.conversationId as string;
    s = await submit({ conversationId: bc, journeyId: A.id, stepId: A.steps[1], answer: "Pune" });
    expect(s.json.nextStep?.stepId === A.steps[2], "back flow: two answers given, on question 3", s.json);
    let b = await back({ conversationId: bc, journeyId: A.id, stepId: A.steps[2] });
    expect(b.json.success && b.json.nextStep?.stepId === A.steps[1] && b.json.canGoBack === true, "going back shows question 2 again (question 1 is still behind it)", b.json);
    const answersA = async () => (await db.select().from(schema.journeyResponses).where(eq(schema.journeyResponses.conversationId, bc))).map((x: any) => x.response);
    expect(JSON.stringify(await answersA()) === JSON.stringify(["MBA"]), "the changed answer is forgotten", await answersA());
    await journeyService.resetJourney(bc); // a restart in between
    b = await back({ conversationId: bc, journeyId: A.id, stepId: A.steps[1] });
    expect(b.json.success && b.json.nextStep?.stepId === A.steps[0] && Array.isArray(b.json.nextStep.options) && b.json.canGoBack === false, "going back again (after a restart) reaches the first question, with its options; nothing before it", b.json);
    b = await back({ conversationId: bc, journeyId: A.id, stepId: A.steps[0] });
    expect(b.json.success === false && b.json.nextStep?.stepId === A.steps[0], "nothing to go back to on the first question", b.json);
    s = await submit({ conversationId: bc, journeyId: A.id, stepId: A.steps[0], answer: "BBA" });
    expect(s.json.nextStep?.stepId === A.steps[1] && JSON.stringify(await answersA()) === JSON.stringify(["BBA"]), "a new pick is saved and the form carries on", { next: s.json.nextStep?.stepId, answers: await answersA() });
    b = await back({ conversationId: bc, journeyId: A.id, stepId: A.steps[2] });
    expect(b.json.resync === true && b.json.nextStep?.stepId === A.steps[1], "a widget on an old question is moved to the current one, nothing undone", b.json);
    b = await back({ conversationId: bc, businessAccountId: `not-${biz}`, journeyId: A.id, stepId: A.steps[1] });
    expect(b.status === 404, "another account can't touch this chat", b.status);
  } finally {
    await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, biz)).catch(() => {});
    server.close();
  }

  if (failed) { out(`\n${failed} check(s) failed`); process.exit(1); }
  out("\nAll form journey checks passed.");
  process.exit(0);
}
main().catch((e) => { out(e); process.exit(1); });
