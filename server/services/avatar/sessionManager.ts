/**
 * Live AI avatar session lifecycle, gating and metering.
 *
 * A session starts ONLY when a visitor taps the avatar button
 * (POST /api/chat/widget/avatar/session). Gates, in order: account active,
 * avatar enabled, voice mode on, parental consent (children's accounts),
 * provider + avatar id configured, an API key resolved (own key, else the
 * platform key when allowed), AI budget not blocked, monthly minute cap not
 * reached, concurrent sessions under the limit.
 *
 * It ends on: visitor close / switch to text, idle (no speech or answer for N s),
 * max session length, monthly cap (the current answer finishes first), lost
 * heartbeat, voice socket closed, provider drop, server shutdown. Every end
 * writes billed seconds + an estimated cost to avatar_sessions and logs an
 * 'avatar' event in ai_usage_events, so avatar spend shows up in Usage & Limits
 * and counts toward the account's monthly AI limit.
 *
 * Single-instance deployment (pm2 fork, 1 instance): the in-memory map is the
 * authority for live sessions; rows left open by a crash are closed at boot.
 */
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { avatarSessions } from "@shared/schema";
import { storage } from "../../storage";
import { aiBudgetService, istMonthKey, istMonthRange } from "../aiBudgetService";
import { aiUsageLogger } from "../aiUsageLogger";
import { getRates, resolveApiKey } from "./credentials";
import { getAvatarProvider } from "./registry";
import {
  DEFAULT_DISPLAY_NAME,
  disclosureFor,
  getEffectiveSettings,
  isChildrensAccount,
  isProviderSelectable,
} from "./settingsService";
import {
  AvatarProviderError,
  type AudioRoute,
  type AvatarEndReason,
  type AvatarProviderId,
  type ClientConnectionInfo,
  type ProviderEvent,
  type ProviderSession,
} from "./types";

export type AvatarGateCode =
  | "not_found"
  | "avatar_disabled"
  | "consent_required"
  | "provider_not_configured"
  | "no_api_key"
  | "ai_blocked"
  | "monthly_cap_reached"
  | "concurrency_limit"
  | "provider_error"
  | "rate_limited"
  | "forbidden";

export class AvatarGateError extends Error {
  constructor(public readonly code: AvatarGateCode, public readonly status: number, message: string) {
    super(message);
  }
}

/** Message shown to the visitor when the avatar can't start (voice/text continue). */
export const VISITOR_FALLBACK_MESSAGES: Partial<Record<AvatarGateCode, string>> = {
  monthly_cap_reached: "The video assistant isn't available right now — let's continue by voice.",
  concurrency_limit: "The video assistant is busy right now — let's continue by voice.",
  provider_error: "The video assistant couldn't start — let's continue by voice.",
  rate_limited: "Please wait a moment before starting the video assistant again.",
};

export interface VoiceBinding {
  conversationId: string;
  /** Send a JSON message to the visitor's voice socket. */
  notify(message: Record<string, unknown>): void;
  /** An answer is still being generated or played. */
  isAnswerActive(): boolean;
  /** The avatar session ended (for any reason); voice falls back to local playback. */
  onEnded(reason: AvatarEndReason): void;
}

interface LiveSession {
  /** Why the visitor's browser could not connect/keep the video (shown to super admins). */
  clientError?: string | null;
  id: string;
  businessAccountId: string;
  visitorId: string;
  conversationId: string | null;
  provider: AvatarProviderId;
  audioRoute: AudioRoute;
  handle: ProviderSession;
  apiKeySource: "business" | "platform";
  startedAtMs: number;
  connectedAtMs: number | null;
  lastHeartbeatMs: number;
  lastActivityMs: number;
  maxSessionMs: number;
  idleTimeoutMs: number;
  capSeconds: number;
  connectTimeoutMs: number;
  ratePerMinUsd: number;
  disclosure: string | null;
  displayName: string;
  voice: VoiceBinding | null;
  endAfterAnswer: { reason: AvatarEndReason; deadlineMs: number } | null;
  ending: Promise<void> | null;
  timings: Record<string, number>;
  firstAudioMs: number | null;
}

