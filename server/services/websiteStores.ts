import {
  allowLocal, assertPublicHost, decodeEntities, fetchStoreProducts, htmlToText, normalizeStoreUrl,
  WooStoreError, type WooFetchResult, type WooKeys, type WooProduct,
} from "./wooCommerceStore";

/**
 * Website products for any kind of shop. Given only the website address, `detectWebsite` works out what
 * the website is built on and how its products can be read, and `readWebsiteProducts` reads them:
 *
 *  - "shopify": a Shopify shop's public product list (/products.json, what any shopper sees). No keys.
 *  - "public" / "keys": a WooCommerce shop (see wooCommerceStore.ts), public list or with its keys.
 *  - "pagedata": any other shop (Magento, BigCommerce, Wix, custom…): the product pages listed in the
 *    website's sitemap, read one by one for the product details shops publish for Google (schema.org
 *    Product data, or the og:product tags).
 *
 * Every request goes through the same address checks as WooCommerce (public https addresses only,
 * redirects checked hop by hop).
 */

export type WebsiteReadMode = "public" | "keys" | "shopify" | "pagedata";
export type WebsitePlatform = "shopify" | "woocommerce" | "other";

const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = "AIChroney-ProductSync/1.0";
const MAX_TEXT_BYTES = 15 * 1024 * 1024;
const MAX_DESCRIPTION = 6000;

const SHOPIFY_PER_PAGE = 250;
const SHOPIFY_MAX_PAGES = 100; // 25,000 products

const PAGE_MAX = 20_000; // product pages read per sync
const PAGE_CONCURRENCY = 6;
const MAX_SITEMAP_FILES = 40;

interface PublicResponse {
  status: number;
  text: string;
  headers: Headers;
  url: URL;
}

/** GET a public address (redirects checked one by one). Network/address problems throw; HTTP errors come back as a status. */
export async function fetchPublic(urlString: string, accept = "*/*", timeoutMs = REQUEST_TIMEOUT_MS): Promise<PublicResponse> {
  let url = new URL(urlString);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHost(url);
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", headers: { Accept: accept, "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e: any) {
      const reason = e?.name === "TimeoutError" ? "it took too long to answer" : "it could not be reached";
      throw new WooStoreError(`The website didn't respond (${reason}). Try again later.`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location")!, url);
      const local = next.hostname === "localhost" || next.hostname === "127.0.0.1";
      if (next.protocol !== "https:" && !(local && allowLocal())) throw new WooStoreError("The website redirected to a non-https address");
      url = next;
      continue;
    }
    if (Number(res.headers.get("content-length")) > MAX_TEXT_BYTES) throw new WooStoreError("The website sent back too much data.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_TEXT_BYTES) throw new WooStoreError("The website sent back too much data.");
    return { status: res.status, text: buf.toString("utf8"), headers: res.headers, url };
  }
  throw new WooStoreError("The website redirected too many times");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** "https://shop.com/some/page" → "https://shop.com" (Shopify and page-data shops are read from the website root). */
export function siteOrigin(storeUrl: string): string {
  return new URL(normalizeStoreUrl(storeUrl)).origin;
}

/** "1,999.00" / 1999 / "₹ 1999" → "1999.00", or null. */
function decimal(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v.toFixed(2);
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^\d.,]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned).toFixed(2);
}

const clip = (s: string) => (s.length > MAX_DESCRIPTION ? `${s.slice(0, MAX_DESCRIPTION).trimEnd()}…` : s);

// ───────────────────────────── Shopify ─────────────────────────────

