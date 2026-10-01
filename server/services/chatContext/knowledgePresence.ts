/**
 * Does an account have ANY trainable knowledge (FAQs, training documents / chunks,
 * trained URLs / chunks, analyzed website pages)? Accounts with none skip the
 * per-message knowledge search entirely (query embedding + six lookups that can only
 * come back empty).
 *
 * Deliberately channel-agnostic and a superset of what retrieval reads: if anything
 * exists for any channel the search runs exactly as before, so skipping can never
 * hide an answer. Cached per account for 5 minutes in businessContextCache (dropped
 * with the account's other caches on training changes, and explicitly when an FAQ /
 * document / URL / page is added — see invalidateKnowledgePresence callers).
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { businessContextCache, BusinessContextCache } from '../businessContextCache';

const TTL_MS = 5 * 60 * 1000;

export async function accountHasKnowledge(businessAccountId: string): Promise<boolean> {
  return businessContextCache.getOrFetch<boolean>(
    BusinessContextCache.KEYS.KNOWLEDGE_PRESENCE(businessAccountId),
    async () => {
      try {
        const res = await db.execute(sql`
          SELECT (
               EXISTS (SELECT 1 FROM faqs WHERE business_account_id = ${businessAccountId})
            OR EXISTS (SELECT 1 FROM training_documents WHERE business_account_id = ${businessAccountId})
            OR EXISTS (SELECT 1 FROM document_chunks WHERE business_account_id = ${businessAccountId})
            OR EXISTS (SELECT 1 FROM trained_urls WHERE business_account_id = ${businessAccountId})
            OR EXISTS (SELECT 1 FROM url_content_chunks WHERE business_account_id = ${businessAccountId})
            OR EXISTS (SELECT 1 FROM analyzed_pages WHERE business_account_id = ${businessAccountId})
          ) AS has_knowledge
        `);
        const row = (res.rows ?? [])[0] as any;
        const v = row?.has_knowledge;
        return v === true || v === 't' || v === 'true';
      } catch (err) {
        // Unknown → search as before.
        console.warn('[Knowledge] Presence check failed (searching as usual):', (err as Error)?.message);
        return true;
      }
    },
    TTL_MS,
  );
}

export function invalidateKnowledgePresence(businessAccountId: string | null | undefined): void {
  if (!businessAccountId) return;
  businessContextCache.invalidate(BusinessContextCache.KEYS.KNOWLEDGE_PRESENCE(businessAccountId));
}
