/**
 * CRM sync for Instagram / Facebook leads (instagram_leads, facebook_leads).
 *
 * Reuses the website/WhatsApp building blocks:
 *   - LeadSquared: the account's LeadSquared field mappings + createLeadWithMappings, the
 *     same status/retry columns and retry schedule as website leads (leadsquaredRetryWorker).
 *   - Salesforce: the account's Salesforce field mappings + createLeadWithMappings. Like
 *     website leads there is no automatic Salesforce retry; failures are retried with Sync.
 *   - Custom CRM: the account's custom CRM field mappings + syncLead, and the WhatsApp
 *     claim/retry protocol (custom_crm_sync_payload._crmSync, crmSyncRecoveryWorker).
 *
 * Every push first claims the lead with a single conditional UPDATE, so a lead is pushed by
 * at most one caller at a time (duplicate webhooks, the retry worker on several instances,
 * a manual Sync click) and never again once it is synced.
 *
 * Logs carry lead ids and statuses only — never names, phones, emails or payloads.
 */
import crypto from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  customCrmFieldMappings,
  customCrmSettings,
  facebookLeads,
  instagramLeads,
  type CustomCrmSettings,
} from "@shared/schema";
import {
  SOCIAL_CHANNEL_LABEL,
  SOCIAL_LEAD_TABLE,
  hasReachableContact,
  socialLeadContact,
  type SocialChannel,
} from "./socialLeadFields";
import {
  LSQ_MAX_RETRY_COUNT,
  LSQ_PENDING_TIMEOUT_MS,
  getNextRetryDelay,
} from "./leadsquaredRetryWorker";

export type SocialCrm = "leadsquared" | "salesforce" | "custom_crm";
export const SOCIAL_CRMS: SocialCrm[] = ["leadsquared", "salesforce", "custom_crm"];

/**
 * auto:   lead created/updated — only leads never attempted for this CRM.
 * retry:  retry/recovery worker — only failed leads whose retry is due, or stale claims.
 * manual: Sync / Sync all from the dashboard — any lead that is not synced or in progress,
 *         with a fresh retry budget.
 */
export type SocialSyncMode = "auto" | "retry" | "manual";

export interface SocialCrmSyncResult {
  crm: SocialCrm;
  success: boolean;
  skipped?: "not_found" | "not_configured" | "not_eligible" | "already_synced" | "in_progress" | "not_due";
  status: string | null;
  message: string;
}

const SALESFORCE_CLAIM_STALE_MS = 10 * 60_000;

type SocialLeadRow = typeof instagramLeads.$inferSelect | typeof facebookLeads.$inferSelect;

function tableFor(channel: SocialChannel) {
  return channel === "instagram" ? instagramLeads : facebookLeads;
}

function tableSql(channel: SocialChannel) {
  return sql.raw(`"${SOCIAL_LEAD_TABLE[channel]}"`);
}

/** Timestamps are `timestamp without time zone` holding UTC (drizzle writes toISOString()). */
function ts(d: Date) {
  return sql`${d.toISOString()}::timestamp`;
}

export async function loadSocialLead(channel: SocialChannel, leadId: string, businessAccountId?: string): Promise<SocialLeadRow | undefined> {
  const t = tableFor(channel);
  const where = businessAccountId ? and(eq(t.id, leadId), eq(t.businessAccountId, businessAccountId)) : eq(t.id, leadId);
  const [row] = await db.select().from(t).where(where).limit(1);
  return row;
}

function leadContactOf(channel: SocialChannel, lead: SocialLeadRow) {
  const fallbackName = channel === "facebook" ? (lead as any).senderName : (lead as any).senderUsername;
  return socialLeadContact(lead.extractedData as Record<string, any>, fallbackName);
}

