/**
 * WhatsApp Campaigns — audiences, templates, opt-outs and AI workbook sync.
 *
 *  Audiences:  paged/searchable contacts, bulk delete, audiences from Leads,
 *              self-updating (dynamic) audiences with a live count.
 *  Templates:  real approval status (check with the provider / confirm by hand),
 *              AI "help me write".
 *  Opt-outs:   searchable list, add by hand, CSV export (GET list / DELETE stay in routes.ts).
 *  Workbooks:  "Sync now" and the editing heartbeat used by the automatic sync.
 *
 * Every endpoint sits behind the same auth + WhatsApp Marketing gate as the
 * existing campaign routes (the gate is passed in from routes.ts).
 */
import type { Express, Request, RequestHandler, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireBusinessAccount } from "../auth";
import { db } from "../db";
import { businessAccounts } from "@shared/schema";
import { AudienceError, contactGroupService, normalizeAudienceRules, normalizeLeadFilter, type ContactSort } from "../services/contactGroupService";
import { whatsappTemplateService } from "../services/whatsappTemplateService";
import { whatsappAiWorkbookService } from "../services/whatsappAiWorkbookService";

const biz = (req: Request) => req.user!.businessAccountId!;

function fail(res: Response, err: any, fallbackStatus = 500) {
  const message = err?.message || "Something went wrong";
  const status = err instanceof AudienceError ? 400 : fallbackStatus;
  if (status >= 500) console.error("[CampaignAudiences]", message);
  res.status(status).json({ error: message });
}

