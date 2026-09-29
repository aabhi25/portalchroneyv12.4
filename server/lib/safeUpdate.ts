/**
 * Mass-assignment guard for tenant-scoped updates/creates.
 *
 * Many update endpoints hand the request body to Drizzle's `.set({...})`. The
 * WHERE clause checks ownership, but without this guard the SET clause would
 * let a caller rewrite ownership / parent keys — e.g. move a product into
 * another business account, or re-parent a journey step into another
 * tenant's journey.
 *
 * `stripProtectedFields` returns a shallow copy without:
 *   - identity / tenancy keys (id, businessAccountId, business_account_id)
 *   - server-managed timestamps (createdAt, created_at, updatedAt, updated_at)
 *   - any extra keys the caller names (foreign keys such as journeyId, flowId)
 *
 * Callers that legitimately need to change one of these fields must set it
 * explicitly AFTER spreading the sanitised object.
 */
export const BASE_PROTECTED_FIELDS = [
  'id',
  'businessAccountId',
  'business_account_id',
  'createdAt',
  'created_at',
  'updatedAt',
  'updated_at',
] as const;

// Note: the return type is T (not Omit<T, ...>) so typed call sites keep
// compiling; the protected keys are removed at runtime regardless of type.
export function stripProtectedFields<T extends Record<string, any>>(
  obj: T | null | undefined,
  extra: readonly string[] = [],
): T {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {} as T;
  const blocked = new Set<string>([...BASE_PROTECTED_FIELDS, ...extra]);
  const out: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    if (blocked.has(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = (obj as any)[key];
  }
  return out as T;
}

/** Keep only the listed keys (allow-list). Undefined values are dropped. */
export function pickAllowedFields<T extends Record<string, any>, K extends string>(
  obj: T | null | undefined,
  allowed: readonly K[],
): Partial<Record<K, any>> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: Record<string, any> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && (obj as any)[key] !== undefined) {
      out[key] = (obj as any)[key];
    }
  }
  return out as Partial<Record<K, any>>;
}
