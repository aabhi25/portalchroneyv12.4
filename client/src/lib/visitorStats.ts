/** Visitor Insights display helpers (page visits, countries). */

let regionNames: Intl.DisplayNames | null | undefined;

/** "IN" → "India". Anything that isn't a two-letter code (or unknown) is shown as it is. */
export function countryLabel(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return country;
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(undefined, { type: "region" }); } catch { regionNames = null; }
  }
  try { return regionNames?.of(country) || country; } catch { return country; }
}

/** Page loads where the widget appeared (each visitor once a day) — the base for devices, countries and cities. */
export function pageVisitsOf(devices?: { desktop?: number; mobile?: number; tablet?: number } | null): number {
  return (devices?.desktop || 0) + (devices?.mobile || 0) + (devices?.tablet || 0);
}
