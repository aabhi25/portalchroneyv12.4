import crypto from 'crypto';
import { createOpenAI } from "../lib/openaiClient";
import path from 'path';
import { eq, and, sql } from 'drizzle-orm';
import {
  CustomCrmSettings, CustomCrmFieldMapping, CrmStoreCredential,
  customCrmSettings, customCrmFieldMappings, crmStoreCredentials, whatsappLeads, whatsappLeadAttachments, businessAccounts,
} from '@shared/schema';
import { db } from '../db';
import { decrypt, safeDecrypt } from './encryptionService';

// Outbound request timeouts. A hung CRM/relay/file host must never pin a sync forever.
// Mutable so tests can shrink them; production code should treat them as constants.
export const CRM_TIMEOUTS = {
  jsonMs: 30_000,      // create-applicant, banking details
  downloadMs: 60_000,  // fetching a stored document before upload
  uploadMs: 120_000,   // document upload (direct or via relay)
};

/** How a failed CRM call should be treated by the retry machinery. */
export type CrmErrorKind = 'transient' | 'permanent' | 'unknown_outcome';

function isTimeoutError(error: any): boolean {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.cause?.name === 'TimeoutError';
}

/** 408/429/5xx are worth retrying; any other 4xx is a request the CRM will keep rejecting. */
export function classifyHttpStatus(status: number): CrmErrorKind {
  if (status === 408 || status === 429 || status >= 500) return 'transient';
  return 'permanent';
}

function validateUrl(baseUrl: string, endpoint: string): { valid: boolean; error?: string; fullUrl: string } {
  const fullUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://')
    ? endpoint
    : `${baseUrl}${endpoint}`;
  try {
    const parsed = new URL(fullUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Only HTTP/HTTPS protocols are allowed', fullUrl };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1' || hostname.endsWith('.local') || hostname.startsWith('10.') || hostname.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
      return { valid: false, error: 'Private/internal network addresses are not allowed', fullUrl };
    }
    return { valid: true, fullUrl };
  } catch {
    return { valid: false, error: 'Invalid URL format', fullUrl };
  }
}

export interface DocumentFile {
  url: string;
  fileName?: string;
  mimeType?: string;
}

export interface CustomCrmLeadContext {
  lead: {
    customerName?: string | null;
    customerEmail?: string | null;
    customerPhone?: string | null;
    senderPhone?: string | null;
  };
  extracted?: Record<string, string | null>;
  documents?: Record<string, DocumentFile[]>;
  storeCredential?: CrmStoreCredential;
}

export function resolveFieldValue(
  sourceType: string,
  sourceField: string | null,
  customValue: string | null,
  leadContext: CustomCrmLeadContext
): string | undefined {
  if (sourceType === 'custom') {
    return customValue || undefined;
  }

  if (sourceType === 'store' && sourceField && leadContext.storeCredential) {
    const cred = leadContext.storeCredential;
    switch (sourceField) {
      case 'store.sid': return cred.sid || undefined;
      case 'store.storeName': return cred.storeName || undefined;
      case 'store.dealerName': return cred.dealerName || undefined;
      case 'store.city': return cred.city || undefined;
      case 'store.storeId': return cred.storeId ? String(cred.storeId) : undefined;
    }
  }

  if (sourceType === 'dynamic' && sourceField) {
    const [category, field] = sourceField.split('.');

    if (category === 'lead') {
      const lead = leadContext.lead;
      switch (field) {
        case 'customerName': return lead.customerName || undefined;
        case 'customerEmail': return lead.customerEmail || undefined;
        case 'customerPhone': return lead.customerPhone || undefined;
        case 'senderPhone': return lead.senderPhone || undefined;
      }
    } else if (category === 'extracted' && leadContext.extracted) {
      const val = leadContext.extracted[field];
      return val !== null && val !== undefined ? String(val) : undefined;
    } else if (category === 'document' && leadContext.documents) {
      const parts = sourceField.split('.');
      const docType = parts[1];
      if (!docType) return undefined;
      const modifier = parts[2];
      const docs = leadContext.documents[docType];
      if (!docs || docs.length === 0) return undefined;

      if (modifier === 'all') {
        return docs.map(d => d.url).filter(Boolean).join(',');
      }
      return docs[0]?.url || undefined;
    }
  }

  return undefined;
}

function cleanNumericValue(value: unknown): string {
  const str = typeof value === 'string' ? value : String(value ?? '');
  const trimmed = str.trim();
  const lakhMatch = trimmed.match(/^([\d,]*\.?\d+)\s*(?:lakh|lakhs|l)\b/i);
  if (lakhMatch) {
    const num = parseFloat(lakhMatch[1].replace(/,/g, ''));
    if (!isNaN(num)) return Math.round(num * 100000).toString();
  }
  const croreMatch = trimmed.match(/^([\d,]*\.?\d+)\s*(?:crore|cr)\b/i);
  if (croreMatch) {
    const num = parseFloat(croreMatch[1].replace(/,/g, ''));
    if (!isNaN(num)) return Math.round(num * 10000000).toString();
  }
  const stripped = trimmed.replace(/,/g, '');
  if (/^\d+(\.\d+)?$/.test(stripped)) return stripped;
  return str;
}

const NUMERIC_CRM_FIELDS = /amount|income|salary|revenue|price|value|loan|emi|fee/i;
const ADDRESS_CRM_FIELDS = /address/i;

function cleanAddressValue(value: string): string {
  return value.replace(/#/g, '');
}

function formatAadhaarAddress(raw: string): string {
  // Strip relationship prefix AND the name that follows it (up to the next comma).
  // Covers all variants found on Indian Aadhaar/government documents:
  //   Abbreviated (with slash, no slash, or space):  S/O  D/O  W/O  H/O  C/O  R/O
  //                                                   SO   DO   WO   HO   CO   RO
  //                                                  S O  D O  W O  H O  C O  R O
  //   Full text (OCR may produce these):  Son of  Daughter of  Wife of
  //                                       Husband of  Care of  Resident of
  const RELATIONSHIP_PREFIX =
    /^(?:[SDHCWR][\/\s]?O|Son\s+of|Daughter\s+of|Wife\s+of|Husband\s+of|Care\s+of|Resident\s+of)[\s:.]*[^,]*,?\s*/i;
  let result = raw.replace(RELATIONSHIP_PREFIX, '');
  // Remove # and / — both rejected by Caprion's API
  result = result.replace(/[#\/]/g, '');
  // Truncate to 100 chars at a word boundary (Caprion field size limit)
  if (result.length > 100) {
    result = result.substring(0, 100).replace(/\s+\S*$/, '').trim();
  }
  return result.trim();
}

export function buildPayload(
  settings: CustomCrmSettings,
  fieldMappings: CustomCrmFieldMapping[],
  leadContext: CustomCrmLeadContext
): Record<string, string> {
  const payload: Record<string, string> = {};

  const enabledMappings = fieldMappings
    .filter(m => m.isEnabled === 'true')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const mapping of enabledMappings) {
    const value = resolveFieldValue(
      mapping.sourceType,
      mapping.sourceField,
      mapping.customValue,
      leadContext
    );
    if (value !== undefined) {
      let cleaned = NUMERIC_CRM_FIELDS.test(mapping.crmField)
        ? cleanNumericValue(value)
        : value;
      if (ADDRESS_CRM_FIELDS.test(mapping.crmField)) {
        cleaned = cleanAddressValue(cleaned);
      }
      payload[mapping.crmField] = cleaned;
    }
  }

  return payload;
}

const CAPRION_FIELD_MAP: Record<string, string> = {
  'Name': 'name',
  'name': 'name',
  'full_name': 'full_name',
  'Mobile': 'contact_number',
  'mobile': 'contact_number',
  'phone': 'contact_number',
  'Phone': 'contact_number',
  'contact_number': 'contact_number',
  'Email': 'email',
  'email': 'email',
  'loan_amount': 'loanamount',
  'loanamount': 'loanamount',
  'amount': 'amount',
  'date_of_birth': 'dob',
  'dateOfBirth': 'dob',
  'dob': 'dob',
  'scheme_name': 'schemeId',
  'scheme_id': 'schemeId',
  'schemeId': 'schemeId',
  'scheme_code': 'scheme_code',
  'pan': 'pan',
  'PAN': 'pan',
  'gender': 'gender',
  'Gender': 'gender',
  'current_address': 'house_address',
  'address': 'house_address',
  'house_address': 'house_address',
  'full_address': 'full_address',
  'permanent_address': 'house_second_address',
  'house_second_address': 'house_second_address',
  'correspondence_full_address': 'correspondence_full_address',
  'correspondence_pincode': 'correspondence_pincode',
  'correspondence_city': 'correspondence_city',
  'correspondence_state': 'correspondence_state',
  'pincode': 'pincode',
  'city': 'city',
  'state': 'state',
  'State': 'state',
  'sid': 'sid',
  'aadhaar': 'aadhaar_number',
  'Aadhaar': 'aadhaar_number',
  'aadhaar_number': 'aadhaar_number',
  'account_no.': 'account_number',
  'account_number': 'account_number',
  'ifsc_code': 'ifsc',
  'ifsc': 'ifsc',
  'monthly_salary': 'monthly_income',
  'monthly_income': 'monthly_income',
  'occupation': 'occupation',
  'company_name': 'company_name',
  'name_of_company': 'name_of_company',
  'loan_type': 'loan_type',
};

// All fields Caprion's Seamless API requires in every request (excluding checksum which is appended last).
// Fields not extracted from the lead are sent as empty string so the payload structure is always complete.
const CAPRION_REQUIRED_FIELDS: string[] = [
  'full_name', 'contact_number', 'email', 'pan', 'aadhaar_number',
  'name_of_company', 'monthly_income', 'occupation',
  'full_address', 'correspondence_full_address',
  'amount', 'scheme_code', 'dob', 'gender',
  'pincode', 'city', 'state',
  'correspondence_pincode', 'correspondence_city', 'correspondence_state',
  'loan_type', 'sid',
];

const CAPRION_ACCEPTED_FIELDS = new Set([
  'sid', 'name', 'full_name', 'email', 'contact_number', 'mobile', 'pan', 'gender', 'dob',
  'loanamount', 'amount', 'callback', 'timestamp', 'checksum',
  'house_address', 'full_address',
  'house_second_address', 'correspondence_full_address',
  'correspondence_pincode', 'correspondence_city', 'correspondence_state',
  'pincode', 'city', 'state', 'schemeId', 'scheme_code', 'URN', 'UDF',
  'edit_name', 'edit_email', 'edit_mobile', 'edit_gender', 'edit_house_address',
  'edit_pincode', 'edit_city', 'edit_state', 'edit_dob',
  'aadhaar_number', 'monthly_income', 'occupation', 'company_name', 'name_of_company', 'loan_type',
]);

export function transformPayloadForCaprion(payload: Record<string, string>): Record<string, string> {
  const transformed: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    const mappedKey = CAPRION_FIELD_MAP[key] || key;
    if (CAPRION_ACCEPTED_FIELDS.has(mappedKey)) {
      transformed[mappedKey] = value;
    } else {
      console.log(`[Caprion] Dropping unmapped field: ${key}`);
    }
  }
  return transformed;
}

export function generateChecksumHmac(
  payload: Record<string, string>,
  secretKey: string
): string {
  const sortedKeys = Object.keys(payload).sort();
  const values = sortedKeys.map(k => payload[k]);
  const dataString = values.join('||');

  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(dataString);
  return hmac.digest('hex');
}

export function generateCaprionChecksum(
  payload: Record<string, string>,
  secretKey: string
): string {
  const sortedKeys = Object.keys(payload).sort();
  const values = sortedKeys.map(k => String(payload[k] ?? '').trim());
  const dataString = values.join('||');
  const stringWithSecret = dataString + secretKey;

  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(stringWithSecret);
  return hmac.digest('hex');
}

export function verifyCaprionWebhookChecksum(
  loanId: string,
  loanAmount: string,
  urn: string,
  status: string,
  timestamp: string,
  receivedChecksum: string,
  secretKey: string
): boolean {
  if (!receivedChecksum || typeof receivedChecksum !== 'string') return false;
  const cleaned = receivedChecksum.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleaned)) return false;

  const dataString = `${loanId}|${loanAmount}|${urn}|${status}|${timestamp}`;
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(dataString);
  const computed = hmac.digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(cleaned, 'hex'));
  } catch {
    return false;
  }
}

