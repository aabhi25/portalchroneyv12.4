/**
 * AI Calling — per-business settings (read / validate / save), calling hours maths,
 * monthly minute usage and the super admin minute cap.
 *
 * Storage: ai_calling_settings (one row per business; absent = defaults, calling off).
 * Super admin monthly minute cap: system_settings key `ai_calling_minute_cap:<businessAccountId>`
 * (plain integer, not encrypted; absent = no cap). Kept out of ai_calling_settings so a
 * business can never change it through its own settings API, and so no migration is needed.
 * (systemSettingsService caches values for 5 minutes per process.)
 *
 * Minutes this month = ceil(sum(ai_calls.billed_seconds) / 60) over calls created in the
 * current IST calendar month (same month boundaries as Usage & Limits).
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { aiCalls, aiCallingSettings, type AiCallingSettingsRow } from "@shared/schema";
import {
  CALL_LIMITS,
  CALL_PROVIDERS,
  DEFAULT_CALL_PURPOSE,
  DEFAULT_CALLING_HOURS,
  normalizeCallPhone,
  type AiCallingSettingsView,
  type CallingHours,
} from "@shared/aiCalling";
import { systemSettingsService } from "../systemSettingsService";
import { istMonthKey, istMonthRange } from "../aiBudgetService";
import { buildInboundStreamUrl, newInboundKey, resolvePublicBaseUrl } from "./streamToken";
import { describeSecret, exotelMissing, normalizeApiKey, sealSecret } from "./credentials";

export const AUTO_CALL_SOURCES = ["website", "whatsapp", "instagram", "facebook", "voice", "form", "import", "other"] as const;
export const EXOTEL_SUBDOMAINS = ["api.in.exotel.com", "api.exotel.com"] as const;
export const MONTHLY_MINUTE_LIMIT = { min: 1, max: 100_000 } as const;
export const TEXT_LIMITS = { callPurpose: 1500, openingLine: 300, inboundGreeting: 300 } as const;

export class CallingSettingsError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "CallingSettingsError";
  }
}

// ── calling hours ────────────────────────────────────────────────────────────

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim() || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function parseHHMM(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(at: Date, tz: string): ZonedParts {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short",
    });
    fmtCache.set(tz, fmt);
  }
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: WEEKDAYS[p.weekday] ?? 0,
  };
}

/** UTC instant of a wall-clock time in `tz` (DST-safe to the minute). */
function zonedTimeToUtc(year: number, month: number, day: number, minutes: number, tz: string): Date {
  const wall = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wall - asUtc;
  }
  return new Date(guess);
}

/** True when `at` falls inside the business's calling window. */
export function isWithinCallingHours(at: Date, hours: CallingHours): boolean {
  return nextAllowedTime(at, hours).getTime() === at.getTime();
}

/**
 * `at` itself when it is inside the calling window, else the start of the next window
 * (business timezone, allowed weekdays). Window = [start, end).
 */
export function nextAllowedTime(at: Date, hours: CallingHours): Date {
  const tz = isValidTimeZone(hours?.timezone) ? hours.timezone : DEFAULT_CALLING_HOURS.timezone;
  const start = parseHHMM(hours?.start) ?? parseHHMM(DEFAULT_CALLING_HOURS.start)!;
  const end = parseHHMM(hours?.end) ?? parseHHMM(DEFAULT_CALLING_HOURS.end)!;
  const days = Array.isArray(hours?.days) && hours.days.length ? hours.days : DEFAULT_CALLING_HOURS.days;
  const now = zonedParts(at, tz);
  const nowMin = now.hour * 60 + now.minute;
  for (let d = 0; d <= 8; d++) {
    // Calendar date d days after "today" in the business timezone.
    const base = new Date(Date.UTC(now.year, now.month - 1, now.day + d));
    const weekday = (now.weekday + d) % 7;
    if (!days.includes(weekday)) continue;
    if (d === 0) {
      if (nowMin >= start && nowMin < end) return at;
      if (nowMin >= end) continue;
    }
    return zonedTimeToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), start, tz);
  }
  return at; // no allowed day at all (validation prevents this)
}

