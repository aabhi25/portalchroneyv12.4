// Shared WhatsApp number: the owner account's "Shared number" card (WhatsApp → Settings →
// Connection). Set up by super admins only, like the other connections.
import { Router, type Request, type Response } from "express";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { businessAccounts, whatsappSettings } from "@shared/schema";
import { requireAuth } from "../auth";
import { recordAuditEventSafely } from "../services/auditService";
import {
  landingPageLink,
  linkAccount,
  linkCandidates,
  sharedOwnerOf,
  sharesOfOwner,
  ShareError,
  unlinkAccount,
  unlinkAll,
} from "../services/whatsapp/sharedNumber";

const router = Router();

/** The account being viewed, for a super admin; null (and a reply) otherwise. */
function ownerAccount(req: Request, res: Response): string | null {
  if (req.user?.role !== "super_admin") {
    res.status(403).json({ error: "The shared number is set up by your account manager." });
    return null;
  }
  const id = req.user.activeBusinessAccountId || req.user.businessAccountId;
  if (!id) {
    res.status(400).json({ error: "Open an account first" });
    return null;
  }
  return id;
}

router.get("/api/whatsapp/shared-number", requireAuth, async (req, res) => {
  try {
    const ownerId = ownerAccount(req, res);
    if (!ownerId) return;
    const usesOwnerId = await sharedOwnerOf(ownerId);
    const [settings] = await db.select().from(whatsappSettings).where(inArray(whatsappSettings.businessAccountId, [ownerId])).limit(1);
    const shares = await sharesOfOwner(ownerId);
    const names = shares.length
      ? await db.select({ id: businessAccounts.id, name: businessAccounts.name }).from(businessAccounts).where(inArray(businessAccounts.id, shares.map((s) => s.linkedAccountId)))
      : [];
    res.json({
      // This account itself uses another account's number: it can't share one.
      usesSharedNumber: !!usesOwnerId,
      ready: !!(settings?.msg91AuthKey && settings.msg91IntegratedNumberId && settings.whatsappNumber),
      number: settings?.whatsappNumber || null,
      linked: shares.map((s) => ({
        businessAccountId: s.linkedAccountId,
        name: names.find((n) => n.id === s.linkedAccountId)?.name ?? s.linkedAccountId,
        tag: s.tag,
        landingPageLink: landingPageLink(settings?.whatsappNumber, s.tag),
        createdAt: s.createdAt,
      })),
      candidates: usesOwnerId ? [] : await linkCandidates(ownerId),
    });
  } catch (error: any) {
    console.error("[Shared WhatsApp number] load failed:", error?.message);
    res.status(500).json({ error: "Failed to load the shared number" });
  }
});

router.post("/api/whatsapp/shared-number/links", requireAuth, async (req, res) => {
  try {
    const ownerId = ownerAccount(req, res);
    if (!ownerId) return;
    const accountId = typeof req.body?.accountId === "string" ? req.body.accountId : "";
    if (!accountId) return res.status(400).json({ error: "Choose an account" });
    const share = await linkAccount(ownerId, accountId, req.user?.id);
    await recordAuditEventSafely(req, {
      action: "whatsapp.shared_number.linked",
      outcome: "success",
      resourceType: "business_account",
      resourceId: accountId,
      businessAccountId: ownerId,
      metadata: { linkedAccountId: accountId, tag: share.tag, whatsappTurnedOn: share.whatsappTurnedOn },
    });
    res.json({ ok: true, tag: share.tag, whatsappTurnedOn: share.whatsappTurnedOn });
  } catch (error: any) {
    if (error instanceof ShareError) return res.status(error.status).json({ error: error.message });
    console.error("[Shared WhatsApp number] link failed:", error?.message);
    res.status(500).json({ error: "Failed to link the account" });
  }
});

router.delete("/api/whatsapp/shared-number/links/:accountId", requireAuth, async (req, res) => {
  try {
    const ownerId = ownerAccount(req, res);
    if (!ownerId) return;
    const removed = await unlinkAccount(ownerId, req.params.accountId);
    if (!removed) return res.status(404).json({ error: "That account doesn't use this number" });
    await recordAuditEventSafely(req, {
      action: "whatsapp.shared_number.unlinked",
      outcome: "success",
      resourceType: "business_account",
      resourceId: req.params.accountId,
      businessAccountId: ownerId,
      metadata: { linkedAccountId: req.params.accountId },
    });
    res.json({ ok: true });
  } catch (error: any) {
    console.error("[Shared WhatsApp number] unlink failed:", error?.message);
    res.status(500).json({ error: "Failed to remove the account" });
  }
});

/** Stops sharing: every linked account goes back to its own WhatsApp details. */
router.delete("/api/whatsapp/shared-number", requireAuth, async (req, res) => {
  try {
    const ownerId = ownerAccount(req, res);
    if (!ownerId) return;
    const removed = await unlinkAll(ownerId);
    await recordAuditEventSafely(req, {
      action: "whatsapp.shared_number.stopped",
      outcome: "success",
      resourceType: "business_account",
      resourceId: ownerId,
      businessAccountId: ownerId,
      metadata: { unlinked: removed },
    });
    res.json({ ok: true, unlinked: removed });
  } catch (error: any) {
    console.error("[Shared WhatsApp number] stop failed:", error?.message);
    res.status(500).json({ error: "Failed to stop sharing" });
  }
});

export default router;
