ALTER TABLE "ai_calling_settings" ADD COLUMN IF NOT EXISTS "assistant_name" text;--> statement-breakpoint
ALTER TABLE "ai_calling_settings" ADD COLUMN IF NOT EXISTS "speaking_speed" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_calling_settings" ADD COLUMN IF NOT EXISTS "background_sound" varchar(32) DEFAULT 'none' NOT NULL;