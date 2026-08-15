import type { VerificationRule } from "@shared/schema";
import { applyTemplate, resolveField, type Finding, type RuleContext } from "../types";

interface CrossFieldConfig {
  field: string;                                            // logical field (e.g. "name", "dob")
  docTypes: string[];                                       // doc categories to compare across
  comparator: "exact" | "fuzzy_name" | "date" | "numeric";
  threshold?: number;                                       // for fuzzy_name (0-1) or numeric tolerance
}

// --- comparators --------------------------------------------------------

const normalizeStr = (s: any): string => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// Levenshtein distance — small inputs, O(m*n). Good enough for name comparison.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function fuzzyNameSimilarity(a: string, b: string): number {
  const na = normalizeStr(a).replace(/[^a-z\s]/g, "");
  const nb = normalizeStr(b).replace(/[^a-z\s]/g, "");
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Token-set similarity: tokens of one are a subset of the other (handles middle-name omission)
  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  if (ta.size && tb.size) {
    const inter = [...ta].filter(t => tb.has(t)).length;
    const minSize = Math.min(ta.size, tb.size);
    if (inter === minSize && minSize > 0) return Math.max(0.9, inter / Math.max(ta.size, tb.size));
  }
  // Fall back to normalized Levenshtein ratio
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

function parseDate(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Try DD/MM/YYYY or DD-MM-YYYY first (common on Indian docs)
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const yyyy = y.length === 2 ? (parseInt(y, 10) > 50 ? "19" + y : "20" + y) : y;
    return `${yyyy.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Try ISO YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, mo, d] = s.split("-");
    return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Last resort: native Date parse
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function parseNumber(v: any): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// --- main --------------------------------------------------------------

export function execute(rule: VerificationRule, ctx: RuleContext): Finding {
  const cfg = rule.config as CrossFieldConfig;
  const field = cfg.field;
  const docTypes = cfg.docTypes || [];
  const comparator = cfg.comparator || "exact";

  const collected: { docType: string; raw: any }[] = [];
  for (const dt of docTypes) {
    const raw = resolveField(ctx.leadFields, dt, field);
    if (raw != null && String(raw).trim() !== "") {
      collected.push({ docType: dt, raw });
    }
  }

  if (collected.length < 2) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      severity: rule.severity as Finding["severity"],
      status: "skipped",
      message: `Cannot compare "${field}" — only ${collected.length}/${docTypes.length} documents had this field extracted.`,
      evidence: {
        field,
        docs: collected.map(c => c.docType),
        values: collected.map(c => String(c.raw)),
        details: "Insufficient data for comparison",
      },
    };
  }

  // Compute pairwise match
  let mismatched = false;
  const normalized: (string | number | null)[] = collected.map(c => {
    switch (comparator) {
      case "date": return parseDate(c.raw);
      case "numeric": return parseNumber(c.raw);
      case "fuzzy_name":
      case "exact":
      default:
        return normalizeStr(c.raw);
    }
  });

  if (comparator === "fuzzy_name") {
    const threshold = cfg.threshold ?? 0.8;
    for (let i = 1; i < normalized.length; i++) {
      const sim = fuzzyNameSimilarity(String(normalized[0] ?? ""), String(normalized[i] ?? ""));
      if (sim < threshold) { mismatched = true; break; }
    }
  } else if (comparator === "numeric") {
    const tol = cfg.threshold ?? 0;
    const first = normalized[0] as number | null;
    if (first == null) mismatched = true;
    else {
      for (let i = 1; i < normalized.length; i++) {
        const v = normalized[i] as number | null;
        if (v == null || Math.abs(v - first) > tol) { mismatched = true; break; }
      }
    }
  } else {
    // exact / date — strict equality after normalization
    for (let i = 1; i < normalized.length; i++) {
      if (normalized[i] !== normalized[0] || normalized[0] == null) { mismatched = true; break; }
    }
  }

  const docs = collected.map(c => c.docType);
  const values = collected.map(c => String(c.raw));

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ruleType: rule.ruleType,
    severity: rule.severity as Finding["severity"],
    status: mismatched ? "fail" : "pass",
    message: applyTemplate(rule.messageTemplate, { field, docs, values }),
    evidence: { field, docs, values },
  };
}
