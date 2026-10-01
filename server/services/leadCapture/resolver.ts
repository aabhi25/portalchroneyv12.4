/**
 * THE single decision point for website-chat contact collection: given the lead-training config,
 * what we already know, the per-conversation state and this visitor message, decide the ONE field
 * (if any) to ask for in this reply and whether it blocks answering.
 *
 * Rules (documented in the PR / report):
 *  - A field becomes due at the earliest turn its own timing allows (start / custom #N with the
 *    field's own customAskAfter / keyword hit / intent). A field that is not due yet never blocks a
 *    lower-priority field that is due.
 *  - Among due fields, mandatory ones (they block answering) go first, then optional ones (asked
 *    after answering); within each group the lowest priority number wins. One field per reply.
 *  - Intent fields are judged by the model: they are offered as a conditional instruction
 *    ("if this message shows <sensitivity> intent, ask X instead") whenever they would outrank
 *    the deterministic choice. Once a mandatory intent field has been asked it stays pending.
 *  - A mandatory keyword field stays pending after its keyword appears until given or refused.
 *  - Optional: never again after one refusal; at most OPTIONAL_MAX_ASKS asks; never in two
 *    consecutive replies (a soft ask the visitor ignored gets a turn of rest).
 *  - Mandatory: blocks until MANDATORY_REFUSAL_CAP refusals (explicit "no" or ignored asks), then
 *    the bot answers and re-asks after answering at most MANDATORY_ASKS_AFTER_CAP more time(s),
 *    at least MIN_GAP_AFTER_CAP visitor messages later.
 *  - Mobile + WhatsApp both enabled: they share the lead's phone. After the mobile number is known
 *    the bot asks once whether it is also on WhatsApp; "yes" (or a WhatsApp number) satisfies it.
 *  - A callback request ("call me back") makes the phone the field to ask (or, when already known,
 *    tells the model to confirm the call without asking again).
 */
import { FIELD_LABEL, INTENT_DESCRIPTION, type LeadFieldId, type LeadStrategy, type NormalizedLeadField } from './fields';
import { matchKeywords } from './detectors';
import {
  fieldState, MANDATORY_ASKS_AFTER_CAP, MANDATORY_REFUSAL_CAP, MIN_GAP_AFTER_CAP, OPTIONAL_DECLINES_TO_STOP, OPTIONAL_MAX_ASKS,
  type LeadCaptureState,
} from './state';
import { describePhoneRule } from '../../../shared/validation/phone';

export interface LeadKnown { name?: string | null; email?: string | null; phone?: string | null }

export type AskMode = 'block' | 'after_answer';
export type AskReason = 'start' | 'custom' | 'keyword' | 'intent' | 'callback' | 'retry_after_refusals' | 'whatsapp_confirm';

export interface PlannedAsk {
  id: LeadFieldId;
  label: string;
  required: boolean;
  strategy: LeadStrategy;
  priority: number;
  mode: AskMode;
  reason: AskReason;
  refusals: number;
  keywordHits?: string[];
  intensity?: 'low' | 'medium' | 'high';
}

export interface LeadPlan {
  enabled: boolean;
  collected: LeadFieldId[];
  /** Contact details already known but not configured as lead fields (never ask for these either). */
  knownOther: Array<'name' | 'email' | 'phone'>;
  stopped: Array<{ id: LeadFieldId; why: 'declined' | 'asked_enough' }>;
  next: PlannedAsk | null;
  /** Conditional (model-judged) intent field that would outrank `next` if the message shows intent. */
  intentOption: PlannedAsk | null;
  /** Mandatory keyword fields whose keyword appears in this message. */
  keywordTriggered: LeadFieldId[];
  mandatoryMissing: LeadFieldId[];
  allMandatoryCollected: boolean;
  callbackRequested: boolean;
  /** Visitor wants a call and their phone is already saved. */
  callbackConfirm: boolean;
  /** Fields the visitor declined in THIS message. */
  declinedNow: LeadFieldId[];
  phoneMode: string;
}

export interface ResolverInput {
  fields: NormalizedLeadField[];
  known: LeadKnown;
  state: LeadCaptureState;
  userMessageCount: number;
  userMessage: string;
  callbackRequested?: boolean;
  phoneMode?: string;
}

const has = (v?: string | null) => !!(v && String(v).trim());

