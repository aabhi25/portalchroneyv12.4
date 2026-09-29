import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { db } from "../db";
import { instagramSettings, instagramMessages, instagramComments, instagramLeads, instagramLeadFields } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { InstagramSettings, InstagramMessage, InstagramLead, InstagramLeadField, InstagramComment } from "@shared/schema";
import { MetaChannelService } from "./social/metaChannelService";

const IG_API_BASE = "https://graph.instagram.com/v21.0";
const IG_TEXT_LIMIT = 1000;

/**
 * Instagram (Instagram API with Instagram Login). Shared behaviour lives in
 * MetaChannelService; this class adds what only Instagram has: private replies addressed by
 * comment id, image messages, media / comment lookups and username profiles.
 */
export class InstagramService extends MetaChannelService<InstagramSettings, InstagramMessage, InstagramComment, InstagramLead, InstagramLeadField> {
  constructor() {
    super({
      platform: "instagram",
      label: "Instagram",
      apiBase: IG_API_BASE,
      textLimit: IG_TEXT_LIMIT,
      tokenMissingError: "Instagram access token not configured",
      tokenNoun: "access token",
      tokenField: "igAccessToken",
      commentReplyEdge: "replies",
      // No leadCaptureEnabled here: Instagram lead capture is toggled from the Leads page.
      saveSettingsFields: ["instagramEnabled", "igAccountId", "autoReplyEnabled", "webhookVerifyToken"],
      tables: { settings: instagramSettings, messages: instagramMessages, comments: instagramComments, leads: instagramLeads, leadFields: instagramLeadFields },
      messagesTableName: "instagram_messages",
      columns: { senderName: "senderUsername", senderNameSql: "sender_username", platformMessageId: "igMessageId", commenterName: "commenterUsername" },
    });
  }

  /**
   * Private reply to a comment: a DM to the commenter tied to their comment. Instagram only
   * accepts a DM to someone who hasn't messaged the account in this form, identified by
   * the comment rather than the user (recipient: { comment_id }). One per comment, within
   * 7 days of it.
   */
  async sendPrivateReply(
    settings: InstagramSettings,
    commentId: string,
    messageText: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const text = this.truncate(messageText);
    const r = await this.graphPost(settings, `${IG_API_BASE}/me/messages`, {
      recipient: { comment_id: commentId },
      message: { text },
    }, {
      before: `Sending private reply for comment ${commentId} (${text.length} chars)`,
      describe: (status, data) => `Private reply: HTTP ${status}${MetaChannelService.errorCodeSuffix(data)}`,
      errorLog: "Private reply error",
      fallbackError: "Failed to send private reply",
      logErrorMessageOnly: true,
    });
    return r.ok ? { success: true, messageId: r.data.message_id } : { success: false, error: r.error };
  }

  async sendImageMessage(
    settings: InstagramSettings,
    recipientId: string,
    imageUrl: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const r = await this.graphPost(settings, `${IG_API_BASE}/me/messages`, {
      recipient: { id: recipientId },
      message: { attachment: { type: "image", payload: { url: imageUrl } } },
    }, {
      before: `Sending image to ${recipientId}`,
      describe: (status, data) => `Send image: HTTP ${status}${MetaChannelService.errorCodeSuffix(data)}`,
      errorLog: "Send image error",
      fallbackError: "Failed to send image",
    });
    return r.ok ? { success: true, messageId: r.data.message_id } : { success: false, error: r.error };
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
    return this.insertMessage(businessAccountId, senderId, messageText, direction, {
      senderName: options.senderUsername,
      platformMessageId: options.igMessageId,
      messageType: options.messageType,
      mediaUrl: options.mediaUrl,
    });
  }

  async findMessageByIgId(igMessageId: string): Promise<InstagramMessage | null> {
    return this.findMessageByPlatformId(igMessageId);
  }

