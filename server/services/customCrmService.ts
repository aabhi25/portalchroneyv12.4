import crypto from 'crypto';
import path from 'path';
import { CustomCrmSettings, CustomCrmFieldMapping, CrmStoreCredential } from '@shared/schema';
import { decrypt } from './encryptionService';

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
      };
    }

    let secretForChecksum: string | undefined;

    if (settings.authType === 'checksum_caprion') {
      if (!storeCredential) {
        return {
          success: false,
          message: 'Caprion auth requires a matched store credential. Ensure the lead has a store_name that matches a configured store.',
          payload,
        };
      }
      try {
        secretForChecksum = decrypt(storeCredential.secret);
      } catch (e) {
        console.error('[CustomCRM] Failed to decrypt store secret:', e);
        return { success: false, message: 'Failed to decrypt store credential secret' };
      }
    } else if (settings.authType === 'checksum_hmac') {
      if (storeCredential) {
        try {
          secretForChecksum = decrypt(storeCredential.secret);
        } catch (e) {
          console.error('[CustomCRM] Failed to decrypt store secret:', e);
          return { success: false, message: 'Failed to decrypt store credential secret' };
        }
      } else if (settings.authKey) {
        try {
          secretForChecksum = decrypt(settings.authKey);
        } catch (e) {
          console.error('[CustomCRM] Failed to decrypt authKey:', e);
          return { success: false, message: 'Failed to decrypt authentication key' };
        }
      }
    }

    let decryptedAuthKey: string | undefined;
    if (settings.authKey) {
      try {
        decryptedAuthKey = decrypt(settings.authKey);
      } catch (e) {
        console.error('[CustomCRM] Failed to decrypt authKey:', e);
        return { success: false, message: 'Failed to decrypt authentication key' };
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

    if (settings.authType === 'checksum_caprion' && secretForChecksum) {
      const sortedKeysForLog = Object.keys(payload).sort();
      const checksumDataString = sortedKeysForLog.map(k => String(payload[k] ?? '').trim()).join('||');
      console.log(`[Caprion] Checksum data string: ${checksumDataString}`);
      payload['checksum'] = generateCaprionChecksum(payload, secretForChecksum);
      console.log(`[Caprion] Checksum: ${payload['checksum']}`);
    } else if (settings.authType === 'checksum_hmac' && secretForChecksum) {
      payload['Checksum'] = generateChecksumHmac(payload, secretForChecksum);
    }

    console.log(`[Caprion] Full payload: ${JSON.stringify(payload, null, 2)}`);

    const urlValidation = validateUrl(settings.apiBaseUrl || '', settings.apiEndpoint || '');
    if (!urlValidation.valid) {
      return { success: false, message: urlValidation.error || 'Invalid API URL', payload };
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
      });
    } else if (settings.contentType === 'json') {
      headers['Content-Type'] = 'application/json';
      response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload),
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
      });
    }

    const responseText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    console.log(`[CustomCRM] Response status: ${response.status} - Content-Type: ${contentType} - Body: ${responseText.slice(0, 500)}`);

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
      return { success: false, message, payload, responseData };
    }

    if (!isJsonResponse) {
      const isHtml = responseText.trimStart().startsWith('<');
      const message = isHtml
        ? `CRM_SYNC_ERROR[html_response]: Caprion returned a server-side error page (HTTP 200 with HTML body). Check Caprion server logs or contact Caprion support.`
        : `CRM_SYNC_ERROR[unknown]: CRM returned a non-JSON response (HTTP 200).`;
      return { success: false, message, payload, responseData };
    }

    if (responseData?.success === 0 || responseData?.success === '0' || responseData?.success === false) {
      const crmMsg = responseData?.message || responseData?.error || responseData?.ExceptionMessage || 'CRM returned a failure response with no message';
      return {
        success: false,
        message: `CRM_SYNC_ERROR[json_error]: ${crmMsg}`,
        payload,
        responseData,
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
    console.error('[CustomCRM] syncLead error:', error);
    const isNetwork = error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ERR_INVALID_URL' || (error.message || '').toLowerCase().includes('timeout');
    const token = isNetwork ? 'network_error' : 'unknown';
    return {
      success: false,
      message: `CRM_SYNC_ERROR[${token}]: ${error.message || 'Failed to sync lead to Custom CRM'}`,
    };
  }
}

export interface DocumentUploadResult {
  documentType: string;
  success: boolean;
  message: string;
  responseData?: any;
}

