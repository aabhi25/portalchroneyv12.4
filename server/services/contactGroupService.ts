import { db } from "../db";
import {
  businessAccounts,
  contactGroups,
  contactGroupContacts,
  marketingCampaigns,
  whatsappOptOuts,
  type AudienceContactCondition,
  type AudienceContactFilter,
  type AudienceLeadFilter,
  type AudienceRules,
  type ContactGroup,
  type ContactGroupContact,
} from "@shared/schema";
import { and, asc, desc, eq, inArray, lt, isNull, or, sql, type SQL } from "drizzle-orm";
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

// ── Audience helpers (pagination, leads, dynamic segments) ───────────────────

export const CONTACT_PAGE_SIZES = [25, 50, 100, 250, 500] as const;
export type ContactSort = "newest" | "oldest" | "name" | "phone";

/** One person an audience resolves to (before it is written to contact_group_contacts). */
export interface AudienceMember {
  phone: string;
  name: string;
  attributes: Record<string, string>;
}

export interface AudienceResolveStats {
  matched: number;      // rows/leads that matched the filter
  withoutPhone: number; // matched but no usable phone
  duplicates: number;   // same person (last 10 digits) seen more than once
  optedOut: number;     // skipped because they asked not to be messaged
  count: number;        // people the audience will contain
}

export class AudienceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudienceError";
  }
}

