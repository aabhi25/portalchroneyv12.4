/**
 * Website-chat Smart Lead Training — pure logic (no database, no AI calls):
 * phone normalisation, the phone-number gate, name/decline/keyword detectors, the per-field timing
 * resolver (priority across strategies, per-field customAskAfter, optional/mandatory caps, keyword
 * pending, WhatsApp confirm, callbacks) and the per-conversation state transitions.
 *
 * Run: `npx tsx server/services/__tests__/leadCaptureResolver.test.ts`
 */
process.env.DATABASE_URL ||= "postgresql://unused@127.0.0.1:1/unused";
const { validatePhoneNumber } = await import("../../../shared/validation/phone");
const { buildPhoneValidationOverride, buildLeadTrainingPrompt } = await import("../leadTrainingPrompt");
const lc = await import("../leadCapture");
const { nameStatedInChat } = await import("../../llamaService");

let failed = 0;
let passed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); }
  else { passed++; console.log(`✓ ${label}`); }
}
const u = (content: string) => ({ role: 'user' as const, content });
const a = (content: string) => ({ role: 'assistant' as const, content });

// ─── Phone validation (item 2) ────────────────────────────────────────────────
{
  // (9876543210 itself is rejected as a sequential junk number, so a realistic one is used.)
  const ok10 = ['+91 98450 12345', '+919845012345', '919845012345', '09845012345', '9845012345', '98450-12345', '(98450) 12345', '0091 98450 12345', '+91-98450-12345'];
  for (const p of ok10) {
    const r = validatePhoneNumber(p, '10');
    expect(r.isValid && r.normalized === '9845012345', `10-digit mode accepts "${p}" → 9845012345`, r);
  }
  for (const p of ['984501234', '98450123451', '12345', '5845012345', '9999999999', '9876543210', '+1 415 555 0134']) {
    expect(!validatePhoneNumber(p, '10').isValid, `10-digit mode rejects "${p}"`, validatePhoneNumber(p, '10').reasonCode);
  }
  const r12 = validatePhoneNumber('+91 98450 12345', '12');
  expect(r12.isValid && r12.normalized === '+919845012345', "12-digit mode: '+91 98450 12345' → +919845012345", r12);
  expect(!validatePhoneNumber('9845012345', '12').isValid, '12-digit mode rejects a 10-digit number without country code');
  expect(validatePhoneNumber('98450123', '8-12').isValid, "8-12 mode accepts 8 digits");
  expect(validatePhoneNumber('+44 7911 123456', 'any').normalized === '+447911123456', "'any' keeps + and digits");
}

