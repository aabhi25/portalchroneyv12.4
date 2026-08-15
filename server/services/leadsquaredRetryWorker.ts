import { storage } from "../storage";
import { db } from "../db";
import { leads } from "@shared/schema";
import { and, eq, lte, lt, isNotNull, sql, or, isNull } from "drizzle-orm";

const MAX_RETRY_COUNT = 3;
const RETRY_DELAYS_MS = [
  1 * 60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
];
const CHECK_INTERVAL_MS = 2 * 60 * 1000;

function getNextRetryDelay(retryCount: number): number {
  return RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
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

    setTimeout(() => this.processRetries(), 30_000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[LSQ Retry] Worker stopped');
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
            eq(leads.leadsquaredSyncStatus, 'failed'),
            lt(sql`COALESCE(${leads.leadsquaredRetryCount}::int, 0)`, MAX_RETRY_COUNT),
            or(
              isNull(leads.leadsquaredNextRetryAt),
              lte(leads.leadsquaredNextRetryAt, now)
            )
          )
        )
        .limit(50);

      if (retryableLeads.length === 0) {
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
          if (!settings || settings.leadsquaredEnabled !== 'true' || !settings.leadsquaredAccessKey || !settings.leadsquaredSecretKey) {
            continue;
          }

          const { decrypt } = await import('./encryptionService');
          const decryptedSecretKey = decrypt(settings.leadsquaredSecretKey);

          const { createLeadSquaredService, extractUtmCampaign, extractUtmSource, extractUtmMedium, buildJourneyCrmContext, buildConversationCrmContext } = await import('./leadsquaredService');
          const leadsquaredService = await createLeadSquaredService({
            accessKey: settings.leadsquaredAccessKey,
            secretKey: decryptedSecretKey,
            region: (settings.leadsquaredRegion as 'india' | 'us' | 'other') || 'other',
            customHost: settings.leadsquaredCustomHost || undefined,
          });

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
                  leadsquaredLeadId: result.leadId,
                  leadsquaredSyncError: null,
                  leadsquaredSyncPayload: result.syncPayload || null,
                });
                console.log(`[LSQ Retry] Successfully synced lead ${lead.id} on attempt ${currentRetryCount + 1}`);
              } else {
                const newRetryCount = currentRetryCount + 1;
                if (newRetryCount >= MAX_RETRY_COUNT) {
                  await storage.updateLead(lead.id, businessAccountId, {
                    leadsquaredSyncStatus: 'permanently_failed',
                    leadsquaredSyncError: result.message,
                    leadsquaredRetryCount: String(newRetryCount),
                    leadsquaredNextRetryAt: null,
                  });
                  console.log(`[LSQ Retry] Lead ${lead.id} permanently failed after ${newRetryCount} attempts`);
                } else {
                  const nextRetryAt = new Date(Date.now() + getNextRetryDelay(newRetryCount));
                  await storage.updateLead(lead.id, businessAccountId, {
                    leadsquaredSyncStatus: 'failed',
                    leadsquaredSyncError: result.message,
                    leadsquaredRetryCount: String(newRetryCount),
                    leadsquaredNextRetryAt: nextRetryAt,
                  });
                  console.log(`[LSQ Retry] Lead ${lead.id} failed attempt ${newRetryCount}/${MAX_RETRY_COUNT}, next retry at ${nextRetryAt.toISOString()}`);
                }
              }
            } catch (syncError: any) {
              const newRetryCount = currentRetryCount + 1;
              if (newRetryCount >= MAX_RETRY_COUNT) {
                await storage.updateLead(lead.id, businessAccountId, {
                  leadsquaredSyncStatus: 'permanently_failed',
                  leadsquaredSyncError: syncError.message,
                  leadsquaredRetryCount: String(newRetryCount),
                  leadsquaredNextRetryAt: null,
                });
                console.log(`[LSQ Retry] Lead ${lead.id} permanently failed after ${newRetryCount} attempts: ${syncError.message}`);
              } else {
                const nextRetryAt = new Date(Date.now() + getNextRetryDelay(newRetryCount));
                await storage.updateLead(lead.id, businessAccountId, {
                  leadsquaredSyncStatus: 'failed',
                  leadsquaredSyncError: syncError.message,
                  leadsquaredRetryCount: String(newRetryCount),
                  leadsquaredNextRetryAt: nextRetryAt,
                });
                console.log(`[LSQ Retry] Lead ${lead.id} error on attempt ${newRetryCount}/${MAX_RETRY_COUNT}: ${syncError.message}`);
              }
            }
          }
        } catch (accountError: any) {
          console.error(`[LSQ Retry] Error processing account ${businessAccountId}:`, accountError.message);
        }
      }
    } catch (error) {
      console.error('[LSQ Retry] Worker error:', error);
    } finally {
      this.isProcessing = false;
    }
  }
}

export const leadsquaredRetryWorker = new LeadsquaredRetryWorker();
