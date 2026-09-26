-- LeadSquared Universal Data Sync (UDS) connection option.
-- 'api' (default) keeps the current Lead.Capture API behaviour; 'uds' posts the
-- mapped lead fields as flat JSON to the client's UDS webhook with its ickey.
-- Also applied automatically at startup by server/init.ts.
ALTER TABLE public.widget_settings
  ADD COLUMN IF NOT EXISTS leadsquared_connection_type text NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS leadsquared_uds_webhook_url text,
  ADD COLUMN IF NOT EXISTS leadsquared_uds_key text;

ALTER TABLE public.account_group_training
  ADD COLUMN IF NOT EXISTS leadsquared_connection_type text NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS leadsquared_uds_webhook_url text,
  ADD COLUMN IF NOT EXISTS leadsquared_uds_key text;
