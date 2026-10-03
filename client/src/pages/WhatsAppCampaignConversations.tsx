import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MessageCircle, Search, Hand, BotOff, Mail, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CampaignReplyList,
  CampaignReplyThread,
  NoThreadSelected,
  campaignStatusLabel,
  type ReplyListItem,
} from "@/components/whatsapp/CampaignConversationsPanel";
import type { ReplyClassification } from "@shared/schema";

const PAGE_SIZE = 50;
const INTERESTED = "__interested__";
const UNCLASSIFIED = "__unclassified__";

interface CampaignSummary {
  id: string; name: string; status: string;
  totalRecipients: number; repliedCount: number;
  replyClassifications?: ReplyClassification[] | null;
}
interface RepliesResponse {
  items: ReplyListItem[];
  counts: { total: number; matching: number; needsHuman: number; aiPaused: number; unread: number };
  limit: number;
  offset: number;
}

function initialParam(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name); } catch { return null; }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Campaign replies: every customer who answered a campaign, with search, filters and takeover. */
export default function WhatsAppCampaignConversations() {
  const [campaignId, setCampaignId] = useState<string>(() => initialParam("campaign") || "all");
  const [selectedId, setSelectedId] = useState<string | null>(() => initialParam("recipient"));
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState<string>("all");
  const [needsHuman, setNeedsHuman] = useState(() => initialParam("filter") === "needs-human");
  const [aiPaused, setAiPaused] = useState(false);
  const [unread, setUnread] = useState(false);
  const [who, setWho] = useState<"replied" | "everyone">("replied");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const debouncedSearch = useDebounced(search.trim(), 300);

  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery<CampaignSummary[]>({
    queryKey: ["/api/whatsapp/campaigns"],
    refetchOnMount: "always",
  });

  // Reset paging whenever the filters change.
  useEffect(() => { setLimit(PAGE_SIZE); }, [campaignId, debouncedSearch, outcome, needsHuman, aiPaused, unread, who]);
  // An outcome key belongs to one campaign; switching campaign drops it (Interested / No outcome stay).
  useEffect(() => {
    if (outcome !== "all" && outcome !== INTERESTED && outcome !== UNCLASSIFIED) setOutcome("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (campaignId !== "all") p.set("campaignId", campaignId);
    if (debouncedSearch) p.set("search", debouncedSearch);
    if (outcome !== "all") p.set("outcome", outcome);
    if (needsHuman) p.set("needsHuman", "1");
    if (aiPaused) p.set("aiPaused", "1");
    if (unread) p.set("unread", "1");
    if (who === "everyone") p.set("replied", "0");
    p.set("limit", String(limit));
    return p.toString();
  }, [campaignId, debouncedSearch, outcome, needsHuman, aiPaused, unread, who, limit]);

  const { data, isLoading, isFetching } = useQuery<RepliesResponse>({
    queryKey: ["/api/whatsapp/campaign-replies", params],
    queryFn: () => apiRequest<RepliesResponse>("GET", `/api/whatsapp/campaign-replies?${params}`),
    refetchInterval: (q) => (q.state.error ? false : 10000),
    refetchOnMount: "always",
    placeholderData: (prev) => prev,
  });
  const items = data?.items ?? [];
  const counts = data?.counts;

  const selectedCampaign = campaigns.find(c => c.id === campaignId);
  const campaignOutcomes = Array.isArray(selectedCampaign?.replyClassifications) ? selectedCampaign!.replyClassifications! : [];
  const filtersActive = !!debouncedSearch || outcome !== "all" || needsHuman || aiPaused || unread || who !== "replied";

  const refreshList = () => queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-replies"] });
  const clearFilters = () => {
    setSearch(""); setOutcome("all"); setNeedsHuman(false); setAiPaused(false); setUnread(false); setWho("replied");
  };

  if (campaignsLoading) {
    return <div className="p-6 text-center text-gray-500">Loading campaigns…</div>;
  }

  if (campaigns.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center">
        <MessageCircle className="h-12 w-12 text-gray-300 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-700">No campaigns yet</h2>
        <p className="text-sm text-gray-500 mt-1">Send a campaign — customers' replies will appear here.</p>
      </div>
    );
  }

  const chip = (active: boolean, onClick: () => void, icon: React.ReactNode, label: string, count?: number, testId?: string) => (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-full text-xs font-medium border transition-colors ${
        active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
      }`}
      data-testid={testId}
      aria-pressed={active}
    >
      {icon}{label}
      {count !== undefined && count > 0 && <span className={active ? "text-white/80" : "text-gray-400"}>{count}</span>}
    </button>
  );

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Campaign replies</h1>
        <p className="text-sm text-gray-500">Read what customers said, answer them yourself, or let the AI carry on.</p>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-col lg:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone or message…"
              className="pl-9 h-9"
              data-testid="input-search-replies"
            />
          </div>
          <Select value={campaignId} onValueChange={(v) => { setCampaignId(v); setSelectedId(null); }}>
            <SelectTrigger className="h-9 w-full lg:w-64" data-testid="select-reply-campaign">
              <SelectValue placeholder="All campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} <span className="text-gray-400">· {campaignStatusLabel(c.status)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger className="h-9 w-full lg:w-48" data-testid="select-reply-outcome">
              <SelectValue placeholder="All outcomes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              <SelectItem value={INTERESTED}>Interested</SelectItem>
              <SelectItem value={UNCLASSIFIED}>No outcome yet</SelectItem>
              {campaignOutcomes.map(c => (
                <SelectItem key={c.key} value={c.key}>{c.label || c.key}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chip(needsHuman, () => setNeedsHuman(v => !v), <Hand className="h-3.5 w-3.5" />, "Needs human", counts?.needsHuman, "chip-needs-human")}
          {chip(aiPaused, () => setAiPaused(v => !v), <BotOff className="h-3.5 w-3.5" />, "AI paused", counts?.aiPaused, "chip-ai-paused")}
          {chip(unread, () => setUnread(v => !v), <Mail className="h-3.5 w-3.5" />, "Unread", counts?.unread, "chip-unread")}
          <Select value={who} onValueChange={(v) => setWho(v as "replied" | "everyone")}>
            <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs rounded-full" data-testid="select-reply-who">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="replied">Only who replied</SelectItem>
              <SelectItem value="everyone">Everyone messaged</SelectItem>
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-gray-500" onClick={clearFilters}>
              <X className="h-3.5 w-3.5 mr-1" /> Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* List + thread: side by side on wide screens, one at a time on phones */}
      <Card className="overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-300px)] lg:min-h-[520px]">
          <div className={`${selectedId ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-72 xl:w-96 lg:shrink-0 lg:border-r min-h-0`}>
            <div className="px-3 py-2 border-b bg-emerald-700 text-white text-sm font-semibold flex items-center justify-between shrink-0">
              <span className="flex items-center gap-2"><MessageCircle className="h-4 w-4" /> Campaign replies</span>
              <span className="bg-white/20 text-xs px-2 py-0.5 rounded-full">{counts?.matching ?? 0}</span>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[70vh] lg:max-h-none">
              <CampaignReplyList
                items={items}
                isLoading={isLoading}
                selectedId={selectedId}
                onSelect={(item) => setSelectedId(item.id)}
                showCampaign={campaignId === "all"}
                emptyText={filtersActive ? "No replies match these filters." : "No replies yet — they'll show up here as customers answer your campaigns."}
              />
              {items.length < (counts?.matching ?? 0) && (
                <div className="p-3 text-center border-t">
                  <Button variant="outline" size="sm" onClick={() => setLimit(l => l + PAGE_SIZE)} disabled={isFetching}>
                    Show more ({(counts?.matching ?? 0) - items.length} left)
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div className={`${selectedId ? "flex" : "hidden lg:flex"} flex-1 min-w-0 min-h-[70vh] lg:min-h-0`}>
            {selectedId ? (
              <CampaignReplyThread
                key={selectedId}
                recipientId={selectedId}
                onBack={() => setSelectedId(null)}
                onChanged={refreshList}
              />
            ) : (
              <NoThreadSelected />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
