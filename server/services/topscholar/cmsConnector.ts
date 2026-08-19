import type { TopscholarConfig } from './config';
import { assertSafeCmsBaseUrl } from './config';
import { getFixturePlans } from './fixtures';

/**
 * Connector for the Toppscholars "Content Bundle" endpoint (plan-and-promo service):
 *
 *   POST {apiBaseUrl}
 *   body: { planIds: string[] }
 *
 * `apiBaseUrl` is the FULL endpoint URL the admin configures — whatever they
 * paste is what gets called, with no path appended. This avoids hardcoding any
 * environment-specific path (preprod uses /plan-and-promo/..., other envs differ).
 *
 * The response returns `result[]` — one entry per plan. Each plan carries its
 * cp_id (the hard partition key), human names (board/grade/medium/cpName) and a
 * nested curriculum tree: chapters -> concepts -> subConcepts -> content
 * (revisionNotes / videoTranscripts / questions / pdfs). Multilingual fields are
 * `{ en: ... }`. We walk the tree and flatten it into one normalized bundle PER
 * cp_id, carrying the chapter/concept/subConcept context onto every item so the
 * downstream chunks are properly labelled.
 *
 * Until an apiBaseUrl is configured, this falls back to local fixtures so the
 * full ingest -> embed -> retrieve pipeline runs against the real shape.
 */

// ---- Raw API shapes (defensive: every field optional) -----------------------

interface RawMultilang {
  en?: string | null;
}

interface RawNoteText {
  content?: RawMultilang | null;
  contentType?: string | null;
}

interface RawRevisionNote {
  contentId?: string | null;
  title?: RawMultilang | null;
  noteText?: RawNoteText[] | null;
}

interface RawVideoTranscript {
  contentId?: string | null;
  videoId?: string | null;
  title?: RawMultilang | null;
  videoUrl?: string | RawNoteText[] | null;
  transcriptText?: string | null;
  duration?: number | string | null;
}

interface RawQuestionOption {
  name?: RawMultilang | null;
  text?: string | null;
  isCorrect?: boolean | null;
}

interface RawQuestion {
  questionId?: string | null;
  id?: string | null;
  questionType?: string | null;
  questionText?: RawMultilang | null;
  difficultyLevel?: number | string | null;
  solutionDescription?: RawMultilang | null;
  solutionIndex?: number[] | number | null;
  options?: RawQuestionOption[] | null;
}

interface RawPdf {
  id?: string | null;
  name?: string | RawMultilang | null;
  url?: string | null;
  imageUrl?: string | null;
}

interface RawContent {
  revisionNotes?: RawRevisionNote[] | null;
  videoTranscripts?: RawVideoTranscript[] | null;
  questions?: RawQuestion[] | null;
  pdfs?: RawPdf[] | null;
  solutions?: unknown[] | null;
  images?: unknown[] | null;
  tables?: unknown[] | null;
}

interface RawSubConcept {
  subConceptId?: string | null;
  subConceptName?: string | RawMultilang | null;
  content?: RawContent | null;
}

interface RawConcept {
  conceptId?: string | null;
  conceptName?: string | RawMultilang | null;
  subConcepts?: RawSubConcept[] | null;
}

interface RawChapter {
  chapterId?: string | null;
  chapterName?: string | RawMultilang | null;
  concepts?: RawConcept[] | null;
}

export interface RawPlan {
  planId?: string | null;
  planName?: string | RawMultilang | null;
  cp_id?: string | null;
  cpId?: string | null;
  cpName?: string | RawMultilang | null;
  boardName?: string | RawMultilang | null;
  gradeName?: string | RawMultilang | null;
  mediumName?: string | RawMultilang | null;
  // Subject is carried at the plan level by the CMS; accept the common field-name
  // variants defensively since the payload shape is not strictly versioned.
  subjectName?: string | RawMultilang | null;
  subject?: string | RawMultilang | null;
  subjectId?: string | number | null;
  subject_id?: string | number | null;
  chapters?: RawChapter[] | null;
}

