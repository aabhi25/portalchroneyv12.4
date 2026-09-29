/**
 * Integration tests for WhatsApp campaign send safety (real SQL, MSG91 mocked):
 *  - "Resend failed" never re-sends a message MSG91 already accepted (K3)
 *  - rate limits are retried with back-off, timeouts are not blindly resent (K6a)
 *  - a partially sent campaign is never parked back to an editable draft (K6b)
 *  - review-mode automation approval reuses the record key checked at upload (K6c)
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at
 * localhost AND CAMPAIGN_TEST_DB=1 is set. Every MSG91 call is served by a
 * stubbed global fetch — nothing leaves the machine.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55441/postgres?sslmode=disable \
 *   CAMPAIGN_TEST_DB=1 npx tsx server/services/__tests__/campaignSendSafety.integration.test.ts
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

// ── MSG91 stub ────────────────────────────────────────────────────────────────
type SendReply = 'ok' | '429' | 'meta_rate_limit' | 'timeout' | 'reject';
let sendPlan: (to: string, attempt: number) => SendReply = () => 'ok';
let reportRows: any[] = [];
let reportsFail = false;
const sendAttempts = new Map<string, number>();
let uuidSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const u = String(input?.url ?? input);
  if (!u.startsWith('https://control.msg91.com/')) return realFetch(input, init);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/report/logs/wa')) {
    if (reportsFail) return json(503, { message: 'down' });
    return json(200, { data: reportRows });
  }
  const to = JSON.parse(init.body).payload.to as string;
  const attempt = (sendAttempts.get(to) ?? 0) + 1;
  sendAttempts.set(to, attempt);
  const reply = sendPlan(to, attempt);
  if (reply === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  if (reply === '429') return json(429, { message: 'Too Many Requests' });
  if (reply === 'meta_rate_limit') return json(200, { status: 'fail', hasError: true, errors: { code: 131056, title: '(#131056) Pair rate limit hit' } });
  if (reply === 'reject') return json(400, { errors: 'Invalid template' });
  return json(200, { status: 'success', data: { message_uuid: `uuid-${++uuidSeq}` } });
}) as typeof fetch;

async function main() {
  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq, and } = await import('drizzle-orm');
  const svc = await import('../marketingCampaignService');
  const { marketingCampaignService: mcs, classifySendFailure, rateLimitBackoffMs, campaignSendTuning, UNKNOWN_OUTCOME_MARKER } = svc;
  const { campaignAutomationService, dispatchKeysForReviewedRun } = await import('../campaignAutomationService');

  const R = schema.marketingCampaignRecipients;
  const stamp = Date.now();
  const [acct] = await db.insert(schema.businessAccounts).values({ name: `Campaign Safety ${stamp}`, website: 'https://example.com' } as any).returning();
  const biz = acct.id;
  const [tpl] = await db.insert(schema.whatsappTemplates).values({
    businessAccountId: biz, name: 'reminder', bodyText: 'Hi {{1}}', paramCount: 1, status: 'approved',
  } as any).returning();
  const newCampaign = async (status = 'sending', extra: Record<string, unknown> = {}) => {
    const [c] = await db.insert(schema.marketingCampaigns).values({
      businessAccountId: biz, name: `c-${Math.random()}`, templateId: tpl.id, templateParams: ['{{name}}'], groupIds: [], status, ...extra,
    } as any).returning();
    return c;
  };
  const addRecipient = async (campaignId: string, phone: string, v: Record<string, unknown> = {}) => {
    const [row] = await db.insert(R).values({ campaignId, businessAccountId: biz, phone, name: `N${phone.slice(-2)}`, ...v } as any).returning();
    return row;
  };
  const rowById = async (id: string) => (await db.select().from(R).where(eq(R.id, id)))[0];

  // ── Pure classification ────────────────────────────────────────────────────
  expect(classifySendFailure({ httpStatus: 429, error: 'x' }) === 'rate_limited', 'HTTP 429 → rate_limited');
  expect(classifySendFailure({ error: { code: 130429, message: 'Rate limit hit' } }) === 'rate_limited', 'Meta 130429 → rate_limited');
  expect(classifySendFailure({ error: '(#131048) Spam rate limit hit' }) === 'rate_limited', 'Meta 131048 spam rate limit → rate_limited');
  expect(classifySendFailure({ raw: { errors: { code: 131056 } } }) === 'rate_limited', 'Meta 131056 pair rate limit → rate_limited');
  expect(classifySendFailure({ error: 'error 80007 for WABA' }) === 'rate_limited', 'Meta 80007 → rate_limited');
  expect(classifySendFailure({ error: 'Invalid template', httpStatus: 400 }) === 'failed', 'plain 400 → failed');
  expect(classifySendFailure({ error: 'aborted', outcomeUnknown: true }) === 'unknown', 'timeout → unknown');
  expect(classifySendFailure({ error: 'Phone 4 invalid', raw: { code: 400 } }) === 'failed', 'bare small numbers are not rate limits');
  expect(rateLimitBackoffMs(1) === 5000 && rateLimitBackoffMs(2) === 10000 && rateLimitBackoffMs(10) === 60000, 'back-off 5s → 10s … capped at 60s', [rateLimitBackoffMs(1), rateLimitBackoffMs(2), rateLimitBackoffMs(10)]);

  // Speed the loop up for the DB scenarios.
  Object.assign(campaignSendTuning, { sendDelayMs: 1, maxSendDelayMs: 20, rateLimitBaseBackoffMs: 10, rateLimitMaxBackoffMs: 40, rateLimitPauseAfter: 5, rateLimitPauseMs: 400 });

  await db.insert(schema.whatsappSettings).values({ businessAccountId: biz, msg91AuthKey: 'test-key', msg91IntegratedNumberId: '919999999999' } as any);
  const settings = (await db.select().from(schema.whatsappSettings).where(eq(schema.whatsappSettings.businessAccountId, biz)))[0];

  // ── K6a: rate limits are retried, timeouts are left alone ─────────────────
  {
    const c = await newCampaign();
    const a = await addRecipient(c.id, '919800000001');
    const b = await addRecipient(c.id, '919800000002');
    const t = await addRecipient(c.id, '919800000003');
    const x = await addRecipient(c.id, '919800000004');
    sendAttempts.clear();
    sendPlan = (to, attempt) => {
      if (to === '919800000001' && attempt === 1) return '429';
      if (to === '919800000002' && attempt === 1) return 'meta_rate_limit';
      if (to === '919800000003') return 'timeout';
      if (to === '919800000004') return 'reject';
      return 'ok';
    };
    await mcs.runSendLoop(biz, c.id, tpl, settings);
    const [ra, rb, rt, rx] = await Promise.all([a, b, t, x].map(r => rowById(r.id)));
    expect(ra.status === 'queued' && !!ra.msg91MessageId && sendAttempts.get('919800000001') === 2, 'HTTP 429 → retried, then queued', { s: ra.status, n: sendAttempts.get('919800000001') });
    expect(rb.status === 'queued' && sendAttempts.get('919800000002') === 2, 'Meta pair rate limit → retried, then queued', { s: rb.status, n: sendAttempts.get('919800000002') });
    expect(rt.status === 'failed' && (rt.errorMessage || '').startsWith(UNKNOWN_OUTCOME_MARKER) && sendAttempts.get('919800000003') === 1, 'timeout → failed with unknown-outcome marker, sent once', rt);
    expect(rx.status === 'failed' && !(rx.errorMessage || '').startsWith(UNKNOWN_OUTCOME_MARKER), 'definite rejection → plain failed', rx.errorMessage);
    const [camp] = await db.select().from(schema.marketingCampaigns).where(eq(schema.marketingCampaigns.id, c.id));
    expect(camp.status === 'completed', 'campaign completes after retries', camp.status);
  }
  {
    // Five rate limits in a row → the loop pauses rather than burning through the list.
    const c = await newCampaign();
    const a = await addRecipient(c.id, '919800000011');
    sendAttempts.clear();
    sendPlan = (_to, attempt) => attempt <= 5 ? '429' : 'ok';
    const started = Date.now();
    await mcs.runSendLoop(biz, c.id, tpl, settings);
    const elapsed = Date.now() - started;
    const ra = await rowById(a.id);
    expect(ra.status === 'queued' && sendAttempts.get('919800000011') === 6, 'recipient retried until accepted', { s: ra.status, n: sendAttempts.get('919800000011') });
    expect(elapsed >= 400 + 10 + 20 + 40 + 40, 'backs off exponentially and pauses after 5 consecutive hits', elapsed);
  }

  // ── K3: accepted-then-throw is never downgraded to failed ────────────────
  {
    const c = await newCampaign();
    const boom = await addRecipient(c.id, '919800000021', { name: 'BOOM' });
    await db.execute(`ALTER TABLE marketing_campaign_messages ADD CONSTRAINT test_no_boom CHECK (body NOT LIKE '%BOOM%')` as any);
    sendAttempts.clear();
    sendPlan = () => 'ok';
    await mcs.runSendLoop(biz, c.id, tpl, settings);
    await db.execute(`ALTER TABLE marketing_campaign_messages DROP CONSTRAINT test_no_boom` as any);
    const r = await rowById(boom.id);
    expect(r.status === 'queued' && !!r.msg91MessageId, 'transcript insert failure after acceptance keeps row queued with its message id', { s: r.status, id: r.msg91MessageId });
  }

  // ── K3: "Resend failed" only resends rows MSG91 never accepted ───────────
  {
    const c = await newCampaign('completed');
    const never = await addRecipient(c.id, '919800000031', { status: 'failed', errorMessage: 'Invalid phone number' });
    const metaFailed = await addRecipient(c.id, '919800000032', { status: 'failed', msg91MessageId: 'acc-1', errorMessage: 'Meta error 131026' });
    const expired = await addRecipient(c.id, '919800000033', { status: 'expired', msg91MessageId: 'acc-2', errorMessage: 'Provider did not confirm delivery within TTL' });
    const unknown = await addRecipient(c.id, '919800000034', { status: 'failed', errorMessage: `${UNKNOWN_OUTCOME_MARKER} Send outcome unknown` });

    const single = await mcs.requeueRecipient(biz, c.id, expired.id);
    expect(single.requeued === 0, 'per-row resend refuses an expired row with a message id', single);
    const single2 = await mcs.requeueRecipient(biz, c.id, unknown.id);
    expect(single2.requeued === 0, 'per-row resend refuses an unknown-outcome row', single2);

    const n = await mcs.requeueRows(biz, c.id, null);
    const [rn, rm, re, ru] = await Promise.all([never, metaFailed, expired, unknown].map(r => rowById(r.id)));
    expect(n === 1 && rn.status === 'pending', 'default resend requeues only the never-accepted row', { n, s: rn.status });
    expect(rm.status === 'failed' && rm.msg91MessageId === 'acc-1', 'accepted failed row untouched, message id kept', rm);
    expect(re.status === 'expired' && re.msg91MessageId === 'acc-2', 'expired row untouched, message id kept', re);
    expect(ru.status === 'failed', 'unknown-outcome row untouched', ru.status);

    // Explicit opt-in: reconcile first. acc-2 turns out delivered (lost webhook) → not resent.
    reportsFail = true;
    let threw = false;
    try { await mcs.requeueRows(biz, c.id, null, { includeAccepted: true }); } catch { threw = true; }
    expect(threw && (await rowById(metaFailed.id)).status === 'failed', 'opt-in resend refuses when MSG91 status cannot be checked');
    reportsFail = false;
    reportRows = [
      { requestId: 'acc-2', status: 'delivered' },
      { requestId: 'acc-1', status: 'failed', failureReason: 'Undeliverable' },
    ];
    const n2 = await mcs.requeueRows(biz, c.id, null, { includeAccepted: true });
    const [rm2, re2] = await Promise.all([metaFailed, expired].map(r => rowById(r.id)));
    expect(re2.status === 'delivered', 'reconcile promotes the expired-but-delivered row, so it is not resent', re2.status);
    expect(rm2.status === 'pending' && rm2.msg91MessageId === 'acc-1' && n2 === 2, 'opt-in requeues the provider-failed row, keeping its old message id', { n2, s: rm2.status, id: rm2.msg91MessageId });

    // A late "sent" receipt promotes an expired row (it is no longer resendable).
    const c2 = await newCampaign('completed');
    const exp2 = await addRecipient(c2.id, '919800000035', { status: 'expired', msg91MessageId: 'acc-3' });
    await mcs.applyDeliveryReceipt(biz, 'acc-3', 'sent');
    expect((await rowById(exp2.id)).status === 'sent', "late 'sent' receipt promotes an expired row");
  }

  // ── K6b: a partially sent campaign is parked as failed, never draft ──────
  {
    const [draftTpl] = await db.insert(schema.whatsappTemplates).values({ businessAccountId: biz, name: 'withdrawn', bodyText: 'x', status: 'rejected' } as any).returning();
    const parkWith = async (rows: Record<string, unknown>[]) => {
      const c = await newCampaign('scheduled', { templateId: draftTpl.id, templateParams: [] });
      for (const [i, v] of rows.entries()) await addRecipient(c.id, `91980000009${i}`, v);
      const res = await mcs.startSend(biz, c.id, { automationExecution: true });
      const [after] = await db.select().from(schema.marketingCampaigns).where(eq(schema.marketingCampaigns.id, c.id));
      return { started: res.started, status: after.status };
    };
    const onlyQueued = await parkWith([{ status: 'queued', msg91MessageId: 'q-1' }, { status: 'pending' }]);
    expect(!onlyQueued.started && onlyQueued.status === 'failed', "queued (accepted) rows count as sent → parked 'failed'", onlyQueued);
    const acceptedThenFailed = await parkWith([{ status: 'failed', msg91MessageId: 'q-2' }]);
    expect(acceptedThenFailed.status === 'failed', "row with a provider id counts as sent → parked 'failed'", acceptedThenFailed);
    const unknownOutcome = await parkWith([{ status: 'failed', errorMessage: `${UNKNOWN_OUTCOME_MARKER} x` }]);
    expect(unknownOutcome.status === 'failed', "unknown-outcome row counts as sent → parked 'failed'", unknownOutcome);
    const nothingSent = await parkWith([{ status: 'pending' }, { status: 'failed', errorMessage: 'Invalid phone number' }]);
    expect(nothingSent.status === 'draft', "nothing accepted → parked back to 'draft'", nothingSent);
  }

  // ── K6c: review-mode approval reuses the persisted record key ────────────
  {
    let threw = '';
    try { dispatchKeysForReviewedRun([{ recordKey: 'k', phone: '1' }], [{ phone: '2' }]); } catch (e: any) { threw = e.message; }
    expect(/changed after it was reviewed/.test(threw), 'approval refuses when the generated contacts changed', threw);
    threw = '';
    try { dispatchKeysForReviewedRun([{ recordKey: ' ', phone: '1' }], [{ phone: '1' }]); } catch (e: any) { threw = e.message; }
    expect(/blank record key/.test(threw), 'approval refuses a blank stored key', threw);

    const [autoTpl] = await db.insert(schema.whatsappTemplates).values({ businessAccountId: biz, name: 'due', bodyText: 'Hi {{1}}', paramCount: 1, status: 'approved' } as any).returning();
    // Record key = mobile + policy: the mobile (phone) column is excluded from
    // contact attributes and stored normalised, which broke the old rebuild.
    const automation = await campaignAutomationService.create(biz, {
      name: 'Premium due', sourceType: 'upload', templateId: autoTpl.id, templateParams: ['{{name}}'],
      phoneColumn: 'mobile', nameColumn: 'customer', recordKeyColumn: 'mobile,policy_no', dateColumn: 'due_date',
      sendMode: 'review', timezone: 'Asia/Kolkata', sendTime: '10:00',
    } as any);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const payload = {
      columns: [{ key: 'mobile', label: 'Mobile' }, { key: 'policy_no', label: 'Policy' }, { key: 'customer', label: 'Customer' }, { key: 'due_date', label: 'Due' }],
      rows: [
        { r: 2, v: ['+91 98765-43210', 'P-1', 'Asha', today] },
        { r: 3, v: ['+91 98765-43211', 'P-2', 'Ravi', today] },
      ],
    };
    const { run } = await campaignAutomationService.createRun(biz, automation.id, payload, 'due.xlsx');
    let approveError = '';
    try { await campaignAutomationService.approveRun(biz, automation.id, run.id); } catch (e: any) { approveError = e.message; }
    expect(!approveError, 'review run approves when the record key includes the phone column', approveError);
    const dispatches = await db.select().from(schema.whatsappCampaignAutomationDispatches)
      .where(and(eq(schema.whatsappCampaignAutomationDispatches.automationId, automation.id), eq(schema.whatsappCampaignAutomationDispatches.runId, run.id)));
    const keys = dispatches.map(d => d.recordKey).sort();
    expect(JSON.stringify(keys) === JSON.stringify(['+91 98765-43210 | P-1', '+91 98765-43211 | P-2']), 'reserved keys are exactly the keys computed at upload', keys);
    const again = await campaignAutomationService.preview(biz, automation.id, payload);
    expect(again.summary.eligibleRows === 0 && again.summary.duplicateRows === 2, 'the same records are recognised as already sent on the next upload', again.summary);
  }

  globalThis.fetch = realFetch;
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll campaign send-safety checks passed');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
