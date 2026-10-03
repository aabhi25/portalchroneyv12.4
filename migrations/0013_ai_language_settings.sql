CREATE TABLE IF NOT EXISTS "ai_language_settings" (
	"business_account_id" varchar PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_language_settings_business_account_id_business_accounts_id_fk') THEN
		ALTER TABLE "ai_language_settings" ADD CONSTRAINT "ai_language_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
