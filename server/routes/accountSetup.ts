import { Router } from "express";
import { requireAuth, requireRole } from "../auth";
import { storage } from "../storage";

/**
 * Super admin › an account's "Features on this account": what each feature still needs (status
 * lines on the rows) and the set-up panels that are not an existing settings screen yet.
 * Step 1: Voice mode (provider, ElevenLabs key, voice).
 */
const router = Router();

export const OPENAI_VOICE_IDS = ["alloy", "ash", "ballad", "coral", "echo", "fable", "marin", "cedar", "onyx", "nova", "sage", "shimmer", "verse"];

export type FeatureState = "ready" | "needs_setup" | "off";
export interface FeatureStatus {
  state: FeatureState;
  /** What is missing, in plain words (needs_setup only). */
  problem?: string;
  [key: string]: unknown;
}

async function voiceStatus(accountId: string): Promise<FeatureStatus> {
  const [account, settings, openAiKey] = await Promise.all([
    storage.getBusinessAccount(accountId),
    storage.getWidgetSettings(accountId),
    storage.getBusinessAccountOpenAIKey(accountId).catch(() => null),
  ]);
  const on = String(account?.voiceModeEnabled) === "true";
  const voiceSelection = settings?.voiceSelection || "shimmer";
  const provider = voiceSelection.startsWith("el:") ? "elevenlabs" : "openai";
  const base = { voiceSelection, provider, hasElevenLabsKey: !!account?.elevenlabsApiKey };
  if (!on) return { state: "off", ...base };
  if (String(account?.chroneyEnabled) !== "true") return { state: "needs_setup", problem: "Website chat is off, so visitors can't use voice", ...base };
  if (!openAiKey) return { state: "needs_setup", problem: "Add the account's OpenAI key (AI & keys); voice answers need it", ...base };
  if (provider === "elevenlabs" && !account?.elevenlabsApiKey) return { state: "needs_setup", problem: "An ElevenLabs voice is chosen but the ElevenLabs key is missing", ...base };
  return { state: "ready", ...base };
}

/** Status line for every feature that has one (more features are added step by step). */
router.get("/api/super-admin/accounts/:id/feature-status", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const account = await storage.getBusinessAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Business account not found" });
    res.json({ voiceMode: await voiceStatus(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/super-admin/accounts/:id/voice-setup", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const account = await storage.getBusinessAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Business account not found" });
    const status = await voiceStatus(req.params.id);
    const key = account.elevenlabsApiKey;
    res.json({
      status,
      voiceSelection: status.voiceSelection,
      hasElevenLabsKey: !!key,
      elevenLabsKeyHint: key ? `…${String(key).slice(-4)}` : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/api/super-admin/accounts/:id/voice-setup", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const id = req.params.id;
    const account = await storage.getBusinessAccount(id);
    if (!account) return res.status(404).json({ error: "Business account not found" });
    const { voiceSelection, elevenlabsApiKey, removeElevenLabsKey } = req.body || {};

    if (typeof elevenlabsApiKey === "string" && elevenlabsApiKey.trim()) {
      await storage.updateBusinessAccountElevenLabsKey(id, elevenlabsApiKey.trim());
    } else if (removeElevenLabsKey === true) {
      await storage.updateBusinessAccountElevenLabsKey(id, null);
    }

    if (voiceSelection !== undefined) {
      const v = String(voiceSelection || "").trim();
      const isOpenAi = OPENAI_VOICE_IDS.includes(v);
      const isEleven = /^el:[A-Za-z0-9_-]{4,64}$/.test(v);
      if (!isOpenAi && !isEleven) return res.status(400).json({ error: "Choose a voice from the list" });
      const hasKey = !!(await storage.getBusinessAccount(id))?.elevenlabsApiKey;
      if (isEleven && !hasKey) return res.status(400).json({ error: "Add the ElevenLabs key before choosing an ElevenLabs voice" });
      await storage.upsertWidgetSettings(id, { voiceSelection: v } as any);
    }

    const status = await voiceStatus(id);
    const fresh = await storage.getBusinessAccount(id);
    res.json({
      status,
      voiceSelection: status.voiceSelection,
      hasElevenLabsKey: !!fresh?.elevenlabsApiKey,
      elevenLabsKeyHint: fresh?.elevenlabsApiKey ? `…${String(fresh.elevenlabsApiKey).slice(-4)}` : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