export function collectedFields(fields: NormalizedLeadField[], known: LeadKnown, state: LeadCaptureState): Set<LeadFieldId> {
  const ids = new Set(fields.map(f => f.id));
  const out = new Set<LeadFieldId>();
  for (const f of fields) {
    switch (f.id) {
      case 'name': if (has(known.name)) out.add('name'); break;
      case 'email': if (has(known.email)) out.add('email'); break;
      case 'mobile': if (has(known.phone)) out.add('mobile'); break;
      case 'whatsapp': {
        if (has(state.whatsapp?.number)) out.add('whatsapp');
        else if (!ids.has('mobile')) { if (has(known.phone)) out.add('whatsapp'); }
        else if (has(known.phone) && state.whatsapp?.sameAsMobile === true) out.add('whatsapp');
        break;
      }
    }
  }
  return out;
}

/** Keyword fields (any requirement) hit by this message; mandatory ones become pending. */
export function keywordHitsFor(fields: NormalizedLeadField[], message: string): Map<LeadFieldId, string[]> {
  const hits = new Map<LeadFieldId, string[]>();
  for (const f of fields) {
    if (f.strategy !== 'keyword') continue;
    const h = matchKeywords(message, f.keywords);
    if (h.length) hits.set(f.id, h);
  }
  return hits;
}

export function resolveLeadCollection(input: ResolverInput): LeadPlan {
  const { fields, known, state, userMessageCount: n, userMessage } = input;
  const collected = collectedFields(fields, known, state);
  const hits = keywordHitsFor(fields, userMessage);
  const plan: LeadPlan = {
    enabled: fields.length > 0,
    collected: fields.filter(f => collected.has(f.id)).map(f => f.id),
    knownOther: ([['name', 'name'], ['email', 'email'], ['phone', 'mobile']] as const)
      .filter(([k, id]) => has(known[k]) && !fields.some(f => f.id === id || (id === 'mobile' && f.id === 'whatsapp')))
      .map(([k]) => k),
    stopped: [],
    next: null,
    intentOption: null,
    keywordTriggered: fields.filter(f => f.required && hits.has(f.id) && !collected.has(f.id)).map(f => f.id),
    mandatoryMissing: fields.filter(f => f.required && !collected.has(f.id)).map(f => f.id),
    allMandatoryCollected: fields.filter(f => f.required).every(f => collected.has(f.id)),
    callbackRequested: !!input.callbackRequested,
    callbackConfirm: false,
    declinedNow: (state.processedUserMsg === n ? state.declinedNow : undefined) || [],
    phoneMode: input.phoneMode || '10',
  };

  const lastAsk = state.lastAsk;
  const softAskIgnoredLastTurn = !!(lastAsk && lastAsk.at === n - 1 && lastAsk.mode === 'after_answer'
    && lastAsk.fields.some(id => !collected.has(id)));

  const blocking: PlannedAsk[] = [];
  const soft: PlannedAsk[] = [];
  const conditional: PlannedAsk[] = [];

  for (const f of fields) {
    if (collected.has(f.id)) continue;
    const fs = fieldState(state, f.id);
    const refusals = fs.declines + fs.ignored;
    let capped = false;
    if (!f.required) {
      if (fs.declines >= OPTIONAL_DECLINES_TO_STOP) { plan.stopped.push({ id: f.id, why: 'declined' }); continue; }
      if (fs.asked >= OPTIONAL_MAX_ASKS) { plan.stopped.push({ id: f.id, why: 'asked_enough' }); continue; }
    } else if (refusals >= MANDATORY_REFUSAL_CAP) {
      if (fs.asksAfterCap >= MANDATORY_ASKS_AFTER_CAP) { plan.stopped.push({ id: f.id, why: 'asked_enough' }); continue; }
      capped = true;
    }

    const base = {
      id: f.id, label: FIELD_LABEL[f.id], required: f.required, strategy: f.strategy, priority: f.priority, refusals,
    };
    let due = false;
    let reason: AskReason = f.strategy;
    let isConditional = false;
    switch (f.strategy) {
      case 'start': due = true; break;
      case 'custom': due = n >= f.askAfter; break;
      case 'keyword': due = hits.has(f.id) || (f.required && fs.pending); break;
      case 'intent':
        if (f.required && fs.pending) due = true;
        else isConditional = true;
        break;
    }

    let mode: AskMode;
    if (f.required && !capped) {
      mode = 'block';
    } else {
      mode = 'after_answer';
      if (capped) {
        reason = 'retry_after_refusals';
        if (fs.lastAskedAt != null && n - fs.lastAskedAt < MIN_GAP_AFTER_CAP) continue;
      } else if (fs.lastAskedAt === n - 1) {
        continue; // optional field asked in the previous reply and not given: rest one turn
      }
      if (softAskIgnoredLastTurn) continue;
      // The visitor just said no to a contact request: don't ask for something else in the same reply.
      if (plan.declinedNow.length > 0) continue;
    }

    const ask: PlannedAsk = {
      ...base, mode, reason,
      ...(hits.has(f.id) ? { keywordHits: hits.get(f.id) } : {}),
      ...(f.strategy === 'intent' ? { intensity: f.intentIntensity } : {}),
    };
    if (isConditional) conditional.push(ask);
    else if (due) (mode === 'block' ? blocking : soft).push(ask);
  }

  const byPrio = (a: PlannedAsk, b: PlannedAsk) => a.priority - b.priority;
  blocking.sort(byPrio); soft.sort(byPrio); conditional.sort(byPrio);
  plan.next = blocking[0] || soft[0] || null;

  // Mobile known + WhatsApp enabled but unconfirmed → the WhatsApp ask is a yes/no confirmation.
  if (plan.next?.id === 'whatsapp' && has(known.phone) && state.whatsapp?.sameAsMobile !== false) {
    plan.next = { ...plan.next, reason: 'whatsapp_confirm' };
  }

  // Intent: offered when it would outrank the deterministic choice. While a mandatory field is
  // blocking, an optional intent field is not offered (answering is on hold anyway).
  for (const c of conditional) {
    if (!plan.next) { plan.intentOption = c; break; }
    if (plan.next.mode === 'block') {
      if (c.mode === 'block' && c.priority < plan.next.priority) { plan.intentOption = c; break; }
      continue;
    }
    if (c.mode === 'block' || c.priority < plan.next.priority) { plan.intentOption = c; break; }
  }
  if (plan.intentOption?.id === 'whatsapp' && has(known.phone) && state.whatsapp?.sameAsMobile !== false) {
    plan.intentOption = { ...plan.intentOption, reason: 'whatsapp_confirm' };
  }

  // A visitor asking to be called back needs to give a number — that request wins.
  if (plan.callbackRequested) {
    if (has(known.phone)) {
      plan.callbackConfirm = true;
    } else {
      const phoneField = fields.find(f => f.id === 'mobile') || fields.find(f => f.id === 'whatsapp');
      const id: LeadFieldId = phoneField?.id || 'mobile';
      plan.next = {
        id, label: FIELD_LABEL[id], required: !!phoneField?.required, strategy: phoneField?.strategy || 'start',
        priority: phoneField?.priority ?? 0, mode: 'after_answer', reason: 'callback', refusals: 0,
      };
      plan.intentOption = null;
    }
  }
  return plan;
}

