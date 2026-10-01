/**
 * Website → WhatsApp hand-off end to end, through the REAL routes (registerRoutes) and real SQL:
 *  - POST /api/chat/widget/whatsapp-handoff: code format, topic in the pre-filled text, custom
 *    message kept, number resolution (connected AI number by default, an explicit widget number
 *    wins and gets no ref), product source, no number → 409;
 *  - the MSG91 webhook with the ref: linked (profile identities verified on both sides), the ref is
 *    stripped before extraction / flows / AI and from the stored message, the AI gets the website
 *    context + greet-by-name, lead training doesn't re-ask the known name / email, the website lead
 *    gets the WhatsApp number and LeadSquared receives an UPDATE of the existing lead;
 *  - one person in the unified leads (trail website → whatsapp; grouped; masking kept);
 *  - LeadSquared duplicate → looked up and updated; custom CRM not created twice;
 *  - expired / other-phone / other-business codes don't link; a phone typed on the website doesn't
 *    pull the WhatsApp history into the website AI (OTP-verified does);
 *  - a guided flow (trigger keyword) still starts when the first message carries a ref;
 *  - click / conversion numbers; same-turn profile link on a lead write.
 * OpenAI, MSG91, LeadSquared and the custom CRM are local fakes; nothing leaves the machine.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55921/postgres?sslmode=disable \
 *   WA_HANDOFF_TEST_DB=1 npx tsx server/services/__tests__/whatsappHandoff.integration.test.ts
 */
import crypto from "crypto";
import http from "node:http";
import express from "express";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.WA_HANDOFF_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set WA_HANDOFF_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.OPENAI_API_KEY = "sk-test-fake";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 900)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(cond: () => Promise<boolean> | boolean, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(50); }
  return !!(await cond());
}
const textOf = (c: any) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p?.text || "").join(" ") : c == null ? "" : JSON.stringify(c));

// ── Fake OpenAI (records every request body) ────────────────────────────────
interface Call { raw: string; body: any; system: string; lastUser: string; whatsappMain: boolean; stream: boolean }
const calls: Call[] = [];
function startFakeOpenAI(): Promise<{ baseUrl: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url?.includes("/embeddings")) {
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ object: "list", data: inputs.map((_: any, i: number) => ({ object: "embedding", index: i, embedding: new Array(1536).fill(0.01) })), model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } }));
      }
      const msgs: any[] = body.messages || [];
      const system = msgs.filter(m => m.role === "system").map(m => textOf(m.content)).join("\n");
      const lastUser = textOf([...msgs].reverse().find(m => m.role === "user")?.content);
      const whatsappMain = /responding to customer inquiries via WhatsApp/.test(textOf(msgs[0]?.content));
      calls.push({ raw, body, system, lastUser, whatsappMain, stream: !!body.stream });
      let content = "Sure, happy to help with that.";
      if (/language detector/i.test(textOf(msgs[0]?.content))) content = "en";
      else if (body.response_format?.type === "json_object") content = JSON.stringify({ customer_name: null, customer_phone: null, customer_email: null, notes: null });
      if (!body.stream) {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const send = (delta: any, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      send({ role: "assistant", content: "" });
      send({ content });
      send({}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() });
  }));
}

// ── Fake LeadSquared + custom CRM relay ─────────────────────────────────────
const lsq = { creates: [] as any[], updates: [] as Array<{ leadId: string; body: any }>, lookups: [] as string[], duplicateNames: new Set<string>(), knownPhones: new Map<string, string>(), n: 0 };
const crm = { requests: [] as any[], n: 0 };
const fakeHosts = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("content-type", "application/json");
    const u = new URL(`http://x${req.url}`);
    if (u.pathname.includes("Lead.Capture")) {
      const first = (body as any[]).find(a => a.Attribute === "FirstName")?.Value;
      if (first && lsq.duplicateNames.has(first)) {
        res.writeHead(500);
        return res.end(JSON.stringify({ Status: "Error", ExceptionType: "MXDuplicateEntryException", ExceptionMessage: "A Lead with same Phone Number already exists." }));
      }
      lsq.creates.push(body);
      return res.end(JSON.stringify({ Status: "Success", Message: { Id: `LSQ-${++lsq.n}` } }));
    }
    if (u.pathname.includes("Lead.Update")) {
      lsq.updates.push({ leadId: u.searchParams.get("leadId") || "", body });
      return res.end(JSON.stringify({ Status: "Success", Message: { AffectedRows: 1 } }));
    }
    if (u.pathname.includes("RetrieveLeadByPhoneNumber")) {
      const phone = u.searchParams.get("phone") || "";
      lsq.lookups.push(phone);
      const id = lsq.knownPhones.get(phone.replace(/\D/g, "").slice(-10));
      return res.end(JSON.stringify(id ? [{ ProspectID: id }] : []));
    }
    if (u.pathname.includes("Leads.GetByEmailaddress")) return res.end("[]");
    if (u.pathname === "/relay") {
      crm.requests.push(body);
      return res.end(JSON.stringify({ success: 1, data: { id: `CRM-${++crm.n}` } }));
    }
    res.writeHead(404); res.end("{}");
  });
});

