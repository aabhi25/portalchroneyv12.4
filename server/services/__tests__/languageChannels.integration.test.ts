/**
 * Reply language end to end against a local (throwaway) Postgres and a FAKE OpenAI server:
 *   - settings API (own account, super admin ?businessAccountId=, no cross-account edits,
 *     validation 400, audit row);
 *   - "any language": the website chat prompts are identical to before this feature;
 *   - restricted: the rule reaches the main call AND the tool-continuation call, after the
 *     business's own instructions; the "I can help in…" note once;
 *   - website safety check: a wrong-language reply is replaced (`final`) and stored corrected;
 *   - fixed texts translated only when a rule is in force; widget payload.
 * No real OpenAI calls.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55490/postgres?sslmode=disable \
 *   LANGUAGE_TEST_DB=1 DB_POOL_MAX=1 npx tsx server/services/__tests__/languageChannels.integration.test.ts
 */
import crypto from 'crypto';

const url = process.env.DATABASE_URL || '';
if (process.env.LANGUAGE_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set LANGUAGE_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.OPENAI_API_KEY = 'sk-test-fake';
process.env.TOPSCHOLAR_ACCOUNT_ID = crypto.randomUUID();
delete process.env.CHAT_CONTEXT_MODE;
delete process.env.CHAT_CONTEXT_LEGACY_ACCOUNTS;

let failed = 0;
let passed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 700)}` : ''}`); }
  else { passed++; console.log(`✓ ${label}`); }
}
const stripClock = (s: string) => s
  .replace(/CURRENT DATE[^\n]*\n[^\n]*\n/g, '')
  .replace(/Today is [^\n]*/g, '')
  .replace(/\d{1,2}:\d{2}\s?(am|pm|AM|PM)?/g, '')
  .replace(/- (Date|Time): [^\n]*/g, '');

