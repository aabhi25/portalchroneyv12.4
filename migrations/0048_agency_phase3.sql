CREATE TABLE IF NOT EXISTS "agency_credit_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" varchar NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency_packages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"monthly_limit_usd" numeric(12, 2),
	"max_logins" integer,
	"price" numeric(12, 2),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A business account may now have several logins (the main one is account_role 'owner').
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_business_account_id_unique";--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "max_logins_per_client" integer;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "credits_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "credits_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "credit_low_threshold" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "email_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "agency_package_id" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "account_role" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_credit_entries" ADD CONSTRAINT "agency_credit_entries_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_packages" ADD CONSTRAINT "agency_packages_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_credit_entries_agency_idx" ON "agency_credit_entries" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_packages_agency_idx" ON "agency_packages" USING btree ("agency_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_accounts" ADD CONSTRAINT "business_accounts_agency_package_id_agency_packages_id_fk" FOREIGN KEY ("agency_package_id") REFERENCES "public"."agency_packages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_business_account_idx" ON "users" USING btree ("business_account_id");
