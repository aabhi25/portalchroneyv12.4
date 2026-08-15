import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  Users, MessageSquare, TrendingUp, GitBranch, FileText,
  BarChart3, ArrowRight, Loader2, Globe, Zap, Leaf,
  Calendar, ChevronDown, Building2, Percent, MapPin,
  MessagesSquare, ShieldCheck, ShieldX, ShieldQuestion,
  CheckCircle2, XCircle, Clock, Activity
} from "lucide-react";
import { format, subDays, subMonths } from "date-fns";

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

type DatePreset = 'all' | 'today' | 'yesterday' | 'last7' | 'currentMonth' | 'lastMonth' | 'custom';

interface GroupAssignment {
  groupId: string;
  groupName: string;
  canViewAnalytics: boolean;
}

interface GroupAnalyticsData {
  conversationFunnel: {
    total: number;
    journeyStarted: number;
    leadsGenerated: number;
    conversionRate: number;
  };
  conversationBreakdown: {
    journey: number;
    form: number;
    chat: number;
    discountAvailed: number;
    total: number;
  };
  leadSources: {
    form: number;
    journey: number;
    chat: number;
    discountAvailed: number;
    total: number;
  };
  trafficSources: {
    paid: number;
    organic: number;
    total: number;
  };
  topCities: {
    cities: { city: string; count: number }[];
    total: number;
  };
  conversationInsights: {
    relevanceBreakdown: { relevant: number; irrelevant: number; uncategorized: number; total: number };
    outcomes: { completed: number; abandoned: number; singleMessage: number; active: number; total: number };
    topCategories: { category: string; count: number; percentage: number }[];
  };
  accountBreakdown: {
    accountId: string;
    accountName: string;
    conversations: number;
    journeyStarted: number;
    leads: number;
    form: number;
    journey: number;
    chat: number;
    discountAvailed: number;
    paid: number;
    organic: number;
  }[];
}

const PIE_COLORS = {
  form: '#10b981',
  journey: '#8b5cf6',
  chat: '#3b82f6',
  discountAvailed: '#f97316',
};

const CITY_PIE_COLORS = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f97316', '#ef4444',
  '#ec4899', '#06b6d4', '#f59e0b', '#6366f1', '#14b8a6',
];

const RELEVANCE_COLORS: Record<string, string> = {
  relevant: '#10b981',
  irrelevant: '#ef4444',
  uncategorized: '#9ca3af',
};

const OUTCOME_COLORS: Record<string, string> = {
  completed: '#3b82f6',
  abandoned: '#f97316',
  singleMessage: '#9ca3af',
  active: '#10b981',
};

const CATEGORY_BAR_COLORS = [
  '#8b5cf6', '#6366f1', '#a855f7', '#7c3aed', '#c084fc',
  '#818cf8', '#a78bfa', '#6d28d9',
];

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'currentMonth', label: 'Current Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'all', label: 'Lifetime' },
  { key: 'custom', label: 'Custom Range' },
];

function pct(part: number, total: number) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

