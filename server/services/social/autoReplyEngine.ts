/**
 * DM auto-reply engine shared by Instagram and Facebook (instagramAutoReplyService.ts /
 * facebookAutoReplyService.ts are thin wrappers that supply a SocialAutoReplyPlatform).
 *
 * Order per DM: settings / auto-reply switch → smart reply (keyword match, no AI) → context
 * (history, business knowledge, cross-platform memory, lead-collection prompt) → AI → send →
 * lead capture + memory snapshot. `richMedia` platforms (Instagram) also get language
 * detection, the product-catalog tool and product image cards; Facebook keeps the plain
 * text reply it always had. Lead timing (Smart Lead Training: start / custom / intent /
 * keyword, phone digit rule) comes from leadCapture/channelLeadFields.ts.
 */
import { db } from "../../db";
import { businessAccounts, widgetSettings } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { vectorSearchService } from "../vectorSearchService";
import { appliesToChannel } from "@shared/knowledgeChannels";
import { filterCustomInstructionsForChannel } from "../chatContext/customInstructions";
import { faqEmbeddingService } from "../faqEmbeddingService";
import { businessContextCache } from "../businessContextCache";
import { socialLeadContact } from "../socialLeadFields";
import {
  normalizeChannelLeadFields, analyzeLeadConversation, resolveNextLeadAsk, buildChannelLeadPrompt, describeLeadDecision,
  extractContacts, phoneModeOf, currentConversation, ensureCurrentMessage, CONVERSATION_FETCH_LIMIT,
  type ChatTurn, type KnownContact,
} from "../leadCapture/channelLeadFields";
import { storage } from "../../storage";
import { llamaService, LlamaService } from "../../llamaService";
import { resolveProfile } from "../customerProfileService";
import { composeCrossPlatformContext, triggerSnapshotUpdate } from "../crossPlatformMemoryService";
import { selectRelevantTools } from "../../aiTools";
import { ToolExecutionService } from "../toolExecutionService";
import { createOpenAI, OPENAI_TIMEOUTS } from "../../lib/openaiClient";
import type { SocialPlatformId } from "./types";

type SendResult = { success: boolean; messageId?: string; error?: string };

export interface SocialAutoReplyPlatform {
  platform: SocialPlatformId;
  /** "Instagram" | "Facebook" — used in logs and messages. */
  label: string;
  tables: { settings: any; messages: any; leads: any };
  /** Column (messages + leads) holding the customer's display name. */
  senderNameColumn: "senderUsername" | "senderName";
  /** Business-context cache key prefix: "ig" | "fb". */
  cachePrefix: string;
  /** System prompt wording: "Instagram DMs" / "Facebook Messenger". */
  channelPhrase: string;
  /** System prompt wording: "Instagram DM format" / "Facebook Messenger format". */
  formatPhrase: string;
  /**
   * Instagram: language detection + language override, the product-catalog tool with image
   * cards, persisted lead data in the lead-collection prompt, 500 max tokens.
   * Facebook: none of these, 400 max tokens.
   */
  richMedia: boolean;
  /** Facebook passes phone/email/name when resolving the profile for the memory snapshot. */
  snapshotWithContact: boolean;
  sendMessage(settings: any, recipientId: string, text: string): Promise<SendResult>;
  sendImageMessage?(settings: any, recipientId: string, imageUrl: string): Promise<SendResult>;
  storeMessage(
    businessAccountId: string,
    senderId: string,
    text: string | null,
    direction: "incoming" | "outgoing",
    options?: { platformMessageId?: string; messageType?: string; mediaUrl?: string },
  ): Promise<unknown>;
  createLead(businessAccountId: string, data: { senderId: string; senderName?: string; extractedData: Record<string, any>; status: string }): Promise<{ id: string }>;
  /** Display name from the Graph API (IG username / FB "first last"), or null. */
  fetchSenderNameFromApi(businessAccountId: string, senderId: string): Promise<string | null>;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

/** widget_settings.leadTrainingConfig (Smart Lead Training); read by leadCapture/channelLeadFields. */
type LeadTrainingConfig = { fields?: unknown[] } & Record<string, unknown>;

interface CollectedContactInfo {
  mobile?: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
}

/** Phone / email typed in the recent chat — used to find the customer's cross-platform profile. */
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

  return collected;
}

const PRODUCT_SELECTION_PROMPT = `PRODUCT SELECTION BY NUMBER:
If the conversation history contains a "[Products shown: ...]" message and the user replies with just a number (e.g., "2"), they are selecting that numbered product. Use the get_products tool to search for that specific product by name (from the products shown list), then provide detailed information about it. Do NOT deflect or say you don't understand — this is a product selection.

`;

export class SocialAutoReplyEngine {
  constructor(private readonly p: SocialAutoReplyPlatform) {}

