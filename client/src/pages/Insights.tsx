import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, MessageSquare, Package, Users, TrendingUp, Clock, Calendar, Brain, Lightbulb, Heart, AlertCircle, Sparkles, ClipboardList, Eye, Monitor, Smartphone, Tablet, Globe, MapPin, Tag, Loader2, ArrowRight, FileText, Zap, Leaf, Percent, RefreshCw, CheckCircle, Settings, X, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format, subDays, startOfDay, endOfDay, startOfMonth, formatDistanceToNow } from "date-fns";
import { useState, useMemo } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import WebsiteNavTabs from "@/components/WebsiteNavTabs";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer
} from "recharts";

interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
}

interface Conversation {
  id: string;
  createdAt: string;
}

interface Product {
  id: string;
  name: string;
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

interface PageVisitorStats {
  uniqueVisitors: number;
  totalPageVisitors: number;
  engagedVisitors: number;
  leadsGenerated: number;
  engagementRate: number;
  deviceBreakdown: { desktop: number; mobile: number; tablet: number };
  topCountries: { country: string; count: number }[];
  topCities: { city: string; count: number }[];
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

interface RelevanceSummary {
  relevant: number;
  irrelevant: number;
  uncategorized: number;
}

interface AccountAnalyticsData {
  conversationFunnel: { total: number; leadsGenerated: number; conversionRate: number };
  conversationBreakdown: { journey: number; form: number; chat: number; discountAvailed: number; total: number };
  leadSources: { form: number; journey: number; chat: number; discountAvailed: number; total: number };
  trafficSources: { paid: number; organic: number; total: number };
}

const ACCT_PIE_COLORS: Record<string, string> = {
  journey: '#8b5cf6', form: '#10b981', chat: '#3b82f6', discountAvailed: '#f97316',
};

const acctPct = (v: number, total: number) => total > 0 ? `${Math.round((v / total) * 100)}%` : '0%';

type DatePreset = 'all' | 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'custom';

export default function Insights() {
  const [, setLocation] = useLocation();
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);

