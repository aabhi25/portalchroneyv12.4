import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Users, FileText, CheckCircle, TrendingUp, ArrowUpRight, BarChart3, ArrowLeft, MessageCircle, MessagesSquare, Route, Settings, ShieldCheck, Activity } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface InsightsData {
  sessions: {
    total: number;
    completed: number;
    active: number;
    dropped: number;
    completionRate: number;
  };
  leads: {
    qualified: number;
    totalIncoming: number;
    totalOutgoing: number;
    uniqueSenders: number;
  };
  documents: {
    total: number;
    byType: { type: string; count: number }[];
  };
  daily: {
    sessions: { date: string; sessions: number; completed: number }[];
    leads: { date: string; leads: number }[];
  };
}

const docTypeLabels: Record<string, string> = {
  pan_card: "PAN Card",
  aadhaar_card: "Aadhaar Card",
  bank_statement: "Bank Statement",
  salary_slip: "Salary Slip",
  itr: "ITR",
  other: "Other",
};

export default function WAInsights() {
  const [, setLocation] = useLocation();
  const [period, setPeriod] = useState<string>("today");

  const { data, isLoading, error } = useQuery<InsightsData>({
    queryKey: ["/api/whatsapp/insights", period],
    queryFn: async () => {
      const res = await fetch(`/api/whatsapp/insights?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch insights");
      return res.json();
    },
  });

  const stats = data;

  const periodLabel = period === 'today' ? 'Today' : period === 'yesterday' ? 'Yesterday' : period === '7d' ? 'Last 7 Days' : period === '30d' ? 'Last 30 Days' : period === '90d' ? 'Last 90 Days' : 'All Time';

  const tabBar = (
    <>
      <header className="bg-white border-b px-4 py-3 flex items-center gap-3">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <MessageCircle className="h-6 w-6 text-green-600" />
          <h1 className="text-lg font-semibold">WhatsApp</h1>
        </div>
      </header>
    </>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        {tabBar}
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">WA Insights</h1>
              <p className="text-sm text-gray-500 mt-1">WhatsApp performance overview</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="h-4 bg-gray-200 rounded w-24 mb-3"></div>
                  <div className="h-8 bg-gray-200 rounded w-16 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-32"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        {tabBar}
        <div className="p-6 max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">WA Insights</h1>
          <Card>
            <CardContent className="p-6 text-center text-gray-500">
              Unable to load insights. Please try again later.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {tabBar}
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WA Insights</h1>
          <p className="text-sm text-gray-500 mt-1">WhatsApp performance overview</p>
        </div>
        <div className="flex gap-2">
          {[
            { value: 'today', label: 'Today' },
            { value: 'yesterday', label: 'Yesterday' },
            { value: '7d', label: '7D' },
            { value: '30d', label: '30D' },
            { value: '90d', label: '90D' },
            { value: 'all', label: 'All' },
          ].map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Total Sessions</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.sessions.total}</p>
                <p className="text-xs text-gray-400 mt-1">{periodLabel}</p>
              </div>
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Qualified Leads</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.leads.qualified}</p>
                <p className="text-xs text-gray-400 mt-1">{stats.leads.uniqueSenders} unique senders</p>
              </div>
              <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
                <Users className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Documents Uploaded</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.documents.total}</p>
                <p className="text-xs text-gray-400 mt-1">{stats.documents.byType.length} types</p>
              </div>
              <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center">
                <FileText className="w-6 h-6 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Completion Rate</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.sessions.completionRate}%</p>
                <p className="text-xs text-gray-400 mt-1">{stats.sessions.completed} of {stats.sessions.total} sessions</p>
              </div>
              <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Second Row - Message Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gray-500" />
            Message Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-6">
            <div className="text-center p-4 bg-blue-50 rounded-xl">
              <ArrowUpRight className="w-5 h-5 text-blue-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-gray-900">{stats.leads.totalIncoming}</p>
              <p className="text-xs text-gray-500 mt-1">Messages Received</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-xl">
              <ArrowUpRight className="w-5 h-5 text-green-500 mx-auto mb-2 rotate-180" />
              <p className="text-2xl font-bold text-gray-900">{stats.leads.totalOutgoing}</p>
              <p className="text-xs text-gray-500 mt-1">Messages Sent</p>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded-xl">
              <Route className="w-5 h-5 text-purple-500 mx-auto mb-2" />
              <p className="text-2xl font-bold text-gray-900">{stats.sessions.total}</p>
              <p className="text-xs text-gray-500 mt-1">Total Journeys</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Third Row - Daily Activity Chart + Document Types */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RecentActivityCard />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-500" />
              Document Types
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.documents.byType.length === 0 ? (
              <div className="text-center text-gray-400 py-8 text-sm">No documents uploaded</div>
            ) : (
              <div className="space-y-3">
                {stats.documents.byType.map((docType) => (
                  <div key={docType.type} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">
                      {docTypeLabels[docType.type] || docType.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                    <span className="text-sm font-semibold bg-gray-100 px-2.5 py-0.5 rounded-full">
                      {docType.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
    </div>
  );
}

function RecentActivityCard() {
  const { data, isLoading } = useQuery<{ activities: Array<{ type: string; description: string; timestamp: string; metadata: string }> }>({
    queryKey: ["/api/whatsapp/recent-activity"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/recent-activity", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch recent activity");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const docTypeLabels: Record<string, string> = {
    pan_card: "PAN Card",
    aadhaar_card: "Aadhaar Card",
    bank_statement: "Bank Statement",
    salary_slip: "Salary Slip",
    itr: "ITR",
    other: "Document",
  };

  const getEventDetails = (item: { type: string; description: string; metadata: string }) => {
    if (item.type === "lead") {
      return {
        icon: <Users className="w-4 h-4 text-orange-500" />,
        bg: "bg-orange-50",
        text: `New lead captured: ${item.description}`,
      };
    }
    if (item.type === "document") {
      return {
        icon: <FileText className="w-4 h-4 text-blue-500" />,
        bg: "bg-blue-50",
        text: `${docTypeLabels[item.description] || "Document"} uploaded by ${item.metadata}`,
      };
    }
    const statusMap: Record<string, string> = {
      active: "Journey started",
      completed: "Journey completed",
      expired: "Journey expired",
      abandoned: "Journey abandoned",
    };
    return {
      icon: <Route className="w-4 h-4 text-purple-500" />,
      bg: "bg-purple-50",
      text: `${statusMap[item.description] || "Journey"} for ${item.metadata}`,
    };
  };

  const timeAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-500" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-8 h-8 bg-gray-200 rounded-full" />
                <div className="flex-1">
                  <div className="h-3 bg-gray-200 rounded w-3/4 mb-1.5" />
                  <div className="h-2.5 bg-gray-100 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : !data?.activities?.length ? (
          <div className="text-center text-gray-400 py-8 text-sm">No recent activity</div>
        ) : (
          <div className="space-y-1">
            {data.activities.map((item, i) => {
              const details = getEventDetails(item);
              return (
                <div key={i} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${details.bg}`}>
                    {details.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 truncate">{details.text}</p>
                    <p className="text-xs text-gray-400">{timeAgo(item.timestamp)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
