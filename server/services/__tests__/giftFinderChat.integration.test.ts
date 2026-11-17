/**
 * A gift finder in the website chat, end to end through the real chatService against a local Postgres/PGlite
 * and a fake OpenAI that records every request:
 *
 *  - "I want a gift for my wife" starts the journey; Wife is taken from that message, so the budget is asked;
 *  - answering the budget ends the journey at its "Show products" step: the product search runs straight
 *    away (no first AI call) with Wife's tags and the budget's price range, the product cards come back,
 *    and the reply is written with the step's line in its instructions;
 *  - "show more" in the same chat keeps the gift finder's filter.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55583/postgres?sslmode=disable \
 *   GIFT_FINDER_TEST_DB=1 DB_POOL_MAX=1 npx tsx server/services/__tests__/giftFinderChat.integration.test.ts
 */
process.env.TZ = 'UTC';
import crypto from 'crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const url = process.env.DATABASE_URL || '';
if (process.env.GIFT_FINDER_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set GIFT_FINDER_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString('hex');
process.env.OPENAI_API_KEY = 'sk-test-fake';

let failed = 0;
function expect(cond: any, label: string, got?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}`, got === undefined ? '' : JSON.stringify(got)); } else { console.log(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Call { stream: boolean; messages: Array<{ role: string; content: any; tool_calls?: any[] }>; purpose: 'main' | 'continuation' | 'other' }
const textOf = (content: any): string => (typeof content === 'string' ? content : content == null ? '' : JSON.stringify(content));

/** Fake OpenAI: journey answer reading returns what the visitor said; questions come back as "ASK: …"; replies stream "Lovely picks!". */
async function startFake() {
  const calls: Call[] = [];
  const { fakeEmbedding } = await import('./helpers/fakeOpenAIChat');
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url?.includes('/embeddings')) {
        const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ object: 'list', model: body.model, data: inputs.map((t, i) => ({ object: 'embedding', index: i, embedding: fakeEmbedding(String(t)) })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
        return;
      }
      const messages = (body.messages || []) as Call['messages'];
      const purpose: Call['purpose'] = body.stream && messages.some(m => m.role === 'tool') ? 'continuation' : body.stream ? 'main' : 'other';
      calls.push({ stream: !!body.stream, messages, purpose });
      const prompt = messages.map(m => textOf(m.content)).join('\n');
      if (!body.stream) {
        let content = 'OK';
        if (body.response_format?.type === 'json_object') {
          const m = /User's Response: "([\s\S]*?)"\n/.exec(prompt);
          content = m
            ? JSON.stringify({ answer: m[1], is_off_topic: false, is_refusal: false, quality: 'valid', brief_offtopic_answer: null })
            : '{}';
        } else {
          const next = /(?:Next question to ask|Current question we need to ask): ([^\n]+)/.exec(prompt) || /Rephrase this question naturally: ([^\n]+)/.exec(prompt);
          if (next) content = `ASK: ${next[1]}`;
          else if (/language detector/i.test(textOf(messages[0]?.content))) content = 'en';
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (delta: any, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      send({ role: 'assistant', content: '' });
      send({ content: 'Lovely picks!' });
      send({}, 'stop');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  return { calls, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => new Promise<void>(r => server.close(() => r())) };
}

async function main() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') throw new Error(`test attempted a real network call to ${u.hostname}`);
    return realFetch(input, init);
  }) as typeof fetch;

  const fake = await startFake();
  process.env.OPENAI_BASE_URL = fake.baseUrl;
  const { db, pool } = await import('../../db');
  const schema = await import('@shared/schema');
  const { storage } = await import('../../storage');
  const { chatService } = await import('../../chatService');
  const { journeyService } = await import('../journeyService');
  const { withOptionFilters } = await import('@shared/journeyProducts');
  const { productTextEmbeddingService } = await import('../productTextEmbeddingService');

  const tag = crypto.randomBytes(3).toString('hex');
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `Gift Shop ${tag}`, website: 'https://gifts.example', openaiApiKey: 'sk-test-fake' } as any).returning();
  const B = biz.id as string;
  await db.insert(schema.widgetSettings).values({ businessAccountId: B } as any);

  // Products: two tagged "Gift: Wife" inside the budget, one outside it, one for mothers.
  const wifeTag = await storage.createTag({ businessAccountId: B, name: 'Gift: Wife' });
  const motherTag = await storage.createTag({ businessAccountId: B, name: 'Gift: Mother' });
  const items = [
    { name: 'Rose Gold Heart Pendant', price: '1799', tag: wifeTag.id },
    { name: 'Silver Infinity Bracelet', price: '2199', tag: wifeTag.id },
    { name: 'Diamond Solitaire Ring', price: '8999', tag: wifeTag.id },
    { name: 'Pearl Drop Earrings', price: '1499', tag: motherTag.id },
  ];
  for (const it of items) {
    const [row] = await db.insert(schema.products).values({ businessAccountId: B, name: it.name, description: `${it.name}, a lovely gift.`, price: it.price, source: 'manual', stockStatus: 'in_stock' } as any).returning({ id: schema.products.id });
    await db.insert(schema.productTags).values({ productId: row.id, tagId: it.tag });
  }
  await productTextEmbeddingService.backfillEmbeddingsForBusiness(B);

  // The gift finder: Who (Wife → tags), Budget (price ranges), Show products, ending.
  const [j] = await db.insert(schema.conversationJourneys).values({ businessAccountId: B, name: 'Gift finder', journeyType: 'conversational', status: 'active', triggerMode: 'manual', triggerKeywords: JSON.stringify(['gift']) } as any).returning();
  const step = (order: number, v: Record<string, unknown>) => db.insert(schema.journeySteps).values({ journeyId: j.id, stepOrder: String(order), isRequired: 'true', questionType: 'text', ...v } as any);
  await step(1, { questionText: 'Who is the gift for?', questionType: 'radio', multipleChoiceOptions: JSON.stringify(['Wife', 'Mother']), toolParameters: withOptionFilters(null, { Wife: { tags: ['Gift: Wife'] }, Mother: { tags: ['Gift: Mother'] } }) });
  await step(2, { questionText: 'What is your budget?', questionType: 'radio', multipleChoiceOptions: JSON.stringify(['Under 1000', '1000 to 2500']), toolParameters: withOptionFilters(null, { 'Under 1000': { maxPrice: 1000 }, '1000 to 2500': { minPrice: 1000, maxPrice: 2500 } }) });
  await step(3, { questionText: "Here are a few gifts she'll love", toolTrigger: 'get_products', toolParameters: JSON.stringify({ search: 'gift' }) });
  await step(4, { questionText: 'Thank you!', toolTrigger: 'journey_complete', isRequired: 'false' });
  journeyService.invalidateJourneyCache(B);

  const userId = `widget_${tag}`;
  const ctx = { userId, businessAccountId: B, personality: 'friendly', responseLength: 'balanced', companyDescription: '', openaiApiKey: 'sk-test-fake', currency: 'INR', currencySymbol: '₹', channel: 'widget', supportsCalendarUI: true, systemMode: 'full', visitorToken: `tok_${tag}` };
  async function turn(message: string) {
    const start = fake.calls.length;
    const events: Array<{ type: string; data: any }> = [];
    for await (const ev of chatService.streamMessage(message, ctx as any)) events.push(ev as any);
    await sleep(80);
    const calls = fake.calls.slice(start);
    const productsEv = events.find(e => e.type === 'products');
    const products = productsEv ? (JSON.parse(productsEv.data).items as any[]) : [];
    const text = events.filter(e => e.type === 'content' || e.type === 'final').map(e => String(e.data)).join('');
    return { events, calls, products, text, error: events.find(e => e.type === 'error') };
  }

  // 1. The first message names the recipient → the budget is asked.
  const t1 = await turn('I want a gift for my wife');
  expect(!t1.error && /What is your budget/.test(t1.text) && t1.products.length === 0, 'first message: Wife taken from it, the budget is asked', t1.text);

  // 2. Budget → products straight away.
  const t2 = await turn('1000 to 2500');
  const names = t2.products.map(p => p.name).sort();
  expect(!t2.error && names.join() === 'Rose Gold Heart Pendant,Silver Infinity Bracelet', 'budget answered: product cards = Wife-tagged products within ₹1,000–2,500', names);
  expect(t2.calls.filter(c => c.purpose === 'main').length === 0, 'no first AI call: the search ran straight away', t2.calls.map(c => c.purpose));
  const cont = t2.calls.find(c => c.purpose === 'continuation');
  const sys = cont ? textOf(cont.messages[0]?.content) : '';
  expect(!!cont && /Here are a few gifts she'll love/.test(sys) && /SHOWING PRODUCTS/.test(sys), "reply written with the step's line in its instructions", sys.slice(0, 200));
  expect(/Lovely picks!/.test(t2.text), 'the reply text arrives with the cards', t2.text);

  // 3. Show more keeps the filter (nothing else matches it, so at most the 2 again).
  const { ToolExecutionService } = await import('../toolExecutionService');
  const convId = t2.events.find(e => e.type === 'conversation_id')?.data ?? t1.events.find(e => e.type === 'conversation_id')?.data;
  const more = await ToolExecutionService.executeTool('get_products', { search: 'jewellery', offset: 5 }, { businessAccountId: B, userId, userMessage: 'show more', conversationId: convId } as any);
  expect((more as any).pagination?.total === 2, '"show more" keeps the Wife + budget filter', (more as any).pagination);

  await fake.close();
  await sleep(200);
  await pool.end().catch(() => {});
  if (failed) { console.error(`\n${failed} gift finder checks failed`); process.exit(1); }
  console.log('\nAll gift finder chat checks passed');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
