/**
 * Photos on a product journey's options (a gift finder's "Pendant / Rings / Earrings…" shown as picture tiles).
 *
 * For each option that points at products by tags or types, one product photo: an in-stock product that fits the
 * option AND the answers given so far ("Partner" → a pendant suited to a partner), else one that fits the option
 * alone. Style options ("Solitaire") use the words in product names. Options don't repeat a product. An option can
 * name its own picture (pictureProductId, set in the journey builder). Price-only options (a budget) and catch-alls
 * ("Surprise me") get no photo. Plain database reads, no AI.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { buildJourneyProductSearch, cleanFilter, isToolStep, optionFiltersOf, type OptionFilter, type ProductStepLike } from "@shared/journeyProducts";
import { getLiveProductSource } from "./productSourceSwitch";

export interface PictureCandidate { id: string; name: string; imageUrl: string }

const CANDIDATES = 6;

export interface EarlierAnswers { tagGroups: string[][]; typeGroups: string[][] }

const lowerGroups = (groups: string[][]) => groups.map(g => g.map(t => t.toLowerCase()).filter(Boolean)).filter(g => g.length);

/**
 * Products with a photo that fit the option (its tags any-of, its types any-of) plus the earlier answers' tag and
 * type groups, in-stock first. `exclude` skips products another option already shows.
 */
export async function pictureCandidates(
  businessAccountId: string,
  filter: OptionFilter,
  earlier: EarlierAnswers = { tagGroups: [], typeGroups: [] },
  limit = CANDIDATES,
  exclude: string[] = [],
): Promise<PictureCandidate[]> {
  const live = (await getLiveProductSource(businessAccountId)) === "woocommerce" ? sql`p.source = 'woocommerce'` : sql`p.source <> 'woocommerce'`;
  const f = cleanFilter(filter) ?? {};
  const tagGroups = lowerGroups([...earlier.tagGroups, ...(f.tags?.length ? [f.tags] : [])]);
  const typeGroups = lowerGroups([...earlier.typeGroups, ...(f.types?.length ? [f.types] : [])]);
  const tagSql = tagGroups.length
    ? sql.join(tagGroups.map(g => sql`EXISTS (SELECT 1 FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id = p.id AND lower(t.name) IN (${sql.join(g.map(t => sql`${t}`), sql`, `)}))`), sql` AND `)
    : sql`TRUE`;
  const typeSql = typeGroups.length
    ? sql.join(typeGroups.map(g => sql`EXISTS (SELECT 1 FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = p.id AND lower(c.name) IN (${sql.join(g.map(t => sql`${t}`), sql`, `)}))`), sql` AND `)
    : sql`TRUE`;
  // Style options ("Solitaire", "Couple") point at products by words: the name has one of them.
  const words = (f.search ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3).slice(0, 5);
  const nameSql = words.length ? sql`(${sql.join(words.map(w => sql`p.name ILIKE ${`%${w}%`}`), sql` OR `)})` : sql`TRUE`;
  const excludeSql = exclude.length ? sql`p.id NOT IN (${sql.join(exclude.map(id => sql`${id}`), sql`, `)})` : sql`TRUE`;
  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.image_url FROM products p
     WHERE p.business_account_id = ${businessAccountId} AND ${live}
       AND p.image_url IS NOT NULL AND p.image_url <> ''
       AND ${tagSql} AND ${typeSql} AND ${nameSql} AND ${excludeSql}
     ORDER BY (coalesce(p.stock_status, 'in_stock') = 'out_of_stock'), md5(p.id)
     LIMIT ${limit}
  `)).rows as any[];
  return rows.map(r => ({ id: String(r.id), name: String(r.name), imageUrl: String(r.image_url) }));
}

async function productPicture(businessAccountId: string, productId: string): Promise<PictureCandidate | null> {
  const rows = (await db.execute(sql`
    SELECT id, name, image_url FROM products WHERE id = ${productId} AND business_account_id = ${businessAccountId} AND image_url IS NOT NULL AND image_url <> ''
  `)).rows as any[];
  return rows[0] ? { id: String(rows[0].id), name: String(rows[0].name), imageUrl: String(rows[0].image_url) } : null;
}

/** One photo per option of a question (label → image URL), using the answers given before it. */
export async function optionPictures(
  businessAccountId: string,
  step: ProductStepLike,
  steps: ProductStepLike[],
  answers: Map<string, string> | Record<string, string> = {},
): Promise<Record<string, string>> {
  const filters = optionFiltersOf(step);
  const labels = (() => {
    try { const v = JSON.parse(step.multipleChoiceOptions || "[]"); return Array.isArray(v) ? v.filter((o): o is string => typeof o === "string") : []; } catch { return []; }
  })();
  // The answers before this question narrow the photos (e.g. who the gift is for).
  const index = steps.findIndex(s => s.id === step.id);
  const before = buildJourneyProductSearch(steps.slice(0, Math.max(index, 0)).filter(s => !isToolStep(s)), answers);
  const earlier: EarlierAnswers = { tagGroups: before.tagGroups, typeGroups: before.typeGroups };
  const hasEarlier = earlier.tagGroups.length > 0 || earlier.typeGroups.length > 0;
  const used: string[] = [];
  const out: Record<string, string> = {};
  for (const label of labels) {
    const key = Object.keys(filters).find(k => k.trim().toLowerCase() === label.trim().toLowerCase());
    const f = key ? cleanFilter(filters[key]) : null;
    if (!f) continue;
    let pick: PictureCandidate | null = f.pictureProductId ? await productPicture(businessAccountId, f.pictureProductId) : null;
    if (!pick && (f.tags?.length || f.types?.length || f.search)) {
      pick = (await pictureCandidates(businessAccountId, f, earlier, 1, used))[0]
        ?? (hasEarlier ? (await pictureCandidates(businessAccountId, f, undefined, 1, used))[0] : undefined)
        ?? null;
    }
    if (pick) {
      out[label] = pick.imageUrl;
      used.push(pick.id);
    }
  }
  return out;
}

/** Photos for the question a conversation's journey is asking now (only journeys that end by showing products). */
export async function currentQuestionPictures(conversationId: string, businessAccountId: string): Promise<Record<string, string>> {
  const { journeyService } = await import("./journeyService");
  const { storage } = await import("../storage");
  const state = await journeyService.getJourneyState(conversationId);
  if (!state || state.completed) return {};
  const step = await journeyService.getCurrentStep(conversationId);
  if (!step || isToolStep(step)) return {};
  const steps = await storage.getJourneySteps(state.journeyId);
  if (!steps.some((s: any) => s.toolTrigger === "get_products")) return {};
  return optionPictures(businessAccountId, step, steps, state.responses);
}
