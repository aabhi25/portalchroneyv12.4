/**
 * Draft WhatsApp leads (per account, "require PAN + email").
 *
 * When an account requires it, a WhatsApp record is a draft until a valid PAN and
 * email have been collected: it is kept (forever) with its chat and documents, but
 * it is not listed or counted as a lead and is never sent to the CRM / LOS.
 * whatsapp_leads.qualified_at marks the moment it became a lead.
 *
 * qualified_at is refreshed after the main lead updates, by the CRM sync gate, and
 * by a sweep of recently active drafts (a safety net for any other writer).
 */
import { db } from "../db";
import { whatsappLeads, whatsappSettings, whatsappFlowSessions } from "@shared/schema";
import { and, eq, gte, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { evaluateLeadQualification, type LeadQualification } from "@shared/leadQualification";

const SETTING_TTL_MS = 30_000;
const settingCache = new Map<string, { required: boolean; at: number }>();

export async function isQualificationRequired(businessAccountId: string): Promise<boolean> {
  const cached = settingCache.get(businessAccountId);
  if (cached && Date.now() - cached.at < SETTING_TTL_MS) return cached.required;
  const [row] = await db
    .select({ v: whatsappSettings.requirePanEmailForLead })
    .from(whatsappSettings)
    .where(eq(whatsappSettings.businessAccountId, businessAccountId))
    .limit(1);
  const required = row?.v === "true";
  settingCache.set(businessAccountId, { required, at: Date.now() });
  return required;
}

export function forgetQualificationSetting(businessAccountId: string) {
  settingCache.delete(businessAccountId);
}

/** Condition for "is a lead" (true) or "is a draft" (false) when the account requires PAN + email. */
export function qualifiedCondition(qualified: boolean): SQL {
  return qualified ? sql`${whatsappLeads.qualifiedAt} IS NOT NULL` : sql`${whatsappLeads.qualifiedAt} IS NULL`;
}

export interface RefreshResult {
  qualification: LeadQualification;
  /** Became a lead just now. */
  promoted: boolean;
}

/**
 * Re-checks one lead and stamps qualified_at the first time it has a valid PAN and email.
 * A lead is never turned back into a draft. When a draft is promoted after its form was
 * already finished, it is sent to the CRM (the completion push was skipped while it was a draft).
 */
export async function refreshLeadQualification(leadId: string, opts: { pushToCrm?: boolean } = {}): Promise<RefreshResult | null> {
  const [lead] = await db
    .select({
      id: whatsappLeads.id,
      businessAccountId: whatsappLeads.businessAccountId,
      status: whatsappLeads.status,
      customerEmail: whatsappLeads.customerEmail,
      extractedData: whatsappLeads.extractedData,
      qualifiedAt: whatsappLeads.qualifiedAt,
      senderPhone: whatsappLeads.senderPhone,
    })
    .from(whatsappLeads)
    .where(eq(whatsappLeads.id, leadId))
    .limit(1);
  if (!lead || lead.status === "message_only") return null;

  const qualification = evaluateLeadQualification(lead);
  if (!qualification.qualified || lead.qualifiedAt) return { qualification, promoted: false };

  const stamped = await db
    .update(whatsappLeads)
    .set({ qualifiedAt: new Date() })
    .where(and(eq(whatsappLeads.id, leadId), isNull(whatsappLeads.qualifiedAt)))
    .returning({ id: whatsappLeads.id });
  const promoted = stamped.length > 0;

  if (promoted && (await isQualificationRequired(lead.businessAccountId))) {
    console.log(`[LeadQualification] Lead ${leadId} now has PAN + email — no longer a draft`);
    if (opts.pushToCrm !== false) await pushIfFormFinished(lead.businessAccountId, lead.senderPhone, leadId);
  }
  return { qualification, promoted };
}

/** Fire-and-forget variant for callers that must not fail because of this check. */
export function refreshLeadQualificationLater(leadId: string | null | undefined) {
  if (!leadId) return;
  refreshLeadQualification(leadId).catch(err =>
    console.error(`[LeadQualification] Refresh failed for ${leadId}:`, err?.message || err),
  );
}

async function pushIfFormFinished(businessAccountId: string, senderPhone: string | null, leadId: string) {
  // While the customer is still filling the form, the completion push sends everything together.
  if (senderPhone) {
    const [active] = await db
      .select({ id: whatsappFlowSessions.id })
      .from(whatsappFlowSessions)
      .where(and(
        eq(whatsappFlowSessions.businessAccountId, businessAccountId),
        eq(whatsappFlowSessions.senderPhone, senderPhone),
        eq(whatsappFlowSessions.status, "active"),
      ))
      .limit(1);
    if (active) return;
  }
  const { syncWhatsappLeadToCustomCrm } = await import("./customCrmService");
  const result = await syncWhatsappLeadToCustomCrm(leadId, { source: "qualified", requireAutoSync: true });
  if (!result.skipped) console.log(`[LeadQualification] Lead ${leadId} pushed to CRM after qualifying: ${result.message}`);
}

/**
 * Evaluates every lead of an account (used when the setting is turned on, and for a preview).
 * Stamps qualified_at on leads that already have PAN + email; nothing is sent to the CRM.
 */
export async function evaluateAccountLeads(businessAccountId: string, opts: { apply: boolean }): Promise<{ total: number; leads: number; drafts: number }> {
  const rows = await db
    .select({
      id: whatsappLeads.id,
      customerEmail: whatsappLeads.customerEmail,
      extractedData: whatsappLeads.extractedData,
      qualifiedAt: whatsappLeads.qualifiedAt,
    })
    .from(whatsappLeads)
    .where(and(eq(whatsappLeads.businessAccountId, businessAccountId), ne(whatsappLeads.status, "message_only")));

  let leads = 0;
  const toStamp: string[] = [];
  for (const row of rows) {
    if (row.qualifiedAt || evaluateLeadQualification(row).qualified) {
      leads++;
      if (!row.qualifiedAt) toStamp.push(row.id);
    }
  }
  if (opts.apply) {
    for (let i = 0; i < toStamp.length; i += 200) {
      const batch = toStamp.slice(i, i + 200);
      await db
        .update(whatsappLeads)
        .set({ qualifiedAt: new Date() })
        .where(and(isNull(whatsappLeads.qualifiedAt), sql`${whatsappLeads.id} IN (${sql.join(batch.map(id => sql`${id}`), sql`, `)})`));
    }
  }
  return { total: rows.length, leads, drafts: rows.length - leads };
}

// ── Safety-net sweep ──────────────────────────────────────────────────────────
const SWEEP_EVERY_MS = 3 * 60_000;
const SWEEP_LOOKBACK_MS = 2 * 24 * 60 * 60_000;
let sweepTimer: NodeJS.Timeout | null = null;

export async function sweepRecentDrafts(): Promise<number> {
  const since = new Date(Date.now() - SWEEP_LOOKBACK_MS);
  const rows = await db
    .select({ id: whatsappLeads.id })
    .from(whatsappLeads)
    .innerJoin(whatsappSettings, eq(whatsappSettings.businessAccountId, whatsappLeads.businessAccountId))
    .where(and(
      eq(whatsappSettings.requirePanEmailForLead, "true"),
      isNull(whatsappLeads.qualifiedAt),
      ne(whatsappLeads.status, "message_only"),
      or(gte(whatsappLeads.updatedAt, since), gte(whatsappLeads.lastMessageAt, since)),
    ))
    .limit(500);
  let promoted = 0;
  for (const { id } of rows) {
    try {
      if ((await refreshLeadQualification(id))?.promoted) promoted++;
    } catch (err: any) {
      console.error(`[LeadQualification] Sweep failed for ${id}:`, err?.message || err);
    }
  }
  return promoted;
}

export function startLeadQualificationSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepRecentDrafts()
      .then(n => { if (n > 0) console.log(`[LeadQualification] Sweep: ${n} draft(s) became leads`); })
      .catch(err => console.error("[LeadQualification] Sweep error:", err?.message || err));
  }, SWEEP_EVERY_MS);
  sweepTimer.unref?.();
}
