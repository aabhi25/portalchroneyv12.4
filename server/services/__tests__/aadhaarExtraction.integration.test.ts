/**
 * End-to-end test of the Aadhaar extraction pipeline (classifier → gpt-4o-mini →
 * gpt-4o escalation → validation) with a FAKE OpenAI server, so every tricky case
 * (back side, VID, misread digit, masked card, slow Tier 2, both sides in one
 * image) runs through the real code with scripted AI answers.
 *
 * Needs a throwaway local Postgres with the app schema (for document-type config):
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   DOC_TEST_DB=1 npx tsx server/services/__tests__/aadhaarExtraction.integration.test.ts
 */
import { VALID, calls, startFakeOpenAI } from "./helpers/fakeOpenAIKyc";

const url = process.env.DATABASE_URL || '';
if (process.env.DOC_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set DOC_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) { failed++; console.error(`✗ ${label}`); } else { console.log(`✓ ${label}`); }
}

async function main() {
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { documentIdentificationService, DOC_AI_TIMEOUTS } = await import("../documentIdentificationService");
  DOC_AI_TIMEOUTS.gpt4oMs = 1000; // so the slow_tier2 scenario times out quickly

  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'Caprion Test', website: 'https://example.com', openaiApiKey: 'sk-test-fake' } as any).returning();
  const run = async (scenario: string) => {
    calls.length = 0;
    const r = await documentIdentificationService.identifyDocument(acct.id, `data:image/jpeg;base64,${scenario}`, undefined, ['aadhaar', 'pan']);
    return { r, calls: [...calls] };
  };

  // Back side: no name on it is expected → accepted from gpt-4o-mini, no escalation.
  {
    const { r, calls } = await run('back_side');
    expect(r.documentType === 'aadhaar' && r.extractedData.address && r.extractedData.aadhaar_number === VALID, "back side: address + number extracted");
    expect(calls.filter(c => c.kind === 'strict').length === 1, "back side: no escalation to gpt-4o (was always escalated before)");
    expect(calls[0].kind === 'classify' && calls[0].detail === 'high', "classifier looks at the full-resolution image");
    expect(/TWO-SIDED DOCUMENTS/.test(calls[1].system) && /Do NOT lower confidence/.test(calls[1].system), "strict prompt explains two-sided cards");
    expect(/IGNORE the VID/.test(calls[1].system), "strict prompt has the Aadhaar number rules");
  }

  // VID read instead of the Aadhaar number → rejected, escalated with the reason, fixed by gpt-4o.
  {
    const { r, calls } = await run('vid_on_back');
    const strict = calls.filter(c => c.kind === 'strict');
    expect(strict.length === 2 && strict[1].model === 'gpt-4o', "VID: escalated to gpt-4o");
    expect(/16-digit VID/.test(strict[1].system), "VID: gpt-4o is told the first read was the VID");
    expect(r.extractedData.aadhaar_number === VALID && !r._validationFailures, "VID: correct 12-digit number in the end");
  }

  // One digit misread → checksum catches it → gpt-4o re-reads.
  {
    const { r, calls } = await run('misread_front');
    expect(calls.filter(c => c.kind === 'strict').length === 2, "misread digit: caught by checksum and escalated");
    expect(r.extractedData.aadhaar_number === VALID && r.extractedData.full_name === 'Asha Verma', "misread digit: corrected number + name");
  }

  // Masked Aadhaar → flagged, not escalated, number not invented.
  {
    const { r, calls } = await run('masked');
    expect(r._maskedNumber === true && r.extractedData.aadhaar_number === null, "masked: flagged, number left empty");
    expect(calls.filter(c => c.kind === 'strict').length === 1, "masked: no pointless escalation");
    expect(!r._validationFailures?.length, "masked: not reported as an unreadable photo");
  }

  // gpt-4o times out → keep what gpt-4o-mini read correctly (the address).
  {
    const t0 = Date.now();
    const { r } = await run('slow_tier2');
    expect(Date.now() - t0 < 2800, `slow Tier 2: gave up at the time budget (${Date.now() - t0}ms)`);
    expect(r.extractedData.address === '5 Park Street, Kolkata 700016', "slow Tier 2: address from Tier 1 kept");
    expect(r._validationFailures?.some(f => f.field === 'aadhaar_number'), "slow Tier 2: number still marked unreadable");
    expect(r._extractionTier === 'vision-strict-gpt4o', "slow Tier 2: reported as final tier");
  }

  // Both sides in one image, number with spaces → everything extracted, normalized.
  {
    const { r, calls } = await run('both_sides');
    expect(r.extractedData.aadhaar_number === VALID && r.extractedData.full_name && r.extractedData.address, "both sides in one image: all fields, number normalized");
    expect(calls.filter(c => c.kind === 'strict').length === 1, "both sides in one image: no escalation");
  }

  // Not a document → unknown (classifier decides), no extraction calls.
  {
    const { r, calls } = await run('not_a_doc');
    expect(r.documentType === 'unknown' && calls.filter(c => c.kind === 'strict').length === 0, "not a document: rejected by classifier");
  }

  // Tier merge rules in isolation.
  {
    const merged = documentIdentificationService.mergeTierResults(
      { documentType: 'aadhaar', confidence: 0.8, isValid: true, extractedData: { address: 'A', aadhaar_number: null } },
      { documentType: 'aadhaar', confidence: 0.9, isValid: true, extractedData: { address: null, aadhaar_number: VALID } },
    );
    expect(merged.extractedData.address === 'A' && merged.extractedData.aadhaar_number === VALID, "merge: best of both tiers");
  }

  fake.close();
  if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log("\nAll Aadhaar extraction checks passed.");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
