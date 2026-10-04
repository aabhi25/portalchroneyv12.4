/**
 * Language detection for the widget without an AI call on (almost) every turn — sticky per
 * conversation, like enterprise support bots (see services/language/turnLanguage.ts):
 *   1. a message that clearly is one language (script, real Hinglish, clear English) → sets /
 *      switches the conversation's language, no call;
 *   2. an unclear message ("ok", "5 lakh?", mixed) → the conversation's language, no call;
 *   3. a short first message → the visitor's browser language, else the best guess, no call;
 *   4. a longer unclear message → the AI detector, once; the result is remembered.
 */
import { hasForeignLatinSignal, languageFromBrowser, looksConfidentlyEnglish, turnLanguageEvidence } from '../language/turnLanguage';

const TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 20_000;
const sessions = new Map<string, { lang: string; at: number }>();

// English / foreign-Latin signals live in services/language/turnLanguage.ts (shared by every channel).
export { hasForeignLatinSignal, looksConfidentlyEnglish } from '../language/turnLanguage';

export interface LanguageDecision { language: string; source: 'heuristic' | 'english' | 'session' | 'browser' | 'llm' }

export async function detectLanguageForSession(
  sessionKey: string,
  message: string,
  llmDetect: (message: string) => Promise<string>,
  opts: { browserLanguage?: string | null } = {},
): Promise<LanguageDecision> {
  const now = Date.now();
  const remember = (lang: string) => {
    if (!lang || lang === 'auto' || lang === 'other') return;
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest) sessions.delete(oldest);
    }
    sessions.delete(sessionKey);
    sessions.set(sessionKey, { lang, at: now });
  };

  // 1. A message that clearly is one language sets (or switches) the conversation's language.
  const evidence = turnLanguageEvidence(message);
  if (evidence.confident && evidence.language) { remember(evidence.language); return { language: evidence.language, source: 'heuristic' }; }

  // 2. Unclear ("ok", "5 lakh?", mixed): keep the conversation's language.
  const cached = sessions.get(sessionKey);
  if (cached && now - cached.at < TTL_MS && !hasForeignLatinSignal(message)) {
    return { language: cached.lang, source: 'session' };
  }

  // 3. A short first message: the visitor's browser language, else the best guess (no AI call).
  if (evidence.words <= 4 && !hasForeignLatinSignal(message)) {
    const browser = languageFromBrowser(opts.browserLanguage);
    if (browser) return { language: browser, source: 'browser' };
    return { language: evidence.language ?? 'en', source: 'heuristic' };
  }
  if (looksConfidentlyEnglish(message) && evidence.language !== 'hinglish') { remember('en'); return { language: 'en', source: 'english' }; }

  // 4. A longer unclear message (mixed Hindi + English, other languages): the AI decides, once.
  const detected = await llmDetect(message);
  remember(detected);
  return { language: detected, source: 'llm' };
}

/** Tests only. */
export function clearLanguageSessions(): void {
  sessions.clear();
}

/**
 * Widget entry point: legacy mode (safety valve) and TopScholar keep the old per-turn
 * detection; everyone else goes through the session cache above.
 */
export async function detectWidgetLanguage(
  businessAccountId: string,
  sessionKey: string,
  message: string,
  apiKey?: string,
  browserLanguage?: string | null,
): Promise<string> {
  const { llamaService } = await import('../../llamaService');
  const { resolveChatContextMode } = await import('./config');
  const { isTopscholarAccount } = await import('../topscholar/config');
  const llm = (m: string) => llamaService.detectLanguage(m, apiKey);
  if (isTopscholarAccount(businessAccountId) || (await resolveChatContextMode(businessAccountId)) === 'legacy') {
    return llm(message);
  }
  const decision = await detectLanguageForSession(`${businessAccountId}:${sessionKey}`, message, llm, { browserLanguage });
  if (decision.source !== 'llm') console.log(`[LanguageDetection] "${message.substring(0, 40)}" → ${decision.language} (${decision.source}, no AI call)`);
  return decision.language;
}
