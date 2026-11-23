import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, formatDistanceToNow, isToday, isTomorrow, isYesterday } from "date-fns";
import { ArrowRight, CalendarClock, ChevronRight, Loader2, MessageCircle, RefreshCw, Send, Sparkles, UserCheck, UserRound } from "lucide-react";
import type { LeadStory, LeadTimelineResponse, TimelineChannel, TimelineEvent } from "@shared/leadTimeline";
import { FIT_LABEL, ScoreReasons, TEMPERATURE_LOOK } from "./UnifiedLeadParts";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const CHANNEL_DOT: Record<TimelineChannel, string> = {
  website: "bg-purple-500",
  whatsapp: "bg-green-500",
  call: "bg-blue-500",
  instagram: "bg-pink-500",
  facebook: "bg-blue-700",
  team: "bg-gray-400",
};
const FILTERS: Array<{ key: TimelineChannel; label: string }> = [
  { key: "call", label: "Calls" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "website", label: "Website" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
];
const TAG_LOOK: Record<NonNullable<TimelineEvent["tag"]>["tone"], string> = {
  good: "bg-emerald-50 text-emerald-700",
  bad: "bg-red-50 text-red-700",
  wait: "bg-amber-50 text-amber-800",
  muted: "bg-gray-100 text-gray-600",
};
/** Rows shown before "Show earlier". */
const FIRST_ROWS = 6;

const timelineKey = (channel: string, id: string) => ["/api/leads/timeline", channel, id] as const;

/** The lead's timeline + score + story (one request, shared by the header pill and the panel). */
export function useLeadTimeline(channel: "website" | "whatsapp", id: string, enabled = true) {
  return useQuery<LeadTimelineResponse>({
    queryKey: timelineKey(channel, id),
    queryFn: () => apiRequest<LeadTimelineResponse>("GET", `/api/leads/timeline?channel=${channel}&id=${encodeURIComponent(id)}`),
    staleTime: 30_000,
    enabled,
    // Follow a call while it rings or is about to start.
    refetchInterval: (q) => ((q.state.data?.events || []).some((e) => e.channel === "call" && e.tag?.tone === "wait"
      && (!e.upcoming || new Date(e.at).getTime() < Date.now() + 5 * 60_000)) ? 5000 : false),
  });
}

/** After "Call with AI": show the new call on the timeline. */
export function refreshLeadTimelines() {
  queryClient.invalidateQueries({ queryKey: ["/api/leads/timeline"] });
}

/** "Warm · 60" for the panel header; tap for why. */
export function LeadScorePill({ channel, id }: { channel: "website" | "whatsapp"; id: string }) {
  const score = useLeadTimeline(channel, id).data?.score;
  if (!score) return null;
  const look = TEMPERATURE_LOOK[score.temperature];
  const Icon = look.icon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-semibold ring-1 ${look.className}`} data-testid="lead-score" title="Why this score">
          <Icon className="h-3.5 w-3.5" />{look.label} · {score.score}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="mb-2 text-[12px] font-medium text-gray-500">Lead score · {FIT_LABEL[score.fit]}</p>
        <ScoreReasons score={score} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The lead's story across channels: the AI summary for the counsellor, what's coming up (a
 * callback the AI will make) and the activity, newest first, a line per touchpoint with its
 * follow-ups underneath. The summary is written on first open and rewritten when the person has
 * done something new since.
 */
export function LeadStoryTimeline({ channel, id, onOpenConversation, onOpenCall, onOpenWhatsapp }: {
  channel: "website" | "whatsapp";
  id: string;
  onOpenConversation?: (conversationId: string) => void;
  onOpenCall?: (callId: string) => void;
  /** Open a WhatsApp chat (id: one of its WhatsApp message rows). */
  onOpenWhatsapp?: (whatsappLeadId: string) => void;
}) {
  const [, setLocation] = useLocation();
  const openCall = onOpenCall ?? ((callId: string) => setLocation(`/admin/calling/calls/${callId}`));
  const key = timelineKey(channel, id);
  const timeline = useLeadTimeline(channel, id);
  const write = useMutation({
    mutationFn: () => apiRequest<{ story: LeadStory | null }>("POST", "/api/leads/story", { channel, id }),
    onSuccess: (r) => {
      queryClient.setQueryData<LeadTimelineResponse>(key, (old) => old ? { ...old, story: r.story ?? old.story, storyStatus: r.story ? "ready" : old.story ? old.storyStatus : "unavailable" } : old);
    },
  });
  // Write the story once per open when it's missing or out of date.
  const asked = useRef<string | null>(null);
  const status = timeline.data?.storyStatus;
  useEffect(() => {
    if ((status === "none" || status === "stale") && asked.current !== `${channel}:${id}` && !write.isPending) {
      asked.current = `${channel}:${id}`;
      write.mutate();
    }
  }, [status, channel, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (e: TimelineEvent) => e.link?.type === "conversation" && onOpenConversation ? () => onOpenConversation(e.link!.id)
    : e.link?.type === "call" ? () => openCall(e.link!.id)
    : e.link?.type === "whatsapp" && onOpenWhatsapp ? () => onOpenWhatsapp(e.link!.id) : undefined;

  if (timeline.isLoading) {
    return <p className="mt-6 text-xs text-gray-500"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Loading this lead's story…</p>;
  }
  if (timeline.isError || !timeline.data) return null;
  const { events, story } = timeline.data;
  if (!events.length) return null;
  const upcoming = events.filter((e) => e.upcoming);

  return (
    <div className="mt-5 space-y-3" data-testid="lead-story-timeline">
      <StoryCard story={story} writing={write.isPending} failed={write.isError} stale={status === "stale" && !write.isPending} onRefresh={() => write.mutate()} />
      {upcoming.map((e) => <ComingUp key={e.id} event={e} onOpen={open(e)} />)}
      <Activity events={events} open={open} />
    </div>
  );
}

function StoryCard({ story, writing, failed, stale, onRefresh }: { story: LeadStory | null; writing: boolean; failed: boolean; stale: boolean; onRefresh: () => void }) {
  if (!story && !writing) {
    return failed ? <p className="text-xs text-gray-500">The AI couldn't write a summary just now. <button type="button" className="underline" onClick={onRefresh}>Try again</button></p> : null;
  }
  return (
    <section className="rounded-xl bg-gray-50 px-4 py-3.5" data-testid="lead-story">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-gray-500"><Sparkles className="h-3.5 w-3.5 text-purple-500" /> Summary</h3>
        <div className="flex items-center gap-1 text-[11px] text-gray-400">
          {writing ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Writing…</span>
            : story ? <span>{stale ? "New activity since · " : ""}Updated {formatDistanceToNow(new Date(story.generatedAt), { addSuffix: true })}</span> : null}
          {!writing && story && (
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-gray-400" onClick={onRefresh} title="Rewrite with the latest activity" data-testid="button-refresh-story">
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {story ? (
        <>
          <p className="text-[14px] leading-relaxed text-gray-800">{story.summary}</p>
          {(story.course || story.budget || story.questions.length > 0 || story.booked) && (
            <dl className="mt-2.5 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
              {story.course && <><dt className="text-gray-400">Interested in</dt><dd className="text-gray-700">{story.course}</dd></>}
              {story.budget && <><dt className="text-gray-400">Budget</dt><dd className="text-gray-700">{story.budget}</dd></>}
              {story.questions.length > 0 && <><dt className="text-gray-400">Asked about</dt><dd className="text-gray-700">{story.questions.join(" · ")}</dd></>}
              {story.booked && <><dt className="text-gray-400">Booked / sent</dt><dd className="text-gray-700">{story.booked}</dd></>}
            </dl>
          )}
          {story.nextStep && (
            <p className="mt-2.5 flex items-start gap-1.5 text-[13px] font-medium text-emerald-700">
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>Next: {story.nextStep}</span>
            </p>
          )}
        </>
      ) : (
        <p className="text-[13px] text-gray-500">Reading everything this person did across channels…</p>
      )}
    </section>
  );
}

/** "today, 2:10 PM" / "tomorrow, 2:10 PM" / "24 Nov, 2:10 PM" ("shortly" once the time has come). */
function whenLabel(at: string): string {
  const d = new Date(at);
  if (d.getTime() <= Date.now()) return "shortly";
  const time = format(d, "h:mm a");
  return isToday(d) ? `today, ${time}` : isTomorrow(d) ? `tomorrow, ${time}` : `${format(d, "d MMM")}, ${time}`;
}

function ComingUp({ event: e, onOpen }: { event: TimelineEvent; onOpen?: () => void }) {
  const body = (
    <>
      <CalendarClock className="h-4 w-4 shrink-0 text-blue-600" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-gray-900">{e.label || e.title} {whenLabel(e.at)}</span>
        {e.meta && <span className="block text-[12px] text-gray-500">{e.meta}</span>}
      </span>
      {onOpen && <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />}
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/50 px-3.5 py-2.5 text-left";
  return onOpen
    ? <button type="button" onClick={onOpen} className={`${cls} hover:bg-blue-50`} data-testid="lead-coming-up">{body}</button>
    : <div className={cls} data-testid="lead-coming-up">{body}</div>;
}

function dayLabel(d: Date): string {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, d.getFullYear() === new Date().getFullYear() ? "d MMM" : "d MMM yyyy");
}

function Activity({ events, open }: { events: TimelineEvent[]; open: (e: TimelineEvent) => (() => void) | undefined }) {
  const [filter, setFilter] = useState<TimelineChannel | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const { rows, children, filters } = useMemo(() => {
    const children = new Map<string, TimelineEvent[]>();
    for (const e of events) if (e.parentId && !e.upcoming) children.set(e.parentId, [...(children.get(e.parentId) || []), e]);
    const rows = events.filter((e) => !e.upcoming && !e.parentId).reverse();
    const present = new Set(rows.map((e) => e.channel));
    return { rows, children, filters: FILTERS.filter((f) => present.has(f.key)) };
  }, [events]);
  const shown = filter === "all" ? rows : rows.filter((e) => e.channel === filter);
  const visible = showAll ? shown : shown.slice(0, FIRST_ROWS);
  const days: Array<{ label: string; items: TimelineEvent[] }> = [];
  for (const e of visible) {
    const label = dayLabel(new Date(e.at));
    if (days[days.length - 1]?.label === label) days[days.length - 1].items.push(e);
    else days.push({ label, items: [e] });
  }

  return (
    <section className="pt-2" data-testid="lead-activity">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-gray-900">Activity</h3>
        {filters.length > 1 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Show activity from">
            {[{ key: "all" as const, label: "All" }, ...filters].map((f) => (
              <button key={f.key} type="button" onClick={() => { setFilter(f.key); setShowAll(false); }} aria-pressed={filter === f.key}
                className={`rounded-full px-2.5 py-0.5 text-[12px] ${filter === f.key ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"}`}
                data-testid={`activity-filter-${f.key}`}>
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {days.map((day) => (
        <div key={day.label}>
          <p className="mb-1 mt-3 text-[11.5px] font-medium text-gray-400">{day.label}</p>
          <ol className="ml-[3px] border-l border-gray-200">
            {day.items.map((e) => <EventRow key={e.id} event={e} subs={children.get(e.id) || []} onOpen={open(e)} />)}
          </ol>
        </div>
      ))}
      {shown.length > FIRST_ROWS && (
        <div className="mt-2 text-center">
          <Button type="button" variant="ghost" size="sm" className="h-7 text-[12.5px] text-gray-600" onClick={() => setShowAll((v) => !v)} data-testid="button-activity-more">
            {showAll ? "Show less" : `Show ${shown.length - FIRST_ROWS} earlier`}
          </Button>
        </div>
      )}
    </section>
  );
}

function SubIcon({ e }: { e: TimelineEvent }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (e.channel === "whatsapp") return <MessageCircle className={`${cls} text-green-600`} />;
  if (e.id.startsWith("callreq:")) return <UserRound className={`${cls} text-gray-400`} />;
  if (e.id.startsWith("lead:")) return <UserCheck className={`${cls} text-gray-400`} />;
  return <Send className={`${cls} text-gray-400`} />;
}

function EventRow({ event: e, subs, onOpen }: { event: TimelineEvent; subs: TimelineEvent[]; onOpen?: () => void }) {
  const right = [format(new Date(e.at), "h:mm a"), e.meta].filter(Boolean).join(" · ");
  const body = (
    <>
      <span className="flex items-baseline gap-2">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={`text-[14px] ${e.quiet ? "text-gray-500" : "font-medium text-gray-900"}`}>{e.label || e.title}</span>
          {e.tag && <span className={`rounded-full px-2 py-px text-[11.5px] font-medium ${TAG_LOOK[e.tag.tone]}`}>{e.tag.label}</span>}
        </span>
        <span className="shrink-0 text-[12px] text-gray-400">{right}</span>
      </span>
      {e.detail && !e.quiet && <span className={`mt-0.5 line-clamp-2 text-[13px] leading-snug ${e.tone === "bad" && !e.tag ? "text-red-700" : "text-gray-600"}`}>{e.detail}</span>}
      {subs.map((s) => (
        <span key={s.id} className={`mt-1 flex items-center gap-1.5 text-[12px] ${s.tone === "bad" ? "text-red-700" : "text-gray-500"}`} data-testid="timeline-sub">
          <SubIcon e={s} /><span className="truncate">{s.label || s.title}</span>
        </span>
      ))}
    </>
  );
  return (
    <li className="relative py-1 pl-4" data-testid={`timeline-event-${e.channel}`}>
      <span className={`absolute -left-[4.5px] top-[13px] h-2 w-2 rounded-full ring-2 ring-white ${e.quiet ? "bg-gray-300" : CHANNEL_DOT[e.channel]}`} aria-hidden="true" />
      {onOpen ? (
        <button type="button" onClick={onOpen} className="-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left hover:bg-gray-50">{body}</button>
      ) : (
        <div className="py-1">{body}</div>
      )}
    </li>
  );
}
