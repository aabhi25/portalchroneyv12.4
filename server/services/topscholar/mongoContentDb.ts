import { MongoClient, type Collection, type Db } from 'mongodb';

/**
 * MongoDB Atlas Vector Search store for TopScholar curriculum embeddings.
 *
 * This is the client-hosted destination described in the TSD: the client runs an
 * Atlas cluster and gives us a connection string + database name + Vector Search
 * index name. We write/read embeddings to a single dedicated collection — never
 * mixed into their app collections. The collection name is admin-configurable
 * (the client uses their own, e.g. `chatbot-teacher-connect`); blank defaults to
 * `topscholar_embeddings`. The SAME resolved name is used for both the write path
 * (chunk store) and the read path (RAG resolver).
 *
 * Every document is shaped exactly per the TSD spec:
 *   {
 *     business_account_id, cp_id, chunk_text, embedding (1536 floats), metadata,
 *     content_type, subject, chapter, title, content_html, source_ref, media_url,
 *     content_hash, updated_at
 *   }
 *
 * Search is ALWAYS hard-filtered by (business_account_id, cp_id) — the core safety
 * guarantee that a student only ever sees their own curriculum slice.
 */

// Default collection name (used when the admin has not configured one).
export const TOPSCHOLAR_COLLECTION = 'topscholar_embeddings';

/** Resolve the effective collection name: admin-configured value, else the default. */
export function resolveCollectionName(collection: string | null | undefined): string {
  const trimmed = (collection || '').trim();
  return trimmed || TOPSCHOLAR_COLLECTION;
}

export const EMBEDDING_DIMENSIONS = 1536;

export interface MongoChunkDoc {
  business_account_id: string;
  cp_id: string;
  board: string | null;
  medium: string | null;
  grade: string | null;
  content_type: string;
  subject: string | null;
  subject_id: string | null;
  chapter: string | null;
  title: string | null;
  content_html: string | null;
  chunk_text: string;
  source_ref: string | null;
  media_url: string | null;
  embedding: number[];
  metadata: Record<string, unknown>;
  content_hash: string | null;
  updated_at: Date;
}

/** Detects whether a content-DB connection string targets MongoDB (vs pgvector). */
export function isMongoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.trim().toLowerCase();
  return u.startsWith('mongodb://') || u.startsWith('mongodb+srv://');
}

// One cached client per connection string. The MongoDB driver pools connections
// internally, so a single shared client per cluster is the recommended pattern.
const clients = new Map<string, MongoClient>();

async function getClient(connectionString: string): Promise<MongoClient> {
  let client = clients.get(connectionString);
  if (!client) {
    client = new MongoClient(connectionString, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
    });
    await client.connect();
    clients.set(connectionString, client);
  }
  return client;
}

function getDb(client: MongoClient, dbName: string | null): Db {
  // When dbName is omitted, the database encoded in the connection string is used.
  return dbName ? client.db(dbName) : client.db();
}

export async function getMongoCollection(
  connectionString: string,
  dbName: string | null,
  collection: string | null,
): Promise<Collection<MongoChunkDoc>> {
  return getCollection(connectionString, dbName, collection);
}

async function getCollection(
  connectionString: string,
  dbName: string | null,
  collection: string | null,
): Promise<Collection<MongoChunkDoc>> {
  const client = await getClient(connectionString);
  const db = getDb(client, dbName);
  return db.collection<MongoChunkDoc>(resolveCollectionName(collection));
}

export interface MongoConfig {
  connectionString: string;
  dbName: string | null;
  collection: string | null;
  indexName: string;
}

/**
 * Pings the cluster and reports basic reachability for the admin "Test Connection"
 * button. Never throws — returns a structured result the UI can render.
 */
