/**
 * Static guard against mass-assignment regressions (no database needed).
 *
 * Fails when new code hands caller-controlled objects straight to a Drizzle
 * `.set(...)` / `.values(...)` without going through stripProtectedFields /
 * an allow-list, or when a route passes `req.body` to a storage update
 * method that does not strip protected fields.
 *
 * Run: `npx tsx server/services/__tests__/massAssignmentGuard.test.ts`
 *
 * If this flags something that is genuinely safe (e.g. the object is built
 * server-side), add it to EXCEPTIONS below with the reason.
 */
import { readFileSync, readdirSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const rel = (p: string) => relative(ROOT, p);

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}` : ""}`); } else { console.log(`✓ ${label}`); }
}

/**
 * Intentional exceptions: "<file>#<enclosing function>" → reason.
 * The enclosing function is the nearest preceding method / function name.
 */
const EXCEPTIONS: Record<string, string> = {
  // storage.ts — internal-only or super-admin paths whose inputs are built server-side
  "server/storage.ts#updateUser": "super-admin reassigns a user's businessAccountId on purpose; typed { businessAccountId }",
  "server/storage.ts#updateBusinessAccount": "keyed by the account's own id; typed allow-list (name/website/productTier)",
  "server/storage.ts#updateBusinessAccountFeatures": "super-admin feature flags; typed allow-list",
  "server/storage.ts#updateBusinessAccountAutonomousSettings": "typed allow-list of settings",
  "server/storage.ts#updateBusinessAccountVisualSearchModel": "super-admin; typed allow-list of settings",
  "server/storage.ts#updateAppointment": "only called with server-built updates (status/timestamps)",
  "server/storage.ts#updateDemoPage": "super-admin only; moving a demo page between accounts is an intended feature (route validates the target account)",
  "server/storage.ts#updateGroupLeadsquaredFieldMapping": "super-admin; route builds an explicit object",
  "server/storage.ts#updateProductImportJob": "internal job bookkeeping",
  "server/storage.ts#updateBackupJob": "internal job bookkeeping",
  "server/storage.ts#updateFacebookFlowSession": "internal session state, never from a request body",
  "server/storage.ts#updateOtpChallengeForResend": "internal OTP bookkeeping",
  "server/storage.ts#updateOtpChallengeAttempts": "internal OTP bookkeeping",
  "server/storage.ts#updateConversation": "internal; built from server-side fields",
  "server/storage.ts#upsertWidgetSettings": "keyed by businessAccountId in WHERE; routes pass validated/allow-listed data",
  "server/storage.ts#upsertWebsiteAnalysis": "internal analysis result",
  "server/storage.ts#upsertGroupExtraSettings": "super-admin; keyed by group id",
  "server/storage.ts#upsertCustomCrmConfig": "keyed by businessAccountId; route builds the object",
  "server/storage.ts#upsertAccountGroupTrainingSettings": "super-admin; keyed by group id",
  // services — objects assembled field-by-field from server logic
  "server/services/whatsappService.ts#saveSettings": "wrapped in stripProtectedFields; route allow-lists fields",
  "server/services/instagramService.ts#updateSettings": "saveSettings allow-lists fields before calling",
  "server/services/facebookService.ts#updateSettings": "saveSettings allow-lists fields before calling",
  "server/services/storeSheetService.ts#updateRow": "values built by toDbValues() allow-list",
  "server/services/storeSheetService.ts#applyImport": "values built by toDbValues() allow-list",
  "server/services/aiUsageLogger.ts#logUsage": "internal usage record",
  "server/storage.ts#updateAccountGroup": "typed Partial<{ name }>; unused by routes (they build explicit objects)",
  "server/storage.ts#upsertAccountGroupTraining": "super-admin; keyed by group id; route builds updateData field-by-field",
  "server/routes/topscholar.ts#configResponse": "patch built field-by-field with validation; WHERE is the caller's own account",
  "server/services/erpSyncService.ts#initialize": "updateSyncLog: internal sync bookkeeping",
  "server/services/marketingCampaignService.ts#update": "`set` built from an explicit field allow-list; route restricts status to draft/scheduled",
  "server/services/topscholar/ingestionService.ts#upsertSync": "internal ingestion status patch",
  "server/services/topscholar/ingestionService.ts#updatePlanStatus": "internal ingestion status patch",
  "server/services/whatsappFlowService.ts#startUpdateSession": "updateSet built field-by-field from validated customer input",
  "server/services/whatsappTemplateService.ts#syncFromMsg91": "MSG91 sync code: the one place allowed to set template status",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") walk(p, out); }
    else if (e.name.endsWith(".ts") && !e.name.startsWith("_tmp")) out.push(p);
  }
  return out;
}

