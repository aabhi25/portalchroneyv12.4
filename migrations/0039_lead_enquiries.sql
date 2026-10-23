CREATE TABLE "lead_conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" varchar NOT NULL,
	"conversation_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_enquiry_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "enquiry_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_conversations" ADD CONSTRAINT "lead_conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_conversations" ADD CONSTRAINT "lead_conversations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_conversations" ADD CONSTRAINT "lead_conversations_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_conversations_lead_conv_idx" ON "lead_conversations" USING btree ("lead_id","conversation_id");--> statement-breakpoint
CREATE INDEX "lead_conversations_conversation_idx" ON "lead_conversations" USING btree ("conversation_id");