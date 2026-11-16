ALTER TABLE "whatsapp_leads" ADD COLUMN IF NOT EXISTS "leadsquared_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "whatsapp_leads" ADD COLUMN IF NOT EXISTS "leadsquared_sync_payload" jsonb;--> statement-breakpoint
ALTER TABLE "whatsapp_leads" ADD COLUMN IF NOT EXISTS "leadsquared_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_leads" ADD COLUMN IF NOT EXISTS "leadsquared_next_retry_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_leads_lsq_retry_idx" ON "whatsapp_leads" USING btree ("leadsquared_sync_status","leadsquared_next_retry_at");
