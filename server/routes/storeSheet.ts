// Dealers & Stores sheet API (see server/services/storeSheetService.ts).
// Scoped to the caller's active business account; secrets are never returned except through
// the reveal endpoint, open to anyone with access to the account and audited.
import { Router, type Request, type Response } from "express";
import { requireAuth, requireBusinessAccount } from "../auth";
import * as sheet from "../services/storeSheetService";
import { recordAuditEventSafely } from "../services/auditService";

const router = Router();
router.use("/api/store-sheet", requireAuth, requireBusinessAccount);

function accountOf(req: Request): string | null {
  const user = (req as any).user;
  return user?.activeBusinessAccountId || user?.businessAccountId || null;
}
// Anyone who can open the account can view its store secrets (every view is audited).
const canRevealSecrets = (_req: Request) => true;

function handle(fn: (req: Request, res: Response, businessAccountId: string) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    const businessAccountId = accountOf(req);
    if (!businessAccountId) return res.status(400).json({ error: "No active business account" });
    try {
      const result = await fn(req, res, businessAccountId);
      if (!res.headersSent) res.json(result);
    } catch (err: any) {
      if (err instanceof sheet.SheetError) return res.status(err.status).json({ error: err.message });
      console.error("[Store Sheet] Error:", err?.message || err);
      res.status(500).json({ error: "Something went wrong — please try again" });
    }
  };
}

router.get("/api/store-sheet", handle((req, _res, id) => sheet.getSheetState(id, canRevealSecrets(req))));

router.post("/api/store-sheet/rows", handle((req, _res, id) => sheet.createRow(id, req.body || {})));

router.patch("/api/store-sheet/rows/:rowId", handle((req, _res, id) => sheet.updateRow(id, req.params.rowId, req.body || {})));

router.delete("/api/store-sheet/rows/:rowId", handle(async (req, _res, id) => {
  await sheet.deleteRows(id, [req.params.rowId]);
  return { ok: true };
}));

router.post("/api/store-sheet/rows/bulk-delete", handle(async (req, _res, id) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === "string") : [];
  return { deleted: await sheet.deleteRows(id, ids) };
}));

router.post("/api/store-sheet/rows/:rowId/reveal-secret", handle(async (req, res, id) => {
  if (!canRevealSecrets(req)) {
    res.status(403).json({ error: "You don't have permission to view store secrets" });
    return;
  }
  const secret = await sheet.revealSecret(id, req.params.rowId);
  await recordAuditEventSafely(req, {
    action: "store_sheet.secret_revealed", outcome: "success", businessAccountId: id,
    resourceType: "crm_store_credential", resourceId: req.params.rowId,
  });
  return { secret };
}));

router.put("/api/store-sheet/settings", handle(async (req, _res, id) => {
  const { enabled, stepLevels } = req.body || {};
  await sheet.updateSettings(id, {
    enabled: typeof enabled === "boolean" ? enabled : undefined,
    stepLevels: stepLevels && typeof stepLevels === "object" ? stepLevels : undefined,
  });
  return sheet.getSheetState(id, canRevealSecrets(req));
}));

router.post("/api/store-sheet/import/preview", handle((req, _res, id) =>
  sheet.previewImport(id, req.body?.rows, req.body?.removeMissing === true)));

router.post("/api/store-sheet/import/apply", handle(async (req, _res, id) => {
  const result = await sheet.applyImport(id, req.body?.rows, req.body?.removeMissing === true);
  await recordAuditEventSafely(req, {
    action: "store_sheet.imported", outcome: "success", businessAccountId: id,
    resourceType: "crm_store_credential", metadata: { ...result },
  });
  return result;
}));

router.post("/api/store-sheet/seed-from-journey/preview", handle((_req, _res, id) => sheet.planSeedFromJourney(id)));

router.post("/api/store-sheet/seed-from-journey/apply", handle((_req, _res, id) => sheet.applySeedFromJourney(id)));

export default router;
