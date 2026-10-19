CREATE TABLE IF NOT EXISTS "tutor_business_settings" (
	"business_account_id" varchar PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"daily_minutes_per_student" integer DEFAULT 20 NOT NULL,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tutor_lesson_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"cp_ids_hash" varchar(64) NOT NULL,
	"chapter_norm" text NOT NULL,
	"language" varchar(16) NOT NULL,
	"version_key" text NOT NULL,
	"part" varchar(64) NOT NULL,
	"plan_json" jsonb NOT NULL,
	"model" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tutor_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"conversation_id" varchar,
	"student_key" text NOT NULL,
	"cp_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chapter" text,
	"mode" varchar(10) DEFAULT 'voice' NOT NULL,
	"kind" varchar(10) DEFAULT 'lesson' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"seconds_active" integer DEFAULT 0 NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checks_correct" integer DEFAULT 0 NOT NULL,
	"checks_total" integer DEFAULT 0 NOT NULL,
	"end_reason" varchar(32)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tutor_usage_daily" (
	"business_account_id" varchar NOT NULL,
	"student_key" text NOT NULL,
	"day" varchar(10) NOT NULL,
	"seconds_used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_business_settings" ADD CONSTRAINT "tutor_business_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_lesson_plans" ADD CONSTRAINT "tutor_lesson_plans_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_sessions" ADD CONSTRAINT "tutor_sessions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tutor_usage_daily" ADD CONSTRAINT "tutor_usage_daily_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tutor_lesson_plans_unique_idx" ON "tutor_lesson_plans" USING btree ("business_account_id","cp_ids_hash","chapter_norm","language","version_key","part");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tutor_sessions_student_idx" ON "tutor_sessions" USING btree ("business_account_id","student_key","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tutor_usage_daily_unique_idx" ON "tutor_usage_daily" USING btree ("business_account_id","student_key","day");