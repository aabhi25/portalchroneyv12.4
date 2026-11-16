-- Product keyword search (server/services/productHybridSearch.ts): name (weight A) + description (weight C),
-- kept up to date by Postgres itself. Database-only on purpose: not in shared/schema.ts, so ordinary product
-- reads don't carry it.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, left(coalesce("description", ''), 4000)), 'C')
  ) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_search_tsv_idx" ON "products" USING gin ("search_tsv");
