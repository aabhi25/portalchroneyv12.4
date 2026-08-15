import { z } from 'zod';
import { LeadsquaredFieldMapping } from '@shared/schema';

export interface LeadSquaredConfig {
  accessKey: string;
  secretKey: string;
  region: 'india' | 'us' | 'other';
  customHost?: string;
}

export interface LeadSquaredLeadData {
  fullName?: string;
  email?: string;
  phone?: string;
  city?: string;
  createdAt?: string;
  businessAccountName?: string;
  businessUrl?: string;
  source?: string;
  sourceCampaign?: string;
}

// Dynamic data context for building attributes from field mappings
export interface LeadDataContext {
  lead: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    createdAt?: Date | null;
    sourceUrl?: string | null;
    // CAPTCHA verification outcome for this lead's conversation:
    // 'verified' | 'unverified'. Mappable to a CRM field.
    captchaStatus?: string | null;
  };
  session: {
    city?: string | null;
    utmCampaign?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    pageUrl?: string | null;
  };
  business: {
    name?: string | null;
    website?: string | null;
  };
  urlExtraction?: {
    university?: string | null;
    product?: string | null;
  };
  // Answers captured from conversational-journey steps, keyed by the step's
  // configured CRM field key. Referenced in mappings as journey.<key>.
  journey?: Record<string, string | null>;
  // AI-generated conversation summary + topic keywords for this lead's
  // conversation. Referenced in mappings as conversation.summary /
  // conversation.topics. Populated asynchronously after summarization.
  conversation?: {
    summary?: string | null;
    topics?: string | null;
  };
}

// Helper function to extract utm_campaign from URL
export function extractUtmCampaign(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const urlObj = new URL(url);
    const utmCampaign = urlObj.searchParams.get('utm_campaign');
    return utmCampaign || undefined;
  } catch {
    return undefined;
  }
}

export function extractUtmSource(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const urlObj = new URL(url);
    const utmSource = urlObj.searchParams.get('utm_source');
    return utmSource || undefined;
  } catch {
    return undefined;
  }
}

export function extractUtmMedium(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const urlObj = new URL(url);
    const utmMedium = urlObj.searchParams.get('utm_medium');
    return utmMedium || undefined;
  } catch {
    return undefined;
  }
}

interface LeadSquaredAttribute {
  Attribute: string;
  Value: string;
}

// LeadSquared field value limit - trim values exceeding this limit
const LEADSQUARED_FIELD_MAX_LENGTH = 200;

function trimToMaxLength(value: string | undefined | null): string {
  if (!value) return '';
  return value.length > LEADSQUARED_FIELD_MAX_LENGTH 
    ? value.substring(0, LEADSQUARED_FIELD_MAX_LENGTH) 
    : value;
}

export interface LeadSquaredResponse {
  Status: string;
  Message?: {
    Id?: string;
    AffectedRows?: number;
  };
  ExceptionType?: string;
  ExceptionMessage?: string;
}

/**
 * Detects LeadSquared's "this lead already exists" rejection. LeadSquared enforces
 * uniqueness (commonly on phone or email) at the account level; when a create hits
 * an existing record it returns an MXDuplicateEntryException ("A Lead with same
 * Phone Number already exists."). The lead is already in the CRM, so callers treat
 * this as a successful sync rather than a failure (no retry, not flagged as error).
 */
function isDuplicateLeadError(exceptionType?: string, message?: string): boolean {
  if (exceptionType && /MXDuplicateEntryException/i.test(exceptionType)) return true;
  if (message && /already exists/i.test(message)) return true;
  return false;
}

export class LeadSquaredService {
  private config: LeadSquaredConfig;
  private baseUrl: string;

  constructor(config: LeadSquaredConfig) {
    this.config = config;
    this.baseUrl = this.getBaseUrl();
  }

