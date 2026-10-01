/**
 * One lead row per website conversation.
 *
 * Auto-capture (regex on the visitor's message) and the model's capture_lead tool both write the
 * lead, sometimes in the same turn. Every write goes through upsertConversationLead, which
 *  1. serialises writes per conversation inside this process (promise chain), and
 *  2. takes pg_advisory_xact_lock(hashtext('lead:<conversationId>')) inside a transaction, so two
 *     server instances can't both see "no lead yet" and insert two rows.
 * No unique index is added (production may already hold duplicates); when duplicates exist the
 * oldest row is the one updated.
 *
 * Returning visitor: when a conversation has no lead yet, the conversation carries a visitor token
 * and the same visitor has a lead in this account updated within RETURNING_VISITOR_DAYS, that lead
 * is reused (moved to this conversation and updated) instead of creating a new row — unless the new
 * details contradict it (different phone, email or name), which suggests a different person on a
 * shared device.
 */
import { and, asc, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { db } from '../../db';
import { conversations, leads, type Lead } from '@shared/schema';

export const RETURNING_VISITOR_DAYS = 30;

const chains = new Map<string, Promise<unknown>>();

/** Run `fn` after every earlier task queued under the same key (in this process). */
export function runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.then(() => undefined, () => undefined);
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

export type LeadField = 'name' | 'email' | 'phone' | 'message';

export interface LeadUpsert {
  businessAccountId: string;
  conversationId: string;
  values: Partial<Record<LeadField, string | null | undefined>> & { city?: string | null; sourceUrl?: string | null };
  /** Per field: 'replace' overwrites a different value (explicit capture), 'fill' only sets an empty one. Default 'replace' (name: 'fill' when the lead already has a real name and policy is unset). */
  policy?: Partial<Record<LeadField, 'replace' | 'fill'>>;
  /** Message stored on a newly created lead. */
  createMessage?: string;
  reuseReturningVisitorLead?: boolean;
}

export interface LeadUpsertResult {
  lead: Lead;
  created: boolean;
  changed: LeadField[];
  reusedFromConversationId: string | null;
}

const norm = (v?: string | null) => (v ?? '').trim();
const digits = (v?: string | null) => norm(v).replace(/\D/g, '').slice(-10);

function contradicts(existing: Lead, values: LeadUpsert['values']): boolean {
  if (norm(values.phone) && norm(existing.phone) && digits(values.phone) !== digits(existing.phone)) return true;
  if (norm(values.email) && norm(existing.email) && norm(values.email).toLowerCase() !== norm(existing.email).toLowerCase()) return true;
  if (norm(values.name) && norm(existing.name) && existing.name !== 'Anonymous'
    && norm(values.name).toLowerCase() !== norm(existing.name).toLowerCase()) return true;
  return false;
}

/** Longest the lead write waits for the customer-profile link (it continues in the background after). */
const PROFILE_LINK_WAIT_MS = 1500;

export async function upsertConversationLead(input: LeadUpsert): Promise<LeadUpsertResult> {
  const result = await writeConversationLead(input);
  // Same turn, not one turn later: link the customer profile as soon as the lead has a new phone /
  // email (whatsappHandoffService.linkWebsiteLeadProfile never throws).
  if (result.changed.includes('phone') || result.changed.includes('email')) {
    const link = import('../whatsappHandoffService').then(m => m.linkWebsiteLeadProfile(result.lead)).catch(() => undefined);
    await Promise.race([link, new Promise(r => setTimeout(r, PROFILE_LINK_WAIT_MS).unref?.())]);
  }
  return result;
}

function writeConversationLead(input: LeadUpsert): Promise<LeadUpsertResult> {
  const { businessAccountId, conversationId } = input;
  return runSerialized(`lead:${conversationId}`, () => db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lead:${conversationId}`}))`);
    let [existing] = await tx.select().from(leads)
      .where(and(eq(leads.conversationId, conversationId), eq(leads.businessAccountId, businessAccountId)))
      .orderBy(asc(leads.createdAt))
      .limit(1);

    let reusedFrom: string | null = null;
    if (!existing && input.reuseReturningVisitorLead !== false) {
      const [conv] = await tx.select({ visitorToken: conversations.visitorToken, isInternalTest: conversations.isInternalTest })
        .from(conversations).where(eq(conversations.id, conversationId)).limit(1);
      const token = conv?.visitorToken?.trim();
      if (token && conv?.isInternalTest !== 'true') {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`leadvisitor:${businessAccountId}:${token}`}))`);
        const since = new Date(Date.now() - RETURNING_VISITOR_DAYS * 24 * 60 * 60 * 1000);
        const [prior] = await tx.select({ lead: leads }).from(leads)
          .innerJoin(conversations, eq(conversations.id, leads.conversationId))
          .where(and(
            eq(leads.businessAccountId, businessAccountId),
            eq(conversations.businessAccountId, businessAccountId),
            eq(conversations.visitorToken, token),
            ne(conversations.id, conversationId),
            gt(leads.updatedAt, since),
          ))
          .orderBy(desc(leads.updatedAt))
          .limit(1);
        if (prior?.lead && !contradicts(prior.lead, input.values)) {
          existing = prior.lead;
          reusedFrom = prior.lead.conversationId;
        }
      }
    }

    const fields: LeadField[] = ['name', 'email', 'phone', 'message'];
    if (existing) {
      const updates: Record<string, any> = {};
      const changed: LeadField[] = [];
      for (const f of fields) {
        const incoming = norm(input.values[f]);
        if (!incoming) continue;
        const current = norm((existing as any)[f]);
        const policy = input.policy?.[f] ?? 'replace';
        const empty = !current || (f === 'name' && current === 'Anonymous');
        if (incoming === current) continue;
        // Same number in another format (the pre-chat OTP gate stores +91…, chat stores 10 digits).
        if (f === 'phone' && current && digits(incoming) === digits(current) && digits(incoming).length >= 8) continue;
        if (policy === 'fill' && !empty) continue;
        updates[f] = incoming;
        changed.push(f);
      }
      if (!norm(existing.city) && norm(input.values.city)) updates.city = norm(input.values.city);
      if (!norm(existing.sourceUrl) && norm(input.values.sourceUrl)) updates.sourceUrl = norm(input.values.sourceUrl);
      if (reusedFrom !== null) updates.conversationId = conversationId;
      if (Object.keys(updates).length === 0) {
        return { lead: existing, created: false, changed, reusedFromConversationId: reusedFrom };
      }
      updates.updatedAt = new Date();
      const [lead] = await tx.update(leads).set(updates).where(eq(leads.id, existing.id)).returning();
      return { lead, created: false, changed, reusedFromConversationId: reusedFrom };
    }

    const values = {
      businessAccountId,
      conversationId,
      name: norm(input.values.name) || null,
      email: norm(input.values.email) || null,
      phone: norm(input.values.phone) || null,
      message: norm(input.values.message) || input.createMessage || 'Via Chat',
      city: norm(input.values.city) || null,
      sourceUrl: norm(input.values.sourceUrl) || null,
    };
    const [lead] = await tx.insert(leads).values(values).returning();
    const changed = fields.filter(f => !!(values as any)[f] && f !== 'message');
    return { lead, created: true, changed, reusedFromConversationId: null };
  }));
}

/** Oldest lead of the conversation (stable when legacy duplicates exist). */
export async function getConversationLead(conversationId: string, businessAccountId: string): Promise<Lead | undefined> {
  const [lead] = await db.select().from(leads)
    .where(and(eq(leads.conversationId, conversationId), eq(leads.businessAccountId, businessAccountId)))
    .orderBy(asc(leads.createdAt))
    .limit(1);
  return lead;
}
