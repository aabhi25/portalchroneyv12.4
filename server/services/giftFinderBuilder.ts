/**
 * "Build a gift finder from my products": the AI drafts a gift journey from a summary of the account's
 * catalogue (product types with their prices, tags, and the words most used in the names of the biggest types —
 * never the products one by one), and the server makes sure every option leads to real products before saving it.
 *
 *  - the AI writes 2–3 tap-to-answer questions: who it's for, the occasion, the kind of piece. A kind groups
 *    similar types ("Rings" = Rings, Gold Ring, Demi Fine Rings), each option pointing at tags and types that
 *    exist in the catalogue (shared/journeyProducts.ts filters);
 *  - the biggest kind can get a follow-up "Which style?" (options found from the words in its product names),
 *    asked only after that option;
 *  - when the type names show materials (silver / gold / gold-plated…), a material question groups the types
 *    by material, and each material gets its own budget question from that material's real prices; otherwise
 *    one budget question from all prices. Budgets are built here, not by the AI;
 *  - unknown tags/types are dropped, options with no products are dropped, questions left with fewer than two
 *    options are dropped;
 *  - the journey is saved switched OFF, as a normal conversational journey with a "Show products" step,
 *    so it is reviewed in the journey builder before it goes live.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { conversationJourneys, journeySteps } from "@shared/schema";
import { withOptionFilters, type OptionFilter } from "@shared/journeyProducts";
import { getLiveProductSource } from "./productSourceSwitch";

interface PriceSpread { min: number; p33: number; p66: number; max: number }

export interface CatalogSummary {
  total: number;
  inStock: number;
  prices: PriceSpread | null;
  types: { name: string; count: number; median: number | null }[];
  tags: { name: string; count: number }[];
  /** For the biggest types: the words most used in their product names (styles: "solitaire", "couple"…). */
  nameWords: { type: string; words: { word: string; count: number }[] }[];
}

export interface DraftOption extends OptionFilter {
  label: string;
  /** "Which style?" asked only after this option. */
  followUp?: DraftQuestion;
}
export interface DraftQuestion { text: string; savedAs: string; options: DraftOption[] }
export interface GiftFinderDraft {
  name: string;
  triggerWords: string[];
  questions: DraftQuestion[];
  /** Silver / gold-plated / solid gold…: each option's types; each gets its own budget question. */
  material: DraftQuestion | null;
  intro: string;
  ending: string;
}

const MAX_TAGS_SHOWN = 150;
const MAX_TYPES_SHOWN = 60;
const NAME_WORD_TYPES = 5;
const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 6;

const STOP_WORDS = new Set([
  "and", "for", "the", "with", "of", "in", "a", "an", "to", "by", "set", "pair", "piece", "new", "your", "her", "his",
  "925", "sterling", "silver", "gold", "rose", "plated", "ring", "rings", "pendant", "earrings", "earring", "bracelet",
  "necklace", "chain", "anklet", "anklets", "giva", "women", "womens", "men", "mens", "jewellery", "jewelry",
]);

async function liveFilter(businessAccountId: string) {
  const live = await getLiveProductSource(businessAccountId);
  return live === "woocommerce" ? sql`p.source = 'woocommerce'` : sql`p.source <> 'woocommerce'`;
}

