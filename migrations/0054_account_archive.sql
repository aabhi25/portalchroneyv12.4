ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "archive_unlocked_until" timestamp;