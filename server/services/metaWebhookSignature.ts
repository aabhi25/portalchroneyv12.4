import crypto from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { decrypt } from "./encryptionService";

/**
 * Meta (Facebook / Instagram) webhook signature verification.
 *
 * Meta signs every webhook POST with the App Secret of the Meta app the Page / IG account is
 * subscribed through: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(rawBody, appSecret)>`.
 *
 * In this product each client connects their own Meta app (they paste the Page / IG token, the
 * verify token and the App Secret into Settings), so the secret is stored per account
 * (`facebook_settings.app_secret` / `instagram_settings.app_secret`, AES-GCM encrypted).
 * A platform-wide secret can also be supplied through the environment (META_APP_SECRET,
 * FACEBOOK_APP_SECRET, INSTAGRAM_APP_SECRET; comma-separated values allowed) for pages connected
 * through a shared platform app. Every available secret is tried.
 *
 * Rollout safety: when no secret is known for the account(s) in a payload, the event is still
 * processed (as before) with a rate-limited warning, unless META_WEBHOOK_REQUIRE_SIGNATURE=true.
 */

const SIGNATURE_PREFIX = "sha256=";
const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const ENCRYPTED_FORMAT = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]*$/i;

/** Constant-time string comparison that never throws on length mismatch. */
export function timingSafeEqualStrings(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Still spend comparable time so length is not trivially observable.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

export function computeMetaSignature(rawBody: Buffer | string, appSecret: string): string {
  return SIGNATURE_PREFIX + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
}

export type MetaSignatureFailure = "no_secret" | "no_raw_body" | "missing_header" | "malformed_header" | "mismatch";

export interface MetaSignatureResult {
  valid: boolean;
  reason?: MetaSignatureFailure;
  /** Index into the secrets array that matched. */
  matchedIndex?: number;
}

/**
 * Verify an `X-Hub-Signature-256` header against the exact raw request body, trying every
 * candidate secret. Comparison is constant-time per candidate.
 */
export function verifyMetaSignature(
  rawBody: Buffer | string | null | undefined,
  signatureHeader: string | string[] | null | undefined,
  secrets: Array<string | null | undefined>,
): MetaSignatureResult {
  const candidates = secrets.filter((s): s is string => typeof s === "string" && s.length > 0);
  if (candidates.length === 0) return { valid: false, reason: "no_secret" };
  if (rawBody === null || rawBody === undefined) return { valid: false, reason: "no_raw_body" };

  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!header || typeof header !== "string") return { valid: false, reason: "missing_header" };

  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith(SIGNATURE_PREFIX)) return { valid: false, reason: "malformed_header" };
  const providedHex = trimmed.slice(SIGNATURE_PREFIX.length);
  if (!HEX_SHA256.test(providedHex)) return { valid: false, reason: "malformed_header" };
  const provided = Buffer.from(providedHex, "hex");

  let matchedIndex = -1;
  for (let i = 0; i < candidates.length; i++) {
    const expected = crypto.createHmac("sha256", candidates[i]).update(rawBody).digest();
    // Both are 32 bytes; do not short-circuit so timing does not reveal which secret matched.
    if (expected.length === provided.length && crypto.timingSafeEqual(expected, provided) && matchedIndex === -1) {
      matchedIndex = i;
    }
  }
  if (matchedIndex >= 0) {
    // Map back to the index in the caller's original array.
    const matched = candidates[matchedIndex];
    return { valid: true, matchedIndex: secrets.indexOf(matched) };
  }
  return { valid: false, reason: "mismatch" };
}

/**
 * Turn a stored app_secret column value into a usable secret. Values written by the services
 * are AES-GCM encrypted (`iv:tag:data` hex); anything else is treated as legacy plaintext.
 * A value that looks encrypted but cannot be decrypted (e.g. ENCRYPTION_KEY changed) is
 * reported as unusable rather than being used verbatim as a secret.
 */
export function resolveStoredAppSecret(stored: string | null | undefined): string | null {
  if (typeof stored !== "string") return null;
  const value = stored.trim();
  if (!value) return null;
  if (ENCRYPTED_FORMAT.test(value) && value.split(":").length === 3) {
    try {
      const plain = decrypt(value);
      return plain && plain.trim() ? plain.trim() : null;
    } catch {
      return null;
    }
  }
  return value;
}

