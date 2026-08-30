import { and, eq, isNull, lt } from 'drizzle-orm';
import { db } from '../../db';
import { topscholarVoiceSessions } from '@shared/schema';
import type { TopscholarVoiceScope } from '../../realtimeVoiceService';

export interface StartTopscholarVoiceSession {
  businessAccountId: string;
  conversationId: string;
  cpIds: string[] | null | undefined;
  scope: TopscholarVoiceScope | null | undefined;
  isInternalTest: boolean;
}

export async function startTopscholarVoiceSession(
  input: StartTopscholarVoiceSession,
): Promise<string> {
  const [session] = await db
    .insert(topscholarVoiceSessions)
    .values({
      businessAccountId: input.businessAccountId,
      conversationId: input.conversationId,
      studentId: input.scope?.studentId || null,
      cpIds: input.cpIds || [],
      board: input.scope?.board || null,
      medium: input.scope?.medium || null,
      grade: input.scope?.grade || null,
      subject: input.scope?.subject || null,
      chapter: input.scope?.chapter || null,
      isInternalTest: input.isInternalTest,
    })
    .returning({ id: topscholarVoiceSessions.id });

  return session.id;
}

export async function endTopscholarVoiceSession(
  sessionId: string,
  reason: string,
): Promise<void> {
  await db
    .update(topscholarVoiceSessions)
    .set({
      disconnectedAt: new Date(),
      disconnectReason: reason.slice(0, 100),
    })
    .where(and(
      eq(topscholarVoiceSessions.id, sessionId),
      isNull(topscholarVoiceSessions.disconnectedAt),
    ));
}

export async function closeOrphanedTopscholarVoiceSessions(
  connectedBefore: Date,
): Promise<number> {
  const closed = await db
    .update(topscholarVoiceSessions)
    .set({
      disconnectedAt: new Date(),
      disconnectReason: 'server_restart',
    })
    .where(and(
      isNull(topscholarVoiceSessions.disconnectedAt),
      lt(topscholarVoiceSessions.connectedAt, connectedBefore),
    ))
    .returning({ id: topscholarVoiceSessions.id });

  return closed.length;
}