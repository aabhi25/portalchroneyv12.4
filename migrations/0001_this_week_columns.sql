ALTER TABLE "crm_store_credentials" ADD COLUMN IF NOT EXISTS "display_dealer_name" text;--> statement-breakpoint
ALTER TABLE "crm_store_credentials" ADD COLUMN IF NOT EXISTS "display_store_name" text;--> statement-breakpoint
ALTER TABLE "crm_store_credentials" ADD COLUMN IF NOT EXISTS "emi_schemes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_store_credentials" ADD COLUMN IF NOT EXISTS "show_in_journey" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "processed_at" timestamp;--> statement-breakpoint
ALTER TABLE "whatsapp_leads" ADD COLUMN IF NOT EXISTS "qualified_at" timestamp;--> statement-breakpoint
ALTER TABLE "whatsapp_settings" ADD COLUMN IF NOT EXISTS "require_pan_email_for_lead" text DEFAULT 'false' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_settings" ADD COLUMN IF NOT EXISTS "store_sheet_enabled" text DEFAULT 'false' NOT NULL;