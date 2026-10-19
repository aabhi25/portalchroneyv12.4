import fs from "fs";
import path from "path";
import { and, eq, inArray, sql, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  accountGroupMembers,
  appointments,
  conversations,
  dataPurgeLog,
  dataRetentionAccountStatus,
  dataRetentionPolicies,
  jobApplicants,
  journeyResponses,
  journeySessions,
  leads,
  messages,
  questionBankEntries,
  supportTickets,
  topscholarVoiceSessions,
  type DataRetentionPolicy,
} from "@shared/schema";
import {
  combineGroupPolicies,
  classifyLeadForCounts,
  isPolicyActive,
  MASK_FALLBACK_QUIET_MINUTES,
  MASK_QUIET_MINUTES,
  RETENTION_IDLE_GUARD_MINUTES,
  type AccountCrmTargets,
  type EffectiveRetentionPolicy,
  type RetentionPolicySettings,
} from "@shared/dataRetentionPolicy";
import { maskContactsDeep, maskContactsInJsonText, maskContactsInText, maskEmailAddress, maskPhoneNumber, isMaskedValue } from "@shared/contactMasking";

/**
 * Database side of data retention ("auto-delete"): policy lookup, the due-record
 * queries (same rules as dataRetentionPolicy.decideLead) and the batched purge.
 */

const BATCH_SIZE = 500;

/**
 * Timestamps in raw SQL must be passed as UTC ISO strings: drizzle stores
 * `timestamp` columns in UTC, but node-postgres would serialize a raw Date in
 * the server's local timezone, shifting every cut-off on a non-UTC server.
 */
const ts = (d: Date) => d.toISOString();

function toSettings(row: DataRetentionPolicy): RetentionPolicySettings & { scopeId: string } {
  return {
    scopeId: row.scopeId,
    mode: (row.mode as RetentionPolicySettings['mode']) || 'off',
    deleteSyncedAfterMinutes: row.deleteSyncedAfterMinutes,
    deleteUnsyncedAfterMinutes: row.deleteUnsyncedAfterMinutes ?? null,
    deleteIdleChatsAfterMinutes: row.deleteIdleChatsAfterMinutes ?? null,
    keepAnonymousCounts: row.keepAnonymousCounts,
    maskContactsAfterSync: row.maskContactsAfterSync === true,
  };
}

export async function getRetentionPolicy(scopeType: 'group' | 'account', scopeId: string): Promise<DataRetentionPolicy | null> {
  const [row] = await db.select().from(dataRetentionPolicies)
    .where(and(eq(dataRetentionPolicies.scopeType, scopeType), eq(dataRetentionPolicies.scopeId, scopeId)))
    .limit(1);
  return row || null;
}

export async function upsertRetentionPolicy(
  scopeType: 'group' | 'account',
  scopeId: string,
  settings: RetentionPolicySettings,
  updatedBy: string,
): Promise<DataRetentionPolicy> {
  const values = {
    scopeType,
    scopeId,
    mode: settings.mode,
    deleteSyncedAfterMinutes: settings.deleteSyncedAfterMinutes,
    deleteUnsyncedAfterMinutes: settings.deleteUnsyncedAfterMinutes,
    deleteIdleChatsAfterMinutes: settings.deleteIdleChatsAfterMinutes,
    keepAnonymousCounts: settings.keepAnonymousCounts,
    maskContactsAfterSync: settings.maskContactsAfterSync,
    updatedBy,
    updatedAt: new Date(),
  };
  const [row] = await db.insert(dataRetentionPolicies).values(values)
    .onConflictDoUpdate({ target: [dataRetentionPolicies.scopeType, dataRetentionPolicies.scopeId], set: values })
    .returning();
  return row;
}

export async function deleteAccountOverride(accountId: string): Promise<void> {
  await db.delete(dataRetentionPolicies)
    .where(and(eq(dataRetentionPolicies.scopeType, 'account'), eq(dataRetentionPolicies.scopeId, accountId)));
}

/**
 * Account override wins; otherwise the strictest active policy of the account's groups; otherwise
 * null. A policy with mode 'off' is still returned when it hides contact details.
 */
