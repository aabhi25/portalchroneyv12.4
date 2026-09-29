CREATE TABLE "account_group_admins" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"group_id" varchar NOT NULL,
	"can_view_conversations" text DEFAULT 'true' NOT NULL,
	"can_view_leads" text DEFAULT 'true' NOT NULL,
	"can_view_analytics" text DEFAULT 'true' NOT NULL,
	"can_export_data" text DEFAULT 'false' NOT NULL,
	"can_sync_leads" text DEFAULT 'false' NOT NULL,
	"can_delete_data" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_group_extra_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" varchar NOT NULL,
	"response_length" text DEFAULT 'balanced' NOT NULL,
	"auto_open_chat" text DEFAULT 'false' NOT NULL,
	"opening_sound_enabled" text DEFAULT 'true' NOT NULL,
	"opening_sound_style" text DEFAULT 'chime' NOT NULL,
	"inactivity_nudge_enabled" text DEFAULT 'true' NOT NULL,
	"inactivity_nudge_delay" numeric(5, 0) DEFAULT '45' NOT NULL,
	"inactivity_nudge_message" text DEFAULT 'Still there? Let me know if you need any help!' NOT NULL,
	"smart_nudge_enabled" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_group_journey_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" varchar NOT NULL,
	"step_order" numeric(5, 0) NOT NULL,
	"question_text" text NOT NULL,
	"question_type" text DEFAULT 'text' NOT NULL,
	"field_name" text,
	"is_required" text DEFAULT 'false' NOT NULL,
	"multiple_choice_options" text,
	"tool_trigger" text,
	"tool_parameters" text,
	"branching_condition" text,
	"exit_on_value" text,
	"exit_message" text,
	"skip_on_value" text,
	"skip_to_step_index" integer,
	"is_conditional" text DEFAULT 'false' NOT NULL,
	"completion_button_text" text,
	"placeholder_text" text,
	"help_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_group_journeys" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"template_type" text DEFAULT 'custom' NOT NULL,
	"journey_type" text DEFAULT 'conversational' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" text DEFAULT 'false' NOT NULL,
	"trigger_mode" text DEFAULT 'manual' NOT NULL,
	"trigger_keywords" text,
	"start_from_scratch" text DEFAULT 'false' NOT NULL,
	"conversational_guidelines" text,
	"total_starts" numeric(10, 0) DEFAULT '0' NOT NULL,
	"total_completions" numeric(10, 0) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_group_leadsquared_field_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" varchar NOT NULL,
	"leadsquared_field" text NOT NULL,
	"source_type" text NOT NULL,
	"source_field" text,
	"custom_value" text,
	"fallback_value" text,
	"display_name" text NOT NULL,
	"is_enabled" text DEFAULT 'true' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_group_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"is_primary" text DEFAULT 'false' NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_group_training" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" varchar NOT NULL,
	"custom_instructions" text,
	"lead_training_config" jsonb,
	"fallback_template" text,
	"last_published_at" timestamp,
	"last_published_by" varchar,
	"leadsquared_host" text,
	"leadsquared_access_key" text,
	"leadsquared_secret_key" text,
	"leadsquared_enabled" text DEFAULT 'false',
	"leadsquared_connection_type" text DEFAULT 'api' NOT NULL,
	"leadsquared_uds_webhook_url" text,
	"leadsquared_uds_key" text,
	"leadsquared_last_applied_at" timestamp,
	"menu_config" jsonb,
	"menu_items" jsonb,
	"menu_last_applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_group_training_group_id_unique" UNIQUE("group_id")
);
--> statement-breakpoint
CREATE TABLE "account_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" varchar NOT NULL,
	"primary_has_full_access" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"suggested_content" jsonb,
	"conversation_count" numeric(10, 0) DEFAULT '0',
	"confidence" numeric(5, 2) DEFAULT '0',
	"priority" text DEFAULT 'medium',
	"example_questions" jsonb,
	"conversation_ids" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp,
	"accepted_by" varchar,
	"dismissed_at" timestamp,
	"dismissed_by" varchar,
	"dismiss_reason" text,
	"impact_metrics" jsonb,
	"implemented_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_daily" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"category" text NOT NULL,
	"tokens_input" numeric(15, 0) DEFAULT '0' NOT NULL,
	"tokens_output" numeric(15, 0) DEFAULT '0' NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"event_count" numeric(10, 0) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"category" text NOT NULL,
	"model" text NOT NULL,
	"tokens_input" numeric(10, 0) DEFAULT '0' NOT NULL,
	"tokens_output" numeric(10, 0) DEFAULT '0' NOT NULL,
	"tokens_input_audio" numeric(10, 0) DEFAULT '0' NOT NULL,
	"tokens_output_audio" numeric(10, 0) DEFAULT '0' NOT NULL,
	"tokens_input_cached" numeric(10, 0) DEFAULT '0' NOT NULL,
	"tokens_input_cached_audio" numeric(10, 0) DEFAULT '0' NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"metadata" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analyzed_pages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"page_url" text NOT NULL,
	"extracted_content" text,
	"analyzed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"conversation_id" varchar,
	"lead_id" varchar,
	"patient_name" text NOT NULL,
	"patient_phone" text NOT NULL,
	"patient_email" text,
	"appointment_date" timestamp NOT NULL,
	"appointment_time" text NOT NULL,
	"duration_minutes" numeric(3, 0) DEFAULT '30' NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"notes" text,
	"cancellation_reason" text,
	"reminder_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"actor_user_id" varchar,
	"actor_username" text,
	"actor_role" text,
	"business_account_id" varchar,
	"session_fingerprint" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"outcome" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" text NOT NULL,
	"operation" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"backup_type" text,
	"backup_key" text,
	"file_size_bytes" numeric(20, 0),
	"duration_ms" numeric(10, 0),
	"error_message" text,
	"error_details" text,
	"metadata" jsonb,
	"triggered_by" text DEFAULT 'system' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "business_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website" text NOT NULL,
	"description" text DEFAULT '',
	"openai_api_key" text,
	"elevenlabs_api_key" text,
	"jina_api_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"product_tier" text DEFAULT 'chroney' NOT NULL,
	"shopify_auto_sync_enabled" text DEFAULT 'false' NOT NULL,
	"shopify_sync_frequency" numeric(5, 0) DEFAULT '24',
	"shopify_last_synced_at" timestamp,
	"shopify_sync_status" text DEFAULT 'idle',
	"shopify_enabled" text DEFAULT 'false' NOT NULL,
	"appointments_enabled" text DEFAULT 'false' NOT NULL,
	"voice_mode_enabled" text DEFAULT 'true' NOT NULL,
	"visual_search_enabled" text DEFAULT 'false' NOT NULL,
	"jewelry_showcase_enabled" text DEFAULT 'false' NOT NULL,
	"jewelry_detection_enabled" text DEFAULT 'false' NOT NULL,
	"support_tickets_enabled" text DEFAULT 'false' NOT NULL,
	"whatsapp_enabled" text DEFAULT 'false' NOT NULL,
	"instagram_enabled" text DEFAULT 'false' NOT NULL,
	"facebook_enabled" text DEFAULT 'false' NOT NULL,
	"chroney_enabled" text DEFAULT 'true' NOT NULL,
	"k12_education_enabled" text DEFAULT 'false' NOT NULL,
	"k12_image_upload_enabled" text DEFAULT 'false' NOT NULL,
	"k12_content_only_mode" text DEFAULT 'false' NOT NULL,
	"k12_verbatim_content_mode" text DEFAULT 'false' NOT NULL,
	"job_portal_enabled" text DEFAULT 'false' NOT NULL,
	"demo_orders_enabled" text DEFAULT 'false' NOT NULL,
	"whatsapp_marketing_enabled" text DEFAULT 'false' NOT NULL,
	"leads_export_enabled" text DEFAULT 'false' NOT NULL,
	"lead_phone_masking_enabled" text DEFAULT 'false' NOT NULL,
	"job_import_config" jsonb,
	"system_mode" text DEFAULT 'full' NOT NULL,
	"topscholar_api_base_url" text,
	"topscholar_api_token" text,
	"topscholar_rag_enabled" text DEFAULT 'false' NOT NULL,
	"topscholar_content_db_url" text,
	"topscholar_content_db_disabled" text DEFAULT 'false' NOT NULL,
	"topscholar_content_db_name" text,
	"topscholar_content_db_index" text,
	"topscholar_content_db_collection" text,
	"topscholar_cms_base_url" text,
	"topscholar_cms_token" text,
	"topscholar_token_secret" text,
	"topscholar_uat_plain_cp_id" text DEFAULT 'false' NOT NULL,
	"topscholar_require_signed_token" text DEFAULT 'false' NOT NULL,
	"topscholar_doubt_sync_base_url" text,
	"topscholar_doubt_resolution_cooldown_seconds" integer,
	"topscholar_auto_sync_enabled" text DEFAULT 'false' NOT NULL,
	"topscholar_sync_mode" text DEFAULT 'full' NOT NULL,
	"topscholar_sync_interval_minutes" integer DEFAULT 1440 NOT NULL,
	"topscholar_last_auto_sync_at" timestamp,
	"question_bank_enabled" text DEFAULT 'true' NOT NULL,
	"auto_resolution_enabled" text DEFAULT 'true' NOT NULL,
	"auto_resolution_confidence" numeric(3, 0) DEFAULT '75',
	"escalation_sensitivity" text DEFAULT 'medium' NOT NULL,
	"human_only_categories" text DEFAULT '',
	"inactivity_nudge_enabled" text DEFAULT 'true' NOT NULL,
	"inactivity_nudge_delay" numeric(5, 0) DEFAULT '45',
	"inactivity_nudge_message" text DEFAULT 'Still there? Let me know if you need any help!',
	"proactive_nudge_enabled" text DEFAULT 'true' NOT NULL,
	"proactive_nudge_delay" numeric(5, 0) DEFAULT '15',
	"proactive_nudge_message" text DEFAULT 'Need help finding something? I''m here to assist!',
	"ai_product_processing_enabled" text DEFAULT 'false' NOT NULL,
	"vista_image_provider" text DEFAULT 'openai' NOT NULL,
	"google_nano_banana_api_key" text,
	"visual_search_model" text DEFAULT 'google_product_search' NOT NULL,
	"google_vision_warehouse_corpus_id" text,
	"google_vision_warehouse_index_id" text,
	"google_vision_warehouse_endpoint_id" text,
	"google_vision_warehouse_credentials" text,
	"google_vision_warehouse_project_number" text,
	"google_product_search_product_set_id" text,
	"google_product_search_location" text DEFAULT 'us-east1',
	"google_product_search_credentials" text,
	"google_product_search_project_id" text,
	"product_search_sync_phase" text DEFAULT 'idle',
	"product_search_sync_progress" numeric(10, 0) DEFAULT '0',
	"product_search_sync_total" numeric(10, 0) DEFAULT '0',
	"product_search_sync_error" text,
	"product_search_last_synced_at" timestamp,
	"vision_warehouse_sync_phase" text DEFAULT 'idle',
	"vision_warehouse_sync_progress" numeric(10, 0) DEFAULT '0',
	"vision_warehouse_sync_total" numeric(10, 0) DEFAULT '0',
	"vision_warehouse_sync_success_count" numeric(10, 0) DEFAULT '0',
	"vision_warehouse_sync_failed_count" numeric(10, 0) DEFAULT '0',
	"vision_warehouse_sync_error" text,
	"vision_warehouse_sync_started_at" timestamp,
	"vision_warehouse_sync_analyze_op_name" text,
	"vision_warehouse_sync_index_op_name" text,
	"vision_warehouse_sync_index_op_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canned_responses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" text,
	"use_count" numeric(10, 0) DEFAULT '0' NOT NULL,
	"last_used_at" timestamp,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_category_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_menu_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"enabled" text DEFAULT 'false' NOT NULL,
	"welcome_message" text DEFAULT 'Hi! How can I help you today?',
	"avatar_url" text,
	"quick_chips" jsonb DEFAULT '[]'::jsonb,
	"footer_text" text,
	"footer_link_text" text,
	"footer_link_url" text,
	"persistent_cta_enabled" text DEFAULT 'false' NOT NULL,
	"persistent_cta_label" text DEFAULT 'Talk to Counsellor',
	"persistent_cta_icon" text DEFAULT 'phone',
	"persistent_cta_action" text DEFAULT 'chat',
	"persistent_cta_value" text,
	"persistent_cta_style" text DEFAULT 'chatbox',
	"chat_instead_style" text DEFAULT 'plain',
	"lead_form_fields" text DEFAULT 'name,phone',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_menu_item_details" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_item_id" varchar NOT NULL,
	"tabs" jsonb DEFAULT '[]'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"header_links" jsonb DEFAULT '[]'::jsonb,
	"action_buttons" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_menu_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"parent_id" varchar,
	"title" text NOT NULL,
	"subtitle" text,
	"icon" text DEFAULT 'folder',
	"icon_bg_color" text DEFAULT '#E0E7FF',
	"icon_color" text DEFAULT '#4F46E5',
	"sort_order" integer DEFAULT 0 NOT NULL,
	"item_type" text DEFAULT 'navigate' NOT NULL,
	"action_value" text,
	"lead_form_fields" text,
	"is_active" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_group_contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"phone" text NOT NULL,
	"name" text DEFAULT '',
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"contact_count" integer DEFAULT 0 NOT NULL,
	"default_country_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_analysis_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" text NOT NULL,
	"conversation_count" integer NOT NULL,
	"analysis_result" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_category_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_other_category" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_journeys" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"template_type" text DEFAULT 'custom' NOT NULL,
	"journey_type" text DEFAULT 'conversational' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" text DEFAULT 'false' NOT NULL,
	"trigger_mode" text DEFAULT 'manual' NOT NULL,
	"trigger_keywords" text,
	"start_from_scratch" text DEFAULT 'false' NOT NULL,
	"conversational_guidelines" text,
	"total_starts" numeric(10, 0) DEFAULT '0' NOT NULL,
	"total_completions" numeric(10, 0) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar,
	"title" text DEFAULT 'New Chat' NOT NULL,
	"visitor_city" text,
	"visitor_token" text,
	"is_internal_test" text DEFAULT 'false' NOT NULL,
	"category" text,
	"subcategory" text,
	"category_confidence" numeric(5, 2),
	"relevance" text,
	"summary" text,
	"topic_keywords" text,
	"summarized_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"awaiting_verification" boolean DEFAULT false NOT NULL,
	"topscholar_cp_id" text,
	"student_id" text,
	"student_name" text,
	"subject" text,
	"sentiment" text,
	"captcha_status" text,
	"conversion_fired" boolean DEFAULT false NOT NULL,
	"topscholar_doubt_id" text,
	"topscholar_student_plan_mapping_id" text,
	"topscholar_plan_id" text,
	"doubt_retry_status" text
);
--> statement-breakpoint
CREATE TABLE "crm_store_credentials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"dealer_name" text NOT NULL,
	"store_name" text NOT NULL,
	"city" text,
	"store_id" integer,
	"sid" text NOT NULL,
	"secret" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_crm_field_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"crm_field" text NOT NULL,
	"source_type" text NOT NULL,
	"source_field" text,
	"custom_value" text,
	"display_name" text NOT NULL,
	"is_enabled" text DEFAULT 'true' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_auto_managed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_crm_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT 'Custom CRM' NOT NULL,
	"api_base_url" text,
	"api_endpoint" text,
	"http_method" text DEFAULT 'POST' NOT NULL,
	"content_type" text DEFAULT 'form-data' NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"auth_key" text,
	"auth_header_name" text,
	"auto_sync_enabled" boolean DEFAULT false NOT NULL,
	"callback_url" text,
	"relay_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "custom_crm_settings_business_account_id_unique" UNIQUE("business_account_id")
);
--> statement-breakpoint
CREATE TABLE "customer_identities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"platform" varchar NOT NULL,
	"platform_user_id" varchar NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_memory_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"platform" varchar NOT NULL,
	"summary" text NOT NULL,
	"profile_facts" jsonb,
	"open_intents" text,
	"journey_stage" varchar,
	"last_message_at" timestamp,
	"turns_since_refresh" integer DEFAULT 0 NOT NULL,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_merge_audit" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"survivor_profile_id" varchar NOT NULL,
	"merged_profile_id" varchar NOT NULL,
	"merge_reason" varchar,
	"merged_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"normalized_phone" varchar,
	"normalized_email" varchar,
	"display_name" varchar,
	"city" varchar,
	"first_seen_platform" varchar NOT NULL,
	"last_active_platform" varchar NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_purge_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"record_type" text NOT NULL,
	"record_id" varchar NOT NULL,
	"captured_at" timestamp,
	"purged_at" timestamp DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"synced" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp,
	"crm_lead_id" text,
	"source" text,
	"is_discount" boolean DEFAULT false NOT NULL,
	"is_paid" boolean DEFAULT false NOT NULL,
	"count_in_analytics" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_retention_account_status" (
	"business_account_id" varchar PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"last_run_at" timestamp NOT NULL,
	"due_leads" integer DEFAULT 0 NOT NULL,
	"due_conversations" integer DEFAULT 0 NOT NULL,
	"last_purged_leads" integer DEFAULT 0 NOT NULL,
	"last_purged_conversations" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "data_retention_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" varchar NOT NULL,
	"mode" text DEFAULT 'off' NOT NULL,
	"delete_synced_after_minutes" integer DEFAULT 1440 NOT NULL,
	"delete_unsynced_after_minutes" integer,
	"delete_idle_chats_after_minutes" integer DEFAULT 1440,
	"keep_anonymous_counts" boolean DEFAULT true NOT NULL,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"order_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"customer_email" text,
	"product_name" text NOT NULL,
	"product_description" text,
	"product_image_url" text,
	"amount" numeric(10, 2),
	"status" text DEFAULT 'confirmed' NOT NULL,
	"courier" text,
	"tracking_number" text,
	"estimated_delivery" date,
	"order_date" date,
	"items" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_pages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"token" text NOT NULL,
	"title" text,
	"description" text,
	"appearance" text,
	"is_active" text DEFAULT 'true' NOT NULL,
	"expires_at" timestamp,
	"last_viewed_at" timestamp,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "demo_pages_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "discount_offers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"visitor_session_id" varchar NOT NULL,
	"discount_rule_id" varchar NOT NULL,
	"product_id" varchar,
	"discount_code" text NOT NULL,
	"discount_percentage" numeric(5, 2) NOT NULL,
	"intent_score" numeric(5, 2),
	"offered_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"redeemed" boolean DEFAULT false NOT NULL,
	"redeemed_at" timestamp,
	"revenue_impact" numeric(10, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"product_id" varchar,
	"intent_threshold" integer DEFAULT 70 NOT NULL,
	"discount_percentage" integer NOT NULL,
	"discount_message" text NOT NULL,
	"cooldown_minutes" integer DEFAULT 1440 NOT NULL,
	"expiry_minutes" integer DEFAULT 60 NOT NULL,
	"max_uses_per_visitor" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"training_document_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"chunk_text" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_type_prompt_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_type_id" varchar NOT NULL,
	"prompt_template" text,
	"extraction_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation_rules" jsonb,
	"version" integer NOT NULL,
	"changed_by" varchar,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"prompt_template" text,
	"extraction_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation_rules" jsonb,
	"lead_field_mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmation_required" text,
	"scan_model" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_configurations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"erp_type" text DEFAULT 'generic' NOT NULL,
	"base_url" text NOT NULL,
	"auth_type" text DEFAULT 'api_key' NOT NULL,
	"api_key" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"basic_auth_username" text,
	"basic_auth_password" text,
	"products_endpoint" text DEFAULT '/products',
	"product_detail_endpoint" text DEFAULT '/products/{id}',
	"categories_endpoint" text DEFAULT '/categories',
	"delta_sync_endpoint" text,
	"sync_enabled" text DEFAULT 'true' NOT NULL,
	"sync_frequency_hours" integer DEFAULT 12 NOT NULL,
	"full_sync_day_of_week" integer DEFAULT 0,
	"batch_size" integer DEFAULT 500 NOT NULL,
	"field_mapping" jsonb,
	"cache_enabled" text DEFAULT 'true' NOT NULL,
	"cache_ttl_minutes" integer DEFAULT 30 NOT NULL,
	"is_active" text DEFAULT 'true' NOT NULL,
	"last_tested_at" timestamp,
	"last_test_status" text,
	"last_test_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "erp_configurations_business_account_id_unique" UNIQUE("business_account_id")
);
--> statement-breakpoint
CREATE TABLE "erp_product_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"erp_configuration_id" varchar,
	"erp_product_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"price" numeric(10, 2),
	"currency" text DEFAULT 'INR',
	"category" text,
	"subcategory" text,
	"images" jsonb,
	"in_stock" text DEFAULT 'true',
	"weight" text,
	"metal" text,
	"additional_attributes" jsonb,
	"cached_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"is_valid" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_sync_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"erp_configuration_id" varchar,
	"sync_type" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total_products" integer DEFAULT 0,
	"processed_products" integer DEFAULT 0,
	"new_embeddings" integer DEFAULT 0,
	"updated_embeddings" integer DEFAULT 0,
	"deleted_embeddings" integer DEFAULT 0,
	"failed_products" integer DEFAULT 0,
	"last_processed_page" integer DEFAULT 0,
	"last_processed_product_id" text,
	"use_batch_api" text DEFAULT 'false',
	"embedding_method" text DEFAULT 'standard',
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_seconds" integer,
	"error_message" text,
	"error_details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exit_intent_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"require_cart_items" boolean DEFAULT true NOT NULL,
	"mobile_exit_enabled" boolean DEFAULT true NOT NULL,
	"discount_percentage" integer DEFAULT 10 NOT NULL,
	"discount_message" text DEFAULT 'Wait! Before you go, here''s a special {discount}% discount just for you!' NOT NULL,
	"cooldown_minutes" integer DEFAULT 1440 NOT NULL,
	"expiry_minutes" integer DEFAULT 30 NOT NULL,
	"max_uses_per_visitor" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exit_intent_settings_business_account_id_unique" UNIQUE("business_account_id")
);
--> statement-breakpoint
CREATE TABLE "facebook_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"post_id" text,
	"comment_id" text,
	"comment_text" text,
	"commenter_name" text,
	"commenter_id" text,
	"reply_text" text,
	"reply_comment_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"dm_status" text,
	"dm_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facebook_flow_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"flow_id" varchar NOT NULL,
	"sender_id" text NOT NULL,
	"current_step_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"collected_data" jsonb DEFAULT '{}'::jsonb,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facebook_flow_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" varchar NOT NULL,
	"step_key" text NOT NULL,
	"step_order" integer DEFAULT 0 NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb,
	"next_step_mapping" jsonb,
	"default_next_step" text,
	"save_to_field" text,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facebook_flows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" text DEFAULT 'false' NOT NULL,
	"trigger_keyword" text,
	"fallback_to_ai" text DEFAULT 'true' NOT NULL,
	"session_timeout" integer DEFAULT 30,
	"completion_message" text DEFAULT 'Thank you! Your information has been recorded.',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facebook_lead_fields" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"field_key" text NOT NULL,
	"field_label" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facebook_leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"sender_id" text NOT NULL,
	"sender_name" text,
	"flow_session_id" varchar,
	"extracted_data" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facebook_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"sender_id" text NOT NULL,
	"sender_name" text,
	"message_text" text,
	"direction" text DEFAULT 'incoming' NOT NULL,
	"fb_message_id" text,
	"message_type" text DEFAULT 'text' NOT NULL,
	"media_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facebook_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"facebook_enabled" text DEFAULT 'true' NOT NULL,
	"page_id" text,
	"page_access_token" text,
	"app_secret" text,
	"webhook_verify_token" text,
	"auto_reply_enabled" text DEFAULT 'false' NOT NULL,
	"lead_capture_enabled" text DEFAULT 'true' NOT NULL,
	"comment_auto_reply_enabled" text DEFAULT 'false' NOT NULL,
	"comment_reply_mode" text DEFAULT 'all' NOT NULL,
	"comment_trigger_keywords" jsonb,
	"comment_reply_delay" numeric(4, 0) DEFAULT '5' NOT NULL,
	"comment_max_replies_per_post" numeric(4, 0) DEFAULT '50' NOT NULL,
	"comment_ignore_own_replies" text DEFAULT 'true' NOT NULL,
	"comment_auto_dm_enabled" text DEFAULT 'false' NOT NULL,
	"comment_dm_mode" text DEFAULT 'all' NOT NULL,
	"comment_dm_trigger_keywords" jsonb,
	"comment_dm_template" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "facebook_settings_business_account_id_unique" UNIQUE("business_account_id")
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"category" text,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guidance_campaigns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" text DEFAULT 'true' NOT NULL,
	"show_header" text DEFAULT 'false' NOT NULL,
	"widget_size" text DEFAULT 'half' NOT NULL,
	"voice_mode_enabled" text DEFAULT 'false' NOT NULL,
	"voice_mode_position" text DEFAULT 'in-chat' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idle_timeout_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"require_cart_items" boolean DEFAULT true NOT NULL,
	"idle_timeout_seconds" integer DEFAULT 120 NOT NULL,
	"discount_percentage" integer DEFAULT 10 NOT NULL,
	"discount_message" text DEFAULT 'Still thinking it over? Here''s {discount}% off to help you decide!' NOT NULL,
	"cooldown_minutes" integer DEFAULT 1440 NOT NULL,
	"expiry_minutes" integer DEFAULT 30 NOT NULL,
	"max_uses_per_visitor" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idle_timeout_settings_business_account_id_unique" UNIQUE("business_account_id")
);
--> statement-breakpoint
CREATE TABLE "instagram_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"post_id" text,
	"comment_id" text,
	"comment_text" text,
	"commenter_username" text,
	"commenter_id" text,
	"reply_text" text,
	"reply_comment_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"dm_status" text,
	"dm_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_flow_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"flow_id" varchar NOT NULL,
	"sender_id" text NOT NULL,
	"current_step_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"collected_data" jsonb DEFAULT '{}'::jsonb,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_flow_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" varchar NOT NULL,
	"step_key" text NOT NULL,
	"step_order" integer DEFAULT 0 NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb,
	"next_step_mapping" jsonb,
	"default_next_step" text,
	"save_to_field" text,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_flows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" text DEFAULT 'false' NOT NULL,
	"trigger_keyword" text,
	"fallback_to_ai" text DEFAULT 'true' NOT NULL,
	"session_timeout" integer DEFAULT 30,
	"completion_message" text DEFAULT 'Thank you! Your information has been recorded.',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_lead_fields" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"field_key" text NOT NULL,
	"field_label" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"sender_id" text NOT NULL,
	"sender_username" text,
	"flow_session_id" varchar,
	"extracted_data" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"sender_id" text NOT NULL,
	"sender_username" text,
	"message_text" text,
	"direction" text DEFAULT 'incoming' NOT NULL,
	"ig_message_id" text,
	"message_type" text DEFAULT 'text' NOT NULL,
	"media_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"instagram_enabled" text DEFAULT 'true' NOT NULL,
	"ig_account_id" text,
	"ig_access_token" text,
	"app_secret" text,
	"webhook_verify_token" text,
	"auto_reply_enabled" text DEFAULT 'false' NOT NULL,
	"lead_capture_enabled" text DEFAULT 'true' NOT NULL,
	"comment_auto_reply_enabled" text DEFAULT 'false' NOT NULL,
	"comment_reply_mode" text DEFAULT 'all' NOT NULL,
	"comment_trigger_keywords" jsonb,
	"comment_reply_delay" numeric(4, 0) DEFAULT '5' NOT NULL,
	"comment_max_replies_per_post" numeric(4, 0) DEFAULT '50' NOT NULL,
	"comment_ignore_own_replies" text DEFAULT 'true' NOT NULL,
	"comment_auto_dm_enabled" text DEFAULT 'false' NOT NULL,
	"comment_dm_mode" text DEFAULT 'all' NOT NULL,
	"comment_dm_trigger_keywords" jsonb,
	"comment_dm_template" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instagram_settings_business_account_id_unique" UNIQUE("business_account_id")
);
--> statement-breakpoint
CREATE TABLE "intent_scores" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"visitor_session_id" varchar NOT NULL,
	"product_id" varchar,
	"score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"signals" jsonb,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_applicants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"resume_url" text,
	"resume_text" text,
	"skills" jsonb DEFAULT '[]'::jsonb,
	"experience_summary" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"conversation_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_applications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"applicant_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"match_score" numeric(5, 2),
	"applied_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"requirements" text,
	"location" text,
	"salary_min" numeric(12, 2),
	"salary_max" numeric(12, 2),
	"currency" text DEFAULT 'INR',
	"job_type" text DEFAULT 'full-time' NOT NULL,
	"experience_level" text,
	"department" text,
	"skills" jsonb DEFAULT '[]'::jsonb,
	"text_embedding" vector(1536),
	"external_ref_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_responses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"journey_id" varchar NOT NULL,
	"conversation_id" varchar NOT NULL,
	"step_id" varchar NOT NULL,
	"response" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" varchar NOT NULL,
	"conversation_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"current_step_index" numeric(5, 0) DEFAULT '0' NOT NULL,
	"completed" text DEFAULT 'false' NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" varchar NOT NULL,
	"step_order" numeric(5, 0) NOT NULL,
	"question_text" text NOT NULL,
	"question_type" text DEFAULT 'text' NOT NULL,
	"field_name" text,
	"crm_field_key" text,
	"is_required" text DEFAULT 'false' NOT NULL,
	"multiple_choice_options" text,
	"tool_trigger" text,
	"tool_parameters" text,
	"branching_condition" text,
	"exit_on_value" text,
	"exit_message" text,
	"skip_on_value" text,
	"skip_to_step_index" integer,
	"is_conditional" text DEFAULT 'false' NOT NULL,
	"completion_button_text" text,
	"placeholder_text" text,
	"help_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "k12_chapters" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "k12_questions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"question_html" text NOT NULL,
	"question_type" text DEFAULT 'objective' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"solution_html" text,
	"difficulty" integer DEFAULT 5,
	"marks" integer DEFAULT 1,
	"external_ref_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "k12_subjects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"grade" text,
	"board" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "k12_topic_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"title" text DEFAULT 'Revision Notes' NOT NULL,
	"content" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "k12_topic_videos" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"title" text DEFAULT 'Video' NOT NULL,
	"video_url" text NOT NULL,
	"transcript" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "k12_topics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"video_url" text,
	"video_transcript" text,
	"media_duration" integer,
	"revision_notes_html" text,
	"revision_notes_image_url" text,
	"external_ref_id" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"message" text,
	"city" text,
	"source_url" text,
	"conversation_id" varchar,
	"topics_of_interest" jsonb,
	"leadsquared_sync_status" text,
	"leadsquared_synced_at" timestamp,
	"leadsquared_lead_id" text,
	"leadsquared_sync_error" text,
	"leadsquared_sync_payload" jsonb,
	"leadsquared_retry_count" numeric(2, 0) DEFAULT '0',
	"leadsquared_next_retry_at" timestamp,
	"salesforce_sync_status" text,
	"salesforce_synced_at" timestamp,
	"salesforce_lead_id" text,
	"salesforce_sync_error" text,
	"custom_crm_sync_status" text,
	"custom_crm_synced_at" timestamp,
	"custom_crm_lead_id" text,
	"custom_crm_sync_error" text,
	"custom_crm_sync_payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leadsquared_field_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"leadsquared_field" text NOT NULL,
	"source_type" text NOT NULL,
	"source_field" text,
	"custom_value" text,
	"fallback_value" text,
	"value_when_present" text,
	"display_name" text NOT NULL,
	"is_enabled" text DEFAULT 'true' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leadsquared_url_extraction_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"business_account_id" varchar NOT NULL,
	"university" text,
	"product" text,
	"extracted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "url_business_unique" UNIQUE("url","business_account_id")
);
--> statement-breakpoint
CREATE TABLE "leadsquared_url_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"url_pattern" text NOT NULL,
	"university" text,
	"product" text,
	"is_enabled" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "url_pattern_business_unique" UNIQUE("url_pattern","business_account_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_campaign_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" varchar NOT NULL,
	"recipient_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"direction" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_campaign_recipients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"group_id" varchar,
	"phone" text NOT NULL,
	"name" text DEFAULT '',
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"msg91_message_id" text,
	"error_message" text,
	"provider_response" jsonb,
	"send_phone" text,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"first_reply_at" timestamp,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"ai_reply_count" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp,
	"primary_classification" text,
	"disposition_data" jsonb DEFAULT '{}'::jsonb,
	"callback_required" boolean DEFAULT false NOT NULL,
	"callback_reason" text,
	"customer_feedback" text,
	"classified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_campaigns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"campaign_type" text DEFAULT 'one_time' NOT NULL,
	"template_id" varchar NOT NULL,
	"template_params" jsonb DEFAULT '[]'::jsonb,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipient_source_type" text,
	"recipient_workbook_id" varchar,
	"recipient_workbook_sheet_id" text,
	"recipient_phone_column" text,
	"recipient_name_column" text DEFAULT '',
	"recipient_record_key_column" text,
	"recipient_date_column" text,
	"recipient_date_offset_days" integer DEFAULT 0 NOT NULL,
	"recipient_status_column" text DEFAULT '',
	"recipient_eligible_statuses" jsonb DEFAULT '[]'::jsonb,
	"recipient_ai_allowed_fields" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"replied_count" integer DEFAULT 0 NOT NULL,
	"opted_out_count" integer DEFAULT 0 NOT NULL,
	"ai_enabled" text DEFAULT 'true' NOT NULL,
	"ai_agent_name" text DEFAULT 'Sales Agent',
	"ai_system_prompt" text DEFAULT '',
	"ai_use_faqs" text DEFAULT 'true' NOT NULL,
	"ai_use_docs" text DEFAULT 'true' NOT NULL,
	"ai_use_products" text DEFAULT 'true' NOT NULL,
	"ai_knowledge_doc_ids" jsonb DEFAULT '[]'::jsonb,
	"reply_classifications" jsonb DEFAULT '[]'::jsonb,
	"ai_daily_token_budget" integer DEFAULT 50000 NOT NULL,
	"ai_max_replies_per_recipient" integer DEFAULT 20 NOT NULL,
	"ai_tokens_used_today" integer DEFAULT 0 NOT NULL,
	"ai_usage_date" text,
	"heartbeat_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"primary_provider" text DEFAULT 'openai' NOT NULL,
	"primary_api_key" text,
	"primary_model" text DEFAULT 'gpt-4o-mini' NOT NULL,
	"fallback_provider" text DEFAULT 'gemini' NOT NULL,
	"fallback_api_key" text,
	"fallback_model" text DEFAULT 'gemini-1.5-flash' NOT NULL,
	"master_enabled" boolean DEFAULT false NOT NULL,
	"fallback_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"image_url" text,
	"metadata" text,
	"interaction_source" text DEFAULT 'chat' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging_credentials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"provider" text DEFAULT 'msg91' NOT NULL,
	"msg91_auth_key_encrypted" text,
	"msg91_sender_id" text,
	"msg91_template_id" text,
	"otp_template_body" text,
	"whatsapp_otp_template_name" text,
	"otp_channel_preference" text DEFAULT 'sms',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_pricing" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" text NOT NULL,
	"input_cost_per_1k" numeric(10, 6) NOT NULL,
	"output_cost_per_1k" numeric(10, 6) NOT NULL,
	"cached_input_cost_per_1k" numeric(10, 6),
	"audio_input_cost_per_1k" numeric(10, 6),
	"audio_cached_input_cost_per_1k" numeric(10, 6),
	"audio_output_cost_per_1k" numeric(10, 6),
	"effective_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "model_pricing_model_unique" UNIQUE("model")
);
--> statement-breakpoint
CREATE TABLE "openai_batch_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"erp_sync_log_id" varchar,
	"product_import_job_id" varchar,
	"openai_batch_id" text,
	"openai_input_file_id" text,
	"openai_output_file_id" text,
	"job_type" text DEFAULT 'embedding' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_requests" integer DEFAULT 0 NOT NULL,
	"completed_requests" integer DEFAULT 0 NOT NULL,
	"failed_requests" integer DEFAULT 0 NOT NULL,
	"batch_input_data" jsonb,
	"results" jsonb,
	"error_message" text,
	"error_details" jsonb,
	"submitted_at" timestamp,
	"completed_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "phone_otp_challenges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"conversation_id" varchar NOT NULL,
	"lead_id" varchar,
	"channel_origin" text,
	"provider_message_id" text,
	"failure_reason" text,
	"invalidated_at" timestamp,
	"delivery_channel" text,
	"phone_e164" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"resend_count" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified_at" timestamp,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proactive_guidance_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"campaign_id" varchar,
	"name" text NOT NULL,
	"url_pattern" text NOT NULL,
	"message" text NOT NULL,
	"conversation_starters" text,
	"is_active" text DEFAULT 'true' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"category_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_embeddings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"erp_product_id" text NOT NULL,
	"erp_configuration_id" varchar,
	"image_url" text NOT NULL,
	"image_hash" text,
	"embedding" vector(768),
	"visual_description" text,
	"cached_name" text,
	"cached_category" text,
	"cached_price" numeric(10, 2),
	"cached_thumbnail_url" text,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	"sync_version" integer DEFAULT 1 NOT NULL,
	"is_active" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_import_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"total_embeddings" integer DEFAULT 0 NOT NULL,
	"processed_embeddings" integer DEFAULT 0 NOT NULL,
	"file_name" text,
	"file_size" integer,
	"errors" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_jewelry_embeddings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"jewelry_type" text NOT NULL,
	"confidence" numeric(5, 4),
	"cropped_image_url" text,
	"processed_image_url" text,
	"bounding_box" jsonb,
	"embedding" vector(768),
	"description" text,
	"description_embedding" vector(1536),
	"attributes" jsonb,
	"is_primary" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_relationships" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"source_product_id" varchar NOT NULL,
	"target_product_id" varchar NOT NULL,
	"relationship_type" text NOT NULL,
	"weight" numeric(3, 2) DEFAULT '1.00',
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_tags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"tag_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"price" numeric(10, 2),
	"image_url" text,
	"cropped_jewelry_url" text,
	"detected_jewelry_type" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"shopify_product_id" text,
	"shopify_last_synced_at" timestamp,
	"is_editable" text DEFAULT 'true' NOT NULL,
	"visual_description" text,
	"image_embedding" vector(768),
	"full_image_embedding" vector(768),
	"image_hash" text,
	"vision_warehouse_asset_id" text,
	"vision_warehouse_synced_at" timestamp,
	"product_search_product_id" text,
	"product_search_synced_at" timestamp,
	"text_embedding" vector(1536),
	"text_embedding_generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_chat_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"token" text NOT NULL,
	"is_active" text DEFAULT 'true' NOT NULL,
	"password" text,
	"last_accessed_at" timestamp,
	"access_count" numeric(10, 0) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "public_chat_links_business_account_id_unique" UNIQUE("business_account_id"),
	CONSTRAINT "public_chat_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "question_bank_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"conversation_id" varchar,
	"message_id" varchar,
	"question" text NOT NULL,
	"ai_response" text,
	"user_context" text,
	"status" text DEFAULT 'new' NOT NULL,
	"category" text,
	"confidence_score" numeric(3, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restore_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backup_key" text NOT NULL,
	"backup_type" text NOT NULL,
	"backup_date" text NOT NULL,
	"restored_by" varchar,
	"restored_by_email" text,
	"duration_ms" numeric(10, 0),
	"status" text DEFAULT 'success' NOT NULL,
	"error_message" text,
	"restored_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salesforce_field_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"salesforce_field" text NOT NULL,
	"source_type" text NOT NULL,
	"source_field" text,
	"custom_value" text,
	"display_name" text NOT NULL,
	"is_enabled" text DEFAULT 'true' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"day_of_week" numeric(1, 0) NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"slot_duration_minutes" numeric(3, 0) DEFAULT '30' NOT NULL,
	"is_active" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"session_token" text NOT NULL,
	"active_business_account_id" varchar,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "slot_overrides" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"slot_date" timestamp NOT NULL,
	"slot_time" text NOT NULL,
	"duration_minutes" numeric(3, 0) DEFAULT '30' NOT NULL,
	"is_available" text DEFAULT 'true' NOT NULL,
	"is_all_day" text DEFAULT 'false' NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smart_replies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"channel" varchar NOT NULL,
	"keywords" text NOT NULL,
	"response_text" text NOT NULL,
	"response_url" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"ticket_number" numeric(10, 0) NOT NULL,
	"conversation_id" varchar,
	"customer_name" text NOT NULL,
	"customer_email" text,
	"customer_phone" text,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"ai_priority" text,
	"ai_category" text,
	"sentiment_score" numeric(3, 2),
	"emotional_state" text,
	"churn_risk" text DEFAULT 'low' NOT NULL,
	"ai_analysis" text,
	"ai_drafted_response" text,
	"auto_resolved" text DEFAULT 'false' NOT NULL,
	"auto_resolved_at" timestamp,
	"auto_resolution_summary" text,
	"assigned_to" varchar,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	"customer_rating" numeric(1, 0),
	"customer_feedback" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"is_encrypted" text DEFAULT 'true' NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#3b82f6',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" varchar NOT NULL,
	"message_id" varchar,
	"filename" text NOT NULL,
	"original_filename" text NOT NULL,
	"file_size" numeric(10, 0) NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"uploaded_by" varchar,
	"uploader_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"insight_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"related_ticket_ids" text,
	"suggested_action" text,
	"impact" text,
	"ai_generated" text DEFAULT 'true' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" varchar NOT NULL,
	"sender_id" varchar,
	"sender_type" text NOT NULL,
	"sender_name" text NOT NULL,
	"sender_email" text,
	"message" text NOT NULL,
	"message_type" text DEFAULT 'response' NOT NULL,
	"is_internal" text DEFAULT 'false' NOT NULL,
	"ai_drafted" text DEFAULT 'false' NOT NULL,
	"ai_confidence" numeric(3, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topscholar_content_chunks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"cp_id" text NOT NULL,
	"content_type" text NOT NULL,
	"subject" text,
	"subject_id" text,
	"chapter" text,
	"title" text,
	"board" text,
	"medium" text,
	"grade" text,
	"content_html" text,
	"content_text" text NOT NULL,
	"source_ref" text,
	"media_url" text,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"content_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topscholar_content_sync" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"cp_id" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"note_count" integer DEFAULT 0 NOT NULL,
	"transcript_count" integer DEFAULT 0 NOT NULL,
	"ebook_page_count" integer DEFAULT 0 NOT NULL,
	"question_count" integer DEFAULT 0 NOT NULL,
	"media_count" integer DEFAULT 0 NOT NULL,
	"sync_mode" text DEFAULT 'full' NOT NULL,
	"store_type" text DEFAULT 'pgvector' NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"embed_job_id" varchar,
	"last_error" text,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topscholar_cp_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"cp_id" text NOT NULL,
	"board" text,
	"medium" text,
	"grade" text,
	"subject" text,
	"subject_id" text,
	"label" text,
	"cp_name" text,
	"plan_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topscholar_embed_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"cp_id" text NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"store_type" text DEFAULT 'pgvector' NOT NULL,
	"sync_mode" text DEFAULT 'full' NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"batches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topscholar_embed_staging" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"custom_id" text NOT NULL,
	"business_account_id" varchar NOT NULL,
	"cp_id" text NOT NULL,
	"content_type" text NOT NULL,
	"subject" text,
	"subject_id" text,
	"chapter" text,
	"title" text,
	"content_html" text,
	"content_text" text NOT NULL,
	"source_ref" text,
	"media_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"content_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topscholar_plan_cp_resolutions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"plan_id" text NOT NULL,
	"cp_id" text NOT NULL,
	"cp_name" text,
	"board" text,
	"medium" text,
	"grade" text,
	"subject" text,
	"subject_id" text,
	"label" text,
	"note_count" integer DEFAULT 0 NOT NULL,
	"transcript_count" integer DEFAULT 0 NOT NULL,
	"question_count" integer DEFAULT 0 NOT NULL,
	"pdf_count" integer DEFAULT 0 NOT NULL,
	"last_resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topscholar_plan_ids" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"plan_id" text NOT NULL,
	"enabled" text DEFAULT 'true' NOT NULL,
	"last_status" text DEFAULT 'idle' NOT NULL,
	"last_error" text,
	"last_cp_id" text,
	"last_cp_name" text,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topscholar_plan_run_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"plan_id" text NOT NULL,
	"cp_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topscholar_plan_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"plan_id" text NOT NULL,
	"requested_cp_id" text,
	"mode" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"total_cp_ids" integer DEFAULT 0 NOT NULL,
	"completed_cp_ids" integer DEFAULT 0 NOT NULL,
	"failed_cp_ids" integer DEFAULT 0 NOT NULL,
	"active_cp_id" text,
	"error" text,
	"lease_owner" text,
	"lease_expires_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topscholar_plan_sync_leases" (
	"business_account_id" varchar PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topscholar_voice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"conversation_id" varchar NOT NULL,
	"student_id" text,
	"cp_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"board" text,
	"medium" text,
	"grade" text,
	"subject" text,
	"chapter" text,
	"is_internal_test" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"disconnected_at" timestamp,
	"disconnect_reason" text
);
--> statement-breakpoint
CREATE TABLE "trained_urls" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"description" text,
	"extracted_text" text,
	"summary" text,
	"key_points" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"embedding_status" text DEFAULT 'not_started',
	"embedded_chunk_count" numeric(10, 0) DEFAULT '0',
	"error_message" text,
	"added_by" varchar NOT NULL,
	"crawled_at" timestamp,
	"processed_at" timestamp,
	"embedded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"filename" text NOT NULL,
	"original_filename" text NOT NULL,
	"file_size" numeric(10, 0) NOT NULL,
	"storage_key" text NOT NULL,
	"upload_status" text DEFAULT 'pending' NOT NULL,
	"extracted_text" text,
	"summary" text,
	"key_points" text,
	"error_message" text,
	"uploaded_by" varchar NOT NULL,
	"processed_at" timestamp,
	"embedding_status" text DEFAULT 'not_started',
	"embedded_chunk_count" numeric(10, 0) DEFAULT '0',
	"embedded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploaded_images" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"image_url" text NOT NULL,
	"processed_image_url" text,
	"processed_images" text,
	"r2_key" text,
	"original_filename" text,
	"file_size" integer,
	"source" text DEFAULT 'visual_search' NOT NULL,
	"matched_products" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "urgency_offer_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text DEFAULT 'Default Campaign' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"countdown_duration_minutes" integer DEFAULT 10 NOT NULL,
	"discount_type" text DEFAULT 'percentage' NOT NULL,
	"discount_value" integer DEFAULT 10 NOT NULL,
	"headline" text DEFAULT 'Limited Time Offer!' NOT NULL,
	"description" text DEFAULT 'We noticed you''re interested! Here''s a special discount just for you.' NOT NULL,
	"cta_button_text" text DEFAULT 'Unlock Offer' NOT NULL,
	"dismiss_button_text" text DEFAULT 'Maybe later' NOT NULL,
	"success_message" text DEFAULT 'Your discount code has been sent to your WhatsApp!' NOT NULL,
	"phone_input_label" text DEFAULT 'Enter your WhatsApp number' NOT NULL,
	"phone_input_placeholder" text DEFAULT '+1 234 567 8900' NOT NULL,
	"require_phone" boolean DEFAULT true NOT NULL,
	"trigger_mode" text DEFAULT 'intent' NOT NULL,
	"trigger_keywords" text DEFAULT '',
	"intent_threshold" integer DEFAULT 70 NOT NULL,
	"min_messages_before_trigger" integer DEFAULT 3 NOT NULL,
	"max_offers_per_visitor" integer DEFAULT 1 NOT NULL,
	"cooldown_minutes" integer DEFAULT 30 NOT NULL,
	"show_reminder_after_dismiss" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "urgency_offers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"campaign_id" varchar,
	"visitor_token" text NOT NULL,
	"conversation_id" varchar,
	"countdown_started_at" timestamp DEFAULT now() NOT NULL,
	"countdown_expires_at" timestamp NOT NULL,
	"discount_type" text NOT NULL,
	"discount_value" integer NOT NULL,
	"discount_code" text NOT NULL,
	"phone_number" text,
	"phone_country_code" text,
	"status" text DEFAULT 'active' NOT NULL,
	"dismissed_at" timestamp,
	"redeemed_at" timestamp,
	"expired_at" timestamp,
	"intent_score" numeric(5, 2),
	"trigger_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "url_content_chunks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trained_url_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"chunk_text" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"temp_password" text,
	"temp_password_expiry" timestamp,
	"must_change_password" text DEFAULT 'false' NOT NULL,
	"role" text NOT NULL,
	"business_account_id" varchar,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_business_account_id_unique" UNIQUE("business_account_id")
);
--> statement-breakpoint
CREATE TABLE "verification_rule_sets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system_seed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" varchar NOT NULL,
	"rule_type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"message_template" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_daily_stats" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"date" date NOT NULL,
	"opened_chat_count" integer DEFAULT 0 NOT NULL,
	"desktop_count" integer DEFAULT 0 NOT NULL,
	"mobile_count" integer DEFAULT 0 NOT NULL,
	"tablet_count" integer DEFAULT 0 NOT NULL,
	"top_countries" jsonb DEFAULT '[]'::jsonb,
	"top_cities" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vista_studio_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"template_id" text NOT NULL,
	"prompt" text NOT NULL,
	"original_image_url" text NOT NULL,
	"generated_image_url" text,
	"provider" text DEFAULT 'openai' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"source" text NOT NULL,
	"provider_id" text NOT NULL,
	"kind" text DEFAULT 'inbound',
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_analysis" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"website_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"analyzed_content" text,
	"error_message" text,
	"last_analyzed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "website_analysis_business_account_id_unique" UNIQUE("business_account_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_ai_workbook_campaign_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"workbook_id" varchar NOT NULL,
	"workbook_version_id" varchar NOT NULL,
	"contact_group_id" varchar NOT NULL,
	"campaign_id" varchar,
	"sheet_id" text NOT NULL,
	"mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"row_ids_by_phone" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'audience_ready' NOT NULL,
	"last_synced_at" timestamp,
	"last_synced_version_id" varchar,
	"synced_row_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_ai_workbook_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workbook_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"source_campaign_id" varchar,
	"version_number" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_file_name" text,
	"sheets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_ai_workbooks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"source_campaign_id" varchar,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_campaign_automation_dispatches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"run_id" varchar NOT NULL,
	"record_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_campaign_automation_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"campaign_id" varchar,
	"contact_group_id" varchar,
	"source_file_name" text NOT NULL,
	"source_type" text DEFAULT 'upload' NOT NULL,
	"source_campaign_id" varchar,
	"source_campaign_name" text,
	"source_campaign_updated_at" timestamp,
	"source_workbook_id" varchar,
	"source_workbook_version_id" varchar,
	"source_workbook_sheet_id" text,
	"source_workbook_name" text,
	"source_workbook_version_number" integer,
	"source_workbook_revision" integer,
	"source_workbook_sheet_name" text,
	"source_group_ids" jsonb DEFAULT '[]'::jsonb,
	"source_group_names" jsonb DEFAULT '[]'::jsonb,
	"source_snapshot" jsonb,
	"blueprint_snapshot" jsonb,
	"status" text DEFAULT 'awaiting_review' NOT NULL,
	"scheduled_at" timestamp,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"eligible_rows" integer DEFAULT 0 NOT NULL,
	"excluded_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_campaign_automations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"source_type" text DEFAULT 'upload' NOT NULL,
	"source_campaign_id" varchar,
	"source_workbook_id" varchar,
	"source_workbook_sheet_id" text,
	"source_group_ids" jsonb DEFAULT '[]'::jsonb,
	"template_id" varchar NOT NULL,
	"template_params" jsonb DEFAULT '[]'::jsonb,
	"phone_column" text NOT NULL,
	"name_column" text DEFAULT '',
	"record_key_column" text NOT NULL,
	"date_column" text NOT NULL,
	"date_offset_days" integer DEFAULT 0 NOT NULL,
	"status_column" text DEFAULT '',
	"eligible_statuses" jsonb DEFAULT '[]'::jsonb,
	"default_country_code" text DEFAULT '91' NOT NULL,
	"send_mode" text DEFAULT 'review' NOT NULL,
	"send_time" text DEFAULT '10:00' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_flow_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"flow_id" varchar NOT NULL,
	"sender_phone" text NOT NULL,
	"current_step_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"collected_data" jsonb DEFAULT '{}'::jsonb,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_flow_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" varchar NOT NULL,
	"step_key" text NOT NULL,
	"step_order" integer DEFAULT 0 NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb,
	"next_step_mapping" jsonb,
	"default_next_step" text,
	"save_to_field" text,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_flows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" text DEFAULT 'false' NOT NULL,
	"trigger_keyword" text,
	"fallback_to_ai" text DEFAULT 'true' NOT NULL,
	"adaptive_mode" text DEFAULT 'false' NOT NULL,
	"session_timeout" integer DEFAULT 30,
	"completion_message" text DEFAULT 'Thank you! Your information has been recorded.',
	"repeat_mode" text DEFAULT 'once' NOT NULL,
	"verification_rule_set_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_lead_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" varchar NOT NULL,
	"business_account_id" varchar NOT NULL,
	"file_name" text,
	"file_type" text,
	"mime_type" text,
	"file_size" integer,
	"file_path" text,
	"media_id" text,
	"media_url" text,
	"caption" text,
	"document_category" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_lead_fields" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"field_key" text NOT NULL,
	"field_label" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"default_crm_field_key" text,
	"allowed_values" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"whatsapp_message_id" text,
	"sender_phone" text,
	"sender_name" text,
	"customer_name" text,
	"customer_phone" text,
	"customer_email" text,
	"notes" text,
	"raw_message" text,
	"extracted_data" jsonb,
	"loan_amount" numeric(15, 2),
	"loan_type" text,
	"address" text,
	"status" text DEFAULT 'new' NOT NULL,
	"direction" text DEFAULT 'incoming' NOT NULL,
	"flow_session_id" varchar,
	"leadsquared_lead_id" text,
	"leadsquared_sync_status" text,
	"leadsquared_sync_error" text,
	"custom_crm_sync_status" text,
	"custom_crm_lead_id" text,
	"custom_crm_sync_error" text,
	"custom_crm_sync_payload" jsonb,
	"custom_crm_synced_at" timestamp,
	"verification_results" jsonb,
	"verification_run_at" timestamp,
	"last_message_at" timestamp,
	"last_message" text,
	"conversation_count" integer DEFAULT 1 NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_opt_outs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"phone" text NOT NULL,
	"reason" text DEFAULT 'user_stop',
	"campaign_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"phone_number" text NOT NULL,
	"last_user_message_at" timestamp DEFAULT now() NOT NULL,
	"session_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_sessions_business_account_id_phone_number_unique" UNIQUE("business_account_id","phone_number")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"whatsapp_enabled" text DEFAULT 'true' NOT NULL,
	"msg91_auth_key" text,
	"whatsapp_number" text,
	"webhook_secret" text,
	"extraction_fields" jsonb DEFAULT '["name","phone","email","loan_amount","loan_type","address"]'::jsonb,
	"custom_prompt" text,
	"auto_sync_to_leadsquared" text DEFAULT 'false' NOT NULL,
	"lead_capture_enabled" text DEFAULT 'true' NOT NULL,
	"lead_generation_mode" text DEFAULT 'first_message' NOT NULL,
	"require_name" text DEFAULT 'false' NOT NULL,
	"require_phone" text DEFAULT 'false' NOT NULL,
	"require_email" text DEFAULT 'false' NOT NULL,
	"min_fields_required" integer DEFAULT 1 NOT NULL,
	"auto_reply_enabled" text DEFAULT 'false' NOT NULL,
	"msg91_integrated_number_id" text,
	"new_application_cooldown_days" integer DEFAULT 7 NOT NULL,
	"phone_number_length" integer DEFAULT 10 NOT NULL,
	"update_lead_enabled" text DEFAULT 'true' NOT NULL,
	"use_master_training" text DEFAULT 'true' NOT NULL,
	"use_lead_training" text DEFAULT 'true' NOT NULL,
	"whitelist_enabled" text DEFAULT 'false' NOT NULL,
	"session_template_name" text,
	"session_template_namespace" text,
	"doc_confirmation_enabled" text DEFAULT 'false' NOT NULL,
	"doc_confirmation_mode" text DEFAULT 'per_document' NOT NULL,
	"doc_confirmation_header" text DEFAULT 'Please review the details extracted from your document:',
	"doc_confirmation_footer" text DEFAULT 'Are these details correct?',
	"use_case_mode" text DEFAULT 'lead_capture' NOT NULL,
	"ai_response_mode" text,
	"use_faq_knowledge" text DEFAULT 'true' NOT NULL,
	"use_document_knowledge" text DEFAULT 'true' NOT NULL,
	"use_website_knowledge" text DEFAULT 'true' NOT NULL,
	"use_product_catalog_knowledge" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_settings_business_account_id_unique" UNIQUE("business_account_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"category" text DEFAULT 'MARKETING' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"header_type" text DEFAULT 'none',
	"header_text" text DEFAULT '',
	"header_media_url" text DEFAULT '',
	"footer_text" text DEFAULT '',
	"buttons" jsonb DEFAULT '[]'::jsonb,
	"param_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"msg91_template_id" text,
	"namespace" text,
	"rejection_reason" text,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_whatsapp_number" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_whitelist" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"phone_number" text NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_whitelist_business_account_id_phone_number_unique" UNIQUE("business_account_id","phone_number")
);
--> statement-breakpoint
CREATE TABLE "widget_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" varchar NOT NULL,
	"chat_color" text DEFAULT '#9333ea' NOT NULL,
	"chat_color_end" text DEFAULT '#3b82f6' NOT NULL,
	"widget_header_text" text DEFAULT 'Hi Chroney' NOT NULL,
	"welcome_message_type" text DEFAULT 'custom' NOT NULL,
	"welcome_message" text DEFAULT 'Hi! How can I help you today?' NOT NULL,
	"button_style" text DEFAULT 'circular' NOT NULL,
	"button_animation" text DEFAULT 'pulse' NOT NULL,
	"personality" text DEFAULT 'friendly' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"custom_instructions" text,
	"cached_intro" text,
	"appointment_booking_enabled" text DEFAULT 'true' NOT NULL,
	"appointment_suggest_rules" jsonb,
	"shopify_store_url" text,
	"shopify_access_token" text,
	"shopify_client_id" text,
	"shopify_client_secret" text,
	"shopify_oauth_state" text,
	"shopify_oauth_state_expiry" timestamp,
	"twilio_account_sid" text,
	"twilio_auth_token" text,
	"twilio_whatsapp_from" text,
	"widget_width" numeric(5, 0) DEFAULT '400' NOT NULL,
	"widget_height" numeric(5, 0) DEFAULT '600' NOT NULL,
	"widget_position" text DEFAULT 'bottom-right' NOT NULL,
	"bubble_size" numeric(3, 0) DEFAULT '60' NOT NULL,
	"size_preset" text DEFAULT 'medium' NOT NULL,
	"pill_bottom_offset" numeric(4, 0) DEFAULT '20' NOT NULL,
	"pill_side_offset" numeric(4, 0) DEFAULT '20' NOT NULL,
	"response_length" text DEFAULT 'balanced' NOT NULL,
	"chat_font_size" text DEFAULT 'medium' NOT NULL,
	"footer_label_enabled" text DEFAULT 'false' NOT NULL,
	"footer_label_text" text DEFAULT 'AI may make mistakes' NOT NULL,
	"powered_by_enabled" text DEFAULT 'true' NOT NULL,
	"auto_open_chat" text DEFAULT 'false' NOT NULL,
	"auto_open_frequency" text DEFAULT 'once' NOT NULL,
	"opening_sound_enabled" text DEFAULT 'true' NOT NULL,
	"opening_sound_style" text DEFAULT 'chime' NOT NULL,
	"lead_training_config" jsonb,
	"captcha_secret_key_enc" text,
	"avatar_type" text DEFAULT 'none' NOT NULL,
	"avatar_url" text,
	"custom_avatars" jsonb,
	"voice_selection" text DEFAULT 'shimmer' NOT NULL,
	"voice_mode_style" text DEFAULT 'circular' NOT NULL,
	"chat_mode" text DEFAULT 'both' NOT NULL,
	"conversation_starters" text,
	"conversation_starters_enabled" text DEFAULT 'true' NOT NULL,
	"show_starters_on_pill" text DEFAULT 'false' NOT NULL,
	"inactivity_nudge_enabled" text DEFAULT 'true' NOT NULL,
	"inactivity_nudge_delay" numeric(5, 0) DEFAULT '45' NOT NULL,
	"inactivity_nudge_message" text DEFAULT 'Still there? Let me know if you need any help!' NOT NULL,
	"inactivity_nudge_messages" jsonb,
	"smart_nudge_enabled" text DEFAULT 'false' NOT NULL,
	"proactive_nudge_enabled" text DEFAULT 'true' NOT NULL,
	"proactive_nudge_delay" numeric(5, 0) DEFAULT '15' NOT NULL,
	"proactive_nudge_message" text DEFAULT 'Need help finding something? I''m here to assist!' NOT NULL,
	"proactive_nudge_messages" jsonb,
	"proactive_nudge_repeat" text DEFAULT 'false' NOT NULL,
	"proactive_nudge_bg_color" text DEFAULT '#ffffff' NOT NULL,
	"proactive_nudge_bg_color_end" text DEFAULT '#ffffff' NOT NULL,
	"proactive_nudge_text_color" text DEFAULT '#1f2937' NOT NULL,
	"center_banner_enabled" text DEFAULT 'false' NOT NULL,
	"center_banner_delay" numeric(5, 0) DEFAULT '10' NOT NULL,
	"center_banner_title" text DEFAULT 'Need Help?' NOT NULL,
	"center_banner_description" text DEFAULT 'Let me help you find exactly what you''re looking for.' NOT NULL,
	"center_banner_button_text" text DEFAULT 'Start Chat' NOT NULL,
	"center_banner_show_once" text DEFAULT 'true' NOT NULL,
	"center_banner_background_style" text DEFAULT 'gradient' NOT NULL,
	"center_banner_start_color" text DEFAULT '#9333ea' NOT NULL,
	"center_banner_end_color" text DEFAULT '#3b82f6' NOT NULL,
	"center_banner_text_color" text DEFAULT 'white' NOT NULL,
	"center_banner_image_url" text,
	"reengagement_banner_enabled" text DEFAULT 'false' NOT NULL,
	"reengagement_banner_delay" numeric(5, 0) DEFAULT '60' NOT NULL,
	"reengagement_banner_title" text DEFAULT 'Still looking around?' NOT NULL,
	"reengagement_banner_description" text DEFAULT 'I''m here whenever you''re ready to chat!' NOT NULL,
	"reengagement_banner_button_text" text DEFAULT 'Chat Now' NOT NULL,
	"leadsquared_access_key" text,
	"leadsquared_secret_key" text,
	"leadsquared_region" text,
	"leadsquared_custom_host" text,
	"leadsquared_enabled" text DEFAULT 'false' NOT NULL,
	"leadsquared_connection_type" text DEFAULT 'api' NOT NULL,
	"leadsquared_uds_webhook_url" text,
	"leadsquared_uds_key" text,
	"salesforce_enabled" text DEFAULT 'false' NOT NULL,
	"salesforce_client_id" text,
	"salesforce_client_secret" text,
	"salesforce_username" text,
	"salesforce_password" text,
	"salesforce_environment" text DEFAULT 'production',
	"salesforce_instance_url" text,
	"lsq_extraction_domain" text,
	"lsq_extraction_universities" text,
	"lsq_extraction_products" text,
	"lsq_extraction_fallback_university" text DEFAULT 'Any',
	"lsq_extraction_fallback_product" text DEFAULT 'All Product',
	"language_selector_enabled" text DEFAULT 'true' NOT NULL,
	"available_languages" text DEFAULT '["auto","en","hi","hinglish","ta","te","kn","mr","bn","gu","ml","pa","or","as","ur","ne","es","fr","de","pt","it","ja","ko","zh","ar","ru","th","vi","id","ms","tr"]' NOT NULL,
	"visual_similarity_threshold" numeric(3, 0) DEFAULT '50' NOT NULL,
	"clip_similarity_threshold" numeric(3, 0) DEFAULT '70' NOT NULL,
	"description_similarity_threshold" numeric(3, 0) DEFAULT '50' NOT NULL,
	"attribute_similarity_threshold" numeric(3, 0) DEFAULT '60' NOT NULL,
	"perfect_match_threshold" numeric(3, 0) DEFAULT '96' NOT NULL,
	"very_similar_threshold" numeric(3, 0) DEFAULT '85' NOT NULL,
	"somewhat_similar_threshold" numeric(3, 0) DEFAULT '70' NOT NULL,
	"show_match_percentage" text DEFAULT 'false' NOT NULL,
	"showcase_logo" text,
	"showcase_theme_color" text DEFAULT '#9333ea' NOT NULL,
	"showcase_theme_preset" text DEFAULT 'noir_luxe' NOT NULL,
	"background_removal_enabled" text DEFAULT 'false' NOT NULL,
	"product_page_mode_enabled" text DEFAULT 'false' NOT NULL,
	"show_ai_trivia" text DEFAULT 'true' NOT NULL,
	"show_suggested_questions" text DEFAULT 'true' NOT NULL,
	"show_review_summary" text DEFAULT 'true' NOT NULL,
	"product_carousel_enabled" text DEFAULT 'false' NOT NULL,
	"featured_product_ids" jsonb,
	"product_carousel_title" text DEFAULT 'Featured Products' NOT NULL,
	"quick_browse_enabled" text DEFAULT 'false' NOT NULL,
	"quick_browse_buttons" jsonb,
	"product_comparison_enabled" text DEFAULT 'false' NOT NULL,
	"whatsapp_order_enabled" text DEFAULT 'false' NOT NULL,
	"whatsapp_order_number" text,
	"whatsapp_order_message" text DEFAULT 'Hi! I''m interested in ordering: {product_name} - {product_price}' NOT NULL,
	"launcher_mode" text DEFAULT 'ai' NOT NULL,
	"whatsapp_widget_number" text,
	"whatsapp_widget_label" text DEFAULT 'How can I help you?' NOT NULL,
	"whatsapp_widget_message" text,
	"whatsapp_widget_color" text DEFAULT '#25D366' NOT NULL,
	"whatsapp_widget_position" text,
	"add_to_cart_enabled" text DEFAULT 'false' NOT NULL,
	"try_on_enabled" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "widget_settings_business_account_id_unique" UNIQUE("business_account_id")
);
--> statement-breakpoint
ALTER TABLE "account_group_admins" ADD CONSTRAINT "account_group_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_admins" ADD CONSTRAINT "account_group_admins_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_extra_settings" ADD CONSTRAINT "account_group_extra_settings_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_journey_steps" ADD CONSTRAINT "account_group_journey_steps_journey_id_account_group_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."account_group_journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_journeys" ADD CONSTRAINT "account_group_journeys_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_leadsquared_field_mappings" ADD CONSTRAINT "account_group_leadsquared_field_mappings_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_training" ADD CONSTRAINT "account_group_training_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_training" ADD CONSTRAINT "account_group_training_last_published_by_users_id_fk" FOREIGN KEY ("last_published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_daily" ADD CONSTRAINT "ai_usage_daily_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyzed_pages" ADD CONSTRAINT "analyzed_pages_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_category_id_categories_id_fk" FOREIGN KEY ("parent_category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_menu_configs" ADD CONSTRAINT "chat_menu_configs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_menu_item_details" ADD CONSTRAINT "chat_menu_item_details_menu_item_id_chat_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."chat_menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_menu_items" ADD CONSTRAINT "chat_menu_items_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group_contacts" ADD CONSTRAINT "contact_group_contacts_group_id_contact_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."contact_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group_contacts" ADD CONSTRAINT "contact_group_contacts_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_groups" ADD CONSTRAINT "contact_groups_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_category_settings" ADD CONSTRAINT "conversation_category_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_journeys" ADD CONSTRAINT "conversation_journeys_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_store_credentials" ADD CONSTRAINT "crm_store_credentials_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_crm_field_mappings" ADD CONSTRAINT "custom_crm_field_mappings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_crm_settings" ADD CONSTRAINT "custom_crm_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_profile_id_customer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memory_snapshots" ADD CONSTRAINT "customer_memory_snapshots_profile_id_customer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memory_snapshots" ADD CONSTRAINT "customer_memory_snapshots_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merge_audit" ADD CONSTRAINT "customer_merge_audit_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_orders" ADD CONSTRAINT "demo_orders_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_pages" ADD CONSTRAINT "demo_pages_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_pages" ADD CONSTRAINT "demo_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_offers" ADD CONSTRAINT "discount_offers_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_offers" ADD CONSTRAINT "discount_offers_discount_rule_id_discount_rules_id_fk" FOREIGN KEY ("discount_rule_id") REFERENCES "public"."discount_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_offers" ADD CONSTRAINT "discount_offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_training_document_id_training_documents_id_fk" FOREIGN KEY ("training_document_id") REFERENCES "public"."training_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type_prompt_history" ADD CONSTRAINT "document_type_prompt_history_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_configurations" ADD CONSTRAINT "erp_configurations_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_product_cache" ADD CONSTRAINT "erp_product_cache_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_product_cache" ADD CONSTRAINT "erp_product_cache_erp_configuration_id_erp_configurations_id_fk" FOREIGN KEY ("erp_configuration_id") REFERENCES "public"."erp_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_sync_logs" ADD CONSTRAINT "erp_sync_logs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_sync_logs" ADD CONSTRAINT "erp_sync_logs_erp_configuration_id_erp_configurations_id_fk" FOREIGN KEY ("erp_configuration_id") REFERENCES "public"."erp_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_intent_settings" ADD CONSTRAINT "exit_intent_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_comments" ADD CONSTRAINT "facebook_comments_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_flow_sessions" ADD CONSTRAINT "facebook_flow_sessions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_flow_sessions" ADD CONSTRAINT "facebook_flow_sessions_flow_id_facebook_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."facebook_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_flow_steps" ADD CONSTRAINT "facebook_flow_steps_flow_id_facebook_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."facebook_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_flows" ADD CONSTRAINT "facebook_flows_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_lead_fields" ADD CONSTRAINT "facebook_lead_fields_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_leads" ADD CONSTRAINT "facebook_leads_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_messages" ADD CONSTRAINT "facebook_messages_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_settings" ADD CONSTRAINT "facebook_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guidance_campaigns" ADD CONSTRAINT "guidance_campaigns_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idle_timeout_settings" ADD CONSTRAINT "idle_timeout_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_comments" ADD CONSTRAINT "instagram_comments_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_flow_sessions" ADD CONSTRAINT "instagram_flow_sessions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_flow_sessions" ADD CONSTRAINT "instagram_flow_sessions_flow_id_instagram_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."instagram_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_flow_steps" ADD CONSTRAINT "instagram_flow_steps_flow_id_instagram_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."instagram_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_flows" ADD CONSTRAINT "instagram_flows_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_lead_fields" ADD CONSTRAINT "instagram_lead_fields_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_leads" ADD CONSTRAINT "instagram_leads_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_messages" ADD CONSTRAINT "instagram_messages_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_settings" ADD CONSTRAINT "instagram_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_scores" ADD CONSTRAINT "intent_scores_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_scores" ADD CONSTRAINT "intent_scores_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_applicant_id_job_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."job_applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_responses" ADD CONSTRAINT "journey_responses_session_id_journey_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."journey_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_responses" ADD CONSTRAINT "journey_responses_journey_id_conversation_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."conversation_journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_responses" ADD CONSTRAINT "journey_responses_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_responses" ADD CONSTRAINT "journey_responses_step_id_journey_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."journey_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_sessions" ADD CONSTRAINT "journey_sessions_journey_id_conversation_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."conversation_journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_sessions" ADD CONSTRAINT "journey_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_sessions" ADD CONSTRAINT "journey_sessions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_steps" ADD CONSTRAINT "journey_steps_journey_id_conversation_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."conversation_journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k12_chapters" ADD CONSTRAINT "k12_chapters_subject_id_k12_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."k12_subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k12_chapters" ADD CONSTRAINT "k12_chapters_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k12_questions" ADD CONSTRAINT "k12_questions_topic_id_k12_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."k12_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k12_questions" ADD CONSTRAINT "k12_questions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k12_subjects" ADD CONSTRAINT "k12_subjects_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k12_topic_notes" ADD CONSTRAINT "k12_topic_notes_topic_id_k12_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."k12_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k12_topic_notes" ADD CONSTRAINT "k12_topic_notes_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k12_topic_videos" ADD CONSTRAINT "k12_topic_videos_topic_id_k12_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."k12_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k12_topic_videos" ADD CONSTRAINT "k12_topic_videos_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k12_topics" ADD CONSTRAINT "k12_topics_chapter_id_k12_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."k12_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k12_topics" ADD CONSTRAINT "k12_topics_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadsquared_field_mappings" ADD CONSTRAINT "leadsquared_field_mappings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_messages" ADD CONSTRAINT "marketing_campaign_messages_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_messages" ADD CONSTRAINT "marketing_campaign_messages_recipient_id_marketing_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."marketing_campaign_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_messages" ADD CONSTRAINT "marketing_campaign_messages_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD CONSTRAINT "marketing_campaign_recipients_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD CONSTRAINT "marketing_campaign_recipients_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaign_recipients" ADD CONSTRAINT "marketing_campaign_recipients_group_id_contact_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."contact_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_template_id_whatsapp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."whatsapp_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_credentials" ADD CONSTRAINT "messaging_credentials_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openai_batch_jobs" ADD CONSTRAINT "openai_batch_jobs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openai_batch_jobs" ADD CONSTRAINT "openai_batch_jobs_erp_sync_log_id_erp_sync_logs_id_fk" FOREIGN KEY ("erp_sync_log_id") REFERENCES "public"."erp_sync_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openai_batch_jobs" ADD CONSTRAINT "openai_batch_jobs_product_import_job_id_product_import_jobs_id_fk" FOREIGN KEY ("product_import_job_id") REFERENCES "public"."product_import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_otp_challenges" ADD CONSTRAINT "phone_otp_challenges_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_otp_challenges" ADD CONSTRAINT "phone_otp_challenges_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_guidance_rules" ADD CONSTRAINT "proactive_guidance_rules_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_guidance_rules" ADD CONSTRAINT "proactive_guidance_rules_campaign_id_guidance_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."guidance_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_erp_configuration_id_erp_configurations_id_fk" FOREIGN KEY ("erp_configuration_id") REFERENCES "public"."erp_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_jobs" ADD CONSTRAINT "product_import_jobs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_jewelry_embeddings" ADD CONSTRAINT "product_jewelry_embeddings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_jewelry_embeddings" ADD CONSTRAINT "product_jewelry_embeddings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relationships" ADD CONSTRAINT "product_relationships_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relationships" ADD CONSTRAINT "product_relationships_source_product_id_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relationships" ADD CONSTRAINT "product_relationships_target_product_id_products_id_fk" FOREIGN KEY ("target_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_chat_links" ADD CONSTRAINT "public_chat_links_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_entries" ADD CONSTRAINT "question_bank_entries_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_entries" ADD CONSTRAINT "question_bank_entries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_entries" ADD CONSTRAINT "question_bank_entries_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_history" ADD CONSTRAINT "restore_history_restored_by_users_id_fk" FOREIGN KEY ("restored_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesforce_field_mappings" ADD CONSTRAINT "salesforce_field_mappings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_business_account_id_business_accounts_id_fk" FOREIGN KEY ("active_business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_overrides" ADD CONSTRAINT "slot_overrides_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_replies" ADD CONSTRAINT "smart_replies_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_message_id_ticket_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ticket_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_insights" ADD CONSTRAINT "ticket_insights_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_insights" ADD CONSTRAINT "ticket_insights_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topscholar_content_sync" ADD CONSTRAINT "topscholar_content_sync_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topscholar_cp_mappings" ADD CONSTRAINT "topscholar_cp_mappings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topscholar_embed_jobs" ADD CONSTRAINT "topscholar_embed_jobs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topscholar_embed_staging" ADD CONSTRAINT "topscholar_embed_staging_job_id_topscholar_embed_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."topscholar_embed_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topscholar_plan_cp_resolutions" ADD CONSTRAINT "topscholar_plan_cp_resolutions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topscholar_plan_ids" ADD CONSTRAINT "topscholar_plan_ids_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topscholar_plan_run_items" ADD CONSTRAINT "topscholar_plan_run_items_run_id_topscholar_plan_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."topscholar_plan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topscholar_plan_run_items" ADD CONSTRAINT "topscholar_plan_run_items_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topscholar_plan_runs" ADD CONSTRAINT "topscholar_plan_runs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topscholar_plan_sync_leases" ADD CONSTRAINT "topscholar_plan_sync_leases_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topscholar_voice_sessions" ADD CONSTRAINT "topscholar_voice_sessions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trained_urls" ADD CONSTRAINT "trained_urls_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trained_urls" ADD CONSTRAINT "trained_urls_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_documents" ADD CONSTRAINT "training_documents_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_documents" ADD CONSTRAINT "training_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploaded_images" ADD CONSTRAINT "uploaded_images_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "urgency_offer_settings" ADD CONSTRAINT "urgency_offer_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "urgency_offers" ADD CONSTRAINT "urgency_offers_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "urgency_offers" ADD CONSTRAINT "urgency_offers_campaign_id_urgency_offer_settings_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."urgency_offer_settings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "urgency_offers" ADD CONSTRAINT "urgency_offers_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_content_chunks" ADD CONSTRAINT "url_content_chunks_trained_url_id_trained_urls_id_fk" FOREIGN KEY ("trained_url_id") REFERENCES "public"."trained_urls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_content_chunks" ADD CONSTRAINT "url_content_chunks_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_rule_sets" ADD CONSTRAINT "verification_rule_sets_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_rules" ADD CONSTRAINT "verification_rules_rule_set_id_verification_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."verification_rule_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_daily_stats" ADD CONSTRAINT "visitor_daily_stats_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vista_studio_jobs" ADD CONSTRAINT "vista_studio_jobs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analysis" ADD CONSTRAINT "website_analysis_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbook_campaign_links" ADD CONSTRAINT "whatsapp_ai_workbook_campaign_links_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbook_campaign_links" ADD CONSTRAINT "whatsapp_ai_workbook_campaign_links_workbook_id_whatsapp_ai_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "public"."whatsapp_ai_workbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbook_campaign_links" ADD CONSTRAINT "whatsapp_ai_workbook_campaign_links_workbook_version_id_whatsapp_ai_workbook_versions_id_fk" FOREIGN KEY ("workbook_version_id") REFERENCES "public"."whatsapp_ai_workbook_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbook_campaign_links" ADD CONSTRAINT "whatsapp_ai_workbook_campaign_links_contact_group_id_contact_groups_id_fk" FOREIGN KEY ("contact_group_id") REFERENCES "public"."contact_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbook_campaign_links" ADD CONSTRAINT "whatsapp_ai_workbook_campaign_links_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbook_campaign_links" ADD CONSTRAINT "whatsapp_ai_workbook_campaign_links_last_synced_version_id_whatsapp_ai_workbook_versions_id_fk" FOREIGN KEY ("last_synced_version_id") REFERENCES "public"."whatsapp_ai_workbook_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbook_versions" ADD CONSTRAINT "whatsapp_ai_workbook_versions_workbook_id_whatsapp_ai_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "public"."whatsapp_ai_workbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbook_versions" ADD CONSTRAINT "whatsapp_ai_workbook_versions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbook_versions" ADD CONSTRAINT "whatsapp_ai_workbook_versions_source_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("source_campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbooks" ADD CONSTRAINT "whatsapp_ai_workbooks_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_ai_workbooks" ADD CONSTRAINT "whatsapp_ai_workbooks_source_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("source_campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automation_dispatches" ADD CONSTRAINT "whatsapp_campaign_automation_dispatches_automation_id_whatsapp_campaign_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."whatsapp_campaign_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automation_dispatches" ADD CONSTRAINT "whatsapp_campaign_automation_dispatches_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automation_dispatches" ADD CONSTRAINT "whatsapp_campaign_automation_dispatches_run_id_whatsapp_campaign_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."whatsapp_campaign_automation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automation_runs" ADD CONSTRAINT "whatsapp_campaign_automation_runs_automation_id_whatsapp_campaign_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."whatsapp_campaign_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automation_runs" ADD CONSTRAINT "whatsapp_campaign_automation_runs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automation_runs" ADD CONSTRAINT "whatsapp_campaign_automation_runs_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automation_runs" ADD CONSTRAINT "whatsapp_campaign_automation_runs_contact_group_id_contact_groups_id_fk" FOREIGN KEY ("contact_group_id") REFERENCES "public"."contact_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automations" ADD CONSTRAINT "whatsapp_campaign_automations_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automations" ADD CONSTRAINT "whatsapp_campaign_automations_source_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("source_campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automations" ADD CONSTRAINT "whatsapp_campaign_automations_source_workbook_id_whatsapp_ai_workbooks_id_fk" FOREIGN KEY ("source_workbook_id") REFERENCES "public"."whatsapp_ai_workbooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_campaign_automations" ADD CONSTRAINT "whatsapp_campaign_automations_template_id_whatsapp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."whatsapp_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_sessions" ADD CONSTRAINT "whatsapp_flow_sessions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_sessions" ADD CONSTRAINT "whatsapp_flow_sessions_flow_id_whatsapp_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."whatsapp_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_steps" ADD CONSTRAINT "whatsapp_flow_steps_flow_id_whatsapp_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."whatsapp_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flows" ADD CONSTRAINT "whatsapp_flows_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_lead_attachments" ADD CONSTRAINT "whatsapp_lead_attachments_lead_id_whatsapp_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."whatsapp_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_lead_attachments" ADD CONSTRAINT "whatsapp_lead_attachments_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_lead_fields" ADD CONSTRAINT "whatsapp_lead_fields_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_leads" ADD CONSTRAINT "whatsapp_leads_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_opt_outs" ADD CONSTRAINT "whatsapp_opt_outs_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_opt_outs" ADD CONSTRAINT "whatsapp_opt_outs_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_settings" ADD CONSTRAINT "whatsapp_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_whitelist" ADD CONSTRAINT "whatsapp_whitelist_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_settings" ADD CONSTRAINT "widget_settings_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_group_admins_user_idx" ON "account_group_admins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_group_admins_group_idx" ON "account_group_admins" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "account_group_extra_settings_group_idx" ON "account_group_extra_settings" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "account_group_journeys_group_idx" ON "account_group_journeys" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "account_group_lsq_mappings_group_idx" ON "account_group_leadsquared_field_mappings" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "account_group_training_group_idx" ON "account_group_training" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_user_id_idx" ON "audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_events_business_account_id_idx" ON "audit_events" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_events_request_id_idx" ON "audit_events" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_one_export_terminal_event_idx" ON "audit_events" USING btree ("resource_id") WHERE "audit_events"."action" IN ('leads.export.file_generated', 'leads.export.file_failed');--> statement-breakpoint
CREATE INDEX "contact_group_contacts_group_idx" ON "contact_group_contacts" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "contact_group_contacts_biz_group_idx" ON "contact_group_contacts" USING btree ("business_account_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cac_business_account" ON "conversation_analysis_cache" USING btree ("business_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ccs_business_account" ON "conversation_category_settings" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "conversations_business_created_idx" ON "conversations" USING btree ("business_account_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_business_category_idx" ON "conversations" USING btree ("business_account_id","category");--> statement-breakpoint
CREATE INDEX "conversations_awaiting_verification_idx" ON "conversations" USING btree ("awaiting_verification","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_summarized_sweep_idx" ON "conversations" USING btree ("updated_at","summarized_at");--> statement-breakpoint
CREATE INDEX "conversations_business_student_idx" ON "conversations" USING btree ("business_account_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ci_unique_platform_user" ON "customer_identities" USING btree ("business_account_id","platform","platform_user_id");--> statement-breakpoint
CREATE INDEX "idx_ci_profile" ON "customer_identities" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cms_unique_profile_platform" ON "customer_memory_snapshots" USING btree ("profile_id","platform");--> statement-breakpoint
CREATE INDEX "idx_cms_business" ON "customer_memory_snapshots" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "idx_cma_business" ON "customer_merge_audit" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "idx_cma_survivor" ON "customer_merge_audit" USING btree ("survivor_profile_id");--> statement-breakpoint
CREATE INDEX "idx_cp_business_phone" ON "customer_profiles" USING btree ("business_account_id","normalized_phone");--> statement-breakpoint
CREATE INDEX "idx_cp_business_email" ON "customer_profiles" USING btree ("business_account_id","normalized_email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cp_unique_phone" ON "customer_profiles" USING btree ("business_account_id","normalized_phone") WHERE normalized_phone IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cp_unique_email" ON "customer_profiles" USING btree ("business_account_id","normalized_email") WHERE normalized_email IS NOT NULL;--> statement-breakpoint
CREATE INDEX "data_purge_log_account_captured_idx" ON "data_purge_log" USING btree ("business_account_id","record_type","captured_at");--> statement-breakpoint
CREATE INDEX "data_purge_log_account_purged_idx" ON "data_purge_log" USING btree ("business_account_id","purged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_retention_policies_scope_idx" ON "data_retention_policies" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_offers_code_unique" ON "discount_offers" USING btree ("business_account_id","discount_code");--> statement-breakpoint
CREATE INDEX "discount_offers_offered_idx" ON "discount_offers" USING btree ("business_account_id","offered_at");--> statement-breakpoint
CREATE INDEX "discount_offers_redeemed_idx" ON "discount_offers" USING btree ("business_account_id","redeemed_at");--> statement-breakpoint
CREATE INDEX "document_chunks_document_idx" ON "document_chunks" USING btree ("training_document_id");--> statement-breakpoint
CREATE INDEX "document_chunks_business_idx" ON "document_chunks" USING btree ("business_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_doc_types_business_key" ON "document_types" USING btree ("business_account_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_product_cache_business_erp_idx" ON "erp_product_cache" USING btree ("business_account_id","erp_product_id");--> statement-breakpoint
CREATE INDEX "erp_product_cache_category_idx" ON "erp_product_cache" USING btree ("business_account_id","category");--> statement-breakpoint
CREATE INDEX "erp_product_cache_price_idx" ON "erp_product_cache" USING btree ("business_account_id","price");--> statement-breakpoint
CREATE INDEX "idx_fb_comments_business" ON "facebook_comments" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "idx_fb_comments_comment_id" ON "facebook_comments" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "idx_fb_comments_post_id" ON "facebook_comments" USING btree ("business_account_id","post_id");--> statement-breakpoint
CREATE INDEX "facebook_lead_fields_business_key_idx" ON "facebook_lead_fields" USING btree ("business_account_id","field_key");--> statement-breakpoint
CREATE INDEX "facebook_leads_business_received_idx" ON "facebook_leads" USING btree ("business_account_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_fb_messages_business_sender" ON "facebook_messages" USING btree ("business_account_id","sender_id");--> statement-breakpoint
CREATE INDEX "idx_fb_messages_fb_msg_id" ON "facebook_messages" USING btree ("fb_message_id");--> statement-breakpoint
CREATE INDEX "faqs_business_idx" ON "faqs" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "idx_ig_comments_business" ON "instagram_comments" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "idx_ig_comments_comment_id" ON "instagram_comments" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "idx_ig_comments_post_id" ON "instagram_comments" USING btree ("business_account_id","post_id");--> statement-breakpoint
CREATE INDEX "instagram_lead_fields_business_key_idx" ON "instagram_lead_fields" USING btree ("business_account_id","field_key");--> statement-breakpoint
CREATE INDEX "instagram_leads_business_received_idx" ON "instagram_leads" USING btree ("business_account_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_ig_messages_business_sender" ON "instagram_messages" USING btree ("business_account_id","sender_id");--> statement-breakpoint
CREATE INDEX "idx_ig_messages_ig_msg_id" ON "instagram_messages" USING btree ("ig_message_id");--> statement-breakpoint
CREATE INDEX "intent_scores_lookup_idx" ON "intent_scores" USING btree ("business_account_id","visitor_session_id","product_id");--> statement-breakpoint
CREATE INDEX "intent_scores_threshold_idx" ON "intent_scores" USING btree ("business_account_id","score");--> statement-breakpoint
CREATE INDEX "leads_business_created_idx" ON "leads" USING btree ("business_account_id","created_at");--> statement-breakpoint
CREATE INDEX "mkt_messages_recipient_created_idx" ON "marketing_campaign_messages" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "mkt_messages_campaign_created_idx" ON "marketing_campaign_messages" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "mkt_recipients_campaign_idx" ON "marketing_campaign_recipients" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "mkt_recipients_biz_phone_idx" ON "marketing_campaign_recipients" USING btree ("business_account_id","phone");--> statement-breakpoint
CREATE INDEX "mkt_recipients_biz_sent_at_idx" ON "marketing_campaign_recipients" USING btree ("business_account_id","sent_at");--> statement-breakpoint
CREATE INDEX "mkt_recipients_campaign_status_idx" ON "marketing_campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "mkt_recipients_msg91_msg_idx" ON "marketing_campaign_recipients" USING btree ("business_account_id","msg91_message_id");--> statement-breakpoint
CREATE INDEX "mkt_recipients_biz_send_phone_idx" ON "marketing_campaign_recipients" USING btree ("business_account_id","send_phone");--> statement-breakpoint
CREATE INDEX "marketing_campaigns_recipient_workbook_idx" ON "marketing_campaigns" USING btree ("business_account_id","recipient_workbook_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_messaging_credentials_business" ON "messaging_credentials" USING btree ("business_account_id","provider");--> statement-breakpoint
CREATE INDEX "openai_batch_jobs_business_idx" ON "openai_batch_jobs" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "openai_batch_jobs_status_idx" ON "openai_batch_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "openai_batch_jobs_batch_id_idx" ON "openai_batch_jobs" USING btree ("openai_batch_id");--> statement-breakpoint
CREATE INDEX "otp_challenges_business_conv_idx" ON "phone_otp_challenges" USING btree ("business_account_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "otp_challenges_business_phone_idx" ON "phone_otp_challenges" USING btree ("business_account_id","phone_e164","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_embeddings_business_erp_idx" ON "product_embeddings" USING btree ("business_account_id","erp_product_id");--> statement-breakpoint
CREATE INDEX "product_import_jobs_business_idx" ON "product_import_jobs" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "product_import_jobs_status_idx" ON "product_import_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_jewelry_embeddings_product_idx" ON "product_jewelry_embeddings" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_jewelry_embeddings_business_idx" ON "product_jewelry_embeddings" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "product_jewelry_embeddings_type_idx" ON "product_jewelry_embeddings" USING btree ("jewelry_type");--> statement-breakpoint
CREATE INDEX "products_business_updated_idx" ON "products" USING btree ("business_account_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_sr_business_channel" ON "smart_replies" USING btree ("business_account_id","channel");--> statement-breakpoint
CREATE INDEX "topscholar_chunks_account_cp_idx" ON "topscholar_content_chunks" USING btree ("business_account_id","cp_id");--> statement-breakpoint
CREATE INDEX "topscholar_chunks_account_cp_type_idx" ON "topscholar_content_chunks" USING btree ("business_account_id","cp_id","content_type");--> statement-breakpoint
CREATE INDEX "topscholar_chunks_scope_idx" ON "topscholar_content_chunks" USING btree ("business_account_id","board","medium","grade","subject","cp_id");--> statement-breakpoint
CREATE INDEX "topscholar_chunks_embedding_hnsw" ON "topscholar_content_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "topscholar_content_sync_account_cp_idx" ON "topscholar_content_sync" USING btree ("business_account_id","cp_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topscholar_cp_mappings_account_cp_idx" ON "topscholar_cp_mappings" USING btree ("business_account_id","cp_id");--> statement-breakpoint
CREATE INDEX "topscholar_embed_jobs_account_cp_idx" ON "topscholar_embed_jobs" USING btree ("business_account_id","cp_id");--> statement-breakpoint
CREATE INDEX "topscholar_embed_jobs_status_idx" ON "topscholar_embed_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "topscholar_embed_staging_job_idx" ON "topscholar_embed_staging" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "topscholar_embed_staging_custom_idx" ON "topscholar_embed_staging" USING btree ("job_id","custom_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topscholar_plan_cp_resolutions_account_plan_cp_idx" ON "topscholar_plan_cp_resolutions" USING btree ("business_account_id","plan_id","cp_id");--> statement-breakpoint
CREATE INDEX "topscholar_plan_cp_resolutions_account_plan_idx" ON "topscholar_plan_cp_resolutions" USING btree ("business_account_id","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topscholar_plan_ids_account_plan_idx" ON "topscholar_plan_ids" USING btree ("business_account_id","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topscholar_plan_run_items_run_cp_idx" ON "topscholar_plan_run_items" USING btree ("run_id","cp_id");--> statement-breakpoint
CREATE INDEX "topscholar_plan_run_items_run_status_idx" ON "topscholar_plan_run_items" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "topscholar_plan_run_items_account_cp_idx" ON "topscholar_plan_run_items" USING btree ("business_account_id","cp_id");--> statement-breakpoint
CREATE INDEX "topscholar_plan_runs_account_plan_updated_idx" ON "topscholar_plan_runs" USING btree ("business_account_id","plan_id","updated_at");--> statement-breakpoint
CREATE INDEX "topscholar_plan_runs_account_status_idx" ON "topscholar_plan_runs" USING btree ("business_account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "topscholar_plan_runs_active_plan_unique" ON "topscholar_plan_runs" USING btree ("business_account_id","plan_id") WHERE "topscholar_plan_runs"."requested_cp_id" IS NULL AND "topscholar_plan_runs"."status" IN ('queued', 'resolving', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "topscholar_plan_runs_active_cp_unique" ON "topscholar_plan_runs" USING btree ("business_account_id","plan_id","requested_cp_id") WHERE "topscholar_plan_runs"."requested_cp_id" IS NOT NULL AND "topscholar_plan_runs"."status" IN ('queued', 'resolving', 'running');--> statement-breakpoint
CREATE INDEX "topscholar_voice_sessions_account_connected_idx" ON "topscholar_voice_sessions" USING btree ("business_account_id","connected_at");--> statement-breakpoint
CREATE INDEX "topscholar_voice_sessions_account_student_idx" ON "topscholar_voice_sessions" USING btree ("business_account_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topscholar_voice_sessions_open_conversation_unique" ON "topscholar_voice_sessions" USING btree ("conversation_id") WHERE "topscholar_voice_sessions"."disconnected_at" is null;--> statement-breakpoint
CREATE INDEX "trained_urls_business_idx" ON "trained_urls" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "trained_urls_url_idx" ON "trained_urls" USING btree ("url");--> statement-breakpoint
CREATE INDEX "training_documents_business_idx" ON "training_documents" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "urgency_offers_visitor_idx" ON "urgency_offers" USING btree ("business_account_id","visitor_token");--> statement-breakpoint
CREATE INDEX "urgency_offers_phone_idx" ON "urgency_offers" USING btree ("business_account_id","phone_number");--> statement-breakpoint
CREATE INDEX "urgency_offers_status_idx" ON "urgency_offers" USING btree ("business_account_id","status");--> statement-breakpoint
CREATE INDEX "url_content_chunks_url_idx" ON "url_content_chunks" USING btree ("trained_url_id");--> statement-breakpoint
CREATE INDEX "url_content_chunks_business_idx" ON "url_content_chunks" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "verification_rule_sets_business_idx" ON "verification_rule_sets" USING btree ("business_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_rule_sets_business_name_unique" ON "verification_rule_sets" USING btree ("business_account_id","name");--> statement-breakpoint
CREATE INDEX "verification_rules_rule_set_idx" ON "verification_rules" USING btree ("rule_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_daily_stats_business_date_idx" ON "visitor_daily_stats" USING btree ("business_account_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_biz_source_pid_uniq" ON "webhook_events" USING btree ("business_account_id","source","provider_id");--> statement-breakpoint
CREATE INDEX "webhook_events_received_idx" ON "webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "wa_ai_workbook_campaign_links_workbook_created_idx" ON "whatsapp_ai_workbook_campaign_links" USING btree ("workbook_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_ai_workbook_campaign_links_group_idx" ON "whatsapp_ai_workbook_campaign_links" USING btree ("contact_group_id");--> statement-breakpoint
CREATE INDEX "wa_ai_workbook_campaign_links_campaign_idx" ON "whatsapp_ai_workbook_campaign_links" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "wa_ai_workbook_campaign_links_business_idx" ON "whatsapp_ai_workbook_campaign_links" USING btree ("business_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_ai_workbook_versions_workbook_version_uniq" ON "whatsapp_ai_workbook_versions" USING btree ("workbook_id","version_number");--> statement-breakpoint
CREATE INDEX "wa_ai_workbook_versions_workbook_created_idx" ON "whatsapp_ai_workbook_versions" USING btree ("workbook_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_ai_workbook_versions_business_idx" ON "whatsapp_ai_workbook_versions" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "wa_ai_workbooks_business_updated_idx" ON "whatsapp_ai_workbooks" USING btree ("business_account_id","updated_at");--> statement-breakpoint
CREATE INDEX "wa_ai_workbooks_source_campaign_idx" ON "whatsapp_ai_workbooks" USING btree ("source_campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_automation_dispatches_automation_key_uniq" ON "whatsapp_campaign_automation_dispatches" USING btree ("automation_id","record_key");--> statement-breakpoint
CREATE INDEX "wa_automation_dispatches_run_idx" ON "whatsapp_campaign_automation_dispatches" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "wa_automation_runs_automation_created_idx" ON "whatsapp_campaign_automation_runs" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_automation_runs_business_status_idx" ON "whatsapp_campaign_automation_runs" USING btree ("business_account_id","status");--> statement-breakpoint
CREATE INDEX "wa_automation_business_idx" ON "whatsapp_campaign_automations" USING btree ("business_account_id");--> statement-breakpoint
CREATE INDEX "wa_automation_business_campaign_idx" ON "whatsapp_campaign_automations" USING btree ("business_account_id","source_campaign_id");--> statement-breakpoint
CREATE INDEX "wa_automation_business_enabled_idx" ON "whatsapp_campaign_automations" USING btree ("business_account_id","enabled");--> statement-breakpoint
CREATE INDEX "wa_automation_business_deleted_idx" ON "whatsapp_campaign_automations" USING btree ("business_account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "whatsapp_lead_attachments_lead_idx" ON "whatsapp_lead_attachments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "whatsapp_lead_fields_business_key_idx" ON "whatsapp_lead_fields" USING btree ("business_account_id","field_key");--> statement-breakpoint
CREATE INDEX "whatsapp_leads_business_received_idx" ON "whatsapp_leads" USING btree ("business_account_id","received_at");--> statement-breakpoint
CREATE INDEX "whatsapp_leads_business_last_message_idx" ON "whatsapp_leads" USING btree ("business_account_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_leads_blank_placeholder_unique_idx" ON "whatsapp_leads" USING btree ("business_account_id","sender_phone") WHERE status = 'new' AND customer_name IS NULL AND extracted_data IS NULL;--> statement-breakpoint
CREATE INDEX "wa_sessions_business_phone_idx" ON "whatsapp_sessions" USING btree ("business_account_id","phone_number");--> statement-breakpoint
CREATE INDEX "whatsapp_templates_business_active_idx" ON "whatsapp_templates" USING btree ("business_account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "whatsapp_templates_business_source_number_idx" ON "whatsapp_templates" USING btree ("business_account_id","source_type","source_whatsapp_number");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_templates_msg91_scoped_identity_unique" ON "whatsapp_templates" USING btree ("business_account_id","source_whatsapp_number","name","language") WHERE "whatsapp_templates"."source_type" = 'msg91' AND "whatsapp_templates"."source_whatsapp_number" IS NOT NULL;