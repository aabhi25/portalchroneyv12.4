ALTER TABLE "facebook_settings" ADD COLUMN IF NOT EXISTS "token_invalid_at" timestamp;--> statement-breakpoint
ALTER TABLE "facebook_settings" ADD COLUMN IF NOT EXISTS "token_invalid_reason" text;--> statement-breakpoint
ALTER TABLE "instagram_settings" ADD COLUMN IF NOT EXISTS "token_invalid_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_settings" ADD COLUMN IF NOT EXISTS "token_invalid_reason" text;