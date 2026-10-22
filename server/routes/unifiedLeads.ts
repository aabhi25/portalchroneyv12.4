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
import { db } from "../db";
import { journeyResponses, journeySteps, journeySessions, conversationJourneys, businessAccounts } from "@shared/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { maskPhonesInText } from "../lib/leadAccess";

const router = Router();

/** Internal markers kept in topicsOfInterest (funnel source), not interests. */
const FUNNEL_MARKERS = new Set(["Via Form", "Via Journey Form", "Discount Availed"]);

/**
 * Website leads, for the table and the export:
 * - `detail.interestTopics`: the topics that are real interests. Journeys also store their answers
 *   in topicsOfInterest (other features rely on that), so the lead's own journey answers and the
 *   funnel markers are left out here; the answers are shown with their questions instead.
 * - `detail.journeyName`, `detail.journeyAnswers` ({ question: answer }) for the journey columns.
 */
async function addLeadExtras(accountId: string, rows: Array<{ channel: string; detail: Record<string, any> }>): Promise<void> {
  const website = rows.filter(r => r.channel === "website" && r.detail);
  if (website.length === 0) return;
  const conversationIds = Array.from(new Set(website.map(r => r.detail.conversationId).filter((v): v is string => typeof v === "string" && !!v)));
  const answersByConv = new Map<string, Array<{ question: string; answer: string }>>();
  const journeyNameByConv = new Map<string, string>();
  let mask = false;
  if (conversationIds.length > 0) {
    const [answers, sessions, account] = await Promise.all([
      db.select({ conversationId: journeyResponses.conversationId, response: journeyResponses.response, question: journeySteps.questionText })
        .from(journeyResponses)
        .leftJoin(journeySteps, eq(journeySteps.id, journeyResponses.stepId))
        .where(inArray(journeyResponses.conversationId, conversationIds))
        .orderBy(asc(journeyResponses.createdAt)),
      db.select({ conversationId: journeySessions.conversationId, name: conversationJourneys.name })
        .from(journeySessions)
        .leftJoin(conversationJourneys, eq(conversationJourneys.id, journeySessions.journeyId))
        .where(and(eq(journeySessions.businessAccountId, accountId), inArray(journeySessions.conversationId, conversationIds)))
        .orderBy(asc(journeySessions.createdAt)),
      storage.getBusinessAccount(accountId),
    ]);
    mask = account?.leadPhoneMaskingEnabled === "true";
    for (const a of answers) {
      const list = answersByConv.get(a.conversationId) || [];
      list.push({ question: (a.question || "").trim(), answer: a.response });
      answersByConv.set(a.conversationId, list);
    }
    for (const s of sessions) {
      if (s.name && !journeyNameByConv.has(s.conversationId)) journeyNameByConv.set(s.conversationId, s.name);
    }
  }
  for (const row of website) {
    const topics: string[] = Array.isArray(row.detail.topicsOfInterest) ? row.detail.topicsOfInterest : [];
    const answers = answersByConv.get(row.detail.conversationId) || [];
    const answerTexts = new Set(answers.map(a => a.answer.trim().toLowerCase()));
    row.detail.interestTopics = topics.filter(t => typeof t === "string" && !FUNNEL_MARKERS.has(t) && !answerTexts.has(t.trim().toLowerCase()));
    row.detail.hasJourneyAnswers = answers.length > 0;
    row.detail.journeyName = journeyNameByConv.get(row.detail.conversationId) || null;
    const byQuestion: Record<string, string> = {};
    for (const a of answers) {
      if (!a.question) continue;
      byQuestion[a.question] = mask ? (maskPhonesInText(a.answer) || "") : a.answer; // latest answer wins
    }
    row.detail.journeyAnswers = byQuestion;
  }
}

async function leadAccount(req: Request, res: Response): Promise<string | null> {
  const accountId = req.user ? await resolveAuthorizedLeadAccountId(req.user) : null;
  if (!accountId) {
    res.status(403).json({ error: "Business account access is no longer authorized" });
    return null;
  }
  return accountId;
}

/**
 * GET /api/leads/unified?channel=all|website|whatsapp|instagram|facebook&status=&search=&from=&to=&page=&limit=
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
    await addLeadExtras(accountId, result.leads);
    res.json({ ...result, page: pageNum, limit });
  } catch (error: any) {
    console.error("[UnifiedLeads] list failed:", error?.message);
    res.status(500).json({ error: "Failed to load leads" });
  }
});

/**
 * Leads table columns: the business's chosen columns (in order; null = default) and the journey
 * questions that can be shown as columns.
 */
router.get("/api/leads/table-columns", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const accountId = await leadAccount(req, res);
    if (!accountId) return;
    const [account, steps] = await Promise.all([
      storage.getBusinessAccount(accountId),
      db.select({ question: journeySteps.questionText })
        .from(journeySteps)
        .innerJoin(conversationJourneys, eq(conversationJourneys.id, journeySteps.journeyId))
        .where(eq(conversationJourneys.businessAccountId, accountId)),
    ]);
    const questions = Array.from(new Set(steps.map(s => (s.question || "").trim()).filter(Boolean)));
    const saved = (account as any)?.leadsTableColumns;
    res.json({ columns: Array.isArray(saved) ? saved : null, journeyQuestions: questions });
  } catch (error: any) {
    console.error("[UnifiedLeads] table columns failed:", error?.message);
    res.status(500).json({ error: "Failed to load columns" });
  }
});

router.put("/api/leads/table-columns", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const accountId = await leadAccount(req, res);
    if (!accountId) return;
    const parsed = z.object({ columns: z.array(z.string().trim().min(1).max(300)).max(40).nullable() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid columns" });
    const columns = parsed.data.columns ? Array.from(new Set(parsed.data.columns)) : null;
    await db.update(businessAccounts).set({ leadsTableColumns: columns } as any).where(eq(businessAccounts.id, accountId));
    res.json({ columns });
  } catch (error: any) {
    console.error("[UnifiedLeads] save table columns failed:", error?.message);
    res.status(500).json({ error: "Failed to save columns" });
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
    await addLeadExtras(accountId, result.leads);
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
