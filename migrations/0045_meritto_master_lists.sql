CREATE TABLE IF NOT EXISTS "meritto_master_lists" (
	"business_account_id" varchar PRIMARY KEY NOT NULL,
	"sheet_url" text,
	"programs" jsonb,
	"cities" jsonb,
	"setup_backup" jsonb,
	"loaded_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meritto_master_lists" ADD CONSTRAINT "meritto_master_lists_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
