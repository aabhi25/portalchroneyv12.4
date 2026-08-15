import { db } from "../db";
import { instagramSettings, instagramMessages, instagramComments, businessAccounts, instagramLeads, instagramLeadFields } from "@shared/schema";
import { eq, and, desc, sql, asc, count } from "drizzle-orm";
import type { InstagramSettings, InstagramMessage, InsertInstagramMessage, InstagramLead, InstagramLeadField, InstagramComment, InsertInstagramComment } from "@shared/schema";
import { encrypt, decrypt } from "./encryptionService";

const IG_API_BASE = "https://graph.instagram.com/v21.0";
const IG_TEXT_LIMIT = 1000;

export class InstagramService {

  async getSettings(businessAccountId: string): Promise<InstagramSettings | null> {
    const [settings] = await db
      .select()
      .from(instagramSettings)
      .where(eq(instagramSettings.businessAccountId, businessAccountId))
      .limit(1);
    return settings || null;
  }

  async updateSettings(businessAccountId: string, data: Partial<InstagramSettings>): Promise<InstagramSettings> {
    const updateData: any = { ...data, updatedAt: new Date() };

    if (data.igAccessToken !== undefined && data.igAccessToken !== null) {
      updateData.igAccessToken = encrypt(data.igAccessToken);
    }
    if (data.appSecret !== undefined && data.appSecret !== null) {
      updateData.appSecret = encrypt(data.appSecret);
    }

    const [updated] = await db
      .update(instagramSettings)
      .set(updateData)
      .where(eq(instagramSettings.businessAccountId, businessAccountId))
      .returning();
    return updated;
  }

  async createSettings(businessAccountId: string, data: Partial<InstagramSettings> = {}): Promise<InstagramSettings> {
    const insertData: any = { businessAccountId, ...data };

    if (data.igAccessToken) {
      insertData.igAccessToken = encrypt(data.igAccessToken);
    }
    if (data.appSecret) {
      insertData.appSecret = encrypt(data.appSecret);
    }

    const [created] = await db
      .insert(instagramSettings)
      .values(insertData)
      .returning();
    return created;
  }

  getDecryptedAccessToken(settings: InstagramSettings): string | null {
    if (!settings.igAccessToken) return null;
    try {
      return decrypt(settings.igAccessToken);
    } catch (error) {
      console.error("[Instagram] Failed to decrypt access token:", error);
      return null;
    }
  }

  getDecryptedAppSecret(settings: InstagramSettings): string | null {
    if (!settings.appSecret) return null;
    try {
      return decrypt(settings.appSecret);
    } catch (error) {
      console.error("[Instagram] Failed to decrypt app secret:", error);
      return null;
    }
  }

  async sendMessage(
    settings: InstagramSettings,
    recipientId: string,
    messageText: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        return { success: false, error: "Instagram access token not configured" };
      }

      const truncatedText = messageText.length > IG_TEXT_LIMIT
        ? messageText.substring(0, IG_TEXT_LIMIT - 3) + "..."
        : messageText;

      const url = `${IG_API_BASE}/me/messages`;

      const body = {
        recipient: { id: recipientId },
        message: { text: truncatedText },
      };

      console.log(`[Instagram] Sending message to ${recipientId}:`, {
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
      console.log(`[Instagram] API response:`, responseData);

      if (!response.ok) {
        const errorMsg = responseData?.error?.message || `Instagram API error: ${response.status}`;
        return { success: false, error: errorMsg };
      }

      return {
        success: true,
        messageId: responseData.message_id,
      };
    } catch (error) {
      console.error(`[Instagram] Send error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send message",
      };
    }
  }

  async sendImageMessage(
    settings: InstagramSettings,
    recipientId: string,
    imageUrl: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        return { success: false, error: "Instagram access token not configured" };
      }

      const url = `${IG_API_BASE}/me/messages`;

      const body = {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "image",
            payload: { url: imageUrl },
          },
        },
      };

      console.log(`[Instagram] Sending image to ${recipientId}:`, {
        imageUrl: imageUrl.substring(0, 80) + (imageUrl.length > 80 ? "..." : ""),
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
      console.log(`[Instagram] Image API response:`, responseData);

      if (!response.ok) {
        const errorMsg = responseData?.error?.message || `Instagram API error: ${response.status}`;
        return { success: false, error: errorMsg };
      }

      return {
        success: true,
        messageId: responseData.message_id,
      };
    } catch (error) {
      console.error(`[Instagram] Send image error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send image",
      };
    }
  }

