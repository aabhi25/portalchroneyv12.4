/**
 * Campaign results + Campaign replies, against a real (local) Postgres/PGlite, a fake OpenAI
 * server and a fake WhatsApp sender (nothing leaves the machine):
 *
 *  - results funnel API: Sent → Delivered → Read → Replied → Interested (positive outcome categories)
 *  - replies inbox API: search (name / phone / message text), filters (campaign, outcome,
 *    needs human, AI paused, unread), tenant isolation
 *  - staff takeover: manual reply recorded as sent by staff (fake sender), blocked outside the
 *    24-hour window, AI paused / resumed per customer; paused → campaign AI never auto-replies
 *  - automatic handover: angry / "talk to a human" / "kisi insaan se baat karao" → one polite
 *    handover message (in the customer's language), AI paused, flagged Needs human, never twice
 *    (also with two messages at once); the model's own [[HANDOVER]] signal
 *  - campaign AI uses the shared WhatsApp knowledge retrieval + identity block + campaign
 *    instructions; if retrieval fails it still replies with the old knowledge builder
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55442/postgres?sslmode=disable \
 *   CAMPAIGN_TEST_DB=1 npx tsx server/services/__tests__/campaignReplies.integration.test.ts
 */
import crypto from "crypto";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.CAMPAIGN_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set CAMPAIGN_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.OPENAI_API_KEY = "sk-test-fake";
for (const k of ["CHAT_CONTEXT_MODE", "CHAT_CONTEXT_LEGACY_ACCOUNTS", "WHATSAPP_CONTEXT_MODE"]) delete process.env[k];

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 900)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const textOf = (c: any) => (typeof c === "string" ? c : c == null ? "" : JSON.stringify(c));

