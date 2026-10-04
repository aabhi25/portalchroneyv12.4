/**
 * AI Calling — business APIs (all behind requireAiCalling) and super admin APIs.
 *
 *   GET    /api/calling/settings                 settings view + { superAdminMinuteCap, minutesThisMonth, publicBaseUrl }
 *   PUT    /api/calling/settings                 partial update (audited); secrets write-only
 *   POST   /api/calling/settings/verify          provider.verify → { ok, detail } | 400 { error }
 *   POST   /api/calling/settings/inbound-key     new inbound key (old Exotel inbound URL stops working; audited)
 *   GET    /api/calling/calls                    list { calls, total }
 *   GET    /api/calling/calls/:id                detail { call, transcript, lead }
 *   GET    /api/calling/calls/:id/recording      audio (proxied from the provider; staff only)
 *   POST   /api/calling/calls                    manual "Call now" { call, scheduledAt, message }
 *   POST   /api/calling/calls/:id/cancel         cancel a waiting call { call }
 *   GET    /api/calling/do-not-call              { items, total }
 *   POST   /api/calling/do-not-call              { item }
 *   DELETE /api/calling/do-not-call/:id          { ok }
 *   GET    /api/calling/stats                    totals + byDay
 *   GET    /api/calling/simulator/incoming       ringing simulator calls { calls }
 *   POST   /api/calling/simulator/:id/decline    → no_answer (normal retry rules)
 *
 *   GET    /api/super-admin/ai-calling/:businessAccountId   { enabled, monthlyMinuteCap, minutesThisMonth, settingsEnabled, provider }
 *   PUT    /api/super-admin/ai-calling/:businessAccountId   { enabled?, monthlyMinuteCap? } (audited)
 */
