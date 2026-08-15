-- =====================================================================
-- Production schema sync — bring AWS prod DB up to dev (2026-06-11)
-- =====================================================================
-- Source of truth: live dev database (matches shared/schema.ts).
-- Scope: ADDITIVE ONLY. Adds the 3 new tables + 13 columns that exist in
--        dev but were missing from the 2026-06-10 prod backup.
--
-- Safe to run on a populated production database:
--   * Every NOT NULL column added here has a DEFAULT (no scan failures).
--   * Fully idempotent: re-running it makes no further changes.
--   * Wrapped in a single transaction — all-or-nothing.
--
-- NOT included (decide separately, see notes at bottom):
--   * whatsapp_leads.{loan_amount, loan_type, address}  (exist in PROD only)
--   * demo_orders.amount type change numeric -> numeric(10,2)
--
-- HOW TO RUN (AWS prod):
--   pg_dump "$PROD_DATABASE_URL" -Fc -f backup_before_sync.dump   # take a backup first
--   psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -f 2026-06-11_prod_schema_sync.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) NEW TABLES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.topscholar_embed_jobs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    business_account_id character varying NOT NULL,
    cp_id text NOT NULL,
    status text DEFAULT 'preparing'::text NOT NULL,
    store_type text DEFAULT 'pgvector'::text NOT NULL,
    sync_mode text DEFAULT 'full'::text NOT NULL,
    total_count integer DEFAULT 0 NOT NULL,
    completed_count integer DEFAULT 0 NOT NULL,
    batches jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT topscholar_embed_jobs_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.topscholar_embed_staging (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    job_id character varying NOT NULL,
    custom_id text NOT NULL,
    business_account_id character varying NOT NULL,
    cp_id text NOT NULL,
    content_type text NOT NULL,
    subject text,
    chapter text,
    title text,
    content_html text,
    content_text text NOT NULL,
    source_ref text,
    media_url text,
    metadata jsonb DEFAULT '{}'::jsonb,
    content_hash text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT topscholar_embed_staging_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.topscholar_plan_ids (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    business_account_id character varying NOT NULL,
    plan_id text NOT NULL,
    enabled text DEFAULT 'true'::text NOT NULL,
    last_status text DEFAULT 'idle'::text NOT NULL,
    last_error text,
    last_cp_id text,
    last_cp_name text,
    last_synced_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT topscholar_plan_ids_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------------------------------
-- 2) INDEXES for the new tables
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS topscholar_embed_jobs_account_cp_idx
    ON public.topscholar_embed_jobs USING btree (business_account_id, cp_id);
CREATE INDEX IF NOT EXISTS topscholar_embed_jobs_status_idx
    ON public.topscholar_embed_jobs USING btree (status);

CREATE INDEX IF NOT EXISTS topscholar_embed_staging_custom_idx
    ON public.topscholar_embed_staging USING btree (job_id, custom_id);
CREATE INDEX IF NOT EXISTS topscholar_embed_staging_job_idx
    ON public.topscholar_embed_staging USING btree (job_id);

CREATE UNIQUE INDEX IF NOT EXISTS topscholar_plan_ids_account_plan_idx
    ON public.topscholar_plan_ids USING btree (business_account_id, plan_id);

-- ---------------------------------------------------------------------
-- 3) FOREIGN KEYS (guarded — Postgres has no ADD CONSTRAINT IF NOT EXISTS)
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'topscholar_embed_jobs_business_account_id_business_accounts_id_') THEN
    ALTER TABLE ONLY public.topscholar_embed_jobs
      ADD CONSTRAINT topscholar_embed_jobs_business_account_id_business_accounts_id_
      FOREIGN KEY (business_account_id) REFERENCES public.business_accounts(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'topscholar_embed_staging_job_id_topscholar_embed_jobs_id_fk') THEN
    ALTER TABLE ONLY public.topscholar_embed_staging
      ADD CONSTRAINT topscholar_embed_staging_job_id_topscholar_embed_jobs_id_fk
      FOREIGN KEY (job_id) REFERENCES public.topscholar_embed_jobs(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'topscholar_plan_ids_business_account_id_business_accounts_id_fk') THEN
    ALTER TABLE ONLY public.topscholar_plan_ids
      ADD CONSTRAINT topscholar_plan_ids_business_account_id_business_accounts_id_fk
      FOREIGN KEY (business_account_id) REFERENCES public.business_accounts(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4) NEW COLUMNS on existing tables (all NOT NULL ones carry a DEFAULT)
-- ---------------------------------------------------------------------

ALTER TABLE public.business_accounts
    ADD COLUMN IF NOT EXISTS topscholar_content_db_name text,
    ADD COLUMN IF NOT EXISTS topscholar_content_db_index text,
    ADD COLUMN IF NOT EXISTS topscholar_auto_sync_enabled text DEFAULT 'false'::text NOT NULL,
    ADD COLUMN IF NOT EXISTS topscholar_sync_mode text DEFAULT 'full'::text NOT NULL,
    ADD COLUMN IF NOT EXISTS topscholar_sync_interval_minutes integer DEFAULT 1440 NOT NULL,
    ADD COLUMN IF NOT EXISTS topscholar_last_auto_sync_at timestamp without time zone;

ALTER TABLE public.topscholar_content_sync
    ADD COLUMN IF NOT EXISTS sync_mode text DEFAULT 'full'::text NOT NULL,
    ADD COLUMN IF NOT EXISTS store_type text DEFAULT 'pgvector'::text NOT NULL,
    ADD COLUMN IF NOT EXISTS processed_count integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS total_count integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS embed_job_id character varying;

ALTER TABLE public.topscholar_cp_mappings
    ADD COLUMN IF NOT EXISTS cp_name text,
    ADD COLUMN IF NOT EXISTS plan_id text;

COMMIT;

-- =====================================================================
-- Post-run verification (optional):
--   SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public'
--     AND table_name IN ('topscholar_embed_jobs','topscholar_embed_staging','topscholar_plan_ids');
--   -- expect 3
--
-- Items deliberately EXCLUDED (handle on purpose, not as part of this add):
--   * whatsapp_leads has loan_amount / loan_type / address in PROD that dev
--     dropped. This script does NOT remove them. Removing them is destructive
--     and should be a separate, reviewed decision.
--   * demo_orders.amount is numeric in prod vs numeric(10,2) in dev. To align:
--       ALTER TABLE public.demo_orders
--         ALTER COLUMN amount TYPE numeric(10,2) USING amount::numeric(10,2);
--     (rounds to 2 decimals; fails if any existing value exceeds 8 integer digits).
-- =====================================================================
