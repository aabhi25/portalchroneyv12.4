-- =====================================================================
-- Campaign reply classification + outcome tracking (2026-08-16)
-- =====================================================================
-- Dev applies these via `npm run db:push`; this file is the equivalent
-- change for a production database that push is not run against.
--
-- Adds:
--   * marketing_campaigns.reply_classifications  — per-campaign JSON list of
--     outcome categories. Deliberately config rather than an enum so a new
--     vertical (RSVPs, appointments, collections) needs no code change.
--   * six marketing_campaign_recipients columns holding the outcome the AI
--     classifier derived from each customer reply.
--
-- Safe to run on a populated production database:
--   * ADDITIVE ONLY — no drops, no type changes, no backfill.
--   * Every column is nullable or carries a DEFAULT, so no table rewrite
--     and no NOT NULL scan failure.
--   * Fully idempotent via IF NOT EXISTS — re-running changes nothing.
--   * Wrapped in a single transaction — all-or-nothing.
--
-- HOW TO RUN (prod):
--   pg_dump "$PROD_DATABASE_URL" -Fc -f backup_before_sync.dump
--   psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -f 2026-08-16_campaign_reply_classification.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Campaign-level outcome configuration
-- ---------------------------------------------------------------------
ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS reply_classifications jsonb;

-- ---------------------------------------------------------------------
-- 2) Per-recipient classified outcome
-- ---------------------------------------------------------------------
ALTER TABLE marketing_campaign_recipients
  ADD COLUMN IF NOT EXISTS primary_classification text,
  ADD COLUMN IF NOT EXISTS disposition_data      jsonb,
  ADD COLUMN IF NOT EXISTS callback_required     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS callback_reason       text,
  ADD COLUMN IF NOT EXISTS customer_feedback     text,
  ADD COLUMN IF NOT EXISTS classified_at         timestamp;

-- ---------------------------------------------------------------------
-- 3) Indexes for the outcomes dashboard
--
-- The dashboard tallies by classification and lists callbacks per campaign,
-- both scoped to one campaign, so the campaign id leads each index.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mcr_campaign_classification
  ON marketing_campaign_recipients (campaign_id, primary_classification);

CREATE INDEX IF NOT EXISTS idx_mcr_campaign_callback
  ON marketing_campaign_recipients (campaign_id)
  WHERE callback_required;

COMMIT;
