/**
 * Per-business Live AI avatar settings (super admin edits; business users read status).
 *
 * Avatar is OFF unless a super admin enables it for the account. Children's
 * education accounts (K12 / TopScholar) default to a stylised avatar and cannot be
 * enabled until a super admin confirms parental consent (who/when is stored).
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { avatarBusinessSettings, type AvatarBusinessSettings, type BusinessAccount } from "@shared/schema";
import { storage } from "../../storage";
import { isTopscholarAccount } from "../topscholar/config";
import {
  keyAvailability,
  maskKey,
  normalizeApiKey,
  openBusinessKey,
  sealBusinessKey,
  type StoredKey,
} from "./credentials";
import { isFakeProviderAllowed } from "./providers/fake";
import {
  AVATAR_PROVIDER_LABELS,
  PRODUCTION_AVATAR_PROVIDERS,
  type AvatarProviderId,
} from "./types";

export const AVATAR_LIMITS = {
  monthlyMinuteCap: { min: 1, max: 100_000 },
  maxConcurrentSessions: { min: 1, max: 100 },
  maxSessionMinutes: { min: 1, max: 120 },
  idleTimeoutSeconds: { min: 15, max: 1800 },
} as const;

export const DEFAULT_DISPLAY_NAME = "AI Assistant";

export function selectableProviders(): AvatarProviderId[] {
  return isFakeProviderAllowed() ? [...PRODUCTION_AVATAR_PROVIDERS, "fake"] : [...PRODUCTION_AVATAR_PROVIDERS];
}

export function isProviderSelectable(provider: string): provider is AvatarProviderId {
  return (selectableProviders() as string[]).includes(provider);
}

export function isChildrensAccount(account: Pick<BusinessAccount, "id" | "k12EducationEnabled"> | null | undefined): boolean {
  if (!account) return false;
  return account.k12EducationEnabled === "true" || isTopscholarAccount(account.id);
}

/** Effective settings: the stored row or the defaults for this account (never null). */
export type EffectiveAvatarSettings = Omit<AvatarBusinessSettings, "createdAt" | "updatedAt"> & { exists: boolean };

export function defaultSettings(businessAccountId: string, account?: Pick<BusinessAccount, "id" | "k12EducationEnabled"> | null): EffectiveAvatarSettings {
  return {
    exists: false,
    businessAccountId,
    enabled: false,
    provider: "heygen_liveavatar",
    avatarId: null,
    providerOptions: {},
    displayName: null,
    styleHint: isChildrensAccount(account) ? "stylised" : "realistic",
    avatarGender: null,
    disclosureEnabled: true,
    disclosureText: null,
    monthlyMinuteCap: 60,
    maxConcurrentSessions: 2,
    maxSessionMinutes: 10,
    idleTimeoutSeconds: 60,
    apiKeys: {},
    allowPlatformKey: false,
    voiceNote: null,
    commercialNotes: null,
    parentalConsentConfirmed: false,
    parentalConsentConfirmedBy: null,
    parentalConsentConfirmedAt: null,
    updatedBy: null,
  };
}

export async function getSettingsRow(businessAccountId: string): Promise<AvatarBusinessSettings | null> {
  const [row] = await db.select().from(avatarBusinessSettings).where(eq(avatarBusinessSettings.businessAccountId, businessAccountId)).limit(1);
  return row ?? null;
}

export async function getEffectiveSettings(businessAccountId: string, account?: BusinessAccount | null): Promise<EffectiveAvatarSettings> {
  const row = await getSettingsRow(businessAccountId);
  if (row) {
    const { createdAt: _c, updatedAt: _u, ...rest } = row;
    return { ...rest, apiKeys: (rest.apiKeys || {}) as Record<string, StoredKey>, providerOptions: rest.providerOptions || {}, exists: true };
  }
  const acc = account === undefined ? await storage.getBusinessAccount(businessAccountId) : account;
  return defaultSettings(businessAccountId, acc);
}

