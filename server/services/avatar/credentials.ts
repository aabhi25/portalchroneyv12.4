/**
 * Avatar provider API keys.
 *
 * Resolution for a session (business B, provider P):
 *   1. B's own key for P (avatar_business_settings.api_keys[P], encrypted);
 *   2. else the PLATFORM key for P — only when B has "Allow platform key (we pay)"
 *      switched on (commercial choice, off by default). The platform key lives in
 *      system_settings (encrypted), with env fallbacks HEYGEN_LIVEAVATAR_API_KEY /
 *      ANAM_API_KEY for local testing;
 *   3. else no key → the avatar cannot start and the widget hides the button.
 *
 * Raw keys are decrypted only here, only to call the provider. They are never
 * returned by an API, sent to the browser, or logged — callers get a ••••last4 mask.
 */
import { decrypt, encrypt } from "../encryptionService";
import { systemSettingsService } from "../systemSettingsService";
import type { AvatarProviderId } from "./types";

export type KeySource = "business" | "platform";

export interface StoredKey {
  enc: string;
  last4: string;
  updatedAt: string;
  updatedBy?: string | null;
}

const PLATFORM_KEY_SETTING = (provider: AvatarProviderId) => `avatar_platform_key_${provider}`;
const RATES_SETTING = "avatar_provider_rates";

const ENV_KEYS: Record<AvatarProviderId, string> = {
  heygen_liveavatar: "HEYGEN_LIVEAVATAR_API_KEY",
  anam: "ANAM_API_KEY",
  fake: "AVATAR_FAKE_API_KEY",
};

/** List-price defaults (USD per avatar minute) — editable by super admin. */
export const DEFAULT_RATES_USD_PER_MIN: Record<AvatarProviderId, number> = {
  heygen_liveavatar: 0.1,
  anam: 0.15,
  fake: 0,
};

export function last4(key: string): string {
  const trimmed = key.trim();
  return trimmed.length >= 8 ? trimmed.slice(-4) : "";
}

/** "••••abcd" — never more than the last four characters. */
export function maskKey(last: string | null | undefined): string {
  return `••••${last || ""}`;
}

export function normalizeApiKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (key.length < 8 || key.length > 512) return null;
  if (/\s/.test(key)) return null;
  return key;
}

export function sealBusinessKey(raw: string, updatedBy: string | null): StoredKey {
  return { enc: encrypt(raw), last4: last4(raw), updatedAt: new Date().toISOString(), updatedBy };
}

export function openBusinessKey(entry: StoredKey | undefined | null): string | null {
  if (!entry?.enc) return null;
  try {
    return decrypt(entry.enc);
  } catch {
    console.error("[Avatar] Failed to decrypt a stored business avatar key");
    return null;
  }
}

// ── platform keys ────────────────────────────────────────────────────────────

export async function getPlatformKey(provider: AvatarProviderId): Promise<{ key: string; source: "settings" | "env" } | null> {
  const stored = await systemSettingsService.getSetting(PLATFORM_KEY_SETTING(provider));
  if (stored) return { key: stored, source: "settings" };
  const envKey = process.env[ENV_KEYS[provider]];
  if (envKey && envKey.trim()) return { key: envKey.trim(), source: "env" };
  return null;
}

export async function setPlatformKey(provider: AvatarProviderId, raw: string): Promise<boolean> {
  return systemSettingsService.setSetting(PLATFORM_KEY_SETTING(provider), raw, true, `Live avatar platform API key (${provider})`);
}

export async function deletePlatformKey(provider: AvatarProviderId): Promise<boolean> {
  return systemSettingsService.deleteSetting(PLATFORM_KEY_SETTING(provider));
}

export async function describePlatformKey(provider: AvatarProviderId): Promise<{ configured: boolean; source: "settings" | "env" | null; masked: string | null }> {
  const found = await getPlatformKey(provider);
  if (!found) return { configured: false, source: null, masked: null };
  return { configured: true, source: found.source, masked: maskKey(last4(found.key)) };
}

// ── resolution ───────────────────────────────────────────────────────────────

export interface KeyResolution {
  apiKey: string | null;
  source: KeySource | null;
}

export async function resolveApiKey(
  provider: AvatarProviderId,
  settings: { apiKeys?: Record<string, StoredKey> | null; allowPlatformKey?: boolean | null } | null,
): Promise<KeyResolution> {
  const own = openBusinessKey(settings?.apiKeys?.[provider]);
  if (own) return { apiKey: own, source: "business" };
  if (settings?.allowPlatformKey) {
    const platform = await getPlatformKey(provider);
    if (platform) return { apiKey: platform.key, source: "platform" };
  }
  return { apiKey: null, source: null };
}

/** Same decision without decrypting — for status displays and the widget button. */
export async function keyAvailability(
  provider: AvatarProviderId,
  settings: { apiKeys?: Record<string, StoredKey> | null; allowPlatformKey?: boolean | null } | null,
): Promise<KeySource | null> {
  if (settings?.apiKeys?.[provider]?.enc) return "business";
  if (settings?.allowPlatformKey && (await getPlatformKey(provider))) return "platform";
  return null;
}

// ── cost rates ───────────────────────────────────────────────────────────────

export async function getRates(): Promise<Record<AvatarProviderId, number>> {
  const rates = { ...DEFAULT_RATES_USD_PER_MIN };
  const raw = await systemSettingsService.getSetting(RATES_SETTING);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      for (const id of Object.keys(rates) as AvatarProviderId[]) {
        const v = Number(parsed?.[id]);
        if (Number.isFinite(v) && v >= 0 && v <= 100) rates[id] = v;
      }
    } catch { /* keep defaults */ }
  }
  return rates;
}

export async function setRates(next: Partial<Record<AvatarProviderId, number>>): Promise<Record<AvatarProviderId, number>> {
  const current = await getRates();
  const merged = { ...current };
  for (const [id, v] of Object.entries(next)) {
    if (id in merged && typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) merged[id as AvatarProviderId] = v;
  }
  await systemSettingsService.setSetting(RATES_SETTING, JSON.stringify(merged), false, "Live avatar cost estimate (USD per minute) per provider");
  return merged;
}
