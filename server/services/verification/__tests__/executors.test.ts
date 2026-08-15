/**
 * Smoke tests for verification rule executors.
 * Run manually: `npx tsx server/services/verification/__tests__/executors.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import { execute as runPresence } from "../executors/presence";
import { execute as runCross } from "../executors/crossField";
import { execute as runThreshold, normalizeCgpaToPercentage } from "../executors/threshold";
import { execute as runChrono } from "../executors/chronology";
import type { RuleContext } from "../types";
import type { VerificationRule } from "@shared/schema";

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) {
    failed++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

function rule(partial: Partial<VerificationRule> & Pick<VerificationRule, "ruleType" | "config" | "messageTemplate">): VerificationRule {
  return {
    id: "r-" + partial.ruleType,
    ruleSetId: "rs-1",
    name: "Test",
    severity: "warning",
    sortOrder: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as VerificationRule;
}

function ctx(leadFields: Record<string, any>, docTypes: string[] = []): RuleContext {
  return {
    lead: { id: "L", businessAccountId: "B" } as any,
    attachments: [] as any,
    docsByType: new Map(docTypes.map(dt => [dt, [{} as any]])),
    leadFields,
  };
}

// --- presence ----------------------------------------------------------
{
  const r = rule({ ruleType: "presence", severity: "blocker", messageTemplate: "Missing: {docs}", config: { requiredDocTypes: ["aadhaar_card", "tenth_marksheet"] } });
  expect(runPresence(r, ctx({}, ["aadhaar_card", "tenth_marksheet"])).status === "pass", "presence: all present → pass");
  const fail = runPresence(r, ctx({}, ["aadhaar_card"]));
  expect(fail.status === "fail" && fail.message.includes("tenth_marksheet"), "presence: missing → fail with doc name");
}

// --- cross_field exact -------------------------------------------------
{
  const r = rule({ ruleType: "cross_field", messageTemplate: "Mismatch: {values}", config: { field: "dob", docTypes: ["aadhaar_card", "tenth_marksheet"], comparator: "date" } });
  expect(runCross(r, ctx({ aadhaar_card_dob: "01/05/2000", tenth_marksheet_dob: "2000-05-01" })).status === "pass", "cross/date: equivalent formats → pass");
  expect(runCross(r, ctx({ aadhaar_card_dob: "01/05/2000", tenth_marksheet_dob: "02/05/2000" })).status === "fail", "cross/date: different → fail");
  expect(runCross(r, ctx({ aadhaar_card_dob: "01/05/2000" })).status === "skipped", "cross: <2 docs → skipped");
}

// --- cross_field fuzzy_name -------------------------------------------
{
  const r = rule({ ruleType: "cross_field", messageTemplate: "Name mismatch", config: { field: "name", docTypes: ["aadhaar_card", "graduation_marksheet"], comparator: "fuzzy_name", threshold: 0.85 } });
  expect(runCross(r, ctx({ aadhaar_card_name: "Rahul Kumar Sharma", graduation_marksheet_name: "Rahul Sharma" })).status === "pass", "fuzzy_name: token-subset → pass");
  expect(runCross(r, ctx({ aadhaar_card_name: "Rahul Sharma", graduation_marksheet_name: "Priya Patel" })).status === "fail", "fuzzy_name: different → fail");
}

// --- threshold + CGPA --------------------------------------------------
{
  const r = rule({ ruleType: "threshold", severity: "blocker", messageTemplate: "Score {values} < min", config: { docType: "graduation_marksheet", field: "percentage_or_cgpa", operator: ">=", value: 50, normalizeCgpa: true } });
  expect(runThreshold(r, ctx({ graduation_marksheet_percentage_or_cgpa: 7.5 })).status === "pass", "threshold/CGPA: 7.5 → 71.25% → pass");
  expect(runThreshold(r, ctx({ graduation_marksheet_percentage_or_cgpa: 4.5 })).status === "fail", "threshold/CGPA: 4.5 → 42.75% → fail");
  expect(runThreshold(r, ctx({ graduation_marksheet_percentage_or_cgpa: 65 })).status === "pass", "threshold: 65% raw → pass (no double-normalize)");
  expect(runThreshold(r, ctx({})).status === "skipped", "threshold: missing → skipped");
  expect(normalizeCgpaToPercentage(8) === 76, "normalizeCgpaToPercentage(8) = 76");
  expect(normalizeCgpaToPercentage(85) === 85, "normalizeCgpaToPercentage(85) = 85 (already %)");
}

// --- chronology --------------------------------------------------------
{
  const r = rule({ ruleType: "chronology", messageTemplate: "Gap {values}", config: { from: { docType: "twelfth_marksheet", field: "passing_year" }, to: { docType: "graduation_marksheet", field: "passing_year" }, maxGapYears: 3 } });
  expect(runChrono(r, ctx({ twelfth_marksheet_passing_year: 2018, graduation_marksheet_passing_year: 2021 })).status === "pass", "chrono: 3y gap == max → pass");
  expect(runChrono(r, ctx({ twelfth_marksheet_passing_year: "2015", graduation_marksheet_passing_year: "2021" })).status === "fail", "chrono: 6y gap → fail");
  expect(runChrono(r, ctx({ twelfth_marksheet_passing_year: 2018 })).status === "skipped", "chrono: missing → skipped");
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll verification executor tests passed.");