export function disclosureFor(settings: Pick<EffectiveAvatarSettings, "disclosureEnabled" | "disclosureText" | "displayName">, businessName: string | null | undefined): string | null {
  if (!settings.disclosureEnabled) return null;
  const name = settings.displayName?.trim() || DEFAULT_DISPLAY_NAME;
  const business = (businessName || "").trim();
  const template = settings.disclosureText?.trim()
    || (business
      ? "Hi, I'm {name}, {business}'s AI assistant. You're talking to an AI avatar, so you can switch to text at any time."
      : "Hi, I'm {name}, an AI assistant. You're talking to an AI avatar, so you can switch to text at any time.");
  return template.replace(/\{name\}/g, name).replace(/\{business\}/g, business || "our").slice(0, 400);
}

// ── validation ───────────────────────────────────────────────────────────────

const nullableText = (max: number) => z.union([z.string().trim().max(max), z.null()]).optional();

export const avatarSettingsInput = z.object({
  enabled: z.boolean().optional(),
  provider: z.string().optional(),
  avatarId: z.union([z.string().trim().max(200).regex(/^[A-Za-z0-9_.:-]*$/, "avatar id may only contain letters, digits, _ . : -"), z.null()]).optional(),
  providerOptions: z.record(z.unknown()).optional(),
  displayName: nullableText(80),
  styleHint: z.enum(["realistic", "stylised"]).optional(),
  avatarGender: z.union([z.enum(["female", "male"]), z.null()]).optional(),
  disclosureEnabled: z.boolean().optional(),
  disclosureText: nullableText(300),
  monthlyMinuteCap: z.number().int().min(AVATAR_LIMITS.monthlyMinuteCap.min).max(AVATAR_LIMITS.monthlyMinuteCap.max).optional(),
  maxConcurrentSessions: z.number().int().min(AVATAR_LIMITS.maxConcurrentSessions.min).max(AVATAR_LIMITS.maxConcurrentSessions.max).optional(),
  maxSessionMinutes: z.number().int().min(AVATAR_LIMITS.maxSessionMinutes.min).max(AVATAR_LIMITS.maxSessionMinutes.max).optional(),
  idleTimeoutSeconds: z.number().int().min(AVATAR_LIMITS.idleTimeoutSeconds.min).max(AVATAR_LIMITS.idleTimeoutSeconds.max).optional(),
  allowPlatformKey: z.boolean().optional(),
  voiceNote: nullableText(500),
  commercialNotes: nullableText(2000),
  parentalConsentConfirmed: z.boolean().optional(),
}).strict();

export type AvatarSettingsInput = z.infer<typeof avatarSettingsInput>;

/** Only these provider options are kept, per provider (everything else is dropped). */
export function sanitizeProviderOptions(provider: AvatarProviderId, raw: Record<string, unknown> | undefined | null): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const src = raw || {};
  const out: Record<string, unknown> = {};
  if (provider === "heygen_liveavatar") {
    if (src.sandbox !== undefined) {
      if (typeof src.sandbox !== "boolean") return { ok: false, error: "providerOptions.sandbox must be a boolean" };
      out.sandbox = src.sandbox;
    }
    if (src.videoQuality !== undefined && src.videoQuality !== null && src.videoQuality !== "") {
      if (!["low", "medium", "high", "very_high"].includes(String(src.videoQuality))) return { ok: false, error: "providerOptions.videoQuality must be low, medium, high or very_high" };
      out.videoQuality = src.videoQuality;
    }
  } else if (provider === "anam") {
    if (src.avatarModel !== undefined && src.avatarModel !== null && src.avatarModel !== "") {
      if (!["cara-3", "cara-4", "cara-4-latest"].includes(String(src.avatarModel))) return { ok: false, error: "providerOptions.avatarModel must be cara-3, cara-4 or cara-4-latest" };
      out.avatarModel = src.avatarModel;
    }
  } else if (provider === "fake") {
    if (src.audioRoute === "server" || src.audioRoute === "client") out.audioRoute = src.audioRoute;
    if (typeof src.dropAfterSeconds === "number" && src.dropAfterSeconds > 0 && src.dropAfterSeconds < 3600) out.dropAfterSeconds = src.dropAfterSeconds;
    if (src.failConnect === true) out.failConnect = true;
  }
  return { ok: true, value: out };
}

