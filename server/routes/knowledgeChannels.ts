/**
 * Channel tags on training items (see shared/knowledgeChannels.ts).
 *
 *   PATCH /api/training-documents/:id   { channels }
 *   PATCH /api/trained-urls/:id         { channels }
 *   PATCH /api/analyzed-pages/:id       { channels }
 *
 * FAQs take `channels` on their own create / update routes (routes.ts). Only `channels` is read
 * from the body (allow-list); every update is scoped to the caller's business account.
 * `channels`: a subset of website / whatsapp / instagram / facebook; [] / null / all four = every channel.
 */
import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireBusinessAccount } from "../auth";
import { db } from "../db";
import { analyzedPages, trainedUrls, trainingDocuments } from "@shared/schema";
import { parseChannelsInput } from "@shared/knowledgeChannels";
import { businessContextCache } from "../services/businessContextCache";

const router = Router();

/** Validated `channels` from the body, or a 400 already sent (returns undefined). */
export function channelsFromBody(req: Request, res: Response): { channels: string[] | null } | undefined {
  if (!req.body || typeof req.body !== "object" || !("channels" in req.body)) {
    res.status(400).json({ error: "channels is required" });
    return undefined;
  }
  const parsed = parseChannelsInput(req.body.channels);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return undefined;
  }
  return { channels: parsed.channels };
}

/** Everything cached from training content for this account (all channels' prompt contexts). */
export function invalidateKnowledgeCaches(businessAccountId: string): void {
  businessContextCache.invalidateBusinessCache(businessAccountId);
}

function accountOf(req: Request, res: Response): string | null {
  const businessAccountId = req.user?.businessAccountId;
  if (!businessAccountId) {
    res.status(400).json({ error: "Business account not found" });
    return null;
  }
  return businessAccountId;
}

router.patch("/api/training-documents/:id", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req, res);
    if (!businessAccountId) return;
    const body = channelsFromBody(req, res);
    if (!body) return;
    const [row] = await db.update(trainingDocuments)
      .set({ channels: body.channels, updatedAt: new Date() })
      .where(and(eq(trainingDocuments.id, req.params.id), eq(trainingDocuments.businessAccountId, businessAccountId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Training document not found" });
    invalidateKnowledgeCaches(businessAccountId);
    res.json(row);
  } catch (error: any) {
    console.error("[KnowledgeChannels] document update failed:", error?.message);
    res.status(500).json({ error: "Failed to update document channels" });
  }
});

router.patch("/api/trained-urls/:id", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req, res);
    if (!businessAccountId) return;
    const body = channelsFromBody(req, res);
    if (!body) return;
    const [row] = await db.update(trainedUrls)
      .set({ channels: body.channels, updatedAt: new Date() })
      .where(and(eq(trainedUrls.id, req.params.id), eq(trainedUrls.businessAccountId, businessAccountId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Trained URL not found" });
    invalidateKnowledgeCaches(businessAccountId);
    res.json({ success: true, data: row });
  } catch (error: any) {
    console.error("[KnowledgeChannels] trained URL update failed:", error?.message);
    res.status(500).json({ error: "Failed to update URL channels" });
  }
});

router.patch("/api/analyzed-pages/:id", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const businessAccountId = accountOf(req, res);
    if (!businessAccountId) return;
    const body = channelsFromBody(req, res);
    if (!body) return;
    const [row] = await db.update(analyzedPages)
      .set({ channels: body.channels })
      .where(and(eq(analyzedPages.id, req.params.id), eq(analyzedPages.businessAccountId, businessAccountId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Analyzed page not found" });
    invalidateKnowledgeCaches(businessAccountId);
    res.json(row);
  } catch (error: any) {
    console.error("[KnowledgeChannels] analyzed page update failed:", error?.message);
    res.status(500).json({ error: "Failed to update page channels" });
  }
});

export default router;
