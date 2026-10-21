/**
 * Meritto (NoPaperForms) CRM: create and update leads through its lead API.
 *
 *   POST https://api.nopaperforms.io/lead/v1/create   { name, email, mobile, ... }
 *   POST https://api.nopaperforms.io/lead/v1/update   { lead_id, name, email, mobile, ... }
 *   headers: access-key, secret-key (per client)
 *
 * Which Meritto field gets which value is configured per account (meritto_field_mappings), like
 * LeadSquared's mappings. Meritto's reply format isn't fully documented, so it is read loosely: a
 * 2xx without an error flag is a success, and the lead id is looked for under the usual names.
 */
import { contactsHidden, HIDDEN_CONTACTS_MESSAGE, isMaskedValue } from "@shared/contactMasking";
import type { MerittoFieldMapping } from "@shared/schema";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { resolveCrmContextValue, type LeadDataContext } from "./leadsquaredService";

export const MERITTO_DEFAULT_CREATE_URL = "https://api.nopaperforms.io/lead/v1/create";
export const MERITTO_DEFAULT_UPDATE_URL = "https://api.nopaperforms.io/lead/v1/update";

export interface MerittoConfig {
  accessKey: string;
  secretKey: string;
  createUrl?: string | null;
  updateUrl?: string | null;
}

/** Meritto-only values on top of the shared lead context. */
export interface MerittoLeadContext extends LeadDataContext {
  meritto?: {
    /** Mobile without the country code, e.g. "9876543210". */
    mobileNumber?: string | null;
    /** e.g. "+91". */
    dialCode?: string | null;
    /** 'verified' when the visitor confirmed the number (OTP or CAPTCHA), else 'unverified'. */
    mobileVerificationStatus?: string | null;
  };
}

export interface MerittoResult {
  success: boolean;
  leadId?: string;
  message: string;
  /** 401/403 or bad keys: retrying won't help until the keys are fixed. */
  authError?: boolean;
  /** 408/429/5xx/network: worth retrying. */
  transient?: boolean;
  payload?: Record<string, string>;
}

/** "+91 98765 43210" → { dialCode: "+91", mobileNumber: "9876543210" }; other numbers keep their digits. */
export function splitMobile(phone: string | null | undefined, defaultDialCode = "+91"): { dialCode: string | null; mobileNumber: string | null } {
  if (!phone || isMaskedValue(phone)) return { dialCode: null, mobileNumber: null };
  const digits = phone.replace(/\D/g, "");
  if (!digits) return { dialCode: null, mobileNumber: null };
  if (digits.length === 12 && digits.startsWith("91")) return { dialCode: "+91", mobileNumber: digits.slice(2) };
  if (digits.length === 11 && digits.startsWith("0")) return { dialCode: "+91", mobileNumber: digits.slice(1) };
  if (digits.length === 10) return { dialCode: defaultDialCode, mobileNumber: digits };
  // Another country written with "+": keep the number whole, the dial code can't be split reliably.
  return { dialCode: phone.trim().startsWith("+") ? null : defaultDialCode, mobileNumber: digits };
}

function resolveMerittoValue(sourceField: string, context: MerittoLeadContext): string | undefined {
  if (sourceField.startsWith("meritto.")) {
    const key = sourceField.slice("meritto.".length) as keyof NonNullable<MerittoLeadContext["meritto"]>;
    return context.meritto?.[key] || undefined;
  }
  return resolveCrmContextValue(sourceField, context);
}

/** The JSON body for Meritto from the account's mappings. Hidden (masked) values are never sent. */
export function buildMerittoPayload(mappings: MerittoFieldMapping[], context: MerittoLeadContext): Record<string, string> {
  const payload: Record<string, string> = {};
  const sorted = [...mappings].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const m of sorted) {
    if (m.isEnabled !== "true" || !m.merittoField?.trim()) continue;
    let value: string | undefined;
    if (m.sourceType === "custom") {
      value = m.customValue || undefined;
    } else if (m.sourceField) {
      value = resolveMerittoValue(m.sourceField, context);
      if (isMaskedValue(value)) continue; // would overwrite the real value in the CRM
      if (!value && m.fallbackValue) value = m.fallbackValue;
    }
    if (value !== undefined && String(value).trim() !== "") payload[m.merittoField.trim()] = String(value).trim().slice(0, 1000);
  }
  return payload;
}

