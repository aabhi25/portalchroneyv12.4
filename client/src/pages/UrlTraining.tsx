import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import TrainingNavTabs from "@/components/TrainingNavTabs";
import {
  Link2,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  ExternalLink,
  Globe,
  FileText,
  Sparkles,
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { format } from "date-fns";
import { Label } from "@/components/ui/label";

interface TrainedUrl {
  id: string;
  businessAccountId: string;
  url: string;
  title?: string | null;
  description?: string | null;
  extractedText?: string | null;
  summary?: string | null;
  keyPoints?: string | null;
  status: 'pending' | 'crawling' | 'processing' | 'completed' | 'failed';
  embeddingStatus?: string | null;
  embeddedChunkCount?: string | null;
  errorMessage?: string | null;
  addedBy: string;
  crawledAt?: string | null;
  processedAt?: string | null;
  embeddedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function UrlTraining() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [urlToDelete, setUrlToDelete] = useState<string | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<TrainedUrl | null>(null);

  const { data: trainedUrls = [], isLoading } = useQuery<TrainedUrl[]>({
    queryKey: ["/api/trained-urls"],
    refetchInterval: (query) => {
      const urls = query.state.data || [];
      const hasProcessing = urls.some((u: TrainedUrl) => 
        u.status === 'pending' || u.status === 'crawling' || u.status === 'processing' ||
        u.embeddingStatus === 'processing'
      );
      return hasProcessing ? 3000 : false;
    },
  });

  const stats = {
    total: trainedUrls.length,
    completed: trainedUrls.filter(u => u.status === 'completed' && u.embeddingStatus === 'completed').length,
    processing: trainedUrls.filter(u => 
      u.status === 'pending' || u.status === 'crawling' || u.status === 'processing' ||
      u.embeddingStatus === 'processing'
    ).length,
    failed: trainedUrls.filter(u => u.status === 'failed' || u.embeddingStatus === 'failed').length,
  };

  const addUrlMutation = useMutation({
    mutationFn: async (data: { url: string; description?: string }) => {
      const response = await fetch("/api/trained-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to add URL");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trained-urls"] });
      setUrl("");
      setDescription("");
      setIsAddingUrl(false);
      toast({
        title: "URL Added",
        description: "The URL is being crawled and processed for training.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/trained-urls/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete URL");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trained-urls"] });
      setDeleteDialogOpen(false);
      setUrlToDelete(null);
      toast({
        title: "URL Deleted",
        description: "Training URL removed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/trained-urls/${id}/reprocess`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to reprocess URL");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trained-urls"] });
      toast({
        title: "Reprocessing Started",
        description: "The URL is being crawled and processed again.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddUrl = () => {
    if (!url.trim()) {
      toast({
        title: "Error",
        description: "Please enter a URL",
        variant: "destructive",
      });
      return;
    }

    try {
      new URL(url);
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid URL (e.g., https://example.com/page)",
        variant: "destructive",
      });
      return;
    }

    addUrlMutation.mutate({ url, description: description || undefined });
  };

  const getStatusBadge = (trainedUrl: TrainedUrl) => {
    if (trainedUrl.status === 'failed') {
      return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
    }
    if (trainedUrl.status === 'pending' || trainedUrl.status === 'crawling') {
      return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1 animate-pulse" />Crawling</Badge>;
    }
    if (trainedUrl.status === 'processing') {
      return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Processing</Badge>;
    }
    if (trainedUrl.embeddingStatus === 'processing') {
      return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Embedding</Badge>;
    }
    if (trainedUrl.embeddingStatus === 'failed') {
      return <Badge variant="outline" className="text-amber-600"><XCircle className="w-3 h-3 mr-1" />Embed Failed</Badge>;
    }
    if (trainedUrl.status === 'completed' && trainedUrl.embeddingStatus === 'completed') {
      return <Badge variant="default" className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />Ready</Badge>;
    }
    return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
  };

  const formatUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
    } catch {
      return url;
    }
  };

  return (
    <div>
      <TrainingNavTabs />
      <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
            <Globe className="w-8 h-8" />
            URL Training
          </h1>
          <p className="text-muted-foreground mt-1">
            Train your AI with content from external web pages
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total URLs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ready</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Processing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.processing}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add URL for Training
          </CardTitle>
          <CardDescription>
            Enter a URL to crawl and extract content for AI training. The content will be processed and stored for RAG-based responses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                type="url"
                placeholder="https://example.com/page"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={addUrlMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                placeholder="Brief description of what this page contains..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={addUrlMutation.isPending}
                rows={2}
              />
            </div>
            <Button 
              onClick={handleAddUrl} 
              disabled={addUrlMutation.isPending || !url.trim()}
            >
              {addUrlMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Add URL
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Trained URLs ({trainedUrls.length})
          </CardTitle>
          <CardDescription>
            URLs that have been crawled and processed for AI training
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : trainedUrls.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Globe className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No URLs added yet</p>
              <p className="text-sm">Add a URL above to start training your AI</p>
            </div>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {trainedUrls.map((trainedUrl) => (
                <AccordionItem key={trainedUrl.id} value={trainedUrl.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 flex-1 text-left">
                      <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {trainedUrl.title || formatUrl(trainedUrl.url)}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {trainedUrl.url}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {getStatusBadge(trainedUrl)}
                        {trainedUrl.embeddedChunkCount && parseInt(trainedUrl.embeddedChunkCount) > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {trainedUrl.embeddedChunkCount} chunks
                          </Badge>
                        )}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="pt-4 space-y-4">
                      {trainedUrl.errorMessage && (
                        <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                          <strong>Error:</strong> {trainedUrl.errorMessage}
                        </div>
                      )}

                      {trainedUrl.summary && (
                        <div>
                          <h4 className="font-medium mb-2 flex items-center gap-2">
                            <Sparkles className="w-4 h-4" />
                            AI Summary
                          </h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {trainedUrl.summary}
                          </p>
                        </div>
                      )}

                      {trainedUrl.keyPoints && (
                        <div>
                          <h4 className="font-medium mb-2 flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            Key Points
                          </h4>
                          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                            {(() => {
                              try {
                                const points = JSON.parse(trainedUrl.keyPoints);
                                return Array.isArray(points) ? points.map((point: string, i: number) => (
                                  <li key={i}>{point}</li>
                                )) : null;
                              } catch {
                                return <li>{trainedUrl.keyPoints}</li>;
                              }
                            })()}
                          </ul>
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-2 border-t">
                        <a
                          href={trainedUrl.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open URL
                        </a>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">
                          Added {format(new Date(trainedUrl.createdAt), "MMM d, yyyy")}
                        </span>
                        <div className="flex-1" />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reprocessMutation.mutate(trainedUrl.id)}
                          disabled={reprocessMutation.isPending || trainedUrl.status === 'processing' || trainedUrl.status === 'crawling'}
                        >
                          <RefreshCw className="w-4 h-4 mr-1" />
                          Reprocess
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setUrlToDelete(trainedUrl.id);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Trained URL?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this URL and all its training data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setUrlToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => urlToDelete && deleteMutation.mutate(urlToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </div>
  );
}
