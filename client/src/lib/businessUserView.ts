import type { MeResponseDto } from "@shared/dto";

/**
 * "Business user view": a super admin viewing as an account can see the portal exactly as that
 * account's own login does. Display only — the server still treats them as a super admin.
 *
 * It works at the one place the portal learns who you are (/api/auth/me): the user record is
 * reported as the account's business user, so every "super admin viewing" check turns off at once.
 * The switch is remembered per tab, for the account it was turned on for.
 */
const STORAGE_KEY = "businessUserViewAccountId";

function storedAccountId(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Turn business user view on for this account, or off (null). Reload afterwards. */
export function setBusinessUserView(accountId: string | null): void {
  try {
    if (accountId) sessionStorage.setItem(STORAGE_KEY, accountId);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the switch just won't stick.
  }
}

/** Applied to every /api/auth/me response before the portal sees it. */
export function applyBusinessUserView<T>(me: T): T {
  const user = me as MeResponseDto | null;
  if (
    user?.role === "super_admin" &&
    user.activeBusinessAccountId &&
    storedAccountId() === user.activeBusinessAccountId
  ) {
    return { ...user, role: "business_user", viewingAsBusinessUser: true } as T;
  }
  return me;
}
