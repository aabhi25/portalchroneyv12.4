import { db } from "../db";
import { facebookSettings, facebookMessages, facebookLeads, businessAccounts, widgetSettings } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { vectorSearchService } from "./vectorSearchService";
import { faqEmbeddingService } from "./faqEmbeddingService";
import { businessContextCache } from "./businessContextCache";
import { facebookService } from "./facebookService";
import { buildPhoneValidationOverride } from "./leadTrainingPrompt";
import { storage } from "../storage";
import { resolveProfile } from "./customerProfileService";
import { composeCrossPlatformContext, triggerSnapshotUpdate } from "./crossPlatformMemoryService";
import OpenAI from "openai";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface LeadField {
  id: string;
  enabled: boolean;
  required: boolean;
  priority: number;
  captureStrategy: 'start' | 'end' | 'smart' | 'custom' | 'intent' | 'keyword';
  customAskAfter?: number;
  intentIntensity?: 'low' | 'medium' | 'high';
  captureKeywords?: string[];
  digitCount?: number;
}

interface LeadTrainingConfig {
  fields: LeadField[];
  captureStrategy: string;
}

interface CollectedContactInfo {
  mobile?: string;
  phone?: string;
  email?: string;
  name?: string;
  whatsapp?: string;
}

function getFieldDisplayName(fieldId: string): string {
  const fieldIdLower = fieldId.toLowerCase();
  switch (fieldIdLower) {
    case 'name': return 'full name';
    case 'whatsapp': return 'WhatsApp number';
    case 'mobile': return 'mobile number';
    case 'phone': return 'phone number';
    case 'email': return 'email address';
    default: return fieldId;
  }
}

function extractContactInfoFromConversation(conversationHistory: ConversationMessage[], currentUserMessage?: string): CollectedContactInfo {
  const collected: CollectedContactInfo = {};
  const phonePattern = /(\+?\d[\d\s\-\(\)]{7,}\d)/g;
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

  const allMessages = currentUserMessage
    ? [...conversationHistory, { role: 'user' as const, content: currentUserMessage, timestamp: new Date() }]
    : conversationHistory;

  for (const message of allMessages) {
    if (message.role === 'user') {
      const content = message.content;

      const phones = content.match(phonePattern);
      if (phones && phones.length > 0) {
        const cleanPhone = phones[0].replace(/[\s\-\(\)]/g, '');
        collected.mobile = cleanPhone;
        collected.phone = cleanPhone;
        collected.whatsapp = cleanPhone;
      }

      const emails = content.match(emailPattern);
      if (emails && emails.length > 0) {
        collected.email = emails[0];
      }
    }
  }

  let extractedName = extractNameFromConversation(allMessages);
  if (extractedName) {
    collected.name = extractedName;
  }

  return collected;
}

