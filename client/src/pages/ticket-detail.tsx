import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState } from "react";
import WebsiteNavTabs from "@/components/WebsiteNavTabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  ArrowLeft, 
  Send, 
  Sparkles, 
  AlertCircle, 
  CheckCircle2,
  TrendingUp,
  MessageSquare,
  Clock,
  User,
  Bot,
  Copy,
  Edit3,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface TicketMessage {
  id: string;
  ticketId: string;
  senderId: string | null;
  senderType: string;
  senderName: string;
  senderEmail: string | null;
  message: string;
  messageType: string;
  isInternal: string;
  aiDrafted: string;
  aiConfidence: string | null;
  createdAt: Date;
}

interface Ticket {
  id: string;
  ticketNumber: string;
  businessAccountId: string;
  conversationId: string | null;
  subject: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  assignedTo: string | null;
  tags: string | null;
  emotionalState: string | null;
  churnRisk: string | null;
  escalationReason: string | null;
  autoResolved: string;
  aiDraftedResponse: string | null;
  aiConfidenceScore: string | null;
  resolutionSummary: string | null;
  customerFeedback: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

export default function TicketDetail() {
  const [, params] = useRoute("/tickets/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const ticketId = params?.id;
  const [agentMessage, setAgentMessage] = useState("");
  const [isEditingAIDraft, setIsEditingAIDraft] = useState(false);
  const [editedAIDraft, setEditedAIDraft] = useState("");

  // Fetch ticket details
  const { data: ticket, isLoading: ticketLoading } = useQuery<Ticket>({
    queryKey: [`/api/tickets/${ticketId}`],
    enabled: !!ticketId,
  });

  // Fetch ticket messages
  const { data: messages = [], isLoading: messagesLoading } = useQuery<TicketMessage[]>({
    queryKey: [`/api/tickets/${ticketId}/messages`],
    enabled: !!ticketId,
  });

  // Fetch conversation history if linked
  const { data: conversationMessages = [] } = useQuery<ConversationMessage[]>({
    queryKey: [`/api/conversations/${ticket?.conversationId}/messages`],
    enabled: !!ticket?.conversationId,
  });

  // Send agent response mutation
  const sendResponseMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await fetch(`/api/tickets/${ticketId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tickets/${ticketId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tickets/${ticketId}/messages`] });
      setAgentMessage("");
      setIsEditingAIDraft(false);
      toast({
        title: "Response sent",
        description: "Your response has been sent to the customer via chat",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send response",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Resolve ticket mutation
  const resolveTicketMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tickets/${ticketId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ resolutionSummary: "Resolved by agent" }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tickets/${ticketId}`] });
      toast({
        title: "Ticket resolved",
        description: "The ticket has been marked as resolved",
      });
    },
  });

  if (ticketLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">Loading ticket details...</div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Ticket not found</AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleSendResponse = () => {
    const messageToSend = isEditingAIDraft ? editedAIDraft : agentMessage;
    if (!messageToSend.trim()) return;
    sendResponseMutation.mutate(messageToSend);
  };

  const handleUseAIDraft = () => {
    if (ticket.aiDraftedResponse) {
      setEditedAIDraft(ticket.aiDraftedResponse);
      setIsEditingAIDraft(true);
    }
  };

  const handleCopyAIDraft = () => {
    if (ticket.aiDraftedResponse) {
      navigator.clipboard.writeText(ticket.aiDraftedResponse);
      toast({
        title: "Copied to clipboard",
        description: "AI response copied - you can paste and edit it",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      open: { variant: "destructive", label: "Open" },
      in_progress: { variant: "default", label: "In Progress" },
      resolved: { variant: "secondary", label: "Resolved" },
      closed: { variant: "outline", label: "Closed" },
    };
    const config = variants[status] || { variant: "outline", label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline" }> = {
      low: { variant: "outline" },
      medium: { variant: "secondary" },
      high: { variant: "default" },
      urgent: { variant: "destructive" },
    };
    const config = variants[priority] || { variant: "outline" };
    return <Badge variant={config.variant}>{priority.toUpperCase()}</Badge>;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <WebsiteNavTabs />
      <div className="container mx-auto p-6 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/tickets")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Ticket #{ticket.ticketNumber}</h1>
              {ticket.autoResolved === 'true' && (
                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                  <Sparkles className="w-3 h-3 mr-1" />
                  AI Auto-Resolved
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{ticket.subject}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {getStatusBadge(ticket.status)}
          {getPriorityBadge(ticket.priority)}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* AI Analysis Card */}
          {(ticket.escalationReason || ticket.emotionalState || ticket.churnRisk) && (
            <Card className="border-purple-200 bg-purple-50/50 dark:bg-purple-950/20">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  AI Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {ticket.escalationReason && (
                  <div>
                    <div className="text-sm font-medium mb-1">Escalation Reason</div>
                    <div className="text-sm text-muted-foreground bg-background rounded p-3">
                      {ticket.escalationReason}
                    </div>
                  </div>
                )}
                
                <div className="grid grid-cols-3 gap-4">
                  {ticket.emotionalState && (
                    <div>
                      <div className="text-sm font-medium mb-1">Emotional State</div>
                      <Badge variant={ticket.emotionalState === 'frustrated' || ticket.emotionalState === 'angry' ? 'destructive' : 'secondary'}>
                        {ticket.emotionalState}
                      </Badge>
                    </div>
                  )}
                  
                  {ticket.churnRisk && (
                    <div>
                      <div className="text-sm font-medium mb-1">Churn Risk</div>
                      <Badge variant={ticket.churnRisk === 'high' ? 'destructive' : ticket.churnRisk === 'medium' ? 'default' : 'secondary'}>
                        {ticket.churnRisk}
                      </Badge>
                    </div>
                  )}

                  {ticket.aiConfidenceScore && (
                    <div>
                      <div className="text-sm font-medium mb-1">AI Confidence</div>
                      <Badge variant="outline">
                        {Math.round(parseFloat(ticket.aiConfidenceScore) * 100)}%
                      </Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Suggested Response */}
          {ticket.aiDraftedResponse && ticket.autoResolved !== 'true' && (
            <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="w-5 h-5 text-blue-600" />
                    AI Suggested Response
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleCopyAIDraft}>
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </Button>
                    <Button size="sm" variant="default" onClick={handleUseAIDraft}>
                      <Edit3 className="w-4 h-4 mr-1" />
                      Use & Edit
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm bg-background rounded p-4 whitespace-pre-wrap">
                  {ticket.aiDraftedResponse}
                </div>
                {ticket.aiConfidenceScore && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    AI Confidence: {Math.round(parseFloat(ticket.aiConfidenceScore) * 100)}%
                    {parseFloat(ticket.aiConfidenceScore) < 0.75 && (
                      <span className="text-orange-600 ml-2">
                        (Below auto-resolve threshold - please review carefully)
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Conversation History */}
          {conversationMessages.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  Chat Conversation History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {conversationMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${
                        msg.role === 'user' ? 'flex-row-reverse' : ''
                      }`}
                    >
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        msg.role === 'user' ? 'bg-blue-100' : 'bg-purple-100'
                      }`}>
                        {msg.role === 'user' ? (
                          <User className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Bot className="w-4 h-4 text-purple-600" />
                        )}
                      </div>
                      <div className={`flex-1 ${msg.role === 'user' ? 'text-right' : ''}`}>
                        <div className={`inline-block max-w-[80%] rounded-lg p-3 ${
                          msg.role === 'user'
                            ? 'bg-blue-100 dark:bg-blue-900'
                            : 'bg-gray-100 dark:bg-gray-800'
                        }`}>
                          <p className="text-sm">{msg.content}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Agent Response Interface */}
          {(ticket.status === 'open' || ticket.status === 'in_progress') && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Send Response to Customer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {isEditingAIDraft && (
                  <Alert>
                    <Sparkles className="h-4 w-4" />
                    <AlertDescription>
                      Editing AI suggested response. You can modify it before sending.
                    </AlertDescription>
                  </Alert>
                )}
                
                <Textarea
                  placeholder="Type your response to the customer..."
                  value={isEditingAIDraft ? editedAIDraft : agentMessage}
                  onChange={(e) => isEditingAIDraft ? setEditedAIDraft(e.target.value) : setAgentMessage(e.target.value)}
                  rows={6}
                  className="resize-none"
                />
                
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Response will appear as Chroney in the chat widget
                  </p>
                  <div className="flex gap-2">
                    {isEditingAIDraft && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsEditingAIDraft(false);
                          setEditedAIDraft("");
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                    <Button
                      onClick={handleSendResponse}
                      disabled={sendResponseMutation.isPending || (!agentMessage.trim() && !editedAIDraft.trim())}
                    >
                      <Send className="w-4 h-4 mr-2" />
                      {sendResponseMutation.isPending ? "Sending..." : "Send Response"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ticket Messages */}
          {messages.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Ticket Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {messages.map((msg) => (
                    <div key={msg.id} className="flex gap-3 border-b pb-4 last:border-0">
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        msg.senderType === 'customer' ? 'bg-blue-100' : 'bg-green-100'
                      }`}>
                        {msg.senderType === 'customer' ? (
                          <User className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Bot className="w-4 h-4 text-green-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{msg.senderName}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                          </span>
                          {msg.aiDrafted === 'true' && (
                            <Badge variant="outline" className="text-xs">
                              <Sparkles className="w-3 h-3 mr-1" />
                              AI
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{msg.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar - Right Column */}
        <div className="space-y-6">
          {/* Customer Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Customer Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-sm font-medium mb-1">Name</div>
                <div className="text-sm text-muted-foreground">{ticket.customerName || 'Unknown'}</div>
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Email</div>
                <div className="text-sm text-muted-foreground">{ticket.customerEmail || 'N/A'}</div>
              </div>
              {ticket.customerPhone && (
                <div>
                  <div className="text-sm font-medium mb-1">Phone</div>
                  <div className="text-sm text-muted-foreground">{ticket.customerPhone}</div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ticket Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Ticket Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-sm font-medium mb-1">Category</div>
                <Badge variant="outline">{ticket.category || 'General'}</Badge>
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Created</div>
                <div className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                </div>
              </div>
              {ticket.resolvedAt && (
                <div>
                  <div className="text-sm font-medium mb-1">Resolved</div>
                  <div className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(ticket.resolvedAt), { addSuffix: true })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          {(ticket.status === 'open' || ticket.status === 'in_progress') && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => resolveTicketMutation.mutate()}
                  disabled={resolveTicketMutation.isPending}
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Mark as Resolved
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
