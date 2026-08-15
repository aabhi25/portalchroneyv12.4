import type { VerificationRule } from "@shared/schema";
import { applyTemplate, resolveField, type Finding, type RuleContext } from "../types";

interface ThresholdConfig {
  docType: string;
  field: string;
  operator: ">=" | "<=" | ">" | "<" | "==" | "regex" | "in";
  value: number | string | (string | number)[];
  normalizeCgpa?: boolean;     // if true and value looks like CGPA (≤10), convert to % via *9.5
}

function toNumber(v: any): number | null {
  if (v == null || v === "") return null;
  const s = typeof v === "number" ? String(v) : String(v).replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Heuristic CGPA → percentage conversion.
 * If the raw value is ≤10 (typical CGPA scale) we treat it as CGPA and convert
 * using the widely-used CBSE formula: percentage = CGPA × 9.5. Values >10 are
 * treated as already-percentage and returned as-is.
 */
export function normalizeCgpaToPercentage(raw: any): number | null {
  const n = toNumber(raw);
  if (n == null) return null;
  if (n <= 10) return +(n * 9.5).toFixed(2);
  return n;
}

export function execute(rule: VerificationRule, ctx: RuleContext): Finding {
  const cfg = rule.config as ThresholdConfig;
  const raw = resolveField(ctx.leadFields, cfg.docType, cfg.field);

  if (raw == null || String(raw).trim() === "") {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      severity: rule.severity as Finding["severity"],
      status: "skipped",
      message: `Cannot evaluate threshold — "${cfg.field}" not extracted from ${cfg.docType}.`,
      evidence: { field: cfg.field, docs: [cfg.docType], details: "Missing source value" },
    };
  }

  let actual: number | string = String(raw).trim();
  let actualNum: number | null = null;

  if (cfg.normalizeCgpa) {
    actualNum = normalizeCgpaToPercentage(raw);
    actual = actualNum ?? actual;
  } else if (["<", "<=", ">", ">=", "=="].includes(cfg.operator)) {
    actualNum = toNumber(raw);
    if (actualNum != null) actual = actualNum;
  }

  let pass = false;
  switch (cfg.operator) {
    case ">=": pass = actualNum != null && actualNum >= Number(cfg.value); break;
    case "<=": pass = actualNum != null && actualNum <= Number(cfg.value); break;
    case ">":  pass = actualNum != null && actualNum >  Number(cfg.value); break;
    case "<":  pass = actualNum != null && actualNum <  Number(cfg.value); break;
    case "==":
      if (actualNum != null && typeof cfg.value === "number") pass = actualNum === cfg.value;
      else pass = String(actual).toLowerCase() === String(cfg.value).toLowerCase();
      break;
    case "regex":
      try { pass = new RegExp(String(cfg.value)).test(String(actual)); }
      catch { pass = false; }
      break;
    case "in":
      pass = Array.isArray(cfg.value) && cfg.value.map(String).map(s => s.toLowerCase())
        .includes(String(actual).toLowerCase());
      break;
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ruleType: rule.ruleType,
    severity: rule.severity as Finding["severity"],
    status: pass ? "pass" : "fail",
    message: applyTemplate(rule.messageTemplate, {
      field: cfg.field,
      docs: [cfg.docType],
      values: [String(actual), String(Array.isArray(cfg.value) ? cfg.value.join("/") : cfg.value)],
    }),
    evidence: {
      field: cfg.field,
      docs: [cfg.docType],
      values: [String(actual)],
      details: `${cfg.operator} ${Array.isArray(cfg.value) ? cfg.value.join("/") : cfg.value}${cfg.normalizeCgpa ? " (CGPA-normalized)" : ""}`,
    },
  };
}
