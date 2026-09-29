/**
 * One list of leads across every channel an account has: Website (leads), WhatsApp
 * (whatsapp_leads), Instagram (instagram_leads) and Facebook (facebook_leads).
 *
 * Paging happens in SQL over a UNION ALL of the four tables (each branch already filtered by
 * account, channel, date and search), ordered by capture time, so page N and the total are
 * exact however the channels interleave. The page's rows are then loaded in full per channel.
 *
 * Privacy rules are applied here so the listing and the export can't drift apart:
 *   - leadPhoneMaskingEnabled masks every phone (column, extracted fields, raw message text)
 *     and drops CRM payloads, for every channel;
 *   - WhatsApp drafts (qualified_at IS NULL where the account requires PAN + email) and
 *     'message_only' entries are never listed, same as the WhatsApp Leads page;
 *   - a channel switched off for the account (whatsapp/instagram/facebook_enabled) is left out.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  businessAccounts,
  facebookLeads,
  instagramLeads,
  leads,
  whatsappLeads,
  type BusinessAccount,
  type Lead,
} from "@shared/schema";
import { maskLeadPhone, maskPhonesInRecord, maskPhonesInText } from "../lib/leadAccess";
import {
  SOCIAL_EMAIL_KEYS,
  SOCIAL_NAME_KEYS,
  SOCIAL_PHONE_KEYS,
  extractedFieldSql,
} from "./socialLeadFields";

export const LEAD_CHANNELS = ["website", "whatsapp", "instagram", "facebook"] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export function isLeadChannel(v: unknown): v is LeadChannel {
  return typeof v === "string" && (LEAD_CHANNELS as readonly string[]).includes(v);
}

export interface UnifiedLeadFilters {
  channel?: LeadChannel | "all";
  search?: string;
  from?: Date;
  to?: Date;
}

export interface CrmSyncState {
  status: string | null;
  error: string | null;
  syncedAt: string | null;
  crmLeadId: string | null;
}

export interface UnifiedLeadRow {
  key: string;
  channel: LeadChannel;
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  capturedAt: string;
  crm: {
    leadsquared?: CrmSyncState;
    salesforce?: CrmSyncState;
    customCrm?: CrmSyncState;
  };
  /**
   * Channel-specific record for the detail view. website: the Lead row (as /api/leads returns it);
   * whatsapp/instagram/facebook: sender + captured fields.
   */
  detail: Record<string, any>;
}

export interface UnifiedLeadsResult {
  leads: UnifiedLeadRow[];
  total: number;
  countsByChannel: Record<LeadChannel, number>;
  channels: LeadChannel[];
}

/** Channels whose leads this account may see. Website leads are always shown (as before). */
export function enabledLeadChannels(account: Pick<BusinessAccount, "whatsappEnabled" | "instagramEnabled" | "facebookEnabled">): LeadChannel[] {
  const out: LeadChannel[] = ["website"];
  if (account.whatsappEnabled === "true") out.push("whatsapp");
  if (account.instagramEnabled === "true") out.push("instagram");
  if (account.facebookEnabled === "true") out.push("facebook");
  return out;
}

const iso = (d: Date) => sql`${d.toISOString()}::timestamp`;

function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function dateConds(col: SQL, f: UnifiedLeadFilters): SQL[] {
  const out: SQL[] = [];
  if (f.from) out.push(sql`${col} >= ${iso(f.from)}`);
  if (f.to) out.push(sql`${col} <= ${iso(f.to)}`);
  return out;
}

function whereAll(conds: SQL[]): SQL {
  return sql.join(conds, sql` AND `);
}

