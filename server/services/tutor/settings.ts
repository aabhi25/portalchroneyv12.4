/**
 * AI Tutor — per-account settings (super admins edit; the widget reads only "enabled").
 *
 * The tutor is OFF unless a super admin switches it on. Only children's education accounts
 * (K12 / TopScholar) can use it: it teaches from the chapter content those accounts sync.
 * Video is not configured here — the tutor uses the live avatar when the account's avatar
 * settings allow it (consent, monthly cap, concurrency), and voice + board otherwise.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { businessAccounts, tutorBusinessSettings, type TutorBusinessSettings } from "@shared/schema";
import { isChildrensAccount } from "../avatar/settingsService";

export const TUTOR_LIMITS = {
  dailyMinutesPerStudent: { min: 5, max: 240, default: 20 },
} as const;

export type EffectiveTutorSettings = Omit<TutorBusinessSettings, "createdAt" | "updatedAt"> & { exists: boolean; updatedAt: Date | null };

export function defaultTutorSettings(businessAccountId: string): EffectiveTutorSettings {
  return {
    exists: false,
    businessAccountId,
    enabled: false,
    dailyMinutesPerStudent: TUTOR_LIMITS.dailyMinutesPerStudent.default,
    updatedBy: null,
    updatedAt: null,
  };
}

export async function getTutorSettings(businessAccountId: string): Promise<EffectiveTutorSettings> {
  const [row] = await db.select().from(tutorBusinessSettings).where(eq(tutorBusinessSettings.businessAccountId, businessAccountId)).limit(1);
  if (!row) return defaultTutorSettings(businessAccountId);
  const { createdAt: _c, ...rest } = row;
  return { ...rest, exists: true };
}

/** What the widget may know: whether the tutor is offered on this account. */
export async function getPublicTutorConfig(businessAccountId: string): Promise<{ enabled: boolean }> {
  try {
    const s = await getTutorSettings(businessAccountId);
    return { enabled: s.enabled };
  } catch {
    return { enabled: false };
  }
}

export class TutorSettingsError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  dailyMinutesPerStudent: z.number().int()
    .min(TUTOR_LIMITS.dailyMinutesPerStudent.min, `Minutes per student per day must be at least ${TUTOR_LIMITS.dailyMinutesPerStudent.min}`)
    .max(TUTOR_LIMITS.dailyMinutesPerStudent.max, `Minutes per student per day can be at most ${TUTOR_LIMITS.dailyMinutesPerStudent.max}`)
    .optional(),
}).strict();

const AUDITED: Array<keyof z.infer<typeof updateSchema>> = ["enabled", "dailyMinutesPerStudent"];

export async function updateTutorSettings(businessAccountId: string, body: unknown, actorUserId: string): Promise<{
  settings: EffectiveTutorSettings; changed: string[]; before: Record<string, unknown>; after: Record<string, unknown>;
}> {
  const parsed = updateSchema.safeParse(body ?? {});
  if (!parsed.success) throw new TutorSettingsError(parsed.error.issues[0]?.message || "Invalid tutor settings");
  const [account] = await db.select({ id: businessAccounts.id, k12EducationEnabled: businessAccounts.k12EducationEnabled })
    .from(businessAccounts).where(eq(businessAccounts.id, businessAccountId)).limit(1);
  if (!account) throw new TutorSettingsError("Business account not found", 404);
  if (parsed.data.enabled && !isChildrensAccount(account)) {
    throw new TutorSettingsError("The AI tutor teaches from synced curriculum content, so it can only be switched on for K12 / TopScholar accounts.");
  }
  const current = await getTutorSettings(businessAccountId);
  const next = { ...current, ...parsed.data };
  const changed = AUDITED.filter((k) => parsed.data[k] !== undefined && parsed.data[k] !== current[k]);
  const now = new Date();
  const values = { enabled: next.enabled, dailyMinutesPerStudent: next.dailyMinutesPerStudent, updatedBy: actorUserId, updatedAt: now };
  await db.insert(tutorBusinessSettings)
    .values({ businessAccountId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: tutorBusinessSettings.businessAccountId, set: values });
  const pick = (s: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, s[k]]));
  return { settings: await getTutorSettings(businessAccountId), changed, before: pick(current as any), after: pick(next as any) };
}
