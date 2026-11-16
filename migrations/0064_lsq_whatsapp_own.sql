ALTER TABLE "leadsquared_field_mappings" ADD COLUMN IF NOT EXISTS "channel" text DEFAULT 'website' NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "leadsquared_wa_connection" text DEFAULT 'same' NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "leadsquared_wa_mappings" text DEFAULT 'same' NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "leadsquared_wa_connection_type" text DEFAULT 'uds' NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "leadsquared_wa_uds_webhook_url" text;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "leadsquared_wa_uds_key" text;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "leadsquared_wa_access_key" text;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "leadsquared_wa_secret_key" text;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "leadsquared_wa_region" text;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "leadsquared_wa_custom_host" text;