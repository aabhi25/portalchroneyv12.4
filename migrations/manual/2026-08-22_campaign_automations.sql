-- Reusable spreadsheet-to-WhatsApp campaign automations.
-- Apply to production before deploying the corresponding application code.

CREATE TABLE IF NOT EXISTS "whatsapp_campaign_automations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_account_id" varchar NOT NULL REFERENCES "business_accounts"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "template_id" varchar NOT NULL REFERENCES "whatsapp_templates"("id") ON DELETE RESTRICT,
  "template_params" jsonb DEFAULT '[]'::jsonb,
  "phone_column" text NOT NULL,
  "name_column" text DEFAULT '',
  "record_key_column" text NOT NULL,
  "date_column" text NOT NULL,
  "date_offset_days" integer DEFAULT 0 NOT NULL,
  "status_column" text DEFAULT '',
  "eligible_statuses" jsonb DEFAULT '[]'::jsonb,
  "default_country_code" text DEFAULT '91' NOT NULL,
  "send_mode" text DEFAULT 'review' NOT NULL,
  "send_time" text DEFAULT '10:00' NOT NULL,
  "timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "wa_automation_business_idx"
  ON "whatsapp_campaign_automations" ("business_account_id");
CREATE INDEX IF NOT EXISTS "wa_automation_business_enabled_idx"
  ON "whatsapp_campaign_automations" ("business_account_id", "enabled");

CREATE TABLE IF NOT EXISTS "whatsapp_campaign_automation_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "automation_id" varchar NOT NULL REFERENCES "whatsapp_campaign_automations"("id") ON DELETE CASCADE,
  "business_account_id" varchar NOT NULL REFERENCES "business_accounts"("id") ON DELETE CASCADE,
  "campaign_id" varchar REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL,
  "contact_group_id" varchar REFERENCES "contact_groups"("id") ON DELETE SET NULL,
  "source_file_name" text NOT NULL,
  "status" text DEFAULT 'awaiting_review' NOT NULL,
  "scheduled_at" timestamp,
  "total_rows" integer DEFAULT 0 NOT NULL,
  "eligible_rows" integer DEFAULT 0 NOT NULL,
  "excluded_rows" integer DEFAULT 0 NOT NULL,
  "invalid_rows" integer DEFAULT 0 NOT NULL,
  "duplicate_rows" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "approved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "wa_automation_runs_automation_created_idx"
  ON "whatsapp_campaign_automation_runs" ("automation_id", "created_at");
CREATE INDEX IF NOT EXISTS "wa_automation_runs_business_status_idx"
  ON "whatsapp_campaign_automation_runs" ("business_account_id", "status");

CREATE TABLE IF NOT EXISTS "whatsapp_campaign_automation_dispatches" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "automation_id" varchar NOT NULL REFERENCES "whatsapp_campaign_automations"("id") ON DELETE CASCADE,
  "business_account_id" varchar NOT NULL REFERENCES "business_accounts"("id") ON DELETE CASCADE,
  "run_id" varchar NOT NULL REFERENCES "whatsapp_campaign_automation_runs"("id") ON DELETE RESTRICT,
  "record_key" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_automation_dispatches_automation_key_uniq"
  ON "whatsapp_campaign_automation_dispatches" ("automation_id", "record_key");
CREATE INDEX IF NOT EXISTS "wa_automation_dispatches_run_idx"
  ON "whatsapp_campaign_automation_dispatches" ("run_id");