/**
 * Website-chat Smart Lead Training runtime: one entry point per turn.
 *
 *   const turn = await prepareLeadTurn({...});   // before calling the model
 *   …turn.block goes into the final prompt (it is the ONLY lead-collection instruction)…
 *   await finalizeLeadTurn(turn, replyText, knownAfter);   // after the reply is final
 */
import { buildPhoneValidationOverride } from '../leadTrainingPrompt';
import { assistantAskedFields, hasCallbackIntent } from './detectors';
import { normalizeLeadFields, phoneModeFor, type LeadFieldId, type NormalizedLeadField } from './fields';
import { buildLeadTurnBlock, collectedFields, describePlan, keywordHitsFor, resolveLeadCollection, type LeadKnown, type LeadPlan } from './resolver';
import { applyAssistantReply, applyUserTurn, loadLeadCaptureState, updateLeadCaptureState, type LeadCaptureState } from './state';

export * from './fields';
export * from './detectors';
export * from './resolver';
export * from './state';
export { upsertConversationLead, getConversationLead, runSerialized, RETURNING_VISITOR_DAYS } from './leadStore';
export { syncConversationLeadIfReady, evaluateCrmGate, whatsappForCrm } from './crmGate';
export { loadRecentHistory, countUserMessages, HISTORY_RELOAD_LIMIT } from './history';

export interface LeadTurn {
  conversationId: string;
  n: number;
  userMessage: string;
  fields: NormalizedLeadField[];
  known: LeadKnown;
  state: LeadCaptureState;
  collected: Set<LeadFieldId>;
  keywordTriggered: LeadFieldId[];
  plan: LeadPlan;
  /** Per-turn prompt block (empty when OTP is pending — the OTP block replaces it). */
  block: string;
  /** Phone-number rejection note for the model, or null. */
  phoneOverride: string | null;
}

export interface PrepareLeadTurnInput {
  conversationId: string;
  config: any;
  known: LeadKnown;
  userMessage: string;
  /** Visitor message number (1-based, counted in the DB, this message included). */
  n: number;
  lastAssistantMessage?: string;
  otpPending?: boolean;
  /** Callback requests turn into a phone ask (off for tutoring surfaces). */
  allowCallback?: boolean;
}

export async function prepareLeadTurn(input: PrepareLeadTurnInput): Promise<LeadTurn | null> {
  const fields = normalizeLeadFields(input.config);
  if (fields.length === 0) return null;
  const loaded = await loadLeadCaptureState(input.conversationId);
  const collected0 = collectedFields(fields, input.known, loaded);
  const hits = keywordHitsFor(fields, input.userMessage);
  const keywordTriggered = fields.filter(f => f.required && hits.has(f.id)).map(f => f.id);
  const state = applyUserTurn(loaded, { n: input.n, userMessage: input.userMessage, collected: collected0, keywordTriggered });
  const plan = resolveLeadCollection({
    fields,
    known: input.known,
    state,
    userMessageCount: input.n,
    userMessage: input.userMessage,
    callbackRequested: input.allowCallback !== false && hasCallbackIntent(input.userMessage),
    phoneMode: phoneModeFor(input.config),
  });
  const lastAsked = input.lastAssistantMessage ? assistantAskedFields(input.lastAssistantMessage) : new Set<LeadFieldId>();
  const phoneOverride = input.otpPending ? null : buildPhoneValidationOverride(input.userMessage, input.config, {
    phoneMissing: !(input.known.phone && String(input.known.phone).trim()),
    assistantAskedForPhone: lastAsked.has('mobile') || lastAsked.has('whatsapp'),
    lastAssistantMessage: input.lastAssistantMessage,
  });
  const block = input.otpPending ? '' : buildLeadTurnBlock(plan, { knownName: input.known.name, knownPhone: input.known.phone, phoneRejected: !!phoneOverride });
  console.log(`[Lead Plan] conv=${input.conversationId} msg#${input.n} ${describePlan(plan)}${phoneOverride ? ' phone-rejected' : ''}`);
  return {
    conversationId: input.conversationId,
    n: input.n,
    userMessage: input.userMessage,
    fields,
    known: input.known,
    state,
    collected: collectedFields(fields, input.known, state),
    keywordTriggered,
    plan,
    block,
    phoneOverride,
  };
}

/** Re-plan within the same turn (e.g. after capture_lead saved a field) without re-counting the visitor's reaction. */
export function replanLeadTurn(turn: LeadTurn, known: LeadKnown, config: any, state?: LeadCaptureState): LeadTurn {
  const s = state || turn.state;
  const plan = resolveLeadCollection({
    fields: turn.fields, known, state: s, userMessageCount: turn.n, userMessage: turn.userMessage,
    callbackRequested: turn.plan.callbackRequested, phoneMode: phoneModeFor(config),
  });
  return { ...turn, known, state: s, plan, collected: collectedFields(turn.fields, known, s), block: buildLeadTurnBlock(plan, { knownName: known.name, knownPhone: known.phone }) };
}

/**
 * Plan for a conversation outside the chat turn (capture_lead's "next field allowed now"):
 * counts visitor messages in the DB and applies this message's reaction in memory.
 */
export async function planForConversation(args: { conversationId: string; config: any; known: LeadKnown; userMessage: string }): Promise<LeadPlan | null> {
  const fields = normalizeLeadFields(args.config);
  if (fields.length === 0) return null;
  const { countUserMessages } = await import('./history');
  const [loaded, n] = await Promise.all([loadLeadCaptureState(args.conversationId), countUserMessages(args.conversationId)]);
  const turnN = Math.max(n, 1);
  const hits = keywordHitsFor(fields, args.userMessage);
  const state = applyUserTurn(loaded, {
    n: turnN,
    userMessage: args.userMessage,
    collected: collectedFields(fields, args.known, loaded),
    keywordTriggered: fields.filter(f => f.required && hits.has(f.id)).map(f => f.id),
  });
  return resolveLeadCollection({
    fields, known: args.known, state, userMessageCount: turnN, userMessage: args.userMessage,
    callbackRequested: hasCallbackIntent(args.userMessage), phoneMode: phoneModeFor(args.config),
  });
}

/** Persist the turn: the visitor's reaction to the previous ask + what this reply asked for. */
export async function finalizeLeadTurn(turn: LeadTurn | null | undefined, replyText: string, knownAfter?: LeadKnown): Promise<void> {
  if (!turn) return;
  const known = knownAfter || turn.known;
  try {
    await updateLeadCaptureState(turn.conversationId, (fresh) => {
      const before = collectedFields(turn.fields, turn.known, fresh);
      let s = applyUserTurn(fresh, { n: turn.n, userMessage: turn.userMessage, collected: before, keywordTriggered: turn.keywordTriggered });
      const plan = turn.plan;
      s = applyAssistantReply(s, {
        n: turn.n,
        replyText,
        fields: turn.fields,
        collected: collectedFields(turn.fields, known, s),
        plannedId: plan.next?.id ?? plan.intentOption?.id ?? null,
        plannedMode: plan.next?.mode ?? plan.intentOption?.mode ?? null,
        blockAskId: plan.next?.mode === 'block' && !turn.phoneOverride ? plan.next.id : null,
        whatsappConfirm: plan.next?.reason === 'whatsapp_confirm' || plan.intentOption?.reason === 'whatsapp_confirm',
        phoneKnown: !!(known.phone && String(known.phone).trim()),
      });
      return s;
    });
  } catch (err) {
    console.error('[Lead Plan] finalize failed (non-fatal):', err);
  }
}
