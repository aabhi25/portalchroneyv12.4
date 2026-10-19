ALTER TABLE "data_retention_policies" ADD COLUMN "mask_contacts_after_sync" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "contacts_masked_at" timestamp;