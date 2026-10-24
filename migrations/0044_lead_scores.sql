ALTER TABLE "leads" ADD COLUMN "engagement_score" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lead_temperature" varchar(8);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lead_fit" varchar(10);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "scored_at" timestamp;--> statement-breakpoint
ALTER TABLE "whatsapp_leads" ADD COLUMN "engagement_score" integer;--> statement-breakpoint
ALTER TABLE "whatsapp_leads" ADD COLUMN "lead_temperature" varchar(8);--> statement-breakpoint
ALTER TABLE "whatsapp_leads" ADD COLUMN "lead_fit" varchar(10);--> statement-breakpoint
ALTER TABLE "whatsapp_leads" ADD COLUMN "score_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "whatsapp_leads" ADD COLUMN "scored_at" timestamp;