interface ContentBundleResponse {
  statusCode?: number;
  message?: string;
  isSuccess?: boolean;
  result?: RawPlan[] | null;
}

// ---- Normalized output shapes ----------------------------------------------

export interface ItemContext {
  chapter: string | null;
  concept: string | null;
  subConcept: string | null;
}

export interface NoteItem extends ItemContext {
  contentId: string | null;
  title: string | null;
  html: string;
}

export interface TranscriptItem extends ItemContext {
  contentId: string | null;
  videoId: string | null;
  title: string | null;
  videoUrl: string | null;
  duration: number | null;
  text: string;
}

export interface QuestionItem extends ItemContext {
  id: string | null;
  questionType: string | null;
  question: string;
  options: { text: string; isCorrect: boolean }[];
  solution: string | null;
  difficulty: number | null;
}

export interface PdfItem extends ItemContext {
  id: string | null;
  name: string;
  url: string | null;
  imageUrl: string | null;
}

export interface StandaloneImageItem extends ItemContext {
  id: string | null;
  url: string;
  alt: string | null;
  caption: string | null;
}

export interface CpContentBundle {
  cpId: string;
  planId: string | null; // primary/canonical plan that resolved to this cp_id
  planIds: string[]; // ALL requested plans that resolved to this cp_id (post-merge)
  cpName: string | null;
  board: string | null;
  grade: string | null;
  medium: string | null;
  subjectName: string | null;
  subjectId: string | null;
  notes: NoteItem[];
  transcripts: TranscriptItem[];
  questions: QuestionItem[];
  pdfs: PdfItem[];
  images: StandaloneImageItem[];
  source: 'cms' | 'fixture';
}

// ---- Helpers ---------------------------------------------------------------

function pickStr(v: string | RawMultilang | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  const en = v.en;
  return en && en.trim() ? en.trim() : null;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normalizes an id-like value (string or number) to a trimmed string, or null. */
function pickId(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function noteHtml(note: RawRevisionNote): string {
  const parts = (note.noteText || [])
    .map((nt) => (nt?.content?.en || '').trim())
    .filter((s) => s.length > 0);
  return parts.join('\n');
}

function transcriptVideoUrl(v: RawVideoTranscript['videoUrl']): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.trim() || null;
  for (const entry of v) {
    const u = (entry?.content?.en || '').trim();
    if (u) return u;
  }
  return null;
}

function imageText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object' && typeof (value as { en?: unknown }).en === 'string') {
    return ((value as { en: string }).en || '').trim() || null;
  }
  return null;
}

