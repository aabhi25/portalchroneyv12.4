/**
 * AI Calling provider registry. Tests swap providers with setCallingProviderForTesting.
 */
import type { CallProviderId } from "@shared/aiCalling";
import type { TelephonyProvider } from "../types";
import { exotelProvider } from "./exotel";
import { simulatorProvider } from "./simulator";

const overrides = new Map<CallProviderId, TelephonyProvider>();

export function getCallingProvider(id: string | null | undefined): TelephonyProvider {
  const key: CallProviderId = id === "exotel" ? "exotel" : "simulator";
  return overrides.get(key) ?? (key === "exotel" ? exotelProvider : simulatorProvider);
}

export function setCallingProviderForTesting(id: CallProviderId, provider: TelephonyProvider | null): void {
  if (provider) overrides.set(id, provider);
  else overrides.delete(id);
}