import { Router, type Request, type Response } from "express";
import { and, count, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { aiCallDoNotCall, aiCalls, businessAccounts, conversations, leads, messages, type AiCall } from "@shared/schema";
import {
  CALL_OUTCOME_LABEL,
  normalizeCallPhone,
  type AiCallView,
  type CallDirection,
  type CallOutcome,
  type CallProviderId,
  type CallStatus,
  type CallTrigger,
} from "@shared/aiCalling";
import { requireAuth, requireRole } from "../auth";
import { recordAuditEventSafely } from "../services/auditService";
import { requireAiCalling } from "./aiCallingGate";
import {
  CallingSettingsError,
  effectiveHours,
  effectiveMinuteLimit,
  getCallingSettings,
  getSettingsResponse,
  getSuperAdminMinuteCap,
  markProviderVerified,
  minutesThisMonth,
  nextAllowedTime,
  rotateInboundKey,
  setSuperAdminMinuteCap,
  updateCallingSettings,
} from "../services/calling/settingsService";
import { resolveProviderCredentials } from "../services/calling/credentials";
import { getCallingProvider } from "../services/calling/providers";
import { addDoNotCall, enqueueCall, findOpenCall, isDoNotCall, kickDialer } from "../services/calling/dialer";

const router = Router();

const ALL_STATUSES: CallStatus[] = ["queued", "dialing", "ringing", "in_progress", "completed", "no_answer", "busy", "failed", "voicemail", "cancelled", "skipped"];
const ALL_OUTCOMES = Object.keys(CALL_OUTCOME_LABEL) as CallOutcome[];

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const bizOf = (req: Request) => req.user!.businessAccountId!;

function requestBaseUrl(req: Request): string | null {
  const host = req.get("host");
  if (!host) return null;
  return `${req.protocol}://${host}`;
}

export function toCallView(row: AiCall, leadName: string | null): AiCallView {
  return {
    id: row.id,
    direction: row.direction as CallDirection,
    status: row.status as CallStatus,
    trigger: row.trigger as CallTrigger,
    provider: row.provider as CallProviderId,
    phone: row.phone,
    leadId: row.leadId,
    leadName: leadName ?? ((row.metadata as any)?.name ? String((row.metadata as any).name) : null),
    attempt: row.attempt,
    scheduledAt: iso(row.scheduledAt),
    startedAt: iso(row.startedAt),
    answeredAt: iso(row.answeredAt),
    endedAt: iso(row.endedAt),
    durationSec: row.durationSec ?? null,
    outcome: (row.outcome as CallOutcome) ?? null,
    summary: row.summary ?? null,
    endReason: row.endReason ?? null,
    hasRecording: !!row.recordingUrl,
    conversationId: row.conversationId ?? null,
    createdAt: iso(row.createdAt)!,
  };
}

function toCallDetail(row: AiCall, leadName: string | null) {
  return {
    ...toCallView(row, leadName),
    capturedFields: row.capturedFields ?? null,
    outcomeNote: row.outcomeNote ?? null,
    callbackAt: iso(row.callbackAt),
    errorMessage: row.errorMessage ?? null,
    transferred: !!row.transferred,
    followUpSentAt: iso(row.followUpSentAt),
  };
}

function fail(res: Response, err: any, fallback = "Something went wrong. Please try again.") {
  if (err instanceof CallingSettingsError) return res.status(err.status).json({ error: err.message });
  console.error("[Calling] request failed:", err?.message || err);
  return res.status(500).json({ error: fallback });
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : def;
}

async function loadCall(businessAccountId: string, id: string): Promise<{ call: AiCall; leadName: string | null } | null> {
  const [row] = await db.select({ call: aiCalls, leadName: leads.name }).from(aiCalls)
    .leftJoin(leads, eq(leads.id, aiCalls.leadId))
    .where(and(eq(aiCalls.id, id), eq(aiCalls.businessAccountId, businessAccountId))).limit(1);
  return row ? { call: row.call, leadName: row.leadName ?? null } : null;
}

// ── settings ─────────────────────────────────────────────────────────────────

router.get("/api/calling/settings", ...requireAiCalling, async (req, res) => {
  try {
    res.json(await getSettingsResponse(bizOf(req)));
  } catch (err) { fail(res, err, "Could not load AI Calling settings"); }
});

router.put("/api/calling/settings", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const { whatsappTemplates } = await import("@shared/schema");
    const result = await updateCallingSettings(businessAccountId, req.body, req.user!.id, {
      requestBaseUrl: requestBaseUrl(req),
      templateExists: async (id) => {
        const [t] = await db.select({ id: whatsappTemplates.id }).from(whatsappTemplates)
          .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.businessAccountId, businessAccountId), isNull(whatsappTemplates.deletedAt))).limit(1);
        return !!t;
      },
    });
    if (result.changed.length || result.secretsChanged.length || result.attested) {
      await recordAuditEventSafely(req, {
        action: "ai_calling.settings_updated",
        outcome: "success",
        businessAccountId,
        resourceType: "ai_calling_settings",
        resourceId: businessAccountId,
        metadata: {
          changedFields: result.changed,
          credentialFieldsUpdated: result.secretsChanged,
          consentAttested: result.attested,
          enabled: result.row.enabled,
          provider: result.row.provider,
          consentMode: result.row.consentMode,
          autoCallLeads: result.row.autoCallLeads,
        },
      });
    }
    res.json(await getSettingsResponse(businessAccountId));
  } catch (err) { fail(res, err, "Could not save AI Calling settings"); }
});

router.post("/api/calling/settings/verify", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const settings = await getCallingSettings(businessAccountId);
    let creds;
    try { creds = resolveProviderCredentials(settings); } catch (e: any) { return res.status(400).json({ error: e?.message || "Calling is not set up" }); }
    try {
      const r = await getCallingProvider(creds.provider).verify(creds);
      if (creds.provider === "exotel" && settings.exists) await markProviderVerified(businessAccountId);
      await recordAuditEventSafely(req, { action: "ai_calling.provider_verified", outcome: "success", businessAccountId, resourceType: "ai_calling_settings", resourceId: businessAccountId, metadata: { provider: creds.provider } });
      res.json({ ok: true, detail: r.detail ?? null });
    } catch (e: any) {
      await recordAuditEventSafely(req, { action: "ai_calling.provider_verified", outcome: "failure", businessAccountId, resourceType: "ai_calling_settings", resourceId: businessAccountId, metadata: { provider: creds.provider } });
      res.status(400).json({ error: e?.message || "Could not connect to the phone provider" });
    }
  } catch (err) { fail(res, err); }
});

router.post("/api/calling/settings/inbound-key", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    await rotateInboundKey(businessAccountId, req.user!.id);
    await recordAuditEventSafely(req, { action: "ai_calling.inbound_key_rotated", outcome: "success", businessAccountId, resourceType: "ai_calling_settings", resourceId: businessAccountId });
    res.json(await getSettingsResponse(businessAccountId));
  } catch (err) { fail(res, err); }
});