/** Product types (with typical price), tags, price spread and name words of the products the chat uses. */
export async function catalogSummary(businessAccountId: string): Promise<CatalogSummary> {
  const live = await liveFilter(businessAccountId);
  const [counts] = (await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE coalesce(p.stock_status, 'in_stock') <> 'out_of_stock')::int AS in_stock,
           min(p.price)::float8 AS min, max(p.price)::float8 AS max,
           percentile_cont(0.33) WITHIN GROUP (ORDER BY p.price)::float8 AS p33,
           percentile_cont(0.66) WITHIN GROUP (ORDER BY p.price)::float8 AS p66
      FROM products p WHERE p.business_account_id = ${businessAccountId} AND ${live}
  `)).rows as any[];
  const types = (await db.execute(sql`
    SELECT c.name, count(DISTINCT p.id)::int AS count, percentile_cont(0.5) WITHIN GROUP (ORDER BY p.price)::float8 AS median
      FROM products p JOIN product_categories pc ON pc.product_id = p.id JOIN categories c ON c.id = pc.category_id
     WHERE p.business_account_id = ${businessAccountId} AND ${live}
     GROUP BY c.name ORDER BY count DESC, c.name LIMIT ${MAX_TYPES_SHOWN}
  `)).rows as any[];
  const tags = (await db.execute(sql`
    SELECT t.name, count(DISTINCT p.id)::int AS count
      FROM products p JOIN product_tags pt ON pt.product_id = p.id JOIN tags t ON t.id = pt.tag_id
     WHERE p.business_account_id = ${businessAccountId} AND ${live}
     GROUP BY t.name ORDER BY count DESC, t.name LIMIT ${MAX_TAGS_SHOWN}
  `)).rows as any[];
  const nameWords: CatalogSummary["nameWords"] = [];
  for (const t of types.slice(0, NAME_WORD_TYPES)) {
    const rows = (await db.execute(sql`
      SELECT p.name FROM products p JOIN product_categories pc ON pc.product_id = p.id JOIN categories c ON c.id = pc.category_id
       WHERE p.business_account_id = ${businessAccountId} AND ${live} AND c.name = ${t.name}
    `)).rows as any[];
    nameWords.push({ type: String(t.name), words: topNameWords(rows.map(r => String(r.name))) });
  }
  const total = Number(counts?.total ?? 0);
  return {
    total,
    inStock: Number(counts?.in_stock ?? 0),
    prices: counts?.min != null ? { min: Number(counts.min), p33: Number(counts.p33), p66: Number(counts.p66), max: Number(counts.max) } : null,
    types: types.map(r => ({ name: String(r.name), count: Number(r.count), median: r.median == null ? null : Math.round(Number(r.median)) })),
    tags: tags.map(r => ({ name: String(r.name), count: Number(r.count) })),
    nameWords,
  };
}

/** The words product names use most (styles, motifs), without generic jewellery / metal words. */
export function topNameWords(names: string[], limit = 25): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const seen = new Set<string>();
    for (const w of name.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)) {
      if (w.length < 3 || STOP_WORDS.has(w) || seen.has(w)) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([word, count]) => ({ word, count })).filter(w => w.count >= 3)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, limit);
}

/** A friendly round number near a price (₹1,180 → 1,000; ₹2,640 → 2,500). */
export function roundPrice(n: number): number {
  if (n <= 0) return 0;
  const step = n < 1000 ? 100 : n < 5000 ? 500 : n < 20000 ? 1000 : 5000;
  return Math.max(step, Math.round(n / step) * step);
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** "What's your budget?" from a price spread: three bands around the 33rd/66th percentiles (two when prices are close). */
export function budgetQuestion(prices: PriceSpread | null, text = "What's your budget?", savedAs = "budget"): DraftQuestion | null {
  if (!prices || prices.max <= 0) return null;
  const low = roundPrice(prices.p33);
  let high = roundPrice(prices.p66);
  if (high <= low) high = roundPrice(low * 2);
  if (low <= prices.min || high >= prices.max) {
    const mid = roundPrice((prices.min + prices.max) / 2);
    if (mid <= prices.min || mid >= prices.max) return null;
    return { text, savedAs, options: [
      { label: `Under ${inr(mid)}`, maxPrice: mid },
      { label: `${inr(mid)} and above`, minPrice: mid },
    ] };
  }
  return { text, savedAs, options: [
    { label: `Under ${inr(low)}`, maxPrice: low },
    { label: `${inr(low)} – ${inr(high)}`, minPrice: low, maxPrice: high },
    { label: `Above ${inr(high)}`, minPrice: high },
  ] };
}

/** The price spread of the products of some types (a material's budget). */
export async function priceSpreadForTypes(businessAccountId: string, types: string[]): Promise<PriceSpread | null> {
  if (!types.length) return null;
  const live = await liveFilter(businessAccountId);
  const lowered = types.map(t => t.toLowerCase());
  const [row] = (await db.execute(sql`
    SELECT min(p.price)::float8 AS min, max(p.price)::float8 AS max,
           percentile_cont(0.33) WITHIN GROUP (ORDER BY p.price)::float8 AS p33,
           percentile_cont(0.66) WITHIN GROUP (ORDER BY p.price)::float8 AS p66
      FROM products p
     WHERE p.business_account_id = ${businessAccountId} AND ${live} AND p.price IS NOT NULL
       AND EXISTS (SELECT 1 FROM product_categories pc JOIN categories c ON c.id = pc.category_id
                    WHERE pc.product_id = p.id AND lower(c.name) IN (${sql.join(lowered.map(t => sql`${t}`), sql`, `)}))
  `)).rows as any[];
  return row?.min != null ? { min: Number(row.min), p33: Number(row.p33), p66: Number(row.p66), max: Number(row.max) } : null;
}

/** The instructions and catalogue summary the AI drafts from. */
export function draftPrompt(businessName: string, summary: CatalogSummary): { system: string; user: string } {
  const system = `You design a "gift finder" for an online shop's chat assistant. A shopper says something like "I want to gift my wife something"; the assistant asks a few tap-to-answer questions and then shows matching products.

Return JSON only:
{
  "name": "Gift finder",
  "triggerWords": ["gift", ...],
  "questions": [
    { "text": "Who is the gift for?", "savedAs": "recipient",
      "options": [ { "label": "Wife", "tags": ["<exact tag names>"] } ] },
    { "text": "What would they like?", "savedAs": "kind",
      "options": [ { "label": "Rings", "types": ["<exact type names>"],
                     "followUp": { "text": "Which style of ring?", "savedAs": "ring_style",
                                   "options": [ { "label": "Solitaire", "search": "solitaire" } ] } } ] }
  ],
  "material": { "text": "Silver, gold or diamond?", "savedAs": "material",
                "options": [ { "label": "Silver 925", "types": ["<exact type names>"] } ] },
  "intro": "One short line shown above the suggested products",
  "ending": "One short closing line"
}

Rules:
- 2 or 3 questions in "questions", at most ${MAX_OPTIONS} options each, short labels a shopper taps. Do NOT ask about budget or price (added separately). Do NOT ask for name, phone or email.
- Ask who the gift is for first when the tags show recipients (e.g. "Gift: Wife", "suited for men"); then the occasion if the tags show occasions; then the kind of piece.
- Options point to products with "tags" (exact names from TAGS; a product needs ANY one) and/or "types" (exact names from TYPES; ANY one). Use only names from the lists, spelled exactly. An option may have "search" words instead.
- Kind of piece: group similar types into one option, e.g. "Rings" → every ring type (silver, gold, gold-plated…), "Pendants & necklaces" → pendant, necklace and chain types. Leave out types that are not gifts (candles, perfume, packaging) unless the shop sells little else.
- Give the biggest kind ONE "followUp" style question (4–6 options) built from the WORDS IN NAMES list for its types; style options use "search" words (e.g. "solitaire", "couple", "heart"), or tags/types when they exist. No other option has a followUp.
- "material": only when the type names show materials or finishes (e.g. "Gold Ring" vs "Rings" vs "Demi Fine Rings"). Each option lists ALL the types of that material across kinds (e.g. Solid gold → Gold Ring, Gold Pendant, Gold Earrings…; Silver → the plain types). Use the typical prices to tell the materials apart. Otherwise "material": null.
- Only offer options that have products (the lists show how many). Prefer options with many products. You may add one catch-all option like "Surprise me" with no filter.
- triggerWords: 4–8 short words or phrases a shopper uses when looking for a gift, lowercase.
- Write in simple, warm English.`;
  const user = [
    `Shop: ${businessName}`,
    `Products: ${summary.total} (${summary.inStock} in stock)`,
    summary.prices ? `Prices: ${inr(Math.round(summary.prices.min))} to ${inr(Math.round(summary.prices.max))}` : "",
    `TYPES (name — products — typical price):\n${summary.types.map(t => `${t.name} — ${t.count}${t.median != null ? ` — ${inr(t.median)}` : ""}`).join("\n") || "(none)"}`,
    `TAGS (name — products):\n${summary.tags.map(t => `${t.name} — ${t.count}`).join("\n") || "(none)"}`,
    summary.nameWords.length
      ? `WORDS IN NAMES (type: word ×products):\n${summary.nameWords.map(n => `${n.type}: ${n.words.map(w => `${w.word} ×${w.count}`).join(", ")}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n");
  return { system, user };
}

const asText = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const asKey = (v: unknown, fallback: string) => asText(v, 30).replace(/[^a-z0-9_]/gi, "_").toLowerCase() || fallback;

/**
 * The AI's draft made safe: only tag/type names that exist (spelled as the catalogue spells them),
 * at most 3 questions of 2–6 options, no budget/contact questions, one style follow-up at most, a material
 * question only with types, sensible trigger words.
 */
export function cleanDraft(raw: any, summary: CatalogSummary): GiftFinderDraft {
  const tagNames = new Map(summary.tags.map(t => [t.name.toLowerCase(), t.name]));
  const typeNames = new Map(summary.types.map(t => [t.name.toLowerCase(), t.name]));
  let followUps = 0;

  const cleanOption = (o: any, allowFollowUp: boolean): DraftOption | null => {
    const label = asText(o?.label, 60);
    if (!label) return null;
    const rawTags = Array.isArray(o?.tags) ? o.tags : [];
    const rawTypes = [...(Array.isArray(o?.types) ? o.types : []), ...(typeof o?.type === "string" ? [o.type] : [])];
    const tags = Array.from(new Set(rawTags.map((t: unknown) => tagNames.get(String(t).trim().toLowerCase())).filter((t: string | undefined): t is string => !!t)));
    const types = Array.from(new Set(rawTypes.map((t: unknown) => typeNames.get(String(t).trim().toLowerCase())).filter((t: string | undefined): t is string => !!t)));
    const search = asText(o?.search, 60) || null;
    // It meant to point at tags or types the catalogue doesn't have: no products behind it.
    if ((rawTags.length || rawTypes.length) && !tags.length && !types.length && !search) return null;
    const opt: DraftOption = { label };
    if (tags.length) opt.tags = tags as string[];
    if (types.length) opt.types = types as string[];
    if (search) opt.search = search;
    if (allowFollowUp && followUps === 0 && o?.followUp) {
      const fu = cleanQuestion(o.followUp, false);
      if (fu) { opt.followUp = fu; followUps++; }
    }
    return opt;
  };

  const cleanQuestion = (q: any, allowFollowUp: boolean): DraftQuestion | null => {
    const text = asText(q?.text);
    if (!text || /budget|price|spend|phone|mobile|email|name\b/i.test(text)) return null;
    const seen = new Set<string>();
    const options: DraftOption[] = [];
    for (const o of Array.isArray(q?.options) ? q.options : []) {
      const opt = cleanOption(o, allowFollowUp);
      if (!opt || seen.has(opt.label.toLowerCase())) continue;
      seen.add(opt.label.toLowerCase());
      options.push(opt);
      if (options.length >= MAX_OPTIONS) break;
    }
    return options.length >= 2 ? { text, savedAs: asKey(q?.savedAs, "gift_q"), options } : null;
  };

  const questions: DraftQuestion[] = [];
  for (const q of Array.isArray(raw?.questions) ? raw.questions : []) {
    const cleaned = cleanQuestion(q, true);
    if (cleaned) questions.push(cleaned);
    if (questions.length >= MAX_QUESTIONS) break;
  }
  // Material: every option must name types (that is what tells the materials apart).
  let material = raw?.material ? cleanQuestion({ ...raw.material, options: (raw.material.options ?? []).map((o: any) => ({ ...o, followUp: undefined })) }, false) : null;
  if (material) {
    material = { ...material, savedAs: "material", options: material.options.filter(o => o.types?.length) };
    if (material.options.length < 2) material = null;
  }
  const words = (Array.isArray(raw?.triggerWords) ? raw.triggerWords : []).map((w: unknown) => asText(w, 40).toLowerCase()).filter(Boolean);
  return {
    name: asText(raw?.name, 60) || "Gift finder",
    triggerWords: Array.from(new Set(["gift", ...words])).slice(0, 10),
    questions,
    material,
    intro: asText(raw?.intro) || "Here are a few gift ideas you might like",
    ending: asText(raw?.ending) || "Hope you find the perfect gift!",
  };
}

/** How many products an option leads to (tags any-of, types any-of, price), among the products the chat uses. */
export async function productsForOption(businessAccountId: string, f: OptionFilter): Promise<number> {
  const live = await liveFilter(businessAccountId);
  const tags = (f.tags ?? []).map(t => t.toLowerCase());
  const types = [...(f.types ?? []), ...(f.type ? [f.type] : [])].map(t => t.toLowerCase());
  const [row] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM products p
     WHERE p.business_account_id = ${businessAccountId} AND ${live}
       AND ${tags.length ? sql`EXISTS (SELECT 1 FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id = p.id AND lower(t.name) IN (${sql.join(tags.map(t => sql`${t}`), sql`, `)}))` : sql`TRUE`}
       AND ${types.length ? sql`EXISTS (SELECT 1 FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = p.id AND lower(c.name) IN (${sql.join(types.map(t => sql`${t}`), sql`, `)}))` : sql`TRUE`}
       AND ${f.minPrice != null ? sql`p.price >= ${f.minPrice}` : sql`TRUE`}
       AND ${f.maxPrice != null ? sql`p.price <= ${f.maxPrice}` : sql`TRUE`}
  `)).rows as any[];
  return Number(row?.n ?? 0);
}

