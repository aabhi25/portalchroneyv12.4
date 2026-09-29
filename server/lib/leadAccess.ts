/**
 * Shared authorization + privacy helpers for every lead listing (website Leads page,
 * unified Leads view, exports). Kept in one place so all channels apply the same rules.
 */
import type { Request } from "express";
import { storage } from "../storage";

/**
 * The business account whose leads the current user may read, or null when access is no
 * longer authorized (suspended account, removed from the group, primary without full access).
 */
export async function resolveAuthorizedLeadAccountId(user: NonNullable<Request["user"]>): Promise<string | null> {
  const activeAccountId = user.activeBusinessAccountId || user.businessAccountId;
  if (!activeAccountId) return null;
  if (user.role === "super_admin") return activeAccountId;

  const originalUser = await storage.getUser(user.id);
  const originalAccountId = originalUser?.businessAccountId;
  if (!originalAccountId) return null;
  const originalAccount = await storage.getBusinessAccount(originalAccountId);
  if (!originalAccount || originalAccount.status !== "active") return null;
  if (activeAccountId === originalAccountId) return originalAccountId;

  const linkedAccounts = await storage.getLinkedAccounts(originalAccountId);
  const targetMembership = linkedAccounts.find(link => link.businessAccountId === activeAccountId);
  if (!targetMembership || targetMembership.businessAccount.status !== "active") return null;

  const originalMembership = linkedAccounts.find(link => link.businessAccountId === originalAccountId);
  if (originalMembership?.isPrimary === "true") {
    const group = await storage.getAccountGroupForBusiness(originalAccountId);
    if (group?.primaryHasFullAccess !== "true") return null;
  }

  return activeAccountId;
}

/** Masks all but the last four digits (leadPhoneMaskingEnabled). */
export function maskLeadPhone(phone: string | null): string | null {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 4) return digits;
  if (digits.length < 4) return "*".repeat(Math.max(digits.length, 1));
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

const PHONE_KEY = /phone|mobile|whatsapp|contact_?n(o|umber)|\bcell\b|telephone/i;
const EMAIL_KEY = /e-?mail/i;
// A run of 10+ digits (8-digit dates are left alone), optionally with a leading + and spaces/dashes/brackets between them.
const PHONE_IN_TEXT = /\+?\d[\d\s\-().]{6,}\d/g;

/** Masks phone-number-looking runs inside free text (e.g. a raw WhatsApp message). */
export function maskPhonesInText(text: string | null | undefined): string | null {
  if (text == null) return null;
  return text.replace(PHONE_IN_TEXT, (run) => {
    const digits = run.replace(/\D/g, "");
    return digits.length >= 10 ? (maskLeadPhone(run) as string) : run;
  });
}

/**
 * Masks phone values inside an extracted-data object (IG/FB/WhatsApp leads keep captured
 * fields as free-form JSON). Keys that look like phone fields are masked outright; any other
 * string value has phone-looking runs masked.
 */
export function maskPhonesInRecord<T extends Record<string, any> | null | undefined>(data: T): T {
  if (!data || typeof data !== "object") return data;
  const out: Record<string, any> = Array.isArray(data) ? [] : {};
  for (const [key, value] of Object.entries(data)) {
    if (value != null && typeof value === "object") {
      out[key] = maskPhonesInRecord(value);
    } else if (typeof value === "string" || typeof value === "number") {
      const str = String(value);
      out[key] = PHONE_KEY.test(key) && !EMAIL_KEY.test(key) ? maskLeadPhone(str) : maskPhonesInText(str);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
