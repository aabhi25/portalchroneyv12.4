/**
 * Helpers around creating and sending a campaign:
 *  - audience preview: how many people will get it and how many numbers are skipped, and why
 *  - "Send test to my phone": one real template message to one number, never a recipient
 *  - bulk actions on the campaigns list
 */
import { db } from "../db";
import {
  contactGroups,
  contactGroupContacts,
  marketingCampaignRecipients,
  marketingCampaignTestSends,
  whatsappTemplates,
  type MarketingCampaign,
  type MarketingCampaignRecipient,
  type WhatsappTemplate,
} from "@shared/schema";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { applyCountryCode, contactGroupService } from "./contactGroupService";
import { marketingCampaignService, resolveParams, validateTemplateParams } from "./marketingCampaignService";
import { sendTemplateMessage } from "./whatsappSessionService";
import { whatsappService } from "./whatsappService";
import { isTemplateUsable } from "./whatsapp/campaignPrerequisites";

export class CampaignToolError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CampaignToolError";
    this.status = status;
  }
}

// ── Audience preview ──────────────────────────────────────────────────────

export interface AudiencePreview {
  totalContacts: number;
  willSend: number;
  skipped: { invalid: number; duplicates: number; optedOut: number };
  sampleContact: { name: string; phone: string; attributes: Record<string, string> } | null;
  fields: string[];
  /** True when the campaign already has its recipient list fixed (send started). */
  snapshotted?: boolean;
}

/**
 * Mirrors what the send does with these groups: one message per phone number
 * (first copy wins), opted-out numbers dropped, and numbers that can't be turned
 * into a full international number fail instead of sending.
 */
export async function previewAudience(businessAccountId: string, groupIds: string[]): Promise<AudiencePreview> {
  const ids = Array.from(new Set((groupIds || []).filter(id => typeof id === "string" && id)));
  const empty: AudiencePreview = { totalContacts: 0, willSend: 0, skipped: { invalid: 0, duplicates: 0, optedOut: 0 }, sampleContact: null, fields: [] };
  if (ids.length === 0) return empty;
  const groups = await db.select({ id: contactGroups.id, code: contactGroups.defaultCountryCode })
    .from(contactGroups)
    .where(and(eq(contactGroups.businessAccountId, businessAccountId), inArray(contactGroups.id, ids)));
  if (groups.length === 0) return empty;
  const codes = new Map(groups.map(g => [g.id, g.code ?? null]));
  const contacts = await db.select().from(contactGroupContacts)
    .where(and(
      eq(contactGroupContacts.businessAccountId, businessAccountId),
      inArray(contactGroupContacts.groupId, groups.map(g => g.id)),
    ))
    .orderBy(asc(contactGroupContacts.createdAt));
  const optOuts = await contactGroupService.getOptOutSet(businessAccountId);

  const out: AudiencePreview = { ...empty, skipped: { ...empty.skipped }, totalContacts: contacts.length };
  const seen = new Set<string>();
  const fields = new Set<string>();
  for (const c of contacts) {
    for (const key of Object.keys((c.attributes || {}) as Record<string, string>)) fields.add(key);
    if (seen.has(c.phone)) { out.skipped.duplicates++; continue; }
    if (optOuts.has(c.phone)) { out.skipped.optedOut++; continue; }
    seen.add(c.phone);
    if (!applyCountryCode(c.phone, codes.get(c.groupId) ?? null).phone) { out.skipped.invalid++; continue; }
    out.willSend++;
    if (!out.sampleContact) {
      out.sampleContact = { name: c.name || "", phone: c.phone, attributes: (c.attributes || {}) as Record<string, string> };
    }
  }
  out.fields = Array.from(fields).sort();
  return out;
}

/** Preview for a saved campaign: its groups, or its fixed recipient list once sending has started. */
export async function previewCampaignAudience(businessAccountId: string, campaignId: string): Promise<AudiencePreview | null> {
  const campaign = await marketingCampaignService.get(businessAccountId, campaignId);
  if (!campaign) return null;
  const [snap] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      pending: sql<number>`COUNT(*) FILTER (WHERE status IN ('pending','claimed'))::int`,
      optedOut: sql<number>`COUNT(*) FILTER (WHERE status = 'opted_out')::int`,
    })
    .from(marketingCampaignRecipients)
    .where(and(eq(marketingCampaignRecipients.campaignId, campaignId), eq(marketingCampaignRecipients.businessAccountId, businessAccountId)));
  if ((snap?.total ?? 0) > 0) {
    const live = await previewAudience(businessAccountId, (campaign.groupIds || []) as string[]);
    return {
      ...live,
      totalContacts: snap.total,
      willSend: snap.pending,
      skipped: { invalid: 0, duplicates: 0, optedOut: snap.optedOut },
      snapshotted: true,
    };
  }
  return previewAudience(businessAccountId, (campaign.groupIds || []) as string[]);
}

