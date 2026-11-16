import * as cheerio from "cheerio";
import { allowLocal, decodeEntities, htmlToText, WooStoreError } from "./wooCommerceStore";
import { fetchPublic, jsonLdNodes, locs, schemaTypeIs } from "./websiteStores";

/**
 * Website scan helpers (Training › Website scan):
 *
 *  - `discoverInfoPages`: the pages worth reading for the chat (about, contact, FAQ, shipping, returns,
 *    policies, stores…) from the website's sitemap and its homepage links. Product, collection, blog and
 *    filtered copies of the same page are left out (products belong in Products). The page shows the list
 *    with the best ones ticked, and the business chooses.
 *  - `extractSiteFacts`: facts a page states exactly, without asking the AI: phone and email links, the
 *    business details and FAQ answers the website publishes for Google (schema.org), and open/close
 *    question blocks (<details>) in the page body.
 */

export type PageKind =
  | "home" | "about" | "contact" | "faq" | "shipping" | "returns" | "warranty" | "stores"
  | "pricing" | "services" | "policy" | "careers" | "other";

export interface FoundPage {
  url: string;
  kind: PageKind;
  label: string;
  picked: boolean;
  /** Already read in an earlier scan. */
  alreadyRead?: boolean;
}

export interface PageDiscovery {
  pages: FoundPage[];
  /** Kinds of pages left out on purpose, with how many were seen (sitemaps of left-out kinds aren't opened, so not counted). */
  leftOut: { products: number; collections: number; blog: number; other: number; sitemaps: string[] };
  source: "sitemap" | "links";
}

export const DEFAULT_PICK = 15;
export const MAX_PICK = 30;
const MAX_LISTED = 200;
const MAX_SITEMAP_FILES = 25;

// Checked in this order (legal pages and careers before services, so "terms-of-service" and "/jobs/service-…"
// aren't services; "policy" alone last, so "refund-policy" is a returns page). `rank` orders the list.
// A keyword counts at the start or end of the page's own address, then of its folders.
const KIND_WORDS: { kind: PageKind; label: string; rank: number; words: string }[] = [
  { kind: "policy", label: "Policy", rank: 60, words: "privacy|privacy-policy|terms|terms-of-service|terms-of-use|terms-and-conditions|tnc|t-c|legal|disclaimer" },
  { kind: "careers", label: "Careers", rank: 30, words: "careers?|jobs?|join-us|work-with-us|vacanc(y|ies)" },
  { kind: "about", label: "About", rank: 100, words: "about|about-us|our-story|who-we-are|company|our-company" },
  { kind: "contact", label: "Contact", rank: 98, words: "contact|contact-us|reach-us|get-in-touch|enquir(e|y)" },
  { kind: "faq", label: "FAQ", rank: 96, words: "faqs?|help|questions|support|help-cent(er|re)|helpcenter" },
  { kind: "shipping", label: "Shipping", rank: 94, words: "shipping|delivery|shipping-policy" },
  { kind: "returns", label: "Returns & refunds", rank: 94, words: "returns?|refunds?|exchanges?|cancell?ations?|refund-policy|return-policy" },
  { kind: "warranty", label: "Warranty & care", rank: 90, words: "warranty|guarantee|care|lifetime|buyback|authenticity|certificat(e|ion)s?" },
  { kind: "stores", label: "Stores & locations", rank: 88, words: "store-locator|stores|locations?|branches|find-us|visit-us|our-stores|our-centres|our-centers|our-clinics" },
  { kind: "pricing", label: "Pricing", rank: 86, words: "pricing|prices|plans|packages|fees|rates" },
  { kind: "services", label: "Services", rank: 84, words: "services?|solutions|what-we-do|treatments?|courses?|programs?|programmes?|admissions?" },
  { kind: "policy", label: "Policy", rank: 60, words: "policy|policies" },
];
const KINDS: { kind: PageKind; label: string; rank: number; test: RegExp }[] = KIND_WORDS.map(k => ({
  kind: k.kind, label: k.label, rank: k.rank, test: new RegExp(`^(${k.words})([-_.]|$)|(^|[-_])(${k.words})$`),
}));
const CAREERS = KINDS.find(k => k.kind === "careers")!;

