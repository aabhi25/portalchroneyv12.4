import type { MeResponseDto } from "@shared/dto";

/**
 * TopScholar management tools are intentionally available only while a
 * superadmin is viewing the active TopScholar business account.
 *
 * Checking both IDs prevents stale account data from keeping these controls
 * visible during or after an account switch.
 */
export function isTopScholarSuperAdminView(user: MeResponseDto | null | undefined): boolean {
  return (
    user?.role === "super_admin" &&
    !!user.activeBusinessAccountId &&
    user.businessAccount?.id === user.activeBusinessAccountId &&
    user.businessAccount.isTopscholar === true
  );
}