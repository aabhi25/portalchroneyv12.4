import crypto from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import { storage } from '../../storage';
import { db } from '../../db';
import type { PhoneOtpChallenge } from '@shared/schema';
import { messagingCredentials } from '@shared/schema';
import { safeDecrypt } from '../encryptionService';
import { OTP_CONSTANTS, type OtpProvider } from './types';
import { NoopOtpProvider } from './noopProvider';
import { Msg91OtpProvider } from './msg91Provider';
import { WhatsAppOtpProvider } from './whatsappProvider';
import { whatsappSettings } from '@shared/schema';

export { OTP_CONSTANTS } from './types';
export type { OtpProvider } from './types';

// Task #3: OTP delivery channel. Per-business admins choose SMS-only,
// WhatsApp-only, or Both. Visitors with both available choose at the widget.
export type OtpChannel = 'sms' | 'whatsapp';
export type OtpChannelPreference = 'sms' | 'whatsapp' | 'both';

let cachedProvider: OtpProvider | null = null;
let cachedHmacSecret: string | null = null;
let warnedMissingHmac = false;

/**
 * Provider selection contract:
 *   - OTP_PROVIDER explicitly chooses the provider ('msg91' | 'noop'). Defaults to 'msg91'.
 *   - OTP_DEV_MODE=true is REQUIRED for 'noop' to ever ship in NODE_ENV=production.
 *   - When OTP_PROVIDER=msg91 but credentials are missing:
 *       * production  -> throw (fail closed; never silently swap to noop)
 *       * non-prod    -> fall back to noop with a loud warning (dev convenience)
 * This prevents the dangerous failure mode where missing secrets silently
 * disable real SMS sends in production.
 */
/**
 * Resolve a per-business MSG91 provider from the messaging_credentials table.
 * Returns null if no row exists or required fields are missing. Callers
 * fall back to the platform-level env provider via getProvider().
 *
 * Per-business creds always win when complete. They are NOT cached because
 * (a) admins can rotate them at any time and (b) instantiation cost is
 * negligible (one object alloc).
 */
async function resolveProviderForBusiness(businessAccountId: string): Promise<OtpProvider | null> {
  try {
    const rows = await db
      .select()
      .from(messagingCredentials)
      .where(and(
        eq(messagingCredentials.businessAccountId, businessAccountId),
        eq(messagingCredentials.provider, 'msg91'),
      ))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (!row.msg91AuthKeyEncrypted || !row.msg91SenderId || !row.msg91TemplateId) {
      return null;
    }
    const authKey = safeDecrypt(row.msg91AuthKeyEncrypted);
    if (!authKey) return null;
    return new Msg91OtpProvider({
      authKey,
      senderId: row.msg91SenderId,
      templateId: row.msg91TemplateId,
    });
  } catch (err: any) {
    console.error(`[OTP] Failed to resolve per-business MSG91 creds for ${businessAccountId}: ${err?.message || err}`);
    return null;
  }
}

/**
 * Task #3: per-business WhatsApp OTP provider. Requires:
 *   - whatsapp_settings row with msg91AuthKey + msg91IntegratedNumberId
 *   - messaging_credentials.whatsappOtpTemplateName (admin-configured)
 * Returns null when any piece is missing.
 */
async function resolveWhatsAppProviderForBusiness(businessAccountId: string): Promise<WhatsAppOtpProvider | null> {
  try {
    const creds = await db
      .select()
      .from(messagingCredentials)
      .where(and(
        eq(messagingCredentials.businessAccountId, businessAccountId),
        eq(messagingCredentials.provider, 'msg91'),
      ))
      .limit(1);
    const templateName = creds[0]?.whatsappOtpTemplateName?.trim();
    if (!templateName) return null;

    const wa = await db
      .select()
      .from(whatsappSettings)
      .where(eq(whatsappSettings.businessAccountId, businessAccountId))
      .limit(1);
    if (!wa[0]?.msg91AuthKey || !wa[0]?.msg91IntegratedNumberId) return null;

    return new WhatsAppOtpProvider({ businessAccountId, templateName });
  } catch (err: any) {
    console.error(`[OTP] Failed to resolve per-business WhatsApp creds for ${businessAccountId}: ${err?.message || err}`);
    return null;
  }
}

/**
 * Task #3: read per-business channel preference (defaults to 'sms' for
 * backward compatibility — businesses without the column set keep behaving
 * exactly as before).
 */
async function getChannelPreference(businessAccountId: string): Promise<OtpChannelPreference> {
  try {
    const rows = await db
      .select({ pref: messagingCredentials.otpChannelPreference })
      .from(messagingCredentials)
      .where(and(
        eq(messagingCredentials.businessAccountId, businessAccountId),
        eq(messagingCredentials.provider, 'msg91'),
      ))
      .limit(1);
    const pref = rows[0]?.pref;
    if (pref === 'whatsapp' || pref === 'both') return pref;
    return 'sms';
  } catch {
    return 'sms';
  }
}

/**
 * Demo / Sample OTP mode (per-business). When the admin enables
 * `mobile.otpDemoMode` in leadTrainingConfig, OTP verification is switched ON
 * WITHOUT any real SMS/WhatsApp provider so the flow can be demoed to clients.
 * In this mode the system issues a FIXED sample code and never sends a real
 * message. INTENTIONALLY INSECURE — the code is public; for demos only.
 */
export const DEMO_OTP_CODE = '111111';

export async function isDemoModeEnabled(businessAccountId: string): Promise<boolean> {
  try {
    const ws = await storage.getWidgetSettings(businessAccountId);
    const cfg = ws?.leadTrainingConfig as any;
    const mobileField = cfg?.fields?.find?.((f: any) => f.id === 'mobile');
    return (
      mobileField?.enabled === true &&
      mobileField?.otpEnabled === true &&
      mobileField?.otpDemoMode === true
    );
  } catch {
    return false;
  }
}

