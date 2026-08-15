import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Sparkles, 
  TrendingUp,
  Clock,
  AlertCircle,
  CheckCircle2,
  ThumbsUp,
  ThumbsDown,
  Users,
  BarChart3
} from "lucide-react";
import { 
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

interface AutomationAnalytics {
  aiResolutionRate: number;
  humanInterventionRate: number;
  averageAutoResolveTime: number;
  averageHumanResolveTime: number;
  customerSatisfactionRate: number;
  totalTickets: number;
  aiResolvedTickets: number;
  humanResolvedTickets: number;
  hoursSaved: number;
  escalationReasons: Record<string, number>;
  feedbackBreakdown: {
    positive: number;
    negative: number;
    neutral: number;
  };
  categoryBreakdown: Record<string, { total: number; aiResolved: number }>;
  trendData: Array<{
    date: string;
    aiResolved: number;
    humanResolved: number;
    totalTickets: number;
  }>;
}

const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

export default function AutomationAnalytics() {
  const { data: analytics, isLoading } = useQuery<AutomationAnalytics>({
    queryKey: ["/api/analytics/automation"],
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">Loading analytics...</div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">No analytics data available</div>
      </div>
    );
  }

  const escalationData = Object.entries(analytics.escalationReasons).map(([reason, count]) => ({
    name: reason,
    value: count
  }));

  const categoryData = Object.entries(analytics.categoryBreakdown).map(([category, data]) => ({
    category,
    total: data.total,
    aiResolved: data.aiResolved,
    humanResolved: data.total - data.aiResolved,
    automationRate: Math.round((data.aiResolved / data.total) * 100)
  }));

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">AI Automation Analytics</h1>
        <p className="text-muted-foreground">Track AI performance and customer satisfaction metrics</p>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI Resolution Rate</CardTitle>
            <Sparkles className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">
              {Math.round(analytics.aiResolutionRate)}%
            </div>
            <p className="text-xs text-muted-foreground">
              {analytics.aiResolvedTickets} of {analytics.totalTickets} tickets
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Human Intervention</CardTitle>
            <Users className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">
              {Math.round(analytics.humanInterventionRate)}%
            </div>
            <p className="text-xs text-muted-foreground">
              {analytics.humanResolvedTickets} tickets needed human help
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Hours Saved</CardTitle>
            <Clock className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              {analytics.hoursSaved.toFixed(1)}h
            </div>
            <p className="text-xs text-muted-foreground">
              Estimated time saved by AI automation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Customer Satisfaction</CardTitle>
            <ThumbsUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">
              {Math.round(analytics.customerSatisfactionRate)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Positive feedback after AI resolution
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Resolution Time Comparison */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Average Resolution Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-500" />
                    <span className="text-sm font-medium">AI Auto-Resolve</span>
                  </div>
                  <span className="text-2xl font-bold text-purple-600">
                    {analytics.averageAutoResolveTime.toFixed(1)}h
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-purple-600 h-2 rounded-full" 
                    style={{ width: `${(analytics.averageAutoResolveTime / Math.max(analytics.averageAutoResolveTime, analytics.averageHumanResolveTime)) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-orange-500" />
                    <span className="text-sm font-medium">Human Agent</span>
                  </div>
                  <span className="text-2xl font-bold text-orange-600">
                    {analytics.averageHumanResolveTime.toFixed(1)}h
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-orange-600 h-2 rounded-full" 
                    style={{ width: `${(analytics.averageHumanResolveTime / Math.max(analytics.averageAutoResolveTime, analytics.averageHumanResolveTime)) * 100}%` }}
                  />
                </div>
              </div>
              <div className="pt-2 border-t">
                <p className="text-sm text-muted-foreground">
                  AI resolves tickets <span className="font-bold text-green-600">
                    {Math.round(((analytics.averageHumanResolveTime - analytics.averageAutoResolveTime) / analytics.averageHumanResolveTime) * 100)}%
                  </span> faster than human agents
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer Feedback</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={[
                    { name: 'Positive', value: analytics.feedbackBreakdown.positive },
                    { name: 'Neutral', value: analytics.feedbackBreakdown.neutral },
                    { name: 'Negative', value: analytics.feedbackBreakdown.negative },
                  ]}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  <Cell fill="#10b981" />
                  <Cell fill="#6b7280" />
                  <Cell fill="#ef4444" />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Escalation Reasons */}
      {escalationData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Escalation Reasons</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={escalationData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Category Performance */}
      {categoryData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>AI Performance by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="aiResolved" fill="#8b5cf6" name="AI Resolved" />
                <Bar dataKey="humanResolved" fill="#f59e0b" name="Human Resolved" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Trends */}
      {analytics.trendData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Resolution Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={analytics.trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="aiResolved" stroke="#8b5cf6" name="AI Resolved" />
                <Line type="monotone" dataKey="humanResolved" stroke="#f59e0b" name="Human Resolved" />
                <Line type="monotone" dataKey="totalTickets" stroke="#3b82f6" name="Total Tickets" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
