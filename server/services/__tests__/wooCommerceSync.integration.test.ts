/**
 * WooCommerce product sync, end to end against a local Postgres/PGlite, a stand-in WooCommerce website
 * (the public Store API, two pages of products) and a fake OpenAI for search fingerprints:
 *
 *  - website address checks (https only, no private addresses) and how website products are read
 *    (prices in paise, HTML descriptions, sales, products with options, stock);
 *  - Connect: every product comes in, categories are reused by name, the chat switches to website products
 *    only (product lists, search by meaning), the manual products are kept untouched;
 *  - later syncs: changed / new / removed products, nothing re-written when nothing changed;
 *  - safety: an empty or much shorter list, a website error or another currency changes nothing and
 *    the chat keeps the last good products;
 *  - Disconnect / feature switch off → the chat is back on the manual products, website products kept;
 *  - the timer only syncs connected accounts whose time has come; one sync at a time;
 *  - reading with the website's keys (WooCommerce REST API): wrong keys, drafts and hidden products skipped,
 *    servers that drop the Authorization header, no keys sent after a redirect to another website,
 *    keys saved encrypted only when Connect works, switching between the two ways keeps the same products.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55571/postgres?sslmode=disable \
 *   WOO_SYNC_TEST_DB=1 npx tsx server/services/__tests__/wooCommerceSync.integration.test.ts
 */
process.env.TZ = 'UTC';
import crypto from 'crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const url = process.env.DATABASE_URL || '';
if (process.env.WOO_SYNC_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set WOO_SYNC_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(4).toString('hex');

// ── Fake OpenAI embeddings: a bag-of-words vector, so similar words score close ──
function fakeVector(text: string): Float32Array {
  const v = new Float32Array(1536);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) || []) {
    const h = crypto.createHash('md5').update(w).digest();
    v[h.readUInt16BE(0) % 1536] += 1;
  }
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
function startFakeOpenAI(): Promise<{ baseUrl: string; close: () => void; calls: () => number }> {
  let calls = 0;
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body || '{}');
        if (req.url?.endsWith('/embeddings')) {
          calls++;
          const inputs: string[] = Array.isArray(j.input) ? j.input : [j.input];
          const data = inputs.map((t, index) => {
            const v = fakeVector(String(t));
            return { object: 'embedding', index, embedding: j.encoding_format === 'base64' ? Buffer.from(v.buffer).toString('base64') : Array.from(v) };
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ object: 'list', data, model: 'text-embedding-3-small', usage: { prompt_tokens: 5, total_tokens: 5 } }));
          return;
        }
        res.writeHead(404); res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ baseUrl: `http://127.0.0.1:${port}/v1`, close: () => server.close(), calls: () => calls });
    });
  });
}