export async function testMongoConnection(cfg: {
  connectionString: string;
  dbName: string | null;
  collection?: string | null;
  indexName?: string | null;
}): Promise<{
  success: boolean;
  message: string;
  collectionExists?: boolean;
  docCount?: number;
  indexChecked?: boolean;
  indexExists?: boolean;
  warning?: string;
}> {
  let probe: MongoClient | null = null;
  const collectionName = resolveCollectionName(cfg.collection);
  const indexName = (cfg.indexName || '').trim();
  try {
    // Use a short-lived client for the test so a bad string never poisons the pool.
    probe = new MongoClient(cfg.connectionString, { serverSelectionTimeoutMS: 8000 });
    await probe.connect();
    const db = getDb(probe, cfg.dbName);
    await db.command({ ping: 1 });

    const col = db.collection(collectionName);

    // Verify READ access on the *target collection itself* rather than listing the
    // database's collections. `listCollections` is a database-level metadata
    // privilege that many least-privilege Atlas users (scoped readWrite on a single
    // collection, or a custom role) legitimately do NOT have — even though they CAN
    // read, write, and run $vectorSearch on the collection. Probing the actual
    // collection mirrors the access the runtime really needs and avoids false
    // "not authorized" failures. A null/empty result is expected and fine: the
    // collection may be empty or not yet created (it is created on first sync).
    try {
      await col.findOne({}, { projection: { _id: 1 }, maxTimeMS: 5000 });
    } catch (readErr: any) {
      const msg = readErr?.message || String(readErr);
      if (/not authorized|unauthorized|requires authentication/i.test(msg)) {
        return {
          success: false,
          message: `Connected to the cluster, but the database user is not authorized to read collection "${collectionName}" on database "${cfg.dbName ?? '(default)'}". Grant the user "readWrite" on this database (or a custom role with find / aggregate / insert / remove). Detail: ${msg}`,
        };
      }
      throw readErr;
    }

    // Best-effort document count — never fatal. A least-privilege user may lack the
    // privilege for estimatedDocumentCount even when scoped reads work, so treat a
    // failure here as "unknown count" rather than a connection failure.
    //
    // Without `listCollections` (a privilege we deliberately no longer require) we
    // cannot reliably distinguish "exists but empty" from "not created yet" — so
    // `collectionExists` is only set to `true` when we positively see documents, and
    // left `undefined` (unknown) otherwise rather than falsely reported as missing.
    let docCount: number | undefined;
    let collectionExists: boolean | undefined;
    try {
      docCount = await col.estimatedDocumentCount();
      if (docCount > 0) collectionExists = true;
    } catch {
      docCount = undefined;
    }

    // Best-effort WRITE capability probe using the real sync path's operation
    // (deleteMany). The filter `{ _id: { $exists: false } }` can NEVER match a real
    // document (every document always has an `_id`), so this is a guaranteed no-op
    // (deletedCount 0) with zero data-loss risk, while still exercising the same
    // privilege the sync needs. Surface a clear warning if writes are denied so the
    // admin knows sync will fail, but don't block the test: verifying read access to
    // an already-populated collection is still useful on its own.
    let writeWarning: string | undefined;
    try {
      await col.deleteMany({ _id: { $exists: false } });
    } catch (writeErr: any) {
      const msg = writeErr?.message || String(writeErr);
      if (/not authorized|unauthorized/i.test(msg)) {
        writeWarning = `Read access works, but the user cannot WRITE to "${collectionName}". Embedding sync will fail until you grant write access ("readWrite" on the database, or insert/remove on the collection).`;
      }
    }

    // When an index name is supplied, verify the Atlas Vector Search index exists
    // on the collection. Reads return nothing until the client creates it, so a
    // missing or unverifiable index is surfaced as a non-blocking warning (never a
    // failure) — this also covers least-privilege users that can't introspect indexes.
    let indexChecked = false;
    let indexExists: boolean | undefined;
    let indexWarning: string | undefined;
    if (indexName) {
      indexChecked = true;
      try {
        const idx = await col.listSearchIndexes(indexName).toArray();
        indexExists = idx.length > 0;
        if (!indexExists) {
          indexWarning = `Connected, but the Atlas Vector Search index "${indexName}" was not found on collection "${collectionName}". Semantic reads will return nothing until you create it (1536 dims, cosine). If the collection has not been synced yet, create the index after the first sync.`;
        }
      } catch (idxErr: any) {
        // listSearchIndexes is Atlas-only and needs its own privilege; on a
        // non-Atlas/unsupported cluster or least-privilege user we can't verify —
        // warn rather than fail.
        indexWarning = `Connected, but the Vector Search index "${indexName}" could not be verified (${idxErr?.message || "unsupported or not authorized on this cluster"}). Ensure it exists on Atlas (1536 dims, cosine).`;
      }
    }

    const baseMessage = collectionExists
      ? `Connected. Collection "${collectionName}" found with ~${docCount} document(s).`
      : `Connected. Collection "${collectionName}" is empty or not created yet — it will be populated on first sync.`;

    const warning = [writeWarning, indexWarning].filter(Boolean).join(" ") || undefined;

    return {
      success: true,
      message: [baseMessage, warning].filter(Boolean).join(" "),
      collectionExists,
      docCount,
      indexChecked,
      indexExists,
      warning,
    };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Failed to connect to MongoDB Atlas.' };
  } finally {
    if (probe) {
      await probe.close().catch(() => {});
    }
  }
}

