/**
 * Moving chat calls to the new OpenAI models, against a pretend OpenAI that is as strict as the
 * real one about settings. Run: `npx tsx server/lib/__tests__/modelMove.test.ts`
 */
import http from "http";
import type { AddressInfo } from "net";
import { createOpenAI, __setUsageRecorderForTests, flushUsageRecords, type UsageRecord } from "../openaiClient";
import { __resetModelMoveForTests, billedModel, bodyFor, jobOf, modelChain, setModelMoveSettings } from "../modelMove";
import { runWithContext } from "../requestContext";
import { AI_JOBS, defaultModelMove, modelClosed, readModelMove, type MoveMode } from "@shared/aiModelMove";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const move = (mode: MoveMode, jobs: readonly string[] = AI_JOBS, accounts: string[] = []) => {
  const s = defaultModelMove();
  for (const j of AI_JOBS) s[j] = { mode: "old", accounts: [] };
  for (const j of jobs) (s as any)[j] = { mode, accounts };
  setModelMoveSettings(s);
};

const seen: any[] = [];
const closed = new Set<string>();
const keyLacks = new Map<string, Set<string>>();
let refuseTemperature = false;
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const body = JSON.parse(raw);
    seen.push(body);
    const fail = (status: number, message: string, code?: string) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message, type: "invalid_request_error", code: code ?? null } }));
    };
    const key = String(req.headers.authorization || "").replace("Bearer ", "");
    if (closed.has(body.model) || keyLacks.get(key)?.has(body.model)) return fail(404, `The model \`${body.model}\` does not exist or you do not have access to it.`, "model_not_found");
    if (/^gpt-[56]/.test(body.model)) {
      if (body.max_tokens !== undefined) return fail(400, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.");
      if (refuseTemperature && body.temperature !== undefined) return fail(400, "Unsupported value: 'temperature' does not support 0.3 with this model.");
      if (body.reasoning_effort !== "none" && body.temperature !== undefined) return fail(400, "Unsupported parameter: 'temperature' is not supported with this model.");
      if (body.tools && (body.model === "gpt-6.1-terra" || body.reasoning_effort !== "none")) return fail(400, "Function tools with reasoning_effort are not supported in /v1/chat/completions.");
    } else if (body.reasoning_effort !== undefined || body.max_completion_tokens !== undefined) return fail(400, "Unrecognized request argument");
    const model = /^gpt-4o-mini$/.test(body.model) ? "gpt-4o-mini-2024-07-18" : body.model;
    const usage = { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010, prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 900 } };
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const base = { id: "c", object: "chat.completion.chunk", created: 1, model };
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] })}\n\n`);
      if (body.stream_options?.include_usage) res.write(`data: ${JSON.stringify({ ...base, choices: [], usage })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model, choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }], usage }));
  });
});

