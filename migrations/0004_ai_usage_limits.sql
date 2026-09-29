CREATE TABLE IF NOT EXISTS "ai_usage_limits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"monthly_limit_usd" numeric(12, 2) NOT NULL,
	"warn_at_percent" integer DEFAULT 80 NOT NULL,
	"action" text DEFAULT 'warn' NOT NULL,
	"warn_notified_month" text,
	"limit_notified_month" text,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_limits_business_account_id_unique" UNIQUE("business_account_id")
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_limits_business_account_id_business_accounts_id_fk') THEN
		ALTER TABLE "ai_usage_limits" ADD CONSTRAINT "ai_usage_limits_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
