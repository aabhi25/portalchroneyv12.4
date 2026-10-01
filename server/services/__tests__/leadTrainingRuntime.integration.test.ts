/**
 * Website-chat Smart Lead Training, end to end through the real chatService (streaming and
 * non-streaming) against a local Postgres/PGlite and a scriptable fake OpenAI that records the
 * exact prompt the model sees. Covers: per-field timing × mandatory/optional × saved/said/neither,
 * priority across mixed strategies, per-field customAskAfter, message count surviving a restart,
 * optional decline, mandatory refusal cap, keyword word boundaries, the phone-number gate, the
 * structured capture_lead result, Hindi name capture, CRM sync timing (+ update path), one lead row
 * under concurrent writes, returning visitors, OTP strict mode, custom-instruction precedence,
 * Mobile+WhatsApp, and per-visitor history isolation.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55491/postgres?sslmode=disable \
 *   LEAD_RUNTIME_TEST_DB=1 DB_POOL_MAX=1 npx tsx server/services/__tests__/leadTrainingRuntime.integration.test.ts
 * The process runs in UTC like the production servers (raw-SQL timestamp comparisons in
 * findReusableConversation assume it).
 */
process.env.TZ = 'UTC';
import crypto from 'crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const url = process.env.DATABASE_URL || '';
if (process.env.LEAD_RUNTIME_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set LEAD_RUNTIME_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.OPENAI_API_KEY = 'sk-test-fake';
delete process.env.CHAT_CONTEXT_MODE;

let failed = 0;
let passed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 700)}` : ''}`); }
  else { passed++; console.log(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn: () => Promise<boolean> | boolean, ms = 4000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(50); }
  return !!(await fn());
}
const rnd = () => crypto.randomBytes(4).toString('hex');

