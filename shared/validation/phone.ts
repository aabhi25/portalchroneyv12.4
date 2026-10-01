export type PhoneValidationMode = '10' | '12' | '8-12' | 'any';

export interface PhoneValidationResult {
  isValid: boolean;
  reasonCode: 'valid' | 'too_short' | 'too_long' | 'invalid_start' | 'all_same_digits' | 'sequential_asc' | 'sequential_desc';
  reasonMessage: string;
  /** Every digit in the input (unchanged legacy field). */
  digits: string;
  /**
   * The form to store when valid (empty when invalid):
   *  - '10'  → the 10-digit Indian national number ("+91 98765 43210", "919876543210",
   *            "09876543210" and "9876543210" all become "9876543210");
   *  - '12'  → "+" + the 12 digits (country code included), e.g. "+919876543210";
   *  - '8-12' / 'any' → the digits, with a leading "+" when the visitor typed one.
   * A leading international "00" prefix is dropped in every mode.
   */
  normalized: string;
}

function isAllSameDigits(digits: string): boolean {
  return digits.length > 0 && digits.split('').every(d => d === digits[0]);
}

function isSequentialAscending(digits: string): boolean {
  for (let i = 1; i < digits.length; i++) {
    const expected = (parseInt(digits[i - 1]) + 1) % 10;
    if (parseInt(digits[i]) !== expected) return false;
  }
  return digits.length >= 8;
}

function isSequentialDescending(digits: string): boolean {
  for (let i = 1; i < digits.length; i++) {
    const expected = (parseInt(digits[i - 1]) - 1 + 10) % 10;
    if (parseInt(digits[i]) !== expected) return false;
  }
  return digits.length >= 8;
}

/** Human description of what a mode accepts — shared by prompts and error messages. */
export function describePhoneRule(mode: PhoneValidationMode | string | undefined): string {
  switch (mode) {
    case '12': return 'exactly 12 digits including the country code (e.g. +91 98765 43210)';
    case '8-12': return 'between 8 and 12 digits';
    case 'any': return 'a valid phone number (7-15 digits)';
    case '10':
    default: return 'a 10-digit mobile number starting with 6, 7, 8 or 9 (a +91, 91 or 0 prefix is fine)';
  }
}

/**
 * Validates a phone number for a lead-training digit mode. Formatting (spaces, dashes,
 * dots, parentheses) is ignored. In '10' mode (Indian mobiles) a +91 / 91 / 0 / 0091
 * prefix is accepted and the last 10 digits are validated; the 6-9 first-digit rule
 * applies to the 10-digit national part in every mode except 'any' (unchanged rule).
 */
export function validatePhoneNumber(phone: string, mode: PhoneValidationMode = '10'): PhoneValidationResult {
  const raw = String(phone ?? '');
  const digits = raw.replace(/[^\d]/g, '');
  const hasPlus = /^\s*\+/.test(raw);
  // "00" is the international dialling prefix ("0091 98765 43210").
  const intl = !hasPlus && digits.startsWith('00') && digits.length > 11 ? digits.slice(2) : digits;
  const plusOrIntl = hasPlus || intl !== digits;

  const fail = (reasonCode: PhoneValidationResult['reasonCode'], reasonMessage: string): PhoneValidationResult =>
    ({ isValid: false, reasonCode, reasonMessage, digits, normalized: '' });

  let candidate = intl;
  let minLen: number, maxLen: number;
  switch (mode) {
    case '12': minLen = maxLen = 12; break;
    case '8-12': minLen = 8; maxLen = 12; break;
    case 'any': minLen = 7; maxLen = 15; break;
    case '10':
    default: {
      minLen = maxLen = 10;
      if (intl.length === 12 && intl.startsWith('91')) candidate = intl.slice(2);
      else if (intl.length === 11 && intl.startsWith('0') && !plusOrIntl) candidate = intl.slice(1);
    }
  }

  if (candidate.length < minLen) {
    return fail('too_short', mode === '10' || !mode ? 'Mobile number must have 10 digits' : `Phone number must be at least ${minLen} digits`);
  }
  if (candidate.length > maxLen) {
    return fail('too_long', mode === '10' || !mode ? 'Mobile number must have 10 digits' : `Phone number must be at most ${maxLen} digits`);
  }

  const localPart = candidate.length > 10 ? candidate.slice(-10) : candidate;

  if (isAllSameDigits(localPart)) {
    return fail('all_same_digits', 'Phone number cannot have all same digits');
  }
  if (isSequentialAscending(localPart)) {
    return fail('sequential_asc', 'Phone number cannot be a sequential number');
  }
  if (isSequentialDescending(localPart)) {
    return fail('sequential_desc', 'Phone number cannot be a sequential number');
  }

  if (mode !== 'any' && localPart.length === 10) {
    const firstDigit = localPart[0];
    if (!['6', '7', '8', '9'].includes(firstDigit)) {
      return fail('invalid_start', 'Mobile number must start with 6, 7, 8, or 9');
    }
  }

  let normalized: string;
  if (mode === '12') normalized = `+${candidate}`;
  else if (mode === '8-12' || mode === 'any') normalized = plusOrIntl ? `+${candidate}` : candidate;
  else normalized = candidate;

  return { isValid: true, reasonCode: 'valid', reasonMessage: 'Valid phone number', digits, normalized };
}