  private getBaseUrl(): string {
    if (this.config.region === 'india') {
      return 'https://api-in21.leadsquared.com';
    } else if (this.config.region === 'us') {
      return 'https://api-us.leadsquared.com';
    } else if (this.config.customHost) {
      return this.config.customHost;
    }
    return 'https://api.leadsquared.com';
  }

  async testConnection(): Promise<{ success: boolean; message: string; userDetails?: any }> {
    try {
      // Mask credentials for logging (server-side only)
      const maskedAccessKey = this.config.accessKey ? `${this.config.accessKey.slice(0, 8)}...` : 'missing';
      const maskedSecretKey = this.config.secretKey ? `${this.config.secretKey.slice(0, 4)}...` : 'missing';
      
      console.log(`[LeadSquared] Testing connection to: ${this.baseUrl}`);
      console.log(`[LeadSquared] Region: ${this.config.region}, Custom Host: ${this.config.customHost || 'none'}`);
      console.log(`[LeadSquared] Access Key: ${maskedAccessKey}, Secret Key: ${maskedSecretKey}`);
      
      const url = `${this.baseUrl}/v2/Authentication.svc/UserByAccessKey.Get?accessKey=${encodeURIComponent(this.config.accessKey)}&secretKey=${encodeURIComponent(this.config.secretKey)}`;
      
      console.log(`[LeadSquared] Request URL: ${this.baseUrl}/v2/Authentication.svc/UserByAccessKey.Get?accessKey=***&secretKey=***`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      console.log(`[LeadSquared] Response status: ${response.status} ${response.statusText}`);
      
      // Get response text first to see what LeadSquared returns (server-side logging only)
      const responseText = await response.text();
      console.log(`[LeadSquared] Raw response: ${responseText.slice(0, 500)}`);
      
      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[LeadSquared] Failed to parse response as JSON:', responseText.slice(0, 200));
        return {
          success: false,
          message: `Invalid response from LeadSquared (status ${response.status}). Check server logs for details.`,
        };
      }

      if (!response.ok) {
        console.error(`[LeadSquared] API error:`, data);
        return {
          success: false,
          message: data.ExceptionMessage || `Connection failed: ${response.status} ${response.statusText}`,
        };
      }
      
      // Check for successful response - API may return UserDetails wrapper OR direct user data with Id/Name
      if (data.Status === 'Success' || data.UserDetails || (data.Id && data.Name)) {
        console.log('[LeadSquared] Connection successful!');
        return {
          success: true,
          message: 'Connected successfully to LeadSquared',
          userDetails: data.UserDetails || data,
        };
      } else {
        console.error('[LeadSquared] Unexpected response format:', data);
        return {
          success: false,
          message: data.ExceptionMessage || 'Invalid credentials or unexpected response. Check server logs for details.',
        };
      }
    } catch (error: any) {
      console.error('[LeadSquared] Connection test failed:', error);
      return {
        success: false,
        message: error.message || 'Failed to connect to LeadSquared',
      };
    }
  }

  private buildAttributeArray(leadData: LeadSquaredLeadData): LeadSquaredAttribute[] {
    const attributes: LeadSquaredAttribute[] = [];
    
    if (leadData.fullName) {
      attributes.push({ Attribute: 'FirstName', Value: trimToMaxLength(leadData.fullName) });
    }
    if (leadData.email) {
      attributes.push({ Attribute: 'EmailAddress', Value: trimToMaxLength(leadData.email) });
    }
    if (leadData.phone) {
      attributes.push({ Attribute: 'Phone', Value: trimToMaxLength(leadData.phone) });
    }
    if (leadData.city) {
      attributes.push({ Attribute: 'mx_City', Value: trimToMaxLength(leadData.city) });
    }
    if (leadData.createdAt) {
      attributes.push({ Attribute: 'mx_CreatedAt', Value: trimToMaxLength(leadData.createdAt) });
    }
    if (leadData.businessAccountName) {
      attributes.push({ Attribute: 'Mx_Business_Account', Value: trimToMaxLength(leadData.businessAccountName) });
    }
    if (leadData.businessUrl) {
      attributes.push({ Attribute: 'Mx_Website_Campaign', Value: trimToMaxLength(leadData.businessUrl) });
    }
    if (leadData.sourceCampaign) {
      attributes.push({ Attribute: 'mx_Source_Campaign', Value: trimToMaxLength(leadData.sourceCampaign) });
    }
    attributes.push({ Attribute: 'Source', Value: trimToMaxLength(leadData.source || 'AI Chroney') });
    attributes.push({ Attribute: 'mx_Secondary_Lead_Source', Value: trimToMaxLength('AI Chroney') });
    
    return attributes;
  }

