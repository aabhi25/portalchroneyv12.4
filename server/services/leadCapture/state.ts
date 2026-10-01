/**
 * Per-conversation contact-collection state, stored in conversations.lead_capture_state (jsonb).
 *
 * What it remembers per field: how often the assistant asked, the visitor message number it was
 * last asked at, explicit refusals ("no", "not now", "nahi", "mat poocho"…), asks the visitor
 * ignored, asks made after a mandatory field stopped blocking, and a "pending" flag for
 * keyword/intent fields that were triggered. Plus the answer to "is this number also on WhatsApp?".
 *
 * Turn bookkeeping is split into two pure steps so both can be re-applied inside one
 * SELECT … FOR UPDATE transaction (applyUserTurn is idempotent per visitor message number):
 *   applyUserTurn       — at the start of a turn: did the visitor refuse / ignore / answer the last ask?
 *   applyAssistantReply — at the end of a turn: which fields did the reply ask for?
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { assistantAskedFields, isAffirmative, isDecline } from './detectors';
import type { LeadFieldId, NormalizedLeadField } from './fields';

/** An optional field is asked at most this many times… */
export const OPTIONAL_MAX_ASKS = 2;
/** …and never again once the visitor declines it (refusals counted explicitly). */
export const OPTIONAL_DECLINES_TO_STOP = 1;
/** A mandatory field stops blocking answers after this many refusals (explicit or ignored asks)… */
export const MANDATORY_REFUSAL_CAP = 2;
/** …after which it is re-asked (after answering) at most this many more times… */
export const MANDATORY_ASKS_AFTER_CAP = 1;
/** …and no sooner than this many visitor messages after it was last asked. */
export const MIN_GAP_AFTER_CAP = 2;

export interface LeadFieldState {
  asked: number;
  lastAskedAt: number | null;
  declines: number;
  ignored: number;
  asksAfterCap: number;
  pending: boolean;
}

export interface LeadCaptureState {
  v: 1;
  fields: Partial<Record<LeadFieldId, LeadFieldState>>;
  /** What the latest assistant reply asked for (visitor message number `at`). */
  lastAsk: { fields: LeadFieldId[]; at: number; mode: 'block' | 'after_answer'; whatsappConfirm?: boolean; phoneKnown?: boolean } | null;
  /** Highest visitor message number already applied by applyUserTurn. */
  processedUserMsg: number;
  /** Whether the visitor declined in the latest processed message (for the prompt). */
  declinedNow?: LeadFieldId[];
  whatsapp?: { sameAsMobile?: boolean | null; number?: string | null };
}

export const emptyFieldState = (): LeadFieldState => ({ asked: 0, lastAskedAt: null, declines: 0, ignored: 0, asksAfterCap: 0, pending: false });
export const emptyLeadCaptureState = (): LeadCaptureState => ({ v: 1, fields: {}, lastAsk: null, processedUserMsg: 0 });

export function parseLeadCaptureState(raw: unknown): LeadCaptureState {
  let obj: any = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { obj = null; } }
  if (!obj || typeof obj !== 'object') return emptyLeadCaptureState();
  const fields: LeadCaptureState['fields'] = {};
  for (const [id, f] of Object.entries(obj.fields || {})) {
    const s: any = f || {};
    fields[id as LeadFieldId] = {
      asked: Number(s.asked) || 0,
      lastAskedAt: s.lastAskedAt == null ? null : Number(s.lastAskedAt),
      declines: Number(s.declines) || 0,
      ignored: Number(s.ignored) || 0,
      asksAfterCap: Number(s.asksAfterCap) || 0,
      pending: s.pending === true,
    };
  }
  return {
    v: 1,
    fields,
    lastAsk: obj.lastAsk && Array.isArray(obj.lastAsk.fields) ? obj.lastAsk : null,
    processedUserMsg: Number(obj.processedUserMsg) || 0,
    declinedNow: Array.isArray(obj.declinedNow) ? obj.declinedNow : undefined,
    whatsapp: obj.whatsapp && typeof obj.whatsapp === 'object' ? obj.whatsapp : undefined,
  };
}

