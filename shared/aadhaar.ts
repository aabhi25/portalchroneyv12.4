/**
 * Aadhaar number helpers.
 *
 * Every genuine Aadhaar number is 12 digits, does not start with 0 or 1, and its
 * last digit is a Verhoeff check digit. Verhoeff catches every single-digit
 * misread and every adjacent-digit swap, so a number that passes is almost
 * certainly read correctly, and one that fails was misread (or isn't an
 * Aadhaar number at all).
 */

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** True when the digit string (check digit last) passes the Verhoeff checksum. */
export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

/** Appends the Verhoeff check digit (used to build valid test numbers). */
export function verhoeffCheckDigit(digits: string): string {
  let c = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][Number(reversed[i])]];
  }
  const inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
  return String(inv[c]);
}

export type AadhaarNumberKind =
  | 'valid'      // 12 digits, first digit 2-9, checksum OK
  | 'checksum'   // 12 digits but checksum fails → a digit was misread
  | 'vid'        // 16 digits → the Virtual ID printed on newer cards, not the Aadhaar number
  | 'masked'     // e.g. XXXX XXXX 1234 → only the last 4 digits are shown
  | 'invalid';   // anything else (wrong length, letters, enrolment number…)

export interface AadhaarNumberCheck {
  kind: AadhaarNumberKind;
  digits: string;      // digits only (for 'valid' / 'checksum', the 12 digits)
  lastFour?: string;   // for 'masked'
}

/** Classifies whatever the AI returned in the Aadhaar number field. */
export function checkAadhaarNumber(raw: unknown): AadhaarNumberCheck {
  const text = String(raw ?? '').trim();
  const compact = text.replace(/[\s\-.]/g, '').toUpperCase();
  const masked = compact.match(/^[X*•#]{4,8}(\d{4})$/);
  if (masked) return { kind: 'masked', digits: masked[1], lastFour: masked[1] };
  const digits = compact.replace(/\D/g, '');
  if (!/^\d+$/.test(compact)) return { kind: 'invalid', digits };
  if (digits.length === 16) return { kind: 'vid', digits };
  if (digits.length !== 12) return { kind: 'invalid', digits };
  if (/^[01]/.test(digits)) return { kind: 'invalid', digits };
  return { kind: verhoeffValid(digits) ? 'valid' : 'checksum', digits };
}
