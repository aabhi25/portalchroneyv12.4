CREATE INDEX IF NOT EXISTS "ai_usage_events_business_occurred_idx" ON "ai_usage_events" USING btree ("business_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_sessions_conversation_idx" ON "journey_sessions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journey_sessions_business_created_idx" ON "journey_sessions" USING btree ("business_account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_business_phone_idx" ON "leads" USING btree ("business_account_id","phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_business_email_idx" ON "leads" USING btree ("business_account_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_conversation_idx" ON "leads" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_flow_sessions_business_sender_status_idx" ON "whatsapp_flow_sessions" USING btree ("business_account_id","sender_phone","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_flow_sessions_status_last_message_idx" ON "whatsapp_flow_sessions" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_leads_business_sender_idx" ON "whatsapp_leads" USING btree ("business_account_id","sender_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_leads_flow_session_idx" ON "whatsapp_leads" USING btree ("flow_session_id");