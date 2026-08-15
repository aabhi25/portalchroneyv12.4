import type {
  K12ContentResolver,
  K12ResolverOptions,
  TopicResult,
  QuestionResult,
} from '../k12ContentResolver';
import { embeddingService } from '../embeddingService';
import { getContentPool, ensureContentSchema, toVectorLiteral } from './contentDb';
import { isMongoConnectionString } from './config';
import { mongoVectorSearch } from './mongoContentDb';

/**
 * Account-wide retrieval resolver for the TopScholar curriculum chatbot.
 *
 * Every query is embedded and vector-searched against the content store, scoped
 * by business_account_id across ALL of the account's content packs (it is NOT
 * pinned to a single cp_id). A signed handoff may still identify the student for
 * personalization, but it no longer restricts which packs can be drawn from.
 * Near-duplicate passages that appear in more than one pack are de-duplicated.
 * When nothing relevant is found it returns an honest empty result (content-only
 * mode), so the tutor tells the student the topic isn't in the curriculum yet.
 *
 * The store may be pgvector (local stand-in or client Postgres) OR MongoDB Atlas
 * Vector Search, chosen automatically from the content-DB connection string.
 */
export class RagK12ContentResolver implements K12ContentResolver {
  constructor(
    private readonly cfg: {
      contentDbUrl: string | null;
      contentDbName: string | null;
      contentDbIndex: string | null;
      contentDbCollection: string | null;
    },
  ) {}

  /** Collapse near-identical passages that appear across multiple content packs. */
  private dedupeByContent(rows: any[]): any[] {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const r of rows) {
      const key = String(r.content_text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(r);
    }
    return out;
  }

  private async vectorSearch(
    businessAccountId: string,
    query: string,
    contentTypes: string[],
    limit: number,
    cpIds?: string[] | null,
    chapter?: string | null,
  ): Promise<any[]> {
    // Grade-scoped retrieval (Option A): when a student scope was supplied it
    // resolves to a set of cp_ids. An EMPTY array means the scope matched no synced
    // package — refuse (return nothing) instead of leaking other grades' content. A
    // null/undefined cpIds means no scope was supplied → whole-account search.
    const scoped = Array.isArray(cpIds);
    if (scoped && cpIds!.length === 0) return [];

    // Optional chapter narrowing: when supplied, retrieval is hard-filtered to this
    // chapter on top of the cp_id scope. Blank => no chapter filter (back-compat).
    const chapterFilter = (chapter ?? '').trim();

    const [embedding] = await embeddingService.generateBatchEmbeddings([query], businessAccountId);
    if (!embedding) return [];

    // Over-fetch so cross-pack de-duplication still yields up to `limit` results.
    const fetchLimit = limit * 2;
    let rows: any[];

    // MongoDB Atlas Vector Search branch.
    if (isMongoConnectionString(this.cfg.contentDbUrl)) {
      if (!this.cfg.contentDbIndex) {
        throw new Error('MongoDB Atlas Vector Search index name is not configured.');
      }
      const docs = await mongoVectorSearch(
        {
          connectionString: this.cfg.contentDbUrl!,
          dbName: this.cfg.contentDbName,
          collection: this.cfg.contentDbCollection,
          indexName: this.cfg.contentDbIndex,
        },
        { businessAccountId, embedding, contentTypes, limit: fetchLimit, cpIds: scoped ? cpIds! : undefined, chapter: chapterFilter || undefined },
      );
      // Normalize to the same shape the pgvector rows expose downstream.
      rows = docs.map((d) => ({
        content_type: d.content_type,
        subject: d.subject,
        chapter: d.chapter,
        title: d.title,
        content_html: d.content_html,
        content_text: d.chunk_text,
        media_url: d.media_url,
        metadata: d.metadata,
      }));
    } else {
      // pgvector branch (local stand-in or client Postgres). By default search
      // across ALL of the account's content packs (scoped by business_account_id
      // only); when a grade scope is supplied, hard-filter to its cp_id set.
      const pool = getContentPool(this.cfg.contentDbUrl);
      await ensureContentSchema(pool);

      // Build params positionally: $1 baId, $2 vector, $3 contentTypes, $4 limit,
      // then optionally $5 cpIds and a trailing chapter param. The chapter clause
      // matches case-insensitively + trimmed to mirror the cp-mapping resolver.
      const params: unknown[] = [businessAccountId, toVectorLiteral(embedding), contentTypes, fetchLimit];
      let cpIdsClause = '';
      if (scoped) {
        params.push(cpIds!);
        cpIdsClause = `AND cp_id = ANY($${params.length})`;
      }
      let chapterClause = '';
      if (chapterFilter) {
        params.push(chapterFilter);
        chapterClause = `AND lower(btrim(chapter)) = lower($${params.length})`;
      }

      const result = await pool.query(
        `SELECT content_type, subject, chapter, title, content_html, content_text,
                media_url, metadata, embedding <=> $2::vector AS distance
           FROM topscholar_content_chunks
          WHERE business_account_id = $1 AND content_type = ANY($3)
          ${cpIdsClause}
          ${chapterClause}
          ORDER BY embedding <=> $2::vector
          LIMIT $4`,
        params,
      );
      rows = result.rows;
    }

    return this.dedupeByContent(rows).slice(0, limit);
  }

