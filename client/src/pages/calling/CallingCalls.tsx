import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Loader2, Phone, PhoneCall, Search, Settings } from "lucide-react";
import {
  CALL_OUTCOME_LABEL,
  CALL_STATUS_LABEL,
  LIVE_CALL_STATUSES,
  type CallDirection,
  type CallOutcome,
  type CallStatus,
} from "@shared/aiCalling";
import {
  callingApi,
  callingKeys,
  formatDateTime,
  formatDuration,
  isCallingUnavailable,
  useCallingSettings,
  type CallStats,
  type CallsListResponse,
} from "@/lib/aiCallingApi";
import { CallingPageHeader, CallingUnavailable } from "@/components/calling/RequireAiCalling";
import { CallOutcomeBadge, CallStatusBadge, DirectionIcon } from "@/components/calling/CallBadges";
import { CallDetailSheet } from "@/components/calling/CallDetailSheet";
import { CallNowDialog } from "@/components/calling/CallNowDialog";

const PAGE_SIZE = 25;
const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function rangeBounds(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2.5 min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 truncate">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="text-[11px] text-gray-400 truncate">{hint}</p>}
    </div>
  );
}

export default function CallingCalls({ callId }: { callId?: string }) {
  const [, setLocation] = useLocation();
  const [range, setRange] = useState("30");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CallStatus | "all">("all");
  const [outcome, setOutcome] = useState<CallOutcome | "all">("all");
  const [direction, setDirection] = useState<CallDirection | "all">("all");
  const [page, setPage] = useState(1);
  const [callNowOpen, setCallNowOpen] = useState(false);
  const [openCallId, setOpenCallId] = useState<string | null>(callId ?? null);

  useEffect(() => { setOpenCallId(callId ?? null); }, [callId]);
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Recomputed when the range changes, so "to" is fresh enough to include new calls.
  const bounds = useMemo(() => rangeBounds(Number(range)), [range]);
  const settings = useCallingSettings();

  const stats = useQuery<CallStats>({
    queryKey: callingKeys.stats(range, "now"),
    queryFn: () => { const b = rangeBounds(Number(range)); return callingApi.stats(b.from, b.to); },
    staleTime: 30_000,
    retry: false,
  });

  const params = {
    status: status === "all" ? "" : status,
    outcome: outcome === "all" ? "" : outcome,
    direction: direction === "all" ? "" : direction,
    search,
    from: bounds.from,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  } as const;

  const list = useQuery<CallsListResponse>({
    queryKey: callingKeys.calls({ ...params, from: range }),
    queryFn: () => callingApi.listCalls(params),
    placeholderData: prev => prev,
    staleTime: 5_000,
    retry: false,
    refetchInterval: q => {
      const calls = q.state.data?.calls || [];
      if (calls.some(c => LIVE_CALL_STATUSES.includes(c.status))) return 3000;
      if (calls.some(c => c.status === "queued")) return 15000;
      return false;
    },
  });

  // Keep stats fresh while calls are live.
  const anyLive = (list.data?.calls || []).some(c => LIVE_CALL_STATUSES.includes(c.status));
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => stats.refetch(), 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyLive]);

  if (isCallingUnavailable(list.error) && !list.data) return <CallingUnavailable />;

  const rows = list.data?.calls || [];
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const s = stats.data;
  const filtersOn = status !== "all" || outcome !== "all" || direction !== "all" || !!search;

  const openCall = (id: string) => setOpenCallId(id);
  const closeCall = () => {
    setOpenCallId(null);
    if (callId) setLocation("/admin/calling", { replace: true });
  };

  const settingsData = settings.data;
  const notReady = settingsData && !settingsData.enabled;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <CallingPageHeader
        title="Phone calls"
        description="Every call the AI made or answered, with the outcome, summary and transcript."
        actions={
          <Button onClick={() => setCallNowOpen(true)} data-testid="button-call-someone-now">
            <Phone className="h-4 w-4 mr-1" /> Call someone now
          </Button>
        }
      />

      {notReady && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>AI Calling is turned off in your settings, so no calls are being made.</span>
          <Button size="sm" variant="outline" className="self-start sm:self-auto" onClick={() => setLocation("/admin/calling/settings")}>
            <Settings className="h-4 w-4 mr-1" /> Open settings
          </Button>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-700">At a glance</p>
        <Select value={range} onValueChange={v => { setRange(v); setPage(1); }}>
          <SelectTrigger className="w-[150px] h-8" data-testid="select-calling-range"><SelectValue /></SelectTrigger>
          <SelectContent>{RANGES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="calling-stats">
        <StatTile label="Calls" value={s ? s.total.toLocaleString() : "—"} />
        <StatTile label="Answered" value={s ? s.answered.toLocaleString() : "—"} hint={s && s.total ? `${Math.round((s.answered / s.total) * 100)}% of calls` : undefined} />
        <StatTile label="Interested" value={s ? s.interested.toLocaleString() : "—"} />
        <StatTile label="Call-backs" value={s ? s.callbacks.toLocaleString() : "—"} />
        <StatTile label="Minutes" value={s ? Math.round(s.minutes).toLocaleString() : "—"} />
        <StatTile label="Avg length" value={s ? formatDuration(s.avgDurationSec) : "—"} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-[1fr_170px_170px_150px]">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search by name or phone" className="pl-9" data-testid="input-search-calls" />
            </div>
            <Select value={status} onValueChange={v => { setStatus(v as CallStatus | "all"); setPage(1); }}>
              <SelectTrigger data-testid="select-call-status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {(Object.keys(CALL_STATUS_LABEL) as CallStatus[]).map(k => <SelectItem key={k} value={k}>{CALL_STATUS_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={outcome} onValueChange={v => { setOutcome(v as CallOutcome | "all"); setPage(1); }}>
              <SelectTrigger data-testid="select-call-outcome"><SelectValue placeholder="Outcome" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any outcome</SelectItem>
                {(Object.keys(CALL_OUTCOME_LABEL) as CallOutcome[]).map(k => <SelectItem key={k} value={k}>{CALL_OUTCOME_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={direction} onValueChange={v => { setDirection(v as CallDirection | "all"); setPage(1); }}>
              <SelectTrigger data-testid="select-call-direction"><SelectValue placeholder="Direction" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">In &amp; out</SelectItem>
                <SelectItem value="outbound">AI called them</SelectItem>
                <SelectItem value="inbound">They called you</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {list.isLoading ? (
            <div className="p-10 text-center text-gray-500"><Loader2 className="inline h-5 w-5 animate-spin" /></div>
          ) : list.isError ? (
            <div className="p-8 text-center text-sm text-gray-600">Couldn't load calls: {(list.error as Error).message}</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center">
              <PhoneCall className="mx-auto h-8 w-8 text-gray-300" />
              <p className="mt-2 text-sm text-gray-600">{filtersOn ? "No calls match these filters." : "No calls in this period yet."}</p>
              {!filtersOn && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setLocation("/admin/calling/try")}>Try a test call</Button>
                  <Button size="sm" onClick={() => setCallNowOpen(true)}>Call someone now</Button>
                </div>
              )}
            </div>
          ) : (
            <div className={`divide-y ${list.isFetching && !list.isRefetching ? "opacity-70" : ""}`}>
              {rows.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openCall(c.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                  data-testid={`row-call-${c.id}`}
                >
                  <DirectionIcon direction={c.direction} className="mt-1 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-medium text-gray-900">{c.leadName || c.phone}</span>
                      {c.leadName && <span className="font-mono text-xs text-gray-500">{c.phone}</span>}
                      {c.provider === "simulator" && <span className="rounded bg-gray-100 px-1.5 text-[10px] uppercase tracking-wide text-gray-500">Test</span>}
                    </div>
                    {c.summary ? (
                      <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">{c.summary}</p>
                    ) : c.status === "queued" && c.scheduledAt ? (
                      <p className="mt-0.5 text-sm text-gray-500">Scheduled for {formatDateTime(c.scheduledAt)}</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:hidden">
                      <CallStatusBadge status={c.status} />
                      <CallOutcomeBadge outcome={c.outcome} status={c.status} />
                    </div>
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                    <div className="flex items-center gap-1.5">
                      <CallOutcomeBadge outcome={c.outcome} status={c.status} />
                      <CallStatusBadge status={c.status} />
                    </div>
                    <span className="text-xs text-gray-500">{formatDateTime(c.startedAt || c.createdAt)}{c.durationSec ? ` · ${formatDuration(c.durationSec)}` : ""}</span>
                  </div>
                  <span className="shrink-0 text-xs text-gray-500 sm:hidden">{formatDateTime(c.startedAt || c.createdAt)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-gray-600">
            <span>{total.toLocaleString()} {total === 1 ? "call" : "calls"}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">Previous</span>
              </Button>
              <span>Page {Math.min(page, totalPages)} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <span className="hidden sm:inline">Next</span> <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <CallDetailSheet callId={openCallId} onClose={closeCall} />
      <CallNowDialog open={callNowOpen} onOpenChange={setCallNowOpen} />
    </div>
  );
}
