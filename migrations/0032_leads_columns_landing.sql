ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "leads_table_columns" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "landing_url" text;