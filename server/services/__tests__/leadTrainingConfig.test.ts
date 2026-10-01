/**
 * Pure tests for shared/leadTrainingConfig.ts (schema, legacy-timing migration,
 * ordering, repair, group ownership/merge, warnings) and the Train Chroney
 * auto-save reducer (client/src/lib/leadConfigAutosave.ts). No DB, no network.
 *
 *   npx tsx server/services/__tests__/leadTrainingConfig.test.ts
 */
import {
  leadTrainingConfigSchema,
  normalizeLeadTrainingConfig,
  repairLeadTrainingConfig,
  mergeGroupLeadConfigIntoAccount,
  projectGroupOwnedLeadConfig,
  getLeadConfigWarnings,
  moveLeadField,
  describeLeadConfigIssues,
  createDefaultLeadTrainingConfig,
  GROUP_OWNED_FIELD_KEYS,
  INTENT_SENSITIVITY_OPTIONS,
} from "@shared/leadTrainingConfig";
import {
  autosaveReducer,
  initialAutosaveState,
  hasUnsavedChanges,
  shouldAdoptServerData,
  shouldScheduleSave,
  autosaveLabel,
} from "../../../client/src/lib/leadConfigAutosave";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}

const f = (id: string, extra: Record<string, any> = {}) => ({
  id, enabled: false, required: false, priority: ({ name: 1, mobile: 2, whatsapp: 3, email: 4 } as any)[id], captureStrategy: "custom", customAskAfter: 2, ...extra,
});
const cfg = (fields: any[], extra: Record<string, any> = {}) => ({ fields, captureStrategy: "custom", ...extra });

// ── schema ─────────────────────────────────────────────────────────────────
{
  const ok = leadTrainingConfigSchema.safeParse(cfg([f("name", { enabled: true, required: true }), f("mobile"), f("whatsapp"), f("email")]));
  expect(ok.success, "valid config parses");
  if (ok.success) {
    const name = ok.data.fields.find((x) => x.id === "name")!;
    expect(name.otpEnabled === false && name.captchaEnabled === false && name.sendUnverifiedLeadsToCrm === false, "concrete booleans emitted for legacy-missing flags");
  }

  const dup = leadTrainingConfigSchema.safeParse(cfg([f("name"), f("email"), f("whatsapp"), f("email", { priority: 1 })]));
  expect(!dup.success, "duplicate field ids rejected");
  expect(!dup.success && describeLeadConfigIssues(dup.error.issues).some((m) => /only once/.test(m) && /Email/.test(m)), "duplicate message names the field", !dup.success && describeLeadConfigIssues(dup.error.issues));

  const kwEmpty = leadTrainingConfigSchema.safeParse(cfg([f("name", { enabled: true, captureStrategy: "keyword", captureKeywords: [] }), f("mobile"), f("whatsapp"), f("email")]));
  expect(!kwEmpty.success && describeLeadConfigIssues(kwEmpty.error.issues).some((m) => /Name: Keyword timing needs at least one keyword/.test(m)), "enabled Keyword field with no keywords rejected with a readable message");

  const kwOff = leadTrainingConfigSchema.safeParse(cfg([f("name"), f("mobile"), f("whatsapp"), f("email", { captureStrategy: "keyword", captureKeywords: [] })]));
  expect(kwOff.success, "disabled Keyword field with no keywords is allowed");

  const reqOff = leadTrainingConfigSchema.safeParse(cfg([f("name", { required: true }), f("mobile"), f("whatsapp"), f("email")]));
  expect(!reqOff.success, "mandatory-while-off rejected");

  const both = leadTrainingConfigSchema.safeParse(cfg([f("name"), f("mobile", { enabled: true, otpEnabled: true, captchaEnabled: true }), f("whatsapp"), f("email")]));
  expect(!both.success, "OTP + CAPTCHA together rejected");

  for (const n of [0, 21]) {
    const r = leadTrainingConfigSchema.safeParse(cfg([f("name", { enabled: true, customAskAfter: n }), f("mobile"), f("whatsapp"), f("email")]));
    expect(!r.success, `customAskAfter ${n} rejected (1–20)`);
  }

  const endNoKw = leadTrainingConfigSchema.safeParse(cfg([f("name", { enabled: true, captureStrategy: "end" }), f("mobile"), f("whatsapp"), f("email")]));
  expect(endNoKw.success && endNoKw.data.fields[0].captureStrategy === "custom" && endNoKw.data.fields[0].customAskAfter === 3,
    "legacy 'end' without keywords → Custom ask-after 3 (same rule as runtime)", endNoKw.success && endNoKw.data.fields[0]);
  const endKw = leadTrainingConfigSchema.safeParse(cfg([f("name", { enabled: true, captureStrategy: "end", captureKeywords: [" price ", "demo", "Price"] }), f("mobile"), f("whatsapp"), f("email")]));
  expect(endKw.success && endKw.data.fields[0].captureStrategy === "keyword" && JSON.stringify(endKw.data.fields[0].captureKeywords) === JSON.stringify(["price", "demo"]),
    "legacy 'end' with keywords → Keyword (trimmed, de-duplicated)", endKw.success && endKw.data.fields[0]);
  const smart = leadTrainingConfigSchema.safeParse(cfg([f("name", { enabled: true, captureStrategy: "smart", customAskAfter: undefined }), f("mobile"), f("whatsapp"), f("email")], { captureStrategy: "smart" }));
  expect(smart.success && smart.data.fields[0].captureStrategy === "custom" && smart.data.fields[0].customAskAfter === 2 && smart.data.captureStrategy === "custom",
    "legacy 'smart' → Custom after 2 (field and top level)");

  const ordered = leadTrainingConfigSchema.safeParse(cfg([f("name", { priority: 4 }), f("mobile", { priority: 1 }), f("whatsapp", { priority: 3 }), f("email", { priority: 2 })]));
  expect(ordered.success && ordered.data.fields.map((x) => `${x.id}:${x.priority}`).join(",") === "mobile:1,email:2,whatsapp:3,name:4",
    "schema output sorted by priority", ordered.success && ordered.data.fields.map((x) => x.id));
}

