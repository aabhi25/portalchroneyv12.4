/**
 * Integration tests for creating and sending WhatsApp campaigns (real SQL, MSG91 mocked):
 *  - "Send test to my phone": real provider path, never a recipient, hourly limit, logged
 *  - quiet hours: never starts or keeps sending inside the window; scheduler resumes it
 *  - A/B test: deterministic split at snapshot time, right template per arm, per-arm stats
 *  - follow-ups: sent once, stop on reply / opt-out / cancel, respect quiet hours, retry on rate limit
 *  - campaigns with none of these settings behave exactly as before
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at
 * localhost AND CAMPAIGN_TEST_DB=1 is set. Every MSG91 call is served by a
 * stubbed global fetch — nothing leaves the machine.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55441/postgres?sslmode=disable \
 *   CAMPAIGN_TEST_DB=1 npx tsx server/services/__tests__/campaignSendFlow.integration.test.ts
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
type Sent = { to: string; template: string; params: string[] };
const sends: Sent[] = [];
let replyFor: (to: string, attempt: number) => 'ok' | '429' = () => 'ok';
const attempts = new Map<string, number>();
let uuidSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const u = String(input?.url ?? input);
  if (!u.startsWith('https://control.msg91.com/')) return realFetch(input, init);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/report/logs/wa')) return json(200, { data: [] });
  const payload = JSON.parse(init.body).payload;
  const to = payload.to as string;
  const n = (attempts.get(to) ?? 0) + 1;
  attempts.set(to, n);
  if (replyFor(to, n) === '429') return json(429, { message: 'Too Many Requests' });
  const params = (payload.template.components?.[0]?.parameters || []).map((p: any) => p.text);
  sends.push({ to, template: payload.template.name, params });
  return json(200, { status: 'success', data: { message_uuid: `uuid-${++uuidSeq}` } });
}) as typeof fetch;

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

async function main() {
  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq, and } = await import('drizzle-orm');
  const svc = await import('../marketingCampaignService');
  const { marketingCampaignService: mcs, campaignSendTuning, isWithinQuietHours, assignVariant } = svc;
  const tools = await import('../campaignSendTools');
  const followUps = await import('../campaignFollowUpService');

  Object.assign(campaignSendTuning, { sendDelayMs: 1, maxSendDelayMs: 20, rateLimitBaseBackoffMs: 10, rateLimitMaxBackoffMs: 40, rateLimitPauseAfter: 5, rateLimitPauseMs: 50 });

  const C = schema.marketingCampaigns;
  const R = schema.marketingCampaignRecipients;
  const stamp = Date.now();
  const [acct] = await db.insert(schema.businessAccounts).values({ name: `Campaign Flow ${stamp}`, website: 'https://example.com' } as any).returning();
  const biz = acct.id;
  await db.insert(schema.whatsappSettings).values({ businessAccountId: biz, msg91AuthKey: 'test-key', msg91IntegratedNumberId: '919999999999' } as any);
  const tpl = async (name: string) => (await db.insert(schema.whatsappTemplates).values({
    businessAccountId: biz, name, bodyText: `${name}: Hi {{1}}`, paramCount: 1, status: 'approved',
  } as any).returning())[0];
  const tplA = await tpl('offer_a');
  const tplB = await tpl('offer_b');
  const tplF = await tpl('reminder_f');

  let phoneSeq = 0;
  const newGroup = async (count: number) => {
    const [g] = await db.insert(schema.contactGroups).values({ businessAccountId: biz, name: `g-${Math.random()}`, contactCount: count, defaultCountryCode: '91' } as any).returning();
    const phones: string[] = [];
    for (let i = 0; i < count; i++) {
      const phone = `9${String(800000000 + ++phoneSeq).padStart(9, '0')}`; // 10 digits
      phones.push(phone);
      await db.insert(schema.contactGroupContacts).values({ groupId: g.id, businessAccountId: biz, phone, name: `Name${phoneSeq}`, attributes: { city: 'Pune' } } as any);
    }
    return { group: g, phones };
  };
  const newCampaign = async (groupId: string, extra: Record<string, unknown> = {}) => {
    const [c] = await db.insert(C).values({
      businessAccountId: biz, name: `c-${Math.random()}`, templateId: tplA.id, templateParams: ['{{name}}'], groupIds: [groupId], status: 'draft', ...extra,
    } as any).returning();
    return c;
  };
  const campaignById = async (id: string) => (await db.select().from(C).where(eq(C.id, id)))[0];
  const recipientsOf = async (id: string) => db.select().from(R).where(eq(R.campaignId, id));
  const waitForStatus = async (id: string, status: string, ms = 15000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const c = await campaignById(id);
      if (c.status === status) return c;
      await sleep(50);
    }
    return campaignById(id);
  };
  const sendsTo = (phone10: string) => sends.filter(s => s.to === `91${phone10}`);

  // Quiet window helpers, in the default campaign time zone (Asia/Kolkata).
  const istNow = () => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    return (Number(parts.find(p => p.type === 'hour')!.value) % 24) * 60 + Number(parts.find(p => p.type === 'minute')!.value);
  };
  const hhmm = (min: number) => { const m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const quietCoveringNow = () => ({ quietHoursStart: hhmm(istNow() - 60), quietHoursEnd: hhmm(istNow() + 60) });
  const quietLater = () => ({ quietHoursStart: hhmm(istNow() + 120), quietHoursEnd: hhmm(istNow() + 180) });

  // ── Pure helpers ──────────────────────────────────────────────────────────
  expect(isWithinQuietHours(null) === false && isWithinQuietHours({ quietHoursStart: null, quietHoursEnd: null }) === false, 'no quiet hours configured → never quiet');
  expect(isWithinQuietHours(quietCoveringNow()) === true, 'window around now → quiet');
  expect(isWithinQuietHours(quietLater()) === false, 'window later today → not quiet');
  // 21:00 → 09:00 overnight window, checked at fixed instants (IST = UTC+5:30).
  const night = { quietHoursStart: '21:00', quietHoursEnd: '09:00', quietHoursTimezone: 'Asia/Kolkata' };
  expect(isWithinQuietHours(night, new Date('2026-10-04T17:00:00Z')) === true, 'overnight window: 22:30 IST is quiet');
  expect(isWithinQuietHours(night, new Date('2026-10-04T02:00:00Z')) === true, 'overnight window: 07:30 IST is quiet');
  expect(isWithinQuietHours(night, new Date('2026-10-04T06:00:00Z')) === false, 'overnight window: 11:30 IST is not quiet');
  expect(isWithinQuietHours({ ...night, quietHoursTimezone: 'America/New_York' }, new Date('2026-10-04T17:00:00Z')) === false, 'time zone is honoured (13:00 in New York)');
  {
    const same = assignVariant('camp-1', '919800000001', 30) === assignVariant('camp-1', '919800000001', 30);
    let b = 0;
    for (let i = 0; i < 2000; i++) if (assignVariant('camp-1', `91980${String(i).padStart(7, '0')}`, 30) === 'B') b++;
    expect(same, 'A/B arm is deterministic for the same campaign + phone');
    expect(b > 2000 * 0.25 && b < 2000 * 0.35, 'A/B split follows the percentage (30% → ~600 of 2000 in B)', b);
    expect(assignVariant('camp-1', '919800000001', null) === null && assignVariant('camp-1', '919800000001', 0) === null, 'no split → no arm');
  }
  expect(tools.normalizeTestPhone('98765 43210') === '919876543210' && tools.normalizeTestPhone('+1 (415) 555-0100') === '14155550100', 'test phone: 10 digits get 91, full numbers kept');
  expect(tools.normalizeTestPhone('12345') === null && tools.normalizeTestPhone('') === null, 'test phone: too short is rejected');

  // ── Null settings: the original behaviour ────────────────────────────────
  {
    const { group, phones } = await newGroup(3);
    const c = await newCampaign(group.id);
    sends.length = 0;
    const res = await mcs.startSend(biz, c.id);
    expect(res.started === true && !res.pausedForQuietHours, 'plain campaign starts sending', res);
    const done = await waitForStatus(c.id, 'completed');
    const rows = await recipientsOf(c.id);
    expect(done.status === 'completed' && done.pauseReason === null, 'plain campaign completes, never paused', done.status);
    expect(rows.length === 3 && rows.every(r => r.status === 'queued' && r.variant === null && !!r.dispatchedAt), 'recipients queued, no A/B arm, dispatch time recorded', rows.map(r => [r.status, r.variant, !!r.dispatchedAt]));
    expect(phones.every(p => sendsTo(p).length === 1 && sendsTo(p)[0].template === 'offer_a'), 'each contact got message A exactly once');
    expect(await mcs.getVariantStats(biz, c.id) === null, 'no A/B test → variants is null');
    expect((await followUps.getFollowUpSummary(biz, c.id)).steps.length === 0, 'no follow-ups configured');
  }

  // ── Send test to my phone ────────────────────────────────────────────────
  {
    const { group } = await newGroup(2);
    const c = await newCampaign(group.id);
    sends.length = 0;
    const r1 = await tools.sendCampaignTest(biz, { phone: '98765 00001', campaignId: c.id });
    expect(r1.success === true && sends.length === 1 && sends[0].to === '919876500001', 'test message goes to the typed number through the provider', { r1, sends });
    expect(sends[0]?.template === 'offer_a' && /^Name\d+$/.test(sends[0]?.params[0] || ''), 'test uses the campaign template filled from the first audience contact', sends[0]);
    const camp = await campaignById(c.id);
    expect((await recipientsOf(c.id)).length === 0 && camp.status === 'draft' && camp.sentCount === 0 && camp.totalRecipients === 0, 'test send is not a campaign recipient and leaves the campaign untouched', { status: camp.status, sent: camp.sentCount });
    const logs = await db.select().from(schema.marketingCampaignTestSends).where(eq(schema.marketingCampaignTestSends.businessAccountId, biz));
    expect(logs.length === 1 && logs[0].status === 'sent' && logs[0].phone === '919876500001' && logs[0].campaignId === c.id, 'test send is logged', logs);

    let err: any = null;
    try { await tools.sendCampaignTest(biz, { phone: '123', campaignId: c.id }); } catch (e) { err = e; }
    expect(err?.status === 400 && sends.length === 1, 'invalid number is refused before anything is sent', err?.message);

    // Unsaved campaign (wizard) path.
    const r2 = await tools.sendCampaignTest(biz, { phone: '919876500002', templateId: tplB.id, templateParams: ['{{name}}'], groupIds: [group.id] });
    expect(r2.success && sends[1]?.template === 'offer_b', 'test send works for a campaign that is not saved yet', sends[1]);

    tools.testSendTuning.limitPerHour = 3;
    const r3 = await tools.sendCampaignTest(biz, { phone: '919876500003', campaignId: c.id });
    expect(r3.success && r3.remainingThisHour === 0, 'third test of the hour is allowed', r3.remainingThisHour);
    err = null;
    try { await tools.sendCampaignTest(biz, { phone: '919876500004', campaignId: c.id }); } catch (e) { err = e; }
    expect(err?.status === 429 && sends.length === 3, 'fourth test in the hour is refused (per-business limit) and not sent', { status: err?.status, sends: sends.length });
    tools.testSendTuning.limitPerHour = 10;
    expect((await recipientsOf(c.id)).length === 0, 'still no recipients after several tests');
  }

  // ── Quiet hours: pause before starting, scheduler resumes ────────────────
  {
    const { group, phones } = await newGroup(4);
    const c = await newCampaign(group.id, quietCoveringNow());
    sends.length = 0;
    const res = await mcs.startSend(biz, c.id);
    let camp = await campaignById(c.id);
    expect(res.started && res.pausedForQuietHours === true, 'send inside quiet hours is accepted but paused', res);
    expect(camp.status === 'paused' && camp.pauseReason === 'quiet_hours', 'campaign is marked paused for quiet hours', { s: camp.status, r: camp.pauseReason });
    const rows = await recipientsOf(c.id);
    expect(rows.length === 4 && rows.every(r => r.status === 'pending') && sends.length === 0, 'recipients are fixed but nothing is sent', { n: rows.length, sends: sends.length });
    const again = await mcs.startSend(biz, c.id);
    expect(!again.started, 'a second "Send now" on a paused campaign does nothing', again);

    await mcs.runScheduler();
    await sleep(200);
    camp = await campaignById(c.id);
    expect(camp.status === 'paused' && sends.length === 0, 'scheduler leaves it paused while still quiet', camp.status);

    await db.update(C).set(quietLater()).where(eq(C.id, c.id));
    await mcs.runScheduler();
    camp = await waitForStatus(c.id, 'completed');
    expect(camp.status === 'completed' && camp.pauseReason === null, 'scheduler resumes it once the window is over and it completes', camp.status);
    expect(phones.every(p => sendsTo(p).length === 1), 'every contact got exactly one message after the resume', phones.map(p => sendsTo(p).length));
    await mcs.runScheduler();
    await sleep(200);
    expect(phones.every(p => sendsTo(p).length === 1), 'another scheduler tick sends nothing more');
  }
  // ── Quiet hours: the send loop stops when the window starts ──────────────
  {
    const { group, phones } = await newGroup(3);
    const c = await newCampaign(group.id, { status: 'sending', ...quietCoveringNow() });
    for (const p of phones) await db.insert(R).values({ campaignId: c.id, businessAccountId: biz, groupId: group.id, phone: p, name: 'X', status: 'pending' } as any);
    sends.length = 0;
    await mcs.runSendLoop(biz, c.id, tplA, (await db.select().from(schema.whatsappSettings).where(eq(schema.whatsappSettings.businessAccountId, biz)))[0]);
    let camp = await campaignById(c.id);
    const rows = await recipientsOf(c.id);
    expect(camp.status === 'paused' && rows.every(r => r.status === 'pending') && sends.length === 0, 'loop pauses instead of sending inside quiet hours, rows stay pending', { s: camp.status, rows: rows.map(r => r.status) });
    await db.update(C).set({ quietHoursStart: null, quietHoursEnd: null }).where(eq(C.id, c.id));
    await mcs.runScheduler();
    camp = await waitForStatus(c.id, 'completed');
    expect(camp.status === 'completed' && phones.every(p => sendsTo(p).length === 1), 'resumed after the setting is cleared, each contact once', phones.map(p => sendsTo(p).length));
  }

  // ── A/B test ─────────────────────────────────────────────────────────────
  {
    const { group, phones } = await newGroup(20);
    let bad = '';
    try { await mcs.create(biz, { name: 'ab bad', templateId: tplA.id, templateParams: ['{{name}}'], groupIds: [group.id], variantBTemplateId: tplB.id, variantBTemplateParams: ['x'], variantSplitPercent: 0 } as any); } catch (e: any) { bad = e.message; }
    expect(/between 1% and 99%/.test(bad), 'split of 0% is refused', bad);
    bad = '';
    try { await mcs.create(biz, { name: 'ab bad', templateId: tplA.id, templateParams: ['{{name}}'], groupIds: [group.id], variantBTemplateId: tplB.id, variantBTemplateParams: [''], variantSplitPercent: 50 } as any); } catch (e: any) { bad = e.message; }
    expect(/Message B/.test(bad), 'blank parameter in message B is refused', bad);

    const c = await mcs.create(biz, { name: 'ab', templateId: tplA.id, templateParams: ['{{name}}'], groupIds: [group.id], variantBTemplateId: tplB.id, variantBTemplateParams: ['{{city}}'], variantSplitPercent: 50 } as any);
    expect(c.variantSplitPercent === 50 && c.variantBTemplateId === tplB.id, 'A/B settings are saved');
    sends.length = 0;
    await mcs.startSend(biz, c.id);
    await waitForStatus(c.id, 'completed');
    const rows = await recipientsOf(c.id);
    const okArms = rows.every(r => r.variant === assignVariant(c.id, r.phone, 50));
    const bRows = rows.filter(r => r.variant === 'B');
    const aRows = rows.filter(r => r.variant === 'A');
    expect(rows.length === 20 && okArms, 'every recipient got its deterministic arm at snapshot time');
    expect(aRows.length > 0 && bRows.length > 0, 'both arms have recipients', { a: aRows.length, b: bRows.length });
    expect(aRows.every(r => sendsTo(r.phone).length === 1 && sendsTo(r.phone)[0].template === 'offer_a'), 'arm A got message A once each');
    expect(bRows.every(r => sendsTo(r.phone).length === 1 && sendsTo(r.phone)[0].template === 'offer_b' && sendsTo(r.phone)[0].params[0] === 'Pune'), 'arm B got message B (with its own parameters) once each');
    expect(phones.length === 20, 'sanity: 20 contacts');

    // Delivery / read / reply signals, through the real receipt and inbound paths.
    const [a1, a2] = aRows;
    const [b1] = bRows;
    await mcs.applyDeliveryReceipt(biz, a1.msg91MessageId!, 'delivered');
    await mcs.applyDeliveryReceipt(biz, a2.msg91MessageId!, 'read');
    await mcs.applyDeliveryReceipt(biz, b1.msg91MessageId!, 'read');
    await mcs.recordInbound(c.id, b1.id, biz, 'interested');
    const stats = await mcs.getVariantStats(biz, c.id);
    const A = stats?.arms.find(x => x.variant === 'A');
    const B = stats?.arms.find(x => x.variant === 'B');
    expect(stats?.splitPercent === 50 && A?.templateName === 'offer_a' && B?.templateName === 'offer_b', 'variant stats name both templates and the split', stats);
    expect(A?.total === aRows.length && A?.sent === aRows.length && A?.delivered === 2 && A?.read === 1 && A?.replied === 0, 'arm A stats: sent / delivered / read / replied', A);
    expect(B?.total === bRows.length && B?.sent === bRows.length && B?.delivered === 1 && B?.read === 1 && B?.replied === 1, 'arm B stats: sent / delivered / read / replied', B);
  }

  // ── Follow-ups ───────────────────────────────────────────────────────────
  {
    const { group } = await newGroup(1);
    let bad = '';
    try { await mcs.create(biz, { name: 'fu bad', templateId: tplA.id, templateParams: ['{{name}}'], groupIds: [group.id], followUps: [{ delayHours: 0, templateId: tplF.id, templateParams: ['x'] }] } as any); } catch (e: any) { bad = e.message; }
    expect(/wait time/.test(bad), 'follow-up wait of 0 hours is refused', bad);

    const c = await mcs.create(biz, { name: 'fu', templateId: tplA.id, templateParams: ['{{name}}'], groupIds: [group.id], followUps: [{ delayHours: 2, templateId: tplF.id, templateParams: ['{{name}}'] }] } as any);
    const steps = await mcs.listFollowUps(biz, c.id);
    expect(steps.length === 1 && steps[0].delayHours === 2 && steps[0].stepNumber === 1, 'follow-up step saved with the campaign', steps);
    await db.update(C).set({ status: 'completed' }).where(eq(C.id, c.id));
    const ago = (h: number) => new Date(Date.now() - h * 3600 * 1000);
    const add = async (phone: string, v: Record<string, unknown>) =>
      (await db.insert(R).values({ campaignId: c.id, businessAccountId: biz, groupId: group.id, phone, name: `F${phone.slice(-2)}`, status: 'delivered', msg91MessageId: `m-${phone}`, dispatchedAt: ago(3), ...v } as any).returning())[0];
    const due = await add('9700000001', {});
    const replied = await add('9700000002', { status: 'replied', firstReplyAt: ago(1) });
    const notYet = await add('9700000003', { dispatchedAt: ago(1) });
    const optedOut = await add('9700000004', {});
    const failedFirst = await add('9700000005', { status: 'failed', msg91MessageId: null });
    const otherWorker = await add('9700000006', {});
    const rateLimited = await add('9700000007', {});
    await db.insert(schema.whatsappOptOuts).values({ businessAccountId: biz, phone: '919700000004', reason: 'user_stop' } as any);
    await db.insert(schema.marketingCampaignFollowUpSends).values({ followUpId: steps[0].id, campaignId: c.id, recipientId: otherWorker.id, businessAccountId: biz, status: 'sending' } as any);

    sends.length = 0;
    attempts.clear();
    replyFor = (to, n) => (to === '919700000007' && n === 1 ? '429' : 'ok');
    await followUps.processFollowUps();
    const fuSends = () => db.select().from(schema.marketingCampaignFollowUpSends).where(eq(schema.marketingCampaignFollowUpSends.campaignId, c.id));
    let rows = await fuSends();
    const rowFor = (id: string) => rows.find(r => r.recipientId === id);
    expect(sendsTo('9700000001').length === 1 && sendsTo('9700000001')[0].template === 'reminder_f' && sendsTo('9700000001')[0].params[0] === 'F01', 'due, silent recipient gets the follow-up template', sends);
    expect(rowFor(due.id)?.status === 'sent' && !!rowFor(due.id)?.msg91MessageId, 'follow-up send recorded as sent');
    expect(sendsTo('9700000002').length === 0 && !rowFor(replied.id), 'customer who replied gets no follow-up');
    expect(sendsTo('9700000003').length === 0 && !rowFor(notYet.id), 'not due yet → nothing sent');
    expect(sendsTo('9700000004').length === 0 && rowFor(optedOut.id)?.status === 'skipped', 'opted-out customer is skipped', rowFor(optedOut.id));
    expect(sendsTo('9700000005').length === 0 && !rowFor(failedFirst.id), 'recipient whose first message failed gets no follow-up');
    expect(sendsTo('9700000006').length === 0 && rowFor(otherWorker.id)?.status === 'sending', 'a step another worker already claimed is never sent again');
    expect(sendsTo('9700000007').length === 0 && !rowFor(rateLimited.id), 'rate-limited follow-up is released for a retry, not marked failed');
    const transcript = await db.select().from(schema.marketingCampaignMessages).where(and(eq(schema.marketingCampaignMessages.recipientId, due.id)));
    expect(transcript.length === 1 && (transcript[0].metadata as any)?.followUpStep === 1, 'follow-up appears in the campaign conversation', transcript.map(t => t.metadata));

    await followUps.processFollowUps();
    rows = await fuSends();
    expect(sendsTo('9700000001').length === 1, 'second run does not send the follow-up again (idempotent)');
    expect(sendsTo('9700000007').length === 1 && rowFor(rateLimited.id)?.status === 'sent', 'rate-limited follow-up goes out on the next run, once');
    await followUps.processFollowUps();
    expect(sendsTo('9700000001').length === 1 && sendsTo('9700000007').length === 1, 'third run still sends nothing new');

    // Reply-stop: the customer replies after becoming due but before the next tick.
    const lateReply = await add('9700000008', {});
    await mcs.recordInbound(c.id, lateReply.id, biz, 'stop calling please, I will pay');
    await followUps.processFollowUps();
    expect(sendsTo('9700000008').length === 0, 'reply before the follow-up stops it');

    const summary = await followUps.getFollowUpSummary(biz, c.id);
    expect(summary.steps.length === 1 && summary.steps[0].sent === 2 && summary.steps[0].skipped === 1 && summary.steps[0].inProgress === 1 && summary.steps[0].templateName === 'reminder_f', 'follow-up summary counts', summary.steps[0]);

    // Quiet hours apply to follow-ups too; cancelled campaigns send none.
    const { group: g2 } = await newGroup(1);
    const q = await mcs.create(biz, { name: 'fu quiet', templateId: tplA.id, templateParams: ['{{name}}'], groupIds: [g2.id], ...quietCoveringNow(), followUps: [{ delayHours: 1, templateId: tplF.id, templateParams: ['{{name}}'] }] } as any);
    await db.update(C).set({ status: 'completed' }).where(eq(C.id, q.id));
    await db.insert(R).values({ campaignId: q.id, businessAccountId: biz, groupId: g2.id, phone: '9700000101', name: 'Q', status: 'sent', dispatchedAt: ago(2) } as any);
    const x = await mcs.create(biz, { name: 'fu cancelled', templateId: tplA.id, templateParams: ['{{name}}'], groupIds: [g2.id], followUps: [{ delayHours: 1, templateId: tplF.id, templateParams: ['{{name}}'] }] } as any);
    await db.update(C).set({ status: 'cancelled' }).where(eq(C.id, x.id));
    await db.insert(R).values({ campaignId: x.id, businessAccountId: biz, groupId: g2.id, phone: '9700000102', name: 'X', status: 'sent', dispatchedAt: ago(2) } as any);
    await followUps.processFollowUps();
    expect(sendsTo('9700000101').length === 0, 'no follow-up during the campaign\'s quiet hours');
    expect(sendsTo('9700000102').length === 0, 'no follow-up for a cancelled campaign');
    await db.update(C).set({ quietHoursStart: null, quietHoursEnd: null }).where(eq(C.id, q.id));
    await followUps.processFollowUps();
    expect(sendsTo('9700000101').length === 1, 'follow-up goes out once quiet hours are over');

    let lockErr = '';
    try { await mcs.update(biz, c.id, { followUps: [] } as any); } catch (e: any) { lockErr = e.message; }
    expect(/can't be changed/.test(lockErr), 'follow-ups cannot be replaced after they started going out', lockErr);
  }

  globalThis.fetch = realFetch;
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll campaign send-flow checks passed');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
