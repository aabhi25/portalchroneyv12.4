import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { db } from "../db";
import { facebookSettings, facebookMessages, facebookComments, facebookLeads, facebookLeadFields } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { FacebookSettings, FacebookMessage, FacebookLead, FacebookLeadField, FacebookComment } from "@shared/schema";
import { MetaChannelService } from "./social/metaChannelService";

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const FB_TEXT_LIMIT = 2000;

/**
 * Facebook Page / Messenger. Shared behaviour lives in MetaChannelService; this class adds
 * what only Facebook has: the /{comment-id}/private_replies edge, first/last-name profiles
 * and page post context.
 */
export class FacebookService extends MetaChannelService<FacebookSettings, FacebookMessage, FacebookComment, FacebookLead, FacebookLeadField> {
  constructor() {
    super({
      platform: "facebook",
      label: "Facebook",
      apiBase: FB_API_BASE,
      textLimit: FB_TEXT_LIMIT,
      tokenMissingError: "Facebook page access token not configured",
      tokenNoun: "page access token",
      tokenField: "pageAccessToken",
      commentReplyEdge: "comments",
      saveSettingsFields: ["facebookEnabled", "pageId", "autoReplyEnabled", "leadCaptureEnabled", "webhookVerifyToken"],
      tables: { settings: facebookSettings, messages: facebookMessages, comments: facebookComments, leads: facebookLeads, leadFields: facebookLeadFields },
      messagesTableName: "facebook_messages",
      columns: { senderName: "senderName", senderNameSql: "sender_name", platformMessageId: "fbMessageId", commenterName: "commenterName" },
    });
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
    return this.insertMessage(businessAccountId, senderId, messageText, direction, {
      senderName: options.senderName,
      platformMessageId: options.fbMessageId,
      messageType: options.messageType,
      mediaUrl: options.mediaUrl,
    });
  }

  /** Private reply to a comment through the page's /{comment-id}/private_replies edge. */
  async sendPrivateReply(
    settings: FacebookSettings,
    commentId: string,
    message: string
  ): Promise<{ success: boolean; error?: string }> {
    const text = this.truncate(message);
    const r = await this.graphPost(settings, `${FB_API_BASE}/${commentId}/private_replies`, { message: text }, {
      before: `Sending private reply for comment ${commentId} (${text.length} chars)`,
      describe: (status, data) => `Private reply: HTTP ${status}${MetaChannelService.errorCodeSuffix(data)}`,
      errorLog: "Private reply error",
      fallbackError: "Failed to send private reply",
    });
    return r.ok ? { success: true } : { success: false, error: r.error };
  }

  findMessageByFbId(fbMessageId: string): Promise<FacebookMessage | null> {
    return this.findMessageByPlatformId(fbMessageId);
  }

  findCommentByFbId(businessAccountId: string, commentId: string): Promise<FacebookComment | null> {
    return this.findCommentByPlatformId(businessAccountId, commentId);
  }

  storeComment(data: {
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
    return this.insertComment(data);
  }

  async getUserProfile(
    accessToken: string,
    psid: string
  ): Promise<{ firstName?: string; lastName?: string; profilePic?: string } | null> {
    try {
      const response = await fetchWithTimeout(this.graphGetUrl(psid, "first_name,last_name,profile_pic", accessToken), {
        method: "GET",
        headers: { "Accept": "application/json" },
      }, 30_000);

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

  createFacebookLead(
    businessAccountId: string,
    data: {
      senderId: string;
      senderName?: string;
      flowSessionId?: string;
      extractedData?: Record<string, any>;
      status?: string;
    }
  ): Promise<FacebookLead> {
    return this.insertLead(businessAccountId, data);
  }

  getFacebookLeads(businessAccountId: string, options: { limit?: number; offset?: number } = {}): Promise<{ leads: FacebookLead[]; total: number }> {
    return this.listLeads(businessAccountId, options);
  }

  deleteFacebookLead(businessAccountId: string, leadId: string): Promise<void> {
    return this.removeLead(businessAccountId, leadId);
  }

  getFacebookLeadFields(businessAccountId: string): Promise<FacebookLeadField[]> {
    return this.listLeadFields(businessAccountId);
  }

  createFacebookLeadField(
    businessAccountId: string,
    data: { fieldKey: string; fieldLabel: string; fieldType?: string; isRequired?: boolean; isEnabled?: boolean }
  ): Promise<FacebookLeadField> {
    return this.addLeadField(businessAccountId, data);
  }

  updateFacebookLeadField(
    businessAccountId: string,
    fieldId: string,
    data: { fieldLabel?: string; fieldType?: string; isRequired?: boolean; isEnabled?: boolean }
  ): Promise<FacebookLeadField> {
    return this.changeLeadField(businessAccountId, fieldId, data);
  }

  deleteFacebookLeadField(businessAccountId: string, fieldId: string): Promise<void> {
    return this.removeLeadField(businessAccountId, fieldId);
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
      const response = await fetchWithTimeout(this.graphGetUrl(postId, fields, accessToken), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      }, 30_000);

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
