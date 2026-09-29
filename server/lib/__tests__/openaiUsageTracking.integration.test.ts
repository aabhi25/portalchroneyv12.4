/**
 * Integration tests for automatic OpenAI usage (cost) tracking.
 *
 * A local fake OpenAI HTTP server (baseURL) answers chat.completions (plain and
 * SSE streaming), embeddings and responses; usage rows are written by the real
 * aiUsageLogger into ai_usage_events on a throwaway database.
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at
 * localhost AND USAGE_TRACKING_TEST_DB=1 is set.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55462/postgres?sslmode=disable \
 *   USAGE_TRACKING_TEST_DB=1 npx tsx server/lib/__tests__/openaiUsageTracking.integration.test.ts
 */
import http from "http";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.USAGE_TRACKING_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set USAGE_TRACKING_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

// ── fake OpenAI ────────────────────────────────────────────────────────────
const requests: { path: string; body: any }[] = [];
function startFakeOpenAI(): Promise<{ baseURL: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const path = (req.url || "").split("?")[0];
      requests.push({ path, body });
      if (path.endsWith("/chat/completions")) {
        if (body.stream) {
          const withUsage = !!body.stream_options?.include_usage;
          res.writeHead(200, { "content-type": "text/event-stream" });
          const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: body.model };
          const parts = ["Hel", "lo", " there"];
          for (const [i, p] of parts.entries()) {
            const chunk: any = { ...base, choices: [{ index: 0, delta: i === 0 ? { role: "assistant", content: p } : { content: p }, finish_reason: null }] };
            if (withUsage) chunk.usage = null;
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          const last: any = { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
          if (withUsage) last.usage = null;
          res.write(`data: ${JSON.stringify(last)}\n\n`);
          if (withUsage) {
            res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } })}\n\n`);
          }
          res.end("data: [DONE]\n\n");
          return;
        }
        res.writeHead(200, { "content-type": "application/json", "x-request-id": "req_fake_1" });
        res.end(JSON.stringify({
          id: "chatcmpl-2", object: "chat.completion", created: 1, model: body.model,
          choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18, prompt_tokens_details: { cached_tokens: 4 } },
        }));
        return;
      }
      if (path.endsWith("/embeddings")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }], model: body.model, usage: { prompt_tokens: 9, total_tokens: 9 } }));
        return;
      }
      if (path.endsWith("/responses")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "resp_1", object: "response", model: body.model, output: [], usage: { input_tokens: 21, output_tokens: 8, total_tokens: 29, input_tokens_details: { cached_tokens: 0 } } }));
        return;
      }
      res.writeHead(404); res.end("{}");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as AddressInfo).port;
    resolve({ baseURL: `http://127.0.0.1:${port}/v1`, close: () => server.close() });
  }));
}

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { createOpenAI, flushUsageRecords, getUsageTrackingStats } = await import("../openaiClient");
  const { runWithContext, withoutUsageTracking } = await import("../requestContext");
  const { requestContextMiddleware } = await import("../accessLog");
  const { aiUsageLogger } = await import("../../services/aiUsageLogger");
  const express = (await import("express")).default;

  const fake = await startFakeOpenAI();
  const stamp = Date.now();
  const [acctA] = await db.insert(schema.businessAccounts).values({ name: `Usage A ${stamp}`, website: "https://a.example.com" } as any).returning();
  const [acctB] = await db.insert(schema.businessAccounts).values({ name: `Usage B ${stamp}`, website: "https://b.example.com" } as any).returning();
  const A = acctA.id, B = acctB.id;

  const rows = async (id: string) => {
    await flushUsageRecords();
    return db.select().from(schema.aiUsageEvents).where(eq(schema.aiUsageEvents.businessAccountId, id));
  };
  const clear = async (id: string) => { await db.delete(schema.aiUsageEvents).where(eq(schema.aiUsageEvents.businessAccountId, id)); };
  const collect = async (stream: any) => { const out: any[] = []; for await (const c of stream) out.push(c); return out; };

  const tracked = createOpenAI({ apiKey: "sk-test", baseURL: fake.baseURL, maxRetries: 0 });
  const untracked = createOpenAI({ apiKey: "sk-test", baseURL: fake.baseURL, maxRetries: 0, trackUsage: false });
  const messages = [{ role: "user" as const, content: "hello" }];

  try {
    // 1. non-streaming, account from runWithContext
    {
      const res = await runWithContext({ businessAccountId: A, feature: "test_feature" }, () =>
        tracked.chat.completions.create({ model: "gpt-4o-mini", messages }));
      expect(res.choices[0].message.content === "hi" && res.usage?.prompt_tokens === 13, "non-streaming result returned unchanged");
      const r = await rows(A);
      expect(r.length === 1, "non-streaming call → exactly one usage row", r.length);
      expect(r[0]?.tokensInput === "13" && r[0]?.tokensOutput === "5" && r[0]?.tokensInputCached === "4", "token counts recorded (incl. cached)", r[0]);
      expect(r[0]?.model === "gpt-4o-mini" && r[0]?.category === "chat", "model + category", { m: r[0]?.model, c: r[0]?.category });
      const md: any = r[0]?.metadata;
      expect(md?.feature === "test_feature" && md?.autoTracked === true && md?.api === "chat.completions" && md?.stream === false, "metadata feature/autoTracked/api", md);
      expect(Number(r[0]?.costUsd) > 0, "cost computed", r[0]?.costUsd);
      await clear(A);
    }

    // 2. streaming: one row, caller sees exactly the chunks an untracked client sees
    {
      requests.length = 0;
      const plain = await collect(await untracked.chat.completions.create({ model: "gpt-4o-mini", messages, stream: true }));
      const plainReq = requests[0]?.body;
      const got = await runWithContext({ businessAccountId: A }, async () =>
        collect(await tracked.chat.completions.create({ model: "gpt-4o-mini", messages, stream: true })));
      const trackedReq = requests[1]?.body;
      expect(plainReq?.stream_options === undefined, "untracked client does not ask for usage");
      expect(trackedReq?.stream_options?.include_usage === true, "tracked stream asks for include_usage");
      expect(JSON.stringify(got) === JSON.stringify(plain), "streamed chunks to the caller are unchanged (usage-only chunk + usage:null hidden)", { got: got.length, plain: plain.length });
      expect(got.map((c) => c.choices[0]?.delta?.content || "").join("") === "Hello there", "stream text intact");
      const r = await rows(A);
      expect(r.length === 1 && r[0].tokensInput === "11" && r[0].tokensOutput === "7", "streaming call → one row with the final chunk's usage", r.map((x) => [x.tokensInput, x.tokensOutput]));
      expect((r[0]?.metadata as any)?.stream === true, "stream flagged in metadata");
      await clear(A);
    }

    // 3. caller asked for usage itself (and is not opted out): chunk passes through, still one row
    {
      const got = await runWithContext({ businessAccountId: A }, async () =>
        collect(await tracked.chat.completions.create({ model: "gpt-4o-mini", messages, stream: true, stream_options: { include_usage: true } })));
      expect(got.some((c) => c.usage?.prompt_tokens === 11), "caller-requested usage chunk is delivered");
      expect((await rows(A)).length === 1, "caller-requested usage → one row");
      await clear(A);
    }

    // 4. trackUsage:false records nothing (plain + stream)
    {
      await runWithContext({ businessAccountId: A }, async () => {
        await untracked.chat.completions.create({ model: "gpt-4o-mini", messages });
        await collect(await untracked.chat.completions.create({ model: "gpt-4o-mini", messages, stream: true }));
        await untracked.embeddings.create({ model: "text-embedding-3-small", input: "x" });
      });
      expect((await rows(A)).length === 0, "trackUsage:false → no rows");
    }

    // 5. self-logging path (llamaService pattern): withoutUsageTracking + explicit log → exactly one row
    {
      await runWithContext({ businessAccountId: A }, async () => {
        const response = await withoutUsageTracking(() => tracked.chat.completions.create({ model: "gpt-4o-mini", messages }));
        await aiUsageLogger.logChatUsage(A, "gpt-4o-mini", response);
        // streaming variant, as in continueToolConversationStream
        const stream = await withoutUsageTracking(() => tracked.chat.completions.create({ model: "gpt-4o-mini", messages, stream: true, stream_options: { include_usage: true } }));
        let usage: any;
        for await (const c of stream as any) if (c.usage) usage = c.usage;
        await aiUsageLogger.logChatUsage(A, "gpt-4o-mini", { usage });
      });
      const r = await rows(A);
      expect(r.length === 2 && r.every((x) => !(x.metadata as any)?.autoTracked), "self-logged calls counted once each (no auto rows)", r.map((x) => x.metadata));
      await clear(A);
      // client-level opt-out + explicit log (pdfProcessing / embedding pattern)
      await runWithContext({ businessAccountId: A }, async () => {
        const res = await untracked.embeddings.create({ model: "text-embedding-3-small", input: "x" });
        await aiUsageLogger.logEmbeddingUsage(A, "text-embedding-3-small", res);
      });
      const r2 = await rows(A);
      expect(r2.length === 1 && r2[0].category === "rag_embeddings" && r2[0].tokensInput === "9", "opted-out client + explicit embedding log → one row", r2.length);
      await clear(A);
    }

    // 6. embeddings + responses are tracked; explicit businessAccountId option wins over context
    {
      const own = createOpenAI({ apiKey: "sk-test", baseURL: fake.baseURL, maxRetries: 0, businessAccountId: B, feature: "own_feature" });
      await runWithContext({ businessAccountId: A }, async () => {
        await own.embeddings.create({ model: "text-embedding-3-small", input: "x" });
        await own.responses.create({ model: "gpt-4o-mini", input: "hi" });
      });
      const rb = await rows(B);
      const emb = rb.find((x) => (x.metadata as any)?.api === "embeddings");
      const resp = rb.find((x) => (x.metadata as any)?.api === "responses");
      expect(rb.length === 2 && (await rows(A)).length === 0, "client businessAccountId option wins over context", { b: rb.length });
      expect(emb?.category === "rag_embeddings" && emb?.tokensInput === "9" && emb?.tokensOutput === "0", "embeddings row", emb);
      expect(resp?.category === "chat" && resp?.tokensInput === "21" && resp?.tokensOutput === "8" && (resp?.metadata as any)?.feature === "own_feature", "responses row", resp);
      await clear(B);
    }

    // 7. unknown account → skipped and counted; unlabeled feature names the caller file
    {
      const before = getUsageTrackingStats().skippedNoAccount;
      await tracked.chat.completions.create({ model: "gpt-4o-mini", messages });
      await flushUsageRecords();
      expect(getUsageTrackingStats().skippedNoAccount === before + 1, "no account → skipped and counted", getUsageTrackingStats());
      await runWithContext({ businessAccountId: A }, () => tracked.chat.completions.create({ model: "gpt-4o-mini", messages }));
      const r = await rows(A);
      expect(String((r[0]?.metadata as any)?.feature).startsWith("unlabeled:server/lib/__tests__/openaiUsageTracking"), "unlabeled feature names the file that created the client", (r[0]?.metadata as any)?.feature);
      await clear(A);
    }

    // 8. abandoned stream records nothing and aborts cleanly; withResponse() still works
    {
      await runWithContext({ businessAccountId: A }, async () => {
        const s = await tracked.chat.completions.create({ model: "gpt-4o-mini", messages, stream: true });
        for await (const _c of s) break;
        const { data, response } = await tracked.chat.completions.create({ model: "gpt-4o-mini", messages }).withResponse();
        expect(data.choices[0].message.content === "hi" && response.status === 200, "withResponse() still works on tracked calls");
      });
      const r = await rows(A);
      expect(r.length === 1 && (r[0].metadata as any)?.stream === false, "abandoned stream → no row (only the withResponse call)", r.length);
      await clear(A);
    }

    // 9. HTTP request context: account from a webhook route param, route recorded
    {
      const app = express();
      app.use(requestContextMiddleware({ log: () => {} }));
      app.use(express.json());
      app.post("/api/webhook/msg91/:businessId", async (_req, res) => {
        res.status(200).json({ ok: true }); // respond first, process after (like the real webhook)
        await tracked.chat.completions.create({ model: "gpt-4o-mini", messages });
      });
      const srv = app.listen(0, "127.0.0.1");
      await new Promise((r) => srv.once("listening", r));
      const port = (srv.address() as AddressInfo).port;
      await fetch(`http://127.0.0.1:${port}/api/webhook/msg91/${A}`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "webhook-req-0001" }, body: "{}" });
      await new Promise((r) => setTimeout(r, 200));
      const r = await rows(A);
      const md: any = r[0]?.metadata;
      expect(r.length === 1 && md?.route === "POST /api/webhook/msg91/:businessId" && md?.requestId === "webhook-req-0001", "webhook request attributed via route param (after the response was sent)", md);
      srv.close();
      await clear(A);
    }
  } finally {
    fake.close();
    await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, A));
    await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, B));
    const { endPool } = await import("../../db");
    await endPool();
  }

  if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
  console.log("\nAll OpenAI usage tracking tests passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
