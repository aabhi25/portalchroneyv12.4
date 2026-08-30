import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, X, RotateCcw, Pencil, MessageSquare, Copy, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { interpolatePreview, type Template, type Group } from "@/components/CampaignForm";
import {
  type Recipient,
  type CampaignMessage,
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
  campaignType?: "one_time" | "automation";
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

const NOT_SET = <span className="text-gray-400 font-normal">—</span>;

export default function WhatsAppCampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");
  const [page, setPage] = useState(0);
  // Outcome filter, driven by the table dropdown or by clicking a row in the
  // outcomes summary. It narrows the same list as the status dropdown.
  const [classificationFilter, setClassificationFilter] = useState<string | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);

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
  // authoritative source for the stat tiles and table filter options.
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

  const { data: selectedRecipientMessages = [], isLoading: messagesLoading } = useQuery<CampaignMessage[]>({
    queryKey: [`/api/whatsapp/campaigns/${id}/recipients/${selectedRecipient?.id}/messages`],
    enabled: Boolean(selectedRecipient),
    refetchInterval: selectedRecipient ? 5000 : false,
    refetchOnMount: "always",
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
  const activeClassificationLabel = classificationFilter
    ? classificationFilter === "__unclassified__"
      ? "Unclassified"
      : classificationLabels[classificationFilter] || classificationFilter
    : null;
  const activeStatusLabel = STATUS_FILTERS.find((filter) => filter.key === statusFilter)?.label || "All";
  const hasActiveTableFilter = Boolean(classificationFilter) || statusFilter !== "all";

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
            <Badge variant="outline">{campaign.campaignType === "automation" ? "Automation campaign" : "One-time"}</Badge>
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
          {campaign.campaignType === "automation" && campaign.status === "draft" ? (
            <Button onClick={() => setLocation(`/admin/whatsapp-campaign-automations/new?campaign=${campaign.id}`)}>
              Set up automation
            </Button>
          ) : (campaign.status === "draft" || campaign.status === "scheduled") && (
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
              {campaign.campaignType === "automation"
                ? <span className="text-violet-700 font-normal">Selected in Automations</span>
                : targetGroups.length === 0 ? NOT_SET : (
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
              {campaign.campaignType === "automation"
                ? <span className="text-violet-700 font-normal">Recurring timing is set in Automations</span>
                : campaign.scheduledAt
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
                  ({filterTotal}{hasActiveTableFilter ? " matching" : " total"})
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

          {/* Filters stay with the table they control. The outcomes card above
              remains a summary, while these dropdowns are the authoritative
              controls for the rows below. */}
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-xs font-medium text-gray-500 shrink-0">Filter rows by</span>
            <Select
              value={classificationFilter || "all"}
              onValueChange={(value) => changeClassification(value === "all" ? null : value)}
            >
              <SelectTrigger className="h-9 w-full sm:w-56 text-sm" data-testid="select-recipient-outcome">
                <SelectValue placeholder="All outcomes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                {campaignClassifications.map((classification) => (
                  <SelectItem key={classification.key} value={classification.key}>
                    {classification.label || classification.key}
                  </SelectItem>
                ))}
                <SelectItem value="__unclassified__">Unclassified</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={(value) => changeFilter(value as StatusKey)}>
              <SelectTrigger className="h-9 w-full sm:w-48 text-sm" data-testid="select-recipient-status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((filter) => (
                  <SelectItem key={filter.key} value={filter.key}>
                    {filter.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasActiveTableFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-xs text-gray-500"
                onClick={() => {
                  changeClassification(null);
                  changeFilter("all");
                }}
                data-testid="button-clear-recipient-filters"
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {listLoading && displayedRecipients.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">Loading recipients…</div>
          ) : displayedRecipients.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">
              {(counts?.total ?? 0) === 0
                ? "No recipients yet — they're snapshotted when the send starts."
                : activeClassificationLabel
                  ? `No recipients in "${activeClassificationLabel}"${statusFilter !== "all" ? ` with status "${activeStatusLabel}"` : ""}.`
                  : statusFilter !== "all"
                    ? `No recipients with status "${activeStatusLabel}".`
                    : "No recipients match the selected filters."}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full min-w-[980px] text-sm" data-testid="recipient-replies-table">
                <thead className="sticky top-0 z-10 bg-gray-50 border-b">
                  <tr className="text-left text-xs font-medium text-gray-500">
                    <th className="px-4 py-3 w-[190px]">Recipient</th>
                    <th className="px-4 py-3 w-[145px]">Mobile</th>
                    <th className="px-4 py-3 w-[150px]">Outcome</th>
                    <th className="px-4 py-3 min-w-[260px]">What they said</th>
                    <th className="px-4 py-3 min-w-[180px]">Captured details</th>
                    <th className="px-4 py-3 w-[150px]">Reply time</th>
                    <th className="px-4 py-3 w-[130px]">Status</th>
                    <th className="px-4 py-3 w-[135px] text-right">Conversation</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {displayedRecipients.map(r => {
                    const canResend = r.status === "failed" || r.status === "expired";
                    const ts = r.firstReplyAt;
                    const outcome = r.primaryClassification
                      ? classificationLabels[r.primaryClassification] || r.primaryClassification
                      : r.firstReplyAt
                        ? "Unclassified"
                        : null;
                    const capturedDetails = Object.entries(r.dispositionData || {});

                    return (
                      <tr
                        key={r.id}
                        className="align-top hover:bg-gray-50 transition-colors"
                        data-testid={`recipient-row-${r.id}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <RecipientAvatar r={r} />
                            <span className="font-medium text-gray-900 truncate" title={r.name || "No name"}>
                              {r.name || "Unnamed recipient"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">
                          {r.phone || "—"}
                        </td>
                        <td className="px-4 py-3">
                          {outcome ? (
                            <Badge
                              variant="outline"
                              className="bg-violet-50 text-violet-700 border-violet-200 whitespace-nowrap"
                              data-testid={`badge-outcome-${r.id}`}
                            >
                              {outcome}
                            </Badge>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-[340px]">
                          {r.customerFeedback ? (
                            <p className="text-gray-700 line-clamp-3" title={r.customerFeedback}>
                              {r.customerFeedback}
                            </p>
                          ) : r.firstReplyAt ? (
                            <span className="text-gray-400 italic">Reply text not captured</span>
                          ) : (
                            <span className="text-gray-400">No reply yet</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {capturedDetails.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {capturedDetails.map(([key, value]) => (
                                <Badge
                                  key={key}
                                  variant="outline"
                                  className="bg-gray-50 text-gray-600 border-gray-200 font-normal whitespace-normal text-left"
                                  title={`${captureFieldLabels[key] || key}: ${value}`}
                                >
                                  {captureFieldLabels[key] || key.replace(/_/g, " ")}: {value}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {ts
                            ? new Date(ts).toLocaleString([], {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={RECIPIENT_STATUS_VARIANT[r.status] || "outline"}
                            className="text-xs whitespace-nowrap"
                            data-testid={`status-${r.id}`}
                          >
                            {r.status}
                          </Badge>
                          {r.replyCount > 0 && (
                            <div className="text-[11px] text-gray-400 mt-1">
                              {r.replyCount} {r.replyCount === 1 ? "reply" : "replies"}
                            </div>
                          )}
                          {r.errorMessage && (
                            <div className="text-[11px] text-red-500 mt-1 line-clamp-2" title={r.errorMessage}>
                              {r.errorMessage}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setSelectedRecipient(r)}
                              data-testid={`button-view-conversation-${r.id}`}
                            >
                              <MessageSquare className="h-3 w-3 mr-1" /> View
                            </Button>
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Unified footer — consistent range + pagination for every filter tab */}
          {displayedRecipients.length > 0 && filterTotal > 0 && (
            <div className="px-4 py-2.5 border-t bg-gray-50 text-xs text-gray-500 flex justify-between items-center">
              <span>
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filterTotal)} of {filterTotal}{" "}
                {hasActiveTableFilter ? "matching recipients" : "recipients"}
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

      <Dialog
        open={Boolean(selectedRecipient)}
        onOpenChange={(open) => {
          if (!open) setSelectedRecipient(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          {selectedRecipient && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-6">
                  <RecipientAvatar r={selectedRecipient} />
                  <span className="truncate">{selectedRecipient.name || "Unnamed recipient"}</span>
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs">{selectedRecipient.phone}</span>
                  {selectedRecipient.primaryClassification && (
                    <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">
                      {classificationLabels[selectedRecipient.primaryClassification] || selectedRecipient.primaryClassification}
                    </Badge>
                  )}
                  {selectedRecipient.callbackRequired && (
                    <span className="text-amber-700">Callback requested</span>
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="rounded-md border bg-gray-50 p-2">
                  <div className="text-gray-500">Status</div>
                  <Badge
                    variant={RECIPIENT_STATUS_VARIANT[selectedRecipient.status] || "outline"}
                    className="mt-1 text-[11px]"
                  >
                    {selectedRecipient.status}
                  </Badge>
                </div>
                <div className="rounded-md border bg-gray-50 p-2">
                  <div className="text-gray-500">Replies</div>
                  <div className="font-semibold mt-1">{selectedRecipient.replyCount}</div>
                </div>
                <div className="rounded-md border bg-gray-50 p-2">
                  <div className="text-gray-500">First reply</div>
                  <div className="font-medium mt-1">
                    {selectedRecipient.firstReplyAt
                      ? new Date(selectedRecipient.firstReplyAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </div>
                </div>
                <div className="rounded-md border bg-gray-50 p-2">
                  <div className="text-gray-500">Captured details</div>
                  <div className="font-semibold mt-1">{Object.keys(selectedRecipient.dispositionData || {}).length}</div>
                </div>
              </div>

              {selectedRecipient.customerFeedback && (
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                  <div className="text-xs font-medium text-emerald-800 mb-1">Customer reply</div>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{selectedRecipient.customerFeedback}</p>
                </div>
              )}

              {Object.keys(selectedRecipient.dispositionData || {}).length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1.5">Captured outcome details</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(selectedRecipient.dispositionData || {}).map(([key, value]) => (
                      <Badge key={key} variant="outline" className="font-normal">
                        {captureFieldLabels[key] || key.replace(/_/g, " ")}: {value}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-medium text-gray-500 mb-1.5">Full conversation</div>
                <div className="rounded-lg border bg-gray-50 p-3 max-h-[320px] overflow-y-auto space-y-2">
                  {messagesLoading ? (
                    <div className="py-6 text-center text-sm text-gray-400">Loading conversation…</div>
                  ) : selectedRecipientMessages.length === 0 ? (
                    <div className="py-6 text-center text-sm text-gray-400">
                      No conversation messages are available yet.
                    </div>
                  ) : (
                    selectedRecipientMessages.map(message => {
                      const inbound = message.direction === "inbound";
                      return (
                        <div key={message.id} className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
                          <div
                            className={`max-w-[85%] rounded-lg px-3 py-2 ${
                              inbound ? "bg-white border text-gray-800" : "bg-emerald-100 text-gray-800"
                            }`}
                          >
                            <div className="text-[10px] font-medium text-gray-500 mb-0.5">
                              {inbound ? "Recipient" : campaign.aiAgentName || "Campaign"}
                              {" · "}
                              {new Date(message.createdAt).toLocaleString([], {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                            <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
