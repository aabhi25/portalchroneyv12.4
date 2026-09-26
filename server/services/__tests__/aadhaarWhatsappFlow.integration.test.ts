/**
 * Conversation-level test: photos sent to a real WhatsApp flow with an Aadhaar
 * upload step, through processImageUpload, with a fake OpenAI server. Checks the
 * replies a customer would actually get.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   DOC_TEST_DB=1 npx tsx server/services/__tests__/aadhaarWhatsappFlow.integration.test.ts
 */
import { VALID, startFakeOpenAI } from "./helpers/fakeOpenAIKyc";

const url = process.env.DATABASE_URL || '';
if (process.env.DOC_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set DOC_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

async function main() {
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const { whatsappFlowService } = await import("../whatsappFlowService");
  const { DOC_AI_TIMEOUTS } = await import("../documentIdentificationService");
  DOC_AI_TIMEOUTS.gpt4oMs = 1000;

  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'Caprion WA Test', website: 'https://example.com', openaiApiKey: 'sk-test-fake' } as any).returning();
  const [flow] = await db.insert(schema.whatsappFlows).values({ businessAccountId: acct.id, name: 'KYC', isActive: 'true' } as any).returning();
  await db.insert(schema.whatsappFlowSteps).values({
    flowId: flow.id, stepKey: 'upload_docs', stepOrder: 1, type: 'upload', prompt: 'Please upload your Aadhaar card',
    options: { documentTypes: [{ docType: 'aadhaar', label: 'Aadhaar Card', isMandatory: true }, { docType: 'pan', label: 'PAN Card', isMandatory: false }] },
  } as any);
  await db.insert(schema.whatsappFlowSteps).values({
    flowId: flow.id, stepKey: 'thanks', stepOrder: 2, type: 'text', prompt: 'Thanks! We have your documents.',
  } as any);

  const newCustomer = async (phone: string) => {
    await db.insert(schema.whatsappFlowSessions).values({
      businessAccountId: acct.id, flowId: flow.id, senderPhone: phone, currentStepKey: 'upload_docs', status: 'active', collectedData: {}, lastMessageAt: new Date(),
    } as any);
  };
  const send = async (phone: string, scenario: string) => {
    const r = await whatsappFlowService.processImageUpload(acct.id, phone, `https://media.example/${scenario}.jpg`, `${scenario}.jpg`, Buffer.from(scenario));
    return (r.response as any)?.text || '';
  };
  const sessionData = async (phone: string) => {
    const [s] = await db.select().from(schema.whatsappFlowSessions)
      .where(and(eq(schema.whatsappFlowSessions.businessAccountId, acct.id), eq(schema.whatsappFlowSessions.senderPhone, phone)));
    return (s?.collectedData || {}) as Record<string, any>;
  };

  // Customer A: masked card first, then back side, then front (with a digit misread by mini).
  const A = '919000000101';
  await newCustomer(A);
  {
    const reply = await send(A, 'masked');
    expect(/masked/i.test(reply) && /UIDAI|myaadhaar/i.test(reply), "masked Aadhaar → clear 'send the unmasked card' reply", reply);
  }
  {
    const reply = await send(A, 'back_side');
    expect(/received/i.test(reply), "back side accepted", reply);
    expect(/\*front\*/.test(reply) && /name/i.test(reply), "back side → asks for the FRONT to capture the name", reply);
  }
  {
    const reply = await send(A, 'misread_front');
    const data = await sessionData(A);
    const merged = data._documentState?.aadhaar?.mergedData || {};
    expect(merged.aadhaar_number === VALID && merged.full_name === 'Asha Verma' && merged.address, "front + back merged: number (checksum-corrected), name, address", merged);
    expect(!/couldn't|could not|sorry/i.test(reply), "front accepted without an error reply", reply);
  }

  // Customer B: back side where the number can't be read (Tier 2 slow) but the address is fine.
  const B = '919000000102';
  await newCustomer(B);
  {
    const reply = await send(B, 'slow_tier2');
    const data = await sessionData(B);
    const st = data._documentState?.aadhaar || {};
    expect(st.mergedData?.address === '5 Park Street, Kolkata 700016', "unreadable number: page kept, address saved", st.mergedData);
    expect(/Aadhaar number/i.test(reply) && /\*front\*/.test(reply), "unreadable number: asks precisely for a sharper FRONT photo", reply);
  }

  // Customer C: not a document at all.
  const C = '919000000103';
  await newCustomer(C);
  {
    const reply = await send(C, 'not_a_doc');
    expect(/Aadhaar/i.test(reply) && /upload/i.test(reply), "not a document → asks for the right document", reply);
  }

  // Customer D: both sides in one photo → complete in one go.
  const D = '919000000104';
  await newCustomer(D);
  {
    const reply = await send(D, 'both_sides');
    const data = await sessionData(D);
    const st = data._documentState?.aadhaar || {};
    expect(st.status === 'complete', "both sides in one photo → Aadhaar complete in a single upload", st.status);
    expect(!/couldn't|could not|sorry/i.test(reply), "both sides in one photo → no error reply", reply);
  }

  fake.close();
  if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log("\nAll WhatsApp Aadhaar flow checks passed.");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