/** Accept the common CMS image shapes without trusting arbitrary nested fields. */
function standaloneImage(value: unknown): { id: string | null; url: string; alt: string | null; caption: string | null } | null {
  if (typeof value === 'string') {
    const url = value.trim();
    return url ? { id: null, url, alt: null, caption: null } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const url = [raw.url, raw.imageUrl, raw.src, raw.image].map(imageText).find(Boolean);
  if (!url) return null;
  return {
    id: imageText(raw.id) || imageText(raw.imageId),
    url,
    alt: imageText(raw.alt),
    caption: imageText(raw.caption) || imageText(raw.title) || imageText(raw.name),
  };
}

/**
 * Flattens one raw plan into a normalized bundle keyed by cp_id, carrying
 * chapter/concept/subConcept context onto every leaf item.
 */
export function parsePlan(raw: RawPlan, source: 'cms' | 'fixture'): CpContentBundle | null {
  const cpId = (raw.cp_id || raw.cpId || '').trim();
  if (!cpId) return null;

  const planId = pickStr(raw.planId);
  const bundle: CpContentBundle = {
    cpId,
    planId,
    planIds: planId ? [planId] : [],
    cpName: pickStr(raw.cpName),
    board: pickStr(raw.boardName),
    grade: pickStr(raw.gradeName),
    medium: pickStr(raw.mediumName),
    subjectName: pickStr(raw.subjectName ?? raw.subject),
    subjectId: pickId(raw.subjectId ?? raw.subject_id),
    notes: [],
    transcripts: [],
    questions: [],
    pdfs: [],
    images: [],
    source,
  };

  for (const chapter of raw.chapters || []) {
    const chapterName = pickStr(chapter?.chapterName);
    for (const concept of chapter?.concepts || []) {
      const conceptName = pickStr(concept?.conceptName);
      for (const sub of concept?.subConcepts || []) {
        const subConceptName = pickStr(sub?.subConceptName);
        const ctx: ItemContext = { chapter: chapterName, concept: conceptName, subConcept: subConceptName };
        const content = sub?.content;
        if (!content) continue;

        for (const note of content.revisionNotes || []) {
          const html = noteHtml(note);
          if (!html.trim()) continue;
          bundle.notes.push({ ...ctx, contentId: note.contentId || null, title: pickStr(note.title), html });
        }

        for (const t of content.videoTranscripts || []) {
          const text = (t.transcriptText || '').trim();
          if (!text) continue;
          bundle.transcripts.push({
            ...ctx,
            contentId: t.contentId || null,
            videoId: t.videoId || null,
            title: pickStr(t.title),
            videoUrl: transcriptVideoUrl(t.videoUrl),
            duration: toNum(t.duration),
            text,
          });
        }

        for (const q of content.questions || []) {
          const question = pickStr(q.questionText);
          if (!question) continue;
          const options = (q.options || []).map((o) => ({
            text: pickStr(o.name) || (o.text || '').trim(),
            isCorrect: !!o.isCorrect,
          })).filter((o) => o.text.length > 0);
          bundle.questions.push({
            ...ctx,
            id: q.questionId || q.id || null,
            questionType: q.questionType || null,
            question,
            options,
            solution: pickStr(q.solutionDescription),
            difficulty: toNum(q.difficultyLevel),
          });
        }

        for (const p of content.pdfs || []) {
          const name = pickStr(p.name) || 'document';
          const url = (p.url || '').trim() || null;
          const imageUrl = (p.imageUrl || '').trim() || null;
          bundle.pdfs.push({ ...ctx, id: p.id || null, name, url, imageUrl });
        }

        for (const rawImage of content.images || []) {
          const image = standaloneImage(rawImage);
          if (image) bundle.images.push({ ...ctx, ...image });
        }
      }
    }
  }

  return bundle;
}

/** Merge bundles that share a cp_id (two plans can resolve to the same cp_id). */
function mergeByCpId(bundles: CpContentBundle[]): CpContentBundle[] {
  const map = new Map<string, CpContentBundle>();
  for (const b of bundles) {
    const existing = map.get(b.cpId);
    if (!existing) {
      map.set(b.cpId, b);
      continue;
    }
    existing.notes.push(...b.notes);
    existing.transcripts.push(...b.transcripts);
    existing.questions.push(...b.questions);
    existing.pdfs.push(...b.pdfs);
    existing.images.push(...b.images);
    existing.cpName = existing.cpName || b.cpName;
    existing.board = existing.board || b.board;
    existing.grade = existing.grade || b.grade;
    existing.medium = existing.medium || b.medium;
    existing.subjectName = existing.subjectName || b.subjectName;
    existing.subjectId = existing.subjectId || b.subjectId;
    existing.planId = existing.planId || b.planId;
    for (const pid of b.planIds) {
      if (!existing.planIds.includes(pid)) existing.planIds.push(pid);
    }
  }
  return Array.from(map.values());
}

async function fetchContentBundle(cfg: TopscholarConfig, planIds: string[]): Promise<RawPlan[]> {
  // Re-validate the stored URL at fetch time (defense in depth against SSRF).
  assertSafeCmsBaseUrl(cfg.apiBaseUrl!);
  // The configured value is the full endpoint URL — call it as-is (no path appended).
  const url = cfg.apiBaseUrl!.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (cfg.apiToken) headers['Authorization'] = `Bearer ${cfg.apiToken}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ planIds }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    throw new Error(`Content Bundle API returned status ${res.status}`);
  }
  const json = (await res.json()) as ContentBundleResponse;
  return json.result || [];
}

/**
 * Lightweight connectivity probe for the Content Bundle API. Sends a single,
 * minimal POST (one sample Plan ID when supplied, otherwise an empty list) and
 * reports whether the endpoint is reachable and returns the expected envelope.
 * Never throws — always resolves to a {success, message} result for the admin UI.
 */
export async function testContentBundleConnection(
  apiBaseUrl: string,
  apiToken: string | null,
  samplePlanId?: string | null,
): Promise<{ success: boolean; message: string }> {
  let url: string;
  try {
    assertSafeCmsBaseUrl(apiBaseUrl);
    // The configured value is the full endpoint URL — call it as-is (no path appended).
    url = apiBaseUrl.replace(/\/+$/, '');
  } catch (e: any) {
    return { success: false, message: e?.message || 'Invalid API URL.' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;

  const planIds = samplePlanId && samplePlanId.trim() ? [samplePlanId.trim()] : [];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ planIds }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 401 || res.status === 403) {
      return { success: false, message: `Authentication failed (HTTP ${res.status}). Check the API Token.` };
    }
    // The CMS returns a JSON envelope even for validation failures. Parse it
    // once so we can tell a genuine app response from a gateway/proxy error.
    let json: ContentBundleResponse | null = null;
    try {
      json = (await res.json()) as ContentBundleResponse;
    } catch {
      json = null;
    }

    // The CMS validates planIds server-side and replies HTTP 406 with its own
    // envelope ({ isSuccess:false, message:"...planIds..." }) when the list is
    // empty or an ID is malformed (each must be a 24-char ID). Receiving that
    // exact envelope proves the endpoint is reachable, on the right path, and
    // parsing our request — i.e. a successful connectivity check. Only a real
    // Plan ID yields HTTP 200 with content, which this card can't supply alone.
    const validationEnvelope =
      json != null && json.isSuccess === false && typeof json.message === 'string';
    if (res.status === 406 && validationEnvelope) {
      return {
        success: true,
        message: planIds.length > 0
          ? `Connected — the endpoint is reachable, but the sample Plan ID was rejected: ${json!.message}`
          : 'Connected — the Content Bundle API is reachable and responding. Provide a valid Plan ID to test a full content fetch.',
      };
    }

    if (!res.ok) {
      return { success: false, message: `Endpoint reachable but returned HTTP ${res.status}.` };
    }

    if (json == null) {
      return { success: false, message: 'Endpoint reachable but did not return valid JSON.' };
    }

    const planCount = Array.isArray(json.result) ? json.result.length : 0;
    if (planIds.length > 0) {
      return {
        success: true,
        message: planCount > 0
          ? `Connected — sample Plan ID returned ${planCount} plan(s).`
          : 'Connected, but the sample Plan ID returned no plans. The endpoint works; verify the Plan ID.',
      };
    }
    return { success: true, message: 'Connected — the Content Bundle API responded successfully.' };
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError'
      ? 'Connection timed out after 15s.'
      : (e?.message || 'Could not reach the Content Bundle API.');
    return { success: false, message: msg };
  }
}

/**
 * Returns normalized content bundles for the given Plan IDs. Uses the live API
 * when apiBaseUrl is configured, otherwise local fixtures. The result is keyed
 * by cp_id (one bundle per cp_id; plans sharing a cp_id are merged).
 */
export async function getContentBundles(cfg: TopscholarConfig, planIds: string[]): Promise<CpContentBundle[]> {
  const ids = planIds.map((p) => p.trim()).filter(Boolean);
  if (ids.length === 0) return [];

  const source: 'cms' | 'fixture' = cfg.apiBaseUrl ? 'cms' : 'fixture';
  const rawPlans = cfg.apiBaseUrl ? await fetchContentBundle(cfg, ids) : getFixturePlans(ids);

  const parsed: CpContentBundle[] = [];
  for (const raw of rawPlans) {
    const bundle = parsePlan(raw, source);
    if (bundle) parsed.push(bundle);
  }
  return mergeByCpId(parsed);
}
