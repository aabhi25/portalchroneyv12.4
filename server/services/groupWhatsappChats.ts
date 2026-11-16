/**
 * WhatsApp chats for a group admin's Conversations page (read-only).
 *
 * One row per student per account (every message with that number, not 24-hour sessions), newest
 * first, paged in SQL. Same rules as each account's own WhatsApp page: only accounts with WhatsApp
 * switched on, only numbers that wrote in, and phones masked for accounts with
 * leadPhoneMaskingEnabled. "Hide contact details from view" is applied by the contact view
 * middleware on top (these routes live under /api/group-admin/groups/:id/conversations).
 *
 * Every row carries a phoneKey (the number sealed with the server's key), so the page opens a chat
 * the same way whether the number is shown or hidden.
 */
import { inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { businessAccounts } from "@shared/schema";
import { maskLeadPhone, maskPhonesInText } from "../lib/leadAccess";
import { phoneKeyFor } from "../lib/contactViewMask";

export interface GroupWhatsappChat {
  phoneKey: string;
  senderPhone: string | null;
  businessAccountId: string;
  businessAccountName: string;
  name: string | null;
  messageCount: number;
  lastMessage: string | null;
  lastMessageAt: string;
  firstMessageAt: string;
  isLead: boolean;
}

export interface GroupWhatsappChatFilters {
  search?: string;
  from?: Date;
  to?: Date;
}

/** The group's accounts with WhatsApp switched on (id → name, masking). */
async function whatsappAccounts(accountIds: string[]) {
  if (accountIds.length === 0) return [];
  const rows = await db.select({
    id: businessAccounts.id,
    name: businessAccounts.name,
    whatsappEnabled: businessAccounts.whatsappEnabled,
    mask: businessAccounts.leadPhoneMaskingEnabled,
  }).from(businessAccounts).where(inArray(businessAccounts.id, accountIds));
  return rows.filter(r => r.whatsappEnabled === "true");
}

const iso = (d: Date) => sql`${d.toISOString()}::timestamp`;

export async function listGroupWhatsappChats(
  accountIds: string[],
  filters: GroupWhatsappChatFilters,
  paging: { limit: number; offset: number },
): Promise<{ chats: GroupWhatsappChat[]; total: number }> {
  const accounts = await whatsappAccounts(accountIds);
  if (accounts.length === 0) return { chats: [], total: 0 };
  const ids = sql.join(accounts.map(a => sql`${a.id}`), sql`, `);

  const msgConds: SQL[] = [sql`w.business_account_id IN (${ids})`, sql`w.sender_phone IS NOT NULL`];
  if (filters.from) msgConds.push(sql`w.received_at >= ${iso(filters.from)}`);
  if (filters.to) msgConds.push(sql`w.received_at <= ${iso(filters.to)}`);
  const search = filters.search?.trim() ? `%${filters.search.trim().replace(/[\\%_]/g, c => `\\${c}`)}%` : null;

  const base = sql`
    WITH agg AS (
      SELECT w.business_account_id, w.sender_phone,
        COALESCE(MAX(NULLIF(w.customer_name, '')), MAX(NULLIF(w.sender_name, ''))) AS name,
        count(*)::int AS message_count,
        max(w.received_at) AS last_at,
        min(w.received_at) AS first_at,
        bool_or(w.status <> 'message_only') AS is_lead,
        bool_or(w.direction = 'incoming') AS wrote_in
      FROM whatsapp_leads w
      WHERE ${sql.join(msgConds, sql` AND `)}
      GROUP BY w.business_account_id, w.sender_phone
    )
    SELECT * FROM agg
    WHERE wrote_in
      ${search ? sql`AND (agg.sender_phone ILIKE ${search} OR agg.name ILIKE ${search})` : sql``}`;

  const countRes = await db.execute(sql`SELECT count(*)::int AS n FROM (${base}) c`);
  const total = Number((countRes.rows[0] as any)?.n || 0);

  // Times as epoch ms: a raw timestamp would be read as local time.
  const pageRes = await db.execute(sql`
    SELECT c.business_account_id, c.sender_phone, c.name, c.message_count, c.is_lead,
      (extract(epoch FROM c.last_at) * 1000)::bigint AS last_ms,
      (extract(epoch FROM c.first_at) * 1000)::bigint AS first_ms,
      (SELECT l.raw_message FROM whatsapp_leads l
        WHERE l.business_account_id = c.business_account_id AND l.sender_phone = c.sender_phone
        ORDER BY l.received_at DESC LIMIT 1) AS last_message
    FROM (${base}) c
    ORDER BY c.last_at DESC, c.sender_phone ASC
    LIMIT ${paging.limit} OFFSET ${paging.offset}`);

  const byId = new Map(accounts.map(a => [a.id, a]));
  const { readableChatText } = await import("./whatsappInteractiveText");
  const chats = (pageRes.rows as any[]).map((r): GroupWhatsappChat => {
    const account = byId.get(r.business_account_id)!;
    const mask = account.mask === "true";
    const text = r.last_message ? readableChatText(r.last_message, new Map()) : null;
    return {
      phoneKey: phoneKeyFor(r.sender_phone),
      senderPhone: mask ? maskLeadPhone(r.sender_phone) : r.sender_phone,
      businessAccountId: account.id,
      businessAccountName: account.name,
      name: r.name || null,
      messageCount: Number(r.message_count),
      lastMessage: mask ? maskPhonesInText(text) : text,
      lastMessageAt: new Date(Number(r.last_ms)).toISOString(),
      firstMessageAt: new Date(Number(r.first_ms)).toISOString(),
      isLead: r.is_lead === true,
    };
  });
  return { chats, total };
}

export interface GroupWhatsappMessage {
  id: string;
  direction: "incoming" | "outgoing";
  text: string | null;
  receivedAt: string;
  attachments: { id: string; name: string }[];
  journeyName: string | null;
}

/** One chat's messages (oldest first), `before` pages back. Null when the account isn't one of `accountIds` or has WhatsApp off. */
export async function groupWhatsappChatMessages(
  accountIds: string[],
  accountId: string,
  senderPhone: string,
  options: { limit?: number; before?: string } = {},
): Promise<{ messages: GroupWhatsappMessage[]; name: string | null; senderPhone: string; hasMore: boolean; oldestTimestamp: string | null } | null> {
  if (!accountIds.includes(accountId)) return null;
  const [account] = await whatsappAccounts([accountId]);
  if (!account) return null;
  const mask = account.mask === "true";

  const { whatsappService } = await import("./whatsappService");
  const result = await whatsappService.getConversationMessages(accountId, senderPhone, undefined, undefined, undefined, options.limit ?? 50, options.before);
  const journeyName = new Map(result.flowSessions.map(s => [s.id, s.flowName]));
  const name = result.messages.map(m => m.customerName || m.senderName).find(Boolean) || null;
  return {
    name,
    senderPhone: mask ? maskLeadPhone(senderPhone)! : senderPhone,
    hasMore: result.hasMore,
    oldestTimestamp: result.oldestTimestamp,
    messages: result.messages.map(m => ({
      id: m.id,
      direction: m.direction === "outgoing" ? "outgoing" : "incoming",
      text: mask ? maskPhonesInText(m.rawMessage) : m.rawMessage,
      receivedAt: (m.receivedAt instanceof Date ? m.receivedAt : new Date(String(m.receivedAt))).toISOString(),
      attachments: (m.attachments || []).map((a: any) => ({ id: a.id, name: a.fileName || a.originalName || a.mimeType || "Attachment" })),
      journeyName: m.flowSessionId ? journeyName.get(m.flowSessionId) || null : null,
    })),
  };
}

/**
 * WhatsApp leads per account in a period, counted like the super admin's group Insights and the
 * account's WhatsApp Insights page: incoming, not just a message, and (where the account requires
 * PAN + email) qualified.
 */
export async function countWhatsappLeadsByAccount(accountIds: string[], dateFrom?: Date, dateTo?: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>(accountIds.map(id => [id, 0]));
  if (accountIds.length === 0) return out;
  const { isQualificationRequired } = await import("./leadQualificationService");
  const qualifiedOnly = new Set<string>();
  for (const id of accountIds) if (await isQualificationRequired(id)) qualifiedOnly.add(id);
  const rows = await db.execute(sql`
    SELECT business_account_id AS id, COUNT(*)::int AS n FROM whatsapp_leads
    WHERE business_account_id IN (${sql.join(accountIds.map(id => sql`${id}`), sql`, `)})
      AND direction = 'incoming' AND status != 'message_only'
      ${dateFrom ? sql`AND received_at >= ${iso(dateFrom)}` : sql``}
      ${dateTo ? sql`AND received_at <= ${iso(dateTo)}` : sql``}
      ${qualifiedOnly.size ? sql`AND (qualified_at IS NOT NULL OR business_account_id NOT IN (${sql.join(Array.from(qualifiedOnly).map(id => sql`${id}`), sql`, `)}))` : sql``}
    GROUP BY business_account_id`);
  for (const r of rows.rows as { id: string; n: number }[]) out.set(r.id, Number(r.n));
  return out;
}
