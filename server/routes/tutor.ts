/**
 * AI Tutor routes.
 *  - GET/PUT /api/super-admin/tutor/accounts/:businessAccountId — super admins switch the tutor
 *    on/off for an account and set minutes per student per day (audited).
 *  - GET /api/super-admin/tutor/accounts/:businessAccountId/usage — today's minutes per student.
 */
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { businessAccounts, tutorUsageDaily } from "@shared/schema";
import { isChildrensAccount } from "../services/avatar/settingsService";
import { requireAuth, requireRole } from "../auth";
import { recordAuditEventSafely } from "../services/auditService";
import { getTutorSettings, TutorSettingsError, TUTOR_LIMITS, updateTutorSettings } from "../services/tutor/settings";
import { istDay } from "../services/tutor/usage";

const router = Router();

async function isEligible(businessAccountId: string): Promise<boolean> {
  const [account] = await db.select({ id: businessAccounts.id, k12EducationEnabled: businessAccounts.k12EducationEnabled })
    .from(businessAccounts).where(eq(businessAccounts.id, businessAccountId)).limit(1);
  return isChildrensAccount(account ?? null);
}

function adminView(s: Awaited<ReturnType<typeof getTutorSettings>>, eligible: boolean) {
  return {
    eligible,
    enabled: s.enabled,
    dailyMinutesPerStudent: s.dailyMinutesPerStudent,
    limits: TUTOR_LIMITS,
    updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
  };
}

router.get("/api/super-admin/tutor/accounts/:businessAccountId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    res.json(adminView(await getTutorSettings(req.params.businessAccountId), await isEligible(req.params.businessAccountId)));
  } catch (error) {
    console.error("[Tutor] settings load failed:", error);
    res.status(500).json({ error: "Failed to load tutor settings" });
  }
});

router.put("/api/super-admin/tutor/accounts/:businessAccountId", requireAuth, requireRole("super_admin"), async (req, res) => {
  const { businessAccountId } = req.params;
  try {
    const result = await updateTutorSettings(businessAccountId, req.body, req.user!.id);
    if (result.changed.length > 0) {
      await recordAuditEventSafely(req, {
        action: "tutor.settings_updated",
        outcome: "success",
        businessAccountId,
        resourceType: "tutor_settings",
        resourceId: businessAccountId,
        metadata: {
          changedFields: result.changed,
          ...Object.fromEntries(Object.entries(result.after).map(([k, v]) => [`new_${k}`, v])),
          ...Object.fromEntries(Object.entries(result.before).map(([k, v]) => [`previous_${k}`, v])),
        },
      });
    }
    res.json(adminView(result.settings, await isEligible(businessAccountId)));
  } catch (error) {
    if (error instanceof TutorSettingsError) return res.status(error.status).json({ error: error.message });
    console.error("[Tutor] settings save failed:", error);
    res.status(500).json({ error: "Failed to save tutor settings" });
  }
});

router.get("/api/super-admin/tutor/accounts/:businessAccountId/usage", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const day = istDay();
    const rows = await db.select({ studentKey: tutorUsageDaily.studentKey, secondsUsed: tutorUsageDaily.secondsUsed })
      .from(tutorUsageDaily)
      .where(and(eq(tutorUsageDaily.businessAccountId, req.params.businessAccountId), eq(tutorUsageDaily.day, day)))
      .orderBy(desc(tutorUsageDaily.secondsUsed))
      .limit(50);
    res.json({ day, students: rows.length, totalSeconds: rows.reduce((n, r) => n + r.secondsUsed, 0), top: rows });
  } catch (error) {
    console.error("[Tutor] usage load failed:", error);
    res.status(500).json({ error: "Failed to load tutor usage" });
  }
});

export default router;