// ─── Phone gate: dates / budgets / ids never trigger (item 1) ─────────────────
const cfgPhone10: any = { fields: [{ id: 'mobile', enabled: true, required: true, priority: 1, captureStrategy: 'custom', phoneValidation: '10' }] };
const cfgNoPhone: any = { fields: [{ id: 'name', enabled: true, required: true, priority: 1, captureStrategy: 'start' }, { id: 'mobile', enabled: false, required: false, priority: 2, captureStrategy: 'start' }] };
{
  const never = [
    'I want to join on 15-10-2026', 'my budget is 1500000', 'budget ₹15,00,000', 'around 1500000 rupees', '15 lakh is my budget',
    'order id 123456789', 'my order number is 98765432', 'ORD123456789 not delivered', '#12345678 status?', 'pin code 560034',
    'I scored 87.50 percent', 'batch 2023-2024', 'fees 250000/-',
  ];
  for (const m of never) expect(buildPhoneValidationOverride(m, cfgPhone10, { phoneMissing: true }) === null, `no "invalid number" for: "${m}"`);
  expect(buildPhoneValidationOverride('1500000', cfgPhone10, { phoneMissing: true, lastAssistantMessage: "What's your budget?" }) === null, 'bare 1500000 after a budget question is not a phone attempt');
  expect(buildPhoneValidationOverride('my number is 98765 4321', cfgNoPhone, { phoneMissing: true }) === null, 'no phone field enabled → never');
  expect(buildPhoneValidationOverride('my number is 98765 4321', cfgPhone10, { phoneMissing: false }) === null, 'phone already saved → never');
  expect(buildPhoneValidationOverride('my number is 98765 4321', cfgPhone10, { phoneMissing: true }) !== null, '"my number is 98765 4321" (9 digits) → rejected');
  expect(buildPhoneValidationOverride('987654321', cfgPhone10, { phoneMissing: true }) !== null, 'bare 9-digit number → rejected');
  expect(buildPhoneValidationOverride('98765432101', cfgPhone10, { phoneMissing: true }) !== null, 'bare 11 random digits → rejected');
  expect(buildPhoneValidationOverride('98765 432', cfgPhone10, { phoneMissing: true, assistantAskedForPhone: true }) !== null, 'short number right after the bot asked for the phone → rejected');
  for (const ok of ['+91 98450 12345', '09845012345', 'my mobile is 98450-12345', '919845012345']) {
    expect(buildPhoneValidationOverride(ok, cfgPhone10, { phoneMissing: true, assistantAskedForPhone: true }) === null, `valid number not rejected: "${ok}"`);
  }
}

// ─── Names (items 3, 13) ──────────────────────────────────────────────────────
{
  const yes: Array<[string, string]> = [
    ['my name is rahul sharma', 'Rahul Sharma'], ["I'm Rahul", 'Rahul'], ['mera naam Rahul hai', 'Rahul'], ['mera naam hai Priya Singh', 'Priya Singh'],
    ['main Rahul hoon', 'Rahul'], ['mai amit kumar hu', 'Amit Kumar'], ['naam: Kavya', 'Kavya'], ['मेरा नाम राहुल है', 'राहुल'],
  ];
  for (const [m, want] of yes) expect(lc.nameInMessage(m) === want, `name in "${m}" → ${want}`, lc.nameInMessage(m));
  const no = ["I'm interested in MBA", 'I am a student', "I'm looking for laptops", 'call me back', 'main theek hoon', 'main delhi se hoon',
    'I am from Pune', 'what is the fee?', 'main MBA karna chahta hoon', 'naam kya hai aapka?'];
  for (const m of no) expect(lc.nameInMessage(m) === null, `not a name: "${m}"`, lc.nameInMessage(m));
  expect(nameStatedInChat([u('hi'), a('May I have your name?'), u('mera naam Rahul hai')] as any) === 'Rahul', 'nameStatedInChat understands Hinglish');
  for (const junk of ['ok', 'no', 'yes', 'nahi', 'hi', 'thanks', 'I want to know the fees', 'Rahul123', 'test@x.com']) {
    expect(!lc.isValidLeadName(junk), `junk name rejected: "${junk}"`);
  }
  expect(lc.isValidLeadName('Anil Kumar') && lc.isValidLeadName("D'Souza") && lc.isValidLeadName('राहुल'), 'real names accepted');
  expect(lc.assistantAskedForNameIn('Aapka naam kya hai?') && lc.assistantAskedForNameIn('May I know your name?'), 'assistant name asks detected (EN + Hinglish)');
  expect(!lc.assistantAskedForNameIn('Thanks for sharing your name, Rahul!'), 'thank-you for a name is not an ask');
}

