/**
 * Facebook smart replies through the REAL registerRoutes() app over HTTP with real SQL:
 *   - /api/smart-replies/facebook accepts the "facebook" channel (create + list)
 *   - a Messenger DM matching a facebook smart-reply keyword gets the configured reply
 *     without any OpenAI call; the highest-priority match wins
 *   - a non-matching DM (and one matching only an Instagram rule) goes to the AI
 *   - Instagram smart replies still work and stay per-channel
 * Meta Graph calls are captured by a fetch stub, OpenAI is a local fake server.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55483/postgres?sslmode=disable \
 *   META_WEBHOOK_TEST_DB=1 npx tsx server/services/__tests__/facebookSmartReplies.integration.test.ts
 */
import crypto from "crypto";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
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

// ── Fake OpenAI (counts chat calls) ──────────────────────────────────────────
const aiCalls: string[] = [];
function startFakeOpenAI(): Promise<{ baseUrl: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      res.setHeader("content-type", "application/json");
      if (req.url?.includes("/embeddings")) {
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        return res.end(JSON.stringify({ object: "list", data: inputs.map((_: any, i: number) => ({ object: "embedding", index: i, embedding: new Array(1536).fill(0.01) })), model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } }));
      }
      const msgs = body.messages || [];
      const lastUser = [...msgs].reverse().find((m: any) => m.role === "user");
      const text = typeof lastUser?.content === "string" ? lastUser.content : "";
      aiCalls.push(text);
      res.end(JSON.stringify({
        id: "chatcmpl-fake", object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: `AI answer to: ${text.slice(0, 60)}` } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() });
  }));
}

// ── Meta Graph stub ──────────────────────────────────────────────────────────
const graphCalls: { method: string; url: string; body: any }[] = [];
const blockedCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
  if (/^https:\/\/graph\.(facebook|instagram)\.com\//.test(target)) {
    const method = (init?.method || "GET").toUpperCase();
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = init?.body; }
    graphCalls.push({ method, url: target, body });
    let resp: any = {};
    if (method === "POST" && /\/messages(\?|$)/.test(target)) resp = { message_id: `m_${graphCalls.length}` };
    else if (/fields=first_name/.test(target)) resp = { first_name: "Cust", last_name: "Omer" };
    else if (/fields=name,username/.test(target)) resp = { username: "customer" };
    return new Response(JSON.stringify(resp), { status: 200, headers: { "content-type": "application/json" } });
  }
  blockedCalls.push(target);
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

