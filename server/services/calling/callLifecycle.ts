/**
 * AI Calling — what happens after a call ends (owned by the calling engine).
 *
 * The media stream (mediaStream.ts), the provider status webhook, the simulator decline and the
 * dialer's stale-call recovery call processFinishedCall(callId) once a call reaches a terminal
 * status. It is idempotent: the first caller claims ai_calls.post_processed_at; later calls return.
 * (A call still 'in_progress' is closed as 'completed' first, so the media side may call this right
 * after the stream stops.)
 *
 * Steps: billed seconds → summary / outcome / captured fields (LLM, falling back to what the voice
 * AI set) → do-not-call → callback → retry → lead update → WhatsApp follow-up → usage metering.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { aiCalls, businessAccounts, conversations, leads, messages, type AiCall } from "@shared/schema";
import { TERMINAL_CALL_STATUSES, type CallOutcome, type CallStatus } from "@shared/aiCalling";
import { systemSettingsService } from "../systemSettingsService";
import { effectiveHours, getCallingSettings, nextAllowedTime } from "./settingsService";
import { addDoNotCall, enqueueCall, findOpenCall, isDoNotCall } from "./dialer";
import { summarizeCall } from "./summary";

/** Statuses that get another attempt after the retry gap (failed only when not permanent). */
const RETRY_STATUSES: CallStatus[] = ["no_answer", "busy", "voicemail", "failed"];
const NO_FOLLOW_UP_OUTCOMES: CallOutcome[] = ["do_not_call", "wrong_number"];

// ── usage cost estimate (telephony minutes) ─────────────────────────────────

export const DEFAULT_CALL_RATES_USD_PER_MIN: Record<string, number> = { exotel: 0.015, simulator: 0 };
const RATES_SETTING = "ai_calling_rates_usd_per_min";

export async function getCallRates(): Promise<Record<string, number>> {
  const rates = { ...DEFAULT_CALL_RATES_USD_PER_MIN };
  const raw = await systemSettingsService.getSetting(RATES_SETTING).catch(() => null);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      for (const k of Object.keys(rates)) {
        const v = Number(parsed?.[k]);
        if (Number.isFinite(v) && v >= 0 && v <= 10) rates[k] = v;
      }
    } catch { /* defaults */ }
  }
  return rates;
}

/** Telephony-style billing: whole minutes, rounded up, for answered calls only. */
export function billedSecondsFor(durationSec: number | null | undefined, answered: boolean): number {
  if (!answered || !durationSec || durationSec <= 0) return 0;
  return Math.ceil(durationSec / 60) * 60;
}

// ── WhatsApp follow-up sender (tests inject a fake) ─────────────────────────

export interface FollowUpRequest {
  businessAccountId: string;
  phone: string;
  templateId: string;
  leadName: string | null;
  businessName: string | null;
}
export type FollowUpSender = (req: FollowUpRequest) => Promise<{ success: boolean; error?: string; messageId?: string | null }>;

async function defaultFollowUpSender(req: FollowUpRequest): Promise<{ success: boolean; error?: string; messageId?: string | null }> {
  const { whatsappTemplateService } = await import("../whatsappTemplateService");
  const { whatsappService } = await import("../whatsappService");
  const { sendTemplateMessage } = await import("../whatsappSessionService");
  const tpl = await whatsappTemplateService.get(req.businessAccountId, req.templateId);
  if (!tpl || (tpl as any).deletedAt) return { success: false, error: "The follow-up WhatsApp template no longer exists." };
  if (tpl.status !== "approved") return { success: false, error: "The follow-up WhatsApp template is not approved yet." };
  const settings = await whatsappService.getSettings(req.businessAccountId);
  if (!settings?.msg91AuthKey || !settings?.msg91IntegratedNumberId) return { success: false, error: "WhatsApp sending isn't set up yet." };
  // {{1}} = the lead's name; any further placeholders get the business name.
  const params: Record<string, string> = {};
  for (let i = 1; i <= (tpl.paramCount || 0); i++) {
    params[String(i)] = i === 1 ? (req.leadName?.trim() || "there") : (req.businessName?.trim() || "us");
  }
  const r = await sendTemplateMessage(settings, req.phone, tpl.name, params, { language: tpl.language, namespace: tpl.namespace });
  return { success: !!r.success, messageId: r.messageId ?? null, error: r.success ? undefined : String(typeof r.error === "string" ? r.error : JSON.stringify(r.error ?? "send failed")).slice(0, 300) };
}

let followUpSender: FollowUpSender = defaultFollowUpSender;
export function setFollowUpSenderForTesting(fn: FollowUpSender | null): void {
  followUpSender = fn ?? defaultFollowUpSender;
}

// ── main ────────────────────────────────────────────────────────────────────

