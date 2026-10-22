import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { Building2, CalendarDays, Loader2, LogIn, Sparkles } from "lucide-react";
import type { BusinessAccountDto } from "@shared/dto/businessAccount";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import AccountApiSettings from "@/components/superadmin/AccountApiSettings";
import { LiveAvatarSettingsDialog } from "@/components/LiveAvatarSettingsDialog";
import { DataRetentionDialog } from "@/components/DataRetentionDialog";
import AccountFeaturesSettings from "@/pages/settings/AccountFeaturesSettings";
import SuperAdminDemo from "@/pages/SuperAdminDemo";
import { SetLimitDialog, type AccountRow, type SummaryResponse } from "@/pages/SuperAdminUsage";
import { ACCOUNT_TABS, accountHref, type AccountTabKey } from "@/navigation/superAdminAreas";
import { currentIstMonth, formatInr, formatPercentChange, formatTokens, formatUsd, recentMonths } from "@/components/usage/usageFormat";

/* ---------- small building blocks (Apple-style grouped rows) ---------- */

export function SaCard({ title, description, children, tone }: { title?: ReactNode; description?: ReactNode; children: ReactNode; tone?: "danger" }) {
  return (
    <section className={`overflow-hidden rounded-2xl border bg-white ${tone === "danger" ? "border-red-200" : "border-black/[0.07]"}`}>
      {(title || description) && (
        <header className="px-5 pb-1 pt-4">
          {title && <h3 className={`text-[15px] font-semibold ${tone === "danger" ? "text-red-700" : "text-gray-900"}`}>{title}</h3>}
          {description && <p className="mt-0.5 text-[12.5px] text-gray-500">{description}</p>}
        </header>
      )}
      <div className="divide-y divide-black/[0.05]">{children}</div>
    </section>
  );
}

export function SaRow({ label, help, children }: { label: ReactNode; help?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-gray-900">{label}</div>
        {help && <div className="text-[12.5px] leading-snug text-gray-500">{help}</div>}
      </div>
      {children !== undefined && <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13.5px] text-gray-600">{children}</div>}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/[0.07] bg-white px-4 py-3.5">
      <div className="text-[12.5px] text-gray-500">{label}</div>
      <div className="text-[24px] font-semibold tabular-nums tracking-tight text-gray-900">{value}</div>
      {sub && <div className="text-[12px] text-gray-500">{sub}</div>}
    </div>
  );
}

/** The agents and add-ons an account has, as small pills (same as the Accounts list). */
export function FeatureChips({ account }: { account: BusinessAccountDto }) {
  const pill = (label: string, cls: string) => (
    <span key={label} className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${cls}`}>{label}</span>
  );
  const addOns = [account.whatsappMarketingEnabled, account.voiceModeEnabled, account.visualSearchEnabled, account.supportTicketsEnabled, account.appointmentsEnabled, account.demoOrdersEnabled, account.shopifyEnabled].filter(Boolean).length;
  return (
    <div className="flex flex-wrap gap-1">
      {account.chroneyEnabled && pill("Chat", "bg-violet-50 text-violet-700")}
      {account.whatsappEnabled && pill("WhatsApp", "bg-green-50 text-green-700")}
      {account.instagramEnabled && pill("Instagram", "bg-pink-50 text-pink-700")}
      {account.facebookEnabled && pill("Facebook", "bg-blue-50 text-blue-700")}
      {account.aiCallingEnabled && pill("Calls", "bg-cyan-50 text-cyan-700")}
      {(account.productTier === "jewelry_showcase" || account.productTier === "jewelry_showcase_chroney") && pill("Vista", "bg-amber-50 text-amber-700")}
      {account.k12EducationEnabled && pill("K12", "bg-indigo-50 text-indigo-700")}
      {account.jobPortalEnabled && pill("Jobs", "bg-cyan-50 text-cyan-800")}
      {addOns > 0 && pill(`+${addOns} add-on${addOns === 1 ? "" : "s"}`, "bg-gray-100 text-gray-600")}
      {account.systemMode === "essential" && pill("Essential", "bg-slate-100 text-slate-600")}
    </div>
  );
}

const domainOf = (url: string | null | undefined) => {
  if (!url) return "";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
};
const when = (d: string | Date | null | undefined) => {
  if (!d) return "Never";
  try { return format(new Date(d), "d MMM yyyy, h:mm a"); } catch { return "—"; }
};

/* ---------- Overview (was Super admin › Insights) ---------- */

type Period = "today" | "yesterday" | "last7days" | "lastMonth" | "custom" | "lifetime";
const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7days", label: "Last 7 days" },
  { value: "lastMonth", label: "Last month" },
  { value: "lifetime", label: "Lifetime" },
];

function periodRange(p: Period): { from?: Date; to?: Date } {
  const now = new Date();
  switch (p) {
    case "today": return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": { const y = subDays(now, 1); return { from: startOfDay(y), to: endOfDay(y) }; }
    case "last7days": return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "lastMonth": { const m = subMonths(now, 1); return { from: startOfMonth(m), to: endOfMonth(m) }; }
    default: return {};
  }
}

interface AccountInsights {
  id: string;
  status: string;
  lastLogin: string | null;
  users: { id: string; username: string; lastLoginAt: string | null; createdAt: string }[];
  leadCount: number;
  conversationCount: number;
  productCount: number;
  faqCount: number;
}

function useMonthUsage(businessAccountId: string, month: string) {
  const query = useQuery<SummaryResponse>({
    queryKey: ["/api/super-admin/usage", month],
    queryFn: async () => {
      const res = await fetch(`/api/super-admin/usage?month=${month}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load usage");
      return res.json();
    },
    staleTime: 60_000,
  });
  const row = query.data?.accounts.find(r => r.businessAccountId === businessAccountId) ?? null;
  return { ...query, row, rate: query.data?.usdInrRate ?? 84 };
}

