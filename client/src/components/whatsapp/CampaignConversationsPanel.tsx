/**
 * Shared WhatsApp-style conversation panel for campaign recipient threads.
 * Used by both WhatsAppCampaignDetail (embedded below config) and
 * WhatsAppCampaignConversations (the dedicated Conversations tab).
 */
import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, MessageCircle, RotateCcw, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface Recipient {
  id: string; phone: string; name: string;
  status: string; errorMessage: string | null;
  sentAt: string | null; deliveredAt: string | null; readAt: string | null;
  firstReplyAt: string | null; replyCount: number; aiReplyCount: number;
}

export interface CampaignMessage {
  id: string; direction: string; body: string; createdAt: string; metadata: any;
}

export const RECIPIENT_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", queued: "outline", sent: "secondary", delivered: "secondary", read: "secondary",
  replied: "default", opted_out: "outline", failed: "destructive", expired: "destructive",
};

export function recipientInitials(r: { name?: string; phone?: string }): string {
  if (r.name) {
    const parts = r.name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return (r.phone ?? "?").slice(-2);
}

export function RecipientAvatar({ r }: { r: { name?: string; phone?: string } }) {
  return (
    <div className="h-10 w-10 rounded-full bg-emerald-600 text-white flex items-center justify-center text-sm font-semibold shrink-0">
      {recipientInitials(r)}
    </div>
  );
}

export function CampaignConversationsPanel({
  campaign, recipients, isLoading,
  selectedRecipient, setSelectedRecipient,
  messages, reconcileMutation, resendOneMutation,
}: {
  campaign: { status: string; aiAgentName?: string } | null;
  recipients: Recipient[];
  isLoading: boolean;
  selectedRecipient: Recipient | null;
  setSelectedRecipient: (r: Recipient) => void;
  messages: CampaignMessage[];
  reconcileMutation: { mutate: () => void; isPending: boolean };
  resendOneMutation: { mutate: (id: string) => void; isPending: boolean };
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const canRefresh = campaign?.status === "sending" || campaign?.status === "completed";

  return (
    <Card className="overflow-hidden">
      {/* Header — mirrors Lead Gen Conversations green bar */}
      <div className="bg-emerald-700 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <MessageCircle className="h-4 w-4" />
          Conversations
          <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">
            {recipients.length}
          </span>
        </div>
        {canRefresh && (
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/20 h-7 px-2"
            onClick={() => reconcileMutation.mutate()}
            disabled={reconcileMutation.isPending}
            title="Pull live delivery status from MSG91"
          >
            <RefreshCw className={`h-4 w-4 ${reconcileMutation.isPending ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>

      <div className="flex h-[540px]">
        {/* Left — recipient list */}
        <div className="w-72 shrink-0 border-r flex flex-col">
          <div className="flex-1 overflow-y-auto divide-y">
            {isLoading ? (
              <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>
            ) : recipients.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">
                No recipients yet — snapshot is created when you start the send.
              </div>
            ) : recipients.map(r => {
              const isSelected = selectedRecipient?.id === r.id;
              const canResend = r.status === "failed" || r.status === "expired";
              return (
                <div
                  key={r.id}
                  className={`px-3 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${isSelected ? "bg-emerald-50 border-l-4 border-emerald-600" : "border-l-4 border-transparent"}`}
                  onClick={() => setSelectedRecipient(r)}
                  data-testid={`row-recipient-${r.id}`}
                >
                  <div className="flex items-center gap-3">
                    <RecipientAvatar r={r} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium text-sm truncate">{r.name || r.phone}</span>
                        {r.firstReplyAt && (
                          <span className="text-[10px] text-gray-400 shrink-0">
                            {new Date(r.firstReplyAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Badge variant={RECIPIENT_STATUS_VARIANT[r.status] || "outline"} className="text-[10px] px-1.5 py-0 h-4">
                            {r.status}
                          </Badge>
                          {r.name && <span className="text-[11px] text-gray-400 truncate">{r.phone}</span>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {r.replyCount > 0 && (
                            <span className="bg-emerald-600 text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                              {r.replyCount}
                            </span>
                          )}
                          {r.errorMessage && (
                            <TooltipProvider delayDuration={100}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3.5 w-3.5 text-red-400 cursor-pointer" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs text-xs">
                                  {r.errorMessage}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </div>
                      {canResend && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1 text-[10px] mt-1 text-gray-500 hover:text-gray-800"
                          onClick={(e) => { e.stopPropagation(); resendOneMutation.mutate(r.id); }}
                          disabled={resendOneMutation.isPending}
                          data-testid={`button-resend-${r.id}`}
                        >
                          <RotateCcw className="h-2.5 w-2.5 mr-1" /> Resend
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right — chat thread */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Thread header */}
          {selectedRecipient ? (
            <div className="bg-gray-50 border-b px-4 py-2.5 flex items-center gap-3 shrink-0">
              <RecipientAvatar r={selectedRecipient} />
              <div>
                <div className="font-semibold text-sm">{selectedRecipient.name || selectedRecipient.phone}</div>
                {selectedRecipient.name && <div className="text-xs text-gray-500">{selectedRecipient.phone}</div>}
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 border-b px-4 py-2.5 shrink-0">
              <div className="text-sm text-gray-400">Select a recipient to view their conversation</div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto bg-[#e5ddd5] px-4 py-4">
            {!selectedRecipient ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                ← Pick a recipient to see the conversation
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                No messages yet for {selectedRecipient.phone}.
              </div>
            ) : (
              <div className="space-y-2">
                {messages.map(m => {
                  const isInbound = m.direction === "inbound";
                  const isAi = m.direction === "outbound_ai";
                  const isTpl = m.direction === "outbound_template";
                  const label = isTpl ? "Template" : isAi
                    ? `${campaign?.aiAgentName || "AI"} (AI)`
                    : (selectedRecipient?.name || selectedRecipient?.phone || "Customer");
                  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={m.id} className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                        isInbound
                          ? "bg-white text-gray-900 rounded-tl-none"
                          : isAi
                            ? "bg-emerald-100 text-gray-900 rounded-tr-none"
                            : "bg-[#dcf8c6] text-gray-900 rounded-tr-none"
                      }`}>
                        <div className={`text-[10px] font-semibold mb-0.5 ${isInbound ? "text-emerald-700" : "text-gray-500"}`}>
                          {label}
                        </div>
                        <div className="whitespace-pre-wrap leading-relaxed">{m.body}</div>
                        {isTpl && Array.isArray(m.metadata?.buttons) && m.metadata.buttons.length > 0 && (
                          <div className="mt-2 flex flex-col gap-1">
                            {m.metadata.buttons.map((btn: { text: string }, bi: number) => (
                              <div key={bi} className="text-center text-xs font-medium text-blue-600 border border-blue-200 rounded-full px-3 py-1 bg-white">
                                {btn.text}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="text-[10px] text-gray-400 mt-1 text-right">{time}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* View-only footer */}
          <div className="bg-gray-100 border-t px-4 py-2 text-center text-xs text-gray-400 shrink-0">
            This is a view-only conversation history
          </div>
        </div>
      </div>
    </Card>
  );
}
