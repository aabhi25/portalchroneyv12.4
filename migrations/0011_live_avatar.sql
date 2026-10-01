CREATE TABLE IF NOT EXISTS "avatar_business_settings" (
	"business_account_id" varchar PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" varchar(32) DEFAULT 'heygen_liveavatar' NOT NULL,
	"avatar_id" text,
	"provider_options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display_name" varchar(80),
	"style_hint" varchar(20) DEFAULT 'realistic' NOT NULL,
	"disclosure_enabled" boolean DEFAULT true NOT NULL,
	"disclosure_text" text,
	"monthly_minute_cap" integer DEFAULT 60 NOT NULL,
	"max_concurrent_sessions" integer DEFAULT 2 NOT NULL,
	"max_session_minutes" integer DEFAULT 10 NOT NULL,
	"idle_timeout_seconds" integer DEFAULT 60 NOT NULL,
	"api_keys" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allow_platform_key" boolean DEFAULT false NOT NULL,
	"voice_note" text,
	"commercial_notes" text,
	"parental_consent_confirmed" boolean DEFAULT false NOT NULL,
	"parental_consent_confirmed_by" varchar,
	"parental_consent_confirmed_at" timestamp,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "avatar_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"conversation_id" varchar,
	"visitor_id" varchar(255),
	"provider" varchar(32) NOT NULL,
	"provider_session_id" text,
	"status" varchar(16) DEFAULT 'starting' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"connected_at" timestamp,
	"last_heartbeat_at" timestamp,
	"ended_at" timestamp,
	"billed_seconds" integer DEFAULT 0 NOT NULL,
	"end_reason" varchar(40),
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'avatar_business_settings_business_account_id_business_accounts_id_fk') THEN
		ALTER TABLE "avatar_business_settings" ADD CONSTRAINT "avatar_business_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'avatar_sessions_business_account_id_business_accounts_id_fk') THEN
		ALTER TABLE "avatar_sessions" ADD CONSTRAINT "avatar_sessions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avatar_sessions_business_started_idx" ON "avatar_sessions" USING btree ("business_account_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avatar_sessions_open_idx" ON "avatar_sessions" USING btree ("business_account_id") WHERE "avatar_sessions"."ended_at" is null;