  async storeMessage(
    businessAccountId: string,
    senderId: string,
    messageText: string | null,
    direction: "incoming" | "outgoing",
    options: {
      senderUsername?: string;
      igMessageId?: string;
      messageType?: string;
      mediaUrl?: string;
    } = {}
  ): Promise<InstagramMessage> {
    const messageData: InsertInstagramMessage = {
      businessAccountId,
      senderId,
      messageText: messageText || null,
      direction,
      senderUsername: options.senderUsername || null,
      igMessageId: options.igMessageId || null,
      messageType: options.messageType || "text",
      mediaUrl: options.mediaUrl || null,
    };

    const [message] = await db
      .insert(instagramMessages)
      .values(messageData)
      .returning();

    console.log(`[Instagram] Stored ${direction} message for sender ${senderId} (id: ${message.id})`);
    return message;
  }

  async getConversations(
    businessAccountId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ conversations: any[]; total: number }> {
    const { limit = 20, offset = 0 } = options;

    const conversationsResult = await db.execute(sql`
      SELECT 
        sender_id,
        MAX(sender_username) as sender_username,
        COUNT(*) as message_count,
        MAX(created_at) as last_message_at,
        (SELECT message_text FROM instagram_messages m2 
         WHERE m2.business_account_id = ${businessAccountId} 
         AND m2.sender_id = im.sender_id 
         ORDER BY m2.created_at DESC LIMIT 1) as last_message
      FROM instagram_messages im
      WHERE business_account_id = ${businessAccountId}
      GROUP BY sender_id
      ORDER BY MAX(created_at) DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    const countResult = await db.execute(sql`
      SELECT COUNT(DISTINCT sender_id) as total
      FROM instagram_messages
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
  ): Promise<{ messages: InstagramMessage[]; hasMore: boolean }> {
    const { limit = 50, before } = options;

    const conditions = [
      eq(instagramMessages.businessAccountId, businessAccountId),
      eq(instagramMessages.senderId, senderId),
    ];

    if (before) {
      conditions.push(sql`${instagramMessages.createdAt} < ${before}::timestamp`);
    }

    const messages = await db
      .select()
      .from(instagramMessages)
      .where(and(...conditions))
      .orderBy(desc(instagramMessages.createdAt))
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
      .delete(instagramMessages)
      .where(
        and(
          eq(instagramMessages.businessAccountId, businessAccountId),
          eq(instagramMessages.senderId, senderId)
        )
      )
      .returning();

    console.log(`[Instagram] Deleted ${result.length} messages for sender ${senderId}`);
    return result.length;
  }

  async getUserProfile(
    accessToken: string,
    igScopedId: string
  ): Promise<{ name?: string; username?: string } | null> {
    try {
      const url = `${IG_API_BASE}/${igScopedId}?fields=name,username&access_token=${encodeURIComponent(accessToken)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[Instagram] Failed to fetch user profile for ${igScopedId}: ${response.status}`, errorBody);
        return null;
      }

      const data = await response.json();
      return {
        name: data.name || undefined,
        username: data.username || undefined,
      };
    } catch (error) {
      console.error(`[Instagram] Error fetching user profile:`, error);
      return null;
    }
  }

  async findBusinessByIgAccountId(igAccountId: string): Promise<{ businessAccountId: string; settings: InstagramSettings } | null> {
    const [settings] = await db
      .select()
      .from(instagramSettings)
      .where(eq(instagramSettings.igAccountId, igAccountId))
      .limit(1);

    if (!settings) return null;
    
    return { businessAccountId: settings.businessAccountId, settings };
  }

  async findSettingsByVerifyToken(verifyToken: string): Promise<InstagramSettings | null> {
    const [settings] = await db
      .select()
      .from(instagramSettings)
      .where(eq(instagramSettings.webhookVerifyToken, verifyToken))
      .limit(1);
    return settings || null;
  }

  async findMessageByIgId(igMessageId: string): Promise<InstagramMessage | null> {
    const [message] = await db
      .select()
      .from(instagramMessages)
      .where(eq(instagramMessages.igMessageId, igMessageId))
      .limit(1);
    return message || null;
  }

  async saveSettings(businessAccountId: string, data: any): Promise<InstagramSettings> {
    let existing = await this.getSettings(businessAccountId);
    
    const updateData: any = {};
    if (data.instagramEnabled !== undefined) updateData.instagramEnabled = data.instagramEnabled;
    if (data.igAccountId !== undefined) updateData.igAccountId = data.igAccountId;
    if (data.autoReplyEnabled !== undefined) updateData.autoReplyEnabled = data.autoReplyEnabled;
    if (data.webhookVerifyToken !== undefined) updateData.webhookVerifyToken = data.webhookVerifyToken;
    if (data.igAccessToken && data.igAccessToken !== "••••••••") updateData.igAccessToken = data.igAccessToken;
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
  async sendQuickReply(
    settings: InstagramSettings,
    recipientId: string,
    messageText: string,
    quickReplies: { content_type: string; title: string; payload: string }[]
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        return { success: false, error: "Instagram access token not configured" };
      }

      const truncatedText = messageText.length > 1000
        ? messageText.substring(0, 997) + "..."
        : messageText;

      const url = `${IG_API_BASE}/me/messages`;

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
        const errorMsg = responseData?.error?.message || `Instagram API error: ${response.status}`;
        return { success: false, error: errorMsg };
      }

      return {
        success: true,
        messageId: responseData.message_id,
      };
    } catch (error) {
      console.error(`[Instagram] Send quick reply error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send quick reply",
      };
    }
  }
  async getInstagramLeads(
    businessAccountId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ leads: InstagramLead[]; total: number }> {
    const { limit = 20, offset = 0 } = options;

    const [totalResult] = await db
      .select({ count: count() })
      .from(instagramLeads)
      .where(eq(instagramLeads.businessAccountId, businessAccountId));

    const leads = await db
      .select()
      .from(instagramLeads)
      .where(eq(instagramLeads.businessAccountId, businessAccountId))
      .orderBy(desc(instagramLeads.receivedAt))
      .limit(limit)
      .offset(offset);

    return { leads, total: totalResult?.count || 0 };
  }

  async deleteInstagramLead(businessAccountId: string, leadId: string): Promise<void> {
    await db
      .delete(instagramLeads)
      .where(
        and(
          eq(instagramLeads.id, leadId),
          eq(instagramLeads.businessAccountId, businessAccountId)
        )
      );
  }

  async getInstagramLeadFields(businessAccountId: string): Promise<InstagramLeadField[]> {
    let fields = await db
      .select()
      .from(instagramLeadFields)
      .where(eq(instagramLeadFields.businessAccountId, businessAccountId))
      .orderBy(asc(instagramLeadFields.displayOrder));

    if (fields.length === 0) {
      const defaults = [
        { businessAccountId, fieldKey: "customer_name", fieldLabel: "Customer Name", fieldType: "text", isRequired: true, isDefault: true, isEnabled: true, displayOrder: 0 },
        { businessAccountId, fieldKey: "phone_number", fieldLabel: "Phone Number", fieldType: "phone", isRequired: false, isDefault: true, isEnabled: true, displayOrder: 1 },
        { businessAccountId, fieldKey: "email_address", fieldLabel: "Email Address", fieldType: "email", isRequired: false, isDefault: true, isEnabled: true, displayOrder: 2 },
      ];

      fields = await db
        .insert(instagramLeadFields)
        .values(defaults)
        .returning();
    }

    return fields;
  }

  async createInstagramLeadField(
    businessAccountId: string,
    data: { fieldKey: string; fieldLabel: string; fieldType?: string; isRequired?: boolean; isEnabled?: boolean }
  ): Promise<InstagramLeadField> {
    const maxOrder = await db
      .select({ max: sql<number>`COALESCE(MAX(${instagramLeadFields.displayOrder}), -1)` })
      .from(instagramLeadFields)
      .where(eq(instagramLeadFields.businessAccountId, businessAccountId));

    const [field] = await db
      .insert(instagramLeadFields)
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

  async updateInstagramLeadField(
    businessAccountId: string,
    fieldId: string,
    data: { fieldLabel?: string; fieldType?: string; isRequired?: boolean; isEnabled?: boolean }
  ): Promise<InstagramLeadField> {
    const updateData: any = { updatedAt: new Date() };
    if (data.fieldLabel !== undefined) updateData.fieldLabel = data.fieldLabel;
    if (data.fieldType !== undefined) updateData.fieldType = data.fieldType;
    if (data.isRequired !== undefined) updateData.isRequired = data.isRequired;
    if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;

    const [field] = await db
      .update(instagramLeadFields)
      .set(updateData)
      .where(
        and(
          eq(instagramLeadFields.id, fieldId),
          eq(instagramLeadFields.businessAccountId, businessAccountId)
        )
      )
      .returning();

    return field;
  }

  async deleteInstagramLeadField(businessAccountId: string, fieldId: string): Promise<void> {
    await db
      .delete(instagramLeadFields)
      .where(
        and(
          eq(instagramLeadFields.id, fieldId),
          eq(instagramLeadFields.businessAccountId, businessAccountId),
          eq(instagramLeadFields.isDefault, false)
        )
      );
  }

  async createInstagramLead(
    businessAccountId: string,
    data: {
      senderId: string;
      senderUsername?: string;
      flowSessionId?: string;
      extractedData?: Record<string, any>;
      status?: string;
    }
  ): Promise<InstagramLead> {
    const [lead] = await db
      .insert(instagramLeads)
      .values({
        businessAccountId,
        senderId: data.senderId,
        senderUsername: data.senderUsername || null,
        flowSessionId: data.flowSessionId || null,
        extractedData: data.extractedData || {},
        status: data.status || "new",
        receivedAt: new Date(),
      })
      .returning();

    return lead;
  }
  async replyToComment(
    settings: InstagramSettings,
    commentId: string,
    message: string
  ): Promise<{ success: boolean; commentId?: string; error?: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        return { success: false, error: "Instagram access token not configured" };
      }

      const truncatedMessage = message.length > IG_TEXT_LIMIT
        ? message.substring(0, IG_TEXT_LIMIT - 3) + "..."
        : message;

      const url = `${IG_API_BASE}/${commentId}/replies`;

      console.log(`[Instagram] Replying to comment ${commentId}:`, {
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
      console.log(`[Instagram] Comment reply API response:`, responseData);

      if (!response.ok) {
        const errorMsg = responseData?.error?.message || `Instagram API error: ${response.status}`;
        return { success: false, error: errorMsg };
      }

      return {
        success: true,
        commentId: responseData.id,
      };
    } catch (error) {
      console.error(`[Instagram] Reply to comment error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to reply to comment",
      };
    }
  }

  async getMediaComments(
    settings: InstagramSettings,
    mediaId: string
  ): Promise<{ success: boolean; comments?: any[]; error?: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        return { success: false, error: "Instagram access token not configured" };
      }

      const url = `${IG_API_BASE}/${mediaId}/comments?fields=id,text,username,timestamp&access_token=${encodeURIComponent(accessToken)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      const responseData = await response.json();

      if (!response.ok) {
        const errorMsg = responseData?.error?.message || `Instagram API error: ${response.status}`;
        return { success: false, error: errorMsg };
      }

      return {
        success: true,
        comments: responseData.data || [],
      };
    } catch (error) {
      console.error(`[Instagram] Get media comments error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get media comments",
      };
    }
  }

  async getCommentDetails(
    settings: InstagramSettings,
    commentId: string
  ): Promise<{ success: boolean; comment?: { id: string; text: string; username: string; timestamp: string }; error?: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        return { success: false, error: "Instagram access token not configured" };
      }

      const url = `${IG_API_BASE}/${commentId}?fields=text,username,timestamp&access_token=${encodeURIComponent(accessToken)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      const responseData = await response.json();

      if (!response.ok) {
        const errorMsg = responseData?.error?.message || `Instagram API error: ${response.status}`;
        return { success: false, error: errorMsg };
      }

      return {
        success: true,
        comment: responseData,
      };
    } catch (error) {
      console.error(`[Instagram] Get comment details error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get comment details",
      };
    }
  }

  async storeComment(data: {
    businessAccountId: string;
    postId?: string;
    commentId?: string;
    commentText?: string;
    commenterUsername?: string;
    commenterId?: string;
    replyText?: string;
    replyCommentId?: string;
    status?: string;
  }): Promise<InstagramComment> {
    const [comment] = await db
      .insert(instagramComments)
      .values({
        businessAccountId: data.businessAccountId,
        postId: data.postId || null,
        commentId: data.commentId || null,
        commentText: data.commentText || null,
        commenterUsername: data.commenterUsername || null,
        commenterId: data.commenterId || null,
        replyText: data.replyText || null,
        replyCommentId: data.replyCommentId || null,
        status: data.status || "pending",
      })
      .returning();

    console.log(`[Instagram] Stored comment ${data.commentId} for business ${data.businessAccountId} (id: ${comment.id})`);
    return comment;
  }

  async findCommentByIgId(businessAccountId: string, commentId: string): Promise<InstagramComment | null> {
    const [comment] = await db
      .select()
      .from(instagramComments)
      .where(
        and(
          eq(instagramComments.businessAccountId, businessAccountId),
          eq(instagramComments.commentId, commentId)
        )
      )
      .limit(1);
    return comment || null;
  }
  async getPostContext(
    settings: InstagramSettings,
    mediaId: string
  ): Promise<{ caption: string; mediaType: string; mediaUrl: string | null; thumbnailUrl: string | null; permalink: string | null } | null> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        console.error('[Instagram] Cannot fetch post context: no access token');
        return null;
      }

      const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,children{media_type,media_url,thumbnail_url}';
      const url = `${IG_API_BASE}/${mediaId}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[Instagram] Failed to fetch post context for media ${mediaId}: ${response.status}`, errorBody);
        return null;
      }

      const data = await response.json();

      let mediaUrl = data.media_url || null;
      let thumbnailUrl = data.thumbnail_url || null;
      const mediaType = data.media_type || 'UNKNOWN';

      if (mediaType === 'VIDEO' || mediaType === 'REEL') {
        mediaUrl = thumbnailUrl || mediaUrl;
      }

      if (mediaType === 'CAROUSEL_ALBUM' && data.children?.data?.length > 0) {
        const firstChild = data.children.data[0];
        if (firstChild.media_type === 'VIDEO') {
          mediaUrl = firstChild.thumbnail_url || firstChild.media_url || mediaUrl;
        } else {
          mediaUrl = firstChild.media_url || mediaUrl;
        }
      }

      console.log(`[Instagram] Post context fetched for media ${mediaId}: type=${mediaType}, caption=${(data.caption || '').substring(0, 50)}...`);

      return {
        caption: data.caption || '',
        mediaType,
        mediaUrl,
        thumbnailUrl,
        permalink: data.permalink || null,
      };
    } catch (error) {
      console.error(`[Instagram] Error fetching post context for media ${mediaId}:`, error);
      return null;
    }
  }
}

export const instagramService = new InstagramService();