export async function getEffectivePolicy(accountId: string): Promise<EffectiveRetentionPolicy | null> {
  const own = await getRetentionPolicy('account', accountId);
  if (own) {
    const s = toSettings(own);
    return isPolicyActive(s) ? { ...s, source: 'account', sourceIds: [accountId] } : null;
  }
  const groupIds = (await db.select({ groupId: accountGroupMembers.groupId }).from(accountGroupMembers)
    .where(eq(accountGroupMembers.businessAccountId, accountId))).map(r => r.groupId);
  if (groupIds.length === 0) return null;
  const rows = await db.select().from(dataRetentionPolicies)
    .where(and(eq(dataRetentionPolicies.scopeType, 'group'), inArray(dataRetentionPolicies.scopeId, groupIds)));
  return combineGroupPolicies(rows.map(toSettings));
}

/** Every account that currently has an active policy (deleting or hiding), directly or via a group. */
export async function getAccountsWithActivePolicy(): Promise<string[]> {
  const rows = await db.select().from(dataRetentionPolicies)
    .where(sql`${dataRetentionPolicies.mode} <> 'off' OR ${dataRetentionPolicies.maskContactsAfterSync} = true`);
  const ids = new Set<string>(rows.filter(r => r.scopeType === 'account').map(r => r.scopeId));
  const groupIds = rows.filter(r => r.scopeType === 'group').map(r => r.scopeId);
  if (groupIds.length) {
    const members = await db.select({ id: accountGroupMembers.businessAccountId }).from(accountGroupMembers)
      .where(inArray(accountGroupMembers.groupId, groupIds));
    members.forEach(m => ids.add(m.id));
  }
  return Array.from(ids);
}

export async function getAccountCrmTargets(accountId: string): Promise<AccountCrmTargets> {
  const { isLeadSquaredConfigured, isSalesforceConfigured } = await import('./crmLeadSync');
  const settings = await storage.getWidgetSettings(accountId);
  return { leadsquared: isLeadSquaredConfigured(settings), salesforce: isSalesforceConfigured(settings) };
}

// ---------------------------------------------------------------------------
// Due-record queries (mirror decideLead in dataRetentionPolicy.ts)
// ---------------------------------------------------------------------------

function syncedSql(crm: AccountCrmTargets) {
  const parts = [];
  if (crm.leadsquared) parts.push(sql`COALESCE(${leads.leadsquaredSyncStatus}, '') = 'synced'`);
  if (crm.salesforce) parts.push(sql`COALESCE(${leads.salesforceSyncStatus}, '') = 'synced'`);
  if (parts.length === 0) return sql`false`;
  return sql.join(parts, sql` AND `);
}

function syncedAtSql(crm: AccountCrmTargets) {
  const cols = [];
  if (crm.leadsquared) cols.push(sql`${leads.leadsquaredSyncedAt}`);
  if (crm.salesforce) cols.push(sql`${leads.salesforceSyncedAt}`);
  if (cols.length === 0) return sql`${leads.createdAt}`;
  return sql`COALESCE(GREATEST(${sql.join(cols, sql`, `)}), ${leads.createdAt})`;
}

function dueLeadsWhere(accountId: string, policy: RetentionPolicySettings, crm: AccountCrmTargets, now: Date) {
  const syncedCutoff = new Date(now.getTime() - policy.deleteSyncedAfterMinutes * 60_000);
  const idleCutoff = new Date(now.getTime() - RETENTION_IDLE_GUARD_MINUTES * 60_000);
  const synced = syncedSql(crm);
  const byTimer = policy.deleteUnsyncedAfterMinutes !== null
    ? sql`(${synced} AND ${syncedAtSql(crm)} <= ${ts(syncedCutoff)}) OR (NOT (${synced}) AND ${leads.createdAt} <= ${ts(new Date(now.getTime() - policy.deleteUnsyncedAfterMinutes * 60_000))})`
    : sql`(${synced} AND ${syncedAtSql(crm)} <= ${ts(syncedCutoff)})`;
  return sql`${leads.businessAccountId} = ${accountId}
    AND (${byTimer})
    AND (${leads.conversationId} IS NULL OR NOT EXISTS (
      SELECT 1 FROM ${messages} m WHERE m.conversation_id = ${leads.conversationId} AND m.created_at > ${ts(idleCutoff)}
    ))`;
}

