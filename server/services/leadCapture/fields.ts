/**
 * Smart Lead Training field config, normalised for the website-chat runtime.
 *
 * Timing strategies (per field, from widget_settings.leadTrainingConfig):
 *  - 'start'   → due from the visitor's first message.
 *  - 'custom'  → due from the visitor's message #customAskAfter (each field uses ITS OWN value; default 2).
 *  - 'intent'  → due when the visitor shows intent at the field's sensitivity (the model judges it).
 *  - 'keyword' → due when the visitor's message contains one of the field's keywords (whole words).
 * Legacy values: 'smart' (or missing) → 'custom' with askAfter 2 (it meant "answer message #1, ask from #2");
 * 'end' → 'keyword'. A keyword field with NO keywords (typically a legacy 'end' field) would never fire,
 * so it behaves like 'custom' with askAfter 3: answer the first questions, ask later in the chat.
 */

export type LeadFieldId = 'name' | 'mobile' | 'whatsapp' | 'email';
export type LeadStrategy = 'start' | 'custom' | 'intent' | 'keyword';
export type PhoneMode = '10' | '12' | '8-12' | 'any';

export interface NormalizedLeadField {
  id: LeadFieldId;
  required: boolean;
  priority: number;
  strategy: LeadStrategy;
  /** Custom timing: the visitor message number from which this field is due. */
  askAfter: number;
  keywords: string[];
  intentIntensity: 'low' | 'medium' | 'high';
  phoneValidation: PhoneMode;
  otpEnabled: boolean;
  /** Original strategy string, for logs. */
  configuredStrategy: string;
}

export const DEFAULT_CUSTOM_ASK_AFTER = 2;
/** Keyword timing with no keywords configured (legacy "At End"): ask from this visitor message. */
export const KEYWORDLESS_ASK_AFTER = 3;

const SUPPORTED: Record<string, LeadFieldId> = { name: 'name', mobile: 'mobile', phone: 'mobile', whatsapp: 'whatsapp', email: 'email' };

export function normalizeLeadFields(config: any): NormalizedLeadField[] {
  const raw: any[] = Array.isArray(config?.fields) ? config.fields : [];
  const out: NormalizedLeadField[] = [];
  const seen = new Set<string>();
  raw.forEach((f, index) => {
    if (!f || typeof f !== 'object' || f.enabled !== true || typeof f.id !== 'string') return;
    const id = SUPPORTED[f.id.toLowerCase()];
    if (!id || seen.has(id)) return;
    seen.add(id);
    const configured = typeof f.captureStrategy === 'string' ? f.captureStrategy : 'smart';
    const keywords: string[] = Array.isArray(f.captureKeywords)
      ? f.captureKeywords.map((k: any) => String(k ?? '').trim()).filter(Boolean)
      : [];
    let strategy: LeadStrategy;
    let askAfter = Number.isFinite(Number(f.customAskAfter)) && Number(f.customAskAfter) >= 1
      ? Math.floor(Number(f.customAskAfter)) : DEFAULT_CUSTOM_ASK_AFTER;
    switch (configured) {
      case 'start': strategy = 'start'; break;
      case 'intent': strategy = 'intent'; break;
      case 'keyword':
      case 'end':
        if (keywords.length > 0) strategy = 'keyword';
        else { strategy = 'custom'; askAfter = KEYWORDLESS_ASK_AFTER; }
        break;
      case 'custom':
      case 'smart':
      default:
        strategy = 'custom';
    }
    const intensity = f.intentIntensity === 'low' || f.intentIntensity === 'high' ? f.intentIntensity : 'medium';
    const pv = ['10', '12', '8-12', 'any'].includes(f.phoneValidation) ? f.phoneValidation : '10';
    out.push({
      id,
      required: f.required === true,
      priority: typeof f.priority === 'number' && Number.isFinite(f.priority) ? f.priority : 100 + index,
      strategy,
      askAfter: Math.min(Math.max(askAfter, 1), 50),
      keywords,
      intentIntensity: intensity,
      phoneValidation: pv,
      otpEnabled: f.otpEnabled === true,
      configuredStrategy: configured,
    });
  });
  // Stable sort by priority (ties keep config order).
  return out.map((f, i) => ({ f, i })).sort((a, b) => a.f.priority - b.f.priority || a.i - b.i).map(x => x.f);
}

/** Phone digit rule for the lead: mobile's setting first, then WhatsApp's, default '10'. */
export function phoneModeFor(config: any): PhoneMode {
  const fields: any[] = Array.isArray(config?.fields) ? config.fields : [];
  const mobile = fields.find(f => f?.id === 'mobile' && f.enabled);
  const wa = fields.find(f => f?.id === 'whatsapp' && f.enabled);
  const v = mobile?.phoneValidation || wa?.phoneValidation;
  return ['10', '12', '8-12', 'any'].includes(v) ? v : '10';
}

export function hasEnabledPhoneField(config: any): boolean {
  const fields: any[] = Array.isArray(config?.fields) ? config.fields : [];
  return fields.some(f => f && f.enabled === true && ['mobile', 'whatsapp', 'phone'].includes(String(f.id).toLowerCase()));
}

export const FIELD_LABEL: Record<LeadFieldId, string> = {
  name: 'name',
  mobile: 'mobile number',
  whatsapp: 'WhatsApp number',
  email: 'email address',
};

export const INTENT_DESCRIPTION: Record<'low' | 'medium' | 'high', string> = {
  low: 'ANY interest beyond small talk (asking about any course/product/service, features, availability, eligibility)',
  medium: 'evaluating intent (pricing/fees/cost, comparing options, discounts/offers, availability of a specific item, details to decide)',
  high: 'strong action intent only (wants to buy/order/book/apply/enroll/register/sign up/schedule — "I want to…", "how do I sign up")',
};
