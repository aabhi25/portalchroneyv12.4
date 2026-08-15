import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { MessageCircle, ArrowLeft, Loader2, Trash2, Search, RefreshCw, Check, X } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import InstagramTabBar from "@/components/InstagramTabBar";

interface ConversationSummary {
  senderId: string;
  senderUsername: string | null;
  messageCount: number;
  lastMessageAt: string;
  lastMessageText: string;
}

interface InstagramMessage {
  id: string;
  businessAccountId: string;
  senderId: string;
  senderUsername: string | null;
  messageText: string | null;
  direction: string;
  igMessageId: string | null;
  messageType: string;
  mediaUrl: string | null;
  createdAt: string;
}

const parseUTCDate = (dateString: string | Date): Date => {
  if (dateString instanceof Date) return dateString;
  const utcString = dateString.endsWith('Z') ? dateString : dateString + 'Z';
  return new Date(utcString);
};

export default function InstagramConversations() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedSenderId, setSelectedSenderId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [], isLoading: loadingConversations } = useQuery<ConversationSummary[]>({
    queryKey: ["/api/instagram/conversations"],
    queryFn: async () => {
      return await apiRequest("GET", "/api/instagram/conversations");
    },
  });

  const { data: messages = [], isLoading: loadingMessages, refetch: refetchMessages, isRefetching: messagesRefetching } = useQuery<InstagramMessage[]>({
    queryKey: ["/api/instagram/conversations", selectedSenderId],
    queryFn: async () => {
      return await apiRequest("GET", `/api/instagram/conversations/${selectedSenderId}`);
    },
    enabled: !!selectedSenderId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (senderId: string) => {
      await apiRequest("DELETE", `/api/instagram/conversations/${senderId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instagram/conversations"] });
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
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (conv.senderUsername && conv.senderUsername.toLowerCase().includes(q)) ||
      conv.senderId.toLowerCase().includes(q) ||
      (conv.lastMessageText && conv.lastMessageText.toLowerCase().includes(q))
    );
  });

  useEffect(() => {
    if (messages.length > 0 && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div className="min-h-screen bg-gray-50">
      <InstagramTabBar activeTab="conversations" />

      <div className="p-6">
        <div className="flex rounded-2xl shadow-sm border overflow-hidden bg-white" style={{ height: 'calc(100vh - 140px)' }}>
          {/* Left Panel - Conversation List */}
          <div className={`${selectedSenderId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[380px] md:min-w-[380px] border-r`}>
            <div className="bg-gradient-to-r from-purple-600 to-pink-500 px-6 py-5 shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-white">Conversations</h2>
                {conversations.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-medium">
                    {conversations.length}
                  </span>
                )}
              </div>
              <p className="text-purple-100 text-sm mt-1">View message history from Instagram DMs</p>
            </div>

            <div className="px-3 py-2 border-b shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by username..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm bg-gray-50 border-gray-200 focus:bg-white"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y">
              {loadingConversations ? (
                <div className="flex items-center justify-center py-16">
                  <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-purple-500 mx-auto mb-2" />
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
                      {searchQuery ? "Try a different search" : "Instagram DMs will appear here once received"}
                    </p>
                  </div>
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const isToday = format(parseUTCDate(conv.lastMessageAt), "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
                  const isActive = selectedSenderId === conv.senderId;

                  return (
                    <div
                      key={conv.senderId}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all duration-200 group ${isActive ? 'bg-purple-50 border-l-4 border-l-purple-500' : 'hover:bg-gray-50 border-l-4 border-l-transparent'}`}
                      onClick={() => setSelectedSenderId(conv.senderId)}
                    >
                      <div className="relative shrink-0">
                        <div className="w-11 h-11 bg-gradient-to-br from-purple-400 to-pink-500 rounded-full flex items-center justify-center">
                          <span className="text-base font-semibold text-white">
                            {conv.senderUsername ? conv.senderUsername[0].toUpperCase() : "?"}
                          </span>
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <h3 className="font-semibold text-sm text-gray-900 truncate">
                            {conv.senderUsername ? `@${conv.senderUsername}` : conv.senderId}
                          </h3>
                          <span className={`text-[11px] shrink-0 ml-2 ${isToday ? 'text-purple-600 font-medium' : 'text-gray-400'}`}>
                            {isToday
                              ? format(parseUTCDate(conv.lastMessageAt), "h:mm a")
                              : format(parseUTCDate(conv.lastMessageAt), "MMM d, yyyy")}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-500 truncate">{conv.lastMessageText}</p>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-medium shrink-0 ml-2">
                            {conv.messageCount}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(conv.senderId);
                        }}
                        className="p-1 rounded-md hover:bg-red-100 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        title="Delete conversation"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel - Chat View */}
          <div className={`${selectedSenderId ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0`}>
            {selectedSenderId ? (
              <>
                <div className="bg-gradient-to-r from-purple-600 to-pink-500 px-5 py-3 shrink-0">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedSenderId(null)}
                      className="text-white hover:bg-white/20 rounded-full md:hidden"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-full flex items-center justify-center shrink-0">
                      <span className="text-lg font-semibold text-white">
                        {selectedConversation?.senderUsername?.[0]?.toUpperCase() || "?"}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-base font-semibold text-white truncate">
                        {selectedConversation?.senderUsername
                          ? `@${selectedConversation.senderUsername}`
                          : selectedSenderId}
                      </h2>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => refetchMessages()}
                        disabled={messagesRefetching}
                        className="text-white hover:bg-white/20 rounded-full h-8 w-8"
                        title="Refresh messages"
                      >
                        <RefreshCw className={`h-4 w-4 ${messagesRefetching ? 'animate-spin' : ''}`} />
                      </Button>
                      {selectedConversation && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur text-white text-[11px] font-medium">
                          <MessageCircle className="h-3 w-3" />
                          {format(parseUTCDate(selectedConversation.lastMessageAt), "MMM d, yyyy")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-[#faf5ff] flex-1 overflow-y-auto">
                  {loadingMessages ? (
                    <div className="flex items-center justify-center h-64">
                      <div className="text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-purple-500 mx-auto mb-2" />
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
                                    ? 'text-white rounded-br-md'
                                    : 'bg-white text-gray-800 rounded-bl-md'
                                }`}
                                style={isOutgoing ? { background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #d946ef 100%)' } : {}}
                              >
                                {msg.messageType === "image" && msg.mediaUrl ? (
                                  <div className="space-y-2">
                                    <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
                                      <img src={msg.mediaUrl} alt="Attachment" className="max-w-full max-h-48 rounded-xl cursor-pointer hover:opacity-90 transition-opacity" />
                                    </a>
                                    {msg.messageText && <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.messageText}</p>}
                                  </div>
                                ) : (
                                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.messageText}</p>
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

                <div className="bg-white border-t px-6 py-2 shrink-0">
                  <p className="text-center text-xs text-gray-400">
                    This is a view-only conversation history
                  </p>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-gray-50/50">
                <div className="text-center">
                  <div className="w-24 h-24 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <MessageCircle className="h-12 w-12 text-purple-300" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-600 mb-1">Select a conversation</h3>
                  <p className="text-sm text-gray-400">Choose a conversation from the list to view messages</p>
                </div>
              </div>
            )}
          </div>
        </div>
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
