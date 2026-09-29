-- WhatsApp webhook idempotency: mark inbound messages as handled, so a message whose
-- handling crashed mid-way can be retried instead of being dropped as a duplicate.
-- The server also adds this column at startup (server/init.ts); running it by hand is optional.
ALTER TABLE public.webhook_events ADD COLUMN IF NOT EXISTS processed_at timestamp;
