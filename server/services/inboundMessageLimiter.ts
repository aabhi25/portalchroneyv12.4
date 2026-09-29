/**
 * Protects the WhatsApp agent (and the OpenAI bill) from spammers and from other
 * bots. Each incoming text costs several AI calls; two bots replying to each other
 * would loop forever.
 *
 * Per customer (key = businessAccountId:senderPhone), in memory:
 * - more than `perMinute` texts in a minute, or `perHour` in an hour → paused;
 * - the same text `repeatLimit` times within `repeatWindowMs` (typical of an
 *   auto-responder answering our replies) → paused.
 * While paused, messages get no AI processing. The first blocked message returns
 * `notify: true` so the caller can send one short notice.
 */

export interface LimiterOptions {
  perMinute?: number;
  perHour?: number;
  repeatLimit?: number;
  repeatWindowMs?: number;
  pauseMs?: number;
  loopPauseMs?: number;
}

export type LimitDecision =
  | { allowed: true }
  | { allowed: false; reason: 'rate' | 'loop'; notify: boolean; until: number };

interface SenderState {
  times: number[];                                // arrival times within the last hour
  recent: { text: string; at: number }[];         // normalised texts within the repeat window
  pausedUntil: number;
  pauseReason: 'rate' | 'loop' | null;
  notified: boolean;
  lastSeen: number;
}

export class InboundMessageLimiter {
  private readonly senders = new Map<string, SenderState>();
  private lastSweep = Date.now();

  constructor(private readonly opts: LimiterOptions = {}) {}

  private get perMinute() { return this.opts.perMinute ?? 12; }
  private get perHour() { return this.opts.perHour ?? 120; }
  private get repeatLimit() { return this.opts.repeatLimit ?? 5; }
  private get repeatWindowMs() { return this.opts.repeatWindowMs ?? 10 * 60_000; }
  private get pauseMs() { return this.opts.pauseMs ?? 15 * 60_000; }
  private get loopPauseMs() { return this.opts.loopPauseMs ?? 30 * 60_000; }

  check(key: string, text: string, now: number = Date.now()): LimitDecision {
    this.sweep(now);
    let s = this.senders.get(key);
    if (!s) {
      s = { times: [], recent: [], pausedUntil: 0, pauseReason: null, notified: false, lastSeen: now };
      this.senders.set(key, s);
    }
    s.lastSeen = now;

    if (s.pausedUntil > now) {
      const notify = !s.notified;
      s.notified = true;
      return { allowed: false, reason: s.pauseReason || 'rate', notify, until: s.pausedUntil };
    }

    s.times = s.times.filter(t => now - t < 60 * 60_000);
    s.times.push(now);
    const lastMinute = s.times.filter(t => now - t < 60_000).length;

    const normalised = (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
    s.recent = s.recent.filter(r => now - r.at < this.repeatWindowMs);
    // Very short replies ("ok", "yes", "1") legitimately repeat; only longer texts count as a loop.
    if (normalised.length >= 12) s.recent.push({ text: normalised, at: now });
    const repeats = normalised.length >= 12 ? s.recent.filter(r => r.text === normalised).length : 0;

    if (repeats >= this.repeatLimit) return this.pause(s, 'loop', now + this.loopPauseMs);
    if (lastMinute > this.perMinute || s.times.length > this.perHour) return this.pause(s, 'rate', now + this.pauseMs);
    return { allowed: true };
  }

  private pause(s: SenderState, reason: 'rate' | 'loop', until: number): LimitDecision {
    s.pausedUntil = until;
    s.pauseReason = reason;
    s.notified = true;
    s.times = [];
    s.recent = [];
    // A bot would answer our notice with another message, so only humans hitting the rate limit get one.
    return { allowed: false, reason, notify: reason === 'rate', until };
  }

  private sweep(now: number) {
    if (now - this.lastSweep < 10 * 60_000) return;
    this.lastSweep = now;
    this.senders.forEach((s, key) => {
      if (s.pausedUntil < now && now - s.lastSeen > 60 * 60_000) this.senders.delete(key);
    });
  }
}

export const inboundMessageLimiter = new InboundMessageLimiter();

// Reply for message types the agent can't read. null = no reply (e.g. an emoji reaction).
export function unsupportedMessageNotice(contentType: string | undefined, inForm: boolean): string | null {
  const type = (contentType || '').toLowerCase();
  if (type === 'reaction' || type === 'unsupported_reaction' || type === 'system' || type === 'ephemeral') return null;
  const next = inForm ? " Please type your answer to continue." : " Please type your message instead.";
  if (type === 'audio' || type === 'voice' || type === 'ptt') return `Sorry, I can't listen to voice messages yet.${next}`;
  if (type === 'location') return `Thanks for sharing your location! I can't read locations yet.${next}`;
  if (type === 'video') return `Sorry, I can't watch videos. You can send photos or PDF documents, or type your message.`;
  if (type === 'sticker') return inForm ? `Please type your answer to continue.` : `😊 How can I help you? Please type your message.`;
  if (type === 'contacts' || type === 'contact') return `Sorry, I can't open shared contacts.${next}`;
  return `Sorry, I can only read text messages, photos and PDF documents.${next}`;
}
