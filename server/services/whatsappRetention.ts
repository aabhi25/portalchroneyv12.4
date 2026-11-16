/**
 * Auto-delete settings for WhatsApp leads and chats (the same account / group policy as website
 * leads; see dataRetentionService).
 *
 * A WhatsApp "chat" is everything one number sent to (or got from) one account: its whatsapp_leads
 * rows (messages and leads), attachments and journey sessions. Each number is judged as a whole:
 *   - with leads: deleted when every lead is synced and the newest sync is older than the "after
 *     sync" timer, or when the "never synced" timer has passed since its first lead;
 *   - without leads: deleted after the "chats with no lead" timer since its last message;
 *   - never while the student is still writing (RETENTION_IDLE_GUARD_MINUTES).
 * "Remove contact details after sync" overwrites the number once every lead is synced AND the chat
 * has been quiet for MASK_QUIET_DAYS: the number is the conversation on WhatsApp (AI replies,
 * follow-ups and campaigns go to it), so it can only go once the conversation is over. The opt-out
 * list is never touched, so a student who said "Stop" stays stopped.
 * Synced = every CRM that WhatsApp leads go to (LeadSquared for WhatsApp, the custom CRM) confirmed it.
 */
import crypto from "crypto";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { customCrmSettings, dataPurgeLog, whatsappFlowSessions, whatsappHandoffs, whatsappLeads, whatsappSessions } from "@shared/schema";
import { RETENTION_IDLE_GUARD_MINUTES, type RetentionPolicySettings } from "@shared/dataRetentionPolicy";
import { maskContactsDeep, maskContactsInText, maskEmailAddress, maskPhoneNumber, isMaskedValue } from "@shared/contactMasking";

export const MASK_QUIET_DAYS = 7;
const BATCH = 200;
const ts = (d: Date) => d.toISOString();

interface WaTargets { lsq: boolean; custom: boolean }

async function waTargets(accountId: string): Promise<WaTargets> {
  const { whatsappLsqConfigured } = await import("./whatsappLeadLsqSync");
  const { isCustomCrmReady } = await import("./socialLeadCrmSync");
  const [custom] = await db.select().from(customCrmSettings).where(eq(customCrmSettings.businessAccountId, accountId)).limit(1);
  return { lsq: await whatsappLsqConfigured(accountId), custom: isCustomCrmReady(custom) };
}

