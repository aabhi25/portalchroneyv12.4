/**
 * LeadSquared field mappings: "Add +91 to 10-digit numbers" (shared/phoneFormat.ts).
 * Run: npx tsx server/services/__tests__/lsqPhoneCountryCode.test.ts
 */
import { LeadSquaredService, type LeadDataContext } from "../leadsquaredService";
import type { LeadsquaredFieldMapping } from "@shared/schema";
import { formatPhoneWithCountryCode, normalizeCountryCode, phoneCodeExample } from "@shared/phoneFormat";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); }
  else console.log(`✓ ${label}`);
}

// ── Formatter ────────────────────────────────────────────────────────────────
const cases: Array<[string, string, string]> = [
  // input, dash (default), compact
  ["9876543210", "+91-9876543210", "+919876543210"],
  ["98765 43210", "+91-9876543210", "+919876543210"],
  ["09876543210", "+91-9876543210", "+919876543210"],
  ["919876543210", "+91-9876543210", "+919876543210"],
  ["+91 98765-43210", "+91-9876543210", "+919876543210"],
  ["+919876543210", "+91-9876543210", "+919876543210"],
  ["+91-9876543210", "+91-9876543210", "+919876543210"],
  ["0091 98765 43210", "+91-9876543210", "+919876543210"],
];
for (const [input, dash, compact] of cases) {
  expect(formatPhoneWithCountryCode(input) === dash, `"${input}" → ${dash} (default style)`, formatPhoneWithCountryCode(input));
  expect(formatPhoneWithCountryCode(input, "91", "compact") === compact, `"${input}" → ${compact} (compact)`, formatPhoneWithCountryCode(input, "91", "compact"));
}
for (const input of ["+44 20 7946 0958", "+1 415 555 0100", "12345", "98765432", "abc", ""]) {
  expect(formatPhoneWithCountryCode(input) === input, `"${input}" left unchanged`, formatPhoneWithCountryCode(input));
}
expect(formatPhoneWithCountryCode(null) === null && formatPhoneWithCountryCode(undefined) === undefined, "null / undefined pass through");
expect(normalizeCountryCode("+91") === "91" && normalizeCountryCode("0") === null && normalizeCountryCode("abc") === null, "country code validated");
expect(phoneCodeExample() === "+91-9876543210" && phoneCodeExample("91", "compact") === "+919876543210", "UI examples");

// ── LeadSquared attributes ───────────────────────────────────────────────────
function mapping(partial: Partial<LeadsquaredFieldMapping> & Pick<LeadsquaredFieldMapping, "leadsquaredField" | "sourceType" | "sourceField">): LeadsquaredFieldMapping {
  return {
    id: "m-" + partial.leadsquaredField, businessAccountId: "biz-1", customValue: null, fallbackValue: null, valueWhenPresent: null,
    phoneCountryCode: null, phoneCodeStyle: null, displayName: partial.leadsquaredField, isEnabled: "true", sortOrder: 0,
    createdAt: new Date(), updatedAt: new Date(), ...partial,
  } as LeadsquaredFieldMapping;
}
const svc = new LeadSquaredService({ accessKey: "ak", secretKey: "sk", region: "india" });
const ctx = (phone: string, whatsapp?: string): LeadDataContext => ({ lead: { name: "Ada", phone, whatsapp }, session: {}, business: { name: "Jaro" } });
const value = (attrs: { Attribute: string; Value: string }[], field: string) => attrs.find((a) => a.Attribute === field)?.Value;

{
  const attrs = svc.buildAttributesFromMappings([
    mapping({ leadsquaredField: "Phone", sourceType: "dynamic", sourceField: "lead.phone", phoneCountryCode: "91", phoneCodeStyle: "dash" }),
    mapping({ leadsquaredField: "mx_WhatsApp", sourceType: "dynamic", sourceField: "lead.whatsapp" }),
  ], ctx("9876543210", "9123456780"));
  expect(value(attrs, "Phone") === "+91-9876543210", "Phone with the option on → +91-9876543210", value(attrs, "Phone"));
  expect(value(attrs, "mx_WhatsApp") === "9123456780", "another phone field without the option → sent as captured", value(attrs, "mx_WhatsApp"));
}
{
  const attrs = svc.buildAttributesFromMappings([
    mapping({ leadsquaredField: "Phone", sourceType: "dynamic", sourceField: "lead.phone", phoneCountryCode: "91", phoneCodeStyle: "compact" }),
  ], ctx("09876543210"));
  expect(value(attrs, "Phone") === "+919876543210", "compact style → +919876543210 (leading 0 removed)", value(attrs, "Phone"));
}
{
  const attrs = svc.buildAttributesFromMappings([
    mapping({ leadsquaredField: "Phone", sourceType: "dynamic", sourceField: "lead.phone", phoneCountryCode: "91" }),
  ], ctx("+447911123456"));
  expect(value(attrs, "Phone") === "+447911123456", "a foreign number is never given +91", value(attrs, "Phone"));
}
{
  const attrs = svc.buildAttributesFromMappings([
    mapping({ leadsquaredField: "Phone", sourceType: "dynamic", sourceField: "lead.phone" }),
  ], ctx("9876543210"));
  expect(value(attrs, "Phone") === "9876543210", "option off (existing mappings) → unchanged", value(attrs, "Phone"));
}
{
  const attrs = svc.buildAttributesFromMappings([
    mapping({ leadsquaredField: "mx_HasPhone", sourceType: "dynamic", sourceField: "lead.phone", phoneCountryCode: "91", valueWhenPresent: "Yes" }),
  ], ctx("9876543210"));
  expect(value(attrs, "mx_HasPhone") === "Yes", "'value when present' still wins over the phone format", value(attrs, "mx_HasPhone"));
}

console.log(`\n${failed === 0 ? "All LeadSquared phone country-code checks passed." : `${failed} check(s) FAILED.`}`);
process.exit(failed ? 1 : 0);
