import { and, eq, sql, desc, asc, isNotNull, inArray, gte, lte, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { conversations, messages, topscholarCpMappings, topscholarVoiceSessions } from '@shared/schema';
import { resolveCpIdsForScope, hasScope, type StudentScope } from './scopeResolver';

/**
 * TopScholar student analytics.
 *
 * Every aggregation here is hard-scoped to ONE business account and to
 * curriculum-bound conversations (`topscholar_cp_id IS NOT NULL`). When the
 * caller supplies a board/medium/grade/subject scope we resolve it to the
 * matching cp_id set via the shared scope resolver and filter to it. A supplied
 * scope that matches no synced package returns EMPTY results (fail closed) — it
 * is never widened to the whole account, mirroring widget RAG behaviour.
 *
 * Pending-OTP (`awaiting_verification`) and internal-test conversations are
 * always excluded so analytics reflect real students only.
 */

export interface AnalyticsFilters {
  from?: Date;
  to?: Date;
  scope?: StudentScope;
}

const buildLabel = (board?: string | null, medium?: string | null, grade?: string | null): string =>
  [board, medium, grade].filter(Boolean).join(' · ');

/**
 * Resolve the supplied scope to a cp_id allow-list.
 * - returns `null`  => no scope supplied, do not filter by cp_id (whole account)
 * - returns `[]`    => scope supplied but matched nothing (caller must return empty)
 * - returns [ids]   => filter to these cp_ids
 */
async function resolveScopeCpIds(
  businessAccountId: string,
  scope?: StudentScope,
): Promise<string[] | null> {
  if (scope && hasScope(scope)) {
    return resolveCpIdsForScope(businessAccountId, scope);
  }
  return null;
}

/** Base WHERE conditions shared by every conversation-level aggregation. */
function baseConversationConditions(
  businessAccountId: string,
  cpIds: string[] | null,
  filters: AnalyticsFilters,
): SQL[] {
  const conds: SQL[] = [
    eq(conversations.businessAccountId, businessAccountId),
    isNotNull(conversations.topscholarCpId),
    eq(conversations.awaitingVerification, false),
    sql`${conversations.isInternalTest} = 'false'`,
  ];
  if (cpIds && cpIds.length > 0) conds.push(inArray(conversations.topscholarCpId, cpIds));
  if (filters.from) conds.push(gte(conversations.createdAt, filters.from));
  if (filters.to) conds.push(lte(conversations.createdAt, filters.to));
  return conds;
}

// ---- Cursor (keyset) pagination for the portal pull API -------------------

/** Internal per-request chunk size. Bounds each response without the client
 *  ever choosing a page size — it just follows `nextCursor` until it is null. */
const PORTAL_CHUNK_SIZE = 200;

/** Freshness lag for incremental (`updatedAfter`) pulls: rows touched within
 *  this window are withheld so a cron can never race an in-flight write and
 *  miss or duplicate it. Mirrors the enterprise incremental-export pattern. */
const PORTAL_FRESHNESS_LAG_SECONDS = 60;

export interface Cursored<T> {
  items: T[];
  nextCursor: string | null;
}

/** Decoded keyset cursor: a stable position on the `(updatedAt, key)` sort. */
export interface PortalCursor {
  updatedAt: Date;
  key: string;
}

/** Thrown when a client supplies a malformed cursor (=> 400 at the route). */
export class PortalCursorError extends Error {}

/** Encode an opaque, URL-safe cursor from the last row's sort key. */
export function encodePortalCursor(updatedAt: Date, key: string): string {
  const payload = JSON.stringify({ t: updatedAt.getTime(), k: key });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/** Decode an opaque cursor. Empty/absent => null (start). Malformed => throws. */
export function decodePortalCursor(raw: unknown): PortalCursor | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new PortalCursorError('cursor must be a string');
  let obj: any;
  try {
    obj = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new PortalCursorError('malformed cursor');
  }
  if (!obj || typeof obj.t !== 'number' || typeof obj.k !== 'string') {
    throw new PortalCursorError('malformed cursor');
  }
  const updatedAt = new Date(obj.t);
  if (Number.isNaN(updatedAt.getTime())) throw new PortalCursorError('malformed cursor');
  return { updatedAt, key: obj.k };
}

/**
 * Resolution semantics (derived from `conversations.doubt_retry_status`).
 *
 * The client's requirements doc asks for Resolution Rate / Escalation Rate. We
 * do not yet capture a per-doubt resolution verdict, so these are derived from
 * the ONE resolution signal that exists today — the retry/escalation flow:
 *
 *   doubt_retry_status IS NULL      -> student never said "not resolved"
 *                                      => counted as `resolvedFirstPass`
 *   doubt_retry_status = 'resolved_first_pass'
 *                                   -> student explicitly clicked "Yes" without
 *                                      ever using the retry
 *                                      => counted as `resolvedFirstPass`
 *   doubt_retry_status = 'resolved' -> resolved after the bot's retry
 *                                      => counted as `resolvedAfterRetry`
 *   doubt_retry_status = 'escalated'-> still unresolved after retry, ticket raised
 *                                      => counted as `escalated`
 *   anything else                   -> retry delivered, outcome not yet known
 *                                      => counted as `pending`
 *
 * Resolution Rate = (resolvedFirstPass + resolvedAfterRetry) / total
 * Escalation Rate = escalated / total
 *
 * These are CHAT-SESSION level, not per-doubt. Per-doubt resolution requires
 * new chat-time telemetry; the UI labels these as session-level so the numbers
 * are never mistaken for per-doubt verdicts.
 *
 * NULL vs 'resolved_first_pass': both count as first-pass resolutions, but they
 * are NOT the same event. NULL is the historical/ambiguous case — it covers
 * sessions that predate explicit capture, sessions where the prompt never
 * appeared, and sessions where the student simply ignored it.
 * 'resolved_first_pass' is written only when the student actually clicked "Yes"
 * (which now also locks the chat). NULL is deliberately left in the
 * first-pass bucket so this change does not retroactively restate past
 * reporting; going forward the explicit value is the higher-fidelity signal.
 *
 * IMPORTANT: every classification below matches on exact values. Any new status
 * must be added to ALL of them in lockstep — an unhandled value silently falls
 * through to `pending` and quietly deflates the resolution rate.
 */
const RESOLVED_FIRST_PASS = sql`(${conversations.doubtRetryStatus} is null or ${conversations.doubtRetryStatus} = 'resolved_first_pass')`;
const RESOLVED_AFTER_RETRY = sql`${conversations.doubtRetryStatus} = 'resolved'`;
const ESCALATED = sql`${conversations.doubtRetryStatus} = 'escalated'`;
/**
 * A retry was actually delivered. NOT simply "status is not null" — an explicit
 * first-pass resolution never involved a retry, so counting it here would
 * inflate the retry-attempted figure.
 */
const RETRY_ATTEMPTED = sql`(${conversations.doubtRetryStatus} is not null and ${conversations.doubtRetryStatus} <> 'resolved_first_pass')`;

/** Empty/zero shapes used when a supplied scope matches nothing (fail closed). */
const EMPTY_OVERVIEW = {
  totalStudents: 0,
  activeStudents: 0,
  totalConversations: 0,
  totalQuestions: 0,
  avgQuestionsPerStudent: 0,
  avgDoubtsPerSession: 0,
  sentiment: { positive: 0, neutral: 0, confused: 0, unlabeled: 0 },
  // Bot retry & escalation flow metrics (Task: bot-to-human escalation).
  // retryAttempted = doubt sessions where the student said "not resolved" once and
  // the bot delivered its clarify/simplify retry (includes both outcomes below plus
  // retries still awaiting an answer). retrySucceeded = resolved after the retry.
  // escalated = still unresolved after the retry -> ticket + client escalation email.
  escalation: {
    retryAttempted: 0,
    retrySucceeded: 0,
    escalated: 0,
    bySubject: [] as { subject: string; count: number }[],
  },
  // Session-level resolution rollup — see the RESOLUTION SEMANTICS note above.
  resolution: {
    resolvedFirstPass: 0,
    resolvedAfterRetry: 0,
    resolved: 0,
    escalated: 0,
    pending: 0,
    resolutionRate: 0,
    escalationRate: 0,
  },
  // Two different clocks — see the comments in `getOverview`.
  // `*DurationSeconds` is session lifetime (open -> close, closed sessions
  // only) and mostly reflects the 24h resume window. `*ActiveSeconds` is the
  // first-message -> last-message span and is the engagement metric.
  duration: {
    closedSessions: 0,
    avgDurationSeconds: 0,
    medianDurationSeconds: 0,
    measuredSessions: 0,
    avgActiveSeconds: 0,
    medianActiveSeconds: 0,
  },
  voice: {
    sessions: 0,
    totalSeconds: 0,
    totalMinutes: 0,
  },
};

export type AnalyticsOverview = typeof EMPTY_OVERVIEW;

export async function getOverview(
  businessAccountId: string,
  filters: AnalyticsFilters,
): Promise<AnalyticsOverview> {
  const cpIds = await resolveScopeCpIds(businessAccountId, filters.scope);
  if (cpIds && cpIds.length === 0) return EMPTY_OVERVIEW;

  const conds = baseConversationConditions(businessAccountId, cpIds, filters);

  // Conversation-level counts + sentiment in one pass.
  const [convAgg] = await db
    .select({
      totalConversations: sql<number>`count(*)::int`,
      totalStudents: sql<number>`count(distinct coalesce(${conversations.studentId}, ${conversations.id}))::int`,
      positive: sql<number>`count(*) filter (where ${conversations.sentiment} = 'positive')::int`,
      neutral: sql<number>`count(*) filter (where ${conversations.sentiment} = 'neutral')::int`,
      confused: sql<number>`count(*) filter (where ${conversations.sentiment} = 'confused')::int`,
      unlabeled: sql<number>`count(*) filter (where ${conversations.sentiment} is null)::int`,
      retryAttempted: sql<number>`count(*) filter (where ${RETRY_ATTEMPTED})::int`,
      retrySucceeded: sql<number>`count(*) filter (where ${RESOLVED_AFTER_RETRY})::int`,
      escalated: sql<number>`count(*) filter (where ${ESCALATED})::int`,
      // Resolution rollup — see RESOLUTION SEMANTICS note above.
      resolvedFirstPass: sql<number>`count(*) filter (where ${RESOLVED_FIRST_PASS})::int`,
      resolvedAfterRetry: sql<number>`count(*) filter (where ${RESOLVED_AFTER_RETRY})::int`,
      // Session LIFETIME: open -> close. Restricted to sessions that actually
      // recorded a close event; sessions still open are excluded rather than
      // measured against `updated_at`.
      //
      // NOTE: TopScholar sessions are resumable for 24h and are usually closed
      // by the expiry sweep rather than by the student leaving, so this figure
      // trends toward ~24h and is NOT a measure of engagement. It is kept for
      // completeness; `activeSeconds` below is the engagement metric.
      closedSessions: sql<number>`count(*) filter (where ${conversations.closedAt} is not null)::int`,
      avgDurationSeconds: sql<number>`coalesce(avg(extract(epoch from (${conversations.closedAt} - ${conversations.createdAt}))) filter (where ${conversations.closedAt} is not null), 0)::float`,
      medianDurationSeconds: sql<number>`coalesce(percentile_cont(0.5) within group (order by extract(epoch from (${conversations.closedAt} - ${conversations.createdAt}))) filter (where ${conversations.closedAt} is not null), 0)::float`,
    })
    .from(conversations)
    .where(and(...conds));

  // Subject-wise escalation counts (client-requested metric).
  const escalationBySubject = await db
    .select({
      subject: sql<string>`coalesce(${conversations.subject}, 'Unspecified')`,
      count: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(and(ESCALATED, ...conds))
    .groupBy(sql`coalesce(${conversations.subject}, 'Unspecified')`)
    .orderBy(sql`count(*) desc`);

  // Question count = user-role messages on those conversations.
  const [qAgg] = await db
    .select({ totalQuestions: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(messages.role, 'user'), ...conds));

  // ACTIVE time per session = first message -> last message. This is the real
  // engagement signal: sessions here are resumable for 24h and are normally
  // closed by the expiry sweep, so `closed_at - created_at` measures the
  // session window, not how long the student was actually working. Sessions
  // with a single message score 0, which is accurate (asked once, done).
  const spans = db
    .select({
      span: sql<number>`extract(epoch from (max(${messages.createdAt}) - min(${messages.createdAt})))`.as('span'),
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(...conds))
    .groupBy(conversations.id)
    .as('spans');

  const [activeAgg] = await db
    .select({
      sessions: sql<number>`count(*)::int`,
      avgActiveSeconds: sql<number>`coalesce(avg(${spans.span}), 0)::float`,
      medianActiveSeconds: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${spans.span}), 0)::float`,
    })
    .from(spans);

  // Voice usage is measured from browser WebSocket connect to disconnect,
  // including idle time. Clip each interval to the selected reporting window so
  // a session crossing midnight contributes only the overlapping seconds.
  const voiceConds: SQL[] = [
    eq(topscholarVoiceSessions.businessAccountId, businessAccountId),
    eq(topscholarVoiceSessions.isInternalTest, false),
  ];
  if (cpIds && cpIds.length > 0) {
    const cpSql = sql.join(cpIds.map((cpId) => sql`${cpId}`), sql`, `);
    voiceConds.push(sql`jsonb_exists_any(${topscholarVoiceSessions.cpIds}, array[${cpSql}]::text[])`);
  }
  if (filters.from) {
    voiceConds.push(sql`coalesce(${topscholarVoiceSessions.disconnectedAt}, now()) >= ${filters.from}`);
  }
  if (filters.to) {
    voiceConds.push(lte(topscholarVoiceSessions.connectedAt, filters.to));
  }

  const intervalStart = filters.from
    ? sql`greatest(${topscholarVoiceSessions.connectedAt}, ${filters.from})`
    : sql`${topscholarVoiceSessions.connectedAt}`;
  const intervalEnd = filters.to
    ? sql`least(coalesce(${topscholarVoiceSessions.disconnectedAt}, now()), ${filters.to})`
    : sql`coalesce(${topscholarVoiceSessions.disconnectedAt}, now())`;

  const [voiceAgg] = await db
    .select({
      sessions: sql<number>`count(*)::int`,
      totalSeconds: sql<number>`coalesce(sum(greatest(0, extract(epoch from (${intervalEnd} - ${intervalStart})))), 0)::float`,
    })
    .from(topscholarVoiceSessions)
    .where(and(...voiceConds));

  const totalStudents = convAgg?.totalStudents ?? 0;
  const totalQuestions = qAgg?.totalQuestions ?? 0;
  const totalConversations = convAgg?.totalConversations ?? 0;
  const totalVoiceSeconds = Math.max(0, Math.round(voiceAgg?.totalSeconds ?? 0));

  const resolvedFirstPass = convAgg?.resolvedFirstPass ?? 0;
  const resolvedAfterRetry = convAgg?.resolvedAfterRetry ?? 0;
  const escalatedCount = convAgg?.escalated ?? 0;
  const resolved = resolvedFirstPass + resolvedAfterRetry;
  // Anything left over is a retry that was delivered but whose outcome is not
  // yet known. It is deliberately excluded from BOTH rates' numerators so the
  // two percentages never sum past 100 or claim an outcome that hasn't happened.
  const pending = Math.max(0, totalConversations - resolved - escalatedCount);
  const pct = (n: number) =>
    totalConversations > 0 ? Math.round((n / totalConversations) * 1000) / 10 : 0;

  return {
    totalStudents,
    activeStudents: totalStudents,
    totalConversations,
    totalQuestions,
    avgQuestionsPerStudent: totalStudents > 0 ? Math.round((totalQuestions / totalStudents) * 10) / 10 : 0,
    avgDoubtsPerSession:
      totalConversations > 0 ? Math.round((totalQuestions / totalConversations) * 10) / 10 : 0,
    resolution: {
      resolvedFirstPass,
      resolvedAfterRetry,
      resolved,
      escalated: escalatedCount,
      pending,
      resolutionRate: pct(resolved),
      escalationRate: pct(escalatedCount),
    },
    duration: {
      closedSessions: convAgg?.closedSessions ?? 0,
      avgDurationSeconds: Math.round(convAgg?.avgDurationSeconds ?? 0),
      medianDurationSeconds: Math.round(convAgg?.medianDurationSeconds ?? 0),
      measuredSessions: activeAgg?.sessions ?? 0,
      avgActiveSeconds: Math.round(activeAgg?.avgActiveSeconds ?? 0),
      medianActiveSeconds: Math.round(activeAgg?.medianActiveSeconds ?? 0),
    },
    voice: {
      sessions: voiceAgg?.sessions ?? 0,
      totalSeconds: totalVoiceSeconds,
      totalMinutes: Math.round((totalVoiceSeconds / 60) * 10) / 10,
    },
    sentiment: {
      positive: convAgg?.positive ?? 0,
      neutral: convAgg?.neutral ?? 0,
      confused: convAgg?.confused ?? 0,
      unlabeled: convAgg?.unlabeled ?? 0,
    },
    escalation: {
      retryAttempted: convAgg?.retryAttempted ?? 0,
      retrySucceeded: convAgg?.retrySucceeded ?? 0,
      escalated: convAgg?.escalated ?? 0,
      bySubject: escalationBySubject.map((r) => ({ subject: r.subject, count: r.count })),
    },
  };
}

export interface TopQuestionsResult {
  topics: { label: string; count: number }[];
  subtopics: { label: string; count: number }[];
  questions: { text: string; count: number }[];
}

export async function getTopQuestions(
  businessAccountId: string,
  filters: AnalyticsFilters,
  limit = 10,
): Promise<TopQuestionsResult> {
  const cpIds = await resolveScopeCpIds(businessAccountId, filters.scope);
  if (cpIds && cpIds.length === 0) return { topics: [], subtopics: [], questions: [] };

  const conds = baseConversationConditions(businessAccountId, cpIds, filters);

  const topicRows = await db
    .select({ label: conversations.category, count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(...conds, isNotNull(conversations.category)))
    .groupBy(conversations.category)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  const subtopicRows = await db
    .select({ label: conversations.subcategory, count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(...conds, isNotNull(conversations.subcategory)))
    .groupBy(conversations.subcategory)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  // Most-asked questions: group user messages by normalised text.
  const questionRows = await db
    .select({
      text: sql<string>`min(${messages.content})`,
      count: sql<number>`count(*)::int`,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(messages.role, 'user'), sql`length(trim(${messages.content})) > 0`, ...conds))
    .groupBy(sql`lower(trim(${messages.content}))`)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return {
    topics: topicRows.map((r) => ({ label: r.label || 'Uncategorized', count: r.count })),
    subtopics: subtopicRows.map((r) => ({ label: r.label || 'Other', count: r.count })),
    questions: questionRows.map((r) => ({ text: (r.text || '').slice(0, 240), count: r.count })),
  };
}

/** One curriculum dimension row, with the session-level resolution split. */
export interface CurriculumRow {
  label: string;
  conversations: number;
  questions: number;
  resolved: number;
  escalated: number;
  pending: number;
}

export interface CurriculumBreakdown {
  bySubject: CurriculumRow[];
  byGrade: CurriculumRow[];
  byBoard: CurriculumRow[];
  byMedium: CurriculumRow[];
  byTopic: { label: string; count: number }[];
}

/** Accumulator used while folding per-cp counts into each curriculum dimension. */
function emptyRow(): Omit<CurriculumRow, 'label'> {
  return { conversations: 0, questions: 0, resolved: 0, escalated: 0, pending: 0 };
}

function foldInto(
  map: Map<string, Omit<CurriculumRow, 'label'>>,
  key: string,
  add: Omit<CurriculumRow, 'label'>,
): void {
  const cur = map.get(key) || emptyRow();
  cur.conversations += add.conversations;
  cur.questions += add.questions;
  cur.resolved += add.resolved;
  cur.escalated += add.escalated;
  cur.pending += add.pending;
  map.set(key, cur);
}

function toSortedRows(map: Map<string, Omit<CurriculumRow, 'label'>>): CurriculumRow[] {
  return Array.from(map.entries())
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.questions - a.questions || b.conversations - a.conversations);
}

export async function getCurriculumBreakdown(
  businessAccountId: string,
  filters: AnalyticsFilters,
): Promise<CurriculumBreakdown> {
  const cpIds = await resolveScopeCpIds(businessAccountId, filters.scope);
  if (cpIds && cpIds.length === 0)
    return { bySubject: [], byGrade: [], byBoard: [], byMedium: [], byTopic: [] };

  const conds = baseConversationConditions(businessAccountId, cpIds, filters);

  // Per-cp conversation + resolution counts, then fold into each dimension via mappings.
  const perCpConv = await db
    .select({
      cpId: conversations.topscholarCpId,
      count: sql<number>`count(*)::int`,
      resolved: sql<number>`count(*) filter (where ${RESOLVED_FIRST_PASS} or ${RESOLVED_AFTER_RETRY})::int`,
      escalated: sql<number>`count(*) filter (where ${ESCALATED})::int`,
    })
    .from(conversations)
    .where(and(...conds))
    .groupBy(conversations.topscholarCpId);

  const perCpQ = await db
    .select({ cpId: conversations.topscholarCpId, count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(messages.role, 'user'), ...conds))
    .groupBy(conversations.topscholarCpId);

  const qByCp = new Map(perCpQ.map((r) => [r.cpId, r.count]));

  const mappings = await db
    .select()
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));
  const byCp = new Map(mappings.map((m) => [m.cpId, m]));

  const subjects = new Map<string, Omit<CurriculumRow, 'label'>>();
  const grades = new Map<string, Omit<CurriculumRow, 'label'>>();
  const boards = new Map<string, Omit<CurriculumRow, 'label'>>();
  const mediums = new Map<string, Omit<CurriculumRow, 'label'>>();

  for (const row of perCpConv) {
    const cp = row.cpId || '';
    const m = byCp.get(cp);
    const subject = (m?.cpName || m?.label || buildLabel(m?.board, m?.medium, m?.grade) || 'Unmapped').trim() || 'Unmapped';
    const grade = (m?.grade || 'Unknown').trim() || 'Unknown';
    const board = (m?.board || 'Unknown').trim() || 'Unknown';
    const medium = (m?.medium || 'Unknown').trim() || 'Unknown';

    const add = {
      conversations: row.count,
      questions: qByCp.get(cp) || 0,
      resolved: row.resolved,
      escalated: row.escalated,
      pending: Math.max(0, row.count - row.resolved - row.escalated),
    };

    foldInto(subjects, subject, add);
    foldInto(grades, grade, add);
    foldInto(boards, board, add);
    foldInto(mediums, medium, add);
  }

  const topicRows = await db
    .select({ label: conversations.subcategory, count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(...conds, isNotNull(conversations.subcategory)))
    .groupBy(conversations.subcategory)
    .orderBy(desc(sql`count(*)`))
    .limit(15);

  return {
    bySubject: toSortedRows(subjects),
    byGrade: toSortedRows(grades),
    byBoard: toSortedRows(boards),
    byMedium: toSortedRows(mediums),
    byTopic: topicRows.map((r) => ({ label: r.label || 'Other', count: r.count })),
  };
}

export interface TrendPoint {
  bucket: string;
  conversations: number;
  questions: number;
}

export type TrendBucket = 'day' | 'week' | 'month';

export async function getEngagementTrends(
  businessAccountId: string,
  filters: AnalyticsFilters,
  bucket: TrendBucket = 'day',
): Promise<TrendPoint[]> {
  const cpIds = await resolveScopeCpIds(businessAccountId, filters.scope);
  if (cpIds && cpIds.length === 0) return [];

  const conds = baseConversationConditions(businessAccountId, cpIds, filters);
  const unit = bucket === 'month' ? sql`'month'` : bucket === 'week' ? sql`'week'` : sql`'day'`;

  const convRows = await db
    .select({
      bucket: sql<string>`to_char(date_trunc(${unit}, ${conversations.createdAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(and(...conds))
    .groupBy(sql`date_trunc(${unit}, ${conversations.createdAt})`)
    .orderBy(sql`date_trunc(${unit}, ${conversations.createdAt})`);

  // Questions are bucketed by when each question was asked (messages.createdAt),
  // not by conversation creation, so activity lands in the right period even for
  // long-lived conversations.
  const qRows = await db
    .select({
      bucket: sql<string>`to_char(date_trunc(${unit}, ${messages.createdAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(messages.role, 'user'), ...conds))
    .groupBy(sql`date_trunc(${unit}, ${messages.createdAt})`)
    .orderBy(sql`date_trunc(${unit}, ${messages.createdAt})`);

  const qByBucket = new Map(qRows.map((r) => [r.bucket, r.count]));
  return convRows.map((r) => ({
    bucket: r.bucket,
    conversations: r.count,
    questions: qByBucket.get(r.bucket) || 0,
  }));
}

// ---- Adoption: DAU / WAU / MAU + new vs returning --------------------------

export interface AdoptionResult {
  /** Trailing-window active students, anchored at `asOf` (range end, or now). */
  asOf: string;
  dau: number;
  wau: number;
  mau: number;
  /** DAU/MAU stickiness as a percentage. 0 when MAU is 0. */
  stickiness: number;
  /** Distinct active students per day across the selected range (for charting). */
  daily: { bucket: string; activeStudents: number }[];
  /**
   * Within the selected range: students whose first-ever session on this
   * account falls inside the range (`newStudents`) vs. students who were
   * already seen before it (`returningStudents`).
   */
  newStudents: number;
  returningStudents: number;
}

const EMPTY_ADOPTION = (asOf: Date): AdoptionResult => ({
  asOf: asOf.toISOString(),
  dau: 0,
  wau: 0,
  mau: 0,
  stickiness: 0,
  daily: [],
  newStudents: 0,
  returningStudents: 0,
});

/**
 * Student identity for activity metrics.
 *
 * `student_id` comes from the signed launch token. Anonymous/unlinked sessions
 * have none, so we fall back to the conversation id — which makes each such
 * session its own "student". That is the same identity rule the rest of this
 * service uses (see `getOverview`), kept consistent here on purpose so the
 * student counts on the dashboard reconcile with each other.
 */
const STUDENT_KEY = sql`coalesce(${conversations.studentId}, ${conversations.id})`;

export async function getAdoption(
  businessAccountId: string,
  filters: AnalyticsFilters,
): Promise<AdoptionResult> {
  const cpIds = await resolveScopeCpIds(businessAccountId, filters.scope);
  const asOf = filters.to ?? new Date();
  if (cpIds && cpIds.length === 0) return EMPTY_ADOPTION(asOf);

  // Trailing windows ignore the range `from` on purpose: DAU/WAU/MAU are
  // defined as "active in the last 1/7/30 days", not "active within whatever
  // range the user picked". They stay scope-filtered, and are anchored at the
  // range end so the numbers stay stable when viewing a historical range.
  const scopeOnly = baseConversationConditions(businessAccountId, cpIds, { scope: filters.scope });
  const [windows] = await db
    .select({
      dau: sql<number>`count(distinct ${STUDENT_KEY}) filter (where ${messages.createdAt} > ${asOf}::timestamp - interval '1 day')::int`,
      wau: sql<number>`count(distinct ${STUDENT_KEY}) filter (where ${messages.createdAt} > ${asOf}::timestamp - interval '7 days')::int`,
      mau: sql<number>`count(distinct ${STUDENT_KEY}) filter (where ${messages.createdAt} > ${asOf}::timestamp - interval '30 days')::int`,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(messages.role, 'user'), lte(messages.createdAt, asOf), ...scopeOnly));

  // Daily active students across the selected range. Bucketed on message time
  // so a multi-day session counts on each day the student actually asked
  // something, rather than only on the day the session opened.
  const dailyConds = [...scopeOnly];
  if (filters.from) dailyConds.push(gte(messages.createdAt, filters.from));
  if (filters.to) dailyConds.push(lte(messages.createdAt, filters.to));
  const daily = await db
    .select({
      bucket: sql<string>`to_char(date_trunc('day', ${messages.createdAt}), 'YYYY-MM-DD')`,
      activeStudents: sql<number>`count(distinct ${STUDENT_KEY})::int`,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(messages.role, 'user'), ...dailyConds))
    .groupBy(sql`date_trunc('day', ${messages.createdAt})`)
    .orderBy(sql`date_trunc('day', ${messages.createdAt})`);

  // New vs returning. A student is "new" when their first-ever session on this
  // account (unbounded lookback, same scope) starts inside the selected range.
  // Anonymous sessions key on conversation id, so each is new by construction —
  // that is correct: they have no prior identity to have returned from.
  //
  // Written as raw CTEs rather than Drizzle subquery builders: both sides
  // project the same computed `student` column, and the query builder emits the
  // join predicate unqualified, which Postgres rejects as ambiguous.
  const rangeStart = filters.from ?? null;
  const scopeWhere = and(...scopeOnly)!;
  const rangeWhere = and(...baseConversationConditions(businessAccountId, cpIds, filters))!;
  const cohortResult = await db.execute(sql`
    with first_seen as (
      select ${STUDENT_KEY} as student, min(${conversations.createdAt}) as first_at
      from ${conversations}
      where ${scopeWhere}
      group by ${STUDENT_KEY}
    ),
    active_in_range as (
      select distinct ${STUDENT_KEY} as student
      from ${conversations}
      where ${rangeWhere}
    )
    select
      ${rangeStart
        ? sql`count(*) filter (where fs.first_at >= ${rangeStart})::int`
        : sql`count(*)::int`} as new_students,
      ${rangeStart
        ? sql`count(*) filter (where fs.first_at < ${rangeStart})::int`
        : sql`0::int`} as returning_students
    from active_in_range air
    join first_seen fs on air.student = fs.student
  `);
  const cohort = (cohortResult.rows?.[0] ?? {}) as {
    new_students?: number;
    returning_students?: number;
  };

  const mau = windows?.mau ?? 0;
  return {
    asOf: asOf.toISOString(),
    dau: windows?.dau ?? 0,
    wau: windows?.wau ?? 0,
    mau,
    stickiness: mau > 0 ? Math.round(((windows?.dau ?? 0) / mau) * 1000) / 10 : 0,
    daily: daily.map((r) => ({ bucket: r.bucket, activeStudents: r.activeStudents })),
    newStudents: Number(cohort.new_students ?? 0),
    returningStudents: Number(cohort.returning_students ?? 0),
  };
}

// ---- Exports ---------------------------------------------------------------

export interface DoubtExportRow {
  askedAt: Date;
  studentId: string | null;
  studentName: string | null;
  curriculumLabel: string;
  board: string | null;
  medium: string | null;
  grade: string | null;
  subject: string | null;
  topic: string | null;
  subtopic: string | null;
  sentiment: string | null;
  resolutionStatus: string;
  conversationId: string;
  doubtText: string;
}

/**
 * Flat, row-per-doubt export feed. Hard-capped rather than streamed: the admin
 * UI downloads this synchronously, so an unbounded result set would be a
 * memory and request-timeout hazard. Callers surface the cap to the user.
 */
export const DOUBT_EXPORT_MAX_ROWS = 10_000;

export async function getDoubtsExport(
  businessAccountId: string,
  filters: AnalyticsFilters,
  limit = DOUBT_EXPORT_MAX_ROWS,
): Promise<DoubtExportRow[]> {
  const cpIds = await resolveScopeCpIds(businessAccountId, filters.scope);
  if (cpIds && cpIds.length === 0) return [];

  const conds = baseConversationConditions(businessAccountId, cpIds, filters);

  const rows = await db
    .select({
      askedAt: messages.createdAt,
      studentId: conversations.studentId,
      studentName: conversations.studentName,
      cpId: conversations.topscholarCpId,
      subject: conversations.subject,
      topic: conversations.category,
      subtopic: conversations.subcategory,
      sentiment: conversations.sentiment,
      retryStatus: conversations.doubtRetryStatus,
      conversationId: conversations.id,
      doubtText: messages.content,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(messages.role, 'user'), sql`length(trim(${messages.content})) > 0`, ...conds))
    .orderBy(desc(messages.createdAt))
    .limit(Math.min(limit, DOUBT_EXPORT_MAX_ROWS));

  const mappings = await db
    .select()
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));
  const byCp = new Map(mappings.map((m) => [m.cpId, m]));

  return rows.map((r) => {
    const m = byCp.get(r.cpId || '');
    return {
      askedAt: r.askedAt,
      studentId: r.studentId,
      studentName: r.studentName,
      curriculumLabel: m?.label || buildLabel(m?.board, m?.medium, m?.grade) || '',
      board: m?.board ?? null,
      medium: m?.medium ?? null,
      grade: m?.grade ?? null,
      subject: r.subject,
      topic: r.topic,
      subtopic: r.subtopic,
      sentiment: r.sentiment,
      // Session-level status projected onto each doubt in that session — see
      // the RESOLUTION SEMANTICS note. Named explicitly so the exported column
      // cannot be misread as a per-doubt verdict.
      resolutionStatus:
        r.retryStatus === null || r.retryStatus === 'resolved_first_pass'
          ? 'resolved_first_pass'
          : r.retryStatus === 'resolved'
            ? 'resolved_after_retry'
            : r.retryStatus === 'escalated'
              ? 'escalated'
              : 'pending',
      conversationId: r.conversationId,
      doubtText: r.doubtText || '',
    };
  });
}

export interface StudentRosterRow {
  studentId: string | null;
  studentName: string | null;
  conversationCount: number;
  questionCount: number;
  lastActive: Date | null;
  curriculumLabel: string;
  grade: string | null;
}

export interface StudentRosterPage {
  items: StudentRosterRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function studentRosterConditions(
  businessAccountId: string,
  filters: AnalyticsFilters,
  search?: string | null,
): Promise<{ cpIds: string[] | null; conds: SQL[] }> {
  return resolveScopeCpIds(businessAccountId, filters.scope).then((cpIds) => {
    const conds = baseConversationConditions(businessAccountId, cpIds, filters);
    const normalizedSearch = (search || '').trim();
    if (normalizedSearch) {
      conds.push(sql`(${conversations.studentName} ilike ${'%' + normalizedSearch + '%'} or ${conversations.studentId} ilike ${'%' + normalizedSearch + '%'})`);
    }
    return { cpIds, conds };
  });
}

function mapStudentRosterRows(
  rows: Array<{
    studentId: string | null;
    studentName: string | null;
    conversationCount: number;
    questionCount: number;
    lastActive: Date | null;
    cpId: string | null;
  }>,
  mappings: Array<typeof topscholarCpMappings.$inferSelect>,
): StudentRosterRow[] {
  const byCp = new Map(mappings.map((m) => [m.cpId, m]));
  return rows.map((r) => {
    const m = r.cpId ? byCp.get(r.cpId) : undefined;
    return {
      studentId: r.studentId,
      studentName: r.studentName,
      conversationCount: r.conversationCount,
      questionCount: r.questionCount,
      lastActive: r.lastActive,
      curriculumLabel: m?.label || buildLabel(m?.board, m?.medium, m?.grade) || (r.cpId ? 'Unmapped curriculum' : ''),
      grade: m?.grade ?? null,
    };
  });
}

export async function getStudentRoster(
  businessAccountId: string,
  filters: AnalyticsFilters,
  opts: { search?: string | null; limit?: number } = {},
): Promise<StudentRosterRow[]> {
  const { cpIds, conds } = await studentRosterConditions(businessAccountId, filters, opts.search);
  if (cpIds && cpIds.length === 0) return [];

  // `limit: 0` is reserved for complete exports. Regular callers retain the
  // existing bounded default.
  const limit = opts.limit === 0
    ? undefined
    : Math.min(Math.max(opts.limit ?? 200, 1), 500);

  // Group by student. Question count via a correlated count of user messages.
  const query = db
    .select({
      studentKey: sql<string>`coalesce(${conversations.studentId}, ${conversations.id})`,
      studentId: sql<string | null>`max(${conversations.studentId})`,
      studentName: sql<string | null>`max(${conversations.studentName})`,
      conversationCount: sql<number>`count(distinct ${conversations.id})::int`,
      questionCount: sql<number>`coalesce(sum((select count(*) from ${messages} m where m.conversation_id = ${conversations.id} and m.role = 'user')), 0)::int`,
      lastActive: sql<Date | null>`max(${conversations.updatedAt})`,
      cpId: sql<string | null>`max(${conversations.topscholarCpId})`,
    })
    .from(conversations)
    .where(and(...conds))
    .groupBy(sql`coalesce(${conversations.studentId}, ${conversations.id})`)
    .orderBy(desc(sql`max(${conversations.updatedAt})`), desc(sql`coalesce(${conversations.studentId}, ${conversations.id})`));
  const rows = limit === undefined ? await query : await query.limit(limit);

  const mappings = await db
    .select()
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));
  return mapStudentRosterRows(rows, mappings);
}

export async function getStudentRosterPaginated(
  businessAccountId: string,
  filters: AnalyticsFilters,
  opts: { search?: string | null; page?: number; pageSize?: number } = {},
): Promise<StudentRosterPage> {
  const pageSize = Math.min(Math.max(Math.floor(opts.pageSize ?? 10), 1), 50);
  const page = Math.max(Math.floor(opts.page ?? 1), 1);
  const { cpIds, conds } = await studentRosterConditions(businessAccountId, filters, opts.search);
  if (cpIds && cpIds.length === 0) {
    return { items: [], total: 0, page, pageSize, totalPages: 0 };
  }

  const studentKey = sql`coalesce(${conversations.studentId}, ${conversations.id})`;
  const [countRows, rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(distinct ${studentKey})::int` })
      .from(conversations)
      .where(and(...conds)),
    db
      .select({
        studentKey: sql<string>`coalesce(${conversations.studentId}, ${conversations.id})`,
        studentId: sql<string | null>`max(${conversations.studentId})`,
        studentName: sql<string | null>`max(${conversations.studentName})`,
        conversationCount: sql<number>`count(distinct ${conversations.id})::int`,
        questionCount: sql<number>`coalesce(sum((select count(*) from ${messages} m where m.conversation_id = ${conversations.id} and m.role = 'user')), 0)::int`,
        lastActive: sql<Date | null>`max(${conversations.updatedAt})`,
        cpId: sql<string | null>`max(${conversations.topscholarCpId})`,
      })
      .from(conversations)
      .where(and(...conds))
      .groupBy(studentKey)
      .orderBy(desc(sql`max(${conversations.updatedAt})`), desc(studentKey))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);

  const mappings = await db
    .select()
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));
  const total = countRows[0]?.total ?? 0;
  return {
    items: mapStudentRosterRows(rows, mappings),
    total,
    page,
    pageSize,
    totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
  };
}

/**
 * Cursor-paginated student roster (newest-active first). The client follows the
 * returned `nextCursor` until it is null, walking every student in the account
 * with no page numbers and no cap. Keyset pagination on the stable sort key
 * `(max(updatedAt), studentKey)` is robust under concurrent writes — a full walk
 * never silently drops or duplicates a student.
 *
 * `updatedAfter` enables incremental cron syncs: only students whose latest
 * activity is at/after that time are returned, and anything touched within the
 * last ~60s is withheld (freshness lag) so the cron can never race a live write.
 */
export async function getStudentRosterPage(
  businessAccountId: string,
  filters: AnalyticsFilters,
  opts: { search?: string | null; cursor?: PortalCursor | null; updatedAfter?: Date | null } = {},
): Promise<Cursored<StudentRosterRow>> {
  const empty: Cursored<StudentRosterRow> = { items: [], nextCursor: null };

  const cpIds = await resolveScopeCpIds(businessAccountId, filters.scope);
  if (cpIds && cpIds.length === 0) return empty;

  const conds = baseConversationConditions(businessAccountId, cpIds, filters);
  const search = (opts.search || '').trim();
  if (search) {
    conds.push(sql`(${conversations.studentName} ilike ${'%' + search + '%'} or ${conversations.studentId} ilike ${'%' + search + '%'})`);
  }

  // Keyset position + incremental filters apply to the per-student aggregate
  // sort key (max(updatedAt), studentKey), so they live in HAVING. The
  // timestamp is truncated to milliseconds because the JS Date the driver
  // returns (and thus the cursor) is millisecond-precision; comparing against
  // the raw microsecond column would silently skip rows whose sub-millisecond
  // part falls between the cursor value and the original row.
  const maxUpdated = sql`date_trunc('milliseconds', max(${conversations.updatedAt}))`;
  const studentKey = sql`coalesce(${conversations.studentId}, ${conversations.id})`;
  const having: SQL[] = [];
  if (opts.updatedAfter) {
    having.push(sql`${maxUpdated} >= ${opts.updatedAfter}`);
    having.push(sql`${maxUpdated} <= now() - make_interval(secs => ${PORTAL_FRESHNESS_LAG_SECONDS})`);
  }
  if (opts.cursor) {
    having.push(
      sql`(${maxUpdated} < ${opts.cursor.updatedAt} or (${maxUpdated} = ${opts.cursor.updatedAt} and ${studentKey} < ${opts.cursor.key}))`,
    );
  }

  const rows = await db
    .select({
      studentKey: sql<string>`coalesce(${conversations.studentId}, ${conversations.id})`,
      studentId: sql<string | null>`max(${conversations.studentId})`,
      studentName: sql<string | null>`max(${conversations.studentName})`,
      conversationCount: sql<number>`count(distinct ${conversations.id})::int`,
      questionCount: sql<number>`coalesce(sum((select count(*) from ${messages} m where m.conversation_id = ${conversations.id} and m.role = 'user')), 0)::int`,
      lastActive: sql<Date>`date_trunc('milliseconds', max(${conversations.updatedAt}))`,
      cpId: sql<string | null>`max(${conversations.topscholarCpId})`,
    })
    .from(conversations)
    .where(and(...conds))
    .groupBy(sql`coalesce(${conversations.studentId}, ${conversations.id})`)
    .having(having.length ? and(...having) : sql`true`)
    .orderBy(desc(maxUpdated), desc(studentKey))
    .limit(PORTAL_CHUNK_SIZE + 1);

  const hasMore = rows.length > PORTAL_CHUNK_SIZE;
  const pageRows = hasMore ? rows.slice(0, PORTAL_CHUNK_SIZE) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodePortalCursor(last.lastActive, last.studentKey) : null;

  const mappings = await db
    .select()
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));
  const byCp = new Map(mappings.map((m) => [m.cpId, m]));

  return {
    items: pageRows.map((r) => {
      const m = r.cpId ? byCp.get(r.cpId) : undefined;
      return {
        studentId: r.studentId,
        studentName: r.studentName,
        conversationCount: r.conversationCount,
        questionCount: r.questionCount,
        lastActive: r.lastActive,
        curriculumLabel: m?.label || buildLabel(m?.board, m?.medium, m?.grade) || (r.cpId ? 'Unmapped curriculum' : ''),
        grade: m?.grade ?? null,
      };
    }),
    nextCursor,
  };
}

export interface StudentReport {
  studentId: string;
  studentName: string | null;
  curriculumLabel: string;
  board: string | null;
  medium: string | null;
  grade: string | null;
  stats: {
    conversationCount: number;
    questionCount: number;
    firstActive: Date | null;
    lastActive: Date | null;
  };
  sentiment: { positive: number; neutral: number; confused: number; unlabeled: number };
  subjects: { label: string; questions: number }[];
  questionHistory: { text: string; createdAt: Date; conversationId: string; sentiment: string | null }[];
}

/**
 * Single-student report. `studentId` MUST be a concrete student id; this never
 * falls back to conversation id, so a request without a student id returns null
 * (parent reports need a real student). Always scoped to the business account.
 *
 * Scope is enforced like every other aggregation: a supplied board/medium/grade/
 * subject scope that matches no package fails closed (returns null). `opts.cpIds`
 * is an additional hard restriction — the parent-facing report passes the launch
 * token's own cp_id so a token can only ever read its own student's curriculum
 * activity even if a studentId were to collide across packs.
 */
export async function getStudentReport(
  businessAccountId: string,
  studentId: string,
  filters: AnalyticsFilters = {},
  opts: { cpIds?: string[] } = {},
): Promise<StudentReport | null> {
  const sid = (studentId || '').trim();
  if (!sid) return null;

  // Combine scope-derived cp_ids with any explicit cp_id restriction (token).
  // Any constraint that resolves to an empty set => fail closed.
  const constraints: string[][] = [];
  const scopeCpIds = await resolveScopeCpIds(businessAccountId, filters.scope);
  if (scopeCpIds !== null) constraints.push(scopeCpIds);
  if (opts.cpIds) constraints.push(opts.cpIds.filter(Boolean));

  let effectiveCpIds: string[] | null = null;
  if (constraints.length > 0) {
    effectiveCpIds = Array.from(
      new Set(constraints.reduce((acc, cur) => acc.filter((x) => cur.includes(x)))),
    );
    if (effectiveCpIds.length === 0) return null;
  }

  const conds: SQL[] = [
    eq(conversations.businessAccountId, businessAccountId),
    isNotNull(conversations.topscholarCpId),
    eq(conversations.awaitingVerification, false),
    sql`${conversations.isInternalTest} = 'false'`,
    eq(conversations.studentId, sid),
  ];
  if (effectiveCpIds) conds.push(inArray(conversations.topscholarCpId, effectiveCpIds));
  if (filters.from) conds.push(gte(conversations.createdAt, filters.from));
  if (filters.to) conds.push(lte(conversations.createdAt, filters.to));

  const convRows = await db
    .select({
      id: conversations.id,
      studentName: conversations.studentName,
      cpId: conversations.topscholarCpId,
      sentiment: conversations.sentiment,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(and(...conds))
    .orderBy(desc(conversations.updatedAt));

  if (convRows.length === 0) return null;

  const convIds = convRows.map((r) => r.id);

  const [qAgg] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.role, 'user'), inArray(messages.conversationId, convIds)));

  const history = await db
    .select({
      text: messages.content,
      createdAt: messages.createdAt,
      conversationId: messages.conversationId,
    })
    .from(messages)
    .where(and(eq(messages.role, 'user'), inArray(messages.conversationId, convIds)))
    .orderBy(desc(messages.createdAt))
    .limit(100);

  const mappings = await db
    .select()
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));
  const byCp = new Map(mappings.map((m) => [m.cpId, m]));
  const sentimentByConv = new Map(convRows.map((r) => [r.id, r.sentiment]));

  // Aggregate by subject (cp) using per-conversation question counts.
  const qPerConv = await db
    .select({ conversationId: messages.conversationId, count: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.role, 'user'), inArray(messages.conversationId, convIds)))
    .groupBy(messages.conversationId);
  const qByConv = new Map(qPerConv.map((r) => [r.conversationId, r.count]));

  const subjects = new Map<string, number>();
  const sentiment = { positive: 0, neutral: 0, confused: 0, unlabeled: 0 };
  let firstActive: Date | null = null;
  let lastActive: Date | null = null;
  const primary = convRows[0];

  for (const r of convRows) {
    const m = r.cpId ? byCp.get(r.cpId) : undefined;
    const subject = (m?.cpName || m?.label || buildLabel(m?.board, m?.medium, m?.grade) || 'Unmapped').trim() || 'Unmapped';
    subjects.set(subject, (subjects.get(subject) || 0) + (qByConv.get(r.id) || 0));
    if (r.sentiment === 'positive') sentiment.positive++;
    else if (r.sentiment === 'neutral') sentiment.neutral++;
    else if (r.sentiment === 'confused') sentiment.confused++;
    else sentiment.unlabeled++;
    if (r.createdAt && (!firstActive || r.createdAt < firstActive)) firstActive = r.createdAt;
    if (r.updatedAt && (!lastActive || r.updatedAt > lastActive)) lastActive = r.updatedAt;
  }

  const pm = primary.cpId ? byCp.get(primary.cpId) : undefined;

  return {
    studentId: sid,
    studentName: primary.studentName,
    curriculumLabel: pm?.label || buildLabel(pm?.board, pm?.medium, pm?.grade) || 'Unmapped curriculum',
    board: pm?.board ?? null,
    medium: pm?.medium ?? null,
    grade: pm?.grade ?? null,
    stats: {
      conversationCount: convRows.length,
      questionCount: qAgg?.count ?? 0,
      firstActive,
      lastActive,
    },
    sentiment,
    subjects: Array.from(subjects.entries())
      .map(([label, questions]) => ({ label, questions }))
      .sort((a, b) => b.questions - a.questions),
    questionHistory: history.map((h) => ({
      text: (h.text || '').slice(0, 500),
      createdAt: h.createdAt,
      conversationId: h.conversationId,
      sentiment: sentimentByConv.get(h.conversationId) ?? null,
    })),
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface StudentConversationRow {
  conversationId: string;
  title: string;
  cpId: string | null;
  curriculumLabel: string;
  sentiment: string | null;
  messageCount: number;
  questionCount: number;
  startedAt: Date | null;
  lastActive: Date | null;
}

/**
 * Cursor-paginated list of one student's past conversations, newest first.
 * Hard-scoped to the business account AND the supplied studentId (never falls
 * back to conversation id). A supplied board/medium/grade/subject scope that
 * matches no package fails closed (returns an empty page).
 *
 * The client follows `nextCursor` until it is null to retrieve every
 * conversation. Keyset pagination on `(updatedAt, id)` is stable under
 * concurrent writes. `updatedAfter` enables incremental syncs with the same
 * ~60s freshness lag as the roster.
 */
export async function getStudentConversations(
  businessAccountId: string,
  studentId: string,
  filters: AnalyticsFilters = {},
  opts: { cursor?: PortalCursor | null; updatedAfter?: Date | null } = {},
): Promise<Cursored<StudentConversationRow>> {
  const sid = (studentId || '').trim();
  const empty: Cursored<StudentConversationRow> = { items: [], nextCursor: null };
  if (!sid) return empty;

  const cpIds = await resolveScopeCpIds(businessAccountId, filters.scope);
  if (cpIds && cpIds.length === 0) return empty;

  const conds = baseConversationConditions(businessAccountId, cpIds, filters);
  conds.push(eq(conversations.studentId, sid));
  // Truncate to milliseconds so the keyset comparison matches the
  // millisecond-precision JS Date carried in the cursor (the raw column is
  // microsecond-precision; comparing against it would silently skip rows).
  const sortTs = sql`date_trunc('milliseconds', ${conversations.updatedAt})`;
  if (opts.updatedAfter) {
    conds.push(sql`${sortTs} >= ${opts.updatedAfter}`);
    conds.push(sql`${sortTs} <= now() - make_interval(secs => ${PORTAL_FRESHNESS_LAG_SECONDS})`);
  }
  if (opts.cursor) {
    conds.push(
      sql`(${sortTs} < ${opts.cursor.updatedAt} or (${sortTs} = ${opts.cursor.updatedAt} and ${conversations.id} < ${opts.cursor.key}))`,
    );
  }

  const fetched = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      cpId: conversations.topscholarCpId,
      sentiment: conversations.sentiment,
      startedAt: conversations.createdAt,
      lastActive: sql<Date>`date_trunc('milliseconds', ${conversations.updatedAt})`,
    })
    .from(conversations)
    .where(and(...conds))
    .orderBy(desc(sortTs), desc(conversations.id))
    .limit(PORTAL_CHUNK_SIZE + 1);

  const hasMore = fetched.length > PORTAL_CHUNK_SIZE;
  const rows = hasMore ? fetched.slice(0, PORTAL_CHUNK_SIZE) : fetched;
  const lastRow = rows[rows.length - 1];
  const nextCursor = hasMore && lastRow && lastRow.lastActive ? encodePortalCursor(lastRow.lastActive, lastRow.id) : null;

  if (rows.length === 0) return empty;

  const convIds = rows.map((r) => r.id);
  const counts = await db
    .select({
      conversationId: messages.conversationId,
      messageCount: sql<number>`count(*)::int`,
      questionCount: sql<number>`count(*) filter (where ${messages.role} = 'user')::int`,
    })
    .from(messages)
    .where(inArray(messages.conversationId, convIds))
    .groupBy(messages.conversationId);
  const byConv = new Map(counts.map((c) => [c.conversationId, c]));

  const mappings = await db
    .select()
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));
  const byCp = new Map(mappings.map((m) => [m.cpId, m]));

  return {
    items: rows.map((r) => {
      const m = r.cpId ? byCp.get(r.cpId) : undefined;
      const c = byConv.get(r.id);
      return {
        conversationId: r.id,
        title: r.title,
        cpId: r.cpId,
        curriculumLabel: m?.label || buildLabel(m?.board, m?.medium, m?.grade) || (r.cpId ? 'Unmapped curriculum' : ''),
        sentiment: r.sentiment,
        messageCount: c?.messageCount ?? 0,
        questionCount: c?.questionCount ?? 0,
        startedAt: r.startedAt,
        lastActive: r.lastActive,
      };
    }),
    nextCursor,
  };
}

