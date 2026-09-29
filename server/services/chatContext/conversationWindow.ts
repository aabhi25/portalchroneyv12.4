/**
 * Conversation-aware helpers: the retrieval query for follow-up questions, and the
 * capped history window sent to the model.
 */
import { estimateTokens, truncateToTokens } from './tokens';
import { tokenize } from './lexical';

export interface HistoryMessage { role: 'user' | 'assistant' | 'system'; content: string }

// ── Follow-up detection / retrieval query ──────────────────────────────────────

const FOLLOW_UP_START = /^(and|also|plus|what about|how about|what of|and what|and how|same for|then|so what|ok so|okay so|what else|anything else|tell me more|more about|more details|any more|is it|is that|is there|are they|are those|does it|does that|do they|can it|can they|will it|which one|which of them|how much is it|how much does it|how long is it|where is it|when is it|why)\b/i;
const ANAPHORA = /\b(it|its|it's|that|this|those|these|they|them|their|there|one|ones|same|above|previous|former|latter|he|she|his|her)\b/i;
const ACKS = /^(yes|yeah|yep|yup|sure|ok|okay|pls|please|go ahead|tell me|details|more|continue|haan|ha|ji)[.!?\s]*$/i;

export interface RetrievalQuery {
  /** Full text to embed. */
  query: string;
  /** The visitor's current message (weighted highest for keyword matching). */
  primary: string;
  /** Earlier user turns folded in for context ('' when not a follow-up). */
  context: string;
  isFollowUp: boolean;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Cheap heuristic: does this message lean on earlier turns for its meaning? */
export function isFollowUpMessage(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  const words = wordCount(m);
  if (ACKS.test(m)) return true;
  if (words <= 3) return true;
  if (FOLLOW_UP_START.test(m)) return true;
  if (words <= 12 && ANAPHORA.test(m)) return true;
  // Short message with at most two content words ("do I need to bring my own?",
  // "how much are the lessons?") — it leans on the conversation for its subject.
  if (words <= 8 && tokenize(m).length <= 2) return true;
  return false;
}

/**
 * History-aware retrieval query. For a follow-up ("what about the price?") the last one
 * or two user turns are appended so retrieval finds the thing being talked about.
 * `history` is the conversation BEFORE the current message.
 */
export function buildRetrievalQuery(message: string, history: HistoryMessage[], maxPriorTurns = 2): RetrievalQuery {
  const primary = message.trim();
  const priorUserTurns = history.filter(h => h.role === 'user').map(h => h.content.trim()).filter(Boolean);
  if (!priorUserTurns.length || !isFollowUpMessage(primary)) {
    return { query: primary, primary, context: '', isFollowUp: false };
  }
  const picked = priorUserTurns.slice(-maxPriorTurns).map(t => truncateToTokens(t, 60));
  const context = picked.join('\n');
  return { query: `${primary}\n${context}`, primary, context, isFollowUp: true };
}

// ── History window ─────────────────────────────────────────────────────────────

export const HISTORY_MAX_MESSAGES = 20; // 10 turns
export const HISTORY_MAX_TOKENS = 3000;

export interface HistoryWindow {
  messages: HistoryMessage[];
  droppedCount: number;
}

/**
 * Keep the most recent messages within both limits (always at least the last 2).
 * Anything older is replaced by one short extractive note (no extra LLM call) that
 * keeps what the visitor said earlier — names, requirements — visible to the model.
 */
export function capHistoryForModel(
  history: HistoryMessage[],
  opts: { maxMessages?: number; maxTokens?: number } = {},
): HistoryWindow {
  const maxMessages = opts.maxMessages ?? HISTORY_MAX_MESSAGES;
  const maxTokens = opts.maxTokens ?? HISTORY_MAX_TOKENS;
  if (history.length <= 2) return { messages: history.slice(), droppedCount: 0 };

  let start = history.length;
  let tokens = 0;
  while (start > 0) {
    const next = history[start - 1];
    const t = estimateTokens(next.content) + 4;
    const kept = history.length - start;
    if (kept >= 2 && (kept + 1 > maxMessages || tokens + t > maxTokens)) break;
    tokens += t;
    start--;
  }
  if (start === 0) return { messages: history.slice(), droppedCount: 0 };

  const dropped = history.slice(0, start);
  const earlierUser = dropped.filter(m => m.role === 'user').map(m => truncateToTokens(m.content.replace(/\s+/g, ' ').trim(), 30));
  // First messages usually carry name / intent; the latest ones carry the current topic.
  const picked = earlierUser.length > 8 ? [...earlierUser.slice(0, 3), '…', ...earlierUser.slice(-5)] : earlierUser;
  const lines = picked.map(t => (t === '…' ? '  …' : `• ${t}`));
  const note: HistoryMessage = {
    role: 'system',
    content: `EARLIER IN THIS CONVERSATION (${dropped.length} older messages omitted to save space). The visitor had said:\n${lines.join('\n') || '• (nothing substantive)'}`,
  };
  return { messages: [note, ...history.slice(start)], droppedCount: dropped.length };
}
