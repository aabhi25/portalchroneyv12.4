/**
 * Phone numbers sent to a CRM with a country code (e.g. LeadSquared field mappings with
 * "Add +91 to 10-digit numbers"). Shared by the server (sync) and the settings UI (preview).
 *
 *   9876543210        → +91-9876543210   (style 'dash', the default — LeadSquared's own format)
 *   09876543210       → +91-9876543210   (trunk 0 removed)
 *   919876543210      → +91-9876543210
 *   0091 98765 43210  → +91-9876543210
 *   +91 98765-43210   → +91-9876543210   (re-formatted)
 *   +44 20 7946 0958  → unchanged        (another country)
 *   12345             → unchanged        (not a 10-digit national number)
 */

export type PhoneCodeStyle = "dash" | "compact";
export const PHONE_CODE_STYLES: PhoneCodeStyle[] = ["dash", "compact"];
export const DEFAULT_PHONE_COUNTRY_CODE = "91";
export const DEFAULT_PHONE_CODE_STYLE: PhoneCodeStyle = "dash";

/** "+91-9876543210" (dash) or "+919876543210" (compact). */
export function phoneCodeExample(countryCode: string = DEFAULT_PHONE_COUNTRY_CODE, style: PhoneCodeStyle = DEFAULT_PHONE_CODE_STYLE): string {
  return style === "compact" ? `+${countryCode}9876543210` : `+${countryCode}-9876543210`;
}

/** A valid country calling code (1–4 digits, no leading 0), else null. */
export function normalizeCountryCode(value: unknown): string | null {
  const s = String(value ?? "").replace(/[^\d]/g, "");
  return /^[1-9]\d{0,3}$/.test(s) ? s : null;
}

export function normalizePhoneCodeStyle(value: unknown): PhoneCodeStyle {
  return value === "compact" ? "compact" : "dash";
}

/**
 * Add the country code to a 10-digit national number. Numbers that already carry another
 * country code, or that aren't a 10-digit national number, are returned unchanged.
 */
export function formatPhoneWithCountryCode(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_PHONE_COUNTRY_CODE,
  style: PhoneCodeStyle = DEFAULT_PHONE_CODE_STYLE,
): string | null | undefined {
  if (raw === null || raw === undefined) return raw;
  const original = String(raw);
  const trimmed = original.trim();
  if (!trimmed) return original;
  const code = normalizeCountryCode(countryCode);
  if (!code) return original;
  const hadPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!hadPlus && digits.startsWith("00")) digits = digits.slice(2); // international prefix "00"

  let national: string | null = null;
  if (hadPlus || trimmed.startsWith("00")) {
    // Already international: only re-format our own country code.
    if (digits.startsWith(code) && digits.length === code.length + 10) national = digits.slice(code.length);
  } else if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    national = digits.slice(1);
  } else if (digits.length === code.length + 10 && digits.startsWith(code)) {
    national = digits.slice(code.length);
  }
  if (!national) return original;
  return style === "compact" ? `+${code}${national}` : `+${code}-${national}`;
}