export interface ConversationTranscript {
  conversationId: string;
  studentId: string | null;
  studentName: string | null;
  cpId: string | null;
  curriculumLabel: string;
  sentiment: string | null;
  title: string;
  startedAt: Date | null;
  lastActive: Date | null;
  messages: { role: string; content: string; imageUrl: string | null; at: Date }[];
}

/**
 * Full transcript of a single conversation, in chronological order. Hard-scoped
 * to the business account AND the supplied studentId AND conversationId, so a
 * caller can only ever read a conversation that genuinely belongs to that
 * student under that account. Returns null on any miss (fail closed).
 */
export async function getConversationTranscript(
  businessAccountId: string,
  studentId: string,
  conversationId: string,
  filters: AnalyticsFilters = {},
): Promise<ConversationTranscript | null> {
  const sid = (studentId || '').trim();
  const cid = (conversationId || '').trim();
  if (!sid || !cid) return null;

  const cpIds = await resolveScopeCpIds(businessAccountId, filters.scope);
  if (cpIds && cpIds.length === 0) return null;

  const conds = baseConversationConditions(businessAccountId, cpIds, filters);
  conds.push(eq(conversations.studentId, sid));
  conds.push(eq(conversations.id, cid));

  const [conv] = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      studentName: conversations.studentName,
      cpId: conversations.topscholarCpId,
      sentiment: conversations.sentiment,
      startedAt: conversations.createdAt,
      lastActive: conversations.updatedAt,
    })
    .from(conversations)
    .where(and(...conds));
  if (!conv) return null;

  const msgs = await db
    .select({
      role: messages.role,
      content: messages.content,
      imageUrl: messages.imageUrl,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, cid))
    .orderBy(asc(messages.createdAt));

  const mappings = await db
    .select()
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));
  const m = conv.cpId ? new Map(mappings.map((x) => [x.cpId, x])).get(conv.cpId) : undefined;

  return {
    conversationId: conv.id,
    studentId: sid,
    studentName: conv.studentName,
    cpId: conv.cpId,
    curriculumLabel: m?.label || buildLabel(m?.board, m?.medium, m?.grade) || (conv.cpId ? 'Unmapped curriculum' : ''),
    sentiment: conv.sentiment,
    title: conv.title,
    startedAt: conv.startedAt,
    lastActive: conv.lastActive,
    messages: msgs.map((x) => ({
      role: x.role,
      content: x.content,
      imageUrl: x.imageUrl ?? null,
      at: x.createdAt,
    })),
  };
}
