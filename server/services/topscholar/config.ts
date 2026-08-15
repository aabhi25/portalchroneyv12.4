import type { BusinessAccount } from '@shared/schema';
import { safeDecrypt } from '../encryptionService';

/**
 * The content-DB connection string carries the client's DB password, so it is
 * stored encrypted at rest (AES-256-GCM, same as messaging/CRM creds). It is
 * decrypted here whenever config is resolved, so every downstream consumer
 * (pool/Mongo-client caches keyed on the connection string, the RAG resolver,
 * the content reader) always sees plaintext. `safeDecrypt` returns the raw value
 * unchanged when it is not in encrypted format, so legacy plaintext rows migrate
 * transparently the next time the admin saves.
 */
export function decryptContentDbUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return safeDecrypt(raw) || null;
}

/**
 * Resolved TopScholar curriculum-mode configuration for a business account.
 * Everything here is config-driven so the same code path works against the
 * local pgvector stand-in now and the client's hosted DB/CMS later.
 */
export interface TopscholarConfig {
  ragEnabled: boolean;
  contentDbUrl: string | null; // EFFECTIVE content store: null => use the local DB stand-in. postgres:// => pgvector, mongodb(+srv):// => Atlas. This is null whenever the external DB is disabled (see externalContentDbDisabled), so every downstream reader/writer transparently falls back to local.
  // The decrypted external connection string as SAVED, regardless of the disabled
  // toggle. Used only for admin display (so the admin can see/edit the saved URL
  // while the external DB is switched off). Never used to route reads/writes.
  savedContentDbUrl: string | null;
  // When true, the saved external content DB is switched off and contentDbUrl is
  // forced to null (built-in local store) WITHOUT erasing the saved connection.
  externalContentDbDisabled: boolean;
  contentDbName: string | null; // MongoDB Atlas database name (mongodb only)
  contentDbIndex: string | null; // MongoDB Atlas Vector Search index name (mongodb only)
  contentDbCollection: string | null; // MongoDB Atlas collection name (mongodb only); null => default 'topscholar_embeddings'
  storeType: 'pgvector' | 'mongodb'; // derived from the EFFECTIVE contentDbUrl
  // Content Bundle API (plan-and-promo service). apiBaseUrl is the FULL endpoint
  // URL (e.g. https://preprod.toppscholars.com/plan-and-promo/api/Plan/content-bundle),
  // used directly with no path appended.
  apiBaseUrl: string | null;
  apiToken: string | null; // optional Bearer (UAT has no auth)
  syncMode: 'sample' | 'full'; // default mode for "sync all" actions; manual-only (no scheduling)
  tokenSecret: string | null;
  uatPlainCpId: boolean;
  // Secure mode: when true, ONLY a valid signed launch token is trusted. Plain
  // scope/cp_id request attributes are ignored and an unsigned launch is refused.
  requireSignedToken: boolean;
  // TopScholar doubt-sync: base URL for the client's conversation-sync + doubt-close
  // APIs (e.g. https://dev5.toppscholars.com). null => doubt-sync disabled.
  doubtSyncBaseUrl: string | null;
  // Idle seconds after the AI answers a doubt-scoped session before the widget shows
  // the "Did this resolve your doubt?" prompt. null => use the default constant.
  doubtResolutionCooldownSeconds: number | null;
}

// Fallback used when no per-account doubt-resolution cooldown is configured.
export const DEFAULT_DOUBT_RESOLUTION_COOLDOWN_SECONDS = 120;

/**
 * Hard single-tenant gate. TopScholar curriculum mode is feature-scoped to ONE
 * business account. Even if another account flips `topscholarRagEnabled`, the
 * feature must never activate for them. Overridable via env for staging.
 */
export const TOPSCHOLAR_ACCOUNT_ID =
  process.env.TOPSCHOLAR_ACCOUNT_ID || '1e80bae7-e219-4769-824d-ee027770cd7d';

export function isTopscholarAccount(businessAccountId: string | null | undefined): boolean {
  return !!businessAccountId && businessAccountId === TOPSCHOLAR_ACCOUNT_ID;
}

