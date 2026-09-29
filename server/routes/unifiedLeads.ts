// Unified Leads view (all channels) and CRM sync for Instagram / Facebook leads.
import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireBusinessAccount } from "../auth";
import { storage } from "../storage";
import { recordAuditEventSafely } from "../services/auditService";
import { resolveAuthorizedLeadAccountId } from "../lib/leadAccess";
import { parseUnifiedLeadFilters, queryUnifiedLeads } from "../services/unifiedLeadsService";
import { isSocialChannel, type SocialChannel } from "../services/socialLeadFields";

const router = Router();

async function leadAccount(req: Request, res: Response): Promise<string | null> {
  const accountId = req.user ? await resolveAuthorizedLeadAccountId(req.user) : null;
  if (!accountId) {
    res.status(403).json({ error: "Business account access is no longer authorized" });
    return null;
  }
  return accountId;
}

/**
 * GET /api/leads/unified?channel=all|website|whatsapp|instagram|facebook&search=&from=&to=&page=&limit=
 * Leads from every channel enabled for the account, newest first, paged in SQL.
 */
router.get("/api/leads/unified", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const accountId = await leadAccount(req, res);
    if (!accountId) return;
    const filters = parseUnifiedLeadFilters(req.query as Record<string, unknown>);
    if ("error" in filters) return res.status(400).json({ error: filters.error });
    const pageNum = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "20"), 10) || 20));
    const result = await queryUnifiedLeads(accountId, filters, { limit, offset: (pageNum - 1) * limit });
    res.json({ ...result, page: pageNum, limit });
  } catch (error: any) {
    console.error("[UnifiedLeads] list failed:", error?.message);
    res.status(500).json({ error: "Failed to load leads" });
  }
});

/** Same filters, no paging. Only when leadsExportEnabled is on for the account (as /api/leads/export). */
router.get("/api/leads/unified/export", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const accountId = await leadAccount(req, res);
    if (!accountId) return;
    const account = await storage.getBusinessAccount(accountId);
    if (account?.leadsExportEnabled !== "true") {
      await recordAuditEventSafely(req, {
        action: "leads.export.data_delivered",
        outcome: "denied",
        businessAccountId: accountId,
        resourceType: "lead_report",
        metadata: { reason: "account_export_disabled" },
      });
      return res.status(403).json({ error: "Lead export is not enabled for this business account" });
    }
    const filters = parseUnifiedLeadFilters(req.query as Record<string, unknown>);
    if ("error" in filters) return res.status(400).json({ error: filters.error });
    const result = await queryUnifiedLeads(accountId, filters, null);
    const exportId = randomUUID();
    await recordAuditEventSafely(req, {
      action: "leads.export.data_delivered",
      outcome: "success",
      businessAccountId: accountId,
      resourceType: "lead_report",
      resourceId: exportId,
      metadata: {
        format: "xlsx",
        recordCount: result.total,
        channel: filters.channel || "all",
        fromDate: filters.from ? filters.from.toISOString() : null,
        toDate: filters.to ? filters.to.toISOString() : null,
        hasSearchFilter: !!filters.search?.trim(),
      },
    });
    res.json({ leads: result.leads, total: result.total, exportId });
  } catch (error: any) {
    await recordAuditEventSafely(req, {
      action: "leads.export.data_delivered",
      outcome: "failure",
      resourceType: "lead_report",
      metadata: { reason: "export_query_failed" },
    });
    res.status(500).json({ error: "Failed to export leads" });
  }
});

// ── Instagram / Facebook CRM sync ────────────────────────────────────────────

async function socialContext(req: Request, res: Response): Promise<{ accountId: string; channel: SocialChannel } | null> {
  const channel = req.params.channel;
  if (!isSocialChannel(channel)) {
    res.status(404).json({ error: "Unknown channel" });
    return null;
  }
  const accountId = await leadAccount(req, res);
  if (!accountId) return null;
  const account = await storage.getBusinessAccount(accountId);
  const enabled = channel === "instagram" ? account?.instagramEnabled === "true" : account?.facebookEnabled === "true";
  if (!enabled) {
    res.status(403).json({ error: `${channel === "instagram" ? "Instagram" : "Facebook"} is not enabled for this business account` });
    return null;
  }
  return { accountId, channel };
}

