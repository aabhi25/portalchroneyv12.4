import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import TrainingNavTabs from "@/components/TrainingNavTabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, 
  Globe, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Sparkles, 
  Edit, 
  Trash2, 
  Save, 
  X, 
  ChevronDown, 
  ChevronRight, 
  FileText,
  Building2,
  Users,
  Package,
  Star,
  Phone,
  Mail,
  MapPin,
  Calendar,
  DollarSign,
  Info,
  Plus,
  ExternalLink,
  Zap,
  Target,
  Award
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WebsiteAnalysisResponse {
  status: 'not_started' | 'pending' | 'analyzing' | 'completed' | 'failed';
  websiteUrl: string;
  analyzedContent: AnalyzedContent | null;
  errorMessage?: string;
  lastAnalyzedAt?: string;
}

interface AnalyzedContent {
  businessName: string;
  businessDescription: string;
  mainProducts: string[];
  mainServices: string[];
  keyFeatures: string[];
  targetAudience: string;
  uniqueSellingPoints: string[];
  contactInfo: {
    email?: string;
    phone?: string;
    address?: string;
  };
  businessHours?: string;
  pricingInfo?: string;
  additionalInfo: string;
}

interface BusinessAccountInfo {
  name: string;
  description: string;
  website: string;
}

interface AnalyzedPage {
  id: string;
  businessAccountId: string;
  pageUrl: string;
  extractedContent?: string | null;
  analyzedAt: string;
  createdAt: string;
}