// ── Fake OpenAI ──────────────────────────────────────────────────────────────
interface Call { kind: "campaign" | "translate" | "other"; system: string; lastUser: string }
const calls: Call[] = [];
let nextCampaignReply = "Happy to help — our team will share the details.";
function answer(body: any): string {
  const msgs: any[] = body.messages || [];
  const system = textOf(msgs[0]?.content);
  const lastUser = textOf([...msgs].reverse().find((m) => m.role === "user")?.content);
  let kind: Call["kind"] = "other";
  if (/Channel: WhatsApp\. Keep replies short/.test(system)) kind = "campaign";
  else if (/^Translate the customer-facing message below into/.test(system)) kind = "translate";
  calls.push({ kind, system, lastUser });
  if (body.response_format?.type === "json_object") return "{}";
  if (kind === "campaign") return nextCampaignReply;
  if (kind === "translate") return `${/Hinglish/.test(system) ? "HINGLISH" : /Hindi/.test(system) ? "HINDI" : "TRANSLATED"}: ${lastUser}`;
  return "OK";
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
      const content = answer(body);
      res.end(JSON.stringify({
        id: "chatcmpl-fake", object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`)));
}

// Nothing may reach MSG91 / Meta from this test.
const realFetch = globalThis.fetch;
let blockedFetches = 0;
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
  blockedFetches++;
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

async function main() {
  process.env.OPENAI_BASE_URL = await startFakeOpenAI();

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { encrypt } = await import("../encryptionService");
  const { createSession } = await import("../../auth");
  const { campaignAiService, campaignAiDeps } = await import("../campaignAiService");
  const replies = await import("../campaignRepliesService");
  const { HANDOVER_MESSAGE, detectHandover } = await import("../campaignHandover");
  const { registerCampaignRepliesRoutes } = await import("../../routes/campaignReplies");
  const { businessContextCache } = await import("../businessContextCache");

  const R = schema.marketingCampaignRecipients;
  const M = schema.marketingCampaignMessages;
  const tag = crypto.randomBytes(3).toString("hex");
  let seq = 0;
  const newPhone = () => `98${String(Date.now()).slice(-4)}${String(++seq).padStart(4, "0")}`;
  const HOUR = 60 * 60 * 1000;

  async function business(name: string) {
    const [biz] = await db.insert(schema.businessAccounts).values({
      name: `${name} ${tag}`, website: "https://example.com", whatsappEnabled: "true", whatsappMarketingEnabled: "true", openaiApiKey: encrypt("sk-test-fake"),
    } as any).returning();
    const [user] = await db.insert(schema.users).values({ username: `cr_${tag}_${biz.id.slice(0, 6)}`, passwordHash: "x", role: "business_user", businessAccountId: biz.id } as any).returning();
    await db.insert(schema.widgetSettings).values({ businessAccountId: biz.id } as any).onConflictDoNothing();
    await db.insert(schema.whatsappSettings).values({
      businessAccountId: biz.id, msg91AuthKey: "test-key", msg91IntegratedNumberId: "910000000000", webhookSecret: `sec-${tag}-${biz.id.slice(0, 4)}`,
      autoReplyEnabled: "true", leadCaptureEnabled: "false", whatsappEnabled: "true",
    } as any);
    return { id: biz.id as string, userId: user.id as string };
  }
  const CLASSES = [
    { key: "INTERESTED", label: "Interested", description: "Wants to go ahead" },
    { key: "NOT_INTERESTED", label: "Not interested", description: "Declines" },
    { key: "CALL_LATER", label: "Call back later", description: "Asks to be contacted later" },
  ];
  async function campaign(bizId: string, extra: Record<string, unknown> = {}) {
    const [tpl] = await db.insert(schema.whatsappTemplates).values({ businessAccountId: bizId, name: `t${++seq}`, bodyText: "Hi {{1}}, your demo class is tomorrow.", paramCount: 1, status: "approved" } as any).returning();
    const [c] = await db.insert(schema.marketingCampaigns).values({
      businessAccountId: bizId, name: `Demo push ${++seq}`, templateId: tpl.id, templateParams: ["{{name}}"], groupIds: [], status: "completed",
      aiEnabled: "true", aiDailyTokenBudget: 1000000, aiMaxRepliesPerRecipient: 50, replyClassifications: CLASSES, ...extra,
    } as any).returning();
    return c;
  }
  async function recipient(bizId: string, campaignId: string, v: Record<string, unknown> = {}) {
    const [row] = await db.insert(R).values({ campaignId, businessAccountId: bizId, phone: newPhone(), name: `Cust ${seq}`, status: "replied", sentAt: new Date(Date.now() - 2 * HOUR), firstReplyAt: new Date(Date.now() - HOUR), ...v } as any).returning();
    return row;
  }
  async function inbound(bizId: string, r: { id: string; campaignId: string }, body: string, agoMs = HOUR) {
    await db.insert(M).values({ campaignId: r.campaignId, recipientId: r.id, businessAccountId: bizId, direction: "inbound", body, createdAt: new Date(Date.now() - agoMs) } as any);
  }
  const rowOf = async (id: string) => (await db.select().from(R).where(eq(R.id, id)))[0];
  const campaignCallsSince = (n: number) => calls.slice(n).filter((c) => c.kind === "campaign");

  const A = await business("Replies A");
  const B = await business("Replies B");

  // ── HTTP app with the real auth + the new routes ──────────────────────────
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  registerCampaignRepliesRoutes(app, (_req, _res, next) => next());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sessionA = await createSession(A.userId);
  const sessionB = await createSession(B.userId);
  const api = async (method: string, p: string, body?: any, session = sessionA) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json", cookie: `session=${session}`, origin: base }, body: body ? JSON.stringify(body) : undefined });
    let json: any = null; try { json = await r.json(); } catch {}
    return { status: r.status, json };
  };

  // Fake WhatsApp sender for staff replies.
  const sent: { biz: string; phone: string; text: string }[] = [];
  replies.campaignRepliesDeps.sendText = async (biz: string, phone: string, text: string) => {
    sent.push({ biz, phone, text });
    return { success: true, messageId: `wamid-${sent.length}` };
  };

  // ── 1. Funnel API ─────────────────────────────────────────────────────────
  console.log("\n— Results funnel —");
  {
    const c = await campaign(A.id);
    for (const status of ["pending", "sent", "delivered", "read", "failed"]) await recipient(A.id, c.id, { status, firstReplyAt: null });
    await recipient(A.id, c.id, { status: "replied", primaryClassification: "INTERESTED" });
    await recipient(A.id, c.id, { status: "replied", primaryClassification: "NOT_INTERESTED" });
    await recipient(A.id, c.id, { status: "opted_out", firstReplyAt: new Date(), primaryClassification: "INTERESTED" });
    const f = await api("GET", `/api/whatsapp/campaigns/${c.id}/funnel`);
    const j = f.json || {};
    expect(f.status === 200 && j.total === 8 && j.sent === 5 && j.delivered === 4 && j.read === 3, "funnel: sent / delivered / read count everyone who got that far", j);
    expect(j.replied === 3 && j.interested === 2, "funnel: replied = anyone who replied; interested = positive outcomes only", j);
    expect(JSON.stringify(j.interestedLabels) === JSON.stringify(["Interested"]), "funnel: only the positive category counts as Interested (not 'Not interested' / 'Call back later')", j.interestedLabels);
    expect(!("aiTokensUsedToday" in j) && !JSON.stringify(j).includes("cost"), "funnel: no cost / AI usage in the response");
    const other = await api("GET", `/api/whatsapp/campaigns/${c.id}/funnel`, undefined, sessionB);
    expect(other.status === 404, "funnel: another business can't read it", other.status);
    expect(replies.isPositiveClassification({ key: "PTP", label: "Promise to pay" }) && replies.isPositiveClassification({ key: "booked", label: "Booked" }) && !replies.isPositiveClassification({ key: "WRONG_NUMBER", label: "Wrong number" }), "positive outcome detection: PTP / booked yes, wrong number no");
  }

  // ── 2. AI paused → no auto reply ──────────────────────────────────────────
  console.log("\n— AI pause / resume —");
  const c2 = await campaign(A.id);
  {
    const r = await recipient(A.id, c2.id);
    await inbound(A.id, r, "What time is the class?");
    let n = calls.length;
    const before = await campaignAiService.generateReply(c2.id, r.id, "What time is the class?");
    expect(!!before?.text && campaignCallsSince(n).length === 1, "AI on: replies", before);

    const p = await api("POST", `/api/whatsapp/campaign-replies/${r.id}/ai`, { paused: true });
    expect(p.status === 200 && (await rowOf(r.id)).aiPaused === true, "pause API: AI paused for this customer", p);
    n = calls.length;
    const paused = await campaignAiService.generateReply(c2.id, r.id, "Hello? Any update?");
    expect(paused?.text === "" && paused?.blockedReason === "ai_paused" && campaignCallsSince(n).length === 0, "AI paused: no auto reply and no AI call", paused);

    const bp = await api("POST", `/api/whatsapp/campaign-replies/${r.id}/ai`, { paused: false }, sessionB);
    expect(bp.status === 404 && (await rowOf(r.id)).aiPaused === true, "another business can't resume it", bp.status);
    const resume = await api("POST", `/api/whatsapp/campaign-replies/${r.id}/ai`, { paused: false });
    n = calls.length;
    const after = await campaignAiService.generateReply(c2.id, r.id, "What time is the class?");
    expect(resume.status === 200 && !!after?.text && campaignCallsSince(n).length === 1, "resumed: AI replies again", after);
  }

  // ── 3. Manual staff reply ─────────────────────────────────────────────────
  console.log("\n— Staff takeover (manual reply) —");
  {
    const r = await recipient(A.id, c2.id, { name: "Meera Staffcase" });
    await inbound(A.id, r, "Can someone confirm my seat?", 2 * HOUR);
    const send = await api("POST", `/api/whatsapp/campaign-replies/${r.id}/reply`, { text: "Hi Meera, your seat is confirmed. – Priya" });
    const msgs = await db.select().from(M).where(eq(M.recipientId, r.id));
    const staffMsg = msgs.find((m) => m.direction === "outbound_staff");
    expect(send.status === 200 && sent.length === 1 && sent[0].text === "Hi Meera, your seat is confirmed. – Priya" && sent[0].biz === A.id, "manual reply sent through the WhatsApp sender", { status: send.status, json: send.json, sent });
    expect(!!staffMsg && (staffMsg.metadata as any)?.source === "staff" && (staffMsg.metadata as any)?.messageId === "wamid-1", "manual reply recorded in the thread as sent by staff", staffMsg);
    const row = await rowOf(r.id);
    expect(row.aiPaused === true && row.aiPausedReason === "staff", "staff reply pauses the AI for this customer (takeover)", { p: row.aiPaused, why: row.aiPausedReason });
    const thread = await api("GET", `/api/whatsapp/campaign-replies/${r.id}`);
    expect(thread.status === 200 && thread.json.window.open === true && thread.json.messages.some((m: any) => m.direction === "outbound_staff"), "thread API: staff message + open window", thread.json?.window);

    // Outside the 24-hour window → blocked, nothing sent, nothing recorded.
    const old = await recipient(A.id, c2.id, { name: "Old Window" });
    await inbound(A.id, old, "ok", 25 * HOUR);
    const sentBefore = sent.length;
    const closed = await api("POST", `/api/whatsapp/campaign-replies/${old.id}/reply`, { text: "Are you still there?" });
    const oldMsgs = await db.select().from(M).where(eq(M.recipientId, old.id));
    expect(closed.status === 409 && closed.json?.code === "window_closed" && /24 hours/.test(closed.json?.error || ""), "manual reply blocked outside the 24-hour window, with a clear message", closed);
    expect(sent.length === sentBefore && !oldMsgs.some((m) => m.direction === "outbound_staff"), "blocked reply: nothing sent, nothing recorded");
    const oldThread = await api("GET", `/api/whatsapp/campaign-replies/${old.id}`);
    expect(oldThread.json?.window?.open === false, "thread API: window shows closed", oldThread.json?.window);

    // A newer WhatsApp message from the same customer (outside the campaign thread) reopens it.
    await db.insert(schema.whatsappSessions).values({ businessAccountId: A.id, phoneNumber: `91${old.phone}`, lastUserMessageAt: new Date(Date.now() - 10 * 60 * 1000), sessionActive: true } as any);
    const reopened = await api("POST", `/api/whatsapp/campaign-replies/${old.id}/reply`, { text: "Thanks for writing back!" });
    expect(reopened.status === 200 && sent[sent.length - 1]?.phone === `91${old.phone}`, "window counts the customer's latest WhatsApp message; sends to the number they write from", { status: reopened.status, sent: sent[sent.length - 1] });

    const empty = await api("POST", `/api/whatsapp/campaign-replies/${r.id}/reply`, { text: "   " });
    expect(empty.status === 400, "empty manual reply rejected", empty.status);
    const otherBiz = await api("POST", `/api/whatsapp/campaign-replies/${r.id}/reply`, { text: "hi" }, sessionB);
    expect(otherBiz.status === 404, "another business can't reply in this thread", otherBiz.status);
    const optedOut = await recipient(A.id, c2.id, { status: "opted_out" });
    await inbound(A.id, optedOut, "STOP", 5 * 60 * 1000);
    const oo = await api("POST", `/api/whatsapp/campaign-replies/${optedOut.id}/reply`, { text: "Sorry to see you go" });
    expect(oo.status === 409 && oo.json?.code === "opted_out", "no manual reply to a customer who opted out", oo);
  }

  // ── 4. Automatic handover ─────────────────────────────────────────────────
  console.log("\n— Automatic handover —");
  {
    expect(!!detectHandover("talk to a human") && !!detectHandover("kisi insaan se baat karao") && !!detectHandover("this is fucking useless") && !!detectHandover("इंसान से बात कराओ"), "handover patterns: English / Hinglish / angry / Hindi");
    expect(!detectHandover("I'll talk to my manager and confirm") && !detectHandover("What is the fee?") && !detectHandover("chor do yaar"), "handover patterns: ordinary messages don't trigger");

    // English: "talk to a human"
    const r1 = await recipient(A.id, c2.id);
    let n = calls.length;
    const h1 = await campaignAiService.generateReply(c2.id, r1.id, "I want to talk to a human please");
    let row = await rowOf(r1.id);
    expect(h1?.handover === true && h1.text === HANDOVER_MESSAGE && campaignCallsSince(n).length === 0, "'talk to a human' → the polite handover message, no AI reply", h1);
    expect(row.aiPaused && row.aiPausedReason === "handover" && row.needsHuman && !!row.needsHumanReason && !!row.handoverSentAt, "handover: AI paused + flagged Needs human", { p: row.aiPaused, r: row.aiPausedReason, n: row.needsHuman, why: row.needsHumanReason });
    const again = await campaignAiService.generateReply(c2.id, r1.id, "hello?? talk to a human!!");
    const again2 = await campaignAiService.generateReply(c2.id, r1.id, "any update");
    expect(again?.text === "" && again2?.text === "" && campaignCallsSince(n).length === 0, "after handover: no second handover message, no AI replies (no loop)", { again, again2 });

    // Hinglish: "kisi insaan se baat karao" → handover text in the customer's language
    const r2 = await recipient(A.id, c2.id);
    const h2 = await campaignAiService.generateReply(c2.id, r2.id, "kisi insaan se baat karao");
    expect(h2?.handover === true && /^HINGLISH: /.test(h2.text) && h2.text.includes(HANDOVER_MESSAGE) && (await rowOf(r2.id)).needsHuman, "'kisi insaan se baat karao' → handover message in Hinglish, flagged", h2);

    // Angry
    const r3 = await recipient(A.id, c2.id);
    const h3 = await campaignAiService.generateReply(c2.id, r3.id, "This is fucking useless, stop wasting my time");
    row = await rowOf(r3.id);
    expect(h3?.handover === true && row.aiPaused && row.needsHuman && /upset/i.test(row.needsHumanReason || ""), "angry customer → handover, flagged as upset", { h3, why: row.needsHumanReason });

    // Two messages at the same moment → exactly one handover message.
    const r4 = await recipient(A.id, c2.id);
    const both = await Promise.all([
      campaignAiService.generateReply(c2.id, r4.id, "talk to a human"),
      campaignAiService.generateReply(c2.id, r4.id, "call me back please"),
    ]);
    expect(both.filter((x) => x?.handover).length === 1 && both.filter((x) => x?.text).length === 1, "two messages at once → only one handover message", both);

    // The model can ask for a handover too (wordings the patterns miss).
    const r5 = await recipient(A.id, c2.id);
    nextCampaignReply = "[[HANDOVER]]";
    const h5 = await campaignAiService.generateReply(c2.id, r5.id, "Je veux parler à quelqu'un de votre équipe");
    nextCampaignReply = "Happy to help — our team will share the details.";
    expect(h5?.handover === true && !h5.text.includes("[[HANDOVER]]") && (await rowOf(r5.id)).needsHuman, "model's [[HANDOVER]] signal → handover message (token never sent), flagged", h5);

    // Resume clears the flags; a later request may hand over again (once).
    await api("POST", `/api/whatsapp/campaign-replies/${r1.id}/ai`, { paused: false });
    row = await rowOf(r1.id);
    expect(!row.aiPaused && !row.needsHuman && !row.handoverSentAt, "resume clears AI paused + Needs human", { p: row.aiPaused, n: row.needsHuman });

    // Mark handled clears Needs human (and the classifier's callback flag) but keeps the AI paused.
    await db.update(R).set({ callbackRequired: true } as any).where(eq(R.id, r3.id));
    const handled = await api("POST", `/api/whatsapp/campaign-replies/${r3.id}/handled`);
    row = await rowOf(r3.id);
    expect(handled.status === 200 && !row.needsHuman && !row.callbackRequired && row.aiPaused, "mark handled: Needs human cleared, AI stays paused", { n: row.needsHuman, cb: row.callbackRequired, p: row.aiPaused });
  }

  // ── 5. Replies inbox: search + filters ────────────────────────────────────
  console.log("\n— Replies inbox —");
  {
    const c5 = await campaign(A.id);
    const asha = await recipient(A.id, c5.id, { name: "Asha Searchable", primaryClassification: "INTERESTED" });
    await inbound(A.id, asha, "Please send the brochure for the weekend batch", 30 * 60 * 1000);
    const ravi = await recipient(A.id, c5.id, { name: "Ravi", needsHuman: true, needsHumanReason: "Customer asked to talk to a person" });
    await inbound(A.id, ravi, "ok", 20 * 60 * 1000);
    const silent = await recipient(A.id, c5.id, { name: "Silent Sam", status: "delivered", firstReplyAt: null });
    const bRow = await recipient(B.id, (await campaign(B.id)).id, { name: "Asha Searchable" });
    await inbound(B.id, bRow, "brochure please");

    const base5 = `/api/whatsapp/campaign-replies?campaignId=${c5.id}`;
    let l = await api("GET", base5);
    const ids = (l.json?.items || []).map((i: any) => i.id);
    expect(l.status === 200 && ids.length === 2 && ids.includes(asha.id) && ids.includes(ravi.id) && !ids.includes(silent.id), "inbox: replied customers of the campaign (no one who didn't reply)", ids);
    expect(ids[0] === ravi.id, "inbox: newest reply first", ids);
    const ashaItem = l.json.items.find((i: any) => i.id === asha.id);
    expect(ashaItem?.campaignName === c5.name && ashaItem?.classificationLabel === "Interested" && ashaItem?.interested === true && ashaItem?.unread === true && /brochure/.test(ashaItem?.lastMessageBody || ""), "inbox row: campaign name, outcome label, interested, unread, last message", ashaItem);
    expect(!("attributes" in (ashaItem || {})) && !("providerResponse" in (ashaItem || {})), "inbox row: no raw provider payload / imported attributes");

    l = await api("GET", `/api/whatsapp/campaign-replies?search=${encodeURIComponent("weekend batch")}`);
    expect((l.json?.items || []).map((i: any) => i.id).join() === asha.id, "search by message text (own business only)", l.json?.items?.map((i: any) => i.name));
    l = await api("GET", `/api/whatsapp/campaign-replies?search=searchable`);
    expect((l.json?.items || []).map((i: any) => i.id).join() === asha.id, "search by name (other business's Asha not shown)", l.json?.items?.map((i: any) => i.id));
    l = await api("GET", `/api/whatsapp/campaign-replies?search=${ravi.phone.slice(-6)}`);
    expect((l.json?.items || []).map((i: any) => i.id).join() === ravi.id, "search by phone digits", l.json?.items?.map((i: any) => i.phone));

    l = await api("GET", `${base5}&needsHuman=1`);
    expect((l.json?.items || []).map((i: any) => i.id).join() === ravi.id && l.json.counts.needsHuman === 1, "filter: Needs human", l.json?.counts);
    l = await api("GET", `${base5}&outcome=__interested__`);
    expect((l.json?.items || []).map((i: any) => i.id).join() === asha.id, "filter: Interested", l.json?.items?.length);
    l = await api("GET", `${base5}&outcome=__unclassified__`);
    expect((l.json?.items || []).map((i: any) => i.id).join() === ravi.id, "filter: no outcome yet", l.json?.items?.length);
    await api("POST", `/api/whatsapp/campaign-replies/${ravi.id}/ai`, { paused: true });
    l = await api("GET", `${base5}&aiPaused=1`);
    expect((l.json?.items || []).map((i: any) => i.id).join() === ravi.id && l.json.counts.aiPaused === 1, "filter: AI paused", l.json?.counts);
    await api("GET", `/api/whatsapp/campaign-replies/${asha.id}`); // opening the thread marks it read
    l = await api("GET", `${base5}&unread=1`);
    expect((l.json?.items || []).map((i: any) => i.id).join() === ravi.id && l.json.counts.unread === 1, "filter: Unread (opening a thread marks it read)", l.json?.counts);
    l = await api("GET", `${base5}&replied=0`);
    expect((l.json?.items || []).length === 3, "Everyone: includes customers who haven't replied", l.json?.items?.length);
    l = await api("GET", base5, undefined, sessionB);
    expect(l.status === 200 && (l.json?.items || []).length === 0, "another business sees nothing of this campaign", l.json?.items?.length);
  }

  // ── 6. Campaign AI: shared knowledge retrieval + identity + instructions ──
  console.log("\n— Campaign AI uses the WhatsApp brain —");
  {
    // No account key → the retrieval's keyword path (the fake embeddings can't rank anything).
    const K = await business("Replies Brain");
    await db.update(schema.businessAccounts).set({ openaiApiKey: null } as any).where(eq(schema.businessAccounts.id, K.id));
    await db.insert(schema.faqs).values({ businessAccountId: K.id, question: "What are the parking charges?", answer: `Parking costs ₹40 per hour (code PARK-${tag}).` } as any);
    await db.insert(schema.faqs).values({ businessAccountId: K.id, question: "Do you have a library?", answer: `Yes, open 9 to 5 (code LIB-${tag}).` } as any);
    businessContextCache.invalidateBusinessCache(K.id);
    const c6 = await campaign(K.id, { aiSystemPrompt: `You are Riya from the admissions team. GOAL-${tag}: get the parent to book a campus visit.` });
    const r = await recipient(K.id, c6.id);
    let n = calls.length;
    const reply = await campaignAiService.generateReply(c6.id, r.id, "how much are the parking charges?");
    let call = campaignCallsSince(n)[0];
    expect(!!reply?.text && !!call, "campaign AI replied", reply);
    expect(/MATCHED FAQs/.test(call?.system || "") && (call?.system || "").includes(`PARK-${tag}`), "prompt has the retrieved FAQ (shared WhatsApp retrieval)", call?.system?.slice(0, 1500));
    expect(!/^FAQS:/m.test(call?.system || ""), "prompt no longer dumps every FAQ", call?.system?.slice(0, 800));
    expect((call?.system || "").includes(`GOAL-${tag}`) && /WHO YOU ARE/.test(call?.system || "") && (call?.system || "").includes(`Replies Brain ${tag}`), "prompt keeps the campaign instructions + adds the identity block", call?.system?.slice(0, 600));

    // Retrieval breaks → still replies, with the previous knowledge builder.
    const real = campaignAiDeps.businessKnowledge;
    campaignAiDeps.businessKnowledge = async () => { throw new Error("retrieval down"); };
    n = calls.length;
    const fallback = await campaignAiService.generateReply(c6.id, r.id, "What are the parking charges?");
    call = campaignCallsSince(n)[0];
    campaignAiDeps.businessKnowledge = real;
    expect(!!fallback?.text && /^FAQS:/m.test(call?.system || "") && (call?.system || "").includes(`PARK-${tag}`), "retrieval failure → reply as before (full FAQ block)", call?.system?.slice(0, 600));
  }

  expect(blockedFetches === 0, "no outbound network call left the machine", blockedFetches);
  server.close();
  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nAll campaign replies checks passed.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
