ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS leads_export_enabled text NOT NULL DEFAULT 'false';