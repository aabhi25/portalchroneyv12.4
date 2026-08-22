import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CalendarClock, ChevronRight, FileSpreadsheet, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface CampaignAutomation {
  id: string;
  name: string;
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
  const { data: automations = [], isLoading } = useQuery<CampaignAutomation[]>({
    queryKey: ["/api/whatsapp/campaign-automations"],
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-emerald-600" /> Spreadsheet Automations
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Turn a daily Excel or CSV upload into a scheduled WhatsApp campaign.
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
            <h2 className="font-semibold text-gray-900">No spreadsheet automations yet</h2>
            <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
              Configure a date rule, approved template, and send time for daily loan, EMI, or other spreadsheet-based messages.
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
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    <span>Send at {automation.sendTime} · {automation.timezone}</span>
                    <span>Date field: {automation.dateColumn}</span>
                    <span>Offset: {automation.dateOffsetDays > 0 ? "+" : ""}{automation.dateOffsetDays} days</span>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-400 shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}