/**
 * The day a visitor asks for in a booking message (the chat booking card opens on it).
 * No database needed. Run: `npx tsx server/services/__tests__/bookingDay.test.ts`
 */
import { requestedBookingDay as f } from "../bookingDay";
const now = new Date('2026-10-21T13:30:00Z'); // Wed 21 Oct 2026, 19:00 IST
const cases: Array<[string, string | null]> = [
  ['I want to book an appointment for Saturday', '2026-10-24'],
  ['book appointment tomorrow', '2026-10-22'],
  ['can I come today?', '2026-10-21'],
  ['day after tomorrow please', '2026-10-23'],
  ['book for wednesday', '2026-10-21'],
  ['next wednesday', '2026-10-28'],
  ['next monday', '2026-10-26'],
  ['appointment on 24th oct', '2026-10-24'],
  ['October 30th works', '2026-10-30'],
  ['book on 5 jan', '2027-01-05'],
  ['on the 28th', '2026-10-28'],
  ['on the 2nd', '2026-11-02'],
  ['book appointment', null],
  ['I want money back', null],
  ['31 feb', null],
];
let bad = 0;
for (const [msg, want] of cases) { const got = f(msg, now); if (got !== want) { bad++; console.log('FAIL', msg, got, want); } }
console.log(bad ? `${bad} failed` : `all ${cases.length} passed`);
process.exit(bad ? 1 : 0);