async function main() {
  const { startFakeOpenAILead, textOf } = await import('./helpers/fakeOpenAILead');
  const fake = await startFakeOpenAILead();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  // Fake LeadSquared (API connection, custom host) — every create/update is recorded.
  const lsq = { creates: [] as any[], updates: [] as Array<{ leadId: string; body: any }>, n: 0 };
  const lsqServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      res.setHeader('content-type', 'application/json');
      if (req.url?.includes('Lead.Capture')) {
        lsq.creates.push(body);
        res.end(JSON.stringify({ Status: 'Success', Message: { Id: `LSQ-${++lsq.n}` } }));
      } else if (req.url?.includes('Lead.Update')) {
        lsq.updates.push({ leadId: new URL(`http://x${req.url}`).searchParams.get('leadId') || '', body });
        res.end(JSON.stringify({ Status: 'Success', Message: { AffectedRows: 1 } }));
      } else { res.writeHead(404); res.end('{}'); }
    });
  });
  await new Promise<void>(r => lsqServer.listen(0, '127.0.0.1', r));
  const lsqPort = (lsqServer.address() as AddressInfo).port;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname === 'lsq.test.example') return realFetch(`http://127.0.0.1:${lsqPort}${u.pathname}${u.search}`, init);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') throw new Error(`test attempted a real network call to ${u.hostname}`);
    return realFetch(input, init);
  }) as typeof fetch;

  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq } = await import('drizzle-orm');
  const { chatService } = await import('../../chatService');
  const { encrypt } = await import('../encryptionService');
  const lc = await import('../leadCapture');

  // LEAD_RUNTIME_ONLY=1,7 runs just those sections (debugging).
  const ONLY = (process.env.LEAD_RUNTIME_ONLY || '').split(',').filter(Boolean);
  const run = (n: number) => !ONLY.length || ONLY.includes(String(n));

  type Biz = { id: string; customInstructions?: string };
  async function seedBiz(fields: any[], extra: Record<string, any> = {}, customInstructions?: string): Promise<Biz> {
    const [biz] = await db.insert(schema.businessAccounts).values({ name: `Lead Co ${rnd()}`, website: 'https://lead.example', openaiApiKey: 'sk-test-fake' }).returning();
    await db.insert(schema.widgetSettings).values({
      businessAccountId: biz.id,
      leadTrainingConfig: { fields, captureStrategy: 'custom' },
      ...(customInstructions ? { customInstructions } : {}),
      ...extra,
    } as any);
    return { id: biz.id, customInstructions };
  }
  const field = (o: any) => ({ enabled: true, required: false, priority: 1, captureStrategy: 'start', ...o });
  const visitor = () => ({ session: `s_${rnd()}`, token: `t_${rnd()}` });
  async function say(biz: Biz, v: { session: string; token: string }, message: string) {
    const before = fake.calls.length;
    const events: any[] = [];
    for await (const ev of chatService.streamMessage(message, {
      userId: `widget_session_${v.session}`, businessAccountId: biz.id, openaiApiKey: 'sk-test-fake', channel: 'widget',
      visitorToken: v.token, personality: 'friendly', responseLength: 'balanced', customInstructions: biz.customInstructions,
    } as any)) events.push(ev);
    const calls = fake.calls.slice(before);
    const main = calls.find(c => c.purpose === 'main');
    const cont = calls.find(c => c.purpose === 'continuation');
    const finalEv = events.filter(e => e.type === 'final').pop();
    const text = finalEv ? finalEv.data : events.filter(e => e.type === 'content').map(e => e.data).join('');
    const convId = events.find(e => e.type === 'conversation_id')?.data as string;
    const err = events.find(e => e.type === 'error');
    if (err) console.error('STREAM ERROR', err.data);
    return { events, calls, main, cont, rules: main?.finalRules || '', text, convId };
  }
  const leadsOf = (convId: string) => db.select().from(schema.leads).where(eq(schema.leads.conversationId, convId));
  const nowLine = (rules: string) => (rules.match(/^NOW: (.*)$/m) || [])[1] || '';

  // ═════════ 1. Custom timing per field + message count survives a restart (items 6, 7, 11) ═════════
  if (run(1)) {
    const biz = await seedBiz([
      field({ id: 'name', required: true, priority: 1, captureStrategy: 'custom', customAskAfter: 3 }),
      field({ id: 'mobile', required: true, priority: 2, captureStrategy: 'custom', customAskAfter: 4, phoneValidation: '10' }),
      field({ id: 'email', enabled: false }), field({ id: 'whatsapp', enabled: false }),
    ]);
    const v = visitor();
    const r1 = await say(biz, v, 'hi there, what courses do you offer?');
    expect(/LEAD COLLECTION \(THIS TURN\)/.test(r1.rules) && /no contact detail is due/.test(nowLine(r1.rules)), 'msg #1: lead block reaches the model; nothing due yet', nowLine(r1.rules));
    const r2 = await say(biz, v, 'tell me about the MBA program');
    expect(/no contact detail is due/.test(nowLine(r2.rules)), 'msg #2: still nothing due (name asks at #3)');
    // simulate a restart / other instance: in-memory history + active conversation cache are gone
    chatService.clearConversation(`widget_session_${v.session}`, biz.id);
    const r3 = await say(biz, v, 'what are the fees?');
    expect(r3.convId === r1.convId, 'after the restart the same conversation is resumed', { r1: r1.convId, r3: r3.convId });
    const sentHistory = (r3.main?.messages || []).map(m => textOf(m.content)).join('\n');
    expect(sentHistory.includes('tell me about the MBA program'), 'history was reloaded from the DB for the model');
    expect(/^MANDATORY/.test(nowLine(r3.rules)) && /their name/.test(nowLine(r3.rules)), 'msg #3 (counted in the DB): name is asked, blocking', nowLine(r3.rules));
    expect(/may I have your name/i.test(r3.text), 'reply asks for the name', r3.text);
    const r4 = await say(biz, v, 'Rahul Verma');
    const [lead4] = await leadsOf(r1.convId);
    expect(lead4?.name === 'Rahul Verma', 'bare name after the ask is saved', lead4?.name);
    expect(/^MANDATORY/.test(nowLine(r4.rules)) && /mobile number/.test(nowLine(r4.rules)), 'msg #4: mobile (its own customAskAfter=4) is next', nowLine(r4.rules));
    const r5 = await say(biz, v, '+91 98450 12345');
    const [lead5] = await leadsOf(r1.convId);
    expect(lead5?.phone === '9845012345', '+91 number saved as the 10-digit national number', lead5?.phone);
    expect(/Already have — NEVER ask for these again: name \(Rahul Verma\), mobile number/.test(r5.rules) && /no contact detail is due/.test(nowLine(r5.rules)), 'msg #5: both known, nothing to ask', nowLine(r5.rules));
  }

  // ═════════ 2. Matrix: timing × mandatory/optional × saved/said/neither ═════════
  if (run(2)) {
    const strategies: Array<{ label: string; cfg: any; pre: string[]; trigger: string }> = [
      { label: 'start', cfg: { captureStrategy: 'start' }, pre: [], trigger: 'what are the fees?' },
      { label: 'custom#2', cfg: { captureStrategy: 'custom', customAskAfter: 2 }, pre: ['hello, which courses do you have?'], trigger: 'what are the fees?' },
      { label: 'keyword', cfg: { captureStrategy: 'keyword', captureKeywords: ['fees'] }, pre: ['hello, which courses do you have?'], trigger: 'what are the fees?' },
    ];
    for (const s of strategies) {
      for (const required of [true, false]) {
        for (const known of ['neither', 'said', 'saved'] as const) {
          const biz = await seedBiz([field({ id: 'name', required, priority: 1, ...s.cfg })]);
          const v = visitor();
          let convId = '';
          if (known === 'said') convId = (await say(biz, v, 'hi, my name is Kavya')).convId;
          for (const m of s.pre) convId = (await say(biz, v, m)).convId;
          if (known === 'saved') {
            if (!convId) convId = (await say(biz, v, 'hello')).convId;
            await lc.upsertConversationLead({ businessAccountId: biz.id, conversationId: convId, values: { name: 'Kavya' } });
          }
          if (s.label === 'start' && known === 'neither') { /* trigger is message #1 */ }
          const r = await say(biz, v, s.trigger);
          const now = nowLine(r.rules);
          const tag = `${s.label} ${required ? 'mandatory' : 'optional'} ${known}`;
          if (known === 'neither') {
            const ok = required ? /^MANDATORY/.test(now) && /their name/.test(now) : /^Answer the visitor's message fully first/.test(now) && /their name/.test(now);
            expect(ok, `${tag}: asked ${required ? 'before answering' : 'after answering'}`, now);
          } else {
            expect(/no contact detail is due/.test(now) && /Already have/.test(r.rules), `${tag}: not asked again`, now);
          }
        }
      }
    }
  }

  // ═════════ 3. Priority across mixed strategies; mandatory intent stays pending (item 5) ═════════
  if (run(3)) {
    const biz = await seedBiz([
      field({ id: 'name', required: true, priority: 1, captureStrategy: 'intent', intentIntensity: 'medium' }),
      field({ id: 'mobile', required: true, priority: 2, captureStrategy: 'start' }),
    ]);
    const v = visitor();
    const r1 = await say(biz, v, 'hello');
    expect(/mobile number/.test(nowLine(r1.rules)) && /INTENT CHECK:.*their name BEFORE answering/.test(r1.rules), 'start mobile due now; intent name offered as a conditional (priority 1)', r1.rules.slice(r1.rules.indexOf('=== LEAD')));
    expect(!/Collect required contact info FIRST/.test(r1.rules), 'no generic "collect required contact info first" line');
    const leadBlocks = (r1.rules.match(/=== LEAD COLLECTION/g) || []).length;
    expect(leadBlocks === 1, 'exactly one lead-collection block in the final rules', leadBlocks);
    await say(biz, v, '98450 12345');
    fake.script = (call) => call.purpose === 'main' ? { content: 'Great question! Before I share the fees, may I have your name?' } : null;
    const r3 = await say(biz, v, 'what are the fees?');
    fake.script = null;
    expect(/INTENT CHECK/.test(r3.rules), 'msg with pricing intent: intent check present');
    const r4 = await say(biz, v, 'tell me more about the campus');
    expect(/^MANDATORY/.test(nowLine(r4.rules)) && /their name/.test(nowLine(r4.rules)), 'once asked, the mandatory intent field stays pending', nowLine(r4.rules));
  }

  // ═════════ 4. Optional At Start after mandatory; optional declined once → never again (items 8, 9a) ═════════
  if (run(4)) {
    const biz = await seedBiz([
      field({ id: 'name', required: true, priority: 1, captureStrategy: 'start' }),
      field({ id: 'email', required: false, priority: 2, captureStrategy: 'start' }),
    ]);
    const v = visitor();
    const r1 = await say(biz, v, 'what courses do you have?');
    expect(/their name/.test(nowLine(r1.rules)) && /^MANDATORY/.test(nowLine(r1.rules)), 'mandatory At Start name first');
    const r2 = await say(biz, v, 'Asha');
    expect(/email address/.test(nowLine(r2.rules)) && /^Answer the visitor's message fully first/.test(nowLine(r2.rules)), 'then the optional At Start email, after answering (message #2)', nowLine(r2.rules));
    const r3 = await say(biz, v, 'no thanks');
    expect(/Do NOT ask for: email address \(visitor declined\)/.test(r3.rules) && /just declined/.test(r3.rules), 'declined optional email → "do not ask" + acknowledge', r3.rules.slice(r3.rules.indexOf('=== LEAD')));
    const r4 = await say(biz, v, 'what about hostel facilities?');
    expect(/no contact detail is due/.test(nowLine(r4.rules)), '…and never asked again');
    expect(!/email/i.test(r4.text), 'reply does not ask for the email', r4.text);
  }

  // ═════════ 5. Mandatory refusals capped at 2 (item 9b) ═════════
  if (run(5)) {
    const biz = await seedBiz([field({ id: 'mobile', required: true, priority: 1, captureStrategy: 'start' })]);
    const v = visitor();
    const r1 = await say(biz, v, 'what are the fees?');
    expect(/^MANDATORY/.test(nowLine(r1.rules)), 'mandatory mobile blocks at first');
    const r2 = await say(biz, v, "no, I don't want to share my number");
    expect(/^MANDATORY/.test(nowLine(r2.rules)) && /held back 1 time/.test(nowLine(r2.rules)), '1st refusal → re-ask once with a reason', nowLine(r2.rules));
    const r3 = await say(biz, v, 'nahi');
    expect(!/^MANDATORY/.test(nowLine(r3.rules)) && !/CONTACT DETAIL FIRST/.test(r3.rules), '2nd refusal → stops blocking, answers', nowLine(r3.rules));
    const r4 = await say(biz, v, 'what about placements?');
    expect(/ONE more time/.test(nowLine(r4.rules)), 're-asked once more later, after answering', nowLine(r4.rules));
    await say(biz, v, 'no');
    const r6 = await say(biz, v, 'and the duration?');
    const r7 = await say(biz, v, 'ok thanks');
    expect(/no contact detail is due/.test(nowLine(r6.rules)) && /no contact detail is due/.test(nowLine(r7.rules)), 'never nagged again', [nowLine(r6.rules), nowLine(r7.rules)]);
  }

  // ═════════ 6. Keywords: whole words, multi-word, Hindi; mandatory stays pending (item 10) ═════════
  if (run(6)) {
    const biz = await seedBiz([field({ id: 'mobile', required: true, priority: 1, captureStrategy: 'keyword', captureKeywords: ['price', 'admission process', 'फीस'] })]);
    const cases: Array<[string, boolean]> = [['is it priceless?', false], ['price?', true], ['explain the Admission   Process', true], ['फीस कितनी है?', true], ['I love the pricing page', false]];
    for (const [msg, due] of cases) {
      const r = await say(biz, visitor(), msg);
      expect(due ? /^MANDATORY/.test(nowLine(r.rules)) : /no contact detail is due/.test(nowLine(r.rules)), `keyword "${msg}" → ${due ? 'ask' : 'no ask'}`, nowLine(r.rules));
    }
    const v = visitor();
    await say(biz, v, 'what is the price?');
    const r2 = await say(biz, v, 'and the duration?');
    expect(/^MANDATORY/.test(nowLine(r2.rules)), 'mandatory keyword field stays pending on the next message');
  }

  // ═════════ 7. Phone gate: dates / budgets / ids never trigger "invalid number" (items 1, 2) ═════════
  if (run(7)) {
    const biz = await seedBiz([field({ id: 'mobile', required: true, priority: 1, captureStrategy: 'custom', customAskAfter: 9, phoneValidation: '10' })]);
    for (const m of ['I want to join on 15-10-2026', 'my budget is 1500000', 'order id 123456789 status?', 'fees 250000/- ok?']) {
      const r = await say(biz, visitor(), m);
      expect(!/PHONE NUMBER NOT VALID/.test(r.rules) && !/not be correct|doesn't look right/i.test(r.text), `no "invalid number" for "${m}"`, r.text);
    }
    const bad = await say(biz, visitor(), 'my number is 98450 1234');
    expect(/PHONE NUMBER NOT VALID/.test(bad.rules), '9-digit number after "my number is" → rejected for the model');
    expect(/re-enter their mobile number/.test(nowLine(bad.rules)), '…and re-entering it is the only ask of that reply', nowLine(bad.rules));
    const v = visitor();
    const good = await say(biz, v, 'my mobile is +91 98450 12345');
    const [lead] = await leadsOf(good.convId);
    expect(!/PHONE NUMBER NOT VALID/.test(good.rules) && lead?.phone === '9845012345', '+91 number accepted and stored as 9845012345', lead?.phone);
    const noPhoneBiz = await seedBiz([field({ id: 'name', required: true, priority: 1, captureStrategy: 'custom', customAskAfter: 5 })]);
    const r = await say(noPhoneBiz, visitor(), 'my number is 98450 1234');
    expect(!/PHONE NUMBER NOT VALID/.test(r.rules), 'no phone field enabled → never');
  }

  // ═════════ 8. capture_lead: structured result, junk rejected, never two fields (item 4) ═════════
  if (run(8)) {
    const biz = await seedBiz([
      field({ id: 'name', required: true, priority: 1, captureStrategy: 'start' }),
      field({ id: 'mobile', required: true, priority: 2, captureStrategy: 'start' }),
      field({ id: 'email', required: false, priority: 3, captureStrategy: 'custom', customAskAfter: 9 }),
    ]);
    const v = visitor();
    fake.script = (call) => call.purpose === 'main' ? { toolCalls: [{ name: 'capture_lead', args: { name: 'ok', email: 'bad@', phone: '12345' } }] } : null;
    const r1 = await say(biz, v, 'ok bad@ 12345');
    fake.script = null;
    expect((await leadsOf(r1.convId)).length === 0, 'junk name / invalid email / short phone → nothing saved');
    const tool1 = r1.cont?.messages.find(m => m.role === 'tool');
    const t1 = textOf(tool1?.content);
    expect(/"saved":\[\]/.test(t1) && /"rejected":\[/.test(t1) && !/answer their original question/.test(t1) && !/saved successfully/i.test(t1), 'rejected-only result: no "saved successfully", no "answer the original question"', t1);
    fake.script = (call) => call.purpose === 'main' ? { toolCalls: [{ name: 'capture_lead', args: { name: 'Priya Shah', phone: '98450 1234' } }] } : null;
    const r2 = await say(biz, v, 'I am Priya Shah, 98450 1234, what are the fees?');
    fake.script = null;
    const [l2] = await leadsOf(r1.convId);
    const t2 = textOf(r2.cont?.messages.find(m => m.role === 'tool')?.content);
    expect(l2?.name === 'Priya Shah' && !l2?.phone, 'valid name saved, invalid phone not saved', { name: l2?.name, phone: l2?.phone });
    expect(/re-enter only their mobile number/.test(t2) && !/answer their original question/.test(t2), 'instruction: re-enter only the mobile number', t2);
    expect(!/May I also have/.test(t2) && !/phone number and/.test(t2), 'no canned multi-field question', t2);
    expect(/re-enter your mobile number/i.test(r2.text), 'reply asks to re-enter the number', r2.text);
    fake.script = (call) => call.purpose === 'main' ? { toolCalls: [{ name: 'capture_lead', args: { phone: '+91 98450 12345' } }] } : null;
    const r3 = await say(biz, v, '+91 98450 12345');
    fake.script = null;
    const [l3] = await leadsOf(r1.convId);
    const t3 = textOf(r3.cont?.messages.find(m => m.role === 'tool')?.content);
    expect(l3?.phone === '9845012345' && /"allRequiredFieldsCollected":true/.test(t3), 'valid number saved; all mandatory collected', t3);
    expect((t3.match(/Next detail allowed now/g) || []).length <= 1, 'at most one next field');
    expect(/Already have — NEVER ask for these again: name \(Priya Shah\), mobile number/.test(r3.cont?.finalRules || ''), 'continuation gets the re-planned lead block');
  }

  // ═════════ 9. Hindi / Hinglish name capture (item 13) ═════════
  if (run(9)) {
    const biz = await seedBiz([field({ id: 'name', required: true, priority: 1, captureStrategy: 'custom', customAskAfter: 2 })]);
    const v = visitor();
    await say(biz, v, 'namaste');
    fake.script = (call) => call.purpose === 'main' ? { content: 'Zaroor! Fees batane se pehle, aapka naam kya hai?' } : null;
    await say(biz, v, 'fees kitni hai?');
    fake.script = null;
    const r3 = await say(biz, v, 'mera naam Rahul hai');
    const [lead] = await leadsOf(r3.convId);
    expect(lead?.name === 'Rahul', '"mera naam Rahul hai" saved as Rahul', lead?.name);
    expect((r3.main?.tools || []).some((t: any) => t.function?.name === 'capture_lead') || !!lead?.name, 'capture_lead offered while a field is missing');
    const v2 = visitor();
    await say(biz, v2, 'hello');
    fake.script = (call) => call.purpose === 'main' ? { content: 'Aapka naam kya hai?' } : null;
    await say(biz, v2, 'course details batao');
    fake.script = null;
    const rb = await say(biz, v2, 'Rahul');
    const [lb] = await leadsOf(rb.convId);
    expect(lb?.name === 'Rahul', 'bare "Rahul" after "Aapka naam kya hai?" saved', lb?.name);
    const v3 = visitor();
    const tools = (await say(biz, v3, 'main Kiran hoon')).main?.tools || [];
    expect(tools.some((t: any) => t.function?.name === 'capture_lead'), '"main Kiran hoon" → capture_lead offered');
  }

  // ═════════ 10. CRM: sync only after mandatory fields; updates afterwards (item 14b) ═════════
  if (run(10)) {
    const lsqSettings = {
      leadsquaredEnabled: 'true', leadsquaredConnectionType: 'api', leadsquaredAccessKey: 'ak', leadsquaredSecretKey: encrypt('sk'),
      leadsquaredRegion: 'other', leadsquaredCustomHost: 'https://lsq.test.example',
    };
    const biz = await seedBiz([
      field({ id: 'name', required: true, priority: 1, captureStrategy: 'start' }),
      field({ id: 'mobile', required: true, priority: 2, captureStrategy: 'start' }),
      field({ id: 'email', required: false, priority: 3, captureStrategy: 'custom', customAskAfter: 9 }),
    ], lsqSettings);
    for (const [i, [f, src]] of ([['FirstName', 'lead.name'], ['Phone', 'lead.phone'], ['EmailAddress', 'lead.email']] as const).entries()) {
      await db.insert(schema.leadsquaredFieldMappings).values({ businessAccountId: biz.id, leadsquaredField: f, sourceType: 'dynamic', sourceField: src, displayName: f, sortOrder: i } as any);
    }
    const startCreates = lsq.creates.length, startUpdates = lsq.updates.length;
    const v = visitor();
    const r1 = await say(biz, v, 'my number is 9845012345');
    await sleep(400);
    expect(lsq.creates.length === startCreates, 'phone only (name mandatory missing) → not sent to the CRM', lsq.creates.length - startCreates);
    await say(biz, v, 'Rahul');
    const created = await waitFor(() => lsq.creates.length === startCreates + 1);
    expect(created, 'name completes the mandatory fields → exactly one CRM create', lsq.creates.length - startCreates);
    expect(await waitFor(async () => (await leadsOf(r1.convId))[0]?.leadsquaredLeadId === `LSQ-${lsq.n}`), 'CRM lead id stored');
    await say(biz, v, 'my email is rahul@example.com');
    const updated = await waitFor(() => lsq.updates.length === startUpdates + 1);
    expect(updated && lsq.updates[lsq.updates.length - 1].leadId === `LSQ-${lsq.n}` && lsq.creates.length === startCreates + 1, 'later field → CRM update path, no second create', { creates: lsq.creates.length - startCreates, updates: lsq.updates.length - startUpdates });
    const noMandatory = await seedBiz([field({ id: 'name', required: false, priority: 1 }), field({ id: 'mobile', required: false, priority: 2 })], lsqSettings);
    for (const [i, [f, src]] of ([['FirstName', 'lead.name'], ['Phone', 'lead.phone']] as const).entries()) {
      await db.insert(schema.leadsquaredFieldMappings).values({ businessAccountId: noMandatory.id, leadsquaredField: f, sourceType: 'dynamic', sourceField: src, displayName: f, sortOrder: i } as any);
    }
    const before = lsq.creates.length;
    await say(noMandatory, visitor(), 'call me on 9845012345');
    expect(await waitFor(() => lsq.creates.length === before + 1), 'no mandatory fields → synced on first contact info (unchanged behaviour)');
  }

  // ═════════ 11. One lead row under concurrent auto-capture + capture_lead (item 14a) ═════════
  if (run(11)) {
    const biz = await seedBiz([field({ id: 'name', required: true, priority: 1 }), field({ id: 'mobile', required: true, priority: 2 }), field({ id: 'email', required: false, priority: 3 })]);
    const v = visitor();
    fake.script = (call) => call.purpose === 'main' ? { toolCalls: [{ name: 'capture_lead', args: { name: 'Asha Rao', phone: '9845012345', email: 'asha@example.com' } }] } : null;
    const r = await say(biz, v, 'hi I am Asha Rao, my number is 9845012345 and email asha@example.com');
    fake.script = null;
    expect((await leadsOf(r.convId)).length === 1, 'auto-capture + capture_lead in one turn → one lead row');
    const [conv] = await db.insert(schema.conversations).values({ businessAccountId: biz.id, title: 'x', visitorToken: `t_${rnd()}` }).returning();
    await Promise.all([
      lc.upsertConversationLead({ businessAccountId: biz.id, conversationId: conv.id, values: { name: 'Neha' } }),
      lc.upsertConversationLead({ businessAccountId: biz.id, conversationId: conv.id, values: { phone: '9845012345' } }),
      lc.upsertConversationLead({ businessAccountId: biz.id, conversationId: conv.id, values: { email: 'neha@example.com' } }),
      lc.upsertConversationLead({ businessAccountId: biz.id, conversationId: conv.id, values: { name: 'Neha', phone: '9845012345' } }),
      (chatService as any).autoDetectAndCaptureLead('my number is 9845012345', conv.id, biz.id, undefined, undefined, undefined, undefined, 'widget'),
    ]);
    const rows = await leadsOf(conv.id);
    expect(rows.length === 1 && rows[0].name === 'Neha' && rows[0].phone === '9845012345' && rows[0].email === 'neha@example.com', '5 concurrent writes → one merged lead row', rows.map(r => ({ n: r.name, p: r.phone, e: r.email })));
  }

  // ═════════ 12. Returning visitor reuses their lead (item 14c) ═════════
  if (run(12)) {
    const biz = await seedBiz([field({ id: 'name', required: true, priority: 1 }), field({ id: 'email', required: false, priority: 2 })]);
    const token = `t_${rnd()}`;
    const [a] = await db.insert(schema.conversations).values({ businessAccountId: biz.id, title: 'a', visitorToken: token }).returning();
    const first = await lc.upsertConversationLead({ businessAccountId: biz.id, conversationId: a.id, values: { name: 'Meera', phone: '9845012345' } });
    const [b] = await db.insert(schema.conversations).values({ businessAccountId: biz.id, title: 'b', visitorToken: token }).returning();
    const second = await lc.upsertConversationLead({ businessAccountId: biz.id, conversationId: b.id, values: { email: 'meera@example.com' } });
    expect(second.lead.id === first.lead.id && second.lead.conversationId === b.id && second.reusedFromConversationId === a.id, 'same visitor, new conversation → same lead row (moved to the new conversation)');
    const [c] = await db.insert(schema.conversations).values({ businessAccountId: biz.id, title: 'c', visitorToken: token }).returning();
    const third = await lc.upsertConversationLead({ businessAccountId: biz.id, conversationId: c.id, values: { phone: '9123456780' } });
    expect(third.created && third.lead.id !== first.lead.id, 'different phone on the same device → a new lead (no merge of different people)');
  }

  // ═════════ 13. OTP pending → strict mode reaches the model, no lead asks (items 11, 17) ═════════
  if (run(13)) {
    const biz = await seedBiz([
      field({ id: 'mobile', required: true, priority: 1, captureStrategy: 'custom', customAskAfter: 1, otpEnabled: true, otpDemoMode: true }),
      field({ id: 'name', required: true, priority: 2, captureStrategy: 'start' }),
    ], {}, JSON.stringify([{ type: 'always', text: 'Always greet the visitor warmly and talk about our scholarships.' }]));
    const v = visitor();
    const r1 = await say(biz, v, 'hello');
    // A code is pending for this conversation (what OtpService.issueChallenge leaves behind; issued
    // directly here because the issuing transaction needs a pool > 1, which PGlite can't serve).
    await db.insert(schema.phoneOtpChallenges).values({
      businessAccountId: biz.id, conversationId: r1.convId, phoneE164: '+919845012345', codeHash: 'x', deliveryChannel: 'sms',
      lastSentAt: new Date(), expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    } as any);
    expect(/LEAD COLLECTION \(THIS TURN\)/.test(r1.rules), 'before the code: normal lead block');
    const r2 = await say(biz, v, 'what scholarships do you have?');
    const rules = r2.rules;
    expect(/OTP VERIFICATION IN PROGRESS — STRICT MODE/.test(rules), 'OTP strict mode is in the final rules');
    expect(!/LEAD COLLECTION \(THIS TURN\)/.test(rules), 'no lead-collection asks while OTP is pending');
    expect(rules.lastIndexOf('OTP VERIFICATION IN PROGRESS') > rules.lastIndexOf('BUSINESS CUSTOM INSTRUCTIONS'), 'OTP block comes after the business instructions (last)');
    expect(/6-digit code/.test(r2.text), 'reply only asks for the code', r2.text);
  }

  // ═════════ 14. Custom instruction "always ask for phone" vs phone already saved (item 12) ═════════
  if (run(14)) {
    const biz = await seedBiz([field({ id: 'mobile', required: true, priority: 1, captureStrategy: 'start' })], {},
      JSON.stringify([{ type: 'always', text: "Always ask for the visitor's phone number." }]));
    const v = visitor();
    await say(biz, v, 'hi, my number is 9845012345');
    const r = await say(biz, v, 'what are the fees?');
    const idxCustom = r.rules.indexOf('BUSINESS CUSTOM INSTRUCTIONS');
    const idxLead = r.rules.lastIndexOf('=== LEAD COLLECTION');
    expect(idxCustom >= 0 && idxLead > idxCustom, 'lead block comes after the custom instructions', { idxCustom, idxLead });
    expect(/Already have — NEVER ask for these again: mobile number/.test(r.rules) && /takes precedence over any business instruction/.test(r.rules), '"already have" facts explicitly override "always ask for phone"');
    expect(/no contact detail is due/.test(nowLine(r.rules)) && !/phone|mobile/i.test(r.text), 'no re-ask instruction / no re-ask', r.text);
  }

  // ═════════ 15. Mobile + WhatsApp both enabled (item 15) ═════════
  if (run(15)) {
    const biz = await seedBiz([field({ id: 'mobile', required: true, priority: 1 }), field({ id: 'whatsapp', required: false, priority: 2 })]);
    const v = visitor();
    await say(biz, v, 'hello');
    const r2 = await say(biz, v, '9845012345');
    expect(/also on WhatsApp/.test(nowLine(r2.rules)), 'mobile saved → ask once whether it is also on WhatsApp', nowLine(r2.rules));
    const r3 = await say(biz, v, 'yes');
    expect(/Already have — NEVER ask for these again: mobile number, WhatsApp number/.test(r3.rules), '"yes" → WhatsApp satisfied (state), not asked again', r3.rules.slice(r3.rules.indexOf('=== LEAD')));
    const st = await lc.loadLeadCaptureState(r3.convId);
    expect(st.whatsapp?.sameAsMobile === true, 'stored in conversations.lead_capture_state', st.whatsapp);
  }

  // ═════════ 16. History isolation between two visitors of the same business (item 16) ═════════
  if (run(16)) {
    const biz = await seedBiz([field({ id: 'name', required: false, priority: 1, captureStrategy: 'custom', customAskAfter: 9 })]);
    const ctx = (userId: string) => ({ userId, businessAccountId: biz.id, openaiApiKey: 'sk-test-fake', channel: 'widget' as const, personality: 'friendly', responseLength: 'balanced' });
    await chatService.processMessage('my secret word is ZEBRA-42', ctx('widget_session_visitorA'));
    const before = fake.calls.length;
    await chatService.processMessage('what did I tell you?', ctx('widget_session_visitorB'));
    const seen = fake.calls.slice(before).filter(c => c.purpose === 'main').map(c => c.messages.map(m => textOf(m.content)).join('\n')).join('\n');
    expect(seen.length > 0 && !seen.includes('ZEBRA-42'), "visitor B's prompt has none of visitor A's messages");
    const beforeA = fake.calls.length;
    await chatService.processMessage('and again?', ctx('widget_session_visitorA'));
    const seenA = fake.calls.slice(beforeA).filter(c => c.purpose === 'main').map(c => c.messages.map(m => textOf(m.content)).join('\n')).join('\n');
    expect(seenA.includes('ZEBRA-42'), "visitor A keeps their own history");
    const nsRules = fake.calls.slice(beforeA).find(c => c.purpose === 'main')?.finalRules || '';
    expect(/LEAD COLLECTION \(THIS TURN\)/.test(nsRules), 'non-streaming path also gets the lead block');
  }

  // ═════════ Never: the deleted "ASK FOR THEIR NAME FIRST" prefix / static lead prompt ═════════
  {
    const all = fake.calls.map(c => c.messages.map(m => textOf(m.content)).join('\n')).join('\n');
    expect(!all.includes('ASK FOR THEIR NAME FIRST'), 'the old "ASK FOR THEIR NAME FIRST" prefix never reaches the model');
    expect(!all.includes('SMART LEAD CAPTURE CONFIGURATION'), 'the static lead-training prompt is gone from website chat');
    expect(!all.includes('LEAD GATE ACTIVE'), 'no "LEAD GATE ACTIVE" banner');
  }

  globalThis.fetch = realFetch;
  await fake.close();
  await new Promise<void>(r => lsqServer.close(() => r()));
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('All lead-training runtime checks passed.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
