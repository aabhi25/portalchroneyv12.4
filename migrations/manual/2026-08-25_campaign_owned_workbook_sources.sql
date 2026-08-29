-- Additive, idempotent campaign-blueprint workbook source configuration.
-- Existing one-time campaigns and legacy blueprints keep NULL source_type.
ALTER TABLE "marketing_campaigns"
  ADD COLUMN IF NOT EXISTS "recipient_source_type" text,
  ADD COLUMN IF NOT EXISTS "recipient_workbook_id" varchar REFERENCES "whatsapp_ai_workbooks"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "recipient_workbook_sheet_id" text,
  ADD COLUMN IF NOT EXISTS "recipient_phone_column" text,
  ADD COLUMN IF NOT EXISTS "recipient_name_column" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "recipient_record_key_column" text,
  ADD COLUMN IF NOT EXISTS "recipient_date_column" text,
  ADD COLUMN IF NOT EXISTS "recipient_date_offset_days" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "recipient_status_column" text DEFAULT '',
  ADD COLUMN IF NOT EXISTS "recipient_eligible_statuses" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "recipient_ai_allowed_fields" jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS "marketing_campaigns_recipient_workbook_idx"
  ON "marketing_campaigns" ("business_account_id", "recipient_workbook_id");