export interface StartSessionResult {
  sessionId: string;
  provider: AvatarProviderId;
  audioRoute: AudioRoute;
  connection: ClientConnectionInfo;
  displayName: string;
  styleHint: string;
  disclosure: string | null;
  limits: { maxSessionSeconds: number; idleTimeoutSeconds: number; heartbeatIntervalSeconds: number };
  connectTimeoutMs: number;
}

export const HEARTBEAT_INTERVAL_SECONDS = 20;
const HEARTBEAT_TIMEOUT_MS = 75_000;
/** Grace after connectTimeoutMs before the server gives up on a never-connected session. */
const CONNECT_GRACE_MS = 20_000;
/** "Finish the current answer, then end" — but never longer than this. */
const END_AFTER_ANSWER_MAX_MS = 60_000;
const PROVIDER_CREATE_TIMEOUT_MS = 15_000;
const PROVIDER_CLOSE_TIMEOUT_MS = 5_000;
/** Our call ends this long before a provider-imposed limit, so the answer can finish first. */
const PROVIDER_END_MARGIN_SECONDS = 15;
const TICK_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(onTimeout()), ms); timer.unref?.(); }),
  ]);
}

export class AvatarSessionManager {
  private readonly live = new Map<string, LiveSession>();
  /** Ended seconds this IST month per business (loaded on demand, incremented on end). */
  private readonly endedThisMonth = new Map<string, { month: string; seconds: number }>();
  private readonly businessLocks = new Map<string, Promise<unknown>>();
  private timer: NodeJS.Timeout | null = null;
  private now: () => number = () => Date.now();

  /** Test seam. */
  setClockForTesting(now: (() => number) | null): void {
    this.now = now || (() => Date.now());
  }

  liveCount(businessAccountId?: string): number {
    if (!businessAccountId) return this.live.size;
    let n = 0;
    this.live.forEach((s) => { if (s.businessAccountId === businessAccountId) n++; });
    return n;
  }

  isLive(sessionId: string): boolean {
    return this.live.has(sessionId);
  }

