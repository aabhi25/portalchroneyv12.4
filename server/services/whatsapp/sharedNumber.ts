/**
 * Shared WhatsApp number: one account (the owner) has the MSG91 connection and number; linked
 * accounts use it.
 *
 * Sending: withSharedNumber() puts the owner's MSG91 key, number, integrated number ID and 24-hour
 * template in place of a linked account's own, wherever WhatsApp settings are loaded for sending.
 * Everything else (AI replies, journeys, lead capture, allowed numbers) stays the account's own.
 *
 * Receiving: MSG91 posts every message for the number to the owner's webhook. routeSharedInbound()
 * picks the account, in this order:
 *   1. a website hand-off code "(Ref: K7Q2MX)" created by one of the accounts,
 *   2. a landing-page tag "(SYM-BBA)" from that account's WhatsApp link (removed from the text),
 *   3. a campaign/template one of the accounts sent this number in the last 7 days (newest wins),
 *   4. the account this number last wrote to in the last 30 days,
 *   5. otherwise the owner.
 * Delivery receipts go to whichever account sent the message (accountsOnNumber()).
 * Opt-outs are shared: "Stop" to one account stops all of them (contactGroupService.getOptOutSet).
 */
import crypto from "crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  accountGroupMembers,
  businessAccounts,
  whatsappHandoffs,
  whatsappNumberShares,
  whatsappSessions,
  whatsappSettings,
  type WhatsappNumberShare,
  type WhatsappSettings,
} from "@shared/schema";
import { findRefCodes } from "../whatsappHandoffService";

const CACHE_MS = 30_000;
const CAMPAIGN_REPLY_DAYS = 7;
const RECENT_CHAT_DAYS = 30;

let cache: { at: number; rows: WhatsappNumberShare[] } | null = null;

export function clearSharedNumberCache() {
  cache = null;
}

async function allShares(): Promise<WhatsappNumberShare[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = await db.select().from(whatsappNumberShares).orderBy(whatsappNumberShares.createdAt);
  cache = { at: Date.now(), rows };
  return rows;
}

/** The owner whose number this account uses, or null when it uses its own. */
export async function sharedOwnerOf(accountId: string): Promise<string | null> {
  return (await allShares()).find((s) => s.linkedAccountId === accountId)?.ownerAccountId ?? null;
}

/** The accounts this owner shares its number with (oldest first). */
export async function sharesOfOwner(ownerId: string): Promise<WhatsappNumberShare[]> {
  return (await allShares()).filter((s) => s.ownerAccountId === ownerId);
}

/** Every account on the same number as this one, owner first; null when the number isn't shared. */
export async function shareSetOf(accountId: string): Promise<{ ownerId: string; accountIds: string[] } | null> {
  const ownerId = (await sharedOwnerOf(accountId)) ?? accountId;
  const linked = await sharesOfOwner(ownerId);
  if (linked.length === 0) return null;
  return { ownerId, accountIds: [ownerId, ...linked.map((s) => s.linkedAccountId)] };
}

/** Every account on this account's number (just itself when the number isn't shared). */
export async function accountsOnNumber(accountId: string): Promise<string[]> {
  return (await shareSetOf(accountId))?.accountIds ?? [accountId];
}

/** Fields a linked account takes from the owner. */
export const SHARED_SENDING_FIELDS = ["msg91AuthKey", "whatsappNumber", "msg91IntegratedNumberId", "sessionTemplateName", "sessionTemplateNamespace"] as const;

export type SharedSettings<T> = T & { sharedNumberOwnerId?: string };