function idleChatsWhere(accountId: string, idleMinutes: number, now: Date) {
  const cutoff = new Date(now.getTime() - Math.max(idleMinutes, RETENTION_IDLE_GUARD_MINUTES) * 60_000);
  return sql`${conversations.businessAccountId} = ${accountId}
    AND ${conversations.createdAt} <= ${ts(cutoff)}
    AND NOT EXISTS (SELECT 1 FROM ${leads} l WHERE l.conversation_id = ${conversations.id})
    AND NOT EXISTS (SELECT 1 FROM ${messages} m WHERE m.conversation_id = ${conversations.id} AND m.created_at > ${ts(cutoff)})`;
}

export async function countDueForAccount(accountId: string, policy: RetentionPolicySettings, now = new Date()) {
  const crm = await getAccountCrmTargets(accountId);
  const [leadRow] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(dueLeadsWhere(accountId, policy, crm, now));
  let chats = 0;
  if (policy.deleteIdleChatsAfterMinutes !== null) {
    const [chatRow] = await db.select({ n: sql<number>`count(*)::int` }).from(conversations)
      .where(idleChatsWhere(accountId, policy.deleteIdleChatsAfterMinutes, now));
    chats = chatRow?.n ?? 0;
  }
  return { leads: leadRow?.n ?? 0, idleChats: chats };
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

/**
 * Deletes a file we stored: local /uploads, a public R2 URL of our bucket, or a private
 * `r2private://<key>` reference (sensitive customer documents). Best effort.
 */
export async function deleteStoredFile(url: string) {
  try {
    if (url.startsWith('/uploads/')) {
      const filePath = path.join(process.cwd(), url.replace(/^\/+/, ''));
      if (filePath.startsWith(path.join(process.cwd(), 'uploads'))) await fs.promises.unlink(filePath).catch(() => {});
      return;
    }
    const { r2Storage } = await import('./r2StorageService');
    // parseRef only matches our own buckets (R2_PUBLIC_URL, pub-*.r2.dev, r2private://).
    await r2Storage.deleteByRef(url);
  } catch (err: any) {
    console.warn('[Data Retention] Could not delete stored file:', err?.message);
  }
}

/** Removes conversations (and everything hanging off them) plus the given leads, in one transaction. */
async function deleteRecords(accountId: string, leadIds: string[], conversationIds: string[]) {
  const fileUrls: string[] = [];
  if (conversationIds.length) {
    const rows = await db.select({ url: messages.imageUrl }).from(messages)
      .where(and(inArray(messages.conversationId, conversationIds), sql`${messages.imageUrl} IS NOT NULL`));
    rows.forEach(r => r.url && fileUrls.push(r.url));
  }

  await db.transaction(async (tx) => {
    if (leadIds.length) {
      await tx.delete(appointments).where(and(eq(appointments.businessAccountId, accountId), inArray(appointments.leadId, leadIds)));
    }
    if (conversationIds.length) {
      await tx.delete(appointments).where(and(eq(appointments.businessAccountId, accountId), inArray(appointments.conversationId, conversationIds)));
      await tx.delete(supportTickets).where(and(eq(supportTickets.businessAccountId, accountId), inArray(supportTickets.conversationId, conversationIds)));
      await tx.delete(jobApplicants).where(and(eq(jobApplicants.businessAccountId, accountId), inArray(jobApplicants.conversationId, conversationIds)));
      await tx.delete(topscholarVoiceSessions).where(and(eq(topscholarVoiceSessions.businessAccountId, accountId), inArray(topscholarVoiceSessions.conversationId, conversationIds)));
    }
    if (leadIds.length) {
      await tx.delete(leads).where(and(eq(leads.businessAccountId, accountId), inArray(leads.id, leadIds)));
    }
    if (conversationIds.length) {
      // Cascades: messages, journey responses/sessions, OTP challenges. Question bank
      // entries and urgency offers keep their row with the link cleared.
      await tx.delete(conversations).where(and(eq(conversations.businessAccountId, accountId), inArray(conversations.id, conversationIds)));
    }
  });

  for (const url of fileUrls) await deleteStoredFile(url);
  return fileUrls.length;
}

async function journeyConversationIds(conversationIds: string[]): Promise<Set<string>> {
  if (conversationIds.length === 0) return new Set();
  const rows = await db.select({ id: journeySessions.conversationId }).from(journeySessions)
    .where(inArray(journeySessions.conversationId, conversationIds));
  return new Set(rows.map(r => r.id));
}

export interface PurgeResult {
  leads: number;
  conversations: number;
  files: number;
}

/**
 * Deletes everything due for one account under `policy`, in batches. Runs until
 * nothing is due or `maxBatches` is reached (the worker comes back next run).
 */
export async function purgeAccount(accountId: string, policy: EffectiveRetentionPolicy, maxBatches = 20): Promise<PurgeResult> {
  const result: PurgeResult = { leads: 0, conversations: 0, files: 0 };
  const crm = await getAccountCrmTargets(accountId);

  // 1) Leads due, with their conversations.
  for (let batch = 0; batch < maxBatches; batch++) {
    const now = new Date();
    const due = await db.select({
      id: leads.id,
      conversationId: leads.conversationId,
      createdAt: leads.createdAt,
      topicsOfInterest: leads.topicsOfInterest,
      sourceUrl: leads.sourceUrl,
      lsqStatus: leads.leadsquaredSyncStatus,
      lsqId: leads.leadsquaredLeadId,
      lsqAt: leads.leadsquaredSyncedAt,
      sfStatus: leads.salesforceSyncStatus,
      sfId: leads.salesforceLeadId,
      sfAt: leads.salesforceSyncedAt,
    }).from(leads).where(dueLeadsWhere(accountId, policy, crm, now)).orderBy(leads.createdAt).limit(BATCH_SIZE);
    if (due.length === 0) break;

    const leadIds = due.map(l => l.id);
    const candidateConvIds = Array.from(new Set(due.map(l => l.conversationId).filter((id): id is string => !!id)));
    // A conversation shared with a lead that is NOT being deleted stays.
    const stillUsed = candidateConvIds.length
      ? new Set((await db.select({ id: leads.conversationId }).from(leads)
          .where(and(inArray(leads.conversationId, candidateConvIds), sql`${leads.id} NOT IN (${sql.join(leadIds.map(id => sql`${id}`), sql`, `)})`)))
          .map(r => r.id))
      : new Set<string | null>();
    const convIds = candidateConvIds.filter(id => !stillUsed.has(id));
    const journeyIds = await journeyConversationIds(candidateConvIds);

    const { leadSyncState } = await import('@shared/dataRetentionPolicy');
    const leadTombstones = due.map(l => {
      const state = leadSyncState({
        leadsquaredSyncStatus: l.lsqStatus, leadsquaredSyncedAt: l.lsqAt,
        salesforceSyncStatus: l.sfStatus, salesforceSyncedAt: l.sfAt,
      }, crm);
      const cls = classifyLeadForCounts(l, !!(l.conversationId && journeyIds.has(l.conversationId)));
      return {
        businessAccountId: accountId,
        recordType: 'lead',
        recordId: l.id,
        capturedAt: l.createdAt,
        purgedAt: new Date(), // set here (UTC via drizzle), not by the DB clock
        reason: state.synced ? 'synced_retention' : 'unsynced_retention',
        synced: state.synced,
        syncedAt: state.syncedAt,
        crmLeadId: l.lsqId || l.sfId || null,
        source: cls.source,
        isDiscount: cls.isDiscount,
        isPaid: cls.isPaid,
        countInAnalytics: policy.keepAnonymousCounts,
      };
    });
    const formConvIds = new Set(due.filter(l => classifyLeadForCounts(l, false).source === 'form').map(l => l.conversationId));
    const discountConvIds = new Set(due.filter(l => classifyLeadForCounts(l, false).isDiscount).map(l => l.conversationId));
    const convRows = convIds.length
      ? await db.select({ id: conversations.id, createdAt: conversations.createdAt }).from(conversations).where(inArray(conversations.id, convIds))
      : [];
    const convTombstones = convRows.map(c => ({
      businessAccountId: accountId,
      recordType: 'conversation',
      recordId: c.id,
      capturedAt: c.createdAt,
        purgedAt: new Date(),
      reason: 'with_lead',
      source: journeyIds.has(c.id) ? 'journey' : formConvIds.has(c.id) ? 'form' : 'chat',
      isDiscount: discountConvIds.has(c.id),
      countInAnalytics: policy.keepAnonymousCounts,
    }));

    // Tombstones first: if the delete then fails, the next run retries and the
    // duplicate tombstone is harmless (reports count distinct record IDs).
    await db.insert(dataPurgeLog).values([...leadTombstones, ...convTombstones]);
    result.files += await deleteRecords(accountId, leadIds, convRows.map(c => c.id));
    result.leads += leadIds.length;
    result.conversations += convRows.length;
    if (due.length < BATCH_SIZE) break;
  }

  // 2) Chats that never produced a lead.
  if (policy.deleteIdleChatsAfterMinutes !== null) {
    for (let batch = 0; batch < maxBatches; batch++) {
      const rows = await db.select({ id: conversations.id, createdAt: conversations.createdAt }).from(conversations)
        .where(idleChatsWhere(accountId, policy.deleteIdleChatsAfterMinutes, new Date()))
        .orderBy(conversations.createdAt).limit(BATCH_SIZE);
      if (rows.length === 0) break;
      const journeyIds = await journeyConversationIds(rows.map(r => r.id));
      await db.insert(dataPurgeLog).values(rows.map(c => ({
        businessAccountId: accountId,
        recordType: 'conversation',
        recordId: c.id,
        capturedAt: c.createdAt,
        purgedAt: new Date(),
        reason: 'idle_chat',
        source: journeyIds.has(c.id) ? 'journey' : 'chat',
        countInAnalytics: policy.keepAnonymousCounts,
      })));
      result.files += await deleteRecords(accountId, [], rows.map(r => r.id));
      result.conversations += rows.length;
      if (rows.length < BATCH_SIZE) break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hide contact details after sync (separate from deleting)
// ---------------------------------------------------------------------------

/**
 * Synced leads whose contact details are due to be hidden: never hidden yet, or changed / chatted
 * since (a returning visitor may share details again). The chat must be quiet and its final
 * summary already pushed to the CRM (or quiet long enough that no summary is coming), so the CRM
 * always gets the real details and the full summary first.
 */
function dueMaskWhere(accountId: string, crm: AccountCrmTargets, now: Date) {
  const quiet = ts(new Date(now.getTime() - MASK_QUIET_MINUTES * 60_000));
  const fallback = ts(new Date(now.getTime() - MASK_FALLBACK_QUIET_MINUTES * 60_000));
  return sql`${leads.businessAccountId} = ${accountId}
    AND (${syncedSql(crm)})
    AND (
      ${leads.contactsMaskedAt} IS NULL
      OR ${leads.updatedAt} > ${leads.contactsMaskedAt}
      OR EXISTS (SELECT 1 FROM ${messages} m WHERE m.conversation_id = ${leads.conversationId} AND m.created_at > ${leads.contactsMaskedAt})
    )
    AND (${leads.conversationId} IS NULL OR (
      NOT EXISTS (SELECT 1 FROM ${messages} m WHERE m.conversation_id = ${leads.conversationId} AND m.created_at > ${quiet})
      AND (
        NOT EXISTS (SELECT 1 FROM ${messages} m WHERE m.conversation_id = ${leads.conversationId} AND m.created_at > ${fallback})
        OR EXISTS (SELECT 1 FROM ${conversations} c WHERE c.id = ${leads.conversationId} AND c.summarized_at IS NOT NULL AND c.summarized_at >= c.updated_at)
        OR (SELECT count(*) FROM ${messages} m WHERE m.conversation_id = ${leads.conversationId}) < 3
      )
    ))`;
}

export async function countMaskDueForAccount(accountId: string, now = new Date()): Promise<number> {
  const crm = await getAccountCrmTargets(accountId);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(dueMaskWhere(accountId, crm, now));
  return row?.n ?? 0;
}

const maskText = (v: string | null) => (v ? maskContactsInText(v) : v);
const keepOrMask = (v: string | null, mask: (x: string) => string) => (!v || isMaskedValue(v) ? v : mask(v));

/** Overwrites one lead's contact details, and those in its chat, answers and summary. */
async function maskLeadContacts(accountId: string, lead: typeof leads.$inferSelect, at: Date) {
  const convId = lead.conversationId;
  const chat = convId
    ? await db.select({ id: messages.id, content: messages.content, metadata: messages.metadata, createdAt: messages.createdAt }).from(messages).where(eq(messages.conversationId, convId))
    : [];
  const answers = convId
    ? await db.select({ id: journeyResponses.id, response: journeyResponses.response }).from(journeyResponses).where(eq(journeyResponses.conversationId, convId))
    : [];
  const [conv] = convId
    ? await db.select({ title: conversations.title, summary: conversations.summary, topicKeywords: conversations.topicKeywords })
        .from(conversations).where(and(eq(conversations.id, convId), eq(conversations.businessAccountId, accountId)))
    : [];
  const questions = convId
    ? await db.select({ id: questionBankEntries.id, question: questionBankEntries.question, aiResponse: questionBankEntries.aiResponse, userContext: questionBankEntries.userContext })
        .from(questionBankEntries).where(and(eq(questionBankEntries.conversationId, convId), eq(questionBankEntries.businessAccountId, accountId)))
    : [];

  // Stamped no earlier than the newest message and lead change it covers, so the lead is not
  // picked up again until something new arrives (even if the database clock runs ahead).
  const stamp = new Date(Math.max(at.getTime(), lead.updatedAt?.getTime() ?? 0, ...chat.map(m => m.createdAt?.getTime() ?? 0)));

  await db.transaction(async (tx) => {
    // updatedAt is left alone so the lead/conversation does not look changed (no re-summary, no re-run).
    await tx.update(leads).set({
      phone: keepOrMask(lead.phone, maskPhoneNumber),
      email: keepOrMask(lead.email, maskEmailAddress),
      message: maskText(lead.message),
      leadsquaredSyncPayload: lead.leadsquaredSyncPayload ? maskContactsDeep(lead.leadsquaredSyncPayload) : lead.leadsquaredSyncPayload,
      customCrmSyncPayload: lead.customCrmSyncPayload ? maskContactsDeep(lead.customCrmSyncPayload) : lead.customCrmSyncPayload,
      leadsquaredSyncError: maskText(lead.leadsquaredSyncError),
      salesforceSyncError: maskText(lead.salesforceSyncError),
      customCrmSyncError: maskText(lead.customCrmSyncError),
      contactsMaskedAt: stamp,
    }).where(and(eq(leads.id, lead.id), eq(leads.businessAccountId, accountId)));

    for (const m of chat) {
      const content = maskContactsInText(m.content);
      const metadata = m.metadata ? maskContactsInJsonText(m.metadata) : m.metadata;
      if (content !== m.content || metadata !== m.metadata) {
        await tx.update(messages).set({ content, metadata }).where(eq(messages.id, m.id));
      }
    }
    for (const a of answers) {
      const response = maskContactsInText(a.response);
      if (response !== a.response) await tx.update(journeyResponses).set({ response }).where(eq(journeyResponses.id, a.id));
    }
    if (convId && conv) {
      const next = { title: maskContactsInText(conv.title), summary: maskText(conv.summary), topicKeywords: maskText(conv.topicKeywords) };
      if (next.title !== conv.title || next.summary !== conv.summary || next.topicKeywords !== conv.topicKeywords) {
        await tx.update(conversations).set(next).where(eq(conversations.id, convId));
      }
    }
    for (const q of questions) {
      const next = { question: maskContactsInText(q.question), aiResponse: maskText(q.aiResponse), userContext: q.userContext ? maskContactsInJsonText(q.userContext) : q.userContext };
      if (next.question !== q.question || next.aiResponse !== q.aiResponse || next.userContext !== q.userContext) {
        await tx.update(questionBankEntries).set(next).where(eq(questionBankEntries.id, q.id));
      }
    }
  });
  return { messages: chat.length };
}

/** Hides contact details on every due lead of one account, in batches. Returns how many leads were hidden. */
export async function maskAccountContacts(accountId: string, maxBatches = 20): Promise<number> {
  const crm = await getAccountCrmTargets(accountId);
  if (!crm.leadsquared && !crm.salesforce) return 0; // nothing ever counts as synced
  let masked = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const due = await db.select().from(leads).where(dueMaskWhere(accountId, crm, new Date())).orderBy(leads.createdAt).limit(MASK_BATCH_SIZE);
    if (due.length === 0) break;
    for (const lead of due) {
      await maskLeadContacts(accountId, lead, new Date());
      masked++;
    }
    if (due.length < MASK_BATCH_SIZE) break;
  }
  return masked;
}

const MASK_BATCH_SIZE = 100;

export async function recordAccountStatus(accountId: string, values: {
  mode: string; dueLeads: number; dueConversations: number; purgedLeads: number; purgedConversations: number; error?: string | null;
}) {
  const row = {
    businessAccountId: accountId,
    mode: values.mode,
    lastRunAt: new Date(),
    dueLeads: values.dueLeads,
    dueConversations: values.dueConversations,
    lastPurgedLeads: values.purgedLeads,
    lastPurgedConversations: values.purgedConversations,
    lastError: values.error ?? null,
  };
  await db.insert(dataRetentionAccountStatus).values(row)
    .onConflictDoUpdate({ target: dataRetentionAccountStatus.businessAccountId, set: row });
}

// ---------------------------------------------------------------------------
// Anonymous counts for dashboards, and the retention report
// ---------------------------------------------------------------------------

export interface PurgedAnalytics {
  leads: { total: number; form: number; journey: number; chat: number; discount: number; paid: number; organic: number };
  conversations: { total: number; form: number; journey: number; chat: number; discount: number };
  byAccount: Record<string, { leads: number; conversations: number }>;
}

/** Counts of deleted leads/conversations created in [from, to], for adding to dashboard totals. */
export async function getPurgedAnalytics(accountIds: string[], from?: Date, to?: Date): Promise<PurgedAnalytics> {
  const empty: PurgedAnalytics = {
    leads: { total: 0, form: 0, journey: 0, chat: 0, discount: 0, paid: 0, organic: 0 },
    conversations: { total: 0, form: 0, journey: 0, chat: 0, discount: 0 },
    byAccount: {},
  };
  if (accountIds.length === 0) return empty;
  const conds = [inArray(dataPurgeLog.businessAccountId, accountIds), eq(dataPurgeLog.countInAnalytics, true)];
  if (from) conds.push(gte(dataPurgeLog.capturedAt, from));
  if (to) conds.push(lte(dataPurgeLog.capturedAt, to));
  const rows = await db.select({
    accountId: dataPurgeLog.businessAccountId,
    recordType: dataPurgeLog.recordType,
    source: dataPurgeLog.source,
    isDiscount: dataPurgeLog.isDiscount,
    isPaid: dataPurgeLog.isPaid,
    n: sql<number>`count(DISTINCT ${dataPurgeLog.recordId})::int`,
  }).from(dataPurgeLog).where(and(...conds))
    .groupBy(dataPurgeLog.businessAccountId, dataPurgeLog.recordType, dataPurgeLog.source, dataPurgeLog.isDiscount, dataPurgeLog.isPaid);

  for (const r of rows) {
    const acc = (empty.byAccount[r.accountId] ||= { leads: 0, conversations: 0 });
    if (r.recordType === 'lead') {
      empty.leads.total += r.n;
      acc.leads += r.n;
      if (r.source === 'form') empty.leads.form += r.n;
      else if (r.source === 'journey') empty.leads.journey += r.n;
      else empty.leads.chat += r.n;
      if (r.isDiscount) empty.leads.discount += r.n;
      if (r.isPaid) empty.leads.paid += r.n; else empty.leads.organic += r.n;
    } else {
      empty.conversations.total += r.n;
      acc.conversations += r.n;
      if (r.source === 'form') empty.conversations.form += r.n;
      else if (r.source === 'journey') empty.conversations.journey += r.n;
      else empty.conversations.chat += r.n;
      if (r.isDiscount) empty.conversations.discount += r.n;
    }
  }
  return empty;
}

export interface RetentionReportRow {
  businessAccountId: string;
  accountName: string;
  policyMode: string;
  capturedLeads: number;
  syncedLeads: number;
  deletedLeads: number;
  deletedConversations: number;
  /** Contact details hidden after sync (leads still held). */
  hidesContacts: boolean;
  hiddenLeads: number;
  leadsHeldNow: number;
  conversationsHeldNow: number;
  oldestLeadHeld: string | null;
  dueNow: number | null;
  lastRunAt: string | null;
}

/** Per-account retention report for [from, to): captured / synced / deleted in the period, and what is held now. */
export async function getRetentionReport(accountIds: string[], from: Date, to: Date): Promise<RetentionReportRow[]> {
  const out: RetentionReportRow[] = [];
  for (const accountId of accountIds) {
    const [account, policy, crm] = await Promise.all([
      storage.getBusinessAccount(accountId),
      getEffectivePolicy(accountId),
      getAccountCrmTargets(accountId),
    ]);
    const synced = syncedSql(crm);
    const [live] = await db.select({
      captured: sql<number>`count(*) FILTER (WHERE ${leads.createdAt} >= ${ts(from)} AND ${leads.createdAt} < ${ts(to)})::int`,
      syncedInPeriod: sql<number>`count(*) FILTER (WHERE ${leads.createdAt} >= ${ts(from)} AND ${leads.createdAt} < ${ts(to)} AND ${synced})::int`,
      heldNow: sql<number>`count(*)::int`,
      hidden: sql<number>`count(*) FILTER (WHERE ${leads.contactsMaskedAt} >= ${ts(from)} AND ${leads.contactsMaskedAt} < ${ts(to)})::int`,
      oldest: sql<Date | null>`min(${leads.createdAt})`,
    }).from(leads).where(eq(leads.businessAccountId, accountId));
    const [convHeld] = await db.select({ n: sql<number>`count(*)::int` }).from(conversations).where(eq(conversations.businessAccountId, accountId));
    const [purged] = await db.select({
      capturedDeleted: sql<number>`count(DISTINCT ${dataPurgeLog.recordId}) FILTER (WHERE ${dataPurgeLog.recordType} = 'lead' AND ${dataPurgeLog.capturedAt} >= ${ts(from)} AND ${dataPurgeLog.capturedAt} < ${ts(to)})::int`,
      syncedDeleted: sql<number>`count(DISTINCT ${dataPurgeLog.recordId}) FILTER (WHERE ${dataPurgeLog.recordType} = 'lead' AND ${dataPurgeLog.synced} AND ${dataPurgeLog.capturedAt} >= ${ts(from)} AND ${dataPurgeLog.capturedAt} < ${ts(to)})::int`,
      deletedLeads: sql<number>`count(DISTINCT ${dataPurgeLog.recordId}) FILTER (WHERE ${dataPurgeLog.recordType} = 'lead' AND ${dataPurgeLog.purgedAt} >= ${ts(from)} AND ${dataPurgeLog.purgedAt} < ${ts(to)})::int`,
      deletedConversations: sql<number>`count(DISTINCT ${dataPurgeLog.recordId}) FILTER (WHERE ${dataPurgeLog.recordType} = 'conversation' AND ${dataPurgeLog.purgedAt} >= ${ts(from)} AND ${dataPurgeLog.purgedAt} < ${ts(to)})::int`,
    }).from(dataPurgeLog).where(eq(dataPurgeLog.businessAccountId, accountId));
    const [status] = await db.select().from(dataRetentionAccountStatus).where(eq(dataRetentionAccountStatus.businessAccountId, accountId));

    out.push({
      businessAccountId: accountId,
      accountName: account?.name || accountId,
      policyMode: policy?.mode || 'off',
      capturedLeads: (live?.captured ?? 0) + (purged?.capturedDeleted ?? 0),
      syncedLeads: (live?.syncedInPeriod ?? 0) + (purged?.syncedDeleted ?? 0),
      deletedLeads: purged?.deletedLeads ?? 0,
      deletedConversations: purged?.deletedConversations ?? 0,
      hidesContacts: policy?.maskContactsAfterSync === true,
      hiddenLeads: live?.hidden ?? 0,
      leadsHeldNow: live?.heldNow ?? 0,
      conversationsHeldNow: convHeld?.n ?? 0,
      oldestLeadHeld: live?.oldest ? new Date(live.oldest).toISOString() : null,
      dueNow: status ? status.dueLeads + status.dueConversations : null,
      lastRunAt: status?.lastRunAt ? status.lastRunAt.toISOString() : null,
    });
  }
  return out;
}
