import { sql } from "drizzle-orm";
import { db } from "../db";
import { embeddingService } from "./embeddingService";
import { getLiveProductSource } from "./productSourceSwitch";

/**
 * Product search for the chat (get_products): one ranked query that combines
 *
 *  - keyword: the product's name (strongest) and description, English word forms ("earrings" = "earring"),
 *    via the database's own search column (migration 0067);
 *  - meaning: the product's search fingerprint (text_embedding) compared with the question;
 *  - category / tag: the product type the question names ("earrings") matched to category and tag names;
 *
 * merged by rank (reciprocal rank fusion, as enterprise search does) instead of fixed score cut-offs, with
 * price filters inside the query and out-of-stock products pushed down. When the question names a product
 * type that the catalog has, only products of that type are returned ("silver earrings" never shows rings).
 *
 * Meaning-only matches must clear a low similarity floor, so an unrelated question ("do you sell cars?")
 * returns nothing instead of the closest jewellery.
 */

export interface HybridSearchOptions {
  query: string;
  /** Product type read from the question ("earrings"), if any. */
  productType?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  /**
   * Tag filter (journeys that show products, e.g. a gift finder): the product needs one tag from every
   * group, by exact name ignoring case. Products that pass are all candidates, best matches first.
   */
  tagGroups?: string[][];
  /** Type filter, the same way: the product's type (category) is one from every group ("Rings…" + "Gold Ring…"). */
  typeGroups?: string[][];
  /** Candidates returned (pagination happens after). */
  limit?: number;
}

export interface HybridHit {
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  stockStatus: string | null;
  regularPrice: string | null;
  messagingImageUrl: string | null;
  score: number;
  /** Which searches found it: keyword, meaning, category. */
  via: string[];
}

const RRF_K = 60;
const CANDIDATES = 100;
/** Meaning-only matches below this similarity are dropped (text-embedding-3-small: unrelated ≈ 0.1–0.2). */
export const MEANING_FLOOR = 0.3;
const OUT_OF_STOCK_FACTOR = 0.5;

/** Words of a question as a database search expression: "silver earrings under 2000" → "silver | earrings". */
export function keywordExpression(text: string, join: "|" | "&" = "|"): string | null {
  const words = (text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 2 && !/^\d+$/.test(w) && !["under", "below", "above", "over", "rs", "inr", "price", "between"].includes(w))
    .slice(0, 12);
  return words.length ? Array.from(new Set(words)).join(` ${join} `) : null;
}

