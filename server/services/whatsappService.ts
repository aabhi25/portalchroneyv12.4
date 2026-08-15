import OpenAI from "openai";
import { db } from "../db";
import { 
  whatsappSettings, 
  whatsappLeads, 
  whatsappLeadAttachments, 
  whatsappLeadFields,
  whatsappFlowSessions,
  whatsappFlows,
  businessAccounts,
  type InsertWhatsappLead,
  type InsertWhatsappLeadAttachment,
  type InsertWhatsappLeadField,
  type WhatsappSettings,
  type WhatsappLead,
  type WhatsappLeadField
} from "@shared/schema";
import { eq, ne, sql, and, or, asc, desc, gte, lte, isNull } from "drizzle-orm";
import { r2Storage } from "./r2StorageService";

function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-\(\)]/g, '');
  p = p.replace(/^\+91/, '').replace(/^91(?=\d{10}$)/, '').replace(/^0/, '');
  return p;
}

interface ExtractedLeadInfo {
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  notes: string | null;
  [key: string]: string | number | null | undefined;
}

interface MSG91TextMessage {
  type: "text";
  payload: {
    id: string;
    source: string;
    type: "text";
    text: {
      body: string;
    };
    timestamp: string;
  };
}

interface MSG91MediaMessage {
  type: "message";
  payload: {
    id: string;
    source: string;
    type: "image" | "document";
    image?: {
      id: string;
      mime_type: string;
      caption?: string;
    };
    document?: {
      id: string;
      mime_type: string;
      filename?: string;
      caption?: string;
    };
    timestamp: string;
  };
}

type MSG91Message = MSG91TextMessage | MSG91MediaMessage;

export class WhatsappService {
  private openai: OpenAI | null = null;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  async getSettings(businessAccountId: string): Promise<WhatsappSettings | null> {
    const [settings] = await db
      .select()
      .from(whatsappSettings)
      .where(eq(whatsappSettings.businessAccountId, businessAccountId))
      .limit(1);
    return settings || null;
  }

