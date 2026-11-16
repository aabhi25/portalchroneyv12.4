/**
 * Website scan (Training › Website scan), end to end against a local Postgres/PGlite, a stand-in website and
 * a fake OpenAI:
 *
 *  - page list: pages from the sitemap + homepage links; about / contact / FAQ / shipping / returns / stores
 *    ticked, at most 3 of a kind; products, collections, filtered copies, blog posts, thank-you pages and
 *    product sitemaps left out; "terms-of-service" is a policy, "/jobs/…" careers; Shopify policies added;
 *    a re-scan keeps earlier pages ticked except old product / filtered ones;
 *  - exact facts: phone / email links, the business details and FAQs published for Google, <details>
 *    questions in the page body (not in menus);
 *  - scan of the chosen pages: exact phone / email / address / hours replace the AI's, FAQ answers kept word
 *    for word, pages not chosen removed, a re-scan replaces pages (no copies), a page that fails keeps its
 *    last good copy; old duplicate pages are cleaned by migration 0066.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55581/postgres?sslmode=disable \
 *   WEBSITE_SCAN_TEST_DB=1 npx tsx server/services/__tests__/websiteScan.integration.test.ts
 */
process.env.TZ = 'UTC';
import crypto from 'crypto';
import fs from 'fs';
import http from 'node:http';
import path from 'path';
import type { AddressInfo } from 'node:net';

const url = process.env.DATABASE_URL || '';
if (process.env.WEBSITE_SCAN_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set WEBSITE_SCAN_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString('hex');
process.env.WOO_ALLOW_LOCAL_STORE = '1';

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 700)}` : ''}`); }
  else console.log(`✓ ${label}`);
}

// ── Fake OpenAI: the business summary (JSON) and per-page bullet points ──
let chatCalls = 0;
function startFakeOpenAI(): Promise<{ baseUrl: string; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body || '{}');
        chatCalls++;
        const json = j.response_format?.type === 'json_object';
        const content = json
          ? JSON.stringify({
            businessName: { value: 'Sparkle Jewels', evidence: 'Sparkle Jewels', confidence: 'high' },
            businessDescription: { value: 'Silver jewellery shop', evidence: 'Silver jewellery', confidence: 'high' },
            // A phone the AI misread: the exact one from the website replaces it.
            contactInfo: { phone: { value: '98765 00000', evidence: 'Call us', confidence: 'medium' } },
          })
          : '- Sells silver jewellery';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'x', object: 'chat.completion', created: 1, model: j.model,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() }));
  });
}

