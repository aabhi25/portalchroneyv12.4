/**
 * Website products for any kind of shop, end to end against a local Postgres/PGlite, stand-in websites and a
 * fake OpenAI for search fingerprints:
 *
 *  - Shopify products (/products.json): prices, sale price, options, stock, product link, type as category;
 *  - product pages of other shops: schema.org Product data (plain, @graph, variants) and og:product tags;
 *  - "Check website": Shopify, WooCommerce (public list, or keys needed), other shops read from their
 *    sitemap's product pages, and websites whose products can't be found;
 *  - Connect + later syncs for a Shopify shop (2 pages) and a page-data shop: added / changed / removed,
 *    the chat switches to the website products; too many product pages failing changes nothing.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55581/postgres?sslmode=disable \
 *   WEBSITE_STORES_TEST_DB=1 npx tsx server/services/__tests__/websiteStores.integration.test.ts
 */
process.env.TZ = 'UTC';
import crypto from 'crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const url = process.env.DATABASE_URL || '';
if (process.env.WEBSITE_STORES_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set WEBSITE_STORES_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString('hex');
process.env.OPENAI_API_KEY = 'sk-test-fake';
process.env.WOO_ALLOW_LOCAL_STORE = '1';

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 700)}` : ''}`); }
  else console.log(`✓ ${label}`);
}
const rnd = () => crypto.randomBytes(4).toString('hex');

function startFakeOpenAI(): Promise<{ baseUrl: string; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body || '{}');
        if (!req.url?.endsWith('/embeddings')) { res.writeHead(404); res.end('{}'); return; }
        const inputs: string[] = Array.isArray(j.input) ? j.input : [j.input];
        const data = inputs.map((_t, index) => {
          const v = new Float32Array(1536); v[index % 1536] = 1;
          return { object: 'embedding', index, embedding: j.encoding_format === 'base64' ? Buffer.from(v.buffer).toString('base64') : Array.from(v) };
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data, model: 'text-embedding-3-small', usage: { prompt_tokens: 5, total_tokens: 5 } }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() }));
  });
}

type Handler = (path: URL, res: http.ServerResponse) => void;
function startSite(handler: Handler): Promise<{ base: string; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://x');
      handler(u, res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() }));
  });
}
const send = (res: http.ServerResponse, status: number, body: string, type = 'application/json', headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': type, ...headers });
  res.end(body);
};

// ── Stand-in Shopify shop ──
interface ShopItem { id: number; title: string; price: number; compare?: number; sizes?: number[]; soldOut?: boolean; type?: string }
const shop = { items: [] as ShopItem[] };
function shopifyJson(p: ShopItem) {
  const variants = (p.sizes ?? [0]).map((s, i) => ({
    id: p.id * 10 + i, title: s ? String(s) : 'Default Title', price: (p.price + i * 100).toFixed(2),
    compare_at_price: p.compare ? p.compare.toFixed(2) : null, available: !p.soldOut, sku: `SK${p.id}${i}`,
  }));
  return {
    id: p.id, title: p.title, handle: `item-${p.id}`, product_type: p.type ?? 'Rings', vendor: 'Shop', tags: ['internal_tag_1', 'sale_2025'],
    body_html: `<p>${p.title} in <b>925 silver</b>.</p>`,
    options: p.sizes ? [{ name: 'Size', values: p.sizes.map(String) }] : [{ name: 'Title', values: ['Default Title'] }],
    variants, images: [{ src: `https://cdn.example.test/${p.id}.jpg` }],
  };
}