export class AvatarSettingsError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

const AUDITED_FIELDS = [
  "enabled", "provider", "avatarId", "displayName", "styleHint", "avatarGender", "disclosureEnabled", "disclosureText",
  "monthlyMinuteCap", "maxConcurrentSessions", "maxSessionMinutes", "idleTimeoutSeconds", "allowPlatformKey",
  "voiceNote", "commercialNotes", "parentalConsentConfirmed", "providerOptions",
] as const;

/**
 * Validate and save. Returns the changed field names (for the audit log) plus
 * the before/after values of the non-secret fields.
 */
export async function updateAvatarSettings(
  businessAccountId: string,
  body: unknown,
  actorUserId: string | null,
): Promise<{ changed: string[]; before: Record<string, unknown>; after: Record<string, unknown>; settings: EffectiveAvatarSettings }> {
  const parsed = avatarSettingsInput.safeParse(body ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AvatarSettingsError(`${first?.path?.join(".") || "input"}: ${first?.message || "invalid"}`);
  }
  const input = parsed.data;
  const account = await storage.getBusinessAccount(businessAccountId);
  if (!account) throw new AvatarSettingsError("Business account not found", 404);
  const current = await getEffectiveSettings(businessAccountId, account);

  const provider = (input.provider ?? current.provider) as string;
  if (!isProviderSelectable(provider)) {
    throw new AvatarSettingsError(provider === "fake" ? "The fake provider is only available in development" : `Unknown provider '${provider}'`);
  }
  const options = sanitizeProviderOptions(provider, input.providerOptions ?? (provider === current.provider ? current.providerOptions : {}));
  if (!options.ok) throw new AvatarSettingsError(options.error);

  const next: EffectiveAvatarSettings = {
    ...current,
    enabled: input.enabled ?? current.enabled,
    provider,
    avatarId: input.avatarId !== undefined ? (input.avatarId || null) : current.avatarId,
    providerOptions: options.value,
    displayName: input.displayName !== undefined ? (input.displayName || null) : current.displayName,
    styleHint: input.styleHint ?? current.styleHint,
    avatarGender: input.avatarGender !== undefined ? input.avatarGender : (current.avatarGender ?? null),
    disclosureEnabled: input.disclosureEnabled ?? current.disclosureEnabled,
    disclosureText: input.disclosureText !== undefined ? (input.disclosureText || null) : current.disclosureText,
    monthlyMinuteCap: input.monthlyMinuteCap ?? current.monthlyMinuteCap,
    maxConcurrentSessions: input.maxConcurrentSessions ?? current.maxConcurrentSessions,
    maxSessionMinutes: input.maxSessionMinutes ?? current.maxSessionMinutes,
    idleTimeoutSeconds: input.idleTimeoutSeconds ?? current.idleTimeoutSeconds,
    allowPlatformKey: input.allowPlatformKey ?? current.allowPlatformKey,
    voiceNote: input.voiceNote !== undefined ? (input.voiceNote || null) : current.voiceNote,
    commercialNotes: input.commercialNotes !== undefined ? (input.commercialNotes || null) : current.commercialNotes,
  };

  // Parental consent: record who/when when a super admin ticks it; clear when unticked.
  if (input.parentalConsentConfirmed !== undefined && input.parentalConsentConfirmed !== current.parentalConsentConfirmed) {
    next.parentalConsentConfirmed = input.parentalConsentConfirmed;
    next.parentalConsentConfirmedBy = input.parentalConsentConfirmed ? actorUserId : null;
    next.parentalConsentConfirmedAt = input.parentalConsentConfirmed ? new Date() : null;
  }

  if (next.enabled) {
    if (provider !== "fake" && !next.avatarId) throw new AvatarSettingsError("An avatar id is required before the avatar can be enabled");
    if (isChildrensAccount(account) && !next.parentalConsentConfirmed) {
      throw new AvatarSettingsError("This is a children's education account: confirm parental consent before enabling the avatar");
    }
  }

  const changed = AUDITED_FIELDS.filter((f) => JSON.stringify((current as any)[f] ?? null) !== JSON.stringify((next as any)[f] ?? null));
  const pick = (s: EffectiveAvatarSettings) => Object.fromEntries(changed.filter((f) => f !== "commercialNotes" && f !== "voiceNote" && f !== "disclosureText").map((f) => [f, (s as any)[f] ?? null]));
  const now = new Date();
  const row = {
    businessAccountId,
    enabled: next.enabled,
    provider: next.provider,
    avatarId: next.avatarId,
    providerOptions: next.providerOptions,
    displayName: next.displayName,
    styleHint: next.styleHint,
    avatarGender: next.avatarGender ?? null,
    disclosureEnabled: next.disclosureEnabled,
    disclosureText: next.disclosureText,
    monthlyMinuteCap: next.monthlyMinuteCap,
    maxConcurrentSessions: next.maxConcurrentSessions,
    maxSessionMinutes: next.maxSessionMinutes,
    idleTimeoutSeconds: next.idleTimeoutSeconds,
    allowPlatformKey: next.allowPlatformKey,
    voiceNote: next.voiceNote,
    commercialNotes: next.commercialNotes,
    parentalConsentConfirmed: next.parentalConsentConfirmed,
    parentalConsentConfirmedBy: next.parentalConsentConfirmedBy,
    parentalConsentConfirmedAt: next.parentalConsentConfirmedAt,
    updatedBy: actorUserId,
    updatedAt: now,
  };
  await db.insert(avatarBusinessSettings)
    .values({ ...row, apiKeys: current.apiKeys || {}, createdAt: now })
    .onConflictDoUpdate({ target: avatarBusinessSettings.businessAccountId, set: row });
  invalidatePublicConfig(businessAccountId);
  return { changed, before: pick(current), after: pick(next), settings: { ...next, exists: true } };
}