/** Options with tags or types that lead to no products are dropped (catch-all and words-only options are kept). */
async function keepOptions(businessAccountId: string, q: DraftQuestion): Promise<DraftQuestion | null> {
  const options: DraftOption[] = [];
  for (const o of q.options) {
    if (!o.tags?.length && !o.types?.length) { options.push(o); continue; }
    if ((await productsForOption(businessAccountId, o)) === 0) continue;
    const followUp = o.followUp ? await keepOptions(businessAccountId, o.followUp) : undefined;
    options.push(followUp ? { ...o, followUp } : (({ followUp: _drop, ...rest }) => rest)(o));
  }
  return options.length >= 2 ? { ...q, options } : null;
}

/** Drop options that lead to no products; then questions left with < 2 options (also the material question). */
export async function keepOptionsWithProducts(businessAccountId: string, draft: GiftFinderDraft): Promise<GiftFinderDraft> {
  const questions: DraftQuestion[] = [];
  for (const q of draft.questions) {
    const kept = await keepOptions(businessAccountId, q);
    if (kept) questions.push(kept);
  }
  const material = draft.material ? await keepOptions(businessAccountId, draft.material) : null;
  return { ...draft, questions, material };
}

/** Budgets: one per material (from that material's prices) when there is a material question, else one for all. */
export async function budgetQuestions(businessAccountId: string, draft: GiftFinderDraft, summary: CatalogSummary): Promise<{ label: string | null; question: DraftQuestion }[]> {
  if (draft.material) {
    const out: { label: string | null; question: DraftQuestion }[] = [];
    for (const o of draft.material.options) {
      const q = budgetQuestion(await priceSpreadForTypes(businessAccountId, o.types ?? []), "What's your budget?", "budget");
      if (q) out.push({ label: o.label, question: q });
    }
    if (out.length) return out;
  }
  const one = budgetQuestion(summary.prices);
  return one ? [{ label: null, question: one }] : [];
}