// ── Stand-in shop with product pages ──
const pages = { count: 30, failFrom: Infinity, priceBump: 0 };
function productPage(n: number, base: string): string {
  if (n === 1) {
    // og:product tags only.
    return `<html><head><meta property="og:type" content="product"><meta property="og:title" content="Linen Kurta 1">
      <meta property="og:image" content="/img/1.jpg"><meta property="product:price:amount" content="1,299.00"><meta property="product:price:currency" content="INR"></head></html>`;
  }
  if (n === 2) {
    // @graph with a variant group and a related product listed after it.
    return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebPage', name: 'x' },
      { '@type': 'ProductGroup', name: 'Cotton Saree 2', url: `${base}/p/item-2`, description: '<p>Soft &amp; light</p>', image: [{ '@type': 'ImageObject', url: `${base}/img/2.jpg` }],
        category: 'Women > Sarees', hasVariant: [
          { '@type': 'Product', offers: { '@type': 'Offer', price: 2500 + pages.priceBump, priceCurrency: 'INR', availability: 'https://schema.org/OutOfStock' } },
          { '@type': 'Product', offers: { '@type': 'Offer', price: 2100 + pages.priceBump, priceCurrency: 'INR', availability: 'https://schema.org/InStock' } },
        ] },
      { '@type': 'Product', name: 'Related thing', url: `${base}/p/other`, offers: { price: 10 } },
    ] })}</script>`;
  }
  return `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Item ${n}","sku":"FB-${n}",
    "image":"${base}/img/${n}.jpg","description":"Handmade item ${n}","offers":{"@type":"Offer","price":"${100 * n + pages.priceBump}","priceCurrency":"INR","availability":"InStock"}}</script>`;
}

async function main() {
  const openai = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = openai.baseUrl;

  const shopify = await startSite((u, res) => {
    if (u.pathname === '/products.json') {
      const limit = Number(u.searchParams.get('limit')), page = Number(u.searchParams.get('page') || 1);
      return send(res, 200, JSON.stringify({ products: shop.items.slice((page - 1) * limit, page * limit).map(shopifyJson) }));
    }
    if (u.pathname === '/cart.js') return send(res, 200, JSON.stringify({ currency: 'INR', items: [] }));
    if (u.pathname === '/') return send(res, 200, '<html><link href="//cdn.shopify.com/x.css"></html>', 'text/html');
    send(res, 404, 'not found', 'text/plain');
  });
  const pageShop = await startSite((u, res) => {
    const base = `http://127.0.0.1:${(res.socket as any)?.localPort}`;
    if (u.pathname === '/robots.txt') return send(res, 200, `User-agent: *\nSitemap: ${base}/sitemap_index.xml\n`, 'text/plain');
    if (u.pathname === '/sitemap_index.xml') return send(res, 200, `<sitemapindex><sitemap><loc>${base}/sitemap-pages.xml</loc></sitemap><sitemap><loc>${base}/sitemap-products-1.xml</loc></sitemap></sitemapindex>`, 'application/xml');
    if (u.pathname === '/sitemap-pages.xml') return send(res, 200, `<urlset><url><loc>${base}/about</loc></url><url><loc>${base}/p/not-in-product-sitemap</loc></url></urlset>`, 'application/xml');
    if (u.pathname === '/sitemap-products-1.xml') {
      const urls = Array.from({ length: pages.count }, (_, i) => `<url><loc>${base}/p/item-${i + 1}</loc></url>`).join('');
      return send(res, 200, `<urlset>${urls}<url><loc>https://elsewhere.test/p/x</loc></url><url><loc>${base}/p/gone</loc></url></urlset>`, 'application/xml');
    }
    const m = u.pathname.match(/^\/p\/item-(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n >= pages.failFrom) return send(res, 503, 'busy', 'text/plain');
      return send(res, 200, `<html><head>${productPage(n, base)}</head><body>x</body></html>`, 'text/html');
    }
    if (u.pathname === '/') return send(res, 200, '<html><script type="text/x-magento-init">{}</script></html>', 'text/html');
    send(res, 404, 'not found', 'text/plain');
  });
  const woo = await startSite((u, res) => {
    if (u.pathname === '/wp-json/wc/store/v1/products') {
      return send(res, 200, JSON.stringify([{ id: 1, name: 'Strep A', prices: { price: '10000', currency_code: 'INR', currency_minor_unit: 2 } }]), 'application/json', { 'x-wp-total': '42' });
    }
    send(res, 404, '{}');
  });
  const wpNoStore = await startSite((u, res) => {
    if (u.pathname === '/wp-json/') return send(res, 200, JSON.stringify({ namespaces: ['wp/v2', 'wc/v3'] }));
    send(res, 404, '{}');
  });
  const plain = await startSite((u, res) => send(res, u.pathname === '/' ? 200 : 404, '<html><body>Hello</body></html>', 'text/html'));

  const { db, pool } = await import('../../db');
  const { storage } = await import('../../storage');
  const { and, eq } = await import('drizzle-orm');
  const { businessAccounts, products, categories, productCategories } = await import('@shared/schema');
  const { mapShopifyProduct, extractPageProduct, detectWebsite, findProductPages } = await import('../websiteStores');
  const { syncWooCommerce } = await import('../wooCommerceSync');
  const { getLiveProductSource } = await import('../productSourceSwitch');
  const { setMessagingImageStore } = await import('../messagingImages');
  setMessagingImageStore(null as any);

  // ── 1. Reading Shopify products ──
  const s1 = mapShopifyProduct(shopifyJson({ id: 5, title: 'Silver &amp; Gold Ring', price: 1999, compare: 7099 }), 'https://shop.test');
  expect(s1?.name === 'Silver & Gold Ring' && s1.price === '1999.00' && s1.regularPrice === '7099.00', 'Shopify: name decoded, price + crossed-out price', s1);
  expect(s1?.description === 'Silver & Gold Ring in 925 silver.' && s1.productUrl === 'https://shop.test/products/item-5', 'Shopify: description text and product link', s1);
  expect(s1?.categories[0] === 'Rings' && s1.tags.length === 0 && s1.sku === 'SK50' && s1.stockStatus === 'in_stock', 'Shopify: type as category, internal tags left out, SKU, in stock', s1);
  const s2 = mapShopifyProduct(shopifyJson({ id: 6, title: 'Band', price: 1000, compare: 3000, sizes: [6, 7, 8], soldOut: true }), 'https://shop.test');
  expect(s2?.price === '1000.00' && s2.regularPrice === null && /Size: 6, 7, 8/.test(s2.description) && /lowest/.test(s2.description), 'Shopify with sizes: lowest price, sizes listed, no single crossed-out price', s2);
  expect(s2?.stockStatus === 'out_of_stock', 'Shopify: every option sold out → out of stock');

  // ── 2. Reading product pages ──
  const og = extractPageProduct(productPage(1, 'https://f.test'), 'https://f.test/p/item-1');
  expect(og?.name === 'Linen Kurta 1' && og.price === '1299.00' && og.currency === 'INR' && og.imageUrl === 'https://f.test/img/1.jpg', 'page: og:product tags read (comma price, relative photo)', og);
  pages.priceBump = 0;
  const grp = extractPageProduct(productPage(2, 'https://f.test'), 'https://f.test/p/item-2');
  expect(grp?.name === 'Cotton Saree 2' && grp.price === '2100.00' && grp.stockStatus === 'in_stock', 'page: @graph variant group → this page\'s product, lowest price, in stock if any option is', grp);
  expect(grp?.categories[0] === 'Sarees' && grp.description.startsWith('Soft & light') && grp.externalId === '/p/item-2', 'page: last part of the category path, HTML description, page path as id', grp);
  expect(extractPageProduct('<html><head><title>About us</title></head></html>', 'https://f.test/about') === null, 'page: a page without product details is skipped');
  const found = await findProductPages(pageShop.base);
  expect(found.fromProductSitemap && found.pages.length === 31 && !found.pages.some(p => p.includes('elsewhere')), 'sitemap: product sitemap used, other websites left out', found.pages.length);

  // ── 3. Check website ──
  const dShop = await detectWebsite(`${shopify.base}/collections/rings?utm_source=google&gclid=abc`);
  shop.items = Array.from({ length: 260 }, (_, i) => ({ id: 100 + i, title: `Ring ${i}`, price: 500 + i }));
  expect(dShop.platform === 'shopify' && dShop.readMode === 'shopify' && dShop.storeUrl === shopify.base, 'Check: Shopify shop found from any page address with tracking', dShop);
  const dShop2 = await detectWebsite(shopify.base);
  expect(dShop2.sample[0] === 'Ring 0' && dShop2.currency === 'INR', 'Check: Shopify sample names + currency', dShop2);
  const dWoo = await detectWebsite(woo.base);
  expect(dWoo.platform === 'woocommerce' && dWoo.readMode === 'public' && dWoo.total === 42, 'Check: WooCommerce public list with its count', dWoo);
  const dWp = await detectWebsite(wpNoStore.base);
  expect(dWp.platform === 'woocommerce' && dWp.readMode === null && dWp.needsKeys, 'Check: WooCommerce with the public list off → keys needed', dWp);
  const dPages = await detectWebsite(pageShop.base);
  expect(dPages.platform === 'other' && dPages.readMode === 'pagedata' && dPages.platformName === 'Magento' && dPages.total === 31 && dPages.sample.length > 0, 'Check: other shop → product pages, platform named', dPages);
  const dPlain = await detectWebsite(plain.base);
  expect(dPlain.readMode === null && /Import from Excel/.test(dPlain.message), 'Check: no products found → Excel suggested', dPlain);
  let bad = '';
  try { await detectWebsite('https://10.0.0.5'); } catch (e: any) { bad = e.message; }
  expect(/isn't allowed/.test(bad), 'Check: private address refused', bad);

  // ── 4. Connect a Shopify shop (260 products = 2 pages) ──
  const A = (await storage.createBusinessAccount({ name: `Shopify test ${rnd()}`, website: 'https://example.test' } as any)).id;
  await db.update(businessAccounts).set({ wooCommerceEnabled: 'true', openaiApiKey: 'sk-test-fake' }).where(eq(businessAccounts.id, A));
  await storage.upsertWidgetSettings(A, { currency: 'INR' });
  await db.insert(products).values({ businessAccountId: A, name: 'Manual ring', description: 'x', price: '10', source: 'manual' });
  shop.items[3] = { id: 103, title: 'Band', price: 900, sizes: [6, 7], type: 'Bands' };
  const c1 = await syncWooCommerce(A, 'connect', { storeUrl: `${shopify.base}/products/x`, readMode: 'shopify' });
  expect(c1.ok && c1.total === 260 && c1.added === 260 && c1.currency === 'INR', 'Shopify Connect: 260 products over 2 pages', c1);
  const set1 = await storage.getWidgetSettings(A);
  expect(set1?.wooReadMode === 'shopify' && set1?.wooStoreUrl === shopify.base && set1?.wooConnected === 'true', 'Shopify Connect saves the website root and the way it is read', [set1?.wooReadMode, set1?.wooStoreUrl]);
  expect(await getLiveProductSource(A) === 'woocommerce', 'chat now uses the website products');
  const chat = await storage.getChatProducts(A);
  expect(chat.length === 260 && !chat.some((p: any) => p.name === 'Manual ring'), 'chat sees only the 260 website products', chat.length);
  const cats = await db.select({ name: categories.name }).from(categories).where(eq(categories.businessAccountId, A));
  expect(cats.map(c => c.name).sort().join(',') === 'Bands,Rings', 'product types became categories (Bands, Rings)', cats);
  const band = (await db.select().from(products).where(and(eq(products.businessAccountId, A), eq(products.externalId, '103'))))[0];
  const bandCats = await db.select().from(productCategories).where(eq(productCategories.productId, band.id));
  expect(band.price === '900.00' && /Size: 6, 7/.test(band.description || '') && bandCats.length === 1, 'Band saved with its lowest price, sizes and category', band.price);

  // Later sync: one gone, one new price, one sold out.
  shop.items.splice(10, 1);
  shop.items[0] = { ...shop.items[0], price: 450 };
  shop.items[1] = { ...shop.items[1], soldOut: true };
  const c2 = await syncWooCommerce(A, 'manual');
  expect(c2.ok && c2.total === 259 && c2.removed === 1 && c2.updated === 2 && c2.added === 0, 'Shopify Sync now: 1 removed, 2 updated', c2);
  const ring0 = (await db.select().from(products).where(and(eq(products.businessAccountId, A), eq(products.externalId, '100'))))[0];
  const ring1 = (await db.select().from(products).where(and(eq(products.businessAccountId, A), eq(products.externalId, '101'))))[0];
  expect(ring0.price === '450.00' && ring1.stockStatus === 'out_of_stock', 'new price and sold-out saved', [ring0.price, ring1.stockStatus]);
  const keep = shop.items;
  shop.items = [];
  const c3 = await syncWooCommerce(A, 'manual');
  expect(!c3.ok && (await storage.getChatProducts(A)).length === 259, 'Shopify shop suddenly empty → nothing changed', c3.error);
  shop.items = keep;

  // ── 5. Connect a shop read from its product pages ──
  const B = (await storage.createBusinessAccount({ name: `Pages test ${rnd()}`, website: 'https://example.test' } as any)).id;
  await db.update(businessAccounts).set({ wooCommerceEnabled: 'true', openaiApiKey: 'sk-test-fake' }).where(eq(businessAccounts.id, B));
  const p1 = await syncWooCommerce(B, 'connect', { storeUrl: pageShop.base, readMode: 'pagedata' });
  expect(p1.ok && p1.total === 30 && p1.added === 30 && p1.currency === 'INR', 'Pages Connect: 30 products from 31 product pages (one page gone)', p1);
  const item5 = (await db.select().from(products).where(and(eq(products.businessAccountId, B), eq(products.externalId, '/p/item-5'))))[0];
  expect(item5?.price === '500.00' && item5.sku === 'FB-5' && item5.productUrl === `${pageShop.base}/p/item-5`, 'page product saved with price, SKU and link', item5);
  pages.priceBump = 7;
  pages.count = 29;
  const p2 = await syncWooCommerce(B, 'manual');
  expect(p2.ok && p2.total === 29 && p2.removed === 1 && p2.updated === 28 && p2.unchanged === 1, 'Pages Sync now: prices changed (28), one unchanged, one page gone', p2);
  pages.failFrom = 10;
  const p3 = await syncWooCommerce(B, 'manual');
  expect(!p3.ok && /didn't load/.test(p3.error || '') && (await storage.getChatProducts(B)).length === 29, 'many product pages failing → nothing changed', p3.error);

  // Let the background fingerprint / photo work started by the syncs finish before closing.
  await new Promise(r => setTimeout(r, 3000));
  for (const s of [shopify, pageShop, woo, wpNoStore, plain, openai]) s.close();
  await pool.end().catch(() => {});
  if (failed) {
    console.error(`\n${failed} website product checks failed`);
    process.exit(1);
  }
  console.log('\nAll website product checks passed');
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
