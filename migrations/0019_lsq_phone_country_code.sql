ALTER TABLE "account_group_leadsquared_field_mappings" ADD COLUMN IF NOT EXISTS "phone_country_code" text;--> statement-breakpoint
ALTER TABLE "account_group_leadsquared_field_mappings" ADD COLUMN IF NOT EXISTS "phone_code_style" text;--> statement-breakpoint
ALTER TABLE "leadsquared_field_mappings" ADD COLUMN IF NOT EXISTS "phone_country_code" text;--> statement-breakpoint
ALTER TABLE "leadsquared_field_mappings" ADD COLUMN IF NOT EXISTS "phone_code_style" text;