// ── Stand-in WooCommerce website (Store API) ──
interface FakeProduct { id: number; name: string; price: number; cats: string[]; tags?: string[]; inStock?: boolean; sale?: number; html?: string; options?: string[]; draft?: boolean; hidden?: boolean }
const TEST_KEY = 'ck_test_key_0001';
const TEST_SECRET = 'cs_test_secret_0001';
const store = {
  products: [] as FakeProduct[],
  mode: 'ok' as 'ok' | 'error' | 'html' | 'empty',
  currency: 'INR',
  requests: 0,
  stripAuthHeader: false, // like servers that drop the Authorization header
  keyedVia: [] as string[],
};
const visible = (list: FakeProduct[]) => list.filter(p => !p.draft && !p.hidden);
function restJson(p: FakeProduct, base: string) {
  return {
    id: p.id, name: p.name, slug: `p-${p.id}`, permalink: `${base}/product/p-${p.id}/`, type: p.options ? 'variable' : 'simple',
    status: p.draft ? 'draft' : 'publish', catalog_visibility: p.hidden ? 'hidden' : 'visible', sku: p.id % 2 ? `SKU-${p.id}` : '',
    price: String(p.sale ?? p.price), regular_price: p.options ? '' : String(p.price), sale_price: p.sale !== undefined ? String(p.sale) : '', on_sale: p.sale !== undefined,
    short_description: p.html ?? `<h3>Overview</h3>\n<p>${p.name} for clinical labs &amp; hospitals.</p>`, description: '',
    stock_status: p.inStock === false ? 'outofstock' : 'instock',
    categories: p.cats.map((name, i) => ({ id: i + 1, name, slug: name.toLowerCase() })),
    tags: (p.tags || []).map((name, i) => ({ id: 100 + i, name, slug: name.toLowerCase() })),
    images: [{ id: p.id * 10, src: `${base}/img/${p.id}.webp`, name: '', alt: '' }],
    attributes: p.options ? [{ id: 1, name: 'Pack size', variation: true, visible: true, options: p.options }] : [],
  };
}
function storeJson(p: FakeProduct, base: string) {
  const paise = (n: number) => String(Math.round(n * 100));
  const range = p.options ? { min_amount: paise(p.price), max_amount: paise(p.price * 2) } : null;
  return {
    id: p.id, name: p.name, slug: `p-${p.id}`, type: p.options ? 'variable' : 'simple', variation: '',
    permalink: `${base}/product/p-${p.id}/`, sku: p.id % 2 ? `SKU-${p.id}` : '',
    short_description: p.html ?? `<h3>Overview</h3>\n<p>${p.name} for clinical labs &amp; hospitals.</p>`, description: '',
    on_sale: p.sale !== undefined,
    prices: {
      price: paise(p.sale ?? p.price), regular_price: paise(p.price), sale_price: paise(p.sale ?? p.price), price_range: range,
      currency_code: store.currency, currency_symbol: '₹', currency_minor_unit: 2,
    },
    images: [{ id: p.id * 10, src: `${base}/img/${p.id}.webp`, thumbnail: `${base}/img/${p.id}-t.webp`, alt: '' }],
    categories: p.cats.map((name, i) => ({ id: i + 1, name, slug: name.toLowerCase(), link: '' })),
    tags: (p.tags || []).map((name, i) => ({ id: 100 + i, name, slug: name.toLowerCase(), link: '' })),
    attributes: p.options ? [{ id: 1, name: 'Pack size', taxonomy: null, has_variations: true, terms: p.options.map((o, i) => ({ id: i, name: o, slug: o })) }] : [],
    variations: p.options ? p.options.map((o, i) => ({ id: p.id * 100 + i, attributes: [{ name: 'Pack size', value: o }] })) : [],
    is_in_stock: p.inStock !== false, is_on_backorder: false, low_stock_remaining: null,
  };
}
function startFakeStore(): Promise<{ base: string; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://x');
      const base = `http://${req.headers.host}`;
      if (u.pathname === '/old-shop/wp-json/wc/store/v1/products') {
        res.writeHead(301, { location: `${base}/wp-json/wc/store/v1/products${u.search}` }); res.end(); return;
      }
      if (u.pathname.startsWith('/elsewhere/wp-json/wc/v3/')) {
        // Same server under another name: the keys must not follow.
        res.writeHead(301, { location: `${base.replace('127.0.0.1', 'localhost')}${u.pathname.replace('/elsewhere', '')}${u.search}` }); res.end(); return;
      }
      if (u.pathname.startsWith('/wp-json/wc/v3/')) {
        const header = store.stripAuthHeader ? '' : String(req.headers.authorization || '');
        const viaHeader = header === `Basic ${Buffer.from(`${TEST_KEY}:${TEST_SECRET}`).toString('base64')}`;
        const viaQuery = u.searchParams.get('consumer_key') === TEST_KEY && u.searchParams.get('consumer_secret') === TEST_SECRET;
        if (!viaHeader && !viaQuery) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"code":"woocommerce_rest_cannot_view"}'); return; }
        store.keyedVia.push(viaHeader ? 'header' : 'query');
        if (u.pathname === '/wp-json/wc/v3/data/currencies/current') {
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: store.currency, name: 'Rupee', symbol: '₹' })); return;
        }
        if (u.pathname !== '/wp-json/wc/v3/products') { res.writeHead(404); res.end('{}'); return; }
        store.requests++;
        if (store.mode === 'error') { res.writeHead(503); res.end('busy'); return; }
        const list = store.mode === 'empty' ? [] : store.products.filter(p => u.searchParams.get('status') !== 'publish' || !p.draft);
        const perPage = Math.min(100, Number(u.searchParams.get('per_page')) || 10);
        const page = Number(u.searchParams.get('page')) || 1;
        res.writeHead(200, { 'content-type': 'application/json', 'x-wp-total': String(list.length), 'x-wp-totalpages': String(Math.max(1, Math.ceil(list.length / perPage))) });
        res.end(JSON.stringify(list.slice((page - 1) * perPage, page * perPage).map(p => restJson(p, base))));
        return;
      }
      if (u.pathname !== '/wp-json/wc/store/v1/products') { res.writeHead(404); res.end('not found'); return; }
      store.requests++;
      if (store.mode === 'error') { res.writeHead(503); res.end('busy'); return; }
      if (store.mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>Checking your browser…</html>'); return; }
      const list = store.mode === 'empty' ? [] : visible(store.products);
      const perPage = Math.min(100, Number(u.searchParams.get('per_page')) || 10);
      const page = Number(u.searchParams.get('page')) || 1;
      const slice = list.slice((page - 1) * perPage, page * perPage);
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-wp-total': String(list.length),
        'x-wp-totalpages': String(Math.max(1, Math.ceil(list.length / perPage))),
      });
      res.end(JSON.stringify(slice.map(p => storeJson(p, base))));
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

