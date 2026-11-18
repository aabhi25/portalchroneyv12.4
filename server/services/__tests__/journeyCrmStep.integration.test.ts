/**
 * Integration test for "Send to CRM after this question" on journeys (leadCapture/journeyCrmGate.ts)
 * and the junk mobile number hold, website chat and WhatsApp, with a fake LeadSquared UDS webhook on
 * localhost that records what LeadSquared would receive.
 *
 * DESTRUCTIVE: creates rows. It refuses to run unless DATABASE_URL points at localhost AND
 * JOURNEY_CRM_TEST_DB=1 is set. Run against a throwaway Postgres with the migrations applied:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   JOURNEY_CRM_TEST_DB=1 npx tsx server/services/__tests__/journeyCrmStep.integration.test.ts
 */
const url = process.env.DATABASE_URL || '';
if (process.env.JOURNEY_CRM_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set JOURNEY_CRM_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) {
    failed++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const http = await import("http");
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { storage } = await import("../../storage");
  const { whatsappService } = await import("../whatsappService");
  const { whatsappFlowService } = await import("../whatsappFlowService");
  const { syncConversationLeadIfReady, sendHeldBackLeads } = await import("../leadCapture/crmGate");
  const { onWebsiteJourneyProgress } = await import("../leadCapture/journeyCrmGate");
  const { junkPhoneReason } = await import("@shared/phoneQuality");
  const crmLeadSync = await import("../crmLeadSync");
  const waSync = await import("../whatsappLeadLsqSync");

  // ── Junk numbers ────────────────────────────────────────────────────────────
  for (const bad of ["9999999999", "+91 99999 99999", "1234567890", "9876543210", "5123456789", "12345", "9000000000"]) {
    expect(junkPhoneReason(bad), `"${bad}" looks like junk`);
  }
  for (const good of ["9876512345", "+91-98765 12345", "09876512345", "+44 7911 123456", "+1 415 555 0100"]) {
    expect(!junkPhoneReason(good), `"${good}" is accepted`);
  }

  // ── A fake LeadSquared UDS webhook ───────────────────────────────────────────
  const received: Record<string, string>[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const udsUrl = `http://127.0.0.1:${(server.address() as any).port}/uds`;
  const sentTo = (phoneTail: string) => received.some((r) => String(r.Phone || "").endsWith(phoneTail));
  const settle = async (phoneTail: string) => { for (let i = 0; i < 40 && !sentTo(phoneTail); i++) await pause(100); };

  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000);
  const [{ id: A }] = await db.insert(schema.businessAccounts).values({ name: "Journey CRM step", website: "https://symbiosis.example", whatsappEnabled: "true" } as any).returning();
  await storage.upsertWidgetSettings(A, { leadsquaredEnabled: "true", leadsquaredConnectionType: "uds", leadsquaredUdsWebhookUrl: udsUrl } as any);
  await db.insert(schema.leadsquaredFieldMappings).values([
    { businessAccountId: A, leadsquaredField: "FirstName", sourceType: "dynamic", sourceField: "lead.name", displayName: "Name", sortOrder: 1 },
    { businessAccountId: A, leadsquaredField: "Phone", sourceType: "dynamic", sourceField: "lead.phone", phoneCountryCode: "91", displayName: "Phone", sortOrder: 2 },
  ] as any);
  await whatsappService.saveSettings(A, { webhookSecret: "whsec_jcrm", autoSyncToLeadsquared: "true" } as any);

  const lead = async (name: string, phone: string, conversationId: string | null) =>
    storage.createLead({ businessAccountId: A, conversationId, name, phone } as any);
  const leadRow = async (id: string) => (await db.select().from(schema.leads).where(eq(schema.leads.id, id)))[0];
  const conversation = async () => (await db.insert(schema.conversations).values({ businessAccountId: A, title: "Chat" } as any).returning())[0].id;

  try {
    // ── Website journey ───────────────────────────────────────────────────────
    const [journey] = await db.insert(schema.conversationJourneys).values({ businessAccountId: A, name: "Lead Gen", journeyType: "form" } as any).returning();
    const [s1, s2, s3] = await db.insert(schema.journeySteps).values([
      { journeyId: journey.id, stepOrder: "0", questionText: "Your mobile number?", questionType: "phone" },
      { journeyId: journey.id, stepOrder: "1", questionText: "Which MBA specialisation are you interested in?", questionType: "multiple_choice" },
      { journeyId: journey.id, stepOrder: "2", questionText: "Have you completed your degree?", questionType: "yes_no" },
    ] as any).returning();
    await db.update(schema.journeySteps).set({ crmSyncAfter: "true" }).where(eq(schema.journeySteps.id, s2.id));
    const startJourney = async (conversationId: string) =>
      (await db.insert(schema.journeySessions).values({ journeyId: journey.id, conversationId, businessAccountId: A, userId: "visitor" } as any).returning())[0];
    const answer = async (session: any, step: any, response: string) =>
      db.insert(schema.journeyResponses).values({ sessionId: session.id, journeyId: journey.id, conversationId: session.conversationId, stepId: step.id, response });

    const c1 = await conversation();
    const sess1 = await startJourney(c1);
    await answer(sess1, s1, "9876500101");
    const w1 = await lead("Asha", "9876500101", c1);
    const r1 = await syncConversationLeadIfReady({ leadId: w1.id, businessAccountId: A, conversationId: c1, channel: "widget", source: "test" });
    const row1 = await leadRow(w1.id);
    expect(r1 === "skipped:journey_step" && !sentTo("9876500101"), "a website lead in a journey isn't sent before the CRM question");
    expect(row1.leadsquaredSyncStatus === "waiting_journey" && /specialisation/.test(row1.leadsquaredSyncError || ""), `the Leads page shows it waiting for that question (${row1.leadsquaredSyncError})`);
    expect(row1.updatedAt.getTime() === w1.updatedAt.getTime(), "showing the hold doesn't touch the lead's last-updated time");
    const unsynced = await storage.getUnsyncedLeads(A, ago(60), new Date(now + 60_000));
    expect(!unsynced.some((l) => l.id === w1.id), "bulk Sync unsynced leaves a lead that is waiting for the journey step");

    // Held-back sweep (visitor gone quiet): still not sent.
    await db.update(schema.leads).set({ updatedAt: ago(40) }).where(eq(schema.leads.id, w1.id));
    await sendHeldBackLeads();
    expect(!sentTo("9876500101"), "the 30-minute held-back sweep doesn't send a lead waiting for the journey step");

    await answer(sess1, s2, "Marketing");
    onWebsiteJourneyProgress(c1, { stepId: s2.id });
    await settle("9876500101");
    expect(sentTo("9876500101"), "answering the CRM question sends the lead");
    for (let i = 0; i < 20 && (await leadRow(w1.id)).leadsquaredSyncStatus !== "synced"; i++) await pause(100);
    expect((await leadRow(w1.id)).leadsquaredSyncStatus === "synced", "and it is marked synced");

    // A path that skipped the CRM question: finishing the journey counts.
    const c2 = await conversation();
    const sess2 = await startJourney(c2);
    const w2 = await lead("Bina", "9876500102", c2);
    expect(await syncConversationLeadIfReady({ leadId: w2.id, businessAccountId: A, conversationId: c2, channel: "widget", source: "test" }) === "skipped:journey_step", "a second visitor waits too");
    await answer(sess2, s3, "Yes");
    onWebsiteJourneyProgress(c2, { stepId: s3.id });
    await pause(500);
    expect(!sentTo("9876500102"), "answering another question doesn't send it");
    await db.update(schema.journeySessions).set({ completed: "true" }).where(eq(schema.journeySessions.id, sess2.id));
    onWebsiteJourneyProgress(c2, { completed: true });
    await settle("9876500102");
    expect(sentTo("9876500102"), "finishing the journey (on a path without the CRM question) sends it");

    // No journey: sent straight away, like before.
    const c3 = await conversation();
    const w3 = await lead("Chetan", "9876500103", c3);
    expect(await syncConversationLeadIfReady({ leadId: w3.id, businessAccountId: A, conversationId: c3, channel: "widget", source: "test" }) === "synced" && sentTo("9876500103"), "a chat without such a journey is sent as soon as it has a mobile (unchanged)");

    // Journey without a CRM question: unchanged too.
    await db.update(schema.journeySteps).set({ crmSyncAfter: "false" }).where(eq(schema.journeySteps.id, s2.id));
    const c4 = await conversation();
    await startJourney(c4);
    const w4 = await lead("Divya", "9876500104", c4);
    expect(await syncConversationLeadIfReady({ leadId: w4.id, businessAccountId: A, conversationId: c4, channel: "widget", source: "test" }) === "synced", "a journey with no CRM question doesn't hold leads");

    // Junk number.
    const c5 = await conversation();
    const w5 = await lead("Junk", "9999999999", c5);
    const r5 = await syncConversationLeadIfReady({ leadId: w5.id, businessAccountId: A, conversationId: c5, channel: "widget", source: "test" });
    const row5 = await leadRow(w5.id);
    expect(r5 === "skipped:invalid_phone" && row5.leadsquaredSyncStatus === "invalid_phone" && !sentTo("9999999999"), "a junk-looking mobile number isn't sent automatically");
    const manual = await crmLeadSync.syncLeadToLeadSquared(A, w5.id);
    expect(manual.status === 200 && sentTo("9999999999"), "Sync now on the lead sends it anyway");

    // ── WhatsApp journey ──────────────────────────────────────────────────────
    const [flow] = await db.insert(schema.whatsappFlows).values({ businessAccountId: A, name: "Lead Gen", isActive: "true" } as any).returning();
    const steps = await db.insert(schema.whatsappFlowSteps).values([
      { flowId: flow.id, stepKey: "start", stepOrder: 0, type: "buttons", prompt: "Hi! What would you like to do?" },
      { flowId: flow.id, stepKey: "specialisation", stepOrder: 1, type: "list", prompt: "Which MBA specialisation are you interested in?", saveToField: "specialisation" },
      { flowId: flow.id, stepKey: "eligibility", stepOrder: 2, type: "buttons", prompt: "Have you completed your degree?" },
    ] as any).returning();
    const crmStep = steps.find((s) => s.stepKey === "specialisation")!;
    expect(await whatsappFlowService.setCrmStep(flow.id, crmStep.id), "the WhatsApp journey's CRM step can be set");
    expect(!(await whatsappFlowService.setCrmStep(flow.id, s1.id)), "a step from another journey can't be");

    const waSession = async (phone: string) => (await db.insert(schema.whatsappFlowSessions).values({
      businessAccountId: A, flowId: flow.id, senderPhone: phone, currentStepKey: "start", collectedData: {},
      lastMessageAt: ago(10), createdAt: ago(12), // explicit: a local test DB's now() may not be UTC
    } as any).returning())[0];
    const waLead = async (phone: string, sessionId: string) => (await db.insert(schema.whatsappLeads).values({
      businessAccountId: A, senderPhone: phone, customerName: "WA " + phone.slice(-3), status: "new", flowSessionId: sessionId,
      receivedAt: ago(12), updatedAt: ago(10), lastMessageAt: ago(10),
    } as any).returning())[0];
    const waRow = async (id: string) => (await db.select().from(schema.whatsappLeads).where(eq(schema.whatsappLeads.id, id)))[0];
    const sessRow = async (id: string) => (await db.select().from(schema.whatsappFlowSessions).where(eq(schema.whatsappFlowSessions.id, id)))[0];

    const ws1 = await waSession("919876500201");
    const wl1 = await waLead("919876500201", ws1.id);
    await waSync.runWhatsappLsqSyncOnce();
    const wr1 = await waRow(wl1.id);
    expect(wr1.leadsquaredSyncStatus === "waiting_journey" && !sentTo("9876500201"), "a quiet WhatsApp lead before the CRM step waits instead of being sent");
    await waSync.runWhatsappLsqSyncOnce();
    expect((await waRow(wl1.id)).leadsquaredNextRetryAt?.getTime() === wr1.leadsquaredNextRetryAt?.getTime(), "it isn't looked at again until the chat moves");

    await whatsappFlowService.advanceSession(ws1.id, "specialisation", {});
    expect(!(await sessRow(ws1.id)).crmStepPassedAt, "reaching the CRM step isn't passing it");
    await whatsappFlowService.advanceSession(ws1.id, "specialisation", {});
    expect(!(await sessRow(ws1.id)).crmStepPassedAt, "being asked the CRM step again isn't passing it");
    await whatsappFlowService.advanceSession(ws1.id, "eligibility", { specialisation: "Marketing" });
    expect((await sessRow(ws1.id)).crmStepPassedAt, "moving on from the CRM step is recorded");
    await waSync.runWhatsappLsqSyncOnce();
    expect(sentTo("9876500201") && (await waRow(wl1.id)).leadsquaredSyncStatus === "synced", "the next worker pass sends the WhatsApp lead");

    // Another person stops before the step: "Sync all" leaves them, Sync now sends.
    const ws2 = await waSession("919876500202");
    const wl2 = await waLead("919876500202", ws2.id);
    const all = await waSync.syncAllWhatsappLeadsToLeadSquared(A);
    expect(!sentTo("9876500202") && all.skipped >= 1, `"Sync all" skips a WhatsApp lead still before the CRM step (${JSON.stringify(all)})`);
    await waSync.runWhatsappLsqSyncOnce();
    expect((await waRow(wl2.id)).leadsquaredSyncStatus === "waiting_journey", "it shows as waiting");
    const unsyncedWa = await waSync.unsyncedWhatsappLeads(A, ago(60), new Date(now + 60_000));
    expect(!unsyncedWa.some((l) => l.id === wl2.id), "the group Sync unsynced dialog leaves it out");
    const byHand = await waSync.syncWhatsappLeadToLeadSquared(wl2.id, { mode: "manual", businessAccountId: A });
    expect(byHand.success && sentTo("9876500202"), "Sync now on the WhatsApp lead sends it anyway");

    // The answer saved by an adaptive journey (step skipped) counts; and finishing counts.
    const ws3 = await waSession("919876500203");
    const wl3 = await waLead("919876500203", ws3.id);
    await db.update(schema.whatsappFlowSessions).set({ collectedData: { specialisation: "Finance" } }).where(eq(schema.whatsappFlowSessions.id, ws3.id));
    await waSync.runWhatsappLsqSyncOnce();
    expect(sentTo("9876500203"), "an answer already saved for the CRM step counts");
    const ws4 = await waSession("919876500204");
    await waLead("919876500204", ws4.id);
    await whatsappFlowService.completeSession(ws4.id, {});
    await waSync.runWhatsappLsqSyncOnce();
    expect(sentTo("9876500204"), "a finished WhatsApp journey counts");

    // No CRM step: unchanged (sent once quiet).
    await whatsappFlowService.setCrmStep(flow.id, null);
    const ws5 = await waSession("919876500205");
    await waLead("919876500205", ws5.id);
    await waSync.runWhatsappLsqSyncOnce();
    expect(sentTo("9876500205"), "without a CRM step a quiet WhatsApp lead is sent as before");
  } finally {
    server.close();
    await db.delete(schema.businessAccounts).where(inArray(schema.businessAccounts.id, [A]));
  }

  if (failed) {
    console.error(`\n${failed} journey CRM step check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll journey CRM step checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
