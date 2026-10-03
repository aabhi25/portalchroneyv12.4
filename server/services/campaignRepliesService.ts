/**
 * Campaign replies: results funnel, the replies inbox (search + filters across campaigns),
 * one thread, staff takeover (manual WhatsApp reply inside the 24-hour window) and the
 * per-customer AI pause / "needs human" flags.
 *
 * Every query is scoped by businessAccountId. Read-only helpers live here (not in
 * marketingCampaignService) on purpose; writes touch only the takeover columns and the
 * campaign transcript.
 */
import { db } from "../db";
import {
  marketingCampaigns,
  marketingCampaignRecipients,
  marketingCampaignMessages,
  whatsappSessions,
  whatsappSettings,
  type ReplyClassification,
} from "@shared/schema";
import { and, asc, desc, eq, getTableColumns, sql, type SQL } from "drizzle-orm";

const R = marketingCampaignRecipients;
const C = marketingCampaigns;
const M = marketingCampaignMessages;

export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MANUAL_REPLY_MAX_CHARS = 4096;

// ── "Interested" = the campaign's positive outcome categories ───────────────
// Outcome categories are written by the business (key + label), so "positive" is read from
// their own words: interested / yes / promise to pay / booked / confirmed … and never a
// category whose name says no / not / refused / wrong number / cancelled.
const POSITIVE_WORDS = /\b(?:interest|interested|yes|positive|hot|warm|lead|ptp|promise|promised|commit|committed|agree|agreed|accept|accepted|confirm|confirmed|booked|booking|book|buy|buying|purchase|order|ordered|paid|payment done|will pay|rsvp|attending|attend|going|enrol|enroll|enrolled|signed up|sign up|register|registered|demo|visit|ready|keen|convert|converted|won|sale|deal)\b/i;
const NEGATIVE_WORDS = /\b(?:not|no|never|don'?t|dont|refus\w*|declin\w*|reject\w*|cancel\w*|wrong|dnd|stop|opt|unsubscribe|lost|dispute\w*|denied|deny|unreachable|invalid|later|maybe|unsure|undecided|busy|complain\w*|angry)\b|\bnot[\s_-]*interested\b|\bun(?:interested|available)\b/i;

export function isPositiveClassification(c: Pick<ReplyClassification, "key" | "label">): boolean {
  const words = `${String(c.key || "").replace(/[_\-.]+/g, " ")} ${String(c.label || "").replace(/[_\-.]+/g, " ")}`;
  return POSITIVE_WORDS.test(words) && !NEGATIVE_WORDS.test(words);
}

export function positiveClassifications(classifications: ReplyClassification[] | null | undefined): ReplyClassification[] {
  return (Array.isArray(classifications) ? classifications : []).filter(c => c && c.key && isPositiveClassification(c));
}

export interface CampaignFunnel {
  campaignId: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  interested: number;
  /** Labels of the outcome categories counted as "Interested" (empty → none configured). */
  interestedLabels: string[];
  needsHuman: number;
  aiPaused: number;
}

export async function getCampaignFunnel(businessAccountId: string, campaignId: string): Promise<CampaignFunnel | null> {
  const [campaign] = await db
    .select({ id: C.id, replyClassifications: C.replyClassifications })
    .from(C)
    .where(and(eq(C.id, campaignId), eq(C.businessAccountId, businessAccountId)))
    .limit(1);
  if (!campaign) return null;
  const positive = positiveClassifications(campaign.replyClassifications as ReplyClassification[]);
  const keys = positive.map(c => c.key);
  const interestedExpr = keys.length > 0
    ? sql<number>`COUNT(*) FILTER (WHERE ${R.primaryClassification} IN (${sql.join(keys.map(k => sql`${k}`), sql`, `)}))::int`
    : sql<number>`0`;
  // Each step counts everyone who got at least that far (a reply implies the message was read).
  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      sent: sql<number>`COUNT(*) FILTER (WHERE ${R.status} IN ('sent','delivered','read','replied'))::int`,
      delivered: sql<number>`COUNT(*) FILTER (WHERE ${R.status} IN ('delivered','read','replied'))::int`,
      read: sql<number>`COUNT(*) FILTER (WHERE ${R.status} IN ('read','replied'))::int`,
      replied: sql<number>`COUNT(*) FILTER (WHERE ${R.firstReplyAt} IS NOT NULL)::int`,
      interested: interestedExpr,
      needsHuman: sql<number>`COUNT(*) FILTER (WHERE ${R.needsHuman} OR ${R.callbackRequired})::int`,
      aiPaused: sql<number>`COUNT(*) FILTER (WHERE ${R.aiPaused})::int`,
    })
    .from(R)
    .where(and(eq(R.campaignId, campaignId), eq(R.businessAccountId, businessAccountId)));
  return {
    campaignId,
    total: Number(row?.total ?? 0),
    sent: Number(row?.sent ?? 0),
    delivered: Number(row?.delivered ?? 0),
    read: Number(row?.read ?? 0),
    replied: Number(row?.replied ?? 0),
    interested: Number(row?.interested ?? 0),
    interestedLabels: positive.map(c => c.label || c.key),
    needsHuman: Number(row?.needsHuman ?? 0),
    aiPaused: Number(row?.aiPaused ?? 0),
  };
}

