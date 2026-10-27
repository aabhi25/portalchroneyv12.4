/**
 * Website leads → Meritto, for accounts with Meritto switched on.
 *
 * A background pass (every 30 s) picks the leads captured since Meritto was switched on that are
 * new, changed since their last send, or due for a retry. A lead is sent once it is ready by the
 * same rules as LeadSquared (mobile or email; mandatory fields; OTP / CAPTCHA) — a lead still
 * missing a mandatory field goes anyway once its chat has been quiet for 30 minutes. The first send
 * creates the Meritto lead (its id is kept); later sends update it, and only when what would be sent
 * changed. Sync columns are written without touching the lead's updatedAt, so a send never looks
 * like a change.
 */
import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { contactsHidden } from "@shared/contactMasking";
import { leads, merittoFieldMappings, widgetSettings, type MerittoFieldMapping, type WidgetSettings } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { decrypt } from "./encryptionService";
import { MerittoService, splitMobile, type MerittoLeadContext, type MerittoResult } from "./merittoService";

const LOOKBACK_DAYS = 7; // never sweep old leads (bulk/manual sync is for those)
const BATCH = 50;
const HELD_BACK_IDLE_MINUTES = 30;
const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 5, 15, 60, 180];
const NOT_READY_RECHECK_MINUTES = 2;

export function isMerittoConfigured(settings: Partial<WidgetSettings> | null | undefined): boolean {
  return !!settings && settings.merittoEnabled === "true" && !!settings.merittoAccessKey && !!settings.merittoSecretKey;
}

export function merittoServiceFor(settings: Partial<WidgetSettings>): MerittoService | null {
  if (!settings.merittoAccessKey || !settings.merittoSecretKey) return null;
  try {
    return new MerittoService({
      accessKey: decrypt(settings.merittoAccessKey),
      secretKey: decrypt(settings.merittoSecretKey),
      createUrl: settings.merittoCreateUrl,
      updateUrl: settings.merittoUpdateUrl,
    });
  } catch {
    return null;
  }
}

export async function getMerittoMappings(businessAccountId: string): Promise<MerittoFieldMapping[]> {
  return db.select().from(merittoFieldMappings).where(eq(merittoFieldMappings.businessAccountId, businessAccountId));
}

/** Everything a mapping can refer to, for one lead. */
async function buildContext(lead: typeof leads.$inferSelect, businessAccountId: string): Promise<MerittoLeadContext> {
  const { extractUtmCampaign, extractUtmSource, extractUtmMedium, buildJourneyCrmContext, buildConversationCrmContext } = await import("./leadsquaredService");
  const business = await storage.getBusinessAccount(businessAccountId);
  const [journey, conversation] = await Promise.all([
    buildJourneyCrmContext(lead.conversationId).catch(() => ({})),
    buildConversationCrmContext(lead.conversationId).catch(() => ({})),
  ]);
  let verified = false;
  let captchaStatus: string | null = null;
  if (lead.conversationId) {
    captchaStatus = await storage.getConversationCaptchaStatus(lead.conversationId, businessAccountId).catch(() => null);
    if (lead.phone) {
      const { normalizePhone } = await import("./otp");
      const e164 = normalizePhone(lead.phone);
      verified = e164 ? await storage.hasVerifiedOtpForConversationPhone(businessAccountId, lead.conversationId, e164).catch(() => false) : false;
    }
  }
  const mobile = splitMobile(lead.phone);
  return {
    lead: {
      name: lead.name || null,
      email: lead.email || null,
      phone: lead.phone || null,
      whatsapp: null,
      createdAt: lead.createdAt || null,
      sourceUrl: lead.sourceUrl || null,
      captchaStatus,
      channel: "Website",
    },
    session: {
      city: lead.city || null,
      utmCampaign: extractUtmCampaign(lead.sourceUrl) || null,
      utmSource: extractUtmSource(lead.sourceUrl) || null,
      utmMedium: extractUtmMedium(lead.sourceUrl) || null,
      pageUrl: lead.sourceUrl || null,
    },
    business: { name: business?.name || null, website: business?.website || null },
    ...(Object.keys(journey).length ? { journey } : {}),
    ...((conversation as any).summary || (conversation as any).topics ? { conversation } : {}),
    meritto: {
      mobileNumber: mobile.mobileNumber,
      dialCode: mobile.dialCode,
      mobileVerificationStatus: lead.phone ? (verified || captchaStatus === "verified" ? "verified" : "unverified") : null,
    },
  };
}

const hashOf = (payload: Record<string, string>) => crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex");

