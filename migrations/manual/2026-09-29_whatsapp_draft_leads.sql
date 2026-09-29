-- Draft WhatsApp leads until a valid PAN + email are collected (per account setting).
-- The server also adds these at startup (server/init.ts); running them by hand is optional.
ALTER TABLE public.whatsapp_settings ADD COLUMN IF NOT EXISTS require_pan_email_for_lead text NOT NULL DEFAULT 'false';
ALTER TABLE public.whatsapp_leads ADD COLUMN IF NOT EXISTS qualified_at timestamp;
