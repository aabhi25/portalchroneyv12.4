import { sql } from "drizzle-orm";
import { db } from "../db";
import { channelSql } from "./aiUsageReportService";

/**
 * When each business account was last really used, and on which channel. Shown on the super admin
 * Accounts list and account page ("Active" / "Quiet" / "Not set up").
 *
 * Counts: an AI reply or call on any customer channel (ai_usage_events, without training work),
 * a website visitor (visitor_daily_stats), an incoming WhatsApp message (whatsapp_sessions) and a
 * WhatsApp campaign send (marketing_campaigns). Each lookup uses a per-account index.
 */

export interface AccountActivity {
  lastActiveAt: string;
  lastActiveChannel: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  website: "Website chat",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  voice: "Voice",
  avatar: "Live avatar",
  calling: "Phone calls",
};

export async function getAccountsLastActivity(businessAccountIds: string[]): Promise<Map<string, AccountActivity>> {
  const out = new Map<string, AccountActivity>();
  if (businessAccountIds.length === 0) return out;

  const ids = sql.join(businessAccountIds.map((id) => sql`${id}`), sql`, `);
  const result: any = await db.execute(sql`
    SELECT a.id,
      ai.occurred_at AS ai_at, ai.channel AS ai_channel,
      vis.last_day AS visit_day,
      wa.last_at AS wa_at,
      camp.last_at AS campaign_at
    FROM (SELECT unnest(ARRAY[${ids}]::varchar[]) AS id) a
    LEFT JOIN LATERAL (
      SELECT e.occurred_at, ${channelSql()} AS channel
      FROM ai_usage_events e
      WHERE e.business_account_id = a.id
        AND ${channelSql()} NOT IN ('training', 'other')
      ORDER BY e.occurred_at DESC
      LIMIT 1
    ) ai ON true
    LEFT JOIN LATERAL (
      SELECT max(date)::text AS last_day FROM visitor_daily_stats WHERE business_account_id = a.id
    ) vis ON true
    LEFT JOIN LATERAL (
      SELECT max(last_user_message_at) AS last_at FROM whatsapp_sessions WHERE business_account_id = a.id
    ) wa ON true
    LEFT JOIN LATERAL (
      SELECT max(coalesce(completed_at, started_at)) AS last_at FROM marketing_campaigns
      WHERE business_account_id = a.id AND started_at IS NOT NULL
    ) camp ON true
  `);

  for (const row of result.rows ?? []) {
    const candidates: { at: Date; channel: string }[] = [];
    if (row.ai_at) candidates.push({ at: new Date(row.ai_at), channel: CHANNEL_LABELS[row.ai_channel] ?? "AI" });
    // Daily visitor counts only know the day (India time): count it as midday that day.
    if (row.visit_day) candidates.push({ at: new Date(`${row.visit_day}T12:00:00+05:30`), channel: "Website visitors" });
    if (row.wa_at) candidates.push({ at: new Date(row.wa_at), channel: "WhatsApp" });
    if (row.campaign_at) candidates.push({ at: new Date(row.campaign_at), channel: "WhatsApp campaign" });
    const latest = candidates.filter((c) => !Number.isNaN(c.at.getTime())).sort((x, y) => y.at.getTime() - x.at.getTime())[0];
    if (latest) {
      // A visitor day can't be later than now.
      const at = latest.at.getTime() > Date.now() ? new Date() : latest.at;
      out.set(row.id, { lastActiveAt: at.toISOString(), lastActiveChannel: latest.channel });
    }
  }
  return out;
}
