import type { VerificationRule } from "@shared/schema";
import { applyTemplate, resolveField, type Finding, type RuleContext } from "../types";

interface ChronologyConfig {
  from: { docType: string; field: string };
  to:   { docType: string; field: string };
  maxGapYears?: number;
  minGapYears?: number;
}

function parseYear(v: any): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // 4-digit year directly
  const y4 = s.match(/^(\d{4})$/);
  if (y4) return parseInt(y4[1], 10);
  // Date-ish — extract year
  const m = s.match(/(\d{4})/);
  if (m) {
    const y = parseInt(m[1], 10);
    if (y >= 1900 && y <= 2100) return y;
  }
  // Date.parse fallback
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).getUTCFullYear();
  return null;
}

export function execute(rule: VerificationRule, ctx: RuleContext): Finding {
  const cfg = rule.config as ChronologyConfig;
  const fromRaw = resolveField(ctx.leadFields, cfg.from.docType, cfg.from.field);
  const toRaw   = resolveField(ctx.leadFields, cfg.to.docType,   cfg.to.field);
  const fromY = parseYear(fromRaw);
  const toY   = parseYear(toRaw);

  if (fromY == null || toY == null) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      severity: rule.severity as Finding["severity"],
      status: "skipped",
      message: `Cannot evaluate chronology — missing year on ${fromY == null ? cfg.from.docType : cfg.to.docType}.`,
      evidence: {
        docs: [cfg.from.docType, cfg.to.docType],
        values: [fromRaw != null ? String(fromRaw) : null, toRaw != null ? String(toRaw) : null],
        details: "Missing source year(s)",
      },
    };
  }

  const gap = toY - fromY;
  let pass = true;
  let why = "";
  if (cfg.maxGapYears != null && gap > cfg.maxGapYears) { pass = false; why = `gap ${gap}y > max ${cfg.maxGapYears}y`; }
  if (pass && cfg.minGapYears != null && gap < cfg.minGapYears) { pass = false; why = `gap ${gap}y < min ${cfg.minGapYears}y`; }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ruleType: rule.ruleType,
    severity: rule.severity as Finding["severity"],
    status: pass ? "pass" : "fail",
    message: applyTemplate(rule.messageTemplate, {
      docs: [cfg.from.docType, cfg.to.docType],
      values: [String(fromY), String(toY), String(gap)],
      gap: String(gap),
    }),
    evidence: {
      docs: [cfg.from.docType, cfg.to.docType],
      values: [String(fromY), String(toY)],
      details: pass ? `Gap = ${gap} year(s)` : why,
    },
  };
}
