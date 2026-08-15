// Configurable Verification Engine — orchestrator + registry.
// See .local/tasks/task-5.md for the full design.

import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  verificationRuleSets,
  verificationRules,
  whatsappLeadAttachments,
  whatsappLeads,
  type VerificationRule,
} from "@shared/schema";
import type { Finding, RuleContext, RuleExecutor, VerificationResult, Verdict } from "./types";
import * as presence from "./executors/presence";
import * as crossField from "./executors/crossField";
import * as threshold from "./executors/threshold";
import * as chronology from "./executors/chronology";

const REGISTRY: Record<string, RuleExecutor> = {
  presence: presence.execute,
  cross_field: crossField.execute,
  threshold: threshold.execute,
  chronology: chronology.execute,
};

function computeVerdict(findings: Finding[]): Verdict {
  let anyOtherBlockerFail = false;
  let anyWarningFail = false;
  let anyPresencePending = false; // missing required docs OR presence-skipped
  for (const f of findings) {
    if (f.ruleType === "presence" && (f.status === "fail" || f.status === "skipped")) {
      anyPresencePending = true;
      continue;
    }
    if (f.status === "fail" && f.severity === "blocker") anyOtherBlockerFail = true;
    if (f.status === "fail" && f.severity === "warning") anyWarningFail = true;
  }
  // Pending (missing required docs) takes precedence over Discrepancy — you cannot
  // assess discrepancies until you have the documents.
  if (anyPresencePending) return "Pending";
  if (anyOtherBlockerFail) return "Discrepancy";
  if (anyWarningFail) return "Conditionally Eligible";
  return "Eligible";
}

export interface RunVerificationInput {
  leadId: string;
  ruleSetId: string;
}

export async function runVerification(
  { leadId, ruleSetId }: RunVerificationInput,
): Promise<VerificationResult> {
  // Load lead
  const [lead] = await db.select().from(whatsappLeads).where(eq(whatsappLeads.id, leadId)).limit(1);
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  // Load rule set (must belong to same business account)
  const [ruleSet] = await db
    .select()
    .from(verificationRuleSets)
    .where(and(
      eq(verificationRuleSets.id, ruleSetId),
      eq(verificationRuleSets.businessAccountId, lead.businessAccountId),
    ))
    .limit(1);
  if (!ruleSet) throw new Error(`Rule set ${ruleSetId} not found for this business account`);

  // Load rules (active only, in sort order)
  const rules = await db
    .select()
    .from(verificationRules)
    .where(and(eq(verificationRules.ruleSetId, ruleSetId), eq(verificationRules.isActive, true)))
    .orderBy(asc(verificationRules.sortOrder), asc(verificationRules.createdAt));

  // Load attachments and build context
  const attachments = await db
    .select()
    .from(whatsappLeadAttachments)
    .where(eq(whatsappLeadAttachments.leadId, leadId));

  const docsByType = new Map<string, typeof attachments>();
  for (const att of attachments) {
    if (!att.documentCategory) continue;
    const list = docsByType.get(att.documentCategory) || [];
    list.push(att);
    docsByType.set(att.documentCategory, list);
  }

  const ctx: RuleContext = {
    lead,
    attachments,
    docsByType,
    leadFields: (lead.extractedData as Record<string, any>) || {},
  };

  const findings: Finding[] = [];
  for (const rule of rules) {
    const exec = REGISTRY[rule.ruleType];
    if (!exec) {
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        severity: rule.severity as Finding["severity"],
        status: "skipped",
        message: `Unknown rule type "${rule.ruleType}" — skipped.`,
        evidence: { details: "No executor registered" },
      });
      continue;
    }
    try {
      findings.push(exec(rule, ctx));
    } catch (err: any) {
      console.error(`[Verification] Executor error for rule ${rule.id}:`, err);
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        severity: rule.severity as Finding["severity"],
        status: "skipped",
        message: `Internal error evaluating rule: ${err?.message || err}`,
        evidence: { details: String(err?.message || err) },
      });
    }
  }

  const counts = {
    total: findings.length,
    pass: findings.filter(f => f.status === "pass").length,
    fail: findings.filter(f => f.status === "fail").length,
    skipped: findings.filter(f => f.status === "skipped").length,
  };

  const result: VerificationResult = {
    ruleSetId,
    ruleSetName: ruleSet.name,
    ranAt: new Date().toISOString(),
    verdict: computeVerdict(findings),
    findings,
    counts,
  };

  // Persist on the lead (expand-only — overwrites previous result)
  await db
    .update(whatsappLeads)
    .set({
      verificationResults: result as any,
      verificationRunAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(whatsappLeads.id, leadId));

  return result;
}

