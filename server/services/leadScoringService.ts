/**
 * Lead score — how engaged a lead is right now (0-100, hot / warm / cold), a separate profile
 * fit badge, and the reasons both ways ("▲ answered the AI call · ▼ quiet for 9 days").
 *
 * Modelled on LeadSquared's engagement score (recent activity only, positive and negative points,
 * refreshed about hourly) and Salesforce's top positive / negative factors. Rules, not a model, so
 * every point can be explained. Signals come from every channel the person used (same-person rules
 * as the Leads page: hand-off code, OTP, answered AI call).
 *
 * Scores are stored on the lead row (leads / whatsapp_leads: engagement_score, lead_temperature,
 * lead_fit, score_reasons, scored_at) so the Leads list can sort and filter by them. A worker
 * refreshes recently active leads every 20 minutes (and lets quiet ones cool down); opening a lead
 * rescoring it on the spot.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { leads, whatsappLeads } from "@shared/schema";
import type { CallOutcome } from "@shared/aiCalling";
import { key10, websitePersonKeySql } from "./unifiedLeadsService";
import { trackTimer } from "../lib/lifecycle";

export type LeadTemperature = "hot" | "warm" | "cold";
export type LeadFit = "good" | "partial" | "unknown";
export interface ScoreReasons { up: string[]; down: string[]; fit: string[] }
export interface LeadScore { score: number; temperature: LeadTemperature; fit: LeadFit; reasons: ScoreReasons }

export interface ScoreSignals {
  now: Date;
  lastActivityAt: Date | null;
  sharedDetails: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  hasName: boolean;
  phoneConfirmed: boolean;
  enquiryCount: number;
  websiteChats: number;
  /** Asked about fees / EMI / admission / eligibility / scholarship (any channel). */
  buyingQuestion: boolean;
  /** What they want is known (topics, a course in the story). */
  interest: string | null;
  callsAnswered: number;
  callsUnanswered: number;
  lastOutcome: CallOutcome | null;
  followUpRead: boolean;
  followUpFailed: boolean;
  whatsappReplies: number;
  movedToWhatsapp: boolean;
}

export const TEMPERATURE_LABEL: Record<LeadTemperature, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };
export const HOT_AT = 70;
export const WARM_AT = 40;
const DAY = 86_400_000;

