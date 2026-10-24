/**
 * One person's story across channels, shown on the lead: website chats, WhatsApp, AI calls,
 * Instagram / Facebook DMs and what the team did (CRM syncs, calls they asked for), newest last,
 * plus an AI-written summary for the counsellor. See server/services/leadTimelineService.ts.
 */
export type TimelineChannel = "website" | "whatsapp" | "call" | "instagram" | "facebook" | "team";

export interface TimelineEvent {
  id: string;
  at: string;
  channel: TimelineChannel;
  title: string;
  detail: string | null;
  /** good = moved forward (interested, replied, synced), bad = a no / failure. */
  tone: "good" | "bad" | null;
  /** Where clicking the event goes in the portal. */
  link: { type: "conversation" | "call" | "whatsapp"; id: string } | null;
}

export interface LeadStory {
  /** 2–4 plain sentences for the counsellor. */
  summary: string;
  course: string | null;
  budget: string | null;
  questions: string[];
  /** Anything booked or promised ("Counselling Tue 5 PM", "Brochure sent"). */
  booked: string | null;
  nextStep: string | null;
  generatedAt: string;
}

export interface LeadTimelineResponse {
  events: TimelineEvent[];
  story: LeadStory | null;
  /** ready = up to date; stale = new activity since it was written; none = not written yet;
   *  unavailable = no AI key or nothing to summarise. */
  storyStatus: "ready" | "stale" | "none" | "unavailable";
}
