/**
 * Caps automatic replies to Instagram / Facebook comments, in memory (per pod), on top of
 * the lifetime per-post cap stored in settings (commentMaxRepliesPerPost, default 50):
 * - per commenter: at most `perCommenterPerHour` replies an hour (one person, or a bot,
 *   commenting over and over must not make us post a reply to each);
 * - per post: at most `perPostPerHour` replies an hour (a viral post or a comment flood
 *   must not burn the whole budget — and the AI bill — in minutes).
 * Only replies we are about to attempt are counted.
 */
export interface CommentLimiterOptions {
  perCommenterPerHour?: number;
  perPostPerHour?: number;
}

export type CommentLimitDecision = { allowed: true } | { allowed: false; reason: "commenter" | "post" };

const HOUR = 60 * 60_000;

export class CommentReplyLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  constructor(private readonly opts: CommentLimiterOptions = {}) {}

  private get perCommenter() { return this.opts.perCommenterPerHour ?? 5; }
  private get perPost() { return this.opts.perPostPerHour ?? 20; }

  check(
    platform: string,
    businessAccountId: string,
    commenterId: string,
    postId: string | undefined,
    now: number = Date.now(),
  ): CommentLimitDecision {
    this.sweep(now);
    const commenterKey = `${platform}:${businessAccountId}:u:${commenterId}`;
    const postKey = postId ? `${platform}:${businessAccountId}:p:${postId}` : null;
    const commenterHits = this.recent(commenterKey, now);
    if (commenterHits.length >= this.perCommenter) return { allowed: false, reason: "commenter" };
    const postHits = postKey ? this.recent(postKey, now) : [];
    if (postKey && postHits.length >= this.perPost) return { allowed: false, reason: "post" };
    commenterHits.push(now);
    this.hits.set(commenterKey, commenterHits);
    if (postKey) { postHits.push(now); this.hits.set(postKey, postHits); }
    return { allowed: true };
  }

  private recent(key: string, now: number): number[] {
    return (this.hits.get(key) || []).filter((t) => now - t < HOUR);
  }

  private sweep(now: number) {
    if (now - this.lastSweep < 10 * 60_000) return;
    this.lastSweep = now;
    this.hits.forEach((times, key) => {
      if (!times.some((t) => now - t < HOUR)) this.hits.delete(key);
    });
  }

  /** Test helper. */
  reset() { this.hits.clear(); }
}

export const commentReplyLimiter = new CommentReplyLimiter();
