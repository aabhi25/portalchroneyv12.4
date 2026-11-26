/**
 * Both sides of an Aadhaar when the details must be confirmed: the back alone has the number and
 * the address, so the Aadhaar is complete and the customer is asked to confirm. The front, sent a
 * few seconds later, used to be turned away ("Please confirm … first") and only one photo was kept.
 * Now it is kept with the Aadhaar, its details join the ones to confirm, and another document or
 * someone else's card is still turned away. Fake OpenAI server, fake media.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55611/postgres?sslmode=disable \
 *   DOC_TEST_DB=1 npx tsx server/services/__tests__/aadhaarConfirmationExtraSide.integration.test.ts
 */
import { VALID, OTHER_VALID, startFakeOpenAI, fakeTiming } from "./helpers/fakeOpenAIKyc";

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
  const { sameDocumentNumber } = await import("../whatsappFlowService");
  expect(sameDocumentNumber(VALID, VALID), "same number → same card");
  expect(sameDocumentNumber(VALID, `${VALID.slice(0, 4)} ${VALID.slice(4, 8)} ${VALID.slice(8)}`), "spaces don't matter");
  expect(sameDocumentNumber(VALID, VALID.slice(0, 11) + ((Number(VALID[11]) + 1) % 10)), "one misread digit → still the same card");
  expect(sameDocumentNumber(`XXXXXXXX${VALID.slice(8)}`, VALID), "masked digits don't count against it");
  expect(sameDocumentNumber(undefined, VALID) && sameDocumentNumber(VALID, undefined), "a side without a number can belong to the card");
  expect(!sameDocumentNumber(VALID, OTHER_VALID), "another person's number → different card");

  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const { whatsappFlowService } = await import("../whatsappFlowService");
  const { documentTypeService } = await import("../documentTypeService");
  (whatsappFlowService as any).sendFlowText = async () => {};
  const { DOC_AI_TIMEOUTS } = await import("../documentIdentificationService");
  DOC_AI_TIMEOUTS.gpt4oMs = 4000;
  DOC_AI_TIMEOUTS.miniMs = 4000;

  // Set up like the lending account: Aadhaar needs only the number and the address, and the
  // customer confirms the details of every Aadhaar and PAN.
  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'Two-sided Aadhaar Test', website: 'https://example.com', openaiApiKey: 'sk-test-fake' } as any).returning();
  await documentTypeService.getDocumentTypes(acct.id);
  await db.update(schema.documentTypes).set({
    confirmationRequired: 'always',
    extractionFields: [
      { key: 'aadhaar_number', label: 'Aadhaar Number', required: true, formatRegex: '^\\d{12}$' },
      { key: 'address', label: 'Address', required: true },
      { key: 'full_name', label: 'Full Name', required: false },
      { key: 'dob', label: 'Date of Birth', required: false },
      { key: 'gender', label: 'Gender', required: false },
    ],
    leadFieldMappings: [
      { extractionFieldKey: 'aadhaar_number', leadFieldKey: 'aadhaar' },
      { extractionFieldKey: 'address', leadFieldKey: 'permanent_address' },
      { extractionFieldKey: 'gender', leadFieldKey: 'gender' },
    ],
  } as any).where(and(eq(schema.documentTypes.businessAccountId, acct.id), eq(schema.documentTypes.key, 'aadhaar')));
  (documentTypeService as any).invalidateCache(acct.id);

  const [flow] = await db.insert(schema.whatsappFlows).values({ businessAccountId: acct.id, name: 'KYC', isActive: 'true' } as any).returning();
  await db.insert(schema.whatsappFlowSteps).values({
    flowId: flow.id, stepKey: 'upload_aadhaar', stepOrder: 1, type: 'upload', prompt: 'Kindly share your aadhaar',
    options: { documentTypes: [{ docType: 'aadhaar', label: 'Aadhaar Card', isMandatory: true }] },
  } as any);
  await db.insert(schema.whatsappFlowSteps).values({
    flowId: flow.id, stepKey: 'upload_pan', stepOrder: 2, type: 'upload', prompt: 'Please share your PAN',
    options: { documentTypes: [{ docType: 'pan', label: 'PAN Card', isMandatory: true }] },
  } as any);

  const newCustomer = async (phone: string) => {
    await db.insert(schema.whatsappFlowSessions).values({
      businessAccountId: acct.id, flowId: flow.id, senderPhone: phone, currentStepKey: 'upload_aadhaar', status: 'active', collectedData: {}, lastMessageAt: new Date(),
    } as any);
  };
  const mediaUrl = (phone: string, scenario: string) => `https://media.example/${phone}/${scenario}.jpg`;
  const send = async (phone: string, scenario: string) => {
    const r = await whatsappFlowService.processImageUpload(acct.id, phone, mediaUrl(phone, scenario), `${scenario}.jpg`, Buffer.from(scenario));
    return (r.response as any)?.text || '';
  };
  const sessionData = async (phone: string) => {
    const [s] = await db.select().from(schema.whatsappFlowSessions)
      .where(and(eq(schema.whatsappFlowSessions.businessAccountId, acct.id), eq(schema.whatsappFlowSessions.senderPhone, phone)));
    return { step: s?.currentStepKey, data: (s?.collectedData || {}) as Record<string, any> };
  };
  const sides = (data: Record<string, any>) => (data._documentState?.aadhaar?.pages || []).map((p: any) => p.side).join('+');

  // A: the reported case — back, the confirmation is shown, then the front a few seconds later.
  const A = '919000000301';
  await newCustomer(A);
  {
    const reply = await send(A, 'back_side');
    expect(/received/i.test(reply) && /Aadhaar Number/.test(reply) && /Address/.test(reply), "back alone completes the Aadhaar → asks to confirm number and address", reply);
    expect(!/Full Name/.test(reply), "no name on the back", reply);
  }
  {
    const reply = await send(A, 'front_side');
    expect(!/confirm the previously extracted details first/i.test(reply), "front during the confirmation is no longer turned away", reply);
    expect(/Got the \*front\* of your Aadhaar Card too/.test(reply), "says the front was added", reply);
    expect(/Full Name: Asha Verma/.test(reply) && /Gender: Female/.test(reply) && /Address/.test(reply), "confirmation now shows the front's details too", reply);
    const { step, data } = await sessionData(A);
    expect(sides(data) === 'back+front', "both photos kept with the Aadhaar", sides(data));
    const doc = data._collectedDocuments?.aadhaar || {};
    const photoUrls = [doc.sourceMediaUrl, ...(doc.additionalPhotos || []).map((p: any) => p.sourceMediaUrl)];
    expect(photoUrls[0] === mediaUrl(A, 'back_side') && photoUrls[1] === mediaUrl(A, 'front_side'),
      "both photos listed under the Aadhaar (so both show in Uploaded Documents)", photoUrls);
    expect(data._documentState?.aadhaar?.mergedData?.aadhaar_number === VALID, "the number from the first photo stays", data._documentState?.aadhaar?.mergedData?.aadhaar_number);
    expect(data._confirmationState?.pendingData?.full_name === 'Asha Verma', "the name waits for the confirmation", data._confirmationState?.pendingData);
    expect(!data.gender, "lead fields are not filled before the customer confirms", data.gender);
    expect(step === 'upload_aadhaar', "still on the Aadhaar step until confirmed", step);
  }
  {
    const r = await whatsappFlowService.processMessage(acct.id, A, 'doc_confirm', undefined, true);
    const reply = (r.response as any)?.text || '';
    const { step, data } = await sessionData(A);
    expect(/share your PAN/i.test(reply), "confirm accepted → asks for the PAN", reply);
    expect(data.gender === 'Female' && data.aadhaar === VALID, "confirming fills the lead fields from both sides", { gender: data.gender, aadhaar: !!data.aadhaar });
    expect(step === 'upload_pan', "moves on to the PAN", step);
  }

  // B: a PAN sent while the Aadhaar waits for confirmation is still turned away (confirm first).
  const B = '919000000302';
  await newCustomer(B);
  {
    await send(B, 'back_side');
    const reply = await send(B, 'pan_card');
    expect(/confirm the previously extracted details first/i.test(reply), "another document during the confirmation → confirm first", reply);
    const { data } = await sessionData(B);
    expect(sides(data) === 'back', "the PAN is not added to the Aadhaar", sides(data));
  }

  // C: someone else's Aadhaar front → not added to this card.
  const C = '919000000303';
  await newCustomer(C);
  {
    await send(C, 'back_side');
    const reply = await send(C, 'other_front');
    expect(/confirm the previously extracted details first/i.test(reply), "another person's Aadhaar during the confirmation → confirm first", reply);
    const { data } = await sessionData(C);
    expect(sides(data) === 'back' && !data._confirmationState?.pendingData?.full_name, "the other card's photo and name are not kept", { sides: sides(data), pending: Object.keys(data._confirmationState?.pendingData || {}) });
  }

  // D: front sent while the back is still being read → both kept, and the confirmation shows the name.
  const D = '919000000304';
  await newCustomer(D);
  {
    fakeTiming.extractionDelayMs = 1500;
    const first = send(D, 'back_side');
    await new Promise(r => setTimeout(r, 300));
    const second = send(D, 'front_side');
    const replies = await Promise.all([first, second]);
    fakeTiming.extractionDelayMs = 0;
    const { data } = await sessionData(D);
    expect(sides(data) === 'back+front', "photos sent together: both kept", sides(data));
    expect(data._confirmationState?.pendingData?.full_name === 'Asha Verma', "photos sent together: the name is in the details to confirm", data._confirmationState?.pendingData);
    const shown = replies.find(r => /Aadhaar Number/.test(r)) || '';
    expect(/Full Name: Asha Verma/.test(shown), "photos sent together: the confirmation shown lists the name", replies);
  }

  fake.close();
  if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log("\nAll two-sided Aadhaar confirmation checks passed.");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
