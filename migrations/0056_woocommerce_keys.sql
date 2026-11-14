ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "woo_read_mode" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "woo_consumer_key" text;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "woo_consumer_secret" text;