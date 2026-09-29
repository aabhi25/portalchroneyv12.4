/**
 * Instagram / Facebook leads keep what they captured in a free-form `extracted_data` JSON
 * (DM auto-capture writes customer_name / phone_number / email_address; flows write whatever
 * each step's saveToField is). These helpers pick the contact fields out of it the same way
 * in TypeScript (CRM push) and in SQL (unified Leads view, retry workers).
 */
import { sql, type SQL } from "drizzle-orm";

export const SOCIAL_NAME_KEYS = ["customer_name", "name", "full_name", "fullName", "customerName", "your_name"] as const;
export const SOCIAL_PHONE_KEYS = [
  "phone_number", "phone", "mobile", "mobile_number", "mobileNumber", "phoneNumber",
  "contact_number", "whatsapp", "whatsapp_number", "customer_phone",
] as const;
export const SOCIAL_EMAIL_KEYS = ["email_address", "email", "emailAddress", "customer_email"] as const;

export type SocialChannel = "instagram" | "facebook";
export const SOCIAL_CHANNEL_LABEL: Record<SocialChannel, string> = { instagram: "Instagram", facebook: "Facebook" };
export const SOCIAL_LEAD_TABLE: Record<SocialChannel, "instagram_leads" | "facebook_leads"> = {
  instagram: "instagram_leads",
  facebook: "facebook_leads",
};

export function isSocialChannel(v: unknown): v is SocialChannel {
  return v === "instagram" || v === "facebook";
}

function pick(data: Record<string, any> | null | undefined, keys: readonly string[]): string | null {
  if (!data || typeof data !== "object") return null;
  for (const key of keys) {
    const v = data[key];
    if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

export interface SocialLeadContact {
  name: string | null;
  phone: string | null;
  email: string | null;
}

export function socialLeadContact(
  extractedData: Record<string, any> | null | undefined,
  fallbackName?: string | null,
): SocialLeadContact {
  return {
    name: pick(extractedData, SOCIAL_NAME_KEYS) || (fallbackName?.trim() || null),
    phone: pick(extractedData, SOCIAL_PHONE_KEYS),
    email: pick(extractedData, SOCIAL_EMAIL_KEYS),
  };
}

/** A lead can go to a CRM once it has a way to reach the person. */
export function hasReachableContact(c: SocialLeadContact): boolean {
  return !!(c.phone || c.email);
}

/**
 * SQL for the first non-blank value among `keys` in `<alias>.extracted_data`.
 * `alias` and keys are compile-time constants (never user input).
 */
export function extractedFieldSql(alias: string, keys: readonly string[]): SQL {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`bad alias ${alias}`);
  const parts = keys.map(k => {
    if (!/^[A-Za-z0-9_]+$/.test(k)) throw new Error(`bad key ${k}`);
    return `NULLIF(btrim(${alias}.extracted_data->>'${k}'), '')`;
  });
  return sql.raw(`COALESCE(${parts.join(", ")})`);
}

/** SQL condition: the lead has a phone or an email in extracted_data. */
export function reachableContactSql(alias: string): SQL {
  return sql`(${extractedFieldSql(alias, SOCIAL_PHONE_KEYS)} IS NOT NULL OR ${extractedFieldSql(alias, SOCIAL_EMAIL_KEYS)} IS NOT NULL)`;
}