  private get tag(): string {
    return `[${this.p.label} Auto-Reply]`;
  }

  private get leadTag(): string {
    return `[${this.p.label} Lead Capture]`;
  }

  private get deflectionTag(): string {
    return `[${this.p.label} Deflection]`;
  }

  private async latestLeadData(businessAccountId: string, senderId: string): Promise<Record<string, any>> {
    const leads = this.p.tables.leads;
    const existingLeads = await db
      .select()
      .from(leads)
      .where(and(eq(leads.businessAccountId, businessAccountId), eq(leads.senderId, senderId)))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    return (existingLeads.length > 0 ? existingLeads[0].extractedData : {}) as Record<string, any>;
  }

  // Sent when the AI can't produce an answer, so the customer isn't left in silence
  // (same wording as WhatsApp). At most once every 5 minutes per customer.
  private readonly AI_FAILURE_REPLY = "Sorry, I'm having trouble answering right now. Please try again in a few minutes.";
  private aiFailureNoticeAt = new Map<string, number>();

  /**
   * Replies to one DM. Callers run this inside the per-customer queue (see metaDmHandler),
   * so replies to the same customer never overlap.
   */
  async generateAndSendReply(
    businessAccountId: string,
    senderId: string,
    userMessage: string
  ): Promise<{ success: boolean; reply?: string; error?: string }> {
    const result = await this._generateAndSendReply(businessAccountId, senderId, userMessage);
    if (result.aiFailed) await this.sendAiFailureNotice(businessAccountId, senderId);
    const { aiFailed, ...rest } = result;
    return rest;
  }

  private async sendAiFailureNotice(businessAccountId: string, senderId: string): Promise<void> {
    const key = `${businessAccountId}:${senderId}`;
    if (Date.now() - (this.aiFailureNoticeAt.get(key) || 0) < 5 * 60_000) return;
    this.aiFailureNoticeAt.set(key, Date.now());
    if (this.aiFailureNoticeAt.size > 5000) {
      const cutoff = Date.now() - 5 * 60_000;
      this.aiFailureNoticeAt.forEach((t, k) => { if (t < cutoff) this.aiFailureNoticeAt.delete(k); });
    }
    try {
      const [settings] = await db.select().from(this.p.tables.settings).where(eq(this.p.tables.settings.businessAccountId, businessAccountId)).limit(1);
      if (!settings) return;
      const sent = await this.p.sendMessage(settings, senderId, this.AI_FAILURE_REPLY);
      if (!sent.success) {
        console.error(`${this.tag} AI failure notice not sent: ${sent.error}`);
        return;
      }
      await this.p.storeMessage(businessAccountId, senderId, this.AI_FAILURE_REPLY, "outgoing");
    } catch (err) {
      console.error(`${this.tag} AI failure notice error:`, err instanceof Error ? err.message : err);
    }
  }

