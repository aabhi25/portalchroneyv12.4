import crypto from 'crypto';
import { db } from '../../db';
import { topscholarContentSync, topscholarEmbedJobs, topscholarEmbedStaging, topscholarCpMappings, topscholarPlanIds, topscholarPlanCpResolutions } from '@shared/schema';
import { and, eq, ne, inArray } from 'drizzle-orm';
import { embeddingService } from '../embeddingService';
import { getContentBundles, type CpContentBundle } from './cmsConnector';
import { htmlToText, chunkText } from './htmlContent';
import { replaceCpChunks, deleteCpChunks, appendCpChunks, type StoreChunk } from './chunkStore';
import { submitEmbeddingBatches, cancelBatch } from './embeddingBatchService';
import { withCpLock } from './cpLock';
import type { TopscholarConfig } from './config';
import { createMediaMetadata } from './mediaMetadata';

interface ChunkRecord {
  board?: string | null;
  medium?: string | null;
  grade?: string | null;
  contentType: 'note' | 'transcript' | 'ebook_page' | 'question';
  subject: string | null;
  subjectId: string | null;
  chapter: string | null;
  title: string | null;
  contentHtml: string | null;
  contentText: string;
  sourceRef: string | null;
  mediaUrl: string | null;
  metadata: Record<string, unknown>;
}

export interface IngestResult {
  cpId: string;
  source: 'cms' | 'fixture';
  mode: 'sample' | 'full';
  storeType: 'pgvector' | 'mongodb';
  // For sample: chunks actually written now. For full: chunks queued to the Batch API.
  chunkCount: number;
  noteCount: number;
  transcriptCount: number;
  ebookPageCount: number;
  questionCount: number;
  mediaCount: number;
  jobId?: string; // present for full (async) sync
  batchCount?: number; // number of OpenAI batches submitted (full sync)
  async?: boolean; // true when the full sync is still running in the background (direct-to-client-DB path, no Batch job)
  cancelled?: boolean; // direct client-store work observed a cancellation at a page boundary
}

export const DEFAULT_SAMPLE_LIMIT = 50;

function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

async function upsertSync(
  businessAccountId: string,
  cpId: string,
  patch: Partial<typeof topscholarContentSync.$inferInsert>,
  // When true, the update is skipped if the row was meanwhile set to 'cancelled' by the
  // cancel endpoint. Use for every write AFTER a run starts so a mid-run cancel sticks and
  // is never silently resurrected. The run-initiating 'syncing' write stays unguarded so a
  // fresh sync can legitimately restart a previously-cancelled cp_id.
  guardNotCancelled = false,
): Promise<void> {
  const existing = await db
    .select({ id: topscholarContentSync.id })
    .from(topscholarContentSync)
    .where(and(eq(topscholarContentSync.businessAccountId, businessAccountId), eq(topscholarContentSync.cpId, cpId)));

  if (existing.length > 0) {
    const where = guardNotCancelled
      ? and(
          eq(topscholarContentSync.businessAccountId, businessAccountId),
          eq(topscholarContentSync.cpId, cpId),
          ne(topscholarContentSync.status, 'cancelled'),
        )
      : and(eq(topscholarContentSync.businessAccountId, businessAccountId), eq(topscholarContentSync.cpId, cpId));
    await db
      .update(topscholarContentSync)
      .set({ ...patch, updatedAt: new Date() })
      .where(where);
  } else {
    await db.insert(topscholarContentSync).values({ businessAccountId, cpId, ...patch });
  }
}

/** Subject label for a chunk: prefer the CMS-provided subject name, then cpName,
 * else board · grade · medium. */
