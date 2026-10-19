/**
 * Integration test for "hide contact details after sync" (real SQL, real worker).
 *
 * DESTRUCTIVE: creates and changes rows. It refuses to run unless DATABASE_URL
 * points at localhost AND RETENTION_TEST_DB=1 is set, so it can never touch a
 * real database. Run against a throwaway Postgres with the migrations applied:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   RETENTION_TEST_DB=1 npx tsx server/services/__tests__/contactMasking.integration.test.ts
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
  const { eq } = await import("drizzle-orm");
  const { storage } = await import("../../storage");
  const svc = await import("../dataRetentionService");
  const { dataRetentionWorker } = await import("../dataRetentionWorker");
  const { LeadSquaredService } = await import("../leadsquaredService");
  const { syncLeadToLeadSquared } = await import("../crmLeadSync");
  const { HIDDEN_CONTACTS_MESSAGE } = await import("@shared/contactMasking");

  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000);
  const PHONE = '9876543210';
  const EMAIL = 'priya.sharma@gmail.com';

  // ── Fixtures ───────────────────────────────────────────────────────────────
  const [owner] = await db.insert(schema.users).values({ username: `mask-owner-${now}`, passwordHash: 'x', role: 'super_admin' }).returning();
  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'Mask Test Co', website: 'https://example.com' }).returning();
  const [other] = await db.insert(schema.businessAccounts).values({ name: 'Mask Other Co', website: 'https://other.example' }).returning();
  const [group] = await db.insert(schema.accountGroups).values({ name: 'Mask Group', ownerUserId: owner.id }).returning();
  await db.insert(schema.accountGroupMembers).values({ groupId: group.id, businessAccountId: acct.id });
  for (const id of [acct.id, other.id]) {
    await storage.upsertWidgetSettings(id, {
      leadsquaredEnabled: 'true', leadsquaredAccessKey: 'ak', leadsquaredSecretKey: 'sk', leadsquaredRegion: 'india',
    } as any);
  }

  /** A chat whose messages end `quietMinutes` ago; `summarized` = its summary is up to date. */
  const chat = async (accountId: string, v: { quietMinutes: number; messages?: number; summarized?: boolean }) => {
    const n = v.messages ?? 4;
    const last = ago(v.quietMinutes);
    const [c] = await db.insert(schema.conversations).values({
      businessAccountId: accountId,
      title: `Chat from ${PHONE}`,
      summary: v.summarized ? `Visitor wants MBA details; shared ${PHONE} and ${EMAIL}.` : null,
      topicKeywords: v.summarized ? 'mba, fees' : null,
      createdAt: ago(v.quietMinutes + 30),
      updatedAt: last,
      summarizedAt: v.summarized ? new Date(last.getTime() + 60_000) : null,
    } as any).returning();
    const lines = [
      { role: 'user', content: 'Hi, I want to know about the MBA fees' },
      { role: 'assistant', content: 'Sure! May I have your mobile number?' },
      { role: 'user', content: `It is +91 98765 43210, email ${EMAIL}` },
      { role: 'assistant', content: `Thanks! We'll call you on ${PHONE}. Fees are ₹2,50,000 per year.`, metadata: JSON.stringify({ formData: { mobile: PHONE, email: EMAIL }, ts: 1790000000000 }) },
    ].slice(0, n);
    for (let i = 0; i < lines.length; i++) {
      await db.insert(schema.messages).values({ conversationId: c.id, ...lines[i], createdAt: new Date(last.getTime() - (lines.length - 1 - i) * 1000) } as any);
    }
    return c.id;
  };
  const lead = async (accountId: string, v: { conversationId?: string | null; status?: string | null; syncedMinutesAgo?: number }) => {
    const [l] = await db.insert(schema.leads).values({
      businessAccountId: accountId,
      name: 'Priya Sharma', phone: PHONE, email: EMAIL,
      message: `Call me on ${PHONE}`,
      conversationId: v.conversationId ?? null,
      createdAt: ago(60),
      updatedAt: ago(60),
      leadsquaredSyncStatus: v.status ?? null,
      leadsquaredSyncedAt: v.syncedMinutesAgo !== undefined ? ago(v.syncedMinutesAgo) : null,
      leadsquaredLeadId: v.status === 'synced' ? 'lsq-' + Math.random().toString(36).slice(2) : null,
      leadsquaredSyncPayload: { FirstName: 'Priya Sharma', Phone: `+91-${PHONE}`, EmailAddress: EMAIL },
    } as any).returning();
    return l.id;
  };
  const getLead = async (id: string) => (await db.select().from(schema.leads).where(eq(schema.leads.id, id)))[0];
  const chatText = async (convId: string) => JSON.stringify(await db.select().from(schema.messages).where(eq(schema.messages.conversationId, convId)));

  // A: synced, quiet 10 min, final summary in → hidden.
  const cA = await chat(acct.id, { quietMinutes: 10, summarized: true });
  const A = await lead(acct.id, { conversationId: cA, status: 'synced', syncedMinutesAgo: 20 });
  const [journey] = await db.insert(schema.conversationJourneys).values({ businessAccountId: acct.id, name: 'J' } as any).returning();
  const [step] = await db.insert(schema.journeySteps).values({ journeyId: journey.id, stepOrder: '0', questionText: 'Mobile?' } as any).returning();
  const [session] = await db.insert(schema.journeySessions).values({ journeyId: journey.id, conversationId: cA, businessAccountId: acct.id, userId: 'u' } as any).returning();
  await db.insert(schema.journeyResponses).values({ sessionId: session.id, journeyId: journey.id, conversationId: cA, stepId: step.id, response: PHONE } as any);
  await db.insert(schema.questionBankEntries).values({ businessAccountId: acct.id, conversationId: cA, question: `Can you call ${PHONE}?` } as any);
  await db.insert(schema.appointments).values({ businessAccountId: acct.id, leadId: A, conversationId: cA, patientName: 'Priya', patientPhone: PHONE, appointmentDate: new Date(), appointmentTime: '10:00' } as any);
  // B: synced but the visitor is still chatting → kept.
  const cB = await chat(acct.id, { quietMinutes: 2, summarized: false });
  const B = await lead(acct.id, { conversationId: cB, status: 'synced', syncedMinutesAgo: 3 });
  // C: synced, quiet 10 min, summary not in yet → kept for now.
  const cC = await chat(acct.id, { quietMinutes: 10, summarized: false });
  const C = await lead(acct.id, { conversationId: cC, status: 'synced', syncedMinutesAgo: 20 });
  // D: same, but quiet 40 min → no summary is coming, hidden.
  const cD = await chat(acct.id, { quietMinutes: 40, summarized: false });
  const D = await lead(acct.id, { conversationId: cD, status: 'synced', syncedMinutesAgo: 45 });
  // E: never synced → kept.
  const cE = await chat(acct.id, { quietMinutes: 60, summarized: true });
  const E = await lead(acct.id, { conversationId: cE, status: 'failed' });
  // F: synced form lead without a chat → hidden.
  const F = await lead(acct.id, { status: 'synced', syncedMinutesAgo: 20 });
  // G: short chat (2 messages, never summarized), quiet 10 min → hidden.
  const cG = await chat(acct.id, { quietMinutes: 10, messages: 2 });
  const G = await lead(acct.id, { conversationId: cG, status: 'synced', syncedMinutesAgo: 20 });
  // Other account (no policy) → untouched.
  const cO = await chat(other.id, { quietMinutes: 60, summarized: true });
  const O = await lead(other.id, { conversationId: cO, status: 'synced', syncedMinutesAgo: 60 });

  // ── Policy: hide only (auto-delete off) ───────────────────────────────────
  await svc.upsertRetentionPolicy('group', group.id, {
    mode: 'off', deleteSyncedAfterMinutes: 24 * 60, deleteUnsyncedAfterMinutes: null, deleteIdleChatsAfterMinutes: null, keepAnonymousCounts: true, maskContactsAfterSync: true,
  }, owner.id);
  const eff = await svc.getEffectivePolicy(acct.id);
  expect(eff?.mode === 'off' && eff.maskContactsAfterSync, "hide-only group policy reaches the account (mode off)");
  expect(await svc.getEffectivePolicy(other.id) === null, "account outside the group has no policy");
  expect((await svc.getAccountsWithActivePolicy()).includes(acct.id), "worker picks up hide-only accounts");
  expect(await svc.countMaskDueForAccount(acct.id) === 4, `preview: 4 leads to hide (A, D, F, G) — got ${await svc.countMaskDueForAccount(acct.id)}`);

  await dataRetentionWorker.run();

  const a = await getLead(A);
  expect(a.phone === '******3210' && a.email === 'pr***@gmail.com' && a.name === 'Priya Sharma', "A: lead phone/email hidden, name kept");
  expect(a.message === 'Call me on ******3210', "A: lead message hidden");
  expect(!JSON.stringify(a.leadsquaredSyncPayload).includes(PHONE) && !JSON.stringify(a.leadsquaredSyncPayload).includes('priya.sharma'), "A: saved CRM payload hidden");
  expect(a.leadsquaredSyncStatus === 'synced' && !!a.contactsMaskedAt, "A: still synced, hidden time stamped");
  const textA = await chatText(cA);
  expect(!textA.includes(PHONE) && !textA.includes('98765 43210') && !textA.includes('priya.sharma'), "A: chat messages hidden");
  expect(textA.includes('MBA fees') && textA.includes('₹2,50,000'), "A: rest of the chat readable");
  const metaA = (await db.select().from(schema.messages).where(eq(schema.messages.conversationId, cA))).find(m => m.metadata)!;
  expect(JSON.parse(metaA.metadata!).ts === 1790000000000 && JSON.parse(metaA.metadata!).formData.mobile === '******3210', "A: message metadata still valid JSON, timestamp kept");
  const [convA] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, cA));
  expect(!convA.summary!.includes(PHONE) && convA.summary!.includes('MBA') && !convA.title.includes(PHONE), "A: summary and title hidden");
  expect(convA.updatedAt.getTime() === ago(10).getTime(), "A: conversation not marked as changed (no re-summary)");
  const [respA] = await db.select().from(schema.journeyResponses).where(eq(schema.journeyResponses.conversationId, cA));
  expect(respA.response === '******3210', "A: journey answer hidden");
  const [qA] = await db.select().from(schema.questionBankEntries).where(eq(schema.questionBankEntries.conversationId, cA));
  expect(!qA.question.includes(PHONE), "A: unanswered-question entry hidden");
  const [apptA] = await db.select().from(schema.appointments).where(eq(schema.appointments.leadId, A));
  expect(apptA.patientPhone === PHONE, "A: appointment keeps its number (reminders still work)");

  expect((await getLead(B)).phone === PHONE && (await chatText(cB)).includes(PHONE), "B: visitor still chatting → kept");
  expect((await getLead(C)).phone === PHONE, "C: summary not in yet → kept for now");
  expect((await getLead(D)).phone === '******3210' && !(await chatText(cD)).includes(PHONE), "D: quiet 40 min without summary → hidden");
  expect((await getLead(E)).phone === PHONE && (await chatText(cE)).includes(PHONE), "E: never synced → kept");
  expect((await getLead(F)).phone === '******3210', "F: synced lead without a chat → hidden");
  expect((await getLead(G)).phone === '******3210', "G: short chat with no summary → hidden");
  expect((await getLead(O)).phone === PHONE && (await chatText(cO)).includes(PHONE), "other account untouched");

  const [st] = await db.select().from(schema.dataRetentionAccountStatus).where(eq(schema.dataRetentionAccountStatus.businessAccountId, acct.id));
  expect(!st, "hide-only policy records no delete status");
  const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.action, 'data_retention.contacts_masked'));
  const audit = audits.find(x => x.businessAccountId === acct.id);
  expect(audit && (audit.metadata as any)?.maskedLeads === 4, "hide audit event written with the count");
  expect(!JSON.stringify(audits).includes(PHONE), "audit holds no phone numbers");

  // A second run changes nothing.
  const stampA = (await getLead(A)).contactsMaskedAt!.getTime();
  await dataRetentionWorker.run();
  expect((await getLead(A)).contactsMaskedAt!.getTime() === stampA, "second run leaves hidden leads alone");
  expect(await svc.countMaskDueForAccount(acct.id) === 0, "nothing else due");

  // ── CRM guard ─────────────────────────────────────────────────────────────
  const lsq = new LeadSquaredService({ accessKey: 'ak', secretKey: 'sk', region: 'india' } as any);
  const mappings = [
    { leadsquaredField: 'FirstName', sourceType: 'dynamic', sourceField: 'lead.name', isEnabled: 'true' },
    { leadsquaredField: 'Phone', sourceType: 'dynamic', sourceField: 'lead.phone', isEnabled: 'true', phoneCountryCode: '+91', fallbackValue: 'NA' },
    { leadsquaredField: 'EmailAddress', sourceType: 'dynamic', sourceField: 'lead.email', isEnabled: 'true' },
  ] as any[];
  const ctx = { lead: { name: a.name, phone: a.phone, email: a.email }, session: {}, business: {} } as any;
  const attrs = lsq.buildAttributesFromMappings(mappings, ctx);
  expect(attrs.length === 1 && attrs[0].Attribute === 'FirstName', "hidden phone/email are never put in a CRM update (not even the fallback)");
  const created = await lsq.createLeadWithMappings(mappings, ctx);
  expect(!created.success && created.message === HIDDEN_CONTACTS_MESSAGE, "creating a CRM lead from a hidden lead is refused");
  const manual = await syncLeadToLeadSquared(acct.id, A);
  expect(manual.status === 400 && (manual.body as any).error === HIDDEN_CONTACTS_MESSAGE, "manual Sync on a hidden lead explains why");
  expect((await getLead(A)).leadsquaredSyncStatus === 'synced', "manual Sync attempt does not mark the lead failed");

  // ── Returning visitor shares a new number ─────────────────────────────────
  await db.update(schema.leads).set({ contactsMaskedAt: ago(20) }).where(eq(schema.leads.id, A));
  await db.insert(schema.messages).values({ conversationId: cA, role: 'user', content: 'New number: 9123456780', createdAt: ago(9) } as any);
  await db.update(schema.leads).set({ phone: '9123456780', updatedAt: ago(9), leadsquaredSyncedAt: ago(8) }).where(eq(schema.leads.id, A));
  await db.update(schema.conversations).set({ updatedAt: ago(9), summarizedAt: ago(8) }).where(eq(schema.conversations.id, cA));
  expect(!(await svc.countMaskDueForAccount(acct.id) === 0), "lead with new real details is due again once synced and quiet");
  await dataRetentionWorker.run();
  expect((await getLead(A)).phone === '******6780' && !(await chatText(cA)).includes('9123456780'), "new number hidden after it synced");

  // ── Report ────────────────────────────────────────────────────────────────
  const report = await svc.getRetentionReport([acct.id], new Date(now - 24 * 60 * 60_000), new Date(now + 60 * 60_000));
  expect(report[0]?.hidesContacts && report[0].hiddenLeads === 4 && report[0].deletedLeads === 0, `report: 4 hidden, none deleted — got ${report[0]?.hiddenLeads}`);

  // ── Hiding + live delete together ─────────────────────────────────────────
  await svc.upsertRetentionPolicy('account', acct.id, {
    mode: 'live', deleteSyncedAfterMinutes: 15, deleteUnsyncedAfterMinutes: null, deleteIdleChatsAfterMinutes: null, keepAnonymousCounts: true, maskContactsAfterSync: true,
  }, owner.id);
  await dataRetentionWorker.run();
  expect(!(await getLead(D)), "with live auto-delete on as well, due leads are still deleted");
  await svc.upsertRetentionPolicy('account', acct.id, {
    mode: 'off', deleteSyncedAfterMinutes: 24 * 60, deleteUnsyncedAfterMinutes: null, deleteIdleChatsAfterMinutes: null, keepAnonymousCounts: true, maskContactsAfterSync: false,
  }, owner.id);
  expect(await svc.getEffectivePolicy(acct.id) === null, "account override with both off beats the group");

  if (failed > 0) {
    console.error(`\n${failed} integration check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll contact masking integration checks passed.");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