// ── normalisation ─────────────────────────────────────────────────────────
{
  const n = normalizeLeadTrainingConfig({
    fields: [
      { id: "email", enabled: true, required: false, priority: 1, captureStrategy: "intent", customFutureKey: "keep-me" },
      { id: "name", enabled: true, required: true, priority: 1, captureStrategy: "end" },
      { id: "name", enabled: false, required: false, priority: 3 },
      { id: "bogus", enabled: true },
    ],
    captureStrategy: "end",
    conversionUrl: "https://x.example/thanks",
  });
  const ids = n.config.fields.map((x) => x.id);
  expect(ids.length === 4 && new Set(ids).size === 4, "normalise: exactly the four fields, no dupes/unknown", ids);
  expect(n.config.fields.map((x) => x.priority).join(",") === "1,2,3,4", "normalise: priorities 1..4 sequential", n.config.fields.map((x) => x.priority));
  expect(ids[0] === "name" && ids[1] === "email", "normalise: priority tie broken by default order (name before email)", ids);
  expect(n.config.fields.find((x) => x.id === "name")!.captureStrategy === "custom" && n.config.fields.find((x) => x.id === "name")!.customAskAfter === 3, "normalise: 'end' → Custom 3");
  expect(n.notes.some((t) => /At End/.test(t)) && n.notes.some((t) => /more than once/.test(t)), "normalise: notes for legacy 'end' and duplicate", n.notes);
  expect((n.config.fields.find((x) => x.id === "email") as any).customFutureKey === "keep-me" && n.config.fields.find((x) => x.id === "email")!.intentIntensity === "medium",
    "normalise: unknown per-field keys kept; intent gets default sensitivity");
  expect(n.config.conversionUrl === "https://x.example/thanks", "normalise: top-level keys kept");
  expect(n.config.fields.find((x) => x.id === "mobile")!.phoneValidation === "10", "normalise: missing mobile added with 10-digit check");

  const d = normalizeLeadTrainingConfig(null);
  expect(d.usedDefaults && JSON.stringify(d.config) === JSON.stringify(createDefaultLeadTrainingConfig()), "normalise(null) → shared defaults");
  const def = createDefaultLeadTrainingConfig();
  expect(def.fields.every((x) => x.captureStrategy === "custom" && x.customAskAfter === 2) && def.fields[0].enabled && def.fields[0].required,
    "defaults: Custom after 2 everywhere, Name on + mandatory");
}

