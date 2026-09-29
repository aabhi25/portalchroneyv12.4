/**
 * Tests for the first message a WhatsApp customer gets after sending a document.
 * Run manually: `npx tsx server/services/__tests__/uploadAckCoordinator.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import { UploadAckCoordinator, GENERIC_ACK } from "../uploadAckCoordinator";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const ctx = { businessAccountId: 'b', senderPhone: 'p', sessionId: 's' };

function make() {
  const sent: string[] = [];
  const c = new UploadAckCoordinator(async (_ctx, text) => { sent.push(text); }, { gatherMs: 50, fallbackMs: 200, minConfidence: 0.8 });
  return { c, sent };
}

async function main() {
  // Single-type step: named right away, but as "checking", since it isn't verified yet.
  {
    const { c, sent } = make();
    c.onUploadArrived('k', ctx, { label: 'Aadhaar Card', kind: 'aadhaar', verified: false });
    await wait(80);
    expect(sent.length === 1 && /checking your \*Aadhaar Card\*/.test(sent[0]), "single-type step → 'checking your Aadhaar Card'", sent);
  }
  // Multi-type step, confident classification before the gather window ends.
  {
    const { c, sent } = make();
    c.onUploadArrived('k', ctx, null);
    await wait(10);
    c.onClassified('k', { label: 'PAN Card', kind: 'pan', verified: true }, 0.95);
    await wait(80);
    expect(sent.length === 1 && sent[0] === '📄 Got your *PAN Card* — reading the details now…', "confident classification → 'Got your PAN Card'", sent);
  }
  // Classification after the gather window → sent as soon as it's known, before the fallback.
  {
    const { c, sent } = make();
    c.onUploadArrived('k', ctx, null);
    await wait(100);
    expect(sent.length === 0, "nothing sent while waiting for classification (before fallback)", sent);
    c.onClassified('k', { label: 'PAN Card', kind: 'pan', verified: true }, 0.9);
    await wait(5);
    expect(sent.length === 1 && /PAN Card/.test(sent[0]), "late classification → named message immediately", sent);
    await wait(200);
    expect(sent.length === 1, "fallback does not fire after the named message");
  }
  // Low confidence → generic at the fallback time, never a guess.
  {
    const { c, sent } = make();
    c.onUploadArrived('k', ctx, null);
    c.onClassified('k', { label: 'PAN Card', kind: 'pan', verified: true }, 0.6);
    await wait(120);
    expect(sent.length === 0, "low confidence → no named message");
    await wait(120);
    expect(sent.length === 1 && sent[0] === GENERIC_ACK, "low confidence → generic message at the fallback", sent);
  }
  // Not an accepted document → stay quiet (the rejection reply follows).
  {
    const { c, sent } = make();
    c.onUploadArrived('k', ctx, null);
    c.onClassified('k', null, 0.9);
    await wait(300);
    expect(sent.length === 0, "unknown document → no acknowledgement at all", sent);
  }
  // Two photos in quick succession → one combined message.
  {
    const { c, sent } = make();
    c.onUploadArrived('k', ctx, null);
    await wait(20);
    c.onUploadArrived('k', ctx, null);
    c.onClassified('k', { label: 'PAN Card', kind: 'pan', verified: true }, 0.95);
    await wait(300);
    expect(sent.length === 1 && /Got 2 documents/.test(sent[0]), "two photos together → 'Got 2 documents'", sent);
  }
  // Answered before the gather window ends → no late acknowledgement.
  {
    const { c, sent } = make();
    c.onUploadArrived('k', ctx, { label: 'Aadhaar Card', kind: 'aadhaar', verified: false });
    c.onDone('k');
    await wait(300);
    expect(sent.length === 0, "batch answered first → acknowledgement cancelled", sent);
  }
  // Aadhaar sides and PDF pages.
  {
    const { c, sent } = make();
    c.onUploadArrived('k', ctx, null);
    c.onClassified('k', { label: 'Aadhaar Card', kind: 'aadhaar', side: 'back', verified: true }, 0.95);
    await wait(80);
    expect(/\*back\* of your Aadhaar Card — reading your address/.test(sent[0]), "Aadhaar back expected → 'Got the back … reading your address'", sent);
  }
  {
    const { c, sent } = make();
    c.onUploadArrived('k', ctx, null);
    c.onClassified('k', { label: 'Bank Statement', kind: 'bank_statement', pages: 3, verified: true }, 0.9);
    await wait(80);
    expect(sent[0] === '📄 Got your *Bank Statement* (3 pages) — reading it now…', "PDF → page count in the message", sent);
  }
  {
    const { c, sent } = make();
    c.onUploadArrived('k', ctx, { label: 'Bank Statement', kind: 'bank_statement', verified: false });
    c.onClassified('k', { label: 'Bank Statement', kind: 'bank_statement', pages: 4, verified: false }, 1);
    await wait(80);
    expect(sent[0] === '📄 Got your PDF (4 pages) — checking your *Bank Statement* now…', "single-type PDF → 'checking' wording with pages", sent);
  }
  // A new upload after the previous batch was answered gets its own message.
  {
    const { c, sent } = make();
    c.onUploadArrived('k', ctx, { label: 'Aadhaar Card', kind: 'aadhaar', verified: false });
    await wait(80);
    c.onDone('k');
    c.onUploadArrived('k', ctx, { label: 'Aadhaar Card', kind: 'aadhaar', side: 'back', verified: false });
    await wait(80);
    expect(sent.length === 2 && /\*back\*/.test(sent[1]), "next upload after an answered batch → its own message", sent);
  }

  if (failed > 0) { console.error(`\n${failed} ack test(s) failed.`); process.exit(1); }
  console.log("\nAll upload acknowledgement tests passed.");
}

main();
