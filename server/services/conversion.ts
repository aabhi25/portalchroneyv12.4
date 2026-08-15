import { storage } from '../storage';

// Conversion tracking (Google Ads) shared gate.
//
// Decides whether the widget should fire the hidden conversion iframe for this
// conversation right now, and atomically CLAIMS the one-time fire. Returns true
// at most ONCE per conversation, and only when:
//   1. the business has configured a non-blank, https conversion URL, and
//   2. a mobile number has been captured on this conversation's lead.
//
// The URL itself is NEVER fetched server-side — this helper only flips the
// dedupe marker; the actual page load happens in the VISITOR's browser. Used by
// both the mid-chat SSE signal (chatService) and the gated verify endpoints
// (OTP / CAPTCHA) so every path shares identical gating semantics and the
// "blank URL = disabled" contract never burns the one-time marker.
export async function claimConversionFire(
  conversationId: string,
  businessAccountId: string,
): Promise<boolean> {
  try {
    const settings = await storage.getWidgetSettings(businessAccountId);
    const cfg = settings?.leadTrainingConfig as any;
    const rawUrl = typeof cfg?.conversionUrl === 'string' ? cfg.conversionUrl.trim() : '';
    if (!rawUrl) return false; // feature disabled for this business → no DB write

    // https-only guard (defense-in-depth; zod also enforces this on save).
    try {
      if (new URL(rawUrl).protocol !== 'https:') return false;
    } catch {
      return false;
    }

    const lead = await storage.getLeadByConversation(conversationId, businessAccountId);
    if (!lead?.phone) return false; // no mobile captured yet

    return await storage.markConversionFiredIfNeeded(conversationId, businessAccountId);
  } catch (err) {
    console.error('[Conversion] claimConversionFire error (non-fatal):', err);
    return false;
  }
}
