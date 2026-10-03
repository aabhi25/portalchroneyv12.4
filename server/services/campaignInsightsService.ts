/**
 * Read-only numbers for the Campaigns home screen and the cross-campaign
 * results dashboard. Message counts only — deliberately no cost or AI-usage
 * figures anywhere in here.
 *
 * Counting rules (one row in marketing_campaign_recipients = one message):
 *   sent       the provider accepted it (has a provider id / sent time / a post-send status)
 *   delivered  delivered, read or replied
 *   read       read or replied (a reply implies the message was read)
 *   replied    the person wrote back at least once
 *   interested the reply was classified into one of the campaign's positive outcomes (interestedFilter)
 *   opted out  the person asked to stop receiving messages
 * Totals and the per-campaign table count messages SENT in the chosen period
 * and what has happened to them since. The daily chart shows activity per day.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { addDays, dateInTimezone, zonedDateTimeToUtc } from "./campaignAutomationService";
import { positiveClassifications } from "./campaignRepliesService";
import type { ReplyClassification } from "@shared/schema";


const SENT = sql.raw(`(r.msg91_message_id IS NOT NULL OR r.sent_at IS NOT NULL OR r.status IN ('queued','sent','delivered','read','replied'))`);
const SENT_TIME = sql.raw(`COALESCE(r.sent_at, r.claimed_at, r.created_at)`);
const DELIVERED = sql.raw(`(r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL OR r.first_reply_at IS NOT NULL OR r.status IN ('delivered','read','replied'))`);
const READ = sql.raw(`(r.read_at IS NOT NULL OR r.first_reply_at IS NOT NULL OR r.status IN ('read','replied'))`);
const READ_TIME = sql.raw(`COALESCE(r.read_at, r.first_reply_at)`);
const REPLIED = sql.raw(`(r.first_reply_at IS NOT NULL OR r.reply_count > 0)`);
/**
 * "Interested" = the reply was classified into one of the campaign's positive outcome
 * categories — the same rule the campaign funnel uses (campaignRepliesService), so the
 * dashboard and each campaign's funnel always agree.
 */
async function interestedFilter(businessAccountId: string) {
  const result = await db.execute(sql`
    SELECT id, reply_classifications FROM marketing_campaigns WHERE business_account_id = ${businessAccountId}`);
  const pairs: string[] = [];
  for (const row of rowsOf(result)) {
    for (const c of positiveClassifications(row.reply_classifications as ReplyClassification[])) pairs.push(`${row.id}:${c.key}`);
  }
  if (pairs.length === 0) return sql.raw("FALSE");
  return sql`((r.campaign_id || ':' || COALESCE(r.primary_classification, '')) IN (${sql.join(pairs.map((p) => sql`${p}`), sql`, `)}))`;
}
const OPTED_OUT = sql.raw(`(r.status = 'opted_out')`);

export const MAX_RANGE_DAYS = 366;

export type CampaignTotals = {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  interested: number;
  optedOut: number;
};

