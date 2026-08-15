import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Users, CheckCircle, TrendingUp, ArrowUpRight, BarChart3, Clock, Instagram } from "lucide-react";
import { useState } from "react";
import InstagramTabBar from "@/components/InstagramTabBar";

interface InsightsData {
  sessions: {
    total: number;
    completed: number;
    active: number;
    dropped: number;
    completionRate: number;
  };
  leads: {
    total: number;
    uniqueSenders: number;
  };
  messages: {
    totalIncoming: number;
    totalOutgoing: number;
  };
  daily: {
    sessions: { date: string; sessions: number; completed: number }[];
    leads: { date: string; leads: number }[];
  };
}

export default function InstagramInsights() {
  const [period, setPeriod] = useState<string>("today");

  const { data, isLoading, error } = useQuery<InsightsData>({
    queryKey: ["/api/instagram/insights", period],
    queryFn: async () => {
      const res = await fetch(`/api/instagram/insights?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch insights");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <InstagramTabBar activeTab="insights" />
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Instagram Insights</h1>
              <p className="text-sm text-gray-500 mt-1">Instagram DM performance overview</p>
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
        <InstagramTabBar activeTab="insights" />
        <div className="p-6 max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Instagram Insights</h1>
          <Card>
            <CardContent className="p-6 text-center text-gray-500">
              Unable to load insights. Please try again later.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const stats = data!;
  const maxSessions = Math.max(...(stats.daily.sessions.map(d => d.sessions)), 1);
  const periodLabel = period === 'today' ? 'Today' : period === 'yesterday' ? 'Yesterday' : period === '7d' ? 'Last 7 Days' : period === '30d' ? 'Last 30 Days' : period === '90d' ? 'Last 90 Days' : 'All Time';

  return (
    <div className="min-h-screen bg-gray-50">
      <InstagramTabBar activeTab="insights" />
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Instagram Insights</h1>
          <p className="text-sm text-gray-500 mt-1">Instagram DM performance overview</p>
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
              className={period === p.value ? "bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 text-white border-0" : ""}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-pink-500">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Total Sessions</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.sessions.total}</p>
                <p className="text-xs text-gray-400 mt-1">{periodLabel}</p>
              </div>
              <div className="w-12 h-12 bg-pink-50 rounded-xl flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-pink-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Leads Captured</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.leads.total}</p>
                <p className="text-xs text-gray-400 mt-1">{stats.leads.uniqueSenders} unique senders</p>
              </div>
              <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center">
                <Users className="w-6 h-6 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-indigo-500">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Total Messages</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stats.messages.totalIncoming + stats.messages.totalOutgoing}</p>
                <p className="text-xs text-gray-400 mt-1">{stats.messages.totalIncoming} in / {stats.messages.totalOutgoing} out</p>
              </div>
              <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center">
                <Instagram className="w-6 h-6 text-indigo-500" />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-gray-500" />
              Session Status Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <StatusBar label="Completed" count={stats.sessions.completed} total={stats.sessions.total} color="bg-green-500" />
              <StatusBar label="Active" count={stats.sessions.active} total={stats.sessions.total} color="bg-blue-500" />
              <StatusBar label="Dropped / Expired" count={stats.sessions.dropped} total={stats.sessions.total} color="bg-red-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-gray-500" />
              Message Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6">
              <div className="text-center p-4 bg-pink-50 rounded-xl">
                <ArrowUpRight className="w-5 h-5 text-pink-500 mx-auto mb-2" />
                <p className="text-2xl font-bold text-gray-900">{stats.messages.totalIncoming}</p>
                <p className="text-xs text-gray-500 mt-1">Messages Received</p>
              </div>
              <div className="text-center p-4 bg-purple-50 rounded-xl">
                <ArrowUpRight className="w-5 h-5 text-purple-500 mx-auto mb-2 rotate-180" />
                <p className="text-2xl font-bold text-gray-900">{stats.messages.totalOutgoing}</p>
                <p className="text-xs text-gray-500 mt-1">Messages Sent</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500" />
              Daily Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.daily.sessions.length === 0 ? (
              <div className="text-center text-gray-400 py-8">No session data for this period</div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-end gap-[2px] h-40">
                  {stats.daily.sessions.map((day, i) => {
                    const height = (day.sessions / maxSessions) * 100;
                    const dateObj = new Date(day.date);
                    const label = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
                    return (
                      <div
                        key={i}
                        className="flex-1 flex flex-col items-center justify-end gap-0 group relative"
                      >
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                          {label}: {day.sessions} ({day.completed} done)
                        </div>
                        <div
                          className="w-full bg-purple-200 rounded-t-sm relative overflow-hidden"
                          style={{ height: `${Math.max(height, 2)}%` }}
                        >
                          <div
                            className="absolute bottom-0 left-0 right-0 bg-purple-500 rounded-t-sm"
                            style={{ height: `${(day.completed / Math.max(day.sessions, 1)) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 justify-center pt-2 text-xs text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 bg-purple-500 rounded-sm" />
                    <span>Completed</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 bg-purple-200 rounded-sm" />
                    <span>Total</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-gray-500" />
              Daily Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.daily.leads.length === 0 ? (
              <div className="text-center text-gray-400 py-8 text-sm">No leads captured this period</div>
            ) : (
              <div className="space-y-3">
                {stats.daily.leads.map((day) => {
                  const dateObj = new Date(day.date);
                  const label = `${dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                  return (
                    <div key={day.date} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{label}</span>
                      <span className="text-sm font-semibold bg-purple-100 text-purple-700 px-2.5 py-0.5 rounded-full">
                        {day.leads}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
    </div>
  );
}

function StatusBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-900">{count} <span className="text-gray-400 font-normal">({pct}%)</span></span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
