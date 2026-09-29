/**
 * Unit tests for the website-chat context builder (no database, no network).
 * Run: `npx tsx server/services/__tests__/chatContext.test.ts`
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused'; // modules import db lazily; never queried here

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

async function main() {
  const { buildBusinessProfile, PROFILE_BUDGET_TOKENS, splitIntoPassages, pageTitleFromUrl } = await import('../chatContext/businessProfile');
  const { buildRetrievalQuery, isFollowUpMessage, capHistoryForModel } = await import('../chatContext/conversationWindow');
  const { rankCandidates, DEFAULT_RETRIEVAL_OPTIONS, formatKnowledgeBlock, KNOWLEDGE_START_MARKER } = await import('../chatContext/knowledgeRetrieval');
  const { estimateTokens } = await import('../chatContext/tokens');
  const { tokenize } = await import('../chatContext/lexical');
  const { detectLanguageForSession, clearLanguageSessions, looksConfidentlyEnglish } = await import('../chatContext/languageSession');
  const { PAGE_TOPICS, DOC_TOPICS, WEBSITE_FACTS, pageContent } = await import('./helpers/chatContextSeed');
  const { buildDateTail } = await import('../../chatService');

  // ── Business profile stays under budget for a large site ──────────────────────
  {
    const bigList = Array.from({ length: 80 }, (_, i) => `Product line number ${i} with a fairly long marketing description that goes on and on`);
    const pages = Array.from({ length: 200 }, (_, i) => ({ pageUrl: `https://x.example/page-${i}`, extractedContent: pageContent(PAGE_TOPICS[i % PAGE_TOPICS.length], i) + '\n\n' + 'Extra paragraph. '.repeat(200) }));
    const docs = DOC_TOPICS.map((t, i) => ({ id: `d${i}`, originalFilename: t.slug, summary: `${t.title}. ${'Long summary sentence. '.repeat(80)}`, keyPoints: JSON.stringify(Array.from({ length: 30 }, (_, k) => `Point ${k}`)), uploadStatus: 'completed' }));
    const profile = buildBusinessProfile({
      companyDescription: 'Company description. '.repeat(400),
      website: { ...WEBSITE_FACTS, mainProducts: bigList, mainServices: bigList, keyFeatures: bigList, uniqueSellingPoints: bigList, additionalInfo: 'More info. '.repeat(500), businessDescription: 'About. '.repeat(800) },
      pages, docs,
    });
    expect(profile.tokens <= PROFILE_BUDGET_TOKENS, `profile for a 200-page site stays within budget (${profile.tokens} ≤ ${PROFILE_BUDGET_TOKENS})`, profile.tokens);
    expect(profile.corpusTokens > 100_000, 'the legacy dump for that site would be >100k tokens', profile.corpusTokens);
    expect(!profile.inlinedAllContent && profile.passages.length > 200, 'large site → content goes to retrievable passages', profile.passages.length);
    expect(profile.text.includes('Northwind Fitness Club') && profile.text.includes('+91 80 4000 1234'), 'profile keeps business name and contact details');
    expect(profile.text.includes('Website pages (200)'), 'profile carries a site map of page titles');
    expect(!profile.text.includes('DETAILED WEBSITE CONTENT'), 'no full page dump in the profile');
  }
  {
    const profile = buildBusinessProfile({ website: WEBSITE_FACTS, pages: [{ pageUrl: 'https://x.example/', extractedContent: 'We are open daily. Parking code PK-1.' }], docs: [] });
    expect(profile.inlinedAllContent && profile.text.includes('PK-1') && profile.passages.length === 0, 'a tiny site is inlined verbatim (nothing to gain from retrieval)');
  }
  {
    const pieces = splitIntoPassages(pageContent(PAGE_TOPICS[0], 0));
    expect(pieces.length >= 2 && pieces.every(p => p.length <= 1400), 'pages split into passages of bounded size', pieces.map(p => p.length));
    expect(pageTitleFromUrl('https://x.example/pricing-plans.html') === 'Pricing Plans' && pageTitleFromUrl('https://x.example/') === 'Homepage', 'page titles from URLs');
  }

  // ── History-aware retrieval query ─────────────────────────────────────────────
  {
    const history = [
      { role: 'user' as const, content: 'Do you offer a student discount?' },
      { role: 'assistant' as const, content: 'Yes, 20% off with a college ID.' },
    ];
    const q = buildRetrievalQuery('And for seniors?', history);
    expect(q.isFollowUp && q.query.includes('student discount') && q.primary === 'And for seniors?', 'follow-up folds in the previous user turn', q);
    const standalone = buildRetrievalQuery('Do you have a swimming pool at the Whitefield branch?', history);
    expect(!standalone.isFollowUp && standalone.query === 'Do you have a swimming pool at the Whitefield branch?', 'standalone question is used as-is', standalone);
    expect(isFollowUpMessage('what about the price?') && isFollowUpMessage('how much is it?') && isFollowUpMessage('yes'), 'follow-up heuristics');
    expect(!isFollowUpMessage('What are the membership prices for the annual Gold plan?'), 'full question is not a follow-up');
    expect(!buildRetrievalQuery('and delivery?', []).isFollowUp, 'no history → never a follow-up');
  }

  // ── History cap ──────────────────────────────────────────────────────────────
  {
    const history = [{ role: 'user' as const, content: 'Hi, my name is Priya and I want to lose weight' }];
    for (let i = 0; i < 40; i++) history.push({ role: (i % 2 ? 'user' : 'assistant') as any, content: `message ${i} ` + 'words '.repeat(40) });
    const w = capHistoryForModel(history);
    const kept = w.messages.filter(m => m.role !== 'system');
    expect(kept.length <= 20 && w.droppedCount === history.length - kept.length, 'history capped at 20 messages (10 turns)', { kept: kept.length, dropped: w.droppedCount });
    expect(w.messages[0].role === 'system' && w.messages[0].content.includes('Priya'), 'dropped turns summarised (earlier user facts kept)');
    expect(kept[kept.length - 1] === history[history.length - 1], 'most recent message always kept');
    const huge = [{ role: 'user' as const, content: 'x'.repeat(40_000) }, { role: 'assistant' as const, content: 'y'.repeat(40_000) }, { role: 'user' as const, content: 'z'.repeat(40_000) }];
    const hw = capHistoryForModel(huge);
    expect(hw.messages.filter(m => m.role !== 'system').length === 2, 'token budget drops old huge messages but keeps the last two');
    expect(capHistoryForModel(history.slice(0, 6)).droppedCount === 0, 'short history untouched');
  }

  // ── Ranking: thresholds, de-duplication, budget ─────────────────────────────
  {
    const q = { query: 'parking validation code', primary: 'parking validation code', context: '', isFollowUp: false };
    const dup = 'Basement parking is free for 3 hours with validation code PK-4417 at reception. Our coaches are certified.';
    const items = rankCandidates([
      { key: 'page:a', source: 'page', title: 'Parking', text: dup, vectorScore: 0.7 },
      { key: 'document:b', source: 'document', title: 'rules.pdf', text: dup + ' ', vectorScore: 0.69 },
      { key: 'faq:c', source: 'faq', title: 'Is parking available?', text: 'Q: Is parking available?\nA: Yes, basement parking.', vectorScore: 0.62 },
      { key: 'faq:d', source: 'faq', title: 'Do you have a pool?', text: 'Q: Do you have a pool?\nA: Yes.', vectorScore: 0.2 },
      { key: 'page:e', source: 'page', title: 'Parking', text: 'Validation code for parking is given at reception desk only.', vectorScore: null },
    ], q, DEFAULT_RETRIEVAL_OPTIONS);
    const keys = items.map(i => i.key);
    expect(keys[0] === 'page:a', 'best match first', keys);
    expect(!keys.includes('document:b'), 'near-duplicate chunk from another source dropped', keys);
    expect(!keys.includes('faq:d'), 'irrelevant low-similarity FAQ filtered out', keys);
    expect(keys.includes('page:e'), 'keyword-only candidate (no embedding) qualifies on strong keyword match', keys);
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `document:${i}`, source: 'document' as const, title: 'd', text: `parking validation code ${i} ` + `unique${i} `.repeat(300), vectorScore: 0.8 }));
    const budgeted = rankCandidates(many, q, DEFAULT_RETRIEVAL_OPTIONS);
    const block = formatKnowledgeBlock(budgeted);
    expect(estimateTokens(block) <= DEFAULT_RETRIEVAL_OPTIONS.budgetTokens, `knowledge block within token budget (${estimateTokens(block)})`);
    expect(block.startsWith(`\n${KNOWLEDGE_START_MARKER}`) && block.includes('Do NOT say "I don\'t have information" when the answer is clearly in the excerpts above'), 'block keeps the legacy markers llamaService extracts');
  }
  expect(tokenize('Parking bookings opening').join(' ') === 'park book open', 'light stemming', tokenize('Parking bookings opening'));

  // ── Language detection without an AI call per turn ───────────────────────────
  {
    clearLanguageSessions();
    let llmCalls = 0;
    const llm = async (m: string) => { llmCalls++; return /hola|precio/i.test(m) ? 'es' : 'en'; };
    const d1 = await detectLanguageForSession('s1', 'What are the membership prices for the annual plan?', llm);
    const d2 = await detectLanguageForSession('s1', 'Can I bring a friend to the pool on Saturday?', llm);
    expect(d1.language === 'en' && d2.language === 'en' && llmCalls === 0, 'long English messages → no AI call', { d1, d2, llmCalls });
    const d3 = await detectLanguageForSession('s2', 'Hola, cuál es el precio de la membresía anual?', llm);
    expect(d3.language === 'es' && d3.source === 'llm' && llmCalls === 1, 'foreign Latin-script message → AI detector once', d3);
    const d4 = await detectLanguageForSession('s2', 'Membresia premium Koramangala Whitefield Indiranagar sucursales', llm);
    expect(d4.language === 'es' && d4.source === 'session' && llmCalls === 1, 'unclear follow-up reuses the conversation language', d4);
    const d5 = await detectLanguageForSession('s3', 'kya aap ka gym sunday ko open hai', llm);
    expect(d5.language === 'hinglish' && llmCalls === 1, 'Hinglish still caught by the heuristic', d5);
    expect(!looksConfidentlyEnglish('¿Tienen piscina?'), 'Spanish punctuation is not "confidently English"');
  }

  // ── Date tail ───────────────────────────────────────────────────────────────
  {
    const d = new Date('2026-09-30T10:15:00Z');
    const dayOnly = buildDateTail(false, d);
    const withTime = buildDateTail(true, d);
    expect(dayOnly.includes('2026-09-30') && !/\d{1,2}:\d{2}/.test(dayOnly), 'day-precision date by default', dayOnly);
    expect(/03:45\s?pm/i.test(withTime), 'time included when it matters (IST)', withTime);
    expect(buildDateTail(false, new Date('2026-09-30T03:00:00Z')) === buildDateTail(false, new Date('2026-09-30T17:00:00Z')), 'same text all day (cache-friendly)');
  }

  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll chat-context unit checks passed');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
