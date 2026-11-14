import { and, eq, gt } from "drizzle-orm";
import { db } from "../../db";
import { topscholarContentSync, topscholarCpMappings } from "@shared/schema";
import { ensureContentSchema, getContentPool } from "./contentDb";
import { getMongoChapterNames, getMongoCollection } from "./mongoContentDb";
import { getChapterNamesForCpIds } from "./contentReader";
import { isMongoConnectionString, type TopscholarConfig } from "./config";

export interface StoredCurriculumScope {
  board: string;
  medium: string;
  grade: string;
  subject: string;
  cpId: string;
}

export interface StoredScopeSelection {
  board: string;
  medium: string;
  grade: string;
  subject: string;
}

export interface SubjectReconciliationResult {
  scannedRows: number;
  usableSubjects: number;
  updatedMappings: number;
  unchangedMappings: number;
  unmatchedCpIds: number;
  conflictingSubjects: number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: unknown): string {
  return text(value).toLocaleLowerCase();
}

const indexedMongoStores = new Set<string>();

/**
 * Imports the authoritative subject label from the active content store into
 * the app-side CP mapping table. This is intentionally an explicit maintenance
 * operation, not part of a request path: it may scan the client's store once,
 * but subsequent Tester requests remain metadata-only and fast.
 *
 * Only non-blank, unambiguous subject values are applied to an existing mapping
 * in the same tenant. The client content store is never modified.
 */
export async function reconcileSubjectNamesFromContentStore(
  cfg: TopscholarConfig,
  businessAccountId: string,
): Promise<SubjectReconciliationResult> {
  const mappings = await db
    .select({
      cpId: topscholarCpMappings.cpId,
      subject: topscholarCpMappings.subject,
    })
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));

  const mappingByCpId = new Map(
    mappings.map((mapping) => [text(mapping.cpId), text(mapping.subject)]),
  );

  let rows: Array<{ cpId: string; subject: string }>;
  if (cfg.storeType === "mongodb") {
    if (!cfg.contentDbUrl) throw new Error("MongoDB content DB URL is not configured.");
    const collection = await getMongoCollection(
      cfg.contentDbUrl,
      cfg.contentDbName,
      cfg.contentDbCollection,
    );
    const storedRows = await collection
      .aggregate<{ cpId: string; subject: string }>([
        { $match: { business_account_id: businessAccountId } },
        {
          $project: {
            _id: 0,
            cpId: { $trim: { input: { $ifNull: ["$cp_id", ""] } } },
            subject: { $trim: { input: { $ifNull: ["$subject", ""] } } },
          },
        },
        { $match: { cpId: { $ne: "" }, subject: { $ne: "" } } },
        {
          $group: {
            _id: { cpId: "$cpId", subject: "$subject" },
            cpId: { $first: "$cpId" },
            subject: { $first: "$subject" },
          },
        },
        { $project: { _id: 0, cpId: 1, subject: 1 } },
      ])
      .toArray();
    rows = storedRows.map((row) => ({ cpId: text(row.cpId), subject: text(row.subject) }));
  } else {
    const pool = getContentPool(cfg.contentDbUrl);
    const result = await pool.query(
      `SELECT DISTINCT
         btrim(cp_id) AS "cpId",
         btrim(subject) AS subject
       FROM topscholar_content_chunks
       WHERE business_account_id = $1
         AND cp_id IS NOT NULL AND btrim(cp_id) <> ''
         AND subject IS NOT NULL AND btrim(subject) <> ''`,
      [businessAccountId],
    );
    rows = result.rows.map((row) => ({ cpId: text(row.cpId), subject: text(row.subject) }));
  }

  const subjectsByCpId = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.cpId || !row.subject) continue;
    const subjects = subjectsByCpId.get(row.cpId) || new Set<string>();
    subjects.add(row.subject);
    subjectsByCpId.set(row.cpId, subjects);
  }

  let updatedMappings = 0;
  let unchangedMappings = 0;
  let unmatchedCpIds = 0;
  let conflictingSubjects = 0;

  await db.transaction(async (tx) => {
    for (const [cpId, subjects] of subjectsByCpId) {
      if (!mappingByCpId.has(cpId)) {
        unmatchedCpIds++;
        continue;
      }
      if (subjects.size !== 1) {
        conflictingSubjects++;
        continue;
      }
      const subject = Array.from(subjects)[0];
      const currentSubject = mappingByCpId.get(cpId) || "";
      if (currentSubject === subject) {
        unchangedMappings++;
        continue;
      }
      await tx
        .update(topscholarCpMappings)
        .set({ subject, updatedAt: new Date() })
        .where(
          and(
            eq(topscholarCpMappings.businessAccountId, businessAccountId),
            eq(topscholarCpMappings.cpId, cpId),
          ),
        );
      updatedMappings++;
    }
  });

  return {
    scannedRows: rows.length,
    usableSubjects: subjectsByCpId.size,
    updatedMappings,
    unchangedMappings,
    unmatchedCpIds,
    conflictingSubjects,
  };
}

