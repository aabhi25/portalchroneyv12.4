ALTER TABLE "ai_calling_settings" ADD COLUMN IF NOT EXISTS "plivo_auth_id" text;--> statement-breakpoint
ALTER TABLE "ai_calling_settings" ADD COLUMN IF NOT EXISTS "plivo_auth_token" jsonb;--> statement-breakpoint
ALTER TABLE "ai_calling_settings" ADD COLUMN IF NOT EXISTS "plivo_number" text;--> statement-breakpoint
ALTER TABLE "ai_calling_settings" ADD COLUMN IF NOT EXISTS "plivo_verified_at" timestamp;