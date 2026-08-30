# Development vs AWS Production Schema Comparison

**Production source:** PostgreSQL backup dated 2026-08-29 04:00 UTC (supplied compressed SQL dump)  
**Development source:** live development PostgreSQL catalog at comparison time  
**Scope:** tables and columns; shared-column type and nullability; defaults reviewed separately

## Executive summary

| Metric | Development | Production backup | Difference |
|---|---:|---:|---:|
| Tables | 153 | 150 | 3 |
| Columns | 2199 | 2132 | 67 |

- **3 tables are missing in production**, containing 34 development columns.
- **36 columns are missing from 5 existing production tables.**
- **No shared column has a type or nullability mismatch.**
- **144 shared tables have matching column counts.**
- Production has three additional `whatsapp_leads` columns that should be preserved unless the loan-specific customization is deliberately retired.

## Tables to add to production

| Creation order | Table | Columns | Key dependencies |
|---:|---|---:|---|
| 1 | `public.whatsapp_ai_workbooks` | 8 | business_accounts, marketing_campaigns |
| 2 | `public.whatsapp_ai_workbook_versions` | 11 | whatsapp_ai_workbooks, business_accounts, marketing_campaigns |
| 3 | `public.whatsapp_ai_workbook_campaign_links` | 15 | workbooks, workbook_versions, contact_groups, marketing_campaigns |

These tables should be created with their primary keys, foreign keys, delete behavior, unique constraints, and indexes from the checked-in schema—not as column-only tables.

### Missing table definitions

#### `public.whatsapp_ai_workbook_campaign_links`

| Column | Type | Nullable | Default |
|---|---|:---:|---|
| `id` | `character varying` | No | `gen_random_uuid()` |
| `business_account_id` | `character varying` | No | — |
| `workbook_id` | `character varying` | No | — |
| `workbook_version_id` | `character varying` | No | — |
| `contact_group_id` | `character varying` | No | — |
| `campaign_id` | `character varying` | Yes | — |
| `sheet_id` | `text` | No | — |
| `mappings` | `jsonb` | No | `'[]'::jsonb` |
| `row_ids_by_phone` | `jsonb` | No | `'{}'::jsonb` |
| `status` | `text` | No | `'audience_ready'::text` |
| `last_synced_at` | `timestamp without time zone` | Yes | — |
| `last_synced_version_id` | `character varying` | Yes | — |
| `synced_row_count` | `integer` | No | `0` |
| `created_at` | `timestamp without time zone` | No | `now()` |
| `updated_at` | `timestamp without time zone` | No | `now()` |

#### `public.whatsapp_ai_workbook_versions`

| Column | Type | Nullable | Default |
|---|---|:---:|---|
| `id` | `character varying` | No | `gen_random_uuid()` |
| `workbook_id` | `character varying` | No | — |
| `business_account_id` | `character varying` | No | — |
| `source_campaign_id` | `character varying` | Yes | — |
| `version_number` | `integer` | No | — |
| `revision` | `integer` | No | `1` |
| `source` | `text` | No | `'manual'::text` |
| `source_file_name` | `text` | Yes | — |
| `sheets` | `jsonb` | No | `'[]'::jsonb` |
| `created_at` | `timestamp without time zone` | No | `now()` |
| `updated_at` | `timestamp without time zone` | No | `now()` |

#### `public.whatsapp_ai_workbooks`

| Column | Type | Nullable | Default |
|---|---|:---:|---|
| `id` | `character varying` | No | `gen_random_uuid()` |
| `business_account_id` | `character varying` | No | — |
| `name` | `text` | No | — |
| `description` | `text` | Yes | `''::text` |
| `source_campaign_id` | `character varying` | Yes | — |
| `status` | `text` | No | `'active'::text` |
| `created_at` | `timestamp without time zone` | No | `now()` |
| `updated_at` | `timestamp without time zone` | No | `now()` |

## Columns to add to existing production tables

### `public.marketing_campaigns` — 12 missing columns

| Column | Type | Nullable | Default |
|---|---|:---:|---|
| `campaign_type` | `text` | No | `'one_time'::text` |
| `recipient_source_type` | `text` | Yes | — |
| `recipient_workbook_id` | `character varying` | Yes | — |
| `recipient_workbook_sheet_id` | `text` | Yes | — |
| `recipient_phone_column` | `text` | Yes | — |
| `recipient_name_column` | `text` | Yes | `''::text` |
| `recipient_record_key_column` | `text` | Yes | — |
| `recipient_date_column` | `text` | Yes | — |
| `recipient_date_offset_days` | `integer` | No | `0` |
| `recipient_status_column` | `text` | Yes | `''::text` |
| `recipient_eligible_statuses` | `jsonb` | Yes | `'[]'::jsonb` |
| `recipient_ai_allowed_fields` | `jsonb` | Yes | `'[]'::jsonb` |

