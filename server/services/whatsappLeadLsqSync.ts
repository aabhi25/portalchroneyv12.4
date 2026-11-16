/**
 * WhatsApp leads → LeadSquared, with the account's own LeadSquared connection (API or UDS) and
 * field mappings, the same ones website leads use.
 *
 * When ("Auto-sync to LeadSquared" on WhatsApp → Number & connection):
 *   - a new WhatsApp lead is sent once the chat has been quiet for QUIET_MINUTES, so the journey
 *     can collect the name, course etc. first (leads older than AUTO_WINDOW_DAYS are only sent
 *     with "Sync all", so switching it on doesn't push old history);
 *   - a lead that got new details after it was sent (journey answers, a name) is sent again when
 *     the fields it would send changed; LeadSquared updates the existing lead;
 *   - failures are retried on the website schedule (leadsquaredRetryWorker delays).
 * Sync / Retry on a lead and "Sync all to CRM" send leads by hand whether or not the switch is on.
 *
 * Connection and field mappings: the website ones, or WhatsApp's own when the LeadSquared settings
 * say so (leadsquaredWaConnection / leadsquaredWaMappings = 'own'; see whatsappLsqConnection).
 *
 * Mapping context: lead.name / phone / email / whatsapp, lead.channel = "WhatsApp", the page and
 * UTM of the website WhatsApp button the student came from (hand-off), and the details collected
 * on WhatsApp as journey.<field key> and journey.<default CRM field key>.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { trackTimer } from "../lib/lifecycle";
import { reportError } from "../lib/errorReporter";
import { whatsappLeadFields, whatsappLeads, whatsappSettings, type WidgetSettings } from "@shared/schema";
import { stableStringify } from "@shared/settingsCopy";
import { LSQ_MAX_RETRY_COUNT, LSQ_PENDING_TIMEOUT_MS, getNextRetryDelay } from "./leadsquaredRetryWorker";
import type { LeadDataContext } from "./leadsquaredService";

export const QUIET_MINUTES = 5;
export const AUTO_WINDOW_DAYS = 7;
const BATCH = 50;
const CHECK_INTERVAL_MS = 2 * 60_000;

/**
 * auto:   a new lead (never attempted).
 * update: a synced lead whose details changed since.
 * retry:  a failed lead whose retry is due, or a stale claim.
 * manual: Sync / Sync all — anything not synced and not being sent, with a fresh retry budget.
 */
export type WaLsqMode = "auto" | "update" | "retry" | "manual";

export interface WaLsqResult {
  success: boolean;
  skipped?: "not_found" | "not_configured" | "not_eligible" | "already_synced" | "in_progress" | "not_due" | "unchanged" | "switched_off";
  status: string | null;
  message: string;
}

type WaLead = typeof whatsappLeads.$inferSelect;

const ts = (d: Date) => d.toISOString();

/** The LeadSquared connection WhatsApp leads use: the website one, or WhatsApp's own. */
export function whatsappLsqConnection(settings: WidgetSettings | null | undefined): WidgetSettings | null {
  if (!settings) return null;
  if (settings.leadsquaredWaConnection !== "own") return settings;
  return {
    ...settings,
    leadsquaredEnabled: "true",
    leadsquaredConnectionType: settings.leadsquaredWaConnectionType === "api" ? "api" : "uds",
    leadsquaredUdsWebhookUrl: settings.leadsquaredWaUdsWebhookUrl,
    leadsquaredUdsKey: settings.leadsquaredWaUdsKey,
    leadsquaredAccessKey: settings.leadsquaredWaAccessKey,
    leadsquaredSecretKey: settings.leadsquaredWaSecretKey,
    leadsquaredRegion: settings.leadsquaredWaRegion,
    leadsquaredCustomHost: settings.leadsquaredWaCustomHost,
  };
}

/** Which field mappings WhatsApp leads use. */
export const whatsappLsqMappingsChannel = (settings: WidgetSettings | null | undefined): "website" | "whatsapp" =>
  settings?.leadsquaredWaMappings === "own" ? "whatsapp" : "website";

/** Whether WhatsApp leads of this account can be sent to LeadSquared at all. */
export async function whatsappLsqConfigured(businessAccountId: string): Promise<boolean> {
  const { isLeadSquaredConfigured } = await import("./crmLeadSync");
  return isLeadSquaredConfigured(whatsappLsqConnection(await storage.getWidgetSettings(businessAccountId)) as any);
}

