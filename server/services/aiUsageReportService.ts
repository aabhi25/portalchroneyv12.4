/**
 * AI usage & spend reporting (per account month view, all-accounts summary).
 *
 * Source: ai_usage_events (every tracked OpenAI call, incl. realtime voice).
 * ai_usage_daily exists in the schema but nothing populates it, so reports read
 * the events table through its (business_account_id, occurred_at) index: the
 * per-account view is one range scan per month, the all-accounts view one
 * LATERAL range scan per account.
 *
 * Months and days are IST (Asia/Kolkata) — see aiBudgetService.ts.
 *
 * Channel is derived from the event's category and its metadata feature/route
 * labels (set automatically by openaiClient / requestContext):
 *   voice_mode category, or "voice|realtime"               → voice
 *   "whatsapp|msg91"                                       → whatsapp
 *   "instagram"                                            → instagram
 *   "facebook|messenger"                                   → facebook
 *   website chat routes / chat services                    → website
 *   document/website analysis, training & upload routes    → training
 *   anything else (background jobs, admin tools, …)        → other
 * The same ordered rules are applied in SQL (for grouping) and in JS (tests).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  daysInMonth,
  getLimit,
  istDateKey,
  istMonthKey,
  istMonthRange,
  limitLevel,
  pgUtc,
  shiftMonthKey,
  usdInrRate,
  USAGE_TIMEZONE,
  type LimitAction,
  type LimitLevel,
} from "./aiBudgetService";

export const USAGE_CHANNELS = ["website", "whatsapp", "instagram", "facebook", "voice", "training", "other"] as const;
export type UsageChannel = typeof USAGE_CHANNELS[number];

export const CHANNEL_LABELS: Record<UsageChannel, string> = {
  website: "Website chat",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  voice: "Voice",
  training: "Documents & training",
  other: "Other",
};

/** Channels whose "chat" events are customer-facing AI replies. */
const REPLY_CHANNELS: UsageChannel[] = ["website", "whatsapp", "instagram", "facebook"];

interface ChannelRule {
  channel: UsageChannel;
  categories?: string[];
  /** Case-insensitive; must be valid as both a JS RegExp and a PostgreSQL ARE. */
  pattern?: string;
}

const CHANNEL_RULES: ChannelRule[] = [
  { channel: "voice", categories: ["voice_mode"] },
  { channel: "whatsapp", pattern: "whatsapp|msg91" },
  { channel: "instagram", pattern: "instagram" },
  { channel: "facebook", pattern: "facebook|messenger" },
  { channel: "voice", pattern: "voice|realtime" },
  { channel: "website", pattern: "/api/chat|/api/public-chat|/api/guidance|/api/proactive|widget|chatservice|llamaservice|embedchat" },
  { channel: "training", categories: ["document_analysis", "website_analysis"] },
  { channel: "training", pattern: "train|document|scan-docs|url-training|pdf|faq|website-analysis|websiteanalysis|crawl|upload|import|knowledge" },
];

/** JS classifier (same rules as channelSql). */
export function classifyChannel(category: string | null | undefined, feature?: string | null, route?: string | null): UsageChannel {
  const text = `${feature || ""} ${route || ""}`.toLowerCase();
  for (const rule of CHANNEL_RULES) {
    if (rule.categories && rule.categories.includes(category || "")) return rule.channel;
    if (rule.pattern && new RegExp(rule.pattern, "i").test(text)) return rule.channel;
  }
  return "other";
}

/** SQL CASE expression producing the channel of an ai_usage_events row. */
export function channelSql(): SQL {
  const text = sql`lower(coalesce(metadata->>'feature', '') || ' ' || coalesce(metadata->>'route', ''))`;
  const whens = CHANNEL_RULES.map((rule) => {
    if (rule.categories) {
      return sql`WHEN category IN (${sql.join(rule.categories.map((c) => sql`${c}`), sql`, `)}) THEN ${rule.channel}`;
    }
    return sql`WHEN ${text} ~* ${rule.pattern!} THEN ${rule.channel}`;
  });
  return sql`(CASE ${sql.join(whens, sql` `)} ELSE 'other' END)`;
}

interface DayChannelRow {
  day: string;
  channel: UsageChannel;
  costUsd: number;
  tokensInput: number;
  tokensOutput: number;
  calls: number;
  replies: number;
}

/**
 * Per IST day x channel aggregates for one account and month.
 * "replies" = distinct request ids among the channel's chat events (one inbound
 * message / widget request = one reply even when it made several model calls);
 * chat events without a request id count one each.
 */