function subjectLabel(bundle: CpContentBundle): string | null {
  if (bundle.subjectName) return bundle.subjectName;
  if (bundle.cpName) return bundle.cpName;
  const parts = [bundle.board, bundle.grade, bundle.medium].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** Normalizes a content bundle into flat embeddable chunk records, carrying the
 * chapter/concept/subConcept hierarchy onto every chunk for proper labelling. */
function buildRecords(bundle: CpContentBundle): ChunkRecord[] {
  const records: ChunkRecord[] = [];
  const subject = subjectLabel(bundle);
  const subjectId = bundle.subjectId;

  // Revision notes (HTML + MathML) -> linearized text, chunked.
  for (const note of bundle.notes) {
    const { text, images, imageDetails } = htmlToText(note.html);
    if (!text) continue;
    const baseTitle = note.title || note.subConcept || note.concept || 'Revision Notes';
    const pieces = chunkText(text);
    const media = imageDetails
      .map((image, order) => createMediaMetadata(image.url, 'image', {
        sourceRef: note.contentId,
        topic: baseTitle,
        concept: note.concept,
        subConcept: note.subConcept,
        chapter: note.chapter,
        subject,
      }, order, { alt: image.alt, caption: note.subConcept || note.concept || baseTitle }))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    pieces.forEach((piece, idx) => {
      records.push({
        contentType: 'note',
        subject,
        subjectId,
        chapter: note.chapter,
        title: pieces.length > 1 ? `${baseTitle} (part ${idx + 1})` : baseTitle,
        contentHtml: idx === 0 ? note.html : null,
        contentText: piece,
        sourceRef: note.contentId,
        mediaUrl: images[0] || null,
        metadata: { concept: note.concept, subConcept: note.subConcept, images, media },
      });
    });
  }

  // Video transcripts.
  for (const transcript of bundle.transcripts) {
    const baseTitle = transcript.title || transcript.subConcept || 'Video Transcript';
    const pieces = chunkText(transcript.text);
    pieces.forEach((piece, idx) => {
      records.push({
        contentType: 'transcript',
        subject,
        subjectId,
        chapter: transcript.chapter,
        title: pieces.length > 1 ? `${baseTitle} (part ${idx + 1})` : baseTitle,
        contentHtml: null,
        contentText: piece,
        sourceRef: transcript.contentId || transcript.videoId,
        mediaUrl: transcript.videoUrl,
        metadata: {
          concept: transcript.concept,
          subConcept: transcript.subConcept,
          videoId: transcript.videoId,
          duration: transcript.duration,
          media: [
            createMediaMetadata(transcript.videoUrl || '', 'video', {
              sourceRef: transcript.contentId || transcript.videoId,
              topic: baseTitle,
              concept: transcript.concept,
              subConcept: transcript.subConcept,
              chapter: transcript.chapter,
              subject,
            }, 0, { caption: baseTitle }),
          ].filter((item): item is NonNullable<typeof item> => item !== null),
        },
      });
    });
  }

  // PDFs / ebook pages — store the document name for discovery + its URL.
  for (const pdf of bundle.pdfs) {
    records.push({
      contentType: 'ebook_page',
      subject,
      subjectId,
      chapter: pdf.chapter,
      title: pdf.name,
      contentHtml: null,
      contentText: pdf.name,
      sourceRef: pdf.id,
      mediaUrl: pdf.url,
      metadata: {
        concept: pdf.concept,
        subConcept: pdf.subConcept,
        media: [
          createMediaMetadata(pdf.url || '', 'document', {
            sourceRef: pdf.id,
            topic: pdf.name,
            concept: pdf.concept,
            subConcept: pdf.subConcept,
            chapter: pdf.chapter,
            subject,
          }, 0, { caption: pdf.name }),
          createMediaMetadata(pdf.imageUrl || '', 'image', {
            sourceRef: pdf.id,
            topic: pdf.name,
            concept: pdf.concept,
            subConcept: pdf.subConcept,
            chapter: pdf.chapter,
            subject,
          }, 1, { caption: pdf.name }),
        ].filter((item): item is NonNullable<typeof item> => item !== null),
      },
    });
  }

  // Questions.
  for (const q of bundle.questions) {
    records.push({
      contentType: 'question',
      subject,
      subjectId,
      chapter: q.chapter,
      title: q.subConcept || q.concept || null,
      contentHtml: null,
      contentText: q.question,
      sourceRef: q.id,
      mediaUrl: null,
      metadata: {
        concept: q.concept,
        subConcept: q.subConcept,
        questionType: q.questionType,
        options: q.options,
        solution: q.solution,
        difficulty: q.difficulty,
      },
    });
  }

  // Some CMS payloads keep illustrations beside a sub-concept instead of inside
  // the note HTML. Attach those to every text chunk from the same lesson; when
  // there is no text source at all, make a small source-bound chunk so the image
  // remains retrievable and never gets assigned to a neighbouring lesson.
  for (const image of bundle.images) {
    const topic = image.caption || image.alt || image.subConcept || image.concept || 'Curriculum image';
    const media = createMediaMetadata(image.url, 'image', {
      sourceRef: image.id,
      topic,
      concept: image.concept,
      subConcept: image.subConcept,
      chapter: image.chapter,
      subject,
    }, 0, { alt: image.alt, caption: image.caption || topic });
    if (!media) continue;
    const sameLesson = records.filter((record) =>
      record.chapter === image.chapter &&
      record.metadata.concept === image.concept &&
      record.metadata.subConcept === image.subConcept,
    );
    if (sameLesson.length > 0) {
      for (const record of sameLesson) {
        const existingMedia = Array.isArray(record.metadata.media) ? record.metadata.media : [];
        const existingImages = Array.isArray(record.metadata.images) ? record.metadata.images : [];
        record.metadata = {
          ...record.metadata,
          images: Array.from(new Set([...existingImages, image.url])),
          media: [...existingMedia, media],
        };
      }
      continue;
    }
    records.push({
      contentType: 'note',
      subject,
      subjectId,
      chapter: image.chapter,
      title: topic,
      contentHtml: null,
      contentText: topic,
      sourceRef: image.id,
      mediaUrl: image.url,
      metadata: {
        concept: image.concept,
        subConcept: image.subConcept,
        images: [image.url],
        media: [media],
      },
    });
  }

  const curriculumScope = {
    board: bundle.board,
    medium: bundle.medium,
    grade: bundle.grade,
  };
  return records.map((record) => ({
    ...record,
    board: bundle.board,
    medium: bundle.medium,
    grade: bundle.grade,
    // Batch embedding jobs retain this in their app-side staging metadata so the
    // later landing worker can write the same complete scope into the client store.
    metadata: { ...record.metadata, curriculumScope },
  }));
}

function countByType(records: ChunkRecord[]) {
  return {
    noteCount: records.filter((r) => r.contentType === 'note').length,
    transcriptCount: records.filter((r) => r.contentType === 'transcript').length,
    ebookPageCount: records.filter((r) => r.contentType === 'ebook_page').length,
    questionCount: records.filter((r) => r.contentType === 'question').length,
    mediaCount: records.filter((r) => !!r.mediaUrl).length,
  };
}

/**
 * Ingest a single already-fetched content bundle (one cp_id).
 *
 * mode='sample': embed the first N chunks via the regular (synchronous) embeddings
 *   API and write them immediately. Used to validate the whole pipeline in seconds.
 *
 * mode='full': stage ALL chunks and submit them to the OpenAI Batch API (~50% cheaper,
 *   up to 24h). Returns immediately with a job id; a background poller writes the
 *   embeddings to the store when the batch completes (survives restarts).
 */
async function ingestBundle(
  businessAccountId: string,
  cfg: TopscholarConfig,
  bundle: CpContentBundle,
  mode: 'sample' | 'full',
  sampleLimit: number,
  options: { awaitDirect?: boolean; isCancelled?: () => Promise<boolean> } = {},
): Promise<IngestResult> {
  const cpId = bundle.cpId;

  if (await options.isCancelled?.()) {
    return {
      cpId, source: bundle.source, mode, storeType: cfg.storeType,
      chunkCount: 0, noteCount: 0, transcriptCount: 0, ebookPageCount: 0, questionCount: 0, mediaCount: 0,
      cancelled: true,
    };
  }

  await upsertSync(businessAccountId, cpId, {
    status: 'syncing',
    syncMode: mode,
    storeType: cfg.storeType,
    processedCount: 0,
    lastError: null,
    embedJobId: null,
  });

  try {
    let records = buildRecords(bundle);

    if (mode === 'sample') {
      records = records.slice(0, sampleLimit);
    }

    const counts = countByType(records);

    if (records.length === 0) {
      await upsertSync(businessAccountId, cpId, {
        status: 'completed',
        chunkCount: 0,
        totalCount: 0,
        processedCount: 0,
        ...counts,
        lastError: null,
        lastSyncedAt: new Date(),
        embedJobId: null,
      }, true);
      // Clear the store so a now-empty cp_id doesn't keep stale chunks.
      await replaceCpChunks(cfg, businessAccountId, cpId, []);
      return {
        cpId, source: bundle.source, mode, storeType: cfg.storeType,
        chunkCount: 0, ...counts,
      };
    }

    if (mode === 'sample') {
      return ingestSampleSync(businessAccountId, cpId, cfg, bundle.source, records, counts);
    }
    // FULL sync routing:
    //  - External client DB configured (cfg.contentDbUrl truthy): embed SYNCHRONOUSLY and
    //    write straight to the client's DB in pages, so curriculum text NEVER lands in our
    //    Batch-API staging table. This is the client-data-isolation guarantee.
    //  - Blank URL (local pgvector stand-in): keep the cheaper OpenAI Batch-API path, which
    //    stages in our DB (acceptable — the local store IS our DB).
    if (cfg.contentDbUrl) {
      return ingestFullDirect(
        businessAccountId,
        cpId,
        cfg,
        bundle.source,
        records,
        counts,
        !!options.awaitDirect,
        options.isCancelled,
      );
    }
    return ingestFullBatch(businessAccountId, cpId, cfg, bundle.source, records, counts);
  } catch (error: any) {
    await upsertSync(businessAccountId, cpId, {
      status: 'failed',
      lastError: error?.message || String(error),
      embedJobId: null,
    }, true);
    throw error;
  }
}

/** Auto-upsert a cp_id -> board/grade/medium mapping from the API response, so
 * admins never have to hand-maintain the mapping CSV for plan-driven content. */
async function upsertMappingFromBundle(businessAccountId: string, bundle: CpContentBundle): Promise<void> {
  const label = curriculumLabel(bundle);
  const existing = await db
    .select({ id: topscholarCpMappings.id })
    .from(topscholarCpMappings)
    .where(and(eq(topscholarCpMappings.businessAccountId, businessAccountId), eq(topscholarCpMappings.cpId, bundle.cpId)));

  const values = {
    board: bundle.board,
    medium: bundle.medium,
    grade: bundle.grade,
    subject: bundle.subjectName,
    subjectId: bundle.subjectId,
    label,
    cpName: bundle.cpName,
    planId: bundle.planId,
  };

  if (existing.length > 0) {
    await db
      .update(topscholarCpMappings)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(topscholarCpMappings.businessAccountId, businessAccountId), eq(topscholarCpMappings.cpId, bundle.cpId)));
  } else {
    await db.insert(topscholarCpMappings).values({ businessAccountId, cpId: bundle.cpId, ...values });
  }
}

