/**
 * Pure-logic smoke tests for incremental verification context-building.
 * Run manually: `npx tsx server/services/verification/__tests__/incremental.test.ts`
 *
 * These tests exercise the in-process executors against a RuleContext built
 * the same way `buildSessionRuleContext` does internally — we re-implement
 * that mapping here to avoid pulling in the DB-bound `runIncrementalVerification`
 * entrypoint. The shape contract (prefixed flat + nested + `{type}_card`
 * variant) is what we're protecting.
 */
import { execute as runCross } from "../executors/crossField";
import { execute as runThreshold } from "../executors/threshold";
import { execute as runChrono } from "../executors/chronology";
import { getRuleRequiredDocs } from "../index";
import type { RuleContext } from "../types";
import type { VerificationRule } from "@shared/schema";

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) { failed++; console.error(`✗ ${label}`); } else { console.log(`✓ ${label}`); }
}

function rule(partial: Partial<VerificationRule> & Pick<VerificationRule, "ruleType" | "config" | "messageTemplate">): VerificationRule {
  return {
    id: "r-" + partial.ruleType, ruleSetId: "rs-1", name: "Test", severity: "warning",
    sortOrder: 0, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...partial,
  } as VerificationRule;
}

function normalizeDocKey(k: string): string {
  return String(k || "").toLowerCase().replace(/_card$/, "");
}

// Mirror of buildSessionRuleContext from index.ts (kept in sync intentionally).
function buildCtxFromSession(collectedData: Record<string, any>, businessAccountId = "B"): RuleContext {
  const collectedDocs: Record<string, any> = collectedData?._collectedDocuments || {};
  const leadFields: Record<string, any> = {};
  const docsByType = new Map<string, any[]>();
  for (const [k, v] of Object.entries(collectedData || {})) {
    if (k.startsWith("_")) continue;
    leadFields[k] = v;
  }
  for (const [rawKey, doc] of Object.entries(collectedDocs)) {
    if (!doc || typeof doc !== "object") continue;
    if ((doc as any).isValid === false) continue;
    const normalized = normalizeDocKey(rawKey);
    const extracted: Record<string, any> = ((doc as any).extractedData as any) || {};
    const variants = Array.from(new Set([normalized, `${normalized}_card`]));
    const stub = [{ documentCategory: normalized }];
    for (const variant of variants) {
      docsByType.set(variant, stub as any);
      leadFields[variant] = { ...(leadFields[variant] || {}), ...extracted };
      for (const [fk, fv] of Object.entries(extracted)) {
        leadFields[`${variant}_${fk}`] = fv;
      }
    }
  }
  return { lead: { id: "", businessAccountId } as any, attachments: [] as any, docsByType, leadFields };
}

// --- getRuleRequiredDocs ---------------------------------------------------
{
  expect(JSON.stringify(getRuleRequiredDocs(rule({
    ruleType: "cross_field", messageTemplate: "x",
    config: { docTypes: ["aadhaar_card", "pan_card"], field: "name", comparator: "exact" },
  }))) === JSON.stringify(["aadhaar_card", "pan_card"]), "getRuleRequiredDocs: cross_field");

  expect(JSON.stringify(getRuleRequiredDocs(rule({
    ruleType: "threshold", messageTemplate: "x",
    config: { docType: "graduation_marksheet", field: "percentage", operator: ">=", value: 50 },
  }))) === JSON.stringify(["graduation_marksheet"]), "getRuleRequiredDocs: threshold");

  expect(JSON.stringify(getRuleRequiredDocs(rule({
    ruleType: "chronology", messageTemplate: "x",
    config: { from: { docType: "tenth_marksheet", field: "passing_year" }, to: { docType: "twelfth_marksheet", field: "passing_year" } },
  }))) === JSON.stringify(["tenth_marksheet", "twelfth_marksheet"]), "getRuleRequiredDocs: chronology");

  expect(getRuleRequiredDocs(rule({
    ruleType: "presence", messageTemplate: "x", config: { requiredDocTypes: ["aadhaar_card"] },
  })).length === 1, "getRuleRequiredDocs: presence");
}

