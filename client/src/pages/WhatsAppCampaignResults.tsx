import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Table2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type CampaignRow = {
  id: string; name: string; status: string; campaignType: string; startedAt: string | null;
  sent: number; delivered: number; read: number; replied: number; interested: number; optedOut: number;
  readRate: number | null; replyRate: number | null;
};
type Insights = {
  range: { from: string; to: string; timezone: string };
  totals: {
    sent: number; delivered: number; read: number; replied: number; interested: number; optedOut: number;
    deliveredRate: number | null; readRate: number | null; replyRate: number | null;
  };
  campaigns: CampaignRow[];
  daily: { date: string; sent: number; read: number; replied: number }[];
};

// Reference categorical palette, slots 1-3 in fixed order (validated set).
const SERIES = { sent: "#2a78d6", read: "#eb6834", replied: "#1baf7a" };

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", scheduled: "Scheduled", sending: "Sending", completed: "Finished",
  cancelled: "Cancelled", failed: "Failed", paused: "Paused",
};

function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"; } catch { return "Asia/Kolkata"; }
}
function isoToday(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}
function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

type SortKey = "name" | "startedAt" | "sent" | "delivered" | "read" | "readRate" | "replied" | "interested" | "optedOut";
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Campaign" },
  { key: "startedAt", label: "Started" },
  { key: "sent", label: "Sent", numeric: true },
  { key: "delivered", label: "Delivered", numeric: true },
  { key: "read", label: "Read", numeric: true },
  { key: "readRate", label: "Read rate", numeric: true },
  { key: "replied", label: "Replied", numeric: true },
  { key: "interested", label: "Interested", numeric: true },
  { key: "optedOut", label: "Opted out", numeric: true },
];

/**
 * Cross-campaign results: totals over a date range, a daily trend and a
 * sortable per-campaign table. Message counts only; no cost or AI usage.
 */