export interface SyncLeadResult {
  success: boolean;
  leadId?: string;
  applicationId?: string;
  applicantId?: string;
  message: string;
  payload?: Record<string, string>;
  responseData?: any;
  /** Set on failure: whether retrying can help (see CrmErrorKind). */
  errorKind?: CrmErrorKind;
}

export async function syncLead(
  settings: CustomCrmSettings,
  fieldMappings: CustomCrmFieldMapping[],
  leadContext: CustomCrmLeadContext,
  storeCredential?: CrmStoreCredential
): Promise<SyncLeadResult> {
  try {
    if (storeCredential) {
      leadContext.storeCredential = storeCredential;
    }

    const payload = buildPayload(settings, fieldMappings, leadContext);

    if (Object.keys(payload).length === 0) {
      return {
        success: false,
        message: 'No field mappings configured or no data available for sync',
        errorKind: 'permanent',
      };
    }

    let secretForChecksum: string | undefined;

    if (settings.authType === 'checksum_caprion') {
      if (!storeCredential) {
        return {
          success: false,
          message: 'Caprion auth requires a matched store credential. Ensure the lead has a store_name that matches a configured store.',
          payload,
          errorKind: 'permanent',
        };
      }
      try {
        secretForChecksum = decrypt(storeCredential.secret);
      } catch (e) {
        console.error('[CustomCRM] Failed to decrypt store secret:', e);
        return { success: false, message: 'Failed to decrypt store credential secret', errorKind: 'permanent' };
      }
    } else if (settings.authType === 'checksum_hmac') {
      if (storeCredential) {
        try {
          secretForChecksum = decrypt(storeCredential.secret);
        } catch (e) {
          console.error('[CustomCRM] Failed to decrypt store secret:', e);
          return { success: false, message: 'Failed to decrypt store credential secret', errorKind: 'permanent' };
        }
      } else if (settings.authKey) {
        try {
          secretForChecksum = decrypt(settings.authKey);
        } catch (e) {
          console.error('[CustomCRM] Failed to decrypt authKey:', e);
          return { success: false, message: 'Failed to decrypt authentication key', errorKind: 'permanent' };
        }
      }
    }

    let decryptedAuthKey: string | undefined;
    if (settings.authKey) {
      try {
        decryptedAuthKey = decrypt(settings.authKey);
      } catch (e) {
        console.error('[CustomCRM] Failed to decrypt authKey:', e);
        return { success: false, message: 'Failed to decrypt authentication key', errorKind: 'permanent' };
      }
    }

    if (settings.authType === 'checksum_caprion' && storeCredential) {
      if (!payload['sid'] && storeCredential.sid) {
        payload['sid'] = storeCredential.sid;
      }
    }

    if (settings.authType === 'checksum_caprion') {
      const caprionPayload = transformPayloadForCaprion(payload);
      // Normalize aadhaar_number — strip all spaces (e.g. "8468 6846 2917" → "846868462917")
      if (caprionPayload['aadhaar_number']) {
        caprionPayload['aadhaar_number'] = caprionPayload['aadhaar_number'].replace(/\s+/g, '');
      }
      // Normalize monthly_income — strip commas (e.g. "2,00,000" → "200000")
      if (caprionPayload['monthly_income']) {
        caprionPayload['monthly_income'] = caprionPayload['monthly_income'].replace(/,/g, '');
      }
      // Normalize dob to YYYY-MM-DD (Caprion expects ISO format)
      if (caprionPayload['dob']) {
        const raw = caprionPayload['dob'];
        // Convert DD/MM/YYYY or DD-MM-YYYY → YYYY-MM-DD
        const dmyMatch = raw.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
        if (dmyMatch) {
          caprionPayload['dob'] = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        }
      }
      // Format Aadhaar-extracted address fields: strip relationship prefix + name, preserve slashes
      if (caprionPayload['full_address']) {
        caprionPayload['full_address'] = formatAadhaarAddress(caprionPayload['full_address']);
      }
      if (caprionPayload['correspondence_full_address']) {
        caprionPayload['correspondence_full_address'] = formatAadhaarAddress(caprionPayload['correspondence_full_address']);
      }
      // Normalize occupation — Caprion only accepts specific enum values.
      // Map free-text job titles captured from WhatsApp to the closest valid category.
      if (caprionPayload['occupation']) {
        const occ = caprionPayload['occupation'].toLowerCase().trim();
        const CAPRION_OCCUPATION_CANONICAL: Record<string, string> = {
          'salaried': 'Salaried',
          'self-employed': 'Self-Employed',
          'business': 'Business',
          'professional': 'Professional',
        };
        if (CAPRION_OCCUPATION_CANONICAL[occ]) {
          // Already a valid type — ensure canonical casing (e.g. "SALARIED" → "Salaried")
          caprionPayload['occupation'] = CAPRION_OCCUPATION_CANONICAL[occ];
        } else {
          // Map free-text job titles captured from WhatsApp to the closest valid category
          let mapped: string;
          if (/salar|employee|employed|job|service|staff|clerk|officer|executive|manager|analyst|developer|engineer|programmer|teacher|professor|lecturer|nurse|paramedic|technician|accountant|banker|consultant|designer|architect|scientist/.test(occ)) {
            mapped = 'Salaried';
          } else if (/self.?employ|freelanc|independen|proprietor|own|partner/.test(occ)) {
            mapped = 'Self-Employed';
          } else if (/business|entrepreneur|merchant|trader|manufacturer|shop|retail|wholesale|distribut/.test(occ)) {
            mapped = 'Business';
          } else if (/doctor|physician|surgeon|dentist|lawyer|advocate|solicitor|chartered|ca |cma|cs |legal|medical|pharma/.test(occ)) {
            mapped = 'Professional';
          } else {
            mapped = 'Salaried';
          }
          console.log(`[Caprion] Normalized occupation: "${occ}" → "${mapped}"`);
          caprionPayload['occupation'] = mapped;
        }
      }
      // Do NOT add timestamp or callback — Caprion Seamless API does not use them in checksum
      Object.keys(payload).forEach(k => delete payload[k]);
      Object.assign(payload, caprionPayload);

      // Ensure every required Caprion field is present — fill missing ones with '' so the
      // API always receives a complete, structurally-consistent payload.
      const defaultedFields: string[] = [];
      for (const field of CAPRION_REQUIRED_FIELDS) {
        if (payload[field] === undefined || payload[field] === null) {
          payload[field] = '';
          defaultedFields.push(field);
        }
      }
      if (defaultedFields.length > 0) {
        console.log(`[Caprion] Defaulted missing required fields to '': ${defaultedFields.join(', ')}`);
      }
      console.log(`[Caprion] Transformed payload fields: ${Object.keys(payload).join(', ')}`);
    }

    // Never log field values or the checksum input: the payload carries Aadhaar, PAN,
    // DOB, income and address. Field names and counts are enough to debug a mapping.
    if (settings.authType === 'checksum_caprion' && secretForChecksum) {
      payload['checksum'] = generateCaprionChecksum(payload, secretForChecksum);
    } else if (settings.authType === 'checksum_hmac' && secretForChecksum) {
      payload['Checksum'] = generateChecksumHmac(payload, secretForChecksum);
    }

    const emptyFields = Object.keys(payload).filter(k => !String(payload[k] ?? '').trim());
    console.log(`[CustomCRM] Payload ready: ${Object.keys(payload).length} field(s), ${emptyFields.length} empty${emptyFields.length ? ` (${emptyFields.join(', ')})` : ''}`);

    const urlValidation = validateUrl(settings.apiBaseUrl || '', settings.apiEndpoint || '');
    if (!urlValidation.valid) {
      return { success: false, message: urlValidation.error || 'Invalid API URL', payload, errorKind: 'permanent' };
    }
    const url = urlValidation.fullUrl;

    const headers: Record<string, string> = {};

    if (settings.authType === 'api_key' && decryptedAuthKey) {
      const headerName = settings.authHeaderName || 'X-Api-Key';
      headers[headerName] = decryptedAuthKey;
    } else if (settings.authType === 'bearer' && decryptedAuthKey) {
      headers['Authorization'] = `Bearer ${decryptedAuthKey}`;
    }

    let response: Response;
    const method = settings.httpMethod || 'POST';

    if (settings.relayUrl) {
      // Route through India relay server instead of calling CRM directly
      // Strip trailing slash and any accidental /relay suffix before appending /relay
      const relayBase = settings.relayUrl.replace(/\/relay\/?$/, '').replace(/\/$/, '');
      const relayEndpoint = relayBase + '/relay';
      console.log(`[CustomCRM] Routing via relay: ${relayEndpoint} → ${url}`);

      const relayHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      const relaySecret = process.env.CUSTOM_CRM_RELAY_SECRET;
      if (relaySecret) {
        relayHeaders['Authorization'] = `Bearer ${relaySecret}`;
      }

      const relayBody: Record<string, unknown> = {
        targetUrl: url,
        method,
        headers,
      };

      if (settings.contentType === 'json') {
        // JSON path: send serialised body string — relay forwards as application/json
        relayBody.body = JSON.stringify(payload);
        relayBody.contentType = 'application/json';
      } else {
        // Form-data path: send raw key-value object as `fields` so the relay can
        // reconstruct a proper multipart/form-data request using the FormData API.
        // This is intentionally different from `body` (a pre-serialised string) and
        // preserves the exact wire format that Caprion and other CRMs expect —
        // the relay sets the multipart boundary automatically, identical to the
        // direct-fetch path (relay-server.js handles contentType === 'form-data').
        relayBody.fields = payload;
        relayBody.contentType = 'form-data';
      }

      response = await fetch(relayEndpoint, {
        method: 'POST',
        headers: relayHeaders,
        body: JSON.stringify(relayBody),
        signal: AbortSignal.timeout(CRM_TIMEOUTS.jsonMs),
      });
    } else if (settings.contentType === 'json') {
      headers['Content-Type'] = 'application/json';
      response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CRM_TIMEOUTS.jsonMs),
      });
    } else {
      const formData = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        formData.append(key, value);
      }
      response = await fetch(url, {
        method,
        headers,
        body: formData,
        signal: AbortSignal.timeout(CRM_TIMEOUTS.jsonMs),
      });
    }

    const responseText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    // The CRM echoes submitted fields back, so the body is not logged — only its shape.
    console.log(`[CustomCRM] Response status: ${response.status} - Content-Type: ${contentType} - ${responseText.length} bytes`);

    let responseData: any;
    let isJsonResponse = false;
    try {
      responseData = JSON.parse(responseText);
      isJsonResponse = true;
    } catch {
      responseData = { raw: responseText };
    }

    if (!response.ok) {
      const httpLabel = `HTTP ${response.status} ${response.statusText}`;
      const crmMsg = isJsonResponse
        ? (responseData?.message || responseData?.error || responseData?.ExceptionMessage || null)
        : null;
      const message = crmMsg
        ? `CRM_SYNC_ERROR[json_error]: ${crmMsg} (${httpLabel})`
        : `CRM_SYNC_ERROR[http_error]: ${httpLabel}`;
      return { success: false, message, payload, responseData, errorKind: classifyHttpStatus(response.status) };
    }

    if (!isJsonResponse) {
      const isHtml = responseText.trimStart().startsWith('<');
      const message = isHtml
        ? `CRM_SYNC_ERROR[html_response]: Caprion returned a server-side error page (HTTP 200 with HTML body). Check Caprion server logs or contact Caprion support.`
        : `CRM_SYNC_ERROR[unknown]: CRM returned a non-JSON response (HTTP 200).`;
      // An HTML error page is a server-side crash, worth another try later.
      return { success: false, message, payload, responseData, errorKind: 'transient' };
    }

    if (responseData?.success === 0 || responseData?.success === '0' || responseData?.success === false) {
      const crmMsg = responseData?.message || responseData?.error || responseData?.ExceptionMessage || 'CRM returned a failure response with no message';
      return {
        success: false,
        message: `CRM_SYNC_ERROR[json_error]: ${crmMsg}`,
        payload,
        responseData,
        errorKind: 'permanent',
      };
    }

    const nestedData = responseData?.data;
    const dataObj = Array.isArray(nestedData) ? nestedData[0] : (nestedData && typeof nestedData === 'object' ? nestedData : null);

    const leadId = responseData?.id || responseData?.Id || responseData?.leadId || responseData?.lead_id
      || dataObj?.id || dataObj?.Id || dataObj?.leadId || dataObj?.lead_id || undefined;
    const applicationId = responseData?.ApplicationId || responseData?.application_id || responseData?.applicationId
      || dataObj?.ApplicationId || dataObj?.application_id || dataObj?.applicationId || undefined;
    const applicantId = responseData?.ApplicantId || responseData?.applicant_id || responseData?.applicantId
      || dataObj?.ApplicantId || dataObj?.applicant_id || dataObj?.applicantId || undefined;

    return {
      success: true,
      leadId: leadId ? String(leadId) : undefined,
      applicationId: applicationId ? String(applicationId) : undefined,
      applicantId: applicantId ? String(applicantId) : undefined,
      message: `Lead synced successfully to ${settings.name || 'Custom CRM'}`,
      payload,
      responseData,
    };
  } catch (error: any) {
    // A timeout means the request may have reached the CRM and created the application
    // before the response was lost. Retrying blindly could create a duplicate applicant.
    if (isTimeoutError(error)) {
      console.error(`[CustomCRM] syncLead timed out after ${CRM_TIMEOUTS.jsonMs}ms`);
      return {
        success: false,
        message: `CRM_SYNC_ERROR[network_error]: no response within ${Math.round(CRM_TIMEOUTS.jsonMs / 1000)}s — the application may have been created. Check the CRM before syncing again.`,
        errorKind: 'unknown_outcome',
      };
    }
    console.error('[CustomCRM] syncLead error:', error?.message || error, error?.cause?.code || '');
    // Node's fetch wraps socket errors: the code sits on error.cause.
    const code = error?.code || error?.cause?.code;
    const isNetwork = code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'EAI_AGAIN' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ERR_INVALID_URL' || (error?.message || '').toLowerCase().includes('fetch failed');
    const token = isNetwork ? 'network_error' : 'unknown';
    // ECONNRESET after the request was written is ambiguous; everything else here failed
    // before the CRM could act on the request.
    const errorKind: CrmErrorKind = code === 'ECONNRESET' ? 'unknown_outcome' : 'transient';
    return {
      success: false,
      message: `CRM_SYNC_ERROR[${token}]: ${error?.message || 'Failed to sync lead to Custom CRM'}${code ? ` (${code})` : ''}`,
      errorKind,
    };
  }
}

