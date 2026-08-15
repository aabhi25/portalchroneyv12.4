import { db } from "../db";
import { facebookSettings, facebookMessages, facebookComments, businessAccounts, facebookLeads, facebookLeadFields } from "@shared/schema";
import { eq, and, desc, sql, asc, count } from "drizzle-orm";
import type { FacebookSettings, FacebookMessage, InsertFacebookMessage, FacebookLead, FacebookLeadField, FacebookComment, InsertFacebookComment } from "@shared/schema";
import { encrypt, decrypt } from "./encryptionService";

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const FB_TEXT_LIMIT = 2000;

export class FacebookService {

  async getSettings(businessAccountId: string): Promise<FacebookSettings | null> {
    const [settings] = await db
      .select()
      .from(facebookSettings)
      .where(eq(facebookSettings.businessAccountId, businessAccountId))
      .limit(1);
    return settings || null;
  }

  async updateSettings(businessAccountId: string, data: Partial<FacebookSettings>): Promise<FacebookSettings> {
    const updateData: any = { ...data, updatedAt: new Date() };

    if (data.pageAccessToken !== undefined && data.pageAccessToken !== null) {
      updateData.pageAccessToken = encrypt(data.pageAccessToken);
    }
    if (data.appSecret !== undefined && data.appSecret !== null) {
      updateData.appSecret = encrypt(data.appSecret);
    }

    const [updated] = await db
      .update(facebookSettings)
      .set(updateData)
      .where(eq(facebookSettings.businessAccountId, businessAccountId))
      .returning();
    return updated;
  }

  async createSettings(businessAccountId: string, data: Partial<FacebookSettings> = {}): Promise<FacebookSettings> {
    const insertData: any = { businessAccountId, ...data };

    if (data.pageAccessToken) {
      insertData.pageAccessToken = encrypt(data.pageAccessToken);
    }
    if (data.appSecret) {
      insertData.appSecret = encrypt(data.appSecret);
    }

    const [created] = await db
      .insert(facebookSettings)
      .values(insertData)
      .returning();
    return created;
  }

  async saveSettings(businessAccountId: string, data: any): Promise<FacebookSettings> {
    let existing = await this.getSettings(businessAccountId);

    const updateData: any = {};
    if (data.facebookEnabled !== undefined) updateData.facebookEnabled = data.facebookEnabled;
    if (data.pageId !== undefined) updateData.pageId = data.pageId;
    if (data.autoReplyEnabled !== undefined) updateData.autoReplyEnabled = data.autoReplyEnabled;
    if (data.leadCaptureEnabled !== undefined) updateData.leadCaptureEnabled = data.leadCaptureEnabled;
    if (data.webhookVerifyToken !== undefined) updateData.webhookVerifyToken = data.webhookVerifyToken;
    if (data.pageAccessToken && data.pageAccessToken !== "••••••••") updateData.pageAccessToken = data.pageAccessToken;
    if (data.appSecret && data.appSecret !== "••••••••") updateData.appSecret = data.appSecret;
    if (data.commentAutoReplyEnabled !== undefined) updateData.commentAutoReplyEnabled = data.commentAutoReplyEnabled;
    if (data.commentReplyMode !== undefined) updateData.commentReplyMode = data.commentReplyMode;
    if (data.commentTriggerKeywords !== undefined) updateData.commentTriggerKeywords = data.commentTriggerKeywords;
    if (data.commentReplyDelay !== undefined) updateData.commentReplyDelay = data.commentReplyDelay;
    if (data.commentMaxRepliesPerPost !== undefined) updateData.commentMaxRepliesPerPost = data.commentMaxRepliesPerPost;
    if (data.commentIgnoreOwnReplies !== undefined) updateData.commentIgnoreOwnReplies = data.commentIgnoreOwnReplies;
    if (data.commentAutoDmEnabled !== undefined) updateData.commentAutoDmEnabled = data.commentAutoDmEnabled;
    if (data.commentDmMode !== undefined) updateData.commentDmMode = data.commentDmMode;
    if (data.commentDmTriggerKeywords !== undefined) updateData.commentDmTriggerKeywords = data.commentDmTriggerKeywords;
    if (data.commentDmTemplate !== undefined) updateData.commentDmTemplate = data.commentDmTemplate;

    if (existing) {
      return await this.updateSettings(businessAccountId, updateData);
    } else {
      return await this.createSettings(businessAccountId, updateData);
    }
  }

