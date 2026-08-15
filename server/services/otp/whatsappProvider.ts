import type { OtpProvider, OtpSendResult } from './types';
import { db } from '../../db';
import { whatsappSettings, type WhatsappSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { sendTemplateMessage } from '../whatsappSessionService';

export interface WhatsAppOtpConfig {
  businessAccountId: string;
  templateName: string;
}

/**
 * WhatsApp-based OTP delivery via the existing MSG91 WhatsApp Cloud API
 * integration. Sends the 6-digit code as the first body variable of an
 * approved authentication-category template (must have a one-time-password
 * component in Meta Business Manager).
 *
 * Why we re-load whatsappSettings on every send rather than caching:
 *   - Admins can rotate creds / change templates at any time.
 *   - Each send is rare (per-phone OTP) so the read cost is negligible.
 *   - Avoids stale credential bugs after rotation.
 */
export class WhatsAppOtpProvider implements OtpProvider {
  readonly name = 'whatsapp';

  constructor(private readonly cfg: WhatsAppOtpConfig) {}

  async sendOtp(phoneE164: string, code: string): Promise<OtpSendResult> {
    const masked = phoneE164.length > 4 ? `***${phoneE164.slice(-4)}` : '***';
    try {
      const [settings] = await db
        .select()
        .from(whatsappSettings)
        .where(eq(whatsappSettings.businessAccountId, this.cfg.businessAccountId))
        .limit(1);

      if (!settings) {
        return { success: false, error: 'WhatsApp Cloud API not configured for this business' };
      }
      if (!settings.msg91AuthKey || !settings.msg91IntegratedNumberId) {
        return { success: false, error: 'WhatsApp credentials incomplete (missing auth key or integrated number)' };
      }
      if (!this.cfg.templateName) {
        return { success: false, error: 'WhatsApp OTP template name not configured' };
      }

      // Auth-category templates with a one-time-password component expect the
      // code as the body's first variable. We also fill an optional button-copy
      // parameter when MSG91 expects it; harmless if the template doesn't
      // declare one.
      const result = await sendTemplateMessage(
        settings as WhatsappSettings,
        phoneE164,
        this.cfg.templateName,
        { '1': code },
      );

      if (!result.success) {
        console.error(`[OTP] WhatsApp send failed to ${masked}: ${result.error}`);
        return { success: false, error: result.error || 'whatsapp_send_failed' };
      }

      console.log(`[OTP] WhatsApp send OK to ${masked} (message_id=${result.messageId || 'n/a'})`);
      return { success: true, providerMessageId: result.messageId };
    } catch (err: any) {
      console.error(`[OTP] WhatsApp send error to ${masked}: ${err?.message || err}`);
      return { success: false, error: err?.message || 'whatsapp_send_failed' };
    }
  }
}
