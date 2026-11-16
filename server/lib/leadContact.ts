/**
 * A website lead counts (lists, counts, downloads, insights) only once it has a mobile number or an
 * email. New chats no longer save name-only leads (the name stays on the chat until a number or
 * email arrives); older name-only rows stay in the database but are left out everywhere they are
 * listed or counted. A number hidden after sync ("******3210") still counts: the lead had one.
 */
import { sql, type SQL } from "drizzle-orm";
import { leads } from "@shared/schema";

export const leadHasContact: SQL = sql`(COALESCE(TRIM(${leads.phone}), '') <> '' OR COALESCE(TRIM(${leads.email}), '') <> '')`;

/** The same rule for raw SQL on an aliased leads table (e.g. "l"). */
export const leadHasContactAs = (alias: string): SQL =>
  sql.raw(`(COALESCE(TRIM(${alias}.phone), '') <> '' OR COALESCE(TRIM(${alias}.email), '') <> '')`);

/** Values that would make a lead worth saving. */
export const hasContactValue = (v: { phone?: string | null; email?: string | null }) =>
  !!(v.phone && v.phone.trim()) || !!(v.email && v.email.trim());
