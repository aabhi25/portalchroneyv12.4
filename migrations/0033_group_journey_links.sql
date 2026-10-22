ALTER TABLE "account_group_journey_steps" ADD COLUMN IF NOT EXISTS "crm_field_key" text;--> statement-breakpoint
ALTER TABLE "account_group_journeys" ADD COLUMN IF NOT EXISTS "end_mode" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_journeys" ADD COLUMN IF NOT EXISTS "group_journey_id" varchar;--> statement-breakpoint
ALTER TABLE "journey_steps" ADD COLUMN IF NOT EXISTS "group_step_id" varchar;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_journeys_group_journey_idx" ON "conversation_journeys" USING btree ("group_journey_id");