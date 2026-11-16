/**
 * Chat product search (get_products → productHybridSearch.ts), against a local Postgres/PGlite and a fake
 * OpenAI (bag-of-words fingerprints, a fixed question reader):
 *
 *  - keyword: a product name word finds it; "earrings" and "earring" match the same products;
 *  - product type: "earrings" returns only earrings (never rings, though "ring" is inside "earring"), and
 *    rings only rings;
 *  - price filters inside the search; out-of-stock products below in-stock ones;
 *  - meaning: a description's wording finds a product the name doesn't mention; an unrelated question
 *    returns nothing (no "closest" jewellery);
 *  - the chat tool end to end (question reader → ranked list → categories/tags attached, 5 per page);
 *  - fingerprints carry type and tags; older ones are remade by the refresh.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55581/postgres?sslmode=disable \
 *   PRODUCT_SEARCH_TEST_DB=1 npx tsx server/services/__tests__/productHybridSearch.integration.test.ts
 */
process.env.TZ = 'UTC';
import crypto from 'crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const url = process.env.DATABASE_URL || '';
if (process.env.PRODUCT_SEARCH_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set PRODUCT_SEARCH_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString('hex');
process.env.OPENAI_API_KEY = 'sk-test-fake';

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 700)}` : ''}`); }
  else console.log(`✓ ${label}`);
}

// Bag-of-words fingerprints: texts sharing words score close, unrelated texts score ~0.
const STOP = new Set('a an the for of and with in to is it this that do you have me show some any your my'.split(' '));
function fakeVector(text: string): Float32Array {
  const v = new Float32Array(1536);
  for (const w of text.toLowerCase().match(/[a-z]+/g) || []) {
    if (STOP.has(w)) continue;
    const h = crypto.createHash('md5').update(w.replace(/s$/, '')).digest();
    v[h.readUInt16BE(0) % 1536] += 1;
  }
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
const embedded: string[] = [];
function startFakeOpenAI(): Promise<{ baseUrl: string; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body || '{}');
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url?.endsWith('/embeddings')) {
          const inputs: string[] = Array.isArray(j.input) ? j.input : [j.input];
          embedded.push(...inputs);
          const data = inputs.map((t, index) => {
            const v = fakeVector(String(t));
            return { object: 'embedding', index, embedding: j.encoding_format === 'base64' ? Buffer.from(v.buffer).toString('base64') : Array.from(v) };
          });
          return res.end(JSON.stringify({ object: 'list', data, model: 'text-embedding-3-small', usage: { prompt_tokens: 5, total_tokens: 5 } }));
        }
        // The question reader: product type + price from the question.
        const q = String(j.messages?.[1]?.content ?? '').toLowerCase();
        const parsed: any = {};
        if (/earring/.test(q)) parsed.productType = 'earrings';
        else if (/\brings?\b/.test(q)) parsed.productType = 'rings';
        const under = q.match(/under (\d+)/);
        if (under) parsed.maxPrice = Number(under[1]);
        res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 1, model: j.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(parsed) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() }));
  });
}