/** "919876543210" → "+919876543210" so the mapping's country-code formatting recognises it. */
function phoneForCrm(raw: string | null | undefined): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits.length > 10 ? `+${digits}` : digits;
}

async function buildContext(lead: WaLead): Promise<LeadDataContext> {
  const extracted = (lead.extractedData as Record<string, any>) || {};
  const fields = await db.select({ key: whatsappLeadFields.fieldKey, crmKey: whatsappLeadFields.defaultCrmFieldKey })
    .from(whatsappLeadFields).where(eq(whatsappLeadFields.businessAccountId, lead.businessAccountId));
  const journey: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(extracted)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    const text = String(value).trim();
    if (!text) continue;
    journey[key] = text;
    const crmKey = fields.find((f) => f.key === key)?.crmKey?.trim();
    if (crmKey && !journey[crmKey]) journey[crmKey] = text;
  }
  // The website page the student clicked WhatsApp on, when they came through a hand-off.
  const { getLinkedHandoff } = await import("./whatsappHandoffService");
  const handoff = lead.senderPhone ? await getLinkedHandoff(lead.businessAccountId, lead.senderPhone, null).catch(() => null) : null;
  const businessAccount = await storage.getBusinessAccount(lead.businessAccountId);
  const pick = (...keys: string[]) => keys.map((k) => extracted[k]).find((v) => typeof v === "string" && v.trim()) as string | undefined;
  return {
    lead: {
      name: lead.customerName || pick("name", "customer_name", "full_name") || lead.senderName || null,
      email: lead.customerEmail || pick("email", "customer_email") || null,
      phone: phoneForCrm(lead.customerPhone || pick("phone", "customer_phone", "mobile") || lead.senderPhone),
      whatsapp: phoneForCrm(lead.senderPhone),
      createdAt: lead.receivedAt || lead.createdAt || null,
      sourceUrl: handoff?.pageUrl || null,
      channel: "WhatsApp",
    },
    session: {
      city: pick("city", "customer_city") || null,
      utmCampaign: null,
      utmSource: "whatsapp",
      utmMedium: "whatsapp",
      pageUrl: handoff?.pageUrl || null,
    },
    business: { name: businessAccount?.name || null, website: businessAccount?.website || null },
    journey,
  };
}

/** Whether this account sends WhatsApp leads to LeadSquared by itself. */
async function autoSyncOn(businessAccountId: string): Promise<boolean> {
  const [row] = await db.select({ on: whatsappSettings.autoSyncToLeadsquared }).from(whatsappSettings)
    .where(eq(whatsappSettings.businessAccountId, businessAccountId)).limit(1);
  return row?.on === "true";
}

/** Atomically move the lead to 'pending'. Returns the retry count it had, or null when not claimable. */
async function claim(leadId: string, mode: WaLsqMode): Promise<number | null> {
  const now = new Date();
  const deadline = new Date(now.getTime() + LSQ_PENDING_TIMEOUT_MS);
  const res = await db.execute(sql`
    UPDATE whatsapp_leads
    SET leadsquared_sync_status = 'pending',
        leadsquared_next_retry_at = ${ts(deadline)},
        leadsquared_retry_count = CASE WHEN ${mode === "manual"}::boolean THEN 0 ELSE leadsquared_retry_count END
    WHERE id = ${leadId}
      AND (
        (${mode === "auto" || mode === "manual"}::boolean AND COALESCE(leadsquared_sync_status, '') = '')
        OR (${mode === "update"}::boolean AND leadsquared_sync_status = 'synced')
        OR (${mode === "retry"}::boolean
            AND leadsquared_sync_status IN ('failed', 'pending')
            AND (leadsquared_next_retry_at IS NULL OR leadsquared_next_retry_at <= ${ts(now)})
            AND leadsquared_retry_count < ${LSQ_MAX_RETRY_COUNT})
        OR (${mode === "manual"}::boolean
            AND (leadsquared_sync_status IN ('failed', 'needs_attention', 'permanently_failed')
                 OR (leadsquared_sync_status = 'pending'
                     AND (leadsquared_next_retry_at IS NULL OR leadsquared_next_retry_at <= ${ts(now)}))))
      )
    RETURNING leadsquared_retry_count AS retry_count
  `);
  const row = (res.rows as any[])[0];
  return row ? Number(row.retry_count) || 0 : null;
}

