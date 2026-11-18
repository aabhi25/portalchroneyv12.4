import { Fragment, useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Eye, GitBranch, Loader2, Paperclip } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ChatMessage {
  id: string;
  outgoing: boolean;
  text: string;
  at: string;
  flowSessionId: string | null;
  attachments: { id: string; fileName: string | null; fileType: string | null; mimeType: string | null; url: string | null; caption: string | null }[];
}

interface ChatPage {
  senderName: string | null;
  hasMore: boolean;
  oldestTimestamp: string | null;
  journeys: { id: string; name: string }[];
  messages: ChatMessage[];
}

/**
 * The WhatsApp chat with a lead, read-only, in a popup over the Leads page (GET
 * /api/leads/whatsapp/:id/chat): newest 50 messages, "Load earlier messages" for more.
 */
export function WhatsappChatDialog({ leadId, name, phone, onClose }: {
  leadId: string | null;
  name?: string | null;
  phone?: string | null;
  onClose: () => void;
}) {
  const query = useInfiniteQuery<ChatPage>({
    queryKey: ["/api/leads/whatsapp", leadId, "chat"],
    enabled: !!leadId,
    queryFn: async ({ pageParam }) => {
      const before = pageParam ? `?before=${encodeURIComponent(String(pageParam))}` : "";
      const res = await fetch(`/api/leads/whatsapp/${leadId}/chat${before}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the chat");
      return res.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasMore ? last.oldestTimestamp : undefined),
  });
  // Pages come newest first; show oldest first.
  const pages = query.data?.pages ?? [];
  const messages = pages.slice().reverse().flatMap(p => p.messages);
  const journeyName = new Map(pages.flatMap(p => p.journeys).map(j => [j.id, j.name]));
  const title = name || pages[0]?.senderName || phone || "WhatsApp chat";

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pages.length === 1) endRef.current?.scrollIntoView({ block: "end" });
  }, [leadId, pages.length]);

  return (
    <Dialog open={!!leadId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0" data-testid="whatsapp-chat-dialog">
        <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b border-gray-200 px-5 py-3 pr-12 text-left">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-600">
            <FaWhatsapp className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[15px]">{title}</DialogTitle>
            <DialogDescription className="truncate text-xs">
              {[title !== phone ? phone : null, messages.length ? `${messages.length}${query.hasNextPage ? "+" : ""} message${messages.length === 1 && !query.hasNextPage ? "" : "s"}` : null].filter(Boolean).join(" · ") || "WhatsApp"}
            </DialogDescription>
          </div>
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-600 sm:inline-flex" title="Reply from WhatsApp › Conversations">
            <Eye className="h-3 w-3" /> Read only
          </span>
        </DialogHeader>

        <div className="min-h-[240px] flex-1 space-y-3 overflow-y-auto overscroll-contain bg-[#f4f1ec] px-4 py-4">
          {query.isLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
            </div>
          ) : query.isError ? (
            <p className="py-8 text-center text-sm text-gray-500">Couldn't load this chat.</p>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No messages in this chat.</p>
          ) : (
            <>
              {query.hasNextPage && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" className="bg-white" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                    {query.isFetchingNextPage && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Load earlier messages
                  </Button>
                </div>
              )}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || format(new Date(prev.at), "yyyy-MM-dd") !== format(new Date(m.at), "yyyy-MM-dd");
                const journey = m.flowSessionId ? journeyName.get(m.flowSessionId) : null;
                const journeyStarts = journey && m.flowSessionId !== prev?.flowSessionId;
                return (
                  <Fragment key={m.id}>
                    {newDay && (
                      <div className="flex justify-center">
                        <span className="rounded-md bg-white/80 px-2 py-0.5 text-[11px] text-gray-500 shadow-sm">{format(new Date(m.at), "EEE, MMM d, yyyy")}</span>
                      </div>
                    )}
                    {journeyStarts && (
                      <div className="flex justify-center">
                        <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-600">
                          <GitBranch className="h-3 w-3" /> Journey · {journey}
                        </span>
                      </div>
                    )}
                    <div className={`flex ${m.outgoing ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-lg px-3 py-2 shadow-sm ${m.outgoing ? "bg-[#d9fdd3] text-gray-900" : "bg-white text-gray-900"}`}>
                        {m.attachments.map(a => a.url && (a.fileType === "image" || a.mimeType?.startsWith("image/")) ? (
                          <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="mb-1 block">
                            <img src={a.url} alt={a.caption || a.fileName || "Photo"} className="max-h-60 rounded-md object-contain" />
                          </a>
                        ) : (
                          <a key={a.id} href={a.url ?? undefined} target="_blank" rel="noreferrer" className="mb-1 inline-flex items-center gap-1 text-xs text-gray-700 underline-offset-2 hover:underline">
                            <Paperclip className="h-3 w-3" />{a.fileName || "Attachment"}
                          </a>
                        ))}
                        {m.text && <p className="whitespace-pre-wrap break-words text-sm">{m.text}</p>}
                        <p className="mt-0.5 text-right text-[10px] text-gray-500">{format(new Date(m.at), "h:mm a")}</p>
                      </div>
                    </div>
                  </Fragment>
                );
              })}
              <div ref={endRef} />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
