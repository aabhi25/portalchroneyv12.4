/**
 * Tests for the Archived-accounts filter (stripArchived) and the wrong-password limit.
 * Run manually: `DATABASE_URL=postgres://unused@127.0.0.1:1/x npx tsx server/services/__tests__/accountArchive.test.ts`
 * (No database is touched; the URL only satisfies server/db.ts. Self-asserting, no test runner.)
 */
import { ARCHIVE_MAX_TRIES, archiveLockoutMinutes, recordArchivePasswordResult, stripArchived } from "../accountArchive";

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) { failed++; console.error(`✗ ${label}`); } else { console.log(`✓ ${label}`); }
}

const A = "11111111-1111-1111-1111-111111111111"; // archived
const B = "22222222-2222-2222-2222-222222222222"; // normal
const ids = new Set([A]);

const list = stripArchived({ accounts: [{ id: A, name: "Hidden" }, { id: B, name: "Shown" }], total: 2 }, ids) as any;
expect(list.accounts.length === 1 && list.accounts[0].id === B, "account list loses the archived account");
expect(list.total === 2, "plain numbers are left alone (the list endpoint counts in SQL)");

const usage = stripArchived({ month: "2026-11", accounts: [{ businessAccountId: A, costUsd: 5 }, { businessAccountId: B, costUsd: 1 }] }, ids) as any;
expect(usage.accounts.length === 1 && usage.accounts[0].businessAccountId === B, "rows keyed by businessAccountId are dropped");

const nested = stripArchived([{ name: "Group", members: [{ accountId: A }, { accountId: B }], memberIds: [A, B] }], ids) as any;
expect(nested[0].members.length === 1 && nested[0].memberIds.join() === B, "nested member lists and id lists are filtered");

const audit = stripArchived({ events: [
  { action: "account_archive.unlocked", businessAccountId: null },
  { action: "account.updated", businessAccountId: A },
  { action: "account.updated", businessAccountId: B },
] }, ids) as any;
expect(audit.events.length === 1 && audit.events[0].businessAccountId === B, "audit log hides archive activity and archived accounts");

const when = new Date();
const dated = stripArchived([{ id: B, createdAt: when }], ids) as any;
expect(dated[0].createdAt === when, "dates and other non-plain objects pass through untouched");
expect(stripArchived({ id: A, name: "single" }, ids) && (stripArchived({ id: A }, ids) as any).id === A, "a single object (not in a list) is not removed");

const user = "user-1";
for (let i = 0; i < ARCHIVE_MAX_TRIES - 1; i++) recordArchivePasswordResult(user, false);
expect(archiveLockoutMinutes(user) === 0, `${ARCHIVE_MAX_TRIES - 1} wrong tries: not locked yet`);
recordArchivePasswordResult(user, false);
expect(archiveLockoutMinutes(user) > 0, `${ARCHIVE_MAX_TRIES} wrong tries: locked out`);
recordArchivePasswordResult("user-2", false);
recordArchivePasswordResult("user-2", true);
expect(archiveLockoutMinutes("user-2") === 0, "a right password clears the count");

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("\nAll archive checks passed");
