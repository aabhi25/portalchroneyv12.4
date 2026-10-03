/**
 * AI reply-language setting on the non-streamed channels, against a real (local) Postgres/PGlite,
 * a fake OpenAI server and stubbed MSG91 / Meta Graph (nothing leaves the machine):
 *
 *  - WhatsApp AI replies, Instagram DMs, Facebook DMs, Instagram comment replies (+ private reply),
 *    Instagram DM flows, WhatsApp flows, WhatsApp campaign AI replies
 *  - "any language" (default): the prompts keep today's exact language text, no language rule,
 *    no extra detection on Facebook / comments / campaigns, no rewrite / translation calls
 *  - restricted: the business rule replaces the old override; a customer writing in a
 *    non-allowed language gets the default language + the "I can help in …" line ONCE per
 *    conversation (or the ask to switch); per-channel overrides; explicit "Hindi mein batao"
 *    remembered; a wrong-language reply is rewritten before sending and a right one untouched;
 *    our fixed AI-failure notice is translated
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55990/postgres?sslmode=disable \
 *   SOCIAL_LANGUAGE_TEST_DB=1 npx tsx server/services/__tests__/socialLanguage.integration.test.ts
 */
import crypto from "crypto";
import http from "node:http";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.SOCIAL_LANGUAGE_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set SOCIAL_LANGUAGE_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.OPENAI_API_KEY = "sk-test-fake";
for (const k of ["META_APP_SECRET", "FACEBOOK_APP_SECRET", "INSTAGRAM_APP_SECRET", "CHAT_CONTEXT_MODE", "WHATSAPP_CONTEXT_MODE"]) delete process.env[k];

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 900)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const textOf = (c: any) => (typeof c === "string" ? c : c == null ? "" : JSON.stringify(c));

// ── Test texts ───────────────────────────────────────────────────────────────
const TAMIL = "உங்கள் வார இறுதி வகுப்புகளின் கட்டணம் என்ன?";
const HINDI = "आपकी वीकेंड क्लास की फीस कितनी है?";
const ENGLISH = "What are the fees for the weekend batch please?";
const EN_REPLY = "Our weekend batch fee is 5000 rupees per month and classes run on Saturday and Sunday.";
const HI_REPLY = "हमारी वीकेंड बैच की फीस 5000 रुपये प्रति माह है और कक्षाएँ शनिवार और रविवार को होती हैं।";

// ── Fake OpenAI ──────────────────────────────────────────────────────────────
type Kind = "detect" | "rewrite" | "translate" | "main" | "comment" | "commentDm" | "intent" | "extract" | "campaign" | "other";
interface Call { kind: Kind; sys0: string; all: string; lastSystem: string; lastUser: string; messages: any[] }
const calls: Call[] = [];
let nextReply = EN_REPLY;      // what the "model" answers (main / comment / campaign)
let nextFlowResponse = EN_REPLY;

