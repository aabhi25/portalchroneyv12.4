import { db } from "../db";
import { urgencyOfferSettings, urgencyOffers, conversations, messages, businessAccounts, leads } from "@shared/schema";
import { eq, and, desc, gte, or, sql, asc } from "drizzle-orm";
import OpenAI from "openai";
import { randomBytes } from "crypto";

async function getOpenAIForBusiness(businessAccountId: string): Promise<OpenAI | null> {
  const businessAccount = await db.query.businessAccounts.findFirst({
    where: eq(businessAccounts.id, businessAccountId)
  });
  
  const apiKey = businessAccount?.openaiApiKey || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.error('[UrgencyOffer] No OpenAI API key available for business:', businessAccountId);
    return null;
  }
  
  return new OpenAI({ apiKey });
}

export interface PurchaseIntentResult {
  hasHighIntent: boolean;
  confidence: number;
  triggerMessage: string | null;
  signals: string[];
}

export async function detectPurchaseIntent(
  businessAccountId: string,
  conversationHistory: Array<{ role: string; content: string }>,
  threshold: number = 70
): Promise<PurchaseIntentResult> {
  if (conversationHistory.length === 0) {
    return { hasHighIntent: false, confidence: 0, triggerMessage: null, signals: [] };
  }

  const openai = await getOpenAIForBusiness(businessAccountId);
  if (!openai) {
    return { hasHighIntent: false, confidence: 0, triggerMessage: null, signals: [] };
  }

  const recentMessages = conversationHistory.slice(-10);
  const conversationText = recentMessages
    .map((m) => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.content}`)
    .join('\n');

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an AI that analyzes customer conversations to detect purchase intent signals.
          
Analyze the conversation and identify if the customer shows HIGH PURCHASE INTENT. Look for:
- Questions about pricing, costs, or payment plans
- Asking about discounts, offers, or deals
- Requesting a demo, trial, or quote
- Comparing options or asking "which one should I choose"
- Questions about availability, delivery, or shipping
- Asking about features that indicate serious consideration
- Phrases like "I'm interested", "I want to buy", "I'm looking for", "I need"
- Questions about warranty, returns, or support (post-purchase concerns)

Respond with a JSON object:
{
  "hasHighIntent": boolean,
  "confidence": number (0-100),
  "signals": ["list of detected signals"],
  "triggerMessage": "the specific customer message that shows highest intent, or null"
}`
        },
        {
          role: "user",
          content: `Analyze this conversation for purchase intent:\n\n${conversationText}`
        }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    
    return {
      hasHighIntent: result.hasHighIntent && result.confidence >= threshold,
      confidence: result.confidence || 0,
      triggerMessage: result.triggerMessage || null,
      signals: result.signals || []
    };
  } catch (error) {
    console.error('[UrgencyOffer] Error detecting purchase intent:', error);
    return { hasHighIntent: false, confidence: 0, triggerMessage: null, signals: [] };
  }
}

export async function getUrgencyOfferSettings(businessAccountId: string) {
  return await db.query.urgencyOfferSettings.findFirst({
    where: eq(urgencyOfferSettings.businessAccountId, businessAccountId),
    orderBy: [asc(urgencyOfferSettings.priority)]
  });
}

export async function getAllCampaigns(businessAccountId: string) {
  return await db.query.urgencyOfferSettings.findMany({
    where: eq(urgencyOfferSettings.businessAccountId, businessAccountId),
    orderBy: [asc(urgencyOfferSettings.priority)]
  });
}

export async function getCampaignById(campaignId: string) {
  return await db.query.urgencyOfferSettings.findFirst({
    where: eq(urgencyOfferSettings.id, campaignId)
  });
}

