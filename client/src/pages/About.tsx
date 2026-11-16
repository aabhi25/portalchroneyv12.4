import { brandShort } from "@/lib/brand";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import TrainingNavTabs from "@/components/TrainingNavTabs";
import { ChannelPicker, ChannelFilterSelect, matchesChannelFilter, type ChannelFilterValue } from "@/components/ChannelPicker";
import { type KnowledgeChannel } from "@shared/knowledgeChannels";
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
  /** Fields copied word for word from the website (not read by the AI). */
  exactFromWebsite?: ("phone" | "email" | "address" | "businessHours")[];
}

/** POST /api/website-analysis/pages: the website's pages worth reading (server/services/websitePages.ts). */
interface FoundPage {
  url: string;
  kind: string;
  label: string;
  picked: boolean;
  alreadyRead?: boolean;
}
interface PageDiscovery {
  pages: FoundPage[];
  leftOut: { products: number; collections: number; blog: number; other: number; sitemaps: string[] };
  source: "sitemap" | "links";
  defaultPick: number;
  maxPick: number;
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
  channels?: string[] | null;
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
  const [pageChannelFilter, setPageChannelFilter] = useState<ChannelFilterValue>("all");
  // Page list shown before a full scan: the pages found on the website, the best ones ticked.
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [chosenPages, setChosenPages] = useState<Set<string>>(new Set());

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

