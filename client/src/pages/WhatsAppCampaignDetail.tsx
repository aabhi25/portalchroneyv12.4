import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, X, RotateCcw, Pencil, MessageSquare, Copy, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { interpolatePreview, type Template, type Group } from "@/components/CampaignForm";
import {
  type Recipient,
  RECIPIENT_STATUS_VARIANT,
  RecipientAvatar,
} from "@/components/whatsapp/CampaignConversationsPanel";
import { CampaignOutcomesCard } from "@/components/whatsapp/CampaignOutcomesCard";
import type { ReplyClassification } from "@shared/schema";

const CAMPAIGN_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", scheduled: "secondary", sending: "secondary",
  completed: "default", cancelled: "destructive", failed: "destructive",
};

/** All filterable statuses. "all" fetches paginated; each specific status fetches up to 1 000. */
const STATUS_FILTERS = [
  { key: "all",       label: "All" },
  { key: "pending",   label: "Pending" },
  { key: "queued",    label: "Queued" },
  { key: "sent",      label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "read",      label: "Read" },
  { key: "replied",   label: "Replied" },
  { key: "failed",    label: "Failed" },
  { key: "expired",   label: "Expired" },
  { key: "opted_out", label: "Opted out" },
] as const;

type StatusKey = (typeof STATUS_FILTERS)[number]["key"];

/** Rows per page — applies to every status filter including "all". */
const PAGE_SIZE = 100;

interface Campaign {
  id: string; name: string; status: string;
  templateId: string; templateParams: string[] | null; groupIds: string[] | null;
  totalRecipients: number; sentCount: number; failedCount: number; repliedCount: number; optedOutCount: number;
  scheduledAt: string | null; startedAt: string | null; completedAt: string | null;
  aiEnabled: string; aiAgentName: string;
  aiSystemPrompt: string | null; aiUseFaqs: string; aiUseDocs: string; aiUseProducts: string;
  replyClassifications?: ReplyClassification[] | null;
}
interface RecipientsResponse {
  recipients: Recipient[];
  counts: {
    total: number; pending: number; queued: number; sent: number;
    delivered: number; read: number; failed: number; expired: number;
    replied: number; opted_out: number;
  };
  limit: number;
  offset: number;
}

function ConfigRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 pb-2 last:border-b-0 last:pb-0">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="font-medium text-right break-words min-w-0">{children}</span>
    </div>
  );
}

/** Pick the most informative timestamp for a recipient row. */
function bestTimestamp(r: Recipient): string | null {
  return r.firstReplyAt ?? r.readAt ?? r.deliveredAt ?? r.sentAt ?? null;
}

const NOT_SET = <span className="text-gray-400 font-normal">—</span>;

