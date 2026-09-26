import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { formatCrmSyncError } from "@/lib/crmSyncError";
import { FormSubmissionDetails } from "@/components/FormSubmissionDetails";
import { useQuery, useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RetentionBanner, RetentionCountdown, RetentionReportDialog, type AccountRetention } from "@/components/DataRetentionDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { Users, MessageSquare, TrendingUp, Building2, Phone, Mail, Download, Search, X, Calendar, ChevronLeft, ChevronRight, ChevronDown, Loader2, BarChart3, Contact, User, Bot, MapPin, ImageIcon, SlidersHorizontal, Sparkles, CheckCircle2, XCircle, MoreVertical, Info, Copy, Eye, FileText, GitBranch, UserCheck, RefreshCw, Upload, Trash2, AlertTriangle, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { format, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths } from "date-fns";
import * as XLSX from "xlsx";

type DatePreset = 'all' | 'today' | 'yesterday' | 'last7' | 'currentMonth' | 'lastMonth' | 'custom';

interface GroupAssignment {
  groupId: string;
  groupName: string;
  canViewConversations: boolean;
  canViewLeads: boolean;
  canViewAnalytics: boolean;
  canExportData: boolean;
  canSyncLeads: boolean;
  canDeleteData: boolean;
}

// Server-side cap per bulk delete request.
const MAX_BULK_DELETE = 200;

type CrmName = 'leadsquared' | 'salesforce';
type SyncWindow = 'today' | 'yesterday' | 'last3days' | 'last7days';

const SYNC_WINDOW_LABELS: Record<SyncWindow, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last3days: 'Last 3 days',
  last7days: 'Last 7 days',
};

interface AccountCrmStatus {
  businessAccountId: string;
  leadsquared: boolean;
  salesforce: boolean;
}

interface UnsyncedPreview {
  totalUnsynced: number;
  accounts: { businessAccountId: string; accountName: string; leadsquared: number | null; salesforce: number | null }[];
}

interface BulkSyncResult {
  totalSynced: number;
  totalFailed: number;
  remaining: number;
  accounts: { businessAccountId: string; accountName: string; synced: number; failed: number; errors: string[] }[];
}

interface AccountInfo {
  businessAccountId: string;
  businessName: string;
}

interface ConversationItem {
  id: string;
  userId: string;
  title: string | null;
  visitorCity: string | null;
  businessAccountId: string;
  businessAccountName: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  summary: string | null;
  topicKeywords: string | null;
  hasLead?: boolean;
  leadBadge?: string | null;
  viaJourney?: boolean;
  viaForm?: boolean;
}

interface MessageItem {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
  imageUrl?: string | null;
}

function friendlySyncError(error: string | null | undefined): string {
  return formatCrmSyncError(error);
}

interface LeadItem {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  businessAccountId: string;
  businessAccountName: string;
  createdAt: string;
  city?: string | null;
  sourceUrl?: string | null;
  conversationId?: string | null;
  leadsquaredSyncStatus?: string | null;
  leadsquaredLeadId?: string | null;
  leadsquaredSyncError?: string | null;
  leadsquaredSyncedAt?: string | null;
  leadsquaredSyncPayload?: Record<string, unknown> | null;
  salesforceSyncStatus?: string | null;
  salesforceSyncError?: string | null;
  salesforceSyncedAt?: string | null;
  topicsOfInterest?: string[] | null;
}

interface AnalyticsData {
  groupId: string;
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
  canExportData: boolean;
}

