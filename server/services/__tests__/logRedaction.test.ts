/**
 * Tests for log masking of personal data and secrets.
 * Run manually: `npx tsx server/services/__tests__/logRedaction.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import { redactPII } from "../../logRedaction";
import { verhoeffCheckDigit } from "@shared/aadhaar";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

const base = "23456789012";
const aadhaar = base + verhoeffCheckDigit(base);
const grouped = `${aadhaar.slice(0, 4)} ${aadhaar.slice(4, 8)} ${aadhaar.slice(8)}`;

let out = redactPII(`number ${aadhaar} here`);
expect(!out.includes(aadhaar) && out.includes(aadhaar.slice(-4)), "contiguous Aadhaar masked, last 4 kept", out);
out = redactPII(`Aadhaar ${grouped}`);
expect(!out.includes(grouped), "grouped Aadhaar masked", out);
out = redactPII(`ts=${Date.now()} id=123456789012`);
expect(out.includes("123456789012") && /ts=\d{13}/.test(out), "timestamps and non-Aadhaar 12-digit ids untouched", out);
out = redactPII("VID 9123 4567 8901 2345");
expect(!out.includes("9123 4567 8901") && out.endsWith("2345"), "VID masked", out);
out = redactPII("pan APRPC5124K ok");
expect(!out.includes("APRPC5124K") && out.includes("124K"), "PAN masked", out);
out = redactPII("SUCCESSFUL CHECKPOINT");
expect(out === "SUCCESSFUL CHECKPOINT", "ordinary words untouched", out);
out = redactPII(JSON.stringify({ bank_statement_password: "hunter2", account_number: 123456789, ifsc: "HDFC0001234", name: "Asha" }));
expect(!out.includes("hunter2") && !out.includes("123456789") && !out.includes("HDFC0001234") && out.includes("Asha"), "secrets and bank details in JSON redacted", out);
out = redactPII("url /api/webhook/msg91/abc?secret=s3cr3tvalue&x=1");
expect(!out.includes("s3cr3tvalue") && out.includes("x=1"), "secret query param redacted", out);
out = redactPII('{"x-webhook-secret":"abc123"}');
expect(!out.includes("abc123"), "webhook secret header redacted", out);
out = redactPII("Call 9876543210 now");
expect(!out.includes("9876543210") && out.includes("3210"), "phone still masked", out);
out = redactPII('{"total_tokens": 1234, "promptTokens": 99}');
expect(out.includes("1234") && out.includes("99"), "token counts not redacted", out);

if (failed > 0) { console.error(`\n${failed} redaction test(s) failed.`); process.exit(1); }
console.log("\nAll log redaction tests passed.");
