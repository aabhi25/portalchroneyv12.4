import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Gauge, Loader2, Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  currentIstMonth,
  formatInr,
  formatPercentChange,
  formatTokens,
  formatUsd,
  recentMonths,
  type UsageLimit,
} from "@/components/usage/usageFormat";

interface AccountRow {
  businessAccountId: string;
  name: string;
  status: string | null;
  costUsd: number;
  costInr: number;
  tokens: number;
  aiCalls: number;
  previousCostUsd: number;
  trendPercent: number | null;
  limit: UsageLimit | null;
  /** Live AI avatar minutes this month (its cost is already inside costUsd). */
  avatarMinutes?: number;
  avatarSessions?: number;
}

interface SummaryResponse {
  month: string;
  timezone: string;
  usdInrRate: number;
  accounts: AccountRow[];
}

type SortKey = "name" | "costUsd" | "tokens" | "limit" | "percent" | "trend";

function sortValue(r: AccountRow, key: SortKey): number | string {
  switch (key) {
    case "name": return r.name.toLowerCase();
    case "costUsd": return r.costUsd;
    case "tokens": return r.tokens;
    case "limit": return r.limit?.monthlyLimitUsd ?? -1;
    case "percent": return r.limit?.percentUsed ?? -1;
    case "trend": return r.trendPercent ?? -Infinity;
  }
}