async function claim(callId: string): Promise<AiCall | null> {
  const [current] = await db.select().from(aiCalls).where(eq(aiCalls.id, callId)).limit(1);
  if (!current || current.postProcessedAt) return null;
  if (current.status === "in_progress") {
    // The media side ended the call without a final status: close it as completed.
    const endedAt = current.endedAt ?? new Date();
    const durationSec = current.durationSec ?? (current.answeredAt ? Math.max(0, Math.round((endedAt.getTime() - new Date(current.answeredAt).getTime()) / 1000)) : null);
    await db.update(aiCalls).set({ status: "completed", endedAt, durationSec, updatedAt: new Date() })
      .where(and(eq(aiCalls.id, callId), eq(aiCalls.status, "in_progress")));
  }
  const [row] = await db.update(aiCalls).set({ postProcessedAt: new Date() })
    .where(and(eq(aiCalls.id, callId), isNull(aiCalls.postProcessedAt), inArray(aiCalls.status, TERMINAL_CALL_STATUSES)))
    .returning();
  return row ?? null;
}

async function loadTranscript(call: AiCall): Promise<Array<{ role: "user" | "assistant"; content: string; createdAt: Date }>> {
  if (!call.conversationId) return [];
  const rows = await db.select({ role: messages.role, content: messages.content, createdAt: messages.createdAt }).from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.conversationId, call.conversationId), eq(conversations.businessAccountId, call.businessAccountId)))
    .orderBy(messages.createdAt);
  return rows.filter((r) => r.role === "user" || r.role === "assistant").map((r) => ({ role: r.role as "user" | "assistant", content: r.content, createdAt: r.createdAt }));
}

function fallbackOutcome(call: AiCall): CallOutcome | null {
  if (call.outcome) return call.outcome as CallOutcome;
  if (call.transferred) return "transferred";
  switch (call.status) {
    case "no_answer": case "busy": return "no_answer";
    case "voicemail": return "voicemail";
    default: return null;
  }
}