### `public.whatsapp_campaign_automation_runs` — 15 missing columns

| Column | Type | Nullable | Default |
|---|---|:---:|---|
| `source_type` | `text` | No | `'upload'::text` |
| `source_campaign_id` | `character varying` | Yes | — |
| `source_campaign_name` | `text` | Yes | — |
| `source_campaign_updated_at` | `timestamp without time zone` | Yes | — |
| `source_workbook_id` | `character varying` | Yes | — |
| `source_workbook_version_id` | `character varying` | Yes | — |
| `source_workbook_sheet_id` | `text` | Yes | — |
| `source_workbook_name` | `text` | Yes | — |
| `source_workbook_version_number` | `integer` | Yes | — |
| `source_workbook_revision` | `integer` | Yes | — |
| `source_workbook_sheet_name` | `text` | Yes | — |
| `source_group_ids` | `jsonb` | Yes | `'[]'::jsonb` |
| `source_group_names` | `jsonb` | Yes | `'[]'::jsonb` |
| `source_snapshot` | `jsonb` | Yes | — |
| `blueprint_snapshot` | `jsonb` | Yes | — |

### `public.whatsapp_campaign_automations` — 5 missing columns

| Column | Type | Nullable | Default |
|---|---|:---:|---|
| `source_type` | `text` | No | `'upload'::text` |
| `source_campaign_id` | `character varying` | Yes | — |
| `source_workbook_id` | `character varying` | Yes | — |
| `source_workbook_sheet_id` | `text` | Yes | — |
| `source_group_ids` | `jsonb` | Yes | `'[]'::jsonb` |

### `public.whatsapp_flows` — 1 missing column

| Column | Type | Nullable | Default |
|---|---|:---:|---|
| `adaptive_mode` | `text` | No | `'false'::text` |

### `public.whatsapp_templates` — 3 missing columns

| Column | Type | Nullable | Default |
|---|---|:---:|---|
| `source_type` | `text` | No | `'manual'::text` |
| `source_whatsapp_number` | `text` | Yes | — |
| `deleted_at` | `timestamp without time zone` | Yes | — |

## Production-only columns to preserve

| Table | Column | Type | Nullable |
|---|---|---|:---:|
| `public.whatsapp_leads` | `loan_amount` | `numeric(15,2)` | Yes |
| `public.whatsapp_leads` | `loan_type` | `text` | Yes |
| `public.whatsapp_leads` | `address` | `text` | Yes |

These appear to be an AWS-specific loan lead customization. They are not present in development; this report does **not** recommend dropping them.

## Default differences

- The four `ai_usage_events` numeric defaults (`0` versus `'0'::numeric`) are semantically equivalent and require no migration.
- `whatsapp_settings.extraction_fields` includes `loan_amount`, `loan_type`, and `address` in production but not development. Preserve the production default unless the loan-specific fields are intentionally being removed.

## Recommended migration sequence

1. Take a fresh AWS backup immediately before migration and compare it again if the live schema may have changed since 2026-08-29.
2. Ensure the `pgcrypto` and `vector` extensions already exist before creating objects that use `gen_random_uuid()` or `vector` types.
3. Create `whatsapp_ai_workbooks`, then `whatsapp_ai_workbook_versions`, then `whatsapp_ai_workbook_campaign_links`, including all constraints and indexes.
4. Add the 36 missing columns to the five existing tables. Use defaults/backfills before enforcing `NOT NULL` on populated tables.
5. Add the intended workbook foreign keys only after the referenced tables exist.
6. Preserve the three production-only lead columns and the loan-aware extraction default unless explicitly approved for removal.
7. Validate row counts, foreign keys, application startup, campaign creation, automation runs, workbook creation, and template sync after migration.

## Complete table tally

