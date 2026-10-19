/**
 * AI Tutor — everything one chapter offers to teach from, gathered from TopScholar's synced
 * content (the same live copy students' answers use): notes, video transcripts, e-book pages,
 * the question bank and the chapter's figures.
 *
 * The model only ever sees short ids — sources c1…, questions q1…, figures m1… — so it can cite
 * and pick, but never invent a source or a URL. The server maps them back.
 */
import crypto from "crypto";
import type { TopscholarConfig } from "../topscholar/config";
import { getChapters, getChunks, type ContentChunkItem } from "../topscholar/contentReader";
import { getMongoChapters, getMongoChunks } from "../topscholar/mongoContentReader";
import { liveVersions } from "../topscholar/contentCounts";
import { readCurriculumMedia } from "../topscholar/mediaMetadata";

export interface PackSource { id: string; type: "note" | "transcript" | "ebook_page"; title: string; concept: string | null; text: string }
export interface PackQuestion {
  id: string;
  text: string;
  options: Array<{ text: string; isCorrect: boolean }>;
  solution: string | null;
  difficulty: string | null;
  concept: string | null;
  questionType: string | null;
}
export interface PackMedia { id: string; src: string; caption: string | null; concept: string | null }
export interface LessonPack {
  businessAccountId: string;
  cpIds: string[];
  chapter: string;
  chapterNorm: string;
  versionKey: string;
  cpIdsHash: string;
  sources: PackSource[];
  questions: PackQuestion[];
  media: PackMedia[];
}

export const normChapter = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const PAGE = 100;
const MAX_PER_TYPE = 400;
const MAX_SOURCE_CHARS = 2400;
const MAX_MEDIA = 30;

export const mediaProxyUrl = (url: string) => `/api/topscholar/media-proxy?url=${encodeURIComponent(url)}`;

type Reader = {
  chapters: (cpId: string) => Promise<Array<{ chapter: string | null }>>;
  chunks: (cpId: string, chapter: string, contentType: string, page: number) => Promise<{ items: ContentChunkItem[]; total: number }>;
};

function readerFor(cfg: TopscholarConfig, businessAccountId: string): Reader {
  if (cfg.storeType === "mongodb") {
    return {
      chapters: (cpId) => getMongoChapters(cfg, businessAccountId, cpId),
      chunks: (cpId, chapter, contentType, page) => getMongoChunks(cfg, businessAccountId, { cpId, chapter, contentType, page, pageSize: PAGE }),
    };
  }
  return {
    chapters: (cpId) => getChapters(cfg, businessAccountId, cpId),
    chunks: (cpId, chapter, contentType, page) => getChunks(cfg, businessAccountId, { cpId, chapter, contentType, page, pageSize: PAGE }),
  };
}

function plain(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Builds the lesson pack for a chapter across the student's content packages (cp_ids). The
 * chapter is matched ignoring case and spacing, because stores differ in exact spelling.
 */
export async function buildLessonPack(input: {
  cfg: TopscholarConfig;
  businessAccountId: string;
  cpIds: string[];
  chapter: string;
  reader?: Reader; // tests
}): Promise<LessonPack> {
  const { cfg, businessAccountId } = input;
  const cpIds = Array.from(new Set(input.cpIds.filter(Boolean))).sort();
  const chapterNorm = normChapter(input.chapter);
  const reader = input.reader ?? readerFor(cfg, businessAccountId);

  const sources: PackSource[] = [];
  const questions: PackQuestion[] = [];
  const media: PackMedia[] = [];
  const seenMedia = new Set<string>();
  let displayChapter = input.chapter.trim();

  const addMedia = (item: ContentChunkItem, concept: string | null) => {
    const found = readCurriculumMedia(item.metadata, item.contentType === "note" ? item.mediaUrl : null, "image", {
      concept, chapter: item.chapter, sourceRef: item.sourceRef,
    });
    for (const m of found) {
      if (m.kind !== "image" || seenMedia.has(m.url) || media.length >= MAX_MEDIA) continue;
      seenMedia.add(m.url);
      media.push({ id: `m${media.length + 1}`, src: mediaProxyUrl(m.url), caption: str(m.caption) || str(m.alt), concept: str(m.concept) ?? concept });
    }
  };

  for (const cpId of cpIds) {
    const chapters = await reader.chapters(cpId);
    const names = Array.from(new Set(chapters.map((c) => c.chapter).filter((c): c is string => !!c && normChapter(c) === chapterNorm)));
    for (const name of names) {
      displayChapter = name;
      for (const type of ["note", "transcript", "ebook_page", "question"] as const) {
        let page = 1, taken = 0;
        while (taken < MAX_PER_TYPE) {
          const { items, total } = await reader.chunks(cpId, name, type, page);
          for (const item of items) {
            const meta = item.metadata || {};
            const concept = str(meta.concept) ?? str(meta.subConcept);
            if (type === "question") {
              const options = Array.isArray(meta.options)
                ? (meta.options as any[]).map((o) => ({ text: plain(String(o?.text ?? "")), isCorrect: o?.isCorrect === true })).filter((o) => o.text)
                : [];
              questions.push({
                id: `q${questions.length + 1}`,
                text: plain(item.contentText).slice(0, 600),
                options,
                solution: str(meta.solution) ? plain(String(meta.solution)).slice(0, 1200) : null,
                difficulty: str(meta.difficulty),
                concept,
                questionType: str(meta.questionType),
              });
            } else {
              const text = plain(item.contentText).slice(0, MAX_SOURCE_CHARS);
              if (text.length >= 20) {
                sources.push({ id: `c${sources.length + 1}`, type, title: plain(item.title || "").replace(/\s*\(part \d+\)$/i, "").slice(0, 120), concept, text });
              }
            }
            addMedia(item, concept);
          }
          taken += items.length;
          if (items.length < PAGE || taken >= total) break;
          page++;
        }
      }
    }
  }

  // Changes when the chapter is resynced (a new live version) or its size changes.
  const live = await liveVersions(businessAccountId, cpIds).catch(() => new Map<string, string | null>());
  const versionKey = crypto.createHash("sha256")
    .update(JSON.stringify([cpIds.map((c) => `${c}:${live.get(c) ?? "-"}`), sources.length, questions.length, media.length]))
    .digest("hex").slice(0, 32);
  const cpIdsHash = crypto.createHash("sha256").update(cpIds.join(",")).digest("hex").slice(0, 32);

  return { businessAccountId, cpIds, chapter: displayChapter, chapterNorm, versionKey, cpIdsHash, sources, questions, media };
}

/** A multiple-choice question the tutor can ask: 2–6 options and exactly one correct answer. */
export function isUsableCheck(q: PackQuestion): boolean {
  return q.options.length >= 2 && q.options.length <= 6 && q.options.filter((o) => o.isCorrect).length === 1 && q.text.length > 5;
}