export interface DocumentUploadResult {
  documentType: string;
  /** Stable identity of the file (`category|url`), used to resume only the missing uploads. */
  documentKey?: string;
  success: boolean;
  message: string;
  responseData?: any;
}

export function documentKeyFor(docCategory: string, file: DocumentFile): string {
  // Without the query string: a presigned URL changes every time it is built.
  return `${docCategory.toLowerCase()}|${file.url.split('?')[0]}`;
}

export interface DocumentUploadOptions {
  /** Files already accepted by the CRM on an earlier attempt — not sent again. */
  skipKeys?: Set<string>;
  /** Called after each upload that the CRM accepted (used to checkpoint progress). */
  onUploaded?: (documentKey: string) => Promise<void> | void;
}

export async function uploadDocumentsToCaprion(
  settings: CustomCrmSettings,
  applicationId: string,
  applicantId: string,
  documents: Record<string, DocumentFile[]>,
  storeCredential: CrmStoreCredential,
  documentTypeMapping?: Record<string, string>,
  bankStatementPassword?: string | null,
  options: DocumentUploadOptions = {}
): Promise<DocumentUploadResult[]> {
  const results: DocumentUploadResult[] = [];

  // Explicit allow-list of source categories that may carry a bank-statement password.
  // Kept in sync with the bank-statement entries in defaultDocTypeMap below.
  const BANK_STATEMENT_CATEGORIES = new Set([
    'bank_statement',
    'bankstatement',
    'optransactionhistory',
    'op_transaction_history',
    'transaction_history',
  ]);

  const defaultDocTypeMap: Record<string, string> = {
    'pan': 'PAN Card',
    'pan_card': 'PAN Card',
    'aadhaar': 'Aadhaar Card',
    'aadhaar_card': 'Aadhaar Card',
    'aadhar': 'Aadhaar Card',
    'bank_statement': 'Bank Statement',
    'bankstatement': 'Bank Statement',
    'salary_slip': 'Salary Slip',
    'salaryslip': 'Salary Slip',
    'itr': 'ITR',
    'optransactionhistory': 'Bank Statement',
    'op_transaction_history': 'Bank Statement',
    'transaction_history': 'Bank Statement',
    'bank_passbook': 'Bank Passbook',
    'address_proof': 'Address Proof',
    'photo': 'Photo',
    'photograph': 'Photo',
    'signature': 'Signature',
    'cheque': 'Cancelled Cheque',
    'cancelled_cheque': 'Cancelled Cheque',
    'form_16': 'Form 16',
    'form16': 'Form 16',
    'gst_certificate': 'GST Certificate',
    'business_proof': 'Business Proof',
    'property_document': 'Property Document',
    'cibil': 'CIBIL Report',
    'cibil_report': 'CIBIL Report',
    'voter_id': 'Voter ID',
    'driving_license': 'Driving License',
    'passport': 'Passport',
  };

  const docTypeMap = { ...defaultDocTypeMap, ...documentTypeMapping };

  let decryptedSecret: string;
  try {
    decryptedSecret = decrypt(storeCredential.secret);
  } catch (e) {
    console.error('[CustomCRM] Failed to decrypt store secret for doc upload:', e);
    return [{
      documentType: 'all',
      success: false,
      message: 'Failed to decrypt store credential secret',
    }];
  }

  const uploadEndpoint = (settings.apiBaseUrl || '').replace(/\/$/, '') + '/api/apiintegration/v4/UploadDocument';

  const urlValidation = validateUrl(uploadEndpoint, '');
  if (!urlValidation.valid) {
    return [{
      documentType: 'all',
      success: false,
      message: urlValidation.error || 'Invalid upload URL',
    }];
  }

  for (const [docCategory, files] of Object.entries(documents)) {
    const caprionDocType = docTypeMap[docCategory.toLowerCase()] || docCategory;

    for (const file of files) {
      const documentKey = documentKeyFor(docCategory, file);
      if (options.skipKeys?.has(documentKey)) {
        continue;
      }
      try {
        const fileUrlValidation = validateUrl(file.url, '');
        if (!fileUrlValidation.valid) {
          results.push({
            documentType: caprionDocType,
            documentKey,
            success: false,
            message: `Invalid document URL: ${fileUrlValidation.error}`,
          });
          continue;
        }

        console.log(`[CustomCRM] Uploading document: ${caprionDocType} (AppId: ${applicationId})`);

        const fileResponse = await fetch(file.url, { signal: AbortSignal.timeout(CRM_TIMEOUTS.downloadMs) });
        if (!fileResponse.ok) {
          results.push({
            documentType: caprionDocType,
            documentKey,
            success: false,
            message: `Failed to download ${caprionDocType} from storage: HTTP ${fileResponse.status}`,
          });
          continue;
        }

        // Download as buffer so we can convert if needed
        let fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
        // Normalise mimeType to lowercase; handle content-type with params like "image/HEIC; charset=..."
        let mimeType = (file.mimeType || 'image/jpeg').toLowerCase().split(';')[0].trim();
        let wasConverted = false;

        // Convert HEIC/HEIF → JPEG (Caprion does not accept .heic/.heif extension).
        // We also need to upload the converted bytes directly — relay cannot re-fetch
        // the converted content from the original URL, so converted files bypass relay.
        // Covers variants: image/heic, image/heif, image/heic-sequence, image/heif-sequence
        if (mimeType === 'image/heic' || mimeType === 'image/heif' ||
            mimeType === 'image/heic-sequence' || mimeType === 'image/heif-sequence') {
          try {
            const heicConvert = (await import('heic-convert')).default;
            fileBuffer = Buffer.from(await heicConvert({
              buffer: fileBuffer,
              format: 'JPEG',
              quality: 0.9,
            }));
            mimeType = 'image/jpeg';
            wasConverted = true;
            console.log(`[Caprion DocUpload] Converted HEIC/HEIF → JPEG for ${caprionDocType}`);
          } catch (e) {
            console.warn(`[Caprion DocUpload] HEIC conversion failed, proceeding as-is:`, e);
          }
        }

        // Derive file extension — WhatsApp media IDs have no extension; Caprion requires one.
        // Only include Caprion-accepted extensions (jpg,png,jpeg,doc,docx,pdf,xlsx,csv,txt,xls,ppt,pptx).
        // Normalise image/jpeg → .jpg (not .jpeg, which some Caprion validators may reject).
        const CAPRION_EXT_MAP: Record<string, string> = {
          'image/jpeg': '.jpg',
          'image/jpg': '.jpg',
          'image/png': '.png',
          'image/heic': '.jpg',
          'image/heif': '.jpg',
          'image/heic-sequence': '.jpg',
          'image/heif-sequence': '.jpg',
          'application/pdf': '.pdf',
          'application/msword': '.doc',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
          'application/vnd.ms-excel': '.xls',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
          'text/csv': '.csv',
          'text/plain': '.txt',
          'application/vnd.ms-powerpoint': '.ppt',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
        };
        const existingExt = path.extname(file.fileName || '').toLowerCase();
        const derivedExt = CAPRION_EXT_MAP[mimeType] || '.jpg';

        // If we converted from HEIC, always force .jpg — never preserve the original .heic/.heif ext.
        const finalExt = wasConverted ? '.jpg' : (existingExt || derivedExt);
        const baseName = file.fileName
          ? (existingExt ? path.basename(file.fileName, existingExt) : file.fileName)
          : `${docCategory}_document`;
        const fileName = `${baseName}${finalExt}`;

        if (!existingExt || wasConverted) {
          console.log(`[Caprion DocUpload] Filename extension resolved to "${finalExt}" (mimeType: ${mimeType}${wasConverted ? ', HEIC converted' : ''})`);
        }

        const fileBlob = new Blob([fileBuffer], { type: mimeType });

        const metaPayload: Record<string, string> = {
          sid: storeCredential.sid,
          application_id: applicationId,
          document_type: caprionDocType,
          remarks: `${caprionDocType} uploaded via WhatsApp`,
        };

        // Bank statement PDFs from WhatsApp may be password-protected. We decrypt them on our
        // side for AI extraction but upload the original encrypted PDF to Caprion. Pass the
        // password through so back-office staff can open the file in Caprion's UI later.
        // Tightened guard: only when the source category is an explicit bank-statement variant
        // AND the file is a PDF — prevents leaking the password on a misclassified image upload.
        const isBankStatementCategory = BANK_STATEMENT_CATEGORIES.has(docCategory.toLowerCase());
        if (
          caprionDocType === 'Bank Statement' &&
          isBankStatementCategory &&
          mimeType === 'application/pdf' &&
          bankStatementPassword
        ) {
          metaPayload['is_password_protected'] = 'Yes';
          metaPayload['document_password'] = bankStatementPassword;
        }

        // Log field names only — never values (document_password, sid) or the file URL.
        console.log(`[Caprion DocUpload] Payload fields: ${Object.keys(metaPayload).join(', ')}`);
        const checksum = generateCaprionChecksum(metaPayload, decryptedSecret);

        let response: Response;

        // For files that were locally converted (HEIC → JPEG), the relay cannot re-fetch the
        // converted bytes from the original URL (it would download the original HEIC). So we
        // always upload converted files directly with the converted blob, regardless of relay setting.
        const useDirectUpload = wasConverted || !settings.relayUrl;

        if (!useDirectUpload) {
          const relayBase = settings.relayUrl!.replace(/\/relay\/?$/, '').replace(/\/$/, '');
          const relayEndpoint = relayBase + '/relay';
          console.log(`[CustomCRM] Routing doc upload via relay: ${relayEndpoint} → ${uploadEndpoint}`);

          const relayHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
          const relaySecret = process.env.CUSTOM_CRM_RELAY_SECRET;
          if (relaySecret) relayHeaders['Authorization'] = `Bearer ${relaySecret}`;

          response = await fetch(relayEndpoint, {
            method: 'POST',
            headers: relayHeaders,
            body: JSON.stringify({
              targetUrl: uploadEndpoint,
              method: 'POST',
              contentType: 'form-data-with-file',
              fields: {
                ...metaPayload,
                checksum,
              },
              fileUrl: file.url,
              fileField: 'files[]',
              fileName,
              fileMimeType: mimeType,
            }),
            signal: AbortSignal.timeout(CRM_TIMEOUTS.uploadMs),
          });
        } else {
          if (wasConverted && settings.relayUrl) {
            console.log(`[CustomCRM] HEIC converted — uploading converted JPEG directly (bypassing relay)`);
          }
          const formData = new FormData();
          for (const [key, value] of Object.entries(metaPayload)) {
            formData.append(key, value);
          }
          formData.append('checksum', checksum);
          formData.append('files[]', fileBlob, fileName);

          response = await fetch(uploadEndpoint, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(CRM_TIMEOUTS.uploadMs),
          });
        }

        const responseText = await response.text();

        // Caprion echoes request fields back in the response body, including document_password.
        // Mask it before logging or persisting to result.responseData so plaintext credentials
        // never reach prod logs or any downstream consumer of the result.
        const safeResponseText = responseText.replace(
          /"document_password"\s*:\s*"[^"]*"/g,
          '"document_password":"***"'
        );
        let responseData: any;
        try {
          responseData = JSON.parse(safeResponseText);
        } catch {
          responseData = { raw: safeResponseText };
        }

        // Caprion reports some rejections as HTTP 200 with success: 0.
        const rejectedInBody = responseData?.success === 0 || responseData?.success === '0' || responseData?.success === false;
        console.log(`[CustomCRM] Document upload response (${caprionDocType}): ${response.status}${rejectedInBody ? ' (rejected in body)' : ''}`);

        if (response.ok && !rejectedInBody) {
          results.push({
            documentType: caprionDocType,
            documentKey,
            success: true,
            message: `${caprionDocType} uploaded successfully`,
            responseData,
          });
          try {
            await options.onUploaded?.(documentKey);
          } catch (e: any) {
            console.error(`[CustomCRM] Failed to checkpoint upload of ${caprionDocType}:`, e?.message || e);
          }
        } else {
          const errorMsg = responseData?.message || responseData?.error || responseData?.ExceptionMessage || `HTTP ${response.status}`;
          results.push({
            documentType: caprionDocType,
            documentKey,
            success: false,
            message: `Failed to upload ${caprionDocType}: ${errorMsg}`,
            responseData,
          });
        }
      } catch (error: any) {
        const timedOut = isTimeoutError(error);
        console.error(`[CustomCRM] Document upload error (${caprionDocType}): ${timedOut ? 'timed out' : (error?.message || error)}`);
        results.push({
          documentType: caprionDocType,
          documentKey,
          success: false,
          message: timedOut ? `Upload of ${caprionDocType} timed out` : (error.message || `Failed to upload ${caprionDocType}`),
        });
      }
    }
  }

  return results;
}