/** One /products.json product → our fields. Shopify tags are left out (shops use them for internal labels). Exported for tests. */
export function mapShopifyProduct(p: any, origin: string): WooProduct | null {
  if (!p || typeof p !== "object" || p.id == null || typeof p.title !== "string") return null;
  const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
  const prices = variants.map(v => decimal(v?.price)).filter((x): x is string => !!x);
  const lowest = prices.length ? prices.reduce((a, b) => (Number(b) < Number(a) ? b : a)) : null;
  const onePrice = prices.length > 0 && prices.every(x => Number(x) === Number(prices[0]));
  const compare = onePrice && variants.length ? decimal(variants[0]?.compare_at_price) : null;

  const parts: string[] = [];
  const body = typeof p.body_html === "string" ? htmlToText(p.body_html) : "";
  if (body) parts.push(body);
  if (Array.isArray(p.options)) {
    for (const o of p.options) {
      const values = Array.isArray(o?.values) ? o.values.map((v: any) => decodeEntities(String(v))).filter(Boolean) : [];
      if (!o?.name || o.name === "Title" || values.length < 2) continue;
      parts.push(`${decodeEntities(String(o.name))}: ${values.join(", ")}`);
    }
  }
  if (!onePrice && lowest) parts.push("Price depends on the option chosen (shown price is the lowest).");

  const image = Array.isArray(p.images) ? p.images.find((i: any) => typeof i?.src === "string" && i.src) : null;
  const handle = typeof p.handle === "string" && p.handle ? p.handle : null;
  const anyAvailable = variants.length === 0 || variants.some(v => v?.available !== false);
  const type = typeof p.product_type === "string" ? decodeEntities(p.product_type).trim() : "";
  const sku = variants.length === 1 && typeof variants[0]?.sku === "string" && variants[0].sku.trim() ? variants[0].sku.trim() : null;
  return {
    externalId: String(p.id),
    name: decodeEntities(p.title).trim() || `Product ${p.id}`,
    description: clip(parts.join("\n\n")),
    price: lowest,
    regularPrice: compare && lowest && Number(compare) > Number(lowest) ? compare : null,
    imageUrl: image ? image.src : null,
    productUrl: handle ? `${origin}/products/${encodeURIComponent(handle)}` : null,
    sku,
    stockStatus: anyAvailable ? "in_stock" : "out_of_stock",
    categories: type ? [type] : [],
    tags: [],
  };
}

async function shopifyPage(origin: string, limit: number, page: number): Promise<any[] | null> {
  const res = await fetchPublic(`${origin}/products.json?limit=${limit}&page=${page}`, "application/json");
  if (res.status === 429) throw new WooStoreError("The website asked us to slow down. Try again in a while.", 429);
  if (res.status !== 200) return null;
  const body = parseJson(res.text) as any;
  return body && Array.isArray(body.products) ? body.products : null;
}