function AccountOverview({ account }: { account: BusinessAccountDto }) {
  const [, setLocation] = useLocation();
  const [period, setPeriod] = useState<Period>("lifetime");
  const [custom, setCustom] = useState<{ from?: Date; to?: Date }>({});
  const [customOpen, setCustomOpen] = useState(false);
  const range = useMemo(() => (period === "custom" ? custom : periodRange(period)), [period, custom]);

  const { data, isLoading, isError } = useQuery<AccountInsights[]>({
    queryKey: ["/api/super-admin/insights", account.id, range.from?.toISOString(), range.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams({ businessAccountId: account.id });
      if (range.from) params.set("dateFrom", range.from.toISOString());
      if (range.to) params.set("dateTo", range.to.toISOString());
      const res = await fetch(`/api/super-admin/insights?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load insights");
      return res.json();
    },
  });
  const stats = data?.[0];
  const usage = useMonthUsage(account.id, currentIstMonth());

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {PERIODS.map(p => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPeriod(p.value)}
            className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${period === p.value ? "bg-gray-900 text-white" : "border border-black/[0.08] bg-white text-gray-700 hover:bg-gray-50"}`}
          >
            {p.label}
          </button>
        ))}
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12.5px] font-medium ${period === "custom" ? "bg-gray-900 text-white" : "border border-black/[0.08] bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {period === "custom" && custom.from && custom.to ? `${format(custom.from, "d MMM")} – ${format(custom.to, "d MMM yyyy")}` : "Custom"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <CalendarComponent
              mode="range"
              selected={{ from: custom.from, to: custom.to }}
              onSelect={(r) => {
                setCustom({ from: r?.from, to: r?.to ? endOfDay(r.to) : undefined });
                if (r?.from && r?.to) { setPeriod("custom"); setCustomOpen(false); }
              }}
              numberOfMonths={1}
            />
          </PopoverContent>
        </Popover>
      </div>

      {isError ? (
        <p className="text-sm text-red-600">Could not load this account's numbers.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Leads" value={isLoading ? "…" : stats?.leadCount ?? 0} />
          <Kpi label="Conversations" value={isLoading ? "…" : stats?.conversationCount ?? 0} />
          <Kpi label="Products" value={isLoading ? "…" : stats?.productCount ?? 0} />
          <Kpi label="FAQs" value={isLoading ? "…" : stats?.faqCount ?? 0} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <SaCard title="Account">
          <SaRow label="Website">{account.website ? <a href={account.website} target="_blank" rel="noopener noreferrer" className="text-violet-700 hover:underline">{domainOf(account.website)}</a> : "—"}</SaRow>
          <SaRow label="Created">{when(account.createdAt as unknown as string)}</SaRow>
          <SaRow label="Last activity">{when(stats?.lastLogin)}</SaRow>
          <SaRow label="Status">
            <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${account.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
              {account.status === "active" ? "Active" : "Disabled"}
            </span>
            {account.isLive !== undefined && (
              <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${account.isLive ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                {account.isLive ? "Live" : "Not live"}
              </span>
            )}
          </SaRow>
          <SaRow label="Agents & add-ons"><FeatureChips account={account} /></SaRow>
        </SaCard>
        <div className="space-y-5">
          <SaCard title="Login user">
            {stats?.users?.length ? stats.users.map(u => (
              <SaRow key={u.id} label={u.username} help={`Joined ${when(u.createdAt)}`}>Last login {when(u.lastLoginAt)}</SaRow>
            )) : <SaRow label={isLoading ? "Loading…" : "No login user"} />}
          </SaCard>
          <SaCard title="AI this month" description="India time. Counts chat, voice and avatar spend.">
            <SaRow label="Spend" help={usage.row ? formatInr(usage.row.costUsd, usage.rate) : undefined}>
              <span className="font-semibold tabular-nums text-gray-900">{usage.row ? formatUsd(usage.row.costUsd) : usage.isLoading ? "…" : "$0"}</span>
            </SaRow>
            <SaRow
              label="Monthly limit"
              help={usage.row?.limit ? `${usage.row.limit.action === "block" ? "Blocks" : "Warns"} at the limit · warning at ${usage.row.limit.warnAtPercent}%` : "No limit set"}
            >
              {usage.row?.limit && <span className="tabular-nums">{formatUsd(usage.row.limit.monthlyLimitUsd)}</span>}
              <Button size="sm" variant="outline" onClick={() => setLocation(accountHref(account.id, "usage"))}>
                {usage.row?.limit ? "Change" : "Set limit"}
              </Button>
            </SaRow>
          </SaCard>
        </div>
      </div>
    </>
  );
}

/* ---------- Usage & limit (one account's row from Usage & Limits) ---------- */

function AccountUsage({ account }: { account: BusinessAccountDto }) {
  const [month, setMonth] = useState(currentIstMonth());
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const { row, rate, isLoading, isError } = useMonthUsage(account.id, month);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">Months follow India time (IST). ₹ amounts are approximate (1 USD ≈ ₹{rate}).</p>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-48 bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            {recentMonths(12).map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : isError || !row ? (
        <p className="text-sm text-gray-500">{isError ? "Could not load usage." : "No usage recorded for this account."}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Spend" value={formatUsd(row.costUsd)} sub={formatInr(row.costUsd, rate)} />
            <Kpi label="Tokens" value={formatTokens(row.tokens)} sub={`${row.aiCalls.toLocaleString()} AI calls`} />
            <Kpi label="Avatar minutes" value={row.avatarMinutes ? row.avatarMinutes.toLocaleString() : "—"} sub={row.avatarSessions ? `${row.avatarSessions} calls` : undefined} />
            <Kpi label="Trend" value={formatPercentChange(row.trendPercent)} sub={`previous month ${formatUsd(row.previousCostUsd)}`} />
          </div>
          <SaCard title="Monthly AI limit" description="Applies to each calendar month in India time.">
            {row.limit ? (
              <>
                <SaRow label="Limit" help={`${row.limit.action === "block" ? "Blocks new AI calls" : "Warns only"} when reached · warning at ${row.limit.warnAtPercent}%`}>
                  <span className="font-semibold tabular-nums text-gray-900">{formatUsd(row.limit.monthlyLimitUsd)}</span>
                </SaRow>
                <div className="px-5 py-3">
                  <div className="mb-1 flex justify-between text-xs tabular-nums text-gray-600">
                    <span>{row.limit.percentUsed.toFixed(0)}% used</span>
                    {row.limit.level === "exceeded" && <span className="font-medium text-red-700">{row.limit.action === "block" ? "Blocked" : "Over limit"}</span>}
                    {row.limit.level === "warn" && <span className="font-medium text-amber-700">Warning</span>}
                  </div>
                  <Progress
                    value={Math.min(row.limit.percentUsed, 100)}
                    className={`h-2 ${row.limit.level === "exceeded" ? "[&>div]:bg-red-600" : row.limit.level === "warn" ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-600"}`}
                  />
                </div>
              </>
            ) : (
              <SaRow label="No limit" help="Set one to be warned, or to stop AI replies, when the month's spend reaches it." />
            )}
            <div className="px-5 py-3">
              <Button size="sm" onClick={() => setEditing(row)} data-testid="button-account-set-limit">{row.limit ? "Edit limit" : "Set limit"}</Button>
            </div>
          </SaCard>
        </>
      )}
      {editing && <SetLimitDialog row={editing} rate={rate} onClose={() => setEditing(null)} />}
    </>
  );
}

