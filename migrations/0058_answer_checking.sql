CREATE TABLE IF NOT EXISTS "answer_check_images" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"storage_ref" text,
	"data" "bytea",
	"content_type" text DEFAULT 'image/jpeg' NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "answer_check_settings" (
	"business_account_id" varchar PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "answer_checks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"scheme_id" varchar,
	"question_key" text NOT NULL,
	"batch_id" varchar,
	"status" text DEFAULT 'checking' NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"practice_level" text,
	"practice_text" text,
	"expected_marks" numeric(5, 1),
	"student_label" text DEFAULT '' NOT NULL,
	"max_marks" numeric(5, 1) NOT NULL,
	"read_text" text,
	"reading" jsonb,
	"result" jsonb,
	"ai_marks" numeric(5, 1),
	"ai_written" jsonb,
	"teacher_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"teacher_marks" numeric(5, 1),
	"teacher_comment" text,
	"teacher_by" varchar,
	"teacher_at" timestamp,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"cost_usd" numeric(10, 5) DEFAULT '0' NOT NULL,
	"duration_ms" integer,
	"error" text,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "answer_marking_schemes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"question_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'custom' NOT NULL,
	"question_text" text NOT NULL,
	"model_answer" text DEFAULT '' NOT NULL,
	"model_answer_by_ai" boolean DEFAULT false NOT NULL,
	"question_kind" text,
	"board" text,
	"medium" text,
	"grade" text,
	"subject" text,
	"chapter" text,
	"max_marks" numeric(5, 1) NOT NULL,
	"scheme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'ai_draft' NOT NULL,
	"created_by" varchar,
	"approved_by" varchar,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_check_images" ADD CONSTRAINT "answer_check_images_check_id_answer_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."answer_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_check_settings" ADD CONSTRAINT "answer_check_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_checks" ADD CONSTRAINT "answer_checks_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_checks" ADD CONSTRAINT "answer_checks_scheme_id_answer_marking_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."answer_marking_schemes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_marking_schemes" ADD CONSTRAINT "answer_marking_schemes_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_check_images_check_idx" ON "answer_check_images" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_checks_account_created_idx" ON "answer_checks" USING btree ("business_account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_checks_question_idx" ON "answer_checks" USING btree ("business_account_id","question_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_checks_batch_idx" ON "answer_checks" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "answer_marking_schemes_question_version_idx" ON "answer_marking_schemes" USING btree ("business_account_id","question_key","version");