const clone = (s: LeadCaptureState): LeadCaptureState => parseLeadCaptureState(JSON.parse(JSON.stringify(s)));

export function fieldState(s: LeadCaptureState, id: LeadFieldId): LeadFieldState {
  return s.fields[id] || emptyFieldState();
}

/**
 * Start of visitor message #n: account for the visitor's reaction to the previous ask.
 * `collected` = fields known now (saved lead + stated in chat). `keywordTriggered` = mandatory
 * keyword fields whose keyword appears in this message (they stay pending until given/declined).
 */
export function applyUserTurn(
  state: LeadCaptureState,
  turn: { n: number; userMessage: string; collected: Set<LeadFieldId>; keywordTriggered?: LeadFieldId[] },
): LeadCaptureState {
  if (state.processedUserMsg >= turn.n) return state;
  const s = clone(state);
  s.declinedNow = [];
  const ask = s.lastAsk;
  if (ask && ask.at === turn.n - 1) {
    const declined = isDecline(turn.userMessage);
    for (const id of ask.fields) {
      const fs = fieldState(s, id);
      if (id === 'whatsapp' && ask.whatsappConfirm) {
        s.whatsapp = s.whatsapp || {};
        if (isAffirmative(turn.userMessage)) { s.whatsapp.sameAsMobile = true; continue; }
        if (/^\s*(no|nope|nah|nahi|nahin|nhi|na)\b/i.test(turn.userMessage) && !/\b(share|give|tell|want)\b/i.test(turn.userMessage)) {
          s.whatsapp.sameAsMobile = false;
          continue;
        }
      }
      if (turn.collected.has(id)) {
        fs.pending = false;
        s.fields[id] = fs;
        continue;
      }
      // Asked for their WhatsApp number while no phone was known, and they gave one (it was
      // saved as the lead's phone): that number is their WhatsApp.
      if (id === 'whatsapp' && !ask.phoneKnown && turn.collected.has('mobile')) {
        s.whatsapp = s.whatsapp || {};
        s.whatsapp.sameAsMobile = true;
        continue;
      }
      if (declined) { fs.declines += 1; fs.pending = false; s.declinedNow!.push(id); }
      else fs.ignored += 1;
      s.fields[id] = fs;
    }
  }
  for (const id of turn.keywordTriggered || []) {
    if (turn.collected.has(id)) continue;
    const fs = fieldState(s, id);
    if (fs.declines === 0) { fs.pending = true; s.fields[id] = fs; }
  }
  s.processedUserMsg = turn.n;
  return s;
}