// ── MSG91 stub ───────────────────────────────────────────────────────────────
const sent: { to: string; text: string }[] = [];
const realFetch = globalThis.fetch;
let fakePort = 0;
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  const u = new URL(target);
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(input, init);
  if (u.hostname === "lsq.handoff-test.example") return realFetch(`http://127.0.0.1:${fakePort}${u.pathname}${u.search}`, init);
  if (u.hostname === "control.msg91.com") {
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
    const text = u.searchParams.get("text") || body?.interactive?.body?.text || body?.text || JSON.stringify(body || {});
    sent.push({ to: u.searchParams.get("recipient_number") || body?.recipient_number || "", text });
    return new Response(JSON.stringify({ status: "success", data: { message_uuid: `u_${sent.length}` } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

async function main() {
  await new Promise<void>((r) => fakeHosts.listen(0, "127.0.0.1", r));
  fakePort = (fakeHosts.address() as AddressInfo).port;
  const fake = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and, asc, desc, sql } = await import("drizzle-orm");
  const { registerRoutes } = await import("../../routes");
  const { encrypt } = await import("../encryptionService");
  const handoffSvc = await import("../whatsappHandoffService");
  const { composeCrossPlatformContext } = await import("../crossPlatformMemoryService");
  const { getProfileByPlatformId } = await import("../customerProfileService");
  const { queryUnifiedLeads } = await import("../unifiedLeadsService");
  const { createLeadSquaredService } = await import("../leadsquaredService");
  const { syncWhatsappLeadToCustomCrm } = await import("../customCrmService");
  const { upsertConversationLead } = await import("../leadCapture/leadStore");
  const { chatService } = await import("../../chatService");

  const tag = crypto.randomBytes(4).toString("hex");
  const SECRET = `sec-${tag}`;
  const CONNECTED = "919000011111";
  const F = (id: string, extra: Record<string, any> = {}) => ({ id, enabled: false, required: false, priority: 4, captureStrategy: "start", ...extra });
  const leadConfig = { fields: [F("name", { enabled: true, priority: 1 }), F("email", { enabled: true, priority: 2 }), F("mobile"), F("whatsapp")], captureStrategy: "custom" };
  const lsqSettings = {
    leadsquaredEnabled: "true", leadsquaredConnectionType: "api", leadsquaredAccessKey: "ak", leadsquaredSecretKey: encrypt("sk"),
    leadsquaredRegion: "other", leadsquaredCustomHost: "https://lsq.handoff-test.example",
  };
  let seq = 0;
  async function business(opts: { wa?: Record<string, any>; widget?: Record<string, any>; whatsappEnabled?: boolean } = {}) {
    const [biz] = await db.insert(schema.businessAccounts).values({ name: `Handoff ${tag}-${++seq}`, website: "https://example.com", whatsappEnabled: opts.whatsappEnabled === false ? "false" : "true", openaiApiKey: "sk-test-fake" } as any).returning();
    if (opts.wa !== undefined) {
      await db.insert(schema.whatsappSettings).values({
        businessAccountId: biz.id, msg91AuthKey: "test-key", msg91IntegratedNumberId: CONNECTED, webhookSecret: SECRET,
        autoReplyEnabled: "true", leadCaptureEnabled: "true", useLeadTraining: "true", whatsappNumber: `+${CONNECTED}`, ...opts.wa,
      } as any);
    }
    await db.insert(schema.widgetSettings).values({ businessAccountId: biz.id, leadTrainingConfig: leadConfig, ...(opts.widget || {}) } as any);
    return biz;
  }
  async function websiteChat(bizId: string, visitorToken: string, turns: Array<[string, string]>, lead?: Record<string, any>) {
    const [conv] = await db.insert(schema.conversations).values({ businessAccountId: bizId, title: "Chat", visitorToken } as any).returning();
    let t = Date.now() - 10 * 60_000;
    for (const [role, content] of turns) {
      await db.insert(schema.messages).values({ conversationId: conv.id, role, content, createdAt: new Date(t += 1000) } as any);
    }
    let leadRow: any = null;
    // createdAt from the app clock, like the WhatsApp rows (the local test DB's NOW() is not UTC).
    if (lead) [leadRow] = await db.insert(schema.leads).values({ businessAccountId: bizId, conversationId: conv.id, createdAt: new Date(Date.now() - 5 * 60_000), ...lead } as any).returning();
    return { conv, lead: leadRow };
  }

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const postHandoff = async (body: Record<string, any>) => {
    const r = await fetch(`${base}/api/chat/widget/whatsapp-handoff`, { method: "POST", headers: { "content-type": "application/json", origin: "https://shop.example" }, body: JSON.stringify(body) });
    return { status: r.status, cors: r.headers.get("access-control-allow-origin"), json: await r.json().catch(() => null) as any };
  };
  const decodeText = (u: string) => decodeURIComponent(new URL(u).searchParams.get("text") || "");
  let uuidSeq = 0;
  /** One customer text through the MSG91 webhook; resolves once something was sent back (or timeout). */
  async function wa(bizId: string, phone: string, text: string, expectReply = true) {
    const before = sent.filter(s => s.to === phone).length;
    const callsBefore = calls.length;
    const r = await fetch(`${base}/api/webhook/msg91/${bizId}?secret=${SECRET}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerNumber: phone, text, contentType: "text", direction: "0", uuid: `wa-${tag}-${++uuidSeq}` }),
    });
    if (r.status !== 200) throw new Error(`webhook ${r.status}`);
    if (expectReply) await waitUntil(() => sent.filter(s => s.to === phone).length > before);
    await sleep(250);
    return { calls: calls.slice(callsBefore), replies: sent.filter(s => s.to === phone).slice(before) };
  }
  const handoffRow = async (code: string, bizId: string) => (await db.select().from(schema.whatsappHandoffs).where(and(eq(schema.whatsappHandoffs.code, code), eq(schema.whatsappHandoffs.businessAccountId, bizId))))[0];
  const incoming = async (bizId: string, phone: string) => db.select().from(schema.whatsappLeads)
    .where(and(eq(schema.whatsappLeads.businessAccountId, bizId), eq(schema.whatsappLeads.senderPhone, phone), eq(schema.whatsappLeads.direction, "incoming")))
    .orderBy(asc(schema.whatsappLeads.receivedAt));

  // ── Pure helpers ──────────────────────────────────────────────────────────
  {
    const codes = Array.from({ length: 200 }, () => handoffSvc.generateHandoffCode());
    expect(codes.every(c => /^[A-HJ-NP-Z2-9]{6}$/.test(c)), "codes: 6 chars, no 0/O/1/I", codes.slice(0, 5));
    expect(handoffSvc.cleanTopic("hi, what are the fees for MBA?") === "what are the fees for MBA", "topic: greeting and ? removed", handoffSvc.cleanTopic("hi, what are the fees for MBA?"));
    expect(handoffSvc.cleanTopic("ok") === null && handoffSvc.cleanTopic("my number is 9876543210") === "my number is", "topic: generic → null, phone numbers removed", handoffSvc.cleanTopic("my number is 9876543210"));
    const long = handoffSvc.cleanTopic("Can you tell me about the admission process and the eligibility for international students please")!;
    expect(long.length <= 60 && long.endsWith("…"), "topic: capped at 60 chars on a word", long);
    expect(handoffSvc.findRefCodes("hello (ref: k7q2mx) and Ref: ABCDEF").join(",") === "K7Q2MX,ABCDEF", "ref codes found case-insensitively", handoffSvc.findRefCodes("hello (ref: k7q2mx) and Ref: ABCDEF"));
    expect(handoffSvc.stripRefCodes("Hi! I was asking about x on your website. (Ref: K7Q2MX)", ["K7Q2MX"]) === "Hi! I was asking about x on your website.", "ref stripped", handoffSvc.stripRefCodes("Hi! I was asking about x on your website. (Ref: K7Q2MX)", ["K7Q2MX"]));
    expect(handoffSvc.stripRefCodes("(Ref: K7Q2MX)", ["K7Q2MX"]) === "Hi", "message that was only the code → 'Hi'");
    expect(handoffSvc.stripRefCodes("order Ref: ZZZZZZ please", ["K7Q2MX"]) === "order Ref: ZZZZZZ please", "unknown codes are left alone");
  }

  // ── 1. Links: number resolution, topic, custom message, product, errors ────
  const biz1 = await business({ wa: {}, widget: { ...lsqSettings, whatsappOrderEnabled: "true" } });
  for (const [i, [f, src]] of ([["FirstName", "lead.name"], ["Phone", "lead.phone"], ["EmailAddress", "lead.email"]] as const).entries()) {
    await db.insert(schema.leadsquaredFieldMappings).values({ businessAccountId: biz1.id, leadsquaredField: f, sourceType: "dynamic", sourceField: src, displayName: f, sortOrder: i } as any);
  }
  const { conv: conv1, lead: webLead1 } = await websiteChat(biz1.id, `vt1-${tag}`, [
    ["user", "Hi"], ["assistant", "Hello! How can I help?"],
    ["user", "What are the fees for the MBA program?"], ["assistant", "The MBA program fee is ₹4,50,000 per year."],
  ], { name: "Priya Sharma", email: "priya@example.com", leadsquaredLeadId: "LSQ-EXISTING", leadsquaredSyncStatus: "synced", customCrmSyncStatus: "synced", customCrmLeadId: "CRM-WEB-1" });

  const pub = await (await fetch(`${base}/api/widget-settings/public?businessAccountId=${biz1.id}`)).json();
  expect(pub.whatsappWidgetNumber === CONNECTED && pub.whatsappOrderNumber === CONNECTED, "public settings: no widget/order number → the connected WhatsApp AI number", { w: pub.whatsappWidgetNumber, o: pub.whatsappOrderNumber });

  const h1 = await postHandoff({ businessAccountId: biz1.id, conversationId: conv1.id, visitorToken: `vt1-${tag}`, source: "header" });
  const code1: string = h1.json?.code;
  expect(h1.status === 200 && /^[A-HJ-NP-Z2-9]{6}$/.test(code1), "handoff created with a 6-char code", h1);
  const text1 = decodeText(h1.json.url);
  expect(h1.json.url.startsWith(`https://wa.me/${CONNECTED}?text=`), "link opens the connected number", h1.json.url);
  expect(text1 === `Hi! I was asking about "What are the fees for the MBA program" on your website. (Ref: ${code1})`, "pre-filled text names the topic and carries the ref", text1);
  const row1 = await handoffRow(code1, biz1.id);
  expect(row1 && row1.source === "header" && row1.conversationId === conv1.id && row1.websiteLeadId === webLead1.id && row1.connectedNumber === true && !row1.usedAt
    && new Date(row1.expiresAt).getTime() - Date.now() > 6.9 * 24 * 3600_000, "click stored: source, conversation, lead, 7-day expiry", row1);

  const hWrongVisitor = await postHandoff({ businessAccountId: biz1.id, conversationId: conv1.id, visitorToken: "someone-else", source: "menu" });
  expect(hWrongVisitor.status === 200 && decodeText(hWrongVisitor.json.url) === `Hi! I was chatting on your website. (Ref: ${hWrongVisitor.json.code})`, "another visitor's conversation id → not used (generic text)", decodeText(hWrongVisitor.json.url));
  expect(!(await handoffRow(hWrongVisitor.json.code, biz1.id))?.conversationId, "…and not linked to that conversation");

  const [product] = await db.insert(schema.products).values({ businessAccountId: biz1.id, name: "Silk Saree", description: "Red", price: "1000" } as any).returning();
  const hProd = await postHandoff({ businessAccountId: biz1.id, source: "product", productId: product.id, message: "Hi! I'm interested in ordering: Silk Saree - ₹1,000", visitorToken: `vt1-${tag}` });
  expect(hProd.status === 200 && decodeText(hProd.json.url) === `Hi! I'm interested in ordering: Silk Saree - ₹1,000 (Ref: ${hProd.json.code})`, "product: the order message + ref", decodeText(hProd.json.url));
  expect((await handoffRow(hProd.json.code, biz1.id))?.topic === "Silk Saree", "product: topic is the product name");

  const biz2 = await business({ wa: {}, widget: { whatsappWidgetNumber: "+1 555 000 1234", whatsappWidgetMessage: "Hello team" } });
  const h2 = await postHandoff({ businessAccountId: biz2.id, source: "launcher", visitorToken: "v2" });
  expect(h2.status === 200 && h2.json.url.startsWith("https://wa.me/15550001234?") && decodeText(h2.json.url) === "Hello team", "explicit widget number kept; custom message kept; no ref (not the AI number)", h2.json);
  const pub2 = await (await fetch(`${base}/api/widget-settings/public?businessAccountId=${biz2.id}`)).json();
  expect(pub2.whatsappWidgetNumber === "+1 555 000 1234" && pub2.whatsappOrderNumber === CONNECTED, "public settings: explicit widget number untouched, empty order number → connected", { w: pub2.whatsappWidgetNumber, o: pub2.whatsappOrderNumber });
  const biz3 = await business({});
  const h3 = await postHandoff({ businessAccountId: biz3.id, source: "header" });
  expect(h3.status === 409, "no number anywhere → 409 (widget falls back / shows nothing)", h3);
  const pub3 = await (await fetch(`${base}/api/widget-settings/public?businessAccountId=${biz3.id}`)).json();
  expect(!pub3.whatsappWidgetNumber, "public settings unchanged when nothing is connected", pub3.whatsappWidgetNumber);
  expect((await postHandoff({ businessAccountId: biz1.id, source: "nope" })).status === 400, "bad source → 400");
  const bizCustom = await business({ wa: {}, widget: { whatsappWidgetMessage: "Hi, I need help" } });
  const hc = await postHandoff({ businessAccountId: bizCustom.id, source: "header" });
  expect(decodeText(hc.json.url) === `Hi, I need help (Ref: ${hc.json.code})`, "custom message on the AI number: kept + ref appended", decodeText(hc.json.url));

  // ── 2. Inbound WhatsApp message with the ref ──────────────────────────────
  const P = `9198${tag.replace(/\D/g, "").padEnd(8, "7").slice(0, 8)}`;
  const r1 = await wa(biz1.id, P, text1);
  const used = await handoffRow(code1, biz1.id);
  expect(used?.usedAt && used.whatsappPhone === P, "code used: usedAt + WhatsApp number recorded", used);
  const stored = await incoming(biz1.id, P);
  expect(stored.length >= 1 && stored.every(m => !/Ref:/i.test(m.rawMessage || "")) && stored[0].rawMessage === 'Hi! I was asking about "What are the fees for the MBA program" on your website.', "stored WhatsApp message has no ref", stored.map(m => m.rawMessage));
  expect(calls.every(c => !c.raw.includes(code1)), "no OpenAI request ever contains the ref code");
  const main1 = r1.calls.find(c => c.whatsappMain && c.lastUser.includes("MBA"));
  expect(main1 && /WEBSITE HAND-OFF CONTEXT/.test(main1.system) && /Priya Sharma/.test(main1.system) && /Greet them by name \(Priya Sharma\)/.test(main1.system)
    && /MBA program fee is/.test(main1.system) && /NEVER ask again/.test(main1.system), "WhatsApp AI gets the website context + greet-by-name", main1?.system.slice(-1500));
  expect(main1 && !/Do NOT proactively mention which platform/.test(main1.system), "hand-off: no 'don't mention the platform' rule");
  expect(main1 && !/NEXT DETAIL TO ASK FOR: (full name|email)/.test(main1.system), "lead training: website name / email count as collected (not re-asked)", (main1?.system.match(/NEXT DETAIL[^\n]*/) || [])[0]);
  expect(r1.replies.length >= 1, "WhatsApp reply sent", r1.replies);

  const waIdentity = await getProfileByPlatformId(biz1.id, "whatsapp", P);
  const webProfile = await getProfileByPlatformId(biz1.id, "website", `vt1-${tag}`);
  const idents = await db.select().from(schema.customerIdentities).where(eq(schema.customerIdentities.businessAccountId, biz1.id));
  const waId = idents.find(i => i.platform === "whatsapp" && i.platformUserId === P);
  const webId = idents.find(i => i.platform === "website" && i.platformUserId === `vt1-${tag}`);
  expect(waIdentity && webProfile && waIdentity.id === webProfile.id, "website visitor and WhatsApp number on one customer profile", { wa: waIdentity?.id, web: webProfile?.id });
  expect(waId?.verified && waId.verifiedVia === "whatsapp_sender" && webId?.verified && webId.verifiedVia === "handoff_code" && webId.verifiedPhone === P.slice(-10), "both identities verified for the WhatsApp number", { waId, webId });

  expect(await waitUntil(async () => (await db.select().from(schema.leads).where(eq(schema.leads.id, webLead1.id)))[0]?.phone === `+${P}`), "website lead got the verified WhatsApp number");
  expect(await waitUntil(() => lsq.updates.some(u => u.leadId === "LSQ-EXISTING")), "LeadSquared: existing website lead UPDATED with the phone", lsq.updates);
  const upd = lsq.updates.find(u => u.leadId === "LSQ-EXISTING");
  expect(upd && upd.body.some((a: any) => a.Attribute === "Phone" && String(a.Value).includes(P.slice(-10))) && lsq.creates.length === 0, "…with the phone, and no LeadSquared create", { upd, creates: lsq.creates.length });

  const r2 = await wa(biz1.id, P, "And how long is the course?");
  const main2 = r2.calls.find(c => c.whatsappMain && c.lastUser.includes("how long"));
  expect(main2 && /WEBSITE HAND-OFF CONTEXT/.test(main2.system) && /do not greet them again/.test(main2.system), "second message: context kept, no second greeting", main2?.system.match(/Instructions:[\s\S]{0,300}/)?.[0]);

  // Website side now (same visitor, verified by the code): WhatsApp history shared, platform may be named.
  const webCtx = await composeCrossPlatformContext(biz1.id, "website", webProfile!.id, true, `vt1-${tag}`);
  expect(/how long is the course/.test(webCtx) && /moved between our website chat and WhatsApp/.test(webCtx), "website AI (verified link) gets the WhatsApp conversation", webCtx.slice(0, 400));

  // ── 3. One person in the unified leads ───────────────────────────────────
  {
    const flat = await queryUnifiedLeads(biz1.id, {}, { limit: 50, offset: 0 });
    const web = flat.leads.find(r => r.channel === "website" && r.id === webLead1.id);
    const waRow = flat.leads.find(r => r.channel === "whatsapp" && (r.detail as any).senderPhone === P);
    expect(web && waRow && web.personId && web.personId === waRow.personId && JSON.stringify(web.channels) === '["website","whatsapp"]' && JSON.stringify(waRow.channels) === '["website","whatsapp"]',
      "flat list: both rows carry the same personId and the trail website → whatsapp", { web: web && { p: web.personId, c: web.channels }, wa: waRow && { p: waRow.personId, c: waRow.channels } });
    const grouped = await queryUnifiedLeads(biz1.id, { groupByPerson: true }, { limit: 50, offset: 0 });
    const person = grouped.leads.find(r => r.personId === web?.personId);
    expect(grouped.groupedByPerson && person && person.channel === "website" && person.linked?.length === 1 && person.linked[0].channel === "whatsapp"
      && grouped.leads.filter(r => r.personId === web?.personId).length === 1 && grouped.total === flat.total - 1,
      "groupByPerson: one row (website first, WhatsApp linked); total counts persons", { total: grouped.total, flat: flat.total, person: person && { ch: person.channel, linked: person.linked?.map(l => l.channel) } });
    await db.update(schema.businessAccounts).set({ leadPhoneMaskingEnabled: "true" } as any).where(eq(schema.businessAccounts.id, biz1.id));
    const masked = await queryUnifiedLeads(biz1.id, { groupByPerson: true }, { limit: 50, offset: 0 });
    const mp = masked.leads.find(r => r.personId === web?.personId);
    const shown = JSON.stringify(mp);
    expect(mp && !shown.includes(P.slice(-10)) && !shown.includes(P.slice(-8)), "phone masking still applies to merged rows (and personId leaks no digits)", shown.slice(0, 600));
    await db.update(schema.businessAccounts).set({ leadPhoneMaskingEnabled: "false" } as any).where(eq(schema.businessAccounts.id, biz1.id));
  }

  // ── 4. Codes that must not link ───────────────────────────────────────────
  {
    const P2 = `9197${tag.replace(/\D/g, "").padEnd(8, "3").slice(0, 8)}`;
    const r = await wa(biz1.id, P2, text1);
    const after = await handoffRow(code1, biz1.id);
    expect(after?.whatsappPhone === P && after.rejectedCount === 1, "same code from another number: not linked, counted", after);
    expect((await incoming(biz1.id, P2)).every(m => !/Ref:/i.test(m.rawMessage || "")), "…ref still stripped from the stored message");
    const m = r.calls.find(c => c.whatsappMain);
    expect(m && !/WEBSITE HAND-OFF CONTEXT/.test(m.system) && !/Priya/.test(m.system), "…and that number gets no website context", m?.system.slice(-600));
    expect(!(await getProfileByPlatformId(biz1.id, "whatsapp", P2)) || (await getProfileByPlatformId(biz1.id, "whatsapp", P2))!.id !== webProfile!.id, "…and is not on the visitor's profile");

    const same = await handoffSvc.processInboundHandoff(biz1.id, P, `again (Ref: ${code1})`);
    expect(same.linked && same.text === "again", "the same number may send the code again", same);

    const hExp = await postHandoff({ businessAccountId: biz1.id, conversationId: conv1.id, visitorToken: `vt1-${tag}`, source: "header" });
    await db.update(schema.whatsappHandoffs).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.whatsappHandoffs.code, hExp.json.code));
    const exp = await handoffSvc.processInboundHandoff(biz1.id, "919811100000", decodeText(hExp.json.url));
    expect(!exp.linked && exp.reason === "expired" && !/Ref:/.test(exp.text) && !(await handoffRow(hExp.json.code, biz1.id))?.usedAt, "expired code: stripped, not linked", exp);

    const foreign = await handoffSvc.processInboundHandoff(biz1.id, "919811100001", `Hello team (Ref: ${h2.json.code})`);
    expect(!foreign.linked && foreign.reason === "unknown" && foreign.text.includes(h2.json.code), "another business's code: not recognised, not linked", foreign);
  }

  // ── 5. Website: a typed phone doesn't pull WhatsApp history; OTP-verified does ──
  {
    const typed = await websiteChat(biz1.id, `vt-typed-${tag}`, [["user", "hello"]]);
    await upsertConversationLead({ businessAccountId: biz1.id, conversationId: typed.conv.id, values: { phone: P.slice(-10), name: "Someone" } });
    const typedIdentity = (await db.select().from(schema.customerIdentities).where(and(eq(schema.customerIdentities.businessAccountId, biz1.id), eq(schema.customerIdentities.platformUserId, `vt-typed-${tag}`))))[0];
    expect(typedIdentity && !typedIdentity.verified, "lead write links the profile in the same turn (unverified for a typed phone)", typedIdentity);
    const ctx = await composeCrossPlatformContext(biz1.id, "website", typedIdentity!.profileId, true, `vt-typed-${tag}`);
    expect(ctx === "", "typed phone (unverified): no WhatsApp history for the website AI", ctx.slice(0, 200));

    // End to end through the website chat: the system prompt has no WhatsApp conversation.
    const before = calls.length;
    for await (const _ev of chatService.streamMessage("what courses do you have?", {
      userId: `widget_session_s-${tag}`, businessAccountId: biz1.id, openaiApiKey: "sk-test-fake", channel: "widget",
      visitorToken: `vt-typed-${tag}`, personality: "friendly", responseLength: "balanced",
    } as any)) { /* drain */ }
    const webCalls = calls.slice(before);
    expect(webCalls.length > 0 && webCalls.every(c => !/how long is the course/.test(c.raw) && !/CROSS-PLATFORM/.test(c.raw)), "website chat (typed phone): no WhatsApp history in any AI request", webCalls.length);

    const otp = await websiteChat(biz1.id, `vt-otp-${tag}`, [["user", "hello"]]);
    await db.insert(schema.phoneOtpChallenges).values({
      businessAccountId: biz1.id, conversationId: otp.conv.id, phoneE164: `+${P}`, codeHash: "x", expiresAt: new Date(Date.now() + 600_000), verifiedAt: new Date(),
    } as any);
    await upsertConversationLead({ businessAccountId: biz1.id, conversationId: otp.conv.id, values: { phone: `+${P}` } });
    const otpIdentity = (await db.select().from(schema.customerIdentities).where(and(eq(schema.customerIdentities.businessAccountId, biz1.id), eq(schema.customerIdentities.platformUserId, `vt-otp-${tag}`))))[0];
    expect(otpIdentity?.verified && otpIdentity.verifiedVia === "otp", "OTP-verified website phone → identity verified", otpIdentity);
    const otpCtx = await composeCrossPlatformContext(biz1.id, "website", otpIdentity!.profileId, true, `vt-otp-${tag}`);
    expect(/how long is the course/.test(otpCtx) && /Do NOT proactively mention which platform/.test(otpCtx), "OTP-verified: WhatsApp history shared (platform not mentioned)", otpCtx.slice(0, 300));
  }

  // ── 6. LeadSquared duplicate → look up and update ─────────────────────────
  {
    const svc = await createLeadSquaredService({ accessKey: "ak", secretKey: "sk", region: "other", customHost: "https://lsq.handoff-test.example" } as any);
    const mappings = [["FirstName", "lead.name"], ["Phone", "lead.phone"], ["EmailAddress", "lead.email"]].map(([f, src], i) => ({ leadsquaredField: f, sourceType: "dynamic", sourceField: src, displayName: f, sortOrder: i, isEnabled: "true" })) as any;
    lsq.duplicateNames.add("Dup Person");
    lsq.knownPhones.set("9876500001", "LSQ-DUP");
    const updatesBefore = lsq.updates.length;
    const res = await svc.createLeadWithMappings(mappings, { lead: { name: "Dup Person", phone: "+91 98765 00001", email: "dup@example.com" }, session: {}, business: {} } as any);
    const u = lsq.updates.slice(updatesBefore).find(x => x.leadId === "LSQ-DUP");
    expect(res.success && res.alreadyExists && res.leadId === "LSQ-DUP" && u && u.body.some((a: any) => a.Attribute === "EmailAddress" && a.Value === "dup@example.com"), "duplicate → existing lead found by phone and updated", { res, u });
    const res2 = await svc.createLeadWithMappings(mappings, { lead: { name: "Dup Person", phone: "+91 98765 00999" }, session: {}, business: {} } as any);
    expect(res2.success && res2.alreadyExists && !res2.leadId, "duplicate not found by lookup → previous behaviour (treated as synced)", res2);
  }

  // ── 7. Custom CRM: not created twice for the same person ───────────────────
  {
    await db.insert(schema.customCrmSettings).values({
      businessAccountId: biz1.id, enabled: true, autoSyncEnabled: true, name: "CRM",
      apiBaseUrl: "https://crm.handoff-test.example", apiEndpoint: "/api/create", authType: "none", contentType: "json", relayUrl: `http://127.0.0.1:${fakePort}`,
    } as any);
    await db.insert(schema.customCrmFieldMappings).values({ businessAccountId: biz1.id, crmField: "phone", sourceType: "dynamic", sourceField: "lead.senderPhone", displayName: "phone", sortOrder: 0 } as any);
    const [waLead] = (await db.select().from(schema.whatsappLeads).where(and(eq(schema.whatsappLeads.businessAccountId, biz1.id), eq(schema.whatsappLeads.senderPhone, P), eq(schema.whatsappLeads.direction, "incoming"))).orderBy(asc(schema.whatsappLeads.receivedAt)));
    const before = crm.requests.length;
    const linkedRes = await syncWhatsappLeadToCustomCrm(waLead.id, { source: "bulk" });
    expect(linkedRes.skipped === "same_person_in_crm" && crm.requests.length === before, "linked WhatsApp lead whose website lead is already in the CRM → not created twice", linkedRes);
    const forced = await syncWhatsappLeadToCustomCrm(waLead.id, { source: "manual", force: true });
    expect(forced.success && crm.requests.length === before + 1, "manual Sync (force) still pushes", forced);
    const P3 = "919811100000";
    const [other] = await db.insert(schema.whatsappLeads).values({ businessAccountId: biz1.id, senderPhone: P3, rawMessage: "hi", direction: "incoming", status: "new", customerName: "Other" } as any).returning();
    const otherRes = await syncWhatsappLeadToCustomCrm(other.id, { source: "bulk" });
    expect(otherRes.success && crm.requests.length === before + 2, "unlinked WhatsApp lead → pushed as before", otherRes);
    // PAN + email (LOS) accounts keep their WhatsApp application flow unchanged.
    await db.update(schema.whatsappSettings).set({ requirePanEmailForLead: "true" } as any).where(eq(schema.whatsappSettings.businessAccountId, biz1.id));
    const { findWebsiteLeadForWhatsapp } = handoffSvc;
    expect((await findWebsiteLeadForWhatsapp(biz1.id, P))?.id === webLead1.id, "website lead found from the WhatsApp number");
    await db.update(schema.whatsappSettings).set({ requirePanEmailForLead: "false" } as any).where(eq(schema.whatsappSettings.businessAccountId, biz1.id));
  }

  // ── 8. Guided flow (Caprion-like): trigger keyword with a ref still starts the journey ──
  {
    const biz4 = await business({ wa: { aiResponseMode: "guided_flows" }, widget: { whatsappWidgetMessage: "Apply" } });
    const [flow] = await db.insert(schema.whatsappFlows).values({ businessAccountId: biz4.id, name: "Loan", isActive: "true", triggerKeyword: "Apply" } as any).returning();
    await db.insert(schema.whatsappFlowSteps).values({ flowId: flow.id, stepKey: "ask_name", stepOrder: 1, type: "text", prompt: "What is your full name?" } as any);
    await db.insert(schema.whatsappFlowSteps).values({ flowId: flow.id, stepKey: "ask_city", stepOrder: 2, type: "text", prompt: "Which city do you live in?" } as any);
    const { conv } = await websiteChat(biz4.id, `vt4-${tag}`, [["user", "I want a loan"]], { name: "Amit", email: "amit@example.com" });
    const h = await postHandoff({ businessAccountId: biz4.id, conversationId: conv.id, visitorToken: `vt4-${tag}`, source: "header" });
    expect(decodeText(h.json.url) === `Apply (Ref: ${h.json.code})`, "flow trigger as the custom message + ref", decodeText(h.json.url));
    const P4 = "919811144444";
    const r = await wa(biz4.id, P4, decodeText(h.json.url));
    expect(r.replies.some(x => /What is your full name\?/.test(x.text)), "trigger keyword matched after stripping: journey started", r.replies);
    const [session] = await db.select().from(schema.whatsappFlowSessions).where(and(eq(schema.whatsappFlowSessions.businessAccountId, biz4.id), eq(schema.whatsappFlowSessions.senderPhone, P4)));
    expect(session?.status === "active" && session.currentStepKey === "ask_name", "flow session active on its first step", session);
    expect((await handoffRow(h.json.code, biz4.id))?.whatsappPhone === P4, "hand-off linked during the flow");
    expect(await waitUntil(async () => (await incoming(biz4.id, P4)).some(m => m.rawMessage === "Apply")), "flow message stored without the ref", (await incoming(biz4.id, P4)).map(m => m.rawMessage));
    const r2 = await wa(biz4.id, P4, "Amit Kumar");
    const [s2] = await db.select().from(schema.whatsappFlowSessions).where(eq(schema.whatsappFlowSessions.id, session.id));
    expect(r2.replies.length >= 1 && !r2.calls.some(c => c.whatsappMain) && (s2.status !== "active" || s2.currentStepKey !== "ask_name"), "journey continues normally (flow answers the next message, not the AI)", { replies: r2.replies, status: s2.status, step: s2.currentStepKey });
  }

  // ── 9. Tracking + API auth ────────────────────────────────────────────────
  {
    const stats = await handoffSvc.getHandoffStats(biz1.id, 30);
    expect(stats.clicks === 4 && stats.continued === 1 && stats.leads === 1 && stats.bySource.header?.continued === 1, "stats: clicks, continued, leads", stats);
    const unauth = await fetch(`${base}/api/analytics/whatsapp-handoff?days=30`);
    expect(unauth.status === 401 || unauth.status === 403, "stats API requires login", unauth.status);
  }

  // Never a ref code in any AI request.
  const allCodes = (await db.select({ code: schema.whatsappHandoffs.code }).from(schema.whatsappHandoffs)).map(r => r.code);
  const leaked = calls.filter(c => allCodes.some(code => c.raw.includes(`Ref: ${code}`)));
  expect(leaked.length === 0, "no AI request contains a recognised ref", leaked.map(c => c.lastUser));

  fake.close();
  server.close();
  fakeHosts.close();
  if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log("\nAll WhatsApp hand-off checks passed.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