/**
 * Task #3: which channels are *effectively available* (configured) for this
 * business, filtered by admin preference. Returned ordered: preferred-first.
 */
export async function getAvailableChannels(businessAccountId: string): Promise<{ channels: OtpChannel[]; preference: OtpChannelPreference }> {
  // Demo/sample OTP overrides real provider detection: synthesize a single
  // 'sms'-labelled channel so the gate activates with NO real credentials.
  // Actual sending is skipped in issueChallenge/resend when demo mode is on.
  if (await isDemoModeEnabled(businessAccountId)) {
    return { channels: ['sms'], preference: 'sms' };
  }
  const [pref, smsOk, waOk] = await Promise.all([
    getChannelPreference(businessAccountId),
    (async () => {
      const perBiz = await resolveProviderForBusiness(businessAccountId);
      if (perBiz) return true;
      return !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER_ID && process.env.MSG91_TEMPLATE_ID);
    })(),
    (async () => !!(await resolveWhatsAppProviderForBusiness(businessAccountId)))(),
  ]);

  const channels: OtpChannel[] = [];
  if (pref === 'sms') {
    if (smsOk) channels.push('sms');
  } else if (pref === 'whatsapp') {
    if (waOk) channels.push('whatsapp');
  } else {
    // 'both' — list WhatsApp first only if it's the visitor-default; otherwise SMS first.
    if (smsOk) channels.push('sms');
    if (waOk) channels.push('whatsapp');
  }
  return { channels, preference: pref };
}

/**
 * Resolve the provider to use for a send. Channel-aware:
 *   - 'sms'      -> per-business MSG91 → env MSG91 → noop (dev only)
 *   - 'whatsapp' -> per-business WhatsApp provider (no env fallback exists)
 * Returns null when the requested channel is not configured — callers MUST
 * handle this (don't silently route to the other channel; visitors picked one).
 */
async function resolveProviderForChannel(
  businessAccountId: string,
  channel: OtpChannel,
): Promise<OtpProvider | null> {
  if (channel === 'whatsapp') {
    return await resolveWhatsAppProviderForBusiness(businessAccountId);
  }
  const perBiz = await resolveProviderForBusiness(businessAccountId);
  if (perBiz) return perBiz;
  // Env fallback (and dev noop) lives in getProvider().
  try {
    return getProvider();
  } catch {
    return null;
  }
}

/**
 * Task #3: pick the default channel for a send when the caller doesn't
 * specify one (e.g. legacy autoDetect path). Honours admin preference and
 * availability. Returns 'sms' as final fallback.
 */
async function pickDefaultChannel(businessAccountId: string): Promise<OtpChannel> {
  const { channels } = await getAvailableChannels(businessAccountId);
  return channels[0] || 'sms';
}

function getProvider(): OtpProvider {
  if (cachedProvider) return cachedProvider;
  const isProd = process.env.NODE_ENV === 'production';
  const devMode = process.env.OTP_DEV_MODE === 'true';
  const choice = (process.env.OTP_PROVIDER || 'msg91').toLowerCase();

  if (choice === 'noop') {
    if (isProd && !devMode) {
      throw new Error('[OTP] Refusing to use noop provider in production. Set OTP_PROVIDER=msg91 with MSG91_* credentials, or explicitly set OTP_DEV_MODE=true (NOT recommended in prod).');
    }
    cachedProvider = new NoopOtpProvider();
    console.warn('[OTP] Provider: noop (explicit OTP_PROVIDER=noop). No real SMS will be sent.');
    return cachedProvider;
  }

  if (choice === 'msg91') {
    const authKey = process.env.MSG91_AUTH_KEY;
    const senderId = process.env.MSG91_SENDER_ID;
    const templateId = process.env.MSG91_TEMPLATE_ID;
    if (authKey && senderId && templateId) {
      cachedProvider = new Msg91OtpProvider({ authKey, senderId, templateId });
      console.log('[OTP] Provider: MSG91');
      return cachedProvider;
    }
    if (isProd) {
      throw new Error('[OTP] OTP_PROVIDER=msg91 but MSG91_AUTH_KEY/MSG91_SENDER_ID/MSG91_TEMPLATE_ID are not all set. Refusing to silently fall back to noop in production. Configure MSG91 secrets or set OTP_PROVIDER=noop with OTP_DEV_MODE=true (development only).');
    }
    cachedProvider = new NoopOtpProvider();
    console.warn('[OTP] Provider: noop (MSG91 credentials missing in non-prod). Codes are NOT sent over SMS. Set MSG91_* env vars to enable real delivery.');
    return cachedProvider;
  }

  throw new Error(`[OTP] Unknown OTP_PROVIDER='${choice}'. Expected 'msg91' or 'noop'.`);
}

// Per-phone+business rate limit (anti-abuse): max 5 issued challenges per rolling hour.
const MAX_CHALLENGES_PER_PHONE_PER_HOUR = 5;
// Per-business rolling-hour bucket cap (Task #14). Configurable in code.
const MAX_OTP_PER_BUSINESS_PER_HOUR = 100;

function getHmacSecret(): string {
  if (cachedHmacSecret) return cachedHmacSecret;
  const envSecret = process.env.OTP_HMAC_SECRET;
  if (envSecret && envSecret.length >= 16) {
    cachedHmacSecret = envSecret;
  } else {
    // Fail closed in production — an ephemeral secret would invalidate every
    // active OTP on each restart and erodes the integrity guarantee the HMAC
    // is supposed to provide (Task #14 spec: OTP_HMAC_SECRET is required env).
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[OTP] OTP_HMAC_SECRET is required in production (>=16 chars). Refusing to start OTP service with an ephemeral secret.');
    }
    if (!warnedMissingHmac) {
      console.warn('[OTP] OTP_HMAC_SECRET not set (or too short). Generating ephemeral runtime secret — codes will be invalidated on restart. Set OTP_HMAC_SECRET for production.');
      warnedMissingHmac = true;
    }
    cachedHmacSecret = crypto.randomBytes(32).toString('hex');
  }
  return cachedHmacSecret;
}

