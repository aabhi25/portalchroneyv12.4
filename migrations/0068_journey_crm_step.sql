-- "Send to CRM after this question" on website journeys and WhatsApp journeys (leadCapture/journeyCrmGate.ts),
-- and when a WhatsApp visitor moved past that step.
ALTER TABLE "journey_steps" ADD COLUMN IF NOT EXISTS "crm_sync_after" text DEFAULT 'false' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_sessions" ADD COLUMN IF NOT EXISTS "crm_step_passed_at" timestamp;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_steps" ADD COLUMN IF NOT EXISTS "crm_sync_after" boolean DEFAULT false NOT NULL;
