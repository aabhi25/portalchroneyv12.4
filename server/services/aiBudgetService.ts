/**
 * Monthly AI spend limits per business account.
 *
 * ── Months are IST calendar months ───────────────────────────────────────────
 * The business and its customers are in India, so "this month" everywhere in
 * usage reporting and limit enforcement means the calendar month in
 * Asia/Kolkata (UTC+05:30, no daylight saving). Example: an event at
 * 2026-09-30T19:00Z is 2026-10-01 00:30 IST and counts towards October.
 * ai_usage_events.occurred_at is a UTC `timestamp`, so a month is the UTC
 * range [month start IST, next month start IST) = [prev day 18:30Z, ...).
 *
 * ── Limits ───────────────────────────────────────────────────────────────────
 * ai_usage_limits holds at most one row per account (no row = no limit, the
 * default). Only super admins change it (routes/aiUsage.ts, audit-logged).
 *   action "warn":  at warn_at_percent and at 100% an in-app banner is shown and
 *                   a system audit event is recorded once per threshold per month.
 *   action "block": the same, plus once month-to-date spend >= limit every new
 *                   AI call for the account is refused before reaching OpenAI
 *                   (openaiClient.ts throws AiBudgetExceededError).
 *
 * ── Enforcement cache (no DB hit per AI call) ────────────────────────────────
 * The guard keeps every limit row plus the month-to-date spend of the limited
 * accounts in memory. It is refreshed from the DB at most every 60s (a timer,
 * plus a lazy refresh when a check finds it stale) and incremented locally as
 * aiUsageLogger records each event, so it is exact within this process and at
 * most ~60s behind usage recorded by other processes.
 */
