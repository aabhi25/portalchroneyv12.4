/**
 * AI Calling — the dialer (background job, every 15 s; safe with several server instances).
 *
 * Each tick:
 *  1. Recovers stuck calls: a claim older than 3 min that never reached the provider goes back to
 *     the queue (a claim that DID reach the provider but has no provider id is failed, never redialled);
 *     simulator calls ringing > 45 s → no_answer; Exotel calls with no status for 10 min → failed;
 *     calls "on the call" for > 40 min → completed. Each then goes through processFinishedCall.
 *  2. Claims due calls atomically:
 *       UPDATE ai_calls SET status='dialing', claimed_at=now WHERE id IN
 *         (SELECT id … WHERE status='queued' AND scheduled_at <= now … FOR UPDATE SKIP LOCKED)
 *       AND status='queued' RETURNING id
 *     so two instances (or two overlapping ticks) can never take the same call.
 *  3. For each claimed call, checks in order: business switch (super admin + settings.enabled) →
 *     attempts ≤ maxAttempts → do-not-call list → calling hours (else back to the queue at the next
 *     window start) → consent (automatic calls only) → monthly minutes (business + super admin cap) →
 *     free line (concurrency, under a per-business advisory lock; else retried in 20 s) → provider.
 *     Then builds the signed stream / status URLs and places the call.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { aiCallDoNotCall, aiCalls, businessAccounts, conversations, leads, messages, type AiCall, type Lead } from "@shared/schema";
import { LIVE_CALL_STATUSES, type CallStatus, type CallTrigger } from "@shared/aiCalling";
import { trackTimer, untrackTimer } from "../../lib/lifecycle";
import { buildOutboundStreamUrl, buildStatusCallbackUrl, resolvePublicBaseUrl } from "./streamToken";
import { effectiveHours, effectiveMinuteLimit, getCallingSettings, minutesThisMonth, nextAllowedTime } from "./settingsService";
import { resolveProviderCredentials } from "./credentials";
import { getCallingProvider } from "./providers";
import { SIMULATOR_RING_TIMEOUT_MS } from "./providers/simulator";

export const DIALER_INTERVAL_MS = 15_000;
export const CLAIM_BATCH = 25;
export const STALE_CLAIM_MS = 3 * 60_000;
export const EXOTEL_NO_STATUS_MS = 10 * 60_000;
export const STALE_IN_PROGRESS_MS = 40 * 60_000;
export const CONCURRENCY_WAIT_MS = 20_000;
export const DEDUPE_WINDOW_MS = 24 * 3600_000;

/** Triggers that need the lead's consent (staff "Call now", callbacks the customer asked for and tests don't). */
const CONSENT_TRIGGERS: CallTrigger[] = ["auto_lead", "audience"];

const nowIso = (d: Date) => d.toISOString();

// ── helpers shared with routes / lead trigger / lifecycle ─────────────────────

export async function isDoNotCall(businessAccountId: string, phone: string): Promise<boolean> {
  const [row] = await db.select({ id: aiCallDoNotCall.id }).from(aiCallDoNotCall)
    .where(and(eq(aiCallDoNotCall.businessAccountId, businessAccountId), eq(aiCallDoNotCall.phone, phone))).limit(1);
  return !!row;
}

export async function addDoNotCall(businessAccountId: string, phone: string, input: { reason?: string | null; source?: string; callId?: string | null; createdBy?: string | null }) {
  const [row] = await db.insert(aiCallDoNotCall).values({
    businessAccountId, phone, reason: input.reason ?? null, source: input.source ?? "staff", callId: input.callId ?? null, createdBy: input.createdBy ?? null,
  }).onConflictDoNothing().returning();
  // Anything still waiting for this number will not be placed.
  await db.update(aiCalls)
    .set({ status: "skipped", endReason: "do_not_call", errorMessage: "This number is on your do-not-call list.", endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(aiCalls.businessAccountId, businessAccountId), eq(aiCalls.phone, phone), eq(aiCalls.status, "queued")));
  return row ?? null;
}

