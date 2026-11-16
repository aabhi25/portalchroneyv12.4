/**
 * FAQs › "Add from website", against a stand-in website and a fake OpenAI (and a local Postgres/PGlite for
 * the AI usage log):
 *
 *  - pages to read: FAQ / returns / shipping / warranty / contact pages ticked, a few of each; homepage and
 *    careers not listed;
 *  - suggestions: questions the page lists are copied word for word; pages without a question list get
 *    AI-written ones (marked, with their page); a JavaScript-only page is reported; a suggestion that repeats
 *    an existing FAQ is marked; the same question from the website and the AI is shown once, in the
 *    website's words; without an AI key only the website's own questions are read.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55581/postgres?sslmode=disable \
 *   WEBSITE_FAQS_TEST_DB=1 npx tsx server/services/__tests__/websiteFaqs.integration.test.ts
 */
import crypto from 'crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const url = process.env.DATABASE_URL || '';
if (process.env.WEBSITE_FAQS_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set WEBSITE_FAQS_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
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

const aiPrompts: string[] = [];
function startFakeOpenAI(): Promise<{ baseUrl: string; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body || '{}');
        const userText = String(j.messages?.[1]?.content ?? '');
        aiPrompts.push(userText);
        const faqs = /refund-policy/.test(userText)
          ? [
            { question: 'How many days do I have to return an item?', answer: 'You can return items within 30 days of delivery.', category: 'Returns & exchanges' },
            { question: 'Is the silver hallmarked?', answer: 'Yes, it is hallmarked.', category: 'Products' }, // also on the FAQ page
            { question: 'What is your return policy?', answer: 'Returns within 30 days.', category: 'Made-up category' }, // repeats an existing FAQ
          ]
          : [{ question: 'Do you ship on Sundays?', answer: 'No, orders ship Monday to Saturday.', category: 'Shipping & delivery' }];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'x', object: 'chat.completion', created: 1, model: j.model,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ faqs }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() }));
  });
}

const filler = '<p>' + 'Orders are packed in Jaipur and handed to our courier partners within 24 hours of payment. '.repeat(6) + '</p>';
function startSite(): Promise<{ base: string; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const p = new URL(req.url || '/', base).pathname;
      const send = (status: number, text: string, type = 'text/html') => { res.writeHead(status, { 'content-type': type }); res.end(text); };
      if (p === '/robots.txt') return send(200, `Sitemap: ${base}/sitemap.xml`, 'text/plain');
      if (p === '/sitemap.xml') {
        const pages = ['pages/faq', 'pages/help-center', 'policies/refund-policy', 'pages/shipping', 'pages/contact-us', 'pages/careers', 'pages/app-faq'];
        return send(200, `<urlset>${pages.map(x => `<url><loc>${base}/${x}</loc></url>`).join('')}</urlset>`, 'application/xml');
      }
      if (p === '/') return send(200, '<html><body><a href="/pages/about-us">About</a></body></html>');
      if (p === '/pages/faq') {
        return send(200, `<html><body><header><details><summary>Menu</summary><a href="/">Home</a></details></header><main>
          <details><summary>Is the silver hallmarked?</summary><p>Yes, every piece is BIS hallmarked 925 silver.</p></details>
          <details><summary>Do you offer gift wrapping?</summary><p>Yes, free gift wrapping on every order.</p></details>
          <details><summary>Can I pay cash on delivery?</summary><p>Yes, COD is available up to Rs 10,000.</p></details>
        </main></body></html>`);
      }
      if (p === '/pages/app-faq') return send(200, '<html><body><div id="root"></div><script src="/app.js"></script></body></html>');
      return send(200, `<html><body><main><h1>${p}</h1>${filler}</main></body></html>`);
    });
    server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() }));
  });
}