/** Update a saved Plan ID row's status (no-op if the plan isn't in the master list). */
async function updatePlanStatus(
  businessAccountId: string,
  planId: string,
  patch: Partial<typeof topscholarPlanIds.$inferInsert>,
): Promise<void> {
  await db
    .update(topscholarPlanIds)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(topscholarPlanIds.businessAccountId, businessAccountId), eq(topscholarPlanIds.planId, planId)));
}

export interface PlanSyncResult {
  planId: string;
  cpId: string | null;
  status: 'completed' | 'syncing' | 'empty' | 'failed';
  result?: IngestResult;
  error?: string;
}

/**
 * Plan-driven ingestion: fetch the Content Bundle API for a set of Plan IDs
 * (batched), split each plan by cp_id, auto-upsert its mapping, then embed +
 * store. One API call returns multiple cp_ids; we ingest each independently so a
 * failure in one doesn't abort the rest. Also keeps the saved Plan ID master
 * list's per-plan status in sync.
 */
export async function ingestPlanIds(params: {
  businessAccountId: string;
  planIds: string[];
  cfg: TopscholarConfig;
  mode?: 'sample' | 'full';
  sampleLimit?: number;
  batchSize?: number;
}): Promise<PlanSyncResult[]> {
  const { businessAccountId, cfg } = params;
  const mode = params.mode || 'full';
  const sampleLimit = params.sampleLimit && params.sampleLimit > 0 ? params.sampleLimit : DEFAULT_SAMPLE_LIMIT;
  const batchSize = params.batchSize && params.batchSize > 0 ? params.batchSize : 10;

  const planIds = Array.from(new Set(params.planIds.map((p) => p.trim()).filter(Boolean)));
  if (planIds.length === 0) return [];

  // Mark all as syncing up front for immediate UI feedback.
  await Promise.all(planIds.map((pid) => updatePlanStatus(businessAccountId, pid, { lastStatus: 'syncing', lastError: null })));

  const out: PlanSyncResult[] = [];

  for (let i = 0; i < planIds.length; i += batchSize) {
    const batch = planIds.slice(i, i + batchSize);
    const resolved = new Set<string>();

    let bundles: CpContentBundle[];
    try {
      bundles = await getContentBundles(cfg, batch);
    } catch (error: any) {
      const msg = error?.message || String(error);
      for (const pid of batch) {
        await updatePlanStatus(businessAccountId, pid, { lastStatus: 'failed', lastError: msg });
        out.push({ planId: pid, cpId: null, status: 'failed', error: msg });
      }
      continue;
    }

    for (const bundle of bundles) {
      // A single cp_id can be reached by several requested plans (merged). Account
      // for EVERY requested plan that resolved to this cp_id, not just one.
      const pids = bundle.planIds.filter((p) => batch.includes(p));
      for (const pid of pids) resolved.add(pid);
      const reportId = pids[0] || bundle.cpId;
      try {
        await upsertMappingFromBundle(businessAccountId, bundle);
        const result = await ingestBundle(businessAccountId, cfg, bundle, mode, sampleLimit);
        // A full sync is still in progress when it has either a Batch job (Batch path) or is
        // running in the background (direct-to-client-DB path) — report 'syncing' for both so
        // the plan row isn't prematurely marked done while embeddings are still landing.
        const status: PlanSyncResult['status'] = mode === 'full' && (result.jobId || result.async) ? 'syncing' : 'completed';
        for (const pid of pids) {
          await updatePlanStatus(businessAccountId, pid, {
            lastStatus: status,
            lastError: null,
            lastCpId: bundle.cpId,
            lastCpName: bundle.cpName,
            lastSyncedAt: new Date(),
          });
        }
        out.push({ planId: reportId, cpId: bundle.cpId, status, result });
      } catch (error: any) {
        const msg = error?.message || String(error);
        for (const pid of pids) {
          await updatePlanStatus(businessAccountId, pid, { lastStatus: 'failed', lastError: msg, lastCpId: bundle.cpId });
        }
        out.push({ planId: reportId, cpId: bundle.cpId, status: 'failed', error: msg });
      }
    }

    // Requested plans that returned no bundle at all.
    for (const pid of batch) {
      if (resolved.has(pid)) continue;
      await updatePlanStatus(businessAccountId, pid, { lastStatus: 'empty', lastError: 'No content returned for this Plan ID.', lastSyncedAt: new Date() });
      out.push({ planId: pid, cpId: null, status: 'empty', error: 'No content returned for this Plan ID.' });
    }
  }

  return out;
}