  async saveSettings(businessAccountId: string, data: Partial<WhatsappSettings>): Promise<WhatsappSettings> {
    const existing = await this.getSettings(businessAccountId);
    
    if (existing) {
      const [updated] = await db
        .update(whatsappSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(whatsappSettings.businessAccountId, businessAccountId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(whatsappSettings)
        .values({ businessAccountId, ...data })
        .returning();
      return created;
    }
  }

  async extractLeadInfo(messageText: string, businessAccountId: string, customPrompt?: string): Promise<ExtractedLeadInfo> {
    // Fetch OpenAI API key from business account
    const [account] = await db
      .select({ openaiApiKey: businessAccounts.openaiApiKey })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId))
      .limit(1);

    const apiKey = account?.openaiApiKey;
    
    if (!apiKey) {
      console.warn(`[WhatsApp] OpenAI API key not configured for business account ${businessAccountId}`);
      return {
        customer_name: null,
        customer_phone: null,
        customer_email: null,
        notes: null,
      };
    }

    const openaiClient = new OpenAI({ apiKey });

    // Get configured lead fields for this business
    const enabledFields = await this.getEnabledLeadFields(businessAccountId);
    
    // Build dynamic field descriptions for the prompt
    const fieldDescriptions = enabledFields.map(field => {
      let description = `- ${field.fieldKey}: `;
      switch (field.fieldType) {
        case 'phone':
          description += `Phone number (10 digits, remove +91 or 0 prefix)`;
          break;
        case 'email':
          description += `Email address`;
          break;
        case 'currency':
          description += `Numeric amount in INR (convert L=Lakhs, e.g., 5L = 500000; Cr=Crores, e.g., 1Cr = 10000000)`;
          break;
        case 'number':
          description += `Numeric value`;
          break;
        default:
          description += field.fieldLabel;
      }
      if (field.allowedValues && field.allowedValues.length > 0) {
        description += ` — must be exactly one of: ${field.allowedValues.map(v => `"${v}"`).join(', ')}`;
      }
      return description;
    }).join('\n');

    const defaultPrompt = `You are a lead extraction assistant. Extract customer details from the following WhatsApp message.

Return a JSON object with these fields (use null if not found):
${fieldDescriptions}
- notes: Any additional relevant info not captured above

Be smart about extracting information even if it's not perfectly formatted.
For example:
- "Customer name Ravi, ph 9876543210" should extract name and phone
- Names like "Mr. Sharma" or "Priya ji" should be cleaned to just the name`;

    const prompt = customPrompt || defaultPrompt;

    try {
      const response = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Message: "${messageText}"` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No content in OpenAI response");
      }

      const extracted = JSON.parse(content) as ExtractedLeadInfo;
      return extracted;
    } catch (error) {
      console.error("Error extracting lead info:", error);
      return {
        customer_name: null,
        customer_phone: null,
        customer_email: null,
        notes: null,
      };
    }
  }

  async storeFlowMessage(
    businessAccountId: string,
    messageId: string,
    senderPhone: string,
    messageText: string,
    senderName?: string,
    flowSessionId?: string
  ): Promise<WhatsappLead | null> {
    const settings = await this.getSettings(businessAccountId);
    const isFlowOnlyMode = settings?.leadGenerationMode === 'flow_only';

    if (flowSessionId) {
      const existingLeads = await db
        .select()
        .from(whatsappLeads)
        .where(and(
          eq(whatsappLeads.businessAccountId, businessAccountId),
          eq(whatsappLeads.flowSessionId, flowSessionId),
          eq(whatsappLeads.direction, 'incoming')
        ))
        .orderBy(asc(whatsappLeads.receivedAt));

      if (existingLeads.length > 0) {
        const isDuplicate = existingLeads.some(l => l.whatsappMessageId === messageId);
        if (isDuplicate) {
          console.log(`[WhatsApp] Duplicate message ${messageId} for session ${flowSessionId}, skipping`);
          const qualifiedLead = existingLeads.find(l => l.status !== 'message_only') || existingLeads[0];
          return qualifiedLead;
        }

        const originalLead = existingLeads.find(l => l.status !== 'message_only') || existingLeads[0];

        const messageRow: InsertWhatsappLead = {
          businessAccountId,
          whatsappMessageId: messageId,
          senderPhone,
          senderName: senderName || null,
          rawMessage: messageText,
          status: "message_only",
          direction: "incoming",
          receivedAt: new Date(),
          flowSessionId,
        };
        await db.insert(whatsappLeads).values(messageRow);
        await db
          .update(whatsappLeads)
          .set({
            lastMessageAt: new Date(),
            lastMessage: messageText,
            conversationCount: sql`COALESCE(${whatsappLeads.conversationCount}, 1) + 1`,
          })
          .where(eq(whatsappLeads.id, originalLead.id));
        console.log(`[WhatsApp] Flow message stored for session ${flowSessionId}, activity updated`);
        return originalLead;
      }
    }

    if (!isFlowOnlyMode) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [existingBlankLead] = await db
        .select()
        .from(whatsappLeads)
        .where(and(
          eq(whatsappLeads.businessAccountId, businessAccountId),
          eq(whatsappLeads.senderPhone, senderPhone),
          eq(whatsappLeads.status, "new"),
          isNull(whatsappLeads.customerName),
          sql`(${whatsappLeads.extractedData} IS NULL OR ${whatsappLeads.extractedData} = '{}'::jsonb)`,
          gte(whatsappLeads.receivedAt, twentyFourHoursAgo),
        ))
        .limit(1);

      if (existingBlankLead) {
        const [attachmentCheck] = await db
          .select({ count: sql<number>`count(*)` })
          .from(whatsappLeadAttachments)
          .where(eq(whatsappLeadAttachments.leadId, existingBlankLead.id));

        if (Number(attachmentCheck?.count || 0) === 0) {
          await db
            .update(whatsappLeads)
            .set({
              flowSessionId: flowSessionId || null,
              lastMessageAt: new Date(),
              lastMessage: messageText,
              conversationCount: sql`COALESCE(${whatsappLeads.conversationCount}, 1) + 1`,
              updatedAt: new Date(),
            })
            .where(eq(whatsappLeads.id, existingBlankLead.id));

          if (messageText && messageText !== existingBlankLead.rawMessage) {
            const messageRow: InsertWhatsappLead = {
              businessAccountId,
              whatsappMessageId: messageId || undefined,
              senderPhone,
              senderName: senderName || null,
              rawMessage: messageText,
              status: "message_only",
              direction: "incoming",
              receivedAt: new Date(),
              flowSessionId: flowSessionId || null,
            };
            await db.insert(whatsappLeads).values(messageRow).onConflictDoNothing();
            console.log(`[WhatsApp] Stored message_only for phone entry "${messageText}" (reusing blank lead ${existingBlankLead.id})`);
          }

          console.log(`[WhatsApp] Reusing blank lead ${existingBlankLead.id} for ${senderPhone} (within 24h)`);
          return { ...existingBlankLead, flowSessionId: flowSessionId || null };
        }
      }
    }

    const leadData: InsertWhatsappLead = {
      businessAccountId,
      whatsappMessageId: messageId,
      senderPhone,
      senderName: senderName || null,
      rawMessage: messageText,
      customerName: null,
      status: "new",
      direction: "incoming",
      receivedAt: new Date(),
      flowSessionId: flowSessionId || null,
    };

    try {
      const [lead] = await db.insert(whatsappLeads).values(leadData).returning();
      console.log(`[WhatsApp] Lead created from flow message: ${lead.id} (sender: ${senderPhone}, mode: ${isFlowOnlyMode ? 'flow_only' : 'first_message'})`);
      return lead;
    } catch (err: any) {
      if (err.code === '23505' && err.constraint === 'whatsapp_leads_blank_placeholder_unique_idx') {
        if (isFlowOnlyMode) {
          leadData.customerName = `__flow_pending__${flowSessionId || Date.now()}`;
          const [lead] = await db.insert(whatsappLeads).values(leadData).returning();
          console.log(`[WhatsApp] Lead created (flow_only mode, bypassed blank constraint): ${lead.id}`);
          return lead;
        }
        const [existingLead] = await db
          .select()
          .from(whatsappLeads)
          .where(and(
            eq(whatsappLeads.businessAccountId, businessAccountId),
            eq(whatsappLeads.senderPhone, senderPhone),
            eq(whatsappLeads.status, "new"),
            isNull(whatsappLeads.customerName),
          ))
          .orderBy(desc(whatsappLeads.receivedAt))
          .limit(1);

        if (existingLead) {
          await db
            .update(whatsappLeads)
            .set({
              flowSessionId: flowSessionId || null,
              rawMessage: messageText,
              lastMessageAt: new Date(),
              lastMessage: messageText,
              conversationCount: sql`COALESCE(${whatsappLeads.conversationCount}, 1) + 1`,
              updatedAt: new Date(),
            })
            .where(eq(whatsappLeads.id, existingLead.id));
          console.log(`[WhatsApp] Reused existing blank lead ${existingLead.id} for ${senderPhone} (conflict resolved)`);
          return { ...existingLead, flowSessionId: flowSessionId || null, rawMessage: messageText };
        }
        throw err;
      }
      throw err;
    }
  }

  async processTextMessage(
    businessAccountId: string,
    messageId: string,
    senderPhone: string,
    messageText: string,
    senderName?: string,
    flowSessionId?: string
  ): Promise<WhatsappLead | null> {
    const settings = await this.getSettings(businessAccountId);
    const customPrompt = settings?.customPrompt || undefined;
    const isFlowOnlyMode = settings?.leadGenerationMode === 'flow_only';

    // Check if lead capture is enabled
    const leadCaptureEnabled = settings?.leadCaptureEnabled !== "false";

    if (isFlowOnlyMode && !flowSessionId) {
      console.log(`[WhatsApp] Flow-only mode: non-flow message from ${senderPhone}, storing as message_only`);
      const allPhoneLeads = await db
        .select()
        .from(whatsappLeads)
        .where(and(
          eq(whatsappLeads.businessAccountId, businessAccountId),
          eq(whatsappLeads.senderPhone, senderPhone),
          eq(whatsappLeads.direction, 'incoming')
        ))
        .orderBy(asc(whatsappLeads.receivedAt));

      const messageRow: InsertWhatsappLead = {
        businessAccountId,
        whatsappMessageId: messageId,
        senderPhone,
        senderName: senderName || null,
        rawMessage: messageText,
        status: "message_only",
        direction: "incoming",
        receivedAt: new Date(),
      };

      if (allPhoneLeads.length > 0) {
        const isDuplicate = allPhoneLeads.some(l => l.whatsappMessageId === messageId);
        if (isDuplicate) {
          console.log(`[WhatsApp] Duplicate message ${messageId} for phone ${senderPhone}, skipping`);
          return null;
        }
        await db.insert(whatsappLeads).values(messageRow);
        console.log(`[WhatsApp] Flow-only mode: message stored for conversation history (no lead created)`);
        return null;
      }

      await db.insert(whatsappLeads).values(messageRow);
      console.log(`[WhatsApp] Flow-only mode: first message stored for conversation history (no lead created)`);
      return null;
    }

    // For flow-managed sessions, skip OpenAI lead extraction — the flow service handles
    // data extraction separately. Extracting from button labels like "Update Documents"
    // or individual flow step answers here is redundant and adds 1-4 seconds of latency.
    const emptyExtracted: ExtractedLeadInfo = {
      customer_name: null, customer_phone: null, customer_email: null, notes: null,
    };
    const extracted = flowSessionId
      ? emptyExtracted
      : await this.extractLeadInfo(messageText, businessAccountId, customPrompt);

    // Determine if this message qualifies as a lead
    // Flow messages always qualify (the flow session itself tracks the lead)
    let isQualifiedLead = leadCaptureEnabled;
    let skipReason = "";

    if (!flowSessionId && leadCaptureEnabled) {
      // Get configured lead fields and count how many were extracted
      const enabledFields = await this.getEnabledLeadFields(businessAccountId);
      
      let extractedFieldCount = 0;
      for (const field of enabledFields) {
        if (field.fieldKey === 'customer_name' && extracted.customer_name) extractedFieldCount++;
        else if (field.fieldKey === 'customer_phone' && extracted.customer_phone) extractedFieldCount++;
        else if (field.fieldKey === 'customer_email' && extracted.customer_email) extractedFieldCount++;
        else if (field.fieldKey === 'loan_amount' && extracted.loan_amount) extractedFieldCount++;
        else if ((extracted as any)[field.fieldKey]) extractedFieldCount++;
      }

      // At least 1 enabled field must be extracted for it to qualify as a lead
      if (extractedFieldCount < 1) {
        isQualifiedLead = false;
        skipReason = `no enabled fields extracted from message`;
      }
    } else if (!flowSessionId) {
      skipReason = "lead capture disabled";
    }

    // Check if a lead already exists for this flow session
    if (flowSessionId) {
      const existingLeads = await db
        .select()
        .from(whatsappLeads)
        .where(and(
          eq(whatsappLeads.businessAccountId, businessAccountId),
          eq(whatsappLeads.flowSessionId, flowSessionId),
          eq(whatsappLeads.direction, 'incoming')
        ))
        .orderBy(asc(whatsappLeads.receivedAt));
      
      if (existingLeads.length > 0) {
        // Guard against duplicate webhook deliveries
        const isDuplicate = existingLeads.some(l => l.whatsappMessageId === messageId);
        if (isDuplicate) {
          console.log(`[WhatsApp] Duplicate message ${messageId} for session ${flowSessionId}, skipping`);
          const qualifiedLead = existingLeads.find(l => l.status !== 'message_only') || existingLeads[0];
          return qualifiedLead;
        }

        // Find the original qualified lead (non-message_only), or fall back to earliest
        const originalLead = existingLeads.find(l => l.status !== 'message_only') || existingLeads[0];
        
        // Store this message as a separate row for conversation history
        const messageRow: InsertWhatsappLead = {
          businessAccountId,
          whatsappMessageId: messageId,
          senderPhone,
          senderName: senderName || null,
          rawMessage: messageText,
          extractedData: extracted as any,
          status: "message_only",
          direction: "incoming",
          receivedAt: new Date(),
          flowSessionId,
        };
        await db.insert(whatsappLeads).values(messageRow);

        // Merge extracted lead fields into the original lead record (without touching rawMessage)
        // Overwrite with newer data when available (follow-up messages often have better info)
        const updateData: Partial<InsertWhatsappLead> = {};
        
        if (extracted.customer_name) {
          updateData.customerName = extracted.customer_name;
        }
        if (extracted.customer_phone) {
          updateData.customerPhone = extracted.customer_phone;
        }
        if (extracted.customer_email) {
          updateData.customerEmail = extracted.customer_email;
        }
        
        // Merge extractedData: keep existing values, overwrite with new non-null values
        const previousData = (originalLead.extractedData as Record<string, any>) || {};
        const mergedExtractedData: Record<string, any> = { ...previousData };
        for (const [key, value] of Object.entries(extracted)) {
          if (value !== null && value !== undefined) {
            mergedExtractedData[key] = value;
          }
        }
        // Only write extractedData when there is actual data — writing {} would change
        // NULL to an empty object and break the blank-lead dedup condition (IS NULL).
        if (Object.keys(mergedExtractedData).length > 0) {
          updateData.extractedData = mergedExtractedData as any;
        }
        
        if (leadCaptureEnabled && originalLead.status === 'message_only') {
          updateData.status = 'new';
        }
        
        updateData.lastMessageAt = new Date();
        updateData.lastMessage = messageText;
        updateData.conversationCount = sql`COALESCE(${whatsappLeads.conversationCount}, 1) + 1`;
        
        const [updatedLead] = await db
          .update(whatsappLeads)
          .set(updateData)
          .where(eq(whatsappLeads.id, originalLead.id))
          .returning();
        
        console.log(`[WhatsApp] Lead fields merged into original lead ${updatedLead.id} for session ${flowSessionId}`);
        return updatedLead;
      }
    }

    // For non-flow messages, check if a lead from this phone already exists (dedup by phone)
    // For flow messages, each new flow session creates its own lead (salesman use case)
    if (!flowSessionId) {
      const duplicateCheck = await db
        .select({ id: whatsappLeads.id })
        .from(whatsappLeads)
        .where(and(
          eq(whatsappLeads.businessAccountId, businessAccountId),
          eq(whatsappLeads.whatsappMessageId, messageId)
        ))
        .limit(1);

      if (duplicateCheck.length > 0) {
        console.log(`[WhatsApp] Duplicate message ${messageId} for phone ${senderPhone}, skipping`);
        const qualifiedLead = await db
          .select()
          .from(whatsappLeads)
          .where(and(
            eq(whatsappLeads.businessAccountId, businessAccountId),
            eq(whatsappLeads.senderPhone, senderPhone),
            eq(whatsappLeads.direction, 'incoming'),
            ne(whatsappLeads.status, 'message_only')
          ))
          .orderBy(asc(whatsappLeads.receivedAt))
          .limit(1);
        return qualifiedLead[0] || null;
      }

      const allPhoneLeads = await db
        .select()
        .from(whatsappLeads)
        .where(and(
          eq(whatsappLeads.businessAccountId, businessAccountId),
          eq(whatsappLeads.senderPhone, senderPhone),
          eq(whatsappLeads.direction, 'incoming')
        ))
        .orderBy(asc(whatsappLeads.receivedAt));

      if (allPhoneLeads.length > 0) {
        const originalLead = allPhoneLeads.find(l => l.status !== 'message_only') || allPhoneLeads[0];

        const messageRow: InsertWhatsappLead = {
          businessAccountId,
          whatsappMessageId: messageId,
          senderPhone,
          senderName: senderName || null,
          rawMessage: messageText,
          extractedData: extracted as any,
          status: "message_only",
          direction: "incoming",
          receivedAt: new Date(),
        };
        await db.insert(whatsappLeads).values(messageRow);

        if (leadCaptureEnabled) {
          const updateData: Partial<InsertWhatsappLead> = {};

          if (extracted.customer_name) {
            updateData.customerName = extracted.customer_name;
          }
          if (extracted.customer_phone) {
            updateData.customerPhone = extracted.customer_phone;
          }
          if (extracted.customer_email) {
            updateData.customerEmail = extracted.customer_email;
          }

          const previousData = (originalLead.extractedData as Record<string, any>) || {};
          const mergedExtractedData: Record<string, any> = { ...previousData };
          for (const [key, value] of Object.entries(extracted)) {
            if (value !== null && value !== undefined) {
              mergedExtractedData[key] = value;
            }
          }
          if (Object.keys(mergedExtractedData).length > 0) {
            updateData.extractedData = mergedExtractedData as any;
          }

          if (originalLead.status === 'message_only') {
            updateData.status = 'new';
          }

          updateData.lastMessageAt = new Date();
          updateData.lastMessage = messageText;
          updateData.conversationCount = sql`COALESCE(${whatsappLeads.conversationCount}, 1) + 1`;

          const [updatedLead] = await db
            .update(whatsappLeads)
            .set(updateData)
            .where(eq(whatsappLeads.id, originalLead.id))
            .returning();

          console.log(`[WhatsApp] Lead fields merged into existing lead ${updatedLead.id} for phone ${senderPhone}`);
          return updatedLead;
        } else {
          await db
            .update(whatsappLeads)
            .set({
              lastMessageAt: new Date(),
              lastMessage: messageText,
              conversationCount: sql`COALESCE(${whatsappLeads.conversationCount}, 1) + 1`,
            })
            .where(eq(whatsappLeads.id, originalLead.id));
          console.log(`[WhatsApp] Message stored for phone ${senderPhone} (lead capture disabled), activity updated on lead ${originalLead.id}`);
        }

        return originalLead;
      }
    }

    // No existing lead found - create new one
    const leadData: InsertWhatsappLead = {
      businessAccountId,
      whatsappMessageId: messageId,
      senderPhone,
      senderName: senderName || null,
      rawMessage: messageText,
      customerName: extracted.customer_name || null,
      customerPhone: extracted.customer_phone,
      customerEmail: extracted.customer_email,
      notes: extracted.notes,
      extractedData: extracted as any,
      status: leadCaptureEnabled ? "new" : "message_only",
      receivedAt: new Date(),
      flowSessionId: flowSessionId || null,
    };

    const [lead] = await db.insert(whatsappLeads).values(leadData).returning();
    
    if (leadCaptureEnabled) {
      console.log(`[WhatsApp] Lead created: ${lead.id} (sender: ${senderPhone})`);
      return lead;
    } else {
      console.log(`[WhatsApp] Message stored (lead capture disabled): ${lead.id}`);
      return null;
    }
  }

  async storeMessageOnly(
    businessAccountId: string,
    messageId: string,
    senderPhone: string,
    messageText: string,
    senderName?: string
  ): Promise<void> {
    const messageRow: InsertWhatsappLead = {
      businessAccountId,
      whatsappMessageId: messageId,
      senderPhone,
      senderName: senderName || null,
      rawMessage: messageText,
      extractedData: {} as any,
      status: "message_only",
      direction: "incoming",
      receivedAt: new Date(),
    };
    await db.insert(whatsappLeads).values(messageRow);
  }

  async downloadAndSaveMedia(
    leadId: string,
    businessAccountId: string,
    mediaId: string,
    mediaType: "image" | "document",
    mimeType: string,
    caption?: string,
    filename?: string,
    msg91AuthKey?: string
  ): Promise<void> {
    if (!msg91AuthKey) {
      console.warn("MSG91 auth key not provided, skipping media download");
      return;
    }

    try {
      const mediaUrlController = new AbortController();
      const mediaUrlTimeout = setTimeout(() => mediaUrlController.abort(), 15000);
      let mediaUrlResponse: Response;
      try {
        mediaUrlResponse = await fetch(
          `https://api.msg91.com/api/v5/whatsapp/getMediaByID?media_id=${mediaId}`,
          {
            headers: {
              authkey: msg91AuthKey,
            },
            signal: mediaUrlController.signal,
          }
        );
      } catch (fetchErr: any) {
        clearTimeout(mediaUrlTimeout);
        console.error("MSG91 media URL request failed:", fetchErr.name === "AbortError" ? "timed out after 15s" : fetchErr.message);
        return;
      }
      clearTimeout(mediaUrlTimeout);