  private async _generateAndSendReply(
    businessAccountId: string,
    senderId: string,
    userMessage: string
  ): Promise<{ success: boolean; reply?: string; error?: string; aiFailed?: boolean }> {
    let replySent = false;
    try {
      console.log(`${this.tag} Processing message from ${senderId}`);

      const [settings] = await db
        .select()
        .from(this.p.tables.settings)
        .where(eq(this.p.tables.settings.businessAccountId, businessAccountId))
        .limit(1);

      if (!settings) {
        console.error(`${this.tag} No ${this.p.label} settings found for business: ${businessAccountId}`);
        return { success: false, error: `${this.p.label} settings not configured` };
      }

      if (settings.autoReplyEnabled !== "true") {
        console.log(`${this.tag} Auto-reply disabled for business: ${businessAccountId}`);
        return { success: false, error: "Auto-reply is disabled" };
      }

      const businessAccount = await db.query.businessAccounts.findFirst({
        where: eq(businessAccounts.id, businessAccountId)
      });

      if (!businessAccount) {
        console.error(`${this.tag} Business account not found: ${businessAccountId}`);
        return { success: false, error: "Business account not found" };
      }

      // Smart replies (keyword → configured answer) take precedence over the AI.
      try {
        const { getSmartReplyResponse } = await import("../smartReplyService");
        const smartReply = await getSmartReplyResponse(businessAccountId, this.p.platform, userMessage);
        if (smartReply) {
          console.log(`${this.tag} Smart reply matched: "${smartReply.matchedKeyword}" — sending configured response directly (skipping AI)`);
          const sendResult = await this.p.sendMessage(settings, senderId, smartReply.text);
          if (!sendResult.success) {
            return { success: false, error: sendResult.error };
          }
          await this.p.storeMessage(
            businessAccountId,
            senderId,
            smartReply.text,
            'outgoing'
          );
          return { success: true };
        }
      } catch (err) {
        console.error(`${this.tag} Smart reply error (non-fatal):`, err);
      }

      const apiKey = businessAccount.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error(`${this.tag} No OpenAI API key available`);
        return { success: false, error: "No OpenAI API key configured" };
      }

      const quickLang = this.p.richMedia ? LlamaService.quickDetectLanguage(userMessage) : null;
      const [conversationHistory, { context: businessContext, widgetCustomInstructions, leadTrainingConfig }, detectedLang] = await Promise.all([
        this.getConversationHistory(businessAccountId, senderId),
        this.buildBusinessContext(businessAccountId, userMessage),
        !this.p.richMedia
          ? Promise.resolve(undefined)
          : quickLang !== null
            ? Promise.resolve(quickLang)
            : llamaService.detectLanguage(userMessage, apiKey).catch(() => 'en')
      ]);
      if (this.p.richMedia) console.log(`${this.tag} Language detected: ${detectedLang}`);

      let crossPlatformContext = "";
      let persistedExtractedData: Record<string, any> = {};
      try {
        persistedExtractedData = await this.latestLeadData(businessAccountId, senderId);
        let phone = persistedExtractedData?.phone_number || null;
        let email = persistedExtractedData?.email_address || null;

        if (!phone || !email) {
          const liveContact = extractContactInfoFromConversation(conversationHistory, userMessage);
          if (!phone && liveContact.phone) {
            const cleaned = liveContact.phone.replace(/[^\d]/g, '');
            if (cleaned.length >= 8 && cleaned.length <= 12) {
              phone = liveContact.phone;
              console.log(`${this.tag} Phone number found in current message`);
            }
          }
          if (!email && liveContact.email) {
            email = liveContact.email;
            console.log(`${this.tag} Email address found in current message`);
          }
        }

        const profile = await resolveProfile(businessAccountId, {
          phone,
          email,
          name: persistedExtractedData?.customer_name || null,
          platform: this.p.platform,
          platformUserId: senderId,
        });
        if (profile) {
          const isFirstMsg = !conversationHistory.some(m => m.role === 'assistant');
          crossPlatformContext = await composeCrossPlatformContext(businessAccountId, this.p.platform, profile.id, isFirstMsg, senderId);
          if (crossPlatformContext) {
            console.log(`${this.tag} Cross-platform context loaded (${crossPlatformContext.length} chars, firstMsg: ${isFirstMsg})`);
          }
        }
      } catch (err) {
        console.error(`${this.tag} Cross-platform context error (non-fatal):`, err);
      }

      // Smart Lead Training: the whole current conversation (from stored messages, so counts
      // survive restarts) + what the saved lead already has → at most one detail to ask for.
      const leadConversation = leadTrainingConfig || settings.leadCaptureEnabled === "true"
        ? await this.loadLeadConversation(businessAccountId, senderId, userMessage)
        : [];
      let leadCollectionPrompt = '';
      if (leadTrainingConfig) {
        try {
          leadCollectionPrompt = this.buildLeadCollectionPrompt(leadTrainingConfig, leadConversation, await this.savedContact(businessAccountId, senderId));
        } catch (err) {
          console.error(`${this.tag} Lead timing error (non-fatal):`, err instanceof Error ? err.message : err);
        }
      }

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
        detectedLang,
        crossPlatformContext || undefined,
        // Facebook: no businessAccountId → no product tool (and no per-account client tag).
        this.p.richMedia ? businessAccountId : undefined
      );

      if (!aiResult) {
        return { success: false, error: "Failed to generate AI response", aiFailed: true };
      }

      let processedReply = aiResult.text;

      if (this.isDeflectionResponse(processedReply)) {
        console.log(`${this.tag} Deflection detected, stripping [[FALLBACK]] marker`);
      }
      processedReply = this.stripFallbackMarker(processedReply);

      const sendResult = await this.p.sendMessage(
        settings,
        senderId,
        processedReply
      );

      if (!sendResult.success) {
        console.error(`${this.tag} Failed to send message: ${sendResult.error}`);
        return { success: false, error: sendResult.error };
      }
      replySent = true;

      await this.p.storeMessage(
        businessAccountId,
        senderId,
        processedReply,
        "outgoing",
        { platformMessageId: sendResult.messageId || undefined }
      );

      if (this.p.richMedia) {
        await this.sendProductMedia(aiResult, settings, businessAccountId, senderId, apiKey, detectedLang);
      }

      console.log(`${this.tag} Successfully sent reply to ${senderId}`);

      this.tryAutoCaptureLead(businessAccountId, senderId, leadConversation, leadTrainingConfig, settings)
        .catch(err => console.error(`${this.tag} Lead capture error:`, err));

