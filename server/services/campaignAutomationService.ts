import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  contactGroupContacts,
  contactGroups,
  marketingCampaigns,
  whatsappCampaignAutomationDispatches,
  whatsappCampaignAutomationRuns,
  whatsappCampaignAutomations,
  whatsappTemplates,
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

type AutomationInput = {
  name: string;
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
};

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

  return {
    ...input,
    name,
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
  } as AutomationInput;
}

function validateColumns(config: AutomationInput, columns: ImportColumn[]) {
  const available = new Set(columns.map(column => column.key));
  for (const field of [config.phoneColumn, ...configuredColumns(config.recordKeyColumn), config.dateColumn]) {
    if (!available.has(field!)) throw new Error(`The uploaded file no longer has the "${field}" column`);
  }
  for (const field of [config.nameColumn, config.statusColumn]) {
    if (field && !available.has(field)) throw new Error(`The uploaded file no longer has the "${field}" column`);
  }
}

function parseDateOnly(raw: string): string | null {
  const text = raw.trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (iso) {
    const year = Number(iso[1]), month = Number(iso[2]), day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const check = new Date(Date.UTC(year, month - 1, day));
      if (check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }

  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s.*)?$/);
  if (dmy) {
    const day = Number(dmy[1]), month = Number(dmy[2]), year = Number(dmy[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateInTimezone(timezone: string, date = new Date()): string {
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
function zonedDateTimeToUtc(isoDate: string, time: string, timezone: string): Date {
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

function recordKeyForContact(
  config: Pick<AutomationInput, "recordKeyColumn">,
  contact: { phone: string; name: string | null; attributes: Record<string, string> | null },
): string {
  return configuredColumns(config.recordKeyColumn)
    .map(column => {
      if (column === "phone") return contact.phone || "";
      if (column === "name") return contact.name || "";
      return contact.attributes?.[column] || "";
    })
    .map(value => value.trim())
    .join(" | ");
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
      .where(eq(whatsappCampaignAutomations.businessAccountId, businessAccountId))
      .orderBy(desc(whatsappCampaignAutomations.updatedAt));
  },

  async get(businessAccountId: string, id: string) {
    const [row] = await db.select().from(whatsappCampaignAutomations)
      .where(and(eq(whatsappCampaignAutomations.id, id), eq(whatsappCampaignAutomations.businessAccountId, businessAccountId)))
      .limit(1);
    return row;
  },

  async create(businessAccountId: string, input: AutomationInput) {
    const config = cleanConfig(input);
    const [template] = await db.select().from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, config.templateId), eq(whatsappTemplates.businessAccountId, businessAccountId)))
      .limit(1);
    if (!template || template.status !== "approved") throw new Error("Choose an approved WhatsApp template");
    assertTemplateMapping(template, config.templateParams || []);

    const [row] = await db.insert(whatsappCampaignAutomations).values({
      businessAccountId,
      name: config.name,
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
    }).returning();
    return row;
  },

  async update(businessAccountId: string, id: string, input: AutomationInput) {
    const existing = await this.get(businessAccountId, id);
    if (!existing) return undefined;
    const config = cleanConfig({ ...existing, ...input });
    const [template] = await db.select().from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, config.templateId), eq(whatsappTemplates.businessAccountId, businessAccountId)))
      .limit(1);
    if (!template || template.status !== "approved") throw new Error("Choose an approved WhatsApp template");
    assertTemplateMapping(template, config.templateParams || []);
    const [row] = await db.update(whatsappCampaignAutomations).set({
      ...config,
      updatedAt: new Date(),
    }).where(and(eq(whatsappCampaignAutomations.id, id), eq(whatsappCampaignAutomations.businessAccountId, businessAccountId))).returning();
    return row;
  },

  async preview(businessAccountId: string, id: string, payload: any) {
    const automation = await this.get(businessAccountId, id);
    if (!automation) throw new Error("Automation not found");
    const evaluated = await evaluateUpload(automation, payload);
    return {
      targetDate: evaluated.targetDate,
      summary: evaluated.summary,
      invalid: evaluated.invalid,
      previewRecipients: evaluated.candidates.slice(0, 25).map(candidate => ({
        rowNumber: candidate.rowNumber,
        recordKey: candidate.recordKey,
        phone: candidate.phone,
        name: candidate.name,
        params: (automation.templateParams || []).map(value => resolvePreviewParam(value, candidate)),
      })),
    };
  },

  async createRun(businessAccountId: string, id: string, payload: any, sourceFileName: string) {
    const automation = await this.get(businessAccountId, id);
    if (!automation) throw new Error("Automation not found");
    if (!automation.enabled) throw new Error("This automation is paused");
    const [template] = await db.select().from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, automation.templateId), eq(whatsappTemplates.businessAccountId, businessAccountId)))
      .limit(1);
    if (!template || template.status !== "approved") throw new Error("The selected template is no longer approved");
    assertTemplateMapping(template, automation.templateParams || []);

    const evaluated = await evaluateUpload(automation, payload);
    if (evaluated.candidates.length === 0) {
      throw new Error("No eligible recipients were found. Check the date rule, status filter, and duplicate history.");
    }

    const scheduledAt = nextScheduledAt(automation);
    const automatic = automation.sendMode === "automatic";
    const safeFileName = String(sourceFileName || "spreadsheet").slice(0, 200);
    const result = await db.transaction(async tx => {
      const [group] = await tx.insert(contactGroups).values({
        businessAccountId,
        name: `${automation.name} — ${dateInTimezone(automation.timezone)} (${safeFileName})`.slice(0, 250),
        description: `Generated from spreadsheet automation "${automation.name}"`,
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
        templateId: automation.templateId,
        templateParams: automation.templateParams,
        groupIds: [group.id],
        status: automatic ? "scheduled" : "draft",
        scheduledAt: automatic ? scheduledAt : null,
        aiEnabled: "false",
      }).returning();

      const [run] = await tx.insert(whatsappCampaignAutomationRuns).values({
        automationId: automation.id,
        businessAccountId,
        campaignId: campaign.id,
        contactGroupId: group.id,
        sourceFileName: safeFileName,
        status: automatic ? "scheduled" : "awaiting_review",
        scheduledAt: automatic ? scheduledAt : null,
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
    const scheduledAt = nextScheduledAt(automation);
    const updated = await db.transaction(async tx => {
      const contacts = await tx.select({
        phone: contactGroupContacts.phone,
        name: contactGroupContacts.name,
        attributes: contactGroupContacts.attributes,
      }).from(contactGroupContacts)
        .where(and(
          eq(contactGroupContacts.groupId, run.contactGroupId!),
          eq(contactGroupContacts.businessAccountId, businessAccountId),
        ));
      const dispatches = contacts.map(contact => ({
        automationId,
        businessAccountId,
        runId: run.id,
        recordKey: recordKeyForContact(automation, contact),
      }));
      if (dispatches.some(dispatch => !dispatch.recordKey)) {
        throw new Error("This run has a blank record key and cannot be scheduled");
      }
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
    const [run] = await db.select().from(whatsappCampaignAutomationRuns)
      .where(and(
        eq(whatsappCampaignAutomationRuns.id, runId),
        eq(whatsappCampaignAutomationRuns.automationId, automationId),
        eq(whatsappCampaignAutomationRuns.businessAccountId, businessAccountId),
      )).limit(1);
    if (!run) return false;
    if (!["awaiting_review", "scheduled"].includes(run.status)) throw new Error("This run can no longer be cancelled");
    const campaign = run.campaignId
      ? await db.select().from(marketingCampaigns)
        .where(and(eq(marketingCampaigns.id, run.campaignId), eq(marketingCampaigns.businessAccountId, businessAccountId)))
        .then(rows => rows[0])
      : null;
    if (campaign && !["draft", "scheduled"].includes(campaign.status)) {
      throw new Error(`This run's campaign is already ${campaign.status} and can no longer be cancelled`);
    }
    await db.transaction(async tx => {
      if (run.campaignId) {
        await tx.update(marketingCampaigns).set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(marketingCampaigns.id, run.campaignId), eq(marketingCampaigns.businessAccountId, businessAccountId)));
      }
      await tx.delete(whatsappCampaignAutomationDispatches)
        .where(and(
          eq(whatsappCampaignAutomationDispatches.runId, run.id),
          eq(whatsappCampaignAutomationDispatches.businessAccountId, businessAccountId),
        ));
      await tx.update(whatsappCampaignAutomationRuns).set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(whatsappCampaignAutomationRuns.id, run.id));
    });
    return true;
  },
};