async function uploadBankingDetailsToCaprion(
  settings: CustomCrmSettings,
  applicationId: string,
  accountNumber: string | null | undefined,
  ifscCode: string | null | undefined,
  storeCredential: CrmStoreCredential
): Promise<{ success: boolean; message: string }> {
  if (!accountNumber && !ifscCode) {
    return { success: false, message: 'No banking data to upload' };
  }

  let decryptedSecret: string;
  try {
    decryptedSecret = decrypt(storeCredential.secret);
  } catch (e) {
    console.error('[CustomCRM] Failed to decrypt store secret for banking upload:', e);
    return { success: false, message: 'Failed to decrypt store credential secret' };
  }

  const bankingEndpoint = (settings.apiBaseUrl || '').replace(/\/$/, '') + '/api/apiintegration/v4/AddBankingDetails';

  const urlValidation = validateUrl(bankingEndpoint, '');
  if (!urlValidation.valid) {
    return { success: false, message: urlValidation.error || 'Invalid banking API URL' };
  }

  const payload: Record<string, string> = {
    sid: storeCredential.sid || '',
    application_id: applicationId,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  };
  if (accountNumber) payload['banking_details[account_number]'] = accountNumber;
  if (ifscCode) payload['banking_details[ifsc]'] = ifscCode;

  payload['checksum'] = generateCaprionChecksum(payload, decryptedSecret);

  // Account number and IFSC are never logged; only which of them is being sent.
  console.log(`[Caprion BankingUpload] Fields: ${Object.keys(payload).filter(k => k !== 'checksum').join(', ')}`);

  try {
    let response: Response;
    console.log(`[CustomCRM] Uploading banking details for AppId: ${applicationId}`);

    if (settings.relayUrl) {
      const relayBase = settings.relayUrl.replace(/\/relay\/?$/, '').replace(/\/$/, '');
      const relayEndpoint = relayBase + '/relay';
      console.log(`[CustomCRM] Routing banking upload via relay: ${relayEndpoint} → ${bankingEndpoint}`);

      const relayHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      const relaySecret = process.env.CUSTOM_CRM_RELAY_SECRET;
      if (relaySecret) relayHeaders['Authorization'] = `Bearer ${relaySecret}`;

      response = await fetch(relayEndpoint, {
        method: 'POST',
        headers: relayHeaders,
        body: JSON.stringify({
          targetUrl: bankingEndpoint,
          method: 'POST',
          contentType: 'form-data',
          fields: payload,
        }),
        signal: AbortSignal.timeout(CRM_TIMEOUTS.jsonMs),
      });
    } else {
      const formData = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        formData.append(key, value);
      }
      response = await fetch(bankingEndpoint, { method: 'POST', body: formData, signal: AbortSignal.timeout(CRM_TIMEOUTS.jsonMs) });
    }

    const responseText = await response.text();

    let responseData: any = null;
    try { responseData = JSON.parse(responseText); } catch { /* non-JSON body */ }
    const rejectedInBody = responseData?.success === 0 || responseData?.success === '0' || responseData?.success === false;

    // The CRM echoes the account number back, so response bodies are not logged or returned.
    if (response.ok && !rejectedInBody) {
      console.log(`[CustomCRM] Banking details uploaded successfully (AppId: ${applicationId})`);
      return { success: true, message: 'Banking details uploaded successfully' };
    } else {
      const crmMsg = typeof responseData?.message === 'string' ? `: ${responseData.message.slice(0, 200)}` : '';
      console.error(`[CustomCRM] Banking details upload failed (${response.status}${rejectedInBody ? ', rejected in body' : ''})`);
      return { success: false, message: `Banking upload failed with status ${response.status}${crmMsg}` };
    }
  } catch (e: any) {
    const timedOut = isTimeoutError(e);
    console.error(`[CustomCRM] Banking details upload error: ${timedOut ? 'timed out' : (e?.message || e)}`);
    return { success: false, message: timedOut ? 'Banking upload timed out' : (e.message || 'Banking upload request failed') };
  }
}

