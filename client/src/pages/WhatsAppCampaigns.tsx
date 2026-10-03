import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Megaphone, Send, X, Trash2, ChevronRight, Calendar, Copy, Table2, MoreHorizontal, Search, Smartphone, Moon, Loader2 } from "lucide-react";
import { STATUS_LABEL, type AudiencePreview } from "@/components/whatsapp/campaignWizard/types";
import { TestSendDialog } from "@/components/whatsapp/campaignWizard/TestSendDialog";

interface Campaign {
  id: string;
  name: string;
  campaignType?: "one_time" | "automation";
  templateId: string;
  groupIds: string[];
  status: string;
  scheduledAt: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  repliedCount: number;
  optedOutCount: number;
  aiEnabled: string;
  quietHoursEnd?: string | null;
  variantBTemplateId?: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  scheduled: "secondary",
  sending: "secondary",
  paused: "secondary",
  completed: "default",
  cancelled: "destructive",
  failed: "destructive",
};

type StatusFilter = "all" | "draft" | "scheduled" | "active" | "completed" | "stopped";
type SortKey = "newest" | "oldest" | "name" | "status";

const STATUS_FILTERS: { key: StatusFilter; label: string; match: (s: string) => boolean }[] = [
  { key: "all", label: "All statuses", match: () => true },
  { key: "draft", label: "Drafts", match: s => s === "draft" },
  { key: "scheduled", label: "Scheduled", match: s => s === "scheduled" },
  { key: "active", label: "Sending or paused", match: s => s === "sending" || s === "paused" },
  { key: "completed", label: "Finished", match: s => s === "completed" },
  { key: "stopped", label: "Cancelled or failed", match: s => s === "cancelled" || s === "failed" },
];
const STATUS_ORDER = ["sending", "paused", "scheduled", "draft", "completed", "failed", "cancelled"];
const DELETABLE = ["draft", "cancelled", "failed", "completed"];

const statusLabel = (s: string) => STATUS_LABEL[s] || s;