/** Which CRMs IG/FB leads can be pushed to for this account. */
router.get("/api/social-leads/crm-config", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const accountId = await leadAccount(req, res);
    if (!accountId) return;
    const { socialCrmConfig } = await import("../services/socialLeadCrmSync");
    res.json(await socialCrmConfig(accountId));
  } catch (error: any) {
    res.status(500).json({ error: "Failed to load CRM settings" });
  }
});

const crmBody = z.object({ crm: z.enum(["leadsquared", "salesforce", "custom_crm"]).optional() }).passthrough();

/** Manual Sync of one IG/FB lead: to the given CRM, or to every configured CRM when none is given. */
router.post("/api/social-leads/:channel/:leadId/sync", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const ctx = await socialContext(req, res);
    if (!ctx) return;
    const body = crmBody.safeParse(req.body || {});
    if (!body.success) return res.status(400).json({ error: "Unknown CRM" });
    const { socialCrmConfig, syncSocialLead, loadSocialLead, SOCIAL_CRMS } = await import("../services/socialLeadCrmSync");
    const lead = await loadSocialLead(ctx.channel, req.params.leadId, ctx.accountId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    const config = await socialCrmConfig(ctx.accountId);
    const crms = body.data.crm ? [body.data.crm] : SOCIAL_CRMS.filter(c => config[c].configured);
    if (crms.length === 0 || crms.some(c => !config[c].configured)) {
      return res.status(400).json({ error: "This CRM integration is not enabled/configured" });
    }
    const results = [];
    for (const crm of crms) {
      results.push(await syncSocialLead(ctx.channel, lead.id, crm, { mode: "manual", source: "manual", businessAccountId: ctx.accountId }));
    }
    const failed = results.filter(r => !r.success);
    const allSkippedSynced = results.every(r => r.skipped === "already_synced");
    res.status(failed.length === results.length && !allSkippedSynced ? 400 : 200).json({
      success: failed.length === 0,
      results,
      message: failed.length === 0
        ? (allSkippedSynced ? "Lead is already synced" : "Lead synced")
        : failed.map(r => r.message).join("; "),
      ...(failed.length ? { error: failed.map(r => r.message).join("; ") } : {}),
    });
  } catch (error: any) {
    console.error("[SocialLeadCRM] manual sync failed:", error?.message);
    res.status(500).json({ error: "Sync failed" });
  }
});

/** Sync all: every not-yet-synced IG/FB lead of the channel, to the given CRM or every configured CRM. */
router.post("/api/social-leads/:channel/sync-all", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const ctx = await socialContext(req, res);
    if (!ctx) return;
    const body = crmBody.safeParse(req.body || {});
    if (!body.success) return res.status(400).json({ error: "Unknown CRM" });
    const { socialCrmConfig, syncAllSocialLeads, SOCIAL_CRMS } = await import("../services/socialLeadCrmSync");
    const config = await socialCrmConfig(ctx.accountId);
    const crms = body.data.crm ? [body.data.crm] : SOCIAL_CRMS.filter(c => config[c].configured);
    if (crms.length === 0 || crms.some(c => !config[c].configured)) {
      return res.status(400).json({ error: "No CRM integration is enabled/configured" });
    }
    const summary = await syncAllSocialLeads(ctx.channel, ctx.accountId, crms);
    const synced = Object.values(summary).reduce((a, s) => a + s.synced, 0);
    const failed = Object.values(summary).reduce((a, s) => a + s.failed, 0);
    const skipped = Object.values(summary).reduce((a, s) => a + s.skipped, 0);
    res.json({ success: true, summary, synced, failed, skipped, message: `Synced ${synced}, failed ${failed}, skipped ${skipped}` });
  } catch (error: any) {
    console.error("[SocialLeadCRM] sync-all failed:", error?.message);
    res.status(500).json({ error: "Sync failed" });
  }
});

export default router;