function classify(body: any): Call {
  const msgs: any[] = body.messages || [];
  const sys0 = textOf(msgs[0]?.content);
  const all = msgs.map((m) => textOf(m.content)).join("\n");
  const lastSystem = textOf([...msgs].reverse().find((m) => m.role === "system")?.content);
  const lastUser = textOf([...msgs].reverse().find((m) => m.role === "user")?.content);
  let kind: Kind = "other";
  if (/language detector/i.test(sys0)) kind = "detect";
  else if (/^Rewrite the assistant reply below entirely in/.test(sys0)) kind = "rewrite";
  else if (/^Translate the customer-facing message below into/.test(sys0)) kind = "translate";
  else if (/responding to customer inquiries via|AI AGENT PERSONA/.test(sys0)) kind = "main";
  else if (/You reply to public/.test(sys0)) kind = "comment";
  else if (/sending them a private/.test(sys0)) kind = "commentDm";
  else if (/Classify the intent/.test(all)) kind = "intent";
  else if (/Extract information from the user's message/.test(all)) kind = "extract";
  else if (/Channel: WhatsApp\. Keep replies short/.test(sys0)) kind = "campaign";
  return { kind, sys0, all, lastSystem, lastUser, messages: msgs };
}

function answer(body: any): { status?: number; content?: string; toolCalls?: any[] } {
  const c = classify(body);
  calls.push(c);
  const offered = (body.tools || []).map((t: any) => t?.function?.name);
  if (c.kind === "main" && offered.includes("get_products") && /show me your products/.test(c.lastUser) && !c.messages.some((m) => m.role === "tool")) {
    return { toolCalls: [{ id: "p1", type: "function", function: { name: "get_products", arguments: "{}" } }] };
  }
  if (body.response_format?.type === "json_object") return { content: "{}" };
  switch (c.kind) {
    case "detect": return { content: /Bonjour/.test(c.lastUser) ? "fr" : "en" };
    case "rewrite": return { content: /entirely in Hindi/.test(c.sys0) ? HI_REPLY : EN_REPLY };
    case "translate":
      if (/into Hindi/.test(c.sys0) && c.lastUser === "Book Consultation") return { content: "परामर्श बुक करें" };
      return { content: /into Hindi/.test(c.sys0) ? `हिंदी अनुवाद: ${c.lastUser}` : `TRANSLATED: ${c.lastUser}` };
    case "main": return /FAILNOW/.test(c.lastUser) ? { status: 500 } : { content: nextReply };
    case "comment": case "commentDm": case "campaign": return { content: nextReply };
    case "intent": return { content: JSON.stringify({ intent: "question", response: nextFlowResponse }) };
    case "extract": return { content: JSON.stringify({ extracted: { name: "Rahul Kumar", email: null }, followUp: nextFlowResponse }) };
    default: return { content: "OK" };
  }
}

function startFakeOpenAI(): Promise<string> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      res.setHeader("content-type", "application/json");
      if (req.url?.includes("/embeddings")) {
        const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
        return res.end(JSON.stringify({ object: "list", data: inputs.map((_, i) => ({ object: "embedding", index: i, embedding: new Array(1536).fill(0.01) })), model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } }));
      }
      const a = answer(body);
      if (a.status) { res.statusCode = a.status; return res.end(JSON.stringify({ error: { message: "fake outage", type: "server_error" } })); }
      res.end(JSON.stringify({
        id: "chatcmpl-fake", object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, finish_reason: a.toolCalls ? "tool_calls" : "stop", message: a.toolCalls ? { role: "assistant", content: null, tool_calls: a.toolCalls } : { role: "assistant", content: a.content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`)));
}

// ── MSG91 + Meta Graph stubs ─────────────────────────────────────────────────
const waSent: { to: string; text: string; raw: any }[] = [];
const graphSent: { to: string; text: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
  if (/^https:\/\/control\.msg91\.com\//.test(target)) {
    const u = new URL(target);
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
    waSent.push({ to: u.searchParams.get("recipient_number") || body?.recipient_number || "", text: u.searchParams.get("text") || body?.interactive?.body?.text || body?.caption || "", raw: body });
    return new Response(JSON.stringify({ status: "success", data: { message_uuid: `u_${waSent.length}` } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (/^https:\/\/graph\.(facebook|instagram)\.com\//.test(target)) {
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
    if ((init?.method || "GET").toUpperCase() === "POST" && /\/messages(\?|$)/.test(target)) {
      graphSent.push({ to: body?.recipient?.id || "", text: String(body?.message?.text ?? "") });
      return new Response(JSON.stringify({ message_id: `m_${graphSent.length}` }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

const OLD_OVERRIDE = (langName: string) => `🌐 LANGUAGE — ABSOLUTE OVERRIDE (HIGHEST PRIORITY):
The user's current message is in ${langName}. You MUST reply in ${langName}.
Ignore the language of any previous assistant messages in the conversation history.
Do NOT switch languages. Do NOT use any other language.
SCRIPT RULE: If the user's message contains ONLY Latin/Roman characters → respond in Latin script only.`;

async function main() {
  process.env.OPENAI_BASE_URL = await startFakeOpenAI();

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { encrypt } = await import("../encryptionService");
  const { saveLanguageSettings, resetLanguageStateForTesting } = await import("../language/languagePolicy");
  const { resetLanguageTextCacheForTesting } = await import("../language/languageText");
  const { DEFAULT_AI_LANGUAGE_SETTINGS } = await import("@shared/replyLanguages");
  const { WhatsappAutoReplyService } = await import("../whatsappAutoReplyService");
  const { whatsappService } = await import("../whatsappService");
  const { updateSession } = await import("../whatsappSessionService");
  const { businessContextCache } = await import("../businessContextCache");
  const { InstagramAutoReplyService } = await import("../instagramAutoReplyService");
  const { FacebookAutoReplyService } = await import("../facebookAutoReplyService");
  const { SocialCommentReplyEngine } = await import("../social/commentReplyEngine");
  const { instagramFlowService } = await import("../instagramFlowService");
  const { facebookFlowService } = await import("../facebookFlowService");
  const { whatsappFlowService } = await import("../whatsappFlowService");
  const { campaignAiService } = await import("../campaignAiService");
  const { isHandoffPrefill } = await import("../language/channelReplyLanguage");

  resetLanguageStateForTesting();
  resetLanguageTextCacheForTesting();
  const tag = crypto.randomBytes(3).toString("hex");
  const token = encrypt("test-token");
  let seq = 0;
  const newPhone = () => `9198${String(Date.now()).slice(-4)}${String(++seq).padStart(4, "0")}`;
  const newId = (p: string) => `${p}${tag}${++seq}`;

  async function business(name: string, language?: Record<string, any>, extra: Record<string, any> = {}) {
    const [biz] = await db.insert(schema.businessAccounts).values({ name: `${name} ${tag}`, website: "https://example.com", whatsappEnabled: "true", instagramEnabled: "true", facebookEnabled: "true", openaiApiKey: "sk-test-fake", ...extra } as any).returning();
    await db.insert(schema.widgetSettings).values({ businessAccountId: biz.id } as any).onConflictDoNothing();
    await db.insert(schema.whatsappSettings).values({ businessAccountId: biz.id, msg91AuthKey: "test-key", msg91IntegratedNumberId: "910000000000", webhookSecret: `sec-${tag}-${biz.id.slice(0, 4)}`, autoReplyEnabled: "true", leadCaptureEnabled: "false", whatsappEnabled: "true" } as any);
    await db.insert(schema.instagramSettings).values({ businessAccountId: biz.id, igAccountId: newId("IG"), igAccessToken: token, appSecret: null, autoReplyEnabled: "true", leadCaptureEnabled: "false" } as any);
    await db.insert(schema.facebookSettings).values({ businessAccountId: biz.id, pageId: newId("FB"), pageAccessToken: token, appSecret: null, autoReplyEnabled: "true", leadCaptureEnabled: "false" } as any);
    if (language) await saveLanguageSettings(biz.id, { ...DEFAULT_AI_LANGUAGE_SETTINGS, ...language }, null);
    return biz.id as string;
  }

  const bizAny = await business("Any language");
  const bizEnHi = await business("English+Hindi", { mode: "restricted", allowed: ["en", "hi"], defaultLanguage: "en" });
  const bizWaHi = await business("WhatsApp Hindi only", { mode: "any", channelOverrides: { whatsapp: { allowed: ["hi"], defaultLanguage: "hi" } } });
  const bizAsk = await business("English only, ask", { mode: "restricted", allowed: ["en"], defaultLanguage: "en", unsupportedBehaviour: "ask_to_switch" });

  const since = () => calls.length;
  const callsSince = (n: number) => calls.slice(n);
  const kinds = (cs: Call[], k: Kind) => cs.filter((c) => c.kind === k);

  // ── WhatsApp AI replies ────────────────────────────────────────────────────
  const wa = new WhatsappAutoReplyService();
  async function waReply(biz: string, phone: string, text: string) {
    await updateSession(biz, phone);
    await whatsappService.processTextMessage(biz, `m-${tag}-${crypto.randomBytes(4).toString("hex")}`, phone, text);
    businessContextCache.invalidateBusinessCache(biz);
    const n = since();
    const sentBefore = waSent.length;
    const res = await wa.generateAndSendReply(biz, phone, text);
    await sleep(50);
    const mine = callsSince(n);
    return { res, mine, main: mine.find((c) => c.kind === "main" && c.lastUser === text), sent: waSent.slice(sentBefore).filter((s) => s.to === phone).map((s) => s.text) };
  }

  console.log("\n— WhatsApp: any language (unchanged) —");
  nextReply = EN_REPLY;
  {
    const r = await waReply(bizAny, newPhone(), TAMIL);
    const last = r.main?.messages[r.main.messages.length - 1];
    expect(last?.role === "system" && textOf(last.content) === OLD_OVERRIDE("Tamil"), "unrestricted: today's exact ABSOLUTE OVERRIDE is the last message", textOf(last?.content));
    expect(!/REPLY LANGUAGE/.test(r.main?.all || ""), "unrestricted: no language rule added");
    expect(kinds(r.mine, "rewrite").length === 0 && kinds(r.mine, "translate").length === 0, "unrestricted: no correction / translation call", r.mine.map((c) => c.kind));
    expect(r.sent.join("\n") === EN_REPLY, "unrestricted: reply sent exactly as the model wrote it", r.sent);
  }

  console.log("\n— WhatsApp: restricted (English + Hindi, default English) —");
  {
    const phone = newPhone();
    nextReply = EN_REPLY;
    const r1 = await waReply(bizEnHi, phone, TAMIL);
    const rule1 = r1.main?.lastSystem || "";
    expect(/REPLY LANGUAGE/.test(rule1) && /ENTIRE reply in English/.test(rule1) && !/ABSOLUTE OVERRIDE/.test(r1.main?.all || ""), "Tamil (not allowed): rule says English, old override replaced", rule1);
    expect(/ONE short friendly sentence/.test(rule1) && /English or Hindi/.test(rule1), "first time: the 'I can help in English or Hindi' line is asked for", rule1);
    expect(/SCRIPT RULE: Latin script only/.test(rule1), "script rule follows the reply language");
    expect(kinds(r1.mine, "rewrite").length === 0 && r1.sent.join("\n") === EN_REPLY, "English reply to an English rule: no correction call, sent as is", r1.sent);
    const r2 = await waReply(bizEnHi, phone, TAMIL);
    expect(/ENTIRE reply in English/.test(r2.main?.lastSystem || "") && !/ONE short friendly sentence/.test(r2.main?.lastSystem || ""), "second Tamil message: same language, no repeated note", r2.main?.lastSystem);

    nextReply = EN_REPLY;
    const r3 = await waReply(bizEnHi, phone, HINDI);
    expect(/ENTIRE reply in Hindi in Devanagari/.test(r3.main?.lastSystem || ""), "Hindi (allowed) message: reply in Hindi", r3.main?.lastSystem);
    expect(kinds(r3.mine, "rewrite").length === 1 && r3.sent.join("\n") === HI_REPLY, "safety check: an English reply to a Hindi rule is rewritten before sending", { kinds: r3.mine.map((c) => c.kind), sent: r3.sent });
    nextReply = HI_REPLY;
    const r4 = await waReply(bizEnHi, phone, HINDI);
    expect(kinds(r4.mine, "rewrite").length === 0 && r4.sent.join("\n") === HI_REPLY, "safety check: a Hindi reply is left untouched (no extra call)", r4.mine.map((c) => c.kind));

    const phone2 = newPhone();
    nextReply = HI_REPLY;
    const r5 = await waReply(bizEnHi, phone2, "Hindi mein batao fees kitni hai");
    expect(/ENTIRE reply in Hindi/.test(r5.main?.lastSystem || ""), "explicit 'Hindi mein batao' (allowed) → Hindi", r5.main?.lastSystem);
    const r6 = await waReply(bizEnHi, phone2, ENGLISH);
    expect(/ENTIRE reply in Hindi/.test(r6.main?.lastSystem || ""), "the request is remembered: a later English message still gets Hindi", r6.main?.lastSystem);
    expect(!/short friendly sentence/.test(r6.main?.lastSystem || ""), "English is allowed: no note");
  }

  console.log("\n— WhatsApp: per-channel override (WhatsApp Hindi-only, website any) —");
  {
    nextReply = HI_REPLY;
    const phone = newPhone();
    const r = await waReply(bizWaHi, phone, ENGLISH);
    expect(/ENTIRE reply in Hindi/.test(r.main?.lastSystem || "") && /short friendly sentence/.test(r.main?.lastSystem || "") && /Allowed languages for this business: Hindi/.test(r.main?.lastSystem || ""), "English on Hindi-only WhatsApp → Hindi + note", r.main?.lastSystem);
    const handoff = await waReply(bizWaHi, newPhone(), 'Hi! I was asking about "weekend batch fees" on your website.');
    expect(/ENTIRE reply in Hindi/.test(handoff.main?.lastSystem || "") && !/short friendly sentence/.test(handoff.main?.lastSystem || ""), "our pre-filled website hand-off text doesn't trigger the 'I can only help in…' note", handoff.main?.lastSystem);
    expect(isHandoffPrefill("Hi! I was chatting on your website.") && !isHandoffPrefill("Hi! What are your fees?"), "hand-off pre-fill recognised");

    const failPhone = newPhone();
    const f = await waReply(bizWaHi, failPhone, "FAILNOW please tell me the fees for the weekend batch");
    expect(f.res.success === false && f.sent.length === 1 && f.sent[0].startsWith("हिंदी अनुवाद: Sorry, I'm having trouble"), "AI failure notice is sent in the reply language (Hindi)", f.sent);
    const failAny = await waReply(bizAny, newPhone(), "FAILNOW please tell me the fees for the weekend batch");
    expect(failAny.sent.length === 1 && failAny.sent[0] === "Sorry, I'm having trouble answering right now. Please try again in a few minutes." && kinds(failAny.mine, "translate").length === 0, "unrestricted: AI failure notice unchanged (English, no translation)", failAny.sent);
  }

  console.log("\n— WhatsApp: product cards + buttons (interactive payload keeps working) —");
  {
    const shopAny = await business("Shop any");
    const shopHi = await business("Shop Hindi", { mode: "any", channelOverrides: { whatsapp: { allowed: ["hi"], defaultLanguage: "hi" } } });
    for (const b of [shopAny, shopHi]) {
      await db.insert(schema.products).values({ businessAccountId: b, name: "Red Sneakers", description: "Running shoes", price: "2999", imageUrl: "https://example.com/red-sneakers.jpg" } as any);
    }
    nextReply = EN_REPLY;
    const phoneAny = newPhone();
    const sentBefore = waSent.length;
    const a = await waReply(shopAny, phoneAny, "show me your products");
    const ctaAny = waSent.slice(sentBefore).find((s) => s.to === phoneAny && s.raw?.content_type === "interactive");
    expect(!!a.mine.find((c) => c.kind === "main" && c.messages.some((m: any) => m.role === "tool")), "product tool used (fake model)");
    expect(ctaAny?.raw?.interactive?.body?.text === "Interested in any of these? Let us help you further!" && ctaAny?.raw?.interactive?.action?.buttons?.[0]?.reply?.title === "Book Consultation", "unrestricted: buttons exactly as before", ctaAny?.raw?.interactive);
    expect(kinds(a.mine, "translate").length === 0 && kinds(a.mine, "rewrite").length === 0, "unrestricted: no translation / correction call", a.mine.map((c) => c.kind));

    const phoneHi = newPhone();
    const sentBeforeHi = waSent.length;
    const h = await waReply(shopHi, phoneHi, "show me your products");
    const outHi = waSent.slice(sentBeforeHi).filter((s) => s.to === phoneHi);
    const ctaHi = outHi.find((s) => s.raw?.content_type === "interactive");
    const buttons = ctaHi?.raw?.interactive?.action?.buttons || [];
    expect(outHi[0]?.text === HI_REPLY, "restricted: the text reply was rewritten in Hindi before sending", outHi[0]?.text);
    expect(ctaHi?.raw?.interactive?.type === "button" && ctaHi.raw.interactive.body.text === "हिंदी अनुवाद: Interested in any of these? Let us help you further!", "restricted: interactive body in Hindi, still a button message", ctaHi?.raw?.interactive);
    expect(buttons[0]?.reply?.id === "book_consultation" && buttons[0]?.reply?.title === "परामर्श बुक करें", "restricted: button id unchanged, short Hindi title used", buttons);
    const captionCall = h.mine.find((c) => /Translate the following product descriptions to Hindi in Devanagari script/.test(c.sys0));
    expect(!!captionCall, "restricted: product captions translated into the reply language (Hindi, Devanagari)", h.mine.map((c) => c.sys0.slice(0, 80)));
  }

  console.log("\n— WhatsApp: ask to switch —");
  {
    nextReply = EN_REPLY;
    const r = await waReply(bizAsk, newPhone(), TAMIL);
    expect(/ask them to continue in one of those/.test(r.main?.lastSystem || "") && /ENTIRE reply in English/.test(r.main?.lastSystem || ""), "'ask to switch': the reply asks the customer to switch (in English)", r.main?.lastSystem);
  }

  // ── Instagram / Facebook DMs ───────────────────────────────────────────────
  const ig = new InstagramAutoReplyService();
  const fb = new FacebookAutoReplyService();
  async function dm(svc: any, biz: string, sender: string, text: string) {
    businessContextCache.invalidateBusinessCache(biz);
    const n = since();
    const sentBefore = graphSent.length;
    const res = await svc.generateAndSendReply(biz, sender, text);
    await sleep(50);
    const mine = callsSince(n);
    return { res, mine, main: mine.find((c) => c.kind === "main" && c.lastUser === text), sent: graphSent.slice(sentBefore).filter((s) => s.to === sender).map((s) => s.text) };
  }

  console.log("\n— Instagram DMs —");
  {
    nextReply = EN_REPLY;
    const any = await dm(ig, bizAny, newId("igs"), TAMIL);
    const last = any.main?.messages[any.main.messages.length - 1];
    expect(textOf(last?.content) === OLD_OVERRIDE("Tamil") && !/REPLY LANGUAGE/.test(any.main?.all || ""), "Instagram unrestricted: today's exact override, no rule", textOf(last?.content));
    expect(kinds(any.mine, "rewrite").length === 0 && any.sent.join("\n") === EN_REPLY, "Instagram unrestricted: reply untouched");
    const perChannel = await dm(ig, bizWaHi, newId("igs"), TAMIL);
    expect(textOf(perChannel.main?.messages[perChannel.main.messages.length - 1]?.content) === OLD_OVERRIDE("Tamil"), "WhatsApp-only override does not restrict Instagram");

    const sender = newId("igs");
    const r1 = await dm(ig, bizEnHi, sender, TAMIL);
    expect(/ENTIRE reply in English/.test(r1.main?.lastSystem || "") && /short friendly sentence/.test(r1.main?.lastSystem || "") && !/ABSOLUTE OVERRIDE/.test(r1.main?.all || ""), "Instagram restricted: Tamil → English + note, old override replaced", r1.main?.lastSystem);
    const r2 = await dm(ig, bizEnHi, sender, TAMIL);
    expect(!/short friendly sentence/.test(r2.main?.lastSystem || ""), "Instagram: note only once per conversation");
    nextReply = EN_REPLY;
    const r3 = await dm(ig, bizEnHi, sender, HINDI);
    expect(r3.sent.join("\n") === HI_REPLY && kinds(r3.mine, "rewrite").length === 1, "Instagram: English reply to a Hindi rule rewritten before sending", { sent: r3.sent, kinds: r3.mine.map((c) => c.kind) });
  }

  console.log("\n— Facebook DMs —");
  {
    nextReply = EN_REPLY;
    const any = await dm(fb, bizAny, newId("fbs"), ENGLISH);
    expect(!!any.main && !/LANGUAGE/.test(any.main.messages.filter((m: any) => m.role === "system").slice(1).map((m: any) => textOf(m.content)).join("\n")) && !/REPLY LANGUAGE|ABSOLUTE OVERRIDE/.test(any.main.all), "Facebook unrestricted: still no language text at all", any.main?.lastSystem);
    expect(kinds(any.mine, "detect").length === 0 && kinds(any.mine, "rewrite").length === 0, "Facebook unrestricted: no language detection, no correction", any.mine.map((c) => c.kind));

    const sender = newId("fbs");
    nextReply = EN_REPLY;
    const r1 = await dm(fb, bizEnHi, sender, "Bonjour, quels sont les frais pour le cours du weekend?");
    expect(kinds(r1.mine, "detect").length === 1, "Facebook restricted: the message language is detected", r1.mine.map((c) => c.kind));
    expect(/ENTIRE reply in English/.test(r1.main?.lastSystem || "") && /short friendly sentence/.test(r1.main?.lastSystem || ""), "Facebook restricted: French → English + note", r1.main?.lastSystem);
    const r2 = await dm(fb, bizEnHi, sender, HINDI);
    expect(/ENTIRE reply in Hindi/.test(r2.main?.lastSystem || "") && r2.sent.join("\n") === HI_REPLY, "Facebook restricted: Hindi message → Hindi; English reply rewritten", { rule: r2.main?.lastSystem, sent: r2.sent });
  }

  // ── Comment replies (+ private reply) ──────────────────────────────────────
  console.log("\n— Instagram comments —");
  const commentPosts: { kind: "reply" | "dm"; text: string }[] = [];
  const commentEngine = new SocialCommentReplyEngine<any>({
    platform: "instagram", label: "Instagram", ownAccountNoun: "account", ownAccountId: () => "OWN_ACCOUNT",
    commentsTable: schema.instagramComments, commenterNameColumn: "commenterUsername", cachePrefix: "ig", visionMediaTypes: [],
    replyToComment: async (_s, _id, text) => { commentPosts.push({ kind: "reply", text }); return { success: true, commentId: newId("rc") }; },
    sendPrivateReply: async (_s, _id, text) => { commentPosts.push({ kind: "dm", text }); return { success: true }; },
    getPostContext: async () => null,
    prompts: { postNoun: "Instagram post", captionLabel: "Caption", detailedQuestionHint: "Invite them to DM for details", commenterMention: (n) => `@${n}`, postWithArticle: "an Instagram post", dmNoun: "DM", privateDmNoun: "private DM" },
  });
  const commentSettings = { commentAutoReplyEnabled: "true", commentReplyMode: "all", commentTriggerKeywords: null, commentReplyDelay: "0", commentMaxRepliesPerPost: "50", commentAutoDmEnabled: "true", commentDmMode: "all", commentDmTemplate: "" };
  async function comment(biz: string, commenterId: string, text: string) {
    const n = since();
    const before = commentPosts.length;
    const res = await commentEngine.processComment(commentSettings as any, biz, { commentId: newId("c"), commentText: text, commenterId, commenterName: "asha", postId: newId("p") });
    const mine = callsSince(n);
    return { res, mine, reply: mine.find((c) => c.kind === "comment"), dm: mine.find((c) => c.kind === "commentDm"), posted: commentPosts.slice(before) };
  }
  {
    nextReply = EN_REPLY;
    const any = await comment(bizAny, newId("u"), TAMIL);
    expect(/LANGUAGE MATCHING: Always reply in the same language the commenter used\./.test(any.reply?.sys0 || "") && !/REPLY LANGUAGE/.test(any.reply?.sys0 || ""), "comments unrestricted: today's 'same language' line, no rule");
    expect(/LANGUAGE MATCHING: Always reply in the same language the user commented in\./.test(any.dm?.sys0 || "") && !/REPLY LANGUAGE/.test(any.dm?.sys0 || ""), "comment DM unrestricted: unchanged");
    expect(kinds(any.mine, "detect").length === 0 && kinds(any.mine, "rewrite").length === 0, "comments unrestricted: no detection / correction calls", any.mine.map((c) => c.kind));

    const commenter = newId("u");
    nextReply = EN_REPLY;
    const r1 = await comment(bizEnHi, commenter, TAMIL);
    expect(/REPLY LANGUAGE/.test(r1.reply?.sys0 || "") && /ENTIRE reply in English/.test(r1.reply?.sys0 || "") && !/LANGUAGE MATCHING/.test(r1.reply?.sys0 || ""), "comments restricted: Tamil → English rule replaces 'same language'", r1.reply?.sys0?.slice(-700));
    expect(/short friendly sentence/.test(r1.reply?.sys0 || "") && !/short friendly sentence/.test(r1.dm?.sys0 || "") && /ENTIRE reply in English/.test(r1.dm?.sys0 || ""), "the note goes in the public reply only, not again in the private DM", r1.dm?.sys0?.slice(-500));
    const r2 = await comment(bizEnHi, commenter, HINDI);
    expect(r2.posted.find((p) => p.kind === "reply")?.text === HI_REPLY && r2.posted.find((p) => p.kind === "dm")?.text === HI_REPLY, "comments restricted: English reply / DM to a Hindi comment rewritten in Hindi", r2.posted);
    nextReply = HI_REPLY;
    const r3 = await comment(bizEnHi, newId("u"), HINDI);
    expect(kinds(r3.mine, "rewrite").length === 0, "comments restricted: a Hindi reply needs no correction");
  }

  // ── DM flows (Instagram / Facebook engine) and WhatsApp flows ──────────────
  console.log("\n— Flows —");
  {
    nextFlowResponse = EN_REPLY;
    let n = since();
    const anyIntent = await instagramFlowService.detectTextStepIntent(bizAny, TAMIL, "What is your name?", "name", null, newId("igs"));
    let c = callsSince(n).find((x) => x.kind === "intent");
    expect(/IMPORTANT: Respond in the SAME LANGUAGE the customer used\./.test(c?.all || "") && !/business only replies in/.test(c?.all || "") && anyIntent.response === EN_REPLY, "Instagram flow unrestricted: unchanged prompt and response");
    expect(kinds(callsSince(n), "detect").length === 0, "Instagram flow unrestricted: no detection");

    n = since();
    const r = await instagramFlowService.detectTextStepIntent(bizEnHi, HINDI, "What is your name?", "name", null, newId("igs"));
    c = callsSince(n).find((x) => x.kind === "intent");
    expect(/Write the response text in Hindi in Devanagari script/.test(c?.all || "") && !/SAME LANGUAGE/.test(c?.all || ""), "Instagram flow restricted: resolved language replaces 'same language'", c?.all.slice(-600));
    expect(r.response === HI_REPLY, "Instagram flow restricted: wrong-language response rewritten", r.response);

    n = since();
    const ex = await facebookFlowService.extractFieldsWithAI(bizEnHi, TAMIL, ["name", "email"], {}, newId("fbs"));
    c = callsSince(n).find((x) => x.kind === "extract");
    expect(/Write the followUp text in English/.test(c?.all || "") && !/short friendly sentence/.test(c?.all || ""), "Facebook flow restricted: Tamil → follow-up in English, no note", c?.all.slice(-500));
    expect(ex.extracted.name === "Rahul Kumar" && ex.followUp === EN_REPLY, "extracted values untouched; English follow-up kept", ex);

    const waPhone = newPhone();
    n = since();
    const waAny = await whatsappFlowService.detectTextStepIntent(bizAny, TAMIL, "What is your name?", "name", null, undefined, waPhone);
    c = callsSince(n).find((x) => x.kind === "intent");
    expect(/IMPORTANT: Respond in the SAME LANGUAGE the customer used\./.test(c?.all || "") && waAny.response === EN_REPLY, "WhatsApp flow unrestricted: unchanged");
    n = since();
    const waR = await whatsappFlowService.detectTextStepIntent(bizWaHi, ENGLISH, "What is your name?", "name", null, undefined, waPhone);
    c = callsSince(n).find((x) => x.kind === "intent");
    expect(/Write the response text in Hindi/.test(c?.all || "") && waR.response === HI_REPLY, "WhatsApp flow restricted (Hindi-only): Hindi rule + English response rewritten", { tail: c?.all.slice(-400), response: waR.response });
    n = since();
    const off = await whatsappFlowService.detectOffTopicIntent(bizWaHi, ENGLISH, "What is your name?", "text", "your name", undefined, "lead_capture", waPhone);
    c = callsSince(n).find((x) => x.kind === "other" && /Classify the intent:/.test(x.all)) || callsSince(n).find((x) => /CURRENT STEP QUESTION/.test(x.all));
    expect(/Write the response text in Hindi/.test(c?.all || "") && !/in the SAME LANGUAGE/.test(c?.all || ""), "WhatsApp flow off-topic reply: Hindi rule", c?.all.slice(-500));
    void off;
    n = since();
    const waEx = await whatsappFlowService.extractFieldsWithAI(bizWaHi, ENGLISH, ["name", "email"], {}, waPhone);
    c = callsSince(n).find((x) => x.kind === "extract");
    expect(/Write the followUp text in Hindi/.test(c?.all || "") && waEx.followUp === HI_REPLY && waEx.extracted.name === "Rahul Kumar", "WhatsApp flow extraction: Hindi follow-up, values untouched", waEx);
  }

  // ── Campaign AI replies (WhatsApp) ─────────────────────────────────────────
  console.log("\n— Campaign AI replies —");
  async function campaign(biz: string) {
    await db.update(schema.businessAccounts).set({ openaiApiKey: encrypt("sk-test-fake") } as any).where((await import("drizzle-orm")).eq(schema.businessAccounts.id, biz));
    const [tpl] = await db.insert(schema.whatsappTemplates).values({ businessAccountId: biz, name: `t${seq++}`, bodyText: "Hi {{1}}, your demo class is tomorrow.", paramCount: 1, status: "approved" } as any).returning();
    const [c] = await db.insert(schema.marketingCampaigns).values({ businessAccountId: biz, name: `c-${seq++}`, templateId: tpl.id, templateParams: ["{{name}}"], groupIds: [], status: "sending", aiEnabled: "true", aiDailyTokenBudget: 100000, aiMaxRepliesPerRecipient: 20 } as any).returning();
    const phone = newPhone();
    const [rcp] = await db.insert(schema.marketingCampaignRecipients).values({ campaignId: c.id, businessAccountId: biz, phone: phone.slice(-10), name: "Asha", status: "replied" } as any).returning();
    return { campaignId: c.id as string, recipientId: rcp.id as string, phone };
  }
  {
    nextReply = EN_REPLY;
    const any = await campaign(bizAny);
    let n = since();
    const a = await campaignAiService.generateReply(any.campaignId, any.recipientId, TAMIL);
    let mine = callsSince(n);
    const call = mine.find((x) => x.kind === "campaign");
    expect(!!call && !/REPLY LANGUAGE/.test(call.sys0) && a?.text === EN_REPLY, "campaign unrestricted: no rule, reply untouched", { sys: call?.sys0?.slice(-300), text: a?.text });
    expect(kinds(mine, "detect").length === 0 && kinds(mine, "rewrite").length === 0, "campaign unrestricted: no detection / correction calls", mine.map((x) => x.kind));

    const hi = await campaign(bizWaHi);
    n = since();
    const r = await campaignAiService.generateReply(hi.campaignId, hi.recipientId, ENGLISH);
    mine = callsSince(n);
    const rc = mine.find((x) => x.kind === "campaign");
    expect(/REPLY LANGUAGE/.test(rc?.sys0 || "") && /ENTIRE reply in Hindi/.test(rc?.sys0 || "") && /short friendly sentence/.test(rc?.sys0 || ""), "campaign restricted (WhatsApp Hindi-only): rule + note in the prompt", rc?.sys0?.slice(-600));
    expect(r?.text === HI_REPLY, "campaign restricted: English reply rewritten in Hindi", r?.text);
    nextReply = HI_REPLY;
    const later = await waReply(bizWaHi, hi.phone, ENGLISH); // campaign list has 10 digits, the webhook 91 + 10
    expect(/ENTIRE reply in Hindi/.test(later.main?.lastSystem || "") && !/short friendly sentence/.test(later.main?.lastSystem || ""), "the same number on the WhatsApp AI later: no second note (shared conversation memory)", later.main?.lastSystem);
  }

  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nAll social / WhatsApp reply-language checks passed.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
