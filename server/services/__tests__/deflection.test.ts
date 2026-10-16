/**
 * Backup "the AI couldn't answer" detection (chatContext/deflection.ts): replies about the
 * visitor's own chat details are not deflections; business / account facts still are.
 * Run: npx tsx server/services/__tests__/deflection.test.ts
 */
import { matchesDeflectionPattern } from "../chatContext/deflection";

let failed = 0;
function expect(cond: unknown, label: string) {
  if (!cond) { failed++; console.error(`✗ ${label}`); }
  else console.log(`✓ ${label}`);
}

const normalAnswers = [
  "I don't know your name yet. What should I call you?",
  "I don't know your name yet — could you share it so I can help you with the course?",
  "I'm not sure about your mobile number — could you share it again?",
  "I don't have your email address yet. Would you like to share it?",
  "You haven't told me your name yet. What's your name?",
  "Sure! Our Online MBA is a 2-year program for working professionals.",
];
for (const r of normalAnswers) expect(!matchesDeflectionPattern(r), `kept (not a deflection): "${r.slice(0, 60)}"`);

const deflections = [
  "I don't have access to your loan details.",
  "I'm not sure about your loan status — our team can check that.",
  "I don't know your account balance.",
  "I can't provide your KYC status.",
  "I don't know your name, and I don't have information about the fee structure.",
  "I don't have information about the interest rate on personal loans.",
  "I don't have the exact fee details for the online MBA.",
  "I don't know your account number.",
  "I'm not sure when your EMI is due.",
  "Thanks, Rahul! Unfortunately, I don't have the specific placement statistics.",
  "Your name is noted. I don't have information about the hostel facilities.",
];
for (const r of deflections) expect(matchesDeflectionPattern(r), `still a deflection (fallback used): "${r.slice(0, 60)}"`);

console.log(`\n${failed === 0 ? "All deflection checks passed." : `${failed} check(s) FAILED.`}`);
process.exit(failed ? 1 : 0);