/** Progress from an earlier attempt that already created the application in the CRM. */
export interface SyncResumeState {
  leadId?: string | null;
  applicationId?: string | null;
  applicantId?: string | null;
  bankingUploaded?: boolean;
  uploadedDocKeys?: string[];
}

export interface SyncLeadWithDocumentsOptions {
  /** When set (with an applicationId), the applicant is NOT created again — only missing banking/documents are sent. */
  resume?: SyncResumeState;
  /** Checkpoint hooks, called as soon as each step is accepted by the CRM. */
  onLeadCreated?: (ids: { leadId?: string; applicationId?: string; applicantId?: string }) => Promise<void> | void;
  onBankingUploaded?: () => Promise<void> | void;
  onDocumentUploaded?: (documentKey: string) => Promise<void> | void;
}

export type SyncLeadWithDocumentsResult = SyncLeadResult & {
  documentResults?: DocumentUploadResult[];
  bankingResult?: { success: boolean; message: string };
  /** synced = everything accepted; partial = applicant exists but banking/documents are missing; failed = no applicant. */
  outcome: 'synced' | 'partial' | 'failed';
  /** True when the applicant exists in the CRM (created now or on an earlier attempt). */
  created: boolean;
  bankingUploaded?: boolean;
  uploadedDocKeys?: string[];
  failedDocuments?: string[];
};

export async function syncLeadWithDocuments(
  settings: CustomCrmSettings,
  fieldMappings: CustomCrmFieldMapping[],
  leadContext: CustomCrmLeadContext,
  storeCredential?: CrmStoreCredential,
  options: SyncLeadWithDocumentsOptions = {}
): Promise<SyncLeadWithDocumentsResult> {
  const resume = options.resume;
  let leadResult: SyncLeadResult;

  if (resume?.applicationId) {
    if (settings.authType === 'checksum_caprion' && !storeCredential) {
      return {
        success: false,
        outcome: 'partial',
        created: true,
        errorKind: 'permanent',
        applicationId: resume.applicationId,
        message: `CRM_SYNC_ERROR[partial_documents]: Lead created in CRM (AppId ${resume.applicationId}) but its store credential is no longer available, so documents cannot be uploaded`,
      };
    }
    console.log(`[CustomCRM] Resuming AppId ${resume.applicationId} — applicant already created, sending only missing items`);
    leadResult = {
      success: true,
      leadId: resume.leadId || undefined,
      applicationId: resume.applicationId,
      applicantId: resume.applicantId || undefined,
      message: `Lead already in ${settings.name || 'Custom CRM'}`,
    };
  } else {
    leadResult = await syncLead(settings, fieldMappings, leadContext, storeCredential);
    if (!leadResult.success) {
      return { ...leadResult, outcome: 'failed', created: false };
    }
    try {
      await options.onLeadCreated?.({ leadId: leadResult.leadId, applicationId: leadResult.applicationId, applicantId: leadResult.applicantId });
    } catch (e: any) {
      console.error('[CustomCRM] Failed to checkpoint created lead:', e?.message || e);
    }
  }

  let finalResult: SyncLeadWithDocumentsResult = { ...leadResult, outcome: 'synced', created: true };
  const problems: string[] = [];
  let partialKind: CrmErrorKind = 'transient';
  const documents = leadContext.documents || {};
  const hasDocuments = Object.values(documents).some(files => files && files.length > 0);

  if (settings.authType === 'checksum_caprion' && storeCredential && leadResult.applicationId) {
    const extracted = leadContext.extracted || {};

    // Banking details — separate endpoint
    // Resolve via CRM field mappings first (honoring the configured source field),
    // then fall back to flat extracted keys for backward compatibility.
    const ACCOUNT_NO_CRM_KEYS = ['account_no', 'account_no.', 'account_number', 'banking_details.account_number'];
    const IFSC_CRM_KEYS = ['ifsc_code', 'ifsc', 'banking_details.ifsc'];

    const accountMapping = fieldMappings.find(m => m.isEnabled === 'true' && ACCOUNT_NO_CRM_KEYS.includes(m.crmField));
    const ifscMapping    = fieldMappings.find(m => m.isEnabled === 'true' && IFSC_CRM_KEYS.includes(m.crmField));

    const accountNumber = accountMapping
      ? (resolveFieldValue(accountMapping.sourceType, accountMapping.sourceField, accountMapping.customValue, leadContext) ?? null)
      : (extracted['account_number'] || extracted['account_no.'] || extracted['account_no'] || null);
    const ifscCode = ifscMapping
      ? (resolveFieldValue(ifscMapping.sourceType, ifscMapping.sourceField, ifscMapping.customValue, leadContext) ?? null)
      : (extracted['ifsc'] || extracted['ifsc_code'] || null);

    console.log(
      `[CustomCRM] Banking resolution — account: ${accountMapping ? `field-mapping(${accountMapping.crmField})` : 'fallback-extracted'} → ${accountNumber ? '***set***' : 'null'}` +
      ` | ifsc: ${ifscMapping ? `field-mapping(${ifscMapping.crmField})` : 'fallback-extracted'} → ${ifscCode ? '***set***' : 'null'}`
    );

    let bankingUploaded = !!resume?.bankingUploaded;
    if ((accountNumber || ifscCode) && !bankingUploaded) {
      console.log(`[CustomCRM] Lead created (AppId: ${leadResult.applicationId}), uploading banking details`);
      const bankingResult = await uploadBankingDetailsToCaprion(
        settings,
        leadResult.applicationId,
        accountNumber,
        ifscCode,
        storeCredential
      );
      const bankingSuffix = bankingResult.success ? ' | banking details uploaded' : ` | banking upload failed: ${bankingResult.message}`;
      finalResult = { ...finalResult, message: finalResult.message + bankingSuffix, bankingResult };
      if (bankingResult.success) {
        bankingUploaded = true;
        try {
          await options.onBankingUploaded?.();
        } catch (e: any) {
          console.error('[CustomCRM] Failed to checkpoint banking upload:', e?.message || e);
        }
      } else {
        problems.push('banking details');
      }
    }
    finalResult.bankingUploaded = bankingUploaded;

    // Document uploads. Caprion's UploadDocument only needs application_id, so the
    // upload is no longer skipped when the CRM does not return an applicant id.
    const alreadyUploaded = new Set(resume?.uploadedDocKeys || []);
    if (hasDocuments) {
      const pendingCount = Object.entries(documents)
        .reduce((n, [cat, files]) => n + files.filter(f => !alreadyUploaded.has(documentKeyFor(cat, f))).length, 0);
      console.log(`[CustomCRM] Uploading ${pendingCount} document file(s) (${alreadyUploaded.size} already uploaded earlier)`);

      const bankStatementPassword =
        (extracted['_bankStatementPassword'] as string | undefined) ||
        (extracted['bank_statement_password'] as string | undefined) ||
        null;

      const documentResults = await uploadDocumentsToCaprion(
        settings,
        leadResult.applicationId,
        leadResult.applicantId || '',
        documents,
        storeCredential,
        undefined,
        bankStatementPassword,
        { skipKeys: alreadyUploaded, onUploaded: options.onDocumentUploaded }
      );

      const uploadedDocKeys = new Set(alreadyUploaded);
      for (const r of documentResults) {
        if (r.success && r.documentKey) uploadedDocKeys.add(r.documentKey);
      }
      const failedDocs = documentResults.filter(r => !r.success);
      const successCount = documentResults.length - failedDocs.length;
      const docSummary = failedDocs.length > 0
        ? ` (${successCount} docs uploaded, ${failedDocs.length} failed)`
        : ` (${successCount} docs uploaded)`;

      finalResult = {
        ...finalResult,
        message: finalResult.message + docSummary,
        documentResults,
        uploadedDocKeys: Array.from(uploadedDocKeys),
        failedDocuments: failedDocs.map(r => r.documentType),
      };
      if (failedDocs.length > 0) {
        problems.push(`${failedDocs.length} document(s): ${Array.from(new Set(failedDocs.map(r => r.documentType))).join(', ')}`);
      }
    }
  } else if (settings.authType === 'checksum_caprion' && storeCredential && hasDocuments) {
    // Applicant created but no application id came back, so documents cannot be attached
    // — and retrying would only create a second applicant.
    problems.push('documents (CRM returned no application id)');
    partialKind = 'permanent';
  }

  if (problems.length > 0) {
    const ref = leadResult.applicationId || leadResult.leadId || 'unknown';
    return {
      ...finalResult,
      success: false,
      outcome: 'partial',
      errorKind: partialKind,
      message: `CRM_SYNC_ERROR[partial_documents]: Lead created in CRM (AppId ${ref}) but these were not accepted: ${problems.join('; ')}`,
    };
  }

  return finalResult;
}

