ALTER TABLE "tutor_business_settings" ADD COLUMN IF NOT EXISTS "teacher_name" text;--> statement-breakpoint
ALTER TABLE "tutor_business_settings" ADD COLUMN IF NOT EXISTS "voice_by_language" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tutor_business_settings" ADD COLUMN IF NOT EXISTS "avatar_mode" varchar(16) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "tutor_business_settings" ADD COLUMN IF NOT EXISTS "avatar_id" varchar(200);