/**
 * Archived accounts: business accounts the super admin hides behind a separate
 * Archive password. The business itself keeps working (chat, WhatsApp, calls,
 * its own logins); only super admin screens change.
 *
 *  - business_accounts.archived_at marks an account archived.
 *  - The Archive password is a bcrypt hash in system_settings (ARCHIVE_PASSWORD_KEY).
 *    No "forgot" flow: if it is lost, delete that row from the server and set a new one.
 *  - sessions.archive_unlocked_until: this login has the Archived list unlocked until then.
 *
 * Enforcement lives in requireAuth (server/auth.ts → enforceArchive), so every super admin
 * request goes through it:
 *  - a request that names an archived account (path, query or body), or runs while viewing as
 *    one, needs the Archived list unlocked, else it answers "Business account not found";
 *  - every other super admin response has archived accounts (and archive activity in the audit
 *    log) taken out of its lists, so totals built from those lists leave them out too.
 * The Accounts list and its count also leave them out in SQL, so paging stays right.
 */
import type { Request, Response, NextFunction } from "express";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { businessAccounts, sessions, systemSettings } from "@shared/schema";

export const ARCHIVE_PASSWORD_KEY = "account_archive_password_hash";
export const ARCHIVE_UNLOCK_MINUTES = 15;
export const ARCHIVE_MAX_TRIES = 5;
export const ARCHIVE_LOCKOUT_MINUTES = 15;
export const ARCHIVE_PASSWORD_MIN_LENGTH = 8;
/** Audit actions for the archive itself; shown in the audit log only while unlocked. */
export const ARCHIVE_AUDIT_PREFIX = "account_archive.";

// ── archived ids (cached briefly; every archive / unarchive clears it) ─────────────────────────

let cache: { ids: Set<string>; at: number } | null = null;
const CACHE_MS = 10_000;

export async function archivedAccountIds(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.ids;
  const rows = await db.select({ id: businessAccounts.id }).from(businessAccounts).where(isNotNull(businessAccounts.archivedAt));
  cache = { ids: new Set(rows.map(r => r.id)), at: Date.now() };
  return cache.ids;
}

export function clearArchiveCache() {
  cache = null;
}

export async function setAccountArchived(accountId: string, archived: boolean) {
  await db.update(businessAccounts).set({ archivedAt: archived ? new Date() : null }).where(eq(businessAccounts.id, accountId));
  clearArchiveCache();
}

// ── the Archive password ────────────────────────────────────────────────────────────────────────

export async function getArchivePasswordHash(): Promise<string | null> {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, ARCHIVE_PASSWORD_KEY));
  return row?.value || null;
}

export async function saveArchivePasswordHash(hash: string) {
  await db.insert(systemSettings)
    .values({ key: ARCHIVE_PASSWORD_KEY, value: hash, isEncrypted: "false", description: "Archived accounts password (bcrypt hash)" })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: hash, updatedAt: new Date() } });
  // A new password locks every open Archived list.
  await db.update(sessions).set({ archiveUnlockedUntil: null }).where(isNotNull(sessions.archiveUnlockedUntil));
}

// ── unlock / lock (per login session) ───────────────────────────────────────────────────────────

export async function unlockArchive(sessionToken: string): Promise<Date> {
  const until = new Date(Date.now() + ARCHIVE_UNLOCK_MINUTES * 60_000);
  await db.update(sessions).set({ archiveUnlockedUntil: until }).where(eq(sessions.sessionToken, sessionToken));
  return until;
}

export async function lockArchive(sessionToken: string) {
  await db.update(sessions).set({ archiveUnlockedUntil: null }).where(eq(sessions.sessionToken, sessionToken));
}

// ── wrong-password limit (in memory: a restart clears it) ───────────────────────────────────────

const tries = new Map<string, { failures: number; lockedUntil: number }>();

