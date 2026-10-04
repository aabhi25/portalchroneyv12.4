/**
 * AI Calling — automatic call to a new lead.
 *
 * Hooked (fire-and-forget, never throws into lead saving) after:
 *   - storage.createLead (manual "Add lead", legacy chat tool, voice-mode, widget capture paths),
 *   - storage.updateLead when the lead had no phone before and now has one,
 *   - leadCapture/leadStore.upsertConversationLead (the main website-chat lead path) when the lead
 *     is created with a phone or gets its first phone.
 *
 * Lead source (settings.autoCallSources, empty = every source) — rows of the `leads` table:
 *   conversation titled "Voice Chat"          → 'voice'
 *   any other linked conversation             → 'website'
 *   message "Journey: …" (guided form)        → 'form'
 *   no conversation, message "Via Chat"       → 'website'
 *   no conversation otherwise (staff/import)  → 'other'
 * WhatsApp / Instagram / Facebook leads live in their own tables and are not auto-called yet
 * (those sources are accepted in settings for later).
 *
 * Rules: settings.enabled && settings.autoCallLeads && super admin switch on; lead has a valid phone;
 * source allowed; not on the do-not-call list; the lead was never auto-called before (one automatic
 * call chain per lead — a later phone change doesn't trigger another); no open call or any call in
 * the last 24 h for the same lead or number. Scheduled at now + autoCallDelayMinutes, moved to the next calling window when
 * outside calling hours. Consent is checked by the dialer at dial time (so a "please call me" said
 * in the chat during the delay still counts — see markConsentFromChat).
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { aiCalls, businessAccounts, conversations, type AiCall, type Lead } from "@shared/schema";
import { normalizeCallPhone } from "@shared/aiCalling";
import { effectiveHours, getSettingsRowCached, nextAllowedTime } from "./settingsService";
import { enqueueCall, findOpenOrRecentCall, isDoNotCall, markConsentFromChat } from "./dialer";

export type LeadSource = "website" | "whatsapp" | "instagram" | "facebook" | "voice" | "form" | "import" | "other";

export async function deriveLeadSource(lead: Pick<Lead, "conversationId" | "message" | "businessAccountId">): Promise<LeadSource> {
  if (/^journey:/i.test(lead.message || "")) return "form";
  if (lead.conversationId) {
    const [conv] = await db.select({ title: conversations.title }).from(conversations).where(eq(conversations.id, lead.conversationId)).limit(1);
    if (conv?.title === "Voice Chat") return "voice";
    return "website";
  }
  if ((lead.message || "").trim().toLowerCase() === "via chat") return "website";
  return "other";
}

export interface TriggerResult {
  queued: boolean;
  reason?: string;
  call?: AiCall;
}

const chains = new Map<string, Promise<unknown>>();

/** Serialise per business+number in this process so two quick saves of one lead can't both enqueue. */
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.then(() => undefined, () => undefined);
  chains.set(key, tail);
  void tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

/** Decide and enqueue (awaitable; used by tests). Prefer triggerAutoLeadCall in app code. */
export async function enqueueAutoLeadCall(lead: Lead, opts: { source?: LeadSource; now?: Date } = {}): Promise<TriggerResult> {
  const phone = normalizeCallPhone(lead.phone);
  if (!phone) return { queued: false, reason: "no_phone" };
  return serialized(`${lead.businessAccountId}:${phone}`, () => decideAndEnqueue(lead, phone, opts));
}

async function decideAndEnqueue(lead: Lead, phone: string, opts: { source?: LeadSource; now?: Date }): Promise<TriggerResult> {
  const now = opts.now ?? new Date();
  const settings = await getSettingsRowCached(lead.businessAccountId);
  if (!settings?.enabled || !settings.autoCallLeads) return { queued: false, reason: "auto_calls_off" };
  const [biz] = await db.select({ enabled: businessAccounts.aiCallingEnabled }).from(businessAccounts).where(eq(businessAccounts.id, lead.businessAccountId)).limit(1);
  if (biz?.enabled !== "true") return { queued: false, reason: "calling_off" };
  const source = opts.source ?? (await deriveLeadSource(lead));
  const sources = Array.isArray(settings.autoCallSources) ? settings.autoCallSources : [];
  if (sources.length && !sources.includes(source)) return { queued: false, reason: "source_not_selected" };
  if (lead.callConsent === "no") return { queued: false, reason: "no_consent" };
  if (await isDoNotCall(lead.businessAccountId, phone)) return { queued: false, reason: "do_not_call" };
  const [earlier] = await db.select({ id: aiCalls.id }).from(aiCalls)
    .where(and(eq(aiCalls.businessAccountId, lead.businessAccountId), eq(aiCalls.leadId, lead.id), eq(aiCalls.trigger, "auto_lead"))).limit(1);
  if (earlier) return { queued: false, reason: "already_called" };
  if (await findOpenOrRecentCall(lead.businessAccountId, { leadId: lead.id, phone })) return { queued: false, reason: "duplicate" };
  if (!lead.callConsent && settings.consentMode !== "business_attested") {
    await markConsentFromChat(lead).catch(() => false);
  }
  const at = nextAllowedTime(new Date(now.getTime() + settings.autoCallDelayMinutes * 60_000), effectiveHours(settings));
  const call = await enqueueCall({
    businessAccountId: lead.businessAccountId, phone, trigger: "auto_lead", provider: settings.provider, leadId: lead.id,
    scheduledAt: at, metadata: { rootTrigger: "auto_lead", leadSource: source },
  });
  return { queued: true, call };
}

/** Fire-and-forget hook for lead saving: never throws, never blocks. */
export function triggerAutoLeadCall(lead: Lead | null | undefined, opts: { source?: LeadSource } = {}): void {
  if (!lead || !lead.phone || !lead.businessAccountId) return;
  void enqueueAutoLeadCall(lead, opts).catch((err: any) => {
    console.error("[Calling] auto-call for new lead failed:", err?.message || err);
  });
}
