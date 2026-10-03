import type { ReplyClassification } from "@shared/schema";

export interface WizardTemplate {
  id: string;
  name: string;
  status: string;
  paramCount: number;
  bodyText: string;
  language?: string | null;
  category?: string | null;
  headerType?: string | null;
  headerText?: string | null;
  headerMediaUrl?: string | null;
  footerText?: string | null;
  buttons?: { type: string; text: string; url?: string; phone?: string }[] | null;
  msg91TemplateId?: string | null;
}

export interface WizardGroup {
  id: string;
  name: string;
  contactCount: number;
}

export interface SampleContact {
  name: string;
  phone: string;
  attributes: Record<string, string>;
}

/** Response of the audience preview endpoints. */
export interface AudiencePreview {
  totalContacts: number;
  willSend: number;
  skipped: { invalid: number; duplicates: number; optedOut: number };
  sampleContact: SampleContact | null;
  fields: string[];
  snapshotted?: boolean;
}

export interface FollowUpValue {
  delayHours: number;
  templateId: string;
  templateParams: string[];
}

export type { ReplyClassification };

export interface CampaignFormValues {
  name: string;
  campaignType: "one_time" | "automation";
  templateId: string;
  groupIds: string[];
  templateParams: string[];
  /** datetime-local string ("" means no schedule) */
  scheduledAt: string;
  aiEnabled: boolean;
  aiAgentName: string;
  aiSystemPrompt: string;
  aiUseFaqs: boolean;
  aiUseDocs: boolean;
  aiUseProducts: boolean;
  /** Outcome categories the AI sorts inbound replies into. Empty = broadcast only. */
  replyClassifications: ReplyClassification[];
  /** Automation blueprints own their audience and eligibility rules. */
  recipientSourceType?: "ai_workbook" | "contact_groups";
  recipientWorkbookId?: string;
  recipientWorkbookSheetId?: string;
  recipientPhoneColumn?: string;
  recipientNameColumn?: string;
  recipientRecordKeyColumn?: string;
  recipientDateColumn?: string;
  recipientDateOffsetDays?: number;
  recipientStatusColumn?: string;
  recipientEligibleStatuses?: string[];
  /** Workbook fields the campaign AI may receive. */
  recipientAiAllowedFields?: string[];
  /** Quiet hours, "HH:mm"; both "" = off. Time zone "" = Asia/Kolkata. */
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  /** A/B test: template B ("" = no test), its values and the share of people who get B. */
  variantBTemplateId: string;
  variantBTemplateParams: string[];
  variantSplitPercent: number;
  /** "If no reply within N hours, send template X" (one step in the UI). */
  followUps: FollowUpValue[];
}

/** A/B switched on but template B not picked yet (never sent to the server). */
export const AB_PENDING = "__pending__";

export interface CampaignSubmitOptions {
  /** Start sending right after saving (the user confirmed the recipient count). */
  sendNow?: boolean;
}

/** Read a "{{field}}" mapping; anything else is fixed text. */
export function fieldOf(value: string): string | null {
  const m = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(value || "");
  return m ? m[1] : null;
}

/** Fill "{{field}}" tokens from a sample contact. Unknown fields stay visible as-is. */
export function fillFromSample(value: string, sample: SampleContact | null | undefined): string {
  return (value || "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, key) => {
    const k = String(key).trim();
    const lower = k.toLowerCase();
    if (!sample) return token;
    if (lower === "name") return sample.name || token;
    if (lower === "phone") return sample.phone || token;
    const attrs = sample.attributes || {};
    const hit = attrs[k] ?? attrs[lower] ?? Object.entries(attrs).find(([a]) => a.toLowerCase() === lower)?.[1];
    return hit ? String(hit) : token;
  });
}

/** Template body with {{1}}, {{2}} … replaced by the given values (blank → left as the slot). */
export function renderBody(body: string, values: string[]): string {
  return (body || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (slot, n) => {
    const v = values[Number(n) - 1];
    return v && v.trim() ? v : slot;
  });
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  paused: "Paused — quiet hours",
  completed: "Finished",
  cancelled: "Cancelled",
  failed: "Failed",
};

export const COMMON_TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Jakarta", "Asia/Riyadh", "Asia/Karachi", "Asia/Dhaka",
  "Asia/Kathmandu", "Asia/Colombo", "Europe/London", "Europe/Berlin", "Africa/Nairobi", "Africa/Lagos",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney",
];
