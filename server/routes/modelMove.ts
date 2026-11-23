import { Router } from "express";
import { isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../auth";
import { db } from "../db";
import { businessAccounts } from "@shared/schema";
import { AI_JOBS, type ModelMoveSettings } from "@shared/aiModelMove";
import { LUNA, TERRA, moveStats } from "../lib/modelMove";
import { loadModelMove, saveModelMove } from "../services/modelMoveSettings";
import { recordAuditEventSafely } from "../services/auditService";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";

/** Super admin: the move to the new OpenAI models (AI providers › New OpenAI models). */
const router = Router();
const superAdmin = [requireAuth, requireRole("super_admin")];

router.get("/api/super-admin/model-move", ...superAdmin, async (_req, res) => {
  try {
    res.json({ settings: await loadModelMove(), stats: moveStats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const summary = (s: ModelMoveSettings) => Object.fromEntries(AI_JOBS.map((j) => [j, s[j].mode === "accounts" ? `accounts:${s[j].accounts.length}` : s[j].mode]));

router.put("/api/super-admin/model-move", ...superAdmin, async (req, res) => {
  try {
    const before = await loadModelMove();
    const settings = await saveModelMove({ ...before, ...(req.body?.settings || {}) });
    await recordAuditEventSafely(req, {
      action: "ai.model_move_changed",
      outcome: "success",
      resourceType: "ai_model_move",
      metadata: { from: summary(before), to: summary(settings) },
    });
    res.json({ settings, stats: moveStats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** The models a key may use, from OpenAI's free model list (null: the key was refused or OpenAI didn't answer). */
async function modelsOf(apiKey: string): Promise<Set<string> | null> {
  try {
    const r = await fetchWithTimeout("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } }, 15_000);
    if (!r.ok) return null;
    const data: any = await r.json();
    return new Set((data?.data || []).map((m: any) => String(m?.id)));
  } catch {
    return null;
  }
}

// Which accounts' keys can use the new models. Nothing is billed, and no key leaves the server.
router.post("/api/super-admin/model-move/key-check", ...superAdmin, async (_req, res) => {
  try {
    const accounts = await db.select({ id: businessAccounts.id, name: businessAccounts.name, key: businessAccounts.openaiApiKey })
      .from(businessAccounts).where(isNull(businessAccounts.archivedAt));
    const byKey = new Map<string, { id: string; name: string }[]>();
    for (const a of accounts) {
      const key = a.key?.trim();
      if (key) byKey.set(key, [...(byKey.get(key) || []), { id: a.id, name: a.name }]);
    }
    if (process.env.OPENAI_API_KEY) byKey.set(process.env.OPENAI_API_KEY, [...(byKey.get(process.env.OPENAI_API_KEY) || []), { id: "", name: "Server key" }]);
    const missing: { name: string; models: string[] }[] = [];
    const refused: string[] = [];
    let ready = 0;
    const entries = Array.from(byKey.entries());
    for (let i = 0; i < entries.length; i += 5) {
      await Promise.all(entries.slice(i, i + 5).map(async ([key, owners]) => {
        const models = await modelsOf(key);
        if (!models) { refused.push(...owners.map((o) => o.name)); return; }
        const lacks = [LUNA, TERRA, "gpt-transcribe"].filter((m) => !models.has(m));
        if (lacks.length) missing.push(...owners.map((o) => ({ name: o.name, models: lacks })));
        else ready += owners.filter((o) => o.id).length;
      }));
    }
    res.json({ ready, missing, refused, withoutKey: accounts.filter((a) => !a.key?.trim()).length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