function hashCode(code: string): string {
  return crypto.createHmac('sha256', getHmacSecret()).update(code).digest('hex');
}

function generateNumericCode(length: number): string {
  // Cryptographically random digits
  const buf = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += (buf[i] % 10).toString();
  return out;
}

export function normalizePhone(raw: string): string {
  if (!raw) return '';
  let trimmed = raw.trim();
  // Strip everything except digits and a leading +
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (hasPlus) return `+${digits}`;
  // Default India country code for 10-digit local numbers
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

export function maskPhone(phoneE164: string): string {
  if (!phoneE164) return '';
  // Format: keep leading country code (if E.164 starts with '+'), mask middle
  // digits, keep last 4 digits visible. Examples:
  //   +919876543210 → "+91 ••••• 3210"
  //   9876543210    → "•••••• 3210"
  const tail = phoneE164.slice(-4);
  if (phoneE164.startsWith('+')) {
    const ccMatch = phoneE164.match(/^(\+\d{1,3})/);
    const cc = ccMatch ? ccMatch[1] : '+';
    const middleLen = Math.max(0, phoneE164.length - cc.length - 4);
    return `${cc} ${'•'.repeat(Math.max(3, middleLen))} ${tail}`;
  }
  const middleLen = Math.max(0, phoneE164.length - 4);
  return `${'•'.repeat(Math.max(3, middleLen))} ${tail}`;
}

export interface OtpStateSnapshot {
  awaiting_otp: boolean;
  locked: boolean;
  phone_masked?: string;
  expires_at?: string;
  locked_until?: string;
  attempts_remaining?: number;
  resends_remaining?: number;
  resend_available_at?: string;
  // Task #23: synthesized in the /stream awaiting_verification refusal path
  // when the gate is set but no real challenge has been issued yet (older
  // cached widget bundles that skipped /otp/start). Signals to clients that
  // the visitor must complete the pre-chat phone-entry flow before chatting.
  gate_required?: boolean;
}

/**
 * Task #23: Compute whether the pre-chat OTP gate is active for a business.
 * The gate is ON when ALL of these are true:
 *   - widget settings: leadTrainingConfig.fields[mobile].enabled === true
 *   - mobile.captureStrategy === 'start'
 *   - mobile.otpEnabled === true
 *   - MSG91 provider effectively configured (per-biz row OR env fallback)
 * This combination is the opt-in: no new admin toggle is added.
 * Fails open (returns active=false) on any lookup error so a transient DB
 * blip never silently locks every visitor out of every chat widget.
 */
export async function derivePreChatOtpGate(
  businessAccountId: string,
): Promise<{
  active: boolean;
  phoneValidation: '10' | '12' | '8-12' | 'any';
  // Task #3: channels exposed to the widget so the pre-chat phone modal can
  // render a SMS/WhatsApp toggle when both are available.
  otpChannels: OtpChannel[];
  defaultOtpChannel: OtpChannel;
  // Demo/sample OTP mode active for this gate (fixed code, no real send).
  demoMode: boolean;
}> {
  try {
    const ws = await storage.getWidgetSettings(businessAccountId);
    const cfg = ws?.leadTrainingConfig as any;
    const mobileField = cfg?.fields?.find?.((f: any) => f.id === 'mobile');
    const phoneValidation = (mobileField?.phoneValidation as any) || '10';
    const demoMode = mobileField?.otpDemoMode === true;
    if (
      !mobileField?.enabled ||
      mobileField?.captureStrategy !== 'start' ||
      mobileField?.otpEnabled !== true
    ) {
      return { active: false, phoneValidation, otpChannels: [], defaultOtpChannel: 'sms', demoMode: false };
    }
    const { channels } = await getAvailableChannels(businessAccountId);
    return {
      active: channels.length > 0,
      phoneValidation,
      otpChannels: channels,
      defaultOtpChannel: channels[0] || 'sms',
      demoMode,
    };
  } catch (err) {
    console.error('[OTP Gate] derivePreChatOtpGate lookup failed (fail-open):', err);
    return { active: false, phoneValidation: '10', otpChannels: [], defaultOtpChannel: 'sms', demoMode: false };
  }
}

/**
 * Pre-chat CAPTCHA gate (Google reCAPTCHA v2) — the alternative to the OTP gate
 * for the mobile-number capture step. Active when ALL of:
 *   - mobile.enabled
 *   - mobile.captureStrategy === 'start'
 *   - mobile.captchaEnabled === true
 *   - mobile.otpEnabled !== true (mutual exclusivity; OTP wins if both set)
 *
 * IMPORTANT — fail CLOSED on misconfiguration: once an admin has *chosen*
 * CAPTCHA, the gate stays `active: true` even when the site key or secret key
 * is missing/undecryptable. In that case `misconfigured: true` so the widget
 * surfaces an explicit "verification unavailable" state and the chat stays
 * LOCKED. The previous behaviour (active=false on missing keys) silently
 * disabled verification and unlocked the chat — an anti-bot bypass — so we
 * never do that here. We still fail OPEN (active=false) on an unexpected DB
 * lookup error so a transient blip can't lock every widget.
 */
/**
 * Strategy-AGNOSTIC view of the CAPTCHA method for a business: "is CAPTCHA the
 * chosen verification method for the mobile field, and is it configured?" —
 * WITHOUT the captureStrategy === 'start' restriction. This powers BOTH the
 * pre-chat gate (start) AND the mid-chat challenge (custom/intent/keyword),
 * where the visitor types their number conversationally and the widget must
 * still render the reCAPTCHA checkbox before the chat continues.
 *
 * `enabled` mirrors the gate's opt-in: captchaEnabled && !otpEnabled (OTP wins
 * if both set). `misconfigured` is true when CAPTCHA is chosen but the site or
 * secret key is missing (callers must fail CLOSED — keep the chat locked and
 * surface an "unavailable" notice, never silently unlock).
 */
export async function deriveCaptchaMethodConfig(
  businessAccountId: string,
): Promise<{
  enabled: boolean;
  misconfigured: boolean;
  phoneValidation: '10' | '12' | '8-12' | 'any';
  provider: 'recaptcha_v2' | null;
  siteKey: string | null;
  captureStrategy: string | null;
}> {
  try {
    const ws = await storage.getWidgetSettings(businessAccountId);
    const cfg = ws?.leadTrainingConfig as any;
    const mobileField = cfg?.fields?.find?.((f: any) => f.id === 'mobile');
    const phoneValidation = (mobileField?.phoneValidation as any) || '10';
    const captureStrategy = (mobileField?.captureStrategy as any) ?? null;
    if (
      !mobileField?.enabled ||
      mobileField?.captchaEnabled !== true ||
      mobileField?.otpEnabled === true // mutual exclusivity: OTP takes precedence if both set
    ) {
      return { enabled: false, misconfigured: false, phoneValidation, provider: null, siteKey: null, captureStrategy };
    }
    const provider = (mobileField?.captchaProvider as any) || 'recaptcha_v2';
    const siteKey = (mobileField?.captchaSiteKey || '').trim();
    const secretConfigured = !!(ws?.captchaSecretKeyEnc && ws.captchaSecretKeyEnc.trim());
    // CAPTCHA was selected → the method is enabled. If keys are missing it is
    // enabled-but-misconfigured (chat stays locked, widget shows "unavailable").
    const misconfigured = !siteKey || !secretConfigured;
    return { enabled: true, misconfigured, phoneValidation, provider, siteKey: siteKey || null, captureStrategy };
  } catch (err) {
    console.error('[CAPTCHA] deriveCaptchaMethodConfig lookup failed (fail-open):', err);
    return { enabled: false, misconfigured: false, phoneValidation: '10', provider: null, siteKey: null, captureStrategy: null };
  }
}

export async function derivePreChatCaptchaGate(
  businessAccountId: string,
): Promise<{
  active: boolean;
  misconfigured: boolean;
  phoneValidation: '10' | '12' | '8-12' | 'any';
  provider: 'recaptcha_v2' | null;
  siteKey: string | null;
}> {
  try {
    const cfg = await deriveCaptchaMethodConfig(businessAccountId);
    // The pre-chat gate is the CAPTCHA method scoped to the 'start' strategy.
    // Other strategies (custom/intent/keyword) use the mid-chat challenge,
    // which keys off deriveCaptchaMethodConfig directly.
    if (!cfg.enabled || cfg.captureStrategy !== 'start') {
      return { active: false, misconfigured: false, phoneValidation: cfg.phoneValidation, provider: null, siteKey: null };
    }
    return { active: true, misconfigured: cfg.misconfigured, phoneValidation: cfg.phoneValidation, provider: cfg.provider, siteKey: cfg.siteKey };
  } catch (err) {
    console.error('[CAPTCHA Gate] derivePreChatCaptchaGate lookup failed (fail-open):', err);
    return { active: false, misconfigured: false, phoneValidation: '10', provider: null, siteKey: null };
  }
}

/**
 * Verify a reCAPTCHA v2 token against Google's siteverify endpoint using the
 * per-business secret key. Returns true only on an unambiguous success. Any
 * network/parse error returns false (fail-closed for verification — a failed
 * verification keeps the chat locked, which is the safe default here).
 */
export async function verifyRecaptchaV2Token(
  secretKey: string,
  token: string,
  remoteIp?: string,
): Promise<{ success: boolean; errorCodes?: string[] }> {
  try {
    const params = new URLSearchParams();
    params.set('secret', secretKey);
    params.set('response', token);
    if (remoteIp) params.set('remoteip', remoteIp);
    const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!resp.ok) {
      console.error('[CAPTCHA] siteverify HTTP error:', resp.status);
      return { success: false, errorCodes: [`http_${resp.status}`] };
    }
    const data = await resp.json() as { success?: boolean; 'error-codes'?: string[] };
    return { success: data.success === true, errorCodes: data['error-codes'] };
  } catch (err) {
    console.error('[CAPTCHA] siteverify request failed:', err);
    return { success: false, errorCodes: ['request_failed'] };
  }
}

