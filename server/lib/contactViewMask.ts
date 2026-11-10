/**
 * "Hide from view" (auto-delete settings, hideContactsFromView): a lead's phone numbers and emails
 * are shown hidden in the portal from the moment the lead comes in. Nothing is overwritten in the
 * database, so CRM sync, retries, AI calls and WhatsApp keep using the real values. Super admins
 * still see the real details.
 *
 * Applied in one place: a middleware that hides contacts in the JSON of every portal route that
 * shows website leads or their chats (lists, details, exports, timelines, group admin views).
 * Exports build their file in the browser from that JSON, so they are covered too.
 */
import type { NextFunction, Request, Response } from "express";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { accountGroupMembers, dataRetentionPolicies } from "@shared/schema";
import { maskContactsInText, maskPhoneNumber, isMaskedValue } from "@shared/contactMasking";

// ---------------------------------------------------------------------------
// Which accounts hide contacts from view (same rule as getEffectivePolicy: an account's own
// policy wins; otherwise any of its groups)
// ---------------------------------------------------------------------------

const CACHE_MS = 30_000;
let cache: { at: number; own: Map<string, boolean>; viaGroup: Set<string> } | null = null;

export function clearContactViewMaskCache() {
  cache = null;
}

async function loadRules() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const rows = await db.select({
    scopeType: dataRetentionPolicies.scopeType,
    scopeId: dataRetentionPolicies.scopeId,
    hide: dataRetentionPolicies.hideContactsFromView,
  }).from(dataRetentionPolicies);
  const own = new Map<string, boolean>();
  const hidingGroups: string[] = [];
  for (const r of rows) {
    if (r.scopeType === "account") own.set(r.scopeId, r.hide === true);
    else if (r.scopeType === "group" && r.hide === true) hidingGroups.push(r.scopeId);
  }
  const viaGroup = new Set<string>();
  if (hidingGroups.length) {
    const members = await db.select({ id: accountGroupMembers.businessAccountId }).from(accountGroupMembers)
      .where(inArray(accountGroupMembers.groupId, hidingGroups));
    members.forEach(m => viaGroup.add(m.id));
  }
  cache = { at: Date.now(), own, viaGroup };
  return cache;
}

/** True when this account's leads are shown with hidden contact details. */
export async function hidesContactsFromView(accountId: string): Promise<boolean> {
  const rules = await loadRules();
  return rules.own.has(accountId) ? rules.own.get(accountId)! : rules.viaGroup.has(accountId);
}

