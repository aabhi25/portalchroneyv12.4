/**
 * SQL side of training-item channel tags (shared/knowledgeChannels.ts): a row applies on a channel
 * when its `channels` array is NULL / empty (untagged = every channel) or contains the channel.
 * Embeddings and vector indexes are unchanged — this is only an extra WHERE condition.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { KnowledgeChannel } from '../../../shared/knowledgeChannels';

/** `undefined` when no channel is given (caller not channel-aware → no filter, as before). */
export function channelCondition(column: AnyPgColumn, channel: KnowledgeChannel | null | undefined): SQL | undefined {
  if (!channel) return undefined;
  return sql`(${column} IS NULL OR cardinality(${column}) = 0 OR ${channel} = ANY(${column}))`;
}
