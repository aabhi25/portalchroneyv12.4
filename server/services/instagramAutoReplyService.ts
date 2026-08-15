import { db } from "../db";
import { instagramSettings, instagramMessages, instagramLeads, businessAccounts, widgetSettings } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { vectorSearchService } from "./vectorSearchService";
import { faqEmbeddingService } from "./faqEmbeddingService";
import { businessContextCache, BusinessContextCache } from "./businessContextCache";
import { instagramService } from "./instagramService";
import { buildPhoneValidationOverride } from "./leadTrainingPrompt";
import { storage } from "../storage";
import OpenAI from "openai";
import { llamaService, LlamaService } from "../llamaService";
import { resolveProfile } from "./customerProfileService";
import { composeCrossPlatformContext, triggerSnapshotUpdate } from "./crossPlatformMemoryService";
import { selectRelevantTools } from "../aiTools";
import { ToolExecutionService } from "./toolExecutionService";

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

export class InstagramAutoReplyService {

  async generateAndSendReply(
    businessAccountId: string,
    senderId: string,
    userMessage: string
  ): Promise<{ success: boolean; reply?: string; error?: string }> {
    try {
      console.log(`[Instagram Auto-Reply] Processing message from ${senderId}`);

      const [settings] = await db
        .select()
        .from(instagramSettings)
        .where(eq(instagramSettings.businessAccountId, businessAccountId))
        .limit(1);

      if (!settings) {
        console.error(`[Instagram Auto-Reply] No Instagram settings found for business: ${businessAccountId}`);
        return { success: false, error: "Instagram settings not configured" };
      }

      if (settings.autoReplyEnabled !== "true") {
        console.log(`[Instagram Auto-Reply] Auto-reply disabled for business: ${businessAccountId}`);
        return { success: false, error: "Auto-reply is disabled" };
      }

      const businessAccount = await db.query.businessAccounts.findFirst({
        where: eq(businessAccounts.id, businessAccountId)
      });

      if (!businessAccount) {
        console.error(`[Instagram Auto-Reply] Business account not found: ${businessAccountId}`);
        return { success: false, error: "Business account not found" };
      }

      try {
        const { getSmartReplyResponse } = await import("./smartReplyService");
        const smartReply = await getSmartReplyResponse(businessAccountId, "instagram", userMessage);
        if (smartReply) {
          console.log(`[Instagram Auto-Reply] Smart reply matched: "${smartReply.matchedKeyword}" — sending configured response directly (skipping AI)`);
          const sendResult = await instagramService.sendMessage(settings, senderId, smartReply.text);
          if (!sendResult.success) {
            return { success: false, error: sendResult.error };
          }
          await instagramService.storeMessage(
            businessAccountId,
            senderId,
            smartReply.text,
            'outgoing'
          );
          return { success: true };
        }
      } catch (err) {
        console.error("[Instagram Auto-Reply] Smart reply error (non-fatal):", err);
      }

      const apiKey = businessAccount.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error(`[Instagram Auto-Reply] No OpenAI API key available`);
        return { success: false, error: "No OpenAI API key configured" };
      }

      const quickLang = LlamaService.quickDetectLanguage(userMessage);
      const [conversationHistory, { context: businessContext, widgetCustomInstructions, leadTrainingConfig }, detectedLang] = await Promise.all([
        this.getConversationHistory(businessAccountId, senderId),
        this.buildBusinessContext(businessAccountId, userMessage),
        quickLang !== null
          ? Promise.resolve(quickLang)
          : llamaService.detectLanguage(userMessage, apiKey).catch(() => 'en')
      ]);
      console.log(`[Instagram Auto-Reply] Language detected for "${userMessage.substring(0, 30)}": ${detectedLang}`);

      let crossPlatformContext = "";
      let persistedExtractedData: Record<string, any> = {};
      try {
        const existingLeads = await db
          .select()
          .from(instagramLeads)
          .where(
            and(
              eq(instagramLeads.businessAccountId, businessAccountId),
              eq(instagramLeads.senderId, senderId)
            )
          )
          .orderBy(desc(instagramLeads.createdAt))
          .limit(1);
        persistedExtractedData = (existingLeads.length > 0 ? existingLeads[0].extractedData : {}) as Record<string, any>;
        let phone = persistedExtractedData?.phone_number || null;
        let email = persistedExtractedData?.email_address || null;

        if (!phone || !email) {
          const liveContact = extractContactInfoFromConversation(conversationHistory, userMessage);
          if (!phone && liveContact.phone) {
            const cleaned = liveContact.phone.replace(/[^\d]/g, '');
            if (cleaned.length >= 8 && cleaned.length <= 12) {
              phone = liveContact.phone;
              console.log(`[Instagram Auto-Reply] Extracted phone from current message: ${phone}`);
            }
          }
          if (!email && liveContact.email) {
            email = liveContact.email;
            console.log(`[Instagram Auto-Reply] Extracted email from current message: ${email}`);
          }
        }

        const profile = await resolveProfile(businessAccountId, {
          phone,
          email,
          name: persistedExtractedData?.customer_name || null,
          platform: "instagram",
          platformUserId: senderId,
        });
        if (profile) {
          const isFirstMsg = !conversationHistory.some(m => m.role === 'assistant');
          crossPlatformContext = await composeCrossPlatformContext(businessAccountId, "instagram", profile.id, isFirstMsg);
          if (crossPlatformContext) {
            console.log(`[Instagram Auto-Reply] Cross-platform context loaded (${crossPlatformContext.length} chars, firstMsg: ${isFirstMsg})`);
          }
        }
      } catch (err) {
        console.error("[Instagram Auto-Reply] Cross-platform context error (non-fatal):", err);
      }

      const leadCollectionPrompt = leadTrainingConfig
        ? this.buildLeadCollectionPrompt(leadTrainingConfig, conversationHistory, userMessage, persistedExtractedData)
        : '';
      const phoneValidationOverride = leadTrainingConfig ? (buildPhoneValidationOverride(userMessage, leadTrainingConfig) || undefined) : undefined;

      const combinedInstructions = [
        widgetCustomInstructions,
      ].filter(Boolean).join('\n\n');

      const aiResult = await this.generateAIResponse(
        apiKey,
        userMessage,
        conversationHistory,
        businessContext,
        combinedInstructions || undefined,
        businessAccount.name || "the business",
        businessAccount.description || undefined,
        leadCollectionPrompt,
        phoneValidationOverride,
        detectedLang,
        crossPlatformContext || undefined,
        businessAccountId
      );

      if (!aiResult) {
        return { success: false, error: "Failed to generate AI response" };
      }

      let processedReply = aiResult.text;

      if (this.isDeflectionResponse(processedReply)) {
        console.log(`[Instagram Auto-Reply] Deflection detected, stripping [[FALLBACK]] marker`);
      }
      processedReply = this.stripFallbackMarker(processedReply);

      const sendResult = await instagramService.sendMessage(
        settings,
        senderId,
        processedReply
      );

      if (!sendResult.success) {
        console.error(`[Instagram Auto-Reply] Failed to send message: ${sendResult.error}`);
        return { success: false, error: sendResult.error };
      }

      await instagramService.storeMessage(
        businessAccountId,
        senderId,
        processedReply,
        "outgoing",
        { igMessageId: sendResult.messageId || undefined }
      );

      if (aiResult.isProductSelection) {
        console.log(`[Instagram Auto-Reply] Product selection response — skipping image cards`);
      } else if (aiResult.productCards && aiResult.productCards.length > 0) {
        const allCards = aiResult.productCards.slice(0, 4);
        const cardsWithImages = allCards
          .map((card, idx) => ({ ...card, originalIndex: idx }))
          .filter(card => card.imageUrl && /^https?:\/\/.+\..+/.test(card.imageUrl) && card.imageUrl.length < 2048);
        console.log(`[Instagram Auto-Reply] Sending ${cardsWithImages.length} product card(s) to ${senderId}`);

        let translatedDescriptions: Map<number, string> | null = null;
        if (detectedLang && detectedLang !== 'en') {
          try {
            const descriptionsToTranslate = cardsWithImages
              .filter(c => c.description)
              .map(c => ({ idx: c.originalIndex, desc: c.description! }));
            if (descriptionsToTranslate.length > 0) {
              const openaiClient = new OpenAI({ apiKey });
              const transResult = await openaiClient.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: `Translate the following product descriptions to ${detectedLang === 'hi' ? 'Hinglish (Hindi written in Roman script mixed with English)' : detectedLang}. Keep product-specific English terms as-is. Return ONLY the translations, one per line, in the same order. No numbering or labels.` },
                  { role: "user", content: descriptionsToTranslate.map(d => d.desc).join('\n---\n') }
                ],
                temperature: 0.3,
                max_tokens: 500,
              });
              const translations = (transResult.choices[0]?.message?.content || '').split('\n---\n').length === descriptionsToTranslate.length
                ? (transResult.choices[0]?.message?.content || '').split('\n---\n')
                : (transResult.choices[0]?.message?.content || '').split('\n').filter(l => l.trim());
              translatedDescriptions = new Map();
              descriptionsToTranslate.forEach((d, i) => {
                if (translations[i]) translatedDescriptions!.set(d.idx, translations[i].trim());
              });
              console.log(`[Instagram Auto-Reply] Translated ${translatedDescriptions.size} product description(s) to ${detectedLang}`);
            }
          } catch (transErr) {
            console.log(`[Instagram Auto-Reply] Caption translation failed (non-fatal), using English:`, transErr);
          }
        }

        for (const card of cardsWithImages) {
          try {
            await new Promise(resolve => setTimeout(resolve, 500));
            const imgResult = await instagramService.sendImageMessage(settings, senderId, card.imageUrl!);
            if (imgResult.success) {
              const captionParts: string[] = [`${card.originalIndex + 1}. ${card.name}`];
              if (card.price && card.price > 0) captionParts.push(`₹${card.price.toLocaleString('en-IN')}`);
              const desc = translatedDescriptions?.get(card.originalIndex) || card.description;
              if (desc) captionParts.push(desc);
              const captionText = captionParts.join('\n');

              await new Promise(resolve => setTimeout(resolve, 300));
              const captionResult = await instagramService.sendMessage(settings, senderId, captionText);
              if (!captionResult.success) {
                console.log(`[Instagram Auto-Reply] Caption send failed (non-fatal): ${captionResult.error}`);
              }

              await instagramService.storeMessage(
                businessAccountId,
                senderId,
                captionText,
                "outgoing",
                {
                  igMessageId: imgResult.messageId || undefined,
                  messageType: "image",
                  mediaUrl: card.imageUrl,
                }
              );
              console.log(`[Instagram Auto-Reply] Product card sent: ${card.name}`);
            } else {
              console.log(`[Instagram Auto-Reply] Image send failed (non-fatal): ${imgResult.error}`);
            }
          } catch (imgErr) {
            console.error(`[Instagram Auto-Reply] Image send error (non-fatal):`, imgErr);
          }
        }

        const productListSummary = `[Products shown: ${allCards.map((c, i) => `${i + 1}. ${c.name}`).join(', ')}]`;
        await instagramService.storeMessage(businessAccountId, senderId, productListSummary, "outgoing").catch(err =>
          console.error('[Instagram Auto-Reply] Failed to store product list summary:', err)
        );
      } else if (aiResult.productImages && aiResult.productImages.length > 0) {
        const uniqueValidImages = [...new Set(aiResult.productImages)]
          .filter(url => /^https?:\/\/.+\..+/.test(url) && url.length < 2048);
        const imagesToSend = uniqueValidImages.slice(0, 4);
        console.log(`[Instagram Auto-Reply] Sending ${imagesToSend.length} product image(s) to ${senderId}`);

        for (const imageUrl of imagesToSend) {
          try {
            await new Promise(resolve => setTimeout(resolve, 500));
            const imgResult = await instagramService.sendImageMessage(settings, senderId, imageUrl);
            if (imgResult.success) {
              await instagramService.storeMessage(
                businessAccountId,
                senderId,
                null,
                "outgoing",
                {
                  igMessageId: imgResult.messageId || undefined,
                  messageType: "image",
                  mediaUrl: imageUrl,
                }
              );
              console.log(`[Instagram Auto-Reply] Product image sent: ${imageUrl.substring(0, 60)}...`);
            } else {
              console.log(`[Instagram Auto-Reply] Image send failed (non-fatal): ${imgResult.error}`);
            }
          } catch (imgErr) {
            console.error(`[Instagram Auto-Reply] Image send error (non-fatal):`, imgErr);
          }
        }
      }

      console.log(`[Instagram Auto-Reply] Successfully sent reply to ${senderId}`);

      this.tryAutoCaptureLead(businessAccountId, senderId, conversationHistory, userMessage, leadTrainingConfig, settings)
        .catch(err => console.error("[Instagram Auto-Reply] Lead capture error:", err));

      try {
        const profile = await resolveProfile(businessAccountId, {
          platform: "instagram",
          platformUserId: senderId,
        });
        if (profile) {
          triggerSnapshotUpdate(businessAccountId, profile.id, "instagram", senderId);
        }
      } catch (err) {
        console.error("[Instagram Auto-Reply] Snapshot trigger error (non-fatal):", err);
      }

      return { success: true, reply: processedReply };

    } catch (error) {
      console.error(`[Instagram Auto-Reply] Error:`, error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  private buildLeadCollectionPrompt(
    leadTrainingConfig: LeadTrainingConfig | null,
    conversationHistory: ConversationMessage[],
    currentUserMessage: string,
    persistedExtractedData?: Record<string, any>
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

    if (persistedExtractedData) {
      if (persistedExtractedData.phone_number && !collected.phone) {
        collected.phone = persistedExtractedData.phone_number;
        collected.mobile = persistedExtractedData.phone_number;
        collected.whatsapp = persistedExtractedData.phone_number;
        console.log(`[Instagram Auto-Reply] Phone already persisted in lead record: ${persistedExtractedData.phone_number}`);
      }
      if (persistedExtractedData.email_address && !collected.email) {
        collected.email = persistedExtractedData.email_address;
        console.log(`[Instagram Auto-Reply] Email already persisted in lead record: ${persistedExtractedData.email_address}`);
      }
      if (persistedExtractedData.customer_name && !collected.name) {
        collected.name = persistedExtractedData.customer_name;
        console.log(`[Instagram Auto-Reply] Name already persisted in lead record: ${persistedExtractedData.customer_name}`);
      }
    }

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
      console.log(`[Instagram Auto-Reply] All lead fields already collected`);

      const isJustContactInfo = /^\+?[\d\s().-]{7,20}$/.test(currentUserMessage.trim()) ||
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentUserMessage.trim());

      if (isJustContactInfo) {
        console.log(`[Instagram Auto-Reply] User message is just contact info — injecting post-collection guard`);
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

    console.log(`[Instagram Auto-Reply] Lead collection: missing fields = [${missingFieldNames.join(', ')}], next = ${nextFieldName} (${isNextFieldRequired ? 'required' : 'optional'})`);

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
        console.log(`[Instagram Lead Capture] Lead capture disabled for this business`);
        return;
      }

      const collected = extractContactInfoFromConversation(conversationHistory, currentUserMessage);
      const hasContactData = !!(collected.phone || collected.email || collected.name);

      if (!hasContactData) {
        return;
      }

      console.log(`[Instagram Lead Capture] Contact info detected: name=${collected.name || 'N/A'}, phone=${collected.phone || 'N/A'}, email=${collected.email || 'N/A'}`);

      if (leadTrainingConfig?.fields) {
        const phoneField = leadTrainingConfig.fields.find(
          f => (f.id.toLowerCase() === 'mobile' || f.id.toLowerCase() === 'phone') && f.enabled
        );
        if (phoneField && collected.phone) {
          const digitCount = (phoneField as any).digitCount || 10;
          const digitsOnly = collected.phone.replace(/\D/g, '');
          if (digitsOnly.length !== digitCount) {
            console.log(`[Instagram Lead Capture] Phone ${collected.phone} doesn't match required ${digitCount} digits, skipping lead save`);
            return;
          }
        }
      }

      const existingLeads = await db
        .select()
        .from(instagramLeads)
        .where(
          and(
            eq(instagramLeads.businessAccountId, businessAccountId),
            eq(instagramLeads.senderId, senderId)
          )
        )
        .orderBy(desc(instagramLeads.createdAt))
        .limit(1);

      const senderUsername = await this.getSenderUsername(businessAccountId, senderId);

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
            .update(instagramLeads)
            .set({
              extractedData: mergedData,
              senderUsername: senderUsername || existingLead.senderUsername,
              updatedAt: new Date(),
            })
            .where(eq(instagramLeads.id, existingLead.id));

          console.log(`[Instagram Lead Capture] Updated existing lead ${existingLead.id} with new data`);
        } else {
          console.log(`[Instagram Lead Capture] No new data to update for existing lead ${existingLead.id}`);
        }
      } else {
        const newLead = await instagramService.createInstagramLead(businessAccountId, {
          senderId,
          senderUsername: senderUsername || undefined,
          extractedData,
          status: "new",
        });

        console.log(`[Instagram Lead Capture] Created new lead ${newLead.id} from DM conversation`);
      }
    } catch (error) {
      console.error(`[Instagram Lead Capture] Error:`, error);
    }
  }

  private async getSenderUsername(businessAccountId: string, senderId: string): Promise<string | null> {
    const [msg] = await db
      .select({ senderUsername: instagramMessages.senderUsername })
      .from(instagramMessages)
      .where(
        and(
          eq(instagramMessages.businessAccountId, businessAccountId),
          eq(instagramMessages.senderId, senderId),
          sql`${instagramMessages.senderUsername} IS NOT NULL AND ${instagramMessages.senderUsername} != ''`
        )
      )
      .orderBy(desc(instagramMessages.createdAt))
      .limit(1);

    if (msg?.senderUsername) return msg.senderUsername;

    const [existingLead] = await db
      .select({ senderUsername: instagramLeads.senderUsername })
      .from(instagramLeads)
      .where(
        and(
          eq(instagramLeads.businessAccountId, businessAccountId),
          eq(instagramLeads.senderId, senderId),
          sql`${instagramLeads.senderUsername} IS NOT NULL AND ${instagramLeads.senderUsername} != ''`
        )
      )
      .limit(1);

    if (existingLead?.senderUsername) return existingLead.senderUsername;

    try {
      const instagramService = (await import("./instagramService")).instagramService;
      const settings = await instagramService.getSettings(businessAccountId);
      if (settings) {
        const decryptedToken = instagramService.getDecryptedAccessToken(settings);
        if (decryptedToken) {
          const profile = await instagramService.getUserProfile(decryptedToken, senderId);
          if (profile?.username) {
            console.log(`[Instagram Auto-Reply] Resolved username via API: @${profile.username}`);
            return profile.username;
          }
        }
      }
    } catch (err) {
      console.log(`[Instagram Auto-Reply] Could not resolve username via API for ${senderId}`);
    }

    return null;
  }

  private async getConversationHistory(
    businessAccountId: string,
    senderId: string
  ): Promise<ConversationMessage[]> {
    const recentMessages = await db
      .select({
        messageText: instagramMessages.messageText,
        direction: instagramMessages.direction,
        createdAt: instagramMessages.createdAt
      })
      .from(instagramMessages)
      .where(
        and(
          eq(instagramMessages.businessAccountId, businessAccountId),
          eq(instagramMessages.senderId, senderId)
        )
      )
      .orderBy(desc(instagramMessages.createdAt))
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

    console.log(`[Instagram Auto-Reply] Building comprehensive business context for: ${businessAccountId}`);

    try {
      const cacheKey = `ig_business_context_${businessAccountId}`;
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

        console.log(`[Instagram Auto-Reply] [CACHE MISS] Parallel data loading completed in ${Date.now() - parallelLoadStart}ms`);

        const businessAccount = businessAccountResult.status === 'fulfilled' ? businessAccountResult.value : null;
        const widgetSettingArr = widgetSettingResult.status === 'fulfilled' ? widgetSettingResult.value : [];
        const websiteContent = websiteContentResult.status === 'fulfilled' ? websiteContentResult.value : null;
        const analyzedPages = analyzedPagesResult.status === 'fulfilled' ? analyzedPagesResult.value : [];
        const trainingDocs = trainingDocsResult.status === 'fulfilled' ? trainingDocsResult.value : [];

        if (businessAccount?.description) {
          staticContext += `BUSINESS OVERVIEW:\n${businessAccount.description}\n\n`;
          console.log(`[Instagram Auto-Reply] [CACHE MISS] Added business description (${businessAccount.description.length} chars)`);
        }

        const widgetSetting = widgetSettingArr[0];
        if (widgetSetting?.customInstructions) {
          cachedCustomInstructions = widgetSetting.customInstructions;
          console.log(`[Instagram Auto-Reply] [CACHE MISS] Found widget custom instructions (${cachedCustomInstructions.length} chars)`);
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
            console.log(`[Instagram Auto-Reply] [CACHE MISS] Added website analysis content`);
          }
        } catch (error) {
          console.error('[Instagram Auto-Reply] Error loading website analysis:', error);
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
              console.log(`[Instagram Auto-Reply] [CACHE MISS] Loaded ${pagesLoaded} analyzed page(s) into context`);
              staticContext += `IMPORTANT: Use all the above website content to answer customer questions accurately.\n\n`;
            }
          }
        } catch (error) {
          console.error('[Instagram Auto-Reply] Error loading analyzed pages:', error);
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
                    console.error(`[Instagram Auto-Reply] Error parsing key points for ${doc.originalFilename}:`, parseError);
                  }
                }
              }
            }
            console.log(`[Instagram Auto-Reply] [CACHE MISS] Loaded ${completedDocs.length} training document(s) summaries into context`);
            staticContext += `IMPORTANT: Use this training document knowledge to provide accurate, informed responses.\n\n`;
          }
        } catch (error) {
          console.error('[Instagram Auto-Reply] Error loading training documents:', error);
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
        console.log(`[Instagram Auto-Reply] Loaded lead training config with ${leadTrainingConfig?.fields?.length || 0} fields (fresh, not cached)`);
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

        console.log(`[Instagram Auto-Reply] Added ${searchResults.length} document chunks from vector search`);
      }

      const hasEmbeddedFaqs = await faqEmbeddingService.hasEmbeddedFAQs(businessAccountId);
      console.log(`[Instagram Auto-Reply] Business has embedded FAQs: ${hasEmbeddedFaqs}`);

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

        console.log(`[Instagram Auto-Reply] Added ${relevantFaqs.length} semantically relevant FAQs`);
      } else if (hasEmbeddedFaqs) {
        console.log(`[Instagram Auto-Reply] WARNING: FAQs exist but none matched the query (similarity too low)`);
      } else {
        console.log(`[Instagram Auto-Reply] WARNING: No embedded FAQs found for this business`);
      }

    } catch (error) {
      console.error(`[Instagram Auto-Reply] Context building error:`, error);
    }

    console.log(`[Instagram Auto-Reply] ========== CONTEXT SUMMARY ==========`);
    console.log(`[Instagram Auto-Reply] User query: "${userMessage}"`);
    console.log(`[Instagram Auto-Reply] Total context length: ${context.length} chars`);
    console.log(`[Instagram Auto-Reply] Has custom instructions: ${!!widgetCustomInstructions}`);
    console.log(`[Instagram Auto-Reply] Has lead training config: ${!!leadTrainingConfig}`);
    if (context.length > 0) {
      console.log(`[Instagram Auto-Reply] Context preview (first 500 chars):`);
      console.log(context.substring(0, 500));
    } else {
      console.log(`[Instagram Auto-Reply] WARNING: No context built - AI will have no training data!`);
    }
    console.log(`[Instagram Auto-Reply] =====================================`);
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
    detectedLanguage?: string,
    crossPlatformContext?: string,
    businessAccountId?: string
  ): Promise<{ text: string; productImages?: string[]; productCards?: { name: string; description?: string; price?: number; imageUrl?: string }[]; isProductSelection?: boolean } | null> {
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

      let systemPrompt = `You are a helpful AI assistant for ${businessName}${businessDescription ? ` - ${businessDescription}` : ''}, responding to customer inquiries via Instagram DMs.

CURRENT DATE: ${currentDate}

CRITICAL RULES - YOU MUST FOLLOW THESE STRICTLY:
1. You must ONLY answer questions using the BUSINESS CONTEXT, FAQs, and DOCUMENT KNOWLEDGE provided below.
2. You must NEVER use your own general knowledge or training data to answer questions. You are NOT a general-purpose AI assistant.
3. If the customer asks something that is NOT covered in the provided business context below, you MUST include the marker [[FALLBACK]] at the START of your response, followed by a positive redirect message. Example: "[[FALLBACK]] Great question! Let me connect you with our team who can give you the right answer."
4. Keep responses concise and conversational (Instagram DM format — short and clear, max 1000 characters).
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

PRODUCT SELECTION BY NUMBER:
If the conversation history contains a "[Products shown: ...]" message and the user replies with just a number (e.g., "2"), they are selecting that numbered product. Use the get_products tool to search for that specific product by name (from the products shown list), then provide detailed information about it. Do NOT deflect or say you don't understand — this is a product selection.

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

      // Inject lead training prompt as LAST system message (after conversation history)
      // This position gets highest attention weight from GPT — matching phoneValidationOverride pattern
      if (leadCollectionPrompt) {
        messages.push({ role: "system", content: leadCollectionPrompt });
        console.log(`[Instagram Auto-Reply] Injected lead training as FINAL system message (${leadCollectionPrompt.length} chars)`);
      }

      // Phone validation gate — reject invalid numbers before AI responds
      if (phoneValidationOverride) {
        messages.push({
          role: "system",
          content: phoneValidationOverride
        });
        console.log(`[Instagram Auto-Reply] Injected phone validation override`);
      }

      if (crossPlatformContext) {
        messages.push({ role: "system", content: crossPlatformContext });
        console.log(`[Instagram Auto-Reply] Cross-platform context injected (${crossPlatformContext.length} chars)`);
      }

      messages.push({ role: "user", content: userMessage });

      const LANGUAGE_NAMES: Record<string, string> = {
        'en': 'English', 'hi': 'Hindi', 'hinglish': 'Hinglish',
        'ta': 'Tamil', 'te': 'Telugu', 'kn': 'Kannada', 'mr': 'Marathi',
        'bn': 'Bengali', 'gu': 'Gujarati', 'ml': 'Malayalam', 'pa': 'Punjabi',
        'ur': 'Urdu', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
        'pt': 'Portuguese', 'it': 'Italian', 'ja': 'Japanese', 'ko': 'Korean',
        'zh': 'Chinese', 'ar': 'Arabic', 'ru': 'Russian', 'tr': 'Turkish',
      };
      const langName = detectedLanguage ? (LANGUAGE_NAMES[detectedLanguage] || 'English') : 'English';
      const languageOverride = `🌐 LANGUAGE — ABSOLUTE OVERRIDE (HIGHEST PRIORITY):
The user's current message is in ${langName}. You MUST reply in ${langName}.
Ignore the language of any previous assistant messages in the conversation history.
Do NOT switch languages. Do NOT use any other language.
SCRIPT RULE: If the user's message contains ONLY Latin/Roman characters → respond in Latin script only.`;
      messages.push({ role: "system", content: languageOverride });

      console.log(`[Instagram Auto-Reply] Language override injected: ${langName}`);
      console.log(`[Instagram Auto-Reply] System prompt length: ${systemPrompt.length} chars`);
      console.log(`[Instagram Auto-Reply] Total messages in context: ${messages.length}`);

      let tools: any[] | undefined;
      if (businessAccountId) {
        try {
          const allProducts = await storage.getAllProducts(businessAccountId);
          const hasProducts = allProducts.length > 0;
          if (hasProducts) {
            const historyForTools = conversationHistory.slice(-6).map(m => ({ role: m.role, content: m.content }));
            const selectedTools = await selectRelevantTools(
              userMessage,
              false,
              false,
              true,
              historyForTools,
              apiKey
            );
            const productTool = selectedTools.find((t: any) => t.function?.name === 'get_products');
            if (productTool) {
              const instagramProductTool = JSON.parse(JSON.stringify(productTool));
              instagramProductTool.function.description = 'Search and retrieve products from the catalog when the user asks about products, items, or wants to browse. Returns product details including name, price, and description. Product images will be sent as separate image attachments automatically. Keep to 3-5 products max.';
              tools = [instagramProductTool];
              console.log(`[Instagram Auto-Reply] Product tool included for this message`);
            }
          }
        } catch (err) {
          console.log(`[Instagram Auto-Reply] Tool selection error (non-fatal):`, err);
        }
      }

      const requestParams: any = {
        model: "gpt-4o-mini",
        messages,
        temperature: 0.3,
        max_tokens: 500,
      };
      if (tools && tools.length > 0) {
        requestParams.tools = tools;
        requestParams.tool_choice = "auto";
      }

      let response = await openai.chat.completions.create(requestParams);
      let assistantMessage = response.choices[0]?.message;

      if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0 && businessAccountId) {
        console.log(`[Instagram Auto-Reply] AI requested ${assistantMessage.tool_calls.length} tool call(s)`);

        const toolMessages: any[] = [
          ...messages,
          assistantMessage,
        ];

        const collectedProductImages: string[] = [];
        const collectedProductCards: { name: string; description?: string; price?: number; imageUrl?: string }[] = [];

        for (const toolCall of assistantMessage.tool_calls) {
          try {
            const fnName = toolCall.function.name;
            const fnArgs = JSON.parse(toolCall.function.arguments || '{}');
            console.log(`[Instagram Auto-Reply] Executing tool: ${fnName}(${JSON.stringify(fnArgs)})`);

            if (fnName === 'get_products') {
              try {
                const result = await ToolExecutionService.executeTool(
                  'get_products',
                  fnArgs,
                  {
                    businessAccountId,
                    userId: 'instagram-agent',
                    userMessage,
                  }
                );

                let toolResultStr: string;
                if (result.success && result.data && Array.isArray(result.data)) {
                  const productSummaries = result.data.slice(0, 5).map((p: any, idx: number) => {
                    const parts = [`${idx + 1}. ${p.name}`];
                    if (p.price && Number(p.price) > 0) parts.push(`Price: ₹${Number(p.price).toLocaleString('en-IN')}`);
                    if (p.description) parts.push(p.description.substring(0, 100));
                    return parts.join(' | ');
                  });
                  toolResultStr = `Found ${result.data.length} product(s):\n${productSummaries.join('\n')}`;
                  if (result.pagination?.hasMore) {
                    toolResultStr += `\n(More products available)`;
                  }

                  for (const p of result.data.slice(0, 5)) {
                    if (p.imageUrl) {
                      collectedProductImages.push(p.imageUrl);
                    }
                    collectedProductCards.push({
                      name: p.name,
                      description: p.description?.substring(0, 200),
                      price: p.price ? Number(p.price) : undefined,
                      imageUrl: p.imageUrl,
                    });
                  }
                } else {
                  toolResultStr = result.message || 'No products found matching your search.';
                }

                toolMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: toolResultStr,
                });
                console.log(`[Instagram Auto-Reply] Tool result: ${toolResultStr.substring(0, 200)}...`);
              } catch (err) {
                console.error(`[Instagram Auto-Reply] Tool execution error:`, err);
                toolMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: "Product search temporarily unavailable.",
                });
              }
            } else {
              toolMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Tool ${fnName} is not available on Instagram.`,
              });
            }
          } catch (parseErr) {
            console.error(`[Instagram Auto-Reply] Tool call parse error:`, parseErr);
            toolMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: "Failed to process tool request.",
            });
          }
        }

        const cleanedUserMsg = userMessage.trim().replace(/[^\w\s]/g, '').trim();
        const isNumberSelection = /^\d{1,2}$/.test(cleanedUserMsg) || /^(option|number|item|choice)\s*\d{1,2}$/i.test(cleanedUserMsg);

        if (isNumberSelection) {
          toolMessages.push({
            role: "system",
            content: `INSTAGRAM DM FORMAT — PRODUCT SELECTION RESPONSE: The user selected a specific product by number. Give a detailed, enthusiastic response about this product. Include the full description, key features, and price if available. End by offering next steps like "Would you like to book a free consultation?" or "Want to explore customization options?" Do NOT say "Reply with a number" — they already selected. Do NOT include image URLs or links. Keep it conversational and helpful. Use plain text — no markdown.`
          });
        } else {
          toolMessages.push({
            role: "system",
            content: `INSTAGRAM DM FORMAT: Do NOT list individual product names or descriptions — those details will be sent separately as image captions. Instead, write a brief, friendly intro message (e.g., "Here are some wardrobe designs for you!") that naturally references what the user asked for. End with "Reply with a number to know more!" Keep it to 2-3 short sentences max. Do NOT use markdown or bullet points — use plain text that looks good in a DM. Do NOT include image URLs or links.`
          });
        }

        try {
          const followUpResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: toolMessages,
            temperature: 0.3,
            max_tokens: isNumberSelection ? 800 : 500,
          });

          const text = followUpResponse.choices[0]?.message?.content;
          if (!text) return null;
          return { 
            text, 
            productImages: collectedProductImages.length > 0 ? collectedProductImages : undefined,
            productCards: collectedProductCards.length > 0 ? collectedProductCards : undefined,
            isProductSelection: isNumberSelection,
          };
        } catch (followUpErr) {
          console.error(`[Instagram Auto-Reply] Follow-up completion after tool call failed:`, followUpErr);
          return { text: "I'm having trouble fetching product details right now. Please try again in a moment!" };
        }
      }

      const text = assistantMessage?.content;
      if (!text) return null;
      return { text };

    } catch (error) {
      console.error(`[Instagram Auto-Reply] OpenAI error:`, error);
      return null;
    }
  }

  private isDeflectionResponse(response: string): boolean {
    if (response.includes('[[FALLBACK]]')) {
      console.log('[Instagram Deflection] Detected via [[FALLBACK]] marker');
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
      console.log('[Instagram Deflection] Detected via backup pattern matching');
    }
    return isPatternMatch;
  }

  private stripFallbackMarker(response: string): string {
    return response.replace(/\[\[FALLBACK\]\]\s*/g, '');
  }
}

export const instagramAutoReplyService = new InstagramAutoReplyService();