/** End of visitor message #n's turn: record which fields the assistant's reply asked for. */
export function applyAssistantReply(
  state: LeadCaptureState,
  turn: {
    n: number;
    replyText: string;
    fields: NormalizedLeadField[];
    collected: Set<LeadFieldId>;
    plannedId?: LeadFieldId | null;
    plannedMode?: 'block' | 'after_answer' | null;
    /** The field the resolver said to ask BEFORE answering this turn (deterministic, not an intent option). */
    blockAskId?: LeadFieldId | null;
    whatsappConfirm?: boolean;
    phoneKnown?: boolean;
  },
): LeadCaptureState {
  const s = clone(state);
  const byId = new Map(turn.fields.map(f => [f.id, f]));
  const asked = Array.from(assistantAskedFields(turn.replyText)).filter(id => {
    if (turn.collected.has(id) && !(id === 'whatsapp' && turn.whatsappConfirm)) return false;
    return byId.has(id) || (id === 'mobile' && byId.has('whatsapp'));
  }).map(id => (id === 'mobile' && !byId.has('mobile') ? 'whatsapp' as LeadFieldId : id));
  // A mandatory field the model was told to ask for before answering, with a reply that is a
  // question, counts as asked even when the phrasing isn't recognised — so refusals are still
  // capped instead of nagging forever.
  if (turn.blockAskId && !asked.includes(turn.blockAskId)
    && !turn.collected.has(turn.blockAskId) && /\?/.test(turn.replyText)) {
    asked.push(turn.blockAskId);
  }
  // "Is 98xxxx also your WhatsApp?" — confirmation asks are about the whatsapp field.
  const unique = Array.from(new Set(asked));
  if (unique.length === 0) {
    if (s.lastAsk && s.lastAsk.at < turn.n) s.lastAsk = null;
    return s;
  }
  for (const id of unique) {
    const f = byId.get(id);
    const fs = fieldState(s, id);
    if (f?.required && fs.declines + fs.ignored >= MANDATORY_REFUSAL_CAP) fs.asksAfterCap += 1;
    fs.asked += 1;
    fs.lastAskedAt = turn.n;
    if (f?.required && f.strategy === 'intent') fs.pending = true;
    s.fields[id] = fs;
  }
  const mode: 'block' | 'after_answer' = turn.plannedId && unique.includes(turn.plannedId) && turn.plannedMode ? turn.plannedMode : 'after_answer';
  s.lastAsk = {
    fields: unique,
    at: turn.n,
    mode,
    ...(turn.whatsappConfirm && unique.includes('whatsapp') ? { whatsappConfirm: true } : {}),
    phoneKnown: !!turn.phoneKnown,
  };
  return s;
}

/** Record a WhatsApp answer coming from capture_lead (number or "same as my mobile"). */
export function applyWhatsappCapture(state: LeadCaptureState, wa: { number?: string | null; sameAsMobile?: boolean | null }): LeadCaptureState {
  const s = clone(state);
  s.whatsapp = { ...(s.whatsapp || {}) };
  if (wa.number) s.whatsapp.number = wa.number;
  if (wa.sameAsMobile != null) s.whatsapp.sameAsMobile = wa.sameAsMobile;
  return s;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const persistable = (conversationId?: string | null): conversationId is string =>
  !!conversationId && !conversationId.startsWith('temp_');

export async function loadLeadCaptureState(conversationId: string | null | undefined): Promise<LeadCaptureState> {
  if (!persistable(conversationId)) return emptyLeadCaptureState();
  try {
    const res: any = await db.execute(sql`SELECT lead_capture_state FROM conversations WHERE id = ${conversationId}`);
    return parseLeadCaptureState(res.rows?.[0]?.lead_capture_state ?? null);
  } catch (err) {
    console.error('[LeadState] load failed (using empty state):', err);
    return emptyLeadCaptureState();
  }
}

/**
 * Atomic read-modify-write of one conversation's state: the row is locked (SELECT … FOR UPDATE)
 * for the duration of the mutation so concurrent turns/tool calls can't lose each other's updates.
 * Does not touch conversations.updated_at.
 */
export async function updateLeadCaptureState(
  conversationId: string | null | undefined,
  mutate: (s: LeadCaptureState) => LeadCaptureState,
): Promise<LeadCaptureState | null> {
  if (!persistable(conversationId)) return null;
  try {
    return await db.transaction(async (tx) => {
      const res: any = await tx.execute(sql`SELECT lead_capture_state FROM conversations WHERE id = ${conversationId} FOR UPDATE`);
      if (!res.rows || res.rows.length === 0) return null;
      const next = mutate(parseLeadCaptureState(res.rows[0].lead_capture_state ?? null));
      await tx.execute(sql`UPDATE conversations SET lead_capture_state = ${JSON.stringify(next)}::jsonb WHERE id = ${conversationId}`);
      return next;
    });
  } catch (err) {
    console.error('[LeadState] update failed:', err);
    return null;
  }
}
