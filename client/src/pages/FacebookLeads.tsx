import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Clock,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Inbox,
  ArrowLeft,
  Facebook,
  Users,
  Search,
} from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface FacebookLead {
  id: string;
  senderId: string;
  senderName: string | null;
  extractedData: Record<string, any> | null;
  status: string;
  receivedAt: string;
  createdAt: string;
}

const parseUTCDate = (d: string) => new Date(d.endsWith('Z') ? d : d + 'Z');

export default function FacebookLeads() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [leadsPage, setLeadsPage] = useState(1);
  const [leadToDelete, setLeadToDelete] = useState<FacebookLead | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const leadsPerPage = 10;

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ["/api/facebook/leads", leadsPage],
    queryFn: async () => {
      const offset = (leadsPage - 1) * leadsPerPage;
      const res = await fetch(`/api/facebook/leads?limit=${leadsPerPage}&offset=${offset}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json() as Promise<{ leads: FacebookLead[]; total: number }>;
    },
  });

  const filteredLeads = useMemo(() => {
    if (!leadsData?.leads) return [];
    return leadsData.leads.filter((lead) => {
      const matchesSearch = !searchQuery ||
        (lead.senderName && lead.senderName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        lead.senderId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (lead.extractedData && JSON.stringify(lead.extractedData).toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [leadsData, searchQuery, statusFilter]);

  const deleteLeadMutation = useMutation({
    mutationFn: async (leadId: string) => {
      await apiRequest("DELETE", `/api/facebook/leads/${leadId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/facebook/leads"] });
      toast({ title: "Lead deleted successfully" });
      setLeadToDelete(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete lead", description: error.message, variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "new":
        return <Badge className="bg-blue-100 text-blue-700 border-0">New</Badge>;
      case "contacted":
        return <Badge className="bg-yellow-100 text-yellow-700 border-0">Contacted</Badge>;
      case "qualified":
        return <Badge className="bg-green-100 text-green-700 border-0">Qualified</Badge>;
      case "converted":
        return <Badge className="bg-purple-100 text-purple-700 border-0">Converted</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 flex items-center gap-4 shadow-sm">
        <SidebarTrigger className="text-white hover:bg-blue-700/50" />
        <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/facebook")} className="gap-1 text-white/80 hover:text-white hover:bg-blue-700/50">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-white/20">
            <Users className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold text-white">Facebook Leads</h1>
        </div>
      </header>

      <div className="p-6">
        <Card className="shadow-lg border-0 rounded-xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-4 bg-gradient-to-r from-blue-50 via-sky-50 to-indigo-50 border-b">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <CardTitle className="text-xl font-semibold tracking-tight">Facebook Leads</CardTitle>
                {leadsData?.total !== undefined && (
                  <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 border-0">
                    {leadsData.total} {leadsData.total === 1 ? 'lead' : 'leads'}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-sm text-muted-foreground">
                Leads captured from Facebook Messenger conversations with AI-extracted information
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex items-center gap-3 px-6 py-4 border-b bg-white">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by name, ID, or extracted data..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px] h-9">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="qualified">Qualified</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {leadsLoading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500 mb-3" />
                <p className="text-sm text-muted-foreground">Loading leads...</p>
              </div>
            ) : !filteredLeads.length ? (
              <div className="flex flex-col items-center justify-center py-20 px-4">
                <div className="rounded-full bg-slate-100 p-5 mb-5">
                  <Inbox className="h-10 w-10 text-slate-400" />
                </div>
                <h3 className="text-base font-semibold text-slate-700 mb-1">
                  {searchQuery || statusFilter !== "all" ? "No matching leads" : "No leads yet"}
                </h3>
                <p className="text-sm text-muted-foreground text-center max-w-sm">
                  {searchQuery || statusFilter !== "all"
                    ? "Try adjusting your search or filter criteria."
                    : "When users interact with your Facebook Messenger, their information will be captured and displayed here."}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/80 hover:bg-slate-50/80 border-b">
                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 pl-6">Received</TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3">Sender</TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3">Extracted Data</TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3">Status</TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 pr-6 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLeads.map((lead) => (
                        <TableRow
                          key={lead.id}
                          className="group hover:bg-slate-50/60 transition-colors border-b last:border-0"
                        >
                          <TableCell className="py-4 pl-6">
                            <div className="flex items-center gap-2">
                              <Clock className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                              <div>
                                <div className="text-sm font-medium text-slate-700">
                                  {format(parseUTCDate(lead.receivedAt), "h:mm a")}
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                  {format(parseUTCDate(lead.receivedAt), "MMM d, yyyy")}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800 truncate">
                                <Facebook className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                                <span>{lead.senderName || lead.senderId}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            <div className="text-sm text-slate-700 max-w-[300px]">
                              {lead.extractedData && Object.keys(lead.extractedData).length > 0 ? (
                                <div className="space-y-0.5">
                                  {Object.entries(lead.extractedData).slice(0, 3).map(([key, value]) => (
                                    <div key={key} className="truncate">
                                      <span className="text-slate-500 text-xs">{key}:</span>{" "}
                                      <span className="text-slate-700 text-xs">{String(value)}</span>
                                    </div>
                                  ))}
                                  {Object.keys(lead.extractedData).length > 3 && (
                                    <span className="text-xs text-slate-400">+{Object.keys(lead.extractedData).length - 3} more</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400 italic text-xs">No data extracted</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-4">
                            {getStatusBadge(lead.status)}
                          </TableCell>
                          <TableCell className="py-4 pr-6">
                            <div className="flex items-center justify-end gap-1">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 rounded-full hover:bg-red-50"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setLeadToDelete(lead);
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4 text-red-400" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent><p>Delete Lead</p></TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {leadsData && leadsData.total > leadsPerPage && (
                  <div className="flex items-center justify-between px-6 py-4 border-t bg-slate-50/50">
                    <p className="text-sm text-slate-500">
                      Showing <span className="font-medium text-slate-700">{((leadsPage - 1) * leadsPerPage) + 1}</span> to <span className="font-medium text-slate-700">{Math.min(leadsPage * leadsPerPage, leadsData.total)}</span> of <span className="font-medium text-slate-700">{leadsData.total}</span> leads
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 rounded-lg text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 disabled:opacity-40"
                        onClick={() => setLeadsPage(p => Math.max(1, p - 1))}
                        disabled={leadsPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Previous
                      </Button>
                      <div className="flex items-center gap-0.5 mx-2">
                        {Array.from({ length: Math.min(Math.ceil(leadsData.total / leadsPerPage), 5) }, (_, i) => {
                          const totalPages = Math.ceil(leadsData.total / leadsPerPage);
                          let pageNum: number;
                          if (totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (leadsPage <= 3) {
                            pageNum = i + 1;
                          } else if (leadsPage >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                          } else {
                            pageNum = leadsPage - 2 + i;
                          }
                          return (
                            <Button
                              key={pageNum}
                              variant={pageNum === leadsPage ? "default" : "ghost"}
                              size="sm"
                              className={`h-8 w-8 p-0 rounded-lg text-sm ${
                                pageNum === leadsPage
                                  ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                                  : "text-slate-600 hover:bg-slate-200/60"
                              }`}
                              onClick={() => setLeadsPage(pageNum)}
                            >
                              {pageNum}
                            </Button>
                          );
                        })}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 rounded-lg text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 disabled:opacity-40"
                        onClick={() => setLeadsPage(p => p + 1)}
                        disabled={leadsPage >= Math.ceil(leadsData.total / leadsPerPage)}
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!leadToDelete} onOpenChange={() => setLeadToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this lead. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => leadToDelete && deleteLeadMutation.mutate(leadToDelete.id)}
              className="bg-red-500 hover:bg-red-600"
            >
              {deleteLeadMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}