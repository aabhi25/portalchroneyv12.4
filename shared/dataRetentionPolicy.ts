/**
 * Pure data-retention rules (no database access), shared by the purge worker,
 * the API and the tests. The worker's SQL implements the same rules; keep them
 * in step when changing either.
 */

export type RetentionMode = 'off' | 'dry_run' | 'live';

export interface RetentionPolicySettings {
  mode: RetentionMode;
  deleteSyncedAfterMinutes: number;
  deleteUnsyncedAfterMinutes: number | null; // null = keep leads that never sync
  deleteIdleChatsAfterMinutes: number | null; // null = keep chats with no lead
  keepAnonymousCounts: boolean;
  /**
   * Separate from deleting: once a lead has synced, overwrite its phone numbers and emails
   * (on the lead, in its chat, answers and summary) with masked versions. Works in any mode.
   */
  maskContactsAfterSync: boolean;
}

export interface EffectiveRetentionPolicy extends RetentionPolicySettings {
  source: 'account' | 'group';
  sourceIds: string[]; // the account ID, or the group IDs combined
}

/** A conversation must be idle this long before anything in it is deleted. */
export const RETENTION_IDLE_GUARD_MINUTES = 30;

/**
 * Contact details are hidden once the chat has been quiet this long AND its final summary has
 * gone to the CRM (the summary is pushed about a minute after the chat goes quiet)...
 */
export const MASK_QUIET_MINUTES = 5;
/** ...or, when no summary arrives (short chats, AI errors), once it has been quiet this long. */
export const MASK_FALLBACK_QUIET_MINUTES = 30;

/** A policy that does something: deletes (live or dry run) and/or hides contact details. */
export function isPolicyActive(p: Pick<RetentionPolicySettings, 'mode' | 'maskContactsAfterSync'>): boolean {
  return p.mode !== 'off' || p.maskContactsAfterSync === true;
}

export const RETENTION_LIMITS = {
  minMinutes: 15,
  maxMinutes: 365 * 24 * 60,
};

const MODE_RANK: Record<RetentionMode, number> = { off: 0, dry_run: 1, live: 2 };

/**
 * An account in several groups gets the strictest combination of the groups'
 * active policies: the most active mode, the shortest times, and a timer
 * wherever any group sets one.
 */
export function combineGroupPolicies(policies: (RetentionPolicySettings & { scopeId: string })[]): EffectiveRetentionPolicy | null {
  const active = policies.filter(isPolicyActive);
  if (active.length === 0) return null;
  // Delete timers come only from groups that delete; a group that only hides details has none.
  const deleting = active.filter(p => p.mode !== 'off');
  const minOrNull = (values: (number | null)[]) => {
    const set = values.filter((v): v is number => v !== null && v !== undefined);
    return set.length ? Math.min(...set) : null;
  };
  return {
    mode: active.reduce<RetentionMode>((m, p) => (MODE_RANK[p.mode] > MODE_RANK[m] ? p.mode : m), 'off'),
    deleteSyncedAfterMinutes: deleting.length ? Math.min(...deleting.map(p => p.deleteSyncedAfterMinutes)) : active[0].deleteSyncedAfterMinutes,
    deleteUnsyncedAfterMinutes: minOrNull(deleting.map(p => p.deleteUnsyncedAfterMinutes)),
    deleteIdleChatsAfterMinutes: minOrNull(deleting.map(p => p.deleteIdleChatsAfterMinutes)),
    keepAnonymousCounts: deleting.length ? deleting.some(p => p.keepAnonymousCounts) : true,
    maskContactsAfterSync: active.some(p => p.maskContactsAfterSync === true),
    source: 'group',
    sourceIds: active.map(p => p.scopeId),
  };
}

/**
 * Which CRMs an account pushes web leads to. A lead counts as synced only when
 * every one of them confirmed it. (The custom CRM relay handles WhatsApp leads
 * only, so it never gates web leads.)
 */
export interface AccountCrmTargets {
  leadsquared: boolean;
  salesforce: boolean;
}

export interface LeadSyncFields {
  leadsquaredSyncStatus?: string | null;
  leadsquaredSyncedAt?: Date | string | null;
  salesforceSyncStatus?: string | null;
  salesforceSyncedAt?: Date | string | null;
}

const toDate = (v: Date | string | null | undefined) => (v ? new Date(v) : null);

