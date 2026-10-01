CREATE TABLE IF NOT EXISTS "whatsapp_handoffs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"code" varchar(12) NOT NULL,
	"source" varchar(20) NOT NULL,
	"conversation_id" varchar,
	"visitor_token" text,
	"website_lead_id" varchar,
	"product_id" varchar,
	"topic" text,
	"target_number" varchar(20),
	"connected_number" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"last_used_at" timestamp,
	"whatsapp_phone" varchar(20),
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_identities" ADD COLUMN IF NOT EXISTS "verified_phone" varchar;--> statement-breakpoint
ALTER TABLE "customer_identities" ADD COLUMN IF NOT EXISTS "verified_via" varchar;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_handoffs_business_account_id_business_accounts_id_fk') THEN
		ALTER TABLE "whatsapp_handoffs" ADD CONSTRAINT "whatsapp_handoffs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_handoffs_conversation_id_conversations_id_fk') THEN
		ALTER TABLE "whatsapp_handoffs" ADD CONSTRAINT "whatsapp_handoffs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_handoffs_website_lead_id_leads_id_fk') THEN
		ALTER TABLE "whatsapp_handoffs" ADD CONSTRAINT "whatsapp_handoffs_website_lead_id_leads_id_fk" FOREIGN KEY ("website_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_handoffs_business_code_idx" ON "whatsapp_handoffs" USING btree ("business_account_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_handoffs_business_created_idx" ON "whatsapp_handoffs" USING btree ("business_account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_handoffs_business_phone_idx" ON "whatsapp_handoffs" USING btree ("business_account_id","whatsapp_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_handoffs_conversation_idx" ON "whatsapp_handoffs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_handoffs_website_lead_idx" ON "whatsapp_handoffs" USING btree ("website_lead_id");