/** SELECT channel, id, captured_at for one channel, with every filter applied. */
function branchSql(channel: LeadChannel, accountId: string, f: UnifiedLeadFilters, opts: { excludeDrafts: boolean }): SQL {
  const search = f.search?.trim() ? likePattern(f.search.trim()) : null;
  switch (channel) {
    case "website": {
      const conds: SQL[] = [sql`l.business_account_id = ${accountId}`, ...dateConds(sql`l.created_at`, f)];
      if (search) conds.push(sql`(l.name ILIKE ${search} OR l.email ILIKE ${search} OR l.phone ILIKE ${search} OR l.message ILIKE ${search})`);
      return sql`SELECT 'website'::text AS channel, l.id AS id, l.created_at AS captured_at FROM leads l WHERE ${whereAll(conds)}`;
    }
    case "whatsapp": {
      const conds: SQL[] = [
        sql`w.business_account_id = ${accountId}`,
        sql`w.status <> 'message_only'`,
        ...dateConds(sql`w.received_at`, f),
      ];
      if (opts.excludeDrafts) conds.push(sql`w.qualified_at IS NOT NULL`);
      if (search) {
        conds.push(sql`(w.sender_phone ILIKE ${search} OR w.sender_name ILIKE ${search} OR w.customer_name ILIKE ${search}
          OR w.customer_phone ILIKE ${search} OR w.customer_email ILIKE ${search} OR w.raw_message ILIKE ${search})`);
      }
      return sql`SELECT 'whatsapp'::text AS channel, w.id AS id, w.received_at AS captured_at FROM whatsapp_leads w WHERE ${whereAll(conds)}`;
    }
    case "instagram":
    case "facebook": {
      const table = sql.raw(channel === "instagram" ? "instagram_leads" : "facebook_leads");
      const senderCol = sql.raw(channel === "instagram" ? "s.sender_username" : "s.sender_name");
      const conds: SQL[] = [sql`s.business_account_id = ${accountId}`, ...dateConds(sql`s.received_at`, f)];
      if (search) conds.push(sql`(s.extracted_data::text ILIKE ${search} OR ${senderCol} ILIKE ${search})`);
      return sql`SELECT ${channel}::text AS channel, s.id AS id, s.received_at AS captured_at FROM ${table} s WHERE ${whereAll(conds)}`;
    }
  }
}

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function crmState(status: string | null | undefined, error: string | null | undefined, syncedAt: Date | string | null | undefined, crmLeadId: string | null | undefined): CrmSyncState {
  return { status: status ?? null, error: error ?? null, syncedAt: toIso(syncedAt), crmLeadId: crmLeadId ?? null };
}

/** Same protection /api/leads applies to a website lead. */
function protectWebsiteLead(lead: Lead, mask: boolean): Lead {
  if (!mask) return lead;
  return { ...lead, phone: maskLeadPhone(lead.phone ?? null), leadsquaredSyncPayload: null, customCrmSyncPayload: null };
}

const maskIf = (mask: boolean, phone: string | null | undefined) => (mask ? maskLeadPhone(phone ?? null) : phone ?? null);