const isPhone = (id?: LeadFieldId | null) => id === 'mobile' || id === 'whatsapp';

function askSentence(a: PlannedAsk, knownPhone?: string | null): string {
  switch (a.reason) {
    case 'whatsapp_confirm':
      return `Their mobile number is saved. Ask once whether the same number is also on WhatsApp. If they say yes, call capture_lead with whatsapp_same_as_phone=true; if they give a different WhatsApp number, call capture_lead with whatsapp=<that number>.`;
    case 'callback':
      return `The visitor wants a call back — ask for their ${a.label} so the team can call them (never say you can't call).`;
    case 'retry_after_refusals':
      return `Answer the visitor's message fully first. Then, at the end, gently ask ONE more time for their ${a.label} (it helps the team follow up). If they decline again, accept it — never ask for it again.`;
  }
  if (a.mode === 'block') {
    const refusalNote = a.refusals > 0
      ? ` They have held back ${a.refusals} time(s) already: acknowledge that, give one short reason it helps (e.g. so the team can share the exact details), and ask once more.`
      : ` If they refuse or ask why, give one short reason it helps and ask once more.`;
    return `MANDATORY — before answering, ask the visitor for their ${a.label}. Do not answer their question in this reply: acknowledge it briefly, ask for the ${a.label} only, and say you'll answer right after.${refusalNote}`;
  }
  return `Answer the visitor's message fully first. Then, at the end, ask once (politely, it's optional) for their ${a.label}. If they decline, say no problem and move on.`;
}

