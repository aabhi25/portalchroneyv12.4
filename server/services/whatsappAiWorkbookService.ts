import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import OpenAI from "openai";
import { db } from "../db";
import {
  businessAccounts,
  marketingCampaignRecipients,
  marketingCampaigns,
  whatsappAiWorkbookCampaignLinks,
  whatsappAiWorkbookVersions,
  whatsappAiWorkbooks,
  type AiWorkbookCampaignResultMapping,
  type AiWorkbookColumn,
  type AiWorkbookRow,
  type AiWorkbookSheet,
  type ReplyClassification,
} from "@shared/schema";
import { contactGroupService, normalizePhone } from "./contactGroupService";
import { safeDecrypt } from "./encryptionService";

const MAX_SHEETS = 1;
const MAX_COLUMNS = 100;
const MAX_ROWS = 50_000;
const MAX_RESULT_MAPPINGS = 20;

export const WORKBOOK_RESULT_FIELDS = [
  { value: "outcome_label", label: "Reply outcome", formats: ["text"] },
  { value: "outcome_key", label: "Outcome code", formats: ["text"] },
  { value: "delivery_status", label: "Delivery status", formats: ["text"] },
  { value: "callback_required", label: "Callback required", formats: ["yes_no", "text"] },
  { value: "callback_reason", label: "Callback reason", formats: ["text"] },
  { value: "customer_feedback", label: "Customer feedback", formats: ["text"] },
  { value: "reply_count", label: "Reply count", formats: ["number", "text"] },
  { value: "first_reply_at", label: "First reply date", formats: ["date", "iso_date", "text"] },
  { value: "classified_at", label: "Classified date", formats: ["date", "iso_date", "text"] },
] as const;

const RESULT_FIELD_NAMES = new Set(WORKBOOK_RESULT_FIELDS.map(field => field.value));
const RESULT_FORMATS = new Set<AiWorkbookCampaignResultMapping["format"]>(["text", "yes_no", "iso_date", "date", "number"]);

function isCaptureField(source: string) {
  return /^capture:[a-z][a-z0-9_]{0,79}$/i.test(source);
}

function normalizeResultMappings(raw: unknown, sheet: AiWorkbookSheet): AiWorkbookCampaignResultMapping[] {
  if (!Array.isArray(raw)) throw new Error("Result mappings must be a list");
  if (raw.length > MAX_RESULT_MAPPINGS) throw new Error(`Use at most ${MAX_RESULT_MAPPINGS} result mappings`);
  const columns = new Set(sheet.columns.map(column => column.key));
  const destinations = new Set<string>();

  return raw.map((item: any, index) => {
    const destinationColumnKey = String(item?.destinationColumnKey || "").trim();
    const source = String(item?.source || "").trim();
    const format = String(item?.format || "text") as AiWorkbookCampaignResultMapping["format"];
    const overwrite = item?.overwrite === "always" ? "always" : "if_empty";
    if (!destinationColumnKey || !columns.has(destinationColumnKey)) {
      throw new Error(`Result mapping ${index + 1} needs a column from this sheet`);
    }
    if (["name", "phone"].includes(destinationColumnKey)) {
      throw new Error("Name and phone columns cannot be overwritten by campaign results");
    }
    if (destinations.has(destinationColumnKey)) {
      throw new Error(`Only one campaign result can write to "${destinationColumnKey}"`);
    }
    destinations.add(destinationColumnKey);
    if (!RESULT_FIELD_NAMES.has(source as any) && !isCaptureField(source)) {
      throw new Error(`Result mapping ${index + 1} uses an unsupported campaign field`);
    }
    if (!RESULT_FORMATS.has(format)) throw new Error(`Result mapping ${index + 1} has an unsupported format`);
    return { destinationColumnKey, source: source as AiWorkbookCampaignResultMapping["source"], format, overwrite };
  });
}

function suggestedSourceForLabel(label: string): AiWorkbookCampaignResultMapping["source"] | null {
  const value = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/(callback reason|call reason)/.test(value)) return "callback_reason";
  if (/(delivery|sent status|message status)/.test(value)) return "delivery_status";
  if (/(callback|call back|follow up|required action)/.test(value)) return "callback_required";
  if (/(feedback|customer response|reply text|response text)/.test(value)) return "customer_feedback";
  if (/(reply count|responses count)/.test(value)) return "reply_count";
  if (/(last contacted|first reply|reply date|contact date)/.test(value)) return "first_reply_at";
  if (/(classification date|classified date)/.test(value)) return "classified_at";
  if (/(outcome code|result code|status code)/.test(value)) return "outcome_key";
  if (/(result|output|outcome|disposition|payment status|reply status|status)/.test(value)) return "outcome_label";
  return null;
}

function heuristicResultMappings(sheet: AiWorkbookSheet): AiWorkbookCampaignResultMapping[] {
  const proposals: AiWorkbookCampaignResultMapping[] = [];
  for (const column of sheet.columns) {
    if (["name", "phone"].includes(column.key)) continue;
    const source = suggestedSourceForLabel(column.label);
    if (!source || proposals.some(proposal => proposal.destinationColumnKey === column.key)) continue;
    const format: AiWorkbookCampaignResultMapping["format"] =
      source === "callback_required" ? "yes_no"
        : source === "reply_count" ? "number"
          : ["first_reply_at", "classified_at"].includes(source) ? "date"
            : "text";
    proposals.push({ destinationColumnKey: column.key, source, format, overwrite: "if_empty" });
  }
  return proposals;
}

function formatResultValue(value: unknown, format: AiWorkbookCampaignResultMapping["format"]): string | number | boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (format === "yes_no") return value === true || value === "true" ? "Yes" : "No";
  if (format === "number") return typeof value === "number" ? value : Number(value);
  if ((format === "date" || format === "iso_date") && value instanceof Date) {
    return format === "date" ? value.toISOString().slice(0, 10) : value.toISOString();
  }
  return cell(value);
}

function canReplaceResultCell(row: AiWorkbookRow, key: string, overwrite: AiWorkbookCampaignResultMapping["overwrite"]) {
  if (overwrite === "always") return true;
  const current = row.values[key];
  if (current === null || current === undefined || String(current).trim() === "") return true;
  const previousAi = row.aiValues?.[key];
  return previousAi !== undefined && String(previousAi) === String(current);
}

function cell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function keyFor(label: string, used: Set<string>): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "column";
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
  used.add(key);
  return key;
}

function column(
  key: string,
  label: string,
  source: AiWorkbookColumn["source"],
  editable = source === "operator",
  type: AiWorkbookColumn["type"] = "text",
): AiWorkbookColumn {
  return { key, label, source, editable, type };
}

