import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { 
  Users, MessageSquare, TrendingUp, Calendar, Loader2, 
  BarChart3, Building2, Eye, Monitor, Smartphone, Tablet, 
  Globe, MapPin, Brain, Sparkles, AlertCircle, Package, Lightbulb,
  Check, ChevronsUpDown, Tag, Heart, RefreshCw, CheckCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths, formatDistanceToNow } from "date-fns";

type DatePreset = 'all' | 'today' | 'yesterday' | 'last7' | 'currentMonth' | 'lastMonth' | 'custom';

interface GroupAssignment {
  groupId: string;
  groupName: string;
  canViewConversations: boolean;
  canViewLeads: boolean;
  canViewAnalytics: boolean;
  canExportData: boolean;
}

interface LinkedAccount {
  id: string;
  name: string;
}

interface VisitorStats {
  totalVisitors: number;
  engagedVisitors: number;
  totalMessages: number;
  leadsGenerated: number;
  avgSessionDuration: number;
  deviceBreakdown: { desktop: number; mobile: number; tablet: number };
  topCountries: { country: string; count: number }[];
  topCities: { city: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
}

interface PageVisitorStats {
  uniqueVisitors: number;
  engagedVisitors: number;
  engagementRate: number;
  deviceBreakdown: { desktop: number; mobile: number; tablet: number };
  topCountries: { country: string; count: number }[];
  topCities: { city: string; count: number }[];
}

interface ConversationAnalysis {
  topicsOfInterest: string[];
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
    overall: 'positive' | 'neutral' | 'negative';
  };
  commonPatterns: string[];
  engagementInsights: {
    avgMessagesPerConversation: number;
    totalConversations: number;
    mostActiveTopics: string[];
  };
  summary?: string;
  recommendations?: string[];
  cachedAt?: string | null;
  conversationCount?: number;
}

interface SubcategoryItem {
  subcategory: string;
  count: number;
}

interface ConversationCategory {
  category: string;
  count: number;
  label: string;
  subcategories: SubcategoryItem[];
}

interface AccountStats {
  leads: number;
  conversations: number;
  products: number;
  conversionRate: string;
}

interface LeadBreakdown {
  totalLeads: number;
  captureMethodBreakdown: { method: string; count: number }[];
  topicsBreakdown: { topic: string; count: number }[];
}

