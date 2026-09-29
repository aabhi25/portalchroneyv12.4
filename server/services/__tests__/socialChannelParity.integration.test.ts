/**
 * Instagram / Facebook parity through the REAL registerRoutes() app over HTTP with real
 * SQL: the same scenario runs on both platforms (they share one engine per concern since
 * the social/ refactor) and must behave the same, except for the intentional platform
 * differences (Graph host, private-reply shape, webhook payload shape).
 *
 *   1. DM "menu" → flow trigger → buttons step (quick replies)
 *   2. button reply → end step → session completed → lead created (lead capture on)
 *   3. comment → AI public reply + AI private reply to the commenter
 *
 * Meta Graph calls are captured by a fetch stub, OpenAI is a local fake server.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55483/postgres?sslmode=disable \
 *   META_WEBHOOK_TEST_DB=1 npx tsx server/services/__tests__/socialChannelParity.integration.test.ts
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
      const sys = String(msgs[0]?.content || "");
      const content = /private (DM|message) to continue the conversation/.test(sys) ? "Private hello from us" : "Public thanks from us";
      res.end(JSON.stringify({
        id: "chatcmpl-fake", object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() });
  }));
}

// ── Meta Graph stub ──────────────────────────────────────────────────────────
interface GraphCall { method: string; url: string; body: any }
const graphCalls: GraphCall[] = [];
const blockedCalls: string[] = [];
const realFetch = globalThis.fetch;
let seq = 0;
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
  if (/^https:\/\/graph\.(facebook|instagram)\.com\//.test(target)) {
    const method = (init?.method || "GET").toUpperCase();
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = init?.body; }
    graphCalls.push({ method, url: target, body });
    const n = ++seq;
    let resp: any = {};
    if (method === "POST" && /\/messages(\?|$)/.test(target)) resp = { message_id: `m_${n}` };
    else if (method === "POST") resp = { id: `reply_${n}` };
    else if (/fields=name,username/.test(target)) resp = { username: "customer" };
    else if (/fields=first_name/.test(target)) resp = { first_name: "Cust", last_name: "Omer" };
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
  const { registerRoutes } = await import("../../routes");

  const tag = crypto.randomBytes(4).toString("hex");
  const [biz] = await db.insert(schema.businessAccounts).values({
    name: `Parity ${tag}`, website: "https://example.com", facebookEnabled: "true", instagramEnabled: "true",
  } as any).returning();
  const IG = `PIG${tag}`, FBP = `PFB${tag}`;
  const token = encrypt("test-token");
  const common = {
    appSecret: null, autoReplyEnabled: "true", leadCaptureEnabled: "true",
    commentAutoReplyEnabled: "true", commentReplyDelay: "0", commentAutoDmEnabled: "true", commentDmMode: "all",
  };
  await db.insert(schema.instagramSettings).values({ businessAccountId: biz.id, igAccountId: IG, igAccessToken: token, ...common } as any);
  await db.insert(schema.facebookSettings).values({ businessAccountId: biz.id, pageId: FBP, pageAccessToken: token, ...common } as any);

  // Identical flow on both platforms: "menu" → buttons → end.
  for (const [flows, steps] of [[schema.instagramFlows, schema.instagramFlowSteps], [schema.facebookFlows, schema.facebookFlowSteps]] as const) {
    const [flow] = await (db as any).insert(flows).values({ businessAccountId: biz.id, name: "Menu", isActive: "true", triggerKeyword: "menu", fallbackToAI: "true" }).returning();
    await (db as any).insert(steps).values([
      { flowId: flow.id, stepKey: "s1", stepOrder: 0, type: "buttons", prompt: "What would you like?", saveToField: "interest", options: { buttons: [{ id: "pricing", title: "Pricing" }, { id: "demo", title: "Demo" }] }, nextStepMapping: { pricing: "s2", demo: "s2" } },
      { flowId: flow.id, stepKey: "s2", stepOrder: 1, type: "end", prompt: "Great, our team will send pricing." },
    ]);
  }

  const app = express();
  app.use(express.json({ limit: "50mb", verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: false }));
  const server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function post(path: string, payload: any) {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return r.status;
  }
  async function waitUntil(cond: () => Promise<boolean> | boolean, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(50); }
    return cond();
  }

  const platforms = [
    {
      name: "instagram",
      webhook: "/api/instagram/webhook",
      host: /^https:\/\/graph\.instagram\.com\//,
      dm: (sender: string, mid: string, text: string) => ({ object: "instagram", entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: IG }, timestamp: Date.now(), message: { mid, text } }] }] }),
      comment: (cid: string, from: string, text: string) => ({ object: "instagram", entry: [{ id: IG, time: Date.now(), changes: [{ field: "comments", value: { id: cid, text, from: { id: from, username: "fan" }, media: { id: "MEDIA1" } } }] }] }),
      sessions: schema.instagramFlowSessions, leads: schema.instagramLeads, comments: schema.instagramComments,
      // Instagram: private reply = /me/messages addressed by comment id; public reply on /replies.
      isPrivateReply: (c: GraphCall, cid: string) => /\/me\/messages$/.test(c.url) && c.body?.recipient?.comment_id === cid && !c.body?.recipient?.id,
      publicReplyEdge: "replies",
    },
    {
      name: "facebook",
      webhook: "/api/facebook/webhook",
      host: /^https:\/\/graph\.facebook\.com\//,
      dm: (sender: string, mid: string, text: string) => ({ object: "page", entry: [{ id: FBP, time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: FBP }, timestamp: Date.now(), message: { mid, text } }] }] }),
      comment: (cid: string, from: string, text: string) => ({ object: "page", entry: [{ id: FBP, time: Date.now(), changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: cid, post_id: `${FBP}_POST1`, message: text, from: { id: from, name: "Fan Person" } } }] }] }),
      sessions: schema.facebookFlowSessions, leads: schema.facebookLeads, comments: schema.facebookComments,
      // Facebook: private reply = /{comment-id}/private_replies; public reply on /comments.
      isPrivateReply: (c: GraphCall, cid: string) => c.url.endsWith(`/${cid}/private_replies`) && typeof c.body?.message === "string",
      publicReplyEdge: "comments",
    },
  ] as const;

  const summary: Record<string, any> = {};
  for (const p of platforms) {
    const S = `${p.name}-cust-${tag}`;
    const sentTo = () => graphCalls.filter((c) => c.method === "POST" && /\/me\/messages$/.test(c.url) && c.body?.recipient?.id === S);

    // 1. Flow trigger → buttons step
    expect(await post(p.webhook, p.dm(S, `${p.name}-m1-${tag}`, "menu")) === 200, `${p.name}: webhook accepted`);
    await waitUntil(() => sentTo().length >= 1);
    const first = sentTo()[0];
    expect(first && p.host.test(first.url), `${p.name}: reply goes to the ${p.name} Graph host`, first?.url);
    expect(first?.body?.message?.text === "What would you like?" && first.body.message.quick_replies?.map((q: any) => q.title).join(",") === "Pricing,Demo",
      `${p.name}: flow trigger sends the buttons step as quick replies`, first?.body);

    // 2. Button reply → end step → completed → lead
    await post(p.webhook, p.dm(S, `${p.name}-m2-${tag}`, "Pricing"));
    await waitUntil(() => sentTo().length >= 2);
    expect(sentTo()[1]?.body?.message?.text === "Great, our team will send pricing.", `${p.name}: button reply advances to the end step`, sentTo().map((c) => c.body?.message?.text));
    const [sess] = await (db as any).select().from(p.sessions).where(and(eq(p.sessions.businessAccountId, biz.id), eq(p.sessions.senderId, S)));
    expect(sess?.status === "completed" && sess?.collectedData?.interest === "Pricing", `${p.name}: flow session completed with the answer`, { status: sess?.status, data: sess?.collectedData });
    await waitUntil(async () => (await (db as any).select().from(p.leads).where(eq(p.leads.senderId, S))).length > 0);
    const leadRows = await (db as any).select().from(p.leads).where(eq(p.leads.senderId, S));
    expect(leadRows.length === 1 && leadRows[0].extractedData?.interest === "Pricing" && leadRows[0].flowSessionId === sess?.id, `${p.name}: lead created from the completed flow`, leadRows.map((l: any) => l.extractedData));

    // 3. Comment → public reply + private reply
    const cid = `${p.name}-c-${tag}`;
    await post(p.webhook, p.comment(cid, `${p.name}-fan-${tag}`, "how much is it?"));
    await waitUntil(() => graphCalls.some((c) => p.isPrivateReply(c, cid)));
    const publicReply = graphCalls.find((c) => c.method === "POST" && c.url.endsWith(`/${cid}/${p.publicReplyEdge}`));
    const privateReply = graphCalls.find((c) => p.isPrivateReply(c, cid));
    expect(publicReply && p.host.test(publicReply.url) && publicReply.body?.message === "Public thanks from us", `${p.name}: comment got the AI public reply on /${p.publicReplyEdge}`, publicReply);
    expect(privateReply && p.host.test(privateReply.url), `${p.name}: commenter got a private reply in the ${p.name} shape`, privateReply);
    const privateText = privateReply?.body?.message?.text ?? privateReply?.body?.message;
    expect(privateText === "Private hello from us", `${p.name}: private reply carries the AI DM text`, privateText);
    const [row] = await (db as any).select().from(p.comments).where(and(eq(p.comments.businessAccountId, biz.id), eq(p.comments.commentId, cid)));
    expect(row?.status === "replied" && row?.dmStatus === "sent" && row?.replyText === "Public thanks from us" && row?.dmText === "Private hello from us",
      `${p.name}: comment row replied + DM sent`, { status: row?.status, dm: row?.dmStatus });

    summary[p.name] = {
      flowTexts: sentTo().map((c) => c.body?.message?.text),
      quickReplies: first?.body?.message?.quick_replies,
      session: { status: sess?.status, data: sess?.collectedData },
      lead: leadRows[0]?.extractedData,
      comment: { status: row?.status, dmStatus: row?.dmStatus, replyText: row?.replyText, dmText: row?.dmText },
    };
  }

  expect(JSON.stringify(summary.instagram) === JSON.stringify(summary.facebook), "Instagram and Facebook produce the same outcome for the same scenario", summary);

  await sleep(300);
  expect(blockedCalls.length === 0, "no outbound call outside the fakes", blockedCalls);
  server.close();
  fake.close();
}

main().then(() => {
  if (failed > 0) { console.error(`\n${failed} social parity test(s) failed.`); process.exit(1); }
  console.log("\nAll social channel parity tests passed.");
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
