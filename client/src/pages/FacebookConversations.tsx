import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { MessageCircle, ArrowLeft, Loader2, Trash2, User, Search, RefreshCw, Check } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useLocation } from "wouter";
import { format } from "date-fns";

interface ConversationSummary {
  senderId: string;
  senderName: string | null;
  messageCount: number;
  lastMessageAt: string;
  lastMessageText: string;
}

interface FacebookMessage {
  id: string;
  businessAccountId: string;
  senderId: string;
  senderName: string | null;
  messageText: string | null;
  direction: string;
  fbMessageId: string | null;
  messageType: string;
  mediaUrl: string | null;
  createdAt: string;
}

const parseUTCDate = (dateString: string | Date): Date => {
  if (dateString instanceof Date) return dateString;
  const utcString = dateString.endsWith('Z') ? dateString : dateString + 'Z';
  return new Date(utcString);
};

export default function FacebookConversations() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedSenderId, setSelectedSenderId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [], isLoading: loadingConversations } = useQuery<ConversationSummary[]>({
    queryKey: ["/api/facebook/conversations"],
    queryFn: async () => {
      return await apiRequest("GET", "/api/facebook/conversations");
    },
  });

  const { data: messages = [], isLoading: loadingMessages, refetch: refetchMessages, isRefetching: messagesRefetching } = useQuery<FacebookMessage[]>({
    queryKey: ["/api/facebook/conversations", selectedSenderId],
    queryFn: async () => {
      return await apiRequest("GET", `/api/facebook/conversations/${selectedSenderId}`);
    },
    enabled: !!selectedSenderId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (senderId: string) => {
      await apiRequest("DELETE", `/api/facebook/conversations/${senderId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/facebook/conversations"] });
      if (deleteTarget === selectedSenderId) {
        setSelectedSenderId(null);
      }
      setDeleteTarget(null);
      toast({ title: "Conversation deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const selectedConversation = conversations.find(c => c.senderId === selectedSenderId);

  const filteredConversations = conversations.filter(conv => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      (conv.senderName && conv.senderName.toLowerCase().includes(query)) ||
      conv.senderId.toLowerCase().includes(query) ||
      (conv.lastMessageText && conv.lastMessageText.toLowerCase().includes(query))
    );
  });

  useEffect(() => {
    if (messages.length > 0 && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-50 flex items-center gap-4 border-b bg-background px-4 h-14 shrink-0">
        <SidebarTrigger />
        <Button variant="ghost" size="sm" onClick={() => selectedSenderId ? setSelectedSenderId(null) : setLocation("/admin/facebook")} className="gap-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        {selectedSenderId ? (
          <>
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-blue-600" />
              <span className="font-medium">
                {selectedConversation?.senderName || selectedSenderId}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-blue-600" />
            <h1 className="text-lg font-semibold">Facebook Conversations</h1>
            <Badge variant="secondary" className="ml-2">{conversations.length}</Badge>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {!selectedSenderId ? (
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-5">
                <h2 className="text-xl font-semibold text-white">Conversations</h2>
                <p className="text-blue-100 text-sm mt-1">View message history from Facebook DMs</p>
              </div>

              <div className="px-6 py-3 border-b">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by sender name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="divide-y">
                {loadingConversations ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-2" />
                      <p className="text-gray-500 text-sm">Loading conversations...</p>
                    </div>
                  </div>
                ) : filteredConversations.length === 0 ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="text-center">
                      <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <MessageCircle className="h-10 w-10 text-gray-300" />
                      </div>
                      <p className="text-gray-600 font-medium">
                        {searchQuery ? "No matching conversations" : "No conversations yet"}
                      </p>
                      <p className="text-gray-400 text-sm mt-1">
                        {searchQuery ? "Try a different search term" : "Facebook DMs will appear here once received"}
                      </p>
                    </div>
                  </div>
                ) : (
                  filteredConversations.map((conv) => {
                    const isToday = format(parseUTCDate(conv.lastMessageAt), "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

                    return (
                      <div
                        key={conv.senderId}
                        className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 cursor-pointer transition-all duration-200 group"
                        onClick={() => setSelectedSenderId(conv.senderId)}
                      >
                        <div className="relative">
                          <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow">
                            <span className="text-xl font-semibold text-white">
                              {conv.senderName ? conv.senderName[0].toUpperCase() : "?"}
                            </span>
                          </div>
                          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-blue-500 rounded-full border-2 border-white"></div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className="font-semibold text-gray-900 truncate">
                              {conv.senderName || conv.senderId}
                            </h3>
                            <span className={`text-xs font-medium ${isToday ? 'text-blue-600' : 'text-gray-400'}`}>
                              {isToday
                                ? format(parseUTCDate(conv.lastMessageAt), "h:mm a")
                                : format(parseUTCDate(conv.lastMessageAt), "MMM d, yyyy")}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-gray-500 truncate max-w-[60%]">{conv.lastMessageText}</p>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                              {conv.messageCount} {conv.messageCount === 1 ? 'msg' : 'msgs'}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(conv.senderId);
                          }}
                          className="p-1.5 rounded-md hover:bg-red-100 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete conversation"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>

                        <ArrowLeft className="h-5 w-5 text-gray-300 rotate-180 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4">
                <div className="flex items-center gap-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedSenderId(null)}
                    className="text-white hover:bg-white/20 rounded-full"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-full flex items-center justify-center">
                    <span className="text-xl font-semibold text-white">
                      {selectedConversation?.senderName?.[0]?.toUpperCase() || "?"}
                    </span>
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-white">
                      {selectedConversation?.senderName || selectedSenderId}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => refetchMessages()}
                      disabled={messagesRefetching}
                      className="text-white hover:bg-white/20 rounded-full"
                      title="Refresh messages"
                    >
                      <RefreshCw className={`h-4 w-4 ${messagesRefetching ? 'animate-spin' : ''}`} />
                    </Button>
                    {selectedConversation && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur text-white text-xs font-medium">
                        <MessageCircle className="h-3.5 w-3.5" />
                        {format(parseUTCDate(selectedConversation.lastMessageAt), "MMM d, yyyy")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-[#f0f2f5] min-h-[500px] max-h-[calc(100vh-280px)] overflow-y-auto">
                {loadingMessages ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-2" />
                      <p className="text-gray-500 text-sm">Loading messages...</p>
                    </div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <MessageCircle className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">No messages in this conversation</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 space-y-1">
                    {messages.length > 0 && (
                      <div className="flex justify-center mb-4">
                        <span className="px-4 py-1.5 bg-white rounded-full text-xs font-medium text-gray-600 shadow-sm">
                          {format(parseUTCDate(messages[0].createdAt), "EEEE, MMMM d, yyyy")}
                        </span>
                      </div>
                    )}

                    {messages.map((msg, index) => {
                      const isOutgoing = msg.direction === "outgoing";
                      const prevMsg = messages[index - 1];
                      const showDateSeparator = prevMsg &&
                        format(parseUTCDate(msg.createdAt), "yyyy-MM-dd") !==
                        format(parseUTCDate(prevMsg.createdAt), "yyyy-MM-dd");

                      return (
                        <div key={msg.id}>
                          {showDateSeparator && (
                            <div className="flex justify-center my-4">
                              <span className="px-4 py-1.5 bg-white rounded-full text-xs font-medium text-gray-600 shadow-sm">
                                {format(parseUTCDate(msg.createdAt), "EEEE, MMMM d, yyyy")}
                              </span>
                            </div>
                          )}
                          <div className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} mb-1`}>
                            <div
                              className={`relative max-w-[75%] px-3 py-2 rounded-2xl shadow-sm ${
                                isOutgoing
                                  ? 'bg-blue-600 text-white rounded-br-md'
                                  : 'bg-white text-gray-800 rounded-bl-md'
                              }`}
                            >
                              {msg.messageType === "image" && msg.mediaUrl ? (
                                <div className="space-y-2">
                                  <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
                                    <img src={msg.mediaUrl} alt="Attachment" className="max-w-full max-h-48 rounded-xl cursor-pointer hover:opacity-90 transition-opacity" />
                                  </a>
                                  {msg.messageText && <p className="text-[17px] leading-relaxed whitespace-pre-wrap">{msg.messageText}</p>}
                                </div>
                              ) : (
                                <p className="text-[17px] leading-relaxed whitespace-pre-wrap">{msg.messageText}</p>
                              )}
                              <div className={`flex items-center justify-end gap-1 mt-1 ${
                                isOutgoing ? 'text-white/70' : 'text-gray-400'
                              }`}>
                                <span className="text-[11px]">
                                  {format(parseUTCDate(msg.createdAt), "h:mm a")}
                                </span>
                                {isOutgoing && (
                                  <Check className="h-3.5 w-3.5 text-white/80" />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <div className="bg-white border-t px-6 py-3">
                <p className="text-center text-xs text-gray-400">
                  This is a view-only conversation history
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Conversation</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all messages in this conversation. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
