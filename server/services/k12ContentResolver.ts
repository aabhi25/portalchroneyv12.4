import { db } from '../db';
import { k12Subjects, k12Chapters, k12Topics, k12Questions, k12TopicNotes, k12TopicVideos, businessAccounts } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { TopScholarApiService } from './topscholarApiService';

export interface TopicVideoResult {
  title: string;
  videoUrl: string;
  transcript: string | null;
}

export interface TopicResult {
  name: string;
  description: string | null;
  revisionNotes: string | null;
  notes: { title: string; content: string }[];
  videos: TopicVideoResult[];
  tags: string[] | null;
  chapterName: string;
  subjectName: string;
  // Optional rich fields used by the TopScholar RAG resolver for MathML + media rendering.
  contentHtml?: string | null;
  mediaUrls?: string[];
}

export interface QuestionOption {
  label: string;
  text: string;
  isCorrect?: boolean;
}

export interface QuestionResult {
  question: string | null;
  type: string | null;
  options: QuestionOption[] | null;
  solution: string | null;
  difficulty: number | null;
  marks: number | null;
  topicName: string;
}

// Per-call options. cpId binds retrieval to a single TopScholar content package.
export interface K12ResolverOptions {
  cpId?: string | null;
  // Grade-scoped widget (Option A): the set of cp_id(s) resolved from a student's
  // board/medium/grade. Semantics:
  //   - undefined / null  → no scope supplied; search the whole account (back-compat)
  //   - non-empty array   → restrict retrieval to exactly these cp_ids
  //   - empty array       → scope was supplied but matched no synced package; return
  //                         nothing (refuse) rather than leaking other grades' content
  cpIds?: string[] | null;
  // Optional chapter narrowing. When a non-empty value is supplied, retrieval is
  // further hard-filtered to chunks whose `chapter` matches (case-insensitive,
  // trimmed). Absent/blank → no chapter filter (whole-subject behavior, back-compat).
  chapter?: string | null;
}

export interface K12ContentResolver {
  searchTopics(query: string, businessAccountId: string, options?: K12ResolverOptions): Promise<{ message: string; results: TopicResult[] }>;
  searchQuestions(query: string, businessAccountId: string, difficulty?: number, options?: K12ResolverOptions): Promise<{ message: string; results: QuestionResult[] }>;
}

function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    'what', 'is', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'but',
    'how', 'why', 'when', 'where', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'must',
    'about', 'with', 'from', 'into', 'through', 'during', 'before', 'after',
    'above', 'below', 'between', 'under', 'over', 'its', 'it', 'not', 'no', 'nor',
    'give', 'me', 'tell', 'explain', 'describe', 'define', 'find', 'show', 'get',
    'please', 'help', 'need', 'want', 'know', 'learn', 'study', 'understand',
    'si', 'unit', 'units', 'value', 'formula', 'definition', 'meaning',
    'kya', 'hai', 'kaise', 'kyon', 'kab', 'kahan', 'kaun', 'kitna', 'batao', 'samjhao',
    'bolo', 'dikhao', 'padhai', 'padhao', 'ke', 'ka', 'ki', 'ko', 'se', 'mein', 'par',
    'practice', 'questions', 'question', 'mcq', 'quiz', 'test', 'notes', 'revision',
  ]);

  const hindiStopWords = new Set([
    'क्या', 'है', 'कैसे', 'क्यों', 'कब', 'कहाँ', 'कौन', 'कितना', 'बताओ', 'समझाओ',
    'बोलो', 'दिखाओ', 'पढ़ाई', 'पढ़ाओ', 'के', 'का', 'की', 'को', 'से', 'में', 'पर',
    'और', 'या', 'लेकिन', 'तो', 'ये', 'यह', 'वो', 'वह', 'इसका', 'उसका',
    'मुझे', 'हमें', 'तुम', 'आप', 'मैं', 'हम', 'कर', 'करो', 'करें', 'होता',
    'प्रश्न', 'सवाल', 'नोट्स',
  ]);

  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w) && !hindiStopWords.has(w));
}

function scoreMatch(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score++;
  }
  return score;
}

