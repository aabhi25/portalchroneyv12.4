import { db } from "../db";
import { webhookEvents } from "@shared/schema";
import { and, eq, lt, sql } from "drizzle-orm";

/**
 * Persistent, cross-pod webhook idempotency. Uses a unique constraint on
 * (businessAccountId, source, providerId) so concurrent inserts can never
 * both succeed.
 *
 * Returns true when this is the FIRST time we've seen the event (proceed),
 * false when it's a duplicate (skip).
 */
export const webhookIdempotency = {
  async claim(
    businessAccountId: string,
    source: string,
    providerId: string,
    kind: string = "inbound",
  ): Promise<boolean> {
    if (!providerId) return true;
    try {
      const result: any = await db.execute(sql`
        INSERT INTO ${webhookEvents} (business_account_id, source, provider_id, kind, received_at)
        VALUES (${businessAccountId}, ${source}, ${providerId}, ${kind}, NOW())
        ON CONFLICT (business_account_id, source, provider_id) DO NOTHING
        RETURNING id;
      `);
      const rows: any[] = (result?.rows as any[]) ?? [];
      return rows.length > 0;
    } catch (err: any) {
      // Don't lose webhooks on transient DB errors — fall back to allowing the event through.
      console.error("[webhookIdempotency] claim error (allowing through):", err?.message || err);
      return true;
    }
  },

  /**
   * Periodic cleanup — delete rows older than `days` to bound table size.
   * Default 14 days (long enough that a replay attack window is closed; matches campaign attribution window).
   */
  async cleanupOlderThan(days = 14): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result: any = await db.execute(sql`
      DELETE FROM ${webhookEvents}
      WHERE received_at < ${cutoff}
      RETURNING id;
    `);
    const rows: any[] = (result?.rows as any[]) ?? [];
    return rows.length;
  },
};

let cleanupStarted = false;
export function startWebhookCleanupJob(): void {
  if (cleanupStarted) return;
  cleanupStarted = true;
  // Once a day
  setInterval(() => {
    webhookIdempotency.cleanupOlderThan(14)
      .then(n => { if (n > 0) console.log(`[webhookIdempotency] Cleaned ${n} old events`); })
      .catch(err => console.error("[webhookIdempotency] cleanup error:", err));
  }, 24 * 60 * 60 * 1000);
}