import { and, eq, gte, inArray, lt, or, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { aiUsageEvents, aiUsageLimits, type AiUsageLimit } from "@shared/schema";
import { setAiBudgetGuard, type AiBudgetDecision, type AiBudgetGuard } from "../lib/openaiClient";
import { recordSystemAuditEvent } from "./auditService";

export const USAGE_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60_000;

export type LimitAction = "warn" | "block";

/** "YYYY-MM" of the IST calendar month containing `at`. */
export function istMonthKey(at: Date | number = Date.now()): string {
  const d = new Date((typeof at === "number" ? at : at.getTime()) + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" of the IST calendar day containing `at`. */
export function istDateKey(at: Date | number = Date.now()): string {
  const d = new Date((typeof at === "number" ? at : at.getTime()) + IST_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

export function isValidMonthKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function shiftMonthKey(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** UTC instants bounding an IST month: [start, end). */
export function istMonthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS),
    end: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS),
  };
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * A UTC instant as a literal for comparison with a `timestamp without time
 * zone` column holding UTC. (Passing a JS Date to raw SQL would be serialized
 * in the server's local zone.)
 */
export function pgUtc(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

export function usdInrRate(): number {
  const n = Number(process.env.USD_INR_RATE);
  return Number.isFinite(n) && n > 0 ? n : 84;
}

export interface LimitInfo {
  monthlyLimitUsd: number;
  warnAtPercent: number;
  action: LimitAction;
}

export type LimitLevel = "ok" | "warn" | "exceeded";

export function limitLevel(spentUsd: number, limit: LimitInfo): LimitLevel {
  if (limit.monthlyLimitUsd <= 0 || spentUsd >= limit.monthlyLimitUsd) return "exceeded";
  if ((spentUsd / limit.monthlyLimitUsd) * 100 >= limit.warnAtPercent) return "warn";
  return "ok";
}

function toLimitInfo(row: Pick<AiUsageLimit, "monthlyLimitUsd" | "warnAtPercent" | "action">): LimitInfo {
  return {
    monthlyLimitUsd: Number(row.monthlyLimitUsd),
    warnAtPercent: row.warnAtPercent,
    action: row.action === "block" ? "block" : "warn",
  };
}

/** Month-to-date spend (USD) per account for an IST month, from ai_usage_events (index: account, occurred_at). */
export async function getMonthSpend(accountIds: string[], month: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (accountIds.length === 0) return out;
  const { start, end } = istMonthRange(month);
  const rows = await db
    .select({
      id: aiUsageEvents.businessAccountId,
      cost: sql<string>`coalesce(sum(${aiUsageEvents.costUsd}), 0)`,
    })
    .from(aiUsageEvents)
    .where(and(
      inArray(aiUsageEvents.businessAccountId, accountIds),
      gte(aiUsageEvents.occurredAt, sql`${pgUtc(start)}::timestamp`),
      lt(aiUsageEvents.occurredAt, sql`${pgUtc(end)}::timestamp`),
    ))
    .groupBy(aiUsageEvents.businessAccountId);
  for (const r of rows) out.set(r.id, Number(r.cost) || 0);
  return out;
}

// ── limit CRUD ───────────────────────────────────────────────────────────────

export async function getLimit(businessAccountId: string): Promise<AiUsageLimit | null> {
  const [row] = await db.select().from(aiUsageLimits).where(eq(aiUsageLimits.businessAccountId, businessAccountId)).limit(1);
  return row ?? null;
}

export async function upsertLimit(input: {
  businessAccountId: string;
  monthlyLimitUsd: number;
  warnAtPercent: number;
  action: LimitAction;
  updatedBy: string | null;
}): Promise<{ before: AiUsageLimit | null; after: AiUsageLimit }> {
  const before = await getLimit(input.businessAccountId);
  const values = {
    monthlyLimitUsd: input.monthlyLimitUsd.toFixed(2),
    warnAtPercent: input.warnAtPercent,
    action: input.action,
    updatedBy: input.updatedBy,
    updatedAt: new Date(),
  };
  // A changed limit or threshold is a new budget: let its thresholds fire again this month.
  const thresholdsChanged = !before
    || Number(before.monthlyLimitUsd) !== Number(values.monthlyLimitUsd)
    || before.warnAtPercent !== values.warnAtPercent;
  const [after] = await db
    .insert(aiUsageLimits)
    .values({ businessAccountId: input.businessAccountId, ...values })
    .onConflictDoUpdate({
      target: aiUsageLimits.businessAccountId,
      set: thresholdsChanged ? { ...values, warnNotifiedMonth: null, limitNotifiedMonth: null } : values,
    })
    .returning();
  if (thresholdsChanged) aiBudgetService.rearm(input.businessAccountId);
  await aiBudgetService.refresh();
  return { before, after };
}

export async function deleteLimit(businessAccountId: string): Promise<AiUsageLimit | null> {
  const [deleted] = await db.delete(aiUsageLimits).where(eq(aiUsageLimits.businessAccountId, businessAccountId)).returning();
  await aiBudgetService.refresh();
  return deleted ?? null;
}

export interface LimitStatus {
  month: string;
  spentUsd: number;
  limit: (LimitInfo & { percentUsed: number; level: LimitLevel }) | null;
}

/** Limit + month-to-date spend for one account, straight from the DB (for banners / dashboards). */
export async function getLimitStatus(businessAccountId: string, month = istMonthKey()): Promise<LimitStatus> {
  const row = await getLimit(businessAccountId);
  if (!row) return { month, spentUsd: 0, limit: null };
  const spentUsd = (await getMonthSpend([businessAccountId], month)).get(businessAccountId) ?? 0;
  const info = toLimitInfo(row);
  return {
    month,
    spentUsd,
    limit: {
      ...info,
      percentUsed: info.monthlyLimitUsd > 0 ? (spentUsd / info.monthlyLimitUsd) * 100 : 100,
      level: limitLevel(spentUsd, info),
    },
  };
}

// ── enforcement cache ────────────────────────────────────────────────────────

export const BUDGET_REFRESH_MS = 60_000;

export type ThresholdKind = "warn" | "limit";

export class AiBudgetService implements AiBudgetGuard {
  private limits = new Map<string, LimitInfo>();
  private spend = new Map<string, { month: string; usd: number }>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** In-process memo of thresholds already recorded ("id|kind|month"); the DB column is the real once-guard. */
  private notified = new Set<string>();
  private lastBlockLog = new Map<string, number>();
  now: () => number = () => Date.now();
  stats = { refreshes: 0, notifications: 0 };

  check(businessAccountId: string): AiBudgetDecision | Promise<AiBudgetDecision> {
    if (!this.loadedAt) return this.refresh().then(() => this.decide(businessAccountId));
    if (this.now() - this.loadedAt >= BUDGET_REFRESH_MS) void this.refresh().catch(() => {});
    return this.decide(businessAccountId);
  }

  /** Synchronous, cache-only: true when new AI calls for this account are refused right now. */
  isBlocked(businessAccountId: string | null | undefined): boolean {
    if (!businessAccountId || !this.loadedAt) return false;
    if (this.now() - this.loadedAt >= BUDGET_REFRESH_MS) void this.refresh().catch(() => {});
    return this.decide(businessAccountId).blocked;
  }

  /** Like isBlocked, but loads the cache first when it has never been loaded. */
  async isBlockedAsync(businessAccountId: string | null | undefined): Promise<boolean> {
    if (!businessAccountId) return false;
    try {
      if (!this.loadedAt) await this.refresh();
    } catch {
      return false;
    }
    return this.isBlocked(businessAccountId);
  }

  private decide(businessAccountId: string): AiBudgetDecision {
    const limit = this.limits.get(businessAccountId);
    if (!limit || limit.action !== "block") return { blocked: false };
    const spentUsd = this.monthSpend(businessAccountId);
    const blocked = spentUsd >= limit.monthlyLimitUsd;
    if (blocked) {
      const last = this.lastBlockLog.get(businessAccountId) || 0;
      if (this.now() - last > 60_000) {
        this.lastBlockLog.set(businessAccountId, this.now());
        console.warn(`[AIBudget] Monthly AI limit reached for ${businessAccountId} ($${spentUsd.toFixed(2)} / $${limit.monthlyLimitUsd.toFixed(2)}) — AI calls refused`);
      }
    }
    return { blocked, limitUsd: limit.monthlyLimitUsd, spentUsd };
  }

  private monthSpend(businessAccountId: string): number {
    const s = this.spend.get(businessAccountId);
    return s && s.month === istMonthKey(this.now()) ? s.usd : 0;
  }

  /** Reloads limits and month-to-date spend of limited accounts (concurrent calls share one load). */
  refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const rows = await db.select().from(aiUsageLimits);
        const month = istMonthKey(this.now());
        const limits = new Map<string, LimitInfo>();
        for (const r of rows) limits.set(r.businessAccountId, toLimitInfo(r));
        const spend = await getMonthSpend(Array.from(limits.keys()), month);
        this.limits = limits;
        this.spend = new Map(Array.from(limits.keys()).map((id) => [id, { month, usd: spend.get(id) ?? 0 }]));
        this.loadedAt = this.now();
        this.stats.refreshes++;
        for (const id of Array.from(limits.keys())) this.evaluate(id);
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** Called by aiUsageLogger after each recorded event. */
  recordSpend(businessAccountId: string, costUsd: number): void {
    if (!this.limits.has(businessAccountId) || !(costUsd > 0)) return;
    const month = istMonthKey(this.now());
    const cur = this.spend.get(businessAccountId);
    const base = cur && cur.month === month ? cur.usd : 0;
    this.spend.set(businessAccountId, { month, usd: base + costUsd });
    this.evaluate(businessAccountId);
  }

  /** Fires the warn / 100% events (once per threshold per month) for crossed thresholds. */
  private evaluate(businessAccountId: string): void {
    const limit = this.limits.get(businessAccountId);
    if (!limit) return;
    const spentUsd = this.monthSpend(businessAccountId);
    const level = limitLevel(spentUsd, limit);
    if (level === "ok") return;
    const month = istMonthKey(this.now());
    const kinds: ThresholdKind[] = level === "exceeded" ? ["warn", "limit"] : ["warn"];
    for (const kind of kinds) {
      const key = `${businessAccountId}|${kind}|${month}`;
      if (this.notified.has(key)) continue;
      this.notified.add(key);
      void this.notify(businessAccountId, kind, month, spentUsd, limit).catch((err) => {
        this.notified.delete(key);
        console.error("[AIBudget] Failed to record threshold event:", err instanceof Error ? err.message : err);
      });
    }
  }

  private async notify(businessAccountId: string, kind: ThresholdKind, month: string, spentUsd: number, limit: LimitInfo): Promise<void> {
    const column = kind === "warn" ? aiUsageLimits.warnNotifiedMonth : aiUsageLimits.limitNotifiedMonth;
    const set = kind === "warn" ? { warnNotifiedMonth: month } : { limitNotifiedMonth: month };
    // Atomic claim: only the first process to flip the column for this month records the event.
    const claimed = await db
      .update(aiUsageLimits)
      .set(set)
      .where(and(eq(aiUsageLimits.businessAccountId, businessAccountId), or(isNull(column), ne(column, month))))
      .returning({ id: aiUsageLimits.id });
    if (claimed.length === 0) return;
    this.stats.notifications++;
    const percentUsed = limit.monthlyLimitUsd > 0 ? Math.round((spentUsd / limit.monthlyLimitUsd) * 1000) / 10 : 100;
    console.warn(`[AIBudget] ${kind === "warn" ? `Warning threshold (${limit.warnAtPercent}%)` : "Monthly limit (100%)"} reached for ${businessAccountId}: $${spentUsd.toFixed(2)} of $${limit.monthlyLimitUsd.toFixed(2)} (${month} IST)`);
    await recordSystemAuditEvent({
      action: kind === "warn" ? "ai_usage.warn_threshold_reached" : "ai_usage.limit_reached",
      outcome: "success",
      businessAccountId,
      resourceType: "ai_usage_limit",
      resourceId: businessAccountId,
      metadata: {
        month,
        timezone: USAGE_TIMEZONE,
        spentUsd: Math.round(spentUsd * 10000) / 10000,
        limitUsd: limit.monthlyLimitUsd,
        warnAtPercent: limit.warnAtPercent,
        percentUsed,
        limitAction: limit.action,
      },
    });
  }

  start(): void {
    setAiBudgetGuard(this);
    void this.refresh().catch((err) => console.error("[AIBudget] Initial load failed:", err instanceof Error ? err.message : err));
    if (!this.timer) {
      this.timer = setInterval(() => { void this.refresh().catch(() => {}); }, BUDGET_REFRESH_MS);
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** A new/changed limit: forget this process's memo so its thresholds can fire again. */
  rearm(businessAccountId: string): void {
    for (const key of Array.from(this.notified)) {
      if (key.startsWith(`${businessAccountId}|`)) this.notified.delete(key);
    }
  }

  /** Test hook: forget everything (next check reloads). */
  reset(): void {
    this.limits.clear();
    this.spend.clear();
    this.notified.clear();
    this.loadedAt = 0;
  }
}

export const aiBudgetService = new AiBudgetService();
// Registering at import time means any process that loads this module (the
// server via index.ts, workers via aiUsageLogger) enforces limits.
setAiBudgetGuard(aiBudgetService);

/** Polite reply used by customer-facing chat when the account's AI budget is exhausted. */
export const AI_UNAVAILABLE_MESSAGE =
  "Sorry, our assistant is unavailable right now. Please try again later or contact us directly.";