// ── Stand-in website ──
const site = { contactDown: false };
const filler = 'We make handcrafted 925 silver jewellery in Jaipur and ship across India. '.repeat(8);
function page(title: string, body: string, head = '') {
  return `<html><head><title>${title}</title>${head}<link href="//cdn.shopify.com/x.css"></head><body>
    <header><nav><details><summary>Shop</summary><a href="/collections/rings">Rings</a></details></nav></header>
    <main><h1>${title}</h1>${body}<p>${filler}</p></main>
    <footer><a href="/pages/contact-us">Contact</a> <a href="mailto:care@sparkle.test">Email us</a></footer></body></html>`;
}
function startSite(): Promise<{ base: string; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const u = new URL(req.url || '/', base);
      const send = (status: number, text: string, type = 'text/html') => { res.writeHead(status, { 'content-type': type }); res.end(text); };
      const p = u.pathname;
      if (p === '/robots.txt') return send(200, `Sitemap: ${base}/sitemap.xml\n`, 'text/plain');
      if (p === '/sitemap.xml') {
        return send(200, `<sitemapindex><sitemap><loc>${base}/sitemap_pages_1.xml</loc></sitemap><sitemap><loc>${base}/sitemap_products_1.xml</loc></sitemap></sitemapindex>`, 'application/xml');
      }
      if (p === '/sitemap_products_1.xml') return send(500, 'should not be opened', 'text/plain');
      if (p === '/sitemap_pages_1.xml') {
        const pages = ['pages/about-us', 'pages/contact-us', 'pages/faq', 'pages/shipping-and-handling', 'pages/terms-of-service',
          'pages/store-locator', 'pages/store-locator/jaipur', 'pages/store-locator/delhi', 'pages/store-locator/pune',
          'pages/thank-you', 'jobs/service-engineer', 'pages/all-about-silver-care-and-cleaning-tips', 'pages/diwali-sale'];
        return send(200, `<urlset>${pages.map(x => `<url><loc>${base}/${x}</loc></url>`).join('')}</urlset>`, 'application/xml');
      }
      if (p === '/') {
        return send(200, page('Sparkle Jewels', `<a href="/collections/rings?filter.v.price.gte=1500">Under 1500</a>
          <a href="/products/silver-ring-12345">Ring</a> <a href="/blogs/news/new-arrivals">Blog</a>
          <a href="tel:+91-98765-43210">Call us</a> <a href="/pages/about-us/">About</a>`,
          `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JewelryStore', name: 'Sparkle Jewels',
            telephone: '+91 98765 43210', email: 'hello@example.com',
            address: { '@type': 'PostalAddress', streetAddress: '12 MI Road', addressLocality: 'Jaipur', postalCode: '302001', addressCountry: 'IN' },
            openingHoursSpecification: [{ dayOfWeek: ['https://schema.org/Monday', 'https://schema.org/Saturday'], opens: '10:00:00', closes: '20:00:00' }] })}</script>`));
      }
      if (p === '/pages/faq') {
        return send(200, page('FAQ', `<details><summary>Is the silver hallmarked?</summary><p>Yes, every piece is BIS hallmarked 925 silver.</p></details>
          <details><summary>Do you ship abroad?</summary><p>We ship to 20 countries within 7 to 10 days.</p></details>`));
      }
      if (p === '/pages/shipping-and-handling') {
        return send(200, page('Shipping', '<p>Free shipping over Rs 999.</p>', `<script type="application/ld+json">${JSON.stringify({ '@type': 'FAQPage', mainEntity: [
          { '@type': 'Question', name: 'How long does delivery take?', acceptedAnswer: { '@type': 'Answer', text: '<p>3&ndash;5 working days in metro cities.</p>' } }] })}</script>`));
      }
      if (p === '/pages/contact-us' && site.contactDown) return send(503, 'busy', 'text/plain');
      if (p.startsWith('/pages/') || p.startsWith('/policies/')) return send(200, page(p.split('/').pop() || 'Page', '<p>Details here.</p>'));
      send(404, 'not found', 'text/plain');
    });
    server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() }));
  });
}

async function waitFor(fn: () => Promise<boolean>, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); }
  return false;
}

