import MoreFeaturesNavTabs from "@/components/MoreFeaturesNavTabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Brain, CheckCircle, X, AlertCircle, Clock, TrendingUp, MessageSquare, BookOpen, GitBranch, Package, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

interface AISuggestion {
  id: string;
  businessAccountId: string;
  type: 'faq' | 'training' | 'journey' | 'product';
  title: string;
  description: string;
  suggestedContent: any;
  status: 'pending' | 'accepted' | 'dismissed';
  confidence: number;
  impactMetrics: any;
  sourceConversationIds: string[];
  createdAt: string;
  acceptedAt?: string;
  dismissedAt?: string;
  implementedId?: string;
}

interface SuggestionStats {
  pending: number;
  accepted: number;
  dismissed: number;
}

export default function AIInsights() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'all' | 'faq' | 'training' | 'journey' | 'product'>('all');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Fetch suggestions
  const { data: suggestions = [], isLoading } = useQuery<AISuggestion[]>({
    queryKey: ['/api/ai-suggestions'],
  });

  // Fetch stats
  const { data: stats } = useQuery<SuggestionStats>({
    queryKey: ['/api/ai-suggestions/stats'],
  });

  // Trigger analysis mutation
  const analyzeMutation = useMutation({
    mutationFn: async (daysBack: number = 7) => {
      const res = await fetch('/api/ai-suggestions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysBack }),
        credentials: 'include',
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Analysis failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ai-suggestions/stats'] });
      setIsAnalyzing(false);
      const totalSuggestions = data.summary.faqSuggestions + data.summary.trainingSuggestions + data.summary.journeySuggestions + data.summary.productSuggestions;
      toast({
        title: "Analysis Complete",
        description: totalSuggestions > 0 ? `Generated ${totalSuggestions} new suggestions` : "No new suggestions found",
      });
    },
    onError: (error: any) => {
      setIsAnalyzing(false);
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze conversations",
        variant: "destructive",
      });
    },
  });

  // Accept suggestion mutation
  const acceptMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ai-suggestions/${id}/accept`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to accept suggestion');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ai-suggestions/stats'] });
      toast({
        title: "Suggestion Accepted",
        description: "The suggestion has been implemented successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Accept",
        description: error.message || "Could not accept suggestion",
        variant: "destructive",
      });
    },
  });

  // Dismiss suggestion mutation
  const dismissMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const res = await fetch(`/api/ai-suggestions/${id}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to dismiss suggestion');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ai-suggestions/stats'] });
      toast({
        title: "Suggestion Dismissed",
        description: "The suggestion has been dismissed",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Dismiss",
        description: error.message || "Could not dismiss suggestion",
        variant: "destructive",
      });
    },
  });

  const handleAnalyze = () => {
    setIsAnalyzing(true);
    analyzeMutation.mutate(7);
  };

  const handleAccept = (id: string) => {
    acceptMutation.mutate(id);
  };

  const handleDismiss = (id: string, reason?: string) => {
    dismissMutation.mutate({ id, reason });
  };

  // Filter suggestions by tab
  const filteredSuggestions = activeTab === 'all' 
    ? suggestions 
    : suggestions.filter(s => s.type === activeTab);

  // Group by status
  const pendingSuggestions = filteredSuggestions.filter(s => s.status === 'pending');
  const acceptedSuggestions = filteredSuggestions.filter(s => s.status === 'accepted');
  const dismissedSuggestions = filteredSuggestions.filter(s => s.status === 'dismissed');

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'faq': return <MessageSquare className="h-4 w-4" />;
      case 'training': return <Brain className="h-4 w-4" />;
      case 'journey': return <GitBranch className="h-4 w-4" />;
      case 'product': return <Package className="h-4 w-4" />;
      default: return <Sparkles className="h-4 w-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'faq': return 'bg-blue-500/10 text-blue-600';
      case 'training': return 'bg-purple-500/10 text-purple-600';
      case 'journey': return 'bg-green-500/10 text-green-600';
      case 'product': return 'bg-orange-500/10 text-orange-600';
      default: return 'bg-gray-500/10 text-gray-600';
    }
  };

  const getConfidenceTooltip = (confidence: number) => {
    if (confidence >= 85) {
      return "High confidence: Strong evidence from multiple conversations. Safe to implement.";
    } else if (confidence >= 70) {
      return "Medium confidence: Clear pattern detected. Review before implementing.";
    } else {
      return "Low confidence: Potential issue identified. Verify with your team before implementing.";
    }
  };

  return (
    <TooltipProvider>
      <MoreFeaturesNavTabs />
      <div className="container mx-auto p-6 max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-purple-600" />
            Chroney IQ
          </h1>
          <p className="text-muted-foreground mt-2">
            AI-powered suggestions to improve your chatbot based on conversation analysis
          </p>
        </div>
        <Button
          onClick={handleAnalyze}
          disabled={isAnalyzing || analyzeMutation.isPending}
          className="gap-2 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
        >
          <Brain className="h-4 w-4" />
          {(isAnalyzing || analyzeMutation.isPending) ? 'Analyzing...' : 'Analyze Conversations'}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Suggestions</CardTitle>
            <Clock className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pending || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Waiting for your review
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Accepted</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.accepted || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Implemented successfully
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Dismissed</CardTitle>
            <X className="h-4 w-4 text-gray-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.dismissed || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Not relevant
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for filtering by type */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="mb-6">
        <TabsList className="grid w-full grid-cols-5 bg-gradient-to-r from-purple-50 to-white backdrop-blur-sm shadow-md h-auto p-1 rounded-xl">
          <TabsTrigger value="all" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">All Suggestions</TabsTrigger>
          <TabsTrigger value="faq" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">FAQs</TabsTrigger>
          <TabsTrigger value="training" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">Training</TabsTrigger>
          <TabsTrigger value="journey" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">Journeys</TabsTrigger>
          <TabsTrigger value="product" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">Products</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Suggestions List */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="text-muted-foreground mt-4">Loading suggestions...</p>
        </div>
      ) : filteredSuggestions.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No suggestions found. Click "Analyze Conversations" to generate AI-powered insights.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-8">
          {/* Pending Suggestions */}
          {pendingSuggestions.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Clock className="h-5 w-5 text-orange-600" />
                Pending Review ({pendingSuggestions.length})
              </h2>
              <div className="space-y-4">
                {pendingSuggestions.map((suggestion) => (
                  <Card key={suggestion.id} className="border-l-4 border-l-orange-500">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className={`p-2 rounded-lg ${getTypeColor(suggestion.type)}`}>
                            {getTypeIcon(suggestion.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-lg break-words">{suggestion.title}</CardTitle>
                            <CardDescription className="mt-1">{suggestion.description}</CardDescription>
                          </div>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="shrink-0">
                              <Badge variant="secondary" className="cursor-help flex items-center gap-1">
                                {suggestion.confidence}% confidence
                                <Info className="h-3 w-3" />
                              </Badge>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="text-sm">{getConfidenceTooltip(suggestion.confidence)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-muted/50 p-4 rounded-lg mb-4">
                        <h4 className="font-medium mb-2">Suggested Content:</h4>
                        <div className="text-sm space-y-2">
                          {suggestion.type === 'faq' && (
                            <>
                              <div>
                                <strong>Question:</strong> {suggestion.suggestedContent.question}
                              </div>
                              <div>
                                <strong>Answer:</strong> {suggestion.suggestedContent.answer}
                              </div>
                            </>
                          )}
                          {suggestion.type === 'training' && (
                            <div>
                              <strong>Instruction:</strong> {suggestion.suggestedContent.instruction}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => handleAccept(suggestion.id)}
                          disabled={acceptMutation.isPending}
                          className="gap-2 bg-blue-600 hover:bg-blue-700"
                        >
                          <CheckCircle className="h-4 w-4" />
                          Accept & Implement
                        </Button>
                        <Button
                          onClick={() => handleDismiss(suggestion.id)}
                          disabled={dismissMutation.isPending}
                          variant="outline"
                          className="gap-2"
                        >
                          <X className="h-4 w-4" />
                          Dismiss
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Accepted Suggestions */}
          {acceptedSuggestions.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                Accepted ({acceptedSuggestions.length})
              </h2>
              <div className="space-y-4">
                {acceptedSuggestions.map((suggestion) => (
                  <Card key={suggestion.id} className="border-l-4 border-l-green-500 opacity-75">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${getTypeColor(suggestion.type)}`}>
                          {getTypeIcon(suggestion.type)}
                        </div>
                        <div>
                          <CardTitle className="text-lg">{suggestion.title}</CardTitle>
                          <CardDescription className="mt-1">
                            Implemented on {new Date(suggestion.acceptedAt!).toLocaleDateString()}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </TooltipProvider>
  );
}