// ── Replies inbox ────────────────────────────────────────────────────────────
export const INTERESTED_FILTER = "__interested__";
export const UNCLASSIFIED_FILTER = "__unclassified__";

export interface ReplyListFilters {
  campaignId?: string | null;
  /** Outcome key, INTERESTED_FILTER or UNCLASSIFIED_FILTER. */
  outcome?: string | null;
  needsHuman?: boolean;
  aiPaused?: boolean;
  unread?: boolean;
  /** Default true: only customers who replied. false = everyone the campaign was sent to. */
  repliedOnly?: boolean;
  search?: string | null;
  limit?: number;
  offset?: number;
}

const lastInboundAt = sql<Date | null>`(SELECT MAX(m.created_at) FROM marketing_campaign_messages m WHERE m.recipient_id = ${R.id} AND m.direction = 'inbound')`.mapWith(R.createdAt);
const lastMessageAt = sql<Date | null>`(SELECT MAX(m.created_at) FROM marketing_campaign_messages m WHERE m.recipient_id = ${R.id})`.mapWith(R.createdAt);
const lastMessageBody = sql<string | null>`(SELECT LEFT(m.body, 160) FROM marketing_campaign_messages m WHERE m.recipient_id = ${R.id} ORDER BY m.created_at DESC LIMIT 1)`;
const lastMessageDirection = sql<string | null>`(SELECT m.direction FROM marketing_campaign_messages m WHERE m.recipient_id = ${R.id} ORDER BY m.created_at DESC LIMIT 1)`;
const unreadExpr = sql`${lastInboundAt} > COALESCE(${R.staffLastReadAt}, 'epoch'::timestamp)`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`);
}

async function interestedCondition(businessAccountId: string, campaignId?: string | null): Promise<SQL> {
  const campaigns = await db
    .select({ id: C.id, replyClassifications: C.replyClassifications })
    .from(C)
    .where(campaignId ? and(eq(C.businessAccountId, businessAccountId), eq(C.id, campaignId)) : eq(C.businessAccountId, businessAccountId));
  const parts: SQL[] = [];
  for (const c of campaigns) {
    const keys = positiveClassifications(c.replyClassifications as ReplyClassification[]).map(p => p.key);
    if (keys.length === 0) continue;
    parts.push(sql`(${R.campaignId} = ${c.id} AND ${R.primaryClassification} IN (${sql.join(keys.map(k => sql`${k}`), sql`, `)}))`);
  }
  return parts.length > 0 ? sql`(${sql.join(parts, sql` OR `)})` : sql`FALSE`;
}

export async function listCampaignReplies(businessAccountId: string, filters: ReplyListFilters = {}) {
  const limit = Math.min(Math.max(Math.floor(filters.limit ?? 50), 1), 200);
  const offset = Math.max(Math.floor(filters.offset ?? 0), 0);
  const repliedOnly = filters.repliedOnly !== false;

  // Scope = what the counts describe; chips (needs human / AI paused / unread / outcome) narrow the rows.
  const scope: (SQL | undefined)[] = [
    eq(R.businessAccountId, businessAccountId),
    eq(C.businessAccountId, businessAccountId),
    filters.campaignId ? eq(R.campaignId, filters.campaignId) : undefined,
    repliedOnly ? sql`${R.firstReplyAt} IS NOT NULL` : undefined,
  ];
  const q = String(filters.search ?? "").trim().slice(0, 100);
  if (q) {
    const like = `%${escapeLike(q)}%`;
    const digits = q.replace(/\D/g, "");
    const phoneMatch = digits.length >= 3
      ? sql` OR regexp_replace(${R.phone}, '\\D', '', 'g') LIKE ${`%${digits}%`} OR COALESCE(${R.sendPhone}, '') LIKE ${`%${digits}%`}`
      : sql``;
    scope.push(sql`(${R.name} ILIKE ${like} OR ${R.phone} ILIKE ${like}${phoneMatch} OR EXISTS (SELECT 1 FROM marketing_campaign_messages sm WHERE sm.recipient_id = ${R.id} AND sm.business_account_id = ${businessAccountId} AND sm.body ILIKE ${like}))`);
  }

  const chips: (SQL | undefined)[] = [];
  if (filters.needsHuman) chips.push(sql`(${R.needsHuman} OR ${R.callbackRequired})`);
  if (filters.aiPaused) chips.push(sql`${R.aiPaused}`);
  if (filters.unread) chips.push(unreadExpr);
  if (filters.outcome) {
    if (filters.outcome === INTERESTED_FILTER) chips.push(await interestedCondition(businessAccountId, filters.campaignId));
    else if (filters.outcome === UNCLASSIFIED_FILTER) chips.push(sql`${R.firstReplyAt} IS NOT NULL AND ${R.primaryClassification} IS NULL`);
    else chips.push(eq(R.primaryClassification, filters.outcome));
  }

  const where = and(...scope, ...chips);
  const order = repliedOnly
    ? [sql`${lastInboundAt} DESC NULLS LAST`, desc(R.firstReplyAt), desc(R.createdAt)]
    : [sql`${R.firstReplyAt} DESC NULLS LAST`, desc(R.createdAt)];

  const [rows, [counts]] = await Promise.all([
    db
      .select({
        ...getTableColumns(R),
        campaignName: C.name,
        campaignAiEnabled: C.aiEnabled,
        campaignClassifications: C.replyClassifications,
        lastInboundAt,
        lastMessageAt,
        lastMessageBody,
        lastMessageDirection,
      })
      .from(R)
      .innerJoin(C, eq(C.id, R.campaignId))
      .where(where)
      .orderBy(...order)
      .limit(limit)
      .offset(offset),
    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        matching: sql<number>`COUNT(*) FILTER (WHERE ${chips.length > 0 ? and(...chips)! : sql`TRUE`})::int`,
        needsHuman: sql<number>`COUNT(*) FILTER (WHERE ${R.needsHuman} OR ${R.callbackRequired})::int`,
        aiPaused: sql<number>`COUNT(*) FILTER (WHERE ${R.aiPaused})::int`,
        unread: sql<number>`COUNT(*) FILTER (WHERE ${unreadExpr})::int`,
      })
      .from(R)
      .innerJoin(C, eq(C.id, R.campaignId))
      .where(and(...scope)),
  ]);

  const items = rows.map(({ campaignClassifications, providerResponse, attributes, ...r }) => {
    const labels = new Map(((campaignClassifications || []) as ReplyClassification[]).map(c => [c.key, c.label || c.key]));
    const positive = new Set(positiveClassifications(campaignClassifications as ReplyClassification[]).map(c => c.key));
    const lastIn = r.lastInboundAt ? new Date(r.lastInboundAt) : null;
    return {
      ...r,
      classificationLabel: r.primaryClassification ? labels.get(r.primaryClassification) || r.primaryClassification : null,
      interested: !!r.primaryClassification && positive.has(r.primaryClassification),
      unread: !!lastIn && (!r.staffLastReadAt || lastIn.getTime() > new Date(r.staffLastReadAt).getTime()),
      needsHumanAny: !!(r.needsHuman || r.callbackRequired),
    };
  });

  return {
    items,
    counts: {
      total: Number(counts?.total ?? 0),
      matching: Number(counts?.matching ?? 0),
      needsHuman: Number(counts?.needsHuman ?? 0),
      aiPaused: Number(counts?.aiPaused ?? 0),
      unread: Number(counts?.unread ?? 0),
    },
    limit,
    offset,
  };
}

// ── One thread ──────────────────────────────────────────────────────────────
async function loadRecipient(businessAccountId: string, recipientId: string) {
  const [row] = await db
    .select({ ...getTableColumns(R), campaignName: C.name, campaignAiEnabled: C.aiEnabled, campaignAiAgentName: C.aiAgentName, campaignClassifications: C.replyClassifications })
    .from(R)
    .innerJoin(C, eq(C.id, R.campaignId))
    .where(and(eq(R.id, recipientId), eq(R.businessAccountId, businessAccountId), eq(C.businessAccountId, businessAccountId)))
    .limit(1);
  return row || null;
}

function last10(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export interface CustomerWindow {
  open: boolean;
  lastCustomerMessageAt: string | null;
  closesAt: string | null;
  /** The number the customer writes from (the WhatsApp session's), for sending. */
  sendTo: string;
}

/**
 * WhatsApp's 24-hour customer-service window: open while the customer's last message to the
 * business is under 24 hours old (their campaign replies or any WhatsApp message, via the
 * WhatsApp session), and not marked expired by the provider since.
 */
export async function getCustomerWindow(
  businessAccountId: string,
  recipient: { id: string; phone: string; sendPhone: string | null },
  now: Date = new Date(),
): Promise<CustomerWindow> {
  const [threadRow] = await db
    .select({ at: sql<Date | null>`MAX(${M.createdAt})`.mapWith(M.createdAt) })
    .from(M)
    .where(and(eq(M.recipientId, recipient.id), eq(M.businessAccountId, businessAccountId), eq(M.direction, "inbound")));
  const threadLast = threadRow?.at ? new Date(threadRow.at) : null;
  const tail = last10(recipient.sendPhone || recipient.phone);
  const [session] = tail.length >= 6
    ? await db
        .select()
        .from(whatsappSessions)
        .where(and(eq(whatsappSessions.businessAccountId, businessAccountId), sql`RIGHT(${whatsappSessions.phoneNumber}, ${tail.length}) = ${tail}`))
        .orderBy(desc(whatsappSessions.lastUserMessageAt))
        .limit(1)
    : [];
  const sessionLast = session?.lastUserMessageAt ? new Date(session.lastUserMessageAt) : null;
  const last = [threadLast, sessionLast].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] || null;
  const expiredByProvider = !!session && session.sessionActive === false && !!sessionLast && (!threadLast || sessionLast.getTime() >= threadLast.getTime());
  const open = !!last && now.getTime() - last.getTime() < CUSTOMER_WINDOW_MS && !expiredByProvider;
  return {
    open,
    lastCustomerMessageAt: last ? last.toISOString() : null,
    closesAt: last ? new Date(last.getTime() + CUSTOMER_WINDOW_MS).toISOString() : null,
    sendTo: session?.phoneNumber || recipient.sendPhone || recipient.phone,
  };
}

export async function getCampaignReplyThread(businessAccountId: string, recipientId: string, opts: { markRead?: boolean } = {}) {
  const recipient = await loadRecipient(businessAccountId, recipientId);
  if (!recipient) return null;
  const [messages, window] = await Promise.all([
    db
      .select()
      .from(M)
      .where(and(eq(M.recipientId, recipientId), eq(M.businessAccountId, businessAccountId)))
      .orderBy(asc(M.createdAt)),
    getCustomerWindow(businessAccountId, recipient),
  ]);
  if (opts.markRead !== false) {
    await db.update(R).set({ staffLastReadAt: new Date() }).where(and(eq(R.id, recipientId), eq(R.businessAccountId, businessAccountId)));
  }
  const { campaignClassifications, providerResponse, attributes, ...rest } = recipient;
  const labels = new Map(((campaignClassifications || []) as ReplyClassification[]).map(c => [c.key, c.label || c.key]));
  return {
    recipient: {
      ...rest,
      classificationLabel: rest.primaryClassification ? labels.get(rest.primaryClassification) || rest.primaryClassification : null,
      needsHumanAny: !!(rest.needsHuman || rest.callbackRequired),
    },
    messages,
    window: { open: window.open, lastCustomerMessageAt: window.lastCustomerMessageAt, closesAt: window.closesAt },
  };
}

// ── Staff takeover ──────────────────────────────────────────────────────────
export interface SendResult { success: boolean; messageId?: string; error?: string; usedTemplate?: boolean }

/** Overridable in tests — never send real WhatsApp messages from a test. */
export const campaignRepliesDeps = {
  /** The same send path campaign AI replies use (session-aware MSG91 send). */
  async sendText(businessAccountId: string, phone: string, text: string): Promise<SendResult> {
    const [settings] = await db.select().from(whatsappSettings).where(eq(whatsappSettings.businessAccountId, businessAccountId)).limit(1);
    if (!settings) return { success: false, error: "WhatsApp is not connected for this business." };
    const { whatsappAutoReplyService } = await import("./whatsappAutoReplyService");
    return whatsappAutoReplyService.sendSessionAwareMessage(settings, phone, text);
  },
};

export type ManualReplyOutcome =
  | { ok: true; message: typeof marketingCampaignMessages.$inferSelect }
  | { ok: false; status: number; code: "not_found" | "empty" | "too_long" | "window_closed" | "opted_out" | "send_failed"; error: string };

export async function sendManualReply(
  businessAccountId: string,
  recipientId: string,
  rawText: string,
  staff: { userId?: string | null; name?: string | null } = {},
  opts: { pauseAi?: boolean } = {},
): Promise<ManualReplyOutcome> {
  const text = String(rawText ?? "").trim();
  if (!text) return { ok: false, status: 400, code: "empty", error: "Type a message first." };
  if (text.length > MANUAL_REPLY_MAX_CHARS) return { ok: false, status: 400, code: "too_long", error: `Messages can be at most ${MANUAL_REPLY_MAX_CHARS} characters.` };
  const recipient = await loadRecipient(businessAccountId, recipientId);
  if (!recipient) return { ok: false, status: 404, code: "not_found", error: "This conversation was not found." };
  if (recipient.status === "opted_out") {
    return { ok: false, status: 409, code: "opted_out", error: "This customer opted out of messages, so you can't reply here." };
  }
  const window = await getCustomerWindow(businessAccountId, recipient);
  if (!window.open) {
    return {
      ok: false, status: 409, code: "window_closed",
      error: "WhatsApp only allows a free-text reply within 24 hours of the customer's last message. This window has closed — the customer needs to message you first (or send them an approved template).",
    };
  }

  let result: SendResult;
  try {
    result = await campaignRepliesDeps.sendText(businessAccountId, window.sendTo, text);
  } catch (err: any) {
    result = { success: false, error: err?.message || "Send failed" };
  }
  if (result.usedTemplate) {
    return { ok: false, status: 409, code: "window_closed", error: "WhatsApp says the 24-hour reply window has closed, so your message was not delivered." };
  }
  if (!result.success) {
    return { ok: false, status: 502, code: "send_failed", error: result.error ? `WhatsApp didn't accept the message: ${result.error}` : "WhatsApp didn't accept the message. Please try again." };
  }

  const [message] = await db.insert(M).values({
    campaignId: recipient.campaignId,
    recipientId,
    businessAccountId,
    direction: "outbound_staff",
    body: text,
    metadata: { source: "staff", sentBy: staff.name || null, userId: staff.userId || null, messageId: result.messageId || null, sendSuccess: true },
  }).returning();
  // Staff took over: by default the AI stops replying to this customer until resumed.
  const updates: Record<string, unknown> = { staffLastReadAt: new Date() };
  if (opts.pauseAi !== false && !recipient.aiPaused) {
    updates.aiPaused = true;
    updates.aiPausedAt = new Date();
    updates.aiPausedReason = "staff";
  }
  await db.update(R).set(updates).where(and(eq(R.id, recipientId), eq(R.businessAccountId, businessAccountId)));
  return { ok: true, message };
}

