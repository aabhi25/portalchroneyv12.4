import { trackTimer } from "../lib/lifecycle";
import { reportError } from "../lib/errorReporter";
import { storage } from "../storage";
import { db } from "../db";
import { leads } from "@shared/schema";
import { and, lte, lt, sql, or, isNull, inArray, asc } from "drizzle-orm";
import { classifyLeadsquaredError } from "./leadsquaredService";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// Wait after each failed attempt: 8 attempts spread over ~2 days, so a
// LeadSquared / UDS outage (or an overnight network problem) doesn't strand leads.
export const LSQ_RETRY_DELAYS_MS = [1 * MINUTE, 5 * MINUTE, 15 * MINUTE, 1 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR];
export const LSQ_MAX_RETRY_COUNT = LSQ_RETRY_DELAYS_MS.length;
const RETRY_DELAYS_MS = LSQ_RETRY_DELAYS_MS;
const MAX_RETRY_COUNT = LSQ_MAX_RETRY_COUNT;
const CHECK_INTERVAL_MS = 2 * 60 * 1000;
// An automatic sync marks the lead 'pending' just before sending. If it is still
// pending after this long (server restarted/crashed mid-sync), the worker takes over.
export const LSQ_PENDING_TIMEOUT_MS = 10 * MINUTE;
const PENDING_TIMEOUT_MS = LSQ_PENDING_TIMEOUT_MS;
// Instagram/Facebook leads never attempted (no contact info yet at capture) are picked up for this long.
const SOCIAL_LOOKBACK_MS = 3 * 24 * HOUR;

export function getNextRetryDelay(retryCount: number): number {
  return RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
}

/**
 * Called by automatic syncs right before sending a lead. If the process dies
 * before the sync records its result, the worker retries it once the deadline
 * passes. Leads whose sync is deliberately held back (e.g. awaiting OTP/CAPTCHA
 * verification) never get marked, so they are never pushed by the worker.
 */
export async function markLeadsquaredSyncPending(leadId: string, businessAccountId: string): Promise<void> {
  try {
    await storage.updateLead(leadId, businessAccountId, {
      leadsquaredSyncStatus: 'pending',
      leadsquaredNextRetryAt: new Date(Date.now() + PENDING_TIMEOUT_MS),
    });
  } catch (err) {
    // Never block the sync itself on the safety net.
    console.error('[LSQ Retry] Failed to mark lead pending (continuing):', err);
  }
}