export interface ResolvedCp {
  cpId: string;
  cpName: string | null;
  board: string | null;
  grade: string | null;
  medium: string | null;
  subject: string | null;
  subjectId: string | null;
  label: string | null;
  noteCount: number;
  transcriptCount: number;
  questionCount: number;
  pdfCount: number;
}

/**
 * Uniform curriculum display label for a content package. Prefers the CMS subject
 * name so every package reads the same way (grade · board · subject), falling back
 * to the CMS cpName, then grade · board · medium when no subject is available.
 * Shared by the resolve/mapping writers and the read-path label builders so the
 * Content Sync list and status table render identically.
 */
export function curriculumLabel(r: {
  subjectName?: string | null;
  subject?: string | null;
  cpName?: string | null;
  board?: string | null;
  grade?: string | null;
  medium?: string | null;
}): string | null {
  const subject = r.subjectName ?? r.subject ?? null;
  if (subject) return [r.grade, r.board, subject].filter(Boolean).join(' · ') || null;
  if (r.cpName) return r.cpName;
  return [r.grade, r.board, r.medium].filter(Boolean).join(' · ') || null;
}

export interface PlanResolution {
  planId: string;
  cps: ResolvedCp[];
  error?: string;
}

/**
 * Fetch-only resolve: calls the Content Bundle API for the given Plan IDs and
 * returns every cp_id found under each requested plan (with a content-count
 * snapshot and curriculum label), WITHOUT embedding anything. As a side effect
 * it refreshes the persisted plan->cp resolution rows and the cp->label mappings
 * so the admin UI can re-render from the DB without re-fetching. One Content
 * Bundle call returns multiple cp_ids; a cp_id reached by several requested plans
 * is reported under each.
 */