const messages = [{ role: "user" as const, content: "hello" }];
const photo = [{ role: "user" as const, content: [{ type: "text" as const, text: "read" }, { type: "image_url" as const, image_url: { url: "data:image/png;base64,AA" } }] }];
const tools = [{ type: "function" as const, function: { name: "get_products", parameters: { type: "object", properties: {} } } }];
const fresh = () => { __resetModelMoveForTests(); move("old"); seen.length = 0; closed.clear(); keyLacks.clear(); refuseTemperature = false; };

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const client = (opts: any = {}) => createOpenAI({ apiKey: "sk-a", baseURL, ...opts });
  const records: UsageRecord[] = [];
  __setUsageRecorderForTests(async (r) => { records.push(r); });
  const real = Date.now;

  // ── off: nothing changes ──
  fresh();
  await client().chat.completions.create({ model: "gpt-4o-mini", messages, max_tokens: 20, temperature: 0 });
  expect(seen.length === 1 && seen[0].model === "gpt-4o-mini" && seen[0].max_tokens === 20 && seen[0].temperature === 0 && seen[0].reasoning_effort === undefined, "off: the call goes out exactly as written", seen[0]);

  // ── on: small jobs ──
  fresh(); move("new", ["small"]);
  await client().chat.completions.create({ model: "gpt-4o-mini", messages, max_tokens: 20, temperature: 0, response_format: { type: "json_object" } });
  expect(seen[0].model === "gpt-6-luna" && seen[0].max_completion_tokens === 20 && seen[0].max_tokens === undefined && seen[0].reasoning_effort === "none" && seen[0].temperature === 0 && seen[0].response_format, "small job: Luna, no thinking, same length limit and temperature", seen[0]);
  await client().chat.completions.create({ model: "gpt-4o", messages, max_tokens: 50 });
  expect(seen[1].model === "gpt-4o", "another job stays on the old model", seen[1].model);
  await client().chat.completions.create({ model: "gpt-4o-mini", messages, tools });
  expect(seen[2].model === "gpt-4o-mini", "a call with tools is a chat reply: not moved with small jobs", seen[2].model);

  // ── jobs ──
  expect(jobOf({ model: "gpt-4o-mini", messages: photo }) === "precise", "a photo call counts as documents and photos");
  expect(jobOf({ model: "gpt-4.1-mini" }, "chat") === "phone", "the phone model in the chat service is the phone job");
  expect(jobOf({ model: "gpt-4.1" }, "chat") === "precise", "a photo answer in a chat is documents and photos");
  expect(jobOf({ model: "gpt-4.1-mini" }, "tutor") === "tutor", "the tutor is the tutor");
  fresh(); move("new");
  expect(modelChain({ model: "gpt-4o" }, "precise")[0] === "gpt-6.1-terra", "gpt-4o → Terra");
  expect(modelChain({ model: "gpt-4.1", tools }, "precise")[0] === "gpt-6-luna", "with tools → Luna (Terra takes none)");
  expect(modelChain({ model: "gpt-6.1-terra", tools }, "chat")[0] === "gpt-6-luna", "Terra named with tools → Luna");
  expect(modelChain({ model: "gpt-4.1-mini" }, "tutor")[0] === "gpt-6-luna", "tutor → Luna");
  expect(modelChain({ model: "gpt-4.1-mini", tools }, "phone").join() === "gpt-5.6-luna,gpt-4.1-mini,gpt-6-luna", "phone → 5.6 Luna, then the old model, then Luna", modelChain({ model: "gpt-4.1-mini", tools }, "phone"));
  expect(modelChain({ model: "gemini-2.5-flash" }, "chat").join() === "gemini-2.5-flash", "other models are left alone");

  // ── photo, tools, streams ──
  fresh(); move("new");
  await client().chat.completions.create({ model: "gpt-4o-mini", messages: photo, max_tokens: 100 });
  expect(seen[0].model === "gpt-6-luna" && Array.isArray(seen[0].messages[0].content), "photo: the picture still goes along", seen[0].model);
  await client({ job: "chat" }).chat.completions.create({ model: "gpt-4o-mini", messages, tools, tool_choice: "auto", max_tokens: 1000, temperature: 0.7 });
  expect(seen[1].model === "gpt-6-luna" && seen[1].tools.length === 1 && seen[1].reasoning_effort === "none" && seen[1].temperature === 0.7, "chat reply: Luna keeps its tools", seen[1]);
  records.length = 0;
  const chunks: any[] = [];
  await runWithContext({ businessAccountId: "acc-1" }, async () => {
    for await (const c of await client({ job: "chat" }).chat.completions.create({ model: "gpt-4o-mini", messages, stream: true, max_tokens: 10 })) chunks.push(c);
    await client().chat.completions.create({ model: "gpt-4o-mini", messages });
  });
  await flushUsageRecords();
  expect(chunks.length === 1 && chunks[0].choices[0].delta.content === "Hi", "stream: the caller sees the same chunks", chunks.length);
  expect(records.length === 2 && records.every((r) => r.model === "gpt-6-luna" && r.tokensInputCacheWrite === 900), "usage is recorded under the model that answered", records.map((r) => r.model));

  // ── chosen accounts only ──
  fresh(); move("accounts", ["chat"], ["acc-1"]);
  await client({ job: "chat", businessAccountId: "acc-1" }).chat.completions.create({ model: "gpt-4o-mini", messages });
  await client({ job: "chat", businessAccountId: "acc-2" }).chat.completions.create({ model: "gpt-4o-mini", messages });
  await runWithContext({ businessAccountId: "acc-1" }, () => client({ job: "chat" }).chat.completions.create({ model: "gpt-4o-mini", messages }));
  expect(seen.map((b) => b.model).join() === "gpt-6-luna,gpt-4o-mini,gpt-6-luna", "chosen accounts: only theirs move", seen.map((b) => b.model));

  // ── a key that can't use the new model ──
  fresh(); move("new"); keyLacks.set("sk-a", new Set(["gpt-6-luna"])); records.length = 0;
  const r1 = await runWithContext({ businessAccountId: "acc-1" }, () => client().chat.completions.create({ model: "gpt-4o-mini", messages, max_tokens: 20, temperature: 0.2 }));
  await flushUsageRecords();
  expect(r1.choices[0].message.content === "Hi" && seen[1].model === "gpt-4o-mini" && seen[1].max_tokens === 20 && seen[1].temperature === 0.2 && seen[1].reasoning_effort === undefined, "key refused: answered by the old model, written the old way", seen[1]);
  expect(records[0]?.model === "gpt-4o-mini", "…and recorded as the old model", records[0]?.model);
  await client().chat.completions.create({ model: "gpt-4o-mini", messages });
  expect(seen.length === 3 && seen[2].model === "gpt-4o-mini", "the refusal is remembered: no second wasted call", seen.map((b) => b.model));
  await client({ apiKey: "sk-b" }).chat.completions.create({ model: "gpt-4o-mini", messages });
  expect(seen[3].model === "gpt-6-luna", "another key is not affected", seen[3].model);

  // ── the old model closes while the switch is still off ──
  fresh(); closed.add("gpt-4o-mini");
  const s = await client({ job: "chat" }).chat.completions.create({ model: "gpt-4o-mini", messages, stream: true, max_tokens: 30 });
  let text = "";
  for await (const c of s) text += c.choices[0]?.delta?.content || "";
  expect(text === "Hi" && seen[1].model === "gpt-6-luna" && seen[1].max_completion_tokens === 30, "closed model: a streamed reply is answered by the new one", seen.map((b) => b.model));
  fresh();
  Date.now = () => Date.parse("2027-01-15T00:00:00Z");
  await client().chat.completions.create({ model: "gpt-4o-mini", messages });
  expect(seen.length === 1 && seen[0].model === "gpt-6-luna", "after the closing day the closing model is not even asked", seen.map((b) => b.model));
  keyLacks.set("sk-a", new Set(["gpt-6-luna"]));
  await client().chat.completions.create({ model: "gpt-4o-mini", messages, max_tokens: 5 });
  expect(seen[seen.length - 1].model === "gpt-5.6-luna" && seen[seen.length - 1].max_completion_tokens === 5, "…then the spare model answers a key without Luna", seen.map((b) => b.model));
  Date.now = real;

  // ── temperature refused ──
  fresh(); move("new"); refuseTemperature = true;
  await client().chat.completions.create({ model: "gpt-4o-mini", messages, temperature: 0.3 });
  expect(seen.length === 2 && seen[1].model === "gpt-6-luna" && seen[1].temperature === undefined, "temperature refused: same model without it", seen.map((b) => [b.model, b.temperature]));
  await client().chat.completions.create({ model: "gpt-4o-mini", messages, temperature: 0.3 });
  expect(seen.length === 3, "…and it is left out from then on", seen.length);

  // ── left alone ──
  fresh(); move("new"); keyLacks.set("sk-a", new Set(["gpt-4.1"]));
  let status = 0;
  await client({ feature: "answer_checking" }).chat.completions.create({ model: "gpt-4.1", messages, max_tokens: 5 }).catch((e: any) => { status = e.status; });
  expect(status === 404 && seen.length === 1 && seen[0].model === "gpt-4.1", "Assessment's calls are never moved or rescued", { status, n: seen.length });
  status = 0;
  keyLacks.set("sk-a", new Set(["gpt-9-unknown"]));
  await client().chat.completions.create({ model: "gpt-9-unknown", messages }).catch((e: any) => { status = e.status; });
  expect(status === 404 && seen.length === 2, "an unknown model's refusal reaches the caller", status);
  expect(bodyFor("gpt-5.2", { model: "gpt-5.2", max_tokens: 5 }).max_completion_tokens === 5, "a newer model chosen in AI providers gets the settings it takes");
  const { response } = await client().chat.completions.create({ model: "gpt-4o-mini", messages }).withResponse();
  expect(response.status === 200, "withResponse() still works");

  // ── names and settings ──
  expect(billedModel("gpt-4o-mini", "gpt-6-luna") === "gpt-6-luna" && billedModel("gpt-4o-mini", "gpt-4o-mini-2024-07-18") === "gpt-4o-mini" && billedModel("gpt-4o-mini", undefined) === "gpt-4o-mini" && billedModel("gpt-5.2", "whatever") === "gpt-5.2", "billedModel");
  const read = readModelMove({ chat: { mode: "accounts", accounts: ["a", "a", 5, "b c"] }, small: { mode: "sometimes" }, junk: 1 });
  expect(read.chat.accounts.join() === "a" && read.small.mode === defaultModelMove().small.mode && Object.keys(read).length === AI_JOBS.length, "unreadable settings fall back to the default", read);
  expect(modelClosed("gpt-4o", Date.parse("2027-01-14T00:00:00Z")) && !modelClosed("gpt-4o", Date.parse("2027-01-13T23:59:00Z")) && !modelClosed("gpt-6-luna"), "closing days");

  __setUsageRecorderForTests(null);
  server.close();
  if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
  console.log("\nAll modelMove tests passed");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
