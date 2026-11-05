CREATE TABLE IF NOT EXISTS "settings_copy_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" varchar NOT NULL,
	"source_account_id" varchar NOT NULL,
	"source_name" text NOT NULL,
	"request" jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshots" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" varchar,
	"created_by_name" text,
	"undone_at" timestamp,
	"undone_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings_copy_log" ADD CONSTRAINT "settings_copy_log_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settings_copy_log_group_idx" ON "settings_copy_log" USING btree ("group_id","created_at");