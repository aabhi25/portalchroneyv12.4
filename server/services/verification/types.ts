// Configurable Verification Engine — types
// See shared/schema.ts → verificationRuleSets / verificationRules
// and .local/tasks/task-5.md for the design.

import type { VerificationRule, WhatsappLead, WhatsappLeadAttachment } from "@shared/schema";

export type RuleSeverity = "info" | "warning" | "blocker";
export type FindingStatus = "pass" | "fail" | "skipped"; // skipped = missing data
export type Verdict = "Eligible" | "Conditionally Eligible" | "Discrepancy" | "Pending";

export interface FindingEvidence {
  field?: string;
  docs?: string[];          // document categories involved
  values?: (string | number | null)[];
  details?: string;         // free-form extra detail
}

export interface Finding {
  ruleId: string;
  ruleName: string;
  ruleType: string;
  severity: RuleSeverity;
  status: FindingStatus;
  message: string;          // human-readable, message template applied
  evidence: FindingEvidence;
}

export interface RuleContext {
  lead: WhatsappLead;
  attachments: WhatsappLeadAttachment[];
  // Documents grouped by their documentCategory (e.g. "aadhaar_card", "tenth_marksheet").
  docsByType: Map<string, WhatsappLeadAttachment[]>;
  // Flat extracted data dict from lead.extractedData. Keys may be prefixed
  // by doc category (e.g. "aadhaar_name", "tenth_dob", "graduation_percentage")
  // or unprefixed. Executors must try multiple lookup variants — see resolveField().
  leadFields: Record<string, any>;
}

export interface VerificationResult {
  ruleSetId: string;
  ruleSetName: string;
  ranAt: string;            // ISO timestamp
  verdict: Verdict;
  findings: Finding[];
  counts: { total: number; pass: number; fail: number; skipped: number };
}

export type RuleExecutor = (rule: VerificationRule, ctx: RuleContext) => Finding;

/**
 * Resolve a logical field for a document type. Tries (in order):
 *   1. "{docType}.{field}" via dotted lookup (nested) — supports per-doc nested objects
 *   2. "{docType}_{field}" flat key (most common convention)
 *   3. "{field}" plain (fallback for single-doc rule sets)
 * Returns undefined if not found.
 */
export function resolveField(
  leadFields: Record<string, any>,
  docType: string,
  field: string,
): unknown {
  // Nested
  const nested = leadFields?.[docType];
  if (nested && typeof nested === "object" && field in nested) {
    return (nested as Record<string, any>)[field];
  }
  // Prefixed flat
  const prefixed = `${docType}_${field}`;
  if (prefixed in leadFields) return leadFields[prefixed];
  // Plain
  if (field in leadFields) return leadFields[field];
  return undefined;
}

/**
 * Substitute {field}, {values}, {docs} placeholders in a template.
 * Empty arrays render as "—".
 */
export function applyTemplate(
  template: string,
  vars: { field?: string; values?: (string | number | null)[]; docs?: string[]; [k: string]: any },
): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => {
    const v = vars[key];
    if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
    if (v == null) return "—";
    return String(v);
  });
}