// ─── Declines, keywords, asked fields ────────────────────────────────────────
{
  for (const m of ['no', 'No thanks', 'not now', "I don't want to share", 'skip', 'nahi', 'mat poocho', 'number nahi dunga', 'why do you need my number?', 'abhi nahi', 'नहीं']) {
    expect(lc.isDecline(m), `decline: "${m}"`);
  }
  for (const m of ['Rahul', 'what is the fee?', 'naam Rahul hai', 'is there no entrance exam?', 'know more about MBA']) {
    expect(!lc.isDecline(m), `not a decline: "${m}"`);
  }
  expect(lc.matchKeywords('is it priceless?', ['price']).length === 0, 'keyword "price" does not match "priceless"');
  expect(lc.matchKeywords('I love coffee', ['fee']).length === 0, 'keyword "fee" does not match "coffee"');
  expect(lc.matchKeywords('price?', ['price']).length === 1, 'keyword "price" matches "price?"');
  expect(lc.matchKeywords('what are the fees', ['fee']).length === 1, 'keyword "fee" matches plural "fees"');
  expect(lc.matchKeywords('tell me about the Admission   Process please', ['admission process']).length === 1, 'multi-word keyword (case/space-insensitive)');
  expect(lc.matchKeywords('फीस कितनी है?', ['फीस']).length === 1, 'Hindi keyword matches');
  expect(lc.matchKeywords('fees kitni hai', ['kitni']).length === 1, 'Hinglish keyword matches');
  const asked = lc.assistantAskedFields('Great question! Could you share your mobile number so the team can send details?');
  expect(asked.has('mobile') && asked.size === 1, 'asked mobile detected', Array.from(asked));
  expect(lc.assistantAskedFields('Is 98xxxx also on WhatsApp?').has('whatsapp'), 'WhatsApp confirmation detected');
  expect(lc.assistantAskedFields('Thanks Rahul! The MBA fee is ₹2L.').size === 0, 'no ask in a plain answer');
}

// ─── Resolver ────────────────────────────────────────────────────────────────
const F = (o: any) => ({ enabled: true, required: false, priority: 1, captureStrategy: 'start', ...o });
const plan = (config: any, opts: { n: number; msg?: string; known?: any; state?: any; callback?: boolean }) => lc.resolveLeadCollection({
  fields: lc.normalizeLeadFields(config),
  known: opts.known || {},
  state: opts.state || lc.emptyLeadCaptureState(),
  userMessageCount: opts.n,
  userMessage: opts.msg || 'hello',
  callbackRequested: opts.callback,
  phoneMode: lc.phoneModeFor(config),
});

// Timing × Mandatory/Optional × saved/said/neither
{
  const strategies: Array<[string, any, number, string]> = [
    ['start', {}, 1, 'hi'],
    ['custom#3', { captureStrategy: 'custom', customAskAfter: 3 }, 3, 'and?'],
    ['keyword', { captureStrategy: 'keyword', captureKeywords: ['fees'] }, 1, 'what are the fees?'],
  ];
  for (const [label, extra, dueAt, msg] of strategies) {
    for (const required of [true, false]) {
      const cfg = { fields: [F({ id: 'name', required, ...extra })] };
      const due = plan(cfg, { n: dueAt, msg });
      expect(due.next?.id === 'name' && due.next.mode === (required ? 'block' : 'after_answer'),
        `${label} ${required ? 'mandatory' : 'optional'}: due at msg #${dueAt} as ${required ? 'block' : 'after_answer'}`, due.next);
      const saved = plan(cfg, { n: dueAt, msg, known: { name: 'Rahul' } });
      expect(saved.next === null && saved.collected.includes('name'), `${label} ${required ? 'mandatory' : 'optional'}: saved → not asked`);
      if (label !== 'start') {
        const early = plan(cfg, { n: label === 'custom#3' ? 2 : 1, msg: 'hello there' });
        expect(early.next === null, `${label} ${required ? 'mandatory' : 'optional'}: not due before its trigger`, early.next);
      }
    }
  }
  // "said in chat" is folded into `known` by the caller (contactInfoSaidInChat) — same as saved:
  const cfg = { fields: [F({ id: 'name', required: true, captureStrategy: 'intent' })] };
  expect(plan(cfg, { n: 2, known: { name: 'Rahul' } }).next === null && plan(cfg, { n: 2, known: { name: 'Rahul' } }).intentOption === null, 'intent: name said in chat → not asked');
  const p = plan(cfg, { n: 2, msg: 'what are the fees?' });
  expect(p.next === null && p.intentOption?.id === 'name' && p.intentOption.mode === 'block', 'intent mandatory → conditional block offer', p);
  const legacy = plan({ fields: [F({ id: 'email', captureStrategy: 'end', captureKeywords: [] })] }, { n: 3 });
  expect(legacy.next?.id === 'email', "legacy 'end' with no keywords behaves like custom #3", legacy.next);
  expect(plan({ fields: [F({ id: 'email', captureStrategy: 'end', captureKeywords: [] })] }, { n: 2 }).next === null, "legacy 'end' with no keywords: not before message #3");
  const smart = plan({ fields: [F({ id: 'name', required: true, captureStrategy: 'smart' })] }, { n: 2 });
  expect(smart.next?.id === 'name', "legacy 'smart' = custom from message #2");
}

