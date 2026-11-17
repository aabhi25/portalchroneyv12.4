/**
 * Journeys that end by showing products (a gift finder, a product finder): how the visitor's answers
 * become one product search. Shared by the server (journeyOrchestrator → chat product cards) and the
 * journey builder, so both read the same settings.
 *
 * Stored on the existing journey steps (journey_steps.tool_parameters, JSON) — nothing new in the database:
 *  - a "Pick one" question: { "optionFilters": { "<option>": { tags, minPrice, maxPrice, type, search } } }
 *    — what each option means for the products ("Wife" → tags Gift: Wife / Gift: For her;
 *    "Under ₹1,000" → maxPrice 1000; "Rings" → type Rings);
 *  - the "Show products" step (toolTrigger 'get_products'): { "search": "gift" } — words always searched;
 *    its question text is the line shown above the products.
 *
 * Answers without a filter (typed answers, options with nothing set) are added to the search words, so the
 * ranked search still uses them by meaning.
 */

export interface OptionFilter {
  /** The product must have one of these tags (exact tag names). */
  tags?: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  /** Product type / category ("Rings"). */
  type?: string | null;
  /** Extra search words. */
  search?: string | null;
  /** The product whose photo shows on this option's tile (picked in the builder); unset = picked automatically. */
  pictureProductId?: string | null;
}

/** Does the filter say anything about which products (a picture alone doesn't)? */
export function filtersProducts(f: OptionFilter | null | undefined): boolean {
  return !!f && (!!f.tags?.length || f.minPrice != null || f.maxPrice != null || !!f.type || !!f.search);
}

export interface JourneyProductSearch {
  search: string;
  /** Each group is one answer: the product needs one tag from every group. */
  tagGroups: string[][];
  minPrice: number | null;
  maxPrice: number | null;
  productType: string | null;
}

export interface ProductStepLike {
  id: string;
  questionText?: string | null;
  toolTrigger?: string | null;
  toolParameters?: string | null;
  multipleChoiceOptions?: string | null;
  questionType?: string | null;
  crmFieldKey?: string | null;
}

const CONTACT_TYPES = new Set(["phone", "email", "name", "mobile"]);
const CONTACT_KEYS = /^(name|full_?name|phone|mobile|whatsapp|email)$/i;

export function readToolParameters(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** The option filters saved on a question step, keyed by option label. */
export function optionFiltersOf(step: Pick<ProductStepLike, "toolParameters">): Record<string, OptionFilter> {
  const f = readToolParameters(step.toolParameters).optionFilters;
  return f && typeof f === "object" && !Array.isArray(f) ? f : {};
}

/** tool_parameters with the option filters replaced (other keys kept). Empty filters are dropped. */
export function withOptionFilters(raw: string | null | undefined, filters: Record<string, OptionFilter>): string | null {
  const params = readToolParameters(raw);
  const clean: Record<string, OptionFilter> = {};
  for (const [label, f] of Object.entries(filters)) {
    const c = cleanFilter(f);
    if (c) clean[label] = c;
  }
  if (Object.keys(clean).length) params.optionFilters = clean;
  else delete params.optionFilters;
  return Object.keys(params).length ? JSON.stringify(params) : null;
}

export function cleanFilter(f: OptionFilter | null | undefined): OptionFilter | null {
  if (!f) return null;
  const out: OptionFilter = {};
  const tags = Array.from(new Set((f.tags ?? []).map(t => String(t).trim()).filter(Boolean)));
  if (tags.length) out.tags = tags;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const min = num(f.minPrice), max = num(f.maxPrice);
  if (min !== null) out.minPrice = min;
  if (max !== null) out.maxPrice = max;
  if (f.type && String(f.type).trim()) out.type = String(f.type).trim();
  if (f.search && String(f.search).trim()) out.search = String(f.search).trim();
  if (f.pictureProductId && String(f.pictureProductId).trim()) out.pictureProductId = String(f.pictureProductId).trim();
  return Object.keys(out).length ? out : null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** A step that runs something (ending, "Show products", lead / booking) rather than asking; the builder saves plain questions as 'none'. */
export function isToolStep(step: Pick<ProductStepLike, "toolTrigger">): boolean {
  return !!step.toolTrigger && step.toolTrigger !== "none";
}

/** The option an answer picked: exact (ignoring case), else the option the answer contains or that contains it. */
export function matchOption(answer: string, options: string[]): string | null {
  const a = norm(answer);
  if (!a) return null;
  const exact = options.find(o => norm(o) === a);
  if (exact) return exact;
  return options.find(o => a.includes(norm(o))) ?? options.find(o => norm(o).includes(a)) ?? null;
}

/**
 * The product search for a journey's "Show products" step, from the answers so far
 * (step id → answer; skipped steps are stored as "[SKIPPED…]").
 */
export function buildJourneyProductSearch(steps: ProductStepLike[], answers: Map<string, string> | Record<string, string>, productStep?: ProductStepLike | null): JourneyProductSearch {
  const get = (id: string) => (answers instanceof Map ? answers.get(id) : answers[id]);
  const words: string[] = [];
  const base = productStep ? readToolParameters(productStep.toolParameters).search : null;
  if (typeof base === "string" && base.trim()) words.push(base.trim());
  const tagGroups: string[][] = [];
  let minPrice: number | null = null;
  let maxPrice: number | null = null;
  let productType: string | null = null;

  for (const step of steps) {
    if (isToolStep(step)) continue; // endings, "Show products", lead / booking steps
    const answer = get(step.id);
    if (!answer || answer.startsWith("[SKIPPED")) continue;
    if (CONTACT_TYPES.has(String(step.questionType)) || CONTACT_KEYS.test(String(step.crmFieldKey ?? ""))) continue;
    const filters = optionFiltersOf(step);
    const label = matchOption(answer, Object.keys(filters));
    const f = label ? cleanFilter(filters[label]) : null;
    if (!f || !filtersProducts(f)) {
      words.push(answer.trim().slice(0, 80));
      continue;
    }
    if (f.tags?.length) tagGroups.push(f.tags);
    if (f.minPrice != null) minPrice = minPrice === null ? f.minPrice : Math.max(minPrice, f.minPrice);
    if (f.maxPrice != null) maxPrice = maxPrice === null ? f.maxPrice : Math.min(maxPrice, f.maxPrice);
    if (f.type) productType = f.type;
    if (f.search) words.push(f.search);
  }
  if (productType) words.push(productType);
  const search = Array.from(new Set(words.map(w => w.trim()).filter(Boolean))).join(" ").slice(0, 200) || "gift";
  return { search, tagGroups, minPrice, maxPrice, productType };
}

/** "Products" step: the line shown above the products. */
export function productStepIntro(step: ProductStepLike | null | undefined): string {
  return (step?.questionText ?? "").trim();
}