async function recordFailure(leadId: string, mode: WaLsqMode, retryCount: number, message: string): Promise<string> {
  const { classifyLeadsquaredError } = await import("./leadsquaredService");
  let patch: Partial<WaLead>;
  if (classifyLeadsquaredError(message) === "permanent") {
    patch = { leadsquaredSyncStatus: "needs_attention", leadsquaredSyncError: message, leadsquaredRetryCount: retryCount + (mode === "retry" ? 1 : 0), leadsquaredNextRetryAt: null };
  } else if (mode === "retry") {
    const next = retryCount + 1;
    patch = next >= LSQ_MAX_RETRY_COUNT
      ? { leadsquaredSyncStatus: "permanently_failed", leadsquaredSyncError: message, leadsquaredRetryCount: next, leadsquaredNextRetryAt: null }
      : { leadsquaredSyncStatus: "failed", leadsquaredSyncError: message, leadsquaredRetryCount: next, leadsquaredNextRetryAt: new Date(Date.now() + getNextRetryDelay(next)) };
  } else {
    patch = { leadsquaredSyncStatus: "failed", leadsquaredSyncError: message, leadsquaredRetryCount: 0, leadsquaredNextRetryAt: new Date(Date.now() + 60_000) };
  }
  await db.update(whatsappLeads).set(patch).where(and(eq(whatsappLeads.id, leadId), eq(whatsappLeads.leadsquaredSyncStatus, "pending")));
  return patch.leadsquaredSyncStatus!;
}

export async function syncWhatsappLeadToLeadSquared(
  leadId: string,
  opts: { mode: WaLsqMode; source?: string; businessAccountId?: string },
): Promise<WaLsqResult> {
  const log = `[WhatsAppLSQ:${opts.source || opts.mode}]`;
  const conds = [eq(whatsappLeads.id, leadId)];
  if (opts.businessAccountId) conds.push(eq(whatsappLeads.businessAccountId, opts.businessAccountId));
  const [lead] = await db.select().from(whatsappLeads).where(and(...conds)).limit(1);
  if (!lead) return { success: false, skipped: "not_found", status: null, message: "Lead not found" };
  if (lead.status === "message_only") return { success: false, skipped: "not_eligible", status: lead.leadsquaredSyncStatus, message: "This is a message, not a lead" };
  const { isQualificationRequired } = await import("./leadQualificationService");
  if (!lead.qualifiedAt && (await isQualificationRequired(lead.businessAccountId))) {
    return { success: false, skipped: "not_eligible", status: lead.leadsquaredSyncStatus, message: "This lead is still a draft (PAN and email needed)" };
  }

  const widget = await storage.getWidgetSettings(lead.businessAccountId);
  const settings = whatsappLsqConnection(widget);
  const { isLeadSquaredConfigured } = await import("./crmLeadSync");
  if (!isLeadSquaredConfigured(settings as any)) {
    if (opts.mode === "retry" && (lead.leadsquaredSyncStatus === "failed" || lead.leadsquaredSyncStatus === "pending")) {
      await db.update(whatsappLeads).set({
        leadsquaredSyncStatus: "needs_attention",
        leadsquaredSyncError: "LeadSquared is off or its credentials are missing for this account",
        leadsquaredNextRetryAt: null,
      }).where(and(eq(whatsappLeads.id, leadId), inArray(whatsappLeads.leadsquaredSyncStatus, ["failed", "pending"])));
      return { success: false, skipped: "not_configured", status: "needs_attention", message: "LeadSquared is not enabled/configured" };
    }
    return { success: false, skipped: "not_configured", status: lead.leadsquaredSyncStatus, message: "LeadSquared is not enabled/configured" };
  }
  if ((opts.mode === "auto" || opts.mode === "update") && !(await autoSyncOn(lead.businessAccountId))) {
    return { success: false, skipped: "switched_off", status: lead.leadsquaredSyncStatus, message: "Auto-sync to LeadSquared is off for WhatsApp" };
  }
  if (lead.leadsquaredSyncStatus === "synced" && opts.mode !== "update") {
    return { success: true, skipped: "already_synced", status: "synced", message: "Lead is already synced to LeadSquared" };
  }

  const { createLeadSquaredServiceFromSettings } = await import("./leadsquaredService");
  const service = await createLeadSquaredServiceFromSettings(settings!);
  if (!service) return { success: false, skipped: "not_configured", status: lead.leadsquaredSyncStatus, message: "LeadSquared credentials not configured" };
  const fieldMappings = await storage.getLeadsquaredFieldMappings(lead.businessAccountId, whatsappLsqMappingsChannel(widget));
  const context = await buildContext(lead);

  if (opts.mode === "update") {
    // Only when the fields it would send changed; otherwise just note that it was checked.
    const fields = Object.fromEntries(service.buildAttributesFromMappings(fieldMappings, context).map((a) => [a.Attribute, a.Value]));
    if (stableStringify(fields) === stableStringify(lead.leadsquaredSyncPayload ?? {})) {
      await db.update(whatsappLeads).set({ leadsquaredNextRetryAt: new Date() })
        .where(and(eq(whatsappLeads.id, leadId), eq(whatsappLeads.leadsquaredSyncStatus, "synced")));
      return { success: true, skipped: "unchanged", status: "synced", message: "Nothing new to send" };
    }
  }

  const retryCount = await claim(leadId, opts.mode);
  if (retryCount === null) {
    const [current] = await db.select({ status: whatsappLeads.leadsquaredSyncStatus }).from(whatsappLeads).where(eq(whatsappLeads.id, leadId)).limit(1);
    const status = current?.status ?? null;
    const skipped = status === "synced" ? "already_synced" : status === "pending" ? "in_progress" : "not_due";
    return {
      success: status === "synced", skipped, status,
      message: skipped === "already_synced" ? "Lead is already synced to LeadSquared" : skipped === "in_progress" ? "A LeadSquared sync for this lead is already in progress" : "Lead is not due for a LeadSquared retry",
    };
  }

  try {
    const result = await service.createLeadWithMappings(fieldMappings, context);
    if (result.success) {
      await db.update(whatsappLeads).set({
        leadsquaredSyncStatus: "synced",
        leadsquaredSyncedAt: new Date(),
        ...(result.leadId ? { leadsquaredLeadId: result.leadId } : {}),
        leadsquaredSyncError: null,
        leadsquaredSyncPayload: result.syncPayload || null,
        leadsquaredRetryCount: 0,
        leadsquaredNextRetryAt: null,
      }).where(and(eq(whatsappLeads.id, leadId), eq(whatsappLeads.leadsquaredSyncStatus, "pending")));
      console.log(`${log} Lead ${leadId} synced`);
      return { success: true, status: "synced", message: result.message || "Synced to LeadSquared" };
    }
    const status = await recordFailure(leadId, opts.mode, retryCount, result.message);
    console.warn(`${log} Lead ${leadId} → ${status}: ${result.message}`);
    return { success: false, status, message: result.message };
  } catch (err: any) {
    const message = err?.message || "LeadSquared sync failed";
    const status = await recordFailure(leadId, opts.mode, retryCount, message);
    console.error(`${log} Lead ${leadId} error → ${status}`);
    return { success: false, status, message };
  }
}

