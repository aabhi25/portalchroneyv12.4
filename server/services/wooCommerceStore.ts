import dns from "dns/promises";
import net from "net";

/**
 * Reads a WooCommerce website's products, in one of two ways:
 *  - public: the public product list (Store API, /wp-json/wc/store/v1/products). No keys; it returns what
 *    any visitor can see, i.e. published, visible products.
 *  - keys: the WooCommerce REST API (/wp-json/wc/v3/products) with the website's consumer key + secret
 *    (Read access is enough). Published products only; hidden ones are skipped.
 *
 * Only https websites on public addresses are allowed (the address is typed by a person, and the server
 * fetches it). Keys are only ever sent to the website's own address (never after a redirect elsewhere) and
 * never logged. WOO_ALLOW_LOCAL_STORE=1 lets a local stand-in store on http://localhost be used in tests.
 */

const PER_PAGE = 100;
const MAX_PAGES = 50; // 5,000 products
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = "AIChroney-ProductSync/1.0";

export interface WooProduct {
  externalId: string;
  name: string;
  description: string;
  price: string | null; // in the store's currency, e.g. "2500.00"
  regularPrice: string | null; // only while on sale
  imageUrl: string | null;
  productUrl: string | null;
  sku: string | null;
  stockStatus: "in_stock" | "out_of_stock" | "on_backorder";
  categories: string[];
  tags: string[];
}

export interface WooFetchResult {
  products: WooProduct[];
  currency: string | null;
}

export class WooStoreError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export interface WooKeys {
  key: string;
  secret: string;
}

const allowLocal = () => process.env.WOO_ALLOW_LOCAL_STORE === "1";

/** "accurex.net/shop?x=1" → "https://accurex.net". Throws a WooStoreError with a plain message. */
export function normalizeStoreUrl(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) throw new WooStoreError("Type the website address");
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new WooStoreError("That doesn't look like a website address");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && allowLocal())) throw new WooStoreError("The website must start with https://");
  if (u.username || u.password) throw new WooStoreError("That doesn't look like a website address");
  // A WordPress site in a sub-folder keeps its path (example.com/shop/wp-json/...).
  const path = u.pathname.replace(/\/+$/, "").replace(/\/wp-json(\/.*)?$/, "");
  return `${u.protocol}//${u.host}${path}`;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower.startsWith("::ffff:") && net.isIPv4(lower.slice(7))) return isPrivateIp(lower.slice(7));
    return lower === "::1" || lower === "::" || lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd");
  }
  return false;
}

async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if ((host === "localhost" || host === "127.0.0.1") && allowLocal()) return;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new WooStoreError("That website address isn't allowed");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new WooStoreError("That website address isn't allowed");
    return;
  }
  let addresses: string[] = [];
  try {
    addresses = (await dns.lookup(host, { all: true })).map(a => a.address);
  } catch {
    throw new WooStoreError(`Couldn't find the website ${host}. Check the address.`);
  }
  if (addresses.length === 0) throw new WooStoreError(`Couldn't find the website ${host}. Check the address.`);
  if (addresses.some(isPrivateIp)) throw new WooStoreError("That website address isn't allowed");
}

/**
 * GET with redirects checked one by one (each hop must be a public https address).
 * With keys: Basic auth, or the keys as query parameters (`keysInQuery`) for servers that drop the
 * Authorization header; a redirect to another website is refused so the keys never leave the site.
 */