// ── calls ────────────────────────────────────────────────────────────────────

router.get("/api/calling/calls", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const q = req.query as Record<string, string | undefined>;
    const where: SQL[] = [eq(aiCalls.businessAccountId, businessAccountId)];
    if (q.status) {
      const list = String(q.status).split(",").map((s) => s.trim()).filter((s) => (ALL_STATUSES as string[]).includes(s));
      if (list.length) where.push(inArray(aiCalls.status, list));
    }
    if (q.outcome) {
      const list = String(q.outcome).split(",").map((s) => s.trim()).filter((s) => (ALL_OUTCOMES as string[]).includes(s));
      if (list.length) where.push(inArray(aiCalls.outcome, list));
    }
    if (q.direction === "outbound" || q.direction === "inbound") where.push(eq(aiCalls.direction, q.direction));
    if (q.leadId) where.push(eq(aiCalls.leadId, String(q.leadId)));
    const from = parseDate(q.from);
    const to = parseDate(q.to);
    if (from) where.push(gte(aiCalls.createdAt, from));
    if (to) where.push(lt(aiCalls.createdAt, to));
    const search = typeof q.search === "string" ? q.search.trim().slice(0, 100) : "";
    if (search) {
      const like = `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const digits = search.replace(/\D/g, "");
      const conds: SQL[] = [ilike(leads.name, like), ilike(aiCalls.phone, like)];
      if (digits.length >= 3) conds.push(ilike(aiCalls.phone, `%${digits}%`));
      where.push(or(...conds)!);
    }
    const limit = clampInt(q.limit, 25, 1, 100);
    const offset = clampInt(q.offset, 0, 0, 1_000_000);
    const cond = and(...where);
    const [rows, [{ total }]] = await Promise.all([
      db.select({ call: aiCalls, leadName: leads.name }).from(aiCalls).leftJoin(leads, eq(leads.id, aiCalls.leadId))
        .where(cond).orderBy(desc(aiCalls.createdAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(aiCalls).leftJoin(leads, eq(leads.id, aiCalls.leadId)).where(cond),
    ]);
    res.json({ calls: rows.map((r) => toCallView(r.call, r.leadName ?? null)), total: Number(total) });
  } catch (err) { fail(res, err, "Could not load calls"); }
});

router.get("/api/calling/calls/:id", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const found = await loadCall(businessAccountId, req.params.id);
    if (!found) return res.status(404).json({ error: "Call not found" });
    const { call, leadName } = found;
    let transcript: Array<{ role: "user" | "assistant"; content: string; createdAt: string }> = [];
    if (call.conversationId) {
      const rows = await db.select({ role: messages.role, content: messages.content, createdAt: messages.createdAt }).from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(and(eq(messages.conversationId, call.conversationId), eq(conversations.businessAccountId, businessAccountId)))
        .orderBy(messages.createdAt);
      transcript = rows.filter((r) => r.role === "user" || r.role === "assistant")
        .map((r) => ({ role: r.role as "user" | "assistant", content: r.content, createdAt: iso(r.createdAt)! }));
    }
    let lead: { id: string; name: string | null; phone: string | null; email: string | null } | null = null;
    if (call.leadId) {
      const [l] = await db.select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email }).from(leads)
        .where(and(eq(leads.id, call.leadId), eq(leads.businessAccountId, businessAccountId))).limit(1);
      lead = l ?? null;
    }
    res.json({ call: toCallDetail(call, leadName), transcript, lead });
  } catch (err) { fail(res, err, "Could not load the call"); }
});

router.get("/api/calling/calls/:id/recording", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const found = await loadCall(businessAccountId, req.params.id);
    if (!found || !found.call.recordingUrl) return res.status(404).json({ error: "No recording for this call" });
    const settings = await getCallingSettings(businessAccountId);
    const provider = getCallingProvider(found.call.provider);
    if (!provider.fetchRecording) return res.status(404).json({ error: "No recording for this call" });
    let creds;
    try { creds = resolveProviderCredentials({ ...settings, provider: found.call.provider }); } catch (e: any) { return res.status(400).json({ error: e?.message }); }
    try {
      const audio = await provider.fetchRecording(creds, found.call.recordingUrl);
      res.setHeader("Content-Type", audio.contentType);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `inline; filename="call-${found.call.id}.${/wav/.test(audio.contentType) ? "wav" : "mp3"}"`);
      res.send(audio.body);
    } catch (e: any) {
      res.status(502).json({ error: e?.message || "Could not load the recording" });
    }
  } catch (err) { fail(res, err); }
});

router.post("/api/calling/calls", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const settings = await getCallingSettings(businessAccountId);
    if (!settings.enabled) return res.status(400).json({ error: "Turn on AI Calling in settings before calling someone." });
    let leadId: string | null = null;
    let leadName: string | null = null;
    let rawPhone: unknown = body.phone;
    if (typeof body.leadId === "string" && body.leadId) {
      const [lead] = await db.select().from(leads).where(and(eq(leads.id, body.leadId), eq(leads.businessAccountId, businessAccountId))).limit(1);
      if (!lead) return res.status(404).json({ error: "Lead not found" });
      leadId = lead.id;
      leadName = lead.name;
      if (!rawPhone) rawPhone = lead.phone;
    }
    const phone = normalizeCallPhone(rawPhone);
    if (!phone) return res.status(400).json({ error: "Enter a valid phone number with the country code (for example +91 98765 43210)." });
    if (await isDoNotCall(businessAccountId, phone)) return res.status(400).json({ error: "This number is on your do-not-call list. Remove it from the list first if they now want a call." });
    const open = await findOpenCall(businessAccountId, phone);
    if (open) return res.status(409).json({ error: "A call to this number is already waiting or in progress.", call: toCallView(open, leadName) });
    const { limit, source } = await effectiveMinuteLimit(settings);
    if (limit !== null && (await minutesThisMonth(businessAccountId)) >= limit) {
      return res.status(400).json({ error: source === "super_admin" ? "This month's calling minutes (set by your plan) are used up." : "This month's calling minute limit is reached. Raise it in AI Calling settings." });
    }
    const now = new Date();
    const scheduledAt = nextAllowedTime(now, effectiveHours(settings));
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
    const call = await enqueueCall({
      businessAccountId, phone, trigger: "manual", provider: settings.provider, leadId, scheduledAt, requestedBy: req.user!.id,
      metadata: { rootTrigger: "manual", ...(name ? { name } : {}), ...(note ? { note } : {}) },
    });
    const later = scheduledAt.getTime() > now.getTime();
    await recordAuditEventSafely(req, { action: "ai_calling.manual_call", outcome: "success", businessAccountId, resourceType: "ai_call", resourceId: call.id, metadata: { scheduledLater: later } });
    if (!later) kickDialer();
    res.status(201).json({
      call: toCallView(call, leadName || name || null),
      scheduledAt: scheduledAt.toISOString(),
      message: later ? `It's outside your calling hours, so the call will be placed at the start of the next calling window.` : "Calling now.",
    });
  } catch (err) { fail(res, err, "Could not start the call"); }
});

