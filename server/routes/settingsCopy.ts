import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth";
import { storage } from "../storage";
import { copyHistory, describeSource, previewCopy, runCopy, undoCopy } from "../services/settingsCopyService";
import { COPY_ITEMS, type CopyRequest } from "@shared/settingsCopy";

/** Copy settings on an account group's page: from one account to some or all of the others. Super admins only. */
const router = Router();
const superAdmin = [requireAuth, requireRole("super_admin")];

const copyRequestSchema = z.object({
  sourceAccountId: z.string().min(1),
  targetIds: z.array(z.string().min(1)).min(1, "Choose at least one account to copy to"),
  items: z.array(z.string().refine((key) => COPY_ITEMS.some((item) => item.key === key))).min(1, "Choose at least one thing to copy"),
  instructionsMode: z.enum(["add", "replace"]).default("add"),
  journeyIds: z.array(z.string()).default([]),
}).refine((value) => !value.items.includes("journeys") || value.journeyIds.length > 0, { message: "Choose at least one journey to copy" });

/** The request, once the source and every target are known to be other members of this group. */
async function parseRequest(req: Request, res: Response): Promise<CopyRequest | null> {
  const parsed = copyRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Check what you chose" });
    return null;
  }
  const members = new Set((await storage.getGroupMembers(req.params.groupId)).map((m) => m.businessAccountId));
  const { sourceAccountId, targetIds } = parsed.data;
  if (!members.has(sourceAccountId) || targetIds.some((id) => !members.has(id) || id === sourceAccountId)) {
    res.status(400).json({ error: "Accounts must be in this group, and an account can't copy to itself" });
    return null;
  }
  return parsed.data;
}

router.get("/api/super-admin/account-groups/:groupId/copy-settings", ...superAdmin, async (req, res) => {
  try {
    const members = await storage.getGroupMembers(req.params.groupId);
    res.json({
      members: members
        .map((m) => ({ businessAccountId: m.businessAccountId, name: m.businessAccount?.name || m.businessAccountId }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      history: await copyHistory(req.params.groupId),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/super-admin/account-groups/:groupId/copy-settings/source/:accountId", ...superAdmin, async (req, res) => {
  try {
    const members = await storage.getGroupMembers(req.params.groupId);
    if (!members.some((m) => m.businessAccountId === req.params.accountId)) {
      return res.status(404).json({ error: "This account is not in the group" });
    }
    res.json(await describeSource(req.params.accountId));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/super-admin/account-groups/:groupId/copy-settings/preview", ...superAdmin, async (req, res) => {
  try {
    const request = await parseRequest(req, res);
    if (request) res.json({ targets: await previewCopy(req.params.groupId, request) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/super-admin/account-groups/:groupId/copy-settings", ...superAdmin, async (req, res) => {
  try {
    const request = await parseRequest(req, res);
    if (request) res.json(await runCopy(req.params.groupId, request, { id: req.user?.id, name: req.user?.username }));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/super-admin/account-groups/:groupId/copy-settings/:copyId/undo", ...superAdmin, async (req, res) => {
  try {
    res.json(await undoCopy(req.params.groupId, req.params.copyId, req.user?.username));
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

export default router;