export async function uploadDocumentsToCaprion(
  settings: CustomCrmSettings,
  applicationId: string,
  applicantId: string,
  documents: Record<string, DocumentFile[]>,
  storeCredential: CrmStoreCredential,
  documentTypeMapping?: Record<string, string>,
  bankStatementPassword?: string | null
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
      try {
        const fileUrlValidation = validateUrl(file.url, '');
        if (!fileUrlValidation.valid) {
          results.push({
            documentType: caprionDocType,
            success: false,
            message: `Invalid document URL: ${fileUrlValidation.error}`,
          });
          continue;
        }

        console.log(`[CustomCRM] Uploading document: ${caprionDocType} from ${file.url}`);

        const fileResponse = await fetch(file.url);
        if (!fileResponse.ok) {
          results.push({
            documentType: caprionDocType,
            success: false,
            message: `Failed to download document from ${file.url}: HTTP ${fileResponse.status}`,
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
          console.log(`[Caprion DocUpload] Filename resolved to "${fileName}" (original: "${file.fileName || '(none)'}", mimeType: ${mimeType}${wasConverted ? ', HEIC converted' : ''})`);
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

        // Always redact document_password before logging — never let plaintext credentials
        // reach prod logs. The checksum below uses the unredacted payload.
        const redactedPayload: Record<string, string> = { ...metaPayload };
        if (redactedPayload.document_password) redactedPayload.document_password = '***';

        console.log(`[Caprion DocUpload] Payload fields: ${JSON.stringify(redactedPayload)}`);
        const checksum = generateCaprionChecksum(metaPayload, decryptedSecret);

        const curlFields = Object.entries({ ...redactedPayload, checksum })
          .map(([k, v]) => `-F "${k}=${v}"`)
          .join(' \\\n  ');
        console.log(
          `[Caprion DocUpload] curl equivalent:\ncurl -X POST ${uploadEndpoint} \\\n  ${curlFields} \\\n  -F "files[]=@<download from: ${file.url}>"`
        );

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
        console.log(`[CustomCRM] Document upload response (${caprionDocType}): ${response.status} - ${safeResponseText.slice(0, 300)}`);

        let responseData: any;
        try {
          responseData = JSON.parse(safeResponseText);
        } catch {
          responseData = { raw: safeResponseText };
        }

        if (response.ok) {
          results.push({
            documentType: caprionDocType,
            success: true,
            message: `${caprionDocType} uploaded successfully`,
            responseData,
          });
        } else {
          const errorMsg = responseData?.message || responseData?.error || responseData?.ExceptionMessage || `HTTP ${response.status}`;
          results.push({
            documentType: caprionDocType,
            success: false,
            message: `Failed to upload ${caprionDocType}: ${errorMsg}`,
            responseData,
          });
        }
      } catch (error: any) {
        console.error(`[CustomCRM] Document upload error (${caprionDocType}):`, error);
        results.push({
          documentType: caprionDocType,
          success: false,
          message: error.message || `Failed to upload ${caprionDocType}`,
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

  const bankingCurlFields = Object.entries(payload)
    .map(([k, v]) => `-F "${k}=${v}"`)
    .join(' \\\n  ');
  console.log(
    `[Caprion BankingUpload] curl equivalent:\ncurl -X POST ${bankingEndpoint} \\\n  ${bankingCurlFields}`
  );

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
      });
    } else {
      const formData = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        formData.append(key, value);
      }
      response = await fetch(bankingEndpoint, { method: 'POST', body: formData });
    }

    const responseText = await response.text();

    if (response.ok) {
      console.log(`[CustomCRM] Banking details uploaded successfully: ${responseText.slice(0, 200)}`);
      return { success: true, message: 'Banking details uploaded successfully' };
    } else {
      console.error(`[CustomCRM] Banking details upload failed (${response.status}): ${responseText.slice(0, 300)}`);
      return { success: false, message: `Banking upload failed with status ${response.status}: ${responseText.slice(0, 200)}` };
    }
  } catch (e: any) {
    console.error('[CustomCRM] Banking details upload error:', e);
    return { success: false, message: e.message || 'Banking upload request failed' };
  }
}

export async function syncLeadWithDocuments(
  settings: CustomCrmSettings,
  fieldMappings: CustomCrmFieldMapping[],
  leadContext: CustomCrmLeadContext,
  storeCredential?: CrmStoreCredential
): Promise<SyncLeadResult & { documentResults?: DocumentUploadResult[]; bankingResult?: { success: boolean; message: string } }> {
  const leadResult = await syncLead(settings, fieldMappings, leadContext, storeCredential);

  if (!leadResult.success) {
    return leadResult;
  }

  let finalResult: SyncLeadResult & { documentResults?: DocumentUploadResult[]; bankingResult?: { success: boolean; message: string } } = { ...leadResult };

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

    if (accountNumber || ifscCode) {
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
    }

    // Document uploads
    if (leadResult.applicantId && leadContext.documents && Object.keys(leadContext.documents).length > 0) {
      console.log(`[CustomCRM] Uploading ${Object.keys(leadContext.documents).length} document type(s)`);

      const bankStatementPassword =
        (extracted['_bankStatementPassword'] as string | undefined) ||
        (extracted['bank_statement_password'] as string | undefined) ||
        null;

      const documentResults = await uploadDocumentsToCaprion(
        settings,
        leadResult.applicationId,
        leadResult.applicantId,
        leadContext.documents,
        storeCredential,
        undefined,
        bankStatementPassword
      );

      const successCount = documentResults.filter(r => r.success).length;
      const failCount = documentResults.filter(r => !r.success).length;
      const docSummary = failCount > 0
        ? ` (${successCount} docs uploaded, ${failCount} failed)`
        : ` (${successCount} docs uploaded)`;

      finalResult = { ...finalResult, message: finalResult.message + docSummary, documentResults };
    }
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
