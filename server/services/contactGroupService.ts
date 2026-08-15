import { db } from "../db";
import {
  contactGroups,
  contactGroupContacts,
  whatsappOptOuts,
  type ContactGroup,
  type ContactGroupContact,
} from "@shared/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  MAX_IMPORT_ROWS,
  applyCountryCode,
  buildSheetData,
  decodeTextBytes,
  detectNameColumn,
  detectPhoneColumn,
  evaluateImportRows,
  normalizePhone,
  parseDelimitedText,
  type EvaluatedRow,
  type ImportColumn,
  type ImportSummary,
  type SourceRecord,
} from "@shared/contactImport";

/**
 * Curated list of common country codes shown in the group settings picker.
 * Kept short and intentional — exhaustive country lists belong in a UX with
 * search; this picker is a quick-set for the SaaS' actual user base.
 */
export const COMMON_COUNTRY_CODES: { code: string; label: string }[] = [
  { code: "91", label: "🇮🇳 India (+91)" },
  { code: "1", label: "🇺🇸 US / 🇨🇦 Canada (+1)" },
  { code: "44", label: "🇬🇧 UK (+44)" },
  { code: "971", label: "🇦🇪 UAE (+971)" },
  { code: "966", label: "🇸🇦 Saudi Arabia (+966)" },
  { code: "65", label: "🇸🇬 Singapore (+65)" },
  { code: "61", label: "🇦🇺 Australia (+61)" },
  { code: "60", label: "🇲🇾 Malaysia (+60)" },
  { code: "62", label: "🇮🇩 Indonesia (+62)" },
  { code: "63", label: "🇵🇭 Philippines (+63)" },
  { code: "880", label: "🇧🇩 Bangladesh (+880)" },
  { code: "94", label: "🇱🇰 Sri Lanka (+94)" },
  { code: "92", label: "🇵🇰 Pakistan (+92)" },
  { code: "977", label: "🇳🇵 Nepal (+977)" },
  { code: "49", label: "🇩🇪 Germany (+49)" },
  { code: "33", label: "🇫🇷 France (+33)" },
  { code: "39", label: "🇮🇹 Italy (+39)" },
  { code: "34", label: "🇪🇸 Spain (+34)" },
  { code: "55", label: "🇧🇷 Brazil (+55)" },
  { code: "52", label: "🇲🇽 Mexico (+52)" },
];

/**
 * The parsed-and-mapped payload the client sends for both preview and import.
 *
 * Workbook decoding happens in the browser, so the server never runs the
 * spreadsheet parser over an untrusted upload. The server still owns every
 * decision about what is valid — this is raw material, not a verdict.
 */
export interface ContactImportPayload {
  columns: ImportColumn[];
  rows: SourceRecord[];
  phoneColumn?: string;
  nameColumn?: string;
}

export interface ContactImportReview {
  columns: ImportColumn[];
  phoneColumn: string;
  nameColumn: string;
  attributeColumns: ImportColumn[];
  defaultCountryCode: string | null;
  summary: ImportSummary;
}

