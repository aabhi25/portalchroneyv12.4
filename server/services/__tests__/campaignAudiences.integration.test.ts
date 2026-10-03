/**
 * Integration tests for WhatsApp campaign audiences, templates, opt-outs and
 * AI workbook auto-sync (real SQL; MSG91 and OpenAI are faked):
 *  - a hand-added template is NOT auto-approved; existing approved ones stay approved;
 *    provider status check, confirm-by-hand, rename resets verification
 *  - audience contacts: server-side pages, search (name/phone/any field), total
 *  - audience from Leads: one per phone, opted-out people skipped
 *  - dynamic (self-updating) audiences resolve at send time (getContactsForGroups)
 *  - workbook automatic result sync is idempotent
 *  - opt-out list endpoints (search, add, CSV) and contacts endpoint over HTTP
 *  - "Help me write" template draft with a fake model
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at
 * localhost AND CAMPAIGN_TEST_DB=1 is set. Nothing leaves the machine.
 */
const url = process.env.DATABASE_URL || '';
if (process.env.CAMPAIGN_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set CAMPAIGN_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

// ── MSG91 stub (template list only — this suite never sends messages) ────────
let remoteTemplates: any[] = [];
let lastTemplateUrl = '';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const u = String(input?.url ?? input);
  if (!u.startsWith('https://control.msg91.com/')) return realFetch(input, init);
  lastTemplateUrl = u;
  if (u.includes('/get-template-client/')) {
    return new Response(JSON.stringify({ data: remoteTemplates }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`Unexpected MSG91 call in test: ${u}`);
}) as typeof fetch;

async function main() {
  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq, and, desc } = await import('drizzle-orm');
  const { whatsappTemplateService, templateDraftDeps, sanitizeTemplateDraft } = await import('../whatsappTemplateService');
  const { contactGroupService, contactMatchesCondition } = await import('../contactGroupService');
  const { whatsappAiWorkbookService, sheetsFingerprint } = await import('../whatsappAiWorkbookService');
  const { isTemplateUsable, countUsableTemplates } = await import('../whatsapp/campaignPrerequisites');

  const stamp = Date.now();
  const [acct] = await db.insert(schema.businessAccounts).values({
    name: `Audiences ${stamp}`, website: 'https://example.com', whatsappEnabled: 'true', whatsappMarketingEnabled: 'true',
  } as any).returning();
  const biz = acct.id;
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  let tplId = '';

  // ── 1. Templates: no auto-approval, existing approved untouched ───────────
  {
    const [legacy] = await db.insert(schema.whatsappTemplates).values({
      businessAccountId: biz, name: 'legacy_offer', bodyText: 'Hi {{1}}', paramCount: 1, status: 'approved', sourceType: 'manual',
    } as any).returning();
    tplId = legacy.id;
    const created = await whatsappTemplateService.create(biz, { name: 'welcome_note', language: 'en', bodyText: 'Hello {{1}}, welcome!', namespace: 'ns' } as any);
    expect(created.status === 'not_verified', 'hand-added template starts as not verified (not approved)', created.status);
    expect(!isTemplateUsable(created), 'a not-verified template is not campaign-ready');
    const [legacyAfter] = await db.select().from(schema.whatsappTemplates).where(eq(schema.whatsappTemplates.id, legacy.id));
    expect(legacyAfter.status === 'approved', 'existing approved template stays approved', legacyAfter.status);
    expect(await countUsableTemplates(biz) === 1, 'readiness still counts the existing approved template', await countUsableTemplates(biz));

    const pendingOne = await whatsappTemplateService.create(biz, { name: 'promo_pending', language: 'en', bodyText: 'Sale {{1}} today' } as any);
    const unknownOne = await whatsappTemplateService.create(biz, { name: 'typo_name', language: 'en', bodyText: 'x {{1}} y' } as any);
    const rejectedOne = await whatsappTemplateService.create(biz, { name: 'bad_one', language: 'en', bodyText: 'x {{1}} y' } as any);
    remoteTemplates = [
      { name: 'welcome_note', languages: [{ language: 'en_US', status: 'APPROVED' }] },
      { name: 'promo_pending', languages: [{ language: 'en', status: 'PENDING' }] },
      { name: 'bad_one', languages: [{ language: 'en', status: 'REJECTED', rejection_reason: 'Promotional content in utility' }] },
      { name: 'legacy_offer', languages: [{ language: 'en', status: 'APPROVED' }] },
    ];
    const { checked } = await whatsappTemplateService.refreshStatus(biz, 'test-key', '919999999999');
    const byId = new Map(checked.map(c => [c.id, c]));
    expect(!lastTemplateUrl.includes('template_status='), 'status check reads every status from the provider', lastTemplateUrl);
    expect(byId.get(created.id)?.status === 'approved', 'provider-approved template becomes approved (en_US ↔ en)', byId.get(created.id));
    expect(byId.get(pendingOne.id)?.status === 'pending', 'provider-pending template shows pending', byId.get(pendingOne.id));
    expect(byId.get(unknownOne.id)?.found === false && byId.get(unknownOne.id)?.status === 'not_verified', 'unknown template stays not verified', byId.get(unknownOne.id));
    const [rej] = await db.select().from(schema.whatsappTemplates).where(eq(schema.whatsappTemplates.id, rejectedOne.id));
    expect(rej.status === 'rejected' && rej.rejectionReason === 'Promotional content in utility' && rej.statusSource === 'provider', 'rejected template stores the reason', rej);
    const [legacyChecked] = await db.select().from(schema.whatsappTemplates).where(eq(schema.whatsappTemplates.id, legacy.id));
    expect(legacyChecked.status === 'approved', 'existing approved template still approved after the check');

    let threw = '';
    try { await whatsappTemplateService.confirmApproved(biz, rejectedOne.id); } catch (e: any) { threw = e.message; }
    expect(/rejected/i.test(threw), 'a rejected template cannot be confirmed by hand', threw);
    const confirmed = await whatsappTemplateService.confirmApproved(biz, unknownOne.id);
    expect(confirmed?.status === 'approved' && confirmed?.statusSource === 'user_confirmed', 'business can confirm a not-verified template', confirmed);
    const bodyEdit = await whatsappTemplateService.update(biz, unknownOne.id, { bodyText: 'x {{1}} y z' } as any);
    expect(bodyEdit?.status === 'approved', 'editing only the body keeps the approval', bodyEdit?.status);
    const renamed = await whatsappTemplateService.update(biz, unknownOne.id, { name: 'fixed_name' } as any);
    expect(renamed?.status === 'not_verified', 'renaming a hand-added template needs verifying again', renamed?.status);
    const tamper = await whatsappTemplateService.update(biz, created.id, { status: 'approved', bodyText: 'Hello {{1}}!' } as any);
    expect(tamper?.status === 'approved' && tamper.statusSource === 'provider', 'PATCH body cannot set status (server-controlled)', tamper);
  }

  // ── 2. Contacts: pages, search, total ─────────────────────────────────────
  const listGroup = await contactGroupService.create(biz, 'Big list');
  {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      groupId: listGroup.id, businessAccountId: biz,
      phone: `9198100${String(i).padStart(5, '0')}`,
      name: i === 7 ? 'Zara Khan' : `Person ${i}`,
      attributes: i % 10 === 0 ? { city: 'Pune' } : { city: 'Delhi' },
    }));
    await db.insert(schema.contactGroupContacts).values(rows as any);
    await contactGroupService.refreshContactCount(listGroup.id);
    const p1 = await contactGroupService.listContactsPage(biz, listGroup.id, { page: 1, pageSize: 50 });
    expect(p1.total === 120 && p1.contacts.length === 50 && p1.totalPages === 3, 'page 1 of 3 (50 per page), total 120', { t: p1.total, n: p1.contacts.length, pages: p1.totalPages });
    const p3 = await contactGroupService.listContactsPage(biz, listGroup.id, { page: 3, pageSize: 50 });
    expect(p3.contacts.length === 20, 'last page has the remaining 20', p3.contacts.length);
    const all = new Set([...p1.contacts, ...(await contactGroupService.listContactsPage(biz, listGroup.id, { page: 2, pageSize: 50 })).contacts, ...p3.contacts].map(c => c.id));
    expect(all.size === 120, 'pages do not overlap or skip', all.size);
    const byName = await contactGroupService.listContactsPage(biz, listGroup.id, { search: 'zara' });
    expect(byName.total === 1 && byName.contacts[0].name === 'Zara Khan', 'search by name (case-insensitive)', byName.total);
    const byPhone = await contactGroupService.listContactsPage(biz, listGroup.id, { search: '+91 98100 00042' });
    expect(byPhone.total === 1, 'search by phone ignores spaces and +', byPhone.total);
    const byField = await contactGroupService.listContactsPage(biz, listGroup.id, { search: 'pune', pageSize: 25 });
    expect(byField.total === 12 && byField.pageSize === 25, 'search any extra field (city) with page size 25', { t: byField.total, ps: byField.pageSize });
    const oddSize = await contactGroupService.listContactsPage(biz, listGroup.id, { pageSize: 7 });
    expect(oddSize.pageSize === 50, 'unsupported page size falls back to 50', oddSize.pageSize);
    const legacy = await contactGroupService.getContacts(biz, listGroup.id);
    expect(legacy.length === 120, 'old getContacts() contract still works', legacy.length);
    const removed = await contactGroupService.bulkRemoveContacts(biz, listGroup.id, { allMatching: true, search: 'pune' });
    const [g] = await db.select().from(schema.contactGroups).where(eq(schema.contactGroups.id, listGroup.id));
    expect(removed === 12 && g.contactCount === 108, 'bulk delete of matching contacts updates the count', { removed, count: g.contactCount });
  }

  // ── 3. Audience from Leads: dedupe + opt-out skip ─────────────────────────
  {
    const mk = (v: Record<string, unknown>) => db.insert(schema.leads).values({ businessAccountId: biz, ...v } as any);
    await mk({ name: 'Asha', phone: '+91 98765 00001', email: 'a@x.com', topicsOfInterest: ['Home loan'], createdAt: new Date(Date.now() - 2 * 86400_000) });
    await mk({ name: 'Asha again', phone: '9876500001', createdAt: new Date(Date.now() - 3 * 86400_000) }); // same person
    await mk({ name: 'Ravi', phone: '919876500002', topicsOfInterest: ['Car'], createdAt: new Date(Date.now() - 1 * 86400_000) });
    await mk({ name: 'Opted', phone: '9876500003', createdAt: new Date(Date.now() - 1 * 86400_000) });
    await mk({ name: 'No phone', email: 'n@x.com', createdAt: new Date(Date.now() - 1 * 86400_000) });
    await mk({ name: 'Old lead', phone: '9876500009', createdAt: new Date(Date.now() - 40 * 86400_000) });
    await db.insert(schema.whatsappLeads).values({ businessAccountId: biz, senderPhone: '919876500004', customerName: 'Wa Lead', status: 'new', qualifiedAt: new Date(), receivedAt: new Date(Date.now() - 86400_000) } as any);
    await contactGroupService.addOptOut(biz, '+91 98765 00003');

    const preview = await contactGroupService.collectLeadMembers(biz, { lastNDays: 30 });
    expect(preview.stats.count === 3, 'leads (30 days): Asha, Ravi, WhatsApp lead', preview.stats);
    expect(preview.stats.duplicates === 1 && preview.stats.optedOut === 1 && preview.stats.withoutPhone === 1, 'one duplicate, one opted out, one without phone', preview.stats);
    const created = await contactGroupService.createFromLeads(biz, { name: 'Recent leads', filter: { lastNDays: 30 } });
    const contacts = await contactGroupService.getContacts(biz, created.group.id);
    const phones = contacts.map(c => c.phone).sort();
    expect(contacts.length === 3 && created.group.contactCount === 3, 'audience from leads has 3 people', phones);
    expect(!phones.some(p => p.endsWith('9876500003')), 'opted-out lead was skipped', phones);
    expect(contacts.find(c => c.phone.endsWith('9876500001'))?.name === 'Asha', 'dedupe keeps the newest lead for a phone');
    const web = await contactGroupService.collectLeadMembers(biz, { channels: ['website'], topic: 'loan' });
    expect(web.stats.count === 1 && web.members[0].name === 'Asha', 'channel + topic filter', web.stats);
    await db.insert(schema.leads).values({ businessAccountId: biz, name: 'Newcomer', phone: '9876500005' } as any);
    const topUp = await contactGroupService.refreshFromLeads(biz, created.group.id);
    expect(topUp.added === 1 && topUp.total === 4, 'refresh from leads adds only the new person', topUp);
    const again = await contactGroupService.refreshFromLeads(biz, created.group.id);
    expect(again.added === 0 && again.total === 4, 'refreshing again adds nobody (idempotent)', again);

    await db.update(schema.businessAccounts).set({ leadPhoneMaskingEnabled: 'true' } as any).where(eq(schema.businessAccounts.id, biz));
    let masked = '';
    try { await contactGroupService.collectLeadMembers(biz, {}); } catch (e: any) { masked = e.message; }
    expect(/hidden/i.test(masked), 'leads audiences are refused when lead phones are hidden for the account', masked);
    await db.update(schema.businessAccounts).set({ leadPhoneMaskingEnabled: 'false' } as any).where(eq(schema.businessAccounts.id, biz));
  }

  // ── 4. Dynamic segments resolve at send time ──────────────────────────────
  {
    expect(contactMatchesCondition({ phone: '1', name: 'A', attributes: { City: 'Pune' } }, { field: 'attr:city', op: 'equals', value: 'pune' }), 'condition: field lookup is case-insensitive');
    const source = await contactGroupService.create(biz, 'Customers');
    await contactGroupService.addContact(biz, source.id, '919000000001', 'P1', { city: 'Pune', plan: 'gold' });
    await contactGroupService.addContact(biz, source.id, '919000000002', 'P2', { city: 'Mumbai', plan: 'gold' });
    await contactGroupService.addContact(biz, source.id, '919000000003', 'P3', { city: 'Pune', plan: 'silver' });
    const rules = { source: 'contacts' as const, contacts: { groupIds: [source.id], match: 'all' as const, conditions: [{ field: 'attr:city', op: 'equals' as const, value: 'Pune' }] } };
    const live = await contactGroupService.previewRules(biz, rules);
    expect(live.count === 2, 'live count for "city = Pune"', live.count);
    const { group: dyn } = await contactGroupService.createDynamic(biz, { name: 'Pune customers', rules });
    expect(dyn.audienceType === 'dynamic' && dyn.contactCount === 2, 'dynamic audience stores its current members', dyn);
    let addErr = '';
    try { await contactGroupService.addContact(biz, dyn.id, '919000000099'); } catch (e: any) { addErr = e.message; }
    expect(/rules/i.test(addErr), 'people cannot be added by hand to a dynamic audience', addErr);

    await contactGroupService.addContact(biz, source.id, '919000000004', 'P4', { city: 'pune' });
    await contactGroupService.addOptOut(biz, '9000000003');
    const atSend = await contactGroupService.getContactsForGroups(biz, [dyn.id]);
    const sendPhones = atSend.map(c => c.phone).sort();
    expect(JSON.stringify(sendPhones) === JSON.stringify(['919000000001', '919000000004']), 'send-time read re-evaluates: new match in, opted-out out', sendPhones);
    const resolved = await contactGroupService.resolveAudienceContacts(biz, dyn.id);
    expect(resolved.length === 2, 'resolveAudienceContacts returns the same members', resolved.length);
    const { countContactsInGroups } = await import('../whatsapp/campaignPrerequisites');
    expect(await countContactsInGroups(biz, [dyn.id]) === 2, 'readiness check sees the dynamic members', await countContactsInGroups(biz, [dyn.id]));

    const { group: leadSeg } = await contactGroupService.createDynamic(biz, { name: 'Last week leads', rules: { source: 'leads', leads: { lastNDays: 7 } } });
    expect(leadSeg.audienceType === 'dynamic' && leadSeg.contactCount === 4, 'dynamic leads segment (last 7 days)', leadSeg.contactCount);
    await db.insert(schema.leads).values({ businessAccountId: biz, name: 'Fresh', phone: '9876500006' } as any);
    const leadSend = await contactGroupService.getContactsForGroups(biz, [leadSeg.id, source.id]);
    expect(leadSend.filter(c => c.groupId === leadSeg.id).length === 5, 'lead segment picks up a new lead at send time', leadSend.filter(c => c.groupId === leadSeg.id).length);
    const upd = await contactGroupService.updateRules(biz, dyn.id, { source: 'contacts', contacts: { groupIds: [source.id], conditions: [{ field: 'attr:plan', op: 'equals', value: 'gold' }] } });
    expect(upd.total === 2, 'changing the rules re-evaluates immediately (plan = gold)', upd);
  }

  // ── 5. Workbook automatic sync is idempotent ──────────────────────────────
  {
    const [camp] = await db.insert(schema.marketingCampaigns).values({
      businessAccountId: biz, name: 'Follow-up', templateId: tplId, groupIds: [], status: 'completed',
      replyClassifications: [{ key: 'INTERESTED', label: 'Interested', description: 'wants it' }],
    } as any).returning();
    const R = schema.marketingCampaignRecipients;
    const [r1] = await db.insert(R).values({ campaignId: camp.id, businessAccountId: biz, phone: '919111000001', name: 'A', status: 'delivered', createdAt: old } as any).returning();
    await db.insert(R).values({ campaignId: camp.id, businessAccountId: biz, phone: '919111000002', name: 'B', status: 'delivered', createdAt: old } as any);
    const wb = await whatsappAiWorkbookService.create(biz, { name: 'Linked', sourceCampaignId: camp.id });
    // created_at/updated_at default to the DB clock; age them so the "being edited" guard doesn't apply.
    await db.update(schema.whatsappAiWorkbooks).set({ updatedAt: old } as any).where(eq(schema.whatsappAiWorkbooks.id, wb.id));
    const versionCount = async () => (await db.select().from(schema.whatsappAiWorkbookVersions).where(eq(schema.whatsappAiWorkbookVersions.workbookId, wb.id))).length;

    const first = await whatsappAiWorkbookService.runAutoSyncOnce({ quietMs: 0 });
    expect(await versionCount() === 1, 'first pass with nothing new creates no empty version', { first, n: await versionCount() });
    const [wbRow] = await db.select().from(schema.whatsappAiWorkbooks).where(eq(schema.whatsappAiWorkbooks.id, wb.id));
    expect(!!wbRow.lastSyncedAt, 'lastSyncedAt is recorded', wbRow.lastSyncedAt);

    await db.update(R).set({ primaryClassification: 'INTERESTED', classifiedAt: new Date(), replyCount: 1, firstReplyAt: new Date() } as any).where(eq(R.id, r1.id));
    const second = await whatsappAiWorkbookService.runAutoSyncOnce({ quietMs: 0 });
    const [latest] = await db.select().from(schema.whatsappAiWorkbookVersions).where(eq(schema.whatsappAiWorkbookVersions.workbookId, wb.id)).orderBy(desc(schema.whatsappAiWorkbookVersions.versionNumber)).limit(1);
    const rowA = (latest.sheets as any[])[0].rows.find((r: any) => r.values.phone === '919111000001');
    expect(await versionCount() === 2 && second.workbooksUpdated === 1, 'new reply outcome → one new version automatically', { second, n: await versionCount() });
    expect(rowA?.values.classification_label === 'Interested' && latest.source === 'campaign_sync', 'the outcome landed in the workbook', rowA?.values);
    const third = await whatsappAiWorkbookService.runAutoSyncOnce({ quietMs: 0 });
    expect(await versionCount() === 2 && third.workbooksChecked === 0, 'no new activity → nothing checked, no new version (idempotent)', third);

    await db.update(schema.whatsappAiWorkbooks).set({ editingHeartbeatAt: new Date() } as any).where(eq(schema.whatsappAiWorkbooks.id, wb.id));
    await db.update(R).set({ customerFeedback: 'Call me', classifiedAt: new Date(Date.now() + 1000) } as any).where(eq(R.id, r1.id));
    const busy = await whatsappAiWorkbookService.runAutoSyncOnce({ quietMs: 60_000 });
    expect(busy.skippedBusy >= 1 && await versionCount() === 2, 'a workbook being edited is never synced underneath the editor', busy);

    // Result link: audience from a workbook → campaign → results flow back.
    const indie = await whatsappAiWorkbookService.create(biz, { name: 'Sheet' });
    const v1 = indie.currentVersion;
    const sheetId = (v1.sheets as any[])[0].id;
    const sheet = { id: sheetId, name: 'Sheet 1', kind: 'custom', columns: [
      { key: 'name', label: 'Name', type: 'text', source: 'operator', editable: true },
      { key: 'phone', label: 'Phone', type: 'text', source: 'operator', editable: true },
      { key: 'result', label: 'Result', type: 'text', source: 'operator', editable: true },
    ], rows: [
      { id: 'row-1', values: { name: 'C', phone: '919222000001', result: '' } },
      { id: 'row-2', values: { name: 'D', phone: '919222000002', result: '' } },
    ] };
    await whatsappAiWorkbookService.saveSheets(biz, indie.id, v1.id, v1.revision, [sheet]);
    const aud = await whatsappAiWorkbookService.createAudience(biz, indie.id, { sheetId, resultMappings: [{ destinationColumnKey: 'result', source: 'outcome_label', format: 'text', overwrite: 'if_empty' }] });
    const [camp2] = await db.insert(schema.marketingCampaigns).values({
      businessAccountId: biz, name: 'From sheet', templateId: tplId, groupIds: [aud.group.id], status: 'completed',
      replyClassifications: [{ key: 'YES', label: 'Said yes', description: '' }],
    } as any).returning();
    await whatsappAiWorkbookService.attachCampaignToAudienceGroups(biz, camp2.id, [aud.group.id]);
    await db.insert(R).values({ campaignId: camp2.id, businessAccountId: biz, phone: '919222000001', name: 'C', status: 'replied', primaryClassification: 'YES', classifiedAt: new Date(), createdAt: old } as any);
    await db.update(schema.whatsappAiWorkbooks).set({ updatedAt: old, editingHeartbeatAt: null } as any).where(eq(schema.whatsappAiWorkbooks.id, indie.id));
    const linkPass = await whatsappAiWorkbookService.runAutoSyncOnce({ quietMs: 0 });
    const latestIndie = await whatsappAiWorkbookService.get(biz, indie.id);
    const resultCell = (latestIndie!.currentVersion!.sheets as any[])[0].rows.find((r: any) => r.id === 'row-1')?.values.result;
    expect(linkPass.linksUpdated === 1 && resultCell === 'Said yes', 'campaign result synced back into the source workbook automatically', { linkPass, resultCell });
    const linkAgain = await whatsappAiWorkbookService.runAutoSyncOnce({ quietMs: 0 });
    expect(linkAgain.linksChecked === 0 && linkAgain.linksUpdated === 0, 'result link: second pass does nothing', linkAgain);
    const manual = await whatsappAiWorkbookService.syncNow(biz, indie.id);
    expect(manual.versionsCreated === 0 && manual.linkedSources === 1, '"Sync now" with nothing new creates no version', manual);
    expect(sheetsFingerprint([sheet]) === sheetsFingerprint(JSON.parse(JSON.stringify([sheet]))), 'fingerprint is stable');
  }

  // ── 6. HTTP: opt-outs, contacts page, template draft ──────────────────────
  {
    const express = (await import('express')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const { createSession } = await import('../../auth');
    const { registerCampaignAudienceRoutes } = await import('../../routes/campaignAudiences');
    const [user] = await db.insert(schema.users).values({ username: `aud_${stamp}`, passwordHash: 'x', role: 'business_user', businessAccountId: biz } as any).returning();
    const gate = async (req: any, res: any, next: any) => {
      const [ba] = await db.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.id, req.user.businessAccountId));
      if (ba?.whatsappMarketingEnabled !== 'true') return res.status(403).json({ error: 'off' });
      next();
    };
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    registerCampaignAudienceRoutes(app, gate);
    const server = await new Promise<any>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await createSession(user.id);
    const call = async (method: string, path: string, body?: unknown, auth = true) => {
      const res = await realFetch(`${base}${path}`, {
        method,
        headers: { ...(auth ? { cookie: `session=${session}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* csv */ }
      return { status: res.status, json, text, type: res.headers.get('content-type') || '' };
    };

    expect((await call('GET', '/api/whatsapp/opt-outs/search', undefined, false)).status === 401, 'opt-outs: signed out → 401');
    const add = await call('POST', '/api/whatsapp/opt-outs', { phone: '+91 99887 76655' });
    expect(add.status === 201 && add.json?.added === true, 'opt-outs: add a number by hand', add);
    const dup = await call('POST', '/api/whatsapp/opt-outs', { phone: '9988776655' });
    expect(dup.status === 200 && dup.json?.added === false, 'opt-outs: adding the same number again is a no-op', dup);
    const bad = await call('POST', '/api/whatsapp/opt-outs', { phone: '12' });
    expect(bad.status === 400, 'opt-outs: invalid number → 400', bad.status);
    const search = await call('GET', '/api/whatsapp/opt-outs/search?search=99887');
    expect(search.status === 200 && search.json?.total === 1 && search.json.optOuts[0].reasonLabel === 'Added by your team', 'opt-outs: search by digits with a readable reason', search.json);
    const allOpt = await call('GET', '/api/whatsapp/opt-outs/search?pageSize=10');
    expect(allOpt.json?.total === 3, 'opt-outs: total across the account', allOpt.json?.total);
    const csv = await call('GET', '/api/whatsapp/opt-outs/export.csv');
    expect(csv.status === 200 && csv.type.includes('text/csv') && csv.text.includes('"919988776655"') && csv.text.split('\r\n').filter(Boolean).length === 4, 'opt-outs: CSV export with header + 3 rows', csv.text.slice(0, 200));

    const page = await call('GET', `/api/whatsapp/audiences/${listGroup.id}/contacts?page=2&pageSize=25&search=person`);
    expect(page.status === 200 && page.json?.page === 2 && page.json?.contacts?.length === 25 && page.json?.total === 107, 'contacts endpoint: page 2, 25 per page, searched total', { p: page.json?.page, n: page.json?.contacts?.length, t: page.json?.total });
    const [otherBiz] = await db.insert(schema.businessAccounts).values({ name: `Other ${stamp}`, website: 'https://o.example', whatsappEnabled: 'true', whatsappMarketingEnabled: 'true' } as any).returning();
    const foreign = await contactGroupService.create(otherBiz.id, 'Not yours');
    expect((await call('GET', `/api/whatsapp/audiences/${foreign.id}/contacts`)).status === 404, 'contacts endpoint: another business\'s audience → 404');
    const bulk = await call('POST', '/api/whatsapp/audiences/bulk-delete', { ids: [foreign.id] });
    expect(bulk.json?.removed === 0 && !!(await contactGroupService.get(otherBiz.id, foreign.id)), 'bulk delete never touches another business\'s audience', bulk.json);

    // Template draft with a fake model.
    let seenPrompt = '';
    templateDraftDeps.getApiKey = async () => 'sk-test';
    templateDraftDeps.createClient = () => ({
      chat: { completions: { create: async (args: any) => {
        seenPrompt = JSON.stringify(args.messages);
        return { choices: [{ message: { content: JSON.stringify({
          name: 'Diwali Offer!', category: 'MARKETING', language: 'en',
          bodyText: '{{name}}, our Diwali sale is live: {{discount}} off everything until {{date}}',
          footerText: '', variables: [{ meaning: 'customer name', example: 'Priya' }, { meaning: 'discount', example: '20%' }, { meaning: 'end date', example: 'Sunday' }],
        }) } }] };
      } } },
    });
    const draft = await call('POST', '/api/whatsapp/templates/draft', { goal: 'Diwali sale announcement with discount', category: 'MARKETING' });
    expect(draft.status === 200, 'draft endpoint answers', draft);
    const d = draft.json || {};
    expect(d.bodyText === 'Hi {{1}}, our Diwali sale is live: {{2}} off everything until {{3}} Thank you.', 'draft: variables renumbered {{1}}..{{3}}, never starts/ends with a variable', d.bodyText);
    expect(d.name === 'diwali_offer' && d.category === 'MARKETING' && /stop/i.test(d.footerText) && d.variables.length === 3, 'draft: snake_case name, marketing opt-out footer, 3 variable hints', d);
    expect(seenPrompt.includes('Diwali sale announcement'), 'draft: the goal was sent to the (fake) model');
    const tooShort = await call('POST', '/api/whatsapp/templates/draft', { goal: 'hi' });
    expect(tooShort.status === 400, 'draft: a too-short goal is refused', tooShort.status);
    templateDraftDeps.getApiKey = async () => null;
    const noKey = await call('POST', '/api/whatsapp/templates/draft', { goal: 'Order shipped update' });
    expect(noKey.status === 400 && /OpenAI key/i.test(noKey.json?.error || ''), 'draft: clear message when the account has no AI key', noKey.json);
    const long = sanitizeTemplateDraft({ bodyText: 'a '.repeat(800) }, { goal: 'x' });
    expect(long.bodyText.length <= 1024 && long.warnings.length === 1, 'draft: body capped at 1024 characters', long.bodyText.length);

    // Gate applies.
    await db.update(schema.businessAccounts).set({ whatsappMarketingEnabled: 'false' } as any).where(eq(schema.businessAccounts.id, biz));
    expect((await call('GET', '/api/whatsapp/opt-outs/search')).status === 403, 'endpoints respect the WhatsApp Marketing gate');
    server.close();
  }

  globalThis.fetch = realFetch;
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll campaign audience checks passed');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
