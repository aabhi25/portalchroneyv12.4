ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "answer_checking_enabled" text DEFAULT 'false' NOT NULL;--> statement-breakpoint
-- The pilot kept its on/off switch in answer_check_settings; carry it over to the account's feature switch.
UPDATE "business_accounts" SET "answer_checking_enabled" = 'true'
  WHERE "id" IN (SELECT "business_account_id" FROM "answer_check_settings" WHERE "settings"->>'enabled' = 'true');