/** The shop's currency (from its public cart), or null. */
async function shopifyCurrency(origin: string): Promise<string | null> {
  try {
    const res = await fetchPublic(`${origin}/cart.js`, "application/json", 15_000);
    const code = (parseJson(res.text) as any)?.currency;
    return typeof code === "string" && /^[A-Z]{3}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

export async function fetchShopifyProducts(storeUrl: string, opts: { maxPages?: number; limit?: number | null } = {}): Promise<WooFetchResult> {
  const origin = siteOrigin(storeUrl);
  const maxPages = opts.maxPages ?? SHOPIFY_MAX_PAGES;
  const limit = opts.limit ?? null;
  const products: WooProduct[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    if (page > maxPages) {
      if (limit) break;
      throw new WooStoreError(`The website has more than ${maxPages * SHOPIFY_PER_PAGE} products, which is more than the sync can read.`);
    }
    const list = await shopifyPage(origin, SHOPIFY_PER_PAGE, page);
    if (!list) {
      throw new WooStoreError(page === 1
        ? "This Shopify shop's public product list can't be read (the shop may be password-protected or blocking servers)."
        : "The website stopped answering part-way through the product list, so nothing was changed. Try again later.");
    }
    for (const raw of list) {
      const mapped = mapShopifyProduct(raw, origin);
      if (!mapped || seen.has(mapped.externalId)) continue;
      seen.add(mapped.externalId);
      products.push(mapped);
      if (limit && products.length >= limit) break;
    }
    if (limit && products.length >= limit) break;
    if (list.length < SHOPIFY_PER_PAGE) break;
  }
  return { products, currency: await shopifyCurrency(origin) };
}

// ─────────────────────── Any other shop: product pages ───────────────────────

const typeIs = (node: any, wanted: string[]) => {
  const t = node?.["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.some(x => typeof x === "string" && wanted.includes(x.replace(/^(https?:\/\/)?schema\.org\//, "").replace(/^schema:/, "")));
};

function collectProducts(node: any, out: any[], depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return;
  if (Array.isArray(node)) {
    for (const n of node) collectProducts(n, out, depth + 1);
    return;
  }
  if (typeIs(node, ["Product", "ProductGroup", "IndividualProduct", "ProductModel"])) out.push(node);
  if (node["@graph"]) collectProducts(node["@graph"], out, depth + 1);
  if (node.mainEntity) collectProducts(node.mainEntity, out, depth + 1);
}

function jsonLdProducts(html: string): any[] {
  const out: any[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].trim().replace(/^<!--|-->$/g, "").replace(/^\s*\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>\s*$/g, "");
    const parsed = parseJson(raw);
    if (parsed !== undefined) collectProducts(parsed, out);
  }
  return out;
}

const firstString = (v: any): string | null => {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (Array.isArray(v)) for (const x of v) { const s = firstString(x); if (s) return s; }
  if (v && typeof v === "object") return firstString(v.url ?? v.contentUrl ?? v.name ?? v["@id"]);
  return null;
};

function offersOf(p: any): any[] {
  const list: any[] = [];
  const add = (o: any) => { if (Array.isArray(o)) o.forEach(add); else if (o && typeof o === "object") list.push(o); };
  add(p.offers);
  if (Array.isArray(p.hasVariant)) for (const v of p.hasVariant) add(v?.offers);
  return list;
}

const offerPrice = (o: any) => decimal(o.price ?? o.lowPrice ?? o.priceSpecification?.price ?? (Array.isArray(o.priceSpecification) ? o.priceSpecification[0]?.price : undefined));

function availabilityOf(v: unknown): WooProduct["stockStatus"] {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (/outofstock|soldout|discontinued/.test(s)) return "out_of_stock";
  if (/backorder|preorder|presale/.test(s)) return "on_backorder";
  return "in_stock";
}

function metaContent(html: string, key: string): string | null {
  const re = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${key.replace(/[:.]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content\s*=\s*("([^"]*)"|'([^']*)')/i);
  const v = content ? content[2] ?? content[3] : null;
  return v ? decodeEntities(v).trim() || null : null;
}

/**
 * The product on one product page: schema.org Product data first (the one for this page when several are
 * listed), else the og:product tags. Null for pages that aren't a product. Exported for tests.
 */
export function extractPageProduct(html: string, pageUrl: string): (WooProduct & { currency: string | null }) | null {
  const pagePath = new URL(pageUrl).pathname.replace(/\/+$/, "");
  const found = jsonLdProducts(html).filter(p => typeof p?.name === "string" && p.name.trim());
  const pick = found.find(p => {
    const u = firstString(p.url);
    try { return !!u && new URL(u, pageUrl).pathname.replace(/\/+$/, "") === pagePath; } catch { return false; }
  }) ?? found[0];

  if (pick) {
    const offers = offersOf(pick);
    const prices = offers.map(offerPrice).filter((x): x is string => !!x);
    const lowest = prices.length ? prices.reduce((a, b) => (Number(b) < Number(a) ? b : a)) : null;
    const many = prices.some(x => Number(x) !== Number(prices[0]));
    const currency = offers.map(o => o.priceCurrency ?? o.priceSpecification?.priceCurrency).find((c): c is string => typeof c === "string" && /^[A-Z]{3}$/.test(c)) ?? null;
    const stock: WooProduct["stockStatus"] = offers.length === 0
      ? "in_stock"
      : offers.some(o => availabilityOf(o.availability) === "in_stock") ? "in_stock"
        : offers.some(o => availabilityOf(o.availability) === "on_backorder") ? "on_backorder" : "out_of_stock";
    const desc = typeof pick.description === "string" ? htmlToText(pick.description) : "";
    const category = firstString(pick.category);
    const sku = firstString(pick.sku) ?? firstString(pick.mpn);
    return {
      externalId: pagePath || "/",
      name: decodeEntities(pick.name).trim(),
      description: clip([desc, many ? "Price depends on the option chosen (shown price is the lowest)." : ""].filter(Boolean).join("\n\n")),
      price: lowest,
      regularPrice: null,
      imageUrl: absoluteUrl(firstString(pick.image), pageUrl),
      productUrl: pageUrl,
      sku,
      stockStatus: stock,
      categories: category ? [decodeEntities(category.split(/\s*[>|/]\s*/).pop() || category).trim()].filter(Boolean) : [],
      tags: [],
      currency,
    };
  }

  const ogType = metaContent(html, "og:type");
  const ogPrice = metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount");
  const ogTitle = metaContent(html, "og:title");
  if (!ogTitle || !(ogType?.toLowerCase().includes("product") || ogPrice)) return null;
  const currency = metaContent(html, "product:price:currency") ?? metaContent(html, "og:price:currency");
  return {
    externalId: pagePath || "/",
    name: ogTitle,
    description: clip(metaContent(html, "og:description") ?? ""),
    price: decimal(ogPrice),
    regularPrice: null,
    imageUrl: absoluteUrl(metaContent(html, "og:image"), pageUrl),
    productUrl: pageUrl,
    sku: null,
    stockStatus: availabilityOf(metaContent(html, "product:availability") ?? metaContent(html, "og:availability")),
    categories: [],
    tags: [],
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
  };
}

function absoluteUrl(v: string | null, base: string): string | null {
  if (!v) return null;
  try {
    const u = new URL(v, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");
const PRODUCT_PATH = /\/(products?|p|item|items|shop|store|catalog|catalogue)\/|[-_/]p[-_]?\d+|\/dp\/|\.html$/i;

function locs(xml: string, tag: "sitemap" | "url"): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<loc>\\s*(?:<!\\[CDATA\\[)?([^<\\]]+?)(?:\\]\\]>)?\\s*<\\/loc>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1].trim()));
  return out;
}

/**
 * The website's product page addresses, from its sitemap(s): product sitemaps when the website has them
 * (most shop systems do), otherwise pages whose address looks like a product page. Exported for tests.
 */
export async function findProductPages(origin: string): Promise<{ pages: string[]; fromProductSitemap: boolean }> {
  const host = bareHost(new URL(origin).hostname);
  const start: string[] = [];
  try {
    const robots = await fetchPublic(`${origin}/robots.txt`, "text/plain", 15_000);
    if (robots.status === 200) {
      for (const line of robots.text.split(/\r?\n/)) {
        const m = line.match(/^\s*sitemap:\s*(\S+)/i);
        if (m) start.push(m[1]);
      }
    }
  } catch { /* no robots.txt: try the usual places */ }
  if (start.length === 0) start.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);

  const queue = Array.from(new Set(start));
  const visited = new Set<string>();
  const productSitemapUrls: string[] = [];
  const otherUrls: string[] = [];
  while (queue.length && visited.size < MAX_SITEMAP_FILES) {
    const next = queue.shift()!;
    if (visited.has(next) || /\.gz($|\?)/i.test(next)) continue;
    visited.add(next);
    let res: PublicResponse;
    try {
      res = await fetchPublic(next, "application/xml,text/xml;q=0.9,*/*;q=0.5", 20_000);
    } catch {
      continue;
    }
    if (res.status !== 200) continue;
    const children = locs(res.text, "sitemap");
    // Product sitemaps first, so a big website's blog/category sitemaps don't use up the file limit.
    children.sort((a, b) => Number(/product/i.test(b)) - Number(/product/i.test(a)));
    queue.push(...children);
    const isProductSitemap = /product/i.test(next);
    for (const u of locs(res.text, "url")) {
      try {
        if (bareHost(new URL(u).hostname) !== host) continue;
      } catch {
        continue;
      }
      (isProductSitemap ? productSitemapUrls : otherUrls).push(u);
    }
  }
  if (productSitemapUrls.length) return { pages: Array.from(new Set(productSitemapUrls)), fromProductSitemap: true };
  return { pages: Array.from(new Set(otherUrls.filter(u => PRODUCT_PATH.test(new URL(u).pathname)))), fromProductSitemap: false };
}