export class OtpService {
  /**
   * Look up the latest challenge for a conversation+phone scope (or conversation-only).
   * Used by chatService to derive awaiting_otp / locked_until state.
   */
  static async getLatestStateForConversation(
    businessAccountId: string,
    conversationId: string
  ): Promise<OtpStateSnapshot> {
    const ch = await storage.getLatestOtpChallengeByConversation(businessAccountId, conversationId);
    return this.snapshotFromChallenge(ch);
  }

  static snapshotFromChallenge(ch: PhoneOtpChallenge | undefined | null): OtpStateSnapshot {
    if (!ch) return { awaiting_otp: false, locked: false };
    const now = Date.now();

    // Invalidated challenges (e.g. send_failed) are not actionable — return clean state.
    if (ch.invalidatedAt) {
      return { awaiting_otp: false, locked: false };
    }

    if (ch.lockedUntil && ch.lockedUntil.getTime() > now) {
      return {
        awaiting_otp: false,
        locked: true,
        phone_masked: maskPhone(ch.phoneE164),
        locked_until: ch.lockedUntil.toISOString(),
      };
    }

    if (ch.verifiedAt) {
      return { awaiting_otp: false, locked: false };
    }

    if (ch.expiresAt && ch.expiresAt.getTime() > now) {
      const resendsRemaining = Math.max(0, OTP_CONSTANTS.MAX_RESENDS - (ch.resendCount || 0));
      const attemptsRemaining = Math.max(0, OTP_CONSTANTS.MAX_ATTEMPTS - (ch.attempts || 0));
      const lastSent = ch.lastSentAt ? ch.lastSentAt.getTime() : 0;
      const cooldownEnd = lastSent + OTP_CONSTANTS.RESEND_COOLDOWN_SECONDS * 1000;
      return {
        awaiting_otp: true,
        locked: false,
        phone_masked: maskPhone(ch.phoneE164),
        expires_at: ch.expiresAt.toISOString(),
        attempts_remaining: attemptsRemaining,
        resends_remaining: resendsRemaining,
        resend_available_at: cooldownEnd > now ? new Date(cooldownEnd).toISOString() : new Date(now).toISOString(),
      };
    }

    return { awaiting_otp: false, locked: false };
  }