// ── rows ─────────────────────────────────────────────────────────────────────

export function defaultSettingsRow(businessAccountId: string): AiCallingSettingsRow {
  const now = new Date(0);
  return {
    businessAccountId,
    enabled: false,
    provider: "simulator",
    exotelAccountSid: null,
    exotelSubdomain: "api.in.exotel.com",
    exotelCallerId: null,
    exotelFlowAppId: null,
    exotelApiKey: null,
    exotelApiToken: null,
    exotelVerifiedAt: null,
    inboundKey: null,
    publicBaseUrl: null,
    autoCallLeads: false,
    autoCallDelayMinutes: CALL_LIMITS.autoCallDelayMinutes.default,
    autoCallSources: [],
    consentMode: "explicit",
    consentAttestedAt: null,
    consentAttestedBy: null,
    callingHours: null,
    maxAttempts: CALL_LIMITS.maxAttempts.default,
    retryGapMinutes: CALL_LIMITS.retryGapMinutes.default,
    maxCallMinutes: CALL_LIMITS.maxCallMinutes.default,
    monthlyMinuteLimit: null,
    concurrentCallLimit: CALL_LIMITS.concurrentCallLimit.default,
    recordCalls: true,
    transferNumber: null,
    callPurpose: null,
    openingLine: null,
    inboundGreeting: null,
    whatsappFollowUp: false,
    whatsappFollowUpTemplateId: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getSettingsRow(businessAccountId: string): Promise<AiCallingSettingsRow | null> {
  const [row] = await db.select().from(aiCallingSettings).where(eq(aiCallingSettings.businessAccountId, businessAccountId)).limit(1);
  return row ?? null;
}

/** Stored row or defaults (never null). Used by the dialer, lifecycle and the voice side. */
export async function getCallingSettings(businessAccountId: string): Promise<AiCallingSettingsRow & { exists: boolean }> {
  const row = await getSettingsRow(businessAccountId);
  return row ? { ...row, exists: true } : { ...defaultSettingsRow(businessAccountId), exists: false };
}

/** Business settings for an inbound stream key (Exotel inbound URL), or null. */
export async function getSettingsByInboundKey(inboundKey: string): Promise<AiCallingSettingsRow | null> {
  if (!inboundKey || inboundKey.length > 64) return null;
  const [row] = await db.select().from(aiCallingSettings).where(eq(aiCallingSettings.inboundKey, inboundKey)).limit(1);
  return row ?? null;
}

export function effectiveHours(row: Pick<AiCallingSettingsRow, "callingHours"> | null | undefined): CallingHours {
  const h = row?.callingHours;
  if (!h) return { ...DEFAULT_CALLING_HOURS, days: [...DEFAULT_CALLING_HOURS.days] };
  return {
    start: parseHHMM(h.start) !== null ? h.start : DEFAULT_CALLING_HOURS.start,
    end: parseHHMM(h.end) !== null ? h.end : DEFAULT_CALLING_HOURS.end,
    days: Array.isArray(h.days) && h.days.length ? h.days : [...DEFAULT_CALLING_HOURS.days],
    timezone: isValidTimeZone(h.timezone) ? h.timezone : DEFAULT_CALLING_HOURS.timezone,
  };
}

// ── view ─────────────────────────────────────────────────────────────────────

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export function statusCallbackBase(base: string | null, provider = "exotel"): string | null {
  return base ? `${base}/api/calling/webhooks/${provider}/status` : null;
}

export function toSettingsView(row: AiCallingSettingsRow & { exists?: boolean }): AiCallingSettingsView {
  const base = resolvePublicBaseUrl(row.publicBaseUrl);
  const key = describeSecret(row.exotelApiKey);
  const token = describeSecret(row.exotelApiToken);
  return {
    enabled: row.enabled,
    provider: (CALL_PROVIDERS as string[]).includes(row.provider) ? (row.provider as AiCallingSettingsView["provider"]) : "simulator",
    exotel: {
      accountSid: row.exotelAccountSid,
      subdomain: row.exotelSubdomain || "api.in.exotel.com",
      callerId: row.exotelCallerId,
      flowAppId: row.exotelFlowAppId,
      apiKeySet: key.set,
      apiKeyMask: key.mask,
      apiTokenSet: token.set,
      apiTokenMask: token.mask,
      verifiedAt: iso(row.exotelVerifiedAt),
    },
    setup: {
      inboundStreamUrl: base && row.inboundKey ? buildInboundStreamUrl(base, row.inboundKey) : null,
      statusCallbackUrl: statusCallbackBase(base),
    },
    autoCallLeads: row.autoCallLeads,
    autoCallDelayMinutes: row.autoCallDelayMinutes,
    autoCallSources: Array.isArray(row.autoCallSources) ? row.autoCallSources : [],
    consentMode: row.consentMode === "business_attested" ? "business_attested" : "explicit",
    consentAttestedAt: iso(row.consentAttestedAt),
    callingHours: effectiveHours(row),
    maxAttempts: row.maxAttempts,
    retryGapMinutes: row.retryGapMinutes,
    maxCallMinutes: row.maxCallMinutes,
    monthlyMinuteLimit: row.monthlyMinuteLimit ?? null,
    concurrentCallLimit: row.concurrentCallLimit,
    recordCalls: row.recordCalls,
    transferNumber: row.transferNumber,
    callPurpose: row.callPurpose?.trim() || DEFAULT_CALL_PURPOSE,
    openingLine: row.openingLine,
    inboundGreeting: row.inboundGreeting,
    whatsappFollowUp: row.whatsappFollowUp,
    whatsappFollowUpTemplateId: row.whatsappFollowUpTemplateId,
    updatedAt: row.exists === false ? null : iso(row.updatedAt),
  };
}

export interface SettingsResponse extends AiCallingSettingsView {
  superAdminMinuteCap: number | null;
  minutesThisMonth: number;
  /** Public https address used in the URLs given to Exotel (null = unknown yet). */
  publicBaseUrl: string | null;
}

export async function getSettingsResponse(businessAccountId: string): Promise<SettingsResponse> {
  const row = await getCallingSettings(businessAccountId);
  const [cap, minutes] = await Promise.all([getSuperAdminMinuteCap(businessAccountId), minutesThisMonth(businessAccountId)]);
  return { ...toSettingsView(row), superAdminMinuteCap: cap, minutesThisMonth: minutes, publicBaseUrl: resolvePublicBaseUrl(row.publicBaseUrl) };
}

// ── usage + super admin cap ──────────────────────────────────────────────────

export async function secondsThisMonth(businessAccountId: string, at: Date = new Date()): Promise<number> {
  const { start, end } = istMonthRange(istMonthKey(at));
  const [r] = await db.select({ s: sql<number>`COALESCE(SUM(${aiCalls.billedSeconds}), 0)::int` }).from(aiCalls)
    .where(and(eq(aiCalls.businessAccountId, businessAccountId), gte(aiCalls.createdAt, start), lt(aiCalls.createdAt, end)));
  return Number(r?.s ?? 0);
}

export async function minutesThisMonth(businessAccountId: string, at: Date = new Date()): Promise<number> {
  return Math.ceil((await secondsThisMonth(businessAccountId, at)) / 60);
}

const capKey = (businessAccountId: string) => `ai_calling_minute_cap:${businessAccountId}`;

export async function getSuperAdminMinuteCap(businessAccountId: string): Promise<number | null> {
  const raw = await systemSettingsService.getSetting(capKey(businessAccountId));
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export async function setSuperAdminMinuteCap(businessAccountId: string, cap: number | null): Promise<void> {
  if (cap === null) {
    await systemSettingsService.deleteSetting(capKey(businessAccountId));
    return;
  }
  if (!Number.isInteger(cap) || cap < 0 || cap > MONTHLY_MINUTE_LIMIT.max) {
    throw new CallingSettingsError(`Monthly minute cap must be a whole number between 0 and ${MONTHLY_MINUTE_LIMIT.max}, or empty for no cap`);
  }
  const ok = await systemSettingsService.setSetting(capKey(businessAccountId), String(cap), false, "AI Calling monthly minute cap (super admin)");
  if (!ok) throw new CallingSettingsError("Could not save the monthly minute cap", 500);
}

/** The tighter of the business's own limit and the super admin cap (null = no limit). */
export async function effectiveMinuteLimit(row: Pick<AiCallingSettingsRow, "businessAccountId" | "monthlyMinuteLimit">): Promise<{ limit: number | null; source: "business" | "super_admin" | null }> {
  const cap = await getSuperAdminMinuteCap(row.businessAccountId);
  const own = row.monthlyMinuteLimit ?? null;
  if (cap === null && own === null) return { limit: null, source: null };
  if (cap !== null && (own === null || cap <= own)) return { limit: cap, source: "super_admin" };
  return { limit: own, source: "business" };
}

// ── validation + save ────────────────────────────────────────────────────────

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

function intIn(name: string, v: unknown, lim: { min: number; max: number }): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < lim.min || n > lim.max) {
    throw new CallingSettingsError(`${name} must be a whole number between ${lim.min} and ${lim.max}`);
  }
  return n;
}

function bool(name: string, v: unknown): boolean {
  if (typeof v !== "boolean") throw new CallingSettingsError(`${name} must be true or false`);
  return v;
}

function optText(name: string, v: unknown, max: number): string | null {
  if (v === null) return null;
  if (typeof v !== "string") throw new CallingSettingsError(`${name} must be text`);
  const t = v.trim();
  if (t.length > max) throw new CallingSettingsError(`${name} can be at most ${max} characters`);
  return t || null;
}

export function validateCallingHours(v: unknown): CallingHours {
  if (!v || typeof v !== "object") throw new CallingSettingsError("Calling hours are missing");
  const h = v as Record<string, unknown>;
  const start = parseHHMM(h.start);
  const end = parseHHMM(h.end);
  if (start === null || end === null) throw new CallingSettingsError("Calling hours must be times like 09:30 (24-hour clock)");
  if (end <= start) throw new CallingSettingsError("The calling window must end after it starts (same day)");
  if (end - start < 30) throw new CallingSettingsError("The calling window must be at least 30 minutes long");
  if (!Array.isArray(h.days) || h.days.length === 0) throw new CallingSettingsError("Pick at least one day for calls");
  const days = Array.from(new Set(h.days.map(Number)));
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new CallingSettingsError("Days must be 0 (Sunday) to 6 (Saturday)");
  if (!isValidTimeZone(h.timezone)) throw new CallingSettingsError("Choose a valid time zone (for example Asia/Kolkata)");
  return { start: String(h.start).trim(), end: String(h.end).trim(), days: days.sort((a, b) => a - b), timezone: String(h.timezone) };
}

function normalizeCallerId(v: unknown): string | null {
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw new CallingSettingsError("ExoPhone must be a phone number");
  const t = v.trim().replace(/[\s().-]/g, "");
  if (!/^\+?\d{8,15}$/.test(t)) throw new CallingSettingsError("ExoPhone must be a phone number (8–15 digits), for example 08047112345");
  return t;
}

const AUDITED = [
  "enabled", "provider", "exotelAccountSid", "exotelSubdomain", "exotelCallerId", "exotelFlowAppId",
  "autoCallLeads", "autoCallDelayMinutes", "autoCallSources", "consentMode", "callingHours", "maxAttempts",
  "retryGapMinutes", "maxCallMinutes", "monthlyMinuteLimit", "concurrentCallLimit", "recordCalls", "transferNumber",
  "callPurpose", "openingLine", "inboundGreeting", "whatsappFollowUp", "whatsappFollowUpTemplateId",
] as const;

export interface UpdateResult {
  changed: string[];
  secretsChanged: string[];
  attested: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  row: AiCallingSettingsRow;
}

/**
 * Validate a partial update (body shape = AiCallingSettingsView fields, `exotel: {accountSid, subdomain,
 * callerId, flowAppId}`, plus write-only `exotelApiKey` / `exotelApiToken` (empty = keep) and
 * `attestConsent: true` when switching to business_attested) and save it.
 */
export async function updateCallingSettings(
  businessAccountId: string,
  rawBody: unknown,
  actorUserId: string | null,
  opts: { requestBaseUrl?: string | null; templateExists?: (id: string) => Promise<boolean> } = {},
): Promise<UpdateResult> {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) throw new CallingSettingsError("Settings are missing");
  const body = rawBody as Record<string, unknown>;
  const current = await getCallingSettings(businessAccountId);
  const next: AiCallingSettingsRow = { ...current };
  delete (next as any).exists;

  if (has(body, "enabled")) next.enabled = bool("Turn on AI Calling", body.enabled);
  if (has(body, "provider")) {
    if (!(CALL_PROVIDERS as unknown[]).includes(body.provider)) throw new CallingSettingsError("Provider must be Exotel or the in-portal simulator");
    next.provider = body.provider as string;
  }

  if (has(body, "exotel")) {
    const ex = body.exotel;
    if (!ex || typeof ex !== "object") throw new CallingSettingsError("Exotel details are invalid");
    const e = ex as Record<string, unknown>;
    if (has(e, "accountSid")) {
      if (e.accountSid === null || e.accountSid === "") next.exotelAccountSid = null;
      else if (typeof e.accountSid !== "string" || !/^[A-Za-z0-9_-]{2,64}$/.test(e.accountSid.trim())) {
        throw new CallingSettingsError("Exotel account SID may only contain letters, digits, - and _");
      } else next.exotelAccountSid = e.accountSid.trim();
    }
    if (has(e, "subdomain")) {
      if (!(EXOTEL_SUBDOMAINS as readonly unknown[]).includes(e.subdomain)) {
        throw new CallingSettingsError("Exotel region must be api.in.exotel.com (India) or api.exotel.com (Singapore)");
      }
      next.exotelSubdomain = e.subdomain as string;
    }
    if (has(e, "callerId")) next.exotelCallerId = normalizeCallerId(e.callerId);
    if (has(e, "flowAppId")) {
      if (e.flowAppId === null || e.flowAppId === "") next.exotelFlowAppId = null;
      else if (!/^\d{1,20}$/.test(String(e.flowAppId).trim())) throw new CallingSettingsError("Exotel call flow (app) id must be a number");
      else next.exotelFlowAppId = String(e.flowAppId).trim();
    }
  }

  const secretsChanged: string[] = [];
  for (const [field, col] of [["exotelApiKey", "exotelApiKey"], ["exotelApiToken", "exotelApiToken"]] as const) {
    if (!has(body, field)) continue;
    const raw = body[field];
    if (raw === "" || raw === null) continue; // empty = keep the saved value
    const key = normalizeApiKey(raw);
    if (!key) throw new CallingSettingsError(`${field === "exotelApiKey" ? "Exotel API key" : "Exotel API token"} must be 8–512 characters with no spaces`);
    next[col] = sealSecret(key, actorUserId);
    secretsChanged.push(field);
  }

  if (has(body, "autoCallLeads")) next.autoCallLeads = bool("Call new leads automatically", body.autoCallLeads);
  if (has(body, "autoCallDelayMinutes")) next.autoCallDelayMinutes = intIn("Delay before calling a new lead (minutes)", body.autoCallDelayMinutes, CALL_LIMITS.autoCallDelayMinutes);
  if (has(body, "autoCallSources")) {
    if (!Array.isArray(body.autoCallSources)) throw new CallingSettingsError("Lead sources must be a list");
    const list = Array.from(new Set(body.autoCallSources.map(String)));
    const bad = list.filter((s) => !(AUTO_CALL_SOURCES as readonly string[]).includes(s));
    if (bad.length) throw new CallingSettingsError(`Unknown lead source: ${bad.join(", ")}`);
    next.autoCallSources = list;
  }
  let attested = false;
  if (has(body, "consentMode")) {
    if (body.consentMode !== "explicit" && body.consentMode !== "business_attested") throw new CallingSettingsError("Consent rule must be 'explicit' or 'business_attested'");
    if (body.consentMode === "business_attested" && current.consentMode !== "business_attested") {
      if (body.attestConsent !== true) {
        throw new CallingSettingsError("Please confirm that your lead forms and chats tell people they may get a call from you before choosing this option.");
      }
      next.consentAttestedAt = new Date();
      next.consentAttestedBy = actorUserId;
      attested = true;
    }
    next.consentMode = body.consentMode;
  }
  if (has(body, "callingHours")) next.callingHours = validateCallingHours(body.callingHours);
  if (has(body, "maxAttempts")) next.maxAttempts = intIn("Attempts per lead", body.maxAttempts, CALL_LIMITS.maxAttempts);
  if (has(body, "retryGapMinutes")) next.retryGapMinutes = intIn("Gap between attempts (minutes)", body.retryGapMinutes, CALL_LIMITS.retryGapMinutes);
  if (has(body, "maxCallMinutes")) next.maxCallMinutes = intIn("Longest call (minutes)", body.maxCallMinutes, CALL_LIMITS.maxCallMinutes);
  if (has(body, "concurrentCallLimit")) next.concurrentCallLimit = intIn("Calls at the same time", body.concurrentCallLimit, CALL_LIMITS.concurrentCallLimit);
  if (has(body, "monthlyMinuteLimit")) {
    next.monthlyMinuteLimit = body.monthlyMinuteLimit === null || body.monthlyMinuteLimit === ""
      ? null : intIn("Monthly minute limit", body.monthlyMinuteLimit, MONTHLY_MINUTE_LIMIT);
  }
  if (has(body, "recordCalls")) next.recordCalls = bool("Record calls", body.recordCalls);
  if (has(body, "transferNumber")) {
    if (body.transferNumber === null || body.transferNumber === "") next.transferNumber = null;
    else {
      const p = normalizeCallPhone(body.transferNumber);
      if (!p) throw new CallingSettingsError("Transfer number must be a valid phone number, with the country code (for example +91 98765 43210)");
      next.transferNumber = p;
    }
  }
  if (has(body, "callPurpose")) next.callPurpose = optText("Call purpose", body.callPurpose, TEXT_LIMITS.callPurpose);
  if (has(body, "openingLine")) next.openingLine = optText("Opening line", body.openingLine, TEXT_LIMITS.openingLine);
  if (has(body, "inboundGreeting")) next.inboundGreeting = optText("Greeting for incoming calls", body.inboundGreeting, TEXT_LIMITS.inboundGreeting);
  if (has(body, "whatsappFollowUp")) next.whatsappFollowUp = bool("WhatsApp follow-up", body.whatsappFollowUp);
  if (has(body, "whatsappFollowUpTemplateId")) {
    const v = body.whatsappFollowUpTemplateId;
    if (v === null || v === "") next.whatsappFollowUpTemplateId = null;
    else if (typeof v !== "string" || v.length > 64) throw new CallingSettingsError("Choose a WhatsApp template");
    else {
      if (opts.templateExists && !(await opts.templateExists(v))) throw new CallingSettingsError("That WhatsApp template was not found");
      next.whatsappFollowUpTemplateId = v;
    }
  }

  // Cross-field rules.
  if (next.whatsappFollowUp && !next.whatsappFollowUpTemplateId) {
    throw new CallingSettingsError("Choose the WhatsApp template to send after a call, or turn the follow-up off");
  }
  if (next.enabled && next.provider === "exotel") {
    const missing = exotelMissing(next);
    if (missing.length) throw new CallingSettingsError(`To make real calls with Exotel, first add your ${missing.join(", ")}.`);
  }

  // Credentials or provider changed → the old "verified" no longer applies.
  const credsChanged = secretsChanged.length > 0 || next.provider !== current.provider
    || next.exotelAccountSid !== current.exotelAccountSid || next.exotelSubdomain !== current.exotelSubdomain
    || next.exotelCallerId !== current.exotelCallerId;
  if (credsChanged) next.exotelVerifiedAt = null;

  if (!next.inboundKey) next.inboundKey = newInboundKey();
  if (!process.env.PUBLIC_BASE_URL?.trim() && opts.requestBaseUrl && /^https:\/\/[^/\s]+$/i.test(opts.requestBaseUrl)) {
    next.publicBaseUrl = opts.requestBaseUrl.replace(/\/+$/, "");
  }

  const changed: string[] = AUDITED.filter((f) => JSON.stringify((current as any)[f] ?? null) !== JSON.stringify((next as any)[f] ?? null));
  const pick = (s: Record<string, unknown>) => Object.fromEntries(
    changed.filter((f) => !["callPurpose", "openingLine", "inboundGreeting", "transferNumber", "exotelCallerId"].includes(f)).map((f) => [f, s[f] ?? null]),
  );
  const now = new Date();
  const { businessAccountId: _b, createdAt: _c, ...values } = next;
  const saved = { ...values, updatedBy: actorUserId, updatedAt: now };
  const [row] = await db.insert(aiCallingSettings)
    .values({ ...saved, businessAccountId, createdAt: now })
    .onConflictDoUpdate({ target: aiCallingSettings.businessAccountId, set: saved })
    .returning();
  invalidateSettingsCache(businessAccountId);
  return { changed, secretsChanged, attested, before: pick(current as any), after: pick(next as any), row };
}