async function main() {
  const openai = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = openai.baseUrl;
  const web = await startSite();

  const { db, pool } = await import('../../db');
  const { storage } = await import('../../storage');
  const { eq } = await import('drizzle-orm');
  const { analyzedPages } = await import('@shared/schema');
  const { discoverInfoPages, extractSiteFacts, pageKey } = await import('../websitePages');
  const { websiteAnalysisService } = await import('../../websiteAnalysisService');

  // ── 1. Page list ──
  const found = await discoverInfoPages(`${web.base}/?utm_source=google`);
  const picked = found.pages.filter(p => p.picked).map(p => p.url.replace(web.base, '') || '/');
  const all = found.pages.map(p => p.url.replace(web.base, '') || '/');
  expect(found.source === 'sitemap', 'pages come from the sitemap', found.source);
  for (const want of ['/', '/pages/about-us', '/pages/contact-us', '/pages/faq', '/pages/shipping-and-handling', '/policies/refund-policy']) {
    expect(picked.includes(want), `ticked: ${want}`, picked);
  }
  expect(picked.filter(p => p.startsWith('/pages/store-locator')).length === 3, 'at most 3 store pages ticked', picked);
  expect(!all.some(p => /products|collections|blogs|thank-you|\?/.test(p)), 'products, collections, filtered copies, blog posts and thank-you pages left out', all);
  expect(found.leftOut.products >= 1 && found.leftOut.collections >= 1 && found.leftOut.blog >= 1, 'left-out counts reported', found.leftOut);
  expect(found.leftOut.sitemaps.includes('sitemap_products'), 'product sitemap named, not opened', found.leftOut.sitemaps);
  const kindOf = (p: string) => found.pages.find(x => x.url === `${web.base}${p}`);
  expect(kindOf('/pages/terms-of-service')?.kind === 'policy', '"terms-of-service" is a policy page, not services', kindOf('/pages/terms-of-service'));
  expect(kindOf('/jobs/service-engineer')?.kind === 'careers' && !kindOf('/jobs/service-engineer')?.picked, '"/jobs/…" is careers, not ticked');
  expect(kindOf('/pages/all-about-silver-care-and-cleaning-tips')?.kind === 'other', 'a long article address with "about"/"care" in it is just a page');
  expect(found.pages.filter(p => p.url === `${web.base}/pages/about-us`).length === 1, 'the same page with a trailing slash is listed once');

  const again = await discoverInfoPages(web.base, [`${web.base}/pages/diwali-sale`, `${web.base}/collections/rings?filter.v.price.gte=1500`]);
  const sale = again.pages.find(p => p.url.endsWith('/pages/diwali-sale'));
  const junk = again.pages.find(p => p.url.includes('/collections/rings'));
  expect(sale?.picked && sale.alreadyRead, 're-scan: a page read before stays ticked', sale);
  expect(junk && !junk.picked && junk.alreadyRead, 're-scan: an old filtered collection page is listed but not ticked', junk);
  const fewGood = again.pages.filter(p => p.picked).map(p => p.url.replace(web.base, '') || '/');
  expect(fewGood.includes('/pages/about-us') && fewGood.includes('/pages/faq'), 're-scan after an old scan with few useful pages: suggestions added', fewGood);
  const goodEarlier = found.pages.filter(p => p.picked && !p.url.endsWith('/pages/contact-us')).map(p => p.url);
  const third = await discoverInfoPages(web.base, goodEarlier);
  const contact = third.pages.find(p => p.url.endsWith('/pages/contact-us'));
  expect(contact && !contact.picked && third.pages.filter(p => p.picked).length === goodEarlier.length, 're-scan keeps the earlier choice: a page unticked last time stays unticked', contact);

  // ── 2. Exact facts ──
  const home = await (await fetch(web.base)).text();
  const f = extractSiteFacts(home);
  expect(f.phones.includes('+91 98765 43210') && f.phones.includes('+91-98765-43210'), 'phone from the published details and the tel: link', f.phones);
  expect(f.emails.includes('care@sparkle.test') && !f.emails.some(e => e.includes('example.com')), 'email from the mailto: link; placeholder example.com skipped', f.emails);
  expect(f.address === '12 MI Road, Jaipur, 302001, IN', 'address from the published details', f.address);
  expect(f.hours === 'Monday, Saturday: 10:00–20:00', 'opening hours in words', f.hours);
  expect(f.faqs.length === 0, 'the <details> in the menu is not a question', f.faqs);
  const faqPage = extractSiteFacts(await (await fetch(`${web.base}/pages/faq`)).text());
  expect(faqPage.faqs.length === 2 && faqPage.faqs[0].q === 'Is the silver hallmarked?' && /BIS hallmarked/.test(faqPage.faqs[0].a), '<details> questions in the page body read word for word', faqPage.faqs);
  const shipFacts = extractSiteFacts(await (await fetch(`${web.base}/pages/shipping-and-handling`)).text());
  expect(shipFacts.faqs[0]?.a === '3–5 working days in metro cities.', 'published FAQ answers (FAQPage) read word for word', shipFacts.faqs);

  // ── 3. Scan of the chosen pages ──
  const A = (await storage.createBusinessAccount({ name: `Scan test ${crypto.randomBytes(3).toString('hex')}`, website: web.base } as any)).id;
  // Duplicates left by the old scanner: cleaned by migration 0066.
  for (const u of [`${web.base}/pages/old`, `${web.base}/pages/old/`, `${web.base}/pages/old`]) {
    await db.insert(analyzedPages).values({ businessAccountId: A, pageUrl: u, extractedContent: 'old copy' });
    await new Promise(r => setTimeout(r, 5));
  }
  const sql = fs.readFileSync(path.join(process.cwd(), 'migrations/0066_dedupe_analyzed_pages.sql'), 'utf8');
  await pool.query(sql);
  const afterDedupe = await db.select().from(analyzedPages).where(eq(analyzedPages.businessAccountId, A));
  expect(afterDedupe.length === 1, 'migration 0066: 3 copies of one page → 1 (newest kept)', afterDedupe.length);

  const chosen = [web.base, `${web.base}/pages/contact-us`, `${web.base}/pages/faq`, `${web.base}/pages/shipping-and-handling`, `${web.base}/missing-page`];
  await websiteAnalysisService.scanChosenPages(web.base, chosen, A, 'sk-test-fake');
  const analysis = await storage.getWebsiteAnalysis(A);
  const content = JSON.parse(analysis?.analyzedContent || '{}');
  expect(analysis?.status === 'completed', 'scan completed', analysis?.status);
  expect(content.contactInfo?.phone?.startsWith('+91 98765 43210') && content.contactInfo?.email === 'care@sparkle.test', 'exact phone / email replace what the AI read', content.contactInfo);
  expect(content.contactInfo?.address === '12 MI Road, Jaipur, 302001, IN' && content.businessHours === 'Monday, Saturday: 10:00–20:00', 'exact address and hours saved', [content.contactInfo?.address, content.businessHours]);
  expect(['phone', 'email', 'address', 'businessHours'].every(k => content.exactFromWebsite?.includes(k)), 'fields marked "exact from website"', content.exactFromWebsite);
  let pages = await storage.getAnalyzedPages(A);
  const keys = pages.map(p => pageKey(p.pageUrl)).sort();
  expect(pages.length === 4 && !keys.some(k => k.endsWith('/pages/old')) && !keys.some(k => k.endsWith('missing-page')), 'saved: the 4 pages read; old unchosen page removed; a missing page not saved', keys);
  const faqSaved = pages.find(p => p.pageUrl.endsWith('/pages/faq'));
  expect(/exact wording[\s\S]*Q: Is the silver hallmarked\?\nA: Yes, every piece is BIS hallmarked 925 silver\./.test(faqSaved?.extractedContent || ''), 'FAQ page keeps its questions and answers word for word', faqSaved?.extractedContent);
  const shipSaved = pages.find(p => p.pageUrl.endsWith('/pages/shipping-and-handling'));
  expect(/A: 3–5 working days in metro cities\./.test(shipSaved?.extractedContent || ''), 'published FAQ answer kept word for word on its page', shipSaved?.extractedContent);

  // Re-scan with the contact page down: no copies, the contact page keeps its last good copy.
  await db.update(analyzedPages).set({ channels: ['whatsapp'] }).where(eq(analyzedPages.id, faqSaved!.id));
  site.contactDown = true;
  await websiteAnalysisService.scanChosenPages(web.base, chosen, A, 'sk-test-fake');
  pages = await storage.getAnalyzedPages(A);
  expect(pages.length === 4, 're-scan: still 4 pages, no copies', pages.map(p => p.pageUrl));
  const contactKept = pages.find(p => p.pageUrl.endsWith('/pages/contact-us'));
  expect(!!contactKept?.extractedContent && contactKept.extractedContent.includes('silver'), 'page that failed to load keeps its last good copy', contactKept);
  expect(JSON.stringify(pages.find(p => p.pageUrl.endsWith('/pages/faq'))?.channels) === '["whatsapp"]', 're-scan keeps a page\'s channel tags');

  // Fewer pages chosen: the rest are removed.
  site.contactDown = false;
  await websiteAnalysisService.scanChosenPages(web.base, [web.base, `${web.base}/pages/faq`], A, 'sk-test-fake');
  pages = await storage.getAnalyzedPages(A);
  expect(pages.length === 2, 'unticked pages are removed on the next scan', pages.map(p => p.pageUrl));

  // "Add page" path: a page added twice is saved once.
  await storage.createAnalyzedPage({ businessAccountId: A, pageUrl: `${web.base}/pages/faq/`, extractedContent: 'newer' });
  pages = await storage.getAnalyzedPages(A);
  expect(pages.length === 2 && pages.some(p => p.extractedContent === 'newer'), 'saving a page again (with a trailing slash) replaces it', pages.map(p => [p.pageUrl, p.extractedContent]));

  await waitFor(async () => true, 10);
  web.close();
  openai.close();
  await pool.end().catch(() => {});
  if (failed) {
    console.error(`\n${failed} website scan checks failed`);
    process.exit(1);
  }
  console.log(`\nAll website scan checks passed (${chatCalls} AI calls)`);
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
