/**
 * PAN (Permanent Account Number) helpers.
 *
 * A PAN is always 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). Vision
 * models reading a small, glary or WhatsApp-compressed card often confuse look-alike
 * characters (G/6, O/0, I/1, S/5, B/8, Z/2). Because every position is either a letter or
 * a digit, such a misread can be corrected by position — the same structure-based repair
 * KYC providers use. A value is only ever accepted when the repaired result is a valid PAN.
 */

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// Read as a digit where a LETTER belongs → the letter it is mistaken for.
const DIGIT_TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "4": "A", "5": "S", "6": "G", "7": "T", "8": "B" };
// Read as a letter where a DIGIT belongs → the digit it is mistaken for.
const LETTER_TO_DIGIT: Record<string, string> = { O: "0", D: "0", Q: "0", U: "0", I: "1", L: "1", J: "1", Z: "2", A: "4", S: "5", G: "6", T: "7", B: "8" };

export function isValidPan(value: unknown): boolean {
  return typeof value === "string" && PAN_REGEX.test(value);
}

/**
 * Normalise a PAN read from a document or typed by a customer: upper-case, drop spaces,
 * dashes and dots, then fix look-alike characters by position. Returns the valid PAN, or
 * null when no valid PAN can be made from it (wrong length, unfixable character).
 */
export function repairPanNumber(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).toUpperCase().replace(/[\s.\-_/]/g, "");
  if (s.length !== 10 || !/^[A-Z0-9]{10}$/.test(s)) return null;
  if (PAN_REGEX.test(s)) return s;
  const chars = s.split("");
  for (let i = 0; i < 10; i++) {
    const wantsDigit = i >= 5 && i <= 8;
    const c = chars[i];
    if (wantsDigit && !/[0-9]/.test(c)) chars[i] = LETTER_TO_DIGIT[c] ?? c;
    if (!wantsDigit && /[0-9]/.test(c)) chars[i] = DIGIT_TO_LETTER[c] ?? c;
  }
  const fixed = chars.join("");
  return PAN_REGEX.test(fixed) ? fixed : null;
}

/** Upper-case and drop separators only — no look-alike repair (for values a person typed). */
function strictPan(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s.\-_/]/g, "");
  return PAN_REGEX.test(s) ? s : null;
}

/**
 * A PAN typed in a message ("my pan is abcde 1234 f", "ABCDE1234F"). Returns the valid PAN,
 * or null. Typed values are NOT look-alike repaired — a typo must not silently become a
 * different valid PAN (the customer is asked to check the format instead).
 */
export function findPanInText(text: unknown): string | null {
  const t = String(text ?? "");
  const whole = strictPan(t);
  if (whole) return whole;
  const tokens = t.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  // A single token, or up to 3 neighbouring tokens ("ABCDE 1234 F") joined to 10 characters.
  for (let i = 0; i < tokens.length; i++) {
    let joined = "";
    for (let j = i; j < Math.min(tokens.length, i + 3); j++) {
      joined += tokens[j];
      if (joined.length > 10) break;
      if (joined.length === 10 && PAN_REGEX.test(joined)) return joined;
    }
  }
  return null;
}

/** True when the text looks like someone tried to type a PAN (to give a format hint). */
export function looksLikePanAttempt(text: unknown): boolean {
  const t = String(text ?? "").toUpperCase().replace(/[\s.\-_/]/g, "");
  return /^[A-Z0-9]{8,12}$/.test(t) && /[0-9]/.test(t) && /[A-Z]/.test(t);
}
