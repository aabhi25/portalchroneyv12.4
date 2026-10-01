import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth";
import { storage } from "../storage";
import { resolveAuthorizedLeadAccountId } from "../lib/leadAccess";
import { recordAuditEventSafely } from "../services/auditService";
import {
  deleteLimit,
  getLimitStatus,
  isValidMonthKey,
  istMonthKey,
  upsertLimit,
  usdInrRate,
} from "../services/aiBudgetService";
import { getAccountMonthUsage, getAllAccountsSummary } from "../services/aiUsageReportService";

/**
 * AI usage & spend API — super admins only (business users and group admins never see spend).
 *  - GET  /api/usage/summary            one account's month (super admin: any account, default the
 *                                       viewed-as account)
 *  - GET  /api/usage/limit-status       banner data for the active account (super admin: full;
 *                                       anyone else: only whether AI replies are paused)
 *  - GET  /api/super-admin/usage        all accounts for a month (super admin)
 *  - PUT/DELETE /api/super-admin/usage/limits/:businessAccountId  set/remove a monthly limit (super admin, audited)
 * Months are IST calendar months ("YYYY-MM"), default the current one.
 */
const router = Router();

function parseMonth(req: Request, res: Response): string | null {
  const raw = req.query.month;
  if (raw === undefined || raw === "") return istMonthKey();
  if (!isValidMonthKey(raw)) {
    res.status(400).json({ error: "month must be YYYY-MM" });
    return null;
  }
  return raw;
}

/** Super admin: the account to read (requested, else the viewed-as one), or null after sending the error. */
function resolveUsageAccount(req: Request, res: Response, requested: unknown): string | null {
  const requestedId = typeof requested === "string" && requested ? requested : null;
  const id = requestedId || req.user!.activeBusinessAccountId || null;
  if (!id) {
    res.status(400).json({ error: "businessAccountId required" });
    return null;
  }
  return id;
}

router.get("/api/usage/summary", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const month = parseMonth(req, res);
    if (!month) return;
    const accountId = resolveUsageAccount(req, res, req.query.businessAccountId);
    if (!accountId) return;
    const account = await storage.getBusinessAccount(accountId);
    if (!account) return res.status(404).json({ error: "Business account not found" });
    const usage = await getAccountMonthUsage(accountId, month);
    res.json({ ...usage, businessName: account.name });
  } catch (error) {
    console.error("[AI Usage] summary error:", error);
    res.status(500).json({ error: "Failed to load usage" });
  }
});

router.get("/api/usage/limit-status", requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    if (user.role === "account_group_admin" || (user.role === "super_admin" && !user.activeBusinessAccountId)) {
      return res.json({ limit: null });
    }
    if (user.role !== "super_admin") {
      // Business users never see spend or the limit; only whether AI replies are paused for the month.
      const own = await resolveAuthorizedLeadAccountId(user);
      if (!own) return res.json({ limit: null, aiPaused: false });
      const status = await getLimitStatus(own);
      const aiPaused = status.limit?.level === "exceeded" && status.limit?.action === "block";
      return res.json({ limit: null, aiPaused });
    }
    const accountId = resolveUsageAccount(req, res, undefined);
    if (!accountId) return;
    const status = await getLimitStatus(accountId);
    res.json({ ...status, businessAccountId: accountId, usdInrRate: usdInrRate() });
  } catch (error) {
    console.error("[AI Usage] limit-status error:", error);
    res.status(500).json({ error: "Failed to load limit status" });
  }
});

router.get("/api/super-admin/usage", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const month = parseMonth(req, res);
    if (!month) return;
    res.json(await getAllAccountsSummary(month));
  } catch (error) {
    console.error("[AI Usage] all-accounts error:", error);
    res.status(500).json({ error: "Failed to load usage" });
  }
});

const limitBody = z.object({
  monthlyLimitUsd: z.coerce.number().finite().positive().max(1_000_000),
  warnAtPercent: z.coerce.number().int().min(1).max(100).default(80),
  action: z.enum(["warn", "block"]).default("warn"),
});

function limitAudit(row: { monthlyLimitUsd: string; warnAtPercent: number; action: string } | null, prefix: string) {
  if (!row) return { [`${prefix}LimitUsd`]: null };
  return {
    [`${prefix}LimitUsd`]: Number(row.monthlyLimitUsd),
    [`${prefix}WarnAtPercent`]: row.warnAtPercent,
    [`${prefix}Action`]: row.action,
  };
}

router.put("/api/super-admin/usage/limits/:businessAccountId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const parsed = limitBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid limit", details: parsed.error.flatten().fieldErrors });
    }
    const { businessAccountId } = req.params;
    const account = await storage.getBusinessAccount(businessAccountId);
    if (!account) return res.status(404).json({ error: "Business account not found" });
    const { before, after } = await upsertLimit({ businessAccountId, ...parsed.data, updatedBy: req.user!.id });
    await recordAuditEventSafely(req, {
      action: "ai_usage.limit_set",
      outcome: "success",
      businessAccountId,
      resourceType: "ai_usage_limit",
      resourceId: businessAccountId,
      metadata: { ...limitAudit(before, "previous"), ...limitAudit(after, "new") },
    });
    const status = await getLimitStatus(businessAccountId);
    res.json({ limit: after, status });
  } catch (error) {
    console.error("[AI Usage] set limit error:", error);
    res.status(500).json({ error: "Failed to save limit" });
  }
});

router.delete("/api/super-admin/usage/limits/:businessAccountId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const { businessAccountId } = req.params;
    const deleted = await deleteLimit(businessAccountId);
    if (deleted) {
      await recordAuditEventSafely(req, {
        action: "ai_usage.limit_removed",
        outcome: "success",
        businessAccountId,
        resourceType: "ai_usage_limit",
        resourceId: businessAccountId,
        metadata: limitAudit(deleted, "previous"),
      });
    }
    res.json({ removed: !!deleted });
  } catch (error) {
    console.error("[AI Usage] delete limit error:", error);
    res.status(500).json({ error: "Failed to remove limit" });
  }
});

export default router;