// --- session ctx exposes both '_card' and unsuffixed variants -------------
{
  const session = {
    name: "Rahul",
    _collectedDocuments: {
      aadhaar: { extractedData: { dob: "01/05/2000", name: "Rahul Sharma" } },
      pan: { extractedData: { dob: "02/05/2000", name: "Rahul Sharma" } },
    },
  };
  const ctx = buildCtxFromSession(session);

  expect(ctx.docsByType.has("aadhaar") && ctx.docsByType.has("aadhaar_card"), "ctx: aadhaar exposed under both keys");
  expect(ctx.docsByType.has("pan") && ctx.docsByType.has("pan_card"), "ctx: pan exposed under both keys");
  expect(ctx.leadFields.aadhaar_card_dob === "01/05/2000", "ctx: prefixed flat aadhaar_card_dob present");
  expect(ctx.leadFields.aadhaar_dob === "01/05/2000", "ctx: prefixed flat aadhaar_dob present");

  // Rule configured with _card suffix resolves
  const r = rule({ ruleType: "cross_field", messageTemplate: "DOB mismatch: {values}",
    config: { docTypes: ["aadhaar_card", "pan_card"], field: "dob", comparator: "date" } });
  const f = runCross(r, ctx);
  expect(f.status === "fail", "cross_field with _card-suffixed docTypes detects mismatch");
  expect(f.message.includes("01/05/2000") && f.message.includes("02/05/2000"), "fail message includes both DOB values");
}

// --- only one doc present → executor returns "skipped" --------------------
{
  const session = { _collectedDocuments: { aadhaar: { extractedData: { dob: "01/05/2000" } } } };
  const ctx = buildCtxFromSession(session);
  const r = rule({ ruleType: "cross_field", messageTemplate: "x",
    config: { docTypes: ["aadhaar_card", "pan_card"], field: "dob", comparator: "date" } });
  expect(runCross(r, ctx).status === "skipped", "cross: only 1 doc present → skipped");
  // And from the runner's perspective the rule would be filtered before exec
  // because docsByType won't have 'pan' or 'pan_card'.
  expect(!(ctx.docsByType.has("pan") || ctx.docsByType.has("pan_card")), "runner skip-guard: missing doc absent from docsByType");
}

// --- threshold + chronology against session -------------------------------
{
  const session = {
    _collectedDocuments: {
      graduation_marksheet: { extractedData: { percentage_or_cgpa: 8.0 } },
      tenth_marksheet: { extractedData: { passing_year: "2018" } },
      twelfth_marksheet: { extractedData: { passing_year: "2020" } },
    },
  };
  const ctx = buildCtxFromSession(session);

  const t = rule({ ruleType: "threshold", severity: "blocker", messageTemplate: "Score {values}",
    config: { docType: "graduation_marksheet", field: "percentage_or_cgpa", operator: ">=", value: 50, normalizeCgpa: true } });
  expect(runThreshold(t, ctx).status === "pass", "threshold from session: 8.0 CGPA → 76% → pass");

  const c = rule({ ruleType: "chronology", messageTemplate: "Gap {values}",
    config: { from: { docType: "tenth_marksheet", field: "passing_year" }, to: { docType: "twelfth_marksheet", field: "passing_year" }, maxGapYears: 3 } });
  expect(runChrono(c, ctx).status === "pass", "chronology from session: 2018→2020 within 3y → pass");
}

// --- rejected/invalid docs are excluded from context ----------------------
{
  const session = {
    _collectedDocuments: {
      aadhaar: { extractedData: { dob: "01/05/2000" }, isValid: false }, // rejected
      pan: { extractedData: { dob: "02/05/2000" } },
    },
  };
  const ctx = buildCtxFromSession(session);
  expect(!ctx.docsByType.has("aadhaar"), "ctx: isValid:false doc is excluded");
  expect(ctx.docsByType.has("pan"), "ctx: valid doc remains");
}