/** Deletes every chunk for one (business_account_id, cp_id) — used before a fresh insert. */
export async function deleteMongoCpChunks(
  cfg: { connectionString: string; dbName: string | null; collection: string | null },
  businessAccountId: string,
  cpId: string,
): Promise<number> {
  const col = await getCollection(cfg.connectionString, cfg.dbName, cfg.collection);
  const res = await col.deleteMany({ business_account_id: businessAccountId, cp_id: cpId });
  return res.deletedCount ?? 0;
}

/** Returns the set of content_hash values already stored for (business_account_id, cp_id). */
export async function getMongoExistingHashes(
  cfg: { connectionString: string; dbName: string | null; collection: string | null },
  businessAccountId: string,
  cpId: string,
): Promise<Set<string>> {
  const col = await getCollection(cfg.connectionString, cfg.dbName, cfg.collection);
  const hashes = await col.distinct('content_hash', {
    business_account_id: businessAccountId,
    cp_id: cpId,
  });
  return new Set(hashes.filter((h): h is string => typeof h === 'string'));
}

/**
 * Returns the distinct, non-blank chapter names stored across the given cp_id(s)
 * for a business account. Used to populate the Widget Tester's chapter dropdown
 * when the content store is MongoDB Atlas. Sorted alphabetically.
 */
export async function getMongoChapterNames(
  cfg: { connectionString: string; dbName: string | null; collection: string | null },
  businessAccountId: string,
  cpIds: string[],
): Promise<string[]> {
  if (cpIds.length === 0) return [];
  const col = await getCollection(cfg.connectionString, cfg.dbName, cfg.collection);
  const values = await col.distinct('chapter', {
    business_account_id: businessAccountId,
    cp_id: { $in: cpIds },
  });
  return values
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Returns the distinct cp_ids that have at least one content chunk stored for a
 * business account. Used to filter the Widget Tester's scope dropdowns down to
 * packs that are actually testable (have synced content).
 */
export async function getMongoCpIdsWithContent(
  cfg: { connectionString: string; dbName: string | null; collection: string | null },
  businessAccountId: string,
): Promise<Set<string>> {
  const col = await getCollection(cfg.connectionString, cfg.dbName, cfg.collection);
  const values = await col.distinct('cp_id', { business_account_id: businessAccountId });
  return new Set(values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0));
}

/** Bulk-inserts chunk documents in manageable batches. */
export async function insertMongoChunks(
  cfg: { connectionString: string; dbName: string | null; collection: string | null },
  docs: MongoChunkDoc[],
): Promise<number> {
  if (docs.length === 0) return 0;
  const col = await getCollection(cfg.connectionString, cfg.dbName, cfg.collection);
  const BATCH = 1000;
  let inserted = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);
    const res = await col.insertMany(slice, { ordered: false });
    inserted += res.insertedCount ?? 0;
  }
  return inserted;
}

/**
 * Atlas $vectorSearch over the dedicated collection, hard-scoped to one curriculum.
 * Returns the closest passages of the requested content types for a query embedding.
 */
export async function mongoVectorSearch(
  cfg: MongoConfig,
  params: {
    businessAccountId: string;
    embedding: number[];
    contentTypes: string[];
    limit: number;
    cpIds?: string[];
    chapter?: string | null;
  },
): Promise<Array<MongoChunkDoc & { score: number }>> {
  const col = await getCollection(cfg.connectionString, cfg.dbName, cfg.collection);

  // numCandidates should comfortably exceed limit for recall; cap to keep it cheap.
  const numCandidates = Math.min(Math.max(params.limit * 20, 100), 1000);

  const chapter = (params.chapter ?? '').trim();

  const pipeline = [
    {
      $vectorSearch: {
        index: cfg.indexName,
        path: 'embedding',
        queryVector: params.embedding,
        numCandidates,
        limit: params.limit,
        filter: {
          business_account_id: params.businessAccountId,
          content_type: { $in: params.contentTypes },
          ...(params.cpIds && params.cpIds.length > 0 ? { cp_id: { $in: params.cpIds } } : {}),
          ...(chapter ? { chapter } : {}),
        },
      },
    },
    {
      $project: {
        _id: 0,
        business_account_id: 1,
        cp_id: 1,
        content_type: 1,
        subject: 1,
        subject_id: 1,
        chapter: 1,
        title: 1,
        content_html: 1,
        chunk_text: 1,
        source_ref: 1,
        media_url: 1,
        metadata: 1,
        content_hash: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ];

  return col.aggregate<MongoChunkDoc & { score: number }>(pipeline).toArray();
}

/** Closes all pooled clients (used on graceful shutdown / tests). */
export async function closeMongoClients(): Promise<void> {
  for (const client of Array.from(clients.values())) {
    await client.close().catch(() => {});
  }
  clients.clear();
}
