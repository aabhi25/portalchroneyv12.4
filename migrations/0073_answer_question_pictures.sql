ALTER TABLE "answer_check_images" ADD COLUMN IF NOT EXISTS "question_key" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "answer_check_images_question_idx" ON "answer_check_images" USING btree ("business_account_id","question_key");
