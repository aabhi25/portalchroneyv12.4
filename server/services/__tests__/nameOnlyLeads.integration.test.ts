/**
 * Integration test: a lead needs a mobile number or an email (real SQL).
 *  - a name alone is kept on the conversation (no lead row) and goes on the lead once a mobile arrives;
 *  - older name-only rows stay in the database but are left out of lists and counts.
 *
 * DESTRUCTIVE: creates rows. It refuses to run unless DATABASE_URL points at localhost AND
 * RETENTION_TEST_DB=1 is set. Run against a throwaway Postgres with the migrations applied:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   RETENTION_TEST_DB=1 npx tsx server/services/__tests__/nameOnlyLeads.integration.test.ts
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
  const { upsertConversationLead, getConversationLead } = await import("../leadCapture/leadStore");
  const { loadLeadCaptureState } = await import("../leadCapture/state");
  const { queryUnifiedLeads } = await import("../unifiedLeadsService");

  const [A] = await db.insert(schema.businessAccounts).values({ name: 'Name-only test', website: 'https://n.example' }).returning();
  const [conv] = await db.insert(schema.conversations).values({ businessAccountId: A.id, title: 'New chat' } as any).returning();
  try {
    // ── A name alone ─────────────────────────────────────────────────────────
    const first = await upsertConversationLead({ businessAccountId: A.id, conversationId: conv.id, values: { name: 'Jeevan', city: 'Indore' } });
    expect(first.lead === null && first.pending?.name === 'Jeevan', 'a name alone is not saved as a lead');
    expect(first.changed.includes('name'), 'the name counts as new information');
    expect(!(await getConversationLead(conv.id, A.id)), 'no lead row exists');
    expect((await loadLeadCaptureState(conv.id)).pendingLead?.city === 'Indore', 'the name and city wait on the chat');
    const [titled] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id));
    expect(titled.title === 'Jeevan', 'the chat is titled with the name');
    const again = await upsertConversationLead({ businessAccountId: A.id, conversationId: conv.id, values: { name: 'Jeevan' } });
    expect(again.lead === null && again.changed.length === 0, 'the same name again changes nothing');

    // ── Then a mobile number ─────────────────────────────────────────────────
    const second = await upsertConversationLead({ businessAccountId: A.id, conversationId: conv.id, values: { phone: '9876501234' } });
    expect(second.lead && second.created, 'the mobile number creates the lead');
    expect(second.lead?.name === 'Jeevan' && second.lead?.city === 'Indore' && second.lead?.phone === '9876501234', 'with the name and city given earlier');
    expect(!(await loadLeadCaptureState(conv.id)).pendingLead, 'nothing waits on the chat any more');
    const third = await upsertConversationLead({ businessAccountId: A.id, conversationId: conv.id, values: { email: 'jeevan@gmail.com' } });
    expect(third.lead?.id === second.lead?.id && third.lead?.email === 'jeevan@gmail.com', 'later details update the same lead');

    // ── Older name-only rows: kept, never listed or counted ───────────────────
    const [legacy] = await db.insert(schema.leads).values({ businessAccountId: A.id, name: 'Old name-only', message: 'Via Chat' } as any).returning();
    const [masked] = await db.insert(schema.leads).values({ businessAccountId: A.id, name: 'Synced', phone: '******3210', message: 'Via Chat' } as any).returning();
    expect((await db.select().from(schema.leads).where(eq(schema.leads.id, legacy.id))).length === 1, 'the old name-only row is still in the database');
    expect(await storage.countLeadsForAccount(A.id) === 2, 'counts leave it out (2 = Jeevan + the one with a hidden number)');
    const listed = await storage.getLeadsForAccounts([A.id], 50, 0, { includeUniqueLeads: true });
    expect(listed.total === 2 && !listed.leads.some(l => l.id === legacy.id), 'the group admin list leaves it out');
    expect(listed.leads.some(l => l.id === masked.id), 'a lead whose number was hidden after sync still shows');
    const page = await storage.getLeadsPaginated(A.id, {}, 50, 0);
    expect(page.total === 2 && !page.leads.some(l => l.id === legacy.id), 'the Leads page list leaves it out');
    const unified = await queryUnifiedLeads(A.id, { channel: 'website' }, { limit: 50, offset: 0 });
    expect(unified.total === 2 && !unified.leads.some(l => l.id === legacy.id), 'the combined Leads list leaves it out');
    expect((await storage.getAllLeads(A.id)).length === 2, 'downloads of all leads leave it out');
  } finally {
    await db.delete(schema.leads).where(eq(schema.leads.businessAccountId, A.id));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, conv.id));
    await db.delete(schema.businessAccounts).where(inArray(schema.businessAccounts.id, [A.id]));
  }

  if (failed) {
    console.error(`\n${failed} name-only lead check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll name-only lead checks passed.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
