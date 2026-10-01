/**
 * Smart Lead Training on Instagram / Facebook DMs, through the REAL registerRoutes() app over
 * HTTP with real SQL (same harness as socialChannelParity): every timing (start, custom per-field
 * N, intent, keyword with word boundaries), priority order, required blocks vs optional after
 * answering, optional asked once, required capped at 2 asks, name said in chat (incl. Hindi) not
 * re-asked, and the phone digit rule (phoneValidation) — a bad number no longer stops the name /
 * email from being saved.
 *
 * The fake OpenAI behaves like a model that follows the lead instruction: it asks for exactly the
 * "NEXT DETAIL TO ASK FOR" and nothing otherwise. Meta Graph calls are captured by a fetch stub.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55493/postgres?sslmode=disable \
 *   LEAD_TIMING_TEST_DB=1 npx tsx server/services/__tests__/socialLeadTiming.integration.test.ts
 */
import crypto from "crypto";
import http from "node:http";
import express from "express";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.LEAD_TIMING_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set LEAD_TIMING_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
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

// ── Fake OpenAI: follows the lead instruction ────────────────────────────────
interface MainCall { lastUser: string; leadPrompt: string }
const mainCalls: MainCall[] = [];
function fakeReply(body: any): string {
  const msgs: any[] = body.messages || [];
  const sys0 = String(msgs[0]?.content || "");
  if (/language detector/i.test(sys0)) return "en";
  if (!/responding to customer inquiries via/.test(sys0)) return "OK";
  const leadPrompt = String(msgs.find(m => m.role === "system" && String(m.content).startsWith("📋 LEAD CAPTURE"))?.content || "");
  const lastUser = String([...msgs].reverse().find(m => m.role === "user")?.content || "");
  mainCalls.push({ lastUser, leadPrompt });
  const next = leadPrompt.match(/NEXT DETAIL TO ASK FOR: (.+?) \((required|optional|correction)\)/);
  if (!next) return "Here is the answer you asked for.";
  if (next[2] === "required") return `Before I answer, could you share your ${next[1]}?`;
  if (next[2] === "correction") return `That number doesn't look right. Could you share a valid ${next[1]}?`;
  return `Here is the answer you asked for. Could you share your ${next[1]}?`;
}
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
      res.end(JSON.stringify({
        id: "chatcmpl-fake", object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: fakeReply(body) } }],
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
    else if (/fields=name,username/.test(target)) resp = { username: "customer" };
    else if (/fields=first_name/.test(target)) resp = { first_name: "Cust", last_name: "Omer" };
    return new Response(JSON.stringify(resp), { status: 200, headers: { "content-type": "application/json" } });
  }
  blockedCalls.push(target);
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

const F = (id: string, extra: Record<string, any> = {}) => ({ id, enabled: false, required: false, priority: 4, captureStrategy: "start", ...extra });
const on = (id: string, extra: Record<string, any> = {}) => F(id, { enabled: true, ...extra });
function config(...fields: any[]) {
  const ids = fields.map(f => f.id);
  const all = [...fields, ...["name", "mobile", "whatsapp", "email"].filter(id => !ids.includes(id)).map(id => F(id))];
  return { fields: all, captureStrategy: "custom" };
}