export default function GroupAnalytics() {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [customOpen, setCustomOpen] = useState(false);

  const { data: groupsData, isLoading: loadingGroups } = useQuery<{ groups: GroupAssignment[] }>({
    queryKey: ["/api/group-admin/groups"],
  });

  const groups = groupsData?.groups || [];

  const activeGroup = useMemo(() => {
    if (selectedGroupId) return groups.find(g => g.groupId === selectedGroupId) ?? null;
    return groups[0] ?? null;
  }, [groups, selectedGroupId]);

  const effectiveDateRange = useMemo(() => {
    const now = new Date();
    let from: Date | undefined;
    let to: Date | undefined;

    if (datePreset === 'today') { from = istStartOfDay(now); to = istEndOfDay(now); }
    else if (datePreset === 'yesterday') { const y = subDays(now, 1); from = istStartOfDay(y); to = istEndOfDay(y); }
    else if (datePreset === 'last7') { from = istStartOfDay(subDays(now, 6)); to = istEndOfDay(now); }
    else if (datePreset === 'currentMonth') { from = istStartOfMonth(now); to = istEndOfDay(now); }
    else if (datePreset === 'lastMonth') { const lm = subMonths(now, 1); from = istStartOfMonth(lm); to = istEndOfMonth(lm); }
    else if (datePreset === 'custom') { from = fromDate ? istStartOfDay(fromDate) : undefined; to = toDate ? istEndOfDay(toDate) : undefined; }

    return { from, to };
  }, [datePreset, fromDate, toDate]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (effectiveDateRange.from) params.set('dateFrom', effectiveDateRange.from.toISOString());
    if (effectiveDateRange.to) params.set('dateTo', effectiveDateRange.to.toISOString());
    return params.toString();
  }, [effectiveDateRange]);

  const groupId = activeGroup?.groupId;

  const { data, isLoading } = useQuery<GroupAnalyticsData>({
    queryKey: ["/api/group-admin/groups", groupId, "group-analytics", queryParams],
    queryFn: async () => {
      const url = queryParams
        ? `/api/group-admin/groups/${groupId}/group-analytics?${queryParams}`
        : `/api/group-admin/groups/${groupId}/group-analytics`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch group analytics");
      return res.json();
    },
    enabled: !!groupId && (activeGroup?.canViewAnalytics ?? false),
  });

  if (loadingGroups) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (!activeGroup) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500">
        No group assigned.
      </div>
    );
  }

  if (!activeGroup.canViewAnalytics) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500">
        <div className="text-center">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No permission to view analytics.</p>
        </div>
      </div>
    );
  }

  const funnel = data?.conversationFunnel;
  const convBreakdown = data?.conversationBreakdown;
  const sources = data?.leadSources;
  const traffic = data?.trafficSources;
  const citiesData = data?.topCities;
  const insights = data?.conversationInsights;
  const breakdown = [...(data?.accountBreakdown ?? [])].sort((a, b) => b.conversations - a.conversations);

  const convPieData = convBreakdown ? [
    { name: 'Journey', value: convBreakdown.journey, key: 'journey' },
    { name: 'Via Form', value: convBreakdown.form, key: 'form' },
    { name: 'Chat', value: convBreakdown.chat, key: 'chat' },
    { name: 'Discount Availed', value: convBreakdown.discountAvailed, key: 'discountAvailed' },
  ].filter(d => d.value > 0) : [];

  const pieData = sources ? [
    { name: 'Via Form', value: sources.form, key: 'form' },
    { name: 'Via Journey', value: sources.journey, key: 'journey' },
    { name: 'Chat', value: sources.chat, key: 'chat' },
    { name: 'Discount Availed', value: sources.discountAvailed, key: 'discountAvailed' },
  ].filter(d => d.value > 0) : [];

  const cityPieData = citiesData?.cities?.map((c, i) => ({
    name: c.city,
    value: c.count,
    key: `city-${i}`,
  })).filter(d => d.value > 0) ?? [];

  const relevancePieData = insights ? [
    { name: 'Relevant', value: insights.relevanceBreakdown.relevant, key: 'relevant' },
    { name: 'Spam / Irrelevant', value: insights.relevanceBreakdown.irrelevant, key: 'irrelevant' },
    { name: 'Uncategorized', value: insights.relevanceBreakdown.uncategorized, key: 'uncategorized' },
  ].filter(d => d.value > 0) : [];

  const outcomePieData = insights ? [
    { name: 'Completed', value: insights.outcomes.completed, key: 'completed' },
    { name: 'Abandoned', value: insights.outcomes.abandoned, key: 'abandoned' },
    { name: 'Single Message', value: insights.outcomes.singleMessage, key: 'singleMessage' },
    { name: 'Active', value: insights.outcomes.active, key: 'active' },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center gap-4">
          <SidebarTrigger className="text-gray-500 hover:text-gray-700" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center shadow-md">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Group Analytics</h1>
              <p className="text-xs text-gray-500">Lead funnel & source breakdown across all accounts</p>
            </div>
          </div>

          {/* Group selector */}
          {groups.length > 1 && (
            <div className="ml-auto">
              <select
                value={activeGroup.groupId}
                onChange={e => setSelectedGroupId(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400"
              >
                {groups.map(g => (
                  <option key={g.groupId} value={g.groupId}>{g.groupName}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Date filter pills */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-xs text-gray-500 font-medium">Filter by date:</span>
          {DATE_PRESETS.filter(p => p.key !== 'custom').map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setDatePreset(key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                datePreset === key
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
          <Popover open={customOpen} onOpenChange={setCustomOpen}>
            <PopoverTrigger asChild>
              <button
                onClick={() => setDatePreset('custom')}
                className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  datePreset === 'custom'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Custom Range
                <ChevronDown className="w-3 h-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-4" align="start">
              <div className="flex gap-4">
                <div>
                  <p className="text-xs font-medium mb-2 text-gray-600">From</p>
                  <CalendarComponent mode="single" selected={fromDate} onSelect={setFromDate} />
                </div>
                <div>
                  <p className="text-xs font-medium mb-2 text-gray-600">To</p>
                  <CalendarComponent mode="single" selected={toDate} onSelect={setToDate} />
                </div>
              </div>
              <Button size="sm" className="mt-3 w-full" onClick={() => setCustomOpen(false)}>
                Apply
              </Button>
            </PopoverContent>
          </Popover>
        </div>

        {datePreset === 'all' ? (
          <p className="text-xs text-gray-400 mt-2">Showing all-time data</p>
        ) : effectiveDateRange.from && effectiveDateRange.to ? (
          <p className="text-xs text-gray-400 mt-2">
            Showing data from {formatDateIST(effectiveDateRange.from)} to {formatDateIST(effectiveDateRange.to)}
          </p>
        ) : null}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
          </div>
        ) : (
          <>
            {/* Section 1: Conversation Funnel */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-500" />
                Conversation Funnel
              </h2>
              <div className="flex flex-col md:flex-row items-stretch gap-3">
                {/* Total Conversations */}
                <Card className="border-0 shadow-sm bg-white flex-1">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-blue-600" />
                      </div>
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Conversations</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{funnel?.total ?? 0}</p>
                    <p className="text-xs text-gray-400 mt-1">All chat sessions opened</p>
                  </CardContent>
                </Card>

                <div className="hidden md:flex items-center flex-shrink-0 px-1">
                  <ArrowRight className="w-5 h-5 text-gray-300" />
                </div>

                {/* Leads Generated */}
                <Card className="border-0 shadow-sm bg-white flex-1">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
                        <Users className="w-5 h-5 text-green-600" />
                      </div>
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Leads Generated</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{funnel?.leadsGenerated ?? 0}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {funnel && funnel.total > 0
                        ? `${funnel.conversionRate}% conversion rate`
                        : 'Contact info captured'}
                    </p>
                  </CardContent>
                </Card>

                <div className="hidden md:flex items-center flex-shrink-0 px-1">
                  <ArrowRight className="w-5 h-5 text-gray-300" />
                </div>

                {/* Conversion Rate */}
                <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-pink-50 flex-1">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                        <Percent className="w-5 h-5 text-purple-600" />
                      </div>
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Conversion Rate</span>
                    </div>
                    <p className="text-3xl font-bold text-purple-700">{funnel?.conversionRate ?? 0}%</p>
                    <div className="mt-2 bg-white/60 rounded-full h-1.5">
                      <div
                        className="bg-purple-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${Math.min(funnel?.conversionRate ?? 0, 100)}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Section 2: Conversation Breakdown + Lead Sources + Traffic Sources */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Conversation Breakdown — Donut Chart */}
              <Card className="border border-gray-100 shadow-sm bg-white overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                      <MessageSquare className="w-4.5 h-4.5 text-purple-600" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Conversations</CardTitle>
                      <p className="text-xs text-gray-500">{convBreakdown?.total ?? 0} total conversations</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {convBreakdown && convBreakdown.total > 0 ? (
                    <div className="flex flex-col items-center">
                      <ResponsiveContainer width="100%" height={220} minWidth={280}>
                        <PieChart margin={{ top: 10, right: 40, bottom: 10, left: 40 }}>
                          <defs>
                            <filter id="shadow3dConv" x="-20%" y="-20%" width="140%" height="140%">
                              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#7c3aed" floodOpacity="0.15" />
                            </filter>
                          </defs>
                          <Pie
                            data={convPieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={78}
                            paddingAngle={3}
                            dataKey="value"
                            stroke="#fff"
                            strokeWidth={2}
                            style={{ filter: 'url(#shadow3dConv)' }}
                            label={({ cx, cy, midAngle, outerRadius: oR, name, value }) => {
                              const RADIAN = Math.PI / 180;
                              const radius = (oR as number) + 16;
                              const x = (cx as number) + radius * Math.cos(-midAngle * RADIAN);
                              const y = (cy as number) + radius * Math.sin(-midAngle * RADIAN);
                              const p = convBreakdown.total > 0 ? Math.round((value / convBreakdown.total) * 100) : 0;
                              return (
                                <text x={x} y={y} fill="#6b7280" textAnchor={x > (cx as number) ? 'start' : 'end'} dominantBaseline="central" fontSize={10} fontWeight={600}>
                                  {name} {p}%
                                </text>
                              );
                            }}
                            labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                          >
                            {convPieData.map((entry) => (
                              <Cell key={entry.key} fill={PIE_COLORS[entry.key as keyof typeof PIE_COLORS]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', color: '#374151', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                            formatter={(value: number, name: string) => [
                              `${value} (${pct(value, convBreakdown.total)})`,
                              name,
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>

                      <div className="w-full grid grid-cols-2 gap-2 mt-2">
                        {[
                          { label: 'Journey', value: convBreakdown.journey, pctVal: pct(convBreakdown.journey, convBreakdown.total), dot: 'bg-violet-500' },
                          { label: 'Via Form', value: convBreakdown.form, pctVal: pct(convBreakdown.form, convBreakdown.total), dot: 'bg-emerald-500' },
                          { label: 'Chat', value: convBreakdown.chat, pctVal: pct(convBreakdown.chat, convBreakdown.total), dot: 'bg-blue-500' },
                          { label: 'Discount', value: convBreakdown.discountAvailed, pctVal: pct(convBreakdown.discountAvailed, convBreakdown.total), dot: 'bg-orange-500' },
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
                      <p className="text-xs text-gray-500">{sources?.total ?? 0} total leads captured</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {sources && sources.total > 0 ? (
                    <div className="flex flex-col items-center">
                      <ResponsiveContainer width="100%" height={220} minWidth={280}>
                        <PieChart margin={{ top: 10, right: 40, bottom: 10, left: 40 }}>
                          <defs>
                            <filter id="shadow3d" x="-20%" y="-20%" width="140%" height="140%">
                              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#7c3aed" floodOpacity="0.15" />
                            </filter>
                          </defs>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={78}
                            paddingAngle={3}
                            dataKey="value"
                            stroke="#fff"
                            strokeWidth={2}
                            style={{ filter: 'url(#shadow3d)' }}
                            label={({ cx, cy, midAngle, outerRadius: oR, name, value }) => {
                              const RADIAN = Math.PI / 180;
                              const radius = (oR as number) + 16;
                              const x = (cx as number) + radius * Math.cos(-midAngle * RADIAN);
                              const y = (cy as number) + radius * Math.sin(-midAngle * RADIAN);
                              const p = sources.total > 0 ? Math.round((value / sources.total) * 100) : 0;
                              return (
                                <text x={x} y={y} fill="#6b7280" textAnchor={x > (cx as number) ? 'start' : 'end'} dominantBaseline="central" fontSize={10} fontWeight={600}>
                                  {name} {p}%
                                </text>
                              );
                            }}
                            labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                          >
                            {pieData.map((entry) => (
                              <Cell key={entry.key} fill={PIE_COLORS[entry.key as keyof typeof PIE_COLORS]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', color: '#374151', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                            formatter={(value: number, name: string) => [
                              `${value} (${pct(value, sources.total)})`,
                              name,
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>

                      <div className="w-full grid grid-cols-2 gap-2 mt-2">
                        {[
                          { label: 'Via Form', value: sources.form, pctVal: pct(sources.form, sources.total), dot: 'bg-emerald-500' },
                          { label: 'Via Journey', value: sources.journey, pctVal: pct(sources.journey, sources.total), dot: 'bg-violet-500' },
                          { label: 'Chat', value: sources.chat, pctVal: pct(sources.chat, sources.total), dot: 'bg-blue-500' },
                          { label: 'Discount Availed', value: sources.discountAvailed, pctVal: pct(sources.discountAvailed, sources.total), dot: 'bg-orange-500' },
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
                  {traffic && traffic.total > 0 ? (
                    <div className="space-y-6 pt-2">
                      {/* Paid */}
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
                            <p className="text-2xl font-bold text-gray-900">{traffic.paid}</p>
                            <p className="text-xs text-gray-400">{pct(traffic.paid, traffic.total)}</p>
                          </div>
                        </div>
                        <div className="bg-gray-100 rounded-full h-2">
                          <div
                            className="bg-amber-400 h-2 rounded-full transition-all"
                            style={{ width: pct(traffic.paid, traffic.total) }}
                          />
                        </div>
                      </div>

                      {/* Organic */}
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
                            <p className="text-2xl font-bold text-gray-900">{traffic.organic}</p>
                            <p className="text-xs text-gray-400">{pct(traffic.organic, traffic.total)}</p>
                          </div>
                        </div>
                        <div className="bg-gray-100 rounded-full h-2">
                          <div
                            className="bg-green-400 h-2 rounded-full transition-all"
                            style={{ width: pct(traffic.organic, traffic.total) }}
                          />
                        </div>
                      </div>

                      {/* Combined bar */}
                      <div className="pt-2">
                        <p className="text-xs text-gray-500 mb-2">Overall split — {traffic.total} total leads</p>
                        <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
                          <div
                            className="bg-amber-400 transition-all"
                            style={{ width: pct(traffic.paid, traffic.total) }}
                          />
                          <div
                            className="bg-green-400 transition-all"
                            style={{ width: pct(traffic.organic, traffic.total) }}
                          />
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-xs text-amber-600 font-medium">Paid {pct(traffic.paid, traffic.total)}</span>
                          <span className="text-xs text-green-600 font-medium">Organic {pct(traffic.organic, traffic.total)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                      <Globe className="w-10 h-10 mb-2 opacity-30" />
                      <p className="text-sm">No leads in this period</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Visitor Cities — Donut Chart */}
              <Card className="border border-gray-100 shadow-sm bg-white overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                      <MapPin className="w-4.5 h-4.5 text-purple-600" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Visitor Cities</CardTitle>
                      <p className="text-xs text-gray-500">{citiesData?.total ?? 0} total visitors tracked</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {cityPieData.length > 0 ? (
                    <div className="flex flex-col items-center">
                      <ResponsiveContainer width="100%" height={220} minWidth={280}>
                        <PieChart margin={{ top: 10, right: 40, bottom: 10, left: 40 }}>
                          <defs>
                            <filter id="shadow3dCities" x="-20%" y="-20%" width="140%" height="140%">
                              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#7c3aed" floodOpacity="0.15" />
                            </filter>
                          </defs>
                          <Pie
                            data={cityPieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={78}
                            paddingAngle={3}
                            dataKey="value"
                            stroke="#fff"
                            strokeWidth={2}
                            style={{ filter: 'url(#shadow3dCities)' }}
                            label={({ cx, cy, midAngle, outerRadius: oR, name, value }) => {
                              const RADIAN = Math.PI / 180;
                              const radius = (oR as number) + 16;
                              const x = (cx as number) + radius * Math.cos(-midAngle * RADIAN);
                              const y = (cy as number) + radius * Math.sin(-midAngle * RADIAN);
                              const p = citiesData!.total > 0 ? Math.round((value / citiesData!.total) * 100) : 0;
                              return (
                                <text x={x} y={y} fill="#6b7280" textAnchor={x > (cx as number) ? 'start' : 'end'} dominantBaseline="central" fontSize={10} fontWeight={600}>
                                  {name} {p}%
                                </text>
                              );
                            }}
                            labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                          >
                            {cityPieData.map((entry, index) => (
                              <Cell key={entry.key} fill={CITY_PIE_COLORS[index % CITY_PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', color: '#374151', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                            formatter={(value: number, name: string) => [
                              `${value} (${pct(value, citiesData!.total)})`,
                              name,
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>

                      <div className="w-full grid grid-cols-2 gap-2 mt-2">
                        {cityPieData.map((entry, index) => (
                          <div key={entry.key} className="grid px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 hover:bg-purple-50/50 transition-colors" style={{ gridTemplateColumns: 'auto 1fr auto' , alignItems: 'start', gap: '8px' }}>
                            <div className="w-2.5 h-2.5 rounded-full mt-0.5" style={{ backgroundColor: CITY_PIE_COLORS[index % CITY_PIE_COLORS.length] }} />
                            <span className="text-xs text-gray-600 leading-snug" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{entry.name}</span>
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <span className="text-xs font-bold text-gray-800">{entry.value}</span>
                              <span className="text-[10px] text-gray-400">{pct(entry.value, citiesData!.total)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                      <MapPin className="w-10 h-10 mb-2 opacity-30" />
                      <p className="text-sm">No visitor city data available</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Section 3: Conversation Insights */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                <MessagesSquare className="w-4 h-4 text-purple-500" />
                Conversation Insights
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Relevance Breakdown — Donut Chart */}
                <Card className="border border-gray-100 shadow-sm bg-white overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center">
                        <ShieldCheck className="w-4.5 h-4.5 text-emerald-600" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Relevance</CardTitle>
                        <p className="text-xs text-gray-500">{insights?.relevanceBreakdown.total ?? 0} conversations classified</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {relevancePieData.length > 0 ? (
                      <div className="flex flex-col items-center">
                        <ResponsiveContainer width="100%" height={200} minWidth={220}>
                          <PieChart margin={{ top: 5, right: 30, bottom: 5, left: 30 }}>
                            <defs>
                              <filter id="shadow3dRelevance" x="-20%" y="-20%" width="140%" height="140%">
                                <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#10b981" floodOpacity="0.15" />
                              </filter>
                            </defs>
                            <Pie
                              data={relevancePieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={42}
                              outerRadius={68}
                              paddingAngle={3}
                              dataKey="value"
                              stroke="#fff"
                              strokeWidth={2}
                              style={{ filter: 'url(#shadow3dRelevance)' }}
                              label={({ cx, cy, midAngle, outerRadius: oR, name, value }) => {
                                const RADIAN = Math.PI / 180;
                                const radius = (oR as number) + 14;
                                const x = (cx as number) + radius * Math.cos(-midAngle * RADIAN);
                                const y = (cy as number) + radius * Math.sin(-midAngle * RADIAN);
                                const p = insights!.relevanceBreakdown.total > 0 ? Math.round((value / insights!.relevanceBreakdown.total) * 100) : 0;
                                return (
                                  <text x={x} y={y} fill="#6b7280" textAnchor={x > (cx as number) ? 'start' : 'end'} dominantBaseline="central" fontSize={9} fontWeight={600}>
                                    {p}%
                                  </text>
                                );
                              }}
                              labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                            >
                              {relevancePieData.map((entry) => (
                                <Cell key={entry.key} fill={RELEVANCE_COLORS[entry.key]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', color: '#374151', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                              formatter={(value: number, name: string) => [
                                `${value} (${pct(value, insights!.relevanceBreakdown.total)})`,
                                name,
                              ]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="w-full space-y-1.5 mt-2">
                          {[
                            { label: 'Relevant', value: insights!.relevanceBreakdown.relevant, color: 'bg-emerald-500', icon: ShieldCheck },
                            { label: 'Spam / Irrelevant', value: insights!.relevanceBreakdown.irrelevant, color: 'bg-red-500', icon: ShieldX },
                            { label: 'Uncategorized', value: insights!.relevanceBreakdown.uncategorized, color: 'bg-gray-400', icon: ShieldQuestion },
                          ].map(({ label, value, color, icon: Icon }) => (
                            <div key={label} className="flex items-center justify-between px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-100">
                              <div className="flex items-center gap-2">
                                <div className={`w-2.5 h-2.5 rounded-full ${color} flex-shrink-0`} />
                                <span className="text-xs text-gray-600">{label}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-gray-800">{value}</span>
                                <span className="text-[10px] text-gray-400">{pct(value, insights!.relevanceBreakdown.total)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                        <ShieldCheck className="w-10 h-10 mb-2 opacity-30" />
                        <p className="text-sm">No classification data yet</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Conversation Outcomes — Donut Chart */}
                <Card className="border border-gray-100 shadow-sm bg-white overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Activity className="w-4.5 h-4.5 text-blue-600" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Outcomes</CardTitle>
                        <p className="text-xs text-gray-500">{insights?.outcomes.total ?? 0} conversations tracked</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {outcomePieData.length > 0 ? (
                      <div className="flex flex-col items-center">
                        <ResponsiveContainer width="100%" height={200} minWidth={220}>
                          <PieChart margin={{ top: 5, right: 30, bottom: 5, left: 30 }}>
                            <defs>
                              <filter id="shadow3dOutcome" x="-20%" y="-20%" width="140%" height="140%">
                                <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#3b82f6" floodOpacity="0.15" />
                              </filter>
                            </defs>
                            <Pie
                              data={outcomePieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={42}
                              outerRadius={68}
                              paddingAngle={3}
                              dataKey="value"
                              stroke="#fff"
                              strokeWidth={2}
                              style={{ filter: 'url(#shadow3dOutcome)' }}
                              label={({ cx, cy, midAngle, outerRadius: oR, name, value }) => {
                                const RADIAN = Math.PI / 180;
                                const radius = (oR as number) + 14;
                                const x = (cx as number) + radius * Math.cos(-midAngle * RADIAN);
                                const y = (cy as number) + radius * Math.sin(-midAngle * RADIAN);
                                const p = insights!.outcomes.total > 0 ? Math.round((value / insights!.outcomes.total) * 100) : 0;
                                return (
                                  <text x={x} y={y} fill="#6b7280" textAnchor={x > (cx as number) ? 'start' : 'end'} dominantBaseline="central" fontSize={9} fontWeight={600}>
                                    {p}%
                                  </text>
                                );
                              }}
                              labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                            >
                              {outcomePieData.map((entry) => (
                                <Cell key={entry.key} fill={OUTCOME_COLORS[entry.key]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', color: '#374151', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                              formatter={(value: number, name: string) => [
                                `${value} (${pct(value, insights!.outcomes.total)})`,
                                name,
                              ]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="w-full space-y-1.5 mt-2">
                          {[
                            { label: 'Completed', value: insights!.outcomes.completed, color: 'bg-blue-500' },
                            { label: 'Abandoned', value: insights!.outcomes.abandoned, color: 'bg-orange-500' },
                            { label: 'Single Message', value: insights!.outcomes.singleMessage, color: 'bg-gray-400' },
                            { label: 'Active', value: insights!.outcomes.active, color: 'bg-emerald-500' },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="flex items-center justify-between px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-100">
                              <div className="flex items-center gap-2">
                                <div className={`w-2.5 h-2.5 rounded-full ${color} flex-shrink-0`} />
                                <span className="text-xs text-gray-600">{label}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-gray-800">{value}</span>
                                <span className="text-[10px] text-gray-400">{pct(value, insights!.outcomes.total)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                        <Activity className="w-10 h-10 mb-2 opacity-30" />
                        <p className="text-sm">No outcome data yet</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Top Categories — Horizontal Bar Chart */}
                <Card className="border border-gray-100 shadow-sm bg-white overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                        <BarChart3 className="w-4.5 h-4.5 text-purple-600" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Top Categories</CardTitle>
                        <p className="text-xs text-gray-500">What visitors ask about</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {insights && insights.topCategories.length > 0 ? (
                      <div className="space-y-2.5">
                        {insights.topCategories.map((cat, i) => {
                          const maxCount = insights.topCategories[0]?.count || 1;
                          const barWidth = Math.max((cat.count / maxCount) * 100, 4);
                          return (
                            <div key={cat.category}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-gray-700 font-medium truncate max-w-[60%]">{cat.category}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-gray-800">{cat.count}</span>
                                  <span className="text-[10px] text-gray-400">{cat.percentage}%</span>
                                </div>
                              </div>
                              <div className="bg-gray-100 rounded-full h-2">
                                <div
                                  className="h-2 rounded-full transition-all"
                                  style={{
                                    width: `${barWidth}%`,
                                    backgroundColor: CATEGORY_BAR_COLORS[i % CATEGORY_BAR_COLORS.length],
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                        <BarChart3 className="w-10 h-10 mb-2 opacity-30" />
                        <p className="text-sm">No categories detected yet</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Section 4: Account Breakdown Table */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-gray-500" />
                Account Breakdown
              </h2>
              <Card className="border-0 shadow-sm bg-white overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-[920px] w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th rowSpan={2} className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200 border-r-2 border-r-gray-300 sticky left-0 z-10">Account</th>
                        <th rowSpan={2} className="text-center px-3 py-2.5 text-[11px] font-semibold text-blue-700 uppercase tracking-wide bg-blue-50/60 border-b border-blue-100 border-r-2 border-r-gray-300">Conversations</th>
                        <th colSpan={5} className="text-center px-2 py-2 text-[11px] font-semibold text-emerald-700 uppercase tracking-wide bg-emerald-50/60 border-b border-emerald-100 border-r-2 border-r-gray-300">Leads</th>
                        <th colSpan={2} className="text-center px-2 py-2 text-[11px] font-semibold text-amber-700 uppercase tracking-wide bg-amber-50/60 border-b border-amber-100 border-r-2 border-r-gray-300">Traffic</th>
                        <th rowSpan={2} className="text-center px-3 py-2.5 text-[11px] font-semibold text-purple-600 uppercase tracking-wide bg-purple-50/60 border-b border-purple-100">Conv.<br/>Rate</th>
                      </tr>
                      <tr className="border-b border-gray-200">
                        <th className="text-right px-3 py-2 text-[10px] font-medium text-emerald-600 uppercase tracking-wide bg-emerald-50/30">Total</th>
                        <th className="text-right px-3 py-2 text-[10px] font-medium text-emerald-600 uppercase tracking-wide bg-emerald-50/30">Form</th>
                        <th className="text-right px-3 py-2 text-[10px] font-medium text-emerald-600 uppercase tracking-wide bg-emerald-50/30">Journey</th>
                        <th className="text-right px-3 py-2 text-[10px] font-medium text-emerald-600 uppercase tracking-wide bg-emerald-50/30">Chat</th>
                        <th className="text-right px-3 py-2 text-[10px] font-medium text-emerald-600 uppercase tracking-wide bg-emerald-50/30 border-r-2 border-r-gray-300">Discount</th>
                        <th className="text-right px-3 py-2 text-[10px] font-medium text-amber-600 uppercase tracking-wide bg-amber-50/30">Paid</th>
                        <th className="text-right px-3 py-2 text-[10px] font-medium text-amber-600 uppercase tracking-wide bg-amber-50/30 border-r-2 border-r-gray-300">Organic</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {breakdown.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="text-center py-8 text-gray-400 text-sm">
                            No data for this period
                          </td>
                        </tr>
                      ) : (
                        breakdown.map((row, i) => {
                          const cr = row.conversations > 0
                            ? Math.round((row.leads / row.conversations) * 1000) / 10
                            : 0;
                          return (
                            <tr key={row.accountId} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} hover:bg-purple-50/30 transition-colors`}>
                              <td className="px-4 py-3 font-medium text-gray-900 border-r-2 border-r-gray-300 sticky left-0 z-10" style={{ background: 'inherit' }}>
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-pink-600 rounded-md flex items-center justify-center flex-shrink-0">
                                    <Building2 className="w-3 h-3 text-white" />
                                  </div>
                                  <span className="break-words whitespace-normal max-w-[180px]">{row.accountName}</span>
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums text-gray-700 font-medium border-r-2 border-r-gray-300">{row.conversations}</td>
                              <td className="px-3 py-3 text-right tabular-nums font-semibold text-gray-900">{row.leads}</td>
                              <td className="px-3 py-3 text-right">
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium tabular-nums">{row.form}</span>
                              </td>
                              <td className="px-3 py-3 text-right">
                                <span className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-xs font-medium tabular-nums">{row.journey}</span>
                              </td>
                              <td className="px-3 py-3 text-right">
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium tabular-nums">{row.chat}</span>
                              </td>
                              <td className="px-3 py-3 text-right border-r-2 border-r-gray-300">
                                <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-medium tabular-nums">{row.discountAvailed}</span>
                              </td>
                              <td className="px-3 py-3 text-right">
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium tabular-nums">{row.paid}</span>
                              </td>
                              <td className="px-3 py-3 text-right border-r-2 border-r-gray-300">
                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium tabular-nums">{row.organic}</span>
                              </td>
                              <td className="px-3 py-3 text-center font-semibold text-purple-700 tabular-nums">{cr}%</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
