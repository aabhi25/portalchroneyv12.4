import type { OtpProvider, OtpSendResult } from './types';

export class NoopOtpProvider implements OtpProvider {
  readonly name = 'noop';

  async sendOtp(phoneE164: string, code: string): Promise<OtpSendResult> {
    const masked = phoneE164.length > 4 ? `***${phoneE164.slice(-4)}` : '***';
    // SECURITY: never log the plaintext OTP code, even in dev. Only log code length + masked phone.
    // Set OTP_DEV_LOG_CODE=1 to opt-in for local development only.
    if (process.env.OTP_DEV_LOG_CODE === '1' && process.env.NODE_ENV !== 'production') {
      console.log(`[OTP] DEV provider: code for ${masked} = ${code} (OTP_DEV_LOG_CODE=1)`);
    } else {
      console.log(`[OTP] DEV provider: dispatched ${code.length}-digit code to ${masked} (code redacted)`);
    }
    return { success: true, providerMessageId: `dev-${Date.now()}` };
  }
}
