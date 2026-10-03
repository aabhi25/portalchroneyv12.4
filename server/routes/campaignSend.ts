/**
 * Campaign creation / sending helpers: audience preview, "send test to my phone",
 * follow-up status and bulk actions. Registered inside the WhatsApp campaign block of
 * routes.ts so every endpoint sits behind the same auth + whatsappMarketingEnabled gate.
 */
import type { Express, RequestHandler, Response } from "express";
import { requireAuth, requireBusinessAccount } from "../auth";

function fail(res: Response, err: any) {
  if (err?.name === "CampaignToolError") return res.status(err.status || 400).json({ error: err.message });
  console.error("[CampaignSend] request failed:", err?.message || err);
  return res.status(400).json({ error: err?.message || "Something went wrong" });
}

export function registerCampaignSendRoutes(app: Express, requireWhatsappMarketing: RequestHandler): void {
  const guard = [requireAuth, requireBusinessAccount, requireWhatsappMarketing] as RequestHandler[];

  // Who will get it, and which numbers are skipped (invalid / duplicate / opted out).
  app.post("/api/whatsapp/campaigns/audience-preview", ...guard, async (req, res) => {
    try {
      const { previewAudience } = await import("../services/campaignSendTools");
      const groupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds.map(String) : [];
      res.json(await previewAudience(req.user!.businessAccountId!, groupIds));
    } catch (err) { fail(res, err); }
  });

  app.get("/api/whatsapp/campaigns/:id/audience-preview", ...guard, async (req, res) => {
    try {
      const { previewCampaignAudience } = await import("../services/campaignSendTools");
      const preview = await previewCampaignAudience(req.user!.businessAccountId!, req.params.id);
      if (!preview) return res.status(404).json({ error: "Campaign not found" });
      res.json(preview);
    } catch (err) { fail(res, err); }
  });

  // Test message for a campaign that hasn't been saved yet (wizard review step).
  app.post("/api/whatsapp/campaigns/test-send", ...guard, async (req, res) => {
    try {
      const { sendCampaignTest } = await import("../services/campaignSendTools");
      const body = req.body || {};
      const result = await sendCampaignTest(req.user!.businessAccountId!, {
        phone: String(body.phone || ""),
        templateId: body.templateId ? String(body.templateId) : null,
        templateParams: Array.isArray(body.templateParams) ? body.templateParams.map((v: unknown) => String(v ?? "")) : [],
        groupIds: Array.isArray(body.groupIds) ? body.groupIds.map(String) : [],
        userId: req.user?.id ?? null,
      });
      res.status(result.success ? 200 : 502).json(result);
    } catch (err) { fail(res, err); }
  });

  // Test message for a saved campaign (optionally its message B).
  app.post("/api/whatsapp/campaigns/:id/test-send", ...guard, async (req, res) => {
    try {
      const { sendCampaignTest } = await import("../services/campaignSendTools");
      const result = await sendCampaignTest(req.user!.businessAccountId!, {
        phone: String(req.body?.phone || ""),
        campaignId: req.params.id,
        variant: req.body?.variant === "B" ? "B" : "A",
        userId: req.user?.id ?? null,
      });
      res.status(result.success ? 200 : 502).json(result);
    } catch (err) { fail(res, err); }
  });

  app.get("/api/whatsapp/campaigns/:id/follow-ups", ...guard, async (req, res) => {
    try {
      const { marketingCampaignService } = await import("../services/marketingCampaignService");
      const campaign = await marketingCampaignService.get(req.user!.businessAccountId!, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      const { getFollowUpSummary } = await import("../services/campaignFollowUpService");
      res.json(await getFollowUpSummary(req.user!.businessAccountId!, req.params.id));
    } catch (err) { fail(res, err); }
  });

  // Bulk actions from the campaigns list: delete drafts, cancel scheduled campaigns.
  app.post("/api/whatsapp/campaigns/bulk", ...guard, async (req, res) => {
    try {
      const { bulkCampaignAction } = await import("../services/campaignSendTools");
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
      res.json(await bulkCampaignAction(req.user!.businessAccountId!, req.body?.action, ids));
    } catch (err) { fail(res, err); }
  });
}
