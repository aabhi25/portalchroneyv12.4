-- Phase 2 "One AI brain, with per-channel control".
-- Self-contained and idempotent: every column is added with IF NOT EXISTS, the data updates only
-- touch rows still at their defaults, so re-running this file (or running it after a renumber)
-- changes nothing a second time.

-- 1. Channel tags on training items. NULL / empty = used on every channel (unchanged behaviour).
ALTER TABLE "faqs" ADD COLUMN IF NOT EXISTS "channels" text[];--> statement-breakpoint
ALTER TABLE "training_documents" ADD COLUMN IF NOT EXISTS "channels" text[];--> statement-breakpoint
ALTER TABLE "trained_urls" ADD COLUMN IF NOT EXISTS "channels" text[];--> statement-breakpoint
ALTER TABLE "analyzed_pages" ADD COLUMN IF NOT EXISTS "channels" text[];--> statement-breakpoint

-- 2. WhatsApp answer style (NULL = inherit the website widget's personality / response length).
ALTER TABLE "whatsapp_settings" ADD COLUMN IF NOT EXISTS "personality" text;--> statement-breakpoint
ALTER TABLE "whatsapp_settings" ADD COLUMN IF NOT EXISTS "response_length" text;--> statement-breakpoint

-- 3. WhatsApp-only instructions mode: 'add' (on top of Train Chroney instructions) or 'replace'.
ALTER TABLE "whatsapp_settings" ADD COLUMN IF NOT EXISTS "instructions_mode" text DEFAULT 'add' NOT NULL;--> statement-breakpoint
-- Accounts that had "Use Master Training Instructions" switched off keep the website instructions
-- off on WhatsApp ('replace' is the same thing).
UPDATE "whatsapp_settings" SET "instructions_mode" = 'replace'
  WHERE "use_master_training" = 'false' AND "instructions_mode" = 'add';--> statement-breakpoint

-- 4. Use case mode: the 'lead_capture' (colleague) persona framing is kept only for accounts that
-- chose it on purpose. Evidence: a non-default mode, flow-only lead generation, any WhatsApp flow
-- (Caprion-style guided journeys where dealers / salesmen submit customer leads) or a persona that
-- talks about staff submitting leads. Everyone else is treated as 'direct_sales' from now on.
ALTER TABLE "whatsapp_settings" ADD COLUMN IF NOT EXISTS "use_case_mode_explicit" text DEFAULT 'false' NOT NULL;--> statement-breakpoint
UPDATE "whatsapp_settings" ws SET "use_case_mode_explicit" = 'true'
  WHERE ws."use_case_mode_explicit" = 'false' AND (
    ws."use_case_mode" <> 'lead_capture'
    OR ws."lead_generation_mode" = 'flow_only'
    OR EXISTS (SELECT 1 FROM "whatsapp_flows" f WHERE f."business_account_id" = ws."business_account_id")
    OR (ws."custom_prompt" IS NOT NULL AND ws."custom_prompt" ~* '(dealer|salesm[ae]n|sales ?rep|sales executive|field (agent|executive|staff)|channel partner|colleague|on behalf of|submit(ting)? (a |the )?leads?|internal staff)')
  );--> statement-breakpoint
ALTER TABLE "whatsapp_settings" ALTER COLUMN "use_case_mode" SET DEFAULT 'direct_sales';
