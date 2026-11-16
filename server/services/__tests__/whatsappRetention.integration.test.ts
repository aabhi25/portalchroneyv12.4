/**
 * Integration test for the auto-delete settings on WhatsApp leads and chats (real SQL):
 * hide from view (phone keys), auto-delete per number, and removing contact details after sync
 * once the chat has been quiet for 7 days.
 *
 * DESTRUCTIVE: creates rows. It refuses to run unless DATABASE_URL points at localhost AND
 * RETENTION_TEST_DB=1 is set. Run against a throwaway Postgres with the migrations applied:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   RETENTION_TEST_DB=1 npx tsx server/services/__tests__/whatsappRetention.integration.test.ts
 */
const url = process.env.DATABASE_URL || '';
if (process.env.RETENTION_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set RETENTION_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
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
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { storage } = await import("../../storage");
  const wr = await import("../whatsappRetention");
  const { hideContactsForView, phoneFromParam } = await import("../../lib/contactViewMask");
  const { syncWhatsappLeadToLeadSquared } = await import("../whatsappLeadLsqSync");
  const { countLeadsWithContacts } = await import("../dataRetentionService");

  // ── Hide from view: the number is replaced, and a phoneKey opens the chat ─────────────
  const shown: any = hideContactsForView({ conversations: [{ sender_phone: "919876543210", sender_name: "Ravi" }] });
  const row = shown.conversations[0];
  expect(!row.sender_phone.includes("98765") && row.sender_phone.endsWith("3210"), `the chat list shows the number hidden (${row.sender_phone})`);
  expect(row.phoneKey?.startsWith("wak.") && phoneFromParam(row.phoneKey) === "919876543210", "its phoneKey opens the chat with the real number");
  expect((hideContactsForView({ sender_phone: "919876543210" }) as any).phoneKey === row.phoneKey, "the same number always gets the same key");
  expect(phoneFromParam(row.phoneKey.slice(0, -2) + "xx") !== "919876543210", "a changed key opens nothing");
  expect(phoneFromParam("919876543210") === "919876543210", "a plain number still works");

  // ── Fixtures ─────────────────────────────────────────────────────────────────
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000);
  const DAY = 24 * 60;
  const [A] = await db.insert(schema.businessAccounts).values({ name: "WA Retention", website: "https://x.example", whatsappEnabled: "true" } as any).returning();
  await storage.upsertWidgetSettings(A.id, { leadsquaredEnabled: "true", leadsquaredConnectionType: "uds", leadsquaredUdsWebhookUrl: "https://uds.example/hook" } as any);
  const msg = (phone: string, at: Date, v: Partial<typeof schema.whatsappLeads.$inferInsert> = {}) =>
    db.insert(schema.whatsappLeads).values({ businessAccountId: A.id, senderPhone: phone, status: "message_only", rawMessage: "hi", receivedAt: at, ...v } as any).returning().then((r) => r[0]);
  const lead = (phone: string, at: Date, synced: Date | null, v: Partial<typeof schema.whatsappLeads.$inferInsert> = {}) =>
    msg(phone, at, { status: "new", customerName: "Student", customerEmail: "student@gmail.com", rawMessage: `My number is ${phone}`,
      ...(synced ? { leadsquaredSyncStatus: "synced", leadsquaredSyncedAt: synced } : {}), ...v });

  const P1 = "919800000001"; // synced 2 days ago, quiet 2 days → due after a 1-day "after sync" timer
  await lead(P1, ago(3 * DAY), ago(2 * DAY)); await msg(P1, ago(2 * DAY));
  await db.insert(schema.whatsappOptOuts).values({ businessAccountId: A.id, phone: P1, reason: "user_stop" });
  const P2 = "919800000002"; // never synced, first lead 3 days ago → due after a 2-day "never synced" timer
  await lead(P2, ago(3 * DAY), null); await msg(P2, ago(3 * DAY - 5));
  const P3 = "919800000003"; // no lead, quiet 3 days → due after a 1-day "no lead" timer
  await msg(P3, ago(3 * DAY));
  const P4 = "919800000004"; // synced long ago but still writing → kept
  await lead(P4, ago(3 * DAY), ago(2 * DAY)); await msg(P4, ago(10));
  const P5 = "919800000005"; // synced, quiet 8 days → contact details removed
  const L5 = await lead(P5, ago(9 * DAY), ago(8 * DAY), { extractedData: { email: "p5@gmail.com", course: "MBA" } });
  await msg(P5, ago(8 * DAY));
  await db.insert(schema.whatsappFlowSessions).values({ businessAccountId: A.id, senderPhone: P5, flowId: (await db.insert(schema.whatsappFlows).values({ businessAccountId: A.id, name: "F" } as any).returning())[0].id, status: "completed", collectedData: { phone: P5 } } as any).catch(() => undefined);
  const P6 = "919800000006"; // synced, quiet only 2 days → not removed yet
  await lead(P6, ago(3 * DAY), ago(2 * DAY + 60)); await msg(P6, ago(2 * DAY));

  const policy = { mode: "live" as const, deleteSyncedAfterMinutes: 3 * DAY, deleteUnsyncedAfterMinutes: 2 * DAY, deleteIdleChatsAfterMinutes: DAY, keepAnonymousCounts: true, maskContactsAfterSync: true, hideContactsFromView: false };
  const rowsOf = async (phone: string) => db.select().from(schema.whatsappLeads).where(and(eq(schema.whatsappLeads.businessAccountId, A.id), eq(schema.whatsappLeads.senderPhone, phone)));

  try {
    expect(await countLeadsWithContacts(A.id) === 5, "the hide-from-view preview counts WhatsApp leads");

    // ── Remove contact details after sync ─────────────────────────────────────────
    expect(await wr.countWhatsappMaskDue(A.id) === 1, "only the synced chat quiet for 7+ days is due for removal");
    expect(await wr.maskWhatsappContacts(A.id) === 1, "its contact details are removed");
    const hidden = wr.hiddenWhatsappNumber(A.id, P5);
    const p5Rows = await rowsOf(hidden);
    const p5Lead = p5Rows.find((r) => r.status === "new")!;
    expect((await rowsOf(P5)).length === 0 && p5Rows.length === 2, `every message of that chat now carries the hidden number (${hidden})`);
    expect(!JSON.stringify(p5Rows).includes("9800000005") && !JSON.stringify(p5Rows).includes("p5@gmail.com") && p5Lead.customerEmail === "st***@gmail.com", "the number and email are gone from messages, answers and the lead");
    expect((p5Lead.extractedData as any)?.course === "MBA", "other details stay");
    expect((await syncWhatsappLeadToLeadSquared(L5.id, { mode: "manual" })).skipped === "not_eligible", "a lead with removed details is never sent to the CRM again");
    expect((await rowsOf(P6)).length === 2, "a synced chat quiet for only 2 days keeps its number");
    expect(await wr.maskWhatsappContacts(A.id) === 0, "nothing is removed twice");

    // ── Auto-delete ─────────────────────────────────────────────────────────────
    // A 1-day "after sync" timer: P1, P5 (details removed) and P6 are synced long enough, P2 never
    // synced past 2 days, P3 has no lead; P4 is still writing.
    const due = await wr.countWhatsappDue(A.id, { ...policy, deleteSyncedAfterMinutes: DAY });
    expect(due.leads === 4 && due.chats === 1, `due: 4 leads and 1 chat without a lead (${JSON.stringify(due)})`);
    const purged = await wr.purgeWhatsapp(A.id, { ...policy, deleteSyncedAfterMinutes: DAY });
    expect(purged.leads === 4 && purged.chats === 1, "they are deleted");
    expect((await rowsOf(P1)).length === 0 && (await rowsOf(P2)).length === 0 && (await rowsOf(P3)).length === 0, "with every message of those chats");
    expect((await rowsOf(P4)).length === 2, "a chat where the student is still writing is kept");
    const optOut = await db.select().from(schema.whatsappOptOuts).where(and(eq(schema.whatsappOptOuts.businessAccountId, A.id), eq(schema.whatsappOptOuts.phone, P1)));
    expect(optOut.length === 1, "a student who said Stop stays on the opt-out list");
    const tombstones = await db.select().from(schema.dataPurgeLog).where(eq(schema.dataPurgeLog.businessAccountId, A.id));
    expect(tombstones.filter((t) => t.recordType === "whatsapp_lead").length === 4 && tombstones.filter((t) => t.recordType === "whatsapp_chat").length === 5, "each deleted lead and chat leaves an anonymous record for the report");
    expect(!JSON.stringify(tombstones).includes("98000000"), "the records hold no phone number");
    expect((await rowsOf(hidden)).length === 0, "a chat with removed details is deleted by the same timers");
    const left = await wr.countWhatsappDue(A.id, { ...policy, deleteSyncedAfterMinutes: DAY });
    expect(left.leads === 0 && left.chats === 0, "nothing else is due");
    const longTimer = await wr.countWhatsappDue(A.id, { ...policy, deleteSyncedAfterMinutes: 30 * DAY, deleteUnsyncedAfterMinutes: null, deleteIdleChatsAfterMinutes: null });
    expect(longTimer.leads === 0, "with longer timers the kept chat stays");
  } finally {
    await db.delete(schema.dataPurgeLog).where(eq(schema.dataPurgeLog.businessAccountId, A.id));
    await db.delete(schema.whatsappLeads).where(eq(schema.whatsappLeads.businessAccountId, A.id));
    await db.delete(schema.businessAccounts).where(inArray(schema.businessAccounts.id, [A.id]));
  }

  if (failed) {
    console.error(`\n${failed} WhatsApp retention check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll WhatsApp retention checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
