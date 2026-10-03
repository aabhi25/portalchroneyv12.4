CREATE TABLE IF NOT EXISTS "whatsapp_campaign_automation_schedule_attempts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"run_date" text NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"outcome" text,
	"reason" text,
	"run_id" varchar,
	"eligible_rows" integer DEFAULT 0 NOT NULL,
	"claimed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automation_runs" ADD COLUMN IF NOT EXISTS "trigger" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automation_runs" ADD COLUMN IF NOT EXISTS "schedule_run_date" text;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automations" ADD COLUMN IF NOT EXISTS "schedule_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automations" ADD COLUMN IF NOT EXISTS "schedule_days" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automations" ADD COLUMN IF NOT EXISTS "schedule_activated_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_campaign_automation_schedule_attempts" ADD CONSTRAINT "whatsapp_campaign_automation_schedule_attempts_automation_id_whatsapp_campaign_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."whatsapp_campaign_automations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_campaign_automation_schedule_attempts" ADD CONSTRAINT "whatsapp_campaign_automation_schedule_attempts_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_campaign_automation_schedule_attempts" ADD CONSTRAINT "whatsapp_campaign_automation_schedule_attempts_run_id_whatsapp_campaign_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."whatsapp_campaign_automation_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_automation_schedule_attempts_automation_date_uniq" ON "whatsapp_campaign_automation_schedule_attempts" USING btree ("automation_id","run_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_automation_schedule_attempts_business_created_idx" ON "whatsapp_campaign_automation_schedule_attempts" USING btree ("business_account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_automation_schedule_attempts_status_idx" ON "whatsapp_campaign_automation_schedule_attempts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_automation_runs_automation_schedule_date_uniq" ON "whatsapp_campaign_automation_runs" USING btree ("automation_id","schedule_run_date");
