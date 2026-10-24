/**
 * A lead's story across channels (shared/leadTimeline.ts): website chats, WhatsApp, AI calls,
 * Instagram / Facebook DMs and what the team did, newest last, plus the AI "story so far" for
 * the counsellor (cached in lead_stories, rewritten when something new happens).
 *
 * Who counts as the same person follows the Leads page (unifiedLeadsService): a website lead and a
 * WhatsApp number are one person when the number is confirmed — hand-off code, OTP, or an answered
 * AI call. Instagram / Facebook leads join when they gave that same number or the lead's email.
 * Every query is filtered by business_account_id.
 */
import { and, asc, desc, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  aiCalls, businessAccounts, conversations, facebookLeads, instagramLeads, leadConversations, leadStories, leads, messages,
  users, whatsappHandoffs, whatsappLeads,
} from "@shared/schema";
import { CALL_OUTCOME_LABEL, CALL_STATUS_LABEL, type CallOutcome, type CallStatus } from "@shared/aiCalling";
import type { LeadStory, LeadTimelineResponse, TimelineEvent } from "@shared/leadTimeline";
import { key10, websitePersonKeySql } from "./unifiedLeadsService";
import { maskPhonesInText } from "../lib/leadAccess";
import { readableChatText } from "./whatsappInteractiveText";

export type TimelineAnchor = { channel: "website" | "whatsapp"; id: string };

interface Person {
  accountId: string;
  leadKey: string;
  websiteLeads: Array<typeof leads.$inferSelect>;
  /** Confirmed phone (last 10 digits) shared by the person's channels; null = website only. */
  phoneKey: string | null;
  emails: string[];
}

const WA_SESSION_GAP_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 120;
const clip = (s: string | null | undefined, n: number) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

async function resolvePerson(accountId: string, anchor: TimelineAnchor): Promise<Person | null> {
  if (anchor.channel === "website") {
    const res = await db.execute(sql`SELECT ${websitePersonKeySql()} AS k FROM leads l WHERE l.business_account_id = ${accountId} AND l.id = ${anchor.id}`);
    const [lead] = await db.select().from(leads).where(and(eq(leads.businessAccountId, accountId), eq(leads.id, anchor.id))).limit(1);
    if (!lead) return null;
    const phoneKey = ((res.rows[0] as any)?.k as string | null) || null;
    return { accountId, leadKey: `website:${lead.id}`, websiteLeads: [lead], phoneKey, emails: lead.email ? [lead.email.toLowerCase()] : [] };
  }
  const [wa] = await db.select({ phone: whatsappLeads.senderPhone }).from(whatsappLeads)
    .where(and(eq(whatsappLeads.businessAccountId, accountId), eq(whatsappLeads.id, anchor.id))).limit(1);
  if (!wa?.phone) return null;
  const phoneKey = wa.phone.replace(/\D/g, "").slice(-10);
  // Website leads that are confirmed to be this number.
  const linked = await db.execute(sql`SELECT l.id FROM leads l WHERE l.business_account_id = ${accountId}
    AND ${key10(sql`l.phone`)} = ${phoneKey} AND ${websitePersonKeySql()} = ${phoneKey}`);
  const ids = (linked.rows as { id: string }[]).map((r) => r.id);
  const websiteLeads = ids.length ? await db.select().from(leads).where(and(eq(leads.businessAccountId, accountId), inArray(leads.id, ids))) : [];
  return {
    accountId, leadKey: `whatsapp:${anchor.id}`, websiteLeads, phoneKey,
    emails: websiteLeads.map((l) => l.email?.toLowerCase()).filter((e): e is string => !!e),
  };
}

