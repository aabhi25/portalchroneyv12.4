/**
 * AI Calling provider registry. Tests swap providers with setCallingProviderForTesting.
 */
import type { CallProviderId } from "@shared/aiCalling";
import type { TelephonyProvider } from "../types";
import { normalizeCallProvider } from "@shared/aiCalling";
import { exotelProvider } from "./exotel";
import { plivoProvider } from "./plivo";
import { simulatorProvider } from "./simulator";

const overrides = new Map<CallProviderId, TelephonyProvider>();

export function getCallingProvider(id: string | null | undefined): TelephonyProvider {
  const key: CallProviderId = normalizeCallProvider(id);
  return overrides.get(key) ?? (key === "exotel" ? exotelProvider : key === "plivo" ? plivoProvider : simulatorProvider);
}

export function setCallingProviderForTesting(id: CallProviderId, provider: TelephonyProvider | null): void {
  if (provider) overrides.set(id, provider);
  else overrides.delete(id);
}