async function readPage(pageUrl: string) {
  const res = await fetchPublic(pageUrl, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", 20_000);
  if (res.status === 404 || res.status === 410) return { gone: true as const };
  if (res.status !== 200) throw new WooStoreError(`Page answered ${res.status}`, res.status);
  return { product: extractPageProduct(res.text, res.url.toString()) };
}

export async function fetchPageDataProducts(storeUrl: string, opts: { maxPages?: number; limit?: number | null } = {}): Promise<WooFetchResult> {
  const origin = siteOrigin(storeUrl);
  const maxPages = opts.maxPages ?? PAGE_MAX;
  const limit = opts.limit ?? null;
  const { pages } = await findProductPages(origin);
  if (pages.length === 0) throw new WooStoreError("No product pages were found in the website's sitemap.");
  if (pages.length > maxPages && !limit) throw new WooStoreError(`The website lists more than ${maxPages} product pages, which is more than the sync can read.`);

  const products: WooProduct[] = [];
  const seen = new Set<string>();
  const currencies = new Map<string, number>();
  let failed = 0;
  let next = 0;
  const worker = async () => {
    // With a limit, pages are read in sitemap order until enough products are found.
    while (next < pages.length && !(limit && products.length >= limit)) {
      const pageUrl = pages[next++];
      try {
        const r = await readPage(pageUrl);
        if ("gone" in r || !r.product) continue;
        const { currency, ...product } = r.product;
        if (seen.has(product.externalId) || (limit && products.length >= limit)) continue;
        seen.add(product.externalId);
        products.push(product);
        if (currency) currencies.set(currency, (currencies.get(currency) ?? 0) + 1);
      } catch (e: any) {
        failed++;
        if (e?.status === 429) await new Promise(r => setTimeout(r, 5000));
      }
    }
  };
  await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, worker));
  // Too many pages that didn't load would look like deleted products: change nothing.
  const tried = Math.min(next, pages.length);
  if (failed > Math.max(5, tried * 0.2)) {
    throw new WooStoreError(`${failed} of ${tried} product pages didn't load, so nothing was changed. Try again later.`);
  }
  const currency = Array.from(currencies.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { products, currency };
}

