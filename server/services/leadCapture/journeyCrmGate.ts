/**
 * "Send to CRM after this question" on a journey (journey_steps.crm_sync_after for website chat,
 * whatsapp_flow_steps.crm_sync_after for WhatsApp): a lead from a visitor who started such a journey
 * goes to the CRM automatically only once they answered that question or finished the journey, so
 * people who leave after giving a (junk) number are not sent. Until then the lead shows
 * "Waiting for journey step" with a Sync now button; it is never sent automatically.
 *
 * Leads from chats without such a journey (or other channels) are not affected.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db';

/** CRM status shown while a lead waits for the journey question (LeadSquared columns). */
export const JOURNEY_WAIT_STATUS = 'waiting_journey';
/** CRM status for a lead whose typed mobile number looks like junk. */
export const INVALID_PHONE_STATUS = 'invalid_phone';
/** Statuses that hold a lead back from automatic and bulk sync (Sync now on the lead still sends). */
export const HELD_STATUSES = [JOURNEY_WAIT_STATUS, INVALID_PHONE_STATUS] as const;

export interface JourneyCrmWait {
  waiting: boolean;
  /** The question the visitor still has to answer (for the Leads page). */
  question?: string;
}

const rowsOf = (res: any): any[] => res?.rows ?? res ?? [];
const shorten = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function journeyWaitMessage(question?: string): string {
  return question
    ? `Waiting for the visitor to answer “${shorten(question.trim())}” in the journey`
    : 'Waiting for the visitor to reach the journey step set for CRM';
}

/**
 * Website chat: waiting when the conversation started at least one journey with a "send to CRM
 * after" question and, in none of them, that question was answered or the journey finished.
 */
export async function websiteJourneyCrmWait(conversationId: string | null | undefined): Promise<JourneyCrmWait> {
  if (!conversationId) return { waiting: false };
  const rows = rowsOf(await db.execute(sql`
    SELECT s.completed, st.question_text,
      EXISTS (SELECT 1 FROM journey_responses r WHERE r.conversation_id = s.conversation_id AND r.step_id = st.id) AS answered
    FROM journey_sessions s
    JOIN journey_steps st ON st.journey_id = s.journey_id AND st.crm_sync_after = 'true'
    WHERE s.conversation_id = ${conversationId}
  `));
  if (rows.length === 0) return { waiting: false };
  if (rows.some(r => r.completed === 'true' || r.answered === true || r.answered === 't')) return { waiting: false };
  return { waiting: true, question: rows[0].question_text };
}

/**
 * WhatsApp: the lead's journey session (or, for older leads, the sender's sessions) — waiting when
 * a session's flow has a "send to CRM after" step and no such session moved past it, saved its
 * answer, or finished.
 */
export async function whatsappJourneyCrmWait(lead: { id: string }): Promise<JourneyCrmWait> {
  const rows = rowsOf(await db.execute(sql`
    SELECT s.status, s.crm_step_passed_at, st.prompt,
      (st.save_to_field IS NOT NULL AND COALESCE(s.collected_data->>st.save_to_field, '') <> '') AS answered
    FROM whatsapp_leads w
    JOIN whatsapp_flow_sessions s ON s.business_account_id = w.business_account_id
      AND (s.id = w.flow_session_id OR (w.flow_session_id IS NULL AND s.sender_phone = w.sender_phone))
    JOIN whatsapp_flow_steps st ON st.flow_id = s.flow_id AND st.crm_sync_after = true AND st.paused = false
    WHERE w.id = ${lead.id}
  `));
  if (rows.length === 0) return { waiting: false };
  if (rows.some(r => r.status === 'completed' || r.crm_step_passed_at || r.answered === true || r.answered === 't')) return { waiting: false };
  return { waiting: true, question: rows[0].prompt };
}

/** Is this step marked "send to CRM after"? (website journey step) */
export async function isWebsiteCrmStep(stepId: string): Promise<boolean> {
  const rows = rowsOf(await db.execute(sql`SELECT 1 FROM journey_steps WHERE id = ${stepId} AND crm_sync_after = 'true' LIMIT 1`));
  return rows.length > 0;
}

/**
 * The visitor just answered a website journey question or finished the journey: if that releases
 * a waiting lead, send it now (the CRM gate decides; nothing happens when there's nothing to send).
 * Never throws; doesn't wait for the CRM.
 */
export function onWebsiteJourneyProgress(conversationId: string, opts: { stepId?: string; completed?: boolean }): void {
  (async () => {
    if (!opts.completed && !(opts.stepId && await isWebsiteCrmStep(opts.stepId))) return;
    const rows = rowsOf(await db.execute(sql`
      SELECT id, business_account_id FROM leads WHERE conversation_id = ${conversationId}
        AND (COALESCE(phone, '') <> '' OR COALESCE(email, '') <> '')
      ORDER BY created_at DESC LIMIT 1
    `));
    const lead = rows[0];
    if (!lead) return;
    const { syncConversationLeadIfReady } = await import('./crmGate');
    // Meritto's worker looks at waiting leads again by itself.
    await syncConversationLeadIfReady({ leadId: lead.id, businessAccountId: lead.business_account_id, conversationId, channel: 'widget', source: 'journey_crm_step' });
  })().catch(err => console.error('[Journey CRM step] Could not send the lead after the journey step:', err));
}

/**
 * SQL for whatsapp_flow_sessions.crm_step_passed_at when the session leaves its current step:
 * set (once) when that step is the flow's "send to CRM after" step.
 */
export function crmStepPassedAtSql(sessionTable: { crmStepPassedAt: any; flowId: any; currentStepKey: any }, nextStepKey?: string) {
  return sql`COALESCE(${sessionTable.crmStepPassedAt}, CASE WHEN EXISTS (
    SELECT 1 FROM whatsapp_flow_steps st
    WHERE st.flow_id = ${sessionTable.flowId} AND st.step_key = ${sessionTable.currentStepKey} AND st.crm_sync_after = true
  ) ${nextStepKey === undefined ? sql`` : sql`AND ${sessionTable.currentStepKey} <> ${nextStepKey}`} THEN now() END)`;
}
