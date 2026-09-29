/**
 * When is a WhatsApp conversation a real lead?
 *
 * Accounts can require a valid PAN and email before a record counts as a lead
 * (and is sent to the CRM / LOS). Until then it stays a draft. This module only
 * reads the data already collected; it never changes it.
 *
 * - PAN: a value in PAN format (ABCDE1234F, 4th letter a valid holder type) under
 *   a PAN-like key — typed in the form ("pan", "pan_number", "PAN Card No"…) or
 *   read from the PAN card photo (_collectedDocuments.pan.extractedData.pan_number).
 *   Documents that were rejected (isValid === false) don't count.
 * - Email: the lead's email or an email-like field with a valid address.
 */

export const PAN_PATTERN = /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

export interface LeadQualification {
  qualified: boolean;
  hasPan: boolean;
  hasEmail: boolean;
  /** What is still needed, e.g. ["PAN", "Email"]. */
  missing: string[];
}

export function normalizePan(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const pan = value.toUpperCase().replace(/[\s.-]/g, '');
  return PAN_PATTERN.test(pan) ? pan : null;
}

export function isValidEmail(value: unknown): boolean {
  return typeof value === 'string' && EMAIL_PATTERN.test(value.trim());
}

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// "pan", "pan_number", "panNumber", "PAN Card No", "pancard" — but not "company".
function isPanKey(key: string): boolean {
  return keyTokens(key).some(t => t === 'pan' || /^pan(no|num|number|card|cardno|cardnumber)$/.test(t));
}

function isEmailKey(key: string): boolean {
  return keyTokens(key).some(t => t === 'email' || t === 'mail' || t === 'emailid' || t === 'emailaddress');
}

/** Walks collected data; skips internal state except the document collections, and rejected documents. */
function walk(value: unknown, visit: (key: string, v: unknown) => void, depth = 0, parentKey = ''): void {
  if (depth > 6 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1, parentKey);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (obj.isValid === false) return;
  for (const [key, v] of Object.entries(obj)) {
    if (depth === 0 && key.startsWith('_') && key !== '_collectedDocuments' && key !== '_documents') continue;
    visit(key, v);
    // Inside a document collection, a document keyed "pan"/"pan_card" holds the PAN under any field name.
    walk(v, visit, depth + 1, key);
  }
}

export function evaluateLeadQualification(lead: { customerEmail?: string | null; extractedData?: unknown }): LeadQualification {
  let hasPan = false;
  let hasEmail = isValidEmail(lead.customerEmail);
  walk(lead.extractedData, (key, v) => {
    if (!hasPan && isPanKey(key)) {
      if (normalizePan(v)) hasPan = true;
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        // A PAN document entry: { extractedData: { pan_number | documentNumber | … } }
        const data = ((v as any).extractedData || (v as any).mergedData || v) as Record<string, unknown>;
        if ((v as any).isValid !== false && Object.values(data || {}).some(x => normalizePan(x))) hasPan = true;
      }
    }
    if (!hasEmail && isEmailKey(key) && isValidEmail(v)) hasEmail = true;
  });
  const missing = [...(hasPan ? [] : ['PAN']), ...(hasEmail ? [] : ['Email'])];
  return { qualified: hasPan && hasEmail, hasPan, hasEmail, missing };
}
