/**
 * WhatsApp product replies end to end (local Postgres/PGlite, fake OpenAI, MSG91 stub — nothing leaves
 * the machine). The fake model only searches the catalog when it is made to, like the real one that
 * answered "do you have CQ Trop" from the chat history without searching:
 *
 *  - a product question always searches the catalog (tool_choice = get_products), so products are shown;
 *  - 2+ products go out as ONE carousel message after the text (no separate photo cards, no extra
 *    Book Consultation message); cards carry "Know more (N)" + "Book consultation";
 *  - MSG91 refusing the carousel → separate photo cards, spaced out, then the Book Consultation buttons;
 *  - a "Know more (2)" tap reaches the AI as "2" (product pick);
 *  - a greeting is not forced to search; WHATSAPP_PRODUCT_CAROUSEL=0 sends cards;
 *  - a picked product's details: the AI gets the full description and a fixed layout, and its text is
 *    tidied for WhatsApp (**bold** → *bold*, nested "-" lists → flat "• " bullets, no gaps inside lists).
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55571/postgres?sslmode=disable \
 *   WA_PRODUCT_TEST_DB=1 npx tsx server/services/__tests__/whatsappProductReply.integration.test.ts
 */
import crypto from "crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

const url = process.env.DATABASE_URL || "";
if (process.env.WA_PRODUCT_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set WA_PRODUCT_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString("hex");
process.env.OPENAI_API_KEY = "sk-test-fake";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 700)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const textOf = (c: any) => (typeof c === "string" ? c : c == null ? "" : JSON.stringify(c));

