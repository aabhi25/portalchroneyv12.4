ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "custom_domain" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "domain_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "domain_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "domain_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "domain_check_message" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "logo_data" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "logo_updated_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agencies" ADD CONSTRAINT "agencies_custom_domain_unique" UNIQUE("custom_domain");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