async function main() {
  const openai = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = openai.baseUrl;
  const { db, pool } = await import('../../db');
  const { storage } = await import('../../storage');
  const { eq, sql } = await import('drizzle-orm');
  const { businessAccounts, products, productCategories, productTags } = await import('@shared/schema');
  const { hybridProductSearch, keywordExpression } = await import('../productHybridSearch');
  const { productTextEmbeddingService, EMBEDDING_TEXT_SINCE } = await import('../productTextEmbeddingService');
  const { ToolExecutionService } = await import('../toolExecutionService');

  const A = (await storage.createBusinessAccount({ name: `Search test ${crypto.randomBytes(3).toString('hex')}`, website: 'https://example.test' } as any)).id;
  await db.update(businessAccounts).set({ openaiApiKey: 'sk-test-fake' }).where(eq(businessAccounts.id, A));
  const earrings = await storage.createCategory({ businessAccountId: A, name: 'Earrings' });
  const rings = await storage.createCategory({ businessAccountId: A, name: 'Rings' });
  const office = await storage.createTag({ businessAccountId: A, name: 'Office wear' });
  const items: { name: string; price: string; cat: string; desc: string; stock?: string; tag?: boolean }[] = [
    { name: 'Silver Posy Earrings', price: '1099', cat: earrings.id, desc: 'Flower studs in 925 silver.' },
    { name: 'Silver Aurora Edge Earrings', price: '1299', cat: earrings.id, desc: 'Geometric drops that catch the light.' },
    { name: 'Golden Relic Earrings', price: '2499', cat: earrings.id, desc: 'Gold plated hoops for weddings.' },
    { name: 'Rose Hoop Earrings', price: '999', cat: earrings.id, desc: 'Minimal hoops for daily office wear.', tag: true },
    { name: 'Silver Bow Ring', price: '2399', cat: rings.id, desc: 'Adjustable ring with a bow.' },
    { name: 'Golden Band Ring', price: '1999', cat: rings.id, desc: 'Plain gold plated band.' },
    { name: 'Silver Twin Earrings', price: '1099', cat: earrings.id, desc: 'Flower studs in 925 silver.', stock: 'out_of_stock' },
  ];
  const ids: Record<string, string> = {};
  for (const it of items) {
    const [row] = await db.insert(products).values({ businessAccountId: A, name: it.name, description: it.desc, price: it.price, source: 'manual', stockStatus: it.stock ?? 'in_stock' }).returning({ id: products.id });
    ids[it.name] = row.id;
    await db.insert(productCategories).values({ productId: row.id, categoryId: it.cat });
    if (it.tag) await db.insert(productTags).values({ productId: row.id, tagId: office.id });
  }
  await productTextEmbeddingService.backfillEmbeddingsForBusiness(A);

  // ── Fingerprint text ──
  const rose = embedded.find(t => t.startsWith('Rose Hoop Earrings'));
  expect(rose && /Type: Earrings\./.test(rose) && /Tags: Office wear\./.test(rose), 'fingerprint text carries type and tags', rose);
  const [tsv] = (await db.execute(sql`SELECT search_tsv::text AS t FROM products WHERE id = ${ids['Silver Posy Earrings']}`)).rows as any[];
  expect(/'posi'|'posy'/.test(tsv?.t ?? '') && /'earring'/.test(tsv?.t ?? ''), 'keyword column filled by the database (word forms)', tsv);

  const names = (hits: { name: string }[]) => hits.map(h => h.name);
  // ── Keyword ──
  expect(keywordExpression('silver earrings under 2000') === 'silver | earrings', 'question words: numbers and price words dropped', keywordExpression('silver earrings under 2000'));
  const posy = await hybridProductSearch(A, { query: 'posy' });
  expect(posy[0]?.name === 'Silver Posy Earrings' && posy[0].via.includes('keyword'), 'a name word finds the product first (keyword)', posy.map(h => [h.name, h.via]));
  const one = await hybridProductSearch(A, { query: 'earring' });
  const many = await hybridProductSearch(A, { query: 'earrings' });
  expect(one.length === 5 && many.length === 5, '"earring" and "earrings" find the same 5', [names(one), names(many)]);

  // ── Product type ──
  const ear = await hybridProductSearch(A, { query: 'do you have earrings', productType: 'earrings' });
  expect(ear.length === 5 && ear.every(h => /Earrings/.test(h.name)), 'type earrings: only the 5 earrings', names(ear));
  expect(ear[ear.length - 1]?.name === 'Silver Twin Earrings', 'out-of-stock earrings last', names(ear));
  const rng = await hybridProductSearch(A, { query: 'show me rings', productType: 'rings' });
  expect(rng.length === 2 && rng.every(h => /Ring$/.test(h.name)), 'type rings: only the 2 rings (not earrings)', names(rng));

  // ── Price inside the search ──
  const cheap = await hybridProductSearch(A, { query: 'earrings', productType: 'earrings', maxPrice: 1200 });
  expect(cheap.length === 3 && cheap.every(h => Number(h.price) <= 1200), 'earrings under 1200: 3, all within price', cheap.map(h => [h.name, h.price]));

  // ── Meaning ──
  const officeQ = await hybridProductSearch(A, { query: 'something minimal for office' });
  expect(officeQ[0]?.name === 'Rose Hoop Earrings', 'description wording finds the product (meaning + keyword)', officeQ.map(h => [h.name, h.via]));
  const cars = await hybridProductSearch(A, { query: 'do you sell cars' });
  expect(cars.length === 0, 'unrelated question: nothing (no closest jewellery)', names(cars));

  // ── Chat tool end to end ──
  const tool = await ToolExecutionService.executeTool('get_products', { search: 'earrings under 1300' }, { businessAccountId: A, userId: 'test', userMessage: 'earrings under 1300' } as any);
  const data = (tool as any).data as any[];
  expect(tool.success && data.length === 4 && data.every(p => p.categories?.[0]?.name === 'Earrings' && Number(p.price) <= 1300) && data[3]?.name === 'Silver Twin Earrings', 'chat tool: earrings under 1300 → 4 (out of stock last), each with its category', data?.map(p => [p.name, p.price, p.categories]));
  const roseHit = (await ToolExecutionService.executeTool('get_products', { search: 'office earrings' }, { businessAccountId: A, userId: 'test', userMessage: 'office earrings' } as any) as any).data?.find((p: any) => p.name === 'Rose Hoop Earrings');
  expect(roseHit?.tags?.[0]?.name === 'Office wear', 'chat tool: tags attached', roseHit?.tags);

  // ── Refresh of older fingerprints ──
  await db.update(products).set({ textEmbeddingGeneratedAt: new Date('2026-01-01') }).where(eq(products.id, ids['Golden Band Ring']));
  embedded.length = 0;
  const refreshed = await productTextEmbeddingService.refreshOutdatedEmbeddings(50, [A]);
  const [band] = await db.select({ at: products.textEmbeddingGeneratedAt }).from(products).where(eq(products.id, ids['Golden Band Ring']));
  expect(refreshed === 1 && band.at && band.at > EMBEDDING_TEXT_SINCE, 'only the older fingerprint is remade', { refreshed, at: band?.at });

  openai.close();
  await new Promise(r => setTimeout(r, 300));
  await pool.end().catch(() => {});
  if (failed) { console.error(`\n${failed} product search checks failed`); process.exit(1); }
  console.log('\nAll product search checks passed');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