export async function testConnection(
  settings: CustomCrmSettings
): Promise<{ success: boolean; message: string }> {
  try {
    const urlValidation = validateUrl(settings.apiBaseUrl || '', settings.apiEndpoint || '');
    if (!urlValidation.valid) {
      return { success: false, message: urlValidation.error || 'Invalid API URL' };
    }
    const url = urlValidation.fullUrl;

    let decryptedAuthKey: string | undefined;
    if (settings.authKey) {
      try {
        decryptedAuthKey = decrypt(settings.authKey);
      } catch (e) {
        console.error('[CustomCRM] Failed to decrypt authKey for test:', e);
        return { success: false, message: 'Failed to decrypt authentication key' };
      }
    }

    const headers: Record<string, string> = {};

    if (settings.authType === 'api_key' && decryptedAuthKey) {
      const headerName = settings.authHeaderName || 'X-Api-Key';
      headers[headerName] = decryptedAuthKey;
    } else if (settings.authType === 'bearer' && decryptedAuthKey) {
      headers['Authorization'] = `Bearer ${decryptedAuthKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return {
        success: true,
        message: `Endpoint is reachable (HTTP ${response.status})`,
      };
    } catch (fetchError: any) {
      clearTimeout(timeout);
      if (fetchError.name === 'AbortError') {
        return { success: false, message: 'Connection timed out after 10 seconds' };
      }
      throw fetchError;
    }
  } catch (error: any) {
    console.error('[CustomCRM] testConnection error:', error);
    return {
      success: false,
      message: error.message || 'Failed to connect to CRM endpoint',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp lead → Custom CRM, with an atomic per-lead claim and retry state.
//
// custom_crm_sync_status values used (all pre-existing, all understood by the UI):
//   NULL     never attempted
//   pending  a sync is in flight (claimed by one server instance)
//   synced   applicant created AND every banking/document item accepted
//   failed   see custom_crm_sync_error; `_crmSync.retryable` says whether the
//            recovery worker will try again (and `_crmSync.nextRetryAt` when)
//
// Retry bookkeeping lives under the reserved `_crmSync` key of the existing
// custom_crm_sync_payload jsonb column — no schema change needed.
// ─────────────────────────────────────────────────────────────────────────────

/** Delay before retry N (1-based). Attempt 1 is the first push; attempt 6 is the last. */
export const CRM_RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 12 * 60 * 60_000];
export const CRM_MAX_ATTEMPTS = CRM_RETRY_DELAYS_MS.length + 1;
/** A 'pending' claim older than this is assumed to belong to a crashed/hung instance. */
export const CRM_CLAIM_STALE_MS = 10 * 60_000;

export interface CrmSyncMeta {
  claimId?: string | null;
  claimedAt?: string | null;
  prevStatus?: string | null;
  source?: string;
  attempts?: number;
  lastAttemptAt?: string;
  nextRetryAt?: string | null;
  retryable?: boolean;
  errorKind?: CrmErrorKind | null;
  /** Set just before the create-applicant call; cleared when its outcome is known. */
  createStartedAt?: string | null;
  created?: boolean;
  leadId?: string | null;
  applicationId?: string | null;
  applicantId?: string | null;
  storeCredentialId?: string | null;
  bankingUploaded?: boolean;
  uploadedDocKeys?: string[];
}

export interface WhatsappLeadSyncOptions {
  /** Manual "Sync" from the dashboard: re-push a synced lead, and ignore retry holds/backoff. */
  force?: boolean;
  /** Recovery worker: only claim a failed lead whose nextRetryAt has passed. */
  respectBackoff?: boolean;
  /** Skip when the business has auto-sync turned off (worker / automatic triggers). */
  requireAutoSync?: boolean;
  /** Label for logs/meta, e.g. 'flow_completed', 'webhook', 'manual', 'bulk', 'recovery'. */
  source?: string;
  /**
   * Only send documents the CRM hasn't received yet to the application this lead already
   * created (e.g. Aadhaar sent after the lead was synced). Never creates an applicant.
   */
  documentsOnly?: boolean;
  /** Optional pre-built inputs. Anything omitted is loaded from the database. */
  settings?: CustomCrmSettings;
  fieldMappings?: CustomCrmFieldMapping[];
  leadContext?: CustomCrmLeadContext;
  storeCredential?: CrmStoreCredential;
}

export interface WhatsappLeadSyncResult {
  success: boolean;
  /** Set when nothing was pushed. */
  skipped?: 'already_synced' | 'in_progress' | 'not_eligible' | 'not_found' | 'not_configured' | 'draft';
  /** The lead's custom_crm_sync_status after this call. */
  status: string | null;
  message: string;
  outcome?: 'synced' | 'partial' | 'failed';
  errorKind?: CrmErrorKind;
  crmLeadId?: string | null;
  applicationId?: string | null;
  documentResults?: DocumentUploadResult[];
  retryScheduledAt?: string | null;
}

export function nextCrmRetryAt(attempts: number, now: Date = new Date()): Date | null {
  if (attempts >= CRM_MAX_ATTEMPTS) return null;
  const delay = CRM_RETRY_DELAYS_MS[Math.max(0, attempts - 1)] ?? CRM_RETRY_DELAYS_MS[CRM_RETRY_DELAYS_MS.length - 1];
  return new Date(now.getTime() + delay);
}

/**
 * Atomically move the lead to 'pending' and stamp our claim id. Only one caller
 * (across every server instance) can win for a given lead; everyone else gets null.
 */
async function claimLeadForCrmSync(
  leadId: string,
  claimId: string,
  // keepApplication: documentsOnly — a synced lead is re-claimed but keeps its recorded application.
  opts: { force: boolean; respectBackoff: boolean; source: string; keepApplication?: boolean }
): Promise<CrmSyncMeta | null> {
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - CRM_CLAIM_STALE_MS).toISOString();
  const res = await db.execute(sql`
    UPDATE whatsapp_leads
    SET custom_crm_sync_status = 'pending',
        custom_crm_sync_payload = COALESCE(custom_crm_sync_payload, '{}'::jsonb) || jsonb_build_object('_crmSync',
          (CASE WHEN ${opts.force}::boolean AND NOT ${!!opts.keepApplication}::boolean AND custom_crm_sync_status = 'synced'
                THEN '{}'::jsonb
                ELSE COALESCE(custom_crm_sync_payload->'_crmSync', '{}'::jsonb) END)
          || jsonb_build_object(
               'claimId', ${claimId}::text,
               'claimedAt', ${nowIso}::text,
               'prevStatus', custom_crm_sync_status,
               'source', ${opts.source}::text)
          || (CASE WHEN ${opts.force}::boolean THEN jsonb_build_object('attempts', 0) ELSE '{}'::jsonb END)),
        updated_at = NOW()
    WHERE id = ${leadId}
      AND (
        custom_crm_sync_status IS NULL
        OR custom_crm_sync_status = ''
        OR (custom_crm_sync_status = 'failed'
            AND (${opts.force}::boolean OR COALESCE(custom_crm_sync_payload->'_crmSync'->>'retryable', 'true') <> 'false')
            AND (${opts.force}::boolean OR NOT ${opts.respectBackoff}::boolean
                 OR (custom_crm_sync_payload->'_crmSync'->>'nextRetryAt' IS NOT NULL
                     AND (custom_crm_sync_payload->'_crmSync'->>'nextRetryAt')::timestamptz <= ${nowIso}::timestamptz)))
        OR (custom_crm_sync_status = 'pending'
            AND (custom_crm_sync_payload->'_crmSync'->>'claimedAt' IS NULL
                 OR (custom_crm_sync_payload->'_crmSync'->>'claimedAt')::timestamptz < ${staleIso}::timestamptz))
        OR (${opts.force}::boolean AND custom_crm_sync_status = 'synced')
      )
    RETURNING custom_crm_sync_payload->'_crmSync' AS meta
  `);
  const row = (res.rows as any[])[0];
  return row ? ((row.meta as CrmSyncMeta) || {}) : null;
}

/** Merge a patch into `_crmSync`, but only while we still hold the claim. Also refreshes claimedAt (heartbeat). */
async function checkpointCrmSync(leadId: string, claimId: string, patch: Partial<CrmSyncMeta>, crmLeadId?: string | null): Promise<boolean> {
  const body = JSON.stringify({ ...patch, claimedAt: new Date().toISOString() });
  const res = await db.execute(sql`
    UPDATE whatsapp_leads
    SET custom_crm_sync_payload = jsonb_set(custom_crm_sync_payload, '{_crmSync}',
          COALESCE(custom_crm_sync_payload->'_crmSync', '{}'::jsonb) || ${body}::jsonb),
        custom_crm_lead_id = COALESCE(${crmLeadId ?? null}::text, custom_crm_lead_id),
        updated_at = NOW()
    WHERE id = ${leadId}
      AND custom_crm_sync_status = 'pending'
      AND custom_crm_sync_payload->'_crmSync'->>'claimId' = ${claimId}::text
    RETURNING id
  `);
  return res.rows.length > 0;
}

/** Write the final status and release the claim. Returns false if another instance took the claim over. */
async function finalizeCrmSync(
  leadId: string,
  claimId: string,
  fields: { status: 'synced' | 'failed'; error: string | null; crmLeadId?: string | null; payload?: Record<string, string>; meta: CrmSyncMeta }
): Promise<boolean> {
  const metaJson = JSON.stringify({ ...fields.meta, claimId: null, claimedAt: null });
  const payloadJson = fields.payload ? JSON.stringify(fields.payload) : null;
  const res = await db.execute(sql`
    UPDATE whatsapp_leads
    SET custom_crm_sync_status = ${fields.status}::text,
        custom_crm_sync_error = ${fields.error}::text,
        custom_crm_synced_at = CASE WHEN ${fields.status}::text = 'synced' THEN NOW() ELSE custom_crm_synced_at END,
        custom_crm_lead_id = COALESCE(${fields.crmLeadId ?? null}::text, custom_crm_lead_id),
        custom_crm_sync_payload = COALESCE(${payloadJson}::jsonb, custom_crm_sync_payload - '_crmSync', '{}'::jsonb)
          || jsonb_build_object('_crmSync', ${metaJson}::jsonb),
        updated_at = NOW()
    WHERE id = ${leadId}
      AND custom_crm_sync_status = 'pending'
      AND custom_crm_sync_payload->'_crmSync'->>'claimId' = ${claimId}::text
    RETURNING id
  `);
  return res.rows.length > 0;
}

async function buildWhatsappLeadDocuments(leadId: string): Promise<Record<string, DocumentFile[]>> {
  // Private documents get expiring presigned URLs the CRM can download.
  const { whatsappService } = await import("./whatsappService");
  return whatsappService.buildLeadDocumentContext(leadId);
}

/** Same matching rules as the route/flow callers: exact store+dealer+city, then store+dealer, then store, then AI fuzzy match. */
export async function resolveStoreCredentialForLead(
  businessAccountId: string,
  extractedData: Record<string, any>
): Promise<CrmStoreCredential | undefined> {
  const storeName = extractedData.store_name || extractedData.storeName;
  const dealerName = extractedData.dealer_name || extractedData.dealerName || extractedData.dealer;
  const cityName = extractedData.city || extractedData.city_name || extractedData.dealer_city || extractedData.dealerCity;
  if (!storeName && !dealerName) return undefined;

  const storeCreds = await db
    .select()
    .from(crmStoreCredentials)
    .where(and(
      eq(crmStoreCredentials.businessAccountId, businessAccountId),
      eq(crmStoreCredentials.isActive, true)
    ));

  const norm = (v?: string | null) => v ? v.trim().toLowerCase() : '';
  const nStore = norm(storeName);
  const nDealer = norm(dealerName);
  const nCity = norm(cityName);

  let match: CrmStoreCredential | undefined;
  if (nStore && nDealer && nCity) {
    match = storeCreds.find(sc => norm(sc.storeName) === nStore && norm(sc.dealerName) === nDealer && norm(sc.city) === nCity);
  }
  if (!match && nStore && nDealer) {
    match = storeCreds.find(sc => norm(sc.storeName) === nStore && norm(sc.dealerName) === nDealer);
  }
  if (!match && nStore) {
    match = storeCreds.find(sc => norm(sc.storeName) === nStore);
  }
  if (!match && storeCreds.length > 0 && (nStore || nDealer)) {
    try {
      const [bizAcct] = await db.select({ openaiApiKey: businessAccounts.openaiApiKey }).from(businessAccounts).where(eq(businessAccounts.id, businessAccountId)).limit(1);
      const openaiApiKey = bizAcct?.openaiApiKey ? safeDecrypt(bizAcct.openaiApiKey) : process.env.OPENAI_API_KEY;
      if (openaiApiKey) {
        const openaiClient = createOpenAI({ businessAccountId, apiKey: openaiApiKey, timeout: 15000 });
        const storeList = storeCreds.map(sc => ({ id: sc.id, dealerName: sc.dealerName, storeName: sc.storeName, city: sc.city || '', storeId: sc.storeId }));
        const prompt = `Match the lead's store info to the closest store credential.\n\nLead info:\n- Dealer: ${dealerName || 'unknown'}\n- City: ${cityName || 'unknown'}\n- Store: ${storeName || 'unknown'}\n\nAvailable stores (JSON):\n${JSON.stringify(storeList)}\n\nReturn ONLY a JSON object: {"matchedId": "<store id or null>", "confidence": <0.0-1.0>}\nIf no good match exists, return {"matchedId": null, "confidence": 0}`;
        const completion = await openaiClient.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 100,
          response_format: { type: 'json_object' },
        });
        const content = completion.choices[0]?.message?.content;
        if (content) {
          const aiResult = JSON.parse(content);
          if (aiResult.matchedId && aiResult.confidence >= 0.75) {
            match = storeCreds.find(sc => sc.id === aiResult.matchedId);
          }
        }
      }
    } catch (aiErr: any) {
      console.warn('[CRM LeadSync] AI fuzzy store matching failed:', aiErr?.message || aiErr);
    }
  }
  return match;
}