/** Pause / resume the campaign AI for one customer. Resuming also clears "Needs human". */
export async function setCampaignAiPaused(businessAccountId: string, recipientId: string, paused: boolean): Promise<boolean> {
  const set = paused
    ? { aiPaused: true, aiPausedAt: new Date(), aiPausedReason: "staff" }
    : { aiPaused: false, aiPausedAt: null, aiPausedReason: null, needsHuman: false, needsHumanReason: null, needsHumanAt: null, handoverSentAt: null };
  const rows = await db.update(R).set(set as any).where(and(eq(R.id, recipientId), eq(R.businessAccountId, businessAccountId))).returning({ id: R.id });
  return rows.length > 0;
}

/** "Mark as handled": clears Needs human (and the classifier's callback flag); AI stays as it is. */
export async function markCampaignReplyHandled(businessAccountId: string, recipientId: string): Promise<boolean> {
  const rows = await db
    .update(R)
    .set({ needsHuman: false, needsHumanReason: null, needsHumanAt: null, callbackRequired: false })
    .where(and(eq(R.id, recipientId), eq(R.businessAccountId, businessAccountId)))
    .returning({ id: R.id });
  return rows.length > 0;
}

/**
 * Automatic handover (campaignAiService): pause the AI, flag Needs human and claim the right
 * to send the ONE handover message. Atomic — two messages arriving together can't both send it,
 * and nothing re-triggers while the AI stays paused.
 */
export async function claimHandover(recipientId: string, note: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(R)
    .set({ aiPaused: true, aiPausedAt: now, aiPausedReason: "handover", needsHuman: true, needsHumanReason: note.slice(0, 300), needsHumanAt: now, handoverSentAt: now })
    .where(and(eq(R.id, recipientId), eq(R.aiPaused, false), sql`${R.handoverSentAt} IS NULL`))
    .returning({ id: R.id });
  return rows.length > 0;
}
