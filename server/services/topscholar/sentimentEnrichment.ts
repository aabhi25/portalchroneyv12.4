import OpenAI from 'openai';
import { db } from '../../db';
import { conversations, messages } from '@shared/schema';
import { and, eq, isNull, isNotNull, desc, sql } from 'drizzle-orm';

/**
 * Best-effort learner-sentiment enrichment for TopScholar analytics.
 *
 * Classifies a curriculum-bound conversation into one coarse bucket:
 *   'positive' | 'neutral' | 'confused'
 * and persists it on `conversations.sentiment`. This is purely additive — it is
 * fired-and-forgotten from the analytics read path (capped + single-flight per
 * account) and NEVER blocks a response. Unlabeled conversations simply show as
 * "unlabeled" until a later pass fills them in.
 */

const VALID = new Set(['positive', 'neutral', 'confused']);

// Single-flight guard so concurrent dashboard loads don't fan out duplicate work.
const inFlight = new Set<string>();

function extractLabel(text: string): string | null {
  const t = (text || '').toLowerCase();
  const m = t.match(/positive|neutral|confused/);
  return m && VALID.has(m[0]) ? m[0] : null;
}

async function classifyOne(
  conversationId: string,
  openai: OpenAI,
  model: string,
): Promise<string | null> {
  const msgs = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
    .limit(30);

  if (msgs.length === 0) return null;

  const transcript = msgs
    .map((m) => `${m.role}: ${(m.content || '').substring(0, 200)}`)
    .join('\n');

  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You assess a K-12 student\'s emotional/learning state from their chat with an AI tutor. ' +
          'Reply with ONE word only: "positive" (engaged, satisfied, understood), ' +
          '"neutral" (plain Q&A, no strong signal), or ' +
          '"confused" (struggling, frustrated, repeated/clarifying questions, "I don\'t understand").',
      },
      { role: 'user', content: `Conversation:\n${transcript}\n\nOne word:` },
    ],
    temperature: 0,
    max_tokens: 4,
  });

  return extractLabel(response.choices[0]?.message?.content || '');
}

/**
 * Classify up to `limit` unlabeled curriculum conversations for an account.
 * Returns counts. Safe to call repeatedly; no-ops when nothing is unlabeled or
 * no API key is configured.
 */
export async function batchEnrichSentiment(
  businessAccountId: string,
  limit = 15,
): Promise<{ processed: number; failed: number }> {
  const pending = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.businessAccountId, businessAccountId),
        isNotNull(conversations.topscholarCpId),
        eq(conversations.awaitingVerification, false),
        sql`${conversations.isInternalTest} = 'false'`,
        isNull(conversations.sentiment),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);

  if (pending.length === 0) return { processed: 0, failed: 0 };

  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  let effectiveKey = apiKey;
  let provider = 'openai';
  let model = 'gpt-4o-mini';
  try {
    const { storage } = await import('../../storage');
    const master = await storage.getMasterAiSettings().catch(() => null);
    if (master?.masterEnabled && master.primaryApiKey) {
      effectiveKey = master.primaryApiKey;
      provider = master.primaryProvider || 'openai';
      model = master.primaryModel || 'gpt-4o-mini';
    }
  } catch {
    /* fall back to env key */
  }
  if (!effectiveKey) return { processed: 0, failed: 0 };

  const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
  const openai =
    provider === 'gemini'
      ? new OpenAI({ apiKey: effectiveKey, baseURL: GEMINI_BASE_URL })
      : new OpenAI({ apiKey: effectiveKey });

  let processed = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      const label = await classifyOne(row.id, openai, model);
      if (label) {
        await db.update(conversations).set({ sentiment: label }).where(eq(conversations.id, row.id));
        processed++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error('[TopScholarSentiment] classify failed:', err);
      failed++;
    }
  }
  return { processed, failed };
}

/**
 * Fire-and-forget trigger used by the analytics read path. Capped + single-flight
 * per account; swallows all errors so it can never affect the response.
 */
export function triggerSentimentEnrichment(businessAccountId: string, limit = 15): void {
  if (inFlight.has(businessAccountId)) return;
  inFlight.add(businessAccountId);
  void batchEnrichSentiment(businessAccountId, limit)
    .catch((err) => console.error('[TopScholarSentiment] background enrichment error:', err))
    .finally(() => inFlight.delete(businessAccountId));
}
