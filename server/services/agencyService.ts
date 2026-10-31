/**
 * Agencies (resellers). A super admin creates an agency, sets what it may resell and do
 * (shared/agency.ts), and gives it logins (users.role = 'agency_admin', agency_admins row).
 * Agency logins manage the client accounts whose business_accounts.agency_id is theirs and
 * can open a client's portal (the session's active account), where they act as that client.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { agencies, agencyAdmins, businessAccounts, users, type Agency } from "@shared/schema";
import {
  AGENCY_FEATURE_KEYS,
  computeAgencyStatement,
  resolveAgencyBilling,
  resolveAgencyBranding,
  resolveAgencyPermissions,
  type AgencyContextDto,
  type AgencyFeatureKey,
  type AgencyPermissions,
  type AgencyStatement,
} from "@shared/agency";
import { getMonthSpend, usdInrRate } from "./aiBudgetService";

/** What requireAuth attaches to an agency login's request. */
export interface AgencySession {
  agencyId: string;
  agencyName: string;
  adminRole: "owner" | "staff";
  permissions: AgencyPermissions;
  /** The client portal this login is looking at (already checked to belong to the agency). */
  viewingClientId: string | null;
}

export async function getAgencyLogin(userId: string): Promise<{ agency: Agency; adminRole: "owner" | "staff" } | null> {
  const [row] = await db
    .select({ agency: agencies, role: agencyAdmins.role })
    .from(agencyAdmins)
    .innerJoin(agencies, eq(agencies.id, agencyAdmins.agencyId))
    .where(eq(agencyAdmins.userId, userId))
    .limit(1);
  if (!row) return null;
  return { agency: row.agency, adminRole: row.role === "owner" ? "owner" : "staff" };
}

/**
 * The agency side of a session, or null when the login has no (active) agency.
 * The session's active account counts only if it belongs to the agency and the agency may
 * open client portals; anything else is ignored, so a stale session can't reach other data.
 */
export async function loadAgencySession(userId: string, activeBusinessAccountId: string | null): Promise<AgencySession | null> {
  const login = await getAgencyLogin(userId);
  if (!login || login.agency.status !== "active") return null;
  const permissions = resolveAgencyPermissions(login.agency.permissions);
  let viewingClientId: string | null = null;
  if (activeBusinessAccountId && permissions.openClientPortal) {
    const [acct] = await db
      .select({ id: businessAccounts.id })
      .from(businessAccounts)
      .where(and(eq(businessAccounts.id, activeBusinessAccountId), eq(businessAccounts.agencyId, login.agency.id)))
      .limit(1);
    viewingClientId = acct?.id ?? null;
  }
  return {
    agencyId: login.agency.id,
    agencyName: login.agency.name,
    adminRole: login.adminRole,
    permissions,
    viewingClientId,
  };
}

export async function getAgencyContextDto(session: AgencySession): Promise<AgencyContextDto> {
  const [agency] = await db.select().from(agencies).where(eq(agencies.id, session.agencyId)).limit(1);
  let viewingClient: AgencyContextDto["viewingClient"] = null;
  if (session.viewingClientId) {
    const [acct] = await db
      .select({ id: businessAccounts.id, name: businessAccounts.name })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, session.viewingClientId))
      .limit(1);
    if (acct) viewingClient = { businessAccountId: acct.id, name: acct.name };
  }
  return {
    agencyId: session.agencyId,
    agencyName: session.agencyName,
    brandName: resolveAgencyBranding(agency?.branding, session.agencyName).brandName,
    adminRole: session.adminRole,
    permissions: session.permissions,
    viewingClient,
  };
}

export async function getAgency(agencyId: string): Promise<Agency | null> {
  const [row] = await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  return row ?? null;
}

/** The agency an account belongs to (null for direct customers). */
export async function getAgencyForAccount(businessAccountId: string): Promise<Agency | null> {
  const [row] = await db
    .select({ agency: agencies })
    .from(businessAccounts)
    .innerJoin(agencies, eq(agencies.id, businessAccounts.agencyId))
    .where(eq(businessAccounts.id, businessAccountId))
    .limit(1);
  return row?.agency ?? null;
}

export async function countAgencyAccounts(agencyId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(businessAccounts)
    .where(eq(businessAccounts.agencyId, agencyId));
  return Number(row?.n ?? 0);
}

/** The agency's client accounts with the fields its pages need, plus each client's login. */
export async function listAgencyAccounts(agencyId: string) {
  const accounts = await db
    .select()
    .from(businessAccounts)
    .where(eq(businessAccounts.agencyId, agencyId))
    .orderBy(asc(businessAccounts.name));
  const ids = accounts.map(a => a.id);
  const logins = ids.length
    ? await db
        .select({ businessAccountId: users.businessAccountId, username: users.username, lastLoginAt: users.lastLoginAt })
        .from(users)
        .where(inArray(users.businessAccountId, ids))
    : [];
  const loginOf = new Map(logins.map(l => [l.businessAccountId!, l]));
  return accounts.map(a => ({ account: a, login: loginOf.get(a.id) ?? null }));
}

/** Feature switches of an account as { key: boolean } for the resellable catalogue. */
export function accountFeatures(account: Record<string, unknown>): Record<AgencyFeatureKey, boolean> {
  const out = {} as Record<AgencyFeatureKey, boolean>;
  for (const k of AGENCY_FEATURE_KEYS) out[k] = account[k] === "true";
  return out;
}

export async function agencyMonthSpendByAccount(agencyId: string, month: string): Promise<Map<string, number>> {
  const rows = await db.select({ id: businessAccounts.id }).from(businessAccounts).where(eq(businessAccounts.agencyId, agencyId));
  return getMonthSpend(rows.map(r => r.id), month);
}

export async function buildAgencyStatement(agency: Agency, month: string): Promise<AgencyStatement> {
  const rows = await listAgencyAccounts(agency.id);
  const spend = await getMonthSpend(rows.map(r => r.account.id), month);
  return computeAgencyStatement({
    month,
    billing: resolveAgencyBilling(agency.billing),
    usdToInr: usdInrRate(),
    accounts: rows.map(r => ({
      businessAccountId: r.account.id,
      name: r.account.name,
      status: r.account.status,
      aiCostUsd: spend.get(r.account.id) ?? 0,
    })),
  });
}

/** 12-character temporary password, same alphabet as super admin account creation. */
export function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