function SetLimitDialog({ row, onClose, rate }: { row: AccountRow; onClose: () => void; rate: number }) {
  const { toast } = useToast();
  const [limitUsd, setLimitUsd] = useState(row.limit ? String(row.limit.monthlyLimitUsd) : "");
  const [warnAt, setWarnAt] = useState(String(row.limit?.warnAtPercent ?? 80));
  const [action, setAction] = useState<"warn" | "block">(row.limit?.action ?? "warn");
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/super-admin/usage"] });
    queryClient.invalidateQueries({ queryKey: ["/api/usage/summary"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/super-admin/usage/limits/${row.businessAccountId}`, {
      monthlyLimitUsd: Number(limitUsd),
      warnAtPercent: Number(warnAt),
      action,
    }),
    onSuccess: () => { toast({ title: "Limit saved", description: row.name }); done(); },
    onError: (e: Error) => toast({ title: "Could not save limit", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/super-admin/usage/limits/${row.businessAccountId}`),
    onSuccess: () => { toast({ title: "Limit removed", description: row.name }); done(); },
    onError: (e: Error) => toast({ title: "Could not remove limit", description: e.message, variant: "destructive" }),
  });
  const valid = Number(limitUsd) > 0 && Number(warnAt) >= 1 && Number(warnAt) <= 100;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Monthly AI limit — {row.name}</DialogTitle>
          <DialogDescription>
            Applies to each calendar month in India time. This month so far: {formatUsd(row.costUsd)}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="limit-usd">Monthly limit (USD)</Label>
            <Input id="limit-usd" type="number" min="0.01" step="0.01" value={limitUsd} onChange={(e) => setLimitUsd(e.target.value)} data-testid="input-limit-usd" />
            {Number(limitUsd) > 0 && <p className="text-xs text-muted-foreground mt-1">{formatInr(Number(limitUsd), rate)}</p>}
          </div>
          <div>
            <Label htmlFor="warn-at">Warn at (% of limit)</Label>
            <Input id="warn-at" type="number" min="1" max="100" step="1" value={warnAt} onChange={(e) => setWarnAt(e.target.value)} data-testid="input-warn-at" />
          </div>
          <div>
            <Label>When the limit is reached</Label>
            <Select value={action} onValueChange={(v) => setAction(v as "warn" | "block")}>
              <SelectTrigger data-testid="select-limit-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="warn">Warn only (AI keeps working)</SelectItem>
                <SelectItem value="block">Block new AI calls until next month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {row.limit ? (
            <Button variant="outline" onClick={() => remove.mutate()} disabled={remove.isPending || save.isPending}>Remove limit</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!valid || save.isPending} data-testid="button-save-limit">
              {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SuperAdminUsage() {
  const [month, setMonth] = useState(currentIstMonth());
  const [sortKey, setSortKey] = useState<SortKey>("costUsd");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [showIdle, setShowIdle] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);

  const { data, isLoading, isError } = useQuery<SummaryResponse>({
    queryKey: ["/api/super-admin/usage", month],
    queryFn: async () => {
      const res = await fetch(`/api/super-admin/usage?month=${month}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load usage");
      return res.json();
    },
    staleTime: 60_000,
  });
  const rate = data?.usdInrRate ?? 84;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data?.accounts ?? []).filter((r) =>
      (showIdle || r.costUsd > 0 || r.previousCostUsd > 0 || r.limit || (r.avatarMinutes ?? 0) > 0) && (!q || r.name.toLowerCase().includes(q)));
    return list.sort((a, b) => {
      const va = sortValue(a, sortKey), vb = sortValue(b, sortKey);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, search, showIdle, sortKey, sortDir]);

  const totalUsd = (data?.accounts ?? []).reduce((s, r) => s + r.costUsd, 0);
  const limited = (data?.accounts ?? []).filter((r) => r.limit);
  const overWarn = limited.filter((r) => r.limit!.level !== "ok").length;

  const header = (key: SortKey, label: string, className = "") => (
    <TableHead className={className}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-gray-900"
        onClick={() => {
          if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
          else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
        }}
      >
        {label}
        {sortKey === key ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </TableHead>
  );

  return (
    <div className="flex flex-col flex-1 min-h-screen bg-gray-50">
      <header className="flex items-center h-[56px] px-6 border-b bg-white">
        <SidebarTrigger className="-ml-1 mr-2" />
        <h1 className="text-[15px] font-semibold text-gray-900">Usage & Limits</h1>
      </header>
      <div className="max-w-7xl w-full mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Gauge className="w-6 h-6 text-purple-600" />
              <h2 className="text-2xl font-bold text-gray-900">AI usage by account</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Months follow India time (IST). ₹ amounts are approximate (1 USD ≈ ₹{rate}). Trend compares with the whole previous month.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative sm:w-60">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search accounts" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="sm:w-48" data-testid="select-admin-usage-month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {recentMonths(12).map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">Total spend</div><div className="text-2xl font-semibold tabular-nums">{formatUsd(totalUsd)}</div><div className="text-xs text-muted-foreground">{formatInr(totalUsd, rate)}</div></CardContent></Card>
          <Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">Accounts with a limit</div><div className="text-2xl font-semibold tabular-nums">{limited.length}</div></CardContent></Card>
          <Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">Over warning threshold</div><div className="text-2xl font-semibold tabular-nums">{overWarn}</div></CardContent></Card>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>
            ) : isError ? (
              <div className="p-4 text-sm text-red-700">Failed to load usage.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {header("name", "Account")}
                      {header("costUsd", "Spend", "text-right")}
                      {header("tokens", "Tokens", "text-right")}
                      <TableHead className="text-right">Avatar min</TableHead>
                      {header("limit", "Limit", "text-right")}
                      {header("percent", "% used", "min-w-[160px]")}
                      {header("trend", "Trend", "text-right")}
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No accounts with AI usage this month.</TableCell></TableRow>
                    )}
                    {rows.map((r) => (
                      <TableRow key={r.businessAccountId} data-testid={`row-usage-${r.businessAccountId}`}>
                        <TableCell>
                          <div className="font-medium">{r.name}</div>
                          {r.status && r.status !== "active" && <Badge variant="secondary" className="mt-0.5">{r.status}</Badge>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div>{formatUsd(r.costUsd)}</div>
                          <div className="text-xs text-muted-foreground">{formatInr(r.costUsd, rate)}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatTokens(r.tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums" data-testid={`text-avatar-minutes-${r.businessAccountId}`}>
                          {r.avatarMinutes ? (
                            <>
                              <div>{r.avatarMinutes.toLocaleString()}</div>
                              <div className="text-xs text-muted-foreground">{r.avatarSessions} calls</div>
                            </>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.limit ? (
                            <>
                              <div>{formatUsd(r.limit.monthlyLimitUsd)}</div>
                              <div className="text-xs text-muted-foreground">{r.limit.action === "block" ? "blocks" : "warns"} · warn {r.limit.warnAtPercent}%</div>
                            </>
                          ) : <span className="text-muted-foreground">No limit</span>}
                        </TableCell>
                        <TableCell>
                          {r.limit ? (
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs tabular-nums">
                                <span>{r.limit.percentUsed.toFixed(0)}%</span>
                                {r.limit.level === "exceeded" && <span className="text-red-700 font-medium">{r.limit.action === "block" ? "Blocked" : "Over limit"}</span>}
                                {r.limit.level === "warn" && <span className="text-amber-700 font-medium">Warning</span>}
                              </div>
                              <Progress
                                value={Math.min(r.limit.percentUsed, 100)}
                                className={`h-2 ${r.limit.level === "exceeded" ? "[&>div]:bg-red-600" : r.limit.level === "warn" ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-600"}`}
                              />
                            </div>
                          ) : <span className="text-muted-foreground text-sm">—</span>}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${r.trendPercent !== null && r.trendPercent > 0 ? "text-red-700" : r.trendPercent !== null && r.trendPercent < 0 ? "text-emerald-700" : ""}`}>
                          {formatPercentChange(r.trendPercent)}
                          <div className="text-xs text-muted-foreground">prev {formatUsd(r.previousCostUsd)}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setEditing(r)} data-testid={`button-set-limit-${r.businessAccountId}`}>
                            {r.limit ? "Edit limit" : "Set limit"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} />
          Show accounts with no usage (to set a limit in advance)
        </label>
      </div>
      {editing && <SetLimitDialog row={editing} rate={rate} onClose={() => setEditing(null)} />}
    </div>
  );
}
