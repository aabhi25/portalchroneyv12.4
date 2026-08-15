import { storage } from "../storage";

// Task #18 — Background sweep that hard-deletes widget conversations that were
// flagged as `awaitingVerification = true` (because the business opted into
// the "only count after OTP verify" toggle) but never completed verification.
//
// Per the product decision recorded on Task #18, abandoned conversations are
// dropped ENTIRELY — the conversation row, its messages (via ON DELETE CASCADE
// on `messages.conversation_id`), any partial leads attached to it, and the
// OTP challenge rows scoped to it — so analytics never count them and CRM
// never sees them (the existing OTP gate from Task #14 already guarantees no
// CRM sync for unverified phones, so there's nothing to roll back upstream).
//
// Horizon: 30 minutes past the conversation's `updatedAt`. This gives the
// visitor a wide buffer to complete OTP (which is gated at 5-minute expiry +
// MAX_RESENDS) without the sweep racing live sessions. Cadence: every 5 min.

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const STALE_HORIZON_MS = 30 * 60 * 1000;
const BATCH_LIMIT = 200;

class AwaitingVerificationSweepWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;

  start() {
    if (this.intervalId) return;
    // Run once shortly after startup, then on a fixed cadence.
    setTimeout(() => { void this.runOnce(); }, 30_000);
    this.intervalId = setInterval(() => { void this.runOnce(); }, SWEEP_INTERVAL_MS);
    console.log(`[AwaitingVerificationSweep] Started (interval=${SWEEP_INTERVAL_MS / 1000}s, horizon=${STALE_HORIZON_MS / 60000}m).`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async runOnce() {
    if (this.running) return; // Skip if previous tick still in flight.
    this.running = true;
    try {
      const horizon = new Date(Date.now() - STALE_HORIZON_MS);
      const stale = await storage.listStaleAwaitingVerificationConversations(horizon, BATCH_LIMIT);
      if (stale.length === 0) return;

      let totalConv = 0;
      let totalLeads = 0;
      let totalOtp = 0;
      let failures = 0;

      for (const row of stale) {
        try {
          const counts = await storage.hardDeletePendingVerificationConversation(row.id);
          totalConv += counts.conversation;
          totalLeads += counts.leads;
          totalOtp += counts.otpChallenges;
        } catch (err) {
          failures += 1;
          console.error(`[AwaitingVerificationSweep] Delete failed for conversation=${row.id}:`, err);
        }
      }

      console.log(
        `[AwaitingVerificationSweep] Swept ${totalConv} unverified conversations ` +
        `(leads=${totalLeads}, otp_rows=${totalOtp}, failures=${failures}, batch=${stale.length}).`
      );
    } catch (err) {
      console.error('[AwaitingVerificationSweep] Tick failed:', err);
    } finally {
      this.running = false;
    }
  }
}

export const awaitingVerificationSweepWorker = new AwaitingVerificationSweepWorker();
