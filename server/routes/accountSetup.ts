import { Router } from "express";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { appointments, conversations, customCrmSettings, demoOrders, facebookSettings, instagramSettings, leads, scheduleTemplates, supportTickets, visitorDailyStats, whatsappLeads, whatsappSettings, whatsappTemplates } from "@shared/schema";
import { db } from "../db";
import { requireAuth, requireRole } from "../auth";
import { storage } from "../storage";

/**
 * Super admin › an account's "Features on this account": what each feature still needs (status
 * lines on the rows) and the set-up panels that are not an existing settings screen yet.
 * Step 1: Voice mode (provider, ElevenLabs key, voice).
 */
const router = Router();

export const OPENAI_VOICE_IDS = ["alloy", "ash", "ballad", "coral", "echo", "fable", "marin", "cedar", "onyx", "nova", "sage", "shimmer", "verse"];

export type FeatureState = "ready" | "needs_setup" | "off";
export interface FeatureStatus {
  state: FeatureState;
  /** What is missing, in plain words (needs_setup only). */
  problem?: string;
  /** Ready: a short summary for the row ("Plivo · +91… · 12 min this month"). */
  summary?: string;
  /** The set-up panel's checklist. */
  checks?: { label: string; done: boolean; detail?: string }[];
  [key: string]: unknown;
}

const on = (v: unknown) => v === true || v === "true";
const firstMissing = (checks: { label: string; done: boolean; detail?: string }[]) => checks.find(c => !c.done);