export async function getLeadVerification(leadId: string): Promise<VerificationResult | null> {
  const [lead] = await db
    .select({ result: whatsappLeads.verificationResults })
    .from(whatsappLeads)
    .where(eq(whatsappLeads.id, leadId))
    .limit(1);
  if (!lead || !lead.result) return null;
  return lead.result as VerificationResult;
}

export async function listRuleSets(businessAccountId: string) {
  return db
    .select()
    .from(verificationRuleSets)
    .where(eq(verificationRuleSets.businessAccountId, businessAccountId))
    .orderBy(asc(verificationRuleSets.createdAt));
}

export async function listRules(ruleSetId: string) {
  return db
    .select()
    .from(verificationRules)
    .where(eq(verificationRules.ruleSetId, ruleSetId))
    .orderBy(asc(verificationRules.sortOrder), asc(verificationRules.createdAt));
}

// ---------------------------------------------------------------------------
// Incremental (per-upload) verification
// ---------------------------------------------------------------------------
//
// `runVerification` (above) is the authoritative end-of-session run that
// persists a VerificationResult on the lead.  `runIncrementalVerification`
// runs a subset of rules against the live flow-session `collectedData` after
// each document upload, so the customer gets instant "this doesn't match"
// feedback for any cross-document rule — not just the hardcoded name guard.
//
// Differences vs `runVerification`:
//   * Reads from `collectedData._collectedDocuments` (in-memory session
//     state), NOT from `lead.extractedData` — avoids the lead-write lag.
//   * Skips `presence` rules (they only make sense at end-of-session).
//   * Skips rules whose referenced docTypes aren't all present yet.
//   * Does NOT persist anything to the lead.
//
const INCREMENTAL_RULE_TYPES = new Set(["cross_field", "threshold", "chronology"]);

/** Returns the document categories a rule references (raw, as configured). */
export function getRuleRequiredDocs(rule: VerificationRule): string[] {
  const cfg = (rule.config as any) || {};
  switch (rule.ruleType) {
    case "cross_field":
      return Array.isArray(cfg.docTypes) ? cfg.docTypes.filter(Boolean) : [];
    case "threshold":
      return cfg.docType ? [cfg.docType] : [];
    case "chronology":
      return [cfg.from?.docType, cfg.to?.docType].filter(Boolean) as string[];
    case "presence":
      return Array.isArray(cfg.requiredDocTypes) ? cfg.requiredDocTypes.filter(Boolean) : [];
    default:
      return [];
  }
}

function normalizeDocKey(k: string): string {
  return String(k || "").toLowerCase().replace(/_card$/, "");
}

/**
 * Build a RuleContext directly from a flow session's `collectedData`.
 *
 * Exposes each completed document under BOTH `{normalized}` and `{normalized}_card`
 * key variants (e.g. `aadhaar` and `aadhaar_card`) so rules configured with either
 * form resolve correctly.  Extracted fields are emitted as prefixed flat keys
 * (`aadhaar_dob`, `aadhaar_card_dob`) and as a nested object — matching what
 * `resolveField()` expects.
 */
function buildSessionRuleContext(
  collectedData: Record<string, any>,
  businessAccountId: string,
): RuleContext {
  const collectedDocs: Record<string, any> =
    collectedData?._collectedDocuments && typeof collectedData._collectedDocuments === "object"
      ? collectedData._collectedDocuments
      : {};

  const leadFields: Record<string, any> = {};
  const docsByType = new Map<string, any[]>();

  // Copy root-level session fields (lead-mapped fields like `name`, `dob`, `phone`).
  for (const [k, v] of Object.entries(collectedData || {})) {
    if (k.startsWith("_")) continue;
    leadFields[k] = v;
  }

  for (const [rawKey, doc] of Object.entries(collectedDocs)) {
    if (!doc || typeof doc !== "object") continue;
    if ((doc as any).isValid === false) continue;
    const normalized = normalizeDocKey(rawKey);
    const extracted: Record<string, any> = ((doc as any).extractedData as Record<string, any>) || {};
    const variants = Array.from(new Set([normalized, `${normalized}_card`]));
    const stub = [{ documentCategory: normalized, businessAccountId } as any];

    for (const variant of variants) {
      docsByType.set(variant, stub);
      // Nested form
      leadFields[variant] = { ...(leadFields[variant] || {}), ...extracted };
      // Prefixed flat form
      for (const [fk, fv] of Object.entries(extracted)) {
        leadFields[`${variant}_${fk}`] = fv;
      }
    }
  }

  return {
    lead: { id: "", businessAccountId } as any,
    attachments: [] as any,
    docsByType,
    leadFields,
  };
}