function syncedSql(t: WaTargets): SQL {
  const parts: SQL[] = [];
  if (t.lsq) parts.push(sql`COALESCE(leadsquared_sync_status, '') = 'synced'`);
  if (t.custom) parts.push(sql`COALESCE(custom_crm_sync_status, '') = 'synced'`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`false`;
}

function syncedAtSql(t: WaTargets): SQL {
  const cols: SQL[] = [];
  if (t.lsq) cols.push(sql`leadsquared_synced_at`);
  if (t.custom) cols.push(sql`custom_crm_synced_at`);
  return cols.length ? sql`GREATEST(${sql.join(cols, sql`, `)})` : sql`NULL::timestamp`;
}

export interface WaPerson {
  phone: string;
  leads: number;
  leadIds: string[];
  firstAt: Date;
  lastAt: Date;
  firstLeadAt: Date | null;
  allSynced: boolean;
  syncedAt: Date | null;
  crmLeadId: string | null;
}

/** Every number that wrote to the account, summed up (newest activity last). */
async function people(accountId: string, t: WaTargets): Promise<WaPerson[]> {
  const res = await db.execute(sql`
    SELECT sender_phone AS phone,
      count(*) FILTER (WHERE status <> 'message_only')::int AS leads,
      COALESCE(array_agg(id) FILTER (WHERE status <> 'message_only'), '{}') AS lead_ids,
      -- Times as epoch milliseconds: the columns hold UTC without a zone, and a raw timestamp
      -- string would be read back in the server's local time.
      (extract(epoch FROM min(received_at)) * 1000)::bigint AS first_at,
      (extract(epoch FROM max(received_at)) * 1000)::bigint AS last_at,
      (extract(epoch FROM min(received_at) FILTER (WHERE status <> 'message_only')) * 1000)::bigint AS first_lead_at,
      COALESCE(bool_and(${syncedSql(t)}) FILTER (WHERE status <> 'message_only'), false) AS all_synced,
      (extract(epoch FROM max(${syncedAtSql(t)}) FILTER (WHERE status <> 'message_only')) * 1000)::bigint AS synced_at,
      max(COALESCE(leadsquared_lead_id, custom_crm_lead_id)) AS crm_lead_id
    FROM whatsapp_leads
    WHERE business_account_id = ${accountId} AND COALESCE(sender_phone, '') <> ''
    GROUP BY sender_phone
  `);
  const d = (v: any) => (v === null || v === undefined ? null : new Date(Number(v)));
  return (res.rows as any[]).map((r) => ({
    phone: r.phone, leads: Number(r.leads) || 0, leadIds: r.lead_ids || [],
    firstAt: d(r.first_at)!, lastAt: d(r.last_at)!, firstLeadAt: d(r.first_lead_at),
    allSynced: r.all_synced === true, syncedAt: d(r.synced_at), crmLeadId: r.crm_lead_id || null,
  }));
}

export type WaDecision = { due: false } | { due: true; reason: "synced_retention" | "unsynced_retention" | "idle_chat" };

/** Whether one number's chat is due for deletion (pure; mirrors decideLead for website leads). */
export function decideWhatsappPerson(p: WaPerson, policy: RetentionPolicySettings, now: Date): WaDecision {
  if (now.getTime() - p.lastAt.getTime() < RETENTION_IDLE_GUARD_MINUTES * 60_000) return { due: false };
  const passed = (from: Date | null, minutes: number | null) => !!from && minutes !== null && from.getTime() + minutes * 60_000 <= now.getTime();
  if (p.leads === 0) return passed(p.lastAt, policy.deleteIdleChatsAfterMinutes) ? { due: true, reason: "idle_chat" } : { due: false };
  if (p.allSynced) return passed(p.syncedAt ?? p.firstLeadAt, policy.deleteSyncedAfterMinutes) ? { due: true, reason: "synced_retention" } : { due: false };
  return passed(p.firstLeadAt, policy.deleteUnsyncedAfterMinutes) ? { due: true, reason: "unsynced_retention" } : { due: false };
}

/** WhatsApp leads and chats the policy would delete right now. */
export async function countWhatsappDue(accountId: string, policy: RetentionPolicySettings, now = new Date()) {
  const t = await waTargets(accountId);
  let leads = 0;
  let chats = 0;
  for (const p of await people(accountId, t)) {
    if (!decideWhatsappPerson(p, policy, now).due) continue;
    if (p.leads > 0) leads += p.leads;
    else chats++;
  }
  return { leads, chats };
}

/** Deletes every due WhatsApp chat (live mode), leaving a tombstone per lead / chat. */
export async function purgeWhatsapp(accountId: string, policy: RetentionPolicySettings, now = new Date()) {
  const t = await waTargets(accountId);
  const { whatsappService } = await import("./whatsappService");
  const result = { leads: 0, chats: 0 };
  let done = 0;
  for (const p of await people(accountId, t)) {
    if (done >= BATCH) break;
    const decision = decideWhatsappPerson(p, policy, now);
    if (!decision.due) continue;
    const chatId = crypto.createHash("sha256").update(`${accountId}:${p.phone}`).digest("hex").slice(0, 32);
    await db.insert(dataPurgeLog).values([
      ...p.leadIds.map((id) => ({
        businessAccountId: accountId, recordType: "whatsapp_lead", recordId: id, capturedAt: p.firstLeadAt ?? p.firstAt,
        purgedAt: new Date(), reason: decision.reason, synced: p.allSynced, syncedAt: p.allSynced ? p.syncedAt : null,
        crmLeadId: p.crmLeadId, source: "whatsapp", countInAnalytics: policy.keepAnonymousCounts,
      })),
      {
        businessAccountId: accountId, recordType: "whatsapp_chat", recordId: chatId, capturedAt: p.firstAt,
        purgedAt: new Date(), reason: p.leads ? "with_lead" : "idle_chat", source: "whatsapp", countInAnalytics: policy.keepAnonymousCounts,
      },
    ]);
    await whatsappService.deleteConversation(accountId, p.phone);
    await db.delete(whatsappSessions).where(and(eq(whatsappSessions.businessAccountId, accountId), eq(whatsappSessions.phoneNumber, p.phone)));
    await db.update(whatsappHandoffs).set({ whatsappPhone: null }).where(and(eq(whatsappHandoffs.businessAccountId, accountId), eq(whatsappHandoffs.whatsappPhone, p.phone.replace(/\D/g, ""))));
    if (p.leads) result.leads += p.leads;
    else result.chats++;
    done++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Remove contact details after sync
// ---------------------------------------------------------------------------

/** Numbers whose details are due to be overwritten. */
async function maskDue(accountId: string, now: Date) {
  const t = await waTargets(accountId);
  const quietSince = now.getTime() - MASK_QUIET_DAYS * 24 * 3600_000;
  return (await people(accountId, t)).filter((p) => p.leads > 0 && p.allSynced && p.lastAt.getTime() <= quietSince && !isMaskedValue(p.phone));
}

export async function countWhatsappMaskDue(accountId: string, now = new Date()): Promise<number> {
  return (await maskDue(accountId, now)).reduce((n, p) => n + p.leads, 0);
}

/**
 * The hidden number that replaces a real one: "********3210 #a1b2c3". The tag keeps two students
 * whose numbers end the same apart (the chat list groups messages by this value).
 */
export function hiddenWhatsappNumber(accountId: string, phone: string): string {
  const tag = crypto.createHash("sha256").update(`${accountId}:${phone}`).digest("hex").slice(0, 6);
  return `${maskPhoneNumber(phone)} #${tag}`;
}

const maskText = (v: string | null) => (v ? maskContactsInText(v) : v);

/** Overwrites the number and contact details in every message, lead and journey session of one chat. */
async function maskPerson(accountId: string, phone: string) {
  const hidden = hiddenWhatsappNumber(accountId, phone);
  const rows = await db.select().from(whatsappLeads).where(and(eq(whatsappLeads.businessAccountId, accountId), eq(whatsappLeads.senderPhone, phone)));
  await db.transaction(async (tx) => {
    for (const r of rows) {
      // updatedAt is left alone so the lead doesn't look changed (no CRM re-send).
      await tx.update(whatsappLeads).set({
        senderPhone: hidden,
        customerPhone: r.customerPhone && !isMaskedValue(r.customerPhone) ? maskPhoneNumber(r.customerPhone) : r.customerPhone,
        customerEmail: r.customerEmail && !isMaskedValue(r.customerEmail) ? maskEmailAddress(r.customerEmail) : r.customerEmail,
        rawMessage: maskText(r.rawMessage),
        lastMessage: maskText(r.lastMessage),
        notes: maskText(r.notes),
        extractedData: r.extractedData ? maskContactsDeep(r.extractedData) : r.extractedData,
        leadsquaredSyncPayload: r.leadsquaredSyncPayload ? maskContactsDeep(r.leadsquaredSyncPayload) : r.leadsquaredSyncPayload,
        customCrmSyncPayload: r.customCrmSyncPayload ? maskContactsDeep(r.customCrmSyncPayload) : r.customCrmSyncPayload,
        leadsquaredSyncError: maskText(r.leadsquaredSyncError),
        customCrmSyncError: maskText(r.customCrmSyncError),
      }).where(eq(whatsappLeads.id, r.id));
    }
    const sessions = await tx.select().from(whatsappFlowSessions).where(and(eq(whatsappFlowSessions.businessAccountId, accountId), eq(whatsappFlowSessions.senderPhone, phone)));
    for (const s of sessions) {
      await tx.update(whatsappFlowSessions).set({
        senderPhone: hidden,
        collectedData: s.collectedData ? maskContactsDeep(s.collectedData) : s.collectedData,
      } as any).where(eq(whatsappFlowSessions.id, s.id));
    }
    await tx.delete(whatsappSessions).where(and(eq(whatsappSessions.businessAccountId, accountId), eq(whatsappSessions.phoneNumber, phone)));
    await tx.update(whatsappHandoffs).set({ whatsappPhone: null }).where(and(eq(whatsappHandoffs.businessAccountId, accountId), eq(whatsappHandoffs.whatsappPhone, phone.replace(/\D/g, ""))));
  });
  return rows.filter((r) => r.status !== "message_only").length;
}

/** Overwrites contact details of every due WhatsApp chat. Returns how many leads were hidden. */
export async function maskWhatsappContacts(accountId: string, now = new Date()): Promise<number> {
  let hidden = 0;
  for (const p of (await maskDue(accountId, now)).slice(0, BATCH)) hidden += await maskPerson(accountId, p.phone);
  return hidden;
}
