/**
 * Instagram / Facebook protections (duplicates, per-customer ordering, spam / bot-loop
 * limits, AI failure notice, comment private replies, self-comment block) through the REAL
 * registerRoutes() app over HTTP with real SQL. Accounts have no App Secret, so webhooks
 * are processed unverified (legacy path). Meta Graph calls are captured by a fetch stub,
 * OpenAI is a local fake server (OPENAI_BASE_URL); nothing leaves the machine.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55481/postgres?sslmode=disable \
 *   META_WEBHOOK_TEST_DB=1 npx tsx server/services/__tests__/metaInboundProtection.integration.test.ts
 */
import crypto from "crypto";
import http from "node:http";
import express from "express";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.META_WEBHOOK_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set META_WEBHOOK_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.OPENAI_API_KEY = "sk-test-fake";
for (const k of ["META_APP_SECRET", "FACEBOOK_APP_SECRET", "INSTAGRAM_APP_SECRET", "META_WEBHOOK_REQUIRE_SIGNATURE"]) delete process.env[k];

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Fake OpenAI ──────────────────────────────────────────────────────────────
interface AiCall { lastUser: string; start: number; end: number }
const aiCalls: AiCall[] = [];
const fakeAi = { delayMs: 0, fail: false };
function lastUserText(body: any): string {
  const msgs = body.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") return typeof msgs[i].content === "string" ? msgs[i].content : JSON.stringify(msgs[i].content);
  }
  return "";
}
function startFakeOpenAI(): Promise<{ baseUrl: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const body = JSON.parse(raw || "{}");
      if (req.url?.includes("/embeddings")) {
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ object: "list", data: inputs.map((_: any, i: number) => ({ object: "embedding", index: i, embedding: new Array(1536).fill(0.01) })), model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } }));
      }
      const call: AiCall = { lastUser: lastUserText(body), start: Date.now(), end: 0 };
      aiCalls.push(call);
      if (fakeAi.delayMs) await sleep(fakeAi.delayMs);
      call.end = Date.now();
      res.setHeader("content-type", "application/json");
      if (fakeAi.fail) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { message: "fake failure", type: "invalid_request_error" } }));
      }
      res.end(JSON.stringify({
        id: "chatcmpl-fake", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: `AI answer to: ${call.lastUser.slice(0, 80)}` } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() });
  }));
}

// ── Meta Graph stub (fetch) ──────────────────────────────────────────────────
interface GraphCall { method: string; url: string; body: any; at: number }
const graphCalls: GraphCall[] = [];
const realFetch = globalThis.fetch;
const blockedCalls: string[] = [];
let graphSeq = 0;
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
  if (/^https:\/\/graph\.(facebook|instagram)\.com\//.test(target)) {
    const method = (init?.method || "GET").toUpperCase();
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = init?.body; }
    graphCalls.push({ method, url: target, body, at: Date.now() });
    const n = ++graphSeq;
    let resp: any = {};
    if (method === "POST" && /\/messages(\?|$)/.test(target)) resp = { recipient_id: body?.recipient?.id || "x", message_id: `m_out_${n}` };
    else if (method === "POST") resp = { id: `our-reply-${n}` };
    else if (/fields=name,username/.test(target)) resp = { username: "customer" };
    else if (/fields=first_name/.test(target)) resp = { first_name: "Cust", last_name: "Omer" };
    return new Response(JSON.stringify(resp), { status: 200, headers: { "content-type": "application/json" } });
  }
  blockedCalls.push(target);
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

const sentTexts = (recipientId: string) => graphCalls
  .filter((c) => c.method === "POST" && /\/me\/messages/.test(c.url) && c.body?.recipient?.id === recipientId)
  .map((c) => String(c.body?.message?.text ?? ""));

