/**
 * Language detection for the widget without an AI call on (almost) every turn.
 *
 * Legacy: `llamaService.detectLanguage` ran the script/Hinglish heuristic and, when it
 * returned "unsure" — which is the case for every English message longer than four
 * words — made an LLM call. Now:
 *   1. script / Hinglish heuristic (unchanged)            → no call
 *   2. clearly English (English function words, no foreign
 *      Latin-script signals)                              → no call
 *   3. earlier result for this conversation, when the
 *      message shows no sign of a different language      → no call
 *   4. otherwise the LLM, once, and the result is cached for the conversation.
 */
import { LlamaService } from '../../llamaService';

const TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 20_000;
const sessions = new Map<string, { lang: string; at: number }>();

const ENGLISH_WORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'what', 'how', 'when', 'where', 'why', 'which', 'who', 'do', 'does', 'did', 'can',
  'could', 'would', 'should', 'will', 'you', 'your', 'my', 'me', 'we', 'our', 'i', 'a', 'an', 'and', 'or', 'of', 'to',
  'in', 'on', 'for', 'with', 'about', 'have', 'has', 'there', 'this', 'that', 'it', 'please', 'any', 'if', 'from', 'at',
  'be', 'get', 'much', 'many', 'tell', 'want', 'need', 'price', 'cost', 'available', 'offer', 'per', 'am', 'not', 'no', 'yes',
]);
const FOREIGN_WORDS = new Set([
  // es
  'el', 'los', 'las', 'que', 'por', 'para', 'con', 'una', 'uno', 'es', 'como', 'cuál', 'cual', 'cuánto', 'cuanto', 'hola',
  'gracias', 'tienen', 'quiero', 'precio', 'dónde', 'donde', 'está', 'esta', 'pero', 'muy', 'también',
  // fr
  'le', 'les', 'des', 'une', 'et', 'est', 'avec', 'pour', 'vous', 'nous', 'je', 'bonjour', 'merci', 'combien', 'quel',
  'quelle', 'où', 'pas', 'sont', 'mais', 'très',
  // de
  'der', 'das', 'und', 'ist', 'nicht', 'ich', 'sie', 'wir', 'mit', 'für', 'wie', 'was', 'wo', 'haben', 'bitte',
  'danke', 'kosten', 'ein', 'eine',
  // pt / it
  'você', 'voce', 'não', 'nao', 'obrigado', 'olá', 'ola', 'quanto', 'onde', 'uma', 'il', 'che', 'sono',
  'grazie', 'ciao', 'della', 'nel',
  // tr / id / ms
  'nasıl', 'bir', 'için', 'merhaba', 'apa', 'yang', 'berapa', 'saya', 'anda', 'terima', 'kasih',
]);
// Letters that essentially never appear in English text.
const FOREIGN_LATIN = /[àâãäåæçèêëìîïñòôõöøùûüÿßœğışąćęłńśźżčřšžőű¿¡]/i;

function words(message: string): string[] {
  return message.toLowerCase().normalize('NFKC').split(/[^a-z\u00C0-\u024F]+/).filter(Boolean);
}

export function hasForeignLatinSignal(message: string): boolean {
  if (FOREIGN_LATIN.test(message)) return true;
  // 'was' and 'die' collide with English — only count a foreign word when it is not also
  // an English function word.
  return words(message).some(w => FOREIGN_WORDS.has(w) && !ENGLISH_WORDS.has(w));
}

export function looksConfidentlyEnglish(message: string): boolean {
  if (!/^[\x00-\x7F\s]*$/.test(message)) return false; // any non-ASCII → not sure
  if (hasForeignLatinSignal(message)) return false;
  const w = words(message);
  if (!w.length) return false;
  const en = w.filter(x => ENGLISH_WORDS.has(x)).length;
  return en >= 2 || (en >= 1 && w.length <= 6);
}

export interface LanguageDecision { language: string; source: 'heuristic' | 'english' | 'session' | 'llm' }

export async function detectLanguageForSession(
  sessionKey: string,
  message: string,
  llmDetect: (message: string) => Promise<string>,
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

  const quick = LlamaService.quickDetectLanguage(message);
  if (quick !== null) { remember(quick); return { language: quick, source: 'heuristic' }; }

  if (looksConfidentlyEnglish(message)) { remember('en'); return { language: 'en', source: 'english' }; }

  const cached = sessions.get(sessionKey);
  if (cached && now - cached.at < TTL_MS && !hasForeignLatinSignal(message)) {
    return { language: cached.lang, source: 'session' };
  }

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
): Promise<string> {
  const { llamaService } = await import('../../llamaService');
  const { resolveChatContextMode } = await import('./config');
  const { isTopscholarAccount } = await import('../topscholar/config');
  const llm = (m: string) => llamaService.detectLanguage(m, apiKey);
  if (isTopscholarAccount(businessAccountId) || (await resolveChatContextMode(businessAccountId)) === 'legacy') {
    return llm(message);
  }
  const decision = await detectLanguageForSession(`${businessAccountId}:${sessionKey}`, message, llm);
  if (decision.source !== 'llm') console.log(`[LanguageDetection] "${message.substring(0, 40)}" → ${decision.language} (${decision.source}, no AI call)`);
  return decision.language;
}
