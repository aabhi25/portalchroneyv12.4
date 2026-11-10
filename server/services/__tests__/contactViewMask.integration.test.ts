/**
 * Integration test for "hide contact details from view" (real SQL, real middleware, real worker).
 *
 * DESTRUCTIVE: creates rows. It refuses to run unless DATABASE_URL points at localhost AND
 * RETENTION_TEST_DB=1 is set. Run against a throwaway Postgres with the migrations applied:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   RETENTION_TEST_DB=1 npx tsx server/services/__tests__/contactViewMask.integration.test.ts
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
  const express = (await import("express")).default;
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { storage } = await import("../../storage");
  const svc = await import("../dataRetentionService");
  const { dataRetentionWorker } = await import("../dataRetentionWorker");
  const { contactViewMaskMiddleware, hidesContactsFromView, clearContactViewMaskCache } = await import("../../lib/contactViewMask");
  const { contactsHidden } = await import("@shared/contactMasking");

  const now = Date.now();
  const PHONE = '9876543210';
  const EMAIL = 'priya.sharma@gmail.com';
  const settings = (over: Record<string, unknown>) => ({
    mode: 'off' as const, deleteSyncedAfterMinutes: 1440, deleteUnsyncedAfterMinutes: null, deleteIdleChatsAfterMinutes: null,
    keepAnonymousCounts: true, maskContactsAfterSync: false, hideContactsFromView: false, ...over,
  });

  // ── Fixtures: A in the group, B in the group with its own "off" override, C in no group ─────
  const [owner] = await db.insert(schema.users).values({ username: `view-owner-${now}`, passwordHash: 'x', role: 'super_admin' }).returning();
  const [A] = await db.insert(schema.businessAccounts).values({ name: 'View A', website: 'https://a.example' }).returning();
  const [B] = await db.insert(schema.businessAccounts).values({ name: 'View B', website: 'https://b.example' }).returning();
  const [C] = await db.insert(schema.businessAccounts).values({ name: 'View C', website: 'https://c.example' }).returning();
  const [group] = await db.insert(schema.accountGroups).values({ name: 'View Group', ownerUserId: owner.id }).returning();
  await db.insert(schema.accountGroupMembers).values([{ groupId: group.id, businessAccountId: A.id }, { groupId: group.id, businessAccountId: B.id }]);
  await storage.upsertWidgetSettings(A.id, { leadsquaredEnabled: 'true', leadsquaredAccessKey: 'ak', leadsquaredSecretKey: 'sk', leadsquaredRegion: 'india' } as any);

  const [conv] = await db.insert(schema.conversations).values({ businessAccountId: A.id, title: `Chat from ${PHONE}`, summary: `Shared ${PHONE} and ${EMAIL}` } as any).returning();
  await db.insert(schema.messages).values({ conversationId: conv.id, role: 'user', content: `My number is +91 98765 43210, email ${EMAIL}`, createdAt: new Date(now - 60 * 60_000) } as any);
  const [lead] = await db.insert(schema.leads).values({
    businessAccountId: A.id, name: 'Priya', phone: PHONE, email: EMAIL, message: `Call ${PHONE}`, conversationId: conv.id,
    createdAt: new Date(now - 60 * 60_000), updatedAt: new Date(now - 60 * 60_000), leadsquaredSyncStatus: 'failed',
  } as any).returning();

  // ── Policy rules ───────────────────────────────────────────────────────────
  await svc.upsertRetentionPolicy('group', group.id, settings({ hideContactsFromView: true }), owner.id);
  await svc.upsertRetentionPolicy('account', B.id, settings({}), owner.id);
  clearContactViewMaskCache();
  expect(await hidesContactsFromView(A.id), 'group member hides from view');
  expect(!(await hidesContactsFromView(B.id)), "account's own override (off) beats the group");
  expect(!(await hidesContactsFromView(C.id)), 'account in no group is unaffected');
  const effA = await svc.getEffectivePolicy(A.id);
  expect(effA?.hideContactsFromView === true && effA.mode === 'off', 'effective policy is active with auto-delete off');
  expect((await svc.getAccountsWithActivePolicy()).includes(A.id), 'hide-only policy counts as active');
  expect(await svc.countLeadsWithContacts(A.id) === 1, 'preview counts leads with contact details');

  // ── Middleware on real requests ───────────────────────────────────────────
  let user: any = null;
  const app = express();
  app.use((req, _res, next) => { (req as any).user = user; next(); });
  app.use(contactViewMaskMiddleware);
  const leadRow = async () => (await db.select().from(schema.leads).where(eq(schema.leads.id, lead.id)))[0];
  app.get('/api/leads', async (_req, res) => { res.json({ leads: [await leadRow()], total: 1 }); });
  app.get('/api/leads/unified', (_req, res) => {
    res.json({ leads: [{ channel: 'website', id: lead.id, phone: PHONE, email: EMAIL }, { channel: 'whatsapp', id: 'w1', phone: '919812345678' }], total: 2 });
  });
  app.get('/api/conversations/:id/messages', async (req, res) => {
    res.json(await db.select().from(schema.messages).where(eq(schema.messages.conversationId, req.params.id)));
  });
  app.get('/api/group-admin/groups/:groupId/leads', async (_req, res) => { res.json({ leads: [await leadRow()] }); });
  app.get('/api/leads/broken', (_req, res) => { res.status(400).json({ error: `bad ${PHONE}` }); });
  app.get('/api/settings/profile', (_req, res) => { res.json({ phone: PHONE }); });
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const get = async (path: string) => (await fetch(`http://127.0.0.1:${port}${path}`)).json();

  user = { id: 'u1', role: 'business_user', businessAccountId: A.id };
  const list = await get('/api/leads');
  expect(list.leads[0].phone === '******3210' && list.leads[0].email === 'pr***@gmail.com', 'Leads list: phone and email shown hidden');
  expect(list.leads[0].contactsHiddenFromView === true, 'Leads list: row flagged as hidden-from-view');
  expect(list.leads[0].id === lead.id && list.leads[0].conversationId === conv.id, 'Leads list: IDs untouched');
  expect(!JSON.stringify(list).includes(PHONE) && !JSON.stringify(list).includes(EMAIL), 'Leads list: no real detail anywhere in the response');
  const msgs = await get(`/api/conversations/${conv.id}/messages`);
  expect(!JSON.stringify(msgs).includes('98765 43210') && !JSON.stringify(msgs).includes(EMAIL), 'Chat messages: details hidden');
  const unified = await get('/api/leads/unified');
  expect(unified.leads[0].phone.includes('*') && unified.leads[1].phone === '919812345678', 'Combined list: website hidden, WhatsApp row untouched');
  const groupView = await get(`/api/group-admin/groups/${group.id}/leads`);
  user = { id: 'g1', role: 'account_group_admin' };
  const groupView2 = await get(`/api/group-admin/groups/${group.id}/leads`);
  expect(groupView2.leads[0].phone === '******3210', 'Group admin view: hidden');
  expect(!!groupView, 'group route reachable');
  user = { id: 'u1', role: 'business_user', businessAccountId: A.id };
  expect((await get('/api/leads/broken')).error.includes(PHONE), 'Error responses untouched');
  expect((await get('/api/settings/profile')).phone === PHONE, 'Unrelated routes untouched');

  user = { id: 's1', role: 'super_admin', businessAccountId: A.id, activeBusinessAccountId: A.id };
  expect((await get('/api/leads')).leads[0].phone === PHONE, 'Super admin sees the real details');

  user = { id: 'u3', role: 'business_user', businessAccountId: C.id };
  expect((await get('/api/leads')).leads[0].phone === PHONE, 'Account that does not hide: real details shown');

  // Switching it off shows the details again (nothing was overwritten).
  await svc.upsertRetentionPolicy('group', group.id, settings({ hideContactsFromView: false }), owner.id);
  clearContactViewMaskCache();
  user = { id: 'u1', role: 'business_user', businessAccountId: A.id };
  expect((await get('/api/leads')).leads[0].phone === PHONE, 'Switched off: details show again');
  await svc.upsertRetentionPolicy('group', group.id, settings({ hideContactsFromView: true }), owner.id);
  clearContactViewMaskCache();
  server.close();

  // ── Worker: hide-from-view never overwrites anything ──────────────────────
  await (dataRetentionWorker as any).processAccount(A.id);
  const after = await leadRow();
  expect(after.phone === PHONE && after.email === EMAIL && after.contactsMaskedAt === null, 'Worker leaves the real details in the database');
  const msgAfter = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id));
  expect(msgAfter[0].content.includes('98765 43210'), 'Worker leaves the chat untouched');
  expect(!contactsHidden(after), 'Lead can still be sent to the CRM');

  if (failed) {
    console.error(`\n${failed} contact view-hiding check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll contact view-hiding checks passed.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