  getDecryptedAccessToken(settings: FacebookSettings): string | null {
    if (!settings.pageAccessToken) return null;
    try {
      return decrypt(settings.pageAccessToken);
    } catch (error) {
      console.error("[Facebook] Failed to decrypt page access token:", error);
      return null;
    }
  }

  getDecryptedAppSecret(settings: FacebookSettings): string | null {
    if (!settings.appSecret) return null;
    try {
      return decrypt(settings.appSecret);
    } catch (error) {
      console.error("[Facebook] Failed to decrypt app secret:", error);
      return null;
    }
  }

  async sendMessage(
    settings: FacebookSettings,
    recipientId: string,
    messageText: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        return { success: false, error: "Facebook page access token not configured" };
      }

      const truncatedText = messageText.length > FB_TEXT_LIMIT
        ? messageText.substring(0, FB_TEXT_LIMIT - 3) + "..."
        : messageText;

      const url = `${FB_API_BASE}/me/messages`;

      const body = {
        recipient: { id: recipientId },
        message: { text: truncatedText },
      };

      console.log(`[Facebook] Sending message to ${recipientId}:`, {
        text: truncatedText.substring(0, 50) + (truncatedText.length > 50 ? "..." : ""),
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const responseData = await response.json();
      console.log(`[Facebook] API response:`, responseData);

      if (!response.ok) {
        const errorMsg = responseData?.error?.message || `Facebook API error: ${response.status}`;
        return { success: false, error: errorMsg };
      }

      return {
        success: true,
        messageId: responseData.message_id,
      };
    } catch (error) {
      console.error(`[Facebook] Send error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send message",
      };
    }
  }

  async sendQuickReply(
    settings: FacebookSettings,
    recipientId: string,
    messageText: string,
    quickReplies: { content_type: string; title: string; payload: string }[]
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        return { success: false, error: "Facebook page access token not configured" };
      }

      const truncatedText = messageText.length > FB_TEXT_LIMIT
        ? messageText.substring(0, FB_TEXT_LIMIT - 3) + "..."
        : messageText;

      const url = `${FB_API_BASE}/me/messages`;

      const body = {
        recipient: { id: recipientId },
        message: {
          text: truncatedText,
          quick_replies: quickReplies.slice(0, 13),
        },
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const responseData = await response.json();
      if (!response.ok) {
        const errorMsg = responseData?.error?.message || `Facebook API error: ${response.status}`;
        return { success: false, error: errorMsg };
      }

      return {
        success: true,
        messageId: responseData.message_id,
      };
    } catch (error) {
      console.error(`[Facebook] Send quick reply error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send quick reply",
      };
    }
  }

  async storeMessage(
    businessAccountId: string,
    senderId: string,
    messageText: string | null,
    direction: "incoming" | "outgoing",
    options: {
      senderName?: string;
      fbMessageId?: string;
      messageType?: string;
      mediaUrl?: string;
    } = {}
  ): Promise<FacebookMessage> {
    const messageData: InsertFacebookMessage = {
      businessAccountId,
      senderId,
      messageText: messageText || null,
      direction,
      senderName: options.senderName || null,
      fbMessageId: options.fbMessageId || null,
      messageType: options.messageType || "text",
      mediaUrl: options.mediaUrl || null,
    };

    const [message] = await db
      .insert(facebookMessages)
      .values(messageData)
      .returning();

    console.log(`[Facebook] Stored ${direction} message for sender ${senderId} (id: ${message.id})`);
    return message;
  }

  async replyToComment(
    settings: FacebookSettings,
    commentId: string,
    message: string
  ): Promise<{ success: boolean; commentId?: string; error?: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        return { success: false, error: "Facebook page access token not configured" };
      }

      const truncatedMessage = message.length > FB_TEXT_LIMIT
        ? message.substring(0, FB_TEXT_LIMIT - 3) + "..."
        : message;

      const url = `${FB_API_BASE}/${commentId}/comments`;

