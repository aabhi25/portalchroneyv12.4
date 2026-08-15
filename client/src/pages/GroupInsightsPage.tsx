import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format, subDays, subMonths } from "date-fns";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { 
  BarChart3, 
  MessageSquare, 
  Contact, 
  Calendar, 
  Building2,
  ArrowLeft,
  Download,
  Pencil,
  TrendingUp,
  FileText,
  Loader2
} from "lucide-react";

type DateFilterType = "today" | "yesterday" | "last7days" | "currentMonth" | "lastMonth" | "custom" | "lifetime";

interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface GroupInsights {
  groupId: string;
  groupName: string;
  dateFrom?: string;
  dateTo?: string;
  totals: {
    leads: number;
    conversations: number;
    visitors: number;
    products: number;
    faqs: number;
  };
  accountBreakdown: {
    businessAccountId: string;
    businessName: string;
    leads: number;
    conversations: number;
    visitors: number;
    products: number;
    faqs: number;
  }[];
}

interface AccountGroup {
  id: string;
  name: string;
  ownerUserId: string;
  primaryHasFullAccess: boolean;
  createdAt: string;
  members: {
    businessAccountId: string;
    businessName: string;
    isPrimary: boolean;
  }[];
}

const dateFilterOptions: { value: DateFilterType; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7days", label: "Last 7 Days" },
  { value: "currentMonth", label: "Current Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "custom", label: "Custom Range" },
  { value: "lifetime", label: "Lifetime" },
];

const IST_OFFSET_MINUTES = 330;

function istMidnightToUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET_MINUTES * 60000);
}

function istEndOfDayToUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET_MINUTES * 60000);
}

