ALTER TABLE "marketing_campaign_recipients" ADD COLUMN IF NOT EXISTS "ai_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD COLUMN IF NOT EXISTS "ai_paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD COLUMN IF NOT EXISTS "ai_paused_reason" text;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD COLUMN IF NOT EXISTS "needs_human" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD COLUMN IF NOT EXISTS "needs_human_reason" text;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD COLUMN IF NOT EXISTS "needs_human_at" timestamp;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD COLUMN IF NOT EXISTS "handover_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD COLUMN IF NOT EXISTS "staff_last_read_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mkt_recipients_biz_first_reply_idx" ON "marketing_campaign_recipients" USING btree ("business_account_id","first_reply_at");
