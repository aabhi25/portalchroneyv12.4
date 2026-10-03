/**
 * AI reply-language setting (Train Chroney → Language). Business users edit their own account;
 * super admins may pass ?businessAccountId=. See services/language/languagePolicy.ts.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth, requireBusinessAccount } from "../auth";
import { recordAuditEventSafely } from "../services/auditService";
import { REPLY_LANGUAGES } from "@shared/replyLanguages";
import { getLanguageSettings, LanguageSettingsError, saveLanguageSettings } from "../services/language/languagePolicy";
import { businessContextCache } from "../services/businessContextCache";

const router = Router();

function accountOf(req: Request, res: Response): string | null {
  const fromQuery = typeof req.query.businessAccountId === "string" ? req.query.businessAccountId : null;
  const id = req.user?.role === "super_admin" ? (fromQuery || req.user?.businessAccountId || null) : (req.user?.businessAccountId ?? null);
  if (!id) {
    res.status(400).json({ error: "Business account not found" });
    return null;
  }
  return id;
}

router.get("/api/ai-language-settings", requireAuth, requireBusinessAccount, async (req, res) => {
  const businessAccountId = accountOf(req, res);
  if (!businessAccountId) return;
  try {
    res.json({ settings: await getLanguageSettings(businessAccountId), languages: REPLY_LANGUAGES });
  } catch (error) {
    console.error("[Language] Failed to load settings:", (error as Error)?.message);
    res.status(500).json({ error: "Failed to load language settings" });
  }
});

router.put("/api/ai-language-settings", requireAuth, requireBusinessAccount, async (req, res) => {
  const businessAccountId = accountOf(req, res);
  if (!businessAccountId) return;
  try {
    const { before, after } = await saveLanguageSettings(businessAccountId, req.body?.settings ?? req.body, req.user!.id);
    // Cached widget intros/greetings were written for the old setting.
    try { businessContextCache.invalidateIntro(businessAccountId); } catch { /* ignore */ }
    await recordAuditEventSafely(req, {
      action: "ai_language.settings_updated",
      outcome: "success",
      businessAccountId,
      resourceType: "ai_language_settings",
      resourceId: businessAccountId,
      metadata: {
        previousMode: before.mode, newMode: after.mode,
        previousAllowed: before.allowed, newAllowed: after.allowed,
        previousDefault: before.defaultLanguage, newDefault: after.defaultLanguage,
        followMedium: after.followMedium,
      },
    });
    res.json({ settings: after });
  } catch (error) {
    if (error instanceof LanguageSettingsError) return res.status(400).json({ error: error.message });
    console.error("[Language] Failed to save settings:", (error as Error)?.message);
    res.status(500).json({ error: "Failed to save language settings" });
  }
});

export default router;