/** Sync columns only (updatedAt untouched). */
async function record(leadId: string, businessAccountId: string, values: Partial<typeof leads.$inferInsert>) {
  await db.update(leads).set(values).where(and(eq(leads.id, leadId), eq(leads.businessAccountId, businessAccountId)));
}

/** 'waiting': not ready yet (no consent / verification / mandatory field); checked again shortly. */
export type MerittoSyncOutcome = "created" | "updated" | "unchanged" | "not_ready" | "failed" | "skipped";

/**
 * Send one lead to Meritto (create, or update when it already has a Meritto id and something
 * changed). `manual`: from the Sync button — no readiness rules, and sent even when unchanged.
 */
export async function syncLeadToMeritto(businessAccountId: string, leadId: string, opts: { manual?: boolean } = {}): Promise<{ outcome: MerittoSyncOutcome; message: string; merittoLeadId?: string | null }> {
  const settings = await storage.getWidgetSettings(businessAccountId);
  if (!settings || !settings.merittoAccessKey || !settings.merittoSecretKey) return { outcome: "skipped", message: "Meritto keys are not set up" };
  if (!opts.manual && settings.merittoEnabled !== "true") return { outcome: "skipped", message: "Meritto auto-sync is off" };
  const service = merittoServiceFor(settings);
  if (!service) return { outcome: "failed", message: "Meritto keys could not be read; save them again" };
  const lead = await storage.getLead(leadId, businessAccountId);
  if (!lead) return { outcome: "skipped", message: "Lead not found" };
  if (contactsHidden(lead)) return { outcome: "skipped", message: "This lead's contact details are hidden after sync" };
  if (!lead.phone && !lead.email) return { outcome: "not_ready", message: "The lead has no mobile or email yet" };

  if (!opts.manual) {
    const { evaluateLeadReadiness } = await import("./leadCapture/crmGate");
    let gate = await evaluateLeadReadiness({ leadId, businessAccountId, conversationId: lead.conversationId, channel: "widget", source: "meritto" }, settings);
    if (!gate.ok && gate.result === "skipped:mandatory_missing" && lead.conversationId && await chatQuietFor(lead.conversationId, HELD_BACK_IDLE_MINUTES)) {
      gate = await evaluateLeadReadiness({ leadId, businessAccountId, conversationId: lead.conversationId, channel: "widget", source: "meritto", ignoreMandatory: true }, settings);
    }
    if (!gate.ok) {
      // Looked at again in a couple of minutes (or sooner if nothing else is waiting).
      await record(lead.id, businessAccountId, { merittoSyncStatus: lead.merittoLeadId ? lead.merittoSyncStatus : "waiting", merittoNextRetryAt: new Date(Date.now() + NOT_READY_RECHECK_MINUTES * 60_000) });
      return { outcome: "not_ready", message: gate.result };
    }
  }

  const mappings = await getMerittoMappings(businessAccountId);
  const context = await buildContext(lead, businessAccountId);
  const { buildMerittoPayload } = await import("./merittoService");
  const { getMerittoListsIndex } = await import("./merittoSetup");
  const lists = await getMerittoListsIndex(businessAccountId).catch(() => null);
  const payload = buildMerittoPayload(mappings, context, lists);
  const hash = hashOf(payload);
  const lastHash = (lead.merittoSyncPayload as any)?._hash;
  const now = new Date();

  if (!opts.manual && lead.merittoSyncStatus === "synced" && lastHash === hash) {
    // Nothing new to tell Meritto; remember that this change was looked at.
    await record(lead.id, businessAccountId, { merittoSyncedAt: new Date(Math.max(now.getTime(), lead.updatedAt?.getTime() ?? 0)) });
    return { outcome: "unchanged", message: "Nothing changed since the last send", merittoLeadId: lead.merittoLeadId };
  }

  const isUpdate = !!lead.merittoLeadId;
  const result: MerittoResult = isUpdate
    ? await service.updateLead(lead.merittoLeadId!, mappings, context, lists)
    : await service.createLead(mappings, context, lists);

  if (result.success) {
    await record(lead.id, businessAccountId, {
      merittoSyncStatus: "synced",
      merittoSyncedAt: new Date(Math.max(now.getTime(), lead.updatedAt?.getTime() ?? 0)),
      merittoLeadId: result.leadId || lead.merittoLeadId || null,
      merittoSyncError: result.leadId || isUpdate ? null
        : result.alreadyInMeritto ? "Already in Meritto with this mobile number, so it wasn't added again. Later changes can't be sent as updates."
        : "Meritto did not return a lead id, so later changes can't be sent as updates",
      merittoSyncPayload: { ...payload, _hash: hash },
      merittoRetryCount: 0,
      merittoNextRetryAt: null,
    });
    console.log(`[Meritto] Lead ${lead.id} ${isUpdate ? "updated" : "created"} in Meritto${result.leadId ? ` (${result.leadId})` : ""}`);
    return { outcome: isUpdate ? "updated" : "created", message: result.message, merittoLeadId: result.leadId || lead.merittoLeadId };
  }

  const attempts = (lead.merittoRetryCount ?? 0) + 1;
  const giveUp = result.authError || attempts >= MAX_ATTEMPTS;
  await record(lead.id, businessAccountId, {
    merittoSyncStatus: giveUp ? "needs_attention" : "failed",
    merittoSyncError: result.message.slice(0, 1000),
    merittoSyncPayload: { ...(result.payload || payload), _hash: (lead.merittoSyncPayload as any)?._hash ?? null },
    merittoRetryCount: attempts,
    merittoNextRetryAt: giveUp ? null : new Date(now.getTime() + RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)] * 60_000),
  });
  console.warn(`[Meritto] Lead ${lead.id} not sent (attempt ${attempts}${giveUp ? ", giving up" : ""}): ${result.message}`);
  return { outcome: "failed", message: result.message, merittoLeadId: lead.merittoLeadId };
}

