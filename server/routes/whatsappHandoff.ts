// Website → WhatsApp hand-off: the public link endpoint used by the chat widget / launcher, the
// click & conversion numbers, and the connected-number info for Widget Settings.
import { Router, type Request, type Response } from "express";
import { requireAuth, requireBusinessAccount } from "../auth";
import { resolveAuthorizedLeadAccountId } from "../lib/leadAccess";
import { storage } from "../storage";
import {
  createHandoff,
  getConnectedWhatsappNumber,
  getHandoffStats,
  isHandoffSource,
} from "../services/whatsappHandoffService";

const router = Router();

// In-memory limits (per server), like the other public widget endpoints: a visitor clicking around
// is a handful of calls; this only stops scripted floods from filling the table.
const WINDOW_MS = 60_000;
const PER_IP = 30;
const PER_VISITOR = 12;
const hits = new Map<string, { count: number; resetAt: number }>();
function allow(key: string, limit: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}
setInterval(() => {
  const now = Date.now();
  hits.forEach((v, k) => { if (now > v.resetAt) hits.delete(k); });
}, 5 * 60_000).unref?.();

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * POST /api/chat/widget/whatsapp-handoff (public, CORS like the other widget endpoints)
 * { businessAccountId, source: 'header'|'launcher'|'product'|'menu', conversationId?, visitorToken?|sessionId?,
 *   productId?, productName?, message? } → { url, code }
 * The widget opens `url`; on any error it falls back to its plain wa.me link.
 */
router.post("/api/chat/widget/whatsapp-handoff", async (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    const businessAccountId = str(body.businessAccountId, 100);
    const source = body.source;
    if (!businessAccountId || !isHandoffSource(source)) {
      return res.status(400).json({ error: "businessAccountId and a valid source are required" });
    }
    const visitorToken = str(body.visitorToken, 200) || str(body.sessionId, 200);
    const ip = (req.ip || req.socket?.remoteAddress || "unknown").toString();
    if (!allow(`ip:${ip}`, PER_IP) || (visitorToken && !allow(`v:${businessAccountId}:${visitorToken}`, PER_VISITOR))) {
      return res.status(429).json({ error: "Too many requests" });
    }
    const result = await createHandoff({
      businessAccountId,
      source,
      conversationId: str(body.conversationId, 100),
      visitorToken,
      productId: str(body.productId, 100),
      productName: str(body.productName, 200),
      message: str(body.message, 500),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ url: result.url, code: result.code });
  } catch (error: any) {
    console.error("[WhatsApp Handoff] create failed:", error?.message || error);
    res.status(500).json({ error: "Failed to create WhatsApp link" });
  }
});

async function accountFor(req: Request, res: Response): Promise<string | null> {
  const accountId = req.user ? await resolveAuthorizedLeadAccountId(req.user) : null;
  if (!accountId) {
    res.status(403).json({ error: "Business account access is no longer authorized" });
    return null;
  }
  return accountId;
}

/** GET /api/analytics/whatsapp-handoff?days=30 → { days, clicks, continued, leads, bySource } */
router.get("/api/analytics/whatsapp-handoff", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const accountId = await accountFor(req, res);
    if (!accountId) return;
    const days = Math.max(1, Math.min(365, parseInt(String(req.query.days ?? "30"), 10) || 30));
    res.json(await getHandoffStats(accountId, days));
  } catch (error: any) {
    console.error("[WhatsApp Handoff] stats failed:", error?.message || error);
    res.status(500).json({ error: "Failed to load WhatsApp hand-off stats" });
  }
});

/** GET /api/widget-settings/whatsapp-connection → { connectedNumber } (digits or null) for Widget Settings. */
router.get("/api/widget-settings/whatsapp-connection", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const accountId = await accountFor(req, res);
    if (!accountId) return;
    const account = await storage.getBusinessAccount(accountId);
    res.json({ connectedNumber: account ? await getConnectedWhatsappNumber(accountId) : null });
  } catch (error: any) {
    console.error("[WhatsApp Handoff] connection info failed:", error?.message || error);
    res.status(500).json({ error: "Failed to load WhatsApp connection" });
  }
});

export default router;
