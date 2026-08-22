import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  GraduationCap, Loader2, RefreshCw, BookOpen, CloudDownload, X,
  ChevronRight, Search, Plus, Trash2, Database,
} from "lucide-react";

interface TopScholarConfig {
  ragEnabled: boolean;
  uatPlainCpId: boolean;
  contentDbUrl: string;
  contentDbName: string;
  contentDbIndex: string;
  storeType: "pgvector" | "mongodb";
  apiBaseUrl: string;
  hasApiToken: boolean;
  syncMode: "sample" | "full";
  hasTokenSecret: boolean;
}

interface ClientDbPack {
  cpId: string;
  label: string;
  cpName: string | null;
  board: string | null;
  medium: string | null;
  grade: string | null;
  subject: string | null;
  status: string | null;
  lastSyncedAt: string | null;
  counts: Record<string, number>;
  total: number;
}

interface ClientDbOverview {
  packs: ClientDbPack[];
}

interface ResolutionRow {
  id: string;
  planId: string;
  cpId: string;
  cpName: string | null;
  board: string | null;
  grade: string | null;
  medium: string | null;
  subject: string | null;
  label: string | null;
  noteCount: number;
  transcriptCount: number;
  questionCount: number;
  pdfCount: number;
  lastResolvedAt: string | null;
}

// Uniform curriculum display label. Mirrors the server-side curriculumLabel +
// composeLabel contract EXACTLY: prefer the CMS subject name (grade · board ·
// subject), then cpName, then grade · board · medium, and only fall back to the
// stored label as a last resort (so a stale legacy label never outranks cpName).
function composeCurriculumLabel(cp: {
  subject?: string | null;
  label?: string | null;
  cpName?: string | null;
  board?: string | null;
  grade?: string | null;
  medium?: string | null;
}): string | null {
  if (cp.subject) return [cp.grade, cp.board, cp.subject].filter(Boolean).join(" · ") || null;
  if (cp.cpName) return cp.cpName;
  const fromParts = [cp.grade, cp.board, cp.medium].filter(Boolean).join(" · ") || null;
  return fromParts || cp.label || null;
}

interface PlanIdRow {
  id: string;
  planId: string;
  enabled: string;
  lastStatus: string;
  lastError: string | null;
  lastCpId: string | null;
  lastCpName: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
  resolvedCpCount: number;
}

interface PlanRun {
  id: string;
  planId: string;
  status: "queued" | "resolving" | "running" | "completed" | "failed" | "cancelled";
  totalCpIds: number;
  completedCpIds: number;
  failedCpIds: number;
  activeCpId: string | null;
  error: string | null;
  updatedAt: string;
}

interface SyncRow {
  cpId: string;
  status: string;
  syncMode: string;
  storeType: string;
  chunkCount: number;
  noteCount: number;
  transcriptCount: number;
  questionCount: number;
  processedCount: number;
  totalCount: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
  planId: string | null;
  curriculumName: string | null;
  planCount: number;
}

interface Counts {
  total: number;
  idle: number;
  syncing: number;
  completed: number;
  failed: number;
  cancelled: number;
}

interface PlanSummary extends Counts {
  planId: string;
}

interface SyncSummary {
  overall: Counts;
  plans: PlanSummary[];
  noPlan: Counts | null;
}

interface Paged<T> {
  rows: T[];
  total: number;
}

type PlanEmbeddingFilter = "pending" | "completed" | "all";

interface PlanIdPage extends Paged<PlanIdRow> {
  counts: Record<PlanEmbeddingFilter, number>;
}

const NO_PLAN = "__no_plan__";
const PLAN_PAGE_SIZE = 20;
const CP_PAGE_SIZE = 25;
const STATUS_PAGE_SIZE = 25;
const STATUS_PLAN_PAGE_SIZE = 20;

async function getJson(url: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error("Request failed");
  return r.json();
}

async function sendJson(url: string, method: string, body: any) {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Request failed");
  return data;
}