function validateSheets(input: unknown): AiWorkbookSheet[] {
  if (!Array.isArray(input) || input.length !== 1) throw new Error("A workbook must have exactly one sheet");
  if (input.length > MAX_SHEETS) throw new Error(`A workbook can have exactly ${MAX_SHEETS} sheet`);

  let rowCount = 0;
  const sheetIds = new Set<string>();
  return input.map((raw: any, sheetIndex) => {
    if (!raw || typeof raw !== "object") throw new Error(`Sheet ${sheetIndex + 1} is invalid`);
    const id = String(raw.id || randomUUID());
    if (sheetIds.has(id)) throw new Error("Workbook sheet IDs must be unique");
    sheetIds.add(id);

    const name = String(raw.name || `Sheet ${sheetIndex + 1}`).trim().slice(0, 80);
    const kind = ["recipients", "outcomes", "custom"].includes(raw.kind) ? raw.kind : "custom";
    if (!Array.isArray(raw.columns) || raw.columns.length === 0) throw new Error(`${name} has no columns`);
    if (raw.columns.length > MAX_COLUMNS) throw new Error(`${name} has more than ${MAX_COLUMNS} columns`);

    const columnKeys = new Set<string>();
    const columns: AiWorkbookColumn[] = raw.columns.map((c: any, columnIndex: number) => {
      const key = String(c?.key || "").trim();
      if (!key) throw new Error(`${name}, column ${columnIndex + 1} has no key`);
      if (columnKeys.has(key)) throw new Error(`${name} has duplicate column key "${key}"`);
      columnKeys.add(key);
      return {
        key,
        label: String(c.label || key).trim().slice(0, 120),
        type: ["text", "number", "date", "boolean"].includes(c.type) ? c.type : "text",
        source: ["system", "ai", "operator"].includes(c.source) ? c.source : "operator",
        editable: c.editable !== false,
        // Invalid/unknown mappings are silently dropped rather than rejected,
        // so a stale or hand-edited mapping never blocks saving the sheet.
        campaignMapping: normalizeColumnMapping(c.campaignMapping),
      };
    });

    if (!Array.isArray(raw.rows)) throw new Error(`${name} has invalid rows`);
    rowCount += raw.rows.length;
    if (rowCount > MAX_ROWS) throw new Error(`A workbook can have at most ${MAX_ROWS.toLocaleString()} rows`);

    const rowIds = new Set<string>();
    const rows: AiWorkbookRow[] = raw.rows.map((r: any) => {
      const rowId = String(r?.id || randomUUID());
      if (rowIds.has(rowId)) throw new Error(`${name} has duplicate row ID "${rowId}"`);
      rowIds.add(rowId);
      const values: AiWorkbookRow["values"] = {};
      for (const key of Array.from(columnKeys)) values[key] = cell(r?.values?.[key]);
      return {
        id: rowId,
        sourceRecipientId: r?.sourceRecipientId ? String(r.sourceRecipientId) : undefined,
        values,
        aiValues: r?.aiValues && typeof r.aiValues === "object"
          ? Object.fromEntries(Object.entries(r.aiValues).map(([k, v]) => [k, cell(v)]))
          : undefined,
        updatedAt: r?.updatedAt ? String(r.updatedAt) : new Date().toISOString(),
      };
    });

    return { id, name, kind, columns, rows };
  });
}

type CampaignRecipientRow = typeof marketingCampaignRecipients.$inferSelect;

/**
 * Shared campaign+recipient load used by both the full auto-generated sheet
 * builder and the slim identity-only sheet used for custom-column linking.
 */
async function loadCampaignRecipientData(businessAccountId: string, campaignId: string) {
  const [campaign] = await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.businessAccountId, businessAccountId)))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found");

  const recipients = await db
    .select()
    .from(marketingCampaignRecipients)
    .where(and(
      eq(marketingCampaignRecipients.campaignId, campaignId),
      eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
    ))
    .orderBy(asc(marketingCampaignRecipients.createdAt));

  if (recipients.length > MAX_ROWS) {
    throw new Error(`This campaign has more than ${MAX_ROWS.toLocaleString()} recipients. Filter or split it before creating a workbook.`);
  }

  const classifications = (campaign.replyClassifications || []) as ReplyClassification[];
  const outcomeLabels = new Map(classifications.map(c => [c.key, c.label || c.key]));
  const captureFields: { key: string; label: string; type: AiWorkbookColumn["type"] }[] = [];
  const seenCapture = new Set<string>();
  for (const classification of classifications) {
    for (const field of classification.captureFields || []) {
      if (seenCapture.has(field.fieldKey)) continue;
      seenCapture.add(field.fieldKey);
      captureFields.push({
        key: field.fieldKey,
        label: field.fieldLabel || field.fieldKey,
        type: field.fieldType === "date" || field.fieldType === "boolean"
          ? field.fieldType
          : "text",
      });
    }
  }
  return { campaign, recipients, classifications, outcomeLabels, captureFields };
}

/** Compute a single campaign-defined field's value for one recipient, shared by result-sync and column mapping. */
function campaignFieldValue(recipient: CampaignRecipientRow, source: AiWorkbookCampaignResultMapping["source"], outcomeLabels: Map<string, string>) {
  if (source === "outcome_label") {
    return recipient.primaryClassification ? outcomeLabels.get(recipient.primaryClassification) || recipient.primaryClassification : null;
  }
  if (source === "outcome_key") return recipient.primaryClassification || null;
  if (source === "delivery_status") return recipient.status;
  if (source === "callback_required") return recipient.callbackRequired;
  if (source === "callback_reason") return recipient.callbackReason || null;
  if (source === "customer_feedback") return recipient.customerFeedback || null;
  if (source === "reply_count") return recipient.replyCount;
  if (source === "first_reply_at") return recipient.firstReplyAt;
  if (source === "classified_at") return recipient.classifiedAt;
  if (source.startsWith("capture:")) return (recipient.dispositionData || {})[source.slice("capture:".length)] || null;
  return null;
}

function normalizeColumnMapping(raw: unknown): { source: AiWorkbookCampaignResultMapping["source"]; format: AiWorkbookCampaignResultMapping["format"] } | null {
  if (raw === null || raw === undefined) return null;
  const source = String((raw as any)?.source || "").trim();
  const format = String((raw as any)?.format || "text") as AiWorkbookCampaignResultMapping["format"];
  if (!source || (!RESULT_FIELD_NAMES.has(source as any) && !isCaptureField(source))) return null;
  if (!RESULT_FORMATS.has(format)) return null;
  return { source: source as AiWorkbookCampaignResultMapping["source"], format };
}

/**
 * Re-apply each column's stored campaign-field mapping to rows that are
 * still linked to a campaign recipient (by sourceRecipientId). Rows added
 * by hand have no recipient behind them and are left untouched.
 */
function applyColumnMappings(sheet: AiWorkbookSheet, recipientsById: Map<string, CampaignRecipientRow>, outcomeLabels: Map<string, string>): AiWorkbookSheet {
  const mappedColumns = sheet.columns.filter(c => c.campaignMapping);
  if (mappedColumns.length === 0) return sheet;
  return {
    ...sheet,
    rows: sheet.rows.map(row => {
      const recipient = row.sourceRecipientId ? recipientsById.get(row.sourceRecipientId) : undefined;
      if (!recipient) return row;
      const values = { ...row.values };
      for (const col of mappedColumns) {
        values[col.key] = formatResultValue(campaignFieldValue(recipient, col.campaignMapping!.source, outcomeLabels), col.campaignMapping!.format);
      }
      return { ...row, values };
    }),
  };
}

/** Slim base sheet for a custom-linked workbook: only recipient identity, no auto-generated AI/system columns. */
async function buildIdentitySheet(businessAccountId: string, campaignId: string): Promise<{ sheet: AiWorkbookSheet; recipientsById: Map<string, CampaignRecipientRow>; outcomeLabels: Map<string, string> }> {
  const { recipients, outcomeLabels } = await loadCampaignRecipientData(businessAccountId, campaignId);
  const recipientsById = new Map(recipients.map(r => [r.id, r]));
  const sheet: AiWorkbookSheet = {
    id: "campaign-data",
    name: "Campaign data",
    kind: "custom",
    columns: [column("name", "Name", "system", false), column("phone", "Phone", "system", false)],
    rows: recipients.map(recipient => ({
      id: recipient.id,
      sourceRecipientId: recipient.id,
      values: { name: recipient.name || "", phone: recipient.phone },
    })),
  };
  return { sheet, recipientsById, outcomeLabels };
}

