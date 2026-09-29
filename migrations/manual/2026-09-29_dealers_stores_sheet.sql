-- Dealers & Stores sheet. The server also adds these at startup (server/init.ts).
ALTER TABLE public.crm_store_credentials ADD COLUMN IF NOT EXISTS display_dealer_name text;
ALTER TABLE public.crm_store_credentials ADD COLUMN IF NOT EXISTS display_store_name text;
ALTER TABLE public.crm_store_credentials ADD COLUMN IF NOT EXISTS emi_schemes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.crm_store_credentials ADD COLUMN IF NOT EXISTS show_in_journey boolean NOT NULL DEFAULT true;
ALTER TABLE public.whatsapp_settings ADD COLUMN IF NOT EXISTS store_sheet_enabled text NOT NULL DEFAULT 'false';