async function getJson(urlString: string, opts: { keys?: WooKeys; keysInQuery?: boolean } = {}): Promise<{ body: unknown; headers: Headers }> {
  let url = new URL(urlString);
  const origin = url.origin;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(url);
    const target = new URL(url);
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": USER_AGENT };
    if (opts.keys && opts.keysInQuery) {
      target.searchParams.set("consumer_key", opts.keys.key);
      target.searchParams.set("consumer_secret", opts.keys.secret);
    } else if (opts.keys) {
      headers.Authorization = `Basic ${Buffer.from(`${opts.keys.key}:${opts.keys.secret}`).toString("base64")}`;
    }
    let res: Response;
    try {
      res = await fetch(target, { redirect: "manual", headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (e: any) {
      const reason = e?.name === "TimeoutError" ? "it took too long to answer" : "it could not be reached";
      throw new WooStoreError(`The website didn't respond (${reason}). Try again later.`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location")!, url);
      const local = next.hostname === "localhost" || next.hostname === "127.0.0.1";
      if (next.protocol !== "https:" && !(local && allowLocal())) throw new WooStoreError("The website redirected to a non-https address");
      if (opts.keys && next.origin !== origin) {
        throw new WooStoreError(`The website moved to ${next.origin}. Use that address instead.`);
      }
      // Never carry the keys in a redirected address.
      next.searchParams.delete("consumer_key");
      next.searchParams.delete("consumer_secret");
      url = next;
      continue;
    }
    if (res.status === 404) {
      throw new WooStoreError(opts.keys
        ? "This website has no WooCommerce API at /wp-json/wc/v3 (is it a WooCommerce site, with the REST API on?)."
        : "This website has no public WooCommerce product list (the Store API may be switched off, or it isn't a WooCommerce site). Try connecting with the website's keys.", 404);
    }
    if (res.status === 401 || res.status === 403) {
      throw new WooStoreError(opts.keys
        ? "The website didn't accept the keys. Check the consumer key and secret, and that they have Read access."
        : "The website refused our request (a security plugin or firewall may be blocking servers). Ask the website's developer to allow it.", res.status);
    }
    if (res.status === 429) throw new WooStoreError("The website asked us to slow down. Try again in a while.", 429);
    if (!res.ok) throw new WooStoreError(`The website answered with an error (${res.status}). Try again later.`, res.status);
    const text = await res.text();
    try {
      return { body: JSON.parse(text), headers: res.headers };
    } catch {
      throw new WooStoreError("The website sent back something that isn't a product list (a security page may be in the way).");
    }
  }
  throw new WooStoreError("The website redirected too many times");
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Downloads one product photo from the website (public addresses only, redirects checked), asking for the
 * formats messaging apps take, so a picture service that can send JPEG instead of WebP does so.
 */
export async function fetchWebsiteImage(urlString: string): Promise<Buffer> {
  let url = new URL(urlString);
  if (url.protocol !== "https:" && !(allowLocal() && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) {
    throw new WooStoreError("The photo address must start with https://");
  }
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(url);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { Accept: "image/jpeg,image/png;q=0.9,*/*;q=0.5", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new WooStoreError("The photo could not be downloaded");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location")!, url);
      const local = next.hostname === "localhost" || next.hostname === "127.0.0.1";
      if (next.protocol !== "https:" && !(local && allowLocal())) throw new WooStoreError("The photo redirected to a non-https address");
      url = next;
      continue;
    }
    if (!res.ok) throw new WooStoreError(`The photo could not be downloaded (${res.status})`);
    if (Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new WooStoreError("The photo is too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new WooStoreError("The photo is too large");
    return buf;
  }
  throw new WooStoreError("The photo redirected too many times");
}

/** Keyed request: Basic auth first; servers that drop the Authorization header get the keys as parameters. */
async function getWithKeys(urlString: string, keys: WooKeys): Promise<{ body: unknown; headers: Headers }> {
  try {
    return await getJson(urlString, { keys });
  } catch (e) {
    if (!(e instanceof WooStoreError) || e.status !== 401) throw e;
    return await getJson(urlString, { keys, keysInQuery: true });
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", trade: "™", reg: "®", copy: "©", deg: "°", micro: "µ", times: "×",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Website HTML → plain text, one line per heading, paragraph or list item. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Line breaks inside the HTML source are just spaces (as in a browser); only tags start new lines.
    .replace(/\s+/g, " ")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<(br|\/p|\/h[1-6]|\/div|\/li|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map(line => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const MAX_DESCRIPTION = 6000;

function money(minorUnits: unknown, minorUnit: number): string | null {
  if (typeof minorUnits !== "string" || !/^\d+$/.test(minorUnits)) return null;
  return (Number(minorUnits) / 10 ** minorUnit).toFixed(2);
}

/** One Store API product → our fields. Exported for tests. */
export function mapStoreProduct(p: any): WooProduct | null {
  if (!p || typeof p !== "object" || p.id == null || typeof p.name !== "string") return null;
  const prices = p.prices || {};
  const minorUnit = Number.isInteger(prices.currency_minor_unit) ? prices.currency_minor_unit : 2;
  const range = prices.price_range;
  const price = range ? money(range.min_amount, minorUnit) : money(prices.price, minorUnit);
  const regular = money(prices.regular_price, minorUnit);
  const regularPrice = !range && p.on_sale && regular && price && Number(regular) > Number(price) ? regular : null;

  const parts: string[] = [];
  const short = typeof p.short_description === "string" ? htmlToText(p.short_description) : "";
  const long = typeof p.description === "string" ? htmlToText(p.description) : "";
  if (short) parts.push(short);
  if (long && long !== short) parts.push(long);
  // Products with options (sizes etc.): list them, the price above is the lowest one ("from").
  if (Array.isArray(p.attributes)) {
    for (const a of p.attributes) {
      if (!a?.has_variations || !Array.isArray(a.terms) || a.terms.length === 0) continue;
      parts.push(`${decodeEntities(String(a.name))}: ${a.terms.map((t: any) => decodeEntities(String(t.name))).join(", ")}`);
    }
  }
  if (range && price && money(range.max_amount, minorUnit) !== price) parts.push("Price depends on the option chosen (shown price is the lowest).");
  let description = parts.join("\n\n");
  if (description.length > MAX_DESCRIPTION) description = `${description.slice(0, MAX_DESCRIPTION).trimEnd()}…`;

  const names = (list: unknown) => Array.isArray(list)
    ? Array.from(new Set(list.map((c: any) => decodeEntities(String(c?.name ?? "")).trim()).filter(Boolean)))
    : [];
  const image = Array.isArray(p.images) ? p.images.find((i: any) => typeof i?.src === "string" && i.src) : null;

  return {
    externalId: String(p.id),
    name: decodeEntities(p.name).trim() || `Product ${p.id}`,
    description,
    price,
    regularPrice,
    imageUrl: image ? image.src : null,
    productUrl: typeof p.permalink === "string" && /^https?:\/\//.test(p.permalink) ? p.permalink : null,
    sku: typeof p.sku === "string" && p.sku.trim() ? p.sku.trim() : null,
    stockStatus: p.is_in_stock === false ? (p.is_on_backorder ? "on_backorder" : "out_of_stock") : (p.is_on_backorder ? "on_backorder" : "in_stock"),
    categories: names(p.categories),
    tags: names(p.tags),
  };
}

/** Decimal price from the REST API ("2500", "2500.5", "") → "2500.00" or null. */
function decimal(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d+(\.\d+)?$/.test(v.trim())) return null;
  return Number(v).toFixed(2);
}

/** One REST API (wc/v3, with keys) product → our fields, or null for unpublished / hidden ones. Exported for tests. */
export function mapRestProduct(p: any): WooProduct | null {
  if (!p || typeof p !== "object" || p.id == null || typeof p.name !== "string") return null;
  if (p.status && p.status !== "publish") return null;
  if (p.catalog_visibility === "hidden") return null;
  const variable = p.type === "variable";
  const price = decimal(p.price);
  const regular = decimal(p.regular_price);
  const regularPrice = !variable && p.on_sale && regular && price && Number(regular) > Number(price) ? regular : null;

  const parts: string[] = [];
  const short = typeof p.short_description === "string" ? htmlToText(p.short_description) : "";
  const long = typeof p.description === "string" ? htmlToText(p.description) : "";
  if (short) parts.push(short);
  if (long && long !== short) parts.push(long);
  if (Array.isArray(p.attributes)) {
    for (const a of p.attributes) {
      if (!a?.variation || !Array.isArray(a.options) || a.options.length === 0) continue;
      parts.push(`${decodeEntities(String(a.name))}: ${a.options.map((o: any) => decodeEntities(String(o))).join(", ")}`);
    }
  }
  if (variable && price) parts.push("Price depends on the option chosen (shown price is the lowest).");
  let description = parts.join("\n\n");
  if (description.length > MAX_DESCRIPTION) description = `${description.slice(0, MAX_DESCRIPTION).trimEnd()}…`;

  const names = (list: unknown) => Array.isArray(list)
    ? Array.from(new Set(list.map((c: any) => decodeEntities(String(c?.name ?? "")).trim()).filter(Boolean)))
    : [];
  const image = Array.isArray(p.images) ? p.images.find((i: any) => typeof i?.src === "string" && i.src) : null;
  return {
    externalId: String(p.id),
    name: decodeEntities(p.name).trim() || `Product ${p.id}`,
    description,
    price,
    regularPrice,
    imageUrl: image ? image.src : null,
    productUrl: typeof p.permalink === "string" && /^https?:\/\//.test(p.permalink) ? p.permalink : null,
    sku: typeof p.sku === "string" && p.sku.trim() ? p.sku.trim() : null,
    stockStatus: p.stock_status === "outofstock" ? "out_of_stock" : p.stock_status === "onbackorder" ? "on_backorder" : "in_stock",
    categories: names(p.categories),
    tags: names(p.tags),
  };
}

const listUrl = (base: string, keys: WooKeys | undefined, perPage: number, page: number) => keys
  ? `${base}/wp-json/wc/v3/products?per_page=${perPage}&page=${page}&status=publish`
  : `${base}/wp-json/wc/store/v1/products?per_page=${perPage}&page=${page}`;

const getList = (url: string, keys: WooKeys | undefined) => (keys ? getWithKeys(url, keys) : getJson(url));

/** The shop's currency with keys (the REST product list has none). Null if the key can't read it. */
async function keyedCurrency(base: string, keys: WooKeys): Promise<string | null> {
  try {
    const { body } = await getWithKeys(`${base}/wp-json/wc/v3/data/currencies/current`, keys);
    const code = (body as any)?.code;
    return typeof code === "string" && /^[A-Z]{3}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

/** Every published product on the website, all pages. Throws WooStoreError with a plain message. */
export async function fetchStoreProducts(storeUrl: string, opts: { maxPages?: number; keys?: WooKeys } = {}): Promise<WooFetchResult> {
  const base = normalizeStoreUrl(storeUrl);
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const products: WooProduct[] = [];
  const seen = new Set<string>();
  let currency: string | null = null;
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, maxPages); page++) {
    const { body, headers } = await getList(listUrl(base, opts.keys, PER_PAGE, page), opts.keys);
    if (!Array.isArray(body)) throw new WooStoreError("The website sent back something that isn't a product list.");
    if (page === 1) {
      totalPages = Math.max(1, Number(headers.get("x-wp-totalpages")) || 1);
      // Never sync part of a catalog: products past the limit would look deleted.
      if (totalPages > maxPages) throw new WooStoreError(`The website has more than ${maxPages * PER_PAGE} products, which is more than the sync can read.`);
    }
    for (const raw of body) {
      const mapped = opts.keys ? mapRestProduct(raw) : mapStoreProduct(raw);
      if (!mapped || seen.has(mapped.externalId)) continue;
      seen.add(mapped.externalId);
      products.push(mapped);
      if (!opts.keys && !currency && typeof (raw as any)?.prices?.currency_code === "string") currency = (raw as any).prices.currency_code;
    }
    if (body.length < PER_PAGE && page >= totalPages) break;
  }
  if (opts.keys) currency = await keyedCurrency(base, opts.keys);
  return { products, currency };
}

/** Quick check for "Test connection": first page only. */
export async function testStore(storeUrl: string, keys?: WooKeys): Promise<{ total: number; sample: string[]; currency: string | null }> {
  const base = normalizeStoreUrl(storeUrl);
  const { body, headers } = await getList(listUrl(base, keys, 5, 1), keys);
  if (!Array.isArray(body)) throw new WooStoreError("The website sent back something that isn't a product list.");
  const mapped = body.map(p => (keys ? mapRestProduct(p) : mapStoreProduct(p))).filter((p): p is WooProduct => !!p);
  const total = Number(headers.get("x-wp-total"));
  return {
    total: Number.isFinite(total) && total >= 0 ? total : mapped.length,
    sample: mapped.slice(0, 5).map(p => p.name),
    currency: keys ? await keyedCurrency(base, keys) : (body[0] as any)?.prices?.currency_code ?? null,
  };
}