interface PlannedStep {
  key: string;
  question: DraftQuestion;
  conditional: boolean;
  /** option label → key of the step it leads to */
  routes: Record<string, string>;
}

/** The steps in order, with which option leads where (follow-ups right after their question; budgets after material). */
export function planSteps(draft: GiftFinderDraft, budgets: { label: string | null; question: DraftQuestion }[]): PlannedStep[] {
  const steps: PlannedStep[] = [];
  draft.questions.forEach((q, i) => {
    const main: PlannedStep = { key: `q${i}`, question: { ...q, options: q.options.map(({ followUp: _f, ...o }) => o) }, conditional: false, routes: {} };
    steps.push(main);
    q.options.forEach((o, j) => {
      if (!o.followUp) return;
      const key = `q${i}f${j}`;
      steps.push({ key, question: o.followUp, conditional: true, routes: {} });
      main.routes[o.label] = key;
    });
  });
  const perMaterial = budgets.some(b => b.label !== null);
  if (draft.material) {
    const m: PlannedStep = { key: "material", question: draft.material, conditional: false, routes: {} };
    steps.push(m);
    budgets.forEach((b, i) => {
      if (!b.label) return;
      const key = `budget${i}`;
      steps.push({ key, question: b.question, conditional: true, routes: {} });
      m.routes[b.label] = key;
    });
  }
  if (!perMaterial && budgets[0]) steps.push({ key: "budget", question: budgets[0].question, conditional: false, routes: {} });
  return steps;
}

