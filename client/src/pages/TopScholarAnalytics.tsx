import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";
import type { MeResponseDto } from "@shared/dto";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip as MetricTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  MessageSquare,
  HelpCircle,
  TrendingUp,
  Loader2,
  Smile,
  Meh,
  Frown,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Timer,
  Download,
  CalendarDays,
  UserPlus,
  Activity,
  Info,
  Mic,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { DateRange } from "react-day-picker";
import { format, subDays, startOfDay, endOfDay, formatDistanceToNow } from "date-fns";

// ---- API response shapes (mirror server/services/topscholar/analyticsService.ts) ----
interface Overview {
  totalStudents: number;
  activeStudents: number;
  totalConversations: number;
  totalQuestions: number;
  avgQuestionsPerStudent: number;
  avgDoubtsPerSession: number;
  sentiment: { positive: number; neutral: number; confused: number; unlabeled: number };
  escalation: {
    retryAttempted: number;
    retrySucceeded: number;
    escalated: number;
    bySubject: { subject: string; count: number }[];
  };
  resolution: {
    resolvedFirstPass: number;
    resolvedAfterRetry: number;
    resolved: number;
    escalated: number;
    pending: number;
    resolutionRate: number;
    escalationRate: number;
  };
  duration: {
    closedSessions: number;
    avgDurationSeconds: number;
    medianDurationSeconds: number;
    measuredSessions: number;
    avgActiveSeconds: number;
    medianActiveSeconds: number;
  };
  voice: {
    sessions: number;
    totalSeconds: number;
    totalMinutes: number;
  };
}
interface TopQuestions {
  topics: { label: string; count: number }[];
  subtopics: { label: string; count: number }[];
  questions: { text: string; count: number }[];
}
interface CurriculumRow {
  label: string;
  conversations: number;
  questions: number;
  resolved: number;
  escalated: number;
  pending: number;
}
interface Curriculum {
  bySubject: CurriculumRow[];
  byGrade: CurriculumRow[];
  byBoard: CurriculumRow[];
  byMedium: CurriculumRow[];
  byTopic: { label: string; count: number }[];
}
interface Adoption {
  asOf: string;
  dau: number;
  wau: number;
  mau: number;
  stickiness: number;
  daily: { bucket: string; activeStudents: number }[];
  newStudents: number;
  returningStudents: number;
}
interface TrendPoint {
  bucket: string;
  conversations: number;
  questions: number;
}
interface StudentRow {
  studentId: string | null;
  studentName: string | null;
  conversationCount: number;
  questionCount: number;
  lastActive: string | null;
  curriculumLabel: string;
  grade: string | null;
}
interface StudentRosterResponse {
  items: StudentRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
interface StudentReport {
  studentId: string;
  studentName: string | null;
  curriculumLabel: string;
  board: string | null;
  medium: string | null;
  grade: string | null;
  stats: { conversationCount: number; questionCount: number; firstActive: string | null; lastActive: string | null };
  sentiment: { positive: number; neutral: number; confused: number; unlabeled: number };
  subjects: { label: string; questions: number }[];
  questionHistory: { text: string; createdAt: string; conversationId: string; sentiment: string | null }[];
}
interface SubjectOption {
  name: string;
  cpCount: number;
}
interface ScopeOption {
  board: string;
  medium: string;
  grade: string;
  label: string;
  cpCount: number;
  subjects: SubjectOption[];
}

const ALL = "__all__";
const CUSTOM = "custom";
const RANGES: { value: string; label: string; days: number | null }[] = [
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "all", label: "All time", days: null },
  { value: CUSTOM, label: "Custom range…", days: null },
];