async function websiteEvents(p: Person, out: TimelineEvent[]): Promise<void> {
  const ids = p.websiteLeads.map((l) => l.id);
  for (const l of p.websiteLeads) {
    const gave = [l.name && "name", l.phone && "phone number", l.email && "email"].filter(Boolean).join(", ");
    out.push({ id: `lead:${l.id}`, at: iso(l.createdAt)!, channel: "website", title: "Shared their details", detail: gave ? `Gave their ${gave} in the website chat.` : null, tone: "good", link: l.conversationId ? { type: "conversation", id: l.conversationId } : null });
    if (l.enquiryCount > 1 && l.lastEnquiryAt) {
      out.push({ id: `reenquiry:${l.id}`, at: iso(l.lastEnquiryAt)!, channel: "website", title: "Came back", detail: `Enquiry ${l.enquiryCount} from this person.`, tone: "good", link: l.conversationId ? { type: "conversation", id: l.conversationId } : null });
    }
  }
  if (!ids.length) return;
  const linkRows = await db.select({ conversationId: leadConversations.conversationId }).from(leadConversations)
    .where(and(eq(leadConversations.businessAccountId, p.accountId), inArray(leadConversations.leadId, ids)));
  const convIds = Array.from(new Set([...p.websiteLeads.map((l) => l.conversationId), ...linkRows.map((r) => r.conversationId)].filter((x): x is string => !!x)));
  if (!convIds.length) return;
  // A call's own conversation shows as the call, not as a chat.
  const callConvs = new Set((await db.select({ id: aiCalls.conversationId }).from(aiCalls)
    .where(and(eq(aiCalls.businessAccountId, p.accountId), inArray(aiCalls.conversationId, convIds)))).map((r) => r.id));
  const convs = await db.select().from(conversations).where(and(eq(conversations.businessAccountId, p.accountId), inArray(conversations.id, convIds)));
  for (const c of convs) {
    if (callConvs.has(c.id)) continue;
    const firstUser = await db.select({ content: messages.content }).from(messages)
      .where(and(eq(messages.conversationId, c.id), eq(messages.role, "user"))).orderBy(asc(messages.createdAt)).limit(1);
    const detail = c.summary ? clip(c.summary, 220) : firstUser[0]?.content ? `Asked: “${clip(firstUser[0].content, 140)}”` : null;
    out.push({ id: `conv:${c.id}`, at: iso(c.createdAt)!, channel: "website", title: "Website chat", detail, tone: null, link: { type: "conversation", id: c.id } });
  }
  // Moved from the website chat to WhatsApp with a hand-off code.
  const handoffs = await db.select({ id: whatsappHandoffs.id, usedAt: whatsappHandoffs.usedAt }).from(whatsappHandoffs)
    .where(and(eq(whatsappHandoffs.businessAccountId, p.accountId), isNotNull(whatsappHandoffs.usedAt),
      or(inArray(whatsappHandoffs.websiteLeadId, ids), inArray(whatsappHandoffs.conversationId, convIds))));
  for (const h of handoffs) {
    out.push({ id: `handoff:${h.id}`, at: iso(h.usedAt)!, channel: "whatsapp", title: "Moved to WhatsApp", detail: "Continued the website chat on WhatsApp.", tone: "good", link: null });
  }
}

async function callEvents(p: Person, out: TimelineEvent[]): Promise<void> {
  const ids = p.websiteLeads.map((l) => l.id);
  const match: SQL[] = [];
  if (ids.length) match.push(inArray(aiCalls.leadId, ids));
  if (p.phoneKey) match.push(sql`${key10(sql`${aiCalls.phone}`)} = ${p.phoneKey}`);
  if (!match.length) return;
  const rows = await db.select({ call: aiCalls, requester: users.username }).from(aiCalls)
    .leftJoin(users, eq(users.id, aiCalls.requestedBy))
    .where(and(eq(aiCalls.businessAccountId, p.accountId), or(...match)))
    .orderBy(desc(aiCalls.createdAt)).limit(30);
  for (const { call: c, requester } of rows) {
    if (c.status === "cancelled" || c.status === "skipped") continue;
    const outcome = c.outcome ? CALL_OUTCOME_LABEL[c.outcome as CallOutcome] : null;
    const answered = !!c.answeredAt;
    const status = CALL_STATUS_LABEL[c.status as CallStatus] || c.status;
    const title = c.direction === "inbound" ? "Called you" : answered ? "AI call" : `AI call · ${status}`;
    const bits = [c.summary ? clip(c.summary, 240) : null, c.callbackAt ? `Asked to be called back ${new Date(c.callbackAt).toISOString()}` : null].filter(Boolean);
    const tone = c.outcome === "interested" || c.outcome === "callback_requested" ? "good"
      : c.outcome === "not_interested" || c.outcome === "do_not_call" || c.outcome === "wrong_number" ? "bad" : null;
    out.push({
      id: `call:${c.id}`, at: iso(c.startedAt || c.scheduledAt || c.createdAt)!, channel: "call",
      title: outcome ? `${title} · ${outcome}` : title, detail: bits.join(" ") || (answered ? null : "Not answered."), tone, link: { type: "call", id: c.id },
    });
    if (c.trigger === "manual") {
      out.push({ id: `callreq:${c.id}`, at: iso(c.createdAt)!, channel: "team", title: "Call requested", detail: requester ? `By ${requester}.` : null, tone: null, link: { type: "call", id: c.id } });
    }
    if (c.followUpStatus && c.followUpSentAt) {
      const steps = [c.followUpDeliveredAt || c.followUpStatus === "delivered" || c.followUpStatus === "read" ? "delivered" : null, c.followUpReadAt || c.followUpStatus === "read" ? "read" : null].filter(Boolean);
      out.push({
        id: `followup:${c.id}`, at: iso(c.followUpSentAt)!, channel: "whatsapp",
        title: c.followUpStatus === "failed" ? "WhatsApp follow-up failed" : "WhatsApp follow-up sent",
        detail: c.followUpStatus === "failed" ? clip(c.followUpError, 160) || null : `${c.followUpTemplate ? `“${c.followUpTemplate}”` : "After the AI call"}${steps.length ? ` · ${steps.join(", ")}` : ""}.`,
        tone: c.followUpStatus === "failed" ? "bad" : null, link: { type: "call", id: c.id },
      });
    } else if (c.followUpStatus === "failed") {
      out.push({ id: `followup:${c.id}`, at: iso(c.endedAt || c.createdAt)!, channel: "whatsapp", title: "WhatsApp follow-up failed", detail: clip(c.followUpError, 160) || null, tone: "bad", link: { type: "call", id: c.id } });
    }
  }
}