export class LeadsquaredRetryWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;

  start() {
    if (this.isRunning) {
      console.log('[LSQ Retry] Worker already running');
      return;
    }

    this.isRunning = true;
    console.log('[LSQ Retry] Starting background retry worker (every 2 min)');

    this.intervalId = setInterval(async () => {
      await this.processRetries();
    }, CHECK_INTERVAL_MS);

    trackTimer(setTimeout(() => this.processRetries(), 30_000));
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[LSQ Retry] Worker stopped');
  }

  private async recordFailure(leadId: string, businessAccountId: string, currentRetryCount: number, message: string) {
    const newRetryCount = currentRetryCount + 1;
    if (classifyLeadsquaredError(message) === 'permanent') {
      await storage.updateLead(leadId, businessAccountId, {
        leadsquaredSyncStatus: 'needs_attention',
        leadsquaredSyncError: message,
        leadsquaredRetryCount: String(newRetryCount),
        leadsquaredNextRetryAt: null,
      });
      console.log(`[LSQ Retry] Lead ${leadId} needs attention (not retrying): ${message}`);
    } else if (newRetryCount >= MAX_RETRY_COUNT) {
      await storage.updateLead(leadId, businessAccountId, {
        leadsquaredSyncStatus: 'permanently_failed',
        leadsquaredSyncError: message,
        leadsquaredRetryCount: String(newRetryCount),
        leadsquaredNextRetryAt: null,
      });
      console.log(`[LSQ Retry] Lead ${leadId} permanently failed after ${newRetryCount} attempts: ${message}`);
    } else {
      const nextRetryAt = new Date(Date.now() + getNextRetryDelay(newRetryCount));
      await storage.updateLead(leadId, businessAccountId, {
        leadsquaredSyncStatus: 'failed',
        leadsquaredSyncError: message,
        leadsquaredRetryCount: String(newRetryCount),
        leadsquaredNextRetryAt: nextRetryAt,
      });
      console.log(`[LSQ Retry] Lead ${leadId} failed attempt ${newRetryCount}/${MAX_RETRY_COUNT}, next retry at ${nextRetryAt.toISOString()}: ${message}`);
    }
  }

  /**
   * Instagram / Facebook leads (same schedule and statuses as website leads):
   *   - 'failed' leads whose retry is due, and 'pending' claims whose holder died;
   *   - leads from the last few days that were never attempted but now have a phone/email
   *     (e.g. the DM gave the name first and the number later), for accounts with LeadSquared on.
   * This only nominates; each lead is claimed atomically inside syncSocialLeadToLeadSquared.
   */
  async processSocialRetries() {
    const { syncSocialLeadToLeadSquared } = await import('./socialLeadCrmSync');
    const { reachableContactSql, SOCIAL_LEAD_TABLE } = await import('./socialLeadFields');
    const nowIso = new Date().toISOString();
    const lookbackIso = new Date(Date.now() - SOCIAL_LOOKBACK_MS).toISOString();
    for (const channel of ['instagram', 'facebook'] as const) {
      try {
        const table = sql.raw(`"${SOCIAL_LEAD_TABLE[channel]}"`);
        const res = await db.execute(sql`
          SELECT l.id
          FROM ${table} l
          WHERE (
            l.leadsquared_sync_status IN ('failed', 'pending')
            AND l.leadsquared_retry_count < ${MAX_RETRY_COUNT}
            AND (l.leadsquared_next_retry_at IS NULL OR l.leadsquared_next_retry_at <= ${nowIso}::timestamp)
          ) OR (
            (l.leadsquared_sync_status IS NULL OR l.leadsquared_sync_status = '')
            AND l.received_at > ${lookbackIso}::timestamp
            AND ${reachableContactSql('l')}
            AND EXISTS (SELECT 1 FROM widget_settings ws
                        WHERE ws.business_account_id = l.business_account_id AND ws.leadsquared_enabled = 'true')
          )
          ORDER BY l.leadsquared_next_retry_at ASC NULLS LAST, l.received_at ASC
          LIMIT 50
        `);
        for (const row of res.rows as { id: string }[]) {
          try {
            const r = await syncSocialLeadToLeadSquared(channel, row.id, { mode: 'retry', source: 'retry' });
            if (!r.skipped) console.log(`[LSQ Retry] ${channel} lead ${row.id} → ${r.status}`);
          } catch (err: any) {
            console.error(`[LSQ Retry] ${channel} lead ${row.id} error:`, err?.message);
          }
        }
      } catch (err: any) {
        console.error(`[LSQ Retry] ${channel} leads error:`, err?.message);
      }
    }
  }

  async processRetries() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = new Date();
      const retryableLeads = await db
        .select()
        .from(leads)
        .where(
          and(
            inArray(leads.leadsquaredSyncStatus, ['failed', 'pending']),
            lt(sql`COALESCE(${leads.leadsquaredRetryCount}::int, 0)`, MAX_RETRY_COUNT),
            or(
              isNull(leads.leadsquaredNextRetryAt),
              lte(leads.leadsquaredNextRetryAt, now)
            )
          )
        )
        // Oldest-due first so one account's backlog can't starve the rest.
        .orderBy(sql`${leads.leadsquaredNextRetryAt} ASC NULLS FIRST`, asc(leads.createdAt))
        .limit(50);

      if (retryableLeads.length === 0) {
        await this.processSocialRetries();
        return;
      }

      console.log(`[LSQ Retry] Found ${retryableLeads.length} lead(s) to retry`);

      const accountLeads = new Map<string, typeof retryableLeads>();
      for (const lead of retryableLeads) {
        const existing = accountLeads.get(lead.businessAccountId) || [];
        existing.push(lead);
        accountLeads.set(lead.businessAccountId, existing);
      }

      for (const [businessAccountId, accountRetryLeads] of accountLeads) {
        try {
          const settings = await storage.getWidgetSettings(businessAccountId);
          const { hasLeadSquaredCredentials, createLeadSquaredServiceFromSettings, extractUtmCampaign, extractUtmSource, extractUtmMedium, buildJourneyCrmContext, buildConversationCrmContext } = await import('./leadsquaredService');
          if (!settings || settings.leadsquaredEnabled !== 'true' || !hasLeadSquaredCredentials(settings)) {
            // Park these instead of re-selecting them every run (which would starve
            // other accounts' retries). Manual sync picks them up once fixed.
            for (const lead of accountRetryLeads) {
              await storage.updateLead(lead.id, businessAccountId, {
                leadsquaredSyncStatus: 'needs_attention',
                leadsquaredSyncError: 'LeadSquared is off or its credentials are missing for this account',
                leadsquaredNextRetryAt: null,
              });
            }
            console.log(`[LSQ Retry] Account ${businessAccountId}: LeadSquared off/unconfigured — ${accountRetryLeads.length} lead(s) marked needs_attention`);
            continue;
          }

          const leadsquaredService = (await createLeadSquaredServiceFromSettings(settings))!;

          const fieldMappings = await storage.getLeadsquaredFieldMappings(businessAccountId);
          const businessAccount = await storage.getBusinessAccount(businessAccountId);

          // Do any mappings need journey.* / conversation.* resolution? Computed once per account.
          const needsJourney = fieldMappings.some(m => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('journey.'));
          const needsConversation = fieldMappings.some(m => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('conversation.'));

          for (const lead of accountRetryLeads) {
            const currentRetryCount = parseInt(lead.leadsquaredRetryCount || '0', 10);

            try {
              // Resolve journey/conversation context per-lead, same as the live capture,
              // manual, and bulk sync paths. Absent course/summary/topics are omitted.
              const journeyContext: Record<string, string> = needsJourney ? await buildJourneyCrmContext((lead as any).conversationId) : {};
              const conversationContext: { summary?: string | null; topics?: string | null } = needsConversation ? await buildConversationCrmContext((lead as any).conversationId) : {};
              const leadContext = {
                lead: {
                  name: lead.name || null,
                  email: lead.email || null,
                  phone: lead.phone || null,
                  whatsapp: null,
                  createdAt: lead.createdAt || null,
                  sourceUrl: lead.sourceUrl || null,
                },
                session: {
                  city: lead.city || null,
                  utmCampaign: extractUtmCampaign(lead.sourceUrl) || null,
                  utmSource: extractUtmSource(lead.sourceUrl) || null,
                  utmMedium: extractUtmMedium(lead.sourceUrl) || null,
                  pageUrl: lead.sourceUrl || null,
                },
                business: {
                  name: businessAccount?.name || null,
                  website: businessAccount?.website || null,
                },
                ...(Object.keys(journeyContext).length ? { journey: journeyContext } : {}),
                ...(conversationContext.summary || conversationContext.topics ? { conversation: conversationContext } : {}),
              };

              const result = await leadsquaredService.createLeadWithMappings(fieldMappings, leadContext);

              if (result.success) {
                await storage.updateLead(lead.id, businessAccountId, {
                  leadsquaredSyncStatus: 'synced',
                  leadsquaredSyncedAt: new Date(),
                  // UDS may not return an ID; keep any ID we already have.
                  ...(result.leadId ? { leadsquaredLeadId: result.leadId } : {}),
                  leadsquaredSyncError: null,
                  leadsquaredSyncPayload: result.syncPayload || null,
                  leadsquaredRetryCount: '0',
                  leadsquaredNextRetryAt: null,
                });
                console.log(`[LSQ Retry] Successfully synced lead ${lead.id} on attempt ${currentRetryCount + 1}`);
              } else {
                await this.recordFailure(lead.id, businessAccountId, currentRetryCount, result.message);
              }
            } catch (syncError: any) {
              await this.recordFailure(lead.id, businessAccountId, currentRetryCount, syncError.message);
            }
          }
        } catch (accountError: any) {
          console.error(`[LSQ Retry] Error processing account ${businessAccountId}:`, accountError.message);
        }
      }
      await this.processSocialRetries();
    } catch (error) {
      console.error('[LSQ Retry] Worker error:', error);
      reportError(error, { source: 'worker:leadsquared-retry' });
    } finally {
      this.isProcessing = false;
    }
  }
}

export const leadsquaredRetryWorker = new LeadsquaredRetryWorker();
