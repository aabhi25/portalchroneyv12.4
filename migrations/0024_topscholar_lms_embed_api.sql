ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "topscholar_embed_api_key_hash" text;--> statement-breakpoint
ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "topscholar_embed_api_key_last4" text;--> statement-breakpoint
ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "topscholar_embed_api_key_created_at" timestamp;--> statement-breakpoint
ALTER TABLE "business_accounts" ADD COLUMN IF NOT EXISTS "topscholar_embed_api_key_last_used_at" timestamp;--> statement-breakpoint
ALTER TABLE "topscholar_content_chunks" ADD COLUMN IF NOT EXISTS "sync_version" text;--> statement-breakpoint
ALTER TABLE "topscholar_content_sync" ADD COLUMN IF NOT EXISTS "active_sync_version" text;