/**
 * Integration test for WhatsApp lead → Custom CRM push reliability (real SQL, fake CRM).
 *
 * Covers: partial document failure is not 'synced' and a retry re-sends only the missing
 * documents; concurrent syncs push once; transient failures are retried after backoff by the
 * recovery worker; permanent 4xx stops; timeouts are an unknown outcome; nothing sensitive
 * is logged.
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at localhost AND
 * CRM_SYNC_TEST_DB=1 is set. The CRM/relay is a local fake HTTP server — no real endpoint
 * is ever called.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/postgres?sslmode=disable \
 *   CRM_SYNC_TEST_DB=1 npx tsx server/services/__tests__/customCrmSyncReliability.integration.test.ts
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

// ── Fake CRM behind a fake relay ─────────────────────────────────────────────
type Behaviour = { status?: number; body?: any; delayMs?: number };
const fake = {
  creates: [] as { leadName: string }[],
  uploads: [] as { appId: string; documentType: string }[],
  banking: [] as { appId: string }[],
  create: {} as Record<string, Behaviour>,       // by full_name
  upload: {} as Record<string, Behaviour>,       // by document_type
  nextApp: 1,
  omitApplicantId: false,
};

function reply(res: http.ServerResponse, b: Behaviour, fallback: any) {
  const send = () => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(b.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(b.body ?? fallback));
  };
  if (b.delayMs) setTimeout(send, b.delayMs); else send();
}

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'GET' && req.url?.startsWith('/files/')) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(Buffer.from('fake-image-bytes'));
      return;
    }
    if (req.method === 'POST' && req.url === '/relay') {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const path = new URL(body.targetUrl).pathname;
      const fields = body.fields || JSON.parse(body.body || '{}');
      if (path === '/api/create') {
        const name = fields.full_name;
        const b = fake.create[name] || {};
        const ok = (b.status ?? 200) < 300 && !b.body;
        const n = fake.nextApp++;
        fake.creates.push({ leadName: name });
        return reply(res, b, ok
          ? { success: 1, data: fake.omitApplicantId ? { ApplicationId: `APP-${n}` } : { ApplicationId: `APP-${n}`, ApplicantId: `APL-${n}` } }
          : { success: 0, message: 'rejected' });
      }
      if (path.endsWith('/UploadDocument')) {
        const b = fake.upload[fields.document_type] || {};
        fake.uploads.push({ appId: fields.application_id, documentType: fields.document_type });
        return reply(res, b, { success: 1 });
      }
      if (path.endsWith('/AddBankingDetails')) {
        fake.banking.push({ appId: fields.application_id });
        return reply(res, {}, { success: 1 });
      }
    }
    res.writeHead(404); res.end('{}');
  });
});

async function main() {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  // Document URLs must pass the service's SSRF check (no localhost), so they use a fake
  // public hostname that this wrapper routes to the local fake server.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname === 'files.crm-test.example') {
      return realFetch(`http://127.0.0.1:${port}${u.pathname}`, init);
    }
    if (u.hostname !== '127.0.0.1') throw new Error(`test attempted a real network call to ${u.hostname}`);
    return realFetch(input, init);
  }) as typeof fetch;

  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq } = await import('drizzle-orm');
  const { encrypt } = await import('../encryptionService');
  const svc = await import('../customCrmService');
  const { crmSyncRecoveryWorker } = await import('../crmSyncRecoveryWorker');

  // ── Fixtures ────────────────────────────────────────────────────────────────
  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'CRM Sync Test Co', website: 'https://example.com' }).returning();
  await db.insert(schema.customCrmSettings).values({
    businessAccountId: acct.id, enabled: true, autoSyncEnabled: true, name: 'Caprion',
    apiBaseUrl: 'https://crm.crm-test.example', apiEndpoint: '/api/create',
    authType: 'checksum_caprion', contentType: 'form-data', relayUrl: `http://127.0.0.1:${port}`,
  });
  const mappings: [string, string][] = [
    ['full_name', 'lead.customerName'],
    ['aadhaar_number', 'extracted.aadhaar_number'],
    ['pan', 'extracted.pan'],
  ];
  for (const [i, [crmField, sourceField]] of mappings.entries()) {
    await db.insert(schema.customCrmFieldMappings).values({ businessAccountId: acct.id, crmField, sourceType: 'dynamic', sourceField, displayName: crmField, sortOrder: i });
  }
  await db.insert(schema.crmStoreCredentials).values({ businessAccountId: acct.id, dealerName: 'Dealer', storeName: 'Test Store', sid: 'SID-1', secret: encrypt('store-secret') });

  const AADHAAR = '846868462917';
  const PAN = 'ABCPE1234F';
  const ACCOUNT = '000111222333444';
  const makeLead = async (name: string, docs: string[] = []) => {
    const [l] = await db.insert(schema.whatsappLeads).values({
      businessAccountId: acct.id, senderPhone: '919800000000', customerName: name, customerPhone: '9800000001', status: 'completed',
      extractedData: { store_name: 'Test Store', dealer_name: 'Dealer', aadhaar_number: AADHAAR, pan: PAN, account_number: ACCOUNT, ifsc: 'HDFC0000001' },
    }).returning();
    for (const cat of docs) {
      await db.insert(schema.whatsappLeadAttachments).values({ leadId: l.id, businessAccountId: acct.id, filePath: `https://files.crm-test.example/files/${l.id}-${cat}.jpg`, fileName: `${cat}.jpg`, mimeType: 'image/jpeg', documentCategory: cat });
    }
    return l.id;
  };
  const read = async (id: string) => {
    const [l] = await db.select().from(schema.whatsappLeads).where(eq(schema.whatsappLeads.id, id));
    return { ...l, meta: ((l.customCrmSyncPayload as any)?._crmSync || {}) as any };
  };
  const backdateRetry = async (id: string) => {
    const past = new Date(Date.now() - 1000).toISOString();
    await db.execute((await import('drizzle-orm')).sql`
      UPDATE whatsapp_leads SET custom_crm_sync_payload = jsonb_set(custom_crm_sync_payload, '{_crmSync,nextRetryAt}', to_jsonb(${past}::text)) WHERE id = ${id}`);
  };
  const createsFor = (name: string) => fake.creates.filter(c => c.leadName === name).length;

  // Capture logs to check nothing sensitive is printed.
  const logs: string[] = [];
  const origLog = console.log, origErr = console.error, origWarn = console.warn;
  const capture = (orig: (...a: any[]) => void) => (...a: any[]) => { logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); orig(...a); };
  console.log = capture(origLog); console.error = capture(origErr); console.warn = capture(origWarn);

  // ── Pure helpers ─────────────────────────────────────────────────────────────
  {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const mins = (a: number) => (svc.nextCrmRetryAt(a, t0)!.getTime() - t0.getTime()) / 60_000;
    expect(mins(1) === 5 && mins(2) === 15 && mins(3) === 60 && mins(4) === 180 && mins(5) === 720, 'backoff schedule 5m/15m/1h/3h/12h');
    expect(svc.nextCrmRetryAt(svc.CRM_MAX_ATTEMPTS, t0) === null, `no retry after ${svc.CRM_MAX_ATTEMPTS} attempts`);
    expect(svc.classifyHttpStatus(400) === 'permanent' && svc.classifyHttpStatus(422) === 'permanent', '400/422 are permanent');
    expect(['408', '429', '500', '503'].every(s => svc.classifyHttpStatus(Number(s)) === 'transient'), '408/429/5xx are transient');
  }

  // ── 1. Document failure → not 'synced'; retry re-sends only the missing document ──
  {
    fake.omitApplicantId = true; // CRM returns ApplicationId only — docs must still upload
    fake.upload['Aadhaar Card'] = { status: 500, body: { success: 0, message: 'storage error' } };
    const id = await makeLead('Doc Fail', ['pan_card', 'aadhaar_card']);
    const r = await svc.syncWhatsappLeadToCustomCrm(id, { source: 'flow_completed' });
    let l = await read(id);
    expect(r.outcome === 'partial' && l.customCrmSyncStatus === 'failed', "doc failure → status 'failed' (partial), not 'synced'", { outcome: r.outcome, status: l.customCrmSyncStatus });
    expect(/partial_documents/.test(l.customCrmSyncError || '') && /Aadhaar Card/.test(l.customCrmSyncError || '') && !/PAN Card/.test(l.customCrmSyncError || ''), 'error names only the failed document', l.customCrmSyncError);
    expect(!!l.customCrmLeadId && l.customCrmLeadId === l.meta.applicationId, 'CRM application id stored on the lead even though docs failed', l.customCrmLeadId);
    expect(l.meta.retryable === true && l.meta.created === true && l.meta.uploadedDocKeys.length === 1 && l.meta.bankingUploaded === true, 'retry state records the applicant, banking and the one accepted doc', l.meta);
    expect(fake.uploads.filter(u => u.documentType === 'PAN Card').length === 1, 'PAN uploaded once without an applicant id');

    delete fake.upload['Aadhaar Card'];
    await crmSyncRecoveryWorker.processRecoveries();
    l = await read(id);
    expect(l.customCrmSyncStatus === 'failed', 'worker does not retry before nextRetryAt', l.customCrmSyncStatus);
    await backdateRetry(id);
    await crmSyncRecoveryWorker.processRecoveries();
    l = await read(id);
    expect(l.customCrmSyncStatus === 'synced' && !l.customCrmSyncError, "retry → 'synced'", { s: l.customCrmSyncStatus, e: l.customCrmSyncError });
    expect(createsFor('Doc Fail') === 1, 'retry did not create a second applicant', createsFor('Doc Fail'));
    const appId = l.meta.applicationId;
    expect(fake.uploads.filter(u => u.appId === appId && u.documentType === 'PAN Card').length === 1, 'retry did not re-send the PAN that was already accepted');
    expect(fake.uploads.filter(u => u.appId === appId && u.documentType === 'Aadhaar Card').length === 2, 'retry re-sent the failed Aadhaar');
    expect(fake.banking.filter(b => b.appId === appId).length === 1, 'retry did not re-send banking details');
    fake.omitApplicantId = false;
  }

  // ── 2. Two concurrent syncs (flow completion + webhook) → one push ─────────────
  {
    fake.create['Concurrent'] = { delayMs: 300 };
    const id = await makeLead('Concurrent', ['pan_card']);
    const [a, b] = await Promise.all([
      svc.syncWhatsappLeadToCustomCrm(id, { source: 'flow_completed' }),
      svc.syncWhatsappLeadToCustomCrm(id, { source: 'webhook' }),
    ]);
    expect(createsFor('Concurrent') === 1, 'two concurrent syncs → one create', createsFor('Concurrent'));
    expect([a, b].filter(x => x.skipped === 'in_progress').length === 1, "the loser is skipped as 'in_progress'", [a.skipped, b.skipped]);
    const c = await svc.syncWhatsappLeadToCustomCrm(id, { source: 'webhook' });
    expect(c.skipped === 'already_synced' && createsFor('Concurrent') === 1, 'later call for a synced lead is a no-op', c.skipped);
    const d = await svc.syncWhatsappLeadToCustomCrm(id, { source: 'manual', force: true });
    expect(!d.skipped && d.status === 'synced' && createsFor('Concurrent') === 2, 'force (manual Sync) still re-pushes a synced lead', d);
  }

  // ── 3. Transient failure → retried after backoff by the worker ─────────────────
  {
    fake.create['Transient'] = { status: 503, body: { message: 'maintenance' } };
    const id = await makeLead('Transient');
    const before = Date.now();
    const r = await svc.syncWhatsappLeadToCustomCrm(id, { source: 'flow_completed' });
    let l = await read(id);
    const delay = new Date(l.meta.nextRetryAt).getTime() - before;
    expect(r.errorKind === 'transient' && l.customCrmSyncStatus === 'failed' && l.meta.retryable === true, '503 → failed, retryable', l.meta);
    expect(delay > 4.9 * 60_000 && delay < 5.1 * 60_000 && l.meta.attempts === 1, 'first retry scheduled ~5 minutes out', delay);
    await crmSyncRecoveryWorker.processRecoveries();
    expect(createsFor('Transient') === 1, 'not retried before the backoff elapses');
    delete fake.create['Transient'];
    await backdateRetry(id);
    await crmSyncRecoveryWorker.processRecoveries();
    l = await read(id);
    expect(l.customCrmSyncStatus === 'synced' && createsFor('Transient') === 2 && l.meta.attempts === 2, 'retried after backoff → synced', { s: l.customCrmSyncStatus, n: createsFor('Transient') });
  }

  // ── 4. Permanent 400 → stops ─────────────────────────────────────────────────
  {
    fake.create['Permanent'] = { status: 400, body: { message: 'Invalid PAN format' } };
    const id = await makeLead('Permanent');
    const r = await svc.syncWhatsappLeadToCustomCrm(id, { source: 'flow_completed' });
    let l = await read(id);
    expect(r.errorKind === 'permanent' && l.meta.retryable === false && l.meta.nextRetryAt === null, '400 → permanent, no retry scheduled', l.meta);
    expect(/Invalid PAN format/.test(l.customCrmSyncError || ''), 'reason recorded', l.customCrmSyncError);
    await crmSyncRecoveryWorker.processRecoveries();
    const again = await svc.syncWhatsappLeadToCustomCrm(id, { source: 'webhook' });
    expect(createsFor('Permanent') === 1 && again.skipped === 'not_eligible', 'neither the worker nor an automatic trigger retries it', again.skipped);
    delete fake.create['Permanent'];
    const manual = await svc.syncWhatsappLeadToCustomCrm(id, { source: 'manual', force: true });
    expect(manual.status === 'synced' && createsFor('Permanent') === 2, 'manual Sync (force) can still push it after the data is fixed');
  }

  // ── 5. Timeout on create → unknown outcome, not auto-retried ──────────────────
  {
    const saved = svc.CRM_TIMEOUTS.jsonMs;
    svc.CRM_TIMEOUTS.jsonMs = 200;
    fake.create['Slow'] = { delayMs: 1000 };
    const id = await makeLead('Slow');
    const t = Date.now();
    const r = await svc.syncWhatsappLeadToCustomCrm(id, { source: 'flow_completed' });
    const took = Date.now() - t;
    const l = await read(id);
    expect(took < 900, 'create call aborted by the timeout', took);
    expect(r.errorKind === 'unknown_outcome' && l.customCrmSyncStatus === 'failed' && l.meta.retryable === false, 'timeout → failed, unknown outcome, not retryable', l.meta);
    expect(/may have been created/.test(l.customCrmSyncError || ''), 'error tells staff to check the CRM first', l.customCrmSyncError);
    await wait(900);
    await crmSyncRecoveryWorker.processRecoveries();
    expect(createsFor('Slow') === 1, 'worker does not re-create after an ambiguous timeout');
    svc.CRM_TIMEOUTS.jsonMs = saved;
    delete fake.create['Slow'];
  }

  // ── 6. Stale claims ──────────────────────────────────────────────────────────
  {
    const { sql } = await import('drizzle-orm');
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    // (a) instance died mid-create → held for review, not re-sent
    const a = await makeLead('Crashed Create');
    await db.execute(sql`UPDATE whatsapp_leads SET custom_crm_sync_status = 'pending',
      custom_crm_sync_payload = jsonb_build_object('_crmSync', jsonb_build_object('claimId', 'dead', 'claimedAt', ${old}::text, 'createStartedAt', ${old}::text, 'created', false)) WHERE id = ${a}`);
    // (b) instance died after creating the applicant, during documents → resumed
    const b = await makeLead('Crashed Docs', ['pan_card', 'aadhaar_card']);
    const bKey = `pan_card|https://files.crm-test.example/files/${b}-pan_card.jpg`;
    await db.execute(sql`UPDATE whatsapp_leads SET custom_crm_sync_status = 'pending',
      custom_crm_sync_payload = jsonb_build_object('_crmSync', jsonb_build_object('claimId', 'dead', 'claimedAt', ${old}::text, 'created', true,
        'applicationId', 'APP-OLD', 'bankingUploaded', true, 'uploadedDocKeys', jsonb_build_array(${bKey}::text))) WHERE id = ${b}`);
    // (c) fresh claim held by a live instance → left alone
    const c = await makeLead('Live Claim');
    const fresh = new Date().toISOString();
    await db.execute(sql`UPDATE whatsapp_leads SET custom_crm_sync_status = 'pending',
      custom_crm_sync_payload = jsonb_build_object('_crmSync', jsonb_build_object('claimId', 'alive', 'claimedAt', ${fresh}::text)) WHERE id = ${c}`);

    await crmSyncRecoveryWorker.processRecoveries();
    const la = await read(a), lb = await read(b), lc = await read(c);
    expect(la.customCrmSyncStatus === 'failed' && la.meta.errorKind === 'unknown_outcome' && createsFor('Crashed Create') === 0, 'stale claim interrupted mid-create → held for manual review, not re-created', la.meta);
    expect(lb.customCrmSyncStatus === 'synced' && createsFor('Crashed Docs') === 0, 'stale claim after create → resumed without a new applicant', lb.customCrmSyncStatus);
    expect(fake.uploads.filter(u => u.appId === 'APP-OLD').map(u => u.documentType).join() === 'Aadhaar Card', 'resume uploaded only the missing Aadhaar', fake.uploads.filter(u => u.appId === 'APP-OLD'));
    expect(lc.customCrmSyncStatus === 'pending' && lc.meta.claimId === 'alive', 'fresh claim by another instance is not stolen');
    const forced = await svc.syncWhatsappLeadToCustomCrm(c, { source: 'manual', force: true });
    expect(forced.skipped === 'in_progress', 'force does not steal an in-flight claim either', forced.skipped);
  }

  // ── 7. No sensitive values in logs ───────────────────────────────────────────
  {
    const all = logs.join('\n');
    expect(!all.includes(AADHAAR), 'Aadhaar number never logged');
    expect(!all.includes(PAN), 'PAN never logged');
    expect(!all.includes(ACCOUNT), 'bank account number never logged');
    expect(!all.includes('files.crm-test.example'), 'document URLs never logged');
  }

  console.log = origLog; console.error = origErr; console.warn = origWarn;
  server.close();
  const { pool } = await import('../../db');
  await pool.end();
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll CRM sync reliability assertions passed');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
