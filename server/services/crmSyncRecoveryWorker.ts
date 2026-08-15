import { db } from "../db";
import { sql } from "drizzle-orm";
import { whatsappFlowService } from "./whatsappFlowService";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 90_000;
const LOOKBACK_DAYS = 3;

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

    setTimeout(() => this.processRecoveries(), INITIAL_DELAY_MS);

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

  async processRecoveries() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const rows = await db.execute(sql`
        SELECT DISTINCT ON (wfs.id)
          wfs.id            AS session_id,
          wfs.collected_data
        FROM whatsapp_flow_sessions wfs
        INNER JOIN whatsapp_leads wl
          ON wl.flow_session_id = wfs.id
          AND wl.customer_name IS NOT NULL
          AND wl.customer_name <> ''
          AND (wl.custom_crm_sync_status IS NULL OR wl.custom_crm_sync_status = '')
        INNER JOIN custom_crm_settings ccs
          ON ccs.business_account_id = wfs.business_account_id
          AND ccs.enabled = true
          AND ccs.auto_sync_enabled = true
        WHERE wfs.status = 'completed'
          AND wfs.last_message_at > NOW() - (${LOOKBACK_DAYS} || ' days')::interval
        ORDER BY wfs.id, wfs.last_message_at DESC
        LIMIT 20
      `);

      const sessions = rows.rows as { session_id: string; collected_data: Record<string, any> }[];

      if (sessions.length === 0) return;

      console.log(`[CRM Recovery] Found ${sessions.length} unsynced completed session(s) — retrying`);

      for (const { session_id, collected_data } of sessions) {
        try {
          await whatsappFlowService.triggerCrmAutoSync(
            session_id,
            (collected_data as Record<string, any>) || {}
          );
          console.log(`[CRM Recovery] Triggered sync for session ${session_id}`);
        } catch (err) {
          console.error(`[CRM Recovery] Error syncing session ${session_id}:`, err);
        }
      }
    } catch (err) {
      console.error("[CRM Recovery] Worker error:", err);
    } finally {
      this.isProcessing = false;
    }
  }
}

export const crmSyncRecoveryWorker = new CrmSyncRecoveryWorker();
