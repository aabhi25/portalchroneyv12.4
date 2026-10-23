ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "reply_starts_journey" text DEFAULT 'false' NOT NULL;
