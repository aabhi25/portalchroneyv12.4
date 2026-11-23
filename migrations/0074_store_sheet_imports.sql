-- Dealers & Stores: what each upload in the LOS layout changed, and the stores' values before it, for undo.
CREATE TABLE IF NOT EXISTS "store_sheet_imports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_name" text,
	"undone_at" timestamp,
	"undone_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_sheet_imports" ADD CONSTRAINT "store_sheet_imports_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_sheet_imports_account_idx" ON "store_sheet_imports" USING btree ("business_account_id","created_at");