import MoreFeaturesNavTabs from "@/components/MoreFeaturesNavTabs";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ClipboardList, Search, Filter, Calendar, AlertCircle, CheckCircle2, Eye, MessageSquare, Trash2, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLocation } from "wouter";

interface QuestionBankEntry {
  id: string;
  businessAccountId: string;
  conversationId: string | null;
  messageId: string | null;
  question: string;
  aiResponse: string | null;
  userContext: string | null;
  status: string;
  category: string | null;
  confidenceScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export default function QuestionBank() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Reset to page 1 when filters or search change
  const handleFilterChange = (filterType: 'status' | 'category' | 'search', value: string) => {
    setCurrentPage(1);
    if (filterType === 'status') setStatusFilter(value);
    else if (filterType === 'category') setCategoryFilter(value);
    else if (filterType === 'search') setSearchQuery(value);
  };

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.append('status', statusFilter);
    if (categoryFilter !== 'all') params.append('category', categoryFilter);
    if (searchQuery) params.append('search', searchQuery);
    params.append('page', currentPage.toString());
    params.append('limit', itemsPerPage.toString());
    return params.toString() ? `?${params.toString()}` : '';
  };

  const { data } = useQuery<{ entries: QuestionBankEntry[]; total: number }>({
    queryKey: ["/api/question-bank", statusFilter, categoryFilter, searchQuery, currentPage],
    queryFn: async () => {
      const response = await fetch(`/api/question-bank${buildQueryParams()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch question bank entries");
      }
      return response.json();
    },
  });

  const entries = data?.entries || [];
  const totalPages = Math.ceil((data?.total || 0) / itemsPerPage);
  const selectedEntry = entries.find(e => e.id === selectedEntryId);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return await apiRequest("PATCH", `/api/question-bank/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/question-bank"] });
      toast({
        title: "Status updated",
        description: "Entry status has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/question-bank/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/question-bank"] });
      setDeleteDialogOpen(false);
      setEntryToDelete(null);
      setSelectedEntryId(null);
      toast({
        title: "Entry deleted",
        description: "Question bank entry has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete entry",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (id: string) => {
    setEntryToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (entryToDelete) {
      deleteMutation.mutate(entryToDelete);
    }
  };

  const handleViewConversation = (conversationId: string) => {
    setLocation(`/conversations?id=${conversationId}`);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
      return `Today at ${format(date, 'h:mm a')}`;
    } else if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${format(date, 'h:mm a')}`;
    } else {
      return format(date, 'MMM d, yyyy h:mm a');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new':
        return <Badge variant="default" className="bg-blue-500">New</Badge>;
      case 'reviewing':
        return <Badge variant="default" className="bg-yellow-500">Reviewing</Badge>;
      case 'resolved':
        return <Badge variant="default" className="bg-green-500">Resolved</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'new':
        return <AlertCircle className="w-4 h-4 text-blue-500" />;
      case 'reviewing':
        return <Eye className="w-4 h-4 text-yellow-500" />;
      case 'resolved':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      default:
        return <ClipboardList className="w-4 h-4" />;
    }
  };

  const uniqueCategories = Array.from(new Set(entries.map(e => e.category).filter(Boolean)));

  return (
    <div className="flex flex-col h-full w-full bg-gray-50">
      <MoreFeaturesNavTabs />
      <div className="flex flex-1 min-h-0">
      {/* Left Panel - Question Bank Entries List */}
      <div className="w-full md:w-96 border-r border-gray-200 bg-white flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900">AI Knowledge Gaps</h2>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-gray-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">
                      This feature automatically captures questions that Chroney couldn't answer confidently. 
                      Review these questions to improve your chatbot by adding relevant FAQs or training data.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          
          {/* Search Bar */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search questions..."
              value={searchQuery}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Filters */}
          <div className="space-y-2">
            <Select value={statusFilter} onValueChange={(value) => handleFilterChange('status', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="reviewing">Reviewing</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>

            <Select value={categoryFilter} onValueChange={(value) => handleFilterChange('category', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {uniqueCategories.map(cat => (
                  <SelectItem key={cat} value={cat!}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Entries List */}
        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
              <ClipboardList className="w-12 h-12 mb-3 text-gray-400" />
              <p className="text-sm text-center">No unanswered questions yet</p>
              <p className="text-xs text-center text-gray-400 mt-1">
                Questions that Chroney can't answer will appear here
              </p>
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                onClick={() => setSelectedEntryId(entry.id)}
                className={`p-4 border-b border-gray-100 cursor-pointer transition-colors ${
                  selectedEntryId === entry.id
                    ? 'bg-blue-50 border-l-4 border-l-blue-500'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(entry.status)}
                    {getStatusBadge(entry.status)}
                  </div>
                  <span className="text-xs text-gray-500">
                    {formatDate(entry.createdAt)}
                  </span>
                </div>
                
                <p className="text-sm font-medium text-gray-900 line-clamp-2 mb-2">
                  {entry.question}
                </p>

                {entry.category && (
                  <Badge variant="outline" className="text-xs">
                    {entry.category}
                  </Badge>
                )}

                {entry.confidenceScore !== null && (
                  <div className="mt-2 text-xs text-gray-500">
                    Confidence: {Math.round(entry.confidenceScore * 100)}%
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-gray-200 bg-white">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Page {currentPage} of {totalPages} ({data?.total || 0} total)
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Entry Details */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {selectedEntry ? (
          <>
            {/* Details Header */}
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    {getStatusBadge(selectedEntry.status)}
                    {selectedEntry.category && (
                      <Badge variant="outline">{selectedEntry.category}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    Created {formatDate(selectedEntry.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedEntry.conversationId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewConversation(selectedEntry.conversationId!)}
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      View Conversation
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(selectedEntry.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Status Update */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">Status:</span>
                <Select
                  value={selectedEntry.status}
                  onValueChange={(value) => updateStatusMutation.mutate({ id: selectedEntry.id, status: value })}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="reviewing">Reviewing</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Details Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <Card>
                <CardContent className="pt-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Question</h3>
                  <p className="text-gray-900">{selectedEntry.question}</p>
                </CardContent>
              </Card>

              {selectedEntry.aiResponse && (
                <Card>
                  <CardContent className="pt-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">AI Response</h3>
                    <p className="text-gray-700">{selectedEntry.aiResponse}</p>
                  </CardContent>
                </Card>
              )}

              {selectedEntry.userContext && (
                <Card>
                  <CardContent className="pt-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">User Context</h3>
                    <p className="text-gray-600 text-sm">{selectedEntry.userContext}</p>
                  </CardContent>
                </Card>
              )}

              {selectedEntry.confidenceScore !== null && (
                <Card>
                  <CardContent className="pt-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Confidence Score</h3>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            selectedEntry.confidenceScore >= 0.7
                              ? 'bg-green-500'
                              : selectedEntry.confidenceScore >= 0.4
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                          }`}
                          style={{ width: `${selectedEntry.confidenceScore * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-gray-700">
                        {Math.round(selectedEntry.confidenceScore * 100)}%
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <ClipboardList className="w-16 h-16 mx-auto mb-3 text-gray-400" />
              <p>Select an entry to view details</p>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Question Bank Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this entry? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </div>
  );
}
