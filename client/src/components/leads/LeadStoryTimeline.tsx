import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { Facebook, Globe, Instagram, Loader2, MessageCircle, Phone, RefreshCw, Sparkles, UserCheck, Users } from "lucide-react";
import type { LeadStory, LeadTimelineResponse, TimelineChannel, TimelineEvent } from "@shared/leadTimeline";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

const CHANNEL_LOOK: Record<TimelineChannel, { label: string; icon: typeof Globe; className: string }> = {
  website: { label: "Website", icon: Globe, className: "bg-purple-50 text-purple-600" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, className: "bg-green-50 text-green-600" },
  call: { label: "AI call", icon: Phone, className: "bg-blue-50 text-blue-600" },
  instagram: { label: "Instagram", icon: Instagram, className: "bg-pink-50 text-pink-600" },
  facebook: { label: "Facebook", icon: Facebook, className: "bg-blue-50 text-blue-700" },
  team: { label: "Team", icon: Users, className: "bg-gray-100 text-gray-600" },
};

const timelineKey = (channel: string, id: string) => ["/api/leads/timeline", channel, id] as const;

/**
 * The lead's story across channels: the AI "story so far" for the counsellor and every
 * touchpoint (website chat, WhatsApp, AI calls, DMs, CRM syncs), oldest first. The story is
 * written on first open and rewritten when the person has done something new since.
 */
export function LeadStoryTimeline({ channel, id, onOpenConversation, onOpenCall }: {
  channel: "website" | "whatsapp";
  id: string;
  onOpenConversation?: (conversationId: string) => void;
  onOpenCall?: (callId: string) => void;
}) {
  const [, setLocation] = useLocation();
  const openCall = onOpenCall ?? ((callId: string) => setLocation(`/admin/calling/calls/${callId}`));
  const key = timelineKey(channel, id);
  const timeline = useQuery<LeadTimelineResponse>({
    queryKey: key,
    queryFn: () => apiRequest<LeadTimelineResponse>("GET", `/api/leads/timeline?channel=${channel}&id=${encodeURIComponent(id)}`),
    staleTime: 30_000,
  });
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

  if (timeline.isLoading) {
    return <p className="mt-6 text-xs text-gray-500"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Loading this lead's story…</p>;
  }
  if (timeline.isError || !timeline.data) return null;
  const { events, story } = timeline.data;
  if (!events.length) return null;

  return (
    <div className="mt-6 space-y-5" data-testid="lead-story-timeline">
      <StoryCard story={story} writing={write.isPending} failed={write.isError} stale={status === "stale" && !write.isPending} onRefresh={() => write.mutate()} />
      <section>
        <h3 className="mb-3 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-purple-600">
          <Sparkles className="h-3.5 w-3.5" /> Across channels
        </h3>
        <ol className="space-y-3">
          {events.map((e) => <EventRow key={e.id} event={e} onOpenConversation={onOpenConversation} onOpenCall={openCall} />)}
        </ol>
      </section>
    </div>
  );
}

function StoryCard({ story, writing, failed, stale, onRefresh }: { story: LeadStory | null; writing: boolean; failed: boolean; stale: boolean; onRefresh: () => void }) {
  if (!story && !writing) {
    return failed ? <p className="text-xs text-gray-500">The AI couldn't write a summary just now. <button type="button" className="underline" onClick={onRefresh}>Try again</button></p> : null;
  }
  return (
    <section className="rounded-xl border border-purple-100 bg-purple-50/40 p-4" data-testid="lead-story">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-purple-700"><Sparkles className="h-3.5 w-3.5" /> Story so far</h3>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          {writing ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Writing…</span>
            : story ? <span>{stale ? "New activity since · " : ""}Updated {formatDistanceToNow(new Date(story.generatedAt), { addSuffix: true })}</span> : null}
          {!writing && story && (
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onRefresh} title="Rewrite with the latest activity" data-testid="button-refresh-story">
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {story ? (
        <>
          <p className="text-[14px] leading-relaxed text-gray-800">{story.summary}</p>
          {(story.course || story.budget) && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
              {story.course && <span className="rounded-full bg-white px-2 py-0.5 text-gray-700 ring-1 ring-gray-200">Course: {story.course}</span>}
              {story.budget && <span className="rounded-full bg-white px-2 py-0.5 text-gray-700 ring-1 ring-gray-200">Budget: {story.budget}</span>}
            </div>
          )}
          {story.questions.length > 0 && <p className="mt-2 text-[13px] text-gray-700"><span className="font-medium">Asked about:</span> {story.questions.join(" · ")}</p>}
          {story.booked && <p className="mt-1 text-[13px] text-gray-700"><span className="font-medium">Booked / sent:</span> {story.booked}</p>}
          {story.nextStep && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
              <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> <span><span className="font-semibold">Next step:</span> {story.nextStep}</span>
            </p>
          )}
        </>
      ) : (
        <p className="text-[13px] text-gray-500">Reading everything this person did across channels…</p>
      )}
    </section>
  );
}

function EventRow({ event: e, onOpenConversation, onOpenCall }: { event: TimelineEvent; onOpenConversation?: (id: string) => void; onOpenCall?: (id: string) => void }) {
  const look = CHANNEL_LOOK[e.channel];
  const Icon = look.icon;
  const open = e.link?.type === "conversation" && onOpenConversation ? () => onOpenConversation(e.link!.id)
    : e.link?.type === "call" && onOpenCall ? () => onOpenCall(e.link!.id) : undefined;
  const body = (
    <>
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${look.className}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-[14px] font-semibold ${e.tone === "bad" ? "text-red-700" : "text-gray-900"}`}>{e.title}</span>
          <span className="text-[12px] text-gray-400">{format(new Date(e.at), "d MMM, h:mm a")}</span>
        </span>
        {e.detail && <span className="mt-0.5 block text-[13px] leading-snug text-gray-600">{e.detail}</span>}
      </span>
    </>
  );
  return (
    <li data-testid={`timeline-event-${e.channel}`}>
      {open ? (
        <button type="button" onClick={open} className="-mx-2 flex w-[calc(100%+1rem)] gap-3 rounded-lg px-2 py-1 text-left hover:bg-gray-50">{body}</button>
      ) : (
        <div className="flex gap-3">{body}</div>
      )}
    </li>
  );
}