router.post("/api/calling/calls/:id/cancel", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const [row] = await db.update(aiCalls)
      .set({ status: "cancelled", endReason: "cancelled", endedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(aiCalls.id, req.params.id), eq(aiCalls.businessAccountId, businessAccountId), eq(aiCalls.status, "queued")))
      .returning();
    if (!row) {
      const found = await loadCall(businessAccountId, req.params.id);
      if (!found) return res.status(404).json({ error: "Call not found" });
      return res.status(409).json({ error: "Only calls that are still waiting can be cancelled." });
    }
    await recordAuditEventSafely(req, { action: "ai_calling.call_cancelled", outcome: "success", businessAccountId, resourceType: "ai_call", resourceId: row.id });
    const found = await loadCall(businessAccountId, row.id);
    res.json({ call: toCallView(row, found?.leadName ?? null) });
  } catch (err) { fail(res, err); }
});

// ── do-not-call ──────────────────────────────────────────────────────────────

const dncView = (r: typeof aiCallDoNotCall.$inferSelect) => ({
  id: r.id, phone: r.phone, reason: r.reason, source: r.source, callId: r.callId, createdAt: iso(r.createdAt),
});

router.get("/api/calling/do-not-call", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const search = typeof req.query.search === "string" ? req.query.search.replace(/[^\d+]/g, "").slice(0, 20) : "";
    const where = search
      ? and(eq(aiCallDoNotCall.businessAccountId, businessAccountId), ilike(aiCallDoNotCall.phone, `%${search}%`))
      : eq(aiCallDoNotCall.businessAccountId, businessAccountId);
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(aiCallDoNotCall).where(where).orderBy(desc(aiCallDoNotCall.createdAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(aiCallDoNotCall).where(where),
    ]);
    res.json({ items: rows.map(dncView), total: Number(total) });
  } catch (err) { fail(res, err); }
});

