/**
 * Expired / revoked Instagram & Facebook tokens: the first Meta "Error validating access token"
 * (OAuthException 190) marks the account's token as rejected; after that DMs are still stored
 * but no Meta calls are made and no AI replies are generated, until a new token is saved.
 * Real SQL; Meta Graph is a fetch stub, OpenAI a local fake server; nothing leaves the machine.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55481/postgres?sslmode=disable \
 *   META_TOKEN_TEST_DB=1 npx tsx server/services/__tests__/metaTokenRejected.integration.test.ts
 */
import crypto from "crypto";
import http from "node:http";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.META_TOKEN_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set META_TOKEN_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.OPENAI_API_KEY = "sk-test-fake";
for (const k of ["META_APP_SECRET", "FACEBOOK_APP_SECRET", "INSTAGRAM_APP_SECRET", "META_WEBHOOK_REQUIRE_SIGNATURE"]) delete process.env[k];

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}

// ── Fake OpenAI ──────────────────────────────────────────────────────────────
let aiCalls = 0;
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
      aiCalls++;
      res.end(JSON.stringify({
        id: "chatcmpl-fake", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "AI answer" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() });
  }));
}

// ── Meta Graph stub ──────────────────────────────────────────────────────────
const EXPIRED = {
  error: {
    message: "Error validating access token: Session has expired on Monday, 25-May-26 02:47:55 PDT. The current time is Thursday, 22-Oct-26 06:00:00 PDT.",
    type: "OAuthException", code: 190, error_subcode: 463, fbtrace_id: "x",
  },
};
const graph = { expired: true, calls: [] as Array<{ method: string; url: string; body: any }> };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
  if (/^https:\/\/graph\.(facebook|instagram)\.com\//.test(target)) {
    const method = (init?.method || "GET").toUpperCase();
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = init?.body; }
    graph.calls.push({ method, url: target, body });
    if (graph.expired) return new Response(JSON.stringify(EXPIRED), { status: 400, headers: { "content-type": "application/json" } });
    let resp: any = {};
    if (method === "POST" && /\/messages(\?|$)/.test(target)) resp = { recipient_id: body?.recipient?.id || "x", message_id: `m_out_${graph.calls.length}` };
    else if (method === "POST") resp = { id: `reply-${graph.calls.length}` };
    else if (/fields=name,username/.test(target)) resp = { username: "customer" };
    else if (/fields=first_name/.test(target)) resp = { first_name: "Cust", last_name: "Omer" };
    return new Response(JSON.stringify(resp), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

async function main() {
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const { encrypt } = await import("../encryptionService");
  const { processMetaWebhook } = await import("../metaInboundHandler");
  const { instagramService } = await import("../instagramService");
  const { facebookService } = await import("../facebookService");
  const { MetaChannelService } = await import("../social/metaChannelService");

  // ── Recognising Meta's answer ──────────────────────────────────────────────
  expect(MetaChannelService.isTokenRejectedResponse(EXPIRED), "code 190 is a rejected token");
  expect(MetaChannelService.isTokenRejectedResponse({ error: { message: "Error validating access token: [redacted] has expired on Monday" } }), "the message alone is recognised");
  expect(!MetaChannelService.isTokenRejectedResponse({ error: { code: 100, message: "Unsupported get request" } }), "other Graph errors are not");
  expect(!MetaChannelService.isTokenRejectedResponse({ id: "1" }), "success is not");

  const tag = crypto.randomBytes(4).toString("hex");
  const [biz] = await db.insert(schema.businessAccounts).values({
    name: `IG expired ${tag}`, website: "https://example.com", instagramEnabled: "true", facebookEnabled: "true",
  } as any).returning();
  const IG = `IG${tag}`;
  await db.insert(schema.instagramSettings).values({
    businessAccountId: biz.id, igAccountId: IG, igAccessToken: encrypt("old-token"), appSecret: null,
    autoReplyEnabled: "true", leadCaptureEnabled: "false", commentAutoReplyEnabled: "true", commentReplyDelay: "0",
  } as any);
  const igSettings = async () => (await db.select().from(schema.instagramSettings).where(eq(schema.instagramSettings.businessAccountId, biz.id)))[0] as any;
  const incoming = async (sender: string) => (await db.select().from(schema.instagramMessages)
    .where(and(eq(schema.instagramMessages.businessAccountId, biz.id), eq(schema.instagramMessages.senderId, sender))))
    .filter((m: any) => m.direction === "incoming").length;
  const dm = (sender: string, mid: string, text: string) => ({ object: "instagram", entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: IG }, timestamp: Date.now(), message: { mid, text } }] }] });

  // ── 1. First DM after expiry: one Meta call, token marked, no AI ───────────
  {
    await processMetaWebhook("instagram", dm("cust1", `m1-${tag}`, "Hi, what are the fees?"));
    const s = await igSettings();
    expect(!!s.tokenInvalidAt, "token marked as rejected after Meta's 190");
    expect(/Session has expired/.test(s.tokenInvalidReason || ""), "Meta's message is kept for the settings page", s.tokenInvalidReason);
    expect(await incoming("cust1") === 1, "the DM is still stored for the inbox");
    expect(graph.calls.length === 1, "only one Meta call (the profile lookup) was made", graph.calls.map(c => c.url.split("?")[0]));
    expect(aiCalls === 0, "no AI reply generated for a reply that can't be sent", aiCalls);
  }

  // ── 2. Later DMs and comments: no Meta calls, no AI ─────────────────────────
  {
    const before = graph.calls.length;
    await processMetaWebhook("instagram", dm("cust2", `m2-${tag}`, "Hello?"));
    await processMetaWebhook("instagram", { object: "instagram", entry: [{ id: IG, time: Date.now(), changes: [{ field: "comments", value: { id: `c1-${tag}`, text: "price?", from: { id: "fan1", username: "fan" }, media: { id: "MEDIA1" } } }] }] });
    expect(await incoming("cust2") === 1, "next DM stored");
    expect(graph.calls.length === before, "no Meta calls while the token is rejected", graph.calls.length - before);
    expect(aiCalls === 0, "no AI for DMs or comments while disconnected", aiCalls);
  }

  // ── 3. A manual reply from the inbox gets a clear error, without calling Meta ─
  {
    const before = graph.calls.length;
    const r = await instagramService.sendMessage(await igSettings(), "cust1", "Our team will call you");
    expect(!r.success && /login expired/i.test(r.error || ""), "manual send says the login expired", r.error);
    expect(graph.calls.length === before, "manual send doesn't call Meta");
    const p = await instagramService.getUserProfile("old-token", "cust1", await igSettings());
    expect(p === null && graph.calls.length === before, "profile lookup skipped too");
  }

  // ── 4. Saving a new token reconnects ───────────────────────────────────────
  {
    await instagramService.saveSettings(biz.id, { igAccessToken: "new-token" });
    const s = await igSettings();
    expect(!s.tokenInvalidAt && !s.tokenInvalidReason, "saving a new token clears the rejected mark");
    // Saving other settings (token field masked) must not clear or set it.
    graph.expired = false;
    await processMetaWebhook("instagram", dm("cust3", `m3-${tag}`, "Hi again, fees please"));
    const sentToCust3 = graph.calls.filter(c => c.method === "POST" && /\/me\/messages/.test(c.url) && c.body?.recipient?.id === "cust3");
    expect(aiCalls > 0, "AI replies again after reconnecting", aiCalls);
    expect(sentToCust3.length === 1, "the reply is sent to the customer", sentToCust3.length);
  }

  // ── 5. Saving unrelated settings keeps a rejected mark ─────────────────────
  {
    graph.expired = true;
    await instagramService.sendMessage(await igSettings(), "cust3", "ping"); // marks again
    expect(!!(await igSettings()).tokenInvalidAt, "marked again on the next 190");
    await instagramService.saveSettings(biz.id, { autoReplyEnabled: "true", igAccessToken: "••••••••" });
    expect(!!(await igSettings()).tokenInvalidAt, "saving with the masked token keeps the mark");
  }

  // ── 6. Facebook uses the same path ─────────────────────────────────────────
  {
    const PAGE = `FB${tag}`;
    await db.insert(schema.facebookSettings).values({
      businessAccountId: biz.id, pageId: PAGE, appSecret: null, pageAccessToken: encrypt("fb-old"), autoReplyEnabled: "true", leadCaptureEnabled: "false",
    } as any);
    const fbSettings = async () => (await db.select().from(schema.facebookSettings).where(eq(schema.facebookSettings.businessAccountId, biz.id)))[0] as any;
    const r1 = await facebookService.sendMessage(await fbSettings(), "psid1", "hello");
    expect(!r1.success && !!(await fbSettings()).tokenInvalidAt, "Facebook page token marked on 190");
    const before = graph.calls.length;
    const r2 = await facebookService.sendMessage(await fbSettings(), "psid1", "hello again");
    expect(!r2.success && graph.calls.length === before, "and Meta isn't called again");
    await facebookService.saveSettings(biz.id, { pageAccessToken: "fb-new" });
    expect(!(await fbSettings()).tokenInvalidAt, "a new page token clears it");
  }

  fake.close();
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll Meta rejected-token tests passed.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
