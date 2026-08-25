import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  marketingCampaignRecipients,
  marketingCampaigns,
  whatsappAiWorkbookVersions,
  whatsappAiWorkbooks,
  type AiWorkbookColumn,
  type AiWorkbookRow,
  type AiWorkbookSheet,
  type ReplyClassification,
} from "@shared/schema";
import { contactGroupService, normalizePhone } from "./contactGroupService";

const MAX_SHEETS = 20;
const MAX_COLUMNS = 100;
const MAX_ROWS = 50_000;

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
  if (!Array.isArray(input) || input.length === 0) throw new Error("At least one workbook tab is required");
  if (input.length > MAX_SHEETS) throw new Error(`A workbook can have at most ${MAX_SHEETS} tabs`);

  let rowCount = 0;
  const sheetIds = new Set<string>();
  return input.map((raw: any, sheetIndex) => {
    if (!raw || typeof raw !== "object") throw new Error(`Tab ${sheetIndex + 1} is invalid`);
    const id = String(raw.id || randomUUID());
    if (sheetIds.has(id)) throw new Error("Workbook tab IDs must be unique");
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

async function buildCampaignSheets(businessAccountId: string, campaignId: string): Promise<AiWorkbookSheet[]> {
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
  const labels = new Map(classifications.map(c => [c.key, c.label || c.key]));
  const attributeKeys = new Set<string>();
  for (const recipient of recipients) {
    for (const key of Object.keys(recipient.attributes || {})) attributeKeys.add(key);
  }
  const captureKeys: { key: string; label: string; type: AiWorkbookColumn["type"] }[] = [];
  const seenCapture = new Set<string>();
  for (const classification of classifications) {
    for (const field of classification.captureFields || []) {
      if (seenCapture.has(field.fieldKey)) continue;
      seenCapture.add(field.fieldKey);
      captureKeys.push({
        key: field.fieldKey,
        label: field.fieldLabel || field.fieldKey,
        type: field.fieldType === "date" || field.fieldType === "boolean"
          ? field.fieldType
          : "text",
      });
    }
  }

  const recipientColumns: AiWorkbookColumn[] = [
    column("name", "Name", "system", false),
    column("phone", "Phone", "system", false),
    column("status", "Delivery Status", "system", false),
    ...Array.from(attributeKeys).sort().map(k => column(k, k, "system", false)),
    column("team_notes", "Team Notes", "operator", true),
    column("follow_up_status", "Follow-up Status", "operator", true),
    column("next_action_date", "Next Action Date", "operator", true, "date"),
  ];

  const recipientRows: AiWorkbookRow[] = recipients.map(recipient => ({
    id: recipient.id,
    sourceRecipientId: recipient.id,
    values: {
      name: recipient.name || "",
      phone: recipient.phone,
      status: recipient.status,
      ...(recipient.attributes || {}),
      team_notes: "",
      follow_up_status: "",
      next_action_date: null,
    },
  }));

  const outcomeColumns: AiWorkbookColumn[] = [
    column("name", "Name", "system", false),
    column("phone", "Phone", "system", false),
    column("status", "Delivery Status", "system", false),
    column("classification", "Outcome Key", "ai", false),
    column("classification_label", "Reply Outcome", "ai", false),
    ...captureKeys.map(f => column(f.key, f.label, "ai", false, f.type)),
    column("callback_required", "Callback Required", "ai", false, "boolean"),
    column("callback_reason", "Callback Reason", "ai", false),
    column("customer_feedback", "Customer Feedback", "ai", false),
    column("reply_count", "Reply Count", "system", false, "number"),
    column("first_reply_at", "First Reply At", "system", false, "date"),
    column("classified_at", "Classified At", "system", false, "date"),
    column("owner", "Assigned To", "operator", true),
    column("review_status", "Review Status", "operator", true),
    column("team_notes", "Team Notes", "operator", true),
    column("next_action_date", "Next Action Date", "operator", true, "date"),
  ];

  const outcomeRows: AiWorkbookRow[] = recipients.map(recipient => {
    const aiValues: AiWorkbookRow["values"] = {
      classification: recipient.primaryClassification || "",
      classification_label: recipient.primaryClassification
        ? labels.get(recipient.primaryClassification) || recipient.primaryClassification
        : "",
      ...(recipient.dispositionData || {}),
      callback_required: recipient.callbackRequired,
      callback_reason: recipient.callbackReason || "",
      customer_feedback: recipient.customerFeedback || "",
    };
    return {
      id: recipient.id,
      sourceRecipientId: recipient.id,
      values: {
        name: recipient.name || "",
        phone: recipient.phone,
        status: recipient.status,
        ...aiValues,
        reply_count: recipient.replyCount,
        first_reply_at: recipient.firstReplyAt?.toISOString() || null,
        classified_at: recipient.classifiedAt?.toISOString() || null,
        owner: "",
        review_status: "",
        team_notes: "",
        next_action_date: null,
      },
      aiValues,
    };
  });

  return [
    { id: "recipients", name: "Recipients", kind: "recipients", columns: recipientColumns, rows: recipientRows },
    { id: "outcomes", name: "Reply Outcomes", kind: "outcomes", columns: outcomeColumns, rows: outcomeRows },
  ];
}

function mergeOperatorEdits(fresh: AiWorkbookSheet[], previous: AiWorkbookSheet[]): AiWorkbookSheet[] {
  const previousByKind = new Map(previous.map(sheet => [sheet.kind, sheet]));
  const merged = fresh.map(sheet => {
    const old = previousByKind.get(sheet.kind);
    if (!old) return sheet;
    const operatorKeys = new Set(old.columns.filter(c => c.source === "operator").map(c => c.key));
    const oldBySource = new Map(old.rows.map(row => [row.sourceRecipientId || row.id, row]));
    return {
      ...sheet,
      columns: [
        ...sheet.columns,
        ...old.columns.filter(c => c.source === "operator" && !sheet.columns.some(existing => existing.key === c.key)),
      ],
      rows: sheet.rows.map(row => {
        const prior = oldBySource.get(row.sourceRecipientId || row.id);
        if (!prior) return row;
        const operatorValues: AiWorkbookRow["values"] = {};
        for (const key of Array.from(operatorKeys)) operatorValues[key] = prior.values[key] ?? null;
        return { ...row, values: { ...row.values, ...operatorValues } };
      }),
    };
  });
  return [...merged, ...previous.filter(sheet => sheet.kind === "custom")];
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
  async list(businessAccountId: string, includeArchived = false) {
    const workbooks = await db
      .select()
      .from(whatsappAiWorkbooks)
      .where(and(
        eq(whatsappAiWorkbooks.businessAccountId, businessAccountId),
        ...(includeArchived ? [] : [eq(whatsappAiWorkbooks.status, "active")]),
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

  async updateWorkbook(businessAccountId: string, id: string, input: { name?: string; description?: string; status?: string }) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw new Error("Workbook name is required");
      set.name = name;
    }
    if (input.description !== undefined) set.description = String(input.description);
    if (input.status !== undefined) {
      if (!["active", "archived"].includes(input.status)) throw new Error("Invalid workbook status");
      set.status = input.status;
    }
    const [row] = await db.update(whatsappAiWorkbooks)
      .set(set)
      .where(and(eq(whatsappAiWorkbooks.id, id), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)))
      .returning();
    return row;
  },

  async saveSheets(businessAccountId: string, workbookId: string, versionId: string, revision: number, sheets: unknown) {
    const normalized = validateSheets(sheets);
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
    const nextById = new Map(normalized.map(sheet => [sheet.id, sheet]));
    for (const previousSheet of current.sheets as AiWorkbookSheet[]) {
      const nextSheet = nextById.get(previousSheet.id);
      if (!nextSheet || !["recipients", "outcomes"].includes(previousSheet.kind)) continue;
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
    const source = ["manual", "import", "campaign"].includes(input.source || "")
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
      const nextSheets = (requestedSheets ?? current.sheets) as AiWorkbookSheet[];
      const nextById = new Map(nextSheets.map(sheet => [sheet.id, sheet]));
      for (const previousSheet of current.sheets as AiWorkbookSheet[]) {
        const nextSheet = nextById.get(previousSheet.id);
        if (!nextSheet || !["recipients", "outcomes"].includes(previousSheet.kind)) continue;
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

  async refreshFromCampaign(businessAccountId: string, workbookId: string) {
    const [workbook] = await db.select().from(whatsappAiWorkbooks)
      .where(and(eq(whatsappAiWorkbooks.id, workbookId), eq(whatsappAiWorkbooks.businessAccountId, businessAccountId)))
      .limit(1);
    if (!workbook) throw new Error("Workbook not found");
    if (!workbook.sourceCampaignId) throw new Error("This workbook is not linked to a campaign");
    const current = await latestVersion(workbookId, businessAccountId);
    const fresh = await buildCampaignSheets(businessAccountId, workbook.sourceCampaignId);
    const sheets = current ? mergeOperatorEdits(fresh, current.sheets as AiWorkbookSheet[]) : fresh;
    if (!current) throw new Error("Workbook has no version");
    return this.createVersion(businessAccountId, workbookId, {
      sheets,
      source: "campaign",
      expectedCurrentVersionId: current.id,
      expectedRevision: current.revision,
    });
  },

  async duplicate(businessAccountId: string, workbookId: string, name?: string) {
    const current = await this.get(businessAccountId, workbookId);
    if (!current || !current.currentVersion) throw new Error("Workbook not found");
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
        sheets: current.currentVersion.sheets,
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
    input: { sheetId: string; rowIds?: string[]; phoneColumn?: string; nameColumn?: string; groupName?: string },
  ) {
    const workbook = await this.get(businessAccountId, workbookId);
    if (!workbook?.currentVersion) throw new Error("Workbook not found");
    const sheet = (workbook.currentVersion.sheets as AiWorkbookSheet[]).find(s => s.id === input.sheetId);
    if (!sheet) throw new Error("Workbook tab not found");
    const phoneColumn = input.phoneColumn || "phone";
    const nameColumn = input.nameColumn || "name";
    if (!sheet.columns.some(c => c.key === phoneColumn)) throw new Error("Choose a valid phone column");
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
      return { group, selectedRows: rows.length, importedContacts: valid.size, skippedRows: rows.length - valid.size };
    } catch (error) {
      await contactGroupService.remove(businessAccountId, group.id);
      throw error;
    }
  },
};