/** Platform-wide Meta app secrets from the environment (deduplicated). */
export function getPlatformMetaAppSecrets(platform?: "facebook" | "instagram"): string[] {
  const names = ["META_APP_SECRET"];
  if (!platform || platform === "facebook") names.push("FACEBOOK_APP_SECRET");
  if (!platform || platform === "instagram") names.push("INSTAGRAM_APP_SECRET");
  const out: string[] = [];
  for (const name of names) {
    const raw = process.env[name];
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const s = part.trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

export function isMetaSignatureRequired(): boolean {
  return (process.env.META_WEBHOOK_REQUIRE_SIGNATURE || "").trim().toLowerCase() === "true";
}

// ---------------------------------------------------------------------------------------------
// Per-account status (in-memory, per instance) so the settings screens can show a warning.
// ---------------------------------------------------------------------------------------------

export interface MetaWebhookSignatureStatus {
  lastVerifiedAt?: string;
  lastFailureAt?: string;
  lastUnsignedAt?: string;
}

const statusByAccount = new Map<string, MetaWebhookSignatureStatus>();

function statusKey(platform: string, businessAccountId: string) {
  return `${platform}:${businessAccountId}`;
}

function markStatus(platform: string, businessAccountId: string, field: keyof MetaWebhookSignatureStatus) {
  const key = statusKey(platform, businessAccountId);
  const current = statusByAccount.get(key) || {};
  current[field] = new Date().toISOString();
  statusByAccount.set(key, current);
  if (statusByAccount.size > 10000) {
    const first = statusByAccount.keys().next().value;
    if (first !== undefined) statusByAccount.delete(first);
  }
}

export function getMetaWebhookSignatureStatus(platform: "facebook" | "instagram", businessAccountId: string): MetaWebhookSignatureStatus {
  return { ...(statusByAccount.get(statusKey(platform, businessAccountId)) || {}) };
}

/**
 * Fields merged into the IG / FB settings GET responses so the UI can warn about a missing
 * (or apparently wrong) App Secret.
 */
export function describeMetaWebhookSignature(
  platform: "facebook" | "instagram",
  businessAccountId: string,
  storedAppSecret: string | null | undefined,
) {
  const appSecretConfigured = !!resolveStoredAppSecret(storedAppSecret);
  const platformSecretConfigured = getPlatformMetaAppSecrets(platform).length > 0;
  const status = getMetaWebhookSignatureStatus(platform, businessAccountId);
  const hasSecret = appSecretConfigured || platformSecretConfigured;
  const failingRecently =
    !!status.lastFailureAt && (!status.lastVerifiedAt || status.lastFailureAt >= status.lastVerifiedAt);
  return {
    webhookSignatureVerified: hasSecret && !failingRecently,
    needsAppSecret: !hasSecret,
    webhookSignature: {
      appSecretConfigured,
      platformSecretConfigured,
      requireSignature: isMetaSignatureRequired(),
      failingRecently,
      ...status,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Express guard
// ---------------------------------------------------------------------------------------------

export interface MetaWebhookAccountLookup {
  businessAccountId: string;
  appSecret: string | null | undefined;
}

export interface MetaWebhookGuardOptions {
  platform: "facebook" | "instagram";
  /** Value of `body.object` this endpoint handles ("page" / "instagram"). */
  expectedObject: string;
  /** Find the connected account for a Page ID / IG account ID. */
  lookupAccount: (accountId: string) => Promise<MetaWebhookAccountLookup | null>;
  getPlatformSecrets?: () => string[];
  requireSignature?: () => boolean;
  logger?: Pick<Console, "warn" | "error">;
}

export interface MetaWebhookVerification {
  verified: boolean;
  businessAccountIds: string[];
}

const MAX_ACCOUNT_IDS = 25;
const WARN_INTERVAL_MS = 60 * 60 * 1000;
const lastWarnAt = new Map<string, number>();

function rateLimitedWarn(logger: Pick<Console, "warn">, key: string, message: string) {
  const now = Date.now();
  const prev = lastWarnAt.get(key);
  if (prev !== undefined && now - prev < WARN_INTERVAL_MS) return;
  lastWarnAt.set(key, now);
  if (lastWarnAt.size > 10000) {
    const first = lastWarnAt.keys().next().value;
    if (first !== undefined) lastWarnAt.delete(first);
  }
  logger.warn(message);
}

/** Test helper: reset rate limiting and status. */
export function __resetMetaWebhookSignatureState() {
  lastWarnAt.clear();
  statusByAccount.clear();
}

/** Account IDs referenced by a Meta webhook payload (entry ids + DM recipient ids). Untrusted. */
export function extractMetaAccountIds(body: any): string[] {
  const ids: string[] = [];
  const add = (v: unknown) => {
    if ((typeof v === "string" || typeof v === "number") && String(v).length > 0 && String(v).length <= 64) {
      const s = String(v);
      if (!ids.includes(s)) ids.push(s);
    }
  };
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    if (ids.length >= MAX_ACCOUNT_IDS) break;
    add(entry?.id);
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const ev of messaging) {
      if (ids.length >= MAX_ACCOUNT_IDS) break;
      add(ev?.recipient?.id);
    }
  }
  return ids.slice(0, MAX_ACCOUNT_IDS);
}

/**
 * Middleware placed before the webhook POST handler. It decides, before any event is
 * processed, whether the request is authentic:
 *   - a secret is known (platform env or any referenced account) -> signature must match one of
 *     them, else 401 (missing header) / 403 (bad signature) and nothing is processed;
 *   - no secret known -> processed as before with a rate-limited warning, unless
 *     META_WEBHOOK_REQUIRE_SIGNATURE=true, in which case 403.
 * The outcome is placed on res.locals.metaWebhook.
 */
export function createMetaWebhookSignatureGuard(opts: MetaWebhookGuardOptions): RequestHandler {
  const tag = opts.platform === "facebook" ? "[Facebook Webhook]" : "[Instagram Webhook]";
  const logger = opts.logger || console;
  const getPlatformSecrets = opts.getPlatformSecrets || (() => getPlatformMetaAppSecrets(opts.platform));
  const requireSignature = opts.requireSignature || isMetaSignatureRequired;

  return async (req: Request, res: Response, next: NextFunction) => {
    const body: any = req.body;
    // Not a payload we handle (the handler ignores it); nothing to protect.
    if (!body || typeof body !== "object" || body.object !== opts.expectedObject) {
      res.locals.metaWebhook = { verified: false, businessAccountIds: [] } satisfies MetaWebhookVerification;
      return next();
    }

    const accountIds = extractMetaAccountIds(body);
    const businessAccountIds: string[] = [];
    const accountSecrets: string[] = [];
    const accountsWithoutSecret: string[] = [];

    try {
      for (const accountId of accountIds) {
        const found = await opts.lookupAccount(accountId);
        if (!found) continue;
        if (!businessAccountIds.includes(found.businessAccountId)) businessAccountIds.push(found.businessAccountId);
        const secret = resolveStoredAppSecret(found.appSecret);
        if (secret) {
          if (!accountSecrets.includes(secret)) accountSecrets.push(secret);
        } else if (found.appSecret) {
          rateLimitedWarn(logger, `${opts.platform}:undecryptable:${found.businessAccountId}`,
            `${tag} Stored App Secret for business ${found.businessAccountId} (account ${accountId}) could not be decrypted - treating as not configured`);
          accountsWithoutSecret.push(accountId);
        } else {
          accountsWithoutSecret.push(accountId);
        }
      }
    } catch (error) {
      logger.error(`${tag} Signature check: account lookup failed`, error);
      // Let Meta retry rather than processing an unverified payload.
      return res.sendStatus(500);
    }

    const secrets = [...getPlatformSecrets(), ...accountSecrets].filter((s, i, arr) => arr.indexOf(s) === i);
    const accountsLabel = accountIds.join(",") || "none";
    const businessLabel = businessAccountIds.join(",") || "unknown";

    if (secrets.length === 0) {
      if (requireSignature()) {
        rateLimitedWarn(logger, `${opts.platform}:required:${accountsLabel}`,
          `${tag} Rejected: no App Secret configured for account(s) ${accountsLabel} (business ${businessLabel}) and META_WEBHOOK_REQUIRE_SIGNATURE=true`);
        for (const b of businessAccountIds) markStatus(opts.platform, b, "lastFailureAt");
        return res.sendStatus(403);
      }
      rateLimitedWarn(logger, `${opts.platform}:unsigned:${accountsLabel}`,
        `${tag} WARNING: processing UNVERIFIED webhook for account(s) ${accountsLabel} (business ${businessLabel}) - no App Secret configured. Add it in Settings (Meta App Dashboard -> Settings -> Basic -> App Secret).`);
      for (const b of businessAccountIds) markStatus(opts.platform, b, "lastUnsignedAt");
      res.locals.metaWebhook = { verified: false, businessAccountIds } satisfies MetaWebhookVerification;
      return next();
    }

    const result = verifyMetaSignature((req as any).rawBody, req.headers["x-hub-signature-256"], secrets);
    if (!result.valid) {
      rateLimitedWarn(logger, `${opts.platform}:invalid:${accountsLabel}:${result.reason}`,
        `${tag} Rejected webhook with ${result.reason} signature for account(s) ${accountsLabel} (business ${businessLabel})`);
      for (const b of businessAccountIds) markStatus(opts.platform, b, "lastFailureAt");
      return res.sendStatus(result.reason === "missing_header" ? 401 : 403);
    }

    for (const b of businessAccountIds) markStatus(opts.platform, b, "lastVerifiedAt");
    if (accountsWithoutSecret.length > 0) {
      rateLimitedWarn(logger, `${opts.platform}:partial:${accountsWithoutSecret.join(",")}`,
        `${tag} Signature verified, but account(s) ${accountsWithoutSecret.join(",")} have no App Secret stored`);
    }
    res.locals.metaWebhook = { verified: true, businessAccountIds } satisfies MetaWebhookVerification;
    return next();
  };
}