export async function upsertCampaign(
  businessAccountId: string,
  settings: Partial<typeof urgencyOfferSettings.$inferInsert> & { id?: string }
) {
  const { id: campaignId, ...settingsData } = settings;

  if (campaignId) {
    const existing = await getCampaignById(campaignId);
    if (existing) {
      const [updated] = await db.update(urgencyOfferSettings)
        .set({ ...settingsData, updatedAt: new Date() })
        .where(eq(urgencyOfferSettings.id, campaignId))
        .returning();
      return updated;
    }
  }

  const [created] = await db.insert(urgencyOfferSettings)
    .values({ businessAccountId, ...settingsData })
    .returning();
  return created;
}

export async function deleteCampaign(campaignId: string) {
  const [deleted] = await db.delete(urgencyOfferSettings)
    .where(eq(urgencyOfferSettings.id, campaignId))
    .returning();
  return deleted;
}

export async function getActiveOffer(businessAccountId: string, visitorToken: string, campaignId?: string) {
  const now = new Date();
  
  const conditions = [
    eq(urgencyOffers.businessAccountId, businessAccountId),
    eq(urgencyOffers.visitorToken, visitorToken),
    eq(urgencyOffers.status, 'active'),
    gte(urgencyOffers.countdownExpiresAt, now)
  ];

  if (campaignId) {
    conditions.push(eq(urgencyOffers.campaignId, campaignId));
  }

  return await db.query.urgencyOffers.findFirst({
    where: and(...conditions),
    orderBy: [desc(urgencyOffers.createdAt)]
  });
}

export async function getOfferByVisitorToken(businessAccountId: string, visitorToken: string, campaignId?: string) {
  const conditions = [
    eq(urgencyOffers.businessAccountId, businessAccountId),
    eq(urgencyOffers.visitorToken, visitorToken)
  ];

  if (campaignId) {
    conditions.push(eq(urgencyOffers.campaignId, campaignId));
  }

  return await db.query.urgencyOffers.findFirst({
    where: and(...conditions),
    orderBy: [desc(urgencyOffers.createdAt)]
  });
}

function generateDiscountCode(): string {
  return 'SAVE' + randomBytes(4).toString('hex').toUpperCase();
}

export async function startUrgencyOffer(
  businessAccountId: string,
  visitorToken: string,
  conversationId: string | null,
  intentScore: number,
  triggerMessage: string | null,
  campaignId: string,
  campaignSettings: typeof urgencyOfferSettings.$inferSelect
) {
  if (!campaignSettings.isEnabled) {
    throw new Error('Urgency offers are not enabled for this campaign');
  }

  const existingOffer = await getOfferByVisitorToken(businessAccountId, visitorToken, campaignId);
  if (existingOffer) {
    if (existingOffer.status === 'active') {
      const expiresAt = existingOffer.countdownExpiresAt;
      if (expiresAt && expiresAt.getTime() > Date.now()) {
        return existingOffer;
      }
      await db.update(urgencyOffers)
        .set({ status: 'expired', expiredAt: new Date() })
        .where(eq(urgencyOffers.id, existingOffer.id));
    }
    
    if (existingOffer.status === 'redeemed') {
      const redeemedAt = existingOffer.redeemedAt;
      if (redeemedAt) {
        const twentyFourHoursMs = 24 * 60 * 60 * 1000;
        if (Date.now() - redeemedAt.getTime() < twentyFourHoursMs) {
          throw new Error('Offer already redeemed recently');
        }
      } else {
        throw new Error('Offer already redeemed');
      }
    }
    
    if (existingOffer.status === 'dismissed') {
      const dismissedAt = existingOffer.dismissedAt;
      if (dismissedAt) {
        const twentyFourHoursMs = 24 * 60 * 60 * 1000;
        if (Date.now() - dismissedAt.getTime() < twentyFourHoursMs) {
          throw new Error('Offer dismissed recently, try again later');
        }
      }
    }
  }

  let validConversationId: string | null = null;
  if (conversationId) {
    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId)
    });
    if (conversation) {
      validConversationId = conversationId;
    }
  }

  const countdownDurationMs = campaignSettings.countdownDurationMinutes * 60 * 1000;
  const countdownExpiresAt = new Date(Date.now() + countdownDurationMs);

  const [offer] = await db.insert(urgencyOffers)
    .values({
      businessAccountId,
      visitorToken,
      campaignId,
      conversationId: validConversationId,
      countdownExpiresAt,
      discountType: campaignSettings.discountType,
      discountValue: campaignSettings.discountValue,
      discountCode: generateDiscountCode(),
      intentScore: intentScore.toString(),
      triggerMessage,
      status: 'active'
    })
    .returning();

  return offer;
}