/** WhatsApp leads received in [from, to) that are not in LeadSquared yet (for the group "Sync unsynced" dialog). */
export async function unsyncedWhatsappLeads(businessAccountId: string, from: Date, to: Date) {
  const { isQualificationRequired } = await import("./leadQualificationService");
  const draftsOut = await isQualificationRequired(businessAccountId);
  return db.select({
    id: whatsappLeads.id,
    name: whatsappLeads.customerName,
    senderName: whatsappLeads.senderName,
    phone: whatsappLeads.customerPhone,
    senderPhone: whatsappLeads.senderPhone,
    email: whatsappLeads.customerEmail,
    receivedAt: whatsappLeads.receivedAt,
    status: whatsappLeads.leadsquaredSyncStatus,
    error: whatsappLeads.leadsquaredSyncError,
    retryCount: whatsappLeads.leadsquaredRetryCount,
  }).from(whatsappLeads).where(and(
    eq(whatsappLeads.businessAccountId, businessAccountId),
    sql`${whatsappLeads.status} <> 'message_only'`,
    sql`(${whatsappLeads.leadsquaredSyncStatus} IS NULL OR ${whatsappLeads.leadsquaredSyncStatus} NOT IN ('synced', 'pending'))`,
    sql`${whatsappLeads.receivedAt} >= ${ts(from)} AND ${whatsappLeads.receivedAt} < ${ts(to)}`,
    ...(draftsOut ? [sql`${whatsappLeads.qualifiedAt} IS NOT NULL`] : []),
  )).orderBy(whatsappLeads.receivedAt);
}

