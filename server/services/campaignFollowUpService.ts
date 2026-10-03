/**
 * Campaign follow-ups: "if the customer has not replied within N hours, send template X".
 *
 * Run by the campaign scheduler every minute. Safety rules:
 *  - Never twice: a (step, recipient) row is inserted BEFORE the send, guarded by a
 *    unique index, so two ticks or two servers can never both send the same step.
 *    A row whose send crashed half-way stays as it is and is never retried.
 *  - Stops on reply: anyone who has replied (first_reply_at set) is skipped, checked
 *    again right before the send.
 *  - Respects opt-outs, cancelled campaigns and the campaign's quiet hours.
 *  - A provider rate limit is not a failure: the claim is removed so the next tick retries.
 */
import { db } from "../db";
import {
  contactGroups,
  marketingCampaignFollowUps,
  marketingCampaignFollowUpSends,
  marketingCampaignMessages,
  marketingCampaignRecipients,
  marketingCampaigns,
  whatsappTemplates,
  type MarketingCampaign,
  type MarketingCampaignFollowUp,
  type MarketingCampaignRecipient,
} from "@shared/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  campaignSendTuning,
  classifySendFailure,
  isWithinQuietHours,
  resolveParams,
  UNKNOWN_OUTCOME_MARKER,
} from "./marketingCampaignService";
import { applyCountryCode, contactGroupService } from "./contactGroupService";
import { sendTemplateMessage } from "./whatsappSessionService";
import { whatsappService } from "./whatsappService";
import { isTemplateUsable } from "./whatsapp/campaignPrerequisites";

/** Campaigns whose follow-ups keep running. Cancelled / failed / draft never send follow-ups. */
const LIVE_CAMPAIGN_STATUSES = ["sending", "completed", "paused"];
/** Recipients who got the first message and have not replied or opted out. */
const ELIGIBLE_RECIPIENT_STATUSES = ["queued", "sent", "delivered", "read"];

export const followUpTuning = {
  /** Most follow-ups sent per scheduler tick (across all campaigns). */
  maxPerTick: 200,
  /** A follow-up that became due longer ago than this is dropped, not sent late. */
  graceHours: 72,
};

type ProcessResult = { sent: number; skipped: number; failed: number };
let running = false;

export async function processFollowUps(now: Date = new Date()): Promise<ProcessResult> {
  const totals: ProcessResult = { sent: 0, skipped: 0, failed: 0 };
  if (running) return totals;
  running = true;
  try {
    const steps = await db
      .select({ step: marketingCampaignFollowUps, campaign: marketingCampaigns })
      .from(marketingCampaignFollowUps)
      .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingCampaignFollowUps.campaignId))
      .where(and(
        eq(marketingCampaignFollowUps.enabled, true),
        inArray(marketingCampaigns.status, LIVE_CAMPAIGN_STATUSES),
      ))
      .orderBy(asc(marketingCampaignFollowUps.createdAt), asc(marketingCampaignFollowUps.stepNumber))
      .limit(200);
    let budget = followUpTuning.maxPerTick;
    for (const { step, campaign } of steps) {
      if (budget <= 0) break;
      if (isWithinQuietHours(campaign, now)) continue;
      try {
        const r = await processStep(step, campaign, now, budget);
        totals.sent += r.sent;
        totals.skipped += r.skipped;
        totals.failed += r.failed;
        budget -= r.sent + r.failed + r.skipped;
      } catch (err) {
        console.error(`[CampaignFollowUp] step ${step.id} (campaign ${campaign.id}) error:`, err);
      }
    }
  } finally {
    running = false;
  }
  if (totals.sent || totals.failed) {
    console.log(`[CampaignFollowUp] tick — sent=${totals.sent} failed=${totals.failed} skipped=${totals.skipped}`);
  }
  return totals;
}