async function main() {
  const { startFakeOpenAIChat } = await import('./helpers/fakeOpenAIChat');
  const fake = await startFakeOpenAIChat();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq, and, desc } = await import('drizzle-orm');
  const { seedChatBusiness } = await import('./helpers/chatContextSeed');
  const { chatService } = await import('../../chatService');
  const { createSession } = await import('../../auth');
  const aiLanguageRoutes = (await import('../../routes/aiLanguage')).default;
  const L = await import('../language/languagePolicy');
  const C = await import('../language/chatLanguage');
  const T = await import('../language/languageText');

  const tag = crypto.randomBytes(3).toString('hex');
  const A = await seedChatBusiness(db, schema, { tag, pages: 6, docs: 2, faqs: 6 });
  const [bizB] = await db.insert(schema.businessAccounts).values({ name: `Other ${tag}`, website: 'https://other.example' } as any).returning();
  const [userB] = await db.insert(schema.users).values({ username: `lang_b_${tag}`, passwordHash: 'x', role: 'business_user', businessAccountId: bizB.id } as any).returning();
  const [admin] = await db.insert(schema.users).values({ username: `lang_admin_${tag}`, passwordHash: 'x', role: 'super_admin', businessAccountId: null } as any).returning();

  // ── 1. settings API ────────────────────────────────────────────────────────
  {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(aiLanguageRoutes);
    const server = await new Promise<any>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const sA = await createSession(A.userId), sB = await createSession(userB.id), sAdmin = await createSession(admin.id);
    const call = async (session: string | null, method: string, path: string, body?: unknown) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { ...(session ? { cookie: `session=${session}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, json: await res.json().catch(() => null) as any };
    };
    const restricted = { ...L.normalizeLanguageSettings({}), mode: 'restricted', allowed: ['en', 'hi'], defaultLanguage: 'en' };

    const unauth = await call(null, 'GET', '/api/ai-language-settings');
    expect(unauth.status === 401, 'settings API: signed-out → 401', unauth.status);
    const g = await call(sA, 'GET', '/api/ai-language-settings');
    expect(g.status === 200 && g.json?.settings?.mode === 'any' && Array.isArray(g.json?.languages) && g.json.languages.length === 30, 'GET: default "any language" + the 30-language catalogue', g.json?.settings);
    const p = await call(sA, 'PUT', '/api/ai-language-settings', { settings: restricted });
    expect(p.status === 200 && p.json?.settings?.mode === 'restricted', 'PUT: business user saves their own account', p);
    const [rowA] = await db.select().from(schema.aiLanguageSettings).where(eq(schema.aiLanguageSettings.businessAccountId, A.accountId));
    expect((rowA?.settings as any)?.allowed?.join() === 'en,hi' && rowA?.updatedBy === A.userId, 'saved row for account A (updatedBy = the user)', rowA);
    const audit = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.action, 'ai_language.settings_updated'), eq(schema.auditEvents.businessAccountId, A.accountId))).orderBy(desc(schema.auditEvents.occurredAt)).limit(1);
    expect(audit.length === 1 && (audit[0].metadata as any)?.newMode === 'restricted' && audit[0].actorUserId === A.userId, 'audit row written (old/new mode, actor)', audit[0]);

    const cross = await call(sA, 'PUT', `/api/ai-language-settings?businessAccountId=${bizB.id}`, { settings: { ...restricted, allowed: ['ta'], defaultLanguage: 'ta' } });
    const [rowB0] = await db.select().from(schema.aiLanguageSettings).where(eq(schema.aiLanguageSettings.businessAccountId, bizB.id));
    const [rowA1] = await db.select().from(schema.aiLanguageSettings).where(eq(schema.aiLanguageSettings.businessAccountId, A.accountId));
    expect(cross.status === 200 && !rowB0 && (rowA1?.settings as any)?.allowed?.join() === 'ta', 'business user cannot edit another account (?businessAccountId ignored → own account)', { rowB0, a: (rowA1?.settings as any)?.allowed });

    const bad = await call(sA, 'PUT', '/api/ai-language-settings', { settings: { ...restricted, allowed: ['hi'], defaultLanguage: 'en' } });
    expect(bad.status === 400 && /default language must be one of/.test(bad.json?.error || ''), 'validation error → 400 with a plain message', bad);
    const bad2 = await call(sA, 'PUT', '/api/ai-language-settings', { settings: { ...restricted, allowed: [] } });
    expect(bad2.status === 400 && /at least one/i.test(bad2.json?.error || ''), 'restricted with no languages → 400', bad2);
    const bad3 = await call(sA, 'PUT', '/api/ai-language-settings', { settings: { ...restricted, hacker: true } });
    expect(bad3.status === 400, 'unknown fields rejected (400)', bad3);

    const sa = await call(sAdmin, 'PUT', `/api/ai-language-settings?businessAccountId=${bizB.id}`, { settings: { ...restricted, allowed: ['hi'], defaultLanguage: 'hi' } });
    const [rowB] = await db.select().from(schema.aiLanguageSettings).where(eq(schema.aiLanguageSettings.businessAccountId, bizB.id));
    expect(sa.status === 200 && (rowB?.settings as any)?.defaultLanguage === 'hi', 'super admin edits another account with ?businessAccountId=', rowB);
    const saGet = await call(sAdmin, 'GET', `/api/ai-language-settings?businessAccountId=${bizB.id}`);
    expect(saGet.json?.settings?.allowed?.join() === 'hi', 'super admin reads that account', saGet.json?.settings);
    const bGet = await call(sB, 'GET', '/api/ai-language-settings');
    expect(bGet.json?.settings?.allowed?.join() === 'hi', 'that account’s own user sees the change', bGet.json?.settings);

    // back to "any language" for the chat checks
    await L.saveLanguageSettings(A.accountId, L.normalizeLanguageSettings({}), null);
    await new Promise<void>((r) => server.close(() => r()));
  }

  // ── chat helpers ───────────────────────────────────────────────────────────
  const baseCtx = (userId: string, extra: Record<string, any> = {}) => ({
    userId, businessAccountId: A.accountId, personality: 'friendly', responseLength: 'balanced', companyDescription: '',
    openaiApiKey: 'sk-test-fake', currency: 'INR', currencySymbol: '₹', channel: 'widget', supportsCalendarUI: true, systemMode: 'full',
    ...extra,
  });
  async function turn(userId: string, message: string, extra: Record<string, any> = {}) {
    fake.reset();
    const events: any[] = [];
    for await (const ev of chatService.streamMessage(message, baseCtx(userId, extra) as any)) events.push(ev);
    await new Promise((r) => setTimeout(r, 150));
    const chats = fake.calls.filter((c) => c.kind === 'chat');
    const lastSys = (call: any) => call ? String([...call.messages].reverse().find((m: any) => m.role === 'system')?.content || '') : '';
    const main = chats.find((c) => c.purpose === 'main');
    const cont = chats.find((c) => c.purpose === 'continuation');
    const finals = events.filter((e) => e.type === 'final').map((e) => String(e.data));
    const conversationId = String(events.find((e) => e.type === 'conversation_id')?.data || '');
    return {
      events, chats, main, cont, finals, conversationId,
      mainRules: stripClock(lastSys(main)), contRules: stripClock(lastSys(cont)), mainSys0: stripClock(String(main?.messages[0]?.content || '')),
      rewrites: fake.calls.filter((c) => !c.stream && /Rewrite the assistant reply below entirely in/.test(String(c.messages[0]?.content || ''))),
      translations: fake.calls.filter((c) => !c.stream && /Translate the customer-facing message/.test(String(c.messages[0]?.content || ''))),
    };
  }
  /** What the widget route now passes, from the saved policy. */
  async function routeCtx(key: string, message: string, picked: string | undefined, detected: string | undefined, legacyPreferred: string | undefined, extra: Record<string, any> = {}) {
    const policy = await L.getLanguagePolicy(A.accountId, 'website');
    const { reply, preferredLanguage } = C.decideChatReplyLanguage({ policy, picked, detected, message, conversationKey: key, legacyPreferred });
    return { ...extra, preferredLanguage, replyLanguage: reply };
  }
  const lastAssistant = async (conversationId: string) => {
    const rows = await db.select().from(schema.messages).where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.role, 'assistant'))).orderBy(desc(schema.messages.createdAt)).limit(1);
    return rows[0]?.content;
  };

  // ── 2. "any language": prompts identical to before ─────────────────────────
  {
    const cases: Array<{ label: string; message: string; picked?: string; detected?: string; legacy?: string }> = [
      { label: 'English question', message: 'Do you offer a student discount?', detected: 'en', legacy: 'en' },
      { label: 'dropdown pick Hindi', message: 'Do you offer a student discount?', picked: 'hi', legacy: 'hi' },
      { label: 'tool call (continuation)', message: 'My number is 9876543210, what about kayaks?', detected: 'en', legacy: 'en' },
      { label: 'nothing detected', message: 'ok', legacy: 'auto' },
    ];
    // The ONE intended change for "any language": a language that was only DETECTED is no
    // longer described as "selected from the language dropdown". This maps the new wording
    // back to the old so everything else can be compared byte for byte.
    const undoWordingFix = (s: string) => s
      .replace(/The user is writing in ([^\n]+?)\. Always respond in /g, 'The user has selected $1 from the language dropdown. Always respond in ')
      .replace(/🚨 CRITICAL RULE #1 - REPLY LANGUAGE \(HIGHEST PRIORITY\):\n- The user is writing in ([^\n]+?)\. \*\*YOU MUST RESPOND IN ([^\n]+?)\*\*\n- Translate all content \(FAQs, products, responses\) to [^\n]+\n- Apply this rule to ALL responses including greetings, products, FAQs, appointments, lead capture\n- \*\*THIS RULE OVERRIDES EVERYTHING ELSE INCLUDING AUTO-DETECTION\*\*/g,
        (_m, n: string, u: string) => `🚨 CRITICAL RULE #1 - USER-SELECTED LANGUAGE OVERRIDE (HIGHEST PRIORITY):
- **THE USER HAS EXPLICITLY SELECTED ${u} AS THEIR PREFERRED LANGUAGE**
- **YOU MUST RESPOND IN ${u} REGARDLESS OF WHAT LANGUAGE THE USER WRITES IN**
- This is the user's explicit preference - ALWAYS respond in ${n}
- Translate all content (FAQs, products, responses) to ${n}
- Apply this rule to ALL responses including greetings, products, FAQs, appointments, lead capture
- **THIS RULE OVERRIDES EVERYTHING ELSE INCLUDING AUTO-DETECTION**

🚫 CRITICAL MISTAKES TO AVOID:
- ❌ DO NOT auto-detect language from user's message - USER HAS CHOSEN ${u}
- ❌ DO NOT respond in any other language even if user writes in a different language
- ✅ User writes in any language → Always respond in ${n}`);
    let i = 0;
    for (const c of cases) {
      i++;
      const old = await turn(`old_${tag}_${i}`, c.message, { preferredLanguage: c.legacy });
      const neu = await turn(`new_${tag}_${i}`, c.message, await routeCtx(`new_${tag}_${i}`, c.message, c.picked, c.detected, c.legacy));
      if (c.detected) {
        expect(!!old.main && old.mainRules !== neu.mainRules && old.mainRules === undoWordingFix(neu.mainRules), `any language — ${c.label}: final rules identical except "selected from the dropdown" → "is writing in"`, { old: old.mainRules.length, neu: neu.mainRules.length });
        expect(old.mainSys0 === undoWordingFix(neu.mainSys0), `any language — ${c.label}: first system prompt identical except that wording`);
        expect(old.contRules === undoWordingFix(neu.contRules), `any language — ${c.label}: continuation final rules identical except that wording${old.cont ? '' : ' (no tool call)'}`);
      } else {
        expect(!!old.main && old.mainRules === neu.mainRules, `any language — ${c.label}: final rules byte-identical`, { old: old.mainRules.length, neu: neu.mainRules.length });
        expect(old.mainSys0 === neu.mainSys0, `any language — ${c.label}: first system prompt byte-identical`);
        expect(old.contRules === neu.contRules, `any language — ${c.label}: continuation final rules byte-identical${old.cont ? '' : ' (no tool call)'}`);
      }
      expect(neu.rewrites.length === 0 && neu.translations.length === 0 && neu.chats.length === old.chats.length, `any language — ${c.label}: no extra AI calls`, { old: old.chats.length, neu: neu.chats.length });
      if (c.label === 'tool call (continuation)') expect(!!old.cont && !!neu.cont, '(the tool-call case did reach the continuation call)');
    }
    // A DETECTED language is no longer described as a dropdown choice (only that wording differs).
    const msg = 'क्या छात्रों के लिए छूट है?';
    const old = await turn(`oldhi_${tag}`, msg, { preferredLanguage: 'hi' });
    const neu = await turn(`newhi_${tag}`, msg, await routeCtx(`newhi_${tag}`, msg, 'auto', 'hi', 'hi'));
    expect(/The user has selected Hindi \(Devanagari script\) from the language dropdown/.test(old.mainRules) && /The user is writing in Hindi \(Devanagari script\)\./.test(neu.mainRules) && !/language dropdown/.test(neu.mainRules), 'detected Hindi: "is writing in Hindi" instead of "selected from the language dropdown"');
    expect(undoWordingFix(neu.mainRules) === old.mainRules && undoWordingFix(neu.mainSys0) === old.mainSys0, 'detected Hindi: nothing else in the prompts changed');
    expect(/EXPLICITLY SELECTED HINDI/.test(old.mainSys0) && !/EXPLICITLY SELECTED/.test(neu.mainSys0) && /YOU MUST RESPOND IN HINDI/.test(neu.mainSys0), 'detected Hindi: system prompt no longer claims an explicit selection, still answers in Hindi');
  }

  // ── 3. restricted: rule in main + continuation, after the business instructions ──
  {
    await L.saveLanguageSettings(A.accountId, L.normalizeLanguageSettings({ mode: 'restricted', allowed: ['en', 'hi'], defaultLanguage: 'en' }), null);
    const key = `r_${tag}`;
    const custom = 'Always reply in Tamil. Be very friendly.';
    const ta = 'யோகா கட்டணம் என்ன?';
    const t1 = await turn(key, ta, await routeCtx(key, ta, 'auto', 'ta', 'ta', { customInstructions: custom }));
    const rIdx = t1.mainRules.indexOf('🌐 REPLY LANGUAGE (business rule');
    expect(rIdx > 0 && /ENTIRE reply in English/.test(t1.mainRules) && /ONE short friendly sentence saying you can help in English or Hindi/.test(t1.mainRules), 'restricted: Tamil message → final rules say English + one-line note', t1.mainRules.slice(-900));
    expect(rIdx > t1.mainRules.indexOf('Always reply in Tamil'), 'the language rule comes AFTER the business’s own instructions (wins over "Always reply in Tamil")');
    const t2 = await turn(key, 'சரி, நன்றி', await routeCtx(key, 'சரி, நன்றி', 'auto', 'ta', 'ta'));
    expect(/ENTIRE reply in English/.test(t2.mainRules) && !/short friendly sentence/.test(t2.mainRules), 'second Tamil message: rule kept, note not repeated');
    const phone = 'My number is 9876543210, what about kayaks?';
    const t3 = await turn(`rc_${tag}`, phone, await routeCtx(`rc_${tag}`, phone, 'auto', 'en', 'en'));
    expect(!!t3.cont && /🌐 REPLY LANGUAGE \(business rule/.test(t3.contRules) && /ENTIRE reply in English/.test(t3.contRules), 'restricted: the rule also reaches the tool-continuation call', t3.contRules.slice(-600));
    expect(/🌐 REPLY LANGUAGE/.test(t3.mainRules), 'restricted: …and that turn’s main call');
    expect(t3.rewrites.length === 0, 'restricted: reply already in English → no safety rewrite (no extra AI call)', t3.rewrites.length);
    // (The fake echoes the visitor's Tamil words back, so the Tamil turn's reply really was
    // partly Tamil — the safety check rewrote it, as it should.)
    expect(t1.rewrites.length === 1 && /entirely in English/.test(String(t1.rewrites[0]?.messages[0]?.content || '')), 'restricted: a reply containing Tamil is rewritten in English', t1.rewrites.length);
  }

  // ── 4. website safety check: replace + persist the corrected reply ─────────
  {
    await L.saveLanguageSettings(A.accountId, L.normalizeLanguageSettings({ mode: 'restricted', allowed: ['hi'], defaultLanguage: 'hi' }), null);
    const q = 'What are your opening hours on weekends?';
    const s1 = await turn(`s_${tag}`, q, await routeCtx(`s_${tag}`, q, 'auto', 'en', 'en'));
    const contentIdx = s1.events.findIndex((e) => e.type === 'content');
    const finalIdx = s1.events.findIndex((e) => e.type === 'final');
    expect(s1.rewrites.length === 1 && /entirely in Hindi/.test(String(s1.rewrites[0].messages[0].content)), 'Hindi-only: the English reply is sent for a rewrite in Hindi (one call)', s1.rewrites.length);
    expect(contentIdx >= 0 && finalIdx > contentIdx && s1.finals[s1.finals.length - 1] === 'OK', 'streamed reply is replaced by a `final` event carrying the rewritten text', s1.events.map((e) => e.type));
    expect(await lastAssistant(s1.conversationId) === 'OK', 'the rewritten reply is what is stored in the conversation', await lastAssistant(s1.conversationId));
    const phone = 'My number is 9876543211, what about kayaks?';
    const s2 = await turn(`s2_${tag}`, phone, await routeCtx(`s2_${tag}`, phone, 'auto', 'en', 'en'));
    expect(!!s2.cont && s2.rewrites.length === 1 && s2.finals[s2.finals.length - 1] === 'OK', 'tool path: the continuation reply is rewritten too and sent as `final`', { cont: !!s2.cont, rewrites: s2.rewrites.length, finals: s2.finals });
    expect(await lastAssistant(s2.conversationId) === 'OK', 'tool path: corrected text stored', await lastAssistant(s2.conversationId));
    const v = await turn(`sv_${tag}`, q, { ...(await routeCtx(`sv_${tag}`, q, 'auto', 'en', 'en')), voiceResponseStyle: true, deferAssistantPersistence: true });
    expect(v.rewrites.length === 0, 'voice turns are never rewritten (a spoken answer cannot be taken back)');

    // fixed texts
    const ctxHi = baseCtx(`fx_${tag}`, await routeCtx(`fx_${tag}`, 'hello', 'auto', 'en', 'en')) as any;
    fake.reset();
    T.resetLanguageTextCacheForTesting();
    const fx = await (chatService as any).fixedText(ctxHi, 'Thank you for sharing your details!');
    const fxCalls = fake.calls.filter((c) => !c.stream && /Translate the customer-facing message/.test(String(c.messages[0]?.content || '')));
    expect(fx === 'OK' && fxCalls.length === 1 && /Hindi/.test(String(fxCalls[0].messages[0].content)), 'fixed text: translated into Hindi when the rule is in force (fake answers "OK")', { fx, calls: fxCalls.length });
    await (chatService as any).fixedText(ctxHi, 'Thank you for sharing your details!');
    expect(fake.calls.filter((c) => !c.stream).length === 1, 'fixed text: cached (no second call)');
    const already = await (chatService as any).fixedText(ctxHi, 'आपका आवेदन सफलतापूर्वक जमा हो गया है, धन्यवाद।');
    expect(already.startsWith('आपका') && fake.calls.filter((c) => !c.stream).length === 1, 'fixed text already in Hindi → no call');

    expect(JSON.stringify(C.publicReplyLanguages(await L.getLanguagePolicy(A.accountId, 'website'))) === JSON.stringify({ restricted: true, allowed: ['hi'], defaultLanguage: 'hi' }), 'widget payload from the saved setting: allowed + default only');

    await L.saveLanguageSettings(A.accountId, L.normalizeLanguageSettings({}), null);
    fake.reset();
    const plain = await (chatService as any).fixedText(baseCtx(`fx2_${tag}`, await routeCtx(`fx2_${tag}`, 'hello', 'hi', undefined, 'hi')) as any, 'Thank you for sharing your details!');
    expect(plain === 'Thank you for sharing your details!' && fake.calls.length === 0, 'any language (even with a dropdown pick): fixed texts unchanged, no call');
    expect(C.publicReplyLanguages(await L.getLanguagePolicy(A.accountId, 'website')) === null, 'widget payload: null again after switching back to any language');
  }

  await fake.close();
  if (failed) { console.error(`\n${failed} check(s) failed, ${passed} passed`); process.exit(1); }
  console.log(`\nAll ${passed} language integration checks passed.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
