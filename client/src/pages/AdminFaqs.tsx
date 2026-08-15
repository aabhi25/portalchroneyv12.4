import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useInfiniteQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Faq } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Sparkles, AlertTriangle, CheckCircle, Lightbulb, TrendingUp, Loader2, Copy, Search, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import TrainingNavTabs from "@/components/TrainingNavTabs";

interface FaqQualityAnalysis {
  score: number;
  specificity: number;
  completeness: number;
  searchability: number;
  issues: string[];
  suggestions: string[];
  improvedQuestion: string | null;
  improvedAnswer: string | null;
  similarFaqs: number[];
  duplicateWarning: string | null;
}

const PAGE_SIZE = 20;

export default function AdminFaqs() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [viewFaqDialogOpen, setViewFaqDialogOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<Faq | null>(null);
  const [viewingFaq, setViewingFaq] = useState<Faq | null>(null);
  const [faqToDelete, setFaqToDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    question: "",
    answer: "",
    category: "",
  });
  const [qualityAnalysis, setQualityAnalysis] = useState<FaqQualityAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["/api/faqs", debouncedSearch],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/faqs?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch FAQs");
      return res.json() as Promise<{ faqs: Faq[]; total: number; hasMore: boolean }>;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      const totalLoaded = allPages.reduce((sum, p) => sum + p.faqs.length, 0);
      return totalLoaded;
    },
    initialPageParam: 0,
    placeholderData: keepPreviousData,
  });

  const faqs = data?.pages.flatMap((p) => p.faqs) ?? [];
  const totalCount = data?.pages[0]?.total ?? 0;

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/faqs", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/faqs"] });
      setIsDialogOpen(false);
      resetForm();
      toast({
        title: "FAQ created",
        description: "FAQ has been created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create FAQ",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return await apiRequest("PATCH", `/api/faqs/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/faqs"] });
      setIsDialogOpen(false);
      resetForm();
      toast({
        title: "FAQ updated",
        description: "FAQ has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update FAQ",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/faqs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/faqs"] });
      setDeleteDialogOpen(false);
      setFaqToDelete(null);
      toast({
        title: "FAQ deleted",
        description: "FAQ has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete FAQ",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      question: "",
      answer: "",
      category: "",
    });
    setEditingFaq(null);
    setQualityAnalysis(null);
  };

  const analyzeQuality = async () => {
    if (!formData.question.trim() && !formData.answer.trim()) {
      return;
    }
    
    setQualityAnalysis(null);
    setIsAnalyzing(true);
    try {
      const response = await fetch("/api/faqs/analyze-quality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ question: formData.question, answer: formData.answer })
      });
      if (response.ok) {
        const data = await response.json();
        setQualityAnalysis(data);
      }
    } catch (error) {
      console.error("Error analyzing FAQ quality:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (faq: Faq) => {
    setEditingFaq(faq);
    setFormData({
      question: faq.question,
      answer: faq.answer,
      category: faq.category || "",
    });
    setQualityAnalysis(null);
    setIsDialogOpen(true);
  };

  const handleFormChange = (field: 'question' | 'answer' | 'category', value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  const applyImprovedQuestion = () => {
    if (qualityAnalysis?.improvedQuestion) {
      setFormData({ ...formData, question: qualityAnalysis.improvedQuestion });
      toast({ title: "Question updated", description: "The improved question has been applied." });
    }
  };

  const applyImprovedAnswer = () => {
    if (qualityAnalysis?.improvedAnswer) {
      setFormData({ ...formData, answer: qualityAnalysis.improvedAnswer });
      toast({ title: "Answer updated", description: "The improved answer has been applied." });
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Needs Improvement";
    return "Poor";
  };

  const openViewFaqDialog = (faq: Faq) => {
    setViewingFaq(faq);
    setViewFaqDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingFaq) {
      updateMutation.mutate({ id: editingFaq.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: string) => {
    setFaqToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (faqToDelete) {
      deleteMutation.mutate(faqToDelete);
    }
  };

  if (isLoading) {
    return (
      <div>
        <TrainingNavTabs />
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <p className="text-sm text-gray-500">Loading FAQs...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TrainingNavTabs />
      <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              FAQs Management {totalCount > 0 && <span className="text-lg font-semibold text-gray-500">({totalCount})</span>}
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage your frequently asked questions
            </p>
          </div>
          <Button onClick={openCreateDialog} className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
            <Plus className="mr-2 h-4 w-4" />
            Add FAQ
          </Button>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search FAQs by question or answer..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Card>
          <CardContent className="pt-6">
            {faqs.length === 0 && !isLoading ? (
              <div className="text-center py-12">
                {debouncedSearch ? (
                  <>
                    <Search className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                    <p className="text-gray-500 mb-2">No FAQs found matching "{debouncedSearch}"</p>
                    <Button variant="outline" onClick={() => setSearchInput("")}>
                      Clear search
                    </Button>
                  </>
                ) : (
                  <>
                    <Plus className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                    <p className="text-gray-500 mb-4">No published FAQs yet</p>
                    <Button onClick={openCreateDialog}>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Your First FAQ
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40%]">Question</TableHead>
                      <TableHead className="min-w-[120px]">Category</TableHead>
                      <TableHead className="min-w-[120px]">Created</TableHead>
                      <TableHead className="text-right min-w-[110px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {faqs.map((faq) => (
                      <TableRow 
                        key={faq.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => openViewFaqDialog(faq)}
                      >
                        <TableCell className="font-medium">
                          <div className="max-w-md break-words whitespace-normal">{faq.question}</div>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 whitespace-nowrap">
                            {faq.category || "General"}
                          </span>
                        </TableCell>
                        <TableCell className="text-gray-500 text-sm whitespace-nowrap">
                          {new Date(faq.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2 min-w-max">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditDialog(faq);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(faq.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {hasNextPage && (
                  <div ref={sentinelRef} className="py-4 flex justify-center">
                    {isFetchingNextPage && (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading more...
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit FAQ Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingFaq ? "Edit FAQ" : "Create New FAQ"}</DialogTitle>
            <DialogDescription>
              {editingFaq ? "Update the FAQ details below" : "Add a new frequently asked question"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 py-4 overflow-y-auto pr-2">
              {/* Left Column - Form Fields */}
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="question">Question</Label>
                  <Input
                    id="question"
                    placeholder="e.g., What is the fee structure for [Your Product/Service]?"
                    value={formData.question}
                    onChange={(e) => handleFormChange('question', e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Tip: Include your product/service name for better AI matching
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="answer">Answer</Label>
                  <Textarea
                    id="answer"
                    placeholder="Enter a comprehensive answer..."
                    value={formData.answer}
                    onChange={(e) => handleFormChange('answer', e.target.value)}
                    required
                    className="min-h-[180px] resize-none"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="category">Category (Optional)</Label>
                  <Input
                    id="category"
                    placeholder="e.g., Pricing, Eligibility, Technical"
                    value={formData.category}
                    onChange={(e) => handleFormChange('category', e.target.value)}
                  />
                </div>
              </div>

              {/* Right Column - Quality Analysis Panel */}
              <div className="space-y-4">
                <div className="rounded-lg border bg-gradient-to-br from-purple-50/50 to-blue-50/50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-5 w-5 text-purple-600" />
                    <h3 className="font-semibold text-gray-900">AI Quality Coach</h3>
                  </div>

                  {!qualityAnalysis && !isAnalyzing && (
                    <div className="text-center py-6">
                      <Lightbulb className="h-8 w-8 mx-auto mb-3 text-purple-400" />
                      <p className="text-sm text-muted-foreground mb-4">Get AI-powered feedback to improve your FAQ quality</p>
                      <Button
                        type="button"
                        onClick={analyzeQuality}
                        disabled={!formData.question.trim() && !formData.answer.trim()}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        Check Quality
                      </Button>
                    </div>
                  )}
                  
                  {isAnalyzing && (
                    <div className="text-center py-8">
                      <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin text-purple-600" />
                      <p className="text-sm text-muted-foreground">Analyzing your FAQ...</p>
                    </div>
                  )}

                  {qualityAnalysis && (
                    <div className="space-y-4">
                      {/* Overall Score */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Quality Score</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-2xl font-bold ${getScoreColor(qualityAnalysis.score)}`}>
                            {qualityAnalysis.score}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            qualityAnalysis.score >= 80 ? 'bg-green-100 text-green-700' :
                            qualityAnalysis.score >= 60 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {getScoreLabel(qualityAnalysis.score)}
                          </span>
                        </div>
                      </div>

                      {/* Score Breakdown */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Specificity</span>
                          <span className={getScoreColor(qualityAnalysis.specificity)}>{qualityAnalysis.specificity}%</span>
                        </div>
                        <Progress value={qualityAnalysis.specificity} className="h-1.5" />
                        
                        <div className="flex items-center justify-between text-xs mt-2">
                          <span className="text-muted-foreground">Searchability</span>
                          <span className={getScoreColor(qualityAnalysis.searchability)}>{qualityAnalysis.searchability}%</span>
                        </div>
                        <Progress value={qualityAnalysis.searchability} className="h-1.5" />
                        
                        <div className="flex items-center justify-between text-xs mt-2">
                          <span className="text-muted-foreground">Completeness</span>
                          <span className={getScoreColor(qualityAnalysis.completeness)}>{qualityAnalysis.completeness}%</span>
                        </div>
                        <Progress value={qualityAnalysis.completeness} className="h-1.5" />
                      </div>

                      {/* Duplicate Warning */}
                      {qualityAnalysis.duplicateWarning && (
                        <div className="flex items-start gap-2 p-2 rounded-md bg-yellow-50 border border-yellow-200">
                          <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-yellow-800">{qualityAnalysis.duplicateWarning}</p>
                        </div>
                      )}

                      {/* Issues */}
                      {qualityAnalysis.issues && qualityAnalysis.issues.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> Issues Found
                          </p>
                          {qualityAnalysis.issues.map((issue, i) => (
                            <p key={i} className="text-xs text-red-600 pl-4">{"\u2022"} {issue}</p>
                          ))}
                        </div>
                      )}

                      {/* Suggestions */}
                      {qualityAnalysis.suggestions && qualityAnalysis.suggestions.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <TrendingUp className="h-3 w-3" /> Suggestions
                          </p>
                          {qualityAnalysis.suggestions.map((suggestion, i) => (
                            <p key={i} className="text-xs text-green-700 pl-4">{"\u2022"} {suggestion}</p>
                          ))}
                        </div>
                      )}

                      {/* Improved Question */}
                      {qualityAnalysis.improvedQuestion && qualityAnalysis.improvedQuestion !== formData.question && (
                        <div className="p-3 rounded-md bg-purple-50 border border-purple-200">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-medium text-purple-700">Suggested Question</p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={applyImprovedQuestion}
                              className="h-6 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-100"
                            >
                              <Copy className="h-3 w-3 mr-1" /> Apply
                            </Button>
                          </div>
                          <p className="text-xs text-purple-900">{qualityAnalysis.improvedQuestion}</p>
                        </div>
                      )}

                      {/* Improved Answer */}
                      {qualityAnalysis.improvedAnswer && (
                        <div className="p-3 rounded-md bg-blue-50 border border-blue-200">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-medium text-blue-700">Suggested Answer</p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={applyImprovedAnswer}
                              className="h-6 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-100"
                            >
                              <Copy className="h-3 w-3 mr-1" /> Apply
                            </Button>
                          </div>
                          <p className="text-xs text-blue-900 line-clamp-3">{qualityAnalysis.improvedAnswer}</p>
                        </div>
                      )}

                      {qualityAnalysis.score >= 80 && (
                        <div className="flex items-center gap-2 p-2 rounded-md bg-green-50 border border-green-200">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <p className="text-xs text-green-800">This FAQ is well-structured for AI retrieval!</p>
                        </div>
                      )}
                      
                      {/* Re-check Button */}
                      <div className="pt-2 border-t">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={analyzeQuality}
                          disabled={isAnalyzing}
                          className="w-full text-purple-600 border-purple-200 hover:bg-purple-50"
                        >
                          <Sparkles className="h-4 w-4 mr-2" />
                          Re-check Quality
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editingFaq ? "Update FAQ" : "Create FAQ"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View FAQ Dialog */}
      <Dialog open={viewFaqDialogOpen} onOpenChange={setViewFaqDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>FAQ Details</DialogTitle>
          </DialogHeader>
          {viewingFaq && (
            <div className="space-y-4 py-4 overflow-y-auto pr-2 flex-1 min-h-0">
              <div>
                <Label className="text-sm font-medium text-gray-500">Question</Label>
                <p className="mt-1 text-gray-900">{viewingFaq.question}</p>
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-500">Answer</Label>
                <p className="mt-1 text-gray-900 whitespace-pre-wrap">{viewingFaq.answer.replace(/\\n/g, '\n')}</p>
              </div>
              <div className="flex gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-500">Category</Label>
                  <p className="mt-1">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                      {viewingFaq.category || "General"}
                    </span>
                  </p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">Created</Label>
                  <p className="mt-1 text-gray-900 text-sm">{new Date(viewingFaq.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewFaqDialogOpen(false)}>
              Close
            </Button>
            {viewingFaq && (
              <Button onClick={() => { setViewFaqDialogOpen(false); openEditDialog(viewingFaq); }}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete FAQ</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this FAQ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </div>
  );
}