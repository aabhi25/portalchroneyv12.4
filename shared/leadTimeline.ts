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
  /** Short heading shown next to the tag ("AI call"); a sub-line's whole text. Default: title. */
  label?: string | null;
  /** The result as a small coloured tag ("Interested", "No answer", "Call back planned"). */
  tag?: { label: string; tone: "good" | "bad" | "wait" | "muted" } | null;
  /** A short fact next to the time ("1m 48s"), or for an upcoming call why it's planned. */
  meta?: string | null;
  /** Shown as a line under this event instead of a row of its own (a call's follow-up, the CRM sync). */
  parentId?: string | null;
  /** Hasn't happened yet (a call waiting for its time): shown under "Coming up". */
  upcoming?: boolean;
  /** Didn't connect: one quiet line, no text under it. */
  quiet?: boolean;
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

export interface LeadScoreView {
  score: number;
  temperature: "hot" | "warm" | "cold";
  fit: "good" | "partial" | "unknown";
  reasons: { up: string[]; down: string[]; fit: string[] };
}

export interface LeadTimelineResponse {
  events: TimelineEvent[];
  /** Rescored when the lead is opened (leadScoringService). */
  score: LeadScoreView | null;
  story: LeadStory | null;
  /** ready = up to date; stale = new activity since it was written; none = not written yet;
   *  unavailable = no AI key or nothing to summarise. */
  storyStatus: "ready" | "stale" | "none" | "unavailable";
}
