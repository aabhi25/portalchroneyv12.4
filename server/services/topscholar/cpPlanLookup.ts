import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { topscholarCpMappings, topscholarPlanCpResolutions, topscholarPlanIds } from '@shared/schema';

/**
 * CP ID -> owning Plan ID lookups. The Content Bundle service accepts Plan IDs only,
 * so every CP-ID-driven refresh (admin "Embed CP IDs", inventory resync, the LMS
 * embedding API) starts from a link we previously received from that service.
 * Database reads only, so ingestion code can use it without import cycles.
 */

/**
 * Returns the most recently confirmed owning Plan ID for each requested CP ID.
 * The Content Bundle service accepts Plan IDs (not CP IDs), so every targeted
 * refresh must start from a mapping we previously received from that service.
 */
export async function findKnownPlanIdsForCpIds(
  businessAccountId: string,
  cpIds: string[],
): Promise<Map<string, string>> {
  const uniqueCpIds = Array.from(new Set(cpIds.map((cpId) => cpId.trim()).filter(Boolean)));
  if (uniqueCpIds.length === 0) return new Map();

  const [resolutions, mappings, legacyPlans] = await Promise.all([
    db
      .select({
        cpId: topscholarPlanCpResolutions.cpId,
        planId: topscholarPlanCpResolutions.planId,
      })
      .from(topscholarPlanCpResolutions)
      .where(and(
        eq(topscholarPlanCpResolutions.businessAccountId, businessAccountId),
        inArray(topscholarPlanCpResolutions.cpId, uniqueCpIds),
      ))
      .orderBy(desc(topscholarPlanCpResolutions.lastResolvedAt), desc(topscholarPlanCpResolutions.updatedAt)),
    db
      .select({
        cpId: topscholarCpMappings.cpId,
        planId: topscholarCpMappings.planId,
      })
      .from(topscholarCpMappings)
      .where(and(
        eq(topscholarCpMappings.businessAccountId, businessAccountId),
        inArray(topscholarCpMappings.cpId, uniqueCpIds),
      ))
      .orderBy(desc(topscholarCpMappings.updatedAt)),
    db
      .select({
        cpId: topscholarPlanIds.lastCpId,
        planId: topscholarPlanIds.planId,
      })
      .from(topscholarPlanIds)
      .where(and(
        eq(topscholarPlanIds.businessAccountId, businessAccountId),
        inArray(topscholarPlanIds.lastCpId, uniqueCpIds),
      ))
      .orderBy(desc(topscholarPlanIds.updatedAt)),
  ]);

  const planByCpId = new Map<string, string>();
  for (const row of resolutions) {
    if (!planByCpId.has(row.cpId)) planByCpId.set(row.cpId, row.planId);
  }
  for (const row of mappings) {
    if (row.planId && !planByCpId.has(row.cpId)) planByCpId.set(row.cpId, row.planId);
  }
  for (const row of legacyPlans) {
    if (row.cpId && !planByCpId.has(row.cpId)) planByCpId.set(row.cpId, row.planId);
  }
  return planByCpId;
}

/**
 * Every Plan ID a CP ID has been linked to, most recently confirmed first. Used to
 * retry a package under another plan when its remembered plan no longer contains it
 * (TopScholar moved the package).
 */
export async function findAllKnownPlanIdsForCp(businessAccountId: string, cpId: string): Promise<string[]> {
  const [resolutions, mappings] = await Promise.all([
    db
      .select({ planId: topscholarPlanCpResolutions.planId })
      .from(topscholarPlanCpResolutions)
      .where(and(
        eq(topscholarPlanCpResolutions.businessAccountId, businessAccountId),
        eq(topscholarPlanCpResolutions.cpId, cpId),
      ))
      .orderBy(desc(topscholarPlanCpResolutions.lastResolvedAt), desc(topscholarPlanCpResolutions.updatedAt)),
    db
      .select({ planId: topscholarCpMappings.planId })
      .from(topscholarCpMappings)
      .where(and(eq(topscholarCpMappings.businessAccountId, businessAccountId), eq(topscholarCpMappings.cpId, cpId))),
  ]);
  const ordered = [...resolutions.map((r) => r.planId), ...mappings.map((m) => m.planId)]
    .filter((planId): planId is string => typeof planId === 'string' && planId.trim().length > 0);
  return Array.from(new Set(ordered));
}
