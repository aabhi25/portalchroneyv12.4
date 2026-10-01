/**
 * Channel tags on training items (FAQs, documents, trained URLs, website pages, Train Chroney
 * instructions): a WhatsApp-only item reaches WhatsApp prompts and never the website, a
 * website-only item never reaches WhatsApp, untagged items reach every channel, Instagram /
 * Facebook respect their tags; API validation; caches refresh right after a tag change; untagged
 * instructions produce byte-identical prompts to the previous parsers.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55935/postgres?sslmode=disable \
 *   CHANNEL_TAGS_TEST_DB=1 DB_POOL_MAX=1 npx tsx server/services/__tests__/knowledgeChannels.integration.test.ts
 */
import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.CHANNEL_TAGS_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set CHANNEL_TAGS_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.OPENAI_API_KEY = "sk-test-fake";
delete process.env.CHAT_CONTEXT_MODE;
delete process.env.CHAT_CONTEXT_LEGACY_ACCOUNTS;
delete process.env.WHATSAPP_CONTEXT_MODE;

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)?.slice(0, 700)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── The previous parsers, verbatim in behaviour (chatService.buildEnrichedContext / llamaService final override) ──
function oldChatBlock(raw: string): { block: string; fallback: string[] } {
  let customInstructionsContext = "";
  let fallbackInstructions: string[] = [];
  if (raw && raw.trim()) {
    try {
      const instructions = JSON.parse(raw);
      if (Array.isArray(instructions) && instructions.length > 0) {
        const alwaysActive = instructions.filter((i: any) => i.type === "always" || !i.type);
        const conditional = instructions.filter((i: any) => i.type === "conditional");
        fallbackInstructions = instructions.filter((i: any) => i.type === "fallback").map((i: any) => i.text);
        if (alwaysActive.length > 0) {
          customInstructionsContext = `CUSTOM BUSINESS INSTRUCTIONS:\nFollow these specific instructions for this business:\n${alwaysActive.map((i: any, idx: number) => `${idx + 1}. ${i.text}`).join("\n")}\n\n`;
        }
        if (conditional.length > 0) {
          customInstructionsContext += `CONDITIONAL INSTRUCTIONS (apply when keywords are mentioned):\n${conditional.map((i: any) => `- When user mentions [${i.keywords?.join(", ") || ""}]: ${i.text}`).join("\n")}\n\n`;
        }
      }
    } catch {
      customInstructionsContext = `CUSTOM BUSINESS INSTRUCTIONS:\nFollow these specific instructions for this business:\n${raw}\n\n`;
    }
  }
  return { block: customInstructionsContext, fallback: fallbackInstructions };
}
function oldLlamaSelect(raw: string, userMessage: string): string {
  let out = "";
  try {
    const instructions = JSON.parse(raw);
    if (Array.isArray(instructions) && instructions.length > 0) {
      const lower = userMessage.toLowerCase();
      const applicable = instructions.map((i: any, idx: number) => ({ ...i, originalIndex: idx + 1 })).filter((i: any) => {
        const t = i.type || "always";
        if (t === "fallback") return false;
        if (t === "always") return true;
        if (t === "conditional" && i.keywords && Array.isArray(i.keywords)) return i.keywords.some((k: string) => lower.includes(k.toLowerCase()));
        return true;
      });
      if (applicable.length > 0) out = `Follow these instructions:\n${applicable.map((i: any) => `${i.originalIndex}. ${i.text}`).join("\n")}`;
    }
  } catch {
    out = `Follow these instructions:\n${raw}`;
  }
  return out;
}