function tag(crm: string, channel: SocialChannel, source: string) {
  return `[SocialLeadCRM:${crm}:${channel}:${source}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// LeadSquared
// ─────────────────────────────────────────────────────────────────────────────

async function buildLsqContext(channel: SocialChannel, lead: SocialLeadRow) {
  const contact = leadContactOf(channel, lead);
  const businessAccount = await storage.getBusinessAccount(lead.businessAccountId);
  const extracted = (lead.extractedData as Record<string, any>) || {};
  const city = typeof extracted.city === "string" ? extracted.city : null;
  return {
    lead: {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      whatsapp: null,
      createdAt: lead.receivedAt || lead.createdAt || null,
      sourceUrl: null,
      channel: SOCIAL_CHANNEL_LABEL[channel],
    },
    session: {
      city,
      utmCampaign: null,
      // The channel doubles as the traffic source so existing "UTM Source" mappings show it.
      utmSource: channel,
      utmMedium: "social",
      pageUrl: null,
    },
    business: {
      name: businessAccount?.name || null,
      website: businessAccount?.website || null,
    },
  };
}

/** Atomically move the lead to 'pending' for LeadSquared. Returns the retry count it had, or null if not claimable. */
async function claimLsq(channel: SocialChannel, leadId: string, mode: SocialSyncMode): Promise<number | null> {
  const now = new Date();
  const deadline = new Date(now.getTime() + LSQ_PENDING_TIMEOUT_MS);
  const retry = mode === "retry";
  const manual = mode === "manual";
  const res = await db.execute(sql`
    UPDATE ${tableSql(channel)}
    SET leadsquared_sync_status = 'pending',
        leadsquared_next_retry_at = ${ts(deadline)},
        leadsquared_retry_count = CASE WHEN ${manual}::boolean THEN 0 ELSE leadsquared_retry_count END,
        updated_at = ${ts(now)}
    WHERE id = ${leadId}
      AND (
        -- never attempted: every mode
        leadsquared_sync_status IS NULL OR leadsquared_sync_status = ''
        -- worker: a failed lead whose retry is due, or a claim whose holder died
        OR (${retry}::boolean
            AND leadsquared_sync_status IN ('failed', 'pending')
            AND (leadsquared_next_retry_at IS NULL OR leadsquared_next_retry_at <= ${ts(now)})
            AND leadsquared_retry_count < ${LSQ_MAX_RETRY_COUNT})
        -- manual Sync: anything not synced and not currently being pushed
        OR (${manual}::boolean
            AND (leadsquared_sync_status IN ('failed', 'needs_attention', 'permanently_failed')
                 OR (leadsquared_sync_status = 'pending'
                     AND (leadsquared_next_retry_at IS NULL OR leadsquared_next_retry_at <= ${ts(now)}))))
      )
    RETURNING leadsquared_retry_count AS retry_count
  `);
  const row = (res.rows as any[])[0];
  return row ? Number(row.retry_count) || 0 : null;
}

async function recordLsqFailure(channel: SocialChannel, leadId: string, mode: SocialSyncMode, retryCount: number, message: string): Promise<string> {
  const { classifyLeadsquaredError } = await import("./leadsquaredService");
  const t = tableFor(channel);
  let patch: Record<string, any>;
  if (classifyLeadsquaredError(message) === "permanent") {
    patch = { leadsquaredSyncStatus: "needs_attention", leadsquaredSyncError: message, leadsquaredRetryCount: retryCount + (mode === "retry" ? 1 : 0), leadsquaredNextRetryAt: null };
  } else if (mode === "retry") {
    const next = retryCount + 1;
    patch = next >= LSQ_MAX_RETRY_COUNT
      ? { leadsquaredSyncStatus: "permanently_failed", leadsquaredSyncError: message, leadsquaredRetryCount: next, leadsquaredNextRetryAt: null }
      : { leadsquaredSyncStatus: "failed", leadsquaredSyncError: message, leadsquaredRetryCount: next, leadsquaredNextRetryAt: new Date(Date.now() + getNextRetryDelay(next)) };
  } else {
    // First failure of an automatic or manual push: hand it to the retry worker with a fresh budget
    // (same as website leads).
    patch = { leadsquaredSyncStatus: "failed", leadsquaredSyncError: message, leadsquaredRetryCount: 0, leadsquaredNextRetryAt: new Date(Date.now() + 60_000) };
  }
  await db.update(t).set({ ...patch, updatedAt: new Date() }).where(and(eq(t.id, leadId), eq(t.leadsquaredSyncStatus, "pending")));
  return patch.leadsquaredSyncStatus;
}

export async function syncSocialLeadToLeadSquared(
  channel: SocialChannel,
  leadId: string,
  opts: { mode: SocialSyncMode; source?: string; businessAccountId?: string },
): Promise<SocialCrmSyncResult> {
  const crm: SocialCrm = "leadsquared";
  const log = tag("lsq", channel, opts.source || opts.mode);
  const lead = await loadSocialLead(channel, leadId, opts.businessAccountId);
  if (!lead) return { crm, success: false, skipped: "not_found", status: null, message: "Lead not found" };

  const settings = await storage.getWidgetSettings(lead.businessAccountId);
  const { isLeadSquaredConfigured } = await import("./crmLeadSync");
  if (!isLeadSquaredConfigured(settings)) {
    if (opts.mode === "retry" && (lead.leadsquaredSyncStatus === "failed" || lead.leadsquaredSyncStatus === "pending")) {
      // Park it (as website leads do) so the worker doesn't re-select it every run.
      const t = tableFor(channel);
      await db.update(t).set({
        leadsquaredSyncStatus: "needs_attention",
        leadsquaredSyncError: "LeadSquared is off or its credentials are missing for this account",
        leadsquaredNextRetryAt: null,
        updatedAt: new Date(),
      }).where(and(eq(t.id, leadId), inArray(t.leadsquaredSyncStatus, ["failed", "pending"])));
      return { crm, success: false, skipped: "not_configured", status: "needs_attention", message: "LeadSquared is not enabled/configured" };
    }
    return { crm, success: false, skipped: "not_configured", status: lead.leadsquaredSyncStatus ?? null, message: "LeadSquared is not enabled/configured" };
  }

  if (!hasReachableContact(leadContactOf(channel, lead))) {
    return { crm, success: false, skipped: "not_eligible", status: lead.leadsquaredSyncStatus ?? null, message: "Lead has no phone or email yet" };
  }
  if (lead.leadsquaredSyncStatus === "synced") {
    return { crm, success: true, skipped: "already_synced", status: "synced", message: "Lead is already synced to LeadSquared" };
  }

  const retryCount = await claimLsq(channel, leadId, opts.mode);
  if (retryCount === null) {
    const current = await loadSocialLead(channel, leadId);
    const status = current?.leadsquaredSyncStatus ?? null;
    const skipped = status === "synced" ? "already_synced" : status === "pending" ? "in_progress" : "not_due";
    return { crm, success: status === "synced", skipped, status, message: skipped === "already_synced" ? "Lead is already synced to LeadSquared" : skipped === "in_progress" ? "A LeadSquared sync for this lead is already in progress" : "Lead is not due for a LeadSquared retry" };
  }

  const t = tableFor(channel);
  try {
    const { createLeadSquaredServiceFromSettings } = await import("./leadsquaredService");
    const service = await createLeadSquaredServiceFromSettings(settings!);
    if (!service) throw new Error("LeadSquared credentials not configured");
    const fieldMappings = await storage.getLeadsquaredFieldMappings(lead.businessAccountId);
    const context = await buildLsqContext(channel, lead);
    const result = await service.createLeadWithMappings(fieldMappings, context);
    if (result.success) {
      await db.update(t).set({
        leadsquaredSyncStatus: "synced",
        leadsquaredSyncedAt: new Date(),
        ...(result.leadId ? { leadsquaredLeadId: result.leadId } : {}),
        leadsquaredSyncError: null,
        leadsquaredSyncPayload: result.syncPayload || null,
        leadsquaredRetryCount: 0,
        leadsquaredNextRetryAt: null,
        updatedAt: new Date(),
      }).where(and(eq(t.id, leadId), eq(t.leadsquaredSyncStatus, "pending")));
      console.log(`${log} Lead ${leadId} synced`);
      return { crm, success: true, status: "synced", message: result.message || "Synced to LeadSquared" };
    }
    const status = await recordLsqFailure(channel, leadId, opts.mode, retryCount, result.message);
    console.warn(`${log} Lead ${leadId} → ${status}`);
    return { crm, success: false, status, message: result.message };
  } catch (err: any) {
    const message = err?.message || "LeadSquared sync failed";
    const status = await recordLsqFailure(channel, leadId, opts.mode, retryCount, message);
    console.error(`${log} Lead ${leadId} error → ${status}`);
    return { crm, success: false, status, message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Salesforce
// ─────────────────────────────────────────────────────────────────────────────

async function claimSalesforce(channel: SocialChannel, leadId: string, mode: SocialSyncMode): Promise<boolean> {
  const now = new Date();
  const stale = new Date(now.getTime() - SALESFORCE_CLAIM_STALE_MS);
  const manual = mode === "manual";
  const res = await db.execute(sql`
    UPDATE ${tableSql(channel)}
    SET salesforce_sync_status = 'pending', salesforce_sync_started_at = ${ts(now)}, updated_at = ${ts(now)}
    WHERE id = ${leadId}
      AND (
        salesforce_sync_status IS NULL OR salesforce_sync_status = ''
        OR (${manual}::boolean AND salesforce_sync_status = 'failed')
        OR (${manual}::boolean AND salesforce_sync_status = 'pending'
            AND (salesforce_sync_started_at IS NULL OR salesforce_sync_started_at < ${ts(stale)}))
      )
    RETURNING id
  `);
  return res.rows.length > 0;
}

export async function syncSocialLeadToSalesforce(
  channel: SocialChannel,
  leadId: string,
  opts: { mode: SocialSyncMode; source?: string; businessAccountId?: string },
): Promise<SocialCrmSyncResult> {
  const crm: SocialCrm = "salesforce";
  const log = tag("sf", channel, opts.source || opts.mode);
  const lead = await loadSocialLead(channel, leadId, opts.businessAccountId);
  if (!lead) return { crm, success: false, skipped: "not_found", status: null, message: "Lead not found" };

  const settings = await storage.getWidgetSettings(lead.businessAccountId);
  const { isSalesforceConfigured } = await import("./crmLeadSync");
  if (!isSalesforceConfigured(settings)) {
    return { crm, success: false, skipped: "not_configured", status: lead.salesforceSyncStatus ?? null, message: "Salesforce is not enabled/configured" };
  }
  if (!hasReachableContact(leadContactOf(channel, lead))) {
    return { crm, success: false, skipped: "not_eligible", status: lead.salesforceSyncStatus ?? null, message: "Lead has no phone or email yet" };
  }
  if (lead.salesforceSyncStatus === "synced") {
    return { crm, success: true, skipped: "already_synced", status: "synced", message: "Lead is already synced to Salesforce" };
  }
  if (!(await claimSalesforce(channel, leadId, opts.mode))) {
    const current = await loadSocialLead(channel, leadId);
    const status = current?.salesforceSyncStatus ?? null;
    const skipped = status === "synced" ? "already_synced" : status === "pending" ? "in_progress" : "not_due";
    return { crm, success: status === "synced", skipped, status, message: skipped === "in_progress" ? "A Salesforce sync for this lead is already in progress" : skipped === "already_synced" ? "Lead is already synced to Salesforce" : "Use Sync to retry this lead" };
  }

  const t = tableFor(channel);
  const finish = (patch: Record<string, any>) =>
    db.update(t).set({ ...patch, updatedAt: new Date() }).where(and(eq(t.id, leadId), eq(t.salesforceSyncStatus, "pending")));
  try {
    const { decrypt } = await import("./encryptionService");
    const { createSalesforceService } = await import("./salesforceService");
    const service = createSalesforceService({
      clientId: settings!.salesforceClientId!,
      clientSecret: decrypt(settings!.salesforceClientSecret!),
      username: settings!.salesforceUsername!,
      password: decrypt(settings!.salesforcePassword!),
      environment: (settings!.salesforceEnvironment || "production") as "production" | "sandbox",
    });
    const fieldMappings = await storage.getSalesforceFieldMappings(lead.businessAccountId);
    const context = await buildLsqContext(channel, lead);
    const result = await service.createLeadWithMappings(fieldMappings, context);
    if (result.success) {
      await finish({ salesforceSyncStatus: "synced", salesforceSyncedAt: new Date(), salesforceLeadId: result.leadId ?? null, salesforceSyncError: null });
      console.log(`${log} Lead ${leadId} synced`);
      return { crm, success: true, status: "synced", message: result.message || "Synced to Salesforce" };
    }
    await finish({ salesforceSyncStatus: "failed", salesforceSyncError: result.message });
    console.warn(`${log} Lead ${leadId} failed`);
    return { crm, success: false, status: "failed", message: result.message };
  } catch (err: any) {
    const message = err?.message || "Salesforce sync failed";
    await finish({ salesforceSyncStatus: "failed", salesforceSyncError: message });
    console.error(`${log} Lead ${leadId} error`);
    return { crm, success: false, status: "failed", message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom CRM
// ─────────────────────────────────────────────────────────────────────────────

export function isCustomCrmReady(settings: CustomCrmSettings | undefined | null): settings is CustomCrmSettings {
  return !!settings && settings.enabled && !!settings.apiBaseUrl && !!settings.apiEndpoint;
}

export async function syncSocialLeadToCustomCrm(
  channel: SocialChannel,
  leadId: string,
  opts: { mode: SocialSyncMode; source?: string; businessAccountId?: string; requireAutoSync?: boolean },
): Promise<SocialCrmSyncResult> {
  const crm: SocialCrm = "custom_crm";
  const source = opts.source || opts.mode;
  const log = tag("custom", channel, source);
  const table = SOCIAL_LEAD_TABLE[channel];
  const lead = await loadSocialLead(channel, leadId, opts.businessAccountId);
  if (!lead) return { crm, success: false, skipped: "not_found", status: null, message: "Lead not found" };

  const [settings] = await db.select().from(customCrmSettings).where(eq(customCrmSettings.businessAccountId, lead.businessAccountId)).limit(1);
  if (!isCustomCrmReady(settings) || (opts.requireAutoSync && !settings.autoSyncEnabled)) {
    return { crm, success: false, skipped: "not_configured", status: lead.customCrmSyncStatus ?? null, message: "Custom CRM sync is not enabled/configured for this account" };
  }
  const contact = leadContactOf(channel, lead);
  if (!hasReachableContact(contact)) {
    return { crm, success: false, skipped: "not_eligible", status: lead.customCrmSyncStatus ?? null, message: "Lead has no phone or email yet" };
  }

  const svc = await import("./customCrmService");
  const claimId = crypto.randomUUID();
  const claimed = await svc.claimLeadForCrmSync(leadId, claimId, {
    force: opts.mode === "manual",
    respectBackoff: opts.mode === "retry",
    source,
    skipSynced: true,
    // Automatic triggers only start a lead that was never attempted; retries belong to the worker.
    onlyNew: opts.mode === "auto",
  }, table);
  if (!claimed) {
    const current = await loadSocialLead(channel, leadId);
    const status = current?.customCrmSyncStatus ?? null;
    const skipped = status === "synced" ? "already_synced" : status === "pending" ? "in_progress" : "not_due";
    return { crm, success: status === "synced", skipped, status, message: skipped === "already_synced" ? "Lead is already synced to the CRM" : skipped === "in_progress" ? "A CRM sync for this lead is already in progress" : "Lead is not due for a CRM retry" };
  }

  const meta: import("./customCrmService").CrmSyncMeta = { ...claimed };
  const attempts = (meta.attempts || 0) + 1;
  const nowIso = new Date().toISOString();

  // A previous push died after sending the create request: it may exist in the CRM already.
  if (meta.prevStatus === "pending" && meta.createStartedAt && !meta.created) {
    const error = "CRM_SYNC_ERROR[network_error]: a previous sync was interrupted while creating the lead — it may exist in the CRM. Check the CRM, then use Sync to push again.";
    await svc.finalizeCrmSync(leadId, claimId, {
      status: "failed", error,
      meta: { ...meta, attempts, lastAttemptAt: nowIso, createStartedAt: null, retryable: false, nextRetryAt: null, errorKind: "unknown_outcome" },
    }, table);
    console.warn(`${log} Lead ${leadId}: interrupted create detected — held for manual review`);
    return { crm, success: false, status: "failed", message: error };
  }

  try {
    const fieldMappings = await db
      .select()
      .from(customCrmFieldMappings)
      .where(eq(customCrmFieldMappings.businessAccountId, lead.businessAccountId))
      .orderBy(customCrmFieldMappings.sortOrder);

    const label = SOCIAL_CHANNEL_LABEL[channel];
    const extractedData = { ...((lead.extractedData as Record<string, any>) || {}) };
    const leadContext: import("./customCrmService").CustomCrmLeadContext = {
      lead: {
        customerName: contact.name,
        customerEmail: contact.email,
        customerPhone: contact.phone,
        senderPhone: null,
        channel: label,
      },
      extracted: {
        ...extractedData,
        channel: extractedData.channel ?? label,
        source: extractedData.source ?? label,
        ...(channel === "instagram"
          ? { sender_username: (lead as any).senderUsername ?? null }
          : { sender_name: (lead as any).senderName ?? null }),
      },
    };
    const storeCredential = await svc.resolveStoreCredentialForLead(lead.businessAccountId, extractedData);

    await svc.checkpointCrmSync(leadId, claimId, { createStartedAt: new Date().toISOString(), created: false, storeCredentialId: storeCredential?.id ?? null }, null, table);
    console.log(`${log} Lead ${leadId}: attempt ${attempts}`);
    const result = await svc.syncLead(settings, fieldMappings, leadContext, storeCredential);
    const crmLeadId = result.leadId || result.applicationId || null;
    const baseMeta = {
      ...meta, attempts, lastAttemptAt: nowIso, createStartedAt: null,
      created: result.success, leadId: result.leadId ?? null, applicationId: result.applicationId ?? null, applicantId: result.applicantId ?? null,
      storeCredentialId: storeCredential?.id ?? null,
    };

    if (result.success) {
      await svc.finalizeCrmSync(leadId, claimId, {
        status: "synced", error: null, crmLeadId, payload: result.payload,
        meta: { ...baseMeta, retryable: false, nextRetryAt: null, errorKind: null },
      }, table);
      console.log(`${log} Lead ${leadId} synced (attempt ${attempts})`);
      return { crm, success: true, status: "synced", message: result.message };
    }

    const errorKind = result.errorKind || "transient";
    const retryAt = errorKind === "transient" ? svc.nextCrmRetryAt(attempts) : null;
    let error = result.message;
    if (errorKind === "transient" && !retryAt) error = `${error} (gave up after ${attempts} attempts — use Sync to try again)`;
    await svc.finalizeCrmSync(leadId, claimId, {
      status: "failed", error, payload: result.payload,
      meta: { ...baseMeta, retryable: !!retryAt, nextRetryAt: retryAt ? retryAt.toISOString() : null, errorKind },
    }, table);
    console.warn(`${log} Lead ${leadId} failed (attempt ${attempts}, ${errorKind})${retryAt ? ` — retry at ${retryAt.toISOString()}` : " — not retrying automatically"}`);
    return { crm, success: false, status: "failed", message: error };
  } catch (err: any) {
    const error = `CRM_SYNC_ERROR[unknown]: ${err?.message || "CRM sync failed"}`;
    const retryAt = svc.nextCrmRetryAt(attempts);
    console.error(`${log} Lead ${leadId} sync error`);
    await svc.finalizeCrmSync(leadId, claimId, {
      status: "failed", error,
      meta: { ...meta, attempts, lastAttemptAt: nowIso, createStartedAt: null, retryable: !!retryAt, nextRetryAt: retryAt ? retryAt.toISOString() : null, errorKind: "transient" },
    }, table).catch(() => {});
    return { crm, success: false, status: "failed", message: error };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry points
// ─────────────────────────────────────────────────────────────────────────────

/** Which CRMs this account pushes to (and whether each one auto-syncs new leads). */
export async function socialCrmConfig(businessAccountId: string): Promise<Record<SocialCrm, { configured: boolean; autoSync: boolean }>> {
  const { isLeadSquaredConfigured, isSalesforceConfigured } = await import("./crmLeadSync");
  const settings = await storage.getWidgetSettings(businessAccountId);
  const [custom] = await db.select().from(customCrmSettings).where(eq(customCrmSettings.businessAccountId, businessAccountId)).limit(1);
  const lsq = isLeadSquaredConfigured(settings);
  const sf = isSalesforceConfigured(settings);
  const cc = isCustomCrmReady(custom);
  return {
    // For website leads, "enabled" already means "push every new lead"; same here.
    leadsquared: { configured: lsq, autoSync: lsq },
    salesforce: { configured: sf, autoSync: sf },
    custom_crm: { configured: cc, autoSync: cc && !!custom?.autoSyncEnabled },
  };
}

export function syncSocialLead(channel: SocialChannel, leadId: string, crm: SocialCrm, opts: { mode: SocialSyncMode; source?: string; businessAccountId?: string; requireAutoSync?: boolean }) {
  if (crm === "leadsquared") return syncSocialLeadToLeadSquared(channel, leadId, opts);
  if (crm === "salesforce") return syncSocialLeadToSalesforce(channel, leadId, opts);
  return syncSocialLeadToCustomCrm(channel, leadId, opts);
}

/**
 * Called when an IG/FB lead is created or gains new contact data. Pushes it to every CRM that
 * auto-syncs for the account. Safe to call repeatedly: each CRM only takes a lead it has never
 * attempted, so a duplicate trigger is a no-op.
 */
export async function autoSyncSocialLead(channel: SocialChannel, leadId: string, source = "lead_captured"): Promise<SocialCrmSyncResult[]> {
  const lead = await loadSocialLead(channel, leadId);
  if (!lead) return [];
  const config = await socialCrmConfig(lead.businessAccountId);
  const results: SocialCrmSyncResult[] = [];
  for (const crm of SOCIAL_CRMS) {
    if (!config[crm].autoSync) continue;
    try {
      results.push(await syncSocialLead(channel, leadId, crm, { mode: "auto", source, requireAutoSync: true }));
    } catch (err: any) {
      console.error(`${tag(crm, channel, source)} Lead ${leadId} auto-sync error`);
    }
  }
  return results;
}

/** Fire-and-forget hook for the lead capture paths. Never throws, never blocks the reply. */
export function triggerSocialLeadCrmSync(channel: SocialChannel, leadId: string, source = "lead_captured"): void {
  setImmediate(() => {
    autoSyncSocialLead(channel, leadId, source).catch(() => {
      console.error(`[SocialLeadCRM:${channel}] auto-sync failed for lead ${leadId}`);
    });
  });
}

/**
 * "Sync all": pushes every not-yet-synced lead of this channel to the given CRMs (manual mode),
 * one lead at a time. Leads without a phone/email are skipped.
 */
export async function syncAllSocialLeads(
  channel: SocialChannel,
  businessAccountId: string,
  crms: SocialCrm[],
  limit = 500,
): Promise<Record<SocialCrm, { synced: number; failed: number; skipped: number }>> {
  const t = tableFor(channel);
  const summary = {} as Record<SocialCrm, { synced: number; failed: number; skipped: number }>;
  for (const crm of crms) {
    const statusCol = crm === "leadsquared" ? t.leadsquaredSyncStatus : crm === "salesforce" ? t.salesforceSyncStatus : t.customCrmSyncStatus;
    const rows = await db.select({ id: t.id }).from(t)
      .where(and(eq(t.businessAccountId, businessAccountId), sql`(${statusCol} IS NULL OR ${statusCol} NOT IN ('synced', 'pending'))`))
      .orderBy(t.receivedAt)
      .limit(limit);
    const s = { synced: 0, failed: 0, skipped: 0 };
    for (const { id } of rows) {
      const r = await syncSocialLead(channel, id, crm, { mode: "manual", source: "bulk", businessAccountId });
      if (r.success && !r.skipped) s.synced++;
      else if (r.skipped) s.skipped++;
      else s.failed++;
    }
    summary[crm] = s;
  }
  return summary;
}
