import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, X, RefreshCw, MessageCircle, RotateCcw, Info, Pencil, MessageSquare, Copy } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { interpolatePreview, type Template, type Group } from "@/components/CampaignForm";

interface Campaign {
  id: string; name: string; status: string;
  templateId: string; templateParams: string[] | null; groupIds: string[] | null;
  totalRecipients: number; sentCount: number; failedCount: number; repliedCount: number; optedOutCount: number;
  scheduledAt: string | null; startedAt: string | null; completedAt: string | null;
  aiEnabled: string; aiAgentName: string;
  aiSystemPrompt: string | null; aiUseFaqs: string; aiUseDocs: string; aiUseProducts: string;
}
interface Recipient {
  id: string; phone: string; name: string;
  status: string; errorMessage: string | null;
  sentAt: string | null; deliveredAt: string | null; readAt: string | null;
  firstReplyAt: string | null; replyCount: number; aiReplyCount: number;
}
interface RecipientsResponse {
  recipients: Recipient[];
  counts: { total: number; pending: number; queued: number; sent: number; delivered: number; read: number; failed: number; expired: number; replied: number; opted_out: number };
  limit: number;
  offset: number;
}
interface Message {
  id: string; direction: string; body: string; createdAt: string; metadata: any;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", queued: "outline", sent: "secondary", delivered: "secondary", read: "secondary",
  replied: "default", opted_out: "outline", failed: "destructive", expired: "destructive",
};

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
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);

  // Polling stops once a request has failed. Without this a campaign that can't be fetched is
  // re-requested every 5s for as long as the tab stays open.
  const { data: campaign, error: campaignError } = useQuery<Campaign>({
    queryKey: [`/api/whatsapp/campaigns/${id}`],
    refetchInterval: (query) => (query.state.error ? false : 5000),
    refetchOnMount: "always",
  });
  const { data: recipientsData, isLoading } = useQuery<RecipientsResponse>({
    queryKey: [`/api/whatsapp/campaigns/${id}/recipients`],
    enabled: !campaignError,
    refetchInterval: (query) => (query.state.error ? false : 5000),
    refetchOnMount: "always",
  });
  const recipients = recipientsData?.recipients ?? [];
  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: [`/api/whatsapp/campaigns/${id}/recipients/${selectedRecipient?.id}/messages`],
    enabled: !!selectedRecipient,
    refetchInterval: 5000,
    refetchOnMount: "always",
  });
  // The campaign stores template and group IDs; these resolve them to names for display.
  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["/api/whatsapp/templates"],
    enabled: !campaignError,
  });
  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["/api/whatsapp/contact-groups"],
    enabled: !campaignError,
  });

  const sendMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/whatsapp/campaigns/${id}/send`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}/recipients`] });
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
    // apiRequest already parses JSON and returns the body — do NOT call .json() on it
    mutationFn: async () => apiRequest<{ requeued: number }>("POST", `/api/whatsapp/campaigns/${id}/resend-failed`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}/recipients`] });
      toast({ title: data?.requeued > 0 ? `Resending ${data.requeued} recipients` : "Nothing to resend" });
    },
    onError: (e: any) => toast({ title: "Resend failed", description: e.message, variant: "destructive" }),
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => apiRequest<{ checked: number; updated: number }>("POST", `/api/whatsapp/campaigns/${id}/reconcile`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}/recipients`] });
      const checked = data?.checked ?? 0;
      const updated = data?.updated ?? 0;
      toast({
        title: checked === 0
          ? "Nothing to refresh"
          : `Refreshed ${checked} — updated ${updated}`,
      });
    },
    onError: (e: any) => toast({ title: "Refresh failed", description: e.message, variant: "destructive" }),
  });

  const resendOneMutation = useMutation({
    mutationFn: async (recipientId: string) =>
      apiRequest<{ requeued: number }>("POST", `/api/whatsapp/campaigns/${id}/recipients/${recipientId}/resend`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}/recipients`] });
      toast({ title: data?.requeued > 0 ? "Recipient queued for resend" : "Nothing to resend" });
    },
    onError: (e: any) => toast({ title: "Resend failed", description: e.message, variant: "destructive" }),
  });

  const failedCount = (recipientsData?.counts.failed ?? 0) + (recipientsData?.counts.expired ?? 0);

  // Recipients are snapshotted from the contact groups when the send starts, so configuration
  // is only meaningful to change before that. After it, this is the record of what went out.
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => setLocation("/admin/whatsapp-campaigns")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {campaign.name}
            <Badge variant={STATUS_VARIANT[campaign.status] || "outline"}>{campaign.status}</Badge>
          </h1>
          <div className="text-xs text-gray-500 mt-1">
            {campaign.scheduledAt && <>Scheduled: {new Date(campaign.scheduledAt).toLocaleString()} · </>}
            {campaign.startedAt && <>Started: {new Date(campaign.startedAt).toLocaleString()} · </>}
            {campaign.completedAt && <>Completed: {new Date(campaign.completedAt).toLocaleString()}</>}
          </div>
        </div>
        <div className="flex gap-2">
          {/* Offered in every state — this is how a completed campaign gets run again. */}
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

      <div className="grid grid-cols-7 gap-3 mb-6">
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500">Recipients</div><div className="text-2xl font-bold">{campaign.totalRecipients}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500" title="Provider accepted but Meta has not yet confirmed">Queued</div><div className="text-2xl font-bold text-slate-600" data-testid="counter-queued">{recipientsData?.counts.queued ?? 0}</div></CardContent></Card>
        {/* Tiles below prefer the recipient-derived live counts (counts.*) over
            the persisted campaign counters, which can lag by up to one
            scheduler tick when many webhooks arrive in close succession. */}
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500" title="Accepted by Meta, awaiting delivery confirmation">Sent</div><div className="text-2xl font-bold text-emerald-600" data-testid="counter-sent">{((recipientsData?.counts.sent ?? 0) + (recipientsData?.counts.delivered ?? 0) + (recipientsData?.counts.read ?? 0) + (recipientsData?.counts.replied ?? 0)) || campaign.sentCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500" title="Confirmed delivered to recipient's device">Delivered</div><div className="text-2xl font-bold text-teal-600" data-testid="counter-delivered">{(recipientsData?.counts.delivered ?? 0) + (recipientsData?.counts.read ?? 0) + (recipientsData?.counts.replied ?? 0)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500">Replied</div><div className="text-2xl font-bold text-blue-600" data-testid="counter-replied">{recipientsData?.counts.replied ?? campaign.repliedCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500" title="Includes provider-reported failures and queued rows that timed out">Failed</div><div className="text-2xl font-bold text-red-600" data-testid="counter-failed">{((recipientsData?.counts.failed ?? 0) + (recipientsData?.counts.expired ?? 0)) || campaign.failedCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-gray-500">Opted out</div><div className="text-2xl font-bold text-amber-600" data-testid="counter-opted-out">{recipientsData?.counts.opted_out ?? campaign.optedOutCount}</div></CardContent></Card>
      </div>

      {/* How this campaign is configured — what it sends, to whom, and when. */}
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

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base">Recipients</CardTitle>
            {(campaign.status === "sending" || campaign.status === "completed") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => reconcileMutation.mutate()}
                disabled={reconcileMutation.isPending}
                data-testid="button-refresh-status"
                title="Pull live delivery status from MSG91 for any recipients still in 'queued' or 'sent'"
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${reconcileMutation.isPending ? "animate-spin" : ""}`} />
                Refresh status
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0 max-h-[500px] overflow-y-auto">
            {isLoading ? <div className="p-6 text-center text-gray-500">Loading...</div>
              : recipients.length === 0 ? <div className="p-6 text-center text-gray-500">No recipients yet (snapshot is created when you start the send).</div>
              : (
                <div className="divide-y">
                  {recipients.map(r => {
                    const canResend = r.status === "failed" || r.status === "expired";
                    return (
                      <div
                        key={r.id}
                        className={`px-4 py-3 hover:bg-gray-50 ${selectedRecipient?.id === r.id ? "bg-emerald-50" : ""}`}
                        data-testid={`row-recipient-${r.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedRecipient(r)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="font-mono text-sm">{r.phone}</div>
                            {r.name && <div className="text-sm text-gray-700">{r.name}</div>}
                          </button>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <div className="flex items-center gap-1">
                              <Badge variant={STATUS_VARIANT[r.status] || "outline"}>{r.status}</Badge>
                              {r.errorMessage && (
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-3.5 w-3.5 text-red-400 cursor-pointer shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="max-w-xs text-xs">
                                      {r.errorMessage}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                            {r.replyCount > 0 && (
                              <span className="text-xs text-blue-600 flex items-center gap-1">
                                <MessageCircle className="h-3 w-3" /> {r.replyCount}
                              </span>
                            )}
                            {canResend && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={(e) => { e.stopPropagation(); resendOneMutation.mutate(r.id); }}
                                disabled={resendOneMutation.isPending}
                                data-testid={`button-resend-${r.id}`}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" /> Resend
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Transcripts</CardTitle></CardHeader>
          <CardContent className="p-3 max-h-[500px] overflow-y-auto bg-gray-50">
            {!selectedRecipient ? (
              <div className="text-center text-gray-500 py-12">Pick a recipient on the left to see the conversation.</div>
            ) : messages.length === 0 ? (
              <div className="text-center text-gray-500 py-12">No messages yet for {selectedRecipient.phone}.</div>
            ) : (
              <div className="space-y-2">
                {messages.map(m => {
                  const isInbound = m.direction === "inbound";
                  const isAi = m.direction === "outbound_ai";
                  const isTpl = m.direction === "outbound_template";
                  return (
                    <div key={m.id} className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                        isInbound ? "bg-white border" : isAi ? "bg-emerald-100" : "bg-blue-100"
                      }`}>
                        <div className="text-[10px] uppercase tracking-wider mb-0.5 text-gray-500">
                          {isTpl ? "Template" : isAi ? `${campaign.aiAgentName} (AI)` : "Customer"} · {new Date(m.createdAt).toLocaleString()}
                        </div>
                        <div className="whitespace-pre-wrap">{m.body}</div>
                        {isTpl && Array.isArray(m.metadata?.buttons) && m.metadata.buttons.length > 0 && (
                          <div className="mt-2 flex flex-col gap-1">
                            {m.metadata.buttons.map((btn: { text: string; type: string }, bi: number) => (
                              <div
                                key={bi}
                                className="text-center text-xs font-medium text-blue-600 border border-blue-200 rounded-full px-3 py-1 bg-white"
                              >
                                {btn.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