export class InternalK12ContentResolver implements K12ContentResolver {
  async searchTopics(query: string, businessAccountId: string, _options?: K12ResolverOptions): Promise<{ message: string; results: TopicResult[] }> {
    const [allTopics, allChapters, allSubjects, allNotes, allVideos] = await Promise.all([
      db.select().from(k12Topics).where(eq(k12Topics.businessAccountId, businessAccountId)),
      db.select().from(k12Chapters).where(eq(k12Chapters.businessAccountId, businessAccountId)),
      db.select().from(k12Subjects).where(eq(k12Subjects.businessAccountId, businessAccountId)),
      db.select().from(k12TopicNotes).where(eq(k12TopicNotes.businessAccountId, businessAccountId)),
      db.select().from(k12TopicVideos).where(eq(k12TopicVideos.businessAccountId, businessAccountId)),
    ]);

    const chapterMap = new Map(allChapters.map(c => [c.id, c]));
    const subjectMap = new Map(allSubjects.map(s => [s.id, s]));

    const notesByTopic = new Map<string, typeof allNotes>();
    for (const n of allNotes) {
      const arr = notesByTopic.get(n.topicId) || [];
      arr.push(n);
      notesByTopic.set(n.topicId, arr);
    }
    for (const [, notes] of notesByTopic) {
      notes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }

    const videosByTopic = new Map<string, typeof allVideos>();
    for (const v of allVideos) {
      const arr = videosByTopic.get(v.topicId) || [];
      arr.push(v);
      videosByTopic.set(v.topicId, arr);
    }
    for (const [, videos] of videosByTopic) {
      videos.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }

    const queryLower = query.toLowerCase();
    const keywords = extractKeywords(query);

    interface ScoredTopic {
      topic: typeof allTopics[0];
      score: number;
    }

    const scored: ScoredTopic[] = [];

    for (const t of allTopics) {
      let score = 0;
      const chapter = chapterMap.get(t.chapterId);
      const subject = chapter ? subjectMap.get(chapter.subjectId) : undefined;

      if (t.name.toLowerCase().includes(queryLower)) {
        score += 10;
      }
      if (t.description && t.description.toLowerCase().includes(queryLower)) {
        score += 8;
      }
      if (t.tags && (t.tags as string[]).some(tag => tag.toLowerCase().includes(queryLower))) {
        score += 7;
      }
      if (chapter && chapter.name.toLowerCase().includes(queryLower)) {
        score += 6;
      }
      if (subject && subject.name.toLowerCase().includes(queryLower)) {
        score += 5;
      }

      if (score === 0 && keywords.length > 0) {
        score += scoreMatch(t.name, keywords) * 3;
        if (t.description) {
          score += scoreMatch(t.description, keywords) * 2;
        }
        if (t.tags) {
          for (const tag of (t.tags as string[])) {
            score += scoreMatch(tag, keywords) * 2;
          }
        }
        if (chapter) {
          score += scoreMatch(chapter.name, keywords) * 2;
        }
        if (subject) {
          score += scoreMatch(subject.name, keywords);
        }
      }

      if (score > 0) {
        scored.push({ topic: t, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      const availableTopics = allTopics.map(t => t.name).join(', ');
      return {
        message: `No topics found matching "${query}". Available topics: ${availableTopics}`,
        results: [],
      };
    }

    const results: TopicResult[] = scored.map(({ topic }) => {
      const chapter = chapterMap.get(topic.chapterId);
      const subject = chapter ? subjectMap.get(chapter.subjectId) : undefined;
      const topicNotes = notesByTopic.get(topic.id) || [];
      const topicVideos = videosByTopic.get(topic.id) || [];

      const allNotesText = topicNotes.map(n => n.content).join('\n\n');

      return {
        name: topic.name,
        description: topic.description,
        revisionNotes: allNotesText || (topic.revisionNotesHtml ? topic.revisionNotesHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null),
        notes: topicNotes.map(n => ({ title: n.title, content: n.content })),
        videos: topicVideos.map(v => ({
          title: v.title,
          videoUrl: v.videoUrl,
          transcript: v.transcript,
        })),
        tags: topic.tags as string[] | null,
        chapterName: chapter?.name || 'Unknown',
        subjectName: subject?.name || 'Unknown',
      };
    });

    return {
      message: `Found ${results.length} topic(s) matching "${query}"`,
      results,
    };
  }

  async searchQuestions(query: string, businessAccountId: string, difficulty?: number, _options?: K12ResolverOptions): Promise<{ message: string; results: QuestionResult[] }> {
    const [allTopics, allChapters, allSubjects, allQuestions] = await Promise.all([
      db.select().from(k12Topics).where(eq(k12Topics.businessAccountId, businessAccountId)),
      db.select().from(k12Chapters).where(eq(k12Chapters.businessAccountId, businessAccountId)),
      db.select().from(k12Subjects).where(eq(k12Subjects.businessAccountId, businessAccountId)),
      db.select().from(k12Questions).where(eq(k12Questions.businessAccountId, businessAccountId)),
    ]);

    const chapterMap = new Map(allChapters.map(c => [c.id, c]));
    const subjectMap = new Map(allSubjects.map(s => [s.id, s]));

    const queryLower = query.toLowerCase();
    const keywords = extractKeywords(query);

    const matchedTopicIds = new Set<string>();

    for (const t of allTopics) {
      let score = 0;
      const chapter = chapterMap.get(t.chapterId);
      const subject = chapter ? subjectMap.get(chapter.subjectId) : undefined;

      if (t.name.toLowerCase().includes(queryLower)) score += 10;
      if (t.tags && (t.tags as string[]).some(tag => tag.toLowerCase().includes(queryLower))) score += 7;
      if (chapter && chapter.name.toLowerCase().includes(queryLower)) score += 6;
      if (subject && subject.name.toLowerCase().includes(queryLower)) score += 5;

      if (score === 0 && keywords.length > 0) {
        score += scoreMatch(t.name, keywords) * 3;
        if (t.tags) {
          for (const tag of (t.tags as string[])) {
            score += scoreMatch(tag, keywords) * 2;
          }
        }
        if (chapter) score += scoreMatch(chapter.name, keywords) * 2;
        if (subject) score += scoreMatch(subject.name, keywords);
      }

      if (score > 0) {
        matchedTopicIds.add(t.id);
      }
    }

    if (matchedTopicIds.size === 0) {
      const availableTopics = allTopics.map(t => t.name).join(', ');
      return {
        message: `No questions found for "${query}". Available topics: ${availableTopics}`,
        results: [],
      };
    }

    const topicNameMap = new Map(allTopics.map(t => [t.id, t.name]));
    let questions = allQuestions.filter(q => matchedTopicIds.has(q.topicId));

    if (difficulty) {
      const filtered = questions.filter(q => q.difficulty && Math.abs(q.difficulty - difficulty) <= 2);
      if (filtered.length > 0) questions = filtered;
    }

    const results: QuestionResult[] = questions.map(q => ({
      question: q.questionHtml,
      type: q.questionType,
      options: q.options,
      solution: q.solutionHtml,
      difficulty: q.difficulty,
      marks: q.marks,
      topicName: topicNameMap.get(q.topicId) || 'Unknown',
    }));

    return {
      message: `Found ${results.length} question(s) for "${query}"`,
      results,
    };
  }
}

export class ExternalK12ContentResolver implements K12ContentResolver {
  private apiService: TopScholarApiService;

  constructor(baseUrl: string, token: string) {
    this.apiService = new TopScholarApiService({ baseUrl, token });
  }

  async searchTopics(query: string, _businessAccountId: string, _options?: K12ResolverOptions): Promise<{ message: string; results: TopicResult[] }> {
    return this.apiService.searchTopics(query);
  }

  async searchQuestions(query: string, _businessAccountId: string, difficulty?: number, _options?: K12ResolverOptions): Promise<{ message: string; results: QuestionResult[] }> {
    return this.apiService.searchQuestions(query, difficulty);
  }
}

const internalResolver = new InternalK12ContentResolver();

export async function getK12ContentResolver(businessAccountId: string): Promise<K12ContentResolver> {
  try {
    const [account] = await db
      .select({
        id: businessAccounts.id,
        topscholarApiBaseUrl: businessAccounts.topscholarApiBaseUrl,
        topscholarApiToken: businessAccounts.topscholarApiToken,
        topscholarRagEnabled: businessAccounts.topscholarRagEnabled,
        topscholarContentDbUrl: businessAccounts.topscholarContentDbUrl,
        topscholarContentDbDisabled: businessAccounts.topscholarContentDbDisabled,
        topscholarContentDbName: businessAccounts.topscholarContentDbName,
        topscholarContentDbIndex: businessAccounts.topscholarContentDbIndex,
        topscholarContentDbCollection: businessAccounts.topscholarContentDbCollection,
        topscholarSyncMode: businessAccounts.topscholarSyncMode,
        topscholarTokenSecret: businessAccounts.topscholarTokenSecret,
        topscholarUatPlainCpId: businessAccounts.topscholarUatPlainCpId,
        topscholarRequireSignedToken: businessAccounts.topscholarRequireSignedToken,
      })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId));

    // Client-hosted RAG curriculum mode (cp_id-scoped). Highest priority for
    // TopScholar. Curriculum mode is hardcoded ON for the single allowed account
    // (gated purely by account identity), so this path is reserved for that one
    // tenant and can never activate for any other.
    const { isTopscholarAccount, getTopscholarConfig } = await import('./topscholar/config');
    if (account && isTopscholarAccount(businessAccountId)) {
      const { RagK12ContentResolver } = await import('./topscholar/ragResolver');
      // Route through getTopscholarConfig so the "Use external content database"
      // kill-switch is honored: when disabled, cfg.contentDbUrl is null and the
      // resolver transparently falls back to the built-in local pgvector store
      // instead of using the (possibly broken/unreachable) saved external DB.
      const cfg = getTopscholarConfig(account);
      return new RagK12ContentResolver({
        contentDbUrl: cfg.contentDbUrl,
        contentDbName: cfg.contentDbName,
        contentDbIndex: cfg.contentDbIndex,
        contentDbCollection: cfg.contentDbCollection,
      });
    }

    if (account?.topscholarApiBaseUrl && account?.topscholarApiToken) {
      console.log(`[K12] Using external TopScholar API for account ${businessAccountId}`);
      return new ExternalK12ContentResolver(account.topscholarApiBaseUrl, account.topscholarApiToken);
    }
  } catch (error) {
    console.error('[K12] Error checking for external API config:', error);
  }

  return internalResolver;
}

export const k12ContentResolver: K12ContentResolver = internalResolver;
