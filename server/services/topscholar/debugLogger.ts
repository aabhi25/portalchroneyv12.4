/**
 * TopScholar Debug Logger — in-memory ring buffer of structured events
 * for every significant decision point in the TopScholar chat flow.
 *
 * Accessible via GET /api/topscholar/debug/events (admin only).
 * Process-local only; resets on restart. Max 200 events.
 */

export type DebugEventKind =
  | 'chat_request'     // A chat message arrived for TopScholar
  | 'token_check'      // Token present/absent, valid/invalid
  | 'scope_resolution' // cp_ids resolved (or not) for the student's scope
  | 'sync_attempt'     // Doubt-sync POST fired
  | 'sync_result'      // Result of doubt-sync POST
  | 'refusal';         // Chat refused (bad token / missing scope)

export interface TopScholarDebugEvent {
  id: string;                     // monotonic counter for ordering/dedup
  ts: string;                     // ISO timestamp
  kind: DebugEventKind;
  // Correlation fields so one chat turn's events can be grouped
  requestId?: string;
  studentId?: string;
  studentName?: string;
  doubtId?: string;
  // Per-kind payload (everything JSON-serialisable, secrets never included)
  data: Record<string, unknown>;
}

const MAX_EVENTS = 200;
let counter = 0;
const events: TopScholarDebugEvent[] = [];

export function logDebugEvent(
  kind: DebugEventKind,
  data: Record<string, unknown>,
  correlation?: {
    requestId?: string;
    studentId?: string;
    studentName?: string;
    doubtId?: string;
  },
): void {
  counter += 1;
  const event: TopScholarDebugEvent = {
    id: String(counter),
    ts: new Date().toISOString(),
    kind,
    requestId: correlation?.requestId,
    studentId: correlation?.studentId,
    studentName: correlation?.studentName,
    doubtId: correlation?.doubtId,
    data,
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/** Most-recent-first, up to `limit` events. */
export function getDebugEvents(limit = 100): TopScholarDebugEvent[] {
  const n = Math.max(1, Math.min(limit, MAX_EVENTS));
  return events.slice(-n).reverse();
}

export function clearDebugEvents(): void {
  events.length = 0;
}