async function main() {
  const openai = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = openai.baseUrl;
  const web = await startSite();
  const { pool } = await import('../../db');
  const { storage } = await import('../../storage');
  const { discoverInfoPages } = await import('../websitePages');
  const { pickFaqPages, sameQuestion, suggestFaqsFromPages } = await import('../websiteFaqs');

  // ── Pages to read ──
  const pages = pickFaqPages(await discoverInfoPages(web.base));
  const picked = pages.filter(p => p.picked).map(p => p.url.replace(web.base, ''));
  for (const want of ['/pages/faq', '/pages/help-center', '/policies/refund-policy', '/pages/shipping', '/pages/contact-us']) {
    expect(picked.includes(want), `ticked for FAQs: ${want}`, picked);
  }
  expect(!pages.some(p => p.kind === 'home' || p.kind === 'careers'), 'homepage and careers not listed', pages.map(p => p.url));
  expect(pages[0]?.kind === 'faq', 'question pages listed first', pages[0]);

  // ── Same question ──
  expect(sameQuestion("What is GIVA's return policy?", 'What is your return policy?'), 'same question in other words is a repeat');
  expect(!sameQuestion('What is your return policy?', 'How long does shipping take?'), 'different questions are not repeats');

  // ── Suggestions ──
  const A = (await storage.createBusinessAccount({ name: `FAQ test ${crypto.randomBytes(3).toString('hex')}`, website: web.base } as any)).id;
  const chosen = ['/pages/faq', '/policies/refund-policy', '/pages/shipping', '/pages/app-faq'].map(p => `${web.base}${p}`);
  const r = await suggestFaqsFromPages(chosen, { businessAccountId: A, openaiApiKey: 'sk-test-fake', existingQuestions: ["What is GIVA's return policy?"] });
  const q = (text: string) => r.suggestions.filter(s => s.question === text);
  expect(q('Is the silver hallmarked?').length === 1 && q('Is the silver hallmarked?')[0].source === 'exact'
    && q('Is the silver hallmarked?')[0].answer === 'Yes, every piece is BIS hallmarked 925 silver.', 'FAQ page question copied word for word, shown once (not again from the AI)', q('Is the silver hallmarked?'));
  expect(r.suggestions.filter(s => s.source === 'exact').length === 3 && !r.suggestions.some(s => s.question === 'Menu'), 'all 3 page questions read; the menu is not a question');
  expect(!aiPrompts.some(t => t.includes('/pages/faq')), 'a page with its own question list needs no AI');
  const ret = q('How many days do I have to return an item?')[0];
  expect(ret?.source === 'ai' && ret.pageUrl.endsWith('/policies/refund-policy') && ret.category === 'Returns & exchanges', 'policy page: AI-written, marked with its page and category', ret);
  const dup = q('What is your return policy?')[0];
  expect(dup?.duplicateOf === "What is GIVA's return policy?" && dup.category === 'Returns & exchanges', 'repeat of an existing FAQ is marked; unknown category replaced', dup);
  expect(r.pagesFailed.length === 1 && r.pagesFailed[0].url.endsWith('/pages/app-faq') && /JavaScript/.test(r.pagesFailed[0].reason), 'JavaScript-only page reported', r.pagesFailed);
  expect(r.pagesRead === 4 && !r.aiUnavailable, 'pages read counted', r.pagesRead);

  const noKey = await suggestFaqsFromPages(chosen, { businessAccountId: A, openaiApiKey: null, existingQuestions: [] });
  expect(noKey.aiUnavailable && noKey.suggestions.length === 3 && noKey.suggestions.every(s => s.source === 'exact'), 'no AI key: only the website\'s own questions', noKey.suggestions.length);

  let bad = '';
  try { await suggestFaqsFromPages(['https://10.0.0.5/faq'], { businessAccountId: A, openaiApiKey: null, existingQuestions: [] }).then(x => { bad = x.pagesFailed[0]?.reason || ''; }); } catch (e: any) { bad = e.message; }
  expect(/isn't allowed/.test(bad), 'a private address is refused', bad);

  web.close();
  openai.close();
  await new Promise(r2 => setTimeout(r2, 500));
  await pool.end().catch(() => {});
  if (failed) { console.error(`\n${failed} FAQ-from-website checks failed`); process.exit(1); }
  console.log('\nAll FAQ-from-website checks passed');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