export interface IncrementalVerificationInput {
  ruleSetId: string;
  businessAccountId: string;
  collectedData: Record<string, any>;
}

export interface IncrementalFinding extends Finding {
  /** Normalized (no `_card` suffix) doc keys this rule references. */
  implicatedDocs: string[];
}

export interface IncrementalVerificationResult {
  findings: IncrementalFinding[];   // all evaluated findings (pass/fail)
  failures: IncrementalFinding[];   // status === "fail"
  evaluated: number;
  skippedMissingDocs: number;
}

export async function runIncrementalVerification(
  input: IncrementalVerificationInput,
): Promise<IncrementalVerificationResult> {
  const { ruleSetId, businessAccountId, collectedData } = input;

  // Verify rule set ownership
  const [ruleSet] = await db
    .select()
    .from(verificationRuleSets)
    .where(and(
      eq(verificationRuleSets.id, ruleSetId),
      eq(verificationRuleSets.businessAccountId, businessAccountId),
    ))
    .limit(1);
  if (!ruleSet) return { findings: [], failures: [], evaluated: 0, skippedMissingDocs: 0 };

  const allRules = await db
    .select()
    .from(verificationRules)
    .where(and(eq(verificationRules.ruleSetId, ruleSetId), eq(verificationRules.isActive, true)))
    .orderBy(asc(verificationRules.sortOrder), asc(verificationRules.createdAt));

  const rules = allRules.filter(r => INCREMENTAL_RULE_TYPES.has(r.ruleType));
  if (rules.length === 0) return { findings: [], failures: [], evaluated: 0, skippedMissingDocs: 0 };

  const ctx = buildSessionRuleContext(collectedData, businessAccountId);

  const findings: IncrementalFinding[] = [];
  let evaluated = 0;
  let skippedMissingDocs = 0;

  for (const rule of rules) {
    const required = getRuleRequiredDocs(rule).map(normalizeDocKey);
    if (required.length === 0) continue;

    const presentDocs = required.filter(dt => ctx.docsByType.has(dt) || ctx.docsByType.has(`${dt}_card`));

    // cross_field rules compare a field across docs — they can produce a
    // meaningful result with as few as 2 of the configured docs present, so we
    // fire incrementally the moment any pair is available (Aadhaar + PAN gets
    // compared the instant the second one arrives, without waiting for
    // marksheets). threshold / chronology rules have no meaningful partial
    // result, so they still require ALL referenced docs to be present.
    const canEvaluate = rule.ruleType === "cross_field"
      ? presentDocs.length >= 2
      : presentDocs.length === required.length;

    if (!canEvaluate) {
      skippedMissingDocs++;
      continue;
    }

    const exec = REGISTRY[rule.ruleType];
    if (!exec) continue;
    try {
      const f = exec(rule, ctx);
      evaluated++;
      // implicatedDocs must reflect what the executor *actually compared*, not
      // just what was uploaded. The downstream consumer (whatsappFlowService
      // .runInstantVerification) uses implicatedDocs to decide whether to
      // reject the just-uploaded doc, so over-implicating (e.g. tagging a doc
      // whose field was never extracted) would cause spurious rejections.
      //
      // Rule-type policy:
      //   • cross_field: trust executor evidence.docs (exactly the docs whose
      //     field was extracted AND compared). If evidence is missing/empty,
      //     fail safe with [] so we never over-implicate — better to skip a
      //     potential rejection than to reject the wrong doc.
      //   • threshold / chronology: their executors don't always surface
      //     evidence.docs, so fall back to presentDocs to preserve existing
      //     behavior.
      const evidenceDocs = Array.isArray((f as any)?.evidence?.docs)
        ? ((f as any).evidence.docs as string[]).map(normalizeDocKey)
        : null;
      let implicatedDocs: string[];
      if (rule.ruleType === "cross_field") {
        implicatedDocs = evidenceDocs ?? [];
      } else {
        implicatedDocs = evidenceDocs && evidenceDocs.length > 0 ? evidenceDocs : presentDocs;
      }
      findings.push({ ...f, implicatedDocs });
    } catch (err: any) {
      console.error(`[Verification:incremental] Executor error for rule ${rule.id}:`, err);
    }
  }

  const failures = findings.filter(f => f.status === "fail");
  return { findings, failures, evaluated, skippedMissingDocs };
}

export { REGISTRY as ruleExecutorRegistry };
export type { VerificationResult, Finding, Verdict } from "./types";