/**
 * Writes scope metadata into legacy client-store chunks from the CP metadata that
 * was obtained from the CMS during an earlier sync. This only enriches metadata:
 * it never copies curriculum text or embeddings into the app database.
 */
export async function backfillTesterScopeMetadata(
  cfg: TopscholarConfig,
  businessAccountId: string,
): Promise<void> {
  const mappings = await db
    .select({
      cpId: topscholarCpMappings.cpId,
      board: topscholarCpMappings.board,
      medium: topscholarCpMappings.medium,
      grade: topscholarCpMappings.grade,
      subject: topscholarCpMappings.subject,
      cpName: topscholarCpMappings.cpName,
    })
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId));

  const valid = mappings
    .map((mapping) => ({
      cpId: text(mapping.cpId),
      board: text(mapping.board),
      medium: text(mapping.medium),
      grade: text(mapping.grade),
      subject: text(mapping.subject) || text(mapping.cpName),
    }))
    .filter((mapping) =>
      !!(mapping.cpId && mapping.board && mapping.medium && mapping.grade && mapping.subject),
    );

  if (valid.length === 0) return;

  if (cfg.storeType === "mongodb") {
    if (!cfg.contentDbUrl) throw new Error("MongoDB content DB URL is not configured.");
    const collection = await getMongoCollection(
      cfg.contentDbUrl,
      cfg.contentDbName,
      cfg.contentDbCollection,
    );
    const storeKey = `${cfg.contentDbUrl}|${cfg.contentDbName || ""}|${cfg.contentDbCollection || ""}`;
    if (!indexedMongoStores.has(storeKey)) {
      // Index creation is best-effort: existing client credentials may allow reads
      // and writes to the embedding collection but not index administration.
      await collection
        .createIndex(
          { business_account_id: 1, board: 1, medium: 1, grade: 1, subject: 1, cp_id: 1 },
          { name: "topscholar_tester_scope_idx" },
        )
        .catch((error) => {
          console.warn("[TopScholar] Could not create Tester scope index in MongoDB:", error instanceof Error ? error.message : error);
        });
      indexedMongoStores.add(storeKey);
    }

    for (const mapping of valid) {
      await collection.updateMany(
        {
          business_account_id: businessAccountId,
          cp_id: mapping.cpId,
          $or: [
            { board: { $ne: mapping.board } },
            { medium: { $ne: mapping.medium } },
            { grade: { $ne: mapping.grade } },
            { subject: { $ne: mapping.subject } },
          ],
        },
        {
          $set: {
            board: mapping.board,
            medium: mapping.medium,
            grade: mapping.grade,
            subject: mapping.subject,
          },
        },
      );
    }
    return;
  }

  const pool = getContentPool(cfg.contentDbUrl);
  await ensureContentSchema(pool);
  for (const mapping of valid) {
    await pool.query(
      `UPDATE topscholar_content_chunks
          SET board = $3,
              medium = $4,
              grade = $5,
              subject = $6,
              updated_at = now()
        WHERE business_account_id = $1
          AND cp_id = $2
          AND (board IS DISTINCT FROM $3
            OR medium IS DISTINCT FROM $4
            OR grade IS DISTINCT FROM $5
            OR subject IS DISTINCT FROM $6)`,
      [
        businessAccountId,
        mapping.cpId,
        mapping.board,
        mapping.medium,
        mapping.grade,
        mapping.subject,
      ],
    );
  }
}

/**
 * Returns only complete curriculum scopes physically present in the active content
 * store. Rows without Board/Medium/Grade/Subject are intentionally excluded: the
 * Tester must not offer an ambiguous scope.
 */