// ───────────────────────────── Detection ─────────────────────────────

export interface WebsiteDetection {
  platform: WebsitePlatform;
  /** What the website is built on, in words ("Shopify", "WooCommerce", "Magento"…), when known. */
  platformName: string | null;
  /** How its products can be read without keys, or null when they can't be. */
  readMode: Exclude<WebsiteReadMode, "keys"> | null;
  /** The address to save (the website root, or the WordPress folder for WooCommerce). */
  storeUrl: string;
  /** Products found (WooCommerce), product pages found (other shops), or null when not counted up front (Shopify). */
  total: number | null;
  sample: string[];
  currency: string | null;
  /** WooCommerce website whose public list is off or blocked: keys from its developer are needed. */
  needsKeys: boolean;
  message: string;
}

const PLATFORM_HINTS: { name: string; test: RegExp }[] = [
  { name: "Shopify", test: /cdn\.shopify\.com|Shopify\.theme|shopify-section/i },
  { name: "WooCommerce", test: /woocommerce|wp-content\/plugins\/woocommerce/i },
  { name: "WordPress", test: /wp-content\/|wp-includes\//i },
  { name: "Magento", test: /Magento_|mage\/cookies|text\/x-magento-init/i },
  { name: "BigCommerce", test: /cdn\d*\.bigcommerce\.com|bigcommerce/i },
  { name: "Wix", test: /static\.wixstatic\.com|wix-code|X-Wix/i },
  { name: "Squarespace", test: /squarespace(-cdn)?\.com/i },
  { name: "PrestaShop", test: /prestashop/i },
  { name: "OpenCart", test: /route=product\/|catalog\/view\/theme/i },
  { name: "Dukaan", test: /mydukaan|dukaan\.app/i },
];

async function homepageHint(origin: string): Promise<{ name: string | null; html: string }> {
  try {
    const res = await fetchPublic(origin, "text/html,*/*;q=0.5", 20_000);
    const head = `${res.headers.get("powered-by") ?? ""} ${res.headers.get("x-powered-by") ?? ""} ${res.headers.get("x-shopid") ? "cdn.shopify.com" : ""}`;
    const text = `${head}\n${res.text.slice(0, 400_000)}`;
    return { name: PLATFORM_HINTS.find(h => h.test.test(text))?.name ?? null, html: res.text };
  } catch {
    return { name: null, html: "" };
  }
}

async function tryShopify(origin: string): Promise<WebsiteDetection | null> {
  let list: any[] | null;
  try {
    list = await shopifyPage(origin, 5, 1);
  } catch {
    return null;
  }
  if (!list) return null;
  const mapped = list.map(p => mapShopifyProduct(p, origin)).filter((p): p is WooProduct => !!p);
  const currency = await shopifyCurrency(origin);
  return {
    platform: "shopify", platformName: "Shopify", readMode: "shopify", storeUrl: origin, total: null,
    sample: mapped.slice(0, 5).map(p => p.name), currency, needsKeys: false,
    message: mapped.length
      ? "This is a Shopify shop. Its products can be read from the website link (no keys)."
      : "This is a Shopify shop, but it shows no products yet.",
  };
}

async function tryWooCommerce(base: string): Promise<WebsiteDetection | "wordpress" | null> {
  const res = await fetchPublic(`${base}/wp-json/wc/store/v1/products?per_page=5`, "application/json").catch(() => null);
  if (res?.status === 200) {
    const body = parseJson(res.text);
    if (Array.isArray(body)) {
      const total = Number(res.headers.get("x-wp-total"));
      return {
        platform: "woocommerce", platformName: "WooCommerce", readMode: "public", storeUrl: base,
        total: Number.isFinite(total) && total >= 0 ? total : body.length,
        sample: body.slice(0, 5).map((p: any) => (typeof p?.name === "string" ? decodeEntities(p.name) : "")).filter(Boolean),
        currency: typeof (body[0] as any)?.prices?.currency_code === "string" ? (body[0] as any).prices.currency_code : null,
        needsKeys: false,
        message: "This is a WooCommerce shop. Its products can be read from the website link (no keys).",
      };
    }
  }
  // A WordPress website with WooCommerce whose public list is off or blocked.
  const index = await fetchPublic(`${base}/wp-json/`, "application/json").catch(() => null);
  if (index?.status === 200) {
    const ns = (parseJson(index.text) as any)?.namespaces;
    if (Array.isArray(ns) && ns.some((n: unknown) => typeof n === "string" && n.startsWith("wc/"))) return "wordpress";
  }
  return null;
}

async function tryPageData(origin: string): Promise<{ total: number; sample: string[]; currency: string | null } | null> {
  const { pages } = await findProductPages(origin).catch(() => ({ pages: [] as string[] }));
  if (pages.length === 0) return null;
  const sample: string[] = [];
  let currency: string | null = null;
  // A few pages spread over the list: enough to know the pages carry product details.
  const step = Math.max(1, Math.floor(pages.length / 6));
  for (let i = 0; i < pages.length && i < step * 6; i += step) {
    const r = await readPage(pages[i]).catch(() => null);
    if (r && "product" in r && r.product) {
      sample.push(r.product.name);
      currency = currency ?? r.product.currency;
    }
  }
  return sample.length ? { total: pages.length, sample, currency } : null;
}

/** What kind of shop the website is and how to read its products. Throws WooStoreError for a bad or unreachable address. */
export async function detectWebsite(input: unknown): Promise<WebsiteDetection> {
  const base = normalizeStoreUrl(input);
  const origin = new URL(base).origin;
  // A bad or private address is refused here, not reported as "no products found".
  await assertPublicHost(new URL(origin));
  const hint = await homepageHint(origin);

  const shopify = await tryShopify(origin);
  if (shopify) return shopify;

  // WooCommerce: the WordPress folder typed, then the website root.
  let woo = await tryWooCommerce(base);
  if (!woo && base !== origin) woo = await tryWooCommerce(origin);
  if (woo && woo !== "wordpress") return woo;

  const pageData = await tryPageData(origin);
  const name = hint.name === "WordPress" && woo === "wordpress" ? "WooCommerce" : hint.name;
  if (woo === "wordpress" && !pageData) {
    return {
      platform: "woocommerce", platformName: "WooCommerce", readMode: null, storeUrl: base, total: null, sample: [], currency: null, needsKeys: true,
      message: "This is a WooCommerce shop, but its public product list is switched off or blocked. Connect with the WooCommerce keys from the website's developer.",
    };
  }
  if (pageData) {
    return {
      platform: woo === "wordpress" ? "woocommerce" : "other", platformName: name, readMode: "pagedata", storeUrl: origin,
      total: pageData.total, sample: pageData.sample.slice(0, 5), currency: pageData.currency, needsKeys: woo === "wordpress",
      message: `${name ? `This website runs on ${name}. ` : ""}Its products can be read from its product pages (${pageData.total} found in the sitemap${pageData.total > PAGE_MAX ? `, more than the ${PAGE_MAX} the sync can read` : pageData.total > 2000 ? `; reading them all takes about ${Math.ceil(pageData.total / 600)} minutes` : ""}).`,
    };
  }
  return {
    platform: "other", platformName: name, readMode: null, storeUrl: origin, total: null, sample: [], currency: null, needsKeys: false,
    message: `${name ? `This website runs on ${name}, but its` : "This website's"} products couldn't be found automatically (no product list or product details for Google). Use Import from Excel instead.`,
  };
}

/**
 * Every product on the website, read the way that suits it. `limit`: only the first N products the website
 * lists (a demo needs a few, not the whole catalog). Throws WooStoreError with a plain message.
 */
export async function readWebsiteProducts(storeUrl: string, readMode: WebsiteReadMode, keys?: WooKeys, limit?: number | null): Promise<WooFetchResult> {
  if (readMode === "shopify") return fetchShopifyProducts(storeUrl, { limit });
  if (readMode === "pagedata") return fetchPageDataProducts(storeUrl, { limit });
  return fetchStoreProducts(storeUrl, { keys: readMode === "keys" ? keys : undefined, limit });
}

export const PRODUCT_LIMIT_MAX = 100_000;

/** A product limit from a form: a whole number from 1, or null for all products. Throws WooStoreError. */
export function parseProductLimit(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "all") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > PRODUCT_LIMIT_MAX) throw new WooStoreError("Type how many products to bring in (a whole number from 1), or choose all products.");
  return n;
}

export const isWebsiteReadMode = (v: unknown): v is WebsiteReadMode => v === "public" || v === "keys" || v === "shopify" || v === "pagedata";