export async function processFinishedCall(callId: string): Promise<void> {
  const call = await claim(callId);
  if (!call) return;
  const settings = await getCallingSettings(call.businessAccountId);
  const [biz] = await db.select({ name: businessAccounts.name, enabled: businessAccounts.aiCallingEnabled }).from(businessAccounts)
    .where(eq(businessAccounts.id, call.businessAccountId)).limit(1);
  const answered = !!call.answeredAt && (call.status === "completed" || call.status === "voicemail");
  const durationSec = call.durationSec ?? (call.answeredAt && call.endedAt
    ? Math.max(0, Math.round((new Date(call.endedAt).getTime() - new Date(call.answeredAt).getTime()) / 1000)) : null);
  const billedSeconds = billedSecondsFor(durationSec, !!call.answeredAt);

  // 1. Summary / outcome.
  let outcome: CallOutcome | null = fallbackOutcome(call);
  let summary = call.summary;
  let outcomeNote = call.outcomeNote;
  let callbackAt: Date | null = call.callbackAt ? new Date(call.callbackAt) : null;
  let capturedFields: Record<string, string> = { ...(call.capturedFields || {}) };
  if (answered && call.status === "completed") {
    const transcript = await loadTranscript(call);
    if (transcript.length) {
      const hours = effectiveHours(settings);
      const analysed = await summarizeCall({
        businessAccountId: call.businessAccountId,
        businessName: biz?.name ?? null,
        direction: call.direction === "inbound" ? "inbound" : "outbound",
        callPurpose: settings.callPurpose,
        transcript: transcript.map(({ role, content }) => ({ role, content })),
        now: new Date(),
        timezone: hours.timezone,
      });
      if (analysed) {
        summary = summary || analysed.summary;
        outcome = call.outcome ? (call.outcome as CallOutcome) : (analysed.outcome ?? outcome ?? "info_given");
        outcomeNote = outcomeNote || analysed.outcomeNote;
        callbackAt = callbackAt || analysed.callbackAt;
        capturedFields = { ...analysed.capturedFields, ...capturedFields };
      }
    }
    if (!outcome) outcome = "info_given";
  }

  await db.update(aiCalls).set({
    durationSec, billedSeconds, outcome, summary, outcomeNote, callbackAt,
    capturedFields: Object.keys(capturedFields).length ? capturedFields : null,
    updatedAt: new Date(),
  }).where(eq(aiCalls.id, call.id));

  const lead = call.leadId ? (await db.select().from(leads).where(eq(leads.id, call.leadId)).limit(1))[0] : undefined;
  const steps: Array<[string, () => Promise<void>]> = [];

  // 2. Do-not-call.
  if (outcome === "do_not_call") {
    steps.push(["do-not-call", async () => {
      await addDoNotCall(call.businessAccountId, call.phone, { reason: "Asked on a call not to be called again", source: "call", callId: call.id });
      if (lead) await db.update(leads).set({ callConsent: "no", callConsentAt: new Date(), callConsentSource: "call", updatedAt: new Date() }).where(eq(leads.id, lead.id));
    }]);
  }

  const callingOn = biz?.enabled === "true" && settings.enabled;

  // 3. Callback the customer asked for.
  if (outcome === "callback_requested" && callbackAt && callingOn) {
    steps.push(["callback", async () => {
      if (await isDoNotCall(call.businessAccountId, call.phone)) return;
      if (await findOpenCall(call.businessAccountId, call.phone)) return;
      await enqueueCall({
        businessAccountId: call.businessAccountId, phone: call.phone, trigger: "callback", provider: settings.provider,
        leadId: call.leadId, scheduledAt: nextAllowedTime(callbackAt!, effectiveHours(settings)), parentCallId: call.id,
        metadata: { rootTrigger: "callback", requestedOnCallId: call.id },
      });
    }]);
  }

  // 4. Retry unanswered / failed outbound calls.
  const permanent = !!(call.metadata as any)?.permanentFailure;
  if (call.direction === "outbound" && call.trigger !== "test" && RETRY_STATUSES.includes(call.status as CallStatus)
    && !(call.status === "failed" && permanent) && call.attempt < settings.maxAttempts && callingOn && outcome !== "do_not_call") {
    steps.push(["retry", async () => {
      if (await isDoNotCall(call.businessAccountId, call.phone)) return;
      if (await findOpenCall(call.businessAccountId, call.phone)) return;
      const at = nextAllowedTime(new Date(Date.now() + settings.retryGapMinutes * 60_000), effectiveHours(settings));
      await enqueueCall({
        businessAccountId: call.businessAccountId, phone: call.phone, trigger: "retry", provider: settings.provider,
        leadId: call.leadId, scheduledAt: at, attempt: call.attempt + 1, parentCallId: call.id, requestedBy: call.requestedBy,
        metadata: { rootTrigger: (call.metadata as any)?.rootTrigger || call.trigger, ...(call.metadata && (call.metadata as any).name ? { name: (call.metadata as any).name } : {}) },
      });
    }]);
  }

  // 5. Lead: fill empty name / email from the call; consent from the call.
  if (lead && outcome !== "do_not_call") {
    steps.push(["lead", async () => {
      const patch: Record<string, unknown> = {};
      const name = capturedFields.name || capturedFields.Name;
      const email = capturedFields.email || capturedFields.Email;
      if (name && (!lead.name || lead.name === "Anonymous" || lead.name === "Unknown")) patch.name = name.slice(0, 200);
      if (email && !lead.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) patch.email = email.slice(0, 200);
      // Inbound callers: the number they called from is the lead's phone when it has none.
      if (!lead.phone && call.direction === "inbound" && call.phone && call.phone !== "+910000000000") patch.phone = call.phone;
      if (outcome === "callback_requested" && !lead.callConsent) Object.assign(patch, { callConsent: "yes", callConsentAt: new Date(), callConsentSource: "call" });
      if (Object.keys(patch).length) await db.update(leads).set({ ...patch, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    }]);
  }

  // 6. WhatsApp follow-up after an answered call.
  if (settings.whatsappFollowUp && settings.whatsappFollowUpTemplateId && call.answeredAt && call.status === "completed"
    && !NO_FOLLOW_UP_OUTCOMES.includes(outcome as CallOutcome)) {
    steps.push(["follow-up", async () => {
      const [claimed] = await db.update(aiCalls).set({ followUpSentAt: new Date() })
        .where(and(eq(aiCalls.id, call.id), isNull(aiCalls.followUpSentAt))).returning({ id: aiCalls.id });
      if (!claimed) return;
      const res = await followUpSender({
        businessAccountId: call.businessAccountId, phone: call.phone, templateId: settings.whatsappFollowUpTemplateId!,
        leadName: capturedFields.name || lead?.name || (call.metadata as any)?.name || null, businessName: biz?.name ?? null,
      }).catch((err: any) => ({ success: false, error: err?.message || String(err) }));
      if (!res.success) {
        const [fresh] = await db.select({ metadata: aiCalls.metadata }).from(aiCalls).where(eq(aiCalls.id, call.id)).limit(1);
        await db.update(aiCalls).set({ followUpSentAt: null, metadata: { ...(fresh?.metadata || {}), followUpError: res.error || "send failed" } }).where(eq(aiCalls.id, call.id));
      }
    }]);
  }

  // 7. Usage metering (minutes show in Usage & Limits under "AI Calling").
  if (billedSeconds > 0) {
    steps.push(["metering", async () => {
      const rates = await getCallRates();
      const cost = (billedSeconds / 60) * (rates[call.provider] ?? 0);
      const { aiUsageLogger } = await import("../aiUsageLogger");
      await aiUsageLogger.logCallingUsage(call.businessAccountId, call.provider, billedSeconds, cost, {
        callId: call.id, direction: call.direction, durationSec: durationSec ?? 0,
      });
    }]);
  }

  for (const [name, step] of steps) {
    try { await step(); } catch (err: any) { console.error(`[Calling] post-call step "${name}" failed for ${call.id}:`, err?.message || err); }
  }
}
