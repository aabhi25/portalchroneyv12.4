/**
 * Masks personal data in server logs. Installed once at startup; wraps
 * console.log/info/warn/error/debug so phone numbers and email addresses never
 * reach log storage, whatever the log line. Set LOG_REDACT_PII=false to disable
 * (e.g. while debugging locally).
 *
 * - Emails:  jane.doe@example.com → j***@example.com
 * - Phones:  Indian mobiles (optionally +91 / 0 prefixed) and other 10–13 digit
 *            numbers written with a leading "+" → keep the last 4 digits.
 *   Plain 13-digit runs (e.g. Date.now() timestamps) and UUIDs are left alone.
 * - Aadhaar: 12 digits (optionally grouped 4-4-4) passing the Verhoeff checksum,
 *            and 16-digit VIDs written 4-4-4-4 → keep the last 4 digits.
 * - PAN:     ABCDE1234F → ******234F
 * - Secrets and bank details inside JSON / key=value text (password, secret,
 *   token, auth key, account number, IFSC…) → "[redacted]".
 */

import { verhoeffValid } from "@shared/aadhaar";

const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
// Indian mobile: optional +91/91/0 prefix, then 10 digits starting 6–9, not part of a longer digit run.
const IN_MOBILE_RE = /(?<![\d-])(?:\+?91[\s-]?|0)?([6-9]\d{2})[\s-]?(\d{3})[\s-]?(\d{4})(?![\d-])/g;
// International numbers written with a leading +.
const INTL_RE = /(?<![\w])\+\d[\d\s-]{8,15}\d(?![\d])/g;

// Aadhaar: 12 digits, first 2–9, contiguous or grouped 4-4-4.
const AADHAAR_RE = /(?<![\w-])([2-9]\d{3})([\s-]?)(\d{4})\2(\d{4})(?![\w-])/g;
// VID written in four groups of four.
const VID_RE = /(?<![\w-])\d{4}[\s-]\d{4}[\s-]\d{4}[\s-](\d{4})(?![\w-])/g;
const PAN_RE = /(?<![A-Za-z0-9])[A-Za-z]{3}[PCHFATBLJGpchfatbljg][A-Za-z]\d{4}[A-Za-z](?![A-Za-z0-9])/g;
const SECRET_KEYS = '(?:[a-z_]*password|passwd|pwd|secret|[a-z_]*token|auth_?key|authkey|api_?key|apikey|x-access-token|x-webhook-secret|account_?number|accountnumber|acc_?no|ifsc(?:_?code)?|aadhaar(?:_?number)?|pan(?:_?number)?)';
// "key": "value"  /  "key": 12345
const SECRET_JSON_RE = new RegExp(`("${SECRET_KEYS}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|-?\\d[\\d.]*)`, 'gi');
// key=value / key: value in free text and query strings
const SECRET_KV_RE = new RegExp(`(\\b${SECRET_KEYS}\\s*[=:]\\s*)([^\\s&,;"'}]+)`, 'gi');

export function redactPII(text: string): string {
  return text
    .replace(SECRET_JSON_RE, (_m, key) => `${key}"[redacted]"`)
    .replace(SECRET_KV_RE, (_m, key) => `${key}[redacted]`)
    .replace(VID_RE, (_m, last4) => `****-****-****-${last4}`)
    .replace(AADHAAR_RE, (m, a, _sep, b, c) => verhoeffValid(`${a}${b}${c}`) ? `********${c}` : m)
    .replace(PAN_RE, m => `******${m.slice(-4).toUpperCase()}`)
    .replace(EMAIL_RE, (_m, first, domain) => `${first}***@${domain}`)
    .replace(INTL_RE, m => `+***${m.replace(/\D/g, '').slice(-4)}`)
    .replace(IN_MOBILE_RE, (_m, _a, _b, last4) => `******${last4}`);
}

function redactArg(arg: unknown): unknown {
  if (typeof arg === 'string') return redactPII(arg);
  if (arg instanceof Error) {
    const copy = new Error(redactPII(arg.message));
    copy.name = arg.name;
    copy.stack = arg.stack ? redactPII(arg.stack) : undefined;
    return copy;
  }
  if (arg && typeof arg === 'object') {
    try {
      return JSON.parse(redactPII(JSON.stringify(arg)));
    } catch {
      return arg; // circular or non-serializable: leave as is
    }
  }
  return arg;
}

let installed = false;

export function installLogRedaction() {
  if (installed || process.env.LOG_REDACT_PII === 'false') return;
  installed = true;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => original(...args.map(redactArg));
  }
}