/** An open (waiting / live) call for this lead or number, or one created within `windowMs`. */
export async function findOpenOrRecentCall(businessAccountId: string, target: { leadId?: string | null; phone?: string | null }, windowMs = DEDUPE_WINDOW_MS): Promise<AiCall | null> {
  const who = [] as any[];
  if (target.leadId) who.push(eq(aiCalls.leadId, target.leadId));
  if (target.phone) who.push(eq(aiCalls.phone, target.phone));
  if (!who.length) return null;
  const since = new Date(Date.now() - windowMs);
  const [row] = await db.select().from(aiCalls)
    .where(and(
      eq(aiCalls.businessAccountId, businessAccountId),
      eq(aiCalls.direction, "outbound"),
      or(...who),
      or(inArray(aiCalls.status, ["queued", ...LIVE_CALL_STATUSES]), and(gt(aiCalls.createdAt, since), ne(aiCalls.status, "cancelled"))),
    ))
    .orderBy(desc(aiCalls.createdAt)).limit(1);
  return row ?? null;
}

export async function findOpenCall(businessAccountId: string, phone: string): Promise<AiCall | null> {
  const [row] = await db.select().from(aiCalls)
    .where(and(eq(aiCalls.businessAccountId, businessAccountId), eq(aiCalls.phone, phone), inArray(aiCalls.status, ["queued", ...LIVE_CALL_STATUSES])))
    .limit(1);
  return row ?? null;
}

export interface EnqueueInput {
  businessAccountId: string;
  phone: string;
  trigger: CallTrigger;
  provider: string;
  leadId?: string | null;
  scheduledAt?: Date;
  attempt?: number;
  parentCallId?: string | null;
  requestedBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function enqueueCall(input: EnqueueInput): Promise<AiCall> {
  const [row] = await db.insert(aiCalls).values({
    businessAccountId: input.businessAccountId,
    direction: "outbound",
    status: "queued",
    trigger: input.trigger,
    provider: input.provider === "exotel" ? "exotel" : "simulator",
    phone: input.phone,
    leadId: input.leadId ?? null,
    attempt: input.attempt ?? 1,
    parentCallId: input.parentCallId ?? null,
    scheduledAt: input.scheduledAt ?? new Date(),
    requestedBy: input.requestedBy ?? null,
    metadata: input.metadata ?? null,
  }).returning();
  return row;
}

/**
 * The visitor asked for a call in the website chat ("call me back", "please call me" — the same
 * detector Smart Lead Training uses) → lead.call_consent = 'yes' (source 'chat'). Returns true if set.
 */
export async function markConsentFromChat(lead: Pick<Lead, "id" | "businessAccountId" | "conversationId" | "callConsent">): Promise<boolean> {
  if (!lead.conversationId || lead.callConsent) return false;
  const { hasCallbackIntent } = await import("../leadCapture/detectors");
  const rows = await db.select({ content: messages.content }).from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.conversationId, lead.conversationId), eq(messages.role, "user"), eq(conversations.businessAccountId, lead.businessAccountId)))
    .orderBy(desc(messages.createdAt)).limit(40);
  if (!rows.some((r) => hasCallbackIntent(r.content || ""))) return false;
  const res = await db.update(leads).set({ callConsent: "yes", callConsentAt: new Date(), callConsentSource: "chat" })
    .where(and(eq(leads.id, lead.id), isNull(leads.callConsent))).returning({ id: leads.id });
  return res.length > 0;
}

// ── tick ─────────────────────────────────────────────────────────────────────

export interface TickReport {
  claimed: number;
  placed: string[];
  skipped: Array<{ id: string; reason: string }>;
  rescheduled: Array<{ id: string; reason: string; at: string }>;
  failed: Array<{ id: string; error: string }>;
  recovered: string[];
}

async function finish(callIds: string[]) {
  if (!callIds.length) return;
  const { processFinishedCall } = await import("./callLifecycle");
  for (const id of callIds) {
    try { await processFinishedCall(id); } catch (err: any) { console.error(`[Calling] post-call processing failed for ${id}:`, err?.message || err); }
  }
}