function buildUrl(base: string, params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

function statusColor(status: string) {
  switch (status) {
    case "completed": return "bg-green-100 text-green-700";
    case "syncing": return "bg-blue-100 text-blue-700";
    case "failed": return "bg-red-100 text-red-700";
    case "cancelled": return "bg-amber-100 text-amber-700";
    default: return "bg-gray-100 text-gray-600";
  }
}

// Debounce a fast-changing value (search inputs) so we don't fire a query keystroke.
function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Compact "x–y of N" + Prev/Next pager shared by every paged list.
function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  const hasPrev = page > 0;
  const hasNext = end < total;
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <span className="text-xs text-gray-400">{start}–{end} of {total}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" className="h-7" disabled={!hasPrev} onClick={() => onPage(page - 1)}>Prev</Button>
        <Button size="sm" variant="outline" className="h-7" disabled={!hasNext} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export default function ContentSync() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config, isLoading: configLoading, isError: configError, error: configErrorObj } = useQuery<TopScholarConfig>({
    queryKey: ["/api/topscholar/config"],
    queryFn: async () => {
      const r = await fetch("/api/topscholar/config", { credentials: "include" });
      if (r.status === 403) throw new Error("FORBIDDEN");
      if (!r.ok) throw new Error("Request failed");
      return r.json();
    },
    retry: false,
  });

  const [sampleLimit, setSampleLimit] = useState(50);

  // Cheap status summary — the spine of the status section + the polling governor.
  // Polls only while there is in-progress work; otherwise it's fetched once.
  const { data: summary } = useQuery<SyncSummary>({
    queryKey: ["/api/topscholar/sync/summary"],
    queryFn: () => getJson("/api/topscholar/sync/summary"),
    enabled: !configError,
    refetchInterval: (query) => ((query.state.data?.overall?.syncing ?? 0) > 0 ? 5000 : false),
  });
  const { data: planRunsData } = useQuery<{ runs: PlanRun[] }>({
    queryKey: ["/api/topscholar/plan-runs"],
    queryFn: () => getJson("/api/topscholar/plan-runs"),
    enabled: !configError,
    refetchInterval: (query) => query.state.data?.runs.some((run) =>
      ["queued", "resolving", "running"].includes(run.status),
    ) ? 5000 : false,
  });
  const planRunsByPlan = useMemo(() => {
    const latest = new Map<string, PlanRun>();
    for (const run of planRunsData?.runs ?? []) {
      if (!latest.has(run.planId)) latest.set(run.planId, run);
    }
    return latest;
  }, [planRunsData?.runs]);
  const anyInProgress =
    (summary?.overall?.syncing ?? 0) > 0 ||
    (planRunsData?.runs.some((run) => ["queued", "resolving", "running"].includes(run.status)) ?? false);

  const {
    data: clientDbOverview,
    isLoading: clientDbLoading,
    isError: clientDbError,
    error: clientDbErrorObject,
  } = useQuery<ClientDbOverview>({
    queryKey: ["/api/topscholar/content/overview"],
    queryFn: () => getJson("/api/topscholar/content/overview"),
    enabled: !configError,
    refetchInterval: configError ? false : anyInProgress ? 5000 : false,
  });
  // The shared overview also includes zero-chunk sync rows so the content
  // viewer can show an in-progress pack. This card is specifically an
  // inventory of data physically present in the client DB.
  const clientDbPacks = useMemo(
    () => (clientDbOverview?.packs ?? []).filter((pack) => pack.total > 0),
    [clientDbOverview?.packs],
  );
  const [clientDbSearch, setClientDbSearch] = useState("");
  const [selectedClientDbCpIds, setSelectedClientDbCpIds] = useState<string[]>([]);
  const normalizedClientDbSearch = clientDbSearch.trim().toLowerCase();
  const visibleClientDbPacks = clientDbPacks.filter((pack) => {
    if (!normalizedClientDbSearch) return true;
    return `${pack.cpId} ${pack.label} ${pack.subject || ""}`.toLowerCase().includes(normalizedClientDbSearch);
  });

  useEffect(() => {
    const present = new Set(clientDbPacks.map((pack) => pack.cpId));
    setSelectedClientDbCpIds((selected) => {
      const remaining = selected.filter((cpId) => present.has(cpId));
      return remaining.length === selected.length ? selected : remaining;
    });
  }, [clientDbPacks]);

  function invalidateSyncViews() {
    queryClient.invalidateQueries({ queryKey: ["/api/topscholar/sync"] });
    queryClient.invalidateQueries({ queryKey: ["/api/topscholar/sync/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/topscholar/plan-ids"] });
    queryClient.invalidateQueries({ queryKey: ["/api/topscholar/content/overview"] });
    queryClient.invalidateQueries({ queryKey: ["/api/topscholar/plan-runs"] });
  }

  function syncToast(data: any) {
    if (data.queued) {
      toast({
        title: "Full sync queued",
        description: "This cp_id will run through the same protected queue as Plan syncs.",
      });
      return;
    }
    if (data.result?.mode === "full") {
      toast({
        title: "Full sync started",
        description: `${data.result?.chunkCount ?? 0} chunks queued to the OpenAI Batch API (${data.result?.batchCount ?? 1} batch). Embeddings will land automatically — watch the status below.`,
      });
    } else {
      toast({ title: "Sample sync complete", description: `${data.result?.chunkCount ?? 0} chunks embedded and stored.` });
    }
  }

  // Per-cp sync: embeds exactly one cp_id under its plan. mode is chosen per click.
  const [syncingCp, setSyncingCp] = useState<string | null>(null);
  const syncCp = useMutation({
    mutationFn: (vars: { cpId: string; planId: string; mode: "sample" | "full" }) =>
      sendJson("/api/topscholar/sync", "POST", { cpId: vars.cpId, planId: vars.planId, mode: vars.mode, sampleLimit }),
    onSuccess: (data) => { invalidateSyncViews(); syncToast(data); },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
    onSettled: () => setSyncingCp(null),
  });

  const [cancelingCpId, setCancelingCpId] = useState<string | null>(null);
  const cancelMutation = useMutation({
    mutationFn: (cpId: string) => sendJson("/api/topscholar/sync/cancel", "POST", { cpId }),
    onSuccess: (data) => {
      invalidateSyncViews();
      if (data.alreadyTerminal) {
        toast({ title: "Nothing to cancel", description: `This sync already finished (${data.status}).` });
      } else {
        toast({ title: "Sync cancelled", description: "The in-flight batch was cancelled. Already-processed work isn't refunded." });
      }
    },
    onError: (e: any) => toast({ title: "Couldn't cancel", description: e.message, variant: "destructive" }),
    onSettled: () => setCancelingCpId(null),
  });

  // Per-plan sync: embeds every cp_id under one plan via the plan-driven path.
  const [syncingPlan, setSyncingPlan] = useState<string | null>(null);
  const syncPlan = useMutation({
    mutationFn: (vars: { planId: string; mode: "sample" | "full" }) =>
      sendJson("/api/topscholar/sync-now", "POST", { planIds: [vars.planId], mode: vars.mode, sampleLimit }),
    onSuccess: (data) => {
      invalidateSyncViews();
      if (data.queued) {
        toast({
          title: `Plan sync queued for ${data.planCount} plan(s)`,
          description: "The worker will resolve the current cp_ids, then embed them one at a time. Track progress on the Plan row.",
        });
        return;
      }
      const failed = (data.results || []).filter((r: any) => r.status === "failed").length;
      toast({
        title: `Sync started for ${data.planCount} plan(s)`,
        description: failed > 0 ? `${failed} failed — check the status table.` : `Mode: ${data.mode}. Watch the status below.`,
        variant: failed > 0 ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
    onSettled: () => setSyncingPlan(null),
  });

  const cancelPlanRun = useMutation({
    mutationFn: (runId: string) => sendJson(`/api/topscholar/plan-runs/${runId}/cancel`, "POST", {}),
    onSuccess: () => {
      invalidateSyncViews();
      toast({ title: "Plan sync cancelled", description: "Queued CP IDs will not start. An already active CP ID may finish its current page." });
    },
    onError: (e: any) => toast({ title: "Couldn't cancel Plan sync", description: e.message, variant: "destructive" }),
  });

  const retryPlanRun = useMutation({
    mutationFn: (runId: string) => sendJson(`/api/topscholar/plan-runs/${runId}/retry-failed`, "POST", {}),
    onSuccess: () => {
      invalidateSyncViews();
      toast({ title: "Failed CP IDs re-queued", description: "Only the failed CP IDs will be attempted again." });
    },
    onError: (e: any) => toast({ title: "Couldn't retry Plan sync", description: e.message, variant: "destructive" }),
  });

  const resyncSelectedClientDb = useMutation({
    mutationFn: async (cpIds: string[]) => {
      const results: Array<{ cpId: string; success: boolean; error?: string }> = [];
      // Keep requests sequential so a large inventory does not launch many
      // concurrent full embedding jobs against the same client database.
      for (const cpId of cpIds) {
        try {
          await sendJson("/api/topscholar/sync", "POST", {
            cpId,
            mode: "full",
            sampleLimit,
          });
          results.push({ cpId, success: true });
        } catch (error: any) {
          results.push({ cpId, success: false, error: error?.message || "Request failed" });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      invalidateSyncViews();
      const failed = results.filter((result) => !result.success);
      setSelectedClientDbCpIds(failed.map((result) => result.cpId));
      const started = results.length - failed.length;
      toast({
        title: failed.length > 0
          ? `Started ${started}; ${failed.length} need retry`
          : `Resync started for ${started} cp_id(s)`,
        description: failed.length > 0
          ? `Only failed cp_ids remain selected: ${failed.map((result) => result.cpId).join(", ")}`
          : "The selected client-database packs are being refreshed with the current embedding and media metadata.",
        variant: failed.length > 0 ? "destructive" : undefined,
      });
    },
  });

  // Resolve: fetch-only — lists every cp_id under the given plans with counts.
  const [resolvingPlan, setResolvingPlan] = useState<string | null>(null);
  const resolve = useMutation({
    mutationFn: (vars: { planIds?: string[]; text?: string }) => sendJson("/api/topscholar/resolve", "POST", vars),
    onSuccess: (data) => {
      // Resolution changes re-attribute cp_ids to plans, so the status grouping
      // (sync rows + summary buckets) must refresh too — not just the cp lists.
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/resolutions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/plan-ids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/sync"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/sync/summary"] });
      const resolutions = data.resolutions || [];
      const cpTotal = resolutions.reduce((n: number, r: any) => n + (r.cps?.length || 0), 0);
      const failed = resolutions.filter((r: any) => r.error).length;
      toast({
        title: `Resolved ${resolutions.length} plan(s) → ${cpTotal} cp_id(s)`,
        description: failed > 0 ? `${failed} plan(s) returned no content.` : "Expand a plan below to sync its cp_ids, or sync the whole plan.",
        variant: failed > 0 ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Resolve failed", description: e.message, variant: "destructive" }),
    onSettled: () => setResolvingPlan(null),
  });

  // --- Plan IDs (master list) -------------------------------------------------
  const [planSearch, setPlanSearch] = useState("");
  const debouncedPlanSearch = useDebounced(planSearch);
  const [planEmbeddingFilter, setPlanEmbeddingFilter] = useState<PlanEmbeddingFilter>("pending");
  const [planPage, setPlanPage] = useState(0);
  useEffect(() => { setPlanPage(0); }, [debouncedPlanSearch, planEmbeddingFilter]);

  const { data: planPageData } = useQuery<PlanIdPage>({
    queryKey: ["/api/topscholar/plan-ids", { q: debouncedPlanSearch, embeddingStatus: planEmbeddingFilter, page: planPage }],
    queryFn: () => getJson(buildUrl("/api/topscholar/plan-ids", {
      q: debouncedPlanSearch,
      embeddingStatus: planEmbeddingFilter,
      limit: PLAN_PAGE_SIZE,
      offset: planPage * PLAN_PAGE_SIZE,
    })),
    enabled: !configError,
    refetchInterval: configError ? false : anyInProgress ? 5000 : false,
  });
  const plans = planPageData?.rows ?? [];
  const planTotal = planPageData?.total ?? 0;
  const planCounts = planPageData?.counts ?? { pending: 0, completed: 0, all: 0 };
  const bulkPlanSyncScope: "pending" | "all" = planEmbeddingFilter === "pending" ? "pending" : "all";
  const bulkPlanSyncCount = bulkPlanSyncScope === "pending" ? planCounts.pending : planCounts.all;
  const bulkPlanSyncLabel = bulkPlanSyncScope === "pending"
    ? `Sync All Pending (${bulkPlanSyncCount})`
    : `Sync All Plans (${bulkPlanSyncCount})`;

  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState("");
  const addPlans = useMutation({
    mutationFn: () => sendJson("/api/topscholar/plan-ids/add", "POST", { text: addText }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/plan-ids"] });
      setAddText("");
      setAddOpen(false);
      toast({ title: `Added ${data.requested} Plan ID(s)` });
    },
    onError: (e: any) => toast({ title: "Couldn't add", description: e.message, variant: "destructive" }),
  });

  // Save List: full replace of the master list (the original behavior) — anything
  // not in the pasted text is removed, along with its resolution snapshots.
  const savePlanIds = useMutation({
    mutationFn: () => sendJson("/api/topscholar/plan-ids", "PUT", { text: addText }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/plan-ids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/resolutions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/sync/summary"] });
      setAddText("");
      setAddOpen(false);
      toast({ title: `Saved list — ${data.count} Plan ID(s)`, description: "Plans not in your list were removed." });
    },
    onError: (e: any) => toast({ title: "Couldn't save list", description: e.message, variant: "destructive" }),
  });

  const [confirmDeletePlanId, setConfirmDeletePlanId] = useState<string | null>(null);
  const [removingPlan, setRemovingPlan] = useState<string | null>(null);
  const removePlan = useMutation({
    mutationFn: (planId: string) => sendJson("/api/topscholar/plan-ids/remove", "POST", { planId }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/plan-ids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/resolutions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/sync"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/sync/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/content/overview"] });
      toast({ title: "Plan removed", description: `Also deleted content for ${data?.purgedCpCount ?? 0} cp_id(s).` });
    },
    onError: (e: any) => toast({ title: "Couldn't remove", description: e.message, variant: "destructive" }),
    onSettled: () => setRemovingPlan(null),
  });

  const [confirmBulkPlanSync, setConfirmBulkPlanSync] = useState<"pending" | "all" | null>(null);
  const bulkPlanSync = useMutation({
    mutationFn: (scope: "pending" | "all") => sendJson("/api/topscholar/plan-bulk-sync", "POST", { scope }),
    onSuccess: (data) => {
      invalidateSyncViews();
      toast({
        title: `Plan sync queued for ${data.planCount} plan(s)`,
        description: "Each Plan will resolve its current cp_ids, then the protected worker will embed them in the background.",
      });
    },
    onError: (e: any) => toast({ title: "Couldn't queue Plan sync", description: e.message, variant: "destructive" }),
    onSettled: () => setConfirmBulkPlanSync(null),
  });


  // --- Status section ---------------------------------------------------------
  const [statusSearch, setStatusSearch] = useState("");
  const debouncedStatusSearch = useDebounced(statusSearch);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [statusPlanPage, setStatusPlanPage] = useState(0);

  // Build the list of plan buckets shown in the status section from the summary
  // (counts only). Optionally narrowed by the status filter so empty buckets drop.
  const summaryPlans = summary?.plans ?? [];
  const noPlanCounts = summary?.noPlan ?? null;
  const statusBuckets: { key: string; label: string | null; counts: Counts }[] = [];
  for (const p of summaryPlans) statusBuckets.push({ key: p.planId, label: p.planId, counts: p });
  if (noPlanCounts) statusBuckets.push({ key: NO_PLAN, label: null, counts: noPlanCounts });
  const filteredBuckets = statusBuckets.filter((b) => {
    if (statusFilter !== "all" && (b.counts as any)[statusFilter] === 0) return false;
    return true;
  });
  useEffect(() => { setStatusPlanPage(0); }, [statusFilter]);
  const pagedBuckets = filteredBuckets.slice(statusPlanPage * STATUS_PLAN_PAGE_SIZE, (statusPlanPage + 1) * STATUS_PLAN_PAGE_SIZE);

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (configError) {
    const forbidden = (configErrorObj as Error | null)?.message === "FORBIDDEN";
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-violet-600" /> Content Sync
            </CardTitle>
            <CardDescription>
              {forbidden
                ? "Curriculum-mode content ingestion isn't available for this account."
                : "Couldn't load the curriculum configuration."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-500">
              {forbidden
                ? "This screen is reserved for the curriculum (TopScholar) workspace. If you believe you should have access, contact your administrator."
                : "There was a problem reaching the server. This is usually temporary — please try again."}
            </p>
            {!forbidden && (
              <Button
                variant="outline"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/topscholar/config"] })}
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Retry
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg">
          <RefreshCw className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Sync</h1>
          <p className="text-sm text-gray-500">Resolve Plan IDs and sync curriculum content into the chatbot's database</p>
        </div>
      </div>

      {/* Client database inventory */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-600" /> Client DB Inventory
            <span className="ml-1 text-sm font-normal text-gray-400">({clientDbPacks.length})</span>
          </CardTitle>
          <CardDescription>
            These are the <strong>cp_id</strong> values actually found in the configured {config?.storeType === "mongodb" ? "MongoDB" : "PostgreSQL"} content database.
            Select only the packs that need new embeddings and media metadata.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={clientDbSearch}
                onChange={(e) => setClientDbSearch(e.target.value)}
                placeholder="Search stored cp_id / curriculum…"
                className="h-9 pl-8"
              />
            </div>
            <Button
              variant="outline"
              className="h-9 gap-2"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/topscholar/content/overview"] })}
              disabled={clientDbLoading}
            >
              {clientDbLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </Button>
            <Button
              variant="outline"
              className="h-9"
              onClick={() => setSelectedClientDbCpIds((selected) => {
                const visibleIds = visibleClientDbPacks.map((pack) => pack.cpId);
                const allVisible = visibleIds.length > 0 && visibleIds.every((cpId) => selected.includes(cpId));
                return allVisible
                  ? selected.filter((cpId) => !visibleIds.includes(cpId))
                  : Array.from(new Set([...selected, ...visibleIds]));
              })}
              disabled={visibleClientDbPacks.length === 0}
            >
              {visibleClientDbPacks.length > 0 && visibleClientDbPacks.every((pack) => selectedClientDbCpIds.includes(pack.cpId))
                ? "Clear visible"
                : "Select visible"}
            </Button>
            <Button
              className="h-9 gap-2 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => resyncSelectedClientDb.mutate(selectedClientDbCpIds)}
              disabled={selectedClientDbCpIds.length === 0 || resyncSelectedClientDb.isPending}
            >
              {resyncSelectedClientDb.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              Resync selected ({selectedClientDbCpIds.length})
            </Button>
          </div>

          {clientDbError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
              Couldn’t read the configured client content database.{" "}
              {(clientDbErrorObject as Error | null)?.message || "Check the connection settings and try again."}
            </div>
          ) : clientDbLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Reading client database…
            </div>
          ) : clientDbPacks.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-5 text-sm text-gray-500">
              No stored content packs were found in the configured client database.
            </div>
          ) : visibleClientDbPacks.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-5 text-sm text-gray-500">
              No stored cp_ids match this search.
            </div>
          ) : (
            <div className="max-h-80 overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-500">
                  <tr>
                    <th className="w-10 p-2" />
                    <th className="text-left p-2">Stored cp_id / curriculum</th>
                    <th className="text-left p-2">Chunks</th>
                    <th className="text-left p-2">Sync record</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleClientDbPacks.map((pack) => {
                    const selected = selectedClientDbCpIds.includes(pack.cpId);
                    return (
                      <tr key={pack.cpId} className={`border-t ${selected ? "bg-emerald-50/60" : ""}`}>
                        <td className="p-2 align-top">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => setSelectedClientDbCpIds((current) =>
                              selected
                                ? current.filter((cpId) => cpId !== pack.cpId)
                                : [...current, pack.cpId],
                            )}
                            aria-label={`Select ${pack.cpId} for resync`}
                            className="h-4 w-4 accent-emerald-600"
                          />
                        </td>
                        <td className="p-2">
                          <div className="text-gray-700">{pack.label || pack.cpId}</div>
                          <div className="font-mono text-gray-400">{pack.cpId}</div>
                        </td>
                        <td className="p-2 text-gray-600">
                          <div>{pack.total} total</div>
                          <div className="text-[11px] text-gray-400">
                            {pack.counts.note || 0}n / {pack.counts.transcript || 0}t / {pack.counts.question || 0}q / {pack.counts.ebook_page || 0}p
                          </div>
                        </td>
                        <td className="p-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 ${statusColor(pack.status || "idle")}`}>
                            {pack.status || "not tracked"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400">
            The inventory is read from the configured content store, not inferred from CMS resolution. Targeted resync resolves each selected cp_id to its owning Plan ID automatically.
          </p>
        </CardContent>
      </Card>

      {/* Plan IDs master list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-violet-600" /> Plan IDs
            <span className="ml-1 text-sm font-normal text-gray-400">({planCounts.all})</span>
          </CardTitle>
          <CardDescription>
            The master list of TopScholar Plan IDs to ingest. <strong>Resolve</strong> looks up every cp_id under a Plan ID (with content counts) without embedding anything — then expand a plan to sync exactly what you want. Syncing is fully manual; nothing runs on a schedule.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={planEmbeddingFilter} onValueChange={(value) => setPlanEmbeddingFilter(value as PlanEmbeddingFilter)}>
            <TabsList className="h-9 bg-violet-50/80">
              <TabsTrigger value="pending" className="h-7 gap-1.5 text-xs">
                Pending <span className="text-muted-foreground">({planCounts.pending})</span>
              </TabsTrigger>
              <TabsTrigger value="completed" className="h-7 gap-1.5 text-xs">
                Completed <span className="text-muted-foreground">({planCounts.completed})</span>
              </TabsTrigger>
              <TabsTrigger value="all" className="h-7 gap-1.5 text-xs">
                All <span className="text-muted-foreground">({planCounts.all})</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={planSearch}
                onChange={(e) => setPlanSearch(e.target.value)}
                placeholder="Search Plan IDs…"
                className="h-9 pl-8"
              />
            </div>
            <Button variant="outline" className="h-9 gap-2" onClick={() => setAddOpen((v) => !v)}>
              <Plus className="w-4 h-4" /> Add plans
            </Button>
            <Button
              className="h-9 gap-2 bg-violet-600 hover:bg-violet-700"
              onClick={() => setConfirmBulkPlanSync(bulkPlanSyncScope)}
              disabled={bulkPlanSync.isPending || bulkPlanSyncCount === 0}
            >
              {bulkPlanSync.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {bulkPlanSyncLabel}
            </Button>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-gray-500 whitespace-nowrap">Sample chunks</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={sampleLimit}
                onChange={(e) => setSampleLimit(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                className="h-9 w-20"
              />
            </div>
          </div>

          <Collapsible open={addOpen} onOpenChange={setAddOpen}>
            <CollapsibleContent className="space-y-2 pt-1">
              <Textarea
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                rows={4}
                placeholder={"Paste Plan IDs — one per line or comma-separated\n6712ab...\n6713cd..."}
                className="font-mono text-xs"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => addPlans.mutate()}
                  disabled={addPlans.isPending || savePlanIds.isPending || !addText.trim()}
                  className="bg-violet-600 gap-2"
                >
                  {addPlans.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Add to list
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (window.confirm("Replace the entire saved Plan ID list with what you pasted? Plans not in your list (and their resolved cp_ids) will be removed.")) {
                      savePlanIds.mutate();
                    }
                  }}
                  disabled={addPlans.isPending || savePlanIds.isPending}
                  className="gap-2"
                >
                  {savePlanIds.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save list (replace all)
                </Button>
                <Button variant="ghost" onClick={() => { setAddText(""); setAddOpen(false); }}>Cancel</Button>
              </div>
              <p className="text-xs text-gray-400">
                <strong>Add to list</strong> appends new Plan IDs and keeps everything else. <strong>Save list (replace all)</strong> overwrites the whole list with exactly what you paste.
              </p>
            </CollapsibleContent>
          </Collapsible>

          {plans.length > 0 ? (
            <div className="space-y-2">
              {plans.map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  planRun={planRunsByPlan.get(plan.planId)}
                  sampleLimit={sampleLimit}
                  cpPageSize={CP_PAGE_SIZE}
                  onSyncCp={(cpId, planId, mode) => { setSyncingCp(`${planId}:${cpId}`); syncCp.mutate({ cpId, planId, mode }); }}
                  syncingCp={syncingCp}
                  syncCpPending={syncCp.isPending}
                  onSyncPlan={(planId, mode) => { setSyncingPlan(planId); syncPlan.mutate({ planId, mode }); }}
                  syncingPlan={syncingPlan}
                  syncPlanPending={syncPlan.isPending}
                  onCancelPlanRun={(runId) => cancelPlanRun.mutate(runId)}
                  cancelPlanRunPending={cancelPlanRun.isPending}
                  onRetryPlanRun={(runId) => retryPlanRun.mutate(runId)}
                  retryPlanRunPending={retryPlanRun.isPending}
                  onResolvePlan={(planId) => { setResolvingPlan(planId); resolve.mutate({ planIds: [planId] }); }}
                  resolvingPlan={resolvingPlan}
                  resolvePending={resolve.isPending}
                  onRemovePlan={(planId) => setConfirmDeletePlanId(planId)}
                  removingPlan={removingPlan}
                  removePending={removePlan.isPending}
                />
              ))}
              <Pager page={planPage} pageSize={PLAN_PAGE_SIZE} total={planTotal} onPage={setPlanPage} />
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              {debouncedPlanSearch
                ? `No ${planEmbeddingFilter} Plan IDs match your search.`
                : planEmbeddingFilter === "completed"
                  ? "No Plans have fully completed embeddings yet."
                  : planEmbeddingFilter === "pending"
                    ? "No Plans are waiting for embeddings."
                    : "No Plan IDs yet. Use \u201cAdd plans\u201d to get started."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Content sync status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-violet-600" /> Content Sync Status
          </CardTitle>
          <CardDescription>Live status of every cp_id sync, grouped by plan. Start syncs from the Plan IDs panel above; expand a plan to see rows and cancel an in-progress run.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full">
            <TabsList className="h-auto w-full justify-start overflow-x-auto bg-violet-50/80 p-1">
              <TabsTrigger value="all" className="shrink-0 gap-1.5 text-xs">
                All <span className="text-muted-foreground">({summary?.overall.total ?? 0})</span>
              </TabsTrigger>
              <TabsTrigger value="syncing" className="shrink-0 gap-1.5 text-xs">
                Syncing <span className="text-muted-foreground">({summary?.overall.syncing ?? 0})</span>
              </TabsTrigger>
              <TabsTrigger value="completed" className="shrink-0 gap-1.5 text-xs">
                Completed <span className="text-muted-foreground">({summary?.overall.completed ?? 0})</span>
              </TabsTrigger>
              <TabsTrigger value="failed" className="shrink-0 gap-1.5 text-xs">
                Failed <span className="text-muted-foreground">({summary?.overall.failed ?? 0})</span>
              </TabsTrigger>
              <TabsTrigger value="cancelled" className="shrink-0 gap-1.5 text-xs">
                Cancelled <span className="text-muted-foreground">({summary?.overall.cancelled ?? 0})</span>
              </TabsTrigger>
              <TabsTrigger value="idle" className="shrink-0 gap-1.5 text-xs">
                Idle <span className="text-muted-foreground">({summary?.overall.idle ?? 0})</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={statusSearch}
                onChange={(e) => setStatusSearch(e.target.value)}
                placeholder="Search cp_id…"
                className="h-9 pl-8"
              />
            </div>
          </div>

          {filteredBuckets.length > 0 ? (
            <div className="space-y-2">
              {pagedBuckets.map((bucket) => (
                <StatusPlanRow
                  key={bucket.key}
                  planKey={bucket.key}
                  label={bucket.label}
                  counts={bucket.counts}
                  statusFilter={statusFilter}
                  search={debouncedStatusSearch}
                  pageSize={STATUS_PAGE_SIZE}
                  onCancel={(cpId) => { setCancelingCpId(cpId); cancelMutation.mutate(cpId); }}
                  cancelingCpId={cancelingCpId}
                  cancelPending={cancelMutation.isPending}
                />
              ))}
              <Pager page={statusPlanPage} pageSize={STATUS_PLAN_PAGE_SIZE} total={filteredBuckets.length} onPage={setStatusPlanPage} />
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              {statusFilter === "all" ? "No syncs yet. Resolve a Plan ID above, then sync a cp_id." : "No syncs match this filter."}
            </p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmDeletePlanId} onOpenChange={(open) => { if (!open) setConfirmDeletePlanId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <span className="font-mono text-xs break-all">{confirmDeletePlanId}</span> from
              the list and delete all extracted/embedded content for every cp_id under it. The chatbot will stop using
              it immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                if (confirmDeletePlanId) {
                  setRemovingPlan(confirmDeletePlanId);
                  removePlan.mutate(confirmDeletePlanId);
                  setConfirmDeletePlanId(null);
                }
              }}
            >
              Delete plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmBulkPlanSync} onOpenChange={(open) => { if (!open && !bulkPlanSync.isPending) setConfirmBulkPlanSync(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmBulkPlanSync === "pending" ? "Sync all pending Plans?" : "Sync all Plans?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will resolve the latest cp_ids and queue a full embedding sync for{" "}
              <strong>{confirmBulkPlanSync === "pending" ? planCounts.pending : planCounts.all}</strong>{" "}
              {confirmBulkPlanSync === "pending" ? "pending Plan ID(s)." : "saved Plan ID(s)."}{" "}
              The work runs safely in the background with one protected queue, so you can keep using this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkPlanSync.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={bulkPlanSync.isPending}
              onClick={() => {
                if (confirmBulkPlanSync) bulkPlanSync.mutate(confirmBulkPlanSync);
              }}
            >
              {bulkPlanSync.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start full sync
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface PlanRowProps {
  plan: PlanIdRow;
  planRun?: PlanRun;
  sampleLimit: number;
  cpPageSize: number;
  onSyncCp: (cpId: string, planId: string, mode: "sample" | "full") => void;
  syncingCp: string | null;
  syncCpPending: boolean;
  onSyncPlan: (planId: string, mode: "sample" | "full") => void;
  syncingPlan: string | null;
  syncPlanPending: boolean;
  onCancelPlanRun: (runId: string) => void;
  cancelPlanRunPending: boolean;
  onRetryPlanRun: (runId: string) => void;
  retryPlanRunPending: boolean;
  onResolvePlan: (planId: string) => void;
  resolvingPlan: string | null;
  resolvePending: boolean;
  onRemovePlan: (planId: string) => void;
  removingPlan: string | null;
  removePending: boolean;
}

// One plan in the master list. Collapsed by default; expanding lazy-loads (and
// paginates/searches) its resolved cp_ids so we never mount thousands of rows.
function PlanRow(props: PlanRowProps) {
  const {
    plan, planRun, sampleLimit, cpPageSize, onSyncCp, syncingCp, syncCpPending,
    onSyncPlan, syncingPlan, syncPlanPending, onCancelPlanRun, cancelPlanRunPending,
    onRetryPlanRun, retryPlanRunPending, onResolvePlan, resolvingPlan, resolvePending,
    onRemovePlan, removingPlan, removePending,
  } = props;
  const [open, setOpen] = useState(false);
  const [cpSearch, setCpSearch] = useState("");
  const debouncedCpSearch = useDebounced(cpSearch);
  const [cpPage, setCpPage] = useState(0);
  useEffect(() => { setCpPage(0); }, [debouncedCpSearch]);

  const { data, isLoading } = useQuery<Paged<ResolutionRow>>({
    queryKey: ["/api/topscholar/resolutions", plan.planId, { q: debouncedCpSearch, page: cpPage }],
    queryFn: () => getJson(buildUrl("/api/topscholar/resolutions", { planId: plan.planId, q: debouncedCpSearch, limit: cpPageSize, offset: cpPage * cpPageSize })),
    enabled: open,
  });
  const cps = data?.rows ?? [];
  const cpTotal = data?.total ?? 0;

  const planSyncing = syncPlanPending && syncingPlan === plan.planId;
  const planResolving = resolvePending && resolvingPlan === plan.planId;
  const planRemoving = removePending && removingPlan === plan.planId;
  const planRunActive = !!planRun && ["queued", "resolving", "running"].includes(planRun.status);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 bg-violet-50/60 px-3 py-2">
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <CollapsibleTrigger className="flex items-center gap-2 text-left min-w-0">
            <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${open ? "rotate-90" : ""}`} />
            <span className="font-mono text-xs text-gray-700 truncate">{plan.planId}</span>
            <span className={`px-2 py-0.5 rounded-full text-[11px] shrink-0 ${statusColor(planRun?.status || plan.lastStatus)}`}>{planRun?.status || plan.lastStatus}</span>
            <span className="text-gray-400 text-xs shrink-0">{plan.resolvedCpCount} cp_id(s)</span>
          </CollapsibleTrigger>
          <div className="pl-6">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-violet-700 hover:bg-violet-100"
              onClick={() => onResolvePlan(plan.planId)}
              disabled={planResolving}
            >
              {planResolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
              Resolve
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-violet-700 hover:bg-violet-100"
            onClick={() => onSyncPlan(plan.planId, "sample")}
              disabled={planSyncing || planRunActive}
          >
            {planSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync all (sample)
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 bg-violet-600"
            onClick={() => onSyncPlan(plan.planId, "full")}
              disabled={planSyncing || planRunActive}
          >
            {planSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync all (full)
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={() => onRemovePlan(plan.planId)}
            disabled={planRemoving}
            title="Delete plan and all its content"
            aria-label="Delete plan and all its content"
            data-testid={`remove-plan-${plan.planId}`}
          >
            {planRemoving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </Button>
        </div>
        {planRun && (
          <div className="w-full border-t border-violet-100 pt-2 text-xs text-gray-600 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 ${statusColor(planRun.status)}`}>
                {planRun.status === "resolving" ? "resolving cp_ids" : planRun.status}
              </span>
              <span>{planRun.completedCpIds}/{planRun.totalCpIds} cp_id(s) complete</span>
              {planRun.failedCpIds > 0 && <span className="text-red-600">{planRun.failedCpIds} failed</span>}
              {planRun.activeCpId && <span className="font-mono text-gray-500">Current: {planRun.activeCpId}</span>}
              {planRunActive && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-amber-700 hover:bg-amber-50"
                  onClick={() => onCancelPlanRun(planRun.id)}
                  disabled={cancelPlanRunPending}
                >
                  Cancel remaining
                </Button>
              )}
              {planRun.status === "failed" && planRun.failedCpIds > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-violet-700 hover:bg-violet-100"
                  onClick={() => onRetryPlanRun(planRun.id)}
                  disabled={retryPlanRunPending}
                >
                  Retry failed
                </Button>
              )}
            </div>
            {planRun.error && <p className="text-red-600 break-words">{planRun.error}</p>}
          </div>
        )}
      </div>
      <CollapsibleContent>
        <div className="border-t p-2 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input
              value={cpSearch}
              onChange={(e) => setCpSearch(e.target.value)}
              placeholder="Search cp_id / curriculum…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-4 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
          ) : cps.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">
              {debouncedCpSearch ? "No cp_ids match." : "No resolved cp_ids yet. Click Resolve above."}
            </p>
          ) : (
            <>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left p-2">cp_id / curriculum</th>
                    <th className="text-left p-2">Content (notes / videos / questions / pdfs)</th>
                    <th className="text-right p-2">Sync this cp_id</th>
                  </tr>
                </thead>
                <tbody>
                  {cps.map((cp) => {
                    const cpKey = `${plan.planId}:${cp.cpId}`;
                    const cpSyncing = syncCpPending && syncingCp === cpKey;
                    return (
                      <tr key={cp.id} className="border-t">
                        <td className="p-2">
                          <div className="text-gray-700">{composeCurriculumLabel(cp) || <span className="text-gray-400">—</span>}</div>
                          <div className="font-mono text-gray-400">{cp.cpId}</div>
                        </td>
                        <td className="p-2 text-gray-600">
                          {cp.noteCount}n / {cp.transcriptCount}t / {cp.questionCount}q / {cp.pdfCount}p
                        </td>
                        <td className="p-2">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-violet-700 hover:bg-violet-100"
                              onClick={() => onSyncCp(cp.cpId, plan.planId, "sample")}
                              disabled={cpSyncing}
                            >
                              {cpSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                              Sample
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 gap-1 bg-violet-600"
                              onClick={() => onSyncCp(cp.cpId, plan.planId, "full")}
                              disabled={cpSyncing}
                            >
                              {cpSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                              Full
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager page={cpPage} pageSize={cpPageSize} total={cpTotal} onPage={setCpPage} />
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface StatusPlanRowProps {
  planKey: string;
  label: string | null;
  counts: Counts;
  statusFilter: string;
  search: string;
  pageSize: number;
  onCancel: (cpId: string) => void;
  cancelingCpId: string | null;
  cancelPending: boolean;
}

// One plan bucket in the status section. Collapsed to a counts summary; expanding
// lazy-loads its sync rows (filtered + paginated). Polls only while this plan has
// in-progress work, and refetches whenever its summary counts change.
function StatusPlanRow(props: StatusPlanRowProps) {
  const { planKey, label, counts, statusFilter, search, pageSize, onCancel, cancelingCpId, cancelPending } = props;
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [statusFilter, search]);

  const { data, isLoading, refetch } = useQuery<Paged<SyncRow>>({
    queryKey: ["/api/topscholar/sync", planKey, { status: statusFilter, q: search, page }],
    queryFn: () => getJson(buildUrl("/api/topscholar/sync", {
      planId: planKey,
      status: statusFilter === "all" ? undefined : statusFilter,
      q: search,
      limit: pageSize,
      offset: page * pageSize,
    })),
    enabled: open,
    refetchInterval: open && counts.syncing > 0 ? 5000 : false,
  });

  // When this plan's summary counts shift (e.g. a sync just completed), pull fresh
  // rows so an expanded, no-longer-polling bucket still shows the final state.
  useEffect(() => {
    if (open) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.total, counts.syncing, counts.completed, counts.failed, counts.cancelled]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-lg overflow-hidden">
      <CollapsibleTrigger className="w-full flex flex-wrap items-center justify-between gap-2 bg-violet-50/60 px-3 py-2 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${open ? "rotate-90" : ""}`} />
          {label ? (
            <span className="font-mono text-xs text-gray-700 truncate">{label}</span>
          ) : (
            <span className="font-medium text-gray-500 text-sm">Unresolved / no plan</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          {counts.syncing > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{counts.syncing} syncing</span>}
          {counts.completed > 0 && <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700">{counts.completed} done</span>}
          {counts.failed > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700">{counts.failed} failed</span>}
          {counts.cancelled > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{counts.cancelled} cancelled</span>}
          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{counts.total} total</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4 text-gray-400 border-t"><Loader2 className="w-4 h-4 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-gray-400 p-3 border-t">No rows match.</p>
        ) : (
          <div className="border-t">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left p-2">cp_id / curriculum</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Mode / Store</th>
                  <th className="text-left p-2">Chunks</th>
                  <th className="text-left p-2">Last synced</th>
                  <th className="text-left p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const inProgress = s.status === "syncing" && s.totalCount > 0;
                  const pct = inProgress ? Math.round((s.processedCount / s.totalCount) * 100) : 0;
                  return (
                    <tr key={s.cpId} className="border-t">
                      <td className="p-2">
                        <div className="font-medium text-gray-800">{s.curriculumName || <span className="text-gray-400">Unresolved cp_id</span>}</div>
                        <div className="font-mono text-gray-400 text-[11px]">{s.cpId}</div>
                        {s.planCount > 1 && <div className="text-gray-400">+{s.planCount - 1} more plan(s)</div>}
                      </td>
                      <td className="p-2">
                        <span className={`px-2 py-0.5 rounded-full ${statusColor(s.status)}`}>{s.status}</span>
                        {inProgress && <span className="block text-gray-500 mt-1">{s.processedCount}/{s.totalCount} ({pct}%)</span>}
                        {s.lastError && <span className="block text-red-500 mt-1">{s.lastError}</span>}
                      </td>
                      <td className="p-2">
                        <span className="text-gray-600">{s.syncMode || "—"}</span>
                        <span className="text-gray-400"> / {s.storeType || "pgvector"}</span>
                      </td>
                      <td className="p-2">{s.chunkCount} <span className="text-gray-400">({s.noteCount}n/{s.transcriptCount}t/{s.questionCount}q)</span></td>
                      <td className="p-2">{s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : "—"}</td>
                      <td className="p-2 text-right">
                        {s.status === "syncing" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => onCancel(s.cpId)}
                            disabled={cancelPending && cancelingCpId === s.cpId}
                          >
                            {cancelPending && cancelingCpId === s.cpId
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <X className="w-3.5 h-3.5" />}
                            Cancel
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="p-2"><Pager page={page} pageSize={pageSize} total={total} onPage={setPage} /></div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
