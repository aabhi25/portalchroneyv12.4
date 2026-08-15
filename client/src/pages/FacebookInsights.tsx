import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Users, MessageCircle, TrendingUp, ArrowLeft, BarChart3, Facebook } from "lucide-react";
import { useLocation } from "wouter";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { apiRequest } from "@/lib/queryClient";

export default function FacebookInsights() {
  const [, setLocation] = useLocation();

  const { data: conversations, isLoading: loadingConvos } = useQuery<any[]>({
    queryKey: ["/api/facebook/conversations"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/facebook/conversations");
      return res.json();
    },
  });

  const { data: leads, isLoading: loadingLeads } = useQuery<any[]>({
    queryKey: ["/api/facebook/leads"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/facebook/leads");
      return res.json();
    },
  });

  const { data: comments, isLoading: loadingComments } = useQuery<any[]>({
    queryKey: ["/api/facebook/comments"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/facebook/comments");
      return res.json();
    },
  });

  const isLoading = loadingConvos || loadingLeads || loadingComments;

  const totalConversations = conversations?.length ?? 0;
  const totalLeads = leads?.length ?? 0;
  const totalCommentReplies = comments?.length ?? 0;
  const respondedConversations = conversations?.filter((c: any) => c.botReplied || c.status === "completed" || c.replied).length ?? 0;
  const responseRate = totalConversations > 0 ? Math.round((respondedConversations / totalConversations) * 100) : 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 flex items-center gap-4">
          <SidebarTrigger />
          <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/facebook")} className="gap-1 text-white/80 hover:text-white hover:bg-white/10">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-lg bg-white/20">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-semibold text-white">Facebook Insights</h1>
          </div>
        </header>
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 flex items-center gap-4">
        <SidebarTrigger />
        <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/facebook")} className="gap-1 text-white/80 hover:text-white hover:bg-white/10">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-white/20">
            <BarChart3 className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold text-white">Facebook Insights</h1>
        </div>
      </header>

      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Facebook Insights</h1>
          <p className="text-sm text-gray-500 mt-1">Facebook performance overview</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-blue-600">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Total Conversations</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{totalConversations}</p>
                  <p className="text-xs text-gray-400 mt-1">All time</p>
                </div>
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                  <MessageSquare className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Total Leads</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{totalLeads}</p>
                  <p className="text-xs text-gray-400 mt-1">Captured from Facebook</p>
                </div>
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                  <Users className="w-6 h-6 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-sky-500">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Comment Replies</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{totalCommentReplies}</p>
                  <p className="text-xs text-gray-400 mt-1">Auto-replies sent</p>
                </div>
                <div className="w-12 h-12 bg-sky-50 rounded-xl flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-sky-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-indigo-500">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Response Rate</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{responseRate}%</p>
                  <p className="text-xs text-gray-400 mt-1">{respondedConversations} of {totalConversations} conversations</p>
                </div>
                <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-indigo-500" />
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
                Activity Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div className="text-center p-4 bg-blue-50 rounded-xl">
                  <MessageSquare className="w-5 h-5 text-blue-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-gray-900">{totalConversations}</p>
                  <p className="text-xs text-gray-500 mt-1">Conversations</p>
                </div>
                <div className="text-center p-4 bg-sky-50 rounded-xl">
                  <MessageCircle className="w-5 h-5 text-sky-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-gray-900">{totalCommentReplies}</p>
                  <p className="text-xs text-gray-500 mt-1">Comment Replies</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-500" />
                Lead Generation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div className="text-center p-4 bg-blue-50 rounded-xl">
                  <Users className="w-5 h-5 text-blue-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-gray-900">{totalLeads}</p>
                  <p className="text-xs text-gray-500 mt-1">Total Leads</p>
                </div>
                <div className="text-center p-4 bg-indigo-50 rounded-xl">
                  <TrendingUp className="w-5 h-5 text-indigo-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-gray-900">{responseRate}%</p>
                  <p className="text-xs text-gray-500 mt-1">Response Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