async function recoverStale(now: Date, report: TickReport): Promise<void> {
  const claimCutoff = nowIso(new Date(now.getTime() - STALE_CLAIM_MS));
  // Claimed, never handed to the provider → back to the queue (safe: nothing was dialled).
  const requeued: any = await db.execute(sql`
    UPDATE ai_calls SET status = 'queued', claimed_at = NULL, updated_at = ${nowIso(now)}
    WHERE status = 'dialing' AND provider_call_sid IS NULL AND started_at IS NULL AND claimed_at < ${claimCutoff}
    RETURNING id`);
  // Handed to the provider but no provider id recorded (crash mid-request) → failed, never redialled
  // in place (normal retry rules then apply after the retry gap).
  const lost: any = await db.execute(sql`
    UPDATE ai_calls SET status = 'failed', end_reason = 'interrupted', ended_at = ${nowIso(now)}, updated_at = ${nowIso(now)},
      error_message = 'The server restarted while this call was being connected.'
    WHERE status = 'dialing' AND provider_call_sid IS NULL AND started_at IS NOT NULL AND claimed_at < ${claimCutoff}
    RETURNING id`);
  const simCutoff = nowIso(new Date(now.getTime() - SIMULATOR_RING_TIMEOUT_MS));
  const simNoAnswer: any = await db.execute(sql`
    UPDATE ai_calls SET status = 'no_answer', end_reason = 'not_answered', ended_at = ${nowIso(now)}, updated_at = ${nowIso(now)}
    WHERE provider = 'simulator' AND direction = 'outbound' AND status = 'ringing' AND started_at < ${simCutoff}
    RETURNING id`);
  const exoCutoff = nowIso(new Date(now.getTime() - EXOTEL_NO_STATUS_MS));
  const exoLost: any = await db.execute(sql`
    UPDATE ai_calls SET status = 'failed', end_reason = 'no_status_from_provider', ended_at = ${nowIso(now)}, updated_at = ${nowIso(now)},
      error_message = 'Exotel never told us how this call went.'
    WHERE provider = 'exotel' AND status IN ('dialing', 'ringing') AND provider_call_sid IS NOT NULL AND started_at < ${exoCutoff}
    RETURNING id`);
  const liveCutoff = nowIso(new Date(now.getTime() - STALE_IN_PROGRESS_MS));
  const stuck: any = await db.execute(sql`
    UPDATE ai_calls SET status = 'completed', end_reason = COALESCE(end_reason, 'stale'), ended_at = COALESCE(ended_at, ${nowIso(now)}), updated_at = ${nowIso(now)}
    WHERE status = 'in_progress' AND COALESCE(answered_at, started_at) < ${liveCutoff}
    RETURNING id`);
  const ids = (r: any) => ((r.rows ?? r) as Array<{ id: string }>).map((x) => x.id);
  report.recovered.push(...ids(requeued));
  const toFinish = [...ids(lost), ...ids(simNoAnswer), ...ids(exoLost), ...ids(stuck)];
  report.recovered.push(...toFinish);
  await finish(toFinish);
}

async function claimDue(now: Date, limit = CLAIM_BATCH): Promise<string[]> {
  const res: any = await db.execute(sql`
    UPDATE ai_calls SET status = 'dialing', claimed_at = ${nowIso(now)}, updated_at = ${nowIso(now)}
    WHERE id IN (
      SELECT id FROM ai_calls
      WHERE status = 'queued' AND scheduled_at IS NOT NULL AND scheduled_at <= ${nowIso(now)}
      ORDER BY scheduled_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) AND status = 'queued'
    RETURNING id`);
  return ((res.rows ?? res) as Array<{ id: string }>).map((r) => r.id);
}

async function skip(call: AiCall, reason: string, message: string, report: TickReport) {
  await db.update(aiCalls).set({ status: "skipped", endReason: reason, errorMessage: message, endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(aiCalls.id, call.id), eq(aiCalls.status, "dialing")));
  report.skipped.push({ id: call.id, reason });
}