// ── repair ────────────────────────────────────────────────────────────────
{
  const bad = normalizeLeadTrainingConfig({
    fields: [
      { id: "name", enabled: false, required: true, priority: 1, captureStrategy: "custom", customAskAfter: 50 },
      { id: "mobile", enabled: true, required: false, priority: 2, captureStrategy: "intent", intentIntensity: "extreme", otpEnabled: true, captchaEnabled: true, phoneValidation: "7" },
      { id: "whatsapp", enabled: false, required: false, priority: 3, captureStrategy: "start" },
      { id: "email", enabled: false, required: false, priority: 4, captureStrategy: "start" },
    ],
    captureStrategy: "custom",
  }).config;
  expect(!leadTrainingConfigSchema.safeParse(bad).success, "repair fixture is invalid before repair");
  const r = repairLeadTrainingConfig(bad);
  const parsed = leadTrainingConfigSchema.safeParse(r.config);
  expect(parsed.success, "repaired config validates", !parsed.success && parsed.error.issues);
  const m = r.config.fields.find((x) => x.id === "mobile")!;
  expect(m.otpEnabled === true && m.captchaEnabled === false, "repair: OTP wins over CAPTCHA (runtime precedence)");
  expect(r.config.fields.find((x) => x.id === "name")!.required === false && r.config.fields.find((x) => x.id === "name")!.customAskAfter === 20, "repair: mandatory-off cleared, ask-after clamped");
  expect(m.intentIntensity === "medium" && m.phoneValidation === "10", "repair: bad enums reset");
  expect(r.repairs.length >= 5, "repair lists what it changed", r.repairs);
}

