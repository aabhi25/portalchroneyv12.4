import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import WebsiteNavTabs from "@/components/WebsiteNavTabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Search, Plus, AlertCircle, TrendingUp, Clock, CheckCircle2, MessageSquare, Sparkles, HelpCircle, Bot, Zap, Settings, BarChart3 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { useAutonomousSettings } from "@/hooks/useAutonomousSettings";
import AutonomousSupportSettingsForm from "@/components/AutonomousSupportSettingsForm";

interface SupportTicket {
  id: string;
  ticketNumber: number;
  subject: string;
  description: string;
  status: string;
  priority: string;
  category: string | null;
  customerEmail: string | null;
  customerName: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  autoResolved: string | null;
  aiPriority: string | null;
  aiCategory: string | null;
  sentimentScore: string | null;
  emotionalState: string | null;
  churnRisk: string | null;
}

interface TicketStats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  autoResolved: number;
  avgResolutionTime: number;
}

export default function SupportTickets() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"exceptions" | "all">("exceptions");

  const autonomousSettings = useAutonomousSettings(); // Default to exceptions only

  const { data: stats, isLoading: statsLoading } = useQuery<TicketStats>({
    queryKey: ["/api/tickets/stats"],
  });

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.append("status", statusFilter);
  if (priorityFilter !== "all") params.append("priority", priorityFilter);
  if (categoryFilter !== "all") params.append("category", categoryFilter);
  const ticketsUrl = `/api/tickets${params.toString() ? `?${params.toString()}` : ''}`;
  
  const { data: tickets = [], isLoading: ticketsLoading } = useQuery<SupportTicket[]>({
    queryKey: [ticketsUrl],
  });

  const filteredTickets = tickets.filter(ticket => {
    const matchesSearch = searchQuery === "" ||
      ticket.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.ticketNumber.toString().includes(searchQuery) ||
      (ticket.customerEmail && ticket.customerEmail.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (ticket.customerName && ticket.customerName.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;
    const matchesPriority = priorityFilter === "all" || ticket.priority === priorityFilter;
    const matchesCategory = categoryFilter === "all" || ticket.category === categoryFilter;
    
    // Exception Queue: Only show tickets needing human intervention
    // Show all open/in-progress tickets that weren't auto-resolved
    const needsHumanReview = viewMode === "all" || (
      // Ticket must be open or in progress
      (ticket.status === 'open' || ticket.status === 'in_progress') &&
      // And not auto-resolved (handle string 'true' or null/false)
      ticket.autoResolved !== 'true'
    );
    
    return matchesSearch && matchesStatus && matchesPriority && matchesCategory && needsHumanReview;
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      open: { variant: "destructive", label: "Open" },
      in_progress: { variant: "default", label: "In Progress" },
      resolved: { variant: "secondary", label: "Resolved" },
      closed: { variant: "outline", label: "Closed" }
    };
    const config = variants[status] || { variant: "outline" as const, label: status };
    return <Badge variant={config.variant} data-testid={`badge-status-${status}`}>{config.label}</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      low: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
      medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100",
      high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100",
      urgent: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100"
    };
    return (
      <Badge 
        variant="outline" 
        className={colors[priority] || ""} 
        data-testid={`badge-priority-${priority}`}
      >
        {priority.charAt(0).toUpperCase() + priority.slice(1)}
      </Badge>
    );
  };

  const getEmotionalStateBadge = (state: string | null) => {
    if (!state) return null;
    const icons: Record<string, string> = {
      happy: "😊",
      neutral: "😐",
      frustrated: "😤",
      angry: "😠"
    };
    return (
      <span className="text-xs" title={`Emotional state: ${state}`}>
        {icons[state] || "😐"}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <WebsiteNavTabs />
      <div className="container mx-auto p-6 space-y-8">
      {/* Modern Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900/30 dark:to-blue-900/30 rounded-lg">
              <AlertCircle className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent" data-testid="text-page-title">
              {viewMode === "exceptions" ? "Exception Queue" : "Support Tickets"}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground ml-14">
            {viewMode === "exceptions" 
              ? "Only tickets requiring human intervention - AI handles the rest automatically"
              : "Manage all customer support conversations and tickets"
            }
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Settings Dialog */}
          <Dialog>
            <DialogTrigger asChild>
              <Button 
                variant="outline" 
                size="icon" 
                className="h-9 w-9 rounded-full border-purple-200 hover:bg-purple-50 hover:border-purple-300 dark:border-purple-800 dark:hover:bg-purple-950/50 transition-all"
              >
                <Settings className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-blue-600" />
                  Autonomous Support Settings
                </DialogTitle>
                <DialogDescription>
                  Configure how AI handles customer support tickets automatically
                </DialogDescription>
              </DialogHeader>
              
              <div className="mt-4">
                <AutonomousSupportSettingsForm
                  autoResolutionEnabled={autonomousSettings.autoResolutionEnabled}
                  setAutoResolutionEnabled={autonomousSettings.setAutoResolutionEnabled}
                  autoResolutionConfidence={autonomousSettings.autoResolutionConfidence}
                  setAutoResolutionConfidence={autonomousSettings.setAutoResolutionConfidence}
                  escalationSensitivity={autonomousSettings.escalationSensitivity}
                  setEscalationSensitivity={autonomousSettings.setEscalationSensitivity}
                  humanOnlyCategories={autonomousSettings.humanOnlyCategories}
                  setHumanOnlyCategories={autonomousSettings.setHumanOnlyCategories}
                  onSave={autonomousSettings.saveSettings}
                  isSaving={autonomousSettings.isSaving}
                />
              </div>
            </DialogContent>
          </Dialog>
          
          {/* Help Dialog */}
          <Dialog>
            <DialogTrigger asChild>
              <Button 
                variant="outline" 
                size="icon" 
                className="h-9 w-9 rounded-full border-blue-200 hover:bg-blue-50 hover:border-blue-300 dark:border-blue-800 dark:hover:bg-blue-950/50 transition-all"
              >
                <HelpCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-purple-600" />
                  How Autonomous Support Works
                </DialogTitle>
                <DialogDescription>
                  Your complete guide to AI-powered customer support automation
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-6 mt-4">
                {/* What is Exception Queue */}
                <div>
                  <h3 className="font-semibold flex items-center gap-2 text-base mb-2">
                    <AlertCircle className="h-4 w-4 text-orange-500" />
                    What is the Exception Queue?
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    The Exception Queue shows only tickets that need human intervention. Most customer conversations are handled automatically by AI - you only see the ones that require your expertise.
                  </p>
                </div>

                {/* How AI Automation Works */}
                <div>
                  <h3 className="font-semibold flex items-center gap-2 text-base mb-2">
                    <Sparkles className="h-4 w-4 text-purple-500" />
                    How AI Handles Tickets Automatically
                  </h3>
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p>When a customer conversation needs support, the system:</p>
                    <ol className="list-decimal list-inside space-y-1 ml-2">
                      <li>Automatically detects frustrated customers, repeated questions, or complex issues</li>
                      <li>Creates a support ticket and analyzes priority, sentiment, and churn risk</li>
                      <li>Attempts to auto-resolve if AI is confident (based on your settings)</li>
                      <li>Sends solution back to customer seamlessly through the chat widget</li>
                      <li>Monitors customer's next message to ensure satisfaction</li>
                      <li>Only escalates to you if confidence is low or customer is still unsatisfied</li>
                    </ol>
                  </div>
                </div>

                {/* When Tickets Escalate to Humans */}
                <div>
                  <h3 className="font-semibold flex items-center gap-2 text-base mb-2">
                    <Zap className="h-4 w-4 text-yellow-500" />
                    What Triggers Human Escalation?
                  </h3>
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p>Tickets appear in your queue when:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>AI confidence is below your threshold (configure in Settings)</li>
                      <li>Category is in your "human-only" list (billing, refunds, etc.)</li>
                      <li>Customer is dissatisfied with AI's auto-resolution</li>
                      <li>Issue is complex and requires account access or technical troubleshooting</li>
                      <li>Auto-resolution is disabled in your settings</li>
                    </ul>
                  </div>
                </div>

                {/* How to Handle Tickets */}
                <div>
                  <h3 className="font-semibold flex items-center gap-2 text-base mb-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    How to Handle Exception Tickets
                  </h3>
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p>When reviewing a ticket:</p>
                    <ol className="list-decimal list-inside space-y-1 ml-2">
                      <li>Click on any ticket to see full conversation history and AI analysis</li>
                      <li>Review AI's suggested response (if available)</li>
                      <li>Either approve AI suggestion, edit it, or write your own response</li>
                      <li>Your response appears as Chroney in the chat widget - seamless for customers</li>
                      <li>Click "Resolve Ticket" when issue is handled</li>
                      <li>AI learns from your corrections to improve future auto-resolutions</li>
                    </ol>
                  </div>
                </div>

                {/* AI Learning System */}
                <div>
                  <h3 className="font-semibold flex items-center gap-2 text-base mb-2">
                    <Bot className="h-4 w-4 text-blue-500" />
                    How AI Learns from Your Actions
                  </h3>
                  <div className="text-sm text-muted-foreground">
                    <p>The system continuously improves by:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2 mt-2">
                      <li>Storing successful auto-resolutions when customers say "thanks"</li>
                      <li>Learning from your response edits when you improve AI's draft</li>
                      <li>Analyzing customer dissatisfaction to avoid similar mistakes</li>
                      <li>Building a knowledge base of proven resolutions for similar issues</li>
                    </ul>
                  </div>
                </div>

                {/* Configure Settings */}
                <div className="border-t pt-4">
                  <h3 className="font-semibold flex items-center gap-2 text-base mb-2">
                    <Settings className="h-4 w-4 text-gray-500" />
                    Configure Autonomous Behavior
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Click the <span className="font-medium text-purple-600">Settings icon (⚙️)</span> above to control how aggressively AI handles tickets:
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    <li><span className="font-medium">Confidence Threshold (60-90%):</span> Higher = more cautious, lower = more automated</li>
                    <li><span className="font-medium">Escalation Sensitivity:</span> Low (AI tries harder), Medium (balanced), High (quick human escalation)</li>
                    <li><span className="font-medium">Human-Only Categories:</span> Always send these to you (e.g., "billing, refunds")</li>
                  </ul>
                </div>

                {/* View Analytics */}
                <div className="border-t pt-4">
                  <h3 className="font-semibold flex items-center gap-2 text-base mb-2">
                    <BarChart3 className="h-4 w-4 text-indigo-500" />
                    Track Automation Performance
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Visit <Link href="/automation-analytics" className="text-purple-600 hover:underline font-medium">Automation Analytics</Link> to see AI resolution rate, customer satisfaction scores, hours saved, and identify areas for improvement.
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          
          <div className="h-6 w-px bg-border" />
          
          {/* View Mode Selector */}
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as "exceptions" | "all")}>
            <SelectTrigger className="w-[200px] border-purple-200 hover:border-purple-300 dark:border-purple-800 focus:ring-purple-500">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exceptions">
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-orange-500" />
                  Exceptions Only
                </span>
              </SelectItem>
              <SelectItem value="all">
                <span className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-500" />
                  All Tickets
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* AI Automation Insights Banner */}
      {!statsLoading && stats && stats.autoResolved > 0 && (
        <Card className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 border-purple-200 dark:border-purple-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-full">
                  <Sparkles className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">AI Automation Active</h3>
                  <p className="text-sm text-muted-foreground">
                    {stats.autoResolved} tickets auto-resolved ({Math.round((stats.autoResolved / stats.total) * 100)}% automation rate)
                    {viewMode === "exceptions" && filteredTickets.length === 0 && (
                      <span className="text-green-600 dark:text-green-400 font-medium ml-2">
                        ✓ No exceptions - AI is handling everything!
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                  {Math.round((stats.autoResolved / Math.max(stats.total, 1)) * 15 * 10) / 10}h
                </div>
                <p className="text-xs text-muted-foreground">saved (est.)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modern Stats Grid */}
      {!statsLoading && stats && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {/* Needs Review Card */}
          <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-white dark:bg-slate-950 rounded-xl shadow-sm">
                  <MessageSquare className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                </div>
                <TrendingUp className="h-4 w-4 text-slate-400" />
              </div>
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                {viewMode === "exceptions" ? "Needs Review" : "Total Tickets"}
              </h3>
              <div className="text-3xl font-bold text-slate-900 dark:text-white" data-testid="text-stat-total">
                {viewMode === "exceptions" ? filteredTickets.length : stats.total}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                {viewMode === "exceptions" 
                  ? `${stats.autoResolved} auto-resolved by AI`
                  : `${stats.open} open, ${stats.inProgress} in progress`
                }
              </p>
            </CardContent>
          </Card>

          {/* Resolution Rate Card */}
          <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-950 dark:to-emerald-900">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-white dark:bg-green-950 rounded-xl shadow-sm">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div className="text-xs font-semibold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900 px-2 py-1 rounded-full">
                  Active
                </div>
              </div>
              <h3 className="text-sm font-medium text-green-700 dark:text-green-300 mb-1">
                Resolution Rate
              </h3>
              <div className="text-3xl font-bold text-green-900 dark:text-white" data-testid="text-stat-resolution-rate">
                {stats.total > 0 ? Math.round(((stats.resolved + stats.closed) / stats.total) * 100) : 0}%
              </div>
              <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                {stats.resolved + stats.closed} of {stats.total} resolved
              </p>
            </CardContent>
          </Card>

          {/* AI Automation Card */}
          <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-purple-50 to-fuchsia-100 dark:from-purple-950 dark:to-fuchsia-900">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-white dark:bg-purple-950 rounded-xl shadow-sm">
                  <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <Bot className="h-4 w-4 text-purple-400" />
              </div>
              <h3 className="text-sm font-medium text-purple-700 dark:text-purple-300 mb-1">
                AI Automation
              </h3>
              <div className="text-3xl font-bold text-purple-900 dark:text-white" data-testid="text-stat-auto-resolved">
                {stats.total > 0 ? Math.round((stats.autoResolved / stats.total) * 100) : 0}%
              </div>
              <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">
                {stats.autoResolved} tickets handled autonomously
              </p>
            </CardContent>
          </Card>

          {/* Avg Resolution Time Card */}
          <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-blue-50 to-cyan-100 dark:from-blue-950 dark:to-cyan-900">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-white dark:bg-blue-950 rounded-xl shadow-sm">
                  <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                  AVG
                </div>
              </div>
              <h3 className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">
                Avg Resolution Time
              </h3>
              <div className="text-3xl font-bold text-blue-900 dark:text-white" data-testid="text-stat-avg-time">
                {stats.avgResolutionTime}h
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                Time to resolve tickets
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Modern Ticket List Section */}
      <Card className="border-0 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-gray-50 dark:from-slate-900 dark:to-gray-900 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900/30 dark:to-blue-900/30 rounded-lg">
              <MessageSquare className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Ticket List</CardTitle>
              <CardDescription>Filter and search through all support tickets</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search tickets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-priority-filter">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-category-filter">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="technical">Technical</SelectItem>
                <SelectItem value="billing">Billing</SelectItem>
                <SelectItem value="feature_request">Feature Request</SelectItem>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="bug_report">Bug Report</SelectItem>
                <SelectItem value="account">Account</SelectItem>
                <SelectItem value="product_inquiry">Product Inquiry</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {ticketsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading tickets...</div>
          ) : filteredTickets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No tickets found</p>
            </div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Ticket #</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>AI Insights</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTickets.map((ticket) => (
                    <TableRow 
                      key={ticket.id} 
                      className="hover-elevate cursor-pointer"
                      onClick={() => navigate(`/tickets/${ticket.id}`)}
                      data-testid={`row-ticket-${ticket.id}`}
                    >
                      <TableCell className="font-medium" data-testid={`text-ticket-number-${ticket.id}`}>
                        #{ticket.ticketNumber}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{ticket.subject}</span>
                          {ticket.autoResolved === 'true' && (
                            <Badge variant="outline" className="text-xs">
                              <Sparkles className="w-3 h-3 mr-1" />
                              AI
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div className="font-medium">{ticket.customerName || 'Unknown'}</div>
                          <div className="text-muted-foreground text-xs">{ticket.customerEmail}</div>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(ticket.status)}</TableCell>
                      <TableCell>{getPriorityBadge(ticket.priority)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {ticket.category || 'General'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {ticket.emotionalState && getEmotionalStateBadge(ticket.emotionalState)}
                          {ticket.churnRisk && ticket.churnRisk === 'high' && (
                            <Badge variant="destructive" className="text-xs">
                              ⚠️ Churn Risk
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/tickets/${ticket.id}`}>
                          <Button variant="ghost" size="sm" data-testid={`button-view-${ticket.id}`}>
                            View
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
