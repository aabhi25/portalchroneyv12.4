-- Data retention (auto-delete) for groups and accounts.
-- Policies, deletion records (tombstones, no personal data) and per-account worker status.
-- Also applied automatically at startup by server/init.ts.
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
CREATE UNIQUE INDEX IF NOT EXISTS data_retention_policies_scope_idx ON public.data_retention_policies (scope_type, scope_id);
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
CREATE INDEX IF NOT EXISTS data_purge_log_account_captured_idx ON public.data_purge_log (business_account_id, record_type, captured_at);
CREATE INDEX IF NOT EXISTS data_purge_log_account_purged_idx ON public.data_purge_log (business_account_id, purged_at);
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