/** Recipients whose wait for this step is over and who have not been handled for it yet. */
async function dueRecipients(step: MarketingCampaignFollowUp, now: Date, limit: number): Promise<string[]> {
  const nowIso = now.toISOString();
  const delay = `${step.delayHours} hours`;
  const grace = `${step.delayHours + followUpTuning.graceHours} hours`;
  let result: any;
  if (step.stepNumber <= 1) {
    result = await db.execute(sql`
      SELECT r.id
      FROM ${marketingCampaignRecipients} r
      WHERE r.campaign_id = ${step.campaignId}
        AND r.business_account_id = ${step.businessAccountId}
        AND r.status IN ('queued', 'sent', 'delivered', 'read')
        AND r.first_reply_at IS NULL
        AND COALESCE(r.dispatched_at, r.sent_at) IS NOT NULL
        AND COALESCE(r.dispatched_at, r.sent_at) <= ${nowIso}::timestamp - ${delay}::interval
        AND COALESCE(r.dispatched_at, r.sent_at) >= ${nowIso}::timestamp - ${grace}::interval
        AND NOT EXISTS (
          SELECT 1 FROM ${marketingCampaignFollowUpSends} s
          WHERE s.follow_up_id = ${step.id} AND s.recipient_id = r.id
        )
      ORDER BY COALESCE(r.dispatched_at, r.sent_at)
      LIMIT ${limit}
    `);
  } else {
    // Later steps count from when the previous step actually went out.
    result = await db.execute(sql`
      SELECT r.id
      FROM ${marketingCampaignRecipients} r
      JOIN ${marketingCampaignFollowUps} prev
        ON prev.campaign_id = r.campaign_id AND prev.step_number = ${step.stepNumber - 1}
      JOIN ${marketingCampaignFollowUpSends} p
        ON p.follow_up_id = prev.id AND p.recipient_id = r.id AND p.status = 'sent'
      WHERE r.campaign_id = ${step.campaignId}
        AND r.business_account_id = ${step.businessAccountId}
        AND r.status IN ('queued', 'sent', 'delivered', 'read')
        AND r.first_reply_at IS NULL
        AND p.sent_at <= ${nowIso}::timestamp - ${delay}::interval
        AND p.sent_at >= ${nowIso}::timestamp - ${grace}::interval
        AND NOT EXISTS (
          SELECT 1 FROM ${marketingCampaignFollowUpSends} s
          WHERE s.follow_up_id = ${step.id} AND s.recipient_id = r.id
        )
      ORDER BY p.sent_at
      LIMIT ${limit}
    `);
  }
  return ((result?.rows as any[]) ?? []).map(row => String(row.id));
}

