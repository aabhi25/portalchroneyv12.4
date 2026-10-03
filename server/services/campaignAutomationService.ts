import os from "os";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { trackTimer } from "../lib/lifecycle";
import { reportError } from "../lib/errorReporter";
import {
  type AiWorkbookSheet,
  businessAccounts,
  whatsappCampaignAutomationScheduleAttempts,
  contactGroupContacts,
  contactGroups,
  marketingCampaigns,
  whatsappCampaignAutomationDispatches,
  whatsappCampaignAutomationRuns,
  whatsappCampaignAutomations,
  whatsappAiWorkbookVersions,
  whatsappAiWorkbooks,
  whatsappTemplates,
  type MarketingCampaign,
  type WhatsappCampaignAutomation,
  type WhatsappTemplate,
} from "@shared/schema";
import {
  MAX_IMPORT_ROWS,
  MIN_PHONE_DIGITS,
  normalizeColumnKeys,
  normalizePhone,
  type ImportColumn,
  type SourceRecord,
} from "@shared/contactImport";
import { parseSpreadsheetDate } from "@shared/spreadsheetDate";

type AutomationInput = {
  name: string;
  sourceType?: "upload" | "ai_workbook" | "campaign_blueprint";
  sourceCampaignId?: string | null;
  sourceWorkbookId?: string | null;
  sourceWorkbookSheetId?: string | null;
  sourceGroupIds?: string[];
  templateId: string;
  templateParams?: string[];
  phoneColumn: string;
  nameColumn?: string;
  recordKeyColumn: string;
  dateColumn: string;
  dateOffsetDays?: number;
  statusColumn?: string;
  eligibleStatuses?: string[];
  defaultCountryCode?: string;
  sendMode?: "review" | "automatic";
  sendTime?: string;
  timezone?: string;
  enabled?: boolean;
  scheduleEnabled?: boolean;
  scheduleDays?: number[];
};

/** Weekday numbers (0 = Sunday … 6 = Saturday), unique and sorted; [] means every day. */
export function normalizeScheduleDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const days = Array.from(new Set(
    value.map(day => Number(day)).filter(day => Number.isInteger(day) && day >= 0 && day <= 6),
  )).sort((a, b) => a - b);
  return days.length === 7 ? [] : days;
}

export const SCHEDULE_NEEDS_SAVED_SOURCE =
  "Automatic daily runs need a saved audience (an AI Workbook or Audiences). An automation that uses an uploaded file has to be run by hand.";

type SpreadsheetPayload = {
  columns: ImportColumn[];
  rows: SourceRecord[];
};

type AutomationCandidate = {
  rowNumber: number;
  recordKey: string;
  phone: string;
  name: string;
  attributes: Record<string, string>;
};

const MAX_OFFSET_DAYS = 366;
const ALLOWED_SEND_MODES = new Set(["review", "automatic"]);
const ALLOWED_SOURCE_TYPES = new Set(["upload", "ai_workbook", "campaign_blueprint"]);

function canonical(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function configuredColumns(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map(part => canonical(part))
    .filter(Boolean);
}

function cleanConfig(input: any): AutomationInput {
  const name = String(input?.name || "").trim();
  if (!name) throw new Error("Automation name is required");
  if (!input?.templateId) throw new Error("Choose an approved WhatsApp template");
  const sourceType = input.sourceType || "upload";
  if (!ALLOWED_SOURCE_TYPES.has(sourceType)) throw new Error("Invalid automation source");
  const sourceCampaignId = sourceType === "campaign_blueprint" ? String(input.sourceCampaignId || "").trim() : null;
  if (sourceType === "campaign_blueprint" && !sourceCampaignId) throw new Error("Choose a draft campaign blueprint");
  const sourceGroupIds = sourceType === "campaign_blueprint" && Array.isArray(input.sourceGroupIds)
    ? Array.from(new Set(input.sourceGroupIds.map((value: unknown) => String(value || "").trim()).filter(Boolean)))
    : [];
  const sourceWorkbookId = sourceType !== "upload" && sourceGroupIds.length === 0
    ? String(input.sourceWorkbookId || "").trim()
    : null;
  if (sourceType === "ai_workbook" && !sourceWorkbookId) throw new Error("Choose an AI Workbook");
  if (sourceType === "campaign_blueprint" && !sourceWorkbookId && sourceGroupIds.length === 0) {
    throw new Error("Choose an AI Workbook or at least one contact group");
  }

  const mapped = ["phoneColumn", "recordKeyColumn", "dateColumn"];
  for (const field of mapped) {
    if (!canonical((input as any)[field])) throw new Error(`${field.replace("Column", " column")} is required`);
  }

  const offset = Number(input.dateOffsetDays ?? 0);
  if (!Number.isInteger(offset) || Math.abs(offset) > MAX_OFFSET_DAYS) {
    throw new Error(`Date offset must be a whole number between -${MAX_OFFSET_DAYS} and ${MAX_OFFSET_DAYS}`);
  }

  const sendMode = input.sendMode || "review";
  if (!ALLOWED_SEND_MODES.has(sendMode)) throw new Error("Invalid send mode");

  const sendTime = String(input.sendTime || "10:00").trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(sendTime)) {
    throw new Error("Send time must use 24-hour HH:mm format");
  }

  const timezone = String(input.timezone || "Asia/Kolkata").trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error("Choose a valid timezone");
  }

  const countryCode = String(input.defaultCountryCode || "91").replace(/\D/g, "");
  if (!countryCode) throw new Error("Default country code is required");

  const params = Array.isArray(input.templateParams)
    ? input.templateParams.map((value: unknown) => String(value || "").trim())
    : [];
  const eligibleStatuses = Array.isArray(input.eligibleStatuses)
    ? input.eligibleStatuses.map((value: unknown) => String(value || "").trim()).filter(Boolean)
    : [];

  const scheduleEnabled = input.scheduleEnabled === true;
  if (scheduleEnabled && sourceType === "upload") throw new Error(SCHEDULE_NEEDS_SAVED_SOURCE);
  const scheduleDays = normalizeScheduleDays(input.scheduleDays);

  return {
    ...input,
    name,
    sourceType,
    sourceCampaignId,
    sourceWorkbookId,
    sourceWorkbookSheetId: sourceWorkbookId
      ? String(input.sourceWorkbookSheetId || "").trim() || null
      : null,
    sourceGroupIds,
    templateParams: params,
    phoneColumn: canonical(input.phoneColumn),
    nameColumn: canonical(input.nameColumn),
    recordKeyColumn: canonical(input.recordKeyColumn),
    dateColumn: canonical(input.dateColumn),
    dateOffsetDays: offset,
    statusColumn: canonical(input.statusColumn),
    eligibleStatuses,
    defaultCountryCode: countryCode,
    sendMode: sendMode as "review" | "automatic",
    sendTime,
    timezone,
    enabled: input.enabled !== false,
    scheduleEnabled,
    scheduleDays,
  } as AutomationInput;
}

type ResolvedWorkbookSource = {
  payload: SpreadsheetPayload;
  workbookId: string;
  workbookName: string;
  versionId: string;
  versionNumber: number;
  revision: number;
  sheetId: string;
  sheetName: string;
};

type BlueprintContext = {
  campaign: MarketingCampaign;
};

/**
 * New blueprints own the audience source and delivery identity. Scheduling,
 * eligibility, and deduplication mappings belong to the automation itself.
 * NULL recipientSourceType denotes a legacy blueprint and deliberately keeps
 * its previous workbook/group behavior.
 */
function applyCampaignOwnedSource<T extends AutomationInput | WhatsappCampaignAutomation>(
  config: T,
  campaign: MarketingCampaign,
): T & AutomationInput {
  if (!["ai_workbook", "contact_groups"].includes(campaign.recipientSourceType || "")) {
    return config as T & AutomationInput;
  }
  const usesWorkbook = campaign.recipientSourceType === "ai_workbook";
  return {
    ...config,
    sourceType: "campaign_blueprint",
    sourceCampaignId: campaign.id,
    sourceWorkbookId: usesWorkbook ? campaign.recipientWorkbookId : null,
    sourceWorkbookSheetId: usesWorkbook ? campaign.recipientWorkbookSheetId : null,
    sourceGroupIds: usesWorkbook ? [] : (campaign.groupIds || []),
    phoneColumn: campaign.recipientPhoneColumn || "",
    templateId: campaign.templateId,
    templateParams: (campaign.templateParams || []) as string[],
  } as T & AutomationInput;
}

type ResolvedGroupSource = {
  payload: SpreadsheetPayload;
  groupIds: string[];
  groupNames: string[];
};

