import type { OtpProvider, OtpSendResult } from './types';

export interface Msg91Config {
  authKey: string;
  senderId: string;
  templateId: string;
}

export class Msg91OtpProvider implements OtpProvider {
  readonly name = 'msg91';

  constructor(private readonly cfg: Msg91Config) {}

  async sendOtp(phoneE164: string, code: string): Promise<OtpSendResult> {
    const masked = phoneE164.length > 4 ? `***${phoneE164.slice(-4)}` : '***';
    const mobile = phoneE164.replace(/[^\d]/g, '');

    try {
      const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(
        this.cfg.templateId
      )}&mobile=${encodeURIComponent(mobile)}&otp=${encodeURIComponent(code)}&sender=${encodeURIComponent(
        this.cfg.senderId
      )}`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'authkey': this.cfg.authKey,
          'Content-Type': 'application/json',
          'accept': 'application/json',
        },
      });

      const bodyText = await resp.text();
      let body: any = null;
      try { body = JSON.parse(bodyText); } catch { /* non-json */ }

      if (!resp.ok || (body && body.type && body.type !== 'success')) {
        const errMsg = body?.message || `HTTP ${resp.status}`;
        console.error(`[OTP] MSG91 send failed to ${masked}: ${errMsg}`);
        return { success: false, error: errMsg };
      }

      console.log(`[OTP] MSG91 send OK to ${masked} (request_id=${body?.request_id || 'n/a'})`);
      return { success: true, providerMessageId: body?.request_id };
    } catch (err: any) {
      console.error(`[OTP] MSG91 send error to ${masked}: ${err?.message || err}`);
      return { success: false, error: err?.message || 'send_failed' };
    }
  }
}
