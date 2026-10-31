CREATE TABLE IF NOT EXISTS "agencies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"max_accounts" integer,
	"allowed_features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"monthly_ai_cap_usd" numeric(12, 2),
	"ai_cap_action" text DEFAULT 'block' NOT NULL,
	"ai_cap_warn_at_percent" integer DEFAULT 80 NOT NULL,
	"ai_cap_warn_notified_month" text,
	"ai_cap_limit_notified_month" text,
	"default_client_limit_usd" numeric(12, 2),
	"billing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency_admins" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agency_admins_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "agency_id" varchar;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_admins" ADD CONSTRAINT "agency_admins_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_admins" ADD CONSTRAINT "agency_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_admins_agency_idx" ON "agency_admins" USING btree ("agency_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_accounts" ADD CONSTRAINT "business_accounts_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_accounts_agency_idx" ON "business_accounts" USING btree ("agency_id");
