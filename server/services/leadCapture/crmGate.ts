/**
 * When may a website-chat lead go to the CRM (LeadSquared auto-sync)?
 *
 *  - The lead needs a phone or an email (LeadSquared rejects name-only leads).
 *  - Every MANDATORY lead-training field must be collected first. Accounts with no mandatory
 *    fields keep the old behaviour: the lead syncs as soon as it has a phone/email.
 *  - Verification: OTP (mobile.otpEnabled, widget) must be verified for the lead's phone; CAPTCHA
 *    (mobile.captchaEnabled, widget) must be passed unless "send unverified leads" is on.
 *  - The first sync creates the CRM lead; once the lead has a LeadSquared id every later change
 *    goes through LeadSquared's update path with only the changed fields.
 *  - Syncs for one conversation run one at a time (in-process queue), so a create and an update
 *    can't race into two CRM leads.
 * A lead held back here is never marked 'pending', so the retry worker never pushes it either.
 */
import { storage } from '../../storage';
import { normalizeLeadFields } from './fields';
import { collectedFields } from './resolver';
import { loadLeadCaptureState } from './state';
import { runSerialized } from './leadStore';

export type CrmGateResult = 'synced' | 'skipped:disabled' | 'skipped:no_contact' | 'skipped:mandatory_missing'
  | 'skipped:otp_unverified' | 'skipped:captcha_unverified' | 'skipped:not_found' | 'error';

export interface CrmGateInput {
  leadId: string;
  businessAccountId: string;
  conversationId?: string | null;
  changedFields?: string[];
  channel?: string | null;
  /** For logs. */
  source: string;
}

/** WhatsApp number for CRM mapping (no whatsapp column on leads): from the conversation's lead state. */
export function whatsappForCrm(config: any, phone: string | null | undefined, wa?: { number?: string | null; sameAsMobile?: boolean | null }): string | null {
  if (wa?.number) return wa.number;
  const fields = normalizeLeadFields(config);
  const hasWa = fields.some(f => f.id === 'whatsapp');
  const hasMobile = fields.some(f => f.id === 'mobile');
  if (!phone) return null;
  if (hasWa && !hasMobile) return phone;
  if (wa?.sameAsMobile === true) return phone;
  return null;
}

export async function evaluateCrmGate(input: CrmGateInput): Promise<{ ok: boolean; result: CrmGateResult; lead?: any; whatsapp?: string | null; missing?: string[] }> {
  const settings: any = await storage.getWidgetSettings(input.businessAccountId);
  if (!settings?.leadsquaredEnabled || settings.leadsquaredEnabled !== 'true') return { ok: false, result: 'skipped:disabled' };
  const lead = await storage.getLead(input.leadId, input.businessAccountId);
  if (!lead) return { ok: false, result: 'skipped:not_found' };
  if (!lead.phone && !lead.email) return { ok: false, result: 'skipped:no_contact' };

  const config = settings.leadTrainingConfig;
  const fields = normalizeLeadFields(config);
  const conversationId = input.conversationId || lead.conversationId || null;
  const state = conversationId ? await loadLeadCaptureState(conversationId) : null;
  const required = fields.filter(f => f.required);
  if (required.length > 0) {
    const have = collectedFields(fields, { name: lead.name, email: lead.email, phone: lead.phone }, state || { v: 1, fields: {}, lastAsk: null, processedUserMsg: 0 });
    const missing = required.filter(f => !have.has(f.id)).map(f => f.id);
    if (missing.length) return { ok: false, result: 'skipped:mandatory_missing', missing };
  }

  const rawFields: any[] = Array.isArray(config?.fields) ? config.fields : [];
  const mobile = rawFields.find(f => f?.id === 'mobile' && f.enabled);
  const onWidget = input.channel === 'widget';
  if (onWidget && mobile?.otpEnabled === true && lead.phone && conversationId) {
    const { normalizePhone } = await import('../otp');
    const e164 = normalizePhone(lead.phone);
    const verified = e164 ? await storage.hasVerifiedOtpForConversationPhone(input.businessAccountId, conversationId, e164) : false;
    if (!verified) return { ok: false, result: 'skipped:otp_unverified' };
  } else if (onWidget && mobile?.captchaEnabled === true && mobile?.otpEnabled !== true && mobile?.sendUnverifiedLeadsToCrm !== true && conversationId) {
    const status = await storage.getConversationCaptchaStatus(conversationId, input.businessAccountId).catch(() => null);
    if (status !== 'verified') return { ok: false, result: 'skipped:captcha_unverified' };
  }
  return { ok: true, result: 'synced', lead, whatsapp: whatsappForCrm(config, lead.phone, state?.whatsapp) };
}

/**
 * Sync the conversation's lead to LeadSquared if (and only if) it is ready. Never throws.
 * Returns what happened (awaitable for tests; callers in the chat path don't wait on it).
 */
export function syncConversationLeadIfReady(input: CrmGateInput): Promise<CrmGateResult> {
  const key = `crm:${input.conversationId || input.leadId}`;
  return runSerialized(key, async (): Promise<CrmGateResult> => {
    try {
      const gate = await evaluateCrmGate(input);
      if (!gate.ok) {
        if (gate.result !== 'skipped:disabled') {
          console.log(`[CRM Gate] ${input.source}: lead ${input.leadId} not synced (${gate.result}${gate.missing ? `: ${gate.missing.join(', ')}` : ''})`);
        }
        return gate.result;
      }
      const lead = gate.lead;
      const isUpdate = !!lead.leadsquaredLeadId;
      const { syncLeadToLeadSquared } = await import('../toolExecutionService');
      await syncLeadToLeadSquared(
        { id: lead.id, name: lead.name, email: lead.email, phone: lead.phone, leadsquaredLeadId: lead.leadsquaredLeadId, sourceUrl: lead.sourceUrl, whatsapp: gate.whatsapp },
        input.businessAccountId,
        isUpdate,
        isUpdate ? input.changedFields : undefined,
      );
      console.log(`[CRM Gate] ${input.source}: lead ${lead.id} ${isUpdate ? 'update' : 'create'} sent to LeadSquared`);
      return 'synced';
    } catch (err) {
      console.error(`[CRM Gate] ${input.source}: sync error for lead ${input.leadId}:`, err);
      return 'error';
    }
  });
}
