// Idempotent seed for the "Student Admission" demo rule set.
// Invoked per-business-account on first access (lazy seed) — see routes.

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { verificationRuleSets, verificationRules } from "@shared/schema";

const SEED_NAME = "Student Admission";
const SEED_DESCRIPTION = "Demo rule set for student admission verification. Clone or edit to customise.";
// Legacy names previously used for this seed — used to migrate older rows.
const LEGACY_SEED_NAMES = ["Student Admission — Jain Online"];

const SEED_RULES = [
  {
    ruleType: "presence",
    name: "Required documents present",
    severity: "blocker",
    sortOrder: 10,
    config: { requiredDocTypes: ["aadhaar_card", "tenth_marksheet", "twelfth_marksheet", "graduation_marksheet"] },
    messageTemplate: "Missing required documents: {docs}",
  },
  {
    ruleType: "cross_field",
    name: "Name matches across all documents",
    severity: "warning",
    sortOrder: 20,
    config: {
      field: "name",
      docTypes: ["aadhaar_card", "tenth_marksheet", "twelfth_marksheet", "graduation_marksheet"],
      comparator: "fuzzy_name",
      threshold: 0.85,
    },
    messageTemplate: "Name mismatch across documents ({docs}): {values}",
  },
  {
    ruleType: "cross_field",
    name: "Date of birth matches",
    severity: "blocker",
    sortOrder: 30,
    config: {
      field: "dob",
      docTypes: ["aadhaar_card", "tenth_marksheet", "twelfth_marksheet"],
      comparator: "date",
    },
    messageTemplate: "Date of birth differs across {docs}: {values}",
  },
  {
    ruleType: "threshold",
    name: "Graduation percentage ≥ 50%",
    severity: "blocker",
    sortOrder: 40,
    config: {
      docType: "graduation_marksheet",
      field: "percentage_or_cgpa",
      operator: ">=",
      value: 50,
      normalizeCgpa: true,
    },
    messageTemplate: "Graduation score {values} below required minimum (≥ 50%).",
  },
  {
    ruleType: "chronology",
    name: "Gap between 12th and Graduation ≤ 3 years",
    severity: "warning",
    sortOrder: 50,
    config: {
      from: { docType: "twelfth_marksheet", field: "passing_year" },
      to: { docType: "graduation_marksheet", field: "passing_year" },
      maxGapYears: 3,
    },
    messageTemplate: "Education gap detected: {values} years between 12th and Graduation.",
  },
] as const;

/**
 * Ensure the demo seed rule set exists for the given business account.
 * Safe to call repeatedly — only inserts when the seed is absent.
 */
export async function ensureSeedRuleSet(businessAccountId: string): Promise<string> {
  // Match by isSystemSeed so we can locate the seed regardless of any
  // previous (legacy) name. If none, fall back to looking up by current
  // name. Either way, we then rename/update legacy rows in place so users
  // don't see duplicates after a rename.
  const existingRows = await db
    .select()
    .from(verificationRuleSets)
    .where(and(
      eq(verificationRuleSets.businessAccountId, businessAccountId),
      eq(verificationRuleSets.isSystemSeed, true),
    ));

  let existing = existingRows.find(r => r.name === SEED_NAME)
    ?? existingRows.find(r => LEGACY_SEED_NAMES.includes(r.name));

  if (!existing) {
    const [legacyByName] = await db
      .select()
      .from(verificationRuleSets)
      .where(and(
        eq(verificationRuleSets.businessAccountId, businessAccountId),
        eq(verificationRuleSets.name, SEED_NAME),
      ))
      .limit(1);
    existing = legacyByName;
  }

  if (existing) {
    if (existing.name !== SEED_NAME) {
      await db
        .update(verificationRuleSets)
        .set({ name: SEED_NAME, description: SEED_DESCRIPTION })
        .where(eq(verificationRuleSets.id, existing.id));
    }
    return existing.id;
  }

  const [created] = await db
    .insert(verificationRuleSets)
    .values({
      businessAccountId,
      name: SEED_NAME,
      description: SEED_DESCRIPTION,
      isActive: true,
      isSystemSeed: true,
    })
    .returning();

  await db.insert(verificationRules).values(
    SEED_RULES.map(r => ({
      ruleSetId: created.id,
      ruleType: r.ruleType,
      name: r.name,
      severity: r.severity,
      sortOrder: r.sortOrder,
      config: r.config as any,
      messageTemplate: r.messageTemplate,
      isActive: true,
    })),
  );

  console.log(`[Verification] Seeded "${SEED_NAME}" for business ${businessAccountId}`);
  return created.id;
}
