import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Megaphone, Send, X, Trash2, ChevronRight, Calendar, Copy, Table2, MoreHorizontal } from "lucide-react";

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
  createdAt: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  scheduled: "secondary",
  sending: "secondary",
  completed: "default",
  cancelled: "destructive",
  failed: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
};

type CampaignTab = "drafts" | "all" | "sent";

export default function WhatsAppCampaigns() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [activeTab, setActiveTab] = useState<CampaignTab>("all");

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({ queryKey: ["/api/whatsapp/campaigns"] });
  const draftCampaigns = campaigns.filter(campaign => campaign.status === "draft");
  const sentCampaigns = campaigns.filter(campaign => campaign.status !== "draft");
  const visibleCampaigns = activeTab === "drafts"
    ? draftCampaigns
    : activeTab === "sent"
      ? sentCampaigns
      : campaigns;

  const sendMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/whatsapp/campaigns/${id}/send`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaigns"] });
      toast({ title: "Campaign send started" });
    },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/whatsapp/campaigns/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaigns"] });
      toast({ title: "Campaign cancelled" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/whatsapp/campaigns/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaigns"] });
      toast({ title: "Campaign deleted" });
    },
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-emerald-600" /> WhatsApp Campaigns
          </h1>
          <p className="text-sm text-gray-600 mt-1">Send template blasts to contact groups; AI negotiates replies per-campaign.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setLocation("/admin/whatsapp-campaigns/new")} data-testid="button-new-campaign">
            <Plus className="h-4 w-4 mr-1" /> New Campaign
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading...</div>
      ) : campaigns.length === 0 ? (
        <Card><CardContent className="text-center py-12 text-gray-500">No campaigns yet. Create your first WhatsApp marketing campaign.</CardContent></Card>
      ) : (
        <>
          <Tabs
            value={activeTab}
            onValueChange={value => setActiveTab(value as CampaignTab)}
            className="mb-5"
          >
            <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 shadow-sm sm:w-fit">
              <TabsTrigger value="drafts" className="min-w-[92px] gap-2 rounded-lg px-4 py-2.5">
                Drafts
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{draftCampaigns.length}</span>
              </TabsTrigger>
              <TabsTrigger value="all" className="min-w-[92px] gap-2 rounded-lg px-4 py-2.5">
                All
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{campaigns.length}</span>
              </TabsTrigger>
              <TabsTrigger value="sent" className="min-w-[92px] gap-2 rounded-lg px-4 py-2.5">
                Sent
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{sentCampaigns.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {visibleCampaigns.length === 0 ? (
            <Card>
              <CardContent className="py-14 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                  <Megaphone className="h-5 w-5" />
                </div>
                <p className="font-medium text-gray-800">
                  {activeTab === "drafts" ? "No drafts yet" : "No sent campaigns yet"}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {activeTab === "drafts"
                    ? "Create a campaign to start preparing your next message."
                    : "Campaigns will appear here after they leave the draft stage."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {visibleCampaigns.map(c => (
                <Card key={c.id} className="border-gray-200/80 transition-shadow hover:shadow-md" data-testid={`card-campaign-${c.id}`}>
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setLocation(`/admin/whatsapp-campaigns/${c.id}`)}>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                          <span className="truncate text-base font-semibold text-gray-900">{c.name}</span>
                          <Badge variant={STATUS_VARIANT[c.status] || "outline"}>{STATUS_LABEL[c.status] || c.status}</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                          <span>{c.campaignType === "automation" ? "Automation campaign" : "One-time campaign"}</span>
                          {c.aiEnabled === "true" && <><span className="text-gray-300">•</span><span>AI Reply</span></>}
                          <span className="text-gray-300">•</span>
                          <span>{c.campaignType === "automation" ? "Audience in Automations" : `${c.totalRecipients} recipients`}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                          <span className="font-medium text-emerald-600">Sent {c.sentCount}</span>
                          <span className="font-medium text-blue-600">Replied {c.repliedCount}</span>
                          {c.failedCount > 0 && <span className="font-medium text-red-600">Failed {c.failedCount}</span>}
                          {c.optedOutCount > 0 && <span className="font-medium text-amber-600">Opted-out {c.optedOutCount}</span>}
                          {c.scheduledAt && <span className="text-gray-500"><Calendar className="mr-1 inline h-3 w-3" />{new Date(c.scheduledAt).toLocaleString()}</span>}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-3 lg:justify-end lg:border-t-0 lg:pt-0">
                        <div>
                          {c.campaignType === "automation" && c.status === "draft" ? (
                            <Button size="sm" variant="default" onClick={() => setLocation(`/admin/whatsapp-campaign-automations/new?campaign=${c.id}`)} data-testid={`button-setup-automation-${c.id}`}>
                              Set up automation
                            </Button>
                          ) : (c.status === "draft" || c.status === "scheduled") ? (
                            <Button size="sm" variant="default" onClick={() => sendMutation.mutate(c.id)} disabled={sendMutation.isPending} data-testid={`button-send-${c.id}`}>
                              <Send className="mr-1.5 h-4 w-4" /> Send Now
                            </Button>
                          ) : c.status === "sending" ? (
                            <Button size="sm" variant="outline" onClick={() => cancelMutation.mutate(c.id)} data-testid={`button-cancel-${c.id}`}>
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
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onSelect={() => setLocation(`/admin/whatsapp-campaigns/${c.id}`)}>
                              <ChevronRight className="mr-2 h-4 w-4" /> View campaign
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => workbookMutation.mutate(c)} disabled={workbookMutation.isPending}>
                              <Table2 className="mr-2 h-4 w-4" /> Create workbook
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setLocation(`/admin/whatsapp-campaigns/new?from=${c.id}`)}>
                              <Copy className="mr-2 h-4 w-4" /> Duplicate
                            </DropdownMenuItem>
                            {(c.status === "draft" || c.status === "cancelled" || c.status === "failed" || c.status === "completed") && (
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
              ))}
            </div>
          )}
        </>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-semibold">"{deleteTarget?.name}"</span> and all its recipient history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