async function processStep(
  step: MarketingCampaignFollowUp,
  campaign: MarketingCampaign,
  now: Date,
  budget: number,
): Promise<ProcessResult> {
  const out: ProcessResult = { sent: 0, skipped: 0, failed: 0 };
  const due = await dueRecipients(step, now, budget);
  if (due.length === 0) return out;

  const [tpl] = await db.select().from(whatsappTemplates)
    .where(and(eq(whatsappTemplates.id, step.templateId), eq(whatsappTemplates.businessAccountId, step.businessAccountId)))
    .limit(1);
  if (!tpl || !isTemplateUsable(tpl)) {
    console.warn(`[CampaignFollowUp] step ${step.id}: template is not approved any more — skipping this tick`);
    return out;
  }
  const settings = await whatsappService.getSettings(step.businessAccountId);
  if (!settings?.msg91AuthKey || !settings?.msg91IntegratedNumberId) return out;

  const optOuts = await contactGroupService.getOptOutSet(step.businessAccountId);
  const groupIds = ((campaign.groupIds || []) as string[]).filter(Boolean);
  const groupCodes = new Map<string, string | null>();
  if (groupIds.length) {
    const rows = await db.select({ id: contactGroups.id, code: contactGroups.defaultCountryCode })
      .from(contactGroups)
      .where(and(eq(contactGroups.businessAccountId, step.businessAccountId), inArray(contactGroups.id, groupIds)));
    for (const g of rows) groupCodes.set(g.id, g.code ?? null);
  }
  const knownFields = new Set<string>(["name", "phone"]);
  try {
    const keyRows: any = await db.execute(sql`
      SELECT DISTINCT jsonb_object_keys(attributes) AS k
      FROM ${marketingCampaignRecipients}
      WHERE campaign_id = ${campaign.id} AND jsonb_typeof(attributes) = 'object'
    `);
    for (const row of ((keyRows?.rows as any[]) ?? [])) if (row?.k) knownFields.add(String(row.k).toLowerCase());
  } catch { /* fall back to name/phone only */ }
  const stepCampaign = { ...campaign, templateParams: (step.templateParams || []) as string[] };

  for (const recipientId of due) {
    // Campaign cancelled or quiet hours started while we were working: stop here.
    const [fresh] = await db.select({ status: marketingCampaigns.status }).from(marketingCampaigns)
      .where(eq(marketingCampaigns.id, campaign.id)).limit(1);
    if (!fresh || !LIVE_CAMPAIGN_STATUSES.includes(fresh.status)) break;
    if (isWithinQuietHours(campaign, new Date(Math.max(now.getTime(), Date.now())))) break;

    // Claim first. Losing the insert race means another worker owns this send.
    const claimed: any = await db.execute(sql`
      INSERT INTO ${marketingCampaignFollowUpSends} (follow_up_id, campaign_id, recipient_id, business_account_id, status)
      VALUES (${step.id}, ${campaign.id}, ${recipientId}, ${step.businessAccountId}, 'sending')
      ON CONFLICT (follow_up_id, recipient_id) DO NOTHING
      RETURNING id
    `);
    const sendId: string | undefined = ((claimed?.rows as any[]) ?? [])[0]?.id;
    if (!sendId) continue;
    const finish = (set: Partial<typeof marketingCampaignFollowUpSends.$inferInsert>) =>
      db.update(marketingCampaignFollowUpSends).set(set).where(eq(marketingCampaignFollowUpSends.id, sendId));

    const [r] = await db.select().from(marketingCampaignRecipients)
      .where(eq(marketingCampaignRecipients.id, recipientId)).limit(1) as MarketingCampaignRecipient[];
    if (!r || r.firstReplyAt || !ELIGIBLE_RECIPIENT_STATUSES.includes(r.status)) {
      await finish({ status: "skipped", errorMessage: r?.firstReplyAt || r?.status === "replied" ? "Customer replied" : `Not sent (${r?.status ?? "missing"})` });
      out.skipped++;
      continue;
    }
    const sendPhone = r.sendPhone || applyCountryCode(r.phone, r.groupId ? groupCodes.get(r.groupId) ?? null : null).phone;
    const last10 = (s: string | null | undefined) => (s || "").replace(/\D/g, "").slice(-10);
    if (optOuts.has(r.phone) || (r.sendPhone && optOuts.has(r.sendPhone)) || optOuts.has(last10(r.phone))) {
      await finish({ status: "skipped", errorMessage: "Opted out" });
      out.skipped++;
      continue;
    }
    if (!sendPhone) {
      await finish({ status: "failed", errorMessage: "Invalid phone number" });
      out.failed++;
      continue;
    }
    const { params, problems } = resolveParams(tpl, stepCampaign, r, knownFields);
    if (problems.length) {
      await finish({ status: "failed", errorMessage: problems.join("; ").substring(0, 500), sendPhone });
      out.failed++;
      continue;
    }

    const result = await sendTemplateMessage(settings, sendPhone, tpl.name, params, {
      language: tpl.language,
      namespace: tpl.namespace,
    });
    if (result.success) {
      await finish({ status: "sent", msg91MessageId: result.messageId || null, sendPhone, sentAt: new Date(), errorMessage: null });
      out.sent++;
      try {
        const body = (tpl.bodyText || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[String(n)] ?? `{{${n}}}`);
        await db.insert(marketingCampaignMessages).values({
          campaignId: campaign.id,
          recipientId: r.id,
          businessAccountId: step.businessAccountId,
          direction: "outbound_template",
          body,
          metadata: { templateName: tpl.name, msg91MessageId: result.messageId || null, sendPhone, followUpStep: step.stepNumber, buttons: tpl.buttons ?? [] },
        });
      } catch (err) {
        // The message went out; a missing transcript line must not turn it into a resend.
        console.error(`[CampaignFollowUp] transcript insert failed for ${r.id}:`, err);
      }
    } else {
      const kind = classifySendFailure(result);
      const errorText = typeof result.error === "string" ? result.error : JSON.stringify(result.error || {}).substring(0, 400);
      if (kind === "rate_limited") {
        // Not accepted — release the claim so the next tick tries again, and stop for now.
        await db.delete(marketingCampaignFollowUpSends).where(eq(marketingCampaignFollowUpSends.id, sendId));
        break;
      }
      await finish({
        status: "failed",
        sendPhone,
        errorMessage: (kind === "unknown"
          ? `${UNKNOWN_OUTCOME_MARKER} Send outcome unknown (${errorText}); not retried to avoid a duplicate message`
          : errorText).substring(0, 500),
      });
      out.failed++;
    }
    await new Promise(res => setTimeout(res, campaignSendTuning.sendDelayMs));
  }
  return out;
}