function istStartOfDay(date: Date): Date {
  const utcMs = date.getTime() + IST_OFFSET_MINUTES * 60000;
  const d = new Date(utcMs);
  return istMidnightToUTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function istEndOfDay(date: Date): Date {
  const utcMs = date.getTime() + IST_OFFSET_MINUTES * 60000;
  const d = new Date(utcMs);
  return istEndOfDayToUTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function istStartOfMonth(date: Date): Date {
  const utcMs = date.getTime() + IST_OFFSET_MINUTES * 60000;
  const d = new Date(utcMs);
  return istMidnightToUTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function istEndOfMonth(date: Date): Date {
  const utcMs = date.getTime() + IST_OFFSET_MINUTES * 60000;
  const d = new Date(utcMs);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return istEndOfDayToUTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate());
}

const istDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatDateIST(date: Date): string {
  return istDateFormatter.format(date);
}

function getDateRangeForFilter(filterType: DateFilterType): DateRange {
  const now = new Date();
  switch (filterType) {
    case "today":
      return { from: istStartOfDay(now), to: istEndOfDay(now) };
    case "yesterday":
      const yesterday = subDays(now, 1);
      return { from: istStartOfDay(yesterday), to: istEndOfDay(yesterday) };
    case "last7days":
      return { from: istStartOfDay(subDays(now, 6)), to: istEndOfDay(now) };
    case "currentMonth":
      return { from: istStartOfMonth(now), to: istEndOfDay(now) };
    case "lastMonth":
      const lastMonth = subMonths(now, 1);
      return { from: istStartOfMonth(lastMonth), to: istEndOfMonth(lastMonth) };
    case "lifetime":
    default:
      return { from: undefined, to: undefined };
  }
}

export default function GroupInsightsPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/super-admin/account-groups/:groupId/insights");
  const groupId = params?.groupId;
  const { toast } = useToast();

  const [dateFilter, setDateFilter] = useState<DateFilterType>("today");
  const [customDateRange, setCustomDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [isExportingLeadsPDF, setIsExportingLeadsPDF] = useState(false);

  const effectiveDateRange = useMemo(() => {
    if (dateFilter === "custom") {
      return {
        from: customDateRange.from ? istStartOfDay(customDateRange.from) : undefined,
        to: customDateRange.to ? istEndOfDay(customDateRange.to) : undefined,
      };
    }
    return getDateRangeForFilter(dateFilter);
  }, [dateFilter, customDateRange]);

  const { data: groups = [] } = useQuery<AccountGroup[]>({
    queryKey: ["/api/super-admin/account-groups"],
    enabled: !!groupId,
  });
  
  const group = groups.find(g => g.id === groupId);
  const groupLoading = !groups.length;

  const renameGroupMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest("PATCH", `/api/super-admin/account-groups/${groupId}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/account-groups"] });
      setIsRenameDialogOpen(false);
      setNewGroupName("");
      toast({
        title: "Group Renamed",
        description: "The group name has been updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: groupInsights, isLoading: insightsLoading } = useQuery<GroupInsights>({
    queryKey: [
      "/api/super-admin/account-groups",
      groupId,
      "insights",
      effectiveDateRange.from?.toISOString(),
      effectiveDateRange.to?.toISOString(),
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (effectiveDateRange.from) {
        params.set("dateFrom", effectiveDateRange.from.toISOString());
      }
      if (effectiveDateRange.to) {
        params.set("dateTo", effectiveDateRange.to.toISOString());
      }
      const queryString = params.toString();
      const url = `/api/super-admin/account-groups/${groupId}/insights${queryString ? `?${queryString}` : ""}`;
      return apiRequest<GroupInsights>("GET", url);
    },
    enabled: !!groupId,
  });

  const downloadPDF = async () => {
    if (!groupInsights || !group) return;
    try {
      const dateRangeText = effectiveDateRange.from && effectiveDateRange.to
        ? `${formatDateIST(effectiveDateRange.from)} to ${formatDateIST(effectiveDateRange.to)}`
        : "All time";

      // PDF is rendered server-side: the browser jsPDF is intentionally stubbed (vite.config.ts).
      const res = await fetch(`/api/super-admin/account-groups/${groupId}/insights/pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName: group.name,
          dateRangeText,
          generatedText: format(new Date(), "MMM d, yyyy 'at' h:mm a"),
          totals: {
            leads: groupInsights.totals.leads,
            conversations: groupInsights.totals.conversations,
          },
          accountBreakdown: groupInsights.accountBreakdown.map((a) => ({
            businessName: a.businessName,
            leads: a.leads,
            conversations: a.conversations,
          })),
        }),
      });
      if (!res.ok) throw new Error("Failed to generate PDF");

      const blob = await res.blob();
      const fileName = `${group.name.replace(/[^a-zA-Z0-9]/g, "_")}_insights_${format(new Date(), "yyyy-MM-dd")}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "PDF downloaded", description: `${group.name} insights report saved.` });
    } catch (error: any) {
      toast({ title: "PDF export failed", description: error.message || "An unexpected error occurred.", variant: "destructive" });
    }
  };

  const downloadLeadsPDF = async () => {
    if (!groupId || !group) return;
    setIsExportingLeadsPDF(true);
    try {
      const params = new URLSearchParams();
      params.set("export", "true");
      if (effectiveDateRange.from) params.set("fromDate", effectiveDateRange.from.toISOString());
      if (effectiveDateRange.to) params.set("toDate", effectiveDateRange.to.toISOString());

      const res = await fetch(`/api/super-admin/account-groups/${groupId}/leads?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch leads");
      const data = await res.json();
      const allFetchedLeads: { id: string; name: string | null; phone: string | null; email: string | null; businessAccountId: string; businessAccountName: string; topicsOfInterest?: string[] | null; createdAt: string }[] = data.leads || [];

      if (allFetchedLeads.length === 0) {
        toast({ title: "No leads to export", description: "No leads match the current filters.", variant: "destructive" });
        return;
      }

      // Per-account dedup: email (lowercase) → phone → id  (matches Group Analytics + badge logic)
      const byAccount = new Map<string, typeof allFetchedLeads>();
      for (const lead of allFetchedLeads) {
        const acctId = lead.businessAccountId || "__none__";
        if (!byAccount.has(acctId)) byAccount.set(acctId, []);
        byAccount.get(acctId)!.push(lead);
      }
      const deduped: typeof allFetchedLeads = [];
      for (const acctLeads of byAccount.values()) {
        const seen = new Set<string>();
        for (const lead of acctLeads) {
          const email = (lead.email || "").trim().toLowerCase();
          const phone = (lead.phone || "").trim();
          const key = email || phone || String(lead.id);
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(lead);
        }
      }
      // Restore global newest-first order after per-account grouping
      deduped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const totalLeads = deduped.length;
      const totalConversations = groupInsights?.totals.conversations ?? 0;
      const conversionRate = totalConversations > 0
        ? ((totalLeads / totalConversations) * 100).toFixed(1)
        : "0.0";

      const dateRangeText = effectiveDateRange.from && effectiveDateRange.to
        ? `${format(effectiveDateRange.from, "MMMM d, yyyy")} to ${format(effectiveDateRange.to, "MMMM d, yyyy")}`
        : "All time";

      const leadsPayload = deduped.map((lead) => ({
        name: lead.name || "-",
        phone: lead.phone || "-",
        email: lead.email || "-",
        account: lead.businessAccountName || "-",
        source: (lead.topicsOfInterest && Array.isArray(lead.topicsOfInterest) && lead.topicsOfInterest.length > 0)
          ? (lead.topicsOfInterest as string[]).join(", ")
          : "-",
        date: lead.createdAt ? format(new Date(lead.createdAt), "dd MMM yyyy") : "-",
      }));

      // PDF is rendered server-side: the browser jsPDF is intentionally stubbed (vite.config.ts).
      const pdfRes = await fetch(`/api/super-admin/account-groups/${groupId}/leads/pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName: group.name,
          dateRangeText,
          generatedText: format(new Date(), "MMMM d, yyyy 'at' h:mm a"),
          totalLeads,
          totalConversations,
          conversionRate,
          leads: leadsPayload,
        }),
      });
      if (!pdfRes.ok) throw new Error("Failed to generate PDF");

      const blob = await pdfRes.blob();
      const fileName = `${group.name.replace(/[^a-zA-Z0-9]/g, "_")}_leads_${format(new Date(), "yyyy-MM-dd")}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "PDF downloaded", description: `Exported ${totalLeads} unique leads.` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({ title: "PDF export failed", description: message, variant: "destructive" });
    } finally {
      setIsExportingLeadsPDF(false);
    }
  };

  if (!groupId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Invalid group ID</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-background px-4 sm:px-6">
        <SidebarTrigger />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/super-admin/account-groups")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Groups
        </Button>
      </header>

      <main className="p-4 sm:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">
                  {groupLoading ? "Loading..." : group?.name} - Insights
                </h1>
                {group && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setNewGroupName(group.name);
                      setIsRenameDialogOpen(true);
                    }}
                    title="Rename group"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground">
                Aggregated metrics across all {group?.members.length || 0} accounts in this group
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {groupInsights && (
              <Button onClick={downloadPDF} variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                Download PDF
              </Button>
            )}
            <Button onClick={downloadLeadsPDF} disabled={isExportingLeadsPDF || groupLoading || !group} variant="outline" className="gap-2">
              {isExportingLeadsPDF ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Download Leads PDF
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {dateFilterOptions.map((option) => (
              <Button
                key={option.value}
                variant={dateFilter === option.value ? "default" : "outline"}
                size="sm"
                onClick={() => setDateFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {effectiveDateRange.from || effectiveDateRange.to ? (
            <div className="text-sm text-muted-foreground">
              Showing data from{" "}
              <span className="font-medium text-foreground">
                {effectiveDateRange.from ? formatDateIST(effectiveDateRange.from) : "beginning"}
              </span>
              {" to "}
              <span className="font-medium text-foreground">
                {effectiveDateRange.to ? formatDateIST(effectiveDateRange.to) : "now"}
              </span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              Showing all-time data
            </div>
          )}

          {dateFilter === "custom" && (
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-[130px]">
                    <Calendar className="w-4 h-4 mr-2" />
                    {customDateRange.from ? format(customDateRange.from, "MMM d, yyyy") : "Start date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={customDateRange.from}
                    onSelect={(date) => setCustomDateRange(prev => ({ ...prev, from: date }))}
                  />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground">to</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-[130px]">
                    <Calendar className="w-4 h-4 mr-2" />
                    {customDateRange.to ? format(customDateRange.to, "MMM d, yyyy") : "End date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={customDateRange.to}
                    onSelect={(date) => setCustomDateRange(prev => ({ ...prev, to: date }))}
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {insightsLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-muted-foreground">Loading insights...</p>
            </div>
          ) : groupInsights ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-2">
                      <Contact className="w-5 h-5 flex-shrink-0" />
                      <span className="text-sm font-medium">Leads</span>
                    </div>
                    <div className="text-3xl font-bold">{groupInsights.totals.leads}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-2">
                      <MessageSquare className="w-5 h-5 flex-shrink-0" />
                      <span className="text-sm font-medium">Conversations</span>
                    </div>
                    <div className="text-3xl font-bold">{groupInsights.totals.conversations}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-2">
                      <TrendingUp className="w-5 h-5 flex-shrink-0" />
                      <span className="text-sm font-medium">Conversion Rate</span>
                    </div>
                    <div className="text-3xl font-bold">
                      {groupInsights.totals.conversations > 0
                        ? ((groupInsights.totals.leads / groupInsights.totals.conversations) * 100).toFixed(1)
                        : "0"}%
                    </div>
                  </CardContent>
                </Card>
              </div>

              {groupInsights.accountBreakdown.length > 0 && (
                <Card>
                  <CardContent className="pt-6">
                    <h4 className="text-lg font-semibold mb-4">Breakdown by Account</h4>
                    <div className="border rounded-lg overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-3 font-medium whitespace-nowrap">Account</th>
                            <th className="text-center p-3 font-medium whitespace-nowrap">Leads</th>
                            <th className="text-center p-3 font-medium whitespace-nowrap">Chats</th>
                            <th className="text-center p-3 font-medium whitespace-nowrap">Conv. Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupInsights.accountBreakdown.slice().sort((a, b) => b.conversations - a.conversations).map((account) => (
                            <tr key={account.businessAccountId} className="border-t hover:bg-muted/30 transition-colors">
                              <td className="p-3">
                                <div className="flex items-center gap-2 whitespace-nowrap">
                                  <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                  <span>{account.businessName}</span>
                                </div>
                              </td>
                              <td className="text-center p-3 font-medium">{account.leads}</td>
                              <td className="text-center p-3 font-medium">{account.conversations}</td>
                              <td className="text-center p-3 font-medium">
                                {account.conversations > 0
                                  ? ((account.leads / account.conversations) * 100).toFixed(1)
                                  : "0"}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-muted-foreground">No insights data available</p>
            </div>
          )}
        </div>
      </main>

      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Group</DialogTitle>
            <DialogDescription>
              Enter a new name for this account group.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="groupName">Group Name</Label>
              <Input
                id="groupName"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Enter group name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => renameGroupMutation.mutate(newGroupName)}
              disabled={!newGroupName.trim() || renameGroupMutation.isPending}
            >
              {renameGroupMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