async function resolveWorkbookSource(
  businessAccountId: string,
  config: Pick<AutomationInput, "sourceWorkbookId" | "sourceWorkbookSheetId">,
): Promise<ResolvedWorkbookSource> {
  if (!config.sourceWorkbookId) throw new Error("This automation is not linked to an AI Workbook");
  const [workbook] = await db.select().from(whatsappAiWorkbooks)
    .where(and(
      eq(whatsappAiWorkbooks.id, config.sourceWorkbookId),
      eq(whatsappAiWorkbooks.businessAccountId, businessAccountId),
      eq(whatsappAiWorkbooks.status, "active"),
    ))
    .limit(1);
  if (!workbook) throw new Error("The linked AI Workbook is no longer available");

  const [version] = await db.select().from(whatsappAiWorkbookVersions)
    .where(and(
      eq(whatsappAiWorkbookVersions.workbookId, workbook.id),
      eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
    ))
    .orderBy(desc(whatsappAiWorkbookVersions.versionNumber))
    .limit(1);
  if (!version) throw new Error("The linked AI Workbook has no saved version");

  const sheets = Array.isArray(version.sheets) ? version.sheets as AiWorkbookSheet[] : [];
  const sheet = config.sourceWorkbookSheetId
    ? sheets.find(candidate => candidate.id === config.sourceWorkbookSheetId)
    : sheets[0];
  if (!sheet) throw new Error("The linked AI Workbook sheet is no longer available");
  if (!sheet.columns.length) throw new Error("The linked AI Workbook has no columns");

  return {
    payload: {
      columns: sheet.columns.map(column => ({ key: column.key, label: column.label })),
      rows: sheet.rows.map((row, index) => ({
        r: index + 2,
        v: sheet.columns.map(column => {
          const value = row.values[column.key];
          return value === null || value === undefined ? "" : String(value);
        }),
      })),
    },
    workbookId: workbook.id,
    workbookName: workbook.name,
    versionId: version.id,
    versionNumber: version.versionNumber,
    revision: version.revision,
    sheetId: sheet.id,
    sheetName: sheet.name,
  };
}

async function resolveBlueprintContext(
  businessAccountId: string,
  sourceCampaignId: string | null | undefined,
): Promise<BlueprintContext> {
  if (!sourceCampaignId) throw new Error("Choose a draft campaign blueprint");
  const [campaign] = await db.select().from(marketingCampaigns)
    .where(and(
      eq(marketingCampaigns.id, sourceCampaignId),
      eq(marketingCampaigns.businessAccountId, businessAccountId),
    ))
    .limit(1);
  if (!campaign) throw new Error("The selected campaign blueprint is no longer available");
  if (campaign.status !== "draft" || campaign.startedAt) {
    throw new Error("Only an unsent draft campaign can be used as an automation blueprint");
  }

  return { campaign };
}

async function resolveGroupSource(
  businessAccountId: string,
  sourceGroupIds: string[] | null | undefined,
): Promise<ResolvedGroupSource> {
  const groupIds = Array.from(new Set((sourceGroupIds || []).filter(Boolean)));
  if (!groupIds.length) throw new Error("Choose at least one contact group");
  const groups = await db.select().from(contactGroups)
    .where(and(
      eq(contactGroups.businessAccountId, businessAccountId),
      inArray(contactGroups.id, groupIds),
    ));
  if (groups.length !== groupIds.length) throw new Error("One or more selected contact groups are no longer available");
  if (groups.some(group => group.contactCount <= 0)) throw new Error("Selected contact groups must contain contacts");

  const contacts = await db.select({
    groupId: contactGroupContacts.groupId,
    phone: contactGroupContacts.phone,
    name: contactGroupContacts.name,
    attributes: contactGroupContacts.attributes,
  }).from(contactGroupContacts)
    .where(and(
      eq(contactGroupContacts.businessAccountId, businessAccountId),
      inArray(contactGroupContacts.groupId, groupIds),
    ));
  if (!contacts.length) throw new Error("The selected contact groups contain no contacts");

  const attributeKeys = Array.from(new Set(
    contacts.flatMap(contact => Object.keys((contact.attributes || {}) as Record<string, string>)),
  )).sort();
  const columns: ImportColumn[] = [
    { key: "phone", label: "Phone" },
    { key: "name", label: "Name" },
    ...attributeKeys.map(key => ({ key, label: key })),
  ];
  return {
    groupIds,
    groupNames: groupIds.map(id => groups.find(group => group.id === id)?.name || id),
    payload: {
      columns,
      rows: contacts.map((contact, index) => ({
        r: index + 2,
        v: columns.map(column => {
          if (column.key === "phone") return contact.phone || "";
          if (column.key === "name") return contact.name || "";
          return String((contact.attributes as Record<string, string> | null)?.[column.key] || "");
        }),
      })),
    },
  };
}

async function prepareAutomationInput(
  businessAccountId: string,
  input: AutomationInput,
): Promise<{ config: AutomationInput; blueprint: BlueprintContext | null }> {
  const sourceType = input.sourceType || "upload";
  const blueprint = sourceType === "campaign_blueprint"
    ? await resolveBlueprintContext(businessAccountId, input.sourceCampaignId)
    : null;
  let sourceWorkbookId = input.sourceWorkbookId;
  let sourceWorkbookSheetId = input.sourceWorkbookSheetId;
  const owned = blueprint ? applyCampaignOwnedSource(input, blueprint.campaign) : input;
  sourceWorkbookId = owned.sourceWorkbookId;
  sourceWorkbookSheetId = owned.sourceWorkbookSheetId;
  if (blueprint && !blueprint.campaign.recipientSourceType && !sourceWorkbookId && !(input.sourceGroupIds || []).length) {
    const linkedWorkbooks = await db.select({ id: whatsappAiWorkbooks.id }).from(whatsappAiWorkbooks)
      .where(and(
        eq(whatsappAiWorkbooks.businessAccountId, businessAccountId),
        eq(whatsappAiWorkbooks.sourceCampaignId, blueprint.campaign.id),
        eq(whatsappAiWorkbooks.status, "active"),
      ))
      .orderBy(desc(whatsappAiWorkbooks.updatedAt))
      .limit(2);
    if (linkedWorkbooks.length === 1) {
      const legacySource = await resolveWorkbookSource(businessAccountId, {
        sourceWorkbookId: linkedWorkbooks[0].id,
        sourceWorkbookSheetId: null,
      });
      sourceWorkbookId = legacySource.workbookId;
      sourceWorkbookSheetId = legacySource.sheetId;
    }
  }
  const prepared = blueprint
    ? {
        ...owned,
        sourceType: "campaign_blueprint" as const,
        sourceCampaignId: blueprint.campaign.id,
        sourceWorkbookId,
        sourceWorkbookSheetId,
        templateId: blueprint.campaign.templateId,
        templateParams: blueprint.campaign.templateParams || [],
      }
    : owned;
  return { config: cleanConfig(prepared), blueprint };
}

async function validateWorkbookConfig(businessAccountId: string, config: AutomationInput) {
  if (config.sourceType === "upload") return null;
  if (!config.sourceWorkbookId && config.sourceType === "campaign_blueprint") {
    const source = await resolveGroupSource(businessAccountId, config.sourceGroupIds);
    validateColumns(config, source.payload.columns);
    return null;
  }
  const source = await resolveWorkbookSource(businessAccountId, config);
  validateColumns(config, source.payload.columns);
  return source;
}

function validateColumns(config: AutomationInput, columns: ImportColumn[]) {
  const available = new Set(columns.map(column => column.key));
  for (const field of [config.phoneColumn, ...configuredColumns(config.recordKeyColumn), config.dateColumn]) {
    if (!available.has(field!)) throw new Error(`The uploaded file no longer has the "${field}" column`);
  }
  for (const field of [config.nameColumn, config.statusColumn]) {
    if (field && !available.has(field)) throw new Error(`The uploaded file no longer has the "${field}" column`);
  }
  for (const reference of (config.templateParams || []).flatMap(fieldReferences)) {
    if (reference === "phone") continue;
    if (reference === "name") {
      if (!config.nameColumn) throw new Error('Choose a name column because the campaign template uses "{{name}}"');
      continue;
    }
    if (!available.has(reference)) throw new Error(`The uploaded file no longer has the "${reference}" column`);
  }
}