/**
 * The single entry point for pushing a WhatsApp lead to the Custom CRM.
 *
 * - Claims the lead atomically; a concurrent or repeated call for a lead that is
 *   already synced or currently syncing is a no-op (unless `force`).
 * - Persists status, error and retry state itself — callers must NOT write
 *   custom_crm_sync_* columns afterwards.
 * - Resumes from a previously created applicant: a retry only re-sends the
 *   banking details / documents that the CRM has not yet accepted.
 */
export async function syncWhatsappLeadToCustomCrm(
  leadId: string,
  options: WhatsappLeadSyncOptions = {}
): Promise<WhatsappLeadSyncResult> {
  const source = options.source || 'unknown';
  const force = !!options.force;
  const tag = `[CRM LeadSync:${source}]`;

  const [lead] = await db.select().from(whatsappLeads).where(eq(whatsappLeads.id, leadId)).limit(1);
  if (!lead) {
    return { success: false, skipped: 'not_found', status: null, message: 'WhatsApp lead not found' };
  }

  let settings = options.settings;
  if (!settings) {
    [settings] = await db.select().from(customCrmSettings).where(eq(customCrmSettings.businessAccountId, lead.businessAccountId)).limit(1);
  }
  if (!settings || !settings.enabled || !settings.apiBaseUrl || !settings.apiEndpoint || (options.requireAutoSync && !settings.autoSyncEnabled)) {
    return { success: false, skipped: 'not_configured', status: lead.customCrmSyncStatus ?? null, message: 'Custom CRM sync is not enabled/configured for this account' };
  }

  // Accounts that require PAN + email: a draft is never sent (the LOS would reject it).
  const { isQualificationRequired, refreshLeadQualification } = await import('./leadQualificationService');
  if (await isQualificationRequired(lead.businessAccountId)) {
    const check = await refreshLeadQualification(leadId, { pushToCrm: false });
    if (check && !check.qualification.qualified && !lead.qualifiedAt) {
      const message = `Draft — waiting for a valid ${check.qualification.missing.join(' and ')} before this can be sent to the CRM`;
      console.log(`${tag} Lead ${leadId} not sent: ${message}`);
      return { success: false, skipped: 'draft', status: lead.customCrmSyncStatus ?? null, message };
    }
  }

  if (options.documentsOnly) {
    const meta = ((lead.customCrmSyncPayload as any)?._crmSync || {}) as CrmSyncMeta;
    if (!(meta.created && meta.applicationId)) {
      return { success: false, skipped: 'not_eligible', status: lead.customCrmSyncStatus ?? null, message: 'No CRM application recorded for this lead to attach documents to' };
    }
  }

  const claimId = crypto.randomUUID();
  const claimed = await claimLeadForCrmSync(leadId, claimId, { force: force || !!options.documentsOnly, respectBackoff: !!options.respectBackoff, source, keepApplication: !!options.documentsOnly });
  if (!claimed) {
    const [current] = await db.select({ status: whatsappLeads.customCrmSyncStatus }).from(whatsappLeads).where(eq(whatsappLeads.id, leadId)).limit(1);
    const status = current?.status ?? null;
    const skipped = status === 'synced' ? 'already_synced' : status === 'pending' ? 'in_progress' : 'not_eligible';
    console.log(`${tag} Lead ${leadId} not claimed (status=${status}) — skipping`);
    return {
      success: status === 'synced',
      skipped,
      status,
      message: skipped === 'already_synced' ? 'Lead is already synced to the CRM'
        : skipped === 'in_progress' ? 'A CRM sync for this lead is already in progress'
        : 'Lead is not due for a CRM retry',
    };
  }

  const meta: CrmSyncMeta = { ...claimed };
  const attempts = (meta.attempts || 0) + 1;
  const nowIso = new Date().toISOString();

  // A previous instance died between sending the create request and learning its
  // outcome. Re-sending could create a second applicant, so stop and ask a human.
  if (meta.prevStatus === 'pending' && meta.createStartedAt && !meta.created) {
    const error = 'CRM_SYNC_ERROR[network_error]: a previous sync was interrupted while creating the application — it may exist in the CRM. Check the CRM, then use Sync to push again.';
    await finalizeCrmSync(leadId, claimId, {
      status: 'failed',
      error,
      meta: { ...meta, attempts, lastAttemptAt: nowIso, createStartedAt: null, retryable: false, nextRetryAt: null, errorKind: 'unknown_outcome' },
    });
    console.warn(`${tag} Lead ${leadId}: interrupted create detected — held for manual review`);
    return { success: false, status: 'failed', message: error, outcome: 'failed', errorKind: 'unknown_outcome' };
  }

  try {
    const fieldMappings = options.fieldMappings ?? await db
      .select()
      .from(customCrmFieldMappings)
      .where(eq(customCrmFieldMappings.businessAccountId, lead.businessAccountId))
      .orderBy(customCrmFieldMappings.sortOrder);

    const extractedData = (lead.extractedData as Record<string, any>) || {};
    const leadContext: CustomCrmLeadContext = options.leadContext ?? {
      lead: {
        customerName: lead.customerName || null,
        customerEmail: lead.customerEmail || null,
        customerPhone: lead.customerPhone || null,
        senderPhone: lead.senderPhone || null,
      },
      extracted: extractedData,
      documents: await buildWhatsappLeadDocuments(leadId),
    };

    const resuming = !!(meta.created && meta.applicationId);

    // Documents must be attached under the same store (sid/secret) that created the
    // application, so a resumed sync reuses the recorded credential.
    let storeCredential: CrmStoreCredential | undefined;
    if (resuming && meta.storeCredentialId) {
      [storeCredential] = await db.select().from(crmStoreCredentials).where(eq(crmStoreCredentials.id, meta.storeCredentialId)).limit(1);
    }
    if (!storeCredential) {
      // Dealers & Stores sheet on: use exactly the store the customer picked — never a guess.
      const { findSheetRowForLead } = await import('./storeSheetService');
      const sheet = await findSheetRowForLead(lead.businessAccountId, extractedData);
      if (sheet) {
        const problem = !sheet.row
          ? `store "${sheet.label || 'not selected'}" is not in Dealers & Stores (or matches more than one row)`
          : !sheet.row.sid?.trim() || !sheet.row.secret?.trim()
            ? `store "${sheet.label}" has no SID/secret in Dealers & Stores`
            : null;
        if (problem) {
          const error = `CRM_SYNC_ERROR[store_not_mapped]: ${problem}. Fix it in Dealers & Stores, then use Sync.`;
          await finalizeCrmSync(leadId, claimId, {
            status: 'failed', error,
            meta: { ...meta, attempts, lastAttemptAt: nowIso, createStartedAt: null, retryable: false, nextRetryAt: null, errorKind: 'permanent' },
          });
          console.warn(`${tag} Lead ${leadId} not sent: ${problem}`);
          return { success: false, status: 'failed', message: error, outcome: 'failed', errorKind: 'permanent' };
        }
        storeCredential = sheet.row;
      }
    }
    if (!storeCredential) {
      storeCredential = options.storeCredential ?? await resolveStoreCredentialForLead(lead.businessAccountId, extractedData);
    }

    if (!resuming) {
      await checkpointCrmSync(leadId, claimId, {
        createStartedAt: new Date().toISOString(),
        storeCredentialId: storeCredential?.id ?? null,
        created: false,
        applicationId: null,
        applicantId: null,
        leadId: null,
        bankingUploaded: false,
        uploadedDocKeys: [],
      });
    }

    const uploadedDocKeys = new Set(meta.uploadedDocKeys || []);
    console.log(`${tag} Lead ${leadId}: attempt ${attempts}${resuming ? ` (resuming AppId ${meta.applicationId}, ${uploadedDocKeys.size} doc(s) already uploaded)` : ''}`);

    const result = await syncLeadWithDocuments(settings, fieldMappings, leadContext, storeCredential, {
      resume: resuming ? {
        leadId: meta.leadId,
        applicationId: meta.applicationId,
        applicantId: meta.applicantId,
        bankingUploaded: meta.bankingUploaded,
        uploadedDocKeys: Array.from(uploadedDocKeys),
      } : undefined,
      onLeadCreated: async (ids) => {
        meta.created = true;
        meta.createStartedAt = null;
        meta.leadId = ids.leadId ?? null;
        meta.applicationId = ids.applicationId ?? null;
        meta.applicantId = ids.applicantId ?? null;
        await checkpointCrmSync(leadId, claimId, {
          created: true, createStartedAt: null,
          leadId: meta.leadId, applicationId: meta.applicationId, applicantId: meta.applicantId,
        }, ids.leadId || ids.applicationId || null);
      },
      onBankingUploaded: async () => {
        meta.bankingUploaded = true;
        await checkpointCrmSync(leadId, claimId, { bankingUploaded: true });
      },
      onDocumentUploaded: async (key) => {
        uploadedDocKeys.add(key);
        await checkpointCrmSync(leadId, claimId, { uploadedDocKeys: Array.from(uploadedDocKeys) });
      },
    });

    const crmLeadId = result.leadId || result.applicationId || meta.leadId || meta.applicationId || null;
    const finalMeta: CrmSyncMeta = {
      ...meta,
      attempts,
      lastAttemptAt: nowIso,
      createStartedAt: null,
      created: result.created,
      leadId: result.leadId ?? meta.leadId ?? null,
      applicationId: result.applicationId ?? meta.applicationId ?? null,
      applicantId: result.applicantId ?? meta.applicantId ?? null,
      storeCredentialId: storeCredential?.id ?? meta.storeCredentialId ?? null,
      bankingUploaded: result.bankingUploaded ?? meta.bankingUploaded ?? false,
      uploadedDocKeys: result.uploadedDocKeys ?? Array.from(uploadedDocKeys),
    };

    if (result.outcome === 'synced') {
      const ok = await finalizeCrmSync(leadId, claimId, {
        status: 'synced', error: null, crmLeadId, payload: result.payload,
        meta: { ...finalMeta, retryable: false, nextRetryAt: null, errorKind: null },
      });
      if (!ok) console.warn(`${tag} Lead ${leadId}: claim was taken over before the result could be saved`);
      console.log(`${tag} Lead ${leadId} synced (attempt ${attempts})`);
      return { success: true, status: 'synced', message: result.message, outcome: 'synced', crmLeadId, applicationId: finalMeta.applicationId, documentResults: result.documentResults };
    }

    // partial → worth retrying (only the missing items are re-sent); a failed
    // create follows its error kind.
    const errorKind: CrmErrorKind = result.errorKind || 'transient';
    let retryAt = errorKind === 'transient' ? nextCrmRetryAt(attempts) : null;
    let error = result.message;
    if (errorKind === 'transient' && !retryAt) {
      error = `${error} (gave up after ${attempts} attempts — use Sync to try again)`;
    }
    const ok = await finalizeCrmSync(leadId, claimId, {
      status: 'failed', error, crmLeadId: result.created ? crmLeadId : null, payload: result.payload,
      meta: { ...finalMeta, retryable: !!retryAt, nextRetryAt: retryAt ? retryAt.toISOString() : null, errorKind },
    });
    if (!ok) console.warn(`${tag} Lead ${leadId}: claim was taken over before the result could be saved`);
    console.warn(`${tag} Lead ${leadId} ${result.outcome} (attempt ${attempts}, ${errorKind})${retryAt ? ` — retry at ${retryAt.toISOString()}` : ' — not retrying automatically'}`);
    return {
      success: false, status: 'failed', message: error, outcome: result.outcome, errorKind,
      crmLeadId: result.created ? crmLeadId : null, applicationId: finalMeta.applicationId,
      documentResults: result.documentResults, retryScheduledAt: retryAt ? retryAt.toISOString() : null,
    };
  } catch (err: any) {
    // Unexpected error (DB, context building). If the create request might already
    // have gone out, the outcome is unknown — do not retry automatically.
    const [row] = await db.select({ payload: whatsappLeads.customCrmSyncPayload }).from(whatsappLeads).where(eq(whatsappLeads.id, leadId)).limit(1).catch(() => [] as any[]);
    const current: CrmSyncMeta = ((row?.payload as any)?._crmSync as CrmSyncMeta) || meta;
    const ambiguous = !!(current.createStartedAt && !current.created);
    const errorKind: CrmErrorKind = ambiguous ? 'unknown_outcome' : 'transient';
    const retryAt = ambiguous ? null : nextCrmRetryAt(attempts);
    const error = `CRM_SYNC_ERROR[unknown]: ${err?.message || 'CRM sync failed'}`;
    console.error(`${tag} Lead ${leadId} sync error:`, err?.message || err);
    await finalizeCrmSync(leadId, claimId, {
      status: 'failed', error,
      meta: { ...current, attempts, lastAttemptAt: nowIso, createStartedAt: null, retryable: !!retryAt, nextRetryAt: retryAt ? retryAt.toISOString() : null, errorKind },
    }).catch(e => console.error(`${tag} Failed to record sync error for ${leadId}:`, e?.message || e));
    return { success: false, status: 'failed', message: error, outcome: 'failed', errorKind, retryScheduledAt: retryAt ? retryAt.toISOString() : null };
  }
}