async function buildCampaignSheets(businessAccountId: string, campaignId: string): Promise<AiWorkbookSheet[]> {
  const { recipients, outcomeLabels: labels, captureFields: captureKeys } = await loadCampaignRecipientData(businessAccountId, campaignId);
  const attributeKeys = new Set<string>();
  for (const recipient of recipients) {
    for (const key of Object.keys(recipient.attributes || {})) attributeKeys.add(key);
  }

  const usedKeys = new Set([
    "name", "phone", "status", "classification", "classification_label",
    "callback_required", "callback_reason", "customer_feedback", "reply_count",
    "first_reply_at", "classified_at", "owner", "review_status", "team_notes",
    "follow_up_status", "next_action_date",
  ]);
  const attributeKeyMap = new Map<string, string>();
  const attributeColumns = Array.from(attributeKeys).sort().map(key => {
    const workbookKey = keyFor(key, usedKeys);
    attributeKeyMap.set(key, workbookKey);
    return column(workbookKey, key, "system", false);
  });
  const captureKeyMap = new Map<string, string>();
  const captureColumns = captureKeys.map(field => {
    const workbookKey = keyFor(field.key, usedKeys);
    captureKeyMap.set(field.key, workbookKey);
    return column(workbookKey, field.label, "ai", false, field.type);
  });
  const consolidatedColumns: AiWorkbookColumn[] = [
    column("name", "Name", "system", false),
    column("phone", "Phone", "system", false),
    column("status", "Delivery Status", "system", false),
    ...attributeColumns,
    column("classification", "Outcome Key", "ai", false),
    column("classification_label", "Reply Outcome", "ai", false),
    ...captureColumns,
    column("callback_required", "Callback Required", "ai", false, "boolean"),
    column("callback_reason", "Callback Reason", "ai", false),
    column("customer_feedback", "Customer Feedback", "ai", false),
    column("reply_count", "Reply Count", "system", false, "number"),
    column("first_reply_at", "First Reply At", "system", false, "date"),
    column("classified_at", "Classified At", "system", false, "date"),
    column("owner", "Assigned To", "operator", true),
    column("review_status", "Review Status", "operator", true),
    column("team_notes", "Team Notes", "operator", true),
    column("follow_up_status", "Follow-up Status", "operator", true),
    column("next_action_date", "Next Action Date", "operator", true, "date"),
  ];

  const consolidatedRows: AiWorkbookRow[] = recipients.map(recipient => {
    const aiValues: AiWorkbookRow["values"] = {
      classification: recipient.primaryClassification || "",
      classification_label: recipient.primaryClassification
        ? labels.get(recipient.primaryClassification) || recipient.primaryClassification
        : "",
      callback_required: recipient.callbackRequired,
      callback_reason: recipient.callbackReason || "",
      customer_feedback: recipient.customerFeedback || "",
    };
    for (const [sourceKey, workbookKey] of Array.from(captureKeyMap.entries())) {
      aiValues[workbookKey] = (recipient.dispositionData || {})[sourceKey] ?? null;
    }
    return {
      id: recipient.id,
      sourceRecipientId: recipient.id,
      values: {
        name: recipient.name || "",
        phone: recipient.phone,
        status: recipient.status,
        ...Object.fromEntries(Array.from(attributeKeyMap.entries()).map(([sourceKey, workbookKey]) => [
          workbookKey,
          (recipient.attributes || {})[sourceKey] ?? null,
        ])),
        ...aiValues,
        reply_count: recipient.replyCount,
        first_reply_at: recipient.firstReplyAt?.toISOString() || null,
        classified_at: recipient.classifiedAt?.toISOString() || null,
        owner: "",
        review_status: "",
        team_notes: "",
        follow_up_status: "",
        next_action_date: null,
      },
      aiValues,
    };
  });

  return [{
    id: "campaign-data",
    name: "Campaign data",
    kind: "custom",
    columns: consolidatedColumns,
    rows: consolidatedRows,
  }];
}

function mergeOperatorEdits(fresh: AiWorkbookSheet[], previous: AiWorkbookSheet[]): AiWorkbookSheet[] {
  const current = fresh[0];
  if (!current) return [];
  const operatorColumns = new Map<string, AiWorkbookColumn>();
  const oldBySource = new Map<string, AiWorkbookRow>();
  for (const sheet of previous) {
    for (const oldColumn of sheet.columns) {
      if (oldColumn.source === "operator" && !operatorColumns.has(oldColumn.key)) operatorColumns.set(oldColumn.key, oldColumn);
    }
    for (const row of sheet.rows) oldBySource.set(row.sourceRecipientId || row.id, row);
  }
  const extraColumns = Array.from(operatorColumns.values())
    .filter(oldColumn => !current.columns.some(column => column.key === oldColumn.key));
  const allColumns = [...current.columns, ...extraColumns];
  const matched = new Set<AiWorkbookRow>();
  const rows = current.rows.map(row => {
    const prior = oldBySource.get(row.sourceRecipientId || row.id);
    if (!prior) return row;
    matched.add(prior);
    const operatorValues: AiWorkbookRow["values"] = {};
    for (const key of Array.from(operatorColumns.keys())) operatorValues[key] = prior.values[key] ?? null;
    return { ...row, values: { ...row.values, ...operatorValues } };
  });
  // Rows the operator added by hand (no campaign recipient behind them) must
  // survive a refresh — only rows sourced from the campaign are rebuilt.
  const manualLeftovers = previous
    .flatMap(sheet => sheet.rows)
    .filter(row => !row.sourceRecipientId && !matched.has(row))
    .map(row => {
      const values: AiWorkbookRow["values"] = {};
      for (const columnDef of allColumns) values[columnDef.key] = row.values[columnDef.key] ?? null;
      return { ...row, values };
    });
  return [{
    ...current,
    columns: allColumns,
    rows: [...rows, ...manualLeftovers],
  }];
}

/**
 * Tell whether a linked workbook's sheet was built with every campaign
 * column ("full") or with only the Name/Phone identity columns ("custom").
 * No extra flag is stored — the sheet's own column shape is the source of
 * truth, so it can't drift out of sync with what's actually on the sheet.
 */
function detectLinkMode(sheet: AiWorkbookSheet | undefined): "full" | "custom" {
  if (!sheet) return "full";
  const hasExtraSystemOrAiColumn = sheet.columns.some(c => c.source !== "operator" && !["name", "phone"].includes(c.key));
  return hasExtraSystemOrAiColumn ? "full" : "custom";
}

async function latestVersion(workbookId: string, businessAccountId: string) {
  const [version] = await db
    .select()
    .from(whatsappAiWorkbookVersions)
    .where(and(
      eq(whatsappAiWorkbookVersions.workbookId, workbookId),
      eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
    ))
    .orderBy(desc(whatsappAiWorkbookVersions.versionNumber))
    .limit(1);
  return version;
}