/* ---------- the page ---------- */

export interface AccountPageActions {
  openPortal: () => void;
  openingPortal: boolean;
  openFeatures: () => void;
  edit: () => void;
  credentials: () => void;
  toggleStatus: () => void;
  togglingStatus: boolean;
  duplicate: () => void;
  remove: () => void;
}

export function AccountPage({ accountId, tab, account, isLoading, isError, actions }: {
  accountId: string;
  tab?: string;
  account: BusinessAccountDto | undefined;
  isLoading: boolean;
  isError: boolean;
  actions: AccountPageActions;
}) {
  const active = (ACCOUNT_TABS.find(t => t.key === tab)?.key ?? "overview") as AccountTabKey;
  const tabs = ACCOUNT_TABS.map(t => ({ key: t.key, label: t.label, href: accountHref(accountId, t.key) }));

  if (isLoading || !account) {
    return (
      <>
        <SaHeader icon={Building2} tint="bg-violet-600" kind="Business account" title={isError ? "Account not found" : "Loading…"} back={{ label: "Accounts", href: "/super-admin" }} />
        <SaBody>
          {isError
            ? <p className="text-sm text-gray-500">This account could not be loaded. It may have been deleted.</p>
            : <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}
        </SaBody>
      </>
    );
  }

  return (
    <>
      <SaHeader
        icon={Building2}
        tint="bg-violet-600"
        kind="Business account"
        title={account.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {account.website && <a href={account.website} target="_blank" rel="noopener noreferrer" className="hover:text-violet-700 hover:underline">{domainOf(account.website)}</a>}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${account.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
              {account.status === "active" ? "Active" : "Disabled"}
            </span>
          </span>
        }
        back={{ label: "Accounts", href: "/super-admin" }}
        actions={
          <>
            <Button variant="outline" size="sm" className="bg-white" onClick={actions.openFeatures} data-testid="button-account-features">
              <Sparkles className="mr-1.5 h-4 w-4" />Features
            </Button>
            <Button size="sm" onClick={actions.openPortal} disabled={actions.openingPortal} data-testid="button-account-open-portal">
              {actions.openingPortal ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <LogIn className="mr-1.5 h-4 w-4" />}Open portal
            </Button>
          </>
        }
        tabs={tabs}
        activeTab={active}
      />
      <SaBody>
        {active === "overview" && <AccountOverview account={account} />}
        {active === "features" && (
          <div className="max-w-3xl">
            <AccountFeaturesSettings businessAccountId={account.id} />
          </div>
        )}
        {active === "keys" && <AccountApiSettings businessAccountId={account.id} section="keys" />}
        {active === "avatar" && (
          <LiveAvatarSettingsDialog bare open onOpenChange={() => {}} businessAccountId={account.id} businessName={account.name} />
        )}
        {active === "usage" && <AccountUsage account={account} />}
        {active === "privacy" && (
          <DataRetentionDialog bare open onOpenChange={() => {}} scopeType="account" scopeId={account.id} scopeName={account.name} />
        )}
        {active === "details" && (
          <div className="max-w-3xl space-y-5">
            <SaCard title="Details">
              <SaRow label="Business name">{account.name}</SaRow>
              <SaRow label="Website">{account.website || "—"}</SaRow>
              <SaRow
                label="Products"
                help={[
                  account.chroneyEnabled && "Chroney Chat",
                  account.whatsappEnabled && "WhatsApp AI Agent",
                  (account.productTier === "jewelry_showcase" || account.productTier === "jewelry_showcase_chroney") && "Jewelry Showcase",
                ].filter(Boolean).join(" · ") || "None"}
              >
                <Button size="sm" variant="outline" onClick={actions.edit} data-testid="button-account-edit">Edit details</Button>
              </SaRow>
            </SaCard>
            <AccountApiSettings businessAccountId={account.id} section="currency" />
            <SaCard title="Login" description="The business's own sign-in.">
              <SaRow label="Username and password" help="See the username, or set a new temporary password to share with the business">
                <Button size="sm" variant="outline" onClick={actions.credentials} data-testid="button-account-credentials">Login details</Button>
              </SaRow>
            </SaCard>
            <SaCard title="Danger zone" tone="danger">
              <SaRow label="Duplicate account" help="Copies products, FAQs, training documents, journeys, appointment templates and widget settings into a new account with its own login">
                <Button size="sm" variant="outline" onClick={actions.duplicate} data-testid="button-account-duplicate">Duplicate…</Button>
              </SaRow>
              <SaRow
                label={account.status === "active" ? "Disable account" : "Enable account"}
                help={account.status === "active" ? "The business can't use the portal until you turn it back on" : "Lets the business use the portal again"}
              >
                <Button size="sm" variant="outline" className={account.status === "active" ? "text-red-600 hover:text-red-700" : ""} onClick={actions.toggleStatus} disabled={actions.togglingStatus} data-testid="button-account-toggle-status">
                  {account.status === "active" ? "Disable" : "Enable"}
                </Button>
              </SaRow>
              <SaRow label="Delete account" help="Removes the account and everything in it for good. Asks for your password.">
                <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={actions.remove} data-testid="button-account-delete">Delete…</Button>
              </SaRow>
            </SaCard>
          </div>
        )}
        {active === "demos" && <SuperAdminDemo businessAccountId={account.id} />}
      </SaBody>
    </>
  );
}

