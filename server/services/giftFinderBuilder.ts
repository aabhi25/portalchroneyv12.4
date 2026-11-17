/**
 * "Build a gift finder from my products": the AI drafts a gift journey from a summary of the account's
 * catalogue (product types, tags and prices with how many products each has — never the products one
 * by one), and the server makes sure every option leads to real products before saving it.
 *
 *  - the AI writes 2–3 tap-to-answer questions (who it's for first, then occasion / style / type), each
 *    option pointing at tags and types that exist in the catalogue (shared/journeyProducts.ts filters);
 *  - unknown tags/types are dropped, options with no products are dropped, questions left with fewer than
 *    two options are dropped;
 *  - the budget question is built here from the real price spread (not by the AI);
 *  - the journey is saved switched OFF, as a normal conversational journey with a "Show products" step,
 *    so it is reviewed in the journey builder before it goes live.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { conversationJourneys, journeySteps } from "@shared/schema";
import { withOptionFilters, type OptionFilter } from "@shared/journeyProducts";
import { getLiveProductSource } from "./productSourceSwitch";

export interface CatalogSummary {
  total: number;
  inStock: number;
  prices: { min: number; p33: number; p66: number; max: number } | null;
  types: { name: string; count: number }[];
  tags: { name: string; count: number }[];
}

export interface DraftOption extends OptionFilter { label: string }
export interface DraftQuestion { text: string; savedAs: string; options: DraftOption[] }
export interface GiftFinderDraft {
  name: string;
  triggerWords: string[];
  questions: DraftQuestion[];
  intro: string;
  ending: string;
}

const MAX_TAGS_SHOWN = 150;
const MAX_TYPES_SHOWN = 40;
const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 6;

async function liveFilter(businessAccountId: string) {
  const live = await getLiveProductSource(businessAccountId);
  return live === "woocommerce" ? sql`p.source = 'woocommerce'` : sql`p.source <> 'woocommerce'`;
}

/** Product types, tags and the price spread of the products the chat uses. */
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
    SELECT c.name, count(DISTINCT p.id)::int AS count
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
  const total = Number(counts?.total ?? 0);
  return {
    total,
    inStock: Number(counts?.in_stock ?? 0),
    prices: counts?.min != null ? { min: Number(counts.min), p33: Number(counts.p33), p66: Number(counts.p66), max: Number(counts.max) } : null,
    types: types.map(r => ({ name: String(r.name), count: Number(r.count) })),
    tags: tags.map(r => ({ name: String(r.name), count: Number(r.count) })),
  };
}