      if (!mediaUrlResponse.ok) {
        console.error("Failed to get media URL from MSG91:", await mediaUrlResponse.text());
        return;
      }

      const mediaData = await mediaUrlResponse.json() as { url?: string };
      const mediaUrl = mediaData.url;

      if (!mediaUrl) {
        console.error("No media URL in MSG91 response");
        return;
      }

      const extension = mimeType.split("/")[1] || "bin";
      const savedFilename = filename || `${mediaId}.${extension}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      let fileResponse: Response;
      try {
        fileResponse = await fetch(mediaUrl, { signal: controller.signal });
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr.name === "AbortError") {
          console.error("Media download timed out after 30s:", mediaUrl);
        } else {
          console.error("Media download failed:", fetchErr.message);
        }
        return;
      }
      clearTimeout(timeoutId);

      if (!fileResponse.ok) {
        console.error("Failed to download media file:", fileResponse.status, await fileResponse.text());
        return;
      }

      const arrayBuffer = await fileResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Upload to R2 storage
      const r2Folder = `whatsapp/${leadId}`;
      const r2Result = await r2Storage.uploadFile(
        buffer,
        savedFilename,
        r2Folder,
        mimeType,
        businessAccountId
      );

      if (!r2Result.success) {
        console.error("Failed to upload media to R2:", r2Result.error);
        return;
      }

      const fileType = mediaType === "image" ? "image" : "pdf";

      const attachmentData: InsertWhatsappLeadAttachment = {
        leadId,
        businessAccountId,
        fileName: savedFilename,
        fileType,
        mimeType,
        fileSize: buffer.length,
        filePath: r2Result.url || '', // Store R2 URL instead of local path
        mediaId,
        mediaUrl,
        caption,
      };

      await db.insert(whatsappLeadAttachments).values(attachmentData);
      console.log(`Saved attachment to R2: ${savedFilename} for lead ${leadId}, URL: ${r2Result.url}`);
    } catch (error) {
      console.error("Error downloading media:", error);
    }
  }

  async downloadAndSaveMediaFromUrl(
    leadId: string,
    businessAccountId: string,
    mediaUrl: string,
    mediaType: "image" | "document",
    filename?: string,
    caption?: string
  ): Promise<string | undefined> {
    try {
      const urlParts = new URL(mediaUrl);
      const pathParts = urlParts.pathname.split('/');
      const urlFilename = pathParts[pathParts.length - 1] || `media_${Date.now()}`;
      
      const extension = urlFilename.includes('.') 
        ? urlFilename.split('.').pop() 
        : (mediaType === "image" ? "jpg" : "pdf");
      
      const savedFilename = filename || urlFilename || `${mediaType}_${Date.now()}.${extension}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      let fileResponse: Response;
      try {
        fileResponse = await fetch(mediaUrl, { signal: controller.signal });
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr.name === "AbortError") {
          console.error("Media download from URL timed out after 30s:", mediaUrl);
        } else {
          console.error("Media download from URL failed:", fetchErr.message);
        }
        return;
      }
      clearTimeout(timeoutId);

      if (!fileResponse.ok) {
        console.error("Failed to download media file from URL:", fileResponse.status, await fileResponse.text());
        return;
      }

      const arrayBuffer = await fileResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const mimeType = fileResponse.headers.get('content-type') || 
        (mediaType === "image" ? "image/jpeg" : "application/pdf");
      const fileType = mediaType === "image" ? "image" : "pdf";

      // Upload to R2 storage (uploadFile adds businessAccountId to key when provided)
      const r2Folder = `whatsapp/${leadId}`;
      const r2Result = await r2Storage.uploadFile(
        buffer,
        savedFilename,
        r2Folder,
        mimeType,
        businessAccountId
      );

      if (!r2Result.success) {
        console.error("Failed to upload media to R2:", r2Result.error);
        return;
      }

      const attachmentData: InsertWhatsappLeadAttachment = {
        leadId,
        businessAccountId,
        fileName: savedFilename,
        fileType,
        mimeType,
        fileSize: buffer.length,
        filePath: r2Result.url || '', // Store R2 URL instead of local path
        mediaUrl,
        caption,
      };

      await db.insert(whatsappLeadAttachments).values(attachmentData);
      console.log(`Saved attachment to R2: ${savedFilename} for lead ${leadId}, URL: ${r2Result.url}`);
      return r2Result.url;
    } catch (error) {
      console.error("Error downloading media from URL:", error);
      return undefined;
    }
  }

  async getLeads(
    businessAccountId: string,
    options: {
      limit?: number;
      offset?: number;
      status?: string;
      search?: string;
      includeMessageOnly?: boolean; // If true, include 'message_only' status entries
      dateFrom?: Date;
      dateTo?: Date;
    } = {}
  ): Promise<{ leads: WhatsappLead[]; total: number }> {
    const { limit = 20, offset = 0, status, search, includeMessageOnly = false, dateFrom, dateTo } = options;

    // Build where conditions - filter out 'message_only' entries unless explicitly requested
    const whereConditions = [eq(whatsappLeads.businessAccountId, businessAccountId)];
    
    if (!includeMessageOnly && !status) {
      // Exclude 'message_only' status entries from leads list by default
      whereConditions.push(ne(whatsappLeads.status, "message_only"));
    }
    
    if (status) {
      whereConditions.push(eq(whatsappLeads.status, status));
    }

    if (search?.trim()) {
      const searchPattern = `%${search.trim()}%`;
      whereConditions.push(
        or(
          sql`${whatsappLeads.senderPhone} ILIKE ${searchPattern}`,
          sql`${whatsappLeads.senderName} ILIKE ${searchPattern}`,
          sql`${whatsappLeads.customerName} ILIKE ${searchPattern}`,
          sql`${whatsappLeads.customerPhone} ILIKE ${searchPattern}`,
          sql`${whatsappLeads.customerEmail} ILIKE ${searchPattern}`,
          sql`${whatsappLeads.rawMessage} ILIKE ${searchPattern}`,
        )!
      );
    }

    if (dateFrom) {
      whereConditions.push(gte(whatsappLeads.receivedAt, dateFrom));
    }
    if (dateTo) {
      whereConditions.push(lte(whatsappLeads.receivedAt, dateTo));
    }

    const leads = await db
      .select()
      .from(whatsappLeads)
      .where(and(...whereConditions))
      .orderBy(sql`COALESCE(${whatsappLeads.lastMessageAt}, ${whatsappLeads.receivedAt}) DESC`)
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(whatsappLeads)
      .where(and(...whereConditions));

    const leadIds = leads.map(l => l.id);
    let attachmentCounts: Record<string, number> = {};
    if (leadIds.length > 0) {
      const counts = await db
        .select({
          leadId: whatsappLeadAttachments.leadId,
          count: sql<number>`count(*)`,
        })
        .from(whatsappLeadAttachments)
        .where(sql`${whatsappLeadAttachments.leadId} IN (${sql.join(leadIds.map(id => sql`${id}`), sql`, `)})`)
        .groupBy(whatsappLeadAttachments.leadId);
      for (const row of counts) {
        attachmentCounts[row.leadId] = Number(row.count);
      }
    }

    const leadsWithAttachmentCount = leads.map(l => ({
      ...l,
      attachmentCount: attachmentCounts[l.id] || 0,
    }));

    return {
      leads: leadsWithAttachmentCount,
      total: Number(countResult?.count ?? 0),
    };
  }

  async getLeadById(leadId: string, businessAccountId: string): Promise<WhatsappLead | null> {
    const [lead] = await db
      .select()
      .from(whatsappLeads)
      .where(eq(whatsappLeads.id, leadId))
      .limit(1);

    if (lead && lead.businessAccountId !== businessAccountId) {
      return null;
    }

    return lead || null;
  }

  async deleteLead(leadId: string): Promise<void> {
    await db.delete(whatsappLeads).where(eq(whatsappLeads.id, leadId));
  }

  async updateLeadDocuments(leadId: string, documents: Record<string, any>): Promise<void> {
    const [lead] = await db
      .select({ extractedData: whatsappLeads.extractedData })
      .from(whatsappLeads)
      .where(eq(whatsappLeads.id, leadId))
      .limit(1);
    
    const currentData = (lead?.extractedData as Record<string, any>) || {};
    const updatedData = {
      ...currentData,
      _documents: {
        ...((currentData._documents as Record<string, any>) || {}),
        ...documents
      }
    };
    
    await db
      .update(whatsappLeads)
      .set({ extractedData: updatedData })
      .where(eq(whatsappLeads.id, leadId));
    
    console.log(`[WhatsApp] Updated lead ${leadId} with ${Object.keys(documents).length} documents`);
  }

  async syncLeadDocuments(leadId: string, collectedDocs: Record<string, any>): Promise<void> {
    const [lead] = await db
      .select({ extractedData: whatsappLeads.extractedData })
      .from(whatsappLeads)
      .where(eq(whatsappLeads.id, leadId))
      .limit(1);

    const currentData = (lead?.extractedData as Record<string, any>) || {};
    const currentDocs = (currentData._documents as Record<string, any>) || {};
    const currentRejected = (currentData._rejectedDocuments as Record<string, any>) || {};

    const nextDocs = { ...currentDocs };
    const nextRejected = { ...currentRejected };

    for (const [docType, docEntry] of Object.entries(collectedDocs)) {
      if ((docEntry as any)?.isValid === false) {
        delete nextDocs[docType];
        nextRejected[docType] = {
          documentType: (docEntry as any).documentType,
          reason: 'number_mismatch',
          rejectedAt: new Date().toISOString(),
          sourceMediaUrl: (docEntry as any).sourceMediaUrl,
        };
        console.log(`[WhatsApp] Removed invalid ${docType} from lead ${leadId} — stored in _rejectedDocuments for audit`);
      } else {
        nextDocs[docType] = docEntry;
        delete nextRejected[docType];
      }
    }

    const updatedData: Record<string, any> = {
      ...currentData,
      _documents: nextDocs,
    };
    if (Object.keys(nextRejected).length > 0) {
      updatedData._rejectedDocuments = nextRejected;
    } else {
      delete updatedData._rejectedDocuments;
    }

    await db
      .update(whatsappLeads)
      .set({ extractedData: updatedData })
      .where(eq(whatsappLeads.id, leadId));

    const validCount = Object.keys(nextDocs).length;
    const invalidCount = Object.values(collectedDocs).filter((d: any) => d?.isValid === false).length;
    console.log(`[WhatsApp] Synced documents for lead ${leadId}: ${validCount} valid, ${invalidCount} invalid (moved to _rejectedDocuments)`);
  }

  async findLeadByFlowSession(businessAccountId: string, flowSessionId: string): Promise<WhatsappLead | null> {
    const leads = await db
      .select()
      .from(whatsappLeads)
      .where(and(
        eq(whatsappLeads.businessAccountId, businessAccountId),
        eq(whatsappLeads.flowSessionId, flowSessionId)
      ))
      .orderBy(asc(whatsappLeads.receivedAt));
    
    if (leads.length === 0) return null;
    return leads.find(l => l.status !== 'message_only') || leads[0];
  }

  async findLeadByCustomerPhone(businessAccountId: string, customerPhone: string): Promise<WhatsappLead | null> {
    // Normalize phone number (remove spaces, dashes, etc.)
    const normalizedPhone = customerPhone.replace(/[\s\-\(\)]/g, '');
    
    // Try to find a lead where customerPhone matches (could be with or without country code)
    // Search all leads regardless of status, most recent first
    const leads = await db
      .select()
      .from(whatsappLeads)
      .where(eq(whatsappLeads.businessAccountId, businessAccountId))
      .orderBy(desc(whatsappLeads.createdAt))
      .limit(200);
    
    // Find a lead where customerPhone ends with the normalized phone (to handle country code variations)
    for (const lead of leads) {
      if (lead.customerPhone) {
        const leadPhone = lead.customerPhone.replace(/[\s\-\(\)]/g, '');
        // Match if the phone ends with the search phone or vice versa
        if (leadPhone.endsWith(normalizedPhone) || normalizedPhone.endsWith(leadPhone)) {
          return lead;
        }
      }
    }
    
    return null;
  }

  async findMostRecentLeadBySender(businessAccountId: string, senderPhone: string): Promise<WhatsappLead | null> {
    // Find the most recent lead from this sender phone
    const [lead] = await db
      .select()
      .from(whatsappLeads)
      .where(
        and(
          eq(whatsappLeads.businessAccountId, businessAccountId),
          eq(whatsappLeads.senderPhone, senderPhone)
        )
      )
      .orderBy(desc(whatsappLeads.createdAt))
      .limit(1);
    
    return lead || null;
  }

  async createMinimalLead(businessAccountId: string, senderPhone: string, message: string, flowSessionId?: string, direction?: 'incoming' | 'outgoing'): Promise<WhatsappLead> {
    const [lead] = await db
      .insert(whatsappLeads)
      .values({
        businessAccountId,
        senderPhone,
        rawMessage: message,
        status: 'message_only',
        flowSessionId: flowSessionId || null,
        direction: direction || 'incoming',
      })
      .returning();
    
    return lead;
  }

  async getLeadAttachments(leadId: string) {
    return await db
      .select()
      .from(whatsappLeadAttachments)
      .where(eq(whatsappLeadAttachments.leadId, leadId));
  }

  async updateLeadStatus(leadId: string, status: string): Promise<WhatsappLead | null> {
    const [updated] = await db
      .update(whatsappLeads)
      .set({ status, updatedAt: new Date() })
      .where(eq(whatsappLeads.id, leadId))
      .returning();
    return updated || null;
  }

  async updateLeadWithFlowData(
    businessAccountId: string,
    senderPhone: string,
    collectedData: Record<string, any>,
    flowSessionId?: string,
    flowCompleted?: boolean
  ): Promise<WhatsappLead | null> {
    if (collectedData._bankStatementPassword) {
      collectedData.bank_statement_password = collectedData._bankStatementPassword;
    }

    let existingLead;

    if (flowSessionId) {
      const sessionLeads = await db
        .select()
        .from(whatsappLeads)
        .where(
          and(
            eq(whatsappLeads.businessAccountId, businessAccountId),
            eq(whatsappLeads.senderPhone, senderPhone),
            eq(whatsappLeads.flowSessionId, flowSessionId)
          )
        )
        .orderBy(desc(whatsappLeads.createdAt));
      
      existingLead = sessionLeads.find(l => l.status !== 'message_only') || sessionLeads[0];
    }

    if (!existingLead) {
      const fallbackLeads = await db
        .select()
        .from(whatsappLeads)
        .where(
          and(
            eq(whatsappLeads.businessAccountId, businessAccountId),
            eq(whatsappLeads.senderPhone, senderPhone)
          )
        )
        .orderBy(desc(whatsappLeads.createdAt))
        .limit(10);
      existingLead = fallbackLeads.find(l => l.status !== 'message_only') || fallbackLeads[0];
    }

    if (!existingLead) {
      console.log(`[WhatsApp] No existing lead found for ${senderPhone} to update with flow data`);
      return null;
    }

    if (collectedData._blockedDuplicate) {
      console.log(`[WhatsApp] Blocked duplicate — keeping lead ${existingLead.id} as message_only, no merge`);
      await db
        .update(whatsappLeads)
        .set({ status: 'message_only' as any, updatedAt: new Date() })
        .where(eq(whatsappLeads.id, existingLead.id));
      return existingLead;
    }

    if (collectedData._updateExistingLeadId) {
      const targetLeadId = collectedData._updateExistingLeadId;
      console.log(`[WhatsApp] Updating existing lead ${targetLeadId} (>24h duplicate, overwriting data)`);
      const [targetLead] = await db
        .select()
        .from(whatsappLeads)
        .where(eq(whatsappLeads.id, targetLeadId))
        .limit(1);

      if (targetLead) {
        const currentData = (targetLead.extractedData as Record<string, any>) || {};
        const mergedData = { ...currentData };
        for (const [key, value] of Object.entries(collectedData)) {
          if (key.startsWith('_')) continue;
          if (value !== null && value !== undefined && value !== '') {
            mergedData[key] = value;
          }
        }
        const updateSet: any = {
          extractedData: mergedData as any,
          updatedAt: new Date()
        };
        if (flowCompleted) {
          updateSet.status = 'qualified';
        }
        if (mergedData.customer_phone) {
          updateSet.customerPhone = mergedData.customer_phone;
        }
        if (mergedData.customer_name) {
          updateSet.customerName = mergedData.customer_name;
        }
        if (mergedData.customer_email) {
          updateSet.customerEmail = mergedData.customer_email;
        }
        const [updated] = await db
          .update(whatsappLeads)
          .set(updateSet)
          .where(eq(whatsappLeads.id, targetLeadId))
          .returning();

        if (existingLead.id !== targetLeadId) {
          await db
            .update(whatsappLeads)
            .set({ status: 'message_only' as any, updatedAt: new Date() })
            .where(eq(whatsappLeads.id, existingLead.id));

          const collectedDocs = collectedData._collectedDocuments || {};
          const newDocCategories = Object.keys(collectedDocs).filter(k => collectedDocs[k]);

          // In the update flow, documents are saved directly to targetLeadId during upload.
          // Deleting "old" attachments at session completion would destroy the freshly-uploaded ones.
          // Guard 1 (explicit): skip if this session was an update flow (_updateExistingLeadId set).
          // Guard 2 (safety net): skip if the session lead has no attachments to move in, which
          // means there is nothing to replace the deleted docs with.
          const isUpdateFlow = Boolean(collectedData._updateExistingLeadId);
          const incomingAttachments = await db
            .select({ id: whatsappLeadAttachments.id })
            .from(whatsappLeadAttachments)
            .where(eq(whatsappLeadAttachments.leadId, existingLead.id));

          if (!isUpdateFlow && incomingAttachments.length > 0) {
            if (newDocCategories.length > 0) {
              const oldToDelete = await db
                .select({ id: whatsappLeadAttachments.id })
                .from(whatsappLeadAttachments)
                .where(and(
                  eq(whatsappLeadAttachments.leadId, targetLeadId),
                  sql`${whatsappLeadAttachments.documentCategory} IN (${sql.join(newDocCategories.map(c => sql`${c}`), sql`, `)})`
                ));
              if (oldToDelete.length > 0) {
                await db
                  .delete(whatsappLeadAttachments)
                  .where(sql`${whatsappLeadAttachments.id} IN (${sql.join(oldToDelete.map(a => sql`${a.id}`), sql`, `)})`);
                console.log(`[WhatsApp] Deleted ${oldToDelete.length} old attachment(s) from lead ${targetLeadId} (replaced by new uploads: ${newDocCategories.join(', ')})`);
              }
            }
            await db
              .update(whatsappLeadAttachments)
              .set({ leadId: targetLeadId })
              .where(eq(whatsappLeadAttachments.leadId, existingLead.id));
          } else {
            console.log(`[WhatsApp] Skipping attachment delete+move for lead ${targetLeadId} (isUpdateFlow=${isUpdateFlow}, incomingCount=${incomingAttachments.length}) — docs already saved to target during upload`);
          }
          console.log(`[WhatsApp] Demoted session lead ${existingLead.id} to message_only, data merged into ${targetLeadId}`);
        }

        return updated || null;
      }
    }

    const customerPhone = collectedData.customer_phone;
    if (customerPhone) {
      const normalizedPhone = normalizePhone(customerPhone);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const recentLeads = await db
        .select()
        .from(whatsappLeads)
        .where(
          and(
            eq(whatsappLeads.businessAccountId, businessAccountId),
            ne(whatsappLeads.status, 'message_only'),
            gte(whatsappLeads.createdAt, twentyFourHoursAgo)
          )
        )
        .orderBy(desc(whatsappLeads.createdAt));

      const duplicateLead = recentLeads.find(lead => {
        if (lead.id === existingLead.id) return false;
        const ed = (lead.extractedData as Record<string, any>) || {};
        const existingPhone = ed.customer_phone;
        if (!existingPhone) return false;
        return normalizePhone(existingPhone) === normalizedPhone;
      });

      if (duplicateLead) {
        console.log(`[WhatsApp] Duplicate phone detected: ${normalizedPhone}. Merging session lead ${existingLead.id} into existing lead ${duplicateLead.id}`);

        const dupExtracted = (duplicateLead.extractedData as Record<string, any>) || {};
        const currentExtracted = (existingLead.extractedData as Record<string, any>) || {};
        const allSources = { ...currentExtracted, ...collectedData };
        const mergedData = { ...dupExtracted };
        for (const [key, value] of Object.entries(allSources)) {
          if (value !== null && value !== undefined && value !== '') {
            if (key.startsWith('_')) {
              const existing = mergedData[key];
              if (existing && typeof existing === 'object' && typeof value === 'object') {
                mergedData[key] = { ...existing, ...value };
              } else {
                mergedData[key] = value;
              }
            } else {
              mergedData[key] = value;
            }
          }
        }

        const updateSet: any = {
            extractedData: mergedData as any,
            updatedAt: new Date()
          };
        if (flowCompleted) {
          updateSet.status = 'qualified';
        }
        if (mergedData.customer_phone) {
          updateSet.customerPhone = mergedData.customer_phone;
        }
        if (mergedData.customer_name) {
          updateSet.customerName = mergedData.customer_name;
        }
        if (mergedData.customer_email) {
          updateSet.customerEmail = mergedData.customer_email;
        }
        const [updated] = await db
          .update(whatsappLeads)
          .set(updateSet)
          .where(eq(whatsappLeads.id, duplicateLead.id))
          .returning();

        if (existingLead.id !== duplicateLead.id) {
          await db
            .update(whatsappLeads)
            .set({ status: 'message_only' as any, updatedAt: new Date() })
            .where(eq(whatsappLeads.id, existingLead.id));

          await db
            .update(whatsappLeadAttachments)
            .set({ leadId: duplicateLead.id })
            .where(eq(whatsappLeadAttachments.leadId, existingLead.id));
          console.log(`[WhatsApp] Demoted session lead ${existingLead.id} to message_only and moved attachments to ${duplicateLead.id}`);
        }

        return updated || null;
      }
    }

    const currentExtractedData = (existingLead.extractedData as Record<string, any>) || {};
    const mergedData = { ...currentExtractedData, ...collectedData };

    let newStatus = existingLead.status === "message_only" ? "new" : existingLead.status;
    if (flowCompleted) {
      newStatus = 'qualified';
    }

    const updateSet: any = { 
      extractedData: mergedData as any,
      status: newStatus,
      updatedAt: new Date() 
    };
    
    const isPlaceholder = (v: string | null | undefined) => !v || v.startsWith('__flow_pending__');
    if (collectedData.customer_phone && isPlaceholder(existingLead.customerPhone)) {
      updateSet.customerPhone = collectedData.customer_phone;
    }
    if (collectedData.customer_name && isPlaceholder(existingLead.customerName)) {
      updateSet.customerName = collectedData.customer_name;
    }
    if (collectedData.customer_email && isPlaceholder(existingLead.customerEmail)) {
      updateSet.customerEmail = collectedData.customer_email;
    }

    const [updated] = await db
      .update(whatsappLeads)
      .set(updateSet)
      .where(eq(whatsappLeads.id, existingLead.id))
      .returning();

    console.log(`[WhatsApp] Updated lead ${existingLead.id} with flow collected data:`, collectedData);
    return updated || null;
  }

  async findBusinessByWebhookSecret(webhookSecret: string): Promise<string | null> {
    const [settings] = await db
      .select()
      .from(whatsappSettings)
      .where(eq(whatsappSettings.webhookSecret, webhookSecret))
      .limit(1);

    return settings?.businessAccountId || null;
  }

  async findBusinessByWhatsappNumber(whatsappNumber: string): Promise<string | null> {
    const [settings] = await db
      .select()
      .from(whatsappSettings)
      .where(eq(whatsappSettings.whatsappNumber, whatsappNumber))
      .limit(1);

    return settings?.businessAccountId || null;
  }

  generateWebhookSecret(): string {
    return `whsec_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
  }

  async testConnection(msg91AuthKey: string): Promise<{ success: boolean; message: string }> {
    if (!msg91AuthKey) {
      return { success: false, message: "MSG91 Auth Key is required" };
    }

    try {
      const response = await fetch(
        `https://control.msg91.com/api/balance.php?authkey=${encodeURIComponent(msg91AuthKey)}&type=4`,
        {
          method: "GET",
        }
      );

      const responseText = await response.text();
      console.log("MSG91 balance check response:", responseText);

      if (response.status === 401 || response.status === 403) {
        return { success: false, message: "Invalid MSG91 Auth Key - authentication failed" };
      }

      if (responseText.toLowerCase().includes("invalid") || responseText.toLowerCase().includes("error")) {
        return { success: false, message: "Invalid MSG91 Auth Key" };
      }

      if (!response.ok) {
        console.error("MSG91 API error status:", response.status);
        return { 
          success: false, 
          message: `MSG91 API error: ${response.status}`
        };
      }

      return { 
        success: true, 
        message: "Successfully connected to MSG91" 
      };
    } catch (error: any) {
      console.error("MSG91 connection test error:", error);
      return { 
        success: false, 
        message: `Connection failed: ${error.message || "Unknown error"}` 
      };
    }
  }

  async getConversations(
    businessAccountId: string,
    options: {
      limit?: number;
      offset?: number;
      search?: string;
    } = {}
  ): Promise<{ conversations: ConversationSummary[]; total: number }> {
    const { limit = 20, offset = 0, search } = options;
    const searchPattern = search ? `%${search}%` : null;

    const conversationsResult = await db.execute(sql`
      WITH message_sessions AS (
        SELECT 
          id,
          sender_phone,
          sender_name,
          received_at,
          LAG(received_at) OVER (PARTITION BY sender_phone ORDER BY received_at) as prev_received_at,
          CASE 
            WHEN LAG(received_at) OVER (PARTITION BY sender_phone ORDER BY received_at) IS NULL 
              OR received_at - LAG(received_at) OVER (PARTITION BY sender_phone ORDER BY received_at) >= INTERVAL '24 hours'
            THEN 1 
            ELSE 0 
          END as is_new_session
        FROM whatsapp_leads
        WHERE business_account_id = ${businessAccountId}
        AND sender_phone IS NOT NULL
        AND sender_phone IN (
          SELECT sender_phone FROM whatsapp_leads
          WHERE business_account_id = ${businessAccountId}
          AND direction = 'incoming'
        )
      ),
      session_groups AS (
        SELECT 
          *,
          SUM(is_new_session) OVER (PARTITION BY sender_phone ORDER BY received_at) as session_id
        FROM message_sessions
      ),
      conversation_agg AS (
        SELECT 
          sender_phone,
          session_id,
          MAX(NULLIF(sender_name, '')) as sender_name,
          COUNT(*) as message_count,
          MAX(received_at) as last_message_at,
          MIN(received_at) as first_message_at
        FROM session_groups
        GROUP BY sender_phone, session_id
      )
      SELECT * FROM conversation_agg
      WHERE (${searchPattern}::text IS NULL OR sender_phone ILIKE ${searchPattern} OR sender_name ILIKE ${searchPattern})
      ORDER BY last_message_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    const countResult = await db.execute(sql`
      WITH message_sessions AS (
        SELECT 
          sender_phone,
          sender_name,
          received_at,
          CASE 
            WHEN LAG(received_at) OVER (PARTITION BY sender_phone ORDER BY received_at) IS NULL 
              OR received_at - LAG(received_at) OVER (PARTITION BY sender_phone ORDER BY received_at) >= INTERVAL '24 hours'
            THEN 1 
            ELSE 0 
          END as is_new_session
        FROM whatsapp_leads
        WHERE business_account_id = ${businessAccountId}
        AND sender_phone IS NOT NULL
        AND sender_phone IN (
          SELECT sender_phone FROM whatsapp_leads
          WHERE business_account_id = ${businessAccountId}
          AND direction = 'incoming'
        )
      ),
      session_groups AS (
        SELECT 
          sender_phone,
          sender_name,
          SUM(is_new_session) OVER (PARTITION BY sender_phone ORDER BY received_at) as session_id
        FROM message_sessions
      ),
      conversation_agg AS (
        SELECT 
          sender_phone,
          session_id,
          MAX(NULLIF(sender_name, '')) as sender_name
        FROM session_groups
        GROUP BY sender_phone, session_id
      )
      SELECT COUNT(*) as total FROM conversation_agg
      WHERE (${searchPattern}::text IS NULL OR sender_phone ILIKE ${searchPattern} OR sender_name ILIKE ${searchPattern})
    `);

    const conversations = conversationsResult.rows as unknown as Omit<ConversationSummary, 'journeys'>[];
    
    // Fetch journey sessions for each conversation
    const conversationsWithJourneys: ConversationSummary[] = await Promise.all(
      conversations.map(async (conv) => {
        // Query for flow sessions within this conversation's time window
        const journeysResult = await db.execute(sql`
          SELECT 
            wfs.id as flow_session_id,
            wf.name as flow_name,
            COUNT(wl.id) as message_count,
            MIN(wl.received_at) as first_message_at,
            MAX(wl.received_at) as last_message_at
          FROM whatsapp_flow_sessions wfs
          LEFT JOIN whatsapp_flows wf ON wfs.flow_id = wf.id
          LEFT JOIN whatsapp_leads wl ON wl.flow_session_id = wfs.id
          WHERE wfs.business_account_id = ${businessAccountId}
          AND wfs.sender_phone = ${conv.sender_phone}
          AND wl.received_at >= ${conv.first_message_at}::timestamp
          AND wl.received_at <= ${conv.last_message_at}::timestamp
          GROUP BY wfs.id, wf.name
          ORDER BY MIN(wl.received_at) DESC
        `);
        
        return {
          ...conv,
          journeys: journeysResult.rows as unknown as JourneySummary[],
        };
      })
    );

    return {
      conversations: conversationsWithJourneys,
      total: Number((countResult.rows[0] as any)?.total || 0),
    };
  }

  async deleteConversation(
    businessAccountId: string,
    senderPhone: string,
    sessionStart?: string,
    sessionEnd?: string
  ): Promise<number> {
    return await db.transaction(async (tx) => {
      const whereConditions = [
        eq(whatsappLeads.businessAccountId, businessAccountId),
        eq(whatsappLeads.senderPhone, senderPhone),
      ];

      if (sessionStart && sessionEnd) {
        whereConditions.push(sql`${whatsappLeads.receivedAt} >= ${sessionStart}::timestamp`);
        whereConditions.push(sql`${whatsappLeads.receivedAt} <= ${sessionEnd}::timestamp`);
      }

      const leadsToDelete = await tx
        .select({ id: whatsappLeads.id, flowSessionId: whatsappLeads.flowSessionId })
        .from(whatsappLeads)
        .where(and(...whereConditions));

      if (leadsToDelete.length === 0) return 0;

      const leadIds = leadsToDelete.map(l => l.id);

      await tx
        .delete(whatsappLeadAttachments)
        .where(sql`${whatsappLeadAttachments.leadId} IN (${sql.join(leadIds.map(id => sql`${id}`), sql`, `)})`);

      const flowSessionIds = Array.from(new Set(leadsToDelete.map(l => l.flowSessionId).filter(Boolean))) as string[];
      if (flowSessionIds.length > 0) {
        await tx
          .delete(whatsappFlowSessions)
          .where(sql`${whatsappFlowSessions.id} IN (${sql.join(flowSessionIds.map(id => sql`${id}`), sql`, `)})`);
      }

      const result = await tx
        .delete(whatsappLeads)
        .where(sql`${whatsappLeads.id} IN (${sql.join(leadIds.map(id => sql`${id}`), sql`, `)})`)
        .returning();

      console.log(`[WhatsApp] Deleted ${result.length} messages for session with ${senderPhone}`);
      return result.length;
    });
  }

  async getConversationMessages(
    businessAccountId: string,
    senderPhone: string,
    sessionStart?: string,
    sessionEnd?: string,
    flowSessionId?: string,
    limit: number = 20,
    before?: string
  ): Promise<{ 
    messages: (WhatsappLead & { attachments?: any[] })[]; 
    senderName: string | null;
    flowSessions: { id: string; flowName: string; createdAt: Date | null }[];
    hasMore: boolean;
    oldestTimestamp: string | null;
  }> {
    let messages;
    const beforeCondition = before ? sql`${whatsappLeads.receivedAt} < ${before}::timestamp` : undefined;
    
    if (flowSessionId) {
      const conditions = [
        eq(whatsappLeads.businessAccountId, businessAccountId),
        eq(whatsappLeads.senderPhone, senderPhone),
        eq(whatsappLeads.flowSessionId, flowSessionId),
      ];
      if (beforeCondition) conditions.push(beforeCondition);
      
      const sessionMessages = await db
        .select()
        .from(whatsappLeads)
        .where(and(...conditions))
        .orderBy(desc(whatsappLeads.receivedAt))
        .limit(limit + 1);

      // On initial load (no pagination), prepend up to 5 outgoing context messages
      // from within 5 minutes before this session started. This surfaces the preceding
      // session's bot prompts (e.g. "Please enter phone number") so the update-lead
      // journey view shows full conversation context.
      if (!beforeCondition && sessionMessages.length > 0) {
        const earliest = sessionMessages[sessionMessages.length - 1];
        const earliestTs = earliest.receivedAt instanceof Date
          ? earliest.receivedAt
          : new Date(String(earliest.receivedAt));
        const windowStart = new Date(earliestTs.getTime() - 5 * 60 * 1000);

        const contextMessages = await db
          .select()
          .from(whatsappLeads)
          .where(and(
            eq(whatsappLeads.businessAccountId, businessAccountId),
            eq(whatsappLeads.senderPhone, senderPhone),
            ne(whatsappLeads.flowSessionId, flowSessionId),
            sql`${whatsappLeads.receivedAt} < ${earliestTs.toISOString()}::timestamp`,
            sql`${whatsappLeads.receivedAt} >= ${windowStart.toISOString()}::timestamp`,
          ))
          .orderBy(desc(whatsappLeads.receivedAt))
          .limit(5);

        messages = [...contextMessages, ...sessionMessages];
      } else {
        messages = sessionMessages;
      }
    } else if (sessionStart && sessionEnd) {
      const conditions = [
        eq(whatsappLeads.businessAccountId, businessAccountId),
        eq(whatsappLeads.senderPhone, senderPhone),
        sql`${whatsappLeads.receivedAt} >= ${sessionStart}::timestamp`,
        sql`${whatsappLeads.receivedAt} <= ${sessionEnd}::timestamp`,
      ];
      if (beforeCondition) conditions.push(beforeCondition);
      
      messages = await db
        .select()
        .from(whatsappLeads)
        .where(and(...conditions))
        .orderBy(desc(whatsappLeads.receivedAt))
        .limit(limit + 1);
    } else {
      const conditions = [
        eq(whatsappLeads.businessAccountId, businessAccountId),
        eq(whatsappLeads.senderPhone, senderPhone),
      ];
      if (beforeCondition) conditions.push(beforeCondition);
      
      messages = await db
        .select()
        .from(whatsappLeads)
        .where(and(...conditions))
        .orderBy(desc(whatsappLeads.receivedAt))
        .limit(limit + 1);
    }

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages = messages.slice(0, limit);
    }
    messages.reverse();

    const oldestTimestamp = messages.length > 0 
      ? (messages[0].receivedAt instanceof Date ? messages[0].receivedAt.toISOString() : String(messages[0].receivedAt))
      : null;

    const senderName = messages[0]?.senderName || null;

    const leadIds = messages.map(m => m.id);
    
    let attachmentsByLeadId: Record<string, any[]> = {};
    if (leadIds.length > 0) {
      const attachments = await db
        .select()
        .from(whatsappLeadAttachments)
        .where(sql`${whatsappLeadAttachments.leadId} IN (${sql.join(leadIds.map(id => sql`${id}`), sql`, `)})`);
      
      for (const att of attachments) {
        if (!attachmentsByLeadId[att.leadId]) {
          attachmentsByLeadId[att.leadId] = [];
        }
        attachmentsByLeadId[att.leadId].push(att);
      }
    }

    const messagesWithAttachments = messages.map(msg => ({
      ...msg,
      attachments: attachmentsByLeadId[msg.id] || []
    }));

    const sessionIdSet = new Set<string>();
    messages.forEach(m => { if (m.flowSessionId) sessionIdSet.add(m.flowSessionId); });
    const uniqueSessionIds = Array.from(sessionIdSet);
    
    let flowSessions: { id: string; flowName: string; createdAt: Date | null }[] = [];
    if (uniqueSessionIds.length > 0) {
      const sessionDetails = await db
        .select({
          id: whatsappFlowSessions.id,
          flowId: whatsappFlowSessions.flowId,
          createdAt: whatsappFlowSessions.createdAt,
          flowName: whatsappFlows.name,
        })
        .from(whatsappFlowSessions)
        .leftJoin(whatsappFlows, eq(whatsappFlowSessions.flowId, whatsappFlows.id))
        .where(sql`${whatsappFlowSessions.id} IN (${sql.join(uniqueSessionIds.map(id => sql`${id}`), sql`, `)})`);
      
      flowSessions = sessionDetails.map(s => ({
        id: s.id,
        flowName: s.flowName || "Journey",
        createdAt: s.createdAt,
      }));
    }

    return {
      messages: messagesWithAttachments,
      senderName,
      flowSessions,
      hasMore,
      oldestTimestamp,
    };
  }

  // Lead Fields Management
  async getLeadFields(businessAccountId: string): Promise<WhatsappLeadField[]> {
    let fields = await db
      .select()
      .from(whatsappLeadFields)
      .where(eq(whatsappLeadFields.businessAccountId, businessAccountId))
      .orderBy(asc(whatsappLeadFields.displayOrder));

    // If no fields exist, create default fields
    if (fields.length === 0) {
      await this.createDefaultLeadFields(businessAccountId);
      fields = await db
        .select()
        .from(whatsappLeadFields)
        .where(eq(whatsappLeadFields.businessAccountId, businessAccountId))
        .orderBy(asc(whatsappLeadFields.displayOrder));
    }

    return fields;
  }

  async createDefaultLeadFields(businessAccountId: string): Promise<void> {
    const defaultFields = [
      { fieldKey: "customer_name", fieldLabel: "Customer Name", fieldType: "text", isDefault: true, isEnabled: true, displayOrder: 0, defaultCrmFieldKey: "Name" },
      { fieldKey: "customer_phone", fieldLabel: "Phone Number", fieldType: "phone", isDefault: true, isEnabled: true, displayOrder: 1, defaultCrmFieldKey: "Mobile" },
      { fieldKey: "customer_email", fieldLabel: "Email Address", fieldType: "email", isDefault: true, isEnabled: true, displayOrder: 2, defaultCrmFieldKey: "Email" },
    ];

    for (const field of defaultFields) {
      await db.insert(whatsappLeadFields).values({
        businessAccountId,
        ...field,
      });
    }
  }

  async createLeadField(
    businessAccountId: string,
    data: { fieldKey: string; fieldLabel: string; fieldType: string; isRequired: boolean; isEnabled: boolean; defaultCrmFieldKey?: string; allowedValues?: string[] }
  ): Promise<WhatsappLeadField> {
    // Get the max display order
    const maxOrder = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(display_order), 0)` })
      .from(whatsappLeadFields)
      .where(eq(whatsappLeadFields.businessAccountId, businessAccountId));

    const [field] = await db
      .insert(whatsappLeadFields)
      .values({
        businessAccountId,
        fieldKey: data.fieldKey.toLowerCase().replace(/\s+/g, "_"),
        fieldLabel: data.fieldLabel,
        fieldType: data.fieldType,
        isRequired: data.isRequired,
        isEnabled: data.isEnabled,
        isDefault: false,
        displayOrder: (maxOrder[0]?.maxOrder || 0) + 1,
        defaultCrmFieldKey: data.defaultCrmFieldKey || null,
        allowedValues: data.allowedValues && data.allowedValues.length > 0 ? data.allowedValues : null,
      })
      .returning();

    return field;
  }

  async updateLeadField(
    businessAccountId: string,
    fieldId: string,
    data: { fieldLabel?: string; fieldType?: string; isRequired?: boolean; isEnabled?: boolean; defaultCrmFieldKey?: string | null; allowedValues?: string[] | null }
  ): Promise<WhatsappLeadField | null> {
    const updateData: Partial<WhatsappLeadField> = {};
    if (data.fieldLabel !== undefined) updateData.fieldLabel = data.fieldLabel;
    if (data.fieldType !== undefined) updateData.fieldType = data.fieldType;
    if (data.isRequired !== undefined) updateData.isRequired = data.isRequired;
    if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
    if (data.defaultCrmFieldKey !== undefined) updateData.defaultCrmFieldKey = data.defaultCrmFieldKey;
    if (data.allowedValues !== undefined) updateData.allowedValues = data.allowedValues && data.allowedValues.length > 0 ? data.allowedValues : null;

    const [field] = await db
      .update(whatsappLeadFields)
      .set(updateData)
      .where(
        and(
          eq(whatsappLeadFields.id, fieldId),
          eq(whatsappLeadFields.businessAccountId, businessAccountId)
        )
      )
      .returning();

    return field || null;
  }

  async deleteLeadField(businessAccountId: string, fieldId: string): Promise<void> {
    // Only allow deleting non-default fields
    await db
      .delete(whatsappLeadFields)
      .where(
        and(
          eq(whatsappLeadFields.id, fieldId),
          eq(whatsappLeadFields.businessAccountId, businessAccountId),
          eq(whatsappLeadFields.isDefault, false)
        )
      );
  }

  async getEnabledLeadFields(businessAccountId: string): Promise<WhatsappLeadField[]> {
    const fields = await this.getLeadFields(businessAccountId);
    return fields.filter(f => f.isEnabled);
  }
}

interface JourneySummary {
  flow_session_id: string;
  flow_name: string;
  message_count: number;
  first_message_at: Date;
  last_message_at: Date;
}

interface ConversationSummary {
  sender_phone: string;
  session_id: number;
  sender_name: string | null;
  message_count: number;
  last_message_at: Date;
  first_message_at: Date;
  journeys: JourneySummary[];
}

export const whatsappService = new WhatsappService();
