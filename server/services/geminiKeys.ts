/**
 * Google AI Studio (Gemini) keys for photo search.
 *
 * Resolution for an account:
 *   1. the account's own key (business_accounts.gemini_api_key, encrypted), set in Super Admin › API Keys;
 *   2. else the platform key, set in Super admin › AI providers › Photo search (system_settings, encrypted),
 *      with the GEMINI_API_KEY environment variable as a fallback for local testing;
 *   3. else none: the account has no Gemini photo search.
 *
 * Raw keys are decrypted only to call Google. APIs return a ••••last4 mask, never the key.
 */
import type { BusinessAccount } from "@shared/schema";
import { decrypt } from "./encryptionService";
import { systemSettingsService } from "./systemSettingsService";
import { last4, maskKey } from "./avatar/credentials";

const PLATFORM_KEY_SETTING = "gemini_photo_search_platform_key";

export type GeminiKeySource = "account" | "platform";

export async function getPlatformGeminiKey(): Promise<{ key: string; source: "settings" | "env" } | null> {
  const stored = await systemSettingsService.getSetting(PLATFORM_KEY_SETTING);
  if (stored) return { key: stored, source: "settings" };
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) return { key: envKey, source: "env" };
  return null;
}

export async function setPlatformGeminiKey(raw: string): Promise<boolean> {
  return systemSettingsService.setSetting(PLATFORM_KEY_SETTING, raw, true, "Gemini platform key for photo search");
}

export async function deletePlatformGeminiKey(): Promise<boolean> {
  return systemSettingsService.deleteSetting(PLATFORM_KEY_SETTING);
}

export async function describePlatformGeminiKey(): Promise<{ configured: boolean; source: "settings" | "env" | null; masked: string | null }> {
  const found = await getPlatformGeminiKey();
  if (!found) return { configured: false, source: null, masked: null };
  return { configured: true, source: found.source, masked: maskKey(last4(found.key)) };
}

export function openAccountGeminiKey(account: Pick<BusinessAccount, "geminiApiKey">): string | null {
  if (!account.geminiApiKey) return null;
  try {
    return decrypt(account.geminiApiKey);
  } catch {
    console.error("[GeminiKeys] Failed to decrypt an account's Gemini key");
    return null;
  }
}

/** The key an account's photo search uses, and where it came from. */
export async function resolveGeminiKey(
  account: Pick<BusinessAccount, "geminiApiKey">,
): Promise<{ key: string; source: GeminiKeySource } | null> {
  const own = openAccountGeminiKey(account);
  if (own) return { key: own, source: "account" };
  const platform = await getPlatformGeminiKey();
  return platform ? { key: platform.key, source: "platform" } : null;
}