export function leadSyncState(lead: LeadSyncFields, crm: AccountCrmTargets): { synced: boolean; syncedAt: Date | null } {
  const targets: { status?: string | null; at?: Date | string | null }[] = [];
  if (crm.leadsquared) targets.push({ status: lead.leadsquaredSyncStatus, at: lead.leadsquaredSyncedAt });
  if (crm.salesforce) targets.push({ status: lead.salesforceSyncStatus, at: lead.salesforceSyncedAt });
  if (targets.length === 0) return { synced: false, syncedAt: null };
  if (!targets.every(t => t.status === 'synced')) return { synced: false, syncedAt: null };
  const times = targets.map(t => toDate(t.at)).filter((d): d is Date => !!d);
  // The timer runs from the LAST successful sync, so later updates reach the CRM first.
  return { synced: true, syncedAt: times.length ? new Date(Math.max(...times.map(d => d.getTime()))) : null };
}

export type LeadRetentionDecision =
  | { due: false; dueAt: Date | null; keptReason?: 'not_synced' | 'chat_active' }
  | { due: true; reason: 'synced_retention' | 'unsynced_retention' };

/**
 * When a lead may be deleted. `lastActivityAt` is the newest message in its
 * conversation (null when there is no conversation).
 */
export function decideLead(
  lead: LeadSyncFields & { createdAt: Date | string },
  policy: RetentionPolicySettings,
  crm: AccountCrmTargets,
  lastActivityAt: Date | null,
  now: Date,
): LeadRetentionDecision {
  const { synced, syncedAt } = leadSyncState(lead, crm);
  const createdAt = new Date(lead.createdAt);
  let dueAt: Date | null = null;
  let reason: 'synced_retention' | 'unsynced_retention' | null = null;

  if (synced) {
    const from = syncedAt ?? createdAt;
    dueAt = new Date(from.getTime() + policy.deleteSyncedAfterMinutes * 60_000);
    reason = 'synced_retention';
  } else if (policy.deleteUnsyncedAfterMinutes !== null) {
    dueAt = new Date(createdAt.getTime() + policy.deleteUnsyncedAfterMinutes * 60_000);
    reason = 'unsynced_retention';
  } else {
    return { due: false, dueAt: null, keptReason: 'not_synced' };
  }

  if (dueAt.getTime() > now.getTime()) return { due: false, dueAt };
  if (lastActivityAt && now.getTime() - lastActivityAt.getTime() < RETENTION_IDLE_GUARD_MINUTES * 60_000) {
    return { due: false, dueAt, keptReason: 'chat_active' };
  }
  return { due: true, reason: reason! };
}

/** Validates settings coming from the API; returns an error message or null. */
export function validateRetentionSettings(input: Partial<RetentionPolicySettings>): string | null {
  if (!input.mode || !['off', 'dry_run', 'live'].includes(input.mode)) return 'mode must be off, dry_run or live';
  if (input.maskContactsAfterSync !== undefined && typeof input.maskContactsAfterSync !== 'boolean') return 'maskContactsAfterSync must be true or false';
  const inRange = (v: number) => Number.isInteger(v) && v >= RETENTION_LIMITS.minMinutes && v <= RETENTION_LIMITS.maxMinutes;
  if (typeof input.deleteSyncedAfterMinutes !== 'number' || !inRange(input.deleteSyncedAfterMinutes)) {
    return 'Delete-after-sync time must be between 15 minutes and 365 days';
  }
  for (const [label, v] of [['never-synced', input.deleteUnsyncedAfterMinutes], ['idle-chat', input.deleteIdleChatsAfterMinutes]] as const) {
    if (v !== null && v !== undefined && (typeof v !== 'number' || !inRange(v))) {
      return `The ${label} time must be between 15 minutes and 365 days, or empty to keep`;
    }
  }
  return null;
}

/** Classifies a lead for anonymous analytics, matching the account-analytics rules. */
export function classifyLeadForCounts(lead: { topicsOfInterest?: unknown; sourceUrl?: string | null }, inJourney: boolean) {
  const topics = Array.isArray(lead.topicsOfInterest) ? (lead.topicsOfInterest as string[]) : [];
  const isForm = topics.includes('Via Form');
  return {
    source: isForm ? 'form' : inJourney ? 'journey' : 'chat',
    isDiscount: topics.includes('Discount Availed'),
    isPaid: !!(lead.sourceUrl && lead.sourceUrl.includes('utm_')),
  };
}
