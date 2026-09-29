ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "leadsquared_sync_status" text;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "leadsquared_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "leadsquared_lead_id" text;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "leadsquared_sync_error" text;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "leadsquared_sync_payload" jsonb;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "leadsquared_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "leadsquared_next_retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "salesforce_sync_status" text;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "salesforce_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "salesforce_lead_id" text;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "salesforce_sync_error" text;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "salesforce_sync_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "custom_crm_sync_status" text;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "custom_crm_lead_id" text;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "custom_crm_sync_error" text;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "custom_crm_sync_payload" jsonb;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD COLUMN IF NOT EXISTS "custom_crm_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "leadsquared_sync_status" text;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "leadsquared_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "leadsquared_lead_id" text;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "leadsquared_sync_error" text;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "leadsquared_sync_payload" jsonb;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "leadsquared_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "leadsquared_next_retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "salesforce_sync_status" text;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "salesforce_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "salesforce_lead_id" text;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "salesforce_sync_error" text;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "salesforce_sync_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "custom_crm_sync_status" text;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "custom_crm_lead_id" text;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "custom_crm_sync_error" text;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "custom_crm_sync_payload" jsonb;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD COLUMN IF NOT EXISTS "custom_crm_synced_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facebook_leads_lsq_retry_idx" ON "facebook_leads" USING btree ("leadsquared_sync_status","leadsquared_next_retry_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facebook_leads_custom_crm_status_idx" ON "facebook_leads" USING btree ("custom_crm_sync_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instagram_leads_lsq_retry_idx" ON "instagram_leads" USING btree ("leadsquared_sync_status","leadsquared_next_retry_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instagram_leads_custom_crm_status_idx" ON "instagram_leads" USING btree ("custom_crm_sync_status");