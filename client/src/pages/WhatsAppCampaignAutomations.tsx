import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CalendarClock, ChevronRight, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

export interface CampaignAutomation {
  id: string;
  name: string;
  sourceType?: "upload" | "ai_workbook" | "campaign_blueprint";
  sourceCampaignId?: string | null;
  sendMode: "review" | "automatic";
  sendTime: string;
  timezone: string;
  dateColumn: string;
  dateOffsetDays: number;
  enabled: boolean;
  updatedAt: string;
}

export default function WhatsAppCampaignAutomations() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<CampaignAutomation | null>(null);
  const { data: automations = [], isLoading } = useQuery<CampaignAutomation[]>({
    queryKey: ["/api/whatsapp/campaign-automations"],
  });
  const { data: campaigns = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/whatsapp/campaigns"],
  });
  const campaignNames = new Map(campaigns.map(campaign => [campaign.id, campaign.name]));
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/whatsapp/campaign-automations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-automations"] });
      toast({ title: "Automation deleted" });
      setDeleteTarget(null);
    },
    onError: (error: any) => toast({ title: "Could not delete automation", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-emerald-600" /> Spreadsheet Automations
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Run recurring deliveries from a fully configured draft WhatsApp campaign.
          </p>
        </div>
        <Button onClick={() => setLocation("/admin/whatsapp-campaign-automations/new")} data-testid="button-new-campaign-automation">
          <Plus className="h-4 w-4 mr-1" /> New Automation
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading automations...</div>
      ) : automations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="h-10 w-10 text-emerald-600 mx-auto mb-3" />
              <h2 className="font-semibold text-gray-900">No campaign automations yet</h2>
            <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
                Create a WhatsApp campaign draft with its AI behavior and linked workbook, then use it as an automation blueprint.
            </p>
            <Button className="mt-4" onClick={() => setLocation("/admin/whatsapp-campaign-automations/new")}>
              Create automation
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {automations.map(automation => (
            <Card
              key={automation.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setLocation(`/admin/whatsapp-campaign-automations/${automation.id}`)}
              data-testid={`card-campaign-automation-${automation.id}`}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-emerald-50 p-2.5">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="font-semibold">{automation.name}</span>
                    <Badge variant={automation.enabled ? "default" : "outline"}>
                      {automation.enabled ? "Active" : "Paused"}
                    </Badge>
                    <Badge variant="outline">
                      {automation.sendMode === "automatic" ? "Automatic" : "Review before send"}
                    </Badge>
                    <Badge variant="outline">
                      {automation.sourceType === "campaign_blueprint"
                        ? `Blueprint: ${campaignNames.get(automation.sourceCampaignId || "") || "Unavailable"}`
                        : automation.sourceType === "ai_workbook" ? "Legacy AI Workbook" : "Legacy spreadsheet upload"}
                    </Badge>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    <span>Send at {automation.sendTime} · {automation.timezone}</span>
                    <span>Date field: {automation.dateColumn}</span>
                    <span>Offset: {automation.dateOffsetDays > 0 ? "+" : ""}{automation.dateOffsetDays} days</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={event => event.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-gray-400 hover:text-red-600"
                    onClick={() => setDeleteTarget(automation)}
                    aria-label={`Delete ${automation.name}`}
                    data-testid={`button-delete-campaign-automation-${automation.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open && !deleteMutation.isPending) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete automation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop future runs for <strong>{deleteTarget?.name}</strong> and remove it from the active automation list. Already-sent messages and campaign run history will be preserved. Pending review or scheduled work will be cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
              onClick={event => {
                event.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete automation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}