export const whatsappAiWorkbookService = {
  async list(businessAccountId: string) {
    const workbooks = await db
      .select()
      .from(whatsappAiWorkbooks)
      .where(and(
        eq(whatsappAiWorkbooks.businessAccountId, businessAccountId),
      ))
      .orderBy(desc(whatsappAiWorkbooks.updatedAt));
    if (workbooks.length === 0) return [];
    const versions = await db
      .select()
      .from(whatsappAiWorkbookVersions)
      .where(and(
        eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
        inArray(whatsappAiWorkbookVersions.workbookId, workbooks.map(w => w.id)),
      ))
      .orderBy(desc(whatsappAiWorkbookVersions.versionNumber));
    const latest = new Map<string, typeof versions[number]>();
    for (const version of versions) if (!latest.has(version.workbookId)) latest.set(version.workbookId, version);
    return workbooks.map(workbook => {
      const version = latest.get(workbook.id);
      const sheets = (version?.sheets || []) as AiWorkbookSheet[];
      return {
        ...workbook,
        latestVersion: version ? {
          id: version.id,
          versionNumber: version.versionNumber,
          revision: version.revision,
          source: version.source,
          rowCount: sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
          sheetCount: sheets.length,
          updatedAt: version.updatedAt,
        } : null,
      };
    });
  },

  async get(businessAccountId: string, id: string) {
    const [workbook] = await db
      .select()
      .from(whatsappAiWorkbooks)
      .where(and(eq(whatsappAiWorkbooks.id, id), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)))
      .limit(1);
    if (!workbook) return undefined;
    const versions = await db
      .select()
      .from(whatsappAiWorkbookVersions)
      .where(and(
        eq(whatsappAiWorkbookVersions.workbookId, id),
        eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
      ))
      .orderBy(desc(whatsappAiWorkbookVersions.versionNumber));
    return {
      ...workbook,
      versions: versions.map(v => ({
        id: v.id,
        versionNumber: v.versionNumber,
        revision: v.revision,
        source: v.source,
        sourceFileName: v.sourceFileName,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })),
      currentVersion: versions[0] || null,
    };
  },

  async suggestResultMappings(
    businessAccountId: string,
    workbookId: string,
    input: { sheetId: string; instruction?: string },
  ) {
    const workbook = await this.get(businessAccountId, workbookId);
    if (!workbook?.currentVersion) throw new Error("Workbook not found");
    const sheet = (workbook.currentVersion.sheets as AiWorkbookSheet[]).find(item => item.id === input.sheetId);
    if (!sheet) throw new Error("Workbook sheet not found");

    const fallback = heuristicResultMappings(sheet);
    const instruction = String(input.instruction || "").trim().slice(0, 2_000);
    if (!instruction) {
      return {
        mappings: fallback,
        mode: "header_suggestions" as const,
        confidence: "low" as const,
        warnings: ["Suggestions are based on column headers only. Review each destination before using it."],
      };
    }

    const [account] = await db
      .select({ openaiApiKey: businessAccounts.openaiApiKey })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId))
      .limit(1);
    const apiKey = account?.openaiApiKey ? safeDecrypt(account.openaiApiKey) : "";
    if (!apiKey) {
      return {
        mappings: fallback,
        mode: "header_suggestions" as const,
        confidence: "low" as const,
        warnings: ["AI suggestions are unavailable for this account, so these are header-based suggestions."],
      };
    }

    try {
      const allowedFields = WORKBOOK_RESULT_FIELDS.map(field => ({
        value: field.value,
        label: field.label,
        formats: field.formats,
      }));
      const completion = await new OpenAI({ apiKey, timeout: 15_000 }).chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You map a user's requested campaign-result write-back into spreadsheet columns.",
              "Return JSON only: {\"mappings\":[{\"destinationColumnKey\":\"...\",\"source\":\"...\",\"format\":\"...\",\"overwrite\":\"if_empty\"}],\"confidence\":\"low|medium|high\",\"warnings\":[\"...\"]}",
              "Only choose destinationColumnKey values supplied in the workbook columns.",
              "Only choose source values supplied in the campaign result fields; never invent values or formulas.",
              "Use at most one mapping per destination. Default overwrite to if_empty.",
              "Do not infer mappings when the user instruction is ambiguous; return fewer mappings instead.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              instruction,
              workbookColumns: sheet.columns.map(column => ({ key: column.key, label: column.label, type: column.type })),
              campaignResultFields: allowedFields,
            }),
          },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
      const mappings = normalizeResultMappings(parsed.mappings || [], sheet);
      const confidence = ["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence as "low" | "medium" | "high" : "medium";
      const warnings = Array.isArray(parsed.warnings)
        ? parsed.warnings.filter((warning: unknown) => typeof warning === "string").map((warning: string) => warning.slice(0, 300)).slice(0, 5)
        : [];
      if (mappings.length === 0) warnings.push("No unambiguous mapping was found. Add a destination manually if you want to sync results.");
      return { mappings, mode: "ai" as const, confidence, warnings };
    } catch (error) {
      console.warn("[AI Workbook] Result mapping suggestion failed; using header suggestions", error);
      return {
        mappings: fallback,
        mode: "header_suggestions" as const,
        confidence: "low" as const,
        warnings: ["AI could not produce a mapping, so these are header-based suggestions."],
      };
    }
  },

  async create(businessAccountId: string, input: { name: string; description?: string; sourceCampaignId?: string | null }) {
    const name = String(input.name || "").trim();
    if (!name) throw new Error("Workbook name is required");
    const sheets = input.sourceCampaignId
      ? await buildCampaignSheets(businessAccountId, input.sourceCampaignId)
      : [{
          id: randomUUID(),
          name: "Sheet 1",
          kind: "custom" as const,
          columns: [column("name", "Name", "operator"), column("phone", "Phone", "operator")],
          rows: [],
        }];
    return db.transaction(async tx => {
      const [workbook] = await tx.insert(whatsappAiWorkbooks).values({
        businessAccountId,
        name,
        description: String(input.description || ""),
        sourceCampaignId: input.sourceCampaignId || null,
      }).returning();
      const [version] = await tx.insert(whatsappAiWorkbookVersions).values({
        workbookId: workbook.id,
        businessAccountId,
        sourceCampaignId: input.sourceCampaignId || null,
        versionNumber: 1,
        source: input.sourceCampaignId ? "campaign" : "manual",
        sheets,
      }).returning();
      return { ...workbook, currentVersion: version, versions: [version] };
    });
  },

  async updateWorkbook(businessAccountId: string, id: string, input: { name?: string; description?: string }) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw new Error("Workbook name is required");
      set.name = name;
    }
    if (input.description !== undefined) set.description = String(input.description);
    const [row] = await db.update(whatsappAiWorkbooks)
      .set(set)
      .where(and(eq(whatsappAiWorkbooks.id, id), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)))
      .returning();
    return row;
  },

  async deleteWorkbook(businessAccountId: string, id: string) {
    return db.transaction(async tx => {
      const [workbook] = await tx
        .select({ id: whatsappAiWorkbooks.id })
        .from(whatsappAiWorkbooks)
        .where(and(
          eq(whatsappAiWorkbooks.id, id),
          eq(whatsappAiWorkbooks.businessAccountId, businessAccountId),
        ))
        .limit(1)
        .for("update");
      if (!workbook) return null;

      // Delete links explicitly before versions because links retain a
      // restrict reference to the version they were created from.
      await tx.delete(whatsappAiWorkbookCampaignLinks).where(and(
        eq(whatsappAiWorkbookCampaignLinks.workbookId, id),
        eq(whatsappAiWorkbookCampaignLinks.businessAccountId, businessAccountId),
      ));
      await tx.delete(whatsappAiWorkbookVersions).where(and(
        eq(whatsappAiWorkbookVersions.workbookId, id),
        eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
      ));
      const [deleted] = await tx.delete(whatsappAiWorkbooks)
        .where(and(
          eq(whatsappAiWorkbooks.id, id),
          eq(whatsappAiWorkbooks.businessAccountId, businessAccountId),
        ))
        .returning({ id: whatsappAiWorkbooks.id });
      return deleted ?? null;
    });
  },

  async saveSheets(businessAccountId: string, workbookId: string, versionId: string, revision: number, sheets: unknown) {
    let normalized = validateSheets(sheets);
    const [current] = await db.select({ sheets: whatsappAiWorkbookVersions.sheets, revision: whatsappAiWorkbookVersions.revision })
      .from(whatsappAiWorkbookVersions)
      .where(and(
        eq(whatsappAiWorkbookVersions.id, versionId),
        eq(whatsappAiWorkbookVersions.workbookId, workbookId),
        eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
      ))
      .limit(1);
    if (!current) throw new Error("Workbook version not found");
    if (current.revision !== revision) throw new Error("This workbook changed in another session. Reload it before saving.");
    const currentSheets = validateSheets(current.sheets);
    if (currentSheets[0] && normalized[0].id !== currentSheets[0].id) {
      normalized = [{ ...normalized[0], id: currentSheets[0].id }];
    }
    const nextById = new Map(normalized.map(sheet => [sheet.id, sheet]));
    for (const previousSheet of currentSheets) {
      const nextSheet = nextById.get(previousSheet.id);
      if (!nextSheet) throw new Error("The workbook must keep its current sheet");
      const nextKeys = new Set(nextSheet.columns.map(column => column.key));
      const removedProtected = previousSheet.columns
        .filter(column => column.source !== "operator" && !nextKeys.has(column.key))
        .map(column => column.label);
      if (removedProtected.length > 0) {
        throw new Error(`These campaign columns cannot be removed: ${removedProtected.join(", ")}`);
      }
    }
    const [updated] = await db.update(whatsappAiWorkbookVersions)
      .set({ sheets: normalized, revision: sql`${whatsappAiWorkbookVersions.revision} + 1`, updatedAt: new Date() })
      .where(and(
        eq(whatsappAiWorkbookVersions.id, versionId),
        eq(whatsappAiWorkbookVersions.workbookId, workbookId),
        eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
        eq(whatsappAiWorkbookVersions.revision, revision),
      ))
      .returning();
    if (!updated) throw new Error("This workbook changed in another session. Reload it before saving.");
    await db.update(whatsappAiWorkbooks)
      .set({ updatedAt: new Date() })
      .where(and(eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)));
    return updated;
  },

  async getVersion(businessAccountId: string, workbookId: string, versionId: string) {
    const [version] = await db.select().from(whatsappAiWorkbookVersions)
      .where(and(
        eq(whatsappAiWorkbookVersions.id, versionId),
        eq(whatsappAiWorkbookVersions.workbookId, workbookId),
        eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
      ))
      .limit(1);
    return version;
  },

  async createVersion(
    businessAccountId: string,
    workbookId: string,
    input: {
      sheets?: unknown;
      source?: string;
      sourceFileName?: string | null;
      expectedCurrentVersionId: string;
      expectedRevision: number;
    },
  ) {
    if (!input.expectedCurrentVersionId || !Number.isInteger(input.expectedRevision)) {
      throw new Error("Current workbook version and revision are required");
    }
    const source = ["manual", "import", "campaign", "campaign_sync"].includes(input.source || "")
      ? input.source!
      : "manual";
    const requestedSheets = input.sheets === undefined ? undefined : validateSheets(input.sheets);
    return db.transaction(async tx => {
      const [workbook] = await tx.select().from(whatsappAiWorkbooks)
        .where(and(eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)))
        .limit(1);
      if (!workbook) throw new Error("Workbook not found");
      const [current] = await tx
        .select()
        .from(whatsappAiWorkbookVersions)
        .where(and(
          eq(whatsappAiWorkbookVersions.workbookId, workbookId),
          eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
        ))
        .orderBy(desc(whatsappAiWorkbookVersions.versionNumber))
        .limit(1)
        .for("update");
      if (!current) throw new Error("Workbook has no version");
      if (current.id !== input.expectedCurrentVersionId || current.revision !== input.expectedRevision) {
        throw new Error("This workbook changed in another session. Reload it before creating a new version.");
      }
      const currentSheets = validateSheets(current.sheets);
      const nextSheets = requestedSheets
        ? [{ ...(requestedSheets as AiWorkbookSheet[])[0], id: currentSheets[0]?.id || (requestedSheets as AiWorkbookSheet[])[0].id }]
        : currentSheets;
      const nextById = new Map(nextSheets.map(sheet => [sheet.id, sheet]));
      for (const previousSheet of currentSheets) {
        const nextSheet = nextById.get(previousSheet.id);
        if (!nextSheet) throw new Error("The workbook must keep its current sheet");
        const nextKeys = new Set(nextSheet.columns.map(column => column.key));
        const removedProtected = previousSheet.columns
          .filter(column => column.source !== "operator" && !nextKeys.has(column.key))
          .map(column => column.label);
        if (removedProtected.length > 0) {
          throw new Error(`These campaign columns cannot be removed: ${removedProtected.join(", ")}`);
        }
      }
      const [version] = await tx.insert(whatsappAiWorkbookVersions).values({
        workbookId,
        businessAccountId,
        sourceCampaignId: workbook.sourceCampaignId,
        versionNumber: current.versionNumber + 1,
        source,
        sourceFileName: input.sourceFileName || null,
        sheets: nextSheets,
      }).returning();
      await tx.update(whatsappAiWorkbooks).set({ updatedAt: new Date() })
        .where(and(eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)));
      return version;
    });
  },

  async restoreVersion(businessAccountId: string, workbookId: string, versionId: string, expectedCurrentVersionId: string, expectedRevision: number) {
    const version = await this.getVersion(businessAccountId, workbookId, versionId);
    if (!version) throw new Error("Workbook version not found");
    return this.createVersion(businessAccountId, workbookId, {
      sheets: version.sheets,
      source: "manual",
      expectedCurrentVersionId,
      expectedRevision,
    });
  },

  /**
   * Link an independent workbook to an existing campaign (or unlink with
   * campaignId = null). Linking rebuilds the sheet from the campaign and
   * merges the workbook's existing data in: rows are matched by normalized
   * phone number, operator columns and their values are preserved, and rows
   * that don't match any campaign recipient are kept at the bottom.
   *
   * mode "full" (default) pulls in every system/AI column the campaign
   * defines. mode "custom" pulls in only Name/Phone so rows exist; every
   * other column is one the user creates and can map to a campaign field.
   */
  async linkToCampaign(
    businessAccountId: string,
    workbookId: string,
    campaignId: string | null,
    expected?: { expectedCurrentVersionId: string; expectedRevision: number },
    mode: "full" | "custom" = "full",
  ) {
    const [workbook] = await db.select().from(whatsappAiWorkbooks)
      .where(and(eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)))
      .limit(1);
    if (!workbook) throw new Error("Workbook not found");

    if (!campaignId) {
      const [updated] = await db.update(whatsappAiWorkbooks)
        .set({ sourceCampaignId: null, updatedAt: new Date() })
        .where(and(eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)))
        .returning();
      return { workbook: updated, version: null };
    }

    if (!expected?.expectedCurrentVersionId || !Number.isInteger(expected.expectedRevision)) {
      throw new Error("Current workbook version and revision are required");
    }
    const identity = mode === "custom" ? await buildIdentitySheet(businessAccountId, campaignId) : null;
    const fresh = identity ? identity.sheet : (await buildCampaignSheets(businessAccountId, campaignId))[0];

    return db.transaction(async tx => {
      const [current] = await tx.select().from(whatsappAiWorkbookVersions)
        .where(and(
          eq(whatsappAiWorkbookVersions.workbookId, workbookId),
          eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
        ))
        .orderBy(desc(whatsappAiWorkbookVersions.versionNumber))
        .limit(1)
        .for("update");
      if (!current) throw new Error("Workbook has no version");
      if (current.id !== expected.expectedCurrentVersionId || current.revision !== expected.expectedRevision) {
        throw new Error("This workbook changed in another session. Reload it before linking.");
      }
      const previous = validateSheets(current.sheets);

      // Keep every operator column. When a key collides with a campaign
      // column, retain it under a new unique key so no values are lost —
      // unless the colliding column is still just empty scaffolding (e.g.
      // the default Name/Phone columns every new workbook starts with):
      // renaming and keeping those would only add pointless blank duplicates.
      const freshSheet = fresh;
      const usedKeys = new Set(freshSheet.columns.map(c => c.key));
      const keptColumns: AiWorkbookColumn[] = [];
      const keyRemap = new Map<string, string>();
      for (const oldColumn of previous[0].columns.filter(c => c.source === "operator")) {
        const newKey = keyFor(oldColumn.key, usedKeys);
        const collided = newKey !== oldColumn.key;
        if (collided && !oldColumn.campaignMapping) {
          const hasData = previous[0].rows.some(row => {
            const v = row.values[oldColumn.key];
            return v !== undefined && v !== null && v !== "";
          });
          if (!hasData) {
            usedKeys.delete(newKey); // free the reserved key; nothing is being kept under it
            continue;
          }
        }
        keyRemap.set(oldColumn.key, newKey);
        keptColumns.push(newKey === oldColumn.key
          ? oldColumn
          : { ...oldColumn, key: newKey, label: `${oldColumn.label} (workbook)` });
      }
      const carriedKeys = Array.from(keyRemap.entries());
      const operatorFreshKeys = freshSheet.columns.filter(c => c.source === "operator").map(c => c.key);

      const previousByPhone = new Map<string, AiWorkbookRow>();
      for (const row of previous[0].rows) {
        const phone = normalizePhone(String(row.values.phone ?? row.values.Phone ?? ""));
        if (phone && !previousByPhone.has(phone)) previousByPhone.set(phone, row);
      }
      const matched = new Set<AiWorkbookRow>();
      const rows = freshSheet.rows.map(row => {
        const prior = previousByPhone.get(normalizePhone(String(row.values.phone || "")));
        if (!prior) return row;
        matched.add(prior);
        const carried: AiWorkbookRow["values"] = {};
        for (const [oldKey, newKey] of carriedKeys) {
          const priorValue = prior.values[oldKey];
          if (priorValue !== undefined && priorValue !== null && priorValue !== "") carried[newKey] = priorValue;
        }
        for (const key of operatorFreshKeys) {
          if (carried[key] !== undefined) continue;
          const priorValue = prior.values[key];
          if (priorValue !== undefined && priorValue !== null && priorValue !== "") carried[key] = priorValue;
        }
        return { ...row, values: { ...row.values, ...carried } };
      });
      const unmatched = previous[0].rows
        .filter(row => !matched.has(row))
        .map(row => {
          const values: AiWorkbookRow["values"] = {};
          for (const columnDef of freshSheet.columns) values[columnDef.key] = row.values[columnDef.key] ?? null;
          for (const [oldKey, newKey] of carriedKeys) values[newKey] = row.values[oldKey] ?? null;
          return { ...row, sourceRecipientId: undefined, values };
        });
      let sheets: AiWorkbookSheet[] = [{
        ...freshSheet,
        id: previous[0].id,
        columns: [...freshSheet.columns, ...keptColumns],
        rows: [...rows, ...unmatched],
      }];
      // Re-linking a workbook whose columns already carry mappings (e.g. it
      // was previously custom-linked) should immediately repopulate them.
      if (identity) sheets = [applyColumnMappings(sheets[0], identity.recipientsById, identity.outcomeLabels)];

      const [updated] = await tx.update(whatsappAiWorkbooks)
        .set({ sourceCampaignId: campaignId, updatedAt: new Date() })
        .where(and(eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)))
        .returning();
      const [version] = await tx.insert(whatsappAiWorkbookVersions).values({
        workbookId,
        businessAccountId,
        sourceCampaignId: campaignId,
        versionNumber: current.versionNumber + 1,
        source: "campaign",
        sheets,
      }).returning();
      return { workbook: updated, version };
    });
  },

  async refreshFromCampaign(businessAccountId: string, workbookId: string) {
    const [workbook] = await db.select().from(whatsappAiWorkbooks)
      .where(and(eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)))
      .limit(1);
    if (!workbook) throw new Error("Workbook not found");
    if (!workbook.sourceCampaignId) throw new Error("This workbook is not linked to a campaign");
    const current = await latestVersion(workbookId, businessAccountId);
    if (!current) throw new Error("Workbook has no version");
    const linkedAsCustom = detectLinkMode(validateSheets(current.sheets)[0]) === "custom";
    let sheets: AiWorkbookSheet[];
    if (linkedAsCustom) {
      const identity = await buildIdentitySheet(businessAccountId, workbook.sourceCampaignId);
      const merged = mergeOperatorEdits([identity.sheet], current.sheets as AiWorkbookSheet[]);
      sheets = [applyColumnMappings(merged[0], identity.recipientsById, identity.outcomeLabels)];
    } else {
      const fresh = await buildCampaignSheets(businessAccountId, workbook.sourceCampaignId);
      sheets = mergeOperatorEdits(fresh, current.sheets as AiWorkbookSheet[]);
    }
    return this.createVersion(businessAccountId, workbookId, {
      sheets,
      source: "campaign",
      expectedCurrentVersionId: current.id,
      expectedRevision: current.revision,
    });
  },

  /** Fields a custom-linked workbook column can be mapped to: the fixed result fields plus this campaign's own capture fields. */
  async listCampaignFields(businessAccountId: string, campaignId: string) {
    const { captureFields } = await loadCampaignRecipientData(businessAccountId, campaignId);
    return {
      fields: WORKBOOK_RESULT_FIELDS,
      captureFields: captureFields.map(f => ({ value: `capture:${f.key}`, label: f.label, formats: f.type === "boolean" ? ["yes_no", "text"] : f.type === "date" ? ["date", "iso_date", "text"] : ["text"] })),
    };
  },

  /**
   * Set (or clear) which campaign-defined field feeds one column of a
   * custom-linked workbook. Setting a mapping immediately populates every
   * row still tied to a campaign recipient; clearing it just stops future
   * auto-updates without erasing the column's current values.
   */
  async mapColumn(
    businessAccountId: string,
    workbookId: string,
    input: { columnKey: string; mapping: { source: string; format: string } | null; expectedCurrentVersionId: string; expectedRevision: number },
  ) {
    if (!input.expectedCurrentVersionId || !Number.isInteger(input.expectedRevision)) {
      throw new Error("Current workbook version and revision are required");
    }
    // Validate the requested mapping against the *specific* field's allowed
    // formats (not just any globally-known format) before touching the DB.
    let mapping: { source: AiWorkbookCampaignResultMapping["source"]; format: AiWorkbookCampaignResultMapping["format"] } | null = null;
    if (input.mapping) {
      // sourceCampaignId is re-verified against the locked workbook row below;
      // this pre-check only needs *a* campaign to resolve field metadata.
      const [precheckWorkbook] = await db.select().from(whatsappAiWorkbooks)
        .where(and(eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)))
        .limit(1);
      if (!precheckWorkbook?.sourceCampaignId) throw new Error("This workbook is not linked to a campaign");
      const { fields, captureFields } = await this.listCampaignFields(businessAccountId, precheckWorkbook.sourceCampaignId);
      const field = [...fields, ...captureFields].find(f => f.value === input.mapping!.source);
      if (!field || !(field.formats as readonly string[]).includes(input.mapping.format)) {
        throw new Error("Unsupported campaign field or format");
      }
      mapping = { source: field.value as AiWorkbookCampaignResultMapping["source"], format: input.mapping.format as AiWorkbookCampaignResultMapping["format"] };
    }

    return db.transaction(async tx => {
      const [workbook] = await tx.select().from(whatsappAiWorkbooks)
        .where(and(eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)))
        .limit(1)
        .for("update");
      if (!workbook) throw new Error("Workbook not found");
      if (!workbook.sourceCampaignId) throw new Error("This workbook is not linked to a campaign");
      const [current] = await tx.select().from(whatsappAiWorkbookVersions)
        .where(and(
          eq(whatsappAiWorkbookVersions.workbookId, workbookId),
          eq(whatsappAiWorkbookVersions.businessAccountId, businessAccountId),
        ))
        .orderBy(desc(whatsappAiWorkbookVersions.versionNumber))
        .limit(1)
        .for("update");
      if (!current) throw new Error("Workbook has no version");
      if (current.id !== input.expectedCurrentVersionId || current.revision !== input.expectedRevision) {
        throw new Error("This workbook changed in another session. Reload it before changing this mapping.");
      }
      const sheet = validateSheets(current.sheets)[0];
      const targetColumn = sheet.columns.find(c => c.key === input.columnKey);
      if (!targetColumn) throw new Error("Column not found");
      if (targetColumn.source !== "operator") throw new Error("Only your own columns can be mapped to a campaign field");

      let nextSheet: AiWorkbookSheet = {
        ...sheet,
        columns: sheet.columns.map(c => c.key === input.columnKey ? { ...c, campaignMapping: mapping } : c),
      };
      if (mapping) {
        const { recipientsById, outcomeLabels } = await buildIdentitySheet(businessAccountId, workbook.sourceCampaignId);
        nextSheet = applyColumnMappings(nextSheet, recipientsById, outcomeLabels);
      }

      const [version] = await tx.insert(whatsappAiWorkbookVersions).values({
        workbookId,
        businessAccountId,
        sourceCampaignId: workbook.sourceCampaignId,
        versionNumber: current.versionNumber + 1,
        source: "campaign_sync",
        sheets: [nextSheet],
      }).returning();
      await tx.update(whatsappAiWorkbooks).set({ updatedAt: new Date() })
        .where(and(eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)));
      return version;
    });
  },

  async duplicate(businessAccountId: string, workbookId: string, name?: string) {
    const current = await this.get(businessAccountId, workbookId);
    if (!current || !current.currentVersion) throw new Error("Workbook not found");
    const sheets = validateSheets(current.currentVersion.sheets);
    return db.transaction(async tx => {
      const [copy] = await tx.insert(whatsappAiWorkbooks).values({
        businessAccountId,
        name: String(name || `${current.name} (copy)`).trim(),
        description: current.description || "",
        sourceCampaignId: current.sourceCampaignId,
      }).returning();
      const [version] = await tx.insert(whatsappAiWorkbookVersions).values({
        workbookId: copy.id,
        businessAccountId,
        sourceCampaignId: current.sourceCampaignId,
        versionNumber: 1,
        source: "duplicate",
        sheets,
      }).returning();
      return { ...copy, currentVersion: version };
    });
  },

  async exportXlsx(businessAccountId: string, workbookId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const workbook = await this.get(businessAccountId, workbookId);
    if (!workbook?.currentVersion) throw new Error("Workbook not found");
    const XLSX = await import("xlsx");
    const output = XLSX.utils.book_new();
    for (const sheet of workbook.currentVersion.sheets as AiWorkbookSheet[]) {
      const rows = sheet.rows.map(row => {
        const out: Record<string, unknown> = {
          _row_id: row.id,
          _source_recipient_id: row.sourceRecipientId || "",
        };
        for (const col of sheet.columns) out[col.label] = row.values[col.key] ?? "";
        return out;
      });
      const ws = XLSX.utils.json_to_sheet(rows, { header: ["_row_id", "_source_recipient_id", ...sheet.columns.map(c => c.label)] });
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: range.s, e: { r: range.s.r, c: range.e.c } }) };
      ws["!cols"] = [{ hidden: true }, { hidden: true }, ...sheet.columns.map(c => ({ wch: Math.min(40, Math.max(12, c.label.length + 2)) }))];
      XLSX.utils.book_append_sheet(output, ws, sheet.name.slice(0, 31) || "Sheet");
    }
    const safeName = workbook.name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "ai-workbook";
    return {
      buffer: XLSX.write(output, { type: "buffer", bookType: "xlsx" }),
      fileName: `${safeName}.xlsx`,
    };
  },

  async createAudience(
    businessAccountId: string,
    workbookId: string,
    input: {
      sheetId: string;
      rowIds?: string[];
      phoneColumn?: string;
      nameColumn?: string;
      groupName?: string;
      resultMappings?: unknown;
    },
  ) {
    const workbook = await this.get(businessAccountId, workbookId);
    if (!workbook?.currentVersion) throw new Error("Workbook not found");
    const sheet = (workbook.currentVersion.sheets as AiWorkbookSheet[]).find(s => s.id === input.sheetId);
    if (!sheet) throw new Error("Workbook sheet not found");
    const phoneColumn = input.phoneColumn || "phone";
    const nameColumn = input.nameColumn || "name";
    if (!sheet.columns.some(c => c.key === phoneColumn)) throw new Error("Choose a valid phone column");
    const resultMappings = input.resultMappings === undefined
      ? []
      : normalizeResultMappings(input.resultMappings, sheet);
    const selected = input.rowIds?.length ? new Set(input.rowIds.map(String)) : null;
    const rows = selected ? sheet.rows.filter(row => selected.has(row.id)) : sheet.rows;
    if (rows.length === 0) throw new Error("Select at least one workbook row");
    if (rows.length > 10_000) throw new Error("A workbook audience can contain at most 10,000 rows");

    const valid = new Map<string, AiWorkbookRow>();
    for (const row of rows) {
      const phone = normalizePhone(String(row.values[phoneColumn] || ""));
      if (phone && phone.length >= 7) valid.set(phone, row);
    }
    if (valid.size === 0) throw new Error("None of the selected rows has a valid phone number");

    const group = await contactGroupService.create(
      businessAccountId,
      String(input.groupName || `${workbook.name} audience`).trim(),
      `Created from AI Workbook "${workbook.name}", version ${workbook.currentVersion.versionNumber}`,
    );
    try {
      for (const [phone, row] of Array.from(valid.entries())) {
        const attributes: Record<string, string> = {};
        for (const col of sheet.columns) {
          if (col.key === phoneColumn || col.key === nameColumn) continue;
          const value = row.values[col.key];
          if (value !== null && value !== undefined && String(value).trim() !== "") attributes[col.key] = String(value);
        }
        await contactGroupService.addContact(
          businessAccountId,
          group.id,
          phone,
          String(row.values[nameColumn] || ""),
          attributes,
        );
      }
      const rowIdsByPhone = Object.fromEntries(
        Array.from(valid.entries()).map(([phone, row]) => [phone, row.id]),
      );
      const [resultSync] = resultMappings.length > 0
        ? await db.insert(whatsappAiWorkbookCampaignLinks).values({
            businessAccountId,
            workbookId,
            workbookVersionId: workbook.currentVersion.id,
            contactGroupId: group.id,
            sheetId: sheet.id,
            mappings: resultMappings,
            rowIdsByPhone,
          }).returning()
        : [];
      return {
        group,
        selectedRows: rows.length,
        importedContacts: valid.size,
        skippedRows: rows.length - valid.size,
        resultSync: resultSync ? {
          id: resultSync.id,
          status: resultSync.status,
          mappings: resultSync.mappings,
        } : null,
      };
    } catch (error) {
      await contactGroupService.remove(businessAccountId, group.id);
      throw error;
    }
  },

  async listResultSyncs(businessAccountId: string, workbookId: string) {
    const links = await db
      .select()
      .from(whatsappAiWorkbookCampaignLinks)
      .where(and(
        eq(whatsappAiWorkbookCampaignLinks.businessAccountId, businessAccountId),
        eq(whatsappAiWorkbookCampaignLinks.workbookId, workbookId),
      ))
      .orderBy(desc(whatsappAiWorkbookCampaignLinks.createdAt));
    const campaignIds = links.map(link => link.campaignId).filter((id): id is string => Boolean(id));
    const campaigns = campaignIds.length
      ? await db.select({ id: marketingCampaigns.id, name: marketingCampaigns.name, status: marketingCampaigns.status })
        .from(marketingCampaigns)
        .where(and(
          eq(marketingCampaigns.businessAccountId, businessAccountId),
          inArray(marketingCampaigns.id, campaignIds),
        ))
      : [];
    const campaignById = new Map(campaigns.map(campaign => [campaign.id, campaign]));
    return links.map(link => ({
      ...link,
      campaign: link.campaignId ? campaignById.get(link.campaignId) || null : null,
    }));
  },

  async attachCampaignToAudienceGroups(businessAccountId: string, campaignId: string, groupIds: string[]) {
    const uniqueGroupIds = Array.from(new Set(groupIds.filter(Boolean)));
    if (uniqueGroupIds.length === 0) return 0;
    const links = await db
      .select({ id: whatsappAiWorkbookCampaignLinks.id })
      .from(whatsappAiWorkbookCampaignLinks)
      .where(and(
        eq(whatsappAiWorkbookCampaignLinks.businessAccountId, businessAccountId),
        inArray(whatsappAiWorkbookCampaignLinks.contactGroupId, uniqueGroupIds),
      ));
    if (links.length === 0) return 0;
    const updated = await db
      .update(whatsappAiWorkbookCampaignLinks)
      .set({ campaignId, status: "campaign_attached", updatedAt: new Date() })
      .where(and(
        eq(whatsappAiWorkbookCampaignLinks.businessAccountId, businessAccountId),
        inArray(whatsappAiWorkbookCampaignLinks.id, links.map(link => link.id)),
      ))
      .returning({ id: whatsappAiWorkbookCampaignLinks.id });
    return updated.length;
  },

  async syncCampaignResults(businessAccountId: string, workbookId: string, linkId: string) {
    const [link] = await db
      .select()
      .from(whatsappAiWorkbookCampaignLinks)
      .where(and(
        eq(whatsappAiWorkbookCampaignLinks.id, linkId),
        eq(whatsappAiWorkbookCampaignLinks.workbookId, workbookId),
        eq(whatsappAiWorkbookCampaignLinks.businessAccountId, businessAccountId),
      ))
      .limit(1);
    if (!link) throw new Error("Campaign result link not found");
    if (!link.campaignId) throw new Error("Create the campaign before syncing its results");

    const workbook = await this.get(businessAccountId, workbookId);
    if (!workbook?.currentVersion) throw new Error("Workbook not found");
    const sheets = JSON.parse(JSON.stringify(workbook.currentVersion.sheets || [])) as AiWorkbookSheet[];
    const sheet = sheets.find(item => item.id === link.sheetId);
    if (!sheet) throw new Error("The source workbook sheet no longer exists");
    const mappings = normalizeResultMappings(link.mappings, sheet);

    const [campaign] = await db
      .select({ replyClassifications: marketingCampaigns.replyClassifications })
      .from(marketingCampaigns)
      .where(and(eq(marketingCampaigns.id, link.campaignId), eq(marketingCampaigns.businessAccountId, businessAccountId)))
      .limit(1);
    if (!campaign) throw new Error("Campaign not found");
    const outcomeLabels = new Map(
      ((campaign.replyClassifications || []) as ReplyClassification[]).map(item => [item.key, item.label || item.key]),
    );
    const recipients = await db
      .select()
      .from(marketingCampaignRecipients)
      .where(and(
        eq(marketingCampaignRecipients.campaignId, link.campaignId),
        eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
      ));
    const rowsById = new Map(sheet.rows.map(row => [row.id, row]));
    const rowIdsByPhone = (link.rowIdsByPhone || {}) as Record<string, string>;
    let updatedRows = 0;
    let changedCells = 0;

    const valueFor = (recipient: typeof recipients[number], source: AiWorkbookCampaignResultMapping["source"]) =>
      campaignFieldValue(recipient, source, outcomeLabels);

    for (const recipient of recipients) {
      const rowId = rowIdsByPhone[normalizePhone(String(recipient.phone || ""))];
      const row = rowId ? rowsById.get(rowId) : undefined;
      if (!row) continue;
      let rowChanged = false;
      for (const mapping of mappings) {
        const nextValue = formatResultValue(valueFor(recipient, mapping.source), mapping.format);
        if (nextValue === null || !canReplaceResultCell(row, mapping.destinationColumnKey, mapping.overwrite)) continue;
        const currentValue = row.values[mapping.destinationColumnKey];
        const priorAiValue = row.aiValues?.[mapping.destinationColumnKey];
        if (String(currentValue ?? "") === String(nextValue) && String(priorAiValue ?? "") === String(nextValue)) continue;
        row.values[mapping.destinationColumnKey] = nextValue;
        row.aiValues = { ...(row.aiValues || {}), [mapping.destinationColumnKey]: nextValue };
        row.updatedAt = new Date().toISOString();
        rowChanged = true;
        changedCells++;
      }
      if (rowChanged) updatedRows++;
    }

    if (changedCells === 0) {
      await db.update(whatsappAiWorkbookCampaignLinks)
        .set({ status: "campaign_attached", syncedRowCount: 0, updatedAt: new Date() })
        .where(eq(whatsappAiWorkbookCampaignLinks.id, link.id));
      return { updatedRows: 0, changedCells: 0, version: null };
    }

    const version = await this.createVersion(businessAccountId, workbookId, {
      sheets,
      source: "campaign_sync",
      expectedCurrentVersionId: workbook.currentVersion.id,
      expectedRevision: workbook.currentVersion.revision,
    });
    await db.update(whatsappAiWorkbookCampaignLinks)
      .set({
        status: "synced",
        lastSyncedAt: new Date(),
        lastSyncedVersionId: version.id,
        syncedRowCount: updatedRows,
        updatedAt: new Date(),
      })
      .where(eq(whatsappAiWorkbookCampaignLinks.id, link.id));
    return { updatedRows, changedCells, version };
  },
};