/** CSV cell: quoted, and never interpreted as a spreadsheet formula. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const OPT_OUT_REASON_LABELS: Record<string, string> = {
  user_stop: "Replied STOP",
  manual: "Added by your team",
  bounce: "Number could not receive messages",
};

export function registerCampaignAudienceRoutes(app: Express, requireWhatsappMarketing: RequestHandler) {
  const gate = [requireAuth, requireBusinessAccount, requireWhatsappMarketing] as RequestHandler[];

  // ── Audiences ──────────────────────────────────────────────────────────────

  app.get("/api/whatsapp/audiences/:id/contacts", ...gate, async (req, res) => {
    try {
      const group = await contactGroupService.get(biz(req), req.params.id);
      if (!group) return res.status(404).json({ error: "Audience not found" });
      const sort = ["newest", "oldest", "name", "phone"].includes(String(req.query.sort)) ? String(req.query.sort) as ContactSort : "newest";
      const result = await contactGroupService.listContactsPage(biz(req), req.params.id, {
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 50,
        search: typeof req.query.search === "string" ? req.query.search : "",
        sort,
      });
      res.json(result);
    } catch (err) { fail(res, err); }
  });

  app.post("/api/whatsapp/audiences/:id/contacts/bulk-delete", ...gate, async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.allMatching && (!Array.isArray(body.contactIds) || body.contactIds.length === 0)) {
        return res.status(400).json({ error: "Choose the contacts to remove" });
      }
      const removed = await contactGroupService.bulkRemoveContacts(biz(req), req.params.id, {
        contactIds: Array.isArray(body.contactIds) ? body.contactIds : [],
        allMatching: body.allMatching === true,
        search: typeof body.search === "string" ? body.search : "",
      });
      res.json({ removed });
    } catch (err) { fail(res, err); }
  });

  app.post("/api/whatsapp/audiences/bulk-delete", ...gate, async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (ids.length === 0) return res.status(400).json({ error: "Choose the audiences to delete" });
      const removed = await contactGroupService.bulkRemove(biz(req), ids);
      res.json({ removed });
    } catch (err) { fail(res, err); }
  });

  /** Choices for the "from leads" filter: enabled channels, statuses and topics seen in this account's leads. */
  app.get("/api/whatsapp/audiences/lead-options", ...gate, async (req, res) => {
    try {
      const accountId = biz(req);
      const [account] = await db.select().from(businessAccounts).where(eq(businessAccounts.id, accountId)).limit(1);
      const { enabledLeadChannels } = await import("../services/unifiedLeadsService");
      const channels = account ? enabledLeadChannels(account) : ["website"];
      const statusRows: any = await db.execute(sql`
        SELECT DISTINCT status FROM (
          SELECT status FROM whatsapp_leads WHERE business_account_id = ${accountId} AND status <> 'message_only'
          UNION ALL SELECT status FROM instagram_leads WHERE business_account_id = ${accountId}
          UNION ALL SELECT status FROM facebook_leads WHERE business_account_id = ${accountId}
        ) s WHERE status IS NOT NULL AND status <> '' LIMIT 50
      `);
      const topicRows: any = await db.execute(sql`
        SELECT t AS topic, COUNT(*)::int AS n
        FROM leads l, jsonb_array_elements_text(COALESCE(l.topics_of_interest, '[]'::jsonb)) t
        WHERE l.business_account_id = ${accountId}
        GROUP BY t ORDER BY n DESC LIMIT 50
      `);
      res.json({
        channels,
        statuses: (statusRows.rows || []).map((r: any) => String(r.status)),
        topics: (topicRows.rows || []).map((r: any) => String(r.topic)),
        phonesHidden: account?.leadPhoneMaskingEnabled === "true",
      });
    } catch (err) { fail(res, err); }
  });

  /** Extra fields (columns) found in this account's audiences, for the rule builder. */
  app.get("/api/whatsapp/audiences/fields", ...gate, async (req, res) => {
    try {
      const rows: any = await db.execute(sql`
        SELECT k AS field, COUNT(*)::int AS n
        FROM (
          SELECT c.attributes FROM contact_group_contacts c
          JOIN contact_groups g ON g.id = c.group_id
          WHERE c.business_account_id = ${biz(req)} AND g.audience_type = 'static'
          LIMIT 20000
        ) s, jsonb_object_keys(COALESCE(s.attributes, '{}'::jsonb)) k
        GROUP BY k ORDER BY n DESC LIMIT 100
      `);
      res.json({ fields: (rows.rows || []).map((r: any) => String(r.field)) });
    } catch (err) { fail(res, err); }
  });

  app.post("/api/whatsapp/audiences/leads-preview", ...gate, async (req, res) => {
    try {
      const { members, stats } = await contactGroupService.collectLeadMembers(biz(req), normalizeLeadFilter(req.body?.filter || {}));
      res.json({ ...stats, sample: members.slice(0, 10) });
    } catch (err) { fail(res, err); }
  });

  app.post("/api/whatsapp/audiences/from-leads", ...gate, async (req, res) => {
    try {
      const body = req.body || {};
      const result = await contactGroupService.createFromLeads(biz(req), {
        name: String(body.name || ""),
        description: typeof body.description === "string" ? body.description : undefined,
        filter: normalizeLeadFilter(body.filter || {}),
        dynamic: body.dynamic === true,
      });
      res.status(201).json(result);
    } catch (err) { fail(res, err); }
  });

  app.post("/api/whatsapp/audiences/preview-rules", ...gate, async (req, res) => {
    try {
      const rules = normalizeAudienceRules(req.body?.rules);
      const excludeGroupId = typeof req.body?.excludeGroupId === "string" ? req.body.excludeGroupId : undefined;
      res.json(await contactGroupService.previewRules(biz(req), rules, excludeGroupId));
    } catch (err) { fail(res, err); }
  });

  app.post("/api/whatsapp/audiences/dynamic", ...gate, async (req, res) => {
    try {
      const body = req.body || {};
      const result = await contactGroupService.createDynamic(biz(req), {
        name: String(body.name || ""),
        description: typeof body.description === "string" ? body.description : undefined,
        rules: normalizeAudienceRules(body.rules),
      });
      res.status(201).json(result);
    } catch (err) { fail(res, err); }
  });

  app.put("/api/whatsapp/audiences/:id/rules", ...gate, async (req, res) => {
    try {
      const result = await contactGroupService.updateRules(biz(req), req.params.id, normalizeAudienceRules(req.body?.rules));
      res.json(result);
    } catch (err) { fail(res, err); }
  });

  /** Dynamic: re-evaluate now. Static from leads: add newly matching leads. */
  app.post("/api/whatsapp/audiences/:id/refresh", ...gate, async (req, res) => {
    try {
      const group = await contactGroupService.get(biz(req), req.params.id);
      if (!group) return res.status(404).json({ error: "Audience not found" });
      if (group.audienceType === "dynamic") {
        return res.json(await contactGroupService.refreshDynamicAudience(biz(req), group.id));
      }
      res.json(await contactGroupService.refreshFromLeads(biz(req), group.id));
    } catch (err) { fail(res, err); }
  });

  // ── Templates ──────────────────────────────────────────────────────────────

  const providerCredentials = async (accountId: string) => {
    const { whatsappService } = await import("../services/whatsappService");
    const settings = await whatsappService.getSettings(accountId);
    if (!settings?.msg91AuthKey) throw new AudienceError("Your WhatsApp connection isn't set up yet, so the status can't be checked automatically. Connect WhatsApp first, or confirm the template yourself.");
    if (!settings.whatsappNumber) throw new AudienceError("Save your WhatsApp business number in WhatsApp → Connection settings first.");
    return { authKey: settings.msg91AuthKey, number: settings.whatsappNumber };
  };

  app.post("/api/whatsapp/templates/refresh-status", ...gate, async (req, res) => {
    try {
      const { authKey, number } = await providerCredentials(biz(req));
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : undefined;
      res.json(await whatsappTemplateService.refreshStatus(biz(req), authKey, number, ids));
    } catch (err) { fail(res, err, 502); }
  });

  app.post("/api/whatsapp/templates/:id/refresh-status", ...gate, async (req, res) => {
    try {
      const tpl = await whatsappTemplateService.get(biz(req), req.params.id);
      if (!tpl) return res.status(404).json({ error: "Template not found" });
      const { authKey, number } = await providerCredentials(biz(req));
      const result = await whatsappTemplateService.refreshStatus(biz(req), authKey, number, [tpl.id]);
      res.json({ check: result.checked[0] || null, template: result.templates.find(t => t.id === tpl.id) || null });
    } catch (err) { fail(res, err, 502); }
  });

  app.post("/api/whatsapp/templates/:id/confirm-approved", ...gate, async (req, res) => {
    try {
      const tpl = await whatsappTemplateService.confirmApproved(biz(req), req.params.id);
      if (!tpl) return res.status(404).json({ error: "Template not found" });
      res.json(tpl);
    } catch (err) { fail(res, err, 400); }
  });

  app.post("/api/whatsapp/templates/draft", ...gate, async (req, res) => {
    try {
      const body = req.body || {};
      const draft = await whatsappTemplateService.draftTemplate(biz(req), {
        goal: String(body.goal || ""),
        category: typeof body.category === "string" ? body.category : undefined,
        language: typeof body.language === "string" ? body.language : undefined,
        tone: typeof body.tone === "string" ? body.tone : undefined,
      });
      res.json(draft);
    } catch (err: any) {
      // Budget / key problems are the user's to fix, not server errors.
      fail(res, err, 400);
    }
  });

  // ── Opt-outs ───────────────────────────────────────────────────────────────

  app.get("/api/whatsapp/opt-outs/search", ...gate, async (req, res) => {
    try {
      const result = await contactGroupService.listOptOuts(biz(req), {
        search: typeof req.query.search === "string" ? req.query.search : "",
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 50,
      });
      res.json({
        ...result,
        optOuts: result.optOuts.map(row => ({ ...row, reasonLabel: OPT_OUT_REASON_LABELS[row.reason || ""] || row.reason || "" })),
      });
    } catch (err) { fail(res, err); }
  });

  app.post("/api/whatsapp/opt-outs", ...gate, async (req, res) => {
    try {
      const result = await contactGroupService.addOptOut(biz(req), String(req.body?.phone || ""));
      res.status(result.added ? 201 : 200).json(result);
    } catch (err) { fail(res, err); }
  });

  app.get("/api/whatsapp/opt-outs/export.csv", ...gate, async (req, res) => {
    try {
      const rows = await contactGroupService.exportOptOuts(biz(req));
      const lines = [
        ["Phone", "Reason", "Campaign", "Date added"].map(csvCell).join(","),
        ...rows.map(r => [r.phone, OPT_OUT_REASON_LABELS[r.reason || ""] || r.reason || "", r.campaignName || "", r.createdAt].map(csvCell).join(",")),
      ];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="opt-outs-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(`﻿${lines.join("\r\n")}\r\n`);
    } catch (err) { fail(res, err); }
  });

  // ── AI Workbooks: sync ─────────────────────────────────────────────────────

  app.post("/api/whatsapp/ai-workbooks/:id/sync-now", ...gate, async (req, res) => {
    try {
      res.json(await whatsappAiWorkbookService.syncNow(biz(req), req.params.id));
    } catch (err: any) {
      res.status(String(err?.message).includes("another session") ? 409 : 400).json({ error: err?.message || "Sync failed" });
    }
  });

  app.post("/api/whatsapp/ai-workbooks/:id/editing", ...gate, async (req, res) => {
    try {
      const ok = await whatsappAiWorkbookService.markEditing(biz(req), req.params.id);
      if (!ok) return res.status(404).json({ error: "Workbook not found" });
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });
}
