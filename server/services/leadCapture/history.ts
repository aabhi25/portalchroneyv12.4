/**
 * Conversation history straight from the messages table — the in-memory chat memory expires
 * after 15 idle minutes and is per-process, so after an idle gap, a restart or on a second
 * instance it is reloaded from here, and the "visitor message #N" used by custom timing is
 * always counted here.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db';

export const HISTORY_RELOAD_LIMIT = 30;

export interface StoredChatMessage { role: 'user' | 'assistant'; content: string }

/** Last `limit` user/assistant messages of the conversation, oldest first. */
export async function loadRecentHistory(conversationId: string, limit = HISTORY_RELOAD_LIMIT): Promise<StoredChatMessage[]> {
  if (!conversationId || conversationId.startsWith('temp_')) return [];
  const res: any = await db.execute(sql`
    SELECT role, content FROM (
      SELECT role, content, created_at, id FROM messages
      WHERE conversation_id = ${conversationId} AND role IN ('user', 'assistant')
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    ) recent
    ORDER BY created_at ASC, id ASC
  `);
  return (res.rows || [])
    .filter((r: any) => typeof r.content === 'string')
    .map((r: any) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content }));
}

/** Number of visitor messages stored for the conversation (the current one included once stored). */
export async function countUserMessages(conversationId: string): Promise<number> {
  if (!conversationId || conversationId.startsWith('temp_')) return 0;
  const res: any = await db.execute(sql`SELECT count(*)::int AS n FROM messages WHERE conversation_id = ${conversationId} AND role = 'user'`);
  return Number(res.rows?.[0]?.n) || 0;
}