export async function resolvePlans(params: {
  businessAccountId: string;
  planIds: string[];
  cfg: TopscholarConfig;
}): Promise<PlanResolution[]> {
  const { businessAccountId, cfg } = params;
  const planIds = Array.from(new Set(params.planIds.map((p) => p.trim()).filter(Boolean)));
  if (planIds.length === 0) return [];

  let bundles: CpContentBundle[];
  try {
    bundles = await getContentBundles(cfg, planIds);
  } catch (error: any) {
    const msg = error?.message || String(error);
    return planIds.map((planId) => ({ planId, cps: [], error: msg }));
  }

  const now = new Date();
  const byPlan = new Map<string, ResolvedCp[]>();
  for (const pid of planIds) byPlan.set(pid, []);

  // Build the (plan, cp) rows to persist, deduping the owning plans per bundle so
  // a single resolve call never tries to insert the same (account, plan, cp) twice.
  const rows: Array<{ planId: string; resolved: ResolvedCp }> = [];
  for (const bundle of bundles) {
    await upsertMappingFromBundle(businessAccountId, bundle);
    const label = curriculumLabel(bundle);
    const resolved: ResolvedCp = {
      cpId: bundle.cpId,
      cpName: bundle.cpName,
      board: bundle.board,
      grade: bundle.grade,
      medium: bundle.medium,
      subject: bundle.subjectName,
      subjectId: bundle.subjectId,
      label,
      noteCount: bundle.notes.length,
      transcriptCount: bundle.transcripts.length,
      questionCount: bundle.questions.length,
      pdfCount: bundle.pdfs.length,
    };
    const owningPlans = Array.from(new Set(bundle.planIds.filter((p) => planIds.includes(p))));
    for (const pid of owningPlans) {
      byPlan.get(pid)!.push(resolved);
      rows.push({ planId: pid, resolved });
    }
  }

  // Refresh atomically: drop prior resolution rows for the requested plans and
  // re-insert the freshly fetched set in one transaction so readers never observe
  // a partial snapshot. Upsert on the unique (account, plan, cp) index guards
  // against concurrent resolves racing on the same plan.
  await db.transaction(async (tx) => {
    await tx
      .delete(topscholarPlanCpResolutions)
      .where(and(
        eq(topscholarPlanCpResolutions.businessAccountId, businessAccountId),
        inArray(topscholarPlanCpResolutions.planId, planIds),
      ));
    for (const { planId, resolved } of rows) {
      await tx
        .insert(topscholarPlanCpResolutions)
        .values({
          businessAccountId,
          planId,
          cpId: resolved.cpId,
          cpName: resolved.cpName,
          board: resolved.board,
          grade: resolved.grade,
          medium: resolved.medium,
          subject: resolved.subject,
          subjectId: resolved.subjectId,
          label: resolved.label,
          noteCount: resolved.noteCount,
          transcriptCount: resolved.transcriptCount,
          questionCount: resolved.questionCount,
          pdfCount: resolved.pdfCount,
          lastResolvedAt: now,
        })
        .onConflictDoUpdate({
          target: [topscholarPlanCpResolutions.businessAccountId, topscholarPlanCpResolutions.planId, topscholarPlanCpResolutions.cpId],
          set: {
            cpName: resolved.cpName,
            board: resolved.board,
            grade: resolved.grade,
            medium: resolved.medium,
            subject: resolved.subject,
            subjectId: resolved.subjectId,
            label: resolved.label,
            noteCount: resolved.noteCount,
            transcriptCount: resolved.transcriptCount,
            questionCount: resolved.questionCount,
            pdfCount: resolved.pdfCount,
            lastResolvedAt: now,
            updatedAt: now,
          },
        });
    }
  });

  return planIds.map((planId) => {
    const cps = byPlan.get(planId)!;
    return { planId, cps, error: cps.length === 0 ? 'No content returned for this Plan ID.' : undefined };
  });
}

