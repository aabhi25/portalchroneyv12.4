/**
 * Decides the first message a WhatsApp customer gets after sending a document.
 *
 * Goal: name the document ("📄 Got your PAN Card — reading the details now…")
 * instead of a generic "Reading your document", without ever leaving the
 * customer in silence or naming the wrong document.
 *
 * Per customer (key = businessAccountId:senderPhone):
 * - Uploads arriving within `gatherMs` are one batch. A batch of 2+ gets
 *   "📄 Got N documents — reading them now…".
 * - A single upload to a step that accepts only one type is named right away
 *   (after `gatherMs`).
 * - Otherwise we wait for the AI classifier. Confident (≥ minConfidence) → the
 *   typed message; "not an accepted document" → no acknowledgement (the helpful
 *   rejection reply follows within seconds).
 * - If nothing is known after `fallbackMs`, the generic message goes out.
 * - onDone() cancels anything pending once the batch has been answered.
 */

export interface AckContext {
  businessAccountId: string;
  senderPhone: string;
  sessionId: string;
}

export interface AckDocInfo {
  label: string;                          // e.g. "PAN Card"
  side?: 'front' | 'back' | null;         // expected side of a two-sided card
  pages?: number;                          // PDF page count
  kind?: 'aadhaar' | 'pan' | 'bank_statement' | string;
  // true = the AI classifier confirmed this type; false = only what the step expects.
  verified?: boolean;
}

type Send = (ctx: AckContext, text: string) => Promise<void>;

interface State {
  ctx: AckContext;
  uploads: number;
  known: AckDocInfo | null;     // single-type step: known before classification
  classified: AckDocInfo | 'unknown' | null;
  gathered: boolean;
  sent: boolean;
  gatherTimer?: NodeJS.Timeout;
  fallbackTimer?: NodeJS.Timeout;
  lastActivity: number;
}

export const GENERIC_ACK = "📄 Got it! Reading your document now — this usually takes 10–20 seconds.";

export function typedAckText(doc: AckDocInfo): string {
  const kind = (doc.kind || '').toLowerCase().replace(/_card$/, '');
  const pages = doc.pages && doc.pages > 1 ? ` (${doc.pages} pages)` : '';
  if (!doc.verified) {
    // Not confirmed yet: say what we're checking for, not what we "got".
    if (kind === 'aadhaar' && doc.side) return `📄 Got it — checking the *${doc.side}* of your ${doc.label} now…`;
    return pages
      ? `📄 Got your PDF${pages} — checking your *${doc.label}* now…`
      : `📄 Got it — checking your *${doc.label}* now…`;
  }
  if (kind === 'aadhaar' && doc.side === 'back') return `📄 Got the *back* of your ${doc.label} — reading your address now…`;
  if (kind === 'aadhaar' && doc.side === 'front') return `📄 Got the *front* of your ${doc.label} — reading your name and number now…`;
  if (pages) return `📄 Got your *${doc.label}*${pages} — reading it now…`;
  return `📄 Got your *${doc.label}* — reading the details now…`;
}

export class UploadAckCoordinator {
  private readonly states = new Map<string, State>();

  constructor(
    private readonly send: Send,
    private readonly opts: { gatherMs?: number; fallbackMs?: number; ttlMs?: number; minConfidence?: number } = {},
  ) {}

  private get gatherMs() { return this.opts.gatherMs ?? 1500; }
  private get fallbackMs() { return this.opts.fallbackMs ?? 5000; }
  private get ttlMs() { return this.opts.ttlMs ?? 60_000; }
  private get minConfidence() { return this.opts.minConfidence ?? 0.8; }

  onUploadArrived(key: string, ctx: AckContext, known: AckDocInfo | null) {
    const now = Date.now();
    const existing = this.states.get(key);
    if (existing && !existing.sent && now - existing.lastActivity < this.ttlMs) {
      existing.uploads++;
      existing.lastActivity = now;
      return;
    }
    if (existing && existing.sent && now - existing.lastActivity < this.ttlMs) {
      // Already acknowledged this batch; late arrivals are covered by the progress updates.
      existing.uploads++;
      existing.lastActivity = now;
      return;
    }
    this.clear(key);
    const state: State = { ctx, uploads: 1, known, classified: null, gathered: false, sent: false, lastActivity: now };
    state.gatherTimer = setTimeout(() => this.afterGather(key, state), this.gatherMs);
    this.states.set(key, state);
  }

  /** Classifier result for the upload currently being read. doc=null → not an accepted document. */
  onClassified(key: string, doc: AckDocInfo | null, confidence: number) {
    const state = this.states.get(key);
    if (!state || state.sent || state.uploads > 1) return;
    state.lastActivity = Date.now();
    if (!doc) {
      state.classified = 'unknown';
    } else if (doc.verified === false) {
      // Extra facts about the expected document (e.g. PDF page count) — not a classification.
      state.known = { ...(state.known || doc), ...doc, verified: false };
      return;
    } else if (confidence >= this.minConfidence) {
      state.classified = { ...state.known, ...doc, side: doc.side ?? state.known?.side ?? null, verified: true };
    } else {
      return; // not confident: let the fallback decide
    }
    if (state.gathered) this.resolve(key, state);
  }

  onDone(key: string) {
    this.clear(key);
  }

  private afterGather(key: string, state: State) {
    if (this.states.get(key) !== state) return;
    state.gathered = true;
    if (state.uploads >= 2) return this.emit(key, state, `📄 Got ${state.uploads} documents — reading them now, this usually takes under a minute.`);
    if (state.classified) return this.resolve(key, state);
    if (state.known) return this.emit(key, state, typedAckText(state.known));
    const remaining = Math.max(0, this.fallbackMs - this.gatherMs);
    state.fallbackTimer = setTimeout(() => {
      if (this.states.get(key) === state && !state.sent) this.emit(key, state, GENERIC_ACK);
    }, remaining);
  }

  private resolve(key: string, state: State) {
    if (state.sent) return;
    if (state.classified === 'unknown') {
      state.sent = true; // stay quiet — the rejection reply is on its way
      if (state.fallbackTimer) clearTimeout(state.fallbackTimer);
      return;
    }
    if (state.classified) this.emit(key, state, typedAckText(state.classified));
  }

  private emit(key: string, state: State, text: string) {
    if (state.sent || this.states.get(key) !== state) return;
    state.sent = true;
    if (state.fallbackTimer) clearTimeout(state.fallbackTimer);
    this.send(state.ctx, text).catch(err => console.error('[WhatsApp Flow] Upload ack failed:', err));
  }

  private clear(key: string) {
    const s = this.states.get(key);
    if (s) {
      if (s.gatherTimer) clearTimeout(s.gatherTimer);
      if (s.fallbackTimer) clearTimeout(s.fallbackTimer);
    }
    this.states.delete(key);
  }
}
