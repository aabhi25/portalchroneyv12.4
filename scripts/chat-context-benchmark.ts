/**
 * Website-chat context benchmark: legacy vs retrieval context builder.
 *
 * Seeds a business (40 analyzed website pages, 10 training documents with chunks,
 * 30 FAQs) into a LOCAL throwaway database, then runs sample conversations through the
 * real chatService.streamMessage (plus the widget's language detection) against a fake
 * OpenAI server that records every request. Prints, per turn and mode: prompt tokens
 * of each LLM call, number of LLM / embedding calls, whether the chunk that answers the
 * question reached the model, and how much of the prompt is a cacheable stable prefix.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55485/postgres?sslmode=disable \
 *   CHAT_BENCH_DB=1 npx tsx scripts/chat-context-benchmark.ts [--json]
 *   (against PGlite also set DB_POOL_MAX=1)
 *
 * Tokens are estimated as characters / 4 (no tokenizer package is installed).
 * Fake-model policy: when the prompt tells the model to call tools first it calls
 * get_faqs (then a continuation call answers); otherwise it answers directly.
 */
import crypto from 'crypto';

const url = process.env.DATABASE_URL || '';
if (process.env.CHAT_BENCH_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set CHAT_BENCH_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.OPENAI_API_KEY = 'sk-test-fake';

type Turn = { message: string; fact: string };
export const SCENARIOS: Array<{ name: string; turns: Turn[] }> = [
  { name: 'yoga mat price (page)', turns: [{ message: 'How much does it cost to rent a yoga mat?', fact: 'Yoga mat rental costs' }] },
  { name: 'parking (page + FAQ)', turns: [{ message: 'Where can I park my car when I visit?', fact: 'PK-4417' }] },
  { name: 'student → seniors (follow-up)', turns: [
    { message: 'Do you offer a student discount?', fact: '20%' },
    { message: 'And for seniors?', fact: 'aged 60 and above' },
  ] },
  { name: 'PT cancellation (document chunk)', turns: [{ message: 'How much notice do I need to give to cancel a personal training session?', fact: '48 hours notice' }] },
  { name: 'sauna on Sunday (page)', turns: [{ message: 'Is the sauna open on Sundays?', fact: 'sauna is closed every Sunday' }] },
  { name: 'pool → lessons price (follow-up)', turns: [
    { message: 'Tell me about the swimming pool', fact: '6 lanes' },
    { message: 'how much are the lessons?', fact: '₹3,500 per month' },
  ] },
  { name: 'weekend hours', turns: [{ message: 'What time does the club open on weekends?', fact: '7 am to 8 pm' }] },
  { name: 'instalments (page + FAQ)', turns: [{ message: 'Can I pay for the annual plan in instalments?', fact: 'No-cost EMI' }] },
];

/** Business variants: with FAQs covering most topics, and website + documents only. */
export const BUSINESSES = [
  { name: 'site+docs+FAQs', pages: 40, docs: 10, faqs: 30 },
  { name: 'site+docs, no FAQs', pages: 40, docs: 10, faqs: 0 },
];

export interface TurnResult {
  business: string; mode: string; scenario: string; turn: number; message: string;
  llmCalls: number; embeddingCalls: number; callBreakdown: string;
  promptTokens: number; maxCallTokens: number; answerCallTokens: number;
  factIncluded: boolean; stablePrefixTokens: number | null; answer: string;
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

export async function runBenchmark(opts: { quiet?: boolean } = {}): Promise<TurnResult[]> {
  const { startFakeOpenAIChat, promptTokens, promptText } = await import('../server/services/__tests__/helpers/fakeOpenAIChat');
  const fake = await startFakeOpenAIChat();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import('../server/db');
  const schema = await import('../shared/schema');
  const { seedChatBusiness } = await import('../server/services/__tests__/helpers/chatContextSeed');
  const { chatService } = await import('../server/chatService');
  const { setChatContextModeOverride } = await import('../server/services/chatContext/config');
  const { detectWidgetLanguage, clearLanguageSessions } = await import('../server/services/chatContext/languageSession');
  const { ensurePassageVectors } = await import('../server/services/chatContext/passageVectors');
  const { buildBusinessProfile } = await import('../server/services/chatContext/businessProfile');
  const { embeddingService } = await import('../server/services/embeddingService');

  const { vectorSearchService } = await import('../server/services/vectorSearchService');
  const results: TurnResult[] = [];
  for (const biz of BUSINESSES) {
    const tag = crypto.randomBytes(3).toString('hex');
    const { accountId } = await seedChatBusiness(db, schema, { tag, pages: biz.pages, docs: biz.docs, faqs: biz.faqs });
    const account = (await db.select().from(schema.businessAccounts).where((await import('drizzle-orm')).eq(schema.businessAccounts.id, accountId)))[0];

    // Pre-embed page/doc-summary passages (in production this happens in the background
    // on the first turn; the benchmark measures the steady state).
    {
      const { storage } = await import('../server/storage');
      const { websiteAnalysisService } = await import('../server/websiteAnalysisService');
      const profile = buildBusinessProfile({
        companyDescription: account.description,
        website: await websiteAnalysisService.getAnalyzedContent(accountId),
        pages: await storage.getAnalyzedPages(accountId),
        docs: await storage.getTrainingDocuments(accountId),
      });
      await ensurePassageVectors(accountId, profile.passages, texts => embeddingService.generateBatchEmbeddings(texts, accountId));
    }

    for (const mode of ['legacy', 'retrieval'] as const) {
      setChatContextModeOverride(mode);
      clearLanguageSessions();
      // Each mode starts with cold query-embedding / search caches (passage vectors stay warm).
      (embeddingService as any).embeddingCache?.clear?.();
      (vectorSearchService as any).embeddingCache?.clear?.();
      (vectorSearchService as any).resultCache?.clear?.();
      for (const sc of SCENARIOS) {
        const userId = `bench_${mode}_${crypto.randomBytes(4).toString('hex')}`;
        let prevMainPrompt: string | null = null;
        for (let t = 0; t < sc.turns.length; t++) {
          const turn = sc.turns[t];
          fake.reset();
          const lang = await detectWidgetLanguage(accountId, userId, turn.message, 'sk-test-fake');
          let answer = '';
          for await (const ev of chatService.streamMessage(turn.message, {
            userId, businessAccountId: accountId, personality: 'friendly', responseLength: 'balanced',
            companyDescription: account.description || '', openaiApiKey: 'sk-test-fake', currency: 'INR', currencySymbol: '₹',
            preferredLanguage: lang, channel: 'widget', supportsCalendarUI: true, systemMode: 'full',
          } as any)) {
            if ((ev as any).type === 'final' || (ev as any).type === 'content') answer = String((ev as any).data || answer);
          }
          const chats = fake.calls.filter(c => c.kind === 'chat');
          const embeds = fake.calls.filter(c => c.kind === 'embedding');
          const answering = [...chats].reverse().find(c => c.purpose === 'main' || c.purpose === 'continuation');
          const main = chats.find(c => c.purpose === 'main');
          const mainSerialized = main ? JSON.stringify(main.messages.slice(0, -1)) : null; // without the final override
          const stable = prevMainPrompt && mainSerialized ? Math.floor(commonPrefixLength(prevMainPrompt, mainSerialized) / 4) : null;
          prevMainPrompt = mainSerialized;
          const breakdown = chats.map(c => c.purpose).reduce<Record<string, number>>((m, p) => { m[p] = (m[p] || 0) + 1; return m; }, {});
          results.push({
            business: biz.name, mode, scenario: sc.name, turn: t + 1, message: turn.message,
            llmCalls: chats.length, embeddingCalls: embeds.length,
            callBreakdown: Object.entries(breakdown).map(([k, v]) => `${k}×${v}`).join(' '),
            promptTokens: chats.reduce((n, c) => n + promptTokens(c), 0),
            maxCallTokens: Math.max(0, ...chats.map(promptTokens)),
            answerCallTokens: answering ? promptTokens(answering) : 0,
            factIncluded: answering ? promptText(answering).includes(turn.fact) : false,
            stablePrefixTokens: stable,
            answer,
          });
          // Let fire-and-forget work (title, lead capture) settle before the next turn.
          await new Promise(r => setTimeout(r, 150));
        }
      }
    }
  }
  setChatContextModeOverride(null);
  await fake.close();

  if (!opts.quiet) printReport(results);
  return results;
}

function pad(s: any, n: number) { const t = String(s); return t.length >= n ? t.slice(0, n) : t + ' '.repeat(n - t.length); }

function printReport(results: TurnResult[]) {
  for (const biz of BUSINESSES) printBusiness(biz.name, results.filter(r => r.business === biz.name));
}

function printBusiness(name: string, results: TurnResult[]) {
  console.log(`\n######## Business: ${name} ########`);
  console.log('\n=== Per turn ===');
  console.log(pad('mode', 10) + pad('scenario', 34) + pad('turn', 5) + pad('LLM', 5) + pad('emb', 5) + pad('prompt tok', 11) + pad('answer-call tok', 16) + pad('fact in prompt', 15) + pad('stable prefix tok', 18) + 'calls');
  for (const r of results) {
    console.log(pad(r.mode, 10) + pad(r.scenario, 34) + pad(r.turn, 5) + pad(r.llmCalls, 5) + pad(r.embeddingCalls, 5) + pad(r.promptTokens, 11) + pad(r.answerCallTokens, 16) + pad(r.factIncluded ? 'yes' : 'NO', 15) + pad(r.stablePrefixTokens ?? '-', 18) + r.callBreakdown);
  }
  console.log('\n=== Summary (mean per turn) ===');
  for (const mode of ['legacy', 'retrieval']) {
    const rs = results.filter(r => r.mode === mode);
    const avg = (f: (r: TurnResult) => number) => Math.round(rs.reduce((n, r) => n + f(r), 0) / rs.length);
    const fu = rs.filter(r => r.turn > 1);
    console.log(`${pad(mode, 10)} turns=${rs.length}  LLM calls/turn=${(rs.reduce((n, r) => n + r.llmCalls, 0) / rs.length).toFixed(2)}  embedding calls/turn=${(rs.reduce((n, r) => n + r.embeddingCalls, 0) / rs.length).toFixed(2)}  prompt tokens/turn=${avg(r => r.promptTokens)}  largest call=${Math.max(...rs.map(r => r.maxCallTokens))}  answer-call tokens=${avg(r => r.answerCallTokens)}  fact reached model=${rs.filter(r => r.factIncluded).length}/${rs.length}  follow-up facts=${fu.filter(r => r.factIncluded).length}/${fu.length}  stable prefix on turn 2=${fu.map(r => r.stablePrefixTokens).join(',')}`);
  }
}

if (process.argv[1] && /chat-context-benchmark/.test(process.argv[1])) {
  runBenchmark({ quiet: process.argv.includes('--json') })
    .then(r => { if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch(err => { console.error(err); process.exit(1); });
}
