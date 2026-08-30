import { db, pool } from "../db";
import {
  marketingCampaigns,
  marketingCampaignRecipients,
  marketingCampaignMessages,
  whatsappCampaignAutomations,
  whatsappCampaignAutomationRuns,
  whatsappTemplates,
  whatsappOptOuts,
  whatsappAiWorkbooks,
  whatsappAiWorkbookVersions,
  type MarketingCampaign,
  type MarketingCampaignRecipient,
  type WhatsappTemplate,
  type ReplyClassification,
} from "@shared/schema";
import { parseSpreadsheetDate } from "@shared/spreadsheetDate";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { contactGroupService, normalizePhone, applyCountryCode } from "./contactGroupService";
import { contactGroups } from "@shared/schema";
import { sendTemplateMessage } from "./whatsappSessionService";
import { whatsappService } from "./whatsappService";
import { checkCampaignPrerequisites, type PrerequisiteFailure } from "./whatsapp/campaignPrerequisites";

/**
 * Thrown when a campaign is missing an approved template or a non-empty audience.
 * Carries the machine-readable code so the API layer can tell the client which
 * screen fixes the problem, instead of surfacing an opaque message.
 */
/**
 * Stop an unsendable campaign from being retried forever, without losing what already happened.
 *
 * A campaign that cannot succeed — withdrawn template, emptied audience, blank template
 * parameter — would otherwise be picked up again on every tick by the scheduler (status
 * 'scheduled') or by stuck-campaign recovery (status 'sending' with a stale heartbeat).
 *
 * Where it gets parked matters, and the two cases are not the same:
 *
 *   - Nothing dispatched yet: 'draft' is right. Nothing auto-retries a draft and the user can
 *     edit it to fix the problem.
 *   - Some messages already went out: 'draft' is actively harmful. The recipient rows are
 *     already snapshotted, so a later send reuses that old audience rather than rebuilding it,
 *     and making the campaign editable again means it could go out under changed settings to a
 *     list the user thinks they replaced. It also erases the fact that a partial send happened.
 *     Such a campaign is marked 'failed', which is terminal and preserves the record.
 */
async function parkUnsendableCampaign(
  campaignId: string,
  businessAccountId: string,
  currentStatus: string,
  reason: string,
): Promise<void> {
  if (currentStatus !== "scheduled" && currentStatus !== "sending") return;

  const [dispatched] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(marketingCampaignRecipients)
    .where(
      and(
        eq(marketingCampaignRecipients.campaignId, campaignId),
        inArray(marketingCampaignRecipients.status, ["sent", "delivered", "read", "replied"]),
      ),
    );

  const alreadySent = (dispatched?.n ?? 0) > 0;
  const parkedStatus = alreadySent ? "failed" : "draft";

  await db
    .update(marketingCampaigns)
    .set({ status: parkedStatus, heartbeatAt: null, updatedAt: new Date() })
    .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.businessAccountId, businessAccountId)));

  console.warn(
    `[Campaign] ${campaignId} parked as ${parkedStatus}` +
      (alreadySent ? ` after ${dispatched?.n} message(s) already sent` : "") +
      ` — ${reason}`,
  );
}

export class CampaignPrerequisiteError extends Error {
  code: PrerequisiteFailure["code"];
  constructor(failure: PrerequisiteFailure) {
    super(failure.message);
    this.name = "CampaignPrerequisiteError";
    this.code = failure.code;
  }
}

// In-memory locks are a fast-path optimization only — true coordination is the DB.
const inFlight = new Set<string>();

/**
 * Fetch WhatsApp message reports from MSG91's bulk reports endpoint.
 *
 *   POST https://control.msg91.com/api/v5/report/logs/wa
 *        ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Returns the full activity log for the tenant in the given window
 * (max 3 days per call, per MSG91 docs). Each row carries `requestId`
 * (== our msg91MessageId), `status`, `failureReason`, `customerNumber`,
 * etc. This is the only working pull-status API for MSG91 v5 WhatsApp —
 * verified empirically against the live tenant. There is no per-UUID
 * GET endpoint; an earlier guess at one returned 404 silently and is
 * the reason the previous reconciler appeared to do nothing.
 */
type Msg91ReportRow = {
  requestId: string;
  status: string;
  failureReason?: string | null;
  customerNumber?: string | null;
  templateName?: string | null;
  metaErrorCode?: string | null;
  sentTime?: string | null;
  deliveryTime?: string | null;
  readTime?: string | null;
};

