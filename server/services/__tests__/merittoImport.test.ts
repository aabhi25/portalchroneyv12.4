/**
 * "Copy from LeadSquared" suggestions for Meritto field rows.
 * Run manually: `npx tsx server/services/__tests__/merittoImport.test.ts` (self-asserting).
 */
import { suggestMerittoRows, merittoNameFor } from "../merittoImport";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}

let order = 0;
const lsq = (leadsquaredField: string, source: string | null, extra: Partial<{ sourceType: string; customValue: string | null; fallbackValue: string | null; isEnabled: string; displayName: string }> = {}) => ({
  leadsquaredField,
  sourceType: extra.sourceType || "dynamic",
  sourceField: source,
  customValue: extra.customValue ?? null,
  fallbackValue: extra.fallbackValue ?? null,
  displayName: extra.displayName || leadsquaredField,
  isEnabled: extra.isEnabled || "true",
  sortOrder: ++order,
});

// The rows of an education account (as on its LeadSquared mapping page).
const rows = suggestMerittoRows([
  lsq("mx_Convo_Summary", "conversation.summary"),
  lsq("mx_Convo_topics", "conversation.topics"),
  lsq("mx_Select_Course", "journey.course"),
  lsq("FirstName", "lead.name"),
  lsq("EmailAddress", "lead.email"),
  lsq("Phone", "lead.phone"),
  lsq("mx_City", "session.city"),
  lsq("mx_CreatedAt", "lead.createdAt"),
  lsq("Mx_Business_Account", "business.name"),
  lsq("Mx_Website_Campaign", "lead.sourceUrl"),
  lsq("Source", null, { sourceType: "custom", customValue: "AI Chroney" }),
  lsq("mx_Secondary_Lead_Source", null, { sourceType: "custom", customValue: "AI Chroney" }),
  lsq("mx_Source_Campaign", "session.utmCampaign", { fallbackValue: "Website" }),
  lsq("mx_University", "urlLookup.university", { isEnabled: "false" }),
], [{ merittoField: "name" }, { merittoField: "Mobile" }]);

const by = (lsqField: string) => rows.find(r => r.leadsquaredField === lsqField)!;
const names = rows.map(r => r.merittoField);

expect(by("FirstName").merittoField === "name" && by("FirstName").status === "matched", "FirstName → name (matched)");
expect(by("EmailAddress").merittoField === "email", "EmailAddress → email");
expect(by("Phone").merittoField === "mobile" && by("Phone").sourceField === "meritto.mobileNumber", "Phone → mobile, sent without the country code");
const dial = rows.find(r => r.merittoField === "country_dial_code");
expect(dial && dial.sourceField === "meritto.dialCode" && dial.fallbackValue === "+91" && rows.indexOf(dial) === rows.indexOf(by("Phone")) + 1, "country_dial_code added right after mobile", dial);
expect(by("mx_City").merittoField === "city", "mx_City → city");
expect(by("mx_Source_Campaign").merittoField === "campaign" && by("mx_Source_Campaign").fallbackValue === "Website", "UTM campaign → campaign, fallback kept");
expect(by("mx_Select_Course").merittoField === "course" && by("mx_Select_Course").status === "check" && by("mx_Select_Course").sourceField === "journey.course", "journey answer → its Saved-as name, to check");
expect(by("mx_Convo_Summary").merittoField === "convo_summary" && by("mx_Convo_Summary").status === "check", "custom field → cleaned name, to check");
expect(by("Mx_Business_Account").merittoField === "business_account", "Mx_Business_Account → business_account");
expect(by("Source").merittoField === "source" && by("Source").sourceType === "custom" && by("Source").customValue === "AI Chroney", "fixed value kept");
expect(by("mx_University").status === "unsupported" && !by("mx_University").isEnabled, "URL-lookup values are marked not available (and off)");
expect(by("name" as any) === undefined && by("FirstName").existsInMeritto, "an existing Meritto row with the same name is flagged");
expect(by("Phone").existsInMeritto, "…matched case-insensitively (Mobile vs mobile)");
expect(!by("EmailAddress").existsInMeritto, "new names are not flagged");
expect(new Set(names).size === names.length, "no two rows get the same Meritto name", names);

// Two rows that both look like "source": the second one is renamed and flagged.
order = 0;
const dup = suggestMerittoRows([
  lsq("Source", "session.utmSource"),
  lsq("mx_Source", null, { sourceType: "custom", customValue: "Chatbot" }),
], []);
expect(dup[0].merittoField === "source" && dup[1].merittoField === "source_2" && dup[1].status === "check", "a clashing name gets _2 and must be checked", dup.map(r => r.merittoField));

expect(merittoNameFor("mx_Select_Course") === "select_course" && merittoNameFor("CreatedOn") === "created_on" && merittoNameFor("  ") === "field", "name cleaning");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll Meritto import suggestion tests passed.");