// --- Dedup + rejection semantics simulation -------------------------------
//
// Mirrors `runInstantVerification`'s dedup/reject logic against in-memory
// state. Protects the critical invariant: re-uploading the same bad doc must
// reject it again, even though the rule ID is already in `_verifiedRuleFailures`.
//
type SimFailure = { ruleId: string; implicatedDocs: string[]; message: string; severity: "info" | "warning" | "blocker" };

function simulateInstantStep(
  collectedData: Record<string, any>,
  failures: SimFailure[],
  justUploadedDocType: string,
): { rejectUploadedDoc: boolean; messagedFailures: string[] } {
  const normalizedUploaded = justUploadedDocType.toLowerCase().replace(/_card$/, "");
  const implicating = failures.filter(f => f.implicatedDocs.includes(normalizedUploaded));
  const otherDoc = failures.filter(f => !f.implicatedDocs.includes(normalizedUploaded));
  const alreadyNotified: string[] = Array.isArray(collectedData._verifiedRuleFailures)
    ? collectedData._verifiedRuleFailures : [];
  const currentIds = new Set(failures.map(f => f.ruleId));
  const stillNotified = alreadyNotified.filter(id => currentIds.has(id));
  const newOtherDoc = otherDoc.filter(f => !stillNotified.includes(f.ruleId));
  collectedData._verifiedRuleFailures = Array.from(new Set([
    ...stillNotified, ...newOtherDoc.map(f => f.ruleId),
  ]));
  const messaged = [...implicating, ...newOtherDoc].map(f => f.ruleId);
  return { rejectUploadedDoc: implicating.length > 0, messagedFailures: messaged };
}

{
  // Scenario 1: User uploads bad PAN that mismatches Aadhaar DOB.
  //   → reject + message.
  // Re-uploads the same bad PAN.
  //   → must reject + message AGAIN, even though rule is in the dedup set.
  const collectedData: Record<string, any> = {};
  const ruleX: SimFailure = { ruleId: "rule-dob", implicatedDocs: ["aadhaar", "pan"], message: "DOB mismatch", severity: "blocker" };

  const step1 = simulateInstantStep(collectedData, [ruleX], "pan");
  expect(step1.rejectUploadedDoc === true, "dedup: first bad PAN upload → rejected");
  expect(step1.messagedFailures.includes("rule-dob"), "dedup: first failure messaged");

  const step2 = simulateInstantStep(collectedData, [ruleX], "pan");
  expect(step2.rejectUploadedDoc === true, "dedup: re-upload of same bad PAN → STILL rejected (regression test)");
  expect(step2.messagedFailures.includes("rule-dob"), "dedup: implicating failure re-messaged on retry");
}

{
  // Scenario 2: failure on OTHER doc (not just-uploaded) should be dedup'd.
  // Upload Aadhaar; verification fails on a rule about (pan, tenth_marksheet)
  // — neither implicates aadhaar. First aadhaar upload messages it; second
  // aadhaar upload (same failure persisting) should NOT re-message.
  const collectedData: Record<string, any> = {};
  const ruleY: SimFailure = { ruleId: "rule-other", implicatedDocs: ["pan", "tenth_marksheet"], message: "Other mismatch", severity: "warning" };

  const step1 = simulateInstantStep(collectedData, [ruleY], "aadhaar");
  expect(step1.rejectUploadedDoc === false, "dedup: other-doc failure does NOT reject just-uploaded aadhaar");
  expect(step1.messagedFailures.includes("rule-other"), "dedup: other-doc failure messaged first time");

  const step2 = simulateInstantStep(collectedData, [ruleY], "aadhaar");
  expect(step2.rejectUploadedDoc === false, "dedup: subsequent aadhaar upload still no reject");
  expect(!step2.messagedFailures.includes("rule-other"), "dedup: other-doc failure NOT re-messaged (dedup'd)");
}

