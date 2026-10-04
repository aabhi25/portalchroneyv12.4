CREATE TABLE IF NOT EXISTS "ai_call_do_not_call" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"phone" text NOT NULL,
	"reason" text,
	"source" varchar(24) DEFAULT 'staff' NOT NULL,
	"call_id" varchar,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_calling_settings" (
	"business_account_id" varchar PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" varchar(32) DEFAULT 'simulator' NOT NULL,
	"exotel_account_sid" text,
	"exotel_subdomain" text DEFAULT 'api.in.exotel.com' NOT NULL,
	"exotel_caller_id" text,
	"exotel_flow_app_id" text,
	"exotel_api_key" jsonb,
	"exotel_api_token" jsonb,
	"exotel_verified_at" timestamp,
	"inbound_key" varchar(64),
	"public_base_url" text,
	"auto_call_leads" boolean DEFAULT false NOT NULL,
	"auto_call_delay_minutes" integer DEFAULT 2 NOT NULL,
	"auto_call_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consent_mode" varchar(32) DEFAULT 'explicit' NOT NULL,
	"consent_attested_at" timestamp,
	"consent_attested_by" varchar,
	"calling_hours" jsonb,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"retry_gap_minutes" integer DEFAULT 120 NOT NULL,
	"max_call_minutes" integer DEFAULT 5 NOT NULL,
	"monthly_minute_limit" integer,
	"concurrent_call_limit" integer DEFAULT 2 NOT NULL,
	"record_calls" boolean DEFAULT true NOT NULL,
	"transfer_number" text,
	"call_purpose" text,
	"opening_line" text,
	"inbound_greeting" text,
	"whatsapp_follow_up" boolean DEFAULT false NOT NULL,
	"whatsapp_follow_up_template_id" varchar,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_calls" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"direction" varchar(16) NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"trigger" varchar(24) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"phone" text NOT NULL,
	"caller_id" text,
	"lead_id" varchar,
	"conversation_id" varchar,
	"provider_call_sid" text,
	"provider_stream_sid" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"parent_call_id" varchar,
	"scheduled_at" timestamp,
	"claimed_at" timestamp,
	"started_at" timestamp,
	"answered_at" timestamp,
	"ended_at" timestamp,
	"duration_sec" integer,
	"billed_seconds" integer,
	"recording_url" text,
	"outcome" varchar(32),
	"outcome_note" text,
	"summary" text,
	"captured_fields" jsonb,
	"callback_at" timestamp,
	"end_reason" text,
	"transferred" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"follow_up_sent_at" timestamp,
	"post_processed_at" timestamp,
	"requested_by" varchar,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "ai_calling_enabled" text DEFAULT 'false' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "call_consent" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "call_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "call_consent_source" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_do_not_call" ADD CONSTRAINT "ai_call_do_not_call_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_calling_settings" ADD CONSTRAINT "ai_calling_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_call_dnc_biz_phone_unique" ON "ai_call_do_not_call" USING btree ("business_account_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_calling_settings_inbound_key_idx" ON "ai_calling_settings" USING btree ("inbound_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_calls_biz_created_idx" ON "ai_calls" USING btree ("business_account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_calls_status_scheduled_idx" ON "ai_calls" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_calls_lead_idx" ON "ai_calls" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_calls_provider_sid_idx" ON "ai_calls" USING btree ("provider","provider_call_sid");