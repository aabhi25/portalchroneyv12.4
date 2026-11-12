/**
 * Archived accounts (super admin): the Archive password, unlocking the Archived list, and
 * archiving / unarchiving accounts. How archived accounts stay hidden: server/services/accountArchive.ts.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { businessAccounts, sessions } from "@shared/schema";
import { toBusinessAccountDto } from "@shared/dto/businessAccount";
import { requireAuth, requireRole, hashPassword, verifyPassword } from "../auth";
import { storage } from "../storage";
import { recordAuditEventSafely } from "../services/auditService";
import {
  ARCHIVE_AUDIT_PREFIX, ARCHIVE_LOCKOUT_MINUTES, ARCHIVE_PASSWORD_MIN_LENGTH,
  archiveLockoutMinutes, getArchivePasswordHash, lockArchive, recordArchivePasswordResult,
  saveArchivePasswordHash, setAccountArchived, unlockArchive,
} from "../services/accountArchive";

const router = Router();
const superAdmin = [requireAuth, requireRole("super_admin")];

async function unlockedUntil(req: Request): Promise<Date | null> {
  const [row] = await db.select({ until: sessions.archiveUnlockedUntil }).from(sessions).where(eq(sessions.sessionToken, req.sessionToken!));
  return row?.until && row.until.getTime() > Date.now() ? row.until : null;
}

/**
 * Checks the Archive password, counting wrong tries. Sends the error response itself and returns
 * false when the password is not set, wrong, or the user is locked out.
 */
async function checkArchivePassword(req: Request, res: Response, password: unknown): Promise<boolean> {
  const hash = await getArchivePasswordHash();
  if (!hash) {
    res.status(409).json({ error: "Set an Archive password first", code: "no_password" });
    return false;
  }
  const wait = archiveLockoutMinutes(req.user!.id);
  if (wait > 0) {
    res.status(429).json({ error: `Too many wrong passwords. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` });
    return false;
  }
  const ok = typeof password === "string" && password.length > 0 && await verifyPassword(password, hash);
  recordArchivePasswordResult(req.user!.id, ok);
  if (!ok) {
    await recordAuditEventSafely(req, { action: `${ARCHIVE_AUDIT_PREFIX}wrong_password`, outcome: "failure", resourceType: "account_archive" });
    const nowLocked = archiveLockoutMinutes(req.user!.id) > 0;
    res.status(403).json({ error: nowLocked ? `Wrong password. Locked for ${ARCHIVE_LOCKOUT_MINUTES} minutes after too many tries.` : "Wrong Archive password" });
    return false;
  }
  return true;
}

/** Where the Archived list stands for this login. Says nothing about which accounts are archived. */
router.get("/api/super-admin/archive/status", ...superAdmin, async (req, res) => {
  try {
    const until = await unlockedUntil(req);
    res.json({
      passwordSet: !!(await getArchivePasswordHash()),
      unlocked: !!until,
      unlockedUntil: until?.toISOString() ?? null,
      lockedOutMinutes: archiveLockoutMinutes(req.user!.id),
    });
  } catch (error) {
    console.error("[Archive] status error:", error);
    res.status(500).json({ error: "Failed to load archive status" });
  }
});

const passwordBody = z.object({
  newPassword: z.string().min(ARCHIVE_PASSWORD_MIN_LENGTH, `Use at least ${ARCHIVE_PASSWORD_MIN_LENGTH} characters`).max(200),
  loginPassword: z.string().optional(),
  currentPassword: z.string().optional(),
});

/** Set the Archive password (first time: confirmed with the login password) or change it (with the current one). */
router.post("/api/super-admin/archive/password", ...superAdmin, async (req, res) => {
  try {
    const parsed = passwordBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid password" });
    const { newPassword, loginPassword, currentPassword } = parsed.data;
    const existing = await getArchivePasswordHash();
    if (existing) {
      if (!(await checkArchivePassword(req, res, currentPassword))) return;
    } else {
      const user = await storage.getUser(req.user!.id);
      if (!user || !loginPassword || !(await verifyPassword(loginPassword, user.passwordHash))) {
        return res.status(403).json({ error: "Your login password is not right" });
      }
    }
    await saveArchivePasswordHash(await hashPassword(newPassword));
    await recordAuditEventSafely(req, { action: `${ARCHIVE_AUDIT_PREFIX}${existing ? "password_changed" : "password_set"}`, outcome: "success", resourceType: "account_archive" });
    res.json({ ok: true });
  } catch (error) {
    console.error("[Archive] password error:", error);
    res.status(500).json({ error: "Failed to save the Archive password" });
  }
});

router.post("/api/super-admin/archive/unlock", ...superAdmin, async (req, res) => {
  try {
    if (!(await checkArchivePassword(req, res, req.body?.password))) return;
    const until = await unlockArchive(req.sessionToken!);
    await recordAuditEventSafely(req, { action: `${ARCHIVE_AUDIT_PREFIX}unlocked`, outcome: "success", resourceType: "account_archive" });
    res.json({ unlocked: true, unlockedUntil: until.toISOString() });
  } catch (error) {
    console.error("[Archive] unlock error:", error);
    res.status(500).json({ error: "Failed to unlock" });
  }
});

router.post("/api/super-admin/archive/lock", ...superAdmin, async (req, res) => {
  try {
    await lockArchive(req.sessionToken!);
    res.json({ unlocked: false });
  } catch (error) {
    console.error("[Archive] lock error:", error);
    res.status(500).json({ error: "Failed to lock" });
  }
});

/** The Archived list (only while unlocked). */
router.get("/api/super-admin/archive/accounts", ...superAdmin, async (req, res) => {
  try {
    if (!(await unlockedUntil(req))) return res.status(423).json({ error: "The Archived list is locked", code: "locked" });
    const rows = await db.select().from(businessAccounts).where(isNotNull(businessAccounts.archivedAt)).orderBy(desc(businessAccounts.archivedAt));
    res.json({ accounts: rows.map(toBusinessAccountDto) });
  } catch (error) {
    console.error("[Archive] list error:", error);
    res.status(500).json({ error: "Failed to load archived accounts" });
  }
});

/** Archive an account (confirmed with the Archive password). */
router.post("/api/business-accounts/:id/archive", ...superAdmin, async (req, res) => {
  try {
    const account = await storage.getBusinessAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Business account not found" });
    if (!(await checkArchivePassword(req, res, req.body?.password))) return;
    await setAccountArchived(account.id, true);
    await recordAuditEventSafely(req, {
      action: `${ARCHIVE_AUDIT_PREFIX}archived`, outcome: "success", businessAccountId: account.id,
      resourceType: "business_account", resourceId: account.id, metadata: { name: account.name },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("[Archive] archive error:", error);
    res.status(500).json({ error: "Failed to archive the account" });
  }
});

/** Unarchive (the path names an archived account, so the list must be unlocked to get here). */
router.post("/api/super-admin/archive/accounts/:id/unarchive", ...superAdmin, async (req, res) => {
  try {
    const account = await storage.getBusinessAccount(req.params.id);
    if (!account || !account.archivedAt) return res.status(404).json({ error: "Archived account not found" });
    await setAccountArchived(account.id, false);
    await recordAuditEventSafely(req, {
      action: `${ARCHIVE_AUDIT_PREFIX}unarchived`, outcome: "success", businessAccountId: account.id,
      resourceType: "business_account", resourceId: account.id, metadata: { name: account.name },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("[Archive] unarchive error:", error);
    res.status(500).json({ error: "Failed to unarchive the account" });
  }
});

export default router;