async function requeue(call: AiCall, at: Date, reason: string, report: TickReport) {
  await db.update(aiCalls).set({
    status: "queued", claimedAt: null, startedAt: null, scheduledAt: at, updatedAt: new Date(),
    metadata: { ...(call.metadata || {}), waitReason: reason },
  }).where(and(eq(aiCalls.id, call.id), eq(aiCalls.status, "dialing")));
  report.rescheduled.push({ id: call.id, reason, at: at.toISOString() });
}

async function fail(call: AiCall, message: string, permanent: boolean, report: TickReport) {
  await db.update(aiCalls).set({
    status: "failed", errorMessage: message.slice(0, 500), endReason: "provider_error", endedAt: new Date(), updatedAt: new Date(),
    metadata: { ...(call.metadata || {}), permanentFailure: permanent },
  }).where(eq(aiCalls.id, call.id));
  report.failed.push({ id: call.id, error: message });
  await finish([call.id]);
}

function needsConsent(call: AiCall): boolean {
  const root = (call.metadata as any)?.rootTrigger || call.trigger;
  return CONSENT_TRIGGERS.includes(root as CallTrigger);
}

async function processClaimed(callId: string, now: Date, report: TickReport): Promise<void> {
  const [call] = await db.select().from(aiCalls).where(eq(aiCalls.id, callId)).limit(1);
  if (!call || call.status !== "dialing") return;

  const [biz] = await db.select({ enabled: businessAccounts.aiCallingEnabled, status: businessAccounts.status })
    .from(businessAccounts).where(eq(businessAccounts.id, call.businessAccountId)).limit(1);
  const settings = await getCallingSettings(call.businessAccountId);
  if (!biz || biz.enabled !== "true" || !settings.enabled || biz.status === "suspended") {
    return skip(call, "calling_off", "AI Calling was switched off before this call was placed.", report);
  }
  if (call.attempt > settings.maxAttempts) {
    return skip(call, "max_attempts", `Already tried ${settings.maxAttempts} time(s).`, report);
  }
  if (await isDoNotCall(call.businessAccountId, call.phone)) {
    return skip(call, "do_not_call", "This number is on your do-not-call list.", report);
  }
  const next = nextAllowedTime(now, effectiveHours(settings));
  if (next.getTime() > now.getTime()) {
    return requeue(call, next, "outside_hours", report);
  }
  if (needsConsent(call)) {
    const lead = call.leadId ? (await db.select().from(leads).where(eq(leads.id, call.leadId)).limit(1))[0] : undefined;
    if (lead?.callConsent === "no") return skip(call, "no_consent", "This lead said they do not want calls.", report);
    if (settings.consentMode !== "business_attested") {
      let ok = lead?.callConsent === "yes";
      if (!ok && lead) ok = await markConsentFromChat(lead);
      if (!ok) return skip(call, "no_consent", "This lead has not asked for or agreed to a call (consent rule: only leads who asked).", report);
    }
  }
  const { limit, source } = await effectiveMinuteLimit(settings);
  if (limit !== null && (await minutesThisMonth(call.businessAccountId, now)) >= limit) {
    return skip(call, "monthly_limit", source === "super_admin"
      ? "This month's calling minutes (set by your plan) are used up."
      : "This month's calling minute limit is reached. Raise it in AI Calling settings to keep calling.", report);
  }

  // Free line? Serialised per business so two instances can't both take the last line.
  const gotLine = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`aicall-lines:${call.businessAccountId}`}))`);
    const [r] = await tx.select({ n: sql<number>`COUNT(*)::int` }).from(aiCalls).where(and(
      eq(aiCalls.businessAccountId, call.businessAccountId),
      ne(aiCalls.id, call.id),
      or(inArray(aiCalls.status, ["ringing", "in_progress"]), and(eq(aiCalls.status, "dialing"), isNotNull(aiCalls.startedAt))),
    ));
    if (Number(r?.n ?? 0) >= settings.concurrentCallLimit) return false;
    const up = await tx.update(aiCalls).set({ startedAt: new Date(), provider: settings.provider === "exotel" ? "exotel" : "simulator", updatedAt: new Date() })
      .where(and(eq(aiCalls.id, call.id), eq(aiCalls.status, "dialing"))).returning({ id: aiCalls.id });
    return up.length > 0;
  });
  if (!gotLine) return requeue(call, new Date(now.getTime() + CONCURRENCY_WAIT_MS), "waiting_for_free_line", report);

  const providerId = settings.provider === "exotel" ? "exotel" : "simulator";
  let creds;
  try {
    creds = resolveProviderCredentials(settings);
  } catch (err: any) {
    return fail({ ...call, provider: providerId }, err?.message || "Calling is not set up.", true, report);
  }
  const base = resolvePublicBaseUrl(settings.publicBaseUrl);
  if (providerId === "exotel" && !base) {
    return fail(call, "The portal's public web address is not known yet, so Exotel can't reach us. Open AI Calling settings from your portal's public address and press Save once (or ask support to set PUBLIC_BASE_URL).", true, report);
  }
  const provider = getCallingProvider(providerId);
  try {
    const result = await provider.placeCall(creds, {
      callId: call.id,
      businessAccountId: call.businessAccountId,
      to: call.phone,
      streamUrl: base ? buildOutboundStreamUrl(base, call.id) : "",
      statusCallbackUrl: base ? buildStatusCallbackUrl(base, providerId, call.id) : "",
      record: settings.recordCalls,
      timeLimitSec: settings.maxCallMinutes * 60,
    });
    const callerId = providerId === "exotel" ? settings.exotelCallerId : null;
    await db.update(aiCalls).set({ providerCallSid: result.providerCallSid, callerId, updatedAt: new Date() }).where(eq(aiCalls.id, call.id));
    // Only move forward from 'dialing' (a fast webhook / media start may already have advanced it).
    await db.update(aiCalls).set({ status: result.status as CallStatus }).where(and(eq(aiCalls.id, call.id), eq(aiCalls.status, "dialing")));
    report.placed.push(call.id);
  } catch (err: any) {
    const permanent = !!err?.permanent;
    console.error(`[Calling] placing call ${call.id} failed: ${err?.message || err}`);
    return fail(call, err?.message || "The call could not be placed.", permanent, report);
  }
}

/** One dialer pass. Exported for tests (two concurrent passes must never dial the same call twice). */
export async function runDialerTick(now: Date = new Date()): Promise<TickReport> {
  const report: TickReport = { claimed: 0, placed: [], skipped: [], rescheduled: [], failed: [], recovered: [] };
  await recoverStale(now, report);
  const ids = await claimDue(now);
  report.claimed = ids.length;
  for (const id of ids) {
    try {
      await processClaimed(id, now, report);
    } catch (err: any) {
      console.error(`[Calling] dialer error for call ${id}:`, err?.message || err);
      // Leave it claimed: stale-claim recovery re-queues it if it never reached the provider.
    }
  }
  return report;
}

// ── background loop ──────────────────────────────────────────────────────────

let interval: ReturnType<typeof setInterval> | null = null;
let running = false;

async function guardedTick() {
  if (running) return;
  running = true;
  try { await runDialerTick(); } catch (err: any) { console.error("[Calling] dialer tick failed:", err?.message || err); } finally { running = false; }
}

export function startCallingDialer(): void {
  if (interval || process.env.AI_CALLING_DIALER_DISABLED === "1") return;
  interval = trackTimer(setInterval(() => { void guardedTick(); }, DIALER_INTERVAL_MS));
  trackTimer(setTimeout(() => { void guardedTick(); }, 5_000));
  console.log("[Calling] dialer started (every 15s)");
}

export function stopCallingDialer(): void {
  if (interval) { clearInterval(interval); untrackTimer(interval); }
  interval = null;
}

/** Run a pass soon (e.g. right after staff press "Call now"); no-op when the dialer isn't running. */
export function kickDialer(): void {
  if (!interval) return;
  trackTimer(setTimeout(() => { void guardedTick(); }, 50));
}
