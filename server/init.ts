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