// ── per-business provider keys ───────────────────────────────────────────────

async function writeKeys(businessAccountId: string, apiKeys: Record<string, StoredKey>, actorUserId: string | null): Promise<void> {
  const account = await storage.getBusinessAccount(businessAccountId);
  if (!account) throw new AvatarSettingsError("Business account not found", 404);
  const current = await getEffectiveSettings(businessAccountId, account);
  const now = new Date();
  const keysPatch = { apiKeys, updatedBy: actorUserId, updatedAt: now };
  if (current.exists) {
    await db.update(avatarBusinessSettings).set(keysPatch).where(eq(avatarBusinessSettings.businessAccountId, businessAccountId));
  } else {
    const { exists: _e, ...defaults } = current;
    await db.insert(avatarBusinessSettings).values({ ...defaults, ...keysPatch, createdAt: now });
  }
  invalidatePublicConfig(businessAccountId);
}

export function assertKeyProvider(provider: string): AvatarProviderId {
  if (!isProviderSelectable(provider)) throw new AvatarSettingsError(`Unknown provider '${provider}'`);
  return provider;
}

/** Store (replace) the business's own key for a provider. Returns the mask only. */
export async function setBusinessApiKey(businessAccountId: string, provider: string, rawKey: unknown, actorUserId: string | null): Promise<{ masked: string; replaced: boolean }> {
  const id = assertKeyProvider(provider);
  const key = normalizeApiKey(rawKey);
  if (!key) throw new AvatarSettingsError("API key must be 8–512 characters with no spaces");
  const current = await getEffectiveSettings(businessAccountId);
  const replaced = !!current.apiKeys?.[id]?.enc;
  const sealed = sealBusinessKey(key, actorUserId);
  await writeKeys(businessAccountId, { ...(current.apiKeys || {}), [id]: sealed }, actorUserId);
  return { masked: maskKey(sealed.last4), replaced };
}

