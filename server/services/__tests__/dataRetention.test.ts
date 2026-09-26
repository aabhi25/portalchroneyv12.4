/**
 * Tests for the data-retention rules and log redaction.
 * Run manually: `npx tsx server/services/__tests__/dataRetention.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import {
  combineGroupPolicies,
  decideLead,
  leadSyncState,
  validateRetentionSettings,
  classifyLeadForCounts,
  type RetentionPolicySettings,
} from "@shared/dataRetentionPolicy";
import { redactPII } from "../../logRedaction";

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) {
    failed++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const H = 60; // minutes
const now = new Date("2026-09-26T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

const policy: RetentionPolicySettings = {
  mode: 'live',
  deleteSyncedAfterMinutes: 24 * H,
  deleteUnsyncedAfterMinutes: null,
  deleteIdleChatsAfterMinutes: 24 * H,
  keepAnonymousCounts: true,
};
const lsqOnly = { leadsquared: true, salesforce: false };

// ── Synced leads ─────────────────────────────────────────────────────────────
{
  const lead = { createdAt: ago(48 * H), leadsquaredSyncStatus: 'synced', leadsquaredSyncedAt: ago(25 * H) };
  const d = decideLead(lead, policy, lsqOnly, ago(25 * H), now);
  expect(d.due && d.reason === 'synced_retention', "synced 25h ago with 24h retention → due");
}
{
  const lead = { createdAt: ago(48 * H), leadsquaredSyncStatus: 'synced', leadsquaredSyncedAt: ago(2 * H) };
  const d = decideLead(lead, policy, lsqOnly, null, now);
  expect(!d.due && d.dueAt && Math.round((d.dueAt.getTime() - now.getTime()) / 3_600_000) === 22, "re-synced 2h ago → not due, due in 22h (timer from LAST sync)");
}
{
  const lead = { createdAt: ago(48 * H), leadsquaredSyncStatus: 'synced', leadsquaredSyncedAt: ago(25 * H) };
  const d = decideLead(lead, policy, lsqOnly, ago(10), now);
  expect(!d.due && (d as any).keptReason === 'chat_active', "due but chat active 10 min ago → kept");
}
{
  const lead = { createdAt: ago(48 * H), leadsquaredSyncStatus: 'synced', leadsquaredSyncedAt: ago(25 * H) };
  const d = decideLead(lead, policy, lsqOnly, ago(31), now);
  expect(d.due, "due and chat idle 31 min → deleted");
}

// ── Leads that never sync ────────────────────────────────────────────────────
for (const status of [null, 'failed', 'pending', 'needs_attention', 'permanently_failed', 'disqualified']) {
  const lead = { createdAt: ago(30 * 24 * H), leadsquaredSyncStatus: status };
  const d = decideLead(lead, policy, lsqOnly, null, now);
  expect(!d.due && (d as any).keptReason === 'not_synced', `unsynced (${status}) with no timer → kept forever`);
}
{
  const withTimer = { ...policy, deleteUnsyncedAfterMinutes: 72 * H };
  const old = decideLead({ createdAt: ago(73 * H), leadsquaredSyncStatus: 'failed' }, withTimer, lsqOnly, null, now);
  const young = decideLead({ createdAt: ago(71 * H), leadsquaredSyncStatus: 'failed' }, withTimer, lsqOnly, null, now);
  expect(old.due && (old as any).reason === 'unsynced_retention', "unsynced timer 72h, lead 73h old → due");
  expect(!young.due, "unsynced timer 72h, lead 71h old → kept");
}
{
  const noCrm = { leadsquared: false, salesforce: false };
  const d = decideLead({ createdAt: ago(90 * 24 * H), leadsquaredSyncStatus: 'synced', leadsquaredSyncedAt: ago(90 * 24 * H) }, policy, noCrm, null, now);
  expect(!d.due, "account with no CRM → every lead counts as never synced → kept");
}

// ── Multiple CRMs ────────────────────────────────────────────────────────────
{
  const both = { leadsquared: true, salesforce: true };
  const half = leadSyncState({ leadsquaredSyncStatus: 'synced', leadsquaredSyncedAt: ago(30 * H), salesforceSyncStatus: 'failed' }, both);
  expect(!half.synced, "LSQ + Salesforce: only LSQ synced → not synced");
  const full = leadSyncState({ leadsquaredSyncStatus: 'synced', leadsquaredSyncedAt: ago(30 * H), salesforceSyncStatus: 'synced', salesforceSyncedAt: ago(26 * H) }, both);
  expect(full.synced && full.syncedAt!.getTime() === ago(26 * H).getTime(), "both synced → timer from the later sync");
}

// ── Group combination ────────────────────────────────────────────────────────
{
  const a = { ...policy, scopeId: 'g1', mode: 'dry_run' as const, deleteSyncedAfterMinutes: 24 * H, deleteUnsyncedAfterMinutes: null };
  const b = { ...policy, scopeId: 'g2', mode: 'live' as const, deleteSyncedAfterMinutes: 6 * H, deleteUnsyncedAfterMinutes: 7 * 24 * H, keepAnonymousCounts: false };
  const off = { ...policy, scopeId: 'g3', mode: 'off' as const, deleteSyncedAfterMinutes: 15 };
  const c = combineGroupPolicies([a, b, off])!;
  expect(c.mode === 'live', "strictest mode wins (live)");
  expect(c.deleteSyncedAfterMinutes === 6 * H, "shortest delete-after-sync wins; 'off' groups ignored");
  expect(c.deleteUnsyncedAfterMinutes === 7 * 24 * H, "any group's unsynced timer applies");
  expect(c.keepAnonymousCounts === true, "counts kept if any group keeps them");
  expect(combineGroupPolicies([off]) === null, "only 'off' groups → no policy");
}

// ── Validation ───────────────────────────────────────────────────────────────
expect(validateRetentionSettings(policy) === null, "valid settings accepted");
expect(validateRetentionSettings({ ...policy, deleteSyncedAfterMinutes: 5 }) !== null, "under 15 minutes rejected");
expect(validateRetentionSettings({ ...policy, deleteUnsyncedAfterMinutes: 10 }) !== null, "unsynced timer under 15 minutes rejected");
expect(validateRetentionSettings({ ...policy, mode: 'bogus' as any }) !== null, "unknown mode rejected");

// ── Anonymous classification ────────────────────────────────────────────────
{
  const f = classifyLeadForCounts({ topicsOfInterest: ['Via Form', 'Discount Availed'], sourceUrl: 'https://x.com/?utm_source=g' }, false);
  expect(f.source === 'form' && f.isDiscount && f.isPaid, "form + discount + paid classified");
  const j = classifyLeadForCounts({ topicsOfInterest: [], sourceUrl: 'https://x.com/' }, true);
  expect(j.source === 'journey' && !j.isPaid, "journey organic classified");
}

// ── Log redaction ────────────────────────────────────────────────────────────
{
  const r = redactPII("[Auto Lead Capture] Checking message: my number is 7039163819 | Phone match: true 7039163819");
  expect(!r.includes('7039163819') && r.includes('******3819'), "Indian mobile masked, last 4 kept");
  expect(!redactPII("call +91 98765 43210").includes('98765'), "+91 spaced mobile masked");
  expect(!redactPII("reach me at +44 7911 123456").includes('7911 123456'), "international +number masked");
  expect(redactPII("email sudeep.arya@gmail.com now") === "email s***@gmail.com now", "email masked keeping domain");
  expect(redactPII("ts=1790000000000 id=5f0c1e2a-9b7d-4c3e-8a1f-2b3c4d5e6f70") === "ts=1790000000000 id=5f0c1e2a-9b7d-4c3e-8a1f-2b3c4d5e6f70", "timestamps and UUIDs untouched");
  expect(redactPII("synced 20 leads in 1234 ms") === "synced 20 leads in 1234 ms", "ordinary numbers untouched");
}

if (failed > 0) {
  console.error(`\n${failed} data retention test(s) failed.`);
  process.exit(1);
}
console.log("\nAll data retention tests passed.");