// Priority across mixed strategies (item 5)
{
  const cfg = { fields: [F({ id: 'mobile', required: true, priority: 2, captureStrategy: 'start' }), F({ id: 'name', required: true, priority: 1, captureStrategy: 'intent', intentIntensity: 'medium' })] };
  const p = plan(cfg, { n: 1, msg: 'hi' });
  expect(p.next?.id === 'mobile' && p.intentOption?.id === 'name', 'name=intent p1 + mobile=start p2: mobile due now, name offered only if intent shows', p);
  const block = lc.buildLeadTurnBlock(p);
  expect(/INTENT CHECK/.test(block) && /mobile number/.test(block) && !/Collect required contact info FIRST/.test(block), 'one block with NOW + INTENT CHECK, no generic "collect first" line');
  const arrayOrder = { fields: [F({ id: 'email', required: true, priority: 3 }), F({ id: 'name', required: true, priority: 1 }), F({ id: 'mobile', required: true, priority: 2 })] };
  expect(plan(arrayOrder, { n: 1 }).next?.id === 'name', 'priority, not array order, picks the first field');
  expect(plan(arrayOrder, { n: 1, known: { name: 'A' } }).next?.id === 'mobile', '…then the next priority');
  const mixed = { fields: [F({ id: 'email', required: false, priority: 1, captureStrategy: 'start' }), F({ id: 'name', required: true, priority: 2, captureStrategy: 'start' })] };
  expect(plan(mixed, { n: 1 }).next?.id === 'name', 'a due mandatory field goes before a due optional one');
}

// Per-field customAskAfter (item 6)
{
  const cfg = { fields: [F({ id: 'name', required: true, priority: 1, captureStrategy: 'custom', customAskAfter: 2 }), F({ id: 'mobile', required: true, priority: 2, captureStrategy: 'custom', customAskAfter: 4 })] };
  expect(plan(cfg, { n: 2 }).next?.id === 'name', 'name due at #2');
  expect(plan(cfg, { n: 3, known: { name: 'A' } }).next === null, 'mobile (askAfter 4) not due at #3 even though name used 2');
  expect(plan(cfg, { n: 4, known: { name: 'A' } }).next?.id === 'mobile', 'mobile due at #4');
  const prompt = buildLeadTrainingPrompt(cfg);
  expect(/mobile: respond normally for the first 3 message\(s\)/.test(prompt), 'static prompt (WhatsApp) lists each field\'s own ask-after', prompt.slice(0, 0));
}

// Optional At Start after mandatory At Start (item 8)
{
  const cfg = { fields: [F({ id: 'name', required: true, priority: 1, captureStrategy: 'start' }), F({ id: 'email', required: false, priority: 2, captureStrategy: 'start' })] };
  expect(plan(cfg, { n: 1 }).next?.id === 'name', 'mandatory At Start first');
  const p = plan(cfg, { n: 2, known: { name: 'Rahul' } });
  expect(p.next?.id === 'email' && p.next.mode === 'after_answer', 'then the optional At Start field, non-blocking (even on message #2)', p.next);
}