export async function queryDayChannel(businessAccountId: string, month: string): Promise<DayChannelRow[]> {
  const { start, end } = istMonthRange(month);
  const result: any = await db.execute(sql`
    SELECT
      to_char((occurred_at + interval '330 minutes')::date, 'YYYY-MM-DD') AS day,
      ${channelSql()} AS channel,
      coalesce(sum(cost_usd), 0)::float8 AS cost,
      coalesce(sum(tokens_input), 0)::float8 AS tin,
      coalesce(sum(tokens_output), 0)::float8 AS tout,
      count(*)::int AS calls,
      (count(DISTINCT metadata->>'requestId') FILTER (WHERE category = 'chat')
        + count(*) FILTER (WHERE category = 'chat' AND metadata->>'requestId' IS NULL))::int AS replies
    FROM ai_usage_events
    WHERE business_account_id = ${businessAccountId}
      AND occurred_at >= ${pgUtc(start)}::timestamp
      AND occurred_at < ${pgUtc(end)}::timestamp
    GROUP BY 1, 2
    ORDER BY 1
  `);
  const rows: any[] = result.rows ?? result;
  return rows.map((r) => ({
    day: String(r.day),
    channel: (USAGE_CHANNELS as readonly string[]).includes(r.channel) ? r.channel : "other",
    costUsd: Number(r.cost) || 0,
    tokensInput: Number(r.tin) || 0,
    tokensOutput: Number(r.tout) || 0,
    calls: Number(r.calls) || 0,
    replies: REPLY_CHANNELS.includes(r.channel) ? Number(r.replies) || 0 : 0,
  }));
}

export interface UsageTotals {
  costUsd: number;
  costInr: number;
  tokensInput: number;
  tokensOutput: number;
  tokens: number;
  aiCalls: number;
  aiReplies: number;
}

function totalsOf(rows: DayChannelRow[], rate: number): UsageTotals {
  const t = rows.reduce(
    (acc, r) => {
      acc.costUsd += r.costUsd;
      acc.tokensInput += r.tokensInput;
      acc.tokensOutput += r.tokensOutput;
      acc.aiCalls += r.calls;
      acc.aiReplies += r.replies;
      return acc;
    },
    { costUsd: 0, tokensInput: 0, tokensOutput: 0, aiCalls: 0, aiReplies: 0 },
  );
  return { ...t, tokens: t.tokensInput + t.tokensOutput, costInr: t.costUsd * rate };
}

export interface AccountMonthUsage {
  businessAccountId: string;
  month: string;
  timezone: string;
  isCurrentMonth: boolean;
  /** Days of the month covered so far (all days for a past month). */
  daysElapsed: number;
  daysInMonth: number;
  usdInrRate: number;
  totals: UsageTotals;
  byChannel: Array<{ channel: UsageChannel; label: string; costUsd: number; tokens: number; aiCalls: number; aiReplies: number }>;
  daily: Array<{ date: string; costUsd: number; tokens: number; aiCalls: number; aiReplies: number; byChannel: Partial<Record<UsageChannel, number>> }>;
  previousMonth: { month: string; costUsd: number; tokens: number; aiReplies: number; sameDaysCostUsd: number };
  /** % change vs the same number of days of the previous month (null when that was 0). */
  changePercent: number | null;
  projectedCostUsd: number | null;
  limit: null | {
    monthlyLimitUsd: number;
    warnAtPercent: number;
    action: LimitAction;
    percentUsed: number;
    level: LimitLevel;
  };
}

export async function getAccountMonthUsage(businessAccountId: string, month: string, now = Date.now()): Promise<AccountMonthUsage> {
  const rate = usdInrRate();
  const prevMonth = shiftMonthKey(month, -1);
  const [rows, prevRows, limitRow] = await Promise.all([
    queryDayChannel(businessAccountId, month),
    queryDayChannel(businessAccountId, prevMonth),
    getLimit(businessAccountId),
  ]);

  const currentMonth = istMonthKey(now);
  const isCurrentMonth = month === currentMonth;
  const dim = daysInMonth(month);
  const daysElapsed = isCurrentMonth ? Number(istDateKey(now).slice(8, 10)) : month < currentMonth ? dim : 0;

  const totals = totalsOf(rows, rate);

  const byChannel = USAGE_CHANNELS.map((channel) => {
    const t = totalsOf(rows.filter((r) => r.channel === channel), rate);
    return { channel, label: CHANNEL_LABELS[channel], costUsd: t.costUsd, tokens: t.tokens, aiCalls: t.aiCalls, aiReplies: t.aiReplies };
  }).filter((c) => c.aiCalls > 0);
  byChannel.sort((a, b) => b.costUsd - a.costUsd);

  const daily: AccountMonthUsage["daily"] = [];
  for (let d = 1; d <= Math.max(daysElapsed, 0); d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const dayRows = rows.filter((r) => r.day === date);
    const t = totalsOf(dayRows, rate);
    const perChannel: Partial<Record<UsageChannel, number>> = {};
    for (const r of dayRows) perChannel[r.channel] = (perChannel[r.channel] || 0) + r.costUsd;
    daily.push({ date, costUsd: t.costUsd, tokens: t.tokens, aiCalls: t.aiCalls, aiReplies: t.aiReplies, byChannel: perChannel });
  }

  const prevTotals = totalsOf(prevRows, rate);
  // Compare like with like: the first N days of last month (N = days elapsed this month).
  const prevDim = daysInMonth(prevMonth);
  const cutoffDay = Math.min(daysElapsed, prevDim);
  const sameDaysCostUsd = prevRows
    .filter((r) => Number(r.day.slice(8, 10)) <= cutoffDay)
    .reduce((s, r) => s + r.costUsd, 0);
  const changePercent = sameDaysCostUsd > 0 ? ((totals.costUsd - sameDaysCostUsd) / sameDaysCostUsd) * 100 : null;

  let limit: AccountMonthUsage["limit"] = null;
  if (limitRow) {
    const info = { monthlyLimitUsd: Number(limitRow.monthlyLimitUsd), warnAtPercent: limitRow.warnAtPercent, action: (limitRow.action === "block" ? "block" : "warn") as LimitAction };
    limit = {
      ...info,
      percentUsed: info.monthlyLimitUsd > 0 ? (totals.costUsd / info.monthlyLimitUsd) * 100 : 100,
      level: limitLevel(totals.costUsd, info),
    };
  }

  return {
    businessAccountId,
    month,
    timezone: USAGE_TIMEZONE,
    isCurrentMonth,
    daysElapsed,
    daysInMonth: dim,
    usdInrRate: rate,
    totals,
    byChannel,
    daily,
    previousMonth: { month: prevMonth, costUsd: prevTotals.costUsd, tokens: prevTotals.tokens, aiReplies: prevTotals.aiReplies, sameDaysCostUsd },
    changePercent,
    projectedCostUsd: isCurrentMonth && daysElapsed > 0 ? (totals.costUsd / daysElapsed) * dim : null,
    limit,
  };
}

