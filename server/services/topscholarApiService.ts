import type { TopicResult, TopicVideoResult, QuestionResult, QuestionOption } from './k12ContentResolver';

interface TopScholarApiConfig {
  baseUrl: string;
  token: string;
}

interface TSLocalizedField {
  en?: string;
  [langCode: string]: string | undefined;
}

interface TSMediaContentItem {
  content?: TSLocalizedField;
  contentType?: string;
}

interface TSMediaDetail {
  content?: TSMediaContentItem[];
  name?: TSLocalizedField;
  mediaDuration?: number;
  tags?: string[];
  id?: string;
}

interface TSQuestionOption {
  name?: TSLocalizedField;
  correctAnswerText?: TSLocalizedField;
  sequenceNumber?: number;
  correct_answer_text?: TSLocalizedField;
  sequence_number?: number;
}

interface TSQuestionDetail {
  name?: TSLocalizedField;
  options?: TSQuestionOption[];
  solutionIndex?: number[];
  solution_index?: number[];
  solutionDescription?: TSLocalizedField;
  solution_description?: TSLocalizedField;
  difficulty?: number;
  marks?: number;
  tags?: string[];
}

interface TSTopicResult {
  name?: string;
  names?: string[];
  subjectName?: string;
  mediaDetails?: TSMediaDetail[];
  questionDetails?: TSQuestionDetail[];
  id?: string;
  questionsCount?: number;
  mediaCount?: number;
}

interface TSApiResponse {
  statusCode?: number;
  message?: string;
  result?: TSTopicResult | TSTopicResult[];
}

