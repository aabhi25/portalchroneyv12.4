/**
 * Terminal states for a TopScholar doubt session.
 *
 * On ToppScholars a student picks a subject + chapter and raises a doubt; that
 * doubt maps 1:1 to one AI chat session. Once the student answers the
 * "Did this resolve your doubt?" prompt the session has an outcome and the chat
 * is locked — no further messages, on this device or any other.
 *
 * The lock is derived from `conversations.doubt_retry_status` rather than from
 * `closed_at`, deliberately:
 *   - `closed_at` is also stamped by the 24h expiry sweep, which is NOT a
 *     student-driven outcome and must keep behaving as it does today (the
 *     student simply gets a fresh session).
 *   - the retry status is written synchronously inside the resolve/escalate
 *     handlers, while the close (and its mirror to the client platform) is
 *     deliberately allowed to lag. Deriving the lock from the status means the
 *     widget locks correctly even if the close is still in flight.
 *
 * Status values:
 *   NULL                  -> prompt never answered; session still open
 *   'attempted'           -> first "No" claimed the single retry; still open
 *   'resolved_first_pass' -> "Yes" without ever using the retry      [TERMINAL]
 *   'resolved'            -> "Yes" after the retry                   [TERMINAL]
 *   'escalated'           -> second "No"; ticket raised              [TERMINAL]
 *
 * NOTE: adding a value here means updating the resolution classification in
 * `analyticsService.ts` in the same change — it matches on exact values and an
 * unhandled one silently falls through to "pending".
 */

/** Written when the student confirms resolution without ever using the retry. */
export const DOUBT_RESOLVED_FIRST_PASS = 'resolved_first_pass';
/** Written when the student confirms resolution after the bot's one retry. */
export const DOUBT_RESOLVED_AFTER_RETRY = 'resolved';
/** Written when the retry was exhausted and a support ticket was raised. */
export const DOUBT_ESCALATED = 'escalated';
/** Written when the first "No" claims the single retry. Not terminal. */
export const DOUBT_RETRY_ATTEMPTED = 'attempted';

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  DOUBT_RESOLVED_FIRST_PASS,
  DOUBT_RESOLVED_AFTER_RETRY,
  DOUBT_ESCALATED,
]);

/**
 * What the widget shows when a session is locked. Collapses the two resolved
 * variants — the student saw "Yes" either way, so they get the same closing
 * message; the first-pass/after-retry split only matters for analytics.
 */
export type DoubtLockState = 'resolved' | 'escalated';

/** True when the student has answered the prompt and the chat must be locked. */
export function isTerminalDoubtStatus(retryStatus: string | null | undefined): boolean {
  return typeof retryStatus === 'string' && TERMINAL_STATUSES.has(retryStatus);
}

/** The lock state for a session, or null when it is still open. */
export function doubtLockStateFor(retryStatus: string | null | undefined): DoubtLockState | null {
  if (!isTerminalDoubtStatus(retryStatus)) return null;
  return retryStatus === DOUBT_ESCALATED ? 'escalated' : 'resolved';
}
