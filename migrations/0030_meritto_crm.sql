CREATE TABLE "meritto_field_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"meritto_field" text NOT NULL,
	"source_type" text NOT NULL,
	"source_field" text,
	"custom_value" text,
	"fallback_value" text,
	"display_name" text NOT NULL,
	"is_enabled" text DEFAULT 'true' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "meritto_sync_status" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "meritto_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "meritto_lead_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "meritto_sync_error" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "meritto_sync_payload" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "meritto_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "meritto_next_retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN "meritto_enabled" text DEFAULT 'false' NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN "meritto_access_key" text;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN "meritto_secret_key" text;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN "meritto_create_url" text;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN "meritto_update_url" text;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD COLUMN "meritto_enabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "meritto_field_mappings" ADD CONSTRAINT "meritto_field_mappings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meritto_field_mappings_business_idx" ON "meritto_field_mappings" USING btree ("business_account_id");