export default function GroupAdminDashboard() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [conversationsPage, setConversationsPage] = useState(1);
  const ITEMS_PER_PAGE = 20;
  const leadsObserverRef = useRef<IntersectionObserver | null>(null);

  const [leadsSearch, setLeadsSearch] = useState("");
  const [leadsDatePreset, setLeadsDatePreset] = useState<DatePreset>("all");
  const [leadsFromDate, setLeadsFromDate] = useState<Date | undefined>(undefined);
  const [leadsToDate, setLeadsToDate] = useState<Date | undefined>(undefined);
  const [leadsAccountFilter, setLeadsAccountFilter] = useState<string>("all");
  const [isExportingLeads, setIsExportingLeads] = useState(false);
  const [isExportingLeadsPDF, setIsExportingLeadsPDF] = useState(false);
  const [selectedLeadDetails, setSelectedLeadDetails] = useState<LeadItem | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

  const [convoSearch, setConvoSearch] = useState("");
  const [convoDatePreset, setConvoDatePreset] = useState<DatePreset>("all");
  const [convoFromDate, setConvoFromDate] = useState<Date | undefined>(undefined);
  const [convoToDate, setConvoToDate] = useState<Date | undefined>(undefined);
  const [convoTypeFilter, setConvoTypeFilter] = useState<'all' | 'chat' | 'journey' | 'form'>('all');
  const [convoAccountFilter, setConvoAccountFilter] = useState<string>("all");
  const [isExportingConvo, setIsExportingConvo] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [convoFilterOpen, setConvoFilterOpen] = useState(false);

  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [chatDialogConversationId, setChatDialogConversationId] = useState<string | null>(null);

  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [formDialogLead, setFormDialogLead] = useState<LeadItem | null>(null);

  const [journeyDialogOpen, setJourneyDialogOpen] = useState(false);
  const [journeyDialogLeadId, setJourneyDialogLeadId] = useState<string | null>(null);

  const [analyticsDatePreset, setAnalyticsDatePreset] = useState<DatePreset>("today");
  const [analyticsFromDate, setAnalyticsFromDate] = useState<Date | undefined>(undefined);
  const [analyticsToDate, setAnalyticsToDate] = useState<Date | undefined>(undefined);

  const prevLeadsFiltersRef = useRef({ leadsSearch, leadsDatePreset, leadsFromDate, leadsToDate, leadsAccountFilter });
  const prevConvoFiltersRef = useRef({ convoSearch, convoDatePreset, convoFromDate, convoToDate, convoAccountFilter });

  const getActiveTabFromRoute = () => {
    if (location.includes("/leads")) return "leads";
    if (location.includes("/conversations")) return "conversations";
    if (location.includes("/analytics")) return "analytics";
    return "leads";
  };
  const activeTab = getActiveTabFromRoute();

  const handleTabChange = (tab: string) => {
    if (tab === "leads") setLocation("/group-admin/leads");
    else if (tab === "conversations") setLocation("/group-admin/conversations");
    else if (tab === "analytics") setLocation("/group-admin/analytics");
  };

  const { data: groupsData, isLoading: loadingGroups } = useQuery<{ groups: GroupAssignment[] }>({
    queryKey: ["/api/group-admin/groups"],
  });

  const groups = groupsData?.groups || [];

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) {
      setSelectedGroupId(groups[0].groupId);
    }
  }, [groups, selectedGroupId]);

  const selectedGroup = groups.find(g => g.groupId === selectedGroupId);

  const getDateRange = (preset: DatePreset, fromDate?: Date, toDate?: Date) => {
    const today = startOfDay(new Date());
    switch (preset) {
      case 'today': return { from: today, to: endOfDay(today) };
      case 'yesterday': const yesterday = subDays(today, 1); return { from: yesterday, to: endOfDay(yesterday) };
      case 'last7': return { from: subDays(today, 7), to: endOfDay(today) };
      case 'currentMonth': return { from: startOfMonth(today), to: endOfDay(today) };
      case 'lastMonth': const lastMonth = subMonths(today, 1); return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
      case 'custom': return { from: fromDate ? startOfDay(fromDate) : undefined, to: toDate ? endOfDay(toDate) : undefined };
      default: return { from: undefined, to: undefined };
    }
  };

  const downloadAnalyticsPDF = async () => {
    if (!analyticsData || !selectedGroupId) return;
    try {
      const { from, to } = getDateRange(analyticsDatePreset, analyticsFromDate, analyticsToDate);
      const dateRangeText = from && to
        ? `${format(from, "MMMM d, yyyy")} to ${format(to, "MMMM d, yyyy")}`
        : "All time";

      // PDF is rendered server-side: the browser jsPDF is intentionally stubbed (vite.config.ts).
      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/analytics/pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRangeText,
          generatedText: format(new Date(), "MMMM d, yyyy 'at' h:mm a"),
          totals: {
            leads: analyticsData.totals?.leads || 0,
            conversations: analyticsData.totals?.conversations || 0,
          },
          accountBreakdown: (analyticsData.accountBreakdown || []).map((account) => ({
            businessName: account.businessName || "Unknown",
            leads: account.leads || 0,
            conversations: account.conversations || 0,
          })),
        }),
      });
      if (!res.ok) throw new Error("Failed to generate PDF");

      const blob = await res.blob();
      const fileName = `analytics-report-${format(new Date(), "yyyy-MM-dd")}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "PDF downloaded", description: "Analytics report saved." });
    } catch (error: any) {
      toast({ title: "PDF export failed", description: error.message || "An unexpected error occurred.", variant: "destructive" });
    }
  };

  const leadsQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    const { from, to } = getDateRange(leadsDatePreset, leadsFromDate, leadsToDate);
    if (from) params.append('fromDate', from.toISOString());
    if (to) params.append('toDate', to.toISOString());
    if (leadsSearch.trim()) params.append('search', leadsSearch.trim());
    if (leadsAccountFilter && leadsAccountFilter !== 'all') params.append('accountId', leadsAccountFilter);
    params.append('limit', ITEMS_PER_PAGE.toString());
    return params.toString();
  }, [leadsDatePreset, leadsFromDate, leadsToDate, leadsSearch, leadsAccountFilter]);

  const convoQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    const { from, to } = getDateRange(convoDatePreset, convoFromDate, convoToDate);
    if (from) params.append('fromDate', from.toISOString());
    if (to) params.append('toDate', to.toISOString());
    if (convoSearch.trim()) params.append('search', convoSearch.trim());
    if (convoAccountFilter && convoAccountFilter !== 'all') params.append('accountId', convoAccountFilter);
    params.append('page', conversationsPage.toString());
    params.append('limit', ITEMS_PER_PAGE.toString());
    return params.toString();
  }, [convoDatePreset, convoFromDate, convoToDate, convoSearch, convoAccountFilter, conversationsPage]);

  useEffect(() => {
    const prev = prevLeadsFiltersRef.current;
    if (prev.leadsSearch !== leadsSearch || prev.leadsDatePreset !== leadsDatePreset || 
        prev.leadsFromDate !== leadsFromDate || prev.leadsToDate !== leadsToDate || 
        prev.leadsAccountFilter !== leadsAccountFilter) {
      prevLeadsFiltersRef.current = { leadsSearch, leadsDatePreset, leadsFromDate, leadsToDate, leadsAccountFilter };
    }
  }, [leadsSearch, leadsDatePreset, leadsFromDate, leadsToDate, leadsAccountFilter]);

  useEffect(() => {
    const prev = prevConvoFiltersRef.current;
    if (prev.convoSearch !== convoSearch || prev.convoDatePreset !== convoDatePreset || 
        prev.convoFromDate !== convoFromDate || prev.convoToDate !== convoToDate || 
        prev.convoAccountFilter !== convoAccountFilter) {
      setConversationsPage(1);
      prevConvoFiltersRef.current = { convoSearch, convoDatePreset, convoFromDate, convoToDate, convoAccountFilter };
    }
  }, [convoSearch, convoDatePreset, convoFromDate, convoToDate, convoAccountFilter]);

  const analyticsQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    const { from, to } = getDateRange(analyticsDatePreset, analyticsFromDate, analyticsToDate);
    if (from) params.append('dateFrom', from.toISOString());
    if (to) params.append('dateTo', to.toISOString());
    return params.toString();
  }, [analyticsDatePreset, analyticsFromDate, analyticsToDate]);

  const { data: analyticsData, isLoading: loadingAnalytics } = useQuery<AnalyticsData>({
    queryKey: ["/api/group-admin/groups", selectedGroupId, "analytics", analyticsQueryParams],
    queryFn: async () => {
      const url = analyticsQueryParams 
        ? `/api/group-admin/groups/${selectedGroupId}/analytics?${analyticsQueryParams}`
        : `/api/group-admin/groups/${selectedGroupId}/analytics`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch analytics");
      return res.json();
    },
    enabled: !!selectedGroupId && selectedGroup?.canViewAnalytics,
  });

  const { data: conversationsData, isLoading: loadingConversations } = useQuery<{
    conversations: ConversationItem[];
    total: number;
    hasMore: boolean;
  }>({
    queryKey: ["/api/group-admin/groups", selectedGroupId, "conversations", convoQueryParams],
    queryFn: async () => {
      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/conversations?${convoQueryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json();
    },
    enabled: !!selectedGroupId && selectedGroup?.canViewConversations,
  });

  const { data: messagesData = [], isLoading: loadingMessages } = useQuery<MessageItem[]>({
    queryKey: ["/api/group-admin/groups", selectedGroupId, "conversations", selectedConversationId, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/conversations/${selectedConversationId}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!selectedGroupId && !!selectedConversationId && selectedGroup?.canViewConversations,
  });

  const { data: chatDialogConversation, isLoading: loadingChatDialogConversation } = useQuery<ConversationItem>({
    queryKey: ["/api/group-admin/groups", selectedGroupId, "conversations", chatDialogConversationId, "details"],
    queryFn: async () => {
      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/conversations/${chatDialogConversationId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch conversation");
      return res.json();
    },
    enabled: !!selectedGroupId && !!chatDialogConversationId && chatDialogOpen,
  });

  const { data: chatDialogMessages = [], isLoading: loadingChatDialogMessages } = useQuery<MessageItem[]>({
    queryKey: ["/api/group-admin/groups", selectedGroupId, "conversations", chatDialogConversationId, "dialog-messages"],
    queryFn: async () => {
      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/conversations/${chatDialogConversationId}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!selectedGroupId && !!chatDialogConversationId && chatDialogOpen,
  });

  const { data: journeyDialogData, isLoading: loadingJourneyDialog } = useQuery<{
    journeyName: string | null;
    completed: boolean;
    responses: Array<{ question: string; answer: string; stepOrder: number }>;
  }>({
    queryKey: ["/api/group-admin/groups", selectedGroupId, "journey-responses-by-lead", journeyDialogLeadId],
    queryFn: async () => {
      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/journey-responses-by-lead/${journeyDialogLeadId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch journey responses");
      return res.json();
    },
    enabled: !!selectedGroupId && !!journeyDialogLeadId && journeyDialogOpen,
  });

  const { data: leadsInfiniteData, isLoading: loadingLeads, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<{
    leads: LeadItem[];
    total: number;
    hasMore: boolean;
    uniqueLeads?: number;
  }>({
    queryKey: ["/api/group-admin/groups", selectedGroupId, "leads", leadsQueryParams],
    queryFn: async ({ pageParam = 1 }) => {
      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/leads?${leadsQueryParams}&page=${pageParam}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.hasMore) return allPages.length + 1;
      return undefined;
    },
    initialPageParam: 1,
    enabled: !!selectedGroupId && selectedGroup?.canViewLeads,
  });

  const allLeads = useMemo(() => leadsInfiniteData?.pages.flatMap(p => p.leads) || [], [leadsInfiniteData]);
  const leadsTotal = leadsInfiniteData?.pages[0]?.total || 0;
  const leadsUniqueLeads = leadsInfiniteData?.pages[0]?.uniqueLeads ?? null;

  // ---- CRM sync (only for admins with the "Can sync leads" permission) ----
  const canSyncLeads = !!selectedGroup?.canViewLeads && !!selectedGroup?.canSyncLeads;

  const { data: crmStatusData } = useQuery<{ accounts: AccountCrmStatus[] }>({
    queryKey: ["/api/group-admin/groups", selectedGroupId, "crm-status"],
    queryFn: async () => {
      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/crm-status`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch CRM status");
      return res.json();
    },
    enabled: !!selectedGroupId && canSyncLeads,
  });

  // Auto-delete (data retention) policy per account, for banners and row countdowns.
  const { data: retentionData } = useQuery<{ accounts: Record<string, AccountRetention | null> }>({
    queryKey: ["/api/group-admin/groups", selectedGroupId, "data-retention"],
    queryFn: async () => {
      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/data-retention`, { credentials: "include" });
      if (!res.ok) return { accounts: {} };
      return res.json();
    },
    enabled: !!selectedGroupId && (!!selectedGroup?.canViewLeads || !!selectedGroup?.canViewConversations),
  });
  const retentionPolicies = useMemo(
    () => Object.values(retentionData?.accounts || {}).filter((a): a is AccountRetention => !!a).map(a => a.policy),
    [retentionData],
  );
  const retentionAccountCount = Object.keys(retentionData?.accounts || {}).length;
  const [retentionReportOpen, setRetentionReportOpen] = useState(false);

  const crmByAccount = useMemo(() => {
    const map = new Map<string, AccountCrmStatus>();
    crmStatusData?.accounts.forEach(a => map.set(a.businessAccountId, a));
    return map;
  }, [crmStatusData]);
  const anyCrmConfigured = crmStatusData?.accounts.some(a => a.leadsquared || a.salesforce) ?? false;

  const invalidateLeads = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/group-admin/groups", selectedGroupId, "leads"] });
  };

  const syncLeadMutation = useMutation({
    mutationFn: async ({ lead, crm }: { lead: LeadItem; crm: CrmName }) => {
      return await apiRequest("POST", `/api/group-admin/groups/${selectedGroupId}/leads/${lead.id}/sync`, {
        businessAccountId: lead.businessAccountId,
        crm,
      });
    },
    onSuccess: (data: any, { crm }) => {
      toast({
        title: crm === 'leadsquared' ? "Synced to LeadSquared" : "Synced to Salesforce",
        description: data?.message || "Lead synced successfully",
      });
      invalidateLeads();
    },
    onError: (error: Error, { crm }) => {
      toast({
        title: crm === 'leadsquared' ? "LeadSquared Sync Failed" : "Salesforce Sync Failed",
        description: friendlySyncError(error.message),
        variant: "destructive",
      });
      invalidateLeads();
    },
  });

  const isSyncingLead = (leadId: string, crm: CrmName) =>
    syncLeadMutation.isPending && syncLeadMutation.variables?.lead.id === leadId && syncLeadMutation.variables?.crm === crm;

  const [bulkSyncOpen, setBulkSyncOpen] = useState(false);
  const [bulkSyncWindow, setBulkSyncWindow] = useState<SyncWindow>('today');
  const [bulkSyncResult, setBulkSyncResult] = useState<BulkSyncResult | null>(null);
  const bulkSyncAccountId = leadsAccountFilter !== 'all' ? leadsAccountFilter : undefined;

  const { data: unsyncedPreview, isFetching: loadingUnsyncedPreview } = useQuery<UnsyncedPreview>({
    queryKey: ["/api/group-admin/groups", selectedGroupId, "crm-unsynced", bulkSyncWindow, bulkSyncAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ filter: bulkSyncWindow });
      if (bulkSyncAccountId) params.set('accountId', bulkSyncAccountId);
      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/crm/unsynced?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch unsynced leads");
      return res.json();
    },
    enabled: bulkSyncOpen && !bulkSyncResult && !!selectedGroupId && canSyncLeads,
    // Counts change as leads come in and get synced — always fetch fresh when the dialog opens.
    staleTime: 0,
    gcTime: 0,
  });

  const bulkSyncMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest<BulkSyncResult>("POST", `/api/group-admin/groups/${selectedGroupId}/crm/sync-unsynced`, {
        filter: bulkSyncWindow,
        accountId: bulkSyncAccountId,
      });
    },
    onSuccess: (data) => {
      setBulkSyncResult(data);
      invalidateLeads();
    },
    onError: (error: Error) => {
      toast({ title: "Sync Failed", description: error.message, variant: "destructive" });
    },
  });

  const openBulkSync = () => {
    setBulkSyncResult(null);
    setBulkSyncOpen(true);
  };

  const leadsEndRef = useCallback((node: HTMLDivElement | null) => {
    if (leadsObserverRef.current) leadsObserverRef.current.disconnect();
    if (!node) return;
    leadsObserverRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    }, { threshold: 0.1 });
    leadsObserverRef.current.observe(node);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    return () => {
      if (leadsObserverRef.current) leadsObserverRef.current.disconnect();
    };
  }, []);

  const accountsForFilter = useMemo(() => {
    return analyticsData?.accountBreakdown?.map(a => ({ businessAccountId: a.businessAccountId, businessName: a.businessName })) || [];
  }, [analyticsData]);

  const exportLeadsToExcel = async () => {
    if (!selectedGroupId || !selectedGroup?.canExportData) return;
    setIsExportingLeads(true);
    try {
      const params = new URLSearchParams();
      const { from, to } = getDateRange(leadsDatePreset, leadsFromDate, leadsToDate);
      if (from) params.append('fromDate', from.toISOString());
      if (to) params.append('toDate', to.toISOString());
      if (leadsSearch.trim()) params.append('search', leadsSearch.trim());
      if (leadsAccountFilter && leadsAccountFilter !== 'all') params.append('accountId', leadsAccountFilter);
      params.append('export', 'true');

      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/leads?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to export leads");
      const data = await res.json();
      const allLeads = data.leads || [];
      if (allLeads.length === 0) {
        toast({ title: "No leads to export", description: "No leads match the current filters.", variant: "destructive" });
        return;
      }

      const worksheetData = allLeads.map((lead: LeadItem) => ({
        Name: lead.name || "-",
        Email: lead.email || "-",
        Phone: lead.phone || "-",
        Account: lead.businessAccountName || "-",
        "Topics of Interest": (lead.topicsOfInterest && Array.isArray(lead.topicsOfInterest) && lead.topicsOfInterest.length > 0) ? (lead.topicsOfInterest as string[]).join(", ") : "-",
        "Created At": lead.createdAt ? format(new Date(lead.createdAt), "yyyy-MM-dd HH:mm:ss") : "-",
      }));

      const worksheet = XLSX.utils.json_to_sheet(worksheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");
      worksheet["!cols"] = [{ wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 25 }, { wch: 20 }];
      XLSX.writeFile(workbook, `group-leads-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast({ title: "Export successful", description: `Exported ${allLeads.length} leads to Excel.` });
    } catch (error: any) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    } finally {
      setIsExportingLeads(false);
    }
  };

  const downloadLeadsPDF = async () => {
    if (!selectedGroupId || !selectedGroup?.canViewLeads) return;
    setIsExportingLeadsPDF(true);
    try {
      const { from, to } = getDateRange(leadsDatePreset, leadsFromDate, leadsToDate);
      const params = new URLSearchParams();
      if (from) params.append('fromDate', from.toISOString());
      if (to) params.append('toDate', to.toISOString());
      if (leadsSearch.trim()) params.append('search', leadsSearch.trim());
      if (leadsAccountFilter && leadsAccountFilter !== 'all') params.append('accountId', leadsAccountFilter);
      params.append('export', 'true');
      params.append('pdfExport', 'true');

      // Fetch all leads
      const leadsRes = await fetch(`/api/group-admin/groups/${selectedGroupId}/leads?${params.toString()}`, { credentials: "include" });
      if (!leadsRes.ok) throw new Error("Failed to fetch leads");
      const leadsData = await leadsRes.json();
      const allFetchedLeads: LeadItem[] = leadsData.leads || [];

      if (allFetchedLeads.length === 0) {
        toast({ title: "No leads to export", description: "No leads match the current filters.", variant: "destructive" });
        return;
      }

      // Fetch analytics for conversation count (same date range)
      const analyticsParams = new URLSearchParams();
      if (from) analyticsParams.append('dateFrom', from.toISOString());
      if (to) analyticsParams.append('dateTo', to.toISOString());
      let totalConversations = 0;
      let analyticsUnavailable = false;
      try {
        const analyticsRes = await fetch(`/api/group-admin/groups/${selectedGroupId}/analytics?${analyticsParams.toString()}`, { credentials: "include" });
        if (analyticsRes.ok) {
          const analyticsJson = await analyticsRes.json();
          totalConversations = analyticsJson.totals?.conversations || 0;
        } else {
          analyticsUnavailable = true;
        }
      } catch (_) {
        analyticsUnavailable = true;
      }

      // Deduplicate using the same method as Group Analytics and the UI badge:
      // per-account dedup by email → phone → id (keep most recent — API returns desc by createdAt)
      const byAccount = new Map<string, LeadItem[]>();
      for (const lead of allFetchedLeads) {
        const acctId = lead.businessAccountId || '__none__';
        if (!byAccount.has(acctId)) byAccount.set(acctId, []);
        byAccount.get(acctId)!.push(lead);
      }
      const deduped: LeadItem[] = [];
      for (const acctLeads of byAccount.values()) {
        const seen = new Set<string>();
        for (const lead of acctLeads) {
          const email = (lead.email || '').trim().toLowerCase();
          const phone = (lead.phone || '').trim();
          const key = email || phone || String(lead.id);
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(lead);
        }
      }
      // Restore global newest-first order after per-account grouping
      deduped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const totalLeads = deduped.length;
      const conversionRate = totalConversations > 0
        ? ((totalLeads / totalConversations) * 100).toFixed(1)
        : '0.0';

      const dateRangeText = from && to
        ? `${format(from, "MMMM d, yyyy")} to ${format(to, "MMMM d, yyyy")}`
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
      const pdfRes = await fetch(`/api/group-admin/groups/${selectedGroupId}/leads/pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName: selectedGroup?.name || "Group",
          dateRangeText,
          generatedText: format(new Date(), "MMMM d, yyyy 'at' h:mm a"),
          totalLeads,
          totalConversations: analyticsUnavailable ? "N/A" : totalConversations,
          conversionRate: analyticsUnavailable ? "N/A" : conversionRate,
          leads: leadsPayload,
        }),
      });
      if (!pdfRes.ok) throw new Error("Failed to generate PDF");

      const blob = await pdfRes.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-report-${format(new Date(), "yyyy-MM-dd")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "PDF downloaded", description: `Exported ${totalLeads} unique leads.` });
    } catch (error: any) {
      toast({ title: "PDF export failed", description: error.message, variant: "destructive" });
    } finally {
      setIsExportingLeadsPDF(false);
    }
  };

  const exportConversationsToExcel = async () => {
    if (!selectedGroupId || !selectedGroup?.canExportData) return;
    setIsExportingConvo(true);
    try {
      const params = new URLSearchParams();
      const { from, to } = getDateRange(convoDatePreset, convoFromDate, convoToDate);
      if (from) params.append('fromDate', from.toISOString());
      if (to) params.append('toDate', to.toISOString());
      if (convoSearch.trim()) params.append('search', convoSearch.trim());
      if (convoAccountFilter && convoAccountFilter !== 'all') params.append('accountId', convoAccountFilter);
      params.append('export', 'true');

      const res = await fetch(`/api/group-admin/groups/${selectedGroupId}/conversations?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to export conversations");
      const data = await res.json();
      const allConversations = data.conversations || [];
      if (allConversations.length === 0) {
        toast({ title: "No conversations to export", description: "No conversations match the current filters.", variant: "destructive" });
        return;
      }

      const worksheetData = allConversations.map((conv: ConversationItem) => ({
        "Conversation ID": conv.id,
        "User ID": conv.userId,
        Account: conv.businessAccountName || "-",
        "Created At": conv.createdAt ? format(new Date(conv.createdAt), "yyyy-MM-dd HH:mm:ss") : "-",
        "Updated At": conv.updatedAt ? format(new Date(conv.updatedAt), "yyyy-MM-dd HH:mm:ss") : "-",
      }));

      const worksheet = XLSX.utils.json_to_sheet(worksheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Conversations");
      worksheet["!cols"] = [{ wch: 40 }, { wch: 40 }, { wch: 25 }, { wch: 20 }, { wch: 20 }];
      XLSX.writeFile(workbook, `group-conversations-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast({ title: "Export successful", description: `Exported ${allConversations.length} conversations to Excel.` });
    } catch (error: any) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    } finally {
      setIsExportingConvo(false);
    }
  };

  // ---- Bulk delete (only for admins with the "Delete" permission) ----
  const canDeleteLeads = !!selectedGroup?.canViewLeads && !!selectedGroup?.canDeleteData;
  const canDeleteConversations = !!selectedGroup?.canViewConversations && !!selectedGroup?.canDeleteData;
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [selectedConvoIds, setSelectedConvoIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<'leads' | 'conversations' | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // A selection only makes sense for the list it was made on.
  useEffect(() => { setSelectedLeadIds(new Set()); }, [selectedGroupId, leadsQueryParams]);
  useEffect(() => { setSelectedConvoIds(new Set()); }, [selectedGroupId, convoQueryParams, convoTypeFilter]);

  const toggleId = (setter: typeof setSelectedLeadIds, id: string, checked: boolean) => {
    setter(previous => {
      const next = new Set(previous);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const bulkDeleteMutation = useMutation({
    mutationFn: async ({ target, ids }: { target: 'leads' | 'conversations'; ids: string[] }) => {
      return await apiRequest<{ deletedCount: number }>("POST", `/api/group-admin/groups/${selectedGroupId}/${target}/bulk-delete`, { ids });
    },
    onSuccess: (data, { target, ids }) => {
      toast({
        title: target === 'leads' ? "Leads deleted" : "Conversations deleted",
        description: `${data.deletedCount} ${target === 'leads' ? 'lead' : 'conversation'}${data.deletedCount === 1 ? '' : 's'} permanently deleted.`,
      });
      if (target === 'leads') {
        setSelectedLeadIds(new Set());
      } else {
        setSelectedConvoIds(new Set());
        if (selectedConversationId && ids.includes(selectedConversationId)) setSelectedConversationId(null);
      }
      setDeleteTarget(null);
      setDeleteConfirmText("");
      // Leads, conversations and analytics counts all change.
      queryClient.invalidateQueries({ queryKey: ["/api/group-admin/groups", selectedGroupId] });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/group-admin/groups", selectedGroupId] });
    },
  });

  const deleteIds = deleteTarget === 'leads' ? Array.from(selectedLeadIds) : Array.from(selectedConvoIds);

  // ---- Delete ALL matching the current filters (two-step: preview count, then delete) ----
  const [deleteAllTarget, setDeleteAllTarget] = useState<'leads' | 'conversations' | null>(null);
  const [deleteAllPreview, setDeleteAllPreview] = useState<{ total: number; snapshotAt: string } | null>(null);
  const [deleteAllPreviewError, setDeleteAllPreviewError] = useState<string | null>(null);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState("");

  // The filters the list is showing (drop paging params).
  const filtersFromParams = (params: string) => {
    const parsed = new URLSearchParams(params);
    parsed.delete('page');
    parsed.delete('limit');
    return parsed;
  };

  const openDeleteAll = async (target: 'leads' | 'conversations') => {
    setDeleteAllTarget(target);
    setDeleteAllPreview(null);
    setDeleteAllPreviewError(null);
    setDeleteAllConfirmText("");
    try {
      const params = filtersFromParams(target === 'leads' ? leadsQueryParams : convoQueryParams);
      const data = await apiRequest<{ total: number; snapshotAt: string }>(
        "GET",
        `/api/group-admin/groups/${selectedGroupId}/delete-all/${target}/preview?${params.toString()}`,
      );
      setDeleteAllPreview(data);
    } catch (error: any) {
      setDeleteAllPreviewError(error.message || "Could not count matching items");
    }
  };

  const closeDeleteAll = () => {
    setDeleteAllTarget(null);
    setDeleteAllPreview(null);
    setDeleteAllPreviewError(null);
    setDeleteAllConfirmText("");
  };

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const target = deleteAllTarget!;
      const params = filtersFromParams(target === 'leads' ? leadsQueryParams : convoQueryParams);
      return await apiRequest<{ deletedCount: number }>("POST", `/api/group-admin/groups/${selectedGroupId}/delete-all/${target}`, {
        confirmation: "DELETE ALL",
        snapshotAt: deleteAllPreview?.snapshotAt,
        ...Object.fromEntries(params.entries()),
      });
    },
    onSuccess: (data) => {
      const target = deleteAllTarget;
      toast({
        title: target === 'leads' ? "All matching leads deleted" : "All matching conversations deleted",
        description: `${data.deletedCount.toLocaleString()} permanently deleted.`,
      });
      if (target === 'leads') setSelectedLeadIds(new Set());
      else { setSelectedConvoIds(new Set()); setSelectedConversationId(null); }
      closeDeleteAll();
      queryClient.invalidateQueries({ queryKey: ["/api/group-admin/groups", selectedGroupId] });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/group-admin/groups", selectedGroupId] });
    },
  });

  if (loadingGroups) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="p-6">
        <header className="flex items-center gap-4 mb-6">
          <SidebarTrigger className="lg:hidden" />
          <h1 className="text-2xl font-bold">Group Admin Dashboard</h1>
        </header>
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">No Groups Assigned</h2>
            <p className="text-muted-foreground">You don't have admin access to any account groups yet.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const convoTotalPages = Math.ceil((conversationsData?.total || 0) / ITEMS_PER_PAGE);

  const filteredConversations = (conversationsData?.conversations || []).filter(c => {
    if (convoTypeFilter === 'journey') return c.viaJourney;
    if (convoTypeFilter === 'form') return c.viaForm;
    if (convoTypeFilter === 'chat') return !c.viaJourney && !c.viaForm;
    return true;
  });

  const selectedConversation = conversationsData?.conversations?.find(c => c.id === selectedConversationId);

  const formatConvoDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
      return `Today at ${format(date, 'h:mm a')}`;
    } else if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${format(date, 'h:mm a')}`;
    } else {
      return format(date, 'MMM d, yyyy h:mm a');
    }
  };

  const formatMsgTime = (dateString: string) => {
    const date = new Date(dateString);
    return format(date, 'MMM d, h:mm a');
  };

  const DateFilterSelect = ({ value, onChange, fromDate, toDate, setFromDate, setToDate }: {
    value: DatePreset;
    onChange: (v: DatePreset) => void;
    fromDate?: Date;
    toDate?: Date;
    setFromDate: (d?: Date) => void;
    setToDate: (d?: Date) => void;
  }) => (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={(v) => onChange(v as DatePreset)}>
        <SelectTrigger className="w-[150px]">
          <Calendar className="w-4 h-4 mr-2" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="yesterday">Yesterday</SelectItem>
          <SelectItem value="last7">Last 7 Days</SelectItem>
          <SelectItem value="currentMonth">Current Month</SelectItem>
          <SelectItem value="lastMonth">Last Month</SelectItem>
          <SelectItem value="custom">Custom Range</SelectItem>
          <SelectItem value="all">Lifetime</SelectItem>
        </SelectContent>
      </Select>
      {value === 'custom' && (
        <div className="flex gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                {fromDate ? format(fromDate, "MMM d") : "From"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent mode="single" selected={fromDate} onSelect={setFromDate} />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                {toDate ? format(toDate, "MMM d") : "To"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent mode="single" selected={toDate} onSelect={setToDate} />
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );

  const AccountFilterSelect = ({ value, onChange, accounts }: {
    value: string;
    onChange: (v: string) => void;
    accounts: { businessAccountId: string; businessName: string }[];
  }) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[180px]">
        <Building2 className="w-4 h-4 mr-2" />
        <SelectValue placeholder="All Accounts" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Accounts</SelectItem>
        {accounts.map(a => (
          <SelectItem key={a.businessAccountId} value={a.businessAccountId}>{a.businessName}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="p-6 space-y-4">
      {groups.length > 1 && (
        <header className="flex items-center justify-end">
          <div className="flex items-center gap-4">
            <SidebarTrigger className="lg:hidden" />
            <Select value={selectedGroupId || ""} onValueChange={setSelectedGroupId}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Select a group" />
              </SelectTrigger>
              <SelectContent>
                {groups.map(group => (
                  <SelectItem key={group.groupId} value={group.groupId}>{group.groupName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange}>

        <TabsContent value="leads" className="mt-0 flex-1 flex flex-col">
          {!selectedGroup?.canViewLeads ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="py-16 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-50 to-violet-100 flex items-center justify-center">
                  <Contact className="w-8 h-8 text-purple-400" />
                </div>
                <h2 className="text-lg font-semibold mb-2 text-gray-800">No Permission</h2>
                <p className="text-sm text-gray-500 max-w-sm mx-auto">You don't have permission to view leads for this group. Contact your administrator for access.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col h-[calc(100vh-48px)] bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="relative px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-slate-50 via-purple-50/30 to-violet-50/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-md shadow-purple-200/50">
                      <Contact className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold text-gray-900 tracking-tight">Leads Management</h1>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 tabular-nums">
                          {leadsTotal?.toLocaleString() || 0} total
                        </span>
                        {leadsUniqueLeads !== null && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-600 tabular-nums">
                            {leadsUniqueLeads.toLocaleString()} unique leads
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">View and export captured leads from conversations</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canSyncLeads && anyCrmConfigured && (
                      <Button
                        onClick={openBulkSync}
                        variant="outline"
                        className="border-green-500 text-green-600 hover:bg-green-50 transition-all duration-200 shadow-sm"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Sync to CRM
                      </Button>
                    )}
                    {selectedGroup?.canViewLeads && (
                      <Button
                        onClick={downloadLeadsPDF}
                        disabled={isExportingLeadsPDF}
                        variant="outline"
                        className="border-purple-200 text-purple-700 hover:bg-purple-50 hover:border-purple-300 transition-all duration-200 shadow-sm"
                      >
                        {isExportingLeadsPDF ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
                        Download PDF
                      </Button>
                    )}
                    {selectedGroup?.canExportData && (
                      <Button
                        onClick={exportLeadsToExcel}
                        disabled={isExportingLeads}
                        variant="outline"
                        className="border-purple-200 text-purple-700 hover:bg-purple-50 hover:border-purple-300 transition-all duration-200 shadow-sm"
                      >
                        {isExportingLeads ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                        Export to Excel
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <RetentionBanner policies={retentionPolicies} totalAccounts={retentionAccountCount} onViewReport={() => setRetentionReportOpen(true)} />
              <div className="px-6 py-3 border-b border-gray-100 bg-gradient-to-r from-violet-50/50 to-transparent">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-500" />
                  <span className="text-sm font-medium text-gray-700">
                    {leadsTotal?.toLocaleString() || 0} leads captured
                  </span>
                  {leadsUniqueLeads !== null && (
                    <span className="text-sm text-blue-600 font-medium">
                      · {leadsUniqueLeads.toLocaleString()} unique leads
                    </span>
                  )}
                  {leadsDatePreset !== 'all' && (
                    <span className="text-xs text-gray-400 ml-1">
                      ({leadsDatePreset === 'custom' ? 'Custom range' : leadsDatePreset === 'today' ? 'Today' : leadsDatePreset === 'yesterday' ? 'Yesterday' : leadsDatePreset === 'last7' ? 'Last 7 days' : leadsDatePreset === 'currentMonth' ? 'This month' : 'Last month'})
                    </span>
                  )}
                  {canDeleteLeads && allLeads.length > 0 && (
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => openDeleteAll('leads')}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        Delete all{leadsSearch || leadsDatePreset !== 'all' || leadsAccountFilter !== 'all' ? ' matching' : ''}
                      </Button>
                      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                        <Checkbox
                          aria-label="Select loaded leads"
                          checked={selectedLeadIds.size > 0 && (selectedLeadIds.size === Math.min(allLeads.length, MAX_BULK_DELETE) ? true : "indeterminate")}
                          onCheckedChange={(checked) =>
                            setSelectedLeadIds(checked === true ? new Set(allLeads.slice(0, MAX_BULK_DELETE).map(l => l.id)) : new Set())
                          }
                        />
                        {selectedLeadIds.size > 0 ? `${selectedLeadIds.size} selected` : `Select ${allLeads.length > MAX_BULK_DELETE ? `first ${MAX_BULK_DELETE}` : 'all loaded'}`}
                      </label>
                      {selectedLeadIds.size > 0 && (
                        <>
                          <Button size="sm" variant="destructive" className="h-7" onClick={() => setDeleteTarget('leads')}>
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                            Delete
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-gray-500" onClick={() => setSelectedLeadIds(new Set())}>
                            Clear
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="px-6 py-4 border-b border-gray-100 bg-white">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 max-w-sm group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 transition-colors group-focus-within:text-purple-500" />
                    <Input
                      placeholder="Search by name, email, phone..."
                      value={leadsSearch}
                      onChange={(e) => setLeadsSearch(e.target.value)}
                      className="pl-10 bg-gray-50/80 border-gray-200 rounded-lg h-9 text-sm transition-all duration-200 focus:bg-white focus:ring-2 focus:ring-purple-100 focus:border-purple-300"
                    />
                    {leadsSearch && (
                      <button onClick={() => setLeadsSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                        <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {([
                      { key: 'all', label: 'All Time' },
                      { key: 'today', label: 'Today' },
                      { key: 'yesterday', label: 'Yesterday' },
                      { key: 'last7', label: '7 Days' },
                      { key: 'currentMonth', label: 'This Month' },
                      { key: 'lastMonth', label: 'Last Month' },
                      { key: 'custom', label: 'Custom' },
                    ] as { key: DatePreset; label: string }[]).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setLeadsDatePreset(key)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
                          leadsDatePreset === key
                            ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-200 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {leadsDatePreset === 'custom' && (
                    <div className="flex items-center gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 text-xs border-gray-200 hover:border-purple-300">
                            <Calendar className="w-3.5 h-3.5 mr-1.5 text-purple-500" />
                            {leadsFromDate ? format(leadsFromDate, "MMM d, yyyy") : "Start date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <CalendarComponent mode="single" selected={leadsFromDate} onSelect={setLeadsFromDate} />
                        </PopoverContent>
                      </Popover>
                      <span className="text-xs text-gray-400">→</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 text-xs border-gray-200 hover:border-purple-300">
                            <Calendar className="w-3.5 h-3.5 mr-1.5 text-purple-500" />
                            {leadsToDate ? format(leadsToDate, "MMM d, yyyy") : "End date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <CalendarComponent mode="single" selected={leadsToDate} onSelect={setLeadsToDate} />
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}

                  <Select value={leadsAccountFilter} onValueChange={setLeadsAccountFilter}>
                    <SelectTrigger className="w-[170px] h-9 text-sm border-gray-200 bg-gray-50/80 rounded-lg hover:border-purple-300 transition-colors">
                      <Building2 className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
                      <SelectValue placeholder="All Accounts" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Accounts</SelectItem>
                      {accountsForFilter.map(a => (
                        <SelectItem key={a.businessAccountId} value={a.businessAccountId}>{a.businessName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                {loadingLeads ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <div className="w-10 h-10 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                    <p className="text-sm text-gray-400 mt-4">Loading leads...</p>
                  </div>
                ) : allLeads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 px-6">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-gray-50 to-purple-50 flex items-center justify-center mb-5">
                      <Contact className="w-10 h-10 text-purple-300" />
                    </div>
                    <h3 className="text-base font-semibold text-gray-700 mb-1.5">No leads found</h3>
                    <p className="text-sm text-gray-400 text-center max-w-xs">
                      {leadsSearch || leadsDatePreset !== 'all' || leadsAccountFilter !== 'all'
                        ? "Try adjusting your filters or search term to find matching leads."
                        : "Leads will appear here as visitors interact with your chatbot and share their contact details."}
                    </p>
                    {(leadsSearch || leadsDatePreset !== 'all' || leadsAccountFilter !== 'all') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-4 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                        onClick={() => { setLeadsSearch(""); setLeadsDatePreset("all"); setLeadsAccountFilter("all"); }}
                      >
                        <X className="w-3.5 h-3.5 mr-1.5" /> Clear all filters
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50 flex-1">
                    {allLeads.map((lead, index) => {
                      const avatarColors = [
                        'from-violet-400 to-purple-500',
                        'from-blue-400 to-indigo-500',
                        'from-emerald-400 to-teal-500',
                        'from-amber-400 to-orange-500',
                        'from-rose-400 to-pink-500',
                        'from-cyan-400 to-sky-500',
                        'from-fuchsia-400 to-purple-500',
                        'from-lime-400 to-green-500',
                      ];
                      const firstChar = lead.name ? lead.name.charAt(0).toUpperCase() : '';
                      const colorIndex = firstChar ? firstChar.charCodeAt(0) % avatarColors.length : 0;
                      const isAnonymous = !lead.name;

                      return (
                        <div
                          key={lead.id}
                          className={`group flex items-center gap-4 px-6 py-3.5 transition-all duration-150 hover:bg-purple-50/40 border-l-3 border-l-transparent hover:border-l-purple-400 cursor-default ${selectedLeadIds.has(lead.id) ? 'bg-red-50/40' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                        >
                          {canDeleteLeads && (
                            <Checkbox
                              aria-label={`Select lead ${lead.name || lead.phone || lead.id}`}
                              checked={selectedLeadIds.has(lead.id)}
                              disabled={!selectedLeadIds.has(lead.id) && selectedLeadIds.size >= MAX_BULK_DELETE}
                              onCheckedChange={(checked) => toggleId(setSelectedLeadIds, lead.id, checked === true)}
                            />
                          )}
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${isAnonymous ? 'bg-gray-200' : `bg-gradient-to-br ${avatarColors[colorIndex]}`}`}>
                            {isAnonymous ? (
                              <User className="w-4 h-4 text-gray-500" />
                            ) : (
                              <span className="text-white text-sm font-semibold">{firstChar}</span>
                            )}
                          </div>

                          <div className="flex-1 min-w-0 grid grid-cols-[1fr_1.2fr_1fr_0.7fr_0.8fr_1.2fr_0.5fr_0.3fr_0.3fr] gap-3 items-center">
                            <div className="min-w-0">
                              {isAnonymous ? (
                                <span className="text-sm italic text-gray-400">Anonymous</span>
                              ) : (
                                <span className="text-sm font-semibold text-gray-900 truncate block">{lead.name}</span>
                              )}
                            </div>

                            <div className="min-w-0">
                              {lead.email ? (
                                <a href={`mailto:${lead.email}`} className="text-sm text-gray-600 hover:text-purple-600 truncate block transition-colors flex items-center gap-1.5">
                                  <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                  <span className="truncate">{lead.email}</span>
                                </a>
                              ) : (
                                <span className="text-sm text-gray-300">—</span>
                              )}
                            </div>

                            <div className="min-w-0">
                              {lead.phone ? (
                                <a href={`tel:${lead.phone}`} className="text-sm text-gray-600 hover:text-purple-600 transition-colors flex items-center gap-1.5">
                                  <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                  <span className="break-all">{lead.phone}</span>
                                </a>
                              ) : (
                                <span className="text-sm text-gray-300">—</span>
                              )}
                            </div>

                            <div className="min-w-0">
                              {(lead as any).city ? (
                                <span className="text-sm text-gray-600 flex items-center gap-1.5">
                                  <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                  <span className="truncate">{(lead as any).city}</span>
                                </span>
                              ) : (
                                <span className="text-sm text-gray-300">—</span>
                              )}
                            </div>

                            <div className="min-w-0">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200/60 break-words">
                                {lead.businessAccountName || "Unknown"}
                              </span>
                            </div>

                            <div className="min-w-0">
                              {(lead.topicsOfInterest && Array.isArray(lead.topicsOfInterest) && lead.topicsOfInterest.length > 0) ? (
                                <div className="flex flex-wrap gap-1">
                                  {(lead.topicsOfInterest as string[]).slice(0, 3).map((topic: string, i: number) => {
                                    const colors = [
                                      'bg-purple-100 text-purple-700',
                                      'bg-blue-100 text-blue-700',
                                      'bg-green-100 text-green-700',
                                      'bg-orange-100 text-orange-700'
                                    ];
                                    return (
                                      <span
                                        key={i}
                                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[i % colors.length]}`}
                                      >
                                        {topic}
                                      </span>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="text-sm text-gray-300">—</span>
                              )}
                            </div>

                            <div className="min-w-0 text-right">
                              {lead.createdAt ? (
                                <div>
                                  <div className="text-sm font-medium text-gray-700">{format(new Date(lead.createdAt), "MMM d, yyyy")}</div>
                                  <div className="text-[11px] text-gray-400">{format(new Date(lead.createdAt), "h:mm a")}</div>
                                  <RetentionCountdown lead={lead} retention={retentionData?.accounts?.[lead.businessAccountId]} />
                                </div>
                              ) : (
                                <span className="text-sm text-gray-300">N/A</span>
                              )}
                            </div>

                            <div className="min-w-0 flex items-center justify-center gap-1">
                              {isSyncingLead(lead.id, 'leadsquared') ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                              ) : lead.leadsquaredSyncStatus === 'synced' ? (
                                <div className="flex items-center gap-1 text-green-600" title="Synced to CRM">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                </div>
                              ) : lead.leadsquaredSyncStatus === 'needs_attention' ? (
                                <div className="flex items-center gap-1 text-amber-600 cursor-help" title={`Needs attention (not retried automatically): ${friendlySyncError(lead.leadsquaredSyncError)}`}>
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </div>
                              ) : lead.leadsquaredSyncStatus === 'failed' || lead.leadsquaredSyncStatus === 'permanently_failed' ? (
                                <div className="flex items-center gap-1 text-red-600 cursor-help" title={`${lead.leadsquaredSyncStatus === 'failed' ? 'Retrying automatically' : 'Gave up retrying'}: ${friendlySyncError(lead.leadsquaredSyncError)}`}>
                                  <XCircle className="h-3.5 w-3.5" />
                                </div>
                              ) : lead.leadsquaredSyncStatus === 'pending' ? (
                                <div className="flex items-center gap-1 text-gray-400 cursor-help" title="Sync in progress">
                                  <Clock className="h-3.5 w-3.5" />
                                </div>
                              ) : !lead.salesforceSyncStatus ? (
                                <span className="text-gray-300 text-xs">—</span>
                              ) : null}
                              {isSyncingLead(lead.id, 'salesforce') ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                              ) : lead.salesforceSyncStatus === 'synced' ? (
                                <div className="text-blue-500" title="Synced to Salesforce"><CheckCircle2 className="h-3.5 w-3.5" /></div>
                              ) : lead.salesforceSyncStatus === 'failed' ? (
                                <div className="text-red-600 cursor-help" title={`Salesforce: ${lead.salesforceSyncError || 'Sync failed'}`}><XCircle className="h-3.5 w-3.5" /></div>
                              ) : null}
                            </div>

                            <div className="min-w-0 flex items-center justify-center">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-gray-600">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuItem
                                    onClick={() => { setSelectedLeadDetails(lead); setDetailsDialogOpen(true); }}
                                    className="cursor-pointer"
                                  >
                                    <Info className="h-4 w-4 mr-2 text-blue-600" />
                                    View Details
                                  </DropdownMenuItem>
                                  {(() => {
                                    const topics = (lead.topicsOfInterest || []).map(t => t.toLowerCase());
                                    const isJourney = topics.some(t => t.includes('journey'));
                                    const isForm = !isJourney && topics.some(t => t.includes('via form'));
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
                                    if (!isForm && !isJourney && lead.conversationId) {
                                      return (
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setChatDialogConversationId(lead.conversationId!);
                                            setChatDialogOpen(true);
                                          }}
                                          className="cursor-pointer"
                                        >
                                          <Eye className="h-4 w-4 mr-2 text-purple-600" />
                                          View Chat
                                        </DropdownMenuItem>
                                      );
                                    }
                                    return null;
                                  })()}
                                  {canSyncLeads && crmByAccount.get(lead.businessAccountId)?.leadsquared && lead.leadsquaredSyncStatus !== 'synced' && lead.leadsquaredSyncStatus !== 'disqualified' && (
                                    <DropdownMenuItem
                                      onClick={() => syncLeadMutation.mutate({ lead, crm: 'leadsquared' })}
                                      disabled={syncLeadMutation.isPending}
                                      className="cursor-pointer"
                                    >
                                      <RefreshCw className={`h-4 w-4 mr-2 text-blue-600 ${isSyncingLead(lead.id, 'leadsquared') ? 'animate-spin' : ''}`} />
                                      {lead.leadsquaredSyncStatus && lead.leadsquaredSyncStatus !== 'pending' ? 'Retry LSQ Sync' : 'Sync to LeadSquared'}
                                    </DropdownMenuItem>
                                  )}
                                  {canSyncLeads && crmByAccount.get(lead.businessAccountId)?.salesforce && (lead.salesforceSyncStatus === 'failed' || !lead.salesforceSyncStatus) && (
                                    <DropdownMenuItem
                                      onClick={() => syncLeadMutation.mutate({ lead, crm: 'salesforce' })}
                                      disabled={syncLeadMutation.isPending}
                                      className="cursor-pointer"
                                    >
                                      <RefreshCw className={`h-4 w-4 mr-2 text-blue-500 ${isSyncingLead(lead.id, 'salesforce') ? 'animate-spin' : ''}`} />
                                      {lead.salesforceSyncStatus === 'failed' ? 'Retry SF Sync' : 'Sync to Salesforce'}
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={leadsEndRef} className="h-4" />
                    {isFetchingNextPage && (
                      <div className="flex items-center justify-center py-4">
                        <div className="w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {allLeads.length > 0 && (
                <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">
                      Showing <span className="font-medium text-gray-700">{allLeads.length.toLocaleString()}</span> of <span className="font-medium text-gray-700">{leadsTotal?.toLocaleString() || 0}</span> leads
                    </span>
                    {isFetchingNextPage && (
                      <div className="flex items-center gap-2 text-sm text-purple-600">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Loading more...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="conversations" className="mt-0 flex-1 flex flex-col">
          {!selectedGroup?.canViewConversations ? (
            <Card>
              <CardContent className="py-12 text-center">
                <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h2 className="text-lg font-semibold mb-2">No Permission</h2>
                <p className="text-muted-foreground">You don't have permission to view conversations for this group.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex h-[calc(100vh-48px)] w-full bg-gray-50 min-h-0 overflow-hidden rounded-lg border">
              <div className={`w-full md:w-96 border-r border-gray-200 bg-white flex-col min-h-0 overflow-hidden ${selectedConversationId ? 'hidden md:flex' : 'flex'}`}>
                <div className="p-4 border-b border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xl font-bold text-gray-900">Conversations</h2>
                    {selectedGroup?.canExportData && (
                      <Button variant="outline" size="sm" onClick={exportConversationsToExcel} disabled={isExportingConvo}>
                        {isExportingConvo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      </Button>
                    )}
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      type="text"
                      placeholder="Search conversations..."
                      value={convoSearch}
                      onChange={(e) => setConvoSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="border-b border-gray-200">
                  <button
                    onClick={() => setConvoFilterOpen(!convoFilterOpen)}
                    className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-gray-600 uppercase tracking-wider hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>Filters</span>
                      {convoDatePreset !== 'all' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-purple-100 text-purple-700 normal-case">
                          {convoDatePreset === 'today' ? 'Today' : convoDatePreset === 'yesterday' ? 'Yesterday' : convoDatePreset === 'last7' ? '7d' : convoDatePreset === 'currentMonth' ? 'Month' : convoDatePreset === 'lastMonth' ? 'Last Mo' : 'Custom'}
                        </span>
                      )}
                      {convoAccountFilter !== 'all' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-blue-100 text-blue-700 normal-case">
                          Account
                        </span>
                      )}
                    </div>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${convoFilterOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {convoFilterOpen && (
                    <div className="px-4 pb-4 bg-gradient-to-br from-gray-50 to-white">
                      <div className="mb-3">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setConvoDatePreset('all')}
                            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                              convoDatePreset === 'all'
                                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                                : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                            }`}
                          >
                            All Time
                          </button>
                          <button
                            onClick={() => setConvoDatePreset('today')}
                            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                              convoDatePreset === 'today'
                                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                                : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                            }`}
                          >
                            Today
                          </button>
                          <button
                            onClick={() => setConvoDatePreset('yesterday')}
                            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                              convoDatePreset === 'yesterday'
                                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                                : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                            }`}
                          >
                            Yesterday
                          </button>
                          <button
                            onClick={() => setConvoDatePreset('last7')}
                            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                              convoDatePreset === 'last7'
                                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                                : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                            }`}
                          >
                            Last 7 Days
                          </button>
                          <button
                            onClick={() => setConvoDatePreset('currentMonth')}
                            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                              convoDatePreset === 'currentMonth'
                                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                                : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                            }`}
                          >
                            Current Month
                          </button>
                          <button
                            onClick={() => setConvoDatePreset('lastMonth')}
                            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                              convoDatePreset === 'lastMonth'
                                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                                : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                            }`}
                          >
                            Last Month
                          </button>
                        </div>
                      </div>

                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className={`w-full px-3 py-2.5 text-xs font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 ${
                              convoDatePreset === 'custom'
                                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                                : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                            }`}
                          >
                            <Calendar className="w-3.5 h-3.5" />
                            <span>
                              {convoDatePreset === 'custom' && (convoFromDate || convoToDate)
                                ? `${convoFromDate ? format(convoFromDate, 'MMM d') : '...'} - ${convoToDate ? format(convoToDate, 'MMM d') : '...'}`
                                : 'Custom Range'}
                            </span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="start">
                          <div className="bg-gradient-to-br from-gray-50 to-white p-4">
                            <div className="mb-4">
                              <h4 className="text-sm font-semibold text-gray-900 mb-1">Custom Date Range</h4>
                              <p className="text-xs text-gray-500">Select start and end dates</p>
                            </div>
                            <div className="space-y-4">
                              <div className="bg-white rounded-lg p-3 border border-gray-200">
                                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 block">
                                  From Date
                                </label>
                                <CalendarComponent
                                  mode="single"
                                  selected={convoFromDate}
                                  onSelect={(date) => {
                                    setConvoFromDate(date);
                                    setConvoDatePreset('custom');
                                  }}
                                  disabled={(date) => date > new Date()}
                                  className="rounded-md"
                                />
                              </div>
                              <div className="bg-white rounded-lg p-3 border border-gray-200">
                                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 block">
                                  To Date
                                </label>
                                <CalendarComponent
                                  mode="single"
                                  selected={convoToDate}
                                  onSelect={(date) => {
                                    setConvoToDate(date);
                                    setConvoDatePreset('custom');
                                  }}
                                  disabled={(date) => date > new Date()}
                                  className="rounded-md"
                                />
                              </div>
                              {(convoFromDate || convoToDate) && (
                                <button
                                  onClick={() => {
                                    setConvoFromDate(undefined);
                                    setConvoToDate(undefined);
                                    setConvoDatePreset('all');
                                  }}
                                  className="w-full px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                                >
                                  Clear Dates
                                </button>
                              )}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>

                      <div className="mt-3">
                        <AccountFilterSelect value={convoAccountFilter} onChange={setConvoAccountFilter} accounts={accountsForFilter} />
                      </div>
                    </div>
                  )}
                </div>

                <RetentionBanner policies={retentionPolicies} totalAccounts={retentionAccountCount} onViewReport={() => setRetentionReportOpen(true)} />
                {/* Type Filter Chips */}
                <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2 flex-wrap">
                  {([
                    { key: 'all' as const, label: 'All', icon: null },
                    { key: 'chat' as const, label: 'Chat', icon: <MessageSquare className="w-3 h-3" /> },
                    { key: 'journey' as const, label: 'Journey', icon: <GitBranch className="w-3 h-3" /> },
                    { key: 'form' as const, label: 'Forms', icon: <FileText className="w-3 h-3" /> },
                  ]).map(({ key, label, icon }) => (
                    <button
                      key={key}
                      onClick={() => setConvoTypeFilter(key)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                        convoTypeFilter === key
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>

                {canDeleteConversations && filteredConversations.length > 0 && (
                  <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2 bg-gray-50/60">
                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                      <Checkbox
                        aria-label="Select conversations on this page"
                        checked={selectedConvoIds.size > 0 && (filteredConversations.every(c => selectedConvoIds.has(c.id)) ? true : "indeterminate")}
                        onCheckedChange={(checked) =>
                          setSelectedConvoIds(checked === true ? new Set(filteredConversations.slice(0, MAX_BULK_DELETE).map(c => c.id)) : new Set())
                        }
                      />
                      {selectedConvoIds.size > 0 ? `${selectedConvoIds.size} selected` : 'Select all on this page'}
                    </label>
                    {selectedConvoIds.size === 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto h-7 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        disabled={convoTypeFilter !== 'all' || !!convoSearch.trim()}
                        title={convoTypeFilter !== 'all' || convoSearch.trim() ? "Delete all works with the date and account filters only — set the type to All and clear the search" : undefined}
                        onClick={() => openDeleteAll('conversations')}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        Delete all{convoDatePreset !== 'all' || convoAccountFilter !== 'all' ? ' matching' : ''}
                      </Button>
                    )}
                    {selectedConvoIds.size > 0 && (
                      <div className="ml-auto flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-gray-500" onClick={() => setSelectedConvoIds(new Set())}>
                          Clear
                        </Button>
                        <Button size="sm" variant="destructive" className="h-7" onClick={() => setDeleteTarget('conversations')}>
                          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex-1 overflow-y-auto overscroll-contain">
                  {loadingConversations ? (
                    <div className="flex justify-center py-8">
                      <div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : filteredConversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                      <MessageSquare className="w-12 h-12 text-gray-300 mb-3" />
                      <p className="text-sm text-gray-500">
                        {convoTypeFilter !== 'all' ? `No ${convoTypeFilter} conversations` : convoSearch ? 'No conversations found' : 'No conversations yet'}
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {filteredConversations.map((conversation) => (
                        <div
                          key={conversation.id}
                          onClick={() => setSelectedConversationId(conversation.id)}
                          className={`p-4 cursor-pointer transition-colors ${
                            selectedConversationId === conversation.id
                              ? 'bg-blue-50 border-l-4 border-blue-500'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {canDeleteConversations && (
                              <div className="pt-2.5" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  aria-label={`Select conversation ${conversation.title || conversation.id}`}
                                  checked={selectedConvoIds.has(conversation.id)}
                                  disabled={!selectedConvoIds.has(conversation.id) && selectedConvoIds.size >= MAX_BULK_DELETE}
                                  onCheckedChange={(checked) => toggleId(setSelectedConvoIds, conversation.id, checked === true)}
                                />
                              </div>
                            )}
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                              conversation.viaJourney
                                ? 'bg-gradient-to-br from-violet-500 to-purple-600'
                                : conversation.viaForm
                                  ? 'bg-gradient-to-br from-green-500 to-emerald-600'
                                  : 'bg-gradient-to-br from-purple-500 to-blue-600'
                            }`}>
                              {conversation.viaJourney
                                ? <GitBranch className="w-5 h-5 text-white" />
                                : conversation.viaForm
                                  ? <FileText className="w-5 h-5 text-white" />
                                  : <MessageSquare className="w-5 h-5 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-sm text-gray-900 truncate mb-0.5">
                                {conversation.title || 'Untitled Conversation'}
                              </h3>
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-xs">{conversation.businessAccountName || "Unknown"}</Badge>
                              </div>
                              <div className="flex items-center justify-between text-xs text-gray-500">
                                <span className="truncate">{formatConvoDate(conversation.createdAt)}</span>
                                <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">
                                  {conversation.messageCount || 0}
                                </span>
                              </div>
                              {(conversation.viaJourney || conversation.viaForm || conversation.hasLead || conversation.visitorCity) && (
                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                  {conversation.viaJourney && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-violet-50 text-violet-600 border border-violet-200" title="Via Journey">
                                      <GitBranch className="w-2.5 h-2.5" />
                                      Journey
                                    </span>
                                  )}
                                  {conversation.viaForm && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-600 border border-emerald-200" title="Via Form">
                                      <FileText className="w-2.5 h-2.5" />
                                      Form
                                    </span>
                                  )}
                                  {conversation.hasLead && (
                                    <span
                                      className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${
                                        conversation.leadBadge === 'Discount Availed' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-green-50 text-green-600 border-green-200'
                                      }`}
                                      title={conversation.leadBadge === 'Discount Availed' ? 'Discount Availed' : 'Lead Captured'}
                                    >
                                      <span className="font-bold">L</span>
                                      {conversation.leadBadge === 'Discount Availed' ? 'Discount' : 'Lead'}
                                    </span>
                                  )}
                                  {conversation.visitorCity && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-full border border-gray-200">
                                      <MapPin className="w-2.5 h-2.5" />
                                      {conversation.visitorCity}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {convoTotalPages > 1 && (
                    <div className="mt-auto border-t border-gray-200 p-4 bg-white">
                      <div className="flex items-center justify-between gap-2">
                        <Button variant="outline" size="sm" onClick={() => setConversationsPage(p => Math.max(1, p - 1))} disabled={conversationsPage === 1} className="flex items-center gap-1">
                          <ChevronLeft className="w-4 h-4" /> Previous
                        </Button>
                        <span className="text-sm text-gray-600 font-medium">Page {conversationsPage} of {convoTotalPages}</span>
                        <Button variant="outline" size="sm" onClick={() => setConversationsPage(p => Math.min(convoTotalPages, p + 1))} disabled={conversationsPage === convoTotalPages} className="flex items-center gap-1">
                          Next <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className={`flex-1 flex-col bg-gray-50 min-h-0 overflow-hidden ${selectedConversationId ? 'flex' : 'hidden md:flex'}`}>
                {selectedConversation ? (
                  <>
                    <div className="bg-white border-b border-gray-200 p-4">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setSelectedConversationId(null)}
                          className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                          <ChevronLeft className="w-5 h-5 text-gray-600" />
                        </button>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          selectedConversation.viaJourney
                            ? 'bg-gradient-to-br from-violet-500 to-purple-600'
                            : selectedConversation.viaForm
                              ? 'bg-gradient-to-br from-green-500 to-emerald-600'
                              : 'bg-gradient-to-br from-purple-500 to-blue-600'
                        }`}>
                          {selectedConversation.viaJourney
                            ? <GitBranch className="w-5 h-5 text-white" />
                            : selectedConversation.viaForm
                              ? <FileText className="w-5 h-5 text-white" />
                              : <MessageSquare className="w-5 h-5 text-white" />}
                        </div>
                        <div>
                          <h2 className="font-semibold text-gray-900">{selectedConversation.title || 'Untitled Conversation'}</h2>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>{formatConvoDate(selectedConversation.createdAt)}</span>
                            <Badge variant="outline" className="text-xs">{selectedConversation.businessAccountName}</Badge>
                          </div>
                          {(selectedConversation.viaJourney || selectedConversation.viaForm || selectedConversation.hasLead || selectedConversation.visitorCity) && (
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              {selectedConversation.viaJourney && (
                                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium bg-violet-50 text-violet-600 border border-violet-200">
                                  <GitBranch className="w-3 h-3" />
                                  Journey
                                </span>
                              )}
                              {selectedConversation.viaForm && (
                                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">
                                  <FileText className="w-3 h-3" />
                                  Form
                                </span>
                              )}
                              {selectedConversation.hasLead && (
                                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium border ${
                                  selectedConversation.leadBadge === 'Discount Availed'
                                    ? 'bg-orange-50 text-orange-600 border-orange-200'
                                    : 'bg-green-50 text-green-600 border-green-200'
                                }`}>
                                  <span className="font-bold text-[10px]">L</span>
                                  {selectedConversation.leadBadge === 'Discount Availed' ? 'Discount' : 'Lead'}
                                </span>
                              )}
                              {selectedConversation.visitorCity && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200">
                                  <MapPin className="w-3 h-3" />
                                  {selectedConversation.visitorCity}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {selectedConversation.summary && (
                      <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-b border-purple-100 px-4 py-3">
                        <div className="flex items-start gap-2">
                          <Sparkles className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-700 leading-relaxed">{selectedConversation.summary}</p>
                            {selectedConversation.topicKeywords && (() => {
                              try {
                                const keywords = JSON.parse(selectedConversation.topicKeywords);
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

                    <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
                      {loadingMessages ? (
                        <div className="flex justify-center py-8">
                          <div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : (
                        messagesData.map((message) => (
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
                ) : (
                  <div className="flex-1 flex items-center justify-center text-center p-4">
                    <div>
                      <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">Select a conversation</h3>
                      <p className="text-sm text-gray-500">Choose a conversation from the list to view messages</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics">
          {!selectedGroup?.canViewAnalytics ? (
            <Card>
              <CardContent className="py-12 text-center">
                <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h2 className="text-lg font-semibold mb-2">No Permission</h2>
                <p className="text-muted-foreground">You don't have permission to view analytics for this group.</p>
              </CardContent>
            </Card>
          ) : (
        <div className="space-y-8">
          {/* Elegant Header with Date Filters */}
          <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-6 pb-4">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-200">
                    <BarChart3 className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">Lead Analysis</h1>
                    <p className="text-sm text-gray-500">Performance metrics across all accounts</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadAnalyticsPDF}
                  disabled={!analyticsData}
                  className="flex items-center gap-2 rounded-full px-4"
                >
                  <Download className="w-4 h-4" />
                  Download PDF
                </Button>
              </div>
              
              {/* Date Filter Pills */}
              <div className="flex flex-wrap items-center gap-2">
                {([
                  { key: 'today', label: 'Today' },
                  { key: 'yesterday', label: 'Yesterday' },
                  { key: 'last7', label: 'Last 7 Days' },
                  { key: 'currentMonth', label: 'Current Month' },
                  { key: 'lastMonth', label: 'Last Month' },
                  { key: 'custom', label: 'Custom Range' },
                  { key: 'all', label: 'Lifetime' },
                ] as { key: DatePreset; label: string }[]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setAnalyticsDatePreset(key)}
                    className={`px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 ${
                      analyticsDatePreset === key
                        ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-200'
                        : 'bg-white text-gray-600 border border-gray-200 hover:border-purple-300 hover:text-purple-600 hover:shadow-sm'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              
              {analyticsDatePreset === 'custom' && (
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100">
                  <span className="text-sm text-gray-500">Select range:</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="rounded-full px-4">
                        <Calendar className="w-4 h-4 mr-2" />
                        {analyticsFromDate ? format(analyticsFromDate, "MMM d, yyyy") : "Start date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent mode="single" selected={analyticsFromDate} onSelect={setAnalyticsFromDate} />
                    </PopoverContent>
                  </Popover>
                  <span className="text-gray-400">→</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="rounded-full px-4">
                        <Calendar className="w-4 h-4 mr-2" />
                        {analyticsToDate ? format(analyticsToDate, "MMM d, yyyy") : "End date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent mode="single" selected={analyticsToDate} onSelect={setAnalyticsToDate} />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
            
            {/* Date Range Indicator */}
            <div className="px-6 py-3 bg-white/60 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                <span className="font-medium text-gray-700">Showing data from</span>{' '}
                {(() => {
                  const { from, to } = getDateRange(analyticsDatePreset, analyticsFromDate, analyticsToDate);
                  if (from && to) {
                    return <span className="text-purple-600 font-medium">{format(from, "MMMM d, yyyy")} to {format(to, "MMMM d, yyyy")}</span>;
                  }
                  return <span className="text-purple-600 font-medium">all time</span>;
                })()}
              </p>
            </div>
          </div>

          {loadingAnalytics ? (
            <div className="flex justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-3 border-purple-600 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-500">Loading analytics...</p>
              </div>
            </div>
          ) : analyticsData ? (
            <>
              {/* Metrics Cards */}
              <div className="grid gap-5 md:grid-cols-3">
                <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center">
                      <Contact className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-sm font-medium text-gray-500">Total Leads</span>
                  </div>
                  <p className="text-4xl font-bold text-gray-900">{(analyticsData.totals?.leads || 0).toLocaleString()}</p>
                </div>
                
                <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center">
                      <MessageSquare className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-sm font-medium text-gray-500">Conversations</span>
                  </div>
                  <p className="text-4xl font-bold text-gray-900">{(analyticsData.totals?.conversations || 0).toLocaleString()}</p>
                </div>
                
                <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-gradient-to-br from-violet-400 to-violet-600 rounded-xl flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-sm font-medium text-gray-500">Conversion Rate</span>
                  </div>
                  <p className="text-4xl font-bold text-gray-900">
                    {(analyticsData.totals?.conversations || 0) > 0 
                      ? ((analyticsData.totals?.leads || 0) / (analyticsData.totals?.conversations || 1) * 100).toFixed(1)
                      : '0.0'}%
                  </p>
                </div>
              </div>

              {/* Account Breakdown Table */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <h2 className="text-lg font-semibold text-gray-900">Account Breakdown</h2>
                  <p className="text-sm text-gray-500 mt-1">Detailed metrics per business account in this group</p>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50/50">
                        <TableHead className="font-semibold text-gray-700">Account</TableHead>
                        <TableHead className="text-center font-semibold text-gray-700">Leads</TableHead>
                        <TableHead className="text-center font-semibold text-gray-700">Conversations</TableHead>
                        <TableHead className="text-center font-semibold text-gray-700">Conversion</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(analyticsData.accountBreakdown || []).map((account, index) => (
                        <TableRow key={account.businessAccountId} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-gradient-to-br from-purple-100 to-indigo-100 rounded-lg flex items-center justify-center">
                                <Building2 className="w-4 h-4 text-purple-600" />
                              </div>
                              <span className="font-medium text-gray-900">{account.businessName || "Unknown"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`inline-flex items-center justify-center min-w-[40px] px-2 py-1 rounded-full text-sm font-medium ${
                              (account.leads || 0) > 0 ? 'bg-emerald-100 text-emerald-700' : 'text-gray-400'
                            }`}>
                              {account.leads || 0}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`inline-flex items-center justify-center min-w-[40px] px-2 py-1 rounded-full text-sm font-medium ${
                              (account.conversations || 0) > 0 ? 'bg-blue-100 text-blue-700' : 'text-gray-400'
                            }`}>
                              {account.conversations || 0}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`inline-flex items-center justify-center min-w-[40px] px-2 py-1 rounded-full text-sm font-medium ${
                              (account.conversations || 0) > 0 && (account.leads || 0) > 0 ? 'bg-violet-100 text-violet-700' : 'text-gray-400'
                            }`}>
                              {(account.conversations || 0) > 0 
                                ? ((account.leads || 0) / (account.conversations || 1) * 100).toFixed(1)
                                : '0.0'}%
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                      {(analyticsData.accountBreakdown || []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-12 text-gray-500">
                            No accounts found in this group
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          ) : null}
        </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !bulkDeleteMutation.isPending) { setDeleteTarget(null); setDeleteConfirmText(""); }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Delete {deleteIds.length} {deleteTarget === 'leads' ? 'lead' : 'conversation'}{deleteIds.length === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription>
              {deleteTarget === 'leads'
                ? "The selected leads are permanently removed from AI Chroney. Their conversations are kept, and leads already sent to LeadSquared or Salesforce stay in the CRM."
                : "The selected conversations and all their messages, journey answers and form data are permanently removed. Leads captured in them are kept but lose their chat link."}
              {" "}This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="confirm-bulk-delete" className="text-sm text-gray-700">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </label>
            <Input
              id="confirm-bulk-delete"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              autoComplete="off"
              disabled={bulkDeleteMutation.isPending}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={bulkDeleteMutation.isPending}
              onClick={() => { setDeleteTarget(null); setDeleteConfirmText(""); }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkDeleteMutation.isPending || deleteConfirmText !== "DELETE" || deleteIds.length === 0}
              onClick={() => deleteTarget && bulkDeleteMutation.mutate({ target: deleteTarget, ids: deleteIds })}
            >
              {bulkDeleteMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {bulkDeleteMutation.isPending ? 'Deleting…' : `Delete ${deleteIds.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RetentionReportDialog
        open={retentionReportOpen}
        onOpenChange={setRetentionReportOpen}
        baseUrl={`/api/group-admin/groups/${selectedGroupId}/data-retention/report`}
        title={selectedGroup?.groupName || "This group"}
      />

      <Dialog open={deleteAllTarget !== null} onOpenChange={(open) => { if (!open && !deleteAllMutation.isPending) closeDeleteAll(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Delete all {deleteAllTarget === 'leads' ? 'leads' : 'conversations'}?
            </DialogTitle>
            <DialogDescription>
              {deleteAllTarget === 'leads'
                ? "Permanently deletes every lead matching the filters below — including leads on pages you haven't scrolled to. Their conversations are kept, and copies already in LeadSquared or Salesforce stay in the CRM."
                : "Permanently deletes every conversation matching the filters below, with all their messages, journey answers and form data. Leads captured in them are kept but lose their chat link."}
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const isLeads = deleteAllTarget === 'leads';
            const preset = isLeads ? leadsDatePreset : convoDatePreset;
            const accountFilter = isLeads ? leadsAccountFilter : convoAccountFilter;
            const presetLabels: Record<string, string> = { all: 'All time', today: 'Today', yesterday: 'Yesterday', last7: 'Last 7 days', currentMonth: 'This month', lastMonth: 'Last month', custom: 'Custom range' };
            return (
              <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm space-y-1">
                <div><span className="text-gray-500">Accounts:</span> {accountFilter === 'all' ? `All accounts in ${selectedGroup?.groupName || 'this group'}` : (accountsForFilter.find(a => a.businessAccountId === accountFilter)?.businessName || 'Selected account')}</div>
                <div><span className="text-gray-500">Dates:</span> {presetLabels[preset] || preset}</div>
                {isLeads && leadsSearch.trim() && <div><span className="text-gray-500">Search:</span> "{leadsSearch.trim()}"</div>}
              </div>
            );
          })()}

          {deleteAllPreviewError ? (
            <p className="text-sm text-red-600">{deleteAllPreviewError}</p>
          ) : !deleteAllPreview ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Counting…
            </div>
          ) : deleteAllPreview.total === 0 ? (
            <p className="text-sm text-gray-600">Nothing matches these filters.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-red-700">
                {deleteAllPreview.total.toLocaleString()} {deleteAllTarget === 'leads' ? 'lead' : 'conversation'}{deleteAllPreview.total === 1 ? '' : 's'} will be deleted. This cannot be undone.
              </p>
              <label htmlFor="confirm-delete-all" className="text-sm text-gray-700 block">
                Type <span className="font-mono font-semibold">DELETE ALL</span> to confirm
              </label>
              <Input
                id="confirm-delete-all"
                value={deleteAllConfirmText}
                onChange={(e) => setDeleteAllConfirmText(e.target.value)}
                autoComplete="off"
                disabled={deleteAllMutation.isPending}
              />
              {deleteAllMutation.isPending && (
                <p className="text-xs text-gray-500">Deleting in batches — this can take a minute for large numbers. Keep this window open.</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" disabled={deleteAllMutation.isPending} onClick={closeDeleteAll}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteAllMutation.isPending || !deleteAllPreview || deleteAllPreview.total === 0 || deleteAllConfirmText !== "DELETE ALL"}
              onClick={() => deleteAllMutation.mutate()}
            >
              {deleteAllMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {deleteAllMutation.isPending ? 'Deleting…' : `Delete ${deleteAllPreview?.total?.toLocaleString() ?? ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkSyncOpen} onOpenChange={(open) => { if (!bulkSyncMutation.isPending) setBulkSyncOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-green-600" />
              Sync leads to CRM
            </DialogTitle>
            <DialogDescription>
              Pushes leads that are not yet in the CRM to each account's own LeadSquared / Salesforce, using that account's field mappings.
              {bulkSyncAccountId
                ? <> Only <span className="font-medium">{accountsForFilter.find(a => a.businessAccountId === bulkSyncAccountId)?.businessName || 'the selected account'}</span> (from the account filter).</>
                : <> Covers all accounts in this group.</>}
            </DialogDescription>
          </DialogHeader>

          {bulkSyncResult ? (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 rounded-lg bg-green-50 px-3 py-2">
                  <div className="text-xs text-green-700">Synced</div>
                  <div className="text-xl font-semibold text-green-700 tabular-nums">{bulkSyncResult.totalSynced}</div>
                </div>
                <div className="flex-1 rounded-lg bg-red-50 px-3 py-2">
                  <div className="text-xs text-red-700">Failed</div>
                  <div className="text-xl font-semibold text-red-700 tabular-nums">{bulkSyncResult.totalFailed}</div>
                </div>
              </div>
              {bulkSyncResult.remaining > 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2">
                  {bulkSyncResult.remaining} more leads are waiting. Run the sync again to continue.
                </p>
              )}
              {bulkSyncResult.accounts.some(a => a.errors.length > 0) && (
                <ScrollArea className="max-h-48 rounded-md border">
                  <div className="p-3 space-y-2">
                    {bulkSyncResult.accounts.filter(a => a.errors.length > 0).map(a => (
                      <div key={a.businessAccountId}>
                        <div className="text-xs font-semibold text-gray-700">{a.accountName}</div>
                        {a.errors.slice(0, 5).map((err, i) => (
                          <div key={i} className="text-xs text-red-600 break-words">{friendlySyncError(err)}</div>
                        ))}
                        {a.errors.length > 5 && <div className="text-xs text-gray-400">+{a.errors.length - 5} more</div>}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(SYNC_WINDOW_LABELS) as SyncWindow[]).map(w => (
                  <Button
                    key={w}
                    size="sm"
                    variant={bulkSyncWindow === w ? "default" : "outline"}
                    onClick={() => setBulkSyncWindow(w)}
                    disabled={bulkSyncMutation.isPending}
                  >
                    {SYNC_WINDOW_LABELS[w]}
                  </Button>
                ))}
              </div>

              {loadingUnsyncedPreview || !unsyncedPreview ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" /> Checking unsynced leads…
                </div>
              ) : (
                <div className="rounded-md border divide-y">
                  {unsyncedPreview.accounts.filter(a => a.leadsquared !== null || a.salesforce !== null).map(a => (
                    <div key={a.businessAccountId} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-gray-700 truncate mr-3">{a.accountName}</span>
                      <span className="flex gap-3 text-xs text-gray-500 tabular-nums shrink-0">
                        {a.leadsquared !== null && <span>LeadSquared: <span className="font-semibold text-gray-800">{a.leadsquared}</span></span>}
                        {a.salesforce !== null && <span>Salesforce: <span className="font-semibold text-gray-800">{a.salesforce}</span></span>}
                      </span>
                    </div>
                  ))}
                  {unsyncedPreview.accounts.every(a => a.leadsquared === null && a.salesforce === null) && (
                    <div className="px-3 py-3 text-sm text-gray-500">No account in this selection has a CRM configured.</div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {bulkSyncResult ? (
              <Button onClick={() => setBulkSyncOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setBulkSyncOpen(false)} disabled={bulkSyncMutation.isPending}>Cancel</Button>
                <Button
                  onClick={() => bulkSyncMutation.mutate()}
                  disabled={bulkSyncMutation.isPending || loadingUnsyncedPreview || !unsyncedPreview || unsyncedPreview.totalUnsynced === 0}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {bulkSyncMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  {bulkSyncMutation.isPending
                    ? 'Syncing…'
                    : unsyncedPreview?.totalUnsynced === 0 ? 'Nothing to sync' : `Sync now (${unsyncedPreview?.totalUnsynced ?? 0} pending)`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-md max-h-[60vh] overflow-y-auto">
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
                    <p className="font-medium">{(selectedLeadDetails as any).city || '—'}</p>
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
                    <span className="text-gray-500">Account:</span>
                    <p className="font-medium">{selectedLeadDetails.businessAccountName}</p>
                  </div>
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
                    ) : selectedLeadDetails.leadsquaredSyncStatus === 'failed' ? (
                      <Badge className="bg-red-100 text-red-700">
                        <XCircle className="h-3 w-3 mr-1" />
                        Failed
                      </Badge>
                    ) : (
                      <Badge className="bg-gray-100 text-gray-600">Not Synced</Badge>
                    )}
                  </div>
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
                          {entries.map(([key, value]) => (
                            <div key={key} className="flex text-xs">
                              <span className="text-gray-600 font-mono min-w-[140px] flex-shrink-0">{key}:</span>
                              <span className="text-gray-800 break-all">{value != null ? String(value) : '—'}</span>
                            </div>
                          ))}
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
                      <Badge key={idx} variant="outline" className="text-xs">{topic}</Badge>
                    ))}
                  </div>
                </div>
              )}
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
                <span>
                  {chatDialogConversation.title || 'Conversation'}
                  {chatDialogConversation.businessAccountName && (
                    <span className="ml-2 text-sm font-normal text-gray-500">· {chatDialogConversation.businessAccountName}</span>
                  )}
                </span>
              ) : null}
            </DialogTitle>
            {chatDialogConversation && (
              <p className="text-xs text-gray-500 mt-0.5">
                {chatDialogConversation.visitorCity && <span>{chatDialogConversation.visitorCity} · </span>}
                {format(new Date(chatDialogConversation.createdAt), 'MMM d, yyyy h:mm a')}
              </p>
            )}
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
  );
}
