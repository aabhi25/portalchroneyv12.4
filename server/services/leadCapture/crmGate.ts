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
 * A lead held back only because a mandatory field is still missing is not lost: once the chat has
 * been quiet for HELD_BACK_IDLE_MINUTES, sendHeldBackLeads (run by the LeadSquared retry worker)
 * sends it with what it has — verification (OTP/CAPTCHA) still applies.
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
  /** Send even though a mandatory field is missing (the visitor left without giving it). */
  ignoreMandatory?: boolean;
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
  if (required.length > 0 && !input.ignoreMandatory) {
    const have = collectedFields(fields, { name: lead.name, email: lead.email, phone: lead.phone }, state || { v: 1, fields: {}, lastAsk: null, processedUserMsg: 0 });
    const missing = required.filter(f => !have.has(f.id)).map(f => f.id);
    if (missing.length) return { ok: false, result: 'skipped:mandatory_missing', missing };
  }

  const rawFields: any[] = Array.isArray(config?.fields) ? config.fields : [];
  const mobile = rawFields.find(f => f?.id === 'mobile' && f.enabled);
  const onWidget = input.channel === 'widget';
  const otpEffective = onWidget && mobile?.otpEnabled === true
    && await (await import('../otp')).isOtpEffectivelyEnabled(input.businessAccountId, config);
  if (otpEffective && lead.phone && conversationId) {
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

/** A chat must be quiet this long before a lead missing a mandatory field is sent anyway. */
export const HELD_BACK_IDLE_MINUTES = 30;
/** Only leads created this recently are considered (older ones were handled by the previous rules). */
const HELD_BACK_LOOKBACK_DAYS = 3;

/**
 * Website-chat leads that were held back because a mandatory field was never given (the visitor
 * refused or left) are sent once the chat has been quiet for HELD_BACK_IDLE_MINUTES, so a phone or
 * email is never lost. Only conversations handled by the per-conversation lead rules (they carry
 * lead_capture_state) qualify, so older leads are never swept. Never throws.
 */
export async function sendHeldBackLeads(limit = 50): Promise<number> {
  const { db } = await import('../../db');
  const { sql } = await import('drizzle-orm');
  try {
    // Cut-offs computed here, like the other LeadSquared sweeps (timestamps are stored as UTC).
    const idleBefore = new Date(Date.now() - HELD_BACK_IDLE_MINUTES * 60_000).toISOString();
    const createdAfter = new Date(Date.now() - HELD_BACK_LOOKBACK_DAYS * 24 * 60 * 60_000).toISOString();
    const res = await db.execute(sql`
      SELECT l.id, l.business_account_id, l.conversation_id
      FROM leads l
      JOIN conversations c ON c.id = l.conversation_id
      JOIN widget_settings ws ON ws.business_account_id = l.business_account_id AND ws.leadsquared_enabled = 'true'
      WHERE (l.leadsquared_sync_status IS NULL OR l.leadsquared_sync_status = '')
        AND l.leadsquared_lead_id IS NULL
        AND (COALESCE(l.phone, '') <> '' OR COALESCE(l.email, '') <> '')
        AND c.lead_capture_state IS NOT NULL
        -- tried once already and nothing changed since (e.g. still waiting for OTP): skip
        AND (c.lead_capture_state->>'crmSweptAt' IS NULL OR (c.lead_capture_state->>'crmSweptAt')::timestamp < l.updated_at)
        AND l.created_at > ${createdAfter}::timestamp
        AND l.updated_at < ${idleBefore}::timestamp
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.conversation_id = l.conversation_id AND m.created_at > ${idleBefore}::timestamp
        )
      ORDER BY l.created_at ASC
      LIMIT ${limit}
    `);
    let sent = 0;
    for (const row of res.rows as Array<{ id: string; business_account_id: string; conversation_id: string }>) {
      const result = await syncConversationLeadIfReady({
        leadId: row.id,
        businessAccountId: row.business_account_id,
        conversationId: row.conversation_id,
        channel: 'widget',
        source: 'held_back_sweep',
        ignoreMandatory: true,
      });
      if (result === 'synced') sent++;
      else {
        // Still blocked (verification pending, LeadSquared off…): don't pick it again until the lead changes.
        await db.execute(sql`
          UPDATE conversations
          SET lead_capture_state = jsonb_set(COALESCE(lead_capture_state, '{}'::jsonb), '{crmSweptAt}', to_jsonb(${new Date().toISOString()}::text))
          WHERE id = ${row.conversation_id}
        `).catch(() => undefined);
      }
    }
    return sent;
  } catch (err) {
    console.error('[CRM Gate] Held-back lead sweep failed:', err);
    return 0;
  }
}
