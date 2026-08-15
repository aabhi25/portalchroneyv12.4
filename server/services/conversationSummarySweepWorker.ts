import { storage } from "../storage";
import { chatService } from "../chatService";

// Task #8 — Background sweep that (re)summarizes conversations once they end or
// go idle. This is the SINGLE summarizer: summaries are no longer produced
// mid-chat, so the stored summary + topic keywords always reflect the COMPLETE
// conversation and the change-gated LeadSquared push receives the final summary,
// while total AI summary cost stays strictly below the old per-cadence behavior
// (at most one summary call per quiet period instead of one every few messages).
//
// Triggers:
//   - Idle (reliable backstop): no new message for IDLE_HORIZON_MS. Catches every
//     conversation regardless of how the visitor leaves (tab close, navigate
//     away, walk off) — browsers do not reliably emit a "widget closed" event.
//   - Closed (best-effort bonus): conversations with closedAt set are eligible
//     immediately, summarizing a bit sooner when we do get an explicit close.
//
// Cost controls (see Task #8 plan — required, not optional):
//   - The lookup query only returns conversations whose summary is missing or
//     stale (summarizedAt NULL or older than updatedAt), so already-summarized
//     idle chats cost ZERO AI calls.
//   - A minimum-message bar (>= 3) keeps trivial 1-2 message bounces away from
//     the model.
//   - The summarizer uses gpt-4o-mini and the CRM push is change-gated, so an
//     unchanged summary triggers no redundant CRM update.
//   - Re-summarize on return: when a visitor comes back and adds messages,
//     updatedAt moves past summarizedAt, making the summary stale again, so the
//     next idle tick re-runs a full summary of the whole conversation.
//
// Cadence: ticks every 30s with a 1-minute idle horizon. Per-business OpenAI
// keys are resolved once per business per tick. Bounded batch + overlap guard.

const SWEEP_INTERVAL_MS = 30 * 1000;
const IDLE_HORIZON_MS = 60 * 1000; // 1 minute of inactivity
const MIN_MESSAGES = 3;
const BATCH_LIMIT = 100;
// Only summarize RECENTLY-active conversations. This bounds the sweep to chats
// that ended (or were updated) within the window, so shipping the feature does
// not trigger a mass one-time backfill of the entire historical conversations
// table. The window is generous enough to cover worker downtime across a deploy
// while still excluding long-dead conversations.
const MAX_ACTIVE_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// Failure backoff: a summary that fails to save (e.g. no/invalid OpenAI key, a
// transient API error) leaves the conversation stale, so it would otherwise be
// retried every single 30s tick — a hot loop that re-spends nothing useful and
// floods the logs. We back a failing conversation off exponentially instead.
const BASE_BACKOFF_MS = 5 * 60 * 1000;  // first retry after 5 minutes
const MAX_BACKOFF_MS = 60 * 60 * 1000;  // capped at 1 hour

// TopScholar doubt-sync: a doubt-scoped session has a hard 24h-from-creation
// lifetime (mirrors the reuse window in chatService/storage). Once elapsed the
// session can no longer be resumed, so the sweep closes it and releases the
// client-platform doubt. Bounded per tick to avoid a mass one-time backfill.
const DOUBT_LIFETIME_MS = 24 * 60 * 60 * 1000;
const DOUBT_CLOSE_BATCH_LIMIT = 100;

class ConversationSummarySweepWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;
  // conversationId -> { fails, nextAttempt(ms epoch) }. In-memory only; cleared
  // on success and pruned when a conversation stops being a candidate. A process
  // restart simply re-attempts, which is harmless.
  private backoff = new Map<string, { fails: number; nextAttempt: number }>();

  private recordFailure(conversationId: string, now: number) {
    const prev = this.backoff.get(conversationId);
    const fails = (prev?.fails ?? 0) + 1;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (fails - 1), MAX_BACKOFF_MS);
    this.backoff.set(conversationId, { fails, nextAttempt: now + delay });
  }

  start() {
    if (this.intervalId) return;
    // Run once shortly after startup, then on a fixed cadence.
    setTimeout(() => { void this.runOnce(); }, 30_000);
    this.intervalId = setInterval(() => { void this.runOnce(); }, SWEEP_INTERVAL_MS);
    console.log(`[ConversationSummarySweep] Started (interval=${SWEEP_INTERVAL_MS / 1000}s, idleHorizon=${IDLE_HORIZON_MS / 1000}s).`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // TopScholar doubt-sync: close doubts for conversations past their 24h lifetime.
  // Routes each through storage.closeConversation so the doubt-close mirror fires
  // uniformly with the explicit widget-close path. Bounded per tick.
  private async closeExpiredDoubts() {
    try {
      const createdBefore = new Date(Date.now() - DOUBT_LIFETIME_MS);
      const ids = await storage.listExpiredOpenDoubtConversations(createdBefore, DOUBT_CLOSE_BATCH_LIMIT);
      if (ids.length === 0) return;
      for (const id of ids) {
        try {
          await storage.closeConversation(id);
        } catch (err) {
          console.error(`[ConversationSummarySweep] Failed to close expired doubt conversation=${id}:`, err);
        }
      }
      console.log(`[ConversationSummarySweep] Closed ${ids.length} expired TopScholar doubt conversation(s).`);
    } catch (err) {
      console.error('[ConversationSummarySweep] closeExpiredDoubts failed:', err);
    }
  }

  private async runOnce() {
    if (this.running) return; // Skip if previous tick still in flight.
    this.running = true;
    try {
      // TopScholar doubt-sync: close doubts whose 24h session lifetime has elapsed.
      // Runs before summarization on the same cadence. Bounded + fully guarded to the
      // single TopScholar tenant (only its conversations ever carry a doubtId), so
      // this is a cheap no-op query for every other deployment. Best-effort — a
      // failure here must never stop the summary sweep below.
      await this.closeExpiredDoubts();

      const idleBefore = new Date(Date.now() - IDLE_HORIZON_MS);
      const activeSince = new Date(Date.now() - MAX_ACTIVE_AGE_MS);
      const candidates = await storage.listConversationsNeedingIdleSummary(
        idleBefore,
        MIN_MESSAGES,
        BATCH_LIMIT,
        activeSince,
      );
      // Drop backoff state for conversations that are no longer candidates
      // (summarized, deleted, or dropped below the message bar) to bound memory.
      const candidateIds = new Set(candidates.map((c) => c.id));
      for (const id of Array.from(this.backoff.keys())) {
        if (!candidateIds.has(id)) this.backoff.delete(id);
      }

      if (candidates.length === 0) return;

      const now = Date.now();
      // Resolve each business's OpenAI key at most once per tick.
      const keyCache = new Map<string, string | null>();
      let summarized = 0;
      let failures = 0;
      let skipped = 0;

      for (const row of candidates) {
        const businessAccountId = row.businessAccountId;
        if (!businessAccountId) continue; // Cannot scope a summary without a business.

        // Honor exponential backoff for conversations that recently failed.
        const back = this.backoff.get(row.id);
        if (back && now < back.nextAttempt) {
          skipped += 1;
          continue;
        }

        try {
          if (!keyCache.has(businessAccountId)) {
            const key = await storage.getBusinessAccountOpenAIKey(businessAccountId).catch(() => null);
            keyCache.set(businessAccountId, key);
          }
          const openaiApiKey = keyCache.get(businessAccountId) ?? null;
          const ok = await chatService.summarizeConversationOnIdle(row.id, businessAccountId, openaiApiKey);
          if (ok) {
            summarized += 1;
            this.backoff.delete(row.id);
          } else {
            // Stayed stale (no key / unsavable summary) — back off so we don't
            // retry it every tick.
            failures += 1;
            this.recordFailure(row.id, now);
          }
        } catch (err) {
          failures += 1;
          this.recordFailure(row.id, now);
          console.error(`[ConversationSummarySweep] Summarize failed for conversation=${row.id}:`, err);
        }
      }

      if (summarized > 0 || failures > 0) {
        console.log(
          `[ConversationSummarySweep] Summarized ${summarized} conversation(s) ` +
          `(failures=${failures}, skipped=${skipped}, batch=${candidates.length}).`
        );
      }
    } catch (err) {
      console.error('[ConversationSummarySweep] Tick failed:', err);
    } finally {
      this.running = false;
    }
  }
}

export const conversationSummarySweepWorker = new ConversationSummarySweepWorker();