export default function About() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [additionalPages, setAdditionalPages] = useState<string[]>([]);
  const [newPageUrl, setNewPageUrl] = useState("");
  const [openPageId, setOpenPageId] = useState<string | null>(null);
  const [analyzedPages, setAnalyzedPages] = useState<{url: string; analyzed: boolean; analyzedAt?: string}[]>([]);
  const [previousContent, setPreviousContent] = useState<AnalyzedContent | null>(null);
  const [newlyAddedItems, setNewlyAddedItems] = useState<{
    products: Set<string>;
    services: Set<string>;
    features: Set<string>;
    usps: Set<string>;
  }>({
    products: new Set(),
    services: new Set(),
    features: new Set(),
    usps: new Set(),
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState<AnalyzedContent | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showDeletePageDialog, setShowDeletePageDialog] = useState(false);
  const [pageToDelete, setPageToDelete] = useState<string | null>(null);
  const [selectedPageContent, setSelectedPageContent] = useState<{url: string; content: string | null} | null>(null);
  const previousStatusRef = useRef<string | null>(null);

  const { data: accountInfo } = useQuery<BusinessAccountInfo>({
    queryKey: ["/api/about"],
  });

  const { data: analysisData, isLoading } = useQuery<WebsiteAnalysisResponse>({
    queryKey: ["/api/website-analysis"],
    refetchInterval: (data) => {
      if (data?.state?.data?.status === 'pending' || data?.state?.data?.status === 'analyzing') {
        return 5000;
      }
      return false;
    },
  });

  const { data: analyzedPagesData } = useQuery<AnalyzedPage[]>({
    queryKey: ["/api/analyzed-pages"],
  });

  useEffect(() => {
    const currentStatus = analysisData?.status;
    const previousStatus = previousStatusRef.current;

    if (currentStatus === 'completed' && previousStatus && previousStatus !== 'completed') {
      queryClient.invalidateQueries({ queryKey: ["/api/website-analysis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analyzed-pages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/about"] });
      
      queryClient.refetchQueries({ queryKey: ["/api/website-analysis"] });
      queryClient.refetchQueries({ queryKey: ["/api/analyzed-pages"] });
      queryClient.refetchQueries({ queryKey: ["/api/about"] });
    }

    previousStatusRef.current = currentStatus || null;
  }, [analysisData?.status, queryClient]);

  useEffect(() => {
    if (analyzedPagesData) {
      const pages = analyzedPagesData.map(page => ({
        url: page.pageUrl,
        analyzed: true,
        analyzedAt: page.analyzedAt,
      }));
      setAnalyzedPages(pages);
    }
  }, [analyzedPagesData]);

  const websiteUrl = accountInfo?.website || "";

  useEffect(() => {
    if (analysisData?.status === 'completed' && analysisData.analyzedContent && previousContent) {
      const newItems = {
        products: new Set<string>(),
        services: new Set<string>(),
        features: new Set<string>(),
        usps: new Set<string>(),
      };

      analysisData.analyzedContent.mainProducts?.forEach((product: string) => {
        if (!previousContent.mainProducts?.includes(product)) {
          newItems.products.add(product);
        }
      });

      analysisData.analyzedContent.mainServices?.forEach((service: string) => {
        if (!previousContent.mainServices?.includes(service)) {
          newItems.services.add(service);
        }
      });

      analysisData.analyzedContent.keyFeatures?.forEach((feature: string) => {
        if (!previousContent.keyFeatures?.includes(feature)) {
          newItems.features.add(feature);
        }
      });

      analysisData.analyzedContent.uniqueSellingPoints?.forEach((usp: string) => {
        if (!previousContent.uniqueSellingPoints?.includes(usp)) {
          newItems.usps.add(usp);
        }
      });

      setNewlyAddedItems(newItems);
      queryClient.invalidateQueries({ queryKey: ["/api/analyzed-pages"] });
    }
  }, [analysisData, previousContent, queryClient]);

  const analyzeMutation = useMutation({
    mutationFn: async (data: { websiteUrl: string; additionalPages?: string[]; analyzeOnlyAdditional?: boolean }) => {
      const response = await fetch("/api/website-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to analyze website");
      }

      return response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/website-analysis"] });
      setAdditionalPages([]);
      toast({
        title: "Analysis Started",
        description: variables.analyzeOnlyAdditional
          ? `Analyzing ${variables.additionalPages?.length || 0} additional pages. Data will be merged with existing analysis...`
          : variables.additionalPages && variables.additionalPages.length > 0 
            ? `Analyzing ${variables.additionalPages.length + 1} pages. This may take a few minutes...`
            : "Your website is being analyzed. This may take a minute...",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (content: AnalyzedContent) => {
      const response = await fetch("/api/website-analysis", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ analyzedContent: content }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update analysis");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website-analysis"] });
      setIsEditing(false);
      setEditedContent(null);
      toast({
        title: "Success",
        description: "Website analysis updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/website-analysis", {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to reset analysis");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website-analysis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analyzed-pages"] });
      setShowResetDialog(false);
      toast({
        title: "Success",
        description: "Website analysis reset successfully. You can start fresh now.",
      });
    },
    onError: (error) => {
      setShowResetDialog(false);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deletePageMutation = useMutation({
    mutationFn: async (pageId: string) => {
      const response = await fetch(`/api/analyzed-pages/${pageId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete analyzed page");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analyzed-pages"] });
      setShowDeletePageDialog(false);
      setPageToDelete(null);
      toast({
        title: "Page Deleted",
        description: "Analyzed page removed successfully. Chroney will no longer use this content.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddPage = () => {
    if (!newPageUrl.trim()) return;
    
    try {
      const baseUrl = new URL(websiteUrl);
      const newUrl = new URL(newPageUrl);
      
      if (baseUrl.hostname !== newUrl.hostname) {
        toast({
          title: "Error",
          description: "Additional pages must be from the same domain as your configured website",
          variant: "destructive",
        });
        return;
      }
      
      if (additionalPages.includes(newPageUrl)) {
        toast({
          title: "Error",
          description: "This page has already been added",
          variant: "destructive",
        });
        return;
      }
      
      setAdditionalPages([...additionalPages, newPageUrl]);
      setNewPageUrl("");
    } catch (error) {
      toast({
        title: "Error",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
    }
  };

  const handleRemovePage = (index: number) => {
    setAdditionalPages(additionalPages.filter((_, i) => i !== index));
  };

  const handleAnalyze = () => {
    if (!websiteUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter a website URL",
        variant: "destructive",
      });
      return;
    }
    if (analysisData?.analyzedContent) {
      setPreviousContent(JSON.parse(JSON.stringify(analysisData.analyzedContent)));
    }
    analyzeMutation.mutate({ 
      websiteUrl, 
      additionalPages: additionalPages.length > 0 ? additionalPages : undefined,
      analyzeOnlyAdditional: false 
    });
  };

  const handleAnalyzeAdditionalOnly = () => {
    if (additionalPages.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one page to analyze",
        variant: "destructive",
      });
      return;
    }
    if (analysisData?.analyzedContent) {
      setPreviousContent(JSON.parse(JSON.stringify(analysisData.analyzedContent)));
    }
    const pagesToAnalyze = [...additionalPages];
    const newPages = pagesToAnalyze.map(url => ({ url, analyzed: false }));
    setAnalyzedPages(prev => [...prev, ...newPages]);
    setAdditionalPages([]);
    analyzeMutation.mutate({ 
      websiteUrl, 
      additionalPages: pagesToAnalyze,
      analyzeOnlyAdditional: true 
    });
  };

  const handleStartEdit = () => {
    if (content) {
      setEditedContent(JSON.parse(JSON.stringify(content)));
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedContent(null);
  };

  const handleSaveEdit = () => {
    if (editedContent) {
      updateMutation.mutate(editedContent);
    }
  };

  const handleConfirmReset = () => {
    deleteMutation.mutate();
  };

  const handleDeletePage = (pageId: string) => {
    setPageToDelete(pageId);
    setShowDeletePageDialog(true);
  };

  const confirmDeletePage = () => {
    if (pageToDelete) {
      deletePageMutation.mutate(pageToDelete);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto mb-3" />
          <p className="text-sm text-gray-600">Loading analysis...</p>
        </div>
      </div>
    );
  }

  const status = analysisData?.status || 'not_started';
  const content = analysisData?.analyzedContent;
  const isProcessing = status === 'pending' || status === 'analyzing';

  const hasNewItems = newlyAddedItems.products.size > 0 || 
                      newlyAddedItems.services.size > 0 || 
                      newlyAddedItems.features.size > 0 || 
                      newlyAddedItems.usps.size > 0;

  const StatusBadge = ({ status }: { status: string }) => {
    const configs = {
      not_started: { icon: Info, label: 'Not Started', className: 'bg-gray-100 text-gray-700 border-gray-300' },
      pending: { icon: Clock, label: 'Pending', className: 'bg-blue-100 text-blue-700 border-blue-300' },
      analyzing: { icon: Loader2, label: 'Analyzing', className: 'bg-purple-100 text-purple-700 border-purple-300' },
      completed: { icon: CheckCircle2, label: 'Completed', className: 'bg-green-100 text-green-700 border-green-300' },
      failed: { icon: AlertCircle, label: 'Failed', className: 'bg-red-100 text-red-700 border-red-300' },
    };

    const config = configs[status as keyof typeof configs] || configs.not_started;
    const Icon = config.icon;

    return (
      <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border-2 font-semibold text-sm ${config.className}`}>
        <Icon className={`w-4 h-4 ${status === 'analyzing' ? 'animate-spin' : ''}`} />
        {config.label}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30">
      <TrainingNavTabs />
      <div className="container mx-auto p-4 md:p-6 max-w-[1400px]">
        {/* Hero Section */}
        <div className="mb-6">
          <div className="bg-gradient-to-br from-[#0B0F1A] via-[#1e3a8a] to-[#7c3aed] rounded-2xl shadow-xl p-5 text-white">
            <div className="mb-4">
              <h1 className="text-2xl font-bold flex items-center gap-2 mb-1">
                <Globe className="w-6 h-6" />
                Website Analysis
              </h1>
              <p className="text-purple-100 text-xs max-w-2xl">
                Empower Chroney AI to understand your business deeply and provide intelligent, context-aware responses
              </p>
            </div>

            {/* Website URL Card */}
            <Card className="bg-white/95 backdrop-blur-sm border-0 shadow-lg">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 mb-1 font-medium">Your Website</p>
                    <div className="flex items-center gap-2">
                      <ExternalLink className="w-4 h-4 text-gray-400" />
                      <p className="font-semibold text-gray-900 text-base">
                        {websiteUrl || "No website configured"}
                      </p>
                    </div>
                    {analysisData?.lastAnalyzedAt && (
                      <p className="text-xs text-gray-500 mt-1.5">
                        Last analyzed: {new Date(analysisData.lastAnalyzedAt).toLocaleString()}
                      </p>
                    )}
                    {status === 'failed' && analysisData?.errorMessage && (
                      <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-xs text-red-700 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {analysisData.errorMessage}
                        </p>
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={handleAnalyze}
                    disabled={!websiteUrl || analyzeMutation.isPending || isProcessing}
                    className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 shadow-lg text-white px-5 py-2 text-sm rounded-lg"
                  >
                    {analyzeMutation.isPending || isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Analyze Website
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-gradient-to-r from-purple-50 to-white backdrop-blur-sm shadow-md h-auto p-1 rounded-xl">
            <TabsTrigger value="overview" className="flex items-center gap-2 py-2 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <Zap className="w-4 h-4" />
              <span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="pages" className="flex items-center gap-2 py-2 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Analyzed Pages</span>
              {analyzedPagesData && analyzedPagesData.length > 0 && (
                <Badge variant="secondary" className="ml-1">{analyzedPagesData.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex items-center gap-2 py-2 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <Building2 className="w-4 h-4" />
              <span className="hidden sm:inline">Business Profile</span>
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-6 space-y-6">
            {/* Want More Details Section */}
            {websiteUrl && status === 'completed' && (
              <Card className="shadow-md border-gray-200/60 bg-white/80 backdrop-blur-sm">
                <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-blue-50/50">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Plus className="w-5 h-5 text-purple-600" />
                    Want More Details?
                  </CardTitle>
                  <CardDescription>
                    Add specific pages from your website to extract additional information
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex gap-2">
                    <Input
                      value={newPageUrl}
                      onChange={(e) => setNewPageUrl(e.target.value)}
                      placeholder={`e.g., ${websiteUrl.replace(/\/$/, '')}/about`}
                      className="flex-1"
                      disabled={isProcessing}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddPage()}
                    />
                    <Button
                      onClick={handleAddPage}
                      disabled={!newPageUrl.trim() || isProcessing}
                      variant="outline"
                      className="border-purple-300 text-purple-700 hover:bg-purple-50"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Page
                    </Button>
                  </div>

                  {additionalPages.length > 0 && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        {additionalPages.map((page, index) => (
                          <div key={index} className="flex items-center gap-2 p-3 bg-purple-50 rounded-lg border border-purple-200">
                            <FileText className="w-4 h-4 text-purple-600 flex-shrink-0" />
                            <span className="flex-1 text-sm truncate font-medium">{page}</span>
                            <Button
                              onClick={() => handleRemovePage(index)}
                              variant="ghost"
                              size="sm"
                              disabled={isProcessing}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      
                      <Button
                        onClick={handleAnalyzeAdditionalOnly}
                        disabled={analyzeMutation.isPending || isProcessing}
                        className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                        size="lg"
                      >
                        {analyzeMutation.isPending || isProcessing ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 mr-2" />
                            Analyze {additionalPages.length} Additional {additionalPages.length === 1 ? 'Page' : 'Pages'}
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Important Notice */}
            <Card className="shadow-md border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50">
              <CardContent className="pt-4 pb-4">
                <div className="flex gap-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                      <Info className="w-5 h-5 text-amber-700" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-amber-900 mb-1 text-sm">Works Best with Standard HTML Sites</h4>
                    <p className="text-xs text-amber-800">
                      Website analysis is optimized for standard HTML websites. JavaScript-heavy sites (React, Vue, Angular single-page apps) may have limited results. For best analysis, ensure your key business information is available in regular HTML pages.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* How It Works */}
            <Card className="shadow-md border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2 text-blue-900">
                  <Sparkles className="w-4 h-4" />
                  How It Works
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <div className="flex gap-2">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">1</div>
                  <div>
                    <p className="text-xs font-semibold text-blue-900">AI Scans Your Website</p>
                    <p className="text-xs text-blue-700">Automatically extracts key business information from your pages</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">2</div>
                  <div>
                    <p className="text-xs font-semibold text-purple-900">Chroney Gets Smarter</p>
                    <p className="text-xs text-purple-700">Uses extracted data to provide context-aware, accurate responses</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-600 text-white flex items-center justify-center text-xs font-bold">3</div>
                  <div>
                    <p className="text-xs font-semibold text-green-900">Stay Updated</p>
                    <p className="text-xs text-green-700">Re-analyze anytime to update or add specific pages for more details</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analyzed Pages Tab */}
          <TabsContent value="pages" className="mt-6">
            <Card className="shadow-md border-gray-200/60 bg-white/80 backdrop-blur-sm">
              <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-blue-50/50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5 text-purple-600" />
                  Analyzed Pages Timeline
                </CardTitle>
                <CardDescription>
                  View all pages that have been analyzed and their extracted content
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {!analyzedPagesData || analyzedPagesData.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Analyzed Pages Yet</h3>
                    <p className="text-gray-600">Start by analyzing your website to see the results here</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Accordion type="single" collapsible className="space-y-2">
                      {analyzedPagesData.map((page, index) => {
                        const url = new URL(page.pageUrl);
                        const pathParts = url.pathname.split('/').filter(Boolean);
                        const pageName = pathParts[pathParts.length - 1] || 'Homepage';
                        const isHomepage = url.pathname === '/' || url.pathname === '';

                        return (
                          <AccordionItem 
                            key={page.id} 
                            value={page.id}
                            className="border-2 border-gray-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow"
                          >
                            <AccordionTrigger className="px-4 py-3 hover:no-underline">
                              <div className="flex items-center gap-3 w-full">
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-r from-purple-100 to-blue-100 flex items-center justify-center">
                                  <span className="text-sm font-bold text-purple-600">{index + 1}</span>
                                </div>
                                <div className="flex-1 text-left">
                                  <p className="font-semibold text-gray-900 capitalize">
                                    {isHomepage ? '🏠 Homepage' : `📄 ${pageName.replace(/-/g, ' ')}`}
                                  </p>
                                  <p className="text-xs text-gray-500 mt-0.5">{page.pageUrl}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">
                                    {new Date(page.analyzedAt).toLocaleDateString()}
                                  </Badge>
                                </div>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-4 pb-4">
                              <div className="mt-2 flex items-center justify-between gap-4">
                                <p className="text-xs text-gray-500">
                                  Analyzed: {new Date(page.analyzedAt).toLocaleString()}
                                </p>
                                <div className="flex gap-2">
                                  <Button
                                    onClick={() => setSelectedPageContent({ url: page.pageUrl, content: page.extractedContent || null })}
                                    variant="outline"
                                    size="sm"
                                    className="border-purple-300 text-purple-700 hover:bg-purple-50"
                                  >
                                    <FileText className="w-3 h-3 mr-1" />
                                    View Content
                                  </Button>
                                  <Button
                                    onClick={() => handleDeletePage(page.id)}
                                    variant="outline"
                                    size="sm"
                                    className="border-red-300 text-red-700 hover:bg-red-50"
                                  >
                                    <Trash2 className="w-3 h-3 mr-1" />
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        );
                      })}
                    </Accordion>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Business Profile Tab */}
          <TabsContent value="profile" className="mt-6 space-y-6">
            {!content ? (
              <Card className="shadow-md border-gray-200/60 bg-white/80 backdrop-blur-sm">
                <CardContent className="py-12">
                  <div className="text-center">
                    <Building2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Business Profile Yet</h3>
                    <p className="text-gray-600 mb-6">Analyze your website to generate your business profile</p>
                    <Button
                      onClick={handleAnalyze}
                      disabled={!websiteUrl || analyzeMutation.isPending || isProcessing}
                      className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Analyze Now
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Action Buttons */}
                <div className="flex justify-end gap-2">
                  {isEditing ? (
                    <>
                      <Button onClick={handleSaveEdit} disabled={updateMutation.isPending} size="sm" className="bg-green-600 hover:bg-green-700">
                        {updateMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving...</>
                        ) : (
                          <><Save className="w-4 h-4 mr-1" /> Save</>
                        )}
                      </Button>
                      <Button onClick={handleCancelEdit} variant="outline" size="sm">
                        <X className="w-4 h-4 mr-1" />
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={handleStartEdit} variant="outline" size="sm" className="border-purple-300 text-purple-700 hover:bg-purple-50">
                        <Edit className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                      <Button onClick={() => setShowResetDialog(true)} variant="outline" size="sm" className="border-red-300 text-red-700 hover:bg-red-50">
                        <Trash2 className="w-4 h-4 mr-1" />
                        Reset
                      </Button>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Identity Card */}
                <Card className="shadow-md border-gray-200/60 bg-white/80 backdrop-blur-sm lg:col-span-2">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-blue-50/50">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-purple-600" />
                      Business Identity
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-5">
                    {isEditing ? (
                      <>
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Business Name</label>
                          <Input
                            value={editedContent?.businessName || ''}
                            onChange={(e) => setEditedContent(editedContent ? { ...editedContent, businessName: e.target.value } : null)}
                            placeholder="Enter business name"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Business Description</label>
                          <Textarea
                            value={editedContent?.businessDescription || ''}
                            onChange={(e) => setEditedContent(editedContent ? { ...editedContent, businessDescription: e.target.value } : null)}
                            placeholder="Describe your business"
                            rows={4}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Target Audience</label>
                          <Textarea
                            value={editedContent?.targetAudience || ''}
                            onChange={(e) => setEditedContent(editedContent ? { ...editedContent, targetAudience: e.target.value } : null)}
                            placeholder="Who are your ideal customers?"
                            rows={3}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        {content.businessName && (
                          <div>
                            <h3 className="font-semibold text-gray-700 text-sm mb-2 flex items-center gap-2">
                              <Building2 className="w-4 h-4 text-purple-600" />
                              Business Name
                            </h3>
                            <p className="text-gray-900 font-medium text-lg">{content.businessName}</p>
                          </div>
                        )}
                        {content.businessDescription && (
                          <div>
                            <h3 className="font-semibold text-gray-700 text-sm mb-2 flex items-center gap-2">
                              <Info className="w-4 h-4 text-blue-600" />
                              Description
                            </h3>
                            <p className="text-gray-700 leading-relaxed">{content.businessDescription}</p>
                          </div>
                        )}
                        {content.targetAudience && (
                          <div>
                            <h3 className="font-semibold text-gray-700 text-sm mb-2 flex items-center gap-2">
                              <Users className="w-4 h-4 text-green-600" />
                              Target Audience
                            </h3>
                            <p className="text-gray-700 leading-relaxed">{content.targetAudience}</p>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Offerings Card */}
                <Card className="shadow-md border-gray-200/60 bg-white/80 backdrop-blur-sm">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Package className="w-5 h-5 text-purple-600" />
                      Products & Services
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-5">
                    {isEditing ? (
                      <>
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Main Products (one per line)</label>
                          <Textarea
                            value={editedContent?.mainProducts?.join('\n') || ''}
                            onChange={(e) => setEditedContent(editedContent ? { 
                              ...editedContent, 
                              mainProducts: e.target.value.split('\n').filter(p => p.trim()) 
                            } : null)}
                            placeholder="Product 1&#10;Product 2&#10;Product 3"
                            rows={4}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Main Services (one per line)</label>
                          <Textarea
                            value={editedContent?.mainServices?.join('\n') || ''}
                            onChange={(e) => setEditedContent(editedContent ? { 
                              ...editedContent, 
                              mainServices: e.target.value.split('\n').filter(s => s.trim()) 
                            } : null)}
                            placeholder="Service 1&#10;Service 2&#10;Service 3"
                            rows={4}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        {content.mainProducts && content.mainProducts.length > 0 && (
                          <div>
                            <h3 className="font-semibold text-gray-700 text-sm mb-3">Products</h3>
                            <div className="flex flex-wrap gap-2">
                              {content.mainProducts.map((product, idx) => (
                                <Badge 
                                  key={idx} 
                                  variant="secondary" 
                                  className={`px-3 py-1.5 ${
                                    newlyAddedItems.products.has(product) 
                                      ? 'bg-green-100 text-green-800 border-green-300 border-2' 
                                      : 'bg-purple-100 text-purple-800'
                                  }`}
                                >
                                  {newlyAddedItems.products.has(product) && '✨ '}
                                  {product}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        {content.mainServices && content.mainServices.length > 0 && (
                          <div>
                            <h3 className="font-semibold text-gray-700 text-sm mb-3">Services</h3>
                            <div className="flex flex-wrap gap-2">
                              {content.mainServices.map((service, idx) => (
                                <Badge 
                                  key={idx} 
                                  variant="secondary" 
                                  className={`px-3 py-1.5 ${
                                    newlyAddedItems.services.has(service) 
                                      ? 'bg-green-100 text-green-800 border-green-300 border-2' 
                                      : 'bg-blue-100 text-blue-800'
                                  }`}
                                >
                                  {newlyAddedItems.services.has(service) && '✨ '}
                                  {service}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        {(!content.mainProducts || content.mainProducts.length === 0) && 
                         (!content.mainServices || content.mainServices.length === 0) && (
                          <p className="text-sm text-gray-500 italic">No products or services found</p>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Key Details Card */}
                <Card className="shadow-md border-gray-200/60 bg-white/80 backdrop-blur-sm">
                  <CardHeader className="border-b bg-gradient-to-r from-blue-50/50 to-purple-50/50">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Star className="w-5 h-5 text-blue-600" />
                      Features & USPs
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-5">
                    {isEditing ? (
                      <>
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Key Features (one per line)</label>
                          <Textarea
                            value={editedContent?.keyFeatures?.join('\n') || ''}
                            onChange={(e) => setEditedContent(editedContent ? { 
                              ...editedContent, 
                              keyFeatures: e.target.value.split('\n').filter(f => f.trim()) 
                            } : null)}
                            placeholder="Feature 1&#10;Feature 2&#10;Feature 3"
                            rows={4}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Unique Selling Points (one per line)</label>
                          <Textarea
                            value={editedContent?.uniqueSellingPoints?.join('\n') || ''}
                            onChange={(e) => setEditedContent(editedContent ? { 
                              ...editedContent, 
                              uniqueSellingPoints: e.target.value.split('\n').filter(u => u.trim()) 
                            } : null)}
                            placeholder="USP 1&#10;USP 2&#10;USP 3"
                            rows={4}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        {content.keyFeatures && content.keyFeatures.length > 0 && (
                          <div>
                            <h3 className="font-semibold text-gray-700 text-sm mb-3">Key Features</h3>
                            <div className="space-y-2">
                              {content.keyFeatures.map((feature, idx) => (
                                <div 
                                  key={idx} 
                                  className={`flex items-start gap-2 p-2 rounded-lg ${
                                    newlyAddedItems.features.has(feature) 
                                      ? 'bg-green-50 border-2 border-green-300' 
                                      : 'bg-gray-50'
                                  }`}
                                >
                                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                                  <span className="text-sm text-gray-700">
                                    {newlyAddedItems.features.has(feature) && '✨ '}
                                    {feature}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {content.uniqueSellingPoints && content.uniqueSellingPoints.length > 0 && (
                          <div>
                            <h3 className="font-semibold text-gray-700 text-sm mb-3">Unique Selling Points</h3>
                            <div className="space-y-2">
                              {content.uniqueSellingPoints.map((usp, idx) => (
                                <div 
                                  key={idx} 
                                  className={`flex items-start gap-2 p-2 rounded-lg ${
                                    newlyAddedItems.usps.has(usp) 
                                      ? 'bg-green-50 border-2 border-green-300' 
                                      : 'bg-gray-50'
                                  }`}
                                >
                                  <Award className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
                                  <span className="text-sm text-gray-700">
                                    {newlyAddedItems.usps.has(usp) && '✨ '}
                                    {usp}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {(!content.keyFeatures || content.keyFeatures.length === 0) && 
                         (!content.uniqueSellingPoints || content.uniqueSellingPoints.length === 0) && (
                          <p className="text-sm text-gray-500 italic">No features or USPs found</p>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Contact & Operations Card */}
                <Card className="shadow-md border-gray-200/60 bg-white/80 backdrop-blur-sm lg:col-span-2">
                  <CardHeader className="border-b bg-gradient-to-r from-green-50/50 to-blue-50/50">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Phone className="w-5 h-5 text-green-600" />
                      Contact & Operations
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    {isEditing ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Email</label>
                          <Input
                            value={editedContent?.contactInfo?.email || ''}
                            onChange={(e) => setEditedContent(editedContent ? { 
                              ...editedContent, 
                              contactInfo: { ...editedContent.contactInfo, email: e.target.value } 
                            } : null)}
                            placeholder="email@example.com"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Phone</label>
                          <Input
                            value={editedContent?.contactInfo?.phone || ''}
                            onChange={(e) => setEditedContent(editedContent ? { 
                              ...editedContent, 
                              contactInfo: { ...editedContent.contactInfo, phone: e.target.value } 
                            } : null)}
                            placeholder="+1 (555) 123-4567"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Address</label>
                          <Input
                            value={editedContent?.contactInfo?.address || ''}
                            onChange={(e) => setEditedContent(editedContent ? { 
                              ...editedContent, 
                              contactInfo: { ...editedContent.contactInfo, address: e.target.value } 
                            } : null)}
                            placeholder="123 Business St, City, State ZIP"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Business Hours</label>
                          <Input
                            value={editedContent?.businessHours || ''}
                            onChange={(e) => setEditedContent(editedContent ? { ...editedContent, businessHours: e.target.value } : null)}
                            placeholder="Mon-Fri 9AM-5PM"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Pricing Information</label>
                          <Input
                            value={editedContent?.pricingInfo || ''}
                            onChange={(e) => setEditedContent(editedContent ? { ...editedContent, pricingInfo: e.target.value } : null)}
                            placeholder="Starting at $99"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-semibold text-gray-900 mb-2">Additional Information</label>
                          <Textarea
                            value={editedContent?.additionalInfo || ''}
                            onChange={(e) => setEditedContent(editedContent ? { ...editedContent, additionalInfo: e.target.value } : null)}
                            placeholder="Any other relevant information"
                            rows={3}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {content.contactInfo?.email && (
                          <div className="flex items-start gap-3">
                            <Mail className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-gray-500 font-semibold mb-1">Email</p>
                              <p className="text-gray-900">{content.contactInfo.email}</p>
                            </div>
                          </div>
                        )}
                        {content.contactInfo?.phone && (
                          <div className="flex items-start gap-3">
                            <Phone className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-gray-500 font-semibold mb-1">Phone</p>
                              <p className="text-gray-900">{content.contactInfo.phone}</p>
                            </div>
                          </div>
                        )}
                        {content.contactInfo?.address && (
                          <div className="flex items-start gap-3 md:col-span-2">
                            <MapPin className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-gray-500 font-semibold mb-1">Address</p>
                              <p className="text-gray-900">{content.contactInfo.address}</p>
                            </div>
                          </div>
                        )}
                        {content.businessHours && (
                          <div className="flex items-start gap-3">
                            <Calendar className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-gray-500 font-semibold mb-1">Business Hours</p>
                              <p className="text-gray-900">{content.businessHours}</p>
                            </div>
                          </div>
                        )}
                        {content.pricingInfo && (
                          <div className="flex items-start gap-3">
                            <DollarSign className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-gray-500 font-semibold mb-1">Pricing</p>
                              <p className="text-gray-900">{content.pricingInfo}</p>
                            </div>
                          </div>
                        )}
                        {content.additionalInfo && (
                          <div className="flex items-start gap-3 md:col-span-2">
                            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-gray-500 font-semibold mb-1">Additional Information</p>
                              <p className="text-gray-900 leading-relaxed">{content.additionalInfo}</p>
                            </div>
                          </div>
                        )}
                        {!content.contactInfo?.email && 
                         !content.contactInfo?.phone && 
                         !content.contactInfo?.address && 
                         !content.businessHours && 
                         !content.pricingInfo && 
                         !content.additionalInfo && (
                          <p className="text-sm text-gray-500 italic md:col-span-2">No contact or operational information found</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Website Analysis?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all extracted information from your website analysis. You'll need to re-analyze your website from scratch. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReset}
              disabled={deleteMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Resetting...</>
              ) : (
                "Reset Analysis"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Page Confirmation Dialog */}
      <AlertDialog open={showDeletePageDialog} onOpenChange={setShowDeletePageDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Analyzed Page</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this analyzed page? Chroney will no longer use this content. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePageMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeletePage}
              disabled={deletePageMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deletePageMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting...</>
              ) : (
                "Delete Page"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View Page Content Dialog */}
      <Dialog open={!!selectedPageContent} onOpenChange={(open) => !open && setSelectedPageContent(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-purple-600" />
              Extracted Content
            </DialogTitle>
            <DialogDescription className="text-sm break-all">
              {selectedPageContent?.url}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            {selectedPageContent?.content ? (
              <div className="prose prose-sm max-w-none">
                <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed p-4 bg-gray-50 rounded-lg border border-gray-200">
                  {selectedPageContent.content}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Info className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500 italic">
                  No relevant business information found on this page
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
