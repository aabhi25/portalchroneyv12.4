/**
 * Integration test (real SQL, fake CRMs) for Instagram/Facebook lead → CRM sync and the
 * unified Leads view.
 *
 * CRM sync: creating an IG lead pushes it exactly once to each auto-syncing CRM (LeadSquared
 * via a UDS webhook, Custom CRM via a relay — both local fakes); duplicate/concurrent triggers
 * don't double-push; transient failures are retried by the existing workers; permanent
 * failures stop; leads without a phone/email wait until they get one; nothing sensitive logged.
 *
 * Unified view: merged paging and totals across Website/WhatsApp/Instagram/Facebook, channel,
 * search and date filters, tenant isolation, phone masking, WhatsApp drafts / message_only
 * excluded, disabled channels excluded.
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at localhost AND
 * CRM_SYNC_TEST_DB=1 is set. No real endpoint is ever called.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55482/postgres?sslmode=disable \
 *   CRM_SYNC_TEST_DB=1 npx tsx server/services/__tests__/socialLeadsCrmAndUnified.integration.test.ts
 */
import http from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

const url = process.env.DATABASE_URL || '';
if (process.env.CRM_SYNC_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set CRM_SYNC_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
delete process.env.OPENAI_API_KEY;
delete process.env.CUSTOM_CRM_RELAY_SECRET;

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(fn: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await wait(50); }
  return false;
}

// ── Fake CRMs ────────────────────────────────────────────────────────────────
type Behaviour = { status?: number; body?: any; delayMs?: number };
const fake = {
  custom: [] as Record<string, string>[],
  uds: [] as Record<string, string>[],
  customBehaviour: {} as Record<string, Behaviour>, // by full_name
  udsBehaviour: {} as Record<string, Behaviour>,    // by FirstName
  n: 1,
};
function reply(res: http.ServerResponse, b: Behaviour, fallback: any) {
  const send = () => {
    if (res.writableEnded) return;
    res.writeHead(b.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(b.body ?? fallback));
  };
  if (b.delayMs) setTimeout(send, b.delayMs); else send();
}
const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (req.url === '/relay') {
      const fields = body.fields || JSON.parse(body.body || '{}');
      fake.custom.push(fields);
      const b = fake.customBehaviour[fields.full_name] || {};
      return reply(res, b, (b.status ?? 200) < 300 ? { success: 1, data: { id: `CRM-${fake.n++}` } } : { success: 0, message: 'rejected' });
    }
    if (req.url === '/uds') {
      fake.uds.push(body);
      const b = fake.udsBehaviour[body.FirstName] || {};
      return reply(res, b, (b.status ?? 200) < 300 ? { Status: 'Success' } : { Message: 'failure' });
    }
    res.writeHead(404); res.end('{}');
  });
});

