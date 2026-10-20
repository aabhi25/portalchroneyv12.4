/**
 * AI Tutor routes.
 *  - GET/PUT /api/super-admin/tutor/accounts/:businessAccountId — super admins switch the tutor
 *    on/off for an account and set minutes per student per day (audited).
 *  - GET /api/super-admin/tutor/accounts/:businessAccountId/usage — today's minutes per student
 *    and the last 7 days of lessons (count, minutes, finished, quick-check score).
 *  - POST /api/topscholar/tutor/prewarm — the widget, when it offers "Teach me this chapter":
 *    prepares that chapter's lesson plan in the background (signed launch token required), so a
 *    first-ever lesson starts without the planning wait.
 */
import { Router } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { businessAccounts, tutorSessions, tutorUsageDaily } from "@shared/schema";
import { getEffectiveSettings as getAvatarSettings, isChildrensAccount, isProviderSelectable, providerLabel } from "../services/avatar/settingsService";
import { keyAvailability } from "../services/avatar/credentials";
import type { AvatarProviderId } from "../services/avatar/types";
import { requireAuth, requireRole } from "../auth";
import { recordAuditEventSafely } from "../services/auditService";
import { getTutorSettings, TutorSettingsError, TUTOR_LIMITS, updateTutorSettings } from "../services/tutor/settings";
import { istDay } from "../services/tutor/usage";
import { getTopscholarConfig, isTopscholarAccount } from "../services/topscholar/config";
import { deriveHandoff } from "../services/topscholar/tokenService";
import { lessonContext } from "../services/tutor/lessonService";
import { getOutline, getSection } from "../services/tutor/lessonPlanner";
import { tutorLanguageFor } from "../services/tutor/voiceTutor";

const router = Router();

async function isEligible(businessAccountId: string): Promise<boolean> {
  const [account] = await db.select({ id: businessAccounts.id, k12EducationEnabled: businessAccounts.k12EducationEnabled })
    .from(businessAccounts).where(eq(businessAccounts.id, businessAccountId)).limit(1);
  return isChildrensAccount(account ?? null);
}

/** The account's Live AI avatar, as far as the tutor's video depends on it. */
async function avatarStatus(businessAccountId: string) {
  try {
    const a = await getAvatarSettings(businessAccountId);
    const providerOk = isProviderSelectable(a.provider);
    const keyOk = providerOk && !!(await keyAvailability(a.provider as AvatarProviderId, a as any));
    const [account] = await db.select({ id: businessAccounts.id, k12EducationEnabled: businessAccounts.k12EducationEnabled })
      .from(businessAccounts).where(eq(businessAccounts.id, businessAccountId)).limit(1);
    const consentOk = !isChildrensAccount(account ?? null) || !!a.parentalConsentConfirmed;
    return {
      enabled: !!a.enabled,
      provider: a.provider,
      providerLabel: providerLabel(a.provider),
      avatarId: a.avatarId ?? null,
      displayName: a.displayName ?? null,
      ready: !!a.enabled && providerOk && keyOk && consentOk && (a.provider === "fake" || !!a.avatarId),
      missing: [!a.enabled && "switched off", !keyOk && "no API key", !consentOk && "parental consent not confirmed"].filter(Boolean) as string[],
    };
  } catch {
    return null;
  }
}

async function adminView(s: Awaited<ReturnType<typeof getTutorSettings>>, eligible: boolean) {
  return {
    eligible,
    enabled: s.enabled,
    dailyMinutesPerStudent: s.dailyMinutesPerStudent,
    teacherName: s.teacherName ?? null,
    voiceByLanguage: s.voiceByLanguage || {},
    avatarMode: s.avatarMode,
    avatarId: s.avatarId ?? null,
    doubtTeachingEnabled: s.doubtTeachingEnabled,
    avatar: await avatarStatus(s.businessAccountId),
    limits: TUTOR_LIMITS,
    updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
  };
}

router.get("/api/super-admin/tutor/accounts/:businessAccountId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    res.json(await adminView(await getTutorSettings(req.params.businessAccountId), await isEligible(req.params.businessAccountId)));
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
    res.json(await adminView(result.settings, await isEligible(businessAccountId)));
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
    const since = new Date(Date.now() - 7 * 24 * 3600_000);
    const [week] = await db.select({
      lessons: sql<number>`count(*)::int`,
      seconds: sql<number>`coalesce(sum(${tutorSessions.secondsActive}), 0)::int`,
      completed: sql<number>`count(*) filter (where ${tutorSessions.endReason} = 'completed')::int`,
      students: sql<number>`count(distinct ${tutorSessions.studentKey})::int`,
      checksCorrect: sql<number>`coalesce(sum(${tutorSessions.checksCorrect}), 0)::int`,
      checksTotal: sql<number>`coalesce(sum(${tutorSessions.checksTotal}), 0)::int`,
    }).from(tutorSessions)
      .where(and(eq(tutorSessions.businessAccountId, req.params.businessAccountId), gte(tutorSessions.startedAt, since)));
    res.json({ day, students: rows.length, totalSeconds: rows.reduce((n, r) => n + r.secondsUsed, 0), top: rows, week });
  } catch (error) {
    console.error("[Tutor] usage load failed:", error);
    res.status(500).json({ error: "Failed to load tutor usage" });
  }
});

// Prepared plans are shared by every student on a chapter; one warm-up per chapter per half hour.
const warmed = new Map<string, number>();
const WARM_TTL_MS = 30 * 60_000;

router.post("/api/topscholar/tutor/prewarm", async (req, res) => {
  const businessAccountId = String(req.body?.businessAccountId || "");
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  res.status(202).json({ ok: true }); // never makes the widget wait; nothing is returned
  try {
    if (!businessAccountId || !token || !isTopscholarAccount(businessAccountId)) return;
    const settings = await getTutorSettings(businessAccountId);
    if (!settings.enabled) return;
    const [account] = await db.select().from(businessAccounts).where(eq(businessAccounts.id, businessAccountId)).limit(1);
    if (!account) return;
    const cfg = getTopscholarConfig(account as any);
    const handoff = deriveHandoff({ tokenSecret: cfg.tokenSecret, uatPlainCpId: cfg.uatPlainCpId }, { token });
    if (!handoff || handoff.source !== "signed" || !handoff.chapter) return;
    const scope = { board: handoff.board, medium: handoff.medium, grade: handoff.grade, subject: handoff.subject, chapter: handoff.chapter };
    const language = tutorLanguageFor({ language: null, voiceLanguage: null, scope });
    const key = `${businessAccountId}|${JSON.stringify(scope)}|${handoff.cpId || ""}|${language}`;
    const now = Date.now();
    if ((warmed.get(key) ?? 0) > now - WARM_TTL_MS) return;
    warmed.set(key, now);
    if (warmed.size > 2000) warmed.delete(warmed.keys().next().value as string);
    const { pack, complete } = await lessonContext(businessAccountId, scope, { cpIds: handoff.cpId ? [handoff.cpId] : undefined });
    const outline = await getOutline(pack, language, complete);
    if (outline.sections.length) await getSection(pack, outline, 0, language, complete);
  } catch (error) {
    console.warn("[Tutor] prewarm skipped:", error instanceof Error ? error.message : error);
  }
});

export default router;