// State: optional declined once → never again; mandatory capped at 2 refusals (item 9)
{
  const fieldsOpt = lc.normalizeLeadFields({ fields: [F({ id: 'email', required: false, captureStrategy: 'custom', customAskAfter: 1 })] });
  let st = lc.emptyLeadCaptureState();
  st = lc.applyAssistantReply(st, { n: 1, replyText: 'Sure! Could you share your email address?', fields: fieldsOpt, collected: new Set(), plannedId: 'email', plannedMode: 'after_answer' });
  st = lc.applyUserTurn(st, { n: 2, userMessage: 'no thanks', collected: new Set() });
  const p2 = lc.resolveLeadCollection({ fields: fieldsOpt, known: {}, state: st, userMessageCount: 2, userMessage: 'no thanks' });
  expect(p2.next === null && p2.stopped.some(s => s.id === 'email' && s.why === 'declined') && p2.declinedNow.includes('email'), 'optional email declined once → not asked again', p2);
  const p5 = lc.resolveLeadCollection({ fields: fieldsOpt, known: {}, state: st, userMessageCount: 5, userMessage: 'anything else?' });
  expect(p5.next === null, '…still not asked later');
  expect(/Do NOT ask for: email address \(visitor declined\)/.test(lc.buildLeadTurnBlock(p5)), 'block tells the model not to ask for the declined field');

  // optional ignored → rest one turn, then at most one more ask
  let s2 = lc.applyAssistantReply(lc.emptyLeadCaptureState(), { n: 1, replyText: 'Could you share your email?', fields: fieldsOpt, collected: new Set(), plannedId: 'email', plannedMode: 'after_answer' });
  s2 = lc.applyUserTurn(s2, { n: 2, userMessage: 'what are the timings?', collected: new Set() });
  expect(lc.resolveLeadCollection({ fields: fieldsOpt, known: {}, state: s2, userMessageCount: 2, userMessage: 'what are the timings?' }).next === null, 'optional ask ignored → not re-asked in the very next reply');
  expect(lc.resolveLeadCollection({ fields: fieldsOpt, known: {}, state: s2, userMessageCount: 3, userMessage: 'ok' }).next?.id === 'email', '…asked once more later');
  s2 = lc.applyAssistantReply(s2, { n: 3, replyText: 'Could you share your email?', fields: fieldsOpt, collected: new Set() });
  expect(lc.resolveLeadCollection({ fields: fieldsOpt, known: {}, state: s2, userMessageCount: 6, userMessage: 'ok' }).next === null, '…and never a third time');

  const fieldsReq = lc.normalizeLeadFields({ fields: [F({ id: 'mobile', required: true, captureStrategy: 'start' })] });
  let m = lc.emptyLeadCaptureState();
  const ask = (n: number) => { m = lc.applyAssistantReply(m, { n, replyText: 'May I have your mobile number?', fields: fieldsReq, collected: new Set(), plannedId: 'mobile', plannedMode: 'block' }); };
  const reply = (n: number, text: string) => { m = lc.applyUserTurn(m, { n, userMessage: text, collected: new Set() }); return lc.resolveLeadCollection({ fields: fieldsReq, known: {}, state: m, userMessageCount: n, userMessage: text }); };
  ask(1);
  let r = reply(2, "no, I don't want to share");
  expect(r.next?.mode === 'block' && r.next.refusals === 1, 'mandatory: 1st refusal → still blocking (re-ask with a reason)', r.next);
  ask(2);
  r = reply(3, 'nahi');
  expect(r.next === null || r.next.mode !== 'block', 'mandatory: 2nd refusal → stops blocking (answer the question)', r.next);
  expect(r.next === null, '…and is not re-asked right away');
  r = reply(4, 'what about placements?');
  expect(r.next?.id === 'mobile' && r.next.mode === 'after_answer' && r.next.reason === 'retry_after_refusals', '…re-asked once more later, after answering', r.next);
  ask(4);
  r = reply(5, 'no');
  const r9 = lc.resolveLeadCollection({ fields: fieldsReq, known: {}, state: m, userMessageCount: 9, userMessage: 'hmm' });
  expect(r9.next === null && r9.stopped.some(s => s.id === 'mobile'), 'mandatory: never nagged again after the extra ask', r9);

  // unrecognised phrasing of a blocking ask still counts (so refusals are capped)
  const fn = lc.normalizeLeadFields({ fields: [F({ id: 'name', required: true })] });
  let q = lc.applyAssistantReply(lc.emptyLeadCaptureState(), { n: 1, replyText: 'Happy to help! And you are?', fields: fn, collected: new Set(), plannedId: 'name', plannedMode: 'block', blockAskId: 'name' });
  expect(q.lastAsk?.fields.includes('name'), 'blocking ask with unusual phrasing is recorded', q.lastAsk);
  q = lc.applyAssistantReply(lc.emptyLeadCaptureState(), { n: 1, replyText: 'The fee is ₹2L. Anything else?', fields: fn, collected: new Set(), plannedId: 'name', plannedMode: 'block', blockAskId: null });
  expect(!q.lastAsk, 'an intent-only option is not recorded as asked from a generic question', q.lastAsk);

  // applyUserTurn is idempotent per message number
  const again = lc.applyUserTurn(m, { n: 5, userMessage: 'no', collected: new Set() });
  expect(JSON.stringify(again) === JSON.stringify(m), 'applyUserTurn is idempotent for the same visitor message');
}