function likeEscape(value: string): string {
  return `%${value.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

/** Search across name, phone (digits too) and any extra field. */
function contactSearchCondition(search: string | undefined | null): SQL | undefined {
  const needle = (search || "").trim().slice(0, 200);
  if (!needle) return undefined;
  const like = likeEscape(needle);
  const digits = needle.replace(/\D/g, "");
  const parts: SQL[] = [
    sql`${contactGroupContacts.name} ILIKE ${like}`,
    sql`${contactGroupContacts.phone} ILIKE ${like}`,
    sql`${contactGroupContacts.attributes}::text ILIKE ${like}`,
  ];
  if (digits.length >= 3 && digits !== needle) parts.push(sql`${contactGroupContacts.phone} LIKE ${likeEscape(digits)}`);
  return sql`(${sql.join(parts, sql` OR `)})`;
}

const last10 = (phone: string) => (phone.length > 10 ? phone.slice(-10) : phone);

function isOptedOut(optOuts: Set<string>, phone: string): boolean {
  return optOuts.has(phone) || optOuts.has(last10(phone));
}

const LEAD_CHANNEL_VALUES = ["website", "whatsapp", "instagram", "facebook"];

/** Clean a lead filter coming from the client (never trust shape or sizes). */
export function normalizeLeadFilter(raw: any): AudienceLeadFilter {
  const channels = Array.isArray(raw?.channels)
    ? Array.from(new Set(raw.channels.map((c: unknown) => String(c)).filter((c: string) => LEAD_CHANNEL_VALUES.includes(c))))
    : [];
  const n = Number(raw?.lastNDays);
  const lastNDays = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 3650) : null;
  const date = (v: unknown) => {
    if (!v) return null;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  const text = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return {
    channels: channels as string[],
    lastNDays,
    from: lastNDays ? null : date(raw?.from),
    to: lastNDays ? null : date(raw?.to),
    status: text(raw?.status, 60),
    topic: text(raw?.topic),
    search: text(raw?.search, 200),
  };
}

const CONDITION_OPS = new Set(["equals", "not_equals", "contains", "not_contains", "is_empty", "not_empty"]);

export function normalizeContactFilter(raw: any): AudienceContactFilter {
  const groupIds = Array.isArray(raw?.groupIds) ? Array.from(new Set(raw.groupIds.map((g: unknown) => String(g)).filter(Boolean))).slice(0, 50) as string[] : [];
  const conditions: AudienceContactCondition[] = (Array.isArray(raw?.conditions) ? raw.conditions : [])
    .slice(0, 20)
    .map((c: any) => ({
      field: String(c?.field || "").trim().slice(0, 100),
      op: (CONDITION_OPS.has(c?.op) ? c.op : "equals") as AudienceContactCondition["op"],
      value: c?.value === undefined || c?.value === null ? "" : String(c.value).slice(0, 200),
    }))
    .filter((c: AudienceContactCondition) => c.field === "name" || c.field === "phone" || /^attr:.{1,90}$/.test(c.field));
  return { groupIds, match: raw?.match === "any" ? "any" : "all", conditions };
}

export function normalizeAudienceRules(raw: any): AudienceRules {
  if (raw?.source === "leads") return { source: "leads", leads: normalizeLeadFilter(raw.leads || {}) };
  if (raw?.source === "contacts") return { source: "contacts", contacts: normalizeContactFilter(raw.contacts || {}) };
  throw new AudienceError("Choose where this audience's people come from (leads or existing audiences).");
}

function fieldValue(member: { phone: string; name: string | null; attributes: Record<string, string> | null }, field: string): string {
  if (field === "name") return member.name || "";
  if (field === "phone") return member.phone || "";
  const key = field.slice("attr:".length).toLowerCase();
  const attrs = member.attributes || {};
  const hit = Object.keys(attrs).find(k => k.toLowerCase() === key);
  return hit ? String(attrs[hit] ?? "") : "";
}

/** Exported for tests: does one contact satisfy a condition? */
export function contactMatchesCondition(
  member: { phone: string; name: string | null; attributes: Record<string, string> | null },
  condition: AudienceContactCondition,
): boolean {
  const actual = fieldValue(member, condition.field).trim().toLowerCase();
  const expected = String(condition.value ?? "").trim().toLowerCase();
  switch (condition.op) {
    case "equals": return actual === expected;
    case "not_equals": return actual !== expected;
    case "contains": return actual.includes(expected);
    case "not_contains": return !actual.includes(expected);
    case "is_empty": return actual === "";
    case "not_empty": return actual !== "";
    default: return false;
  }
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
    if (group.audienceType === "dynamic") {
      throw new AudienceError("This audience fills itself from its rules, so contacts can't be imported into it. Import into a regular audience instead.");
    }

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
    const [group] = await db
      .select({ id: contactGroups.id, audienceType: contactGroups.audienceType })
      .from(contactGroups)
      .where(and(eq(contactGroups.id, groupId), eq(contactGroups.businessAccountId, businessAccountId)))
      .limit(1);
    if (!group) throw new AudienceError("Audience not found");
    if (group.audienceType === "dynamic") {
      throw new AudienceError("This audience fills itself from its rules, so people can't be added by hand.");
    }
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

  /**
   * Contacts of several audiences (used by the campaign snapshot). Dynamic
   * audiences among them are re-evaluated first, so a campaign always goes to
   * the people who match the rules *now*. If that refresh fails the last
   * stored members are used rather than failing the send.
   */
  async getContactsForGroups(businessAccountId: string, groupIds: string[]): Promise<ContactGroupContact[]> {
    if (groupIds.length === 0) return [];
    await this.refreshDynamicAmong(businessAccountId, groupIds);
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

  // ── Paged contacts ─────────────────────────────────────────────────────────

  /**
   * One page of an audience's contacts with search and total count. Replaces
   * the old 500-row list on the audience page (the old getContacts() and its
   * endpoint stay for existing callers).
   */
  async listContactsPage(
    businessAccountId: string,
    groupId: string,
    opts: { page?: number; pageSize?: number; search?: string; sort?: ContactSort } = {},
  ): Promise<{ contacts: ContactGroupContact[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const requested = Number(opts.pageSize) || 50;
    const pageSize = (CONTACT_PAGE_SIZES as readonly number[]).includes(requested) ? requested : 50;
    const conds: SQL[] = [
      eq(contactGroupContacts.groupId, groupId),
      eq(contactGroupContacts.businessAccountId, businessAccountId),
    ];
    const searchCond = contactSearchCondition(opts.search);
    if (searchCond) conds.push(searchCond);
    const where = and(...conds);
    const [{ total }] = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(contactGroupContacts)
      .where(where);
    const totalPages = Math.max(1, Math.ceil(Number(total) / pageSize));
    const page = Math.min(Math.max(1, Math.floor(Number(opts.page) || 1)), totalPages);
    const order = opts.sort === "oldest"
      ? [asc(contactGroupContacts.createdAt), asc(contactGroupContacts.id)]
      : opts.sort === "name"
        ? [sql`lower(coalesce(${contactGroupContacts.name}, '')) ASC`, asc(contactGroupContacts.id)]
        : opts.sort === "phone"
          ? [asc(contactGroupContacts.phone), asc(contactGroupContacts.id)]
          : [desc(contactGroupContacts.createdAt), desc(contactGroupContacts.id)];
    const contacts = await db
      .select()
      .from(contactGroupContacts)
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { contacts, total: Number(total), page, pageSize, totalPages };
  },

  /** Remove many contacts at once: by id, or every contact matching a search. */
  async bulkRemoveContacts(
    businessAccountId: string,
    groupId: string,
    input: { contactIds?: string[]; allMatching?: boolean; search?: string },
  ): Promise<number> {
    const group = await this.get(businessAccountId, groupId);
    if (!group) throw new AudienceError("Audience not found");
    if (group.audienceType === "dynamic") {
      throw new AudienceError("This audience fills itself from its rules — change the rules instead of removing people.");
    }
    const conds: SQL[] = [
      eq(contactGroupContacts.groupId, groupId),
      eq(contactGroupContacts.businessAccountId, businessAccountId),
    ];
    if (input.allMatching) {
      const searchCond = contactSearchCondition(input.search);
      if (searchCond) conds.push(searchCond);
    } else {
      const ids = Array.from(new Set((input.contactIds || []).map(String).filter(Boolean))).slice(0, 5_000);
      if (ids.length === 0) return 0;
      conds.push(inArray(contactGroupContacts.id, ids));
    }
    const removed = await db.delete(contactGroupContacts).where(and(...conds)).returning({ id: contactGroupContacts.id });
    await this.refreshContactCount(groupId);
    return removed.length;
  },

  /** Delete several audiences (and their contacts). Returns how many were deleted. */
  async bulkRemove(businessAccountId: string, ids: string[]): Promise<number> {
    const unique = Array.from(new Set((ids || []).map(String).filter(Boolean))).slice(0, 500);
    if (unique.length === 0) return 0;
    const removed = await db
      .delete(contactGroups)
      .where(and(eq(contactGroups.businessAccountId, businessAccountId), inArray(contactGroups.id, unique)))
      .returning({ id: contactGroups.id });
    return removed.length;
  },

  // ── Audiences from leads ───────────────────────────────────────────────────

  /**
   * Everyone in the business's Leads (all channels it has switched on) that
   * matches the filter, one entry per phone (last 10 digits), skipping people
   * who opted out. Uses the same lead listing (and privacy rules) as the
   * Leads page.
   */
  async collectLeadMembers(businessAccountId: string, rawFilter: AudienceLeadFilter): Promise<{ members: AudienceMember[]; stats: AudienceResolveStats }> {
    const filter = normalizeLeadFilter(rawFilter);
    const [account] = await db
      .select({ leadPhoneMaskingEnabled: businessAccounts.leadPhoneMaskingEnabled })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId))
      .limit(1);
    if (!account) throw new AudienceError("Business account not found");
    if (account.leadPhoneMaskingEnabled === "true") {
      throw new AudienceError("Lead phone numbers are hidden for your account, so audiences can't be built from leads. Ask your administrator to turn off phone hiding, or import a file instead.");
    }
    const { queryUnifiedLeads } = await import("./unifiedLeadsService");
    let from: Date | undefined;
    let to: Date | undefined;
    if (filter.lastNDays) {
      from = new Date(Date.now() - filter.lastNDays * 24 * 60 * 60 * 1000);
    } else {
      if (filter.from) from = new Date(filter.from);
      if (filter.to) {
        to = new Date(filter.to);
        // A plain date means "through the end of that day".
        if (to.getUTCHours() === 0 && to.getUTCMinutes() === 0 && to.getUTCSeconds() === 0) to = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1);
      }
    }
    const channels = filter.channels && filter.channels.length ? filter.channels : ["all"];
    const leads: any[] = [];
    for (const channel of channels) {
      const result = await queryUnifiedLeads(businessAccountId, { channel: channel as any, from, to, search: filter.search || undefined }, null);
      leads.push(...result.leads);
    }
    leads.sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));

    const status = filter.status?.toLowerCase();
    const topic = filter.topic?.toLowerCase();
    const optOuts = await this.getOptOutSet(businessAccountId);
    const seen = new Set<string>();
    const members: AudienceMember[] = [];
    const stats: AudienceResolveStats = { matched: 0, withoutPhone: 0, duplicates: 0, optedOut: 0, count: 0 };
    for (const lead of leads) {
      if (status && String(lead.detail?.status || "").toLowerCase() !== status) continue;
      if (topic) {
        const topics: string[] = Array.isArray(lead.detail?.topicsOfInterest) ? lead.detail.topicsOfInterest : [];
        if (!topics.some(t => String(t).toLowerCase().includes(topic))) continue;
      }
      stats.matched++;
      const phone = normalizePhone(String(lead.phone || ""));
      if (!phone || phone.length < 7) { stats.withoutPhone++; continue; }
      const key = last10(phone);
      if (seen.has(key)) { stats.duplicates++; continue; }
      seen.add(key);
      if (isOptedOut(optOuts, phone)) { stats.optedOut++; continue; }
      const attributes: Record<string, string> = { lead_source: String(lead.channel || "") };
      if (lead.email) attributes.email = String(lead.email);
      if (lead.detail?.city) attributes.city = String(lead.detail.city);
      if (lead.capturedAt) attributes.lead_date = String(lead.capturedAt).slice(0, 10);
      members.push({ phone, name: String(lead.name || "").slice(0, 200), attributes });
    }
    stats.count = members.length;
    return { members, stats };
  },

  /**
   * People in existing (static) audiences matching field conditions, one per
   * phone, skipping opt-outs.
   */
  async collectContactMembers(
    businessAccountId: string,
    rawFilter: AudienceContactFilter,
    excludeGroupId?: string,
  ): Promise<{ members: AudienceMember[]; stats: AudienceResolveStats }> {
    const filter = normalizeContactFilter(rawFilter);
    const groupConds: SQL[] = [eq(contactGroups.businessAccountId, businessAccountId), eq(contactGroups.audienceType, "static")];
    if (filter.groupIds && filter.groupIds.length) groupConds.push(inArray(contactGroups.id, filter.groupIds));
    const groups = await db.select({ id: contactGroups.id }).from(contactGroups).where(and(...groupConds));
    const sourceIds = groups.map(g => g.id).filter(id => id !== excludeGroupId);
    const stats: AudienceResolveStats = { matched: 0, withoutPhone: 0, duplicates: 0, optedOut: 0, count: 0 };
    if (sourceIds.length === 0) return { members: [], stats };
    const rows = await db
      .select({ phone: contactGroupContacts.phone, name: contactGroupContacts.name, attributes: contactGroupContacts.attributes })
      .from(contactGroupContacts)
      .where(and(eq(contactGroupContacts.businessAccountId, businessAccountId), inArray(contactGroupContacts.groupId, sourceIds)))
      .orderBy(desc(contactGroupContacts.createdAt));
    const conditions = filter.conditions || [];
    const optOuts = await this.getOptOutSet(businessAccountId);
    const seen = new Set<string>();
    const members: AudienceMember[] = [];
    for (const row of rows) {
      const member = { phone: row.phone, name: row.name || "", attributes: (row.attributes || {}) as Record<string, string> };
      const ok = conditions.length === 0
        ? true
        : filter.match === "any"
          ? conditions.some(c => contactMatchesCondition(member, c))
          : conditions.every(c => contactMatchesCondition(member, c));
      if (!ok) continue;
      stats.matched++;
      if (!row.phone || row.phone.length < 7) { stats.withoutPhone++; continue; }
      const key = last10(row.phone);
      if (seen.has(key)) { stats.duplicates++; continue; }
      seen.add(key);
      if (isOptedOut(optOuts, row.phone)) { stats.optedOut++; continue; }
      members.push(member);
    }
    stats.count = members.length;
    return { members, stats };
  },

  /** Evaluate saved audience rules now. */
  async evaluateRules(businessAccountId: string, rawRules: AudienceRules, excludeGroupId?: string) {
    const rules = normalizeAudienceRules(rawRules);
    return rules.source === "leads"
      ? this.collectLeadMembers(businessAccountId, rules.leads)
      : this.collectContactMembers(businessAccountId, rules.contacts, excludeGroupId);
  },

  /** Live count + a small sample for the rule builder. Writes nothing. */
  async previewRules(businessAccountId: string, rawRules: AudienceRules, excludeGroupId?: string) {
    const { members, stats } = await this.evaluateRules(businessAccountId, rawRules, excludeGroupId);
    return { ...stats, sample: members.slice(0, 10) };
  },

  async insertMembers(businessAccountId: string, groupId: string, members: AudienceMember[]): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < members.length; i += CHUNK) {
      await db.insert(contactGroupContacts).values(members.slice(i, i + CHUNK).map(m => ({
        groupId,
        businessAccountId,
        phone: m.phone,
        name: m.name || "",
        attributes: m.attributes || {},
      })));
    }
  },

  /**
   * Create an audience from Leads. `dynamic: true` saves the filter as a
   * segment that re-evaluates at send time; otherwise the matching people are
   * copied in once (and can be topped up later with refreshFromLeads).
   */
  async createFromLeads(
    businessAccountId: string,
    input: { name: string; description?: string; filter: AudienceLeadFilter; dynamic?: boolean },
  ): Promise<{ group: ContactGroup; stats: AudienceResolveStats }> {
    const name = String(input.name || "").trim();
    if (!name) throw new AudienceError("Give the audience a name.");
    const rules: AudienceRules = { source: "leads", leads: normalizeLeadFilter(input.filter || {}) };
    const { members, stats } = await this.collectLeadMembers(businessAccountId, rules.leads);
    const [group] = await db.insert(contactGroups).values({
      businessAccountId,
      name: name.slice(0, 200),
      description: input.description || (input.dynamic ? "Updates itself from your leads" : "Created from your leads"),
      defaultCountryCode: "91",
      audienceType: input.dynamic ? "dynamic" : "static",
      rules,
      lastRefreshedAt: new Date(),
    }).returning();
    try {
      await this.insertMembers(businessAccountId, group.id, members);
      await this.refreshContactCount(group.id);
    } catch (error) {
      await this.remove(businessAccountId, group.id);
      throw error;
    }
    return { group: (await this.get(businessAccountId, group.id))!, stats };
  },

  /** Top up a static leads audience with new matching leads (existing people are kept). */
  async refreshFromLeads(businessAccountId: string, groupId: string): Promise<{ added: number; total: number; stats: AudienceResolveStats }> {
    const group = await this.get(businessAccountId, groupId);
    if (!group) throw new AudienceError("Audience not found");
    if (group.audienceType === "dynamic") {
      const result = await this.refreshDynamicAudience(businessAccountId, groupId);
      return { added: result.added, total: result.total, stats: result.stats };
    }
    const rules = group.rules as AudienceRules | null;
    if (!rules || rules.source !== "leads") throw new AudienceError("This audience was not built from leads.");
    const { members, stats } = await this.collectLeadMembers(businessAccountId, rules.leads);
    const existing = await this.getExistingPhones(groupId);
    const existingKeys = new Set(Array.from(existing).map(last10));
    const fresh = members.filter(m => !existingKeys.has(last10(m.phone)));
    await this.insertMembers(businessAccountId, groupId, fresh);
    await db.update(contactGroups).set({ lastRefreshedAt: new Date() }).where(eq(contactGroups.id, groupId));
    const total = await this.refreshContactCount(groupId);
    return { added: fresh.length, total, stats };
  },

  // ── Dynamic segments ───────────────────────────────────────────────────────

  async createDynamic(
    businessAccountId: string,
    input: { name: string; description?: string; rules: AudienceRules },
  ): Promise<{ group: ContactGroup; stats: AudienceResolveStats }> {
    const name = String(input.name || "").trim();
    if (!name) throw new AudienceError("Give the audience a name.");
    const rules = normalizeAudienceRules(input.rules);
    if (rules.source === "leads") {
      return this.createFromLeads(businessAccountId, { name, description: input.description, filter: rules.leads, dynamic: true });
    }
    const [group] = await db.insert(contactGroups).values({
      businessAccountId,
      name: name.slice(0, 200),
      description: input.description || "Updates itself from your other audiences",
      defaultCountryCode: "91",
      audienceType: "dynamic",
      rules,
    }).returning();
    try {
      const result = await this.refreshDynamicAudience(businessAccountId, group.id);
      return { group: (await this.get(businessAccountId, group.id))!, stats: result.stats };
    } catch (error) {
      await this.remove(businessAccountId, group.id);
      throw error;
    }
  },

  async updateRules(businessAccountId: string, groupId: string, rawRules: AudienceRules) {
    const group = await this.get(businessAccountId, groupId);
    if (!group) throw new AudienceError("Audience not found");
    const rules = normalizeAudienceRules(rawRules);
    if (group.audienceType !== "dynamic" && !(group.rules && (group.rules as AudienceRules).source === "leads" && rules.source === "leads")) {
      throw new AudienceError("Only self-updating audiences (and audiences built from leads) have rules.");
    }
    await db.update(contactGroups).set({ rules, updatedAt: new Date() }).where(eq(contactGroups.id, groupId));
    if (group.audienceType === "dynamic") return this.refreshDynamicAudience(businessAccountId, groupId);
    const r = await this.refreshFromLeads(businessAccountId, groupId);
    return { added: r.added, removed: 0, total: r.total, stats: r.stats };
  },

  /**
   * Re-evaluate a dynamic audience and store the result as its contacts, so
   * every reader of contact_group_contacts (counts, readiness checks, the
   * send snapshot, automations) sees the current members. Serialized per
   * audience with a row lock; idempotent.
   */
  async refreshDynamicAudience(businessAccountId: string, groupId: string): Promise<{ added: number; removed: number; total: number; stats: AudienceResolveStats }> {
    const group = await this.get(businessAccountId, groupId);
    if (!group) throw new AudienceError("Audience not found");
    if (group.audienceType !== "dynamic" || !group.rules) {
      const total = await this.refreshContactCount(groupId);
      return { added: 0, removed: 0, total, stats: { matched: total, withoutPhone: 0, duplicates: 0, optedOut: 0, count: total } };
    }
    const { members, stats } = await this.evaluateRules(businessAccountId, group.rules as AudienceRules, groupId);
    const desired = new Map(members.map(m => [m.phone, m]));
    const result = await db.transaction(async tx => {
      await tx.select({ id: contactGroups.id }).from(contactGroups).where(eq(contactGroups.id, groupId)).for("update");
      const existing = await tx
        .select({ id: contactGroupContacts.id, phone: contactGroupContacts.phone, name: contactGroupContacts.name, attributes: contactGroupContacts.attributes })
        .from(contactGroupContacts)
        .where(eq(contactGroupContacts.groupId, groupId));
      const existingByPhone = new Map(existing.map(row => [row.phone, row]));
      const toDelete = existing.filter(row => !desired.has(row.phone)).map(row => row.id);
      const toInsert = members.filter(m => !existingByPhone.has(m.phone));
      for (let i = 0; i < toDelete.length; i += 1000) {
        await tx.delete(contactGroupContacts).where(inArray(contactGroupContacts.id, toDelete.slice(i, i + 1000)));
      }
      for (let i = 0; i < toInsert.length; i += 500) {
        await tx.insert(contactGroupContacts).values(toInsert.slice(i, i + 500).map(m => ({
          groupId, businessAccountId, phone: m.phone, name: m.name || "", attributes: m.attributes || {},
        })));
      }
      // Keep names / extra fields current for people who stayed in.
      for (const row of existing) {
        const next = desired.get(row.phone);
        if (!next) continue;
        if ((row.name || "") !== (next.name || "") || JSON.stringify(row.attributes || {}) !== JSON.stringify(next.attributes || {})) {
          await tx.update(contactGroupContacts).set({ name: next.name || "", attributes: next.attributes || {} }).where(eq(contactGroupContacts.id, row.id));
        }
      }
      const [{ cnt }] = await tx.select({ cnt: sql<number>`COUNT(*)::int` }).from(contactGroupContacts).where(eq(contactGroupContacts.groupId, groupId));
      const now = new Date();
      await tx.update(contactGroups).set({ contactCount: Number(cnt), lastRefreshedAt: now, updatedAt: now }).where(eq(contactGroups.id, groupId));
      return { added: toInsert.length, removed: toDelete.length, total: Number(cnt) };
    });
    return { ...result, stats };
  },

  /** Refresh every dynamic audience among `groupIds`; failures fall back to the stored members. */
  async refreshDynamicAmong(businessAccountId: string, groupIds: string[]): Promise<void> {
    if (!groupIds.length) return;
    const dynamic = await db
      .select({ id: contactGroups.id })
      .from(contactGroups)
      .where(and(
        eq(contactGroups.businessAccountId, businessAccountId),
        inArray(contactGroups.id, groupIds),
        eq(contactGroups.audienceType, "dynamic"),
      ));
    for (const g of dynamic) {
      try {
        await this.refreshDynamicAudience(businessAccountId, g.id);
      } catch (error: any) {
        console.warn(`[Audiences] Could not refresh dynamic audience ${g.id}; using its last members:`, error?.message);
      }
    }
  },

  /**
   * THE function to read who an audience contains right now. Static
   * audiences return their stored contacts; dynamic audiences are
   * re-evaluated from their rules first (opt-outs skipped, one per phone).
   */
  async resolveAudienceContacts(businessAccountId: string, groupId: string): Promise<ContactGroupContact[]> {
    const group = await this.get(businessAccountId, groupId);
    if (!group) return [];
    if (group.audienceType === "dynamic") await this.refreshDynamicAmong(businessAccountId, [groupId]);
    return db
      .select()
      .from(contactGroupContacts)
      .where(and(eq(contactGroupContacts.groupId, groupId), eq(contactGroupContacts.businessAccountId, businessAccountId)))
      .orderBy(desc(contactGroupContacts.createdAt));
  },

  /** Background: keep dynamic audience counts fresh (oldest first, a few per run). */
  async refreshStaleDynamicAudiences(opts: { olderThanMs?: number; limit?: number } = {}): Promise<number> {
    const cutoff = new Date(Date.now() - (opts.olderThanMs ?? 30 * 60 * 1000));
    const stale = await db
      .select({ id: contactGroups.id, businessAccountId: contactGroups.businessAccountId })
      .from(contactGroups)
      .where(and(
        eq(contactGroups.audienceType, "dynamic"),
        or(isNull(contactGroups.lastRefreshedAt), lt(contactGroups.lastRefreshedAt, cutoff)),
      ))
      .orderBy(sql`${contactGroups.lastRefreshedAt} ASC NULLS FIRST`)
      .limit(opts.limit ?? 10);
    let refreshed = 0;
    for (const g of stale) {
      try {
        await this.refreshDynamicAudience(g.businessAccountId, g.id);
        refreshed++;
      } catch (error: any) {
        console.warn(`[Audiences] Background refresh of ${g.id} failed:`, error?.message);
      }
    }
    return refreshed;
  },

  // ── Opt-out list ───────────────────────────────────────────────────────────

  async listOptOuts(
    businessAccountId: string,
    opts: { search?: string; page?: number; pageSize?: number } = {},
  ) {
    const pageSize = Math.min(Math.max(Number(opts.pageSize) || 50, 10), 500);
    const conds: SQL[] = [eq(whatsappOptOuts.businessAccountId, businessAccountId)];
    const needle = (opts.search || "").trim();
    if (needle) {
      const digits = needle.replace(/\D/g, "");
      conds.push(digits
        ? sql`${whatsappOptOuts.phone} LIKE ${likeEscape(digits)}`
        : sql`${whatsappOptOuts.reason} ILIKE ${likeEscape(needle)}`);
    }
    const where = and(...conds);
    const [{ total }] = await db.select({ total: sql<number>`COUNT(*)::int` }).from(whatsappOptOuts).where(where);
    const totalPages = Math.max(1, Math.ceil(Number(total) / pageSize));
    const page = Math.min(Math.max(1, Math.floor(Number(opts.page) || 1)), totalPages);
    const rows = await db
      .select({
        id: whatsappOptOuts.id,
        phone: whatsappOptOuts.phone,
        reason: whatsappOptOuts.reason,
        campaignId: whatsappOptOuts.campaignId,
        campaignName: marketingCampaigns.name,
        createdAt: whatsappOptOuts.createdAt,
      })
      .from(whatsappOptOuts)
      .leftJoin(marketingCampaigns, eq(marketingCampaigns.id, whatsappOptOuts.campaignId))
      .where(where)
      .orderBy(desc(whatsappOptOuts.createdAt), desc(whatsappOptOuts.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { optOuts: rows, total: Number(total), page, pageSize, totalPages };
  },

  /** Add a number to the do-not-message list by hand. Idempotent. */
  async addOptOut(businessAccountId: string, rawPhone: string, reason = "manual"): Promise<{ added: boolean; phone: string }> {
    const phone = normalizePhone(rawPhone);
    if (!phone || phone.length < 7 || phone.length > 15) throw new AudienceError("Enter a valid phone number (7 to 15 digits).");
    const key = last10(phone);
    const [existing] = await db
      .select({ id: whatsappOptOuts.id })
      .from(whatsappOptOuts)
      .where(and(
        eq(whatsappOptOuts.businessAccountId, businessAccountId),
        sql`(${whatsappOptOuts.phone} = ${phone} OR RIGHT(${whatsappOptOuts.phone}, 10) = ${key})`,
      ))
      .limit(1);
    if (existing) return { added: false, phone };
    await db.insert(whatsappOptOuts).values({ businessAccountId, phone, reason: reason || "manual" });
    return { added: true, phone };
  },

  /** Every opt-out for the CSV export (capped). */
  async exportOptOuts(businessAccountId: string) {
    return db
      .select({
        phone: whatsappOptOuts.phone,
        reason: whatsappOptOuts.reason,
        campaignName: marketingCampaigns.name,
        createdAt: whatsappOptOuts.createdAt,
      })
      .from(whatsappOptOuts)
      .leftJoin(marketingCampaigns, eq(marketingCampaigns.id, whatsappOptOuts.campaignId))
      .where(eq(whatsappOptOuts.businessAccountId, businessAccountId))
      .orderBy(desc(whatsappOptOuts.createdAt))
      .limit(100_000);
  },
};

// Re-exported so existing importers (marketingCampaignService) keep working
// while the implementations live in the shared, isomorphic module.
export { normalizePhone, applyCountryCode };