export function getTopscholarConfig(account: Pick<BusinessAccount,
  | 'id'
  | 'topscholarRagEnabled'
  | 'topscholarContentDbUrl'
  | 'topscholarContentDbDisabled'
  | 'topscholarContentDbName'
  | 'topscholarContentDbIndex'
  | 'topscholarContentDbCollection'
  | 'topscholarApiBaseUrl'
  | 'topscholarApiToken'
  | 'topscholarSyncMode'
  | 'topscholarTokenSecret'
  | 'topscholarUatPlainCpId'
  | 'topscholarRequireSignedToken'
  | 'topscholarDoubtSyncBaseUrl'
  | 'topscholarDoubtResolutionCooldownSeconds'
>): TopscholarConfig {
  // Hard tenant gate: curriculum mode is hardcoded ON for the one allowed
  // account. It is derived purely from account identity — there is no
  // configurable enable flag, so it can never be turned off.
  const allowed = isTopscholarAccount(account.id);
  const savedContentDbUrl = decryptContentDbUrl(account.topscholarContentDbUrl);
  // Manual kill-switch: when the admin disables the external content DB we ignore
  // the saved URL and fall back to the built-in local pgvector store, WITHOUT
  // erasing the saved connection details. A missing flag means "enabled" so
  // existing accounts keep their current behaviour (back-compat).
  const externalContentDbDisabled = account.topscholarContentDbDisabled === 'true';
  const contentDbUrl = externalContentDbDisabled ? null : savedContentDbUrl;
  const storeType: 'pgvector' | 'mongodb' = isMongoConnectionString(contentDbUrl) ? 'mongodb' : 'pgvector';
  const syncMode: 'sample' | 'full' = account.topscholarSyncMode === 'sample' ? 'sample' : 'full';
  return {
    ragEnabled: allowed,
    contentDbUrl,
    savedContentDbUrl,
    externalContentDbDisabled,
    contentDbName: account.topscholarContentDbName || null,
    contentDbIndex: account.topscholarContentDbIndex || null,
    contentDbCollection: account.topscholarContentDbCollection || null,
    storeType,
    apiBaseUrl: account.topscholarApiBaseUrl || null,
    apiToken: account.topscholarApiToken || null,
    syncMode,
    tokenSecret: account.topscholarTokenSecret || null,
    uatPlainCpId: allowed && account.topscholarUatPlainCpId === 'true',
    requireSignedToken: allowed && account.topscholarRequireSignedToken === 'true',
    doubtSyncBaseUrl: (allowed && account.topscholarDoubtSyncBaseUrl?.trim()) || null,
    doubtResolutionCooldownSeconds:
      (allowed && typeof account.topscholarDoubtResolutionCooldownSeconds === 'number'
        ? account.topscholarDoubtResolutionCooldownSeconds
        : null),
  };
}

/** True when the content-DB connection string targets MongoDB Atlas (vs pgvector). */
export function isMongoConnectionString(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.trim().toLowerCase();
  return u.startsWith('mongodb://') || u.startsWith('mongodb+srv://');
}

export function isTopscholarRagEnabled(
  account: Pick<BusinessAccount, 'id' | 'topscholarRagEnabled'> | null | undefined,
): boolean {
  // Curriculum mode is hardcoded ON for the single TopScholar account; there is
  // no configurable enable flag to honour.
  return !!account && isTopscholarAccount(account.id);
}

/**
 * SSRF guard for the admin-supplied CMS base URL. Because an admin can store an
 * arbitrary URL that the server later fetches, we restrict it to https on a
 * public host and reject localhost / private / link-local targets. Throws on
 * an unsafe value.
 */
export function assertSafeCmsBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('CMS base URL is not a valid URL.');
  }
  if (url.protocol !== 'https:') {
    throw new Error('CMS base URL must use https.');
  }
  const host = url.hostname.toLowerCase();
  const isIpLiteral = /^[0-9.]+$/.test(host) || host.includes(':');
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    // Private / loopback / link-local IPv4 ranges and IPv6 loopback/ULA.
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80');
  if (blocked || (isIpLiteral && blocked)) {
    throw new Error('CMS base URL must point to a public host (private/loopback addresses are not allowed).');
  }
  return url;
}