  async getUserProfile(
    accessToken: string,
    igScopedId: string
  ): Promise<{ name?: string; username?: string } | null> {
    try {
      const response = await fetchWithTimeout(this.graphGetUrl(igScopedId, "name,username", accessToken), {
        method: "GET",
        headers: { "Accept": "application/json" },
      }, 30_000);

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

  getInstagramLeads(businessAccountId: string, options: { limit?: number; offset?: number } = {}): Promise<{ leads: InstagramLead[]; total: number }> {
    return this.listLeads(businessAccountId, options);
  }

  deleteInstagramLead(businessAccountId: string, leadId: string): Promise<void> {
    return this.removeLead(businessAccountId, leadId);
  }

  getInstagramLeadFields(businessAccountId: string): Promise<InstagramLeadField[]> {
    return this.listLeadFields(businessAccountId);
  }

  createInstagramLeadField(
    businessAccountId: string,
    data: { fieldKey: string; fieldLabel: string; fieldType?: string; isRequired?: boolean; isEnabled?: boolean }
  ): Promise<InstagramLeadField> {
    return this.addLeadField(businessAccountId, data);
  }

  updateInstagramLeadField(
    businessAccountId: string,
    fieldId: string,
    data: { fieldLabel?: string; fieldType?: string; isRequired?: boolean; isEnabled?: boolean }
  ): Promise<InstagramLeadField> {
    return this.changeLeadField(businessAccountId, fieldId, data);
  }

  deleteInstagramLeadField(businessAccountId: string, fieldId: string): Promise<void> {
    return this.removeLeadField(businessAccountId, fieldId);
  }

  createInstagramLead(
    businessAccountId: string,
    data: {
      senderId: string;
      senderUsername?: string;
      flowSessionId?: string;
      extractedData?: Record<string, any>;
      status?: string;
    }
  ): Promise<InstagramLead> {
    return this.insertLead(businessAccountId, {
      senderId: data.senderId,
      senderName: data.senderUsername,
      flowSessionId: data.flowSessionId,
      extractedData: data.extractedData,
      status: data.status,
    });
  }

  /** GET helper for the Instagram-only lookups: returns the parsed body or an error. */
  private async graphGet(settings: InstagramSettings, path: string, fields: string, errorLog: string, fallbackError: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) {
        return { success: false, error: "Instagram access token not configured" };
      }
      const response = await fetchWithTimeout(this.graphGetUrl(path, fields, accessToken), {
        method: "GET",
        headers: { "Accept": "application/json" },
      }, 30_000);
      const responseData = await response.json();
      if (!response.ok) {
        return { success: false, error: responseData?.error?.message || `Instagram API error: ${response.status}` };
      }
      return { success: true, data: responseData };
    } catch (error) {
      console.error(`[Instagram] ${errorLog}:`, error);
      return { success: false, error: error instanceof Error ? error.message : fallbackError };
    }
  }

  async getMediaComments(
    settings: InstagramSettings,
    mediaId: string
  ): Promise<{ success: boolean; comments?: any[]; error?: string }> {
    const r = await this.graphGet(settings, `${mediaId}/comments`, "id,text,username,timestamp", "Get media comments error", "Failed to get media comments");
    return r.success ? { success: true, comments: r.data.data || [] } : { success: false, error: r.error };
  }

  async getCommentDetails(
    settings: InstagramSettings,
    commentId: string
  ): Promise<{ success: boolean; comment?: { id: string; text: string; username: string; timestamp: string }; error?: string }> {
    const r = await this.graphGet(settings, commentId, "text,username,timestamp", "Get comment details error", "Failed to get comment details");
    return r.success ? { success: true, comment: r.data } : { success: false, error: r.error };
  }

  storeComment(data: {
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
    const { commenterUsername, ...rest } = data;
    return this.insertComment({ ...rest, commenterName: commenterUsername });
  }

  findCommentByIgId(businessAccountId: string, commentId: string): Promise<InstagramComment | null> {
    return this.findCommentByPlatformId(businessAccountId, commentId);
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
      const response = await fetchWithTimeout(this.graphGetUrl(mediaId, fields, accessToken), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      }, 30_000);

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[Instagram] Failed to fetch post context for media ${mediaId}: ${response.status}`, errorBody);
        return null;
      }

      const data = await response.json();

      let mediaUrl = data.media_url || null;
      const thumbnailUrl = data.thumbnail_url || null;
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