// Left out: products and collections (they belong in Products), blog posts, and pages that aren't content.
const PRODUCT_PATH = /\/(products?|p|item|items|dp)\/[^/]+/i;
const COLLECTION_PATH = /\/(collections?|categor(y|ies)|product-category|shop|catalog|catalogue|brands?|tags?)(\/|$)/i;
const BLOG_PATH = /\/(blogs?|news|articles?|posts?|stories|press|author|events?)\/[^/]+/i;
const NOT_CONTENT = /\/(cart|checkout|account|login|signin|sign-in|signup|register|search|wishlist|compare|cdn|wp-json|wp-admin|wp-content|feed|amp|track|order|orders|password|thank-you|thankyou|thanks|success|confirmation)(\/|$)|\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|xml|txt|mp4|mp3)$/i;
const LEFT_OUT_SITEMAP = /product|collection|categor|article|blog|post_tag|tag|author|image|video|news|brand|attachment/i;

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");
// Same name the page reader has always used; some websites send a different page to unknown robots.
export const SCAN_USER_AGENT = "Mozilla/5.0 (compatible; ChroneyBot/1.0; +https://portal.aichroney.com)";
const get = (url: string, accept: string, timeoutMs: number) => fetchPublic(url, accept, timeoutMs, SCAN_USER_AGENT);

/** "https://Shop.com/About/?utm=1#x" → "https://shop.com/About" (one address per page). */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return url.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function classify(url: URL, origin: URL): { kind: PageKind; label: string; rank: number } | { leftOut: "products" | "collections" | "blog" | "other" } {
  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  if (!path || path === "/") return { kind: "home", label: "Homepage", rank: 1000 };
  if (bareHost(url.hostname) !== bareHost(origin.hostname)) return { leftOut: "other" };
  if (NOT_CONTENT.test(path)) return { leftOut: "other" };
  // Filtered / sorted copies of a listing ("?filter.v.price.gte=1500").
  if (url.search && url.search.length > 1) return { leftOut: "other" };
  // Shopify shop policies live under /policies/… (refund-policy, shipping-policy…): never left out.
  const policyMatch = /^\/policies\//.test(path);
  if (!policyMatch) {
    if (PRODUCT_PATH.test(path)) return { leftOut: "products" };
    if (COLLECTION_PATH.test(path)) return { leftOut: "collections" };
    if (BLOG_PATH.test(path)) return { leftOut: "blog" };
    if (/^\/(blogs?|news|articles?)$/.test(path)) return { leftOut: "blog" };
  }
  const segs = path.split("/").filter(Boolean);
  const last = segs[segs.length - 1] || "";
  // Product codes in the address ("…-pant-20260578", "…-aw00007-ss0000.html"): a product page.
  if (!policyMatch && /\d{5,}|[a-z]{1,3}\d{4,}/.test(last)) return { leftOut: "products" };
  // A long title-like address ("all-about-platelet-counts", "skip-about-pant") is an article or product,
  // even if it contains a word like "about" or "care": only short addresses name a page's kind.
  const words = last.split(/[-_]+/).filter(Boolean).length;
  const match = words > 4 ? undefined
    // Anything under a careers folder is a careers page ("/jobs/service-engineers").
    : segs.slice(0, -1).some(seg => CAREERS.test.test(seg)) ? CAREERS
      : KINDS.find(k => k.test.test(last)) ?? KINDS.find(k => segs.slice(0, -1).some(seg => k.test.test(seg)));
  for (const k of match ? [match] : []) {
    {
      // Deeper pages of the same kind rank a little lower than the main one.
      return { kind: k.kind, label: k.label, rank: k.rank - Math.max(0, segs.length - 2) * 3 };
    }
  }
  return { kind: "other", label: "Page", rank: 40 - Math.min(20, segs.length * 4) };
}

