/**
 * Smart Lead Training configuration — ONE definition shared by the account
 * screen (Train Chroney), the group editor, the lead-config / group-training
 * API handlers and group publish (server/storage.ts).
 *
 * Kept free of server/client-only imports so both bundles can use it.
 *
 * What lives here:
 *   - the zod schema the API validates with (account PUT/GET and group PUT)
 *   - the defaults (identical on server and client)
 *   - legacy timing migration ('smart' → Custom after 2, 'end' → Keyword if it
 *     has keywords, otherwise Custom after 3 — the SAME rule the chat runtime
 *     applies to legacy 'end' fields)
 *   - shape normalisation (all four fields, sorted by priority, priorities 1..4)
 *   - best-effort repair of invalid stored configs
 *   - which keys a group OWNS when it publishes (everything else stays per account)
 *   - the group → account merge used by publish
 *   - admin-facing warnings and the intent-sensitivity wording (mirrors the prompt)
 */
import { z } from "zod";

export const LEAD_FIELD_IDS = ["name", "mobile", "whatsapp", "email"] as const;
export type LeadFieldId = (typeof LEAD_FIELD_IDS)[number];

/** Timings offered in the UI. 'smart' and 'end' are legacy aliases only. */
export const LEAD_CAPTURE_STRATEGIES = ["start", "custom", "intent", "keyword"] as const;
export type LeadCaptureStrategy = (typeof LEAD_CAPTURE_STRATEGIES)[number];
export type IntentIntensity = "low" | "medium" | "high";
export type PhoneValidation = "10" | "12" | "8-12" | "any";

export const DEFAULT_CUSTOM_ASK_AFTER = 2;
/** Legacy 'end' with no keywords is treated as Custom, asked after reply #3. */
export const LEGACY_END_ASK_AFTER = 3;
export const CUSTOM_ASK_AFTER_MIN = 1;
export const CUSTOM_ASK_AFTER_MAX = 20;

export const LEAD_FIELD_LABELS: Record<LeadFieldId, string> = {
  name: "Name",
  mobile: "Mobile",
  whatsapp: "WhatsApp",
  email: "Email",
};

export interface LeadFieldConfig {
  id: LeadFieldId;
  enabled: boolean;
  required: boolean;
  priority: number;
  captureStrategy: LeadCaptureStrategy;
  customAskAfter?: number;
  intentIntensity?: IntentIntensity;
  captureKeywords?: string[];
  phoneValidation?: PhoneValidation;
  // Account-only (mobile verification) — never owned by a group.
  otpEnabled?: boolean;
  otpRequiredForCounting?: boolean;
  otpDemoMode?: boolean;
  captchaEnabled?: boolean;
  captchaProvider?: "recaptcha_v2";
  captchaSiteKey?: string;
  sendUnverifiedLeadsToCrm?: boolean;
}