export async function hybridProductSearch(businessAccountId: string, opts: HybridSearchOptions): Promise<HybridHit[]> {
  const started = Date.now();
  const kwq = keywordExpression(opts.query);
  const typeq = opts.productType ? keywordExpression(opts.productType, "&") : null;
  const limit = Math.max(1, Math.min(opts.limit ?? CANDIDATES, CANDIDATES));

  // The question's fingerprint (skipped when the account has no AI key: keyword + category still work).
  let vector: string | null = null;
  try {
    vector = JSON.stringify(await embeddingService.generateEmbedding(opts.query, businessAccountId));
  } catch (e: any) {
    console.log(`[Hybrid Search] No meaning search for this question: ${e?.message}`);
  }

  const live = await getLiveProductSource(businessAccountId);
  const liveOnly = live === "woocommerce" ? sql`p.source = 'woocommerce'` : sql`p.source <> 'woocommerce'`;
  const minPrice = opts.minPrice ?? null;
  const maxPrice = opts.maxPrice ?? null;
  const priceFilter = sql`${minPrice === null ? sql`TRUE` : sql`p.price >= ${minPrice}`} AND ${maxPrice === null ? sql`TRUE` : sql`p.price <= ${maxPrice}`}`;
  const groups = (opts.tagGroups ?? []).map(g => g.map(t => t.trim().toLowerCase()).filter(Boolean)).filter(g => g.length > 0);
  const typeGroups = (opts.typeGroups ?? []).map(g => g.map(t => t.trim().toLowerCase()).filter(Boolean)).filter(g => g.length > 0);
  const typeFilter = typeGroups.length
    ? sql.join(typeGroups.map(g => sql`EXISTS (SELECT 1 FROM product_categories pc2 JOIN categories c2 ON c2.id = pc2.category_id
                                               WHERE pc2.product_id = p.id AND lower(c2.name) IN (${sql.join(g.map(t => sql`${t}`), sql`, `)}))`), sql` AND `)
    : sql`TRUE`;
  const filtered = groups.length > 0 || typeGroups.length > 0;
  const tagFilter = groups.length
    ? sql.join(groups.map(g => sql`EXISTS (SELECT 1 FROM product_tags pt JOIN tags t ON t.id = pt.tag_id
                                           WHERE pt.product_id = p.id AND lower(t.name) IN (${sql.join(g.map(t => sql`${t}`), sql`, `)}))`), sql` AND `)
    : sql`TRUE`;

  const kwCte = kwq
    ? sql`SELECT id, row_number() OVER (ORDER BY ts_rank_cd(search_tsv, to_tsquery('english', ${kwq})) DESC, id) AS r
          FROM base WHERE search_tsv @@ to_tsquery('english', ${kwq}) ORDER BY r LIMIT ${sql.raw(String(CANDIDATES))}`
    : sql`SELECT NULL::varchar AS id, 0::bigint AS r WHERE FALSE`;
  const catCte = typeq
    ? sql`SELECT DISTINCT b.id FROM base b
            JOIN product_categories pc ON pc.product_id = b.id JOIN categories c ON c.id = pc.category_id
           WHERE to_tsvector('english', c.name) @@ to_tsquery('english', ${typeq})
          UNION
          SELECT DISTINCT b.id FROM base b
            JOIN product_tags pt ON pt.product_id = b.id JOIN tags t ON t.id = pt.tag_id
           WHERE to_tsvector('english', t.name) @@ to_tsquery('english', ${typeq})`
    : sql`SELECT NULL::varchar AS id WHERE FALSE`;
  const vecCte = vector
    ? sql`SELECT id, 1 - (text_embedding <=> ${vector}::vector) AS sim,
                 row_number() OVER (ORDER BY text_embedding <=> ${vector}::vector, id) AS r
            FROM base WHERE text_embedding IS NOT NULL
           ORDER BY r LIMIT ${sql.raw(String(CANDIDATES))}`
    : sql`SELECT NULL::varchar AS id, 0::float AS sim, 0::bigint AS r WHERE FALSE`;
  const typeHit = typeq
    ? sql`(b.id IN (SELECT id FROM cat) OR to_tsvector('english', b.name) @@ to_tsquery('english', ${typeq}))`
    : sql`FALSE`;

  const result = await db.execute(sql`
    WITH base AS (
      SELECT p.id, p.name, p.description, p.price, p.image_url, p.product_url, p.stock_status, p.regular_price,
             p.messaging_image_url, p.search_tsv, p.text_embedding
        FROM products p
       WHERE p.business_account_id = ${businessAccountId} AND ${liveOnly} AND ${priceFilter} AND ${tagFilter} AND ${typeFilter}
    ),
    kw AS (${kwCte}),
    cat AS (${catCte}),
    vec AS (${vecCte}),
    hits AS (
      SELECT id, 1.0 / (${sql.raw(String(RRF_K))} + r) AS s, 'keyword' AS via FROM kw
      UNION ALL
      SELECT id, 1.0 / (${sql.raw(String(RRF_K))} + r), 'meaning' FROM vec
       WHERE sim >= ${sql.raw(String(MEANING_FLOOR))} OR id IN (SELECT id FROM kw) OR id IN (SELECT id FROM cat)
      UNION ALL
      SELECT id, 1.0 / (${sql.raw(String(RRF_K + 1))}), 'category' FROM cat
      UNION ALL
      -- With a tag / type filter every remaining product fits the answers: all are candidates (weakest score).
      SELECT id, 1.0 / (${sql.raw(String(RRF_K + CANDIDATES))} + row_number() OVER (ORDER BY id)), 'tag'
        FROM (SELECT id FROM base WHERE ${filtered ? sql`TRUE` : sql`FALSE`} LIMIT ${sql.raw(String(CANDIDATES))}) tagged
    ),
    fused AS (
      SELECT id, sum(s) AS s, array_agg(DISTINCT via) AS via FROM hits GROUP BY id
    )
    SELECT b.id, b.name, b.description, b.price::text AS price, b.image_url, b.product_url, b.stock_status,
           b.regular_price::text AS regular_price, b.messaging_image_url,
           f.s * CASE WHEN b.stock_status = 'out_of_stock' THEN ${sql.raw(String(OUT_OF_STOCK_FACTOR))} ELSE 1.0 END AS score,
           f.via, ${typeHit} AS type_hit
      FROM fused f JOIN base b ON b.id = f.id
     ORDER BY score DESC, b.name
     LIMIT ${sql.raw(String(CANDIDATES))}
  `);

  let rows = result.rows as any[];
  // The question names a type the catalog has: only that type.
  const typed = rows.filter(r => r.type_hit === true);
  if (typeq && typed.length > 0) rows = typed;
  const hits: HybridHit[] = rows.slice(0, limit).map(r => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    price: r.price ?? null,
    imageUrl: r.image_url ?? null,
    productUrl: r.product_url ?? null,
    stockStatus: r.stock_status ?? null,
    regularPrice: r.regular_price ?? null,
    messagingImageUrl: r.messaging_image_url ?? null,
    score: Number(r.score),
    via: Array.isArray(r.via) ? r.via : String(r.via ?? "").replace(/[{}]/g, "").split(",").filter(Boolean),
  }));
  const count = (k: string) => hits.filter(h => h.via.includes(k)).length;
  console.log(`[Hybrid Search] "${opts.query.slice(0, 60)}"${opts.productType ? ` type=${opts.productType}` : ""}${groups.length ? ` tags=${groups.map(g => g.join("/")).join(" + ")}` : ""}${typeGroups.length ? ` types=${typeGroups.map(g => g.join("/")).join(" + ")}` : ""} → ${hits.length} (keyword ${count("keyword")}, meaning ${count("meaning")}, category ${count("category")}, tag ${count("tag")}) in ${Date.now() - started}ms`);
  return hits;
}
