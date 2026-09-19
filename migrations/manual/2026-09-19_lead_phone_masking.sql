ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS lead_phone_masking_enabled text NOT NULL DEFAULT 'false';