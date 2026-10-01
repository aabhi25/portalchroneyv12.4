/**
 * Phase 2 "one AI brain" on WhatsApp, against a real (local) Postgres/PGlite and a fake OpenAI:
 *
 *  - knowledge comes from the website's retrieval (compact profile + relevant excerpts), not a dump
 *    of every page / document (prompt size measured before / after); keyword path without embeddings
 *  - Train Chroney instructions parsed like the website (always / conditional / fallback)
 *  - model from Master AI Settings (else gpt-4o-mini); ~20-message history window
 *  - appointment booking (slots as a numbered list → booking end-to-end) and order tracking only
 *    when the account has them, never inside a guided flow session
 *  - per-channel answer style (inherit vs override), WhatsApp-only instructions add vs replace
 *  - existing switches still work: per-source knowledge toggles, useMasterTraining, useLeadTraining,
 *    useProductCatalogKnowledge, aiResponseMode, useCaseMode
 *  - lead extraction keeps its own prompt when a persona is saved (bug fix)
 *  - 'lead_capture' colleague framing only when chosen on purpose (+ the 0010 migration rule)
 *  - an active flow session: the flow answers, none of the new tools appear
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55931/postgres?sslmode=disable \
 *   WA_BRAIN_TEST_DB=1 npx tsx server/services/__tests__/whatsappBrain.integration.test.ts
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.WA_BRAIN_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set WA_BRAIN_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.OPENAI_API_KEY = "sk-test-fake";
delete process.env.CHAT_CONTEXT_MODE;
delete process.env.CHAT_CONTEXT_LEGACY_ACCOUNTS;
delete process.env.WHATSAPP_CONTEXT_MODE;

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 700)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const textOf = (c: any) => (typeof c === "string" ? c : c == null ? "" : JSON.stringify(c));

// ── Fake OpenAI ──────────────────────────────────────────────────────────────
interface Call {
  model: string; messages: any[]; tools: string[]; system: string; allSystem: string; lastUser: string;
  main: boolean; followUp: boolean; jsonMode: boolean; toolResult?: string;
}
const calls: Call[] = [];
let lastSlotList = "";
let failModel: string | null = null; // simulate "model not found" for this model name
let fakeEmbedding: (t: string) => number[];

function answer(body: any): any {
  const msgs: any[] = body.messages || [];
  const sys0 = textOf(msgs[0]?.content);
  const toolMsgs = msgs.filter(m => m.role === "tool");
  const lastUser = textOf([...msgs].reverse().find(m => m.role === "user")?.content);
  const main = /responding to customer inquiries via WhatsApp|AI AGENT PERSONA/.test(sys0);
  const call: Call = {
    model: body.model, messages: msgs, tools: (body.tools || []).map((t: any) => t?.function?.name), system: sys0,
    allSystem: msgs.filter(m => m.role === "system").map(m => textOf(m.content)).join("\n"), lastUser,
    main, followUp: toolMsgs.length > 0, jsonMode: body.response_format?.type === "json_object",
    toolResult: toolMsgs.map(m => textOf(m.content)).join("\n") || undefined,
  };
  calls.push(call);
  if (/language detector/i.test(sys0)) return { role: "assistant", content: "en" };
  if (call.jsonMode) return { role: "assistant", content: JSON.stringify({ customer_name: null, customer_phone: null, customer_email: null, notes: null }) };
  if (!main) return { role: "assistant", content: "OK" };
  if (call.followUp) {
    const r = call.toolResult || "";
    if (/^Open slots/.test(r)) {
      lastSlotList = r;
      const lines = r.split("\n").slice(1).map(l => l.replace(/\s+\[book with[^\]]*\]/, ""));
      // A sloppy model: markdown bold + a table — the WhatsApp formatter must clean it up.
      return { role: "assistant", content: `**Available slots**\n${lines.join("\n")}\n\n| Day | Note |\n|---|---|\n| Today | Few left |\n\nReply with the number of the slot you want.` };
    }
    return { role: "assistant", content: `TOOL SAID: ${r}` };
  }
  const tools = call.tools;
  if (tools.includes("list_available_slots") && /\b(book|appointment)\b/i.test(lastUser)) {
    return { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_available_slots", arguments: "{}" } }] };
  }
  if (tools.includes("book_appointment") && /^\d$/.test(lastUser.trim()) && lastSlotList) {
    const line = lastSlotList.split("\n").find(l => l.startsWith(`${lastUser.trim()}.`)) || "";
    const m = /appointment_date=(\S+) appointment_time=(\S+?)\]/.exec(line);
    return { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "book_appointment", arguments: JSON.stringify({ patient_name: "Asha Rao", appointment_date: m?.[1], appointment_time: m?.[2] }) } }] };
  }
  if (tools.includes("track_order") && /order/i.test(lastUser)) {
    const id = /#?([A-Z]{2}\d{3,})/.exec(lastUser)?.[1] || "";
    return { role: "assistant", content: null, tool_calls: [{ id: "c3", type: "function", function: { name: "track_order", arguments: JSON.stringify({ order_id: id }) } }] };
  }
  return { role: "assistant", content: "Here is the answer you asked for." };
}

function startFakeOpenAI(): Promise<{ baseUrl: string }> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      res.setHeader("content-type", "application/json");
      if (req.url?.includes("/embeddings")) {
        const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
        return res.end(JSON.stringify({ object: "list", data: inputs.map((t, i) => ({ object: "embedding", index: i, embedding: fakeEmbedding(String(t)) })), model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } }));
      }
      if (failModel && body.model === failModel) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: { message: `The model \`${failModel}\` does not exist or you do not have access to it.`, type: "invalid_request_error", code: "model_not_found" } }));
      }
      const message = answer(body);
      res.end(JSON.stringify({
        id: "chatcmpl-fake", object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, finish_reason: message.tool_calls ? "tool_calls" : "stop", message }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` })));
}

// ── MSG91 stub ───────────────────────────────────────────────────────────────
const sent: { to: string; text: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
  if (/^https:\/\/control\.msg91\.com\//.test(target)) {
    const u = new URL(target);
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
    sent.push({ to: u.searchParams.get("recipient_number") || body?.recipient_number || "", text: u.searchParams.get("text") || body?.interactive?.body?.text || body?.caption || "" });
    return new Response(JSON.stringify({ status: "success", data: { message_uuid: `u_${sent.length}` } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

async function main() {
  const helper = await import("./helpers/fakeOpenAIChat");
  fakeEmbedding = helper.fakeEmbedding;
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and, sql } = await import("drizzle-orm");
  const { seedChatBusiness, PAGE_TOPICS } = await import("./helpers/chatContextSeed");
  const { WhatsappAutoReplyService } = await import("../whatsappAutoReplyService");
  const { whatsappService } = await import("../whatsappService");
  const { updateSession } = await import("../whatsappSessionService");
  const { businessContextCache } = await import("../businessContextCache");
  const { clearWhatsappModelCache, toWhatsAppText, formatSlotsForWhatsapp } = await import("../whatsapp/aiReplyHelpers");
  const { effectiveUseCaseMode, phase2SettingsUpdate, resolveAnswerStyle } = await import("../whatsapp/aiReplySettings");
  const { toWhatsappSettingsDto } = await import("../whatsapp/settingsDto");
  const { registerRoutes } = await import("../../routes");
  const { hashPassword, createSession } = await import("../../auth");
  const { encrypt } = await import("../encryptionService");

  const tag = crypto.randomBytes(3).toString("hex");
  const svc = new WhatsappAutoReplyService();
  let phoneSeq = 0;
  const newPhone = () => `9190${tag.replace(/\D/g, "").padEnd(4, "7").slice(0, 4)}${String(++phoneSeq).padStart(4, "0")}`;

  async function waSettings(accountId: string, extra: Record<string, any> = {}) {
    await db.insert(schema.whatsappSettings).values({
      businessAccountId: accountId, msg91AuthKey: "test-key", msg91IntegratedNumberId: "910000000000", webhookSecret: `sec-${tag}`,
      autoReplyEnabled: "true", leadCaptureEnabled: "true", whatsappEnabled: "true", ...extra,
    } as any);
  }
  async function setWa(accountId: string, values: Record<string, any>) {
    await db.update(schema.whatsappSettings).set(values as any).where(eq(schema.whatsappSettings.businessAccountId, accountId));
  }
  async function setWidget(accountId: string, values: Record<string, any>) {
    await db.update(schema.widgetSettings).set(values as any).where(eq(schema.widgetSettings.businessAccountId, accountId));
  }
  async function plainBusiness(name: string, extra: Record<string, any> = {}) {
    const [biz] = await db.insert(schema.businessAccounts).values({ name: `${name} ${tag}`, website: "https://example.com", whatsappEnabled: "true", openaiApiKey: "sk-test-fake", ...extra } as any).returning();
    const [user] = await db.insert(schema.users).values({ username: `wab_${tag}_${biz.id.slice(0, 6)}`, passwordHash: "x", role: "business_user", businessAccountId: biz.id } as any).returning();
    await db.insert(schema.widgetSettings).values({ businessAccountId: biz.id } as any).onConflictDoNothing();
    return { accountId: biz.id as string, userId: user.id as string };
  }
  /** One AI reply (the webhook has stored the incoming message first, as in production). */
  async function reply(accountId: string, phone: string, text: string) {
    await updateSession(accountId, phone);
    await whatsappService.processTextMessage(accountId, `m-${tag}-${crypto.randomBytes(4).toString("hex")}`, phone, text);
    businessContextCache.invalidateBusinessCache(accountId);
    const before = calls.length;
    const sentBefore = sent.length;
    const res = await svc.generateAndSendReply(accountId, phone, text);
    await sleep(60);
    const mine = calls.slice(before);
    return {
      res,
      main: mine.find(c => c.main && !c.followUp && c.lastUser === text),
      follow: mine.find(c => c.main && c.followUp),
      all: mine,
      sentText: sent.slice(sentBefore).filter(s => s.to === phone).map(s => s.text).join("\n"),
      stats: svc.lastContextStats,
    };
  }
  const promptChars = (c?: Call) => (c ? c.messages.filter(m => m.role === "system").reduce((n, m) => n + textOf(m.content).length, 0) : 0);

  // ── 1. Retrieval instead of the full dump; prompt size before / after ──────────
  const NW = await seedChatBusiness(db, schema, { tag });
  await waSettings(NW.accountId);
  {
    const q = "Is parking free and what is the validation code?";
    process.env.WHATSAPP_CONTEXT_MODE = "legacy";
    const legacy = await reply(NW.accountId, newPhone(), q);
    delete process.env.WHATSAPP_CONTEXT_MODE;
    const retrieval = await reply(NW.accountId, newPhone(), q);
    const before = promptChars(legacy.main), after = promptChars(retrieval.main);
    console.log(`   [prompt size] full dump (old): ${before} chars ≈ ${Math.ceil(before / 4)} tokens | retrieval (new): ${after} chars ≈ ${Math.ceil(after / 4)} tokens | ${Math.round((1 - after / before) * 100)}% smaller`);
    expect(legacy.stats?.mode === "legacy" && retrieval.stats?.mode === "retrieval", "WHATSAPP_CONTEXT_MODE=legacy keeps the old builder; default is retrieval", [legacy.stats, retrieval.stats]);
    expect(legacy.main && PAGE_TOPICS.slice(0, 40).every(t => legacy.main!.system.includes(t.fact)), "old path: every page's fact is in the prompt (full dump)");
    expect(after > 0 && after < before * 0.5, "retrieval prompt is less than half the size of the full dump", { before, after });
    expect(retrieval.main && /PK-4417/.test(retrieval.main.system), "the relevant page excerpt (parking validation code) is in the retrieval prompt", retrieval.main?.system.slice(-3000));
    const otherFacts = PAGE_TOPICS.filter(t => !/parking/i.test(t.slug)).filter(t => retrieval.main!.system.includes(t.fact));
    expect(otherFacts.length <= 6, "unrelated page facts mostly stay out of the retrieval prompt", otherFacts.map(t => t.slug));
    expect(retrieval.main && /BUSINESS OVERVIEW|BUSINESS PROFILE/.test(retrieval.main.system) && /Northwind Fitness Club/.test(retrieval.main.system), "compact business profile kept", retrieval.main?.system.slice(0, 800));
    expect(retrieval.res.success && retrieval.sentText.length > 0, "reply sent", retrieval.res);

    // FAQ match keeps the "🔒 MATCHED FAQs" shape the WhatsApp rules refer to.
    const faq = await reply(NW.accountId, newPhone(), "Do you offer a student discount?");
    expect(faq.main && /🔒 MATCHED FAQs/.test(faq.main.system) && /OFFICIAL ANSWER: Yes — students with a valid college ID get 20% off/.test(faq.main.system), "FAQ retrieved and shown as MATCHED FAQ", faq.main?.system.slice(-2500));
  }

  // ── 2. No embeddings at all: keyword path still answers ───────────────────────
  {
    const B = await plainBusiness("No embeddings", { openaiApiKey: null });
    await waSettings(B.accountId);
    await db.insert(schema.faqs).values({ businessAccountId: B.accountId, question: "What are the parking charges?", answer: `Parking costs ₹40 per hour (code NOEMB-${tag}).` } as any);
    const r = await reply(B.accountId, newPhone(), "how much are the parking charges?");
    expect(r.main && r.main.system.includes(`NOEMB-${tag}`), "FAQ without an embedding (and no account key) found by keyword matching", r.main?.system.slice(-1500));
  }

  // ── 3. Retrieval failure → safe fallback to the full context ──────────────────
  {
    const storageMod = await import("../../storage");
    const original = storageMod.storage.getAnalyzedPages.bind(storageMod.storage);
    (storageMod.storage as any).getAnalyzedPages = async () => { throw new Error("simulated outage"); };
    const r = await reply(NW.accountId, newPhone(), "What time do you open?");
    (storageMod.storage as any).getAnalyzedPages = original;
    expect(r.stats?.mode === "legacy" && r.stats?.fellBack === true && r.res.success, "retrieval error → previous context builder used, reply still sent", r.stats);
  }

  // ── 4. Custom instructions: always / conditional / fallback, like the website ──
  const instr = [
    { id: "a1", type: "always", text: `Always sign off with Team Northwind ${tag}.` },
    { id: "c1", type: "conditional", keywords: ["refund"], text: `Mention the 7-day refund window ${tag}.` },
    { id: "f1", type: "fallback", text: `Please call our desk on 080-1234 {{if_missing_phone}}and share your number{{/if_missing_phone}} ${tag}.` },
  ];
  await setWidget(NW.accountId, { customInstructions: JSON.stringify(instr) });
  {
    const r = await reply(NW.accountId, newPhone(), "can I get a refund?");
    const sys = r.main?.system || "";
    expect(sys.includes(`1. Always sign off with Team Northwind ${tag}.`), "always-on instruction in the prompt (numbered)", sys.slice(0, 3000));
    expect(sys.includes(`- When user mentions [refund]: Mention the 7-day refund window ${tag}.`), "conditional instruction listed with its keywords", sys.slice(0, 3000));
    expect(!/"type":"always"/.test(r.main?.allSystem || ""), "raw JSON no longer pasted into the prompt");
    expect(/INSTRUCTIONS FOR THIS MESSAGE[\s\S]*7-day refund window/.test(r.main?.allSystem || ""), "keyword matched → conditional instruction repeated for this message", r.main?.allSystem.slice(-1500));
    expect(/BUSINESS FALLBACK REPLY[\s\S]*080-1234/.test(sys) && !/share your number/.test(sys) && !/Please call our desk on 080-1234 \{\{/.test(sys), "fallback instruction used for [[FALLBACK]] replies (phone placeholders resolved: phone known on WhatsApp)", sys.slice(-1200));
    const r2 = await reply(NW.accountId, newPhone(), "do you have showers?");
    expect(!/INSTRUCTIONS FOR THIS MESSAGE/.test(r2.main?.allSystem || ""), "no keyword → no per-message conditional note");
    // Legacy free text keeps working.
    await setWidget(NW.accountId, { customInstructions: `Plain text instruction ${tag}` });
    const r3 = await reply(NW.accountId, newPhone(), "hello, do you have lockers?");
    expect((r3.main?.system || "").includes(`CUSTOM BUSINESS INSTRUCTIONS (FOLLOW THESE CAREFULLY):\nPlain text instruction ${tag}`), "legacy free-text instructions still applied", r3.main?.system.slice(0, 2500));
    await setWidget(NW.accountId, { customInstructions: JSON.stringify(instr) });
  }

  // ── 5. useMasterTraining / instructionsMode add vs replace (persona) ─────────
  {
    await setWa(NW.accountId, { useMasterTraining: "false" });
    let r = await reply(NW.accountId, newPhone(), "can I get a refund?");
    expect(r.main && !r.main.allSystem.includes(`Team Northwind ${tag}`) && !r.main.allSystem.includes("080-1234"), "useMasterTraining off → no Train Chroney instructions (incl. fallback)", r.main?.allSystem.slice(0, 1500));
    await setWa(NW.accountId, { useMasterTraining: "true", customPrompt: `You are Priya ${tag}, a warm membership advisor for Northwind.`, instructionsMode: "add" });
    r = await reply(NW.accountId, newPhone(), "can I get a refund?");
    const s = r.main?.system || "";
    expect(/AI AGENT PERSONA/.test(s) && s.includes(`You are Priya ${tag}`) && /SECONDARY CUSTOM BUSINESS INSTRUCTIONS[\s\S]*Team Northwind/.test(s), "mode 'add': persona + Train Chroney instructions both apply", s.slice(0, 2500));
    expect((s.match(new RegExp(`You are Priya ${tag}`, "g")) || []).length === 1, "persona text no longer duplicated inside the secondary block");
    await setWa(NW.accountId, { instructionsMode: "replace" });
    r = await reply(NW.accountId, newPhone(), "can I get a refund?");
    expect(r.main && r.main.system.includes(`You are Priya ${tag}`) && !r.main.allSystem.includes(`Team Northwind ${tag}`), "mode 'replace': persona only, Train Chroney instructions not applied", r.main?.allSystem.slice(0, 2000));
    await setWa(NW.accountId, { instructionsMode: "add", customPrompt: null });
    // Settings API helper keeps the two switches in sync.
    expect(JSON.stringify(phase2SettingsUpdate({ instructionsMode: "replace" })) === JSON.stringify({ instructionsMode: "replace", useMasterTraining: "false" }), "PUT instructionsMode=replace also turns useMasterTraining off");
    expect(JSON.stringify(phase2SettingsUpdate({ useMasterTraining: true })) === JSON.stringify({ useMasterTraining: "true", instructionsMode: "add" }), "PUT useMasterTraining=true (Flow settings switch) maps to mode add");
  }

  // ── 6. Model from Master AI Settings ─────────────────────────────────────────
  {
    clearWhatsappModelCache();
    let r = await reply(NW.accountId, newPhone(), "do you have showers?");
    expect(r.main?.model === "gpt-4o-mini", "no master settings → gpt-4o-mini", r.main?.model);
    await db.insert(schema.masterAiSettings).values({ id: 1, primaryProvider: "openai", primaryApiKey: encrypt("sk-master"), primaryModel: "gpt-4.1-mini", masterEnabled: true } as any)
      .onConflictDoUpdate({ target: schema.masterAiSettings.id, set: { primaryProvider: "openai", primaryApiKey: encrypt("sk-master"), primaryModel: "gpt-4.1-mini", masterEnabled: true } as any });
    clearWhatsappModelCache();
    r = await reply(NW.accountId, newPhone(), "do you have showers?");
    expect(r.main?.model === "gpt-4.1-mini", "master AI on (OpenAI) → its primary model, like the website", r.main?.model);
    failModel = "gpt-4.1-mini";
    r = await reply(NW.accountId, newPhone(), "do you have lockers?");
    failModel = null;
    expect(r.main?.model === "gpt-4o-mini" && r.res.success, "model not available for the key → retried with gpt-4o-mini", { model: r.main?.model, res: r.res });
    await db.update(schema.masterAiSettings).set({ primaryProvider: "gemini", primaryModel: "gemini-2.5-flash" } as any).where(eq(schema.masterAiSettings.id, 1));
    clearWhatsappModelCache();
    r = await reply(NW.accountId, newPhone(), "do you have showers?");
    expect(r.main?.model === "gpt-4o-mini", "non-OpenAI master provider → gpt-4o-mini (WhatsApp keeps the business's OpenAI key)", r.main?.model);
    await db.update(schema.masterAiSettings).set({ masterEnabled: false } as any).where(eq(schema.masterAiSettings.id, 1));
    clearWhatsappModelCache();
  }

  // ── 7. ~20-message history within 48 h ────────────────────────────────────────
  {
    const P = newPhone();
    const t0 = Date.now() - 3 * 60 * 60_000;
    const rows: any[] = [];
    for (let i = 1; i <= 30; i++) {
      rows.push({ businessAccountId: NW.accountId, senderPhone: P, rawMessage: `${i % 2 ? "customer" : "agent"} line ${i} ${tag}`, status: "message_only", direction: i % 2 ? "incoming" : "outgoing", receivedAt: new Date(t0 + i * 60_000) });
    }
    rows.push({ businessAccountId: NW.accountId, senderPhone: P, rawMessage: `very old line ${tag}`, status: "message_only", direction: "incoming", receivedAt: new Date(Date.now() - 50 * 60 * 60_000) });
    await db.insert(schema.whatsappLeads).values(rows);
    const r = await reply(NW.accountId, P, "what did I ask before?");
    const hist = (r.main?.messages || []).filter((m: any) => m.role === "user" || m.role === "assistant");
    const histTexts = hist.map((m: any) => textOf(m.content));
    expect(histTexts.includes(`customer line 13 ${tag}`) && histTexts.includes(`agent line 30 ${tag}`), "history reaches far beyond the old 6 messages (line 13 of 30 included)", histTexts);
    expect(hist.length <= 21 && hist.length >= 15, "about 20 messages kept", hist.length);
    expect(r.main?.messages.some((m: any) => m.role === "system" && /EARLIER IN THIS CONVERSATION/.test(textOf(m.content))), "older messages folded into one note");
    expect(!histTexts.some(t => t.includes("very old line")), "messages older than 48 h still excluded");
    expect(histTexts.filter(t => t === "what did I ask before?").length === 1, "current message sent once (stored copy not duplicated)", histTexts.slice(-3));
  }

  // ── 8. Appointment booking: only when enabled; slots as a numbered list; booking works ──
  {
    const A = await plainBusiness("Clinic", { appointmentsEnabled: "true" });
    await waSettings(A.accountId);
    await setWidget(A.accountId, { appointmentBookingEnabled: "true" });
    for (let d = 0; d < 7; d++) {
      await db.insert(schema.scheduleTemplates).values({ businessAccountId: A.accountId, dayOfWeek: String(d), startTime: "00:00", endTime: "23:30", slotDurationMinutes: "30", isActive: "true" } as any);
    }
    const P = newPhone();
    const r1 = await reply(A.accountId, P, "I want to book an appointment");
    expect(r1.main && r1.main.tools.includes("list_available_slots") && r1.main.tools.includes("book_appointment"), "appointments on → slot listing + booking tools offered", r1.main?.tools);
    expect(r1.main && /TOOLS ON WHATSAPP[\s\S]*never for their phone number/.test(r1.main.system), "WhatsApp booking guidance in the prompt (no phone asked)");
    const bookTool = (r1.main?.messages && null) || null; void bookTool;
    expect(r1.follow && /^Open slots/.test(r1.follow.toolResult || "") && /\n1\. \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} (AM|PM)/.test(r1.follow.toolResult || ""), "slots returned to the model as a numbered list", r1.follow?.toolResult?.slice(0, 300));
    expect(/^1\. \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} (AM|PM)$/m.test(r1.sentText) && !/\*\*|\|---|\| Day/.test(r1.sentText) && /\*Available slots\*/.test(r1.sentText), "WhatsApp text: numbered slots, no markdown table / **bold**", r1.sentText);
    const r2 = await reply(A.accountId, P, "2");
    expect(r2.main && r2.main.tools.includes("book_appointment"), "a bare number after the slot list keeps booking available", r2.main?.tools);
    expect(r2.follow && /booked your appointment/i.test(r2.follow.toolResult || ""), "book_appointment executed by the website handler", r2.follow?.toolResult);
    const appts = await db.select().from(schema.appointments).where(eq(schema.appointments.businessAccountId, A.accountId));
    expect(appts.length === 1 && appts[0].patientName === "Asha Rao" && appts[0].patientPhone === P && appts[0].status === "confirmed", "appointment row created with the WhatsApp number as phone", appts.map(a => ({ n: a.patientName, p: a.patientPhone, t: a.appointmentTime })));
    expect(/booked your appointment/i.test(r2.sentText), "booking confirmation sent on WhatsApp", r2.sentText);

    // Widget booking switch off → not offered (same rule as the website).
    await setWidget(A.accountId, { appointmentBookingEnabled: "false" });
    const r3 = await reply(A.accountId, newPhone(), "I want to book an appointment");
    expect(r3.main && !r3.main.tools.includes("list_available_slots") && !r3.main.tools.includes("book_appointment"), "widget booking off → no appointment tools", r3.main?.tools);
    // Account without the feature → never offered.
    const r4 = await reply(NW.accountId, newPhone(), "I want to book an appointment");
    expect(r4.main && !r4.main.tools.some(t => ["list_available_slots", "book_appointment", "track_order", "initiate_return"].includes(t)) && !/TOOLS ON WHATSAPP/.test(r4.main.system), "account without appointments / orders → none of the new tools", r4.main?.tools);
    await setWidget(A.accountId, { appointmentBookingEnabled: "true" });

    // Active guided flow session → no appointment tools (the flow owns the conversation).
    const P2 = newPhone();
    const [flow] = await db.insert(schema.whatsappFlows).values({ businessAccountId: A.accountId, name: "Intake", isActive: "true" } as any).returning();
    await db.insert(schema.whatsappFlowSessions).values({ businessAccountId: A.accountId, flowId: flow.id, senderPhone: P2, currentStepKey: "s1", status: "active", collectedData: {}, lastMessageAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } as any);
    const r5 = await reply(A.accountId, P2, "I want to book an appointment");
    expect(r5.main && !r5.main.tools.includes("list_available_slots") && !r5.main.tools.includes("book_appointment") && !/TOOLS ON WHATSAPP/.test(r5.main.system), "active flow session → appointment tools off", r5.main?.tools);
    await db.update(schema.whatsappFlows).set({ isActive: "false" } as any).where(eq(schema.whatsappFlows.id, flow.id));
  }

  // ── 9. Order tracking only when enabled ───────────────────────────────────────
  {
    const O = await plainBusiness("Shop", { demoOrdersEnabled: "true" });
    await waSettings(O.accountId);
    await db.insert(schema.demoOrders).values({ businessAccountId: O.accountId, orderId: "#LB1001", customerName: "Asha", customerPhone: "9876543210", productName: "Blue kurta", status: "shipped", courier: "Delhivery", trackingNumber: "DLV123", amount: "1299" } as any);
    const r = await reply(O.accountId, newPhone(), "where is my order LB1001?");
    expect(r.main && r.main.tools.includes("track_order") && !r.main.tools.includes("show_order_lookup_options"), "orders on → track_order offered (no UI-only lookup-options tool)", r.main?.tools);
    expect(r.follow && /Order #LB1001: Shipped \| item: Blue kurta[\s\S]*courier: Delhivery \| tracking no\.: DLV123/.test(r.follow.toolResult || ""), "order status returned as plain lines", r.follow?.toolResult);
    expect(/Shipped/.test(r.sentText), "order status sent", r.sentText);
    const off = await plainBusiness("Shop off");
    await waSettings(off.accountId);
    const r2 = await reply(off.accountId, newPhone(), "where is my order LB1001?");
    expect(r2.main && !r2.main.tools.includes("track_order"), "orders off → no track_order", r2.main?.tools);
  }

  // ── 10. Answer style per channel: inherit vs override ─────────────────────────
  {
    await setWidget(NW.accountId, { personality: "professional", responseLength: "concise" });
    let r = await reply(NW.accountId, newPhone(), "do you have showers?");
    expect(r.main && /Personality \(professional\)/.test(r.main.system) && /RESPONSE LENGTH: CONCISE/.test(r.main.system), "WhatsApp style NULL → inherits website personality + length", r.main?.system.slice(-2500));
    await setWa(NW.accountId, { personality: "funny", responseLength: "detailed" });
    r = await reply(NW.accountId, newPhone(), "do you have showers?");
    expect(r.main && /Personality \(funny\)/.test(r.main.system) && /RESPONSE LENGTH: DETAILED/.test(r.main.system) && !/Personality \(professional\)/.test(r.main.system), "WhatsApp style set → overrides the website's");
    await setWa(NW.accountId, { personality: null, responseLength: null, customPrompt: `Persona ${tag}` });
    r = await reply(NW.accountId, newPhone(), "do you have showers?");
    expect(r.main && !/Personality \(/.test(r.main.system) && /RESPONSE LENGTH: CONCISE/.test(r.main.system), "persona mode: inherited personality not added (persona sets the tone), length still applies");
    await setWa(NW.accountId, { personality: "polite" });
    r = await reply(NW.accountId, newPhone(), "do you have showers?");
    expect(r.main && /Personality \(polite\)/.test(r.main.system), "persona mode + WhatsApp personality picked → applied");
    await setWa(NW.accountId, { personality: null, customPrompt: null });
    const style = resolveAnswerStyle({ personality: "bogus" } as any, { personality: "casual", responseLength: "detailed" } as any);
    expect(style.personality === "casual" && style.responseLength === "detailed" && !style.personalityFromWhatsapp, "invalid WhatsApp value → website value");
  }

  // ── 11. Existing switches still have their effect ─────────────────────────────
  {
    const faqQ = "Do you offer a student discount?";
    await setWa(NW.accountId, { useFaqKnowledge: "false" });
    let r = await reply(NW.accountId, newPhone(), faqQ);
    expect(r.main && !/OFFICIAL ANSWER: Yes — students/.test(r.main.system), "useFaqKnowledge off → FAQ not used", r.main?.system.slice(-1500));
    await setWa(NW.accountId, { useFaqKnowledge: "true", useDocumentKnowledge: "false" });
    r = await reply(NW.accountId, newPhone(), "How much notice do I need to cancel a personal training session?");
    expect(r.main && !/48 hours notice/.test(r.main.system), "useDocumentKnowledge off → document excerpts not used", r.main?.system.slice(-1500));
    await setWa(NW.accountId, { useDocumentKnowledge: "true" });
    r = await reply(NW.accountId, newPhone(), "How much notice do I need to cancel a personal training session?");
    expect(r.main && /48 hours notice/.test(r.main.system), "useDocumentKnowledge on → document excerpt used", r.main?.system.slice(-1500));
    await setWa(NW.accountId, { useWebsiteKnowledge: "false" });
    r = await reply(NW.accountId, newPhone(), "Is parking free and what is the validation code?");
    expect(r.main && !/PK-4417/.test(r.main.system) && !/Northwind Fitness Club is a premium gym/.test(r.main.system), "useWebsiteKnowledge off → no website pages / analysis", r.main?.system.slice(0, 1500));
    await setWa(NW.accountId, { useWebsiteKnowledge: "true" });

    const S = await plainBusiness("Store");
    await waSettings(S.accountId);
    await db.insert(schema.products).values({ businessAccountId: S.accountId, name: "Red Sneakers", description: "Running shoes", price: "2999" } as any);
    r = await reply(S.accountId, newPhone(), "show me your products");
    expect(r.main && r.main.tools.includes("get_products"), "products + catalog on → get_products offered (unchanged)", r.main?.tools);
    await setWa(S.accountId, { useProductCatalogKnowledge: "false" });
    r = await reply(S.accountId, newPhone(), "show me your products");
    expect(r.main && !r.main.tools.includes("get_products"), "useProductCatalogKnowledge off → no product tool", r.main?.tools);

    const L = await plainBusiness("Leads");
    await waSettings(L.accountId);
    await setWidget(L.accountId, { leadTrainingConfig: { fields: [{ id: "name", enabled: true, required: false, priority: 1, captureStrategy: "start" }], captureStrategy: "custom" } });
    r = await reply(L.accountId, newPhone(), "hello, I have a question");
    expect(r.main && /📋 LEAD CAPTURE/.test(r.main.allSystem), "useLeadTraining on → lead instruction present", r.main?.allSystem.slice(-800));
    await setWa(L.accountId, { useLeadTraining: "false" });
    r = await reply(L.accountId, newPhone(), "hello, I have a question");
    expect(r.main && !/📋 LEAD CAPTURE/.test(r.main.allSystem), "useLeadTraining off → no lead instruction");
  }

  // ── 12. Colleague framing only when chosen on purpose ─────────────────────────
  {
    const C = await plainBusiness("Colleague");
    await waSettings(C.accountId, { customPrompt: `Persona ${tag}`, useCaseMode: "lead_capture", useCaseModeExplicit: "false" });
    let r = await reply(C.accountId, newPhone(), "hi, tell me about your plans");
    expect(r.main && /DIRECT SALES MODE/.test(r.main.system) && !/LEAD CAPTURE MODE/.test(r.main.system), "old default 'lead_capture' never chosen → no colleague framing (direct sales)", r.main?.system.slice(0, 600));
    await setWa(C.accountId, { useCaseModeExplicit: "true" });
    r = await reply(C.accountId, newPhone(), "hi, tell me about your plans");
    expect(r.main && /LEAD CAPTURE MODE/.test(r.main.system) && /NOT the end customer/.test(r.main.system), "explicitly chosen 'lead_capture' (e.g. Caprion dealers) → colleague framing kept", r.main?.system.slice(0, 600));
    await setWa(C.accountId, { useCaseMode: "customer_support", useCaseModeExplicit: "false" });
    r = await reply(C.accountId, newPhone(), "hi, tell me about your plans");
    expect(r.main && /CUSTOMER SUPPORT MODE/.test(r.main.system), "useCaseMode customer_support still applied");
    expect(effectiveUseCaseMode({ useCaseMode: "lead_capture", useCaseModeExplicit: "false" }) === "direct_sales" && effectiveUseCaseMode({ useCaseMode: "lead_capture", useCaseModeExplicit: "true" }) === "lead_capture" && effectiveUseCaseMode({ useCaseMode: "direct_sales" }) === "direct_sales", "effectiveUseCaseMode rule");
    const [row] = await db.select().from(schema.whatsappSettings).where(eq(schema.whatsappSettings.businessAccountId, C.accountId));
    expect(toWhatsappSettingsDto({ ...row, useCaseMode: "lead_capture", useCaseModeExplicit: "false" }).useCaseMode === "direct_sales", "settings DTO shows the mode the AI actually uses");
    const def = (await db.execute(sql`SELECT column_default FROM information_schema.columns WHERE table_name = 'whatsapp_settings' AND column_name = 'use_case_mode'`)).rows as any[];
    expect(/direct_sales/.test(String(def[0]?.column_default)), "schema default for new rows is now 'direct_sales'", def);
  }

  // ── 13. 0010 data migration rule (re-run the migration's statements on seeded rows) ──
  {
    const mk = async (label: string, values: Record<string, any>, withFlow = false) => {
      const b = await plainBusiness(`Mig ${label}`);
      await waSettings(b.accountId, values);
      if (withFlow) await db.insert(schema.whatsappFlows).values({ businessAccountId: b.accountId, name: "Dealer journey", isActive: "false" } as any);
      // As before the migration: nothing explicit yet.
      await setWa(b.accountId, { useCaseModeExplicit: "false", instructionsMode: "add" });
      return b.accountId;
    };
    const plain = await mk("plain", { useCaseMode: "lead_capture" });
    const caprion = await mk("caprion", { useCaseMode: "lead_capture", customPrompt: "Collect customer details" }, true);
    const flowOnly = await mk("flowonly", { useCaseMode: "lead_capture", leadGenerationMode: "flow_only" });
    const sales = await mk("sales", { useCaseMode: "direct_sales" });
    const dealerPersona = await mk("dealer", { useCaseMode: "lead_capture", customPrompt: "You help our dealers and salesmen submit leads for their customers." });
    const custPersona = await mk("cust", { useCaseMode: "lead_capture", customPrompt: "You are a friendly assistant for shoppers." });
    const masterOff = await mk("masteroff", { useCaseMode: "direct_sales", useMasterTraining: "false" });
    const file = fs.readFileSync(path.resolve(process.cwd(), "migrations/0010_training_channels.sql"), "utf8");
    for (const stmt of file.split("--> statement-breakpoint")) {
      const body = stmt.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").trim();
      if (body) await db.execute(sql.raw(body));
    }
    const get = async (id: string) => (await db.select().from(schema.whatsappSettings).where(eq(schema.whatsappSettings.businessAccountId, id)))[0] as any;
    expect((await get(plain)).useCaseModeExplicit === "false", "migration: plain lead_capture default (no flows, no persona hint) → not explicit → direct sales from now on");
    expect((await get(caprion)).useCaseModeExplicit === "true", "migration: account with WhatsApp flows (Caprion-like) → keeps lead_capture framing");
    expect((await get(flowOnly)).useCaseModeExplicit === "true", "migration: flow-only lead mode → keeps lead_capture framing");
    expect((await get(sales)).useCaseModeExplicit === "true", "migration: non-default mode recorded as explicit");
    expect((await get(dealerPersona)).useCaseModeExplicit === "true", "migration: persona about dealers / salesmen submitting leads → keeps lead_capture");
    expect((await get(custPersona)).useCaseModeExplicit === "false", "migration: ordinary customer persona → direct sales");
    expect((await get(masterOff)).instructionsMode === "replace" && (await get(plain)).instructionsMode === "add", "migration: useMasterTraining off → instructions mode 'replace' (website instructions stay off)");
  }

  // ── 14. Settings API: new fields, explicit use case mode, DTO ─────────────────
  {
    const W = await plainBusiness("Api");
    await waSettings(W.accountId, { useCaseMode: "lead_capture", useCaseModeExplicit: "false" });
    await db.update(schema.users).set({ passwordHash: await hashPassword(crypto.randomBytes(12).toString("hex")) } as any).where(eq(schema.users.id, W.userId));
    const session = await createSession(W.userId);
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use(cookieParser());
    const server = await registerRoutes(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const api = async (method: string, p: string, body?: any) => {
      const r = await fetch(base + p, { method, headers: { "content-type": "application/json", cookie: `session=${session}`, origin: base }, body: body ? JSON.stringify(body) : undefined });
      let json: any = null; try { json = await r.json(); } catch {}
      return { status: r.status, json };
    };
    let g = await api("GET", "/api/whatsapp/settings");
    expect(g.status === 200 && g.json.settings.useCaseMode === "direct_sales" && g.json.settings.instructionsMode === "add" && g.json.settings.personality === null && g.json.websiteAnswerStyle?.personality === "friendly", "GET: effective mode, instructions mode, inherited style", g.json && { s: { m: g.json.settings?.useCaseMode, i: g.json.settings?.instructionsMode }, w: g.json.websiteAnswerStyle });
    expect(g.json && !("msg91AuthKey" in g.json.settings) && !("webhookSecret" in g.json.settings), "GET still redacts credentials");
    let p = await api("PUT", "/api/whatsapp/settings", { useCaseMode: "lead_capture", personality: "casual", responseLength: "bogus", instructionsMode: "replace" });
    const after = (await db.select().from(schema.whatsappSettings).where(eq(schema.whatsappSettings.businessAccountId, W.accountId)))[0] as any;
    expect(p.status === 200 && after.useCaseMode === "lead_capture" && after.useCaseModeExplicit === "true" && p.json.useCaseMode === "lead_capture", "PUT useCaseMode → saved as an explicit choice (colleague framing now applies)", { status: p.status, after: { m: after.useCaseMode, e: after.useCaseModeExplicit } });
    expect(after.personality === "casual" && after.responseLength === null && after.instructionsMode === "replace" && after.useMasterTraining === "false", "PUT personality / responseLength (invalid → inherit) / instructionsMode (syncs useMasterTraining)", after);
    p = await api("PUT", "/api/whatsapp/settings", { useMasterTraining: true, newApplicationCooldownDays: 7 });
    const after2 = (await db.select().from(schema.whatsappSettings).where(eq(schema.whatsappSettings.businessAccountId, W.accountId)))[0] as any;
    expect(after2.useMasterTraining === "true" && after2.instructionsMode === "add" && p.json.useMasterTraining === true, "Flow-settings save (useMasterTraining) still works and switches mode back to add", after2 && { m: after2.useMasterTraining, i: after2.instructionsMode });
    p = await api("PUT", "/api/whatsapp/settings", { personality: null });
    const after3 = (await db.select().from(schema.whatsappSettings).where(eq(schema.whatsappSettings.businessAccountId, W.accountId)))[0] as any;
    expect(after3.personality === null, "PUT personality null → back to inherit");

    // ── 14b. Through the real MSG91 webhook: aiResponseMode, and a flow session in progress ──
    let seq = 0;
    async function webhook(accountId: string, phone: string, text: string): Promise<{ main: Call[]; sentText: string }> {
      const before = calls.length, sentBefore = sent.length;
      const r = await fetch(`${base}/api/webhook/msg91/${accountId}?secret=sec-${tag}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerNumber: phone, text, contentType: "text", direction: "0", uuid: `wh-${tag}-${++seq}` }),
      });
      if (r.status !== 200) throw new Error(`webhook ${r.status}`);
      for (let i = 0; i < 80; i++) { if (sent.length > sentBefore) break; await sleep(50); }
      await sleep(400);
      return { main: calls.slice(before).filter(c => c.main && c.lastUser === text), sentText: sent.slice(sentBefore).filter(s => s.to === phone).map(s => s.text).join("\n") };
    }
    const M = await plainBusiness("Modes", { appointmentsEnabled: "true", demoOrdersEnabled: "true" });
    await waSettings(M.accountId);
    await setWidget(M.accountId, { appointmentBookingEnabled: "true" });
    let w = await webhook(M.accountId, newPhone(), "do you have parking?");
    expect(w.main.length === 1 && w.sentText.length > 0, "aiResponseMode null (legacy): AI replies to a free-text message", { calls: w.main.length, sent: w.sentText });
    await setWa(M.accountId, { aiResponseMode: "guided_flows" });
    w = await webhook(M.accountId, newPhone(), "do you have parking?");
    expect(w.main.length === 1, "aiResponseMode guided_flows with no active flow: the flow service hands over to AI (as before)", w.main.length);
    await setWa(M.accountId, { aiResponseMode: null });

    // A guided journey in progress: the flow answers the step; no AI reply, none of the new tools.
    const { whatsappFlowService } = await import("../whatsappFlowService");
    const [flow] = await db.insert(schema.whatsappFlows).values({ businessAccountId: M.accountId, name: "Dealer journey", isActive: "true", completionMessage: `Thanks, recorded ${tag}` } as any).returning();
    await db.insert(schema.whatsappFlowSteps).values({ flowId: flow.id, stepKey: "ask_city", stepOrder: 1, type: "text", prompt: "Which city are you in?" } as any);
    whatsappFlowService.invalidateFlowCache(M.accountId);
    const startSession = async () => {
      const phone = newPhone();
      await db.insert(schema.whatsappFlowSessions).values({ businessAccountId: M.accountId, flowId: flow.id, senderPhone: phone, currentStepKey: "ask_city", status: "active", collectedData: {}, lastMessageAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } as any);
      await updateSession(M.accountId, phone);
      return phone;
    };
    const sessionOf = async (phone: string) => (await db.select().from(schema.whatsappFlowSessions).where(and(eq(schema.whatsappFlowSessions.businessAccountId, M.accountId), eq(schema.whatsappFlowSessions.senderPhone, phone))))[0] as any;
    const FP = await startSession();
    w = await webhook(M.accountId, FP, "Mumbai");
    const sess = await sessionOf(FP);
    expect(w.main.length === 0 && w.sentText.includes(`Thanks, recorded ${tag}`) && sess?.status !== "active", "flow session: the step answer is handled by the flow (journey completed), no AI reply", { main: w.main.map(c => c.tools), status: sess?.status, sent: w.sentText });
    expect(!w.main.some(c => c.tools.some(t => ["list_available_slots", "book_appointment", "track_order", "initiate_return"].includes(t))), "flow session: no appointment / order tools anywhere");
    // smart_ai bypasses flows: the same situation goes to the AI (unchanged switch).
    await setWa(M.accountId, { aiResponseMode: "smart_ai" });
    const SP2 = await startSession();
    w = await webhook(M.accountId, SP2, "Pune");
    const sess2 = await sessionOf(SP2);
    expect(w.main.length === 1 && !w.sentText.includes(`Thanks, recorded ${tag}`) && sess2?.status === "active", "aiResponseMode smart_ai: flows bypassed, AI answers", { main: w.main.length, status: sess2?.status, sent: w.sentText });
    await setWa(M.accountId, { aiResponseMode: null });
    server.close();
  }

  // ── 15. Lead extraction keeps its own prompt when a persona is saved ──────────
  {
    const X = await plainBusiness("Extraction");
    await waSettings(X.accountId, { customPrompt: `You are Priya ${tag}. Never output JSON. Always reply warmly.` });
    const before = calls.length;
    await whatsappService.processTextMessage(X.accountId, `x-${tag}`, newPhone(), "Hi, I am Ravi, my email is ravi@example.com");
    const ex = calls.slice(before).find(c => c.jsonMode);
    expect(ex && /^You are a lead extraction assistant/.test(ex.system) && !ex.system.includes(`Priya ${tag}`), "extraction uses the extraction prompt, not the persona", ex?.system.slice(0, 200));
  }

  // ── 16. Small helpers ─────────────────────────────────────────────────────────
  {
    const t = toWhatsAppText("## Slots\n**Mon** <b>10 AM</b>\n| a | b |\n|---|---|\n| 1 | 2 |\n[Book](https://x.example)");
    expect(t === "*Slots*\n*Mon* 10 AM\na — b\n1 — 2\nBook: https://x.example", "toWhatsAppText cleans markdown / HTML / tables / links", t);
    const s = formatSlotsForWhatsapp({ success: true, data: { slots: { "2026-10-05": ["09:00", "09:30", "10:00", "10:30", "11:00"], "2026-10-06": ["14:00"] } } });
    expect(s.count === 5 && /^1\. Mon 5 Oct, 9:00 AM/m.test(s.text) && /^5\. Tue 6 Oct, 2:00 PM/m.test(s.text), "slots formatted as a numbered list (max 4 per day)", s.text);
  }

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