  liveSessionIds(businessAccountId: string): string[] {
    const ids: string[] = [];
    this.live.forEach((s, id) => { if (s.businessAccountId === businessAccountId) ids.push(id); });
    return ids;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async withBusinessLock<T>(businessAccountId: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.businessLocks.get(businessAccountId) ?? Promise.resolve();
    const run = prior.catch(() => undefined).then(fn);
    this.businessLocks.set(businessAccountId, run);
    try {
      return await run;
    } finally {
      if (this.businessLocks.get(businessAccountId) === run) this.businessLocks.delete(businessAccountId);
    }
  }

  private async loadEndedSeconds(businessAccountId: string, month = istMonthKey(this.now())): Promise<number> {
    const cached = this.endedThisMonth.get(businessAccountId);
    if (cached && cached.month === month) return cached.seconds;
    const { start, end } = istMonthRange(month);
    const [row] = await db.select({ seconds: sql<number>`coalesce(sum(${avatarSessions.billedSeconds}), 0)::int` })
      .from(avatarSessions)
      .where(and(
        eq(avatarSessions.businessAccountId, businessAccountId),
        gte(avatarSessions.startedAt, start),
        lt(avatarSessions.startedAt, end),
        sql`${avatarSessions.endedAt} is not null`,
      ));
    const seconds = Number(row?.seconds) || 0;
    this.endedThisMonth.set(businessAccountId, { month, seconds });
    return seconds;
  }

  private liveElapsedSeconds(businessAccountId: string): number {
    const now = this.now();
    let total = 0;
    this.live.forEach((s) => { if (s.businessAccountId === businessAccountId) total += Math.max(0, (now - s.startedAtMs) / 1000); });
    return total;
  }

  /** Seconds used this IST month (ended sessions + live sessions so far). */
  async monthUsedSeconds(businessAccountId: string): Promise<number> {
    return (await this.loadEndedSeconds(businessAccountId)) + this.liveElapsedSeconds(businessAccountId);
  }

  /** Per-account month summary for admin screens. */
  async monthUsage(businessAccountId: string, month = istMonthKey(this.now())): Promise<{ month: string; seconds: number; minutes: number; sessions: number; liveSessions: number; costUsd: number }> {
    const { start, end } = istMonthRange(month);
    const [row] = await db.select({
      seconds: sql<number>`coalesce(sum(${avatarSessions.billedSeconds}), 0)::int`,
      sessions: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${avatarSessions.costUsd}), 0)::float8`,
    }).from(avatarSessions).where(and(
      eq(avatarSessions.businessAccountId, businessAccountId),
      gte(avatarSessions.startedAt, start),
      lt(avatarSessions.startedAt, end),
    ));
    const liveSeconds = month === istMonthKey(this.now()) ? this.liveElapsedSeconds(businessAccountId) : 0;
    const seconds = (Number(row?.seconds) || 0) + Math.round(liveSeconds);
    return {
      month,
      seconds,
      minutes: Math.round((seconds / 60) * 10) / 10,
      sessions: Number(row?.sessions) || 0,
      liveSessions: this.liveCount(businessAccountId),
      costUsd: Number(row?.cost) || 0,
    };
  }

  // ── start ──────────────────────────────────────────────────────────────────

  async startSession(input: { businessAccountId: string; visitorId: string; conversationId?: string | null }): Promise<StartSessionResult> {
    const { businessAccountId, visitorId } = input;
    const account = await storage.getBusinessAccount(businessAccountId);
    if (!account) throw new AvatarGateError("not_found", 404, "Business account not found");
    if (account.status === "suspended") throw new AvatarGateError("avatar_disabled", 403, "This assistant is unavailable");
    const settings = await getEffectiveSettings(businessAccountId, account);
    if (!settings.enabled) throw new AvatarGateError("avatar_disabled", 403, "The AI avatar is not enabled for this account");
    if (account.voiceModeEnabled !== "true") throw new AvatarGateError("avatar_disabled", 403, "Voice mode is not enabled for this account");
    if (isChildrensAccount(account) && !settings.parentalConsentConfirmed) {
      throw new AvatarGateError("consent_required", 403, "Parental consent has not been confirmed for this account");
    }
    if (!isProviderSelectable(settings.provider)) throw new AvatarGateError("provider_not_configured", 503, "Avatar provider is not available");
    const provider = settings.provider as AvatarProviderId;
    if (provider !== "fake" && !settings.avatarId) throw new AvatarGateError("provider_not_configured", 503, "No avatar has been chosen for this account");
    const key = await resolveApiKey(provider, settings);
    if (!key.apiKey || !key.source) throw new AvatarGateError("no_api_key", 503, `No API key for ${provider}`);
    if (await aiBudgetService.isBlockedAsync(businessAccountId)) throw new AvatarGateError("ai_blocked", 403, "AI is paused for this account");

    const capSeconds = settings.monthlyMinuteCap * 60;
    const adapter = getAvatarProvider(provider);
    const rates = await getRates();

    // Reserve a slot (cap + concurrency) atomically per business, then create the
    // provider session outside the lock.
    const reserved = await this.withBusinessLock(businessAccountId, async () => {
      const used = await this.monthUsedSeconds(businessAccountId);
      const remaining = capSeconds - used;
      if (remaining < 30) throw new AvatarGateError("monthly_cap_reached", 429, "Monthly avatar minutes are used up");
      const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(avatarSessions)
        .where(and(eq(avatarSessions.businessAccountId, businessAccountId), isNull(avatarSessions.endedAt)));
      if ((Number(open?.n) || 0) >= settings.maxConcurrentSessions) {
        throw new AvatarGateError("concurrency_limit", 429, "Too many avatar sessions are running for this account");
      }
      const startedAt = new Date(this.now());
      const [row] = await db.insert(avatarSessions).values({
        businessAccountId,
        conversationId: input.conversationId || null,
        visitorId: visitorId.slice(0, 255),
        provider,
        status: "starting",
        startedAt,
        lastHeartbeatAt: startedAt,
        metadata: { keySource: key.source },
      }).returning({ id: avatarSessions.id });
      return { id: row.id as string, startedAtMs: startedAt.getTime(), remaining };
    });

    let maxSessionSeconds = Math.max(30, Math.min(settings.maxSessionMinutes * 60, Math.floor(reserved.remaining)));
    const t0 = this.now();
    let handle: ProviderSession;
    try {
      handle = await withTimeout(
        adapter.createSession({
          apiKey: key.apiKey,
          avatarId: settings.avatarId || "fake-avatar",
          providerOptions: settings.providerOptions || {},
          // Provider-side cap = our cap + a minute of grace (our watchdog ends first).
          maxSessionSeconds: maxSessionSeconds + 60,
          sessionLabel: reserved.id,
        }),
        PROVIDER_CREATE_TIMEOUT_MS,
        () => new AvatarProviderError("timeout", `provider session not created within ${PROVIDER_CREATE_TIMEOUT_MS}ms`),
      );
    } catch (error) {
      const err = error instanceof AvatarProviderError ? error : new AvatarProviderError("protocol", (error as Error)?.message || String(error));
      // Never log the key; provider messages are trimmed by mapHttpError.
      console.warn(`[Avatar] ${provider} session creation failed for ${businessAccountId}: ${err.code} ${err.message}`);
      await db.update(avatarSessions).set({
        status: "ended",
        endedAt: new Date(this.now()),
        endReason: "provider_error",
        billedSeconds: 0,
        metadata: { keySource: key.source, errorCode: err.code, error: err.message.slice(0, 200) },
      }).where(eq(avatarSessions.id, reserved.id));
      throw new AvatarGateError("provider_error", 502, `Avatar provider error (${err.code})`);
    }

    const now = this.now();
    // The provider's plan may allow shorter calls than our setting: end ours a little before
    // theirs so the current answer finishes and the visitor drops back to text/voice cleanly.
    const providerMax = handle.providerMaxSessionSeconds;
    if (providerMax && providerMax - PROVIDER_END_MARGIN_SECONDS < maxSessionSeconds) {
      maxSessionSeconds = Math.max(15, providerMax - PROVIDER_END_MARGIN_SECONDS);
      console.warn(`[Avatar] ${provider} plan limits calls to ${providerMax}s — this call ends after ${maxSessionSeconds}s`);
    }
    const disclosure = disclosureFor(settings, account.name);
    const live: LiveSession = {
      id: reserved.id,
      businessAccountId,
      visitorId,
      conversationId: input.conversationId || null,
      provider,
      audioRoute: handle.audioRoute,
      handle,
      apiKeySource: key.source,
      startedAtMs: reserved.startedAtMs,
      connectedAtMs: null,
      lastHeartbeatMs: now,
      lastActivityMs: now,
      maxSessionMs: maxSessionSeconds * 1000,
      idleTimeoutMs: settings.idleTimeoutSeconds * 1000,
      capSeconds,
      connectTimeoutMs: adapter.connectTimeoutMs,
      ratePerMinUsd: rates[provider] ?? 0,
      disclosure,
      displayName: settings.displayName?.trim() || DEFAULT_DISPLAY_NAME,
      voice: null,
      endAfterAnswer: null,
      ending: null,
      timings: { providerCreateMs: now - t0 },
      firstAudioMs: null,
    };
    this.live.set(live.id, live);
    handle.onEvent((event) => this.handleProviderEvent(live, event));
    if (handle.providerSessionId) {
      await db.update(avatarSessions).set({ providerSessionId: handle.providerSessionId }).where(eq(avatarSessions.id, live.id));
    }
    this.start();
    console.log(`[AvatarTiming] session ${live.id} ${provider} created in ${now - t0}ms (key=${key.source}, route=${handle.audioRoute})`);

    return {
      sessionId: live.id,
      provider,
      audioRoute: handle.audioRoute,
      connection: handle.client,
      displayName: live.displayName,
      styleHint: settings.styleHint,
      disclosure,
      limits: { maxSessionSeconds, idleTimeoutSeconds: settings.idleTimeoutSeconds, heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS },
      connectTimeoutMs: adapter.connectTimeoutMs,
    };
  }

  // ── client-facing lifecycle ────────────────────────────────────────────────

  private authorize(sessionId: string, auth: { businessAccountId: string; visitorId: string }): LiveSession | null {
    const live = this.live.get(sessionId);
    if (!live) return null;
    if (live.businessAccountId !== auth.businessAccountId || live.visitorId !== auth.visitorId) {
      throw new AvatarGateError("forbidden", 403, "Not your avatar session");
    }
    return live;
  }

  async markConnected(sessionId: string, auth: { businessAccountId: string; visitorId: string }, info: { providerSessionId?: string | null; firstFrameMs?: number | null }): Promise<boolean> {
    const live = this.authorize(sessionId, auth);
    if (!live) return false;
    const now = this.now();
    if (!live.connectedAtMs) {
      live.connectedAtMs = now;
      live.lastActivityMs = now;
      live.timings.connectMs = now - live.startedAtMs;
      if (typeof info.firstFrameMs === "number" && info.firstFrameMs >= 0 && info.firstFrameMs < 120_000) live.timings.clientFirstFrameMs = Math.round(info.firstFrameMs);
      console.log(`[AvatarTiming] session ${live.id} first frame +${live.timings.connectMs}ms after start (client ${live.timings.clientFirstFrameMs ?? "?"}ms after tap)`);
    }
    if (info.providerSessionId && live.handle.setProviderSessionId && !live.handle.providerSessionId) {
      live.handle.setProviderSessionId(info.providerSessionId);
    }
    await db.update(avatarSessions).set({
      status: "active",
      connectedAt: new Date(live.connectedAtMs),
      ...(live.handle.providerSessionId ? { providerSessionId: live.handle.providerSessionId } : {}),
    }).where(eq(avatarSessions.id, live.id));
    return true;
  }

  async heartbeat(sessionId: string, auth: { businessAccountId: string; visitorId: string }): Promise<{ active: boolean; endReason?: string | null; remainingSeconds?: number }> {
    const live = this.authorize(sessionId, auth);
    if (!live) {
      const [row] = await db.select({ endReason: avatarSessions.endReason, businessAccountId: avatarSessions.businessAccountId })
        .from(avatarSessions).where(eq(avatarSessions.id, sessionId)).limit(1);
      return { active: false, endReason: row && row.businessAccountId === auth.businessAccountId ? row.endReason : null };
    }
    const now = this.now();
    live.lastHeartbeatMs = now;
    await db.update(avatarSessions).set({ lastHeartbeatAt: new Date(now) }).where(eq(avatarSessions.id, live.id));
    const remaining = Math.max(0, Math.round((live.maxSessionMs - (now - live.startedAtMs)) / 1000));
    return { active: true, remainingSeconds: remaining };
  }

  async endFromClient(sessionId: string, auth: { businessAccountId: string; visitorId: string }, reason: AvatarEndReason, detail?: unknown): Promise<boolean> {
    const live = this.authorize(sessionId, auth);
    if (!live) return false;
    if (typeof detail === "string" && detail.trim()) {
      // Visitor-supplied text: strip control characters and cap it; it is only ever shown to super admins.
      live.clientError = `Browser: ${detail.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)}`;
    }
    await this.endSession(sessionId, reason);
    return true;
  }

  // ── voice bridge (used by realtimeVoiceService) ─────────────────────────────

  bindVoice(sessionId: string, auth: { businessAccountId: string; visitorId: string }, binding: VoiceBinding): { audioRoute: AudioRoute; provider: AvatarProviderId; disclosure: string | null; displayName: string } | null {
    const live = this.live.get(sessionId);
    if (!live || live.businessAccountId !== auth.businessAccountId || live.visitorId !== auth.visitorId) return null;
    live.voice = binding;
    live.lastActivityMs = this.now();
    if (live.conversationId !== binding.conversationId) {
      live.conversationId = binding.conversationId;
      void db.update(avatarSessions).set({ conversationId: binding.conversationId }).where(eq(avatarSessions.id, live.id)).catch(() => undefined);
    }
    return { audioRoute: live.audioRoute, provider: live.provider, disclosure: live.disclosure, displayName: live.displayName };
  }

  unbindVoice(sessionId: string, conversationId?: string): void {
    const live = this.live.get(sessionId);
    if (live?.voice && (!conversationId || live.voice.conversationId === conversationId)) live.voice = null;
  }

  /** Server route: forward TTS PCM (24 kHz). False = the avatar can't take it (play locally instead). */
  sendAudio(sessionId: string, pcm: Buffer): boolean {
    const live = this.live.get(sessionId);
    if (!live || live.ending || !live.handle.sendAudio) return false;
    const ok = live.handle.sendAudio(pcm);
    if (ok) {
      const now = this.now();
      live.lastActivityMs = now;
      if (!live.firstAudioMs) {
        live.firstAudioMs = now;
        live.timings.firstAudioMs = now - live.startedAtMs;
      }
    }
    return ok;
  }

  endOfSpeech(sessionId: string): void {
    this.live.get(sessionId)?.handle.endOfSpeech?.();
  }

  interrupt(sessionId: string): void {
    const live = this.live.get(sessionId);
    if (!live || live.ending) return;
    live.handle.interrupt?.();
  }

  touch(sessionId: string): void {
    const live = this.live.get(sessionId);
    if (live) live.lastActivityMs = this.now();
  }

  /** The visitor finished hearing an answer: a pending "end after answer" can run now. */
  answerFinished(sessionId: string): void {
    const live = this.live.get(sessionId);
    if (live?.endAfterAnswer && !live.ending) void this.endSession(live.id, live.endAfterAnswer.reason);
  }

  private handleProviderEvent(live: LiveSession, event: ProviderEvent): void {
    if (live.ending) return;
    switch (event.type) {
      case "connected":
        live.timings.providerConnectedMs = this.now() - live.startedAtMs;
        break;
      case "speak_started":
        if (!live.timings.firstSpeechMs) {
          live.timings.firstSpeechMs = this.now() - live.startedAtMs;
          console.log(`[AvatarTiming] session ${live.id} first avatar speech +${live.timings.firstSpeechMs}ms after start`);
        }
        live.voice?.notify({ type: "avatar_event", event: "speak_started" });
        break;
      case "speak_ended":
        live.voice?.notify({ type: "avatar_event", event: "speak_ended" });
        break;
      case "interrupted":
        live.voice?.notify({ type: "avatar_event", event: "interrupted" });
        break;
      case "warning":
        console.warn(`[Avatar] ${live.provider} warning (session ${live.id}): ${event.message}`);
        break;
      case "error":
        console.warn(`[Avatar] ${live.provider} error (session ${live.id}): ${event.code} ${event.message}`);
        if (event.fatal) void this.endSession(live.id, "provider_error");
        break;
      case "disconnected":
        console.warn(`[Avatar] ${live.provider} disconnected (session ${live.id}): ${event.reason}`);
        void this.endSession(live.id, "provider_disconnected");
        break;
    }
  }

  // ── ending ─────────────────────────────────────────────────────────────────

  async endSession(sessionId: string, reason: AvatarEndReason): Promise<void> {
    const live = this.live.get(sessionId);
    if (!live) {
      // Not live in this process (already ended, or an orphan): close the row if still open.
      await db.update(avatarSessions).set({ status: "ended", endedAt: new Date(this.now()), endReason: reason })
        .where(and(eq(avatarSessions.id, sessionId), isNull(avatarSessions.endedAt))).catch(() => undefined);
      return;
    }
    if (live.ending) return live.ending;
    live.ending = (async () => {
      const endedAtMs = this.now();
      const seconds = Math.max(0, Math.ceil((endedAtMs - live.startedAtMs) / 1000));
      const costUsd = (seconds / 60) * live.ratePerMinUsd;
      this.live.delete(live.id);
      // Count this session's seconds toward the month BEFORE anything async.
      const month = istMonthKey(live.startedAtMs);
      const cached = this.endedThisMonth.get(live.businessAccountId);
      if (cached && cached.month === month) cached.seconds += seconds;

      const voice = live.voice;
      live.voice = null;
      if (voice) {
        try { voice.onEnded(reason); } catch (error) { console.warn("[Avatar] voice onEnded failed:", (error as Error)?.message); }
      }
      try {
        await withTimeout(live.handle.close(reason), PROVIDER_CLOSE_TIMEOUT_MS, () => new Error("provider close timed out"));
      } catch (error) {
        console.warn(`[Avatar] ${live.provider} close failed (session ${live.id}): ${(error as Error)?.message || error}`);
      }
      const stats = live.handle.stats();
      try {
        await db.update(avatarSessions).set({
          status: "ended",
          endedAt: new Date(endedAtMs),
          billedSeconds: seconds,
          endReason: reason,
          costUsd: costUsd.toFixed(6),
          ...(live.handle.providerSessionId ? { providerSessionId: live.handle.providerSessionId } : {}),
          metadata: { keySource: live.apiKeySource, timings: live.timings, stats, audioRoute: live.audioRoute, ...(live.clientError ? { error: live.clientError } : {}) },
        }).where(eq(avatarSessions.id, live.id));
      } catch (error) {
        console.error(`[Avatar] failed to record end of session ${live.id}:`, (error as Error)?.message || error);
      }
      if (seconds > 0) {
        await aiUsageLogger.logAvatarUsage(live.businessAccountId, live.provider, seconds, costUsd, {
          avatarSessionId: live.id,
          conversationId: live.conversationId,
          endReason: reason,
          keySource: live.apiKeySource,
        });
      }
      console.log(`[AvatarTiming] session ${live.id} ended reason=${reason} seconds=${seconds} est=$${costUsd.toFixed(4)} timings=${JSON.stringify(live.timings)}`);
    })();
    return live.ending;
  }

  private requestEndAfterAnswer(live: LiveSession, reason: AvatarEndReason, now: number): void {
    if (live.ending) return;
    if (!live.endAfterAnswer) {
      live.endAfterAnswer = { reason, deadlineMs: now + END_AFTER_ANSWER_MAX_MS };
      live.voice?.notify({ type: "avatar_ending", reason });
      console.log(`[Avatar] session ${live.id} will end after the current answer (${reason})`);
    }
    if (!live.voice || !live.voice.isAnswerActive()) void this.endSession(live.id, live.endAfterAnswer.reason);
  }

  /** Watchdog: idle, max length, monthly cap, lost heartbeat, never connected. */
  async tick(now: number = this.now()): Promise<void> {
    const byBusiness = new Map<string, LiveSession[]>();
    this.live.forEach((s) => {
      const list = byBusiness.get(s.businessAccountId) || [];
      list.push(s);
      byBusiness.set(s.businessAccountId, list);
    });
    for (const [businessAccountId, sessions] of Array.from(byBusiness.entries())) {
      let ended = 0;
      try { ended = await this.loadEndedSeconds(businessAccountId, istMonthKey(now)); } catch { ended = 0; }
      const liveSeconds = sessions.reduce((sum, s) => sum + Math.max(0, (now - s.startedAtMs) / 1000), 0);
      const capHit = sessions.length > 0 && ended + liveSeconds >= sessions[0].capSeconds;
      for (const live of sessions) {
        if (live.ending) continue;
        if (!live.connectedAtMs && now - live.startedAtMs > live.connectTimeoutMs + CONNECT_GRACE_MS) {
          void this.endSession(live.id, "connect_timeout");
          continue;
        }
        if (now - live.lastHeartbeatMs > HEARTBEAT_TIMEOUT_MS) {
          void this.endSession(live.id, "heartbeat_timeout");
          continue;
        }
        const answering = !!live.voice?.isAnswerActive();
        if (answering) live.lastActivityMs = now;
        if (live.endAfterAnswer) {
          if (now >= live.endAfterAnswer.deadlineMs || !answering) void this.endSession(live.id, live.endAfterAnswer.reason);
          continue;
        }
        if (capHit) { this.requestEndAfterAnswer(live, "cap_reached", now); continue; }
        if (now - live.startedAtMs >= live.maxSessionMs) { this.requestEndAfterAnswer(live, "max_duration", now); continue; }
        if (!answering && now - live.lastActivityMs >= live.idleTimeoutMs) {
          live.voice?.notify({ type: "avatar_ending", reason: "idle_timeout" });
          void this.endSession(live.id, "idle_timeout");
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    this.stop();
    const ids = Array.from(this.live.keys());
    await Promise.allSettled(ids.map((id) => this.endSession(id, "server_shutdown")));
  }

  /**
   * Close sessions a previous process left open (crash / hard restart). Billed up
   * to their last heartbeat. Best-effort provider stop when we know the id.
   */
  async recoverOrphans(bootTime: Date = new Date()): Promise<number> {
    const rows = await db.select().from(avatarSessions)
      .where(and(isNull(avatarSessions.endedAt), lt(avatarSessions.startedAt, bootTime)));
    for (const row of rows) {
      if (this.live.has(row.id)) continue;
      const startedMs = row.startedAt.getTime();
      const lastMs = Math.max(startedMs, (row.lastHeartbeatAt ?? row.startedAt).getTime());
      const seconds = Math.max(0, Math.ceil((lastMs - startedMs) / 1000));
      const rates = await getRates().catch(() => ({} as Record<string, number>));
      const rate = (rates as Record<string, number>)[row.provider] ?? 0;
      const costUsd = (seconds / 60) * rate;
      await db.update(avatarSessions).set({
        status: "ended",
        endedAt: new Date(lastMs),
        billedSeconds: seconds,
        endReason: "server_restart",
        costUsd: costUsd.toFixed(6),
      }).where(and(eq(avatarSessions.id, row.id), isNull(avatarSessions.endedAt)));
      if (seconds > 0) {
        await aiUsageLogger.logAvatarUsage(row.businessAccountId, row.provider, seconds, costUsd, { avatarSessionId: row.id, endReason: "server_restart" });
      }
      if (row.providerSessionId && isProviderSelectable(row.provider)) {
        try {
          const settings = await getEffectiveSettings(row.businessAccountId);
          const key = await resolveApiKey(row.provider as AvatarProviderId, settings);
          if (key.apiKey) await getAvatarProvider(row.provider as AvatarProviderId).stopSession?.(key.apiKey, row.providerSessionId, "server_restart");
        } catch { /* provider idle timeouts will reap it */ }
      }
    }
    if (rows.length) console.log(`[Avatar] Closed ${rows.length} avatar session(s) left open by a previous process`);
    this.endedThisMonth.clear();
    return rows.length;
  }

  /** Recent sessions for the admin card. */
  async recentSessions(businessAccountId: string, limit = 10): Promise<Array<{ id: string; provider: string; startedAt: string; endedAt: string | null; seconds: number; endReason: string | null; status: string; error: string | null }>> {
    const rows = await db.select().from(avatarSessions)
      .where(eq(avatarSessions.businessAccountId, businessAccountId))
      .orderBy(sql`${avatarSessions.startedAt} desc`)
      .limit(Math.min(50, Math.max(1, limit)));
    const now = this.now();
    return rows.map((r) => {
      const live = this.live.get(r.id);
      return {
        id: r.id,
        provider: r.provider,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt ? r.endedAt.toISOString() : null,
        seconds: live ? Math.round((now - live.startedAtMs) / 1000) : r.billedSeconds,
        endReason: r.endReason,
        status: live ? "live" : r.status,
        // Provider's own message for a failed start (super-admin view only; never contains the key).
        error: typeof (r.metadata as any)?.error === "string" ? String((r.metadata as any).error).slice(0, 200) : null,
      };
    });
  }

  /** Test helper. */
  resetForTesting(): void {
    this.stop();
    this.live.clear();
    this.endedThisMonth.clear();
    this.businessLocks.clear();
    this.now = () => Date.now();
  }
}

export const avatarSessionManager = new AvatarSessionManager();

