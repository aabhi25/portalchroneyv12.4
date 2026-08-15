import { SalesforceFieldMapping } from '@shared/schema';
import { LeadDataContext, extractUtmCampaign, extractUtmSource, extractUtmMedium } from './leadsquaredService';

export interface SalesforceConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  environment: 'production' | 'sandbox';
}

interface SalesforceAuthResponse {
  access_token: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature: string;
}

const SF_FIELD_MAX_LENGTH = 255;

function trimToMaxLength(value: string | undefined | null): string {
  if (!value) return '';
  return value.length > SF_FIELD_MAX_LENGTH ? value.substring(0, SF_FIELD_MAX_LENGTH) : value;
}

export class SalesforceService {
  private config: SalesforceConfig;
  private loginUrl: string;
  private accessToken: string | null = null;
  private instanceUrl: string | null = null;

  constructor(config: SalesforceConfig) {
    this.config = config;
    this.loginUrl = config.environment === 'sandbox'
      ? 'https://test.salesforce.com'
      : 'https://login.salesforce.com';
  }

  private async authenticate(): Promise<{ accessToken: string; instanceUrl: string }> {
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      username: this.config.username,
      password: this.config.password,
    });

    const response = await fetch(`${this.loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `Authentication failed: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error_description) errorMsg = errorJson.error_description;
        else if (errorJson.error) errorMsg = errorJson.error;
      } catch {}
      throw new Error(errorMsg);
    }

    const data: SalesforceAuthResponse = await response.json();
    this.accessToken = data.access_token;
    this.instanceUrl = data.instance_url;
    return { accessToken: data.access_token, instanceUrl: data.instance_url };
  }

  async testConnection(): Promise<{ success: boolean; message: string; instanceUrl?: string }> {
    try {
      console.log(`[Salesforce] Testing connection (${this.config.environment})`);
      const { instanceUrl } = await this.authenticate();
      console.log('[Salesforce] Connection successful, instance:', instanceUrl);
      return { success: true, message: 'Connected successfully to Salesforce', instanceUrl };
    } catch (error: any) {
      console.error('[Salesforce] Connection test failed:', error.message);
      return { success: false, message: error.message || 'Failed to connect to Salesforce' };
    }
  }

  buildAttributesFromMappings(mappings: SalesforceFieldMapping[], context: LeadDataContext): Record<string, string> {
    const attributes: Record<string, string> = {};

    for (const mapping of mappings) {
      if (mapping.isEnabled !== 'true') continue;

      let value: string | undefined;

      if (mapping.sourceType === 'custom') {
        value = mapping.customValue || undefined;
      } else if (mapping.sourceType === 'dynamic' && mapping.sourceField) {
        value = this.extractValueFromContext(mapping.sourceField, context);
      }

      if (value) {
        attributes[mapping.salesforceField] = trimToMaxLength(value);
      }
    }

    return attributes;
  }

  private extractValueFromContext(sourceField: string, context: LeadDataContext): string | undefined {
    const [category, field] = sourceField.split('.');

    if (category === 'lead') {
      switch (field) {
        case 'name': return context.lead.name || undefined;
        case 'email': return context.lead.email || undefined;
        case 'phone': return context.lead.phone || undefined;
        case 'whatsapp': return context.lead.whatsapp || undefined;
        case 'createdAt': return context.lead.createdAt ? context.lead.createdAt.toISOString() : undefined;
        case 'sourceUrl': return context.lead.sourceUrl || undefined;
      }
    } else if (category === 'session') {
      switch (field) {
        case 'city': return context.session.city || undefined;
        case 'utmCampaign': return context.session.utmCampaign || extractUtmCampaign(context.session.pageUrl);
        case 'utmSource': return context.session.utmSource || undefined;
        case 'utmMedium': return context.session.utmMedium || undefined;
        case 'pageUrl': return context.session.pageUrl || undefined;
      }
    } else if (category === 'business') {
      switch (field) {
        case 'name': return context.business.name || undefined;
        case 'website': return context.business.website || undefined;
      }
    } else if (category === 'urlLookup') {
      switch (field) {
        case 'university': return context.urlExtraction?.university || undefined;
        case 'product': return context.urlExtraction?.product || undefined;
      }
    }

    return undefined;
  }

  async createLeadWithMappings(
    mappings: SalesforceFieldMapping[],
    context: LeadDataContext
  ): Promise<{ success: boolean; leadId?: string; message: string }> {
    try {
      const { accessToken, instanceUrl } = await this.authenticate();

      const attributes = this.buildAttributesFromMappings(mappings, context);

      // Salesforce Lead requires LastName; fall back to name or 'Unknown'
      if (!attributes['LastName']) {
        const name = context.lead.name;
        if (name) {
          const parts = name.trim().split(' ');
          attributes['LastName'] = trimToMaxLength(parts[parts.length - 1]);
          if (parts.length > 1) {
            attributes['FirstName'] = trimToMaxLength(parts.slice(0, -1).join(' '));
          }
        } else {
          attributes['LastName'] = 'Unknown';
        }
      }

      // Company is also required by Salesforce
      if (!attributes['Company']) {
        attributes['Company'] = trimToMaxLength(context.business.name || 'Unknown');
      }

      console.log('[Salesforce] Creating lead - Fields:', Object.keys(attributes).join(', '));

      const response = await fetch(`${instanceUrl}/services/data/v58.0/sobjects/Lead/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(attributes),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Salesforce] Create lead error:', errorText);
        let errorMsg = `Failed to create lead: ${response.status} ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (Array.isArray(errorJson) && errorJson[0]?.message) errorMsg = errorJson[0].message;
        } catch {}
        return { success: false, message: errorMsg };
      }

      const data = await response.json();
      console.log('[Salesforce] Lead created, ID:', data.id);
      return { success: true, leadId: data.id, message: 'Lead created successfully in Salesforce' };
    } catch (error: any) {
      console.error('[Salesforce] Create lead failed:', error.message);
      return { success: false, message: error.message || 'Failed to push lead to Salesforce' };
    }
  }

  async updateLeadWithMappings(
    salesforceLeadId: string,
    mappings: SalesforceFieldMapping[],
    context: LeadDataContext
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { accessToken, instanceUrl } = await this.authenticate();
      const attributes = this.buildAttributesFromMappings(
        mappings.filter(m => m.sourceType !== 'custom'),
        context
      );

      if (Object.keys(attributes).length === 0) {
        return { success: false, message: 'No fields to update' };
      }

      const response = await fetch(`${instanceUrl}/services/data/v58.0/sobjects/Lead/${salesforceLeadId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(attributes),
      });

      if (response.status === 204) {
        return { success: true, message: 'Lead updated successfully in Salesforce' };
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Salesforce] Update lead error:', errorText);
        let errorMsg = `Failed to update lead: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (Array.isArray(errorJson) && errorJson[0]?.message) errorMsg = errorJson[0].message;
        } catch {}
        return { success: false, message: errorMsg };
      }

      return { success: true, message: 'Lead updated successfully in Salesforce' };
    } catch (error: any) {
      console.error('[Salesforce] Update lead failed:', error.message);
      return { success: false, message: error.message || 'Failed to update lead in Salesforce' };
    }
  }
}

export function createSalesforceService(config: SalesforceConfig): SalesforceService {
  return new SalesforceService(config);
}

export const DEFAULT_SALESFORCE_FIELD_MAPPINGS = [
  { salesforceField: 'LastName',    sourceType: 'dynamic', sourceField: 'lead.name',       displayName: 'Last Name',    sortOrder: 0 },
  { salesforceField: 'FirstName',   sourceType: 'dynamic', sourceField: 'lead.name',       displayName: 'First Name',   sortOrder: 1 },
  { salesforceField: 'Email',       sourceType: 'dynamic', sourceField: 'lead.email',      displayName: 'Email',        sortOrder: 2 },
  { salesforceField: 'Phone',       sourceType: 'dynamic', sourceField: 'lead.phone',      displayName: 'Phone',        sortOrder: 3 },
  { salesforceField: 'Company',     sourceType: 'custom',  customValue: 'Unknown',         displayName: 'Company',      sortOrder: 4 },
  { salesforceField: 'LeadSource',  sourceType: 'custom',  customValue: 'Chroney Chat',    displayName: 'Lead Source',  sortOrder: 5 },
  { salesforceField: 'City',        sourceType: 'dynamic', sourceField: 'session.city',    displayName: 'City',         sortOrder: 6 },
];