  // Memoize date params to prevent unnecessary refetches
  const dateParams = useMemo(() => {
    const params = new URLSearchParams();
    
    if (datePreset === 'all') {
      return '';
    }
    
    let from: Date | undefined;
    let to: Date | undefined;
    
    // Get current date normalized to start of day to prevent constant changes
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
      case 'thisMonth':
        from = startOfMonth(today);
        to = endOfDay(today);
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

  // Build URL with limit parameter for fetching all data
  const leadsUrl = dateParams ? `/api/leads${dateParams}&limit=1000` : '/api/leads?limit=1000';
  const conversationsUrl = dateParams ? `/api/conversations${dateParams}&limit=1000` : '/api/conversations?limit=1000';

  const { data: leadsData } = useQuery<{ leads: Lead[]; total: number }>({
    queryKey: ["/api/leads", dateParams],
    queryFn: async () => {
      const response = await fetch(leadsUrl, {
        credentials: "include",
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) {
        throw new Error("Failed to fetch leads");
      }
      return response.json();
    },
    staleTime: 0, // Always refetch when date params change
  });
  const leads = leadsData?.leads || [];
  const totalLeadsCount = leadsData?.total || 0;

  const { data: conversationsData } = useQuery<{ conversations: Conversation[]; total: number }>({
    queryKey: ["/api/conversations", dateParams],
    queryFn: async () => {
      const response = await fetch(conversationsUrl, {
        credentials: "include",
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) {
        throw new Error("Failed to fetch conversations");
      }
      return response.json();
    },
    staleTime: 0, // Always refetch when date params change
  });
  const conversations = conversationsData?.conversations || [];
  const totalConversationsCount = conversationsData?.total || 0;

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  // Fetch Question Bank stats
  const { data: questionBankStats } = useQuery<{
    total: number;
    new: number;
    reviewing: number;
    resolved: number;
    byCategory: Record<string, number>;
  }>({
    queryKey: ["/api/question-bank/stats"],
    queryFn: async () => {
      const response = await fetch("/api/question-bank/stats", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch question bank stats");
      }
      return response.json();
    },
  });

  const [isRefreshingReport, setIsRefreshingReport] = useState(false);

  // Fetch AI conversation analysis (cached weekly report)
  const { data: conversationAnalysis, isLoading: isAnalysisLoading, error: analysisError, refetch: refetchAnalysis } = useQuery<ConversationAnalysis>({
    queryKey: ["/api/insights/conversation-analysis"],
    queryFn: async () => {
      const response = await fetch(`/api/insights/conversation-analysis`, {
        credentials: "include",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch conversation analysis");
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const handleRefreshReport = async () => {
    setIsRefreshingReport(true);
    try {
      const response = await fetch(`/api/insights/conversation-analysis?refresh=true`, {
        credentials: "include",
      });
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

  // Fetch conversation category breakdown
  const { data: categoryBreakdown, isLoading: isCategoriesLoading } = useQuery<{ categories: ConversationCategory[]; relevanceSummary: RelevanceSummary }>({
    queryKey: ["/api/insights/conversation-categories", dateParams],
    queryFn: async () => {
      const response = await fetch(`/api/insights/conversation-categories${dateParams}`, {
        credentials: "include",
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) {
        throw new Error("Failed to fetch conversation categories");
      }
      return response.json();
    },
    staleTime: 0,
  });

  // Fetch account analytics (funnel, pie charts, traffic)
  const { data: accountAnalytics } = useQuery<AccountAnalyticsData>({
    queryKey: ["/api/analytics/account-analytics", dateParams],
    queryFn: async () => {
      const response = await fetch(`/api/analytics/account-analytics${dateParams}`, {
        credentials: "include",
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) throw new Error("Failed to fetch account analytics");
      return response.json();
    },
    staleTime: 0,
  });

  // Fetch page visitor stats (from daily aggregated stats)
  const { data: pageVisitorStats } = useQuery<PageVisitorStats>({
    queryKey: ["/api/page-visitors/stats", dateParams],
    queryFn: async () => {
      const response = await fetch(`/api/page-visitors/stats${dateParams}`, {
        credentials: "include",
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) {
        throw new Error("Failed to fetch page visitor stats");
      }
      return response.json();
    },
    staleTime: 0, // Always refetch when date params change
  });

  const queryClient = useQueryClient();

  const categorizeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/insights/categorize-conversations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to categorize");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insights/conversation-categories"] });
    },
  });

  const { toast } = useToast();


  // Calculate insights - use total from API for accurate counts with date filtering
  const totalLeads = totalLeadsCount;
  const totalConversations = totalConversationsCount;
  const totalProducts = products.length;

  // Calculate conversion rate (leads / conversations)
  const conversionRate = totalConversations > 0 
    ? ((totalLeads / totalConversations) * 100).toFixed(1)
    : "0.0";

  // Category colors for visual distinction
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

  // Get context-aware description based on selected filter
  const getFilterDescription = (count: number, type: string) => {
    switch (datePreset) {
      case 'all':
        return `${count} total ${type}`;
      case 'today':
        return `${count} today`;
      case 'yesterday':
        return `${count} yesterday`;
      case 'last7':
        return `${count} in last 7 days`;
      case 'last30':
        return `${count} in last 30 days`;
      case 'thisMonth':
        return `${count} this month`;
      case 'custom':
        return `${count} in selected range`;
      default:
        return `${count} total`;
    }
  };

  const stats = [
    {
      title: "Total Leads",
      value: totalLeads,
      icon: Users,
      description: getFilterDescription(totalLeads, 'leads'),
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      title: "Total Conversations",
      value: totalConversations,
      icon: MessageSquare,
      description: getFilterDescription(totalConversations, 'conversations'),
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      title: "Products Listed",
      value: totalProducts,
      icon: Package,
      description: "Active products",
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      title: "Conversion Rate",
      value: `${conversionRate}%`,
      icon: TrendingUp,
      description: "Leads per conversation",
      color: "text-orange-600",
      bgColor: "bg-orange-50",
    },
    {
      title: "Unanswered Questions",
      value: questionBankStats?.total || 0,
      icon: ClipboardList,
      description: `${questionBankStats?.new || 0} new, ${questionBankStats?.resolved || 0} resolved`,
      color: "text-yellow-600",
      bgColor: "bg-yellow-50",
    },
  ];

  const getDateRangeLabel = () => {
    switch (datePreset) {
      case 'all':
        return 'All Time';
      case 'today':
        return 'Today';
      case 'yesterday':
        return 'Yesterday';
      case 'last7':
        return 'Last 7 Days';
      case 'last30':
        return 'Last 30 Days';
      case 'thisMonth':
        return 'This Month';
      case 'custom':
        if (fromDate && toDate) {
          return `${format(fromDate, 'MMM d, yyyy')} - ${format(toDate, 'MMM d, yyyy')}`;
        }
        if (fromDate) {
          return `From ${format(fromDate, 'MMM d, yyyy')}`;
        }
        if (toDate) {
          return `Until ${format(toDate, 'MMM d, yyyy')}`;
        }
        return 'Custom Range';
      default:
        return 'All Time';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <WebsiteNavTabs />
      <div className="p-3 md:p-4 max-w-7xl mx-auto">
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Insights</h1>
        <p className="text-sm text-gray-600">Track your business performance and customer engagement</p>
      </div>

      {/* Date Filter */}
      <Card className="mb-3">
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <div className="grid grid-cols-3 gap-2 max-w-md">
                <Button
                  variant={datePreset === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDatePreset('all')}
                  className="w-full"
                >
                  All Time
                </Button>
                <Button
                  variant={datePreset === 'today' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDatePreset('today')}
                  className="w-full"
                >
                  Today
                </Button>
                <Button
                  variant={datePreset === 'yesterday' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDatePreset('yesterday')}
                  className="w-full"
                >
                  Yesterday
                </Button>
                <Button
                  variant={datePreset === 'last7' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDatePreset('last7')}
                  className="w-full"
                >
                  Last 7 Days
                </Button>
                <Button
                  variant={datePreset === 'last30' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDatePreset('last30')}
                  className="w-full"
                >
                  Last 30 Days
                </Button>
                <Button
                  variant={datePreset === 'thisMonth' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDatePreset('thisMonth')}
                  className="w-full"
                >
                  This Month
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              
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
                    ) : datePreset === 'custom' && fromDate ? (
                      <span className="text-xs">From {format(fromDate, 'MMM d, yyyy')}</span>
                    ) : datePreset === 'custom' && toDate ? (
                      <span className="text-xs">Until {format(toDate, 'MMM d, yyyy')}</span>
                    ) : (
                      'Custom'
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
                          className="h-7 text-xs text-gray-500 hover:text-gray-700"
                          onClick={() => {
                            setFromDate(undefined);
                            setToDate(undefined);
                            setDatePreset('all');
                          }}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    
                    <div className="flex gap-4">
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">From</label>
                        <CalendarComponent
                          mode="single"
                          selected={fromDate}
                          onSelect={(date) => {
                            setFromDate(date);
                            setDatePreset('custom');
                          }}
                          disabled={(date) => date > new Date() || (toDate ? date > toDate : false)}
                          className="rounded-md border"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">To</label>
                        <CalendarComponent
                          mode="single"
                          selected={toDate}
                          onSelect={(date) => {
                            setToDate(date);
                            setDatePreset('custom');
                          }}
                          disabled={(date) => date > new Date() || (fromDate ? date < fromDate : false)}
                          className="rounded-md border"
                        />
                      </div>
                    </div>
                    
                    {fromDate && toDate && (
                      <div className="mt-3 pt-3 border-t text-center">
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">{format(fromDate, 'MMM d, yyyy')}</span>
                          <span className="mx-2 text-gray-400">to</span>
                          <span className="font-medium">{format(toDate, 'MMM d, yyyy')}</span>
                        </p>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              {datePreset !== 'all' && datePreset !== 'custom' && (
                <div className="text-sm text-gray-600 whitespace-nowrap">
                  Showing: <span className="font-medium">{getDateRangeLabel()}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conversation Funnel */}
      {accountAnalytics && (
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-purple-500" />
            Conversation Funnel
          </h2>
          <div className="flex flex-col md:flex-row items-stretch gap-3">
            <Card className="border-0 shadow-sm bg-white flex-1">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Conversations</span>
                </div>
                <p className="text-3xl font-bold text-gray-900">{accountAnalytics.conversationFunnel.total}</p>
                <p className="text-xs text-gray-400 mt-1">All chat sessions opened</p>
              </CardContent>
            </Card>

            <div className="hidden md:flex items-center flex-shrink-0 px-1">
              <ArrowRight className="w-5 h-5 text-gray-300" />
            </div>

            <Card className="border-0 shadow-sm bg-white flex-1">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
                    <Users className="w-5 h-5 text-green-600" />
                  </div>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Leads Generated</span>
                </div>
                <p className="text-3xl font-bold text-gray-900">{accountAnalytics.conversationFunnel.leadsGenerated}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {accountAnalytics.conversationFunnel.total > 0
                    ? `${accountAnalytics.conversationFunnel.conversionRate}% conversion rate`
                    : 'Contact info captured'}
                </p>
              </CardContent>
            </Card>

            <div className="hidden md:flex items-center flex-shrink-0 px-1">
              <ArrowRight className="w-5 h-5 text-gray-300" />
            </div>

            <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-pink-50 flex-1">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Percent className="w-5 h-5 text-purple-600" />
                  </div>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Conversion Rate</span>
                </div>
                <p className="text-3xl font-bold text-purple-700">{accountAnalytics.conversationFunnel.conversionRate}%</p>
                <div className="mt-2 bg-white/60 rounded-full h-1.5">
                  <div
                    className="bg-purple-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${Math.min(accountAnalytics.conversationFunnel.conversionRate, 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Conversation Breakdown + Lead Sources + Traffic Sources */}
      {accountAnalytics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-3">
          {/* Conversation Breakdown — Donut Chart */}
          <Card className="border border-gray-100 shadow-sm bg-white overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                  <MessageSquare className="w-4.5 h-4.5 text-purple-600" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Conversations</CardTitle>
                  <p className="text-xs text-gray-500">{accountAnalytics.conversationBreakdown.total} total conversations</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {accountAnalytics.conversationBreakdown.total > 0 ? (
                <div className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={220} minWidth={280}>
                    <PieChart margin={{ top: 10, right: 40, bottom: 10, left: 40 }}>
                      <defs>
                        <filter id="shadow3dAcctConv" x="-20%" y="-20%" width="140%" height="140%">
                          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#7c3aed" floodOpacity="0.15" />
                        </filter>
                      </defs>
                      <Pie
                        data={[
                          { name: 'Journey', value: accountAnalytics.conversationBreakdown.journey, key: 'journey' },
                          { name: 'Via Form', value: accountAnalytics.conversationBreakdown.form, key: 'form' },
                          { name: 'Chat', value: accountAnalytics.conversationBreakdown.chat, key: 'chat' },
                          { name: 'Discount Availed', value: accountAnalytics.conversationBreakdown.discountAvailed, key: 'discountAvailed' },
                        ].filter(d => d.value > 0)}
                        cx="50%" cy="50%" innerRadius={50} outerRadius={78} paddingAngle={3} dataKey="value"
                        stroke="#fff" strokeWidth={2} style={{ filter: 'url(#shadow3dAcctConv)' }}
                        label={({ cx, cy, midAngle, outerRadius: oR, name, value }) => {
                          const RADIAN = Math.PI / 180;
                          const radius = (oR as number) + 16;
                          const x = (cx as number) + radius * Math.cos(-midAngle * RADIAN);
                          const y = (cy as number) + radius * Math.sin(-midAngle * RADIAN);
                          const p = accountAnalytics.conversationBreakdown.total > 0 ? Math.round((value / accountAnalytics.conversationBreakdown.total) * 100) : 0;
                          return (
                            <text x={x} y={y} fill="#6b7280" textAnchor={x > (cx as number) ? 'start' : 'end'} dominantBaseline="central" fontSize={10} fontWeight={600}>
                              {name} {p}%
                            </text>
                          );
                        }}
                        labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                      >
                        {[
                          { name: 'Journey', value: accountAnalytics.conversationBreakdown.journey, key: 'journey' },
                          { name: 'Via Form', value: accountAnalytics.conversationBreakdown.form, key: 'form' },
                          { name: 'Chat', value: accountAnalytics.conversationBreakdown.chat, key: 'chat' },
                          { name: 'Discount Availed', value: accountAnalytics.conversationBreakdown.discountAvailed, key: 'discountAvailed' },
                        ].filter(d => d.value > 0).map((entry) => (
                          <Cell key={entry.key} fill={ACCT_PIE_COLORS[entry.key]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', color: '#374151', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                        formatter={(value: number, name: string) => [
                          `${value} (${acctPct(value, accountAnalytics.conversationBreakdown.total)})`,
                          name,
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  <div className="w-full grid grid-cols-2 gap-2 mt-2">
                    {[
                      { label: 'Journey', value: accountAnalytics.conversationBreakdown.journey, pctVal: acctPct(accountAnalytics.conversationBreakdown.journey, accountAnalytics.conversationBreakdown.total), dot: 'bg-violet-500' },
                      { label: 'Via Form', value: accountAnalytics.conversationBreakdown.form, pctVal: acctPct(accountAnalytics.conversationBreakdown.form, accountAnalytics.conversationBreakdown.total), dot: 'bg-emerald-500' },
                      { label: 'Chat', value: accountAnalytics.conversationBreakdown.chat, pctVal: acctPct(accountAnalytics.conversationBreakdown.chat, accountAnalytics.conversationBreakdown.total), dot: 'bg-blue-500' },
                      { label: 'Discount', value: accountAnalytics.conversationBreakdown.discountAvailed, pctVal: acctPct(accountAnalytics.conversationBreakdown.discountAvailed, accountAnalytics.conversationBreakdown.total), dot: 'bg-orange-500' },
                    ].map(({ label, value, pctVal, dot }) => (
                      <div key={label} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 hover:bg-purple-50/50 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2.5 h-2.5 rounded-full ${dot} flex-shrink-0`} />
                          <span className="text-xs text-gray-600 truncate">{label}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <span className="text-xs font-bold text-gray-800">{value}</span>
                          <span className="text-[10px] text-gray-400">{pctVal}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                  <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">No conversations in this period</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lead Sources — Donut Chart */}
          <Card className="border border-gray-100 shadow-sm bg-white overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-4.5 h-4.5 text-purple-600" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Lead Sources</CardTitle>
                  <p className="text-xs text-gray-500">{accountAnalytics.leadSources.total} total leads captured</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {accountAnalytics.leadSources.total > 0 ? (
                <div className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={220} minWidth={280}>
                    <PieChart margin={{ top: 10, right: 40, bottom: 10, left: 40 }}>
                      <defs>
                        <filter id="shadow3dAcctLead" x="-20%" y="-20%" width="140%" height="140%">
                          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#7c3aed" floodOpacity="0.15" />
                        </filter>
                      </defs>
                      <Pie
                        data={[
                          { name: 'Via Form', value: accountAnalytics.leadSources.form, key: 'form' },
                          { name: 'Via Journey', value: accountAnalytics.leadSources.journey, key: 'journey' },
                          { name: 'Chat', value: accountAnalytics.leadSources.chat, key: 'chat' },
                          { name: 'Discount Availed', value: accountAnalytics.leadSources.discountAvailed, key: 'discountAvailed' },
                        ].filter(d => d.value > 0)}
                        cx="50%" cy="50%" innerRadius={50} outerRadius={78} paddingAngle={3} dataKey="value"
                        stroke="#fff" strokeWidth={2} style={{ filter: 'url(#shadow3dAcctLead)' }}
                        label={({ cx, cy, midAngle, outerRadius: oR, name, value }) => {
                          const RADIAN = Math.PI / 180;
                          const radius = (oR as number) + 16;
                          const x = (cx as number) + radius * Math.cos(-midAngle * RADIAN);
                          const y = (cy as number) + radius * Math.sin(-midAngle * RADIAN);
                          const p = accountAnalytics.leadSources.total > 0 ? Math.round((value / accountAnalytics.leadSources.total) * 100) : 0;
                          return (
                            <text x={x} y={y} fill="#6b7280" textAnchor={x > (cx as number) ? 'start' : 'end'} dominantBaseline="central" fontSize={10} fontWeight={600}>
                              {name} {p}%
                            </text>
                          );
                        }}
                        labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                      >
                        {[
                          { name: 'Via Form', value: accountAnalytics.leadSources.form, key: 'form' },
                          { name: 'Via Journey', value: accountAnalytics.leadSources.journey, key: 'journey' },
                          { name: 'Chat', value: accountAnalytics.leadSources.chat, key: 'chat' },
                          { name: 'Discount Availed', value: accountAnalytics.leadSources.discountAvailed, key: 'discountAvailed' },
                        ].filter(d => d.value > 0).map((entry) => (
                          <Cell key={entry.key} fill={ACCT_PIE_COLORS[entry.key]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', color: '#374151', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                        formatter={(value: number, name: string) => [
                          `${value} (${acctPct(value, accountAnalytics.leadSources.total)})`,
                          name,
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  <div className="w-full grid grid-cols-2 gap-2 mt-2">
                    {[
                      { label: 'Via Form', value: accountAnalytics.leadSources.form, pctVal: acctPct(accountAnalytics.leadSources.form, accountAnalytics.leadSources.total), dot: 'bg-emerald-500' },
                      { label: 'Via Journey', value: accountAnalytics.leadSources.journey, pctVal: acctPct(accountAnalytics.leadSources.journey, accountAnalytics.leadSources.total), dot: 'bg-violet-500' },
                      { label: 'Chat', value: accountAnalytics.leadSources.chat, pctVal: acctPct(accountAnalytics.leadSources.chat, accountAnalytics.leadSources.total), dot: 'bg-blue-500' },
                      { label: 'Discount Availed', value: accountAnalytics.leadSources.discountAvailed, pctVal: acctPct(accountAnalytics.leadSources.discountAvailed, accountAnalytics.leadSources.total), dot: 'bg-orange-500' },
                    ].map(({ label, value, pctVal, dot }) => (
                      <div key={label} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 hover:bg-purple-50/50 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2.5 h-2.5 rounded-full ${dot} flex-shrink-0`} />
                          <span className="text-xs text-gray-600 truncate">{label}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <span className="text-xs font-bold text-gray-800">{value}</span>
                          <span className="text-[10px] text-gray-400">{pctVal}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                  <FileText className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">No leads in this period</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Traffic Sources — Paid vs Organic */}
          <Card className="border-0 shadow-sm bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-500" />
                Traffic Sources
              </CardTitle>
            </CardHeader>
            <CardContent>
              {accountAnalytics.trafficSources.total > 0 ? (
                <div className="space-y-6 pt-2">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                          <Zap className="w-4 h-4 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">Paid Traffic</p>
                          <p className="text-xs text-gray-500">Leads with UTM parameters</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-gray-900">{accountAnalytics.trafficSources.paid}</p>
                        <p className="text-xs text-gray-400">{acctPct(accountAnalytics.trafficSources.paid, accountAnalytics.trafficSources.total)}</p>
                      </div>
                    </div>
                    <div className="bg-gray-100 rounded-full h-2">
                      <div className="bg-amber-400 h-2 rounded-full transition-all" style={{ width: acctPct(accountAnalytics.trafficSources.paid, accountAnalytics.trafficSources.total) }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                          <Leaf className="w-4 h-4 text-green-600" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">Organic Traffic</p>
                          <p className="text-xs text-gray-500">Leads without UTM parameters</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-gray-900">{accountAnalytics.trafficSources.organic}</p>
                        <p className="text-xs text-gray-400">{acctPct(accountAnalytics.trafficSources.organic, accountAnalytics.trafficSources.total)}</p>
                      </div>
                    </div>
                    <div className="bg-gray-100 rounded-full h-2">
                      <div className="bg-green-400 h-2 rounded-full transition-all" style={{ width: acctPct(accountAnalytics.trafficSources.organic, accountAnalytics.trafficSources.total) }} />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-2">Overall split — {accountAnalytics.trafficSources.total} total leads</p>
                    <div className="flex rounded-full overflow-hidden h-3">
                      <div className="bg-amber-400" style={{ width: acctPct(accountAnalytics.trafficSources.paid, accountAnalytics.trafficSources.total) }} />
                      <div className="bg-green-400" style={{ width: acctPct(accountAnalytics.trafficSources.organic, accountAnalytics.trafficSources.total) }} />
                    </div>
                    <div className="flex justify-between mt-1.5">
                      <span className="text-xs text-amber-600 font-medium">Paid {acctPct(accountAnalytics.trafficSources.paid, accountAnalytics.trafficSources.total)}</span>
                      <span className="text-xs text-green-600 font-medium">Organic {acctPct(accountAnalytics.trafficSources.organic, accountAnalytics.trafficSources.total)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <Globe className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No traffic data in this period</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Visitor Insights */}
      <Card className="mb-3">
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
          {(!pageVisitorStats || (pageVisitorStats.uniqueVisitors === 0 && pageVisitorStats.totalPageVisitors === 0 && totalConversations === 0 && totalLeads === 0)) ? (
            <div className="text-center py-8 text-gray-500">
              <Eye className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">No visitor data yet</p>
              <p className="text-xs text-gray-400">
                Visitor tracking starts when customers use your embedded chat widget on your website.
                <br />
                Go to Widget Studio to get your embed code.
              </p>
            </div>
          ) : (
            <>
            {/* Visitor Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              <div className="p-3 bg-indigo-50 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-medium text-gray-700">Opened Chat</span>
                </div>
                <p className="text-2xl font-bold text-indigo-600">{pageVisitorStats?.uniqueVisitors || 0}</p>
              </div>
              
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  <span className="text-xs font-medium text-gray-700">Engaged</span>
                </div>
                <p className="text-2xl font-bold text-green-600">{totalConversations}</p>
              </div>
              
              <div className="p-3 bg-purple-50 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-purple-600" />
                  <span className="text-xs font-medium text-gray-700">Leads Generated</span>
                </div>
                <p className="text-2xl font-bold text-purple-600">{totalLeads}</p>
              </div>
            </div>

            {/* Device Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <span className="text-sm font-medium">
                      {pageVisitorStats?.deviceBreakdown?.desktop || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-600">Mobile</span>
                    </div>
                    <span className="text-sm font-medium">
                      {pageVisitorStats?.deviceBreakdown?.mobile || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Tablet className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-600">Tablet</span>
                    </div>
                    <span className="text-sm font-medium">
                      {pageVisitorStats?.deviceBreakdown?.tablet || 0}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Top Countries & Cities */}
            {((pageVisitorStats?.topCountries?.length || 0) > 0 || (pageVisitorStats?.topCities?.length || 0) > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {/* Top Countries */}
                <div className="p-3 bg-gray-50 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    Top Countries
                  </h4>
                  {(pageVisitorStats?.topCountries?.length || 0) > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {pageVisitorStats?.topCountries?.slice(0, 6).map((country, idx) => (
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
                    <Globe className="w-4 h-4" />
                    Top Cities
                  </h4>
                  {(pageVisitorStats?.topCities?.length || 0) > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {pageVisitorStats?.topCities?.slice(0, 6).map((city, idx) => (
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

      {/* Conversation Relevance */}
      {categoryBreakdown?.relevanceSummary && (categoryBreakdown.relevanceSummary.relevant > 0 || categoryBreakdown.relevanceSummary.irrelevant > 0 || categoryBreakdown.relevanceSummary.uncategorized > 0) && (
        <Card className="mb-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="w-4 h-4 text-emerald-600" />
              Conversation Relevance
            </CardTitle>
            <CardDescription className="text-xs">
              AI-powered classification of conversations relevant to your business
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {(() => {
              const { relevant, irrelevant, uncategorized } = categoryBreakdown.relevanceSummary;
              const classified = relevant + irrelevant;
              const relevantPct = classified > 0 ? Math.round((relevant / classified) * 100) : 0;
              const irrelevantPct = classified > 0 ? 100 - relevantPct : 0;
              return (
                <div className="space-y-4">
                  <div className="flex items-center gap-6">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">Relevant to Business</span>
                        <span className="text-lg font-bold text-emerald-600">{relevantPct}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${relevantPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-1.5 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                          Relevant: {relevant}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                          Irrelevant: {irrelevant}
                        </span>
                      </div>
                    </div>
                    <div className="text-center px-4 py-2 bg-gray-50 rounded-lg min-w-[100px]">
                      <p className="text-2xl font-bold text-emerald-600">{relevant}</p>
                      <p className="text-xs text-gray-500">of {classified} classified</p>
                    </div>
                  </div>
                  {uncategorized > 0 && (
                    <p className="text-xs text-gray-400">
                      {uncategorized} conversations not yet classified
                    </p>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Conversation Topics */}
      <Card className="mb-3">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Tag className="w-4 h-4 text-teal-600" />
                Conversation Topics
              </CardTitle>
              <CardDescription className="text-xs">
                Conversations are automatically categorized by AI when they end
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1 shrink-0 text-gray-500 hover:text-gray-700"
                onClick={() => setLocation("/admin/category-settings")}
                title="Configure custom categories"
              >
                <Settings className="w-3.5 h-3.5" />
              </Button>
              {(() => {
                const categorizedCount = categoryBreakdown?.categories?.reduce((sum, c) => sum + c.count, 0) || 0;
                const uncategorizedCount = totalConversations - categorizedCount;
                if (uncategorizedCount <= 0 || datePreset !== 'today') return null;
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5 shrink-0"
                    disabled={categorizeMutation.isPending}
                    onClick={() => categorizeMutation.mutate()}
                  >
                    {categorizeMutation.isPending ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Categorizing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3" />
                        Categorize All ({uncategorizedCount})
                      </>
                    )}
                  </Button>
                );
            })()}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isCategoriesLoading ? (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-gray-400" />
              <p className="text-sm text-gray-500">Loading categories...</p>
            </div>
          ) : !categoryBreakdown?.categories?.length ? (
            <div className="text-center py-8 text-gray-500">
              <Tag className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">No categorized conversations yet</p>
              <p className="text-xs text-gray-400 mb-4">
                Conversations will be automatically categorized after they end
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Total categorized */}
              <div className="text-sm text-gray-600 mb-4">
                {categoryBreakdown.categories.reduce((sum, c) => sum + c.count, 0)} conversations categorized
              </div>
              
              {/* Category bars */}
              <div className="space-y-1">
                {categoryBreakdown.categories
                  .sort((a, b) => b.count - a.count)
                  .map((cat, index) => {
                    const total = categoryBreakdown.categories.reduce((sum, c) => sum + c.count, 0);
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

      {/* Weekly AI Report */}
      <Card className="mb-3">
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
                  {(analysisError as Error).message}
                </AlertDescription>
              </Alert>
            ) : conversationAnalysis ? (
              <div className="space-y-3">
                {conversationAnalysis.summary && (
                  <div className="p-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                    <div className="flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-gray-800 leading-relaxed">{conversationAnalysis.summary}</p>
                    </div>
                  </div>
                )}

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
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Lightbulb className="w-4 h-4 text-blue-600" />
                      <h3 className="text-sm font-semibold text-gray-900">Topics of Interest</h3>
                    </div>
                    {conversationAnalysis.topicsOfInterest.length > 0 ? (
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

                  <div className="p-3 bg-pink-50 rounded-lg">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Heart className="w-4 h-4 text-pink-600" />
                      <h3 className="text-sm font-semibold text-gray-900">User Sentiment</h3>
                    </div>
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
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="p-3 bg-purple-50 rounded-lg">
                    <div className="flex items-center gap-1.5 mb-2">
                      <MessageSquare className="w-4 h-4 text-purple-600" />
                      <h3 className="text-sm font-semibold text-gray-900">Common Patterns</h3>
                    </div>
                    {conversationAnalysis.commonPatterns.length > 0 ? (
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

                  <div className="p-3 bg-orange-50 rounded-lg">
                    <div className="flex items-center gap-1.5 mb-2">
                      <TrendingUp className="w-4 h-4 text-orange-600" />
                      <h3 className="text-sm font-semibold text-gray-900">Engagement Insights</h3>
                    </div>
                    <div className="space-y-2">
                      <div className="bg-white p-2 rounded-md">
                        <p className="text-xs text-gray-600 mb-0.5">Avg Messages per Conversation</p>
                        <p className="text-xl font-bold text-orange-600">
                          {conversationAnalysis.engagementInsights.avgMessagesPerConversation.toFixed(1)}
                        </p>
                      </div>
                      {conversationAnalysis.engagementInsights.mostActiveTopics.length > 0 && (
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
            ) : null}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