/** The score from the signals — pure, so the rules are easy to test and to explain. */
export function scoreFromSignals(s: ScoreSignals): LeadScore {
  const up: string[] = [];
  const down: string[] = [];
  let score = 0;
  const add = (pts: number, why: string) => { if (!pts) return; score += pts; (pts > 0 ? up : down).push(why); };

  if (s.sharedDetails) add(15, "Shared their contact details");
  if (s.websiteChats > 0) add(Math.min(10, s.websiteChats * 5), s.websiteChats > 1 ? `${s.websiteChats} website chats` : "Chatted on the website");
  if (s.enquiryCount > 1) add(Math.min(20, (s.enquiryCount - 1) * 10), `Came back (${s.enquiryCount} enquiries)`);
  if (s.buyingQuestion) add(10, "Asked about fees, EMI or admission");
  if (s.callsAnswered > 0) add(10, "Answered the AI call");
  if (s.lastOutcome === "interested") add(25, "Interested on the call");
  else if (s.lastOutcome === "callback_requested") add(15, "Asked to be called back");
  if (s.whatsappReplies > 0) add(s.whatsappReplies >= 3 ? 20 : 15, s.whatsappReplies >= 3 ? `Chatting on WhatsApp (${s.whatsappReplies} messages)` : "Replied on WhatsApp");
  if (s.followUpRead) add(5, "Read the WhatsApp follow-up");
  if (s.movedToWhatsapp) add(10, "Moved from the website to WhatsApp");

  if (s.lastOutcome === "not_interested") add(-40, "Said not interested on the call");
  if (s.lastOutcome === "wrong_number") add(-60, "Wrong number");
  if (s.callsAnswered === 0 && s.callsUnanswered >= 2) add(-10, `Didn't answer ${s.callsUnanswered} calls`);
  if (s.followUpFailed) add(-5, "WhatsApp follow-up wasn't delivered");

  // Engagement is about now: quiet leads cool down.
  const quietDays = s.lastActivityAt ? Math.floor((s.now.getTime() - s.lastActivityAt.getTime()) / DAY) : null;
  if (quietDays !== null) {
    if (quietDays > 30) { score = Math.min(score, 10); down.push(`Quiet for ${quietDays} days`); }
    else if (quietDays > 14) add(-40, `Quiet for ${quietDays} days`);
    else if (quietDays > 7) add(-25, `Quiet for ${quietDays} days`);
    else if (quietDays > 2) add(-10, `Quiet for ${quietDays} days`);
  }
  if (s.lastOutcome === "do_not_call") { score = 0; down.unshift("Asked not to be called"); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const temperature: LeadTemperature = score >= HOT_AT ? "hot" : score >= WARM_AT ? "warm" : "cold";

  // Profile fit: can we reach them, and do we know what they want?
  const fitWhy: string[] = [];
  const reachable = s.phoneConfirmed || s.hasPhone;
  fitWhy.push(s.phoneConfirmed ? "Number confirmed" : s.hasPhone ? "Has a phone number (not confirmed)" : "No phone number");
  fitWhy.push(s.interest ? `Interested in: ${s.interest}` : "Not clear what they want yet");
  if (!s.hasEmail) fitWhy.push("No email");
  if (!s.hasName) fitWhy.push("No name");
  const fit: LeadFit = reachable && s.interest ? "good" : reachable || s.interest ? "partial" : "unknown";

  return { score, temperature, fit, reasons: { up: up.slice(0, 6), down: down.slice(0, 4), fit: fitWhy } };
}

// ── signals from the database ───────────────────────────────────────────────────

const BUYING_WORDS = String.raw`(fee|fees|price|cost|emi|instal|loan|admission|apply|eligib|scholarship|placement|discount|फीस|शुल्क|एडमिशन|ईएमआई|किस्त|स्कॉलरशिप|प्लेसमेंट|kitna|kitni|kitne|कितना|कितनी)`;
const ms = (v: unknown) => (v === null || v === undefined ? null : new Date(Number(v)));
const maxDate = (...ds: Array<Date | null | undefined>) => ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

interface CallAgg { answered: number; unanswered: number; lastOutcome: CallOutcome | null; read: boolean; failed: boolean; lastAt: Date | null }
interface WaAgg { replies: number; lastAt: Date | null; buying: boolean }

async function callAggregates(accountId: string, by: "lead" | "phone", keys: string[]): Promise<Map<string, CallAgg>> {
  const out = new Map<string, CallAgg>();
  if (!keys.length) return out;
  const keyExpr = by === "lead" ? sql`c.lead_id` : key10(sql`c.phone`);
  const res = await db.execute(sql`
    SELECT ${keyExpr} AS k,
      count(*) FILTER (WHERE c.answered_at IS NOT NULL)::int AS answered,
      count(*) FILTER (WHERE c.answered_at IS NULL AND c.status IN ('no_answer','busy','voicemail','failed'))::int AS unanswered,
      (array_agg(c.outcome ORDER BY c.answered_at DESC NULLS LAST) FILTER (WHERE c.outcome IS NOT NULL))[1] AS last_outcome,
      bool_or(c.follow_up_status = 'read') AS read, bool_or(c.follow_up_status = 'failed') AS failed,
      extract(epoch from max(coalesce(c.answered_at, c.started_at, c.created_at))) * 1000 AS last_at
    FROM ai_calls c
    WHERE c.business_account_id = ${accountId} AND ${keyExpr} IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
      AND c.status NOT IN ('cancelled', 'skipped')
    GROUP BY 1`);
  for (const r of res.rows as any[]) {
    out.set(r.k, { answered: r.answered, unanswered: r.unanswered, lastOutcome: r.last_outcome ?? null, read: !!r.read, failed: !!r.failed, lastAt: ms(r.last_at) });
  }
  return out;
}

async function whatsappAggregates(accountId: string, phoneKeys: string[]): Promise<Map<string, WaAgg>> {
  const out = new Map<string, WaAgg>();
  if (!phoneKeys.length) return out;
  const res = await db.execute(sql`
    SELECT ${key10(sql`w.sender_phone`)} AS k,
      count(*) FILTER (WHERE w.direction = 'incoming' AND w.received_at > now() - interval '30 days')::int AS replies,
      extract(epoch from max(w.received_at) FILTER (WHERE w.direction = 'incoming')) * 1000 AS last_at,
      bool_or(w.direction = 'incoming' AND w.raw_message ~* ${BUYING_WORDS}) AS buying
    FROM whatsapp_leads w
    WHERE w.business_account_id = ${accountId} AND ${key10(sql`w.sender_phone`)} IN (${sql.join(phoneKeys.map((k) => sql`${k}`), sql`, `)})
    GROUP BY 1`);
  for (const r of res.rows as any[]) out.set(r.k, { replies: r.replies, lastAt: ms(r.last_at), buying: !!r.buying });
  return out;
}

/** Score website leads (with everything the same person did on other channels) and save. */
export async function rescoreWebsiteLeads(accountId: string, ids: string[], now = new Date()): Promise<Map<string, LeadScore>> {
  const out = new Map<string, LeadScore>();
  if (!ids.length) return out;
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const base = await db.execute(sql`
    SELECT l.id, l.name, l.phone, l.email, l.message, l.topics_of_interest AS topics, l.enquiry_count,
      ${websitePersonKeySql()} AS person_key,
      extract(epoch from l.created_at) * 1000 AS created_at, extract(epoch from l.last_enquiry_at) * 1000 AS last_enquiry_at,
      (SELECT count(DISTINCT x.cid) FROM (
         SELECT l.conversation_id AS cid UNION SELECT lc.conversation_id FROM lead_conversations lc WHERE lc.lead_id = l.id
       ) x WHERE x.cid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ai_calls ac WHERE ac.conversation_id = x.cid))::int AS chats,
      EXISTS (SELECT 1 FROM messages m WHERE m.role = 'user' AND m.content ~* ${BUYING_WORDS} AND m.conversation_id IN (
         SELECT l.conversation_id UNION SELECT lc.conversation_id FROM lead_conversations lc WHERE lc.lead_id = l.id)) AS buying,
      EXISTS (SELECT 1 FROM whatsapp_handoffs h WHERE h.business_account_id = l.business_account_id AND h.used_at IS NOT NULL
         AND (h.website_lead_id = l.id OR (l.conversation_id IS NOT NULL AND h.conversation_id = l.conversation_id))) AS moved,
      (SELECT s.story->>'course' FROM lead_stories s WHERE s.website_lead_id = l.id LIMIT 1) AS story_course
    FROM leads l WHERE l.business_account_id = ${accountId} AND l.id IN (${idList})`);
  const rows = base.rows as any[];
  const phoneKeys = Array.from(new Set(rows.map((r) => r.person_key).filter(Boolean))) as string[];
  const [byLead, byPhone, wa] = await Promise.all([
    callAggregates(accountId, "lead", rows.map((r) => r.id)),
    callAggregates(accountId, "phone", phoneKeys),
    whatsappAggregates(accountId, phoneKeys),
  ]);
  for (const r of rows) {
    const c = byLead.get(r.id) || (r.person_key ? byPhone.get(r.person_key) : undefined);
    const w = r.person_key ? wa.get(r.person_key) : undefined;
    const topics = Array.isArray(r.topics) ? (r.topics as string[]).filter((t) => !/^(via |discount)/i.test(t)) : [];
    const signals: ScoreSignals = {
      now,
      lastActivityAt: maxDate(ms(r.created_at), ms(r.last_enquiry_at), c?.lastAt, w?.lastAt),
      sharedDetails: !!(r.phone || r.email),
      hasPhone: !!r.phone, hasEmail: !!r.email, hasName: !!r.name && !/^anonymous$/i.test(r.name),
      phoneConfirmed: !!r.person_key,
      enquiryCount: r.enquiry_count ?? 1,
      websiteChats: r.chats ?? 0,
      buyingQuestion: !!r.buying || !!w?.buying || new RegExp(BUYING_WORDS, "i").test(String(r.message || "")),
      interest: r.story_course || topics[0] || null,
      callsAnswered: c?.answered ?? 0, callsUnanswered: c?.unanswered ?? 0, lastOutcome: c?.lastOutcome ?? null,
      followUpRead: !!c?.read, followUpFailed: !!c?.failed,
      whatsappReplies: w?.replies ?? 0,
      movedToWhatsapp: !!r.moved,
    };
    const s = scoreFromSignals(signals);
    out.set(r.id, s);
    await db.update(leads).set({ engagementScore: s.score, leadTemperature: s.temperature, leadFit: s.fit, scoreReasons: s.reasons, scoredAt: now })
      .where(and(eq(leads.businessAccountId, accountId), eq(leads.id, r.id)));
  }
  return out;
}

/** Score WhatsApp leads (rows shown on the Leads page) from their number's activity, and save. */
export async function rescoreWhatsappLeads(accountId: string, ids: string[], now = new Date()): Promise<Map<string, LeadScore>> {
  const out = new Map<string, LeadScore>();
  if (!ids.length) return out;
  const rows = await db.select({
    id: whatsappLeads.id, phone: whatsappLeads.senderPhone, name: whatsappLeads.customerName, sender: whatsappLeads.senderName,
    email: whatsappLeads.customerEmail, receivedAt: whatsappLeads.receivedAt, extracted: whatsappLeads.extractedData,
  }).from(whatsappLeads).where(and(eq(whatsappLeads.businessAccountId, accountId), inArray(whatsappLeads.id, ids)));
  const phoneKeys = Array.from(new Set(rows.map((r) => String(r.phone || "").replace(/\D/g, "").slice(-10)).filter((k) => k.length === 10)));
  const [calls, wa] = await Promise.all([callAggregates(accountId, "phone", phoneKeys), whatsappAggregates(accountId, phoneKeys)]);
  for (const r of rows) {
    const k = String(r.phone || "").replace(/\D/g, "").slice(-10);
    const c = calls.get(k);
    const w = wa.get(k);
    const extracted = (r.extracted || {}) as Record<string, unknown>;
    const interest = ["course", "program", "programme", "interest", "product", "loan_type"].map((f) => extracted[f]).find((v) => typeof v === "string" && v.trim()) as string | undefined;
    const signals: ScoreSignals = {
      now,
      lastActivityAt: maxDate(r.receivedAt ? new Date(r.receivedAt) : null, w?.lastAt, c?.lastAt),
      sharedDetails: !!(r.name || r.email),
      hasPhone: !!r.phone, hasEmail: !!r.email, hasName: !!(r.name || r.sender),
      phoneConfirmed: !!r.phone, // they messaged from it
      enquiryCount: 1, websiteChats: 0,
      buyingQuestion: !!w?.buying,
      interest: interest?.trim() || null,
      callsAnswered: c?.answered ?? 0, callsUnanswered: c?.unanswered ?? 0, lastOutcome: c?.lastOutcome ?? null,
      followUpRead: !!c?.read, followUpFailed: !!c?.failed,
      whatsappReplies: w?.replies ?? 0, movedToWhatsapp: false,
    };
    const s = scoreFromSignals(signals);
    out.set(r.id, s);
    await db.update(whatsappLeads).set({ engagementScore: s.score, leadTemperature: s.temperature, leadFit: s.fit, scoreReasons: s.reasons, scoredAt: now })
      .where(and(eq(whatsappLeads.businessAccountId, accountId), eq(whatsappLeads.id, r.id)));
  }
  return out;
}

// ── worker ────────────────────────────────────────────────────────────────────

const PASS_EVERY_MS = 20 * 60 * 1000;
const BATCH = 300;
let running = false;

/**
 * One pass: leads active in the last 35 days (new, came back, called, messaged) whose score is
 * older than the pass interval, plus scored leads not refreshed for 6 h (so quiet ones cool down).
 */
export async function runScoringPass(now = new Date()): Promise<{ website: number; whatsapp: number }> {
  if (running) return { website: 0, whatsapp: 0 };
  running = true;
  try {
    const web = await db.execute(sql`
      SELECT l.business_account_id AS a, l.id FROM leads l
      WHERE (l.scored_at IS NULL OR l.scored_at < now() - interval '20 minutes')
        AND (
          greatest(l.created_at, coalesce(l.last_enquiry_at, l.created_at)) > now() - interval '35 days'
          OR EXISTS (SELECT 1 FROM ai_calls c WHERE c.lead_id = l.id AND c.created_at > now() - interval '35 days')
          OR (l.engagement_score > 0 AND l.scored_at < now() - interval '6 hours')
        )
      ORDER BY l.scored_at NULLS FIRST LIMIT ${BATCH}`);
    const wa = await db.execute(sql`
      SELECT w.business_account_id AS a, w.id FROM whatsapp_leads w
      WHERE w.status <> 'message_only' AND w.direction = 'incoming'
        AND (w.scored_at IS NULL OR w.scored_at < now() - interval '20 minutes')
        AND (coalesce(w.last_message_at, w.received_at) > now() - interval '35 days' OR (w.engagement_score > 0 AND w.scored_at < now() - interval '6 hours'))
      ORDER BY w.scored_at NULLS FIRST LIMIT ${BATCH}`);
    const group = (rows: any[]) => rows.reduce((m: Map<string, string[]>, r) => m.set(r.a, [...(m.get(r.a) || []), r.id]), new Map<string, string[]>());
    for (const [a, ids] of Array.from(group(web.rows as any[]))) await rescoreWebsiteLeads(a, ids, now);
    for (const [a, ids] of Array.from(group(wa.rows as any[]))) await rescoreWhatsappLeads(a, ids, now);
    return { website: web.rows.length, whatsapp: wa.rows.length };
  } finally {
    running = false;
  }
}

export function startLeadScoringWorker(): void {
  const tick = () => runScoringPass().then((r) => {
    if (r.website || r.whatsapp) console.log(`[LeadScore] rescored ${r.website} website + ${r.whatsapp} WhatsApp leads`);
  }).catch((err) => console.error("[LeadScore] pass failed:", err?.message || err));
  trackTimer(setTimeout(tick, 60_000));
  trackTimer(setInterval(tick, PASS_EVERY_MS));
}