// ── Send test to my phone ─────────────────────────────────────────────────

export const testSendTuning = { limitPerHour: 10 };

/** Digits only, with a country code. 10 digits get the default code in front. */
export function normalizeTestPhone(raw: unknown, defaultCountryCode: string | null = "91"): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10) {
    const code = (defaultCountryCode || "").replace(/\D/g, "") || "91";
    return code + digits;
  }
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

const mask = (phone: string) => (phone.length > 4 ? `${"•".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : phone);

export interface TestSendInput {
  phone: string;
  campaignId?: string | null;
  templateId?: string | null;
  templateParams?: string[] | null;
  groupIds?: string[] | null;
  variant?: "A" | "B" | null;
  userId?: string | null;
}

export interface TestSendResult {
  success: boolean;
  phone: string;
  messageId?: string | null;
  error?: string;
  sampleContactName?: string | null;
  preview: string;
  remainingThisHour: number;
}

/**
 * Send the campaign's message, filled with the first audience contact's details,
 * to one number. Goes through the same provider call the real send uses. Never
 * writes a campaign recipient row and never touches campaign counters; every
 * attempt is logged in marketing_campaign_test_sends, which also holds the
 * per-business hourly limit.
 */
export async function sendCampaignTest(businessAccountId: string, input: TestSendInput): Promise<TestSendResult> {
  let campaign: MarketingCampaign | undefined;
  let templateId = String(input.templateId || "");
  let templateParams = (input.templateParams || []) as string[];
  let groupIds = (input.groupIds || []) as string[];
  if (input.campaignId) {
    campaign = await marketingCampaignService.get(businessAccountId, input.campaignId);
    if (!campaign) throw new CampaignToolError("Campaign not found", 404);
    const useB = input.variant === "B" && campaign.variantBTemplateId;
    templateId = useB ? campaign.variantBTemplateId! : campaign.templateId;
    templateParams = ((useB ? campaign.variantBTemplateParams : campaign.templateParams) || []) as string[];
    groupIds = (campaign.groupIds || []) as string[];
  }
  if (!templateId) throw new CampaignToolError("Choose a template first");
  const [tpl] = await db.select().from(whatsappTemplates)
    .where(and(eq(whatsappTemplates.id, templateId), eq(whatsappTemplates.businessAccountId, businessAccountId)))
    .limit(1) as WhatsappTemplate[];
  if (!tpl || tpl.deletedAt) throw new CampaignToolError("Template not found", 404);
  if (!isTemplateUsable(tpl)) throw new CampaignToolError("This template isn't approved by WhatsApp yet, so it can't be sent");
  const paramError = validateTemplateParams(tpl, templateParams);
  if (paramError) throw new CampaignToolError(paramError);

  // Sample values come from the first contact who would actually get the campaign.
  const preview = await previewAudience(businessAccountId, groupIds);
  const sample = preview.sampleContact;
  let defaultCode: string | null = "91";
  if (groupIds.length) {
    const [g] = await db.select({ code: contactGroups.defaultCountryCode }).from(contactGroups)
      .where(and(eq(contactGroups.businessAccountId, businessAccountId), inArray(contactGroups.id, groupIds))).limit(1);
    if (g?.code) defaultCode = g.code;
  }
  const phone = normalizeTestPhone(input.phone, defaultCode);
  if (!phone) throw new CampaignToolError("Enter a valid WhatsApp number, with the country code (for example 91 98765 43210)");

  const settings = await whatsappService.getSettings(businessAccountId);
  if (!settings?.msg91AuthKey || !settings?.msg91IntegratedNumberId) {
    throw new CampaignToolError("WhatsApp sending isn't set up yet. Finish WhatsApp settings first.");
  }

  // Rate limit + log row, under a per-business lock so parallel clicks can't slip past the limit.
  const limit = testSendTuning.limitPerHour;
  const { logId, usedBefore } = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"wa-test-send:" + businessAccountId}))`);
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const [used] = await tx.select({ n: sql<number>`COUNT(*)::int` }).from(marketingCampaignTestSends)
      .where(and(eq(marketingCampaignTestSends.businessAccountId, businessAccountId), gt(marketingCampaignTestSends.createdAt, since)));
    if ((used?.n ?? 0) >= limit) {
      throw new CampaignToolError(`You can send up to ${limit} test messages an hour. Please try again a little later.`, 429);
    }
    const [row] = await tx.insert(marketingCampaignTestSends).values({
      businessAccountId,
      campaignId: campaign?.id ?? null,
      templateId: tpl.id,
      userId: input.userId ?? null,
      phone,
      status: "sending",
    }).returning({ id: marketingCampaignTestSends.id });
    return { logId: row.id, usedBefore: used?.n ?? 0 };
  });

  const fakeRecipient = {
    name: sample?.name || "Customer",
    phone: sample?.phone || phone,
    attributes: sample?.attributes || {},
  } as unknown as MarketingCampaignRecipient;
  const { params } = resolveParams(tpl, { templateParams } as MarketingCampaign, fakeRecipient,
    new Set(["name", "phone", ...preview.fields.map(f => f.toLowerCase())]));
  // A test should always arrive: fill anything the sample contact lacks with a readable stand-in.
  for (const key of Object.keys(params)) {
    params[key] = (params[key] || "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, f) => String(f)).trim() || `Sample ${key}`;
  }
  const rendered = (tpl.bodyText || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[String(n)] ?? `{{${n}}}`);

  let result: Awaited<ReturnType<typeof sendTemplateMessage>>;
  try {
    result = await sendTemplateMessage(settings, phone, tpl.name, params, { language: tpl.language, namespace: tpl.namespace });
  } catch (err: any) {
    result = { success: false, error: err?.message || String(err) };
  }
  const errorText = result.success ? null : (typeof result.error === "string" ? result.error : JSON.stringify(result.error || {})).substring(0, 500);
  await db.update(marketingCampaignTestSends)
    .set({ status: result.success ? "sent" : "failed", msg91MessageId: result.messageId || null, errorMessage: errorText })
    .where(eq(marketingCampaignTestSends.id, logId));
  console.log(`[Campaign] Test message "${tpl.name}" to ${mask(phone)} for business ${businessAccountId}: ${result.success ? "accepted" : "failed"}`);

  return {
    success: result.success,
    phone: mask(phone),
    messageId: result.messageId || null,
    error: result.success ? undefined : (errorText || "WhatsApp did not accept the message"),
    sampleContactName: sample?.name || null,
    preview: rendered,
    remainingThisHour: Math.max(0, limit - usedBefore - 1),
  };
}

