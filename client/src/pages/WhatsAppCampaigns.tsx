import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Megaphone, Send, X, Trash2, ChevronRight, Calendar, Copy, Table2 } from "lucide-react";

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

export default function WhatsAppCampaigns() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({ queryKey: ["/api/whatsapp/campaigns"] });

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
        <div className="grid gap-3">
          {campaigns.map(c => (
            <Card key={c.id} className="hover:shadow-md transition-shadow" data-testid={`card-campaign-${c.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setLocation(`/admin/whatsapp-campaigns/${c.id}`)}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{c.name}</span>
                      <Badge variant={STATUS_VARIANT[c.status] || "outline"}>{c.status}</Badge>
                      <Badge variant="outline">{c.campaignType === "automation" ? "Automation campaign" : "One-time"}</Badge>
                      {c.aiEnabled === "true" && <Badge variant="outline">AI Reply</Badge>}
                    </div>
                    <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                      <span>{c.campaignType === "automation" ? "Audience: choose in Automations" : `Recipients: ${c.totalRecipients}`}</span>
                      <span className="text-emerald-600">Sent: {c.sentCount}</span>
                      <span className="text-blue-600">Replied: {c.repliedCount}</span>
                      {c.failedCount > 0 && <span className="text-red-600">Failed: {c.failedCount}</span>}
                      {c.optedOutCount > 0 && <span className="text-amber-600">Opted-out: {c.optedOutCount}</span>}
                      {c.scheduledAt && <span><Calendar className="h-3 w-3 inline mr-0.5" />{new Date(c.scheduledAt).toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => workbookMutation.mutate(c)}
                      disabled={workbookMutation.isPending}
                      title="Create an AI workbook from this campaign"
                      data-testid={`button-create-workbook-${c.id}`}
                    >
                      <Table2 className="h-4 w-4 mr-1" /> Workbook
                    </Button>
                    {c.campaignType === "automation" && c.status === "draft" ? (
                      <Button size="sm" variant="default" onClick={() => setLocation(`/admin/whatsapp-campaign-automations/new?campaign=${c.id}`)} data-testid={`button-setup-automation-${c.id}`}>
                        Set up automation
                      </Button>
                    ) : (c.status === "draft" || c.status === "scheduled") && (
                      <Button size="sm" variant="default" onClick={() => sendMutation.mutate(c.id)} disabled={sendMutation.isPending} data-testid={`button-send-${c.id}`}>
                        <Send className="h-4 w-4 mr-1" /> Send Now
                      </Button>
                    )}
                    {c.status === "sending" && (
                      <Button size="sm" variant="outline" onClick={() => cancelMutation.mutate(c.id)} data-testid={`button-cancel-${c.id}`}>
                        <X className="h-4 w-4 mr-1" /> Cancel
                      </Button>
                    )}
                    {/* Available in every state — re-running a finished campaign is the point. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLocation(`/admin/whatsapp-campaigns/new?from=${c.id}`)}
                      title="Duplicate this campaign"
                      aria-label={`Duplicate ${c.name}`}
                      data-testid={`button-duplicate-${c.id}`}
                    >
                      <Copy className="h-4 w-4 text-gray-500" />
                    </Button>
                    {(c.status === "draft" || c.status === "cancelled" || c.status === "failed" || c.status === "completed") && (
                      <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(c)} data-testid={`button-delete-${c.id}`}>
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setLocation(`/admin/whatsapp-campaigns/${c.id}`)}>
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
