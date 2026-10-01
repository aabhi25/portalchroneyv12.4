/**
 * Website text-chat speed work, end to end through the real chatService and routes against a
 * local Postgres/PGlite and a fake OpenAI that streams SLOWLY and records every request:
 *
 *  - live streaming: the first content event reaches the client BEFORE the model has finished
 *    (chatService, POST /api/chat/widget/stream, POST /api/chat/stream, public chat link);
 *  - [[FALLBACK]] is never visible (also split across chunks), a configured fallback template
 *    and a phone-number rejection keep the buffered / replaced behaviour;
 *  - tool answers (products, FAQs, appointments) still work, cards still arrive; a preamble
 *    written before a tool call is shown once and stored together with the answer;
 *  - small talk and accounts with no knowledge skip the query embedding; "hi, what's the
 *    price?" still searches; repeated queries hit the embedding cache;
 *  - the AI spam check only runs for suspicious first messages;
 *  - GET /api/chat/widget/intro: AI greeting / translations cached, chat-open prewarm;
 *  - a selected (non-English) language still answers through the normal path.
 * Plus pure checks of the small-talk / spam heuristics, the embedding cache and the live filter.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55941/postgres?sslmode=disable \
 *   CHAT_SPEED_TEST_DB=1 DB_POOL_MAX=1 npx tsx server/services/__tests__/chatSpeed.integration.test.ts
 */
process.env.TZ = 'UTC';
import crypto from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'net';

