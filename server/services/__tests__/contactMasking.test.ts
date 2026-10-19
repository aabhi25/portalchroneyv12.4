/**
 * Tests for "hide contact details after sync" (shared/contactMasking.ts).
 * Run manually: `npx tsx server/services/__tests__/contactMasking.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import {
  contactsHidden,
  isMaskedValue,
  maskContactsDeep,
  maskContactsInJsonText,
  maskContactsInText,
  maskEmailAddress,
  maskPhoneNumber,
} from "@shared/contactMasking";

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) {
    failed++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

// ── Single values ────────────────────────────────────────────────────────────
expect(maskPhoneNumber("9876543210") === "******3210", "mobile: last four kept");
expect(maskPhoneNumber("+91 98765 43210") === "+** ***** *3210", "mobile: spacing and + kept");
expect(maskEmailAddress("rahul.k@gmail.com") === "ra***@gmail.com", "email: first two letters and domain kept");
expect(maskEmailAddress("a@x.in") === "a***@x.in", "email: one-letter name");
expect(isMaskedValue(maskPhoneNumber("9876543210")) && isMaskedValue(maskEmailAddress("ab@c.com")), "masked values are recognised");
expect(!isMaskedValue("9876543210") && !isMaskedValue("ravi@x.com") && !isMaskedValue(null), "real values are not");

// ── Free text ────────────────────────────────────────────────────────────────
{
  const t = maskContactsInText("My number is 9876543210 and email priya.s@yahoo.co.in, call after 5");
  expect(!t.includes("9876543210") && t.includes("******3210"), "number in a chat message hidden");
  expect(!t.includes("priya.s@") && t.includes("pr***@yahoo.co.in"), "email in a chat message hidden");
  expect(t.endsWith("call after 5"), "rest of the message kept");
  expect(maskContactsInText("+91-98765-43210 / 098765 43210").replace(/[^0-9]/g, "") === "32103210", "+91 and 0 prefixes hidden");
  expect(maskContactsInText("reach me on +44 7911 123456").includes("+** **** **3456"), "international + number hidden");
  expect(maskContactsInText("Order 1790000000000 at 2026-10-19, PIN 411014, fee ₹1,25,000") === "Order 1790000000000 at 2026-10-19, PIN 411014, fee ₹1,25,000", "timestamps, dates, PIN codes and amounts untouched");
  expect(maskContactsInText("id 5f0c1e2a-9b7d-4c3e-8a1f-2b3c4d5e6f70") === "id 5f0c1e2a-9b7d-4c3e-8a1f-2b3c4d5e6f70", "UUIDs untouched");
  const once = maskContactsInText("9876543210 ravi@x.com");
  expect(maskContactsInText(once) === once, "hiding twice changes nothing");
}

// ── JSON (message metadata, saved CRM payloads) ─────────────────────────────
{
  const deep = maskContactsDeep({ Phone: "+91-9876543210", EmailAddress: "ravi@x.com", n: 9876543210, ts: 1790000000000, list: ["call 9123456780"] });
  expect(deep.Phone === "+**-******3210" && deep.EmailAddress === "ra***@x.com", "payload fields hidden");
  expect(deep.n === "******3210" && deep.ts === 1790000000000, "phone-like number hidden, timestamp kept");
  expect(deep.list[0] === "call ******6780", "arrays walked");
  const json = maskContactsInJsonText(JSON.stringify({ formData: { mobile: "9876543210" }, productIds: ["p1"] }));
  expect(JSON.parse(json).formData.mobile === "******3210" && JSON.parse(json).productIds[0] === "p1", "metadata stays valid JSON");
  expect(maskContactsInJsonText("not json 9876543210") === "not json ******3210", "non-JSON metadata treated as text");
}

// ── CRM guard ────────────────────────────────────────────────────────────────
expect(contactsHidden({ phone: "******3210", email: "ra***@x.com" }), "fully hidden lead is not sent");
expect(contactsHidden({ phone: "******3210", email: null }), "hidden phone and no email is not sent");
expect(!contactsHidden({ phone: "9876543210", email: "ra***@x.com" }), "visitor gave a new number: lead can sync again");
expect(!contactsHidden({ phone: "9876543210", email: null }), "normal lead unaffected");

if (failed > 0) {
  console.error(`\n${failed} contact masking test(s) failed.`);
  process.exit(1);
}
console.log("\nAll contact masking tests passed.");
