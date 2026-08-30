import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Calendar, Clock, Search, User, Bot, Trash2, ChevronLeft, ChevronRight, ImageIcon, MapPin, SlidersHorizontal, ChevronDown, Sparkles, Loader2, UserCheck, FileText, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { useState, useMemo, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { convertLatexDelimiters } from '@/lib/convertLatexDelimiters';
import 'highlight.js/styles/github-dark.css';
import { useLocation } from "wouter";
import WebsiteNavTabs from "@/components/WebsiteNavTabs";
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

interface Conversation {
  id: string;
  businessAccountId: string;
  title: string;
  visitorCity: string | null;
  summary: string | null;
  topicKeywords: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  hasLead?: boolean;
  leadBadge?: string | null;
  viaJourney?: boolean;
  viaForm?: boolean;
}

interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
  imageUrl?: string | null;
  metadata?: string | null; // JSON string stored in database
  interactionSource?: string | null; // 'chat' | 'form' | 'journey'
}

interface ParsedMetadata {
  productIds?: string[];
}

// Helper to safely parse message metadata
function parseMessageMetadata(metadata: string | null | undefined): ParsedMetadata | null {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as ParsedMetadata;
  } catch {
    return null;
  }
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
}

type DatePreset = 'all' | 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

export default function Conversations() {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<'all' | 'chat' | 'journey' | 'form'>('all');
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const itemsPerPage = 20;
  const prevFiltersRef = useRef({ datePreset, fromDate, toDate, searchQuery });

  // Auto-select conversation from URL query parameter on mount
  useEffect(() => {
    // Small delay to ensure URL is fully loaded after navigation
    const timer = setTimeout(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const conversationId = searchParams.get('id');
      
      if (conversationId) {
        setSelectedConversationId(conversationId);
        // Clear the query parameter from URL after selection
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [location]); // Re-run when wouter location changes

  // Memoize date params to prevent unnecessary refetches
  const dateParams = useMemo(() => {
    const params = new URLSearchParams();
    
    let from: Date | undefined;
    let to: Date | undefined;
    
    // Get current date normalized to start of day to prevent constant changes
    const today = startOfDay(new Date());
    
    switch (datePreset) {
      case 'all':
        // No date filters
        break;
      case 'today':
        from = today;
        to = endOfDay(today);
        break;
      case 'yesterday':
        const yesterday = subDays(today, 1);
        from = yesterday;
        to = endOfDay(yesterday);
        break;
      case 'last7':
        from = subDays(today, 7);
        to = endOfDay(today);
        break;
      case 'last30':
        from = subDays(today, 30);
        to = endOfDay(today);
        break;
      case 'custom':
        from = fromDate ? startOfDay(fromDate) : undefined;
        to = toDate ? endOfDay(toDate) : undefined;
        break;
    }
    
    if (from) params.append('fromDate', from.toISOString());
    if (to) params.append('toDate', to.toISOString());
    const trimmedSearch = searchQuery.trim();
    if (trimmedSearch) params.append('search', trimmedSearch);
    params.append('page', currentPage.toString());
    params.append('limit', itemsPerPage.toString());
    
    return params.toString() ? `?${params.toString()}` : '';
  }, [datePreset, fromDate, toDate, searchQuery, currentPage]);

  const { data } = useQuery<{ conversations: Conversation[]; total: number }>({
    queryKey: ["/api/conversations", dateParams],
    queryFn: async () => {
      const response = await fetch(`/api/conversations${dateParams}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch conversations");
      }
      return response.json();
    },
  });

  const conversations = data?.conversations || [];
  const filteredConversations = conversations.filter(c => {
    if (typeFilter === 'journey') return c.viaJourney;
    if (typeFilter === 'form') return c.viaForm;
    if (typeFilter === 'chat') return !c.viaJourney && !c.viaForm;
    return true;
  });
  const totalPages = Math.ceil((data?.total || 0) / itemsPerPage);

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["/api/conversations", selectedConversationId, "messages"],
    enabled: !!selectedConversationId,
    queryFn: async () => {
      const response = await fetch(`/api/conversations/${selectedConversationId}/messages`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch messages");
      }
      return response.json();
    },
  });

  // Extract all unique product IDs from messages for batch fetching
  const productIdsToFetch = useMemo(() => {
    const ids = new Set<string>();
    messages.forEach((message) => {
      const parsed = parseMessageMetadata(message.metadata);
      if (parsed?.productIds) {
        parsed.productIds.forEach((id) => ids.add(id));
      }
    });
    return Array.from(ids);
  }, [messages]);

  // Fetch products by IDs when messages have product metadata
  const { data: productsData } = useQuery<{ products: Product[] }>({
    queryKey: ["/api/products/batch", productIdsToFetch],
    enabled: productIdsToFetch.length > 0,
    queryFn: async () => {
      const response = await fetch('/api/products/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ productIds: productIdsToFetch }),
      });
      if (!response.ok) {
        throw new Error("Failed to fetch products");
      }
      return response.json();
    },
  });

  // Create a map of products by ID for quick lookup
  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    productsData?.products?.forEach((product) => {
      map.set(product.id, product);
    });
    return map;
  }, [productsData]);

  const deleteConversationMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to delete conversation');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      if (conversationToDelete?.id === selectedConversationId) {
        setSelectedConversationId(null);
      }
      setConversationToDelete(null);
      setDeleteDialogOpen(false);
    },
  });

  const bulkSummarizeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/conversations/bulk-summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ limit: 50 }),
      });
      if (!response.ok) throw new Error('Failed to generate summaries');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

  const handleDeleteClick = (e: React.MouseEvent, conversation: Conversation) => {
    e.stopPropagation();
    setConversationToDelete(conversation);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (conversationToDelete) {
      deleteConversationMutation.mutate(conversationToDelete.id);
    }
  };

  // Reset to page 1 only when filters actually change (not on background refetches)
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const hasChanged = 
      prev.datePreset !== datePreset ||
      prev.fromDate !== fromDate ||
      prev.toDate !== toDate ||
      prev.searchQuery !== searchQuery;
    
    if (hasChanged) {
      setCurrentPage(1);
      prevFiltersRef.current = { datePreset, fromDate, toDate, searchQuery };
    }
  }, [datePreset, fromDate, toDate, searchQuery]);

  // Clamp currentPage to totalPages when results change, reset to page 1 if no results
  // Only run after data is loaded to avoid resetting during query transitions
  useEffect(() => {
    if (data === undefined) return; // Wait for data to load
    
    if (totalPages === 0 && currentPage !== 1) {
      setCurrentPage(1);
    } else if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [data, totalPages, currentPage]);

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);

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

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return format(date, 'MMM d, h:mm a');
  };

  return (
    <div className="flex flex-col h-full w-full bg-gray-50 min-h-0 overflow-hidden">
      <WebsiteNavTabs />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left Panel - Conversations List */}
      <div className="w-full md:w-96 border-r border-gray-200 bg-white flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Date Filter */}
        <div className="border-b border-gray-200">
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-gray-600 uppercase tracking-wider hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filter by Date</span>
              {datePreset !== 'all' && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-purple-100 text-purple-700 normal-case">
                  {datePreset === 'today' ? 'Today' : datePreset === 'yesterday' ? 'Yesterday' : datePreset === 'last7' ? '7d' : datePreset === 'last30' ? '30d' : 'Custom'}
                </span>
              )}
            </div>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${filterOpen ? 'rotate-180' : ''}`} />
          </button>
          {filterOpen && (
            <div className="px-4 pb-4 bg-gradient-to-br from-gray-50 to-white">
              <div className="mb-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDatePreset('all')}
                    className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                      datePreset === 'all'
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                        : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                    }`}
                  >
                    All Time
                  </button>
                  <button
                    onClick={() => setDatePreset('today')}
                    className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                      datePreset === 'today'
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                        : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                    }`}
                  >
                    Today
                  </button>
                  <button
                    onClick={() => setDatePreset('yesterday')}
                    className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                      datePreset === 'yesterday'
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                        : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                    }`}
                  >
                    Yesterday
                  </button>
                  <button
                    onClick={() => setDatePreset('last7')}
                    className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                      datePreset === 'last7'
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                        : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                    }`}
                  >
                    Last 7 Days
                  </button>
                </div>
              </div>

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={`w-full px-3 py-2.5 text-xs font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 ${
                      datePreset === 'custom'
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-200'
                        : 'bg-white text-gray-700 border border-gray-200 hover:border-purple-300 hover:shadow-sm'
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>
                      {datePreset === 'custom' && (fromDate || toDate)
                        ? `${fromDate ? format(fromDate, 'MMM d') : '...'} - ${toDate ? format(toDate, 'MMM d') : '...'}`
                        : 'Custom Range'}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <div className="bg-gradient-to-br from-gray-50 to-white p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">Custom Date Range</h4>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {fromDate && toDate
                            ? `${format(fromDate, 'MMM d, yyyy')} — ${format(toDate, 'MMM d, yyyy')}`
                            : fromDate
                            ? `${format(fromDate, 'MMM d, yyyy')} — Select end date`
                            : 'Select start and end dates'}
                        </p>
                      </div>
                      {(fromDate || toDate) && (
                        <button
                          onClick={() => {
                            setFromDate(undefined);
                            setToDate(undefined);
                            setDatePreset('all');
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <CalendarComponent
                      mode="range"
                      selected={{ from: fromDate, to: toDate } as DateRange}
                      onSelect={(range: DateRange | undefined) => {
                        setFromDate(range?.from);
                        setToDate(range?.to);
                        if (range?.from || range?.to) {
                          setDatePreset('custom');
                        }
                      }}
                      numberOfMonths={2}
                      disabled={(date) => date > new Date()}
                      className="rounded-md bg-white border border-gray-200"
                    />
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>

        {/* Type Filter Chips */}
        <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2 flex-wrap">
          {([
            { key: 'all' as const, label: 'All', icon: null },
            { key: 'chat' as const, label: 'Chat', icon: <MessageSquare className="w-3 h-3" /> },
            { key: 'journey' as const, label: 'Journey', icon: <GitBranch className="w-3 h-3" /> },
            { key: 'form' as const, label: 'Forms', icon: <FileText className="w-3 h-3" /> },
          ]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                typeFilter === key
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
              <MessageSquare className="w-12 h-12 text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">
                {typeFilter !== 'all' ? `No ${typeFilter} conversations` : searchQuery ? 'No conversations found' : 'No conversations yet'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  onClick={() => { setSelectedConversationId(conversation.id); setSummaryExpanded(false); }}
                  className={`p-4 cursor-pointer transition-colors group ${
                    selectedConversationId === conversation.id
                      ? 'bg-blue-50 border-l-4 border-blue-500'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      conversation.viaJourney
                        ? 'bg-gradient-to-br from-violet-500 to-purple-600'
                        : conversation.viaForm
                          ? 'bg-gradient-to-br from-green-500 to-emerald-600'
                          : 'bg-gradient-to-br from-purple-500 to-blue-600'
                    }`}>
                      {conversation.viaJourney
                        ? <GitBranch className="w-5 h-5 text-white" />
                        : conversation.viaForm
                          ? <FileText className="w-5 h-5 text-white" />
                          : <MessageSquare className="w-5 h-5 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <h3 className="font-semibold text-sm text-gray-900 truncate">
                          {conversation.title}
                        </h3>
                        <button
                          onClick={(e) => handleDeleteClick(e, conversation)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all flex-shrink-0"
                          title="Delete conversation"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span className="truncate">{formatDate(conversation.createdAt)}</span>
                        <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">
                          {conversation.messageCount}
                        </span>
                      </div>
                      {(conversation.viaJourney || conversation.viaForm || conversation.hasLead || conversation.visitorCity) && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {conversation.viaJourney && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-violet-50 text-violet-600 border border-violet-200" title="Via Journey">
                              <GitBranch className="w-2.5 h-2.5" />
                              Journey
                            </span>
                          )}
                          {conversation.viaForm && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-600 border border-emerald-200" title="Via Form">
                              <FileText className="w-2.5 h-2.5" />
                              Form
                            </span>
                          )}
                          {conversation.hasLead && (
                            <span
                              className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${
                                conversation.leadBadge === 'Discount Availed' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-green-50 text-green-600 border-green-200'
                              }`}
                              title={conversation.leadBadge === 'Discount Availed' ? 'Discount Availed' : 'Lead Captured'}
                            >
                              <span className="font-bold">L</span>
                              {conversation.leadBadge === 'Discount Availed' ? 'Discount' : 'Lead'}
                            </span>
                          )}
                          {conversation.visitorCity && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-full border border-gray-200">
                              <MapPin className="w-2.5 h-2.5" />
                              {conversation.visitorCity}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="mt-auto border-t border-gray-200 p-4 bg-white">
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>
                <span className="text-sm text-gray-600 font-medium">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="flex items-center gap-1"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Message View */}
      <div className="flex-1 flex flex-col bg-gray-50 min-h-0 overflow-hidden">
        {selectedConversation ? (
          <>
            {/* Conversation Header */}
            <div className="bg-white border-b border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    selectedConversation.viaJourney
                      ? 'bg-gradient-to-br from-violet-500 to-purple-600'
                      : selectedConversation.viaForm
                        ? 'bg-gradient-to-br from-green-500 to-emerald-600'
                        : 'bg-gradient-to-br from-purple-500 to-blue-600'
                  }`}>
                    {selectedConversation.viaJourney
                      ? <GitBranch className="w-5 h-5 text-white" />
                      : selectedConversation.viaForm
                        ? <FileText className="w-5 h-5 text-white" />
                        : <MessageSquare className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">{selectedConversation.title}</h2>
                    <p className="text-xs text-gray-500">{formatDate(selectedConversation.createdAt)}</p>
                    {(selectedConversation.viaJourney || selectedConversation.viaForm || selectedConversation.hasLead || selectedConversation.visitorCity) && (
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {selectedConversation.viaJourney && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium bg-violet-50 text-violet-600 border border-violet-200">
                            <GitBranch className="w-3 h-3" />
                            Journey
                          </span>
                        )}
                        {selectedConversation.viaForm && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">
                            <FileText className="w-3 h-3" />
                            Form
                          </span>
                        )}
                        {selectedConversation.hasLead && (
                          <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium border ${
                            selectedConversation.leadBadge === 'Discount Availed'
                              ? 'bg-orange-50 text-orange-600 border-orange-200'
                              : 'bg-green-50 text-green-600 border-green-200'
                          }`}>
                            <span className="font-bold text-[10px]">L</span>
                            {selectedConversation.leadBadge === 'Discount Availed' ? 'Discount' : 'Lead'}
                          </span>
                        )}
                        {selectedConversation.visitorCity && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200">
                            <MapPin className="w-3 h-3" />
                            {selectedConversation.visitorCity}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {selectedConversation.summary && (
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-b border-purple-100 px-4 py-3">
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm text-gray-700 leading-relaxed ${!summaryExpanded ? 'line-clamp-2' : ''}`}>{selectedConversation.summary}</p>
                    <button
                      onClick={() => setSummaryExpanded(!summaryExpanded)}
                      className="text-xs text-purple-600 hover:text-purple-800 font-medium mt-1"
                    >
                      {summaryExpanded ? 'View Less' : 'View More'}
                    </button>
                    {selectedConversation.topicKeywords && (() => {
                      try {
                        const keywords = JSON.parse(selectedConversation.topicKeywords);
                        if (Array.isArray(keywords) && keywords.length > 0) {
                          return (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {keywords.map((kw: string, i: number) => (
                                <span key={i} className="px-2 py-0.5 text-xs font-medium rounded-full bg-white text-purple-700 border border-purple-200">
                                  {kw}
                                </span>
                              ))}
                            </div>
                          );
                        }
                        return null;
                      } catch { return null; }
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
              {messages.map((message, index) => {
                const prevSource = index > 0 ? (messages[index - 1].interactionSource || 'chat') : null;
                const currentSource = message.interactionSource || 'chat';
                const sourceChanged = prevSource !== null && prevSource !== currentSource;
                const sourceLabel = currentSource === 'form' ? 'Form Submission' : currentSource === 'journey' ? 'Journey' : 'Chat';
                const sourceColor = currentSource === 'form' ? 'text-green-600 border-green-200 bg-green-50' : currentSource === 'journey' ? 'text-blue-600 border-blue-200 bg-blue-50' : 'text-purple-600 border-purple-200 bg-purple-50';
                const sourceIcon = currentSource === 'form' ? <FileText className="w-3 h-3" /> : currentSource === 'journey' ? <GitBranch className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />;
                return (
                <div key={message.id}>
                {(sourceChanged || (index === 0 && currentSource !== 'chat')) && (
                  <div className="flex items-center gap-2 my-3">
                    <div className="flex-1 border-t border-gray-200" />
                    <span className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-full border ${sourceColor}`}>
                      {sourceIcon}
                      {sourceLabel}
                    </span>
                    <div className="flex-1 border-t border-gray-200" />
                  </div>
                )}
                <div
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'assistant' && (
                    <div className="flex items-start gap-3 max-w-[85%]">
                      <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <Bot className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Card className="bg-white shadow-sm">
                          <CardContent className="p-4">
                            <div className="prose prose-sm max-w-none">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeHighlight, rehypeKatex]}
                                components={{
                                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                  ul: ({ children }) => <ul className="mb-2 pl-4 list-disc">{children}</ul>,
                                  ol: ({ children }) => <ol className="mb-2 pl-4 list-decimal">{children}</ol>,
                                  li: ({ children }) => <li className="mb-1">{children}</li>,
                                  code: ({ className, children }) => {
                                    const isInline = !className;
                                    return isInline ? (
                                      <code className="px-1.5 py-0.5 bg-gray-100 rounded text-sm">{children}</code>
                                    ) : (
                                      <code className={className}>{children}</code>
                                    );
                                  }
                                }}
                              >
                                {convertLatexDelimiters(message.content)}
                              </ReactMarkdown>
                            </div>
                          </CardContent>
                        </Card>
                        
                        {/* Product cards for messages with product metadata */}
                        {(() => {
                          const parsedMeta = parseMessageMetadata(message.metadata);
                          if (!parsedMeta?.productIds || parsedMeta.productIds.length === 0) return null;
                          return (
                            <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
                              {parsedMeta.productIds.map((productId) => {
                                const product = productsById.get(productId);
                                if (!product) return null;
                                return (
                                  <div 
                                    key={productId}
                                    className="flex-shrink-0 w-36 bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden"
                                  >
                                    {product.imageUrl ? (
                                      <img 
                                        src={product.imageUrl} 
                                        alt={product.name}
                                        className="w-full h-24 object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-24 bg-gray-100 flex items-center justify-center">
                                        <ImageIcon className="w-8 h-8 text-gray-300" />
                                      </div>
                                    )}
                                    <div className="p-2">
                                      <p className="text-xs font-medium text-gray-900 line-clamp-2">{product.name}</p>
                                      {product.price !== null && (
                                        <p className="text-xs text-purple-600 font-semibold mt-1">
                                          {product.currency || '₹'}{product.price.toLocaleString()}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                        
                        <p className="text-xs text-gray-500 mt-1 ml-1">{formatTime(message.createdAt)}</p>
                      </div>
                    </div>
                  )}
                  
                  {message.role === 'user' && (
                    <div className="flex flex-col items-end max-w-[85%]">
                      <div
                        className="px-4 py-3 rounded-2xl text-white shadow-sm"
                        style={{ background: 'linear-gradient(to right, #8B5CF6, #3B82F6)' }}
                      >
                        {/* Show uploaded image in user message */}
                        {message.imageUrl && (
                          <div className="mb-2">
                            <div className="flex items-center gap-1 text-xs text-white/80 mb-1">
                              <ImageIcon className="w-3 h-3" />
                              <span>{message.content.startsWith('[IMAGE_UPLOAD]') ? 'Uploaded image' : 'Image search'}</span>
                            </div>
                            <img 
                              src={message.imageUrl} 
                              alt="User uploaded" 
                              className="w-full max-w-[200px] rounded-lg border border-white/20"
                            />
                          </div>
                        )}
                        {!message.content.startsWith('[IMAGE_UPLOAD]') && (
                          <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                        )}
                        {message.content.startsWith('[IMAGE_UPLOAD]') && !message.imageUrl && (
                          <p className="text-sm whitespace-pre-wrap break-words">{message.content.replace('[IMAGE_UPLOAD] ', '')} (image not saved)</p>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1 mr-1">{formatTime(message.createdAt)}</p>
                    </div>
                  )}
                </div>
                </div>
              );
              })}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center p-4">
            <div>
              <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select a conversation</h3>
              <p className="text-sm text-gray-500">
                Choose a conversation from the list to view messages
              </p>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Conversation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this conversation with "{conversationToDelete?.title}"? 
              This action cannot be undone and all messages will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConversationToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              disabled={deleteConversationMutation.isPending}
            >
              {deleteConversationMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
}
