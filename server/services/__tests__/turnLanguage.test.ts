/**
 * Which language the customer is using — evidence scoring, confidence, sticky per conversation,
 * browser language as the starting point (services/language/turnLanguage.ts).
 * Run: npx tsx server/services/__tests__/turnLanguage.test.ts
 */
let passed = 0;
let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) { passed++; console.log(`✓ ${label}`); }
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); }
}

(async () => {
  const T = await import("../language/turnLanguage");
  const { LlamaService } = await import("../../llamaService");
  const { detectLanguageForSession, clearLanguageSessions } = await import("../chatContext/languageSession");
  const { detectTurnLanguage } = await import("../language/chatLanguage");

  // ── 1. Evidence, not keywords ──────────────────────────────────────────────
  const english = [
    "Do you have any watches under 5 lakh?",
    "Is there anything below 2 crore for my wife?",
    "What is the price in rupees for the Submariner?",
    "Can you show me something for my bhai under 50000?",
    "I want ek watch for my father",
  ];
  for (const t of english) {
    const e = T.turnLanguageEvidence(t);
    expect(e.language === "en" && e.confident, `English with Indian number / money words stays English: "${t}"`, e);
    expect(LlamaService.quickDetectLanguage(t) !== "hinglish", `quick detector no longer calls it Hinglish: "${t}"`, LlamaService.quickDetectLanguage(t));
  }
  const hinglish = [
    "fees kitni hai batao",
    "kya aapke paas Rolex hai",
    "5 lakh wala hai kya",
    "mujhe ek watch chahiye",
    "kya price",
    "theek hai, dikhao",
  ];
  for (const t of hinglish) {
    const e = T.turnLanguageEvidence(t);
    expect(e.language === "hinglish" && e.confident, `real Hinglish recognised: "${t}"`, e);
    expect(LlamaService.quickDetectLanguage(t) === "hinglish", `quick detector: Hinglish "${t}"`);
  }
  for (const t of ["5 lakh?", "ok", "Rolex", "yes", "2 crore"]) {
    expect(!T.turnLanguageEvidence(t).confident, `unclear message is not confident: "${t}"`, T.turnLanguageEvidence(t));
  }
  expect(T.turnLanguageEvidence("बजट 5 लाख है").language === "hi" && T.turnLanguageEvidence("बजट 5 लाख है").confident, "Devanagari → Hindi, confident");
  expect(T.turnLanguageEvidence("مجھے گھڑی چاہیے", { arabicIsHindi: true }).language === "hi", "Urdu-script voice transcript → Hindi");
  const es = T.turnLanguageEvidence("Hola, cuál es el precio del reloj?");
  expect(es.language === null && !es.confident, "Spanish → no guess (the AI detector decides)", es);
  expect(detectTurnLanguage("Do you have any watches under 5 lakh?") === "en", "detectTurnLanguage: the reported message is English");
  expect(detectTurnLanguage("fees kitni hai batao") === "hinglish", "detectTurnLanguage: Hinglish unchanged");

  // ── 2 + 3. Sticky per conversation, browser language as the start ─────────
  T.clearConversationLanguages();
  let s = T.stickyTurnLanguage("c1", "kya aapke paas Rolex hai");
  expect(s.language === "hinglish" && s.source === "confident", "clear Hinglish sets the conversation language", s);
  s = T.stickyTurnLanguage("c1", "5 lakh?");
  expect(s.language === "hinglish" && s.source === "remembered", "unclear follow-up keeps Hinglish", s);
  s = T.stickyTurnLanguage("c1", "Do you have any watches under 5 lakh?");
  expect(s.language === "en" && s.source === "confident", "a clear English sentence switches to English", s);
  s = T.stickyTurnLanguage("c1", "ok");
  expect(s.language === "en" && s.source === "remembered", "then 'ok' stays English", s);
  s = T.stickyTurnLanguage("c2", "5 lakh?", { browserLanguage: "hi-IN" });
  expect(s.language === "hi" && s.source === "browser", "first unclear message → browser language (hi-IN → hi)", s);
  s = T.stickyTurnLanguage("c3", "5 lakh?", { browserLanguage: "en-IN" });
  expect(s.language === "en" && s.source === "browser", "first unclear message → browser language (en-IN → en)", s);
  s = T.stickyTurnLanguage("c4", "Do you have any watches under 5 lakh?", { browserLanguage: "hi-IN" });
  expect(s.language === "en" && s.source === "confident", "a clear message beats the browser language", s);
  expect(T.languageFromBrowser("hi-IN") === "hi" && T.languageFromBrowser("en_GB") === "en" && T.languageFromBrowser("xx-YY") === null && T.languageFromBrowser("") === null, "browser tags normalised");
  s = T.stickyTurnLanguage(null, "ok");
  expect(s.source === "guess", "no conversation key → just the guess", s);

  // ── Website widget memory (languageSession) ───────────────────────────────
  clearLanguageSessions();
  let llmCalls = 0;
  const llm = async (_m: string) => { llmCalls++; return "en"; };
  let d = await detectLanguageForSession("w1", "Do you have any watches under 5 lakh?", llm);
  expect(d.language === "en" && llmCalls === 0, "widget: the reported message → English, no AI call", d);
  d = await detectLanguageForSession("w2", "kya aapke paas Rolex hai", llm);
  d = await detectLanguageForSession("w2", "5 lakh?", llm);
  expect(d.language === "hinglish" && d.source === "session" && llmCalls === 0, "widget: unclear follow-up keeps Hinglish", d);
  d = await detectLanguageForSession("w3", "5 lakh?", llm, { browserLanguage: "en-IN" });
  expect(d.language === "en" && d.source === "browser" && llmCalls === 0, "widget: first short unclear message → browser language", d);
  d = await detectLanguageForSession("w4", "Rolex Submariner Datejust Daytona Explorer GMT", llm);
  expect(llmCalls === 1 && d.source === "llm", "widget: a longer unclear message → the AI detector once", d);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