/** The lead id in Meritto's reply, wherever it is ("lead_id", "leadId", data.lead_id, data.id, ...). */
export function findMerittoLeadId(body: unknown, depth = 0): string | undefined {
  if (!body || typeof body !== "object" || depth > 4) return undefined;
  const obj = body as Record<string, unknown>;
  for (const key of ["lead_id", "leadId", "leadID", "lead_uuid", "id"]) {
    const v = obj[key];
    if ((typeof v === "string" && v.trim()) || typeof v === "number") return String(v).trim();
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = findMerittoLeadId(Array.isArray(v) ? v[0] : v, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function replyMessage(body: any, fallback: string): string {
  const m = body?.message ?? body?.msg ?? body?.error ?? body?.errors ?? body?.data?.message;
  if (typeof m === "string" && m.trim()) return m.trim().slice(0, 500);
  if (m && typeof m === "object") return JSON.stringify(m).slice(0, 500);
  return fallback;
}

function replySaysError(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  if (body.status === false || body.success === false || body.error === true) return true;
  if (typeof body.status === "string" && /^(error|fail(ed|ure)?)$/i.test(body.status)) return true;
  if (typeof body.code === "number" && body.code >= 400) return true;
  return false;
}

const AUTH_WORDS = /unauthori[sz]ed|invalid (access|secret)|access[- ]key|secret[- ]key|authenticat/i;
const DUPLICATE_WORDS = /duplicate|already (exist|regist)|exists/i;

export class MerittoService {
  constructor(private config: MerittoConfig) {}

  private async post(url: string, payload: Record<string, string>): Promise<MerittoResult> {
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "access-key": this.config.accessKey,
          "secret-key": this.config.secretKey,
        },
        body: JSON.stringify(payload),
      }, 30_000);
    } catch (err: any) {
      return { success: false, transient: true, message: `Could not reach Meritto: ${err?.message || err}`, payload };
    }
    const text = await res.text().catch(() => "");
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    const message = replyMessage(body, text ? text.slice(0, 300) : `HTTP ${res.status}`);
    const leadId = findMerittoLeadId(body);

    if (res.status === 401 || res.status === 403 || (!res.ok && AUTH_WORDS.test(message))) {
      return { success: false, authError: true, message: `Meritto refused the keys: ${message}`, payload };
    }
    if (!res.ok || replySaysError(body)) {
      // Already in Meritto: fine when it tells us which lead it is.
      if (DUPLICATE_WORDS.test(message) && leadId) {
        return { success: true, leadId, message: `Lead already in Meritto: ${message}`, payload };
      }
      const transient = res.status === 408 || res.status === 429 || res.status >= 500;
      return { success: false, transient, message: `Meritto: ${message}`, payload };
    }
    return { success: true, leadId, message: message || "Sent to Meritto", payload };
  }

  async createLead(mappings: MerittoFieldMapping[], context: MerittoLeadContext): Promise<MerittoResult> {
    if (contactsHidden(context.lead)) return { success: false, message: HIDDEN_CONTACTS_MESSAGE };
    const payload = buildMerittoPayload(mappings, context);
    if (!payload.mobile && !payload.email) {
      return { success: false, message: "Nothing to send: map the lead's mobile or email to Meritto's \"mobile\" / \"email\" fields." };
    }
    return this.post(this.config.createUrl || MERITTO_DEFAULT_CREATE_URL, payload);
  }

  async updateLead(leadId: string, mappings: MerittoFieldMapping[], context: MerittoLeadContext): Promise<MerittoResult> {
    const payload = { lead_id: leadId, ...buildMerittoPayload(mappings, context) };
    const result = await this.post(this.config.updateUrl || MERITTO_DEFAULT_UPDATE_URL, payload);
    return { ...result, leadId: result.leadId || leadId };
  }

  /**
   * Checks the keys without creating a lead: an update for a lead id that can't exist. Meritto
   * answers "unknown lead" when the keys are fine, and refuses the keys otherwise.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    const r = await this.post(this.config.updateUrl || MERITTO_DEFAULT_UPDATE_URL, { lead_id: "chroney-connection-check" });
    if (r.authError) return { success: false, message: r.message };
    if (r.transient && /Could not reach/.test(r.message)) return { success: false, message: r.message };
    return { success: true, message: "Meritto accepted the keys." };
  }
}

/** Default mappings for a new Meritto setup (the fields in Meritto's create API). */
export const MERITTO_DEFAULT_MAPPINGS: Array<Pick<MerittoFieldMapping, "merittoField" | "sourceType" | "sourceField" | "customValue" | "displayName" | "sortOrder"> & { fallbackValue?: string | null }> = [
  { merittoField: "name", sourceType: "dynamic", sourceField: "lead.name", customValue: null, displayName: "Name", sortOrder: 1, fallbackValue: "Website visitor" },
  { merittoField: "email", sourceType: "dynamic", sourceField: "lead.email", customValue: null, displayName: "Email", sortOrder: 2 },
  { merittoField: "mobile", sourceType: "dynamic", sourceField: "meritto.mobileNumber", customValue: null, displayName: "Mobile", sortOrder: 3 },
  { merittoField: "country_dial_code", sourceType: "dynamic", sourceField: "meritto.dialCode", customValue: null, displayName: "Country dial code", sortOrder: 4, fallbackValue: "+91" },
  { merittoField: "city", sourceType: "dynamic", sourceField: "session.city", customValue: null, displayName: "City", sortOrder: 5 },
  { merittoField: "mobile_verification_status", sourceType: "dynamic", sourceField: "meritto.mobileVerificationStatus", customValue: null, displayName: "Mobile verification status", sortOrder: 6 },
  { merittoField: "source", sourceType: "dynamic", sourceField: "session.utmSource", customValue: null, displayName: "Source", sortOrder: 7, fallbackValue: "AI Chroney" },
  { merittoField: "medium", sourceType: "dynamic", sourceField: "session.utmMedium", customValue: null, displayName: "Medium", sortOrder: 8, fallbackValue: "Chatbot" },
  { merittoField: "campaign", sourceType: "dynamic", sourceField: "session.utmCampaign", customValue: null, displayName: "Campaign", sortOrder: 9 },
];
