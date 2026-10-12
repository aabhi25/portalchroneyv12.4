/**
 * PAN step of a WhatsApp flow (Caprion-style): an unreadable PAN number never loops.
 *  - look-alike characters in the PAN are corrected by position (repairPanNumber);
 *  - name + DOB read but no number → a clear message (clearer photo or type it), after 2
 *    misses "please type it" — never "PAN Card received… Please also upload: PAN Card";
 *  - a typed PAN completes the PAN document through the normal document path;
 *  - a mistyped PAN gets a format hint (typed values are never look-alike "repaired").
 *
 *   DOC_TEST_DB=1 DATABASE_URL=postgresql://…@127.0.0.1:<port>/postgres npx tsx server/services/__tests__/panWhatsappFlow.integration.test.ts
 */
import { startFakeOpenAI, fakeTiming } from "./helpers/fakeOpenAIKyc";
import { findPanInText, looksLikePanAttempt, repairPanNumber } from "@shared/pan";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

// ── Pure helpers (no database) ──────────────────────────────────────────────
expect(repairPanNumber('AJWPV99776') === 'AJWPV9977G', 'repair: 6 in the last (letter) position → G');
expect(repairPanNumber('AJWPV9O77G') === 'AJWPV9077G', 'repair: O in a digit position → 0');
expect(repairPanNumber('0JWPV9977G') === 'OJWPV9977G', 'repair: 0 in a letter position → O');
expect(repairPanNumber('ajwpv 9977-g') === 'AJWPV9977G', 'repair: lower case, spaces and dashes');
expect(repairPanNumber('AJWPV9977') === null && repairPanNumber('AJWPV99770G') === null, 'repair: wrong length → null');
expect(repairPanNumber('AJWPV9X77G') === null, 'repair: an unfixable character → null');
expect(findPanInText('my pan is ajwpv 9977 g') === 'AJWPV9977G', 'typed: PAN inside a sentence, split in groups');
expect(findPanInText('AJWPV9977G') === 'AJWPV9977G', 'typed: plain PAN');
expect(findPanInText('AJWPV99776') === null, 'typed: NOT look-alike repaired (a typo must not become another PAN)');
expect(findPanInText('ok thanks, will send tomorrow') === null, 'typed: ordinary text → no PAN');
expect(looksLikePanAttempt('AJWPV99776') && !looksLikePanAttempt('hello there'), 'typed: PAN-like attempt detected for the format hint');

const url = process.env.DATABASE_URL || '';
if (process.env.DOC_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.log(`\nPure checks done (${failed} failed). Set DOC_TEST_DB=1 with a local DATABASE_URL for the flow checks.`);
  process.exit(failed ? 1 : 0);
}

