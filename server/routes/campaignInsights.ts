/**
 * Campaigns home summary, the cross-campaign results dashboard and the
 * automation daily-schedule endpoints. Same auth + WhatsApp-marketing gate as
 * every other campaign route (the gate middleware is passed in from routes.ts
 * so there is exactly one definition of it).
 *
 * No cost or AI-usage figures are returned by anything here.
 */
import type { Express, RequestHandler } from "express";
import { requireAuth, requireBusinessAccount } from "../auth";

export function registerCampaignInsightsRoutes(app: Express, requireWhatsappMarketing: RequestHandler): void {
  const guard = [requireAuth, requireBusinessAccount, requireWhatsappMarketing] as RequestHandler[];

  app.get("/api/whatsapp/campaign-home/summary", ...guard, async (req, res) => {
    try {
      const { getCampaignHomeSummary } = await import("../services/campaignInsightsService");
      res.json(await getCampaignHomeSummary(req.user!.businessAccountId!, req.query.tz));
    } catch (err: any) {
      console.error("[CampaignInsights] home summary failed:", err?.message);
      res.status(500).json({ error: "Could not load the campaign summary" });
    }
  });

  app.get("/api/whatsapp/campaign-insights", ...guard, async (req, res) => {
    try {
      const { getCampaignInsights } = await import("../services/campaignInsightsService");
      res.json(await getCampaignInsights(req.user!.businessAccountId!, {
        from: req.query.from,
        to: req.query.to,
        tz: req.query.tz,
      }));
    } catch (err: any) {
      console.error("[CampaignInsights] dashboard failed:", err?.message);
      res.status(500).json({ error: "Could not load campaign results" });
    }
  });

  app.get("/api/whatsapp/campaign-automations/:id/schedule", ...guard, async (req, res) => {
    try {
      const { getAutomationSchedule } = await import("../services/campaignAutomationService");
      const schedule = await getAutomationSchedule(req.user!.businessAccountId!, req.params.id);
      if (!schedule) return res.status(404).json({ error: "Automation not found" });
      res.json(schedule);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Could not load the schedule" });
    }
  });

  app.patch("/api/whatsapp/campaign-automations/:id/schedule", ...guard, async (req, res) => {
    try {
      const { setAutomationSchedule, getAutomationSchedule } = await import("../services/campaignAutomationService");
      const saved = await setAutomationSchedule(req.user!.businessAccountId!, req.params.id, {
        scheduleEnabled: req.body?.scheduleEnabled,
        scheduleDays: req.body?.scheduleDays,
      });
      if (!saved) return res.status(404).json({ error: "Automation not found" });
      res.json(await getAutomationSchedule(req.user!.businessAccountId!, req.params.id));
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Could not save the schedule" });
    }
  });
}