/** "Sync all to CRM": every WhatsApp lead of the account not yet in LeadSquared (oldest first). */
export async function syncAllWhatsappLeadsToLeadSquared(businessAccountId: string, limit = 500) {
  const rows = await db.select({ id: whatsappLeads.id }).from(whatsappLeads)
    .where(and(
      eq(whatsappLeads.businessAccountId, businessAccountId),
      sql`${whatsappLeads.status} <> 'message_only'`,
      sql`(${whatsappLeads.leadsquaredSyncStatus} IS NULL OR ${whatsappLeads.leadsquaredSyncStatus} NOT IN ('synced', 'pending'))`,
    ))
    .orderBy(whatsappLeads.receivedAt)
    .limit(limit);
  const out = { synced: 0, failed: 0, skipped: 0 };
  for (const { id } of rows) {
    const r = await syncWhatsappLeadToLeadSquared(id, { mode: "manual", source: "bulk", businessAccountId });
    if (r.success && !r.skipped) out.synced++;
    else if (r.skipped) out.skipped++;
    else out.failed++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

/** One pass: new leads, changed leads, due retries. Returns how many leads it looked at. */
export async function runWhatsappLsqSyncOnce(now = new Date()): Promise<number> {
  const quiet = ts(new Date(now.getTime() - QUIET_MINUTES * 60_000));
  const windowStart = ts(new Date(now.getTime() - AUTO_WINDOW_DAYS * 24 * 3600_000));
  const res = await db.execute(sql`
    (SELECT w.id, 'auto' AS mode FROM whatsapp_leads w
      JOIN whatsapp_settings s ON s.business_account_id = w.business_account_id AND s.auto_sync_to_leadsquared = 'true'
      WHERE COALESCE(w.leadsquared_sync_status, '') = '' AND w.status <> 'message_only'
        AND w.received_at >= ${windowStart}
        AND GREATEST(w.updated_at, COALESCE(w.last_message_at, w.updated_at)) <= ${quiet}
      ORDER BY w.received_at LIMIT ${BATCH})
    UNION ALL
    (SELECT w.id, 'update' AS mode FROM whatsapp_leads w
      JOIN whatsapp_settings s ON s.business_account_id = w.business_account_id AND s.auto_sync_to_leadsquared = 'true'
      WHERE w.leadsquared_sync_status = 'synced' AND w.leadsquared_synced_at >= ${windowStart}
        AND GREATEST(w.updated_at, COALESCE(w.last_message_at, w.updated_at))
            > COALESCE(w.leadsquared_next_retry_at, w.leadsquared_synced_at) + interval '1 minute'
        AND GREATEST(w.updated_at, COALESCE(w.last_message_at, w.updated_at)) <= ${quiet}
      ORDER BY w.leadsquared_synced_at LIMIT ${BATCH})
    UNION ALL
    (SELECT w.id, 'retry' AS mode FROM whatsapp_leads w
      WHERE w.leadsquared_sync_status IN ('failed', 'pending')
        AND (w.leadsquared_next_retry_at IS NULL OR w.leadsquared_next_retry_at <= ${ts(now)})
        AND w.leadsquared_retry_count < ${LSQ_MAX_RETRY_COUNT}
      ORDER BY w.leadsquared_next_retry_at NULLS FIRST LIMIT ${BATCH})
  `);
  const rows = res.rows as { id: string; mode: WaLsqMode }[];
  for (const row of rows) {
    try {
      await syncWhatsappLeadToLeadSquared(row.id, { mode: row.mode, source: `worker-${row.mode}` });
    } catch (err) {
      console.error(`[WhatsAppLSQ] Lead ${row.id} (${row.mode}) failed:`, err);
    }
  }
  return rows.length;
}

class WhatsappLsqSyncWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private busy = false;

  start() {
    if (this.intervalId) return;
    console.log("[WhatsAppLSQ] Starting worker (every 2 min)");
    this.intervalId = trackTimer(setInterval(() => this.tick(), CHECK_INTERVAL_MS));
    trackTimer(setTimeout(() => this.tick(), 45_000));
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await runWhatsappLsqSyncOnce();
    } catch (err) {
      console.error("[WhatsAppLSQ] Worker run failed:", err);
      reportError(err, { source: "worker:whatsapp-lsq-sync" });
    } finally {
      this.busy = false;
    }
  }
}

export const whatsappLsqSyncWorker = new WhatsappLsqSyncWorker();