export interface AccountSummaryRow {
  businessAccountId: string;
  name: string;
  status: string | null;
  costUsd: number;
  costInr: number;
  tokens: number;
  aiCalls: number;
  previousCostUsd: number;
  /** % change vs the whole previous month (null when that was 0). */
  trendPercent: number | null;
  limit: null | { monthlyLimitUsd: number; warnAtPercent: number; action: LimitAction; percentUsed: number; level: LimitLevel };
}

/** Every business account's spend for an IST month (+ previous month for the trend) and its limit. */
export async function getAllAccountsSummary(month: string): Promise<{ month: string; timezone: string; usdInrRate: number; accounts: AccountSummaryRow[] }> {
  const rate = usdInrRate();
  const cur = istMonthRange(month);
  const prev = istMonthRange(shiftMonthKey(month, -1));
  const result: any = await db.execute(sql`
    SELECT ba.id, ba.name, ba.status,
      c.cost, c.tokens, c.calls, p.cost AS prev_cost,
      l.monthly_limit_usd, l.warn_at_percent, l.action
    FROM business_accounts ba
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(e.cost_usd), 0)::float8 AS cost,
             coalesce(sum(e.tokens_input + e.tokens_output), 0)::float8 AS tokens,
             count(*)::int AS calls
      FROM ai_usage_events e
      WHERE e.business_account_id = ba.id
        AND e.occurred_at >= ${pgUtc(cur.start)}::timestamp AND e.occurred_at < ${pgUtc(cur.end)}::timestamp
    ) c
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(e.cost_usd), 0)::float8 AS cost
      FROM ai_usage_events e
      WHERE e.business_account_id = ba.id
        AND e.occurred_at >= ${pgUtc(prev.start)}::timestamp AND e.occurred_at < ${pgUtc(prev.end)}::timestamp
    ) p
    LEFT JOIN ai_usage_limits l ON l.business_account_id = ba.id
    ORDER BY c.cost DESC, ba.name ASC
  `);
  const rows: any[] = result.rows ?? result;
  return {
    month,
    timezone: USAGE_TIMEZONE,
    usdInrRate: rate,
    accounts: rows.map((r) => {
      const costUsd = Number(r.cost) || 0;
      const previousCostUsd = Number(r.prev_cost) || 0;
      let limit: AccountSummaryRow["limit"] = null;
      if (r.monthly_limit_usd != null) {
        const info = { monthlyLimitUsd: Number(r.monthly_limit_usd), warnAtPercent: Number(r.warn_at_percent), action: (r.action === "block" ? "block" : "warn") as LimitAction };
        limit = { ...info, percentUsed: info.monthlyLimitUsd > 0 ? (costUsd / info.monthlyLimitUsd) * 100 : 100, level: limitLevel(costUsd, info) };
      }
      return {
        businessAccountId: r.id,
        name: r.name,
        status: r.status ?? null,
        costUsd,
        costInr: costUsd * rate,
        tokens: Number(r.tokens) || 0,
        aiCalls: Number(r.calls) || 0,
        previousCostUsd,
        trendPercent: previousCostUsd > 0 ? ((costUsd - previousCostUsd) / previousCostUsd) * 100 : null,
        limit,
      };
    }),
  };
}
