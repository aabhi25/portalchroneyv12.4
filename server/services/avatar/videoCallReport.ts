import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { avatarSessions, leads } from "@shared/schema";

export interface VideoCallReport {
  days: number;
  /** Calls whose video actually connected. */
  calls: number;
  /** Taps that never connected (refused, slow, failed). */
  failedStarts: number;
  minutes: number;
  avgMinutes: number;
  /** Leads captured in a chat that had a video call. */
  leads: number;
  handoffClicks: number;
  /** Why calls ended, most common first. */
  endReasons: { reason: string; count: number }[];
  /** Calls that ended in the first 30 seconds (drop-offs). */
  earlyDropoffs: number;
}

/** The account's video calls over the last `days` days (Website chat › Settings › Avatar › Video call). */
export async function videoCallReport(businessAccountId: string, days = 30): Promise<VideoCallReport> {
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const rows = await db.select({
    connectedAt: avatarSessions.connectedAt,
    billedSeconds: avatarSessions.billedSeconds,
    endReason: avatarSessions.endReason,
    conversationId: avatarSessions.conversationId,
    metadata: avatarSessions.metadata,
  }).from(avatarSessions)
    .where(and(eq(avatarSessions.businessAccountId, businessAccountId), gte(avatarSessions.startedAt, since)));

  const connected = rows.filter(r => r.connectedAt);
  const seconds = connected.reduce((n, r) => n + (r.billedSeconds || 0), 0);
  const reasons = new Map<string, number>();
  for (const r of connected) {
    const key = r.endReason || "in_progress";
    reasons.set(key, (reasons.get(key) || 0) + 1);
  }
  const conversationIds = Array.from(new Set(connected.map(r => r.conversationId).filter((id): id is string => !!id)));
  let leadCount = 0;
  if (conversationIds.length) {
    const [row] = await db.select({ n: sql<number>`count(DISTINCT ${leads.id})::int` }).from(leads)
      .where(and(eq(leads.businessAccountId, businessAccountId), inArray(leads.conversationId, conversationIds)));
    leadCount = row?.n ?? 0;
  }
  const minutes = Math.round((seconds / 60) * 10) / 10;
  return {
    days,
    calls: connected.length,
    failedStarts: rows.length - connected.length,
    minutes,
    avgMinutes: connected.length ? Math.round((seconds / 60 / connected.length) * 10) / 10 : 0,
    leads: leadCount,
    handoffClicks: connected.filter(r => (r.metadata as any)?.handoffClicked).length,
    endReasons: Array.from(reasons.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    earlyDropoffs: connected.filter(r => (r.billedSeconds || 0) < 30 && r.endReason === "visitor_closed").length,
  };
}
