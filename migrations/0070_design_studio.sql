-- Design Studio (shared/designStudio.ts): shoppers design their own jewellery in the website chat.
-- A switch per account, the brand's design kit, and one row per design session (a request once the shopper asks for it to be made).
CREATE TABLE IF NOT EXISTS "design_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"conversation_id" varchar,
	"visitor_token" text,
	"lead_id" varchar,
	"choices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"designs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chosen_design_id" text,
	"price_low" integer,
	"price_high" integer,
	"render_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"request_note" text,
	"staff_notes" text,
	"page_url" text,
	"requested_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "design_studio_settings" (
	"business_account_id" varchar PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "design_studio_enabled" text DEFAULT 'false' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "design_sessions" ADD CONSTRAINT "design_sessions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "design_studio_settings" ADD CONSTRAINT "design_studio_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_sessions_account_created_idx" ON "design_sessions" USING btree ("business_account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_sessions_account_requested_idx" ON "design_sessions" USING btree ("business_account_id","requested_at");