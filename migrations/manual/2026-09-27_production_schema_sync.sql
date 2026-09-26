-- ============================================================================
-- Production schema sync — 2026-09-27
--
-- Brings the AWS production database in line with the code on main.
-- Source of truth for the diff: production backup 2026-09-25 04:00 (schema only)
-- compared with the code's schema (shared/schema.ts + startup DDL in server/init.ts).
--
-- ONLY ADDS things. Nothing is dropped, renamed or retyped, and every statement
-- is safe to run more than once. Run it with psql as a user that can ALTER/CREATE:
--
--   psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/manual/2026-09-27_production_schema_sync.sql
--
-- Run section 0 first (read-only checks). If a check returns rows, fix those
-- rows before running section 3 — the rest is unaffected.
--
-- Left untouched on purpose (production-only, still in use):
--   whatsapp_leads.loan_amount / loan_type / address, the whatsapp_settings
--   extraction_fields default, topscholar_content_chunks.board / medium / grade,
--   and the indexes/foreign key that go with them.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. PRE-CHECKS (read-only). Each should return 0 rows / 0.
-- ----------------------------------------------------------------------------

-- 0a. Duplicate MSG91 templates would block the unique index in section 3.
SELECT business_account_id, source_whatsapp_number, name, language, count(*) AS copies
FROM public.whatsapp_templates
WHERE source_type = 'msg91' AND source_whatsapp_number IS NOT NULL
GROUP BY 1, 2, 3, 4
HAVING count(*) > 1;

-- 0b. Automations pointing at campaigns that no longer exist (blocks VALIDATE in section 3).
SELECT count(*) AS orphan_automations
FROM public.whatsapp_campaign_automations a
WHERE a.source_campaign_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.marketing_campaigns m WHERE m.id = a.source_campaign_id);


BEGIN;

-- ----------------------------------------------------------------------------
-- 1. New columns (features shipped 2026-09-26). Defaults keep today's behaviour.
-- ----------------------------------------------------------------------------

-- Group admins: "Sync Leads" and "Delete" permissions (off by default).
ALTER TABLE public.account_group_admins
  ADD COLUMN IF NOT EXISTS can_sync_leads text NOT NULL DEFAULT 'false',
  ADD COLUMN IF NOT EXISTS can_delete_data text NOT NULL DEFAULT 'false';

-- LeadSquared Universal Data Sync (UDS) option ('api' = current behaviour).
ALTER TABLE public.widget_settings
  ADD COLUMN IF NOT EXISTS leadsquared_connection_type text NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS leadsquared_uds_webhook_url text,
  ADD COLUMN IF NOT EXISTS leadsquared_uds_key text;

ALTER TABLE public.account_group_training
  ADD COLUMN IF NOT EXISTS leadsquared_connection_type text NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS leadsquared_uds_webhook_url text,
  ADD COLUMN IF NOT EXISTS leadsquared_uds_key text;


-- ----------------------------------------------------------------------------
-- 2. New tables: auto-delete (data retention). Nothing happens until a super
--    admin turns a policy on.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.data_retention_policies (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL,
  scope_id varchar NOT NULL,
  mode text NOT NULL DEFAULT 'off',
  delete_synced_after_minutes integer NOT NULL DEFAULT 1440,
  delete_unsynced_after_minutes integer,
  delete_idle_chats_after_minutes integer DEFAULT 1440,
  keep_anonymous_counts boolean NOT NULL DEFAULT true,
  updated_by varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS data_retention_policies_scope_idx
  ON public.data_retention_policies (scope_type, scope_id);

CREATE TABLE IF NOT EXISTS public.data_purge_log (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id varchar NOT NULL,
  record_type text NOT NULL,
  record_id varchar NOT NULL,
  captured_at timestamp,
  purged_at timestamp NOT NULL DEFAULT now(),
  reason text NOT NULL,
  synced boolean NOT NULL DEFAULT false,
  synced_at timestamp,
  crm_lead_id text,
  source text,
  is_discount boolean NOT NULL DEFAULT false,
  is_paid boolean NOT NULL DEFAULT false,
  count_in_analytics boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS data_purge_log_account_captured_idx
  ON public.data_purge_log (business_account_id, record_type, captured_at);
CREATE INDEX IF NOT EXISTS data_purge_log_account_purged_idx
  ON public.data_purge_log (business_account_id, purged_at);

CREATE TABLE IF NOT EXISTS public.data_retention_account_status (
  business_account_id varchar PRIMARY KEY,
  mode text NOT NULL,
  last_run_at timestamp NOT NULL,
  due_leads integer NOT NULL DEFAULT 0,
  due_conversations integer NOT NULL DEFAULT 0,
  last_purged_leads integer NOT NULL DEFAULT 0,
  last_purged_conversations integer NOT NULL DEFAULT 0,
  last_error text
);

COMMIT;


-- ----------------------------------------------------------------------------
-- 3. Items in the code since late August that never reached production.
--    Run after section 0 comes back clean.
-- ----------------------------------------------------------------------------

-- WhatsApp templates (code change 2026-08-30).
CREATE INDEX IF NOT EXISTS whatsapp_templates_business_active_idx
  ON public.whatsapp_templates USING btree (business_account_id, deleted_at);
CREATE INDEX IF NOT EXISTS whatsapp_templates_business_source_number_idx
  ON public.whatsapp_templates USING btree (business_account_id, source_type, source_whatsapp_number);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_msg91_scoped_identity_unique
  ON public.whatsapp_templates USING btree (business_account_id, source_whatsapp_number, name, language)
  WHERE ((source_type = 'msg91'::text) AND (source_whatsapp_number IS NOT NULL));

-- Campaign automations → source campaign (code change 2026-08-25).
-- Added NOT VALID first (instant, no full-table check, enforced for new rows),
-- then validated; if 0b found orphans, fix them and re-run the VALIDATE line.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_campaign_automations_source_campaign_id_marketing_camp'
  ) THEN
    ALTER TABLE public.whatsapp_campaign_automations
      ADD CONSTRAINT whatsapp_campaign_automations_source_campaign_id_marketing_camp
      FOREIGN KEY (source_campaign_id) REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
ALTER TABLE public.whatsapp_campaign_automations
  VALIDATE CONSTRAINT whatsapp_campaign_automations_source_campaign_id_marketing_camp;
