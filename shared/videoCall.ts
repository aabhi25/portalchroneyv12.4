/**
 * "Video call" settings of the Live AI avatar (avatar_business_settings.video_call): how the
 * video call sounds and behaves. Shared by the server (voice pipeline, session gates), the
 * widget and the settings screens. Missing fields fall back to DEFAULT_VIDEO_CALL, which keeps
 * the behaviour from before these settings existed.
 */

export type BackgroundSound = "off" | "office" | "call_centre";
export type BackgroundVolume = "low" | "medium";
export type SpeakingPace = "slow" | "normal" | "fast";
export type HandoffType = "whatsapp" | "call" | "link";

export interface VideoCallHours {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** "09:00" (24 h). */
  start: string;
  end: string;
  /** IANA time zone, e.g. "Asia/Kolkata". */
  timezone: string;
}

export interface VideoCallHandoff {
  enabled: boolean;
  /** Button text, e.g. "Talk to a counsellor". */
  label: string;
  type: HandoffType;
  /** WhatsApp / phone number with country code, or an https link. */
  target: string;
}

export interface VideoCallSettings {
  /** A quiet room sound under the avatar's voice, like a real video call. */
  backgroundSound: BackgroundSound;
  backgroundVolume: BackgroundVolume;
  speakingPace: SpeakingPace;
  /** The avatar's own voice ("shimmer", "el:<id>"); null = the website chat's voice. */
  voiceSelection: string | null;
  /** Said right after the AI introduction when the video starts; null = only the introduction. */
  openingLine: string | null;
  /** Short "hmm, let me check" sounds while the answer is prepared. */
  thinkingSounds: boolean;
  captions: boolean;
  /** The visitor can talk over the avatar (it stops and listens). Off: it finishes first. */
  allowInterruptions: boolean;
  /** "Are you still there?" once before an idle call ends. */
  idleNudge: boolean;
  hours: VideoCallHours;
  /** Switch to voice only when the video freezes on a weak connection. */
  autoVoiceOnly: boolean;
  handoff: VideoCallHandoff;
}

export const DEFAULT_VIDEO_CALL: VideoCallSettings = {
  backgroundSound: "off",
  backgroundVolume: "low",
  speakingPace: "normal",
  voiceSelection: null,
  openingLine: null,
  thinkingSounds: true,
  captions: true,
  allowInterruptions: true,
  idleNudge: true,
  hours: { enabled: false, days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", timezone: "Asia/Kolkata" },
  autoVoiceOnly: true,
  handoff: { enabled: false, label: "Talk to a counsellor", type: "whatsapp", target: "" },
};

/** Speaking pace as the voice pipeline's speed, percent of normal. */
export const PACE_PERCENT: Record<SpeakingPace, number> = { slow: 85, normal: 100, fast: 112 };

/** Background sound level under the voice, as a gain (the sound itself is about −42 dBFS). */
export const BACKGROUND_GAIN: Record<BackgroundVolume, number> = { low: 0.55, medium: 1.0 };

const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "marin", "cedar", "onyx", "nova", "sage", "shimmer", "verse"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Stored value (possibly partial or old) → complete settings. */
export function normalizeVideoCall(raw: unknown): VideoCallSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const d = DEFAULT_VIDEO_CALL;
  const h = (r.hours && typeof r.hours === "object" ? r.hours : {}) as Record<string, any>;
  const ho = (r.handoff && typeof r.handoff === "object" ? r.handoff : {}) as Record<string, any>;
  const voice = typeof r.voiceSelection === "string" && (OPENAI_VOICES.includes(r.voiceSelection) || /^el:[A-Za-z0-9_-]{4,64}$/.test(r.voiceSelection)) ? r.voiceSelection : null;
  return {
    backgroundSound: pick(r.backgroundSound, ["off", "office", "call_centre"] as const, d.backgroundSound),
    backgroundVolume: pick(r.backgroundVolume, ["low", "medium"] as const, d.backgroundVolume),
    speakingPace: pick(r.speakingPace, ["slow", "normal", "fast"] as const, d.speakingPace),
    voiceSelection: voice,
    openingLine: typeof r.openingLine === "string" && r.openingLine.trim() ? r.openingLine.trim().slice(0, 300) : null,
    thinkingSounds: bool(r.thinkingSounds, d.thinkingSounds),
    captions: bool(r.captions, d.captions),
    allowInterruptions: bool(r.allowInterruptions, d.allowInterruptions),
    idleNudge: bool(r.idleNudge, d.idleNudge),
    hours: {
      enabled: bool(h.enabled, d.hours.enabled),
      days: Array.isArray(h.days) ? Array.from(new Set(h.days.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6))).sort() : d.hours.days,
      start: typeof h.start === "string" && TIME.test(h.start) ? h.start : d.hours.start,
      end: typeof h.end === "string" && TIME.test(h.end) ? h.end : d.hours.end,
      timezone: typeof h.timezone === "string" && h.timezone.trim() ? h.timezone.trim().slice(0, 64) : d.hours.timezone,
    },
    autoVoiceOnly: bool(r.autoVoiceOnly, d.autoVoiceOnly),
    handoff: {
      enabled: bool(ho.enabled, d.handoff.enabled),
      label: typeof ho.label === "string" && ho.label.trim() ? ho.label.trim().slice(0, 40) : d.handoff.label,
      type: pick(ho.type, ["whatsapp", "call", "link"] as const, d.handoff.type),
      target: typeof ho.target === "string" ? ho.target.trim().slice(0, 300) : "",
    },
  };
}

/** A problem with settings about to be saved, in plain words, or null. */
export function videoCallProblem(v: VideoCallSettings): string | null {
  if (v.hours.enabled) {
    if (v.hours.days.length === 0) return "Choose at least one day for video hours";
    if (v.hours.start >= v.hours.end) return "Video hours: the end time must be after the start time";
    try { new Intl.DateTimeFormat("en-US", { timeZone: v.hours.timezone }); } catch { return "Video hours: unknown time zone"; }
  }
  if (v.handoff.enabled) {
    if (!v.handoff.target) return "Hand-off: add the number or link";
    if (v.handoff.type === "link" && !/^https:\/\//i.test(v.handoff.target)) return "Hand-off: the link must start with https://";
    if (v.handoff.type !== "link" && v.handoff.target.replace(/\D/g, "").length < 10) return "Hand-off: add the number with its country code";
  }
  return null;
}

/** Whether video calls are open at `now` (always, when video hours are off). */
export function withinVideoHours(v: Pick<VideoCallSettings, "hours">, now = new Date()): boolean {
  if (!v.hours.enabled) return true;
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: v.hours.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map(p => [p.type, p.value]));
  } catch {
    return true;
  }
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const time = `${parts.hour}:${parts.minute}`;
  return v.hours.days.includes(day) && time >= v.hours.start && time < v.hours.end;
}

/** The hand-off button's link for the visitor's browser. */
export function handoffHref(h: VideoCallHandoff): string | null {
  if (!h.enabled || !h.target) return null;
  if (h.type === "link") return /^https:\/\//i.test(h.target) ? h.target : null;
  const digits = h.target.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return h.type === "whatsapp" ? `https://wa.me/${digits}` : `tel:+${digits}`;
}
