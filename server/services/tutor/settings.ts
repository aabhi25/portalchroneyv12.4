/**
 * AI Tutor — per-account settings (super admins edit; the widget reads only "enabled").
 *
 * The tutor is OFF unless a super admin switches it on. Only children's education accounts
 * (K12 / TopScholar) can use it: it teaches from the chapter content those accounts sync.
 * The teacher: a name, a voice per lesson language (English / Hindi / Hinglish — the accent has to
 * fit), and video: "auto" uses the account's Live AI avatar (its provider, key, consent, monthly
 * cap and concurrency) with an optional tutor-specific avatar; "voice" never starts video.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { businessAccounts, tutorBusinessSettings, type TutorBusinessSettings } from "@shared/schema";
import { isChildrensAccount } from "../avatar/settingsService";
import { CALL_VOICE_SELECTION } from "@shared/aiCalling";

/** Lesson languages a voice can be set for (Hinglish falls back to the Hindi voice). */
export const TUTOR_VOICE_LANGUAGES = ["en", "hi", "hinglish"] as const;
export type TutorVoiceLanguage = typeof TUTOR_VOICE_LANGUAGES[number];
export const TUTOR_AVATAR_MODES = ["auto", "voice"] as const;

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
    teacherName: null,
    voiceByLanguage: {},
    avatarMode: "auto",
    avatarId: null,
    doubtTeachingEnabled: false,
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

/**
 * What the widget may know: whether the tutor is offered, whether it may start video, and whether
 * answers in a doubt session offer "Teach me this on the board".
 */
export async function getPublicTutorConfig(businessAccountId: string): Promise<{ enabled: boolean; video: boolean; doubts: boolean }> {
  try {
    const s = await getTutorSettings(businessAccountId);
    return { enabled: s.enabled, video: s.avatarMode !== "voice", doubts: s.enabled && s.doubtTeachingEnabled };
  } catch {
    return { enabled: false, video: false, doubts: false };
  }
}

/** The voice for a lesson language: its own, else Hinglish → Hindi's, else null (the widget's voice). */
export function tutorVoiceFor(settings: Pick<EffectiveTutorSettings, "voiceByLanguage">, language: string): string | null {
  const v = settings.voiceByLanguage || {};
  return v[language] || (language === "hinglish" ? v.hi : undefined) || null;
}

export class TutorSettingsError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const TEACHER_NAME = new RegExp("^[\\p{L}\\p{M} .'-]*$", "u");

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  dailyMinutesPerStudent: z.number().int()
    .min(TUTOR_LIMITS.dailyMinutesPerStudent.min, `Minutes per student per day must be at least ${TUTOR_LIMITS.dailyMinutesPerStudent.min}`)
    .max(TUTOR_LIMITS.dailyMinutesPerStudent.max, `Minutes per student per day can be at most ${TUTOR_LIMITS.dailyMinutesPerStudent.max}`)
    .optional(),
  teacherName: z.union([
    z.string().trim().max(40, "The teacher's name can be at most 40 characters")
      .regex(TEACHER_NAME, "The teacher's name can have letters, spaces, dots, apostrophes and hyphens"),
    z.null(),
  ]).optional(),
  voiceByLanguage: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  avatarMode: z.enum(TUTOR_AVATAR_MODES).optional(),
  avatarId: z.union([z.string().trim().max(200), z.null()]).optional(),
  doubtTeachingEnabled: z.boolean().optional(),
}).strict();

const AUDITED: Array<keyof z.infer<typeof updateSchema>> = ["enabled", "dailyMinutesPerStudent", "teacherName", "voiceByLanguage", "avatarMode", "avatarId", "doubtTeachingEnabled"];

/** Voices: known languages only, each a voice from the list (el:… or an OpenAI voice); empty = default. */
function cleanVoices(raw: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [lang, v] of Object.entries(raw)) {
    if (!(TUTOR_VOICE_LANGUAGES as readonly string[]).includes(lang)) throw new TutorSettingsError(`Unknown lesson language '${lang}'`);
    const voice = (v ?? "").trim();
    if (!voice) continue;
    if (!CALL_VOICE_SELECTION.test(voice)) throw new TutorSettingsError("Choose each voice from the list");
    out[lang] = voice;
  }
  return out;
}

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
  const input: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.teacherName !== undefined) input.teacherName = parsed.data.teacherName?.replace(/\s+/g, " ").trim() || null;
  if (parsed.data.voiceByLanguage !== undefined) input.voiceByLanguage = cleanVoices(parsed.data.voiceByLanguage);
  if (parsed.data.avatarId !== undefined) {
    const id = parsed.data.avatarId?.trim() || null;
    if (id && !/^[A-Za-z0-9_.:-]{1,200}$/.test(id)) throw new TutorSettingsError("Enter an avatar id (letters, digits, _ . : -)");
    input.avatarId = id;
  }
  const current = await getTutorSettings(businessAccountId);
  const next = { ...current, ...input } as EffectiveTutorSettings;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changed = AUDITED.filter((k) => input[k] !== undefined && !same(input[k], (current as any)[k]));
  const now = new Date();
  const values = {
    enabled: next.enabled,
    dailyMinutesPerStudent: next.dailyMinutesPerStudent,
    teacherName: next.teacherName,
    voiceByLanguage: next.voiceByLanguage || {},
    avatarMode: next.avatarMode,
    avatarId: next.avatarId,
    doubtTeachingEnabled: next.doubtTeachingEnabled,
    updatedBy: actorUserId,
    updatedAt: now,
  };
  await db.insert(tutorBusinessSettings)
    .values({ businessAccountId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: tutorBusinessSettings.businessAccountId, set: values });
  const pick = (s: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, s[k]]));
  return { settings: await getTutorSettings(businessAccountId), changed, before: pick(current as any), after: pick(next as any) };
}
