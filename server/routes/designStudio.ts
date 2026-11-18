import { Router, type Request, type Response } from "express";
import multer from "multer";
import { requireAuth, requireBusinessAccount } from "../auth";
import { MOTIF_LIBRARY, toPublicConfig } from "@shared/designStudio";
import {
  DesignStudioError, castVote, designFunnel, getDesignStudioSettings, getSession, getSharedDesigns, imageAiStatus, isDesignStudioOn,
  listRequests, prepareUploadedPhoto, requestDesign, saveContact, saveDesignStudioSettings, shareSession, similarProducts, startChange,
  startDesigns, startSession, storeStudioImage, suggestMotifs, toPublicSession, tryOnDesign, updateRequest,
} from "../services/designStudio";
import { hideContactsForView, hidesContactsFromView, inBusinessUserView } from "../lib/contactViewMask";

/**
 * Design Studio (shared/designStudio.ts).
 *  - /api/design-studio/public/…: the website chat. No login: an account id, and for a session its
 *    id plus the visitor's token. Every call checks the account has the Design Studio switched on.
 *  - /api/design-studio/public/share/:token: the "Share with family" page. The link's secret is
 *    the only key; it shows the designs and takes one vote per person.
 *  - /api/design-studio/…: the brand's portal (its design kit, its requests and numbers).
 */
const router = Router();

const fail = (res: Response, error: unknown, where: string) => {
  if (error instanceof DesignStudioError) return res.status(error.status).json({ error: error.message, code: error.code });
  console.error(`[Design Studio] ${where} failed:`, error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
};

// ---------------------------------------------------------------------------
// Website chat
// ---------------------------------------------------------------------------

const accountOf = async (req: Request): Promise<string> => {
  const id = (req.body?.businessAccountId ?? req.query.businessAccountId) as unknown;
  if (typeof id !== "string" || !id) throw new DesignStudioError("no_account", "businessAccountId is required");
  if (!(await isDesignStudioOn(id))) throw new DesignStudioError("off", "Designing isn't available here.", 404);
  return id;
};

const sessionOf = async (req: Request) => {
  const businessAccountId = await accountOf(req);
  const row = await getSession(req.params.id, businessAccountId, typeof req.body?.visitorToken === "string" ? req.body.visitorToken : null);
  return { businessAccountId, row };
};

const sendSession = async (res: Response, row: Awaited<ReturnType<typeof getSession>>) =>
  res.json({ session: toPublicSession(row, await getDesignStudioSettings(row.businessAccountId)) });

router.get("/api/design-studio/public/config", async (req, res) => {
  try {
    const id = req.query.businessAccountId;
    if (typeof id !== "string" || !id) return res.status(400).json({ error: "businessAccountId is required" });
    const enabled = await isDesignStudioOn(id);
    if (!enabled) return res.json({ enabled: false });
    res.json(toPublicConfig(await getDesignStudioSettings(id), true));
  } catch (error) {
    fail(res, error, "config");
  }
});

router.post("/api/design-studio/public/sessions", async (req, res) => {
  try {
    const businessAccountId = await accountOf(req);
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const row = await startSession({
      businessAccountId, conversationId: str(req.body?.conversationId), visitorToken: str(req.body?.visitorToken), pageUrl: str(req.body?.pageUrl),
      productId: str(req.body?.productId),
    });
    await sendSession(res, row);
  } catch (error) {
    fail(res, error, "start");
  }
});

router.post("/api/design-studio/public/sessions/:id/state", async (req, res) => {
  try {
    await sendSession(res, (await sessionOf(req)).row);
  } catch (error) {
    fail(res, error, "state");
  }
});

router.post("/api/design-studio/public/sessions/:id/motifs", async (req, res) => {
  try {
    const { businessAccountId } = await sessionOf(req);
    res.json(await suggestMotifs(businessAccountId, req.body?.choices));
  } catch (error) {
    fail(res, error, "motif advice");
  }
});

router.post("/api/design-studio/public/sessions/:id/designs", async (req, res) => {
  try {
    await sendSession(res, await startDesigns((await sessionOf(req)).row, req.body?.choices));
  } catch (error) {
    fail(res, error, "designs");
  }
});

router.post("/api/design-studio/public/sessions/:id/change", async (req, res) => {
  try {
    await sendSession(res, await startChange((await sessionOf(req)).row, String(req.body?.designId || ""), req.body?.change));
  } catch (error) {
    fail(res, error, "change");
  }
});

router.post("/api/design-studio/public/sessions/:id/contact", async (req, res) => {
  try {
    await sendSession(res, await saveContact((await sessionOf(req)).row, req.body || {}));
  } catch (error) {
    fail(res, error, "contact");
  }
});

router.post("/api/design-studio/public/sessions/:id/request", async (req, res) => {
  try {
    await sendSession(res, await requestDesign((await sessionOf(req)).row, req.body || {}));
  } catch (error) {
    fail(res, error, "request");
  }
});

router.post("/api/design-studio/public/sessions/:id/similar", async (req, res) => {
  try {
    res.json({ products: await similarProducts((await sessionOf(req)).row) });
  } catch (error) {
    fail(res, error, "ready pieces");
  }
});

const imagesOnly = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG and WebP photos can be used."));
  },
});
const onePhoto = (field: string) => (req: Request, res: Response, next: () => void) =>
  imagesOnly.single(field)(req, res, err => (err ? res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "That photo is too large (10 MB at most)." : err.message }) : next()));