async function anyHides(accountIds: string[]): Promise<boolean> {
  for (const id of accountIds) if (await hidesContactsFromView(id)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Hiding values inside a JSON response
// ---------------------------------------------------------------------------

// Keys whose values are IDs, links or times, never contact details. Hiding a digit run inside
// them would break links and lookups.
const SKIP_KEY = /^(id|key|url|href|src|path)$|(Id|Ids|_id|_ids|Url|_url|Href|Path|_path|At|_at|Key)$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const PHONE_KEY = /^(phone|mobile|whatsapp|whatsappNumber|phoneNumber|contactNumber|customerPhone)$/i;

/** Hides phones/emails in free text, leaving any IDs inside it untouched. */
function hideInText(text: string): string {
  if (!/@|\d[\d\s-]{6,}\d/.test(text)) return text;
  let out = "";
  let last = 0;
  for (const m of Array.from(text.matchAll(UUID))) {
    out += maskContactsInText(text.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  return out + maskContactsInText(text.slice(last));
}

/**
 * A copy of `value` with phone numbers and emails hidden. Objects that carried a contact field
 * get `contactsHiddenFromView: true`, so the page knows the real details still exist (Sync stays
 * available; the number just isn't shown).
 */
export function hideContactsForView<T>(value: T, key = ""): T {
  if (typeof value === "string") {
    if (SKIP_KEY.test(key)) return value;
    // A phone field may hold a number in a shape the free-text rules don't catch ("98765-43210").
    if (PHONE_KEY.test(key) && !isMaskedValue(value) && (value.match(/\d/g) || []).length >= 7) return maskPhoneNumber(value) as T;
    return hideInText(value) as T;
  }
  if (typeof value === "number" && PHONE_KEY.test(key)) return maskPhoneNumber(String(value)) as T;
  if (Array.isArray(value)) return value.map(v => hideContactsForView(v, key)) as T;
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    let changedContact = false;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = hideContactsForView(v, k);
      if ((k === "phone" || k === "email") && next !== v) changedContact = true;
      out[k] = next;
    }
    if (changedContact) out.contactsHiddenFromView = true;
    return out as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/** Business-side routes (one account: the one the user has open) that show website leads or chats. */
const ACCOUNT_ROUTES: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^\/api\/leads(\/.*)?$/ },
  { method: "POST", path: /^\/api\/leads\/story$/ },
  { method: "GET", path: /^\/api\/conversations(\/[^/]+(\/messages)?)?$/ },
  { method: "GET", path: /^\/api\/journey-leads$/ },
  { method: "GET", path: /^\/api\/analytics\/visitor-journeys(\/[^/]+)?$/ },
  { method: "GET", path: /^\/api\/insights\/conversation-analysis$/ },
  { method: "GET", path: /^\/api\/calling\/calls(\/[^/]+)?$/ },
];

/** Group admin routes: hidden when any account of the group hides. */
const GROUP_ROUTE = /^\/api\/group-admin\/groups\/([^/]+)\/(leads|conversations|journey-responses|journey-responses-by-lead|accounts\/[^/]+\/conversation-analysis)(\/|$)/;

/** In the combined Leads list, only website leads are hidden (WhatsApp/Instagram/Facebook keep theirs). */
function hideForRoute(path: string, body: unknown): unknown {
  if (/^\/api\/leads\/unified(\/export)?$/.test(path) && body && typeof body === "object" && Array.isArray((body as any).leads)) {
    const b = body as { leads: any[] };
    return { ...b, leads: b.leads.map(row => (row?.channel === "website" ? hideContactsForView(row) : row)) };
  }
  return hideContactsForView(body);
}

async function accountsFor(req: Request, path: string): Promise<string[] | null> {
  const user = req.user;
  if (!user) return null;
  const group = path.match(GROUP_ROUTE);
  if (group) {
    const members = await db.select({ id: accountGroupMembers.businessAccountId }).from(accountGroupMembers)
      .where(inArray(accountGroupMembers.groupId, [group[1]]));
    return members.map(m => m.id);
  }
  if (ACCOUNT_ROUTES.some(r => r.method === req.method && r.path.test(path))) {
    const accountId = user.agency?.viewingClientId || user.activeBusinessAccountId || user.businessAccountId;
    return accountId ? [accountId] : null;
  }
  return null;
}

export function contactViewMaskMiddleware(req: Request, res: Response, next: NextFunction) {
  const path = req.path;
  if (!path.startsWith("/api/leads") && !path.startsWith("/api/conversations") && !path.startsWith("/api/journey-leads")
    && !path.startsWith("/api/analytics/visitor-journeys") && !path.startsWith("/api/insights/conversation-analysis")
    && !path.startsWith("/api/calling/calls") && !path.startsWith("/api/group-admin/groups/")) {
    return next();
  }
  const send = res.json.bind(res);
  res.json = ((body: unknown) => {
    // Errors and super admins: as is. Decided at send time, after requireAuth has set req.user.
    if (res.statusCode >= 400 || !req.user || req.user.role === "super_admin") return send(body);
    accountsFor(req, path)
      .then(async ids => (ids && ids.length && (await anyHides(ids)) ? hideForRoute(path, body) : body))
      // If the check itself fails, hide rather than risk showing the details.
      .catch(err => {
        console.error("[ContactViewMask] check failed, hiding:", err?.message);
        return hideForRoute(path, body);
      })
      .then(out => send(out));
    return res;
  }) as Response["json"];
  next();
}