function extractNameFromConversation(messages: ConversationMessage[]): string | null {
  const REFUSAL_WORDS = [
    'no', 'nop', 'nope', 'nah', 'na', 'none', 'nothing', 'never',
    'why', 'what', 'when', 'where', 'who', 'how',
    'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'fine',
    'thanks', 'thank', 'ty', 'thx',
    'hi', 'hello', 'hey', 'hola', 'greetings', 'good',
    'bye', 'goodbye', 'later',
  ];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;

    const prevMsg = i > 0 ? messages[i - 1] : null;
    if (!prevMsg || prevMsg.role !== 'assistant') continue;

    const prevContent = prevMsg.content.toLowerCase();
    const isNameRequest = /\b(name|who am i speaking|who is this|may i know your name|what should i call you|what's your name|whats your name)\b/i.test(prevContent);

    if (isNameRequest) {
      const userReply = msg.content.trim();
      if (userReply.length < 2 || userReply.length > 60) continue;
      if (REFUSAL_WORDS.includes(userReply.toLowerCase())) continue;
      if (/^\d+$/.test(userReply)) continue;
      if (/@/.test(userReply)) continue;

      const namePatterns = [
        /^(?:(?:my name is|i'm|i am|it's|its|this is|call me|they call me)\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
        /^([A-Za-z]+(?:\s+[A-Za-z]+)?)$/,
      ];

      for (const pattern of namePatterns) {
        const match = userReply.match(pattern);
        if (match) {
          const name = match[1] || match[0];
          if (name.length >= 2 && !REFUSAL_WORDS.includes(name.toLowerCase())) {
            return name.trim();
          }
        }
      }
    }
  }

  return null;
}

export class FacebookAutoReplyService {

  async generateAndSendReply(
    businessAccountId: string,
    senderId: string,
    userMessage: string
  ): Promise<{ success: boolean; reply?: string; error?: string }> {
    try {
      console.log(`[Facebook Auto-Reply] Processing message from ${senderId}`);

      const [settings] = await db
        .select()
        .from(facebookSettings)
        .where(eq(facebookSettings.businessAccountId, businessAccountId))
        .limit(1);

      if (!settings) {
        console.error(`[Facebook Auto-Reply] No Facebook settings found for business: ${businessAccountId}`);
        return { success: false, error: "Facebook settings not configured" };
      }

      if (settings.autoReplyEnabled !== "true") {
        console.log(`[Facebook Auto-Reply] Auto-reply disabled for business: ${businessAccountId}`);
        return { success: false, error: "Auto-reply is disabled" };
      }

      const businessAccount = await db.query.businessAccounts.findFirst({
        where: eq(businessAccounts.id, businessAccountId)
      });

      if (!businessAccount) {
        console.error(`[Facebook Auto-Reply] Business account not found: ${businessAccountId}`);
        return { success: false, error: "Business account not found" };
      }

      const apiKey = businessAccount.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error(`[Facebook Auto-Reply] No OpenAI API key available`);
        return { success: false, error: "No OpenAI API key configured" };
      }

      const conversationHistory = await this.getConversationHistory(businessAccountId, senderId);

      const { context: businessContext, widgetCustomInstructions, leadTrainingConfig } = await this.buildBusinessContext(businessAccountId, userMessage);

      const responseCount = conversationHistory.filter(msg => msg.role === 'assistant').length;

      let crossPlatformContext = "";
      try {
        const existingLeads = await db
          .select()
          .from(facebookLeads)
          .where(
            and(
              eq(facebookLeads.businessAccountId, businessAccountId),
              eq(facebookLeads.senderId, senderId)
            )
          )
          .orderBy(desc(facebookLeads.createdAt))
          .limit(1);
        const persistedData = (existingLeads.length > 0 ? existingLeads[0].extractedData : {}) as Record<string, any>;
        let phone = persistedData?.phone_number || null;
        let email = persistedData?.email_address || null;

        if (!phone || !email) {
          const liveContact = extractContactInfoFromConversation(conversationHistory, userMessage);
          if (!phone && liveContact.phone) {
            const cleaned = liveContact.phone.replace(/[^\d]/g, '');
            if (cleaned.length >= 8 && cleaned.length <= 12) {
              phone = liveContact.phone;
              console.log(`[Facebook Auto-Reply] Extracted phone from current message: ${phone}`);
            }
          }
          if (!email && liveContact.email) {
            email = liveContact.email;
            console.log(`[Facebook Auto-Reply] Extracted email from current message: ${email}`);
          }
        }

        const profile = await resolveProfile(businessAccountId, {
          phone,
          email,
          name: persistedData?.customer_name || null,
          platform: "facebook",
          platformUserId: senderId,
        });
        if (profile) {
          const isFirstMsg = !conversationHistory.some(m => m.role === 'assistant');
          crossPlatformContext = await composeCrossPlatformContext(businessAccountId, "facebook", profile.id, isFirstMsg);
          if (crossPlatformContext) {
            console.log(`[Facebook Auto-Reply] Cross-platform context loaded (${crossPlatformContext.length} chars, firstMsg: ${isFirstMsg})`);
          }
        }
      } catch (err) {
        console.error("[Facebook Auto-Reply] Cross-platform context error (non-fatal):", err);
      }

      const leadCollectionPrompt = leadTrainingConfig
        ? this.buildLeadCollectionPrompt(leadTrainingConfig, conversationHistory, userMessage)
        : '';
      const phoneValidationOverride = leadTrainingConfig ? (buildPhoneValidationOverride(userMessage, leadTrainingConfig) || undefined) : undefined;

      const combinedInstructions = [
        widgetCustomInstructions,
      ].filter(Boolean).join('\n\n');

      const aiReply = await this.generateAIResponse(
        apiKey,
        userMessage,
        conversationHistory,
        businessContext,
        combinedInstructions || undefined,
        businessAccount.name || "the business",
        businessAccount.description || undefined,
        leadCollectionPrompt,
        phoneValidationOverride,
        crossPlatformContext || undefined
      );

      if (!aiReply) {
        return { success: false, error: "Failed to generate AI response" };
      }

      let processedReply = aiReply;

      if (this.isDeflectionResponse(processedReply)) {
        console.log(`[Facebook Auto-Reply] Deflection detected, stripping [[FALLBACK]] marker`);
      }
      processedReply = this.stripFallbackMarker(processedReply);

      const sendResult = await facebookService.sendMessage(
        settings,
        senderId,
        processedReply
      );

      if (!sendResult.success) {
        console.error(`[Facebook Auto-Reply] Failed to send message: ${sendResult.error}`);
        return { success: false, error: sendResult.error };
      }

      await facebookService.storeMessage(
        businessAccountId,
        senderId,
        processedReply,
        "outgoing",
        { fbMessageId: sendResult.messageId || undefined }
      );

      console.log(`[Facebook Auto-Reply] Successfully sent reply to ${senderId}`);

      this.tryAutoCaptureLead(businessAccountId, senderId, conversationHistory, userMessage, leadTrainingConfig, settings)
        .catch(err => console.error("[Facebook Auto-Reply] Lead capture error:", err));

      try {
        const existingLeads = await db
          .select()
          .from(facebookLeads)
          .where(
            and(
              eq(facebookLeads.businessAccountId, businessAccountId),
              eq(facebookLeads.senderId, senderId)
            )
          )
          .orderBy(desc(facebookLeads.createdAt))
          .limit(1);
        const persistedData = (existingLeads.length > 0 ? existingLeads[0].extractedData : {}) as Record<string, any>;
        const liveContact = extractContactInfoFromConversation(conversationHistory, userMessage);
        const phone = persistedData?.phone_number || liveContact.phone || null;
        const profile = await resolveProfile(businessAccountId, {
          phone,
          email: persistedData?.email_address || liveContact.email || null,
          name: persistedData?.customer_name || null,
          platform: "facebook",
          platformUserId: senderId,
        });
        if (profile) {
          triggerSnapshotUpdate(businessAccountId, profile.id, "facebook", senderId);
        }
      } catch (err) {
        console.error("[Facebook Auto-Reply] Snapshot trigger error (non-fatal):", err);
      }

      return { success: true, reply: processedReply };

    } catch (error) {
      console.error(`[Facebook Auto-Reply] Error:`, error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  private buildLeadCollectionPrompt(
    leadTrainingConfig: LeadTrainingConfig | null,
    conversationHistory: ConversationMessage[],
    currentUserMessage: string
  ): string {
    if (!leadTrainingConfig || !leadTrainingConfig.fields || !Array.isArray(leadTrainingConfig.fields)) {
      return '';
    }

    const allStartFields = leadTrainingConfig.fields
      .filter(f => f.enabled && f.captureStrategy === 'start')
      .sort((a, b) => a.priority - b.priority);

    if (allStartFields.length === 0) {
      return '';
    }

    const collected = extractContactInfoFromConversation(conversationHistory, currentUserMessage);
    const hasAnyPhone = !!(collected.phone || collected.mobile || collected.whatsapp);

    const missingFields: Array<{ id: string; priority: number; isRequired: boolean }> = [];
    for (const field of allStartFields) {
      const fieldId = field.id.toLowerCase();
      if (fieldId === 'mobile' || fieldId === 'phone' || fieldId === 'whatsapp') {
        if (!hasAnyPhone) {
          missingFields.push({ id: field.id, priority: field.priority, isRequired: field.required });
        }
      } else if (fieldId === 'email') {
        if (!collected.email) {
          missingFields.push({ id: field.id, priority: field.priority, isRequired: field.required });
        }
      } else if (fieldId === 'name') {
        if (!collected.name) {
          missingFields.push({ id: field.id, priority: field.priority, isRequired: field.required });
        }
      }
    }

    if (missingFields.length === 0) {
      console.log(`[Facebook Auto-Reply] All lead fields already collected`);

      const isJustContactInfo = /^\+?[\d\s().-]{7,20}$/.test(currentUserMessage.trim()) ||
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentUserMessage.trim());

      if (isJustContactInfo) {
        console.log(`[Facebook Auto-Reply] User message is just contact info — injecting post-collection guard`);
        return `🎯 POST-LEAD-CAPTURE INSTRUCTION (CRITICAL):
- The customer just provided their contact information (the message was: "${currentUserMessage}")
- All required contact fields have been collected successfully
- DO NOT proactively mention fees, discounts, EMI options, or any specific topic the customer did NOT ask about
- DO NOT apply any conditional training instructions that trigger on keywords like "fee", "cost", "eligibility" — the customer did NOT ask about these topics
- Simply thank them for sharing their contact details and ask how you can help them today
- Keep it short and warm, for example: "Thank you for sharing your number! How can I assist you today?"
- Wait for the customer to ask their actual question before providing any business-specific information`;
      }

      return '';
    }

    const missingFieldNames = missingFields.map(f => getFieldDisplayName(f.id));
    const nextField = missingFields[0];
    const nextFieldName = getFieldDisplayName(nextField.id);
    const isNextFieldRequired = nextField.isRequired;

    const digitConfig = this.getPhoneDigitConfig(leadTrainingConfig, nextField.id);
    const phoneValidationNote = digitConfig
      ? `\n- Phone numbers must be exactly ${digitConfig} digits. If the user provides a number that doesn't have ${digitConfig} digits, politely ask them to provide a valid ${digitConfig}-digit number.`
      : '';

    console.log(`[Facebook Auto-Reply] Lead collection: missing fields = [${missingFieldNames.join(', ')}], next = ${nextFieldName} (${isNextFieldRequired ? 'required' : 'optional'})`);

    if (isNextFieldRequired) {
      const missingRequiredNames = missingFields.filter(f => f.isRequired).map(f => getFieldDisplayName(f.id));
      return `
🚨 RULE #0 - REQUIRED CONTACT COLLECTION (ABSOLUTE HIGHEST PRIORITY):
- Required fields NOT YET collected: ${missingRequiredNames.join(', ')}
- Next field to collect: ${nextFieldName}

🔒 MANDATORY ENFORCEMENT - NO EXCEPTIONS ALLOWED:
- YOU MUST COLLECT **ONLY** [${nextFieldName}] - DO NOT ASK FOR ANY OTHER FIELD
- DO NOT ask for multiple fields at once (e.g., "name and email")
- DO NOT say "How can I help you today?" until this field is collected
- DO NOT answer other questions until this field is collected
- DO NOT move on to different topics
- DO NOT abandon this collection process for ANY reason
- STAY COMPLETELY FOCUSED on collecting this ONE field first${phoneValidationNote}

🚫 CRITICAL - DO NOT ASK FOR MULTIPLE FIELDS:
❌ WRONG: "May I also have your name and email?"
❌ WRONG: "Could you share your name and phone number?"
✅ CORRECT: Ask for ONLY ${nextFieldName} using warm, varied phrasing

HOW TO ASK NATURALLY:
1. Ask for ONLY ${nextFieldName} - DO NOT mention any other field
2. Be conversational and warm, not robotic
3. After they provide it, the system will tell you what to ask for next

IF USER ASKS "WHY" OR QUESTIONS THE REQUEST:
- Your TONE should be warm and understanding (not pushy or aggressive)
- BUT the COLLECTION IS STILL MANDATORY
- Briefly explain why you need their ${nextFieldName} (to provide better assistance)
- THEN immediately ask again for their ${nextFieldName}
- DO NOT abandon the collection
`;
    }

    return `
📋 CONTACT COLLECTION - OPTIONAL FIELD REQUEST:
- Field to ask for: ${nextFieldName} (optional)
- Other missing fields: ${missingFieldNames.length > 1 ? missingFieldNames.slice(1).join(', ') : 'none'}

HOW TO ASK:
- After greeting the user, naturally ask for their ${nextFieldName}
- Be warm and conversational: "By the way, could you share your ${nextFieldName.toLowerCase()}? It helps us serve you better!"
- Ask for ONLY ${nextFieldName} — do NOT ask for multiple fields at once${phoneValidationNote}

IF USER DECLINES OR SKIPS:
- This field is OPTIONAL — if the user says "no", "skip", "later", or ignores the request, accept it gracefully
- DO NOT insist, push, or ask again after they decline
- Simply move on and help them with their query
- Example: "No worries at all! How can I help you today?"

IMPORTANT:
- Ask for this field ONCE in the conversation, do not repeat the request
- If the user provides their ${nextFieldName.toLowerCase()}, thank them briefly and continue
- If they decline, move on immediately without mentioning it again
`;
  }

  private getPhoneDigitConfig(config: LeadTrainingConfig, fieldId: string): number | null {
    const fieldIdLower = fieldId.toLowerCase();
    if (fieldIdLower !== 'mobile' && fieldIdLower !== 'phone' && fieldIdLower !== 'whatsapp') {
      return null;
    }
    const field = config.fields.find(f => f.id.toLowerCase() === fieldIdLower);
    if (field && (field as any).digitCount) {
      return (field as any).digitCount;
    }
    return null;
  }

  private async tryAutoCaptureLead(
    businessAccountId: string,
    senderId: string,
    conversationHistory: ConversationMessage[],
    currentUserMessage: string,
    leadTrainingConfig: LeadTrainingConfig | null,
    settings: any
  ): Promise<void> {
    try {
      if (settings.leadCaptureEnabled !== "true") {
        console.log(`[Facebook Lead Capture] Lead capture disabled for this business`);
        return;
      }

      const collected = extractContactInfoFromConversation(conversationHistory, currentUserMessage);
      const hasContactData = !!(collected.phone || collected.email || collected.name);

      if (!hasContactData) {
        return;
      }

      console.log(`[Facebook Lead Capture] Contact info detected: name=${collected.name || 'N/A'}, phone=${collected.phone || 'N/A'}, email=${collected.email || 'N/A'}`);

      if (leadTrainingConfig?.fields) {
        const phoneField = leadTrainingConfig.fields.find(
          f => (f.id.toLowerCase() === 'mobile' || f.id.toLowerCase() === 'phone') && f.enabled
        );
        if (phoneField && collected.phone) {
          const digitCount = (phoneField as any).digitCount || 10;
          const digitsOnly = collected.phone.replace(/\D/g, '');
          if (digitsOnly.length !== digitCount) {
            console.log(`[Facebook Lead Capture] Phone ${collected.phone} doesn't match required ${digitCount} digits, skipping lead save`);
            return;
          }
        }
      }

      const existingLeads = await db
        .select()
        .from(facebookLeads)
        .where(
          and(
            eq(facebookLeads.businessAccountId, businessAccountId),
            eq(facebookLeads.senderId, senderId)
          )
        )
        .orderBy(desc(facebookLeads.createdAt))
        .limit(1);

      const senderName = await this.getSenderName(businessAccountId, senderId);

      const extractedData: Record<string, any> = {};
      if (collected.name) extractedData.customer_name = collected.name;
      if (collected.phone) extractedData.phone_number = collected.phone;
      if (collected.email) extractedData.email_address = collected.email;

      if (existingLeads.length > 0) {
        const existingLead = existingLeads[0];
        const existingData = (existingLead.extractedData || {}) as Record<string, any>;

        const mergedData = { ...existingData, ...extractedData };

        const hasNewData = Object.keys(extractedData).some(
          key => extractedData[key] !== existingData[key]
        );

        if (hasNewData) {
          await db
            .update(facebookLeads)
            .set({
              extractedData: mergedData,
              senderName: senderName || existingLead.senderName,
              updatedAt: new Date(),
            })
            .where(eq(facebookLeads.id, existingLead.id));

          console.log(`[Facebook Lead Capture] Updated existing lead ${existingLead.id} with new data`);
        } else {
          console.log(`[Facebook Lead Capture] No new data to update for existing lead ${existingLead.id}`);
        }
      } else {
        const newLead = await facebookService.createFacebookLead(businessAccountId, {
          senderId,
          senderName: senderName || undefined,
          extractedData,
          status: "new",
        });

        console.log(`[Facebook Lead Capture] Created new lead ${newLead.id} from DM conversation`);
      }
    } catch (error) {
      console.error(`[Facebook Lead Capture] Error:`, error);
    }
  }

  private async getSenderName(businessAccountId: string, senderId: string): Promise<string | null> {
    const [msg] = await db
      .select({ senderName: facebookMessages.senderName })
      .from(facebookMessages)
      .where(
        and(
          eq(facebookMessages.businessAccountId, businessAccountId),
          eq(facebookMessages.senderId, senderId),
          sql`${facebookMessages.senderName} IS NOT NULL AND ${facebookMessages.senderName} != ''`
        )
      )
      .orderBy(desc(facebookMessages.createdAt))
      .limit(1);

    if (msg?.senderName) return msg.senderName;

    const [existingLead] = await db
      .select({ senderName: facebookLeads.senderName })
      .from(facebookLeads)
      .where(
        and(
          eq(facebookLeads.businessAccountId, businessAccountId),
          eq(facebookLeads.senderId, senderId),
          sql`${facebookLeads.senderName} IS NOT NULL AND ${facebookLeads.senderName} != ''`
        )
      )
      .limit(1);

    if (existingLead?.senderName) return existingLead.senderName;

    try {
      const settings = await facebookService.getSettings(businessAccountId);
      if (settings) {
        const decryptedToken = facebookService.getDecryptedAccessToken(settings);
        if (decryptedToken) {
          const profile = await facebookService.getUserProfile(decryptedToken, senderId);
          if (profile?.firstName) {
            const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
            console.log(`[Facebook Auto-Reply] Resolved name via API: ${fullName}`);
            return fullName;
          }
        }
      }
    } catch (err) {
      console.log(`[Facebook Auto-Reply] Could not resolve name via API for ${senderId}`);
    }

    return null;
  }

  private async getConversationHistory(
    businessAccountId: string,
    senderId: string
  ): Promise<ConversationMessage[]> {
    const recentMessages = await db
      .select({
        messageText: facebookMessages.messageText,
        direction: facebookMessages.direction,
        createdAt: facebookMessages.createdAt
      })
      .from(facebookMessages)
      .where(
        and(
          eq(facebookMessages.businessAccountId, businessAccountId),
          eq(facebookMessages.senderId, senderId)
        )
      )
      .orderBy(desc(facebookMessages.createdAt))
      .limit(10);

    return recentMessages
      .reverse()
      .filter(msg => msg.messageText)
      .map(msg => ({
        role: (msg.direction === "outgoing" ? "assistant" : "user") as "user" | "assistant",
        content: msg.messageText || "",
        timestamp: msg.createdAt
      }));
  }

  private async buildBusinessContext(
    businessAccountId: string,
    userMessage: string
  ): Promise<{ context: string; widgetCustomInstructions: string | null; leadTrainingConfig: LeadTrainingConfig | null }> {
    let context = "";
    let widgetCustomInstructions: string | null = null;
    let leadTrainingConfig: LeadTrainingConfig | null = null;

    console.log(`[Facebook Auto-Reply] Building comprehensive business context for: ${businessAccountId}`);

    try {
      const cacheKey = `fb_business_context_${businessAccountId}`;
      const cachedStaticContext = await businessContextCache.getOrFetch(cacheKey, async () => {
        let staticContext = "";
        let cachedCustomInstructions: string | null = null;

        const parallelLoadStart = Date.now();
        const [
          businessAccountResult,
          widgetSettingResult,
          websiteContentResult,
          analyzedPagesResult,
          trainingDocsResult
        ] = await Promise.allSettled([
          db.query.businessAccounts.findFirst({
            where: eq(businessAccounts.id, businessAccountId)
          }),
          db.select().from(widgetSettings).where(eq(widgetSettings.businessAccountId, businessAccountId)).limit(1),
          (async () => {
            const { websiteAnalysisService } = await import("../websiteAnalysisService");
            return await websiteAnalysisService.getAnalyzedContent(businessAccountId);
          })(),
          storage.getAnalyzedPages(businessAccountId),
          storage.getTrainingDocuments(businessAccountId)
        ]);

        console.log(`[Facebook Auto-Reply] [CACHE MISS] Parallel data loading completed in ${Date.now() - parallelLoadStart}ms`);

        const businessAccount = businessAccountResult.status === 'fulfilled' ? businessAccountResult.value : null;
        const widgetSettingArr = widgetSettingResult.status === 'fulfilled' ? widgetSettingResult.value : [];
        const websiteContent = websiteContentResult.status === 'fulfilled' ? websiteContentResult.value : null;
        const analyzedPages = analyzedPagesResult.status === 'fulfilled' ? analyzedPagesResult.value : [];
        const trainingDocs = trainingDocsResult.status === 'fulfilled' ? trainingDocsResult.value : [];

        if (businessAccount?.description) {
          staticContext += `BUSINESS OVERVIEW:\n${businessAccount.description}\n\n`;
          console.log(`[Facebook Auto-Reply] [CACHE MISS] Added business description (${businessAccount.description.length} chars)`);
        }

        const widgetSetting = widgetSettingArr[0];
        if (widgetSetting?.customInstructions) {
          cachedCustomInstructions = widgetSetting.customInstructions;
          console.log(`[Facebook Auto-Reply] [CACHE MISS] Found widget custom instructions (${cachedCustomInstructions.length} chars)`);
        }

        try {
          if (websiteContent) {
            staticContext += `BUSINESS KNOWLEDGE (from website analysis):\n`;
            staticContext += `You have comprehensive knowledge about this business extracted from their website.\n\n`;
            if (websiteContent.businessName) staticContext += `Business Name: ${websiteContent.businessName}\n\n`;
            if (websiteContent.businessDescription) staticContext += `About: ${websiteContent.businessDescription}\n\n`;
            if (websiteContent.targetAudience) staticContext += `Target Audience: ${websiteContent.targetAudience}\n\n`;
            if (websiteContent.mainProducts && websiteContent.mainProducts.length > 0) {
              staticContext += `Main Products:\n${websiteContent.mainProducts.map((p: string) => `- ${p}`).join('\n')}\n\n`;
            }
            if (websiteContent.mainServices && websiteContent.mainServices.length > 0) {
              staticContext += `Main Services:\n${websiteContent.mainServices.map((s: string) => `- ${s}`).join('\n')}\n\n`;
            }
            if (websiteContent.keyFeatures && websiteContent.keyFeatures.length > 0) {
              staticContext += `Key Features:\n${websiteContent.keyFeatures.map((f: string) => `- ${f}`).join('\n')}\n\n`;
            }
            if (websiteContent.uniqueSellingPoints && websiteContent.uniqueSellingPoints.length > 0) {
              staticContext += `Unique Selling Points:\n${websiteContent.uniqueSellingPoints.map((u: string) => `- ${u}`).join('\n')}\n\n`;
            }
            if (websiteContent.contactInfo && (websiteContent.contactInfo.email || websiteContent.contactInfo.phone || websiteContent.contactInfo.address)) {
              staticContext += `Contact Information:\n`;
              if (websiteContent.contactInfo.email) staticContext += `- Email: ${websiteContent.contactInfo.email}\n`;
              if (websiteContent.contactInfo.phone) staticContext += `- Phone: ${websiteContent.contactInfo.phone}\n`;
              if (websiteContent.contactInfo.address) staticContext += `- Address: ${websiteContent.contactInfo.address}\n`;
              staticContext += '\n';
            }
            if (websiteContent.businessHours) staticContext += `Business Hours: ${websiteContent.businessHours}\n\n`;
            if (websiteContent.pricingInfo) staticContext += `Pricing: ${websiteContent.pricingInfo}\n\n`;
            if (websiteContent.additionalInfo) staticContext += `Additional Information: ${websiteContent.additionalInfo}\n\n`;
            staticContext += `IMPORTANT: Use this website knowledge to provide accurate, context-aware responses about the business. Answer naturally without mentioning that you analyzed their website.\n\n`;
            console.log(`[Facebook Auto-Reply] [CACHE MISS] Added website analysis content`);
          }
        } catch (error) {
          console.error('[Facebook Auto-Reply] Error loading website analysis:', error);
        }

        try {
          if (analyzedPages && analyzedPages.length > 0) {
            staticContext += `DETAILED WEBSITE CONTENT:\n`;
            staticContext += `Below is detailed information extracted from ${analyzedPages.length} page(s) of the business website.\n\n`;
            let pagesLoaded = 0;
            for (const page of analyzedPages) {
              if (!page.extractedContent || 
                  page.extractedContent.trim() === '' || 
                  page.extractedContent === 'No relevant business information found on this page.') {
                continue;
              }
              let pageName = 'Page';
              try {
                const url = new URL(page.pageUrl);
                const pathParts = url.pathname.split('/').filter(Boolean);
                pageName = pathParts[pathParts.length - 1] || 'Homepage';
              } catch {
                const pathParts = page.pageUrl.split('/').filter(Boolean);
                pageName = pathParts[pathParts.length - 1] || 'Homepage';
              }
              staticContext += `--- ${pageName.toUpperCase()} PAGE ---\n`;
              staticContext += `${page.extractedContent}\n\n`;
              pagesLoaded++;
            }
            if (pagesLoaded > 0) {
              console.log(`[Facebook Auto-Reply] [CACHE MISS] Loaded ${pagesLoaded} analyzed page(s) into context`);
              staticContext += `IMPORTANT: Use all the above website content to answer customer questions accurately.\n\n`;
            }
          }
        } catch (error) {
          console.error('[Facebook Auto-Reply] Error loading analyzed pages:', error);
        }

        try {
          const completedDocs = trainingDocs.filter(doc => doc.uploadStatus === 'completed');
          if (completedDocs.length > 0) {
            staticContext += `TRAINING DOCUMENTS KNOWLEDGE:\n`;
            staticContext += `The following information has been extracted from uploaded training documents:\n\n`;
            for (const doc of completedDocs) {
              if (doc.summary || doc.keyPoints) {
                staticContext += `--- ${doc.originalFilename} ---\n`;
                if (doc.summary) staticContext += `Summary: ${doc.summary}\n\n`;
                if (doc.keyPoints) {
                  try {
                    const keyPoints = JSON.parse(doc.keyPoints);
                    if (Array.isArray(keyPoints) && keyPoints.length > 0) {
                      staticContext += `Key Points:\n`;
                      keyPoints.forEach((point: string, index: number) => {
                        staticContext += `${index + 1}. ${point}\n`;
                      });
                      staticContext += `\n`;
                    }
                  } catch (parseError) {
                    console.error(`[Facebook Auto-Reply] Error parsing key points for ${doc.originalFilename}:`, parseError);
                  }
                }
              }
            }
            console.log(`[Facebook Auto-Reply] [CACHE MISS] Loaded ${completedDocs.length} training document(s) summaries into context`);
            staticContext += `IMPORTANT: Use this training document knowledge to provide accurate, informed responses.\n\n`;
          }
        } catch (error) {
          console.error('[Facebook Auto-Reply] Error loading training documents:', error);
        }

        return { staticContext, customInstructions: cachedCustomInstructions };
      });

      context += cachedStaticContext.staticContext;
      widgetCustomInstructions = cachedStaticContext.customInstructions;

      const [widgetSetting] = await db
        .select()
        .from(widgetSettings)
        .where(eq(widgetSettings.businessAccountId, businessAccountId))
        .limit(1);

      if (widgetSetting?.leadTrainingConfig) {
        leadTrainingConfig = widgetSetting.leadTrainingConfig as unknown as LeadTrainingConfig;
        console.log(`[Facebook Auto-Reply] Loaded lead training config with ${leadTrainingConfig?.fields?.length || 0} fields (fresh, not cached)`);
      }

      const searchResults = await vectorSearchService.search(
        userMessage,
        businessAccountId,
        5,
        0.50
      );

      if (searchResults.length > 0) {
        context += `🔒 CRITICAL DOCUMENT KNOWLEDGE - HIGHEST PRIORITY:\n`;
        context += `The following information was found in your business's training documents.\n`;
        context += `This is BUSINESS-SPECIFIC information that you MUST use to answer questions.\n\n`;

        searchResults.forEach((result, idx) => {
          context += `[Document Excerpt ${idx + 1} from ${result.documentName}]:\n`;
          context += `${result.chunkText}\n\n`;
        });

        console.log(`[Facebook Auto-Reply] Added ${searchResults.length} document chunks from vector search`);
      }

      const hasEmbeddedFaqs = await faqEmbeddingService.hasEmbeddedFAQs(businessAccountId);
      console.log(`[Facebook Auto-Reply] Business has embedded FAQs: ${hasEmbeddedFaqs}`);

      const relevantFaqs = await faqEmbeddingService.searchFAQs(
        userMessage,
        businessAccountId,
        5,
        0.50
      );

      if (relevantFaqs.length > 0) {
        context += `\n🔒 MATCHED FAQs — HIGHEST PRIORITY KNOWLEDGE (USE THIS INFORMATION):\n`;
        context += `The following FAQ answers were matched to the customer's query with high confidence.\n`;
        context += `You MUST use the information from these FAQs to answer the customer's question.\n`;
        context += `SUMMARIZE naturally in your own words — do NOT copy/paste verbatim. Adapt the answer to fit what the customer actually asked.\n`;
        context += `These contain OFFICIAL business-verified facts — use ONLY facts from these answers, do NOT add your own knowledge.\n\n`;

        for (const faq of relevantFaqs) {
          context += `━━━ FAQ MATCH ━━━\n`;
          context += `Q: ${faq.question}\n`;
          context += `✅ OFFICIAL ANSWER: ${faq.answer}\n`;
          context += `━━━━━━━━━━━━━━━━━\n\n`;
        }

        console.log(`[Facebook Auto-Reply] Added ${relevantFaqs.length} semantically relevant FAQs`);
      } else if (hasEmbeddedFaqs) {
        console.log(`[Facebook Auto-Reply] WARNING: FAQs exist but none matched the query (similarity too low)`);
      } else {
        console.log(`[Facebook Auto-Reply] WARNING: No embedded FAQs found for this business`);
      }

    } catch (error) {
      console.error(`[Facebook Auto-Reply] Context building error:`, error);
    }

    console.log(`[Facebook Auto-Reply] ========== CONTEXT SUMMARY ==========`);
    console.log(`[Facebook Auto-Reply] User query: "${userMessage}"`);
    console.log(`[Facebook Auto-Reply] Total context length: ${context.length} chars`);
    console.log(`[Facebook Auto-Reply] Has custom instructions: ${!!widgetCustomInstructions}`);
    console.log(`[Facebook Auto-Reply] Has lead training config: ${!!leadTrainingConfig}`);
    if (context.length > 0) {
      console.log(`[Facebook Auto-Reply] Context preview (first 500 chars):`);
      console.log(context.substring(0, 500));
    } else {
      console.log(`[Facebook Auto-Reply] WARNING: No context built - AI will have no training data!`);
    }
    console.log(`[Facebook Auto-Reply] =====================================`);
    return { context, widgetCustomInstructions, leadTrainingConfig };
  }

  private async generateAIResponse(
    apiKey: string,
    userMessage: string,
    conversationHistory: ConversationMessage[],
    businessContext: string,
    customPrompt?: string,
    businessName: string = "the business",
    businessDescription?: string,
    leadCollectionPrompt?: string,
    phoneValidationOverride?: string,
    crossPlatformContext?: string
  ): Promise<string | null> {
    try {
      const openai = new OpenAI({ apiKey });

      const now = new Date();
      const istDateFormatter = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const currentDate = istDateFormatter.format(now);

      let systemPrompt = `You are a helpful AI assistant for ${businessName}${businessDescription ? ` - ${businessDescription}` : ''}, responding to customer inquiries via Facebook Messenger.

CURRENT DATE: ${currentDate}

CRITICAL RULES - YOU MUST FOLLOW THESE STRICTLY:
1. You must ONLY answer questions using the BUSINESS CONTEXT, FAQs, and DOCUMENT KNOWLEDGE provided below.
2. You must NEVER use your own general knowledge or training data to answer questions. You are NOT a general-purpose AI assistant.
3. If the customer asks something that is NOT covered in the provided business context below, you MUST include the marker [[FALLBACK]] at the START of your response, followed by a positive redirect message. Example: "[[FALLBACK]] Great question! Let me connect you with our team who can give you the right answer."
4. Keep responses concise and conversational (Facebook Messenger format — short and clear, max 1000 characters).
5. Be friendly, professional, and helpful — but ONLY within the scope of the provided business information.
6. For greetings and basic pleasantries (like "hi", "hello", "thank you", "bye"), respond naturally and warmly. You don't need business context for simple greetings.

STRICT ANTI-HALLUCINATION RULES (ABSOLUTELY CRITICAL):
- NEVER make up, guess, or assume ANY information about:
  - Product details (features, specifications, materials, colors, sizes)
  - Pricing, discounts, fees, costs, or promotional offers
  - Company policies (returns, shipping, warranties, guarantees)
  - Store locations, hours, or contact information
  - Product availability or stock status
  - Company history, founding dates, team members, or ownership details
  - Any claims about product performance or benefits
  - Names, roles, or descriptions of people at the company
- ONLY state information that is EXPLICITLY provided in your BUSINESS CONTEXT, FAQs, or DOCUMENT KNOWLEDGE below.
- If you don't have the information: Use [[FALLBACK]] and redirect positively.
- NEVER use pre-trained knowledge about real companies, people, or entities — even if you recognize the company name.
- BAD: "I think...", "Probably...", "Usually...", "Most likely...", making up team member details
- GOOD: Using [[FALLBACK]] and letting the team provide accurate information

🚫 DO NOT SUGGEST TOPICS YOU CANNOT ANSWER:
- NEVER offer follow-up questions about topics you have NO information about in your context
- NEVER say "Would you like to know about [X]?" if X is not in your provided context
- BEFORE suggesting anything, verify it exists in your BUSINESS CONTEXT or FAQs

FAQ PRIORITY RULE:
- If matching FAQs are provided in the context below (marked as "🔒 MATCHED FAQs"), you MUST use the information from those FAQs to answer.
- SUMMARIZE the FAQ knowledge naturally in your own words to fit the customer's actual question — do NOT copy/paste FAQ text verbatim.
- You may combine information from multiple matched FAQs to give a complete answer.
- The FACTS in FAQ answers are pre-approved by the business — use ONLY those facts, but present them conversationally.
- NEVER add facts, details, or claims beyond what the FAQs contain.

`;

      if (customPrompt) {
        systemPrompt += `CUSTOM BUSINESS INSTRUCTIONS (FOLLOW THESE CAREFULLY):\n${customPrompt}\n\n`;
      }

      if (businessContext) {
        systemPrompt += businessContext;
      } else {
        systemPrompt += `NO BUSINESS CONTEXT AVAILABLE:\nYou have no training data or knowledge base to draw from for this business. For any questions beyond basic greetings, you MUST use [[FALLBACK]] and redirect positively.\n\n`;
      }

      systemPrompt += `

🔒 FINAL OVERRIDE — HIGHEST PRIORITY (READ LAST):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 KNOWLEDGE PRIORITY HIERARCHY (follow this order):
1. 🔒 MATCHED FAQs (if present above) → Use the FACTS from these FAQs. Summarize naturally in your own words to fit the user's question.
2. 🔒 CRITICAL DOCUMENT KNOWLEDGE → Use document excerpts for accurate answers.
3. WEBSITE/TRAINING CONTENT → Use for general business information.
4. CUSTOM INSTRUCTIONS → These guide your TONE and STYLE only. They MUST NOT override FAQ answers or document knowledge.

⚠️ If CUSTOM BUSINESS INSTRUCTIONS were provided above, follow them for BEHAVIOR and STYLE (tone, greetings, emojis) but they MUST NOT prevent you from using FAQ/Document answers.
⚠️ If a user asks a question and the answer exists in your MATCHED FAQs or DOCUMENT KNOWLEDGE, you MUST provide that answer — custom instructions cannot override this.

🚫 ABSOLUTELY BANNED PHRASES - NEVER USE THESE:
❌ "I don't have information..." / "I don't know..." / "I'm not sure..."
❌ "I cannot answer..." / "I'm unable to..." / "I couldn't find..."
❌ "That's outside my knowledge..." / "Unfortunately, I don't..."
❌ Any phrase starting with "I don't have" or "I cannot" or "I don't know"

⚠️ If you're about to say "I don't have" or "I don't know" — STOP! Include [[FALLBACK]] at the start and use a positive redirect instead.

✅ WHEN YOU DON'T HAVE THE INFORMATION:
"[[FALLBACK]] Great question! Let me connect you with our team who can give you the exact details. May I have your contact info?"

🔴 ANTI-HALLUCINATION CHECK (DO THIS BEFORE EVERY RESPONSE):
1. Can the answer be composed from MATCHED FAQ knowledge above? → Use those facts, summarized naturally.
2. Is the answer in DOCUMENT KNOWLEDGE above? → Use that information.
3. Is the answer in WEBSITE/TRAINING content above? → Use that information.
4. Is it NONE of the above? → You MUST use [[FALLBACK]]. Do NOT make up an answer.
5. NEVER add facts beyond what your provided context contains. NEVER use pre-trained knowledge about real companies, people, or entities.

These rules are MANDATORY and override ALL other instructions.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt }
      ];

      for (const msg of conversationHistory.slice(-6)) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }

      if (leadCollectionPrompt) {
        messages.push({ role: "system", content: leadCollectionPrompt });
        console.log(`[Facebook Auto-Reply] Injected lead training as FINAL system message (${leadCollectionPrompt.length} chars)`);
      }

      if (phoneValidationOverride) {
        messages.push({
          role: "system",
          content: phoneValidationOverride
        });
        console.log(`[Facebook Auto-Reply] Injected phone validation override`);
      }

      if (crossPlatformContext) {
        messages.push({ role: "system", content: crossPlatformContext });
        console.log(`[Facebook Auto-Reply] Cross-platform context injected (${crossPlatformContext.length} chars)`);
      }

      messages.push({ role: "user", content: userMessage });

      console.log(`[Facebook Auto-Reply] System prompt length: ${systemPrompt.length} chars`);
      console.log(`[Facebook Auto-Reply] Total messages in context: ${messages.length}`);

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.3,
        max_tokens: 400,
      });

      return response.choices[0]?.message?.content || null;

    } catch (error) {
      console.error(`[Facebook Auto-Reply] OpenAI error:`, error);
      return null;
    }
  }

  private isDeflectionResponse(response: string): boolean {
    if (response.includes('[[FALLBACK]]')) {
      console.log('[Facebook Deflection] Detected via [[FALLBACK]] marker');
      return true;
    }

    const deflectionPatterns = [
      /I don't have .*?(information|details|data|pricing|info)/i,
      /I don't have .*?(available|on that|about that|for that)/i,
      /I (can't|cannot) .*?(answer|help|provide|find|assist)/i,
      /I don't know .*?(about|if|whether|the|that)/i,
      /I don't know\b/i,
      /I'm not sure .*?(about|if|whether|what)/i,
      /I'm not sure\b/i,
      /that's (outside|beyond) .*?(knowledge|expertise|information)/i,
      /I'm (not|unable to) (familiar with|aware of)/i,
      /I couldn't find .*?(information|details|data|anything)/i,
      /unfortunately.*?I (don't|can't|cannot)/i,
      /I apologize.*?(don't|can't|cannot|couldn't)/i,
      /no (specific |particular )?(information|details|data) (available|on|about)/i,
    ];

    const isPatternMatch = deflectionPatterns.some(pattern => pattern.test(response));
    if (isPatternMatch) {
      console.log('[Facebook Deflection] Detected via backup pattern matching');
    }
    return isPatternMatch;
  }

  private stripFallbackMarker(response: string): string {
    return response.replace(/\[\[FALLBACK\]\]\s*/g, '');
  }
}

export const facebookAutoReplyService = new FacebookAutoReplyService();