router.post("/api/calling/do-not-call", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const phone = normalizeCallPhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: "Enter a valid phone number with the country code." });
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 300) || null : null;
    const created = await addDoNotCall(businessAccountId, phone, { reason, source: "staff", createdBy: req.user!.id });
    const [row] = created ? [created] : await db.select().from(aiCallDoNotCall)
      .where(and(eq(aiCallDoNotCall.businessAccountId, businessAccountId), eq(aiCallDoNotCall.phone, phone))).limit(1);
    await recordAuditEventSafely(req, { action: "ai_calling.do_not_call_added", outcome: "success", businessAccountId, resourceType: "ai_call_do_not_call", resourceId: row?.id ?? null });
    res.status(created ? 201 : 200).json({ item: row ? dncView(row) : null, alreadyListed: !created });
  } catch (err) { fail(res, err); }
});

router.delete("/api/calling/do-not-call/:id", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const rows = await db.delete(aiCallDoNotCall)
      .where(and(eq(aiCallDoNotCall.id, req.params.id), eq(aiCallDoNotCall.businessAccountId, businessAccountId))).returning({ id: aiCallDoNotCall.id });
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    await recordAuditEventSafely(req, { action: "ai_calling.do_not_call_removed", outcome: "success", businessAccountId, resourceType: "ai_call_do_not_call", resourceId: req.params.id });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// ── stats ────────────────────────────────────────────────────────────────────

router.get("/api/calling/stats", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    // Default: the last 30 days, no upper bound (so calls created "just now" always count).
    const to = parseDate(req.query.to);
    const from = parseDate(req.query.from) ?? new Date((to ?? new Date()).getTime() - 30 * 86_400_000);
    const settings = await getCallingSettings(businessAccountId);
    const tz = effectiveHours(settings).timezone;
    const range = and(eq(aiCalls.businessAccountId, businessAccountId), gte(aiCalls.createdAt, from), ...(to ? [lt(aiCalls.createdAt, to)] : []));
    const [totals] = await db.select({
      total: sql<number>`COUNT(*)::int`,
      answered: sql<number>`COUNT(*) FILTER (WHERE ${aiCalls.answeredAt} IS NOT NULL)::int`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${aiCalls.status} = 'completed')::int`,
      noAnswer: sql<number>`COUNT(*) FILTER (WHERE ${aiCalls.status} IN ('no_answer', 'busy'))::int`,
      interested: sql<number>`COUNT(*) FILTER (WHERE ${aiCalls.outcome} = 'interested')::int`,
      callbacks: sql<number>`COUNT(*) FILTER (WHERE ${aiCalls.outcome} = 'callback_requested')::int`,
      doNotCall: sql<number>`COUNT(*) FILTER (WHERE ${aiCalls.outcome} = 'do_not_call')::int`,
      billedSeconds: sql<number>`COALESCE(SUM(${aiCalls.billedSeconds}), 0)::int`,
      avgDurationSec: sql<number>`COALESCE(ROUND(AVG(${aiCalls.durationSec}) FILTER (WHERE ${aiCalls.answeredAt} IS NOT NULL)), 0)::int`,
    }).from(aiCalls).where(range);
    const dayExpr = sql<string>`to_char((${aiCalls.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;
    const byDay = await db.select({
      date: dayExpr,
      calls: sql<number>`COUNT(*)::int`,
      answered: sql<number>`COUNT(*) FILTER (WHERE ${aiCalls.answeredAt} IS NOT NULL)::int`,
    }).from(aiCalls).where(range).groupBy(sql`1`).orderBy(sql`1`); // by ordinal: the time zone is a bound parameter
    res.json({
      total: Number(totals?.total ?? 0),
      answered: Number(totals?.answered ?? 0),
      completed: Number(totals?.completed ?? 0),
      noAnswer: Number(totals?.noAnswer ?? 0),
      interested: Number(totals?.interested ?? 0),
      callbacks: Number(totals?.callbacks ?? 0),
      doNotCall: Number(totals?.doNotCall ?? 0),
      minutes: Math.ceil(Number(totals?.billedSeconds ?? 0) / 60),
      avgDurationSec: Number(totals?.avgDurationSec ?? 0),
      byDay: byDay.map((d) => ({ date: d.date, calls: Number(d.calls), answered: Number(d.answered) })),
    });
  } catch (err) { fail(res, err, "Could not load call statistics"); }
});

// ── simulator ────────────────────────────────────────────────────────────────

router.get("/api/calling/simulator/incoming", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const rows = await db.select({ id: aiCalls.id, phone: aiCalls.phone, trigger: aiCalls.trigger, createdAt: aiCalls.createdAt, metadata: aiCalls.metadata, leadName: leads.name })
      .from(aiCalls).leftJoin(leads, eq(leads.id, aiCalls.leadId))
      .where(and(eq(aiCalls.businessAccountId, businessAccountId), eq(aiCalls.provider, "simulator"), eq(aiCalls.direction, "outbound"), eq(aiCalls.status, "ringing")))
      .orderBy(aiCalls.createdAt).limit(10);
    res.json({
      calls: rows.map((r) => ({
        id: r.id, phone: r.phone, trigger: r.trigger, createdAt: iso(r.createdAt),
        leadName: r.leadName ?? ((r.metadata as any)?.name ? String((r.metadata as any).name) : null),
      })),
    });
  } catch (err) { fail(res, err); }
});

router.post("/api/calling/simulator/:id/decline", ...requireAiCalling, async (req, res) => {
  const businessAccountId = bizOf(req);
  try {
    const [row] = await db.update(aiCalls)
      .set({ status: "no_answer", endReason: "declined", endedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(aiCalls.id, req.params.id), eq(aiCalls.businessAccountId, businessAccountId), eq(aiCalls.provider, "simulator"), eq(aiCalls.status, "ringing")))
      .returning();
    if (!row) return res.status(409).json({ error: "This call is no longer ringing." });
    const { processFinishedCall } = await import("../services/calling/callLifecycle");
    await processFinishedCall(row.id);
    const found = await loadCall(businessAccountId, row.id);
    res.json({ call: found ? toCallView(found.call, found.leadName) : toCallView(row, null) });
  } catch (err) { fail(res, err); }
});

// ── super admin ──────────────────────────────────────────────────────────────

async function superAdminView(businessAccountId: string) {
  const [biz] = await db.select({ id: businessAccounts.id, enabled: businessAccounts.aiCallingEnabled }).from(businessAccounts)
    .where(eq(businessAccounts.id, businessAccountId)).limit(1);
  if (!biz) return null;
  const settings = await getCallingSettings(businessAccountId);
  return {
    businessAccountId,
    enabled: biz.enabled === "true",
    monthlyMinuteCap: await getSuperAdminMinuteCap(businessAccountId),
    minutesThisMonth: await minutesThisMonth(businessAccountId),
    settingsEnabled: settings.enabled,
    provider: settings.provider,
  };
}

router.get("/api/super-admin/ai-calling/:businessAccountId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const view = await superAdminView(req.params.businessAccountId);
    if (!view) return res.status(404).json({ error: "Business account not found" });
    res.json(view);
  } catch (err) { fail(res, err); }
});