/**
 * Sync exactly one cp_id (sample or full): fetch its owning plan's bundles,
 * select only the matching cp_id's bundle, and run it through the existing
 * ingest path so only that cp_id's content is embedded — not the whole plan.
 */
export async function ingestSingleCp(params: {
  businessAccountId: string;
  cpId: string;
  planId: string;
  cfg: TopscholarConfig;
  mode?: 'sample' | 'full';
  sampleLimit?: number;
  // Plan-run workers await direct client-store work so one Plan never creates a
  // fire-and-forget worker per CP ID. The targeted admin button remains async.
  awaitDirect?: boolean;
  // Durable Plan-run cancellation token. It is checked before the direct path
  // creates/revives a sync row and at every page boundary.
  isCancelled?: () => Promise<boolean>;
}): Promise<IngestResult> {
  const { businessAccountId, cpId, planId, cfg } = params;
  const mode = params.mode || 'full';
  const sampleLimit = params.sampleLimit && params.sampleLimit > 0 ? params.sampleLimit : DEFAULT_SAMPLE_LIMIT;

  const bundles = await getContentBundles(cfg, [planId]);
  const bundle = bundles.find((b) => b.cpId === cpId);
  if (!bundle) {
    throw new Error(`cp_id ${cpId} was not found under Plan ID ${planId}. Re-resolve the plan and try again.`);
  }

  await upsertMappingFromBundle(businessAccountId, bundle);
  return ingestBundle(businessAccountId, cfg, bundle, mode, sampleLimit, {
    awaitDirect: !!params.awaitDirect,
    isCancelled: params.isCancelled,
  });
}

/** SAMPLE: synchronous embeddings + immediate store write. */
async function ingestSampleSync(
  businessAccountId: string,
  cpId: string,
  cfg: TopscholarConfig,
  source: 'cms' | 'fixture',
  records: ChunkRecord[],
  counts: ReturnType<typeof countByType>,
): Promise<IngestResult> {
  const embeddings = await embeddingService.generateBatchEmbeddings(
    records.map((r) => r.contentText),
    businessAccountId,
  );

  const chunks: StoreChunk[] = records.map((r, i) => ({
    board: r.board ?? null,
    medium: r.medium ?? null,
    grade: r.grade ?? null,
    contentType: r.contentType,
    subject: r.subject,
    subjectId: r.subjectId,
    chapter: r.chapter,
    title: r.title,
    contentHtml: r.contentHtml,
    contentText: r.contentText,
    sourceRef: r.sourceRef,
    mediaUrl: r.mediaUrl,
    metadata: r.metadata,
    contentHash: hashContent(r.contentText),
    embedding: embeddings[i] || [],
  }));

  const written = await replaceCpChunks(cfg, businessAccountId, cpId, chunks);

  await upsertSync(businessAccountId, cpId, {
    status: 'completed',
    chunkCount: written,
    totalCount: records.length,
    processedCount: written,
    ...counts,
    lastError: null,
    lastSyncedAt: new Date(),
    embedJobId: null,
  }, true);

  return {
    cpId, source, mode: 'sample', storeType: cfg.storeType,
    chunkCount: written, ...counts,
  };
}