export async function redeemUrgencyOffer(
  offerId: string,
  phoneNumber: string,
  phoneCountryCode?: string,
  geoCity?: string | null,
  pageUrl?: string | null,
  conversationId?: string | null
) {
  const offer = await db.query.urgencyOffers.findFirst({
    where: eq(urgencyOffers.id, offerId)
  });

  if (!offer) {
    throw new Error('Offer not found');
  }

  if (offer.status !== 'active') {
    throw new Error(`Offer is ${offer.status}`);
  }

  if (new Date() > offer.countdownExpiresAt) {
    await db.update(urgencyOffers)
      .set({ status: 'expired', expiredAt: new Date() })
      .where(eq(urgencyOffers.id, offerId));
    throw new Error('Offer has expired');
  }

  const redemptionConditions = [
    eq(urgencyOffers.businessAccountId, offer.businessAccountId),
    eq(urgencyOffers.phoneNumber, phoneNumber),
    eq(urgencyOffers.status, 'redeemed')
  ];

  if (offer.campaignId) {
    redemptionConditions.push(eq(urgencyOffers.campaignId, offer.campaignId));
  }

  const existingRedemption = await db.query.urgencyOffers.findFirst({
    where: and(...redemptionConditions)
  });

  if (existingRedemption) {
    throw new Error('This phone number has already been used to redeem an offer for this campaign');
  }

  const [updated] = await db.update(urgencyOffers)
    .set({
      status: 'redeemed',
      redeemedAt: new Date(),
      phoneNumber,
      phoneCountryCode
    })
    .where(eq(urgencyOffers.id, offerId))
    .returning();

  const fullPhoneNumber = phoneCountryCode 
    ? `${phoneCountryCode}${phoneNumber}` 
    : phoneNumber;
  
  const visitorCity = geoCity || null;

  try {
    const [createdLead] = await db.insert(leads).values({
      businessAccountId: offer.businessAccountId,
      phone: fullPhoneNumber,
      conversationId: offer.conversationId ?? conversationId ?? null,
      topicsOfInterest: ["Discount Availed"],
      ...(visitorCity ? { city: visitorCity } : {}),
    }).returning();

    if (createdLead) {
      (async () => {
        try {
          const { storage } = await import("../storage");
          const settings = await storage.getWidgetSettings(offer.businessAccountId);
          if (settings?.leadsquaredEnabled === 'true' &&
              settings.leadsquaredAccessKey &&
              settings.leadsquaredSecretKey) {

            const { decrypt } = await import('./encryptionService');
            const decryptedSecretKey = decrypt(settings.leadsquaredSecretKey);

            const { createLeadSquaredService } = await import('./leadsquaredService');
            const leadsquaredService = await createLeadSquaredService({
              accessKey: settings.leadsquaredAccessKey,
              secretKey: decryptedSecretKey,
              region: settings.leadsquaredRegion as 'india' | 'us' | 'other',
              customHost: settings.leadsquaredCustomHost || undefined,
            });

            const businessAccount = await storage.getBusinessAccount(offer.businessAccountId);
            const fieldMappings = await storage.getLeadsquaredFieldMappings(offer.businessAccountId);
            const { extractUtmCampaign, extractUtmSource, extractUtmMedium } = await import('./leadsquaredService');
            const existingLeadRows = offer.conversationId
              ? await db.select().from(leads)
                  .where(eq(leads.conversationId, offer.conversationId)).limit(1)
              : [];
            const sourceUrl = existingLeadRows[0]?.sourceUrl || null;
            const effectivePageUrl = pageUrl || sourceUrl || null;
            const existingLead = existingLeadRows[0] || null;

            let urlExtraction: { university?: string | null; product?: string | null } | undefined;
            const needsUrlExtraction = fieldMappings.some((m: any) => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('urlLookup.'));
            if (needsUrlExtraction && effectivePageUrl) {
              try {
                const { extractProductFromUrl } = await import('./urlExtractionService');
                const settings2 = settings as any;
                const extractionConfig = {
                  domain: settings2.lsqExtractionDomain || null,
                  universities: settings2.lsqExtractionUniversities || null,
                  products: settings2.lsqExtractionProducts || null,
                  fallbackUniversity: settings2.lsqExtractionFallbackUniversity || null,
                  fallbackProduct: settings2.lsqExtractionFallbackProduct || null,
                };
                urlExtraction = await extractProductFromUrl(effectivePageUrl, offer.businessAccountId, extractionConfig);
                console.log('[UrgencyOffer] URL extraction result:', urlExtraction);
              } catch (extractErr) {
                console.warn('[UrgencyOffer] URL extraction failed:', extractErr);
              }
            }

            const leadContext = {
              lead: {
                name: existingLead?.name || undefined,
                email: existingLead?.email || undefined,
                phone: fullPhoneNumber || undefined,
                createdAt: createdLead.createdAt || undefined,
                sourceUrl: effectivePageUrl || undefined,
              },
              session: {
                city: visitorCity || null,
                pageUrl: effectivePageUrl || null,
                utmCampaign: extractUtmCampaign(effectivePageUrl) || null,
                utmSource: extractUtmSource(effectivePageUrl) || null,
                utmMedium: extractUtmMedium(effectivePageUrl) || null,
              },
              business: {
                name: businessAccount?.name || undefined,
                website: businessAccount?.website || undefined,
              },
              ...(urlExtraction ? { urlExtraction } : {}),
            };

            const syncResult = await leadsquaredService.createLeadWithMappings(fieldMappings, leadContext);
            if (syncResult.success) {
              await storage.updateLead(createdLead.id, offer.businessAccountId, {
                leadsquaredSyncStatus: 'synced',
                leadsquaredSyncedAt: new Date(),
                leadsquaredLeadId: syncResult.leadId,
              });
              console.log('[UrgencyOffer] Synced to LeadSquared, ID:', syncResult.leadId);
            } else {
              await storage.updateLead(createdLead.id, offer.businessAccountId, {
                leadsquaredSyncStatus: 'failed',
              });
              console.error('[UrgencyOffer] LeadSquared sync failed:', syncResult.message);
            }
          }
        } catch (syncError) {
          console.error('[UrgencyOffer] LeadSquared sync error:', syncError);
        }
      })();
    }
  } catch (error) {
    console.error('[UrgencyOffer] Failed to create lead from redeemed offer:', error);
  }

  return updated;
}