/** Minutes left on a lockout after too many wrong passwords, or 0. */
export function archiveLockoutMinutes(userId: string): number {
  const t = tries.get(userId);
  if (!t || t.lockedUntil <= Date.now()) return 0;
  return Math.ceil((t.lockedUntil - Date.now()) / 60_000);
}

export function recordArchivePasswordResult(userId: string, ok: boolean) {
  if (ok) { tries.delete(userId); return; }
  const before = tries.get(userId);
  // A lockout that has run out starts the count again.
  const failures = (before && !before.lockedUntil ? before.failures : 0) + 1;
  tries.set(userId, failures >= ARCHIVE_MAX_TRIES
    ? { failures: 0, lockedUntil: Date.now() + ARCHIVE_LOCKOUT_MINUTES * 60_000 }
    : { failures, lockedUntil: 0 });
}

// ── enforcement (called from requireAuth for super admins) ──────────────────────────────────────

const ID_KEYS = ["businessAccountId", "accountId", "sourceBusinessId", "targetBusinessAccountId", "id"];

/** Does this request name an archived account (a path segment, a query value, or an id-like body field)? */
function namesArchived(req: Request, ids: Set<string>): boolean {
  if (req.path.split("/").some(seg => ids.has(seg))) return true;
  for (const v of Object.values(req.query ?? {})) {
    if (typeof v === "string" && ids.has(v)) return true;
    if (Array.isArray(v) && v.some(x => typeof x === "string" && ids.has(x))) return true;
  }
  const body = req.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string" && ids.has(v) && /id$/i.test(k)) return true;
      if (Array.isArray(v) && /ids$/i.test(k) && v.some(x => typeof x === "string" && ids.has(x))) return true;
    }
  }
  return false;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

function refersToArchived(item: unknown, ids: Set<string>): boolean {
  if (typeof item === "string") return ids.has(item);
  if (!isPlainObject(item)) return false;
  if (ID_KEYS.some(k => typeof item[k] === "string" && ids.has(item[k] as string))) return true;
  return typeof item.action === "string" && item.action.startsWith(ARCHIVE_AUDIT_PREFIX);
}

/** Takes archived accounts (and archive audit entries) out of every list in a JSON response. */
export function stripArchived(value: unknown, ids: Set<string>, depth = 0): unknown {
  if (depth > 8) return value;
  if (Array.isArray(value)) {
    return value.filter(item => !refersToArchived(item, ids)).map(item => stripArchived(item, ids, depth + 1));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripArchived(v, ids, depth + 1);
    return out;
  }
  return value;
}

/**
 * Runs inside requireAuth for super admin logins. Answers the request itself ("not found") when it
 * reaches for an archived account while locked; otherwise calls next(), filtering lists as needed.
 */
export async function enforceArchive(req: Request, res: Response, next: NextFunction, unlocked: boolean) {
  const ids = await archivedAccountIds();
  if (ids.size === 0) return next();

  // Viewing as an archived account after the list locked: leave that view.
  const viewing = req.user?.activeBusinessAccountId;
  if (viewing && ids.has(viewing) && !unlocked) {
    await db.update(sessions).set({ activeBusinessAccountId: null })
      .where(and(eq(sessions.sessionToken, req.sessionToken!), eq(sessions.activeBusinessAccountId, viewing)));
    req.user!.activeBusinessAccountId = null;
    req.user!.businessAccountId = null;
  }

  if (namesArchived(req, ids)) {
    if (!unlocked) return res.status(404).json({ error: "Business account not found" });
    return next();
  }
  // The archive's own screens see everything; so, while unlocked, do the audit log (archive activity
  // included) and the portal of an archived account.
  if (req.path.startsWith("/api/super-admin/archive")) return next();
  if (unlocked && (req.path.startsWith("/api/super-admin/audit") || (req.user?.activeBusinessAccountId && ids.has(req.user.activeBusinessAccountId)))) {
    return next();
  }

  const json = res.json.bind(res);
  res.json = ((body: unknown) => json(stripArchived(body, ids))) as typeof res.json;
  next();
}