// The shopper's photo comes as a form upload; the picture goes straight back and nothing is kept.
router.post("/api/design-studio/public/sessions/:id/try-on", onePhoto("selfie"), async (req, res) => {
  try {
    const { row } = await sessionOf(req);
    res.json({ image: await tryOnDesign(row, String(req.body?.designId || ""), req.file?.buffer) });
  } catch (error) {
    fail(res, error, "try-on");
  }
});

router.post("/api/design-studio/public/sessions/:id/share", async (req, res) => {
  try {
    await sendSession(res, await shareSession((await sessionOf(req)).row));
  } catch (error) {
    fail(res, error, "share");
  }
});

router.get("/api/design-studio/public/share/:token", async (req, res) => {
  try {
    res.json(await getSharedDesigns(req.params.token, req.get("x-voter-id") || null));
  } catch (error) {
    fail(res, error, "shared designs");
  }
});

router.post("/api/design-studio/public/share/:token/vote", async (req, res) => {
  try {
    res.json(await castVote(req.params.token, req.body || {}));
  } catch (error) {
    fail(res, error, "vote");
  }
});

// ---------------------------------------------------------------------------
// The brand's portal
// ---------------------------------------------------------------------------

const portal = [requireAuth, requireBusinessAccount];

/** The account the signed-in user is working in, when it has the Design Studio. */
const portalAccount = async (req: Request): Promise<string> => {
  const id = req.user?.businessAccountId;
  if (!id) throw new DesignStudioError("no_account", "Open a business account first.", 400);
  if (!(await isDesignStudioOn(id))) throw new DesignStudioError("off", "The Design Studio isn't switched on for this account.", 403);
  return id;
};

router.get("/api/design-studio/settings", ...portal, async (req, res) => {
  try {
    const id = await portalAccount(req);
    res.json({ settings: await getDesignStudioSettings(id), imageAi: await imageAiStatus(id), library: MOTIF_LIBRARY });
  } catch (error) {
    fail(res, error, "settings");
  }
});

router.put("/api/design-studio/settings", ...portal, async (req, res) => {
  try {
    const id = await portalAccount(req);
    res.json({ settings: await saveDesignStudioSettings(id, req.body?.settings), imageAi: await imageAiStatus(id), library: MOTIF_LIBRARY });
  } catch (error) {
    fail(res, error, "save settings");
  }
});

router.post("/api/design-studio/upload", ...portal, onePhoto("photo"), async (req, res) => {
  try {
    const id = await portalAccount(req);
    if (!req.file) return res.status(400).json({ error: "Choose a photo." });
    res.json({ url: await storeStudioImage(id, await prepareUploadedPhoto(req.file.buffer)) });
  } catch (error) {
    fail(res, error, "photo upload");
  }
});

const dateRange = (req: Request): [Date, Date] => {
  const parse = (v: unknown, fallback: Date) => {
    const d = typeof v === "string" && v ? new Date(v) : fallback;
    return Number.isNaN(d.getTime()) ? fallback : d;
  };
  const to = parse(req.query.to, new Date());
  return [parse(req.query.from, new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)), to];
};

router.get("/api/design-studio/requests", ...portal, async (req, res) => {
  try {
    const id = await portalAccount(req);
    const [from, to] = dateRange(req);
    const [requests, funnel] = await Promise.all([listRequests(id, from, to), designFunnel(id, from, to)]);
    // "Hide contact details from view": same rule as the Leads page (super admins still see them).
    const superAdmin = req.user?.role === "super_admin" && !inBusinessUserView(req);
    const hide = !superAdmin && await hidesContactsFromView(id);
    res.json({ requests: hide ? hideContactsForView(requests) : requests, funnel });
  } catch (error) {
    fail(res, error, "requests");
  }
});

router.patch("/api/design-studio/requests/:id", ...portal, async (req, res) => {
  try {
    await updateRequest(await portalAccount(req), req.params.id, { status: req.body?.status, staffNotes: req.body?.staffNotes });
    res.json({ success: true });
  } catch (error) {
    fail(res, error, "update request");
  }
});

export default router;