async function sitemapPageUrls(origin: string, leftOutSitemaps: Set<string>): Promise<string[]> {
  const start: string[] = [];
  try {
    const robots = await get(`${origin}/robots.txt`, "text/plain", 15_000);
    if (robots.status === 200) {
      for (const line of robots.text.split(/\r?\n/)) {
        const m = line.match(/^\s*sitemap:\s*(\S+)/i);
        if (m) start.push(m[1]);
      }
    }
  } catch { /* the usual places below */ }
  if (start.length === 0) start.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`);

  const queue = Array.from(new Set(start));
  const visited = new Set<string>();
  const urls: string[] = [];
  while (queue.length && visited.size < MAX_SITEMAP_FILES) {
    const next = queue.shift()!;
    if (visited.has(next) || /\.gz($|\?)/i.test(next)) continue;
    visited.add(next);
    let text: string;
    try {
      const res = await get(next, "application/xml,text/xml;q=0.9,*/*;q=0.5", 20_000);
      if (res.status !== 200) continue;
      text = res.text;
    } catch {
      continue;
    }
    for (const child of locs(text, "sitemap")) {
      // Product / collection / blog sitemaps hold no info pages: not opened (they can be huge).
      const name = (() => { try { return new URL(child).pathname.split("/").pop() || child; } catch { return child; } })();
      if (LEFT_OUT_SITEMAP.test(name)) { leftOutSitemaps.add(name.replace(/[_-]?\d*\.xml.*$/i, "").replace(/^wp-sitemap-/, "")); continue; }
      queue.push(child);
    }
    urls.push(...locs(text, "url"));
  }
  return urls;
}

function homepageLinks(html: string, origin: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;
    try { out.push(new URL(href, origin).toString()); } catch { /* not an address */ }
  });
  return out;
}

const SHOPIFY_POLICIES = ["refund-policy", "shipping-policy", "privacy-policy", "terms-of-service"];

/**
 * The website's pages worth reading, best first, with the top ones picked. `alreadyRead`: pages read in an
 * earlier scan (shown ticked, so a re-scan keeps them unless unticked). Throws WooStoreError for a bad address.
 */
export async function discoverInfoPages(websiteUrl: string, alreadyRead: string[] = []): Promise<PageDiscovery> {
  let base: URL;
  try {
    base = new URL(/^https?:\/\//i.test(websiteUrl.trim()) ? websiteUrl.trim() : `https://${websiteUrl.trim()}`);
  } catch {
    throw new WooStoreError("The website address in Account settings doesn't look right.");
  }
  // The sitemap and pages are read over https (tests: a local stand-in website keeps http).
  const local = allowLocal() && /^(localhost|127\.0\.0\.1)$/.test(base.hostname);
  const origin = `${local ? base.protocol : "https:"}//${base.host}`;
  const originUrl = new URL(origin);

  let homeHtml = "";
  try {
    const home = await get(origin, "text/html,*/*;q=0.5", 20_000);
    if (home.status === 200) homeHtml = home.text;
  } catch (e: any) {
    if (/isn't allowed/.test(e?.message || "")) throw e;
  }
  const leftOutSitemaps = new Set<string>();
  const fromSitemap = await sitemapPageUrls(origin, leftOutSitemaps).catch(() => [] as string[]);
  const fromLinks = homeHtml ? homepageLinks(homeHtml, origin) : [];
  if (/cdn\.shopify\.com|shopify-section/i.test(homeHtml)) {
    for (const p of SHOPIFY_POLICIES) fromLinks.push(`${origin}/policies/${p}`);
  }

  const leftOut = { products: 0, collections: 0, blog: 0, other: 0 };
  const leftOverKeys = new Set<string>();
  const byKey = new Map<string, FoundPage & { rank: number }>();
  const add = (raw: string, readBefore = false) => {
    let u: URL;
    try { u = new URL(raw, origin); } catch { return; }
    if (bareHost(u.hostname) !== bareHost(originUrl.hostname)) return;
    const c = classify(u, originUrl);
    if ("leftOut" in c) {
      if (!readBefore) { leftOut[c.leftOut]++; return; }
    }
    const kind = "leftOut" in c ? "other" : c.kind;
    const key = pageKey(`${origin}${u.pathname}`);
    const existing = byKey.get(key);
    if (existing) { if (readBefore) existing.alreadyRead = true; return; }
    byKey.set(key, {
      // The address as the website lists it (some websites redirect "/about-us" to "/about-us/").
      url: key === pageKey(origin) ? origin : `${origin}${u.pathname}`,
      kind,
      label: "leftOut" in c ? "Page" : c.label,
      rank: "leftOut" in c ? 0 : c.rank,
      picked: false,
      ...(readBefore ? { alreadyRead: true } : {}),
    });
    // A product / collection / filtered page read by an earlier scan: listed, but not ticked again.
    if ("leftOut" in c) leftOverKeys.add(key);
  };
  add(origin);
  for (const u of fromSitemap) add(u);
  for (const u of fromLinks) add(u);
  for (const u of alreadyRead) add(u, true);

  const list = Array.from(byKey.values()).sort((a, b) => b.rank - a.rank || a.url.length - b.url.length);
  // Ticked: the homepage; pages read before (still worth reading); then the important kinds and policies,
  // at most 3 of a kind so 20 city store pages don't crowd out the rest; "other" pages only if few were found.
  let picked = 0;
  const perKind = new Map<PageKind, number>();
  const tick = (p: FoundPage) => { p.picked = true; picked++; perKind.set(p.kind, (perKind.get(p.kind) ?? 0) + 1); };
  for (const p of list) {
    if (p.kind === "home" || (p.alreadyRead && !leftOverKeys.has(pageKey(p.url)) && picked < MAX_PICK)) tick(p);
  }
  // A re-scan keeps the earlier choice (pages unticked then stay unticked); suggestions are added only on a
  // first scan, or when an earlier scan left few useful pages (scans before this page list existed).
  const fill = picked < 6;
  for (const p of list) {
    if (!fill || picked >= DEFAULT_PICK) break;
    if (!p.picked && !p.alreadyRead && p.rank >= 60 && (perKind.get(p.kind) ?? 0) < 3) tick(p);
  }
  if (picked < 6) {
    for (const p of list) {
      if (picked >= 8) break;
      if (!p.picked && p.kind === "other" && !leftOverKeys.has(pageKey(p.url))) tick(p);
    }
  }
  return {
    pages: list.slice(0, MAX_LISTED).map(({ rank, ...p }) => p),
    leftOut: { ...leftOut, sitemaps: Array.from(leftOutSitemaps).slice(0, 8) },
    source: fromSitemap.length ? "sitemap" : "links",
  };
}