async function chatQuietFor(conversationId: string, minutes: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  const res: any = await db.execute(sql`SELECT 1 FROM messages WHERE conversation_id = ${conversationId} AND created_at > ${cutoff} LIMIT 1`);
  const rows = res?.rows ?? res;
  return !rows?.length;
}

/** One pass over every account with Meritto switched on. Returns how many leads were sent. */
export async function runMerittoSyncPass(): Promise<number> {
  const accounts = await db.select({ businessAccountId: widgetSettings.businessAccountId, enabledAt: widgetSettings.merittoEnabledAt })
    .from(widgetSettings)
    .where(and(eq(widgetSettings.merittoEnabled, "true"), sql`${widgetSettings.merittoAccessKey} IS NOT NULL`, sql`${widgetSettings.merittoSecretKey} IS NOT NULL`));
  let sent = 0;
  for (const account of accounts) {
    const since = new Date(Math.max(account.enabledAt?.getTime() ?? 0, Date.now() - LOOKBACK_DAYS * 24 * 60 * 60_000)).toISOString();
    const now = new Date().toISOString();
    const due: any = await db.execute(sql`
      SELECT l.id FROM leads l
      WHERE l.business_account_id = ${account.businessAccountId}
        AND l.created_at >= ${since}
        AND (l.phone IS NOT NULL OR l.email IS NOT NULL)
        AND l.contacts_masked_at IS NULL
        AND (
          l.meritto_sync_status IS NULL
          OR (l.meritto_sync_status = 'waiting' AND (l.meritto_next_retry_at IS NULL OR l.meritto_next_retry_at <= ${now} OR l.updated_at > l.meritto_next_retry_at - interval '2 minutes'))
          OR (l.meritto_sync_status = 'failed' AND l.meritto_next_retry_at <= ${now})
          OR (l.meritto_sync_status = 'synced' AND l.meritto_lead_id IS NOT NULL AND (
            l.updated_at > l.meritto_synced_at
            OR EXISTS (SELECT 1 FROM journey_responses r WHERE r.conversation_id = l.conversation_id AND r.created_at > l.meritto_synced_at)
            OR EXISTS (SELECT 1 FROM conversations c WHERE c.id = l.conversation_id AND c.summarized_at > l.meritto_synced_at)
          ))
        )
      ORDER BY l.created_at
      LIMIT ${BATCH}`);
    const rows: Array<{ id: string }> = due?.rows ?? due ?? [];
    for (const row of rows) {
      try {
        const r = await syncLeadToMeritto(account.businessAccountId, row.id);
        if (r.outcome === "created" || r.outcome === "updated") sent++;
      } catch (err) {
        console.error("[Meritto] Sync error for lead", row.id, err);
      }
    }
  }
  return sent;
}

class MerittoSyncWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(intervalMs = 30_000) {
    if (this.timer) return;
    console.log("[Meritto] Starting sync worker (every 30 s)");
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await runMerittoSyncPass();
    } catch (err) {
      console.error("[Meritto] Sync pass failed:", err);
    } finally {
      this.running = false;
    }
  }
}

export const merittoSyncWorker = new MerittoSyncWorker();