  // Build attributes from dynamic field mappings
  buildAttributesFromMappings(mappings: LeadsquaredFieldMapping[], context: LeadDataContext): LeadSquaredAttribute[] {
    const attributes: LeadSquaredAttribute[] = [];
    
    for (const mapping of mappings) {
      // Skip disabled mappings
      if (mapping.isEnabled !== 'true') continue;
      
      let value: string | undefined;
      
      if (mapping.sourceType === 'custom') {
        value = mapping.customValue || undefined;
      } else if (mapping.sourceType === 'dynamic' && mapping.sourceField) {
        value = this.extractValueFromContext(mapping.sourceField, context);
        if (value) {
          // When configured, send a fixed static value whenever the dynamic
          // source resolves to a non-empty value (e.g. "PRChat" whenever a UTM
          // source is present) instead of the raw source value.
          if (mapping.valueWhenPresent) {
            value = mapping.valueWhenPresent;
          }
        } else if (mapping.fallbackValue) {
          value = mapping.fallbackValue;
        }
      }
      
      if (value) {
        attributes.push({
          Attribute: mapping.leadsquaredField,
          Value: trimToMaxLength(value)
        });
      }
    }
    
    return attributes;
  }

  private extractValueFromContext(sourceField: string, context: LeadDataContext): string | undefined {
    const [category, ...fieldParts] = sourceField.split('.');
    const field = fieldParts.join('.'); // CRM field keys may contain dots; preserve the full remainder
    
    if (category === 'lead') {
      const lead = context.lead;
      switch (field) {
        case 'name': return lead.name || undefined;
        case 'email': return lead.email || undefined;
        case 'phone': return lead.phone || undefined;
        case 'whatsapp': return lead.whatsapp || undefined;
        case 'createdAt': return lead.createdAt ? lead.createdAt.toISOString() : undefined;
        case 'sourceUrl': return lead.sourceUrl || undefined;
        case 'captchaStatus': return lead.captchaStatus || undefined;
      }
    } else if (category === 'session') {
      const session = context.session;
      switch (field) {
        case 'city': return session.city || undefined;
        case 'utmCampaign': return session.utmCampaign || extractUtmCampaign(session.pageUrl);
        case 'utmSource': return session.utmSource || undefined;
        case 'utmMedium': return session.utmMedium || undefined;
        case 'pageUrl': return session.pageUrl || undefined;
      }
    } else if (category === 'business') {
      const business = context.business;
      switch (field) {
        case 'name': return business.name || undefined;
        case 'website': return business.website || undefined;
      }
    } else if (category === 'urlLookup') {
      const extraction = context.urlExtraction;
      switch (field) {
        case 'university': return extraction?.university || undefined;
        case 'product': return extraction?.product || undefined;
      }
    } else if (category === 'journey') {
      return context.journey?.[field] || undefined;
    } else if (category === 'conversation') {
      const conversation = context.conversation;
      switch (field) {
        case 'summary': return conversation?.summary || undefined;
        case 'topics': return conversation?.topics || undefined;
      }
    }
    
    return undefined;
  }

