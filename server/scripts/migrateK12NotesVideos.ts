import { db } from '../db';
import { k12Topics, k12TopicNotes, k12TopicVideos } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function migrateK12NotesAndVideos() {
  console.log('[K12 Migration] Starting migration of legacy notes and videos...');

  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables WHERE table_name = 'k12_topic_notes'
    ) AS notes_exists,
    EXISTS (
      SELECT FROM information_schema.tables WHERE table_name = 'k12_topic_videos'
    ) AS videos_exists
  `);
  const row = tableCheck.rows?.[0];
  const notesExists = row && 'notes_exists' in row ? Boolean(row.notes_exists) : false;
  const videosExists = row && 'videos_exists' in row ? Boolean(row.videos_exists) : false;
  if (!notesExists || !videosExists) {
    console.log('[K12 Migration] Tables not yet created, skipping migration. Run db:push first.');
    return { notesCreated: 0, videosCreated: 0 };
  }

  const allTopics = await db.select().from(k12Topics);
  let notesCreated = 0;
  let videosCreated = 0;

  for (const topic of allTopics) {
    if (topic.revisionNotesHtml) {
      const existing = await db.select({ id: k12TopicNotes.id })
        .from(k12TopicNotes)
        .where(eq(k12TopicNotes.topicId, topic.id))
        .limit(1);

      if (existing.length === 0) {
        const plainText = stripHtmlTags(topic.revisionNotesHtml);
        if (plainText) {
          await db.insert(k12TopicNotes).values({
            topicId: topic.id,
            businessAccountId: topic.businessAccountId,
            title: 'Revision Notes',
            content: plainText,
            sortOrder: 0,
          });
          notesCreated++;
        }
      }
    }

    if (topic.videoUrl || topic.videoTranscript) {
      const existing = await db.select({ id: k12TopicVideos.id })
        .from(k12TopicVideos)
        .where(eq(k12TopicVideos.topicId, topic.id))
        .limit(1);

      if (existing.length === 0) {
        if (topic.videoUrl) {
          await db.insert(k12TopicVideos).values({
            topicId: topic.id,
            businessAccountId: topic.businessAccountId,
            title: 'Video',
            videoUrl: topic.videoUrl,
            transcript: topic.videoTranscript || null,
            sortOrder: 0,
          });
          videosCreated++;
        } else if (topic.videoTranscript) {
          await db.insert(k12TopicNotes).values({
            topicId: topic.id,
            businessAccountId: topic.businessAccountId,
            title: 'Video Transcript',
            content: topic.videoTranscript,
            sortOrder: 999,
          });
          notesCreated++;
        }
      }
    }
  }

  console.log(`[K12 Migration] Complete: ${notesCreated} notes created, ${videosCreated} videos created`);
  return { notesCreated, videosCreated };
}
