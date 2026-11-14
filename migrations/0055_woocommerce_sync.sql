ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "woocommerce_enabled" text DEFAULT 'false' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "external_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "product_url" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_status" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "regular_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sku" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "external_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "woo_store_url" text;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "woo_connected" text DEFAULT 'false' NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "woo_sync_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "woo_sync_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "woo_sync_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "woo_last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN IF NOT EXISTS "woo_last_result" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_business_source_external_idx" ON "products" USING btree ("business_account_id","source","external_id");