  // Create lead using dynamic mappings
  async createLeadWithMappings(
    mappings: LeadsquaredFieldMapping[],
    context: LeadDataContext
  ): Promise<{ success: boolean; leadId?: string; message: string; syncPayload?: Record<string, string>; alreadyExists?: boolean }> {
    try {
      const url = `${this.baseUrl}/v2/LeadManagement.svc/Lead.Capture?accessKey=${this.config.accessKey}&secretKey=${this.config.secretKey}`;
      
      const attributeArray = this.buildAttributesFromMappings(mappings, context);
      
      console.log('[LeadSquared] Creating lead with dynamic mappings - Host:', this.baseUrl);
      console.log('[LeadSquared] Creating lead - Fields count:', attributeArray.length, '- Fields:', attributeArray.map(a => a.Attribute).join(', '));
      
      if (attributeArray.length === 0) {
        return {
          success: false,
          message: 'No field mappings configured or no data available for sync',
        };
      }
      
      // Build a simple key-value payload for debugging/display
      const syncPayload: Record<string, string> = {};
      for (const attr of attributeArray) {
        syncPayload[attr.Attribute] = attr.Value;
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(attributeArray),
      });

      console.log('[LeadSquared] Creating lead - Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[LeadSquared] Creating lead - Error response:', errorText);
        let detailedError = `Failed to create lead: ${response.status} ${response.statusText}`;
        let exceptionType: string | undefined;
        try {
          const errorJson = JSON.parse(errorText);
          exceptionType = errorJson.ExceptionType;
          if (errorJson.ExceptionMessage) detailedError = errorJson.ExceptionMessage;
          else if (errorJson.Message) detailedError = errorJson.Message;
          else if (errorJson.message) detailedError = errorJson.message;
        } catch { 
          if (errorText && errorText.length < 500) detailedError += ` — ${errorText}`;
        }
        // The lead already exists in LeadSquared — treat as a successful sync.
        if (isDuplicateLeadError(exceptionType, detailedError)) {
          console.log('[LeadSquared] Creating lead - Already exists, treating as synced:', detailedError);
          return {
            success: true,
            alreadyExists: true,
            message: 'Lead already exists in LeadSquared (treated as synced).',
            syncPayload,
          };
        }
        return {
          success: false,
          message: detailedError,
        };
      }

      const data: LeadSquaredResponse = await response.json();
      console.log('[LeadSquared] Creating lead - Response status:', data.Status, '- Lead ID:', data.Message?.Id || 'N/A');
      