  /**
   * Task #23: check whether the latest challenge for this (conversation, phone)
   * pair is already verified. Used by autoDetectAndCaptureLead to avoid
   * re-issuing a challenge — and thus re-locking the chat — when the visitor
   * mentions their already-verified phone number again in a later message.
   */
  static async hasVerifiedChallenge(
    businessAccountId: string,
    conversationId: string,
    phoneRaw: string,
  ): Promise<boolean> {
    const phoneE164 = normalizePhone(phoneRaw);
    if (!phoneE164) return false;
    const latest = await storage.getLatestOtpChallengeByConversation(businessAccountId, conversationId);
    return !!(latest?.verifiedAt && latest.phoneE164 === phoneE164);
  }

  /**
   * Issue a new OTP challenge for the (conversation, phone) scope.
   * If an active (unverified) challenge for this scope exists and is not yet expired,
   * we return that state without creating a new code (idempotent).
   */
  static async issueChallenge(
    businessAccountId: string,
    conversationId: string,
    phoneRaw: string,
    opts?: { leadId?: string | null; channelOrigin?: string | null; deliveryChannel?: OtpChannel }
  ): Promise<{ ok: true; snapshot: OtpStateSnapshot; deliveryChannel: OtpChannel } | { ok: false; reason: 'locked' | 'invalid_phone' | 'send_failed' | 'channel_unavailable'; snapshot?: OtpStateSnapshot }> {
    const phoneE164 = normalizePhone(phoneRaw);
    if (!phoneE164 || phoneE164.length < 7) return { ok: false, reason: 'invalid_phone' };

    // Task #23 (race-safety): serialize the entire find-or-create + send path
    // for the same (business, phone) so concurrent callers (e.g. /otp/start +
    // autoDetect typing the same number, or two rapid double-clicks) cannot
    // both pass the reuse check and create duplicate challenges / send two
    // SMS. The lock is held for the duration of this db.transaction; storage
    // writes inside use separate pooled connections, but since each one
    // auto-commits before we exit the txn, caller B sees A's challenge once
    // A's lock-holding txn commits and falls into the reuse branch.
    const lockMaterial = `otp-issue|${businessAccountId}|${phoneE164}`;
    const sha = crypto.createHash('sha256').update(lockMaterial).digest();
    let lockKey = 0n;
    for (let i = 0; i < 8; i++) lockKey = (lockKey << 8n) | BigInt(sha[i]);
    if (lockKey >= 1n << 63n) lockKey -= 1n << 64n;
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey.toString()}::bigint)`);
      return await this.issueChallengeLocked(businessAccountId, conversationId, phoneE164, opts);
    });
  }

  private static async issueChallengeLocked(
    businessAccountId: string,
    conversationId: string,
    phoneE164: string,
    opts?: { leadId?: string | null; channelOrigin?: string | null; deliveryChannel?: OtpChannel }
  ): Promise<{ ok: true; snapshot: OtpStateSnapshot; deliveryChannel: OtpChannel } | { ok: false; reason: 'locked' | 'invalid_phone' | 'send_failed' | 'channel_unavailable'; snapshot?: OtpStateSnapshot }> {
    // Task #3: resolve delivery channel. Caller can pin a specific channel
    // (visitor pick at the widget) — otherwise fall back to admin's
    // preferred-available channel.
    const { channels } = await getAvailableChannels(businessAccountId);
    let deliveryChannel: OtpChannel;
    if (opts?.deliveryChannel) {
      if (!channels.includes(opts.deliveryChannel)) {
        return { ok: false, reason: 'channel_unavailable' };
      }
      deliveryChannel = opts.deliveryChannel;
    } else {
      deliveryChannel = channels[0] || 'sms';
    }
    // Lockout check — STRICTLY per (conversationId, phoneE164) per Task #14 spec.
    // We do NOT block the conversation when the latest record was for a DIFFERENT
    // phone, so a visitor whose first attempt locked out can still retry with a
    // corrected number during the 15-min cooldown.
    const latest = await storage.getLatestOtpChallengeByConversation(businessAccountId, conversationId);
    const now = Date.now();
    if (
      latest?.lockedUntil &&
      latest.lockedUntil.getTime() > now &&
      latest.phoneE164 === phoneE164
    ) {
      return { ok: false, reason: 'locked', snapshot: this.snapshotFromChallenge(latest) };
    }

    // Phone-scope lockout (anti-abuse): an attacker rotating conversationIds against
    // the same phone is still blocked while that phone is locked.
    const phoneLatest = await storage.getLatestOtpChallengeByPhone(businessAccountId, phoneE164);
    if (phoneLatest?.lockedUntil && phoneLatest.lockedUntil.getTime() > now) {
      return { ok: false, reason: 'locked', snapshot: this.snapshotFromChallenge(phoneLatest) };
    }

    // Anti-abuse: per-BUSINESS rolling-hour bucket cap (Task #14 — protects against
    // a single business account being weaponized to spam SMS at the provider).
    // Configurable in code via MAX_OTP_PER_BUSINESS_PER_HOUR below.
    const windowStart = new Date(now - 60 * 60 * 1000);
    const businessCount = await storage.countOtpChallengesByBusinessSince(businessAccountId, windowStart);
    if (businessCount >= MAX_OTP_PER_BUSINESS_PER_HOUR) {
      return {
        ok: false,
        reason: 'locked',
        snapshot: {
          awaiting_otp: false,
          locked: true,
          phone_masked: maskPhone(phoneE164),
          locked_until: new Date(now + 60 * 60 * 1000).toISOString(),
        },
      };
    }

    // Anti-abuse: per-phone per-business rolling-hour cap (Task #14 requirement).
    // If reached, present as a soft lockout for the remainder of the rolling window.
    const sentInWindow = await storage.countOtpChallengesByPhoneSince(businessAccountId, phoneE164, windowStart);
    if (sentInWindow >= MAX_CHALLENGES_PER_PHONE_PER_HOUR) {
      const oldest = await storage.getOldestOtpChallengeByPhoneSince(businessAccountId, phoneE164, windowStart);
      const lockedUntilTs = (oldest?.createdAt?.getTime() || now) + 60 * 60 * 1000;
      const snapshot: OtpStateSnapshot = {
        awaiting_otp: false,
        locked: true,
        phone_masked: maskPhone(phoneE164),
        locked_until: new Date(lockedUntilTs).toISOString(),
      };
      console.warn(`[OTP] Per-phone rate limit hit for ${maskPhone(phoneE164)} (business=${businessAccountId}): ${sentInWindow} challenges in last hour`);
      return { ok: false, reason: 'locked', snapshot };
    }

    // Reuse active unverified challenge for same phone+conversation.
    // CRITICAL: exclude invalidated rows (e.g. prior send_failed) so we don't
    // return ok:true with a non-actionable snapshot.
    if (
      latest &&
      !latest.verifiedAt &&
      !latest.invalidatedAt &&
      latest.phoneE164 === phoneE164 &&
      latest.expiresAt &&
      latest.expiresAt.getTime() > now
    ) {
      const reuseSnap = this.snapshotFromChallenge(latest);
      if (reuseSnap.awaiting_otp || reuseSnap.locked) {
        // Honour the existing challenge's recorded channel so the modal
        // subtitle ("Code sent via …") stays accurate on reuse.
        const existingChannel = (latest.deliveryChannel as OtpChannel) || deliveryChannel;
        return { ok: true, snapshot: reuseSnap, deliveryChannel: existingChannel };
      }
      // Otherwise fall through and issue a fresh challenge.
    }

    const demoMode = await isDemoModeEnabled(businessAccountId);
    const code = demoMode ? DEMO_OTP_CODE : generateNumericCode(OTP_CONSTANTS.CODE_LENGTH);
    const codeHash = hashCode(code);
    const sentAt = new Date();
    const expiresAt = new Date(sentAt.getTime() + OTP_CONSTANTS.EXPIRY_SECONDS * 1000);

    const created = await storage.createOtpChallenge({
      businessAccountId,
      conversationId,
      leadId: opts?.leadId ?? null,
      channelOrigin: opts?.channelOrigin ?? null,
      deliveryChannel,
      phoneE164,
      codeHash,
      attempts: 0,
      resendCount: 0,
      lastSentAt: sentAt,
      expiresAt,
      verifiedAt: null,
      lockedUntil: null,
    });

    if (demoMode) {
      // Demo/sample OTP: never send a real message. The fixed sample code is
      // already stored (hashed) so the existing verify path works unchanged.
      await storage.recordOtpChallengeSent(created.id, `demo-${Date.now()}`);
      return { ok: true, snapshot: this.snapshotFromChallenge(created), deliveryChannel };
    }

    const provider = await resolveProviderForChannel(businessAccountId, deliveryChannel);
    if (!provider) {
      await storage.invalidateOtpChallenge(created.id, 'channel_unavailable');
      return { ok: false, reason: 'channel_unavailable', snapshot: { awaiting_otp: false, locked: false } };
    }
    const send = await provider.sendOtp(phoneE164, code);
    if (!send.success) {
      // CRITICAL: invalidate the just-created row so subsequent snapshot calls do
      // NOT report awaiting_otp=true. Without invalidation, the unsent challenge
      // would remain "active" (unverified + unexpired), strand-locking the widget
      // in numeric-only OTP mode and the AI in strict OTP-tools-only mode even
      // though no code was actually delivered. The visitor can re-trigger send
      // either via `resend_phone_otp` (which will see invalidatedAt and treat
      // as no_active_challenge → next capture_lead can re-issue) or by typing
      // their phone again.
      await storage.invalidateOtpChallenge(created.id, 'send_failed');
      return { ok: false, reason: 'send_failed', snapshot: { awaiting_otp: false, locked: false } };
    }
    if (send.providerMessageId) {
      await storage.recordOtpChallengeSent(created.id, send.providerMessageId);
    }
    return { ok: true, snapshot: this.snapshotFromChallenge(created), deliveryChannel };
  }

  /**
   * Resend the active code for a (conversation, phone) scope.
   * Enforces 60s cooldown and 3 resend cap.
   */
  static async resend(
    businessAccountId: string,
    conversationId: string,
    opts?: { deliveryChannel?: OtpChannel }
  ): Promise<{ ok: true; snapshot: OtpStateSnapshot; deliveryChannel: OtpChannel } | { ok: false; reason: 'no_active_challenge' | 'cooldown' | 'max_resends' | 'locked' | 'send_failed' | 'channel_unavailable'; snapshot?: OtpStateSnapshot; retry_after_seconds?: number }> {
    const ch = await storage.getLatestOtpChallengeByConversation(businessAccountId, conversationId);
    const now = Date.now();
    if (!ch) return { ok: false, reason: 'no_active_challenge' };
    if (ch.lockedUntil && ch.lockedUntil.getTime() > now) {
      return { ok: false, reason: 'locked', snapshot: this.snapshotFromChallenge(ch) };
    }
    if (ch.verifiedAt) return { ok: false, reason: 'no_active_challenge' };
    // Invalidated challenges (e.g. prior send_failed) are not resendable —
    // visitor must re-trigger via capture_lead which will issue a fresh challenge.
    if (ch.invalidatedAt) return { ok: false, reason: 'no_active_challenge' };
    if (ch.expiresAt && ch.expiresAt.getTime() <= now) return { ok: false, reason: 'no_active_challenge' };

    const resendCount = ch.resendCount || 0;
    if (resendCount >= OTP_CONSTANTS.MAX_RESENDS) {
      return { ok: false, reason: 'max_resends', snapshot: this.snapshotFromChallenge(ch) };
    }
    const lastSent = ch.lastSentAt ? ch.lastSentAt.getTime() : 0;
    const cooldownEnd = lastSent + OTP_CONSTANTS.RESEND_COOLDOWN_SECONDS * 1000;
    if (cooldownEnd > now) {
      return {
        ok: false,
        reason: 'cooldown',
        snapshot: this.snapshotFromChallenge(ch),
        retry_after_seconds: Math.ceil((cooldownEnd - now) / 1000),
      };
    }

    // Task #3: resend channel = caller override (visitor "try other instead")
    // or the channel originally used for this challenge, or admin default.
    const { channels } = await getAvailableChannels(businessAccountId);
    let deliveryChannel: OtpChannel;
    if (opts?.deliveryChannel) {
      if (!channels.includes(opts.deliveryChannel)) {
        return { ok: false, reason: 'channel_unavailable', snapshot: this.snapshotFromChallenge(ch) };
      }
      deliveryChannel = opts.deliveryChannel;
    } else if (ch.deliveryChannel === 'whatsapp' || ch.deliveryChannel === 'sms') {
      deliveryChannel = ch.deliveryChannel as OtpChannel;
    } else {
      deliveryChannel = channels[0] || 'sms';
    }

    const demoMode = await isDemoModeEnabled(businessAccountId);
    const code = demoMode ? DEMO_OTP_CODE : generateNumericCode(OTP_CONSTANTS.CODE_LENGTH);
    const codeHash = hashCode(code);
    const sentAt = new Date();
    const expiresAt = new Date(sentAt.getTime() + OTP_CONSTANTS.EXPIRY_SECONDS * 1000);

    // Send FIRST. Only persist new code/cooldown after a successful provider
    // response, so a provider error doesn't burn a resend slot or start a
    // 60s cooldown clock against the user (Task #14 reliability requirement).
    let providerMessageId: string | null = null;
    if (demoMode) {
      // Demo/sample OTP: skip real send; the fixed sample code is reused.
      providerMessageId = `demo-${Date.now()}`;
    } else {
      const provider = await resolveProviderForChannel(businessAccountId, deliveryChannel);
      if (!provider) {
        return { ok: false, reason: 'channel_unavailable', snapshot: this.snapshotFromChallenge(ch) };
      }
      const send = await provider.sendOtp(ch.phoneE164, code);
      if (!send.success) {
        return { ok: false, reason: 'send_failed', snapshot: this.snapshotFromChallenge(ch) };
      }
      providerMessageId = send.providerMessageId ?? null;
    }

    const updated = await storage.updateOtpChallengeForResend(ch.id, {
      codeHash,
      lastSentAt: sentAt,
      expiresAt,
      resendCount: resendCount + 1,
      attempts: 0, // reset attempts on resend
      deliveryChannel,
      providerMessageId,
    });

    return { ok: true, snapshot: this.snapshotFromChallenge(updated), deliveryChannel };
  }

  /**
   * Verify a submitted code against the active challenge.
   * Returns verified=true on success (and marks the challenge verified + clears state).
   * On wrong code: increments attempts; on 3rd wrong attempt sets lockedUntil = now+15m.
   */
  static async verify(
    businessAccountId: string,
    conversationId: string,
    submittedCode: string
  ): Promise<{ verified: true; phoneE164: string; snapshot: OtpStateSnapshot } | { verified: false; reason: 'no_active_challenge' | 'expired' | 'locked' | 'wrong_code' | 'invalid_format'; snapshot: OtpStateSnapshot }> {
    const cleaned = (submittedCode || '').replace(/[^\d]/g, '');
    if (cleaned.length !== OTP_CONSTANTS.CODE_LENGTH) {
      const ch = await storage.getLatestOtpChallengeByConversation(businessAccountId, conversationId);
      return { verified: false, reason: 'invalid_format', snapshot: this.snapshotFromChallenge(ch) };
    }

    const ch = await storage.getLatestOtpChallengeByConversation(businessAccountId, conversationId);
    const now = Date.now();
    if (!ch || ch.verifiedAt) {
      return { verified: false, reason: 'no_active_challenge', snapshot: this.snapshotFromChallenge(ch) };
    }
    // Mirror resend policy: an invalidated challenge (e.g. prior send_failed)
    // is not verifiable — visitor must re-trigger via capture_lead to issue a
    // fresh challenge. Treat as no_active_challenge for consistent UX.
    if (ch.invalidatedAt) {
      return { verified: false, reason: 'no_active_challenge', snapshot: this.snapshotFromChallenge(ch) };
    }
    if (ch.lockedUntil && ch.lockedUntil.getTime() > now) {
      return { verified: false, reason: 'locked', snapshot: this.snapshotFromChallenge(ch) };
    }
    if (!ch.expiresAt || ch.expiresAt.getTime() <= now) {
      return { verified: false, reason: 'expired', snapshot: this.snapshotFromChallenge(ch) };
    }

    const submittedHash = hashCode(cleaned);
    // timing-safe compare
    const a = Buffer.from(submittedHash, 'hex');
    const b = Buffer.from(ch.codeHash, 'hex');
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (match) {
      // Task #18: clear awaitingVerification BEFORE marking the challenge
      // verified. If clearing fails we let the error propagate (no fail-open):
      // the visitor sees a server error, the challenge stays active, and on
      // retry the same code path re-attempts the clear and only then marks the
      // challenge verified. This guarantees we never end up in a "verified
      // challenge but conversation still flagged pending" state, which would
      // cause the sweep to delete a truly-verified conversation.
      await storage.clearConversationAwaitingVerification(conversationId, businessAccountId);
      const updated = await storage.markOtpChallengeVerified(ch.id);
      return { verified: true, phoneE164: ch.phoneE164, snapshot: this.snapshotFromChallenge(updated) };
    }

    const newAttempts = (ch.attempts || 0) + 1;
    if (newAttempts >= OTP_CONSTANTS.MAX_ATTEMPTS) {
      const lockedUntil = new Date(now + OTP_CONSTANTS.LOCKOUT_SECONDS * 1000);
      const locked = await storage.updateOtpChallengeAttempts(ch.id, newAttempts, lockedUntil, 'max_attempts');
      return { verified: false, reason: 'locked', snapshot: this.snapshotFromChallenge(locked) };
    }
    const updated = await storage.updateOtpChallengeAttempts(ch.id, newAttempts, null, 'wrong_code');
    return { verified: false, reason: 'wrong_code', snapshot: this.snapshotFromChallenge(updated) };
  }

  /**
   * Fire a one-off OTP-style SMS for admin "Send test SMS" — bypasses challenge
   * persistence, rate limits, and conversation state. Uses the same provider
   * resolution (per-business creds preferred, env fallback) so the test
   * reflects what real visitors would receive. Returns the provider's raw
   * response so the admin can debug DLT/template misconfiguration.
   */
  /**
   * Task #23: Is the OTP provider effectively configured for this business?
   * Mirrors `effectivelyConfigured` from /api/admin/otp-settings: per-business
   * MSG91 row with decryptable auth key + sender + template, OR the env-level
   * fallback. Used by the pre-chat gate to decide whether to require OTP.
   */
  static async isProviderConfigured(businessAccountId: string): Promise<boolean> {
    const { channels } = await getAvailableChannels(businessAccountId);
    return channels.length > 0;
  }

  /**
   * Task #3: detailed channel-availability snapshot used by
   * /api/admin/otp-settings GET response so the admin UI can show one status
   * pill per channel ("Sender ready" vs "Not configured") instead of a single
   * combined flag.
   */
  static async getChannelStatus(businessAccountId: string): Promise<{
    smsBusinessConfigured: boolean;
    smsEnvFallbackConfigured: boolean;
    smsEffectivelyConfigured: boolean;
    whatsappBusinessConfigured: boolean;
    whatsappEffectivelyConfigured: boolean;
    preference: OtpChannelPreference;
    availableChannels: OtpChannel[];
  }> {
    const [smsBiz, waBiz, pref] = await Promise.all([
      resolveProviderForBusiness(businessAccountId),
      resolveWhatsAppProviderForBusiness(businessAccountId),
      getChannelPreference(businessAccountId),
    ]);
    const envOk = !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER_ID && process.env.MSG91_TEMPLATE_ID);
    const smsEff = !!smsBiz || envOk;
    const waEff = !!waBiz;
    const availableChannels: OtpChannel[] = [];
    if (pref === 'sms' || pref === 'both') { if (smsEff) availableChannels.push('sms'); }
    if (pref === 'whatsapp' || pref === 'both') { if (waEff) availableChannels.push('whatsapp'); }
    return {
      smsBusinessConfigured: !!smsBiz,
      smsEnvFallbackConfigured: envOk,
      smsEffectivelyConfigured: smsEff,
      whatsappBusinessConfigured: !!waBiz,
      whatsappEffectivelyConfigured: waEff,
      preference: pref,
      availableChannels,
    };
  }

  static async sendTestSms(
    businessAccountId: string,
    phoneRaw: string,
    opts?: { deliveryChannel?: OtpChannel }
  ): Promise<{ ok: boolean; phoneMasked: string; providerName: string; deliveryChannel: OtpChannel; providerMessageId?: string; error?: string }> {
    const phoneE164 = normalizePhone(phoneRaw);
    const deliveryChannel: OtpChannel = opts?.deliveryChannel === 'whatsapp' ? 'whatsapp' : 'sms';
    if (!phoneE164 || phoneE164.length < 7) {
      return { ok: false, phoneMasked: '', providerName: deliveryChannel, deliveryChannel, error: 'invalid_phone' };
    }
    const provider = await resolveProviderForChannel(businessAccountId, deliveryChannel);
    if (!provider) {
      return { ok: false, phoneMasked: maskPhone(phoneE164), providerName: deliveryChannel, deliveryChannel, error: 'channel_unavailable' };
    }
    const code = generateNumericCode(OTP_CONSTANTS.CODE_LENGTH);
    const send = await provider.sendOtp(phoneE164, code);
    return {
      ok: send.success,
      phoneMasked: maskPhone(phoneE164),
      providerName: provider.name,
      deliveryChannel,
      providerMessageId: send.providerMessageId,
      error: send.error,
    };
  }
}