  async searchTopics(
    query: string,
    businessAccountId: string,
    options?: K12ResolverOptions,
  ): Promise<{ message: string; results: TopicResult[] }> {
    try {
      const rows = await this.vectorSearch(businessAccountId, query, ['note', 'transcript', 'ebook_page'], 6, options?.cpIds, options?.chapter);
      if (rows.length === 0) {
        return { message: `No curriculum content found in your syllabus for "${query}".`, results: [] };
      }

      const results: TopicResult[] = rows.map((r) => {
        const isVideo = r.content_type === 'transcript';
        const meta = (r.metadata || {}) as Record<string, unknown>;
        const metaImages = Array.isArray(meta.images) ? (meta.images as string[]) : [];
        const mediaUrls = [r.media_url, ...metaImages].filter(Boolean) as string[];

        // Embed image URLs directly into the content text as Markdown image tags.
        // This ensures the AI sees and includes them as part of the curriculum
        // content rather than relying on it to notice a separate mediaUrls field.
        const imageMarkdown = mediaUrls.length > 0
          ? '\n\n' + mediaUrls.map((url) => `![image](${url})`).join('\n')
          : '';
        const enrichedText = (r.content_text || '') + imageMarkdown;

        return {
          name: r.title || r.chapter || 'Curriculum content',
          description: null,
          revisionNotes: enrichedText,
          notes: [{ title: r.title || 'Notes', content: enrichedText }],
          videos: isVideo
            ? [{ title: r.title || 'Video', videoUrl: r.media_url || '', transcript: r.content_text }]
            : [],
          tags: null,
          chapterName: r.chapter || 'Curriculum',
          subjectName: r.subject || 'Curriculum',
          contentHtml: r.content_html || null,
          mediaUrls,
        };
      });

      return { message: `Found ${results.length} relevant passage(s) from your syllabus.`, results };
    } catch (error: any) {
      console.error('[TopScholar RAG] searchTopics failed:', error?.message || error);
      return {
        message:
          'SYSTEM ERROR: The curriculum content store is temporarily unreachable. You MUST NOT answer the student\'s question from your general knowledge. Tell the student you are temporarily unable to access their study material and ask them to try again in a few minutes. Do not explain the topic.',
        results: [],
      };
    }
  }

  async searchQuestions(
    query: string,
    businessAccountId: string,
    difficulty?: number,
    options?: K12ResolverOptions,
  ): Promise<{ message: string; results: QuestionResult[] }> {
    try {
      const rows = await this.vectorSearch(businessAccountId, query, ['question'], 8, options?.cpIds, options?.chapter);
      if (rows.length === 0) {
        return { message: `No practice questions found in your syllabus for "${query}".`, results: [] };
      }

      let results: QuestionResult[] = rows.map((r) => {
        const meta = (r.metadata || {}) as Record<string, any>;
        const options = Array.isArray(meta.options)
          ? meta.options.map((o: any, idx: number) => ({
              label: String.fromCharCode(65 + idx),
              text: o.text || '',
              isCorrect: !!o.isCorrect,
            }))
          : null;
        return {
          question: r.content_text,
          type: 'objective',
          options,
          solution: meta.solution ?? null,
          difficulty: typeof meta.difficulty === 'number' ? meta.difficulty : null,
          marks: typeof meta.marks === 'number' ? meta.marks : null,
          topicName: r.chapter || r.title || 'Curriculum',
        };
      });

      if (difficulty) {
        const filtered = results.filter((q) => q.difficulty != null && Math.abs(q.difficulty - difficulty) <= 2);
        if (filtered.length > 0) results = filtered;
      }

      return { message: `Found ${results.length} question(s) from your syllabus.`, results };
    } catch (error: any) {
      console.error('[TopScholar RAG] searchQuestions failed:', error?.message || error);
      return {
        message:
          'SYSTEM ERROR: The practice-question store is temporarily unreachable. You MUST NOT generate practice questions from your general knowledge. Tell the student you are temporarily unable to access their practice questions and ask them to try again in a few minutes.',
        results: [],
      };
    }
  }
}