      if (data.Status === 'Success' && data.Message?.Id) {
        return {
          success: true,
          leadId: data.Message.Id,
          message: 'Lead created successfully in LeadSquared',
          syncPayload,
        };
      } else if (isDuplicateLeadError(data.ExceptionType, data.ExceptionMessage)) {
        // Some clusters return the duplicate signal as HTTP 200 with Status=Error.
        console.log('[LeadSquared] Creating lead - Already exists, treating as synced:', data.ExceptionMessage);
        return {
          success: true,
          alreadyExists: true,
          message: 'Lead already exists in LeadSquared (treated as synced).',
          syncPayload,
        };
      } else {
        console.error('[LeadSquared] Creating lead - Failed:', data.ExceptionMessage || 'Unknown error');
        return {
          success: false,
          message: data.ExceptionMessage || 'Failed to create lead',
        };
      }
    } catch (error: any) {
      console.error('[LeadSquared] Create lead with mappings failed:', error);
      return {
        success: false,
        message: error.message || 'Failed to push lead to LeadSquared',
      };
    }
  }

  // Update lead using dynamic mappings
  // changedFields: optional array of database field names that changed (e.g., ['name', 'phone'])
  // If provided, only mappings for those fields are sent (avoids mx_ field not found errors)
  async updateLeadWithMappings(
    leadId: string,
    mappings: LeadsquaredFieldMapping[],
    context: LeadDataContext,
    changedFields?: string[]
  ): Promise<{ success: boolean; message: string; syncPayload?: Record<string, string> }> {
    try {
      const url = `${this.baseUrl}/v2/LeadManagement.svc/Lead.Update?accessKey=${this.config.accessKey}&secretKey=${this.config.secretKey}&leadId=${leadId}`;
      
      // If changedFields provided, filter mappings to only include relevant ones
      let filteredMappings = mappings;
      if (changedFields && changedFields.length > 0) {
        // Map database field names to source field paths
        const fieldToSourceMap: Record<string, string[]> = {
          'name': ['lead.name'],
          'email': ['lead.email'],
          'phone': ['lead.phone', 'lead.whatsapp'],
          'city': ['session.city'],
          'sourceUrl': ['lead.sourceUrl', 'session.pageUrl'],
        };
        
        // Build list of source fields that changed
        const changedSources = new Set<string>();
        for (const field of changedFields) {
          const sources = fieldToSourceMap[field];
          if (sources) {
            sources.forEach(s => changedSources.add(s));
          }
        }
        
        // Filter mappings: only include dynamic mappings for changed fields, or custom (static) values
        filteredMappings = mappings.filter(m => {
          if (m.sourceType === 'custom') {
            // Custom/static values - only include on create, skip on update
            // This avoids issues with mx_ fields not existing yet
            return false;
          }
          // Dynamic mappings - include if the source field changed.
          // Journey answers (journey.*) are also included whenever a value is
          // present, since they are captured asynchronously during the chat and
          // are not represented in the lead-level changedFields list.
          if (!m.sourceField) return false;
          if (changedSources.has(m.sourceField)) return true;
          if (m.sourceField.startsWith('journey.')) {
            const key = m.sourceField.slice('journey.'.length);
            return !!context.journey?.[key];
          }
          // Conversation summary/topics (conversation.*) are generated
          // asynchronously after the chat and are not represented in the
          // lead-level changedFields list, so include whenever a value exists.
          if (m.sourceField.startsWith('conversation.')) {
            const key = m.sourceField.slice('conversation.'.length);
            if (key === 'summary') return !!context.conversation?.summary;
            if (key === 'topics') return !!context.conversation?.topics;
            return false;
          }
          return false;
        });
        
        console.log('[LeadSquared] Update filtering - Changed fields:', changedFields.join(', '), '- Filtered mappings:', filteredMappings.length);
      }
      
      const attributeArray = this.buildAttributesFromMappings(filteredMappings, context);
      
      console.log('[LeadSquared] Updating lead with dynamic mappings - Host:', this.baseUrl, '- Lead ID:', leadId);
      console.log('[LeadSquared] Updating lead - Fields count:', attributeArray.length, '- Fields:', attributeArray.map(a => a.Attribute).join(', '));
      
      if (attributeArray.length === 0) {
        return {
          success: false,
          message: 'No fields to sync - all field mappings are disabled or have no data',
        };
      }
      
      // Build a simple key-value payload for debugging/display
      const syncPayload: Record<string, string> = {};
      for (const attr of attributeArray) {
        syncPayload[attr.Attribute] = attr.Value;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(attributeArray),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[LeadSquared] Updating lead - Error response:', errorText);
        let detailedError = `Failed to update lead: ${response.status} ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.ExceptionMessage) detailedError = errorJson.ExceptionMessage;
          else if (errorJson.Message) detailedError = errorJson.Message;
          else if (errorJson.message) detailedError = errorJson.message;
        } catch { 
          if (errorText && errorText.length < 500) detailedError += ` — ${errorText}`;
        }
        return {
          success: false,
          message: detailedError,
        };
      }

      const data: LeadSquaredResponse = await response.json();
      
      if (data.Status === 'Success') {
        return {
          success: true,
          message: 'Lead updated successfully in LeadSquared',
          syncPayload,
        };
      } else {
        console.error('[LeadSquared] Updating lead - Failed:', data.ExceptionMessage || 'Unknown error');
        return {
          success: false,
          message: data.ExceptionMessage || 'Failed to update lead',
        };
      }
    } catch (error: any) {
      console.error('[LeadSquared] Update lead with mappings failed:', error);
      return {
        success: false,
        message: error.message || 'Failed to update lead in LeadSquared',
      };
    }
  }

  async createLead(leadData: LeadSquaredLeadData): Promise<{ success: boolean; leadId?: string; message: string; alreadyExists?: boolean }> {
    try {
      const url = `${this.baseUrl}/v2/LeadManagement.svc/Lead.Capture?accessKey=${this.config.accessKey}&secretKey=${this.config.secretKey}`;
      
      const attributeArray = this.buildAttributeArray(leadData);
      
      // Detailed logging for debugging (sanitized - no credentials or PII)
      console.log('[LeadSquared] Creating lead - Host:', this.baseUrl);
      console.log('[LeadSquared] Creating lead - Fields count:', attributeArray.length, '- Fields:', attributeArray.map(a => a.Attribute).join(', '));
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(attributeArray),
      });

      console.log('[LeadSquared] Creating lead - Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[LeadSquared] Creating lead - Error response:', errorText);
        let detailedError = `Failed to create lead: ${response.status} ${response.statusText}`;
        let exceptionType: string | undefined;
        try {
          const errorJson = JSON.parse(errorText);
          exceptionType = errorJson.ExceptionType;
          if (errorJson.ExceptionMessage) detailedError = errorJson.ExceptionMessage;
          else if (errorJson.Message) detailedError = errorJson.Message;
          else if (errorJson.message) detailedError = errorJson.message;
        } catch { 
          if (errorText && errorText.length < 500) detailedError += ` — ${errorText}`;
        }
        // The lead already exists in LeadSquared — treat as a successful sync.
        if (isDuplicateLeadError(exceptionType, detailedError)) {
          console.log('[LeadSquared] Creating lead - Already exists, treating as synced:', detailedError);
          return {
            success: true,
            alreadyExists: true,
            message: 'Lead already exists in LeadSquared (treated as synced).',
          };
        }
        return {
          success: false,
          message: detailedError,
        };
      }

      const data: LeadSquaredResponse = await response.json();
      console.log('[LeadSquared] Creating lead - Response status:', data.Status, '- Lead ID:', data.Message?.Id || 'N/A');
      
      if (data.Status === 'Success' && data.Message?.Id) {
        return {
          success: true,
          leadId: data.Message.Id,
          message: 'Lead created successfully in LeadSquared',
        };
      } else if (isDuplicateLeadError(data.ExceptionType, data.ExceptionMessage)) {
        // Some clusters return the duplicate signal as HTTP 200 with Status=Error.
        console.log('[LeadSquared] Creating lead - Already exists, treating as synced:', data.ExceptionMessage);
        return {
          success: true,
          alreadyExists: true,
          message: 'Lead already exists in LeadSquared (treated as synced).',
        };
      } else {
        console.error('[LeadSquared] Creating lead - Failed:', data.ExceptionMessage || 'Unknown error');
        return {
          success: false,
          message: data.ExceptionMessage || 'Failed to create lead',
        };
      }
    } catch (error: any) {
      console.error('[LeadSquared] Create lead failed:', error);
      return {
        success: false,
        message: error.message || 'Failed to push lead to LeadSquared',
      };
    }
  }

  async updateLead(leadId: string, leadData: Partial<LeadSquaredLeadData>): Promise<{ success: boolean; message: string }> {
    try {
      const url = `${this.baseUrl}/v2/LeadManagement.svc/Lead.Update?accessKey=${this.config.accessKey}&secretKey=${this.config.secretKey}&leadId=${leadId}`;
      
      const attributeArray = this.buildAttributeArray(leadData as LeadSquaredLeadData);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(attributeArray),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let detailedError = `Failed to update lead: ${response.status} ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.ExceptionMessage) detailedError = errorJson.ExceptionMessage;
          else if (errorJson.Message) detailedError = errorJson.Message;
          else if (errorJson.message) detailedError = errorJson.message;
        } catch { 
          if (errorText && errorText.length < 500) detailedError += ` — ${errorText}`;
        }
        return {
          success: false,
          message: detailedError,
        };
      }

      const data: LeadSquaredResponse = await response.json();
      
      if (data.Status === 'Success') {
        return {
          success: true,
          message: 'Lead updated successfully in LeadSquared',
        };
      } else {
        return {
          success: false,
          message: data.ExceptionMessage || 'Failed to update lead',
        };
      }
    } catch (error: any) {
      console.error('[LeadSquared] Update lead failed:', error);
      return {
        success: false,
        message: error.message || 'Failed to update lead in LeadSquared',
      };
    }
  }
}

