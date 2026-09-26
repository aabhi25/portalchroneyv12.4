import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { accountGroupMembers, dataRetentionAccountStatus } from "@shared/schema";
import {
  requireAuth,
  requireRole,
  requireBusinessAccount,
  requireGroupAdmin,
  getGroupAdminPermissions,
  getGroupAdminAccountIdsForGroup,
} from "../auth";
import { storage } from "../storage";
import { recordAuditEventSafely } from "../services/auditService";
import { validateRetentionSettings, type RetentionPolicySettings } from "@shared/dataRetentionPolicy";
import {
  countDueForAccount,
  deleteAccountOverride,
  getAccountCrmTargets,
  getEffectivePolicy,
  getRetentionPolicy,
  getRetentionReport,
  upsertRetentionPolicy,
  type RetentionReportRow,
} from "../services/dataRetentionService";

/**
 * Data retention ("auto-delete") API.
 * - Super admin: read/set group and account policies, preview, report.
 * - Business users and group admins: read the policy that applies (for banners and
 *   countdowns) and the retention report.
 */
const router = Router();

const DEFAULT_SETTINGS: RetentionPolicySettings = {
  mode: 'off',
  deleteSyncedAfterMinutes: 24 * 60,
  deleteUnsyncedAfterMinutes: null,
  deleteIdleChatsAfterMinutes: 24 * 60,
  keepAnonymousCounts: true,
};

function parseScope(req: Request, res: Response): { scopeType: 'group' | 'account'; scopeId: string } | null {
  const { scopeType, scopeId } = req.params;
  if (scopeType !== 'group' && scopeType !== 'account') {
    res.status(400).json({ error: "scopeType must be group or account" });
    return null;
  }
  return { scopeType, scopeId };
}

async function scopeExists(scopeType: 'group' | 'account', scopeId: string) {
  return scopeType === 'group' ? !!(await storage.getAccountGroup(scopeId)) : !!(await storage.getBusinessAccount(scopeId));
}

async function groupAccountIds(groupId: string): Promise<string[]> {
  const rows = await db.select({ id: accountGroupMembers.businessAccountId }).from(accountGroupMembers)
    .where(eq(accountGroupMembers.groupId, groupId));
  return Array.from(new Set(rows.map(r => r.id)));
}

function readSettings(body: any): RetentionPolicySettings {
  const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    mode: body?.mode,
    deleteSyncedAfterMinutes: Number(body?.deleteSyncedAfterMinutes),
    deleteUnsyncedAfterMinutes: numOrNull(body?.deleteUnsyncedAfterMinutes),
    deleteIdleChatsAfterMinutes: numOrNull(body?.deleteIdleChatsAfterMinutes),
    keepAnonymousCounts: body?.keepAnonymousCounts !== false,
  };
}

/** Month "YYYY-MM" in IST (the business timezone) → [from, to). Defaults to the current month. */
function monthRange(month: unknown): { from: Date; to: Date; label: string } {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  let y: number, m: number;
  const match = typeof month === 'string' ? month.match(/^(\d{4})-(\d{2})$/) : null;
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
  } else {
    const nowIst = new Date(Date.now() + IST_OFFSET_MS);
    y = nowIst.getUTCFullYear();
    m = nowIst.getUTCMonth() + 1;
  }
  const from = new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS);
  const to = new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS);
  return { from, to, label: `${y}-${String(m).padStart(2, '0')}` };
}

