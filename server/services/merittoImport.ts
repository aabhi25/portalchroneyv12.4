/**
 * "Copy from LeadSquared" on the Meritto settings page: an account moving from LeadSquared to
 * Meritto gets its LeadSquared field rows as suggested Meritto rows, reviewed before saving.
 *
 * A row keeps its source, fixed value, fallback and on/off. Only the field name changes: the
 * standard ones are known (FirstName ← lead name → "name", Phone → "mobile" without the country
 * code, …); custom fields get a suggested name to check, because Meritto custom field names are
 * set up in each Meritto account.
 */
import type { LeadsquaredFieldMapping, MerittoFieldMapping } from "@shared/schema";

export type MerittoImportStatus = "matched" | "check" | "unsupported";

export interface MerittoImportRow {
  /** The LeadSquared row this came from ("" for the added country dial code row). */
  leadsquaredField: string;
  displayName: string;
  merittoField: string;
  sourceType: "dynamic" | "custom";
  sourceField: string | null;
  customValue: string | null;
  fallbackValue: string | null;
  isEnabled: boolean;
  status: MerittoImportStatus;
  note: string | null;
  /** A Meritto row with this field name already exists. */
  existsInMeritto: boolean;
}

// Sources Meritto knows the standard field for.
const STANDARD_BY_SOURCE: Record<string, string> = {
  "lead.name": "name",
  "lead.email": "email",
  "lead.phone": "mobile",
  "lead.whatsapp": "mobile",
  "session.city": "city",
  "session.utmSource": "source",
  "session.utmMedium": "medium",
  "session.utmCampaign": "campaign",
};

/** Sources a Meritto lead has no value for. */
const UNSUPPORTED_SOURCE = /^urlLookup\./;

/** "mx_Select_Course" → "select_course", "Mx_Business_Account" → "business_account". */
export function merittoNameFor(leadsquaredField: string): string {
  return leadsquaredField.trim()
    .replace(/^mx_/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "field";
}

export function suggestMerittoRows(
  leadsquared: Pick<LeadsquaredFieldMapping, "leadsquaredField" | "sourceType" | "sourceField" | "customValue" | "fallbackValue" | "displayName" | "isEnabled" | "sortOrder">[],
  existingMeritto: Pick<MerittoFieldMapping, "merittoField">[],
): MerittoImportRow[] {
  const existing = new Set(existingMeritto.map(m => m.merittoField.trim().toLowerCase()));
  const used = new Set<string>();
  const rows: MerittoImportRow[] = [];

  for (const m of [...leadsquared].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const sourceType = m.sourceType === "custom" ? "custom" : "dynamic";
    let sourceField = sourceType === "dynamic" ? (m.sourceField || null) : null;
    let status: MerittoImportStatus = "check";
    let note: string | null = "Check this name in your Meritto account";
    let name: string;

    const standard = sourceField ? STANDARD_BY_SOURCE[sourceField] : undefined;
    if (standard && !used.has(standard)) {
      name = standard;
      status = "matched";
      note = null;
      if (standard === "mobile") {
        // Meritto wants the number without the country code; the code goes in country_dial_code.
        sourceField = "meritto.mobileNumber";
        note = "Sent without the country code (added below)";
      }
    } else if (sourceField?.startsWith("journey.")) {
      name = merittoNameFor(sourceField.slice("journey.".length));
    } else {
      name = merittoNameFor(m.leadsquaredField);
    }
    if (sourceField && UNSUPPORTED_SOURCE.test(sourceField)) {
      status = "unsupported";
      note = "Meritto leads don't have this value (LeadSquared URL lookup only)";
    }
    // Two LeadSquared rows can't both become the same Meritto field.
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name}_${n}`)) n++;
      name = `${name}_${n}`;
      if (status === "matched") status = "check";
      note = "Another row already uses this name: check it";
    }
    used.add(name);

    rows.push({
      leadsquaredField: m.leadsquaredField,
      displayName: m.displayName || m.leadsquaredField,
      merittoField: name,
      sourceType,
      sourceField,
      customValue: sourceType === "custom" ? (m.customValue ?? null) : null,
      fallbackValue: sourceType === "dynamic" ? (m.fallbackValue ?? null) : null,
      isEnabled: m.isEnabled === "true" && status !== "unsupported",
      status,
      note,
      existsInMeritto: existing.has(name.toLowerCase()),
    });

    if (status === "matched" && name === "mobile" && !used.has("country_dial_code")) {
      used.add("country_dial_code");
      rows.push({
        leadsquaredField: "",
        displayName: "Country dial code",
        merittoField: "country_dial_code",
        sourceType: "dynamic",
        sourceField: "meritto.dialCode",
        customValue: null,
        fallbackValue: "+91",
        isEnabled: m.isEnabled === "true",
        status: "matched",
        note: "Goes with mobile",
        existsInMeritto: existing.has("country_dial_code"),
      });
    }
  }
  return rows;
}