// ───────────────────────────── Exact facts ─────────────────────────────

export interface SiteFacts {
  name?: string;
  phones: string[];
  emails: string[];
  address?: string;
  hours?: string;
  faqs: { q: string; a: string }[];
}

const BUSINESS_TYPES = ["Organization", "Corporation", "LocalBusiness", "Store", "OnlineStore", "JewelryStore", "MedicalBusiness",
  "MedicalClinic", "Dentist", "Physician", "Hospital", "Restaurant", "FoodEstablishment", "EducationalOrganization", "School",
  "CollegeOrUniversity", "ProfessionalService", "LegalService", "FinancialService", "HealthAndBeautyBusiness", "BeautySalon",
  "HomeAndConstructionBusiness", "AutomotiveBusiness", "RealEstateAgent", "TravelAgency", "LodgingBusiness", "Hotel",
  "SportsActivityLocation", "EntertainmentBusiness", "ShoppingCenter", "ClothingStore", "ElectronicsStore", "FurnitureStore",
  "HomeGoodsStore", "Pharmacy", "Optician", "AutoDealer"];

const DAY_NAMES: Record<string, string> = {
  mo: "Monday", tu: "Tuesday", we: "Wednesday", th: "Thursday", fr: "Friday", sa: "Saturday", su: "Sunday",
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
  publicholidays: "Public holidays",
};
const dayName = (d: unknown) => {
  const key = String(d ?? "").replace(/^https?:\/\/schema\.org\//i, "").toLowerCase();
  return DAY_NAMES[key] ?? DAY_NAMES[key.slice(0, 2)] ?? String(d ?? "");
};
const str = (v: unknown) => (typeof v === "string" ? decodeEntities(v).trim() : typeof v === "number" ? String(v) : "");

function addressText(a: any): string {
  if (!a) return "";
  if (typeof a === "string") return decodeEntities(a).trim();
  if (Array.isArray(a)) return addressText(a[0]);
  const country = typeof a.addressCountry === "object" ? a.addressCountry?.name : a.addressCountry;
  return [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, country].map(str).filter(Boolean).join(", ");
}

function hoursText(node: any): string {
  const lines: string[] = [];
  const specs = Array.isArray(node.openingHoursSpecification) ? node.openingHoursSpecification : node.openingHoursSpecification ? [node.openingHoursSpecification] : [];
  for (const s of specs) {
    const days = (Array.isArray(s?.dayOfWeek) ? s.dayOfWeek : [s?.dayOfWeek]).filter(Boolean).map(dayName);
    const opens = str(s?.opens).slice(0, 5), closes = str(s?.closes).slice(0, 5);
    if (!days.length) continue;
    lines.push(opens || closes ? `${days.join(", ")}: ${opens}–${closes}` : `${days.join(", ")}: closed`);
  }
  if (!lines.length && node.openingHours) {
    // "Mo-Sa 10:00-20:00"
    for (const h of Array.isArray(node.openingHours) ? node.openingHours : [node.openingHours]) {
      const t = str(h);
      if (!t) continue;
      lines.push(t.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, m => dayName(m)).replace(/-/g, "–"));
    }
  }
  return lines.join("; ");
}

const cleanPhone = (p: string) => decodeURIComponent(p).replace(/^tel:/i, "").replace(/[^\d+()\- ]/g, "").trim();
const isPhone = (p: string) => p.replace(/\D/g, "").length >= 7;
const cleanEmail = (e: string) => decodeURIComponent(e).replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) && !/example\.(com|org)|@domain\.|yourdomain|sentry/i.test(e);