async function main() {
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and, sql } = await import("drizzle-orm");
  const { encrypt } = await import("../encryptionService");
  const { registerRoutes } = await import("../../routes");

  const tag = crypto.randomBytes(4).toString("hex");
  const mkBiz = async (name: string) => {
    const [b] = await db.insert(schema.businessAccounts).values({
      name: `${name} ${tag}`, website: "https://example.com", facebookEnabled: "true", instagramEnabled: "true",
    } as any).returning();
    return b;
  };
  const bizAi = await mkBiz("IG AI");        // IG: auto-reply on, no flow
  const bizQuiet = await mkBiz("IG Quiet");  // IG: auto-reply off (rate-limit test)
  const bizFlow = await mkBiz("IG Flow");    // IG: active flow
  const bizFb = await mkBiz("FB AI");        // FB: auto-reply on, comments + private replies

  const IG_AI = `IA${tag}`, IG_QUIET = `IQ${tag}`, IG_FLOW = `IF${tag}`, FB_PAGE = `FP${tag}`;
  const token = encrypt("test-token");
  const igCommon = {
    appSecret: null, igAccessToken: token, leadCaptureEnabled: "false",
    commentAutoReplyEnabled: "true", commentReplyDelay: "0", commentAutoDmEnabled: "true", commentDmMode: "all",
    commentIgnoreOwnReplies: "false", // the hard self-block must work even with this off
  };
  await db.insert(schema.instagramSettings).values([
    { businessAccountId: bizAi.id, igAccountId: IG_AI, autoReplyEnabled: "true", ...igCommon },
    { businessAccountId: bizQuiet.id, igAccountId: IG_QUIET, autoReplyEnabled: "false", ...igCommon },
    { businessAccountId: bizFlow.id, igAccountId: IG_FLOW, autoReplyEnabled: "true", ...igCommon },
  ] as any);
  await db.insert(schema.facebookSettings).values([
    { businessAccountId: bizFb.id, pageId: FB_PAGE, appSecret: null, pageAccessToken: token, autoReplyEnabled: "true", leadCaptureEnabled: "false",
      commentAutoReplyEnabled: "true", commentReplyDelay: "0", commentAutoDmEnabled: "true", commentDmMode: "all", commentIgnoreOwnReplies: "false" },
  ] as any);

  // Flow for bizFlow: "menu" → buttons step → end step.
  const [flow] = await db.insert(schema.instagramFlows).values({
    businessAccountId: bizFlow.id, name: "Menu", isActive: "true", triggerKeyword: "menu", fallbackToAI: "true",
  } as any).returning();
  await db.insert(schema.instagramFlowSteps).values([
    { flowId: flow.id, stepKey: "s1", stepOrder: 0, type: "buttons", prompt: "What would you like?", options: { buttons: [{ id: "pricing", title: "Pricing" }, { id: "demo", title: "Demo" }] }, nextStepMapping: { pricing: "s2", demo: "s2" } },
    { flowId: flow.id, stepKey: "s2", stepOrder: 1, type: "end", prompt: "Great, our team will send pricing." },
  ] as any);

  const app = express();
  app.use(express.json({ limit: "50mb", verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: false }));
  const server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function post(path: string, payload: any) {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return { status: r.status, text: await r.text() };
  }
  const igDm = (igId: string, sender: string, mid: string, text: string) => ({ object: "instagram", entry: [{ id: igId, time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: igId }, timestamp: Date.now(), message: { mid, text } }] }] });
  const fbDm = (pageId: string, sender: string, mid: string, text: string) => ({ object: "page", entry: [{ id: pageId, time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: pageId }, timestamp: Date.now(), message: { mid, text } }] }] });
  const igComment = (igId: string, cid: string, from: string, text: string, media = "MEDIA1") => ({ object: "instagram", entry: [{ id: igId, time: Date.now(), changes: [{ field: "comments", value: { id: cid, text, from: { id: from, username: "someone" }, media: { id: media } } }] }] });
  const fbComment = (pageId: string, cid: string, from: string, text: string) => ({ object: "page", entry: [{ id: pageId, time: Date.now(), changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: cid, post_id: `${pageId}_POST1`, message: text, from: { id: from, name: "Some One" } } }] }] });

  const igRows = async (bizId: string, sender: string, direction?: string) =>
    (await db.select().from(schema.instagramMessages).where(and(eq(schema.instagramMessages.businessAccountId, bizId), eq(schema.instagramMessages.senderId, sender))))
      .filter((m: any) => !direction || m.direction === direction);
  async function waitUntil(cond: () => Promise<boolean> | boolean, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(50); }
    return cond();
  }

  // ── 1. Meta retry of the same mid is processed once ────────────────────────
  {
    const S = `dup-${tag}`, mid = `mid-dup-${tag}`;
    const payload = igDm(IG_AI, S, mid, "Do you ship to Pune?");
    const [a, b] = await Promise.all([post("/api/instagram/webhook", payload), post("/api/instagram/webhook", payload)]);
    await waitUntil(async () => sentTexts(S).length >= 1);
    await sleep(600);
    const c = await post("/api/instagram/webhook", payload); // a later retry
    await sleep(600);
    const incoming = await igRows(bizAi.id, S, "incoming");
    expect(a.status === 200 && b.status === 200 && c.status === 200, "webhook answers 200 to every delivery");
    expect(incoming.length === 1, "retried IG DM stored once", incoming.length);
    expect(sentTexts(S).length === 1, "retried IG DM answered once", sentTexts(S));
    const ev = await db.execute(sql`SELECT processed_at FROM webhook_events WHERE business_account_id = ${bizAi.id} AND source = 'instagram' AND provider_id = ${mid}`);
    expect((ev as any).rows?.length === 1 && (ev as any).rows[0].processed_at, "claim recorded and marked processed", (ev as any).rows);
  }

  // ── 2. Two quick DMs from one sender run in order, without overlap ─────────
  {
    fakeAi.delayMs = 400;
    const S = `order-${tag}`;
    const before = aiCalls.length;
    await post("/api/instagram/webhook", igDm(IG_AI, S, `mid-o1-${tag}`, "first question about sofas"));
    await post("/api/instagram/webhook", igDm(IG_AI, S, `mid-o2-${tag}`, "second question about tables"));
    await waitUntil(async () => sentTexts(S).length >= 2, 15000);
    const calls = aiCalls.slice(before);
    const firstCalls = calls.filter((c) => c.lastUser.includes("first question"));
    const secondCalls = calls.filter((c) => c.lastUser.includes("second question"));
    // The reply to the first DM (its AI calls and the send) is finished before any AI call
    // for the second DM starts. (Background jobs after a reply, like the cross-platform
    // memory snapshot, may still run — they are not part of answering.)
    const firstReplyAt = graphCalls.find((c) => c.body?.recipient?.id === S && String(c.body?.message?.text).includes("first question"))?.at ?? Infinity;
    const firstReplyCalls = firstCalls.filter((c) => c.start <= firstReplyAt);
    const lastFirstEnd = Math.max(...firstReplyCalls.map((c) => c.end));
    const firstSecondStart = Math.min(...secondCalls.map((c) => c.start));
    expect(firstReplyCalls.length > 0 && secondCalls.length > 0 && lastFirstEnd <= firstReplyAt && firstReplyAt <= firstSecondStart,
      "second DM's AI work starts only after the first DM was answered", { lastFirstEnd, firstReplyAt, firstSecondStart });
    const sent = sentTexts(S);
    expect(sent.length === 2 && sent[0].includes("first question") && sent[1].includes("second question"), "replies sent in message order", sent);

    // Different senders are not serialized.
    const before2 = aiCalls.length;
    const A = `par-a-${tag}`, B = `par-b-${tag}`;
    await Promise.all([
      post("/api/instagram/webhook", igDm(IG_AI, A, `mid-pa-${tag}`, "parallel alpha question")),
      post("/api/instagram/webhook", igDm(IG_AI, B, `mid-pb-${tag}`, "parallel beta question")),
    ]);
    await waitUntil(async () => sentTexts(A).length >= 1 && sentTexts(B).length >= 1, 15000);
    const pc = aiCalls.slice(before2);
    const alpha = pc.filter((c) => c.lastUser.includes("alpha")), beta = pc.filter((c) => c.lastUser.includes("beta"));
    const overlap = alpha.some((x) => beta.some((y) => x.start < y.end && y.start < x.end));
    expect(overlap, "DMs from different senders are processed in parallel");
    fakeAi.delayMs = 0;
  }

  // ── 3. 13 rapid DMs → limited, exactly one notice ──────────────────────────
  {
    const S = `spam-${tag}`;
    for (let i = 1; i <= 14; i++) await post("/api/instagram/webhook", igDm(IG_QUIET, S, `mid-spam-${i}-${tag}`, `msg ${i}`));
    await waitUntil(async () => (await igRows(bizQuiet.id, S, "incoming")).length >= 14);
    await sleep(500);
    const notices = sentTexts(S).filter((t) => /sending messages very quickly/.test(t));
    expect(notices.length === 1, "13+ rapid DMs: limited with exactly one notice", sentTexts(S));
  }

  // ── 4. Identical long texts (bot loop) → paused without a notice ───────────
  {
    const S = `loop-${tag}`;
    const text = "Thank you for your message, we will get back to you shortly";
    for (let i = 1; i <= 6; i++) {
      await post("/api/instagram/webhook", igDm(IG_AI, S, `mid-loop-${i}-${tag}`, text));
    }
    await waitUntil(async () => (await igRows(bizAi.id, S, "incoming")).length >= 6, 15000);
    await sleep(1500);
    const sent = sentTexts(S);
    expect(sent.filter((t) => t.startsWith("AI answer")).length === 4, "loop: only the first 4 identical texts get an AI reply", sent.length);
    expect(!sent.some((t) => /very quickly|trouble/.test(t)), "loop pause sends no notice", sent);
  }

  // ── 5. AI failure → one short apology (rate-limited) ───────────────────────
  {
    fakeAi.fail = true;
    const S = `fail-${tag}`;
    await post("/api/instagram/webhook", igDm(IG_AI, S, `mid-f1-${tag}`, "what are your hours"));
    await waitUntil(async () => sentTexts(S).length >= 1);
    await post("/api/instagram/webhook", igDm(IG_AI, S, `mid-f2-${tag}`, "hello again?"));
    await waitUntil(async () => (await igRows(bizAi.id, S, "incoming")).length >= 2);
    await sleep(800);
    const sent = sentTexts(S);
    expect(sent.length === 1 && /having trouble answering right now/.test(sent[0]), "AI failure: exactly one apology across two failed DMs", sent);

    const F = `fbfail-${tag}`;
    await post("/api/facebook/webhook", fbDm(FB_PAGE, F, `fbmid-f1-${tag}`, "what are your hours"));
    await waitUntil(async () => sentTexts(F).length >= 1);
    expect(sentTexts(F).length === 1 && /having trouble answering/.test(sentTexts(F)[0]), "FB AI failure also sends the apology", sentTexts(F));
    fakeAi.fail = false;
  }

  // ── 6. Existing behaviour: normal DM gets AI reply; flow advances ──────────
  {
    const F = `fbok-${tag}`;
    await post("/api/facebook/webhook", fbDm(FB_PAGE, F, `fbmid-ok-${tag}`, "do you have red chairs"));
    await waitUntil(async () => sentTexts(F).length >= 1);
    expect(sentTexts(F)[0]?.includes("red chairs"), "normal FB DM gets an AI reply", sentTexts(F));
    const fbRows = await db.select().from(schema.facebookMessages).where(and(eq(schema.facebookMessages.businessAccountId, bizFb.id), eq(schema.facebookMessages.senderId, F)));
    expect(fbRows.length === 2, "FB DM + reply stored", fbRows.length);

    const S = `flow-${tag}`;
    await post("/api/instagram/webhook", igDm(IG_FLOW, S, `mid-fl1-${tag}`, "menu"));
    await waitUntil(async () => graphCalls.some((c) => c.body?.recipient?.id === S));
    const qr = graphCalls.filter((c) => c.body?.recipient?.id === S);
    expect(qr.length === 1 && qr[0].body?.message?.quick_replies?.length === 2 && qr[0].body.message.text === "What would you like?", "flow trigger sends the buttons step", qr.map((c) => c.body));
    await post("/api/instagram/webhook", igDm(IG_FLOW, S, `mid-fl2-${tag}`, "Pricing"));
    await waitUntil(async () => sentTexts(S).length >= 2);
    expect(sentTexts(S)[1] === "Great, our team will send pricing.", "flow advances to the next step on a button reply", sentTexts(S));
    const [sess] = await db.select().from(schema.instagramFlowSessions).where(and(eq(schema.instagramFlowSessions.businessAccountId, bizFlow.id), eq(schema.instagramFlowSessions.senderId, S)));
    expect(sess?.status === "completed", "flow session completed", sess?.status);
  }

  // ── 7. Comments: IG private reply uses comment_id; self-comments never answered ──
  {
    const cid = `c-${tag}`;
    await post("/api/instagram/webhook", igComment(IG_AI, cid, `commenter-${tag}`, "price please?"));
    await waitUntil(async () => graphCalls.some((c) => c.body?.recipient?.comment_id === cid));
    const dm = graphCalls.find((c) => c.body?.recipient?.comment_id === cid);
    expect(dm && /graph\.instagram\.com\/.*\/me\/messages/.test(dm.url) && !dm.body.recipient.id, "IG comment-to-DM is a private reply with recipient.comment_id", dm);
    expect(!graphCalls.some((c) => c.body?.recipient?.id === `commenter-${tag}`), "no plain DM to the commenter's id");
    const replyCall = graphCalls.find((c) => c.url.includes(`/${cid}/replies`));
    expect(!!replyCall, "IG comment got a public reply");
    const [row] = await db.select().from(schema.instagramComments).where(and(eq(schema.instagramComments.businessAccountId, bizAi.id), eq(schema.instagramComments.commentId, cid)));
    expect(row?.status === "replied" && (row as any)?.dmStatus === "sent", "IG comment row: replied + DM sent", { status: row?.status, dm: (row as any)?.dmStatus });

    // Meta retry of the same comment → processed once.
    const callsBefore = graphCalls.length;
    await post("/api/instagram/webhook", igComment(IG_AI, cid, `commenter-${tag}`, "price please?"));
    await sleep(800);
    expect(graphCalls.length === callsBefore, "retried comment not answered again", graphCalls.slice(callsBefore).map((c) => c.url));

    // Our own account's comment, and our own reply echoed back, are never answered.
    const before = graphCalls.length;
    await post("/api/instagram/webhook", igComment(IG_AI, `self-${tag}`, IG_AI, "Thanks for your interest! price please"));
    const ourReplyId = (row as any)?.replyCommentId;
    await post("/api/instagram/webhook", igComment(IG_AI, ourReplyId, `other-${tag}`, "Thanks for your interest!"));
    await sleep(1200);
    const selfReplies = graphCalls.slice(before).filter((c) => c.url.includes(`/self-${tag}/`) || c.url.includes(`/${ourReplyId}/`) || c.body?.recipient?.comment_id === `self-${tag}` || c.body?.recipient?.comment_id === ourReplyId);
    expect(selfReplies.length === 0, "self-comment / our echoed reply never replied (even with commentIgnoreOwnReplies off)", selfReplies.map((c) => c.url));
    const selfRows = await db.select().from(schema.instagramComments).where(and(eq(schema.instagramComments.businessAccountId, bizAi.id), eq(schema.instagramComments.commentId, `self-${tag}`)));
    expect(selfRows.length === 0, "self-comment not even queued", selfRows.length);

    // Per-commenter hourly cap (5): 7 comments from one person → 5 replies.
    const P = `chatty-${tag}`;
    for (let i = 1; i <= 7; i++) await post("/api/instagram/webhook", igComment(IG_AI, `cc-${i}-${tag}`, P, `question number ${i}`, `MEDIA-C-${tag}`));
    await waitUntil(async () => (await db.select().from(schema.instagramComments).where(and(eq(schema.instagramComments.businessAccountId, bizAi.id), eq(schema.instagramComments.commenterId, P)))).length >= 7);
    await sleep(1500);
    const pRows = await db.select().from(schema.instagramComments).where(and(eq(schema.instagramComments.businessAccountId, bizAi.id), eq(schema.instagramComments.commenterId, P)));
    const replied = pRows.filter((r: any) => r.status === "replied").length, skipped = pRows.filter((r: any) => r.status === "skipped").length;
    expect(replied === 5 && skipped === 2, "per-commenter hourly cap: 5 replied, 2 skipped", { replied, skipped });

    // Facebook: private reply unchanged; own page comment ignored.
    const fcid = `fbc-${tag}`;
    await post("/api/facebook/webhook", fbComment(FB_PAGE, fcid, `fbcommenter-${tag}`, "how much?"));
    await waitUntil(async () => graphCalls.some((c) => c.url.includes(`/${fcid}/private_replies`)));
    expect(graphCalls.some((c) => c.url.includes(`/${fcid}/private_replies`)), "FB comment private reply still sent");
    const fbBefore = graphCalls.length;
    await post("/api/facebook/webhook", fbComment(FB_PAGE, `fbself-${tag}`, FB_PAGE, "our own page comment"));
    await sleep(800);
    expect(graphCalls.slice(fbBefore).length === 0, "FB page's own comment never replied", graphCalls.slice(fbBefore).map((c) => c.url));
  }

  await sleep(300);
  expect(blockedCalls.length === 0, "no outbound call outside the fakes", blockedCalls);
  server.close();
  fake.close();
}

main().then(() => {
  if (failed > 0) { console.error(`\n${failed} meta protection test(s) failed.`); process.exit(1); }
  console.log("\nAll meta inbound protection tests passed.");
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
