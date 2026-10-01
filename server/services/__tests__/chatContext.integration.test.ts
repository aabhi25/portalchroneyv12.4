/**
 * Website-chat context builder against a real (local) Postgres + pgvector and a fake
 * OpenAI server: retrieval relevance, follow-ups, tenant isolation, cache-friendly
 * prompt prefix, the legacy safety valve, TopScholar/K12 untouched, and the HNSW
 * migration.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55485/postgres?sslmode=disable \
 *   CHAT_CONTEXT_TEST_DB=1 npx tsx server/services/__tests__/chatContext.integration.test.ts
 *
 * Against PGlite (pglite-socket) also set DB_POOL_MAX=1: its socket server can interleave
 * concurrent extended-protocol queries from several connections (not an issue on Postgres).
 */
import crypto from 'crypto';

const url = process.env.DATABASE_URL || '';
if (process.env.CHAT_CONTEXT_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set CHAT_CONTEXT_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.OPENAI_API_KEY = 'sk-test-fake';
process.env.TOPSCHOLAR_ACCOUNT_ID = crypto.randomUUID(); // a throwaway "TopScholar" tenant for this run
delete process.env.CHAT_CONTEXT_MODE;
delete process.env.CHAT_CONTEXT_LEGACY_ACCOUNTS;

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 600)}` : ''}`); } else { console.log(`✓ ${label}`); }
}
const stripClock = (s: string) => s
  .replace(/CURRENT DATE\/TIME \(IST[^\n]*\nToday is[^\n]*\n/g, '')
  .replace(/\d{1,2}:\d{2}\s?(am|pm)/gi, '');

async function main() {
  const { startFakeOpenAIChat, promptText } = await import('./helpers/fakeOpenAIChat');
  const fake = await startFakeOpenAIChat();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq, sql } = await import('drizzle-orm');
  const { seedChatBusiness, PAGE_TOPICS } = await import('./helpers/chatContextSeed');
  const { chatService } = await import('../../chatService');
  const cfg = await import('../chatContext/config');
  const { buildBusinessProfile } = await import('../chatContext/businessProfile');
  const { buildRetrievalQuery } = await import('../chatContext/conversationWindow');
  const { retrieveKnowledge } = await import('../chatContext/knowledgeRetrieval');
  const { ensurePassageVectors } = await import('../chatContext/passageVectors');
  const { estimateTokens } = await import('../chatContext/tokens');
  const { embeddingService } = await import('../embeddingService');
  const { storage } = await import('../../storage');
  const { websiteAnalysisService } = await import('../../websiteAnalysisService');
  const { businessContextCache } = await import('../businessContextCache');

  const tag = crypto.randomBytes(3).toString('hex');
  const A = await seedChatBusiness(db, schema, { tag });
  const SECRET = `ZEBRA-VELVET-${tag}`;
  const B = await seedChatBusiness(db, schema, { tag: `${tag}b`, name: 'Other Tenant', pages: 3, docs: 1, faqs: 3, secret: SECRET });

  const profileFor = async (id: string) => buildBusinessProfile({
    companyDescription: '',
    website: await websiteAnalysisService.getAnalyzedContent(id),
    pages: await storage.getAnalyzedPages(id),
    docs: await storage.getTrainingDocuments(id),
  });
  const profileA = await profileFor(A.accountId);
  await ensurePassageVectors(A.accountId, profileA.passages, texts => embeddingService.generateBatchEmbeddings(texts, A.accountId));
  const retrieve = async (accountId: string, message: string, history: any[] = [], passages = profileA.passages) =>
    retrieveKnowledge({
      businessAccountId: accountId, query: buildRetrievalQuery(message, history), passages,
      embedQuery: text => embeddingService.generateEmbedding(text, accountId),
    });

  const baseCtx = (accountId: string, userId: string, extra: Record<string, any> = {}) => ({
    userId, businessAccountId: accountId, personality: 'friendly', responseLength: 'balanced', companyDescription: '',
    openaiApiKey: 'sk-test-fake', currency: 'INR', currencySymbol: '₹', channel: 'widget', supportsCalendarUI: true, systemMode: 'full',
    ...extra,
  });
  async function turn(accountId: string, userId: string, message: string, extra: Record<string, any> = {}) {
    fake.reset();
    let final = '';
    for await (const ev of chatService.streamMessage(message, baseCtx(accountId, userId, extra) as any)) {
      if ((ev as any).type === 'final') final = String((ev as any).data);
    }
    await new Promise(r => setTimeout(r, 100));
    const chats = fake.calls.filter(c => c.kind === 'chat');
    return { final, main: chats.find(c => c.purpose === 'main'), cont: chats.find(c => c.purpose === 'continuation'), chats };
  }

  // ── 1. Migration: HNSW indexes exist, use cosine ops, and fit the query shape ──
  {
    const idx = (await db.execute(sql`SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN ('faqs_embedding_hnsw','document_chunks_embedding_hnsw','url_content_chunks_embedding_hnsw')`)).rows as any[];
    expect(idx.length === 3 && idx.every(r => /USING hnsw/i.test(r.indexdef) && /vector_cosine_ops/.test(r.indexdef)), 'migration created 3 HNSW indexes with vector_cosine_ops', idx);
    const vec = JSON.stringify(Array.from({ length: 1536 }, (_, i) => (i === 511 ? 1 : 0)));
    for (const [table, index] of [['faqs', 'faqs_embedding_hnsw'], ['document_chunks', 'document_chunks_embedding_hnsw'], ['url_content_chunks', 'url_content_chunks_embedding_hnsw']]) {
      const q = `SELECT id FROM ${table} WHERE business_account_id = '${A.accountId}' AND embedding IS NOT NULL ORDER BY embedding <=> '${vec}'::vector LIMIT 8`;
      const natural = await db.transaction(async tx => ((await tx.execute(sql.raw(`EXPLAIN ${q}`))).rows as any[]).map(r => r['QUERY PLAN']).join('\n'));
      const forced = await db.transaction(async tx => {
        // Small test tables → the planner rightly prefers the tenant btree + sort. Take
        // those alternatives away to prove the HNSW index serves this exact query shape.
        await tx.execute(sql`SET LOCAL enable_seqscan = off`);
        await tx.execute(sql`SET LOCAL enable_bitmapscan = off`);
        await tx.execute(sql`SET LOCAL enable_sort = off`);
        return ((await tx.execute(sql.raw(`EXPLAIN ${q}`))).rows as any[]).map(r => r['QUERY PLAN']).join('\n');
      });
      console.log(`   [${table}] natural plan: ${natural.replace(/'\[[^']*\]'/g, "'[…]'").split('\n').filter(l => /Scan|Sort/.test(l)).map(l => l.trim()).join(' | ')}`);
      expect(forced.includes(index), `retrieval query on ${table} can use ${index} (cosine operator matches the index)`, forced);
    }
  }

  // ── 2. Context stays under budget for a large site ───────────────────────────
  {
    const ctx = baseCtx(A.accountId, 'budget_user') as any;
    const legacy = await (chatService as any).buildEnrichedContext(ctx, 'legacy');
    const retrieval = await (chatService as any).buildEnrichedContext(ctx, 'retrieval');
    expect(estimateTokens(legacy) > 14_000, `legacy context dumps every page/doc (${estimateTokens(legacy)} tokens)`);
    expect(estimateTokens(retrieval) < 3_000, `retrieval context is compact (${estimateTokens(retrieval)} tokens)`);
    expect(profileA.tokens <= 1500, `business profile ≤ 1,500 tokens (${profileA.tokens})`);
    expect(retrieval.includes('BUSINESS PROFILE:') && retrieval.includes('Northwind Fitness Club') && !retrieval.includes('DETAILED WEBSITE CONTENT'), 'retrieval context = profile, not page dump');
    const r = await retrieve(A.accountId, 'Tell me everything about membership, prices, classes, pool, parking and hours');
    expect(r.tokens <= 1800, `retrieved knowledge within its budget (${r.tokens} tokens, ${r.items.length} items)`);
  }

  // ── 3. Relevant FAQ / page / document chunk retrieved ──────────────────────────
  {
    const cases: Array<[string, string, string]> = [
      ['Where can I park my car when I visit?', 'PK-4417', 'page'],
      ['How much notice do I need to give to cancel a personal training session?', '48 hours notice', 'document'],
      ['Do you offer a student discount?', '20%', 'faq'],
      ['Is the sauna open on Sundays?', 'sauna is closed every Sunday', 'page'],
    ];
    for (const [q, fact, source] of cases) {
      const r = await retrieve(A.accountId, q);
      const hit = r.items.find(i => i.text.includes(fact));
      expect(hit && hit.source === source, `"${q}" → ${source} with "${fact}"`, r.items.map(i => `${i.source}:${i.score.toFixed(2)}:${i.text.slice(0, 50)}`));
    }
  }

  // ── 4. Follow-up question retrieves using the prior turn ─────────────────────
  {
    const history = [{ role: 'user', content: 'Tell me about your boxing classes' }, { role: 'assistant', content: 'We run boxing every evening.' }];
    const q = buildRetrievalQuery('do I need to bring my own?', history as any);
    expect(q.isFollowUp && q.query.includes('boxing'), 'follow-up query includes the prior user turn', q);
    const withHistory = await retrieve(A.accountId, 'do I need to bring my own?', history);
    expect(withHistory.items.some(i => i.text.includes('Boxing gloves must be your own')), 'follow-up retrieves the boxing page thanks to the prior turn', withHistory.items.map(i => i.title));
    const withoutHistory = await retrieve(A.accountId, 'do I need to bring my own?');
    const rank = (items: any[]) => items.findIndex(i => i.text.includes('Boxing gloves must be your own'));
    expect(rank(withoutHistory.items) !== 0, 'without the prior turn the boxing answer is not the top hit (the history is what finds it)', withoutHistory.items.map(i => i.title));
  }

  // ── 5. Tenant isolation ──────────────────────────────────────────────────────
  {
    const rA = await retrieve(A.accountId, 'What is the vault access code?');
    expect(!JSON.stringify(rA.items).includes(SECRET), "account A never gets account B's FAQ / chunk");
    const rB = await retrieve(B.accountId, 'What is the vault access code?', [], []);
    expect(rB.items.some(i => i.text.includes(SECRET)), 'account B does get its own secret (the query does match)');
    cfg.setChatContextModeOverride('retrieval');
    const t = await turn(A.accountId, `iso_${tag}`, 'What is the vault access code?');
    expect(t.chats.length > 0 && !t.chats.some(c => promptText(c).includes(SECRET)), "end-to-end: no prompt for account A contains account B's data");
  }

  // ── 6. Stable, cache-friendly prefix across turns (retrieval) vs legacy ───────
  {
    cfg.setChatContextModeOverride('retrieval');
    const u = `stable_${tag}`;
    const t1 = await turn(A.accountId, u, 'Do you offer a student discount?');
    const t2 = await turn(A.accountId, u, 'And for seniors?');
    const s1 = String(t1.main?.messages[0].content), s2 = String(t2.main?.messages[0].content);
    expect(t1.main && t2.main && s1 === s2, 'first system message is byte-identical across turns (prompt-cache prefix)', { len1: s1.length, len2: s2.length });
    expect(s1.includes('BUSINESS KNOWLEDGE (always available)') && s1.includes('Northwind Fitness Club'), 'business profile is part of the stable prefix');
    expect(!/FUNNEL STAGE: \w+ \(Message \d+\)/.test(s1), 'per-message funnel stage moved out of the system prompt');
    const fin2 = String(t2.main?.messages[t2.main.messages.length - 1].content);
    expect(/FUNNEL STAGE: INTEREST \(Message 2\)/.test(fin2), 'funnel stage now sits in the final override', fin2.slice(0, 300));
    expect(fin2.includes('aged 60 and above'), 'follow-up "And for seniors?" got the senior-discount page into the prompt');
    expect(!t2.chats.some(c => c.purpose === 'language'), 'no language-detect AI call inside the turn');

    // A question with no knowledge → tool call → continuation. Its system context must
    // also start with the same stable prefix on consecutive turns.
    const u2 = `stable2_${tag}`;
    const c1 = await turn(A.accountId, u2, 'What about kayaks?');
    const c2 = await turn(A.accountId, u2, 'What about canoes?');
    const p1 = String(c1.cont?.messages[0].content || ''), p2 = String(c2.cont?.messages[0].content || '');
    const stableEnd = p1.indexOf('CURRENT DATE (IST');
    expect(c1.cont && c2.cont && stableEnd > 1000 && p2.startsWith(p1.slice(0, stableEnd)), 'continuation system context: stable part identical, date + turn status only at the end', { stableEnd, len1: p1.length, len2: p2.length });
    expect(!p1.slice(0, stableEnd).includes('Today is') && !p1.slice(0, stableEnd).includes('CONVERSATION STATUS'), 'no date/time or turn status inside the stable part');
    const ctxA = baseCtx(A.accountId, 'time_user') as any;
    const openNow = await (chatService as any).buildEnrichedContext(ctxA, 'retrieval', { userMessage: 'Are you open right now?' });
    const pool = await (chatService as any).buildEnrichedContext(ctxA, 'retrieval', { userMessage: 'Do you have a pool?' });
    expect(!/Current time:/.test(p1) && !/Current time:/.test(pool) && /Current time:/.test(openNow), 'clock time only for time-sensitive messages (day-precision date otherwise)');

    cfg.setChatContextModeOverride('legacy');
    const u3 = `legacy_${tag}`;
    const l1 = await turn(A.accountId, u3, 'Do you offer a student discount?');
    const l2 = await turn(A.accountId, u3, 'And for seniors?');
    expect(String(l1.main?.messages[0].content) !== String(l2.main?.messages[0].content), '(legacy sanity) legacy system prompt changes every turn');
  }

  // ── 7. Safety valve: legacy restores the old behaviour ──────────────────────────
  {
    cfg.setChatContextModeOverride(null);
    process.env.CHAT_CONTEXT_MODE = 'legacy';
    const t = await turn(A.accountId, `valve_${tag}`, 'What about kayaks?');
    const sys = String(t.main?.messages[0].content);
    expect(!sys.includes('BUSINESS KNOWLEDGE (always available)') && /FUNNEL STAGE: DISCOVERY \(Message 1\)/.test(sys), 'CHAT_CONTEXT_MODE=legacy → legacy first-call prompt');
    // The old per-turn "CONVERSATION STATUS / LEAD GATE ACTIVE — ask for their name first" prefix was
    // removed (lead collection now comes only from the per-turn LEAD COLLECTION block).
    expect(String(t.cont?.messages[0].content || '').includes('DETAILED WEBSITE CONTENT') && !String(t.cont?.messages[0].content || '').includes('CONVERSATION STATUS'), 'legacy continuation: full page dump, no status prefix', String(t.cont?.messages[0].content || '').slice(0, 80));
    expect(t.chats.some(c => c.purpose === 'main') && String(t.main?.messages[t.main.messages.length - 1].content).includes('TOOL USAGE (CRITICAL)'), 'legacy FAQ pre-fetch / tool-first instruction unchanged');
    delete process.env.CHAT_CONTEXT_MODE;

    await db.insert(schema.systemSettings).values({ key: 'chat_context_legacy_accounts', value: `${A.accountId}`, isEncrypted: 'false' })
      .onConflictDoUpdate({ target: schema.systemSettings.key, set: { value: `${A.accountId}`, isEncrypted: 'false' } });
    cfg.clearChatContextSettingsCache();
    expect(await cfg.resolveChatContextMode(A.accountId) === 'legacy' && await cfg.resolveChatContextMode(B.accountId) === 'retrieval', 'system_settings per-account switch (no restart) → only that account is legacy');
    await db.update(schema.systemSettings).set({ value: 'legacy' }).where(eq(schema.systemSettings.key, 'chat_context_legacy_accounts'));
    await db.insert(schema.systemSettings).values({ key: 'chat_context_mode', value: 'legacy', isEncrypted: 'false' })
      .onConflictDoUpdate({ target: schema.systemSettings.key, set: { value: 'legacy', isEncrypted: 'false' } });
    cfg.clearChatContextSettingsCache();
    expect(await cfg.resolveChatContextMode(B.accountId) === 'legacy', 'system_settings chat_context_mode=legacy → everyone legacy');
    await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, 'chat_context_mode'));
    await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, 'chat_context_legacy_accounts'));
    cfg.clearChatContextSettingsCache();
    expect(await cfg.resolveChatContextMode(A.accountId) === 'retrieval', 'default (no flags) → retrieval');
  }

  // ── 8. TopScholar / K12 content-only untouched; K12 tutor prompt kept ──────────
  {
    cfg.setChatContextModeOverride(null);
    const TS = process.env.TOPSCHOLAR_ACCOUNT_ID!;
    await db.insert(schema.businessAccounts).values({ id: TS, name: `TopScholar ${tag}`, website: 'https://ts.example', openaiApiKey: 'sk-test-fake', k12EducationEnabled: 'true', k12ContentOnlyMode: 'true' } as any);
    const K = await seedChatBusiness(db, schema, { tag: `${tag}k`, name: 'K12 School', pages: 5, docs: 1, faqs: 2 });
    const k12 = { k12EducationEnabled: true, k12ContentOnlyMode: true, k12VerbatimContentMode: true, skipLeadTraining: true };
    for (const [label, id] of [['TopScholar', TS], ['K12 content-only account', K.accountId]] as const) {
      const ctx = baseCtx(id, `k12_${label}`, k12) as any;
      const mode = await (chatService as any).resolveContextMode(ctx);
      businessContextCache.invalidateBusinessContext(id);
      const viaResolver = await (chatService as any).buildEnrichedContext(ctx, mode, { userMessage: 'what is photosynthesis' });
      const legacy = await (chatService as any).buildEnrichedContext(ctx, 'legacy');
      expect(mode === 'legacy', `${label}: always legacy context path`);
      expect(stripClock(viaResolver) === stripClock(legacy) && viaResolver.includes('K12 CONTENT-ONLY GUARDRAIL') && viaResolver.includes('CURRICULUM-ONLY GUARDRAIL'), `${label}: prompt identical to legacy, guardrails intact`);
      const knowledge = await (chatService as any).buildKnowledgeContext('what is photosynthesis', [], ctx, mode);
      expect(knowledge.itemCount === -1, `${label}: legacy retrieval path`);
    }
    const tsKnowledge = await (chatService as any).buildKnowledgeContext('what is photosynthesis', [], baseCtx(TS, 'x', k12), 'legacy');
    expect(tsKnowledge.text === '', 'TopScholar: no general document RAG (unchanged)');
    const { detectWidgetLanguage } = await import('../chatContext/languageSession');
    fake.reset();
    await detectWidgetLanguage(TS, 'ts-session', 'please explain the water cycle in simple words', 'sk-test-fake');
    expect(fake.calls.some(c => c.purpose === 'language'), 'TopScholar: language detection unchanged (legacy detector)');

    const tutorCtx = baseCtx(K.accountId, 'k12_tutor', { k12EducationEnabled: true }) as any; // K12 on, not content-only
    const tutorMode = await (chatService as any).resolveContextMode(tutorCtx);
    const tutor = await (chatService as any).buildEnrichedContext(tutorCtx, tutorMode);
    expect(tutorMode === 'retrieval' && tutor.includes('K12 EDUCATION MODE — TUTOR INSTRUCTIONS') && tutor.includes('BUSINESS PROFILE:'), 'K12 tutor (not content-only): retrieval context keeps the tutor instructions');
  }

  cfg.setChatContextModeOverride(null);
  await fake.close();
  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll chat-context integration checks passed');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