router.put("/api/super-admin/ai-calling/:businessAccountId", requireAuth, requireRole("super_admin"), async (req, res) => {
  const businessAccountId = req.params.businessAccountId;
  try {
    const before = await superAdminView(businessAccountId);
    if (!before) return res.status(404).json({ error: "Business account not found" });
    const body = (req.body || {}) as Record<string, unknown>;
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
    if (body.monthlyMinuteCap !== undefined) {
      const cap = body.monthlyMinuteCap === null || body.monthlyMinuteCap === "" ? null : Number(body.monthlyMinuteCap);
      await setSuperAdminMinuteCap(businessAccountId, cap);
    }
    if (typeof body.enabled === "boolean") {
      await db.update(businessAccounts).set({ aiCallingEnabled: body.enabled ? "true" : "false" }).where(eq(businessAccounts.id, businessAccountId));
    }
    const after = await superAdminView(businessAccountId);
    await recordAuditEventSafely(req, {
      action: "ai_calling.super_admin_updated", outcome: "success", businessAccountId, resourceType: "business_account", resourceId: businessAccountId,
      metadata: { previousEnabled: before.enabled, newEnabled: after!.enabled, previousCap: before.monthlyMinuteCap, newCap: after!.monthlyMinuteCap },
    });
    res.json(after);
  } catch (err) { fail(res, err); }
});

export default router;
