import { trackTimer } from "../lib/lifecycle";
import { reportError } from "../lib/errorReporter";
import { recordSystemAuditEvent } from "./auditService";
import {
  countDueForAccount,
  getAccountsWithActivePolicy,
  getEffectivePolicy,
  maskAccountContacts,
  purgeAccount,
  recordAccountStatus,
} from "./dataRetentionService";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 2 * 60 * 1000;

/**
 * Applies each account's data-retention policy every 5 minutes. Contact details are
 * hidden first where that is switched on (any mode). Then dry-run accounts only get
 * their due counts recorded; live accounts are purged in batches. Every hide and
 * purge is audit-logged.
 */
export class DataRetentionWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private isProcessing = false;

  start() {
    if (this.intervalId) return;
    console.log('[Data Retention] Starting purge worker (every 5 min, first run in 2 min)');
    trackTimer(setTimeout(() => this.run(), INITIAL_DELAY_MS));
    this.intervalId = trackTimer(setInterval(() => this.run(), CHECK_INTERVAL_MS));
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }

  async run() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const accountIds = await getAccountsWithActivePolicy();
      for (const accountId of accountIds) {
        await this.processAccount(accountId);
      }
    } catch (err) {
      console.error('[Data Retention] Worker error:', err);
      reportError(err, { source: 'worker:data-retention' });
    } finally {
      this.isProcessing = false;
    }
  }

  /** Hiding has its own error handling so a failure there never stops the deleting below. */
  private async maskContacts(accountId: string, policySource: string) {
    try {
      const hidden = await maskAccountContacts(accountId);
      if (hidden === 0) return;
      console.log(`[Data Retention] Account ${accountId}: hid contact details on ${hidden} lead(s)`);
      await recordSystemAuditEvent({
        action: 'data_retention.contacts_masked',
        outcome: 'success',
        actorUsername: 'system:data-retention',
        actorRole: 'system',
        businessAccountId: accountId,
        resourceType: 'business_account',
        resourceId: accountId,
        metadata: { maskedLeads: hidden, policySource },
      }).catch(err => console.error('[Data Retention] Audit write failed:', err));
    } catch (err) {
      console.error(`[Data Retention] Account ${accountId}: hiding contact details failed:`, err);
      reportError(err, { source: 'worker:data-retention-mask' });
    }
  }

  private async processAccount(accountId: string) {
    const policy = await getEffectivePolicy(accountId);
    if (!policy) return;
    try {
      if (policy.maskContactsAfterSync) await this.maskContacts(accountId, policy.source);
      if (policy.mode === 'off') return;

      if (policy.mode === 'dry_run') {
        const due = await countDueForAccount(accountId, policy);
        await recordAccountStatus(accountId, {
          mode: 'dry_run', dueLeads: due.leads, dueConversations: due.idleChats, purgedLeads: 0, purgedConversations: 0,
        });
        return;
      }

      const purged = await purgeAccount(accountId, policy);
      const remaining = await countDueForAccount(accountId, policy);
      await recordAccountStatus(accountId, {
        mode: 'live',
        dueLeads: remaining.leads,
        dueConversations: remaining.idleChats,
        purgedLeads: purged.leads,
        purgedConversations: purged.conversations,
      });

      if (purged.leads + purged.conversations > 0) {
        console.log(`[Data Retention] Account ${accountId}: deleted ${purged.leads} lead(s), ${purged.conversations} conversation(s), ${purged.files} file(s)`);
        await recordSystemAuditEvent({
          action: 'data_retention.purged',
          outcome: 'success',
          actorUsername: 'system:data-retention',
          actorRole: 'system',
          businessAccountId: accountId,
          resourceType: 'business_account',
          resourceId: accountId,
          metadata: {
            deletedLeads: purged.leads,
            deletedConversations: purged.conversations,
            deletedFiles: purged.files,
            policySource: policy.source,
            deleteSyncedAfterMinutes: policy.deleteSyncedAfterMinutes,
            deleteUnsyncedAfterMinutes: policy.deleteUnsyncedAfterMinutes,
            deleteIdleChatsAfterMinutes: policy.deleteIdleChatsAfterMinutes,
          },
        }).catch(err => console.error('[Data Retention] Audit write failed:', err));
      }
    } catch (err: any) {
      console.error(`[Data Retention] Account ${accountId} failed:`, err);
      await recordAccountStatus(accountId, {
        mode: policy.mode, dueLeads: 0, dueConversations: 0, purgedLeads: 0, purgedConversations: 0,
        error: String(err?.message || err).slice(0, 500),
      }).catch(() => {});
    }
  }
}

export const dataRetentionWorker = new DataRetentionWorker();