async function whatsappEvents(p: Person, out: TimelineEvent[], followUpTimes: number[]): Promise<void> {
  if (!p.phoneKey) return;
  const rows = await db.select({
    id: whatsappLeads.id, raw: whatsappLeads.rawMessage, direction: whatsappLeads.direction, at: whatsappLeads.receivedAt, extracted: whatsappLeads.extractedData,
  }).from(whatsappLeads)
    .where(and(eq(whatsappLeads.businessAccountId, p.accountId), sql`${key10(sql`${whatsappLeads.senderPhone}`)} = ${p.phoneKey}`))
    .orderBy(asc(whatsappLeads.receivedAt)).limit(400);
  // Chats are grouped like the WhatsApp page: a new chat after 24 h of quiet.
  let session: typeof rows = [];
  const flush = () => {
    if (!session.length) return;
    const incoming = session.filter((m) => m.direction === "incoming");
    const first = incoming[0];
    if (incoming.length) {
      const firstText = readableChatText(first.raw, new Map()) || "";
      const replies = incoming.length;
      out.push({
        id: `wa:${first.id}`, at: iso(first.at)!, channel: "whatsapp",
        title: "WhatsApp chat", detail: `${replies} message${replies === 1 ? "" : "s"} from them · first: “${clip(firstText, 140)}”`,
        tone: "good", link: { type: "whatsapp", id: first.id },
      });
    }
    session = [];
  };
  let last = 0;
  for (const m of rows) {
    const t = new Date(m.at as any).getTime();
    if (session.length && t - last >= WA_SESSION_GAP_MS) flush();
    session.push(m);
    last = t;
    // Templates the team / a campaign sent (an AI call's follow-up already shows with the call).
    const tplName = m.direction === "outgoing" ? ((m.extracted as any)?._template as string | undefined) || /^\[Template: (.+)\]$/.exec(m.raw || "")?.[1] : undefined;
    if (tplName && !followUpTimes.some((f) => Math.abs(f - t) < 3 * 60 * 1000)) {
      out.push({ id: `watpl:${m.id}`, at: iso(m.at)!, channel: "whatsapp", title: "WhatsApp message sent", detail: `Template “${tplName}”.`, tone: null, link: { type: "whatsapp", id: m.id } });
    }
  }
  flush();
}

