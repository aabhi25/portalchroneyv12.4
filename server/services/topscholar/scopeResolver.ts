import { sql, eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { topscholarCpMappings } from '@shared/schema';

/**
 * Grade-scoped TopScholar widget (Option A).
 *
 * A TopScholar client embeds ONE universal widget snippet; their portal injects
 * the logged-in student's board / medium / grade as data attributes. Those values
 * arrive on each chat request and are resolved here into the set of cp_id(s) that
 * make up that student's curriculum, via the admin-maintained
 * `topscholar_cp_mappings` table. RAG retrieval is then hard-filtered to those
 * cp_ids so a student only ever sees their own grade's content.
 *
 * Matching is case-insensitive and whitespace-trimmed on whichever of
 * board/medium/grade/subject the portal supplied. A grade can legitimately map to
 * MULTIPLE cp_ids (one pack per subject), so this always returns a set. When a
 * subject is supplied it narrows that set to the matching pack(s): a subject maps
 * 1:1 to a content pack, and the pack's human name (cp_name, e.g. "6th CBSE
 * Mathematics") is matched case-insensitively against the supplied subject.
 */
export interface StudentScope {
  board?: string | null;
  medium?: string | null;
  grade?: string | null;
  subject?: string | null;
}

function norm(v?: string | null): string {
  return (v ?? '').trim();
}

/** True when the portal supplied at least one scoping value. */
export function hasScope(scope: StudentScope): boolean {
  return !!(norm(scope.board) || norm(scope.medium) || norm(scope.grade) || norm(scope.subject));
}

/**
 * Resolve a student's board/medium/grade to the cp_id(s) for that curriculum.
 * Returns a de-duplicated list; an EMPTY list means the supplied scope matched no
 * synced package (the caller should refuse rather than fall back to whole-account).
 */
export async function resolveCpIdsForScope(
  businessAccountId: string,
  scope: StudentScope,
): Promise<string[]> {
  const board = norm(scope.board);
  const medium = norm(scope.medium);
  const grade = norm(scope.grade);
  const subject = norm(scope.subject);

  const conditions = [eq(topscholarCpMappings.businessAccountId, businessAccountId)];
  if (board) conditions.push(sql`lower(trim(${topscholarCpMappings.board})) = lower(${board})`);
  if (medium) conditions.push(sql`lower(trim(${topscholarCpMappings.medium})) = lower(${medium})`);
  if (grade) conditions.push(sql`lower(trim(${topscholarCpMappings.grade})) = lower(${grade})`);
  // Subject narrows to a single pack. Prefer the CMS subject name (the `subject`
  // column, captured at resolve/sync time), and fall back to the legacy `cp_name`
  // so portals still passing the old cp_name-style value keep matching. A supplied
  // subject that matches neither resolves to no pack (so it fails closed).
  if (subject) {
    conditions.push(
      sql`(lower(trim(${topscholarCpMappings.subject})) = lower(${subject}) OR lower(trim(${topscholarCpMappings.cpName})) = lower(${subject}))`,
    );
  }

  const rows = await db
    .select({ cpId: topscholarCpMappings.cpId })
    .from(topscholarCpMappings)
    .where(and(...conditions));

  return Array.from(new Set(rows.map((r) => r.cpId).filter(Boolean)));
}

// ---- Detailed resolution (Debug Dashboard) ---------------------------------

export interface MatchedMappingRow {
  cpId: string;
  board: string | null;
  medium: string | null;
  grade: string | null;
  subject: string | null;
  cpName: string | null;
}

export interface DetailedScopeResult {
  cpIds: string[];
  matchedRows: MatchedMappingRow[];
  explanation: string;
  /** When 0 matches: what IS available for the nearest broader scope, to guide the admin. */
  availableForBroaderScope: MatchedMappingRow[];
}

/**
 * Same matching logic as resolveCpIdsForScope, but returns the full matched rows
 * plus a human explanation and, on a miss, the subjects that ARE available for
 * the same board/medium/grade. Debug/admin use only.
 */
export async function resolveScopeDetailed(
  businessAccountId: string,
  scope: StudentScope,
): Promise<DetailedScopeResult> {
  const board = norm(scope.board);
  const medium = norm(scope.medium);
  const grade = norm(scope.grade);
  const subject = norm(scope.subject);

  const baseConditions = [eq(topscholarCpMappings.businessAccountId, businessAccountId)];
  if (board) baseConditions.push(sql`lower(trim(${topscholarCpMappings.board})) = lower(${board})`);
  if (medium) baseConditions.push(sql`lower(trim(${topscholarCpMappings.medium})) = lower(${medium})`);
  if (grade) baseConditions.push(sql`lower(trim(${topscholarCpMappings.grade})) = lower(${grade})`);

  const fullConditions = [...baseConditions];
  if (subject) {
    fullConditions.push(
      sql`(lower(trim(${topscholarCpMappings.subject})) = lower(${subject}) OR lower(trim(${topscholarCpMappings.cpName})) = lower(${subject}))`,
    );
  }

  const cols = {
    cpId: topscholarCpMappings.cpId,
    board: topscholarCpMappings.board,
    medium: topscholarCpMappings.medium,
    grade: topscholarCpMappings.grade,
    subject: topscholarCpMappings.subject,
    cpName: topscholarCpMappings.cpName,
  };

  const matchedRows = await db.select(cols).from(topscholarCpMappings).where(and(...fullConditions));
  const cpIds = Array.from(new Set(matchedRows.map((r) => r.cpId).filter(Boolean)));

  const scopeLabel = [board, medium, grade, subject].filter(Boolean).join(' / ') || '(no scope supplied)';
  let explanation: string;
  let availableForBroaderScope: MatchedMappingRow[] = [];

  if (cpIds.length > 0) {
    explanation = `${cpIds.length} content pack(s) matched for ${scopeLabel}. The AI will answer ONLY from these packs.`;
  } else {
    // Show what exists at the board/medium/grade level so the admin can see the gap.
    availableForBroaderScope = await db
      .select(cols)
      .from(topscholarCpMappings)
      .where(and(...baseConditions))
      .limit(50);
    if (availableForBroaderScope.length > 0) {
      const subjects = Array.from(
        new Set(availableForBroaderScope.map((r) => (r.subject || r.cpName || '').trim()).filter(Boolean)),
      );
      explanation = `NO content pack matched ${scopeLabel}. ${subject ? `Subject "${subject}" has no uploaded content for this board/grade.` : ''} Available subject(s) at this level: ${subjects.length > 0 ? subjects.join(', ') : '(rows exist but have blank subject names)'}. Until content is uploaded, the AI has NOTHING curriculum-specific to answer from for this subject.`;
    } else {
      explanation = `NO content pack matched ${scopeLabel}, and nothing exists for this board/medium/grade at all. Upload content for this curriculum first.`;
    }
  }

  return { cpIds, matchedRows, explanation, availableForBroaderScope };
}

/** All distinct board/medium/grade/subject combos with content (for the debug UI dropdown/reference). */
export async function listAvailableScopes(businessAccountId: string): Promise<MatchedMappingRow[]> {
  return db
    .select({
      cpId: topscholarCpMappings.cpId,
      board: topscholarCpMappings.board,
      medium: topscholarCpMappings.medium,
      grade: topscholarCpMappings.grade,
      subject: topscholarCpMappings.subject,
      cpName: topscholarCpMappings.cpName,
    })
    .from(topscholarCpMappings)
    .where(eq(topscholarCpMappings.businessAccountId, businessAccountId))
    .orderBy(topscholarCpMappings.board, topscholarCpMappings.grade, topscholarCpMappings.subject)
    .limit(500);
}
