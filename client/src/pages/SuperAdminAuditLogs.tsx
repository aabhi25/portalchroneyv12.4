import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

const emptyFilters = { username: "", action: "", ip: "", businessAccountId: "", outcome: "all", from: "", to: "" };

export default function SuperAdminAuditLogs() {
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
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

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" /> Audit Logs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review logins, Leads page visits, and lead report exports.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search activity</CardTitle>
          <CardDescription>Showing up to 250 most recent matching events.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <Input placeholder="Username" value={draft.username} onChange={e => setDraft({ ...draft, username: e.target.value })} />
          <Input placeholder="Action, e.g. export" value={draft.action} onChange={e => setDraft({ ...draft, action: e.target.value })} />
          <Input placeholder="IP address" value={draft.ip} onChange={e => setDraft({ ...draft, ip: e.target.value })} />
          <Input placeholder="Business account ID" value={draft.businessAccountId} onChange={e => setDraft({ ...draft, businessAccountId: e.target.value })} />
          <Input type="date" aria-label="From date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} />
          <Input type="date" aria-label="To date" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} />
          <Select value={draft.outcome} onValueChange={value => setDraft({ ...draft, outcome: value })}>
            <SelectTrigger><SelectValue placeholder="Outcome" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              <SelectItem value="success">Success</SelectItem>
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
                <TableHead>Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Business account</TableHead>
                <TableHead>IP address</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10">Loading audit events…</TableCell></TableRow>
              ) : isError ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-destructive">Could not load audit events.</TableCell></TableRow>
              ) : !data?.events.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No audit events found.</TableCell></TableRow>
              ) : data.events.map(event => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap">{new Date(event.occurredAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="font-medium">{event.actorUsername || "Unknown"}</div>
                    <div className="text-xs text-muted-foreground">{event.actorRole || "—"}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{event.action}</TableCell>
                  <TableCell>
                    <div>{event.businessAccountName || "—"}</div>
                    {event.businessAccountId && <div className="font-mono text-[10px] text-muted-foreground max-w-[180px] truncate">{event.businessAccountId}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{event.ipAddress || "—"}</TableCell>
                  <TableCell><Badge variant={event.outcome === "success" ? "secondary" : "destructive"}>{event.outcome}</Badge></TableCell>
                  <TableCell className="text-xs max-w-[280px]">
                    <div className="truncate" title={JSON.stringify(event.metadata)}>{JSON.stringify(event.metadata)}</div>
                    <div className="truncate text-muted-foreground" title={event.userAgent || ""}>{event.userAgent || "—"}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}