async function socialEvents(p: Person, out: TimelineEvent[]): Promise<void> {
  if (!p.phoneKey && !p.emails.length) return;
  // They gave the same number (or email) in a DM.
  const matches = (col: SQL) => {
    const conds: SQL[] = [];
    if (p.phoneKey) conds.push(sql`right(regexp_replace(e.value, '\\D', '', 'g'), 10) = ${p.phoneKey}`);
    if (p.emails.length) conds.push(sql`lower(trim(e.value)) IN (${sql.join(p.emails.map((x) => sql`${x}`), sql`, `)})`);
    return sql`EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(${col}, '{}'::jsonb)) e WHERE ${sql.join(conds, sql` OR `)})`;
  };
  const ig = await db.select({ id: instagramLeads.id, at: instagramLeads.receivedAt, user: instagramLeads.senderUsername, status: instagramLeads.status }).from(instagramLeads)
    .where(and(eq(instagramLeads.businessAccountId, p.accountId), matches(sql`${instagramLeads.extractedData}`))).limit(20);
  for (const r of ig) out.push({ id: `ig:${r.id}`, at: iso(r.at)!, channel: "instagram", title: "Instagram DM", detail: r.user ? `As @${r.user}.` : null, tone: "good", link: null });
  const fb = await db.select({ id: facebookLeads.id, at: facebookLeads.receivedAt, name: facebookLeads.senderName }).from(facebookLeads)
    .where(and(eq(facebookLeads.businessAccountId, p.accountId), matches(sql`${facebookLeads.extractedData}`))).limit(20);
  for (const r of fb) out.push({ id: `fb:${r.id}`, at: iso(r.at)!, channel: "facebook", title: "Facebook message", detail: r.name ? `As ${r.name}.` : null, tone: "good", link: null });
}

function crmEvents(p: Person, out: TimelineEvent[]): void {
  const crms: Array<[string, "leadsquared" | "meritto" | "salesforce" | "customCrm"]> = [["LeadSquared", "leadsquared"], ["Meritto", "meritto"], ["Salesforce", "salesforce"], ["your CRM", "customCrm"]];
  for (const l of p.websiteLeads) {
    for (const [label, k] of crms) {
      const status = (l as any)[`${k}SyncStatus`] as string | null;
      const at = (l as any)[`${k}SyncedAt`] as Date | null;
      if (status === "synced" && at) out.push({ id: `crm:${k}:${l.id}`, at: iso(at)!, channel: "team", title: `Sent to ${label}`, detail: null, tone: "good", link: null });
      else if (status === "failed" || status === "permanently_failed" || status === "needs_attention") {
        out.push({ id: `crm:${k}:${l.id}`, at: iso(l.updatedAt)!, channel: "team", title: `${label} sync needs attention`, detail: clip((l as any)[`${k}SyncError`], 160) || null, tone: "bad", link: null });
      }
    }
  }
}

export async function buildLeadTimeline(accountId: string, anchor: TimelineAnchor): Promise<{ person: Person; events: TimelineEvent[] } | null> {
  const person = await resolvePerson(accountId, anchor);
  if (!person) return null;
  const events: TimelineEvent[] = [];
  await websiteEvents(person, events);
  await callEvents(person, events);
  const followUpTimes = events.filter((e) => e.id.startsWith("followup:")).map((e) => new Date(e.at).getTime());
  await whatsappEvents(person, events, followUpTimes);
  await socialEvents(person, events);
  crmEvents(person, events);
  const [account] = await db.select({ mask: businessAccounts.leadPhoneMaskingEnabled }).from(businessAccounts).where(eq(businessAccounts.id, accountId)).limit(1);
  const masked = account?.mask === "true";
  const seen = new Set<string>();
  const sorted = events
    .filter((e) => e.at && !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(-MAX_EVENTS)
    .map((e) => (masked ? { ...e, title: maskPhonesInText(e.title) || e.title, detail: maskPhonesInText(e.detail) } : e));
  return { person, events: sorted };
}

// ── AI story so far ─────────────────────────────────────────────────────────────

type StoryWriter = (input: { accountId: string; businessName: string | null; transcript: string }) => Promise<Omit<LeadStory, "generatedAt"> | null>;
let storyOverride: StoryWriter | null = null;
export function setStoryWriterForTesting(fn: StoryWriter | null): void { storyOverride = fn; }

export function sanitizeStory(raw: any): Omit<LeadStory, "generatedAt"> | null {
  const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() && !/^(null|none|n\/a|unknown|-)$/i.test(v.trim()) ? v.trim().slice(0, n) : null);
  const summary = text(raw?.summary, 700);
  if (!summary) return null;
  const questions = Array.isArray(raw?.questions) ? raw.questions.map((q: unknown) => text(q, 120)).filter((q: string | null): q is string => !!q).slice(0, 5) : [];
  return { summary, course: text(raw?.course, 80), budget: text(raw?.budget, 80), questions, booked: text(raw?.booked, 140), nextStep: text(raw?.nextStep, 160) };
}