/** FULL: stage all chunks, submit to the OpenAI Batch API, return a job id. */
async function ingestFullBatch(
  businessAccountId: string,
  cpId: string,
  cfg: TopscholarConfig,
  source: 'cms' | 'fixture',
  records: ChunkRecord[],
  counts: ReturnType<typeof countByType>,
): Promise<IngestResult> {
  // SERIALIZE the replace against any in-flight LANDING for this cp_id (see cpLock.ts).
  // Holding the lock while we delete the prior job (which cascade-deletes its staging) and
  // stage the new run guarantees we never yank staging out from under a poller that is mid
  // landing — which would otherwise let a stale landing wipe content. The poller's
  // completeJob takes the same lock, so the two are strictly mutually exclusive per cp_id.
  const jobId = await withCpLock(businessAccountId, cpId, async () => {
    // Cancel/replace any prior in-flight job for this cp_id so we never run two at once.
    await db
      .delete(topscholarEmbedJobs)
      .where(and(eq(topscholarEmbedJobs.businessAccountId, businessAccountId), eq(topscholarEmbedJobs.cpId, cpId)));

    // 1. Create the job row (preparing).
    const [job] = await db
      .insert(topscholarEmbedJobs)
      .values({
        businessAccountId,
        cpId,
        status: 'preparing',
        storeType: cfg.storeType,
        syncMode: 'full',
        totalCount: records.length,
      })
      .returning({ id: topscholarEmbedJobs.id });

    const newJobId = job.id;

    // 2. Stage every record with a stable custom_id so we can join embeddings back later.
    const stagingRows = records.map((r, idx) => ({
      jobId: newJobId,
      customId: `${newJobId}__${idx}`,
      businessAccountId,
      cpId,
      contentType: r.contentType,
      subject: r.subject,
      subjectId: r.subjectId,
      chapter: r.chapter,
      title: r.title,
      contentHtml: r.contentHtml,
      contentText: r.contentText,
      sourceRef: r.sourceRef,
      mediaUrl: r.mediaUrl,
      metadata: r.metadata,
      contentHash: hashContent(r.contentText),
    }));

    const STAGE_BATCH = 1000;
    for (let i = 0; i < stagingRows.length; i += STAGE_BATCH) {
      await db.insert(topscholarEmbedStaging).values(stagingRows.slice(i, i + STAGE_BATCH));
    }
    return newJobId;
  });

  // 3. Submit to the Batch API (split into <=40k-request batches).
  const submitted = await submitEmbeddingBatches(
    businessAccountId,
    records.map((r, idx) => ({ customId: `${jobId}__${idx}`, text: r.contentText })),
  );

  // Only flip the job to 'submitted' if it wasn't cancelled during the submission window.
  // The cancel endpoint sets the job to 'cancelled' (and deletes its staging); if that
  // happened while we were submitting, this update no-ops and we cancel the just-submitted
  // OpenAI batches so they don't keep running (and billing) for a sync nobody wants.
  const advanced = await db
    .update(topscholarEmbedJobs)
    .set({
      status: 'submitted',
      batches: submitted.map((b) => ({
        batchId: b.batchId,
        inputFileId: b.inputFileId,
        outputFileId: null,
        status: 'validating',
        count: b.count,
      })),
      updatedAt: new Date(),
    })
    .where(and(eq(topscholarEmbedJobs.id, jobId), ne(topscholarEmbedJobs.status, 'cancelled')))
    .returning({ id: topscholarEmbedJobs.id });

  if (advanced.length === 0) {
    // Cancelled mid-submission — best-effort cancel the batches we just created.
    await Promise.allSettled(submitted.map((b) => cancelBatch(businessAccountId, b.batchId)));
    return {
      cpId, source, mode: 'full', storeType: cfg.storeType,
      chunkCount: records.length, ...counts,
      jobId, batchCount: submitted.length,
    };
  }

  await upsertSync(businessAccountId, cpId, {
    status: 'syncing',
    syncMode: 'full',
    storeType: cfg.storeType,
    chunkCount: 0,
    totalCount: records.length,
    processedCount: 0,
    ...counts,
    lastError: null,
    embedJobId: jobId,
  }, true);

  return {
    cpId, source, mode: 'full', storeType: cfg.storeType,
    chunkCount: records.length, ...counts,
    jobId, batchCount: submitted.length,
  };
}

// Page size for the direct (client-DB) full sync: embed + write this many chunks at a
// time so a huge cp_id is never fully resident in memory as embeddings, and progress
// advances incrementally.
const DIRECT_SYNC_PAGE = 100;

/**
 * FULL sync, direct to the client's content DB (used when an external Content DB URL is
 * configured). Unlike the Batch-API path, this NEVER stages curriculum text in our
 * database — it embeds synchronously and writes straight to the client's store in pages.
 * This is the client-data-isolation guarantee: when their DB is configured, content +
 * embeddings live ONLY there, never in ours, not even transiently.
 *
 * It runs in the BACKGROUND (the caller is not blocked) so a large curriculum can't time
 * out the HTTP request. Progress + terminal state are tracked on the topscholarContentSync
 * row, which the admin UI polls — exactly like the Batch path.
 *
 * Serialization: the whole run holds the per-cp advisory lock (see cpLock.ts), so it can
 * never interleave with another sync or a delete for the same cp_id. Like the Batch
 * poller's landing, holding the lock means a concurrent cancel/delete waits until the run
 * releases it.
 *
 * Lazy delete (NOT atomic replace): prior chunks are dropped only right before the FIRST
 * confirmed append. So a failure BEFORE the first page lands leaves the existing content
 * fully intact; a failure AFTER it leaves old content gone + the new content partial. We
 * accept this — the run is marked 'failed', and the next full sync replaces everything
 * (lazy-delete again). A true atomic swap is impossible here without staging the corpus,
 * which would mean writing curriculum text into our DB — exactly what this path avoids.
 *
 * Tradeoff vs the Batch path: this is NOT restart-safe (a process restart mid-run leaves
 * the sync row 'syncing' and the run must be re-triggered; the next sync's unguarded
 * 'syncing' write self-heals the stuck row). That is the accepted cost of keeping
 * curriculum text out of our DB entirely — there is no staging to resume from.
 */