// ── group ownership + merge ─────────────────────────────────────────────────
{
  const account = {
    fields: [
      { id: "mobile", enabled: true, required: true, priority: 1, captureStrategy: "start", phoneValidation: "12",
        otpEnabled: true, otpRequiredForCounting: true, otpDemoMode: false, captchaEnabled: false, captchaSiteKey: "site-xyz", sendUnverifiedLeadsToCrm: true, extraPerFieldProp: 42 },
      { id: "name", enabled: true, required: true, priority: 2, captureStrategy: "custom", customAskAfter: 5, intentIntensity: "high" },
      { id: "email", enabled: false, required: false, priority: 3, captureStrategy: "keyword", captureKeywords: ["quote"] },
      { id: "whatsapp", enabled: false, required: false, priority: 4, captureStrategy: "start" },
    ],
    captureStrategy: "start",
    conversionUrl: "https://acct.example/thanks",
    conversionBadgeEnabled: true,
    someFutureTopLevel: { a: 1 },
  };
  const group = projectGroupOwnedLeadConfig(normalizeLeadTrainingConfig({
    fields: [
      { id: "name", enabled: true, required: false, priority: 1, captureStrategy: "intent", intentIntensity: "low" },
      { id: "mobile", enabled: true, required: false, priority: 2, captureStrategy: "custom", customAskAfter: 4, phoneValidation: "10", otpEnabled: false, captchaSiteKey: "group-should-not-win" },
      { id: "whatsapp", enabled: false, required: false, priority: 3, captureStrategy: "custom", customAskAfter: 2 },
      { id: "email", enabled: true, required: false, priority: 4, captureStrategy: "keyword", captureKeywords: ["pricing"] },
    ],
    captureStrategy: "custom",
  }, { defaults: "group" }).config);

  expect(group.fields.every((x) => Object.keys(x).every((k) => k === "id" || (GROUP_OWNED_FIELD_KEYS as readonly string[]).includes(k))),
    "group projection keeps only group-owned keys", group.fields);

  const merged = mergeGroupLeadConfigIntoAccount(account, group);
  const mm = merged.fields.find((x) => x.id === "mobile") as any;
  expect(mm.otpEnabled === true && mm.otpRequiredForCounting === true && mm.captchaSiteKey === "site-xyz" && mm.sendUnverifiedLeadsToCrm === true,
    "merge keeps account-only OTP/CAPTCHA settings", mm);
  expect(mm.extraPerFieldProp === 42, "merge keeps per-field props the group editor doesn't expose");
  expect(mm.captureStrategy === "custom" && mm.customAskAfter === 4 && mm.phoneValidation === "10" && mm.required === false,
    "merge applies group-owned mobile timing/digits/mandatory", mm);
  const mn = merged.fields.find((x) => x.id === "name")!;
  expect(mn.captureStrategy === "intent" && mn.intentIntensity === "low", "merge applies group timing + sensitivity");
  expect(mn.customAskAfter === 5, "merge: group with no ask-after value doesn't erase the account's (switching back restores it)");
  const me = merged.fields.find((x) => x.id === "email")!;
  expect(me.enabled && JSON.stringify(me.captureKeywords) === JSON.stringify(["pricing"]), "merge applies group keyword list");
  expect(merged.fields.map((x) => x.id).join(",") === "name,mobile,whatsapp,email" && merged.fields.map((x) => x.priority).join(",") === "1,2,3,4",
    "merge: group order applied, priorities sequential", merged.fields.map((x) => `${x.id}:${x.priority}`));
  expect((merged as any).conversionUrl === "https://acct.example/thanks" && (merged as any).conversionBadgeEnabled === true && (merged as any).someFutureTopLevel?.a === 1,
    "merge keeps account-only top-level keys");
  expect(merged.captureStrategy === "custom", "merge applies group top-level captureStrategy");
  expect(leadTrainingConfigSchema.safeParse(merged).success, "merged config is valid");

  const fresh = mergeGroupLeadConfigIntoAccount(null, group);
  expect(fresh.fields.find((x) => x.id === "email")!.enabled && fresh.fields.length === 4, "merge into an account with no config uses the group's");

  // An old, unvalidated group config (mandatory while off, 'end' timing) still merges into a valid config.
  const legacyGroup = { fields: [{ id: "name", enabled: false, required: true, priority: 1, captureStrategy: "end" }], captureStrategy: "smart" };
  const m2 = mergeGroupLeadConfigIntoAccount(account, legacyGroup);
  expect(leadTrainingConfigSchema.safeParse(m2).success && m2.fields.find((x) => x.id === "name")!.captureStrategy === "custom" && m2.fields.find((x) => x.id === "name")!.customAskAfter === 3,
    "legacy group config migrated + repaired during merge");
}

// ── reorder ──────────────────────────────────────────────────────────────────
{
  const fields = [f("name", { priority: 1 }), f("mobile", { priority: 1 }), f("whatsapp", { priority: 7 }), f("email", { priority: 2 })] as any[];
  const up = moveLeadField(fields, "email", -1);
  expect(up.map((x: any) => `${x.id}:${x.priority}`).join(",") === "name:1,email:2,mobile:3,whatsapp:4", "moveLeadField renumbers even messy priorities", up.map((x: any) => `${x.id}:${x.priority}`));
  expect(moveLeadField(up, "name", -1).map((x: any) => x.id).join(",") === "name,email,mobile,whatsapp", "moving the first field up is a no-op");
}

