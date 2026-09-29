import { trackTimer } from "../lib/lifecycle";
import { reportError } from "../lib/errorReporter";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { syncWhatsappLeadToCustomCrm, CRM_CLAIM_STALE_MS } from "./customCrmService";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 90_000;
const LOOKBACK_DAYS = 3;
const BATCH_SIZE = 20;

export class CrmSyncRecoveryWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;

  start() {
    if (this.isRunning) {
      console.log("[CRM Recovery] Worker already running");
      return;
    }
    this.isRunning = true;
    console.log("[CRM Recovery] Starting outbox recovery worker (every 5 min, first run in 90s)");

    trackTimer(setTimeout(() => this.processRecoveries(), INITIAL_DELAY_MS));

    this.intervalId = setInterval(async () => {
      await this.processRecoveries();
    }, CHECK_INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("[CRM Recovery] Worker stopped");
  }

  /**
   * Instagram / Facebook leads, same three cases as WhatsApp (never attempted and now
   * reachable, failed with a due retry, stale 'pending' claim). Claimed atomically inside
   * syncSocialLeadToCustomCrm.
   */
  private async processSocialRecoveries(nowIso: string, staleIso: string, lookbackIso: string) {
    const { syncSocialLeadToCustomCrm } = await import("./socialLeadCrmSync");
    const { reachableContactSql, SOCIAL_LEAD_TABLE } = await import("./socialLeadFields");
    for (const channel of ["instagram", "facebook"] as const) {
      try {
        const table = sql.raw(`"${SOCIAL_LEAD_TABLE[channel]}"`);
        const res = await db.execute(sql`
          SELECT l.id AS lead_id, l.custom_crm_sync_status AS status
          FROM ${table} l
          INNER JOIN custom_crm_settings ccs
            ON ccs.business_account_id = l.business_account_id
            AND ccs.enabled = true
            AND ccs.auto_sync_enabled = true
          WHERE (
              (l.custom_crm_sync_status IS NULL OR l.custom_crm_sync_status = '')
              AND l.received_at > ${lookbackIso}::timestamp
              AND ${reachableContactSql("l")}
            )
            OR (
              l.custom_crm_sync_status = 'failed'
              AND l.custom_crm_sync_payload->'_crmSync'->>'retryable' = 'true'
              AND (l.custom_crm_sync_payload->'_crmSync'->>'nextRetryAt')::timestamptz <= ${nowIso}::timestamptz
            )
            OR (
              l.custom_crm_sync_status = 'pending'
              AND (l.custom_crm_sync_payload->'_crmSync'->>'claimedAt')::timestamptz < ${staleIso}::timestamptz
            )
          ORDER BY l.updated_at ASC
          LIMIT ${BATCH_SIZE}
        `);
        for (const { lead_id, status } of res.rows as { lead_id: string; status: string | null }[]) {
          try {
            const result = await syncSocialLeadToCustomCrm(channel, lead_id, { mode: "retry", source: "recovery", requireAutoSync: true });
            console.log(`[CRM Recovery] ${channel} lead ${lead_id} (was ${status ?? "unsynced"}) → ${result.skipped ? `skipped: ${result.skipped}` : result.status}`);
          } catch (err: any) {
            console.error(`[CRM Recovery] Error syncing ${channel} lead ${lead_id}:`, err?.message);
          }
        }
      } catch (err: any) {
        console.error(`[CRM Recovery] ${channel} leads error:`, err?.message);
      }
    }
  }

  /**
   * Picks up three kinds of WhatsApp leads for auto-sync businesses:
   *   1. never attempted (status NULL) after their flow completed — the original outbox case;
   *   2. 'failed' with a scheduled retry that is now due (capped exponential backoff,
   *      permanent errors and unknown outcomes are never scheduled);
   *   3. 'pending' claims older than CRM_CLAIM_STALE_MS (the instance that held them died).
   * This SELECT only nominates candidates. Every lead is then claimed atomically inside
   * syncWhatsappLeadToCustomCrm, so when several server instances run this worker at
   * once each lead is still pushed by exactly one of them.
   */
  async processRecoveries() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const nowIso = new Date().toISOString();
      const staleIso = new Date(Date.now() - CRM_CLAIM_STALE_MS).toISOString();
      const lookbackIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

      const rows = await db.execute(sql`
        SELECT wl.id AS lead_id, wl.custom_crm_sync_status AS status
        FROM whatsapp_leads wl
        INNER JOIN custom_crm_settings ccs
          ON ccs.business_account_id = wl.business_account_id
          AND ccs.enabled = true
          AND ccs.auto_sync_enabled = true
        WHERE wl.customer_name IS NOT NULL
          AND wl.customer_name <> ''
          AND (
            (
              (wl.custom_crm_sync_status IS NULL OR wl.custom_crm_sync_status = '')
              AND EXISTS (
                SELECT 1 FROM whatsapp_flow_sessions wfs
                WHERE wfs.id = wl.flow_session_id
                  AND wfs.status = 'completed'
                  AND wfs.last_message_at > ${lookbackIso}::timestamptz
              )
            )
            OR (
              wl.custom_crm_sync_status = 'failed'
              AND wl.custom_crm_sync_payload->'_crmSync'->>'retryable' = 'true'
              AND (wl.custom_crm_sync_payload->'_crmSync'->>'nextRetryAt')::timestamptz <= ${nowIso}::timestamptz
            )
            OR (
              wl.custom_crm_sync_status = 'pending'
              AND (wl.custom_crm_sync_payload->'_crmSync'->>'claimedAt')::timestamptz < ${staleIso}::timestamptz
            )
          )
        ORDER BY wl.updated_at ASC
        LIMIT ${BATCH_SIZE}
      `);

      const leads = rows.rows as { lead_id: string; status: string | null }[];

      await this.processSocialRecoveries(nowIso, staleIso, lookbackIso);

      if (leads.length === 0) return;

      console.log(`[CRM Recovery] Found ${leads.length} lead(s) to sync/retry`);

      for (const { lead_id, status } of leads) {
        try {
          const result = await syncWhatsappLeadToCustomCrm(lead_id, {
            source: 'recovery',
            respectBackoff: true,
            requireAutoSync: true,
          });
          if (result.skipped) {
            console.log(`[CRM Recovery] Lead ${lead_id} (was ${status ?? 'unsynced'}) skipped: ${result.skipped}`);
          } else {
            console.log(`[CRM Recovery] Lead ${lead_id} (was ${status ?? 'unsynced'}) → ${result.status}${result.retryScheduledAt ? `, next retry ${result.retryScheduledAt}` : ''}`);
          }
        } catch (err) {
          console.error(`[CRM Recovery] Error syncing lead ${lead_id}:`, err);
        }
      }
    } catch (err) {
      console.error("[CRM Recovery] Worker error:", err);
      reportError(err, { source: "worker:crm-sync-recovery" });
    } finally {
      this.isProcessing = false;
    }
  }
}

export const crmSyncRecoveryWorker = new CrmSyncRecoveryWorker();
