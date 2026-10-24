CREATE TABLE "lead_stories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"lead_key" varchar(80) NOT NULL,
	"website_lead_id" varchar,
	"whatsapp_lead_id" varchar,
	"story" jsonb NOT NULL,
	"last_event_at" timestamp,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_stories" ADD CONSTRAINT "lead_stories_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stories" ADD CONSTRAINT "lead_stories_website_lead_id_leads_id_fk" FOREIGN KEY ("website_lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stories" ADD CONSTRAINT "lead_stories_whatsapp_lead_id_whatsapp_leads_id_fk" FOREIGN KEY ("whatsapp_lead_id") REFERENCES "public"."whatsapp_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_stories_lead_unique" ON "lead_stories" USING btree ("business_account_id","lead_key");