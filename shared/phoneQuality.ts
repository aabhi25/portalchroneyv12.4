/**
 * Does a typed mobile number look like junk ("9999999999", "1234567890", too short)? Used to keep such
 * leads out of the automatic CRM sync (they wait with a Sync now button instead). Only Indian-looking
 * numbers are judged: a number written with another country code is left alone.
 */
const SEQUENCES = ["0123456789", "1234567890", "9876543210", "0987654321"];

export function junkPhoneReason(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = String(raw).trim();
  let digits = text.replace(/\D/g, "");
  if (!digits) return null;
  if (text.startsWith("+") && !digits.startsWith("91")) return null; // other countries: not judged
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length < 8) return "too short to be a mobile number";
  if (digits.length !== 10) return null;
  if (/^(\d)\1{9}$/.test(digits)) return "all the same digit";
  if (SEQUENCES.includes(digits)) return "a sequence of digits";
  if (!/^[6-9]/.test(digits)) return "Indian mobile numbers start with 6, 7, 8 or 9";
  if (/^\d(\d)\1{8}$/.test(digits)) return "repeated digits";
  return null;
}
