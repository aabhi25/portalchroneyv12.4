/**
 * Campaign results funnel + Campaign replies inbox (search, filters, one thread), staff
 * takeover (manual WhatsApp reply inside the 24-hour window) and pause / resume of the
 * campaign AI per customer. Same auth + WhatsApp Marketing gate as the other campaign routes.
 */
import type { Express, RequestHandler } from "express";
import { requireAuth, requireBusinessAccount } from "../auth";
import { recordAuditEventSafely } from "../services/auditService";
import {
  getCampaignFunnel,
  listCampaignReplies,
  getCampaignReplyThread,
  sendManualReply,
  setCampaignAiPaused,
  markCampaignReplyHandled,
} from "../services/campaignRepliesService";

const flag = (v: unknown) => v === "1" || v === "true";

export function registerCampaignRepliesRoutes(app: Express, requireWhatsappMarketing: RequestHandler): void {
  const guard = [requireAuth, requireBusinessAccount, requireWhatsappMarketing];

  app.get("/api/whatsapp/campaigns/:id/funnel", ...guard, async (req, res) => {
    try {
      const funnel = await getCampaignFunnel(req.user!.businessAccountId!, req.params.id);
      if (!funnel) return res.status(404).json({ error: "Campaign not found" });
      res.json(funnel);
    } catch (err: any) {
      console.error("[CampaignReplies] funnel failed:", err?.message);
      res.status(500).json({ error: "Couldn't load the campaign results" });
    }
  });

  app.get("/api/whatsapp/campaign-replies", ...guard, async (req, res) => {
    try {
      const q = req.query;
      const result = await listCampaignReplies(req.user!.businessAccountId!, {
        campaignId: typeof q.campaignId === "string" && q.campaignId !== "all" ? q.campaignId : null,
        outcome: typeof q.outcome === "string" && q.outcome !== "all" ? q.outcome : null,
        needsHuman: flag(q.needsHuman),
        aiPaused: flag(q.aiPaused),
        unread: flag(q.unread),
        repliedOnly: q.replied === undefined ? true : flag(q.replied),
        search: typeof q.search === "string" ? q.search : null,
        limit: parseInt(String(q.limit ?? "50"), 10) || 50,
        offset: parseInt(String(q.offset ?? "0"), 10) || 0,
      });
      res.json(result);
    } catch (err: any) {
      console.error("[CampaignReplies] list failed:", err?.message);
      res.status(500).json({ error: "Couldn't load campaign replies" });
    }
  });

  app.get("/api/whatsapp/campaign-replies/:recipientId", ...guard, async (req, res) => {
    try {
      const thread = await getCampaignReplyThread(req.user!.businessAccountId!, req.params.recipientId, { markRead: req.query.markRead !== "0" });
      if (!thread) return res.status(404).json({ error: "This conversation was not found" });
      res.json(thread);
    } catch (err: any) {
      console.error("[CampaignReplies] thread failed:", err?.message);
      res.status(500).json({ error: "Couldn't load this conversation" });
    }
  });

  app.post("/api/whatsapp/campaign-replies/:recipientId/reply", ...guard, async (req, res) => {
    const businessAccountId = req.user!.businessAccountId!;
    try {
      const outcome = await sendManualReply(
        businessAccountId,
        req.params.recipientId,
        typeof req.body?.text === "string" ? req.body.text : "",
        { userId: req.user!.id, name: (req.user as any)?.username || null },
        { pauseAi: req.body?.pauseAi !== false },
      );
      await recordAuditEventSafely(req, {
        action: "campaign_reply.manual_reply",
        outcome: outcome.ok ? "success" : "failure",
        businessAccountId,
        resourceType: "marketing_campaign_recipient",
        resourceId: req.params.recipientId,
        metadata: outcome.ok ? {} : { reason: outcome.code },
      });
      if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
      res.json({ message: outcome.message });
    } catch (err: any) {
      console.error("[CampaignReplies] manual reply failed:", err?.message);
      res.status(500).json({ error: "Couldn't send your reply" });
    }
  });

  app.post("/api/whatsapp/campaign-replies/:recipientId/ai", ...guard, async (req, res) => {
    const businessAccountId = req.user!.businessAccountId!;
    try {
      const paused = req.body?.paused === true;
      const ok = await setCampaignAiPaused(businessAccountId, req.params.recipientId, paused);
      if (!ok) return res.status(404).json({ error: "This conversation was not found" });
      await recordAuditEventSafely(req, {
        action: paused ? "campaign_reply.ai_paused" : "campaign_reply.ai_resumed",
        outcome: "success",
        businessAccountId,
        resourceType: "marketing_campaign_recipient",
        resourceId: req.params.recipientId,
      });
      res.json({ aiPaused: paused });
    } catch (err: any) {
      console.error("[CampaignReplies] pause/resume failed:", err?.message);
      res.status(500).json({ error: "Couldn't change the AI for this customer" });
    }
  });

  app.post("/api/whatsapp/campaign-replies/:recipientId/handled", ...guard, async (req, res) => {
    try {
      const ok = await markCampaignReplyHandled(req.user!.businessAccountId!, req.params.recipientId);
      if (!ok) return res.status(404).json({ error: "This conversation was not found" });
      res.json({ needsHuman: false });
    } catch (err: any) {
      console.error("[CampaignReplies] mark handled failed:", err?.message);
      res.status(500).json({ error: "Couldn't update this conversation" });
    }
  });
}
