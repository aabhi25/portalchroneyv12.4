/**
 * Integration test for "Set up from Meritto sheet" (real SQL, a fake Meritto API that refuses a course
 * without campus and a city without state, like the real one).
 *
 * DESTRUCTIVE: creates rows. It refuses to run unless DATABASE_URL points at localhost AND
 * RETENTION_TEST_DB=1 is set. Run against a throwaway Postgres with the migrations applied:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   RETENTION_TEST_DB=1 npx tsx server/services/__tests__/merittoSetup.integration.test.ts
 */
import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

const url = process.env.DATABASE_URL || "";
if (process.env.RETENTION_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set RETENTION_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");

const out = console.log.bind(console);
if (process.env.TEST_VERBOSE !== "1") { console.log = () => {}; console.warn = () => {}; }
let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) out(`✓ ${label}`);
  else { failed++; out(`✗ ${label}${detail !== undefined ? `\n    got: ${JSON.stringify(detail)}` : ""}`); }
}

type Call = { path: string; body: any };

async function main() {
  // ── Fake Meritto ───────────────────────────────────────────────────────────
  const calls: Call[] = [];
  const fake = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ path: req.url || "", body });
      const send = (status: number, json: any) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
      if (body.mobile === "9000099999") return send(400, { status: false, message: "This Mobile number is already being used. Please try with a different mobile number." });
      if (body.course && !body.campus) return send(400, { status: false, message: "campus is required field." });
      if (body.city && !body.state) return send(400, { status: false, message: "state is required field." });
      return send(200, { status: true, message: "Lead created", data: { lead_id: `MER-${calls.length}` } });
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { storage } = await import("../../storage");
  const { encrypt } = await import("../encryptionService");
  const { syncLeadToMeritto } = await import("../merittoSync");
  const { applyMerittoSetup, planMerittoSetup, undoMerittoSetup, getMerittoListsStatus } = await import("../merittoSetup");

  const ago = (m: number) => new Date(Date.now() - m * 60_000);
  const [acct] = await db.insert(schema.businessAccounts).values({ name: `Meritto setup ${crypto.randomUUID().slice(0, 6)}`, website: "https://uni.example.com" } as any).returning();
  const B = acct.id as string;
  await storage.upsertWidgetSettings(B, {
    merittoEnabled: "true", merittoAccessKey: encrypt("ak-1"), merittoSecretKey: encrypt("sk-1"),
    merittoCreateUrl: `${base}/lead/v1/create`, merittoUpdateUrl: `${base}/lead/v1/update`, merittoEnabledAt: ago(60),
  } as any);
  const map = (merittoField: string, sourceField: string | null, sortOrder: number, customValue: string | null = null) =>
    ({ businessAccountId: B, merittoField, sourceType: sourceField ? "dynamic" : "custom", sourceField, customValue, displayName: merittoField, isEnabled: "true", sortOrder });
  await db.insert(schema.merittoFieldMappings).values([
    map("name", "lead.name", 1), map("mobile", "meritto.mobileNumber", 2), map("country_dial_code", "meritto.dialCode", 3),
    map("course", "journey.course", 4), map("source", null, 5, "AI Chroney"),
  ] as any);

  // A journey whose first question is saved as "course", with a route on two of its options.
  const [journey] = await db.insert(schema.conversationJourneys).values({ businessAccountId: B, name: "Test Journey" } as any).returning();
  const [next] = await db.insert(schema.journeySteps).values({ journeyId: journey.id, stepOrder: "1", questionText: "Your name?", questionType: "text" } as any).returning();
  const oldOptions = ["B.Tech Artificial Intelligence & Machine Learning (AI & ML) ", "BBA FinTech", "B.Tech Smart & Sustainable Energy", "Bachelor of Architecture (B.Arch)", ""];
  const oldRoutes = JSON.stringify({ routes: [
    { matchType: "exact", matchValue: "BBA FinTech", targetStepId: next.id },
    { matchType: "exact", matchValue: "B.Tech Smart & Sustainable Energy", targetStepId: next.id },
    { matchType: "contains", matchValue: "phd", targetStepId: next.id },
  ] });
  const [courseStep] = await db.insert(schema.journeySteps).values({
    journeyId: journey.id, stepOrder: "0", questionText: "Which course?", questionType: "dropdown", crmFieldKey: "course",
    multipleChoiceOptions: JSON.stringify(oldOptions), branchingCondition: oldRoutes, exitOnValue: "B.Tech Smart & Sustainable Energy",
  } as any).returning();

  // The chat menu's lead form, with a "Program Name" dropdown (one option also gates LeadSquared).
  const oldForm = JSON.stringify({
    name: { visible: true, required: true }, phone: { visible: true, required: true },
    custom: [
      { id: "f-prog", label: "Program Name", fieldType: "dropdown", options: ["BBA FinTech", "M.Tech Smart Energy", "Bachelor of Architecture (B.Arch)"], required: true, lsqQualifyValues: ["BBA FinTech", "M.Tech Smart Energy"] },
      { id: "f-qual", label: "Highest Qualification", fieldType: "dropdown", options: ["12th", "Graduate"], required: false },
    ],
  });
  const [menu] = await db.insert(schema.chatMenuConfigs).values({ businessAccountId: B, leadFormFields: oldForm } as any).returning();

  const mkLead = async (v: Partial<typeof schema.leads.$inferInsert>, courseAnswer?: string) => {
    let conversationId: string | null = null;
    if (courseAnswer) {
      const [conv] = await db.insert(schema.conversations).values({ businessAccountId: B, createdAt: ago(60) } as any).returning();
      conversationId = conv.id;
      const [session] = await db.insert(schema.journeySessions).values({ journeyId: journey.id, conversationId, businessAccountId: B, userId: "visitor" } as any).returning();
      await db.insert(schema.journeyResponses).values({ sessionId: session.id, journeyId: journey.id, conversationId, stepId: courseStep.id, response: courseAnswer } as any);
    }
    return (await db.insert(schema.leads).values({ businessAccountId: B, createdAt: ago(5), updatedAt: ago(5), conversationId, ...v } as any).returning())[0];
  };
  const getLead = async (id: string) => (await db.select().from(schema.leads).where(eq(schema.leads.id, id)))[0];
  const sheet = {
    sheetUrl: "https://docs.google.com/spreadsheets/d/test/edit",
    programs: [
      { level: "UG", name: "B.Tech (Artificial Intelligence and Machine learning)" },
      { level: "UG", name: "BBA (Fintech)" },
      { level: "UG", name: "B. Arch" },
      { level: "UG", name: "B.Sc. (Beauty & Wellness)" },
      { level: "Ph.D", name: "Ph.D. (Engineering)" },
    ],
    cities: [{ state: "Maharashtra", city: "Kolhapur" }, { state: "Maharashtra", city: "Pune" }],
  };

  try {
    // ── before: course without campus is refused; a known number counts as already there ──
    const typed = await mkLead({ name: "Asha", phone: "9000011111", city: "Kolhāpur" }, "BSc Beauty and Welness");
    const r1 = await syncLeadToMeritto(B, typed.id, { manual: true });
    expect(r1.outcome === "failed" && /campus/.test(r1.message), "before setup: Meritto refuses the course without campus", r1);
    await db.update(schema.leads).set({ merittoSyncStatus: "needs_attention" }).where(eq(schema.leads.id, typed.id));

    const dupe = await mkLead({ name: "Ravi", phone: "9000099999" });
    const r2 = await syncLeadToMeritto(B, dupe.id, { manual: true });
    const d = await getLead(dupe.id);
    expect(r2.outcome === "created" && d.merittoSyncStatus === "synced" && /Already in Meritto/.test(d.merittoSyncError || ""), "\"mobile already being used\" → marked as already in Meritto, not stuck", { r2, s: d.merittoSyncStatus, e: d.merittoSyncError });

    // ── preview ──
    const plan = await planMerittoSetup(B, sheet);
    const q = plan.courseQuestions[0];
    const fq = plan.courseQuestions.find(x => x.kind === "form");
    expect(plan.courseQuestions.length === 2 && q.stepId === courseStep.id && fq?.questionText === "Program Name", "finds the journey question saved as course and the form's Program Name dropdown (not Highest Qualification)", plan.courseQuestions.map(x => `${x.kind}:${x.questionText}`));
    expect(fq?.renames.length === 2 && fq.removes.join() === "M.Tech Smart Energy", "form plan: 2 renamed, 1 removed", fq);
    expect(q.renames.length === 3 && q.renames.some(r => r.from === "BBA FinTech" && r.to === "BBA (Fintech)") && q.removes.length === 2 && q.adds.join() === "B.Sc. (Beauty & Wellness),Ph.D. (Engineering)", "plan: 3 renamed, 2 removed (incl. blank), 2 added", q);
    expect(plan.fields.map(f => `${f.field}:${f.action}`).join() === "campus:add,city:add,state:add,medium:add" && plan.resend === 1, "plan: adds campus, city, state, medium; one lead to send again", { fields: plan.fields, resend: plan.resend });
    expect((await getLead(typed.id)).merittoSyncStatus === "needs_attention" && JSON.parse((await db.select().from(schema.journeySteps).where(eq(schema.journeySteps.id, courseStep.id)))[0].multipleChoiceOptions!).length === 5, "preview changes nothing");

    // ── apply ──
    const before = calls.length;
    const result = await applyMerittoSetup(B, sheet.sheetUrl, async () => sheet);
    expect(result.questionsChanged === 2 && result.fieldsAdded.join() === "campus,city,state,medium" && result.resending === 1, "apply: journey question and form changed, fields added, one lead being re-sent", result);
    const [menuAfter] = await db.select().from(schema.chatMenuConfigs).where(eq(schema.chatMenuConfigs.id, menu.id));
    const formAfter = JSON.parse(menuAfter.leadFormFields!);
    const prog = formAfter.custom.find((f: any) => f.id === "f-prog");
    expect(JSON.stringify(prog.options) === JSON.stringify(sheet.programs.map(p => p.name)) && prog.lsqQualifyValues.join() === "BBA (Fintech)" && formAfter.custom[1].options.join() === "12th,Graduate",
      "form: Program Name has Meritto's courses, its qualifying value renamed, other fields untouched", formAfter);
    const [step] = await db.select().from(schema.journeySteps).where(eq(schema.journeySteps.id, courseStep.id));
    expect(step.multipleChoiceOptions === JSON.stringify(sheet.programs.map(p => p.name)), "the course question now has exactly Meritto's courses", step.multipleChoiceOptions);
    const routes = JSON.parse(step.branchingCondition!).routes;
    expect(routes.length === 2 && routes[0].matchValue === "BBA (Fintech)" && routes[1].matchType === "contains" && step.exitOnValue === null, "routes follow the renamed option; the removed option's route and exit go; other rules stay", { routes, exit: step.exitOnValue });

    for (let i = 0; i < 50 && (await getLead(typed.id)).merittoSyncStatus !== "synced"; i++) await new Promise(r => setTimeout(r, 100));
    const t = await getLead(typed.id);
    const sent = calls.slice(before).find(c => c.body.name === "Asha");
    expect(t.merittoSyncStatus === "synced" && sent?.body.course === "B.Sc. (Beauty & Wellness)" && sent?.body.campus === "UG" && sent?.body.city === "Kolhapur" && sent?.body.state === "Maharashtra" && sent?.body.medium === "Chatbot",
      "the stuck lead is re-sent with Meritto's course, campus, city, state and medium", { s: t.merittoSyncStatus, body: sent?.body });

    const unknown = await mkLead({ name: "Zoya", phone: "9000022222", city: "Doha" }, "IDESCO++ Aesthetics International Diploma");
    const r3 = await syncLeadToMeritto(B, unknown.id, { manual: true });
    const zb = calls.find(c => c.body.name === "Zoya")?.body ?? {};
    expect(r3.outcome === "created" && !zb.course && !zb.campus && !zb.city && !zb.state, "a course / city not in Meritto's lists is left out and the lead still goes", { r3, zb });

    // A lead from the form only: its Program Name answer is sent as the course.
    const [fconv] = await db.insert(schema.conversations).values({ businessAccountId: B } as any).returning();
    for (const [role, content] of [["assistant", "Name"], ["user", "Neha"], ["assistant", "Mobile Number"], ["user", "9000033333"], ["assistant", "Program Name"], ["user", "Bachelor of Architecture (B.Arch)"]]) {
      await db.insert(schema.messages).values({ conversationId: fconv.id, role, content, interactionSource: "form" } as any);
      await new Promise(r => setTimeout(r, 5));
    }
    const formLead = (await db.insert(schema.leads).values({ businessAccountId: B, name: "Neha", phone: "9000033333", conversationId: fconv.id } as any).returning())[0];
    const r4 = await syncLeadToMeritto(B, formLead.id, { manual: true });
    const nb = calls.find(c => c.body.name === "Neha")?.body ?? {};
    expect(r4.outcome === "created" && nb.course === "B. Arch" && nb.campus === "UG", "a form-only lead: Program Name sent as Meritto's course with campus", { r4, nb });

    const status = await getMerittoListsStatus(B);
    expect(status.programs === 5 && status.cities === 2 && status.canUndo, "lists saved and undo available", status);

    // ── undo ──
    const undo = await undoMerittoSetup(B);
    const [back] = await db.select().from(schema.journeySteps).where(eq(schema.journeySteps.id, courseStep.id));
    const fields = (await db.select().from(schema.merittoFieldMappings).where(eq(schema.merittoFieldMappings.businessAccountId, B))).map(m => m.merittoField).sort();
    const [menuBack] = await db.select().from(schema.chatMenuConfigs).where(eq(schema.chatMenuConfigs.id, menu.id));
    expect(menuBack.leadFormFields === oldForm, "undo: the form's dropdown is put back", menuBack.leadFormFields);
    expect(undo.questionsRestored === 2 && undo.fieldsRemoved === 4 && back.multipleChoiceOptions === JSON.stringify(oldOptions) && back.branchingCondition === oldRoutes && back.exitOnValue === "B.Tech Smart & Sustainable Energy",
      "undo: course options, routes and exit put back; added fields removed", { undo, back: back.multipleChoiceOptions });
    expect(fields.join() === "country_dial_code,course,mobile,name,source", "only the account's own fields remain", fields);
    const after = await getMerittoListsStatus(B);
    expect(after.programs === 0 && after.cities === 0 && !after.canUndo, "lists loaded by that setup are cleared again", after);
    let threw = false;
    try { await undoMerittoSetup(B); } catch { threw = true; }
    expect(threw, "nothing left to undo");
  } finally {
    fake.close();
  }

  if (failed > 0) {
    out(`\n${failed} Meritto setup check(s) failed.`);
    process.exit(1);
  }
  out("\nAll Meritto setup checks passed.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