function ymd(d: Date): string {
  // MSG91 buckets activity by IST calendar day. We render the date in IST
  // (UTC+5:30) so requests like "give me May 4" match what MSG91 has filed
  // under May 4. Using UTC slicing here causes a silent miss for any
  // message sent between 18:30 and 23:59 UTC (00:00–05:29 IST next day).
  const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

async function fetchMsg91Reports(
  authKey: string,
  startDate: Date,
  endDate: Date,
): Promise<Msg91ReportRow[]> {
  const url = `https://control.msg91.com/api/v5/report/logs/wa?startDate=${ymd(startDate)}&endDate=${ymd(endDate)}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        authkey: authKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      console.warn(`[Campaign] MSG91 reports HTTP ${resp.status} for ${ymd(startDate)}..${ymd(endDate)}: ${errBody.substring(0, 300)}`);
      return [];
    }
    const data: any = await resp.json().catch(() => null);
    const rows: any[] = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    return rows.map((r) => ({
      requestId: (r?.requestId ?? r?.request_id ?? "").toString(),
      status: (r?.status ?? "").toString(),
      failureReason: r?.failureReason ?? r?.failure_reason ?? null,
      customerNumber: r?.customerNumber ?? null,
      templateName: r?.templateName ?? null,
      metaErrorCode: r?.metaErrorCode ?? null,
      sentTime: r?.sentTime ?? null,
      deliveryTime: r?.deliveryTime ?? null,
      readTime: r?.readTime ?? null,
    })).filter(r => r.requestId);
  } catch (err) {
    console.error(`[Campaign] fetchMsg91Reports error:`, err);
    return [];
  }
}

function mapMsg91StatusToKind(status: string): "sent" | "delivered" | "read" | "failed" | null {
  const s = (status || "").toLowerCase();
  if (!s) return null;
  if (s.includes("read")) return "read";
  if (s.includes("fail") || s.includes("undeliv") || s.includes("reject")) return "failed";
  if (s.includes("deliv")) return "delivered";
  if (s.includes("sent") || s.includes("submit") || s.includes("accept") || s === "enroute") return "sent";
  return null;
}

// Heartbeat / recovery tuning
const HEARTBEAT_INTERVAL_MS = 15 * 1000;
const STALE_CAMPAIGN_HEARTBEAT_MS = 3 * 60 * 1000; // No heartbeat for 3 min ⇒ campaign considered crashed
const STALE_RECIPIENT_CLAIM_MS = 5 * 60 * 1000;     // claimedAt older than 5 min ⇒ release back to pending
const SEND_BATCH_SIZE = 20;
const SEND_DELAY_MS = 250;

interface CreatePayload {
  name: string;
  campaignType?: "one_time" | "automation";
  templateId: string;
  templateParams?: string[];
  groupIds: string[];
  scheduledAt?: Date | null;
  aiEnabled?: boolean;
  aiAgentName?: string;
  aiSystemPrompt?: string;
  aiUseFaqs?: boolean;
  aiUseDocs?: boolean;
  aiUseProducts?: boolean;
  aiKnowledgeDocIds?: string[];
  aiDailyTokenBudget?: number;
  aiMaxRepliesPerRecipient?: number;
  replyClassifications?: ReplyClassification[];
  recipientSourceType?: "ai_workbook" | "contact_groups" | null;
  recipientWorkbookId?: string | null;
  recipientWorkbookSheetId?: string | null;
  recipientPhoneColumn?: string | null;
  recipientNameColumn?: string | null;
  recipientRecordKeyColumn?: string | null;
  recipientDateColumn?: string | null;
  recipientDateOffsetDays?: number;
  recipientStatusColumn?: string | null;
  recipientEligibleStatuses?: string[];
  recipientAiAllowedFields?: string[];
}

const campaignSourceFields = [
  "recipientSourceType", "recipientWorkbookId", "recipientWorkbookSheetId",
  "recipientPhoneColumn", "recipientNameColumn", "recipientRecordKeyColumn",
  "recipientDateColumn", "recipientDateOffsetDays", "recipientStatusColumn", "recipientEligibleStatuses",
  "recipientAiAllowedFields",
] as const;

const sourceKey = (value: unknown) => String(value || "").trim().toLowerCase();
const sourceRefs = (value: string) => Array.from(value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g))
  .map(match => sourceKey(match[1])).filter(Boolean);

/** Validate the live, campaign-owned workbook before saving its definition. */
async function validateCampaignWorkbookSource(businessAccountId: string, input: Partial<CreatePayload>) {
  const supplied = campaignSourceFields.some(field => (input as any)[field] !== undefined);
  if (!supplied) return;
  if (input.recipientSourceType === "contact_groups") {
    const groupIds = Array.from(new Set((input.groupIds || []).filter(Boolean)));
    if (!groupIds.length) throw new Error("Choose at least one contact group for this campaign");
    const groups = await Promise.all(groupIds.map(id => contactGroupService.get(businessAccountId, id)));
    if (groups.some(group => !group || group.contactCount <= 0)) {
      throw new Error("Selected contact groups must exist and contain contacts");
    }
    const contacts = await contactGroupService.getContactsForGroups(businessAccountId, groupIds);
    if (!contacts.length) throw new Error("Selected contact groups contain no contacts");
    const columns = new Set([
      "phone",
      "name",
      ...contacts.flatMap(contact => Object.keys((contact.attributes || {}) as Record<string, string>).map(sourceKey)),
    ]);
    const required = [
      input.recipientPhoneColumn, input.recipientRecordKeyColumn, input.recipientDateColumn,
    ].map(sourceKey);
    if (required.some(value => !value)) {
      throw new Error("Campaign contact-group phone, record key, and date mappings are required");
    }
    for (const column of [...required, sourceKey(input.recipientNameColumn), sourceKey(input.recipientStatusColumn)]) {
      if (column && !columns.has(column)) throw new Error(`The selected contact groups do not have the "${column}" field`);
    }
    if (!Number.isInteger(input.recipientDateOffsetDays ?? 0) || Math.abs(input.recipientDateOffsetDays ?? 0) > 366) {
      throw new Error("Campaign date offset must be a whole number between -366 and 366");
    }
    if ((input.recipientEligibleStatuses || []).length && !sourceKey(input.recipientStatusColumn)) {
      throw new Error("A status mapping is required when eligible statuses are configured");
    }
    const refs = (input.templateParams || []).flatMap(sourceRefs);
    if (refs.some(ref => !columns.has(ref))) {
      throw new Error("A template parameter references a field not present in the selected contact groups");
    }
    for (let index = 0; index < contacts.length; index++) {
      const contact = contacts[index];
      const attributes = (contact.attributes || {}) as Record<string, string>;
      const value = (key: string) => key === "phone"
        ? String(contact.phone || "").trim()
        : key === "name"
          ? String(contact.name || "").trim()
          : String(attributes[key] ?? "").trim();
      const phone = normalizePhone(value(sourceKey(input.recipientPhoneColumn)));
      const dateColumn = sourceKey(input.recipientDateColumn);
      const recordKeyColumn = sourceKey(input.recipientRecordKeyColumn);
      const date = value(dateColumn);
      if (phone.length < 8) {
        throw new Error(`Contact-group recipient ${index + 1} has an invalid or missing phone in "${sourceKey(input.recipientPhoneColumn)}"`);
      }
      if (!value(recordKeyColumn)) {
        throw new Error(`Contact-group recipient ${index + 1} is missing record key "${recordKeyColumn}"`);
      }
      if (!parseSpreadsheetDate(date)) {
        throw new Error(`Contact-group recipient ${index + 1} has an invalid date in "${dateColumn}"; use YYYY-MM-DD`);
      }
      const missingTemplateField = refs.find(ref => !value(ref));
      if (missingTemplateField) {
        throw new Error(`Contact-group recipient ${index + 1} is missing template field "${missingTemplateField}"`);
      }
    }
    input.recipientAiAllowedFields = [];
    return;
  }
  if (input.recipientSourceType !== "ai_workbook") {
    throw new Error("Choose a valid campaign recipient source");
  }
  const workbookId = String(input.recipientWorkbookId || "").trim();
  const sheetId = String(input.recipientWorkbookSheetId || "").trim();
  if (!workbookId || !sheetId) throw new Error("Choose exactly one AI Workbook sheet for this campaign");
  const [workbook] = await db.select().from(whatsappAiWorkbooks).where(and(
    eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId),
    eq(whatsappAiWorkbooks.status, "active"),
  )).limit(1);
  if (!workbook) throw new Error("The selected AI Workbook is not active or does not belong to this business");
  const [version] = await db.select().from(whatsappAiWorkbookVersions).where(and(
    eq(whatsappAiWorkbookVersions.workbookId, workbookId),
    eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
  )).orderBy(desc(whatsappAiWorkbookVersions.versionNumber)).limit(1);
  if (!version) throw new Error("The selected AI Workbook has no saved version");
  const sheets = Array.isArray(version.sheets) ? version.sheets : [];
  const sheet = sheets.find(s => s.id === sheetId);
  if (!sheet || !sheet.columns.length) throw new Error("The selected AI Workbook sheet is unavailable");
  const columns = new Set(sheet.columns.map(c => sourceKey(c.key)));
  const required = [
    input.recipientPhoneColumn, input.recipientRecordKeyColumn, input.recipientDateColumn,
  ].map(sourceKey);
  if (required.some(v => !v)) throw new Error("Campaign workbook phone, record key, and date mappings are required");
  if (!Number.isInteger(input.recipientDateOffsetDays ?? 0) || Math.abs(input.recipientDateOffsetDays ?? 0) > 366) {
    throw new Error("Campaign workbook date offset must be a whole number between -366 and 366");
  }
  for (const column of [...required, sourceKey(input.recipientNameColumn), sourceKey(input.recipientStatusColumn)]) {
    if (column && !columns.has(column)) throw new Error(`The selected AI Workbook no longer has the "${column}" column`);
  }
  const allowed = Array.from(new Set((input.recipientAiAllowedFields || []).map(sourceKey).filter(Boolean)));
  if (allowed.some(column => !columns.has(column))) throw new Error("Campaign AI allowlist contains a column not present in the selected sheet");
  if ((input.recipientEligibleStatuses || []).length && !sourceKey(input.recipientStatusColumn)) {
    throw new Error("A status mapping is required when eligible statuses are configured");
  }
  const refs = (input.templateParams || []).flatMap(sourceRefs);
  if (refs.some(ref => ref !== "name" && ref !== "phone" && !columns.has(ref))) {
    throw new Error("A template parameter references a column not present in the selected sheet");
  }
  // Validate every row now, not just rows that happen to be eligible today.
  for (let i = 0; i < sheet.rows.length; i++) {
    const values = sheet.rows[i].values || {};
    const value = (key: string) => String(values[key] ?? "").trim();
    const phone = normalizePhone(value(sourceKey(input.recipientPhoneColumn)));
    const phoneColumn = sourceKey(input.recipientPhoneColumn);
    const recordKeyColumn = sourceKey(input.recipientRecordKeyColumn);
    const dateColumn = sourceKey(input.recipientDateColumn);
    const date = value(dateColumn);
    const missingTemplateField = refs.find(ref =>
      (ref === "name" ? !value(sourceKey(input.recipientNameColumn)) : ref !== "phone" && !value(ref))
    );
    if (phone.length < 8) {
      throw new Error(`Workbook row ${i + 2} has an invalid or missing phone in "${phoneColumn}"`);
    }
    if (!value(recordKeyColumn)) {
      throw new Error(`Workbook row ${i + 2} is missing record key "${recordKeyColumn}"`);
    }
    if (!parseSpreadsheetDate(date)) {
      throw new Error(`Workbook row ${i + 2} has an invalid date in "${dateColumn}"; use YYYY-MM-DD`);
    }
    if (missingTemplateField) {
      throw new Error(`Workbook row ${i + 2} is missing template field "${missingTemplateField}"`);
    }
  }
  input.recipientAiAllowedFields = allowed;
}

/** Sentinel filter value for "replied, but the classifier matched no category". */
export const UNCLASSIFIED_FILTER = "__unclassified__";

/**
 * Build the outcome filter shared by listRecipients and countRecipients.
 *
 * Kept as one helper precisely because those two must never disagree — a filter
 * applied to the rows but not the tallies produces a footer promising pages that
 * return nothing.
 */
function classificationCondition(classification?: string) {
  if (!classification) return undefined;
  if (classification === UNCLASSIFIED_FILTER) {
    return sql`first_reply_at IS NOT NULL AND primary_classification IS NULL`;
  }
  return eq(marketingCampaignRecipients.primaryClassification, classification);
}

/**
 * Escape one CSV cell.
 *
 * The leading-character guard is deliberate: customer feedback and imported
 * attributes are free text that lands in a file operators open in Excel, and a
 * value starting with = + - or @ is executed as a formula there. Prefixing a
 * tab neutralises that without altering the visible value.
 */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `\t${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Caps on the classification config. These bound the classifier prompt, which is
 *  rebuilt from this config on every inbound message — an unbounded list would
 *  quietly multiply per-reply token cost across the whole campaign. */
const MAX_CLASSIFICATIONS = 25;
const MAX_CAPTURE_FIELDS = 8;
const VALID_FIELD_TYPES = new Set(["text", "date", "boolean"]);

/**
 * Validate and normalise operator-supplied classification config.
 *
 * This is user input that ends up inside an LLM system prompt and whose `key`
 * becomes the value every dashboard tally groups by, so it is checked rather
 * than trusted: keys must be unique and non-empty, and the shape must be exact.
 * Throws on malformed input so the API surfaces a 400 instead of saving config
 * that would fail at classification time.
 */
function normalizeClassifications(input: unknown): ReplyClassification[] {
  if (input === null || input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("replyClassifications must be an array");
  if (input.length > MAX_CLASSIFICATIONS) {
    throw new Error(`A campaign can define at most ${MAX_CLASSIFICATIONS} reply categories`);
  }

  const seen = new Set<string>();
  return input.map((raw: any, i: number) => {
    const key = String(raw?.key ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    if (!key) throw new Error(`Reply category ${i + 1} is missing a key`);
    if (!/^[A-Z0-9_]+$/.test(key)) {
      throw new Error(`Reply category key "${key}" may only contain letters, numbers and underscores`);
    }
    if (seen.has(key)) throw new Error(`Duplicate reply category key "${key}"`);
    seen.add(key);

    const captureRaw = raw?.captureFields;
    if (captureRaw !== undefined && captureRaw !== null && !Array.isArray(captureRaw)) {
      throw new Error(`captureFields for "${key}" must be an array`);
    }
    const fieldKeys = new Set<string>();
    const captureFields = ((captureRaw as any[]) || []).slice(0, MAX_CAPTURE_FIELDS).map((f: any) => {
      const fieldKey = String(f?.fieldKey ?? "").trim().toLowerCase().replace(/\s+/g, "_");
      if (!fieldKey) throw new Error(`A capture field on "${key}" is missing a field key`);
      if (fieldKeys.has(fieldKey)) throw new Error(`Duplicate capture field "${fieldKey}" on "${key}"`);
      fieldKeys.add(fieldKey);
      const fieldType = String(f?.fieldType ?? "text");
      return {
        fieldKey,
        fieldLabel: String(f?.fieldLabel ?? fieldKey).trim().substring(0, 120),
        fieldType: (VALID_FIELD_TYPES.has(fieldType) ? fieldType : "text") as "text" | "date" | "boolean",
      };
    });

    return {
      key,
      label: String(raw?.label ?? key).trim().substring(0, 120),
      description: String(raw?.description ?? "").trim().substring(0, 500),
      captureFields,
    };
  });
}

function toFlag(v: boolean | undefined, fallback = "true"): string {
  if (v === undefined) return fallback;
  return v ? "true" : "false";
}

function todayBucket(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

// 64-bit signed int derived from a string for pg_advisory_lock keys
function advisoryLockKey(str: string): bigint {
  // BigInt FNV-1a 64-bit; result fits in PostgreSQL bigint
  let hash = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & BigInt("0xffffffffffffffff");
  }
  // Convert to signed 64-bit
  const SIGN_BIT = BigInt("0x8000000000000000");
  const TWO_64 = BigInt("0x10000000000000000");
  if (hash >= SIGN_BIT) hash -= TWO_64;
  return hash;
}

/**
 * WhatsApp rejects a template message whose personalization slots are blank — "Parameter of type
 * text is missing text value" — and it does so per recipient, so a campaign saved with an empty
 * parameter fails for everyone it is sent to. Catch it while it is still correctable.
 *
 * Counts against the template's own parameter count rather than the length of the saved list, so
 * a list that is too short (which pads to empty strings at send time) is caught as well.
 */
export function validateTemplateParams(template: WhatsappTemplate, values: string[] | null | undefined): string | null {
  const required = template.paramCount || 0;
  if (required === 0) return null;
  const params = (values || []) as string[];
  const missing: number[] = [];
  for (let i = 0; i < required; i++) {
    if (!(params[i] ?? "").trim()) missing.push(i + 1);
  }
  if (missing.length === 0) return null;
  const which = missing.length === 1 ? `Parameter ${missing[0]} is` : `Parameters ${missing.join(", ")} are`;
  return `${which} blank. Template "${template.name}" needs ${required} value${required === 1 ? "" : "s"}, and WhatsApp refuses to deliver a message with an empty parameter.`;
}

/** Store exactly one trimmed value per template parameter, so a short or padded list can't persist. */
function normalizeParams(template: WhatsappTemplate, values: string[] | null | undefined): string[] {
  const required = template.paramCount || 0;
  const params = (values || []) as string[];
  return Array.from({ length: required }, (_, i) => (params[i] ?? "").trim());
}

/**
 * Fills a campaign's parameters for one recipient. Also reports anything that came out unusable,
 * because both cases produce a message WhatsApp will reject or a customer shouldn't see: a value
 * that resolved to nothing (`{{name}}` for a contact with no name) and one still carrying a
 * placeholder the contact has no field for (`{{city}}` would otherwise be sent literally).
 */
export function resolveParams(
  template: WhatsappTemplate,
  campaign: MarketingCampaign,
  recipient: MarketingCampaignRecipient,
  knownFields: Set<string> = new Set(["name", "phone"]),
): { params: Record<string, string>; problems: string[] } {
  const out: Record<string, string> = {};
  const problems: string[] = [];
  const params = (campaign.templateParams || []) as string[];
  for (let i = 0; i < (template.paramCount || 0); i++) {
    const raw = (params[i] ?? "").trim();
    let resolved = raw;
    resolved = resolved.replace(/\{\{\s*name\s*\}\}/gi, recipient.name || "");
    resolved = resolved.replace(/\{\{\s*phone\s*\}\}/gi, recipient.phone || "");
    const attrs = (recipient.attributes || {}) as Record<string, string>;
    for (const [k, v] of Object.entries(attrs)) {
      const re = new RegExp(`\\{\\{\\s*${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "gi");
      resolved = resolved.replace(re, v ?? "");
    }
    resolved = resolved.trim();
    out[String(i + 1)] = resolved;

    const slot = raw ? `Parameter ${i + 1} ("${raw}")` : `Parameter ${i + 1}`;
    if (!resolved) {
      problems.push(`${slot} is empty for this contact`);
    } else {
      // Only a leftover token naming a real contact field is a fault. Braces alone prove nothing —
      // "Use code {{SAVE20}}" is literal text somebody typed, and must go out untouched.
      const leftover = (resolved.match(/\{\{\s*[^{}]+?\s*\}\}/g) || [])
        .filter(m => knownFields.has(m.replace(/[{}]/g, "").trim().toLowerCase()));
      if (leftover.length) problems.push(`${slot} still contains ${leftover.join(", ")} — this contact has no such field`);
    }
  }
  return { params: out, problems };
}

export const marketingCampaignService = {
  async list(businessAccountId: string): Promise<MarketingCampaign[]> {
    return db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.businessAccountId, businessAccountId))
      .orderBy(desc(marketingCampaigns.createdAt));
  },

  async get(businessAccountId: string, id: string): Promise<MarketingCampaign | undefined> {
    const [row] = await db
      .select()
      .from(marketingCampaigns)
      .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.businessAccountId, businessAccountId)))
      .limit(1);
    return row;
  },

  async create(businessAccountId: string, payload: CreatePayload): Promise<MarketingCampaign> {
    if (payload.campaignType !== undefined && payload.campaignType !== "one_time" && payload.campaignType !== "automation") {
      throw new Error("campaignType must be one_time or automation");
    }
    const campaignType = payload.campaignType === "automation" ? "automation" : "one_time";
    // One shared definition of "usable template" and "usable audience", also applied at send
    // time and by the readiness summary. An approved-but-since-withdrawn template or a group
    // that has been emptied must not slip through just because it passed once.
    if (campaignType === "one_time") {
      const missing = await checkCampaignPrerequisites(businessAccountId, {
        templateId: payload.templateId,
        groupIds: payload.groupIds,
      });
      if (missing) throw new CampaignPrerequisiteError(missing);
    }

    const [tpl] = await db
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, payload.templateId), eq(whatsappTemplates.businessAccountId, businessAccountId)))
      .limit(1);
    if (!tpl || tpl.deletedAt) throw new Error("Template not found for this business");
    if (tpl.status !== "approved") throw new Error("Choose an approved WhatsApp template");

    const paramError = validateTemplateParams(tpl, payload.templateParams);
    if (paramError) throw new Error(paramError);
    await validateCampaignWorkbookSource(businessAccountId, payload);

    const [row] = await db
      .insert(marketingCampaigns)
      .values({
        businessAccountId,
        name: payload.name.trim(),
        campaignType,
        templateId: payload.templateId,
        templateParams: normalizeParams(tpl, payload.templateParams),
        groupIds: campaignType === "automation" && payload.recipientSourceType !== "contact_groups"
          ? []
          : payload.groupIds,
        status: campaignType === "one_time" && payload.scheduledAt ? "scheduled" : "draft",
        scheduledAt: campaignType === "one_time" ? payload.scheduledAt || null : null,
        aiEnabled: toFlag(payload.aiEnabled, "true"),
        aiAgentName: payload.aiAgentName || "Sales Agent",
        aiSystemPrompt: payload.aiSystemPrompt || "",
        aiUseFaqs: toFlag(payload.aiUseFaqs, "true"),
        aiUseDocs: toFlag(payload.aiUseDocs, "true"),
        aiUseProducts: toFlag(payload.aiUseProducts, "true"),
        aiKnowledgeDocIds: payload.aiKnowledgeDocIds || [],
        aiDailyTokenBudget: payload.aiDailyTokenBudget ?? 50000,
        aiMaxRepliesPerRecipient: payload.aiMaxRepliesPerRecipient ?? 20,
        replyClassifications: normalizeClassifications(payload.replyClassifications),
        recipientSourceType: payload.recipientSourceType || null,
        recipientWorkbookId: payload.recipientWorkbookId || null,
        recipientWorkbookSheetId: payload.recipientWorkbookSheetId || null,
        recipientPhoneColumn: payload.recipientPhoneColumn || null,
        recipientNameColumn: payload.recipientNameColumn || "",
        recipientRecordKeyColumn: payload.recipientRecordKeyColumn || null,
        recipientDateColumn: payload.recipientDateColumn || null,
        recipientDateOffsetDays: payload.recipientDateOffsetDays ?? 0,
        recipientStatusColumn: payload.recipientStatusColumn || "",
        recipientEligibleStatuses: payload.recipientEligibleStatuses || [],
        recipientAiAllowedFields: payload.recipientAiAllowedFields || [],
      })
      .returning();
    return row;
  },

  // `onlyIfStatusIn` makes the status check part of the UPDATE itself, so a send that starts
  // between a caller's read and its write cannot have its configuration changed underneath it.
  async update(businessAccountId: string, id: string, payload: Partial<CreatePayload> & { status?: string }, opts?: { onlyIfStatusIn?: string[] }): Promise<MarketingCampaign | undefined> {
    const [executionRun] = await db.select({ id: whatsappCampaignAutomationRuns.id })
      .from(whatsappCampaignAutomationRuns)
      .where(and(
        eq(whatsappCampaignAutomationRuns.businessAccountId, businessAccountId),
        eq(whatsappCampaignAutomationRuns.campaignId, id),
      ))
      .limit(1);
    if (executionRun) {
      throw new Error("Automation execution campaigns are immutable. Change the source blueprint for future runs instead.");
    }
    const current = await this.get(businessAccountId, id);
    if (!current) return undefined;
    if (payload.campaignType !== undefined && payload.campaignType !== "one_time" && payload.campaignType !== "automation") {
      throw new Error("campaignType must be one_time or automation");
    }
    const campaignType = payload.campaignType === "automation"
      ? "automation"
      : payload.campaignType === "one_time" ? "one_time" : current.campaignType === "automation" ? "automation" : "one_time";
    const isAutomationToOneTime = current.campaignType === "automation" && campaignType === "one_time";
    if (campaignType === "automation") {
      payload = { ...payload, campaignType, groupIds: [], scheduledAt: null, status: "draft" };
    }
    // Editing the template or the audience must be held to the same bar as creating one,
    // otherwise a valid campaign can be edited into an unsendable state and only fail later.
    if (campaignType === "one_time" && (payload.templateId !== undefined || payload.groupIds !== undefined || payload.campaignType !== undefined)) {
      const missing = await checkCampaignPrerequisites(businessAccountId, {
        templateId: payload.templateId ?? current.templateId,
        groupIds: payload.groupIds ?? ((current.groupIds as string[]) || []),
      });
      if (missing) throw new CampaignPrerequisiteError(missing);
    }

    // Hold a saved campaign to the same rule as a new one: no blank parameters. Switching the
    // template counts too, since the new one may expect a different number of values.
    if (payload.templateParams !== undefined || payload.templateId !== undefined) {
      const templateId = payload.templateId ?? current.templateId;
      const [tpl] = await db
        .select()
        .from(whatsappTemplates)
        .where(and(eq(whatsappTemplates.id, templateId), eq(whatsappTemplates.businessAccountId, businessAccountId)))
        .limit(1);
      if (!tpl || tpl.deletedAt) throw new Error("Template not found for this business");
      const values = payload.templateParams ?? (current.templateParams as string[]);
      const paramError = validateTemplateParams(tpl, values);
      if (paramError) throw new Error(paramError);
      payload = { ...payload, templateParams: normalizeParams(tpl, values) };
    }
    if (
      campaignSourceFields.some(field => (payload as any)[field] !== undefined)
      || (current.recipientSourceType === "ai_workbook"
        && (payload.templateParams !== undefined || payload.templateId !== undefined))
    ) {
      const sourcePayload = { ...current, ...payload } as Partial<CreatePayload>;
      await validateCampaignWorkbookSource(businessAccountId, sourcePayload);
      payload = { ...payload, recipientAiAllowedFields: sourcePayload.recipientAiAllowedFields };
    }

    const set: any = { updatedAt: new Date() };
    const fields: (keyof CreatePayload)[] = [
      "name", "campaignType", "templateId", "templateParams", "groupIds",
      "aiAgentName", "aiSystemPrompt", "aiKnowledgeDocIds",
      "aiDailyTokenBudget", "aiMaxRepliesPerRecipient",
      ...campaignSourceFields,
    ];
    for (const f of fields) {
      if ((payload as any)[f] !== undefined) (set as any)[f] = (payload as any)[f];
    }
    if (payload.scheduledAt !== undefined) set.scheduledAt = payload.scheduledAt;
    if (payload.aiEnabled !== undefined) set.aiEnabled = toFlag(payload.aiEnabled, "true");
    if (payload.aiUseFaqs !== undefined) set.aiUseFaqs = toFlag(payload.aiUseFaqs, "true");
    if (payload.aiUseDocs !== undefined) set.aiUseDocs = toFlag(payload.aiUseDocs, "true");
    if (payload.aiUseProducts !== undefined) set.aiUseProducts = toFlag(payload.aiUseProducts, "true");
    if (payload.replyClassifications !== undefined) {
      set.replyClassifications = normalizeClassifications(payload.replyClassifications);
    }
    if (payload.status !== undefined) set.status = payload.status;
    const where = and(
      eq(marketingCampaigns.id, id),
      eq(marketingCampaigns.businessAccountId, businessAccountId),
      ...(opts?.onlyIfStatusIn ? [inArray(marketingCampaigns.status, opts.onlyIfStatusIn)] : []),
    );
    if (isAutomationToOneTime) {
      return db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"wa-blueprint:" + id}))`);
        const [lockedCampaign] = await tx.select({ id: marketingCampaigns.id })
          .from(marketingCampaigns)
          .where(and(
            eq(marketingCampaigns.id, id),
            eq(marketingCampaigns.businessAccountId, businessAccountId),
          ))
          .for("update")
          .limit(1);
        if (!lockedCampaign) return undefined;
        const [blueprintUse] = await tx.select({ id: whatsappCampaignAutomations.id })
          .from(whatsappCampaignAutomations)
          .where(and(
            eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
            eq(whatsappCampaignAutomations.sourceCampaignId, id),
            isNull(whatsappCampaignAutomations.deletedAt),
          ))
          .limit(1);
        if (blueprintUse) throw new Error("Delete the linked automation before changing this into a one-time campaign");
        const [row] = await tx.update(marketingCampaigns).set(set).where(where).returning();
        return row;
      });
    }
    const [row] = await db.update(marketingCampaigns).set(set).where(where).returning();
    return row;
  },

  async remove(businessAccountId: string, id: string): Promise<boolean> {
    const [executionRun] = await db.select({ id: whatsappCampaignAutomationRuns.id })
      .from(whatsappCampaignAutomationRuns)
      .where(and(
        eq(whatsappCampaignAutomationRuns.businessAccountId, businessAccountId),
        eq(whatsappCampaignAutomationRuns.campaignId, id),
      ))
      .limit(1);
    if (executionRun) throw new Error("Automation execution campaigns cannot be deleted because they are part of run history");
    const [blueprintUse] = await db.select({ id: whatsappCampaignAutomations.id })
      .from(whatsappCampaignAutomations)
      .where(and(
        eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
        eq(whatsappCampaignAutomations.sourceCampaignId, id),
        isNull(whatsappCampaignAutomations.deletedAt),
      ))
      .limit(1);
    if (blueprintUse) throw new Error("This campaign is used as an automation blueprint. Delete the automation before deleting the campaign");
    const result = await db
      .delete(marketingCampaigns)
      .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.businessAccountId, businessAccountId)))
      .returning({ id: marketingCampaigns.id });
    return result.length > 0;
  },

  async listRecipients(
    businessAccountId: string,
    campaignId: string,
    opts?: { limit?: number; offset?: number; status?: string; classification?: string },
  ): Promise<MarketingCampaignRecipient[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 1000);
    const offset = Math.max(opts?.offset ?? 0, 0);
    // "pending" is presented as a combined bucket in dashboards — claimed rows
    // are folded into pending in countRecipients, so the list must match.
    const statusCondition = opts?.status
      ? opts.status === "pending"
        ? inArray(marketingCampaignRecipients.status, ["pending", "claimed"])
        : eq(marketingCampaignRecipients.status, opts.status)
      : undefined;
    const where = and(
      eq(marketingCampaignRecipients.campaignId, campaignId),
      eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
      statusCondition,
      classificationCondition(opts?.classification),
    );
    return db
      .select()
      .from(marketingCampaignRecipients)
      .where(where)
      .orderBy(desc(marketingCampaignRecipients.createdAt))
      .limit(limit)
      .offset(offset);
  },

  /**
   * Status tallies for the recipient table's filter tabs.
   *
   * Takes the same `classification` filter as listRecipients on purpose: the tab
   * counts and the rows behind them are rendered together, so if only one of the
   * two narrowed by outcome the footer would advertise pages that don't exist.
   */
  async countRecipients(
    businessAccountId: string,
    campaignId: string,
    opts?: { classification?: string },
  ): Promise<{ total: number; pending: number; queued: number; sent: number; delivered: number; read: number; failed: number; expired: number; replied: number; opted_out: number }> {
    const rows = await db
      .select({
        status: marketingCampaignRecipients.status,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(marketingCampaignRecipients)
      .where(and(
        eq(marketingCampaignRecipients.campaignId, campaignId),
        eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
        classificationCondition(opts?.classification),
      ))
      .groupBy(marketingCampaignRecipients.status);
    const out: any = { total: 0, pending: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, expired: 0, replied: 0, opted_out: 0 };
    for (const r of rows) {
      out.total += r.cnt as number;
      if (out[r.status] !== undefined) out[r.status] = r.cnt as number;
      if (r.status === "claimed") out.pending += r.cnt as number; // present claimed as pending in dashboards
    }
    return out;
  },

  /**
   * Tenant-safe recipient transcript fetch. Verifies campaign ownership AND that the
   * recipient belongs to this campaign+business — closes the IDOR gap in the previous version.
   */
  async getMessagesForRecipient(businessAccountId: string, campaignId: string, recipientId: string) {
    const [campaign] = await db
      .select({ id: marketingCampaigns.id })
      .from(marketingCampaigns)
      .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.businessAccountId, businessAccountId)))
      .limit(1);
    if (!campaign) return null;

    const [recipient] = await db
      .select({ id: marketingCampaignRecipients.id })
      .from(marketingCampaignRecipients)
      .where(and(
        eq(marketingCampaignRecipients.id, recipientId),
        eq(marketingCampaignRecipients.campaignId, campaignId),
        eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
      ))
      .limit(1);
    if (!recipient) return null;

    return db
      .select()
      .from(marketingCampaignMessages)
      .where(and(
        eq(marketingCampaignMessages.recipientId, recipientId),
        eq(marketingCampaignMessages.campaignId, campaignId),
        eq(marketingCampaignMessages.businessAccountId, businessAccountId),
      ))
      .orderBy(marketingCampaignMessages.createdAt);
  },

  async snapshotRecipients(campaign: MarketingCampaign): Promise<number> {
    const optOuts = await contactGroupService.getOptOutSet(campaign.businessAccountId);
    const contacts = await contactGroupService.getContactsForGroups(campaign.businessAccountId, (campaign.groupIds || []) as string[]);
    const seen = new Set<string>();
    const rows: any[] = [];
    for (const c of contacts) {
      if (seen.has(c.phone) || optOuts.has(c.phone)) continue;
      seen.add(c.phone);
      rows.push({
        campaignId: campaign.id,
        businessAccountId: campaign.businessAccountId,
        groupId: c.groupId,
        phone: c.phone,
        name: c.name || "",
        attributes: c.attributes || {},
        status: "pending",
      });
    }
    if (rows.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await db.insert(marketingCampaignRecipients).values(rows.slice(i, i + CHUNK));
      }
    }
    await db
      .update(marketingCampaigns)
      .set({ totalRecipients: rows.length, updatedAt: new Date() })
      .where(eq(marketingCampaigns.id, campaign.id));
    return rows.length;
  },

  /**
   * Atomically claim up to `limit` pending recipients for this campaign using
   * `FOR UPDATE SKIP LOCKED`. Returns the freshly-claimed rows. This guarantees no
   * two workers (across pods) ever pick the same recipient.
   */
  async claimNextBatch(campaignId: string, limit = SEND_BATCH_SIZE): Promise<MarketingCampaignRecipient[]> {
    // Drizzle's raw sql template returns whatever we ask via RETURNING.
    const result: any = await db.execute(sql`
      WITH picked AS (
        SELECT id
        FROM ${marketingCampaignRecipients}
        WHERE campaign_id = ${campaignId}
          AND status = 'pending'
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ${marketingCampaignRecipients} AS r
      SET status = 'claimed', claimed_at = NOW()
      FROM picked
      WHERE r.id = picked.id
      RETURNING r.*;
    `);
    // node-postgres puts rows on .rows
    const rows: any[] = (result?.rows as any[]) ?? (Array.isArray(result) ? (result as any[]) : []);
    // Map snake_case to camelCase to match Drizzle inferred type expectations
    return rows.map((r: any) => ({
      id: r.id,
      campaignId: r.campaign_id,
      businessAccountId: r.business_account_id,
      groupId: r.group_id,
      phone: r.phone,
      name: r.name,
      attributes: r.attributes,
      status: r.status,
      msg91MessageId: r.msg91_message_id,
      errorMessage: r.error_message,
      sendPhone: r.send_phone,
      providerResponse: r.provider_response,
      sentAt: r.sent_at,
      deliveredAt: r.delivered_at,
      readAt: r.read_at,
      firstReplyAt: r.first_reply_at,
      replyCount: r.reply_count,
      aiReplyCount: r.ai_reply_count,
      claimedAt: r.claimed_at,
      createdAt: r.created_at,
    })) as MarketingCampaignRecipient[];
  },

  /**
   * Release recipient rows still in the 'claimed' state. By default uses the
   * normal stale-claim cutoff. Pass `cutoffMs: 0` (or any small value) to
   * release ALL claims for a campaign — used during forceResume recovery so
   * the new worker can re-claim rows the crashed worker left behind.
   */
  async releaseStaleClaims(campaignId?: string, cutoffMs: number = STALE_RECIPIENT_CLAIM_MS): Promise<number> {
    const cutoff = new Date(Date.now() - cutoffMs);
    const result: any = await db.execute(
      campaignId
        ? sql`
            UPDATE ${marketingCampaignRecipients}
            SET status = 'pending', claimed_at = NULL,
                error_message = COALESCE(error_message, '') || ' [recovered_stale_claim]'
            WHERE campaign_id = ${campaignId}
              AND status = 'claimed'
              AND (claimed_at IS NULL OR claimed_at <= ${cutoff})
            RETURNING id;
          `
        : sql`
            UPDATE ${marketingCampaignRecipients}
            SET status = 'pending', claimed_at = NULL,
                error_message = COALESCE(error_message, '') || ' [recovered_stale_claim]'
            WHERE status = 'claimed'
              AND (claimed_at IS NULL OR claimed_at <= ${cutoff})
            RETURNING id;
          `
    );
    const rows: any[] = (result?.rows as any[]) ?? [];
    return rows.length;
  },

  async startSend(
    businessAccountId: string,
    campaignId: string,
    opts?: { forceResume?: boolean; automationExecution?: boolean },
  ): Promise<{ started: boolean; reason?: string }> {
    const key = `${businessAccountId}:${campaignId}`;
    if (inFlight.has(key)) return { started: false, reason: "Campaign send is already in progress on this node" };

    const campaign = await this.get(businessAccountId, campaignId);
    if (!campaign) return { started: false, reason: "Campaign not found" };
    if (campaign.campaignType === "automation") {
      return { started: false, reason: "Automation campaign drafts can only run through Automations" };
    }
    const [executionRun] = await db.select({
      id: whatsappCampaignAutomationRuns.id,
      status: whatsappCampaignAutomationRuns.status,
    })
      .from(whatsappCampaignAutomationRuns)
      .where(and(
        eq(whatsappCampaignAutomationRuns.businessAccountId, businessAccountId),
        eq(whatsappCampaignAutomationRuns.campaignId, campaignId),
      ))
      .limit(1);
    if (executionRun) {
      if (!opts?.automationExecution) {
        return { started: false, reason: "Automation execution campaigns can only be started by their scheduled automation run" };
      }
      if (executionRun.status !== "scheduled") {
        return { started: false, reason: `This automation run is ${executionRun.status} and cannot be sent` };
      }
      if (campaign.scheduledAt && campaign.scheduledAt.getTime() > Date.now()) {
        return { started: false, reason: "This automation execution is not due yet" };
      }
    }
    const [blueprintUse] = await db.select({ id: whatsappCampaignAutomations.id })
      .from(whatsappCampaignAutomations)
      .where(and(
        eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
        eq(whatsappCampaignAutomations.sourceCampaignId, campaignId),
        isNull(whatsappCampaignAutomations.deletedAt),
      ))
      .limit(1);
    if (blueprintUse) {
      return {
        started: false,
        reason: "This draft is used as an automation blueprint and cannot be sent directly. Run it from Automations instead.",
      };
    }
    if (campaign.status === "completed") return { started: false, reason: "Already completed" };
    if (campaign.status === "cancelled") return { started: false, reason: "Campaign cancelled" };
    if (campaign.status === "sending" && !opts?.forceResume) {
      return { started: false, reason: "Already sending" };
    }

    const settings = await whatsappService.getSettings(businessAccountId);
    if (!settings?.msg91AuthKey || !settings?.msg91IntegratedNumberId) {
      return { started: false, reason: "MSG91 credentials not configured. Configure them in WhatsApp settings first." };
    }

    // Re-check prerequisites at dispatch time, not just at create time. Between drafting and
    // sending, a template can be withdrawn or an audience emptied, and a scheduled campaign may
    // sit for days before this runs.
    const missing = await checkCampaignPrerequisites(businessAccountId, {
      templateId: campaign.templateId,
      groupIds: (campaign.groupIds as string[]) || [],
    });
    if (missing) {
      await parkUnsendableCampaign(campaignId, businessAccountId, campaign.status, missing.message);
      return { started: false, reason: missing.message };
    }

    const [tpl] = await db
      .select()
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.id, campaign.templateId))
      .limit(1);
    if (!tpl) return { started: false, reason: "Template not found" };

    // Every recipient would be rejected by WhatsApp for the same reason, so stop the whole send
    // rather than burning the contact list one failure at a time.
    const paramError = validateTemplateParams(tpl, campaign.templateParams as string[]);
    if (paramError) {
      await parkUnsendableCampaign(campaignId, businessAccountId, campaign.status, paramError);
      return { started: false, reason: paramError };
    }

    const existing = await db
      .select({ id: marketingCampaignRecipients.id })
      .from(marketingCampaignRecipients)
      .where(eq(marketingCampaignRecipients.campaignId, campaignId))
      .limit(1);
    if (existing.length === 0) {
      const total = await this.snapshotRecipients(campaign);
      if (total === 0) return { started: false, reason: "No eligible recipients (after de-dup and opt-outs)" };
    } else if (opts?.forceResume) {
      // On recovery, release ALL rows stuck in 'claimed' for this campaign immediately
      // (cutoff=0). The previous worker is gone — the heartbeat said so — so any 'claimed'
      // row is by definition orphaned. Using the normal 5-min cutoff would let the new
      // worker exit early, then mark the campaign 'completed' with un-sent rows stranded.
      const released = await this.releaseStaleClaims(campaignId, 0);
      if (released > 0) console.log(`[Campaign] ${campaignId} recovery: released ${released} stale claims`);
    }

    const startableStatuses = opts?.forceResume
      ? ["draft", "scheduled", "failed", "sending"]
      : ["draft", "scheduled", "failed"];
    const claimedCampaign = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"wa-blueprint:" + campaignId}))`);
      const [stillBlueprint] = await tx.select({ id: whatsappCampaignAutomations.id })
        .from(whatsappCampaignAutomations)
        .where(and(
          eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
          eq(whatsappCampaignAutomations.sourceCampaignId, campaignId),
          isNull(whatsappCampaignAutomations.deletedAt),
        ))
        .limit(1);
      if (stillBlueprint) return null;
      const [claimed] = await tx
        .update(marketingCampaigns)
        .set({
          status: "sending",
          startedAt: campaign.startedAt || new Date(),
          heartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(marketingCampaigns.id, campaignId),
          eq(marketingCampaigns.businessAccountId, businessAccountId),
          inArray(marketingCampaigns.status, startableStatuses),
        ))
        .returning({ id: marketingCampaigns.id });
      return claimed || null;
    });
    if (!claimedCampaign) {
      const latest = await this.get(businessAccountId, campaignId);
      const [protectedBlueprint] = await db.select({ id: whatsappCampaignAutomations.id })
        .from(whatsappCampaignAutomations)
        .where(and(
          eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
          eq(whatsappCampaignAutomations.sourceCampaignId, campaignId),
          isNull(whatsappCampaignAutomations.deletedAt),
        ))
        .limit(1);
      return {
        started: false,
        reason: protectedBlueprint
          ? "This draft is used as an automation blueprint and cannot be sent directly. Run it from Automations instead."
          : latest?.status === "cancelled" ? "Campaign cancelled" : "Campaign state changed before sending could begin",
      };
    }

    inFlight.add(key);

    setImmediate(() => {
      this.runSendLoop(businessAccountId, campaignId, tpl, settings)
        .catch(err => console.error("[Campaign] runSendLoop error:", err))
        .finally(() => inFlight.delete(key));
    });

    return { started: true };
  },

  async runSendLoop(
    businessAccountId: string,
    campaignId: string,
    tpl: WhatsappTemplate,
    settings: any
  ): Promise<void> {
    // Acquire a per-campaign Postgres advisory lock so only one node ever sends.
    // CRITICAL: lock + unlock MUST happen on the same physical connection. With a pg Pool,
    // db.execute() can land on different connections, so we check out a dedicated client
    // and pin both pg_try_advisory_lock and pg_advisory_unlock to it. The send-loop's
    // ordinary queries continue to use the regular `db` (Drizzle on the pool).
    const lockKeyStr = `mkt_campaign:${campaignId}`;
    const lockKey = advisoryLockKey(lockKeyStr);
    const lockClient = await pool.connect();
    let acquired = false;
    try {
      const lockResult = await lockClient.query("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [lockKey.toString()]);
      acquired = lockResult.rows?.[0]?.acquired === true;
    } catch (err) {
      console.error(`[Campaign] ${campaignId} lock acquire error:`, err);
      lockClient.release();
      return;
    }
    if (!acquired) {
      console.log(`[Campaign] ${campaignId} lock not acquired — another worker is sending. Exiting.`);
      lockClient.release();
      return;
    }

    // Pre-load each source group's default country code once. Recipients carry
    // their originating groupId, so we can apply the right code per-row at
    // send time without hitting the DB inside the inner loop.
    const groupCodeMap = new Map<string, string | null>();
    try {
      const refreshedCampaign = await this.get(businessAccountId, campaignId);
      const groupIds = ((refreshedCampaign?.groupIds || []) as string[]).filter(Boolean);
      if (groupIds.length > 0) {
        const groups = await db
          .select({ id: contactGroups.id, code: contactGroups.defaultCountryCode })
          .from(contactGroups)
          .where(and(
            eq(contactGroups.businessAccountId, businessAccountId),
            inArray(contactGroups.id, groupIds),
          ));
        for (const g of groups) groupCodeMap.set(g.id, g.code ?? null);
      }
    } catch (err) {
      console.error(`[Campaign] ${campaignId} could not load group country codes:`, err);
    }

    // The contact fields this campaign's recipients actually carry. Used to tell an unresolved
    // personalization token apart from literal text that merely contains braces.
    const knownFields = new Set<string>(["name", "phone"]);
    try {
      const keyRows: any = await db.execute(sql`
        SELECT DISTINCT jsonb_object_keys(attributes) AS k
        FROM ${marketingCampaignRecipients}
        WHERE campaign_id = ${campaignId} AND jsonb_typeof(attributes) = 'object'
      `);
      for (const row of ((keyRows?.rows as any[]) ?? [])) {
        if (row?.k) knownFields.add(String(row.k).toLowerCase());
      }
    } catch (err) {
      console.error(`[Campaign] ${campaignId} could not load contact field names:`, err);
    }

    let sent = 0;
    let failed = 0;
    let lastHeartbeat = 0;
    try {
      while (true) {
        // Liveness check + cancellation
        const refreshed = await this.get(businessAccountId, campaignId);
        if (!refreshed || refreshed.status === "cancelled") {
          console.log(`[Campaign] ${campaignId} cancelled, stopping send loop`);
          return;
        }

        const batch = await this.claimNextBatch(campaignId, SEND_BATCH_SIZE);
        if (batch.length === 0) break;

        for (const r of batch) {
          // Heartbeat throttled
          const now = Date.now();
          if (now - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
            lastHeartbeat = now;
            await db.update(marketingCampaigns)
              .set({ heartbeatAt: new Date(), updatedAt: new Date() })
              .where(eq(marketingCampaigns.id, campaignId));
          }

          try {
            const optOuts = await contactGroupService.getOptOutSet(businessAccountId);
            if (optOuts.has(r.phone)) {
              await db.update(marketingCampaignRecipients)
                .set({ status: "opted_out", claimedAt: null })
                .where(eq(marketingCampaignRecipients.id, r.id));
              continue;
            }
            // Apply the group's default country code (if any). In Mixed mode
            // (no default code on the group) and a too-short phone, fail the
            // recipient up-front instead of letting MSG91 swallow a malformed
            // `to` field and silently drop the message.
            const groupCode = r.groupId ? groupCodeMap.get(r.groupId) ?? null : null;
            const normalized = applyCountryCode(r.phone, groupCode);
            if (!normalized.phone) {
              await db.update(marketingCampaignRecipients)
                .set({
                  status: "failed",
                  claimedAt: null,
                  errorMessage: normalized.error || "Invalid phone number",
                })
                .where(eq(marketingCampaignRecipients.id, r.id));
              failed++;
              await new Promise(res => setTimeout(res, SEND_DELAY_MS));
              continue;
            }
            const sendPhone = normalized.phone;
            // A parameter can still come out unusable for one particular contact even though the
            // campaign is configured correctly. Fail just that recipient, with a reason that says
            // what the contact is missing, instead of sending a broken message or letting the
            // provider answer with something nobody can act on.
            const { params, problems } = resolveParams(tpl, refreshed!, r, knownFields);
            if (problems.length > 0) {
              await db.update(marketingCampaignRecipients)
                .set({ status: "failed", claimedAt: null, errorMessage: problems.join("; ") })
                .where(eq(marketingCampaignRecipients.id, r.id));
              failed++;
              continue;
            }
            const result = await sendTemplateMessage(settings, sendPhone, tpl.name, params, {
              language: tpl.language,
              namespace: tpl.namespace,
            });
            if (result.success) {
              // Per industry-standard BSP integrations (Twilio, Infobip, Meta
              // Cloud API), a 2xx response from the provider only proves the
              // provider accepted the request — Meta has NOT yet confirmed.
              // Park the recipient in 'queued' and let applyDeliveryReceipt
              // promote it to 'sent' once Meta's async webhook lands.
              // sentAt stays null until that confirmation arrives.
              await db.update(marketingCampaignRecipients)
                .set({
                  status: "queued",
                  msg91MessageId: result.messageId || null,
                  providerResponse: result.raw ?? null,
                  sendPhone,
                  errorMessage: null,
                  claimedAt: null,
                })
                .where(eq(marketingCampaignRecipients.id, r.id));

              const renderedBody = (tpl.bodyText || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[String(n)] ?? `{{${n}}}`);
              await db.insert(marketingCampaignMessages).values({
                campaignId,
                recipientId: r.id,
                businessAccountId,
                direction: "outbound_template",
                body: renderedBody,
                metadata: { templateName: tpl.name, msg91MessageId: result.messageId || null, sendPhone, buttons: tpl.buttons ?? [] },
              });
              sent++;
            } else {
              await db.update(marketingCampaignRecipients)
                .set({
                  status: "failed",
                  claimedAt: null,
                  providerResponse: result.raw ?? null,
                  sendPhone,
                  errorMessage: typeof result.error === "string" ? result.error : JSON.stringify(result.error || {}).substring(0, 500),
                })
                .where(eq(marketingCampaignRecipients.id, r.id));
              failed++;
            }
          } catch (err: any) {
            await db.update(marketingCampaignRecipients)
              .set({
                status: "failed",
                claimedAt: null,
                errorMessage: (err?.message || String(err)).substring(0, 500),
              })
              .where(eq(marketingCampaignRecipients.id, r.id));
            failed++;
          }
          await new Promise(res => setTimeout(res, SEND_DELAY_MS));
        }

        await db
          .update(marketingCampaigns)
          .set({
            sentCount: sql`(SELECT COUNT(*)::int FROM ${marketingCampaignRecipients} WHERE campaign_id = ${campaignId} AND status IN ('sent','delivered','read','replied'))`,
            failedCount: sql`(SELECT COUNT(*)::int FROM ${marketingCampaignRecipients} WHERE campaign_id = ${campaignId} AND status IN ('failed','expired'))`,
            optedOutCount: sql`(SELECT COUNT(*)::int FROM ${marketingCampaignRecipients} WHERE campaign_id = ${campaignId} AND status = 'opted_out')`,
            heartbeatAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(marketingCampaigns.id, campaignId));
      }

      // Before declaring completion, double-check no rows are still pending/claimed.
      // This guards against the race where claimNextBatch returned 0 because of a transient
      // empty window (e.g. all rows claimed by a now-dead worker that wasn't yet swept).
      // If anything is left, leave the campaign in 'sending' state and let the scheduler
      // re-recover it on the next tick — never strand recipients in a 'completed' campaign.
      const [{ leftover }] = await db
        .select({ leftover: sql<number>`COUNT(*)::int` })
        .from(marketingCampaignRecipients)
        .where(and(
          eq(marketingCampaignRecipients.campaignId, campaignId),
          inArray(marketingCampaignRecipients.status, ["pending", "claimed"]),
        ));
      if ((leftover as number) > 0) {
        console.warn(`[Campaign] ${campaignId} loop ended with ${leftover} rows still pending/claimed — leaving status='sending' for scheduler recovery`);
        await db
          .update(marketingCampaigns)
          .set({ heartbeatAt: new Date(), updatedAt: new Date() })
          .where(eq(marketingCampaigns.id, campaignId));
      } else {
        await db
          .update(marketingCampaigns)
          .set({ status: "completed", completedAt: new Date(), heartbeatAt: new Date(), updatedAt: new Date() })
          .where(eq(marketingCampaigns.id, campaignId));
        console.log(`[Campaign] ${campaignId} complete — sent=${sent} failed=${failed}`);
      }
    } finally {
      try {
        await lockClient.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey.toString()]);
      } catch (err) {
        console.error(`[Campaign] ${campaignId} lock release error:`, err);
      } finally {
        lockClient.release();
      }
    }
  },

  async cancel(businessAccountId: string, campaignId: string): Promise<boolean> {
    const campaign = await this.get(businessAccountId, campaignId);
    if (campaign?.campaignType === "automation") {
      throw new Error("Automation campaign drafts are managed from Automations");
    }
    const [executionRun] = await db.select({ id: whatsappCampaignAutomationRuns.id })
      .from(whatsappCampaignAutomationRuns)
      .where(and(
        eq(whatsappCampaignAutomationRuns.businessAccountId, businessAccountId),
        eq(whatsappCampaignAutomationRuns.campaignId, campaignId),
      ))
      .limit(1);
    if (executionRun) throw new Error("Cancel this campaign from its automation run");
    const [blueprintUse] = await db.select({ id: whatsappCampaignAutomations.id })
      .from(whatsappCampaignAutomations)
      .where(and(
        eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
        eq(whatsappCampaignAutomations.sourceCampaignId, campaignId),
        isNull(whatsappCampaignAutomations.deletedAt),
      ))
      .limit(1);
    if (blueprintUse) throw new Error("This campaign is an automation blueprint and cannot be cancelled directly");
    const result = await db
      .update(marketingCampaigns)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.businessAccountId, businessAccountId)))
      .returning({ id: marketingCampaigns.id });
    return result.length > 0;
  },

  /**
   * Look up the most recent active campaign recipient for an inbound phone.
   * Active = the parent campaign is sending or completed within the last 14 days
   * AND the recipient has been sent the template.
   */
  async findActiveRecipientForInbound(businessAccountId: string, phone: string): Promise<{ campaign: MarketingCampaign; recipient: MarketingCampaignRecipient } | null> {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    // Inbound webhooks always carry the full international sender number
    // (e.g. "919810560800"), but the recipient row may have been stored as
    // a local 10-digit (the contact group entry) when the group has a
    // default country code applied at send time. Match against:
    //   - send_phone = the canonical international form we shipped to MSG91
    //   - phone      = exact match (mixed-mode groups already store intl)
    //   - phone      = the last-10 fallback for legacy / local-only rows
    const last10 = normalized.slice(-10);
    const recipients = await db
      .select()
      .from(marketingCampaignRecipients)
      .where(and(
        eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
        // 'queued' is included so that a fast inbound reply (which can land before
        // Meta's "sent" webhook) still attributes to the right recipient row.
        inArray(marketingCampaignRecipients.status, ["queued", "sent", "delivered", "read", "replied"]),
        sql`(${marketingCampaignRecipients.sendPhone} = ${normalized}
             OR ${marketingCampaignRecipients.phone} = ${normalized}
             OR ${marketingCampaignRecipients.phone} = ${last10})`,
      ))
      .orderBy(desc(marketingCampaignRecipients.createdAt))
      .limit(5);

    for (const r of recipients) {
      const [c] = await db
        .select()
        .from(marketingCampaigns)
        .where(eq(marketingCampaigns.id, r.campaignId))
        .limit(1);
      if (!c) continue;
      if (c.status === "cancelled" || c.status === "draft" || c.status === "scheduled") continue;
      const sentAt = r.sentAt ? new Date(r.sentAt).getTime() : 0;
      const ageMs = Date.now() - sentAt;
      const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
      if (sentAt && ageMs > FOURTEEN_DAYS) continue;
      return { campaign: c, recipient: r };
    }
    return null;
  },

  /**
   * Recompute persisted campaign aggregate counters (sent/failed/opted_out)
   * from the recipient table. Webhook-driven status updates land outside the
   * send-loop, so the only way to keep `marketingCampaigns.sentCount` /
   * `failedCount` honest after a campaign has finished sending is to refresh
   * them on every receipt-driven mutation.
   *
   * Cheap COUNT() against the campaign_status index — safe to call frequently.
   */
  async recomputeCampaignAggregates(campaignId: string): Promise<void> {
    await db
      .update(marketingCampaigns)
      .set({
        sentCount: sql`(SELECT COUNT(*)::int FROM ${marketingCampaignRecipients} WHERE campaign_id = ${campaignId} AND status IN ('sent','delivered','read','replied'))`,
        failedCount: sql`(SELECT COUNT(*)::int FROM ${marketingCampaignRecipients} WHERE campaign_id = ${campaignId} AND status IN ('failed','expired'))`,
        optedOutCount: sql`(SELECT COUNT(*)::int FROM ${marketingCampaignRecipients} WHERE campaign_id = ${campaignId} AND status = 'opted_out')`,
        repliedCount: sql`(SELECT COUNT(DISTINCT id)::int FROM ${marketingCampaignRecipients} WHERE campaign_id = ${campaignId} AND first_reply_at IS NOT NULL)`,
        updatedAt: new Date(),
      })
      .where(eq(marketingCampaigns.id, campaignId));
  },

  /**
   * Process a delivery / read / failed receipt from the provider, keyed by msg91MessageId.
   * Idempotent + atomic: we never downgrade a status (read > delivered > sent > queued)
   * and we always scope by businessAccountId. The recipient row is locked
   * SELECT FOR UPDATE inside a transaction so concurrent webhooks for the
   * same message can't race past each other.
   */
  async applyDeliveryReceipt(
    businessAccountId: string,
    msg91MessageId: string,
    kind: "sent" | "delivered" | "read" | "failed",
    errorMessage?: string,
  ): Promise<boolean> {
    if (!msg91MessageId) return false;
    const result = await db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(marketingCampaignRecipients)
      .where(and(
        eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
        eq(marketingCampaignRecipients.msg91MessageId, msg91MessageId),
      ))
      .for("update")
      .limit(1);
    if (!r) return { changed: false, campaignId: null as string | null };

    // Forward-progress ranking. 'queued' sits between 'claimed' and 'sent' —
    // provider accepted our POST but Meta has not yet confirmed. 'sent' means
    // Meta accepted via webhook. 'failed' / 'expired' sit at the same level as
    // 'sent' (post-attempt terminal-ish states), so a later 'delivered' / 'read'
    // — which proves the message actually arrived — can still promote past
    // them. 'opted_out' is a true sink ranked above all to prevent re-marketing.
    const STATUS_RANK: Record<string, number> = {
      pending: 0, claimed: 1, queued: 1.5, sent: 2, failed: 2, expired: 2,
      delivered: 3, read: 4, replied: 5, opted_out: 99,
    };
    const cur = STATUS_RANK[r.status] ?? 0;

    const updates: any = { };
    if (kind === "sent") {
      if (cur < STATUS_RANK.sent) {
        updates.status = "sent";
        if (r.status === "failed" || r.status === "expired") updates.errorMessage = null;
      }
      if (!r.sentAt) updates.sentAt = new Date();
    } else if (kind === "delivered") {
      if (cur < STATUS_RANK.delivered) {
        updates.status = "delivered";
        // Promoting past 'failed' / 'expired' — clear stale error context
        if (r.status === "failed" || r.status === "expired") updates.errorMessage = null;
      }
      // Delivery implies the prior 'sent' moment too — backfill if we never got the sent webhook.
      if (!r.sentAt) updates.sentAt = new Date();
      if (!r.deliveredAt) updates.deliveredAt = new Date();
    } else if (kind === "read") {
      if (cur < STATUS_RANK.read) {
        updates.status = "read";
        if (r.status === "failed" || r.status === "expired") updates.errorMessage = null;
      }
      if (!r.sentAt) updates.sentAt = new Date();
      if (!r.readAt) updates.readAt = new Date();
      if (!r.deliveredAt) updates.deliveredAt = new Date();
    } else if (kind === "failed") {
      // A 'failed' receipt must never downgrade a row that has already been
      // successfully delivered/read/replied or that the user opted out of.
      if (cur >= STATUS_RANK.delivered) {
        console.log(`[Campaign] Ignoring late 'failed' receipt for ${r.id} — already at status=${r.status}`);
        return { changed: false, campaignId: r.campaignId };
      }
      updates.status = "failed";
      if (errorMessage) updates.errorMessage = errorMessage.substring(0, 500);
    }
    if (Object.keys(updates).length === 0) return { changed: false, campaignId: r.campaignId };
    await tx.update(marketingCampaignRecipients)
      .set(updates)
      .where(eq(marketingCampaignRecipients.id, r.id));
      return { changed: true, campaignId: r.campaignId };
    });

    if (result.changed && result.campaignId) {
      // Refresh persisted campaign counters so the dashboard tiles
      // (sentCount/failedCount/repliedCount/optedOutCount) reflect this
      // webhook-driven transition. Done outside the recipient transaction to
      // keep that lock window tiny.
      try {
        await this.recomputeCampaignAggregates(result.campaignId);
      } catch (err) {
        console.error(`[Campaign] recomputeCampaignAggregates(${result.campaignId}) failed:`, err);
      }
    }
    return result.changed;
  },

  /**
   * Reconciliation sweep: any recipient stuck in 'queued' (provider accepted
   * but never sent a status webhook) for longer than the TTL is flipped to
   * 'expired'. WhatsApp template messages have a 24h provider-side delivery
   * window, so beyond that any pending status is, in practice, lost.
   * This is the safety net BSP customers run on every other platform — it
   * ensures the user-visible "Sent" / "Failed" counts reflect reality instead
   * of optimistically counting "MSG91 accepted our POST".
   */
  async expireStaleQueued(ttlMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - ttlMs);
    const result: any = await db.execute(sql`
      UPDATE ${marketingCampaignRecipients}
      SET status = 'expired',
          error_message = 'Provider did not confirm delivery within TTL'
      WHERE status = 'queued'
        AND created_at <= ${cutoff}
      RETURNING id, campaign_id;
    `);
    const rows: any[] = (result?.rows as any[]) ?? [];
    // Recompute aggregates for every campaign that had at least one row expired,
    // so the persisted failedCount on those campaigns includes the new 'expired' rows.
    const campaignIds = Array.from(new Set(rows.map((row: any) => row.campaign_id).filter(Boolean)));
    for (const cid of campaignIds) {
      try {
        await this.recomputeCampaignAggregates(cid);
      } catch (err) {
        console.error(`[Campaign] recomputeCampaignAggregates(${cid}) after expire failed:`, err);
      }
    }
    return rows.length;
  },

  async recordInbound(campaignId: string, recipientId: string, businessAccountId: string, body: string): Promise<void> {
    await db.insert(marketingCampaignMessages).values({
      campaignId,
      recipientId,
      businessAccountId,
      direction: "inbound",
      body,
    });
    const [r] = await db
      .select({ status: marketingCampaignRecipients.status, firstReplyAt: marketingCampaignRecipients.firstReplyAt })
      .from(marketingCampaignRecipients)
      .where(eq(marketingCampaignRecipients.id, recipientId))
      .limit(1);
    const updates: any = {
      replyCount: sql`${marketingCampaignRecipients.replyCount} + 1`,
    };
    if (!r?.firstReplyAt) updates.firstReplyAt = new Date();
    if (r?.status === "queued" || r?.status === "sent" || r?.status === "delivered" || r?.status === "read") updates.status = "replied";
    await db.update(marketingCampaignRecipients)
      .set(updates)
      .where(eq(marketingCampaignRecipients.id, recipientId));
    await db
      .update(marketingCampaigns)
      .set({
        repliedCount: sql`(SELECT COUNT(DISTINCT id)::int FROM ${marketingCampaignRecipients} WHERE campaign_id = ${campaignId} AND first_reply_at IS NOT NULL)`,
        updatedAt: new Date(),
      })
      .where(eq(marketingCampaigns.id, campaignId));

    // Fire-and-forget classification. Deliberately outside the AI-reply branch:
    // dispositions are an operational record of what the customer said, so they
    // must still be captured for campaigns that have AI replies switched off.
    void (async () => {
      try {
        const { campaignAiService } = await import("./campaignAiService");
        await campaignAiService.classifyAndStore(campaignId, recipientId, body);
      } catch (err) {
        console.error(`[Campaign] classification failed for recipient ${recipientId}:`, err);
      }
    })();
  },

  /**
   * Budget gate for the classification pass.
   *
   * Separate from checkAiBudget because that one refuses whenever AI *replies*
   * are disabled, and refuses again once a recipient hits their reply cap —
   * neither of which should stop us recording what a customer said. This checks
   * only the campaign's shared daily token budget.
   */
  async checkClassificationBudget(campaignId: string): Promise<{ allowed: boolean; reason?: string }> {
    const [campaign] = await db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.id, campaignId))
      .limit(1);
    if (!campaign) return { allowed: false, reason: "campaign_missing" };

    const today = todayBucket();
    if (campaign.aiUsageDate !== today) {
      await db.update(marketingCampaigns)
        .set({ aiUsageDate: today, aiTokensUsedToday: 0 })
        .where(eq(marketingCampaigns.id, campaignId));
      campaign.aiTokensUsedToday = 0;
    }
    if ((campaign.aiTokensUsedToday ?? 0) >= (campaign.aiDailyTokenBudget ?? 0)) {
      return { allowed: false, reason: "daily_token_budget_exhausted" };
    }
    return { allowed: true };
  },

  /**
   * Persist a classification result onto the recipient row.
   *
   * Merge semantics matter here because conversations are multi-turn:
   *  - A null classification ("ok thanks", an emoji) must NOT wipe the real
   *    disposition captured from an earlier message.
   *  - dispositionData merges rather than replaces, so a promised date captured
   *    two messages ago survives a later reclassification and stays auditable.
   *  - callbackRequired is sticky-true: nothing in this flow resolves a callback,
   *    so a later neutral message must not silently clear a pending human handoff.
   */
  async applyClassification(
    recipientId: string,
    result: {
      primaryClassification: string | null;
      dispositionData: Record<string, string>;
      callbackRequired: boolean;
      callbackReason: string | null;
      customerFeedback: string | null;
    },
  ): Promise<void> {
    // Done as ONE atomic statement rather than read-modify-write. Classification
    // is fired per inbound message, so a customer sending two messages in quick
    // succession runs two of these concurrently; a JS-side merge would let the
    // slower one overwrite the newer outcome or drop a sticky callback flag.
    // Expressing the merge in SQL means each update reads the freshest row.
    const newData = JSON.stringify(result.dispositionData || {});
    await db
      .update(marketingCampaignRecipients)
      .set({
        primaryClassification: sql`COALESCE(${result.primaryClassification}, ${marketingCampaignRecipients.primaryClassification})`,
        dispositionData: sql`COALESCE(${marketingCampaignRecipients.dispositionData}, '{}'::jsonb) || ${newData}::jsonb`,
        callbackRequired: sql`${marketingCampaignRecipients.callbackRequired} OR ${result.callbackRequired}`,
        callbackReason: result.callbackRequired
          ? (result.callbackReason as any)
          : sql`${marketingCampaignRecipients.callbackReason}`,
        customerFeedback: sql`COALESCE(${result.customerFeedback}, ${marketingCampaignRecipients.customerFeedback})`,
        classifiedAt: new Date(),
      })
      .where(eq(marketingCampaignRecipients.id, recipientId));
  },

  /**
   * Aggregate campaign outcomes for the dashboard and the CSV export.
   *
   * Rows are driven by the campaign's own classification config, so the shape of
   * this response follows the vertical the operator configured. Two details are
   * deliberate:
   *
   *  - Categories with zero hits are still returned. A collections manager needs
   *    to see "Refusal: 0", and dropping empty rows would make the dashboard
   *    silently change shape as data arrives.
   *  - Keys found in recipient data but no longer in the config (a category that
   *    was renamed or deleted after replies landed) are returned as `orphaned`
   *    rows rather than discarded, so the counts still reconcile against the
   *    reply total instead of quietly losing recipients.
   */
  async getOutcomeSummary(businessAccountId: string, campaignId: string) {
    const campaign = await this.get(businessAccountId, campaignId);
    if (!campaign) return null;

    const configured = (campaign.replyClassifications || []) as ReplyClassification[];

    const [totals] = await db
      .select({
        totalRecipients: sql<number>`COUNT(*)::int`,
        replied: sql<number>`COUNT(*) FILTER (WHERE first_reply_at IS NOT NULL)::int`,
        classified: sql<number>`COUNT(*) FILTER (WHERE primary_classification IS NOT NULL)::int`,
        unclassifiedReplies: sql<number>`COUNT(*) FILTER (WHERE first_reply_at IS NOT NULL AND primary_classification IS NULL)::int`,
        callbacksPending: sql<number>`COUNT(*) FILTER (WHERE callback_required = true)::int`,
      })
      .from(marketingCampaignRecipients)
      .where(and(
        eq(marketingCampaignRecipients.campaignId, campaignId),
        eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
      ));

    const grouped = await db
      .select({
        key: marketingCampaignRecipients.primaryClassification,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(marketingCampaignRecipients)
      .where(and(
        eq(marketingCampaignRecipients.campaignId, campaignId),
        eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
        sql`primary_classification IS NOT NULL`,
      ))
      .groupBy(marketingCampaignRecipients.primaryClassification);

    const counts = new Map(grouped.map(g => [g.key as string, g.count]));

    const rows = configured.map(c => ({
      key: c.key,
      label: c.label || c.key,
      count: counts.get(c.key) ?? 0,
      orphaned: false,
    }));
    const configuredKeys = new Set(configured.map(c => c.key));
    for (const [key, count] of Array.from(counts.entries())) {
      if (!configuredKeys.has(key)) {
        rows.push({ key, label: key, count, orphaned: true });
      }
    }

    return {
      campaignId,
      configured: configured.length > 0,
      totalRecipients: totals?.totalRecipients ?? 0,
      replied: totals?.replied ?? 0,
      classified: totals?.classified ?? 0,
      unclassifiedReplies: totals?.unclassifiedReplies ?? 0,
      callbacksPending: totals?.callbacksPending ?? 0,
      rows,
    };
  },

  /**
   * Stream every recipient with their outcome as CSV.
   *
   * Columns are the fixed identity/delivery set, then one column per capture
   * field declared anywhere in the campaign's config — so a collections export
   * carries ptp_date and a scheduling export carries preferred_date, without
   * either being hardcoded. Batched to keep a large campaign off the heap.
   */
  async *streamOutcomeCsv(businessAccountId: string, campaignId: string): AsyncGenerator<string> {
    const campaign = await this.get(businessAccountId, campaignId);
    if (!campaign) return;

    const configured = (campaign.replyClassifications || []) as ReplyClassification[];
    const labelByKey = new Map(configured.map(c => [c.key, c.label || c.key]));

    // Union of capture fields across all categories, de-duplicated but order-stable.
    const fieldKeys: string[] = [];
    for (const c of configured) {
      for (const f of c.captureFields || []) {
        if (!fieldKeys.includes(f.fieldKey)) fieldKeys.push(f.fieldKey);
      }
    }

    // Attribute columns come from imported data (loan_id, emi_amount, ...).
    // The full key union is resolved in the database rather than sampled from
    // the first page: audiences can be assembled from several sources or
    // topped up later, so a key that only appears on row 900 must still get a
    // column instead of having its values silently dropped from the export.
    const BATCH = 500;
    const keyRows = await db.execute(sql`
      SELECT DISTINCT k
      FROM ${marketingCampaignRecipients} r,
           LATERAL jsonb_object_keys(COALESCE(r.attributes, '{}'::jsonb)) AS k
      WHERE r.campaign_id = ${campaignId}
        AND r.business_account_id = ${businessAccountId}
      ORDER BY k
    `);
    const attrKeys: string[] = (keyRows.rows as { k: string }[]).map(r => r.k);

    const header = [
      "name", "phone", "status",
      ...attrKeys,
      "classification", "classification_label",
      ...fieldKeys,
      "callback_required", "callback_reason", "customer_feedback",
      "reply_count", "first_reply_at", "classified_at", "sent_at",
    ];
    yield header.map(csvCell).join(",") + "\n";

    const fetchBatch = (offset: number) =>
      db
        .select()
        .from(marketingCampaignRecipients)
        .where(and(
          eq(marketingCampaignRecipients.campaignId, campaignId),
          eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
        ))
        .orderBy(marketingCampaignRecipients.createdAt)
        .limit(BATCH)
        .offset(offset);

    let offset = 0;
    let batch = await fetchBatch(offset);
    while (batch.length > 0) {
      for (const r of batch) {
        const attrs = r.attributes || {};
        const disp = r.dispositionData || {};
        const key = r.primaryClassification || "";
        yield [
          r.name || "",
          r.phone,
          r.status,
          ...attrKeys.map(k => attrs[k] ?? ""),
          key,
          key ? (labelByKey.get(key) || key) : "",
          ...fieldKeys.map(k => disp[k] ?? ""),
          r.callbackRequired ? "yes" : "no",
          r.callbackReason || "",
          r.customerFeedback || "",
          String(r.replyCount ?? 0),
          r.firstReplyAt ? new Date(r.firstReplyAt).toISOString() : "",
          r.classifiedAt ? new Date(r.classifiedAt).toISOString() : "",
          r.sentAt ? new Date(r.sentAt).toISOString() : "",
        ].map(csvCell).join(",") + "\n";
      }
      if (batch.length < BATCH) break;
      offset += BATCH;
      batch = await fetchBatch(offset);
    }
  },

  async recordOutboundAi(campaignId: string, recipientId: string, businessAccountId: string, body: string, metadata?: Record<string, any>): Promise<void> {
    await db.insert(marketingCampaignMessages).values({
      campaignId,
      recipientId,
      businessAccountId,
      direction: "outbound_ai",
      body,
      metadata: metadata || {},
    });
    await db.update(marketingCampaignRecipients)
      .set({ aiReplyCount: sql`${marketingCampaignRecipients.aiReplyCount} + 1` })
      .where(eq(marketingCampaignRecipients.id, recipientId));
  },

  /**
   * AI guardrails — must be called BEFORE generating a reply.
   * Resets daily token bucket atomically when the day rolls over.
   */
  async checkAiBudget(campaignId: string, recipientId: string): Promise<{ allowed: boolean; reason?: string }> {
    const [campaign] = await db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.id, campaignId))
      .limit(1);
    if (!campaign) return { allowed: false, reason: "campaign_missing" };
    if (campaign.aiEnabled !== "true") return { allowed: false, reason: "ai_disabled" };

    // Daily reset
    const today = todayBucket();
    if (campaign.aiUsageDate !== today) {
      await db.update(marketingCampaigns)
        .set({ aiUsageDate: today, aiTokensUsedToday: 0 })
        .where(eq(marketingCampaigns.id, campaignId));
      campaign.aiTokensUsedToday = 0;
      campaign.aiUsageDate = today;
    }

    if ((campaign.aiTokensUsedToday ?? 0) >= (campaign.aiDailyTokenBudget ?? 0)) {
      return { allowed: false, reason: "daily_token_budget_exhausted" };
    }

    const [recipient] = await db
      .select({ aiReplyCount: marketingCampaignRecipients.aiReplyCount })
      .from(marketingCampaignRecipients)
      .where(eq(marketingCampaignRecipients.id, recipientId))
      .limit(1);
    if (!recipient) return { allowed: false, reason: "recipient_missing" };
    if ((recipient.aiReplyCount ?? 0) >= (campaign.aiMaxRepliesPerRecipient ?? 0)) {
      return { allowed: false, reason: "per_recipient_cap_reached" };
    }
    return { allowed: true };
  },

  async addAiTokensUsed(campaignId: string, tokens: number): Promise<void> {
    if (!tokens || tokens <= 0) return;
    await db.update(marketingCampaigns)
      .set({ aiTokensUsedToday: sql`${marketingCampaigns.aiTokensUsedToday} + ${Math.floor(tokens)}` })
      .where(eq(marketingCampaigns.id, campaignId));
  },

  /**
   * Operator-initiated retry for a single recipient row. Flips a 'failed' or
   * 'expired' row back to 'pending', clears prior error/UUID/timestamps so the
   * send loop sees it as a fresh attempt, then refreshes the campaign's
   * persisted aggregates so the dashboard tiles update immediately. Idempotent
   * — calling on a row in any other state is a no-op (returns 0).
   *
   * Tenant scoped: every WHERE clause includes businessAccountId so a request
   * can never resurrect a row outside the caller's tenant.
   */
  async requeueRecipient(businessAccountId: string, campaignId: string, recipientId: string): Promise<{ requeued: number }> {
    const result: any = await db.execute(sql`
      UPDATE ${marketingCampaignRecipients}
      SET status = 'pending',
          claimed_at = NULL,
          error_message = NULL,
          provider_response = NULL,
          msg91_message_id = NULL,
          sent_at = NULL,
          delivered_at = NULL,
          read_at = NULL
      WHERE id = ${recipientId}
        AND campaign_id = ${campaignId}
        AND business_account_id = ${businessAccountId}
        AND status IN ('failed', 'expired')
      RETURNING id;
    `);
    const rows: any[] = (result?.rows as any[]) ?? [];
    if (rows.length > 0) {
      await this.recomputeCampaignAggregates(campaignId);
      // Same completed→sending bump as requeueAllFailed. Without this, the
      // route's startSend(forceResume:true) call gets rejected by the
      // "Already completed" guard, and the freshly-pending row sits forever.
      const [c] = await db
        .select({ status: marketingCampaigns.status })
        .from(marketingCampaigns)
        .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.businessAccountId, businessAccountId)))
        .limit(1);
      if (c && (c.status === "completed" || c.status === "draft" || c.status === "scheduled")) {
        await db
          .update(marketingCampaigns)
          .set({ status: "sending", completedAt: null, heartbeatAt: new Date(), updatedAt: new Date() })
          .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.businessAccountId, businessAccountId)));
      }
    }
    return { requeued: rows.length };
  },

  /**
   * Bulk variant of requeueRecipient. Flips every 'failed' / 'expired' row in
   * a campaign back to 'pending', refreshes aggregates, and — if the campaign
   * had already settled to 'completed' — bumps it back to 'sending' and kicks
   * the send loop with forceResume so the freshly-pending rows actually go
   * out instead of sitting forever.
   */
  async requeueAllFailed(businessAccountId: string, campaignId: string): Promise<{ requeued: number }> {
    const result: any = await db.execute(sql`
      UPDATE ${marketingCampaignRecipients}
      SET status = 'pending',
          claimed_at = NULL,
          error_message = NULL,
          provider_response = NULL,
          msg91_message_id = NULL,
          sent_at = NULL,
          delivered_at = NULL,
          read_at = NULL
      WHERE campaign_id = ${campaignId}
        AND business_account_id = ${businessAccountId}
        AND status IN ('failed', 'expired')
      RETURNING id;
    `);
    const rows: any[] = (result?.rows as any[]) ?? [];
    if (rows.length === 0) return { requeued: 0 };

    await this.recomputeCampaignAggregates(campaignId);

    // Wake the campaign up if it had already declared completion. Status flip
    // happens BEFORE startSend so the in-flight guard inside startSend sees a
    // valid sending campaign rather than rejecting it as 'completed'.
    const [c] = await db
      .select({ status: marketingCampaigns.status })
      .from(marketingCampaigns)
      .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.businessAccountId, businessAccountId)))
      .limit(1);
    if (c && (c.status === "completed" || c.status === "draft" || c.status === "scheduled")) {
      await db
        .update(marketingCampaigns)
        .set({ status: "sending", completedAt: null, heartbeatAt: new Date(), updatedAt: new Date() })
        .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.businessAccountId, businessAccountId)));
    }
    // Don't await — startSend runs the send loop in the background and would
    // otherwise hold the HTTP response open until the entire batch finishes.
    this.startSend(businessAccountId, campaignId, { forceResume: true }).catch(err => {
      console.error(`[Campaign] requeueAllFailed → startSend(${campaignId}) error:`, err);
    });
    return { requeued: rows.length };
  },

  /**
   * Pull-API reconciler. For every non-terminal recipient with a stored
   * msg91MessageId, fetch the current status from MSG91 and apply it via
   * applyDeliveryReceipt. This is the safety net for missed/lost webhooks
   * — it scales to thousands of recipients in a single user click because
   * each row is one cheap GET against MSG91 and we batch with bounded
   * concurrency. Idempotent + safe to run repeatedly.
   */
  async reconcileCampaign(businessAccountId: string, campaignId: string): Promise<{ checked: number; updated: number }> {
    const settings = await whatsappService.getSettings(businessAccountId);
    if (!settings?.msg91AuthKey) {
      console.warn(`[Campaign] reconcileCampaign(${campaignId}) — no MSG91 auth key, skipping`);
      return { checked: 0, updated: 0 };
    }
    const rows = await db
      .select({
        id: marketingCampaignRecipients.id,
        msgId: marketingCampaignRecipients.msg91MessageId,
        createdAt: marketingCampaignRecipients.createdAt,
      })
      .from(marketingCampaignRecipients)
      .where(and(
        eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
        eq(marketingCampaignRecipients.campaignId, campaignId),
        inArray(marketingCampaignRecipients.status, ["queued", "sent"]),
        sql`${marketingCampaignRecipients.msg91MessageId} IS NOT NULL`,
      ));
    if (rows.length === 0) return { checked: 0, updated: 0 };

    // Build the date window we need to query MSG91 for. MSG91 caps each
    // /report/logs/wa call at a 3-day window, so chunk if necessary.
    const wanted = new Map<string, string>(); // msg91MessageId → recipient id
    let earliest = new Date();
    for (const r of rows) {
      if (!r.msgId) continue;
      wanted.set(r.msgId, r.id);
      if (r.createdAt && r.createdAt < earliest) earliest = r.createdAt;
    }
    // Pad the window by 1 day on each side so messages that straddle the
    // UTC↔IST midnight boundary are still found regardless of which
    // calendar day MSG91 filed them under.
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const today = new Date(Date.now() + ONE_DAY);
    earliest = new Date(earliest.getTime() - ONE_DAY);
    // Cap how far back we look — older campaigns past MSG91's retention
    // are not retrievable anyway.
    const MAX_LOOKBACK_DAYS = 30;
    const lookbackCap = new Date(Date.now() - MAX_LOOKBACK_DAYS * ONE_DAY);
    if (earliest < lookbackCap) earliest = lookbackCap;

    const allReports: Msg91ReportRow[] = [];
    let cursor = new Date(earliest);
    while (cursor <= today) {
      const windowEnd = new Date(Math.min(cursor.getTime() + 2 * 24 * 60 * 60 * 1000, today.getTime()));
      const chunk = await fetchMsg91Reports(settings.msg91AuthKey!, cursor, windowEnd);
      console.log(`[Campaign] reconcileCampaign(${campaignId}) MSG91 ${ymd(cursor)}..${ymd(windowEnd)} → ${chunk.length} rows`);
      allReports.push(...chunk);
      cursor = new Date(windowEnd.getTime() + 24 * 60 * 60 * 1000);
    }

    let updated = 0;
    for (const report of allReports) {
      if (!wanted.has(report.requestId)) continue;
      const kind = mapMsg91StatusToKind(report.status);
      if (!kind) continue;
      const errMsg = kind === "failed"
        ? (report.failureReason || (report.metaErrorCode ? `Meta error ${report.metaErrorCode}` : undefined))
        : undefined;
      try {
        const ok = await this.applyDeliveryReceipt(businessAccountId, report.requestId, kind, errMsg ?? undefined);
        if (ok) updated++;
      } catch (err) {
        console.error(`[Campaign] applyDeliveryReceipt(${report.requestId}) error:`, err);
      }
    }
    console.log(`[Campaign] reconcileCampaign(${campaignId}) — wanted=${wanted.size}, fetched=${allReports.length}, updated=${updated}`);
    return { checked: rows.length, updated };
  },

  /**
   * Background sweep: find campaigns that have non-terminal recipient rows
   * older than `staleMs` and reconcile each via the MSG91 pull-API. This
   * is the scaled equivalent of the per-row "refresh status" button —
   * fully automatic, runs on a schedule, self-heals lost webhooks.
   */
  async reconcileAllStale(staleMs: number = 5 * 60 * 1000): Promise<{ campaigns: number; updated: number }> {
    const cutoff = new Date(Date.now() - staleMs);
    const result: any = await db.execute(sql`
      SELECT DISTINCT business_account_id AS biz, campaign_id AS cid
      FROM ${marketingCampaignRecipients}
      WHERE status IN ('queued', 'sent')
        AND msg91_message_id IS NOT NULL
        AND created_at <= ${cutoff}
      LIMIT 50;
    `);
    const stale: Array<{ biz: string; cid: string }> = (result?.rows as any[]) ?? [];
    let totalUpdated = 0;
    for (const row of stale) {
      try {
        const r = await this.reconcileCampaign(row.biz, row.cid);
        totalUpdated += r.updated;
      } catch (err) {
        console.error(`[CampaignScheduler] reconcileCampaign(${row.cid}) error:`, err);
      }
    }
    return { campaigns: stale.length, updated: totalUpdated };
  },

  async runScheduler(): Promise<void> {
    const now = new Date();

    // 0. Release any recipient claims older than the stale cutoff (cross-campaign sweep).
    try {
      const released = await this.releaseStaleClaims();
      if (released > 0) console.log(`[CampaignScheduler] Released ${released} stale recipient claims`);
    } catch (err) {
      console.error("[CampaignScheduler] releaseStaleClaims error:", err);
    }

    // 0a. Expire 'queued' rows older than the WhatsApp 24h delivery window.
    // Without this, a row whose provider/Meta webhook never arrives would sit
    // in 'queued' forever and silently inflate the campaign's progress UI.
    try {
      const expired = await this.expireStaleQueued();
      if (expired > 0) console.log(`[CampaignScheduler] Expired ${expired} queued recipients past the 24h provider TTL`);
    } catch (err) {
      console.error("[CampaignScheduler] expireStaleQueued error:", err);
    }

    // 1. Auto-launch scheduled campaigns whose scheduledAt has passed
    const due = await db
      .select()
      .from(marketingCampaigns)
      .where(and(
        eq(marketingCampaigns.status, "scheduled"),
        sql`${marketingCampaigns.scheduledAt} <= ${now}`,
      ))
      .limit(20);
    for (const c of due) {
      console.log(`[CampaignScheduler] Auto-launching campaign ${c.id} (scheduled at ${c.scheduledAt})`);
      try {
        await this.startSend(c.businessAccountId, c.id, { automationExecution: true });
      } catch (err) {
        console.error(`[CampaignScheduler] Failed to launch ${c.id}:`, err);
      }
    }

    // 2. Recover stuck "sending" campaigns whose heartbeat is stale (server restart / pod crash)
    const heartbeatCutoff = new Date(Date.now() - STALE_CAMPAIGN_HEARTBEAT_MS);
    const stuck = await db
      .select()
      .from(marketingCampaigns)
      .where(and(
        eq(marketingCampaigns.status, "sending"),
        sql`(${marketingCampaigns.heartbeatAt} IS NULL OR ${marketingCampaigns.heartbeatAt} <= ${heartbeatCutoff})`,
      ))
      .limit(20);
    for (const c of stuck) {
      const key = `${c.businessAccountId}:${c.id}`;
      if (inFlight.has(key)) continue;
      console.log(`[CampaignScheduler] Recovering stuck sending campaign ${c.id} (heartbeatAt=${c.heartbeatAt})`);
      try {
        await this.startSend(c.businessAccountId, c.id, { forceResume: true, automationExecution: true });
      } catch (err) {
        console.error(`[CampaignScheduler] Failed to recover ${c.id}:`, err);
      }
    }
  },
};

export async function recordOptOut(businessAccountId: string, phone: string, reason: string = "user_stop", campaignId?: string | null): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!normalized) return;
  // Store the canonical international form in whatsapp_optouts (that's what
  // inbound webhooks always carry). The recipient-row update has to match
  // BOTH the international form and the local 10-digit form so a STOP from
  // a country-coded sender flips a recipient row that was stored as local.
  const last10 = normalized.slice(-10);
  const existing = await db
    .select()
    .from(whatsappOptOuts)
    .where(and(eq(whatsappOptOuts.businessAccountId, businessAccountId), eq(whatsappOptOuts.phone, normalized)))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(whatsappOptOuts).values({
      businessAccountId,
      phone: normalized,
      reason,
      campaignId: campaignId || null,
    });
  }
  await db
    .update(marketingCampaignRecipients)
    .set({ status: "opted_out" })
    .where(and(
      eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
      inArray(marketingCampaignRecipients.status, ["pending", "claimed", "queued", "sent", "delivered", "read", "replied"]),
      sql`(${marketingCampaignRecipients.sendPhone} = ${normalized}
           OR ${marketingCampaignRecipients.phone} = ${normalized}
           OR ${marketingCampaignRecipients.phone} = ${last10})`,
    ));
}

let schedulerStarted = false;
export function startCampaignScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const interval = 60 * 1000;
  setInterval(() => {
    marketingCampaignService.runScheduler().catch(err => console.error("[CampaignScheduler] tick error:", err));
  }, interval);
  console.log("[CampaignScheduler] Started (60s interval)");

  // Pull-API reconciler — runs every 3 minutes and reconciles any campaign
  // with non-terminal rows older than 5 minutes against MSG91's status API.
  // This is the safety net for lost / mis-routed delivery webhooks. Without
  // it, rows can sit in 'queued' for up to 24h before the TTL sweep flips
  // them to 'expired'.
  const reconcileInterval = 3 * 60 * 1000;
  setInterval(() => {
    marketingCampaignService.reconcileAllStale().catch(err => console.error("[CampaignScheduler] reconcile tick error:", err));
  }, reconcileInterval);
  console.log("[CampaignScheduler] Pull-API reconciler started (3 min interval)");
}
