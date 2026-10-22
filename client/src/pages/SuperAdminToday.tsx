import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { SaCard, SaRow } from "@/components/superadmin/AccountPage";
import type { SummaryResponse } from "@/pages/SuperAdminUsage";
import { accountHref } from "@/navigation/superAdminAreas";
import { currentIstMonth, formatInr, formatUsd, monthLabel } from "@/components/usage/usageFormat";

interface MISRow {
  name: string;
  visitors: { mtd: number; today: number };
  leads: { mtd: number; today: number };
  conversations: { mtd: number; today: number };
}

interface FailedJob { id: string; operation: string; backupType: string | null; startedAt: string }
interface BackupStats { totalBackups: number; newestBackup: string | null }
interface MasterSettings { masterEnabled: boolean; hasPrimaryKey: boolean; fallbackEnabled: boolean; hasFallbackKey: boolean }

const getJson = (url: string) => async () => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
};

function Stat({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href: string }) {
  return (
    <Link href={href} className="block rounded-2xl border border-black/[0.07] bg-white px-4 py-3.5 transition-colors hover:border-black/[0.14]">
      <div className="text-[12.5px] text-gray-500">{label}</div>
      <div className="text-[24px] font-semibold tabular-nums tracking-tight text-gray-900">{value}</div>
      {sub && <div className="text-[12px] text-gray-500">{sub}</div>}
    </Link>
  );
}

/** Super admin "Today": this month's totals and anything that needs attention, each linking to its page. */
export default function SuperAdminToday() {
  const month = currentIstMonth();
  const mis = useQuery<MISRow[]>({ queryKey: ["/api/super-admin/mis"] });
  const usage = useQuery<SummaryResponse>({ queryKey: ["/api/super-admin/usage", month], queryFn: getJson(`/api/super-admin/usage?month=${month}`), staleTime: 60_000 });
  const failed = useQuery<FailedJob[]>({ queryKey: ["/api/super-admin/backups/failed-jobs"], queryFn: getJson("/api/super-admin/backups/failed-jobs") });
  const backupStats = useQuery<BackupStats>({ queryKey: ["/api/super-admin/backups/stats"], queryFn: getJson("/api/super-admin/backups/stats") });
  const master = useQuery<MasterSettings>({ queryKey: ["/api/super-admin/master-ai-settings"] });
  const accounts = useQuery<{ total: number }>({ queryKey: ["/api/business-accounts", "count"], queryFn: getJson("/api/business-accounts?limit=1&offset=0") });

  const sum = (pick: (r: MISRow) => { mtd: number; today: number }) =>
    (mis.data ?? []).reduce((acc, r) => ({ mtd: acc.mtd + pick(r).mtd, today: acc.today + pick(r).today }), { mtd: 0, today: 0 });
  const visitors = sum(r => r.visitors);
  const leads = sum(r => r.leads);
  const chats = sum(r => r.conversations);

  const rate = usage.data?.usdInrRate ?? 84;
  const rows = usage.data?.accounts ?? [];
  const spend = rows.reduce((s, r) => s + r.costUsd, 0);
  const nearLimit = rows.filter(r => r.limit && r.limit.level !== "ok").sort((a, b) => (b.limit!.percentUsed - a.limit!.percentUsed));
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentFailures = (failed.data ?? []).filter(j => new Date(j.startedAt).getTime() > weekAgo);
  const lastBackup = backupStats.data?.newestBackup ? new Date(backupStats.data.newestBackup) : null;
  const backupStale = !lastBackup || Date.now() - lastBackup.getTime() > 2 * 24 * 60 * 60 * 1000;
  const n = (v: number) => (mis.isLoading ? "…" : v.toLocaleString());

  return (
    <>
      <p className="text-sm text-gray-500">{monthLabel(month)} so far, India time. Tap a number to open its page.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Accounts" value={accounts.data?.total ?? "…"} href="/super-admin" />
        <Stat label="Visitors" value={n(visitors.mtd)} sub={`${visitors.today.toLocaleString()} today`} href="/super-admin/mis" />
        <Stat label="Leads" value={n(leads.mtd)} sub={`${leads.today.toLocaleString()} today`} href="/super-admin/mis" />
        <Stat label="Conversations" value={n(chats.mtd)} sub={`${chats.today.toLocaleString()} today`} href="/super-admin/mis" />
        <Stat label="AI spend" value={usage.isLoading ? "…" : formatUsd(spend)} sub={formatInr(spend, rate)} href="/super-admin/usage" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SaCard title="Needs your attention">
          {nearLimit.map(r => (
            <Link key={r.businessAccountId} href={accountHref(r.businessAccountId, "usage")} className="block hover:bg-gray-50/70">
              <SaRow
                label={<span className="inline-flex items-center gap-1.5"><AlertTriangle className={`h-4 w-4 ${r.limit!.level === "exceeded" ? "text-red-600" : "text-amber-500"}`} />{r.name}</span>}
                help={`${r.limit!.level === "exceeded" ? (r.limit!.action === "block" ? "Blocked: monthly AI limit reached" : "Over its monthly AI limit") : "Near its monthly AI limit"} · ${formatUsd(r.costUsd)} of ${formatUsd(r.limit!.monthlyLimitUsd)}`}
              >
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </SaRow>
            </Link>
          ))}
          {recentFailures.length > 0 && (
            <Link href="/super-admin/backups" className="block hover:bg-gray-50/70">
              <SaRow
                label={<span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-red-600" />Backups failed</span>}
                help={`${recentFailures.length} failed backup job${recentFailures.length === 1 ? "" : "s"} in the last 7 days`}
              >
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </SaRow>
            </Link>
          )}
          {!backupStats.isLoading && backupStale && (
            <Link href="/super-admin/backups" className="block hover:bg-gray-50/70">
              <SaRow
                label={<span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber-500" />No recent cloud backup</span>}
                help={lastBackup ? `Last backup ${lastBackup.toLocaleString()}` : "No cloud backup found"}
              >
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </SaRow>
            </Link>
          )}
          {nearLimit.length === 0 && recentFailures.length === 0 && !(backupStale && !backupStats.isLoading) && (
            <SaRow label={<span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-600" />All clear</span>} help="No account is near its AI limit and backups are running." />
          )}
        </SaCard>

        <SaCard title="Platform">
          <Link href="/super-admin/ai-providers" className="block hover:bg-gray-50/70">
            <SaRow
              label="Chat keys"
              help={master.data?.masterEnabled ? "Master keys are on: every account uses them" : "Each account uses its own key"}
            >
              <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${master.data?.masterEnabled ? "bg-violet-50 text-violet-700" : "bg-gray-100 text-gray-600"}`}>
                {master.data?.masterEnabled ? "Master" : "Per account"}
              </span>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </SaRow>
          </Link>
          <Link href="/super-admin/ai-providers" className="block hover:bg-gray-50/70">
            <SaRow label="Backup provider" help={master.data?.fallbackEnabled && master.data?.hasFallbackKey ? "Takes over if the main provider fails" : "Not in use"}>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </SaRow>
          </Link>
          <Link href="/super-admin/backups" className="block hover:bg-gray-50/70">
            <SaRow label="Cloud backups" help={lastBackup ? `Last backup ${lastBackup.toLocaleString()}` : "None yet"}>
              <span className="tabular-nums">{backupStats.data?.totalBackups ?? "…"}</span>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </SaRow>
          </Link>
        </SaCard>
      </div>
    </>
  );
}
