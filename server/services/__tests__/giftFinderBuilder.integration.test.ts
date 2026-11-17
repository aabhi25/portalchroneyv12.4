/**
 * "Build a gift finder from my products" (server/services/giftFinderBuilder.ts), against a local Postgres/PGlite:
 *
 *  - the catalogue summary (types, tags, price spread) counts only the products the chat uses;
 *  - the AI's draft is made safe: tag/type names spelled as the catalogue spells them, unknown ones dropped,
 *    budget / contact questions refused, at most 3 questions of 2–6 options, "gift" always a trigger word;
 *  - options that lead to no products are dropped; the budget question comes from the real prices;
 *  - the saved journey is switched off, conversational, ends with "Show products", and runs: "a gift for my
 *    wife" → next question, answers → a product search with the right tags and price range.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55583/postgres?sslmode=disable \
 *   GIFT_FINDER_TEST_DB=1 npx tsx server/services/__tests__/giftFinderBuilder.integration.test.ts
 */
import crypto from "crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

const url = process.env.DATABASE_URL || "";
if (process.env.GIFT_FINDER_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set GIFT_FINDER_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString("hex");

let failed = 0;
function expect(cond: any, label: string, got?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}`, got === undefined ? "" : JSON.stringify(got)); } else { console.log(`✓ ${label}`); }
}

/** Fake OpenAI for running the saved journey: answers are what the visitor said; questions come back as "ASK: …". */
async function startFake() {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const prompt = (body.messages || []).map((m: any) => String(m.content || "")).join("\n");
      let content = "OK";
      if (body.response_format?.type === "json_object") {
        const m = /User's Response: "([\s\S]*?)"\n/.exec(prompt);
        content = JSON.stringify({ answer: m ? m[1] : null, is_off_topic: false, is_refusal: false, quality: "valid", brief_offtopic_answer: null });
      } else {
        const next = /(?:Next question to ask|Current question we need to ask): ([^\n]+)/.exec(prompt) || /Rephrase this question naturally: ([^\n]+)/.exec(prompt);
        if (next) content = `ASK: ${next[1]}`;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() };
}

async function main() {
  const fake = await startFake();
  process.env.OPENAI_BASE_URL = fake.url;
  const { db, pool } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { storage } = await import("../../storage");
  const gift = await import("../giftFinderBuilder");
  const { journeyService } = await import("../journeyService");
  const { journeyOrchestrator } = await import("../journeyOrchestrator");
  const { optionFiltersOf } = await import("@shared/journeyProducts");

  // ── pure parts ──
  expect(gift.roundPrice(1180) === 1000 && gift.roundPrice(2640) === 2500 && gift.roundPrice(430) === 400 && gift.roundPrice(12400) === 12000, "prices rounded to friendly numbers");
  const b3 = gift.budgetQuestion({ min: 499, p33: 1180, p66: 2640, max: 15999 });
  expect(b3?.options.map(o => o.label).join(" | ") === "Under ₹1,000 | ₹1,000 – ₹2,500 | Above ₹2,500" && b3.options[1].minPrice === 1000 && b3.options[1].maxPrice === 2500, "budget: three bands from the price spread", b3?.options);
  expect(gift.budgetQuestion({ min: 900, p33: 950, p66: 980, max: 1100 })?.options.length === 2, "close prices: two bands");
  expect(gift.budgetQuestion(null) === null, "no prices: no budget question");

  const summaryStub = { total: 10, inStock: 10, prices: null, types: [{ name: "Rings", count: 4 }], tags: [{ name: "Gift: Wife", count: 3 }, { name: "Gift: Mother", count: 2 }] };
  const cleaned = gift.cleanDraft({
    name: "Gift finder", triggerWords: ["Present", "anniversary", "Present"],
    questions: [
      { text: "Who is the gift for?", savedAs: "Recipient!", options: [
        { label: "Wife", tags: ["gift: wife", "Gift: Girlfriend"] }, { label: "Mother", tags: ["Gift: Mother"] }, { label: "Wife", tags: [] }, { label: "Surprise me" },
      ] },
      { text: "What's your budget?", options: [{ label: "Low" }, { label: "High" }] },
      { text: "Your mobile number?", options: [{ label: "a" }, { label: "b" }] },
      { text: "Which kind?", options: [{ label: "Rings", type: "rings" }] },
    ],
  }, summaryStub);
  expect(cleaned.questions.length === 1 && cleaned.questions[0].savedAs === "recipient_", "budget, contact and one-option questions dropped", cleaned.questions.map(q => q.text));
  expect(JSON.stringify(cleaned.questions[0].options) === JSON.stringify([{ label: "Wife", tags: ["Gift: Wife"] }, { label: "Mother", tags: ["Gift: Mother"] }, { label: "Surprise me" }]), "tag names spelled as the catalogue spells them, unknown tags and repeat labels dropped", cleaned.questions[0].options);
  expect(cleaned.triggerWords.join() === "gift,present,anniversary", "trigger words: 'gift' always, lowercase, no repeats", cleaned.triggerWords);
  const { system, user } = gift.draftPrompt("Giva", { ...summaryStub, prices: { min: 499, p33: 1000, p66: 2500, max: 9999 } });
  expect(/Do NOT ask about budget/.test(system) && /Gift: Wife — 3/.test(user) && /Rings — 4/.test(user) && /₹499 to ₹9,999/.test(user), "the AI gets rules plus types, tags and prices with counts", user);

  // ── database ──
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `Gift build ${crypto.randomBytes(3).toString("hex")}`, website: "https://g.example", openaiApiKey: "sk-test-fake" } as any).returning();
  const B = biz.id as string;
  await db.insert(schema.widgetSettings).values({ businessAccountId: B } as any);
  const rings = await storage.createCategory({ businessAccountId: B, name: "Rings" });
  const pendants = await storage.createCategory({ businessAccountId: B, name: "Pendant" });
  const wife = await storage.createTag({ businessAccountId: B, name: "Gift: Wife" });
  const mother = await storage.createTag({ businessAccountId: B, name: "Gift: Mother" });
  const bday = await storage.createTag({ businessAccountId: B, name: "Gift: Birthday" });
  const rows: [string, string, string, string[]][] = [
    ["Rose Ring", "799", rings.id, [wife.id]], ["Heart Pendant", "1499", pendants.id, [wife.id, bday.id]],
    ["Halo Ring", "2199", rings.id, [wife.id]], ["Pearl Pendant", "1299", pendants.id, [mother.id]],
    ["Classic Band", "3499", rings.id, [mother.id, bday.id]], ["Star Pendant", "999", pendants.id, []],
  ];
  for (const [name, price, cat, tagIds] of rows) {
    const [p] = await db.insert(schema.products).values({ businessAccountId: B, name, description: name, price, source: "manual", stockStatus: "in_stock" } as any).returning({ id: schema.products.id });
    await db.insert(schema.productCategories).values({ productId: p.id, categoryId: cat });
    for (const t of tagIds) await db.insert(schema.productTags).values({ productId: p.id, tagId: t });
  }
  // A website product the chat doesn't use (the shop keeps its own catalogue): not counted.
  await db.insert(schema.products).values({ businessAccountId: B, name: "Website Ring", description: "x", price: "100", source: "woocommerce", externalId: "w1" } as any);

  const summary = await gift.catalogSummary(B);
  expect(summary.total === 6 && summary.types.find(t => t.name === "Rings")?.count === 3 && summary.tags.find(t => t.name === "Gift: Wife")?.count === 3, "summary: the chat's 6 products, type and tag counts", summary);
  expect(summary.prices && summary.prices.min === 799 && summary.prices.max === 3499, "summary: price spread", summary.prices);

  expect(await gift.productsForOption(B, { tags: ["gift: wife"], type: "Rings" }) === 2 && await gift.productsForOption(B, { tags: ["Gift: Wife"], maxPrice: 1000 }) === 1, "products per option (tags + type, tags + price)");

  const aiDraft = {
    name: "Gift finder", triggerWords: ["present", "anniversary"], intro: "Here are a few lovely picks", ending: "Happy gifting!",
    questions: [
      { text: "Who is the gift for?", savedAs: "recipient", options: [{ label: "Wife", tags: ["Gift: Wife"] }, { label: "Mother", tags: ["Gift: Mother"] }, { label: "Sister", tags: ["Gift: Sister"] }] },
      { text: "What would they like?", savedAs: "kind", options: [{ label: "A ring", type: "Rings" }, { label: "A pendant", type: "Pendant" }, { label: "Bangles", type: "Bangles" }, { label: "Surprise me" }] },
    ],
  };
  const draft = await gift.keepOptionsWithProducts(B, gift.cleanDraft(aiDraft, summary));
  expect(draft.questions[0].options.map(o => o.label).join() === "Wife,Mother" && draft.questions[1].options.map(o => o.label).join() === "A ring,A pendant,Surprise me", "options with no products (Sister, Bangles) dropped", draft.questions.map(q => q.options.map(o => o.label)));

  const budget = gift.budgetQuestion(summary.prices);
  const journeyId = await gift.saveGiftFinder(B, draft, budget);
  const [j] = await db.select().from(schema.conversationJourneys).where(eq(schema.conversationJourneys.id, journeyId));
  const steps = await storage.getJourneySteps(journeyId);
  expect(j.status === "inactive" && j.journeyType === "conversational" && JSON.parse(j.triggerKeywords!).includes("gift"), "saved switched off, conversational, triggered by 'gift'", { status: j.status, type: j.journeyType });
  expect(steps.map((s: any) => s.toolTrigger === "get_products" ? "PRODUCTS" : s.toolTrigger === "journey_complete" ? "END" : s.questionText).join(" | ") === "Who is the gift for? | What would they like? | What's your budget? | PRODUCTS | END", "steps: AI questions, budget, Show products, ending", steps.map((s: any) => s.questionText));
  expect(optionFiltersOf(steps[0] as any).Wife?.tags?.[0] === "Gift: Wife" && steps[3].questionText === "Here are a few lovely picks", "option filters and the line above the products saved");

  // Switch it on and run it.
  await db.update(schema.conversationJourneys).set({ status: "active" } as any).where(eq(schema.conversationJourneys.id, journeyId));
  journeyService.invalidateJourneyCache(B);
  const [conv] = await db.insert(schema.conversations).values({ businessAccountId: B, title: "Chat" } as any).returning();
  const send = (msg: string) => journeyOrchestrator.processUserMessageEngineDriven(conv.id, `w_${conv.id}`, B, msg, { channel: "widget" });
  let r = await send("I'm looking for a gift for my wife");
  expect(r.shouldBypassAI && /^ASK: What would they like/.test(r.response || ""), "built journey runs: Wife taken from the message, next question asked", r.response);
  r = await send("A ring");
  const low = budget!.options[0].label;
  expect(/^ASK: What's your budget/.test(r.response || "") && (r.options ?? []).includes(low), "budget asked with the real price bands as buttons", r.options);
  r = await send(budget!.options[1].label);
  expect(r.isComplete && r.productSearch?.tagGroups[0]?.[0] === "Gift: Wife" && r.productSearch?.productType === "Rings" && r.productSearch?.minPrice === budget!.options[1].minPrice, "answers → product search: Wife's tag, rings, the chosen price band", r.productSearch);

  fake.close();
  await pool.end().catch(() => {});
  if (failed) { console.error(`\n${failed} gift finder build checks failed`); process.exit(1); }
  console.log("\nAll gift finder build checks passed");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