export async function removeBusinessApiKey(businessAccountId: string, provider: string, actorUserId: string | null): Promise<boolean> {
  const id = assertKeyProvider(provider);
  const current = await getEffectiveSettings(businessAccountId);
  if (!current.apiKeys?.[id]) return false;
  const next = { ...(current.apiKeys || {}) };
  delete next[id];
  await writeKeys(businessAccountId, next, actorUserId);
  return true;
}

export async function getBusinessApiKey(businessAccountId: string, provider: AvatarProviderId): Promise<string | null> {
  const current = await getEffectiveSettings(businessAccountId);
  return openBusinessKey(current.apiKeys?.[provider]);
}

/** Key status for display — never the key itself. */
export function describeBusinessKeys(apiKeys: Record<string, StoredKey> | null | undefined): Record<string, { set: boolean; masked: string | null; updatedAt: string | null }> {
  const out: Record<string, { set: boolean; masked: string | null; updatedAt: string | null }> = {};
  for (const id of selectableProviders()) {
    const entry = apiKeys?.[id];
    out[id] = entry?.enc ? { set: true, masked: maskKey(entry.last4), updatedAt: entry.updatedAt || null } : { set: false, masked: null, updatedAt: null };
  }
  return out;
}

// ── public (widget) config ───────────────────────────────────────────────────

export interface PublicAvatarConfig {
  enabled: true;
  displayName: string;
  styleHint: string;
}

const publicCache = new Map<string, { value: PublicAvatarConfig | null; expiresAt: number }>();
const PUBLIC_TTL_MS = 30_000;

export function invalidatePublicConfig(businessAccountId?: string): void {
  if (businessAccountId) publicCache.delete(businessAccountId);
  else publicCache.clear();
}

/**
 * What the widget may know: whether to show the avatar button, the display name
 * and the style. Null unless the avatar can actually start (enabled, voice mode
 * on, a usable key, consent for children's accounts). Never includes keys.
 */
export async function getPublicAvatarConfig(businessAccountId: string, account?: BusinessAccount | null): Promise<PublicAvatarConfig | null> {
  const cached = publicCache.get(businessAccountId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let value: PublicAvatarConfig | null = null;
  try {
    const row = await getSettingsRow(businessAccountId);
    if (row?.enabled) {
      const acc = account === undefined ? await storage.getBusinessAccount(businessAccountId) : account;
      const providerOk = isProviderSelectable(row.provider);
      const consentOk = !isChildrensAccount(acc) || row.parentalConsentConfirmed;
      const voiceOk = acc?.voiceModeEnabled === "true" && acc?.status !== "suspended";
      const keyOk = providerOk && !!(await keyAvailability(row.provider as AvatarProviderId, row as any));
      if (providerOk && consentOk && voiceOk && keyOk && (row.provider === "fake" || row.avatarId)) {
        value = { enabled: true, displayName: row.displayName?.trim() || DEFAULT_DISPLAY_NAME, styleHint: row.styleHint };
      }
    }
  } catch (error) {
    // Fail closed: the widget simply shows no avatar button.
    console.error("[Avatar] public config lookup failed:", (error as Error)?.message || error);
    value = null;
  }
  publicCache.set(businessAccountId, { value, expiresAt: Date.now() + PUBLIC_TTL_MS });
  return value;
}

export function providerLabel(provider: string): string {
  return (AVATAR_PROVIDER_LABELS as Record<string, string>)[provider] || provider;
}
