import { facebookSettings, facebookMessages, facebookLeads } from "@shared/schema";
import { facebookService } from "./facebookService";
import { SocialAutoReplyEngine } from "./social/autoReplyEngine";

/**
 * Facebook Messenger auto-replies (engine: social/autoReplyEngine.ts). Smart replies
 * (channel "facebook") are checked before the AI, as on Instagram; the AI reply itself is
 * plain text (no product tool / images / language detection).
 */
export class FacebookAutoReplyService extends SocialAutoReplyEngine {
  constructor() {
    super({
      platform: "facebook",
      label: "Facebook",
      tables: { settings: facebookSettings, messages: facebookMessages, leads: facebookLeads },
      senderNameColumn: "senderName",
      cachePrefix: "fb",
      channelPhrase: "Facebook Messenger",
      formatPhrase: "Facebook Messenger format",
      richMedia: false,
      snapshotWithContact: true,
      sendMessage: (settings, recipientId, text) => facebookService.sendMessage(settings, recipientId, text),
      storeMessage: (businessAccountId, senderId, text, direction, options = {}) =>
        facebookService.storeMessage(businessAccountId, senderId, text, direction, {
          fbMessageId: options.platformMessageId,
          messageType: options.messageType,
          mediaUrl: options.mediaUrl,
        }),
      createLead: (businessAccountId, data) => facebookService.createFacebookLead(businessAccountId, data),
      fetchSenderNameFromApi: async (businessAccountId, senderId) => {
        try {
          const settings = await facebookService.getSettings(businessAccountId);
          if (settings) {
            const decryptedToken = facebookService.getDecryptedAccessToken(settings);
            if (decryptedToken) {
              const profile = await facebookService.getUserProfile(decryptedToken, senderId);
              if (profile?.firstName) {
                const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
                console.log(`[Facebook Auto-Reply] Resolved name via API for ${senderId}`);
                return fullName;
              }
            }
          }
        } catch (err) {
          console.log(`[Facebook Auto-Reply] Could not resolve name via API for ${senderId}`);
        }
        return null;
      },
    });
  }
}

export const facebookAutoReplyService = new FacebookAutoReplyService();
