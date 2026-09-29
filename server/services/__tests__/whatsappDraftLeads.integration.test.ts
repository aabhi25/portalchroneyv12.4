/**
 * Draft WhatsApp leads (account requires a valid PAN + email) — real SQL, fake CRM.
 *
 * Covers: the PAN/email rule; drafts are not listed/counted and never sent to the CRM;
 * a draft becomes a lead once PAN (typed or read from the PAN photo) and email are in;
 * turning the setting on keeps existing complete leads; documents sent after a lead was
 * synced go to the same CRM application without creating a new applicant.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/postgres?sslmode=disable \
 *   DRAFT_LEADS_TEST_DB=1 npx tsx server/services/__tests__/whatsappDraftLeads.integration.test.ts
 */
import http from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';
import { evaluateLeadQualification } from '@shared/leadQualification';

const url = process.env.DATABASE_URL || '';
if (process.env.DRAFT_LEADS_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set DRAFT_LEADS_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
delete process.env.OPENAI_API_KEY;
delete process.env.CUSTOM_CRM_RELAY_SECRET;

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

// ── The PAN / email rule ──────────────────────────────────────────────────────
{
  const q = (extractedData: any, customerEmail: string | null = null) => evaluateLeadQualification({ customerEmail, extractedData });
  expect(q({ pan: 'ABCPE1234F', email: 'asha@example.com' }).qualified, "typed PAN + email → lead");
  expect(q({ pan_number: 'abcpe 1234 f' }, 'asha@example.com').qualified, "PAN with spaces/lowercase, email on the lead → lead");
  expect(q({ _collectedDocuments: { pan: { isValid: true, extractedData: { pan_number: 'ABCPE1234F' } } }, customer_email: 'a@b.co' }).qualified, "PAN read from the PAN card photo → counts");
  expect(q({ _documents: { pan_card: { extractedData: { documentNumber: 'ABCPE1234F' } } }, 'Email ID': 'a@b.co' }).qualified, "PAN document under another field name, 'Email ID' key → counts");
  expect(!q({ _collectedDocuments: { pan: { isValid: false, extractedData: { pan_number: 'ABCPE1234F' } } }, email: 'a@b.co' }).hasPan, "rejected PAN photo → doesn't count");
  expect(!q({ pan: 'ABCDE12345', email: 'a@b.co' }).hasPan, "badly formatted PAN → doesn't count");
  expect(!q({ pan: 'ABCQE1234F', email: 'a@b.co' }).hasPan, "PAN with an invalid 4th letter → doesn't count");
  expect(!q({ company_name: 'ABCPE1234F', email: 'a@b.co' }).hasPan, "'company' isn't a PAN field");
  expect(!q({ pan: 'ABCPE1234F', email: 'not-an-email' }).hasEmail, "invalid email → doesn't count");
  expect(!q({ _documentState: { pan: { mergedData: { pan_number: 'ABCPE1234F' } } }, email: 'a@b.co' }).hasPan, "internal reading state isn't a collected PAN");
  const m = q({ customer_name: 'Asha' });
  expect(m.missing.join(',') === 'PAN,Email', "missing lists PAN and Email", m.missing);
}

// ── Fake CRM behind a fake relay ─────────────────────────────────────────────
const fake = { creates: 0, uploads: [] as { appId: string; documentType: string }[], nextApp: 1 };
const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const send = (body: any) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url?.startsWith('/files/')) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(Buffer.from('fake-image-bytes'));
    }
    if (req.method === 'POST' && req.url === '/relay') {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const path = new URL(body.targetUrl).pathname;
      const fields = body.fields || JSON.parse(body.body || '{}');
      if (path === '/api/create') { const n = fake.nextApp++; fake.creates++; return send({ success: 1, data: { ApplicationId: `APP-${n}`, ApplicantId: `APL-${n}` } }); }
      if (path.endsWith('/UploadDocument')) { fake.uploads.push({ appId: fields.application_id, documentType: fields.document_type }); return send({ success: 1 }); }
      if (path.endsWith('/AddBankingDetails')) return send({ success: 1 });
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
    if (u.hostname === 'files.crm-test.example') return realFetch(`http://127.0.0.1:${port}${u.pathname}`, init);
    if (u.hostname !== '127.0.0.1') throw new Error(`test attempted a real network call to ${u.hostname}`);
    return realFetch(input, init);
  }) as typeof fetch;

  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq, sql } = await import('drizzle-orm');
  const { encrypt } = await import('../encryptionService');
  const svc = await import('../customCrmService');
  const lq = await import('../leadQualificationService');
  const { whatsappService } = await import('../whatsappService');
  await db.execute(sql`ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS require_pan_email_for_lead TEXT NOT NULL DEFAULT 'false'`);
  await db.execute(sql`ALTER TABLE whatsapp_leads ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMP`);

  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'Draft Leads Co', website: 'https://example.com', whatsappEnabled: 'true' } as any).returning();
  await db.insert(schema.whatsappSettings).values({ businessAccountId: acct.id } as any);
  await db.insert(schema.customCrmSettings).values({
    businessAccountId: acct.id, enabled: true, autoSyncEnabled: true, name: 'Caprion',
    apiBaseUrl: 'https://crm.crm-test.example', apiEndpoint: '/api/create',
    authType: 'checksum_caprion', contentType: 'form-data', relayUrl: `http://127.0.0.1:${port}`,
  } as any);
  await db.insert(schema.customCrmFieldMappings).values({ businessAccountId: acct.id, crmField: 'full_name', sourceType: 'dynamic', sourceField: 'lead.customerName', displayName: 'full_name', sortOrder: 0 } as any);
  await db.insert(schema.crmStoreCredentials).values({ businessAccountId: acct.id, dealerName: 'Dealer', storeName: 'Test Store', sid: 'SID-1', secret: encrypt('store-secret') } as any);

  const makeLead = async (phone: string, extractedData: Record<string, any>, extra: Record<string, any> = {}) => {
    const [l] = await db.insert(schema.whatsappLeads).values({
      businessAccountId: acct.id, senderPhone: phone, customerName: 'Asha Verma', status: 'completed',
      extractedData: { store_name: 'Test Store', dealer_name: 'Dealer', ...extractedData }, ...extra,
    } as any).returning();
    return l.id as string;
  };
  const read = async (id: string) => (await db.select().from(schema.whatsappLeads).where(eq(schema.whatsappLeads.id, id)))[0];

  // Before the setting is on: everything listed as today.
  const complete = await makeLead('919811000001', { pan: 'ABCPE1234F', email: 'asha@example.com' });
  const noPan = await makeLead('919811000002', { email: 'ravi@example.com' });
  const empty = await makeLead('919811000003', {});
  let list = await whatsappService.getLeads(acct.id, { limit: 50 });
  expect(list.total === 3 && !list.qualificationRequired, "setting off → all 3 listed as leads", { total: list.total });

  // Preview, then turn it on.
  const preview = await lq.evaluateAccountLeads(acct.id, { apply: false });
  expect(preview.total === 3 && preview.leads === 1 && preview.drafts === 2, "preview: 1 stays a lead, 2 become drafts", preview);
  expect(!(await read(complete)).qualifiedAt, "preview changes nothing");
  await db.update(schema.whatsappSettings).set({ requirePanEmailForLead: 'true' } as any).where(eq(schema.whatsappSettings.businessAccountId, acct.id));
  lq.forgetQualificationSetting(acct.id);
  await lq.evaluateAccountLeads(acct.id, { apply: true });

  list = await whatsappService.getLeads(acct.id, { limit: 50 });
  expect(list.qualificationRequired && list.total === 1 && list.leads[0].id === complete && list.draftCount === 2, "setting on → 1 lead listed, 2 drafts counted", { total: list.total, draftCount: list.draftCount });
  const drafts = await whatsappService.getLeads(acct.id, { limit: 50, view: 'drafts' });
  const noPanRow: any = drafts.leads.find(l => l.id === noPan);
  const emptyRow: any = drafts.leads.find(l => l.id === empty);
  expect(drafts.total === 2 && noPanRow?.draftMissing?.join() === 'PAN' && emptyRow?.draftMissing?.join() === 'PAN,Email', "drafts view shows what each draft is missing", drafts.leads.map((l: any) => l.draftMissing));

  // Drafts are never sent to the CRM (auto, manual or bulk).
  for (const opts of [{ source: 'webhook', requireAutoSync: true }, { source: 'manual', force: true }, { source: 'bulk' }] as const) {
    const r = await svc.syncWhatsappLeadToCustomCrm(noPan, opts as any);
    expect(r.skipped === 'draft' && /PAN/.test(r.message), `draft not sent to CRM (${opts.source})`, r);
  }
  expect(fake.creates === 0 && !(await read(noPan)).customCrmSyncStatus, "CRM never called for drafts; status untouched");

  // The complete lead syncs normally.
  const synced = await svc.syncWhatsappLeadToCustomCrm(complete, { source: 'webhook', requireAutoSync: true });
  expect(synced.success && fake.creates === 1, "a lead with PAN + email is sent", synced);

  // Draft → lead: PAN read from the PAN photo arrives after the form was finished.
  await whatsappService.updateLeadDocuments(noPan, { pan: { isValid: true, extractedData: { pan_number: 'BBBPE5678K' } } });
  await new Promise(r => setTimeout(r, 1500));
  const promoted = await read(noPan);
  expect(!!promoted.qualifiedAt, "PAN photo arrives → draft becomes a lead");
  expect(promoted.customCrmSyncStatus === 'synced' && fake.creates === 2, "…and it is sent to the CRM (form already finished)", { status: promoted.customCrmSyncStatus, creates: fake.creates });
  list = await whatsappService.getLeads(acct.id, { limit: 50 });
  expect(list.total === 2 && list.draftCount === 1, "now 2 leads, 1 draft", { total: list.total, draftCount: list.draftCount });

  // A lead is never turned back into a draft.
  await db.update(schema.whatsappLeads).set({ extractedData: {} }).where(eq(schema.whatsappLeads.id, complete));
  await lq.refreshLeadQualification(complete);
  expect(!!(await read(complete)).qualifiedAt, "data edited later → stays a lead");

  // Documents after sync: only the new one, to the same application, no new applicant.
  const docLead = await makeLead('919811000004', { pan: 'ABCPE1234F', email: 'd@example.com' });
  const fileUrl = (cat: string) => `https://files.crm-test.example/files/${docLead}-${cat}.jpg`;
  await db.insert(schema.whatsappLeadAttachments).values({ leadId: docLead, businessAccountId: acct.id, filePath: fileUrl('pan'), fileName: 'pan.jpg', mimeType: 'image/jpeg', documentCategory: 'pan' } as any);
  await lq.refreshLeadQualification(docLead, { pushToCrm: false });
  const first = await svc.syncWhatsappLeadToCustomCrm(docLead, { source: 'flow_completed', requireAutoSync: true });
  const createsAfterFirst = fake.creates;
  const appId = first.applicationId;
  expect(first.success && fake.uploads.filter(u => u.appId === appId).length === 1, "lead synced with its PAN document", first);
  await db.insert(schema.whatsappLeadAttachments).values({ leadId: docLead, businessAccountId: acct.id, filePath: fileUrl('aadhaar'), fileName: 'aadhaar.jpg', mimeType: 'image/jpeg', documentCategory: 'aadhaar' } as any);
  const more = await svc.syncWhatsappLeadToCustomCrm(docLead, { source: 'new_documents', documentsOnly: true, requireAutoSync: true });
  const forApp = fake.uploads.filter(u => u.appId === appId);
  expect(more.success && fake.creates === createsAfterFirst, "late document → no new applicant", { more, creates: fake.creates });
  expect(forApp.length === 2 && /aadhaar/i.test(forApp[1].documentType), "late document → only the Aadhaar uploaded, to the same application", forApp);

  // documentsOnly never creates an applicant for a lead without a recorded application.
  const legacy = await makeLead('919811000005', { pan: 'ABCPE1234F', email: 'l@example.com' }, { customCrmSyncStatus: 'synced' });
  await lq.refreshLeadQualification(legacy, { pushToCrm: false });
  const before = fake.creates;
  const r = await svc.syncWhatsappLeadToCustomCrm(legacy, { source: 'new_documents', documentsOnly: true });
  expect(r.skipped === 'not_eligible' && fake.creates === before, "old synced lead without application id → nothing sent", r);

  server.close();
  if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll draft lead checks passed.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
