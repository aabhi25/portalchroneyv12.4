/**
 * Signed URLs for AI Calling.
 *
 * The provider (Exotel) connects to our media WebSocket and posts status webhooks without
 * a user session, so each URL carries an HMAC that binds it to one call (outbound) or one
 * business (inbound key, stored in ai_calling_settings.inbound_key).
 *
 *   outbound stream : wss://<base>/api/calling/stream/<callId>.<exp>.<sig>?sample-rate=16000
 *   status webhook  : https://<base>/api/calling/webhooks/<provider>/status/<callId>.<exp>.<sig>
 *   inbound stream  : wss://<base>/api/calling/inbound/<inboundKey>?sample-rate=16000
 */
import crypto from "crypto";

export const STREAM_SAMPLE_RATE = 16000;
const TOKEN_TTL_SEC = 24 * 3600; // a queued call may be placed hours after the URL is built

function secret(): string {
  const s = process.env.CALLING_SIGNING_SECRET || process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY;
  if (!s) throw new Error("CALLING_SIGNING_SECRET / SESSION_SECRET is not configured");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 32);
}

/** "<callId>.<exp>.<sig>" — purpose-bound ("stream" | "status"). */
export function signCallToken(callId: string, purpose: "stream" | "status", nowSec = Math.floor(Date.now() / 1000)): string {
  const exp = nowSec + TOKEN_TTL_SEC;
  return `${callId}.${exp}.${sign(`${purpose}:${callId}:${exp}`)}`;
}

/** Returns the callId if the token is valid for `purpose` and not expired, else null. */
export function verifyCallToken(token: string, purpose: "stream" | "status", nowSec = Math.floor(Date.now() / 1000)): string | null {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [callId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!callId || !Number.isFinite(exp) || exp < nowSec) return null;
  const expected = sign(`${purpose}:${callId}:${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return callId;
}

/** A new random inbound key (path secret identifying a business's inbound line). */
export function newInboundKey(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Public https base of this server (no trailing slash), for URLs given to the provider.
 * PUBLIC_BASE_URL wins; else the base captured from the last settings save; else the
 * Replit dev domain. Null when unknown (settings UI asks the user to open the portal
 * from its public address once).
 */
export function resolvePublicBaseUrl(savedBase?: string | null): string | null {
  const fromEnv = process.env.PUBLIC_BASE_URL?.trim();
  const raw = fromEnv || savedBase?.trim() || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function wsBase(httpBase: string): string {
  return httpBase.replace(/^http(s?):\/\//i, (_m, s) => `ws${s}://`);
}

export function buildOutboundStreamUrl(base: string, callId: string): string {
  return `${wsBase(base)}/api/calling/stream/${signCallToken(callId, "stream")}?sample-rate=${STREAM_SAMPLE_RATE}`;
}

export function buildStatusCallbackUrl(base: string, provider: string, callId: string): string {
  return `${base}/api/calling/webhooks/${provider}/status/${signCallToken(callId, "status")}`;
}

export function buildInboundStreamUrl(base: string, inboundKey: string): string {
  return `${wsBase(base)}/api/calling/inbound/${inboundKey}?sample-rate=${STREAM_SAMPLE_RATE}`;
}