/** A friendly round number near a price (₹1,180 → 1,000; ₹2,640 → 2,500). */
export function roundPrice(n: number): number {
  if (n <= 0) return 0;
  const step = n < 1000 ? 100 : n < 5000 ? 500 : n < 20000 ? 1000 : 5000;
  return Math.max(step, Math.round(n / step) * step);
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** "What's your budget?" from the real price spread: three bands around the 33rd/66th percentiles. */
export function budgetQuestion(prices: CatalogSummary["prices"]): DraftQuestion | null {
  if (!prices || prices.max <= 0) return null;
  const low = roundPrice(prices.p33);
  let high = roundPrice(prices.p66);
  if (high <= low) high = roundPrice(low * 2);
  if (low <= prices.min || high >= prices.max) {
    // Prices too close together for three bands: two.
    const mid = roundPrice((prices.min + prices.max) / 2);
    if (mid <= prices.min || mid >= prices.max) return null;
    return { text: "What's your budget?", savedAs: "budget", options: [
      { label: `Under ${inr(mid)}`, maxPrice: mid },
      { label: `${inr(mid)} and above`, minPrice: mid },
    ] };
  }
  return { text: "What's your budget?", savedAs: "budget", options: [
    { label: `Under ${inr(low)}`, maxPrice: low },
    { label: `${inr(low)} – ${inr(high)}`, minPrice: low, maxPrice: high },
    { label: `Above ${inr(high)}`, minPrice: high },
  ] };
}

/** The instructions and catalogue summary the AI drafts from. */
export function draftPrompt(businessName: string, summary: CatalogSummary): { system: string; user: string } {
  const system = `You design a short "gift finder" for an online shop's chat assistant. A shopper says something like "I want to gift my wife something"; the assistant asks a few tap-to-answer questions and then shows matching products.

Return JSON only:
{
  "name": "Gift finder",
  "triggerWords": ["gift", ...],
  "questions": [
    { "text": "Who is the gift for?", "savedAs": "recipient",
      "options": [ { "label": "Wife", "tags": ["<exact tag names>"], "type": null, "search": null } ] }
  ],
  "intro": "One short line shown above the suggested products",
  "ending": "One short closing line"
}

Rules:
- 2 or 3 questions, at most ${MAX_OPTIONS} options each, short labels a shopper taps. Do NOT ask about budget or price (it is added separately). Do NOT ask for name, phone or email.
- The first question is who the gift is for, if the tags show recipients (e.g. "Gift: Wife", "for her", "suited for men"). Then the occasion, the style, or the kind of product — whichever the catalogue supports best.
- Each option points to products with "tags" (exact names from the TAGS list; a product needs ANY one of them) and/or "type" (one exact name from the TYPES list). Use only names from the lists, spelled exactly. An option may also have "search" words instead.
- Only offer options that have products (the lists show how many). Prefer options with many products.
- You may add one catch-all option like "Surprise me" with no tags, type or search.
- triggerWords: 4–8 short words or phrases a shopper uses when looking for a gift (gift, present, anniversary, birthday, …), lowercase.
- Write in simple, warm English.`;
  const user = [
    `Shop: ${businessName}`,
    `Products: ${summary.total} (${summary.inStock} in stock)`,
    summary.prices ? `Prices: ${inr(Math.round(summary.prices.min))} to ${inr(Math.round(summary.prices.max))}` : "",
    `TYPES (name — products):\n${summary.types.map(t => `${t.name} — ${t.count}`).join("\n") || "(none)"}`,
    `TAGS (name — products):\n${summary.tags.map(t => `${t.name} — ${t.count}`).join("\n") || "(none)"}`,
  ].filter(Boolean).join("\n\n");
  return { system, user };
}

const asText = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * The AI's draft made safe: only tag/type names that exist (spelled as the catalogue spells them),
 * at most 3 questions of 2–6 options, no budget/contact questions, sensible trigger words.
 */
export function cleanDraft(raw: any, summary: CatalogSummary): GiftFinderDraft {
  const tagNames = new Map(summary.tags.map(t => [t.name.toLowerCase(), t.name]));
  const typeNames = new Map(summary.types.map(t => [t.name.toLowerCase(), t.name]));
  const questions: DraftQuestion[] = [];
  for (const q of Array.isArray(raw?.questions) ? raw.questions : []) {
    const text = asText(q?.text);
    if (!text || /budget|price|spend|phone|mobile|email|name\b/i.test(text)) continue;
    const seen = new Set<string>();
    const options: DraftOption[] = [];
    for (const o of Array.isArray(q?.options) ? q.options : []) {
      const label = asText(o?.label, 60);
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      const rawTags = Array.isArray(o?.tags) ? o.tags : [];
      const tags = rawTags.map((t: unknown) => tagNames.get(String(t).trim().toLowerCase())).filter((t: string | undefined): t is string => !!t);
      const type = typeof o?.type === "string" ? typeNames.get(o.type.trim().toLowerCase()) ?? null : null;
      const search = asText(o?.search, 60) || null;
      // It meant to point at tags or a type the catalogue doesn't have: no products behind it.
      const wantedFilter = rawTags.length > 0 || (typeof o?.type === "string" && o.type.trim() !== "");
      if (wantedFilter && !tags.length && !type && !search) continue;
      const opt: DraftOption = { label };
      if (tags.length) opt.tags = Array.from(new Set(tags));
      if (type) opt.type = type;
      if (search) opt.search = search;
      options.push(opt);
      if (options.length >= MAX_OPTIONS) break;
    }
    if (options.length >= 2) questions.push({ text, savedAs: asText(q?.savedAs, 30).replace(/[^a-z0-9_]/gi, "_").toLowerCase() || `gift_q${questions.length + 1}`, options });
    if (questions.length >= MAX_QUESTIONS) break;
  }
  const words = (Array.isArray(raw?.triggerWords) ? raw.triggerWords : []).map((w: unknown) => asText(w, 40).toLowerCase()).filter(Boolean);
  return {
    name: asText(raw?.name, 60) || "Gift finder",
    triggerWords: Array.from(new Set(["gift", ...words])).slice(0, 10),
    questions,
    intro: asText(raw?.intro) || "Here are a few gift ideas you might like",
    ending: asText(raw?.ending) || "Hope you find the perfect gift!",
  };
}

/** How many products an option leads to (tags any-of, type, price), among the products the chat uses. */
export async function productsForOption(businessAccountId: string, f: OptionFilter): Promise<number> {
  const live = await liveFilter(businessAccountId);
  const tags = (f.tags ?? []).map(t => t.toLowerCase());
  const [row] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM products p
     WHERE p.business_account_id = ${businessAccountId} AND ${live}
       AND ${tags.length ? sql`EXISTS (SELECT 1 FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id = p.id AND lower(t.name) IN (${sql.join(tags.map(t => sql`${t}`), sql`, `)}))` : sql`TRUE`}
       AND ${f.type ? sql`EXISTS (SELECT 1 FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = p.id AND lower(c.name) = ${f.type.toLowerCase()})` : sql`TRUE`}
       AND ${f.minPrice != null ? sql`p.price >= ${f.minPrice}` : sql`TRUE`}
       AND ${f.maxPrice != null ? sql`p.price <= ${f.maxPrice}` : sql`TRUE`}
  `)).rows as any[];
  return Number(row?.n ?? 0);
}

/** Drop options that lead to no products (catch-all and words-only options are kept); then questions left with < 2 options. */
export async function keepOptionsWithProducts(businessAccountId: string, draft: GiftFinderDraft): Promise<GiftFinderDraft> {
  const questions: DraftQuestion[] = [];
  for (const q of draft.questions) {
    const options: DraftOption[] = [];
    for (const o of q.options) {
      if (!o.tags?.length && !o.type) { options.push(o); continue; }
      if ((await productsForOption(businessAccountId, o)) > 0) options.push(o);
    }
    if (options.length >= 2) questions.push({ ...q, options });
  }
  return { ...draft, questions };
}

/** Saves the draft as a conversational journey, switched off, ending with "Show products". */
export async function saveGiftFinder(businessAccountId: string, draft: GiftFinderDraft, budget: DraftQuestion | null): Promise<string> {
  const all = budget ? [...draft.questions, budget] : draft.questions;
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
    let order = 0;
    for (const q of all) {
      await tx.insert(journeySteps).values({
        journeyId: journey.id,
        stepOrder: String(order++),
        questionText: q.text,
        questionType: "radio",
        toolTrigger: "none",
        isRequired: "false",
        isConditional: "false",
        crmFieldKey: q.savedAs,
        multipleChoiceOptions: JSON.stringify(q.options.map(o => o.label)),
        toolParameters: withOptionFilters(null, Object.fromEntries(q.options.map(({ label, ...f }) => [label, f]))),
      } as any);
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