// ── warnings ─────────────────────────────────────────────────────────────────
{
  const none = getLeadConfigWarnings(cfg([f("name"), f("mobile"), f("whatsapp"), f("email")]) as any);
  expect(none.some((w) => w.code === "no_fields" && w.level === "info"), "info when no fields are on");
  const both = getLeadConfigWarnings(cfg([f("name"), f("mobile", { enabled: true }), f("whatsapp", { enabled: true }), f("email")]) as any);
  expect(both.some((w) => w.code === "mobile_and_whatsapp" && /asks once/.test(w.message)), "Mobile + WhatsApp explained");
  const kw = getLeadConfigWarnings(cfg([f("name", { enabled: true, captureStrategy: "keyword", captureKeywords: [] }), f("mobile"), f("whatsapp"), f("email")]) as any);
  expect(kw.some((w) => w.code === "keyword_empty" && w.level === "block" && w.fieldId === "name"), "Keyword with no keywords blocks saving");
  const otpCfg = cfg([f("name"), f("mobile", { enabled: true, otpEnabled: true }), f("whatsapp"), f("email")]) as any;
  expect(getLeadConfigWarnings(otpCfg, { otpChannelReady: false }).some((w) => w.code === "otp_no_channel" && w.level === "block"), "OTP with no channel blocks saving");
  expect(!getLeadConfigWarnings(otpCfg, { otpChannelReady: true }).some((w) => w.code === "otp_no_channel"), "OTP with a channel is fine");
  expect(!getLeadConfigWarnings({ fields: otpCfg.fields.map((x: any) => x.id === "mobile" ? { ...x, otpDemoMode: true } : x) } as any, { otpChannelReady: false }).some((w) => w.code === "otp_no_channel"), "Sample OTP needs no channel");
  expect(!getLeadConfigWarnings(otpCfg).some((w) => w.code === "otp_no_channel"), "unknown channel status (still loading) never blocks");
}

// ── sensitivity wording mirrors the prompt ─────────────────────────────────
{
  const low = INTENT_SENSITIVITY_OPTIONS.find((o) => o.value === "low")!.description;
  const med = INTENT_SENSITIVITY_OPTIONS.find((o) => o.value === "medium")!.description;
  const high = INTENT_SENSITIVITY_OPTIONS.find((o) => o.value === "high")!.description;
  expect(/availability/.test(low) && /availability of a specific item/.test(med), "availability: general → Low, specific item → Medium (as in the prompt)");
  expect(/pricing/.test(med) && /Not on general questions or even pricing/.test(high), "pricing is Medium; High excludes pricing");
}

// ── auto-save reducer ───────────────────────────────────────────────────────
{
  let s = initialAutosaveState;
  s = autosaveReducer(s, { type: "edit" });                         // v1
  expect(hasUnsavedChanges(s) && shouldScheduleSave(s, false) && !shouldAdoptServerData(s), "edit → dirty, save scheduled, server data not adopted");
  expect(!shouldScheduleSave(s, true), "blocked config is not auto-saved");
  s = autosaveReducer(s, { type: "saveStarted", version: 1 });
  expect(!shouldScheduleSave(s, false) && autosaveLabel(s) === "Saving…", "no second save while one is in flight");
  s = autosaveReducer(s, { type: "edit" });                         // v2 typed during the in-flight save
  s = autosaveReducer(s, { type: "saveSucceeded", version: 1 });
  expect(hasUnsavedChanges(s) && !shouldAdoptServerData(s), "edit made during the save survives its success (server copy not adopted)");
  expect(shouldScheduleSave(s, false), "…and is saved next");
  s = autosaveReducer(s, { type: "saveStarted", version: 2 });
  s = autosaveReducer(s, { type: "saveSucceeded", version: 2 });
  expect(!hasUnsavedChanges(s) && shouldAdoptServerData(s) && autosaveLabel(s) === "Saved", "all saved → server copy adopted, 'Saved'");

  s = autosaveReducer(s, { type: "edit" });                         // v3
  s = autosaveReducer(s, { type: "saveStarted", version: 3 });
  s = autosaveReducer(s, { type: "saveFailed", version: 3, error: "Name: bad" });
  expect(hasUnsavedChanges(s) && !shouldScheduleSave(s, false) && autosaveLabel(s) === "Not saved — retry" && s.error === "Name: bad",
    "failure → 'Not saved — retry', no automatic retry loop");
  s = autosaveReducer(s, { type: "edit" });                         // v4
  expect(shouldScheduleSave(s, false) && s.error === null, "next edit clears the error and re-schedules");
  expect(autosaveLabel(s, "fix the issue") === "Not saved — fix the issue", "blocked reason shown in the status");
  // A stale success for an older version doesn't clear newer edits.
  s = autosaveReducer(s, { type: "saveSucceeded", version: 3 });
  expect(hasUnsavedChanges(s), "late success of an older version leaves newer edits unsaved");
  expect(autosaveReducer(s, { type: "reset" }) === initialAutosaveState, "reset (account switch) starts over");
}

if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
console.log("\nAll lead training config tests passed");
