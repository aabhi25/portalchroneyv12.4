/**
 * The saved switches for the move to the new OpenAI models (Super Admin › AI providers): one row
 * in system_settings, loaded at start-up and looked at again every 30 s, so a change reaches every
 * server process without a restart. Nothing saved = the built-in default.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { systemSettings } from "@shared/schema";
import { readModelMove, type ModelMoveSettings } from "@shared/aiModelMove";
import { setModelMoveSettings } from "../lib/modelMove";

const KEY = "ai_model_move";
const REFRESH_MS = 30_000;

/** Read past systemSettingsService's 5-minute cache: a switch back must not wait that long. */
export async function loadModelMove(): Promise<ModelMoveSettings> {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, KEY)).limit(1);
  let saved: unknown = null;
  try { saved = row ? JSON.parse(row.value) : null; } catch { /* unreadable = default */ }
  const settings = readModelMove(saved);
  setModelMoveSettings(settings);
  return settings;
}

export async function saveModelMove(next: unknown): Promise<ModelMoveSettings> {
  const settings = readModelMove(next);
  const value = JSON.stringify(settings);
  await db.insert(systemSettings)
    .values({ key: KEY, value, isEncrypted: "false", description: "Which jobs use the new OpenAI models" })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, isEncrypted: "false", updatedAt: new Date() } });
  setModelMoveSettings(settings);
  return settings;
}

export async function startModelMoveSettings(): Promise<void> {
  // A failed read keeps the switches as they were.
  const refresh = () => loadModelMove().then(() => {}).catch((err) => console.warn("[ModelMove] settings not read:", err?.message || err));
  await refresh();
  setInterval(refresh, REFRESH_MS).unref();
}
