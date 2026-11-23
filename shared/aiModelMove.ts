/**
 * Moving off the OpenAI models that are closing (OpenAI's deprecations page, read 2026-11-24).
 * Code keeps naming the model it was written for; server/lib/modelMove.ts sends the call to the
 * new one when its job is switched on (Super Admin › AI providers › New OpenAI models).
 */

export const AI_JOBS = ["small", "precise", "chat", "phone", "tutor", "speak", "hear"] as const;
export type AiJob = (typeof AI_JOBS)[number];

/** old = the closing model, new = the new one, accounts = the new one for the listed accounts only. */
export type MoveMode = "old" | "new" | "accounts";
export interface JobMove { mode: MoveMode; accounts: string[] }
export type ModelMoveSettings = Record<AiJob, JobMove>;

export const AI_JOB_INFO: Record<AiJob, { label: string; what: string; from: string; to: string }> = {
  small: { label: "Background and small jobs", what: "Summaries, categories, language, spam, lead story, insights, training, journey answers", from: "gpt-4o-mini", to: "gpt-6-luna" },
  precise: { label: "Documents, photos and builders", what: "Document checks, scanned pages, photo questions, invoices, journey and gift finder builder", from: "gpt-4o / gpt-4.1", to: "gpt-6.1-terra" },
  chat: { label: "Chat replies", what: "Website, WhatsApp, Instagram and Facebook replies", from: "gpt-4o-mini", to: "gpt-6-luna" },
  phone: { label: "AI phone calls", what: "What the assistant says on a call", from: "gpt-4.1-mini", to: "gpt-5.6-luna" },
  tutor: { label: "AI Tutor", what: "Lesson plans and what the teacher says", from: "gpt-4.1-mini", to: "gpt-6-luna" },
  speak: { label: "Speaking (OpenAI voices)", what: "Website voice, video calls, tutor and phone calls on an OpenAI voice, and the backup for ElevenLabs", from: "gpt-4o-mini-tts", to: "gpt-realtime-2.1-mini" },
  hear: { label: "Hearing on website voice", what: "Turning a visitor's speech into text (phone calls already use the new one)", from: "gpt-4o-mini-transcribe", to: "gpt-transcribe" },
};

/** Closing day (UTC date) of the models named in the code or offered in a list. */
export const MODEL_CLOSES: Record<string, string> = {
  "gpt-3.5-turbo": "2026-10-23", "o1": "2026-10-23", "o3-mini": "2026-10-23", "o4-mini": "2026-10-23",
  "gpt-5": "2026-12-11", "gpt-5-mini": "2026-12-11", "gpt-5-nano": "2026-12-11", "o3": "2026-12-11",
  "gpt-4o-mini-tts": "2027-01-06",
  "gpt-4o": "2027-01-14", "gpt-4o-mini": "2027-01-14", "gpt-4.1": "2027-01-14", "gpt-4.1-mini": "2027-01-14",
  "gpt-4o-transcribe": "2027-02-26", "gpt-4o-mini-transcribe": "2027-02-26",
  "gpt-5.1": "2027-04-01", "gpt-5.4-nano": "2027-04-01",
};

export function modelClosed(model: string, now = Date.now()): boolean {
  const day = MODEL_CLOSES[model];
  return !!day && now >= Date.parse(`${day}T00:00:00Z`);
}

/** Until a switch is saved: every job on its new model (side by side tests 2026-11-24; decided with the owner). */
export function defaultModelMove(): ModelMoveSettings {
  return Object.fromEntries(AI_JOBS.map((j) => [j, { mode: "new", accounts: [] }])) as unknown as ModelMoveSettings;
}

/** Saved settings with anything missing or malformed put back to the default. */
export function readModelMove(value: unknown): ModelMoveSettings {
  const out = defaultModelMove();
  if (!value || typeof value !== "object") return out;
  for (const job of AI_JOBS) {
    const v = (value as Record<string, any>)[job];
    if (!v || !["old", "new", "accounts"].includes(v.mode)) continue;
    const accounts = Array.isArray(v.accounts) ? v.accounts.filter((a: unknown): a is string => typeof a === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(a)) : [];
    out[job] = { mode: v.mode, accounts: Array.from(new Set<string>(accounts)).slice(0, 500) };
  }
  return out;
}