export interface LeadTrainingConfig {
  fields: LeadFieldConfig[];
  /** Legacy top-level timing; not read by the chat runtime. */
  captureStrategy: LeadCaptureStrategy;
  conversionUrl?: string | null;
  conversionBadgeEnabled?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default timing is Custom / ask after reply #2 — the server's documented
 * default and what the chat runtime does with a field that has no timing
 * (it treats a missing strategy as 'smart' = Custom after 2). "At Start"
 * would gate the visitor's very first message, which is a much stronger
 * behaviour than an account that never chose a timing should get.
 */
function defaultField(id: LeadFieldId, priority: number, enabled: boolean, required: boolean): LeadFieldConfig {
  const f: LeadFieldConfig = {
    id,
    enabled,
    required,
    priority,
    captureStrategy: "custom",
    customAskAfter: DEFAULT_CUSTOM_ASK_AFTER,
  };
  if (id === "mobile" || id === "whatsapp") f.phoneValidation = "10";
  return f;
}

/** Account default: Name on and mandatory; the rest off. */
export function createDefaultLeadTrainingConfig(): LeadTrainingConfig {
  return {
    fields: [
      defaultField("name", 1, true, true),
      defaultField("mobile", 2, false, false),
      defaultField("whatsapp", 3, false, false),
      defaultField("email", 4, false, false),
    ],
    captureStrategy: "custom",
  };
}

/** Group default: every field off (nothing is pushed until the admin turns fields on). */
export function createDefaultGroupLeadTrainingConfig(): LeadTrainingConfig {
  return {
    fields: LEAD_FIELD_IDS.map((id, i) => defaultField(id, i + 1, false, false)),
    captureStrategy: "custom",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

type AnyRecord = Record<string, any>;
const isRecord = (v: unknown): v is AnyRecord => !!v && typeof v === "object" && !Array.isArray(v);
const isFieldId = (v: unknown): v is LeadFieldId => typeof v === "string" && (LEAD_FIELD_IDS as readonly string[]).includes(v);
const isStrategy = (v: unknown): v is LeadCaptureStrategy =>
  typeof v === "string" && (LEAD_CAPTURE_STRATEGIES as readonly string[]).includes(v);

/** Split / trim / de-duplicate keywords. Accepts an array or a comma-separated string. */
export function cleanKeywords(raw: unknown): string[] {
  const parts: string[] = Array.isArray(raw)
    ? raw.filter((k) => typeof k === "string")
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.trim();
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

export function fieldLabel(id: unknown): string {
  return isFieldId(id) ? LEAD_FIELD_LABELS[id] : String(id ?? "field");
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy timing migration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a stored timing to one the UI offers. Same rule as the chat runtime:
 *   'smart'                → Custom (ask after reply #N, default 2)
 *   'end' with keywords    → Keyword
 *   'end' without keywords → Custom, ask after reply #3
 *   missing / unknown      → Custom after 2 (what the runtime does with no timing)
 * Fills the per-timing detail (ask-after / sensitivity / keywords) when absent
 * but never removes details of other timings, so switching back restores them.
 */
export function migrateLeadFieldTiming<T extends AnyRecord>(field: T): { field: T & { captureStrategy: LeadCaptureStrategy }; note?: string } {
  const s = field.captureStrategy;
  const label = fieldLabel(field.id);
  if (s === "end") {
    const kws = cleanKeywords(field.captureKeywords);
    if (kws.length > 0) {
      return { field: { ...field, captureStrategy: "keyword", captureKeywords: kws } };
    }
    return {
      field: { ...field, captureStrategy: "custom", customAskAfter: LEGACY_END_ASK_AFTER },
      note: `${label}: the old "At End" timing is no longer offered. It now asks after reply #${LEGACY_END_ASK_AFTER} (Custom) — change it if you prefer another timing.`,
    };
  }
  if (s === "smart" || s === undefined || s === null || s === "") {
    return { field: { ...field, captureStrategy: "custom", customAskAfter: field.customAskAfter ?? DEFAULT_CUSTOM_ASK_AFTER } };
  }
  if (!isStrategy(s)) {
    return {
      field: { ...field, captureStrategy: "custom", customAskAfter: field.customAskAfter ?? DEFAULT_CUSTOM_ASK_AFTER },
      note: `${label}: unknown timing "${String(s)}" — shown as Custom (after reply #${field.customAskAfter ?? DEFAULT_CUSTOM_ASK_AFTER}).`,
    };
  }
  const out: AnyRecord = { ...field };
  if (s === "custom" && (out.customAskAfter === undefined || out.customAskAfter === null)) out.customAskAfter = DEFAULT_CUSTOM_ASK_AFTER;
  if (s === "intent" && !out.intentIntensity) out.intentIntensity = "medium";
  if (s === "keyword") out.captureKeywords = cleanKeywords(out.captureKeywords);
  return { field: out as T & { captureStrategy: LeadCaptureStrategy } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ordering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sort fields by priority (ties and missing priorities fall back to the
 * default name → mobile → whatsapp → email order) and renumber 1..N so
 * priorities are always unique and sequential.
 */
export function sortAndRenumberFields<T extends { id: string; priority?: number }>(fields: T[]): T[] {
  const defaultIndex = (id: string) => {
    const i = (LEAD_FIELD_IDS as readonly string[]).indexOf(id);
    return i === -1 ? 99 : i;
  };
  return fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const pa = typeof a.f.priority === "number" && Number.isFinite(a.f.priority) ? a.f.priority : 999;
      const pb = typeof b.f.priority === "number" && Number.isFinite(b.f.priority) ? b.f.priority : 999;
      if (pa !== pb) return pa - pb;
      const da = defaultIndex(a.f.id);
      const db = defaultIndex(b.f.id);
      if (da !== db) return da - db;
      return a.i - b.i;
    })
    .map(({ f }, idx) => ({ ...f, priority: idx + 1 }));
}

/** Move a field one place up (-1) or down (+1) and renumber priorities. */
export function moveLeadField<T extends { id: string; priority: number }>(fields: T[], fieldId: string, direction: -1 | 1): T[] {
  const sorted = sortAndRenumberFields(fields);
  const idx = sorted.findIndex((f) => f.id === fieldId);
  const target = idx + direction;
  if (idx === -1 || target < 0 || target >= sorted.length) return sorted;
  const next = [...sorted];
  [next[idx], next[target]] = [next[target], next[idx]];
  return next.map((f, i) => ({ ...f, priority: i + 1 }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation (shape) — safe to run on any stored value
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizeResult {
  config: LeadTrainingConfig;
  /** Human notes about legacy values that were migrated (shown to the admin). */
  notes: string[];
  /** True when there was no stored config (or it had no fields) and defaults were used. */
  usedDefaults: boolean;
}

/**
 * Bring any stored/submitted config into the current shape WITHOUT changing
 * what it means:
 *   - exactly the four known fields (missing ones added disabled; duplicates and
 *     unknown ids dropped),
 *   - legacy timings migrated (see migrateLeadFieldTiming),
 *   - phone digit check defaulted to 10 for mobile/whatsapp,
 *   - fields sorted by priority with priorities 1..4,
 *   - every other key (account-only settings, unknown future keys) preserved.
 * It does NOT repair invalid values — see repairLeadTrainingConfig.
 */
export function normalizeLeadTrainingConfig(raw: unknown, opts: { defaults?: "account" | "group" } = {}): NormalizeResult {
  const makeDefault = opts.defaults === "group" ? createDefaultGroupLeadTrainingConfig : createDefaultLeadTrainingConfig;
  const notes: string[] = [];
  if (!isRecord(raw) || !Array.isArray(raw.fields) || raw.fields.length === 0) {
    const base = makeDefault();
    // Keep any top-level keys a field-less config carried (e.g. conversionUrl).
    const merged = isRecord(raw) ? { ...raw, fields: base.fields, captureStrategy: base.captureStrategy } : base;
    return { config: merged as LeadTrainingConfig, notes, usedDefaults: true };
  }

  const defaults = makeDefault();
  const seen = new Set<string>();
  const byId = new Map<LeadFieldId, AnyRecord>();
  for (const f of raw.fields as unknown[]) {
    if (!isRecord(f) || !isFieldId(f.id)) continue;
    if (seen.has(f.id)) {
      notes.push(`${fieldLabel(f.id)} appeared more than once; only the first entry is kept.`);
      continue;
    }
    seen.add(f.id);
    byId.set(f.id, f);
  }

  const fields = LEAD_FIELD_IDS.map((id) => {
    const existing = byId.get(id);
    if (!existing) {
      const d = defaults.fields.find((x) => x.id === id)!;
      return { ...d, enabled: false, required: false };
    }
    const migrated = migrateLeadFieldTiming(existing);
    if (migrated.note) notes.push(migrated.note);
    const out: AnyRecord = { ...migrated.field };
    if ((id === "mobile" || id === "whatsapp") && !out.phoneValidation) out.phoneValidation = "10";
    return out;
  });

  const top = raw.captureStrategy;
  const topStrategy: LeadCaptureStrategy = isStrategy(top) ? top : "custom";

  return {
    config: {
      ...(raw as AnyRecord),
      fields: sortAndRenumberFields(fields as LeadFieldConfig[]),
      captureStrategy: topStrategy,
    } as LeadTrainingConfig,
    notes,
    usedDefaults: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Best-effort repair of invalid values (used for display of bad stored configs
// and as a last step of publish merge)
// ─────────────────────────────────────────────────────────────────────────────

export function repairLeadTrainingConfig(config: LeadTrainingConfig): { config: LeadTrainingConfig; repairs: string[] } {
  const repairs: string[] = [];
  const fields = config.fields.map((orig) => {
    const f: AnyRecord = { ...orig };
    const label = fieldLabel(f.id);
    for (const key of ["enabled", "required"] as const) {
      if (typeof f[key] !== "boolean") {
        f[key] = f[key] === "true" || f[key] === 1 || f[key] === true;
        repairs.push(`${label}: "${key}" was not true/false.`);
      }
    }
    if (f.required && !f.enabled) {
      f.required = false;
      repairs.push(`${label} was mandatory while turned off — set to optional.`);
    }
    if (f.customAskAfter !== undefined && f.customAskAfter !== null) {
      const n = Math.round(Number(f.customAskAfter));
      const clamped = Number.isFinite(n) ? Math.min(CUSTOM_ASK_AFTER_MAX, Math.max(CUSTOM_ASK_AFTER_MIN, n)) : DEFAULT_CUSTOM_ASK_AFTER;
      if (clamped !== f.customAskAfter) {
        repairs.push(`${label}: "ask after reply #" must be ${CUSTOM_ASK_AFTER_MIN}–${CUSTOM_ASK_AFTER_MAX} (was ${String(f.customAskAfter)}).`);
        f.customAskAfter = clamped;
      }
    }
    if (f.intentIntensity !== undefined && !["low", "medium", "high"].includes(f.intentIntensity)) {
      repairs.push(`${label}: unknown sensitivity "${String(f.intentIntensity)}" — set to Medium.`);
      f.intentIntensity = "medium";
    }
    if (f.phoneValidation !== undefined && !["10", "12", "8-12", "any"].includes(f.phoneValidation)) {
      repairs.push(`${label}: unknown digit check "${String(f.phoneValidation)}" — set to 10 digits.`);
      f.phoneValidation = "10";
    }
    if (f.captureKeywords !== undefined && !Array.isArray(f.captureKeywords)) {
      f.captureKeywords = cleanKeywords(f.captureKeywords);
      repairs.push(`${label}: keywords were not a list.`);
    }
    if (f.otpEnabled === true && f.captchaEnabled === true) {
      // Runtime precedence: OTP wins when both are set.
      f.captchaEnabled = false;
      repairs.push(`${label}: OTP and CAPTCHA were both on — OTP kept (that is what the chat uses).`);
    }
    if (f.captchaProvider !== undefined && f.captchaProvider !== "recaptcha_v2") {
      f.captchaProvider = "recaptcha_v2";
      repairs.push(`${label}: unknown CAPTCHA provider — set to reCAPTCHA v2.`);
    }
    if (f.priority !== undefined && (typeof f.priority !== "number" || !Number.isFinite(f.priority))) {
      f.priority = 99;
    }
    return f as LeadFieldConfig;
  });
  return { config: { ...config, fields: sortAndRenumberFields(fields) }, repairs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schema (API validation)
// ─────────────────────────────────────────────────────────────────────────────

const strategyInput = z.enum(["smart", "custom", "start", "end", "keyword", "intent"]);

export const leadConfigFieldSchema = z
  .object({
    id: z.enum(LEAD_FIELD_IDS),
    enabled: z.boolean(),
    required: z.boolean(),
    priority: z.number().int().min(1).max(4),
    captureStrategy: strategyInput, // 'smart' and 'end' accepted as legacy aliases and migrated below
    customAskAfter: z.number().int().min(CUSTOM_ASK_AFTER_MIN).max(CUSTOM_ASK_AFTER_MAX).optional(),
    intentIntensity: z.enum(["low", "medium", "high"]).optional(),
    captureKeywords: z.array(z.string().max(100)).max(100).optional(),
    phoneValidation: z.enum(["10", "12", "8-12", "any"]).optional(),
    otpEnabled: z.boolean().optional().default(false), // Opt-in OTP verification for the mobile field (widget only)
    otpRequiredForCounting: z.boolean().optional().default(false), // With At Start + OTP: unverified conversations are removed so analytics never count them
    otpDemoMode: z.boolean().optional().default(false), // Sample OTP: fixed code 111111, nothing is sent. Demos only.
    captchaEnabled: z.boolean().optional().default(false), // Opt-in reCAPTCHA v2 for the mobile field (widget only). Mutually exclusive with OTP.
    captchaProvider: z.enum(["recaptcha_v2"]).optional(),
    captchaSiteKey: z.string().max(200).optional(), // Public site key (safe to expose). Secret key lives encrypted on widget_settings.
    sendUnverifiedLeadsToCrm: z.boolean().optional().default(false), // Push CAPTCHA-failed leads to the CRM anyway (flagged)
  })
  .superRefine((field, ctx) => {
    const label = fieldLabel(field.id);
    if (!field.enabled && field.required) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["required"], message: `${label} can't be mandatory while it's turned off.` });
    }
    if (field.otpEnabled === true && field.captchaEnabled === true) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["otpEnabled"], message: `${label}: OTP and CAPTCHA can't both be on — pick one verification method.` });
    }
    if (field.enabled && field.captureStrategy === "keyword" && cleanKeywords(field.captureKeywords).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["captureKeywords"],
        message: `${label}: Keyword timing needs at least one keyword (with none it is never asked).`,
      });
    }
  })
  .transform((field) => {
    const migrated = migrateLeadFieldTiming(field).field;
    return {
      ...migrated,
      // Always emit concrete booleans so legacy configs produce a stable API contract.
      otpEnabled: field.otpEnabled ?? false,
      otpRequiredForCounting: field.otpRequiredForCounting ?? false,
      otpDemoMode: field.otpDemoMode ?? false,
      captchaEnabled: field.captchaEnabled ?? false,
      sendUnverifiedLeadsToCrm: field.sendUnverifiedLeadsToCrm ?? false,
    } as LeadFieldConfig;
  });

export const leadTrainingConfigSchema = z
  .object({
    fields: z.array(leadConfigFieldSchema).length(4),
    captureStrategy: strategyInput,
    // Conversion tracking (Google Ads): https "thank-you" page loaded ONLY in the
    // visitor's browser via a hidden iframe (never fetched server-side). Empty = off.
    conversionUrl: z
      .string()
      .trim()
      .max(2048)
      .optional()
      .nullable()
      .refine(
        (v) => {
          if (!v) return true;
          try {
            return new URL(v).protocol === "https:";
          } catch {
            return false;
          }
        },
        { message: "Conversion URL must be a valid https URL" },
      ),
    conversionBadgeEnabled: z.boolean().optional(),
  })
  .superRefine((config, ctx) => {
    const ids = config.fields.map((f) => f.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: `Each field can appear only once (duplicate: ${Array.from(new Set(dupes)).map(fieldLabel).join(", ")}).`,
      });
    }
    const enabledPriorities = config.fields.filter((f) => f.enabled).map((f) => f.priority);
    if (new Set(enabledPriorities).size !== enabledPriorities.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields"], message: "Enabled fields must have unique priorities." });
    }
  })
  .transform((config) => ({
    ...config,
    captureStrategy: migrateLeadFieldTiming({ id: "name", captureStrategy: config.captureStrategy }).field.captureStrategy,
    fields: sortAndRenumberFields(config.fields),
  }));

export type ValidatedLeadTrainingConfig = z.output<typeof leadTrainingConfigSchema>;

/**
 * Turn zod issues into short admin-readable sentences. `input` (the submitted
 * config) lets generic errors at fields.N.x be named after the field.
 */
export function describeLeadConfigIssues(issues: z.ZodIssue[], input?: unknown): string[] {
  const fieldsIn = isRecord(input) && Array.isArray(input.fields) ? (input.fields as unknown[]) : [];
  return issues.map((issue) => {
    if (issue.code === z.ZodIssueCode.custom) return issue.message;
    const [first, idx, key] = issue.path;
    if (first === "fields" && typeof idx === "number") {
      const f = fieldsIn[idx];
      const label = isRecord(f) ? fieldLabel(f.id) : `Field ${idx + 1}`;
      return `${label}${key ? ` (${String(key)})` : ""}: ${issue.message}`;
    }
    return issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Group ownership + publish merge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-field keys a GROUP owns: publishing overwrites these on every member.
 * Everything else on a member's field (OTP/CAPTCHA settings, site key, …) and
 * every top-level key other than GROUP_OWNED_TOP_LEVEL_KEYS (conversion page,
 * badge, …) is account-only and survives a publish untouched.
 */
export const GROUP_OWNED_FIELD_KEYS = [
  "enabled",
  "required",
  "priority",
  "captureStrategy",
  "customAskAfter",
  "intentIntensity",
  "captureKeywords",
  "phoneValidation",
] as const;
export const GROUP_OWNED_TOP_LEVEL_KEYS = ["captureStrategy"] as const;

/** For the publish confirmation dialog. */
export const GROUP_OWNED_SETTINGS_SUMMARY = [
  "Which fields are collected (Name, Mobile, WhatsApp, Email)",
  "Mandatory / Optional",
  "Collection order",
  "When to ask (At Start / Custom ask-after / Intent sensitivity / Keyword list)",
  "Phone digit check for Mobile and WhatsApp",
] as const;
export const ACCOUNT_ONLY_SETTINGS_SUMMARY = [
  "Mobile verification: OTP, CAPTCHA, Sample OTP, reCAPTCHA site key",
  "\"Only count verified leads\" and \"Send unverified leads to CRM\"",
  "Conversion tracking page and badge",
] as const;

/** Keep only the group-owned keys (what the group editor stores). */
export function projectGroupOwnedLeadConfig(config: LeadTrainingConfig): LeadTrainingConfig {
  const fields = config.fields.map((f) => {
    const out: AnyRecord = { id: f.id };
    for (const k of GROUP_OWNED_FIELD_KEYS) {
      if ((f as AnyRecord)[k] !== undefined) out[k] = (f as AnyRecord)[k];
    }
    return out as LeadFieldConfig;
  });
  const top: AnyRecord = { fields };
  for (const k of GROUP_OWNED_TOP_LEVEL_KEYS) {
    if ((config as AnyRecord)[k] !== undefined) top[k] = (config as AnyRecord)[k];
  }
  return top as LeadTrainingConfig;
}

/**
 * Merge a group's lead training into one member account's stored config.
 * The group overwrites only GROUP_OWNED_* keys (where it has a value); every
 * other key the account has — per field or top level, known or unknown — is
 * kept. Result is sorted by priority with priorities 1..4.
 */
export function mergeGroupLeadConfigIntoAccount(accountRaw: unknown, groupRaw: unknown): LeadTrainingConfig {
  const group = normalizeLeadTrainingConfig(groupRaw, { defaults: "group" }).config;
  const hasAccount = isRecord(accountRaw) && Array.isArray(accountRaw.fields) && accountRaw.fields.length > 0;
  const account = hasAccount ? normalizeLeadTrainingConfig(accountRaw).config : null;

  const fields = LEAD_FIELD_IDS.map((id) => {
    const g = group.fields.find((f) => f.id === id) as AnyRecord | undefined;
    const a = (account?.fields.find((f) => f.id === id) as AnyRecord | undefined) ?? { id };
    const merged: AnyRecord = { ...a };
    if (g) {
      for (const k of GROUP_OWNED_FIELD_KEYS) {
        if (g[k] !== undefined) merged[k] = Array.isArray(g[k]) ? [...g[k]] : g[k];
      }
    }
    return merged as LeadFieldConfig;
  });

  const top: AnyRecord = { ...(account ?? {}) };
  for (const k of GROUP_OWNED_TOP_LEVEL_KEYS) {
    if ((group as AnyRecord)[k] !== undefined) top[k] = (group as AnyRecord)[k];
  }
  const merged = { ...top, fields: sortAndRenumberFields(fields) } as LeadTrainingConfig;
  // Only fixes values that would be invalid (e.g. mandatory-but-off from an old group config).
  return repairLeadTrainingConfig(merged).config;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin-facing warnings (shared by Train Chroney and the group editor)
// ─────────────────────────────────────────────────────────────────────────────

export interface LeadConfigWarning {
  /** 'block' = the config can't be saved like this; 'warn' = probably not intended; 'info' = explanation. */
  level: "block" | "warn" | "info";
  fieldId?: LeadFieldId;
  code: "keyword_empty" | "ask_after_range" | "no_fields" | "mobile_and_whatsapp" | "otp_no_channel";
  message: string;
}

export function getLeadConfigWarnings(
  config: Pick<LeadTrainingConfig, "fields">,
  ctx: { otpChannelReady?: boolean } = {},
): LeadConfigWarning[] {
  const out: LeadConfigWarning[] = [];
  const enabled = config.fields.filter((f) => f.enabled);
  for (const f of enabled) {
    const label = fieldLabel(f.id);
    if (f.captureStrategy === "keyword" && cleanKeywords(f.captureKeywords).length === 0) {
      out.push({
        level: "block",
        fieldId: f.id,
        code: "keyword_empty",
        message: `${label}: add at least one keyword (press Enter or type a comma after each), or pick another timing. With no keywords it is never asked.`,
      });
    }
    if (
      f.captureStrategy === "custom" &&
      f.customAskAfter !== undefined &&
      (f.customAskAfter < CUSTOM_ASK_AFTER_MIN || f.customAskAfter > CUSTOM_ASK_AFTER_MAX || !Number.isInteger(f.customAskAfter))
    ) {
      out.push({
        level: "block",
        fieldId: f.id,
        code: "ask_after_range",
        message: `${label}: "ask after reply #" must be a whole number from ${CUSTOM_ASK_AFTER_MIN} to ${CUSTOM_ASK_AFTER_MAX}.`,
      });
    }
  }
  const mobile = config.fields.find((f) => f.id === "mobile");
  if (
    mobile?.enabled &&
    mobile.otpEnabled === true &&
    mobile.otpDemoMode !== true &&
    ctx.otpChannelReady === false
  ) {
    out.push({
      level: "block",
      fieldId: "mobile",
      code: "otp_no_channel",
      message:
        "Mobile: OTP is selected but no SMS or WhatsApp sender is set up, so no code could be sent. Set up a sender in OTP settings, turn on Sample OTP, or switch verification to None.",
    });
  }
  if (enabled.length === 0) {
    out.push({ level: "info", code: "no_fields", message: "No fields are turned on, so Chroney won't ask visitors for any contact details." });
  }
  if (enabled.some((f) => f.id === "mobile") && enabled.some((f) => f.id === "whatsapp")) {
    out.push({
      level: "info",
      code: "mobile_and_whatsapp",
      message:
        "Mobile and WhatsApp are both on: Chroney asks for the mobile number first, then asks once whether that number is on WhatsApp instead of collecting the same number twice.",
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent sensitivity wording — mirrors getSensitivityDescription in
// server/llamaService.ts (the text the AI is actually given). Keep in sync.
// ─────────────────────────────────────────────────────────────────────────────

export const INTENT_SENSITIVITY_OPTIONS: ReadonlyArray<{ value: IntentIntensity; label: string; description: string }> = [
  {
    value: "low",
    label: "Low — any interest",
    description:
      "Asks as soon as the visitor asks about anything beyond small talk: browsing a product, service, course or program; features, availability, eligibility or options; or any specific item by name.",
  },
  {
    value: "medium",
    label: "Medium — evaluating",
    description:
      "Asks when the visitor is evaluating: pricing, costs or fees; comparing options; discounts or offers; availability of a specific item; or asking for details to decide. Not on general browsing.",
  },
  {
    value: "high",
    label: "High — ready to act",
    description:
      "Asks only on strong purchase or action intent: buy, order or book; apply, enroll, register or sign up; schedule an appointment or reserve a slot; \"I want to…\". Not on general questions or even pricing.",
  },
];
export const INTENT_CALLBACK_NOTE = "At every level, a request like \"call me\" or \"contact me\" always triggers the ask.";