| Table | Development columns | Production columns | Status |
|---|---:|---:|---|
| `public.account_group_admins` | 8 | 8 | Match |
| `public.account_group_extra_settings` | 12 | 12 | Match |
| `public.account_group_journey_steps` | 21 | 21 | Match |
| `public.account_group_journeys` | 16 | 16 | Match |
| `public.account_group_leadsquared_field_mappings` | 12 | 12 | Match |
| `public.account_group_members` | 5 | 5 | Match |
| `public.account_group_training` | 17 | 17 | Match |
| `public.account_groups` | 6 | 6 | Match |
| `public.ai_suggestions` | 21 | 21 | Match |
| `public.ai_usage_daily` | 10 | 10 | Match |
| `public.ai_usage_events` | 13 | 13 | Match |
| `public.analyzed_pages` | 6 | 6 | Match |
| `public.appointments` | 16 | 16 | Match |
| `public.backup_jobs` | 14 | 14 | Match |
| `public.business_accounts` | 93 | 93 | Match |
| `public.canned_responses` | 10 | 10 | Match |
| `public.categories` | 7 | 7 | Match |
| `public.chat_menu_configs` | 19 | 19 | Match |
| `public.chat_menu_item_details` | 8 | 8 | Match |
| `public.chat_menu_items` | 15 | 15 | Match |
| `public.contact_group_contacts` | 7 | 7 | Match |
| `public.contact_groups` | 8 | 8 | Match |
| `public.conversation_analysis_cache` | 6 | 6 | Match |
| `public.conversation_category_settings` | 6 | 6 | Match |
| `public.conversation_journeys` | 16 | 16 | Match |
| `public.conversations` | 28 | 28 | Match |
| `public.crm_store_credentials` | 11 | 11 | Match |
| `public.custom_crm_field_mappings` | 12 | 12 | Match |
| `public.custom_crm_settings` | 16 | 16 | Match |
| `public.customer_identities` | 8 | 8 | Match |
| `public.customer_memory_snapshots` | 12 | 12 | Match |
| `public.customer_merge_audit` | 7 | 7 | Match |
| `public.customer_profiles` | 11 | 11 | Match |
| `public.demo_orders` | 19 | 19 | Match |
| `public.demo_pages` | 12 | 12 | Match |
| `public.discount_offers` | 13 | 13 | Match |
| `public.discount_rules` | 12 | 12 | Match |
| `public.document_chunks` | 7 | 7 | Match |
| `public.document_type_prompt_history` | 8 | 8 | Match |
| `public.document_types` | 15 | 15 | Match |
| `public.erp_configurations` | 29 | 29 | Match |
| `public.erp_product_cache` | 21 | 21 | Match |
| `public.erp_sync_logs` | 21 | 21 | Match |
| `public.exit_intent_settings` | 12 | 12 | Match |
| `public.facebook_comments` | 13 | 13 | Match |
| `public.facebook_flow_sessions` | 10 | 10 | Match |
| `public.facebook_flow_steps` | 12 | 12 | Match |
| `public.facebook_flows` | 11 | 11 | Match |
| `public.facebook_lead_fields` | 11 | 11 | Match |
| `public.facebook_leads` | 10 | 10 | Match |
| `public.facebook_messages` | 10 | 10 | Match |
| `public.facebook_settings` | 21 | 21 | Match |
| `public.faqs` | 8 | 8 | Match |
| `public.guidance_campaigns` | 11 | 11 | Match |
| `public.idle_timeout_settings` | 12 | 12 | Match |
| `public.instagram_comments` | 13 | 13 | Match |
| `public.instagram_flow_sessions` | 10 | 10 | Match |
| `public.instagram_flow_steps` | 12 | 12 | Match |
| `public.instagram_flows` | 11 | 11 | Match |
| `public.instagram_lead_fields` | 11 | 11 | Match |
| `public.instagram_leads` | 10 | 10 | Match |
| `public.instagram_messages` | 10 | 10 | Match |
| `public.instagram_settings` | 21 | 21 | Match |
| `public.intent_scores` | 8 | 8 | Match |
| `public.job_applicants` | 12 | 12 | Match |
| `public.job_applications` | 8 | 8 | Match |
| `public.jobs` | 19 | 19 | Match |
| `public.journey_responses` | 7 | 7 | Match |
| `public.journey_sessions` | 10 | 10 | Match |
| `public.journey_steps` | 22 | 22 | Match |
| `public.k12_chapters` | 7 | 7 | Match |
| `public.k12_questions` | 13 | 13 | Match |
| `public.k12_subjects` | 9 | 9 | Match |
| `public.k12_topic_notes` | 8 | 8 | Match |
| `public.k12_topic_videos` | 9 | 9 | Match |
| `public.k12_topics` | 15 | 15 | Match |
| `public.leads` | 28 | 28 | Match |
| `public.leadsquared_field_mappings` | 13 | 13 | Match |
| `public.leadsquared_url_extraction_cache` | 6 | 6 | Match |
| `public.leadsquared_url_rules` | 7 | 7 | Match |
| `public.marketing_campaign_messages` | 8 | 8 | Match |
| `public.marketing_campaign_recipients` | 26 | 26 | Match |
| `public.marketing_campaigns` | 42 | 30 | Column difference |
| `public.master_ai_settings` | 10 | 10 | Match |
| `public.messages` | 8 | 8 | Match |
| `public.messaging_credentials` | 11 | 11 | Match |
| `public.model_pricing` | 10 | 10 | Match |
| `public.openai_batch_jobs` | 21 | 21 | Match |
| `public.password_reset_tokens` | 6 | 6 | Match |
| `public.phone_otp_challenges` | 19 | 19 | Match |
| `public.proactive_guidance_rules` | 11 | 11 | Match |
| `public.product_categories` | 4 | 4 | Match |
| `public.product_embeddings` | 17 | 17 | Match |
| `public.product_import_jobs` | 16 | 16 | Match |
| `public.product_jewelry_embeddings` | 15 | 15 | Match |
| `public.product_relationships` | 9 | 9 | Match |
| `public.product_tags` | 4 | 4 | Match |
| `public.products` | 24 | 24 | Match |
| `public.public_chat_links` | 9 | 9 | Match |
| `public.question_bank_entries` | 13 | 13 | Match |
| `public.restore_history` | 10 | 10 | Match |
| `public.salesforce_field_mappings` | 11 | 11 | Match |
| `public.schedule_templates` | 9 | 9 | Match |
| `public.sessions` | 6 | 6 | Match |
| `public.slot_overrides` | 10 | 10 | Match |
| `public.smart_replies` | 10 | 10 | Match |
| `public.support_tickets` | 29 | 29 | Match |
| `public.system_settings` | 7 | 7 | Match |
| `public.tags` | 6 | 6 | Match |
| `public.ticket_attachments` | 11 | 11 | Match |
| `public.ticket_insights` | 15 | 15 | Match |
| `public.ticket_messages` | 12 | 12 | Match |
| `public.topscholar_content_chunks` | 20 | 20 | Match |
| `public.topscholar_content_sync` | 19 | 19 | Match |
| `public.topscholar_cp_mappings` | 13 | 13 | Match |
| `public.topscholar_embed_jobs` | 12 | 12 | Match |
| `public.topscholar_embed_staging` | 17 | 17 | Match |
| `public.topscholar_plan_cp_resolutions` | 18 | 18 | Match |
| `public.topscholar_plan_ids` | 11 | 11 | Match |
| `public.topscholar_plan_run_items` | 12 | 12 | Match |
| `public.topscholar_plan_runs` | 17 | 17 | Match |
| `public.topscholar_plan_sync_leases` | 4 | 4 | Match |
| `public.trained_urls` | 18 | 18 | Match |
| `public.training_documents` | 18 | 18 | Match |
| `public.uploaded_images` | 11 | 11 | Match |
| `public.urgency_offer_settings` | 25 | 25 | Match |
| `public.urgency_offers` | 19 | 19 | Match |
| `public.url_content_chunks` | 7 | 7 | Match |
| `public.users` | 10 | 10 | Match |
| `public.verification_rule_sets` | 8 | 8 | Match |
| `public.verification_rules` | 11 | 11 | Match |
| `public.visitor_daily_stats` | 11 | 11 | Match |
| `public.vista_studio_jobs` | 11 | 11 | Match |
| `public.webhook_events` | 6 | 6 | Match |
| `public.website_analysis` | 9 | 9 | Match |
| `public.whatsapp_ai_workbook_campaign_links` | 15 | 0 | Missing in production |
| `public.whatsapp_ai_workbook_versions` | 11 | 0 | Missing in production |
| `public.whatsapp_ai_workbooks` | 8 | 0 | Missing in production |
| `public.whatsapp_campaign_automation_dispatches` | 6 | 6 | Match |
| `public.whatsapp_campaign_automation_runs` | 32 | 17 | Column difference |
| `public.whatsapp_campaign_automations` | 25 | 20 | Column difference |
| `public.whatsapp_flow_sessions` | 10 | 10 | Match |
| `public.whatsapp_flow_steps` | 12 | 12 | Match |
| `public.whatsapp_flows` | 14 | 13 | Column difference |
| `public.whatsapp_lead_attachments` | 13 | 13 | Match |
| `public.whatsapp_lead_fields` | 13 | 13 | Match |
| `public.whatsapp_leads` | 30 | 33 | Column difference |
| `public.whatsapp_opt_outs` | 6 | 6 | Match |
| `public.whatsapp_sessions` | 7 | 7 | Match |
| `public.whatsapp_settings` | 37 | 37 | Match |
| `public.whatsapp_templates` | 21 | 18 | Column difference |
| `public.whatsapp_whitelist` | 5 | 5 | Match |
| `public.widget_settings` | 134 | 134 | Match |