/**
 * Build the journey answer context for a conversation, keyed by each step's
 * configured CRM field key. Used to populate `LeadDataContext.journey` so that
 * field mappings referencing `journey.<key>` resolve to the visitor's answer.
 * Best-effort: returns an empty object on any failure.
 */
export async function buildJourneyCrmContext(conversationId: string | null | undefined): Promise<Record<string, string>> {
  if (!conversationId) return {};
  try {
    const { db } = await import('../db');
    const { journeyResponses, journeySteps } = await import('../../shared/schema');
    const { eq, and, isNotNull, asc } = await import('drizzle-orm');

    // Ordered oldest → newest so that, for a key reused across steps or
    // re-answered within the same conversation, the most recent answer
    // deterministically overwrites earlier ones (latest-per-key wins).
    const rows = await db
      .select({
        crmFieldKey: journeySteps.crmFieldKey,
        response: journeyResponses.response,
      })
      .from(journeyResponses)
      .innerJoin(journeySteps, eq(journeyResponses.stepId, journeySteps.id))
      .where(and(
        eq(journeyResponses.conversationId, conversationId),
        isNotNull(journeySteps.crmFieldKey),
      ))
      .orderBy(asc(journeyResponses.createdAt));

    const map: Record<string, string> = {};
    for (const row of rows) {
      const key = (row.crmFieldKey || '').trim();
      const value = row.response != null ? String(row.response).trim() : '';
      // Latest answer wins (rows are ordered ascending by createdAt).
      if (key && value) map[key] = value;
    }
    return map;
  } catch (err) {
    console.error('[LeadSquared] buildJourneyCrmContext failed (continuing):', err);
    return {};
  }
}

