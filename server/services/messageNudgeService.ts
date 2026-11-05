import { storage } from "../storage";
import { shownMessageNudges } from "@shared/messageNudges";

/**
 * Saves the message nudges a visitor saw as the chat's first messages, just before their first reply.
 * The browser only says which ones were shown: the text comes from the business's settings, so
 * nothing can be written into a chat from outside. Returns the saved text ([] when nothing to save).
 */
export async function saveShownMessageNudges(
  businessAccountId: string,
  conversationId: string,
  indexes: unknown,
): Promise<string[]> {
  if (!Array.isArray(indexes) || indexes.length === 0 || conversationId.startsWith("temp_")) return [];
  try {
    const settings = await storage.getWidgetSettings(businessAccountId);
    if (settings?.messageNudgeEnabled !== "true") return [];
    const nudges = shownMessageNudges(settings.messageNudgeItems, indexes);
    if (nudges.length === 0) return [];
    // Only at the very start of a chat of this business (this throws for another business's chat).
    const existing = await storage.getMessagesByConversation(conversationId, businessAccountId);
    if (existing.length > 0) return [];
    for (const { index, text } of nudges) {
      await storage.createMessage({
        conversationId,
        role: "assistant",
        content: text,
        metadata: JSON.stringify({ source: "message_nudge", index }),
        interactionSource: "chat",
      });
    }
    await storage.updateConversationTimestamp(conversationId);
    return nudges.map((n) => n.text);
  } catch (err) {
    // The visitor's reply matters more: carry on without them.
    console.error("[Message Nudges] Could not save shown messages:", err);
    return [];
  }
}