export default function WhatsAppCampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");
  const [page, setPage] = useState(0);
  // Outcome filter, driven by clicking a row in the outcomes card. Orthogonal to
  // the status tabs — both narrow the same list and both feed the same counts.
  const [classificationFilter, setClassificationFilter] = useState<string | null>(null);

  const changeFilter = (key: StatusKey) => {
    setStatusFilter(key);
    setPage(0);
  };

  const changeClassification = (key: string | null) => {
    setClassificationFilter(key);
    setPage(0);
  };

  // ── Campaign & static data ─────────────────────────────────────────────────
  const { data: campaign, error: campaignError } = useQuery<Campaign>({
    queryKey: [`/api/whatsapp/campaigns/${id}`],
    refetchInterval: (query) => (query.state.error ? false : 5000),
    refetchOnMount: "always",
  });

  // Counts-only query — no status filter, no pagination.
  // countRecipients on the server always returns totals for every status
  // regardless of what list filter is applied, so this query is the
  // authoritative source for the stat tiles and filter-tab badges.
  // The outcome filter is included here as well as in the list query. Both must
  // narrow by the same thing: filterTotal below is read from these counts and
  // drives pagination over the list, so a mismatch would strand the user on
  // pages that return no rows.
  const classificationParam = classificationFilter
    ? `&classification=${encodeURIComponent(classificationFilter)}`
    : "";

  const { data: countsData } = useQuery<RecipientsResponse>({
    queryKey: [`/api/whatsapp/campaigns/${id}/recipients`, "counts", classificationFilter],
    queryFn: () =>
      apiRequest<RecipientsResponse>("GET", `/api/whatsapp/campaigns/${id}/recipients?limit=1${classificationParam}`),
    enabled: !campaignError,
    refetchInterval: (query) => (query.state.error ? false : 5000),
    refetchOnMount: "always",
  });

  // Filtered list query — paginated consistently for every filter tab.
  // The same PAGE_SIZE / offset model applies whether "all" or a specific
  // status is selected, ensuring every recipient is reachable regardless of
  // how many rows a status bucket contains.
  const listParams =
    (statusFilter === "all"
      ? `?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
      : `?status=${statusFilter}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`) + classificationParam;

  const { data: listData, isLoading: listLoading } = useQuery<RecipientsResponse>({
    queryKey: [`/api/whatsapp/campaigns/${id}/recipients`, "list", statusFilter, page, classificationFilter],
    queryFn: () =>
      apiRequest<RecipientsResponse>("GET", `/api/whatsapp/campaigns/${id}/recipients${listParams}`),
    enabled: !campaignError,
    refetchInterval: (query) => (query.state.error ? false : 5000),
    refetchOnMount: "always",
    placeholderData: (prev) => prev,  // keep old rows visible while new page loads
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["/api/whatsapp/templates"],
    enabled: !campaignError,
  });
  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["/api/whatsapp/contact-groups"],
    enabled: !campaignError,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  // Invalidate both the counts query and all list pages.
  const invalidateRecipients = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}/recipients`] });
  };

  const sendMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/whatsapp/campaigns/${id}/send`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}`] });
      invalidateRecipients();
      toast({ title: "Send started" });
    },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/whatsapp/campaigns/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}`] });
      toast({ title: "Cancelled" });
    },
  });

  const resendAllMutation = useMutation({
    mutationFn: async () => apiRequest<{ requeued: number }>("POST", `/api/whatsapp/campaigns/${id}/resend-failed`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}`] });
      invalidateRecipients();
      toast({ title: data?.requeued > 0 ? `Resending ${data.requeued} recipients` : "Nothing to resend" });
    },
    onError: (e: any) => toast({ title: "Resend failed", description: e.message, variant: "destructive" }),
  });

  const resendOneMutation = useMutation({
    mutationFn: async (recipientId: string) =>
      apiRequest<{ requeued: number }>("POST", `/api/whatsapp/campaigns/${id}/recipients/${recipientId}/resend`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}`] });
      invalidateRecipients();
      toast({ title: data?.requeued > 0 ? "Recipient queued for resend" : "Nothing to resend" });
    },
    onError: (e: any) => toast({ title: "Resend failed", description: e.message, variant: "destructive" }),
  });

  // ── Derived values ─────────────────────────────────────────────────────────
  const counts = countsData?.counts;
  const failedCount = (counts?.failed ?? 0) + (counts?.expired ?? 0);
  const displayedRecipients = listData?.recipients ?? [];
  // Total rows for the active filter — used for pagination across all tabs.
  const filterTotal =
    statusFilter === "all"
      ? (counts?.total ?? 0)
      : (counts?.[statusFilter as keyof typeof counts] as number | undefined) ?? 0;
  const totalPages = Math.max(1, Math.ceil(filterTotal / PAGE_SIZE));
  const hasMore = (page + 1) * PAGE_SIZE < filterTotal;

  // Clamp the page whenever filterTotal shrinks under us. Recipients change
  // status while this view polls, and an outcome filter can empty out a page
  // the user is already sitting on — without this the footer advertises a range
  // that no longer exists and the table renders blank.
  useEffect(() => {
    const maxPage = Math.max(0, totalPages - 1);
    if (page > maxPage) setPage(maxPage);
  }, [filterTotal, totalPages, page]);

  // Label lookups built from the campaign's own config, so badges read as the
  // operator named them rather than as raw keys.
  const campaignClassifications = Array.isArray(campaign?.replyClassifications)
    ? campaign!.replyClassifications!
    : [];
  const classificationLabels = Object.fromEntries(
    campaignClassifications.map(c => [c.key, c.label || c.key])
  );
  const captureFieldLabels = Object.fromEntries(
    campaignClassifications.flatMap(c => (c.captureFields || []).map(f => [f.fieldKey, f.fieldLabel || f.fieldKey]))
  );
  const isLive = campaign?.status === "sending" || campaign?.status === "completed";

  const canEditConfig = campaign?.status === "draft" || campaign?.status === "scheduled";
  const template = templates.find(t => t.id === campaign?.templateId);
  const templateParams: string[] = campaign && Array.isArray(campaign.templateParams) ? campaign.templateParams : [];
  const targetGroups = campaign && Array.isArray(campaign.groupIds)
    ? campaign.groupIds.map(gid => groups.find(g => g.id === gid) ?? { id: gid, name: gid, contactCount: 0 })
    : [];
  const knowledgeSources = [
    campaign?.aiUseFaqs !== "false" && "FAQs",
    campaign?.aiUseDocs !== "false" && "Training docs",
    campaign?.aiUseProducts !== "false" && "Products",
  ].filter(Boolean).join(", ");

  // ── Error / loading states ─────────────────────────────────────────────────
  if (campaignError) {
    const notFound = (campaignError as Error & { status?: number }).status === 404;
    return (
      <div className="p-6 max-w-2xl mx-auto" data-testid="campaign-error-state">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => setLocation("/admin/whatsapp-campaigns")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">
              {notFound ? "Campaign not found" : "Couldn't load this campaign"}
            </h2>
            <p className="text-sm text-gray-600">
              {notFound
                ? "It may have been deleted, or it belongs to a different business account."
                : campaignError.message || "Something went wrong while loading this campaign."}
            </p>
            <Button onClick={() => setLocation("/admin/whatsapp-campaigns")} data-testid="button-back-to-campaigns">
              Back to campaigns
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!campaign) return <div className="p-6">Loading...</div>;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => setLocation("/admin/whatsapp-campaigns")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {campaign.name}
            <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status] || "outline"}>{campaign.status}</Badge>
          </h1>
          <div className="text-xs text-gray-500 mt-1">
            {campaign.scheduledAt && <>Scheduled: {new Date(campaign.scheduledAt).toLocaleString()} · </>}
            {campaign.startedAt && <>Started: {new Date(campaign.startedAt).toLocaleString()} · </>}
            {campaign.completedAt && <>Completed: {new Date(campaign.completedAt).toLocaleString()}</>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setLocation(`/admin/whatsapp-campaigns/new?from=${campaign.id}`)}
            data-testid="button-duplicate-campaign"
          >
            <Copy className="h-4 w-4 mr-1" /> Duplicate
          </Button>
          {canEditConfig && (
            <Button
              variant="outline"
              onClick={() => setLocation(`/admin/whatsapp-campaigns/${campaign.id}/edit`)}
              data-testid="button-edit-campaign"
            >
              <Pencil className="h-4 w-4 mr-1" /> Edit
            </Button>
          )}
          {(campaign.status === "draft" || campaign.status === "scheduled") && (
            <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
              <Send className="h-4 w-4 mr-1" /> Send Now
            </Button>
          )}
          {campaign.status === "sending" && (
            <Button variant="outline" onClick={() => cancelMutation.mutate()}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
          )}
          {failedCount > 0 && campaign.status !== "cancelled" && (
            <Button
              variant="outline"
              onClick={() => resendAllMutation.mutate()}
              disabled={resendAllMutation.isPending}
              data-testid="button-resend-failed"
            >
              <RotateCcw className="h-4 w-4 mr-1" /> Resend failed ({failedCount})
            </Button>
          )}
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-7 gap-3 mb-6">
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500">Recipients</div><div className="text-2xl font-bold">{campaign.totalRecipients}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500" title="Provider accepted but Meta has not yet confirmed">Queued</div><div className="text-2xl font-bold text-slate-600" data-testid="counter-queued">{counts?.queued ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500" title="Accepted by Meta, awaiting delivery confirmation">Sent</div><div className="text-2xl font-bold text-emerald-600" data-testid="counter-sent">{((counts?.sent ?? 0) + (counts?.delivered ?? 0) + (counts?.read ?? 0) + (counts?.replied ?? 0)) || campaign.sentCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500" title="Confirmed delivered to recipient's device">Delivered</div><div className="text-2xl font-bold text-teal-600" data-testid="counter-delivered">{(counts?.delivered ?? 0) + (counts?.read ?? 0) + (counts?.replied ?? 0)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500">Replied</div><div className="text-2xl font-bold text-blue-600" data-testid="counter-replied">{counts?.replied ?? campaign.repliedCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500" title="Includes provider-reported failures and queued rows that timed out">Failed</div><div className="text-2xl font-bold text-red-600" data-testid="counter-failed">{failedCount || campaign.failedCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500">Opted out</div><div className="text-2xl font-bold text-amber-600" data-testid="counter-opted-out">{counts?.opted_out ?? campaign.optedOutCount}</div></CardContent></Card>
      </div>

      {/* Reply outcomes — categories come from this campaign's own config */}
      <div className="mb-6">
        <CampaignOutcomesCard
          campaignId={id!}
          isLive={isLive}
          activeClassification={classificationFilter}
          onSelectClassification={changeClassification}
        />
      </div>

      {/* Config + preview */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 mb-6" data-testid="campaign-config">
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base">Configuration</CardTitle>
            {!canEditConfig && (
              <span className="text-xs text-gray-500">
                Locked &mdash; recipients were fixed when the send started
              </span>
            )}
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ConfigRow label="Template">
              {template
                ? <span className="font-mono">{template.name}</span>
                : campaign.templateId
                  ? <span className="font-mono text-gray-500">{campaign.templateId}</span>
                  : NOT_SET}
            </ConfigRow>
            <ConfigRow label="Contact groups">
              {targetGroups.length === 0 ? NOT_SET : (
                <span className="flex flex-wrap gap-1 justify-end">
                  {targetGroups.map(g => (
                    <Badge key={g.id} variant="outline" className="font-normal" data-testid={`config-group-${g.id}`}>
                      {g.name}{g.contactCount ? ` · ${g.contactCount}` : ""}
                    </Badge>
                  ))}
                </span>
              )}
            </ConfigRow>
            {templateParams.length > 0 && (
              <ConfigRow label="Parameters">
                <span className="flex flex-col items-end gap-0.5">
                  {templateParams.map((p, i) => (
                    <span key={i} className="font-mono text-xs">
                      <span className="text-gray-400">{`{{${i + 1}}}`} → </span>
                      {p || <span className="text-gray-400">empty</span>}
                    </span>
                  ))}
                </span>
              </ConfigRow>
            )}
            <ConfigRow label="Schedule">
              {campaign.scheduledAt
                ? new Date(campaign.scheduledAt).toLocaleString()
                : <span className="text-gray-500 font-normal">Send manually</span>}
            </ConfigRow>
            <ConfigRow label="AI replies">
              {campaign.aiEnabled === "false"
                ? <span className="text-gray-500 font-normal">Off</span>
                : <span className="text-indigo-700">On · {campaign.aiAgentName || "Sales Agent"}</span>}
            </ConfigRow>
            {campaign.aiEnabled !== "false" && (
              <ConfigRow label="Knowledge sources">
                {knowledgeSources || <span className="text-gray-500 font-normal">None</span>}
              </ConfigRow>
            )}
            {campaign.aiEnabled !== "false" && campaign.aiSystemPrompt ? (
              <div className="pt-1">
                <div className="text-gray-500 mb-1">Persona / instructions</div>
                <p className="text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap text-gray-700" data-testid="config-ai-prompt">
                  {campaign.aiSystemPrompt}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="bg-emerald-600 py-3 px-4">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Message preview
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 bg-[#e5ddd5] min-h-[140px]">
            {template ? (
              <div className="bg-white rounded-lg rounded-tl-none shadow-sm p-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {interpolatePreview(template.bodyText, templateParams)}
              </div>
            ) : (
              <div className="flex items-center justify-center h-24 text-center text-gray-500 text-sm">
                Template unavailable
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recipients table */}
      <Card data-testid="recipients-table">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-500" />
              Recipients
              {counts && (
                <span className="text-sm font-normal text-gray-500">
                  ({counts.total} total)
                </span>
              )}
            </CardTitle>
            {/* Pagination controls — only shown in "all" tab */}
            {statusFilter === "all" && totalPages > 1 && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>Page {page + 1} / {totalPages}</span>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={!hasMore}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Status filter pills */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {STATUS_FILTERS.map(f => {
              // Resolve count for badge display
              const count: number =
                f.key === "all"
                  ? (counts?.total ?? 0)
                  : (counts?.[f.key as keyof typeof counts] as number | undefined) ?? 0;
              const isActive = statusFilter === f.key;
              // Hide zero-count statuses (except "all") to keep the pill row lean
              if (f.key !== "all" && count === 0) return null;
              return (
                <button
                  key={f.key}
                  onClick={() => changeFilter(f.key)}
                  data-testid={`filter-${f.key}`}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    isActive
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {f.label}
                  {count > 0 && (
                    <span className={`text-[10px] font-semibold ${isActive ? "text-white/80" : "text-gray-400"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {listLoading && displayedRecipients.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">Loading recipients…</div>
          ) : displayedRecipients.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">
              {(counts?.total ?? 0) === 0
                ? "No recipients yet — they're snapshotted when the send starts."
                : `No recipients with status "${statusFilter}".`}
            </div>
          ) : (
            <div className="divide-y max-h-[520px] overflow-y-auto">
              {displayedRecipients.map(r => {
                const canResend = r.status === "failed" || r.status === "expired";
                const ts = bestTimestamp(r);
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                    data-testid={`recipient-row-${r.id}`}
                  >
                    <RecipientAvatar r={r} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{r.name || r.phone}</div>
                      {r.name && <div className="text-xs text-gray-400">{r.phone}</div>}
                      {r.errorMessage && (
                        <div className="text-xs text-red-500 mt-0.5 line-clamp-1" title={r.errorMessage}>
                          {r.errorMessage}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {ts && (
                        <span className="text-xs text-gray-400 hidden sm:block">
                          {new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                      {r.replyCount > 0 && (
                        <span className="bg-emerald-600 text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                          {r.replyCount}
                        </span>
                      )}
                      <Badge
                        variant={RECIPIENT_STATUS_VARIANT[r.status] || "outline"}
                        className="text-xs"
                        data-testid={`status-${r.id}`}
                      >
                        {r.status}
                      </Badge>
                      {canResend && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-gray-500 hover:text-gray-800"
                          onClick={() => resendOneMutation.mutate(r.id)}
                          disabled={resendOneMutation.isPending}
                          data-testid={`button-resend-${r.id}`}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" /> Resend
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Unified footer — consistent range + pagination for every filter tab */}
          {displayedRecipients.length > 0 && filterTotal > 0 && (
            <div className="px-4 py-2.5 border-t bg-gray-50 text-xs text-gray-500 flex justify-between items-center">
              <span>
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filterTotal)} of {filterTotal}{" "}
                {statusFilter === "all" ? "recipients" : `${statusFilter} recipients`}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="h-6 w-6 p-0"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <span className="px-1">Page {page + 1} / {totalPages}</span>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={!hasMore}
                    className="h-6 w-6 p-0"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