// Nearest preceding top-level function or class/object method (indent ≤ 2).
function enclosingFunction(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    const m = lines[i].match(/^(?: {0,2})(?:export\s+)?(?:async\s+)?(?:function\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(/)
      || lines[i].match(/^(?: {0,2})(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (m && !["if", "for", "while", "switch", "catch", "return", "await"].includes(m[1])) return m[1];
  }
  return "?";
}

const files = walk(join(ROOT, "server"));
const violations: string[] = [];
const usedExceptions = new Set<string>();

// 1) Any `.set(` whose argument is a bare identifier or starts with a spread
//    of an identifier (caller-shaped object), unless sanitised; and any
//    `.values(req.body…)`. (Create paths are covered by check 3 below: the
//    server-derived tenant / parent keys must come AFTER a `...req.body`.)
const SET_RE = /\.(set|values)\(\s*(\{\s*\.\.\.\s*([A-Za-z_$][\w$.]*)|([A-Za-z_$][\w$.]*)\s*\))/;
// identifiers we know are server-built at the call site
const SERVER_BUILT = /^(set|updateSet|updateData|safeUpdate|safePayload|patch|updates?|values|insertData|cacheData|settingsData|configData|override|updateFields|data|row|record|payload|fields|changes|emailUpdate|phoneUpdate|stepData|productData|faqData|leadData|category|tag|relationship|template|features|settings|analysisData|dataToUpdate|update)$/;
for (const f of files) {
  const r = rel(f);
  if (r.startsWith("server/lib/safeUpdate")) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = line.match(SET_RE);
    if (!m) return;
    const ident = m[3] || m[4];
    if (!ident) return;
    if (/^req\.body\b/.test(ident)) { violations.push(`${r}:${i + 1} passes req.body directly to .${m[1]}(): ${line.trim()}`); return; }
    if (m[1] === "values") return;
    if (!SERVER_BUILT.test(ident)) return; // e.g. `.values(newRow)` of a named, typed object — not what this guard targets
    if (/stripProtectedFields|pickAllowedFields/.test(line)) return;
    // Look back a few lines: the variable is sanitised or built field-by-field right above.
    const window = lines.slice(Math.max(0, i - 40), i).join("\n");
    const builtHere = new RegExp(`(const|let)\\s+${ident.replace(/\./g, "\\.")}\\b[^=]*=\\s*(\\{|stripProtectedFields|pickAllowedFields)`).test(window)
      && !new RegExp(`(const|let)\\s+${ident}\\b[^=]*=\\s*\\{\\s*\\.\\.\\.(req\\.body|body|data|updates|input|payload)\\b`).test(window);
    if (builtHere) return;
    const key = `${r}#${enclosingFunction(lines, i)}`;
    if (EXCEPTIONS[key]) { usedExceptions.add(key); return; }
    violations.push(`${r}:${i + 1} (${key}) .${m[1]}() of caller-shaped '${ident}' without stripProtectedFields/allow-list: ${line.trim()}`);
  });
}

// 2) Routes must not pass req.body to a storage update method that doesn't strip.
const storageSrc = readFileSync(join(ROOT, "server/storage.ts"), "utf8");
const stripping = new Set<string>();
for (const m of storageSrc.matchAll(/\n  async (update\w+)\([\s\S]*?(?=\n  async |\n}\n)/g)) {
  if (/stripProtectedFields\(/.test(m[0])) stripping.add(m[1]);
}
for (const f of files.filter(p => rel(p).startsWith("server/routes"))) {
  const r = rel(f);
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/storage\.(update\w+)\(([^;]*)/g)) {
      if (!/\breq\.body\b/.test(m[2])) continue;
      if (/pickAllowedFields|stripProtectedFields/.test(m[2])) continue;
      if (!stripping.has(m[1])) violations.push(`${r}:${i + 1} passes req.body to storage.${m[1]}, which does not strip protected fields`);
    }
  });
}

// 3) Route create paths: in an object literal, `...req.body` must be followed
//    by the server-derived owner / parent key so the body cannot override it.
const OWNER_KEYS = /^\s*(businessAccountId|ticketId|journeyId|flowId|groupId|stepId|conversationId)\b/;
for (const f of files.filter(p => rel(p).startsWith("server/routes"))) {
  const r = rel(f);
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!/^\s*\.\.\.req\.body,?\s*$/.test(line)) return;
    let ok = false;
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
      if (OWNER_KEYS.test(lines[j])) { ok = true; break; }
      if (/^\s*\}/.test(lines[j])) break;
    }
    if (!ok) violations.push(`${r}:${i + 1} spreads req.body without a server-derived owner key after it`);
  });
}

expect(stripping.size >= 25, `storage.ts: tenant-scoped update methods strip protected fields (${stripping.size} found)`, [...stripping]);
for (const must of ["updateProduct", "updateFaq", "updateJourney", "updateJourneyStep", "updateGroupJourney", "updateGroupJourneyStep", "updateCannedResponse", "updateCategory", "updateTag", "updateTicketInsight", "updateScheduleTemplate", "updateQuestionBankEntry", "updateFacebookFlowStep"]) {
  expect(stripping.has(must), `storage.${must} strips protected fields`);
}
const templateSrc = readFileSync(join(ROOT, "server/services/whatsappTemplateService.ts"), "utf8");
const updateFields = templateSrc.match(/async update\([\s\S]*?const fields[^=]*=\s*\[([\s\S]*?)\];/);
expect(!!updateFields && !/"status"|"rejectionReason"|"businessAccountId"|"sourceType"/.test(updateFields[1]), "whatsappTemplateService.update does not accept status/rejectionReason/ownership fields");

expect(violations.length === 0, `no unsafe mass-assignment patterns (${violations.length} found)`, violations.join("\n  "));
const stale = Object.keys(EXCEPTIONS).filter(k => !usedExceptions.has(k));
if (stale.length) console.log(`(info) exceptions not currently matched — fine, they document intent: ${stale.length}`);

if (failed > 0) { console.error(`\n${failed} guard check(s) failed.`); process.exit(1); }
console.log("\nMass-assignment guard passed.");
