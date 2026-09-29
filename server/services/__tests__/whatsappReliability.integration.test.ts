/**
 * Reliability checks for the WhatsApp agent against a throwaway database:
 * - "restart" only when the whole message asks for it;
 * - a text arriving while a document is being read doesn't erase the document;
 * - webhook idempotency: released / unfinished claims can be retried, finished ones can't;
 * - the stuck-session job sends one reminder, never for expired sessions, once across servers.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/postgres?sslmode=disable \
 *   DOC_TEST_DB=1 npx tsx server/services/__tests__/whatsappReliability.integration.test.ts
 */
import { startFakeOpenAI, fakeTiming } from "./helpers/fakeOpenAIKyc";

const url = process.env.DATABASE_URL || '';
if (process.env.DOC_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set DOC_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and, sql } = await import("drizzle-orm");
  const { whatsappFlowService, isRestartRequest } = await import("../whatsappFlowService");
  const { webhookIdempotency } = await import("../webhookIdempotencyService");
  const { whatsappAutoReplyService } = await import("../whatsappAutoReplyService");
  await db.execute(sql`ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP`);

  (whatsappFlowService as any).sendFlowText = async () => {};
  const { DOC_AI_TIMEOUTS } = await import("../documentIdentificationService");
  DOC_AI_TIMEOUTS.gpt4oMs = 4000;
  DOC_AI_TIMEOUTS.miniMs = 4000;

  // ── Restart detection ─────────────────────────────────────────────────────
  for (const m of ["start over", "Please restart the form", "restart", "fir se shuru karo", "I want to start again", "can we start fresh?", "let's start over", "dobara shuru karna hai", "naya form bharo"]) {
    expect(isRestartRequest(m), `restart: "${m}"`);
  }
  for (const m of ["sending cancelled cheque", "dobara bhejta hu", "cancel", "fir se bhej raha hu photo", "I will restart my business next year so need loan", "my shop restarted after covid", "start", "ok"]) {
    expect(!isRestartRequest(m), `not a restart: "${m}"`);
  }

  // ── Setup ─────────────────────────────────────────────────────────────────
  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'Reliability Test', website: 'https://example.com', openaiApiKey: 'sk-test-fake' } as any).returning();
  await db.insert(schema.whatsappSettings).values({ businessAccountId: acct.id, msg91AuthKey: 'test-key', msg91IntegratedNumberId: '910000000000' } as any);
  const [flow] = await db.insert(schema.whatsappFlows).values({ businessAccountId: acct.id, name: 'KYC', isActive: 'true' } as any).returning();
  await db.insert(schema.whatsappFlowSteps).values({
    flowId: flow.id, stepKey: 'upload_docs', stepOrder: 1, type: 'upload', prompt: 'Please upload your Aadhaar and PAN',
    options: { documentTypes: [{ docType: 'aadhaar', label: 'Aadhaar Card', isMandatory: true }, { docType: 'pan', label: 'PAN Card', isMandatory: true }] },
  } as any);
  await db.insert(schema.whatsappFlowSteps).values({ flowId: flow.id, stepKey: 'thanks', stepOrder: 2, type: 'text', prompt: 'Thanks!' } as any);
  const sessionOf = async (phone: string) => {
    const [s] = await db.select().from(schema.whatsappFlowSessions)
      .where(and(eq(schema.whatsappFlowSessions.businessAccountId, acct.id), eq(schema.whatsappFlowSessions.senderPhone, phone)));
    return s;
  };

  // ── A text typed while a document is being read ───────────────────────────
  {
    const P = '919000000301';
    await db.insert(schema.whatsappFlowSessions).values({
      businessAccountId: acct.id, flowId: flow.id, senderPhone: P, currentStepKey: 'upload_docs', status: 'active', collectedData: {}, lastMessageAt: new Date(),
    } as any);
    fakeTiming.extractionDelayMs = 1500;
    const order: string[] = [];
    const upload = whatsappFlowService.processImageUpload(acct.id, P, 'https://media.example/pan_card.jpg', 'pan_card.jpg', Buffer.from('pan_card'))
      .then(r => { order.push('upload done'); return r; });
    await wait(200);
    // What the webhook does for a text message: queue behind the upload, then read the session.
    const text = whatsappFlowService.runForSender(acct.id, P, async () => {
      order.push('text start');
      const s = await whatsappFlowService.getActiveSession(acct.id, P);
      const data = (s?.collectedData || {}) as Record<string, any>;
      // Simulates the text handler rewriting the whole collectedData from its own read.
      await db.update(schema.whatsappFlowSessions).set({ collectedData: { ...data, note: 'typed while reading' } }).where(eq(schema.whatsappFlowSessions.id, s!.id));
    });
    await Promise.all([upload, text]);
    expect(order[0] === 'upload done' && order[1] === 'text start', "text waits for the document being read", order);
    const data = ((await sessionOf(P))?.collectedData || {}) as Record<string, any>;
    const docs = data._collectedDocuments || {};
    expect(Object.keys(docs).some(k => /pan/.test(k)) && data.note === 'typed while reading', "document kept and text saved", { docs: Object.keys(docs), note: data.note });
    fakeTiming.extractionDelayMs = 0;
  }

  // ── Webhook idempotency ───────────────────────────────────────────────────
  {
    const id = `msg-${Date.now()}`;
    expect(await webhookIdempotency.claim(acct.id, 'msg91', id, 'inbound', true), "first delivery claimed");
    expect(!(await webhookIdempotency.claim(acct.id, 'msg91', id, 'inbound', true)), "immediate duplicate skipped");
    await webhookIdempotency.release(acct.id, 'msg91', id);
    expect(await webhookIdempotency.claim(acct.id, 'msg91', id, 'inbound', true), "after a failure (released) the retry is processed");

    // Unfinished claim (crash mid-way): a retry 5 minutes later takes over; a finished one doesn't.
    // received_at is written with the database's NOW(), so age it the same way.
    const age = (providerId: string, minutes: number) =>
      db.execute(sql`UPDATE webhook_events SET received_at = NOW() - make_interval(mins => ${minutes}) WHERE provider_id = ${providerId}`);
    await age(id, 5);
    expect(await webhookIdempotency.claim(acct.id, 'msg91', id, 'inbound', true), "unfinished claim from 5 min ago → retry processed");
    await webhookIdempotency.markProcessed(acct.id, 'msg91', id);
    await age(id, 5);
    expect(!(await webhookIdempotency.claim(acct.id, 'msg91', id, 'inbound', true)), "finished message → later duplicate still skipped");

    const id2 = `msg-old-${Date.now()}`;
    await webhookIdempotency.claim(acct.id, 'msg91', id2, 'inbound', true);
    await age(id2, 120);
    expect(!(await webhookIdempotency.claim(acct.id, 'msg91', id2, 'inbound', true)), "very old unfinished claim is not replayed");

    const rid = `receipt-${Date.now()}:delivered`;
    expect(await webhookIdempotency.claim(acct.id, 'msg91', rid, 'delivered'), "receipt claimed");
    await age(rid, 5);
    expect(!(await webhookIdempotency.claim(acct.id, 'msg91', rid, 'delivered')), "receipts keep plain dedup (no takeover)");
  }

  // ── Stuck-session reminders ───────────────────────────────────────────────
  const sent: { phone: string; text: string }[] = [];
  (whatsappAutoReplyService as any).sendFlowResponse = async (_s: any, phone: string, resp: any) => { sent.push({ phone, text: resp?.text || '' }); return { success: true }; };
  const tenMinAgo = new Date(Date.now() - 10 * 60_000);
  const pdfSessionData = { _collectedDocuments: { aadhaar: { label: 'Aadhaar Card', isValid: true }, pan: { label: 'PAN Card', isValid: true } }, _pendingPdfUrl: 'https://media.example/statement.pdf' };
  {
    const P = '919000000401';
    await db.insert(schema.whatsappFlowSessions).values({
      businessAccountId: acct.id, flowId: flow.id, senderPhone: P, currentStepKey: 'upload_docs', status: 'active',
      collectedData: pdfSessionData, lastMessageAt: tenMinAgo, expiresAt: new Date(Date.now() + 60 * 60_000),
    } as any);
    // Two servers running the job at the same moment.
    await Promise.all([
      (whatsappFlowService as any).checkAndRecoverStuckSessions(),
      (whatsappFlowService as any).checkAndRecoverStuckSessions(),
    ]);
    const forP = () => sent.filter(m => m.phone === P);
    expect(forP().length === 1 && /password/i.test(forP()[0].text), "PDF password reminder sent once across two servers", forP());
    await db.update(schema.whatsappFlowSessions).set({ lastMessageAt: tenMinAgo }).where(eq(schema.whatsappFlowSessions.id, (await sessionOf(P))!.id));
    await (whatsappFlowService as any).checkAndRecoverStuckSessions();
    expect(forP().length === 1, "no second reminder on the next run", forP());
  }
  {
    const P = '919000000402';
    await db.insert(schema.whatsappFlowSessions).values({
      businessAccountId: acct.id, flowId: flow.id, senderPhone: P, currentStepKey: 'upload_docs', status: 'active',
      collectedData: pdfSessionData, lastMessageAt: tenMinAgo, expiresAt: new Date(Date.now() - 60_000),
    } as any);
    await (whatsappFlowService as any).checkAndRecoverStuckSessions();
    expect(sent.filter(m => m.phone === P).length === 0, "expired session → no reminder");
    expect((await sessionOf(P))?.status === 'expired', "expired session is closed", (await sessionOf(P))?.status);
  }

  fake.close();
  if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log("\nAll WhatsApp reliability checks passed.");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