// Keyword: mandatory stays pending after the trigger; optional only on the triggering turn (item 10)
{
  const fields = lc.normalizeLeadFields({ fields: [F({ id: 'mobile', required: true, priority: 1, captureStrategy: 'keyword', captureKeywords: ['fees'] }), F({ id: 'email', required: false, priority: 2, captureStrategy: 'keyword', captureKeywords: ['brochure'] })] });
  let st = lc.applyUserTurn(lc.emptyLeadCaptureState(), { n: 1, userMessage: 'what are the fees?', collected: new Set(), keywordTriggered: ['mobile'] });
  expect(lc.resolveLeadCollection({ fields, known: {}, state: st, userMessageCount: 1, userMessage: 'what are the fees?' }).next?.id === 'mobile', 'mandatory keyword triggers');
  st = lc.applyUserTurn(st, { n: 2, userMessage: 'and the duration?', collected: new Set() });
  expect(lc.resolveLeadCollection({ fields, known: {}, state: st, userMessageCount: 2, userMessage: 'and the duration?' }).next?.id === 'mobile', 'mandatory keyword field stays pending on the next turn');
  expect(lc.resolveLeadCollection({ fields, known: { phone: '9876543210' }, state: st, userMessageCount: 3, userMessage: 'send the brochure' }).next?.id === 'email', 'optional keyword field asked on its triggering turn');
  expect(lc.resolveLeadCollection({ fields, known: { phone: '9876543210' }, state: st, userMessageCount: 4, userMessage: 'thanks' }).next === null, 'optional keyword field not pending afterwards');
}