function parseDateOnly(raw: string): string | null {
  return parseSpreadsheetDate(raw);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateInTimezone(timezone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (name: string) => parts.find(part => part.type === name)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Converts a date/time entered in an IANA timezone into a UTC Date. */
export function zonedDateTimeToUtc(isoDate: string, time: string, timezone: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desiredUtcMillis = Date.UTC(year, month - 1, day, hour, minute);
  let guess = new Date(desiredUtcMillis);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(guess);
  const get = (name: string) => Number(parts.find(part => part.type === name)?.value || 0);
  const renderedAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  guess = new Date(desiredUtcMillis - (renderedAsUtc - desiredUtcMillis));
  return guess;
}

function nextScheduledAt(config: Pick<AutomationInput, "timezone" | "sendTime"> | any): Date {
  const now = new Date();
  const scheduled = zonedDateTimeToUtc(dateInTimezone(config.timezone!), config.sendTime!, config.timezone!);
  // The upload is today's source of truth. If its configured send time has
  // already passed, queue it for the next scheduler pass rather than silently
  // deferring today's reminders to tomorrow.
  return scheduled.getTime() > now.getTime() + 30_000
    ? scheduled
    : new Date(now.getTime() + 60_000);
}

function fieldReferences(value: string): string[] {
  return Array.from(value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)).map(match => canonical(match[1]));
}

function assertTemplateMapping(template: WhatsappTemplate, templateParams: string[]) {
  if (templateParams.length !== template.paramCount) {
    throw new Error(`This template needs ${template.paramCount} parameter mapping${template.paramCount === 1 ? "" : "s"}`);
  }
  const blank = templateParams
    .map((value, index) => value.trim() ? null : index + 1)
    .filter((index): index is number => index !== null);
  if (blank.length) {
    throw new Error(`Template parameter${blank.length === 1 ? "" : "s"} ${blank.join(", ")} cannot be blank`);
  }
}

function rowObject(columns: ImportColumn[], row: SourceRecord): Record<string, string> {
  const values: Record<string, string> = {};
  columns.forEach((column, index) => { values[column.key] = String(row.v[index] ?? "").trim(); });
  return values;
}

type RunRecipientSnapshot = { recordKey?: string | null; phone?: string | null };

/**
 * The record keys a review-mode run reserves when it is approved.
 *
 * The key is computed exactly once, by evaluateUpload, from the raw
 * spreadsheet cells — the same value it checks against dispatch history — and
 * persisted on the run's sourceSnapshot. Approval reuses those stored keys
 * rather than rebuilding them from the generated contacts: those contacts no
 * longer carry the configured phone/name columns in their attributes and hold
 * a normalised phone, so a rebuilt key came out blank (approval refused) or
 * different from the one checked at upload (the same record reminded again).
 *
 * The snapshot must still describe the contact group the campaign will send
 * to; if that group was edited after review, approval is refused.
 */
export function dispatchKeysForReviewedRun(
  snapshotRecipients: RunRecipientSnapshot[] | null | undefined,
  contacts: { phone: string | null }[],
): string[] {
  if (!Array.isArray(snapshotRecipients) || snapshotRecipients.length === 0) {
    throw new Error("This run was created before record keys were saved with it. Upload the file again and review the new run.");
  }
  const keys = snapshotRecipients.map(recipient => String(recipient?.recordKey ?? "").trim());
  if (keys.some(key => !key)) {
    throw new Error("This run has a blank record key and cannot be scheduled");
  }
  const phonesOf = (rows: { phone?: string | null }[]) => rows.map(row => String(row?.phone ?? "")).sort();
  const snapshotPhones = phonesOf(snapshotRecipients);
  const contactPhones = phonesOf(contacts);
  if (
    snapshotPhones.length !== contactPhones.length
    || snapshotPhones.some((phone, index) => phone !== contactPhones[index])
  ) {
    throw new Error("The recipients of this run changed after it was reviewed. Upload the file again and review the new run.");
  }
  return keys;
}

function resolvePreviewParam(value: string, candidate: AutomationCandidate): string {
  return value
    .replace(/\{\{\s*name\s*\}\}/gi, candidate.name || "")
    .replace(/\{\{\s*phone\s*\}\}/gi, candidate.phone || "")
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, field) => candidate.attributes[canonical(field)] || "")
    .trim();
}

async function existingDispatchKeys(automationId: string, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const uniqueKeys = Array.from(new Set(keys));
  for (let i = 0; i < uniqueKeys.length; i += 500) {
    const rows = await db.select({ recordKey: whatsappCampaignAutomationDispatches.recordKey })
      .from(whatsappCampaignAutomationDispatches)
      .where(and(
        eq(whatsappCampaignAutomationDispatches.automationId, automationId),
        inArray(whatsappCampaignAutomationDispatches.recordKey, uniqueKeys.slice(i, i + 500)),
      ));
    rows.forEach(row => found.add(row.recordKey));
  }
  return found;
}

function sanitizeSpreadsheet(payload: any): SpreadsheetPayload {
  const rawRows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (rawRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`That file has ${rawRows.length.toLocaleString()} rows. The limit is ${MAX_IMPORT_ROWS.toLocaleString()} per import.`);
  }
  const rawColumns = Array.isArray(payload?.columns) ? payload.columns.slice(0, 200) : [];
  const { keys } = normalizeColumnKeys(rawColumns.map((column: any, index: number) =>
    String(column?.key ?? `column_${index + 1}`).slice(0, 120),
  ));
  const columns = keys.map((key, index) => ({
    key,
    label: String(rawColumns[index]?.label ?? key).slice(0, 200),
  }));
  if (!columns.length) throw new Error("No spreadsheet columns found");

  return {
    columns,
    rows: rawRows.map((row: any, index: number) => ({
      r: Number.isFinite(row?.r) ? Number(row.r) : index + 2,
      v: Array.isArray(row?.v)
        ? row.v.slice(0, columns.length).map((value: any) => value == null ? "" : String(value).slice(0, 2000))
        : [],
    })),
  };
}

async function evaluateUpload(
  automation: WhatsappCampaignAutomation,
  payload: any,
) {
  const sheet = sanitizeSpreadsheet(payload);
  const config = cleanConfig(automation);
  validateColumns(config, sheet.columns);

  const targetDate = addDays(dateInTimezone(config.timezone!), -(config.dateOffsetDays || 0));
  const wantedStatuses = new Set((config.eligibleStatuses || []).map(status => canonical(status)));
  const candidates: AutomationCandidate[] = [];
  const invalid: { rowNumber: number; reason: string }[] = [];
  let excludedRows = 0;
  const keysInFile = new Set<string>();

  for (const row of sheet.rows) {
    const values = rowObject(sheet.columns, row);
    const keyColumns = configuredColumns(config.recordKeyColumn);
    const keyValues = keyColumns.map(column => values[column]?.trim() || "");
    const recordKey = keyValues.join(" | ");
    const dueDate = parseDateOnly(values[config.dateColumn!] || "");
    const phone = normalizePhone(values[config.phoneColumn!] || "");
    const status = config.statusColumn ? canonical(values[config.statusColumn] || "") : "";

    if (keyValues.some(value => !value)) {
      invalid.push({ rowNumber: row.r, reason: `Missing ${config.recordKeyColumn}` });
      continue;
    }
    if (!dueDate) {
      invalid.push({ rowNumber: row.r, reason: `Invalid ${config.dateColumn}; use YYYY-MM-DD` });
      continue;
    }
    if (phone.length < MIN_PHONE_DIGITS) {
      invalid.push({ rowNumber: row.r, reason: `Invalid ${config.phoneColumn}` });
      continue;
    }
    if (keysInFile.has(recordKey)) {
      invalid.push({ rowNumber: row.r, reason: "Duplicate record key in this file" });
      continue;
    }
    keysInFile.add(recordKey);

    if (dueDate !== targetDate || (wantedStatuses.size > 0 && !wantedStatuses.has(status))) {
      excludedRows++;
      continue;
    }

    const name = config.nameColumn ? values[config.nameColumn] || "" : "";
    const attributes: Record<string, string> = {};
    for (const column of sheet.columns) {
      if (column.key !== config.phoneColumn && column.key !== config.nameColumn) {
        attributes[column.key] = values[column.key] || "";
      }
    }

    const missingTemplateField = (config.templateParams || [])
      .flatMap(fieldReferences)
      .find(field => field !== "name" && field !== "phone" && !attributes[field]?.trim());
    if (missingTemplateField || (config.templateParams || []).some(param => fieldReferences(param).includes("name") && !name.trim())) {
      invalid.push({ rowNumber: row.r, reason: `Missing template field ${missingTemplateField || "name"}` });
      continue;
    }

    candidates.push({ rowNumber: row.r, recordKey, phone, name, attributes });
  }

  const alreadySent = await existingDispatchKeys(automation.id, candidates.map(candidate => candidate.recordKey));
  const ready = candidates.filter(candidate => !alreadySent.has(candidate.recordKey));
  return {
    sheet,
    targetDate,
    candidates: ready,
    summary: {
      totalRows: sheet.rows.length,
      eligibleRows: ready.length,
      excludedRows,
      invalidRows: invalid.length,
      duplicateRows: candidates.length - ready.length,
    },
    invalid: invalid.slice(0, 50),
  };
}

