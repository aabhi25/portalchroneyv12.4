/**
 * Lead score rules (leadScoringService.scoreFromSignals): engagement 0-100 from recent activity,
 * negative signals, cooling down when quiet, profile fit, and the reasons both ways.
 * Run: npx tsx server/services/__tests__/leadScoring.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused'; // never queried here

let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); }
}

async function main() {
  const { scoreFromSignals } = await import('../leadScoringService');
  const now = new Date('2026-10-24T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
  const base = {
    now, lastActivityAt: hoursAgo(2), sharedDetails: true, hasPhone: true, hasEmail: false, hasName: true, phoneConfirmed: false,
    enquiryCount: 1, websiteChats: 1, buyingQuestion: false, interest: null as string | null, callsAnswered: 0, callsUnanswered: 0,
    lastOutcome: null as any, followUpRead: false, followUpFailed: false, whatsappReplies: 0, movedToWhatsapp: false,
  };

  // The mock-up's Priya: website → WhatsApp question → AI call, interested.
  const priya = scoreFromSignals({ ...base, phoneConfirmed: true, buyingQuestion: true, interest: 'Online MBA', callsAnswered: 1, lastOutcome: 'interested', whatsappReplies: 2, followUpRead: true });
  expect(priya.temperature === 'hot' && priya.score >= 80 && priya.fit === 'good', 'engaged lead across channels → Hot, good fit', priya);
  expect(priya.reasons.up.includes('Interested on the call') && priya.reasons.up.includes('Replied on WhatsApp') && priya.reasons.down.length === 0, 'reasons say why it is hot', priya.reasons);

  const fresh = scoreFromSignals(base);
  expect(fresh.temperature === 'cold' && fresh.score === 20 && fresh.fit === 'partial', 'a new lead with only a chat and a number → Cold (20), partial fit', fresh);
  const warm = scoreFromSignals({ ...base, buyingQuestion: true, enquiryCount: 2, callsAnswered: 1 });
  expect(warm.temperature === 'warm' && warm.score === 50 && warm.reasons.up.includes('Came back (2 enquiries)'), 'came back + asked about fees + answered → Warm', warm);

  const notInterested = scoreFromSignals({ ...base, callsAnswered: 1, lastOutcome: 'not_interested' });
  expect(notInterested.score === 0 && notInterested.reasons.down.includes('Said not interested on the call'), 'not interested pulls it down', notInterested);
  const dnc = scoreFromSignals({ ...base, phoneConfirmed: true, buyingQuestion: true, callsAnswered: 1, lastOutcome: 'do_not_call', whatsappReplies: 5 });
  expect(dnc.score === 0 && dnc.temperature === 'cold' && dnc.reasons.down[0] === 'Asked not to be called', 'do-not-call → 0, whatever else happened', dnc);
  const ghost = scoreFromSignals({ ...base, callsUnanswered: 3 });
  expect(ghost.reasons.down.includes("Didn't answer 3 calls") && ghost.score === 10, 'unanswered calls count against', ghost);

  // Cooling down.
  const signals = { ...base, phoneConfirmed: true, buyingQuestion: true, interest: 'MBA', callsAnswered: 1, lastOutcome: 'interested' as const, whatsappReplies: 3 };
  const scores = [2, 24 * 5, 24 * 10, 24 * 20, 24 * 45].map((h) => scoreFromSignals({ ...signals, lastActivityAt: hoursAgo(h) }).score);
  expect(scores.every((s, i) => i === 0 || s < scores[i - 1]) && scores[4] <= 10, 'the same lead cools down the longer it is quiet (2 h → 45 days)', scores);
  expect(scoreFromSignals({ ...signals, lastActivityAt: hoursAgo(24 * 10) }).reasons.down.includes('Quiet for 10 days'), 'the quiet days show as a reason');

  const unknown = scoreFromSignals({ ...base, sharedDetails: false, hasPhone: false, hasName: false });
  expect(unknown.fit === 'unknown' && unknown.reasons.fit.includes('No phone number') && unknown.reasons.fit.includes('Not clear what they want yet'), 'fit unknown when we can neither reach them nor know what they want', unknown.reasons.fit);
  expect(scoreFromSignals({ ...signals, enquiryCount: 9, websiteChats: 9, movedToWhatsapp: true }).score === 100, 'the score never goes above 100');

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll lead score checks passed.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
