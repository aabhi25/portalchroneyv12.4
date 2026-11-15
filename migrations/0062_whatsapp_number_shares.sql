CREATE TABLE IF NOT EXISTS "whatsapp_number_shares" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_account_id" varchar NOT NULL,
	"linked_account_id" varchar NOT NULL,
	"tag" varchar(16) NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_handoffs" ADD COLUMN IF NOT EXISTS "page_url" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_number_shares" ADD CONSTRAINT "whatsapp_number_shares_owner_account_id_business_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_number_shares" ADD CONSTRAINT "whatsapp_number_shares_linked_account_id_business_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_number_shares_linked_idx" ON "whatsapp_number_shares" USING btree ("linked_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_number_shares_tag_idx" ON "whatsapp_number_shares" USING btree ("tag");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_number_shares_owner_idx" ON "whatsapp_number_shares" USING btree ("owner_account_id");