export default function WhatsAppCampaigns() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Campaign | null>(null);
  const [sendTarget, setSendTarget] = useState<Campaign | null>(null);
  const [testTarget, setTestTarget] = useState<Campaign | null>(null);
  const [bulkAction, setBulkAction] = useState<"delete" | "cancel" | null>(null);

  const { data: campaigns = [], isLoading, error } = useQuery<Campaign[]>({ queryKey: ["/api/whatsapp/campaigns"] });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filter = STATUS_FILTERS.find(f => f.key === statusFilter)!;
    const list = campaigns.filter(c => filter.match(c.status) && (!q || c.name.toLowerCase().includes(q)));
    const byDate = (a: Campaign, b: Campaign) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return [...list].sort((a, b) => {
      if (sort === "oldest") return -byDate(a, b);
      if (sort === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (sort === "status") return (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) || byDate(a, b);
      return byDate(a, b);
    });
  }, [campaigns, search, statusFilter, sort]);

  const selectedCampaigns = campaigns.filter(c => selected.has(c.id));
  const selectedDrafts = selectedCampaigns.filter(c => c.status === "draft");
  const selectedScheduled = selectedCampaigns.filter(c => c.status === "scheduled");
  const allVisibleSelected = visible.length > 0 && visible.every(c => selected.has(c.id));
  const toggle = (id: string, on: boolean) => setSelected(prev => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaigns"] });

  // How many people a "Send now" reaches — fetched when the confirmation opens.
  const { data: sendPreview, isFetching: sendPreviewLoading } = useQuery<AudiencePreview>({
    queryKey: [`/api/whatsapp/campaigns/${sendTarget?.id}/audience-preview`],
    enabled: Boolean(sendTarget),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const sendMutation = useMutation({
    mutationFn: async (id: string) => apiRequest<{ pausedForQuietHours?: boolean; message?: string }>("POST", `/api/whatsapp/campaigns/${id}/send`),
    onSuccess: res => {
      refresh();
      toast(res?.pausedForQuietHours
        ? { title: "Campaign waiting for quiet hours to end", description: res.message }
        : { title: "Campaign send started" });
    },
    onError: (e: any) => toast({ title: "Couldn't start sending", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/whatsapp/campaigns/${id}/cancel`),
    onSuccess: () => { refresh(); toast({ title: "Campaign cancelled" }); },
    onError: (e: any) => toast({ title: "Couldn't cancel the campaign", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/whatsapp/campaigns/${id}`),
    onSuccess: (_d, id) => { refresh(); toggle(id, false); toast({ title: "Campaign deleted" }); },
    onError: (e: any) => toast({ title: "Couldn't delete the campaign", description: e.message, variant: "destructive" }),
  });

  const bulkMutation = useMutation({
    mutationFn: async ({ action, ids }: { action: "delete" | "cancel"; ids: string[] }) =>
      apiRequest<{ done: string[]; skipped: { id: string; reason: string }[] }>("POST", "/api/whatsapp/campaigns/bulk", { action, ids }),
    onSuccess: (res, { action }) => {
      refresh();
      setSelected(new Set());
      const verb = action === "delete" ? "deleted" : "cancelled";
      toast({
        title: `${res.done.length} campaign${res.done.length === 1 ? "" : "s"} ${verb}`,
        description: res.skipped.length ? `${res.skipped.length} skipped: ${Array.from(new Set(res.skipped.map(s => s.reason))).join("; ")}` : undefined,
        variant: res.done.length === 0 && res.skipped.length ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Bulk action failed", description: e.message, variant: "destructive" }),
  });

  const workbookMutation = useMutation({
    mutationFn: async (campaign: Campaign) => apiRequest<{ id: string }>("POST", "/api/whatsapp/ai-workbooks", {
      name: `${campaign.name} Workbook`,
      sourceCampaignId: campaign.id,
    }),
    onSuccess: workbook => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      toast({ title: "AI workbook created" });
      setLocation(`/admin/whatsapp-ai-workbooks/${workbook.id}`);
    },
    onError: (e: any) => toast({ title: "Workbook creation failed", description: e.message, variant: "destructive" }),
  });

  const sendCount = sendPreview?.willSend;

  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
            <Megaphone className="h-6 w-6 text-emerald-600" /> WhatsApp Campaigns
          </h1>
          <p className="mt-1 text-sm text-gray-600">Send a WhatsApp message to your audiences; AI can answer the replies.</p>
        </div>
        <Button onClick={() => setLocation("/admin/whatsapp-campaigns/new")} data-testid="button-new-campaign" className="self-start sm:self-auto">
          <Plus className="mr-1 h-4 w-4" /> New campaign
        </Button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading...</div>
      ) : error ? (
        <Card><CardContent className="py-12 text-center text-red-600">Couldn't load campaigns: {(error as Error).message}</CardContent></Card>
      ) : campaigns.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-gray-500">No campaigns yet. Create your first WhatsApp campaign.</CardContent></Card>
      ) : (
        <>
          {/* Toolbar */}
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input className="pl-8" placeholder="Search campaigns" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-campaigns" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Select value={statusFilter} onValueChange={val => setStatusFilter(val as StatusFilter)}>
                <SelectTrigger className="sm:w-48" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map(f => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.label} ({campaigns.filter(c => f.match(c.status)).length})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={val => setSort(val as SortKey)}>
                <SelectTrigger className="sm:w-40" data-testid="select-sort"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="name">Name A–Z</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Selection bar */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-gray-600">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={on => setSelected(on ? new Set(visible.map(c => c.id)) : new Set())}
                aria-label="Select all shown campaigns"
                data-testid="checkbox-select-all"
              />
              {selected.size > 0 ? `${selected.size} selected` : "Select all"}
            </label>
            {selected.size > 0 && (
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={selectedScheduled.length === 0 || bulkMutation.isPending} onClick={() => setBulkAction("cancel")} data-testid="button-bulk-cancel">
                  <X className="mr-1 h-4 w-4" /> Cancel scheduled ({selectedScheduled.length})
                </Button>
                <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" disabled={selectedDrafts.length === 0 || bulkMutation.isPending} onClick={() => setBulkAction("delete")} data-testid="button-bulk-delete">
                  <Trash2 className="mr-1 h-4 w-4" /> Delete drafts ({selectedDrafts.length})
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <Card>
              <CardContent className="py-14 text-center">
                <p className="font-medium text-gray-800">No campaigns match</p>
                <p className="mt-1 text-sm text-gray-500">Try a different search or status.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {visible.map(c => {
                const isAutomationDraft = c.campaignType === "automation" && c.status === "draft";
                return (
                  <Card key={c.id} className="border-gray-200/80 transition-shadow hover:shadow-md" data-testid={`card-campaign-${c.id}`}>
                    <CardContent className="p-3 sm:p-5">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <Checkbox
                            className="mt-1"
                            checked={selected.has(c.id)}
                            onCheckedChange={on => toggle(c.id, !!on)}
                            aria-label={`Select ${c.name}`}
                            data-testid={`checkbox-campaign-${c.id}`}
                          />
                          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setLocation(`/admin/whatsapp-campaigns/${c.id}`)}>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                              <span className="truncate text-base font-semibold text-gray-900">{c.name}</span>
                              <Badge variant={STATUS_VARIANT[c.status] || "outline"} className="gap-1">
                                {c.status === "paused" && <Moon className="h-3 w-3" />}
                                {statusLabel(c.status)}
                              </Badge>
                              {c.variantBTemplateId && <Badge variant="outline">A/B test</Badge>}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                              <span>{c.campaignType === "automation" ? "Repeats automatically" : "Sent once"}</span>
                              {c.aiEnabled === "true" && <><span className="text-gray-300">•</span><span>AI replies on</span></>}
                              <span className="text-gray-300">•</span>
                              <span>{c.campaignType === "automation" ? "Contacts set in Automations" : `${c.totalRecipients.toLocaleString()} recipients`}</span>
                              {c.status === "paused" && c.quietHoursEnd && <><span className="text-gray-300">•</span><span>Continues at {c.quietHoursEnd}</span></>}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                              <span className="font-medium text-emerald-600">Sent {c.sentCount}</span>
                              <span className="font-medium text-blue-600">Replied {c.repliedCount}</span>
                              {c.failedCount > 0 && <span className="font-medium text-red-600">Failed {c.failedCount}</span>}
                              {c.optedOutCount > 0 && <span className="font-medium text-amber-600">Opted out {c.optedOutCount}</span>}
                              {c.scheduledAt && <span className="text-gray-500"><Calendar className="mr-1 inline h-3 w-3" />{new Date(c.scheduledAt).toLocaleString()}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-3 lg:justify-end lg:border-t-0 lg:pt-0">
                          <div>
                            {isAutomationDraft ? (
                              <Button size="sm" onClick={() => setLocation(`/admin/whatsapp-campaign-automations/new?campaign=${c.id}`)} data-testid={`button-setup-automation-${c.id}`}>
                                Set up automation
                              </Button>
                            ) : (c.status === "draft" || c.status === "scheduled") ? (
                              <Button size="sm" onClick={() => setSendTarget(c)} disabled={sendMutation.isPending} data-testid={`button-send-${c.id}`}>
                                <Send className="mr-1.5 h-4 w-4" /> Send now
                              </Button>
                            ) : (c.status === "sending" || c.status === "paused") ? (
                              <Button size="sm" variant="outline" onClick={() => setCancelTarget(c)} disabled={cancelMutation.isPending} data-testid={`button-cancel-${c.id}`}>
                                <X className="mr-1.5 h-4 w-4" /> Cancel
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => setLocation(`/admin/whatsapp-campaigns/${c.id}`)}>
                                View campaign <ChevronRight className="ml-1 h-4 w-4" />
                              </Button>
                            )}
                          </div>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-9 w-9 text-gray-500" aria-label={`More actions for ${c.name}`} data-testid={`button-more-${c.id}`}>
                                <MoreHorizontal className="h-5 w-5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem onSelect={() => setLocation(`/admin/whatsapp-campaigns/${c.id}`)}>
                                <ChevronRight className="mr-2 h-4 w-4" /> View campaign
                              </DropdownMenuItem>
                              {c.campaignType !== "automation" && (
                                <DropdownMenuItem onSelect={() => setTestTarget(c)}>
                                  <Smartphone className="mr-2 h-4 w-4" /> Send test to my phone
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => workbookMutation.mutate(c)} disabled={workbookMutation.isPending}>
                                <Table2 className="mr-2 h-4 w-4" /> Create workbook
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setLocation(`/admin/whatsapp-campaigns/new?from=${c.id}`)}>
                                <Copy className="mr-2 h-4 w-4" /> Duplicate
                              </DropdownMenuItem>
                              {c.status === "scheduled" && (
                                <DropdownMenuItem onSelect={() => setCancelTarget(c)}>
                                  <X className="mr-2 h-4 w-4" /> Cancel schedule
                                </DropdownMenuItem>
                              )}
                              {DELETABLE.includes(c.status) && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => setDeleteTarget(c)} className="text-red-600 focus:text-red-600">
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Send now */}
      <AlertDialog open={!!sendTarget} onOpenChange={open => { if (!open) setSendTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {sendPreviewLoading || sendCount === undefined
                ? "Send this campaign now?"
                : `Send to ${sendCount.toLocaleString()} ${sendCount === 1 ? "person" : "people"} now?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>"{sendTarget?.name}" starts going out right away. Messages can't be taken back once sent.</p>
                {sendPreviewLoading && <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Counting people…</p>}
                {sendPreview && (sendPreview.skipped.duplicates + sendPreview.skipped.optedOut + sendPreview.skipped.invalid) > 0 && (
                  <p>
                    Skipped: {[
                      sendPreview.skipped.duplicates ? `${sendPreview.skipped.duplicates} duplicate` : "",
                      sendPreview.skipped.optedOut ? `${sendPreview.skipped.optedOut} opted out` : "",
                      sendPreview.skipped.invalid ? `${sendPreview.skipped.invalid} invalid` : "",
                    ].filter(Boolean).join(", ")}.
                  </p>
                )}
                {sendTarget?.status === "scheduled" && sendTarget.scheduledAt && (
                  <p>It was scheduled for {new Date(sendTarget.scheduledAt).toLocaleString()}; it will go now instead.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={sendPreviewLoading || sendCount === 0}
              onClick={() => { if (sendTarget) sendMutation.mutate(sendTarget.id); setSendTarget(null); }}
              data-testid="button-confirm-send"
            >
              Send now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel */}
      <AlertDialog open={!!cancelTarget} onOpenChange={open => { if (!open) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel "{cancelTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.status === "scheduled"
                ? "It won't be sent at the scheduled time. This can't be undone — you can duplicate it later to send it again."
                : "No more messages will be sent. People who already got it keep their message, and their replies still arrive. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={() => { if (cancelTarget) cancelMutation.mutate(cancelTarget.id); setCancelTarget(null); }}
              data-testid="button-confirm-cancel"
            >
              Cancel campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-semibold">"{deleteTarget?.name}"</span> and all its recipient history. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null); }}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk */}
      <AlertDialog open={!!bulkAction} onOpenChange={open => { if (!open) setBulkAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction === "delete"
                ? `Delete ${selectedDrafts.length} draft${selectedDrafts.length === 1 ? "" : "s"}?`
                : `Cancel ${selectedScheduled.length} scheduled campaign${selectedScheduled.length === 1 ? "" : "s"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{bulkAction === "delete" ? "These drafts are deleted for good." : "These won't be sent at their scheduled time."} This can't be undone.</p>
                {bulkAction === "delete" && selectedCampaigns.length > selectedDrafts.length && (
                  <p>Only drafts are deleted; the other {selectedCampaigns.length - selectedDrafts.length} selected campaign(s) stay as they are.</p>
                )}
                {bulkAction === "cancel" && selectedCampaigns.length > selectedScheduled.length && (
                  <p>Only scheduled campaigns are cancelled; the other {selectedCampaigns.length - selectedScheduled.length} selected campaign(s) stay as they are.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={() => {
                if (bulkAction) {
                  const ids = (bulkAction === "delete" ? selectedDrafts : selectedScheduled).map(c => c.id);
                  bulkMutation.mutate({ action: bulkAction, ids });
                }
                setBulkAction(null);
              }}
              data-testid="button-confirm-bulk"
            >
              {bulkAction === "delete" ? "Delete drafts" : "Cancel campaigns"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {testTarget && (
        <TestSendDialog open onOpenChange={open => { if (!open) setTestTarget(null); }} target={{ campaignId: testTarget.id }} />
      )}
    </div>
  );
}
