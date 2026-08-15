import OpenAI from 'openai';
import { storage } from '../../storage';

/**
 * OpenAI Batch API wrapper for cost-efficient bulk embedding generation.
 *
 * The Batch API costs ~50% of the synchronous embeddings endpoint and is processed
 * within a 24h completion window — ideal for the one-time FULL sync of a curriculum
 * (which is never latency-sensitive). The synchronous path in `embeddingService` is
 * still used for SAMPLE syncs and for live student questions.
 *
 * Flow:
 *   1. Build a JSONL file: one /v1/embeddings request per chunk, keyed by custom_id.
 *   2. Upload via the Files API (purpose: 'batch').
 *   3. Create a batch against /v1/embeddings with a 24h window.
 *   4. Later, poll the batch; when 'completed', download the output JSONL and map
 *      custom_id -> embedding.
 */

const EMBEDDING_MODEL = 'text-embedding-3-small';
// OpenAI hard limit is 50k requests / 200MB per batch input file. Stay safely under both.
export const MAX_REQUESTS_PER_BATCH = 40000;
// Cap the JSONL input file size well under OpenAI's 200MB limit (UTF-8 bytes).
const MAX_BATCH_FILE_BYTES = 180 * 1024 * 1024;
// Mirror the synchronous service's truncation so identical text yields identical vectors.
const MAX_CHARS = 8191 * 4;

/** Serializes one /v1/embeddings request line (no trailing newline). */
function buildJsonlLine(item: BatchInputItem): string {
  return JSON.stringify({
    custom_id: item.customId,
    method: 'POST',
    url: '/v1/embeddings',
    body: {
      model: EMBEDDING_MODEL,
      input: item.text.slice(0, MAX_CHARS),
      encoding_format: 'float',
    },
  });
}

async function getOpenAIClient(businessAccountId: string): Promise<OpenAI> {
  const account = await storage.getBusinessAccount(businessAccountId);
  if (!account?.openaiApiKey) {
    throw new Error('OpenAI API key not configured for this business account');
  }
  return new OpenAI({ apiKey: account.openaiApiKey });
}

export interface BatchInputItem {
  customId: string;
  text: string;
}

export interface SubmittedBatch {
  batchId: string;
  inputFileId: string;
  count: number;
}

function buildJsonl(items: BatchInputItem[]): string {
  return items.map(buildJsonlLine).join('\n');
}

/**
 * Submits one OpenAI batch for up to MAX_REQUESTS_PER_BATCH items. Callers that have
 * more items must chunk them and call this once per chunk (see submitEmbeddingBatches).
 */
export async function submitEmbeddingBatch(
  businessAccountId: string,
  items: BatchInputItem[],
): Promise<SubmittedBatch> {
  if (items.length === 0) throw new Error('Cannot submit an empty embedding batch.');
  if (items.length > MAX_REQUESTS_PER_BATCH) {
    throw new Error(`Batch exceeds ${MAX_REQUESTS_PER_BATCH} requests; split before submitting.`);
  }

  const openai = await getOpenAIClient(businessAccountId);
  const jsonl = buildJsonl(items);

  // Upload the JSONL as a File (purpose 'batch'). Node File is available in Node 20.
  const file = await openai.files.create({
    file: new File([jsonl], `topscholar-embed-${Date.now()}.jsonl`, { type: 'application/jsonl' }),
    purpose: 'batch',
  });

  const batch = await openai.batches.create({
    input_file_id: file.id,
    endpoint: '/v1/embeddings',
    completion_window: '24h',
  });

  return { batchId: batch.id, inputFileId: file.id, count: items.length };
}

/**
 * Splits items across multiple batches, respecting BOTH OpenAI limits: the per-batch
 * request count AND the input-file byte size. A naive count-only split can still produce
 * a JSONL file over the 200MB cap when chunks are large, so we close a batch whenever
 * either limit would be exceeded.
 */
export async function submitEmbeddingBatches(
  businessAccountId: string,
  items: BatchInputItem[],
): Promise<SubmittedBatch[]> {
  const submitted: SubmittedBatch[] = [];
  let current: BatchInputItem[] = [];
  let currentBytes = 0;

  const flush = async () => {
    if (current.length === 0) return;
    submitted.push(await submitEmbeddingBatch(businessAccountId, current));
    current = [];
    currentBytes = 0;
  };

  for (const item of items) {
    // +1 for the newline joiner between lines.
    const lineBytes = Buffer.byteLength(buildJsonlLine(item), 'utf8') + 1;
    if (current.length > 0 && (current.length >= MAX_REQUESTS_PER_BATCH || currentBytes + lineBytes > MAX_BATCH_FILE_BYTES)) {
      await flush();
    }
    current.push(item);
    currentBytes += lineBytes;
  }
  await flush();

  return submitted;
}

export interface BatchStatus {
  id: string;
  status: string; // validating | in_progress | finalizing | completed | failed | expired | cancelled
  outputFileId: string | null;
  errorFileId: string | null;
  completed: number;
  failed: number;
  total: number;
}

export async function getBatchStatus(businessAccountId: string, batchId: string): Promise<BatchStatus> {
  const openai = await getOpenAIClient(businessAccountId);
  const batch = await openai.batches.retrieve(batchId);
  return {
    id: batch.id,
    status: batch.status,
    outputFileId: batch.output_file_id ?? null,
    errorFileId: batch.error_file_id ?? null,
    completed: batch.request_counts?.completed ?? 0,
    failed: batch.request_counts?.failed ?? 0,
    total: batch.request_counts?.total ?? 0,
  };
}

function parseResultLine(line: string): { customId: string; embedding: number[] } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const customId: string | undefined = parsed.custom_id;
    const embedding: number[] | undefined = parsed.response?.body?.data?.[0]?.embedding;
    if (customId && Array.isArray(embedding)) return { customId, embedding };
  } catch {
    // Ignore malformed lines defensively.
  }
  return null;
}

/**
 * Streams a completed batch's output file line-by-line, invoking `onEmbedding` for each
 * successfully-embedded request. This NEVER materializes the whole file or a full
 * custom_id -> embedding map, so a batch output of hundreds of thousands of 1536-dim
 * vectors (potentially gigabytes of JSON) lands without OOM. Lines whose request failed
 * are simply skipped. Returns the number of embeddings emitted.
 */
export async function streamBatchResults(
  businessAccountId: string,
  outputFileId: string,
  onEmbedding: (customId: string, embedding: number[]) => Promise<void> | void,
): Promise<number> {
  const openai = await getOpenAIClient(businessAccountId);
  const response: any = await openai.files.content(outputFileId);

  let count = 0;
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = async (line: string) => {
    const parsed = parseResultLine(line);
    if (!parsed) return;
    await onEmbedding(parsed.customId, parsed.embedding);
    count++;
  };

  const body = response?.body;
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        await handleLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer) await handleLine(buffer);
  } else {
    // Fallback for SDK shapes without a streamable body.
    const text: string = await response.text();
    for (const line of text.split('\n')) await handleLine(line);
  }

  return count;
}

/** Best-effort cancellation of an in-flight batch. */
export async function cancelBatch(businessAccountId: string, batchId: string): Promise<void> {
  try {
    const openai = await getOpenAIClient(businessAccountId);
    await openai.batches.cancel(batchId);
  } catch {
    // Non-fatal.
  }
}
