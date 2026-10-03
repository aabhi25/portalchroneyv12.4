/**
 * Campaign replies — shared pieces:
 *  - readable status labels for campaigns and recipients
 *  - CampaignReplyList: the searchable list of customers who replied
 *  - CampaignReplyThread: one conversation, with the staff reply box (inside WhatsApp's
 *    24-hour window), pause / resume AI, and "Needs human" handling
 * Used by WhatsAppCampaignConversations (Campaign replies page) and WhatsAppCampaignDetail.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Bot, BotOff, CheckCircle2, Clock, Hand, Loader2, MessageCircle, PhoneCall, Send, UserRound,
} from "lucide-react";

// ── Labels ──────────────────────────────────────────────────────────────────
export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  completed: "Finished",
  cancelled: "Cancelled",
  failed: "Stopped",
  paused: "Paused",
};

export const CAMPAIGN_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", scheduled: "secondary", sending: "secondary",
  completed: "default", cancelled: "destructive", failed: "destructive",
};

export const RECIPIENT_STATUS_LABEL: Record<string, string> = {
  pending: "Waiting to send",
  claimed: "Sending",
  queued: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  replied: "Replied",
  failed: "Failed",
  expired: "Not delivered",
  opted_out: "Opted out",
};

function titleCase(value: string): string {
  const s = String(value || "").replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}
export const campaignStatusLabel = (status: string) => CAMPAIGN_STATUS_LABEL[status] || titleCase(status);
export const recipientStatusLabel = (status: string) => RECIPIENT_STATUS_LABEL[status] || titleCase(status);

export const RECIPIENT_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", claimed: "outline", queued: "outline", sent: "secondary", delivered: "secondary", read: "secondary",
  replied: "default", opted_out: "outline", failed: "destructive", expired: "destructive",
};

// ── Types ───────────────────────────────────────────────────────────────────
export interface Recipient {
  id: string; phone: string; name: string;
  status: string; errorMessage: string | null;
  sentAt: string | null; deliveredAt: string | null; readAt: string | null;
  firstReplyAt: string | null; replyCount: number; aiReplyCount: number;
  primaryClassification?: string | null;
  dispositionData?: Record<string, string> | null;
  callbackRequired?: boolean | null;
  callbackReason?: string | null;
  customerFeedback?: string | null;
  aiPaused?: boolean | null;
  aiPausedReason?: string | null;
  needsHuman?: boolean | null;
  needsHumanReason?: string | null;
}

export interface CampaignMessage {
  id: string; direction: string; body: string; createdAt: string; metadata: any;
}

export interface ReplyListItem extends Recipient {
  campaignId: string;
  campaignName: string;
  classificationLabel: string | null;
  interested: boolean;
  unread: boolean;
  needsHumanAny: boolean;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  lastMessageDirection: string | null;
}

export interface ReplyThread {
  recipient: ReplyListItem & { campaignAiEnabled: string; campaignAiAgentName: string | null };
  messages: CampaignMessage[];
  window: { open: boolean; lastCustomerMessageAt: string | null; closesAt: string | null };
}

// ── Small pieces ────────────────────────────────────────────────────────────
export function recipientInitials(r: { name?: string | null; phone?: string }): string {
  if (r.name) {
    const parts = r.name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
  }
  return (r.phone ?? "?").slice(-2);
}

export function RecipientAvatar({ r }: { r: { name?: string | null; phone?: string } }) {
  return (
    <div className="h-10 w-10 rounded-full bg-emerald-600 text-white flex items-center justify-center text-sm font-semibold shrink-0">
      {recipientInitials(r)}
    </div>
  );
}

function shortTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Who sent a message, in plain words. */
export function messageSender(m: CampaignMessage, opts: { agentName?: string | null; customerName?: string | null }): { label: string; kind: "customer" | "ai" | "staff" | "campaign" } {
  if (m.direction === "inbound") return { label: opts.customerName || "Customer", kind: "customer" };
  if (m.direction === "outbound_staff") return { label: `Your team${m.metadata?.sentBy ? ` · ${m.metadata.sentBy}` : ""}`, kind: "staff" };
  if (m.direction === "outbound_ai") {
    const handover = m.metadata?.source === "campaign_ai_handover";
    return { label: `${opts.agentName || "AI"} (AI)${handover ? " · handed over to your team" : ""}`, kind: "ai" };
  }
  return { label: "Campaign message", kind: "campaign" };
}

