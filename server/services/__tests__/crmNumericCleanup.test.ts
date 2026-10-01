/**
 * Amounts typed in a journey must reach the CRM/LOS as plain numbers.
 * Run manually: `npx tsx server/services/__tests__/crmNumericCleanup.test.ts` (no database is used)
 */
// The module opens a (lazy) pool on import; nothing here touches the database.
process.env.DATABASE_URL ||= "postgresql://unused@127.0.0.1:1/unused";
const { cleanNumericValue } = await import("../customCrmService");

let failed = 0;
function expect(input: string, want: string) {
  const got = cleanNumericValue(input);
  if (got !== want) { failed++; console.error(`✗ ${JSON.stringify(input)} → ${JSON.stringify(got)} (want ${want})`); }
  else console.log(`✓ ${JSON.stringify(input)} → ${got}`);
}

expect("₹2,21,525", "221525");
expect("₹ 2,21,525", "221525");
expect("Rs. 2,21,525/-", "221525");
expect("Rs 50000", "50000");
expect("INR 1,50,000", "150000");
expect("2,21,525 rupees", "221525");
expect("221525", "221525");
expect("2,21,525", "221525");
expect("2.21 lakh", "221000");
expect("₹2.5 lakh", "250000");
expect("1.2 crore", "12000000");
expect("2 21 525", "221525");
expect("50000.50", "50000.50");
expect("not sure", "not sure"); // left as typed; the LOS reports it

if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log("\nAll amount clean-up checks passed.");