async function main() {
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const { encrypt } = await import("../encryptionService");
  const { hashPassword, createSession } = await import("../../auth");
  const { registerRoutes } = await import("../../routes");

  const tag = crypto.randomBytes(4).toString("hex");
  const [biz] = await db.insert(schema.businessAccounts).values({
    name: `FB Smart ${tag}`, website: "https://example.com", facebookEnabled: "true", instagramEnabled: "true",
  } as any).returning();
  const [user] = await db.insert(schema.users).values({
    username: `fbsmart-${tag}`, passwordHash: await hashPassword(crypto.randomBytes(12).toString("hex")), role: "business_user", businessAccountId: biz.id,
  } as any).returning();
  const session = await createSession(user.id);

  const FBP = `SFB${tag}`, IG = `SIG${tag}`;
  const token = encrypt("test-token");
  await db.insert(schema.facebookSettings).values({ businessAccountId: biz.id, pageId: FBP, pageAccessToken: token, appSecret: null, autoReplyEnabled: "true", leadCaptureEnabled: "false" } as any);
  await db.insert(schema.instagramSettings).values({ businessAccountId: biz.id, igAccountId: IG, igAccessToken: token, appSecret: null, autoReplyEnabled: "true", leadCaptureEnabled: "false" } as any);

  const app = express();
  app.use(express.json({ limit: "50mb", verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  const server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const api = async (method: string, path: string, body?: any) => {
    const r = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", cookie: `session=${session}`, origin: base },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, json };
  };
  const post = (path: string, payload: any) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  async function waitUntil(cond: () => Promise<boolean> | boolean, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(50); }
    return cond();
  }
  const fbDm = (sender: string, mid: string, text: string) => ({ object: "page", entry: [{ id: FBP, time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: FBP }, timestamp: Date.now(), message: { mid, text } }] }] });
  const igDm = (sender: string, mid: string, text: string) => ({ object: "instagram", entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: IG }, timestamp: Date.now(), message: { mid, text } }] }] });
  const sentTo = (recipient: string) => graphCalls
    .filter((c) => c.method === "POST" && /\/me\/messages$/.test(c.url) && c.body?.recipient?.id === recipient)
    .map((c) => ({ host: new URL(c.url).host, text: String(c.body?.message?.text ?? "") }));

  // ── API: the facebook channel is accepted ─────────────────────────────────
  const created = await api("POST", "/api/smart-replies/facebook", { keywords: "price, cost", responseText: "Our Messenger price list:", responseUrl: "https://example.com/prices", priority: 1 });
  expect(created.status === 201 && created.json?.channel === "facebook", "POST /api/smart-replies/facebook creates a facebook rule", created);
  const created2 = await api("POST", "/api/smart-replies/facebook", { keywords: "price", responseText: "Top priority price answer", priority: 5 });
  expect(created2.status === 201, "second facebook rule created", created2.status);
  const igRule = await api("POST", "/api/smart-replies/instagram", { keywords: "catalog", responseText: "Instagram-only catalog", priority: 1 });
  expect(igRule.status === 201 && igRule.json?.channel === "instagram", "instagram rule still accepted", igRule.status);
  const listed = await api("GET", "/api/smart-replies/facebook");
  expect(listed.status === 200 && listed.json?.smartReplies?.length === 2 && listed.json.smartReplies.every((r: any) => r.channel === "facebook"),
    "GET /api/smart-replies/facebook lists only the facebook rules", listed.json?.smartReplies?.map((r: any) => r.channel));
  const bad = await api("GET", "/api/smart-replies/tiktok");
  expect(bad.status === 400, "unknown channel still rejected", bad.status);

  // ── Matching DM → configured reply, no AI ─────────────────────────────────
  {
    const S = `fb-match-${tag}`;
    const before = aiCalls.length;
    await post("/api/facebook/webhook", fbDm(S, `m-match-${tag}`, "What is the PRICE of the sofa?"));
    await waitUntil(() => sentTo(S).length >= 1);
    await sleep(400);
    const sent = sentTo(S);
    expect(sent.length === 1 && sent[0].text === "Top priority price answer" && sent[0].host === "graph.facebook.com",
      "matching Messenger DM gets the highest-priority configured reply", sent);
    // (Background jobs from earlier DMs, e.g. the memory snapshot, may still call the AI.)
    expect(!aiCalls.slice(before).some((t) => /price of the sofa/i.test(t)), "no OpenAI call for a smart-reply match", aiCalls.slice(before));
    const rows = await db.select().from(schema.facebookMessages).where(and(eq(schema.facebookMessages.businessAccountId, biz.id), eq(schema.facebookMessages.senderId, S)));
    expect(rows.some((r: any) => r.direction === "outgoing" && r.messageText === "Top priority price answer"), "smart reply stored as an outgoing message", rows.map((r: any) => [r.direction, r.messageText]));
  }
  {
    // Lower-priority rule (+ its URL) when only it matches.
    const S = `fb-cost-${tag}`;
    const before = aiCalls.length;
    await post("/api/facebook/webhook", fbDm(S, `m-cost-${tag}`, "what does it cost"));
    await waitUntil(() => sentTo(S).length >= 1);
    await sleep(300);
    expect(sentTo(S)[0]?.text === "Our Messenger price list:\nhttps://example.com/prices", "response URL appended to the configured reply", sentTo(S));
    expect(!aiCalls.slice(before).some((t) => /what does it cost/.test(t)), "still no OpenAI call", aiCalls.slice(before));
  }

  // ── Non-matching DM → AI ──────────────────────────────────────────────────
  {
    const S = `fb-nomatch-${tag}`;
    const before = aiCalls.length;
    await post("/api/facebook/webhook", fbDm(S, `m-nomatch-${tag}`, "do you deliver to Pune"));
    await waitUntil(() => sentTo(S).length >= 1);
    expect(sentTo(S)[0]?.text?.startsWith("AI answer to: do you deliver to Pune"), "non-matching Messenger DM is answered by the AI", sentTo(S));
    expect(aiCalls.slice(before).some((t) => t.includes("do you deliver to Pune")), "OpenAI was called for the non-matching DM");
  }
  {
    // A keyword configured only for Instagram does not fire on Facebook.
    const S = `fb-igonly-${tag}`;
    await post("/api/facebook/webhook", fbDm(S, `m-igonly-${tag}`, "send me your catalog"));
    await waitUntil(() => sentTo(S).length >= 1);
    expect(sentTo(S)[0]?.text?.startsWith("AI answer to:"), "Instagram-only rule is ignored on Facebook", sentTo(S));
  }
  {
    // ...and still fires on Instagram (unchanged behaviour), where the facebook rules don't.
    const S = `ig-catalog-${tag}`;
    const before = aiCalls.length;
    await post("/api/instagram/webhook", igDm(S, `m-igcat-${tag}`, "send me your catalog"));
    await waitUntil(() => sentTo(S).length >= 1);
    await sleep(300);
    expect(sentTo(S)[0]?.text === "Instagram-only catalog" && sentTo(S)[0]?.host === "graph.instagram.com", "Instagram smart reply unchanged", sentTo(S));
    expect(!aiCalls.slice(before).some((t) => t === "send me your catalog"), "no OpenAI call for the Instagram smart-reply match", aiCalls.slice(before));
    const S2 = `ig-price-${tag}`;
    await post("/api/instagram/webhook", igDm(S2, `m-igprice-${tag}`, "price?"));
    await waitUntil(() => sentTo(S2).length >= 1);
    expect(sentTo(S2)[0]?.text?.startsWith("AI answer to:"), "facebook rules don't fire on Instagram", sentTo(S2));
  }

  await sleep(300);
  expect(blockedCalls.length === 0, "no outbound call outside the fakes", blockedCalls);
  server.close();
  fake.close();
}

main().then(() => {
  if (failed > 0) { console.error(`\n${failed} facebook smart reply test(s) failed.`); process.exit(1); }
  console.log("\nAll facebook smart reply tests passed.");
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
