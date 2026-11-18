-- Design Studio "Share with family": the shared link's secret and the votes given through it.
ALTER TABLE "design_sessions" ADD COLUMN IF NOT EXISTS "share_token" text;--> statement-breakpoint
ALTER TABLE "design_sessions" ADD COLUMN IF NOT EXISTS "votes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "design_sessions_share_token_idx" ON "design_sessions" USING btree ("share_token");