function sendReport(res: Response, rows: RetentionReportRow[], label: string, format: unknown, title: string) {
  if (format !== 'csv') {
    return res.json({ month: label, rows });
  }
  const header = ['Account', 'Auto-delete', 'Leads captured', 'Leads synced', 'Leads deleted', 'Conversations deleted', 'Leads held now', 'Conversations held now', 'Oldest lead held', 'Due for deletion now', 'Last run'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    `# Data retention report — ${title} — ${label} (IST)`,
    `# Generated ${new Date().toISOString()}. Deletion records hold no personal data.`,
    header.join(','),
    ...rows.map(r => [r.accountName, r.policyMode, r.capturedLeads, r.syncedLeads, r.deletedLeads, r.deletedConversations, r.leadsHeldNow, r.conversationsHeldNow, r.oldestLeadHeld ?? '', r.dueNow ?? '', r.lastRunAt ?? ''].map(esc).join(',')),
  ];
  const safeTitle = title.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="retention-report-${safeTitle}-${label}.csv"`);
  res.send(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Super admin
// ---------------------------------------------------------------------------

router.get("/api/super-admin/data-retention/report", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const scopeType = req.query.scopeType;
    const scopeId = String(req.query.scopeId || '');
    let accountIds: string[];
    let title: string;
    if (scopeType === 'group') {
      const group = await storage.getAccountGroup(scopeId);
      if (!group) return res.status(404).json({ error: "Account group not found" });
      accountIds = await groupAccountIds(scopeId);
      title = group.name;
    } else if (scopeType === 'account') {
      const account = await storage.getBusinessAccount(scopeId);
      if (!account) return res.status(404).json({ error: "Business account not found" });
      accountIds = [scopeId];
      title = account.name;
    } else {
      return res.status(400).json({ error: "scopeType must be group or account" });
    }
    const { from, to, label } = monthRange(req.query.month);
    sendReport(res, await getRetentionReport(accountIds, from, to), label, req.query.format, title);
  } catch (error: any) {
    console.error('[Data Retention] Report error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/super-admin/data-retention/:scopeType/:scopeId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const scope = parseScope(req, res);
    if (!scope) return;
    if (!(await scopeExists(scope.scopeType, scope.scopeId))) return res.status(404).json({ error: "Not found" });

    const policy = await getRetentionPolicy(scope.scopeType, scope.scopeId);
    const response: Record<string, unknown> = {
      policy,
      defaults: DEFAULT_SETTINGS,
    };
    if (scope.scopeType === 'account') {
      response.effective = await getEffectivePolicy(scope.scopeId);
      const [status] = await db.select().from(dataRetentionAccountStatus).where(eq(dataRetentionAccountStatus.businessAccountId, scope.scopeId));
      response.status = status || null;
      const groups = await db.select({ groupId: accountGroupMembers.groupId }).from(accountGroupMembers)
        .where(eq(accountGroupMembers.businessAccountId, scope.scopeId));
      response.groups = await Promise.all(groups.map(async g => ({
        groupId: g.groupId,
        name: (await storage.getAccountGroup(g.groupId))?.name || g.groupId,
        policy: await getRetentionPolicy('group', g.groupId),
      })));
    } else {
      const members = await groupAccountIds(scope.scopeId);
      const overrides = await Promise.all(members.map(async id => ({ id, override: await getRetentionPolicy('account', id) })));
      response.memberCount = members.length;
      response.overriddenAccounts = overrides.filter(o => o.override).length;
    }
    res.json(response);
  } catch (error: any) {
    console.error('[Data Retention] Get policy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Counts what the proposed settings would delete right now (nothing is deleted).
router.post("/api/super-admin/data-retention/:scopeType/:scopeId/preview", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const scope = parseScope(req, res);
    if (!scope) return;
    if (!(await scopeExists(scope.scopeType, scope.scopeId))) return res.status(404).json({ error: "Not found" });
    const settings = readSettings({ ...req.body, mode: 'live' });
    const error = validateRetentionSettings(settings);
    if (error) return res.status(400).json({ error });

    const accountIds = scope.scopeType === 'group' ? await groupAccountIds(scope.scopeId) : [scope.scopeId];
    const accounts = [];
    let totalLeads = 0;
    let totalChats = 0;
    for (const id of accountIds) {
      // Accounts with their own override ignore the group policy.
      const override = scope.scopeType === 'group' ? await getRetentionPolicy('account', id) : null;
      const account = await storage.getBusinessAccount(id);
      if (override) {
        accounts.push({ businessAccountId: id, name: account?.name || id, overridden: true, leads: 0, idleChats: 0 });
        continue;
      }
      const due = await countDueForAccount(id, settings);
      const crm = await getAccountCrmTargets(id);
      totalLeads += due.leads;
      totalChats += due.idleChats;
      accounts.push({ businessAccountId: id, name: account?.name || id, overridden: false, crm, ...due });
    }
    res.json({ totalLeads, totalIdleChats: totalChats, accounts });
  } catch (error: any) {
    console.error('[Data Retention] Preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put("/api/super-admin/data-retention/:scopeType/:scopeId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const scope = parseScope(req, res);
    if (!scope) return;
    if (!(await scopeExists(scope.scopeType, scope.scopeId))) return res.status(404).json({ error: "Not found" });
    const settings = readSettings(req.body);
    const error = validateRetentionSettings(settings);
    if (error) return res.status(400).json({ error });

    const previous = await getRetentionPolicy(scope.scopeType, scope.scopeId);
    if (settings.mode === 'live' && previous?.mode !== 'live' && req.body?.confirmation !== 'CONFIRM') {
      return res.status(400).json({ error: "Type CONFIRM to switch auto-delete to live" });
    }

    const saved = await upsertRetentionPolicy(scope.scopeType, scope.scopeId, settings, req.user!.id);
    await recordAuditEventSafely(req, {
      action: 'data_retention.policy_changed',
      outcome: 'success',
      resourceType: scope.scopeType === 'group' ? 'account_group' : 'business_account',
      resourceId: scope.scopeId,
      businessAccountId: scope.scopeType === 'account' ? scope.scopeId : null,
      metadata: {
        previousMode: previous?.mode ?? 'none',
        mode: settings.mode,
        previousDeleteSyncedAfterMinutes: previous?.deleteSyncedAfterMinutes ?? null,
        deleteSyncedAfterMinutes: settings.deleteSyncedAfterMinutes,
        previousDeleteUnsyncedAfterMinutes: previous?.deleteUnsyncedAfterMinutes ?? null,
        deleteUnsyncedAfterMinutes: settings.deleteUnsyncedAfterMinutes,
        previousDeleteIdleChatsAfterMinutes: previous?.deleteIdleChatsAfterMinutes ?? null,
        deleteIdleChatsAfterMinutes: settings.deleteIdleChatsAfterMinutes,
        keepAnonymousCounts: settings.keepAnonymousCounts,
      },
    });
    res.json({ policy: saved });
  } catch (error: any) {
    console.error('[Data Retention] Save policy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Removes an account's override so it follows its group(s) again.
router.delete("/api/super-admin/data-retention/account/:accountId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const previous = await getRetentionPolicy('account', req.params.accountId);
    await deleteAccountOverride(req.params.accountId);
    await recordAuditEventSafely(req, {
      action: 'data_retention.override_removed',
      outcome: 'success',
      resourceType: 'business_account',
      resourceId: req.params.accountId,
      businessAccountId: req.params.accountId,
      metadata: { previousMode: previous?.mode ?? 'none' },
    });
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Data Retention] Remove override error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Business users and group admins (read-only)
// ---------------------------------------------------------------------------

router.get("/api/data-retention/effective", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const accountId = (req.user as any)?.activeBusinessAccountId || req.user?.businessAccountId;
    if (!accountId) return res.json({ policy: null });
    const policy = await getEffectivePolicy(accountId);
    res.json({ policy, crm: policy ? await getAccountCrmTargets(accountId) : null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function authorizeGroupRead(req: Request, res: Response): Promise<string[] | null> {
  const permissions = await getGroupAdminPermissions(req.user!.id, req.params.groupId);
  if (!permissions || (!permissions.canViewLeads && !permissions.canViewConversations)) {
    res.status(403).json({ error: "Access denied to this group" });
    return null;
  }
  return getGroupAdminAccountIdsForGroup(req.user!.id, req.params.groupId);
}

router.get("/api/group-admin/groups/:groupId/data-retention", requireAuth, requireGroupAdmin, async (req, res) => {
  try {
    const accountIds = await authorizeGroupRead(req, res);
    if (!accountIds) return;
    const accounts: Record<string, unknown> = {};
    for (const id of accountIds) {
      const policy = await getEffectivePolicy(id);
      accounts[id] = policy ? { policy, crm: await getAccountCrmTargets(id) } : null;
    }
    res.json({ accounts });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/group-admin/groups/:groupId/data-retention/report", requireAuth, requireGroupAdmin, async (req, res) => {
  try {
    const accountIds = await authorizeGroupRead(req, res);
    if (!accountIds) return;
    const group = await storage.getAccountGroup(req.params.groupId);
    const { from, to, label } = monthRange(req.query.month);
    sendReport(res, await getRetentionReport(accountIds, from, to), label, req.query.format, group?.name || 'group');
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