/**
 * Build the conversation summary context for a conversation. Reads the
 * AI-generated summary and topic keywords stored on the conversation and
 * returns them shaped for `LeadDataContext.conversation` so that field mappings
 * referencing `conversation.summary` / `conversation.topics` resolve correctly.
 * Topic keywords are stored as a JSON array and joined into a comma-separated
 * string. Best-effort: returns an empty object on any failure.
 */
export async function buildConversationCrmContext(
  conversationId: string | null | undefined,
): Promise<{ summary?: string | null; topics?: string | null }> {
  if (!conversationId) return {};
  try {
    const { db } = await import('../db');
    const { conversations } = await import('../../shared/schema');
    const { eq } = await import('drizzle-orm');

    const rows = await db
      .select({
        summary: conversations.summary,
        topicKeywords: conversations.topicKeywords,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    const row = rows[0];
    if (!row) return {};

    const summary = row.summary != null ? String(row.summary).trim() : '';

    // topicKeywords is stored as a JSON array string. Parse and comma-join;
    // gracefully fall back to the raw trimmed value if it isn't valid JSON.
    let topics = '';
    const raw = row.topicKeywords != null ? String(row.topicKeywords).trim() : '';
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          topics = parsed
            .map((t) => (t != null ? String(t).trim() : ''))
            .filter((t) => t.length > 0)
            .join(', ');
        } else {
          topics = raw;
        }
      } catch {
        topics = raw;
      }
    }

    return {
      summary: summary || null,
      topics: topics || null,
    };
  } catch (err) {
    console.error('[LeadSquared] buildConversationCrmContext failed (continuing):', err);
    return {};
  }
}

export async function createLeadSquaredService(config: LeadSquaredConfig): Promise<LeadSquaredService> {
  return new LeadSquaredService(config);
}
