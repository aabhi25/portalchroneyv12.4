ALTER TABLE "contact_groups" ADD COLUMN IF NOT EXISTS "audience_type" text DEFAULT 'static' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_groups" ADD COLUMN IF NOT EXISTS "rules" jsonb;--> statement-breakpoint
ALTER TABLE "contact_groups" ADD COLUMN IF NOT EXISTS "last_refreshed_at" timestamp;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbooks" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbooks" ADD COLUMN IF NOT EXISTS "editing_heartbeat_at" timestamp;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "status_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "status_source" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_opt_outs_business_phone_idx" ON "whatsapp_opt_outs" USING btree ("business_account_id","phone");