async function main() {
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const { encrypt } = await import("../encryptionService");
  const { validatePhoneNumber } = await import("@shared/validation/phone");
  const { registerRoutes } = await import("../../routes");

  const tag = crypto.randomBytes(4).toString("hex");
  const token = encrypt("test-token");
  let bizSeq = 0;
  /** One business per scenario (each with its own lead config), connected to Instagram + Facebook. */
  async function business(leadTrainingConfig: any) {
    const n = ++bizSeq;
    const [biz] = await db.insert(schema.businessAccounts).values({
      name: `Lead timing ${tag}-${n}`, website: "https://example.com", facebookEnabled: "true", instagramEnabled: "true", openaiApiKey: "sk-test-fake",
    } as any).returning();
    const common = { appSecret: null, autoReplyEnabled: "true", leadCaptureEnabled: "true" };
    const ig = `LIG${tag}${n}`, fb = `LFB${tag}${n}`;
    await db.insert(schema.instagramSettings).values({ businessAccountId: biz.id, igAccountId: ig, igAccessToken: token, ...common } as any);
    await db.insert(schema.facebookSettings).values({ businessAccountId: biz.id, pageId: fb, pageAccessToken: token, ...common } as any);
    await db.insert(schema.widgetSettings).values({ businessAccountId: biz.id, leadTrainingConfig } as any);
    return { biz, ig, fb };
  }

  const app = express();
  app.use(express.json({ limit: "50mb", verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: false }));
  const server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function waitUntil(cond: () => Promise<boolean> | boolean, ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(50); }
    return cond();
  }

  const platforms = [
    {
      name: "instagram", webhook: "/api/instagram/webhook", leads: schema.instagramLeads,
      account: (b: { ig: string }) => b.ig,
      payload: (acct: string, sender: string, mid: string, text: string) => ({ object: "instagram", entry: [{ id: acct, time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: acct }, timestamp: Date.now(), message: { mid, text } }] }] }),
    },
    {
      name: "facebook", webhook: "/api/facebook/webhook", leads: schema.facebookLeads,
      account: (b: { fb: string }) => b.fb,
      payload: (acct: string, sender: string, mid: string, text: string) => ({ object: "page", entry: [{ id: acct, time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: acct }, timestamp: Date.now(), message: { mid, text } }] }] }),
    },
  ] as const;

  let midSeq = 0;
  for (const p of platforms) {
    const sentTo = (sender: string) => graphCalls.filter((c) => c.method === "POST" && /\/me\/messages$/.test(c.url) && c.body?.recipient?.id === sender);
    /** Sends one DM through the webhook, waits for the reply; returns the lead instruction the AI got. */
    async function dm(b: { ig: string; fb: string }, sender: string, text: string): Promise<{ prompt: string; reply: string }> {
      const callsBefore = mainCalls.length;
      const sentBefore = sentTo(sender).length;
      const r = await fetch(base + p.webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p.payload(p.account(b), sender, `mid-${tag}-${++midSeq}`, text)) });
      if (r.status !== 200) throw new Error(`webhook ${r.status}`);
      await waitUntil(() => sentTo(sender).length > sentBefore);
      const call = mainCalls.slice(callsBefore).filter(c => c.lastUser === text).pop();
      return { prompt: call?.leadPrompt || "", reply: sentTo(sender).slice(-1)[0]?.body?.message?.text || "" };
    }
    const leadOf = async (sender: string) => {
      const rows = await (db as any).select().from(p.leads).where(eq(p.leads.senderId, sender));
      return rows[0]?.extractedData as Record<string, any> | undefined;
    };
    const L = (s: string) => `${p.name}: ${s}`;

    // ── 1. start (required) + custom N=3 (optional), priority, caps ──────────
    {
      const b = await business(config(on("name", { required: true, priority: 1 }), on("email", { priority: 2, captureStrategy: "custom", customAskAfter: 3 })));
      const S = `${p.name}-s1-${tag}`;
      const t1 = await dm(b, S, "hi");
      expect(/NEXT DETAIL TO ASK FOR: full name \(required\)/.test(t1.prompt) && !/You already asked once/.test(t1.prompt), L("msg 1: required start field (name) asked before answering"), t1.prompt);
      expect(/full name/.test(t1.reply), L("bot asked for the name"), t1.reply);
      const t2 = await dm(b, S, "what courses do you offer");
      expect(/NEXT DETAIL TO ASK FOR: full name \(required\)/.test(t2.prompt) && /You already asked once/.test(t2.prompt), L("msg 2: name still missing → one re-ask, explaining why"), t2.prompt);
      const t3 = await dm(b, S, "just tell me the fees");
      expect(/NEXT DETAIL TO ASK FOR: email address \(optional\)/.test(t3.prompt), L("msg 3: name capped after 2 asks → custom N=3 field (email) asked after answering"), t3.prompt);
      expect(/Already asked in this conversation \(not shared\): full name/.test(t3.prompt), L("msg 3: the AI is told not to ask for the name again"), t3.prompt);
      const t4 = await dm(b, S, "no thanks");
      expect(!/NEXT DETAIL TO ASK FOR/.test(t4.prompt) && /not shared\): full name, email address/.test(t4.prompt), L("msg 4: optional email declined → not asked again"), t4.prompt);
      const t5 = await dm(b, S, "ok what about the hostel");
      expect(!/NEXT DETAIL TO ASK FOR/.test(t5.prompt) && t5.reply === "Here is the answer you asked for.", L("msg 5: nothing asked any more"), t5);
    }

    // ── 2. Name said in chat (Hindi) is not asked; saved lead counts ─────────
    {
      const b = await business(config(on("name", { required: true, priority: 1 }), on("email", { required: true, priority: 2 })));
      const S = `${p.name}-s2-${tag}`;
      const t1 = await dm(b, S, "mera naam Rahul hai");
      expect(/NEXT DETAIL TO ASK FOR: email address \(required\)/.test(t1.prompt) && /Already have the customer's name/.test(t1.prompt), L("Hindi \"mera naam Rahul hai\" → name not asked, email next"), t1.prompt);
      const t2 = await dm(b, S, "rahul.k@example.com");
      expect(!/NEXT DETAIL TO ASK FOR/.test(t2.prompt) && /Already have the customer's name, email address/.test(t2.prompt), L("all collected → nothing asked"), t2.prompt);
      await waitUntil(async () => !!(await leadOf(S))?.email_address);
      const lead = await leadOf(S);
      expect(lead?.customer_name === "Rahul" && lead?.email_address === "rahul.k@example.com", L("lead saved with the Hindi name and the email"), lead);
      const t3 = await dm(b, S, "what are the fees?");
      expect(!/NEXT DETAIL TO ASK FOR/.test(t3.prompt) && /Already have the customer's name, email address/.test(t3.prompt), L("later message: saved details not asked again"), t3.prompt);
      // "I'm interested…" is not a name.
      const S2 = `${p.name}-s2b-${tag}`;
      const u1 = await dm(b, S2, "I'm interested in the MBA course");
      expect(/NEXT DETAIL TO ASK FOR: full name \(required\)/.test(u1.prompt), L("\"I'm interested…\" is not taken as a name"), u1.prompt);
    }

    // ── 3. Keyword (word boundary, multi-word) + intent wording ──────────────
    {
      const b = await business(config(
        on("email", { priority: 1, captureStrategy: "keyword", captureKeywords: ["price", "fee structure"] }),
        on("name", { priority: 2, captureStrategy: "intent", intentIntensity: "medium" }),
      ));
      const S = `${p.name}-s3-${tag}`;
      const t1 = await dm(b, S, "is this course priceless?");
      expect(!/NEXT DETAIL TO ASK FOR/.test(t1.prompt), L("keyword: \"priceless\" does not trigger \"price\""), t1.prompt);
      expect(/INTENT-BASED DETAIL: full name/.test(t1.prompt) && t1.prompt.includes("MEDIUM sensitivity — Ask for full name when user shows evaluating/comparison intent"), L("intent field: website sensitivity wording, AI decides"), t1.prompt);
      const t2 = await dm(b, S, "Please send the Fee   Structure");
      expect(/NEXT DETAIL TO ASK FOR: email address \(optional\)/.test(t2.prompt), L("keyword: multi-word, any case/spacing → email asked"), t2.prompt);
    }

    // ── 4. Custom N per field, priority across timings ───────────────────────
    {
      const b = await business(config(
        on("email", { priority: 1, captureStrategy: "custom", customAskAfter: 3 }),
        on("name", { priority: 2, captureStrategy: "custom", customAskAfter: 2 }),
      ));
      const S = `${p.name}-s4-${tag}`;
      const t1 = await dm(b, S, "hello");
      const t2 = await dm(b, S, "tell me more");
      const t3 = await dm(b, S, "and the timings?");
      expect(!/NEXT DETAIL/.test(t1.prompt) && /No contact detail is due yet/.test(t1.prompt), L("custom: nothing before its message"), t1.prompt);
      expect(/NEXT DETAIL TO ASK FOR: full name/.test(t2.prompt), L("custom: name (N=2) asked on message 2"), t2.prompt);
      expect(/NEXT DETAIL TO ASK FOR: email address/.test(t3.prompt), L("custom: email (N=3, higher priority) asked on message 3, one at a time"), t3.prompt);
    }

    // ── 5. Phone digit rule (phoneValidation), name/email saved regardless ───
    {
      const b = await business(config(on("mobile", { priority: 1, phoneValidation: "12" }), on("name", { priority: 2, captureStrategy: "custom", customAskAfter: 9 })));
      const S = `${p.name}-s5-${tag}`;
      const t1 = await dm(b, S, "my name is Anita Desai, anita@example.com, call me on 98123 45670");
      expect(/NEXT DETAIL TO ASK FOR: mobile number \(correction\)/.test(t1.prompt) && /12-digit/.test(t1.prompt), L("phoneValidation '12': a 10-digit number gets one request for a correct number"), t1.prompt);
      await waitUntil(async () => !!(await leadOf(S))?.customer_name);
      const lead1 = await leadOf(S);
      expect(lead1?.customer_name === "Anita Desai" && lead1?.email_address === "anita@example.com" && !lead1?.phone_number, L("invalid phone left out, name + email still saved"), lead1);
      const t2 = await dm(b, S, "+91 98123 45670");
      expect(!/NEXT DETAIL TO ASK FOR: mobile/.test(t2.prompt), L("valid 12-digit number → no more phone asks"), t2.prompt);
      await waitUntil(async () => !!(await leadOf(S))?.phone_number);
      expect((await leadOf(S))?.phone_number === "+919812345670", L("12-digit number saved"), await leadOf(S));
    }
    {
      const b = await business(config(on("mobile", { priority: 1, phoneValidation: "8-12" })));
      const S = `${p.name}-s6-${tag}`;
      await dm(b, S, "my name is Kiran, number 981234567");
      await waitUntil(async () => !!(await leadOf(S))?.phone_number);
      const lead = await leadOf(S);
      expect(lead?.phone_number === "981234567" && lead?.customer_name === "Kiran", L("phoneValidation '8-12' (not the old fixed 10) accepts 9 digits"), lead);
    }
    {
      const b = await business(config(on("mobile", { priority: 1, phoneValidation: "10" })));
      const S = `${p.name}-s7-${tag}`;
      await dm(b, S, "my name is Meera, reach me at +91 98123 45670");
      await waitUntil(async () => !!(await leadOf(S)));
      await sleep(300);
      const lead = await leadOf(S);
      const valid = validatePhoneNumber("+91 98123 45670", "10").isValid;
      expect(lead?.customer_name === "Meera" && (valid ? lead?.phone_number === "+919812345670" : !lead?.phone_number),
        L(`'10' with "+91 98123 45670": follows shared/validation/phone.ts (${valid ? "accepted" : "rejected until the +91 fix lands"}), name saved either way`), lead);
    }
  }

  await sleep(300);
  expect(blockedCalls.length === 0, "no outbound call outside the fakes", blockedCalls);
  server.close();
  fake.close();
}

main().then(() => {
  if (failed > 0) { console.error(`\n${failed} DM lead timing test(s) failed.`); process.exit(1); }
  console.log("\nAll DM lead timing tests passed.");
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