export default function WhatsAppCampaignResults() {
  const [, setLocation] = useLocation();
  const tz = browserTimezone();
  const today = isoToday(tz);
  const [from, setFrom] = useState(shiftIso(today, -29));
  const [to, setTo] = useState(today);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "startedAt", dir: "desc" });
  const [showDailyTable, setShowDailyTable] = useState(false);

  const { data, isLoading, isError } = useQuery<Insights>({
    queryKey: ["/api/whatsapp/campaign-insights", from, to, tz],
    queryFn: () => apiRequest("GET", `/api/whatsapp/campaign-insights?from=${from}&to=${to}&tz=${encodeURIComponent(tz)}`),
  });

  const preset = (days: number) => { setTo(today); setFrom(shiftIso(today, -(days - 1))); };
  const activePreset = to === today ? [7, 30, 90].find(days => from === shiftIso(today, -(days - 1))) : undefined;

  const rows = useMemo(() => {
    const list = [...(data?.campaigns || [])];
    list.sort((a, b) => {
      const av = a[sort.key] ?? (sort.key === "name" || sort.key === "startedAt" ? "" : -1);
      const bv = b[sort.key] ?? (sort.key === "name" || sort.key === "startedAt" ? "" : -1);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data?.campaigns, sort]);

  const toggleSort = (key: SortKey) => setSort(current => current.key === key
    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
    : { key, dir: key === "name" ? "asc" : "desc" });

  const t = data?.totals;
  const tiles = t ? [
    { label: "Sent", value: t.sent, note: "messages" },
    { label: "Delivered", value: t.delivered, note: pct(t.deliveredRate) },
    { label: "Read", value: t.read, note: pct(t.readRate) },
    { label: "Replied", value: t.replied, note: pct(t.replyRate) },
    { label: "Interested", value: t.interested, note: "positive replies" },
    { label: "Opted out", value: t.optedOut, note: "asked to stop" },
  ] : [];
  const hasActivity = (data?.daily || []).some(day => day.sent || day.read || day.replied);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5" data-testid="page-campaign-results">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6 text-orange-500" /> Campaign results</h1>
        <p className="text-sm text-gray-600 mt-1">How your WhatsApp campaigns did. Numbers count messages sent in the chosen dates and what has happened to them since.</p>
      </div>

      {/* Filters: one row above everything they control */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1 rounded-lg border bg-white p-1">
          {[7, 30, 90].map(days => (
            <Button key={days} size="sm" variant={activePreset === days ? "default" : "ghost"} className="h-8" onClick={() => preset(days)}>
              Last {days} days
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="results-from" className="text-xs text-gray-500">From</Label>
            <Input id="results-from" type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="results-to" className="text-xs text-gray-500">To</Label>
            <Input id="results-to" type="date" value={to} min={from} max={today} onChange={e => e.target.value && setTo(e.target.value)} className="h-9 w-[150px]" />
          </div>
        </div>
      </div>

      {isError && <Card><CardContent className="p-4 text-sm text-gray-600">Could not load campaign results. Please try again.</CardContent></Card>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {(isLoading ? Array.from({ length: 6 }) : tiles).map((tile: any, index) => (
          <Card key={tile?.label ?? index}>
            <CardContent className="p-4">
              {isLoading ? (
                <div className="space-y-2"><div className="h-3 w-16 bg-gray-100 rounded animate-pulse" /><div className="h-7 w-12 bg-gray-100 rounded animate-pulse" /></div>
              ) : (
                <>
                  <div className="text-xs text-gray-500">{tile.label}</div>
                  <div className="text-2xl font-bold mt-1" data-testid={`results-total-${tile.label.toLowerCase().replace(/\s+/g, "-")}`}>{tile.value.toLocaleString()}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{tile.note}</div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Daily activity</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => setShowDailyTable(v => !v)}>
            {showDailyTable ? <BarChart3 className="h-4 w-4 mr-1" /> : <Table2 className="h-4 w-4 mr-1" />}
            {showDailyTable ? "Show chart" : "Show as table"}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-64 bg-gray-50 rounded animate-pulse" />
          ) : !hasActivity ? (
            <p className="text-sm text-gray-500 py-12 text-center">No campaign messages in these dates.</p>
          ) : showDailyTable ? (
            <div className="max-h-72 overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr><th className="text-left px-3 py-2 font-medium">Day</th><th className="text-right px-3 py-2 font-medium">Sent</th><th className="text-right px-3 py-2 font-medium">Read</th><th className="text-right px-3 py-2 font-medium">Replies</th></tr>
                </thead>
                <tbody>
                  {(data?.daily || []).filter(d => d.sent || d.read || d.replied).map(day => (
                    <tr key={day.date} className="border-t">
                      <td className="px-3 py-1.5">{shortDate(day.date)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{day.sent}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{day.read}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{day.replied}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-64 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.daily || []} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    labelFormatter={(label: string) => shortDate(label)}
                    contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e5e7eb" }}
                    cursor={{ stroke: "#9ca3af", strokeDasharray: "3 3" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#374151" }} iconType="plainline" />
                  <Line type="monotone" dataKey="sent" name="Sent" stroke={SERIES.sent} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="read" name="Read" stroke={SERIES.read} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="replied" name="Replies" stroke={SERIES.replied} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">By campaign</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-32 bg-gray-50 rounded animate-pulse" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">No campaign sent messages in these dates.</p>
          ) : (
            <div className="overflow-x-auto -mx-2 sm:mx-0">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="border-b">
                    {COLUMNS.map(col => (
                      <th key={col.key} className={`px-2 py-2 font-medium text-gray-600 ${col.numeric ? "text-right" : "text-left"}`}>
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className={`inline-flex items-center gap-1 hover:text-gray-900 ${col.numeric ? "flex-row-reverse" : ""}`}
                          data-testid={`results-sort-${col.key}`}
                        >
                          {col.label}
                          {sort.key === col.key
                            ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                            : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="border-b last:border-b-0 hover:bg-gray-50 cursor-pointer" onClick={() => setLocation(`/admin/whatsapp-campaigns/${row.id}`)}>
                      <td className="px-2 py-2 max-w-[260px]">
                        <div className="font-medium truncate">{row.name}</div>
                        <div className="flex gap-1 mt-0.5">
                          <Badge variant="outline" className="text-[10px] font-normal">{STATUS_LABELS[row.status] || row.status}</Badge>
                          {row.campaignType === "automation" && <Badge variant="outline" className="text-[10px] font-normal">Automation</Badge>}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-gray-600 whitespace-nowrap">{row.startedAt ? new Date(row.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.sent.toLocaleString()}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.delivered.toLocaleString()}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.read.toLocaleString()}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{pct(row.readRate)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.replied.toLocaleString()}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.interested.toLocaleString()}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.optedOut.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-3">"Interested" counts replies sorted into a positive outcome, such as Interested, Confirmed or Wants a demo.</p>
        </CardContent>
      </Card>
    </div>
  );
}
