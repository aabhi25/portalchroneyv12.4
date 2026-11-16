import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Building2, Calendar, Check, ChevronDown, ChevronsUpDown, Layers, Loader2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import GroupAnalytics, { DATE_PRESETS, formatDateIST, istRange, type DatePreset } from "@/pages/GroupAnalytics";
import GroupAdminInsights from "@/pages/GroupAdminInsights";

interface GroupAssignment {
  groupId: string;
  groupName: string;
  canViewAnalytics: boolean;
}

interface LinkedAccount {
  id: string;
  name: string;
  website?: string | null;
}

const ALL = "all";
const shortUrl = (url?: string | null) => (url || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");

/**
 * Group admin Insights: one page for the whole group or one account (it replaces "Account Insights"
 * and "Group Analytics"). The group, the scope and the dates are picked here, once.
 */
export default function GroupAdminInsightsHub() {
  const { data: groupsData, isLoading: loadingGroups } = useQuery<{ groups: GroupAssignment[] }>({
    queryKey: ["/api/group-admin/groups"],
  });
  const groups = groupsData?.groups || [];
  const [groupId, setGroupId] = useState<string | null>(null);
  const group = groups.find(g => g.groupId === groupId) ?? groups[0] ?? null;

  const [scope, setScope] = useState<string>(() => new URLSearchParams(window.location.search).get("account") || ALL);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [customOpen, setCustomOpen] = useState(false);

  const { data: accountsData } = useQuery<{ accounts: LinkedAccount[] }>({
    queryKey: ["/api/group-admin/groups", group?.groupId, "linked-accounts"],
    enabled: !!group?.groupId,
  });
  const accounts = useMemo(
    () => (accountsData?.accounts || []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [accountsData],
  );
  // A picked account that isn't in this group (other group picked, old link) goes back to all accounts.
  useEffect(() => {
    if (scope !== ALL && accountsData && !accounts.some(a => a.id === scope)) setScope(ALL);
  }, [scope, accounts, accountsData]);

  const range = useMemo(() => istRange(datePreset, fromDate, toDate), [datePreset, fromDate, toDate]);
  // Picking another scope (e.g. an account name in the table) starts at the top.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [scope]);
  const account = accounts.find(a => a.id === scope) ?? null;

  if (loadingGroups) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }
  if (!group) {
    return <div className="flex items-center justify-center h-screen text-gray-500">No group assigned.</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-4">
          <SidebarTrigger className="text-gray-500 hover:text-gray-700" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center shadow-md">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Insights</h1>
              <p className="text-xs text-gray-500">{account ? account.name : `${accounts.length ? `All ${accounts.length} accounts` : "All accounts"} in ${group.groupName}`}</p>
            </div>
          </div>
          {groups.length > 1 && (
            <select
              value={group.groupId}
              onChange={e => { setGroupId(e.target.value); setScope(ALL); }}
              className="ml-auto text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400"
            >
              {groups.map(g => <option key={g.groupId} value={g.groupId}>{g.groupName}</option>)}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          {/* Scope: the whole group or one account */}
          <Popover open={scopeOpen} onOpenChange={setScopeOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={scopeOpen} className="h-9 w-full sm:w-[300px] justify-between" data-testid="button-insights-scope">
                <span className="flex min-w-0 items-center gap-2">
                  {account ? <Building2 className="w-4 h-4 shrink-0 text-gray-500" /> : <Layers className="w-4 h-4 shrink-0 text-purple-600" />}
                  <span className="truncate">{account ? account.name : "All accounts"}</span>
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[300px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search accounts..." />
                <CommandList className="max-h-[360px]">
                  <CommandEmpty>No account found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem value="all accounts whole group" onSelect={() => { setScope(ALL); setScopeOpen(false); }} className="py-2">
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", scope === ALL ? "opacity-100" : "opacity-0")} />
                      <Layers className="mr-2 h-4 w-4 shrink-0 text-purple-600" />
                      <span className="font-medium">All accounts</span>
                    </CommandItem>
                  </CommandGroup>
                  <CommandSeparator />
                  <CommandGroup heading="One account">
                    {accounts.map(a => (
                      <CommandItem key={a.id} value={`${a.name} ${shortUrl(a.website)} ${a.id}`} onSelect={() => { setScope(a.id); setScopeOpen(false); }} className="py-2">
                        <Check className={cn("mr-2 h-4 w-4 shrink-0", scope === a.id ? "opacity-100" : "opacity-0")} />
                        <span className="min-w-0">
                          <span className="block truncate">{a.name}</span>
                          {shortUrl(a.website) && <span className="block truncate text-xs text-muted-foreground">{shortUrl(a.website)}</span>}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <span className="mx-1 hidden h-6 w-px bg-gray-200 sm:block" />

          {/* Dates (Indian days), shared by both views */}
          <Calendar className="w-4 h-4 text-gray-400" />
          {DATE_PRESETS.filter(p => p.key !== "custom").map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setDatePreset(key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${datePreset === key ? "bg-purple-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {label}
            </button>
          ))}
          <Popover open={customOpen} onOpenChange={setCustomOpen}>
            <PopoverTrigger asChild>
              <button
                onClick={() => setDatePreset("custom")}
                className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all ${datePreset === "custom" ? "bg-purple-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                Custom Range
                <ChevronDown className="w-3 h-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-4" align="start">
              <div className="flex gap-4">
                <div>
                  <p className="text-xs font-medium mb-2 text-gray-600">From</p>
                  <CalendarComponent mode="single" selected={fromDate} onSelect={setFromDate} />
                </div>
                <div>
                  <p className="text-xs font-medium mb-2 text-gray-600">To</p>
                  <CalendarComponent mode="single" selected={toDate} onSelect={setToDate} />
                </div>
              </div>
              <Button size="sm" className="mt-3 w-full" onClick={() => setCustomOpen(false)}>Apply</Button>
            </PopoverContent>
          </Popover>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {datePreset === "all" ? "Showing all-time data" : range.from && range.to ? `Showing data from ${formatDateIST(range.from)} to ${formatDateIST(range.to)}` : "Pick a start and end date"}
        </p>
      </div>

      <div ref={bodyRef} className="flex-1 overflow-y-auto p-6">
        {!group.canViewAnalytics ? (
          <div className="flex items-center justify-center py-20 text-gray-500">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No permission to view insights.</p>
            </div>
          </div>
        ) : account ? (
          <div className="max-w-7xl mx-auto">
            <GroupAdminInsights key={account.id} embed={{ groupId: group.groupId, accountId: account.id, from: range.from, to: range.to }} />
          </div>
        ) : (
          <GroupAnalytics embed={{ groupId: group.groupId, from: range.from, to: range.to, onOpenAccount: setScope }} />
        )}
      </div>
    </div>
  );
}
