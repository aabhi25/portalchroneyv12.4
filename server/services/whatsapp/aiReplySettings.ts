/**
 * How the WhatsApp AI reply reads its settings (Phase 2 "one AI brain, per-channel control").
 * Pure functions — shared by the auto-reply service, the settings DTO and the settings route.
 */

export const WA_PERSONALITIES = ["friendly", "professional", "funny", "polite", "casual"] as const;
export const WA_RESPONSE_LENGTHS = ["concise", "balanced", "detailed"] as const;
export const USE_CASE_MODES = ["lead_capture", "direct_sales", "customer_support"] as const;
export type UseCaseMode = (typeof USE_CASE_MODES)[number];

interface UseCaseFields { useCaseMode?: string | null; useCaseModeExplicit?: string | null }
interface InstructionFields { useMasterTraining?: string | null; instructionsMode?: string | null }

/**
 * The use case mode the AI actually uses. 'lead_capture' frames the person on WhatsApp as a
 * colleague submitting someone else's lead, which is wrong for a real customer — so it is used
 * only when the business chose it on purpose (useCaseModeExplicit = 'true': saved from the UI, or
 * the 0010 migration found flows / flow-only lead mode / a staff-style persona). Anything else
 * that still says 'lead_capture' (the old column default) is treated as 'direct_sales'.
 */
export function effectiveUseCaseMode(settings: UseCaseFields | null | undefined): UseCaseMode {
  const raw = String(settings?.useCaseMode || "").toLowerCase();
  if (raw === "direct_sales" || raw === "customer_support") return raw;
  if (raw === "lead_capture" && settings?.useCaseModeExplicit === "true") return "lead_capture";
  return "direct_sales";
}

/** Train Chroney (website) custom instructions apply on WhatsApp. */
export function websiteInstructionsApply(settings: InstructionFields | null | undefined): boolean {
  return settings?.useMasterTraining !== "false" && settings?.instructionsMode !== "replace";
}

export function instructionsModeOf(settings: InstructionFields | null | undefined): "add" | "replace" {
  return websiteInstructionsApply(settings) ? "add" : "replace";
}

/** WhatsApp personality / response length, NULL inheriting the website widget's. */
export function resolveAnswerStyle(
  wa: { personality?: string | null; responseLength?: string | null } | null | undefined,
  widget: { personality?: string | null; responseLength?: string | null } | null | undefined,
): { personality: string; responseLength: string; personalityFromWhatsapp: boolean; responseLengthFromWhatsapp: boolean } {
  const waPersonality = wa?.personality && (WA_PERSONALITIES as readonly string[]).includes(wa.personality) ? wa.personality : null;
  const waLength = wa?.responseLength && (WA_RESPONSE_LENGTHS as readonly string[]).includes(wa.responseLength) ? wa.responseLength : null;
  return {
    personality: waPersonality || widget?.personality || "friendly",
    responseLength: waLength || widget?.responseLength || "balanced",
    personalityFromWhatsapp: !!waPersonality,
    responseLengthFromWhatsapp: !!waLength,
  };
}

/**
 * Settings PUT body → columns for the new Phase 2 fields. Only keys present in `body` are
 * returned. useMasterTraining and instructionsMode are kept in sync (they are the same switch).
 */
export function phase2SettingsUpdate(body: Record<string, any>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (body.personality !== undefined) {
    out.personality = typeof body.personality === "string" && (WA_PERSONALITIES as readonly string[]).includes(body.personality) ? body.personality : null;
  }
  if (body.responseLength !== undefined) {
    out.responseLength = typeof body.responseLength === "string" && (WA_RESPONSE_LENGTHS as readonly string[]).includes(body.responseLength) ? body.responseLength : null;
  }
  if (body.instructionsMode !== undefined) {
    out.instructionsMode = body.instructionsMode === "replace" ? "replace" : "add";
    out.useMasterTraining = out.instructionsMode === "replace" ? "false" : "true";
  } else if (body.useMasterTraining !== undefined) {
    out.useMasterTraining = body.useMasterTraining === false ? "false" : "true";
    out.instructionsMode = out.useMasterTraining === "false" ? "replace" : "add";
  }
  if (body.useCaseMode !== undefined) {
    out.useCaseMode = (USE_CASE_MODES as readonly string[]).includes(body.useCaseMode) ? body.useCaseMode : "lead_capture";
    // Saved from the UI = chosen on purpose (also for 'lead_capture').
    out.useCaseModeExplicit = "true";
  }
  return out;
}