async function defaultStoryWriter(input: { accountId: string; businessName: string | null; transcript: string }): Promise<Omit<LeadStory, "generatedAt"> | null> {
  const { storage } = await import("../storage");
  const apiKey = await storage.getBusinessAccountOpenAIKey(input.accountId);
  if (!apiKey) return null;
  const { createOpenAI } = await import("../lib/openaiClient");
  const openai = createOpenAI({ apiKey, feature: "lead_story", businessAccountId: input.accountId, timeout: 30_000 });
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    max_tokens: 450,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          `You brief a counsellor at ${input.businessName ? `"${input.businessName}"` : "the business"} about one lead, from everything the lead did across website chat, WhatsApp, AI phone calls and social DMs (oldest first).\n` +
          `Return JSON only: {"summary": "2-4 plain sentences: who they are, what they want, where things stand", "course": "the course / product they're interested in or null", ` +
          `"budget": "their budget if they said one, else null", "questions": ["their open questions, short"], "booked": "anything booked, sent or promised (e.g. counselling Tue 5 PM, brochure sent) or null", ` +
          `"nextStep": "the single most useful next step for the counsellor"}.\n` +
          `Use only what is in the history; never guess numbers, dates or names. Write in English.`,
      },
      { role: "user", content: input.transcript },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) return null;
  try { return sanitizeStory(JSON.parse(content)); } catch { return null; }
}

/** Plain-text history for the story writer (and the phone call's "before this call" brief). */
async function storyTranscript(p: Person, events: TimelineEvent[]): Promise<string> {
  const lines = events.map((e) => `[${e.at.slice(0, 16).replace("T", " ")}] ${e.channel.toUpperCase()} — ${e.title}${e.detail ? `: ${e.detail}` : ""}`);
  // The words themselves from the latest website chat and WhatsApp chat.
  const convId = [...events].reverse().find((e) => e.link?.type === "conversation")?.link?.id;
  if (convId) {
    const msgs = await db.select({ role: messages.role, content: messages.content }).from(messages).where(eq(messages.conversationId, convId)).orderBy(desc(messages.createdAt)).limit(20);
    if (msgs.length) lines.push("", "LATEST WEBSITE CHAT:", ...msgs.reverse().filter((m) => m.role === "user" || m.role === "assistant").map((m) => `${m.role === "user" ? "Lead" : "AI"}: ${clip(m.content, 300)}`));
  }
  if (p.phoneKey) {
    const wa = await db.select({ raw: whatsappLeads.rawMessage, direction: whatsappLeads.direction }).from(whatsappLeads)
      .where(and(eq(whatsappLeads.businessAccountId, p.accountId), sql`${key10(sql`${whatsappLeads.senderPhone}`)} = ${p.phoneKey}`))
      .orderBy(desc(whatsappLeads.receivedAt)).limit(20);
    if (wa.length) lines.push("", "LATEST WHATSAPP:", ...wa.reverse().map((m) => `${m.direction === "incoming" ? "Lead" : "Business"}: ${clip(readableChatText(m.raw, new Map()), 300)}`));
  }
  return lines.join("\n").slice(-12_000);
}

async function cachedStory(accountId: string, leadKey: string) {
  const [row] = await db.select().from(leadStories).where(and(eq(leadStories.businessAccountId, accountId), eq(leadStories.leadKey, leadKey))).limit(1);
  return row ?? null;
}

const latestAt = (events: TimelineEvent[]) => (events.length ? new Date(events[events.length - 1].at) : null);

export async function getLeadTimeline(accountId: string, anchor: TimelineAnchor): Promise<LeadTimelineResponse | null> {
  const built = await buildLeadTimeline(accountId, anchor);
  if (!built) return null;
  const row = await cachedStory(accountId, built.person.leadKey);
  const newest = latestAt(built.events);
  const story = row ? ({ ...(row.story as any), generatedAt: row.generatedAt.toISOString() } as LeadStory) : null;
  const storyStatus: LeadTimelineResponse["storyStatus"] = !built.events.length ? "unavailable"
    : !story ? "none"
    : newest && row?.lastEventAt && newest.getTime() > row.lastEventAt.getTime() + 1000 ? "stale" : "ready";
  return { events: built.events, story, storyStatus };
}