{
  // Scenario 3: fail → pass → fail. Stale dedup entries should be pruned so
  // a recurrence is re-notified.
  const collectedData: Record<string, any> = {};
  const ruleZ: SimFailure = { ruleId: "rule-z", implicatedDocs: ["pan", "tenth_marksheet"], message: "Z", severity: "warning" };

  simulateInstantStep(collectedData, [ruleZ], "aadhaar"); // notify
  expect((collectedData._verifiedRuleFailures as string[]).includes("rule-z"), "dedup: rule-z recorded");

  simulateInstantStep(collectedData, [], "tenth_marksheet"); // pass — prune
  expect(!(collectedData._verifiedRuleFailures as string[]).includes("rule-z"), "dedup: stale rule pruned when no longer failing");

  const step3 = simulateInstantStep(collectedData, [ruleZ], "aadhaar"); // fails again
  expect(step3.messagedFailures.includes("rule-z"), "dedup: rule re-notified after fail→pass→fail");
}

{
  // Scenario 4: blocker failure on the uploaded doc + warning on another doc,
  // mixed in same pass. Reject + both messaged on first pass; on re-upload of
  // bad doc with same state, blocker re-messaged but warning dedup'd.
  const collectedData: Record<string, any> = {};
  const blocker: SimFailure = { ruleId: "blocker-1", implicatedDocs: ["pan", "aadhaar"], message: "Name mismatch", severity: "blocker" };
  const warn:    SimFailure = { ruleId: "warn-1",    implicatedDocs: ["tenth_marksheet", "twelfth_marksheet"], message: "Year gap large", severity: "warning" };

  const step1 = simulateInstantStep(collectedData, [blocker, warn], "pan");
  expect(step1.rejectUploadedDoc === true, "mixed: first pass rejects on blocker implicating pan");
  expect(step1.messagedFailures.includes("blocker-1") && step1.messagedFailures.includes("warn-1"), "mixed: both messaged first pass");

  const step2 = simulateInstantStep(collectedData, [blocker, warn], "pan");
  expect(step2.rejectUploadedDoc === true, "mixed: re-upload still rejected");
  expect(step2.messagedFailures.includes("blocker-1"), "mixed: implicating blocker re-messaged on re-upload");
  expect(!step2.messagedFailures.includes("warn-1"), "mixed: other-doc warning dedup'd on re-upload");
}

// --- Regression: hardcoded mismatch-message strings stay out of the codebase --
//
// Task #2 removed the built-in `checkFieldMismatches` name-guard and its
// hardcoded customer-facing wording. The configured rule engine's
// `messageTemplate` is now the only source of truth for cross-document
// mismatch messages. If these strings reappear in `server/`, a regression
// has slipped a hardcoded template back into the upload paths.
{
  const { execSync } = await import("child_process");
  const path = await import("path");
  const url = await import("url");
  const __filenameLocal = url.fileURLToPath(import.meta.url);
  const __dirnameLocal = path.dirname(__filenameLocal);
  const serverDir = path.resolve(__dirnameLocal, "../../../");
  const forbiddenPatterns = [
    "name you provided earlier",
    "on this document.*does not match.*you provided earlier",
    "checkFieldMismatches",
  ];
  for (const pat of forbiddenPatterns) {
    let hits = "";
    try {
      hits = execSync(
        `rg -n --no-heading -e ${JSON.stringify(pat)} ${JSON.stringify(serverDir)} ` +
        `-g '!**/__tests__/**' -g '!**/*.test.ts' || true`,
        { encoding: "utf8" }
      ).trim();
    } catch { hits = ""; }
    // Allow the explanatory comment block (single line, prefixed with `//`).
    const offending = hits.split("\n").filter(l => l && !/^\S+:\d+:\s*\/\//.test(l)).join("\n");
    expect(offending === "", `regression: no production code emits "${pat}"${offending ? "\n      offending:\n      " + offending.replace(/\n/g, "\n      ") : ""}`);
  }
}

if (failed > 0) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
console.log("\nAll incremental verification tests passed.");
