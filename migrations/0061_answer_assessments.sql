CREATE TABLE IF NOT EXISTS "answer_assessments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"title" text NOT NULL,
	"mock_test_id" text,
	"board" text,
	"medium" text,
	"grade" text,
	"subject" text,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answer_papers" ADD COLUMN IF NOT EXISTS "assessment_id" varchar;--> statement-breakpoint
ALTER TABLE "answer_papers" ADD COLUMN IF NOT EXISTS "roll_no" text;--> statement-breakpoint
ALTER TABLE "answer_papers" ADD COLUMN IF NOT EXISTS "page_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_assessments" ADD CONSTRAINT "answer_assessments_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_assessments_account_idx" ON "answer_assessments" USING btree ("business_account_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_papers" ADD CONSTRAINT "answer_papers_assessment_id_answer_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."answer_assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_papers_assessment_idx" ON "answer_papers" USING btree ("assessment_id");