export async function markProviderVerified(businessAccountId: string): Promise<void> {
  await db.update(aiCallingSettings).set({ exotelVerifiedAt: new Date() }).where(eq(aiCallingSettings.businessAccountId, businessAccountId));
}

export async function rotateInboundKey(businessAccountId: string, actorUserId: string | null): Promise<AiCallingSettingsRow> {
  const current = await getSettingsRow(businessAccountId);
  if (!current) {
    const r = await updateCallingSettings(businessAccountId, {}, actorUserId);
    return r.row;
  }
  const [row] = await db.update(aiCallingSettings)
    .set({ inboundKey: newInboundKey(), updatedBy: actorUserId, updatedAt: new Date() })
    .where(eq(aiCallingSettings.businessAccountId, businessAccountId))
    .returning();
  invalidateSettingsCache(businessAccountId);
  return row;
}

// ── tiny cache for hot paths (lead trigger) ──────────────────────────────────

const cache = new Map<string, { row: AiCallingSettingsRow | null; expiresAt: number }>();
const CACHE_TTL_MS = 20_000;

export function invalidateSettingsCache(businessAccountId?: string): void {
  if (businessAccountId) cache.delete(businessAccountId);
  else cache.clear();
}

/** Settings row (or null) cached for 20 s — for the lead-creation hook only. */
export async function getSettingsRowCached(businessAccountId: string): Promise<AiCallingSettingsRow | null> {
  const hit = cache.get(businessAccountId);
  if (hit && hit.expiresAt > Date.now()) return hit.row;
  const row = await getSettingsRow(businessAccountId);
  cache.set(businessAccountId, { row, expiresAt: Date.now() + CACHE_TTL_MS });
  return row;
}