/** Status and counts per follow-up step, for the campaign page. */
export async function getFollowUpSummary(businessAccountId: string, campaignId: string) {
  const steps = await db
    .select({ step: marketingCampaignFollowUps, templateName: whatsappTemplates.name })
    .from(marketingCampaignFollowUps)
    .leftJoin(whatsappTemplates, eq(whatsappTemplates.id, marketingCampaignFollowUps.templateId))
    .where(and(
      eq(marketingCampaignFollowUps.campaignId, campaignId),
      eq(marketingCampaignFollowUps.businessAccountId, businessAccountId),
    ))
    .orderBy(asc(marketingCampaignFollowUps.stepNumber));
  if (steps.length === 0) return { steps: [] };

  const counts = await db
    .select({
      followUpId: marketingCampaignFollowUpSends.followUpId,
      status: marketingCampaignFollowUpSends.status,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(marketingCampaignFollowUpSends)
    .where(and(
      eq(marketingCampaignFollowUpSends.campaignId, campaignId),
      eq(marketingCampaignFollowUpSends.businessAccountId, businessAccountId),
    ))
    .groupBy(marketingCampaignFollowUpSends.followUpId, marketingCampaignFollowUpSends.status);

  // People who could still get step 1: got the first message, no reply, not yet handled.
  const [waiting] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(marketingCampaignRecipients)
    .where(and(
      eq(marketingCampaignRecipients.campaignId, campaignId),
      eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
      inArray(marketingCampaignRecipients.status, ELIGIBLE_RECIPIENT_STATUSES),
      sql`${marketingCampaignRecipients.firstReplyAt} IS NULL`,
      sql`NOT EXISTS (SELECT 1 FROM ${marketingCampaignFollowUpSends} s WHERE s.recipient_id = ${marketingCampaignRecipients.id} AND s.follow_up_id = ${steps[0].step.id})`,
    ));

  return {
    steps: steps.map(({ step, templateName }, i) => {
      const of = (status: string) => counts.find(c => c.followUpId === step.id && c.status === status)?.n ?? 0;
      return {
        id: step.id,
        stepNumber: step.stepNumber,
        delayHours: step.delayHours,
        templateId: step.templateId,
        templateName: templateName ?? null,
        enabled: step.enabled,
        sent: of("sent"),
        failed: of("failed"),
        skipped: of("skipped"),
        inProgress: of("sending"),
        waiting: i === 0 ? waiting?.n ?? 0 : null,
      };
    }),
  };
}
