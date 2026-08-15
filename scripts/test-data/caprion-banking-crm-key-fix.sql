-- =============================================================================
-- Fix: Banking details CRM keys in custom_crm_field_mappings
-- Applied: 2026-04-25
-- Reason : The old dotted keys (banking_details.account_number / banking_details.ifsc)
--          were never in CAPRION_FIELD_MAP or CAPRION_ACCEPTED_FIELDS, so they were
--          silently dropped from the main lead payload and the UI was misleading.
--          The banking upload code now reads through the CRM field mapping, so the
--          crmField values must match the keys the code looks for.
-- =============================================================================

-- Account No: banking_details.account_number → account_no
UPDATE custom_crm_field_mappings
SET crm_field = 'account_no'
WHERE id = 'c75bf9ba-3387-47fd-a35d-0a46ebe89094';

-- IFSC Code: banking_details.ifsc → ifsc_code
UPDATE custom_crm_field_mappings
SET crm_field = 'ifsc_code'
WHERE id = '39f4a53d-3a2b-4caa-8cf9-d248e250b691';

-- Verify
SELECT id, crm_field, source_type, source_field, is_enabled
FROM custom_crm_field_mappings
WHERE id IN (
  'c75bf9ba-3387-47fd-a35d-0a46ebe89094',
  '39f4a53d-3a2b-4caa-8cf9-d248e250b691'
);
