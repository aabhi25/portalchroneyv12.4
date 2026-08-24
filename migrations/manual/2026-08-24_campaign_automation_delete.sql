-- Soft-delete support for spreadsheet campaign automations.
-- Deleting an automation hides its definition and stops future work while
-- preserving generated campaign and run history for audit.

ALTER TABLE "whatsapp_campaign_automations"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

CREATE INDEX IF NOT EXISTS "wa_automation_business_deleted_idx"
  ON "whatsapp_campaign_automations" ("business_account_id", "deleted_at");