/** Saves the draft as a conversational journey, switched off, ending with "Show products". */
export async function saveGiftFinder(businessAccountId: string, draft: GiftFinderDraft, budgets: { label: string | null; question: DraftQuestion }[]): Promise<string> {
  const planned = planSteps(draft, budgets);
  return db.transaction(async (tx) => {
    const [journey] = await tx.insert(conversationJourneys).values({
      businessAccountId,
      name: draft.name,
      description: "Built by AI from your products: a few questions, then matching products. Review it, then switch it on.",
      templateType: "product_discovery",
      journeyType: "conversational",
      status: "inactive",
      isDefault: "false",
      triggerMode: "manual",
      triggerKeywords: JSON.stringify(draft.triggerWords),
      startFromScratch: "false",
      endMode: "chat",
    } as any).returning({ id: conversationJourneys.id });
    const ids = new Map<string, string>();
    let order = 0;
    for (const p of planned) {
      const q = p.question;
      const [row] = await tx.insert(journeySteps).values({
        journeyId: journey.id,
        stepOrder: String(order++),
        questionText: q.text,
        questionType: "radio",
        toolTrigger: "none",
        isRequired: "false",
        isConditional: p.conditional ? "true" : "false",
        crmFieldKey: q.savedAs,
        multipleChoiceOptions: JSON.stringify(q.options.map(o => o.label)),
        toolParameters: withOptionFilters(null, Object.fromEntries(q.options.map(({ label, followUp: _f, ...f }) => [label, f]))),
      } as any).returning({ id: journeySteps.id });
      ids.set(p.key, row.id);
    }
    // Option → follow-up / per-material budget (forward jumps; steps reached only that way are conditional).
    for (const p of planned) {
      const routes = Object.entries(p.routes).map(([label, key]) => ({ matchType: "exact", matchValue: label, targetStepId: ids.get(key)!, label }));
      if (!routes.length) continue;
      await tx.update(journeySteps).set({ branchingCondition: JSON.stringify({ routes, defaultNextStepId: null }) } as any)
        .where(sql`${journeySteps.id} = ${ids.get(p.key)!}`);
    }
    await tx.insert(journeySteps).values({
      journeyId: journey.id, stepOrder: String(order++), questionText: draft.intro, questionType: "text",
      toolTrigger: "get_products", isRequired: "false", isConditional: "false", toolParameters: JSON.stringify({ search: "gift" }),
    } as any);
    await tx.insert(journeySteps).values({
      journeyId: journey.id, stepOrder: String(order++), questionText: draft.ending, questionType: "text",
      toolTrigger: "journey_complete", isRequired: "false", isConditional: "false",
    } as any);
    return journey.id;
  });
}
