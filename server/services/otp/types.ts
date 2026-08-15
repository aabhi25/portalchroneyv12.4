export interface OtpSendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface OtpProvider {
  readonly name: string;
  sendOtp(phoneE164: string, code: string): Promise<OtpSendResult>;
}

export const OTP_CONSTANTS = {
  CODE_LENGTH: 6,
  EXPIRY_SECONDS: 5 * 60,
  MAX_ATTEMPTS: 3,
  RESEND_COOLDOWN_SECONDS: 60,
  MAX_RESENDS: 3,
  LOCKOUT_SECONDS: 15 * 60,
} as const;