// ── Bulk actions ──────────────────────────────────────────────────────────

export type BulkAction = "delete" | "cancel";

/**
 * Delete drafts or cancel scheduled campaigns in one go. Anything that isn't in
 * the right state is reported back instead of being touched.
 */
export async function bulkCampaignAction(businessAccountId: string, action: BulkAction, ids: string[]) {
  if (action !== "delete" && action !== "cancel") throw new CampaignToolError("Unknown action");
  const unique = Array.from(new Set((ids || []).filter(id => typeof id === "string" && id))).slice(0, 200);
  if (unique.length === 0) throw new CampaignToolError("Choose at least one campaign");
  const done: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of unique) {
    try {
      const c = await marketingCampaignService.get(businessAccountId, id);
      if (!c) { skipped.push({ id, reason: "Not found" }); continue; }
      if (action === "delete") {
        if (c.status !== "draft") { skipped.push({ id, reason: "Only drafts can be deleted in bulk" }); continue; }
        if (await marketingCampaignService.remove(businessAccountId, id)) done.push(id);
        else skipped.push({ id, reason: "Not found" });
      } else {
        if (c.status !== "scheduled") { skipped.push({ id, reason: "Only scheduled campaigns can be cancelled in bulk" }); continue; }
        if (await marketingCampaignService.cancel(businessAccountId, id)) done.push(id);
        else skipped.push({ id, reason: "Not found" });
      }
    } catch (err: any) {
      skipped.push({ id, reason: err?.message || "Failed" });
    }
  }
  return { done, skipped };
}