export async function listStoredCurriculumScopes(
  cfg: TopscholarConfig,
  businessAccountId: string,
): Promise<StoredCurriculumScope[]> {
  if (cfg.storeType === "mongodb") {
    if (!cfg.contentDbUrl) throw new Error("MongoDB content DB URL is not configured.");
    const collection = await getMongoCollection(
      cfg.contentDbUrl,
      cfg.contentDbName,
      cfg.contentDbCollection,
    );
    const rows = await collection
      .aggregate<StoredCurriculumScope>([
        { $match: { business_account_id: businessAccountId } },
        {
          $project: {
            cpId: "$cp_id",
            board: { $trim: { input: { $ifNull: ["$board", ""] } } },
            medium: { $trim: { input: { $ifNull: ["$medium", ""] } } },
            grade: { $trim: { input: { $ifNull: ["$grade", ""] } } },
            subject: { $trim: { input: { $ifNull: ["$subject", ""] } } },
          },
        },
        {
          $match: {
            cpId: { $type: "string", $ne: "" },
            board: { $ne: "" },
            medium: { $ne: "" },
            grade: { $ne: "" },
            subject: { $ne: "" },
          },
        },
        {
          $group: {
            _id: {
              cpId: "$cpId",
              board: { $toLower: "$board" },
              medium: { $toLower: "$medium" },
              grade: { $toLower: "$grade" },
              subject: { $toLower: "$subject" },
            },
            cpId: { $first: "$cpId" },
            board: { $first: "$board" },
            medium: { $first: "$medium" },
            grade: { $first: "$grade" },
            subject: { $first: "$subject" },
          },
        },
        { $project: { _id: 0, cpId: 1, board: 1, medium: 1, grade: 1, subject: 1 } },
      ])
      .toArray();
    return rows.map((row) => ({
      cpId: text(row.cpId),
      board: text(row.board),
      medium: text(row.medium),
      grade: text(row.grade),
      subject: text(row.subject),
    }));
  }

  const pool = getContentPool(cfg.contentDbUrl);
  await ensureContentSchema(pool);
  const { rows } = await pool.query(
    `SELECT DISTINCT
       btrim(cp_id) AS "cpId",
       btrim(board) AS board,
       btrim(medium) AS medium,
       btrim(grade) AS grade,
       btrim(subject) AS subject
     FROM topscholar_content_chunks
     WHERE business_account_id = $1
       AND cp_id IS NOT NULL AND btrim(cp_id) <> ''
       AND board IS NOT NULL AND btrim(board) <> ''
       AND medium IS NOT NULL AND btrim(medium) <> ''
       AND grade IS NOT NULL AND btrim(grade) <> ''
       AND subject IS NOT NULL AND btrim(subject) <> ''`,
    [businessAccountId],
  );
  return rows.map((row) => ({
    cpId: text(row.cpId),
    board: text(row.board),
    medium: text(row.medium),
    grade: text(row.grade),
    subject: text(row.subject),
  }));
}

export async function resolveStoredScopeCpIds(
  cfg: TopscholarConfig,
  businessAccountId: string,
  selection: StoredScopeSelection,
): Promise<string[]> {
  const scope = await listStoredCurriculumScopes(cfg, businessAccountId);
  const board = normalized(selection.board);
  const medium = normalized(selection.medium);
  const grade = normalized(selection.grade);
  const subject = normalized(selection.subject);
  return Array.from(
    new Set(
      scope
        .filter((row) =>
          normalized(row.board) === board &&
          normalized(row.medium) === medium &&
          normalized(row.grade) === grade &&
          normalized(row.subject) === subject,
        )
        .map((row) => row.cpId),
    ),
  );
}
/**
 * The synced content packs with their board / medium / grade / subject, read from Chroney's own
 * database (CP mappings with a completed, non-empty sync). Used by the Widget Tester and AI
 * assessment to build the class and subject choices without grouping every document of the
 * content store; a pack becomes eligible only after its sync completed.
 */
export async function listSyncedScopeMetadata(businessAccountId: string): Promise<StoredCurriculumScope[]> {
  const rows = await db
    .select({
      cpId: topscholarCpMappings.cpId,
      board: topscholarCpMappings.board,
      medium: topscholarCpMappings.medium,
      grade: topscholarCpMappings.grade,
      subject: topscholarCpMappings.subject,
      cpName: topscholarCpMappings.cpName,
    })
    .from(topscholarCpMappings)
    .innerJoin(
      topscholarContentSync,
      and(
        eq(topscholarContentSync.businessAccountId, topscholarCpMappings.businessAccountId),
        eq(topscholarContentSync.cpId, topscholarCpMappings.cpId),
      ),
    )
    .where(
      and(
        eq(topscholarCpMappings.businessAccountId, businessAccountId),
        eq(topscholarContentSync.status, "completed"),
        gt(topscholarContentSync.chunkCount, 0),
      ),
    );

  return rows
    .map((row) => ({
      cpId: row.cpId.trim(),
      board: row.board?.trim() || "",
      medium: row.medium?.trim() || "",
      grade: row.grade?.trim() || "",
      subject: row.subject?.trim() || row.cpName?.trim() || "",
    }))
    .filter((row) => !!(row.cpId && row.board && row.medium && row.grade && row.subject));
}

function sameScopeValue(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;
}

/** CP IDs of the synced packs for one board / medium / grade / subject. */
export function syncedCpIdsForScope(
  scopes: StoredCurriculumScope[],
  selection: { board: string; medium: string; grade: string; subject: string },
): string[] {
  return Array.from(
    new Set(
      scopes
        .filter((scope) =>
          sameScopeValue(scope.board, selection.board) &&
          sameScopeValue(scope.medium, selection.medium) &&
          sameScopeValue(scope.grade, selection.grade) &&
          sameScopeValue(scope.subject, selection.subject),
        )
        .map((scope) => scope.cpId),
    ),
  );
}

/** Chapter names of some packs, from whichever content store the account uses. */
export async function chapterNamesForCpIds(cfg: TopscholarConfig, businessAccountId: string, cpIds: string[]): Promise<string[]> {
  if (!cpIds.length) return [];
  return isMongoConnectionString(cfg.contentDbUrl)
    ? getMongoChapterNames({ connectionString: cfg.contentDbUrl!, dbName: cfg.contentDbName, collection: cfg.contentDbCollection }, businessAccountId, cpIds)
    : getChapterNamesForCpIds(cfg, businessAccountId, cpIds);
}
