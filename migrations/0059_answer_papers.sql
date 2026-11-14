CREATE TABLE IF NOT EXISTS "answer_papers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"student_label" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'reading' NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reading" jsonb,
	"matching" jsonb,
	"practice" jsonb,
	"cost_usd" numeric(10, 5) DEFAULT '0' NOT NULL,
	"duration_ms" integer,
	"error" text,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answer_check_images" ALTER COLUMN "check_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "answer_check_images" ADD COLUMN IF NOT EXISTS "paper_id" varchar;--> statement-breakpoint
ALTER TABLE "answer_checks" ADD COLUMN IF NOT EXISTS "paper_id" varchar;--> statement-breakpoint
ALTER TABLE "answer_checks" ADD COLUMN IF NOT EXISTS "question_number" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_papers" ADD CONSTRAINT "answer_papers_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_papers_account_created_idx" ON "answer_papers" USING btree ("business_account_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_check_images" ADD CONSTRAINT "answer_check_images_paper_id_answer_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."answer_papers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_checks" ADD CONSTRAINT "answer_checks_paper_id_answer_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."answer_papers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_check_images_paper_idx" ON "answer_check_images" USING btree ("paper_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_checks_paper_idx" ON "answer_checks" USING btree ("paper_id");