async function main() {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname === 'uds.lsq-test.example') return realFetch(`http://127.0.0.1:${port}/uds`, init);
    if (u.hostname !== '127.0.0.1') throw new Error(`test attempted a real network call to ${u.hostname}`);
    return realFetch(input, init);
  }) as typeof fetch;

  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq, sql } = await import('drizzle-orm');
  const { encrypt } = await import('../encryptionService');
  const social = await import('../socialLeadCrmSync');
  const { instagramService } = await import('../instagramService');
  const { facebookService } = await import('../facebookService');
  const { crmSyncRecoveryWorker } = await import('../crmSyncRecoveryWorker');
  const { leadsquaredRetryWorker } = await import('../leadsquaredRetryWorker');
  const { queryUnifiedLeads } = await import('../unifiedLeadsService');
  const { forgetQualificationSetting } = await import('../leadQualificationService');

  const logs: string[] = [];
  const origLog = console.log, origErr = console.error, origWarn = console.warn;
  const capture = (orig: (...a: any[]) => void) => (...a: any[]) => { logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); orig(...a); };
  console.log = capture(origLog); console.error = capture(origErr); console.warn = capture(origWarn);

  // ═══════════════════════════ CRM sync ═══════════════════════════
  const [crmAcct] = await db.insert(schema.businessAccounts).values({ name: 'Social CRM Co', website: 'https://example.com', instagramEnabled: 'true', facebookEnabled: 'true' }).returning();
  await db.insert(schema.widgetSettings).values({
    businessAccountId: crmAcct.id, leadsquaredEnabled: 'true', leadsquaredConnectionType: 'uds',
    leadsquaredUdsWebhookUrl: 'https://uds.lsq-test.example/hook', leadsquaredUdsKey: encrypt('uds-key'),
  } as any);
  for (const [i, [f, src]] of ([['FirstName', 'lead.name'], ['Phone', 'lead.phone'], ['EmailAddress', 'lead.email'], ['mx_Channel', 'lead.channel'], ['mx_Utm_Source', 'session.utmSource']] as const).entries()) {
    await db.insert(schema.leadsquaredFieldMappings).values({ businessAccountId: crmAcct.id, leadsquaredField: f, sourceType: 'dynamic', sourceField: src, displayName: f, sortOrder: i });
  }
  await db.insert(schema.customCrmSettings).values({
    businessAccountId: crmAcct.id, enabled: true, autoSyncEnabled: true, name: 'Test CRM',
    apiBaseUrl: 'https://crm.crm-test.example', apiEndpoint: '/api/create', authType: 'none', contentType: 'json',
    relayUrl: `http://127.0.0.1:${port}`,
  });
  for (const [i, [crmField, sourceField]] of ([['full_name', 'lead.customerName'], ['mobile', 'lead.customerPhone'], ['email', 'lead.customerEmail'], ['channel', 'lead.channel'], ['loan_amount', 'extracted.budget']] as const).entries()) {
    await db.insert(schema.customCrmFieldMappings).values({ businessAccountId: crmAcct.id, crmField, sourceType: 'dynamic', sourceField, displayName: crmField, sortOrder: i });
  }

  const readLead = async (channel: 'instagram' | 'facebook', id: string) => {
    const t = channel === 'instagram' ? schema.instagramLeads : schema.facebookLeads;
    const [l] = await db.select().from(t).where(eq(t.id, id));
    return { ...l, meta: ((l.customCrmSyncPayload as any)?._crmSync || {}) as any };
  };
  const customFor = (name: string) => fake.custom.filter(c => c.full_name === name).length;
  const udsFor = (name: string) => fake.uds.filter(c => c.FirstName === name).length;
  const settled = (channel: 'instagram' | 'facebook', id: string) => async () => {
    const l = await readLead(channel, id);
    return !!l.customCrmSyncStatus && l.customCrmSyncStatus !== 'pending' && !!l.leadsquaredSyncStatus && l.leadsquaredSyncStatus !== 'pending';
  };

  // 1. Creating an IG lead pushes it once to each CRM, tagged with the channel.
  {
    const lead = await instagramService.createInstagramLead(crmAcct.id, {
      senderId: 'ig-1', senderUsername: 'priya.ig', extractedData: { customer_name: 'Priya IG', phone_number: '9876543210', email_address: 'priya@example.com', budget: '5 lakh' },
    });
    expect(await until(settled('instagram', lead.id)), 'IG lead auto-sync settles');
    const l = await readLead('instagram', lead.id);
    expect(l.customCrmSyncStatus === 'synced' && !!l.customCrmLeadId, "custom CRM → 'synced' with CRM id", { s: l.customCrmSyncStatus, id: l.customCrmLeadId });
    expect(l.leadsquaredSyncStatus === 'synced', "LeadSquared → 'synced'", l.leadsquaredSyncStatus);
    expect(customFor('Priya IG') === 1 && udsFor('Priya IG') === 1, 'exactly one push per CRM', { custom: customFor('Priya IG'), uds: udsFor('Priya IG') });
    const c = fake.custom.find(x => x.full_name === 'Priya IG')!;
    expect(c.channel === 'Instagram' && c.mobile === '9876543210' && c.email === 'priya@example.com' && c.loan_amount === '500000', 'custom CRM payload: contact, channel=Instagram, extracted field', c);
    const u = fake.uds.find(x => x.FirstName === 'Priya IG')!;
    expect(u.mx_Channel === 'Instagram' && u.mx_Utm_Source === 'instagram' && u.Phone === '9876543210', 'LeadSquared payload: channel + utm source', u);

    // Duplicate triggers (webhook redelivery, update hook) and a worker pass: still one push each.
    social.triggerSocialLeadCrmSync('instagram', lead.id);
    await Promise.all([social.autoSyncSocialLead('instagram', lead.id), social.autoSyncSocialLead('instagram', lead.id)]);
    await crmSyncRecoveryWorker.processRecoveries();
    await leadsquaredRetryWorker.processRetries();
    await wait(300);
    expect(customFor('Priya IG') === 1 && udsFor('Priya IG') === 1, 'duplicate triggers + worker runs do not re-push a synced lead', { custom: customFor('Priya IG'), uds: udsFor('Priya IG') });
    const manual = await social.syncSocialLead('instagram', lead.id, 'custom_crm', { mode: 'manual' });
    expect(manual.skipped === 'already_synced' && customFor('Priya IG') === 1, 'manual Sync of a synced lead is a no-op', manual);
  }

  // 2. Concurrent syncs of an unsynced lead push once (atomic claim).
  {
    const [raw] = await db.insert(schema.facebookLeads).values({ businessAccountId: crmAcct.id, senderId: 'fb-race', senderName: 'Race FB', extractedData: { customer_name: 'Race FB', phone_number: '9000000001' } }).returning();
    fake.customBehaviour['Race FB'] = { delayMs: 300 };
    fake.udsBehaviour['Race FB'] = { delayMs: 300 };
    await Promise.all([
      social.autoSyncSocialLead('facebook', raw.id), social.autoSyncSocialLead('facebook', raw.id),
      social.syncSocialLead('facebook', raw.id, 'custom_crm', { mode: 'manual' }),
      social.syncSocialLead('facebook', raw.id, 'leadsquared', { mode: 'manual' }),
    ]);
    const l = await readLead('facebook', raw.id);
    expect(customFor('Race FB') === 1 && udsFor('Race FB') === 1, '4 concurrent syncs → one push per CRM', { custom: customFor('Race FB'), uds: udsFor('Race FB') });
    expect(l.customCrmSyncStatus === 'synced' && l.leadsquaredSyncStatus === 'synced', 'both synced', { c: l.customCrmSyncStatus, l: l.leadsquaredSyncStatus });
    const payloadChannel = fake.custom.find(x => x.full_name === 'Race FB')?.channel;
    expect(payloadChannel === 'Facebook', 'Facebook lead tagged channel=Facebook', payloadChannel);
  }

  // 3. Transient failure → scheduled retry → the existing workers retry it.
  {
    fake.customBehaviour['Flaky FB'] = { status: 503 };
    fake.udsBehaviour['Flaky FB'] = { status: 503 };
    const lead = await facebookService.createFacebookLead(crmAcct.id, { senderId: 'fb-flaky', senderName: 'Flaky', extractedData: { customer_name: 'Flaky FB', email_address: 'flaky@example.com' } });
    expect(await until(settled('facebook', lead.id)), 'flaky FB lead auto-sync settles');
    let l = await readLead('facebook', lead.id);
    expect(l.customCrmSyncStatus === 'failed' && l.meta.retryable === true && !!l.meta.nextRetryAt, 'custom CRM 503 → failed, retry scheduled', { s: l.customCrmSyncStatus, m: l.meta });
    expect(l.leadsquaredSyncStatus === 'failed' && !!l.leadsquaredNextRetryAt, 'LeadSquared 503 → failed, retry scheduled', { s: l.leadsquaredSyncStatus, n: l.leadsquaredNextRetryAt });

    delete fake.customBehaviour['Flaky FB'];
    delete fake.udsBehaviour['Flaky FB'];
    await crmSyncRecoveryWorker.processRecoveries();
    await leadsquaredRetryWorker.processRetries();
    l = await readLead('facebook', lead.id);
    expect(l.customCrmSyncStatus === 'failed' && l.leadsquaredSyncStatus === 'failed', 'workers wait for the retry time', { c: l.customCrmSyncStatus, l: l.leadsquaredSyncStatus });
    expect(customFor('Flaky FB') === 1 && udsFor('Flaky FB') === 1, 'no early retry pushes');

    const past = new Date(Date.now() - 1000).toISOString();
    await db.execute(sql`UPDATE facebook_leads SET custom_crm_sync_payload = jsonb_set(custom_crm_sync_payload, '{_crmSync,nextRetryAt}', to_jsonb(${past}::text)), leadsquared_next_retry_at = ${past}::timestamp WHERE id = ${lead.id}`);
    await crmSyncRecoveryWorker.processRecoveries();
    await leadsquaredRetryWorker.processRetries();
    l = await readLead('facebook', lead.id);
    expect(l.customCrmSyncStatus === 'synced' && l.leadsquaredSyncStatus === 'synced', 'retry by the workers → synced', { c: l.customCrmSyncStatus, l: l.leadsquaredSyncStatus });
    expect(customFor('Flaky FB') === 2 && udsFor('Flaky FB') === 2, 'exactly one retry push per CRM', { custom: customFor('Flaky FB'), uds: udsFor('Flaky FB') });
  }

  // 4. Permanent failure → stops; the workers never push it again.
  {
    fake.customBehaviour['Bad IG'] = { status: 400 };
    fake.udsBehaviour['Bad IG'] = { status: 401 };
    const lead = await instagramService.createInstagramLead(crmAcct.id, { senderId: 'ig-bad', extractedData: { customer_name: 'Bad IG', phone_number: '9000000002' } });
    expect(await until(settled('instagram', lead.id)), 'bad IG lead auto-sync settles');
    let l = await readLead('instagram', lead.id);
    expect(l.customCrmSyncStatus === 'failed' && l.meta.retryable === false && !l.meta.nextRetryAt, 'custom CRM 400 → failed, not retryable', l.meta);
    expect(l.leadsquaredSyncStatus === 'needs_attention' && !l.leadsquaredNextRetryAt, 'LeadSquared 401 → needs_attention, no retry', { s: l.leadsquaredSyncStatus });
    const past = new Date(Date.now() - 60 * 60_000).toISOString();
    await db.execute(sql`UPDATE instagram_leads SET updated_at = ${past}::timestamp WHERE id = ${lead.id}`);
    await crmSyncRecoveryWorker.processRecoveries();
    await leadsquaredRetryWorker.processRetries();
    l = await readLead('instagram', lead.id);
    expect(customFor('Bad IG') === 1 && udsFor('Bad IG') === 1 && l.customCrmSyncStatus === 'failed' && l.leadsquaredSyncStatus === 'needs_attention', 'permanent failures are not retried by the workers', { custom: customFor('Bad IG'), uds: udsFor('Bad IG') });
    // A manual Sync after fixing the problem does push again.
    delete fake.customBehaviour['Bad IG'];
    delete fake.udsBehaviour['Bad IG'];
    const r1 = await social.syncSocialLead('instagram', lead.id, 'custom_crm', { mode: 'manual', businessAccountId: crmAcct.id });
    const r2 = await social.syncSocialLead('instagram', lead.id, 'leadsquared', { mode: 'manual', businessAccountId: crmAcct.id });
    expect(r1.status === 'synced' && r2.status === 'synced', 'manual Sync after the fix → synced', { r1, r2 });
  }

  // 5. LeadSquared retries give up after the schedule is exhausted.
  {
    fake.udsBehaviour['Down IG'] = { status: 500 };
    const [raw] = await db.insert(schema.instagramLeads).values({ businessAccountId: crmAcct.id, senderId: 'ig-down', extractedData: { customer_name: 'Down IG', phone_number: '9000000003' }, leadsquaredSyncStatus: 'failed', leadsquaredRetryCount: 7, leadsquaredNextRetryAt: new Date(Date.now() - 1000), customCrmSyncStatus: 'synced' }).returning();
    await leadsquaredRetryWorker.processRetries();
    const l = await readLead('instagram', raw.id);
    expect(l.leadsquaredSyncStatus === 'permanently_failed' && l.leadsquaredRetryCount === 8, 'last LeadSquared retry fails → permanently_failed', { s: l.leadsquaredSyncStatus, c: l.leadsquaredRetryCount });
    await db.execute(sql`UPDATE instagram_leads SET leadsquared_next_retry_at = ${new Date(Date.now() - 1000).toISOString()}::timestamp WHERE id = ${raw.id}`);
    await leadsquaredRetryWorker.processRetries();
    expect(udsFor('Down IG') === 1, 'permanently_failed is not picked up again', udsFor('Down IG'));
  }

  // 6. No phone/email yet → not pushed; once the DM supplies a phone the worker pushes it.
  {
    const lead = await instagramService.createInstagramLead(crmAcct.id, { senderId: 'ig-later', extractedData: { customer_name: 'Later IG' } });
    await wait(400);
    let l = await readLead('instagram', lead.id);
    expect(!l.customCrmSyncStatus && !l.leadsquaredSyncStatus && customFor('Later IG') === 0, 'lead with only a name is not pushed', { c: l.customCrmSyncStatus, l: l.leadsquaredSyncStatus });
    await db.update(schema.instagramLeads).set({ extractedData: { customer_name: 'Later IG', phone_number: '9000000004' } }).where(eq(schema.instagramLeads.id, lead.id));
    await crmSyncRecoveryWorker.processRecoveries();
    await leadsquaredRetryWorker.processRetries();
    l = await readLead('instagram', lead.id);
    expect(l.customCrmSyncStatus === 'synced' && l.leadsquaredSyncStatus === 'synced' && customFor('Later IG') === 1 && udsFor('Later IG') === 1, 'worker pushes it once it has a phone', { c: l.customCrmSyncStatus, l: l.leadsquaredSyncStatus });
  }

  // 7. Auto-sync off for the custom CRM → no automatic push (manual still works).
  {
    await db.update(schema.customCrmSettings).set({ autoSyncEnabled: false }).where(eq(schema.customCrmSettings.businessAccountId, crmAcct.id));
    const lead = await instagramService.createInstagramLead(crmAcct.id, { senderId: 'ig-off', extractedData: { customer_name: 'NoAuto IG', phone_number: '9000000005' } });
    await until(async () => (await readLead('instagram', lead.id)).leadsquaredSyncStatus === 'synced');
    await crmSyncRecoveryWorker.processRecoveries();
    expect(customFor('NoAuto IG') === 0, 'custom CRM auto-sync off → not pushed automatically', customFor('NoAuto IG'));
    const r = await social.syncSocialLead('instagram', lead.id, 'custom_crm', { mode: 'manual' });
    expect(r.status === 'synced' && customFor('NoAuto IG') === 1, 'manual Sync pushes it', r);
    await db.update(schema.customCrmSettings).set({ autoSyncEnabled: true }).where(eq(schema.customCrmSettings.businessAccountId, crmAcct.id));
  }

  // 8. Bulk "Sync all".
  {
    await db.insert(schema.facebookLeads).values([
      { businessAccountId: crmAcct.id, senderId: 'fb-b1', extractedData: { customer_name: 'Bulk One', phone_number: '9000000011' } },
      { businessAccountId: crmAcct.id, senderId: 'fb-b2', extractedData: { customer_name: 'Bulk Two', email: 'b2@example.com' } },
      { businessAccountId: crmAcct.id, senderId: 'fb-b3', extractedData: { customer_name: 'Bulk NoContact' } },
    ]);
    const summary = await social.syncAllSocialLeads('facebook', crmAcct.id, ['custom_crm']);
    expect(customFor('Bulk One') === 1 && customFor('Bulk Two') === 1 && customFor('Bulk NoContact') === 0, 'sync-all pushes unsynced leads with contact info once', summary);
    const again = await social.syncAllSocialLeads('facebook', crmAcct.id, ['custom_crm']);
    expect(customFor('Bulk One') === 1 && again.custom_crm.synced === 0, 'second sync-all pushes nothing new', again);
  }

  const leaked = logs.filter(line => !/^[✓✗]/.test(line) && /9876543210|priya@example\.com|Priya IG|flaky@example\.com|500000/.test(line));
  expect(leaked.length === 0, 'no names, phones, emails or payload values in logs', leaked.slice(0, 3));

  // ═══════════════════════════ Unified view ═══════════════════════════
  const T = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000);
  const [A] = await db.insert(schema.businessAccounts).values({ name: 'Unified A', website: 'https://a.example', whatsappEnabled: 'true', instagramEnabled: 'true', facebookEnabled: 'true' }).returning();
  const [B] = await db.insert(schema.businessAccounts).values({ name: 'Unified B', website: 'https://b.example', whatsappEnabled: 'true', instagramEnabled: 'true', facebookEnabled: 'true' }).returning();
  await db.insert(schema.whatsappSettings).values({ businessAccountId: A.id, requirePanEmailForLead: 'true' } as any);
  forgetQualificationSetting(A.id);

  // Account A: 3 website, 2 WhatsApp leads (+1 draft, +1 message_only), 2 IG, 2 FB, all at distinct times.
  const expectedOrder: string[] = [];
  const web = await db.insert(schema.leads).values([
    { businessAccountId: A.id, name: 'Ravi Web', phone: '9111111111', email: 'ravi@web.example', createdAt: T(10) },
    { businessAccountId: A.id, name: 'Sita Web', phone: '9111111112', createdAt: T(40), leadsquaredSyncStatus: 'failed', leadsquaredSyncError: 'timeout', leadsquaredSyncPayload: { Phone: '9111111112' } },
    { businessAccountId: A.id, name: 'Old Web', phone: '9111111113', createdAt: T(60 * 24 * 10) },
  ]).returning();
  const wa = await db.insert(schema.whatsappLeads).values([
    { businessAccountId: A.id, senderPhone: '919222222221', customerName: 'Ravi WA', customerPhone: '9222222221', customerEmail: 'ravi@wa.example', status: 'completed', receivedAt: T(20), qualifiedAt: T(20), extractedData: { pan: 'ABCDE1234F', alt_mobile: '9222222229' }, customCrmSyncStatus: 'synced' },
    { businessAccountId: A.id, senderPhone: '919222222222', customerName: 'Meena WA', status: 'completed', receivedAt: T(50), qualifiedAt: T(50) },
    { businessAccountId: A.id, senderPhone: '919222222223', customerName: 'Draft WA', status: 'new', receivedAt: T(15) }, // draft
    { businessAccountId: A.id, senderPhone: '919222222224', customerName: 'MsgOnly WA', status: 'message_only', receivedAt: T(16), qualifiedAt: T(16) },
  ]).returning();
  const ig = await db.insert(schema.instagramLeads).values([
    { businessAccountId: A.id, senderId: 'a-ig-1', senderUsername: 'ravi.ig', extractedData: { customer_name: 'Ravi IG', phone_number: '9333333331' }, receivedAt: T(30), customCrmSyncStatus: 'failed', customCrmSyncError: 'CRM_SYNC_ERROR[http_error]: HTTP 503' },
    { businessAccountId: A.id, senderId: 'a-ig-2', senderUsername: 'neha.ig', extractedData: { name: 'Neha IG', email: 'neha@ig.example' }, receivedAt: T(70) },
  ]).returning();
  const fb = await db.insert(schema.facebookLeads).values([
    { businessAccountId: A.id, senderId: 'a-fb-1', senderName: 'Arun FB', extractedData: { phone: '9444444441' }, receivedAt: T(5) },
    { businessAccountId: A.id, senderId: 'a-fb-2', senderName: 'Kiran FB', extractedData: { customer_name: 'Kiran FB', mobile: '+91 94444 44442' }, receivedAt: T(80) },
  ]).returning();
  // B: one of each, same names so a leak would show up in searches too.
  await db.insert(schema.leads).values({ businessAccountId: B.id, name: 'Ravi Web B', phone: '9555555551', createdAt: T(1) });
  await db.insert(schema.whatsappLeads).values({ businessAccountId: B.id, senderPhone: '919555555552', customerName: 'Ravi WA B', status: 'completed', receivedAt: T(2) });
  await db.insert(schema.instagramLeads).values({ businessAccountId: B.id, senderId: 'b-ig', extractedData: { customer_name: 'Ravi IG B' }, receivedAt: T(3) });
  await db.insert(schema.facebookLeads).values({ businessAccountId: B.id, senderId: 'b-fb', extractedData: { customer_name: 'Ravi FB B' }, receivedAt: T(4) });

  // Newest first: fb1(5) web0(10) wa0(20) ig0(30) web1(40) wa1(50) ig1(70) fb1(80) web2(10 days)
  expectedOrder.push(`facebook:${fb[0].id}`, `website:${web[0].id}`, `whatsapp:${wa[0].id}`, `instagram:${ig[0].id}`, `website:${web[1].id}`, `whatsapp:${wa[1].id}`, `instagram:${ig[1].id}`, `facebook:${fb[1].id}`, `website:${web[2].id}`);
  const bIds = new Set<string>();

  {
    const all = await queryUnifiedLeads(A.id, {}, { limit: 100, offset: 0 });
    expect(all.total === 9, 'total = 3 website + 2 WhatsApp + 2 IG + 2 FB (draft and message_only excluded)', { total: all.total, counts: all.countsByChannel });
    expect(JSON.stringify(all.countsByChannel) === JSON.stringify({ website: 3, whatsapp: 2, instagram: 2, facebook: 2 }), 'per-channel counts', all.countsByChannel);
    expect(JSON.stringify(all.leads.map(l => l.key)) === JSON.stringify(expectedOrder), 'merged newest-first across channels', all.leads.map(l => l.key));
    expect(!all.leads.some(l => /Draft WA|MsgOnly WA/.test(l.name || '')), 'WhatsApp draft and message_only not listed');
    expect(!all.leads.some(l => / B$/.test(l.name || '')), 'account B rows never appear for A');
    expect(JSON.stringify(all.channels) === JSON.stringify(['website', 'whatsapp', 'instagram', 'facebook']), 'all four channels enabled', all.channels);

    // Pages of 4 stitch together to the same order, and each page reports the full total.
    const pages = [] as string[];
    for (let p = 0; p < 3; p++) {
      const r = await queryUnifiedLeads(A.id, {}, { limit: 4, offset: p * 4 });
      expect(r.total === 9, `page ${p + 1}: total is 9`, r.total);
      pages.push(...r.leads.map(l => l.key));
    }
    expect(JSON.stringify(pages) === JSON.stringify(expectedOrder), 'pages 1-3 (limit 4) = full list, no gaps or repeats', pages);

    const ravi = all.leads.find(l => l.key === `instagram:${ig[0].id}`)!;
    expect(ravi.name === 'Ravi IG' && ravi.phone === '9333333331' && ravi.crm.customCrm?.status === 'failed', 'IG row: name/phone from extracted data + CRM status', ravi);
    const arun = all.leads.find(l => l.key === `facebook:${fb[0].id}`)!;
    expect(arun.name === 'Arun FB' && arun.phone === '9444444441', 'FB row falls back to sender name', arun);
    const neha = all.leads.find(l => l.key === `instagram:${ig[1].id}`)!;
    expect(neha.name === 'Neha IG' && neha.email === 'neha@ig.example', 'IG row reads flow keys name/email', neha);
  }
  {
    const r = await queryUnifiedLeads(A.id, { channel: 'instagram' }, { limit: 20, offset: 0 });
    expect(r.total === 2 && r.leads.every(l => l.channel === 'instagram'), 'channel=instagram → only IG', r.leads.map(l => l.key));
    const s = await queryUnifiedLeads(A.id, { search: 'ravi' }, { limit: 20, offset: 0 });
    expect(s.total === 3 && JSON.stringify(s.leads.map(l => l.channel).sort()) === JSON.stringify(['instagram', 'website', 'whatsapp']), 'search "ravi" matches website, WhatsApp and IG rows of A only', s.leads.map(l => l.name));
    const s2 = await queryUnifiedLeads(A.id, { search: '9444444441' }, { limit: 20, offset: 0 });
    expect(s2.total === 1 && s2.leads[0].key === `facebook:${fb[0].id}`, 'search by phone digits in FB extracted data', s2.leads.map(l => l.key));
    const d = await queryUnifiedLeads(A.id, { from: T(45), to: T(12) }, { limit: 20, offset: 0 });
    expect(JSON.stringify(d.leads.map(l => l.key)) === JSON.stringify([`whatsapp:${wa[0].id}`, `instagram:${ig[0].id}`, `website:${web[1].id}`]), 'date range filter across channels', d.leads.map(l => l.key));
    const pct = await queryUnifiedLeads(A.id, { search: '%' }, { limit: 20, offset: 0 });
    expect(pct.total === 0, "search '%' is literal, not a wildcard", pct.total);
    const bView = await queryUnifiedLeads(B.id, {}, { limit: 20, offset: 0 });
    for (const l of bView.leads) bIds.add(l.id);
    expect(bView.total === 4 && bView.leads.every(l => / B$/.test(l.name || '')), 'account B sees only its own 4 leads', bView.leads.map(l => l.name));
  }
  {
    // Drafts appear once the account stops requiring PAN + email? No: that is a WhatsApp setting;
    // with it off, the draft (qualified_at NULL) is an ordinary lead again, as on the WhatsApp page.
    await db.update(schema.whatsappSettings).set({ requirePanEmailForLead: 'false' }).where(eq(schema.whatsappSettings.businessAccountId, A.id));
    forgetQualificationSetting(A.id);
    const r = await queryUnifiedLeads(A.id, { channel: 'whatsapp' }, { limit: 20, offset: 0 });
    expect(r.total === 3 && r.leads.some(l => l.name === 'Draft WA'), 'without the PAN+email requirement the qualified_at-null lead is listed (matches WhatsApp page)', r.leads.map(l => l.name));
    await db.update(schema.whatsappSettings).set({ requirePanEmailForLead: 'true' }).where(eq(schema.whatsappSettings.businessAccountId, A.id));
    forgetQualificationSetting(A.id);
  }
  {
    await db.update(schema.businessAccounts).set({ leadPhoneMaskingEnabled: 'true' }).where(eq(schema.businessAccounts.id, A.id));
    const r = await queryUnifiedLeads(A.id, {}, { limit: 100, offset: 0 });
    const phones = r.leads.map(l => l.phone).filter(Boolean) as string[];
    expect(phones.length === 8 && phones.every(p => /^\*+\d{4}$/.test(p)), 'masking: every channel\'s phone column masked', phones);
    const json = JSON.stringify(r.leads);
    expect(!/9111111112|9222222221|9222222229|919222222221|9333333331|9444444441|94444 44442/.test(json), 'masking: no full phone anywhere in the rows (details, extracted data, sender phone, payloads)');
    const sita = r.leads.find(l => l.key === `website:${web[1].id}`)!;
    expect(sita.detail.leadsquaredSyncPayload === null && sita.detail.phone === '******1112', 'masking: website detail as /api/leads (phone masked, payload dropped)', sita.detail);
    const waRow = r.leads.find(l => l.key === `whatsapp:${wa[0].id}`)!;
    expect(waRow.detail.extractedData.pan === 'ABCDE1234F' && waRow.detail.extractedData.alt_mobile === '******2229', 'masking: phone-like extracted fields masked, others kept', waRow.detail.extractedData);
    await db.update(schema.businessAccounts).set({ leadPhoneMaskingEnabled: 'false' }).where(eq(schema.businessAccounts.id, A.id));
    const u = await queryUnifiedLeads(A.id, { channel: 'website' }, { limit: 1, offset: 0 });
    expect(u.leads[0].phone === '9111111111', 'masking off → full phone', u.leads[0].phone);
  }
  {
    await db.update(schema.businessAccounts).set({ facebookEnabled: 'false' }).where(eq(schema.businessAccounts.id, A.id));
    const r = await queryUnifiedLeads(A.id, {}, { limit: 100, offset: 0 });
    expect(r.total === 7 && !r.leads.some(l => l.channel === 'facebook') && !r.channels.includes('facebook'), 'Facebook disabled → FB rows and channel gone', { total: r.total, channels: r.channels });
    const only = await queryUnifiedLeads(A.id, { channel: 'facebook' }, { limit: 100, offset: 0 });
    expect(only.total === 0 && only.leads.length === 0, 'channel=facebook while disabled → nothing', only.total);
    await db.update(schema.businessAccounts).set({ whatsappEnabled: 'false', instagramEnabled: 'false' }).where(eq(schema.businessAccounts.id, A.id));
    const webOnly = await queryUnifiedLeads(A.id, {}, { limit: 100, offset: 0 });
    expect(webOnly.total === 3 && webOnly.leads.every(l => l.channel === 'website'), 'only website when other channels are off', webOnly.total);
  }

  console.log = origLog; console.error = origErr; console.warn = origWarn;
  server.close();
  if (failed) { console.error(`\n${failed} check(s) FAILED`); process.exit(1); }
  console.log('\nAll checks passed');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
