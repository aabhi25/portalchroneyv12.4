/**
 * AI Calling — provider secrets (Exotel API key / token, Plivo Auth Token).
 *
 * Stored per business in ai_calling_settings.exotel_api_key / exotel_api_token /
 * plivo_auth_token as { enc, last4, updatedAt, updatedBy } (same shape and helpers as the avatar keys).
 * Raw values are decrypted only here, only to call the provider; APIs return a
 * "••••abcd" mask and a set / not-set flag, never the value.
 */
import type { AiCallingSettingsRow } from "@shared/schema";
import { normalizeCallProvider } from "@shared/aiCalling";
import { maskKey, normalizeApiKey, openBusinessKey, sealBusinessKey, type StoredKey } from "../avatar/credentials";
import type { ProviderCredentials } from "./types";

export type { StoredKey };
export { maskKey, normalizeApiKey };

export function sealSecret(raw: string, updatedBy: string | null): StoredKey {
  return sealBusinessKey(raw, updatedBy);
}

export function openSecret(entry: StoredKey | null | undefined): string | null {
  return openBusinessKey(entry);
}

export function describeSecret(entry: StoredKey | null | undefined): { set: boolean; mask: string | null } {
  return entry?.enc ? { set: true, mask: maskKey(entry.last4) } : { set: false, mask: null };
}

/** What is still missing before Exotel can place a call (plain words), or [] when ready. */
export function exotelMissing(row: Pick<AiCallingSettingsRow, "exotelAccountSid" | "exotelCallerId" | "exotelApiKey" | "exotelApiToken"> | null): string[] {
  const missing: string[] = [];
  if (!row?.exotelAccountSid) missing.push("Exotel account SID");
  if (!row?.exotelCallerId) missing.push("ExoPhone (caller number)");
  if (!row?.exotelApiKey?.enc) missing.push("Exotel API key");
  if (!row?.exotelApiToken?.enc) missing.push("Exotel API token");
  return missing;
}

/** What is still missing before Plivo can place a call (plain words), or [] when ready. */
export function plivoMissing(row: Pick<AiCallingSettingsRow, "plivoAuthId" | "plivoNumber" | "plivoAuthToken"> | null): string[] {
  const missing: string[] = [];
  if (!row?.plivoAuthId) missing.push("Plivo Auth ID");
  if (!row?.plivoAuthToken?.enc) missing.push("Plivo Auth Token");
  if (!row?.plivoNumber) missing.push("Plivo number");
  return missing;
}

/** What is missing for the chosen provider ([] for the simulator). */
export function providerMissing(row: AiCallingSettingsRow | null): string[] {
  const provider = normalizeCallProvider(row?.provider);
  if (provider === "exotel") return exotelMissing(row);
  if (provider === "plivo") return plivoMissing(row);
  return [];
}

/**
 * Decrypted credentials for the business's provider. Throws a plain-language error
 * when Exotel / Plivo is chosen but not fully set up (or a stored secret can't be read).
 */
export function resolveProviderCredentials(row: AiCallingSettingsRow | null): ProviderCredentials {
  const provider = normalizeCallProvider(row?.provider);
  if (provider === "plivo") {
    const missing = plivoMissing(row);
    if (missing.length) throw new Error(`Plivo is not fully set up yet: add your ${missing.join(", ")} in AI Calling settings.`);
    const authToken = openSecret(row!.plivoAuthToken);
    if (!authToken) throw new Error("Your saved Plivo Auth Token could not be read. Please enter it again in AI Calling settings.");
    return { provider, plivo: { authId: row!.plivoAuthId!, authToken, number: row!.plivoNumber! } };
  }
  if (provider !== "exotel") return { provider };
  const missing = exotelMissing(row);
  if (missing.length) throw new Error(`Exotel is not fully set up yet: add your ${missing.join(", ")} in AI Calling settings.`);
  const apiKey = openSecret(row!.exotelApiKey);
  const apiToken = openSecret(row!.exotelApiToken);
  if (!apiKey || !apiToken) throw new Error("Your saved Exotel API key or token could not be read. Please enter them again in AI Calling settings.");
  return {
    provider,
    exotel: {
      apiKey,
      apiToken,
      accountSid: row!.exotelAccountSid!,
      subdomain: row!.exotelSubdomain || "api.in.exotel.com",
      callerId: row!.exotelCallerId!,
      flowAppId: row!.exotelFlowAppId || null,
    },
  };
}