// Mobile + WhatsApp both enabled (item 15), callbacks
{
  const cfg = { fields: [F({ id: 'mobile', required: true, priority: 1 }), F({ id: 'whatsapp', required: false, priority: 2 })] };
  const fields = lc.normalizeLeadFields(cfg);
  const p = plan(cfg, { n: 2, known: { phone: '9876543210' } });
  expect(p.next?.id === 'whatsapp' && p.next.reason === 'whatsapp_confirm', 'mobile saved → ask once whether it is also on WhatsApp', p.next);
  let st = lc.applyAssistantReply(lc.emptyLeadCaptureState(), { n: 2, replyText: 'Is 98765 43210 also on WhatsApp?', fields, collected: new Set(['mobile']), plannedId: 'whatsapp', plannedMode: 'after_answer', whatsappConfirm: true, phoneKnown: true });
  st = lc.applyUserTurn(st, { n: 3, userMessage: 'yes', collected: new Set(['mobile']) });
  expect(st.whatsapp?.sameAsMobile === true && plan(cfg, { n: 3, known: { phone: '9876543210' }, state: st }).collected.includes('whatsapp'), '"yes" → WhatsApp satisfied by the mobile number');
  expect(lc.whatsappForCrm(cfg, '9876543210', st.whatsapp) === '9876543210', 'CRM gets the WhatsApp number');
  const cb = plan({ fields: [F({ id: 'name', required: true, priority: 1 })] }, { n: 1, msg: 'please call me back', callback: true });
  expect(cb.next?.reason === 'callback' && cb.next.id === 'mobile', 'callback request asks for the phone even with no phone field');
  const cbKnown = plan(cfg, { n: 3, msg: 'call me back', callback: true, known: { phone: '9876543210' }, state: st });
  expect(cbKnown.callbackConfirm && /do NOT ask for the number again/.test(lc.buildLeadTurnBlock(cbKnown)), 'callback with phone saved → confirm, no re-ask');
}

// After a refusal, no other (optional) ask in the same reply; an invalid phone is the one ask.
{
  const fields = lc.normalizeLeadFields({ fields: [F({ id: 'name', required: true, priority: 1 }), F({ id: 'email', required: false, priority: 2 })] });
  let st = lc.emptyLeadCaptureState();
  for (const n of [1, 2]) {
    st = lc.applyAssistantReply(st, { n, replyText: 'May I have your name?', fields, collected: new Set(), plannedId: 'name', plannedMode: 'block' });
    st = lc.applyUserTurn(st, { n: n + 1, userMessage: 'no', collected: new Set() });
  }
  const p = lc.resolveLeadCollection({ fields, known: {}, state: st, userMessageCount: 3, userMessage: 'no' });
  expect(p.next === null, 'the reply to a 2nd refusal asks for nothing else (no email ask)', p.next);
  const phonePlan = plan({ fields: [F({ id: 'name', required: true, captureStrategy: 'intent' }), F({ id: 'mobile', required: true, priority: 2, captureStrategy: 'custom', customAskAfter: 9 })] }, { n: 1, msg: 'my number is 98450 1234' });
  const b = lc.buildLeadTurnBlock(phonePlan, { phoneRejected: true });
  expect(/re-enter their mobile number/.test(b) && !/INTENT CHECK/.test(b) && /valid mobile number is/.test(b), 'invalid phone typed → NOW = re-enter the number only', b);
}

// Block shape
{
  const p = plan({ fields: [F({ id: 'name', required: true }), F({ id: 'mobile', required: true, priority: 2 })] }, { n: 1 });
  const block = lc.buildLeadTurnBlock(p);
  expect(/ONE contact detail/.test(block) && /MANDATORY — before answering, ask the visitor for their name/.test(block) && !/mobile number/.test(block.split('\n').find(l => l.startsWith('NOW')) || ''), 'block names exactly one field', block);
  const none = lc.buildLeadTurnBlock(plan({ fields: [F({ id: 'name', captureStrategy: 'custom', customAskAfter: 5 })] }, { n: 1 }));
  expect(/no contact detail is due/.test(none), 'nothing due → explicit "do not ask"');
  expect(!/ASK FOR THEIR NAME FIRST/.test(block + none), 'the old "ASK FOR THEIR NAME FIRST" text never appears');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('All lead-capture resolver checks passed.');
// Imported services open a DB pool / timers; nothing else to wait for.
process.exit(0);
