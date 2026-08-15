import { useState, useMemo, useEffect, useRef } from "react";
import { formatCrmSyncError } from "@/lib/crmSyncError";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import WebsiteNavTabs from "@/components/WebsiteNavTabs";
import { type Lead } from "@shared/schema";
import { FormSubmissionDetails } from "@/components/FormSubmissionDetails";
import type { MeResponseDto } from "@shared/dto";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Download, Contact, Mail, Phone, MessageSquare, Calendar, User, Eye, ChevronLeft, ChevronRight, Search, X, CheckCircle2, XCircle, RefreshCw, Loader2, Users, GitBranch, MoreVertical, MapPin, Trash2, Upload, Info, Copy, Bot, Sparkles, Image as ImageIcon, FileText, Filter, Ban } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";

import { format, subDays, startOfDay, endOfDay } from "date-fns";
import * as XLSX from "xlsx";

type DatePreset = 'all' | 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';


interface ConversationDetail {
  id: string;
  title: string;
  visitorCity: string | null;
  summary: string | null;
  topicKeywords: string | null;
  createdAt: string;
}

interface MessageItem {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  imageUrl: string | null;
  createdAt: string;
}

function friendlySyncError(error: string | null | undefined): string {
  return formatCrmSyncError(error);
}

export default function AdminLeads() {
  const { toast } = useToast();
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const prevFiltersRef = useRef({ datePreset, fromDate, toDate, searchQuery });
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [syncAllDialogOpen, setSyncAllDialogOpen] = useState(false);
  const [selectedLeadDetails, setSelectedLeadDetails] = useState<Lead | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [chatDialogConversationId, setChatDialogConversationId] = useState<string | null>(null);
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [formDialogLead, setFormDialogLead] = useState<Lead | null>(null);
  const [journeyDialogOpen, setJourneyDialogOpen] = useState(false);
  const [journeyDialogLeadId, setJourneyDialogLeadId] = useState<string | null>(null);

  // Get current user to check if SuperAdmin (only SuperAdmins can delete leads)
  const { data: currentUser } = useQuery<MeResponseDto>({
    queryKey: ["/api/auth/me"],
  });
  const isSuperAdminImpersonating = currentUser?.role === "super_admin" && !!currentUser?.activeBusinessAccountId;

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    
    let from: Date | undefined;
    let to: Date | undefined;
    
    const today = startOfDay(new Date());
    
    switch (datePreset) {
      case 'all':
        break;
      case 'today':
        from = today;
        to = endOfDay(today);
        break;
      case 'yesterday':
        const yesterday = subDays(today, 1);
        from = yesterday;
        to = endOfDay(yesterday);
        break;
      case 'last7':
        from = subDays(today, 7);
        to = endOfDay(today);
        break;
      case 'last30':
        from = subDays(today, 30);
        to = endOfDay(today);
        break;
      case 'custom':
        from = fromDate ? startOfDay(fromDate) : undefined;
        to = toDate ? endOfDay(toDate) : undefined;
        break;
    }
    
    if (from) params.append('fromDate', from.toISOString());
    if (to) params.append('toDate', to.toISOString());
    const trimmedSearch = searchQuery.trim();
    if (trimmedSearch) params.append('search', trimmedSearch);
    params.append('page', currentPage.toString());
    params.append('limit', itemsPerPage.toString());
    
    return params.toString() ? `?${params.toString()}` : '';
  }, [datePreset, fromDate, toDate, searchQuery, currentPage]);

  const { data, isLoading } = useQuery<{ leads: Lead[]; total: number }>({
    queryKey: ["/api/leads", queryParams],
    queryFn: async () => {
      const response = await fetch(`/api/leads${queryParams}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch leads");
      }
      return response.json();
    },
  });

  const leads = data?.leads || [];
  const totalPages = Math.ceil((data?.total || 0) / itemsPerPage);


  const { data: chatDialogConversation, isLoading: loadingChatDialogConversation } = useQuery<ConversationDetail>({
    queryKey: ["/api/conversations", chatDialogConversationId, "details"],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/${chatDialogConversationId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch conversation");
      return res.json();
    },
    enabled: !!chatDialogConversationId && chatDialogOpen,
  });

  const { data: chatDialogMessages = [], isLoading: loadingChatDialogMessages } = useQuery<MessageItem[]>({
    queryKey: ["/api/conversations", chatDialogConversationId, "dialog-messages"],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/${chatDialogConversationId}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!chatDialogConversationId && chatDialogOpen,
  });

  const { data: journeyDialogData, isLoading: loadingJourneyDialog } = useQuery<{
    journeyName: string | null;
    completed: boolean;
    responses: Array<{ question: string; answer: string; stepOrder: number }>;
  }>({
    queryKey: ["/api/leads", journeyDialogLeadId, "journey-responses"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${journeyDialogLeadId}/journey-responses`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch journey responses");
      return res.json();
    },
    enabled: !!journeyDialogLeadId && journeyDialogOpen,
  });

  const formatMsgTime = (dateString: string) => {
    const date = new Date(dateString);
    return format(date, 'MMM d, h:mm a');
  };

  // Reset to page 1 only when filters actually change (not on background refetches)
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const hasChanged = 
      prev.datePreset !== datePreset ||
      prev.fromDate !== fromDate ||
      prev.toDate !== toDate ||
      prev.searchQuery !== searchQuery;
    
    if (hasChanged) {
      setCurrentPage(1);
      prevFiltersRef.current = { datePreset, fromDate, toDate, searchQuery };
    }
  }, [datePreset, fromDate, toDate, searchQuery]);

  // Clamp currentPage to totalPages when results change, reset to page 1 if no results
  useEffect(() => {
    if (data === undefined) return;
    
    if (totalPages === 0 && currentPage !== 1) {
      setCurrentPage(1);
    } else if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [data, totalPages, currentPage]);

  // Sync lead to LeadSquared mutation
  const syncLeadMutation = useMutation({
    mutationFn: async (leadId: string) => {
      return await apiRequest("POST", `/api/leadsquared/sync-lead/${leadId}`);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"], exact: false });
      toast({
        title: "Sync Successful",
        description: data.message || "Lead synced to LeadSquared successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync lead to LeadSquared",
        variant: "destructive",
      });
    },
  });

  const handleSyncLead = (leadId: string) => {
    syncLeadMutation.mutate(leadId);
  };

  const deleteLeadMutation = useMutation({
    mutationFn: async (leadId: string) => {
      return await apiRequest("DELETE", `/api/leads/${leadId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"], exact: false });
      toast({
        title: "Lead Deleted",
        description: "Lead has been deleted successfully",
      });
      setDeleteDialogOpen(false);
      setLeadToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete lead",
        variant: "destructive",
      });
    },
  });

  const handleDeleteLead = (lead: Lead) => {
    setLeadToDelete(lead);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteLead = () => {
    if (leadToDelete) {
      deleteLeadMutation.mutate(leadToDelete.id);
    }
  };

  // Check if LeadSquared integration is enabled
  const { data: leadsquaredSettings } = useQuery<{ enabled: boolean; hasCredentials: boolean }>({
    queryKey: ["/api/leadsquared/settings"],
    queryFn: async () => {
      const response = await fetch("/api/leadsquared/settings", {
        credentials: "include",
      });
      if (!response.ok) {
        return { enabled: false, hasCredentials: false };
      }
      return response.json();
    },
  });

  const isLeadsquaredConfigured = leadsquaredSettings?.enabled && leadsquaredSettings?.hasCredentials;

  // Check if Salesforce integration is enabled
  const { data: salesforceSettings } = useQuery<{ enabled: boolean; hasCredentials: boolean }>({
    queryKey: ["/api/salesforce/settings"],
    queryFn: async () => {
      const response = await fetch("/api/salesforce/settings", { credentials: "include" });
      if (!response.ok) return { enabled: false, hasCredentials: false };
      return response.json();
    },
  });

  const isSalesforceConfigured = salesforceSettings?.enabled && salesforceSettings?.hasCredentials;

  // Sync lead to Salesforce mutation
  const sfSyncLeadMutation = useMutation({
    mutationFn: async (leadId: string) => {
      return await apiRequest("POST", `/api/salesforce/sync-lead/${leadId}`);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"], exact: false });
      toast({ title: "Synced to Salesforce", description: data.message || "Lead synced to Salesforce successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Salesforce Sync Failed", description: error.message || "Failed to sync lead to Salesforce", variant: "destructive" });
    },
  });

  // Sync all leads to LeadSquared mutation
  const syncAllMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/leadsquared/sync-all");
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"], exact: false });
      setSyncAllDialogOpen(false);
      toast({
        title: "Sync Complete",
        description: data.message || `Synced ${data.synced} leads to LeadSquared`,
      });
    },
    onError: (error: any) => {
      setSyncAllDialogOpen(false);
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync leads to LeadSquared",
        variant: "destructive",
      });
    },
  });

  const handleSyncAll = () => {
    setSyncAllDialogOpen(true);
  };

  const confirmSyncAll = () => {
    syncAllMutation.mutate();
  };

  const handleViewConversation = (conversationId: string) => {
    setChatDialogConversationId(conversationId);
    setChatDialogOpen(true);
  };

  const handleExport = async () => {
    try {
      // Build filter params (same as pagination query)
      const exportParams = new URLSearchParams();
      
      let from: Date | undefined;
      let to: Date | undefined;
      const today = startOfDay(new Date());
      
      switch (datePreset) {
        case 'today':
          from = today;
          to = endOfDay(today);
          break;
        case 'yesterday':
          const yesterday = subDays(today, 1);
          from = yesterday;
          to = endOfDay(yesterday);
          break;
        case 'last7':
          from = subDays(today, 7);
          to = endOfDay(today);
          break;
        case 'last30':
          from = subDays(today, 30);
          to = endOfDay(today);
          break;
        case 'custom':
          from = fromDate ? startOfDay(fromDate) : undefined;
          to = toDate ? endOfDay(toDate) : undefined;
          break;
      }
      
      if (from) exportParams.append('fromDate', from.toISOString());
      if (to) exportParams.append('toDate', to.toISOString());
      const trimmedSearch = searchQuery.trim();
      if (trimmedSearch) exportParams.append('search', trimmedSearch);
      
      const exportQueryString = exportParams.toString() ? `?${exportParams.toString()}` : '';
      
      // Fetch leads using dedicated export endpoint with filters
      const response = await fetch(`/api/leads/export${exportQueryString}`, {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Failed to fetch leads for export");
      }
      
      const exportData = await response.json();
      const allLeads = exportData.leads || [];
      
      if (allLeads.length === 0) {
        toast({
          title: "No leads to export",
          description: "There are no leads available to export.",
          variant: "destructive",
        });
        return;
      }

      // Prepare data for Excel export
      const worksheetData = allLeads.map((lead: Lead) => ({
        Name: lead.name,
        Email: lead.email,
        Phone: lead.phone || "",
        City: lead.city || "",
        Message: lead.message || "",
        "Created At": format(new Date(lead.createdAt), "yyyy-MM-dd HH:mm:ss")
      }));

      // Create workbook and worksheet
      const worksheet = XLSX.utils.json_to_sheet(worksheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");

      // Set column widths for better readability
      worksheet["!cols"] = [
        { wch: 20 }, // Name
        { wch: 30 }, // Email
        { wch: 15 }, // Phone
        { wch: 15 }, // City
        { wch: 40 }, // Message
        { wch: 20 }, // Created At
      ];

      // Generate Excel file and trigger download
      const filename = `leads-${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      XLSX.writeFile(workbook, filename);

      toast({
        title: "Export successful",
        description: `Exported ${allLeads.length} leads to Excel file.`,
      });
    } catch (error: any) {
      toast({
        title: "Export failed",
        description: error.message || "Failed to export leads",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <WebsiteNavTabs />
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Contact className="w-6 h-6 text-purple-600" />
                Leads Management
              </CardTitle>
              <CardDescription>View and export captured leads from conversations</CardDescription>
            </div>
              <div className="flex gap-2">
                {isLeadsquaredConfigured && (
                  <Button 
                    onClick={handleSyncAll} 
                    disabled={(data?.total || 0) === 0 || syncAllMutation.isPending} 
                    variant="outline"
                    className="border-green-500 text-green-600 hover:bg-green-50"
                  >
                    {syncAllMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-2" />
                    )}
                    Sync All to CRM
                  </Button>
                )}
                <Button onClick={handleExport} disabled={(data?.total || 0) === 0} data-testid="button-export-leads" className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
                  <Download className="h-4 w-4 mr-2" />
                  Export All ({data?.total || 0})
                </Button>
              </div>
          </div>
        </CardHeader>
        <CardContent>
          <div>
          {/* Search and Filter Controls */}
          <div className="mb-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Search Input */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search leads by name, email, phone, or message..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-10"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 hover:bg-gray-100"
                  >
                    <X className="h-4 w-4 text-gray-400" />
                  </Button>
                )}
              </div>

              {/* Date Filter Buttons */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant={datePreset === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDatePreset('all')}
                  className={datePreset === 'all' ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700' : ''}
                >
                  All Time
                </Button>
                <Button
                  variant={datePreset === 'today' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDatePreset('today')}
                  className={datePreset === 'today' ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700' : ''}
                >
                  Today
                </Button>
                <Button
                  variant={datePreset === 'last7' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDatePreset('last7')}
                  className={datePreset === 'last7' ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700' : ''}
                >
                  Last 7 Days
                </Button>
                <Button
                  variant={datePreset === 'last30' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDatePreset('last30')}
                  className={datePreset === 'last30' ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700' : ''}
                >
                  Last 30 Days
                </Button>

                {/* Custom Date Range */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={datePreset === 'custom' ? 'default' : 'outline'}
                      size="sm"
                      className={datePreset === 'custom' ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700' : ''}
                    >
                      <Calendar className="h-4 w-4 mr-2" />
                      Custom Range
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <div className="p-4 space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">From Date</label>
                        <CalendarComponent
                          mode="single"
                          selected={fromDate}
                          onSelect={(date) => {
                            setFromDate(date);
                            setDatePreset('custom');
                          }}
                          initialFocus
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">To Date</label>
                        <CalendarComponent
                          mode="single"
                          selected={toDate}
                          onSelect={(date) => {
                            setToDate(date);
                            setDatePreset('custom');
                          }}
                        />
                      </div>
                      {(fromDate || toDate) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setFromDate(undefined);
                            setToDate(undefined);
                            setDatePreset('all');
                          }}
                          className="w-full"
                        >
                          Clear Dates
                        </Button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Active Filters Display */}
            {(searchQuery || datePreset !== 'all') && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-medium">Active filters:</span>
                {searchQuery && (
                  <Badge variant="secondary" className="gap-1">
                    <Search className="h-3 w-3" />
                    "{searchQuery}"
                  </Badge>
                )}
                {datePreset !== 'all' && (
                  <Badge variant="secondary" className="gap-1">
                    <Calendar className="h-3 w-3" />
                    {datePreset === 'today' && 'Today'}
                    {datePreset === 'yesterday' && 'Yesterday'}
                    {datePreset === 'last7' && 'Last 7 Days'}
                    {datePreset === 'last30' && 'Last 30 Days'}
                    {datePreset === 'custom' && (
                      <>
                        {fromDate ? format(fromDate, 'MMM d, yyyy') : '...'}
                        {' → '}
                        {toDate ? format(toDate, 'MMM d, yyyy') : '...'}
                      </>
                    )}
                  </Badge>
                )}
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-sm text-muted-foreground">Loading leads...</p>
              </div>
            </div>
          ) : leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center mb-4">
                <Contact className="w-10 h-10 text-purple-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No leads yet</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Leads will appear here when users provide their contact information through the AI chat.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-purple-50 to-blue-50 hover:from-purple-50 hover:to-blue-50">
                    <TableHead className="font-semibold text-gray-900 w-[180px] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-purple-600" />
                        Name
                      </div>
                    </TableHead>
                    <TableHead className="font-semibold text-gray-900 w-[140px] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-green-600" />
                        Phone
                      </div>
                    </TableHead>
                    <TableHead className="font-semibold text-gray-900 w-[100px] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-red-500" />
                        City
                      </div>
                    </TableHead>
                    <TableHead className="font-semibold text-gray-900 w-[180px] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-purple-600" />
                        Topics of Interest
                      </div>
                    </TableHead>
                    <TableHead className="font-semibold text-gray-900 w-[120px] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-indigo-600" />
                        Funnel
                      </div>
                    </TableHead>
                    <TableHead className="font-semibold text-gray-900 w-[90px] px-2 py-3">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-blue-600" />
                        {isSalesforceConfigured && <span className="text-xs font-normal text-muted-foreground">LSQ·SF</span>}
                      </div>
                    </TableHead>
                    <TableHead className="text-center font-semibold text-gray-900 w-[50px] px-2 py-3"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead: Lead, index: number) => {
                    const getInitials = (name: string | null) => {
                      if (!name) return "?";
                      return name
                        .split(" ")
                        .map(n => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2);
                    };

                    const getAvatarColor = (name: string | null) => {
                      if (!name) return "bg-gray-500";
                      const colors = [
                        "bg-gradient-to-br from-purple-500 to-purple-600",
                        "bg-gradient-to-br from-blue-500 to-blue-600",
                        "bg-gradient-to-br from-green-500 to-green-600",
                        "bg-gradient-to-br from-orange-500 to-orange-600",
                        "bg-gradient-to-br from-pink-500 to-pink-600",
                        "bg-gradient-to-br from-indigo-500 to-indigo-600",
                      ];
                      const index = name.charCodeAt(0) % colors.length;
                      return colors[index];
                    };

                    return (
                      <TableRow key={lead.id} className="group hover:bg-purple-50/50 transition-colors">
                        <TableCell className="font-medium px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-3">
                              <Avatar className={`h-9 w-9 flex-shrink-0 ${getAvatarColor(lead.name)}`}>
                                <AvatarFallback className="text-white font-semibold bg-transparent text-sm">
                                  {getInitials(lead.name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-gray-900 font-medium truncate max-w-[120px]">{lead.name || "Anonymous"}</span>
                            </div>
                            <span className="text-xs text-gray-400 pl-12">{format(new Date(lead.createdAt), "MMM d, h:mm a")}</span>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {lead.phone ? (
                            <a 
                              href={`tel:${lead.phone}`}
                              className="text-sm text-green-600 hover:text-green-700 hover:underline transition-colors font-mono"
                            >
                              {lead.phone}
                            </a>
                          ) : (
                            <span className="text-gray-400 text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {lead.city ? (
                            <span className="text-sm text-gray-600">{lead.city}</span>
                          ) : (
                            <span className="text-gray-400 text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {(() => {
                            const funnelValues = ['Via Form', 'Via Journey Form', 'Discount Availed'];
                            const topics = (lead.topicsOfInterest && Array.isArray(lead.topicsOfInterest))
                              ? (lead.topicsOfInterest as string[]).filter(t => !funnelValues.includes(t))
                              : [];
                            if (topics.length > 0) {
                              const colors = [
                                'bg-purple-100 text-purple-700',
                                'bg-blue-100 text-blue-700',
                                'bg-green-100 text-green-700',
                                'bg-orange-100 text-orange-700'
                              ];
                              return (
                                <div className="flex flex-wrap gap-1">
                                  {topics.slice(0, 4).map((topic, i) => (
                                    <span key={i} className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[i % colors.length]}`}>
                                      {topic}
                                    </span>
                                  ))}
                                </div>
                              );
                            }
                            return lead.message
                              ? <span className="text-sm text-gray-500 italic">{lead.message}</span>
                              : <span className="text-gray-400 text-sm">—</span>;
                          })()}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {(() => {
                            const allTopics = (lead.topicsOfInterest && Array.isArray(lead.topicsOfInterest)) ? lead.topicsOfInterest as string[] : [];
                            if (allTopics.includes('Discount Availed')) {
                              return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">Discount Availed</span>;
                            } else if (allTopics.includes('Via Form')) {
                              return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Via Form</span>;
                            } else if (allTopics.includes('Via Journey Form')) {
                              return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">Via Journey</span>;
                            }
                            return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">Via Chat</span>;
                          })()}
                        </TableCell>
                        <TableCell className="px-2 py-3">
                          <div className="flex items-center gap-1.5">
                            {/* LeadSquared sync status */}
                            {lead.leadsquaredSyncStatus === 'synced' ? (
                              <div className="text-green-600" title="Synced to LeadSquared"><CheckCircle2 className="h-3.5 w-3.5" /></div>
                            ) : lead.leadsquaredSyncStatus === 'disqualified' ? (
                              <div className="text-amber-600 cursor-help" title={`Not qualified for LeadSquared: ${lead.leadsquaredSyncError || 'answer did not match the configured qualifying values'}`}><Ban className="h-3.5 w-3.5" /></div>
                            ) : lead.leadsquaredSyncStatus === 'failed' ? (
                              <div className="text-red-600 cursor-help" title={`LeadSquared: ${friendlySyncError(lead.leadsquaredSyncError)}`}><XCircle className="h-3.5 w-3.5" /></div>
                            ) : syncLeadMutation.isPending && syncLeadMutation.variables === lead.id ? (
                              <div className="text-blue-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /></div>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                            {/* Salesforce sync status (only if configured) */}
                            {isSalesforceConfigured && (
                              lead.salesforceSyncStatus === 'synced' ? (
                                <div className="text-blue-500" title="Synced to Salesforce"><CheckCircle2 className="h-3.5 w-3.5" /></div>
                              ) : lead.salesforceSyncStatus === 'failed' ? (
                                <div className="text-red-600 cursor-help" title={`Salesforce: ${lead.salesforceSyncError || 'Sync failed'}`}><XCircle className="h-3.5 w-3.5" /></div>
                              ) : sfSyncLeadMutation.isPending && sfSyncLeadMutation.variables === lead.id ? (
                                <div className="text-blue-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /></div>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center px-2 py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-gray-400 hover:text-gray-600"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem 
                                onClick={() => {
                                  setSelectedLeadDetails(lead);
                                  setDetailsDialogOpen(true);
                                }}
                                className="cursor-pointer"
                              >
                                <Info className="h-4 w-4 mr-2 text-blue-600" />
                                View Details
                              </DropdownMenuItem>
                              {(() => {
                                const topics = (lead.topicsOfInterest || []).map((t: string) => t.toLowerCase());
                                const isJourney = topics.some((t: string) => t.includes('journey'));
                                const isForm = !isJourney && topics.some((t: string) => t.includes('via form'));
                                if (isForm) {
                                  return (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setFormDialogLead(lead);
                                        setFormDialogOpen(true);
                                      }}
                                      className="cursor-pointer"
                                    >
                                      <FileText className="h-4 w-4 mr-2 text-green-600" />
                                      View Form
                                    </DropdownMenuItem>
                                  );
                                }
                                if (isJourney) {
                                  return (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setJourneyDialogLeadId(lead.id);
                                        setJourneyDialogOpen(true);
                                      }}
                                      className="cursor-pointer"
                                    >
                                      <GitBranch className="h-4 w-4 mr-2 text-orange-600" />
                                      View Journey
                                    </DropdownMenuItem>
                                  );
                                }
                                if (lead.conversationId) {
                                  return (
                                    <DropdownMenuItem
                                      onClick={() => handleViewConversation(lead.conversationId!)}
                                      className="cursor-pointer"
                                    >
                                      <Eye className="h-4 w-4 mr-2 text-purple-600" />
                                      View Chat
                                    </DropdownMenuItem>
                                  );
                                }
                                return null;
                              })()}
                              {isLeadsquaredConfigured && (lead.leadsquaredSyncStatus === 'failed' || !lead.leadsquaredSyncStatus) && (
                                <DropdownMenuItem 
                                  onClick={() => handleSyncLead(lead.id)}
                                  disabled={syncLeadMutation.isPending}
                                  className="cursor-pointer"
                                >
                                  <RefreshCw className={`h-4 w-4 mr-2 text-blue-600 ${syncLeadMutation.isPending && syncLeadMutation.variables === lead.id ? 'animate-spin' : ''}`} />
                                  {lead.leadsquaredSyncStatus === 'failed' ? 'Retry LSQ Sync' : 'Sync to LeadSquared'}
                                </DropdownMenuItem>
                              )}
                              {isSalesforceConfigured && (lead.salesforceSyncStatus === 'failed' || !lead.salesforceSyncStatus) && (
                                <DropdownMenuItem
                                  onClick={() => sfSyncLeadMutation.mutate(lead.id)}
                                  disabled={sfSyncLeadMutation.isPending}
                                  className="cursor-pointer"
                                >
                                  <RefreshCw className={`h-4 w-4 mr-2 text-blue-500 ${sfSyncLeadMutation.isPending && sfSyncLeadMutation.variables === lead.id ? 'animate-spin' : ''}`} />
                                  {lead.salesforceSyncStatus === 'failed' ? 'Retry SF Sync' : 'Sync to Salesforce'}
                                </DropdownMenuItem>
                              )}
                              {isSuperAdminImpersonating && (
                                <DropdownMenuItem 
                                  onClick={() => handleDeleteLead(lead)}
                                  className="cursor-pointer text-red-600 focus:text-red-600"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete Lead
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-gray-200">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <span className="text-sm text-gray-600 font-medium">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
          </div>
        </CardContent>
      </Card>

      {/* Delete Lead Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this lead? This action cannot be undone.
              {leadToDelete && (
                <div className="mt-2 p-3 bg-gray-50 rounded-md">
                  <div className="text-sm">
                    <strong>Name:</strong> {leadToDelete.name || 'N/A'}
                  </div>
                  <div className="text-sm">
                    <strong>Email:</strong> {leadToDelete.email || 'N/A'}
                  </div>
                  <div className="text-sm">
                    <strong>Phone:</strong> {leadToDelete.phone || 'N/A'}
                  </div>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLeadMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDeleteLead}
              disabled={deleteLeadMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteLeadMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sync All to CRM Confirmation Dialog */}
      <AlertDialog open={syncAllDialogOpen} onOpenChange={setSyncAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sync All Leads to CRM</AlertDialogTitle>
            <AlertDialogDescription>
              This will sync all unsynced leads to your LeadSquared CRM account. Leads that are already synced will be skipped.
              <div className="mt-2 p-3 bg-blue-50 rounded-md text-blue-700 text-sm">
                This may take a few moments depending on the number of leads.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={syncAllMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmSyncAll}
              disabled={syncAllMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {syncAllMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                'Sync All'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lead Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[60vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-600" />
              Lead Details
            </DialogTitle>
            <DialogDescription>
              Complete information about this lead
            </DialogDescription>
          </DialogHeader>
          {selectedLeadDetails && (
            <div className="space-y-4 py-2">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">Contact Information</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Name:</span>
                    <p className="font-medium">{selectedLeadDetails.name || '—'}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Email:</span>
                    <p className="font-medium">{selectedLeadDetails.email || '—'}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Phone:</span>
                    <p className="font-medium">{selectedLeadDetails.phone || '—'}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">City:</span>
                    <p className="font-medium">{selectedLeadDetails.city || '—'}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">Source Information</h4>
                <div className="space-y-2 text-sm">
                  {selectedLeadDetails.sourceUrl && (
                    <div>
                      <span className="text-gray-500">Page URL:</span>
                      <p className="font-medium text-xs break-all text-blue-600">{selectedLeadDetails.sourceUrl}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-gray-500">Created:</span>
                    <p className="font-medium">{format(new Date(selectedLeadDetails.createdAt), "PPpp")}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">LeadSquared Sync</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">Status:</span>
                    {selectedLeadDetails.leadsquaredSyncStatus === 'synced' ? (
                      <Badge className="bg-green-100 text-green-700">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Synced
                      </Badge>
                    ) : selectedLeadDetails.leadsquaredSyncStatus === 'disqualified' ? (
                      <Badge className="bg-amber-100 text-amber-800">
                        <Ban className="h-3 w-3 mr-1" />
                        Not Qualified
                      </Badge>
                    ) : selectedLeadDetails.leadsquaredSyncStatus === 'failed' ? (
                      <Badge className="bg-red-100 text-red-700">
                        <XCircle className="h-3 w-3 mr-1" />
                        Failed
                      </Badge>
                    ) : (
                      <Badge className="bg-gray-100 text-gray-600">Not Synced</Badge>
                    )}
                  </div>
                  {selectedLeadDetails.leadsquaredSyncStatus === 'disqualified' && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      This lead was not sent to LeadSquared because{' '}
                      {selectedLeadDetails.leadsquaredSyncError || 'its answer did not match the configured qualifying values'}.
                    </p>
                  )}
                  {selectedLeadDetails.leadsquaredLeadId && (
                    <div>
                      <span className="text-gray-500">LeadSquared ID:</span>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">
                          {selectedLeadDetails.leadsquaredLeadId}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => {
                            navigator.clipboard.writeText(selectedLeadDetails.leadsquaredLeadId || '');
                            toast({
                              title: "Copied!",
                              description: "LeadSquared ID copied to clipboard",
                            });
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                  {selectedLeadDetails.leadsquaredSyncedAt && (
                    <div>
                      <span className="text-gray-500">Synced At:</span>
                      <p className="font-medium">{format(new Date(selectedLeadDetails.leadsquaredSyncedAt), "PPpp")}</p>
                    </div>
                  )}
                  {selectedLeadDetails.leadsquaredSyncError && (
                    <div>
                      <span className="text-gray-500">Error:</span>
                      <p className="text-red-600 text-sm mt-1 bg-red-50 p-3 rounded">{friendlySyncError(selectedLeadDetails.leadsquaredSyncError)}</p>
                      {friendlySyncError(selectedLeadDetails.leadsquaredSyncError) !== selectedLeadDetails.leadsquaredSyncError && (
                        <p className="text-gray-400 text-[10px] mt-1 italic">Technical: {selectedLeadDetails.leadsquaredSyncError}</p>
                      )}
                    </div>
                  )}
                  {(() => {
                    const payload = selectedLeadDetails.leadsquaredSyncPayload;
                    if (!payload || typeof payload !== 'object') return null;
                    const entries = Object.entries(payload as Record<string, unknown>);
                    if (entries.length === 0) return null;
                    return (
                      <div className="mt-3">
                        <span className="text-gray-500 block mb-2">Synced Fields:</span>
                        <div className="bg-gray-50 rounded-md p-3 space-y-1.5 max-h-48 overflow-y-auto">
                          {entries.map(([key, value]) => {
                            const strVal = value != null ? String(value) : '—';
                            const isUrl = strVal.startsWith('http://') || strVal.startsWith('https://');
                            return (
                              <div key={key} className="flex text-xs">
                                <span className="text-gray-600 font-mono min-w-[140px] flex-shrink-0">{key}:</span>
                                {isUrl ? (
                                  <a
                                    href={strVal}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline break-all"
                                  >
                                    {strVal}
                                  </a>
                                ) : (
                                  <span className="text-gray-800 break-all">{strVal}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {selectedLeadDetails.topicsOfInterest && selectedLeadDetails.topicsOfInterest.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">Topics of Interest</h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedLeadDetails.topicsOfInterest.map((topic, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">{topic}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">Internal IDs</h4>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-gray-500">Lead ID:</span>
                    <code className="ml-2 bg-gray-100 px-2 py-0.5 rounded font-mono">{selectedLeadDetails.id}</code>
                  </div>
                  {selectedLeadDetails.conversationId && (
                    <div>
                      <span className="text-gray-500">Conversation ID:</span>
                      <code className="ml-2 bg-gray-100 px-2 py-0.5 rounded font-mono">{selectedLeadDetails.conversationId}</code>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={chatDialogOpen} onOpenChange={(open) => { setChatDialogOpen(open); if (!open) setChatDialogConversationId(null); }}>
        <DialogContent className="max-w-2xl w-full max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Bot className="w-4 h-4 text-purple-600" />
              {loadingChatDialogConversation ? (
                <span className="text-gray-400">Loading conversation...</span>
              ) : chatDialogConversation ? (
                <span>{chatDialogConversation.title || 'Conversation'}</span>
              ) : null}
            </DialogTitle>
            {chatDialogConversation && (
              <p className="text-xs text-gray-500 mt-0.5">
                {chatDialogConversation.visitorCity && <span>{chatDialogConversation.visitorCity} · </span>}
                {format(new Date(chatDialogConversation.createdAt), 'MMM d, yyyy h:mm a')}
              </p>
            )}
            <DialogDescription className="sr-only">Chat conversation history</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
            {(loadingChatDialogConversation || loadingChatDialogMessages) ? (
              <div className="flex justify-center items-center py-16">
                <div className="w-7 h-7 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {chatDialogConversation?.summary && (
                  <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-b border-purple-100 px-5 py-4">
                    <div className="flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 leading-relaxed">{chatDialogConversation.summary}</p>
                        {chatDialogConversation.topicKeywords && (() => {
                          try {
                            const keywords = JSON.parse(chatDialogConversation.topicKeywords!);
                            if (Array.isArray(keywords) && keywords.length > 0) {
                              return (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {keywords.map((kw: string, i: number) => (
                                    <span key={i} className="px-2 py-0.5 text-xs font-medium rounded-full bg-white text-purple-700 border border-purple-200">
                                      {kw}
                                    </span>
                                  ))}
                                </div>
                              );
                            }
                            return null;
                          } catch { return null; }
                        })()}
                      </div>
                    </div>
                  </div>
                )}

                <div className="p-4 space-y-4">
                  {chatDialogMessages.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-8">No messages in this conversation</p>
                  ) : (
                    chatDialogMessages.map((message) => (
                      <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {message.role === 'assistant' && (
                          <div className="flex items-start gap-3 max-w-[85%]">
                            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                              <Bot className="w-5 h-5 text-white" />
                            </div>
                            <div>
                              <Card className="bg-white shadow-sm">
                                <CardContent className="p-4">
                                  <div className="prose prose-sm max-w-none">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}
                                      components={{
                                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                        ul: ({ children }) => <ul className="mb-2 pl-4 list-disc">{children}</ul>,
                                        ol: ({ children }) => <ol className="mb-2 pl-4 list-decimal">{children}</ol>,
                                        li: ({ children }) => <li className="mb-1">{children}</li>,
                                        code: ({ className, children }) => {
                                          const isInline = !className;
                                          return isInline ? (
                                            <code className="px-1.5 py-0.5 bg-gray-100 rounded text-sm">{children}</code>
                                          ) : (
                                            <code className={className}>{children}</code>
                                          );
                                        }
                                      }}
                                    >
                                      {message.content}
                                    </ReactMarkdown>
                                  </div>
                                </CardContent>
                              </Card>
                              <p className="text-xs text-gray-500 mt-1 ml-1">{formatMsgTime(message.createdAt)}</p>
                            </div>
                          </div>
                        )}
                        {message.role === 'user' && (
                          <div className="flex flex-col items-end max-w-[85%]">
                            <div className="px-4 py-3 rounded-2xl text-white shadow-sm" style={{ background: 'linear-gradient(to right, #8B5CF6, #3B82F6)' }}>
                              {message.imageUrl && (
                                <div className="mb-2">
                                  <div className="flex items-center gap-1 text-xs text-white/80 mb-1">
                                    <ImageIcon className="w-3 h-3" />
                                    <span>Image search</span>
                                  </div>
                                  <img src={message.imageUrl} alt="User uploaded" className="w-full max-w-[200px] rounded-lg border border-white/20" />
                                </div>
                              )}
                              <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                            </div>
                            <p className="text-xs text-gray-500 mt-1 mr-1">{formatMsgTime(message.createdAt)}</p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={formDialogOpen} onOpenChange={(open) => { setFormDialogOpen(open); if (!open) setFormDialogLead(null); }}>
        <DialogContent className="max-w-md w-full max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="w-4 h-4 text-green-600" />
              Form Submission
            </DialogTitle>
            <DialogDescription>Data captured via lead form</DialogDescription>
          </DialogHeader>
          {formDialogLead && <FormSubmissionDetails lead={formDialogLead} />}
        </DialogContent>
      </Dialog>

      <Dialog open={journeyDialogOpen} onOpenChange={(open) => { setJourneyDialogOpen(open); if (!open) setJourneyDialogLeadId(null); }}>
        <DialogContent className="max-w-lg w-full max-h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <GitBranch className="w-4 h-4 text-orange-600" />
              {loadingJourneyDialog ? (
                <span className="text-gray-400">Loading journey...</span>
              ) : (
                <span>{journeyDialogData?.journeyName || 'Journey Responses'}</span>
              )}
            </DialogTitle>
            <DialogDescription>Collected data from this journey session</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0 p-5">
            {loadingJourneyDialog ? (
              <div className="flex justify-center items-center py-16">
                <div className="w-7 h-7 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : journeyDialogData?.responses && journeyDialogData.responses.length > 0 ? (
              <div className="space-y-4">
                {journeyDialogData.responses.map((resp, idx) => (
                  <div key={idx} className="border-l-2 border-orange-200 pl-4">
                    <p className="text-sm font-medium text-gray-700">{resp.question}</p>
                    <div className="mt-1 bg-gray-50 rounded-md px-3 py-2">
                      <p className="text-sm text-gray-600">{resp.answer}</p>
                    </div>
                  </div>
                ))}
                {journeyDialogData.completed && (
                  <div className="flex items-center gap-2 text-sm text-green-600 pt-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Journey completed
                  </div>
                )}
              </div>
            ) : (
              <p className="text-center text-sm text-gray-400 py-8">No journey responses found</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

          </div>
      </div>
  );
}
