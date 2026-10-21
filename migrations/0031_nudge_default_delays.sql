ALTER TABLE "account_group_extra_settings" ALTER COLUMN "inactivity_nudge_delay" SET DEFAULT '90';--> statement-breakpoint
ALTER TABLE "widget_settings" ALTER COLUMN "inactivity_nudge_delay" SET DEFAULT '90';--> statement-breakpoint
ALTER TABLE "widget_settings" ALTER COLUMN "proactive_nudge_delay" SET DEFAULT '30';--> statement-breakpoint
-- Businesses still on the old defaults move to the new, calmer ones (a delay someone chose is kept).
UPDATE "widget_settings" SET "inactivity_nudge_delay" = 90 WHERE "inactivity_nudge_delay" = 45;--> statement-breakpoint
UPDATE "widget_settings" SET "proactive_nudge_delay" = 30 WHERE "proactive_nudge_delay" = 15;--> statement-breakpoint
UPDATE "account_group_extra_settings" SET "inactivity_nudge_delay" = 90 WHERE "inactivity_nudge_delay" = 45;
