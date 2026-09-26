/**
 * Integration test for the data-retention purge (real SQL, real worker).
 *
 * DESTRUCTIVE: creates and deletes rows. It refuses to run unless DATABASE_URL
 * points at localhost AND RETENTION_TEST_DB=1 is set, so it can never touch a
 * real database. Run against a throwaway Postgres with the app schema pushed:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   RETENTION_TEST_DB=1 npx tsx server/services/__tests__/dataRetention.integration.test.ts
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
  const { eq, inArray } = await import("drizzle-orm");
  const { storage } = await import("../../storage");
  const svc = await import("../dataRetentionService");
  const { dataRetentionWorker } = await import("../dataRetentionWorker");

  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000);
  const H = 60;

  // ── Fixtures ───────────────────────────────────────────────────────────────
  const [owner] = await db.insert(schema.users).values({ username: `ret-owner-${now}`, passwordHash: 'x', role: 'super_admin' }).returning();
  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'Retention Test Co', website: 'https://example.com' }).returning();
  const [other] = await db.insert(schema.businessAccounts).values({ name: 'Other Co', website: 'https://other.example' }).returning();
  const [group] = await db.insert(schema.accountGroups).values({ name: 'Retention Group', ownerUserId: owner.id }).returning();
  await db.insert(schema.accountGroupMembers).values({ groupId: group.id, businessAccountId: acct.id });
  for (const id of [acct.id, other.id]) {
    await storage.upsertWidgetSettings(id, {
      leadsquaredEnabled: 'true', leadsquaredAccessKey: 'ak', leadsquaredSecretKey: 'sk', leadsquaredRegion: 'india',
    } as any);
  }

  const conv = async (accountId: string, createdMinutesAgo: number, lastMessageMinutesAgo: number | null, imageUrl?: string) => {
    const [c] = await db.insert(schema.conversations).values({ businessAccountId: accountId, title: 't', createdAt: ago(createdMinutesAgo), updatedAt: ago(createdMinutesAgo) } as any).returning();
    if (lastMessageMinutesAgo !== null) {
      await db.insert(schema.messages).values({ conversationId: c.id, role: 'user', content: 'hi', createdAt: ago(lastMessageMinutesAgo), imageUrl: imageUrl ?? null } as any);
    }
    return c.id;
  };
  const lead = async (accountId: string, v: { conversationId?: string | null; createdMinutesAgo: number; status?: string | null; syncedMinutesAgo?: number; topics?: string[]; sourceUrl?: string }) => {
    const [l] = await db.insert(schema.leads).values({
      businessAccountId: accountId,
      name: 'Test Person', phone: '9000000001', email: 'p@example.com',
      conversationId: v.conversationId ?? null,
      createdAt: ago(v.createdMinutesAgo),
      leadsquaredSyncStatus: v.status ?? null,
      leadsquaredSyncedAt: v.syncedMinutesAgo !== undefined ? ago(v.syncedMinutesAgo) : null,
      leadsquaredLeadId: v.status === 'synced' ? 'lsq-' + Math.random().toString(36).slice(2) : null,
      topicsOfInterest: v.topics ?? [],
      sourceUrl: v.sourceUrl ?? null,
    } as any).returning();
    return l.id;
  };

  const c1 = await conv(acct.id, 26 * H, 25 * H, '/uploads/chat-images/does-not-exist.png');
  const L1 = await lead(acct.id, { conversationId: c1, createdMinutesAgo: 26 * H, status: 'synced', syncedMinutesAgo: 25 * H, sourceUrl: 'https://example.com/?utm_source=g' });
  const [journey] = await db.insert(schema.conversationJourneys).values({ businessAccountId: acct.id, name: 'J' } as any).returning();
  await db.insert(schema.journeySessions).values({ journeyId: journey.id, conversationId: c1, businessAccountId: acct.id, userId: 'u' } as any);
  await db.insert(schema.appointments).values({ businessAccountId: acct.id, leadId: L1, conversationId: c1, patientName: 'x', patientPhone: '9000000001', appointmentDate: new Date(), appointmentTime: '10:00' } as any);
  await db.insert(schema.supportTickets).values({ businessAccountId: acct.id, conversationId: c1, ticketNumber: String(now % 1000000), customerName: 'x', subject: 's', description: 'd' } as any);

  const c2 = await conv(acct.id, 3 * H, 2 * H);
  const L2 = await lead(acct.id, { conversationId: c2, createdMinutesAgo: 3 * H, status: 'synced', syncedMinutesAgo: 2 * H });
  const c3 = await conv(acct.id, 26 * H, 5);
  const L3 = await lead(acct.id, { conversationId: c3, createdMinutesAgo: 26 * H, status: 'synced', syncedMinutesAgo: 25 * H });
  const L4 = await lead(acct.id, { createdMinutesAgo: 30 * 24 * H, status: 'failed' });
  const L5 = await lead(acct.id, { createdMinutesAgo: 26 * H, status: 'synced', syncedMinutesAgo: 25 * H, topics: ['Via Form'] });
  const c6 = await conv(acct.id, 26 * H, 25 * H);
  const L6 = await lead(acct.id, { conversationId: c6, createdMinutesAgo: 26 * H, status: 'synced', syncedMinutesAgo: 25 * H });
  const L7 = await lead(acct.id, { conversationId: c6, createdMinutesAgo: 26 * H, status: 'needs_attention' });
  const c8 = await conv(acct.id, 30 * H, 30 * H);
  const c9 = await conv(acct.id, 30 * H, 60);
  const cOther = await conv(other.id, 26 * H, 25 * H);
  const LOther = await lead(other.id, { conversationId: cOther, createdMinutesAgo: 26 * H, status: 'synced', syncedMinutesAgo: 25 * H });

  // ── No policy → nothing happens ───────────────────────────────────────────
  expect(await svc.getEffectivePolicy(acct.id) === null, "no policy → effective policy is off");

  // ── Dry run via the worker ────────────────────────────────────────────────
  await svc.upsertRetentionPolicy('group', group.id, {
    mode: 'dry_run', deleteSyncedAfterMinutes: 24 * H, deleteUnsyncedAfterMinutes: null, deleteIdleChatsAfterMinutes: 24 * H, keepAnonymousCounts: true,
  }, owner.id);
  const eff = await svc.getEffectivePolicy(acct.id);
  expect(eff?.mode === 'dry_run' && eff.source === 'group', "account inherits the group policy");
  expect(await svc.getEffectivePolicy(other.id) === null, "account outside the group is unaffected");

  const due = await svc.countDueForAccount(acct.id, eff!);
  expect(due.leads === 3, `due leads = 3 (L1, L5, L6) — got ${due.leads}`);
  expect(due.idleChats === 1, `idle chats due = 1 (C8) — got ${due.idleChats}`);

  await dataRetentionWorker.run();
  const [st] = await db.select().from(schema.dataRetentionAccountStatus).where(eq(schema.dataRetentionAccountStatus.businessAccountId, acct.id));
  expect(st?.mode === 'dry_run' && st.dueLeads === 3 && st.dueConversations === 1, "dry run records due counts");
  const stillAll = await db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.businessAccountId, acct.id));
  expect(stillAll.length === 7, "dry run deletes nothing");

  // ── Live via the worker ───────────────────────────────────────────────────
  await svc.upsertRetentionPolicy('group', group.id, {
    mode: 'live', deleteSyncedAfterMinutes: 24 * H, deleteUnsyncedAfterMinutes: null, deleteIdleChatsAfterMinutes: 24 * H, keepAnonymousCounts: true,
  }, owner.id);
  await dataRetentionWorker.run();

  const leadIds = new Set((await db.select({ id: schema.leads.id }).from(schema.leads)).map(r => r.id));
  const convIds = new Set((await db.select({ id: schema.conversations.id }).from(schema.conversations)).map(r => r.id));
  expect(!leadIds.has(L1) && !leadIds.has(L5) && !leadIds.has(L6), "synced leads past 24h deleted (L1, L5, L6)");
  expect(leadIds.has(L2), "recently synced lead kept (L2)");
  expect(leadIds.has(L3), "lead with an active chat kept (L3)");
  expect(leadIds.has(L4), "never-synced lead kept (no unsynced timer) (L4)");
  expect(leadIds.has(L7), "needs-attention lead kept (L7)");
  expect(leadIds.has(LOther), "other account's lead untouched");
  expect(!convIds.has(c1), "conversation of deleted lead deleted (C1)");
  expect(convIds.has(c6), "conversation shared with a kept lead survives (C6)");
  expect(!convIds.has(c8), "idle chat with no lead deleted (C8)");
  expect(convIds.has(c9), "chat with no lead but recent activity kept (C9)");
  expect(convIds.has(cOther), "other account's conversation untouched");

  const msgs = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, c1));
  expect(msgs.length === 0, "messages of deleted conversation gone (cascade)");
  const journeys = await db.select().from(schema.journeySessions).where(eq(schema.journeySessions.conversationId, c1));
  expect(journeys.length === 0, "journey sessions gone (cascade)");
  const appts = await db.select().from(schema.appointments).where(eq(schema.appointments.businessAccountId, acct.id));
  expect(appts.length === 0, "linked appointment deleted");
  const tickets = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.businessAccountId, acct.id));
  expect(tickets.length === 0, "linked support ticket deleted");

  const tombs = await db.select().from(schema.dataPurgeLog).where(eq(schema.dataPurgeLog.businessAccountId, acct.id));
  const leadTombs = tombs.filter(t => t.recordType === 'lead');
  const convTombs = tombs.filter(t => t.recordType === 'conversation');
  expect(leadTombs.length === 3 && leadTombs.every(t => t.synced && t.reason === 'synced_retention' && t.crmLeadId), "3 lead tombstones with CRM IDs");
  expect(convTombs.length === 2, `2 conversation tombstones (C1 with lead, C8 idle) — got ${convTombs.length}`);
  const t1 = leadTombs.find(t => t.recordId === L1)!;
  expect(t1.source === 'journey' && t1.isPaid, "L1 tombstone classified journey + paid");
  expect(leadTombs.find(t => t.recordId === L5)?.source === 'form', "L5 tombstone classified form");
  expect(!JSON.stringify(tombs).includes('9000000001') && !JSON.stringify(tombs).includes('p@example.com'), "tombstones hold no phone/email");

  const purged = await svc.getPurgedAnalytics([acct.id]);
  expect(purged.leads.total === 3 && purged.leads.journey === 1 && purged.leads.form === 1 && purged.leads.paid === 1, "anonymous lead counts for dashboards");
  expect(purged.conversations.total === 2, "anonymous conversation counts for dashboards");

  const [st2] = await db.select().from(schema.dataRetentionAccountStatus).where(eq(schema.dataRetentionAccountStatus.businessAccountId, acct.id));
  expect(st2?.mode === 'live' && st2.lastPurgedLeads === 3 && st2.dueLeads === 0, "live status recorded");
  const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.action, 'data_retention.purged'));
  expect(audits.some(a => a.businessAccountId === acct.id), "purge audit event written");

  // A second run finds nothing new.
  await dataRetentionWorker.run();
  const tombs2 = await db.select().from(schema.dataPurgeLog).where(eq(schema.dataPurgeLog.businessAccountId, acct.id));
  expect(tombs2.length === tombs.length, "second run deletes nothing more");

  // ── Unsynced timer ────────────────────────────────────────────────────────
  await svc.upsertRetentionPolicy('group', group.id, {
    mode: 'live', deleteSyncedAfterMinutes: 24 * H, deleteUnsyncedAfterMinutes: 7 * 24 * H, deleteIdleChatsAfterMinutes: 24 * H, keepAnonymousCounts: true,
  }, owner.id);
  await dataRetentionWorker.run();
  const after = new Set((await db.select({ id: schema.leads.id }).from(schema.leads)).map(r => r.id));
  expect(!after.has(L4), "with a 7-day unsynced timer the 30-day-old failed lead is deleted (L4)");
  expect(after.has(L7), "the 26h-old needs-attention lead is still kept (L7)");

  // ── Account override beats the group ──────────────────────────────────────
  await svc.upsertRetentionPolicy('account', acct.id, {
    mode: 'off', deleteSyncedAfterMinutes: 24 * H, deleteUnsyncedAfterMinutes: null, deleteIdleChatsAfterMinutes: null, keepAnonymousCounts: true,
  }, owner.id);
  expect(await svc.getEffectivePolicy(acct.id) === null, "account override 'off' beats the live group policy");
  await svc.deleteAccountOverride(acct.id);
  expect((await svc.getEffectivePolicy(acct.id))?.mode === 'live', "removing the override restores the group policy");

  // ── Report ────────────────────────────────────────────────────────────────
  const report = await svc.getRetentionReport([acct.id], new Date(now - 60 * 24 * H * 60_000), new Date(now + 60_000));
  const r = report[0];
  expect(r && r.deletedLeads === 4 && r.leadsHeldNow === 3, `report: 4 leads deleted, 3 held (L2, L3, L7) — got ${r?.deletedLeads}/${r?.leadsHeldNow}`);

  if (failed > 0) {
    console.error(`\n${failed} integration check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll data retention integration checks passed.");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
