/**
 * Structured media provenance for TopScholar curriculum chunks.
 *
 * Media stays in chunk metadata (not inside the embedding vector). That lets every
 * retrieval consumer identify the lesson an asset belongs to before it decides
 * whether the asset is safe to show.
 */

export type CurriculumMediaKind = 'image' | 'video' | 'document' | 'other';

export interface CurriculumMediaMetadata {
  url: string;
  kind: CurriculumMediaKind;
  alt?: string | null;
  caption?: string | null;
  sourceRef?: string | null;
  order?: number;
  topic?: string | null;
  concept?: string | null;
  subConcept?: string | null;
  chapter?: string | null;
  subject?: string | null;
}

export interface CurriculumMediaCandidate extends CurriculumMediaMetadata {
  retrievalRank?: number;
}

export interface MediaContext {
  sourceRef?: string | null;
  topic?: string | null;
  concept?: string | null;
  subConcept?: string | null;
  chapter?: string | null;
  subject?: string | null;
}

const STOP_WORDS = new Set([
  'what', 'is', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'but',
  'how', 'why', 'when', 'where', 'which', 'who', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'can', 'about', 'with', 'from', 'into', 'through', 'give', 'me', 'tell',
  'explain', 'describe', 'define', 'show', 'please', 'help', 'need', 'want', 'know',
  'learn', 'study', 'understand', 'formula', 'definition', 'meaning', 'paper',
]);

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mediaKind(value: unknown, fallback: CurriculumMediaKind): CurriculumMediaKind {
  return value === 'image' || value === 'video' || value === 'document' || value === 'other'
    ? value
    : fallback;
}

export function createMediaMetadata(
  url: string,
  kind: CurriculumMediaKind,
  context: MediaContext,
  order: number,
  extras: Pick<CurriculumMediaMetadata, 'alt' | 'caption'> = {},
): CurriculumMediaMetadata | null {
  if (!isHttpUrl(url)) return null;
  return {
    url: url.trim(),
    kind,
    alt: asText(extras.alt),
    caption: asText(extras.caption),
    sourceRef: asText(context.sourceRef),
    order,
    topic: asText(context.topic),
    concept: asText(context.concept),
    subConcept: asText(context.subConcept),
    chapter: asText(context.chapter),
    subject: asText(context.subject),
  };
}

/**
 * Normalizes both the new metadata.media[] shape and the legacy metadata.images[]
 * / media_url fields into one structured representation.
 */
export function readCurriculumMedia(
  metadata: Record<string, unknown> | null | undefined,
  fallbackMediaUrl: string | null | undefined,
  fallbackKind: CurriculumMediaKind,
  context: MediaContext,
): CurriculumMediaMetadata[] {
  const meta = metadata || {};
  const out: CurriculumMediaMetadata[] = [];
  const seen = new Set<string>();

  const add = (value: unknown, order: number, fallback: CurriculumMediaKind) => {
    const raw = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : { url: value };
    const item = createMediaMetadata(
      String(raw.url || ''),
      mediaKind(raw.kind, fallback),
      {
        sourceRef: asText(raw.sourceRef) ?? context.sourceRef,
        topic: asText(raw.topic) ?? context.topic,
        concept: asText(raw.concept) ?? context.concept,
        subConcept: asText(raw.subConcept) ?? context.subConcept,
        chapter: asText(raw.chapter) ?? context.chapter,
        subject: asText(raw.subject) ?? context.subject,
      },
      typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : order,
      { alt: asText(raw.alt), caption: asText(raw.caption) },
    );
    if (!item || seen.has(item.url)) return;
    seen.add(item.url);
    out.push(item);
  };

  if (Array.isArray(meta.media)) {
    meta.media.forEach((item, index) => add(item, index, fallbackKind));
  }

  // Compatibility for records created before structured metadata existed.
  if (Array.isArray(meta.images)) {
    meta.images.forEach((item, index) => add(item, out.length + index, 'image'));
  }
  if (isHttpUrl(fallbackMediaUrl)) add(fallbackMediaUrl, out.length, fallbackKind);

  return out;
}

function keywords(text: string): string[] {
  return Array.from(new Set(
    text
      .toLowerCase()
      // Keep the same broad Latin/Indic coverage as the voice formatter without
      // the ES2018-only Unicode-property regex flag used elsewhere in the repo.
      .replace(/[^0-9a-z\u00C0-\u0963\u0966-\u1FFF\u2C00-\uD7FF\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  ));
}

function candidateEvidence(candidate: CurriculumMediaCandidate): string {
  return [
    candidate.topic,
    candidate.concept,
    candidate.subConcept,
    candidate.caption,
    candidate.alt,
  ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Returns at most one clearly relevant image. Retrieval rank is only a tie-breaker;
 * an asset still needs explicit topic evidence from the query or completed answer.
 */
export function selectRelevantImages(
  query: string,
  candidates: CurriculumMediaCandidate[],
  answerText = '',
): CurriculumMediaCandidate[] {
  const queryTerms = keywords(query);
  const answerTerms = new Set(keywords(answerText));
  if (queryTerms.length === 0) return [];

  const seen = new Set<string>();
  const scored = candidates
    .filter((candidate) => candidate.kind === 'image' && isHttpUrl(candidate.url))
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .map((candidate) => {
      const evidence = candidateEvidence(candidate);
      const evidenceTerms = new Set(keywords(evidence));
      let score = 0;
      let matches = 0;
      for (const term of queryTerms) {
        // Match whole normalized terms, never arbitrary substrings. For example,
        // "ion" must not make a "concentration" diagram eligible.
        if (evidenceTerms.has(term)) {
          matches++;
          score += 4;
          if (answerTerms.has(term)) score += 1;
        }
      }
      const fullQuery = queryTerms.join(' ');
      if (fullQuery.length >= 5 && evidenceTerms.size > 1 && evidence.includes(fullQuery)) score += 6;
      return { candidate, score, matches };
    })
    .filter(({ score, matches }) => score >= 4 && matches >= 1)
    .sort((a, b) =>
      b.score - a.score ||
      (a.candidate.retrievalRank ?? Number.MAX_SAFE_INTEGER) - (b.candidate.retrievalRank ?? Number.MAX_SAFE_INTEGER),
    );

  if (scored.length === 0) return [];
  const [best, next] = scored;
  // Two unrelated lessons with equally weak lexical evidence are ambiguous. No
  // diagram is safer than pretending the first vector result is authoritative.
  if (next && best.score === next.score && best.matches === next.matches) return [];
  return [best.candidate];
}