      try {
        let contact: { phone: string | null; email: string | null; name: string | null } | Record<string, never> = {};
        if (this.p.snapshotWithContact) {
          const persistedData = await this.latestLeadData(businessAccountId, senderId);
          const liveContact = extractContactInfoFromConversation(conversationHistory, userMessage);
          contact = {
            phone: persistedData?.phone_number || liveContact.phone || null,
            email: persistedData?.email_address || liveContact.email || null,
            name: persistedData?.customer_name || null,
          };
        }
        const profile = await resolveProfile(businessAccountId, {
          ...contact,
          platform: this.p.platform,
          platformUserId: senderId,
        });
        if (profile) {
          triggerSnapshotUpdate(businessAccountId, profile.id, this.p.platform, senderId);
        }
      } catch (err) {
        console.error(`${this.tag} Snapshot trigger error (non-fatal):`, err);
      }

      return { success: true, reply: processedReply };

    } catch (error) {
      console.error(`${this.tag} Error:`, error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error", aiFailed: !replySent };
    }
  }

  /** Product image cards / images after an AI reply that used the product tool (Instagram). */
  private async sendProductMedia(
    aiResult: { productImages?: string[]; productCards?: { name: string; description?: string; price?: number; imageUrl?: string }[]; isProductSelection?: boolean },
    settings: any,
    businessAccountId: string,
    senderId: string,
    apiKey: string,
    detectedLang: string | undefined,
  ): Promise<void> {
    const sendImage = this.p.sendImageMessage;
    if (!sendImage) return;
    if (aiResult.isProductSelection) {
      console.log(`${this.tag} Product selection response — skipping image cards`);
    } else if (aiResult.productCards && aiResult.productCards.length > 0) {
      const allCards = aiResult.productCards.slice(0, 4);
      const cardsWithImages = allCards
        .map((card, idx) => ({ ...card, originalIndex: idx }))
        .filter(card => card.imageUrl && /^https?:\/\/.+\..+/.test(card.imageUrl) && card.imageUrl.length < 2048);
      console.log(`${this.tag} Sending ${cardsWithImages.length} product card(s) to ${senderId}`);

      let translatedDescriptions: Map<number, string> | null = null;
      if (detectedLang && detectedLang !== 'en') {
        try {
          const descriptionsToTranslate = cardsWithImages
            .filter(c => c.description)
            .map(c => ({ idx: c.originalIndex, desc: c.description! }));
          if (descriptionsToTranslate.length > 0) {
            const openaiClient = createOpenAI({ businessAccountId, apiKey });
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
            console.log(`${this.tag} Translated ${translatedDescriptions.size} product description(s) to ${detectedLang}`);
          }
        } catch (transErr) {
          console.log(`${this.tag} Caption translation failed (non-fatal), using English:`, transErr);
        }
      }

      for (const card of cardsWithImages) {
        try {
          await new Promise(resolve => setTimeout(resolve, 500));
          const imgResult = await sendImage.call(this.p, settings, senderId, card.imageUrl!);
          if (imgResult.success) {
            const captionParts: string[] = [`${card.originalIndex + 1}. ${card.name}`];
            if (card.price && card.price > 0) captionParts.push(`₹${card.price.toLocaleString('en-IN')}`);
            const desc = translatedDescriptions?.get(card.originalIndex) || card.description;
            if (desc) captionParts.push(desc);
            const captionText = captionParts.join('\n');

            await new Promise(resolve => setTimeout(resolve, 300));
            const captionResult = await this.p.sendMessage(settings, senderId, captionText);
            if (!captionResult.success) {
              console.log(`${this.tag} Caption send failed (non-fatal): ${captionResult.error}`);
            }

            await this.p.storeMessage(
              businessAccountId,
              senderId,
              captionText,
              "outgoing",
              {
                platformMessageId: imgResult.messageId || undefined,
                messageType: "image",
                mediaUrl: card.imageUrl,
              }
            );
            console.log(`${this.tag} Product card sent: ${card.name}`);
          } else {
            console.log(`${this.tag} Image send failed (non-fatal): ${imgResult.error}`);
          }
        } catch (imgErr) {
          console.error(`${this.tag} Image send error (non-fatal):`, imgErr);
        }
      }

      const productListSummary = `[Products shown: ${allCards.map((c, i) => `${i + 1}. ${c.name}`).join(', ')}]`;
      await this.p.storeMessage(businessAccountId, senderId, productListSummary, "outgoing").catch(err =>
        console.error(`${this.tag} Failed to store product list summary:`, err)
      );
    } else if (aiResult.productImages && aiResult.productImages.length > 0) {
      const uniqueValidImages = Array.from(new Set(aiResult.productImages))
        .filter(url => /^https?:\/\/.+\..+/.test(url) && url.length < 2048);
      const imagesToSend = uniqueValidImages.slice(0, 4);
      console.log(`${this.tag} Sending ${imagesToSend.length} product image(s) to ${senderId}`);

      for (const imageUrl of imagesToSend) {
        try {
          await new Promise(resolve => setTimeout(resolve, 500));
          const imgResult = await sendImage.call(this.p, settings, senderId, imageUrl);
          if (imgResult.success) {
            await this.p.storeMessage(
              businessAccountId,
              senderId,
              null,
              "outgoing",
              {
                platformMessageId: imgResult.messageId || undefined,
                messageType: "image",
                mediaUrl: imageUrl,
              }
            );
            console.log(`${this.tag} Product image sent: ${imageUrl.substring(0, 60)}...`);
          } else {
            console.log(`${this.tag} Image send failed (non-fatal): ${imgResult.error}`);
          }
        } catch (imgErr) {
          console.error(`${this.tag} Image send error (non-fatal):`, imgErr);
        }
      }
    }
  }

  /**
   * The customer's current conversation rebuilt from stored messages (so message counts and
   * "already asked" survive restarts): the last CONVERSATION_FETCH_LIMIT messages, cut at the
   * last 24 h of silence, with the message being answered included.
   */
  private async loadLeadConversation(businessAccountId: string, senderId: string, userMessage: string): Promise<ChatTurn[]> {
    const messages = this.p.tables.messages;
    try {
      const rows: { messageText: string | null; direction: string; createdAt: Date }[] = await db
        .select({ messageText: messages.messageText, direction: messages.direction, createdAt: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.businessAccountId, businessAccountId), eq(messages.senderId, senderId)))
        .orderBy(desc(messages.createdAt))
        .limit(CONVERSATION_FETCH_LIMIT);
      const turns: ChatTurn[] = rows
        .reverse()
        .filter(r => r.messageText)
        .map(r => ({ role: r.direction === "outgoing" ? "assistant" as const : "user" as const, content: r.messageText || "", at: r.createdAt }));
      return currentConversation(ensureCurrentMessage(turns, userMessage));
    } catch (err) {
      console.error(`${this.tag} Could not load the conversation for lead timing:`, err instanceof Error ? err.message : err);
      return ensureCurrentMessage([], userMessage);
    }
  }

  /** Name / email / phone already saved on this customer's leads (DM capture or a completed flow). */
  private async savedContact(businessAccountId: string, senderId: string): Promise<KnownContact> {
    const leads = this.p.tables.leads;
    const rows: { extractedData: Record<string, any> | null }[] = await db
      .select({ extractedData: leads.extractedData })
      .from(leads)
      .where(and(eq(leads.businessAccountId, businessAccountId), eq(leads.senderId, senderId)))
      .orderBy(desc(leads.createdAt))
      .limit(5);
    const known: KnownContact = {};
    for (const row of rows) {
      const c = socialLeadContact(row.extractedData);
      known.name = known.name || c.name;
      known.email = known.email || c.email;
      known.phone = known.phone || c.phone;
    }
    return known;
  }

  /**
   * Smart Lead Training for this reply: which ONE detail to ask for (all four timings, priority
   * order, required vs optional, asked-before / declined, phone rule) — see leadCapture/channelLeadFields.
   */
  private buildLeadCollectionPrompt(leadTrainingConfig: LeadTrainingConfig, conversation: ChatTurn[], saved: KnownContact): string {
    const fields = normalizeChannelLeadFields(leadTrainingConfig);
    if (fields.length === 0) return '';
    const state = analyzeLeadConversation(fields, conversation, saved);
    const decision = resolveNextLeadAsk(fields, state);
    console.log(`${this.tag} Lead timing: ${describeLeadDecision(decision, state)}`);
    return buildChannelLeadPrompt(decision, state, fields, { channel: this.p.platform });
  }

  private async tryAutoCaptureLead(
    businessAccountId: string,
    senderId: string,
    conversation: ChatTurn[],
    leadTrainingConfig: LeadTrainingConfig | null,
    settings: any
  ): Promise<void> {
    try {
      if (settings.leadCaptureEnabled !== "true") {
        console.log(`${this.leadTag} Lead capture disabled for this business`);
        return;
      }

      // Phone numbers are checked with the configured digit rule (phoneValidation); a number that
      // fails it is left out, but the name / email are still saved.
      const phoneMode = phoneModeOf(normalizeChannelLeadFields(leadTrainingConfig));
      const collected = extractContacts(conversation, phoneMode);
      if (collected.rejectedPhoneReason) {
        console.log(`${this.leadTag} Phone number not saved: it fails the "${phoneMode}" digit rule (${collected.rejectedPhoneReason}); saving the other details`);
      }
      const hasContactData = !!(collected.phone || collected.email || collected.name);

      if (!hasContactData) {
        return;
      }

      console.log(`${this.leadTag} Contact info detected: name=${collected.name ? 'yes' : 'no'}, phone=${collected.phone ? 'yes' : 'no'}, email=${collected.email ? 'yes' : 'no'}`);

      const existingLeads = await db
        .select()
        .from(this.p.tables.leads)
        .where(
          and(
            eq(this.p.tables.leads.businessAccountId, businessAccountId),
            eq(this.p.tables.leads.senderId, senderId)
          )
        )
        .orderBy(desc(this.p.tables.leads.createdAt))
        .limit(1);

      const senderName = await this.getSenderName(businessAccountId, senderId);
      const nameCol = this.p.senderNameColumn;

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
            .update(this.p.tables.leads)
            .set({
              extractedData: mergedData,
              [nameCol]: senderName || existingLead[nameCol],
              updatedAt: new Date(),
            })
            .where(eq(this.p.tables.leads.id, existingLead.id));
          // New contact data (e.g. a phone after the name) may make it pushable to the CRM.
          (await import("../socialLeadCrmSync")).triggerSocialLeadCrmSync(this.p.platform, existingLead.id, "lead_updated");

          console.log(`${this.leadTag} Updated existing lead ${existingLead.id} with new data`);
        } else {
          console.log(`${this.leadTag} No new data to update for existing lead ${existingLead.id}`);
        }
      } else {
        const newLead = await this.p.createLead(businessAccountId, {
          senderId,
          senderName: senderName || undefined,
          extractedData,
          status: "new",
        });

        console.log(`${this.leadTag} Created new lead ${newLead.id} from DM conversation`);
      }
    } catch (error) {
      console.error(`${this.leadTag} Error:`, error);
    }
  }

  /** Customer display name: from stored messages, then leads, then the Graph API. */
  private async getSenderName(businessAccountId: string, senderId: string): Promise<string | null> {
    const messages = this.p.tables.messages;
    const leads = this.p.tables.leads;
    const col = this.p.senderNameColumn;

    const [msg] = await db
      .select({ name: messages[col] })
      .from(messages)
      .where(
        and(
          eq(messages.businessAccountId, businessAccountId),
          eq(messages.senderId, senderId),
          sql`${messages[col]} IS NOT NULL AND ${messages[col]} != ''`
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    if (msg?.name) return msg.name;

    const [existingLead] = await db
      .select({ name: leads[col] })
      .from(leads)
      .where(
        and(
          eq(leads.businessAccountId, businessAccountId),
          eq(leads.senderId, senderId),
          sql`${leads[col]} IS NOT NULL AND ${leads[col]} != ''`
        )
      )
      .limit(1);

    if (existingLead?.name) return existingLead.name;

    return this.p.fetchSenderNameFromApi(businessAccountId, senderId);
  }

  private async getConversationHistory(
    businessAccountId: string,
    senderId: string
  ): Promise<ConversationMessage[]> {
    const recentMessages = await db
      .select({
        messageText: this.p.tables.messages.messageText,
        direction: this.p.tables.messages.direction,
        createdAt: this.p.tables.messages.createdAt
      })
      .from(this.p.tables.messages)
      .where(
        and(
          eq(this.p.tables.messages.businessAccountId, businessAccountId),
          eq(this.p.tables.messages.senderId, senderId)
        )
      )
      .orderBy(desc(this.p.tables.messages.createdAt))
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

    console.log(`${this.tag} Building comprehensive business context for: ${businessAccountId}`);

    try {
      // Per platform: channel-tagged pages / documents / instructions differ between Instagram and Facebook.
      const channel = this.p.platform;
      const cacheKey = `ig_business_context_${businessAccountId}:${channel}`;
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
            const { websiteAnalysisService } = await import("../../websiteAnalysisService");
            return await websiteAnalysisService.getAnalyzedContent(businessAccountId);
          })(),
          storage.getAnalyzedPages(businessAccountId),
          storage.getTrainingDocuments(businessAccountId)
        ]);

        console.log(`${this.tag} [CACHE MISS] Parallel data loading completed in ${Date.now() - parallelLoadStart}ms`);

        const businessAccount = businessAccountResult.status === 'fulfilled' ? businessAccountResult.value : null;
        const widgetSettingArr = widgetSettingResult.status === 'fulfilled' ? widgetSettingResult.value : [];
        const websiteContent = websiteContentResult.status === 'fulfilled' ? websiteContentResult.value : null;
        const analyzedPages = (analyzedPagesResult.status === 'fulfilled' ? analyzedPagesResult.value : []).filter(p => appliesToChannel(p.channels, channel));
        const trainingDocs = (trainingDocsResult.status === 'fulfilled' ? trainingDocsResult.value : []).filter(d => appliesToChannel(d.channels, channel));

        if (businessAccount?.description) {
          staticContext += `BUSINESS OVERVIEW:\n${businessAccount.description}\n\n`;
          console.log(`${this.tag} [CACHE MISS] Added business description (${businessAccount.description.length} chars)`);
        }

        const widgetSetting = widgetSettingArr[0];
        // Unchanged for untagged instructions; instructions tagged for other channels are dropped.
        const channelInstructions = filterCustomInstructionsForChannel(widgetSetting?.customInstructions, channel);
        if (channelInstructions) {
          cachedCustomInstructions = channelInstructions;
          console.log(`${this.tag} [CACHE MISS] Found widget custom instructions (${cachedCustomInstructions.length} chars)`);
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
            console.log(`${this.tag} [CACHE MISS] Added website analysis content`);
          }
        } catch (error) {
          console.error(`${this.tag} Error loading website analysis:`, error);
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
              console.log(`${this.tag} [CACHE MISS] Loaded ${pagesLoaded} analyzed page(s) into context`);
              staticContext += `IMPORTANT: Use all the above website content to answer customer questions accurately.\n\n`;
            }
          }
        } catch (error) {
          console.error(`${this.tag} Error loading analyzed pages:`, error);
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
                    console.error(`${this.tag} Error parsing key points for ${doc.originalFilename}:`, parseError);
                  }
                }
              }
            }
            console.log(`${this.tag} [CACHE MISS] Loaded ${completedDocs.length} training document(s) summaries into context`);
            staticContext += `IMPORTANT: Use this training document knowledge to provide accurate, informed responses.\n\n`;
          }
        } catch (error) {
          console.error(`${this.tag} Error loading training documents:`, error);
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
        console.log(`${this.tag} Loaded lead training config with ${leadTrainingConfig?.fields?.length || 0} fields (fresh, not cached)`);
      }

      const searchResults = await vectorSearchService.search(
        userMessage,
        businessAccountId,
        5,
        0.50,
        this.p.platform
      );

      if (searchResults.length > 0) {
        context += `🔒 CRITICAL DOCUMENT KNOWLEDGE - HIGHEST PRIORITY:\n`;
        context += `The following information was found in your business's training documents.\n`;
        context += `This is BUSINESS-SPECIFIC information that you MUST use to answer questions.\n\n`;

        searchResults.forEach((result, idx) => {
          context += `[Document Excerpt ${idx + 1} from ${result.documentName}]:\n`;
          context += `${result.chunkText}\n\n`;
        });

        console.log(`${this.tag} Added ${searchResults.length} document chunks from vector search`);
      }

      const hasEmbeddedFaqs = await faqEmbeddingService.hasEmbeddedFAQs(businessAccountId);
      console.log(`${this.tag} Business has embedded FAQs: ${hasEmbeddedFaqs}`);

      const relevantFaqs = await faqEmbeddingService.searchFAQs(
        userMessage,
        businessAccountId,
        5,
        0.50,
        this.p.platform
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

        console.log(`${this.tag} Added ${relevantFaqs.length} semantically relevant FAQs`);
      } else if (hasEmbeddedFaqs) {
        console.log(`${this.tag} WARNING: FAQs exist but none matched the query (similarity too low)`);
      } else {
        console.log(`${this.tag} WARNING: No embedded FAQs found for this business`);
      }

    } catch (error) {
      console.error(`${this.tag} Context building error:`, error);
    }

    console.log(`${this.tag} ========== CONTEXT SUMMARY ==========`);
    console.log(`${this.tag} User query: ${userMessage.length} chars`);
    console.log(`${this.tag} Total context length: ${context.length} chars`);
    console.log(`${this.tag} Has custom instructions: ${!!widgetCustomInstructions}`);
    console.log(`${this.tag} Has lead training config: ${!!leadTrainingConfig}`);
    if (context.length > 0) {
      console.log(`${this.tag} Context preview (first 500 chars):`);
      console.log(context.substring(0, 500));
    } else {
      console.log(`${this.tag} WARNING: No context built - AI will have no training data!`);
    }
    console.log(`${this.tag} =====================================`);
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
    detectedLanguage?: string,
    crossPlatformContext?: string,
    businessAccountId?: string
  ): Promise<{ text: string; productImages?: string[]; productCards?: { name: string; description?: string; price?: number; imageUrl?: string }[]; isProductSelection?: boolean } | null> {
    try {
      const openai = createOpenAI({ businessAccountId, timeout: OPENAI_TIMEOUTS.chat, apiKey });

      const now = new Date();
      const istDateFormatter = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const currentDate = istDateFormatter.format(now);

      let systemPrompt = `You are a helpful AI assistant for ${businessName}${businessDescription ? ` - ${businessDescription}` : ''}, responding to customer inquiries via ${this.p.channelPhrase}.

CURRENT DATE: ${currentDate}

CRITICAL RULES - YOU MUST FOLLOW THESE STRICTLY:
1. You must ONLY answer questions using the BUSINESS CONTEXT, FAQs, and DOCUMENT KNOWLEDGE provided below.
2. You must NEVER use your own general knowledge or training data to answer questions. You are NOT a general-purpose AI assistant.
3. If the customer asks something that is NOT covered in the provided business context below, you MUST include the marker [[FALLBACK]] at the START of your response, followed by a positive redirect message. Example: "[[FALLBACK]] Great question! Let me connect you with our team who can give you the right answer."
4. Keep responses concise and conversational (${this.p.formatPhrase} — short and clear, max 1000 characters).
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

${this.p.richMedia ? PRODUCT_SELECTION_PROMPT : ""}🔒 FINAL OVERRIDE — HIGHEST PRIORITY (READ LAST):
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

      // Lead-capture instruction (incl. the "that number isn't valid" correction) after the
      // conversation history: this position gets the most attention from the model.
      if (leadCollectionPrompt) {
        messages.push({ role: "system", content: leadCollectionPrompt });
        console.log(`${this.tag} Injected lead training as FINAL system message (${leadCollectionPrompt.length} chars)`);
      }

      if (crossPlatformContext) {
        messages.push({ role: "system", content: crossPlatformContext });
        console.log(`${this.tag} Cross-platform context injected (${crossPlatformContext.length} chars)`);
      }

      messages.push({ role: "user", content: userMessage });

      if (this.p.richMedia) {
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

        console.log(`${this.tag} Language override injected: ${langName}`);
      }
      console.log(`${this.tag} System prompt length: ${systemPrompt.length} chars`);
      console.log(`${this.tag} Total messages in context: ${messages.length}`);

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
              const channelProductTool = JSON.parse(JSON.stringify(productTool));
              channelProductTool.function.description = 'Search and retrieve products from the catalog when the user asks about products, items, or wants to browse. Returns product details including name, price, and description. Product images will be sent as separate image attachments automatically. Keep to 3-5 products max.';
              tools = [channelProductTool];
              console.log(`${this.tag} Product tool included for this message`);
            }
          }
        } catch (err) {
          console.log(`${this.tag} Tool selection error (non-fatal):`, err);
        }
      }

      const requestParams: any = {
        model: "gpt-4o-mini",
        messages,
        temperature: 0.3,
        max_tokens: this.p.richMedia ? 500 : 400,
      };
      if (tools && tools.length > 0) {
        requestParams.tools = tools;
        requestParams.tool_choice = "auto";
      }

      let response = await openai.chat.completions.create(requestParams);
      let assistantMessage = response.choices[0]?.message;

      if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0 && businessAccountId) {
        console.log(`${this.tag} AI requested ${assistantMessage.tool_calls.length} tool call(s)`);

        const toolMessages: any[] = [
          ...messages,
          assistantMessage,
        ];

        const collectedProductImages: string[] = [];
        const collectedProductCards: { name: string; description?: string; price?: number; imageUrl?: string }[] = [];

        for (const toolCall of assistantMessage.tool_calls) {
          try {
            const fnName = (toolCall as any).function.name;
            const fnArgs = JSON.parse((toolCall as any).function.arguments || '{}');
            console.log(`${this.tag} Executing tool: ${fnName}`);

            if (fnName === 'get_products') {
              try {
                const result = await ToolExecutionService.executeTool(
                  'get_products',
                  fnArgs,
                  {
                    businessAccountId,
                    userId: `${this.p.platform}-agent`,
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
                console.log(`${this.tag} Tool result: ${toolResultStr.length} chars`);
              } catch (err) {
                console.error(`${this.tag} Tool execution error:`, err);
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
                content: `Tool ${fnName} is not available on ${this.p.label}.`,
              });
            }
          } catch (parseErr) {
            console.error(`${this.tag} Tool call parse error:`, parseErr);
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
          console.error(`${this.tag} Follow-up completion after tool call failed:`, followUpErr);
          return { text: "I'm having trouble fetching product details right now. Please try again in a moment!" };
        }
      }

      const text = assistantMessage?.content;
      if (!text) return null;
      return { text };

    } catch (error) {
      console.error(`${this.tag} OpenAI error:`, error);
      return null;
    }
  }

  private isDeflectionResponse(response: string): boolean {
    if (response.includes('[[FALLBACK]]')) {
      console.log(`${this.deflectionTag} Detected via [[FALLBACK]] marker`);
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
      console.log(`${this.deflectionTag} Detected via backup pattern matching`);
    }
    return isPatternMatch;
  }

  private stripFallbackMarker(response: string): string {
    return response.replace(/\[\[FALLBACK\]\]\s*/g, '');
  }
}