export async function dismissUrgencyOffer(offerId: string) {
  const [updated] = await db.update(urgencyOffers)
    .set({
      status: 'dismissed',
      dismissedAt: new Date()
    })
    .where(eq(urgencyOffers.id, offerId))
    .returning();

  return updated;
}

export async function checkAndTriggerUrgencyOffer(
  businessAccountId: string,
  visitorToken: string,
  conversationId: string,
  providedConversationHistory?: Array<{ role: string; content: string }>
): Promise<{ shouldTrigger: boolean; offer?: typeof urgencyOffers.$inferSelect; settings?: typeof urgencyOfferSettings.$inferSelect }> {
  const campaigns = await getAllCampaigns(businessAccountId);
  const enabledCampaigns = campaigns.filter(c => c.isEnabled);

  if (enabledCampaigns.length === 0) {
    return { shouldTrigger: false };
  }

  let messageHistory: Array<{ role: string; content: string }> | null = null;

  if (providedConversationHistory && providedConversationHistory.length > 0) {
    messageHistory = providedConversationHistory;
  }

  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  for (const campaign of enabledCampaigns) {
    const existingOffer = await getOfferByVisitorToken(businessAccountId, visitorToken, campaign.id);

    if (existingOffer) {
      if (existingOffer.status === 'active') {
        const expiresAt = existingOffer.countdownExpiresAt;
        if (expiresAt && expiresAt.getTime() > Date.now()) {
          return { shouldTrigger: true, offer: existingOffer, settings: campaign };
        }
        await db.update(urgencyOffers)
          .set({ status: 'expired', expiredAt: new Date() })
          .where(eq(urgencyOffers.id, existingOffer.id));
      }

      if (existingOffer.status === 'redeemed') {
        const redeemedAt = existingOffer.redeemedAt;
        if (redeemedAt && Date.now() - redeemedAt.getTime() < twentyFourHoursMs) {
          continue;
        }
      }

      if (existingOffer.status === 'dismissed') {
        const dismissedAt = existingOffer.dismissedAt;
        if (dismissedAt && Date.now() - dismissedAt.getTime() < twentyFourHoursMs) {
          continue;
        }
      }
    }

    if (!messageHistory) {
      const conversationMessages = await db.query.messages.findMany({
        where: eq(messages.conversationId, conversationId),
        orderBy: [desc(messages.createdAt)]
      });

      if (conversationMessages.length < campaign.minMessagesBeforeTrigger) {
        continue;
      }

      messageHistory = conversationMessages
        .reverse()
        .map(m => ({ role: m.role, content: m.content }));
    } else {
      if (messageHistory.length < campaign.minMessagesBeforeTrigger) {
        continue;
      }
    }

    if (campaign.triggerMode === 'keyword') {
      const keywords = (campaign.triggerKeywords || '')
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(k => k.length > 0);

      if (keywords.length === 0) {
        continue;
      }

      const userMessages = messageHistory.filter(m => m.role === 'user');
      const latestUserMessage = userMessages[userMessages.length - 1];
      if (!latestUserMessage) continue;

      const msgLower = latestUserMessage.content.toLowerCase();
      const matchedKeyword = keywords.find(kw => msgLower.includes(kw));

      if (!matchedKeyword) {
        continue;
      }

      try {
        const offer = await startUrgencyOffer(
          businessAccountId,
          visitorToken,
          conversationId,
          100,
          matchedKeyword,
          campaign.id,
          campaign
        );
        return { shouldTrigger: true, offer, settings: campaign };
      } catch (error) {
        console.error('[UrgencyOffer] Error starting keyword-triggered offer for campaign:', campaign.id, error);
        continue;
      }
    }

    const intentResult = await detectPurchaseIntent(businessAccountId, messageHistory, campaign.intentThreshold);

    if (!intentResult.hasHighIntent) {
      continue;
    }

    try {
      const offer = await startUrgencyOffer(
        businessAccountId,
        visitorToken,
        conversationId,
        intentResult.confidence,
        intentResult.triggerMessage,
        campaign.id,
        campaign
      );
      return { shouldTrigger: true, offer, settings: campaign };
    } catch (error) {
      console.error('[UrgencyOffer] Error starting offer for campaign:', campaign.id, error);
      continue;
    }
  }

  return { shouldTrigger: false };
}

export async function expireOldOffers() {
  const now = new Date();
  
  await db.update(urgencyOffers)
    .set({ status: 'expired', expiredAt: now })
    .where(and(
      eq(urgencyOffers.status, 'active'),
      sql`${urgencyOffers.countdownExpiresAt} <= ${now}`
    ));
}
