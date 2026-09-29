import { instagramSettings, instagramMessages, instagramLeads } from "@shared/schema";
import { instagramService } from "./instagramService";
import { SocialAutoReplyEngine } from "./social/autoReplyEngine";

/**
 * Instagram DM auto-replies (engine: social/autoReplyEngine.ts). Instagram gets the rich
 * path: smart replies, language detection, product-catalog tool with image cards.
 */
export class InstagramAutoReplyService extends SocialAutoReplyEngine {
  constructor() {
    super({
      platform: "instagram",
      label: "Instagram",
      tables: { settings: instagramSettings, messages: instagramMessages, leads: instagramLeads },
      senderNameColumn: "senderUsername",
      cachePrefix: "ig",
      channelPhrase: "Instagram DMs",
      formatPhrase: "Instagram DM format",
      richMedia: true,
      snapshotWithContact: false,
      sendMessage: (settings, recipientId, text) => instagramService.sendMessage(settings, recipientId, text),
      sendImageMessage: (settings, recipientId, imageUrl) => instagramService.sendImageMessage(settings, recipientId, imageUrl),
      storeMessage: (businessAccountId, senderId, text, direction, options = {}) =>
        instagramService.storeMessage(businessAccountId, senderId, text, direction, {
          igMessageId: options.platformMessageId,
          messageType: options.messageType,
          mediaUrl: options.mediaUrl,
        }),
      createLead: (businessAccountId, data) => instagramService.createInstagramLead(businessAccountId, {
        senderId: data.senderId,
        senderUsername: data.senderName,
        extractedData: data.extractedData,
        status: data.status,
      }),
      fetchSenderNameFromApi: async (businessAccountId, senderId) => {
        try {
          const settings = await instagramService.getSettings(businessAccountId);
          if (settings) {
            const decryptedToken = instagramService.getDecryptedAccessToken(settings);
            if (decryptedToken) {
              const profile = await instagramService.getUserProfile(decryptedToken, senderId);
              if (profile?.username) {
                console.log(`[Instagram Auto-Reply] Resolved username via API for ${senderId}`);
                return profile.username;
              }
            }
          }
        } catch (err) {
          console.log(`[Instagram Auto-Reply] Could not resolve username via API for ${senderId}`);
        }
        return null;
      },
    });
  }
}

export const instagramAutoReplyService = new InstagramAutoReplyService();