const CATS = ['Hematology', 'System Reagents', 'Point of Care', 'General Health'];
function makeCatalog(n: number): FakeProduct[] {
  return Array.from({ length: n }, (_, i) => ({
    id: 1000 + i,
    name: i === 0 ? 'Accutest Strep A' : i === 1 ? 'Hematology Analyzer Lyse (LYC 1) 200ml' : `Lab reagent kit ${i}`,
    price: 2500 + i,
    cats: [CATS[i % CATS.length]],
    tags: i % 10 === 0 ? ['New Launch'] : [],
  }));
}

async function main() {
  const openai = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = openai.baseUrl;
  const site = await startFakeStore();

  const { db, pool } = await import('../../db');
  const { storage } = await import('../../storage');
  const { and, eq } = await import('drizzle-orm');
  const { businessAccounts, products, categories, widgetSettings, productCategories } = await import('@shared/schema');
  const { normalizeStoreUrl, mapStoreProduct, mapRestProduct, testStore, WooStoreError } = await import('../wooCommerceStore');
  const { decrypt } = await import('../encryptionService');
  const { syncWooCommerce, disconnectWooCommerce, wooCommerceSyncScheduler } = await import('../wooCommerceSync');
  const { getLiveProductSource, onProductSourceChanged } = await import('../productSourceSwitch');
  const { productTextEmbeddingService } = await import('../productTextEmbeddingService');

  // ── 1. Website address checks and product reading ──
  const throwsWoo = (fn: () => unknown) => { try { fn(); return null; } catch (e: any) { return e instanceof WooStoreError ? e.message : `other: ${e?.message}`; } };
  expect(normalizeStoreUrl('accurex.net/shop/?srsltid=abc') === 'https://accurex.net/shop', 'address: https added, tracking and trailing slash dropped', normalizeStoreUrl('accurex.net/shop/?srsltid=abc'));
  expect(normalizeStoreUrl('https://accurex.net/wp-json/wc/store/v1/products') === 'https://accurex.net', 'address: a pasted API address is trimmed to the website');
  expect(!!throwsWoo(() => normalizeStoreUrl('http://accurex.net')), 'address: plain http is refused');
  expect(!!throwsWoo(() => normalizeStoreUrl('')), 'address: empty is refused');
  let privateErr = '';
  try { await testStore('https://10.1.2.3'); } catch (e: any) { privateErr = e.message; }
  expect(/isn't allowed/.test(privateErr), 'address: a private network address is refused before any request', privateErr);

  const mapped = mapStoreProduct({
    id: 7, name: 'Strep &#8211; A &amp; B', permalink: 'https://x.test/p/7', sku: '',
    short_description: '<h3>Overview</h3>\n<p>Rapid <b>test</b>&nbsp;kit.</p><ul><li>Fast</li><li>Accurate</li></ul>', description: '',
    on_sale: true, prices: { price: '199900', regular_price: '250000', currency_code: 'INR', currency_minor_unit: 2, price_range: null },
    images: [{ src: 'https://x.test/a.webp' }], categories: [{ name: 'Point of Care' }, { name: 'Point of Care' }], tags: [],
    attributes: [], is_in_stock: false, is_on_backorder: false,
  });
  expect(mapped?.name === 'Strep – A & B', 'product: name entities decoded', mapped?.name);
  expect(mapped?.description === 'Overview\nRapid test kit.\n• Fast\n• Accurate', 'product: HTML description becomes readable text', mapped?.description);
  expect(mapped?.price === '1999.00' && mapped?.regularPrice === '2500.00', 'product: paise → rupees, sale keeps the old price', [mapped?.price, mapped?.regularPrice]);
  expect(mapped?.stockStatus === 'out_of_stock' && mapped?.sku === null, 'product: out of stock, empty SKU stored as none');
  expect(mapped?.categories.length === 1, 'product: repeated category names collapse');
  const variable = mapStoreProduct({ id: 8, name: 'Lyse', prices: { price: '100000', regular_price: '100000', currency_minor_unit: 2, price_range: { min_amount: '100000', max_amount: '300000' } }, attributes: [{ name: 'Size', has_variations: true, terms: [{ name: '200ml' }, { name: '1L' }] }], is_in_stock: true });
  expect(variable?.price === '1000.00' && /Size: 200ml, 1L/.test(variable?.description || '') && /lowest/.test(variable?.description || ''), 'product with options: lowest price + options listed', variable);
  expect(mapStoreProduct({ id: 9, name: 'Quote only', prices: { price: '' } })?.price === null, 'product: no price → "price on request"');

  // ── 2. Account with manual products ──
  const A = (await storage.createBusinessAccount({ name: `Accurex test ${rnd()}`, website: 'https://example.test' } as any)).id;
  await db.update(businessAccounts).set({ wooCommerceEnabled: 'true', openaiApiKey: 'sk-test-fake' }).where(eq(businessAccounts.id, A));
  await storage.upsertWidgetSettings(A, { currency: 'INR' });
  const hema = await storage.createCategory({ businessAccountId: A, name: 'Hematology' });
  const manualIds: string[] = [];
  for (const name of ['CBC 3D Hematology Control', 'Hematology Analyzer Lyse (LYA 3) 1L', 'Glucose strips manual']) {
    const [row] = await db.insert(products).values({ businessAccountId: A, name, description: `${name} description`, price: '8289', source: 'manual' }).returning({ id: products.id });
    manualIds.push(row.id);
  }
  await db.insert(productCategories).values({ productId: manualIds[0], categoryId: hema.id });
  await productTextEmbeddingService.backfillEmbeddingsForBusiness(A);
  expect(await getLiveProductSource(A) === 'catalog', 'before connecting, the chat uses the manual products');
  expect((await storage.getChatProducts(A)).length === 3, 'before connecting, 3 manual products in chat');

  // ── 3. Test + Connect (150 products = 2 pages) ──
  store.products = makeCatalog(150);
  const t = await testStore(site.base);
  expect(t.total === 150 && t.sample[0] === 'Accutest Strep A' && t.currency === 'INR', 'Test connection: count, sample names, currency', t);

  const failedConnect = await syncWooCommerce(A, 'connect', { storeUrl: `${site.base}/nothing-here` });
  expect(!failedConnect.ok && /no public WooCommerce product list/.test(failedConnect.error || ''), 'Connect to a non-WooCommerce address fails in plain words', failedConnect.error);
  expect(await getLiveProductSource(A) === 'catalog', 'a failed Connect leaves the chat on the manual products');

  const first = await syncWooCommerce(A, 'connect', { storeUrl: site.base });
  expect(first.ok && first.total === 150 && first.added === 150 && first.removed === 0, 'Connect: 150 products added over 2 pages', first);
  const settings1 = await storage.getWidgetSettings(A);
  expect(settings1?.wooConnected === 'true' && settings1?.wooStoreUrl === site.base && settings1?.wooSyncStatus === 'completed', 'Connect saves the address and marks connected');
  expect(await getLiveProductSource(A) === 'woocommerce', 'after Connect, the chat uses the website products');
  const chat1 = await storage.getChatProducts(A);
  expect(chat1.length === 150 && chat1.every(p => p.source === 'woocommerce'), 'chat product list = only the 150 website products', chat1.length);
  expect((await storage.getAllProducts(A)).length === 153, 'manual products are kept (153 in the catalog)');
  expect(!(await storage.getChatProduct(manualIds[0], A)), 'a manual product is not given to the chat while connected');
  const strep = chat1.find(p => p.name === 'Accutest Strep A')!;
  expect(strep && strep.price === '2500.00' && strep.isEditable === 'false' && strep.productUrl?.endsWith('/product/p-1000/') && strep.sku === null && strep.stockStatus === 'in_stock', 'website product fields saved', strep);
  const hemaCats = await db.select().from(categories).where(and(eq(categories.businessAccountId, A), eq(categories.name, 'Hematology')));
  expect(hemaCats.length === 1, 'existing "Hematology" category reused, not duplicated', hemaCats.length);
  const lyse = chat1.find(p => p.name.startsWith('Hematology Analyzer Lyse (LYC 1)'))!;
  const lyseCats = await storage.getProductCategories(lyse.id);
  expect(lyseCats.map(c => c.name).join() === 'System Reagents', 'website product gets its website category', lyseCats.map(c => c.name));

  // Search by meaning follows the switch (fingerprints are made in the background after a sync).
  for (let i = 0; i < 60; i++) {
    const [{ n }] = (await pool.query(`select count(*)::int as n from products where business_account_id = $1 and text_embedding is null`, [A])).rows;
    if (n === 0) break;
    await sleep(250);
  }
  const found = await productTextEmbeddingService.searchProducts('hematology analyzer lyse', A, 10, 0.1);
  expect(found.length > 0 && found.every(f => !manualIds.includes(f.id)), 'search by meaning returns only website products', found.map(f => f.name));
  expect(found.some(f => f.productUrl && f.stockStatus), 'search results carry the website link and stock');

  // ── 4. A later sync: changes, a new one, a removed one ──
  const callsBefore = openai.calls();
  const same = await syncWooCommerce(A, 'manual');
  expect(same.ok && same.unchanged === 150 && same.updated === 0 && same.added === 0, 'nothing changed on the website → nothing re-written', same);
  await sleep(300);
  expect(openai.calls() === callsBefore, 'no new search fingerprints when nothing changed');

  store.products[0] = { ...store.products[0], price: 2600, inStock: false };
  store.products[1] = { ...store.products[1], name: 'Hematology Analyzer Lyse (LYC 1) 250ml' };
  store.products[2] = { ...store.products[2], cats: ['Cardio Diabetic'] };
  store.products[3] = { ...store.products[3], sale: 2000 };
  store.products.splice(10, 1); // removed on the website
  store.products.push({ id: 5000, name: 'Brand new analyser', price: 99999, cats: ['Hematology'], options: ['Single', 'Pack of 5'] });
  const second = await syncWooCommerce(A, 'manual');
  expect(second.ok && second.added === 1 && second.updated === 4 && second.removed === 1 && second.total === 150, 'later sync: 1 added, 4 updated, 1 removed', second);
  const strep2 = await storage.getProduct(strep.id, A);
  expect(strep2?.price === '2600.00' && strep2?.stockStatus === 'out_of_stock', 'price and stock updated in place (same product)', strep2 && [strep2.price, strep2.stockStatus]);
  const lyse2 = await storage.getProduct(lyse.id, A);
  expect(lyse2?.name.endsWith('250ml') && lyse2?.textEmbedding === null, 'renamed product needs a new search fingerprint', lyse2?.name);
  const third = (await storage.getChatProducts(A)).find(p => p.externalId === String(store.products[2].id))!;
  expect((await storage.getProductCategories(third.id)).map(c => c.name).join() === 'Cardio Diabetic', 'category change on the website is followed');
  const onSale = (await storage.getChatProducts(A)).find(p => p.externalId === String(store.products[3].id))!;
  expect(onSale.price === '2000.00' && onSale.regularPrice === '2503.00', 'sale price + old price', [onSale.price, onSale.regularPrice]);
  expect(!(await storage.getChatProducts(A)).some(p => p.externalId === '1010'), 'product removed on the website is removed here');
  const fresh = (await storage.getChatProducts(A)).find(p => p.externalId === '5000');
  expect(fresh?.price === '99999.00' && /Pack size: Single, Pack of 5/.test(fresh?.description || ''), 'new product with options added', fresh?.description);
  expect((await storage.getAllProducts(A)).filter(p => p.source === 'manual').length === 3, 'manual products still untouched');

  // ── 5. Safety: nothing changes when the website looks wrong ──
  const countNow = (await storage.getChatProducts(A)).length;
  store.mode = 'empty';
  const empty = await syncWooCommerce(A, 'scheduled');
  expect(!empty.ok && /no products/.test(empty.error || ''), 'empty product list → failed, nothing changed', empty.error);
  store.mode = 'ok';
  const saved = store.products;
  store.products = saved.slice(0, 40);
  const shrunk = await syncWooCommerce(A, 'scheduled');
  expect(!shrunk.ok && /only 40 products/.test(shrunk.error || ''), 'a list less than half the size → failed, nothing changed', shrunk.error);
  store.products = saved;
  store.mode = 'error';
  const down = await syncWooCommerce(A, 'scheduled');
  expect(!down.ok && /error \(503\)/.test(down.error || ''), 'website error → plain message', down.error);
  store.mode = 'html';
  const blocked = await syncWooCommerce(A, 'scheduled');
  expect(!blocked.ok && /isn't a product list/.test(blocked.error || ''), 'a security page instead of products → plain message', blocked.error);
  store.mode = 'ok';
  store.currency = 'USD';
  const usd = await syncWooCommerce(A, 'scheduled');
  expect(!usd.ok && /USD instead of INR/.test(usd.error || ''), 'prices suddenly in another currency → nothing changed', usd.error);
  store.currency = 'INR';
  expect((await storage.getChatProducts(A)).length === countNow && await getLiveProductSource(A) === 'woocommerce', 'after failed syncs the chat keeps the last good website products');
  const st = await storage.getWidgetSettings(A);
  expect(st?.wooSyncStatus === 'failed' && (st?.wooLastResult as any)?.ok === false && !!st?.wooLastSyncedAt, 'failure saved for the page; last good sync time kept');

  // ── 6. One sync at a time ──
  const [r1, r2] = await Promise.all([syncWooCommerce(A, 'manual'), syncWooCommerce(A, 'manual')]);
  expect([r1, r2].filter(r => r.ok).length === 1 && [r1, r2].some(r => /already running/.test(r.error || '')), 'two syncs at once: the second is told to wait', [r1.error, r2.error]);

  // Redirects are followed (each hop checked).
  const moved = await syncWooCommerce(A, 'manual', { storeUrl: `${site.base}/old-shop` });
  expect(moved.ok, 'a website that redirects is followed', moved.error);

  // ── 7. Disconnect / feature off → manual products again; website products kept ──
  await disconnectWooCommerce(A);
  expect(await getLiveProductSource(A) === 'catalog', 'Disconnect: the chat is back on the manual products');
  const chat2 = await storage.getChatProducts(A);
  expect(chat2.length === 3 && chat2.every(p => p.source === 'manual'), 'Disconnect: chat list = the 3 manual products', chat2.length);
  expect((await storage.getAllProducts(A)).filter(p => p.source === 'woocommerce').length === 150, 'Disconnect: website products kept (greyed out)');
  const foundManual = await productTextEmbeddingService.searchProducts('hematology control', A, 10, 0.1);
  expect(foundManual.length > 0 && foundManual.every(f => manualIds.includes(f.id)), 'Disconnect: search by meaning returns manual products', foundManual.map(f => f.name));

  await syncWooCommerce(A, 'connect', { storeUrl: site.base });
  expect(await getLiveProductSource(A) === 'woocommerce', 'reconnect: website products live again');
  await db.update(businessAccounts).set({ wooCommerceEnabled: 'false' }).where(eq(businessAccounts.id, A));
  await onProductSourceChanged(A);
  expect(await getLiveProductSource(A) === 'catalog', 'feature switched off: the chat is back on the manual products');
  await db.update(businessAccounts).set({ wooCommerceEnabled: 'true' }).where(eq(businessAccounts.id, A));
  await onProductSourceChanged(A);

  // ── 8. The timer ──
  const B = (await storage.createBusinessAccount({ name: `Other ${rnd()}`, website: 'https://other.test' } as any)).id;
  await db.update(businessAccounts).set({ wooCommerceEnabled: 'true' }).where(eq(businessAccounts.id, B));
  await storage.upsertWidgetSettings(B, { wooStoreUrl: site.base, wooConnected: 'false' } as any); // not connected → never synced
  await db.update(widgetSettings).set({ wooSyncHours: 24, wooSyncStartedAt: new Date(Date.now() - 2 * 3600_000), wooSyncStatus: 'completed' }).where(eq(widgetSettings.businessAccountId, A));
  let before = store.requests;
  await wooCommerceSyncScheduler.tick();
  expect(store.requests === before, 'timer: synced 2 hours ago with a 24-hour timing → not due');
  await db.update(widgetSettings).set({ wooSyncHours: 1 }).where(eq(widgetSettings.businessAccountId, A));
  before = store.requests;
  await wooCommerceSyncScheduler.tick();
  const afterTick = await storage.getWidgetSettings(A);
  expect(store.requests > before && (afterTick?.wooLastResult as any)?.trigger === 'scheduled', 'timer: with a 1-hour timing the sync runs', (afterTick?.wooLastResult as any)?.trigger);
  expect((await db.select().from(products).where(eq(products.businessAccountId, B))).length === 0, 'timer: an account that is not connected is left alone');
  await db.update(widgetSettings).set({ wooSyncStatus: 'syncing', wooSyncStartedAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(widgetSettings.businessAccountId, A));
  before = store.requests;
  await wooCommerceSyncScheduler.tick();
  expect(store.requests > before, 'timer: a sync stuck for over an hour (e.g. a restart) is picked up again');

  // ── 9. Reading with the website's keys ──
  const rest = mapRestProduct({ id: 3, name: 'Kit &amp; more', status: 'publish', catalog_visibility: 'visible', type: 'simple', price: '1999', regular_price: '2500', on_sale: true, stock_status: 'onbackorder', short_description: '<p>Hi</p>', categories: [{ name: 'Hematology' }], images: [{ src: 'https://x.test/i.webp' }], permalink: 'https://x.test/p/3', sku: 'AB-1' });
  expect(rest?.name === 'Kit & more' && rest?.price === '1999.00' && rest?.regularPrice === '2500.00' && rest?.stockStatus === 'on_backorder' && rest?.sku === 'AB-1', 'keys: product fields read', rest);
  expect(mapRestProduct({ id: 4, name: 'Draft', status: 'draft' }) === null && mapRestProduct({ id: 5, name: 'Hidden', status: 'publish', catalog_visibility: 'hidden' }) === null, 'keys: drafts and hidden products skipped');
  const restVar = mapRestProduct({ id: 6, name: 'Lyse', status: 'publish', type: 'variable', price: '1000', regular_price: '', attributes: [{ name: 'Size', variation: true, options: ['200ml', '1L'] }, { name: 'Brand', variation: false, options: ['X'] }] });
  expect(restVar?.price === '1000.00' && /Size: 200ml, 1L/.test(restVar?.description || '') && !/Brand/.test(restVar?.description || ''), 'keys: product with options', restVar?.description);

  store.products.push({ id: 7000, name: 'Draft on website', price: 1, cats: ['Hematology'], draft: true }, { id: 7001, name: 'Hidden on website', price: 1, cats: ['Hematology'], hidden: true });
  let wrongKeys = '';
  try { await testStore(site.base, { key: 'ck_wrong', secret: 'cs_wrong' }); } catch (e: any) { wrongKeys = e.message; }
  expect(/didn't accept the keys/.test(wrongKeys), 'keys: wrong keys → plain message', wrongKeys);
  const tk = await testStore(site.base, { key: TEST_KEY, secret: TEST_SECRET });
  expect(tk.total === 151 && tk.currency === 'INR', 'keys: Test connection counts published products and reads the currency', tk);

  const productCountBefore = (await storage.getAllProducts(A)).filter(p => p.source === 'woocommerce').length;
  const badConnect = await syncWooCommerce(A, 'connect', { storeUrl: site.base, readMode: 'keys', keys: { key: 'ck_wrong', secret: 'cs_wrong' } });
  const afterBad = await storage.getWidgetSettings(A);
  expect(!badConnect.ok && afterBad?.wooReadMode === 'public' && !afterBad?.wooConsumerKey && afterBad?.wooConnected === 'true', 'keys: a failed Connect saves nothing and keeps the current connection', [badConnect.error, afterBad?.wooReadMode]);

  store.keyedVia = [];
  const keyed = await syncWooCommerce(A, 'connect', { storeUrl: site.base, readMode: 'keys', keys: { key: TEST_KEY, secret: TEST_SECRET } });
  expect(keyed.ok && keyed.added === 0 && keyed.removed === 0 && keyed.total === 150, 'keys: switching to keys keeps the same products (no adds/removes, draft + hidden skipped)', keyed);
  expect((await storage.getAllProducts(A)).filter(p => p.source === 'woocommerce').length === productCountBefore, 'keys: same number of website products');
  expect(store.keyedVia.every(v => v === 'header'), 'keys: sent as a login header, not in the address', store.keyedVia);
  const afterKeys = await storage.getWidgetSettings(A);
  expect(afterKeys?.wooReadMode === 'keys' && afterKeys?.wooConsumerKey && afterKeys.wooConsumerKey !== TEST_KEY && !afterKeys.wooConsumerSecret?.includes(TEST_SECRET), 'keys: saved encrypted, not as typed');
  expect(decrypt(afterKeys!.wooConsumerKey!) === TEST_KEY && decrypt(afterKeys!.wooConsumerSecret!) === TEST_SECRET, 'keys: saved keys decrypt back');
  const keyedLater = await syncWooCommerce(A, 'manual');
  expect(keyedLater.ok && keyedLater.unchanged === 150, 'keys: later syncs use the saved keys', keyedLater);

  store.stripAuthHeader = true;
  store.keyedVia = [];
  const stripped = await syncWooCommerce(A, 'manual');
  expect(stripped.ok && store.keyedVia.includes('query'), 'keys: a server that drops the login header still works (keys as parameters)', [stripped.error, store.keyedVia]);
  store.stripAuthHeader = false;

  const moved2 = await syncWooCommerce(A, 'manual', { storeUrl: `${site.base}/elsewhere` });
  expect(!moved2.ok && /moved to http:\/\/localhost/.test(moved2.error || ''), 'keys: never sent after a redirect to another website', moved2.error);

  const backPublic = await syncWooCommerce(A, 'connect', { storeUrl: site.base, readMode: 'public' });
  const afterPublic = await storage.getWidgetSettings(A);
  expect(backPublic.ok && backPublic.added === 0 && afterPublic?.wooReadMode === 'public' && !afterPublic?.wooConsumerKey && !afterPublic?.wooConsumerSecret, 'back to the website link only: same products, saved keys forgotten', backPublic);

  site.close();
  openai.close();
  await pool.end().catch(() => {});
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll WooCommerce sync checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
