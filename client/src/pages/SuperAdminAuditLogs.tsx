import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Link } from "wouter";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { actionLabel, browserLabel, outcomeLabel, roleLabel } from "@/components/superadmin/auditLabels";
import { accountHref } from "@/navigation/superAdminAreas";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface AuditEvent {
  id: string;
  occurredAt: string;
  actorUsername: string | null;
  actorRole: string | null;
  businessAccountId: string | null;
  businessAccountName: string | null;
  action: string;
  outcome: string;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
}

interface BusinessAccount {
  id: string;
  name: string;
  website: string;
}

const emptyFilters = { username: "", action: "", ip: "", businessAccountId: "", outcome: "all", from: "", to: "" };

/** yyyy-mm-dd in local time, for the date inputs. */
function dayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayString(d);
}
const QUICK_RANGES = [
  { label: "Today", range: () => ({ from: daysAgo(0), to: daysAgo(0) }) },
  { label: "Last 7 days", range: () => ({ from: daysAgo(6), to: daysAgo(0) }) },
  { label: "Last 30 days", range: () => ({ from: daysAgo(29), to: daysAgo(0) }) },
  { label: "Any time", range: () => ({ from: "", to: "" }) },
];

export default function SuperAdminAuditLogs() {
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [accountSelectorOpen, setAccountSelectorOpen] = useState(false);
  const [openEvent, setOpenEvent] = useState<AuditEvent | null>(null);
  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: "250" });
    if (filters.username) params.set("username", filters.username);
    if (filters.action) params.set("action", filters.action);
    if (filters.ip) params.set("ip", filters.ip);
    if (filters.businessAccountId) params.set("businessAccountId", filters.businessAccountId);
    if (filters.outcome !== "all") params.set("outcome", filters.outcome);
    if (filters.from) params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
    if (filters.to) params.set("to", new Date(`${filters.to}T23:59:59.999`).toISOString());
    return params.toString();
  }, [filters]);

  const { data, isLoading, isError } = useQuery<{ events: AuditEvent[] }>({
    queryKey: ["/api/super-admin/audit-events", queryString],
    queryFn: async () => {
      const response = await fetch(`/api/super-admin/audit-events?${queryString}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load audit events");
      return response.json();
    },
  });

  const { data: businessAccounts = [], isLoading: areAccountsLoading } = useQuery<BusinessAccount[]>({
    queryKey: ["/api/business-accounts", "all"],
    queryFn: async () => {
      const response = await fetch("/api/business-accounts?limit=1000", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load business accounts");
      const responseData = await response.json();
      return responseData.accounts || responseData;
    },
  });

  const selectedBusinessAccount = businessAccounts.find(account => account.id === draft.businessAccountId);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Search activity</CardTitle>
          <CardDescription>Sign-ins, viewing as an account, Leads page visits, exports and key changes. Shows up to 250 most recent matching events.</CardDescription>
          <div className="flex flex-wrap gap-1.5 pt-2">
            {QUICK_RANGES.map(r => (
              <button
                key={r.label}
                type="button"
                onClick={() => { const next = { ...draft, ...r.range() }; setDraft(next); setFilters(next); }}
                className="rounded-full border border-black/[0.08] bg-white px-3 py-1 text-[12.5px] text-gray-700 hover:bg-gray-50"
              >
                {r.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <Input placeholder="Person (username)" value={draft.username} onChange={e => setDraft({ ...draft, username: e.target.value })} />
          <Input placeholder="Action, e.g. export" value={draft.action} onChange={e => setDraft({ ...draft, action: e.target.value })} />
          <Input placeholder="IP address" value={draft.ip} onChange={e => setDraft({ ...draft, ip: e.target.value })} />
          <Popover open={accountSelectorOpen} onOpenChange={setAccountSelectorOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={accountSelectorOpen}
                aria-label="Select business account"
                className="w-full justify-between font-normal"
              >
                <span className="truncate">
                  {areAccountsLoading
                    ? "Loading accounts…"
                    : selectedBusinessAccount?.name || "All business accounts"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search business accounts..." />
                <CommandList>
                  <CommandEmpty>No business account found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="all business accounts"
                      onSelect={() => {
                        setDraft({ ...draft, businessAccountId: "" });
                        setAccountSelectorOpen(false);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", draft.businessAccountId ? "opacity-0" : "opacity-100")} />
                      All business accounts
                    </CommandItem>
                    {businessAccounts.map(account => (
                      <CommandItem
                        key={account.id}
                        value={`${account.name} ${account.website || ""} ${account.id}`}
                        onSelect={() => {
                          setDraft({ ...draft, businessAccountId: account.id });
                          setAccountSelectorOpen(false);
                        }}
                      >
                        <Check className={cn(
                          "mr-2 h-4 w-4",
                          draft.businessAccountId === account.id ? "opacity-100" : "opacity-0",
                        )} />
                        <div className="min-w-0">
                          <div className="truncate">{account.name}</div>
                          {account.website && <div className="truncate text-xs text-muted-foreground">{account.website}</div>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Input type="date" aria-label="From date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} />
          <Input type="date" aria-label="To date" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} />
          <Select value={draft.outcome} onValueChange={value => setDraft({ ...draft, outcome: value })}>
            <SelectTrigger><SelectValue placeholder="Outcome" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              <SelectItem value="success">Done</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
              <SelectItem value="failure">Failure</SelectItem>
            </SelectContent>
          </Select>
          <div className="md:col-span-4 xl:col-span-7 flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setDraft(emptyFilters); setFilters(emptyFilters); }}>Clear</Button>
            <Button onClick={() => setFilters({
              ...draft,
              username: draft.username.trim(),
              action: draft.action.trim(),
              ip: draft.ip.trim(),
              businessAccountId: draft.businessAccountId.trim(),
            })}>
              <Search className="h-4 w-4 mr-2" /> Search
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Result</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10">Loading audit events…</TableCell></TableRow>
              ) : isError ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-destructive">Could not load audit events.</TableCell></TableRow>
              ) : !data?.events.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No audit events found.</TableCell></TableRow>
              ) : data.events.map(event => (
                <TableRow key={event.id} data-testid={`audit-row-${event.id}`} className="cursor-pointer" onClick={() => setOpenEvent(event)}>
                  <TableCell className="whitespace-nowrap text-sm">{new Date(event.occurredAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</TableCell>
                  <TableCell>
                    <div className="font-medium">{event.actorUsername || "Unknown"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[roleLabel(event.actorRole), browserLabel(event.userAgent), event.ipAddress].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{actionLabel(event.action)}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{event.action}</div>
                  </TableCell>
                  <TableCell>
                    {event.businessAccountId ? (
                      <Link href={accountHref(event.businessAccountId)} onClick={(e) => e.stopPropagation()} className="hover:text-violet-700 hover:underline">{event.businessAccountName || "Account"}</Link>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${event.outcome === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {outcomeLabel(event.outcome)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setOpenEvent(event)} data-testid={`button-audit-details-${event.id}`}>Details</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!openEvent} onOpenChange={(o) => { if (!o) setOpenEvent(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {openEvent && (
            <>
              <SheetHeader>
                <SheetTitle>{actionLabel(openEvent.action)}</SheetTitle>
                <SheetDescription>{new Date(openEvent.occurredAt).toLocaleString()}</SheetDescription>
              </SheetHeader>
              <dl className="mt-5 space-y-3 text-sm">
                {[
                  ["Code", <span className="font-mono text-xs">{openEvent.action}</span>],
                  ["Person", `${openEvent.actorUsername || "Unknown"}${openEvent.actorRole ? ` (${roleLabel(openEvent.actorRole)})` : ""}`],
                  ["Account", openEvent.businessAccountName ? `${openEvent.businessAccountName}` : "—"],
                  ["Account ID", <span className="font-mono text-xs break-all">{openEvent.businessAccountId || "—"}</span>],
                  ["Result", outcomeLabel(openEvent.outcome)],
                  ["IP address", <span className="font-mono text-xs">{openEvent.ipAddress || "—"}</span>],
                  ["Browser", <span className="break-words text-xs">{openEvent.userAgent || "—"}</span>],
                  ["Request ID", <span className="font-mono text-xs break-all">{openEvent.requestId || "—"}</span>],
                ].map(([label, value]) => (
                  <div key={label as string} className="grid grid-cols-[110px_1fr] gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">Details</p>
              <pre className="mt-2 max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-[12px] text-gray-700">
                {JSON.stringify(openEvent.metadata ?? {}, null, 2)}
              </pre>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}