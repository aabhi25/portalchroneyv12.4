import { Fragment, useEffect, useRef } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { format, isToday, isYesterday } from "date-fns";
import { ChevronLeft, ChevronRight, Eye, GitBranch, Loader2, Paperclip } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { Button } from "@/components/ui/button";

/** A WhatsApp chat as /api/group-admin/groups/:id/conversations/whatsapp lists it (one per student per account). */
export interface GroupWhatsappChat {
  phoneKey: string;
  senderPhone: string | null;
  businessAccountId: string;
  businessAccountName: string;
  name: string | null;
  messageCount: number;
  lastMessage: string | null;
  lastMessageAt: string;
  firstMessageAt: string;
  isLead: boolean;
}

interface GroupWhatsappMessage {
  id: string;
  direction: "incoming" | "outgoing";
  text: string | null;
  receivedAt: string;
  attachments: { id: string; name: string }[];
  journeyName: string | null;
}

export interface SelectedWhatsappChat {
  accountId: string;
  phoneKey: string;
}

const listTime = (iso: string) => {
  const d = new Date(iso);
  return isToday(d) ? `Today at ${format(d, "h:mm a")}` : isYesterday(d) ? `Yesterday at ${format(d, "h:mm a")}` : format(d, "MMM d, h:mm a");
};