const url = process.env.DATABASE_URL || '';
if (process.env.CHAT_SPEED_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set CHAT_SPEED_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString('hex');
process.env.OPENAI_API_KEY = 'sk-test-fake';
delete process.env.CHAT_CONTEXT_MODE;
delete process.env.CHAT_CONTEXT_LEGACY_ACCOUNTS;

let failed = 0;
let passed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 700)}` : ''}`); }
  else { passed++; console.log(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(4).toString('hex');

async function main() {
  // Never reach the real network (OpenAI, geolocation, CRMs…).
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') throw new Error(`test attempted a real network call to ${u.hostname}`);
    return realFetch(input, init);
  }) as typeof fetch;

  const { startFakeOpenAISlow } = await import('./helpers/fakeOpenAISlow');
  const fake = await startFakeOpenAISlow();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  // ── 0. Pure checks ──────────────────────────────────────────────────────────
  {
    const { smallTalkKind } = await import('../chatContext/smallTalk');
    const small: Array<[string, string | null, string?]> = [
      ['hey wassup', 'greeting'], ['hi there', 'greeting'], ['hello ji', 'greeting'], ['Good morning!', 'greeting'], ['good evening', 'greeting'],
      ['how are you?', 'greeting'], ['kaise ho', 'greeting'], ['namaste', 'greeting'], ['नमस्ते', 'greeting'], ['ok', 'ack'], ['okay', 'ack'],
      ['thanks a lot', 'greeting'], ['thank you so much', 'greeting'], ['great', 'ack'], ['cool', 'ack'], ['bye', 'greeting'], ["What's up?", 'greeting'],
      ['hi how are you doing', 'greeting'], ['thanks bro', 'greeting'], ['धन्यवाद', 'greeting'],
      ["hi, what's the price?", null], ['hello, I want admission', null], ['price', null], ['hiking', null], ['hi 123', null], ['sir', null],
      ['ok', 'ack', 'Thanks for visiting.'], ['ok', null, 'Want me to share the fee details?'], ['evening', null, 'When should we call you?'],
      ['hi hi hi hi hi hi', null],
    ];
    const bad = small.filter(([m, exp, last]) => smallTalkKind(m, last) !== exp).map(([m, exp, last]) => ({ m, exp, got: smallTalkKind(m, last), last }));
    expect(bad.length === 0, `small talk detector: ${small.length} cases (EN + Hinglish/Hindi, ≤5 words, questions still search)`, bad);

    const { spamCheckReason } = await import('../spamDetectionService');
    const clean = ['hey wassup', 'hello', 'What are the fees for MBA?', 'I want to know about admission process', 'kya fees hai?', 'मुझे फीस बताइए', 'Is parking available at Koramangala?', 'Rahul Sharma', 'B.Com course details', 'price?', 'thank you so much'];
    const suspicious = ['check http://spam.example.com now', 'www.cheap-pills.xyz', 'asdfghjkl', 'jkldf', 'xxxxxxx', '!!!@@@###$$$', 'test', 'testing 123', 'a', 'qwertyuiop', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', 'bdfghjkl mnpqr', '12345'];
    const wronglyFlagged = clean.filter(m => spamCheckReason(m) !== null).map(m => [m, spamCheckReason(m)]);
    const missed = suspicious.filter(m => spamCheckReason(m) === null);
    expect(wronglyFlagged.length === 0, 'spam heuristics: ordinary greetings / questions (EN, Hinglish, Hindi) are not flagged', wronglyFlagged);
    expect(missed.length === 0, 'spam heuristics: links, keyboard mashing, no-vowel / repeated / symbol / test inputs are flagged', missed);

    const { embedQueryCached, queryEmbeddingCacheStats, clearQueryEmbeddingCache } = await import('../chatContext/queryEmbeddingCache');
    clearQueryEmbeddingCache();
    let n = 0;
    const embed = async (t: string) => { n++; await sleep(20); return [t.length]; };
    const [a, b] = await Promise.all([embedQueryCached('acc1', 'fees?', embed), embedQueryCached('acc1', 'fees?', embed)]);
    const c = await embedQueryCached('acc1', 'fees?', embed);
    await embedQueryCached('acc2', 'fees?', embed);
    expect(n === 2 && a[0] === 5 && b[0] === 5 && c[0] === 5, 'embedding cache: concurrent + repeated query on one account → one call; other account separate', { n });
    let fails = 0;
    const flaky = async () => { fails++; throw new Error('boom'); };
    await embedQueryCached('acc3', 'x', flaky).catch(() => undefined);
    await embedQueryCached('acc3', 'x', flaky).catch(() => undefined);
    expect(fails === 2, 'embedding cache: failures are not cached');
    for (let i = 0; i < 205; i++) await embedQueryCached('acc4', `q${i}`, async () => [i]);
    const before = queryEmbeddingCacheStats().misses;
    await embedQueryCached('acc4', 'q0', async () => [0]);
    expect(queryEmbeddingCacheStats().misses === before + 1, 'embedding cache: LRU keeps at most 200 entries per account (oldest evicted)');
    clearQueryEmbeddingCache();

    const { chatService } = await import('../../chatService');
    const f = (chatService as any).createLiveTextFilter();
    const pieces = ['Sorry, I can', "'t help. [[", 'FALL', 'BACK]] Plea', 'se share your number.'];
    const shown = pieces.map((p: string) => f.push(p)).join('') + f.flush();
    expect(shown === "Sorry, I can't help. Please share your number." && !/\[|FALLBACK/.test(shown), 'live filter: [[FALLBACK]] split across chunks is never shown', shown);
    const g = (chatService as any).createLiveTextFilter();
    const s2 = ['Price is [', 'see table] ok'].map((p: string) => g.push(p)).join('') + g.flush();
    expect(s2 === 'Price is [see table] ok', 'live filter: ordinary brackets pass through', s2);
    const sep = (chatService as any).preambleSeparator.bind(chatService);
    expect(sep('Let me check.', 'Here') === '\n\n' && sep('Sure,', 'here') === ' ' && sep('Sure ', 'x') === '' && sep('Ok.', ' x') === '', 'preamble separator: paragraph after a sentence, space mid-sentence, none when whitespace exists');
  }

  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq, and, desc } = await import('drizzle-orm');
  const { seedChatBusiness } = await import('./helpers/chatContextSeed');
  const { chatService } = await import('../../chatService');
  const { businessContextCache, BusinessContextCache } = await import('../businessContextCache');
  const { storage } = await import('../../storage');
  const { queryEmbeddingCacheStats, clearQueryEmbeddingCache } = await import('../chatContext/queryEmbeddingCache');
  const cfg = await import('../chatContext/config');
  const { ensurePassageVectors } = await import('../chatContext/passageVectors');
  const { buildBusinessProfile } = await import('../chatContext/businessProfile');
  const { websiteAnalysisService } = await import('../../websiteAnalysisService');
  const { embeddingService } = await import('../embeddingService');

  const tag = rnd();
  const A = await seedChatBusiness(db, schema, { tag, pages: 6, docs: 2, faqs: 10 });
  await db.update(schema.businessAccounts).set({ appointmentsEnabled: 'true' } as any).where(eq(schema.businessAccounts.id, A.accountId));
  await db.update(schema.widgetSettings).set({ appointmentBookingEnabled: 'true', currency: 'INR' } as any).where(eq(schema.widgetSettings.businessAccountId, A.accountId));
  await db.insert(schema.products).values({ businessAccountId: A.accountId, name: 'Gold Membership Card', description: 'Annual gold membership with 4 guest passes', price: '24000' } as any);
  for (let d = 0; d < 7; d++) {
    await db.insert(schema.scheduleTemplates).values({ businessAccountId: A.accountId, dayOfWeek: String(d), startTime: '09:00', endTime: '17:00', slotDurationMinutes: '30', isActive: 'true' } as any);
  }
  // Passage vectors are embedded once per content version in the background — do it now so
  // later "no embedding call" checks only see query embeddings.
  const profileA = buildBusinessProfile({
    companyDescription: '',
    website: await websiteAnalysisService.getAnalyzedContent(A.accountId),
    pages: await storage.getAnalyzedPages(A.accountId),
    docs: await storage.getTrainingDocuments(A.accountId),
  });
  await ensurePassageVectors(A.accountId, profileA.passages, texts => embeddingService.generateBatchEmbeddings(texts, A.accountId));

  // Account with no knowledge at all (no FAQs / documents / URLs / pages / website analysis).
  const [nk] = await db.insert(schema.businessAccounts).values({ name: `Empty Co ${tag}`, website: 'https://empty.example', openaiApiKey: 'sk-test-fake' } as any).returning();
  await db.insert(schema.widgetSettings).values({ businessAccountId: nk.id } as any);

  const baseCtx = (accountId: string, userId: string, extra: Record<string, any> = {}) => ({
    userId, businessAccountId: accountId, personality: 'friendly', responseLength: 'balanced', companyDescription: '',
    openaiApiKey: 'sk-test-fake', currency: 'INR', currencySymbol: '₹', channel: 'widget', supportsCalendarUI: true, systemMode: 'full',
    visitorToken: `tok_${userId}`,
    ...extra,
  });
  type Ev = { type: string; data: any; at: number };
  async function turn(accountId: string, userId: string, message: string, extra: Record<string, any> = {}) {
    const startIdx = fake.calls.length;
    const events: Ev[] = [];
    for await (const ev of chatService.streamMessage(message, baseCtx(accountId, userId, extra) as any)) {
      events.push({ ...(ev as any), at: Date.now() });
    }
    await sleep(80);
    const calls = fake.calls.slice(startIdx);
    const content = events.filter(e => e.type === 'content').map(e => String(e.data)).join('');
    // Plain (no-tool) answers end with content + done (no `final` event), as before.
    const finalEv = events.filter(e => e.type === 'final').pop();
    const firstContent = events.find(e => e.type === 'content' && e.data);
    const convId = events.find(e => e.type === 'conversation_id')?.data as string;
    const err = events.find(e => e.type === 'error');
    if (err) console.error('STREAM ERROR', err.data);
    return {
      events, calls, content, final: finalEv ? String(finalEv.data) : content, hasFinalEvent: !!finalEv, firstContent, convId,
      main: calls.find(c => c.purpose === 'main'), cont: calls.find(c => c.purpose === 'continuation'),
      embeds: calls.filter(c => c.purpose === 'embedding'),
    };
  }
  const lastAssistant = async (convId: string) => {
    const rows = await db.select().from(schema.messages).where(and(eq(schema.messages.conversationId, convId), eq(schema.messages.role, 'assistant'))).orderBy(desc(schema.messages.createdAt));
    return rows[0]?.content;
  };
  const visitor = () => `widget_session_${rnd()}`;

  // ── 1. Plain answer streams live ──────────────────────────────────────────────
  {
    fake.script = (call) => call.purpose === 'main'
      ? { content: 'Our annual Gold membership costs ₹24,000 and includes four guest passes for friends and family.' }
      : null;
    const r = await turn(A.accountId, visitor(), 'How much is the gold membership per year?');
    fake.script = null;
    const contentEvents = r.events.filter(e => e.type === 'content');
    expect(r.main && r.firstContent && r.main.endedAt && r.firstContent.at < r.main.endedAt - 200,
      'plain answer: first content event arrives well BEFORE the model finished streaming',
      { firstContentAt: r.firstContent?.at, mainEndedAt: r.main?.endedAt });
    expect(contentEvents.length >= 5, `plain answer: streamed as many small content events (${contentEvents.length})`);
    expect(r.content === r.final && r.final === 'Our annual Gold membership costs ₹24,000 and includes four guest passes for friends and family.', 'plain answer: streamed text == final', { content: r.content, final: r.final });
    expect(await lastAssistant(r.convId) === r.final, 'plain answer: stored message == what the visitor saw');
  }

  // ── 2. [[FALLBACK]] never visible (no template configured) ─────────────────────
  {
    fake.script = (call) => call.purpose === 'main'
      ? { chunks: ["I'm not sure about", ' that one. [[FAL', 'LBACK]] Could you', ' share your number so', ' our team can help?'] }
      : null;
    const r = await turn(A.accountId, visitor(), 'Do you sell scuba diving gear?');
    fake.script = null;
    const anyMarker = r.events.some(e => (e.type === 'content' || e.type === 'final') && /\[\[|FALLBACK|\]\]/.test(String(e.data)));
    expect(!anyMarker, '[[FALLBACK]] (split across chunks) never appears in any content / final event', r.events.filter(e => e.type === 'content').map(e => e.data));
    expect(r.content === r.final && r.final === "I'm not sure about that one. Could you share your number so our team can help?", 'no template: the stripped answer streams live and equals final', { content: r.content, final: r.final });
    expect(r.firstContent && r.main?.endedAt && r.firstContent.at < r.main.endedAt, 'no template: deflection answer still streams live');
  }

  // ── 3. Fallback template configured → buffered + replaced (unchanged) ─────────
  {
    const customInstructions = JSON.stringify([{ id: 'fb1', type: 'fallback', text: 'For anything else, please contact our team on WhatsApp.' }]);
    fake.script = (call) => call.purpose === 'main'
      ? { chunks: ["I don't know about", ' scuba gear. [[FALLBACK]]'] }
      : null;
    const r = await turn(A.accountId, visitor(), 'Do you sell scuba diving gear?', { customInstructions });
    fake.script = null;
    expect(r.calls.some(c => c.purpose === 'rephrase'), 'template: the fallback template is rephrased (as before)');
    expect(r.final === 'REPHRASED FALLBACK: please contact our team.' && r.content === r.final, 'template: the deflection is replaced; only the replacement is sent', { content: r.content, final: r.final });
    expect(!/scuba|\[\[/.test(r.content), 'template: the original deflection text never reaches the client');
    expect(r.firstContent && r.main?.endedAt && r.firstContent.at >= r.main.endedAt, 'template: answer stays buffered (no live streaming)', { first: r.firstContent?.at, end: r.main?.endedAt });
    // A normal answer for the same account is also buffered (the answer might need replacing).
    const r2 = await turn(A.accountId, visitor(), 'What are your opening hours?', { customInstructions });
    expect(r2.firstContent && r2.main?.endedAt && r2.firstContent.at >= r2.main.endedAt && r2.content === r2.final, 'template configured: even a normal answer stays buffered, text unchanged');
  }

  // ── 4. Phone number rejected → buffered, safety net unchanged ─────────────────
  {
    const [pb] = await db.insert(schema.businessAccounts).values({ name: `Phone Co ${tag}`, website: 'https://phone.example', openaiApiKey: 'sk-test-fake' } as any).returning();
    await db.insert(schema.widgetSettings).values({
      businessAccountId: pb.id,
      leadTrainingConfig: { fields: [{ id: 'mobile', enabled: true, required: true, priority: 1, captureStrategy: 'custom', customAskAfter: 9, phoneValidation: '10' }], captureStrategy: 'custom' },
    } as any);
    fake.script = (call) => call.purpose === 'main' ? { content: 'Thank you for sharing your number! Our team will call you soon.' } : null;
    const r = await turn(pb.id, visitor(), 'my number is 98450 1234');
    fake.script = null;
    expect(/PHONE NUMBER NOT VALID/.test(r.main?.finalRules || ''), 'phone gate: the model was told the number is not valid');
    expect(r.final === 'It looks like that number might not be correct — could you please double-check and share a valid number?' && r.content === r.final,
      'phone gate: an accepting answer is replaced by the safety-net reply; the accepting text is never sent', { content: r.content, final: r.final });
    expect(r.firstContent && r.main?.endedAt && r.firstContent.at >= r.main.endedAt, 'phone gate: buffered (no live streaming)');
  }

  // ── 5. Tool answers: products, FAQs, appointments ─────────────────────────────
  {
    fake.script = (call) => call.purpose === 'main' ? { toolCalls: [{ name: 'get_products', args: { search: 'gold membership' } }] }
      : call.purpose === 'continuation' ? { content: 'Here are some great options for you!' } : null;
    const r = await turn(A.accountId, visitor(), 'show me your gold membership card');
    const products = r.events.find(e => e.type === 'products');
    const prodIdx = r.events.findIndex(e => e.type === 'products');
    const firstContentIdx = r.events.findIndex(e => e.type === 'content');
    expect(products && JSON.parse(products.data).items?.some((p: any) => p.name === 'Gold Membership Card'), 'products: product cards event still arrives');
    expect(r.content === 'Here are some great options for you!' && r.final === r.content && prodIdx >= 0 && prodIdx < firstContentIdx, 'products: answer streams after the cards; final == streamed', { content: r.content, final: r.final, prodIdx, firstContentIdx });

    fake.script = (call) => call.purpose === 'main' ? { toolCalls: [{ name: 'get_faqs', args: { query: 'student discount' } }] }
      : call.purpose === 'continuation' ? { content: 'Students with a valid college ID get 20% off.' } : null;
    const r2 = await turn(A.accountId, visitor(), 'Do you offer a student discount?');
    expect(r2.cont && /20%/.test(r2.cont.messages.filter(m => m.role === 'tool').map(m => JSON.stringify(m.content)).join('')), 'FAQs: get_faqs result reaches the continuation call');
    expect(r2.final === 'Students with a valid college ID get 20% off.' && r2.content === r2.final, 'FAQs: answer streamed and final match', { content: r2.content, final: r2.final });

    fake.script = (call) => call.purpose === 'main' ? { toolCalls: [{ name: 'list_available_slots', args: {} }] }
      : call.purpose === 'continuation' ? { content: 'Here are the available slots — pick one that suits you!' } : null;
    const r3 = await turn(A.accountId, visitor(), 'I want to book an appointment');
    const slots = r3.events.find(e => e.type === 'appointment_slots');
    expect(slots && Object.keys(JSON.parse(slots.data).slots || {}).length > 0, 'appointments: appointment_slots event still arrives');
    expect(r3.final === r3.content && /available slots/.test(r3.final || ''), 'appointments: answer streamed and final match');
    fake.script = null;
  }

  // ── 6. Preamble, then a tool call: shown once, stored with the answer ─────────
  {
    fake.script = (call) => call.purpose === 'main'
      ? { content: 'Let me check our plans for you.', toolCalls: [{ name: 'get_faqs', args: { query: 'membership plans' } }] }
      : call.purpose === 'continuation' ? { content: 'We have Gold and Silver plans; Gold includes 4 guest passes.' } : null;
    const r = await turn(A.accountId, visitor(), 'what membership plans do you have?');
    fake.script = null;
    const expected = 'Let me check our plans for you.\n\nWe have Gold and Silver plans; Gold includes 4 guest passes.';
    expect(r.content === expected, 'preamble: visitor sees preamble + answer once (no duplicated text)', r.content);
    expect(r.final === expected, 'preamble: final == what the visitor saw', r.final);
    expect(await lastAssistant(r.convId) === expected, 'preamble: stored message == what the visitor saw');
    const preIdx = r.events.findIndex(e => e.type === 'content');
    const toolIdx = r.events.findIndex(e => e.type === 'tool_start');
    expect(preIdx >= 0 && toolIdx > preIdx && r.firstContent && r.main?.endedAt && r.firstContent.at < r.main.endedAt, 'preamble: streamed live before the tool ran');
    const assistantTurn = r.cont?.messages.find(m => m.role === 'assistant' && m.tool_calls);
    expect(assistantTurn && textOf(assistantTurn.content) === 'Let me check our plans for you.', 'preamble: the continuation call still sees the preamble as the assistant turn');
  }

  // ── 7. Small talk skips the knowledge search; a real question still searches ──
  {
    clearQueryEmbeddingCache();
    const v = visitor();
    const r1 = await turn(A.accountId, v, 'hey wassup');
    expect(r1.embeds.length === 0, '"hey wassup": no embedding call', r1.embeds.map(e => e.inputs));
    expect(r1.content === r1.final && !!r1.final, '"hey wassup": answered normally');
    for (const m of ['thank you so much', 'kaise ho', 'good evening']) {
      const r = await turn(A.accountId, visitor(), m);
      expect(r.embeds.length === 0 && !!r.final, `"${m}": no embedding call`, r.embeds.map(e => e.inputs));
    }
    const r2 = await turn(A.accountId, visitor(), "hi, what's the price?");
    expect(r2.embeds.length > 0 && r2.embeds.some(e => (e.inputs || []).some(i => /price/.test(i))), '"hi, what\'s the price?": the knowledge search embeds the query', r2.embeds.map(e => e.inputs));

    // Legacy context mode: small talk skips the FAQ pre-fetch (vector search) too.
    cfg.setChatContextModeOverride('legacy');
    const r3 = await turn(A.accountId, visitor(), 'hey wassup');
    const r4 = await turn(A.accountId, visitor(), 'Do you have lockers for rent?');
    cfg.setChatContextModeOverride(null);
    expect(r3.embeds.length === 0, 'legacy mode: "hey wassup" → no FAQ pre-fetch embedding', r3.embeds.map(e => e.inputs));
    expect(r4.embeds.length > 0, 'legacy mode: a real question still pre-fetches FAQs');
  }

  // ── 8. No-knowledge account never embeds ──────────────────────────────────────
  {
    const r = await turn(nk.id, visitor(), 'What is the price of your premium plan?');
    expect(r.embeds.length === 0 && !!r.final, 'no FAQs / docs / URLs / pages: the query is never embedded', r.embeds.map(e => e.inputs));
    cfg.setChatContextModeOverride('legacy');
    const r2 = await turn(nk.id, visitor(), 'Do you have a document about refunds in the pdf?');
    cfg.setChatContextModeOverride(null);
    expect(r2.embeds.length === 0, 'no knowledge, legacy mode: no FAQ / document vector search either', r2.embeds.map(e => e.inputs));
    // Adding an FAQ invalidates the "no knowledge" answer at once.
    await storage.createFaq({ businessAccountId: nk.id, question: 'What is the premium plan price?', answer: 'Premium costs ₹999.' } as any);
    await sleep(300); // the FAQ's own embedding (background) is not a query embedding
    const r3 = await turn(nk.id, visitor(), 'What is the price of your premium plan?');
    expect(r3.embeds.some(e => (e.inputs || []).some(i => i.includes('price of your premium plan'))), 'after adding an FAQ the account searches again (presence cache invalidated)', r3.embeds.map(e => e.inputs));
  }

  // ── 9. Query-embedding cache ──────────────────────────────────────────────────
  {
    clearQueryEmbeddingCache();
    const q = 'Is the sauna open on Sundays?';
    const before = queryEmbeddingCacheStats();
    await turn(A.accountId, visitor(), q);
    const r2 = await turn(A.accountId, visitor(), q);
    const after = queryEmbeddingCacheStats();
    expect(after.hits > before.hits, 'repeated question in another conversation: query embedding served from the cache', { before, after });
    expect(!r2.embeds.some(e => (e.inputs || []).includes(q)), 'repeated question: no new embedding request for it');
  }

  // ── 10. Spam check only for suspicious first messages ─────────────────────────
  {
    const r1 = await turn(A.accountId, visitor(), 'hey wassup');
    expect(r1.calls.filter(c => c.purpose === 'spam').length === 0, 'first message "hey wassup": AI spam check skipped');
    const r2 = await turn(A.accountId, visitor(), 'What are your opening hours on weekends?');
    expect(r2.calls.filter(c => c.purpose === 'spam').length === 0, 'first message, normal question: AI spam check skipped');
    const r3 = await turn(A.accountId, visitor(), 'visit http://cheap-deals.example.com for prizes');
    expect(r3.calls.filter(c => c.purpose === 'spam').length === 1, 'first message with a link: AI spam check runs');
    fake.spamVerdict = 'SPAM';
    const r4 = await turn(A.accountId, visitor(), 'asdfghjkl qwerty');
    fake.spamVerdict = 'OK';
    expect(r4.calls.filter(c => c.purpose === 'spam').length === 1 && String(r4.events.find(e => e.type === 'conversation_id')?.data).startsWith('temp_'),
      'gibberish first message: AI spam check runs and the simplified spam path is used (unchanged)');
    const v = visitor();
    await turn(A.accountId, v, 'hello');
    const r5 = await turn(A.accountId, v, 'visit http://cheap-deals.example.com');
    expect(r5.calls.filter(c => c.purpose === 'spam').length === 0, 'second message: never spam-checked (unchanged)');
  }

  // ── 11. Selected language (Hindi) still answers through the normal path ───────
  {
    fake.script = (call) => call.purpose === 'main' ? { content: 'हमारा क्लब सुबह 5:30 बजे से रात 11 बजे तक खुला रहता है।' } : null;
    const r = await turn(A.accountId, visitor(), 'What are your opening hours?', { preferredLanguage: 'hi' });
    fake.script = null;
    expect(/Hindi/.test((r.main?.messages || []).map(m => textOf(m.content)).join('\n')), 'language hi: the language rule reaches the model');
    expect(r.final === 'हमारा क्लब सुबह 5:30 बजे से रात 11 बजे तक खुला रहता है।' && r.content === r.final, 'language hi: answer streamed and final match', { content: r.content, final: r.final });
    expect(r.firstContent && r.main?.endedAt && r.firstContent.at < r.main.endedAt, 'language hi: streamed live');
  }

  // ── 12. Prewarm: the first message finds the business context ready ───────────
  {
    const ctx = baseCtx(A.accountId, visitor());
    businessContextCache.invalidateBusinessContext(A.accountId);
    const origGetAllFaqs = storage.getAllFaqs.bind(storage);
    let faqLoads = 0;
    (storage as any).getAllFaqs = async (id: string) => { if (id === A.accountId) faqLoads++; return origGetAllFaqs(id); };
    const outcome = await chatService.prewarmContextBundle(ctx as any);
    const loadsAfterPrewarm = faqLoads;
    const again = await chatService.prewarmContextBundle(ctx as any);
    await turn(A.accountId, (ctx as any).userId, 'Is there parking at the club?');
    (storage as any).getAllFaqs = origGetAllFaqs;
    expect(outcome === 'warmed' && again === 'fresh', 'prewarm: loads the bundle once, then reports it fresh', { outcome, again });
    expect(loadsAfterPrewarm === 1 && faqLoads === 1, 'prewarm: the first message did not load the business context again', { loadsAfterPrewarm, faqLoads });
    // Concurrent loaders join one in-flight load.
    businessContextCache.invalidateBusinessContext(A.accountId);
    let n = 0;
    const key = BusinessContextCache.KEYS.BUSINESS_CONTEXT_RETRIEVAL(A.accountId);
    const fetcher = async () => { n++; await sleep(50); return { text: 'x' }; };
    await Promise.all([businessContextCache.getOrFetch(key, fetcher), businessContextCache.getOrFetch(key, fetcher)]);
    expect(n === 1, 'cache: two concurrent loads of one key share a single fetch');
    businessContextCache.invalidateBusinessContext(A.accountId);
    // refresh(): the old copy keeps serving until the new one is stored.
    const rk = `test-refresh:${tag}`;
    await businessContextCache.getOrFetch(rk, async () => 'old');
    const refreshing = businessContextCache.refresh(rk, async () => { await sleep(60); return 'new'; });
    const during = await businessContextCache.getOrFetch(rk, async () => 'miss');
    await refreshing;
    const afterRefresh = await businessContextCache.getOrFetch(rk, async () => 'miss');
    expect(during === 'old' && afterRefresh === 'new', 'cache refresh: serves the old copy while reloading, then the new one', { during, afterRefresh });
    businessContextCache.invalidate(rk);
  }

  // ── 13. Routes: live streaming over SSE, intro cache, chat-open prewarm ───────
  {
    const { registerRoutes } = await import('../../routes');
    const { hashPassword, createSession } = await import('../../auth');
    await db.update(schema.users).set({ passwordHash: await hashPassword(crypto.randomBytes(12).toString('hex')) } as any).where(eq(schema.users.id, A.userId));
    const session = await createSession(A.userId);
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use(cookieParser(process.env.SESSION_SECRET));
    const server = await registerRoutes(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    async function sse(path: string, body: any, cookie?: string) {
      const startIdx = fake.calls.length;
      const res = await realFetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const events: Ev[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try { events.push({ ...JSON.parse(line.slice(6)), at: Date.now() }); } catch { /* partial */ }
        }
      }
      await sleep(80);
      const calls = fake.calls.slice(startIdx);
      return {
        status: res.status, events,
        main: calls.find(c => c.purpose === 'main'),
        firstContent: events.find(e => e.type === 'content' && e.data),
        content: events.filter(e => e.type === 'content').map(e => e.data).join(''),
        final: events.filter(e => e.type === 'final').pop()?.data ?? events.filter(e => e.type === 'content').map(e => e.data).join(''),
      };
    }
    const longAnswer = 'The club is open 5:30 am to 11 pm on weekdays and 7 am to 8 pm on weekends, every week of the year.';
    fake.script = (call) => call.purpose === 'main' ? { content: longAnswer } : null;

    const w = await sse('/api/chat/widget/stream', { message: 'What are your opening hours?', businessAccountId: A.accountId, sessionId: rnd(), sessionToken: rnd() });
    expect(w.status === 200 && w.firstContent && w.main?.endedAt && w.firstContent.at < w.main.endedAt - 200,
      'POST /api/chat/widget/stream: first content event reaches the browser before the model finished', { first: w.firstContent?.at, end: w.main?.endedAt });
    expect(w.content === longAnswer && w.final === longAnswer, 'widget route: streamed text == final', { content: w.content, final: w.final });

    const h = await sse('/api/chat/stream', { message: 'What are your opening hours?' }, `session=${session}`);
    expect(h.status === 200 && h.firstContent && h.main?.endedAt && h.firstContent.at < h.main.endedAt - 200,
      'POST /api/chat/stream (Home test chat): first content event before the model finished', { status: h.status, first: h.firstContent?.at, end: h.main?.endedAt });
    expect(h.content === longAnswer && h.final === longAnswer, 'Home route: streamed text == final');

    const token = `tok${rnd()}`;
    await db.insert(schema.publicChatLinks).values({ businessAccountId: A.accountId, token, isActive: 'true' } as any);
    const p = await sse(`/api/public-chat/${token}/stream`, { message: 'What are your opening hours?', sessionId: rnd() });
    expect(p.status === 200 && p.firstContent && p.main?.endedAt && p.firstContent.at < p.main.endedAt - 200 && p.content === longAnswer,
      'POST /api/public-chat/:token/stream: streams live too', { status: p.status, content: p.content });
    fake.script = null;

    // Intro: AI-generated greeting is generated once and then served from the stored copy.
    await db.update(schema.widgetSettings).set({ welcomeMessageType: 'ai_generated', cachedIntro: null } as any).where(eq(schema.widgetSettings.businessAccountId, A.accountId));
    fake.nonStreamDelayMs.intro = 400;
    const get = async (q: string) => {
      const t = Date.now();
      const res = await realFetch(`${base}/api/chat/widget/intro?businessAccountId=${A.accountId}${q}`);
      return { status: res.status, json: await res.json() as any, ms: Date.now() - t };
    };
    const introCallsBefore = fake.of('intro').length;
    const i1 = await get('');
    const i2 = await get('');
    expect(i1.status === 200 && i1.json.intro === 'Welcome to our club! How can I help?' && i2.json.intro === i1.json.intro, 'intro (AI greeting): same greeting on the second call', [i1.json, i2.json]);
    expect(fake.of('intro').length - introCallsBefore === 1 && i2.ms < 300, `intro (AI greeting): generated once; second call fast (${i1.ms}ms → ${i2.ms}ms)`);
    // Changing the welcome settings regenerates it (the stored copy is cleared).
    await db.update(schema.widgetSettings).set({ cachedIntro: null } as any).where(eq(schema.widgetSettings.businessAccountId, A.accountId));
    await get('');
    expect(fake.of('intro').length - introCallsBefore === 2, 'intro: regenerated after the stored greeting is cleared by a settings change');
    // Custom welcome + a selected language: translated once, then cached; editing the text re-translates.
    await db.update(schema.widgetSettings).set({ welcomeMessageType: 'custom', welcomeMessage: 'Hello! Ask me anything about Northwind.' } as any).where(eq(schema.widgetSettings.businessAccountId, A.accountId));
    const tBefore = fake.of('translate').length;
    const c1 = await get('&language=hi');
    const c2 = await get('&language=hi');
    expect(c1.json.intro === '[translated] Hello! Ask me anything about Northwind.' && c2.json.intro === c1.json.intro && fake.of('translate').length - tBefore === 1,
      'intro (custom, Hindi): translated once, cached on the second call', [c1.json, c2.json, fake.of('translate').length - tBefore]);
    const c3 = await get('');
    expect(c3.json.intro === 'Hello! Ask me anything about Northwind.', 'intro (custom, no language): the static welcome, unchanged');
    await db.update(schema.widgetSettings).set({ welcomeMessage: 'Hi again! What can I do for you?' } as any).where(eq(schema.widgetSettings.businessAccountId, A.accountId));
    const c4 = await get('&language=hi');
    expect(c4.json.intro === '[translated] Hi again! What can I do for you?', 'intro: an edited welcome message is translated afresh (not the old cached one)', c4.json);
    fake.nonStreamDelayMs.intro = 0;

    // Chat-open prewarm from the intro endpoint.
    const B = await seedChatBusiness(db, schema, { tag: `${tag}p`, pages: 2, docs: 1, faqs: 2 });
    const C = await seedChatBusiness(db, schema, { tag: `${tag}q`, pages: 2, docs: 1, faqs: 2 });
    const keyC = BusinessContextCache.KEYS.BUSINESS_CONTEXT_RETRIEVAL(C.accountId);
    const keyB = BusinessContextCache.KEYS.BUSINESS_CONTEXT_RETRIEVAL(B.accountId);
    expect(businessContextCache.freshAgeMs(keyB) === null, 'prewarm (route): bundle not cached before the widget opens');
    await realFetch(`${base}/api/chat/widget/intro?businessAccountId=${B.accountId}`);
    let warm = false;
    for (let i = 0; i < 40 && !warm; i++) { await sleep(50); warm = businessContextCache.freshAgeMs(keyB) !== null; }
    expect(warm, 'prewarm (route): opening the widget (intro) warms the business context');
    expect(businessContextCache.freshAgeMs(keyC) === null, 'prewarm (route): second account not cached yet');
    await realFetch(`${base}/api/widget-settings/public?businessAccountId=${C.accountId}`);
    warm = false;
    for (let i = 0; i < 40 && !warm; i++) { await sleep(50); warm = businessContextCache.freshAgeMs(keyC) !== null; }
    expect(warm, 'prewarm (route): loading the widget settings warms the business context');
    server.close();
  }

  await fake.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

function textOf(content: any): string {
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: any) => p?.text || '').join(' ') : content == null ? '' : JSON.stringify(content);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