function extractTopicsFromResponse(data: TSApiResponse): TSTopicResult[] {
  if (Array.isArray(data.result)) {
    return data.result;
  } else if (data.result && typeof data.result === 'object') {
    return [data.result];
  }
  return [];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractNotesFromMedia(mediaDetails: TSMediaDetail[]): string {
  const notesParts: string[] = [];
  for (const media of mediaDetails) {
    if (!media.content) continue;
    for (const item of media.content) {
      if (item.contentType === 'Notes' && item.content?.en) {
        notesParts.push(stripHtml(item.content.en));
      }
    }
  }
  return notesParts.join('\n\n');
}

function extractVideosFromMedia(mediaDetails: TSMediaDetail[]): TopicVideoResult[] {
  const videos: TopicVideoResult[] = [];
  for (const media of mediaDetails) {
    if (!media.content) continue;
    for (const item of media.content) {
      if (item.contentType === 'Video' && item.content?.en) {
        videos.push({
          title: media.name?.en || 'Video',
          videoUrl: item.content.en,
          transcript: null,
        });
      }
      if (item.contentType === 'NewVideo' && item.content?.en) {
        const vimeoId = item.content.en;
        if (/^\d{5,}$/.test(vimeoId)) {
          videos.push({
            title: media.name?.en || 'Video',
            videoUrl: `https://player.vimeo.com/video/${vimeoId}`,
            transcript: null,
          });
        }
      }
    }
  }
  return videos;
}

function parseTopScholarQuestion(q: TSQuestionDetail, topicName: string): QuestionResult {
  const solutionIndex = q.solutionIndex || q.solution_index || [];
  const options: QuestionOption[] = (q.options || []).map((opt, i) => {
    const seqNum = opt.sequenceNumber || opt.sequence_number || (i + 1);
    const text = opt.name?.en || '';
    return {
      label: String.fromCharCode(64 + seqNum),
      text: stripHtml(text),
      isCorrect: solutionIndex.includes(seqNum),
    };
  });

  const solutionHtml = q.solutionDescription?.en || q.solution_description?.en || null;

  return {
    question: q.name?.en || null,
    type: 'objective',
    options,
    solution: solutionHtml ? stripHtml(solutionHtml) : null,
    difficulty: q.difficulty || null,
    marks: q.marks || null,
    topicName,
  };
}

function convertTopicResult(topic: TSTopicResult): TopicResult {
  const names = topic.names || [];
  const chapterName = names.length >= 2 ? names[names.length - 2] : (names[0] || 'Unknown');
  const subjectName = topic.subjectName || (names.length >= 1 ? names[0] : 'Unknown');
  const topicName = topic.name || (names.length > 0 ? names[names.length - 1] : 'Unknown');

  const mediaDetails = topic.mediaDetails || [];
  const notesText = extractNotesFromMedia(mediaDetails);
  const videos = extractVideosFromMedia(mediaDetails);

  const tags: string[] = [];
  for (const media of mediaDetails) {
    if (media.tags) {
      for (const tag of media.tags) {
        if (!tags.includes(tag)) tags.push(tag);
      }
    }
  }

  return {
    name: topicName,
    description: null,
    revisionNotes: notesText || null,
    notes: notesText ? [{ title: 'Revision Notes', content: notesText }] : [],
    videos,
    tags: tags.length > 0 ? tags : null,
    chapterName,
    subjectName,
  };
}

export class TopScholarApiService {
  private config: TopScholarApiConfig;

  constructor(config: TopScholarApiConfig) {
    this.config = config;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const baseUrl = this.normalizeBaseUrl(this.config.baseUrl);
      const response = await fetch(`${baseUrl}/api/v1/topics?search=test&limit=1`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return { success: true, message: 'Connected successfully to TopScholar API' };
      }

      if (response.status === 401 || response.status === 403) {
        return { success: false, message: 'Authentication failed. Please check your API token.' };
      }

      return { success: false, message: `API returned status ${response.status}` };
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        return { success: false, message: 'Connection timed out. Please check the API URL.' };
      }
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Connection failed: ${errMsg}` };
    }
  }

  async searchTopics(query: string): Promise<{ message: string; results: TopicResult[] }> {
    try {
      const baseUrl = this.normalizeBaseUrl(this.config.baseUrl);
      const encodedQuery = encodeURIComponent(query);
      const response = await fetch(`${baseUrl}/api/v1/topics?search=${encodedQuery}&limit=5`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        console.error(`[TopScholar API] Search topics failed: ${response.status}`);
        return { message: `Failed to fetch topics from external API (status ${response.status})`, results: [] };
      }

      const data: TSApiResponse = await response.json();
      
      const topics = extractTopicsFromResponse(data);

      if (topics.length === 0) {
        return { message: `No topics found matching "${query}" in external content`, results: [] };
      }

      const results = topics.map(t => convertTopicResult(t));
      return { message: `Found ${results.length} topic(s) matching "${query}" from external content`, results };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[TopScholar API] Search topics error:', error);
      return { message: `External API error: ${errMsg}`, results: [] };
    }
  }

  async fetchTopicById(topicId: string): Promise<TopicResult | null> {
    try {
      const baseUrl = this.normalizeBaseUrl(this.config.baseUrl);
      const response = await fetch(`${baseUrl}/api/v1/topics/${topicId}`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) return null;

      const data: TSApiResponse = await response.json();
      const topic = Array.isArray(data.result) ? data.result[0] : data.result;
      if (!topic) return null;

      return convertTopicResult(topic);
    } catch (error: unknown) {
      console.error('[TopScholar API] Fetch topic error:', error);
      return null;
    }
  }

  async searchQuestions(query: string, difficulty?: number): Promise<{ message: string; results: QuestionResult[] }> {
    try {
      const baseUrl = this.normalizeBaseUrl(this.config.baseUrl);
      const encodedQuery = encodeURIComponent(query);
      let url = `${baseUrl}/api/v1/topics?search=${encodedQuery}&limit=3`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        console.error(`[TopScholar API] Search questions failed: ${response.status}`);
        return { message: `Failed to fetch questions from external API (status ${response.status})`, results: [] };
      }

      const data: TSApiResponse = await response.json();
      
      const topics = extractTopicsFromResponse(data);

      const allQuestions: QuestionResult[] = [];
      for (const topic of topics) {
        const topicName = topic.name || 'Unknown';
        const questionDetails = topic.questionDetails || [];
        for (const q of questionDetails) {
          const parsed = parseTopScholarQuestion(q, topicName);
          if (difficulty) {
            if (parsed.difficulty && Math.abs(parsed.difficulty - difficulty) <= 2) {
              allQuestions.push(parsed);
            }
          } else {
            allQuestions.push(parsed);
          }
        }
      }

      if (allQuestions.length === 0) {
        return { message: `No questions found for "${query}" in external content`, results: [] };
      }

      return { message: `Found ${allQuestions.length} question(s) for "${query}" from external content`, results: allQuestions };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[TopScholar API] Search questions error:', error);
      return { message: `External API error: ${errMsg}`, results: [] };
    }
  }
}
