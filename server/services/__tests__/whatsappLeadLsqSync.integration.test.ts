/**
 * Integration test for WhatsApp leads → LeadSquared (real SQL, real worker pass, a fake UDS
 * webhook on localhost that records what LeadSquared would receive).
 *
 * DESTRUCTIVE: creates rows. It refuses to run unless DATABASE_URL points at localhost AND
 * WA_LSQ_TEST_DB=1 is set. Run against a throwaway Postgres with the migrations applied:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   WA_LSQ_TEST_DB=1 npx tsx server/services/__tests__/whatsappLeadLsqSync.integration.test.ts
 */
const url = process.env.DATABASE_URL || '';
if (process.env.WA_LSQ_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set WA_LSQ_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
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

async function main() {
  const http = await import("http");
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { storage } = await import("../../storage");
  const { whatsappService } = await import("../whatsappService");
  const sync = await import("../whatsappLeadLsqSync");

  // ── A fake LeadSquared UDS webhook ───────────────────────────────────────────
  const received: Record<string, string>[] = [];
  let failNext = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (failNext > 0) {
        failNext--;
        res.writeHead(503);
        res.end("busy");
        return;
      }
      received.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const udsUrl = `http://127.0.0.1:${(server.address() as any).port}/uds`;

  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000);
  const account = async (name: string) => (await db.insert(schema.businessAccounts).values({ name, website: "https://symbiosis.example", whatsappEnabled: "true" } as any).returning())[0].id;
  const A = await account("WA LSQ On");
  const B = await account("WA LSQ Off");
  for (const id of [A, B]) {
    await storage.upsertWidgetSettings(id, { leadsquaredEnabled: "true", leadsquaredConnectionType: "uds", leadsquaredUdsWebhookUrl: udsUrl } as any);
    await db.insert(schema.leadsquaredFieldMappings).values([
      { businessAccountId: id, leadsquaredField: "FirstName", sourceType: "dynamic", sourceField: "lead.name", displayName: "Name", sortOrder: 1 },
      { businessAccountId: id, leadsquaredField: "Phone", sourceType: "dynamic", sourceField: "lead.phone", phoneCountryCode: "91", displayName: "Phone", sortOrder: 2 },
      { businessAccountId: id, leadsquaredField: "mx_Source", sourceType: "dynamic", sourceField: "lead.channel", displayName: "Source", sortOrder: 3 },
      { businessAccountId: id, leadsquaredField: "mx_Course", sourceType: "dynamic", sourceField: "journey.course", displayName: "Course", sortOrder: 4 },
      { businessAccountId: id, leadsquaredField: "mx_Page", sourceType: "dynamic", sourceField: "session.pageUrl", displayName: "Page", sortOrder: 5 },
    ] as any);
    await db.insert(schema.whatsappLeadFields).values({ businessAccountId: id, fieldKey: "course_name", fieldLabel: "Course", defaultCrmFieldKey: "course" });
  }
  await whatsappService.saveSettings(A, { webhookSecret: "whsec_a", autoSyncToLeadsquared: "true" } as any);
  await whatsappService.saveSettings(B, { webhookSecret: "whsec_b", autoSyncToLeadsquared: "false" } as any);

  const lead = async (accountId: string, v: { phone: string; name?: string; course?: string; receivedMin: number; updatedMin: number; status?: string }) =>
    (await db.insert(schema.whatsappLeads).values({
      businessAccountId: accountId, senderPhone: v.phone, customerName: v.name ?? null, status: v.status ?? "new",
      extractedData: v.course ? { course_name: v.course } : null,
      receivedAt: ago(v.receivedMin), updatedAt: ago(v.updatedMin), lastMessageAt: ago(v.updatedMin),
    } as any).returning())[0];
  const row = async (id: string) => (await db.select().from(schema.whatsappLeads).where(eq(schema.whatsappLeads.id, id)))[0];

  const L1 = await lead(A, { phone: "919876500001", name: "Ravi", course: "Online MBA", receivedMin: 12, updatedMin: 10 });
  const L2 = await lead(A, { phone: "919876500002", name: "Still chatting", receivedMin: 3, updatedMin: 1 });
  const L3 = await lead(A, { phone: "919876500003", receivedMin: 20, updatedMin: 20, status: "message_only" });
  const L4 = await lead(A, { phone: "919876500004", name: "Old lead", receivedMin: 10 * 24 * 60, updatedMin: 10 * 24 * 60 });
  const L5 = await lead(B, { phone: "919876500005", name: "Switch off", receivedMin: 12, updatedMin: 10 });
  await db.insert(schema.whatsappHandoffs).values({
    businessAccountId: A, code: "PAGE01", source: "header", targetNumber: "917718922885", connectedNumber: true,
    expiresAt: new Date(now + 86_400_000), usedAt: ago(11), lastUsedAt: ago(11), whatsappPhone: "919876500001",
    pageUrl: "https://symbiosis.example/online-mba?utm_source=google",
  } as any);

  try {
    // ── New leads ─────────────────────────────────────────────────────────────
    await sync.runWhatsappLsqSyncOnce();
    const sentRavi = received.find((r) => r.FirstName === "Ravi");
    expect(sentRavi, "a new WhatsApp lead is sent once the chat has been quiet 5 minutes");
    expect(sentRavi?.Phone === "+91-9876500001", `its WhatsApp number is sent in the mapping's format (${sentRavi?.Phone})`);
    expect(sentRavi?.mx_Source === "WhatsApp", "lead.channel is WhatsApp");
    expect(sentRavi?.mx_Course === "Online MBA", "a detail collected on WhatsApp fills journey.<default CRM key>");
    expect(sentRavi?.mx_Page === "https://symbiosis.example/online-mba?utm_source=google", "the landing page of the website WhatsApp button is sent");
    const r1 = await row(L1.id);
    expect(r1.leadsquaredSyncStatus === "synced" && r1.leadsquaredSyncedAt && (r1.leadsquaredSyncPayload as any)?.FirstName === "Ravi", "it is marked synced with what was sent");
    expect(!(await row(L2.id)).leadsquaredSyncStatus, "a chat still going on waits");
    expect(!(await row(L3.id)).leadsquaredSyncStatus, "a plain message (not a lead) is never sent");
    expect(!(await row(L4.id)).leadsquaredSyncStatus, "a lead older than 7 days is not sent by itself");
    expect(!(await row(L5.id)).leadsquaredSyncStatus, "an account with the switch off sends nothing by itself");

    // ── Changed and unchanged leads ─────────────────────────────────────────
    await db.update(schema.whatsappLeads).set({ leadsquaredSyncedAt: ago(30), extractedData: { course_name: "Online BBA" }, updatedAt: ago(6), lastMessageAt: ago(6) }).where(eq(schema.whatsappLeads.id, L1.id));
    const before = received.length;
    await sync.runWhatsappLsqSyncOnce();
    expect(received.length === before + 1 && received[received.length - 1].mx_Course === "Online BBA", "a lead whose details changed is sent again with the new course");
    await db.update(schema.whatsappLeads).set({ leadsquaredSyncedAt: ago(30), lastMessage: "thanks", updatedAt: ago(6), lastMessageAt: ago(6) }).where(eq(schema.whatsappLeads.id, L1.id));
    const before2 = received.length;
    await sync.runWhatsappLsqSyncOnce();
    expect(received.length === before2, "a new message that changes nothing it would send is not sent again");
    await sync.runWhatsappLsqSyncOnce();
    expect(received.length === before2, "and it isn't checked again until something new happens");

    // ── Failures and retries ───────────────────────────────────────────────
    const L6 = await lead(A, { phone: "919876500006", name: "Retry me", receivedMin: 15, updatedMin: 10 });
    failNext = 1;
    await sync.runWhatsappLsqSyncOnce();
    const failedRow = await row(L6.id);
    expect(failedRow.leadsquaredSyncStatus === "failed" && /503/.test(failedRow.leadsquaredSyncError || ""), "a LeadSquared error marks it failed with the reason");
    await db.update(schema.whatsappLeads).set({ leadsquaredNextRetryAt: ago(1) }).where(eq(schema.whatsappLeads.id, L6.id));
    await sync.runWhatsappLsqSyncOnce();
    expect((await row(L6.id)).leadsquaredSyncStatus === "synced", "the retry sends it");

    // ── By hand ─────────────────────────────────────────────────────────────
    const manual = await sync.syncWhatsappLeadToLeadSquared(L5.id, { mode: "manual", businessAccountId: B });
    expect(manual.success && (await row(L5.id)).leadsquaredSyncStatus === "synced", "Sync on a lead works with the switch off");
    expect((await sync.syncWhatsappLeadToLeadSquared(L3.id, { mode: "manual", businessAccountId: A })).skipped === "not_eligible", "a plain message can't be synced");
    expect((await sync.syncWhatsappLeadToLeadSquared(L1.id, { mode: "manual", businessAccountId: B })).skipped === "not_found", "another account's lead can't be synced");
    const all = await sync.syncAllWhatsappLeadsToLeadSquared(A);
    expect(all.synced === 2 && (await row(L4.id)).leadsquaredSyncStatus === "synced" && (await row(L2.id)).leadsquaredSyncStatus === "synced", `Sync all sends the old and the waiting leads (${JSON.stringify(all)})`);
    expect((await sync.syncAllWhatsappLeadsToLeadSquared(A)).synced === 0, "Sync all again sends nothing twice");

    await storage.upsertWidgetSettings(B, { leadsquaredEnabled: "false" } as any);
    const L7 = await lead(B, { phone: "919876500007", name: "No LSQ", receivedMin: 15, updatedMin: 10 });
    expect((await sync.syncWhatsappLeadToLeadSquared(L7.id, { mode: "manual", businessAccountId: B })).skipped === "not_configured", "an account without LeadSquared can't sync");
  } finally {
    server.close();
    await db.delete(schema.businessAccounts).where(inArray(schema.businessAccounts.id, [A, B]));
  }

  if (failed) {
    console.error(`\n${failed} WhatsApp → LeadSquared check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll WhatsApp → LeadSquared checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