function pickExtracted(data: Record<string, any> | null | undefined, keys: readonly string[]): string | null {
  if (!data) return null;
  for (const k of keys) {
    const v = data[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

async function hydrate(accountId: string, page: { channel: LeadChannel; id: string }[], mask: boolean): Promise<UnifiedLeadRow[]> {
  const ids = (ch: LeadChannel) => page.filter(p => p.channel === ch).map(p => p.id);
  const byKey = new Map<string, UnifiedLeadRow>();

  const webIds = ids("website");
  if (webIds.length) {
    const rows = await db.select().from(leads).where(and(eq(leads.businessAccountId, accountId), inArray(leads.id, webIds)));
    for (const l of rows) {
      byKey.set(`website:${l.id}`, {
        key: `website:${l.id}`, channel: "website", id: l.id,
        name: l.name, phone: maskIf(mask, l.phone), email: l.email, capturedAt: toIso(l.createdAt)!,
        crm: {
          leadsquared: crmState(l.leadsquaredSyncStatus, l.leadsquaredSyncError, l.leadsquaredSyncedAt, l.leadsquaredLeadId),
          salesforce: crmState(l.salesforceSyncStatus, l.salesforceSyncError, l.salesforceSyncedAt, l.salesforceLeadId),
        },
        detail: protectWebsiteLead(l, mask),
      });
    }
  }

  const waIds = ids("whatsapp");
  if (waIds.length) {
    const rows = await db.select().from(whatsappLeads).where(and(eq(whatsappLeads.businessAccountId, accountId), inArray(whatsappLeads.id, waIds)));
    for (const w of rows) {
      const extracted = (w.extractedData as Record<string, any>) || {};
      byKey.set(`whatsapp:${w.id}`, {
        key: `whatsapp:${w.id}`, channel: "whatsapp", id: w.id,
        name: w.customerName || w.senderName || null,
        phone: maskIf(mask, w.customerPhone || w.senderPhone),
        email: w.customerEmail || null,
        capturedAt: toIso(w.receivedAt)!,
        crm: {
          customCrm: crmState(w.customCrmSyncStatus, w.customCrmSyncError, w.customCrmSyncedAt, w.customCrmLeadId),
          ...(w.leadsquaredSyncStatus ? { leadsquared: crmState(w.leadsquaredSyncStatus, w.leadsquaredSyncError, null, w.leadsquaredLeadId) } : {}),
        },
        detail: {
          senderName: w.senderName,
          senderPhone: maskIf(mask, w.senderPhone),
          customerPhone: maskIf(mask, w.customerPhone),
          status: w.status,
          notes: mask ? maskPhonesInText(w.notes) : w.notes,
          lastMessage: mask ? maskPhonesInText(w.lastMessage) : w.lastMessage,
          extractedData: mask ? maskPhonesInRecord(extracted) : extracted,
          qualifiedAt: toIso(w.qualifiedAt),
        },
      });
    }
  }

  for (const ch of ["instagram", "facebook"] as const) {
    const chIds = ids(ch);
    if (!chIds.length) continue;
    const t = ch === "instagram" ? instagramLeads : facebookLeads;
    const rows = await db.select().from(t).where(and(eq(t.businessAccountId, accountId), inArray(t.id, chIds)));
    for (const s of rows) {
      const extracted = (s.extractedData as Record<string, any>) || {};
      const sender = ch === "instagram" ? (s as any).senderUsername : (s as any).senderName;
      byKey.set(`${ch}:${s.id}`, {
        key: `${ch}:${s.id}`, channel: ch, id: s.id,
        name: pickExtracted(extracted, SOCIAL_NAME_KEYS) || sender || null,
        phone: maskIf(mask, pickExtracted(extracted, SOCIAL_PHONE_KEYS)),
        email: pickExtracted(extracted, SOCIAL_EMAIL_KEYS),
        capturedAt: toIso(s.receivedAt)!,
        crm: {
          leadsquared: crmState(s.leadsquaredSyncStatus, s.leadsquaredSyncError, s.leadsquaredSyncedAt, s.leadsquaredLeadId),
          salesforce: crmState(s.salesforceSyncStatus, s.salesforceSyncError, s.salesforceSyncedAt, s.salesforceLeadId),
          customCrm: crmState(s.customCrmSyncStatus, s.customCrmSyncError, s.customCrmSyncedAt, s.customCrmLeadId),
        },
        detail: {
          senderId: s.senderId,
          ...(ch === "instagram" ? { senderUsername: sender } : { senderName: sender }),
          status: s.status,
          flowSessionId: s.flowSessionId,
          extractedData: mask ? maskPhonesInRecord(extracted) : extracted,
        },
      });
    }
  }

  return page.map(p => byKey.get(`${p.channel}:${p.id}`)).filter((r): r is UnifiedLeadRow => !!r);
}

export async function queryUnifiedLeads(
  businessAccountId: string,
  filters: UnifiedLeadFilters,
  paging: { limit: number; offset: number } | null,
): Promise<UnifiedLeadsResult> {
  const [account] = await db.select().from(businessAccounts).where(eq(businessAccounts.id, businessAccountId)).limit(1);
  const empty = { website: 0, whatsapp: 0, instagram: 0, facebook: 0 } as Record<LeadChannel, number>;
  if (!account) return { leads: [], total: 0, countsByChannel: empty, channels: [] };

  const channels = enabledLeadChannels(account);
  const selected = filters.channel && filters.channel !== "all"
    ? channels.filter(c => c === filters.channel)
    : channels;
  if (selected.length === 0) return { leads: [], total: 0, countsByChannel: empty, channels };

  let excludeDrafts = false;
  if (selected.includes("whatsapp")) {
    const { isQualificationRequired } = await import("./leadQualificationService");
    excludeDrafts = await isQualificationRequired(businessAccountId);
  }
  const mask = account.leadPhoneMaskingEnabled === "true";

  const union = sql.join(selected.map(ch => branchSql(ch, businessAccountId, filters, { excludeDrafts })), sql` UNION ALL `);

  const countRes = await db.execute(sql`SELECT u.channel, count(*)::int AS n FROM (${union}) u GROUP BY u.channel`);
  const countsByChannel = { ...empty };
  for (const r of countRes.rows as { channel: LeadChannel; n: number }[]) countsByChannel[r.channel] = Number(r.n);
  const total = Object.values(countsByChannel).reduce((a, b) => a + b, 0);

  const pageSql = paging
    ? sql`SELECT u.channel, u.id FROM (${union}) u ORDER BY u.captured_at DESC, u.channel ASC, u.id ASC LIMIT ${paging.limit} OFFSET ${paging.offset}`
    : sql`SELECT u.channel, u.id FROM (${union}) u ORDER BY u.captured_at DESC, u.channel ASC, u.id ASC`;
  const pageRes = await db.execute(pageSql);
  const page = pageRes.rows as { channel: LeadChannel; id: string }[];

  return { leads: await hydrate(businessAccountId, page, mask), total, countsByChannel, channels };
}

/** Parses the query string shared by the listing and the export. Accepts from/to or fromDate/toDate. */
export function parseUnifiedLeadFilters(q: Record<string, unknown>): UnifiedLeadFilters | { error: string } {
  const channelRaw = typeof q.channel === "string" && q.channel ? q.channel : "all";
  if (channelRaw !== "all" && !isLeadChannel(channelRaw)) return { error: "Unknown channel" };
  const date = (v: unknown): Date | undefined | null => {
    if (typeof v !== "string" || !v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const from = date(q.from ?? q.fromDate);
  const to = date(q.to ?? q.toDate);
  if (from === null || to === null) return { error: "Invalid date" };
  const search = typeof q.search === "string" ? q.search.slice(0, 200) : undefined;
  return { channel: channelRaw as LeadChannel | "all", search, from: from || undefined, to: to || undefined };
}