async function main() {
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const { whatsappFlowService } = await import("../whatsappFlowService");
  (whatsappFlowService as any).sendFlowText = async () => {};
  const { DOC_AI_TIMEOUTS } = await import("../documentIdentificationService");
  DOC_AI_TIMEOUTS.gpt4oMs = 4000;
  DOC_AI_TIMEOUTS.miniMs = 4000;
  fakeTiming.extractionDelayMs = 0;

  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'Caprion PAN Test', website: 'https://example.com', openaiApiKey: 'sk-test-fake' } as any).returning();
  const [flow] = await db.insert(schema.whatsappFlows).values({ businessAccountId: acct.id, name: 'KYC', isActive: 'true' } as any).returning();
  await db.insert(schema.whatsappFlowSteps).values({
    flowId: flow.id, stepKey: 'pan', stepOrder: 1, type: 'upload', prompt: 'Please share your PAN',
    options: { documentTypes: [{ docType: 'pan', label: 'PAN Card', isMandatory: true }] },
  } as any);
  await db.insert(schema.whatsappFlowSteps).values({ flowId: flow.id, stepKey: 'thanks', stepOrder: 2, type: 'text', prompt: 'Thanks! We have your documents.' } as any);

  const newCustomer = async (phone: string) => {
    await db.insert(schema.whatsappFlowSessions).values({
      businessAccountId: acct.id, flowId: flow.id, senderPhone: phone, currentStepKey: 'pan', status: 'active', collectedData: {}, lastMessageAt: new Date(),
    } as any);
  };
  const send = async (phone: string, scenario: string) => {
    const r = await whatsappFlowService.processImageUpload(acct.id, phone, `https://media.example/${scenario}.jpg`, `${scenario}.jpg`, Buffer.from(scenario));
    return JSON.stringify(r.response || {});
  };
  const say = async (phone: string, text: string) => JSON.stringify((await whatsappFlowService.processMessage(acct.id, phone, text)).response || {});
  const pan = async (phone: string) => {
    const [s] = await db.select().from(schema.whatsappFlowSessions)
      .where(and(eq(schema.whatsappFlowSessions.businessAccountId, acct.id), eq(schema.whatsappFlowSessions.senderPhone, phone)));
    return ((s?.collectedData || {}) as any)._documentState?.pan || {};
  };

  // Customer A: the reported case — PAN photo where the number can't be read.
  const A = '919000000201';
  await newCustomer(A);
  {
    const reply = await send(A, 'pan_no_number');
    expect(/could read the name and date of birth, but not the PAN number/.test(reply) && /type the 10-character PAN number/.test(reply), 'unreadable PAN number → says what was read, offers a clearer photo or typing it', reply);
    expect(!/Please also upload: PAN Card/.test(reply), 'no more "PAN Card received… Please also upload: PAN Card"', reply);
    expect((await pan(A)).status === 'processing', 'PAN kept as partly received (photo saved)');
  }
  {
    const reply = await send(A, 'pan_no_number');
    expect(/Please type the 10-character PAN number here/.test(reply) && !/clearer photo/.test(reply), 'second unreadable photo → asks to type the PAN', reply);
  }
  {
    const reply = await say(A, 'AJWPV99776');
    expect(/doesn't look like a PAN number/.test(reply), 'mistyped PAN → format hint (no look-alike repair of typed text)', reply);
    expect((await pan(A)).status === 'processing', 'mistyped PAN not accepted');
  }
  {
    const reply = await say(A, 'my pan is ajwpv 9977 g');
    const st = await pan(A);
    expect(st.status === 'complete' && st.mergedData?.pan_number === 'AJWPV9977G' && st.mergedData?.full_name === 'VINDYARANI', 'typed PAN completes the PAN with the name/DOB from the photo', st.mergedData);
    expect(!/Please also upload/.test(reply), 'after the typed PAN the customer is not asked for the PAN again', reply);
    expect(st.pages?.length >= 1 && st.pages.some((p: any) => p.sourceMediaUrl), 'the uploaded PAN photo stays attached to the document', st.pages?.length);
  }

  // Customer B: look-alike character in the number → fixed on the first upload.
  const B = '919000000202';
  await newCustomer(B);
  {
    const reply = await send(B, 'pan_lookalike');
    const st = await pan(B);
    expect(st.status === 'complete' && st.mergedData?.pan_number === 'APRPC5124K', 'look-alike PAN character corrected by position → complete on the first upload', st.mergedData);
    expect(!/Please also upload|not the PAN number/.test(reply), 'no re-upload request', reply);
  }

  // Ordinary text at the PAN step without an unreadable-number photo is not hijacked.
  const C = '919000000203';
  await newCustomer(C);
  {
    const r = await whatsappFlowService.processMessage(acct.id, C, 'AJWPV9977G');
    expect((await pan(C)).status !== 'complete', 'a PAN typed before any photo does not replace the PAN photo', r.response);
  }

  fake.close();
  console.log(`\n${failed === 0 ? 'All PAN flow checks passed.' : `${failed} PAN flow check(s) FAILED.`}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
