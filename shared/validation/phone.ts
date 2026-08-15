export type PhoneValidationMode = '10' | '12' | '8-12' | 'any';

export interface PhoneValidationResult {
  isValid: boolean;
  reasonCode: 'valid' | 'too_short' | 'too_long' | 'invalid_start' | 'all_same_digits' | 'sequential_asc' | 'sequential_desc';
  reasonMessage: string;
  digits: string;
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

export function validatePhoneNumber(phone: string, mode: PhoneValidationMode = '10'): PhoneValidationResult {
  const digits = phone.replace(/[^\d]/g, '');

  let minLen: number, maxLen: number;
  switch (mode) {
    case '10':
      minLen = maxLen = 10;
      break;
    case '12':
      minLen = maxLen = 12;
      break;
    case '8-12':
      minLen = 8;
      maxLen = 12;
      break;
    case 'any':
      minLen = 7;
      maxLen = 15;
      break;
    default:
      minLen = maxLen = 10;
  }

  if (digits.length < minLen) {
    return { isValid: false, reasonCode: 'too_short', reasonMessage: `Phone number must be at least ${minLen} digits`, digits };
  }
  if (digits.length > maxLen) {
    return { isValid: false, reasonCode: 'too_long', reasonMessage: `Phone number must be at most ${maxLen} digits`, digits };
  }

  const localPart = digits.length > 10 ? digits.slice(-10) : digits;

  if (isAllSameDigits(localPart)) {
    return { isValid: false, reasonCode: 'all_same_digits', reasonMessage: 'Phone number cannot have all same digits', digits };
  }
  if (isSequentialAscending(localPart)) {
    return { isValid: false, reasonCode: 'sequential_asc', reasonMessage: 'Phone number cannot be a sequential number', digits };
  }
  if (isSequentialDescending(localPart)) {
    return { isValid: false, reasonCode: 'sequential_desc', reasonMessage: 'Phone number cannot be a sequential number', digits };
  }

  if (mode !== 'any' && localPart.length === 10) {
    const firstDigit = localPart[0];
    if (!['6', '7', '8', '9'].includes(firstDigit)) {
      return { isValid: false, reasonCode: 'invalid_start', reasonMessage: 'Mobile number must start with 6, 7, 8, or 9', digits };
    }
  }

  return { isValid: true, reasonCode: 'valid', reasonMessage: 'Valid phone number', digits };
}