/** Facts a page states exactly (no AI): phone/email links, schema.org business details + FAQs, <details> questions. Exported for tests. */
export function extractSiteFacts(html: string): SiteFacts {
  const facts: SiteFacts = { phones: [], emails: [], faqs: [] };
  const nodes = jsonLdNodes(html);
  for (const n of nodes) {
    if (schemaTypeIs(n, BUSINESS_TYPES)) {
      if (!facts.name && str(n.name)) facts.name = str(n.name);
      const points = [n, ...(Array.isArray(n.contactPoint) ? n.contactPoint : n.contactPoint ? [n.contactPoint] : [])];
      for (const p of points) {
        const tel = cleanPhone(str(p?.telephone));
        if (tel && isPhone(tel)) facts.phones.push(tel);
        const mail = cleanEmail(str(p?.email));
        if (mail && isEmail(mail)) facts.emails.push(mail);
      }
      const addr = addressText(n.address);
      if (addr && !facts.address) facts.address = addr;
      const hrs = hoursText(n);
      if (hrs && !facts.hours) facts.hours = hrs;
    }
    if (schemaTypeIs(n, ["FAQPage"])) {
      const qs = Array.isArray(n.mainEntity) ? n.mainEntity : n.mainEntity ? [n.mainEntity] : [];
      for (const q of qs) {
        const question = str(q?.name), answer = htmlToText(str(q?.acceptedAnswer?.text ?? (Array.isArray(q?.acceptedAnswer) ? q.acceptedAnswer[0]?.text : "")));
        if (question && answer) facts.faqs.push({ q: question, a: answer });
      }
    }
  }

  const $ = cheerio.load(html);
  $('a[href^="tel:"]').each((_, el) => { const t = cleanPhone($(el).attr("href") || ""); if (isPhone(t)) facts.phones.push(t); });
  $('a[href^="mailto:"]').each((_, el) => { const e = cleanEmail($(el).attr("href") || ""); if (isEmail(e)) facts.emails.push(e); });
  // Open/close question blocks in the page body (menus and drawers use <details> too: skipped).
  if (facts.faqs.length === 0) {
    $("details").each((_, el) => {
      const d = $(el);
      if (d.closest("header, nav, footer, [class*='menu'], [class*='drawer'], [class*='header'], [class*='footer'], [id*='menu']").length) return;
      const q = d.children("summary").first().text().replace(/\s+/g, " ").trim();
      const clone = d.clone();
      clone.children("summary").remove();
      const a = htmlToText(clone.html() || "");
      if (q && a && q.length < 300 && a.length > 10) facts.faqs.push({ q, a: a.slice(0, 1500) });
    });
  }
  facts.phones = Array.from(new Set(facts.phones)).slice(0, 5);
  facts.emails = Array.from(new Set(facts.emails)).slice(0, 5);
  const seenQ = new Set<string>();
  facts.faqs = facts.faqs.filter(f => !seenQ.has(f.q.toLowerCase()) && seenQ.add(f.q.toLowerCase())).slice(0, 60);
  return facts;
}

/** The exact questions and answers of a page, as text kept word for word for the chat. */
export function faqText(faqs: { q: string; a: string }[]): string {
  if (!faqs.length) return "";
  return `Questions and answers on this page (exact wording):\n${faqs.map(f => `Q: ${f.q}\nA: ${f.a}`).join("\n\n")}`;
}

/** A page's own text (main content, without menus, header and footer), one line per block. */
export function mainPageText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, svg, header, nav, footer, form, [role='navigation'], [class*='drawer'], [class*='cookie']").remove();
  const main = $("main, [role='main'], article, #MainContent, #main, .main-content").first();
  return htmlToText((main.length ? main : $("body")).html() || "");
}

/** What kind of page an address is (for a page that wasn't found by `discoverInfoPages`). */
export function kindOfPage(url: string): PageKind {
  try {
    const u = new URL(url);
    const c = classify(u, new URL(u.origin));
    return "leftOut" in c ? "other" : c.kind;
  } catch {
    return "other";
  }
}

/** A page's HTML, read the way the website scan reads pages (public addresses only, redirects checked). */
export async function fetchScanHtml(url: string): Promise<string> {
  const res = await get(url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", 20_000);
  if (res.status !== 200) throw new WooStoreError(`The page answered ${res.status}`, res.status);
  return res.text;
}