function rowsOf(result: any): any[] {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function safeTimezone(value: unknown, fallback = "Asia/Kolkata"): string {
  const tz = typeof value === "string" && value.trim() ? value.trim() : fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format();
    return tz;
  } catch {
    return fallback;
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Inclusive local-date range -> [fromUtc, toUtc) instants. Defaults to the last 30 days. */
export function resolveRange(input: { from?: unknown; to?: unknown; tz?: unknown }, now = new Date()) {
  const tz = safeTimezone(input.tz);
  const today = dateInTimezone(tz, now);
  let to = isIsoDate(input.to) ? input.to : today;
  let from = isIsoDate(input.from) ? input.from : addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > (MAX_RANGE_DAYS - 1) * 86_400_000) {
    from = addDays(to, -(MAX_RANGE_DAYS - 1));
  }
  return {
    tz,
    from,
    to,
    fromUtc: zonedDateTimeToUtc(from, "00:00", tz),
    toUtc: zonedDateTimeToUtc(addDays(to, 1), "00:00", tz),
  };
}

function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

async function cohortTotals(businessAccountId: string, fromUtc: Date, toUtc: Date): Promise<CampaignTotals> {
  const INTERESTED = await interestedFilter(businessAccountId);
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS sent,
      COUNT(*) FILTER (WHERE ${DELIVERED})::int AS delivered,
      COUNT(*) FILTER (WHERE ${READ})::int AS read,
      COUNT(*) FILTER (WHERE ${REPLIED})::int AS replied,
      COUNT(*) FILTER (WHERE ${INTERESTED})::int AS interested,
      COUNT(*) FILTER (WHERE ${OPTED_OUT})::int AS opted_out
    FROM marketing_campaign_recipients r
    WHERE r.business_account_id = ${businessAccountId}
      AND ${SENT}
      AND ${SENT_TIME} >= ${fromUtc.toISOString()}::timestamp
      AND ${SENT_TIME} < ${toUtc.toISOString()}::timestamp
  `);
  const row = rowsOf(result)[0] || {};
  return {
    sent: num(row.sent),
    delivered: num(row.delivered),
    read: num(row.read),
    replied: num(row.replied),
    interested: num(row.interested),
    optedOut: num(row.opted_out),
  };
}

/** Numbers behind the Campaigns home screen: which journey steps are done, plus this month at a glance. */
export async function getCampaignHomeSummary(businessAccountId: string, tzInput?: unknown, now = new Date()) {
  const tz = safeTimezone(tzInput);
  const today = dateInTimezone(tz, now);
  const monthStartDate = `${today.slice(0, 7)}-01`;
  const monthStartUtc = zonedDateTimeToUtc(monthStartDate, "00:00", tz);
  const tomorrowUtc = zonedDateTimeToUtc(addDays(today, 1), "00:00", tz);

  const [audienceRes, templateRes, campaignRes, replyRes] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE contact_count > 0)::int AS usable
      FROM contact_groups WHERE business_account_id = ${businessAccountId}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
      FROM whatsapp_templates WHERE business_account_id = ${businessAccountId} AND deleted_at IS NULL
    `),
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE started_at IS NOT NULL)::int AS sent,
        COUNT(*) FILTER (WHERE started_at >= ${monthStartUtc.toISOString()}::timestamp)::int AS this_month
      FROM marketing_campaigns WHERE business_account_id = ${businessAccountId}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS replied FROM marketing_campaign_recipients r
      WHERE r.business_account_id = ${businessAccountId} AND ${REPLIED}
    `),
  ]);
  const audiences = rowsOf(audienceRes)[0] || {};
  const templates = rowsOf(templateRes)[0] || {};
  const campaigns = rowsOf(campaignRes)[0] || {};
  const replies = rowsOf(replyRes)[0] || {};
  const month = await cohortTotals(businessAccountId, monthStartUtc, tomorrowUtc);

  return {
    timezone: tz,
    steps: {
      audiences: { done: num(audiences.usable) > 0, count: num(audiences.usable), total: num(audiences.total) },
      templates: { done: num(templates.approved) > 0, count: num(templates.approved), total: num(templates.total) },
      campaigns: { done: num(campaigns.sent) > 0, count: num(campaigns.sent) },
      replies: { done: num(replies.replied) > 0, count: num(replies.replied) },
    },
    month: {
      start: monthStartDate,
      campaigns: num(campaigns.this_month),
      messagesSent: month.sent,
      read: month.read,
      readRate: rate(month.read, month.sent),
      replies: month.replied,
    },
  };
}

/** The cross-campaign results dashboard: totals, a per-campaign table and a daily trend. */
export async function getCampaignInsights(
  businessAccountId: string,
  input: { from?: unknown; to?: unknown; tz?: unknown },
  now = new Date(),
) {
  const range = resolveRange(input, now);
  const fromTs = range.fromUtc.toISOString();
  const toTs = range.toUtc.toISOString();
  const tzLit = range.tz;

  const totals = await cohortTotals(businessAccountId, range.fromUtc, range.toUtc);
  const INTERESTED = await interestedFilter(businessAccountId);

  const perCampaignRes = await db.execute(sql`
    SELECT
      c.id, c.name, c.status, c.campaign_type, c.started_at, c.completed_at,
      COUNT(*)::int AS sent,
      COUNT(*) FILTER (WHERE ${DELIVERED})::int AS delivered,
      COUNT(*) FILTER (WHERE ${READ})::int AS read,
      COUNT(*) FILTER (WHERE ${REPLIED})::int AS replied,
      COUNT(*) FILTER (WHERE ${INTERESTED})::int AS interested,
      COUNT(*) FILTER (WHERE ${OPTED_OUT})::int AS opted_out
    FROM marketing_campaign_recipients r
    JOIN marketing_campaigns c ON c.id = r.campaign_id
    WHERE r.business_account_id = ${businessAccountId}
      AND c.business_account_id = ${businessAccountId}
      AND ${SENT}
      AND ${SENT_TIME} >= ${fromTs}::timestamp
      AND ${SENT_TIME} < ${toTs}::timestamp
    GROUP BY c.id, c.name, c.status, c.campaign_type, c.started_at, c.completed_at
    ORDER BY MAX(${SENT_TIME}) DESC
    LIMIT 500
  `);

  const dailyRes = await db.execute(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, SUM(sent)::int AS sent, SUM(read)::int AS read, SUM(replied)::int AS replied
    FROM (
      SELECT ((${SENT_TIME}) AT TIME ZONE 'UTC' AT TIME ZONE ${tzLit}::text)::date AS day, 1 AS sent, 0 AS read, 0 AS replied
      FROM marketing_campaign_recipients r
      WHERE r.business_account_id = ${businessAccountId} AND ${SENT}
        AND ${SENT_TIME} >= ${fromTs}::timestamp AND ${SENT_TIME} < ${toTs}::timestamp
      UNION ALL
      SELECT ((${READ_TIME}) AT TIME ZONE 'UTC' AT TIME ZONE ${tzLit}::text)::date, 0, 1, 0
      FROM marketing_campaign_recipients r
      WHERE r.business_account_id = ${businessAccountId}
        AND ${READ_TIME} >= ${fromTs}::timestamp AND ${READ_TIME} < ${toTs}::timestamp
      UNION ALL
      SELECT ((r.first_reply_at) AT TIME ZONE 'UTC' AT TIME ZONE ${tzLit}::text)::date, 0, 0, 1
      FROM marketing_campaign_recipients r
      WHERE r.business_account_id = ${businessAccountId}
        AND r.first_reply_at >= ${fromTs}::timestamp AND r.first_reply_at < ${toTs}::timestamp
    ) events
    GROUP BY day
    ORDER BY day
  `);

  const byDay = new Map(rowsOf(dailyRes).map(row => [String(row.day), row]));
  const daily: { date: string; sent: number; read: number; replied: number }[] = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    const row = byDay.get(day);
    daily.push({ date: day, sent: num(row?.sent), read: num(row?.read), replied: num(row?.replied) });
  }

  const campaigns = rowsOf(perCampaignRes).map(row => {
    const sent = num(row.sent);
    return {
      id: String(row.id),
      name: String(row.name || ""),
      status: String(row.status || ""),
      campaignType: String(row.campaign_type || "one_time"),
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      sent,
      delivered: num(row.delivered),
      read: num(row.read),
      replied: num(row.replied),
      interested: num(row.interested),
      optedOut: num(row.opted_out),
      readRate: rate(num(row.read), sent),
      replyRate: rate(num(row.replied), sent),
    };
  });

  return {
    range: { from: range.from, to: range.to, timezone: range.tz },
    totals: {
      ...totals,
      deliveredRate: rate(totals.delivered, totals.sent),
      readRate: rate(totals.read, totals.sent),
      replyRate: rate(totals.replied, totals.sent),
    },
    campaigns,
    daily,
  };
}