function buildQs(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

const COLORS = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

/** Resolution split colours, reused across every stacked chart so the legend reads the same everywhere. */
const RESOLUTION_SERIES = [
  { key: "resolved", name: "Resolved", fill: "#10b981" },
  { key: "pending", name: "Awaiting outcome", fill: "#f59e0b" },
  { key: "escalated", name: "Escalated", fill: "#ef4444" },
] as const;

/** Humanise a duration in seconds: 95 -> "1m 35s", 4210 -> "1h 10m". */
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  description,
  tone = "indigo",
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  description: string;
  tone?: "indigo" | "emerald" | "rose" | "amber";
}) {
  const tones: Record<string, string> = {
    indigo: "from-indigo-500 to-violet-600",
    emerald: "from-emerald-500 to-teal-600",
    rose: "from-rose-500 to-red-600",
    amber: "from-amber-500 to-orange-600",
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${tones[tone]} flex items-center justify-center text-white shrink-0`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-tight" data-testid={`kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{value}</div>
             <div className="flex items-center gap-1 text-xs text-muted-foreground">
               <span className="truncate">{label}</span>
               <MetricTooltip>
                 <TooltipTrigger asChild>
                   <button
                     type="button"
                     aria-label={`About ${label}`}
                     className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                   >
                     <Info className="h-3.5 w-3.5" aria-hidden="true" />
                   </button>
                 </TooltipTrigger>
                 <TooltipContent side="top" className="max-w-xs leading-relaxed">
                   {description}
                 </TooltipContent>
               </MetricTooltip>
             </div>
            {sub && <div className="text-[11px] text-muted-foreground/80 truncate" title={sub}>{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TopScholarAnalytics() {
  const { toast } = useToast();
  const [rangeKey, setRangeKey] = useState<string>("30");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [board, setBoard] = useState("");
  const [medium, setMedium] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [bucket, setBucket] = useState<"day" | "week" | "month">("day");
  const [search, setSearch] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [openStudentId, setOpenStudentId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data: me, isLoading: meLoading } = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });
  const isTopscholar = me?.businessAccount?.isTopscholar === true;

  const { data: options } = useQuery<ScopeOption[]>({
    queryKey: ["/api/topscholar/scope-options"],
    enabled: isTopscholar,
  });
  const opts = options ?? [];
  const boards = useMemo(() => Array.from(new Set(opts.map((o) => o.board).filter(Boolean))).sort(), [opts]);
  const mediums = useMemo(
    () => Array.from(new Set(opts.filter((o) => !board || o.board === board).map((o) => o.medium).filter(Boolean))).sort(),
    [opts, board],
  );
  const grades = useMemo(
    () =>
      Array.from(
        new Set(
          opts
            .filter((o) => (!board || o.board === board) && (!medium || o.medium === medium))
            .map((o) => o.grade)
            .filter(Boolean),
        ),
      ).sort(),
    [opts, board, medium],
  );
  const selectedCombo = useMemo(
    () => (board && medium && grade ? opts.find((o) => o.board === board && o.medium === medium && o.grade === grade) ?? null : null),
    [opts, board, medium, grade],
  );
  const subjects = useMemo(() => selectedCombo?.subjects ?? [], [selectedCombo]);

  // Common query window for all analytics endpoints.
  // Stabilize `from`/`to` to day granularity so they do NOT change on every
  // render — otherwise each render produces a new query key, causing React
  // Query to refetch endlessly and the loading spinners to never resolve.
  const { from, to } = useMemo(() => {
    if (rangeKey === CUSTOM) {
      return {
        from: customRange?.from ? startOfDay(customRange.from).toISOString() : undefined,
        // The picker returns a bare date; widen it to the end of that day so a
        // single-day selection includes everything that happened that day
        // rather than only the midnight instant.
        to: customRange?.to ? endOfDay(customRange.to).toISOString() : undefined,
      };
    }
    const preset = RANGES.find((r) => r.value === rangeKey);
    return {
      from: preset?.days ? startOfDay(subDays(new Date(), preset.days)).toISOString() : undefined,
      to: undefined,
    };
  }, [rangeKey, customRange]);

  const scopeParams = {
    from,
    to,
    board: board || undefined,
    medium: medium || undefined,
    grade: grade || undefined,
    subject: subject || undefined,
  };
  const scopeQs = buildQs(scopeParams);

  const overviewQ = useQuery<Overview>({ queryKey: [`/api/topscholar/analytics/overview${scopeQs}`], enabled: isTopscholar });
  const topQ = useQuery<TopQuestions>({ queryKey: [`/api/topscholar/analytics/top-questions${scopeQs}`], enabled: isTopscholar });
  const curriculumQ = useQuery<Curriculum>({ queryKey: [`/api/topscholar/analytics/curriculum${scopeQs}`], enabled: isTopscholar });
  const adoptionQ = useQuery<Adoption>({ queryKey: [`/api/topscholar/analytics/adoption${scopeQs}`], enabled: isTopscholar });
  const trendsQ = useQuery<TrendPoint[]>({
    queryKey: [`/api/topscholar/analytics/trends${buildQs({ ...scopeParams, bucket })}`],
    enabled: isTopscholar,
  });
  const studentsQ = useQuery<StudentRosterResponse>({
    queryKey: [`/api/topscholar/analytics/students${buildQs({ ...scopeParams, q: search || undefined, page: String(studentPage), pageSize: "10" })}`],
    enabled: isTopscholar,
    placeholderData: (previousData) => previousData,
  });
  const reportQ = useQuery<StudentReport>({
    queryKey: [`/api/topscholar/analytics/students/${openStudentId}${buildQs({ from, to })}`],
    enabled: isTopscholar && !!openStudentId,
  });

  const handleBoard = (v: string) => { setBoard(v === ALL ? "" : v); setMedium(""); setGrade(""); setSubject(""); setStudentPage(1); };
  const handleMedium = (v: string) => { setMedium(v === ALL ? "" : v); setGrade(""); setSubject(""); setStudentPage(1); };
  const handleGrade = (v: string) => { setGrade(v === ALL ? "" : v); setSubject(""); setStudentPage(1); };
  const handleSubject = (v: string) => { setSubject(v === ALL ? "" : v); setStudentPage(1); };
  const handleRange = (v: string) => {
    setRangeKey(v);
    setStudentPage(1);
    if (v === CUSTOM) setDatePickerOpen(true);
    else setCustomRange(undefined);
  };
  const resetFilters = () => {
    setBoard(""); setMedium(""); setGrade(""); setSubject("");
    setRangeKey("30"); setCustomRange(undefined);
    setStudentPage(1);
  };

  /**
   * Download a CSV export. Uses fetch (not a plain link) so an auth or server
   * error surfaces as a toast instead of silently saving an HTML error page
   * with a .csv extension.
   */
  const downloadCsv = async (kind: "students" | "doubts", path: string) => {
    setDownloading(kind);
    try {
      const res = await fetch(path, { credentials: "include" });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] || `topscholar-${kind}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not download the CSV.",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  if (meLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!isTopscholar) return <Redirect to="/" />;

  const ov = overviewQ.data;
  const ad = adoptionQ.data;
  const sentimentTotal = ov ? ov.sentiment.positive + ov.sentiment.neutral + ov.sentiment.confused : 0;
  const cohortTotal = ad ? ad.newStudents + ad.returningStudents : 0;
  const customLabel =
    customRange?.from && customRange?.to
      ? `${format(customRange.from, "MMM d")} – ${format(customRange.to, "MMM d, yyyy")}`
      : customRange?.from
        ? `${format(customRange.from, "MMM d, yyyy")} – …`
        : "Pick dates";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-topscholar-analytics">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Student Analytics</h1>
        <p className="text-sm text-muted-foreground">Learning activity, engagement and confusion signals across your curriculum.</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <FilterSelect
            label="Range"
            value={rangeKey}
            onChange={handleRange}
            options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
            testId="filter-range"
          />
          {rangeKey === CUSTOM && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">Dates</label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 justify-start font-normal" data-testid="button-date-range">
                    <CalendarDays className="w-4 h-4 mr-2" />
                    {customLabel}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={customRange}
                    onSelect={(nextRange) => {
                      setCustomRange(nextRange);
                      setStudentPage(1);
                    }}
                    numberOfMonths={2}
                    disabled={{ after: new Date() }}
                    data-testid="calendar-date-range"
                  />
                  <div className="flex justify-end gap-2 border-t p-2">
                    <Button variant="ghost" size="sm" onClick={() => { setCustomRange(undefined); setStudentPage(1); }}>Clear</Button>
                    <Button size="sm" onClick={() => setDatePickerOpen(false)} data-testid="button-apply-dates">Apply</Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
          <FilterSelect label="Board" value={board || ALL} onChange={handleBoard} options={[{ value: ALL, label: "All boards" }, ...boards.map((b) => ({ value: b, label: b }))]} testId="filter-board" />
          <FilterSelect label="Medium" value={medium || ALL} onChange={handleMedium} options={[{ value: ALL, label: "All mediums" }, ...mediums.map((m) => ({ value: m, label: m }))]} testId="filter-medium" />
          <FilterSelect label="Grade" value={grade || ALL} onChange={handleGrade} options={[{ value: ALL, label: "All grades" }, ...grades.map((g) => ({ value: g, label: g }))]} testId="filter-grade" />
          <FilterSelect label="Subject" value={subject || ALL} onChange={handleSubject} options={[{ value: ALL, label: "All subjects" }, ...subjects.map((s) => ({ value: s.name, label: s.name }))]} testId="filter-subject" />
          <Button variant="ghost" size="sm" onClick={resetFilters} data-testid="button-reset-filters">
            <RotateCcw className="w-4 h-4 mr-1" /> Reset
          </Button>
          <div className="ml-auto flex items-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv("doubts", `/api/topscholar/analytics/doubts/export${scopeQs}`)}
              disabled={downloading !== null}
              data-testid="button-export-doubts"
            >
              {downloading === "doubts" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
              Export doubts
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Volume KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          icon={Users}
          label="Students"
          value={ov?.totalStudents ?? "—"}
          description="Unique students with at least one qualifying chat session in the selected date range and curriculum filters."
        />
        <KpiCard
          icon={MessageSquare}
          label="Chat Sessions"
          value={ov?.totalConversations ?? "—"}
          description="The number of qualifying chat conversations. One session can contain multiple doubts from the same student."
        />
        <KpiCard
          icon={HelpCircle}
          label="Doubts Asked"
          value={ov?.totalQuestions ?? "—"}
          description="The number of student questions or messages in qualifying chat sessions. Repeated questions are counted separately."
        />
        <KpiCard
          icon={TrendingUp}
          label="Avg Doubts / Student"
          value={ov?.avgQuestionsPerStudent ?? "—"}
          sub={ov ? `${ov.avgDoubtsPerSession} per chat session` : undefined}
          description="Doubts Asked divided by Students for the current date range and curriculum filters."
        />
        <KpiCard
          icon={Mic}
          label="Total Voice Minutes"
          value={ov ? ov.voice.totalMinutes.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}
          sub={ov ? `${ov.voice.sessions} voice ${ov.voice.sessions === 1 ? "session" : "sessions"}` : undefined}
          description="Total time voice mode remained connected during the selected date range and curriculum filters."
        />
      </div>

      {/* Outcome KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={CheckCircle2}
          tone="emerald"
          label="Resolution Rate"
          value={ov ? `${ov.resolution.resolutionRate}%` : "—"}
          sub={ov ? `${ov.resolution.resolved} of ${ov.totalConversations} chat sessions` : undefined}
          description="The percentage of chat sessions counted as resolved through the retry flow: no unresolved report, or confirmation after the bot's retry. This is session-level, not per-doubt."
        />
        <KpiCard
          icon={AlertTriangle}
          tone="rose"
          label="Escalation Rate"
          value={ov ? `${ov.resolution.escalationRate}%` : "—"}
          sub={ov ? `${ov.resolution.escalated} escalated to support` : undefined}
          description="The percentage of chat sessions that remained unresolved after the retry flow and were escalated to support."
        />
        <KpiCard
          icon={Timer}
          tone="amber"
          label="Median Active Time"
          value={ov ? formatDuration(ov.duration.medianActiveSeconds) : "—"}
          sub={ov ? `per chat session · avg ${formatDuration(ov.duration.avgActiveSeconds)}` : undefined}
          description="The middle active-time value across sessions, measured from the first student message to the last. It is not the session's 24-hour resumable lifetime."
        />
        <KpiCard
          icon={Activity}
          label="Awaiting Outcome"
          value={ov?.resolution.pending ?? "—"}
          sub="retry sent, student hasn't replied"
          description="Chat sessions where a retry was sent but the student has not yet provided an outcome."
        />
      </div>

      <div className="text-[11px] text-muted-foreground -mt-3 space-y-1">
        <p>
          Resolution is measured per chat session from the retry/escalation flow: a session counts as resolved when the
          student never reported the doubt unresolved, or confirmed it was resolved after the bot's retry. Per-doubt
          resolution needs additional in-chat capture and is not included yet.
        </p>
        <p>
          Active time is the span from a student's first to last message in a session — the time they were actually
          working. It is not the session lifetime: sessions stay resumable for 24 hours and are usually closed by the
          expiry sweep, so open-to-close would read close to a full day
          {ov && ov.duration.closedSessions > 0
            ? ` (currently a ${formatDuration(ov.duration.medianDurationSeconds)} median across ${ov.duration.closedSessions} closed sessions)`
            : ""}
          .
        </p>
      </div>

      {/* Adoption */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Active Students</CardTitle>
            <CardDescription>
              Distinct students who asked at least one doubt in each trailing window
              {ad ? `, as of ${format(new Date(ad.asOf), "MMM d, yyyy")}` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              <MiniStat label="Daily (DAU)" value={ad?.dau ?? "—"} testId="stat-dau" />
              <MiniStat label="Weekly (WAU)" value={ad?.wau ?? "—"} testId="stat-wau" />
              <MiniStat label="Monthly (MAU)" value={ad?.mau ?? "—"} testId="stat-mau" />
              <MiniStat label="Stickiness" value={ad ? `${ad.stickiness}%` : "—"} testId="stat-stickiness" />
            </div>
            <div className="h-40 mt-4">
              {ad && ad.daily.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ad.daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickFormatter={(d) => format(new Date(d), "MMM d")} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip labelFormatter={(d) => format(new Date(d as string), "MMM d, yyyy")} />
                    <Line type="monotone" dataKey="activeStudents" name="Active students" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState loading={adoptionQ.isLoading} />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">New vs Returning</CardTitle>
            <CardDescription>Within the selected range.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="New students" value={ad?.newStudents ?? "—"} testId="stat-new-students" />
              <MiniStat label="Returning" value={ad?.returningStudents ?? "—"} testId="stat-returning-students" />
            </div>
            {cohortTotal > 0 && ad && (
              <div>
                <div className="h-2 rounded-full overflow-hidden flex">
                  <div className="bg-indigo-500 h-full" style={{ width: `${(ad.newStudents / cohortTotal) * 100}%` }} />
                  <div className="bg-cyan-500 h-full" style={{ width: `${(ad.returningStudents / cohortTotal) * 100}%` }} />
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                  <span className="flex items-center gap-1"><UserPlus className="w-3 h-3 text-indigo-500" /> {Math.round((ad.newStudents / cohortTotal) * 100)}% new</span>
                  <span>{Math.round((ad.returningStudents / cohortTotal) * 100)}% returning</span>
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              A student is “new” when their very first chat session on this account falls inside the selected range.
              With “All time” selected every student is new by definition.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sentiment */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sentiment &amp; Confusion</CardTitle>
          <CardDescription>How students felt during their tutoring sessions{ov && ov.sentiment.unlabeled > 0 ? ` · ${ov.sentiment.unlabeled} not yet classified` : ""}.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <SentimentStat icon={Smile} color="text-emerald-600" label="Positive" value={ov?.sentiment.positive ?? 0} total={sentimentTotal} />
          <SentimentStat icon={Meh} color="text-amber-600" label="Neutral" value={ov?.sentiment.neutral ?? 0} total={sentimentTotal} />
          <SentimentStat icon={Frown} color="text-rose-600" label="Confused" value={ov?.sentiment.confused ?? 0} total={sentimentTotal} />
        </CardContent>
      </Card>

      {/* Bot Retry & Escalations */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bot Retry &amp; Escalations</CardTitle>
          <CardDescription>
            When a student says their doubt wasn't resolved, the bot retries once with a simpler explanation before escalating to the support team.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div data-testid="stat-resolved-first-pass">
              <p className="text-2xl font-semibold text-emerald-600">{ov?.resolution.resolvedFirstPass ?? 0}</p>
              <p className="text-xs text-muted-foreground">Resolved without a retry</p>
            </div>
            <div data-testid="stat-retry-attempted">
              <p className="text-2xl font-semibold">{ov?.escalation?.retryAttempted ?? 0}</p>
              <p className="text-xs text-muted-foreground">Retries attempted</p>
            </div>
            <div data-testid="stat-retry-succeeded">
              <p className="text-2xl font-semibold text-emerald-600">{ov?.escalation?.retrySucceeded ?? 0}</p>
              <p className="text-xs text-muted-foreground">Resolved after retry</p>
            </div>
            <div data-testid="stat-escalated">
              <p className="text-2xl font-semibold text-rose-600">{ov?.escalation?.escalated ?? 0}</p>
              <p className="text-xs text-muted-foreground">Escalated to support</p>
            </div>
          </div>
          {ov && ov.escalation?.bySubject?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Escalations by subject</p>
              <div className="space-y-1">
                {ov.escalation.bySubject.map((row) => (
                  <div key={row.subject} className="flex items-center justify-between text-sm" data-testid={`row-escalation-subject-${row.subject}`}>
                    <span>{row.subject}</span>
                    <span className="font-medium">{row.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trends */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Engagement Trend</CardTitle>
            <CardDescription>Chat sessions and doubts over time.</CardDescription>
          </div>
          <Select value={bucket} onValueChange={(v) => setBucket(v as "day" | "week" | "month")}>
            <SelectTrigger className="w-28 h-8" data-testid="filter-bucket"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="h-64">
          {trendsQ.data && trendsQ.data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendsQ.data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d) => format(new Date(d), bucket === "month" ? "MMM yyyy" : "MMM d")}
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={(d) => format(new Date(d as string), bucket === "month" ? "MMMM yyyy" : "MMM d, yyyy")} />
                <Legend />
                <Line type="monotone" dataKey="questions" name="Doubts" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="conversations" name="Chat Sessions" stroke="#06b6d4" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState loading={trendsQ.isLoading} />
          )}
        </CardContent>
      </Card>

      {/* Curriculum breakdown — resolution split */}
      <div className="grid md:grid-cols-2 gap-4">
        <ResolutionBreakdownCard
          title="Subjects"
          description="Chat sessions by subject, split by outcome."
          rows={curriculumQ.data?.bySubject ?? []}
          loading={curriculumQ.isLoading}
          layout="vertical"
          limit={8}
          testId="chart-subject-resolution"
        />
        <ResolutionBreakdownCard
          title="Grades"
          description="Chat sessions by grade, split by outcome."
          rows={curriculumQ.data?.byGrade ?? []}
          loading={curriculumQ.isLoading}
          layout="horizontal"
          limit={10}
          testId="chart-grade-resolution"
        />
        <ResolutionBreakdownCard
          title="Boards"
          description="Chat sessions by curriculum board, split by outcome."
          rows={curriculumQ.data?.byBoard ?? []}
          loading={curriculumQ.isLoading}
          layout="horizontal"
          limit={10}
          testId="chart-board-resolution"
        />
        <ResolutionBreakdownCard
          title="Mediums"
          description="Chat sessions by language of instruction, split by outcome."
          rows={curriculumQ.data?.byMedium ?? []}
          loading={curriculumQ.isLoading}
          layout="horizontal"
          limit={10}
          testId="chart-medium-resolution"
        />
      </div>

      {/* Doubt volume by subject / grade */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Doubts by Subject</CardTitle></CardHeader>
          <CardContent className="h-64">
            {curriculumQ.data && curriculumQ.data.bySubject.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={curriculumQ.data.bySubject.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip />
                  <Bar dataKey="questions" name="Doubts" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState loading={curriculumQ.isLoading} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Doubts by Grade</CardTitle></CardHeader>
          <CardContent className="h-64">
            {curriculumQ.data && curriculumQ.data.byGrade.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={curriculumQ.data.byGrade.slice(0, 10)} margin={{ top: 4, right: 12, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="questions" name="Doubts" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState loading={curriculumQ.isLoading} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top doubts / topics */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Top Topics</CardTitle></CardHeader>
          <CardContent>
            <RankedList items={(topQ.data?.topics ?? []).map((t) => ({ label: t.label, count: t.count }))} loading={topQ.isLoading} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Most-Asked Doubts</CardTitle></CardHeader>
          <CardContent>
            <RankedList items={(topQ.data?.questions ?? []).map((q) => ({ label: q.text, count: q.count }))} loading={topQ.isLoading} mono />
          </CardContent>
        </Card>
      </div>

      {/* Student roster */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0 gap-3">
          <div>
            <CardTitle className="text-base">Students</CardTitle>
            <CardDescription>Click a student to view their detailed report.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="Search students…" value={search} onChange={(e) => { setSearch(e.target.value); setStudentPage(1); }} className="w-48 h-8" data-testid="input-student-search" />
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => downloadCsv("students", `/api/topscholar/analytics/students/export${buildQs({ ...scopeParams, q: search || undefined })}`)}
              disabled={downloading !== null}
              data-testid="button-export-students"
            >
              {downloading === "students" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
              CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {studentsQ.isLoading ? (
            <EmptyState loading />
          ) : (studentsQ.data?.items ?? []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">No students match the current filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Curriculum</TableHead>
                    <TableHead className="text-right">Chat Sessions</TableHead>
                    <TableHead className="text-right">Doubts</TableHead>
                    <TableHead>Last active</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(studentsQ.data?.items ?? []).map((s, i) => {
                    const clickable = !!s.studentId;
                    return (
                      <TableRow
                        key={s.studentId ?? i}
                        className={clickable ? "cursor-pointer" : ""}
                        onClick={() => clickable && setOpenStudentId(s.studentId)}
                        data-testid={`row-student-${i}`}
                      >
                        <TableCell className="font-medium">{s.studentName || "Anonymous"}</TableCell>
                        <TableCell className="text-muted-foreground">{s.curriculumLabel || "—"}</TableCell>
                        <TableCell className="text-right">{s.conversationCount}</TableCell>
                        <TableCell className="text-right">{s.questionCount}</TableCell>
                        <TableCell className="text-muted-foreground">{s.lastActive ? formatDistanceToNow(new Date(s.lastActive), { addSuffix: true }) : "—"}</TableCell>
                        <TableCell>{clickable && <ChevronRight className="w-4 h-4 text-muted-foreground" />}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {studentsQ.data && studentsQ.data.totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
              <span>
                Showing {(studentPage - 1) * studentsQ.data.pageSize + 1}–{Math.min(studentPage * studentsQ.data.pageSize, studentsQ.data.total)} of {studentsQ.data.total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setStudentPage((page) => Math.max(1, page - 1))}
                  disabled={studentPage <= 1 || studentsQ.isFetching}
                  aria-label="Previous student page"
                  data-testid="button-students-previous"
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <span className="whitespace-nowrap">Page {studentPage} of {studentsQ.data.totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setStudentPage((page) => Math.min(studentsQ.data?.totalPages ?? page, page + 1))}
                  disabled={studentPage >= studentsQ.data.totalPages || studentsQ.isFetching}
                  aria-label="Next student page"
                  data-testid="button-students-next"
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Student drill-down */}
      <Dialog open={!!openStudentId} onOpenChange={(o) => !o && setOpenStudentId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-student-report">
          <DialogHeader>
            <DialogTitle>{reportQ.data?.studentName || "Student report"}</DialogTitle>
            <DialogDescription>{reportQ.data?.curriculumLabel}</DialogDescription>
          </DialogHeader>
          {reportQ.isLoading ? (
            <EmptyState loading />
          ) : reportQ.data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniStat label="Chat Sessions" value={reportQ.data.stats.conversationCount} />
                <MiniStat label="Doubts" value={reportQ.data.stats.questionCount} />
                <MiniStat label="First active" value={reportQ.data.stats.firstActive ? format(new Date(reportQ.data.stats.firstActive), "MMM d") : "—"} />
                <MiniStat label="Last active" value={reportQ.data.stats.lastActive ? format(new Date(reportQ.data.stats.lastActive), "MMM d") : "—"} />
              </div>

              <div className="flex flex-wrap gap-2">
                {reportQ.data.subjects.map((s) => (
                  <Badge key={s.label} variant="secondary">{s.label}: {s.questions}</Badge>
                ))}
              </div>

              <div className="flex gap-2 text-xs">
                <span className="flex items-center gap-1 text-emerald-600"><Smile className="w-3.5 h-3.5" /> {reportQ.data.sentiment.positive}</span>
                <span className="flex items-center gap-1 text-amber-600"><Meh className="w-3.5 h-3.5" /> {reportQ.data.sentiment.neutral}</span>
                <span className="flex items-center gap-1 text-rose-600"><Frown className="w-3.5 h-3.5" /> {reportQ.data.sentiment.confused}</span>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Recent doubts</div>
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {reportQ.data.questionHistory.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No doubts recorded.</div>
                  ) : (
                    reportQ.data.questionHistory.map((q, i) => (
                      <div key={i} className="text-sm border rounded-md px-3 py-2">
                        <div className="text-foreground">{q.text}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {format(new Date(q.createdAt), "MMM d, h:mm a")}
                          {q.sentiment ? ` · ${q.sentiment}` : ""}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No activity found for this student.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Stacked resolved / awaiting / escalated bars for one curriculum dimension. */
function ResolutionBreakdownCard({
  title,
  description,
  rows,
  loading,
  layout,
  limit,
  testId,
}: {
  title: string;
  description: string;
  rows: CurriculumRow[];
  loading?: boolean;
  layout: "vertical" | "horizontal";
  limit: number;
  testId: string;
}) {
  const data = rows.slice(0, limit);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="h-64" data-testid={testId}>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout={layout}
              margin={layout === "vertical" ? { top: 4, right: 12, left: 8, bottom: 4 } : { top: 4, right: 12, left: -16, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={layout === "horizontal"} vertical={layout === "vertical"} />
              {layout === "vertical" ? (
                <>
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={110} />
                </>
              ) : (
                <>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                </>
              )}
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {RESOLUTION_SERIES.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  stackId="resolution"
                  fill={s.fill}
                  radius={
                    i === RESOLUTION_SERIES.length - 1
                      ? layout === "vertical" ? [0, 4, 4, 0] : [4, 4, 0, 0]
                      : undefined
                  }
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState loading={loading} />
        )}
      </CardContent>
    </Card>
  );
}

function FilterSelect({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; testId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-36 h-9" data-testid={testId}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function SentimentStat({ icon: Icon, color, label, value, total }: { icon: any; color: string; label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex flex-col items-center text-center gap-1">
      <Icon className={`w-7 h-7 ${color}`} />
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label} · {pct}%</div>
    </div>
  );
}

function MiniStat({ label, value, testId }: { label: string; value: string | number; testId?: string }) {
  return (
    <div className="border rounded-md px-3 py-2" data-testid={testId}>
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function RankedList({ items, loading, mono }: { items: { label: string; count: number }[]; loading?: boolean; mono?: boolean }) {
  if (loading) return <EmptyState loading />;
  if (items.length === 0) return <div className="text-sm text-muted-foreground py-4 text-center">No data yet.</div>;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className={`truncate ${mono ? "" : "font-medium"}`} title={it.label}>{it.label}</span>
            <span className="text-muted-foreground shrink-0">{it.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(it.count / max) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ loading }: { loading?: boolean }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground py-8">
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "No data for the selected filters."}
    </div>
  );
}