export function MessageBubbles({ messages, agentName, customerName, endRef }: {
  messages: CampaignMessage[]; agentName?: string | null; customerName?: string | null; endRef?: RefObject<HTMLDivElement>;
}) {
  return (
    <div className="space-y-2">
      {messages.map(m => {
        const who = messageSender(m, { agentName, customerName });
        const inbound = who.kind === "customer";
        const tone = inbound
          ? "bg-white text-gray-900 rounded-tl-none"
          : who.kind === "staff"
            ? "bg-sky-100 text-gray-900 rounded-tr-none"
            : who.kind === "ai"
              ? "bg-emerald-100 text-gray-900 rounded-tr-none"
              : "bg-[#dcf8c6] text-gray-900 rounded-tr-none";
        return (
          <div key={m.id} className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[85%] sm:max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${tone}`} data-testid={`message-${m.direction}`}>
              <div className={`text-[10px] font-semibold mb-0.5 flex items-center gap-1 ${inbound ? "text-emerald-700" : who.kind === "staff" ? "text-sky-700" : "text-gray-500"}`}>
                {who.kind === "staff" && <UserRound className="h-3 w-3" />}
                {who.kind === "ai" && <Bot className="h-3 w-3" />}
                {who.label}
              </div>
              <div className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</div>
              {who.kind === "campaign" && Array.isArray(m.metadata?.buttons) && m.metadata.buttons.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {m.metadata.buttons.map((btn: { text: string }, bi: number) => (
                    <div key={bi} className="text-center text-xs font-medium text-blue-600 border border-blue-200 rounded-full px-3 py-1 bg-white">{btn.text}</div>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-gray-400 mt-1 text-right">{fullTime(m.createdAt)}</div>
            </div>
          </div>
        );
      })}
      {endRef && <div ref={endRef} />}
    </div>
  );
}

// ── List ────────────────────────────────────────────────────────────────────
export function CampaignReplyList({ items, isLoading, selectedId, onSelect, showCampaign, emptyText }: {
  items: ReplyListItem[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (item: ReplyListItem) => void;
  showCampaign?: boolean;
  emptyText?: string;
}) {
  if (isLoading && items.length === 0) {
    return <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>;
  }
  if (items.length === 0) {
    return <div className="p-6 text-center text-gray-400 text-sm">{emptyText || "No replies match these filters."}</div>;
  }
  return (
    <div className="divide-y">
      {items.map(r => {
        const selected = selectedId === r.id;
        const preview = r.lastMessageBody
          ? `${r.lastMessageDirection === "inbound" ? "" : r.lastMessageDirection === "outbound_staff" ? "You: " : r.lastMessageDirection === "outbound_ai" ? "AI: " : ""}${r.lastMessageBody}`
          : r.customerFeedback || (r.firstReplyAt ? "" : recipientStatusLabel(r.status));
        return (
          <button
            type="button"
            key={r.id}
            onClick={() => onSelect(r)}
            className={`w-full text-left px-3 py-3 hover:bg-gray-50 transition-colors border-l-4 ${selected ? "bg-emerald-50 border-emerald-600" : "border-transparent"}`}
            data-testid={`row-reply-${r.id}`}
          >
            <div className="flex items-start gap-3">
              <RecipientAvatar r={r} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm truncate ${r.unread ? "font-semibold text-gray-900" : "font-medium text-gray-800"}`}>{r.name || r.phone}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{shortTime(r.lastInboundAt || r.lastMessageAt || r.firstReplyAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className={`text-xs truncate ${r.unread ? "text-gray-800" : "text-gray-500"}`}>{preview || "—"}</span>
                  {r.unread && <span className="h-2.5 w-2.5 rounded-full bg-emerald-600 shrink-0" aria-label="Unread" />}
                </div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {showCampaign && (
                    <span className="text-[10px] text-gray-500 truncate max-w-[10rem]" title={r.campaignName}>{r.campaignName}</span>
                  )}
                  {r.classificationLabel && (
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${r.interested ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-violet-50 text-violet-700 border-violet-200"}`}>
                      {r.classificationLabel}
                    </Badge>
                  )}
                  {r.needsHumanAny && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-amber-50 text-amber-800 border-amber-200" data-testid={`badge-needs-human-${r.id}`}>
                      <Hand className="h-2.5 w-2.5 mr-0.5" /> Needs human
                    </Badge>
                  )}
                  {r.aiPaused && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-gray-100 text-gray-700 border-gray-200">
                      <BotOff className="h-2.5 w-2.5 mr-0.5" /> AI paused
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Thread ──────────────────────────────────────────────────────────────────
export function CampaignReplyThread({ recipientId, onBack, onChanged }: {
  recipientId: string;
  /** Mobile: back to the list. */
  onBack?: () => void;
  /** Called after a change that affects the list (sent, paused, handled). */
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [pauseAi, setPauseAi] = useState(true);
  const [confirmResume, setConfirmResume] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const threadKey = [`/api/whatsapp/campaign-replies/${recipientId}`];

  const { data, isLoading, error } = useQuery<ReplyThread>({
    queryKey: threadKey,
    refetchInterval: (q) => (q.state.error ? false : 5000),
    refetchOnMount: "always",
  });

  const messageCount = data?.messages.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messageCount, recipientId]);
  useEffect(() => { setText(""); setPauseAi(true); }, [recipientId]);
  // Opening the thread marks it read on the server — refresh the list's unread dots once.
  const loaded = !!data;
  useEffect(() => {
    if (loaded) onChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, recipientId]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: threadKey });
    onChanged?.();
  };

  const sendMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/whatsapp/campaign-replies/${recipientId}/reply`, { text, pauseAi }),
    onSuccess: () => {
      setText("");
      refresh();
      toast({ title: "Reply sent" });
    },
    onError: (e: any) => {
      refresh();
      toast({ title: "Couldn't send your reply", description: e.message, variant: "destructive" });
    },
  });

  const aiMutation = useMutation({
    mutationFn: async (paused: boolean) => apiRequest("POST", `/api/whatsapp/campaign-replies/${recipientId}/ai`, { paused }),
    onSuccess: (_d, paused) => {
      refresh();
      toast({ title: paused ? "AI paused for this customer" : "AI replies are back on for this customer" });
    },
    onError: (e: any) => toast({ title: "Couldn't change the AI for this customer", description: e.message, variant: "destructive" }),
  });

  const handledMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/whatsapp/campaign-replies/${recipientId}/handled`),
    onSuccess: () => {
      refresh();
      toast({ title: "Marked as handled" });
    },
    onError: (e: any) => toast({ title: "Couldn't update this conversation", description: e.message, variant: "destructive" }),
  });

  if (isLoading && !data) {
    return <div className="flex-1 flex items-center justify-center text-sm text-gray-400 p-8"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading conversation…</div>;
  }
  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-sm text-gray-500 p-8 gap-3">
        {(error as Error)?.message || "Couldn't load this conversation."}
        {onBack && <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>}
      </div>
    );
  }

  const r = data.recipient;
  const aiOn = r.campaignAiEnabled === "true";
  const optedOut = r.status === "opted_out";
  const closesAt = data.window.closesAt ? new Date(data.window.closesAt) : null;
  const hoursLeft = closesAt ? Math.max(0, Math.round((closesAt.getTime() - Date.now()) / 3600000)) : 0;
  const canSend = data.window.open && !optedOut;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Header */}
      <div className="bg-gray-50 border-b px-3 sm:px-4 py-2.5 shrink-0 space-y-2">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 lg:hidden" onClick={onBack} aria-label="Back to replies">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <RecipientAvatar r={r} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm truncate">{r.name || r.phone}</div>
            <div className="text-xs text-gray-500 truncate">
              {r.name ? `${r.phone} · ` : ""}{r.campaignName}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.classificationLabel && (
            <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 text-[11px]">{r.classificationLabel}</Badge>
          )}
          {r.needsHumanAny && (
            <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-[11px]" title={r.needsHumanReason || r.callbackReason || undefined}>
              <Hand className="h-3 w-3 mr-1" /> Needs human{r.needsHumanReason || r.callbackReason ? ` — ${r.needsHumanReason || r.callbackReason}` : ""}
            </Badge>
          )}
          {aiOn && (
            r.aiPaused ? (
              <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-200 text-[11px]">
                <BotOff className="h-3 w-3 mr-1" /> AI paused{r.aiPausedReason === "handover" ? " — handed over to your team" : ""}
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[11px]">
                <Bot className="h-3 w-3 mr-1" /> AI replying
              </Badge>
            )
          )}
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {r.needsHumanAny && (
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => handledMutation.mutate()} disabled={handledMutation.isPending} data-testid="button-mark-handled">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark handled
              </Button>
            )}
            {aiOn && (r.aiPaused ? (
              <Button
                variant="outline" size="sm" className="h-7 px-2 text-xs"
                onClick={() => (r.needsHumanAny ? setConfirmResume(true) : aiMutation.mutate(false))}
                disabled={aiMutation.isPending}
                data-testid="button-resume-ai"
              >
                <Bot className="h-3.5 w-3.5 mr-1" /> Resume AI
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => aiMutation.mutate(true)} disabled={aiMutation.isPending} data-testid="button-pause-ai">
                <BotOff className="h-3.5 w-3.5 mr-1" /> Pause AI
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-[#e5ddd5] px-3 sm:px-4 py-4 min-h-[240px]">
        {data.messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">No messages yet.</div>
        ) : (
          <MessageBubbles messages={data.messages} agentName={r.campaignAiAgentName} customerName={r.name || r.phone} endRef={endRef} />
        )}
      </div>

      {/* Reply box */}
      <div className="border-t bg-white px-3 sm:px-4 py-3 shrink-0">
        {optedOut ? (
          <div className="text-xs text-gray-600 bg-gray-50 border rounded-md p-2.5">
            This customer opted out of your messages, so you can't reply here.
          </div>
        ) : !data.window.open ? (
          <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-2.5 flex gap-2" data-testid="window-closed-notice">
            <Clock className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              WhatsApp only allows a typed reply within 24 hours of the customer's last message.
              {closesAt ? ` This window closed on ${fullTime(closesAt.toISOString())}.` : " This customer hasn't messaged you yet."}
              {" "}You can reply here again as soon as they send a new message.
            </span>
          </div>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => { e.preventDefault(); if (text.trim() && !sendMutation.isPending) sendMutation.mutate(); }}
          >
            <div className="flex gap-2 items-end">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (text.trim() && !sendMutation.isPending) sendMutation.mutate();
                  }
                }}
                placeholder="Type your reply…"
                rows={2}
                maxLength={4096}
                className="min-h-[44px] max-h-40 resize-none text-sm"
                data-testid="input-staff-reply"
              />
              <Button type="submit" disabled={!canSend || !text.trim() || sendMutation.isPending} className="h-11 shrink-0" data-testid="button-send-staff-reply">
                {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span className="sr-only sm:not-sr-only sm:ml-1">Send</span>
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
              {aiOn && !r.aiPaused ? (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox checked={pauseAi} onCheckedChange={(v) => setPauseAi(v === true)} />
                  Pause the AI for this customer while I handle it
                </label>
              ) : <span />}
              <span>Reply window: about {hoursLeft} {hoursLeft === 1 ? "hour" : "hours"} left</span>
            </div>
          </form>
        )}
      </div>

      <AlertDialog open={confirmResume} onOpenChange={setConfirmResume}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn AI replies back on?</AlertDialogTitle>
            <AlertDialogDescription>
              This customer was flagged as needing a person. If you turn the AI back on, it will answer their next
              message automatically and the "Needs human" flag will be cleared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep paused</AlertDialogCancel>
            <AlertDialogAction onClick={() => aiMutation.mutate(false)}>Resume AI</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Empty right-hand pane on wide screens. */
export function NoThreadSelected() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm bg-[#efeae2] p-8 text-center gap-2">
      <MessageCircle className="h-10 w-10 text-gray-300" />
      Pick a customer to see their replies and answer them.
      <span className="text-xs text-gray-400 flex items-center gap-1"><PhoneCall className="h-3 w-3" /> "Needs human" shows customers who asked for a person.</span>
    </div>
  );
}