/** The group's WhatsApp chats for the current filters (`params`: search, fromDate, toDate, accountId). */
export function useGroupWhatsappChats(groupId: string | null, params: string, page: number, enabled: boolean) {
  return useQuery<{ chats: GroupWhatsappChat[]; total: number; hasMore: boolean }>({
    queryKey: ["/api/group-admin/groups", groupId, "conversations", "whatsapp", params, page],
    queryFn: async () => {
      const res = await fetch(`/api/group-admin/groups/${groupId}/conversations/whatsapp?${params}&page=${page}&limit=20`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch WhatsApp chats");
      return res.json();
    },
    enabled: !!groupId && enabled,
  });
}

export function GroupWhatsappChatList({ chats, total, page, onPage, loading, selected, onSelect, hasFilters }: {
  chats: GroupWhatsappChat[];
  total: number;
  page: number;
  onPage: (page: number) => void;
  loading: boolean;
  selected: SelectedWhatsappChat | null;
  onSelect: (chat: GroupWhatsappChat) => void;
  hasFilters: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / 20));
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (chats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <FaWhatsapp className="w-12 h-12 text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">{hasFilters ? "No WhatsApp chats match these filters" : "No WhatsApp chats yet"}</p>
      </div>
    );
  }
  return (
    <>
      <div className="divide-y divide-gray-100">
        {chats.map((chat) => {
          const active = selected?.accountId === chat.businessAccountId && selected.phoneKey === chat.phoneKey;
          return (
            <div
              key={`${chat.businessAccountId}:${chat.phoneKey}`}
              onClick={() => onSelect(chat)}
              className={`px-4 py-3 cursor-pointer transition-colors ${active ? "bg-green-50 border-l-4 border-green-500" : "hover:bg-gray-50"}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-600">
                  <FaWhatsapp className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`truncate text-sm font-semibold ${chat.name ? "text-gray-900" : "text-gray-500"}`}>{chat.name || chat.senderPhone || "WhatsApp student"}</p>
                    <span className="max-w-[130px] shrink-0 truncate rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-600" title={chat.businessAccountName}>
                      {chat.businessAccountName}
                    </span>
                  </div>
                  {chat.name && chat.senderPhone && <p className="truncate font-mono text-xs text-gray-500">{chat.senderPhone}</p>}
                  {chat.lastMessage && <p className="mt-0.5 truncate text-xs text-gray-500" title={chat.lastMessage}>{chat.lastMessage}</p>}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-500">{listTime(chat.lastMessageAt)}</span>
                    <div className="flex items-center gap-1">
                      {chat.isLead && (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                          <span className="font-bold">L</span> Lead
                        </span>
                      )}
                      <span className="rounded-full bg-green-100 px-1.5 text-xs font-medium text-green-700 tabular-nums">{chat.messageCount}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="mt-auto border-t border-gray-200 p-4 bg-white">
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1} className="flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" /> Previous
            </Button>
            <span className="text-sm text-gray-600 font-medium">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="flex items-center gap-1">
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** One WhatsApp chat, read-only: the student's messages on the left, the account's replies on the right. */
export function GroupWhatsappChatThread({ groupId, chat, onBack }: {
  groupId: string;
  chat: GroupWhatsappChat;
  onBack: () => void;
}) {
  const query = useInfiniteQuery<{ messages: GroupWhatsappMessage[]; name: string | null; senderPhone: string; hasMore: boolean; oldestTimestamp: string | null }>({
    queryKey: ["/api/group-admin/groups", groupId, "conversations", "whatsapp", chat.businessAccountId, chat.phoneKey],
    queryFn: async ({ pageParam }) => {
      const before = pageParam ? `&before=${encodeURIComponent(String(pageParam))}` : "";
      const res = await fetch(`/api/group-admin/groups/${groupId}/conversations/whatsapp/${chat.businessAccountId}/${encodeURIComponent(chat.phoneKey)}?limit=50${before}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch chat");
      return res.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasMore ? last.oldestTimestamp : undefined),
  });
  // Pages come newest first; show oldest first.
  const messages = (query.data?.pages ?? []).slice().reverse().flatMap(p => p.messages);
  const first = query.data?.pages[0];
  const name = chat.name || first?.name || null;
  const phone = first?.senderPhone || chat.senderPhone;

  const endRef = useRef<HTMLDivElement>(null);
  const opened = `${chat.businessAccountId}:${chat.phoneKey}`;
  useEffect(() => {
    if (query.data?.pages.length === 1) endRef.current?.scrollIntoView({ block: "end" });
  }, [opened, query.data?.pages.length]);

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="md:hidden flex items-center gap-1 border-b border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-green-700"
      >
        <ChevronLeft className="w-4 h-4" />
        All WhatsApp chats
      </button>
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-600">
          <FaWhatsapp className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold text-gray-900">{name || phone || "WhatsApp student"}</h2>
            {chat.isLead && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                <span className="font-bold">L</span> Lead
              </span>
            )}
          </div>
          <p className="truncate text-xs text-gray-500">
            {[name ? phone : null, chat.businessAccountName, `${chat.messageCount} messages`, `since ${format(new Date(chat.firstMessageAt), "MMM d, yyyy")}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="hidden shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-600 sm:inline-flex" title="Group admins can read WhatsApp chats but not reply">
          <Eye className="h-3 w-3" /> Read only
        </span>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-3 bg-[#f4f1ec]">
        {query.isLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : query.isError ? (
          <p className="py-8 text-center text-sm text-gray-500">Couldn't load this chat.</p>
        ) : (
          <>
            {query.hasNextPage && (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" className="bg-white" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                  {query.isFetchingNextPage && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  Load earlier messages
                </Button>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || format(new Date(prev.receivedAt), "yyyy-MM-dd") !== format(new Date(m.receivedAt), "yyyy-MM-dd");
              const journeyStarts = m.journeyName && m.journeyName !== prev?.journeyName;
              const mine = m.direction === "outgoing";
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="flex justify-center">
                      <span className="rounded-md bg-white/80 px-2 py-0.5 text-[11px] text-gray-500 shadow-sm">{format(new Date(m.receivedAt), "EEE, MMM d, yyyy")}</span>
                    </div>
                  )}
                  {journeyStarts && (
                    <div className="flex justify-center">
                      <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-600">
                        <GitBranch className="h-3 w-3" /> Journey · {m.journeyName}
                      </span>
                    </div>
                  )}
                  <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 shadow-sm ${mine ? "bg-[#d9fdd3] text-gray-900" : "bg-white text-gray-900"}`}>
                      {m.text && <p className="text-sm whitespace-pre-wrap break-words">{m.text}</p>}
                      {m.attachments.map(a => (
                        <p key={a.id} className="mt-1 inline-flex items-center gap-1 text-xs text-gray-600"><Paperclip className="h-3 w-3" />{a.name}</p>
                      ))}
                      <p className="mt-0.5 text-right text-[10px] text-gray-500">{format(new Date(m.receivedAt), "h:mm a")}</p>
                    </div>
                  </div>
                </Fragment>
              );
            })}
            <div ref={endRef} />
          </>
        )}
      </div>
    </>
  );
}
