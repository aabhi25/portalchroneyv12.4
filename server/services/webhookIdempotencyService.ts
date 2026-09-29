import { db } from "../db";
import { webhookEvents } from "@shared/schema";
import { and, eq, lt, sql } from "drizzle-orm";

// A claim that was never marked processed (the server crashed or restarted mid-way) can be
// taken over by a retry after this long. Longer than the slowest handling (document reading
// is capped at ~110s) so a retry never runs alongside a message still being handled.
const TAKEOVER_AFTER = "4 minutes";
// …but only for recent events; a very old unfinished claim is not replayed.
const TAKEOVER_WINDOW = "30 minutes";

/**
 * Persistent, cross-pod webhook idempotency. Uses a unique constraint on
 * (businessAccountId, source, providerId) so concurrent inserts can never
 * both succeed.
 *
 * Returns true when this is the FIRST time we've seen the event (proceed),
 * false when it's a duplicate (skip). An earlier claim that was released after an
 * error, or never finished, doesn't count as seen.
 */
export const webhookIdempotency = {
  async claim(
    businessAccountId: string,
    source: string,
    providerId: string,
    kind: string = "inbound",
    // Inbound messages: a claim that was never marked processed can be taken over by a retry.
    allowTakeover: boolean = false,
  ): Promise<boolean> {
    if (!providerId) return true;
    try {
      const result: any = allowTakeover ? await db.execute(sql`
        INSERT INTO ${webhookEvents} (business_account_id, source, provider_id, kind, received_at)
        VALUES (${businessAccountId}, ${source}, ${providerId}, ${kind}, NOW())
        ON CONFLICT (business_account_id, source, provider_id) DO UPDATE
          SET received_at = NOW()
          WHERE ${webhookEvents}.processed_at IS NULL
            AND ${webhookEvents}.received_at < NOW() - ${TAKEOVER_AFTER}::interval
            AND ${webhookEvents}.received_at > NOW() - ${TAKEOVER_WINDOW}::interval
        RETURNING id;
      `) : await db.execute(sql`
        INSERT INTO ${webhookEvents} (business_account_id, source, provider_id, kind, received_at, processed_at)
        VALUES (${businessAccountId}, ${source}, ${providerId}, ${kind}, NOW(), NOW())
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

  /** The event was handled: later deliveries of it are duplicates for good. */
  async markProcessed(businessAccountId: string, source: string, providerId: string): Promise<void> {
    if (!providerId) return;
    try {
      await db.execute(sql`
        UPDATE ${webhookEvents} SET processed_at = NOW()
        WHERE business_account_id = ${businessAccountId} AND source = ${source} AND provider_id = ${providerId};
      `);
    } catch (err: any) {
      console.error("[webhookIdempotency] markProcessed error:", err?.message || err);
    }
  },

  /** Handling failed: forget the claim so a retry of the same event is processed. */
  async release(businessAccountId: string, source: string, providerId: string): Promise<void> {
    if (!providerId) return;
    try {
      await db.execute(sql`
        DELETE FROM ${webhookEvents}
        WHERE business_account_id = ${businessAccountId} AND source = ${source} AND provider_id = ${providerId}
          AND processed_at IS NULL;
      `);
    } catch (err: any) {
      console.error("[webhookIdempotency] release error:", err?.message || err);
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
