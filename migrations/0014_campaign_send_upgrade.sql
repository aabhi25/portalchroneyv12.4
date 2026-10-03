CREATE TABLE IF NOT EXISTS "marketing_campaign_follow_up_sends" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follow_up_id" varchar NOT NULL,
	"campaign_id" varchar NOT NULL,
	"recipient_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"msg91_message_id" text,
	"error_message" text,
	"send_phone" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketing_campaign_follow_ups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"step_number" integer DEFAULT 1 NOT NULL,
	"delay_hours" integer DEFAULT 24 NOT NULL,
	"template_id" varchar NOT NULL,
	"template_params" jsonb DEFAULT '[]'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketing_campaign_test_sends" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"campaign_id" varchar,
	"template_id" varchar,
	"user_id" varchar,
	"phone" text NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"msg91_message_id" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD COLUMN IF NOT EXISTS "variant" text;
--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD COLUMN IF NOT EXISTS "dispatched_at" timestamp;
--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "quiet_hours_start" text;
--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "quiet_hours_end" text;
--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "quiet_hours_timezone" text;
--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "pause_reason" text;
--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "paused_at" timestamp;
--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "variant_b_template_id" varchar;
--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "variant_b_template_params" jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "variant_split_percent" integer;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_campaign_follow_up_sends" ADD CONSTRAINT "marketing_campaign_follow_up_sends_follow_up_id_marketing_campaign_follow_ups_id_fk" FOREIGN KEY ("follow_up_id") REFERENCES "public"."marketing_campaign_follow_ups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_campaign_follow_up_sends" ADD CONSTRAINT "marketing_campaign_follow_up_sends_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_campaign_follow_up_sends" ADD CONSTRAINT "marketing_campaign_follow_up_sends_recipient_id_marketing_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."marketing_campaign_recipients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_campaign_follow_up_sends" ADD CONSTRAINT "marketing_campaign_follow_up_sends_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_campaign_follow_ups" ADD CONSTRAINT "marketing_campaign_follow_ups_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_campaign_follow_ups" ADD CONSTRAINT "marketing_campaign_follow_ups_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_campaign_follow_ups" ADD CONSTRAINT "marketing_campaign_follow_ups_template_id_whatsapp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."whatsapp_templates"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_campaign_test_sends" ADD CONSTRAINT "marketing_campaign_test_sends_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_campaign_test_sends" ADD CONSTRAINT "marketing_campaign_test_sends_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_campaign_test_sends" ADD CONSTRAINT "marketing_campaign_test_sends_template_id_whatsapp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."whatsapp_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mkt_follow_up_sends_step_recipient_unique" ON "marketing_campaign_follow_up_sends" USING btree ("follow_up_id","recipient_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mkt_follow_up_sends_campaign_idx" ON "marketing_campaign_follow_up_sends" USING btree ("campaign_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mkt_follow_ups_campaign_step_unique" ON "marketing_campaign_follow_ups" USING btree ("campaign_id","step_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mkt_test_sends_biz_created_idx" ON "marketing_campaign_test_sends" USING btree ("business_account_id","created_at");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_variant_b_template_id_whatsapp_templates_id_fk" FOREIGN KEY ("variant_b_template_id") REFERENCES "public"."whatsapp_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_campaigns_status_idx" ON "marketing_campaigns" USING btree ("status");