async function main() {
  const { startFakeOpenAIChat, promptText, fakeEmbedding } = await import("./helpers/fakeOpenAIChat");
  const fake = await startFakeOpenAIChat();
  process.env.OPENAI_BASE_URL = fake.baseUrl;

  // MSG91 / Meta sends are stubbed; OpenAI goes to the local fake.
  const sent: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const target = typeof input === "string" ? input : input?.url || String(input);
    if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
    if (/^https:\/\/control\.msg91\.com\//.test(target)) {
      sent.push(target);
      return new Response(JSON.stringify({ status: "success", data: { message_uuid: `u_${sent.length}` } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`blocked outbound fetch in test: ${target}`);
  }) as typeof fetch;

  const ch = await import("@shared/knowledgeChannels");
  const ci = await import("../chatContext/customInstructions");

  // ── 0. Pure helpers ───────────────────────────────────────────────────────────
  {
    const p = ch.parseChannelsInput;
    expect(JSON.stringify(p(["whatsapp"])) === JSON.stringify({ ok: true, channels: ["whatsapp"] }), "channels: one channel");
    expect(JSON.stringify(p(["whatsapp", "website", "whatsapp"])) === JSON.stringify({ ok: true, channels: ["website", "whatsapp"] }), "channels: deduplicated, canonical order");
    expect(p([]).ok && (p([]) as any).channels === null && (p(null) as any).channels === null && (p(["website", "whatsapp", "instagram", "facebook"]) as any).channels === null, "channels: empty / null / all four → null (= all channels)");
    expect(!p(["sms"]).ok && !p("x,y").ok && !p({ a: 1 }).ok && !p([1]).ok, "channels: unknown values rejected");
    expect((p('["instagram"]') as any).channels?.[0] === "instagram" && (p("website,facebook") as any).channels?.join() === "website,facebook", "channels: JSON / comma string (multipart forms)");
    expect(ch.appliesToChannel(null, "whatsapp") && ch.appliesToChannel([], "website") && ch.appliesToChannel(["whatsapp"], null) && !ch.appliesToChannel(["whatsapp"], "website"), "appliesToChannel: untagged everywhere, tagged only on its channels");
    expect(ch.describeChannels(["whatsapp"]) === "WhatsApp" && ch.describeChannels(null) === "All channels", "describeChannels");

    const samples = [
      JSON.stringify([{ id: "1", type: "always", text: "Be brief." }, { id: "2", text: "No type → always." }, { id: "3", type: "conditional", keywords: ["Fee", "price"], text: "Quote fees in INR." }, { id: "4", type: "fallback", text: "Call us." }, { id: "5", type: "conditional", text: "No keywords." }]),
      JSON.stringify([{ type: "conditional", keywords: ["refund"], text: "7 days." }]),
      "Plain text instructions, not JSON.",
      JSON.stringify([]),
      JSON.stringify({ not: "a list" }),
    ];
    let same = true;
    for (const raw of samples) {
      const old = oldChatBlock(raw);
      const now = ci.buildCustomInstructionsBlock(raw, "website");
      if (old.block !== now.contextBlock || JSON.stringify(old.fallback) !== JSON.stringify(now.fallback)) { same = false; console.error("   diff (block):", JSON.stringify({ raw, old, now })); }
      for (const msg of ["what is the fee?", "hello", "REFUND please", "price"]) {
        const o = oldLlamaSelect(raw, msg), n = ci.selectInstructionsForMessage(raw, msg, "website").text;
        if (o !== n) { same = false; console.error("   diff (select):", JSON.stringify({ raw, msg, o, n })); }
      }
      if (ci.filterCustomInstructionsForChannel(raw, "instagram") !== raw) { same = false; console.error("   filter changed untagged input", raw); }
    }
    expect(same, "untagged instructions: shared parser gives byte-identical output to the old website parsers (and is shared by every channel)");
    const tagged = JSON.stringify([{ type: "always", text: "A" }, { type: "always", text: "W", channels: ["whatsapp"] }, { type: "always", text: "S", channels: ["website"] }]);
    expect(ci.buildCustomInstructionsBlock(tagged, "website").contextBlock.includes("1. A\n2. S") && !ci.buildCustomInstructionsBlock(tagged, "website").contextBlock.includes("W"), "tagged instruction: website sees untagged + website ones, renumbered");
    expect(ci.buildCustomInstructionsBlock(tagged, "whatsapp").body === "1. A\n2. W", "tagged instruction: WhatsApp sees untagged + WhatsApp ones");
    expect(JSON.parse(ci.filterCustomInstructionsForChannel(tagged, "instagram") as string).length === 1, "filter for Instagram keeps only the untagged one");
    const cleaned = JSON.parse(ci.sanitizeCustomInstructionsChannels(JSON.stringify([{ text: "x", channels: ["whatsapp", "bogus"] }, { text: "y", channels: [] }, { text: "z" }])) as string);
    expect(JSON.stringify(cleaned) === JSON.stringify([{ text: "x", channels: ["whatsapp"] }, { text: "y" }, { text: "z" }]), "saving instructions: channels cleaned (unknown dropped, empty = no tag)", cleaned);
  }

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const { seedChatBusiness } = await import("./helpers/chatContextSeed");
  const { chatService } = await import("../../chatService");
  const { storage } = await import("../../storage");
  const { businessContextCache } = await import("../businessContextCache");
  const { faqEmbeddingService } = await import("../faqEmbeddingService");
  const { vectorSearchService } = await import("../vectorSearchService");
  const { ToolExecutionService } = await import("../toolExecutionService");
  const { WhatsappAutoReplyService } = await import("../whatsappAutoReplyService");
  const { whatsappService } = await import("../whatsappService");
  const { updateSession } = await import("../whatsappSessionService");
  const { instagramAutoReplyService } = await import("../instagramAutoReplyService");
  const { facebookAutoReplyService } = await import("../facebookAutoReplyService");
  const { registerRoutes } = await import("../../routes");
  const { hashPassword, createSession } = await import("../../auth");

  const tag = crypto.randomBytes(3).toString("hex").toUpperCase();
  const T = await seedChatBusiness(db, schema, { tag, pages: 3, docs: 1, faqs: 3 });
  const id = T.accountId;
  await db.update(schema.businessAccounts).set({ whatsappEnabled: "true" } as any).where(eq(schema.businessAccounts.id, id));

  const CH = ["whatsapp", "website", "instagram", "facebook", null] as const;
  const label = (c: string | null) => (c ? c.slice(0, 2).toUpperCase() : "ALL");
  // One FAQ / doc chunk / page / trained URL / instruction per channel, each with a unique marker.
  for (const c of CH) {
    const L = label(c);
    const q = `What is the coupon code for ${c || "everyone"}?`;
    const a = `The coupon code is ${L}COUPON-${tag}.`;
    await db.insert(schema.faqs).values({ businessAccountId: id, question: q, answer: a, channels: c ? [c] : null, embedding: fakeEmbedding(`Question: ${q}\nAnswer: ${a}`) } as any);
    const [doc] = await db.insert(schema.trainingDocuments).values({
      businessAccountId: id, filename: `coupon-${L}.pdf`, originalFilename: `coupon-${L}.pdf`, fileSize: "10", storageKey: `k/coupon-${L}`,
      uploadStatus: "completed", uploadedBy: T.userId, embeddingStatus: "completed", channels: c ? [c] : null,
      summary: `Coupon policy summary ${L}DOCSUM-${tag}.`, keyPoints: JSON.stringify([`Coupon key point ${L}`]),
    } as any).returning();
    const chunk = `Coupon policy document chunk ${L}DOC-${tag}: coupons stack once per order.`;
    await db.insert(schema.documentChunks).values({ trainingDocumentId: doc.id, businessAccountId: id, chunkText: chunk, chunkIndex: 0, embedding: fakeEmbedding(chunk) } as any);
    await db.insert(schema.analyzedPages).values({ businessAccountId: id, pageUrl: `https://northwind.example/coupons-${L.toLowerCase()}`, extractedContent: `Coupon page for ${c || "all"}: ${L}PAGE-${tag} coupon codes are listed here.`, channels: c ? [c] : null } as any);
    const [u] = await db.insert(schema.trainedUrls).values({ businessAccountId: id, url: `https://blog.example/coupons-${L}`, title: `Coupon blog ${L}`, status: "completed", embeddingStatus: "completed", addedBy: T.userId, channels: c ? [c] : null } as any).returning();
    const uchunk = `Coupon blog post ${L}URL-${tag}: seasonal coupon codes.`;
    await db.insert(schema.urlContentChunks).values({ trainedUrlId: u.id, businessAccountId: id, chunkText: uchunk, chunkIndex: 0, embedding: fakeEmbedding(uchunk) } as any);
  }
  const instructions = CH.map(c => ({ id: `i-${label(c)}`, type: "always", text: `Instruction ${label(c)}INSTR-${tag}.`, ...(c ? { channels: [c] } : {}) }));
  await db.update(schema.widgetSettings).set({ customInstructions: JSON.stringify(instructions) } as any).where(eq(schema.widgetSettings.businessAccountId, id));
  const markers = (kind: string) => Object.fromEntries(CH.map(c => [label(c), `${label(c)}${kind}-${tag}`]));
  const has = (text: string, kind: string) => Object.entries(markers(kind)).filter(([, m]) => text.includes(m)).map(([k]) => k).sort().join(",");
  const exp = (...codes: string[]) => codes.sort().join(",");

  // ── 1. SQL-level searches respect the tag ─────────────────────────────────────
  {
    const q = "What is the coupon code for whatsapp?";
    const asWa = await faqEmbeddingService.searchFAQs(q, id, 10, 0.0, "whatsapp");
    const asWeb = await faqEmbeddingService.searchFAQs(q, id, 10, 0.0, "website");
    const asAny = await faqEmbeddingService.searchFAQs(q, id, 10, 0.0);
    expect(has(asWa.map(f => f.answer).join(" "), "COUPON") === exp("ALL", "WH"), "FAQ vector search (whatsapp): untagged + WhatsApp only", asWa.map(f => f.answer));
    expect(has(asWeb.map(f => f.answer).join(" "), "COUPON") === exp("ALL", "WE"), "FAQ vector search (website): untagged + website only");
    expect(has(asAny.map(f => f.answer).join(" "), "COUPON") === exp("ALL", "WH", "WE", "IN", "FA"), "FAQ vector search without a channel: unchanged (everything)");
    const dq = `Coupon policy document chunk WHDOC-${tag}: coupons stack once per order.`;
    const d1 = await vectorSearchService.search(dq, id, 20, 0.0, "website");
    const d2 = await vectorSearchService.search(dq, id, 20, 0.0, "whatsapp");
    expect(!has(d1.map(r => r.chunkText).join(" "), "DOC").includes("WH") && has(d1.map(r => r.chunkText).join(" "), "DOC").includes("WE"), "document vector search (website) excludes the WhatsApp-only document", d1.map(r => r.chunkText.slice(0, 40)));
    expect(has(d2.map(r => r.chunkText).join(" "), "DOC") === exp("ALL", "WH") && has(d2.map(r => r.chunkText).join(" "), "URL") === exp("ALL", "WH"), "document + URL vector search (whatsapp): untagged + WhatsApp only", d2.map(r => r.chunkText.slice(0, 40)));
    const gWeb = await ToolExecutionService.executeTool("get_faqs", { search: "coupon code" }, { businessAccountId: id, userId: "t", channel: "widget" });
    const gWa = await ToolExecutionService.executeTool("get_faqs", { search: "coupon code" }, { businessAccountId: id, userId: "t", channel: "whatsapp" });
    expect(has(JSON.stringify(gWeb.data), "COUPON") === exp("ALL", "WE") && has(JSON.stringify(gWa.data), "COUPON") === exp("ALL", "WH"), "get_faqs tool: website callers see website FAQs, WhatsApp its own", [gWeb.data?.length, gWa.data?.length]);
  }

  // ── 2. Website chat prompts ───────────────────────────────────────────────────
  const ctx = {
    userId: `v-${tag}`, businessAccountId: id, personality: "friendly", responseLength: "balanced", companyDescription: "",
    openaiApiKey: "sk-test-fake", currency: "INR", currencySymbol: "₹", channel: "widget", supportsCalendarUI: true, systemMode: "full",
    customInstructions: JSON.stringify(instructions),
  };
  {
    businessContextCache.invalidateBusinessCache(id);
    const k = await (chatService as any).buildKnowledgeContext("what is the coupon code?", [], ctx, "retrieval");
    const text = k.text as string;
    expect(!/WHCOUPON|INCOUPON|FACOUPON/.test(text) && !/WHPAGE|WHDOC|WHURL/.test(text), "website retrieval: no WhatsApp / Instagram / Facebook-only FAQ, page, document or URL", text.slice(0, 1500));
    expect(/WECOUPON|ALLCOUPON/.test(text), "website retrieval: website / untagged knowledge found", text.slice(0, 1500));
    const enriched = await (chatService as any).buildEnrichedContext(ctx, "retrieval", { userMessage: "coupon" });
    expect(has(enriched, "INSTR") === exp("ALL", "WE"), "website system prompt: untagged + website-only instructions", has(enriched, "INSTR"));
    const legacy = await (chatService as any).buildEnrichedContext(ctx, "legacy");
    expect(has(legacy, "PAGE") === exp("ALL", "WE") && has(legacy, "DOCSUM") === exp("ALL", "WE"), "website legacy context: pages / document summaries filtered", [has(legacy, "PAGE"), has(legacy, "DOCSUM")]);
    // Full streamed turn: the final-override instructions are filtered too.
    fake.reset();
    for await (const _ev of chatService.streamMessage("what is the coupon code?", ctx as any)) { /* drain */ }
    await sleep(100);
    const main = fake.calls.find(c => c.kind === "chat" && c.purpose === "main");
    const all = main ? promptText(main) : "";
    expect(main && !/WHINSTR|ININSTR|FAINSTR/.test(all) && /WEINSTR/.test(all) && /ALLINSTR/.test(all), "website streamed turn: only website + untagged instructions anywhere in the prompt", has(all, "INSTR"));
    expect(main && !/WHCOUPON|WHPAGE|WHDOC|WHURL|WHDOCSUM/.test(all), "website streamed turn: no WhatsApp-only knowledge anywhere in the prompt");
  }

  // ── 3. WhatsApp prompts ───────────────────────────────────────────────────────
  await db.insert(schema.whatsappSettings).values({ businessAccountId: id, msg91AuthKey: "k", msg91IntegratedNumberId: "910000000000", webhookSecret: `s-${tag}`, autoReplyEnabled: "true" } as any);
  const svc = new WhatsappAutoReplyService();
  let n = 0;
  async function waTurn(text: string) {
    const phone = `9188${String(++n).padStart(8, "0")}`;
    await updateSession(id, phone);
    await whatsappService.processTextMessage(id, `kc-${tag}-${n}`, phone, text);
    fake.reset();
    await svc.generateAndSendReply(id, phone, text);
    const main = fake.calls.find(c => c.kind === "chat" && /WhatsApp/.test(String(c.messages[0]?.content)) && !/language detector/i.test(String(c.messages[0]?.content)) && c.messages.some(m => m.role === "user" && m.content === text));
    return main ? promptText(main) : "";
  }
  {
    const p = await waTurn("what is the coupon code?");
    expect(p.length > 0 && !/WECOUPON|INCOUPON|FACOUPON|WEPAGE|WEDOC-|WEURL|INPAGE|FAPAGE/.test(p), "WhatsApp (retrieval): no website / Instagram / Facebook-only knowledge", p.slice(-2500));
    expect(/WHCOUPON|WHPAGE|WHDOC|WHURL/.test(p), "WhatsApp (retrieval): WhatsApp-only knowledge reaches WhatsApp", p.slice(-2500));
    expect(has(p, "INSTR") === exp("ALL", "WH"), "WhatsApp: untagged + WhatsApp-only instructions", has(p, "INSTR"));
    process.env.WHATSAPP_CONTEXT_MODE = "legacy";
    businessContextCache.invalidateBusinessCache(id);
    const lp = await waTurn("What is the coupon code for whatsapp?");
    delete process.env.WHATSAPP_CONTEXT_MODE;
    expect(has(lp, "PAGE") === exp("ALL", "WH") && has(lp, "DOCSUM") === exp("ALL", "WH"), "WhatsApp (legacy builder): page / document dumps filtered", [has(lp, "PAGE"), has(lp, "DOCSUM")]);
    expect(!/WECOUPON|INCOUPON|FACOUPON/.test(lp), "WhatsApp (legacy builder): FAQ search filtered", has(lp, "COUPON"));
  }

  // ── 4. Instagram / Facebook DMs ───────────────────────────────────────────────
  {
    const ig = await (instagramAutoReplyService as any).buildBusinessContext(id, "What is the coupon code for instagram?");
    const fb = await (facebookAutoReplyService as any).buildBusinessContext(id, "What is the coupon code for facebook?");
    expect(has(ig.context, "PAGE") === exp("ALL", "IN") && has(fb.context, "PAGE") === exp("ALL", "FA"), "Instagram / Facebook: website pages filtered per platform (separate caches)", [has(ig.context, "PAGE"), has(fb.context, "PAGE")]);
    expect(has(ig.context, "DOCSUM") === exp("ALL", "IN") && has(fb.context, "DOCSUM") === exp("ALL", "FA"), "Instagram / Facebook: document summaries filtered per platform");
    expect(!/WHCOUPON|WECOUPON|FACOUPON/.test(ig.context) && !/WHCOUPON|WECOUPON|INCOUPON/.test(fb.context), "Instagram / Facebook: FAQ search filtered per platform", [has(ig.context, "COUPON"), has(fb.context, "COUPON")]);
    expect(has(ig.widgetCustomInstructions || "", "INSTR") === exp("ALL", "IN") && has(fb.widgetCustomInstructions || "", "INSTR") === exp("ALL", "FA"), "Instagram / Facebook: instructions filtered per platform", [has(ig.widgetCustomInstructions || "", "INSTR"), has(fb.widgetCustomInstructions || "", "INSTR")]);
  }

  // ── 5. API: validation, allow-list, list filter, cache refresh ────────────────
  {
    await db.update(schema.users).set({ passwordHash: await hashPassword(crypto.randomBytes(12).toString("hex")) } as any).where(eq(schema.users.id, T.userId));
    const session = await createSession(T.userId);
    const other = await seedChatBusiness(db, schema, { tag: `${tag}o`, name: "Other", pages: 1, docs: 1, faqs: 1 });
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use(cookieParser());
    const server = await registerRoutes(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const api = async (method: string, p: string, body?: any) => {
      const r = await fetch(base + p, { method, headers: { "content-type": "application/json", cookie: `session=${session}`, origin: base }, body: body ? JSON.stringify(body) : undefined });
      let json: any = null; try { json = await r.json(); } catch {}
      return { status: r.status, json };
    };
    let r = await api("POST", "/api/faqs", { question: "Q api?", answer: "A api.", channels: ["whatsapp"] });
    expect(r.status === 200 && JSON.stringify(r.json.channels) === '["whatsapp"]', "POST /api/faqs stores channels", r);
    const faqId = r.json.id;
    r = await api("POST", "/api/faqs", { question: "Q bad?", answer: "A.", channels: ["sms"] });
    expect(r.status === 400 && /Unknown channel/.test(r.json?.error), "POST /api/faqs rejects unknown channels", r);
    r = await api("PATCH", `/api/faqs/${faqId}`, { channels: [], businessAccountId: other.accountId, embedding: [1, 2] });
    const [faqRow] = await db.select().from(schema.faqs).where(eq(schema.faqs.id, faqId));
    expect(r.status === 200 && faqRow.channels === null && faqRow.businessAccountId === id, "PATCH /api/faqs: [] → all channels; other fields ignored (allow-list)", { status: r.status, ch: faqRow.channels, acct: faqRow.businessAccountId === id });
    r = await api("PATCH", `/api/faqs/${faqId}`, { channels: ["facebook", "bogus"] });
    expect(r.status === 400, "PATCH /api/faqs rejects unknown channels", r.status);
    r = await api("PATCH", `/api/faqs/${faqId}`, { answer: "A api edited." });
    const [faqRow2] = await db.select().from(schema.faqs).where(eq(schema.faqs.id, faqId));
    expect(r.status === 200 && faqRow2.answer === "A api edited.", "PATCH /api/faqs: normal edits still work");
    r = await api("GET", "/api/faqs?limit=100&channel=whatsapp");
    expect(r.status === 200 && has(JSON.stringify(r.json.faqs), "COUPON") === exp("ALL", "WH"), "GET /api/faqs?channel=whatsapp: FAQs used on WhatsApp", has(JSON.stringify(r.json?.faqs), "COUPON"));
    r = await api("GET", "/api/faqs?limit=100");
    expect(has(JSON.stringify(r.json.faqs), "COUPON") === exp("ALL", "WH", "WE", "IN", "FA"), "GET /api/faqs without a filter: unchanged");

    const docs = await db.select().from(schema.trainingDocuments).where(and(eq(schema.trainingDocuments.businessAccountId, id), eq(schema.trainingDocuments.originalFilename, "coupon-WE.pdf")));
    r = await api("PATCH", `/api/training-documents/${docs[0].id}`, { channels: ["website", "whatsapp"] });
    expect(r.status === 200 && JSON.stringify(r.json.channels) === '["website","whatsapp"]', "PATCH /api/training-documents/:id sets channels", r);
    const otherDoc = (await db.select().from(schema.trainingDocuments).where(eq(schema.trainingDocuments.businessAccountId, other.accountId)))[0];
    r = await api("PATCH", `/api/training-documents/${otherDoc.id}`, { channels: ["whatsapp"] });
    expect(r.status === 404, "PATCH another account's document → 404", r.status);
    r = await api("PATCH", `/api/training-documents/${docs[0].id}`, { title: "x" });
    expect(r.status === 400, "PATCH without channels → 400");
    const urls = await db.select().from(schema.trainedUrls).where(eq(schema.trainedUrls.businessAccountId, id));
    r = await api("PATCH", `/api/trained-urls/${urls[0].id}`, { channels: ["instagram"] });
    expect(r.status === 200 && r.json.data.channels?.[0] === "instagram", "PATCH /api/trained-urls/:id sets channels", r);
    r = await api("POST", "/api/trained-urls", { url: "https://blog.example/new", channels: ["nope"] });
    expect(r.status === 400, "POST /api/trained-urls rejects unknown channels", r.status);
    const pages = await db.select().from(schema.analyzedPages).where(eq(schema.analyzedPages.businessAccountId, id));
    const webPage = pages.find(pg => /coupons-we$/.test(pg.pageUrl))!;

    // Cache refresh: tag the website-only page for WhatsApp → the next WhatsApp reply sees it (no 5-minute wait).
    const beforeTag = await waTurn("Show me the coupon page");
    r = await api("PATCH", `/api/analyzed-pages/${webPage.id}`, { channels: ["whatsapp"] });
    expect(r.status === 200 && r.json.channels?.[0] === "whatsapp", "PATCH /api/analyzed-pages/:id sets channels", r);
    const afterTag = await waTurn("Show me the coupon page");
    expect(!/WEPAGE/.test(beforeTag) && /WEPAGE/.test(afterTag), "tag change applies to the next WhatsApp reply (caches invalidated)", [has(beforeTag, "PAGE"), has(afterTag, "PAGE")]);
    // Re-scan keeps the tag of a page URL.
    const rescanned = await storage.createAnalyzedPage({ businessAccountId: id, pageUrl: webPage.pageUrl, extractedContent: "rescanned" } as any);
    expect(JSON.stringify(rescanned.channels) === '["whatsapp"]', "website re-scan keeps the page's channel tags", rescanned.channels);

    r = await api("PATCH", "/api/widget-settings", { customInstructions: JSON.stringify([{ id: "z", type: "always", text: "Z", channels: ["whatsapp", "bogus"] }]) });
    const [ws] = await db.select().from(schema.widgetSettings).where(eq(schema.widgetSettings.businessAccountId, id));
    expect(r.status === 200 && JSON.parse(ws.customInstructions || "[]")[0]?.channels?.join() === "whatsapp", "PATCH /api/widget-settings: instruction channels cleaned on save", { status: r.status, saved: ws.customInstructions });
    server.close();
  }

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
