/**
 * Integration tests for automatic daily campaign automation runs and the
 * campaign home / results dashboard numbers (real SQL, MSG91 stubbed):
 *  - a due automation gets exactly one run per day, even when the scheduler
 *    tick runs twice concurrently and again afterwards ("restart")
 *  - not-due (wrong weekday / too early) does nothing
 *  - a validation failure is recorded with its reason and nothing is created
 *  - paused automations and automations without a schedule are skipped
 *  - review-mode schedules prepare a run that waits for approval
 *  - campaigns switched off for the business -> skipped with a reason
 *  - interrupted claims are closed out, never retried
 *  - timezone / weekday / DST maths
 *  - home summary + dashboard numbers on seeded data
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at
 * localhost AND CAMPAIGN_TEST_DB=1 is set. No message is ever sent: the
 * campaign sender is never invoked and any MSG91 call fails the test.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55444/postgres?sslmode=disable \
 *   CAMPAIGN_TEST_DB=1 npx tsx server/services/__tests__/campaignAutomationScheduler.integration.test.ts
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

let providerCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const u = String(input?.url ?? input);
  if (u.includes('msg91.com') || u.includes('graph.facebook.com')) {
    providerCalls++;
    return new Response(JSON.stringify({ status: 'fail' }), { status: 500 });
  }
  return realFetch(input, init);
}) as typeof fetch;

async function main() {
  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq, and, sql } = await import('drizzle-orm');
  const auto = await import('../campaignAutomationService');
  const {
    campaignAutomationService, runAutomationScheduleTick, runScheduledAutomation, recoverStaleScheduleClaims,
    scheduleWindowFor, nextScheduledRunAt, zonedDateTimeToUtc, dateInTimezone, addDays, getAutomationSchedule,
    setAutomationSchedule, automationScheduleTuning,
  } = auto;
  const { getCampaignHomeSummary, getCampaignInsights } = await import('../campaignInsightsService');

  const A = schema.whatsappCampaignAutomations;
  const RUNS = schema.whatsappCampaignAutomationRuns;
  const ATT = schema.whatsappCampaignAutomationScheduleAttempts;
  const DISP = schema.whatsappCampaignAutomationDispatches;
  const TZ = 'Asia/Kolkata';

  // ── Pure timezone / weekday maths ─────────────────────────────────────────
  {
    const old = new Date('2020-01-01T00:00:00Z');
    const ny = { sendTime: '09:00', timezone: 'America/New_York', scheduleDays: [] as number[], scheduleActivatedAt: old, updatedAt: old };
    const at = (date: string, time: string, tz: string) => zonedDateTimeToUtc(date, time, tz);
    const w1 = scheduleWindowFor(ny, at('2026-10-05', '09:01', 'America/New_York'));
    expect(w1.state === 'due' && w1.runDate === '2026-10-05' && w1.scheduledFor.toISOString() === '2026-10-05T13:00:00.000Z',
      'New York 09:00 (EDT) is due at 09:01 local = 13:00 UTC', w1);
    expect(scheduleWindowFor(ny, at('2026-10-05', '08:50', 'America/New_York')).state === 'early', '10 minutes before send time is not due yet');
    expect(scheduleWindowFor(ny, at('2026-10-05', '08:56', 'America/New_York')).state === 'due', 'inside the 5-minute lead the run is prepared');
    expect(scheduleWindowFor(ny, at('2026-10-05', '12:30', 'America/New_York')).state === 'missed', 'more than 3h late counts as missed');
    const kol = { ...ny, timezone: TZ };
    const sameInstant = at('2026-10-05', '09:01', 'America/New_York');
    expect(scheduleWindowFor(kol, sameInstant).state === 'missed', 'the same instant is 22:31 in Kolkata — not a 09:00 run');
    const boundary = new Date('2026-10-04T19:00:00Z'); // 00:30 on the 5th in Kolkata, 15:00 on the 4th in New York
    expect(scheduleWindowFor(kol, boundary).runDate === '2026-10-05' && scheduleWindowFor(ny, boundary).runDate === '2026-10-04',
      'the run date is the local date in each automation timezone');
    expect(scheduleWindowFor({ ...ny, scheduleDays: [2] }, at('2026-10-05', '09:01', 'America/New_York')).state === 'not_today',
      'Monday is skipped when only Tuesday is chosen');
    expect(scheduleWindowFor({ ...ny, scheduleDays: [1] }, at('2026-10-05', '09:01', 'America/New_York')).state === 'due',
      'Monday runs when Monday is chosen');
    expect(at('2026-11-02', '09:00', 'America/New_York').toISOString() === '2026-11-02T14:00:00.000Z', 'after DST ends New York 09:00 is 14:00 UTC');
    expect(scheduleWindowFor({ ...ny, scheduleActivatedAt: at('2026-10-05', '09:30', 'America/New_York') }, at('2026-10-05', '09:40', 'America/New_York')).state === 'before_activation',
      'switching the schedule on after today\'s time does not back-fill today');
    expect(scheduleWindowFor({ ...ny, updatedAt: at('2026-10-05', '09:30', 'America/New_York') }, at('2026-10-05', '09:40', 'America/New_York')).state === 'before_activation',
      'editing the automation after today\'s time does not fire a catch-up run');
    const nextFull = { ...ny, scheduleEnabled: true, enabled: true, sourceType: 'campaign_blueprint' };
    const next = nextScheduledRunAt(nextFull, new Set(['2026-10-05']), at('2026-10-05', '09:30', 'America/New_York'));
    expect(next?.toISOString() === '2026-10-06T13:00:00.000Z', 'next run after today\'s is handled = tomorrow 09:00 local', next);
    const nextFri = nextScheduledRunAt({ ...nextFull, scheduleDays: [5] }, new Set(), at('2026-10-05', '09:30', 'America/New_York'));
    expect(nextFri?.toISOString() === '2026-10-09T13:00:00.000Z', 'weekday-only schedule: next is Friday', nextFri);
    expect(nextScheduledRunAt({ ...nextFull, sourceType: 'upload' }, new Set()) === null, 'upload automations never run by themselves');
    expect(nextScheduledRunAt({ ...nextFull, enabled: false }, new Set()) === null, 'paused automations have no next run');
  }

  // ── Seed ──────────────────────────────────────────────────────────────────
  const now = new Date();
  const today = dateInTimezone(TZ, now);
  const nowHHMM = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const todayWeekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const stamp = Date.now();

  async function seedBusiness(label: string, marketing = true) {
    const [acct] = await db.insert(schema.businessAccounts).values({
      name: `${label} ${stamp}`, website: 'https://example.com',
      whatsappEnabled: 'true', whatsappMarketingEnabled: marketing ? 'true' : 'false',
    } as any).returning();
    return acct.id as string;
  }
  async function seedTemplate(biz: string, name = 'reminder') {
    const [tpl] = await db.insert(schema.whatsappTemplates).values({
      businessAccountId: biz, name, bodyText: 'Hi {{1}}', paramCount: 1, status: 'approved',
    } as any).returning();
    return tpl;
  }
  async function seedGroup(biz: string, contacts: { phone: string; name: string; loan_id: string; due_date: string }[]) {
    const [group] = await db.insert(schema.contactGroups).values({
      businessAccountId: biz, name: `g-${Math.random()}`, contactCount: contacts.length, defaultCountryCode: '91',
    } as any).returning();
    if (contacts.length) {
      await db.insert(schema.contactGroupContacts).values(contacts.map(c => ({
        businessAccountId: biz, groupId: group.id, phone: c.phone, name: c.name,
        attributes: { loan_id: c.loan_id, due_date: c.due_date },
      })) as any);
    }
    return group;
  }
  async function seedBlueprint(biz: string, templateId: string, groupId: string) {
    const [c] = await db.insert(schema.marketingCampaigns).values({
      businessAccountId: biz, name: `bp-${Math.random()}`, campaignType: 'automation', templateId,
      templateParams: ['{{name}}'], groupIds: [groupId], status: 'draft',
      recipientSourceType: 'contact_groups', recipientPhoneColumn: 'phone',
    } as any).returning();
    return c;
  }
  async function seedAutomation(biz: string, blueprintId: string, templateId: string, extra: Record<string, unknown> = {}) {
    const created = await campaignAutomationService.create(biz, {
      name: `auto-${Math.random()}`, sourceType: 'campaign_blueprint', sourceCampaignId: blueprintId, templateId,
      phoneColumn: 'phone', nameColumn: 'name', recordKeyColumn: 'loan_id', dateColumn: 'due_date',
      dateOffsetDays: 0, sendMode: 'automatic', sendTime: nowHHMM, timezone: TZ, scheduleEnabled: true,
      ...extra,
    } as any);
    // Configured "yesterday", like a real automation that has been live for a while.
    await db.execute(sql`UPDATE whatsapp_campaign_automations
      SET updated_at = NOW() - interval '1 day', schedule_activated_at = CASE WHEN schedule_enabled THEN NOW() - interval '1 day' ELSE NULL END
      WHERE id = ${created.id}`);
    return created;
  }
  const loadAutomation = async (id: string) => (await db.select().from(A).where(eq(A.id, id)))[0];
  const runsOf = async (id: string) => db.select().from(RUNS).where(eq(RUNS.automationId, id));
  const attemptsOf = async (id: string) => db.select().from(ATT).where(eq(ATT.automationId, id));

  const biz = await seedBusiness('Scheduler');
  const tpl = await seedTemplate(biz);
  const group = await seedGroup(biz, [
    { phone: '9800000001', name: 'Asha', loan_id: 'L-1', due_date: today },
    { phone: '9800000002', name: 'Ravi', loan_id: 'L-2', due_date: today },
    { phone: '9800000003', name: 'Meera', loan_id: 'L-3', due_date: addDays(today, 1) },
  ]);
  const blueprint = await seedBlueprint(biz, tpl.id, group.id);

  const due = await seedAutomation(biz, blueprint.id, tpl.id);
  const review = await seedAutomation(biz, blueprint.id, tpl.id, { sendMode: 'review' });
  const wrongDay = await seedAutomation(biz, blueprint.id, tpl.id, { scheduleDays: [(todayWeekday + 3) % 7] });
  const paused = await seedAutomation(biz, blueprint.id, tpl.id, { enabled: false });
  const noSchedule = await seedAutomation(biz, blueprint.id, tpl.id, { scheduleEnabled: false });
  const nobodyDue = await seedAutomation(biz, blueprint.id, tpl.id, { dateOffsetDays: 30 });

  const badTpl = await seedTemplate(biz, 'soon-unapproved');
  const badBlueprint = await seedBlueprint(biz, badTpl.id, group.id);
  const invalid = await seedAutomation(biz, badBlueprint.id, badTpl.id);
  await db.update(schema.whatsappTemplates).set({ status: 'pending' } as any).where(eq(schema.whatsappTemplates.id, badTpl.id));

  const offBiz = await seedBusiness('Marketing off', false);
  const offTpl = await seedTemplate(offBiz);
  const offGroup = await seedGroup(offBiz, [{ phone: '9800000009', name: 'Off', loan_id: 'X-1', due_date: today }]);
  const offBlueprint = await seedBlueprint(offBiz, offTpl.id, offGroup.id);
  const off = await seedAutomation(offBiz, offBlueprint.id, offTpl.id);

  // Upload automations can't be scheduled.
  let uploadError = '';
  try {
    await campaignAutomationService.create(biz, {
      name: 'upload', sourceType: 'upload', templateId: tpl.id, templateParams: ['{{name}}'], phoneColumn: 'phone', nameColumn: 'name',
      recordKeyColumn: 'loan_id', dateColumn: 'due_date', scheduleEnabled: true,
    } as any);
  } catch (e: any) { uploadError = e.message; }
  expect(/saved audience/i.test(uploadError), 'an uploaded-file automation cannot switch on the daily schedule', uploadError);

  const campaignsBefore = (await db.select().from(schema.marketingCampaigns).where(eq(schema.marketingCampaigns.businessAccountId, biz))).length;

  // ── Two concurrent ticks, then a third ("after a restart") ────────────────
  await Promise.all([runAutomationScheduleTick(), runAutomationScheduleTick()]);
  await runAutomationScheduleTick();
  const dueAgain = await runScheduledAutomation(await loadAutomation(due.id), { campaignsEnabled: true });
  expect(dueAgain.action === 'already_handled', 'calling the due automation again the same day is a no-op', dueAgain);

  {
    const runs = await runsOf(due.id);
    const attempts = await attemptsOf(due.id);
    expect(runs.length === 1, 'due automation: exactly one run although the tick ran three times (two concurrently)', runs.length);
    expect(attempts.length === 1 && attempts[0].status === 'created' && attempts[0].outcome === 'scheduled' && attempts[0].runId === runs[0]?.id,
      'one history row, linked to the run, outcome "scheduled"', attempts.map(a => [a.status, a.outcome]));
    expect(runs[0]?.trigger === 'schedule' && runs[0]?.scheduleRunDate === today && runs[0]?.status === 'scheduled' && runs[0]?.eligibleRows === 2,
      'the run is marked as scheduled-trigger for today with the 2 people due today', runs[0] && { t: runs[0].trigger, d: runs[0].scheduleRunDate, s: runs[0].status, n: runs[0].eligibleRows });
    const [camp] = await db.select().from(schema.marketingCampaigns).where(eq(schema.marketingCampaigns.id, runs[0]!.campaignId!));
    expect(camp?.status === 'scheduled' && !!camp.scheduledAt && !camp.startedAt, 'its campaign is scheduled (sending is left to the campaign scheduler)', camp?.status);
    const disp = await db.select().from(DISP).where(eq(DISP.automationId, due.id));
    expect(disp.length === 2, 'record keys reserved once (2 dispatch rows)', disp.length);
    expect(/2 people/.test(attempts[0]?.reason || ''), 'history reason is readable', attempts[0]?.reason);
    // A second run for the same day is refused by the database itself.
    let dupError = '';
    try {
      await db.insert(RUNS).values({ automationId: due.id, businessAccountId: biz, sourceFileName: 'x', trigger: 'schedule', scheduleRunDate: today } as any);
    } catch (e: any) { dupError = String(e?.message || e); }
    expect(/duplicate|unique/i.test(dupError), 'the database rejects a second scheduled run for the same day', dupError);
  }

  {
    const runs = await runsOf(review.id);
    const attempts = await attemptsOf(review.id);
    const disp = await db.select().from(DISP).where(eq(DISP.automationId, review.id));
    expect(runs.length === 1 && runs[0].status === 'awaiting_review' && attempts[0]?.outcome === 'awaiting_review' && disp.length === 0,
      'review mode: one run waiting for approval, nothing reserved or scheduled', { r: runs.map(r => r.status), o: attempts[0]?.outcome, d: disp.length });
  }

  expect((await runsOf(wrongDay.id)).length === 0 && (await attemptsOf(wrongDay.id)).length === 0, 'wrong weekday: no run, no history');
  const early = await loadAutomation(wrongDay.id);
  const earlyResult = await runScheduledAutomation({ ...early, scheduleDays: [] }, {
    campaignsEnabled: true, now: new Date(scheduleWindowFor({ ...early, scheduleDays: [] }).scheduledFor.getTime() - 10 * 60_000),
  });
  expect(earlyResult.action === 'not_due' && (await attemptsOf(wrongDay.id)).length === 0, 'before the send time: not due, nothing claimed', earlyResult);

  expect((await runsOf(paused.id)).length === 0 && (await attemptsOf(paused.id)).length === 0, 'paused automation: skipped entirely');
  expect((await runsOf(noSchedule.id)).length === 0 && (await attemptsOf(noSchedule.id)).length === 0, 'automation without a schedule behaves as before (no automatic run)');

  {
    const attempts = await attemptsOf(nobodyDue.id);
    expect((await runsOf(nobodyDue.id)).length === 0 && attempts[0]?.status === 'skipped' && attempts[0]?.outcome === 'nothing_due' && /Nothing was sent/.test(attempts[0]?.reason || ''),
      'nobody due: skipped with a readable reason, no run', attempts[0]);
  }

  {
    const attempts = await attemptsOf(invalid.id);
    expect((await runsOf(invalid.id)).length === 0, 'validation failure: no run created');
    expect(attempts.length === 1 && attempts[0].status === 'failed' && attempts[0].outcome === 'validation_failed' && /template/i.test(attempts[0].reason || ''),
      'validation failure recorded with the reason', attempts[0]);
  }

  {
    const attempts = await attemptsOf(off.id);
    expect((await runsOf(off.id)).length === 0 && attempts[0]?.status === 'skipped' && attempts[0]?.outcome === 'campaigns_off',
      'campaigns switched off for the business: skipped with a reason', attempts[0]);
  }

  const campaignsAfter = (await db.select().from(schema.marketingCampaigns).where(eq(schema.marketingCampaigns.businessAccountId, biz))).length;
  expect(campaignsAfter - campaignsBefore === 2, 'only the two successful runs created campaigns', campaignsAfter - campaignsBefore);

  // ── Stale claim (process died mid-run) is closed out, not retried ────────
  {
    await db.insert(ATT).values({ automationId: wrongDay.id, businessAccountId: biz, runDate: '2000-01-01', scheduledFor: new Date('2000-01-01T04:30:00Z'), status: 'running' } as any);
    await db.execute(sql`UPDATE whatsapp_campaign_automation_schedule_attempts SET created_at = NOW() - interval '1 hour' WHERE automation_id = ${wrongDay.id} AND run_date = '2000-01-01'`);
    await db.insert(ATT).values({ automationId: nobodyDue.id, businessAccountId: biz, runDate: '2000-01-02', scheduledFor: new Date('2000-01-02T04:30:00Z'), status: 'running' } as any);
    const recovered = await recoverStaleScheduleClaims();
    const rows = await db.select().from(ATT).where(and(eq(ATT.automationId, wrongDay.id), eq(ATT.runDate, '2000-01-01')));
    const fresh = await db.select().from(ATT).where(and(eq(ATT.automationId, nobodyDue.id), eq(ATT.runDate, '2000-01-02')));
    expect(recovered === 1 && rows[0]?.status === 'failed' && rows[0]?.outcome === 'interrupted', 'an old "running" claim becomes "interrupted"', rows[0]);
    expect(fresh[0]?.status === 'running', 'a recent claim is left alone', fresh[0]?.status);
  }

  // ── Schedule API helpers ──────────────────────────────────────────────────
  {
    const sched = await getAutomationSchedule(biz, due.id);
    const tomorrow = zonedDateTimeToUtc(addDays(today, 1), nowHHMM, TZ).toISOString();
    expect(sched?.scheduleEnabled && sched.nextRunAt === tomorrow && sched.history.length === 1, 'schedule overview: next run is tomorrow at the send time', sched?.nextRunAt);
    const turnedOff = await setAutomationSchedule(biz, due.id, { scheduleEnabled: false });
    expect(turnedOff?.scheduleEnabled === false && (await getAutomationSchedule(biz, due.id))?.nextRunAt === null, 'switching the schedule off clears the next run');
    const weekdays = await setAutomationSchedule(biz, due.id, { scheduleEnabled: true, scheduleDays: [1, 2, 3, 4, 5, 9, 'x'] });
    expect(JSON.stringify(weekdays?.scheduleDays) === '[1,2,3,4,5]' && !!weekdays?.scheduleActivatedAt, 'weekday list is cleaned and switching on records when', weekdays?.scheduleDays);
    const everyDay = await setAutomationSchedule(biz, due.id, { scheduleDays: [0, 1, 2, 3, 4, 5, 6] });
    expect(JSON.stringify(everyDay?.scheduleDays) === '[]', 'all seven days is stored as "every day"', everyDay?.scheduleDays);
    expect(automationScheduleTuning.leadMs === 5 * 60_000, 'default lead time is 5 minutes');
  }

  // ── Home summary + dashboard numbers ─────────────────────────────────────
  {
    const ib = await seedBusiness('Insights');
    const itpl = await seedTemplate(ib);
    await db.insert(schema.whatsappTemplates).values({ businessAccountId: ib, name: 'draft', bodyText: 'x', paramCount: 0, status: 'pending' } as any);
    await seedGroup(ib, [{ phone: '9800000101', name: 'A', loan_id: '1', due_date: today }, { phone: '9800000102', name: 'B', loan_id: '2', due_date: today }]);
    await seedGroup(ib, []);

    const empty = await getCampaignHomeSummary(await seedBusiness('Empty'), TZ);
    expect(!empty.steps.audiences.done && !empty.steps.templates.done && !empty.steps.campaigns.done && !empty.steps.replies.done && empty.month.readRate === null && empty.month.messagesSent === 0,
      'empty business: no step done, no rates', empty);

    const t = new Date(Date.now() - 60_000);
    const old = new Date(Date.now() - 40 * 86_400_000);
    const [cA] = await db.insert(schema.marketingCampaigns).values({ businessAccountId: ib, name: 'October offer', templateId: itpl.id, groupIds: [], status: 'completed', startedAt: t } as any).returning();
    const [cB] = await db.insert(schema.marketingCampaigns).values({ businessAccountId: ib, name: 'Old one', templateId: itpl.id, groupIds: [], status: 'completed', startedAt: old } as any).returning();
    await db.insert(schema.marketingCampaigns).values({ businessAccountId: ib, name: 'Draft', templateId: itpl.id, groupIds: [], status: 'draft' } as any);
    const R = schema.marketingCampaignRecipients;
    await db.insert(R).values([
      { campaignId: cA.id, businessAccountId: ib, phone: '1', status: 'replied', msg91MessageId: 'm1', sentAt: t, deliveredAt: t, readAt: t, firstReplyAt: t, replyCount: 1, primaryClassification: 'INTERESTED' },
      { campaignId: cA.id, businessAccountId: ib, phone: '2', status: 'delivered', msg91MessageId: 'm2', sentAt: t, deliveredAt: t },
      { campaignId: cA.id, businessAccountId: ib, phone: '3', status: 'opted_out', msg91MessageId: 'm3', sentAt: t },
      { campaignId: cA.id, businessAccountId: ib, phone: '4', status: 'failed', errorMessage: 'bad number' },
      { campaignId: cA.id, businessAccountId: ib, phone: '5', status: 'pending' },
      { campaignId: cB.id, businessAccountId: ib, phone: '6', status: 'read', msg91MessageId: 'm6', sentAt: old, deliveredAt: old, readAt: old },
    ] as any);

    const home = await getCampaignHomeSummary(ib, TZ);
    expect(home.steps.audiences.done && home.steps.audiences.count === 1 && home.steps.audiences.total === 2, 'home: audiences step done (1 with contacts of 2)', home.steps.audiences);
    expect(home.steps.templates.done && home.steps.templates.count === 1 && home.steps.templates.total === 2, 'home: templates step done (1 approved of 2)', home.steps.templates);
    expect(home.steps.campaigns.done && home.steps.campaigns.count === 2, 'home: 2 campaigns sent (draft not counted)', home.steps.campaigns);
    expect(home.steps.replies.done && home.steps.replies.count === 1, 'home: replies step done', home.steps.replies);
    expect(home.month.campaigns === 1 && home.month.messagesSent === 3 && home.month.read === 1 && home.month.readRate === 33.3 && home.month.replies === 1,
      'home: this month = 1 campaign, 3 sent, read rate 33.3%, 1 reply', home.month);
    expect(!('cost' in home) && !JSON.stringify(home).match(/cost|token/i), 'home summary has no cost / AI-usage fields');

    const dash = await getCampaignInsights(ib, { tz: TZ });
    expect(dash.totals.sent === 3 && dash.totals.delivered === 2 && dash.totals.read === 1 && dash.totals.replied === 1 && dash.totals.interested === 1 && dash.totals.optedOut === 1,
      'dashboard (last 30 days): 3 sent, 2 delivered, 1 read, 1 replied, 1 interested, 1 opted out', dash.totals);
    expect(dash.campaigns.length === 1 && dash.campaigns[0].name === 'October offer' && dash.campaigns[0].sent === 3 && dash.campaigns[0].readRate === 33.3,
      'dashboard table: only the campaign with messages in range', dash.campaigns);
    expect(dash.daily.length === 30 && dash.range.to === today, 'dashboard trend covers 30 days ending today', { n: dash.daily.length, to: dash.range.to });
    const sentDay = dateInTimezone(TZ, t);
    const day = dash.daily.find(d => d.date === sentDay);
    expect(day?.sent === 3 && day?.read === 1 && day?.replied === 1, 'dashboard trend: the day of sending shows 3 sent, 1 read, 1 reply', day);
    expect(dash.daily.reduce((s, d) => s + d.sent, 0) === 3, 'trend sums match the totals');
    const wide = await getCampaignInsights(ib, { tz: TZ, from: addDays(today, -60), to: today });
    expect(wide.totals.sent === 4 && wide.campaigns.length === 2 && wide.totals.read === 2, 'wider range picks up the older campaign', wide.totals);
    const swapped = await getCampaignInsights(ib, { tz: TZ, from: today, to: addDays(today, -60) });
    expect(swapped.range.from === addDays(today, -60) && swapped.totals.sent === 4, 'reversed dates are swapped');
    const other = await getCampaignInsights(biz, { tz: TZ });
    expect(other.totals.sent === 0, 'another business sees none of these numbers', other.totals);
    expect(!JSON.stringify(dash).match(/cost|token/i), 'dashboard has no cost / AI-usage fields');
  }

  expect(providerCalls === 0, 'no WhatsApp provider was contacted', providerCalls);

  globalThis.fetch = realFetch;
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll campaign automation scheduler checks passed');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
