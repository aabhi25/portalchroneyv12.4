import { db } from "../db";
import {
  contactGroups,
  contactGroupContacts,
  whatsappOptOuts,
  type ContactGroup,
  type ContactGroupContact,
} from "@shared/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

function normalizePhone(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

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
 * Apply a contact group's default country code to a phone number for sending.
 *
 * Rules:
 * - Strip non-digits and any leading zero (common in locally-typed numbers).
 * - If the group has a default country code:
 *     - If the cleaned digits are <= 10, prepend the country code (treat as
 *       a local number).
 *     - Otherwise leave as-is (treat as already international).
 * - If the group has NO default code (Mixed mode):
 *     - The number must be at least 11 digits AND not look like a 10-digit
 *       local — otherwise return an error so the recipient is marked failed
 *       instead of being silently shipped to MSG91 with a malformed `to`.
 */
export function applyCountryCode(
  rawPhone: string,
  defaultCountryCode: string | null | undefined,
): { phone: string | null; error?: string } {
  let cleaned = (rawPhone || "").replace(/\D/g, "");
  // Strip a single leading zero — typed local numbers often have one.
  if (cleaned.startsWith("0")) cleaned = cleaned.replace(/^0+/, "");
  if (!cleaned) return { phone: null, error: "Phone is empty" };

  const code = (defaultCountryCode || "").replace(/\D/g, "");
  if (code) {
    if (cleaned.length <= 10) return { phone: code + cleaned };
    return { phone: cleaned };
  }
  if (cleaned.length < 11) {
    return {
      phone: null,
      error: `Missing country code — group is set to Mixed, so each phone must include its country code (e.g. 919810560800).`,
    };
  }
  return { phone: cleaned };
}

function parseCsv(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const text = csvText.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  };

  const headers = splitLine(lines[0]).map(h => h.toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] || "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
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

  async importFromCsv(
    businessAccountId: string,
    groupId: string,
    csvText: string,
    options?: { phoneColumn?: string; nameColumn?: string }
  ): Promise<{ imported: number; skipped: number; total: number; sampleErrors: string[] }> {
    const group = await this.get(businessAccountId, groupId);
    if (!group) throw new Error("Contact group not found");

    const { headers, rows } = parseCsv(csvText);
    if (rows.length === 0) return { imported: 0, skipped: 0, total: 0, sampleErrors: ["CSV is empty"] };

    const phoneCol = (options?.phoneColumn || ["phone", "mobile", "number", "whatsapp"].find(c => headers.includes(c)) || headers[0]).toLowerCase();
    const nameCol = (options?.nameColumn || ["name", "full_name", "fullname", "first_name"].find(c => headers.includes(c)) || "").toLowerCase();

    let imported = 0;
    let skipped = 0;
    const sampleErrors: string[] = [];
    const seenPhones = new Set<string>();

    const existingRows = await db
      .select({ phone: contactGroupContacts.phone })
      .from(contactGroupContacts)
      .where(eq(contactGroupContacts.groupId, groupId));
    const existingSet = new Set(existingRows.map(r => r.phone));

    const valuesToInsert: any[] = [];
    for (const row of rows) {
      const rawPhone = row[phoneCol] || "";
      const phone = normalizePhone(rawPhone);
      if (!phone || phone.length < 7) {
        skipped++;
        if (sampleErrors.length < 5) sampleErrors.push(`Invalid phone: "${rawPhone}"`);
        continue;
      }
      if (seenPhones.has(phone) || existingSet.has(phone)) {
        skipped++;
        continue;
      }
      seenPhones.add(phone);

      const attributes: Record<string, string> = {};
      for (const h of headers) {
        if (h === phoneCol || h === nameCol) continue;
        if (row[h]) attributes[h] = row[h];
      }
      valuesToInsert.push({
        groupId,
        businessAccountId,
        phone,
        name: nameCol ? (row[nameCol] || "") : "",
        attributes,
      });
      imported++;
    }

    if (valuesToInsert.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < valuesToInsert.length; i += CHUNK) {
        await db.insert(contactGroupContacts).values(valuesToInsert.slice(i, i + CHUNK));
      }
    }

    const [{ cnt }] = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(contactGroupContacts)
      .where(eq(contactGroupContacts.groupId, groupId));

    await db
      .update(contactGroups)
      .set({ contactCount: cnt as number, updatedAt: new Date() })
      .where(eq(contactGroups.id, groupId));

    return { imported, skipped, total: rows.length, sampleErrors };
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

export { normalizePhone, parseCsv };
