import fs from 'fs';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const backupPath = './attached_assets/database_backup_1764047424898_1764048547328.sql';

function parseValue(value: string): string | null {
  if (value === '\\N') return null;
  return value.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

function escapeValue(val: string | null): string {
  if (val === null) return 'NULL';
  return `'${val.replace(/'/g, "''")}'`;
}

async function migrateData() {
  const content = fs.readFileSync(backupPath, 'utf-8');
  const lines = content.split('\n');
  
  let currentTable: string | null = null;
  let backupColumns: string[] = [];
  let isReadingData = false;
  
  const tableMappings: Record<string, { backupCols: string[], ourCols: string[] }> = {
    'business_accounts': {
      backupCols: ['id', 'name', 'website', 'description', 'openai_api_key', 'status', 'created_at', 'updated_at', 'shopify_auto_sync_enabled', 'shopify_sync_frequency', 'shopify_last_synced_at', 'shopify_sync_status', 'shopify_enabled', 'appointments_enabled', 'voice_mode_enabled', 'deepgram_api_key', 'auto_resolution_enabled', 'auto_resolution_confidence', 'escalation_sensitivity', 'human_only_categories', 'question_bank_enabled'],
      ourCols: ['id', 'name', 'website', 'description', 'status', 'created_at', 'updated_at', 'shopify_auto_sync_enabled', 'shopify_sync_frequency', 'shopify_last_synced_at', 'shopify_sync_status', 'shopify_enabled', 'appointments_enabled', 'voice_mode_enabled', 'auto_resolution_enabled', 'auto_resolution_confidence', 'escalation_sensitivity', 'human_only_categories', 'question_bank_enabled']
    },
    'users': {
      backupCols: ['id', 'username', 'password_hash', 'temp_password', 'temp_password_expiry', 'must_change_password', 'role', 'business_account_id', 'last_login_at', 'created_at'],
      ourCols: ['id', 'username', 'password_hash', 'temp_password', 'temp_password_expiry', 'must_change_password', 'role', 'business_account_id', 'last_login_at', 'created_at']
    },
    'conversations': {
      backupCols: ['id', 'business_account_id', 'title', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'title', 'created_at', 'updated_at']
    },
    'messages': {
      backupCols: ['id', 'conversation_id', 'role', 'content', 'created_at'],
      ourCols: ['id', 'conversation_id', 'role', 'content', 'created_at']
    },
    'products': {
      backupCols: ['id', 'business_account_id', 'name', 'description', 'price', 'image_url', 'source', 'shopify_product_id', 'shopify_last_synced_at', 'is_editable', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'name', 'description', 'price', 'image_url', 'source', 'shopify_product_id', 'shopify_last_synced_at', 'is_editable', 'created_at', 'updated_at']
    },
    'faqs': {
      backupCols: ['id', 'business_account_id', 'question', 'answer', 'category', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'question', 'answer', 'category', 'created_at', 'updated_at']
    },
    'leads': {
      backupCols: ['id', 'business_account_id', 'name', 'email', 'phone', 'message', 'conversation_id', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'name', 'email', 'phone', 'message', 'conversation_id', 'created_at', 'updated_at']
    },
    'categories': {
      backupCols: ['id', 'business_account_id', 'name', 'description', 'parent_category_id', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'name', 'description', 'parent_category_id', 'created_at', 'updated_at']
    },
    'tags': {
      backupCols: ['id', 'business_account_id', 'name', 'color', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'name', 'color', 'created_at', 'updated_at']
    },
    'product_categories': {
      backupCols: ['id', 'product_id', 'category_id', 'created_at'],
      ourCols: ['id', 'product_id', 'category_id', 'created_at']
    },
    'product_tags': {
      backupCols: ['id', 'product_id', 'tag_id', 'created_at'],
      ourCols: ['id', 'product_id', 'tag_id', 'created_at']
    },
    'product_relationships': {
      backupCols: ['id', 'business_account_id', 'source_product_id', 'target_product_id', 'relationship_type', 'weight', 'notes', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'source_product_id', 'target_product_id', 'relationship_type', 'weight', 'notes', 'created_at', 'updated_at']
    },
    'widget_settings': {
      backupCols: ['id', 'business_account_id', 'chat_color', 'chat_color_end', 'widget_header_text', 'welcome_message_type', 'welcome_message', 'button_style', 'button_animation', 'personality', 'currency', 'custom_instructions', 'cached_intro', 'shopify_store_url', 'shopify_access_token', 'enable_cart_recovery', 'recovery_trigger_minutes', 'recovery_discount_type', 'recovery_discount_value', 'recovery_email_enabled', 'recovery_whatsapp_enabled', 'discount_strategy', 'twilio_account_sid', 'twilio_auth_token', 'twilio_whatsapp_from', 'created_at', 'updated_at', 'appointment_booking_enabled', 'widget_width', 'widget_height', 'widget_position', 'bubble_size', 'size_preset', 'button_icon', 'auto_open_chat', 'avatar_type', 'avatar_url', 'suggested_questions', 'show_suggested_questions', 'voice_selection', 'voice_mode_style', 'chat_mode', 'conversation_starters', 'conversation_starters_enabled'],
      ourCols: ['id', 'business_account_id', 'chat_color', 'chat_color_end', 'widget_header_text', 'welcome_message_type', 'welcome_message', 'button_style', 'button_animation', 'personality', 'currency', 'custom_instructions', 'cached_intro', 'shopify_store_url', 'created_at', 'updated_at', 'appointment_booking_enabled', 'widget_width', 'widget_height', 'widget_position', 'bubble_size', 'size_preset', 'auto_open_chat', 'avatar_type', 'avatar_url', 'voice_selection', 'voice_mode_style', 'chat_mode', 'conversation_starters', 'conversation_starters_enabled']
    },
    'website_analysis': {
      backupCols: ['id', 'business_account_id', 'website_url', 'status', 'analyzed_content', 'error_message', 'last_analyzed_at', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'website_url', 'status', 'analyzed_content', 'error_message', 'last_analyzed_at', 'created_at', 'updated_at']
    },
    'analyzed_pages': {
      backupCols: ['id', 'business_account_id', 'page_url', 'analyzed_at', 'created_at', 'page_category', 'page_summary', 'extracted_content'],
      ourCols: ['id', 'business_account_id', 'page_url', 'analyzed_at', 'created_at', 'extracted_content']
    },
    'training_documents': {
      backupCols: ['id', 'business_account_id', 'filename', 'original_filename', 'file_size', 'storage_key', 'upload_status', 'extracted_text', 'summary', 'key_points', 'error_message', 'uploaded_by', 'processed_at', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'filename', 'original_filename', 'file_size', 'storage_key', 'upload_status', 'extracted_text', 'summary', 'key_points', 'error_message', 'uploaded_by', 'processed_at', 'created_at', 'updated_at']
    },
    'schedule_templates': {
      backupCols: ['id', 'business_account_id', 'day_of_week', 'start_time', 'end_time', 'slot_duration_minutes', 'is_active', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'day_of_week', 'start_time', 'end_time', 'slot_duration_minutes', 'is_active', 'created_at', 'updated_at']
    },
    'slot_overrides': {
      backupCols: ['id', 'business_account_id', 'slot_date', 'slot_time', 'duration_minutes', 'is_available', 'reason', 'created_at', 'updated_at', 'is_all_day'],
      ourCols: ['id', 'business_account_id', 'slot_date', 'slot_time', 'duration_minutes', 'is_available', 'reason', 'created_at', 'updated_at', 'is_all_day']
    },
    'appointments': {
      backupCols: ['id', 'business_account_id', 'conversation_id', 'lead_id', 'patient_name', 'patient_phone', 'patient_email', 'appointment_date', 'appointment_time', 'duration_minutes', 'status', 'notes', 'cancellation_reason', 'reminder_sent_at', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'conversation_id', 'lead_id', 'patient_name', 'patient_phone', 'patient_email', 'appointment_date', 'appointment_time', 'duration_minutes', 'status', 'notes', 'cancellation_reason', 'reminder_sent_at', 'created_at', 'updated_at']
    },
    'demo_pages': {
      backupCols: ['id', 'business_account_id', 'token', 'title', 'description', 'appearance', 'is_active', 'expires_at', 'last_viewed_at', 'created_by', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'token', 'title', 'description', 'appearance', 'is_active', 'expires_at', 'last_viewed_at', 'created_by', 'created_at', 'updated_at']
    },
    'public_chat_links': {
      backupCols: ['id', 'business_account_id', 'token', 'is_active', 'last_accessed_at', 'access_count', 'created_at', 'updated_at', 'password'],
      ourCols: ['id', 'business_account_id', 'token', 'is_active', 'last_accessed_at', 'access_count', 'created_at', 'updated_at', 'password']
    },
    'question_bank_entries': {
      backupCols: ['id', 'business_account_id', 'conversation_id', 'message_id', 'question', 'ai_response', 'user_context', 'status', 'category', 'confidence_score', 'notes', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'conversation_id', 'message_id', 'question', 'ai_response', 'user_context', 'status', 'category', 'confidence_score', 'notes', 'created_at', 'updated_at']
    },
    'conversation_journeys': {
      backupCols: ['id', 'business_account_id', 'name', 'description', 'template_type', 'status', 'is_default', 'trigger_mode', 'total_starts', 'total_completions', 'created_at', 'updated_at', 'trigger_keywords'],
      ourCols: ['id', 'business_account_id', 'name', 'description', 'template_type', 'status', 'is_default', 'trigger_mode', 'total_starts', 'total_completions', 'created_at', 'updated_at', 'trigger_keywords']
    },
    'journey_steps': {
      backupCols: ['id', 'journey_id', 'step_order', 'question_text', 'question_type', 'field_name', 'is_required', 'multiple_choice_options', 'tool_trigger', 'tool_parameters', 'branching_condition', 'placeholder_text', 'help_text', 'created_at', 'updated_at'],
      ourCols: ['id', 'journey_id', 'step_order', 'question_text', 'question_type', 'field_name', 'is_required', 'multiple_choice_options', 'tool_trigger', 'tool_parameters', 'branching_condition', 'placeholder_text', 'help_text', 'created_at', 'updated_at']
    },
    'journey_sessions': {
      backupCols: ['id', 'journey_id', 'conversation_id', 'business_account_id', 'user_id', 'current_step_index', 'completed', 'completed_at', 'created_at', 'updated_at'],
      ourCols: ['id', 'journey_id', 'conversation_id', 'business_account_id', 'user_id', 'current_step_index', 'completed', 'completed_at', 'created_at', 'updated_at']
    },
    'journey_responses': {
      backupCols: ['id', 'journey_id', 'conversation_id', 'step_id', 'response', 'created_at'],
      ourCols: ['id', 'journey_id', 'conversation_id', 'step_id', 'response', 'created_at']
    },
    'support_tickets': {
      backupCols: ['id', 'business_account_id', 'conversation_id', 'customer_name', 'customer_email', 'customer_phone', 'subject', 'description', 'status', 'priority', 'category', 'ai_priority', 'ai_category', 'sentiment_score', 'emotional_state', 'churn_risk', 'ai_analysis', 'ai_drafted_response', 'auto_resolved', 'auto_resolved_at', 'auto_resolution_summary', 'assigned_to', 'resolved_at', 'closed_at', 'customer_rating', 'customer_feedback', 'created_at', 'updated_at', 'ticket_number'],
      ourCols: ['id', 'business_account_id', 'conversation_id', 'customer_name', 'customer_email', 'customer_phone', 'subject', 'description', 'status', 'priority', 'category', 'ai_priority', 'ai_category', 'sentiment_score', 'emotional_state', 'churn_risk', 'ai_analysis', 'ai_drafted_response', 'auto_resolved', 'auto_resolved_at', 'auto_resolution_summary', 'assigned_to', 'resolved_at', 'closed_at', 'customer_rating', 'customer_feedback', 'created_at', 'updated_at', 'ticket_number']
    },
    'ticket_messages': {
      backupCols: ['id', 'ticket_id', 'sender_id', 'sender_type', 'sender_name', 'sender_email', 'message', 'message_type', 'is_internal', 'ai_drafted', 'ai_confidence', 'created_at'],
      ourCols: ['id', 'ticket_id', 'sender_id', 'sender_type', 'sender_name', 'sender_email', 'message', 'message_type', 'is_internal', 'ai_drafted', 'ai_confidence', 'created_at']
    },
    'ticket_attachments': {
      backupCols: ['id', 'ticket_id', 'message_id', 'filename', 'original_filename', 'file_size', 'storage_key', 'mime_type', 'uploaded_by', 'uploader_type', 'created_at'],
      ourCols: ['id', 'ticket_id', 'message_id', 'filename', 'original_filename', 'file_size', 'storage_key', 'mime_type', 'uploaded_by', 'uploader_type', 'created_at']
    },
    'ticket_insights': {
      backupCols: ['id', 'business_account_id', 'insight_type', 'title', 'description', 'priority', 'related_ticket_ids', 'suggested_action', 'impact', 'status', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at', 'ai_generated'],
      ourCols: ['id', 'business_account_id', 'insight_type', 'title', 'description', 'priority', 'related_ticket_ids', 'suggested_action', 'impact', 'status', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at', 'ai_generated']
    },
    'canned_responses': {
      backupCols: ['id', 'business_account_id', 'title', 'content', 'category', 'use_count', 'last_used_at', 'created_by', 'created_at', 'updated_at'],
      ourCols: ['id', 'business_account_id', 'title', 'content', 'category', 'use_count', 'last_used_at', 'created_by', 'created_at', 'updated_at']
    },
    'sessions': {
      backupCols: ['id', 'user_id', 'session_token', 'expires_at', 'created_at'],
      ourCols: ['id', 'user_id', 'session_token', 'expires_at', 'created_at']
    },
    'password_reset_tokens': {
      backupCols: ['id', 'user_id', 'token', 'expires_at', 'used_at', 'created_at'],
      ourCols: ['id', 'user_id', 'token', 'expires_at', 'used_at', 'created_at']
    }
  };

  const insertOrder = [
    'business_accounts',
    'users',
    'conversations',
    'messages',
    'categories',
    'tags',
    'products',
    'product_categories',
    'product_tags',
    'product_relationships',
    'faqs',
    'leads',
    'widget_settings',
    'website_analysis',
    'analyzed_pages',
    'training_documents',
    'schedule_templates',
    'slot_overrides',
    'appointments',
    'demo_pages',
    'public_chat_links',
    'question_bank_entries',
    'conversation_journeys',
    'journey_steps',
    'journey_sessions',
    'journey_responses',
    'support_tickets',
    'ticket_messages',
    'ticket_attachments',
    'ticket_insights',
    'canned_responses'
  ];

  const tableData: Record<string, string[][]> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('COPY public.')) {
      const match = line.match(/COPY public\.(\w+) \(([^)]+)\)/);
      if (match) {
        currentTable = match[1];
        backupColumns = match[2].split(', ').map(c => c.trim());
        isReadingData = true;
        tableData[currentTable] = [];
        console.log(`Found table: ${currentTable} with ${backupColumns.length} columns`);
      }
    } else if (isReadingData && line === '\\.') {
      console.log(`  -> ${tableData[currentTable!]?.length || 0} rows`);
      isReadingData = false;
      currentTable = null;
      backupColumns = [];
    } else if (isReadingData && currentTable && line.trim()) {
      const values = line.split('\t');
      tableData[currentTable].push(values);
    }
  }

  console.log('\n--- Starting data migration ---\n');

  const client = await pool.connect();
  
  try {
    for (const tableName of insertOrder) {
      const rows = tableData[tableName];
      const mapping = tableMappings[tableName];
      
      if (!rows || rows.length === 0) {
        console.log(`Skipping ${tableName}: no data`);
        continue;
      }
      
      if (!mapping) {
        console.log(`Skipping ${tableName}: no column mapping`);
        continue;
      }

      console.log(`Migrating ${tableName}: ${rows.length} rows...`);
      let successCount = 0;
      let errorCount = 0;

      for (const row of rows) {
        const columnIndices: Record<string, number> = {};
        mapping.backupCols.forEach((col, idx) => {
          columnIndices[col] = idx;
        });

        const insertCols: string[] = [];
        const insertVals: (string | null)[] = [];

        for (const ourCol of mapping.ourCols) {
          const backupIdx = columnIndices[ourCol];
          if (backupIdx !== undefined && backupIdx < row.length) {
            insertCols.push(ourCol);
            insertVals.push(parseValue(row[backupIdx]));
          }
        }

        if (insertCols.length > 0) {
          const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
          const query = `INSERT INTO ${tableName} (${insertCols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`;
          
          try {
            await client.query(query, insertVals);
            successCount++;
          } catch (error: any) {
            errorCount++;
            if (errorCount <= 3) {
              console.error(`  Error in ${tableName}:`, error.message.substring(0, 100));
            }
          }
        }
      }
      
      console.log(`  Done: ${successCount} inserted, ${errorCount} errors`);
    }

    console.log('\n--- Migration complete ---');
  } finally {
    client.release();
    await pool.end();
  }
}

migrateData().catch(console.error);