/** Write (or rewrite) the story. Returns null when there's no AI key or nothing to say. */
export async function writeLeadStory(accountId: string, anchor: TimelineAnchor): Promise<LeadStory | null> {
  const built = await buildLeadTimeline(accountId, anchor);
  if (!built || !built.events.length) return null;
  const [biz] = await db.select({ name: businessAccounts.name }).from(businessAccounts).where(eq(businessAccounts.id, accountId)).limit(1);
  const transcript = await storyTranscript(built.person, built.events);
  const story = await (storyOverride ?? defaultStoryWriter)({ accountId, businessName: biz?.name ?? null, transcript });
  if (!story) return null;
  const now = new Date();
  const lastEventAt = latestAt(built.events);
  await db.insert(leadStories).values({
    businessAccountId: accountId, leadKey: built.person.leadKey, story, lastEventAt, generatedAt: now,
    websiteLeadId: anchor.channel === "website" ? anchor.id : null, whatsappLeadId: anchor.channel === "whatsapp" ? anchor.id : null,
  })
    .onConflictDoUpdate({ target: [leadStories.businessAccountId, leadStories.leadKey], set: { story, lastEventAt, generatedAt: now } });
  return { ...story, generatedAt: now.toISOString() };
}

/**
 * A few lines for an AI phone call about what this lead already did (the cached story, else the
 * latest events). DB only — no model call while the phone is ringing.
 */
export async function leadHistoryBrief(accountId: string, leadId: string): Promise<string | null> {
  try {
    const anchor: TimelineAnchor = { channel: "website", id: leadId };
    const row = await cachedStory(accountId, `website:${leadId}`);
    if (row) {
      const s = row.story as any;
      const parts = [s.summary, s.questions?.length ? `Their questions: ${s.questions.join("; ")}.` : null, s.booked ? `Booked / sent: ${s.booked}.` : null].filter(Boolean);
      if (parts.length) return clip(parts.join(" "), 700);
    }
    const built = await buildLeadTimeline(accountId, anchor);
    if (!built) return null;
    const recent = built.events.filter((e) => e.channel !== "team").slice(-6);
    if (recent.length <= 1) return null;
    return clip(recent.map((e) => `${e.title}${e.detail ? ` — ${e.detail}` : ""}`).join(" · "), 700);
  } catch (err) {
    console.warn("[LeadTimeline] history brief failed:", (err as Error)?.message);
    return null;
  }
}


/**
 * WhatsApp / chat replies: what our AI already discussed with this number on a phone call in the
 * last 14 days, so the next reply carries on from it ("you asked about EMI on the call").
 */
const RECENT_CALL_DAYS = 14;
export async function recentCallContext(accountId: string, phone: string | null | undefined): Promise<string> {
  const k = String(phone || "").replace(/\D/g, "").slice(-10);
  if (k.length < 10) return "";
  try {
    const rows = await db.select({ at: aiCalls.answeredAt, summary: aiCalls.summary, outcome: aiCalls.outcome, callbackAt: aiCalls.callbackAt }).from(aiCalls)
      .where(and(eq(aiCalls.businessAccountId, accountId), isNotNull(aiCalls.answeredAt), isNotNull(aiCalls.summary),
        sql`${key10(sql`${aiCalls.phone}`)} = ${k}`, sql`${aiCalls.answeredAt} > now() - make_interval(days => ${RECENT_CALL_DAYS})`))
      .orderBy(desc(aiCalls.answeredAt)).limit(2);
    if (!rows.length) return "";
    const lines = rows.reverse().map((r) => {
      const outcome = r.outcome ? CALL_OUTCOME_LABEL[r.outcome as CallOutcome] : null;
      return `- ${r.at ? new Date(r.at).toISOString().slice(0, 10) : ""}: ${clip(r.summary, 400)}${outcome ? ` (outcome: ${outcome})` : ""}${r.callbackAt ? ` They asked to be called back at ${new Date(r.callbackAt).toISOString()}.` : ""}`;
    });
    return `RECENT PHONE CALL WITH THIS PERSON (our AI assistant called them):\n${lines.join("\n")}\nCarry on from it: don't repeat what was already explained, and follow up on what they asked.`;
  } catch (err) {
    console.warn("[LeadTimeline] recent call context failed:", (err as Error)?.message);
    return "";
  }
}