/** A linked account's WhatsApp settings with the owner's sending details; anything else as it is. */
export async function withSharedNumber<T extends WhatsappSettings | null | undefined>(accountId: string, settings: T): Promise<SharedSettings<T>> {
  if (!settings) return settings as SharedSettings<T>;
  const ownerId = await sharedOwnerOf(accountId);
  if (!ownerId) return settings as SharedSettings<T>;
  const [owner] = await db.select().from(whatsappSettings).where(eq(whatsappSettings.businessAccountId, ownerId)).limit(1);
  if (!owner) return settings as SharedSettings<T>;
  const out: Record<string, unknown> = { ...settings, sharedNumberOwnerId: ownerId };
  for (const field of SHARED_SENDING_FIELDS) out[field] = owner[field];
  return out as SharedSettings<T>;
}

/** For the WhatsApp settings screen: whether this account uses or shares a number. */
export async function sharedNumberSummary(accountId: string) {
  const share = (await allShares()).find((s) => s.linkedAccountId === accountId);
  if (share) {
    const [owner] = await db.select({ name: businessAccounts.name, number: whatsappSettings.whatsappNumber })
      .from(businessAccounts).leftJoin(whatsappSettings, eq(whatsappSettings.businessAccountId, businessAccounts.id))
      .where(eq(businessAccounts.id, share.ownerAccountId)).limit(1);
    return {
      role: "linked" as const,
      ownerAccountId: share.ownerAccountId,
      ownerName: owner?.name ?? "another account",
      number: owner?.number ?? null,
      tag: share.tag,
      landingPageLink: landingPageLink(owner?.number, share.tag),
    };
  }
  const linked = await sharesOfOwner(accountId);
  return linked.length ? { role: "owner" as const, linkedCount: linked.length } : { role: "none" as const };
}

// ---------------------------------------------------------------------------
// Landing-page tags
// ---------------------------------------------------------------------------

