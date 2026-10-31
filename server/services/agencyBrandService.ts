/**
 * Agency brands on their own web addresses (agency phase 2).
 *
 * An agency can point its own address (e.g. app.agency.com) at us. Requests that arrive on it
 * get the agency's brand: page title and icon in the HTML, /api/brand for the login page, and
 * logins limited to that agency's people. Everything else (portal.aichroney.com, staging,
 * localhost) keeps our brand. The certificate for the address is issued in front of the app
 * (Cloudflare custom hostnames or Caddy on-demand TLS, which asks /api/domains/tls-check).
 */
import dns from "dns/promises";
import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { agencies, businessAccounts, type Agency } from "@shared/schema";
import { agencyPublicBrand, PLATFORM_BRAND, type PublicBrand } from "@shared/agency";

/** The host name the visitor typed (proxy-aware), lowercase, without port. */
export function requestHost(req: Request): string {
  const fwd = req.headers["x-forwarded-host"];
  const raw = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0] || req.headers.host || "";
  return raw.trim().toLowerCase().replace(/:\d+$/, "");
}

/** Our own domains, which no agency may claim. */
export function isPlatformDomain(domain: string): boolean {
  const own = (process.env.PLATFORM_DOMAINS || "aichroney.com,chroney.ai")
    .split(",").map(d => d.trim().toLowerCase()).filter(Boolean);
  return own.some(o => domain === o || domain.endsWith(`.${o}`))
    || /(^|\.)(localhost|replit\.dev|repl\.co|replit\.app)$/.test(domain);
}

// ── host → agency (cached) ───────────────────────────────────────────────────

const CACHE_MS = 60_000;
const hostCache = new Map<string, { agency: Agency | null; at: number }>();

export function clearAgencyHostCache(): void {
  hostCache.clear();
}

/** The active agency whose own address this host is, or null. */
export async function agencyForHost(host: string): Promise<Agency | null> {
  if (!host || !host.includes(".") || isPlatformDomain(host)) return null;
  const hit = hostCache.get(host);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.agency;
  const [row] = await db
    .select()
    .from(agencies)
    .where(and(eq(agencies.customDomain, host), eq(agencies.status, "active")))
    .limit(1);
  const agency = row ?? null;
  hostCache.set(host, { agency, at: Date.now() });
  return agency;
}

export function brandOfAgency(agency: Agency): PublicBrand {
  return agencyPublicBrand({
    id: agency.id,
    name: agency.name,
    branding: agency.branding,
    customDomain: agency.customDomain,
    domainStatus: agency.domainStatus,
    logoUpdatedAt: agency.logoUpdatedAt,
    hasLogo: !!agency.logoData,
  });
}

/** The brand for a page request: the agency's on its own address, ours everywhere else. */
export async function brandForHost(host: string): Promise<PublicBrand> {
  const agency = await agencyForHost(host);
  return agency ? brandOfAgency(agency) : PLATFORM_BRAND;
}

/** The brand a logged-in person sees: their agency's (agency logins and agency clients), else ours. */
export async function brandForLogin(input: { agencyId?: string | null; businessAccountId?: string | null }): Promise<PublicBrand> {
  let agencyId = input.agencyId ?? null;
  if (!agencyId && input.businessAccountId) {
    const [acct] = await db.select({ agencyId: businessAccounts.agencyId }).from(businessAccounts).where(eq(businessAccounts.id, input.businessAccountId)).limit(1);
    agencyId = acct?.agencyId ?? null;
  }
  if (!agencyId) return PLATFORM_BRAND;
  const [agency] = await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  return agency ? brandOfAgency(agency) : PLATFORM_BRAND;
}

// ── HTML ─────────────────────────────────────────────────────────────────────

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Page title, description and icons for an agency's address (the page HTML before the app loads). */
export function brandHtml(html: string, brand: PublicBrand): string {
  if (!brand.isAgency) return html;
  const name = escapeHtml(brand.name);
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${name}" />`)
    .replace(/\s*<link rel="(?:icon|apple-touch-icon)"[^>]*>/g, "");
  if (brand.logoUrl) {
    const icon = `<link rel="icon" href="${escapeHtml(brand.logoUrl)}" />`;
    out = out.replace("</head>", `    ${icon}\n  </head>`);
  }
  return out;
}

// ── DNS check ────────────────────────────────────────────────────────────────

/** Where agencies point their address: a CNAME to this host name (or the same IP addresses). */
export function domainTarget(): string {
  return (process.env.AGENCY_DOMAIN_TARGET || "portal.aichroney.com").toLowerCase();
}

export interface DomainCheck {
  ok: boolean;
  message: string;
}

/** Whether the address points to us: a CNAME to the target, or the same IPv4 addresses. */
export async function checkDomainDns(domain: string, resolver: Pick<typeof dns, "resolveCname" | "resolve4"> = dns): Promise<DomainCheck> {
  const target = domainTarget();
  const cnames = await resolver.resolveCname(domain).catch(() => [] as string[]);
  if (cnames.some(c => c.toLowerCase().replace(/\.$/, "") === target)) {
    return { ok: true, message: `Points to ${target}.` };
  }
  const [mine, theirs] = await Promise.all([
    resolver.resolve4(target).catch(() => [] as string[]),
    resolver.resolve4(domain).catch(() => [] as string[]),
  ]);
  if (theirs.length && theirs.some(ip => mine.includes(ip))) {
    return { ok: true, message: `Points to our server (${theirs.join(", ")}).` };
  }
  if (!cnames.length && !theirs.length) {
    return { ok: false, message: `No DNS record found yet. Add a CNAME record for ${domain} pointing to ${target}. Changes can take up to a few hours.` };
  }
  return {
    ok: false,
    message: `${domain} points to ${cnames[0] ?? theirs.join(", ")}, not to ${target}. Change the record to a CNAME pointing to ${target}.`,
  };
}

/** Base URL for links we hand out for an account (public chat links): its agency's own address once verified. */
export async function publicBaseUrlForAccount(businessAccountId: string | null | undefined): Promise<string> {
  const brand = await brandForLogin({ businessAccountId });
  return brand.domain ? `https://${brand.domain}` : "https://portal.aichroney.com";
}