/**
 * The per-turn prompt block. Compact on purpose: this replaces every older lead rule (start/custom/
 * intent/keyword/optional/"already collected" blocks) so instructions can't contradict each other.
 */
export function buildLeadTurnBlock(plan: LeadPlan, opts: { knownName?: string | null; knownPhone?: string | null; phoneRejected?: boolean } = {}): string {
  if (!plan.enabled) return '';
  const lines: string[] = ['=== LEAD COLLECTION (THIS TURN) — the only rules for asking contact details ==='];
  if (plan.collected.length || plan.knownOther.length) {
    const parts = plan.collected.map(id => id === 'name' && opts.knownName ? `name (${opts.knownName})` : FIELD_LABEL[id]);
    for (const k of plan.knownOther) parts.push(k === 'phone' ? 'phone number' : k === 'email' ? 'email address' : (opts.knownName ? `name (${opts.knownName})` : 'name'));
    lines.push(`Already have — NEVER ask for these again: ${parts.join(', ')}.`);
  }
  const stopped = plan.stopped.filter(s => !plan.collected.includes(s.id));
  if (stopped.length) {
    lines.push(`Do NOT ask for: ${stopped.map(s => `${FIELD_LABEL[s.id]} (${s.why === 'declined' ? 'visitor declined' : 'already asked enough'})`).join(', ')}.`);
  }
  if (plan.declinedNow.length && plan.next?.mode !== 'block') {
    lines.push(`The visitor just declined to share their ${plan.declinedNow.map(id => FIELD_LABEL[id]).join('/')}: say "no problem" briefly and answer their earlier question — don't ask for it again now.`);
  }
  if (plan.callbackConfirm) {
    lines.push(`The visitor wants a call back and their number is already saved — confirm the team will call them; do NOT ask for the number again.`);
  }
  if (opts.phoneRejected) {
    // The visitor just typed an invalid number: re-entering it is the one ask of this reply.
    lines.push(`NOW: the phone number the visitor just typed is not valid (see PHONE NUMBER NOT VALID at the end) — answer anything else they asked, then ask them to re-enter their mobile number. Ask for nothing else in this reply.`);
  } else if (plan.next) {
    lines.push(`NOW: ${askSentence(plan.next, opts.knownPhone)}`);
  } else if (!plan.callbackConfirm) {
    lines.push(`NOW: no contact detail is due in this reply — just answer${plan.intentOption ? ' (unless the intent check below applies)' : ''}. Do not ask for name, phone or email.`);
  }
  if (plan.intentOption && !opts.phoneRejected) {
    const o = plan.intentOption;
    const then = o.mode === 'block'
      ? `ask for their ${o.label} BEFORE answering (mandatory; one field only)`
      : o.reason === 'whatsapp_confirm' ? `ask whether their saved mobile number is also on WhatsApp` : `answer fully and then politely ask for their ${o.label} (optional)`;
    lines.push(`INTENT CHECK: only if this message shows ${INTENT_DESCRIPTION[o.intensity || 'medium']}, ${then}${plan.next ? ' — instead of the NOW step' : ''}. Otherwise ignore this line.`);
  }
  lines.push('- Ask for at most ONE contact detail per reply; never two together (not "name and number").');
  lines.push('- Whenever the visitor gives a name, phone number or email, call capture_lead with it right away (phone exactly as typed).');
  lines.push('- If capture_lead reports a detail as rejected, tell the visitor briefly and ask them to re-enter only that detail.');
  if (opts.phoneRejected || isPhone(plan.next?.id) || isPhone(plan.intentOption?.id)) {
    lines.push(`- A valid mobile number is ${describePhoneRule(plan.phoneMode)}.`);
  }
  lines.push('=== END LEAD COLLECTION ===');
  return lines.join('\n');
}

/** Short one-line summary for logs. */
export function describePlan(plan: LeadPlan): string {
  const next = plan.next ? `${plan.next.id}:${plan.next.mode}:${plan.next.reason}` : 'none';
  const intent = plan.intentOption ? ` intent?${plan.intentOption.id}:${plan.intentOption.mode}` : '';
  return `next=${next}${intent} collected=[${plan.collected.join(',')}] stopped=[${plan.stopped.map(s => `${s.id}:${s.why}`).join(',')}] mandatoryMissing=[${plan.mandatoryMissing.join(',')}]${plan.callbackRequested ? ' callback' : ''}`;
}
