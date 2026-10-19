/**
 * "Hide contact details after sync": once a website lead has reached the client's CRM, its
 * mobile numbers and emails are overwritten in our database with masked versions, so the
 * conversation can still be read but the details live only in the CRM.
 *
 * Masked values always contain a run of asterisks, which is how the CRM services recognise
 * them and refuse to send them (see `isMaskedValue`).
 */

/** All but the last four digits hidden, keeping the original spacing: "+91 98765 43210" → "+** ***** *3210". */
export function maskPhoneNumber(phone: string): string {
  const total = (phone.match(/\d/g) || []).length;
  if (total <= 4) return phone.replace(/\d/g, "*");
  let seen = 0;
  return phone.replace(/\d/g, d => (++seen > total - 4 ? d : "*"));
}

/** First two letters of the name part kept: "rahul.k@gmail.com" → "ra***@gmail.com". */
export function maskEmailAddress(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  return `${local.slice(0, local.length > 2 ? 2 : 1)}***${email.slice(at)}`;
}

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
// Same phone rules as the log redaction (server/logRedaction.ts), so timestamps, IDs, dates and
// PIN codes are left alone:
// Indian mobile: optional +91 / 91 / 0, then 10 digits starting 6-9 (single spaces or dashes allowed
// between digits, as in "98765 43210"), not part of a longer digit run.
const IN_MOBILE = "(?:\\+?91[\\s-]?|0)?[6-9](?:[\\s-]?\\d){9}";
const IN_MOBILE_IN_TEXT = new RegExp(`(?<![\\d*-])${IN_MOBILE}(?![\\d-])`, "g");
const IN_MOBILE_WHOLE = new RegExp(`^${IN_MOBILE}$`);
// Other countries' numbers written with a leading +.
const INTL_IN_TEXT = /(?<![\w*])\+\d[\d\s-]{8,15}\d(?!\d)/g;

function isPhoneRun(run: string): boolean {
  return IN_MOBILE_WHOLE.test(run) || /^\+\d[\d\s-]{8,15}\d$/.test(run);
}

/** Hides every phone number and email inside free text (chat messages, summaries, answers). */
export function maskContactsInText(text: string): string {
  return text
    .replace(EMAIL_IN_TEXT, e => maskEmailAddress(e))
    .replace(INTL_IN_TEXT, run => maskPhoneNumber(run))
    .replace(IN_MOBILE_IN_TEXT, run => maskPhoneNumber(run));
}

/** Same as maskContactsInText for any JSON value; numbers that look like phone numbers become masked strings. */
export function maskContactsDeep<T>(value: T): T {
  if (typeof value === "string") return maskContactsInText(value) as T;
  if (typeof value === "number" && Number.isInteger(value) && isPhoneRun(String(value))) return maskPhoneNumber(String(value)) as T;
  if (Array.isArray(value)) return value.map(v => maskContactsDeep(v)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskContactsDeep(v);
    return out as T;
  }
  return value;
}

/** A JSON text (e.g. messages.metadata) with contacts hidden; plain text if it isn't JSON. */
export function maskContactsInJsonText(text: string): string {
  try {
    return JSON.stringify(maskContactsDeep(JSON.parse(text)));
  } catch {
    return maskContactsInText(text);
  }
}

/** True for a value this feature produced (or that otherwise looks hidden). Such values must never reach a CRM. */
export function isMaskedValue(value: unknown): boolean {
  return typeof value === "string" && /\*{3,}/.test(value);
}

/** The value, or null when it is a hidden one (used where a visitor or the AI hands back a masked value). */
export function unlessMasked<T extends string | null | undefined>(value: T): T | null {
  return isMaskedValue(value) ? null : value;
}

/** The message a CRM push returns when a lead's details are hidden. */
export const HIDDEN_CONTACTS_MESSAGE = "This lead's contact details are hidden after sync, so it is not sent to the CRM again (the CRM already has the real details).";

/** True when a lead's phone/email were hidden and no real one is left (a CRM can't match or create it). */
export function contactsHidden(lead: { phone?: string | null; email?: string | null }): boolean {
  const hidden = isMaskedValue(lead.phone) || isMaskedValue(lead.email);
  const real = (!!lead.phone && !isMaskedValue(lead.phone)) || (!!lead.email && !isMaskedValue(lead.email));
  return hidden && !real;
}
