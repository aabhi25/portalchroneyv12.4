/**
 * Mobile-number verification when a phone arrives mid-chat (website widget only).
 *
 * Shared by the chat's automatic lead capture and conversation journeys, so a number typed in
 * either place gets the same check:
 *   - OTP (mobile.otpEnabled and deliverable): a challenge is issued (idempotent per conversation + phone).
 *   - CAPTCHA (mobile.captchaEnabled, OTP off): the conversation is locked (awaiting_verification)
 *     until the visitor passes the reCAPTCHA (POST /api/chat/widget/captcha/verify).
 */
import { storage } from '../../storage';

export interface PhoneGateInput {
  businessAccountId: string;
  conversationId: string;
  leadId: string;
  phone: string;
  /** widget_settings.lead_training_config */
  leadConfig: any;
  channel?: string | null;
}

export interface PhoneGateResult {
  otpIssued: boolean;
  captchaLocked: boolean;
}

/** The mobile field's verification method for this channel (none / otp / captcha). */
export async function phoneGateMethod(businessAccountId: string, leadConfig: any, channel?: string | null): Promise<'none' | 'otp' | 'captcha'> {
  if (channel !== 'widget') return 'none';
  const fields: any[] = Array.isArray(leadConfig?.fields) ? leadConfig.fields : [];
  const mobileField = fields.find((f: any) => f?.id === 'mobile' && f.enabled);
  if (!mobileField) return 'none';
  if (mobileField.otpEnabled === true) {
    // OTP that can't be delivered (no sender, Sample OTP off) is treated as off, so leads aren't blocked.
    const { isOtpEffectivelyEnabled } = await import('../otp');
    return (await isOtpEffectivelyEnabled(businessAccountId, leadConfig)) ? 'otp' : 'none';
  }
  return mobileField.captchaEnabled === true ? 'captcha' : 'none';
}

export async function applyMidChatPhoneGate(input: PhoneGateInput): Promise<PhoneGateResult> {
  const result: PhoneGateResult = { otpIssued: false, captchaLocked: false };
  const method = await phoneGateMethod(input.businessAccountId, input.leadConfig, input.channel);
  if (method === 'otp') {
    try {
      const { OtpService } = await import('../otp');
      const alreadyVerified = await OtpService.hasVerifiedChallenge(input.businessAccountId, input.conversationId, input.phone);
      if (alreadyVerified) {
        console.log(`[OTP-Gate] Skipping issueChallenge — phone already verified for conversation ${input.conversationId}`);
      } else {
        const issued = await OtpService.issueChallenge(input.businessAccountId, input.conversationId, input.phone, { leadId: input.leadId, channelOrigin: 'widget' });
        if (issued.ok) {
          result.otpIssued = true;
          console.log(`[OTP-Gate] Issued OTP challenge for conversation ${input.conversationId}, phone …${input.phone.slice(-4)}`);
        } else {
          console.warn(`[OTP-Gate] issueChallenge failed: ${issued.reason}`);
        }
      }
    } catch (err) {
      console.error('[OTP-Gate] issueChallenge error:', err);
    }
  } else if (method === 'captcha') {
    try {
      await storage.markConversationAwaitingCaptchaIfUnverified(input.conversationId, input.businessAccountId);
      result.captchaLocked = true;
      console.log(`[CAPTCHA-Gate] Locked conversation ${input.conversationId} pending CAPTCHA`);
    } catch (err) {
      console.error('[CAPTCHA-Gate] markAwaiting error:', err);
    }
  }
  return result;
}
