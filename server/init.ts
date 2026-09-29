import { storage } from "./storage";
import { hashPassword } from "./auth";
import { jewelryImageGeneratorService } from "./services/jewelryImageGeneratorService";
import { visionWarehouseSyncService } from "./services/visionWarehouseSyncService";
import { db } from "./db";
import { whatsappLeadFields } from "../shared/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * Initialize the database with a default superadmin if none exists
 * This runs on server startup to ensure there's always a way to log in
 */
// NOTE: schema changes no longer go in this file. Add them to shared/schema.ts and generate a
// migration (npm run db:generate -- --name <what_changed>); server/migrate.ts applies it at
// startup. The ALTER/CREATE ... IF NOT EXISTS statements below predate migrations and are
// kept only because they are harmless no-ops on an up-to-date database.
export async function initializeDatabase() {
  try {
    // Data retention (auto-delete) tables. Created before background workers start.
    try {
      await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS data_retention_policies (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          scope_type text NOT NULL,
          scope_id varchar NOT NULL,
          mode text NOT NULL DEFAULT 'off',
          delete_synced_after_minutes integer NOT NULL DEFAULT 1440,
          delete_unsynced_after_minutes integer,
          delete_idle_chats_after_minutes integer DEFAULT 1440,
          keep_anonymous_counts boolean NOT NULL DEFAULT true,
          updated_by varchar,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS data_retention_policies_scope_idx ON data_retention_policies (scope_type, scope_id);
        CREATE TABLE IF NOT EXISTS data_purge_log (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          business_account_id varchar NOT NULL,
          record_type text NOT NULL,
          record_id varchar NOT NULL,
          captured_at timestamp,
          purged_at timestamp NOT NULL DEFAULT now(),
          reason text NOT NULL,
          synced boolean NOT NULL DEFAULT false,
          synced_at timestamp,
          crm_lead_id text,
          source text,
          is_discount boolean NOT NULL DEFAULT false,
          is_paid boolean NOT NULL DEFAULT false,
          count_in_analytics boolean NOT NULL DEFAULT true
        );
        CREATE INDEX IF NOT EXISTS data_purge_log_account_captured_idx ON data_purge_log (business_account_id, record_type, captured_at);
        CREATE INDEX IF NOT EXISTS data_purge_log_account_purged_idx ON data_purge_log (business_account_id, purged_at);
        CREATE TABLE IF NOT EXISTS data_retention_account_status (
          business_account_id varchar PRIMARY KEY,
          mode text NOT NULL,
          last_run_at timestamp NOT NULL,
          due_leads integer NOT NULL DEFAULT 0,
          due_conversations integer NOT NULL DEFAULT 0,
          last_purged_leads integer NOT NULL DEFAULT 0,
          last_purged_conversations integer NOT NULL DEFAULT 0,
          last_error text
        );
      `));
    } catch (err) {
      console.error('[INIT] Error creating data retention tables:', err);
    }

    // LeadSquared UDS connection columns. Added first: background workers and the
    // steps below read widget_settings / account_group_training.
    try {
      for (const table of ['widget_settings', 'account_group_training']) {
        await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS leadsquared_connection_type TEXT NOT NULL DEFAULT 'api'`));
        await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS leadsquared_uds_webhook_url TEXT`));
        await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS leadsquared_uds_key TEXT`));
      }
    } catch (err) {
      console.error('[INIT] Error adding LeadSquared UDS columns:', err);
    }

    // Recover any stuck Vista Studio jobs from previous server session
    try {
      const recoveredCount = await jewelryImageGeneratorService.recoverStuckJobs();
      if (recoveredCount > 0) {
        console.log(`[INIT] ✓ Recovered ${recoveredCount} stuck Vista Studio job(s)`);
      }
    } catch (err) {
      console.error('[INIT] Error recovering stuck jobs:', err);
    }

    // Check if any superadmin users exist
    const superadmins = await storage.getSuperadmins();
    
    if (superadmins.length === 0) {
      console.log('[INIT] No superadmin found. Creating default superadmin account...');
      
      // Get credentials from environment variables or use defaults
      const username = process.env.SUPERADMIN_USERNAME || 'admin';
      const password = process.env.SUPERADMIN_PASSWORD || 'admin123';
      
      // Hash the password
      const passwordHash = await hashPassword(password);
      
      // Create the superadmin user
      await storage.createUser({
        username,
        passwordHash,
        role: 'super_admin',
        businessAccountId: null,
      });
      
      console.log(`[INIT] ✓ Default superadmin created with username: ${username}`);
      console.log(`[INIT] ⚠️  Please log in and change the password immediately!`);
      
      if (!process.env.SUPERADMIN_USERNAME || !process.env.SUPERADMIN_PASSWORD) {
        console.log('[INIT] ⚠️  Using default credentials. Set SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD environment variables for better security.');
      }
    } else {
      console.log(`[INIT] ✓ Found ${superadmins.length} superadmin account(s)`);
    }
    
    // Backfill defaultCrmFieldKey for existing default WhatsApp lead fields (idempotent migration)
    try {
      const DEFAULT_CRM_KEYS: Record<string, string> = {
        customer_name: 'Name',
        customer_phone: 'Mobile',
        customer_email: 'Email',
      };
      for (const [fieldKey, crmKey] of Object.entries(DEFAULT_CRM_KEYS)) {
        await db.update(whatsappLeadFields)
          .set({ defaultCrmFieldKey: crmKey })
          .where(and(
            eq(whatsappLeadFields.fieldKey, fieldKey),
            eq(whatsappLeadFields.isDefault, true),
            isNull(whatsappLeadFields.defaultCrmFieldKey)
          ));
      }
    } catch (err) {
      console.error('[INIT] Error backfilling default CRM field keys:', err);
    }

    try {
      await db.execute(sql`ALTER TABLE crm_store_credentials ADD COLUMN IF NOT EXISTS city TEXT`);
    } catch (err) {
      console.error('[INIT] Error adding city column to crm_store_credentials:', err);
    }

    try {
      await db.execute(sql`ALTER TABLE custom_crm_settings ADD COLUMN IF NOT EXISTS callback_url TEXT`);
    } catch (err) {
      console.error('[INIT] Error adding callback_url column to custom_crm_settings:', err);
    }

    try {
      await db.execute(sql`ALTER TABLE custom_crm_settings ADD COLUMN IF NOT EXISTS relay_url TEXT`);
    } catch (err) {
      console.error('[INIT] Error adding relay_url column to custom_crm_settings:', err);
    }

    try {
      await db.execute(sql`ALTER TABLE account_group_admins ADD COLUMN IF NOT EXISTS can_sync_leads TEXT NOT NULL DEFAULT 'false'`);
    } catch (err) {
      console.error('[INIT] Error adding can_sync_leads column to account_group_admins:', err);
    }

    try {
      await db.execute(sql`ALTER TABLE account_group_admins ADD COLUMN IF NOT EXISTS can_delete_data TEXT NOT NULL DEFAULT 'false'`);
    } catch (err) {
      console.error('[INIT] Error adding can_delete_data column to account_group_admins:', err);
    }

    // Backfill: every saved WhatsApp template is mirrored from the MSG91
    // dashboard (already Meta-approved). MSG91 has no public create-template
    // API, so the draft/pending lifecycle is meaningless. Flip any legacy
    // non-approved rows to "approved" so they appear in campaign dropdowns.
    // Idempotent — touches only rows where status is currently not 'approved'.
    try {
      await db.execute(
        sql`UPDATE whatsapp_templates SET status = 'approved' WHERE status IS DISTINCT FROM 'approved'`
      );
    } catch (err) {
      console.error('[INIT] Error backfilling whatsapp_templates status:', err);
    }

    try {
      await db.execute(sql`ALTER TABLE contact_groups ADD COLUMN IF NOT EXISTS default_country_code TEXT`);
    } catch (err) {
      console.error('[INIT] Error adding default_country_code column to contact_groups:', err);
    }

    try {
      await db.execute(sql`ALTER TABLE marketing_campaign_recipients ADD COLUMN IF NOT EXISTS provider_response JSONB`);
    } catch (err) {
      console.error('[INIT] Error adding provider_response column to marketing_campaign_recipients:', err);
    }

    try {
      await db.execute(sql`ALTER TABLE marketing_campaign_recipients ADD COLUMN IF NOT EXISTS send_phone TEXT`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS mkt_recipients_biz_send_phone_idx ON marketing_campaign_recipients (business_account_id, send_phone)`);
    } catch (err) {
      console.error('[INIT] Error adding send_phone column/index to marketing_campaign_recipients:', err);
    }

    try {
      await db.execute(sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS conversion_fired BOOLEAN NOT NULL DEFAULT false`);
    } catch (err) {
      console.error('[INIT] Error adding conversion_fired column to conversations:', err);
    }

    // Task #8: idle/close summary sweep needs summarized_at + its sweep index on
    // pre-existing databases (schema is otherwise applied via drizzle db:push).
    try {
      await db.execute(sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summarized_at TIMESTAMP`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS conversations_summarized_sweep_idx ON conversations (updated_at, summarized_at)`);
    } catch (err) {
      console.error('[INIT] Error adding summarized_at column/index to conversations:', err);
    }

    // Uniform curriculum labels: the cp mapping + plan->cp resolution tables gain a
    // CMS subject name + id so the Content Sync label reads grade · board · subject.
    // Expand-only (nullable, no default) ADD COLUMN IF NOT EXISTS so pre-existing
    // databases gain the columns before the resolve/sync queries read them.
    try {
      await db.execute(sql`ALTER TABLE topscholar_cp_mappings ADD COLUMN IF NOT EXISTS subject TEXT`);
      await db.execute(sql`ALTER TABLE topscholar_cp_mappings ADD COLUMN IF NOT EXISTS subject_id TEXT`);
      await db.execute(sql`ALTER TABLE topscholar_plan_cp_resolutions ADD COLUMN IF NOT EXISTS subject TEXT`);
      await db.execute(sql`ALTER TABLE topscholar_plan_cp_resolutions ADD COLUMN IF NOT EXISTS subject_id TEXT`);
    } catch (err) {
      console.error('[INIT] Error adding subject columns to topscholar mapping/resolution tables:', err);
    }

    // Durable Plan-level curriculum sync queue. These tables contain progress
    // only—never the client curriculum text—and are created on boot as well as
    // through db:push so production upgrades do not depend on a manual schema
    // migration.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS topscholar_plan_runs (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          business_account_id VARCHAR NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
          plan_id TEXT NOT NULL,
          requested_cp_id TEXT,
          mode TEXT NOT NULL DEFAULT 'full',
          status TEXT NOT NULL DEFAULT 'queued',
          total_cp_ids INTEGER NOT NULL DEFAULT 0,
          completed_cp_ids INTEGER NOT NULL DEFAULT 0,
          failed_cp_ids INTEGER NOT NULL DEFAULT 0,
          active_cp_id TEXT,
          error TEXT,
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS topscholar_plan_run_items (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          run_id VARCHAR NOT NULL REFERENCES topscholar_plan_runs(id) ON DELETE CASCADE,
          business_account_id VARCHAR NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
          plan_id TEXT NOT NULL,
          cp_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          attempts INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT topscholar_plan_run_items_run_cp_key UNIQUE (run_id, cp_id)
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS topscholar_plan_sync_leases (
          business_account_id VARCHAR PRIMARY KEY REFERENCES business_accounts(id) ON DELETE CASCADE,
          owner TEXT NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await db.execute(sql`ALTER TABLE topscholar_plan_runs ADD COLUMN IF NOT EXISTS lease_owner TEXT`);
      await db.execute(sql`ALTER TABLE topscholar_plan_runs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP`);
      await db.execute(sql`ALTER TABLE topscholar_plan_runs ADD COLUMN IF NOT EXISTS requested_cp_id TEXT`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS topscholar_plan_runs_account_plan_updated_idx ON topscholar_plan_runs (business_account_id, plan_id, updated_at)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS topscholar_plan_runs_account_status_idx ON topscholar_plan_runs (business_account_id, status)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS topscholar_plan_run_items_run_status_idx ON topscholar_plan_run_items (run_id, status)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS topscholar_plan_run_items_account_cp_idx ON topscholar_plan_run_items (business_account_id, cp_id)`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS topscholar_plan_runs_active_plan_unique ON topscholar_plan_runs (business_account_id, plan_id) WHERE requested_cp_id IS NULL AND status IN ('queued', 'resolving', 'running')`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS topscholar_plan_runs_active_cp_unique ON topscholar_plan_runs (business_account_id, plan_id, requested_cp_id) WHERE requested_cp_id IS NOT NULL AND status IN ('queued', 'resolving', 'running')`);
    } catch (err) {
      console.error('[INIT] Error creating TopScholar Plan sync queue tables:', err);
    }

    // Realtime voice cost accounting: audio tokens bill at roughly 17x text
    // tokens, so usage rows carry a modality/cache breakdown and pricing rows
    // carry separate audio + cached rates. Expand-only ADD COLUMN IF NOT EXISTS
    // so pre-existing databases gain them before the first usage insert or
    // pricing upsert — production starts from the built bundle and never runs
    // drizzle push, so without this every voice usage insert would fail and
    // realtime spend would stay untracked.
    //
    // The ai_usage_events columns are SUBSETS of tokens_input/tokens_output,
    // never additions, so backfilling existing rows with 0 is correct: those
    // events are text-only and already fully counted by the totals.
    try {
      await db.execute(sql`ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS tokens_input_audio NUMERIC(10, 0) NOT NULL DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS tokens_output_audio NUMERIC(10, 0) NOT NULL DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS tokens_input_cached NUMERIC(10, 0) NOT NULL DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS tokens_input_cached_audio NUMERIC(10, 0) NOT NULL DEFAULT '0'`);
    } catch (err) {
      console.error('[INIT] Error adding token breakdown columns to ai_usage_events:', err);
    }

    // Nullable (no default): a null audio/cached rate means "fall back to the
    // text rate", which is exactly right for text-only models.
    try {
      await db.execute(sql`ALTER TABLE model_pricing ADD COLUMN IF NOT EXISTS cached_input_cost_per_1k NUMERIC(10, 6)`);
      await db.execute(sql`ALTER TABLE model_pricing ADD COLUMN IF NOT EXISTS audio_input_cost_per_1k NUMERIC(10, 6)`);
      await db.execute(sql`ALTER TABLE model_pricing ADD COLUMN IF NOT EXISTS audio_cached_input_cost_per_1k NUMERIC(10, 6)`);
      await db.execute(sql`ALTER TABLE model_pricing ADD COLUMN IF NOT EXISTS audio_output_cost_per_1k NUMERIC(10, 6)`);
    } catch (err) {
      console.error('[INIT] Error adding audio/cached rate columns to model_pricing:', err);
    }

    // Webhook idempotency: mark events handled so a retry of an unfinished one isn't dropped.
    try {
      await db.execute(sql`ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP`);
    } catch (err) {
      console.error('[INIT] Error adding processed_at to webhook_events:', err);
    }

    // Draft WhatsApp leads until a valid PAN + email are collected (per account).
    try {
      await db.execute(sql`ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS require_pan_email_for_lead TEXT NOT NULL DEFAULT 'false'`);
      await db.execute(sql`ALTER TABLE whatsapp_leads ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMP`);
    } catch (err) {
      console.error('[INIT] Error adding lead qualification columns:', err);
    }

    // Dealers & Stores sheet.
    try {
      await db.execute(sql`ALTER TABLE crm_store_credentials ADD COLUMN IF NOT EXISTS display_dealer_name TEXT`);
      await db.execute(sql`ALTER TABLE crm_store_credentials ADD COLUMN IF NOT EXISTS display_store_name TEXT`);
      await db.execute(sql`ALTER TABLE crm_store_credentials ADD COLUMN IF NOT EXISTS emi_schemes JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await db.execute(sql`ALTER TABLE crm_store_credentials ADD COLUMN IF NOT EXISTS show_in_journey BOOLEAN NOT NULL DEFAULT true`);
      await db.execute(sql`ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS store_sheet_enabled TEXT NOT NULL DEFAULT 'false'`);
    } catch (err) {
      console.error('[INIT] Error adding Dealers & Stores columns:', err);
    }

    // Resume any interrupted Vision Warehouse syncs
    try {
      await visionWarehouseSyncService.resumeInterruptedSyncs();
    } catch (err) {
      console.error('[INIT] Error resuming Vision Warehouse syncs:', err);
    }
  } catch (error) {
    console.error('[INIT] Error initializing database:', error);
    throw error;
  }
}