  const discoverMutation = useMutation({
    mutationFn: async (): Promise<PageDiscovery> => {
      const response = await fetch("/api/website-analysis/pages", { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Couldn't look through the website");
      return body;
    },
    onSuccess: (found) => setChosenPages(new Set(found.pages.filter(p => p.picked).map(p => p.url))),
  });

  const analyzeMutation = useMutation({
    mutationFn: async (data: { websiteUrl: string; additionalPages?: string[]; analyzeOnlyAdditional?: boolean; pages?: string[] }) => {
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
        description: variables.pages
          ? `Reading ${variables.pages.length} ${variables.pages.length === 1 ? "page" : "pages"}. This takes a minute or two...`
          : variables.analyzeOnlyAdditional
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

  const pageChannelsMutation = useMutation({
    mutationFn: async ({ id, channels }: { id: string; channels: KnowledgeChannel[] | null }) => {
      const response = await fetch(`/api/analyzed-pages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channels }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to update channels");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analyzed-pages"] });
      toast({
        title: "Channels Updated",
        description: "The page's channels were saved.",
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
        description: `Analyzed page removed successfully. ${brandShort()} will no longer use this content.`,
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
    // Pages typed in "Want more details" are read together with the homepage, as before.
    if (additionalPages.length > 0) {
      if (analysisData?.analyzedContent) {
        setPreviousContent(JSON.parse(JSON.stringify(analysisData.analyzedContent)));
      }
      analyzeMutation.mutate({ websiteUrl, additionalPages, analyzeOnlyAdditional: false });
      return;
    }
    // Otherwise: look through the website and let the business choose the pages.
    setPagePickerOpen(true);
    discoverMutation.mutate();
  };

  const handleReadChosenPages = (pages?: string[]) => {
    if (analysisData?.analyzedContent) {
      setPreviousContent(JSON.parse(JSON.stringify(analysisData.analyzedContent)));
    }
    setPagePickerOpen(false);
    // No list (the website couldn't be looked through): the old full scan from the homepage links.
    analyzeMutation.mutate(pages ? { websiteUrl, pages } : { websiteUrl, analyzeOnlyAdditional: false });
  };

  const togglePage = (url: string, on: boolean) => {
    setChosenPages(prev => {
      const next = new Set(prev);
      if (on) next.add(url); else next.delete(url);
      return next;
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
      // A field changed by hand is no longer "exact from the website".
      const original = content;
      const exact = (editedContent.exactFromWebsite || []).filter(f =>
        f === "businessHours"
          ? editedContent.businessHours === original?.businessHours
          : editedContent.contactInfo?.[f] === original?.contactInfo?.[f]);
      updateMutation.mutate({ ...editedContent, exactFromWebsite: exact });
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

  return (
    <div className="flex-1 overflow-auto bg-gray-50/60">
      <TrainingNavTabs />
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        {/* Website + scan */}
        <section className="mb-5 rounded-2xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]" data-testid="scan-header">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-50">
                <Globe className="h-5 w-5 text-purple-600" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-gray-900">Website scan</h1>
                <p className="text-sm text-gray-500">
                  {brandShort()} reads your website's pages (about, contact, FAQ, shipping, returns…) so it can answer customers about your business.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {websiteUrl ? (
                    <a href={websiteUrl} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-medium text-gray-900 hover:text-purple-700">
                      <span className="truncate">{websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    </a>
                  ) : (
                    <span className="text-gray-500">No website address in Account settings</span>
                  )}
                  {isProcessing ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700" data-testid="status-scan-reading">
                      <Loader2 className="h-3 w-3 animate-spin" /> Reading pages…
                    </span>
                  ) : analysisData?.lastAnalyzedAt ? (
                    <span className="text-xs text-gray-500">Last scanned {new Date(analysisData.lastAnalyzedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  ) : null}
                </div>
              </div>
            </div>
            <Button
              onClick={handleAnalyze}
              disabled={!websiteUrl || analyzeMutation.isPending || isProcessing}
              className="shrink-0 bg-purple-600 text-white hover:bg-purple-700"
              data-testid="button-scan-website"
            >
              {analyzeMutation.isPending || isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {isProcessing ? "Scanning…" : (analyzedPagesData?.length ?? 0) > 0 ? "Scan again" : "Scan website"}
            </Button>
          </div>
          {status === 'failed' && analysisData?.errorMessage && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{analysisData.errorMessage}
            </p>
          )}
          {isProcessing && (
            <p className="mt-4 text-xs text-gray-500">This takes a minute or two. You can leave this page; the results appear here when it's done.</p>
          )}
        </section>

        {/* First time: what happens */}
        {(analyzedPagesData?.length ?? 0) === 0 && !isProcessing && (
          <section className="mb-5 grid gap-3 sm:grid-cols-3" data-testid="scan-how">
            {[
              { n: 1, t: "Choose the pages", d: "We list your website's useful pages and tick the best ones." },
              { n: 2, t: "We read them", d: "Contact details, timings and FAQs are copied exactly; the rest is summarised." },
              { n: 3, t: `${brandShort()} answers from them`, d: "Scan again any time your website changes." },
            ].map(x => (
              <div key={x.n} className="flex gap-3 rounded-xl border border-black/[0.06] bg-white p-4">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-purple-600 text-xs font-semibold text-white">{x.n}</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">{x.t}</p>
                  <p className="text-xs text-gray-500">{x.d}</p>
                </div>
              </div>
            ))}
          </section>
        )}

        <Tabs defaultValue="pages" className="w-full">
          <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0">
            {[
              { v: "pages", label: "Pages read", icon: FileText, count: analyzedPagesData?.length ?? 0 },
              { v: "profile", label: "Business profile", icon: Building2, count: null },
            ].map(t => (
              <TabsTrigger
                key={t.v}
                value={t.v}
                className="-mb-px flex items-center gap-2 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2.5 text-sm text-gray-500 shadow-none data-[state=active]:border-purple-600 data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-gray-900 data-[state=active]:shadow-none"
              >
                <t.icon className="h-4 w-4" />
                {t.label}
                {t.count ? <span className="rounded-full bg-gray-100 px-1.5 text-xs font-medium text-gray-600">{t.count}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Pages read */}
          <TabsContent value="pages" className="mt-5">
            <section className="rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                <div>
                  <h2 className="font-semibold text-gray-900">Pages the AI has read</h2>
                  <p className="text-xs text-gray-500">Open a page to see what the AI took from it. Remove a page and the AI stops using it.</p>
                </div>
                {analyzedPagesData && analyzedPagesData.length > 0 && (
                  <ChannelFilterSelect value={pageChannelFilter} onChange={setPageChannelFilter} />
                )}
              </div>

              {!analyzedPagesData || analyzedPagesData.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                  <p className="font-medium text-gray-700">No pages read yet</p>
                  <p className="mt-1 text-sm text-gray-500">Press Scan website to choose the pages.</p>
                </div>
              ) : !analyzedPagesData.some(p => matchesChannelFilter(p.channels, pageChannelFilter)) ? (
                <div className="px-5 py-12 text-center">
                  <p className="mb-3 text-sm text-gray-600">No pages are used on this channel</p>
                  <Button variant="outline" size="sm" onClick={() => setPageChannelFilter("all")}>Show all channels</Button>
                </div>
              ) : (
                <ul className="divide-y">
                  {analyzedPagesData.filter(p => matchesChannelFilter(p.channels, pageChannelFilter)).map((page) => {
                    let path = page.pageUrl;
                    try { path = new URL(page.pageUrl).pathname || "/"; } catch { /* keep the address */ }
                    const last = path.split("/").filter(Boolean).pop();
                    const title = last ? decodeURIComponent(last).replace(/[-_]+/g, " ") : "Homepage";
                    const empty = !page.extractedContent || page.extractedContent === 'No relevant business information found on this page.';
                    return (
                      <li key={page.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3" data-testid={`row-scan-page-${page.id}`}>
                        <button
                          type="button"
                          onClick={() => setSelectedPageContent({ url: page.pageUrl, content: page.extractedContent || null })}
                          className="flex min-w-0 flex-1 basis-full items-center gap-3 text-left sm:basis-0"
                        >
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gray-100">
                            <FileText className="h-4 w-4 text-gray-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium capitalize text-gray-900">{title}</p>
                            <p className="truncate text-xs text-gray-500">
                              {path} · {new Date(page.analyzedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                              {empty && <span className="ml-2 text-amber-600">nothing useful found</span>}
                            </p>
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
                          <ChannelPicker
                            compact
                            value={page.channels ?? null}
                            disabled={pageChannelsMutation.isPending}
                            onChange={(channels) => pageChannelsMutation.mutate({ id: page.id, channels })}
                          />
                          <Button variant="outline" size="sm" className="h-8" onClick={() => setSelectedPageContent({ url: page.pageUrl, content: page.extractedContent || null })}>
                            View
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:bg-red-50 hover:text-red-600" onClick={() => handleDeletePage(page.id)} aria-label={`Remove ${path}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Add one page by its address */}
              {websiteUrl && (status === 'completed' || (analyzedPagesData?.length ?? 0) > 0) && (
                <div className="space-y-3 border-t bg-gray-50/60 px-5 py-4">
                  <p className="text-sm font-medium text-gray-700">Add a page that wasn't in the list</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={newPageUrl}
                      onChange={(e) => setNewPageUrl(e.target.value)}
                      placeholder={`e.g. ${websiteUrl.replace(/\/$/, '')}/about`}
                      className="flex-1 bg-white"
                      disabled={isProcessing}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddPage()}
                      data-testid="input-scan-add-page"
                    />
                    <Button onClick={handleAddPage} disabled={!newPageUrl.trim() || isProcessing} variant="outline" className="bg-white">
                      <Plus className="mr-1 h-4 w-4" /> Add
                    </Button>
                  </div>
                  {additionalPages.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {additionalPages.map((page, index) => (
                          <span key={index} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-white py-1 pl-3 pr-1 text-xs">
                            <span className="truncate">{page.replace(/^https?:\/\/[^/]+/, '') || page}</span>
                            <button type="button" onClick={() => handleRemovePage(index)} disabled={isProcessing} className="rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Remove">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <Button onClick={handleAnalyzeAdditionalOnly} disabled={analyzeMutation.isPending || isProcessing} className="bg-purple-600 text-white hover:bg-purple-700">
                        {analyzeMutation.isPending || isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        Read {additionalPages.length} {additionalPages.length === 1 ? 'page' : 'pages'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </section>
            <p className="mt-3 flex items-start gap-1.5 px-1 text-xs text-gray-400">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Pages built entirely by JavaScript can come back empty. Put key details (contact, timings, policies) on regular pages, or upload them in Documents.
            </p>
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
                              <p className="text-xs text-gray-500 font-semibold mb-1">Email{content.exactFromWebsite?.includes("email") && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700" title="Copied word for word from the website">exact from website</span>}</p>
                              <p className="text-gray-900">{content.contactInfo.email}</p>
                            </div>
                          </div>
                        )}
                        {content.contactInfo?.phone && (
                          <div className="flex items-start gap-3">
                            <Phone className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-gray-500 font-semibold mb-1">Phone{content.exactFromWebsite?.includes("phone") && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700" title="Copied word for word from the website">exact from website</span>}</p>
                              <p className="text-gray-900">{content.contactInfo.phone}</p>
                            </div>
                          </div>
                        )}
                        {content.contactInfo?.address && (
                          <div className="flex items-start gap-3 md:col-span-2">
                            <MapPin className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-gray-500 font-semibold mb-1">Address{content.exactFromWebsite?.includes("address") && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700" title="Copied word for word from the website">exact from website</span>}</p>
                              <p className="text-gray-900">{content.contactInfo.address}</p>
                            </div>
                          </div>
                        )}
                        {content.businessHours && (
                          <div className="flex items-start gap-3">
                            <Calendar className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-gray-500 font-semibold mb-1">Business Hours{content.exactFromWebsite?.includes("businessHours") && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700" title="Copied word for word from the website">exact from website</span>}</p>
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
      {/* Pages to read: found on the website (sitemap + homepage links), the best ones ticked */}
      <Dialog open={pagePickerOpen} onOpenChange={setPagePickerOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col" data-testid="dialog-scan-pages">
          <DialogHeader>
            <DialogTitle>Choose the pages to read</DialogTitle>
            <DialogDescription>
              The pages that answer customers' questions (about, contact, FAQ, shipping, returns, stores…) are ticked.
              Tick or untick pages, then press Read.
            </DialogDescription>
          </DialogHeader>
          {discoverMutation.isPending ? (
            <div className="flex items-center gap-2 py-10 justify-center text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Looking through {websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}…
            </div>
          ) : discoverMutation.isError ? (
            <div className="space-y-3 py-4 text-sm">
              <p className="flex items-start gap-2 text-red-700"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{discoverMutation.error.message}</p>
              <Button variant="outline" onClick={() => handleReadChosenPages()} data-testid="button-scan-from-links">Read the homepage and its links instead</Button>
            </div>
          ) : discoverMutation.data ? (() => {
            const found = discoverMutation.data;
            const origin = (() => { try { return new URL(found.pages[0]?.url || websiteUrl).origin; } catch { return ""; } })();
            // Rows stay where they started (suggested / more), only the tick changes.
            const ticked = found.pages.filter(p => p.picked);
            const rest = found.pages.filter(p => !p.picked);
            const tooMany = chosenPages.size > found.maxPick;
            const leftOut = [
              found.leftOut.products && `${found.leftOut.products.toLocaleString()} product pages`,
              found.leftOut.collections && `${found.leftOut.collections.toLocaleString()} collection pages`,
              found.leftOut.blog && `${found.leftOut.blog.toLocaleString()} blog posts`,
            ].filter(Boolean).join(", ");
            const row = (p: FoundPage) => (
              <div key={p.url} onClick={() => togglePage(p.url, !chosenPages.has(p.url))} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-gray-50 cursor-pointer" data-testid={`row-scan-page-${p.kind}`}>
                <Checkbox checked={chosenPages.has(p.url)} onCheckedChange={(v) => togglePage(p.url, v === true)} onClick={(e) => e.stopPropagation()} aria-label={p.url} />
                <span className="hidden w-32 shrink-0 sm:block"><Badge variant="outline" className="text-[11px] font-medium">{p.label}</Badge></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-800" title={p.url}>{p.url.replace(origin, "") || "/"}</span>
                  <span className="block text-[11px] text-gray-500 sm:hidden">{p.label}{p.alreadyRead ? " · read before" : ""}</span>
                </span>
                {p.alreadyRead && <span className="hidden shrink-0 text-[11px] text-gray-400 sm:inline">read before</span>}
              </div>
            );
            return (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border p-2 space-y-0.5">
                  {ticked.map(row)}
                  {rest.length > 0 && <div className="px-2 pt-3 pb-1 text-xs font-semibold text-gray-500">More pages found ({rest.length})</div>}
                  {rest.map(row)}
                </div>
                <p className="text-xs text-gray-500">
                  {found.source === "sitemap" ? "Found in the website's sitemap and homepage links." : "Found from the homepage links (the website has no sitemap)."}
                  {leftOut && <> Left out: {leftOut} — products belong in Products.</>}
                </p>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {tooMany && <span className="mr-auto text-xs text-red-600">Tick at most {found.maxPick} pages.</span>}
                  <Button variant="outline" onClick={() => setPagePickerOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => handleReadChosenPages(Array.from(chosenPages))}
                    disabled={chosenPages.size === 0 || tooMany || analyzeMutation.isPending}
                    className="bg-gradient-to-r from-purple-600 to-blue-600 text-white"
                    data-testid="button-scan-read-pages"
                  >
                    <Sparkles className="w-4 h-4 mr-2" /> Read {chosenPages.size} {chosenPages.size === 1 ? "page" : "pages"}
                  </Button>
                </div>
              </>
            );
          })() : null}
        </DialogContent>
      </Dialog>

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
              Are you sure you want to delete this analyzed page? {brandShort()} will no longer use this content. This action cannot be undone.
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