function ago(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

async function phoneCallsStatus(accountId: string, account: any): Promise<FeatureStatus> {
  if (!on(account.aiCallingEnabled)) return { state: "off" };
  const { getCallingSettings } = await import("../services/calling/settingsService");
  const s: any = await getCallingSettings(accountId);
  const checks: { label: string; done: boolean; detail?: string }[] = [];
  if (s.provider === "plivo") {
    checks.push({ label: "Plivo Auth ID and token", done: !!(s.plivoAuthId && s.plivoAuthToken) });
    checks.push({ label: "Plivo number (caller ID)", done: !!s.plivoNumber, detail: s.plivoNumber || undefined });
    checks.push({ label: "Plivo details checked", done: !!s.plivoVerifiedAt });
  } else if (s.provider === "exotel") {
    checks.push({ label: "Exotel account details", done: !!(s.exotelAccountSid && s.exotelApiKey && s.exotelApiToken) });
    checks.push({ label: "Exotel caller ID", done: !!s.exotelCallerId, detail: s.exotelCallerId || undefined });
    checks.push({ label: "Exotel details checked", done: !!s.exotelVerifiedAt });
  } else {
    checks.push({ label: "A phone provider (Plivo or Exotel)", done: false, detail: "Using the test simulator" });
  }
  checks.push({ label: "Calling switched on in Phone calls › Settings", done: !!s.enabled });
  checks.push({ label: "What the AI says (purpose / opening line)", done: !!(s.callPurpose || s.openingLine) });
  const missing = firstMissing(checks);
  const provider = s.provider === "plivo" ? "Plivo" : s.provider === "exotel" ? "Exotel" : "Simulator";
  const number = s.provider === "plivo" ? s.plivoNumber : s.exotelCallerId;
  return missing
    ? { state: "needs_setup", problem: missing.detail && !missing.done && s.provider !== "plivo" && s.provider !== "exotel" ? "Connect a phone provider (Plivo or Exotel); it is on the test simulator" : `Missing: ${missing.label}`, checks }
    : { state: "ready", summary: [provider, number].filter(Boolean).join(" · "), checks };
}

async function whatsappStatus(accountId: string, account: any): Promise<FeatureStatus> {
  if (!on(account.whatsappEnabled)) return { state: "off" };
  const [ws] = await db.select().from(whatsappSettings).where(eq(whatsappSettings.businessAccountId, accountId)).limit(1);
  const [last] = await db.select({ at: whatsappLeads.lastMessageAt }).from(whatsappLeads)
    .where(and(eq(whatsappLeads.businessAccountId, accountId), isNotNull(whatsappLeads.lastMessageAt)))
    .orderBy(desc(whatsappLeads.lastMessageAt)).limit(1);
  const checks = [
    { label: "MSG91 auth key", done: !!ws?.msg91AuthKey },
    { label: "WhatsApp number", done: !!ws?.whatsappNumber, detail: ws?.whatsappNumber || undefined },
    { label: "Integrated number ID", done: !!ws?.msg91IntegratedNumberId },
    { label: "AI replies switched on", done: on(ws?.autoReplyEnabled) && on(ws?.whatsappEnabled ?? "true") },
  ];
  const missing = firstMissing(checks);
  const lastText = ago(last?.at);
  return missing
    ? { state: "needs_setup", problem: missing.label === "AI replies switched on" ? "AI replies are switched off" : `Missing: ${missing.label}`, checks, lastMessage: lastText }
    : { state: "ready", summary: [ws?.whatsappNumber, lastText ? `last message ${lastText}` : "no messages yet"].filter(Boolean).join(" · "), checks, lastMessage: lastText };
}

async function campaignsStatus(accountId: string, account: any, wa: FeatureStatus): Promise<FeatureStatus> {
  if (!on(account.whatsappMarketingEnabled)) return { state: "off" };
  const rows = await db.select({ status: whatsappTemplates.status, n: sql<number>`count(*)::int` }).from(whatsappTemplates)
    .where(eq(whatsappTemplates.businessAccountId, accountId)).groupBy(whatsappTemplates.status);
  const approved = rows.find(r => r.status === "approved")?.n ?? 0;
  const pending = rows.find(r => r.status === "pending")?.n ?? 0;
  const checks = [
    { label: "WhatsApp switched on and connected", done: wa.state === "ready" },
    { label: "At least one approved template", done: approved > 0, detail: pending ? `${pending} waiting for approval` : undefined },
  ];
  const missing = firstMissing(checks);
  return missing
    ? { state: "needs_setup", problem: missing.label === "At least one approved template" ? (pending ? `No approved template yet (${pending} waiting)` : "No approved template yet") : "WhatsApp isn't connected yet", checks }
    : { state: "ready", summary: `${approved} approved template${approved === 1 ? "" : "s"}`, checks };
}

async function websiteStatus(accountId: string, account: any): Promise<FeatureStatus> {
  if (!on(account.chroneyEnabled)) return { state: "off" };
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const [lastOpen] = await db.select({ date: visitorDailyStats.date }).from(visitorDailyStats)
    .where(and(eq(visitorDailyStats.businessAccountId, accountId), sql`${visitorDailyStats.openedChatCount} > 0`))
    .orderBy(desc(visitorDailyStats.date)).limit(1);
  const [chats] = await db.select({ n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${conversations.createdAt})` }).from(conversations)
    .where(and(eq(conversations.businessAccountId, accountId), isNotNull(conversations.visitorToken), gte(conversations.createdAt, since)));
  const lastSeen = [lastOpen?.date ? new Date(lastOpen.date) : null, chats?.last ? new Date(chats.last) : null].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
  const live = !!lastSeen && lastSeen.getTime() >= since.getTime();
  const checks = [
    { label: "Embed code on the website", done: live, detail: live ? `Chat used on the site ${ago(lastSeen)}` : "No chats from the website in 30 days" },
  ];
  return live
    ? { state: "ready", summary: `${chats?.n ?? 0} chats in 30 days · last ${ago(lastSeen)}`, checks }
    : { state: "needs_setup", problem: "No chats from the website in 30 days: is the code installed?", checks };
}

async function shopifyStatus(accountId: string, account: any): Promise<FeatureStatus> {
  if (!on(account.shopifyEnabled)) return { state: "off" };
  const ws: any = await storage.getWidgetSettings(accountId);
  const productRows: any = await db.execute(sql`SELECT count(*)::int AS n FROM products WHERE business_account_id = ${accountId} AND source = 'shopify'`);
  const products = Number((productRows?.rows ?? productRows)?.[0]?.n ?? 0);
  const checks = [
    { label: "Shopify store connected", done: !!(ws?.shopifyStoreUrl && ws?.shopifyAccessToken), detail: ws?.shopifyStoreUrl || undefined },
    { label: "Products synced", done: !!account.shopifyLastSyncedAt && account.shopifySyncStatus !== "failed", detail: account.shopifySyncStatus === "failed" ? "The last sync failed" : account.shopifyLastSyncedAt ? `Last sync ${ago(account.shopifyLastSyncedAt)}` : "Never synced" },
  ];
  const missing = firstMissing(checks);
  return missing
    ? { state: "needs_setup", problem: missing.label === "Shopify store connected" ? "Connect the Shopify store" : account.shopifySyncStatus === "failed" ? "The last Shopify sync failed" : "Products not synced yet", checks, storeUrl: ws?.shopifyStoreUrl || null, products }
    : { state: "ready", summary: `${ws?.shopifyStoreUrl} · ${products} products · synced ${ago(account.shopifyLastSyncedAt)}`, checks, storeUrl: ws?.shopifyStoreUrl || null, products };
}

async function voiceStatus(accountId: string): Promise<FeatureStatus> {
  const [account, settings, openAiKey] = await Promise.all([
    storage.getBusinessAccount(accountId),
    storage.getWidgetSettings(accountId),
    storage.getBusinessAccountOpenAIKey(accountId).catch(() => null),
  ]);
  const on = String(account?.voiceModeEnabled) === "true";
  const voiceSelection = settings?.voiceSelection || "shimmer";
  const provider = voiceSelection.startsWith("el:") ? "elevenlabs" : "openai";
  const base = { voiceSelection, provider, hasElevenLabsKey: !!account?.elevenlabsApiKey };
  if (!on) return { state: "off", ...base };
  if (String(account?.chroneyEnabled) !== "true") return { state: "needs_setup", problem: "Website chat is off, so visitors can't use voice", ...base };
  if (!openAiKey) return { state: "needs_setup", problem: "Add the account's OpenAI key (AI & keys); voice answers need it", ...base };
  if (provider === "elevenlabs" && !account?.elevenlabsApiKey) return { state: "needs_setup", problem: "An ElevenLabs voice is chosen but the ElevenLabs key is missing", ...base };
  return { state: "ready", ...base };
}

/** Status line for every feature that has one (more features are added step by step). */
router.get("/api/super-admin/accounts/:id/feature-status", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const account = await storage.getBusinessAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Business account not found" });
    const id = req.params.id;
    const [voiceMode, phoneCalls, whatsapp, website, shopify] = await Promise.all([
      voiceStatus(id),
      phoneCallsStatus(id, account).catch((e) => ({ state: "needs_setup", problem: `Couldn't check: ${e?.message || e}` } as FeatureStatus)),
      whatsappStatus(id, account),
      websiteStatus(id, account),
      shopifyStatus(id, account),
    ]);
    const [whatsappCampaigns, appointmentsS, supportTicketsS, instagram, facebook, demoOrdersS, crm] = await Promise.all([
      campaignsStatus(id, account, whatsapp),
      appointmentsStatus(id, account),
      supportTicketsStatus(id, account),
      metaStatus(id, account, "instagram"),
      metaStatus(id, account, "facebook"),
      demoOrdersStatus(id, account),
      crmStatus(id),
    ]);
    res.json({
      voiceMode, phoneCalls, whatsapp, whatsappCampaigns, website, shopify,
      appointments: appointmentsS, supportTickets: supportTicketsS, instagram, facebook, demoOrders: demoOrdersS, crm,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/super-admin/accounts/:id/voice-setup", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const account = await storage.getBusinessAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Business account not found" });
    const status = await voiceStatus(req.params.id);
    const key = account.elevenlabsApiKey;
    res.json({
      status,
      voiceSelection: status.voiceSelection,
      hasElevenLabsKey: !!key,
      elevenLabsKeyHint: key ? `…${String(key).slice(-4)}` : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/api/super-admin/accounts/:id/voice-setup", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const id = req.params.id;
    const account = await storage.getBusinessAccount(id);
    if (!account) return res.status(404).json({ error: "Business account not found" });
    const { voiceSelection, elevenlabsApiKey, removeElevenLabsKey } = req.body || {};

    if (typeof elevenlabsApiKey === "string" && elevenlabsApiKey.trim()) {
      await storage.updateBusinessAccountElevenLabsKey(id, elevenlabsApiKey.trim());
    } else if (removeElevenLabsKey === true) {
      await storage.updateBusinessAccountElevenLabsKey(id, null);
    }

    if (voiceSelection !== undefined) {
      const v = String(voiceSelection || "").trim();
      const isOpenAi = OPENAI_VOICE_IDS.includes(v);
      const isEleven = /^el:[A-Za-z0-9_-]{4,64}$/.test(v);
      if (!isOpenAi && !isEleven) return res.status(400).json({ error: "Choose a voice from the list" });
      const hasKey = !!(await storage.getBusinessAccount(id))?.elevenlabsApiKey;
      if (isEleven && !hasKey) return res.status(400).json({ error: "Add the ElevenLabs key before choosing an ElevenLabs voice" });
      await storage.upsertWidgetSettings(id, { voiceSelection: v } as any);
    }

    const status = await voiceStatus(id);
    const fresh = await storage.getBusinessAccount(id);
    res.json({
      status,
      voiceSelection: status.voiceSelection,
      hasElevenLabsKey: !!fresh?.elevenlabsApiKey,
      elevenLabsKeyHint: fresh?.elevenlabsApiKey ? `…${String(fresh.elevenlabsApiKey).slice(-4)}` : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function appointmentsStatus(accountId: string, account: any): Promise<FeatureStatus> {
  if (!on(account.appointmentsEnabled)) return { state: "off" };
  const ws: any = await storage.getWidgetSettings(accountId);
  const hours = await db.select().from(scheduleTemplates)
    .where(and(eq(scheduleTemplates.businessAccountId, accountId), eq(scheduleTemplates.isActive, "true")));
  const [upcoming] = await db.select({ n: sql<number>`count(*)::int` }).from(appointments)
    .where(and(eq(appointments.businessAccountId, accountId), gte(appointments.appointmentDate, new Date(Date.now() - 24 * 60 * 60_000))));
  const days = Array.from(new Set(hours.map(h => Number(h.dayOfWeek)))).sort().map(d => DAY_NAMES[d]).join(", ");
  const slot = hours[0] ? `${Number(hours[0].slotDurationMinutes)}-min slots` : "";
  const checks = [
    { label: "Website chat switched on", done: on(account.chroneyEnabled) },
    { label: "Booking switched on in the chat", done: ws ? on(ws.appointmentBookingEnabled ?? "true") : true },
    { label: "Working hours set", done: hours.length > 0, detail: hours.length ? [days, slot].filter(Boolean).join(" · ") : "No days or times yet, so no slots can be offered" },
  ];
  const missing = firstMissing(checks);
  return missing
    ? { state: "needs_setup", problem: missing.label === "Working hours set" ? "No working hours yet, so visitors see no free slots" : missing.label === "Website chat switched on" ? "Website chat is off" : "Booking is switched off in the chat", checks }
    : { state: "ready", summary: `${days} · ${upcoming?.n ?? 0} upcoming`, checks };
}

async function supportTicketsStatus(accountId: string, account: any): Promise<FeatureStatus> {
  if (!on(account.supportTicketsEnabled)) return { state: "off" };
  const rows = await db.select({ status: supportTickets.status, n: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${supportTickets.createdAt})` })
    .from(supportTickets).where(eq(supportTickets.businessAccountId, accountId)).groupBy(supportTickets.status);
  const open = rows.filter(r => r.status === "open" || r.status === "in_progress" || r.status === "waiting_customer");
  const openCount = open.reduce((n, r) => n + r.n, 0);
  const oldest = open.map(r => r.oldest).filter(Boolean).sort()[0] ?? null;
  const checks = [
    { label: "Tickets are created from chats the AI hands over", done: true },
    { label: "Open tickets", done: openCount === 0, detail: openCount ? `${openCount} open · oldest ${ago(oldest)}` : "None open" },
  ];
  return { state: "ready", summary: openCount ? `${openCount} open · oldest ${ago(oldest)}` : "no open tickets", checks };
}

async function metaStatus(accountId: string, account: any, channel: "instagram" | "facebook"): Promise<FeatureStatus> {
  if (!on(channel === "instagram" ? account.instagramEnabled : account.facebookEnabled)) return { state: "off" };
  const row: any = channel === "instagram"
    ? (await db.select().from(instagramSettings).where(eq(instagramSettings.businessAccountId, accountId)).limit(1))[0]
    : (await db.select().from(facebookSettings).where(eq(facebookSettings.businessAccountId, accountId)).limit(1))[0];
  const connected = channel === "instagram" ? !!(row?.igAccountId && row?.igAccessToken) : !!(row?.pageId && row?.pageAccessToken);
  const checks = [
    { label: channel === "instagram" ? "Instagram account connected" : "Facebook page connected", done: connected },
    { label: "Meta token still valid", done: connected && !row?.tokenInvalidAt, detail: row?.tokenInvalidAt ? `Rejected ${ago(row.tokenInvalidAt)}${row.tokenInvalidReason ? `: ${String(row.tokenInvalidReason).slice(0, 120)}` : ""}` : undefined },
    { label: "Webhook (app secret and verify token)", done: !!(row?.appSecret && row?.webhookVerifyToken) },
    { label: "AI replies to messages", done: on(row?.autoReplyEnabled) },
  ];
  const missing = firstMissing(checks);
  const extras = [on(row?.commentAutoReplyEnabled) ? "comment replies on" : null].filter(Boolean).join(" · ");
  return missing
    ? { state: "needs_setup", problem: missing.label === "Meta token still valid" ? "Meta rejected the token: connect again" : missing.label === "AI replies to messages" ? "AI replies are switched off" : `Missing: ${missing.label}`, checks }
    : { state: "ready", summary: ["connected", extras].filter(Boolean).join(" · "), checks };
}

async function demoOrdersStatus(accountId: string, account: any): Promise<FeatureStatus> {
  if (!on(account.demoOrdersEnabled)) return { state: "off" };
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(demoOrders).where(eq(demoOrders.businessAccountId, accountId));
  const n = row?.n ?? 0;
  const checks = [{ label: "Sample orders to show in demos", done: n > 0, detail: n ? `${n} sample orders` : "None yet" }];
  return n > 0 ? { state: "ready", summary: `${n} sample orders`, checks } : { state: "needs_setup", problem: "No sample orders yet", checks };
}

/** Where leads go: which CRMs are set up, and sends that failed in the last 7 days. */
async function crmStatus(accountId: string): Promise<FeatureStatus> {
  const ws: any = await storage.getWidgetSettings(accountId);
  const { isLeadSquaredConfigured, isSalesforceConfigured } = await import("../services/crmLeadSync");
  const [custom] = await db.select({ enabled: customCrmSettings.enabled, name: customCrmSettings.name }).from(customCrmSettings).where(eq(customCrmSettings.businessAccountId, accountId)).limit(1);
  const crms = [
    { key: "leadsquared", label: "LeadSquared", on: isLeadSquaredConfigured(ws) },
    { key: "salesforce", label: "Salesforce", on: isSalesforceConfigured(ws) },
    { key: "meritto", label: "Meritto", on: !!(ws?.merittoEnabled === "true" && ws?.merittoAccessKey && ws?.merittoSecretKey) },
    { key: "custom-crm", label: custom?.name || "Custom CRM", on: !!custom?.enabled },
  ];
  const active = crms.filter(c => c.on);
  if (active.length === 0) return { state: "off", crms };
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const [failed] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(
    eq(leads.businessAccountId, accountId), gte(leads.createdAt, since),
    sql`(${leads.leadsquaredSyncStatus} IN ('failed','needs_attention','permanently_failed') OR ${leads.salesforceSyncStatus} = 'failed' OR ${leads.merittoSyncStatus} IN ('failed','needs_attention'))`,
  ));
  const failedN = failed?.n ?? 0;
  // Only the CRMs in use: the others are optional (the panel offers them as buttons).
  const checks: { label: string; done: boolean; detail?: string }[] = active.map(c => ({ label: c.label, done: true, detail: "Sending leads" }));
  checks.push({ label: "Leads sent without errors (last 7 days)", done: failedN === 0, detail: failedN ? `${failedN} lead${failedN === 1 ? "" : "s"} failed to send` : undefined });
  return failedN
    ? { state: "needs_setup", problem: `${failedN} lead${failedN === 1 ? "" : "s"} failed to reach the CRM in the last 7 days`, checks, crms }
    : { state: "ready", summary: active.map(c => c.label).join(", "), checks, crms };
}

// Shopify "Sync now" from the set-up panel (same sync as the account's own Shopify page).
const shopifyCooldown = new Map<string, number>();
router.post("/api/super-admin/accounts/:id/shopify/sync", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const id = req.params.id;
    const last = shopifyCooldown.get(id);
    if (last && Date.now() - last < 2 * 60_000) return res.status(429).json({ success: false, error: "A sync just ran; try again in a couple of minutes." });
    shopifyCooldown.set(id, Date.now());
    const { shopifySyncScheduler } = await import("../services/shopifySyncScheduler");
    const result: any = await shopifySyncScheduler.syncNow(id);
    if (!result?.success) shopifyCooldown.delete(id);
    res.status(result?.success ? 200 : 400).json(result);
  } catch (error: any) {
    shopifyCooldown.delete(req.params.id);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
