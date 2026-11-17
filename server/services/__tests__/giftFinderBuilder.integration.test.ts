/**
 * "Build a gift finder from my products" (server/services/giftFinderBuilder.ts), against a local Postgres/PGlite,
 * with a Giva-style catalogue (silver "Rings", "Gold Ring", "Demi Fine Rings", pendants; ring names with styles):
 *
 *  - the catalogue summary: types with typical prices, tags, and the words used in the biggest types' names;
 *  - the AI's draft made safe: names spelled as the catalogue spells them, unknown ones dropped, budget / contact
 *    questions refused, one style follow-up at most, a material question only with types;
 *  - options that lead to no products are dropped; each material gets a budget from its own prices;
 *  - the saved journey: switched off, kind → (Rings only) ring style → material → that material's budget →
 *    Show products, with the right steps asked only when led to;
 *  - it runs: "a ring for my wife" → Wife and Rings taken from the message → ring style asked → Solid gold →
 *    the gold budget (gold prices) → a product search: Wife's tag, ring types AND gold types, the band's prices.
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
  expect(gift.roundPrice(1180) === 1000 && gift.roundPrice(2640) === 2500 && gift.roundPrice(430) === 400 && gift.roundPrice(24800) === 25000, "prices rounded to friendly numbers");
  const b3 = gift.budgetQuestion({ min: 499, p33: 1180, p66: 2640, max: 15999 });
  expect(b3?.options.map(o => o.label).join(" | ") === "Under ₹1,000 | ₹1,000 – ₹2,500 | Above ₹2,500", "budget: three bands from the price spread", b3?.options);
  expect(gift.budgetQuestion({ min: 900, p33: 950, p66: 980, max: 1100 })?.options.length === 2, "close prices: two bands");
  expect(gift.topNameWords(["Silver Solitaire Ring", "Gold Solitaire Ring", "Rose Gold Solitaire Ring", "Couple Band Ring", "Silver Couple Rings", "Couple heart ring"]).map(w => w.word).join() === "couple,solitaire", "name words: styles counted, metals and 'ring' left out");

  const stub = { total: 10, inStock: 10, prices: null, nameWords: [],
    types: [{ name: "Rings", count: 4, median: 2500 }, { name: "Gold Ring", count: 3, median: 25000 }],
    tags: [{ name: "Gift: Wife", count: 3 }, { name: "Gift: Mother", count: 2 }] };
  const cleaned = gift.cleanDraft({
    triggerWords: ["Present"],
    questions: [
      { text: "Who is it for?", savedAs: "Recipient!", options: [{ label: "Wife", tags: ["gift: wife", "Gift: Girlfriend"] }, { label: "Sister", tags: ["Gift: Sister"] }, { label: "Mother", tags: ["Gift: Mother"] }] },
      { text: "What's your budget?", options: [{ label: "Low" }, { label: "High" }] },
      { text: "What would they like?", options: [
        { label: "Rings", types: ["rings", "gold ring", "Toe Rings"], followUp: { text: "Which style?", options: [{ label: "Solitaire", search: "solitaire" }, { label: "Couple", search: "couple" }] } },
        { label: "Bangles", types: ["Bangles"] },
        { label: "Surprise me", followUp: { text: "x", options: [{ label: "a" }, { label: "b" }] } },
      ] },
    ],
    material: { text: "Silver or gold?", options: [{ label: "Silver", types: ["Rings"] }, { label: "Gold", types: ["Gold Ring"] }, { label: "Platinum", types: ["Platinum Ring"] }] },
  }, stub);
  expect(cleaned.questions.length === 2 && cleaned.questions[0].savedAs === "recipient_", "budget question dropped", cleaned.questions.map(q => q.text));
  expect(JSON.stringify(cleaned.questions[0].options.map(o => [o.label, o.tags])) === JSON.stringify([["Wife", ["Gift: Wife"]], ["Mother", ["Gift: Mother"]]]), "tags spelled as the catalogue spells them; Sister (unknown tag) dropped", cleaned.questions[0].options);
  const kind = cleaned.questions[1];
  expect(kind.options.map(o => o.label).join() === "Rings,Surprise me" && JSON.stringify(kind.options[0].types) === JSON.stringify(["Rings", "Gold Ring"]), "several types per option; unknown types and Bangles dropped", kind.options);
  expect(kind.options[0].followUp?.options.length === 2 && !kind.options[1].followUp, "only one style follow-up", kind.options);
  expect(cleaned.material?.options.map(o => o.label).join() === "Silver,Gold" && cleaned.material?.savedAs === "material", "material: options without known types dropped", cleaned.material);
  const { system, user } = gift.draftPrompt("Giva", { ...stub, prices: { min: 499, p33: 1000, p66: 2500, max: 90000 }, nameWords: [{ type: "Rings", words: [{ word: "solitaire", count: 44 }] }] });
  expect(/"material"/.test(system) && /followUp/.test(system) && /Gold Ring — 3 — ₹25,000/.test(user) && /solitaire ×44/.test(user), "the AI gets types with typical prices and the words in names", user);

  // ── database: a Giva-style catalogue ──
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `Gift build ${crypto.randomBytes(3).toString("hex")}`, website: "https://g.example", openaiApiKey: "sk-test-fake" } as any).returning();
  const B = biz.id as string;
  await db.insert(schema.widgetSettings).values({ businessAccountId: B } as any);
  const cat: Record<string, string> = {};
  for (const name of ["Rings", "Gold Ring", "Demi Fine Rings", "Pendant", "Gold Pendant"]) cat[name] = (await storage.createCategory({ businessAccountId: B, name })).id;
  const wife = (await storage.createTag({ businessAccountId: B, name: "Gift: Wife" })).id;
  const mother = (await storage.createTag({ businessAccountId: B, name: "Gift: Mother" })).id;
  const rows: [string, number, string, string[]][] = [
    ["Silver Solitaire Ring", 2499, "Rings", [wife]], ["Silver Couple Ring", 2999, "Rings", [wife]], ["Silver Heart Ring", 1999, "Rings", [mother]],
    ["Silver Solitaire Halo Ring", 3499, "Rings", [wife]],
    ["Gold Solitaire Ring", 24999, "Gold Ring", [wife]], ["Gold Couple Band", 18999, "Gold Ring", [wife]], ["Gold Solitaire Diamond Ring", 44999, "Gold Ring", [wife]],
    ["Gold Leaf Ring", 15999, "Gold Ring", [mother]],
    ["Plated Solitaire Ring", 1299, "Demi Fine Rings", [wife]], ["Plated Couple Ring", 999, "Demi Fine Rings", []], ["Plated Leaf Ring", 1499, "Demi Fine Rings", []],
    ["Silver Heart Pendant", 2799, "Pendant", [wife]], ["Silver Moon Pendant", 3299, "Pendant", [mother]],
    ["Gold Heart Pendant", 19999, "Gold Pendant", [wife]], ["Gold Star Pendant", 22999, "Gold Pendant", []],
  ];
  for (const [name, price, c, tagIds] of rows) {
    const [p] = await db.insert(schema.products).values({ businessAccountId: B, name, description: name, price: String(price), imageUrl: `https://cdn.example/${encodeURIComponent(name)}.jpg`, source: "manual", stockStatus: "in_stock" } as any).returning({ id: schema.products.id });
    await db.insert(schema.productCategories).values({ productId: p.id, categoryId: cat[c] });
    for (const t of tagIds) await db.insert(schema.productTags).values({ productId: p.id, tagId: t });
  }

  const summary = await gift.catalogSummary(B);
  expect(summary.total === 15 && summary.types.find(t => t.name === "Gold Ring")?.median === 21999, "summary: types with typical prices", summary.types);
  const ringWords = summary.nameWords.find(n => n.type === "Rings")?.words.map(w => w.word) ?? [];
  expect(summary.nameWords.length > 0 && !ringWords.includes("silver"), "summary: name words per big type (no metal words)", summary.nameWords);

  // What the AI would draft for this catalogue.
  const aiDraft = {
    name: "Gift finder", triggerWords: ["present", "anniversary"], intro: "Here are a few lovely picks", ending: "Happy gifting!",
    questions: [
      { text: "Who is the gift for?", savedAs: "recipient", options: [{ label: "Wife", tags: ["Gift: Wife"] }, { label: "Mother", tags: ["Gift: Mother"] }, { label: "Myself" }] },
      { text: "What would they like?", savedAs: "kind", options: [
        { label: "Rings", types: ["Rings", "Gold Ring", "Demi Fine Rings"], followUp: { text: "Which style of ring?", savedAs: "ring_style", options: [
          { label: "Solitaire", search: "solitaire" }, { label: "Couple", search: "couple" }, { label: "Surprise me" },
        ] } },
        { label: "Pendants", types: ["Pendant", "Gold Pendant"] },
      ] },
    ],
    material: { text: "Silver, gold-plated or solid gold?", options: [
      { label: "Silver 925", types: ["Rings", "Pendant"] }, { label: "Gold-plated", types: ["Demi Fine Rings"] }, { label: "Solid gold", types: ["Gold Ring", "Gold Pendant"] },
    ] },
  };
  const draft = await gift.keepOptionsWithProducts(B, gift.cleanDraft(aiDraft, summary));
  const budgets = await gift.budgetQuestions(B, draft, summary);
  const gold = budgets.find(b => b.label === "Solid gold")?.question;
  const silver = budgets.find(b => b.label === "Silver 925")?.question;
  expect(budgets.length === 3 && gold && silver && gold.options[0].maxPrice! >= 15000 && silver.options[0].maxPrice! <= 3000, "a budget per material, from that material's prices", budgets.map(b => [b.label, b.question.options.map(o => o.label)]));

  const journeyId = await gift.saveGiftFinder(B, draft, budgets);
  const [j] = await db.select().from(schema.conversationJourneys).where(eq(schema.conversationJourneys.id, journeyId));
  const steps = (await storage.getJourneySteps(journeyId)) as any[];
  const shape = steps.map(s => s.toolTrigger === "get_products" ? "PRODUCTS" : s.toolTrigger === "journey_complete" ? "END" : `${s.isConditional === "true" ? "?" : ""}${s.crmFieldKey}`);
  expect(j.status === "inactive" && j.journeyType === "conversational", "saved switched off, conversational", j.status);
  expect(shape.join(" | ") === "recipient | kind | ?ring_style | material | ?budget | ?budget | ?budget | PRODUCTS | END", "steps: kind → ring style (only after Rings) → material → a budget per material", shape);
  const kindStep = steps.find(s => s.crmFieldKey === "kind");
  const route = JSON.parse(kindStep.branchingCondition).routes[0];
  expect(route.matchValue === "Rings" && route.targetStepId === steps.find(s => s.crmFieldKey === "ring_style").id, "Rings leads to the ring style question", route);
  expect(JSON.stringify(optionFiltersOf(kindStep).Rings.types) === JSON.stringify(["Rings", "Gold Ring", "Demi Fine Rings"]), "Rings means every ring type");

  // Switch it on and run it.
  await db.update(schema.conversationJourneys).set({ status: "active" } as any).where(eq(schema.conversationJourneys.id, journeyId));
  journeyService.invalidateJourneyCache(B);
  const newChat = async () => (await db.insert(schema.conversations).values({ businessAccountId: B, title: "Chat" } as any).returning())[0];
  let conv = await newChat();
  const send = (msg: string) => journeyOrchestrator.processUserMessageEngineDriven(conv.id, `w_${conv.id}`, B, msg, { channel: "widget" });
  let r = await send("I want a ring as a gift for my wife");
  expect(r.shouldBypassAI && /^ASK: Which style of ring/.test(r.response || ""), '"a ring for my wife": Wife and Rings taken from the message → ring style asked', r.response);

  const { currentQuestionPictures } = await import("../journeyOptionImages");
  const pics = await currentQuestionPictures(conv.id, B);
  expect(/Solitaire/.test(decodeURIComponent(pics.Solitaire ?? "")) && /Couple/.test(decodeURIComponent(pics.Couple ?? "")) && !pics["Surprise me"], "style tiles: a solitaire ring and a couple ring", pics);

  r = await send("Solitaire");
  expect(/^ASK: Silver, gold-plated or solid gold/.test(r.response || ""), "style answered → material", r.response);
  const matPics = await currentQuestionPictures(conv.id, B);
  expect(/^Gold (Solitaire|Couple|Leaf)/.test(decodeURIComponent((matPics["Solid gold"] ?? "").split("/").pop() ?? "")) && /Silver.*Ring/.test(decodeURIComponent(matPics["Silver 925"] ?? "")), "material tiles show rings of that material (rings were chosen)", matPics);
  r = await send("Solid gold");
  const goldLabels = gold!.options.map(o => o.label);
  expect(/^ASK: What's your budget/.test(r.response || "") && JSON.stringify(r.options) === JSON.stringify(goldLabels), "solid gold → the gold budget bands", r.options);
  r = await send(goldLabels[1]);
  const ps = r.productSearch;
  expect(r.isComplete && ps?.tagGroups[0]?.[0] === "Gift: Wife" && JSON.stringify(ps?.typeGroups) === JSON.stringify([["Rings", "Gold Ring", "Demi Fine Rings"], ["Gold Ring", "Gold Pendant"]]) && ps?.minPrice === gold!.options[1].minPrice && /solitaire/.test(ps?.search || ""), "product search: Wife, rings AND gold, the band's prices, 'solitaire' words", ps);

  const { ToolExecutionService } = await import("../toolExecutionService");
  const found = await ToolExecutionService.executeTool("get_products", { search: ps!.search, tag_groups: ps!.tagGroups, type_groups: ps!.typeGroups, min_price: ps!.minPrice, max_price: ps!.maxPrice }, { businessAccountId: B, userId: "t", userMessage: "x", conversationId: conv.id } as any);
  const foundNames = ((found as any).data as any[]).map(p => p.name);
  expect(foundNames.length > 0 && foundNames.every(n => /^Gold/.test(n) && /Ring|Band/.test(n)) && foundNames[0] === "Gold Solitaire Ring", "the products: gold rings for a wife in that band, solitaire first", foundNames);

  // Pendants skip the ring style question.
  conv = await newChat();
  await send("gift for my mother");
  r = await send("Pendants");
  expect(/^ASK: Silver, gold-plated or solid gold/.test(r.response || ""), "Pendants → straight to material (no ring style)", r.response);

  fake.close();
  await pool.end().catch(() => {});
  if (failed) { console.error(`\n${failed} gift finder build checks failed`); process.exit(1); }
  console.log("\nAll gift finder build checks passed");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