const TAG_RE = /\(\s*([A-Za-z0-9]{2,4}-[A-Za-z2-9]{4})\s*\)/g;
const TAG_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** "Symbiosis Online BBA" → "SOB-7KQ2". The random part keeps tags unique. */
export function newShareTag(accountName: string): string {
  const letters = accountName.split(/[^A-Za-z]+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("").slice(0, 3) || "WA";
  let tail = "";
  for (let i = 0; i < 4; i++) tail += TAG_ALPHABET[crypto.randomInt(TAG_ALPHABET.length)];
  return `${letters}-${tail}`;
}

export function findShareTags(text: string): string[] {
  const out: string[] = [];
  for (const m of Array.from(String(text || "").matchAll(TAG_RE))) out.push(m[1].toUpperCase());
  return out;
}

/** The message without the tag; a message that was only the tag becomes "Hi". */
export function stripShareTag(text: string, tag: string): string {
  const stripped = String(text).replace(TAG_RE, (whole, found: string) => (found.toUpperCase() === tag ? " " : whole)).replace(/\s{2,}/g, " ").trim();
  return stripped || "Hi";
}

export const LANDING_PAGE_MESSAGE = "Hi, I'd like to know more.";

/** The wa.me link a landing page's WhatsApp icon should open for this account. */
export function landingPageLink(number: string | null | undefined, tag: string): string | null {
  const digits = String(number || "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(`${LANDING_PAGE_MESSAGE} (${tag})`)}`;
}

// ---------------------------------------------------------------------------
// Routing an incoming message
// ---------------------------------------------------------------------------

export type SharedRouteReason = "ref" | "tag" | "campaign" | "recent" | "owner";

export interface SharedRoute {
  accountId: string;
  /** The message text to process (a landing-page tag is removed). */
  text: string;
  reason: SharedRouteReason;
}

/** Which account a message to the owner's shared number is for; null when the owner shares nothing. */
export async function routeSharedInbound(ownerId: string, senderPhone: string, text: string | null | undefined): Promise<SharedRoute | null> {
  const shares = await sharesOfOwner(ownerId);
  if (shares.length === 0) return null;
  const ids = [ownerId, ...shares.map((s) => s.linkedAccountId)];
  const body = String(text ?? "");

  // 1. Website hand-off code: the account whose website created it (left in the text; the
  //    account's own hand-off step links the chats and removes it).
  const codes = findRefCodes(body);
  if (codes.length) {
    const [row] = await db.select({ accountId: whatsappHandoffs.businessAccountId }).from(whatsappHandoffs)
      .where(and(inArray(whatsappHandoffs.code, codes), inArray(whatsappHandoffs.businessAccountId, ids), gte(whatsappHandoffs.expiresAt, new Date())))
      .orderBy(desc(whatsappHandoffs.createdAt)).limit(1);
    if (row) return { accountId: row.accountId, text: body, reason: "ref" };
  }

  // 2. Landing-page tag.
  for (const tag of findShareTags(body)) {
    const share = shares.find((s) => s.tag.toUpperCase() === tag);
    if (share) return { accountId: share.linkedAccountId, text: stripShareTag(body, tag), reason: "tag" };
  }

  // 3. A reply to a campaign or template one of the accounts sent.
  const { marketingCampaignService } = await import("../marketingCampaignService");
  let campaign: { accountId: string; at: number } | null = null;
  const since = Date.now() - CAMPAIGN_REPLY_DAYS * 24 * 3600_000;
  for (const id of ids) {
    const hit = await marketingCampaignService.findActiveRecipientForInbound(id, senderPhone);
    if (!hit) continue;
    const at = new Date(hit.recipient.sentAt ?? hit.recipient.createdAt).getTime();
    if (at >= since && (!campaign || at > campaign.at)) campaign = { accountId: id, at };
  }
  if (campaign) return { accountId: campaign.accountId, text: body, reason: "campaign" };

  // 4. The account this number last wrote to.
  const digits = senderPhone.replace(/\D/g, "");
  const [recent] = await db.select({ accountId: whatsappSessions.businessAccountId }).from(whatsappSessions)
    .where(and(
      inArray(whatsappSessions.businessAccountId, ids),
      sql`regexp_replace(${whatsappSessions.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`,
      gte(whatsappSessions.lastUserMessageAt, new Date(Date.now() - RECENT_CHAT_DAYS * 24 * 3600_000)),
    ))
    .orderBy(desc(whatsappSessions.lastUserMessageAt)).limit(1);
  if (recent) return { accountId: recent.accountId, text: body, reason: "recent" };

  // 5. The owner.
  return { accountId: ownerId, text: body, reason: "owner" };
}

// ---------------------------------------------------------------------------
// Linking accounts
// ---------------------------------------------------------------------------

export class ShareError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

async function groupIdsOf(accountId: string): Promise<string[]> {
  const rows = await db.select({ groupId: accountGroupMembers.groupId }).from(accountGroupMembers).where(eq(accountGroupMembers.businessAccountId, accountId));
  return rows.map((r) => r.groupId);
}

/** Accounts that may be linked to this owner: in one of its account groups, with WhatsApp turned on. */
export async function linkCandidates(ownerId: string) {
  const groups = await groupIdsOf(ownerId);
  if (groups.length === 0) return [];
  const members = await db.selectDistinct({ id: businessAccounts.id, name: businessAccounts.name, whatsappEnabled: businessAccounts.whatsappEnabled })
    .from(accountGroupMembers)
    .innerJoin(businessAccounts, eq(businessAccounts.id, accountGroupMembers.businessAccountId))
    .where(inArray(accountGroupMembers.groupId, groups));
  const shares = await allShares();
  const own = await db.select({ accountId: whatsappSettings.businessAccountId, number: whatsappSettings.whatsappNumber })
    .from(whatsappSettings).where(inArray(whatsappSettings.businessAccountId, members.map((m) => m.id)));
  return members
    .filter((m) => m.id !== ownerId)
    .map((m) => {
      const linkedTo = shares.find((s) => s.linkedAccountId === m.id)?.ownerAccountId ?? null;
      const isOwner = shares.some((s) => s.ownerAccountId === m.id);
      return {
        businessAccountId: m.id,
        name: m.name,
        whatsappEnabled: m.whatsappEnabled === "true",
        hasOwnNumber: !!own.find((o) => o.accountId === m.id && (o.number || "").replace(/\D/g, "").length >= 8),
        linkedHere: linkedTo === ownerId,
        linkedElsewhere: !!linkedTo && linkedTo !== ownerId,
        sharesItsOwn: isOwner,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Links an account to the owner's number, turning WhatsApp on for it when it is off. Its own
 * WhatsApp details stay saved for when it is removed.
 */
export async function linkAccount(ownerId: string, accountId: string, userId: string | undefined): Promise<WhatsappNumberShare & { whatsappTurnedOn: boolean }> {
  if (ownerId === accountId) throw new ShareError("An account can't share a number with itself");
  if (await sharedOwnerOf(ownerId)) throw new ShareError("This account uses another account's number, so it can't share one");
  const [owner] = await db.select().from(whatsappSettings).where(eq(whatsappSettings.businessAccountId, ownerId)).limit(1);
  if (!owner?.msg91AuthKey || !owner.msg91IntegratedNumberId || !owner.whatsappNumber) {
    throw new ShareError("Save this account's MSG91 key, WhatsApp number and Integrated Number ID first");
  }
  const candidate = (await linkCandidates(ownerId)).find((c) => c.businessAccountId === accountId);
  if (!candidate) throw new ShareError("Only accounts in the same account group can be linked");
  if (candidate.linkedHere) throw new ShareError(`${candidate.name} already uses this number`);
  if (candidate.linkedElsewhere) throw new ShareError(`${candidate.name} already uses another account's number`);
  if (candidate.sharesItsOwn) throw new ShareError(`${candidate.name} shares its own number with other accounts`);

  // The linked account needs its own settings row (AI replies, journeys, lead capture) and webhook secret.
  const { whatsappService } = await import("../whatsappService");
  const ownSettings = await whatsappService.getOwnSettings(accountId);
  if (!ownSettings) await whatsappService.saveSettings(accountId, { webhookSecret: whatsappService.generateWebhookSecret() } as any);

  let row: WhatsappNumberShare | undefined;
  for (let attempt = 0; attempt < 6 && !row; attempt++) {
    const inserted = await db.insert(whatsappNumberShares)
      .values({ ownerAccountId: ownerId, linkedAccountId: accountId, tag: newShareTag(candidate.name), createdBy: userId ?? null })
      .onConflictDoNothing().returning();
    row = inserted[0];
    if (!row && (await db.select({ id: whatsappNumberShares.id }).from(whatsappNumberShares).where(eq(whatsappNumberShares.linkedAccountId, accountId)).limit(1)).length) {
      throw new ShareError(`${candidate.name} already uses a shared number`);
    }
  }
  if (!row) throw new ShareError("Couldn't create a landing-page tag, please try again", 500);
  clearSharedNumberCache();
  // Messages for an account with WhatsApp off are turned away, so linking switches it on.
  if (!candidate.whatsappEnabled) {
    await db.update(businessAccounts).set({ whatsappEnabled: "true", updatedAt: new Date() }).where(eq(businessAccounts.id, accountId));
  }
  return { ...row, whatsappTurnedOn: !candidate.whatsappEnabled };
}

export async function unlinkAccount(ownerId: string, accountId: string): Promise<boolean> {
  const removed = await db.delete(whatsappNumberShares)
    .where(and(eq(whatsappNumberShares.ownerAccountId, ownerId), eq(whatsappNumberShares.linkedAccountId, accountId)))
    .returning({ id: whatsappNumberShares.id });
  clearSharedNumberCache();
  return removed.length > 0;
}

export async function unlinkAll(ownerId: string): Promise<number> {
  const removed = await db.delete(whatsappNumberShares).where(eq(whatsappNumberShares.ownerAccountId, ownerId)).returning({ id: whatsappNumberShares.id });
  clearSharedNumberCache();
  return removed.length;
}