export const contactGroupService = {
  async list(businessAccountId: string): Promise<ContactGroup[]> {
    return db
      .select()
      .from(contactGroups)
      .where(eq(contactGroups.businessAccountId, businessAccountId))
      .orderBy(desc(contactGroups.updatedAt));
  },

  async get(businessAccountId: string, id: string): Promise<ContactGroup | undefined> {
    const [row] = await db
      .select()
      .from(contactGroups)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.businessAccountId, businessAccountId)))
      .limit(1);
    return row;
  },

  async create(businessAccountId: string, name: string, description?: string): Promise<ContactGroup> {
    const [row] = await db
      .insert(contactGroups)
      .values({ businessAccountId, name: name.trim(), description: description || "", defaultCountryCode: "91" })
      .returning();
    return row;
  },

  async update(
    businessAccountId: string,
    id: string,
    updates: { name?: string; description?: string; defaultCountryCode?: string | null },
  ): Promise<ContactGroup | undefined> {
    const set: any = { updatedAt: new Date() };
    if (updates.name !== undefined) set.name = updates.name.trim();
    if (updates.description !== undefined) set.description = updates.description;
    if (updates.defaultCountryCode !== undefined) {
      // Empty string / null both mean "Mixed". Otherwise normalize to digits only.
      const raw = (updates.defaultCountryCode || "").toString().replace(/\D/g, "");
      set.defaultCountryCode = raw || null;
    }
    const [row] = await db
      .update(contactGroups)
      .set(set)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.businessAccountId, businessAccountId)))
      .returning();
    return row;
  },

  async remove(businessAccountId: string, id: string): Promise<boolean> {
    const result = await db
      .delete(contactGroups)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.businessAccountId, businessAccountId)))
      .returning({ id: contactGroups.id });
    return result.length > 0;
  },

  async getContacts(businessAccountId: string, groupId: string, limit = 500): Promise<ContactGroupContact[]> {
    return db
      .select()
      .from(contactGroupContacts)
      .where(and(eq(contactGroupContacts.groupId, groupId), eq(contactGroupContacts.businessAccountId, businessAccountId)))
      .orderBy(desc(contactGroupContacts.createdAt))
      .limit(limit);
  },

  /** Digits-only phones already stored in the group — the dedupe basis. */
  async getExistingPhones(groupId: string): Promise<Set<string>> {
    const existingRows = await db
      .select({ phone: contactGroupContacts.phone })
      .from(contactGroupContacts)
      .where(eq(contactGroupContacts.groupId, groupId));
    return new Set(existingRows.map(r => r.phone));
  },

  /**
   * Resolve the column mapping and run the shared verdict over a payload.
   *
   * Both the review screen and the actual import go through here. Nothing else
   * is allowed to decide whether a row is importable — if the preview and the
   * write were computed separately they would eventually disagree, and a
   * review that promises more contacts than it delivers is worse than none.
   */
  async evaluateImport(
    businessAccountId: string,
    groupId: string,
    payload: ContactImportPayload,
  ) {
    const group = await this.get(businessAccountId, groupId);
    if (!group) throw new Error("Contact group not found");

    const columns = Array.isArray(payload.columns) ? payload.columns : [];
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (columns.length === 0) throw new Error("No columns found in the file");
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new Error(
        `That file has ${rows.length.toLocaleString()} rows. The limit is ${MAX_IMPORT_ROWS.toLocaleString()} per import — split it into smaller files.`,
      );
    }

    const hasColumn = (key?: string) => !!key && columns.some(c => c.key === key);
    const phoneColumn = hasColumn(payload.phoneColumn)
      ? payload.phoneColumn!
      : detectPhoneColumn(columns);
    // An explicitly empty name column means "this file has no name column",
    // which is different from not having expressed a preference at all.
    const nameColumn = payload.nameColumn === undefined
      ? detectNameColumn(columns)
      : hasColumn(payload.nameColumn) ? payload.nameColumn! : "";

    const existingPhones = await this.getExistingPhones(groupId);
    const evaluation = evaluateImportRows({
      columns,
      rows,
      phoneColumn,
      nameColumn,
      defaultCountryCode: group.defaultCountryCode,
      existingPhones,
    });

    return { group, columns, phoneColumn, nameColumn, evaluation };
  },

  /**
   * Build the review payload. Writes nothing.
   *
   * Row-level detail is capped for transport; the summary counts are always
   * complete, so the tally the user acts on is never a sample.
   */
  async reviewImport(
    businessAccountId: string,
    groupId: string,
    payload: ContactImportPayload,
    limits?: { problems?: number; preview?: number },
  ): Promise<ContactImportReview & { problemRows: EvaluatedRow[]; previewRows: EvaluatedRow[] }> {
    const problemLimit = limits?.problems ?? 200;
    const previewLimit = limits?.preview ?? 25;
    const { group, columns, phoneColumn, nameColumn, evaluation } =
      await this.evaluateImport(businessAccountId, groupId, payload);

    const problemRows: EvaluatedRow[] = [];
    const previewRows: EvaluatedRow[] = [];
    for (const row of evaluation.rows) {
      if (row.status === "skipped") {
        if (problemRows.length < problemLimit) problemRows.push(row);
      } else if (previewRows.length < previewLimit) {
        previewRows.push(row);
      }
      if (problemRows.length >= problemLimit && previewRows.length >= previewLimit) break;
    }

    return {
      columns,
      phoneColumn,
      nameColumn,
      attributeColumns: columns.filter(c => c.key !== phoneColumn && c.key !== nameColumn),
      defaultCountryCode: group.defaultCountryCode ?? null,
      summary: evaluation.summary,
      problemRows,
      previewRows,
    };
  },

  /**
   * Apply an import, re-running the identical verdict before writing.
   *
   * `reviewedReady` is what the review screen told the user. If the outcome
   * differs — someone else added contacts to the group in the meantime — say
   * so rather than quietly reporting a different number.
   */
  async commitImport(
    businessAccountId: string,
    groupId: string,
    payload: ContactImportPayload,
    reviewedReady?: number,
  ): Promise<{
    imported: number;
    skipped: number;
    total: number;
    summary: ImportSummary;
    rows: EvaluatedRow[];
    reviewedReady: number | null;
    driftNote: string | null;
  }> {
    const { evaluation } = await this.evaluateImport(businessAccountId, groupId, payload);

    const valuesToInsert = evaluation.rows
      .filter(r => r.status === "ready")
      .map(r => ({
        groupId,
        businessAccountId,
        phone: r.phone,
        name: r.name,
        attributes: r.attributes,
      }));

    if (valuesToInsert.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < valuesToInsert.length; i += CHUNK) {
        await db.insert(contactGroupContacts).values(valuesToInsert.slice(i, i + CHUNK));
      }
    }

    await this.refreshContactCount(groupId);

    const summary = evaluation.summary;
    // State only what is actually known: the two numbers, and the fact that
    // the group's contents are the one input that can differ between the
    // review and the confirm. Guessing at a cause would be inventing detail.
    let driftNote: string | null = null;
    if (typeof reviewedReady === "number" && reviewedReady !== summary.ready) {
      driftNote =
        `The review showed ${reviewedReady} to import, but ${summary.ready} ` +
        `${summary.ready === 1 ? "was" : "were"} still eligible when you confirmed — ` +
        `this group's contacts changed in between.`;
    }

    return {
      imported: summary.ready,
      skipped: summary.skipped,
      total: summary.total,
      summary,
      rows: evaluation.rows,
      reviewedReady: typeof reviewedReady === "number" ? reviewedReady : null,
      driftNote,
    };
  },

  /** Recompute the cached contact count for a group. */
  async refreshContactCount(groupId: string): Promise<number> {
    const [{ cnt }] = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(contactGroupContacts)
      .where(eq(contactGroupContacts.groupId, groupId));

    await db
      .update(contactGroups)
      .set({ contactCount: cnt as number, updatedAt: new Date() })
      .where(eq(contactGroups.id, groupId));
    return cnt as number;
  },

  /**
   * Legacy entry point: import straight from CSV bytes or text.
   *
   * Kept so existing API callers keep working. It shares the same parsing and
   * the same verdict as the reviewed path — only the interaction differs.
   */
  async importFromCsv(
    businessAccountId: string,
    groupId: string,
    csvInput: string | Uint8Array,
    options?: { phoneColumn?: string; nameColumn?: string }
  ): Promise<{ imported: number; skipped: number; total: number; sampleErrors: string[] }> {
    const text = typeof csvInput === "string"
      ? csvInput.replace(/^\uFEFF/, "")
      : decodeTextBytes(csvInput).text;

    const { records } = parseDelimitedText(text);
    const sheet = buildSheetData(records);
    if (sheet.rows.length === 0) {
      return { imported: 0, skipped: 0, total: 0, sampleErrors: ["CSV is empty"] };
    }

    const normalizeKey = (value?: string) => value ? value.trim().toLowerCase() : value;
    const result = await this.commitImport(businessAccountId, groupId, {
      columns: sheet.columns,
      rows: sheet.rows,
      phoneColumn: normalizeKey(options?.phoneColumn),
      nameColumn: normalizeKey(options?.nameColumn),
    });

    // Derived from the same evaluation that drove the insert — never a second
    // pass, which would re-run after the write and report every freshly
    // inserted contact as "already in group".
    const sampleErrors = result.rows
      .filter(r => r.status === "skipped" && r.reason !== "already_in_group")
      .slice(0, 5)
      .map(r => `Row ${r.rowNumber}: ${r.message}`);

    return {
      imported: result.imported,
      skipped: result.skipped,
      total: result.total,
      sampleErrors,
    };
  },

  async addContact(businessAccountId: string, groupId: string, phone: string, name?: string, attributes?: Record<string, string>): Promise<ContactGroupContact | undefined> {
    const normalized = normalizePhone(phone);
    if (!normalized) return undefined;
    const [existing] = await db
      .select()
      .from(contactGroupContacts)
      .where(and(eq(contactGroupContacts.groupId, groupId), eq(contactGroupContacts.phone, normalized)))
      .limit(1);
    if (existing) return existing;
    const [row] = await db.insert(contactGroupContacts).values({
      groupId,
      businessAccountId,
      phone: normalized,
      name: name || "",
      attributes: attributes || {},
    }).returning();
    await db.update(contactGroups)
      .set({ contactCount: sql`${contactGroups.contactCount} + 1`, updatedAt: new Date() })
      .where(eq(contactGroups.id, groupId));
    return row;
  },

  async updateContact(
    businessAccountId: string,
    groupId: string,
    contactId: string,
    updates: { phone?: string; name?: string },
  ): Promise<ContactGroupContact | undefined> {
    const set: any = {};
    if (updates.phone !== undefined) {
      const normalized = normalizePhone(updates.phone);
      if (!normalized) return undefined;
      set.phone = normalized;
    }
    if (updates.name !== undefined) set.name = updates.name;
    if (Object.keys(set).length === 0) return undefined;
    const [row] = await db
      .update(contactGroupContacts)
      .set(set)
      .where(and(
        eq(contactGroupContacts.id, contactId),
        eq(contactGroupContacts.groupId, groupId),
        eq(contactGroupContacts.businessAccountId, businessAccountId),
      ))
      .returning();
    return row;
  },

  async removeContact(businessAccountId: string, groupId: string, contactId: string): Promise<boolean> {
    const result = await db
      .delete(contactGroupContacts)
      .where(and(
        eq(contactGroupContacts.id, contactId),
        eq(contactGroupContacts.groupId, groupId),
        eq(contactGroupContacts.businessAccountId, businessAccountId)
      ))
      .returning({ id: contactGroupContacts.id });
    if (result.length > 0) {
      await db.update(contactGroups)
        .set({ contactCount: sql`GREATEST(${contactGroups.contactCount} - 1, 0)`, updatedAt: new Date() })
        .where(eq(contactGroups.id, groupId));
    }
    return result.length > 0;
  },

  async getContactsForGroups(businessAccountId: string, groupIds: string[]): Promise<ContactGroupContact[]> {
    if (groupIds.length === 0) return [];
    return db
      .select()
      .from(contactGroupContacts)
      .where(and(
        eq(contactGroupContacts.businessAccountId, businessAccountId),
        inArray(contactGroupContacts.groupId, groupIds)
      ));
  },

  async getOptOutSet(businessAccountId: string): Promise<Set<string>> {
    const rows = await db
      .select({ phone: whatsappOptOuts.phone })
      .from(whatsappOptOuts)
      .where(eq(whatsappOptOuts.businessAccountId, businessAccountId));
    // Return both the stored phone and its last-10 form. The send-loop
    // pre-flight does `optOuts.has(recipient.phone)` against the local
    // 10-digit phone stored on the contact group row; without the last-10
    // form, opt-outs recorded under the international number (the form
    // inbound webhooks always carry) would silently miss.
    const out = new Set<string>();
    for (const r of rows) {
      if (!r.phone) continue;
      out.add(r.phone);
      if (r.phone.length > 10) out.add(r.phone.slice(-10));
    }
    return out;
  },
};

// Re-exported so existing importers (marketingCampaignService) keep working
// while the implementations live in the shared, isomorphic module.
export { normalizePhone, applyCountryCode };