      console.log(`[Facebook] Replying to comment ${commentId}:`, {
        text: truncatedMessage.substring(0, 50) + (truncatedMessage.length > 50 ? "..." : ""),
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: truncatedMessage }),
      });

      const responseData = await response.json();
      console.log(`[Facebook] Comment reply API response:`, responseData);

      if (!response.ok) {
        const errorMsg = responseData?.error?.message || `Facebook API error: ${response.status}`;
        return { success: false, error: errorMsg };
      }

      return {
        success: true,
        commentId: responseData.id,
      };
    } catch (error) {
      console.error(`[Facebook] Reply to comment error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to reply to comment",
      };
    }
  }

  async sendPrivateReply(
    settings: FacebookSettings,
    commentId: string,
    message: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        return { success: false, error: "Facebook page access token not configured" };
      }

      const truncatedMessage = message.length > FB_TEXT_LIMIT
        ? message.substring(0, FB_TEXT_LIMIT - 3) + "..."
        : message;

      const url = `${FB_API_BASE}/${commentId}/private_replies`;

      console.log(`[Facebook] Sending private reply for comment ${commentId}:`, {
        text: truncatedMessage.substring(0, 50) + (truncatedMessage.length > 50 ? "..." : ""),
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: truncatedMessage }),
      });

      const responseData = await response.json();
      console.log(`[Facebook] Private reply API response:`, responseData);

      if (!response.ok) {
        const errorMsg = responseData?.error?.message || `Facebook API error: ${response.status}`;
        return { success: false, error: errorMsg };
      }

      return { success: true };
    } catch (error) {
      console.error(`[Facebook] Private reply error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send private reply",
      };
    }
  }

  async findMessageByFbId(fbMessageId: string): Promise<FacebookMessage | null> {
    const [message] = await db
      .select()
      .from(facebookMessages)
      .where(eq(facebookMessages.fbMessageId, fbMessageId))
      .limit(1);
    return message || null;
  }

  async findCommentByFbId(businessAccountId: string, commentId: string): Promise<FacebookComment | null> {
    const [comment] = await db
      .select()
      .from(facebookComments)
      .where(
        and(
          eq(facebookComments.businessAccountId, businessAccountId),
          eq(facebookComments.commentId, commentId)
        )
      )
      .limit(1);
    return comment || null;
  }

  async storeComment(data: {
    businessAccountId: string;
    postId?: string;
    commentId?: string;
    commentText?: string;
    commenterName?: string;
    commenterId?: string;
    replyText?: string;
    replyCommentId?: string;
    status?: string;
  }): Promise<FacebookComment> {
    const [comment] = await db
      .insert(facebookComments)
      .values({
        businessAccountId: data.businessAccountId,
        postId: data.postId || null,
        commentId: data.commentId || null,
        commentText: data.commentText || null,
        commenterName: data.commenterName || null,
        commenterId: data.commenterId || null,
        replyText: data.replyText || null,
        replyCommentId: data.replyCommentId || null,
        status: data.status || "pending",
      })
      .returning();

    console.log(`[Facebook] Stored comment ${data.commentId} for business ${data.businessAccountId} (id: ${comment.id})`);
    return comment;
  }

  async getConversations(
    businessAccountId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ conversations: any[]; total: number }> {
    const { limit = 20, offset = 0 } = options;

    const conversationsResult = await db.execute(sql`
      SELECT 
        sender_id,
        MAX(sender_name) as sender_name,
        COUNT(*) as message_count,
        MAX(created_at) as last_message_at,
        (SELECT message_text FROM facebook_messages m2 
         WHERE m2.business_account_id = ${businessAccountId} 
         AND m2.sender_id = fm.sender_id 
         ORDER BY m2.created_at DESC LIMIT 1) as last_message
      FROM facebook_messages fm
      WHERE business_account_id = ${businessAccountId}
      GROUP BY sender_id
      ORDER BY MAX(created_at) DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    const countResult = await db.execute(sql`
      SELECT COUNT(DISTINCT sender_id) as total
      FROM facebook_messages
      WHERE business_account_id = ${businessAccountId}
    `);

    return {
      conversations: conversationsResult.rows as any[],
      total: Number((countResult.rows[0] as any)?.total || 0),
    };
  }

  async getConversationBySenderId(
    businessAccountId: string,
    senderId: string,
    options: { limit?: number; before?: string } = {}
  ): Promise<{ messages: FacebookMessage[]; hasMore: boolean }> {
    const { limit = 50, before } = options;

    const conditions = [
      eq(facebookMessages.businessAccountId, businessAccountId),
      eq(facebookMessages.senderId, senderId),
    ];

    if (before) {
      conditions.push(sql`${facebookMessages.createdAt} < ${before}::timestamp`);
    }

    const messages = await db
      .select()
      .from(facebookMessages)
      .where(and(...conditions))
      .orderBy(desc(facebookMessages.createdAt))
      .limit(limit + 1);

    const hasMore = messages.length > limit;
    const result = hasMore ? messages.slice(0, limit) : messages;
    result.reverse();

    return { messages: result, hasMore };
  }

  async deleteConversation(
    businessAccountId: string,
    senderId: string
  ): Promise<number> {
    const result = await db
      .delete(facebookMessages)
      .where(
        and(
          eq(facebookMessages.businessAccountId, businessAccountId),
          eq(facebookMessages.senderId, senderId)
        )
      )
      .returning();

    console.log(`[Facebook] Deleted ${result.length} messages for sender ${senderId}`);
    return result.length;
  }

  async getUserProfile(
    accessToken: string,
    psid: string
  ): Promise<{ firstName?: string; lastName?: string; profilePic?: string } | null> {
    try {
      const url = `${FB_API_BASE}/${psid}?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(accessToken)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[Facebook] Failed to fetch user profile for ${psid}: ${response.status}`, errorBody);
        return null;
      }

      const data = await response.json();
      return {
        firstName: data.first_name || undefined,
        lastName: data.last_name || undefined,
        profilePic: data.profile_pic || undefined,
      };
    } catch (error) {
      console.error(`[Facebook] Error fetching user profile:`, error);
      return null;
    }
  }

  async findBusinessByPageId(pageId: string): Promise<{ businessAccountId: string; settings: FacebookSettings } | null> {
    const [settings] = await db
      .select()
      .from(facebookSettings)
      .where(eq(facebookSettings.pageId, pageId))
      .limit(1);

    if (!settings) return null;

    return { businessAccountId: settings.businessAccountId, settings };
  }

  async findSettingsByVerifyToken(verifyToken: string): Promise<FacebookSettings | null> {
    const [settings] = await db
      .select()
      .from(facebookSettings)
      .where(eq(facebookSettings.webhookVerifyToken, verifyToken))
      .limit(1);
    return settings || null;
  }

  async createFacebookLead(
    businessAccountId: string,
    data: {
      senderId: string;
      senderName?: string;
      flowSessionId?: string;
      extractedData?: Record<string, any>;
      status?: string;
    }
  ): Promise<FacebookLead> {
    const [lead] = await db
      .insert(facebookLeads)
      .values({
        businessAccountId,
        senderId: data.senderId,
        senderName: data.senderName || null,
        flowSessionId: data.flowSessionId || null,
        extractedData: data.extractedData || {},
        status: data.status || "new",
        receivedAt: new Date(),
      })
      .returning();

    return lead;
  }

  async getFacebookLeads(
    businessAccountId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ leads: FacebookLead[]; total: number }> {
    const { limit = 20, offset = 0 } = options;

    const [totalResult] = await db
      .select({ count: count() })
      .from(facebookLeads)
      .where(eq(facebookLeads.businessAccountId, businessAccountId));

    const leads = await db
      .select()
      .from(facebookLeads)
      .where(eq(facebookLeads.businessAccountId, businessAccountId))
      .orderBy(desc(facebookLeads.receivedAt))
      .limit(limit)
      .offset(offset);

    return { leads, total: totalResult?.count || 0 };
  }

  async deleteFacebookLead(businessAccountId: string, leadId: string): Promise<void> {
    await db
      .delete(facebookLeads)
      .where(
        and(
          eq(facebookLeads.id, leadId),
          eq(facebookLeads.businessAccountId, businessAccountId)
        )
      );
  }

  async getFacebookLeadFields(businessAccountId: string): Promise<FacebookLeadField[]> {
    let fields = await db
      .select()
      .from(facebookLeadFields)
      .where(eq(facebookLeadFields.businessAccountId, businessAccountId))
      .orderBy(asc(facebookLeadFields.displayOrder));

    if (fields.length === 0) {
      const defaults = [
        { businessAccountId, fieldKey: "customer_name", fieldLabel: "Customer Name", fieldType: "text", isRequired: true, isDefault: true, isEnabled: true, displayOrder: 0 },
        { businessAccountId, fieldKey: "phone_number", fieldLabel: "Phone Number", fieldType: "phone", isRequired: false, isDefault: true, isEnabled: true, displayOrder: 1 },
        { businessAccountId, fieldKey: "email_address", fieldLabel: "Email Address", fieldType: "email", isRequired: false, isDefault: true, isEnabled: true, displayOrder: 2 },
      ];

      fields = await db
        .insert(facebookLeadFields)
        .values(defaults)
        .returning();
    }

    return fields;
  }

  async createFacebookLeadField(
    businessAccountId: string,
    data: { fieldKey: string; fieldLabel: string; fieldType?: string; isRequired?: boolean; isEnabled?: boolean }
  ): Promise<FacebookLeadField> {
    const maxOrder = await db
      .select({ max: sql<number>`COALESCE(MAX(${facebookLeadFields.displayOrder}), -1)` })
      .from(facebookLeadFields)
      .where(eq(facebookLeadFields.businessAccountId, businessAccountId));

    const [field] = await db
      .insert(facebookLeadFields)
      .values({
        businessAccountId,
        fieldKey: data.fieldKey,
        fieldLabel: data.fieldLabel,
        fieldType: data.fieldType || "text",
        isRequired: data.isRequired || false,
        isDefault: false,
        isEnabled: data.isEnabled !== false,
        displayOrder: (maxOrder[0]?.max ?? -1) + 1,
      })
      .returning();

    return field;
  }

  async updateFacebookLeadField(
    businessAccountId: string,
    fieldId: string,
    data: { fieldLabel?: string; fieldType?: string; isRequired?: boolean; isEnabled?: boolean }
  ): Promise<FacebookLeadField> {
    const updateData: any = { updatedAt: new Date() };
    if (data.fieldLabel !== undefined) updateData.fieldLabel = data.fieldLabel;
    if (data.fieldType !== undefined) updateData.fieldType = data.fieldType;
    if (data.isRequired !== undefined) updateData.isRequired = data.isRequired;
    if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;

    const [field] = await db
      .update(facebookLeadFields)
      .set(updateData)
      .where(
        and(
          eq(facebookLeadFields.id, fieldId),
          eq(facebookLeadFields.businessAccountId, businessAccountId)
        )
      )
      .returning();

    return field;
  }

  async deleteFacebookLeadField(businessAccountId: string, fieldId: string): Promise<void> {
    await db
      .delete(facebookLeadFields)
      .where(
        and(
          eq(facebookLeadFields.id, fieldId),
          eq(facebookLeadFields.businessAccountId, businessAccountId),
          eq(facebookLeadFields.isDefault, false)
        )
      );
  }
  async getPostContext(
    settings: FacebookSettings,
    postId: string
  ): Promise<{ caption: string; mediaType: string; mediaUrl: string | null; permalink: string | null } | null> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        console.error('[Facebook] Cannot fetch post context: no access token');
        return null;
      }

      const fields = 'id,message,full_picture,permalink_url,type,attachments{media_type,media,url}';
      const url = `${FB_API_BASE}/${postId}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[Facebook] Failed to fetch post context for post ${postId}: ${response.status}`, errorBody);
        return null;
      }

      const data = await response.json();

      let mediaUrl = data.full_picture || null;
      let mediaType = data.type || 'status';

      if (data.attachments?.data?.length > 0) {
        const attachment = data.attachments.data[0];
        if (attachment.media?.image?.src) {
          mediaUrl = attachment.media.image.src;
        }
        if (attachment.media_type) {
          mediaType = attachment.media_type;
        }
      }

      console.log(`[Facebook] Post context fetched for post ${postId}: type=${mediaType}, message=${(data.message || '').substring(0, 50)}...`);

      return {
        caption: data.message || '',
        mediaType,
        mediaUrl,
        permalink: data.permalink_url || null,
      };
    } catch (error) {
      console.error(`[Facebook] Error fetching post context for post ${postId}:`, error);
      return null;
    }
  }
}

export const facebookService = new FacebookService();
