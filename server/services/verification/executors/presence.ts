import type { VerificationRule } from "@shared/schema";
import { applyTemplate, type Finding, type RuleContext } from "../types";

interface PresenceConfig {
  requiredDocTypes: string[];
}

export function execute(rule: VerificationRule, ctx: RuleContext): Finding {
  const cfg = (rule.config as PresenceConfig) || { requiredDocTypes: [] };
  const required = cfg.requiredDocTypes || [];
  const missing = required.filter(dt => !ctx.docsByType.has(dt) || ctx.docsByType.get(dt)!.length === 0);

  if (missing.length === 0) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      severity: rule.severity as Finding["severity"],
      status: "pass",
      message: applyTemplate(rule.messageTemplate, { docs: required }),
      evidence: { docs: required },
    };
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ruleType: rule.ruleType,
    severity: rule.severity as Finding["severity"],
    status: "fail",
    message: applyTemplate(rule.messageTemplate, { docs: missing, values: missing }),
    evidence: { docs: missing, details: `Missing: ${missing.join(", ")}` },
  };
}