export default function GroupAdminInsights() {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [accountComboboxOpen, setAccountComboboxOpen] = useState(false);

  // Fetch group assignments to get the group ID
  // Uses default queryFn (same cache as GroupAdminDashboard) to avoid stale cache conflicts
  const { data: groupsData } = useQuery<{ groups: GroupAssignment[] }>({
    queryKey: ["/api/group-admin/groups"],
  });

  const groupAssignments = groupsData?.groups || [];

  useEffect(() => {
    if (groupAssignments.length > 0 && !selectedGroupId) {
      setSelectedGroupId(groupAssignments[0].groupId);
    }
  }, [groupAssignments, selectedGroupId]);

  const activeGroupId = selectedGroupId || groupAssignments[0]?.groupId;

  // Fetch linked accounts for the selected group
  const { data: linkedAccountsData } = useQuery<{ accounts: LinkedAccount[] }>({
    queryKey: ["/api/group-admin/groups", activeGroupId, "linked-accounts"],
    enabled: !!activeGroupId,
  });

  const linkedAccounts = linkedAccountsData?.accounts || [];

  useEffect(() => {
    if (linkedAccounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(linkedAccounts[0].id);
    }
  }, [linkedAccounts, selectedAccountId]);

  // Build date params
  const dateParams = useMemo(() => {
    const params = new URLSearchParams();
    
    if (datePreset === 'all') {
      return '';
    }
    
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
      case 'currentMonth':
        from = startOfMonth(today);
        to = endOfMonth(today);
        break;
      case 'lastMonth':
        const lastMonthDate = subMonths(today, 1);
        from = startOfMonth(lastMonthDate);
        to = endOfMonth(lastMonthDate);
        break;
      case 'custom':
        from = fromDate ? startOfDay(fromDate) : undefined;
        to = toDate ? endOfDay(toDate) : undefined;
        break;
    }
    
    if (from) params.append('fromDate', from.toISOString());
    if (to) params.append('toDate', to.toISOString());
    
    return params.toString() ? `?${params.toString()}` : '';
  }, [datePreset, fromDate, toDate]);

  // Fetch account stats
  const { data: accountStats, isLoading: isStatsLoading } = useQuery<AccountStats>({
    queryKey: ["/api/group-admin/groups", activeGroupId, "accounts", selectedAccountId, "stats", dateParams],
    queryFn: async () => {
      const response = await fetch(
        `/api/group-admin/groups/${activeGroupId}/accounts/${selectedAccountId}/stats${dateParams}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch account stats");
      return response.json();
    },
    enabled: !!activeGroupId && !!selectedAccountId,
  });

  // Fetch visitor stats
  const { data: visitorStats, isLoading: isVisitorLoading } = useQuery<VisitorStats>({
    queryKey: ["/api/group-admin/groups", activeGroupId, "accounts", selectedAccountId, "visitor-stats", dateParams],
    queryFn: async () => {
      const response = await fetch(
        `/api/group-admin/groups/${activeGroupId}/accounts/${selectedAccountId}/visitor-stats${dateParams}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch visitor stats");
      return response.json();
    },
    enabled: !!activeGroupId && !!selectedAccountId,
  });

  // Fetch page visitor stats
  const { data: pageVisitorStats, isLoading: isPageVisitorLoading } = useQuery<PageVisitorStats>({
    queryKey: ["/api/group-admin/groups", activeGroupId, "accounts", selectedAccountId, "page-visitor-stats", dateParams],
    queryFn: async () => {
      const response = await fetch(
        `/api/group-admin/groups/${activeGroupId}/accounts/${selectedAccountId}/page-visitor-stats${dateParams}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch page visitor stats");
      return response.json();
    },
    enabled: !!activeGroupId && !!selectedAccountId,
  });

  // Fetch conversation categories
  const { data: categoryData, isLoading: isCategoriesLoading } = useQuery<{ categories: ConversationCategory[] }>({
    queryKey: ["/api/group-admin/groups", activeGroupId, "accounts", selectedAccountId, "conversation-categories", dateParams],
    queryFn: async () => {
      const response = await fetch(
        `/api/group-admin/groups/${activeGroupId}/accounts/${selectedAccountId}/conversation-categories${dateParams}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch conversation categories");
      return response.json();
    },
    enabled: !!activeGroupId && !!selectedAccountId,
  });

  // Fetch lead breakdown
  const { data: leadBreakdown, isLoading: isLeadBreakdownLoading, error: leadBreakdownError } = useQuery<LeadBreakdown>({
    queryKey: ["/api/group-admin/groups", activeGroupId, "accounts", selectedAccountId, "lead-breakdown", dateParams],
    queryFn: async () => {
      const response = await fetch(
        `/api/group-admin/groups/${activeGroupId}/accounts/${selectedAccountId}/lead-breakdown${dateParams}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch lead breakdown");
      return response.json();
    },
    enabled: !!activeGroupId && !!selectedAccountId,
  });

  const [isRefreshingReport, setIsRefreshingReport] = useState(false);

  // Fetch AI conversation analysis (cached weekly report — always last 7 days)
  const { data: conversationAnalysis, isLoading: isAnalysisLoading, error: analysisError, refetch: refetchAnalysis } = useQuery<ConversationAnalysis>({
    queryKey: ["/api/group-admin/groups", activeGroupId, "accounts", selectedAccountId, "conversation-analysis"],
    queryFn: async () => {
      const response = await fetch(
        `/api/group-admin/groups/${activeGroupId}/accounts/${selectedAccountId}/conversation-analysis`,
        { credentials: "include" }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch conversation analysis");
      }
      return response.json();
    },
    enabled: !!activeGroupId && !!selectedAccountId && (accountStats?.conversations || 0) > 0,
    staleTime: 5 * 60 * 1000,
  });

  const handleRefreshReport = async () => {
    setIsRefreshingReport(true);
    try {
      const response = await fetch(
        `/api/group-admin/groups/${activeGroupId}/accounts/${selectedAccountId}/conversation-analysis?refresh=true`,
        { credentials: "include" }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to refresh report");
      }
      await refetchAnalysis();
    } catch (err) {
      console.error("Failed to refresh report:", err);
    } finally {
      setIsRefreshingReport(false);
    }
  };

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const dynamicColorPalette = [
    { bg: "bg-blue-100", text: "text-blue-700", bar: "bg-blue-200" },
    { bg: "bg-green-100", text: "text-green-700", bar: "bg-green-200" },
    { bg: "bg-purple-100", text: "text-purple-700", bar: "bg-purple-200" },
    { bg: "bg-orange-100", text: "text-orange-700", bar: "bg-orange-200" },
    { bg: "bg-pink-100", text: "text-pink-700", bar: "bg-pink-200" },
    { bg: "bg-cyan-100", text: "text-cyan-700", bar: "bg-cyan-200" },
    { bg: "bg-yellow-100", text: "text-yellow-700", bar: "bg-yellow-200" },
    { bg: "bg-indigo-100", text: "text-indigo-700", bar: "bg-indigo-200" },
    { bg: "bg-teal-100", text: "text-teal-700", bar: "bg-teal-200" },
    { bg: "bg-rose-100", text: "text-rose-700", bar: "bg-rose-200" },
    { bg: "bg-red-100", text: "text-red-700", bar: "bg-red-200" },
    { bg: "bg-gray-100", text: "text-gray-700", bar: "bg-gray-200" },
  ];

  const getCategoryColor = (index: number) => {
    return dynamicColorPalette[index % dynamicColorPalette.length];
  };

  const selectedAccountName = linkedAccounts.find(a => a.id === selectedAccountId)?.name || 'Select Account';

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <Lightbulb className="w-6 h-6 text-purple-600" />
              <div>
                <h1 className="text-xl font-semibold">Account Insights</h1>
                <p className="text-sm text-gray-500">Detailed analytics for linked accounts</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-7xl mx-auto w-full">
        {/* Account Selector */}
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Select Account:</span>
              </div>
              <Popover open={accountComboboxOpen} onOpenChange={setAccountComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={accountComboboxOpen}
                    className="w-full sm:w-[300px] justify-between"
                  >
                    {selectedAccountId
                      ? linkedAccounts.find((account) => account.id === selectedAccountId)?.name
                      : "Select a linked account"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search accounts..." />
                    <CommandList className="max-h-[200px]">
                      <CommandEmpty>No account found.</CommandEmpty>
                      <CommandGroup>
                        {linkedAccounts.map((account) => (
                          <CommandItem
                            key={account.id}
                            value={account.name}
                            onSelect={() => {
                              setSelectedAccountId(account.id);
                              setAccountComboboxOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedAccountId === account.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {account.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>

        {!selectedAccountId ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select an Account</h3>
              <p className="text-gray-500">
                Choose a linked account from the dropdown above to view detailed insights.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Date Filter */}
            <Card className="mb-4">
              <CardContent className="p-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">Filter by date:</span>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant={datePreset === 'today' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDatePreset('today')}
                    >
                      Today
                    </Button>
                    <Button
                      variant={datePreset === 'yesterday' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDatePreset('yesterday')}
                    >
                      Yesterday
                    </Button>
                    <Button
                      variant={datePreset === 'last7' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDatePreset('last7')}
                    >
                      Last 7 Days
                    </Button>
                    <Button
                      variant={datePreset === 'currentMonth' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDatePreset('currentMonth')}
                    >
                      Current Month
                    </Button>
                    <Button
                      variant={datePreset === 'lastMonth' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDatePreset('lastMonth')}
                    >
                      Last Month
                    </Button>
                    <Button
                      variant={datePreset === 'all' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDatePreset('all')}
                    >
                      Lifetime
                    </Button>
                    
                    {/* Custom Date Range */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant={datePreset === 'custom' ? 'default' : 'outline'}
                          size="sm"
                          className="gap-2"
                        >
                          <Calendar className="w-4 h-4" />
                          {datePreset === 'custom' && fromDate && toDate ? (
                            <span className="text-xs">
                              {format(fromDate, 'MMM d')} - {format(toDate, 'MMM d, yyyy')}
                            </span>
                          ) : (
                            'Custom Range'
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <div className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-gray-900">Select Date Range</h4>
                            {(fromDate || toDate) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setFromDate(undefined);
                                  setToDate(undefined);
                                }}
                              >
                                Clear
                              </Button>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-xs text-gray-500 mb-2">From</p>
                              <CalendarComponent
                                mode="single"
                                selected={fromDate}
                                onSelect={(date) => {
                                  setFromDate(date);
                                  setDatePreset('custom');
                                }}
                                className="rounded-md border"
                              />
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-2">To</p>
                              <CalendarComponent
                                mode="single"
                                selected={toDate}
                                onSelect={(date) => {
                                  setToDate(date);
                                  setDatePreset('custom');
                                }}
                                className="rounded-md border"
                              />
                            </div>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <Users className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{isStatsLoading ? '-' : accountStats?.leads || 0}</p>
                      <p className="text-sm text-gray-500">Total Leads</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <MessageSquare className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{isStatsLoading ? '-' : accountStats?.conversations || 0}</p>
                      <p className="text-sm text-gray-500">Conversations</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-50 rounded-lg">
                      <TrendingUp className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{isStatsLoading ? '-' : `${accountStats?.conversionRate || 0}%`}</p>
                      <p className="text-sm text-gray-500">Conversion Rate</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-50 rounded-lg">
                      <Package className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{isStatsLoading ? '-' : accountStats?.products || 0}</p>
                      <p className="text-sm text-gray-500">Products</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Visitor Insights */}
            <Card className="mb-4">
              <CardHeader className="pb-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Eye className="w-4 h-4 text-indigo-600" />
                    Visitor Insights
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Track website visitors interacting with your chat widget
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {isVisitorLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                  </div>
                ) : (!visitorStats || (visitorStats.totalVisitors === 0 && visitorStats.engagedVisitors === 0 && visitorStats.leadsGenerated === 0 && visitorStats.deviceBreakdown.desktop === 0 && visitorStats.deviceBreakdown.mobile === 0 && visitorStats.deviceBreakdown.tablet === 0)) ? (
                  <div className="text-center py-8 text-gray-500">
                    <Eye className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium mb-1">No visitor data yet</p>
                    <p className="text-xs text-gray-400">
                      Visitor tracking starts when customers use the embedded chat widget.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Visitor Stats Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                      <div className="p-3 bg-indigo-50 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <Eye className="w-4 h-4 text-indigo-600" />
                          <span className="text-xs font-medium text-gray-700">Opened Chat</span>
                        </div>
                        <p className="text-2xl font-bold text-indigo-600">{visitorStats.totalVisitors}</p>
                      </div>
                      
                      <div className="p-3 bg-green-50 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <MessageSquare className="w-4 h-4 text-green-600" />
                          <span className="text-xs font-medium text-gray-700">Engaged</span>
                        </div>
                        <p className="text-2xl font-bold text-green-600">{visitorStats.engagedVisitors}</p>
                      </div>
                      
                      <div className="p-3 bg-purple-50 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <Users className="w-4 h-4 text-purple-600" />
                          <span className="text-xs font-medium text-gray-700">Leads Generated</span>
                        </div>
                        <p className="text-2xl font-bold text-purple-600">{visitorStats.leadsGenerated}</p>
                      </div>
                    </div>

                    {/* Device Breakdown & Traffic Sources */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Device Breakdown */}
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                          <Monitor className="w-4 h-4" />
                          Device Breakdown
                        </h4>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Monitor className="w-4 h-4 text-gray-500" />
                              <span className="text-sm text-gray-600">Desktop</span>
                            </div>
                            <span className="text-sm font-medium">{visitorStats.deviceBreakdown?.desktop || 0}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Smartphone className="w-4 h-4 text-gray-500" />
                              <span className="text-sm text-gray-600">Mobile</span>
                            </div>
                            <span className="text-sm font-medium">{visitorStats.deviceBreakdown?.mobile || 0}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Tablet className="w-4 h-4 text-gray-500" />
                              <span className="text-sm text-gray-600">Tablet</span>
                            </div>
                            <span className="text-sm font-medium">{visitorStats.deviceBreakdown?.tablet || 0}</span>
                          </div>
                        </div>
                      </div>

                      {/* Traffic Sources */}
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                          <Globe className="w-4 h-4" />
                          Top Traffic Sources
                        </h4>
                        {(visitorStats.topReferrers?.length || 0) > 0 ? (
                          <div className="space-y-2">
                            {visitorStats.topReferrers?.slice(0, 5).map((ref, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-2">
                                <span className="text-sm text-gray-600 break-all flex-1 truncate">{ref.referrer}</span>
                                <span className="text-sm font-medium flex-shrink-0">{ref.count}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">No referrer data yet</p>
                        )}
                      </div>
                    </div>

                    {/* Top Countries & Cities */}
                    {((visitorStats.topCountries?.length || 0) > 0 || (visitorStats.topCities?.length || 0) > 0) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        {/* Top Countries */}
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                            <Globe className="w-4 h-4" />
                            Top Countries
                          </h4>
                          {(visitorStats.topCountries?.length || 0) > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {visitorStats.topCountries?.slice(0, 6).map((country, idx) => (
                                <div key={idx} className="px-3 py-1.5 bg-white rounded-full border text-sm">
                                  <span className="text-gray-700">{country.country}</span>
                                  <span className="ml-2 text-gray-500">({country.count})</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500">No country data yet</p>
                          )}
                        </div>

                        {/* Top Cities */}
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                            <MapPin className="w-4 h-4" />
                            Top Cities
                          </h4>
                          {(visitorStats.topCities?.length || 0) > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {visitorStats.topCities?.slice(0, 6).map((city, idx) => (
                                <div key={idx} className="px-3 py-1.5 bg-white rounded-full border text-sm">
                                  <span className="text-gray-700">{city.city}</span>
                                  <span className="ml-2 text-gray-500">({city.count})</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500">No city data yet</p>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Conversation Topics */}
            <Card className="mb-4">
              <CardHeader className="pb-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Tag className="w-4 h-4 text-teal-600" />
                    Conversation Topics
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Conversations are automatically categorized by AI when they end
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {isCategoriesLoading ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-gray-400" />
                    <p className="text-sm text-gray-500">Loading categories...</p>
                  </div>
                ) : !categoryData?.categories?.length ? (
                  <div className="text-center py-8 text-gray-500">
                    <Tag className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium mb-1">No categorized conversations yet</p>
                    <p className="text-xs text-gray-400">
                      Conversations will be automatically categorized after they end
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm text-gray-600 mb-4">
                      {categoryData.categories.reduce((sum, c) => sum + c.count, 0)} conversations categorized
                    </div>
                    
                    <div className="space-y-1">
                      {categoryData.categories
                        .sort((a, b) => b.count - a.count)
                        .map((cat, index) => {
                          const total = categoryData.categories.reduce((sum, c) => sum + c.count, 0);
                          const percentage = total > 0 ? ((cat.count / total) * 100).toFixed(1) : "0";
                          const colors = getCategoryColor(index);
                          const isExpanded = expandedCategories.has(cat.category);
                          const hasSubcategories = cat.subcategories && cat.subcategories.length > 0;
                          
                          return (
                            <div key={cat.category}>
                              <div
                                className={`flex items-center gap-3 py-1.5 px-2 rounded-md transition-colors ${hasSubcategories ? "cursor-pointer hover:bg-gray-50" : ""}`}
                                onClick={() => hasSubcategories && toggleCategory(cat.category)}
                              >
                                {hasSubcategories && (
                                  <svg className={`w-3 h-3 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                )}
                                {!hasSubcategories && <div className="w-3" />}
                                <div className={`px-2 py-1 rounded text-xs font-medium min-w-[120px] ${colors.bg} ${colors.text}`}>
                                  {cat.label}
                                </div>
                                <div className="flex-1 bg-gray-100 rounded-full h-4 relative overflow-hidden">
                                  <div
                                    className={`h-full ${colors.bg} transition-all duration-300`}
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                                <div className="text-sm font-semibold text-gray-700 min-w-[60px] text-right">
                                  {cat.count} <span className="text-gray-400 font-normal">({percentage}%)</span>
                                </div>
                              </div>
                              {isExpanded && hasSubcategories && (
                                <div className="ml-8 mt-1 mb-2 space-y-1 pl-4 border-l-2 border-gray-200">
                                  {cat.subcategories.map((sub) => {
                                    const subPercentage = cat.count > 0 ? ((sub.count / cat.count) * 100).toFixed(0) : "0";
                                    return (
                                      <div key={sub.subcategory} className="flex items-center gap-3 py-0.5">
                                        <div className={`px-2 py-0.5 rounded text-xs min-w-[100px] ${colors.bar} ${colors.text} opacity-80`}>
                                          {sub.subcategory}
                                        </div>
                                        <div className="flex-1 bg-gray-50 rounded-full h-2.5 relative overflow-hidden">
                                          <div
                                            className={`h-full ${colors.bar} transition-all duration-300`}
                                            style={{ width: `${subPercentage}%` }}
                                          />
                                        </div>
                                        <div className="text-xs text-gray-500 min-w-[50px] text-right">
                                          {sub.count} <span className="text-gray-400">({subPercentage}%)</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Lead Breakdown */}
            <Card className="mb-4">
              <CardHeader className="pb-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Users className="w-4 h-4 text-indigo-600" />
                    Lead Breakdown
                  </CardTitle>
                  <CardDescription className="text-xs">
                    How leads were captured, their topics of interest, and where they came from
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {isLeadBreakdownLoading ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-gray-400" />
                    <p className="text-sm text-gray-500">Loading lead breakdown...</p>
                  </div>
                ) : leadBreakdownError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Failed to load lead breakdown. Please try again.
                    </AlertDescription>
                  </Alert>
                ) : !leadBreakdown?.totalLeads ? (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium mb-1">No leads in this period</p>
                    <p className="text-xs text-gray-400">
                      Lead breakdowns will appear here once leads are captured
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="text-sm text-gray-600">
                      {leadBreakdown.totalLeads} {leadBreakdown.totalLeads === 1 ? "lead" : "leads"} captured
                    </div>

                    {/* Capture Method */}
                    {leadBreakdown.captureMethodBreakdown.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-gray-700">
                          <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
                          Capture Method
                        </div>
                        <div className="space-y-1">
                          {leadBreakdown.captureMethodBreakdown.map((item, index) => {
                            const percentage = leadBreakdown.totalLeads > 0
                              ? ((item.count / leadBreakdown.totalLeads) * 100).toFixed(1) : "0";
                            const colors = getCategoryColor(index);
                            return (
                              <div key={item.method} className="flex items-center gap-3 py-1.5 px-2 rounded-md">
                                <div className={`px-2 py-1 rounded text-xs font-medium min-w-[140px] ${colors.bg} ${colors.text}`}>
                                  {item.method}
                                </div>
                                <div className="flex-1 bg-gray-100 rounded-full h-4 relative overflow-hidden">
                                  <div
                                    className={`h-full ${colors.bg} transition-all duration-300`}
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                                <div className="text-sm font-semibold text-gray-700 min-w-[70px] text-right">
                                  {item.count} <span className="text-gray-400 font-normal">({percentage}%)</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Topics of Interest */}
                    {leadBreakdown.topicsBreakdown.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-gray-700">
                          <Tag className="w-3.5 h-3.5 text-indigo-500" />
                          Topics of Interest
                        </div>
                        <div className="space-y-1">
                          {leadBreakdown.topicsBreakdown.map((item, index) => {
                            const topTopicCount = leadBreakdown.topicsBreakdown[0]?.count || 1;
                            const percentage = ((item.count / topTopicCount) * 100).toFixed(0);
                            const colors = getCategoryColor(index);
                            return (
                              <div key={item.topic} className="flex items-center gap-3 py-1.5 px-2 rounded-md">
                                <div className={`px-2 py-1 rounded text-xs font-medium min-w-[140px] ${colors.bg} ${colors.text}`}>
                                  {item.topic}
                                </div>
                                <div className="flex-1 bg-gray-100 rounded-full h-4 relative overflow-hidden">
                                  <div
                                    className={`h-full ${colors.bg} transition-all duration-300`}
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                                <div className="text-sm font-semibold text-gray-700 min-w-[40px] text-right">
                                  {item.count}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Weekly AI Report */}
            <Card className="mb-4">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Brain className="w-4 h-4 text-purple-600" />
                      Weekly AI Report
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Based on last 7 days of conversations
                      {conversationAnalysis?.cachedAt && (
                        <span className="ml-2 text-gray-500">
                          · Generated {formatDistanceToNow(new Date(conversationAnalysis.cachedAt), { addSuffix: true })}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshReport}
                    disabled={isRefreshingReport || isAnalysisLoading}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingReport ? 'animate-spin' : ''}`} />
                    {isRefreshingReport ? 'Generating...' : conversationAnalysis?.cachedAt ? 'Refresh Report' : 'Generate Report'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {(isAnalysisLoading || isRefreshingReport) ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-3"></div>
                    <p className="text-sm text-gray-600">
                      {isRefreshingReport ? 'Generating fresh AI report...' : 'Loading cached report...'}
                    </p>
                  </div>
                ) : analysisError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      {(analysisError as Error).message || "Failed to analyze conversations"}
                    </AlertDescription>
                  </Alert>
                ) : conversationAnalysis ? (
                  <div className="space-y-3">
                    {/* Summary */}
                    {conversationAnalysis.summary && (
                      <div className="p-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                        <div className="flex items-start gap-2">
                          <Sparkles className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-gray-800 leading-relaxed">{conversationAnalysis.summary}</p>
                        </div>
                      </div>
                    )}

                    {/* Recommendations */}
                    {conversationAnalysis.recommendations && conversationAnalysis.recommendations.length > 0 && (
                      <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                        <div className="flex items-center gap-1.5 mb-2">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <h3 className="text-sm font-semibold text-gray-900">Recommendations</h3>
                        </div>
                        <ul className="space-y-1.5">
                          {conversationAnalysis.recommendations.map((rec, index) => (
                            <li key={index} className="flex items-start gap-2 text-xs text-gray-800">
                              <span className="text-green-600 font-bold mt-0.5">{index + 1}.</span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {/* Topics of Interest */}
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Lightbulb className="w-4 h-4 text-blue-600" />
                          <h3 className="text-sm font-semibold text-gray-900">Topics of Interest</h3>
                        </div>
                        {conversationAnalysis.topicsOfInterest?.length > 0 ? (
                          <div className="space-y-1.5">
                            {conversationAnalysis.topicsOfInterest.map((topic, index) => (
                              <div key={index} className="flex items-center gap-2 bg-white p-1.5 rounded-md">
                                <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                                  <span className="text-xs font-bold text-blue-600">{index + 1}</span>
                                </div>
                                <span className="text-xs text-gray-800">{topic}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-600">No specific topics identified yet.</p>
                        )}
                      </div>

                      {/* Sentiment Analysis */}
                      <div className="p-3 bg-pink-50 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Heart className="w-4 h-4 text-pink-600" />
                          <h3 className="text-sm font-semibold text-gray-900">User Sentiment</h3>
                        </div>
                        {conversationAnalysis.sentiment && (
                          <div className="space-y-1.5">
                            <div>
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs text-gray-700">Positive</span>
                                <span className="text-xs font-semibold text-green-600">
                                  {conversationAnalysis.sentiment.positive}%
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-1.5">
                                <div
                                  className="bg-green-500 h-1.5 rounded-full"
                                  style={{ width: `${conversationAnalysis.sentiment.positive}%` }}
                                ></div>
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs text-gray-700">Neutral</span>
                                <span className="text-xs font-semibold text-gray-600">
                                  {conversationAnalysis.sentiment.neutral}%
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-1.5">
                                <div
                                  className="bg-gray-500 h-1.5 rounded-full"
                                  style={{ width: `${conversationAnalysis.sentiment.neutral}%` }}
                                ></div>
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs text-gray-700">Negative</span>
                                <span className="text-xs font-semibold text-red-600">
                                  {conversationAnalysis.sentiment.negative}%
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-1.5">
                                <div
                                  className="bg-red-500 h-1.5 rounded-full"
                                  style={{ width: `${conversationAnalysis.sentiment.negative}%` }}
                                ></div>
                              </div>
                            </div>
                            <div className="mt-2 p-1.5 bg-white rounded-md">
                              <p className="text-xs text-gray-600">
                                Overall: <span className={`font-semibold ${
                                  conversationAnalysis.sentiment.overall === 'positive' ? 'text-green-600' :
                                  conversationAnalysis.sentiment.overall === 'negative' ? 'text-red-600' :
                                  'text-gray-600'
                                }`}>
                                  {conversationAnalysis.sentiment.overall.charAt(0).toUpperCase() + 
                                   conversationAnalysis.sentiment.overall.slice(1)}
                                </span>
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {/* Common Patterns */}
                      <div className="p-3 bg-purple-50 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-2">
                          <MessageSquare className="w-4 h-4 text-purple-600" />
                          <h3 className="text-sm font-semibold text-gray-900">Common Patterns</h3>
                        </div>
                        {conversationAnalysis.commonPatterns?.length > 0 ? (
                          <ul className="space-y-1">
                            {conversationAnalysis.commonPatterns.map((pattern, index) => (
                              <li key={index} className="flex items-start gap-1.5 text-xs text-gray-800">
                                <span className="text-purple-600 mt-0.5">•</span>
                                <span>{pattern}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-gray-600">No common patterns detected yet.</p>
                        )}
                      </div>

                      {/* Engagement Insights */}
                      <div className="p-3 bg-orange-50 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-2">
                          <TrendingUp className="w-4 h-4 text-orange-600" />
                          <h3 className="text-sm font-semibold text-gray-900">Engagement Insights</h3>
                        </div>
                        <div className="space-y-2">
                          <div className="bg-white p-2 rounded-md">
                            <p className="text-xs text-gray-600 mb-0.5">Avg Messages per Conversation</p>
                            <p className="text-xl font-bold text-orange-600">
                              {conversationAnalysis.engagementInsights?.avgMessagesPerConversation?.toFixed(1) || '0.0'}
                            </p>
                          </div>
                          {conversationAnalysis.engagementInsights?.mostActiveTopics?.length > 0 && (
                            <div className="bg-white p-2 rounded-md">
                              <p className="text-xs text-gray-600 mb-1.5">Most Active Topics</p>
                              <div className="flex flex-wrap gap-1.5">
                                {conversationAnalysis.engagementInsights.mostActiveTopics.map((topic, index) => (
                                  <span
                                    key={index}
                                    className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full"
                                  >
                                    {topic}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium mb-1">No conversations to analyze yet</p>
                    <p className="text-xs text-gray-400">Start conversations to get AI-powered insights</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