// ── Fake OpenAI: searches only when forced ──
interface Call { main: boolean; followUp: boolean; toolChoice: any; tools: string[]; lastUser: string; systemText: string }
const calls: Call[] = [];
function answer(body: any): any {
  const msgs: any[] = body.messages || [];
  const all = msgs.map(m => textOf(m.content)).join("\n");
  const sys0 = textOf(msgs[0]?.content);
  const lastUser = textOf([...msgs].reverse().find(m => m.role === "user")?.content);
  const main = /responding to customer inquiries via WhatsApp|AI AGENT PERSONA/.test(sys0);
  const followUp = msgs.some(m => m.role === "tool");
  calls.push({ main, followUp, toolChoice: body.tool_choice, tools: (body.tools || []).map((t: any) => t?.function?.name), lastUser, systemText: msgs.filter(m => m.role === "system").map(m => textOf(m.content)).join("\n") });
  if (/You are a message classifier/.test(all)) return { role: "assistant", content: /strips|analy[sz]er|kit|have|price|show/i.test(lastUser) ? "YES" : "NO" };
  if (/You are a product search assistant/.test(all)) return { role: "assistant", content: "[1, 2, 3]" };
  if (/language detector/i.test(sys0)) return { role: "assistant", content: "en" };
  if (body.response_format?.type === "json_object") return { role: "assistant", content: "{}" };
  if (!main) return { role: "assistant", content: "OK" };
  if (followUp && lastUser === "2") {
    // A sloppy model: markdown bold, headings, nested lists with blank lines between.
    return { role: "assistant", content: "Great choice! Here are the details for the **Glucose Meter Kit**:\n\n### Overview\n\n- **Purpose**: Checks glucose.\n\n- **Key Features**:\n  - Fast results\n\n  - In the lab\n\n\n\nWould you like to book a consultation?" };
  }
  if (followUp) return { role: "assistant", content: "Here are our options." };
  if (body.tool_choice?.function?.name === "get_products") {
    return { role: "assistant", content: null, tool_calls: [{ id: "p1", type: "function", function: { name: "get_products", arguments: JSON.stringify({ search: lastUser }) } }] };
  }
  return { role: "assistant", content: "Yes, we have it!" }; // answers from memory unless made to search
}
function startFakeOpenAI(): Promise<string> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      res.setHeader("content-type", "application/json");
      if (req.url?.includes("/embeddings")) {
        const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
        return res.end(JSON.stringify({ object: "list", data: inputs.map((_, i) => ({ object: "embedding", index: i, embedding: Array(1536).fill(0.01) })), model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } }));
      }
      const message = answer(body);
      res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, finish_reason: message.tool_calls ? "tool_calls" : "stop", message }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`)));
}

// ── MSG91 stub ──
const sent: { at: number; kind: string; body: any }[] = [];
let refuseCarousel = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
  if (/^https:\/\/control\.msg91\.com\//.test(target)) {
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
    const kind = body?.content_type === "interactive" ? `interactive:${body.interactive?.type}` : body?.content_type || "text";
    sent.push({ at: Date.now(), kind, body });
    if (refuseCarousel && kind === "interactive:carousel") {
      return new Response(JSON.stringify({ status: "fail", hasError: true, errors: "content not supported" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ status: "success", data: { message_uuid: `u_${sent.length}` } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

async function main() {
  process.env.OPENAI_BASE_URL = await startFakeOpenAI();
  const { db, pool } = await import("../../db");
  const schema = await import("@shared/schema");
  const { WhatsappAutoReplyService } = await import("../whatsappAutoReplyService");
  const { whatsappService } = await import("../whatsappService");
  const { updateSession } = await import("../whatsappSessionService");
  const { businessContextCache } = await import("../businessContextCache");

  const tag = crypto.randomBytes(3).toString("hex");
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `WA products ${tag}`, website: "https://example.com", whatsappEnabled: "true", openaiApiKey: "sk-test-fake" } as any).returning();
  const A = biz.id as string;
  await db.insert(schema.widgetSettings).values({ businessAccountId: A, currency: "INR" } as any).onConflictDoNothing();
  await db.insert(schema.whatsappSettings).values({ businessAccountId: A, msg91AuthKey: "test-key", msg91IntegratedNumberId: "910000000000", webhookSecret: `sec-${tag}`, autoReplyEnabled: "true", whatsappEnabled: "true" } as any);
  for (const [i, name] of ["Glucose Test Strips (50)", "Glucose Meter Kit", "Glucose Control Solution"].entries()) {
    await db.insert(schema.products).values({ businessAccountId: A, name, description: `Overview\n${name} for clinics.\nFast results\nin the lab.`, price: String(500 + i * 100), imageUrl: `https://cdn.test/p${i}.jpg`, source: "manual" } as any);
  }

  const svc = new WhatsappAutoReplyService();
  let seq = 0;
  async function reply(text: string, samePhone?: string) {
    const phone = samePhone || `9198${tag.replace(/\D/g, "").padEnd(4, "7").slice(0, 4)}${String(++seq).padStart(4, "0")}`;
    await updateSession(A, phone);
    await whatsappService.processTextMessage(A, `m-${tag}-${seq}`, phone, text);
    businessContextCache.invalidateBusinessCache(A);
    const c0 = calls.length, s0 = sent.length;
    const res = await svc.generateAndSendReply(A, phone, text);
    return { res, phone, calls: calls.slice(c0), sent: sent.slice(s0) };
  }

  // 1. Product question → search forced → one carousel
  const r1 = await reply("do you have glucose strips");
  const main1 = r1.calls.find(c => c.main && !c.followUp);
  expect(main1?.toolChoice?.function?.name === "get_products", "product question: the AI is made to search the catalog", main1?.toolChoice);
  expect(r1.calls.some(c => c.main && c.followUp), "the search ran and the AI answered with its results");
  const kinds1 = r1.sent.map(s => s.kind);
  expect(kinds1[0] === "text" && kinds1.filter(k => k === "interactive:carousel").length === 1, "text reply first, then one carousel", kinds1);
  expect(!kinds1.includes("image") && !kinds1.includes("interactive:button"), "no separate photo cards and no separate Book Consultation message", kinds1);
  const car = r1.sent.find(s => s.kind === "interactive:carousel")?.body?.interactive;
  expect(car?.action?.cards?.length === 3 && car.action.cards.every((c: any) => c.header?.image?.link?.startsWith("https://cdn.test/")), "3 cards with their photos", car?.action?.cards?.length);
  const card1 = car?.action?.cards?.[0];
  expect(/^\*Glucose/.test(card1?.body?.text) && /₹/.test(card1?.body?.text) && !/Overview/.test(card1?.body?.text) && /Fast results in the lab\./.test(card1?.body?.text), "card text: name, price, clean short line", card1?.body?.text);
  expect(card1?.action?.buttons?.map((b: any) => b.quick_reply.title).join("|") === "Know more (1)|Book consultation", "card buttons: Know more (1) + Book consultation", card1?.action?.buttons);
  const follow1 = r1.calls.find(c => c.main && c.followUp);
  expect(/Do NOT ask the user to reply with a number/.test(follow1?.systemText || "") && !/End with "Reply with a number/.test(follow1?.systemText || ""), "carousel: the AI is told not to ask for a number");
  expect(car?.body?.text === "Swipe to see the products, then tap Know more for details.", "carousel text points to Know more", car?.body?.text);

  // 2. Greeting → not forced
  const r2 = await reply("hey");
  const main2 = r2.calls.find(c => c.main && !c.followUp);
  expect(!main2?.toolChoice?.function, "a greeting is not made to search", main2?.toolChoice);
  expect(r2.sent.every(s => s.kind === "text"), "greeting: just the text reply", r2.sent.map(s => s.kind));

  // 3. Know more (2) tap → AI sees "2"
  const r3 = await reply("Know more (2)", r1.phone);
  const main3 = r3.calls.find(c => c.main && !c.followUp);
  expect(main3?.toolChoice?.function?.name === "get_products", "a pick right after the carousel searches the catalog for that product", main3?.toolChoice);
  expect(!r3.sent.some(s => s.kind === "interactive:carousel" || s.kind === "image"), "a pick gets the details only (no new carousel)", r3.sent.map(s => s.kind));
  expect(r3.calls.some(c => c.main && c.lastUser === "2"), "a Know more (2) tap reaches the AI as \"2\"", r3.calls.map(c => c.lastUser));

  const detail = String((r3.res as any)?.reply || "");
  const follow3 = r3.calls.find(c => c.main && c.followUp);
  expect(/Use exactly this layout/.test(follow3?.systemText || ""), "product details: the AI gets the fixed WhatsApp layout");
  expect(/\*Glucose Meter Kit\*/.test(detail) && !/\*\*/.test(detail) && !/#/.test(detail), "details text: single-asterisk bold, no markdown leftovers", detail);
  expect(detail.includes("• *Purpose*: Checks glucose.\n• *Key Features*:\n• Fast results\n• In the lab"), "details text: flat • bullets with no gaps between them", detail);
  expect(!/\n\n\n/.test(detail), "details text: never more than one empty line", detail);

  // 4. Carousel refused → spaced photo cards, then buttons
  refuseCarousel = true;
  const r4 = await reply("show me glucose meter kit");
  const kinds4 = r4.sent.map(s => s.kind);
  const imgs = r4.sent.filter(s => s.kind === "image");
  expect(kinds4.includes("interactive:carousel") && imgs.length === 3 && kinds4[kinds4.length - 1] === "interactive:button", "refused carousel → 3 photo cards, then the Book Consultation buttons", kinds4);
  const gaps = imgs.slice(1).map((s, i) => s.at - imgs[i].at);
  const btnGap = r4.sent[r4.sent.length - 1].at - imgs[imgs.length - 1].at;
  expect(gaps.every(g => g >= 2400) && btnGap >= 4900, "cards ~2.5 s apart, buttons ~5 s after the last card", { gaps, btnGap });
  expect(/^\*1\. Glucose/.test(imgs[0].body.caption) && !/Overview/.test(imgs[0].body.caption), "fallback caption: no Overview heading", imgs[0].body.caption);
  const cta4 = r4.sent[r4.sent.length - 1].body?.interactive?.body?.text;
  expect(/Reply with a product's number to know more/.test(cta4 || ""), "refused carousel → the closing buttons say to reply with a number", cta4);
  refuseCarousel = false;

  // 5. Switched off → cards
  process.env.WHATSAPP_PRODUCT_CAROUSEL = "0";
  const r5 = await reply("do you have glucose strips");
  expect(!r5.sent.some(s => s.kind === "interactive:carousel") && r5.sent.filter(s => s.kind === "image").length === 3, "WHATSAPP_PRODUCT_CAROUSEL=0 → photo cards", r5.sent.map(s => s.kind));
  const follow5 = r5.calls.find(c => c.main && c.followUp);
  expect(/End with "Reply with a number to know more!"/.test(follow5?.systemText || ""), "numbered photo cards: the AI still ends with \"Reply with a number to know more!\"");
  const cta5 = r5.sent[r5.sent.length - 1].body?.interactive?.body?.text;
  expect(cta5 === "Interested in any of these? Let us help you further!", "cards without a carousel attempt keep the usual closing text", cta5);
  delete process.env.WHATSAPP_PRODUCT_CAROUSEL;

  await pool.end().catch(() => {});
  console.log(failed ? `\n${failed} check(s) failed` : "\nAll WhatsApp product reply checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
