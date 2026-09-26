/**
 * Tests for the Aadhaar number helpers (Verhoeff checksum, VID / masked detection).
 * Run manually: `npx tsx server/services/__tests__/aadhaarNumber.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import { checkAadhaarNumber, verhoeffCheckDigit, verhoeffValid } from "@shared/aadhaar";

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) { failed++; console.error(`✗ ${label}`); } else { console.log(`✓ ${label}`); }
}

// Reference values for the Verhoeff algorithm.
expect(verhoeffCheckDigit("236") === "3", "Verhoeff: 236 → check digit 3");
expect(verhoeffCheckDigit("12345") === "1", "Verhoeff: 12345 → check digit 1");
expect(verhoeffValid("2363") && !verhoeffValid("2364"), "Verhoeff: 2363 valid, 2364 invalid");
expect(verhoeffValid("999941057058"), "UIDAI public sandbox Aadhaar passes");

const base = "23456789012";
const valid = base + verhoeffCheckDigit(base);
expect(checkAadhaarNumber(valid).kind === "valid", "valid number");
expect(checkAadhaarNumber(`${valid.slice(0, 4)} ${valid.slice(4, 8)} ${valid.slice(8)}`).digits === valid, "spaces stripped");
expect(checkAadhaarNumber(`${valid.slice(0, 4)}-${valid.slice(4, 8)}-${valid.slice(8)}`).kind === "valid", "hyphens stripped");

// Every single-digit misread must be caught.
let allCaught = true;
for (let i = 0; i < 12; i++) {
  for (let d = 0; d <= 9; d++) {
    if (String(d) === valid[i]) continue;
    const wrong = valid.slice(0, i) + d + valid.slice(i + 1);
    const kind = checkAadhaarNumber(wrong).kind;
    if (kind === "valid") allCaught = false;
  }
}
expect(allCaught, "every single-digit misread fails the checksum");
// Adjacent swaps too.
let swapsCaught = true;
for (let i = 0; i < 11; i++) {
  if (valid[i] === valid[i + 1]) continue;
  const swapped = valid.slice(0, i) + valid[i + 1] + valid[i] + valid.slice(i + 2);
  if (checkAadhaarNumber(swapped).kind === "valid") swapsCaught = false;
}
expect(swapsCaught, "every adjacent-digit swap fails the checksum");

expect(checkAadhaarNumber("9123 4567 8901 2345").kind === "vid", "16 digits → VID");
expect(checkAadhaarNumber("XXXX XXXX 1234").kind === "masked", "XXXX XXXX 1234 → masked");
expect(checkAadhaarNumber("xxxxxxxx5678").lastFour === "5678", "lowercase masked, last four kept");
expect(checkAadhaarNumber("****-****-4321").kind === "masked", "asterisk masked");
expect(checkAadhaarNumber("1234/56789/01234").kind === "invalid", "enrolment number → invalid");
expect(checkAadhaarNumber("12345678901").kind === "invalid", "11 digits → invalid");
expect(checkAadhaarNumber("012345678901").kind === "invalid", "starts with 0 → invalid");
expect(checkAadhaarNumber("ABCDE1234F").kind === "invalid", "PAN → invalid");

if (failed > 0) { console.error(`\n${failed} Aadhaar number test(s) failed.`); process.exit(1); }
console.log("\nAll Aadhaar number tests passed.");
