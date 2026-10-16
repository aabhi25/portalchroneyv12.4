/**
 * Conversation journeys remember what the visitor already said (integration, PGlite).
 *
 * Covers: which detail a journey question asks for (contactSlot / stepKeys, incl. "Thanks for
 * sharing your mobile number! May I have your name?" = name); names typed as answers
 * (nameAnswer); skipping steps already answered in the chat (the lead's mobile / name, another
 * journey's qualification); the engine end to end with a FAKE OpenAI server (first question
 * skips known steps, "test" accepted as a name, fake / short numbers refused with the lead
 * rule, a step left behind after two unusable answers, off-topic twice → the AI takes over,
 * the journey's end hands the original question back to the AI with the answers); contact
 * answers saved on THIS conversation's lead only (no "Unknown" placeholder, another visitor's
 * lead with the same number untouched); the CAPTCHA lock when a journey saves a mobile number.
 *
 * No network, no real OpenAI. DESTRUCTIVE: creates rows — refuses to run unless
 * AI_CALLING_TEST_DB=1 (shared local-test flag) and DATABASE_URL points at localhost.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

const dbUrl = process.env.DATABASE_URL || "";
if (process.env.AI_CALLING_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl)) {
  console.error("Skipping: set AI_CALLING_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(0);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-0123456789abcdef";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-at-least-32-characters-long";

const out = console.log.bind(console);
const outErr = console.error.bind(console);
if (process.env.JOURNEY_TEST_VERBOSE !== "1") {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}
let failed = 0;
let passed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (!cond) { failed++; outErr(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); }
  else { passed++; out(`✓ ${label}`); }
}

/** Fake OpenAI: JSON-mode extraction answers with the visitor's message ("?" = off-topic); text calls echo the question. */
async function startFakeOpenAI(): Promise<{ url: string; calls: any[]; close: () => void }> {
  const calls: any[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      calls.push(json);
      const prompt = (json.messages || []).map((m: any) => String(m.content || "")).join("\n");
      let content = "OK";
      if (json.response_format?.type === "json_object") {
        const m = /User's Response: "([\s\S]*?)"\n/.exec(prompt);
        const said = m ? m[1] : "";
        const offTopic = said.includes("?");
        content = JSON.stringify({ answer: offTopic ? null : said, is_off_topic: offTopic, is_refusal: false, quality: offTopic ? "invalid" : "valid", brief_offtopic_answer: offTopic ? "Here is a short answer." : null });
      } else {
        const next = /(?:Next question to ask|Current question we need to ask): ([^\n]+)/.exec(prompt) || /Rephrase this question naturally: ([^\n]+)/.exec(prompt);
        content = next ? `ASK: ${next[1]}` : "OK";
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: json.model || "gpt-4o-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, calls, close: () => server.close() };
}

async function main() {
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.url;
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const known = await import("../journeyKnownAnswers");
  const { journeyService } = await import("../journeyService");
  const { journeyOrchestrator, nameAnswer } = await import("../journeyOrchestrator");
  const { upsertConversationLead } = await import("../leadCapture/leadStore");

  // ═══ 1. what a question asks for ═══════════════════════════════════════════
  {
    const slot = (q: string, extra: Record<string, unknown> = {}) => known.contactSlot({ questionText: q, ...extra });
    expect(slot("Thanks for sharing your mobile number! May I have your name, please?") === "name", "\"Thanks for sharing your mobile number! May I have your name?\" asks for the NAME");
    expect(slot("📱 Please share your mobile number to receive a personalized fee estimate. 🧑‍🎓") === "phone", "mobile-number question → phone");
    expect(slot("Excellent choice! Please share your WhatsApp number to share the brochure right away.") === "phone", "WhatsApp-number question → phone");
    expect(slot("To address you better, what’s your good name? 🤗") === "name", "\"what's your good name?\" → name");
    expect(slot("What is your company name?") === null && slot("Which college are you from?") === null, "company / college name is not the visitor's name");
    expect(slot("What's your email address?") === "email" && slot("Anything", { questionType: "phone" }) === "phone", "email question → email; questionType phone → phone");
    const q1 = known.stepKeys({ questionText: "Oh Sure, May I know your highest qualification to assist you better on your eligibility?" });
    const q2 = known.stepKeys({ questionText: "What is your highest educational qualification? 🧑‍🎓 This helps us tailor your fee details." });
    expect(q1.includes("topic:qualification") && q2.includes("topic:qualification"), "two different qualification questions share the same topic", { q1, q2 });
    expect(known.stepKeys({ questionText: "x", crmFieldKey: "mx_Course" })[0] === "key:mx_course", "an explicit CRM key is the most specific key");
  }

  // ═══ 2. names typed as answers ═════════════════════════════════════════════
  {
    for (const [msg, want] of [["test", "Test"], ["rahul sharma", "Rahul Sharma"], ["My name is Priya", "Priya"], ["राहुल", "राहुल"]] as const) {
      expect(nameAnswer(msg) === want, `name answer "${msg}" → "${want}"`, nameAnswer(msg));
    }
    for (const msg of ["yes", "no", "what are the fees?", "9811100001", "skip", "ok"]) {
      expect(nameAnswer(msg) === null, `not a name: "${msg}"`, nameAnswer(msg));
    }
  }

  // ═══ seed ═══════════════════════════════════════════════════════════════════
  const stamp = Date.now();
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `Journey Memory ${stamp}`, website: "https://x.example.com", openaiApiKey: "sk-test-not-real" } as any).returning();
  const B = biz.id as string;
  const leadConfig = (captcha: boolean) => ({ captureStrategy: "custom", fields: [{ id: "mobile", enabled: true, required: true, priority: 1, captureStrategy: "intent", phoneValidation: "10", captchaEnabled: captcha, captchaProvider: "recaptcha_v2", captchaSiteKey: "site-key" }] });
  await db.insert(schema.widgetSettings).values({ businessAccountId: B, leadTrainingConfig: leadConfig(false) } as any);
  const mkJourney = async (name: string, keywords: string[], questions: Array<[string, string?]>) => {
    const [j] = await db.insert(schema.conversationJourneys).values({ businessAccountId: B, name, journeyType: "conversational", status: "active", triggerMode: "manual", triggerKeywords: JSON.stringify(keywords) } as any).returning();
    for (let i = 0; i < questions.length; i++) {
      await db.insert(schema.journeySteps).values({ journeyId: j.id, stepOrder: String(i + 1), questionText: questions[i][0], questionType: questions[i][1] || "text", isRequired: "true" } as any);
    }
    return j;
  };
  await mkJourney("Fees", ["fee", "fees"], [["📱 Please share your mobile number to receive a personalized fee estimate.", "phone"], ["To address you better, what’s your good name? 🤗"], ["What is your highest educational qualification? This helps us tailor your fee details."]]);
  await mkJourney("Eligibility", ["eligible", "eligibility"], [["Oh Sure, May I know your highest qualification to assist you better on your eligibility?"], ["Awesome, please share your mobile number to assist you better with your eligibility criteria.", "phone"], ["Thanks for sharing your mobile number! May I have your name, please?"]]);
  journeyService.invalidateJourneyCache(B);
  const mkConv = async () => (await db.insert(schema.conversations).values({ businessAccountId: B, title: "New Chat" } as any).returning())[0];
  const leadOf = async (conversationId: string) => (await db.select().from(schema.leads).where(and(eq(schema.leads.conversationId, conversationId), eq(schema.leads.businessAccountId, B))));
  const send = (conv: any, msg: string, channel = "widget") => journeyOrchestrator.processUserMessageEngineDriven(conv.id, `widget_session_${conv.id}`, B, msg, { channel });

  // ═══ 3. mobile known before the journey → not asked; "test" is a name; end hands back the question ═══
  {
    const conv = await mkConv();
    await upsertConversationLead({ businessAccountId: B, conversationId: conv.id, values: { phone: "9811100061" } });
    let r = await send(conv, "What are the fees?");
    expect(r.shouldBypassAI && /^ASK: To address you better, what’s your good name/.test(r.response || ""), "Fees journey starts at the NAME (mobile already saved in this chat)", r.response);
    r = await send(conv, "test");
    expect(r.shouldBypassAI && /^ASK: What is your highest educational qualification/.test(r.response || ""), "\"test\" accepted as the name → next question", r.response);
    const lead = await leadOf(conv.id);
    expect(lead.length === 1 && lead[0].phone && lead[0].name === null, "\"test\" is not saved as the lead name (junk), no \"Unknown\" placeholder", lead.map((l) => l.name));
    r = await send(conv, "BBA");
    expect(!r.shouldBypassAI && r.isComplete && r.handoffQuestion === "What are the fees?", "journey end → the AI answers the question that started it", r);
    expect(/HAS shared their mobile number/.test(r.handoffNote || "") && /BBA/.test(r.handoffNote || "") && /NOT a new question/.test(r.handoffNote || ""), "hand-off note: answers, mobile saved, last message was an answer", r.handoffNote);

    // Eligibility later in the same chat: qualification (Fees), mobile, name ("Test", from the Fees answer) are all known.
    r = await send(conv, "Am I eligible?");
    expect(!r.shouldBypassAI && r.isComplete && r.handoffQuestion === "Am I eligible?", "Eligibility journey: every question already answered → nothing asked, AI answers", r);
    const answers = await db.select({ response: schema.journeyResponses.response }).from(schema.journeyResponses).where(eq(schema.journeyResponses.conversationId, conv.id));
    expect(answers.filter((a) => a.response === "BBA").length === 2, "the qualification answer is reused for the second journey", answers.map((a) => a.response));
  }

  // ═══ 4. phone rule, two tries then move on, lead of THIS chat only ════════
  {
    const other = await mkConv();
    await upsertConversationLead({ businessAccountId: B, conversationId: other.id, values: { phone: "9811100062", name: "Original Person" }, reuseReturningVisitorLead: false });
    const conv = await mkConv();
    let r = await send(conv, "fees please");
    expect(/^ASK: 📱 Please share your mobile number/.test(r.response || ""), "Fees journey asks the mobile number first", r.response);
    r = await send(conv, "9876543210");
    expect(r.shouldBypassAI && /^ASK: 📱 Please share your mobile number/.test(r.response || "") && (await leadOf(conv.id)).length === 0, "fake number 9876543210 refused (lead rule), asked again", r.response);
    r = await send(conv, "12345");
    expect(r.shouldBypassAI && /^ASK: To address you better/.test(r.response || ""), "second unusable answer → the step is left behind, next question asked", r.response);
    r = await send(conv, "Neha Gupta");
    expect(/^ASK: What is your highest educational qualification/.test(r.response || ""), "name accepted", r.response);
    const conv2 = await mkConv();
    await send(conv2, "fee");
    await send(conv2, "9811100062");
    await send(conv2, "Someone Else");
    const otherLead = await leadOf(other.id);
    const lead2 = await leadOf(conv2.id);
    expect(otherLead[0]?.name === "Original Person", "another visitor's lead with the same number is NOT renamed", otherLead.map((l) => l.name));
    expect(lead2.length === 1 && lead2[0].name === "Someone Else" && !!lead2[0].phone, "this chat gets its own lead (name + phone)", lead2.map((l) => ({ n: l.name, p: !!l.phone })));
  }

  // ═══ 5. off-topic twice → the AI takes over ════════════════════════════════
  {
    const conv = await mkConv();
    await send(conv, "what is the fee");
    let r = await send(conv, "Is it UGC approved?");
    expect(r.shouldBypassAI && /^ASK: 📱/.test(r.response || ""), "one off-topic question: short answer + back to the question", r.response);
    r = await send(conv, "Do you have weekend classes?");
    expect(!r.shouldBypassAI, "second off-topic question → journey ends, the normal AI answers", r);
    expect(!(await journeyService.getCurrentStep(conv.id)), "no journey question left open");
  }

  // ═══ 6. CAPTCHA when a journey saves the mobile number ═════════════════════
  {
    await db.update(schema.widgetSettings).set({ leadTrainingConfig: leadConfig(true) } as any).where(eq(schema.widgetSettings.businessAccountId, B));
    const { storage } = await import("../../storage");
    const conv = await mkConv();
    await send(conv, "fees?");
    const r = await send(conv, "9811100063");
    const [row] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conv.id));
    expect(r.captchaRequired === true && (row as any).awaitingVerification === true, "website chat: journey mobile number → CAPTCHA required, chat locked", { c: r.captchaRequired, a: (row as any).awaitingVerification });
    expect(await storage.isConversationAwaitingVerification(conv.id, B), "lock visible to the chat's verification gate");
    const conv2 = await mkConv();
    await send(conv2, "fees?", "whatsapp");
    const r2 = await send(conv2, "9811100064", "whatsapp");
    const [row2] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conv2.id));
    expect(!r2.captchaRequired && (row2 as any).awaitingVerification !== true, "not the website widget → no CAPTCHA", { c: r2.captchaRequired });
  }

  fake.close();
  out(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { outErr(e); process.exit(1); });
