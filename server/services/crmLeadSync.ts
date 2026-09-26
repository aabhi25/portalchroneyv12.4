import { storage } from "../storage";
import type { WidgetSettings } from "@shared/schema";
import { hasLeadSquaredCredentials } from "./leadsquaredService";

/**
 * Single-lead CRM sync shared by the business-account Leads page and the
 * group-admin Leads page. Callers are responsible for authorization: the
 * businessAccountId passed in must be one the current user may act on.
 *
 * Returns an HTTP status + JSON body so route handlers can pass the result
 * straight through.
 */
export interface CrmSyncResult {
  status: number;
  body: Record<string, unknown>;
}

export function isLeadSquaredConfigured(settings: WidgetSettings | undefined | null): boolean {
  return !!settings
    && settings.leadsquaredEnabled === 'true'
    && hasLeadSquaredCredentials(settings, { requireRegion: true });
}

export function isSalesforceConfigured(settings: WidgetSettings | undefined | null): boolean {
  return !!settings
    && settings.salesforceEnabled === 'true'
    && !!settings.salesforceClientId
    && !!settings.salesforceClientSecret
    && !!settings.salesforceUsername
    && !!settings.salesforcePassword;
}

export async function syncLeadToLeadSquared(
  businessAccountId: string,
  leadId: string,
): Promise<CrmSyncResult> {
  const settings = await storage.getWidgetSettings(businessAccountId);

  if (!settings || settings.leadsquaredEnabled !== 'true') {
    return { status: 400, body: { error: "LeadSquared integration is not enabled" } };
  }

  if (!hasLeadSquaredCredentials(settings, { requireRegion: true })) {
    return { status: 400, body: { error: "LeadSquared credentials not configured" } };
  }

  // SECURITY: Get the lead scoped to businessAccountId (prevents cross-tenant access)
  const lead = await storage.getLead(leadId, businessAccountId);

  if (!lead) {
    return { status: 404, body: { error: "Lead not found" } };
  }

  // 'disqualified' is terminal: the lead form answer did not match the
  // qualifying values configured for this account, so it must not be pushed
  // manually either. Keeps manual sync consistent with auto and bulk sync.
  if (lead.leadsquaredSyncStatus === 'disqualified') {
    return {
      status: 400,
      body: {
        error: "This lead is not qualified for LeadSquared",
        detail: lead.leadsquaredSyncError || "Its lead form answer did not match the configured qualifying values.",
      },
    };
  }

  const businessAccount = await storage.getBusinessAccount(businessAccountId);

  const {
    createLeadSquaredServiceFromSettings,
    extractUtmCampaign,
    extractUtmSource,
    extractUtmMedium,
    buildJourneyCrmContext,
    buildConversationCrmContext,
  } = await import('./leadsquaredService');
  const leadsquaredService = (await createLeadSquaredServiceFromSettings(settings))!;

  // Get field mappings from database (dynamic, configurable)
  const fieldMappings = await storage.getLeadsquaredFieldMappings(businessAccountId);

  // Journey answers (journey.* mappings) — only queried when a mapping needs them.
  let journeyContext: Record<string, string> = {};
  const needsJourney = fieldMappings.some(m => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('journey.'));
  if (needsJourney) {
    journeyContext = await buildJourneyCrmContext((lead as any).conversationId);
  }

  // Conversation summary/topics (conversation.* mappings) — only queried when needed.
  let conversationContext: { summary?: string | null; topics?: string | null } = {};
  const needsConversation = fieldMappings.some(m => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('conversation.'));
  if (needsConversation) {
    conversationContext = await buildConversationCrmContext((lead as any).conversationId);
  }

  // Build context for dynamic field mapping
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

  console.log('[LeadSquared] Manual sync using dynamic field mappings, count:', fieldMappings.length);

  const result = await leadsquaredService.createLeadWithMappings(fieldMappings, leadContext);

  if (result.success) {
    await storage.updateLead(leadId, businessAccountId, {
      leadsquaredSyncStatus: 'synced',
      leadsquaredSyncedAt: new Date(),
      leadsquaredLeadId: result.leadId,
      leadsquaredSyncError: null,
      leadsquaredSyncPayload: result.syncPayload || null,
      leadsquaredRetryCount: '0',
      leadsquaredNextRetryAt: null,
    });

    console.log('[LeadSquared] Lead synced successfully:', leadId, '→', result.leadId);

    return { status: 200, body: { success: true, message: result.message, leadsquaredLeadId: result.leadId } };
  }

  await storage.updateLead(leadId, businessAccountId, {
    leadsquaredSyncStatus: 'failed',
    leadsquaredSyncError: result.message,
    // Hand the failure to the background retry worker with a fresh retry budget;
    // it gives up early (needs_attention) if the error can't be fixed by retrying.
    leadsquaredRetryCount: '0',
    leadsquaredNextRetryAt: new Date(Date.now() + 60_000),
  });

  return { status: 400, body: { success: false, error: result.message } };
}

export async function syncLeadToSalesforce(businessAccountId: string, leadId: string): Promise<CrmSyncResult> {
  const settings = await storage.getWidgetSettings(businessAccountId);

  if (!settings || settings.salesforceEnabled !== 'true') {
    return { status: 400, body: { error: "Salesforce integration is not enabled" } };
  }
  if (!settings.salesforceClientId || !settings.salesforceClientSecret || !settings.salesforceUsername || !settings.salesforcePassword) {
    return { status: 400, body: { error: "Salesforce credentials not configured" } };
  }

  const lead = await storage.getLead(leadId, businessAccountId);
  if (!lead) return { status: 404, body: { error: "Lead not found" } };

  const businessAccount = await storage.getBusinessAccount(businessAccountId);
  const { decrypt } = await import('./encryptionService');
  const { createSalesforceService } = await import('./salesforceService');
  const { extractUtmCampaign, extractUtmSource, extractUtmMedium } = await import('./leadsquaredService');

  const service = createSalesforceService({
    clientId: settings.salesforceClientId,
    clientSecret: decrypt(settings.salesforceClientSecret),
    username: settings.salesforceUsername,
    password: decrypt(settings.salesforcePassword),
    environment: (settings.salesforceEnvironment || 'production') as 'production' | 'sandbox',
  });

  const fieldMappings = await storage.getSalesforceFieldMappings(businessAccountId);
  const leadContext = {
    lead: { name: lead.name || null, email: lead.email || null, phone: lead.phone || null, whatsapp: null, createdAt: lead.createdAt || null, sourceUrl: lead.sourceUrl || null },
    session: { city: lead.city || null, utmCampaign: extractUtmCampaign(lead.sourceUrl) || null, utmSource: extractUtmSource(lead.sourceUrl) || null, utmMedium: extractUtmMedium(lead.sourceUrl) || null, pageUrl: lead.sourceUrl || null },
    business: { name: businessAccount?.name || null, website: businessAccount?.website || null },
  };

  const result = await service.createLeadWithMappings(fieldMappings, leadContext);

  if (result.success) {
    await storage.updateLead(leadId, businessAccountId, {
      salesforceSyncStatus: 'synced',
      salesforceSyncedAt: new Date(),
      salesforceLeadId: result.leadId,
      salesforceSyncError: null,
    });
    return { status: 200, body: { success: true, message: result.message, salesforceLeadId: result.leadId } };
  }

  await storage.updateLead(leadId, businessAccountId, {
    salesforceSyncStatus: 'failed',
    salesforceSyncError: result.message,
  });
  return { status: 400, body: { success: false, error: result.message } };
}