export const campaignAutomationService = {
  async list(businessAccountId: string) {
    return db.select().from(whatsappCampaignAutomations)
      .where(and(
        eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
        isNull(whatsappCampaignAutomations.deletedAt),
      ))
      .orderBy(desc(whatsappCampaignAutomations.updatedAt));
  },

  async get(businessAccountId: string, id: string) {
    const [row] = await db.select().from(whatsappCampaignAutomations)
      .where(and(
        eq(whatsappCampaignAutomations.id, id),
        eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
        isNull(whatsappCampaignAutomations.deletedAt),
      ))
      .limit(1);
    return row;
  },

  async create(businessAccountId: string, input: AutomationInput) {
    let { config } = await prepareAutomationInput(businessAccountId, input);
    if (config.sourceType === "campaign_blueprint") {
      const blueprint = await resolveBlueprintContext(businessAccountId, config.sourceCampaignId);
      if (blueprint.campaign.campaignType !== "automation") {
        throw new Error("Choose an automation campaign. One-time campaigns cannot be used for new recurring automations");
      }
    }
    const [template] = await db.select().from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, config.templateId), eq(whatsappTemplates.businessAccountId, businessAccountId)))
      .limit(1);
    if (!template || template.deletedAt || template.status !== "approved") throw new Error("Choose an approved WhatsApp template");
    assertTemplateMapping(template, config.templateParams || []);
    const workbookSource = await validateWorkbookConfig(businessAccountId, config);
    if (workbookSource) config = { ...config, sourceWorkbookSheetId: workbookSource.sheetId };

    return db.transaction(async tx => {
      if (config.sourceCampaignId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"wa-blueprint:" + config.sourceCampaignId}))`);
        const [lockedCampaign] = await tx.select().from(marketingCampaigns)
          .where(and(
            eq(marketingCampaigns.id, config.sourceCampaignId),
            eq(marketingCampaigns.businessAccountId, businessAccountId),
          ))
          .for("update")
          .limit(1);
        if (!lockedCampaign || lockedCampaign.status !== "draft" || lockedCampaign.startedAt) {
          throw new Error("Only an unsent draft campaign can be used as an automation blueprint");
        }
        if (lockedCampaign.campaignType !== "automation") {
          throw new Error("Choose an automation campaign. One-time campaigns cannot be used for new recurring automations");
        }
      }
      if (config.sourceWorkbookId) {
        const [selectedWorkbook] = await tx.select({ id: whatsappAiWorkbooks.id }).from(whatsappAiWorkbooks)
          .where(and(
            eq(whatsappAiWorkbooks.id, config.sourceWorkbookId),
            eq(whatsappAiWorkbooks.businessAccountId, businessAccountId),
            eq(whatsappAiWorkbooks.status, "active"),
          ))
          .for("update")
          .limit(1);
        if (!selectedWorkbook) throw new Error("The selected AI Workbook changed before the automation was saved");
      }
      const [row] = await tx.insert(whatsappCampaignAutomations).values({
        businessAccountId,
        name: config.name,
        sourceType: config.sourceType,
        sourceCampaignId: config.sourceCampaignId,
        sourceWorkbookId: config.sourceWorkbookId,
        sourceWorkbookSheetId: config.sourceWorkbookSheetId,
        sourceGroupIds: config.sourceGroupIds || [],
        templateId: config.templateId,
        templateParams: config.templateParams,
        phoneColumn: config.phoneColumn,
        nameColumn: config.nameColumn || "",
        recordKeyColumn: config.recordKeyColumn,
        dateColumn: config.dateColumn,
        dateOffsetDays: config.dateOffsetDays,
        statusColumn: config.statusColumn || "",
        eligibleStatuses: config.eligibleStatuses || [],
        defaultCountryCode: config.defaultCountryCode,
        sendMode: config.sendMode,
        sendTime: config.sendTime,
        timezone: config.timezone,
        enabled: config.enabled,
        scheduleEnabled: config.scheduleEnabled === true,
        scheduleDays: normalizeScheduleDays(config.scheduleDays),
        scheduleActivatedAt: config.scheduleEnabled === true ? new Date() : null,
      }).returning();
      return row;
    });
  },

  async update(businessAccountId: string, id: string, input: AutomationInput) {
    const existing = await this.get(businessAccountId, id);
    if (!existing) return undefined;
    let { config } = await prepareAutomationInput(businessAccountId, { ...existing, ...input } as AutomationInput);
    const requiresAutomationCampaignType = config.sourceType === "campaign_blueprint"
      && (
        existing.sourceType !== "campaign_blueprint"
        || config.sourceCampaignId !== existing.sourceCampaignId
      );
    if (
      requiresAutomationCampaignType
    ) {
      const blueprint = await resolveBlueprintContext(businessAccountId, config.sourceCampaignId);
      if (blueprint.campaign.campaignType !== "automation") {
        throw new Error("Choose an automation campaign. One-time campaigns cannot be used for new recurring automations");
      }
    }
    const [template] = await db.select().from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, config.templateId), eq(whatsappTemplates.businessAccountId, businessAccountId)))
      .limit(1);
    if (!template || template.deletedAt || template.status !== "approved") throw new Error("Choose an approved WhatsApp template");
    assertTemplateMapping(template, config.templateParams || []);
    const workbookSource = await validateWorkbookConfig(businessAccountId, config);
    if (workbookSource) config = { ...config, sourceWorkbookSheetId: workbookSource.sheetId };
    return db.transaction(async tx => {
      if (config.sourceCampaignId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"wa-blueprint:" + config.sourceCampaignId}))`);
        const [lockedCampaign] = await tx.select().from(marketingCampaigns)
          .where(and(
            eq(marketingCampaigns.id, config.sourceCampaignId),
            eq(marketingCampaigns.businessAccountId, businessAccountId),
          ))
          .for("update")
          .limit(1);
        if (!lockedCampaign || lockedCampaign.status !== "draft" || lockedCampaign.startedAt) {
          throw new Error("Only an unsent draft campaign can be used as an automation blueprint");
        }
        if (requiresAutomationCampaignType && lockedCampaign.campaignType !== "automation") {
          throw new Error("Choose an automation campaign. One-time campaigns cannot be used for new recurring automations");
        }
      }
      if (config.sourceWorkbookId) {
        const [selectedWorkbook] = await tx.select({ id: whatsappAiWorkbooks.id }).from(whatsappAiWorkbooks)
          .where(and(
            eq(whatsappAiWorkbooks.id, config.sourceWorkbookId),
            eq(whatsappAiWorkbooks.businessAccountId, businessAccountId),
            eq(whatsappAiWorkbooks.status, "active"),
          ))
          .for("update")
          .limit(1);
        if (!selectedWorkbook) throw new Error("The selected AI Workbook changed before the automation was saved");
      }
      const [row] = await tx.update(whatsappCampaignAutomations).set({
        ...config,
        scheduleEnabled: config.scheduleEnabled === true,
        scheduleDays: normalizeScheduleDays(config.scheduleDays),
        // Switching the schedule on starts it from now: a day whose send time
        // has already passed is not back-filled.
        scheduleActivatedAt: config.scheduleEnabled === true
          ? (existing.scheduleEnabled ? existing.scheduleActivatedAt : new Date())
          : existing.scheduleActivatedAt,
        updatedAt: new Date(),
      }).where(and(eq(whatsappCampaignAutomations.id, id), eq(whatsappCampaignAutomations.businessAccountId, businessAccountId))).returning();
      return row;
    });
  },

  async delete(businessAccountId: string, id: string) {
    return db.transaction(async tx => {
      const [automation] = await tx.select().from(whatsappCampaignAutomations)
        .where(and(
          eq(whatsappCampaignAutomations.id, id),
          eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
          isNull(whatsappCampaignAutomations.deletedAt),
        ))
        .for("update")
        .limit(1);
      if (!automation) return undefined;

      const activeRuns = await tx.select().from(whatsappCampaignAutomationRuns)
        .where(and(
          eq(whatsappCampaignAutomationRuns.automationId, id),
          eq(whatsappCampaignAutomationRuns.businessAccountId, businessAccountId),
          inArray(whatsappCampaignAutomationRuns.status, ["awaiting_review", "scheduled"]),
        ));
      const campaignIds = activeRuns.map(run => run.campaignId).filter((campaignId): campaignId is string => Boolean(campaignId));
      const campaigns = campaignIds.length
        ? await tx.select({ id: marketingCampaigns.id, status: marketingCampaigns.status })
          .from(marketingCampaigns)
          .where(and(
            eq(marketingCampaigns.businessAccountId, businessAccountId),
            inArray(marketingCampaigns.id, campaignIds),
          ))
          .for("update")
        : [];
      const campaignById = new Map(campaigns.map(campaign => [campaign.id, campaign]));
      const blockedRun = activeRuns.find(run => {
        const campaign = run.campaignId ? campaignById.get(run.campaignId) : undefined;
        return campaign && !["draft", "scheduled"].includes(campaign.status);
      });
      if (blockedRun) {
        throw new Error("This automation has a campaign that is already sending or complete. Wait for delivery to finish before deleting it.");
      }

      const deletedAt = new Date();
      for (const run of activeRuns) {
        if (run.campaignId) {
          await tx.update(marketingCampaigns).set({ status: "cancelled", updatedAt: deletedAt })
            .where(and(
              eq(marketingCampaigns.id, run.campaignId),
              eq(marketingCampaigns.businessAccountId, businessAccountId),
              inArray(marketingCampaigns.status, ["draft", "scheduled"]),
            ));
        }
        await tx.delete(whatsappCampaignAutomationDispatches)
          .where(and(
            eq(whatsappCampaignAutomationDispatches.runId, run.id),
            eq(whatsappCampaignAutomationDispatches.businessAccountId, businessAccountId),
          ));
        await tx.update(whatsappCampaignAutomationRuns).set({ status: "cancelled", updatedAt: deletedAt })
          .where(and(
            eq(whatsappCampaignAutomationRuns.id, run.id),
            eq(whatsappCampaignAutomationRuns.businessAccountId, businessAccountId),
          ));
      }

      const [deleted] = await tx.update(whatsappCampaignAutomations).set({
        enabled: false,
        deletedAt,
        updatedAt: deletedAt,
      }).where(and(
        eq(whatsappCampaignAutomations.id, id),
        eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
        isNull(whatsappCampaignAutomations.deletedAt),
      )).returning();
      return deleted;
    });
  },

  async preview(businessAccountId: string, id: string, payload: any) {
    const automation = await this.get(businessAccountId, id);
    if (!automation) throw new Error("Automation not found");
    const blueprint = automation.sourceType === "campaign_blueprint"
      ? await resolveBlueprintContext(businessAccountId, automation.sourceCampaignId)
      : null;
    const sourceConfig = blueprint ? applyCampaignOwnedSource(automation, blueprint.campaign) : automation;
    const workbookSource = sourceConfig.sourceWorkbookId
      ? await resolveWorkbookSource(businessAccountId, sourceConfig)
      : null;
    const groupSource = blueprint && !workbookSource
      ? await resolveGroupSource(businessAccountId, sourceConfig.sourceGroupIds)
      : null;
    const effectiveAutomation = blueprint
      ? {
          ...sourceConfig,
          templateId: blueprint.campaign.templateId,
          templateParams: blueprint.campaign.templateParams || [],
          sourceWorkbookId: workbookSource?.workbookId || null,
          sourceWorkbookSheetId: workbookSource?.sheetId || null,
        }
      : automation;
    const evaluated = await evaluateUpload(effectiveAutomation, workbookSource?.payload || groupSource?.payload || payload);
    return {
      targetDate: evaluated.targetDate,
      summary: evaluated.summary,
      invalid: evaluated.invalid,
      source: workbookSource ? {
        type: blueprint ? "campaign_blueprint" : "ai_workbook",
        audienceType: "ai_workbook",
        campaignId: blueprint?.campaign.id,
        campaignName: blueprint?.campaign.name,
        campaignUpdatedAt: blueprint?.campaign.updatedAt,
        workbookId: workbookSource.workbookId,
        workbookName: workbookSource.workbookName,
        versionId: workbookSource.versionId,
        versionNumber: workbookSource.versionNumber,
        revision: workbookSource.revision,
        sheetId: workbookSource.sheetId,
        sheetName: workbookSource.sheetName,
      } : groupSource ? {
        type: "campaign_blueprint",
        audienceType: "contact_groups",
        campaignId: blueprint?.campaign.id,
        campaignName: blueprint?.campaign.name,
        campaignUpdatedAt: blueprint?.campaign.updatedAt,
        groupIds: groupSource.groupIds,
        groupNames: groupSource.groupNames,
      } : { type: "upload" },
      previewRecipients: evaluated.candidates.slice(0, 25).map(candidate => ({
        rowNumber: candidate.rowNumber,
        recordKey: candidate.recordKey,
        phone: candidate.phone,
        name: candidate.name,
        params: (effectiveAutomation.templateParams || []).map(value => resolvePreviewParam(value, candidate)),
      })),
    };
  },

  async createRun(
    businessAccountId: string,
    id: string,
    payload: any,
    sourceFileName: string,
    options: { trigger?: "manual" | "schedule"; scheduleRunDate?: string | null } = {},
  ) {
    const automation = await this.get(businessAccountId, id);
    if (!automation) throw new Error("Automation not found");
    if (!automation.enabled) throw new Error("This automation is paused");
    const blueprint = automation.sourceType === "campaign_blueprint"
      ? await resolveBlueprintContext(businessAccountId, automation.sourceCampaignId)
      : null;
    const sourceConfig = blueprint ? applyCampaignOwnedSource(automation, blueprint.campaign) : automation;
    const workbookSource = sourceConfig.sourceWorkbookId
      ? await resolveWorkbookSource(businessAccountId, sourceConfig)
      : null;
    const groupSource = blueprint && !workbookSource
      ? await resolveGroupSource(businessAccountId, sourceConfig.sourceGroupIds)
      : null;
    const effectiveAutomation = blueprint
      ? {
          ...sourceConfig,
          templateId: blueprint.campaign.templateId,
          templateParams: blueprint.campaign.templateParams || [],
          sourceWorkbookId: workbookSource?.workbookId || null,
          sourceWorkbookSheetId: workbookSource?.sheetId || null,
        }
      : automation;
    const [template] = await db.select().from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, effectiveAutomation.templateId), eq(whatsappTemplates.businessAccountId, businessAccountId)))
      .limit(1);
    if (!template || template.deletedAt || template.status !== "approved") {
      throw new Error("The selected template is no longer available");
    }
    assertTemplateMapping(template, effectiveAutomation.templateParams || []);
    if (
      workbookSource
      && (!payload?.expectedWorkbookVersionId || !Number.isInteger(payload?.expectedWorkbookRevision))
    ) {
      throw new Error("Validate the latest AI Workbook version before creating a run.");
    }
    if (
      workbookSource
      && (
        payload.expectedWorkbookVersionId !== workbookSource.versionId
        || payload.expectedWorkbookRevision !== workbookSource.revision
      )
    ) {
      throw new Error("The AI Workbook changed after validation. Validate the latest version again.");
    }
    if (
      blueprint
      && (
        !payload?.expectedCampaignUpdatedAt
        || new Date(payload.expectedCampaignUpdatedAt).getTime() !== blueprint.campaign.updatedAt.getTime()
      )
    ) {
      throw new Error("The campaign blueprint changed after validation. Validate it again.");
    }
    const evaluated = await evaluateUpload(effectiveAutomation, workbookSource?.payload || groupSource?.payload || payload);
    if (evaluated.candidates.length === 0) {
      throw new Error("No eligible recipients were found. Check the date rule, status filter, and duplicate history.");
    }

    const scheduledAt = nextScheduledAt(automation);
    const automatic = automation.sendMode === "automatic";
    const safeFileName = workbookSource
      ? `${workbookSource.workbookName} · version ${workbookSource.versionNumber}.${workbookSource.revision}`.slice(0, 200)
      : groupSource
        ? groupSource.groupNames.join(", ").slice(0, 200)
      : String(sourceFileName || "spreadsheet").slice(0, 200);
    const result = await db.transaction(async tx => {
      if (workbookSource) {
        const [lockedWorkbook] = await tx.select({ id: whatsappAiWorkbooks.id }).from(whatsappAiWorkbooks)
          .where(and(
            eq(whatsappAiWorkbooks.id, workbookSource.workbookId),
            eq(whatsappAiWorkbooks.businessAccountId, businessAccountId),
            eq(whatsappAiWorkbooks.status, "active"),
          ))
          .for("update")
          .limit(1);
        if (!lockedWorkbook) throw new Error("The linked AI Workbook was deleted before the run could be created");
        const [currentVersion] = await tx.select({
          id: whatsappAiWorkbookVersions.id,
          revision: whatsappAiWorkbookVersions.revision,
        }).from(whatsappAiWorkbookVersions)
          .where(and(
            eq(whatsappAiWorkbookVersions.workbookId, workbookSource.workbookId),
            eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
          ))
          .orderBy(desc(whatsappAiWorkbookVersions.versionNumber))
          .limit(1);
        if (
          currentVersion?.id !== workbookSource.versionId
          || currentVersion.revision !== workbookSource.revision
        ) {
          throw new Error("The AI Workbook changed after validation. Validate the latest version again.");
        }
      }
      const [activeAutomation] = await tx.select().from(whatsappCampaignAutomations)
        .where(and(
          eq(whatsappCampaignAutomations.id, id),
          eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
          eq(whatsappCampaignAutomations.enabled, true),
          isNull(whatsappCampaignAutomations.deletedAt),
        ))
        .for("update")
        .limit(1);
      if (!activeAutomation) throw new Error("This automation was deleted or paused before the run could be created");
      if (
        activeAutomation.updatedAt.getTime() !== automation.updatedAt.getTime()
        || activeAutomation.sourceType !== automation.sourceType
        || activeAutomation.sourceCampaignId !== automation.sourceCampaignId
        || activeAutomation.sourceWorkbookId !== automation.sourceWorkbookId
        || activeAutomation.sourceWorkbookSheetId !== automation.sourceWorkbookSheetId
         || JSON.stringify(activeAutomation.sourceGroupIds || []) !== JSON.stringify(automation.sourceGroupIds || [])
      ) {
        throw new Error("This automation changed while the run was being prepared. Validate the source again.");
      }

      let lockedBlueprint: MarketingCampaign | null = null;
      if (blueprint) {
        [lockedBlueprint] = await tx.select().from(marketingCampaigns)
          .where(and(
            eq(marketingCampaigns.id, blueprint.campaign.id),
            eq(marketingCampaigns.businessAccountId, businessAccountId),
          ))
          .for("update")
          .limit(1);
        if (!lockedBlueprint || lockedBlueprint.status !== "draft" || lockedBlueprint.startedAt) {
          throw new Error("The campaign blueprint is no longer an unsent draft");
        }
        if (lockedBlueprint.updatedAt.getTime() !== blueprint.campaign.updatedAt.getTime()) {
          throw new Error("The campaign blueprint changed after validation. Validate it again.");
        }
      }

      const [group] = await tx.insert(contactGroups).values({
        businessAccountId,
        name: `${automation.name} — ${dateInTimezone(automation.timezone)} (${safeFileName})`.slice(0, 250),
        description: blueprint
          ? workbookSource
            ? `Generated from campaign blueprint "${blueprint.campaign.name}" and AI Workbook "${workbookSource.workbookName}"`
            : `Generated from campaign blueprint "${blueprint.campaign.name}" and contact groups "${groupSource!.groupNames.join(", ")}"`
          : workbookSource
            ? `Generated from AI Workbook "${workbookSource.workbookName}" by automation "${automation.name}"`
          : `Generated from spreadsheet automation "${automation.name}"`,
        defaultCountryCode: automation.defaultCountryCode,
        contactCount: evaluated.candidates.length,
      }).returning();

      const contacts = evaluated.candidates.map(candidate => ({
        businessAccountId,
        groupId: group.id,
        phone: candidate.phone,
        name: candidate.name,
        attributes: candidate.attributes,
      }));
      for (let index = 0; index < contacts.length; index += 500) {
        await tx.insert(contactGroupContacts).values(contacts.slice(index, index + 500));
      }

      const [campaign] = await tx.insert(marketingCampaigns).values({
        businessAccountId,
        name: `${automation.name} — ${dateInTimezone(automation.timezone)}`.slice(0, 250),
        templateId: lockedBlueprint?.templateId || effectiveAutomation.templateId,
        templateParams: lockedBlueprint?.templateParams || effectiveAutomation.templateParams,
        groupIds: [group.id],
        status: automatic ? "scheduled" : "draft",
        scheduledAt: automatic ? scheduledAt : null,
        aiEnabled: lockedBlueprint?.aiEnabled || "false",
        aiAgentName: lockedBlueprint?.aiAgentName,
        aiSystemPrompt: lockedBlueprint?.aiSystemPrompt,
        aiUseFaqs: lockedBlueprint?.aiUseFaqs || "true",
        aiUseDocs: lockedBlueprint?.aiUseDocs || "true",
        aiUseProducts: lockedBlueprint?.aiUseProducts || "true",
        aiKnowledgeDocIds: lockedBlueprint?.aiKnowledgeDocIds || [],
        replyClassifications: lockedBlueprint?.replyClassifications || [],
        aiDailyTokenBudget: lockedBlueprint?.aiDailyTokenBudget || 50000,
        aiMaxRepliesPerRecipient: lockedBlueprint?.aiMaxRepliesPerRecipient || 20,
        // Keep the generated execution immutable, but preserve the blueprint's
        // prompt allowlist so Campaign AI never receives extra workbook fields.
        recipientSourceType: lockedBlueprint?.recipientSourceType,
        recipientAiAllowedFields: lockedBlueprint?.recipientAiAllowedFields || [],
      }).returning();

      const [run] = await tx.insert(whatsappCampaignAutomationRuns).values({
        automationId: automation.id,
        businessAccountId,
        campaignId: campaign.id,
        contactGroupId: group.id,
        sourceFileName: safeFileName,
        sourceType: blueprint ? "campaign_blueprint" : workbookSource ? "ai_workbook" : "upload",
        sourceCampaignId: blueprint?.campaign.id || null,
        sourceCampaignName: blueprint?.campaign.name || null,
        sourceCampaignUpdatedAt: blueprint?.campaign.updatedAt || null,
        sourceWorkbookId: workbookSource?.workbookId || null,
        sourceWorkbookVersionId: workbookSource?.versionId || null,
        sourceWorkbookSheetId: workbookSource?.sheetId || null,
        sourceWorkbookName: workbookSource?.workbookName || null,
        sourceWorkbookVersionNumber: workbookSource?.versionNumber || null,
        sourceWorkbookRevision: workbookSource?.revision || null,
        sourceWorkbookSheetName: workbookSource?.sheetName || null,
        sourceGroupIds: groupSource?.groupIds || [],
        sourceGroupNames: groupSource?.groupNames || [],
        sourceSnapshot: {
          columns: evaluated.sheet.columns,
          recipients: evaluated.candidates.map(candidate => ({
            rowNumber: candidate.rowNumber,
            recordKey: candidate.recordKey,
            phone: candidate.phone,
            name: candidate.name,
            attributes: candidate.attributes,
          })),
        },
        blueprintSnapshot: lockedBlueprint ? {
          campaignId: lockedBlueprint.id,
          campaignName: lockedBlueprint.name,
          updatedAt: lockedBlueprint.updatedAt.toISOString(),
          templateId: lockedBlueprint.templateId,
          templateParams: lockedBlueprint.templateParams || [],
          aiEnabled: lockedBlueprint.aiEnabled,
          aiAgentName: lockedBlueprint.aiAgentName,
          aiSystemPrompt: lockedBlueprint.aiSystemPrompt,
          aiUseFaqs: lockedBlueprint.aiUseFaqs,
          aiUseDocs: lockedBlueprint.aiUseDocs,
          aiUseProducts: lockedBlueprint.aiUseProducts,
          aiKnowledgeDocIds: lockedBlueprint.aiKnowledgeDocIds || [],
          replyClassifications: lockedBlueprint.replyClassifications || [],
          aiDailyTokenBudget: lockedBlueprint.aiDailyTokenBudget,
          aiMaxRepliesPerRecipient: lockedBlueprint.aiMaxRepliesPerRecipient,
        } : null,
        status: automatic ? "scheduled" : "awaiting_review",
        scheduledAt: automatic ? scheduledAt : null,
        trigger: options.trigger === "schedule" ? "schedule" : "manual",
        scheduleRunDate: options.trigger === "schedule" ? options.scheduleRunDate || null : null,
        ...evaluated.summary,
      }).returning();

      // Review-mode uploads only reserve their record keys once an operator
      // approves them. A rejected/cancelled review must stay eligible for the
      // corrected file that replaces it.
      if (automatic) {
        await tx.insert(whatsappCampaignAutomationDispatches).values(
          evaluated.candidates.map(candidate => ({
            automationId: automation.id,
            businessAccountId,
            runId: run.id,
            recordKey: candidate.recordKey,
          })),
        );
      }
      return { run, campaign };
    });

    return {
      ...result,
      preview: {
        targetDate: evaluated.targetDate,
        summary: evaluated.summary,
        invalid: evaluated.invalid,
      },
    };
  },

  async listRuns(businessAccountId: string, automationId: string) {
    const automation = await this.get(businessAccountId, automationId);
    if (!automation) throw new Error("Automation not found");
    const runs = await db.select().from(whatsappCampaignAutomationRuns)
      .where(and(
        eq(whatsappCampaignAutomationRuns.businessAccountId, businessAccountId),
        eq(whatsappCampaignAutomationRuns.automationId, automationId),
      ))
      .orderBy(desc(whatsappCampaignAutomationRuns.createdAt))
      .limit(100);
    const campaignIds = runs.map(run => run.campaignId).filter((id): id is string => Boolean(id));
    const campaigns = campaignIds.length
      ? await db.select().from(marketingCampaigns).where(inArray(marketingCampaigns.id, campaignIds))
      : [];
    const byId = new Map(campaigns.map(campaign => [campaign.id, campaign]));
    return runs.map(run => ({ ...run, campaign: run.campaignId ? byId.get(run.campaignId) || null : null }));
  },

  async approveRun(businessAccountId: string, automationId: string, runId: string) {
    const [run] = await db.select().from(whatsappCampaignAutomationRuns)
      .where(and(
        eq(whatsappCampaignAutomationRuns.id, runId),
        eq(whatsappCampaignAutomationRuns.automationId, automationId),
        eq(whatsappCampaignAutomationRuns.businessAccountId, businessAccountId),
      )).limit(1);
    if (!run) throw new Error("Automation run not found");
    if (run.status !== "awaiting_review" || !run.campaignId) throw new Error("This run is not awaiting review");

    const automation = await this.get(businessAccountId, automationId);
    if (!automation) throw new Error("Automation not found");
    const updated = await db.transaction(async tx => {
      const [activeAutomation] = await tx.select().from(whatsappCampaignAutomations)
        .where(and(
          eq(whatsappCampaignAutomations.id, automationId),
          eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
          eq(whatsappCampaignAutomations.enabled, true),
          isNull(whatsappCampaignAutomations.deletedAt),
        ))
        .for("update")
        .limit(1);
      if (!activeAutomation) throw new Error("This automation was deleted or paused before the run could be scheduled");
      const scheduledAt = nextScheduledAt(activeAutomation);

      const contacts = await tx.select({
        phone: contactGroupContacts.phone,
      }).from(contactGroupContacts)
        .where(and(
          eq(contactGroupContacts.groupId, run.contactGroupId!),
          eq(contactGroupContacts.businessAccountId, businessAccountId),
        ));
      // Reuse the keys evaluateUpload computed (and checked against history)
      // when the run was created, so the reserved key is byte-for-byte the one
      // later uploads will look up.
      const dispatches = dispatchKeysForReviewedRun(run.sourceSnapshot?.recipients, contacts)
        .map(recordKey => ({
          automationId,
          businessAccountId,
          runId: run.id,
          recordKey,
        }));
      const reserved = await tx.insert(whatsappCampaignAutomationDispatches)
        .values(dispatches)
        .onConflictDoNothing()
        .returning({ id: whatsappCampaignAutomationDispatches.id });
      if (reserved.length !== dispatches.length) {
        throw new Error("Some recipients were already scheduled or sent in another run. Upload a corrected file and review it again.");
      }
      const [campaign] = await tx.update(marketingCampaigns).set({
        status: "scheduled",
        scheduledAt,
        updatedAt: new Date(),
      }).where(and(
        eq(marketingCampaigns.id, run.campaignId!),
        eq(marketingCampaigns.businessAccountId, businessAccountId),
        eq(marketingCampaigns.status, "draft"),
      )).returning();
      if (!campaign) throw new Error("The generated campaign is no longer available for scheduling");
      const [savedRun] = await tx.update(whatsappCampaignAutomationRuns).set({
        status: "scheduled",
        scheduledAt,
        approvedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(whatsappCampaignAutomationRuns.id, run.id)).returning();
      return { run: savedRun, campaign };
    });
    return updated;
  },

  async cancelRun(businessAccountId: string, automationId: string, runId: string) {
    const automation = await this.get(businessAccountId, automationId);
    if (!automation) return false;
    return db.transaction(async tx => {
      const [run] = await tx.select().from(whatsappCampaignAutomationRuns)
        .where(and(
          eq(whatsappCampaignAutomationRuns.id, runId),
          eq(whatsappCampaignAutomationRuns.automationId, automationId),
          eq(whatsappCampaignAutomationRuns.businessAccountId, businessAccountId),
        ))
        .for("update")
        .limit(1);
      if (!run) return false;
      if (!["awaiting_review", "scheduled"].includes(run.status)) {
        throw new Error("This run can no longer be cancelled");
      }
      if (run.campaignId) {
        const [campaign] = await tx.select({ status: marketingCampaigns.status }).from(marketingCampaigns)
          .where(and(
            eq(marketingCampaigns.id, run.campaignId),
            eq(marketingCampaigns.businessAccountId, businessAccountId),
          ))
          .for("update")
          .limit(1);
        if (campaign && !["draft", "scheduled"].includes(campaign.status)) {
          throw new Error(`This run's campaign is already ${campaign.status} and can no longer be cancelled`);
        }
        if (campaign) {
          const [cancelledCampaign] = await tx.update(marketingCampaigns)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(and(
              eq(marketingCampaigns.id, run.campaignId),
              eq(marketingCampaigns.businessAccountId, businessAccountId),
              inArray(marketingCampaigns.status, ["draft", "scheduled"]),
            ))
            .returning({ id: marketingCampaigns.id });
          if (!cancelledCampaign) throw new Error("This campaign started sending and can no longer be cancelled");
        }
      }
      await tx.delete(whatsappCampaignAutomationDispatches)
        .where(and(
          eq(whatsappCampaignAutomationDispatches.runId, run.id),
          eq(whatsappCampaignAutomationDispatches.businessAccountId, businessAccountId),
        ));
      const [cancelledRun] = await tx.update(whatsappCampaignAutomationRuns)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(
          eq(whatsappCampaignAutomationRuns.id, run.id),
          inArray(whatsappCampaignAutomationRuns.status, ["awaiting_review", "scheduled"]),
        ))
        .returning({ id: whatsappCampaignAutomationRuns.id });
      if (!cancelledRun) throw new Error("This run changed and can no longer be cancelled");
      return true;
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Automatic daily runs (the automation scheduler)
//
// For every active automation with `scheduleEnabled`, once per local day (in
// the automation's timezone, on its chosen weekdays) the scheduler does what an
// operator used to do by hand: Validate -> Create run. It reuses preview() and
// createRun(), so every existing safety check (approved template, unsent
// blueprint, workbook version pinning, duplicate record keys, paused/deleted
// automation) still applies. Review-mode automations get a run waiting for
// approval; automatic ones get a scheduled campaign that the normal campaign
// scheduler sends (with its own quiet-hours / opt-out checks).
//
// Exactly-once per day, across restarts and across several server instances:
//   1. the day is claimed by INSERTing (automation_id, run_date) into
//      whatsapp_campaign_automation_schedule_attempts - a unique key, so only
//      one instance ever wins the claim;
//   2. the run itself carries schedule_run_date, also unique per automation;
//   3. automatic runs reserve each record key in the dispatch table (unique).
// A claim left "running" by a crash is closed out later (never retried), so a
// day can be missed but never sent twice.
// ─────────────────────────────────────────────────────────────────────────────

export const automationScheduleTuning = {
  /** Prepare the run this long before send time so the campaign goes out on time. */
  leadMs: 5 * 60_000,
  /** If the server was down at send time, still run up to this long afterwards. */
  catchUpMs: 3 * 60 * 60_000,
  /** A claim still "running" after this long is treated as interrupted. */
  staleClaimMinutes: 15,
  tickMs: 60_000,
};

const SCHEDULER_INSTANCE = `${os.hostname()}:${process.pid}`;

type SchedulableAutomation = Pick<WhatsappCampaignAutomation,
  "sendTime" | "timezone" | "scheduleDays" | "scheduleActivatedAt"> & { updatedAt?: Date | string | null };

/**
 * The schedule only counts from the later of "switched on" and "last edited":
 * a day whose send time had already passed at that moment is not back-filled,
 * so changing the time to earlier today never fires an immediate catch-up run.
 */
function scheduleStartsAt(automation: SchedulableAutomation): number {
  const activatedAt = automation.scheduleActivatedAt ? new Date(automation.scheduleActivatedAt).getTime() : 0;
  const editedAt = automation.updatedAt ? new Date(automation.updatedAt).getTime() : 0;
  return Math.max(activatedAt, editedAt);
}

export type ScheduleWindow = {
  runDate: string;
  scheduledFor: Date;
  state: "not_today" | "before_activation" | "early" | "due" | "missed";
};

function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00.000Z`).getUTCDay();
}

/** Where `now` falls relative to today's scheduled time for this automation. */
export function scheduleWindowFor(automation: SchedulableAutomation, now = new Date()): ScheduleWindow {
  const runDate = dateInTimezone(automation.timezone, now);
  const scheduledFor = zonedDateTimeToUtc(runDate, automation.sendTime, automation.timezone);
  const days = normalizeScheduleDays(automation.scheduleDays);
  if (days.length && !days.includes(weekdayOf(runDate))) return { runDate, scheduledFor, state: "not_today" };
  if (scheduledFor.getTime() < scheduleStartsAt(automation)) {
    return { runDate, scheduledFor, state: "before_activation" };
  }
  if (now.getTime() < scheduledFor.getTime() - automationScheduleTuning.leadMs) return { runDate, scheduledFor, state: "early" };
  if (now.getTime() > scheduledFor.getTime() + automationScheduleTuning.catchUpMs) return { runDate, scheduledFor, state: "missed" };
  return { runDate, scheduledFor, state: "due" };
}

/** The next moment the scheduler will prepare a run, or null when it never will. */
export function nextScheduledRunAt(
  automation: SchedulableAutomation & Pick<WhatsappCampaignAutomation, "scheduleEnabled" | "enabled" | "sourceType">,
  handledRunDates: Set<string>,
  now = new Date(),
): Date | null {
  if (!automation.scheduleEnabled || !automation.enabled || automation.sourceType === "upload") return null;
  const today = dateInTimezone(automation.timezone, now);
  const days = normalizeScheduleDays(automation.scheduleDays);
  const activatedAt = scheduleStartsAt(automation);
  for (let offset = 0; offset <= 8; offset++) {
    const runDate = addDays(today, offset);
    if (days.length && !days.includes(weekdayOf(runDate))) continue;
    if (handledRunDates.has(runDate)) continue;
    const scheduledFor = zonedDateTimeToUtc(runDate, automation.sendTime, automation.timezone);
    if (scheduledFor.getTime() < activatedAt) continue;
    if (now.getTime() > scheduledFor.getTime() + automationScheduleTuning.catchUpMs) continue;
    return scheduledFor;
  }
  return null;
}

function describeNothingDue(summary: { totalRows: number; excludedRows: number; duplicateRows: number; invalidRows: number }): string {
  const parts = [`${summary.totalRows} checked`];
  if (summary.duplicateRows) parts.push(`${summary.duplicateRows} already messaged`);
  if (summary.invalidRows) parts.push(`${summary.invalidRows} with missing or invalid details`);
  return `No one was due today (${parts.join(", ")}). Nothing was sent.`;
}

export type ScheduledAutomationResult = {
  automationId: string;
  action: "not_due" | "already_handled" | "missed" | "created" | "skipped" | "failed";
  runId?: string;
  reason?: string;
};

/**
 * Handles one automation for the current tick. Safe to call any number of
 * times, from any number of processes: only the caller that wins the day's
 * claim does any work.
 */
export async function runScheduledAutomation(
  automation: WhatsappCampaignAutomation,
  opts: { campaignsEnabled: boolean; now?: Date },
): Promise<ScheduledAutomationResult> {
  const now = opts.now ?? new Date();
  const base = { automationId: automation.id };
  if (!automation.enabled || !automation.scheduleEnabled || automation.deletedAt) return { ...base, action: "not_due" };
  const window = scheduleWindowFor(automation, now);
  if (window.state === "not_today" || window.state === "before_activation" || window.state === "early") {
    return { ...base, action: "not_due" };
  }

  if (window.state === "missed") {
    const reason = "The server was not available at the scheduled time, so this day's run was skipped. Nothing was sent.";
    const inserted = await db.insert(whatsappCampaignAutomationScheduleAttempts).values({
      automationId: automation.id,
      businessAccountId: automation.businessAccountId,
      runDate: window.runDate,
      scheduledFor: window.scheduledFor,
      status: "skipped",
      outcome: "missed",
      reason,
      claimedBy: SCHEDULER_INSTANCE,
      finishedAt: new Date(),
    }).onConflictDoNothing().returning({ id: whatsappCampaignAutomationScheduleAttempts.id });
    return { ...base, action: inserted.length ? "missed" : "already_handled", reason };
  }

  // The claim. Losing it means another tick/instance already owns this day.
  const [claim] = await db.insert(whatsappCampaignAutomationScheduleAttempts).values({
    automationId: automation.id,
    businessAccountId: automation.businessAccountId,
    runDate: window.runDate,
    scheduledFor: window.scheduledFor,
    status: "running",
    claimedBy: SCHEDULER_INSTANCE,
  }).onConflictDoNothing().returning({ id: whatsappCampaignAutomationScheduleAttempts.id });
  if (!claim) return { ...base, action: "already_handled" };

  const finish = async (
    status: "created" | "skipped" | "failed",
    outcome: string,
    reason: string,
    extra: { runId?: string; eligibleRows?: number } = {},
  ): Promise<ScheduledAutomationResult> => {
    await db.update(whatsappCampaignAutomationScheduleAttempts).set({
      status,
      outcome,
      reason: reason.slice(0, 1000),
      runId: extra.runId ?? null,
      eligibleRows: extra.eligibleRows ?? 0,
      finishedAt: new Date(),
    }).where(and(
      eq(whatsappCampaignAutomationScheduleAttempts.id, claim.id),
      eq(whatsappCampaignAutomationScheduleAttempts.status, "running"),
    ));
    return { ...base, action: status, runId: extra.runId, reason };
  };

  if (!opts.campaignsEnabled) {
    return finish("skipped", "campaigns_off", "WhatsApp campaigns are switched off for this business, so nothing was sent.");
  }
  if (automation.sourceType === "upload") {
    return finish("skipped", "needs_upload", SCHEDULE_NEEDS_SAVED_SOURCE);
  }

  let preview: Awaited<ReturnType<typeof campaignAutomationService.preview>>;
  try {
    preview = await campaignAutomationService.preview(automation.businessAccountId, automation.id, {});
  } catch (error: any) {
    return finish("failed", "validation_failed", `Check failed: ${error?.message || "unknown problem"}. Nothing was sent.`);
  }
  if (preview.summary.eligibleRows === 0) {
    return finish("skipped", "nothing_due", describeNothingDue(preview.summary));
  }

  try {
    const source = preview.source as { versionId?: string; revision?: number; campaignUpdatedAt?: Date | string };
    const result = await campaignAutomationService.createRun(
      automation.businessAccountId,
      automation.id,
      {
        expectedWorkbookVersionId: source.versionId,
        expectedWorkbookRevision: source.revision,
        expectedCampaignUpdatedAt: source.campaignUpdatedAt,
      },
      "Automatic daily run",
      { trigger: "schedule", scheduleRunDate: window.runDate },
    );
    const people = `${result.run.eligibleRows} ${result.run.eligibleRows === 1 ? "person" : "people"}`;
    return result.run.status === "scheduled"
      ? finish("created", "scheduled", `Campaign created for ${people}. It sends at ${automation.sendTime} (${automation.timezone}).`, {
          runId: result.run.id, eligibleRows: result.run.eligibleRows,
        })
      : finish("created", "awaiting_review", `Run prepared for ${people}. It is waiting for your approval before anything is sent.`, {
          runId: result.run.id, eligibleRows: result.run.eligibleRows,
        });
  } catch (error: any) {
    return finish("failed", "validation_failed", `Could not create the run: ${error?.message || "unknown problem"}. Nothing was sent.`);
  }
}

/**
 * Closes claims a crashed process left "running". If its run was committed,
 * the attempt is linked to it; otherwise it is marked interrupted. Never retried.
 */
export async function recoverStaleScheduleClaims(): Promise<number> {
  const stale = await db.select().from(whatsappCampaignAutomationScheduleAttempts)
    .where(and(
      eq(whatsappCampaignAutomationScheduleAttempts.status, "running"),
      sql`${whatsappCampaignAutomationScheduleAttempts.createdAt} < NOW() - (${automationScheduleTuning.staleClaimMinutes} * interval '1 minute')`,
    ))
    .limit(200);
  for (const attempt of stale) {
    const [run] = await db.select().from(whatsappCampaignAutomationRuns)
      .where(and(
        eq(whatsappCampaignAutomationRuns.automationId, attempt.automationId),
        eq(whatsappCampaignAutomationRuns.scheduleRunDate, attempt.runDate),
      ))
      .limit(1);
    await db.update(whatsappCampaignAutomationScheduleAttempts).set(run
      ? {
          status: "created",
          outcome: run.status === "awaiting_review" ? "awaiting_review" : "scheduled",
          reason: `Run created for ${run.eligibleRows} ${run.eligibleRows === 1 ? "person" : "people"}.`,
          runId: run.id,
          eligibleRows: run.eligibleRows,
          finishedAt: new Date(),
        }
      : {
          status: "failed",
          outcome: "interrupted",
          reason: "The server restarted while preparing this run. Nothing was sent; the next run is on the next scheduled day.",
          finishedAt: new Date(),
        })
      .where(and(
        eq(whatsappCampaignAutomationScheduleAttempts.id, attempt.id),
        eq(whatsappCampaignAutomationScheduleAttempts.status, "running"),
      ));
  }
  return stale.length;
}

/** One scheduler pass over every business. */
export async function runAutomationScheduleTick(now = new Date()): Promise<ScheduledAutomationResult[]> {
  await recoverStaleScheduleClaims();
  const rows = await db.select({
    automation: whatsappCampaignAutomations,
    whatsappEnabled: businessAccounts.whatsappEnabled,
    whatsappMarketingEnabled: businessAccounts.whatsappMarketingEnabled,
  }).from(whatsappCampaignAutomations)
    .innerJoin(businessAccounts, eq(businessAccounts.id, whatsappCampaignAutomations.businessAccountId))
    .where(and(
      eq(whatsappCampaignAutomations.enabled, true),
      eq(whatsappCampaignAutomations.scheduleEnabled, true),
      isNull(whatsappCampaignAutomations.deletedAt),
    ));
  const results: ScheduledAutomationResult[] = [];
  for (const row of rows) {
    try {
      results.push(await runScheduledAutomation(row.automation, {
        campaignsEnabled: row.whatsappEnabled === "true" && row.whatsappMarketingEnabled === "true",
        now,
      }));
    } catch (error) {
      console.error(`[AutomationScheduler] automation ${row.automation.id} failed:`, (error as Error)?.message);
      reportError(error, { source: "worker:campaign-automation-scheduler" });
    }
  }
  return results;
}

let automationSchedulerStarted = false;
let automationTickRunning = false;
export function startCampaignAutomationScheduler(): void {
  if (automationSchedulerStarted) return;
  automationSchedulerStarted = true;
  trackTimer(setInterval(() => {
    if (automationTickRunning) return;
    automationTickRunning = true;
    runAutomationScheduleTick()
      .catch(err => {
        console.error("[AutomationScheduler] tick error:", err);
        reportError(err, { source: "worker:campaign-automation-scheduler" });
      })
      .finally(() => { automationTickRunning = false; });
  }, automationScheduleTuning.tickMs));
  console.log("[AutomationScheduler] Started (60s interval)");
}

/** Schedule settings, next run time and recent automatic-run history for the UI. */
export async function getAutomationSchedule(businessAccountId: string, automationId: string) {
  const automation = await campaignAutomationService.get(businessAccountId, automationId);
  if (!automation) return undefined;
  const history = await db.select().from(whatsappCampaignAutomationScheduleAttempts)
    .where(and(
      eq(whatsappCampaignAutomationScheduleAttempts.businessAccountId, businessAccountId),
      eq(whatsappCampaignAutomationScheduleAttempts.automationId, automationId),
    ))
    .orderBy(desc(whatsappCampaignAutomationScheduleAttempts.runDate))
    .limit(60);
  const handled = new Set(history.map(attempt => attempt.runDate));
  const nextRunAt = nextScheduledRunAt(automation, handled);
  return {
    scheduleEnabled: automation.scheduleEnabled,
    scheduleDays: normalizeScheduleDays(automation.scheduleDays),
    sendTime: automation.sendTime,
    timezone: automation.timezone,
    sendMode: automation.sendMode,
    enabled: automation.enabled,
    canSchedule: automation.sourceType !== "upload",
    cannotScheduleReason: automation.sourceType === "upload" ? SCHEDULE_NEEDS_SAVED_SOURCE : null,
    nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
    history,
  };
}

/** Switches the daily schedule on/off and sets its weekdays, without touching anything else. */
export async function setAutomationSchedule(
  businessAccountId: string,
  automationId: string,
  input: { scheduleEnabled?: unknown; scheduleDays?: unknown },
) {
  const automation = await campaignAutomationService.get(businessAccountId, automationId);
  if (!automation) return undefined;
  const scheduleEnabled = input.scheduleEnabled === undefined ? automation.scheduleEnabled : input.scheduleEnabled === true;
  if (scheduleEnabled && automation.sourceType === "upload") throw new Error(SCHEDULE_NEEDS_SAVED_SOURCE);
  const scheduleDays = input.scheduleDays === undefined
    ? normalizeScheduleDays(automation.scheduleDays)
    : normalizeScheduleDays(input.scheduleDays);
  const [row] = await db.update(whatsappCampaignAutomations).set({
    scheduleEnabled,
    scheduleDays,
    scheduleActivatedAt: scheduleEnabled && !automation.scheduleEnabled ? new Date() : automation.scheduleActivatedAt,
    updatedAt: new Date(),
  }).where(and(
    eq(whatsappCampaignAutomations.id, automationId),
    eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
    isNull(whatsappCampaignAutomations.deletedAt),
  )).returning();
  return row;
}