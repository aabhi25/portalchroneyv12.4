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
export async function initializeDatabase() {
  try {
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
