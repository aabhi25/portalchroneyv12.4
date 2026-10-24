ALTER TABLE "ai_calls" ADD COLUMN "follow_up_template" text;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "follow_up_message_id" varchar(128);--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "follow_up_status" varchar(16);--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "follow_up_delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "follow_up_read_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "follow_up_error" text;--> statement-breakpoint
CREATE INDEX "ai_calls_follow_up_msg_idx" ON "ai_calls" USING btree ("business_account_id","follow_up_message_id");--> statement-breakpoint
-- Follow-ups sent before this column existed show as "sent" (their delivery receipts weren't kept).
UPDATE "ai_calls" SET "follow_up_status" = 'sent' WHERE "follow_up_sent_at" IS NOT NULL AND "follow_up_status" IS NULL;--> statement-breakpoint
UPDATE "ai_calls" SET "follow_up_status" = 'failed', "follow_up_error" = "metadata"->>'followUpError'
  WHERE "follow_up_sent_at" IS NULL AND "follow_up_status" IS NULL AND "metadata" ? 'followUpError';
