/**
 * Smart Lead Training on WhatsApp through the REAL MSG91 webhook route (registerRoutes) with real
 * SQL: the lead instruction comes from the shared channel timing logic (never the website's
 * "CALL capture_lead" text), capture_lead is a real tool that saves name / email on the WhatsApp
 * lead, a saved name is not asked again, Custom N=7 fires on the 7th customer message even across
 * a restart (counts come from stored messages), no lead asks while a guided flow session is
 * active, and the phone is never asked.
 *
 * MSG91 sends are captured by a fetch stub; OpenAI is a local fake that follows the instruction.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55493/postgres?sslmode=disable \
 *   LEAD_TIMING_TEST_DB=1 npx tsx server/services/__tests__/whatsappLeadTiming.integration.test.ts
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

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Fake OpenAI ──────────────────────────────────────────────────────────────
interface MainCall { lastUser: string; leadPrompt: string; allSystem: string; tools: string[]; followUp: boolean; toolResult?: string }
const mainCalls: MainCall[] = [];
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
function textOf(c: any) { return typeof c === "string" ? c : c == null ? "" : JSON.stringify(c); }
function answer(body: any): any {
  const msgs: any[] = body.messages || [];
  const sys0 = textOf(msgs[0]?.content);
  if (/language detector/i.test(sys0)) return { role: "assistant", content: "en" };
  // Message extraction (whatsappService.extractLeadInfo): finds nothing, so only capture_lead writes the lead.
  if (body.response_format?.type === "json_object") return { role: "assistant", content: JSON.stringify({ customer_name: null, customer_phone: null, customer_email: null, notes: null }) };
  if (!/responding to customer inquiries via WhatsApp/.test(sys0)) return { role: "assistant", content: "OK" };
  const leadPrompt = textOf(msgs.find(m => m.role === "system" && textOf(m.content).startsWith("📋 LEAD CAPTURE"))?.content);
  const lastUser = textOf([...msgs].reverse().find(m => m.role === "user")?.content);
  const tools: string[] = (body.tools || []).map((t: any) => t?.function?.name);
  const toolMsg = msgs.find(m => m.role === "tool");
  mainCalls.push({
    lastUser, leadPrompt, tools, followUp: !!toolMsg, toolResult: toolMsg ? textOf(toolMsg.content) : undefined,
    allSystem: msgs.filter(m => m.role === "system").map(m => textOf(m.content)).join("\n"),
  });
  // A model that saves contact details with the tool when it has one.
  if (!toolMsg && tools.includes("capture_lead")) {
    const name = lastUser.match(/Rahul Verma/)?.[0];
    const email = lastUser.match(EMAIL_RE)?.[0];
    if (name || email) {
      return { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "capture_lead", arguments: JSON.stringify({ ...(name ? { name } : {}), ...(email ? { email } : {}) }) } }] };
    }
  }
  const next = leadPrompt.match(/NEXT DETAIL TO ASK FOR: (.+?) \((required|optional|correction)\)/);
  if (!next) return { role: "assistant", content: "Here is the answer you asked for." };
  if (next[2] === "required") return { role: "assistant", content: `Before I answer, could you share your ${next[1]}?` };
  return { role: "assistant", content: `Here is the answer you asked for. Could you share your ${next[1]}?` };
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
      const message = answer(body);
      res.end(JSON.stringify({
        id: "chatcmpl-fake", object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, finish_reason: message.tool_calls ? "tool_calls" : "stop", message }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() });
  }));
}

// ── MSG91 stub ───────────────────────────────────────────────────────────────
const sent: { to: string; text: string }[] = [];
const blockedCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
  if (/^https:\/\/control\.msg91\.com\//.test(target)) {
    const u = new URL(target);
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
    sent.push({ to: u.searchParams.get("recipient_number") || body?.recipient_number || "", text: u.searchParams.get("text") || body?.interactive?.body?.text || "" });
    return new Response(JSON.stringify({ status: "success", data: { message_uuid: `u_${sent.length}` } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  blockedCalls.push(target);
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

const F = (id: string, extra: Record<string, any> = {}) => ({ id, enabled: false, required: false, priority: 4, captureStrategy: "start", ...extra });
const on = (id: string, extra: Record<string, any> = {}) => F(id, { enabled: true, ...extra });
function config(...fields: any[]) {
  const ids = fields.map(f => f.id);
  return { fields: [...fields, ...["name", "mobile", "whatsapp", "email"].filter(id => !ids.includes(id)).map(id => F(id))], captureStrategy: "custom" };
}

async function main() {
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and, ne, asc } = await import("drizzle-orm");
  const { registerRoutes } = await import("../../routes");
  const { WhatsappAutoReplyService } = await import("../whatsappAutoReplyService");
  const { whatsappService } = await import("../whatsappService");
  const { updateSession } = await import("../whatsappSessionService");

  const tag = crypto.randomBytes(4).toString("hex");
  const SECRET = `sec-${tag}`;
  let bizSeq = 0;
  async function business(leadTrainingConfig: any, settings: Record<string, any> = {}) {
    const [biz] = await db.insert(schema.businessAccounts).values({ name: `WA lead timing ${tag}-${++bizSeq}`, website: "https://example.com", whatsappEnabled: "true", openaiApiKey: "sk-test-fake" } as any).returning();
    await db.insert(schema.whatsappSettings).values({
      businessAccountId: biz.id, msg91AuthKey: "test-key", msg91IntegratedNumberId: "910000000000", webhookSecret: SECRET,
      autoReplyEnabled: "true", leadCaptureEnabled: "true", useLeadTraining: "true", ...settings,
    } as any);
    await db.insert(schema.widgetSettings).values({ businessAccountId: biz.id, leadTrainingConfig } as any);
    return biz;
  }

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: false }));
  const server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function waitUntil(cond: () => Promise<boolean> | boolean, ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(50); }
    return cond();
  }
  let uuidSeq = 0;
  /** One customer message through the MSG91 webhook; resolves once the AI reply was sent. */
  async function wa(bizId: string, phone: string, text: string): Promise<MainCall[]> {
    const before = mainCalls.length;
    const sentBefore = sent.filter(s => s.to === phone).length;
    const r = await fetch(`${base}/api/webhook/msg91/${bizId}?secret=${SECRET}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerNumber: phone, text, contentType: "text", direction: "0", uuid: `wa-${tag}-${++uuidSeq}` }),
    });
    if (r.status !== 200) throw new Error(`webhook ${r.status}`);
    await waitUntil(() => sent.filter(s => s.to === phone).length > sentBefore);
    await sleep(150); // the reply row is stored right after the send
    return mainCalls.slice(before).filter(c => c.lastUser === text);
  }
  const leadRow = async (bizId: string, phone: string) => {
    const rows = await db.select().from(schema.whatsappLeads).where(and(
      eq(schema.whatsappLeads.businessAccountId, bizId), eq(schema.whatsappLeads.senderPhone, phone),
      eq(schema.whatsappLeads.direction, "incoming"), ne(schema.whatsappLeads.status, "message_only"),
    )).orderBy(asc(schema.whatsappLeads.receivedAt));
    return rows[0];
  };

  // ── 1. capture_lead saves the name / email; saved name not re-asked; phone never asked ──
  {
    const biz = await business(config(
      on("mobile", { required: true, priority: 1 }),
      on("name", { priority: 2 }),
      on("email", { priority: 3, captureStrategy: "custom", customAskAfter: 3 }),
    ));
    const P = `9198${tag.replace(/\D/g, "").padEnd(8, "1").slice(0, 8)}`;
    const [c1] = await wa(biz.id, P, "hi");
    expect(c1 && /NEXT DETAIL TO ASK FOR: full name \(optional\)/.test(c1.leadPrompt), "msg 1: name asked (the required mobile field is skipped on WhatsApp)", c1?.leadPrompt);
    expect(c1 && /never ask for a phone, mobile or WhatsApp number/.test(c1.leadPrompt) && !/NEXT DETAIL TO ASK FOR: (mobile|WhatsApp)/.test(c1.leadPrompt), "phone never asked on WhatsApp", c1?.leadPrompt);
    expect(c1 && c1.tools.includes("capture_lead") && /call capture_lead/.test(c1.leadPrompt), "capture_lead offered as a real tool and mentioned in the instruction", c1?.tools);
    expect(c1 && !/CALL capture_lead tool RIGHT AWAY/.test(c1.allSystem), "website lead prompt (\"CALL capture_lead tool RIGHT AWAY\") no longer used on WhatsApp");

    const c2 = await wa(biz.id, P, "I am Rahul Verma");
    const first = c2.find(c => !c.followUp), follow = c2.find(c => c.followUp);
    expect(first && follow && /Saved the customer's name/.test(follow.toolResult || ""), "capture_lead called and executed", c2.map(c => ({ followUp: c.followUp, tool: c.toolResult })));
    const lead = await leadRow(biz.id, P);
    expect(lead?.customerName === "Rahul Verma" && (lead?.extractedData as any)?.customer_name === "Rahul Verma", "capture_lead saved the name on the WhatsApp lead", { name: lead?.customerName, data: lead?.extractedData });
    expect(follow && !/NEXT DETAIL TO ASK FOR: full name/.test(follow.leadPrompt) && /Already have the customer's name/.test(follow.leadPrompt), "after saving, the same reply is told the name is collected", follow?.leadPrompt);

    const [c3] = await wa(biz.id, P, "what are the fees?");
    expect(c3 && /Already have the customer's name/.test(c3.leadPrompt) && /NEXT DETAIL TO ASK FOR: email address \(optional\)/.test(c3.leadPrompt), "msg 3: saved name not re-asked; custom N=3 email asked", c3?.leadPrompt);

    const c4 = await wa(biz.id, P, "sure, rahul.v@example.com");
    const lead2 = await leadRow(biz.id, P);
    expect(lead2?.customerEmail === "rahul.v@example.com", "capture_lead saved the email on the WhatsApp lead", lead2?.customerEmail);
    const follow4 = c4.find(c => c.followUp);
    expect(follow4 && !/NEXT DETAIL TO ASK FOR/.test(follow4.leadPrompt), "nothing more to ask after the email", follow4?.leadPrompt);
  }

  // ── 2. Custom N=7 fires on the 7th message, across a simulated restart ──
  {
    const biz = await business(config(on("email", { priority: 1, captureStrategy: "custom", customAskAfter: 7 })));
    const P = `9197${tag.replace(/\D/g, "").padEnd(8, "2").slice(0, 8)}`;
    const prompts: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const [c] = await wa(biz.id, P, `question number ${i} about the course`);
      prompts.push(c?.leadPrompt || "");
    }
    expect(prompts.every(p => !/NEXT DETAIL TO ASK FOR/.test(p) && /No contact detail is due yet/.test(p)), "messages 1–6: email (N=7) not asked yet", prompts);
    // "Restart": a brand-new service instance (no memory); the 7th message is stored the way the webhook does it.
    const restarted = new WhatsappAutoReplyService();
    const text7 = "question number 7 about the course";
    await whatsappService.processTextMessage(biz.id, `wa-${tag}-restart`, P, text7);
    const before = mainCalls.length;
    const res = await restarted.generateAndSendReply(biz.id, P, text7);
    const c7 = mainCalls.slice(before).find(c => c.lastUser === text7);
    expect(res.success && c7 && /NEXT DETAIL TO ASK FOR: email address \(optional\)/.test(c7.leadPrompt), "message 7 after a restart: email asked (count from stored messages, beyond the 10-message history)", c7?.leadPrompt);
  }

  // ── 3. No lead asks while a guided flow session is active ──
  {
    const biz = await business(config(on("name", { required: true, priority: 1 })));
    const [flow] = await db.insert(schema.whatsappFlows).values({ businessAccountId: biz.id, name: "Journey", isActive: "true" } as any).returning();
    await db.insert(schema.whatsappFlowSteps).values({ flowId: flow.id, stepKey: "ask_city", stepOrder: 1, type: "text", prompt: "Which city are you in?" } as any);
    const P = `9196${tag.replace(/\D/g, "").padEnd(8, "3").slice(0, 8)}`;
    await db.insert(schema.whatsappFlowSessions).values({
      businessAccountId: biz.id, flowId: flow.id, senderPhone: P, currentStepKey: "ask_city", status: "active",
      collectedData: {}, lastMessageAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60_000),
    } as any);
    await updateSession(biz.id, P); // what the webhook does on every inbound message (24 h window open)
    // The flow handed this message to the AI (e.g. an off-topic question mid-journey).
    const svc = new WhatsappAutoReplyService();
    const text = "do you have weekend batches?";
    await whatsappService.processTextMessage(biz.id, `wa-${tag}-flow1`, P, text);
    let before = mainCalls.length;
    await svc.generateAndSendReply(biz.id, P, text);
    const inFlow = mainCalls.slice(before).find(c => c.lastUser === text);
    expect(inFlow && !inFlow.leadPrompt && !inFlow.tools.includes("capture_lead") && !/NEXT DETAIL TO ASK FOR/.test(inFlow.allSystem), "active flow session → no lead-capture asks, no capture tool", inFlow && { lead: inFlow.leadPrompt, tools: inFlow.tools });

    // "Smart AI" mode bypasses flows, so the same leftover session doesn't block lead capture.
    await db.update(schema.whatsappSettings).set({ aiResponseMode: "smart_ai" } as any).where(eq(schema.whatsappSettings.businessAccountId, biz.id));
    const text2 = "and on sundays?";
    await whatsappService.processTextMessage(biz.id, `wa-${tag}-flow2`, P, text2);
    before = mainCalls.length;
    await svc.generateAndSendReply(biz.id, P, text2);
    const smart = mainCalls.slice(before).find(c => c.lastUser === text2);
    expect(smart && /NEXT DETAIL TO ASK FOR: full name \(required\)/.test(smart.leadPrompt), "smart_ai mode (flows bypassed) → lead capture applies", smart?.leadPrompt);
  }

  // ── 4. No capture tool / no capture_lead text when leads can't be saved ──
  {
    const biz = await business(config(on("name", { priority: 1 })), { leadCaptureEnabled: "false" });
    const P = `9195${tag.replace(/\D/g, "").padEnd(8, "4").slice(0, 8)}`;
    const [c] = await wa(biz.id, P, "hello there");
    expect(c && /NEXT DETAIL TO ASK FOR: full name/.test(c.leadPrompt) && !c.tools.includes("capture_lead") && !/capture_lead/.test(c.allSystem), "lead capture off → name still asked, but no capture_lead tool or text", c && { tools: c.tools });
  }

  await sleep(300);
  expect(blockedCalls.length === 0, "no outbound call outside the fakes", blockedCalls);
  server.close();
  fake.close();
}

main().then(() => {
  if (failed > 0) { console.error(`\n${failed} WhatsApp lead timing test(s) failed.`); process.exit(1); }
  console.log("\nAll WhatsApp lead timing tests passed.");
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