async function ingestFullDirect(
  businessAccountId: string,
  cpId: string,
  cfg: TopscholarConfig,
  source: 'cms' | 'fixture',
  records: ChunkRecord[],
  counts: ReturnType<typeof countByType>,
  awaitCompletion = false,
  isRunCancelled?: () => Promise<boolean>,
): Promise<IngestResult> {
  const cancelledResult = (): IngestResult => ({
    cpId, source, mode: 'full', storeType: cfg.storeType,
    chunkCount: 0, ...counts, async: false, cancelled: true,
  });
  if (await isRunCancelled?.()) return cancelledResult();

  // Mark syncing with the full totals up front (the run-initiating write stays unguarded so
  // a fresh sync can restart a previously-cancelled cp_id).
  await upsertSync(businessAccountId, cpId, {
    status: 'syncing',
    syncMode: 'full',
    storeType: cfg.storeType,
    chunkCount: 0,
    totalCount: records.length,
    processedCount: 0,
    ...counts,
    lastError: null,
    embedJobId: null,
  });
  // Cancellation can race the startup write above. Check again before a single
  // embedding request or client-store mutation; the plan worker's durable item
  // status is the authority, while the sync row is the visible signal.
  if (await isRunCancelled?.()) {
    await upsertSync(businessAccountId, cpId, { status: 'cancelled', lastError: 'Cancelled from the Plan sync queue.', embedJobId: null }, true);
    return cancelledResult();
  }

  // Returns true if the sync row was meanwhile flipped to 'cancelled' (cancel endpoint).
  const wasCancelled = async (): Promise<boolean> => {
    const [row] = await db
      .select({ status: topscholarContentSync.status })
      .from(topscholarContentSync)
      .where(and(eq(topscholarContentSync.businessAccountId, businessAccountId), eq(topscholarContentSync.cpId, cpId)));
    return !!(await isRunCancelled?.()) || row?.status === 'cancelled';
  };

  // Background worker — intentionally not awaited by the caller.
  const run = async (): Promise<boolean> => {
    return withCpLock(businessAccountId, cpId, async () => {
      let written = 0;
      let deleted = false;
      for (let i = 0; i < records.length; i += DIRECT_SYNC_PAGE) {
        if (await wasCancelled()) return false; // stop appending; leave partial content for re-sync
        const page = records.slice(i, i + DIRECT_SYNC_PAGE);
        const embeddings = await embeddingService.generateBatchEmbeddings(
          page.map((r) => r.contentText),
          businessAccountId,
        );
        const chunks: StoreChunk[] = page.map((r, idx) => ({
          board: r.board ?? null,
          medium: r.medium ?? null,
          grade: r.grade ?? null,
          contentType: r.contentType,
          subject: r.subject,
          subjectId: r.subjectId,
          chapter: r.chapter,
          title: r.title,
          contentHtml: r.contentHtml,
          contentText: r.contentText,
          sourceRef: r.sourceRef,
          mediaUrl: r.mediaUrl,
          metadata: r.metadata,
          contentHash: hashContent(r.contentText),
          embedding: embeddings[idx] || [],
        }));

        // Lazy delete: only wipe prior chunks once, right before the first confirmed write.
        if (!deleted) {
          await deleteCpChunks(cfg, businessAccountId, cpId);
          deleted = true;
        }
        written += await appendCpChunks(cfg, businessAccountId, cpId, chunks);

        // Advance progress (guarded so a mid-run cancel sticks).
        await upsertSync(businessAccountId, cpId, { chunkCount: written, processedCount: written }, true);
      }

      // If nothing was written at all (e.g. every chunk lacked text), still clear the store
      // so a now-empty cp_id doesn't keep stale chunks.
      if (!deleted) {
        await deleteCpChunks(cfg, businessAccountId, cpId);
      }

      await upsertSync(businessAccountId, cpId, {
        status: 'completed',
        chunkCount: written,
        totalCount: records.length,
        processedCount: written,
        lastError: null,
        lastSyncedAt: new Date(),
        embedJobId: null,
      }, true);
      return true;
    });
  };

  const completion = run().catch(async (error: any) => {
    console.error('[TopScholar Sync] Direct full sync failed:', error);
    await upsertSync(
      businessAccountId,
      cpId,
      { status: 'failed', lastError: error?.message || String(error), embedJobId: null },
      true,
    ).catch(() => {});
    throw error;
  });

  if (awaitCompletion) {
    const completed = await completion;
    return {
      cpId, source, mode: 'full', storeType: cfg.storeType,
      chunkCount: records.length, ...counts,
      async: false,
      cancelled: !completed,
    };
  }

  // The targeted per-CP control deliberately stays non-blocking. Consume the
  // rejection here because the sync row above is the user-visible error channel.
  void completion.catch(() => {});

  // Return immediately — the run continues in the background; the UI polls the sync row.
  return {
    cpId, source, mode: 'full', storeType: cfg.storeType,
    chunkCount: records.length, ...counts,
    async: true,
  };
}
