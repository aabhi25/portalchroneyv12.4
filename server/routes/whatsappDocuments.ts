// Authenticated access to WhatsApp customer documents (Aadhaar / PAN / bank statements).
// Documents live in a private R2 bucket; the dashboard never sees a storage URL, only
// /api/whatsapp/documents/:attachmentId, which checks the caller's business account owns
// the lead before streaming the file.
import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { businessAccounts } from "@shared/schema";
import { requireAuth } from "../auth";
import { r2Storage } from "../services/r2StorageService";

const router = Router();

// Types safe to render inline on our origin. Anything else is forced to download as
// application/octet-stream so an uploaded HTML/SVG can never run script in the dashboard.
const INLINE_SAFE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function serveWhatsappDocument(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const businessAccountId: string | null = user?.activeBusinessAccountId || user?.businessAccountId || null;
    if (!businessAccountId) {
      return res.status(400).json({ error: "No active business account" });
    }

    // Same feature gate as the /api/whatsapp/leads routes.
    const [acct] = await db
      .select({ whatsappEnabled: businessAccounts.whatsappEnabled })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId));
    if (!acct || acct.whatsappEnabled !== "true") {
      return res.status(403).json({ error: "WhatsApp is not enabled for this business account" });
    }

    const { whatsappService } = await import("../services/whatsappService");
    const attachment = await whatsappService.getAttachmentForAccount(String(req.params.attachmentId), businessAccountId);
    if (!attachment || !attachment.filePath) {
      return res.status(404).json({ error: "Document not found" });
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");

    const ref = r2Storage.parseRef(attachment.filePath);
    if (!ref) {
      // Not one of our buckets (should not happen for WhatsApp uploads) — never proxy arbitrary URLs.
      return res.status(404).json({ error: "Document not available" });
    }

    const stored = await r2Storage.getObjectStream(attachment.filePath);
    if (!stored.success || !stored.body) {
      console.warn(`[WhatsApp Documents] Could not load ${ref.bucket} object ${ref.key}: ${stored.error}`);
      return res.status(stored.error === "File not found" ? 404 : 502).json({ error: "Document not available" });
    }

    const mime = (attachment.mimeType || stored.contentType || "").toLowerCase().split(";")[0].trim();
    const inline = INLINE_SAFE_TYPES.has(mime) && req.query.download !== "1";
    const fileName = attachment.fileName || `document-${attachment.id}`;
    res.setHeader("Content-Type", inline ? mime : "application/octet-stream");
    res.setHeader("Content-Disposition", contentDisposition(inline ? "inline" : "attachment", fileName));
    if (stored.contentLength) res.setHeader("Content-Length", String(stored.contentLength));

    stored.body.on("error", (err: any) => {
      console.warn(`[WhatsApp Documents] Stream error for ${ref.key}:`, err?.message);
      res.destroy(err);
    });
    stored.body.pipe(res);
  } catch (error: any) {
    console.error("[WhatsApp Documents] Error serving document:", error?.message);
    if (!res.headersSent) res.status(500).json({ error: "Failed to load document" });
  }
}

router.get("/api/whatsapp/documents/:attachmentId", requireAuth, serveWhatsappDocument);

export default router;
