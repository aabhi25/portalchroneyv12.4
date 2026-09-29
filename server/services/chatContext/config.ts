/**
 * Safety valve for the website-chat context builder.
 *
 *   'retrieval' (default) — compact business profile + hybrid retrieval, capped history,
 *                           cache-friendly prompt order, per-conversation language cache.
 *   'legacy'              — the previous behaviour: every analyzed page and every
 *                           training-document summary in the prompt, raw-message RAG,
 *                           uncapped history, AI language detection per turn.
 *
 * How to switch back to legacy (see docs/chat-context.md):
 *   - Everyone, needs a restart:        CHAT_CONTEXT_MODE=legacy
 *   - Some accounts, needs a restart:   CHAT_CONTEXT_LEGACY_ACCOUNTS=<id>,<id>
 *   - Everyone, no restart (≤30s):      system_settings key `chat_context_mode` = 'legacy'
 *   - Some accounts, no restart (≤30s): system_settings key `chat_context_legacy_accounts` = '<id>,<id>'
 *
 * TopScholar / K12 content-only conversations always use the legacy path (they have
 * their own lean curriculum prompt and are deliberately left untouched).
 */
import { inArray } from 'drizzle-orm';

export type ChatContextMode = 'legacy' | 'retrieval';

const SETTINGS_TTL_MS = 30_000;
let settingsCache: { mode: string | null; accounts: Set<string>; expires: number } | null = null;
let modeOverride: ChatContextMode | null = null;

/** Test / benchmark hook: force a mode for this process (null clears it). */
export function setChatContextModeOverride(mode: ChatContextMode | null): void {
  modeOverride = mode;
}

export function clearChatContextSettingsCache(): void {
  settingsCache = null;
}

function parseIdList(raw: string | null | undefined): Set<string> {
  return new Set(String(raw || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean));
}

async function loadSettings(): Promise<{ mode: string | null; accounts: Set<string> }> {
  const now = Date.now();
  if (settingsCache && settingsCache.expires > now) return settingsCache;
  let mode: string | null = null;
  let accounts = new Set<string>();
  try {
    const { db } = await import('../../db');
    const { systemSettings } = await import('../../../shared/schema');
    const rows = await db.select().from(systemSettings)
      .where(inArray(systemSettings.key, ['chat_context_mode', 'chat_context_legacy_accounts']));
    const read = async (key: string): Promise<string | null> => {
      const row = rows.find(r => r.key === key);
      if (!row) return null;
      if (row.isEncrypted === 'true') {
        try { const { decrypt } = await import('../encryptionService'); return decrypt(row.value); } catch { return null; }
      }
      return row.value;
    };
    mode = (await read('chat_context_mode'))?.trim().toLowerCase() || null;
    accounts = parseIdList(await read('chat_context_legacy_accounts'));
  } catch (err) {
    // Settings unreadable → fall through to the default (env still applies).
    console.warn('[ChatContext] Could not read chat_context settings:', (err as Error)?.message);
  }
  settingsCache = { mode, accounts, expires: now + SETTINGS_TTL_MS };
  return settingsCache;
}

export async function resolveChatContextMode(businessAccountId: string): Promise<ChatContextMode> {
  if (modeOverride) return modeOverride;
  const envMode = (process.env.CHAT_CONTEXT_MODE || '').trim().toLowerCase();
  if (envMode === 'legacy') return 'legacy';
  if (parseIdList(process.env.CHAT_CONTEXT_LEGACY_ACCOUNTS).has(businessAccountId)) return 'legacy';
  const s = await loadSettings();
  if (s.mode === 'legacy') return 'legacy';
  if (s.accounts.has(businessAccountId)) return 'legacy';
  return 'retrieval';
}

